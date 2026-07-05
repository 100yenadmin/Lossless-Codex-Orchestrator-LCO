import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  normalizeReleaseClaimScope,
  releaseClaimScopeRequiresLiveControl,
  type ReleaseClaimScope
} from "./release-claim-scope.js";

export type QaLabRunSuite = "ga";
export type QaLabRunArtifact = "published" | "candidate";
export type QaLabRunSeverity = "P0" | "P1" | "P2" | "P3";
export type QaLabRunEvidenceStatus = "ready" | "missing" | "invalid" | "unsafe" | "blocked" | "not_required_by_claim_scope";
export type QaLabRunDimensionName = "privacy" | "safety" | "retrieval" | "packaging" | "claims" | "agentUsability";
export type QaLabRunAdversarialLens = "safety" | "retrieval" | "packaging" | "claims" | "agentUsability";
export type QaLabRunEvidenceId =
  | "toolCoverage"
  | "workflowRun"
  | "cliMcpProductSmoke"
  | "desktopContract"
  | "liveControlMatrix"
  | "scenarioSweep"
  | "scorecardSweep"
  | "privacyScan";

export type QaLabRunOptions = {
  suite: QaLabRunSuite;
  artifact: QaLabRunArtifact;
  packageVersion: string;
  candidateSha: string;
  evidenceDir: string;
  claimScope?: ReleaseClaimScope;
  toolCoverage?: string;
  workflowRun?: string;
  cliMcpProductSmoke?: string;
  desktopContract?: string;
  liveControlMatrix?: string;
  scenarioSweep?: string;
  scorecardSweep?: string;
  privacyScan?: string;
  now?: string;
};

export type QaLabRunBlocker = {
  severity: QaLabRunSeverity;
  code: string;
  source: string;
  detail: string;
};

export type QaLabRunEvidenceIndexEntry = {
  status: QaLabRunEvidenceStatus;
  evidenceRef: string | null;
  blockerCodes: string[];
};

export type QaLabRunReport = {
  schema: "lco.qaLab.run.v1";
  ok: boolean;
  qaLabReady: boolean;
  publicSafe: boolean;
  generatedAt: string;
  suite: QaLabRunSuite;
  artifact: QaLabRunArtifact;
  packageName: "lossless-openclaw-orchestrator";
  packageVersion: string;
  candidateSha: string;
  claimScope: ReleaseClaimScope;
  summary: {
    runId: string;
    claimScope: ReleaseClaimScope;
    passedScenarios: number;
    failedScenarios: number;
    readyReports: number;
    blockedReports: number;
    missingReports: number;
  };
  scenarioCount: number;
  failedScenarioCount: number;
  dimensions: Record<QaLabRunDimensionName, { score: number; notes: string[] }>;
  adversarial: Record<QaLabRunAdversarialLens, { pass: boolean; findings: QaLabRunBlocker[] }>;
  evidenceIndex: Record<QaLabRunEvidenceId, QaLabRunEvidenceIndexEntry>;
  blockers: QaLabRunBlocker[];
  warnings: QaLabRunBlocker[];
  actionsVerified: {
    aggregateOnly: true;
    evidenceLoaded: boolean;
    packageTruthChecked: true;
    publicSafetyChecked: true;
    restrictedActionsChecked: true;
    releaseClaimScopeApplied: true;
  };
  actionsPerformed: {
    npmPublished: false;
    githubReleaseCreated: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
    rawPromptRead: false;
    screenshotCaptured: false;
    sourceStoreMutation: false;
    gatewayScopeApproval: false;
    broadGatewayScopeApproval: false;
  };
  nextSafeCommands: string[];
  privateDataExclusions: string[];
  proofBoundary: string;
};

type JsonRecord = Record<string, unknown>;

type EvidenceSpec = {
  id: QaLabRunEvidenceId;
  defaultFile: string;
  optionKey: keyof Pick<
    QaLabRunOptions,
    "toolCoverage" | "workflowRun" | "cliMcpProductSmoke" | "desktopContract" | "liveControlMatrix" | "scenarioSweep" | "scorecardSweep" | "privacyScan"
  >;
  required: (claimScope: ReleaseClaimScope) => boolean;
};

type LoadedEvidence = {
  spec: EvidenceSpec;
  path: string;
  evidenceRef: string | null;
  value: JsonRecord | null;
  missing: boolean;
  invalid: boolean;
  unsafe: boolean;
  notRequired: boolean;
  blockerCodes: string[];
  invalidSeverity?: QaLabRunSeverity;
};

