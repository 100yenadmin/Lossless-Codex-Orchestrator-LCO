import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { normalizeReleaseClaimScope, releaseClaimScopeRequiresLiveControl, type ReleaseClaimScope } from "./release-claim-scope.js";

const REQUIRED_LIVE_CONTROL_ACTIONS = ["send", "resume", "steer", "interrupt"] as const;

export type ReleaseGaSmokeOptions = {
  evidenceDir: string;
  packageVersion: string;
  candidateSha: string;
  claimScope?: ReleaseClaimScope;
  releaseStatus?: string;
  releaseFinalizationStatus?: string;
  publishedSmoke?: string;
  dogfoodReport?: string;
  toolSmokeReport?: string;
  scenarioSweep?: string;
  scorecardSweep?: string;
  releasePreflight?: string;
  releaseBundle?: string;
  privacyScan?: string;
  qaLabRun?: string;
  qaLabToolCoverage?: string;
  qaLabLiveControlMatrix?: string;
  qaLabJudgeReview?: string;
  qaLabAdversarialReview?: string;
  allowSetupRequired?: boolean;
  now?: string;
};

export type ReleaseGaSmokeSeverity = "P0" | "P1" | "P2";
type ReleaseGaSmokeFindingSeverity = ReleaseGaSmokeSeverity | "P3";

export type ReleaseGaSmokeBlocker = {
  severity: ReleaseGaSmokeSeverity;
  code: string;
  source: string;
  detail: string;
};

export type ReleaseGaSmokeSetupBlocker = {
  code: string;
  source: string;
  detail: string;
  allowed: boolean;
};

export type ReleaseGaSmokeWarning = {
  code: string;
  source: string;
  detail: string;
};

export type ReleaseGaSmokeEvidenceStatus = "missing" | "invalid" | "unsafe" | "blocked" | "ready";

export type ReleaseGaSmokeEvidenceIndexEntry = {
  status: ReleaseGaSmokeEvidenceStatus;
  evidenceRef: string | null;
  blockerCodes: string[];
};

export type ReleaseGaSmokeReport = {
  schema: "lco.release.gaSmoke.v1";
  ok: boolean;
  gaSmokeReady: boolean;
  generatedAt: string;
  packageName: "lossless-openclaw-orchestrator";
  packageVersion: string;
  candidateSha: string;
  claimScope: ReleaseClaimScope;
  blockers: ReleaseGaSmokeBlocker[];
  setupBlockers: ReleaseGaSmokeSetupBlocker[];
  warnings: ReleaseGaSmokeWarning[];
  deferred: string[];
  actionsVerified: {
    releaseStatusReady: boolean;
    releaseFinalized: boolean;
    publishedPackageSmokeReady: boolean;
    dogfoodReady: boolean;
    toolSmokeReady: boolean;
    scenarioSweepReady: boolean;
    scorecardSweepReady: boolean;
    releasePreflightReady: boolean;
    releaseBundleReady: boolean;
    privacyScanReady: boolean;
    qaLabRunReady: boolean;
    qaLabToolCoverageReady: boolean;
    qaLabLiveControlMatrixReady: boolean;
    qaLabJudgeReviewReady: boolean;
    qaLabAdversarialReviewReady: boolean;
  };
  actionsPerformed: {
    npmPublished: false;
    githubReleaseCreated: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
  };
  evidenceIndex: Record<ReleaseGaSmokeSourceId, ReleaseGaSmokeEvidenceIndexEntry>;
  nextSafeCommands: string[];
  privateDataExclusions: string[];
  proofBoundary: string;
};

type ReleaseGaSmokeSourceId =
  | "releaseStatus"
  | "releaseFinalizationStatus"
  | "publishedPackageSmoke"
  | "openclawDogfood"
  | "openclawToolSmoke"
  | "scenarioSweep"
  | "scorecardSweep"
  | "releasePreflight"
  | "releaseBundle"
  | "privacyScan"
  | "qaLabRun"
  | "qaLabToolCoverage"
  | "qaLabLiveControlMatrix"
  | "qaLabJudgeReview"
  | "qaLabAdversarialReview";

type EvidenceSpec = {
  id: ReleaseGaSmokeSourceId;
  defaultFile: string;
  optionPath?: string;
};

type LoadedEvidence = {
  spec: EvidenceSpec;
  path: string;
  evidenceRef: string | null;
  value: JsonRecord | null;
  missing: boolean;
  invalid: boolean;
  outsideEvidenceDir: boolean;
};

type JsonRecord = Record<string, unknown>;

