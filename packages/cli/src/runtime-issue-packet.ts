import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export type RuntimeProofIssuePacketOptions = {
  evidenceDir: string;
  failureReport: string;
  parentIssue?: string;
  operatingLoopIssue?: string;
  milestone?: string;
  now?: string;
};

export type RuntimeProofIssuePacketFinding = {
  reason: "secret_like_value" | "raw_transcript_path" | "sqlite_artifact" | "screenshot_or_video";
  count: number;
};

export type RuntimeProofIssuePacketReport = {
  kind: "loo_runtime_proof_issue_packet";
  ok: boolean;
  issuePacketReady: boolean;
  generatedAt: string;
  packetPath: string;
  title: string;
  labels: string[];
  milestone: string | null;
  parentRefs: string[];
  duplicateCheckQuery: string;
  steps: string[];
  expected: string;
  actual: string;
  proofBoundary: string;
  acceptanceCriteria: string[];
  evidencePath: string;
  issueBody: string;
  source: {
    failureReportPath: string;
    claimScope: string | null;
    scenarioIds: string[];
    blockerCodes: string[];
    inputFindings: RuntimeProofIssuePacketFinding[];
  };
  redactionScan: {
    publicSafe: boolean;
    rawSecretIncluded: boolean;
    rawTranscriptPathIncluded: boolean;
    sqliteIncluded: boolean;
    screenshotOrVideoIncluded: boolean;
    findings: RuntimeProofIssuePacketFinding[];
  };
  actionsPerformed: {
    githubIssueCreated: false;
    externalWrite: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
  };
  privateDataExclusions: string[];
  blockers: string[];
  nextAction: string;
};

type JsonObject = Record<string, unknown>;

