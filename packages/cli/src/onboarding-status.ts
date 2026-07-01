import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type OnboardingCheck = {
  id: string;
  path: string;
  exists: boolean;
  required: boolean;
};

export type OnboardingStatusReport = {
  ok: boolean;
  publicSafe: true;
  dryRun: true;
  localOnly: true;
  generatedAt: string;
  packageName: string;
  version: string;
  blockers: string[];
  warnings: string[];
  requiredFiles: OnboardingCheck[];
  sourceEntrypoints: OnboardingCheck[];
  packageEntrypoints: OnboardingCheck[];
  openclaw: {
    manifestPath: string;
    exists: boolean;
    toolCount: number;
    requiredToolsPresent: string[];
    missingRequiredTools: string[];
  };
  installRecovery: {
    publishedPackage: string;
    cleanProfile: string;
    registryCheckCommand: string;
    globalInstallCommand: string;
    openclawInstallCommand: string;
    dogfoodCommand: string;
    toolSmokeCommand: string;
    setupGuidance: string[];
  };
  nextSafeCommands: string[];
  forbiddenActions: string[];
  proofBoundary: string;
};

const REQUIRED_FILES = [
  ["package", "package.json"],
  ["readme", "README.md"],
  ["vision", "VISION.md"],
  ["openclaw_manifest", "openclaw.plugin.json"],
  ["openclaw_docs", "docs/OPENCLAW_PLUGIN.md"],
  ["release_demo", "docs/BETA_RELEASE_DEMO.md"],
  ["release_runbook", "docs/BETA_RELEASE_RUNBOOK.md"],
  ["packaging_scorecard", "evals/scorecards/v1.0/packaging-install-review.json"]
] as const;

const SOURCE_ENTRYPOINTS = [
  ["loo_cli_source", "packages/cli/src/index.ts"],
  ["mcp_server_source", "packages/mcp-server/src/server.ts"],
  ["openclaw_plugin_source", "packages/openclaw-plugin/src/index.ts"]
] as const;

const REQUIRED_OPENCLAW_TOOLS = [
  "loo_doctor",
  "loo_search_sessions",
  "loo_describe_session",
  "loo_expand_query",
  "loo_codex_plans",
  "loo_codex_final_messages",
  "loo_codex_thread_map",
  "loo_codex_control_dry_run"
];