const PACKAGE_NAME = "lossless-openclaw-orchestrator";
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const SECRET_LIKE_PATTERN = /(npm_[A-Za-z0-9]{20,}|bearer\s+[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const SECRET_LIKE_KEY_PATTERN = /^(authorization|cookie|set-cookie|x-api-key|api[_-]?key|token)$/i;
const RAW_ARTIFACT_PATTERN = /\.(?:jsonl|jsonl\.gz|sqlite|sqlite-wal|sqlite-shm|db|db-journal|db-wal|db-shm|png|jpg|jpeg|gif|webp|mp4|mov|webm)$/i;
const RAW_OUTPUT_ARTIFACT_PATTERN = /(?:^|[/._-])(?:raw[-_]?.*|npm[-_]?output|npm[-_]?(?:stdout|stderr)|gateway[-_]?output|gateway[-_]?(?:stdout|stderr)|openclaw[-_]?output|openclaw[-_]?(?:stdout|stderr))(?:[/._-].*)?\.(?:txt|log|json)$/i;
const PRIVATE_FINDING_DETAIL_PATTERN = /\/Users\/|\/Volumes\/|\.jsonl\b|\.sqlite\b|Bearer\s+|npm_[A-Za-z0-9]{20,}|cookie/i;
const RESTRICTED_ACTION_KEYS = new Set([
  "npmPublished",
  "githubReleaseCreated",
  "liveCodexControlRun",
  "desktopGuiActionRun",
  "rawTranscriptRead"
]);

const EVIDENCE_SPECS: Array<Omit<EvidenceSpec, "optionPath"> & { optionKey: keyof Pick<
  ReleaseGaSmokeOptions,
  | "releaseStatus"
  | "releaseFinalizationStatus"
  | "publishedSmoke"
  | "dogfoodReport"
  | "toolSmokeReport"
  | "scenarioSweep"
  | "scorecardSweep"
  | "releasePreflight"
  | "releaseBundle"
  | "privacyScan"
  | "qaLabRun"
  | "qaLabToolCoverage"
  | "qaLabLiveControlMatrix"
  | "qaLabJudgeReview"
  | "qaLabAdversarialReview"
> }> = [
  { id: "releaseStatus", defaultFile: "release-status.json", optionKey: "releaseStatus" },
  { id: "releaseFinalizationStatus", defaultFile: "release-finalization-status.json", optionKey: "releaseFinalizationStatus" },
  { id: "publishedPackageSmoke", defaultFile: "published-package-smoke.json", optionKey: "publishedSmoke" },
  { id: "openclawDogfood", defaultFile: "openclaw-dogfood.json", optionKey: "dogfoodReport" },
  { id: "openclawToolSmoke", defaultFile: "openclaw-tool-smoke.json", optionKey: "toolSmokeReport" },
  { id: "scenarioSweep", defaultFile: "scenario-sweep.json", optionKey: "scenarioSweep" },
  { id: "scorecardSweep", defaultFile: "scorecard-sweep.json", optionKey: "scorecardSweep" },
  { id: "releasePreflight", defaultFile: "release-preflight.json", optionKey: "releasePreflight" },
  { id: "releaseBundle", defaultFile: "release-bundle.json", optionKey: "releaseBundle" },
  { id: "privacyScan", defaultFile: "privacy-scan.json", optionKey: "privacyScan" },
  { id: "qaLabRun", defaultFile: "qa-lab-run.json", optionKey: "qaLabRun" },
  { id: "qaLabToolCoverage", defaultFile: "tool-coverage.json", optionKey: "qaLabToolCoverage" },
  { id: "qaLabLiveControlMatrix", defaultFile: "live-control-matrix.json", optionKey: "qaLabLiveControlMatrix" },
  { id: "qaLabJudgeReview", defaultFile: "judge-review.json", optionKey: "qaLabJudgeReview" },
  { id: "qaLabAdversarialReview", defaultFile: "adversarial-review.json", optionKey: "qaLabAdversarialReview" }
];

export function createReleaseGaSmokeReport(options: ReleaseGaSmokeOptions): ReleaseGaSmokeReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });

  const claimScope = normalizeReleaseClaimScope(options.claimScope);
  const blockers: ReleaseGaSmokeBlocker[] = [];
  const setupBlockers: ReleaseGaSmokeSetupBlocker[] = [];
  const warnings: ReleaseGaSmokeWarning[] = [];
  const evidenceIndex = {} as Record<ReleaseGaSmokeSourceId, ReleaseGaSmokeEvidenceIndexEntry>;
  const loaded = EVIDENCE_SPECS.map((spec) => loadEvidence({
    id: spec.id,
    defaultFile: spec.defaultFile,
    optionPath: options[spec.optionKey] as string | undefined
  }, evidenceDir));

  for (const evidence of loaded) {
    const sourceBlockerStart = blockers.length;
    if (evidence.outsideEvidenceDir) {
      addBlocker(blockers, "P0", `${sourceCodePrefix(evidence.spec.id)}_outside_evidence_dir`, evidence.spec.id, `${titleForSource(evidence.spec.id)} evidence path must stay inside the evidence directory.`);
    } else if (evidence.missing) {
      addBlocker(blockers, "P1", missingCode(evidence.spec.id), evidence.spec.id, `${titleForSource(evidence.spec.id)} evidence is missing.`);
    } else if (evidence.invalid) {
      addBlocker(blockers, "P1", invalidCode(evidence.spec.id), evidence.spec.id, `${titleForSource(evidence.spec.id)} evidence is not valid JSON.`);
    } else if (evidence.value) {
      validateCommonEvidence(evidence, blockers);
      validateEvidenceBySource(evidence, options, blockers, setupBlockers, warnings);
    }
    const sourceBlockers = blockers.slice(sourceBlockerStart).map((blocker) => blocker.code);
    evidenceIndex[evidence.spec.id] = {
      status: evidenceStatus(evidence, sourceBlockers),
      evidenceRef: evidence.evidenceRef,
      blockerCodes: sourceBlockers
    };
  }

  const unsafeArtifacts = scanUnsafeEvidenceArtifacts(evidenceDir);
  if (unsafeArtifacts > 0) {
    addBlocker(blockers, "P0", "unsafe_evidence_artifact_present", "evidenceDir", "Evidence directory contains raw transcript, SQLite, screenshot, image, video, or oversized non-JSON artifacts.");
  }

  if (!SHA_PATTERN.test(options.candidateSha)) {
    addBlocker(blockers, "P1", "candidate_sha_invalid", "gaSmoke", "Candidate SHA must be a 40-character hexadecimal commit SHA.");
  }
  if (!options.packageVersion.trim()) {
    addBlocker(blockers, "P1", "package_version_missing", "gaSmoke", "Package version is required.");
  }

  const dedupedBlockers = uniqueBlockers(blockers);
  const actionsVerified = buildActionsVerified(evidenceIndex);
  const gaSmokeReady = dedupedBlockers.length === 0;
  const report: ReleaseGaSmokeReport = {
    schema: "lco.release.gaSmoke.v1",
    ok: gaSmokeReady,
    gaSmokeReady,
    generatedAt: options.now ?? new Date().toISOString(),
    packageName: PACKAGE_NAME,
    packageVersion: options.packageVersion,
    candidateSha: options.candidateSha,
    claimScope,
    blockers: dedupedBlockers,
    setupBlockers,
    warnings,
    deferred: [
      "No npm publish was attempted by this command.",
      "No GitHub Release or tag creation was attempted by this command.",
      "No live Codex control or desktop GUI mutation was attempted by this command."
    ],
    actionsVerified,
    actionsPerformed: {
      npmPublished: false,
      githubReleaseCreated: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false
    },
    evidenceIndex,
    nextSafeCommands: nextSafeCommands(options),
    privateDataExclusions: [
      "raw Codex transcripts",
      "raw prompts or message text",
      "SQLite DBs",
      "JSONL transcripts",
      "screenshots, images, or videos",
      "npm tokens",
      "GitHub tokens",
      "API keys, cookies, or bearer tokens",
      "raw npm or OpenClaw gateway output",
      "absolute private local paths"
    ],
    proofBoundary: "This GA smoke report aggregates already-created public-safe release evidence only. It does not publish npm, create tags, create GitHub Releases, promote dist-tags, run live Codex control, mutate a desktop GUI, read raw transcripts, or claim Claude parity, unattended autonomy, enterprise security, or customer readiness."
  };

  writeFileSync(join(evidenceDir, "release-ga-smoke.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function loadEvidence(spec: EvidenceSpec, evidenceDir: string): LoadedEvidence {
  const path = resolveEvidencePath(evidenceDir, spec.optionPath ?? spec.defaultFile);
  const outsideEvidenceDir = isOutsideEvidenceDir(path, evidenceDir);
  const evidenceRef = outsideEvidenceDir ? null : safeEvidenceRef(path, evidenceDir, spec.defaultFile);
  if (outsideEvidenceDir) return { spec, path, evidenceRef, value: null, missing: false, invalid: false, outsideEvidenceDir };
  if (!existsSync(path)) return { spec, path, evidenceRef, value: null, missing: true, invalid: false, outsideEvidenceDir };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      spec,
      path,
      evidenceRef,
      value: isRecord(parsed) ? parsed : null,
      missing: false,
      invalid: !isRecord(parsed),
      outsideEvidenceDir
    };
  } catch {
    return { spec, path, evidenceRef, value: null, missing: false, invalid: true, outsideEvidenceDir };
  }
}

