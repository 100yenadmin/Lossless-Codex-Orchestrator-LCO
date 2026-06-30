import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  const rootDir = options.rootDir ?? process.cwd();
  const packageJson = readPackageJson(rootDir);
  const manifest = readOpenClawManifest(rootDir);
  const declaredTools = manifest.tools;
  const requiredToolsPresent = REQUIRED_OPENCLAW_TOOLS.filter((tool) => declaredTools.includes(tool));
  const missingRequiredTools = REQUIRED_OPENCLAW_TOOLS.filter((tool) => !declaredTools.includes(tool));
  const requiredFiles = REQUIRED_FILES.map(([id, path]) => checkPath(rootDir, id, path, true));
  const sourceEntrypoints = SOURCE_ENTRYPOINTS.map(([id, path]) => checkPath(rootDir, id, path, true));
  const packageEntrypoints = packageEntrypointsFromPackage(rootDir, packageJson);
  const blockers = [
    ...requiredFiles.filter((item) => item.required && !item.exists).map((item) => `missing_required_file:${item.id}`),
    ...sourceEntrypoints.filter((item) => item.required && !item.exists).map((item) => `missing_source_entrypoint:${item.id}`),
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
    nextSafeCommands: [
      "loo doctor",
      "loo openclaw dogfood --profile lco-dogfood --install-source . --link --strict",
      "loo openclaw tool-smoke --profile lco-dogfood --required-tool loo_doctor --required-tool loo_search_sessions --strict",
      "loo release preflight --claim-scope codex-read-search-expand-dry-run --strict"
    ],
    forbiddenActions: [
      "npm publish",
      "GitHub Release creation",
      "live Codex control",
      "desktop GUI mutation",
      "raw transcript upload"
    ],
    proofBoundary: "This onboarding status report is a public-safe dry run over local package metadata and manifests only; it does not install plugins, read raw transcripts, run live Codex control, mutate a desktop GUI, publish npm packages, or create a GitHub Release."
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

function readPackageJson(rootDir: string): { name: string; version: string; bin?: Record<string, string>; openclaw?: { extensions?: string[] } } {
  const fallback = { name: "unknown", version: "unknown" };
  try {
    const parsed = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
      bin?: unknown;
      openclaw?: unknown;
    };
    return {
      name: typeof parsed.name === "string" ? parsed.name : fallback.name,
      version: typeof parsed.version === "string" ? parsed.version : fallback.version,
      bin: isStringRecord(parsed.bin) ? parsed.bin : undefined,
      openclaw: readOpenClawPackageMetadata(parsed.openclaw)
    };
  } catch {
    return fallback;
  }
}

function readOpenClawManifest(rootDir: string): { exists: boolean; tools: string[] } {
  const manifestPath = join(rootDir, "openclaw.plugin.json");
  if (!existsSync(manifestPath)) return { exists: false, tools: [] };
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { contracts?: { tools?: unknown } };
    const tools = Array.isArray(parsed.contracts?.tools)
      ? parsed.contracts.tools.filter((tool): tool is string => typeof tool === "string")
      : [];
    return { exists: true, tools };
  } catch {
    return { exists: true, tools: [] };
  }
}

function packageEntrypointsFromPackage(rootDir: string, packageJson: ReturnType<typeof readPackageJson>): OnboardingCheck[] {
  const binEntries = Object.entries(packageJson.bin ?? {}).map(([id, path]) => checkPath(rootDir, id, path, false));
  const extensionEntries = (packageJson.openclaw?.extensions ?? []).map((path, index) => checkPath(rootDir, `openclaw_extension_${index + 1}`, path.replace(/^\.\//, ""), false));
  return [...binEntries, ...extensionEntries];
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