const PACKAGE_NAME = "lossless-openclaw-orchestrator";
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const SECRET_LIKE_PATTERN = /(npm_[A-Za-z0-9]{20,}|bearer\s+[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const SECRET_LIKE_KEY_PATTERN = /^(authorization|cookie|set-cookie|x-api-key|api[_-]?key|token|access[_-]?token|refresh[_-]?token|secret|password)$/i;
const PRIVATE_FINDING_DETAIL_PATTERN = /\/Users\/|\/Volumes\/|\.jsonl\b|\.sqlite\b|Bearer\s+|Authorization\s*:|Basic\s+|cookie|set-cookie|api[_-]?key\s*[=:]|token\s*[=:]|secret\s*[=:]|password\s*[=:]/i;
const RAW_PRIVATE_VALUE_PATTERN = /(?:\/Users\/[^"'\s]+|\/Volumes\/[^"'\s]+|~\/[^"'\s]+|\/private\/var\/[^"'\s]+|\/tmp\/[^"'\s]+|[A-Za-z]:\\Users\\[^"'\s]+|(?:^|["'\s])[^"'\s/\\]+\.(?:jsonl|sqlite|sqlite-wal|sqlite-shm|db|png|jpg|jpeg|gif|webp|mp4|mov|webm|log))(?:["'\s]|$)/i;
const RAW_REF_PATTERN = /\.(?:jsonl|sqlite|sqlite-wal|sqlite-shm|db|png|jpg|jpeg|gif|webp|mp4|mov|webm|log)(?:$|[?#])/i;
const RESTRICTED_ACTION_KEYS = new Set([
  "npmPublished",
  "githubReleaseCreated",
  "liveCodexControlRun",
  "desktopGuiActionRun",
  "rawTranscriptRead",
  "rawPromptRead",
  "screenCaptureRun",
  "screenshotCaptured",
  "screenshotsCaptured",
  "sourceStoreMutation",
  "gatewayScopeApproval",
  "broadGatewayScopeApproval"
]);
const PRIVATE_DATA_EXCLUSIONS = [
  "raw Codex transcripts",
  "raw prompts or message text",
  "raw local filesystem paths",
  "SQLite DBs",
  "JSONL transcripts",
  "screenshots or videos",
  "tokens, credentials, API keys, cookies",
  "raw CLI, MCP, OpenClaw gateway, or desktop logs",
  "customer data"
];
const EVIDENCE_SPECS: EvidenceSpec[] = [
  { id: "toolCoverage", defaultFile: "tool-coverage.json", optionKey: "toolCoverage", required: () => true },
  { id: "workflowRun", defaultFile: "workflow-run.json", optionKey: "workflowRun", required: () => true },
  { id: "cliMcpProductSmoke", defaultFile: "cli-mcp-product-smoke.json", optionKey: "cliMcpProductSmoke", required: () => true },
  { id: "desktopContract", defaultFile: "desktop-contract.json", optionKey: "desktopContract", required: () => true },
  { id: "liveControlMatrix", defaultFile: "live-control-matrix.json", optionKey: "liveControlMatrix", required: releaseClaimScopeRequiresLiveControl },
  { id: "scenarioSweep", defaultFile: "scenario-sweep.json", optionKey: "scenarioSweep", required: () => true },
  { id: "scorecardSweep", defaultFile: "scorecard-sweep.json", optionKey: "scorecardSweep", required: () => true },
  { id: "privacyScan", defaultFile: "privacy-scan.json", optionKey: "privacyScan", required: () => true }
];
const LENSES: QaLabRunAdversarialLens[] = ["safety", "retrieval", "packaging", "claims", "agentUsability"];

export function createQaLabRunReport(options: QaLabRunOptions): QaLabRunReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const claimScope = normalizeReleaseClaimScope(options.claimScope);
  const blockers: QaLabRunBlocker[] = [];
  const warnings: QaLabRunBlocker[] = [];

  if (options.suite !== "ga") {
    addBlocker(blockers, "P1", "suite_not_supported", "qaLabRun", "Only --suite ga is supported.");
  }
  if (options.artifact !== "published" && options.artifact !== "candidate") {
    addBlocker(blockers, "P1", "artifact_not_supported", "qaLabRun", "Only --artifact published or --artifact candidate is supported.");
  }
  if (!options.packageVersion.trim()) {
    addBlocker(blockers, "P1", "package_version_missing", "qaLabRun", "Package version is required.");
  }
  if (!SHA_PATTERN.test(options.candidateSha)) {
    addBlocker(blockers, "P1", "candidate_sha_invalid", "qaLabRun", "Candidate SHA must be a 40-character hexadecimal commit SHA.");
  }

  const loaded = EVIDENCE_SPECS.map((spec) => loadEvidence(spec, options, evidenceDir, claimScope));
  for (const evidence of loaded) validateEvidence(evidence, options, blockers, warnings);

  const dedupedBlockers = uniqueFindings(blockers);
  const dedupedWarnings = uniqueFindings(warnings);
  const blocking = dedupedBlockers.filter((blocker) => blocker.severity !== "P3");
  const qaLabReady = blocking.length === 0;
  const publicSafe = !dedupedBlockers.some(isPublicSafetyBlocker);
  const evidenceIndex = Object.fromEntries(loaded.map((evidence) => [
    evidence.spec.id,
    {
      status: evidenceStatus(evidence),
      evidenceRef: evidence.evidenceRef,
      blockerCodes: evidence.blockerCodes
    }
  ])) as Record<QaLabRunEvidenceId, QaLabRunEvidenceIndexEntry>;
  const scenarioCounts = scenarioCountsFromEvidence(loaded);
  const report: QaLabRunReport = {
    schema: "lco.qaLab.run.v1",
    ok: qaLabReady,
    qaLabReady,
    publicSafe,
    generatedAt: options.now ?? new Date().toISOString(),
    suite: options.suite,
    artifact: options.artifact,
    packageName: PACKAGE_NAME,
    packageVersion: options.packageVersion,
    candidateSha: options.candidateSha,
    claimScope,
    summary: {
      runId: `qa_lab_run_${shortSha(options.candidateSha)}_${options.packageVersion.replace(/[^A-Za-z0-9_.-]/g, "_")}`,
      claimScope,
      passedScenarios: scenarioCounts.passed,
      failedScenarios: scenarioCounts.failed,
      readyReports: loaded.filter((evidence) => evidenceStatus(evidence) === "ready").length,
      blockedReports: loaded.filter((evidence) => ["blocked", "unsafe", "invalid"].includes(evidenceStatus(evidence))).length,
      missingReports: loaded.filter((evidence) => evidenceStatus(evidence) === "missing").length
    },
    scenarioCount: scenarioCounts.passed + scenarioCounts.failed,
    failedScenarioCount: scenarioCounts.failed,
    dimensions: buildDimensions(blocking, loaded),
    adversarial: buildAdversarial(blocking),
    evidenceIndex,
    blockers: dedupedBlockers,
    warnings: dedupedWarnings,
    actionsVerified: {
      aggregateOnly: true,
      evidenceLoaded: loaded.some((evidence) => Boolean(evidence.value)),
      packageTruthChecked: true,
      publicSafetyChecked: true,
      restrictedActionsChecked: true,
      releaseClaimScopeApplied: true
    },
    actionsPerformed: noActions(),
    nextSafeCommands: nextSafeCommands(options, claimScope, loaded, qaLabReady),
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS,
    proofBoundary: "Aggregate-only QA Lab run report. It consumes existing public-safe product evidence and does not run live Codex control, mutate a desktop GUI, read raw transcripts, approve gateway scopes, publish npm, create tags, or create GitHub Releases."
  };
  writeFileSync(join(evidenceDir, "qa-lab-run.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function loadEvidence(spec: EvidenceSpec, options: QaLabRunOptions, evidenceDir: string, claimScope: ReleaseClaimScope): LoadedEvidence {
  const required = spec.required(claimScope);
  const configuredPath = options[spec.optionKey];
  const path = resolve(configuredPath ?? join(evidenceDir, spec.defaultFile));
  const base: LoadedEvidence = {
    spec,
    path,
    evidenceRef: safeEvidenceRef(path, evidenceDir, spec.defaultFile),
    value: null,
    missing: false,
    invalid: false,
    unsafe: false,
    notRequired: !required && !configuredPath,
    blockerCodes: []
  };
  if (base.notRequired) return base;
  if (!isPathInside(path, evidenceDir)) {
    return { ...base, invalid: true, invalidSeverity: "P0", blockerCodes: [`${sourceCode(spec.id)}_outside_evidence_dir`] };
  }
  if (!existsSync(path)) {
    return { ...base, missing: true, blockerCodes: required ? [`${sourceCode(spec.id)}_evidence_missing`] : [] };
  }
  try {
    if (lstatSync(path).isSymbolicLink()) {
      return { ...base, invalid: true, invalidSeverity: "P0", blockerCodes: [`${sourceCode(spec.id)}_symlink_disallowed`] };
    }
    const realEvidenceDir = realpathSync(evidenceDir);
    const realPath = realpathSync(path);
    if (!isPathInside(realPath, realEvidenceDir)) {
      return { ...base, invalid: true, invalidSeverity: "P0", blockerCodes: [`${sourceCode(spec.id)}_outside_evidence_dir`] };
    }
    const parsed = JSON.parse(readFileSync(realPath, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      return { ...base, invalid: true, blockerCodes: [`${sourceCode(spec.id)}_invalid_json_object`] };
    }
    return { ...base, value: parsed };
  } catch {
    return { ...base, invalid: true, blockerCodes: [`${sourceCode(spec.id)}_invalid_json`] };
  }
}

function validateEvidence(
  evidence: LoadedEvidence,
  options: QaLabRunOptions,
  blockers: QaLabRunBlocker[],
  warnings: QaLabRunBlocker[]
): void {
  if (evidence.notRequired) return;
  const source = evidence.spec.id;
  if (evidence.missing) {
    addBlocker(blockers, "P1", `${sourceCode(source)}_evidence_missing`, source, `${titleForSource(source)} evidence is missing.`);
    return;
  }
  if (evidence.invalid || !evidence.value) {
    const code = evidence.blockerCodes[0] ?? `${sourceCode(source)}_invalid`;
    addBlocker(blockers, evidence.invalidSeverity ?? "P1", code, source, `${titleForSource(source)} evidence could not be loaded safely.`);
    return;
  }
  const value = evidence.value;
  const startingBlockerCount = blockers.length;
  if (value.publicSafe !== true) {
    addBlocker(blockers, "P0", `${sourceCode(source)}_not_public_safe`, source, `${titleForSource(source)} must declare publicSafe: true.`);
  }
  if (containsUnsafeValue(value)) {
    evidence.unsafe = true;
    addBlocker(blockers, "P0", `${sourceCode(source)}_unsafe_evidence_value`, source, `${titleForSource(source)} contains a raw path, transcript artifact, media/log artifact, token, cookie, credential, or private data canary.`);
  }
  if (hasRestrictedAction(value)) {
    addBlocker(blockers, "P0", `${sourceCode(source)}_restricted_action_performed`, source, `${titleForSource(source)} indicates a restricted action was performed.`);
  }
  validatePackageTruth(evidence, options, blockers);
  validateSourceReadiness(evidence, options, blockers);
  collectUpstreamFindings(evidence, blockers, warnings);
  evidence.blockerCodes.push(...blockers.slice(startingBlockerCount).map((blocker) => blocker.code));
}

function validatePackageTruth(evidence: LoadedEvidence, options: QaLabRunOptions, blockers: QaLabRunBlocker[]): void {
  const value = evidence.value;
  if (!value) return;
  const version = stringValue(value.packageVersion);
  const sha = stringValue(value.candidateSha);
  if (!version) {
    addBlocker(blockers, "P1", `${sourceCode(evidence.spec.id)}_version_missing`, evidence.spec.id, `${titleForSource(evidence.spec.id)} must bind packageVersion to the QA Lab candidate.`);
  } else if (version !== options.packageVersion) {
    addBlocker(blockers, "P1", `${sourceCode(evidence.spec.id)}_version_mismatch`, evidence.spec.id, `${titleForSource(evidence.spec.id)} targets a different package version.`);
  }
  if (!sha) {
    addBlocker(blockers, "P1", `${sourceCode(evidence.spec.id)}_sha_missing`, evidence.spec.id, `${titleForSource(evidence.spec.id)} must bind candidateSha to the QA Lab candidate.`);
  } else if (sha !== options.candidateSha) {
    addBlocker(blockers, "P1", `${sourceCode(evidence.spec.id)}_sha_mismatch`, evidence.spec.id, `${titleForSource(evidence.spec.id)} targets a different candidate SHA.`);
  }
}

function validateSourceReadiness(evidence: LoadedEvidence, options: QaLabRunOptions, blockers: QaLabRunBlocker[]): void {
  const value = evidence.value;
  if (!value) return;
  const source = evidence.spec.id;
  switch (source) {
    case "toolCoverage":
      requireSchema(value, "lco.qaLab.toolCoverage.v1", blockers, "tool_coverage_schema_invalid", source);
      requireReadyBoolean(value, "qaLabToolCoverageReady", blockers, "tool_coverage_not_ready", source);
      if (value.coveragePolicy !== "full") addBlocker(blockers, "P2", "tool_coverage_not_full", source, "GA QA Lab run requires full declared-tool coverage.");
      break;
    case "workflowRun":
      requireSchema(value, "lco.qaLab.workflowRun.v1", blockers, "workflow_run_schema_invalid", source);
      requireReadyBoolean(value, "workflowRunReady", blockers, "workflow_run_not_ready", source);
      break;
    case "cliMcpProductSmoke":
      requireSchema(value, "lco.qaLab.cliMcpProductSmoke.v1", blockers, "cli_mcp_product_smoke_schema_invalid", source);
      requireReadyBoolean(value, "ok", blockers, "cli_mcp_product_smoke_not_ready", source);
      requireReadyBoolean(value, "cliReady", blockers, "cli_mcp_cli_not_ready", source);
      requireReadyBoolean(value, "mcpReady", blockers, "cli_mcp_mcp_not_ready", source);
      requireReadyBoolean(value, "mcpToolsCallReady", blockers, "cli_mcp_tools_call_not_ready", source);
      break;
    case "desktopContract":
      requireSchema(value, "lco.qaLab.desktopContract.v1", blockers, "desktop_contract_schema_invalid", source);
      requireReadyBoolean(value, "desktopContractReady", blockers, "desktop_contract_not_ready", source);
      break;
    case "liveControlMatrix":
      requireSchema(value, "lco.qaLab.liveControlMatrix.v1", blockers, "live_control_matrix_schema_invalid", source);
      requireReadyBoolean(value, "liveControlMatrixReady", blockers, "live_control_matrix_not_ready", source);
      if (releaseClaimScopeRequiresLiveControl(normalizeReleaseClaimScope(options.claimScope))) {
        const summary = isRecord(value.summary) ? value.summary : {};
        if (numberValue(summary.requiredRows) !== 4 || numberValue(summary.readyRows) !== 4 || numberValue(summary.blockedRows) !== 0 || numberValue(summary.skippedRequiredRows) !== 0) {
          addBlocker(blockers, "P1", "live_control_matrix_required_rows_missing", source, "Live-control claim scopes require ready send, resume, steer, and interrupt matrix rows.");
        }
      }
      break;
    case "scenarioSweep":
      requireSchema(value, "lco.scenarioSweep.v1", blockers, "scenario_sweep_schema_invalid", source);
      requireReadyEither(value, ["scenarioReady", "ok"], blockers, "scenario_sweep_not_ready", source);
      {
        const failedScenarioCount = numberValue(value.failedScenarioCount);
        if (failedScenarioCount === null) {
          addBlocker(blockers, "P1", "scenario_sweep_failed_count_missing", source, "Scenario sweep must report failedScenarioCount.");
        } else if (failedScenarioCount > 0) {
          addBlocker(blockers, "P1", "scenario_sweep_failed_scenarios", source, "Scenario sweep reports failed scenarios.");
        }
      }
      break;
    case "scorecardSweep":
      requireSchema(value, "lco.scorecardSweep.v1", blockers, "scorecard_sweep_schema_invalid", source);
      requireReadyEither(value, ["sweepReady", "scorecardSweepReady", "ok"], blockers, "scorecard_sweep_not_ready", source);
      break;
    case "privacyScan":
      requireSchema(value, "lco.privacyScan.v1", blockers, "privacy_scan_schema_invalid", source);
      requireReadyBoolean(value, "ok", blockers, "privacy_scan_not_ready", source);
      if (arrayLength(value.rawSessionArtifacts) > 0 || arrayLength(value.secretLikeEvidenceFindings) > 0) {
        addBlocker(blockers, "P0", "privacy_scan_has_findings", source, "Privacy scan reports raw session artifacts or secret-like evidence findings.");
      }
      break;
  }
}

function collectUpstreamFindings(evidence: LoadedEvidence, blockers: QaLabRunBlocker[], warnings: QaLabRunBlocker[]): void {
  const value = evidence.value;
  if (!value) return;
  const findings = [
    ...readFindings(value.blockers, "P1"),
    ...readFindings(value.warnings, "P3"),
    ...readFindings(value.setupBlockers, "P2")
  ];
  for (const finding of findings) {
    const target = finding.severity === "P3" ? warnings : blockers;
    addBlocker(
      target,
      finding.severity,
      safeCode(finding.code || `${sourceCode(evidence.spec.id)}_upstream_finding`),
      evidence.spec.id,
      safeDetail(finding.detail || `${titleForSource(evidence.spec.id)} reported an upstream finding.`)
    );
  }
}

function readFindings(value: unknown, defaultSeverity: QaLabRunSeverity): QaLabRunBlocker[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") {
      const prefixed = item.match(/^\s*(P[0-3])\s*[:|-]\s*(.+)$/i);
      if (prefixed) {
        const severity = normalizeSeverity(prefixed[1]?.toUpperCase()) ?? defaultSeverity;
        const detail = prefixed[2]?.trim() || item;
        return { severity, code: detail, source: "upstream", detail };
      }
      return { severity: defaultSeverity, code: item, source: "upstream", detail: item };
    }
    if (!isRecord(item)) return null;
    const severity = normalizeSeverity(item.severity) ?? defaultSeverity;
    const code = typeof item.code === "string" ? item.code : "upstream_finding";
    const source = typeof item.source === "string" ? item.source : "upstream";
    const detail = typeof item.detail === "string" ? item.detail : code;
    return { severity, code, source, detail };
  }).filter((item): item is QaLabRunBlocker => Boolean(item));
}

function requireSchema(value: JsonRecord, schema: string, blockers: QaLabRunBlocker[], code: string, source: QaLabRunEvidenceId): void {
  if (value.schema !== schema) addBlocker(blockers, "P1", code, source, `${titleForSource(source)} schema is invalid.`);
}

function requireReadyBoolean(value: JsonRecord, field: string, blockers: QaLabRunBlocker[], code: string, source: QaLabRunEvidenceId): void {
  if (value[field] !== true) addBlocker(blockers, "P1", code, source, `${titleForSource(source)} is not ready.`);
}

function requireReadyEither(value: JsonRecord, fields: string[], blockers: QaLabRunBlocker[], code: string, source: QaLabRunEvidenceId): void {
  if (!fields.some((field) => value[field] === true)) addBlocker(blockers, "P1", code, source, `${titleForSource(source)} is not ready.`);
}

function scenarioCountsFromEvidence(loaded: LoadedEvidence[]): { passed: number; failed: number } {
  const scenarioSweep = loaded.find((item) => item.spec.id === "scenarioSweep")?.value;
  const failed = numberValue(scenarioSweep?.failedScenarioCount) ?? 0;
  const total = numberValue(scenarioSweep?.scenarioCount) ?? numberValue(scenarioSweep?.totalScenarios) ?? null;
  if (total !== null) return { passed: Math.max(0, total - failed), failed };
  const passed = numberValue(scenarioSweep?.passedScenarios) ?? 0;
  return { passed, failed };
}

function buildDimensions(blockers: QaLabRunBlocker[], loaded: LoadedEvidence[]): QaLabRunReport["dimensions"] {
  const blockerCodes = blockers.map((blocker) => blocker.code).join(" ");
  const missingOrBlocked = loaded.filter((evidence) => ["missing", "invalid", "unsafe", "blocked"].includes(evidenceStatus(evidence))).length;
  return {
    privacy: {
      score: blockers.some((blocker) => blocker.severity === "P0" && /unsafe|privacy|secret|raw|transcript|path|screenshot|cookie|credential/i.test(blocker.code)) ? 0 : 5,
      notes: ["Public-safe evidence and privacy canaries were checked without echoing raw evidence."]
    },
    safety: {
      score: blockers.some((blocker) => blocker.severity === "P0" && /restricted|action|control|desktop|gui|publish|release|gateway/i.test(blocker.code)) ? 0 : 5,
      notes: ["Restricted action flags were checked; the QA Lab run itself is aggregate-only."]
    },
    retrieval: {
      score: blockerCodes.includes("workflow_run") || blockerCodes.includes("scenario_sweep") || blockerCodes.includes("scorecard_sweep") ? 0 : 5,
      notes: ["Workflow, scenario, and scorecard evidence were reconciled."]
    },
    packaging: {
      score: blockerCodes.includes("cli_mcp") || blockerCodes.includes("tool_coverage") || blockerCodes.includes("package") || blockerCodes.includes("sha") ? 0 : 5,
      notes: ["CLI/MCP, package version, candidate SHA, and tool coverage evidence were reconciled."]
    },
    claims: {
      score: missingOrBlocked > 0 || blockers.length > 0 ? 0 : 5,
      notes: ["Claim scope was checked against required evidence and explicit non-claims."]
    },
    agentUsability: {
      score: blockerCodes.includes("workflow_run") || blockerCodes.includes("tool_coverage") ? 0 : 5,
      notes: ["Agent-facing workflow and declared-tool coverage evidence were checked."]
    }
  };
}

function buildAdversarial(blockers: QaLabRunBlocker[]): QaLabRunReport["adversarial"] {
  const blocking = blockers.filter((blocker) => blocker.severity !== "P3");
  return Object.fromEntries(LENSES.map((lens) => [
    lens,
    {
      pass: blocking.filter((blocker) => findingMatchesLens(blocker, lens)).length === 0,
      findings: blocking.filter((blocker) => findingMatchesLens(blocker, lens))
    }
  ])) as QaLabRunReport["adversarial"];
}

function findingMatchesLens(blocker: QaLabRunBlocker, lens: QaLabRunAdversarialLens): boolean {
  const text = `${blocker.code} ${blocker.source} ${blocker.detail}`;
  if (lens === "safety") return /restricted|action|control|desktop|gui|publish|release|gateway|privacy|unsafe|secret|raw/i.test(text);
  if (lens === "retrieval") return /workflow|scenario|scorecard|tool_coverage|retrieval|summary|expand|search/i.test(text);
  if (lens === "packaging") return /package|sha|cli|mcp|published|install|tool_coverage/i.test(text);
  if (lens === "claims") return /claim|live_control|desktop|false|scope|matrix/i.test(text);
  return /workflow|tool|agent|gateway|coverage|missing/i.test(text);
}

function isPublicSafetyBlocker(blocker: QaLabRunBlocker): boolean {
  if (blocker.severity !== "P0") return false;
  return /not_public_safe|unsafe|privacy|secret|raw|transcript|path|screenshot|cookie|credential/i.test(`${blocker.code} ${blocker.detail}`);
}

function evidenceStatus(evidence: LoadedEvidence): QaLabRunEvidenceStatus {
  if (evidence.notRequired) return "not_required_by_claim_scope";
  if (evidence.missing) return "missing";
  if (evidence.unsafe || evidence.blockerCodes.some((code) => code.includes("unsafe"))) return "unsafe";
  if (evidence.invalid) return "invalid";
  if (evidence.blockerCodes.length > 0) return "blocked";
  return "ready";
}

function nextSafeCommands(options: QaLabRunOptions, claimScope: ReleaseClaimScope, loaded: LoadedEvidence[], qaLabReady: boolean): string[] {
  if (qaLabReady) {
    return [
      `loo qa-lab judge --run <evidence-dir>/qa-lab-run.json --rubric-version real-product-v1 --evidence-dir <evidence-dir> --strict`,
      `loo qa-lab adversarial-review --run <evidence-dir>/qa-lab-run.json --lenses safety,retrieval,packaging,claims,agent-usability --evidence-dir <evidence-dir> --strict`,
      `loo release ga-smoke --evidence-dir <evidence-dir> --package-version ${options.packageVersion} --candidate-sha ${options.candidateSha} --claim-scope ${claimScope} --qa-lab-run <evidence-dir>/qa-lab-run.json --strict`
    ];
  }
  const commands: string[] = [];
  for (const evidence of loaded) {
    const status = evidenceStatus(evidence);
    if (status === "ready" || status === "not_required_by_claim_scope") continue;
    commands.push(commandForEvidence(evidence.spec.id, options, claimScope));
  }
  return uniqueStrings(commands);
}

function commandForEvidence(id: QaLabRunEvidenceId, options: QaLabRunOptions, claimScope: ReleaseClaimScope): string {
  switch (id) {
    case "toolCoverage":
      return `loo qa-lab tool-coverage --evidence-dir <evidence-dir> --package-version ${options.packageVersion} --candidate-sha ${options.candidateSha} --claim-scope ${claimScope} --coverage-policy full --strict`;
    case "workflowRun":
      return `loo qa-lab workflow --scenario-id real-agent-core-workflow --surface openclaw-gateway --mode dry-run --evidence-dir <evidence-dir> --strict`;
    case "cliMcpProductSmoke":
      return `loo qa-lab cli-mcp-smoke --evidence-dir <evidence-dir> --package-version ${options.packageVersion} --candidate-sha ${options.candidateSha} --strict`;
    case "desktopContract":
      return `loo desktop proof-report --evidence-dir <evidence-dir> --observation-file <public-safe-observation.json> --strict`;
    case "liveControlMatrix":
      return `loo qa-lab live-control-matrix --evidence-dir <evidence-dir> --package-version ${options.packageVersion} --candidate-sha ${options.candidateSha} --claim-scope ${claimScope} --sacrificial-thread-id <send-sacrificial-thread-id> --sacrificial-thread-id <resume-sacrificial-thread-id> --sacrificial-thread-id <steer-sacrificial-thread-id> --sacrificial-thread-id <interrupt-sacrificial-thread-id> --send-report <send-report.json> --resume-report <resume-report.json> --steer-report <steer-report.json> --interrupt-report <interrupt-report.json> --strict`;
    case "scenarioSweep":
      return `loo eval scenarios --evidence-dir <evidence-dir> --package-version ${options.packageVersion} --candidate-sha ${options.candidateSha} --strict`;
    case "scorecardSweep":
      return `loo scorecards sweep --evidence-dir <evidence-dir> --claim-scope ${claimScope} --package-version ${options.packageVersion} --candidate-sha ${options.candidateSha} --strict`;
    case "privacyScan":
      return `Run the release privacy scan and save lco.privacyScan.v1 evidence with packageVersion ${options.packageVersion} and candidateSha ${options.candidateSha} to <evidence-dir>/privacy-scan.json.`;
  }
}

function addBlocker(blockers: QaLabRunBlocker[], severity: QaLabRunSeverity, code: string, source: string, detail: string): void {
  blockers.push({ severity, code: safeCode(code), source: safeCode(source), detail: safeDetail(detail) });
}

function uniqueFindings(findings: QaLabRunBlocker[]): QaLabRunBlocker[] {
  const seen = new Set<string>();
  const result: QaLabRunBlocker[] = [];
  for (const finding of findings) {
    const key = `${finding.severity}:${finding.code}:${finding.source}:${finding.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }
  return result;
}

function containsUnsafeValue(value: unknown): boolean {
  if (typeof value === "string") return SECRET_LIKE_PATTERN.test(value) || RAW_PRIVATE_VALUE_PATTERN.test(value);
  if (Array.isArray(value)) return value.some((item) => containsUnsafeValue(item));
  if (isRecord(value)) {
    return Object.entries(value).some(([key, item]) => {
      if ((SECRET_LIKE_KEY_PATTERN.test(key) || RAW_PRIVATE_VALUE_PATTERN.test(key)) && item !== false && item !== null && item !== undefined) return true;
      return containsUnsafeValue(item);
    });
  }
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

function safeEvidenceRef(path: string, evidenceDir: string, fallback: string): string {
  const ref = isPathInside(path, evidenceDir) ? relative(evidenceDir, path) || basename(path) : basename(path);
  if (SECRET_LIKE_PATTERN.test(ref) || RAW_REF_PATTERN.test(ref) || RAW_PRIVATE_VALUE_PATTERN.test(ref)) return "redacted-evidence-ref";
  return ref || fallback;
}

function sourceCode(source: string): string {
  return source.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function titleForSource(source: QaLabRunEvidenceId): string {
  return source.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase());
}

function normalizeSeverity(value: unknown): QaLabRunSeverity | null {
  if (value === "P0" || value === "P1" || value === "P2" || value === "P3") return value;
  return null;
}

function safeCode(code: string): string {
  if (SECRET_LIKE_PATTERN.test(code) || RAW_PRIVATE_VALUE_PATTERN.test(code) || PRIVATE_FINDING_DETAIL_PATTERN.test(code)) return "redacted_finding";
  return code.trim().replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 100) || "finding";
}

function safeDetail(detail: string): string {
  if (SECRET_LIKE_PATTERN.test(detail) || RAW_PRIVATE_VALUE_PATTERN.test(detail) || PRIVATE_FINDING_DETAIL_PATTERN.test(detail)) return "Redacted unsafe evidence detail.";
  return detail.slice(0, 260);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function shortSha(sha: string): string {
  return SHA_PATTERN.test(sha) ? sha.slice(0, 12) : "unknown";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isPathInside(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function noActions(): QaLabRunReport["actionsPerformed"] {
  return {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false,
    rawTranscriptRead: false,
    rawPromptRead: false,
    screenshotCaptured: false,
    sourceStoreMutation: false,
    gatewayScopeApproval: false,
    broadGatewayScopeApproval: false
  };
}