function resolveEvidencePath(evidenceDir: string, path: string): string {
  return isAbsolute(path) ? path : join(evidenceDir, path);
}

function safeEvidenceRef(path: string, evidenceDir: string, defaultFile: string): string {
  const rel = relative(evidenceDir, path);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel) && !RAW_ARTIFACT_PATTERN.test(rel)) return rel;
  const base = basename(path);
  if (base && !RAW_ARTIFACT_PATTERN.test(base)) return base;
  return defaultFile;
}

function isOutsideEvidenceDir(path: string, evidenceDir: string): boolean {
  const rel = relative(evidenceDir, path);
  return rel.startsWith("..") || isAbsolute(rel);
}

function validateCommonEvidence(evidence: LoadedEvidence, blockers: ReleaseGaSmokeBlocker[]): void {
  const value = evidence.value;
  if (!value) return;
  if (containsSecretLikeValue(value)) {
    addBlocker(blockers, "P0", `${sourceCodePrefix(evidence.spec.id)}_contains_secret_like_value`, evidence.spec.id, `${titleForSource(evidence.spec.id)} evidence contains a secret-like value.`);
  }
  if (hasRestrictedActionPerformed(value)) {
    addBlocker(blockers, "P0", `${sourceCodePrefix(evidence.spec.id)}_restricted_action_performed`, evidence.spec.id, `${titleForSource(evidence.spec.id)} evidence reports a restricted action was performed.`);
  }
  if (containsPublicUnsafeFlag(value)) {
    addBlocker(blockers, "P0", `${sourceCodePrefix(evidence.spec.id)}_not_public_safe`, evidence.spec.id, `${titleForSource(evidence.spec.id)} evidence is not marked public-safe.`);
  }
  const nestedBlockers = reportableNestedBlockers(evidence.spec.id, readStringArray(value.blockers));
  if (nestedBlockers.length > 0) {
    addBlocker(blockers, "P1", `${sourceCodePrefix(evidence.spec.id)}_reports_blockers`, evidence.spec.id, `${titleForSource(evidence.spec.id)} evidence reports blockers.`);
  }
}

function validateEvidenceBySource(
  evidence: LoadedEvidence,
  options: ReleaseGaSmokeOptions,
  blockers: ReleaseGaSmokeBlocker[],
  setupBlockers: ReleaseGaSmokeSetupBlocker[],
  warnings: ReleaseGaSmokeWarning[]
): void {
  const value = evidence.value;
  if (!value) return;
  switch (evidence.spec.id) {
    case "releaseStatus":
      requireBoolean(value, "releaseReady", true, blockers, "P1", "release_status_not_ready", evidence.spec.id, "Release status is not ready.");
      requirePackageVersion(value, "packageVersion", options.packageVersion, blockers, "release_status_version_mismatch", evidence.spec.id);
      validateReleaseStatusCandidateSha(value, options, blockers, warnings);
      break;
    case "releaseFinalizationStatus":
      requireBoolean(value, "finalized", true, blockers, "P1", "release_finalization_not_ready", evidence.spec.id, "Release finalization status is not ready.");
      requirePackageVersion(value, "packageVersion", options.packageVersion, blockers, "release_finalization_version_mismatch", evidence.spec.id);
      requireString(value, "candidateSha", options.candidateSha, blockers, "release_finalization_sha_mismatch", evidence.spec.id, "Release finalization candidate SHA does not match.");
      validateFinalizationActions(value, blockers);
      break;
    case "publishedPackageSmoke":
      validatePublishedSmoke(value, options, blockers, setupBlockers, warnings);
      break;
    case "openclawDogfood":
      requireBoolean(value, "dogfoodReady", true, blockers, "P1", "openclaw_dogfood_not_ready", evidence.spec.id, "OpenClaw dogfood evidence is not ready.");
      requireBoolean(value, "requiredToolsPresent", true, blockers, "P1", "openclaw_dogfood_required_tools_missing", evidence.spec.id, "OpenClaw dogfood required tools are missing.");
      break;
    case "openclawToolSmoke":
      requireBoolean(value, "toolSmokeReady", true, blockers, "P1", "openclaw_tool_smoke_not_ready", evidence.spec.id, "OpenClaw tool-smoke evidence is not ready.");
      if (readNestedBoolean(value, ["catalog", "requiredToolsPresent"]) === false) {
        addBlocker(blockers, "P1", "openclaw_tool_smoke_required_tools_missing", evidence.spec.id, "OpenClaw tool-smoke required tools are missing.");
      }
      break;
    case "scenarioSweep":
      requireBoolean(value, "scenarioReady", true, blockers, "P1", "scenario_sweep_not_ready", evidence.spec.id, "Scenario sweep is not ready.");
      break;
    case "scorecardSweep":
      requireBoolean(value, "sweepReady", true, blockers, "P1", "scorecard_sweep_not_ready", evidence.spec.id, "Scorecard sweep is not ready.");
      break;
    case "releasePreflight":
      requireBoolean(value, "releaseReady", true, blockers, "P1", "release_preflight_not_ready", evidence.spec.id, "Release preflight is not ready.");
      break;
    case "releaseBundle":
      requireBoolean(value, "publishReady", true, blockers, "P1", "release_bundle_not_ready", evidence.spec.id, "Release bundle is not ready.");
      break;
    case "privacyScan":
      requireBoolean(value, "ok", true, blockers, "P1", "privacy_scan_not_ready", evidence.spec.id, "Privacy scan is not ready.");
      break;
    case "qaLabRun":
      validateQaLabRun(value, options, blockers, warnings);
      break;
    case "qaLabToolCoverage":
      validateQaLabToolCoverage(value, options, blockers, warnings);
      break;
    case "qaLabLiveControlMatrix":
      validateQaLabLiveControlMatrix(value, options, blockers, warnings);
      break;
    case "qaLabJudgeReview":
      validateQaLabJudgeReview(value, blockers, warnings);
      break;
    case "qaLabAdversarialReview":
      validateQaLabAdversarialReview(value, blockers, warnings);
      break;
  }
}

