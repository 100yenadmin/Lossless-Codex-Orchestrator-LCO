import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

export type ScenarioSweepOptions = {
  evidenceDir: string;
  scenarioDir?: string;
  runtimeProofDir?: string;
  now?: string;
  rootDir?: string;
};

export type ScenarioSweepEntry = {
  id: string;
  title: string;
  file: string;
  scenarioVersion: string;
  claimScope: string;
  userTask: string;
  surface: string;
  status: "dry_run_ready" | "runtime_proof_required" | "runtime_proof_ready" | "invalid";
  evidencePath: string;
  allowedTools: string[];
  forbiddenBehaviors: string[];
  expectedPublicSafeEvidence: string[];
  privateDataExclusions: string[];
  metrics: Record<string, unknown>;
  dryRunPlan: {
    mode: "contract_only" | "runtime_required";
    toolSequence: string[];
    stopOnForbiddenBehavior: string[];
    requiredEvidence: string[];
  };
  runtimeProof?: {
    proofMode: "runtime_required";
    proofPath: string;
    requiredMarkers: string[];
    presentMarkers: string[];
    publicSafe: boolean;
  };
  proofBoundary: string;
  nextAction: string;
  blockers: string[];
};

export type ScenarioSweepReport = {
  ok: boolean;
  scenarioReady: boolean;
  publicSafe: boolean;
  generatedAt: string;
  scenarioVersion: string;
  scenarioSourceDir: string;
  sweepPath: string;
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
    npmPublished: false;
    githubReleaseCreated: false;
  };
  scenarios: ScenarioSweepEntry[];
  rawEvidenceArtifacts: RawEvidenceArtifact[];
  secretLikeEvidenceFindings: SecretLikeEvidenceFinding[];
  blockers: string[];
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

type ScenarioJson = {
  scenario_version?: unknown;
  id?: unknown;
  title?: unknown;
  claim_scope?: unknown;
  user_task?: unknown;
  surface?: unknown;
  proof_mode?: unknown;
  allowed_tools?: unknown;
  required_tools?: unknown;
  allowed_live_behaviors?: unknown;
  forbidden_behaviors?: unknown;
  expected_public_safe_evidence?: unknown;
  private_data_exclusions?: unknown;
  metrics?: unknown;
  proof_boundary?: unknown;
  next_action?: unknown;
};

type RuntimeProofJson = {
  kind?: unknown;
  scenario_id?: unknown;
  scenario_version?: unknown;
  proof_mode?: unknown;
  claim_scope?: unknown;
  public_safe?: unknown;
  proof_markers?: unknown;
  raw_transcript_read?: unknown;
  raw_prompt_included?: unknown;
  raw_secret_included?: unknown;
  screenshot_included?: unknown;
  sqlite_included?: unknown;
  live_action_count?: unknown;
  raw_prompt_chars?: unknown;
  raw_transcript_spans?: unknown;
  screenshot_count?: unknown;
};

export type RawEvidenceArtifact = {
  name: string;
  reason: "raw_codex_jsonl" | "sqlite_database" | "screenshot_or_image" | "video_capture";
};

export type SecretLikeEvidenceFinding = {
  name: string;
  reason: "secret_like_value";
};