const DEFAULT_LABELS = ["enhancement", "safety", "orchestrator", "eval"];
const DEFAULT_PARENT_REFS = ["#309", "#16"];
const SECRET_LIKE_PATTERN = /(npm_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g;
const RAW_TRANSCRIPT_PATH_PATTERN = /(?:~|\/[^\s"'`]*)\/\.codex\/(?:sessions|archived_sessions)\/[^\s"'`]+|rollout-[0-9T:-]+-[0-9a-f-]+\.jsonl(?:\.gz)?|session\.jsonl(?:\.gz)?/g;
const SQLITE_ARTIFACT_PATTERN = /\b[\w.-]+\.sqlite\b/g;
const SCREENSHOT_PATTERN = /\b[\w.-]+\.(?:png|jpg|jpeg|webp|mov|mp4)\b/gi;

export function createRuntimeProofIssuePacket(options: RuntimeProofIssuePacketOptions): RuntimeProofIssuePacketReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const failureReportPath = resolve(options.failureReport);
  const packetPath = join(evidenceDir, "runtime-proof-issue-packet.json");
  const generatedAtResult = normalizeGeneratedAt(options.now);
  const generatedAt = generatedAtResult.value;
  const explicitParentRefs = [
    normalizeIssueRef(options.parentIssue),
    normalizeIssueRef(options.operatingLoopIssue)
  ].filter(Boolean) as string[];
  const parentRefs = uniqueStrings(explicitParentRefs.length > 0 ? explicitParentRefs : DEFAULT_PARENT_REFS);

  const sourceMissing = !existsSync(failureReportPath);
  const transcriptPathRejected = !sourceMissing && hasPrivateFinding(failureReportPath, "raw_transcript_path");
  const sourceText = !sourceMissing && !transcriptPathRejected ? readFileSync(failureReportPath, "utf8") : "";
  const inputFindings = scanTextForPrivateFindings(sourceText);
  const parsed = readJsonObject(sourceText);
  const invalidJson = !sourceMissing && !transcriptPathRejected && !parsed;
  const blockerCodes = sourceMissing
    ? ["failure_report_missing"]
    : transcriptPathRejected
      ? ["failure_report_transcript_path_rejected"]
      : parsed
      ? extractBlockerCodes(parsed)
      : ["failure_report_invalid_json"];
  const scenarioIds = parsed ? extractScenarioIds(parsed) : [];
  const rawClaimScope = parsed ? stringField(parsed, "claimScope") ?? stringField(parsed, "claim_scope") : null;
  const claimScope = rawClaimScope ? safePublicCode(rawClaimScope) : null;
  const primaryBlocker = blockerCodes[0] ?? "runtime_proof_failure";
  const title = `Runtime proof failed: ${safeTitleSegment(primaryBlocker)}`;
  const labels = uniqueStrings([
    ...DEFAULT_LABELS,
    ...(scenarioIds.some((id) => /codex|gateway|desktop/i.test(id)) || blockerCodes.some((blocker) => /codex|gateway|desktop/i.test(blocker)) ? ["codex"] : [])
  ]);
  const duplicateCheckQuery = buildDuplicateCheckQuery(title, primaryBlocker);
  const evidencePath = publicEvidencePath(evidenceDir);
  const steps = [
    "Run the relevant LCO runtime proof or scenario sweep with a public-safe evidence directory.",
    "Inspect the sanitized failure report and blocker codes.",
    "Open or update a GitHub issue only after duplicate-check review and maintainer approval.",
    "Attach public-safe evidence links only; do not paste raw gateway output, raw prompts, raw transcripts, screenshots, SQLite DB contents, tokens, cookies, or credentials."
  ];
  const expected = "Runtime proof markers satisfy the claimed scenario, or the failure is converted into a public-safe issue handoff with exact blocker codes and acceptance criteria.";
  const actual = sourceMissing
    ? "No failure report was available for packet generation."
    : transcriptPathRejected
      ? "The failure report path looked like a raw Codex transcript path and was rejected before reading."
    : invalidJson
      ? "The failure report was not valid JSON; only sanitized category-level findings were retained."
      : `Runtime proof failed with blocker codes: ${blockerCodes.join(", ") || "none reported"}.`;
  const acceptanceCriteria = [
    "Reproduce the failed runtime proof or scenario sweep from the public-safe command and evidence path.",
    "Resolve or explicitly defer each blocker code listed in this packet.",
    "Record a new public-safe proof marker or a new fail-closed issue packet after the fix.",
    "Keep external GitHub writes manual or approval-gated; this packet alone must not create issues.",
    "Verify the final packet contains no raw transcript text, raw transcript paths, screenshots, SQLite DBs, tokens, cookies, credentials, or private customer data."
  ];
  const proofBoundary = "This packet is a public-safe GitHub issue handoff for failed runtime proof only. It does not create GitHub issues, mutate external systems, run live Codex control, mutate a GUI, publish npm, or create a GitHub Release.";
  const issueBody = buildIssueBody({
    parentRefs,
    evidencePath,
    scenarioIds,
    blockerCodes,
    steps,
    expected,
    actual,
    proofBoundary,
    acceptanceCriteria,
    duplicateCheckQuery
  });
  const initialReport = {
    kind: "loo_runtime_proof_issue_packet" as const,
    ok: false,
    issuePacketReady: false,
    generatedAt,
    packetPath,
    title,
    labels,
    milestone: options.milestone?.trim() || null,
    parentRefs,
    duplicateCheckQuery,
    steps,
    expected,
    actual,
    proofBoundary,
    acceptanceCriteria,
    evidencePath,
    issueBody,
    source: {
      failureReportPath: redactPrivateSpans(failureReportPath),
      claimScope,
      scenarioIds,
      blockerCodes,
      inputFindings
    },
    redactionScan: {
      publicSafe: true,
      rawSecretIncluded: false,
      rawTranscriptPathIncluded: false,
      sqliteIncluded: false,
      screenshotOrVideoIncluded: false,
      findings: [] as RuntimeProofIssuePacketFinding[]
    },
    actionsPerformed: {
      githubIssueCreated: false as const,
      externalWrite: false as const,
      liveCodexControlRun: false as const,
      desktopGuiActionRun: false as const,
      rawTranscriptRead: false as const
    },
    privateDataExclusions: [
      "raw gateway output",
      "raw Codex transcripts",
      "raw prompts or transcript spans",
      "absolute transcript paths",
      "SQLite DBs",
      "screenshots or videos",
      "tokens, credentials, API keys, cookies",
      "private customer data"
    ],
    blockers: [
      ...(generatedAtResult.invalid ? ["invalid_generated_at"] : []),
      ...(sourceMissing ? ["failure_report_missing"] : []),
      ...(transcriptPathRejected ? ["failure_report_transcript_path_rejected"] : []),
      ...(invalidJson ? ["failure_report_invalid_json"] : []),
      ...(!sourceMissing && !transcriptPathRejected && !invalidJson && blockerCodes.length === 0 ? ["failure_report_blockers_missing"] : [])
    ],
    nextAction: ""
  };
  const outputFindings = scanTextForPrivateFindings(JSON.stringify(initialReport));
  const redactionScan = {
    publicSafe: outputFindings.length === 0,
    rawSecretIncluded: outputFindings.some((finding) => finding.reason === "secret_like_value"),
    rawTranscriptPathIncluded: outputFindings.some((finding) => finding.reason === "raw_transcript_path"),
    sqliteIncluded: outputFindings.some((finding) => finding.reason === "sqlite_artifact"),
    screenshotOrVideoIncluded: outputFindings.some((finding) => finding.reason === "screenshot_or_video"),
    findings: outputFindings
  };
  const blockers = [
    ...initialReport.blockers,
    ...(redactionScan.publicSafe ? [] : ["issue_packet_redaction_failed"])
  ];
  const report: RuntimeProofIssuePacketReport = {
    ...initialReport,
    ok: blockers.length === 0,
    issuePacketReady: blockers.length === 0,
    redactionScan,
    blockers,
    nextAction: blockers.length === 0
      ? "Review the duplicate-check query, then manually create or update the GitHub issue with this public-safe packet."
      : "Repair the failure report input or packet redaction blockers before filing an issue."
  };
  const persistedReport = redactionScan.publicSafe ? report : createRedactionFailureStub(report, redactionScan, blockers);
  writeFileSync(packetPath, `${JSON.stringify(persistedReport, null, 2)}\n`);
  return persistedReport;
}

function readJsonObject(text: string): JsonObject | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

function normalizeGeneratedAt(value: string | undefined): { value: string; invalid: boolean } {
  if (!value) return { value: new Date().toISOString(), invalid: false };
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return { value: new Date().toISOString(), invalid: true };
  const normalized = parsed.toISOString();
  return { value: normalized, invalid: normalized !== value };
}

function publicEvidencePath(evidenceDir: string): string {
  return `local-evidence-dir:${safeCode(basename(evidenceDir) || "evidence")}`;
}

function createRedactionFailureStub(
  report: RuntimeProofIssuePacketReport,
  redactionScan: RuntimeProofIssuePacketReport["redactionScan"],
  blockers: string[]
): RuntimeProofIssuePacketReport {
  return {
    ...report,
    ok: false,
    issuePacketReady: false,
    title: "Runtime proof packet redaction failed",
    milestone: null,
    duplicateCheckQuery: "",
    steps: [],
    expected: "A runtime proof issue packet must be public-safe before it is persisted.",
    actual: "The generated packet failed its final redaction scan; unsafe fields were replaced by this minimal fail-closed stub.",
    acceptanceCriteria: [],
    issueBody: "",
    source: {
      failureReportPath: redactPrivateSpans(report.source.failureReportPath),
      claimScope: null,
      scenarioIds: [],
      blockerCodes: [],
      inputFindings: report.source.inputFindings
    },
    redactionScan,
    blockers,
    nextAction: "Repair the failure report input or packet redaction blockers before filing an issue."
  };
}

function scanTextForPrivateFindings(text: string): RuntimeProofIssuePacketFinding[] {
  return [
    countFinding("secret_like_value", text.match(SECRET_LIKE_PATTERN)?.length ?? 0),
    countFinding("raw_transcript_path", text.match(RAW_TRANSCRIPT_PATH_PATTERN)?.length ?? 0),
    countFinding("sqlite_artifact", text.match(SQLITE_ARTIFACT_PATTERN)?.length ?? 0),
    countFinding("screenshot_or_video", text.match(SCREENSHOT_PATTERN)?.length ?? 0)
  ].filter((finding): finding is RuntimeProofIssuePacketFinding => Boolean(finding));
}

function hasPrivateFinding(text: string, reason: RuntimeProofIssuePacketFinding["reason"]): boolean {
  return scanTextForPrivateFindings(text).some((finding) => finding.reason === reason);
}

function countFinding(reason: RuntimeProofIssuePacketFinding["reason"], count: number): RuntimeProofIssuePacketFinding | null {
  return count > 0 ? { reason, count } : null;
}

function extractBlockerCodes(report: JsonObject): string[] {
  return uniqueStrings([
    ...stringArrayField(report, "blockers"),
    ...stringArrayField(report, "setupBlockers"),
    ...stringArrayField(report, "rawEvidenceBlockers"),
    ...extractScenarioBlockers(report),
    stringField(report, "blocker")
  ].filter(Boolean) as string[]).map((blocker) => safePublicCode(blocker));
}

function extractScenarioBlockers(report: JsonObject): string[] {
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  return scenarios.flatMap((scenario) => {
    if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) return [];
    return stringArrayField(scenario as JsonObject, "blockers");
  });
}

function extractScenarioIds(report: JsonObject): string[] {
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  return uniqueStrings([
    stringField(report, "scenario_id"),
    stringField(report, "scenarioId"),
    stringField(report, "id"),
    ...scenarios.flatMap((scenario) => {
      if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) return [];
      return [
        stringField(scenario as JsonObject, "id"),
        stringField(scenario as JsonObject, "scenario_id"),
        stringField(scenario as JsonObject, "scenarioId")
      ];
    })
  ].filter(Boolean) as string[]).map((id) => safePublicCode(id));
}

