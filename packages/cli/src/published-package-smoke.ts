import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PublishedPackageSmokeOptions = {
  evidenceDir?: string;
  rootDir?: string;
  now?: string;
  registryBetaVersion?: string;
  dogfoodReportPath: string;
  toolSmokeReportPath: string;
};

export type PublishedPackageSmokeReport = {
  ok: boolean;
  publishedSmokeReady: boolean;
  packagePathOk: boolean;
  publicSafe: true;
  localOnly: true;
  dryRun: true;
  generatedAt: string;
  packageName: string;
  localVersion: string;
  expectedPackage: "lossless-openclaw-orchestrator@beta";
  registryBetaVersion: string | null;
  versionMatchStatus: "not_run" | "matches_registry_beta" | "registry_beta_mismatch";
  dogfood: {
    dogfoodReady: boolean;
    installOutcomeStatus: string;
    requiredToolsPresent: boolean;
  };
  toolSmoke: {
    toolSmokeReady: boolean;
    gatewaySetupClassification: "ready" | "gateway_setup_required" | "gateway_blocked" | "unknown";
    packageInstallLikelyOk: boolean;
  };
  setupRequired: boolean;
  setupBlockers: string[];
  blockers: string[];
  nextSafeCommands: string[];
  actionsPerformed: {
    npmPublished: false;
    githubReleaseCreated: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
};

const PACKAGE_NAME = "lossless-openclaw-orchestrator";

export function createPublishedPackageSmokeReport(options: PublishedPackageSmokeOptions): PublishedPackageSmokeReport {
  const rootDir = options.rootDir
    ? resolve(options.rootDir)
    : findPackageRoot(dirname(fileURLToPath(import.meta.url))) ?? process.cwd();
  const packageJson = readPackageJson(rootDir);
  const dogfood = readJsonObject(options.dogfoodReportPath);
  const toolSmoke = readJsonObject(options.toolSmokeReportPath);
  const dogfoodReady = dogfood.ok === true && dogfood.dogfoodReady === true;
  const requiredToolsPresent = dogfood.requiredToolsPresent === true;
  const installOutcomeStatus = readNestedString(dogfood, ["installOutcome", "status"]) || "unknown";
  const toolSmokeReady = toolSmoke.ok === true && toolSmoke.toolSmokeReady === true;
  const gatewaySetupClassification = readGatewaySetupClassification(toolSmoke);
  const packageInstallLikelyOk = readNestedBoolean(toolSmoke, ["setupStatus", "packageInstallLikelyOk"]);
  const setupBlockers = readStringArray(toolSmoke.setupBlockers);
  const setupRequired = gatewaySetupClassification === "gateway_setup_required";
  const versionMatchStatus = options.registryBetaVersion
    ? options.registryBetaVersion === packageJson.version
      ? "matches_registry_beta"
      : "registry_beta_mismatch"
    : "not_run";
  const blockers = [
    ...(packageJson.name === PACKAGE_NAME ? [] : ["package_name_mismatch"]),
    ...(versionMatchStatus === "registry_beta_mismatch" ? ["registry_beta_version_mismatch"] : []),
    ...(dogfoodReady ? [] : ["openclaw_dogfood_not_ready"]),
    ...(requiredToolsPresent ? [] : ["openclaw_required_tools_missing"]),
    ...(!toolSmokeReady && !setupRequired ? ["openclaw_tool_smoke_not_ready"] : []),
    ...(setupRequired && !packageInstallLikelyOk ? ["openclaw_gateway_setup_not_package_safe"] : [])
  ];
  const packagePathOk = blockers.length === 0;
  const report: PublishedPackageSmokeReport = {
    ok: packagePathOk,
    publishedSmokeReady: packagePathOk && toolSmokeReady,
    packagePathOk,
    publicSafe: true,
    localOnly: true,
    dryRun: true,
    generatedAt: options.now ?? new Date().toISOString(),
    packageName: packageJson.name,
    localVersion: packageJson.version,
    expectedPackage: "lossless-openclaw-orchestrator@beta",
    registryBetaVersion: options.registryBetaVersion ?? null,
    versionMatchStatus,
    dogfood: {
      dogfoodReady,
      installOutcomeStatus,
      requiredToolsPresent
    },
    toolSmoke: {
      toolSmokeReady,
      gatewaySetupClassification,
      packageInstallLikelyOk
    },
    setupRequired,
    setupBlockers,
    blockers,
    nextSafeCommands: [
      "npm view lossless-openclaw-orchestrator@beta version dist-tags --json",
      "loo openclaw dogfood --profile lco-dogfood-published --install-source lossless-openclaw-orchestrator@beta --required-tool loo_doctor --required-tool loo_search_sessions --strict",
      "loo openclaw tool-smoke --profile lco-dogfood-published --required-tool loo_doctor --required-tool loo_search_sessions --strict",
      "loo onboard status --registry-beta-version <version> --gateway-setup-status ready --strict"
    ],
    actionsPerformed: {
      npmPublished: false,
      githubReleaseCreated: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false
    },
    privateDataExclusions: [
      "raw npm stdout/stderr",
      "raw OpenClaw gateway output",
      "raw Codex transcripts",
      "raw prompts or message text",
      "tokens, credentials, API keys, cookies",
      "private customer data"
    ],
    proofBoundary: "This published package smoke report summarizes public-safe beta install and gateway setup evidence only; it does not run live Codex control, mutate a desktop GUI, publish npm, create a GitHub Release, store raw npm output, or store raw OpenClaw gateway output."
  };
  if (options.evidenceDir) writePublishedPackageSmokeReport(report, options.evidenceDir);
  return report;
}

export function writePublishedPackageSmokeReport(report: PublishedPackageSmokeReport, evidenceDir: string): string {
  mkdirSync(evidenceDir, { recursive: true });
  const outputPath = join(evidenceDir, "published-package-smoke.json");
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return outputPath;
}

function readPackageJson(rootDir: string): { name: string; version: string } {
  try {
    const parsed = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
    return {
      name: typeof parsed.name === "string" ? parsed.name : "unknown",
      version: typeof parsed.version === "string" ? parsed.version : "unknown"
    };
  } catch {
    return { name: "unknown", version: "unknown" };
  }
}

function readJsonObject(path: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function readGatewaySetupClassification(input: Record<string, unknown>): PublishedPackageSmokeReport["toolSmoke"]["gatewaySetupClassification"] {
  const value = readNestedString(input, ["setupStatus", "classification"]);
  if (value === "ready" || value === "gateway_setup_required" || value === "gateway_blocked") return value;
  return "unknown";
}

function readNestedString(input: Record<string, unknown>, path: string[]): string | null {
  let cursor: unknown = input;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" ? cursor : null;
}

function readNestedBoolean(input: Record<string, unknown>, path: string[]): boolean {
  let cursor: unknown = input;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor === true;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function findPackageRoot(start: string): string | null {
  let cursor = start;
  while (true) {
    if (existsSync(join(cursor, "package.json"))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}
