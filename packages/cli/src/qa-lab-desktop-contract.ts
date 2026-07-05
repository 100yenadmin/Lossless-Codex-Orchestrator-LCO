import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

export type QaLabDesktopContractOptions = {
  readinessReport?: string | JsonRecord;
  actionBoundScratchProof?: string | JsonRecord;
  packageVersion?: string;
  candidateSha?: string;
  now?: string;
};

export type QaLabDesktopContractBlocker = {
  severity: "P0" | "P1" | "P2" | "P3";
  code: string;
  source: string;
  detail: string;
};

export type QaLabDesktopContractReport = {
  schema: "lco.qaLab.desktopContract.v1";
  ok: boolean;
  desktopContractReady: boolean;
  generatedAt: string;
  packageName: "lossless-openclaw-orchestrator";
  packageVersion: string | null;
  candidateSha: string | null;
  publicSafe: true;
  evidenceIndex: {
    readinessReport: QaLabDesktopContractEvidenceEntry;
    actionBoundScratchProof: QaLabDesktopContractEvidenceEntry;
  };
  metadataProof: {
    cliReady: boolean;
    appServerReady: boolean;
    desktopVisible: boolean;
    fallbackBackendReady: boolean;
    codexDesktopReady: boolean;
  };
  screenshotVideoProof: {
    screenshotProvided: boolean;
    videoProvided: boolean;
    screenshotOrVideoProofAccepted: false;
  };
  actionsPerformed: {
    textEditScratchActionRun: boolean;
    genericGuiMutationRun: false;
    codexGuiMutationRun: false;
    liveCodexControlRun: false;
  };
  allowedActionBoundScratchProof: boolean;
  genericGuiMutationClaimAccepted: false;
  codexGuiMutationClaimAccepted: false;
  blockers: QaLabDesktopContractBlocker[];
  warnings: QaLabDesktopContractWarning[];
  privateDataExclusions: string[];
  proofBoundary: string;
  nextSafeActions: string[];
};

export type QaLabDesktopContractEvidenceEntry = {
  status: "ready" | "missing" | "invalid" | "unsafe" | "blocked" | "not_provided";
  evidenceRef: string | null;
  blockerCodes: string[];
};

export type QaLabDesktopContractWarning = {
  code: string;
  source: string;
  detail: string;
};

type JsonRecord = Record<string, unknown>;

type LoadedEvidence = {
  source: "readinessReport" | "actionBoundScratchProof";
  evidenceRef: string | null;
  value: JsonRecord | null;
  missing: boolean;
  invalid: boolean;
  optional: boolean;
};

