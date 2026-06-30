import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

export type ScenarioSweepOptions = {
  evidenceDir: string;
  scenarioDir?: string;
  now?: string;
  rootDir?: string;
};

export type ScenarioSweepEntry = {
  id: string;
  title: string;
  file: string;
  claimScope: string;
  userTask: string;
  surface: string;
  status: "dry_run_ready" | "invalid";
  evidencePath: string;
  allowedTools: string[];
  forbiddenBehaviors: string[];
  expectedPublicSafeEvidence: string[];
  privateDataExclusions: string[];
  metrics: Record<string, unknown>;
  dryRunPlan: {
    mode: "contract_only";
    toolSequence: string[];
    stopOnForbiddenBehavior: string[];
    requiredEvidence: string[];
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
  allowed_tools?: unknown;
  forbidden_behaviors?: unknown;
  expected_public_safe_evidence?: unknown;
  private_data_exclusions?: unknown;
  metrics?: unknown;
  proof_boundary?: unknown;
  next_action?: unknown;
};

export type RawEvidenceArtifact = {
  name: string;
  reason: "raw_codex_jsonl" | "sqlite_database" | "screenshot_or_image" | "video_capture";
};

export type SecretLikeEvidenceFinding = {
  name: string;
  reason: "secret_like_value";
};

const SCENARIO_VERSION = "1.0";
const REQUIRED_SCENARIO_FIELDS: Array<keyof ScenarioJson> = [
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
const REQUIRED_FORBIDDEN_BEHAVIORS = [
  "raw_transcript_read",
  "live_control",
  "gui_mutation",
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
  if (evidenceDir === scenarioDir) {
    throw new Error("--evidence-dir must be different from --scenario-dir");
  }
  const sourceDirForReport = scenarioDir.startsWith(`${packageRoot}/`) ? scenarioDir.slice(packageRoot.length + 1) : scenarioDir;

  mkdirSync(evidenceDir, { recursive: true });
  const scenarios = readScenarios(scenarioDir, evidenceDir);
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
  const report: ScenarioSweepReport = {
    ok: blockers.length === 0,
    scenarioReady: blockers.length === 0,
    publicSafe: rawEvidenceArtifacts.length === 0 && secretLikeEvidenceFindings.length === 0,
    generatedAt: options.now ?? new Date().toISOString(),
    scenarioVersion: SCENARIO_VERSION,
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
    proofBoundary: "This QA Lab scenario sweep validates dry-run eval contracts only; it does not read raw transcripts, run live Codex control, mutate a GUI, publish npm, or create a GitHub Release.",
    nextAction: blockers.length === 0
      ? "Use these dry-run-ready scenario contracts as the QA Lab task pack for fixture, CLI, MCP, and OpenClaw gateway evals."
      : "Repair malformed scenario contracts or remove unsafe evidence artifacts before using this QA Lab packet."
  };

  writeFileSync(sweepPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function readScenarios(scenarioDir: string, evidenceDir: string): ScenarioSweepEntry[] {
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
    .map((file) => readScenario(join(scenarioDir, file), file, evidenceDir));
}

function readScenario(path: string, file: string, evidenceDir: string): ScenarioSweepEntry {
  try {
    const scenario = JSON.parse(readFileSync(path, "utf8")) as ScenarioJson;
    const id = stringValue(scenario.id) || basename(file, ".json");
    const allowedTools = stringArray(scenario.allowed_tools);
    const forbiddenBehaviors = stringArray(scenario.forbidden_behaviors);
    const expectedPublicSafeEvidence = stringArray(scenario.expected_public_safe_evidence);
    const privateDataExclusions = stringArray(scenario.private_data_exclusions).length
      ? stringArray(scenario.private_data_exclusions)
      : DEFAULT_PRIVATE_DATA_EXCLUSIONS;
    const proofBoundary = stringValue(scenario.proof_boundary) || "No proof boundary supplied.";
    const missingFieldBlockers = REQUIRED_SCENARIO_FIELDS
      .filter((field) => !hasRequiredFieldValue(scenario[field]))
      .map((field) => `scenario_missing_field:${id}:${camelScenarioField(field)}`);
    const missingForbiddenBehaviorBlockers = REQUIRED_FORBIDDEN_BEHAVIORS
      .filter((behavior) => !forbiddenBehaviors.includes(behavior))
      .map((behavior) => `scenario_missing_required_forbidden_behavior:${id}:${behavior}`);
    const invalidVersionBlockers = scenario.scenario_version === SCENARIO_VERSION ? [] : [`scenario_invalid_version:${id}`];
    const blockers = [...invalidVersionBlockers, ...missingFieldBlockers, ...missingForbiddenBehaviorBlockers];
    const entry: ScenarioSweepEntry = {
      id,
      title: stringValue(scenario.title) || id,
      file,
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