const DRY_RUN_SCENARIO_VERSION = "1.0";
const RUNTIME_SCENARIO_VERSION = "1.1";
const REQUIRED_DRY_RUN_SCENARIO_FIELDS: Array<keyof ScenarioJson> = [
  "scenario_version",
  "id",
  "title",
  "claim_scope",
  "user_task",
  "surface",
  "allowed_tools",
  "forbidden_behaviors",
  "expected_public_safe_evidence",
  "private_data_exclusions",
  "metrics",
  "proof_boundary"
];
const REQUIRED_RUNTIME_SCENARIO_FIELDS: Array<keyof ScenarioJson> = [
  "scenario_version",
  "id",
  "title",
  "claim_scope",
  "user_task",
  "surface",
  "proof_mode",
  "required_tools",
  "forbidden_behaviors",
  "expected_public_safe_evidence",
  "metrics",
  "proof_boundary"
];
const REQUIRED_DRY_RUN_FORBIDDEN_BEHAVIORS = [
  "raw_transcript_read",
  "live_control",
  "gui_mutation",
  "secret_or_private_data_output"
];
const REQUIRED_RUNTIME_FORBIDDEN_BEHAVIORS = [
  "raw_transcript_read",
  "unauthorized_live_control",
  "unscoped_gui_mutation",
  "secret_or_private_data_output"
];
const DEFAULT_PRIVATE_DATA_EXCLUSIONS = [
  "raw Codex transcripts",
  "raw prompts or transcript spans",
  "SQLite DBs",
  "screenshots or videos",
  "tokens, credentials, API keys, cookies",
  "private customer data"
];
const SECRET_LIKE_PATTERN = /(npm_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

export function createScenarioSweep(options: ScenarioSweepOptions): ScenarioSweepReport {
  const evidenceDir = resolve(options.evidenceDir);
  const packageRoot = options.rootDir ? resolve(options.rootDir) : findPackageRoot(dirname(fileURLToPath(import.meta.url))) ?? process.cwd();
  const scenarioDir = options.scenarioDir ? resolve(options.scenarioDir) : join(packageRoot, "evals", "scenarios", "v1");
  const runtimeProofDir = options.runtimeProofDir ? resolve(options.runtimeProofDir) : undefined;
  if (evidenceDir === scenarioDir) {
    throw new Error("--evidence-dir must be different from --scenario-dir");
  }
  const sourceDirForReport = scenarioDir.startsWith(`${packageRoot}/`) ? scenarioDir.slice(packageRoot.length + 1) : scenarioDir;

  mkdirSync(evidenceDir, { recursive: true });
  const scenarios = readScenarios(scenarioDir, evidenceDir, runtimeProofDir);
  const rawEvidenceArtifacts = scanRawEvidenceArtifacts(evidenceDir);
  const secretLikeEvidenceFindings = scanSecretLikeEvidence(evidenceDir);
  const rawArtifactBlockers = rawEvidenceArtifacts.map((artifact) => `raw_artifact:${artifact.reason}:${artifact.name}`);
  const secretBlockers = secretLikeEvidenceFindings.map((finding) => `secret_like_evidence:${finding.name}`);
  const blockers = [
    ...scenarios.flatMap((scenario) => scenario.blockers),
    ...(scenarios.length === 0 ? ["no_scenarios"] : []),
    ...rawArtifactBlockers,
    ...secretBlockers
  ];
  const sweepPath = join(evidenceDir, "scenario-sweep.json");
  const hasRuntimeScenarios = scenarios.some((scenario) => scenario.dryRunPlan.mode === "runtime_required");
  const runtimeProofUnsafeBlockers = scenarios.flatMap((scenario) => scenario.blockers).filter((blocker) =>
    /^runtime_proof_(?:not_public_safe|raw_private|secret_like):/.test(blocker)
  );
  const report: ScenarioSweepReport = {
    ok: blockers.length === 0,
    scenarioReady: blockers.length === 0,
    publicSafe: rawEvidenceArtifacts.length === 0 && secretLikeEvidenceFindings.length === 0 && runtimeProofUnsafeBlockers.length === 0,
    generatedAt: options.now ?? new Date().toISOString(),
    scenarioVersion: scenarioVersionForReport(scenarios),
    scenarioSourceDir: sourceDirForReport,
    sweepPath,
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    scenarios,
    rawEvidenceArtifacts,
    secretLikeEvidenceFindings,
    blockers,
    privateDataExclusions: uniqueStrings(scenarios.flatMap((scenario) => scenario.privateDataExclusions).concat(DEFAULT_PRIVATE_DATA_EXCLUSIONS)),
    proofBoundary: hasRuntimeScenarios
      ? "This QA Lab scenario sweep validates runtime-required working-app proof markers without performing live Codex control, mutating a GUI, publishing npm, or creating a GitHub Release."
      : "This QA Lab scenario sweep validates dry-run eval contracts only; it does not read raw transcripts, run live Codex control, mutate a GUI, publish npm, or create a GitHub Release.",
    nextAction: blockers.length === 0
      ? hasRuntimeScenarios
        ? "Use these runtime-proof-ready scenario markers as the QA Lab working-app evidence packet."
        : "Use these dry-run-ready scenario contracts as the QA Lab task pack for fixture, CLI, MCP, and OpenClaw gateway evals."
      : "Repair malformed scenario contracts or remove unsafe evidence artifacts before using this QA Lab packet."
  };

  writeFileSync(sweepPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function readScenarios(scenarioDir: string, evidenceDir: string, runtimeProofDir: string | undefined): ScenarioSweepEntry[] {
  if (!existsSync(scenarioDir)) {
    const entry: ScenarioSweepEntry = invalidScenarioEntry({
      id: "scenario-directory",
      title: "Scenario directory",
      file: scenarioDir,
      evidenceDir,
      blockers: ["scenario_directory_missing"],
      proofBoundary: "No scenario proof exists because the scenario directory is missing."
    });
    writeScenarioEntry(entry);
    return [entry];
  }

  return readdirSync(scenarioDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => readScenario(join(scenarioDir, file), file, evidenceDir, runtimeProofDir));
}

function readScenario(path: string, file: string, evidenceDir: string, runtimeProofDir: string | undefined): ScenarioSweepEntry {
  try {
    const scenario = JSON.parse(readFileSync(path, "utf8")) as ScenarioJson;
    if (stringValue(scenario.scenario_version) === RUNTIME_SCENARIO_VERSION || stringValue(scenario.proof_mode) === "runtime_required") {
      return readRuntimeScenario(scenario, file, evidenceDir, runtimeProofDir);
    }
    return readDryRunScenario(scenario, file, evidenceDir);
  } catch {
    const id = basename(file, ".json");
    const entry = invalidScenarioEntry({
      id,
      title: id,
      file,
      evidenceDir,
      blockers: [`scenario_invalid_json:${id}`],
      proofBoundary: "Invalid scenario JSON cannot prove QA Lab readiness."
    });
    writeScenarioEntry(entry);
    return entry;
  }
}

function readDryRunScenario(scenario: ScenarioJson, file: string, evidenceDir: string): ScenarioSweepEntry {
  const requestedId = stringValue(scenario.id);
  const fallbackId = safeEvidenceStem(basename(file, ".json")) || "scenario";
  const id = isSafeScenarioId(requestedId) ? requestedId : fallbackId;
  const allowedTools = stringArray(scenario.allowed_tools);
  const forbiddenBehaviors = stringArray(scenario.forbidden_behaviors);
  const expectedPublicSafeEvidence = stringArray(scenario.expected_public_safe_evidence);
  const privateDataExclusions = stringArray(scenario.private_data_exclusions).length
    ? stringArray(scenario.private_data_exclusions)
    : DEFAULT_PRIVATE_DATA_EXCLUSIONS;
  const proofBoundary = stringValue(scenario.proof_boundary) || "No proof boundary supplied.";
  const missingFieldBlockers = REQUIRED_DRY_RUN_SCENARIO_FIELDS
    .filter((field) => !hasRequiredFieldValue(scenario[field]))
    .map((field) => `scenario_missing_field:${id}:${camelScenarioField(field)}`);
  const missingForbiddenBehaviorBlockers = REQUIRED_DRY_RUN_FORBIDDEN_BEHAVIORS
    .filter((behavior) => !forbiddenBehaviors.includes(behavior))
    .map((behavior) => `scenario_missing_required_forbidden_behavior:${id}:${behavior}`);
  const invalidVersionBlockers = scenario.scenario_version === DRY_RUN_SCENARIO_VERSION ? [] : [`scenario_invalid_version:${id}`];
  const invalidIdBlockers = requestedId && !isSafeScenarioId(requestedId) ? [`scenario_invalid_id:${id}`] : [];
  const blockers = [...invalidVersionBlockers, ...invalidIdBlockers, ...missingFieldBlockers, ...missingForbiddenBehaviorBlockers];
  const entry: ScenarioSweepEntry = {
    id,
    title: stringValue(scenario.title) || id,
    file,
    scenarioVersion: stringValue(scenario.scenario_version) || "unknown",
    claimScope: stringValue(scenario.claim_scope) || "unknown",
    userTask: stringValue(scenario.user_task) || "",
    surface: stringValue(scenario.surface) || "unknown",
    status: blockers.length === 0 ? "dry_run_ready" : "invalid",
    evidencePath: join(evidenceDir, `${id}.json`),
    allowedTools,
    forbiddenBehaviors,
    expectedPublicSafeEvidence,
    privateDataExclusions,
    metrics: objectValue(scenario.metrics),
    dryRunPlan: {
      mode: "contract_only",
      toolSequence: allowedTools,
      stopOnForbiddenBehavior: forbiddenBehaviors,
      requiredEvidence: expectedPublicSafeEvidence
    },
    proofBoundary,
    nextAction: stringValue(scenario.next_action) || "Run this scenario through fixture, CLI, MCP, or OpenClaw gateway evidence when the matching surface is ready.",
    blockers
  };
  writeScenarioEntry(entry);
  return entry;
}

function readRuntimeScenario(scenario: ScenarioJson, file: string, evidenceDir: string, runtimeProofDir: string | undefined): ScenarioSweepEntry {
  const requestedId = stringValue(scenario.id);
  const fallbackId = safeEvidenceStem(basename(file, ".json")) || "scenario";
  const id = isSafeScenarioId(requestedId) ? requestedId : fallbackId;
  const requiredTools = stringArray(scenario.required_tools);
  const forbiddenBehaviors = stringArray(scenario.forbidden_behaviors);
  const expectedPublicSafeEvidence = stringArray(scenario.expected_public_safe_evidence);
  const privateDataExclusions = stringArray(scenario.private_data_exclusions).length
    ? stringArray(scenario.private_data_exclusions)
    : DEFAULT_PRIVATE_DATA_EXCLUSIONS;
  const metrics = objectValue(scenario.metrics);
  const proofBoundary = stringValue(scenario.proof_boundary) || "No proof boundary supplied.";
  const requiredMarkers = runtimeRequiredMarkers(metrics);
  const proof = validateRuntimeProof({
    claimScope: stringValue(scenario.claim_scope) || "unknown",
    id,
    metrics,
    requiredMarkers,
    runtimeProofDir
  });
  const missingFieldBlockers = REQUIRED_RUNTIME_SCENARIO_FIELDS
    .filter((field) => !hasRequiredFieldValue(scenario[field]))
    .map((field) => `scenario_missing_field:${id}:${camelScenarioField(field)}`);
  const missingForbiddenBehaviorBlockers = REQUIRED_RUNTIME_FORBIDDEN_BEHAVIORS
    .filter((behavior) => !forbiddenBehaviors.includes(behavior))
    .map((behavior) => `scenario_missing_required_forbidden_behavior:${id}:${behavior}`);
  const invalidVersionBlockers = scenario.scenario_version === RUNTIME_SCENARIO_VERSION ? [] : [`scenario_invalid_version:${id}`];
  const invalidProofModeBlockers = scenario.proof_mode === "runtime_required" ? [] : [`scenario_invalid_proof_mode:${id}`];
  const invalidIdBlockers = requestedId && !isSafeScenarioId(requestedId) ? [`scenario_invalid_id:${id}`] : [];
  const contractBlockers = [
    ...invalidVersionBlockers,
    ...invalidProofModeBlockers,
    ...invalidIdBlockers,
    ...missingFieldBlockers,
    ...missingForbiddenBehaviorBlockers
  ];
  const blockers = [...contractBlockers, ...proof.blockers];
  const entry: ScenarioSweepEntry = {
    id,
    title: stringValue(scenario.title) || id,
    file,
    scenarioVersion: stringValue(scenario.scenario_version) || "unknown",
    claimScope: stringValue(scenario.claim_scope) || "unknown",
    userTask: stringValue(scenario.user_task) || "",
    surface: stringValue(scenario.surface) || "unknown",
    status: contractBlockers.length > 0 ? "invalid" : proof.blockers.length > 0 ? "runtime_proof_required" : "runtime_proof_ready",
    evidencePath: join(evidenceDir, `${id}.json`),
    allowedTools: requiredTools,
    forbiddenBehaviors,
    expectedPublicSafeEvidence,
    privateDataExclusions,
    metrics,
    dryRunPlan: {
      mode: "runtime_required",
      toolSequence: requiredTools,
      stopOnForbiddenBehavior: forbiddenBehaviors,
      requiredEvidence: expectedPublicSafeEvidence
    },
    runtimeProof: {
      proofMode: "runtime_required",
      proofPath: proof.proofPath,
      requiredMarkers,
      presentMarkers: proof.presentMarkers,
      publicSafe: proof.publicSafe
    },
    proofBoundary,
    nextAction: stringValue(scenario.next_action) || "Attach public-safe runtime proof markers before claiming this working-app scenario.",
    blockers
  };
  writeScenarioEntry(entry);
  return entry;
}

function invalidScenarioEntry(input: {
  id: string;
  title: string;
  file: string;
  evidenceDir: string;
  blockers: string[];
  proofBoundary: string;
}): ScenarioSweepEntry {
  return {
    id: input.id,
    title: input.title,
    file: input.file,
    scenarioVersion: "unknown",
    claimScope: "unknown",
    userTask: "",
    surface: "unknown",
    status: "invalid",
    evidencePath: join(input.evidenceDir, `${input.id}.json`),
    allowedTools: [],
    forbiddenBehaviors: [],
    expectedPublicSafeEvidence: [],
    privateDataExclusions: DEFAULT_PRIVATE_DATA_EXCLUSIONS,
    metrics: {},
    dryRunPlan: {
      mode: "contract_only",
      toolSequence: [],
      stopOnForbiddenBehavior: [],
      requiredEvidence: []
    },
    proofBoundary: input.proofBoundary,
    nextAction: "Repair the scenario source before running QA Lab sweeps.",
    blockers: input.blockers
  };
}

function writeScenarioEntry(entry: ScenarioSweepEntry): void {
  writeFileSync(entry.evidencePath, `${JSON.stringify(entry, null, 2)}\n`);
}

function validateRuntimeProof(input: {
  claimScope: string;
  id: string;
  metrics: Record<string, unknown>;
  requiredMarkers: string[];
  runtimeProofDir: string | undefined;
}): {
  blockers: string[];
  proofPath: string;
  presentMarkers: string[];
  publicSafe: boolean;
} {
  const proofPath = input.runtimeProofDir ? join(input.runtimeProofDir, `${input.id}.runtime-proof.json`) : "";
  if (!input.runtimeProofDir || !existsSync(proofPath)) {
    return {
      blockers: input.requiredMarkers.length
        ? input.requiredMarkers.map((marker) => `runtime_proof_missing:${input.id}:${marker}`)
        : [`runtime_proof_missing:${input.id}:proof_marker`],
      proofPath,
      presentMarkers: [],
      publicSafe: false
    };
  }

  const proofText = readFileSync(proofPath, "utf8");
  const secretLikeBlockers = SECRET_LIKE_PATTERN.test(proofText) ? [`runtime_proof_secret_like:${input.id}`] : [];
  let proof: RuntimeProofJson;
  try {
    proof = JSON.parse(proofText) as RuntimeProofJson;
  } catch {
    return {
      blockers: [`runtime_proof_invalid_json:${input.id}`, ...secretLikeBlockers],
      proofPath,
      presentMarkers: [],
      publicSafe: false
    };
  }

  const markerRecord = objectValue(proof.proof_markers);
  const presentMarkers = Object.entries(markerRecord)
    .filter(([, value]) => value === true)
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right));
  const blockers = [
    ...(proof.kind === "loo_runtime_scenario_proof" ? [] : [`runtime_proof_invalid:${input.id}:kind`]),
    ...(proof.scenario_id === input.id ? [] : [`runtime_proof_invalid:${input.id}:scenario_id`]),
    ...(proof.scenario_version === RUNTIME_SCENARIO_VERSION ? [] : [`runtime_proof_invalid:${input.id}:scenario_version`]),
    ...(proof.proof_mode === "runtime_required" ? [] : [`runtime_proof_invalid:${input.id}:proof_mode`]),
    ...(proof.claim_scope === input.claimScope ? [] : [`runtime_proof_invalid:${input.id}:claim_scope`]),
    ...(proof.public_safe === true ? [] : [`runtime_proof_not_public_safe:${input.id}`]),
    ...(proof.raw_transcript_read === false ? [] : [`runtime_proof_raw_private:${input.id}:raw_transcript_read`]),
    ...(proof.raw_prompt_included === false ? [] : [`runtime_proof_raw_private:${input.id}:raw_prompt_included`]),
    ...(proof.raw_secret_included === false ? [] : [`runtime_proof_raw_private:${input.id}:raw_secret_included`]),
    ...(proof.screenshot_included === false ? [] : [`runtime_proof_raw_private:${input.id}:screenshot_included`]),
    ...(proof.sqlite_included === false ? [] : [`runtime_proof_raw_private:${input.id}:sqlite_included`]),
    ...secretLikeBlockers,
    ...input.requiredMarkers
      .filter((marker) => markerRecord[marker] !== true)
      .map((marker) => `runtime_proof_missing:${input.id}:${marker}`),
    ...runtimeLimitBlockers(input.id, input.metrics, proof)
  ];

  return {
    blockers,
    proofPath,
    presentMarkers,
    publicSafe: proof.public_safe === true && blockers.every((blocker) =>
      !blocker.startsWith(`runtime_proof_raw_private:${input.id}`) && blocker !== `runtime_proof_secret_like:${input.id}`
    )
  };
}

function runtimeRequiredMarkers(metrics: Record<string, unknown>): string[] {
  return Object.entries(metrics)
    .filter(([key, value]) => key.startsWith("requires_") && value === true)
    .map(([key]) => key.replace(/^requires_/, ""))
    .sort((left, right) => left.localeCompare(right));
}

function runtimeLimitBlockers(id: string, metrics: Record<string, unknown>, proof: RuntimeProofJson): string[] {
  const checks: Array<[string, unknown, unknown]> = [
    ["live_action_count", metrics.max_live_actions, proof.live_action_count],
    ["raw_prompt_chars", metrics.max_raw_prompt_chars, proof.raw_prompt_chars],
    ["raw_transcript_spans", metrics.max_raw_transcript_spans, proof.raw_transcript_spans],
    ["screenshot_count", metrics.max_screenshots_in_public_evidence, proof.screenshot_count]
  ];
  return checks.flatMap(([field, maxValue, actualValue]) => {
    if (typeof maxValue !== "number") return [];
    if (typeof actualValue !== "number") return [`runtime_proof_missing:${id}:${field}`];
    if (!Number.isInteger(actualValue) || actualValue < 0) return [`runtime_proof_invalid:${id}:${field}`];
    return actualValue <= maxValue ? [] : [`runtime_proof_limit_exceeded:${id}:${field}`];
  });
}

function scenarioVersionForReport(scenarios: ScenarioSweepEntry[]): string {
  const versions = uniqueStrings(scenarios.map((scenario) => scenario.scenarioVersion).filter((version) => version !== "unknown"));
  if (versions.length === 0) return "unknown";
  return versions.length === 1 ? versions[0] ?? "unknown" : "mixed";
}

function hasRequiredFieldValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" && item.trim().length > 0);
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== undefined && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}

