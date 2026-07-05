import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export type QaLabRubricVersion = "real-product-v1";
export type QaLabReviewSeverity = "P0" | "P1" | "P2" | "P3";
export type QaLabAdversarialLens = "safety" | "retrieval" | "packaging" | "claims" | "agentUsability";

export type QaLabReviewOptions = {
  runPath: string;
  evidenceDir: string;
  now?: string;
};

export type QaLabJudgeReviewOptions = QaLabReviewOptions & {
  rubricVersion: QaLabRubricVersion;
};

export type QaLabAdversarialReviewOptions = QaLabReviewOptions & {
  lenses: QaLabAdversarialLens[];
};

export type QaLabReviewBlocker = {
  severity: QaLabReviewSeverity;
  code: string;
  source: string;
  detail: string;
};

export type QaLabDimensionName = "privacy" | "safety" | "retrieval" | "packaging" | "claims" | "agentUsability";

export type QaLabJudgeReviewReport = {
  schema: "lco.qaLab.judgeReview.v1";
  ok: boolean;
  gaReady: boolean;
  generatedAt: string;
  rubricVersion: QaLabRubricVersion;
  runRef: string | null;
  summary: {
    packageVersion: string | null;
    candidateSha: string | null;
    claimScope: string | null;
    scenarioCount: number | null;
    failedScenarioCount: number | null;
  };
  scores: Record<QaLabDimensionName, number | null>;
  averageScore: number | null;
  thresholds: {
    privacyRequired: 5;
    safetyRequired: 5;
    otherDimensionMinimum: 4;
    averageMinimum: 4.5;
  };
  blockers: QaLabReviewBlocker[];
  warnings: QaLabReviewBlocker[];
  actionsVerified: {
    sanitizedRunLoaded: boolean;
    rubricApplied: true;
    noModelCalled: true;
    privacySafetyGateApplied: true;
    gaAverageGateApplied: true;
  };
  actionsPerformed: RestrictedActions;
  privateDataExclusions: string[];
  proofBoundary: string;
};

export type QaLabAdversarialFinding = {
  severity: QaLabReviewSeverity;
  code: string;
  detail: string;
};

export type QaLabAdversarialLensResult = {
  lens: QaLabAdversarialLens;
  pass: boolean;
  findings: QaLabAdversarialFinding[];
  blockerCount: number;
};

export type QaLabAdversarialReviewReport = {
  schema: "lco.qaLab.adversarialReview.v1";
  ok: boolean;
  generatedAt: string;
  runRef: string | null;
  requestedLenses: QaLabAdversarialLens[];
  lensResults: Partial<Record<QaLabAdversarialLens, QaLabAdversarialLensResult>>;
  blockersBySeverity: Record<QaLabReviewSeverity, number>;
  blockers: QaLabReviewBlocker[];
  warnings: QaLabReviewBlocker[];
  actionsVerified: {
    sanitizedRunLoaded: boolean;
    selectedLensesApplied: true;
    noModelCalled: true;
    rawEvidenceEchoSuppressed: true;
  };
  actionsPerformed: RestrictedActions;
  privateDataExclusions: string[];
  proofBoundary: string;
};

type JsonRecord = Record<string, unknown>;
type RestrictedActions = {
  npmPublished: false;
  githubReleaseCreated: false;
  liveCodexControlRun: false;
  desktopGuiActionRun: false;
  rawTranscriptRead: false;
  screenshotCaptured: false;
};

type LoadedRun = {
  value: JsonRecord | null;
  runRef: string | null;
  blockers: QaLabReviewBlocker[];
  warnings: QaLabReviewBlocker[];
};

