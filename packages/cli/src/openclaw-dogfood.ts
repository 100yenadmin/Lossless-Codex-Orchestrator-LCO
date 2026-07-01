import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_REQUIRED_LOO_TOOLS = [
  "loo_search_sessions",
  "loo_describe_session",
  "loo_expand_query",
  "loo_codex_control_dry_run"
];

type PluginListEntry = Record<string, unknown>;

export type OpenClawDogfoodReport = {
  ok: boolean;
  dogfoodReady: boolean;
  publicSafe: true;
  command: string;
  pluginListExitStatus: number | null;
  runtimeInspectExitStatus: number | null;
  parsedPluginCount: number;
  targetPlugin: null | {
    id: string;
    enabled: boolean | null;
    loaded: boolean | null;
    toolCount: number;
  };
  requiredTools: string[];
  requiredToolsPresent: boolean;
  missingRequiredTools: string[];
  blockers: string[];
  warnings: string[];
  installAttempted: boolean;
  installExitStatus: number | null;
  installOutcome: OpenClawInstallOutcome;
  evidencePath?: string;
  privateDataExclusions: string[];
};

export type OpenClawInstallOutcome = {
  status: "not_attempted" | "installed" | "already_installed" | "link_force_unsupported" | "failed";
  exitStatus: number | null;
  recognizedMarker?: OpenClawInstallOutcomeMarker;
  guidance?: string;
};

export type OpenClawInstallOutcomeMarker = "openclaw_plugin_already_exists" | "openclaw_link_force_unsupported";

export type OpenClawDogfoodInput = {
  pluginListExitStatus: number | null;
  pluginListStdout: string;
  runtimeInspectExitStatus?: number | null;
  runtimeInspectStdout?: string;
  requiredTools?: string[];
  installAttempted?: boolean;
  installExitStatus?: number | null;
  installStdout?: string;
  installStderr?: string;
  command?: string;
  evidencePath?: string;
};

export type RunOpenClawDogfoodOptions = {
  openclawBin?: string;
  dev?: boolean;
  profile?: string;
  pluginListJsonPath?: string;
  evidencePath?: string;
  requiredTools?: string[];
  installSource?: string;
  link?: boolean;
  forceInstall?: boolean;
};

const TARGET_PLUGIN_ID = "lossless-openclaw-orchestrator";
const PRIVATE_DATA_EXCLUSIONS = [
  "raw OpenClaw plugin JSON output",
  "raw Codex transcripts",
  "tokens",
  "credentials",
  "SQLite DB contents",
  "screenshots"
];

const OPENCLAW_INSTALL_OUTPUT_MARKERS: Array<{
  id: OpenClawInstallOutcomeMarker;
  status: OpenClawInstallOutcome["status"];
  observedText: string;
  pattern: RegExp;
  requiresTargetPluginId?: boolean;
  guidance: string;
}> = [
  {
    id: "openclaw_link_force_unsupported",
    status: "link_force_unsupported",
    // Defensive marker for external/manual OpenClaw installs; this CLI does not combine --force with --link.
    observedText: "--force is not supported with --link",
    pattern: /--force is not supported with --link/i,
    guidance: "Remove --force for linked installs; use a clean OpenClaw profile for reproducible linked beta proof."
  },
  {
    id: "openclaw_plugin_already_exists",
    status: "already_installed",
    observedText: "plugin already exists",
    pattern: /plugin already exists/i,
    requiresTargetPluginId: true,
    guidance: "Use a clean OpenClaw profile for linked beta proof, or update/remove the existing plugin before reinstalling."
  }
];