function validateQaLabRun(
  value: JsonRecord,
  options: ReleaseGaSmokeOptions,
  blockers: ReleaseGaSmokeBlocker[],
  warnings: ReleaseGaSmokeWarning[]
): void {
  validateSchema(value, ["lco.qaLab.run.v1", "lco.qaLab.workflowRun.v1"], blockers, "qa_lab_run_schema_invalid", "qaLabRun");
  requireOneBoolean(value, ["qaLabReady", "workflowRunReady"], true, blockers, "P1", "qa_lab_run_not_ready", "qaLabRun", "QA Lab run evidence is not ready.");
  requireString(value, "packageVersion", options.packageVersion, blockers, "qa_lab_run_version_mismatch", "qaLabRun", "QA Lab run package version does not match.");
  requireString(value, "candidateSha", options.candidateSha, blockers, "qa_lab_run_sha_mismatch", "qaLabRun", "QA Lab run candidate SHA does not match.");
  applyQaLabFindings(value, "qaLabRun", blockers, warnings);
}

function validateQaLabToolCoverage(
  value: JsonRecord,
  options: ReleaseGaSmokeOptions,
  blockers: ReleaseGaSmokeBlocker[],
  warnings: ReleaseGaSmokeWarning[]
): void {
  validateSchema(value, ["lco.qaLab.toolCoverage.v1"], blockers, "qa_lab_tool_coverage_schema_invalid", "qaLabToolCoverage");
  requireBoolean(value, "qaLabToolCoverageReady", true, blockers, "P2", "qa_lab_tool_coverage_not_ready", "qaLabToolCoverage", "QA Lab tool coverage evidence is not ready.");
  requireString(value, "packageVersion", options.packageVersion, blockers, "qa_lab_tool_coverage_version_mismatch", "qaLabToolCoverage", "QA Lab tool coverage package version does not match.");
  requireString(value, "candidateSha", options.candidateSha, blockers, "qa_lab_tool_coverage_sha_mismatch", "qaLabToolCoverage", "QA Lab tool coverage candidate SHA does not match.");
  if (value.coveragePolicy !== "full") {
    addBlocker(blockers, "P2", "qa_lab_tool_coverage_not_full", "qaLabToolCoverage", "GA smoke requires full declared-tool coverage, not facade-only coverage.");
  }
  applyQaLabFindings(value, "qaLabToolCoverage", blockers, warnings);
}

function validateQaLabLiveControlMatrix(
  value: JsonRecord,
  options: ReleaseGaSmokeOptions,
  blockers: ReleaseGaSmokeBlocker[],
  warnings: ReleaseGaSmokeWarning[]
): void {
  validateSchema(value, ["lco.qaLab.liveControlMatrix.v1"], blockers, "qa_lab_live_control_matrix_schema_invalid", "qaLabLiveControlMatrix");
  requireBoolean(value, "liveControlMatrixReady", true, blockers, "P1", "qa_lab_live_control_matrix_not_ready", "qaLabLiveControlMatrix", "QA Lab live-control matrix evidence is not ready.");
  const requiresLiveControl = releaseClaimScopeRequiresLiveControl(normalizeReleaseClaimScope(options.claimScope));
  requireString(value, "packageVersion", options.packageVersion, blockers, "qa_lab_live_control_matrix_version_mismatch", "qaLabLiveControlMatrix", "QA Lab live-control matrix package version does not match.");
  requireString(value, "candidateSha", options.candidateSha, blockers, "qa_lab_live_control_matrix_sha_mismatch", "qaLabLiveControlMatrix", "QA Lab live-control matrix candidate SHA does not match.");
  if (requiresLiveControl) {
    const summary = isRecord(value.summary) ? value.summary : {};
    const rows = liveControlMatrixActionReadiness(value);
    if (
      summary.requiredRows !== REQUIRED_LIVE_CONTROL_ACTIONS.length
      || summary.readyRows !== REQUIRED_LIVE_CONTROL_ACTIONS.length
      || summary.blockedRows !== 0
      || summary.skippedRequiredRows !== 0
      || rows.requiredActions.size !== REQUIRED_LIVE_CONTROL_ACTIONS.length
      || rows.readyActions.size !== REQUIRED_LIVE_CONTROL_ACTIONS.length
    ) {
      addBlocker(blockers, "P1", "qa_lab_live_control_matrix_required_rows_missing", "qaLabLiveControlMatrix", "Live-control release claims require ready send, resume, steer, and interrupt matrix rows.");
    }
    if (REQUIRED_LIVE_CONTROL_ACTIONS.some((action) => !rows.readyActions.has(action)) || rows.blockedRequiredRows > 0) {
      addBlocker(blockers, "P1", "qa_lab_live_control_matrix_action_rows_not_ready", "qaLabLiveControlMatrix", "Live-control release claims require one ready required row each for send, resume, steer, and interrupt.");
    }
  }
  applyQaLabFindings(value, "qaLabLiveControlMatrix", blockers, warnings);
}

function liveControlMatrixActionReadiness(value: JsonRecord): {
  requiredActions: Set<string>;
  readyActions: Set<string>;
  blockedRequiredRows: number;
} {
  const requiredActions = new Set<string>();
  const readyActions = new Set<string>();
  let blockedRequiredRows = 0;
  const rows = Array.isArray(value.rows) ? value.rows : [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const action = typeof row.action === "string" ? row.action : "";
    if (row.requiredForClaim !== true) continue;
    requiredActions.add(action);
    const blockers = Array.isArray(row.blockerCodes) ? row.blockerCodes : [];
    if (row.status === "ready" && blockers.length === 0 && liveControlMatrixRowHasRequiredProof(row)) {
      readyActions.add(action);
    } else {
      blockedRequiredRows += 1;
    }
  }
  return { requiredActions, readyActions, blockedRequiredRows };
}