const DIMENSIONS: QaLabDimensionName[] = ["privacy", "safety", "retrieval", "packaging", "claims", "agentUsability"];
export const DEFAULT_QA_LAB_ADVERSARIAL_LENSES: QaLabAdversarialLens[] = ["safety", "retrieval", "packaging", "claims", "agentUsability"];
const PRIVATE_DATA_EXCLUSIONS = [
  "raw paths",
  "raw prompts",
  "SQLite or JSONL artifacts",
  "screenshots or media",
  "tokens, cookies, or credentials",
  "raw logs",
  "customer data"
];
const RESTRICTED_ACTION_KEYS = new Set([
  "npmPublished",
  "githubReleaseCreated",
  "liveCodexControlRun",
  "desktopGuiActionRun",
  "rawTranscriptRead",
  "screenshotCaptured",
  "screenshotsCaptured"
]);
const SECRET_LIKE_PATTERN = /(npm_[A-Za-z0-9]{20,}|bearer\s+[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const RAW_ARTIFACT_VALUE_PATTERN = /(?:\/(?:[^"'\s/]+\/)+[^"'\s]*|~\/[^"'\s]+|[A-Za-z]:\\(?:[^"'\s\\]+\\)+[^"'\s]*).*\.(?:jsonl|sqlite|sqlite-wal|sqlite-shm|db|png|jpg|jpeg|gif|webp|mp4|mov|webm|log)(?:["'\s]|$)/i;

export function createQaLabJudgeReviewReport(options: QaLabJudgeReviewOptions): QaLabJudgeReviewReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const loaded = loadQaRun(options.runPath, evidenceDir);
  const blockers = [...loaded.blockers];
  const warnings = [...loaded.warnings];
  const scores = buildScores(loaded.value, blockers);
  addJudgeThresholdBlockers(scores, blockers);
  const averageScore = average(scores);
  if (averageScore !== null && averageScore < 4.5) {
    addBlocker(blockers, "P1", "average_below_ga_threshold", "rubric", "Average score must be at least 4.5 for GA.");
  }
  const gaReady = blockers.filter((blocker) => blocker.severity !== "P3").length === 0;
  const report: QaLabJudgeReviewReport = {
    schema: "lco.qaLab.judgeReview.v1",
    ok: gaReady,
    gaReady,
    generatedAt: options.now ?? new Date().toISOString(),
    rubricVersion: options.rubricVersion,
    runRef: loaded.runRef,
    summary: runSummary(loaded.value),
    scores,
    averageScore,
    thresholds: {
      privacyRequired: 5,
      safetyRequired: 5,
      otherDimensionMinimum: 4,
      averageMinimum: 4.5
    },
    blockers: uniqueBlockers(blockers),
    warnings: uniqueBlockers(warnings),
    actionsVerified: {
      sanitizedRunLoaded: Boolean(loaded.value),
      rubricApplied: true,
      noModelCalled: true,
      privacySafetyGateApplied: true,
      gaAverageGateApplied: true
    },
    actionsPerformed: noActions(),
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS,
    proofBoundary: "Deterministic rule-based review over an existing sanitized QA Lab run only; no model call, raw evidence read, live Codex control, GUI mutation, npm publish, or GitHub Release creation."
  };
  writeFileSync(join(evidenceDir, "judge-review.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function createQaLabAdversarialReviewReport(options: QaLabAdversarialReviewOptions): QaLabAdversarialReviewReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const loaded = loadQaRun(options.runPath, evidenceDir);
  const blockers = [...loaded.blockers];
  const warnings = [...loaded.warnings];
  const lensResults: Partial<Record<QaLabAdversarialLens, QaLabAdversarialLensResult>> = {};
  for (const lens of options.lenses) {
    const result = buildLensResult(lens, loaded.value);
    lensResults[lens] = result;
    for (const finding of result.findings) {
      if (finding.severity === "P3") {
        warnings.push({ ...finding, source: lens });
      } else {
        blockers.push({ ...finding, source: lens });
      }
    }
    if (!result.pass && result.blockerCount === 0) {
      addBlocker(blockers, "P1", `${lens}_lens_failed`, lens, "Adversarial lens failed without a more specific sanitized finding.");
    }
  }
  const dedupedBlockers = uniqueBlockers(blockers);
  const report: QaLabAdversarialReviewReport = {
    schema: "lco.qaLab.adversarialReview.v1",
    ok: dedupedBlockers.filter((blocker) => blocker.severity !== "P3").length === 0,
    generatedAt: options.now ?? new Date().toISOString(),
    runRef: loaded.runRef,
    requestedLenses: options.lenses,
    lensResults,
    blockersBySeverity: countBySeverity(dedupedBlockers),
    blockers: dedupedBlockers,
    warnings: uniqueBlockers(warnings),
    actionsVerified: {
      sanitizedRunLoaded: Boolean(loaded.value),
      selectedLensesApplied: true,
      noModelCalled: true,
      rawEvidenceEchoSuppressed: true
    },
    actionsPerformed: noActions(),
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS,
    proofBoundary: "Deterministic adversarial review over sanitized QA Lab report fields only; findings are normalized and raw evidence fields are not echoed."
  };
  writeFileSync(join(evidenceDir, "adversarial-review.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function loadQaRun(runPath: string, evidenceDir: string): LoadedRun {
  const blockers: QaLabReviewBlocker[] = [];
  const warnings: QaLabReviewBlocker[] = [];
  const resolved = resolve(runPath);
  const runRef = evidenceRef(resolved, evidenceDir);
  if (!isPathInside(resolved, evidenceDir)) {
    addBlocker(blockers, "P0", "run_outside_evidence_dir", "run", "QA Lab run must stay inside the evidence directory.");
    return { value: null, runRef, blockers, warnings };
  }
  if (!existsSync(resolved)) {
    addBlocker(blockers, "P1", "run_missing", "run", "QA Lab run JSON is missing.");
    return { value: null, runRef, blockers, warnings };
  }
  if (lstatSync(resolved).isSymbolicLink()) {
    addBlocker(blockers, "P0", "run_symlink_disallowed", "run", "QA Lab run must be a regular file inside the evidence directory, not a symlink.");
    return { value: null, runRef, blockers, warnings };
  }
  const realEvidenceDir = realpathSync(evidenceDir);
  const realResolved = realpathSync(resolved);
  if (!isPathInside(realResolved, realEvidenceDir)) {
    addBlocker(blockers, "P0", "run_outside_evidence_dir", "run", "QA Lab run must stay inside the evidence directory after resolving symlinks.");
    return { value: null, runRef, blockers, warnings };
  }
  try {
    const parsed = JSON.parse(readFileSync(realResolved, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      addBlocker(blockers, "P1", "run_invalid_json_object", "run", "QA Lab run must be a JSON object.");
      return { value: null, runRef, blockers, warnings };
    }
    if (parsed.publicSafe !== true) {
      addBlocker(blockers, "P0", "run_not_public_safe", "run", "QA Lab run must declare publicSafe: true.");
    }
    if (hasRestrictedAction(parsed)) {
      addBlocker(blockers, "P0", "restricted_action_performed", "run", "QA Lab run indicates a restricted action was performed.");
    }
    if (containsUnsafeValue(parsed)) {
      addBlocker(blockers, "P0", "unsafe_evidence_value", "run", "QA Lab run contains raw paths, raw prompts, raw logs, media, SQLite/JSONL, credentials, or customer data.");
    }
    return { value: parsed, runRef, blockers, warnings };
  } catch {
    addBlocker(blockers, "P1", "run_invalid_json", "run", "QA Lab run is not valid JSON.");
    return { value: null, runRef, blockers, warnings };
  }
}

function buildScores(run: JsonRecord | null, blockers: QaLabReviewBlocker[]): Record<QaLabDimensionName, number | null> {
  const scores = {} as Record<QaLabDimensionName, number | null>;
  for (const dimension of DIMENSIONS) {
    const value = readPath(run, ["dimensions", dimension, "score"]);
    scores[dimension] = typeof value === "number" && Number.isFinite(value) ? value : null;
    if (scores[dimension] === null) {
      addBlocker(blockers, "P1", `${dimension}_score_missing`, "rubric", `${dimension} score is missing from sanitized QA Lab run.`);
    } else if (scores[dimension]! < 0 || scores[dimension]! > 5) {
      addBlocker(blockers, "P1", `${dimension}_score_invalid`, "rubric", `${dimension} score must be between 0 and 5.`);
    }
  }
  return scores;
}

function addJudgeThresholdBlockers(scores: Record<QaLabDimensionName, number | null>, blockers: QaLabReviewBlocker[]): void {
  if (scores.privacy !== null && scores.privacy < 5) {
    addBlocker(blockers, "P0", "privacy_below_ga_threshold", "privacy", "Privacy score must be 5 for GA.");
  }
  if (scores.safety !== null && scores.safety < 5) {
    addBlocker(blockers, "P0", "safety_below_ga_threshold", "safety", "Safety score must be 5 for GA.");
  }
  for (const dimension of DIMENSIONS.filter((item) => item !== "privacy" && item !== "safety")) {
    if (scores[dimension] !== null && scores[dimension]! < 4) {
      addBlocker(blockers, "P1", `${dimension}_below_minimum`, dimension, `${dimension} score must be at least 4 for GA.`);
    }
  }
}

function buildLensResult(lens: QaLabAdversarialLens, run: JsonRecord | null): QaLabAdversarialLensResult {
  const lensRecord = readPath(run, ["adversarial", lens]);
  const passField = isRecord(lensRecord) ? lensRecord.pass : undefined;
  const rawFindings = isRecord(lensRecord) && Array.isArray(lensRecord.findings) ? lensRecord.findings : [];
  const findings = rawFindings.filter(isRecord).map((finding) => normalizeFinding(finding));
  const blockerCount = findings.filter((finding) => finding.severity !== "P3").length;
  return {
    lens,
    pass: passField === true && blockerCount === 0,
    findings,
    blockerCount
  };
}

function normalizeFinding(finding: JsonRecord): QaLabAdversarialFinding {
  const severity = normalizeSeverity(finding.severity);
  const code = typeof finding.code === "string" && finding.code.trim() ? safeCode(finding.code) : "adversarial_finding";
  const rawDetail = typeof finding.detail === "string" && finding.detail.trim() ? finding.detail : "Adversarial finding was recorded.";
  return {
    severity,
    code,
    detail: safeDetail(rawDetail)
  };
}

function runSummary(run: JsonRecord | null): QaLabJudgeReviewReport["summary"] {
  const passedScenarios = numberOrNull(readPath(run, ["summary", "passedScenarios"]));
  const failedScenarios = numberOrNull(readPath(run, ["summary", "failedScenarios"]));
  return {
    packageVersion: stringOrNull(readPath(run, ["packageVersion"])),
    candidateSha: stringOrNull(readPath(run, ["candidateSha"])),
    claimScope: stringOrNull(readPath(run, ["summary", "claimScope"])),
    scenarioCount: passedScenarios !== null || failedScenarios !== null
      ? (passedScenarios ?? 0) + (failedScenarios ?? 0)
      : null,
    failedScenarioCount: failedScenarios
  };
}

function average(scores: Record<QaLabDimensionName, number | null>): number | null {
  const values = DIMENSIONS.map((dimension) => scores[dimension]);
  if (values.some((value) => value === null)) return null;
  const numericValues = values as number[];
  return Math.round((numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length) * 100) / 100;
}

function containsUnsafeValue(value: unknown): boolean {
  if (typeof value === "string") {
    return SECRET_LIKE_PATTERN.test(value) || RAW_ARTIFACT_VALUE_PATTERN.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsUnsafeValue(item));
  if (isRecord(value)) return Object.values(value).some((item) => containsUnsafeValue(item));
  return false;
}

function hasRestrictedAction(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasRestrictedAction(item));
  if (!isRecord(value)) return false;
  for (const [key, item] of Object.entries(value)) {
    if (RESTRICTED_ACTION_KEYS.has(key) && item === true) return true;
    if (hasRestrictedAction(item)) return true;
  }
  return false;
}

function safeDetail(detail: string): string {
  if (SECRET_LIKE_PATTERN.test(detail) || RAW_ARTIFACT_VALUE_PATTERN.test(detail)) {
    return "Redacted unsafe evidence detail.";
  }
  return detail.slice(0, 240);
}

function safeCode(code: string): string {
  return code.trim().replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) || "adversarial_finding";
}

function countBySeverity(blockers: QaLabReviewBlocker[]): Record<QaLabReviewSeverity, number> {
  return {
    P0: blockers.filter((blocker) => blocker.severity === "P0").length,
    P1: blockers.filter((blocker) => blocker.severity === "P1").length,
    P2: blockers.filter((blocker) => blocker.severity === "P2").length,
    P3: blockers.filter((blocker) => blocker.severity === "P3").length
  };
}

function addBlocker(blockers: QaLabReviewBlocker[], severity: QaLabReviewSeverity, code: string, source: string, detail: string): void {
  blockers.push({ severity, code, source, detail });
}

function uniqueBlockers(blockers: QaLabReviewBlocker[]): QaLabReviewBlocker[] {
  const seen = new Set<string>();
  const result: QaLabReviewBlocker[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.severity}:${blocker.code}:${blocker.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(blocker);
  }
  return result;
}

function normalizeSeverity(value: unknown): QaLabReviewSeverity {
  if (value === "P0" || value === "P1" || value === "P2" || value === "P3") return value;
  return "P2";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && !containsUnsafeValue(value) ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readPath(record: JsonRecord | null, path: string[]): unknown {
  let cursor: unknown = record;
  for (const part of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function evidenceRef(path: string, evidenceDir: string): string {
  if (isPathInside(path, evidenceDir)) return relative(evidenceDir, path) || basename(path);
  return basename(path);
}

function isPathInside(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function noActions(): RestrictedActions {
  return {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false,
    rawTranscriptRead: false,
    screenshotCaptured: false
  };
}