export function createOnboardingStatusReport(options: {
  rootDir?: string;
  now?: string;
} = {}): OnboardingStatusReport {
  const rootDir = options.rootDir
    ? resolve(options.rootDir)
    : findPackageRoot(dirname(fileURLToPath(import.meta.url))) ?? process.cwd();
  const packageJson = readPackageJson(rootDir);
  const manifest = readOpenClawManifest(rootDir);
  const declaredTools = manifest.tools;
  const requiredToolsPresent = REQUIRED_OPENCLAW_TOOLS.filter((tool) => declaredTools.includes(tool));
  const missingRequiredTools = REQUIRED_OPENCLAW_TOOLS.filter((tool) => !declaredTools.includes(tool));
  const requiredFiles = REQUIRED_FILES.map(([id, path]) => checkPath(rootDir, id, path, true));
  const sourceEntrypoints = SOURCE_ENTRYPOINTS.map(([id, path]) => checkPath(rootDir, id, path, true));
  const packageEntrypoints = packageEntrypointsFromPackage(rootDir, packageJson);
  const installRecovery = createInstallRecoveryCommands();
  const blockers = [
    ...requiredFiles.filter((item) => item.required && !item.exists).map((item) => `missing_required_file:${item.id}`),
    ...sourceEntrypoints.filter((item) => item.required && !item.exists).map((item) => `missing_source_entrypoint:${item.id}`),
    ...packageJsonBlockers(packageJson),
    ...manifestBlockers(manifest),
    ...missingRequiredTools.map((tool) => `missing_openclaw_tool:${tool}`)
  ];
  const warnings = packageEntrypoints.some((entrypoint) => !entrypoint.exists)
    ? ["package_entrypoints_missing_until_build"]
    : [];

  return {
    ok: blockers.length === 0,
    publicSafe: true,
    dryRun: true,
    localOnly: true,
    generatedAt: options.now ?? new Date().toISOString(),
    packageName: packageJson.name,
    version: packageJson.version,
    blockers,
    warnings,
    requiredFiles,
    sourceEntrypoints,
    packageEntrypoints,
    openclaw: {
      manifestPath: "openclaw.plugin.json",
      exists: manifest.exists,
      toolCount: declaredTools.length,
      requiredToolsPresent,
      missingRequiredTools
    },
    installRecovery,
    nextSafeCommands: [
      "loo doctor",
      installRecovery.registryCheckCommand,
      installRecovery.globalInstallCommand,
      installRecovery.openclawInstallCommand,
      "loo openclaw dogfood --profile lco-dogfood --install-source . --link --strict",
      installRecovery.dogfoodCommand,
      "loo openclaw tool-smoke --profile lco-dogfood --required-tool loo_doctor --required-tool loo_search_sessions --strict",
      installRecovery.toolSmokeCommand,
      "loo release preflight --claim-scope codex-read-search-expand-dry-run --strict"
    ],
    forbiddenActions: [
      "npm publish",
      "GitHub Release creation",
      "live Codex control",
      "desktop GUI mutation",
      "raw transcript upload"
    ],
    proofBoundary: "This onboarding status report is a public-safe dry run over local package metadata, manifests, and published-beta install recovery commands only; it does not install plugins, read raw transcripts, run live Codex control, mutate a desktop GUI, publish npm packages, or create a GitHub Release."
  };
}

export function writeOnboardingStatusReport(report: OnboardingStatusReport, evidenceDir: string): string {
  mkdirSync(evidenceDir, { recursive: true });
  const outputPath = join(evidenceDir, "onboarding-status.json");
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return outputPath;
}

function checkPath(rootDir: string, id: string, path: string, required: boolean): OnboardingCheck {
  return {
    id,
    path,
    exists: existsSync(join(rootDir, path)),
    required
  };
}

function createInstallRecoveryCommands(): OnboardingStatusReport["installRecovery"] {
  const publishedPackage = "lossless-openclaw-orchestrator@beta";
  const cleanProfile = "lco-dogfood-published";
  return {
    publishedPackage,
    cleanProfile,
    registryCheckCommand: "npm view lossless-openclaw-orchestrator@beta version dist-tags --json",
    globalInstallCommand: `npm install -g ${publishedPackage}`,
    openclawInstallCommand: `openclaw --profile ${cleanProfile} plugins install ${publishedPackage}`,
    dogfoodCommand: `loo openclaw dogfood --profile ${cleanProfile} --install-source ${publishedPackage} --required-tool loo_doctor --required-tool loo_search_sessions --strict`,
    toolSmokeCommand: `loo openclaw tool-smoke --profile ${cleanProfile} --required-tool loo_doctor --required-tool loo_search_sessions --strict`,
    setupGuidance: [
      "If tool-smoke reports setupStatus.classification=gateway_setup_required, complete local OpenClaw gateway credentials or device pairing before treating it as a package defect.",
      "Use a clean profile for published-beta proof so an existing linked plugin does not mask install behavior.",
      "Keep evidence public-safe: record blocker codes, setupStatus, installOutcome, counts, and hashes only."
    ]
  };
}

type PackageJsonRead = {
  exists: boolean;
  error: string | null;
  name: string;
  version: string;
  bin?: Record<string, string>;
  openclaw?: { extensions?: string[] };
};

