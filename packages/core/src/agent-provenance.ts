import { createHash } from "node:crypto";

export const AGENT_PROVENANCE_SCHEMA = "lco.agent.provenance.v1" as const;
export const AGENT_PROVENANCE_PARSE_SCHEMA = "lco.agent.provenance.parse.v1" as const;

export type AgentProvenanceSourceKind =
  | "agent_output"
  | "coordination_packet"
  | "issue_comment"
  | "pr_body"
  | "unknown";

export type AgentProvenanceMarkerKind = "hidden_marker" | "visible_block";

export type AgentProvenanceRecord = {
  schema: typeof AGENT_PROVENANCE_SCHEMA;
  publicSafe: true;
  sourceKind: AgentProvenanceSourceKind;
  sourceRef: string;
  repo: string | null;
  targetIssues: number[];
  pullRequests: number[];
  parentThreadId: string | null;
  workerThreadId: string | null;
  branch: string | null;
  commit: string | null;
  finalTurnId: string | null;
  evidenceRef: string | null;
  agentRole: string | null;
  model: string | null;
  markerKind: AgentProvenanceMarkerKind;
};

export type AgentProvenanceFinding = {
  patternClass: "connector_url" | "local_path" | "raw_transcript" | "secret";
  sourceRef: string;
  field: string | null;
  fingerprint: string;
  evidencePreview: string;
};

export type AgentProvenanceParseReport = {
  schema: typeof AGENT_PROVENANCE_PARSE_SCHEMA;
  publicSafe: true;
  records: AgentProvenanceRecord[];
  findings: AgentProvenanceFinding[];
};

export type ParseAgentProvenanceOptions = {
  sourceKind?: AgentProvenanceSourceKind;
  sourceRef?: string;
};

export type AgentProvenanceLookup = {
  parentThreadId?: string;
  workerThreadId?: string;
  targetIssue?: number;
  pullRequest?: number;
  branch?: string;
  finalTurnId?: string;
};

type ProvenanceFields = {
  repo?: string;
  issues?: string;
  targetIssues?: string;
  pr?: string;
  pullRequests?: string;
  parentThread?: string;
  workerThread?: string;
  branch?: string;
  commit?: string;
  finalTurnId?: string;
  evidenceRef?: string;
  agentRole?: string;
  model?: string;
};