function liveControlMatrixRowHasRequiredProof(row: JsonRecord): boolean {
  const action = typeof row.action === "string" ? row.action : "";
  if (action !== "steer" && action !== "interrupt") return true;
  const liveProof = isRecord(row.liveProof) ? row.liveProof : {};
  return liveProof.expectedTurnIdMatchesDryRun === true
    && liveProof.bindingScope === "turn_bound"
    && liveProof.expectedTurnIdPresent === true;
}

function validateQaLabJudgeReview(
  value: JsonRecord,
  blockers: ReleaseGaSmokeBlocker[],
  warnings: ReleaseGaSmokeWarning[]
): void {
  validateSchema(value, ["lco.qaLab.judgeReview.v1"], blockers, "qa_lab_judge_review_schema_invalid", "qaLabJudgeReview");
  requireBoolean(value, "gaReady", true, blockers, "P1", "qa_lab_judge_review_not_ready", "qaLabJudgeReview", "QA Lab judge review is not GA-ready.");
  applyQaLabFindings(value, "qaLabJudgeReview", blockers, warnings);
}

function validateQaLabAdversarialReview(
  value: JsonRecord,
  blockers: ReleaseGaSmokeBlocker[],
  warnings: ReleaseGaSmokeWarning[]
): void {
  validateSchema(value, ["lco.qaLab.adversarialReview.v1"], blockers, "qa_lab_adversarial_review_schema_invalid", "qaLabAdversarialReview");
  requireBoolean(value, "ok", true, blockers, "P1", "qa_lab_adversarial_review_not_ready", "qaLabAdversarialReview", "QA Lab adversarial review is not ready.");
  applyQaLabFindings(value, "qaLabAdversarialReview", blockers, warnings);
}

function validateSchema(
  value: JsonRecord,
  allowedSchemas: string[],
  blockers: ReleaseGaSmokeBlocker[],
  code: string,
  source: ReleaseGaSmokeSourceId
): void {
  if (typeof value.schema !== "string" || !allowedSchemas.includes(value.schema)) {
    addBlocker(blockers, "P1", code, source, `${titleForSource(source)} schema does not match the expected QA Lab schema.`);
  }
}

function requireOneBoolean(
  value: JsonRecord,
  fields: string[],
  expected: boolean,
  blockers: ReleaseGaSmokeBlocker[],
  severity: ReleaseGaSmokeSeverity,
  code: string,
  source: ReleaseGaSmokeSourceId,
  detail: string
): void {
  if (!fields.some((field) => value[field] === expected)) addBlocker(blockers, severity, code, source, detail);
}

function applyQaLabFindings(
  value: JsonRecord,
  source: ReleaseGaSmokeSourceId,
  blockers: ReleaseGaSmokeBlocker[],
  warnings: ReleaseGaSmokeWarning[]
): void {
  addAggregateQaLabBlockers(value, source, blockers, warnings);
  const findings = [
    ...readStructuredFindings(value.blockers),
    ...readStructuredFindings(value.warnings),
    ...readStringFindings(value.blockers, "P1"),
    ...readStringFindings(value.warnings, "P3")
  ];
  const rawCodeBySanitizedCode = new Map<string, string>();
  for (const finding of findings) {
    const code = collisionSafeFindingCode(finding.code, rawCodeBySanitizedCode);
    if (!code) continue;
    const upstreamSource = finding.source ? safeFindingCode(finding.source) : "";
    const upstreamDetail = safeFindingDetail(finding.detail);
    const detailSuffix = [
      upstreamSource ? `source=${upstreamSource}` : "",
      upstreamDetail ? `detail=${upstreamDetail}` : ""
    ].filter(Boolean).join("; ");
    if (finding.severity === "P3") {
      addWarning(warnings, code, source, `QA Lab reported non-blocking P3 finding ${code}${detailSuffix ? ` (${detailSuffix})` : ""}.`);
    } else {
      addBlocker(blockers, finding.severity, code, source, `QA Lab reported blocking finding ${code}${detailSuffix ? ` (${detailSuffix})` : ""}.`);
    }
  }
}

function addAggregateQaLabBlockers(
  value: JsonRecord,
  source: ReleaseGaSmokeSourceId,
  blockers: ReleaseGaSmokeBlocker[],
  warnings: ReleaseGaSmokeWarning[]
): void {
  if (source === "qaLabRun") {
    const failedScenarioCount = numberValue(value.failedScenarioCount);
    if (failedScenarioCount !== null && failedScenarioCount > 0) {
      addBlocker(blockers, "P1", "qa_lab_run_failed_scenarios", source, `QA Lab run reports ${failedScenarioCount} failed scenario(s).`);
    }
  }
  if (source === "qaLabAdversarialReview") {
    const bySeverity = isRecord(value.blockersBySeverity) ? value.blockersBySeverity : null;
    for (const severity of ["P0", "P1", "P2"] as const) {
      const count = bySeverity ? numberValue(bySeverity[severity]) : null;
      if (count !== null && count > 0) {
        addBlocker(blockers, severity, `qa_lab_adversarial_review_aggregate_${severity.toLowerCase()}`, source, `QA Lab adversarial review reports ${count} aggregate ${severity} blocker(s).`);
      }
    }
    const p3Count = bySeverity ? numberValue(bySeverity.P3) : null;
    if (p3Count !== null && p3Count > 0) {
      addWarning(warnings, "qa_lab_adversarial_review_aggregate_p3", source, `QA Lab adversarial review reports ${p3Count} aggregate P3 warning(s).`);
    }
  }
}

function readStructuredFindings(value: unknown): Array<{ severity: ReleaseGaSmokeFindingSeverity; code: string; source?: string; detail?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => {
      const severity = normalizeFindingSeverity(item.severity);
      const code = typeof item.code === "string" ? item.code : "";
      const source = typeof item.source === "string" ? item.source : undefined;
      const detail = typeof item.detail === "string" ? item.detail : undefined;
      if (!severity || !code) return null;
      const finding: { severity: ReleaseGaSmokeFindingSeverity; code: string; source?: string; detail?: string } = { severity, code };
      if (source) finding.source = source;
      if (detail) finding.detail = detail;
      return finding;
    })
    .filter((item): item is { severity: ReleaseGaSmokeFindingSeverity; code: string; source?: string; detail?: string } => Boolean(item));
}