export function runOpenClawDogfood(options: RunOpenClawDogfoodOptions = {}): OpenClawDogfoodReport {
  const openclawBin = options.openclawBin || "openclaw";
  const baseArgs = [
    ...(options.dev ? ["--dev"] : []),
    ...(options.profile ? ["--profile", options.profile] : [])
  ];
  let installExitStatus: number | null = null;
  let installStdout = "";
  let installStderr = "";
  if (options.installSource) {
    const installArgs = [
      ...baseArgs,
      "plugins",
      "install",
      ...(options.link ? ["--link"] : []),
      ...(options.forceInstall && !options.link ? ["--force"] : []),
      options.installSource
    ];
    const install = spawnSync(openclawBin, installArgs, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    installExitStatus = install.status;
    installStdout = install.stdout;
    installStderr = install.stderr;
  }

  const pluginList = options.pluginListJsonPath
    ? { status: 0, stdout: readFileSync(options.pluginListJsonPath, "utf8") }
    : spawnSync(openclawBin, [...baseArgs, "plugins", "list", "--json"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const runtimeInspect = options.pluginListJsonPath
    ? { status: null, stdout: "" }
    : spawnSync(openclawBin, [...baseArgs, "plugins", "inspect", TARGET_PLUGIN_ID, "--json", "--runtime"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const report = createOpenClawDogfoodReport({
    pluginListExitStatus: pluginList.status,
    pluginListStdout: pluginList.stdout,
    runtimeInspectExitStatus: runtimeInspect.status,
    runtimeInspectStdout: runtimeInspect.stdout,
    requiredTools: options.requiredTools,
    installAttempted: Boolean(options.installSource),
    installExitStatus,
    installStdout,
    installStderr,
    command: `${openclawBin} ${[...baseArgs, "plugins", "list", "--json"].join(" ")}`,
    evidencePath: options.evidencePath
  });
  if (options.evidencePath) {
    mkdirSync(dirname(options.evidencePath), { recursive: true });
    writeFileSync(options.evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

export function createOpenClawDogfoodReport(input: OpenClawDogfoodInput): OpenClawDogfoodReport {
  const requiredTools = [...new Set(input.requiredTools?.length ? input.requiredTools : DEFAULT_REQUIRED_LOO_TOOLS)];
  const parsed = parsePluginList(input.pluginListStdout);
  const entries = parsed.ok ? parsed.plugins : [];
  const runtimeTarget = parseRuntimeInspect(input.runtimeInspectStdout || "");
  const target = runtimeTarget ?? entries.find((entry) => pluginId(entry) === TARGET_PLUGIN_ID) ?? null;
  const targetToolNames = target ? pluginToolNames(target) : [];
  const missingRequiredTools = requiredTools.filter((tool) => !targetToolNames.includes(tool));
  const enabled = target ? pluginEnabled(target) : null;
  const loaded = target ? pluginLoaded(target) : null;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const installOutcome = classifyInstallOutcome(input);

  if (input.pluginListExitStatus !== 0) blockers.push("openclaw_plugin_list_failed");
  if (!parsed.ok) blockers.push("openclaw_plugin_list_invalid_json");
  if (!target) blockers.push("target_plugin_not_loaded");
  if (target && input.runtimeInspectExitStatus !== null && input.runtimeInspectExitStatus !== undefined && input.runtimeInspectExitStatus !== 0) blockers.push("openclaw_runtime_inspect_failed");
  if (target && enabled === false) blockers.push("target_plugin_disabled");
  if (target && loaded === false) blockers.push("target_plugin_not_loaded");
  if (target && missingRequiredTools.length > 0) blockers.push("target_plugin_missing_required_loo_tools");

  const requiredToolsPresent = missingRequiredTools.length === 0;
  const readyWithoutInstall = blockers.length === 0 && requiredToolsPresent && Boolean(target);
  if (input.installAttempted && input.installExitStatus !== 0) {
    if (readyWithoutInstall) warnings.push(installWarningForOutcome(installOutcome));
    else blockers.push("openclaw_plugin_install_failed");
  }
  const dogfoodReady = blockers.length === 0 && requiredToolsPresent && Boolean(target);
  return {
    ok: dogfoodReady,
    dogfoodReady,
    publicSafe: true,
    command: input.command || "openclaw plugins list --json",
    pluginListExitStatus: input.pluginListExitStatus,
    runtimeInspectExitStatus: input.runtimeInspectExitStatus ?? null,
    parsedPluginCount: entries.length,
    targetPlugin: target ? {
      id: TARGET_PLUGIN_ID,
      enabled,
      loaded,
      toolCount: targetToolNames.length
    } : null,
    requiredTools,
    requiredToolsPresent,
    missingRequiredTools,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    installAttempted: input.installAttempted === true,
    installExitStatus: input.installExitStatus ?? null,
    installOutcome,
    ...(input.evidencePath ? { evidencePath: input.evidencePath } : {}),
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS
  };
}

function classifyInstallOutcome(input: OpenClawDogfoodInput): OpenClawInstallOutcome {
  const exitStatus = input.installExitStatus ?? null;
  if (input.installAttempted !== true) return { status: "not_attempted", exitStatus };
  if (exitStatus === 0) return { status: "installed", exitStatus };

  const combined = `${input.installStdout || ""}\n${input.installStderr || ""}`;
  const marker = OPENCLAW_INSTALL_OUTPUT_MARKERS.find((candidate) => {
    if (!candidate.pattern.test(combined)) return false;
    if (candidate.requiresTargetPluginId && !combined.toLowerCase().includes(TARGET_PLUGIN_ID)) return false;
    return true;
  });
  if (marker) {
    return {
      status: marker.status,
      exitStatus,
      recognizedMarker: marker.id,
      guidance: marker.guidance
    };
  }
  return {
    status: "failed",
    exitStatus,
    guidance: "Inspect the local OpenClaw install command outside public evidence, then rerun dogfood after the plugin is installed or a clean profile is selected."
  };
}

function installWarningForOutcome(outcome: OpenClawInstallOutcome): string {
  if (outcome.status === "already_installed") return "openclaw_plugin_already_installed_but_ready";
  if (outcome.status === "link_force_unsupported") return "openclaw_link_force_unsupported_but_ready";
  return "openclaw_plugin_install_failed_but_plugin_ready";
}

function parseRuntimeInspect(stdout: string): PluginListEntry | null {
  try {
    const payload = parseJsonPayload(stdout);
    if (isRecord(payload) && pluginId(payload) === TARGET_PLUGIN_ID) return payload;
  } catch {
    return null;
  }
  return null;
}

function parsePluginList(stdout: string): { ok: true; plugins: PluginListEntry[] } | { ok: false; plugins: [] } {
  try {
    const payload = parseJsonPayload(stdout);
    if (Array.isArray(payload)) return { ok: true, plugins: payload.filter(isRecord) };
    if (isRecord(payload) && Array.isArray(payload.plugins)) return { ok: true, plugins: payload.plugins.filter(isRecord) };
  } catch {
    return { ok: false, plugins: [] };
  }
  return { ok: false, plugins: [] };
}

function parseJsonPayload(stdout: string): unknown {
  const text = (stdout || "null").trim();
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    for (const index of jsonStartIndexes(text)) {
      try {
        return JSON.parse(text.slice(index)) as unknown;
      } catch {
        // Try the next plausible JSON payload start.
      }
    }
    throw error;
  }
}

function jsonStartIndexes(text: string): number[] {
  const indexes: number[] = [];
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{" || char === "[") indexes.push(index);
  }
  return indexes;
}

function pluginId(entry: PluginListEntry): string {
  const plugin = asRecord(entry.plugin);
  const manifest = asRecord(plugin?.manifest);
  return stringValue(entry.id)
    || stringValue(plugin?.id)
    || stringValue(manifest?.id)
    || "";
}

function pluginToolNames(entry: PluginListEntry): string[] {
  const plugin = asRecord(entry.plugin);
  const arrays = [entry.tools, entry.toolNames, plugin?.tools, plugin?.toolNames].filter(Array.isArray) as unknown[][];
  const names = arrays.flatMap((items) => items.flatMap(toolNames).filter(Boolean));
  return [...new Set(names)];
}

function pluginEnabled(entry: PluginListEntry): boolean | null {
  const value = entry.enabled ?? asRecord(entry.plugin)?.enabled;
  return typeof value === "boolean" ? value : null;
}

function pluginLoaded(entry: PluginListEntry): boolean | null {
  const value = entry.loaded ?? asRecord(entry.plugin)?.loaded;
  if (typeof value === "boolean") return value;
  const status = stringValue(entry.status) || stringValue(asRecord(entry.plugin)?.status);
  if (status === "loaded") return true;
  if (status === "failed" || status === "disabled") return false;
  return null;
}

function toolNames(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!isRecord(value)) return [];
  const name = stringValue(value.name);
  const names = Array.isArray(value.names) ? value.names.filter((item): item is string => typeof item === "string") : [];
  return name ? [name, ...names] : names;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