const PACKAGE_NAME = "lossless-openclaw-orchestrator";
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const MAX_EVIDENCE_SCAN_DEPTH = 64;
const SECRET_LIKE_PATTERN = /(npm_[A-Za-z0-9]{20,}|bearer[:\s]+[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|-----BEGIN\s+[A-Z ]*PRIVATE KEY-----)/i;
const RAW_ARTIFACT_VALUE_PATTERN = /(?:(?:\/(?:[^"'\s/]+\/)+[^"'\s]*|~\/[^"'\s]+|[A-Za-z]:\\(?:[^"'\s\\]+\\)+[^"'\s]*|(?:\.\.[/\\])+(?:[^"'\s/\\]+[/\\])*[^"'\s/\\]+).*)\.(?:jsonl|sqlite|sqlite-wal|sqlite-shm|db|png|jpg|jpeg|gif|webp|mp4|mov|webm)(?:["'\s]|$)/i;
const RESTRICTED_ACTION_KEYS = new Set([
  "desktopGuiActionRun",
  "genericGuiMutationRun",
  "codexGuiMutationRun",
  "liveCodexControlRun",
  "codexLiveControlRun",
  "screenshotCaptured",
  "screenshotsCaptured",
  "screenshotTaken",
  "videoCaptured",
  "rawTranscriptRead"
]);
const RAW_PRIVATE_KEYS = new Set([
  "rawWindowText",
  "windowText",
  "rawTranscript",
  "rawTranscriptText",
  "customerData",
  "token",
  "cookie"
]);
const PRIVATE_DATA_EXCLUSIONS = [
  "raw local paths",
  "screenshots or videos",
  "raw window text",
  "raw Codex transcripts",
  "SQLite DBs",
  "JSONL transcripts",
  "tokens, credentials, API keys, cookies",
  "customer data"
];

export function createQaLabDesktopContractReport(options: QaLabDesktopContractOptions = {}): QaLabDesktopContractReport {
  const blockers: QaLabDesktopContractBlocker[] = [];
  const warnings: QaLabDesktopContractWarning[] = [];
  const evidenceIndex = {} as QaLabDesktopContractReport["evidenceIndex"];
  const readiness = loadEvidence("readinessReport", options.readinessReport, false);
  const scratch = loadEvidence("actionBoundScratchProof", options.actionBoundScratchProof, true);

  for (const evidence of [readiness, scratch]) {
    const start = blockers.length;
    validateLoadedEvidence(evidence, blockers, warnings, options);
    evidenceIndex[evidence.source] = {
      status: evidenceStatus(evidence, blockers.slice(start).map((blocker) => blocker.code)),
      evidenceRef: evidence.evidenceRef,
      blockerCodes: blockers.slice(start).map((blocker) => blocker.code)
    };
  }

  if (options.candidateSha && !SHA_PATTERN.test(options.candidateSha)) {
    addBlocker(blockers, "P1", "candidate_sha_invalid", "desktopContract", "Candidate SHA must be a 40-character hexadecimal commit SHA.");
  }

  const metadataProof = extractMetadataProof(readiness.value);
  if (!metadataProof.cliReady) addBlocker(blockers, "P1", "cli_readiness_missing", "readinessReport", "CLI readiness metadata is missing or false.");
  if (!metadataProof.appServerReady) addBlocker(blockers, "P1", "app_server_readiness_missing", "readinessReport", "App-server readiness metadata is missing or false.");
  if (!metadataProof.desktopVisible) addBlocker(blockers, "P1", "desktop_visibility_missing", "readinessReport", "Desktop visibility metadata is missing or false.");
  if (!metadataProof.fallbackBackendReady) addBlocker(blockers, "P1", "fallback_backend_readiness_missing", "readinessReport", "Desktop fallback backend readiness metadata is missing or false.");
  if (!metadataProof.codexDesktopReady) addBlocker(blockers, "P1", "codex_desktop_readiness_missing", "readinessReport", "Codex Desktop readiness metadata is missing or false.");

  const screenshotProvided = containsFlag(readiness.value, ["screenshotIncluded", "screenshotCaptured", "screenshotsCaptured"])
    || containsFlag(scratch.value, ["screenshotIncluded", "screenshotCaptured", "screenshotsCaptured"]);
  const videoProvided = containsFlag(readiness.value, ["videoIncluded", "videoCaptured"])
    || containsFlag(scratch.value, ["videoIncluded", "videoCaptured"]);
  if (screenshotProvided || videoProvided) {
    addBlocker(blockers, "P0", "screenshot_or_video_not_contract_proof", "desktopContract", "Desktop visibility/readiness is metadata proof only; screenshots and videos are not accepted by this contract.");
  }

  if (claimsGenericGuiMutation(readiness.value) || claimsGenericGuiMutation(scratch.value)) {
    addBlocker(blockers, "P0", "generic_gui_mutation_claim_unproved", "desktopContract", "Generic GUI mutation claims require a later explicit proof lane and are not accepted here.");
  }
  if (claimsCodexGuiMutation(readiness.value) || claimsCodexGuiMutation(scratch.value)) {
    addBlocker(blockers, "P0", "codex_gui_mutation_claim_unproved", "desktopContract", "Codex GUI mutation claims require matching explicit evidence and are not accepted by this first slice.");
  }

  const scratchBlockerStart = blockers.length;
  const scratchOk = validateScratchProof(scratch, blockers);
  const scratchBlockerCodes = blockers.slice(scratchBlockerStart).map((blocker) => blocker.code);
  evidenceIndex.actionBoundScratchProof.blockerCodes.push(...scratchBlockerCodes);
  if (scratchBlockerCodes.length > 0 && evidenceIndex.actionBoundScratchProof.status !== "unsafe") {
    evidenceIndex.actionBoundScratchProof.status = "blocked";
  }

  const dedupedBlockers = uniqueBlockers(blockers);
  refreshEvidenceIndexStatuses(evidenceIndex, dedupedBlockers);
  const desktopContractReady = dedupedBlockers.filter((blocker) => blocker.severity !== "P3").length === 0;
  const readinessCandidateSha = readString(readiness.value, "candidateSha");
  return {
    schema: "lco.qaLab.desktopContract.v1",
    ok: desktopContractReady,
    desktopContractReady,
    generatedAt: options.now ?? new Date().toISOString(),
    packageName: PACKAGE_NAME,
    packageVersion: options.packageVersion ?? readString(readiness.value, "packageVersion") ?? null,
    candidateSha: options.candidateSha ?? (readinessCandidateSha && SHA_PATTERN.test(readinessCandidateSha) ? readinessCandidateSha : null),
    publicSafe: true,
    evidenceIndex,
    metadataProof,
    screenshotVideoProof: {
      screenshotProvided,
      videoProvided,
      screenshotOrVideoProofAccepted: false
    },
    actionsPerformed: {
      textEditScratchActionRun: scratchOk,
      genericGuiMutationRun: false,
      codexGuiMutationRun: false,
      liveCodexControlRun: false
    },
    allowedActionBoundScratchProof: scratchOk,
    genericGuiMutationClaimAccepted: false,
    codexGuiMutationClaimAccepted: false,
    blockers: dedupedBlockers,
    warnings,
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS,
    proofBoundary: "Aggregates sanitized desktop contract evidence only. Desktop visibility/readiness is metadata proof, not screenshot/video proof. An explicit action-bound TextEdit scratch proof may show that one approved scratch action executed, but it does not prove generic GUI mutation, Codex GUI mutation, live Codex control, customer account mutation, or release readiness.",
    nextSafeActions: nextSafeActions(dedupedBlockers)
  };
}

function loadEvidence(
  source: LoadedEvidence["source"],
  input: string | JsonRecord | undefined,
  optional: boolean
): LoadedEvidence {
  if (!input) {
    return { source, evidenceRef: null, value: null, missing: true, invalid: false, optional };
  }
  if (typeof input !== "string") {
    return { source, evidenceRef: "inline", value: isRecord(input) ? input : null, missing: false, invalid: !isRecord(input), optional };
  }
  const evidenceRef = basename(input);
  if (!existsSync(input)) {
    return { source, evidenceRef, value: null, missing: true, invalid: false, optional };
  }
  try {
    const parsed = JSON.parse(readFileSync(input, "utf8")) as unknown;
    return { source, evidenceRef, value: isRecord(parsed) ? parsed : null, missing: false, invalid: !isRecord(parsed), optional };
  } catch {
    return { source, evidenceRef, value: null, missing: false, invalid: true, optional };
  }
}

function validateLoadedEvidence(
  evidence: LoadedEvidence,
  blockers: QaLabDesktopContractBlocker[],
  warnings: QaLabDesktopContractWarning[],
  options: QaLabDesktopContractOptions
): void {
  if (evidence.missing) {
    if (evidence.optional) {
      warnings.push({ code: `${evidence.source}_not_provided`, source: evidence.source, detail: `${titleForSource(evidence.source)} was not provided.` });
    } else {
      addBlocker(blockers, "P1", `${evidence.source}_missing`, evidence.source, `${titleForSource(evidence.source)} is missing.`);
    }
    return;
  }
  if (evidence.invalid || !evidence.value) {
    addBlocker(blockers, "P1", `${evidence.source}_invalid_json`, evidence.source, `${titleForSource(evidence.source)} is not a valid JSON object.`);
    return;
  }
  if (evidence.value.publicSafe !== true) {
    addBlocker(blockers, "P0", `${evidence.source}_not_public_safe`, evidence.source, `${titleForSource(evidence.source)} must declare publicSafe: true.`);
  }
  if (containsUnsafeValue(evidence.value)) {
    addBlocker(blockers, "P0", "unsafe_evidence_value", evidence.source, `${titleForSource(evidence.source)} contains a secret-like value, raw local path, screenshot/media artifact path, SQLite/JSONL path, or private raw value.`);
  }
  if (hasRestrictedAction(evidence.value)) {
    addBlocker(blockers, "P0", "restricted_action_claimed", evidence.source, `${titleForSource(evidence.source)} claims a restricted action that this contract does not perform or accept.`);
  }
  if (options.packageVersion && typeof evidence.value.packageVersion === "string" && evidence.value.packageVersion !== options.packageVersion) {
    addBlocker(blockers, "P1", "package_version_mismatch", evidence.source, `${titleForSource(evidence.source)} targets a different package version.`);
  }
  if (options.candidateSha && typeof evidence.value.candidateSha === "string" && evidence.value.candidateSha !== options.candidateSha) {
    addBlocker(blockers, "P1", "candidate_sha_mismatch", evidence.source, `${titleForSource(evidence.source)} targets a different candidate SHA.`);
  }
  if (typeof evidence.value.candidateSha === "string" && !SHA_PATTERN.test(evidence.value.candidateSha)) {
    addBlocker(blockers, "P1", "candidate_sha_invalid", evidence.source, `${titleForSource(evidence.source)} candidate SHA is not a 40-character hexadecimal commit SHA.`);
  }
  if (Array.isArray(evidence.value.blockers) && evidence.value.blockers.length > 0) {
    addBlocker(blockers, "P1", `${evidence.source}_has_blockers`, evidence.source, `${titleForSource(evidence.source)} contains upstream blockers.`);
  }
}

function extractMetadataProof(value: JsonRecord | null): QaLabDesktopContractReport["metadataProof"] {
  return {
    cliReady: booleanWithAbsentFallback(value, ["cliReady"], [
      () => truthyPath(value, ["qaLabToolCoverageReady"]),
      () => truthyPath(value, ["ok"])
    ]),
    appServerReady: booleanWithAbsentFallback(value, ["appServerReady"], [
      () => truthyPath(value, ["gatewayReady"]),
      () => readPath(value, ["configuredGateway", "gatewaySetupClassification"]) === "ready"
    ]),
    desktopVisible: truthyPath(value, ["desktopVisible"]) || truthyPath(value, ["desktopVisibility", "desktopVisible"]),
    fallbackBackendReady: truthyPath(value, ["fallbackBackendReady"]) || truthyPath(value, ["desktopVisibility", "fallbackBackendReady"]),
    codexDesktopReady: truthyPath(value, ["codexDesktopReady"]) || truthyPath(value, ["desktopVisibility", "codexDesktopReady"])
  };
}

function validateScratchProof(evidence: LoadedEvidence, blockers: QaLabDesktopContractBlocker[]): boolean {
  if (evidence.optional && evidence.missing) return false;
  if (!evidence.value || evidence.invalid || evidence.missing) return false;
  const start = blockers.length;
  if (evidence.value.publicSafe !== true) {
    addBlocker(blockers, "P0", "scratch_proof_not_public_safe", evidence.source, "Action-bound scratch proof must declare publicSafe: true.");
  }
  if (evidence.value.actionBound !== true) {
    addBlocker(blockers, "P1", "scratch_proof_not_action_bound", evidence.source, "Scratch proof must be explicitly action-bound.");
  }
  if (evidence.value.targetApp !== "TextEdit") {
    addBlocker(blockers, "P1", "scratch_proof_target_not_textedit", evidence.source, "Only TextEdit scratch proof is accepted by this contract.");
  }
  if (evidence.value.executed !== true) {
    addBlocker(blockers, "P1", "scratch_proof_not_executed", evidence.source, "Scratch proof must explicitly say the action executed before actionsPerformed can become true.");
  }
  if (containsFlag(evidence.value, ["rawWindowTextIncluded", "rawWindowText", "windowText"])) {
    addBlocker(blockers, "P0", "raw_window_text_not_public_safe", evidence.source, "Scratch proof must not include raw window text.");
  }
  if (containsFlag(evidence.value, ["rawTranscriptIncluded", "rawTranscriptRead", "sqliteIncluded", "jsonlIncluded"])) {
    addBlocker(blockers, "P0", "raw_private_artifact_not_public_safe", evidence.source, "Scratch proof must not include raw transcripts, SQLite, JSONL, or private artifacts.");
  }
  return blockers.length === start;
}

function containsUnsafeValue(value: unknown, key = "", depth = 0): boolean {
  if (depth > MAX_EVIDENCE_SCAN_DEPTH) return true;
  if (typeof value === "string") {
    return RAW_PRIVATE_KEYS.has(key)
      || SECRET_LIKE_PATTERN.test(value)
      || RAW_ARTIFACT_VALUE_PATTERN.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsUnsafeValue(item, key, depth + 1));
  if (isRecord(value)) return Object.entries(value).some(([childKey, childValue]) => containsUnsafeValue(childValue, childKey, depth + 1));
  return false;
}

function hasRestrictedAction(value: unknown, key = "", depth = 0): boolean {
  if (depth > MAX_EVIDENCE_SCAN_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => hasRestrictedAction(item, key, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([childKey, childValue]) => {
    if (RESTRICTED_ACTION_KEYS.has(childKey) && childValue === true) return true;
    return hasRestrictedAction(childValue, childKey, depth + 1);
  });
}

function claimsGenericGuiMutation(value: JsonRecord | null): boolean {
  return truthyPath(value, ["claims", "genericGuiMutation"])
    || truthyPath(value, ["genericGuiMutationClaimed"])
    || truthyPath(value, ["actionsPerformed", "genericGuiMutationRun"])
    || truthyPath(value, ["actionsPerformed", "desktopGuiActionRun"]);
}

function claimsCodexGuiMutation(value: JsonRecord | null): boolean {
  return truthyPath(value, ["claims", "codexGuiMutation"])
    || truthyPath(value, ["codexGuiMutationClaimed"])
    || truthyPath(value, ["actionsPerformed", "codexGuiMutationRun"])
    || truthyPath(value, ["actionsPerformed", "liveCodexControlRun"]);
}

function containsFlag(value: unknown, keys: string[], depth = 0): boolean {
  if (depth > MAX_EVIDENCE_SCAN_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => containsFlag(item, keys, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => {
    if (keys.includes(key)) return flagValueProvided(item);
    return containsFlag(item, keys, depth + 1);
  });
}

function flagValueProvided(value: unknown): boolean {
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return !["", "false", "0", "no", "none", "null", "undefined"].includes(normalized);
  }
  if (typeof value === "number") return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return value === true;
}

function refreshEvidenceIndexStatuses(
  evidenceIndex: QaLabDesktopContractReport["evidenceIndex"],
  blockers: QaLabDesktopContractBlocker[]
): void {
  for (const source of ["readinessReport", "actionBoundScratchProof"] as const) {
    const entry = evidenceIndex[source];
    const sourceCodes = blockers.filter((blocker) => blocker.source === source).map((blocker) => blocker.code);
    if (sourceCodes.length === 0) continue;
    entry.blockerCodes = [...new Set([...entry.blockerCodes, ...sourceCodes])];
    if (entry.status !== "unsafe") {
      entry.status = entry.blockerCodes.some((code) => code === "unsafe_evidence_value" || code.endsWith("_not_public_safe"))
        ? "unsafe"
        : "blocked";
    }
  }
}

function evidenceStatus(evidence: LoadedEvidence, blockerCodes: string[]): QaLabDesktopContractEvidenceEntry["status"] {
  if (evidence.optional && evidence.missing) return "not_provided";
  if (evidence.missing) return "missing";
  if (evidence.invalid) return "invalid";
  if (blockerCodes.includes("unsafe_evidence_value")) return "unsafe";
  if (blockerCodes.length > 0) return "blocked";
  return "ready";
}

function addBlocker(blockers: QaLabDesktopContractBlocker[], severity: QaLabDesktopContractBlocker["severity"], code: string, source: string, detail: string): void {
  blockers.push({ severity, code, source, detail });
}

function uniqueBlockers(blockers: QaLabDesktopContractBlocker[]): QaLabDesktopContractBlocker[] {
  const seen = new Set<string>();
  const result: QaLabDesktopContractBlocker[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.severity}:${blocker.code}:${blocker.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(blocker);
  }
  return result;
}

function readString(record: JsonRecord | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function truthyPath(record: JsonRecord | null, path: string[]): boolean {
  return readPath(record, path) === true;
}

function booleanWithAbsentFallback(record: JsonRecord | null, primaryPath: string[], fallbacks: Array<() => boolean>): boolean {
  const primary = readPath(record, primaryPath);
  if (typeof primary === "boolean") return primary;
  return fallbacks.some((fallback) => fallback());
}

function readPath(record: JsonRecord | null, path: string[]): unknown {
  let cursor: unknown = record;
  for (const part of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function titleForSource(source: LoadedEvidence["source"]): string {
  return source === "readinessReport" ? "Desktop readiness report" : "Action-bound TextEdit scratch proof";
}

function nextSafeActions(blockers: QaLabDesktopContractBlocker[]): string[] {
  if (blockers.length === 0) {
    return ["Captain can wire this module into the QA Lab CLI without widening the proof boundary."];
  }
  return [
    "Provide sanitized readiness metadata for CLI, app-server, Desktop visibility, fallback backend, and Codex Desktop readiness.",
    "Keep screenshots, videos, raw window text, raw paths, tokens, cookies, SQLite, JSONL, transcripts, and customer data out of desktop contract evidence.",
    "Use only explicit action-bound TextEdit scratch proof when claiming an executed desktop scratch action."
  ];
}