function readStringFindings(value: unknown, severity: ReleaseGaSmokeFindingSeverity): Array<{ severity: ReleaseGaSmokeFindingSeverity; code: string; source?: string; detail?: string }> {
  return readStringArray(value).map((code) => ({ severity, code }));
}

function normalizeFindingSeverity(value: unknown): ReleaseGaSmokeFindingSeverity | null {
  return value === "P0" || value === "P1" || value === "P2" || value === "P3" ? value : null;
}

function safeFindingCode(code: string): string {
  return code.trim().replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80);
}

function collisionSafeFindingCode(code: string, rawCodeBySanitizedCode: Map<string, string>): string {
  const sanitized = safeFindingCode(code);
  if (!sanitized) return "";
  const existingRawCode = rawCodeBySanitizedCode.get(sanitized);
  if (!existingRawCode) {
    rawCodeBySanitizedCode.set(sanitized, code);
    return sanitized;
  }
  if (existingRawCode === code) return sanitized;
  const suffix = createHash("sha256").update(code).digest("hex").slice(0, 8);
  return `${sanitized.slice(0, Math.max(1, 71))}_${suffix}`;
}

function safeFindingDetail(value: string | undefined): string {
  if (!value) return "";
  if (PRIVATE_FINDING_DETAIL_PATTERN.test(value) || SECRET_LIKE_PATTERN.test(value)) return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 160);
}

function validateFinalizationActions(value: JsonRecord, blockers: ReleaseGaSmokeBlocker[]): void {
  if (readNestedBoolean(value, ["actionsVerified", "npmPublished"]) !== true) {
    addBlocker(blockers, "P1", "release_finalization_npm_publish_unverified", "releaseFinalizationStatus", "npm publication evidence was not verified.");
  }
  if (readNestedBoolean(value, ["actionsVerified", "gitTagPushed"]) !== true) {
    addBlocker(blockers, "P1", "release_finalization_git_tag_unverified", "releaseFinalizationStatus", "git tag evidence was not verified.");
  }
  if (readNestedBoolean(value, ["actionsVerified", "githubReleaseCreated"]) !== true) {
    addBlocker(blockers, "P1", "release_finalization_github_release_unverified", "releaseFinalizationStatus", "GitHub Release evidence was not verified.");
  }
}

function validatePublishedSmoke(
  value: JsonRecord,
  options: ReleaseGaSmokeOptions,
  blockers: ReleaseGaSmokeBlocker[],
  setupBlockers: ReleaseGaSmokeSetupBlocker[],
  warnings: ReleaseGaSmokeWarning[]
): void {
  requirePackageVersion(value, "localVersion", options.packageVersion, blockers, "published_smoke_version_mismatch", "publishedPackageSmoke");
  requireBoolean(value, "packagePathOk", true, blockers, "P1", "published_package_path_not_ok", "publishedPackageSmoke", "Published package path is not ready.");
  const packagePathOk = value.packagePathOk === true;
  const publishedSmokeReady = value.publishedSmokeReady === true;
  const publishedSmokeBlockers = readStringArray(value.blockers);
  const explicitSetupCodes = uniqueStrings([
    ...readStringArray(value.setupBlockers),
    ...publishedSmokeBlockers.filter(isPublishedSmokeSetupBlocker)
  ]);
  const nonSetupPublishedSmokeBlockers = publishedSmokeBlockers.filter((blocker) => !isPublishedSmokeSetupBlocker(blocker));
  const setupRequired = value.setupRequired === true
    || explicitSetupCodes.length > 0
    || readNestedString(value, ["toolSmoke", "gatewaySetupClassification"]) === "gateway_setup_required";
  const configuredGatewayReady = readNestedBoolean(value, ["configuredGateway", "provided"]) === true
    && readNestedBoolean(value, ["configuredGateway", "toolSmokeReady"]) === true
    && readNestedString(value, ["configuredGateway", "gatewaySetupClassification"]) === "ready"
    && readNestedBoolean(value, ["configuredGateway", "packageInstallLikelyOk"]) === true;
  if (setupRequired) {
    if (explicitSetupCodes.length === 0) {
      addBlocker(blockers, "P2", "published_smoke_setup_required_unclassified", "publishedPackageSmoke", "Setup-required published-smoke evidence must include an explicit setup blocker code.");
    }
    const allowed = options.allowSetupRequired === true
      && packagePathOk
      && configuredGatewayReady
      && explicitSetupCodes.length > 0
      && nonSetupPublishedSmokeBlockers.length === 0;
    for (const code of explicitSetupCodes.length ? explicitSetupCodes : ["fresh_profile_gateway_setup_required"]) {
      setupBlockers.push({
        code,
        source: "publishedPackageSmoke",
        detail: "Fresh-profile OpenClaw gateway setup is required before clean-profile gateway-ready proof.",
        allowed
      });
    }
    if (!allowed) {
      addBlocker(blockers, "P2", "fresh_profile_gateway_setup_required", "publishedPackageSmoke", "Fresh-profile OpenClaw gateway setup is required and was not explicitly allowed with clean configured-gateway proof.");
    } else {
      addWarning(warnings, "published_smoke_setup_required_allowed", "publishedPackageSmoke", "Fresh-profile gateway setup was explicitly allowed because configured-gateway proof is clean.");
    }
  } else if (!publishedSmokeReady) {
    addBlocker(blockers, "P1", "published_smoke_not_ready", "publishedPackageSmoke", "Published package smoke is not ready.");
  }
  if (options.allowSetupRequired === true && setupRequired && !configuredGatewayReady) {
    addBlocker(blockers, "P2", "configured_gateway_proof_missing", "publishedPackageSmoke", "Setup-required release needs clean configured-gateway proof.");
  }
}