function buildDuplicateCheckQuery(title: string, primaryBlocker: string): string {
  return `repo:100yenadmin/Lossless-Codex-Orchestrator-LCO is:issue is:open "${safeQueryPhrase(primaryBlocker)}" "${safeQueryPhrase(title)}"`;
}

function buildIssueBody(input: {
  parentRefs: string[];
  evidencePath: string;
  scenarioIds: string[];
  blockerCodes: string[];
  steps: string[];
  expected: string;
  actual: string;
  proofBoundary: string;
  acceptanceCriteria: string[];
  duplicateCheckQuery: string;
}): string {
  return [
    `Parent: ${input.parentRefs.join(" / ")}`,
    "",
    "## Summary",
    "",
    "A runtime proof or scenario sweep failed and has been converted into a public-safe issue handoff packet.",
    "",
    "## Duplicate Check",
    "",
    `- Query: \`${input.duplicateCheckQuery}\``,
    "",
    "## Evidence",
    "",
    `- Evidence path: \`${input.evidencePath}\``,
    `- Scenario ids: ${input.scenarioIds.length > 0 ? input.scenarioIds.map((id) => `\`${id}\``).join(", ") : "`unknown`"}`,
    `- Blockers: ${input.blockerCodes.length > 0 ? input.blockerCodes.map((code) => `\`${code}\``).join(", ") : "`none reported`"}`,
    "",
    "## Steps",
    "",
    ...input.steps.map((step) => `- ${step}`),
    "",
    "## Expected",
    "",
    input.expected,
    "",
    "## Actual",
    "",
    input.actual,
    "",
    "## Acceptance Criteria",
    "",
    ...input.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "## Proof Boundary",
    "",
    input.proofBoundary,
    ""
  ].join("\n");
}

function stringField(record: JsonObject | null, field: string): string | null {
  const value = record?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArrayField(record: JsonObject, field: string): string[] {
  const value = record[field];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim());
}

function normalizeIssueRef(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^#\d+$/.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `#${trimmed}`;
  return null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function safeCode(value: string): string {
  return value.replace(/[^A-Za-z0-9_:#./-]/g, "_").slice(0, 180);
}

function safePublicCode(value: string): string {
  return safeCode(redactPrivateSpans(value));
}

function safeTitleSegment(value: string): string {
  return safeCode(value).replace(/_/g, " ").slice(0, 120).trim() || "runtime proof failure";
}

function safeQueryPhrase(value: string): string {
  return redactPrivateSpans(value).replace(/["`$\\]/g, "").slice(0, 140);
}

function redactPrivateSpans(value: string): string {
  return value
    .replace(SECRET_LIKE_PATTERN, "redacted_secret_like_value")
    .replace(RAW_TRANSCRIPT_PATH_PATTERN, "redacted_raw_transcript_path")
    .replace(SQLITE_ARTIFACT_PATTERN, "redacted_sqlite_artifact")
    .replace(SCREENSHOT_PATTERN, "redacted_media_artifact");
}
