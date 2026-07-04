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
  patternClass: "connector_url" | "local_path" | "raw_transcript" | "secret" | "unsafe_value";
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
const ATTRIBUTE_PATTERN = /([A-Za-z_][A-Za-z0-9_-]*)=("[^"]*"|'[^']*'|[^\s>]+)/g;
const LOCAL_PATH_PATTERN = /(?:\/Users\/[^\s`'"<>]+|\/Volumes\/[^\s`'"<>]+|~\/(?:\.codex|Library|Documents|Desktop)\/[^\s`'"<>]+)/g;
const SECRET_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,}|npm_[A-Za-z0-9_]{10,}|PRIVATE_CANARY[A-Za-z0-9_:-]*)\b/g;
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
  const parentThreadId = normalizeThreadId(lookup.parentThreadId ?? "");
  const workerThreadId = normalizeThreadId(lookup.workerThreadId ?? "");
  const finalTurnId = normalizeSafeIdentifier(lookup.finalTurnId ?? "");
  const branch = normalizeBranch(lookup.branch ?? "");

  return records.filter((record) => {
    if (parentThreadId && record.parentThreadId !== parentThreadId) return false;
    if (workerThreadId && record.workerThreadId !== workerThreadId) return false;
    if (lookup.targetIssue !== undefined && !record.targetIssues.includes(lookup.targetIssue)) return false;
    if (lookup.pullRequest !== undefined && !record.pullRequests.includes(lookup.pullRequest)) return false;
    if (branch && record.branch !== branch) return false;
    if (finalTurnId && record.finalTurnId !== finalTurnId) return false;
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
  for (const match of rawAttributes.matchAll(ATTRIBUTE_PATTERN)) {
    const key = normalizeKey(match[1] ?? "");
    const value = stripQuotes(match[2] ?? "");
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
  if (key === "orchestrator_thread" || key === "parent_thread") fields.parentThread = value;
  if (key === "worker_thread") fields.workerThread = value;
  if (key === "agent_role_name" || key === "agent_role" || key === "agent_name") fields.agentRole = value;
  if (key === "model") fields.model = value;
  if (key === "target_issues" || key === "target_issue_s") fields.issues = appendTokenList(fields.issues, value);
  if (key === "pr_branch" || key === "pr_or_branch") {
    const pullRequests = extractPullRequestTokens(value);
    if (pullRequests.length > 0) {
      fields.pullRequests = appendTokenList(fields.pullRequests, pullRequests.join(" "));
    } else {
      fields.branch = value;
    }
  }
  if (key === "final_turn_id" || key === "final_turn") fields.finalTurnId = value;
  if (key === "evidence_packet" || key === "evidence") fields.evidenceRef = value;
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
    pullRequests: uniqueNumbers(extractNumbers(fields.pullRequests ?? fields.pr ?? "")),
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
    const value = match[0] ?? "";
    findings.push({
      patternClass,
      sourceRef,
      field,
      fingerprint: `sha256:${createHash("sha256").update(`${patternClass}:${value}`).digest("hex").slice(0, 24)}`,
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
  if (/^(?:github_issue|github_pr|github_issue_comment|codex_thread|artifact):[A-Za-z0-9._:#/-]{1,220}$/.test(trimmed)) return trimmed;
  return null;
}

function normalizeShortPublicText(value: string): string | null {
  const trimmed = stripMarkdownValue(value);
  if (!trimmed || hasUnsafeCanary(trimmed)) return null;
  const cleaned = trimmed.replace(/[^\w .:/@+-]/g, "").replace(/\s+/g, " ").trim();
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
  return [...value.matchAll(/(?:\/pull\/|#)(\d+)/g)].map((match) => match[1] ?? "").filter(Boolean);
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