function validateReleaseStatusCandidateSha(
  value: JsonRecord,
  options: ReleaseGaSmokeOptions,
  blockers: ReleaseGaSmokeBlocker[],
  warnings: ReleaseGaSmokeWarning[]
): void {
  if (value.candidateSha === undefined || value.candidateSha === null) {
    addWarning(warnings, "release_status_candidate_sha_not_embedded", "releaseStatus", "Release status evidence predates embedded candidateSha; candidate binding is enforced by GA smoke input and finalization evidence.");
    return;
  }
  requireString(value, "candidateSha", options.candidateSha, blockers, "release_status_sha_mismatch", "releaseStatus", "Release status candidate SHA does not match.");
}

function requirePackageVersion(
  value: JsonRecord,
  field: string,
  expected: string,
  blockers: ReleaseGaSmokeBlocker[],
  code: string,
  source: ReleaseGaSmokeSourceId
): void {
  requireString(value, field, expected, blockers, code, source, `${titleForSource(source)} package version does not match.`);
}

function requireString(
  value: JsonRecord,
  field: string,
  expected: string,
  blockers: ReleaseGaSmokeBlocker[],
  code: string,
  source: ReleaseGaSmokeSourceId,
  detail: string
): void {
  if (typeof value[field] !== "string" || value[field] !== expected) {
    addBlocker(blockers, "P1", code, source, detail);
  }
}

function requireBoolean(
  value: JsonRecord,
  field: string,
  expected: boolean,
  blockers: ReleaseGaSmokeBlocker[],
  severity: ReleaseGaSmokeSeverity,
  code: string,
  source: ReleaseGaSmokeSourceId,
  detail: string
): void {
  if (value[field] !== expected) addBlocker(blockers, severity, code, source, detail);
}

function buildActionsVerified(evidenceIndex: Record<ReleaseGaSmokeSourceId, ReleaseGaSmokeEvidenceIndexEntry>): ReleaseGaSmokeReport["actionsVerified"] {
  return {
    releaseStatusReady: evidenceIndex.releaseStatus?.status === "ready",
    releaseFinalized: evidenceIndex.releaseFinalizationStatus?.status === "ready",
    publishedPackageSmokeReady: evidenceIndex.publishedPackageSmoke?.status === "ready",
    dogfoodReady: evidenceIndex.openclawDogfood?.status === "ready",
    toolSmokeReady: evidenceIndex.openclawToolSmoke?.status === "ready",
    scenarioSweepReady: evidenceIndex.scenarioSweep?.status === "ready",
    scorecardSweepReady: evidenceIndex.scorecardSweep?.status === "ready",
    releasePreflightReady: evidenceIndex.releasePreflight?.status === "ready",
    releaseBundleReady: evidenceIndex.releaseBundle?.status === "ready",
    privacyScanReady: evidenceIndex.privacyScan?.status === "ready",
    qaLabRunReady: evidenceIndex.qaLabRun?.status === "ready",
    qaLabToolCoverageReady: evidenceIndex.qaLabToolCoverage?.status === "ready",
    qaLabLiveControlMatrixReady: evidenceIndex.qaLabLiveControlMatrix?.status === "ready",
    qaLabJudgeReviewReady: evidenceIndex.qaLabJudgeReview?.status === "ready",
    qaLabAdversarialReviewReady: evidenceIndex.qaLabAdversarialReview?.status === "ready"
  };
}

function evidenceStatus(evidence: LoadedEvidence, sourceBlockers: string[]): ReleaseGaSmokeEvidenceStatus {
  if (evidence.missing) return "missing";
  if (evidence.invalid) return "invalid";
  if (sourceBlockers.some(isUnsafeBlockerCode)) return "unsafe";
  if (sourceBlockers.length > 0) return "blocked";
  return "ready";
}

function isUnsafeBlockerCode(code: string): boolean {
  return code.endsWith("_not_public_safe")
    || code.endsWith("_contains_secret_like_value")
    || code.endsWith("_restricted_action_performed")
    || code === "unsafe_evidence_artifact_present";
}

function missingCode(source: ReleaseGaSmokeSourceId): string {
  return `${sourceCodePrefix(source)}_evidence_missing`;
}

function invalidCode(source: ReleaseGaSmokeSourceId): string {
  return `${sourceCodePrefix(source)}_evidence_invalid_json`;
}

function sourceCodePrefix(source: ReleaseGaSmokeSourceId): string {
  const prefixes: Record<ReleaseGaSmokeSourceId, string> = {
    releaseStatus: "release_status",
    releaseFinalizationStatus: "release_finalization_status",
    publishedPackageSmoke: "published_smoke",
    openclawDogfood: "openclaw_dogfood",
    openclawToolSmoke: "openclaw_tool_smoke",
    scenarioSweep: "scenario_sweep",
    scorecardSweep: "scorecard_sweep",
    releasePreflight: "release_preflight",
    releaseBundle: "release_bundle",
    privacyScan: "privacy_scan",
    qaLabRun: "qa_lab_run",
    qaLabToolCoverage: "qa_lab_tool_coverage",
    qaLabLiveControlMatrix: "qa_lab_live_control_matrix",
    qaLabJudgeReview: "qa_lab_judge_review",
    qaLabAdversarialReview: "qa_lab_adversarial_review"
  };
  return prefixes[source];
}

function titleForSource(source: ReleaseGaSmokeSourceId): string {
  const titles: Record<ReleaseGaSmokeSourceId, string> = {
    releaseStatus: "Release status",
    releaseFinalizationStatus: "Release finalization status",
    publishedPackageSmoke: "Published package smoke",
    openclawDogfood: "OpenClaw dogfood",
    openclawToolSmoke: "OpenClaw tool-smoke",
    scenarioSweep: "Scenario sweep",
    scorecardSweep: "Scorecard sweep",
    releasePreflight: "Release preflight",
    releaseBundle: "Release bundle",
    privacyScan: "Privacy scan",
    qaLabRun: "QA Lab run",
    qaLabToolCoverage: "QA Lab tool coverage",
    qaLabLiveControlMatrix: "QA Lab live-control matrix",
    qaLabJudgeReview: "QA Lab judge review",
    qaLabAdversarialReview: "QA Lab adversarial review"
  };
  return titles[source];
}