function readPackageJson(rootDir: string): PackageJsonRead {
  const fallback = { exists: false, error: null, name: "unknown", version: "unknown" };
  const packageJsonPath = join(rootDir, "package.json");
  if (!existsSync(packageJsonPath)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
      bin?: unknown;
      openclaw?: unknown;
    };
    return {
      exists: true,
      error: null,
      name: typeof parsed.name === "string" ? parsed.name : fallback.name,
      version: typeof parsed.version === "string" ? parsed.version : fallback.version,
      bin: isStringRecord(parsed.bin) ? parsed.bin : undefined,
      openclaw: readOpenClawPackageMetadata(parsed.openclaw)
    };
  } catch {
    return { ...fallback, exists: true, error: "package_json_invalid" };
  }
}

type OpenClawManifestRead = {
  exists: boolean;
  error: string | null;
  tools: string[];
  mcpCommand?: string;
  mcpTransport?: string;
  toolPrefix?: string;
};

function readOpenClawManifest(rootDir: string): OpenClawManifestRead {
  const manifestPath = join(rootDir, "openclaw.plugin.json");
  if (!existsSync(manifestPath)) return { exists: false, error: null, tools: [] };
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      contracts?: { tools?: unknown };
      mcp?: { command?: unknown; transport?: unknown };
      tools?: { prefix?: unknown };
    };
    const tools = Array.isArray(parsed.contracts?.tools)
      ? parsed.contracts.tools.filter((tool): tool is string => typeof tool === "string")
      : [];
    return {
      exists: true,
      error: null,
      tools,
      mcpCommand: typeof parsed.mcp?.command === "string" ? parsed.mcp.command : undefined,
      mcpTransport: typeof parsed.mcp?.transport === "string" ? parsed.mcp.transport : undefined,
      toolPrefix: typeof parsed.tools?.prefix === "string" ? parsed.tools.prefix : undefined
    };
  } catch {
    return { exists: true, error: "openclaw_manifest_invalid", tools: [] };
  }
}

function packageEntrypointsFromPackage(rootDir: string, packageJson: ReturnType<typeof readPackageJson>): OnboardingCheck[] {
  const binEntries = Object.entries(packageJson.bin ?? {}).map(([id, path]) => checkPath(rootDir, id, normalizePackagePath(path), false));
  const extensionEntries = (packageJson.openclaw?.extensions ?? []).map((path, index) => checkPath(rootDir, `openclaw_extension_${index + 1}`, normalizePackagePath(path), false));
  return [...binEntries, ...extensionEntries];
}

function packageJsonBlockers(packageJson: PackageJsonRead): string[] {
  if (!packageJson.exists) return [];
  const blockers = packageJson.error ? [packageJson.error] : [];
  if (!packageJson.error && packageJson.name === "unknown") blockers.push("package_json_name_missing");
  if (!packageJson.error && packageJson.version === "unknown") blockers.push("package_json_version_missing");
  return blockers;
}

function manifestBlockers(manifest: OpenClawManifestRead): string[] {
  if (!manifest.exists) return [];
  const blockers = manifest.error ? [manifest.error] : [];
  if (manifest.error) return blockers;
  if (manifest.mcpCommand !== "loo-mcp-server") blockers.push("invalid_openclaw_manifest_mcp_command");
  if (manifest.mcpTransport !== "stdio") blockers.push("invalid_openclaw_manifest_transport");
  if (manifest.toolPrefix !== "loo_") blockers.push("invalid_openclaw_manifest_tool_prefix");
  return blockers;
}

function normalizePackagePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function findPackageRoot(start: string): string | null {
  let cursor = start;
  while (true) {
    const packageJsonPath = join(cursor, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
        if (packageJson.name === "lossless-openclaw-orchestrator") return cursor;
      } catch {
        return null;
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object"
    && value !== null
    && Object.values(value).every((entry) => typeof entry === "string");
}

function readOpenClawPackageMetadata(value: unknown): { extensions?: string[] } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const extensions = (value as { extensions?: unknown }).extensions;
  return {
    extensions: Array.isArray(extensions)
      ? extensions.filter((entry): entry is string => typeof entry === "string")
      : undefined
  };
}
