import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type RuntimeSweepSummaryOptions = {
  evidenceDir: string;
  dryRunScenarios?: string;
  runtimeScenarios?: string;
  scorecardSweep?: string;
  publishedSmoke?: string;
  runtimeProofDir?: string;
  now?: string;
};

export type RuntimeSweepSummaryReport = {
  kind: "loo_runtime_sweep_summary";
  ok: boolean;
  summaryReady: boolean;
  generatedAt: string;
  summaryPath: string;
  dryRunScenarios: {
    ok: boolean;
    scenarioReady: boolean;
    scenarioCount: number;
    blockers: string[];
  };
  runtimeRequiredScenarios: {
    ok: boolean;
    scenarioReady: boolean;
    scenarioCount: number;
    blockers: string[];
  };
  runtimeProofMarkers: {
    foundCount: number;
    missingCount: number;
    missingMarkers: string[];
  };
  scorecards: {
    workingAppRuntimeProofReview: {
      status: string;
      blockers: string[];
    };
  };
  gatewaySetup: {
    classification: "ready" | "setup_required" | "package_failure_or_unknown" | "unknown";
    packageFailure: boolean;
    setupBlockers: string[];
  };
  claimBoundary: {
    readSearchExpandDryRun: boolean;
    workingAppProof: boolean;
    liveControlProof: boolean;
    desktopGuiMutationProof: boolean;
    supportedClaimScope: "codex-read-search-expand-dry-run" | "codex-working-app-proof" | "none";
    reasonCodes: string[];
  };
  actionsPerformed: {
    liveCodexControlRun: boolean;
    desktopGuiActionRun: boolean;
    npmPublished: boolean;
    githubReleaseCreated: boolean;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
  blockers: string[];
  nextAction: string;
};

type JsonObject = Record<string, unknown>;

const WORKING_APP_SCORECARD = "working-app-runtime-proof-review";

export function createRuntimeSweepSummary(options: RuntimeSweepSummaryOptions): RuntimeSweepSummaryReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const summaryPath = join(evidenceDir, "runtime-sweep-summary.json");
  const generatedAt = options.now ?? new Date().toISOString();

  const dryRunPayload = readJsonObject(options.dryRunScenarios);
  const runtimePayload = readJsonObject(options.runtimeScenarios);
  const scorecardPayload = readJsonObject(options.scorecardSweep);
  const publishedSmokePayload = readJsonObject(options.publishedSmoke);

  const dryRunScenarios = summarizeScenarioPayload(dryRunPayload);
  const runtimeRequiredScenarios = summarizeScenarioPayload(runtimePayload);
  const runtimeProofMarkers = summarizeRuntimeProofMarkers(runtimePayload, options.runtimeProofDir);
  const scorecards = summarizeScorecards(scorecardPayload);
  const gatewaySetup = summarizeGatewaySetup(publishedSmokePayload);
  const actionsPerformed = summarizeActions(publishedSmokePayload);
  const claimBoundary = summarizeClaimBoundary({
    dryRunReady: dryRunScenarios.scenarioReady,
    runtimeReady: runtimeRequiredScenarios.scenarioReady,
    missingRuntimeMarkers: runtimeProofMarkers.missingCount,
    workingAppScorecardBlockers: scorecards.workingAppRuntimeProofReview.blockers,
    gatewayClassification: gatewaySetup.classification
  });
  const blockers = [
    ...missingInputBlockers(options)
  ];
  const report: RuntimeSweepSummaryReport = {
    kind: "loo_runtime_sweep_summary",
    ok: blockers.length === 0,
    summaryReady: blockers.length === 0,
    generatedAt,
    summaryPath,
    dryRunScenarios,
    runtimeRequiredScenarios,
    runtimeProofMarkers,
    scorecards,
    gatewaySetup,
    claimBoundary,
    actionsPerformed,
    privateDataExclusions: [
      "raw Codex transcripts",
      "raw prompts or transcript spans",
      "raw gateway output",
      "screenshots or videos",
      "SQLite DB contents",
      "tokens, credentials, API keys, cookies",
      "private customer data"
    ],
    proofBoundary: "This summary clarifies runtime proof and release-claim scope from already public-safe sweep artifacts. It does not provide runtime proof, run live Codex control, mutate a GUI, publish npm, create tags, or create GitHub Releases.",
    blockers,
    nextAction: claimBoundary.workingAppProof
      ? "Proceed to scoped working-app release gates with the referenced runtime proof artifacts."
      : "Keep the release claim at codex-read-search-expand-dry-run until runtime proof markers, working-app scorecard, and gateway setup blockers are resolved."
  };
  writeFileSync(summaryPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function readJsonObject(path: string | undefined): JsonObject | null {
  if (!path) return null;
  try {
    const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

function summarizeScenarioPayload(payload: JsonObject | null): RuntimeSweepSummaryReport["dryRunScenarios"] {
  const scenarios = arrayField(payload, "scenarios");
  return {
    ok: booleanField(payload, "ok"),
    scenarioReady: booleanField(payload, "scenarioReady"),
    scenarioCount: scenarios.length,
    blockers: stringArrayField(payload, "blockers")
  };
}

function summarizeRuntimeProofMarkers(payload: JsonObject | null, runtimeProofDir: string | undefined): RuntimeSweepSummaryReport["runtimeProofMarkers"] {
  const scenarios = arrayField(payload, "scenarios");
  const missing = new Set<string>();
  for (const scenario of scenarios) {
    if (!isJsonObject(scenario)) continue;
    const proof = isJsonObject(scenario.runtimeProof) ? scenario.runtimeProof : null;
    const required = stringArrayField(proof, "requiredMarkers");
    const present = new Set(stringArrayField(proof, "presentMarkers"));
    for (const marker of required) {
      if (!present.has(marker)) missing.add(marker);
    }
    for (const blocker of stringArrayField(scenario, "blockers")) {
      const marker = blocker.match(/^runtime_proof_missing:[^:]+:(.+)$/)?.[1];
      if (marker) missing.add(marker);
    }
  }
  for (const blocker of stringArrayField(payload, "blockers")) {
    const marker = blocker.match(/^runtime_proof_missing:[^:]+:(.+)$/)?.[1];
    if (marker) missing.add(marker);
  }
  return {
    foundCount: countRuntimeProofFiles(runtimeProofDir),
    missingCount: missing.size,
    missingMarkers: [...missing].sort()
  };
}

function summarizeScorecards(payload: JsonObject | null): RuntimeSweepSummaryReport["scorecards"] {
  const scorecards = arrayField(payload, "scorecards");
  const card = scorecards.find((entry) => isJsonObject(entry) && stringField(entry, "name") === WORKING_APP_SCORECARD);
  const blockers = uniqueStrings([
    ...stringArrayField(payload, "blockers").filter((blocker) => blocker.includes(WORKING_APP_SCORECARD)),
    ...(isJsonObject(card) ? stringArrayField(card, "blockers") : [])
  ]);
  return {
    workingAppRuntimeProofReview: {
      status: isJsonObject(card) ? stringField(card, "status") ?? "unknown" : "unknown",
      blockers
    }
  };
}

function summarizeGatewaySetup(payload: JsonObject | null): RuntimeSweepSummaryReport["gatewaySetup"] {
  const setupBlockers = stringArrayField(payload, "setupBlockers");
  const recovery = isJsonObject(payload?.setupRecovery) ? payload?.setupRecovery as JsonObject : null;
  const recoveryClassification = stringField(recovery, "classification");
  const packageLikelyOk = booleanField(recovery, "packageInstallLikelyOk");
  if (setupBlockers.includes("openclaw_gateway_credentials_required") || recoveryClassification === "gateway_setup_required") {
    return { classification: "setup_required", packageFailure: false, setupBlockers };
  }
  if (recoveryClassification === "package_failure_or_unknown" || (!packageLikelyOk && setupBlockers.length > 0)) {
    return { classification: "package_failure_or_unknown", packageFailure: true, setupBlockers };
  }
  if (payload && setupBlockers.length === 0) {
    return { classification: "ready", packageFailure: false, setupBlockers };
  }
  return { classification: "unknown", packageFailure: false, setupBlockers };
}

function summarizeActions(payload: JsonObject | null): RuntimeSweepSummaryReport["actionsPerformed"] {
  const actions = isJsonObject(payload?.actionsPerformed) ? payload?.actionsPerformed as JsonObject : null;
  return {
    liveCodexControlRun: booleanField(actions, "liveCodexControlRun"),
    desktopGuiActionRun: booleanField(actions, "desktopGuiActionRun"),
    npmPublished: booleanField(actions, "npmPublished"),
    githubReleaseCreated: booleanField(actions, "githubReleaseCreated")
  };
}

function summarizeClaimBoundary(input: {
  dryRunReady: boolean;
  runtimeReady: boolean;
  missingRuntimeMarkers: number;
  workingAppScorecardBlockers: string[];
  gatewayClassification: RuntimeSweepSummaryReport["gatewaySetup"]["classification"];
}): RuntimeSweepSummaryReport["claimBoundary"] {
  const readSearchExpandDryRun = input.dryRunReady;
  const workingAppScorecardReady = input.workingAppScorecardBlockers.length === 0;
  const gatewayReady = input.gatewayClassification === "ready";
  const workingAppProof = input.runtimeReady && input.missingRuntimeMarkers === 0 && workingAppScorecardReady && gatewayReady;
  const reasonCodes = [
    ...(input.missingRuntimeMarkers > 0 || !input.runtimeReady ? ["runtime_proof_markers_missing"] : []),
    ...(workingAppScorecardReady ? [] : ["working_app_scorecard_not_run"]),
    ...(input.gatewayClassification === "setup_required" ? ["gateway_setup_required"] : []),
    ...(input.gatewayClassification === "package_failure_or_unknown" ? ["gateway_package_failure_or_unknown"] : [])
  ];
  return {
    readSearchExpandDryRun,
    workingAppProof,
    liveControlProof: false,
    desktopGuiMutationProof: false,
    supportedClaimScope: workingAppProof
      ? "codex-working-app-proof"
      : readSearchExpandDryRun
        ? "codex-read-search-expand-dry-run"
        : "none",
    reasonCodes
  };
}

function countRuntimeProofFiles(runtimeProofDir: string | undefined): number {
  if (!runtimeProofDir) return 0;
  const root = resolve(runtimeProofDir);
  if (!existsSync(root)) return 0;
  return countFilesRecursively(root, (name) => name.endsWith(".runtime-proof.json"));
}

function countFilesRecursively(path: string, predicate: (name: string) => boolean): number {
  const stat = statSync(path);
  if (stat.isFile()) return predicate(path) ? 1 : 0;
  if (!stat.isDirectory()) return 0;
  return readdirSync(path).reduce((count, name) => count + countFilesRecursively(join(path, name), predicate), 0);
}

function missingInputBlockers(options: RuntimeSweepSummaryOptions): string[] {
  return [
    ...(!options.dryRunScenarios ? ["dry_run_scenarios_missing"] : []),
    ...(!options.runtimeScenarios ? ["runtime_scenarios_missing"] : []),
    ...(!options.scorecardSweep ? ["scorecard_sweep_missing"] : []),
    ...(!options.publishedSmoke ? ["published_smoke_missing"] : [])
  ];
}

function arrayField(record: JsonObject | null, field: string): unknown[] {
  const value = record?.[field];
  return Array.isArray(value) ? value : [];
}

function stringArrayField(record: JsonObject | null, field: string): string[] {
  const value = record?.[field];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim()) : [];
}

function stringField(record: JsonObject | null, field: string): string | null {
  const value = record?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanField(record: JsonObject | null, field: string): boolean {
  return record?.[field] === true;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
