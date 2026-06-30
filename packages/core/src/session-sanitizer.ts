import { createHmac, randomBytes } from "node:crypto";

export type SessionSanitizerPatternClass =
  | "api_key"
  | "bearer_token"
  | "cookie"
  | "private_key"
  | "local_path";

export type SessionSanitizerConfidence = "low" | "medium" | "high";

export type SessionSanitizerSource = {
  sourceRef: string;
  text: string;
};

export type SessionSanitizerFinding = {
  sourceRef: string;
  patternClass: SessionSanitizerPatternClass;
  confidence: SessionSanitizerConfidence;
  redactedValue: string;
  evidencePreview: string;
  fingerprint: string;
  suggestedRepair: string;
};

export type SessionSanitizerRepairTask = {
  taskId: string;
  sourceRef: string;
  patternClass: SessionSanitizerPatternClass;
  confidence: SessionSanitizerConfidence;
  fingerprint: string;
  redactedValue: string;
  suggestedRepair: string;
  checklist: string[];
  requiresLocalReview: true;
  mutationStatus: "not_performed";
};

export type SessionSanitizerReport = {
  ok: boolean;
  publicSafe: true;
  generatedAt: string;
  sourceCount: number;
  findingCount: number;
  findings: SessionSanitizerFinding[];
  blockers: string[];
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

export type SessionSanitizerRepairPlan = {
  ok: boolean;
  publicSafe: true;
  dryRun: true;
  mutatesCodex: false;
  generatedAt: string;
  source?: string;
  sourceLimit?: number;
  sourceCount: number;
  findingCount: number;
  taskCount: number;
  scannedRefs?: string[];
  tasks: SessionSanitizerRepairTask[];
  blockers: string[];
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

type SanitizerPattern = {
  patternClass: SessionSanitizerPatternClass;
  confidence: SessionSanitizerConfidence;
  regex: RegExp;
  redactedValue(match: string): string;
  suggestedRepair: string;
};

const SUPPORTED_SOURCE_REF_PREFIXES = [
  "codex_thread:",
  "codex_event:",
  "lcm_summary:",
  "openclaw_session:"
];

const PRIVATE_DATA_EXCLUSIONS = [
  "raw Codex transcripts",
  "raw prompts or message text",
  "raw secret values",
  "SQLite DBs",
  "screenshots or videos",
  "tokens, credentials, API keys, cookies",
  "private customer data"
];

const PATTERNS: SanitizerPattern[] = [
  {
    patternClass: "api_key",
    confidence: "high",
    regex: /sk-[A-Za-z0-9_-]{10,}/g,
    redactedValue: () => "<redacted-secret>",
    suggestedRepair: "Rotate the key, remove it from local session text, and keep only the redacted source ref in public evidence."
  },
  {
    patternClass: "bearer_token",
    confidence: "high",
    regex: /\bBearer\s+[^\s\r\n]{16,}/gi,
    redactedValue: () => "Bearer <redacted-secret>",
    suggestedRepair: "Rotate the bearer token and replace the session evidence with a redacted authorization marker."
  },
  {
    patternClass: "cookie",
    confidence: "high",
    regex: /\bCookie\s*:\s*[^\r\n]+/gi,
    redactedValue: () => "Cookie: <redacted-secret>",
    suggestedRepair: "Invalidate the cookie if it was real and keep only a redacted cookie marker in shareable evidence."
  },
  {
    patternClass: "private_key",
    confidence: "high",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    redactedValue: () => "<redacted-secret>",
    suggestedRepair: "Treat the key as compromised, rotate it, and remove the raw key block from local session evidence."
  },
  {
    patternClass: "local_path",
    confidence: "medium",
    regex: /(?:\/Users\/[^/\r\n"'`)]+|\/Volumes\/[^/\r\n"'`)]+|\/private\/var\/[^/\r\n"'`)]+)(?:\/[^\r\n"'`)]+)+/g,
    redactedValue: () => "~/<redacted-path>",
    suggestedRepair: "Replace the local path with a source ref or redacted path before sharing evidence."
  }
];

export function createSessionSanitizerReport(options: {
  sources: SessionSanitizerSource[];
  now?: string;
  auditKey?: string;
}): SessionSanitizerReport {
  for (const source of options.sources) assertSupportedSourceRef(source.sourceRef);
  const auditKey = options.auditKey ?? randomBytes(32).toString("hex");
  const findings = options.sources.flatMap((source) => scanSource(source, auditKey));

  return {
    ok: true,
    publicSafe: true,
    generatedAt: options.now ?? new Date().toISOString(),
    sourceCount: options.sources.length,
    findingCount: findings.length,
    findings,
    blockers: [],
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS,
    proofBoundary: "This sanitizer report is public-safe synthetic/local evidence only; it does not include raw secrets, mutate sessions, or approve repair actions.",
    nextAction: findings.length > 0
      ? "Review redacted findings locally, rotate any real secrets, and keep repair actions dry-run until separately approved."
      : "No sanitizer findings were detected in the provided sources."
  };
}

export function createSessionSanitizerRepairPlan(
  report: SessionSanitizerReport,
  options: { source?: string; sourceLimit?: number; scannedRefs?: string[] } = {}
): SessionSanitizerRepairPlan {
  const tasks = report.findings.map((finding) => ({
    taskId: `repair:${finding.fingerprint}`,
    sourceRef: finding.sourceRef,
    patternClass: finding.patternClass,
    confidence: finding.confidence,
    fingerprint: finding.fingerprint,
    redactedValue: finding.redactedValue,
    suggestedRepair: finding.suggestedRepair,
    checklist: repairChecklist(finding),
    requiresLocalReview: true as const,
    mutationStatus: "not_performed" as const
  }));
  return {
    ok: report.ok,
    publicSafe: true,
    dryRun: true,
    mutatesCodex: false,
    generatedAt: report.generatedAt,
    source: options.source,
    sourceLimit: options.sourceLimit,
    sourceCount: report.sourceCount,
    findingCount: report.findingCount,
    taskCount: tasks.length,
    scannedRefs: options.scannedRefs,
    tasks,
    blockers: report.blockers,
    privateDataExclusions: report.privateDataExclusions,
    proofBoundary: "This sanitizer repair plan is a public-safe dry run derived from redacted findings only; it does not mutate sessions, read raw transcripts, rotate secrets, edit files, run live Codex control, or mutate a desktop GUI.",
    nextAction: tasks.length > 0
      ? "Review each redacted task locally, rotate any real credential, and perform any session or evidence repair only through a separately approved action."
      : report.nextAction
  };
}

function scanSource(source: SessionSanitizerSource, auditKey: string): SessionSanitizerFinding[] {
  const findings: SessionSanitizerFinding[] = [];
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of source.text.matchAll(pattern.regex)) {
      const rawValue = match[0] ?? "";
      if (!rawValue) continue;
      const redactedValue = pattern.redactedValue(rawValue);
      findings.push({
        sourceRef: source.sourceRef,
        patternClass: pattern.patternClass,
        confidence: pattern.confidence,
        redactedValue,
        evidencePreview: `${pattern.patternClass} detected; surrounding source text omitted from public-safe evidence.`,
        fingerprint: fingerprint(rawValue, auditKey),
        suggestedRepair: pattern.suggestedRepair
      });
    }
  }
  return findings;
}