function camelScenarioField(field: keyof ScenarioJson): string {
  return field.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function isSafeScenarioId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);
}

function safeEvidenceStem(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 128);
}

function scanRawEvidenceArtifacts(evidenceDir: string): RawEvidenceArtifact[] {
  if (!existsSync(evidenceDir)) return [];
  const artifacts: RawEvidenceArtifact[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      const reason = rawArtifactReason(entry.name);
      if (reason) artifacts.push({
        name: relative(evidenceDir, path).replace(/\\/g, "/"),
        reason
      });
    }
  };
  visit(evidenceDir);
  return artifacts.sort((left, right) => left.name.localeCompare(right.name));
}

function rawArtifactReason(name: string): RawEvidenceArtifact["reason"] | null {
  const normalizedName = name.toLowerCase();
  const extension = extname(normalizedName);
  if (normalizedName.endsWith(".jsonl") || normalizedName.endsWith(".jsonl.gz")) return "raw_codex_jsonl";
  if (
    normalizedName.endsWith(".sqlite")
    || normalizedName.endsWith(".sqlite-wal")
    || normalizedName.endsWith(".sqlite-shm")
    || normalizedName.endsWith(".db")
  ) return "sqlite_database";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic"].includes(extension)) return "screenshot_or_image";
  if ([".mp4", ".mov", ".webm", ".mkv"].includes(extension)) return "video_capture";
  return null;
}

function scanSecretLikeEvidence(evidenceDir: string): SecretLikeEvidenceFinding[] {
  if (!existsSync(evidenceDir)) return [];
  const findings: SecretLikeEvidenceFinding[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (rawArtifactReason(entry.name)) continue;
      if (!isTextEvidenceFile(entry.name)) continue;
      const text = readFileSync(path, "utf8");
      if (SECRET_LIKE_PATTERN.test(text)) {
        findings.push({
          name: relative(evidenceDir, path).replace(/\\/g, "/"),
          reason: "secret_like_value"
        });
      }
    }
  };
  visit(evidenceDir);
  return findings.sort((left, right) => left.name.localeCompare(right.name));
}

function isTextEvidenceFile(name: string): boolean {
  return [".json", ".md", ".txt", ".log"].includes(extname(name.toLowerCase()));
}

function findPackageRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
