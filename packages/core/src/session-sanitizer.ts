import { createHash } from "node:crypto";

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
    regex: /\bBearer\s+[A-Za-z0-9._-]{16,}/gi,
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
    regex: /(?:\/Users\/[^/\s"'`)]+|\/Volumes\/[^/\s"'`)]+|\/private\/var\/[^\s"'`)]+)(?:\/[^\s"'`)]+)+/g,
    redactedValue: () => "~/<redacted-path>",
    suggestedRepair: "Replace the local path with a source ref or redacted path before sharing evidence."
  }
];

export function createSessionSanitizerReport(options: {
  sources: SessionSanitizerSource[];
  now?: string;
}): SessionSanitizerReport {
  for (const source of options.sources) assertSupportedSourceRef(source.sourceRef);
  const findings = options.sources.flatMap((source) => scanSource(source));

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

function scanSource(source: SessionSanitizerSource): SessionSanitizerFinding[] {
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
        evidencePreview: redactedPreview(source.text, match.index ?? 0, rawValue, redactedValue),
        fingerprint: fingerprint(rawValue),
        suggestedRepair: pattern.suggestedRepair
      });
    }
  }
  return findings;
}

function assertSupportedSourceRef(sourceRef: string): void {
  if (!SUPPORTED_SOURCE_REF_PREFIXES.some((prefix) => sourceRef.startsWith(prefix))) {
    throw new Error(`sourceRef must use a supported source prefix: ${SUPPORTED_SOURCE_REF_PREFIXES.join(", ")}`);
  }
}

function redactedPreview(text: string, index: number, rawValue: string, redactedValue: string): string {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const lineEndIndex = text.indexOf("\n", index);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const line = text.slice(lineStart, lineEnd);
  if (rawValue.includes("\n")) return redactedValue;
  return line.replace(rawValue, redactedValue);
}

function fingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