const HIDDEN_MARKER_PATTERN = /<!--\s*lco-agent-provenance\s+([\s\S]*?)-->/g;
const LOCAL_PATH_PATTERN = /(?:\/Users\/[^\s`'"<>]+|\/Volumes\/[^\s`'"<>]+|\/home\/[^\s`'"<>]+|\/root(?:\/[^\s`'"<>]+)?|~\/(?:\.codex|Library|Documents|Desktop)\/[^\s`'"<>]+|[A-Za-z]:\\Users\\[^\s`'"<>]+)/g;
const SECRET_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,}|npm_[A-Za-z0-9_]{10,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,}){1,2}|PRIVATE_CANARY[A-Za-z0-9_:-]*)\b/g;
const CONNECTOR_URL_PATTERN = /\b(?:app|connector):\/\/[^\s`'"<>]+/g;
const RAW_TRANSCRIPT_PATTERN = /\bRAW_TRANSCRIPT_CANARY[^\r\n]*/g;

export function parseAgentProvenanceText(text: string, options: ParseAgentProvenanceOptions = {}): AgentProvenanceParseReport {
  const sourceKind = options.sourceKind ?? "unknown";
  const sourceRef = publicSafeSourceRef(options.sourceRef ?? "agent_provenance:input");
  const findings = unsafeFindings(text, sourceRef, null);
  const records: AgentProvenanceRecord[] = [
    ...parseHiddenMarkers(text, sourceKind, sourceRef),
    ...parseVisibleBlocks(text, sourceKind, sourceRef)
  ];

  return {
    schema: AGENT_PROVENANCE_PARSE_SCHEMA,
    publicSafe: true,
    records,
    findings: dedupeFindings(findings)
  };
}

export function findAgentProvenanceRecords(records: AgentProvenanceRecord[], lookup: AgentProvenanceLookup): AgentProvenanceRecord[] {
  const parentThreadId = lookup.parentThreadId === undefined ? undefined : normalizeThreadId(lookup.parentThreadId);
  const workerThreadId = lookup.workerThreadId === undefined ? undefined : normalizeThreadId(lookup.workerThreadId);
  const finalTurnId = lookup.finalTurnId === undefined ? undefined : normalizeSafeIdentifier(lookup.finalTurnId);
  const branch = lookup.branch === undefined ? undefined : normalizeBranch(lookup.branch);

  if (
    parentThreadId === null
    || workerThreadId === null
    || finalTurnId === null
    || branch === null
  ) {
    return [];
  }

  return records.filter((record) => {
    if (parentThreadId !== undefined && record.parentThreadId !== parentThreadId) return false;
    if (workerThreadId !== undefined && record.workerThreadId !== workerThreadId) return false;
    if (lookup.targetIssue !== undefined && !record.targetIssues.includes(lookup.targetIssue)) return false;
    if (lookup.pullRequest !== undefined && !record.pullRequests.includes(lookup.pullRequest)) return false;
    if (branch !== undefined && record.branch !== branch) return false;
    if (finalTurnId !== undefined && record.finalTurnId !== finalTurnId) return false;
    return true;
  });
}

function parseHiddenMarkers(text: string, sourceKind: AgentProvenanceSourceKind, sourceRef: string): AgentProvenanceRecord[] {
  const records: AgentProvenanceRecord[] = [];
  for (const match of text.matchAll(HIDDEN_MARKER_PATTERN)) {
    const fields = hiddenMarkerFields(match[1] ?? "");
    records.push(createRecord(fields, sourceKind, sourceRef, "hidden_marker"));
  }
  return records;
}

function hiddenMarkerFields(rawAttributes: string): ProvenanceFields {
  const fields: ProvenanceFields = {};
  for (const attribute of parseHiddenAttributes(rawAttributes)) {
    const key = normalizeKey(attribute.key);
    const value = attribute.value;
    if (key === "repo") fields.repo = value;
    if (key === "issue" || key === "issues" || key === "target_issue" || key === "target_issues") fields.issues = appendTokenList(fields.issues, value);
    if (key === "pr" || key === "prs" || key === "pull_request" || key === "pull_requests") fields.pullRequests = appendTokenList(fields.pullRequests, value);
    if (key === "parent_thread" || key === "parent_thread_id" || key === "orchestrator_thread") fields.parentThread = value;
    if (key === "worker_thread" || key === "worker_thread_id") fields.workerThread = value;
    if (key === "branch") fields.branch = value;
    if (key === "commit" || key === "sha") fields.commit = value;
    if (key === "final_turn" || key === "final_turn_id") fields.finalTurnId = value;
    if (key === "evidence" || key === "evidence_ref" || key === "evidence_packet") fields.evidenceRef = value;
    if (key === "role" || key === "agent_role" || key === "agent_name") fields.agentRole = value;
    if (key === "model") fields.model = value;
  }
  return fields;
}

function parseHiddenAttributes(rawAttributes: string): Array<{ key: string; value: string }> {
  const attributes: Array<{ key: string; value: string }> = [];
  let index = 0;
  while (index < rawAttributes.length) {
    while (/\s/.test(rawAttributes[index] ?? "")) index += 1;
    const keyMatch = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(rawAttributes.slice(index));
    if (!keyMatch) {
      index += 1;
      continue;
    }
    const key = keyMatch[0];
    index += key.length;
    while (/\s/.test(rawAttributes[index] ?? "")) index += 1;
    if (rawAttributes[index] !== "=") continue;
    index += 1;
    while (/\s/.test(rawAttributes[index] ?? "")) index += 1;

    const quote = rawAttributes[index];
    if (quote === "\"" || quote === "'") {
      index += 1;
      const start = index;
      while (index < rawAttributes.length && rawAttributes[index] !== quote) index += 1;
      attributes.push({ key, value: rawAttributes.slice(start, index) });
      if (rawAttributes[index] === quote) index += 1;
      continue;
    }

    const start = index;
    while (index < rawAttributes.length && !/\s|>/.test(rawAttributes[index] ?? "")) index += 1;
    attributes.push({ key, value: rawAttributes.slice(start, index) });
  }
  return attributes;
}

function parseVisibleBlocks(text: string, sourceKind: AgentProvenanceSourceKind, sourceRef: string): AgentProvenanceRecord[] {
  const lines = text.split(/\r?\n/);
  const records: AgentProvenanceRecord[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^##\s+Agent provenance\s*$/i.test(lines[index] ?? "")) continue;
    const fields: ProvenanceFields = {};
    for (let row = index + 1; row < lines.length; row += 1) {
      const line = lines[row] ?? "";
      if (/^##\s+\S/.test(line)) break;
      const bullet = /^\s*-\s*([^:]+):\s*(.*?)\s*$/.exec(line);
      if (!bullet) continue;
      assignVisibleField(fields, bullet[1] ?? "", stripMarkdownValue(bullet[2] ?? ""));
    }
    records.push(createRecord(fields, sourceKind, sourceRef, "visible_block"));
  }
  return records;
}

function assignVisibleField(fields: ProvenanceFields, label: string, value: string): void {
  const key = normalizeKey(label);
  if (key === "repo" || key === "repository") fields.repo = value;
  if (key === "orchestrator_thread" || key === "parent_thread") fields.parentThread = value;
  if (key === "worker_thread") fields.workerThread = value;
  if (key === "agent_role_name" || key === "agent_role" || key === "agent_name") fields.agentRole = value;
  if (key === "model") fields.model = value;
  if (key === "target_issues" || key === "target_issue_s") fields.issues = appendTokenList(fields.issues, value);
  if (key === "pull_request" || key === "pull_requests" || key === "pr" || key === "prs") {
    fields.pullRequests = appendTokenList(fields.pullRequests, extractPullRequestTokens(value).join(" ") || value);
  }
  if (key === "branch") fields.branch = value;
  if (key === "commit" || key === "sha") fields.commit = value;
  if (key === "pr_branch" || key === "pr_or_branch") {
    const pullRequests = extractPullRequestTokens(value);
    if (pullRequests.length > 0) {
      fields.pullRequests = appendTokenList(fields.pullRequests, pullRequests.join(" "));
    } else {
      fields.branch = value;
    }
  }
  if (key === "final_turn_id" || key === "final_turn") fields.finalTurnId = value;
  if (key === "evidence_packet" || key === "evidence" || key === "evidence_ref") fields.evidenceRef = value;
}

function createRecord(
  fields: ProvenanceFields,
  sourceKind: AgentProvenanceSourceKind,
  sourceRef: string,
  markerKind: AgentProvenanceMarkerKind
): AgentProvenanceRecord {
  return {
    schema: AGENT_PROVENANCE_SCHEMA,
    publicSafe: true,
    sourceKind,
    sourceRef,
    repo: normalizeRepo(fields.repo ?? "") ?? null,
    targetIssues: uniqueNumbers(extractNumbers(fields.targetIssues ?? fields.issues ?? "")),
    pullRequests: extractPullRequestNumbers(fields.pullRequests ?? fields.pr ?? ""),
    parentThreadId: normalizeThreadId(fields.parentThread ?? ""),
    workerThreadId: normalizeThreadId(fields.workerThread ?? ""),
    branch: normalizeBranch(fields.branch ?? ""),
    commit: normalizeCommit(fields.commit ?? ""),
    finalTurnId: normalizeSafeIdentifier(fields.finalTurnId ?? ""),
    evidenceRef: normalizeEvidenceRef(fields.evidenceRef ?? ""),
    agentRole: normalizeShortPublicText(fields.agentRole ?? ""),
    model: normalizeModel(fields.model ?? ""),
    markerKind
  };
}

function unsafeFindings(text: string, sourceRef: string, field: string | null): AgentProvenanceFinding[] {
  return [
    ...matchesForPattern(text, LOCAL_PATH_PATTERN, "local_path", sourceRef, field, "<redacted-local-path>"),
    ...matchesForPattern(text, SECRET_PATTERN, "secret", sourceRef, field, "<redacted-secret>"),
    ...matchesForPattern(text, CONNECTOR_URL_PATTERN, "connector_url", sourceRef, field, "<redacted-connector-url>"),
    ...matchesForPattern(text, RAW_TRANSCRIPT_PATTERN, "raw_transcript", sourceRef, field, "<redacted-raw-transcript>")
  ];
}

function matchesForPattern(
  text: string,
  pattern: RegExp,
  patternClass: AgentProvenanceFinding["patternClass"],
  sourceRef: string,
  field: string | null,
  evidencePreview: string
): AgentProvenanceFinding[] {
  const findings: AgentProvenanceFinding[] = [];
  for (const match of text.matchAll(pattern)) {
    const position = match.index ?? findings.length;
    findings.push({
      patternClass,
      sourceRef,
      field,
      fingerprint: `match-position:${position}`,
      evidencePreview
    });
  }
  return findings;
}

function dedupeFindings(findings: AgentProvenanceFinding[]): AgentProvenanceFinding[] {
  const seen = new Set<string>();
  const deduped: AgentProvenanceFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.patternClass}:${finding.fingerprint}:${finding.field ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

function normalizeThreadId(value: string): string | null {
  const trimmed = stripMarkdownValue(value).replace(/^codex_thread:/, "");
  if (!trimmed || trimmed === "unavailable" || trimmed === "none") return null;
  if (!/^[A-Za-z0-9._:-]{4,200}$/.test(trimmed)) return null;
  if (hasUnsafeCanary(trimmed)) return null;
  return trimmed;
}

function normalizeRepo(value: string): string | null {
  const trimmed = stripMarkdownValue(value);
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed) ? trimmed : null;
}

function normalizeBranch(value: string): string | null {
  const trimmed = stripMarkdownValue(value);
  if (!trimmed || trimmed === "none" || trimmed === "unavailable") return null;
  if (hasUnsafeCanary(trimmed)) return null;
  return /^[A-Za-z0-9._/-]{1,200}$/.test(trimmed) && !trimmed.startsWith("/") ? trimmed : null;
}

function normalizeCommit(value: string): string | null {
  const trimmed = stripMarkdownValue(value);
  if (!trimmed || trimmed === "none" || trimmed === "unavailable") return null;
  return /^[A-Fa-f0-9]{7,64}$/.test(trimmed) ? trimmed : null;
}

function normalizeSafeIdentifier(value: string): string | null {
  const trimmed = stripMarkdownValue(value);
  if (!trimmed || trimmed === "none" || trimmed === "unavailable") return null;
  if (hasUnsafeCanary(trimmed)) return null;
  return /^[A-Za-z0-9._:-]{1,200}$/.test(trimmed) ? trimmed : null;
}

function normalizeModel(value: string): string | null {
  const trimmed = stripMarkdownValue(value);
  if (!trimmed || trimmed === "none" || trimmed === "unavailable") return null;
  if (hasUnsafeCanary(trimmed)) return null;
  return /^[A-Za-z0-9._:/+-]{1,120}$/.test(trimmed) ? trimmed : null;
}

function normalizeEvidenceRef(value: string): string | null {
  const trimmed = stripMarkdownValue(value);
  if (!trimmed || trimmed === "none" || trimmed === "unavailable") return null;
  if (hasUnsafeCanary(trimmed)) return null;
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull)\/\d+(?:#[-A-Za-z0-9_]+)?$/.test(trimmed)) return trimmed;
  if (/^artifact:[A-Za-z0-9._:#/ >-]{1,220}$/.test(trimmed)) return trimmed;
  if (/^(?:github_issue|github_pr|github_issue_comment|codex_thread|artifact):[A-Za-z0-9._:#/-]{1,220}$/.test(trimmed)) return trimmed;
  return null;
}

function normalizeShortPublicText(value: string): string | null {
  const trimmed = stripMarkdownValue(value);
  if (!trimmed || hasUnsafeCanary(trimmed)) return null;
  const cleaned = trimmed.replace(/[^\w .:/@+>,-]/g, "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 120) || null;
}

function publicSafeSourceRef(value: string): string {
  const trimmed = stripMarkdownValue(value);
  return /^[A-Za-z0-9._:#/-]{1,220}$/.test(trimmed) && !hasUnsafeCanary(trimmed)
    ? trimmed
    : `agent_provenance:${createHash("sha256").update(trimmed).digest("hex").slice(0, 16)}`;
}

function hasUnsafeCanary(value: string): boolean {
  return Boolean(
    value.match(LOCAL_PATH_PATTERN)
    || value.match(SECRET_PATTERN)
    || value.match(CONNECTOR_URL_PATTERN)
    || value.match(RAW_TRANSCRIPT_PATTERN)
  );
}

function extractNumbers(value: string): number[] {
  return [...value.matchAll(/#?(\d+)/g)].map((match) => Number(match[1])).filter((number) => Number.isSafeInteger(number) && number > 0);
}

function extractPullRequestTokens(value: string): string[] {
  if (/^\s*#?\d+\s*$/.test(value)) return [(value.match(/\d+/)?.[0] ?? "")].filter(Boolean);
  return [...value.matchAll(/(?:\/pull\/|#)(\d+)/g)].map((match) => match[1] ?? "").filter(Boolean);
}

function extractPullRequestNumbers(value: string): number[] {
  const pullRequestTokens = extractPullRequestTokens(value);
  const numbers = pullRequestTokens.length > 0
    ? pullRequestTokens.map((token) => Number(token))
    : extractNumbers(value);
  return uniqueNumbers(numbers.filter((number) => Number.isSafeInteger(number) && number > 0));
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function appendTokenList(existing: string | undefined, value: string): string {
  return [existing, value].filter(Boolean).join(" ");
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stripMarkdownValue(value: string): string {
  return stripQuotes(value.trim().replace(/^`+|`+$/g, "").trim());
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
