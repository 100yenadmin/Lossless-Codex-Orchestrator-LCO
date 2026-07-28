import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCliMcpProductSmokeReport,
  type CliMcpProductSmokeOptions,
  type CliMcpProductSmokeReport
} from "./cli-mcp-product-smoke.js";

export const EVA_HERMES_REQUIRED_LCO_TOOLS = [
  "lco_find",
  "lco_prepared_inbox",
  "lco_describe_ref",
  "lco_expand_query",
  "lco_recent_sessions",
  "lco_attention_inbox",
  "lco_project_digest",
  "lco_codex_extract",
  "lco_codex_control_dry_run",
  "lco_codex_start_thread",
  "lco_codex_resume_thread",
  "lco_codex_send_message",
  "lco_codex_steer_thread",
  "lco_codex_interrupt_thread"
] as const;

export const HERMES_SMOKE_FIND_LATENCY_THRESHOLD_MS = 300;

export type HermesSmokeOptions = {
  evidenceDir: string;
  packageVersion: string;
  candidateSha: string;
  cliBin?: string;
  mcpBin?: string;
  timeoutMs?: number;
  findLatencyThresholdMs?: number;
  now?: string;
};

export type HermesSmokeReport = {
  schema: "lco.hermesSmoke.v1";
  ok: boolean;
  publicSafe: true;
  localOnly: true;
  dryRun: true;
  generatedAt: string;
  packageName: string;
  packageVersion: string;
  candidateSha: string;
  requiredTools: string[];
  requiredToolsPresent: boolean;
  notificationSilenceReady: boolean;
  structuredContentObjectReady: boolean;
  arrayResultWrappedReady: boolean;
  defaultFindIndexSkipped: boolean;
  findLatencyMs: number | null;
  findLatencyThresholdMs: number;
  findLatencyReady: boolean;
  findProbe: CliMcpProductSmokeReport["toolCallProbe"];
  extractProbe: CliMcpProductSmokeReport["toolCallProbe"];
  blockers: string[];
  setupBlockers: string[];
  warnings: string[];
  actionsPerformed: CliMcpProductSmokeReport["actionsPerformed"];
  privateDataExclusions: string[];
  proofBoundary: string;
  nextSafeCommands: string[];
};

export async function createHermesSmokeReport(options: HermesSmokeOptions): Promise<HermesSmokeReport> {
  const common: Omit<CliMcpProductSmokeOptions, "toolCallName" | "toolCallArguments"> = {
    packageVersion: options.packageVersion,
    candidateSha: options.candidateSha,
    cliBin: options.cliBin,
    mcpBin: options.mcpBin,
    requiredTools: [...EVA_HERMES_REQUIRED_LCO_TOOLS],
    timeoutMs: options.timeoutMs,
    now: options.now
  };
  const find = await createCliMcpProductSmokeReport({
    ...common,
    toolCallName: "lco_find",
    toolCallArguments: { query: "hermes compatibility smoke", limit: 1 }
  });
  const extract = await createCliMcpProductSmokeReport({
    ...common,
    toolCallName: "lco_codex_extract",
    toolCallArguments: { kind: "plans", limit: 1 }
  });
  const requiredToolsPresent = find.missingRequiredTools.length === 0 && extract.missingRequiredTools.length === 0;
  const notificationSilenceReady = find.notificationSilenceReady && extract.notificationSilenceReady;
  const structuredContentObjectReady = find.toolCallProbe.structuredContentObject
    && extract.toolCallProbe.structuredContentObject;
  const arrayResultWrappedReady = extract.toolCallProbe.structuredContentWrappedResult;
  const defaultFindIndexSkipped = find.toolCallProbe.reasonCodes.includes("index_skipped_by_default");
  const findLatencyMs = find.toolCallProbe.durationMs;
  const findLatencyThresholdMs = options.findLatencyThresholdMs
    ?? HERMES_SMOKE_FIND_LATENCY_THRESHOLD_MS;
  const findLatencyReady = typeof findLatencyMs === "number"
    && findLatencyMs <= findLatencyThresholdMs;
  const blockers = uniqueStrings([
    ...prefixCodes("find", find.blockers),
    ...prefixCodes("extract", extract.blockers),
    ...(requiredToolsPresent ? [] : ["required_eva_tools_missing"]),
    ...(notificationSilenceReady ? [] : ["notification_silence_not_proven"]),
    ...(structuredContentObjectReady ? [] : ["structured_content_object_not_proven"]),
    ...(arrayResultWrappedReady ? [] : ["array_result_wrapper_not_proven"]),
    ...(defaultFindIndexSkipped ? [] : ["default_find_index_skip_not_proven"]),
    ...(findLatencyReady ? [] : ["find_latency_threshold_exceeded"])
  ]);
  const setupBlockers = uniqueStrings([
    ...prefixCodes("find", find.setupBlockers),
    ...prefixCodes("extract", extract.setupBlockers)
  ]);
  const warnings = uniqueStrings([
    ...prefixCodes("find", find.warnings),
    ...prefixCodes("extract", extract.warnings)
  ]);
  const report: HermesSmokeReport = {
    schema: "lco.hermesSmoke.v1",
    ok: find.ok && extract.ok && blockers.length === 0 && setupBlockers.length === 0,
    publicSafe: true,
    localOnly: true,
    dryRun: true,
    generatedAt: options.now ?? new Date().toISOString(),
    packageName: find.packageName,
    packageVersion: options.packageVersion,
    candidateSha: options.candidateSha,
    requiredTools: [...EVA_HERMES_REQUIRED_LCO_TOOLS],
    requiredToolsPresent,
    notificationSilenceReady,
    structuredContentObjectReady,
    arrayResultWrappedReady,
    defaultFindIndexSkipped,
    findLatencyMs,
    findLatencyThresholdMs,
    findLatencyReady,
    findProbe: find.toolCallProbe,
    extractProbe: extract.toolCallProbe,
    blockers,
    setupBlockers,
    warnings,
    actionsPerformed: find.actionsPerformed,
    privateDataExclusions: find.privateDataExclusions,
    proofBoundary: "This public-safe local smoke proves the named candidate binaries complete Hermes-compatible MCP initialization, silent notifications, required tool registration, object-valid structured results, array wrapping, and default no-index find behavior in isolated temporary runtimes. It does not change a Hermes profile, use Eva's active database, run live Codex control, prove production-scale latency, merge code, publish npm, create a tag, or create a GitHub Release.",
    nextSafeCommands: [
      `lco release hermes-readiness --evidence-dir <dir> --package-version ${options.packageVersion} --candidate-sha ${options.candidateSha} --hermes-smoke <path> --package-smoke <path> --strict`
    ]
  };
  mkdirSync(options.evidenceDir, { recursive: true });
  writeFileSync(join(options.evidenceDir, "hermes-smoke.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function prefixCodes(prefix: string, codes: string[]): string[] {
  return codes.map((code) => `${prefix}_${code}`);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