function repairChecklist(finding: SessionSanitizerFinding): string[] {
  const common = [
    "Review the source ref locally without copying raw transcript text into public evidence.",
    "Confirm whether the redacted finding represents a real secret or private local detail.",
    "Keep the fingerprint and source ref as the public tracking handle; do not paste the raw value."
  ];
  if (finding.patternClass === "local_path") {
    return [
      ...common,
      "Replace shareable evidence with a source ref or redacted path marker.",
      "Re-run the sanitizer and attach only the updated public-safe report."
    ];
  }
  return [
    ...common,
    "Rotate or invalidate the credential if it was real.",
    "Re-run the sanitizer and attach only the updated public-safe report."
  ];
}

function assertSupportedSourceRef(sourceRef: string): void {
  const matchingPrefix = SUPPORTED_SOURCE_REF_PREFIXES.find((prefix) => sourceRef.startsWith(prefix));
  const sourceId = matchingPrefix ? sourceRef.slice(matchingPrefix.length) : "";
  if (!matchingPrefix || !/^[A-Za-z0-9._:-]{1,160}$/.test(sourceId)) {
    throw new Error(`sourceRef must use a supported source prefix: ${SUPPORTED_SOURCE_REF_PREFIXES.join(", ")}`);
  }
}

function fingerprint(value: string, auditKey: string): string {
  return `hmac-sha256:${createHmac("sha256", auditKey).update(value).digest("hex")}`;
}