function nextSafeCommands(options: ReleaseGaSmokeOptions): string[] {
  const evidenceDir = "<evidence-dir>";
  const packageVersion = options.packageVersion || "<version>";
  const candidateSha = options.candidateSha || "<sha>";
  const claimScope = normalizeReleaseClaimScope(options.claimScope);
  const liveControlMatrixCommand = releaseClaimScopeRequiresLiveControl(claimScope)
    ? `loo qa-lab live-control-matrix --evidence-dir ${evidenceDir} --package-version ${packageVersion} --candidate-sha ${candidateSha} --claim-scope ${claimScope} --sacrificial-thread-id <send-sacrificial-thread-id> --sacrificial-thread-id <resume-sacrificial-thread-id> --sacrificial-thread-id <steer-sacrificial-thread-id> --sacrificial-thread-id <interrupt-sacrificial-thread-id> --send-report <send-report.json> --resume-report <resume-report.json> --steer-report <steer-report.json> --interrupt-report <interrupt-report.json> --strict`
    : `loo qa-lab live-control-matrix --evidence-dir ${evidenceDir} --package-version ${packageVersion} --candidate-sha ${candidateSha} --claim-scope ${claimScope} --strict`;
  return [
    `loo release status --evidence-dir ${evidenceDir} --candidate-sha ${candidateSha} --strict`,
    `loo release finalization-status --evidence-dir ${evidenceDir} --candidate-sha ${candidateSha} --package-version ${packageVersion} --npm-publish-evidence npm-publish.json --git-tag-evidence git-tag.json --github-release-evidence github-release.json --strict`,
    `loo openclaw published-smoke --evidence-dir ${evidenceDir} --dogfood-report openclaw-dogfood.json --tool-smoke-report openclaw-tool-smoke.json --registry-version ${packageVersion} --gateway-ready-strict`,
    `loo qa-lab run --suite ga --artifact published --package-version ${packageVersion} --candidate-sha ${candidateSha} --evidence-dir ${evidenceDir} --strict`,
    `loo qa-lab tool-coverage --evidence-dir ${evidenceDir} --package-version ${packageVersion} --candidate-sha ${candidateSha} --coverage-policy full --strict`,
    liveControlMatrixCommand,
    `loo qa-lab judge --run ${evidenceDir}/qa-lab-run.json --evidence-dir ${evidenceDir} --rubric-version real-product-v1 --strict`,
    `loo qa-lab adversarial-review --run ${evidenceDir}/qa-lab-run.json --evidence-dir ${evidenceDir} --lenses safety,retrieval,packaging,claims,agent-usability --strict`,
    `loo eval scenarios --evidence-dir ${evidenceDir} --strict`,
    `loo scorecards sweep --evidence-dir ${evidenceDir} --strict`,
    `loo release ga-smoke --evidence-dir ${evidenceDir} --package-version ${packageVersion} --candidate-sha ${candidateSha} --strict`
  ];
}

function scanUnsafeEvidenceArtifacts(evidenceDir: string): number {
  if (!existsSync(evidenceDir)) return 0;
  let count = 0;
  const visit = (dir: string, depth: number) => {
    if (depth > 8) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === "release-ga-smoke.json") continue;
      const rel = relative(evidenceDir, path);
      if (RAW_ARTIFACT_PATTERN.test(rel) || RAW_OUTPUT_ARTIFACT_PATTERN.test(rel)) count += 1;
      try {
        if (!/\.json$/i.test(rel) && statSync(path).size > 1_000_000) count += 1;
      } catch {
        count += 1;
      }
    }
  };
  visit(evidenceDir, 0);
  return count;
}

function hasRestrictedActionPerformed(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasRestrictedActionPerformed(item));
  const record = isRecord(value) ? value : null;
  if (!record) return false;
  for (const [key, actionValue] of Object.entries(record)) {
    if (RESTRICTED_ACTION_KEYS.has(key) && actionValue === true) return true;
  }
  if (isRecord(record.actionsPerformed)) {
    for (const [key, actionValue] of Object.entries(record.actionsPerformed)) {
      if (RESTRICTED_ACTION_KEYS.has(key) && actionValue === true) return true;
    }
  }
  return Object.entries(record)
    .filter(([key]) => key !== "actionsVerified")
    .some(([, item]) => hasRestrictedActionPerformed(item));
}

function containsSecretLikeValue(value: unknown): boolean {
  if (typeof value === "string") return SECRET_LIKE_PATTERN.test(value);
  if (Array.isArray(value)) return value.some((item) => containsSecretLikeValue(item));
  if (isRecord(value)) {
    return Object.entries(value).some(([key, item]) => {
      if (SECRET_LIKE_KEY_PATTERN.test(key) && typeof item === "string" && item.trim()) return true;
      return containsSecretLikeValue(item);
    });
  }
  return false;
}

function containsPublicUnsafeFlag(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsPublicUnsafeFlag(item));
  if (!isRecord(value)) return false;
  if (value.publicSafe === false) return true;
  return Object.values(value).some((item) => containsPublicUnsafeFlag(item));
}

function readNestedBoolean(record: JsonRecord, path: string[]): boolean | null {
  const value = readNestedValue(record, path);
  return typeof value === "boolean" ? value : null;
}

function readNestedString(record: JsonRecord, path: string[]): string | null {
  const value = readNestedValue(record, path);
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNestedValue(record: JsonRecord, path: string[]): unknown {
  let cursor: unknown = record;
  for (const key of path) {
    if (!isRecord(cursor)) return null;
    cursor = cursor[key];
  }
  return cursor;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function reportableNestedBlockers(source: ReleaseGaSmokeSourceId, blockers: string[]): string[] {
  if (source !== "publishedPackageSmoke") return blockers;
  return blockers.filter((blocker) => !isPublishedSmokeSetupBlocker(blocker));
}

function isPublishedSmokeSetupBlocker(blocker: string): boolean {
  return blocker === "fresh_profile_gateway_setup_required"
    || blocker.startsWith("fresh_profile_gateway_")
    || blocker === "gateway_setup_required"
    || blocker === "openclaw_gateway_setup_required";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function addBlocker(
  blockers: ReleaseGaSmokeBlocker[],
  severity: ReleaseGaSmokeSeverity,
  code: string,
  source: string,
  detail: string
): void {
  blockers.push({ severity, code, source, detail });
}

function addWarning(
  warnings: ReleaseGaSmokeWarning[],
  code: string,
  source: string,
  detail: string
): void {
  warnings.push({ code, source, detail });
}

function uniqueBlockers(blockers: ReleaseGaSmokeBlocker[]): ReleaseGaSmokeBlocker[] {
  const seen = new Set<string>();
  const unique: ReleaseGaSmokeBlocker[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.severity}:${blocker.code}:${blocker.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(blocker);
  }
  return unique;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
