import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";

export const DEFAULT_REQUIRED_TOOL_CALLS = [
  "loo_doctor",
  "loo_search_sessions",
  "loo_describe_session",
  "loo_expand_query",
  "loo_codex_plans",
  "loo_codex_final_messages",
  "loo_codex_thread_map",
  "loo_codex_control_dry_run"
];

export type OpenClawToolSmokeOptions = {
  openclawBin?: string;
  dev?: boolean;
  profile?: string;
  gatewayUrl?: string;
  token?: string;
  sessionKey?: string;
  query?: string;
  threadId?: string;
  expandProfile?: "metadata" | "brief" | "evidence";
  tokenBudget?: number;
  evidencePath?: string;
  requiredTools?: string[];
  gatewayTimeoutMs?: number;
};

export type OpenClawToolInvocationSummary = {
  toolName: string;
  exitStatus: number | null;
  ok: boolean;
  gatewayMethod: "tools.invoke";
  summary: {
    outputKind?: string;
    count?: number;
    sourceRefs?: string[];
    threadId?: string;
    profile?: string;
    tokenBudget?: number;
    live?: boolean;
    approvalAuditId?: string;
    paramsHash?: string;
    messageHash?: string;
    method?: string;
    action?: string;
  };
  blockers: string[];
};

export type OpenClawToolSmokeReport = {
  ok: boolean;
  toolSmokeReady: boolean;
  publicSafe: true;
  command: string;
  catalog: {
    exitStatus: number | null;
    requiredTools: string[];
    requiredToolsPresent: boolean;
    missingRequiredTools: string[];
    toolCount: number;
  };
  invocations: OpenClawToolInvocationSummary[];
  blockers: string[];
  evidencePath?: string;
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    npmPublished: false;
    githubReleaseCreated: false;
    channelDelivery: false;
    broadGatewayScopeApproval: false;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

type GatewayCallResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

type GatewayJsonResult = GatewayCallResult & {
  parsed?: unknown;
  parseError?: string;
};

const PRIVATE_DATA_EXCLUSIONS = [
  "raw OpenClaw gateway stdout/stderr",
  "raw tool output",
  "raw Codex transcripts",
  "raw prompts or message text",
  "SQLite DB contents",
  "screenshots or videos",
  "tokens, credentials, API keys, cookies",
  "private customer data"
];

const CONTROL_DRY_RUN_MESSAGE = "Harmless beta smoke: dry-run only; do not send.";

export function runOpenClawToolSmoke(options: OpenClawToolSmokeOptions = {}): OpenClawToolSmokeReport {
  const requiredTools = [...new Set(options.requiredTools?.length ? options.requiredTools : DEFAULT_REQUIRED_TOOL_CALLS)];
  const openclawBin = options.openclawBin || "openclaw";
  const baseArgs = [
    ...(options.dev ? ["--dev"] : []),
    ...(options.profile ? ["--profile", options.profile] : [])
  ];
  const gatewayTimeoutMs = options.gatewayTimeoutMs ?? 60_000;
  const gatewayOptions = [
    ...(options.gatewayUrl ? ["--url", options.gatewayUrl] : []),
    "--timeout",
    String(gatewayTimeoutMs)
  ];
  const gatewayEnv = options.token ? { OPENCLAW_GATEWAY_TOKEN: options.token } : undefined;
  const sessionKey = options.sessionKey || "agent:main:lco-tool-smoke";
  const query = options.query || "Proposed plan";
  const expandProfile = options.expandProfile || "brief";
  const tokenBudget = options.tokenBudget ?? 1000;
  const runId = randomUUID();

  const gatewayCallOptions = { env: gatewayEnv, timeoutMs: gatewayTimeoutMs };
  const catalogCall = callGatewayJson(openclawBin, baseArgs, gatewayOptions, "tools.catalog", {}, gatewayCallOptions);
  const catalogParsed = catalogCall.parsed !== undefined;
  const catalogComparable = catalogCall.status === 0 && catalogParsed;
  const catalogToolNames = catalogComparable ? extractCatalogToolNames(unwrapGatewayPayload(catalogCall.parsed)) : [];
  const missingRequiredTools = catalogComparable ? requiredTools.filter((name) => !catalogToolNames.includes(name)) : [];
  const blockers = [
    ...gatewayFailureBlockers(catalogCall, "openclaw_catalog_failed"),
    ...(catalogCall.status === 0 && !catalogParsed ? ["openclaw_catalog_invalid_json"] : []),
    ...(missingRequiredTools.length > 0 ? ["openclaw_catalog_missing_required_tools"] : [])
  ];

  const invocations: OpenClawToolInvocationSummary[] = [];
  let selectedThreadId = options.threadId;
  if (blockers.length === 0) {
    for (const toolName of requiredTools) {
      const args = buildToolArgs({
        toolName,
        query,
        threadId: selectedThreadId,
        expandProfile,
        tokenBudget
      });
      if (toolName === "loo_describe_session" || toolName === "loo_codex_control_dry_run") {
        if (!args) {
          blockers.push("openclaw_tool_smoke_missing_thread_ref");
          continue;
        }
      }
      const call = callGatewayJson(openclawBin, baseArgs, gatewayOptions, "tools.invoke", {
        name: toolName,
        args: args ?? {},
        sessionKey,
        confirm: false,
        idempotencyKey: `loo-tool-smoke-${runId}-${toolName}`
      }, gatewayCallOptions);
      const summary = summarizeInvocation(toolName, call);
      invocations.push(summary);
      blockers.push(...summary.blockers);
      if (toolName === "loo_search_sessions" && !selectedThreadId) {
        selectedThreadId = summary.summary.threadId;
      }
    }
  }

  const uniqueBlockers = [...new Set(blockers)];
  const report: OpenClawToolSmokeReport = {
    ok: uniqueBlockers.length === 0,
    toolSmokeReady: uniqueBlockers.length === 0,
    publicSafe: true,
    command: `${sanitizeCommandBinary(openclawBin)} ${[...baseArgs, "gateway", "call", "tools.catalog", "--json", "--params", "<redacted>"].join(" ")}`,
    catalog: {
      exitStatus: catalogCall.status,
      requiredTools,
      requiredToolsPresent: catalogComparable && missingRequiredTools.length === 0,
      missingRequiredTools,
      toolCount: catalogToolNames.length
    },
    invocations,
    blockers: uniqueBlockers,
    ...(options.evidencePath ? { evidencePath: sanitizeEvidencePath(options.evidencePath) } : {}),
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      npmPublished: false,
      githubReleaseCreated: false,
      channelDelivery: false,
      broadGatewayScopeApproval: false
    },
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS,
    proofBoundary: "This OpenClaw tool-call smoke proves public-safe gateway invocation of selected loo_* tools only. It does not approve live Codex control, GUI mutation, npm publish, GitHub Release creation, channel delivery, broad gateway scope approval, Claude parity, or release-grade customer readiness.",
    nextAction: uniqueBlockers.length === 0
      ? "Use this packet to update the local-agent usability scorecard before RC signoff."
      : "Fix or document the gateway tool-call blocker before claiming first-class OpenClaw agent usability."
  };

  if (options.evidencePath) {
    mkdirSync(dirname(options.evidencePath), { recursive: true });
    writeFileSync(options.evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

function callGatewayJson(
  openclawBin: string,
  baseArgs: string[],
  gatewayOptions: string[],
  method: string,
  params: unknown,
  options: { env?: Record<string, string>; timeoutMs?: number } = {}
): GatewayJsonResult {
  const call = spawnSync(openclawBin, [
    ...baseArgs,
    "gateway",
    "call",
    method,
    "--json",
    "--params",
    JSON.stringify(params),
    ...gatewayOptions
  ], {
    encoding: "utf8",
    env: options.env ? { ...process.env, ...options.env } : process.env,
    maxBuffer: 20 * 1024 * 1024,
    timeout: gatewayProcessTimeoutMs(options.timeoutMs ?? 60_000)
  });
  const result: GatewayJsonResult = {
    status: call.status,
    stdout: call.stdout,
    stderr: call.stderr
  };
  try {
    result.parsed = parseJsonPayload(call.stdout);
  } catch (error) {
    result.parseError = error instanceof Error ? error.message : "invalid JSON";
  }
  return result;
}

function gatewayProcessTimeoutMs(timeoutMs: number): number {
  const graceMs = Math.min(5_000, Math.max(250, Math.ceil(timeoutMs * 0.2)));
  return timeoutMs + graceMs;
}

function sanitizeCommandBinary(openclawBin: string): string {
  return openclawBin.includes("/") ? basename(openclawBin) : openclawBin;
}

function sanitizeEvidencePath(evidencePath: string): string {
  if (isAbsolute(evidencePath) || evidencePath.startsWith("~")) {
    return `<redacted-local-path>/${basename(evidencePath) || "evidence.json"}`;
  }
  return evidencePath;
}

function buildToolArgs(params: {
  toolName: string;
  query: string;
  threadId?: string;
  expandProfile: "metadata" | "brief" | "evidence";
  tokenBudget: number;
}): Record<string, unknown> | null {
  if (params.toolName === "loo_search_sessions") return { query: params.query, limit: 3 };
  if (params.toolName === "loo_describe_session") return params.threadId ? { thread_id: params.threadId } : null;
  if (params.toolName === "loo_expand_query") return { query: params.query, profile: params.expandProfile, token_budget: params.tokenBudget };
  if (params.toolName === "loo_codex_plans" || params.toolName === "loo_codex_final_messages") {
    return {
      ...(params.threadId ? { thread_id: params.threadId } : {}),
      limit: 3
    };
  }
  if (params.toolName === "loo_codex_thread_map") return { limit: 20 };
  if (params.toolName === "loo_codex_control_dry_run") {
    return params.threadId ? {
      action: "send",
      thread_id: params.threadId,
      message: CONTROL_DRY_RUN_MESSAGE
    } : null;
  }
  return {};
}

function summarizeInvocation(toolName: string, call: GatewayJsonResult): OpenClawToolInvocationSummary {
  const payload = call.parsed ? unwrapGatewayPayload(call.parsed) : undefined;
  const blockers = [
    ...gatewayFailureBlockers(call, `openclaw_tool_invoke_failed:${toolName}`, toolName),
    ...(call.status === 0 && !call.parsed ? [`openclaw_tool_result_invalid_json:${toolName}`] : []),
    ...toolPayloadBlockers(toolName, payload)
  ];
  const output = unwrapToolOutput(payload);
  const sourceRefs = output ? collectSourceRefs(output).slice(0, 5) : [];
  const threadId = output ? extractThreadId(output, sourceRefs) : undefined;
  const summary: OpenClawToolInvocationSummary["summary"] = {
    outputKind: outputKind(output),
    ...(sourceRefs.length ? { sourceRefs } : {}),
    ...(threadId ? { threadId } : {})
  };

  const count = outputCount(output);
  if (count !== undefined) summary.count = count;
  if (toolName === "loo_expand_query") {
    const profile = stringPath(output, ["profile", "name"]) || stringPath(output, ["profile"]);
    if (profile) summary.profile = profile;
    const tokenBudget = numberPath(output, ["tokenBudget"]) ?? numberPath(output, ["token_budget"]);
    if (tokenBudget !== undefined) summary.tokenBudget = tokenBudget;
  }
  if (toolName === "loo_codex_control_dry_run") {
    const upstreamBlocked = blockers.length > 0;
    const dryRunOutput = unwrapToolDetails(output) ?? output;
    summary.live = booleanPath(dryRunOutput, ["live"]);
    const approvalAuditId = stringPath(dryRunOutput, ["approval_audit_id"]) || stringPath(dryRunOutput, ["approvalAuditId"]);
    const paramsHash = stringPath(dryRunOutput, ["params_hash"]) || stringPath(dryRunOutput, ["paramsHash"]);
    const messageHash = stringPath(dryRunOutput, ["message_hash"]) || stringPath(dryRunOutput, ["messageHash"]);
    const method = stringPath(dryRunOutput, ["method"]);
    const action = stringPath(dryRunOutput, ["action"]);
    if (approvalAuditId) summary.approvalAuditId = approvalAuditId;
    if (paramsHash) summary.paramsHash = paramsHash;
    if (messageHash) summary.messageHash = messageHash;
    if (method) summary.method = method;
    if (action) summary.action = action;
    if (!upstreamBlocked && (summary.live !== false || !approvalAuditId || !paramsHash || !messageHash)) {
      blockers.push("openclaw_control_dry_run_not_proven");
    }
  }

  return {
    toolName,
    exitStatus: call.status,
    ok: blockers.length === 0,
    gatewayMethod: "tools.invoke",
    summary,
    blockers
  };
}

function toolPayloadBlockers(toolName: string, payload: unknown): string[] {
  if (!isRecord(payload) || payload.ok !== false) return [];
  const code = stringPath(payload, ["error", "code"]);
  const safeCode = code && /^[a-z0-9_.-]+$/i.test(code) ? `:${code}` : "";
  return [`openclaw_tool_result_not_ok:${toolName}${safeCode}`];
}

function gatewayFailureBlockers(call: GatewayCallResult, fallback: string, toolName?: string): string[] {
  if (call.status === 0) return [];
  const combined = `${call.stderr}\n${call.stdout}`;
  if (/scope upgrade pending approval/i.test(combined)) {
    return [toolName ? `openclaw_gateway_scope_upgrade_pending:${toolName}` : "openclaw_gateway_scope_upgrade_pending"];
  }
  if (/device identity required/i.test(combined)) {
    return [toolName ? `openclaw_gateway_device_identity_required:${toolName}` : "openclaw_gateway_device_identity_required"];
  }
  if (/device token mismatch/i.test(combined)) {
    return [toolName ? `openclaw_gateway_device_token_mismatch:${toolName}` : "openclaw_gateway_device_token_mismatch"];
  }
  if (/GatewayExplicitAuthRequiredError|GatewayCredentialsRequiredError|requires credentials before opening a websocket|gateway .*requires credentials/i.test(combined)) {
    return [toolName ? `openclaw_gateway_credentials_required:${toolName}` : "openclaw_gateway_credentials_required"];
  }
  return [fallback];
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

function unwrapGatewayPayload(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ("payload" in value) return unwrapGatewayPayload(value.payload);
  if ("result" in value) return unwrapGatewayPayload(value.result);
  return value;
}

function unwrapToolOutput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ("output" in value) return value.output;
  if ("result" in value) return value.result;
  return value;
}

function unwrapToolDetails(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.details)) return value.details;
  if (Array.isArray(value.content)) {
    for (const item of value.content) {
      if (!isRecord(item) || typeof item.text !== "string") continue;
      try {
        const parsed = JSON.parse(item.text) as unknown;
        if (isRecord(parsed)) return parsed;
      } catch {
        // Non-JSON text content is not useful for public-safe proof extraction.
      }
    }
  }
  return undefined;
}

function extractCatalogToolNames(value: unknown): string[] {
  const tools: unknown[] = [];
  const collect = (item: unknown) => {
    if (!isRecord(item)) return;
    if (Array.isArray(item.tools)) tools.push(...item.tools);
    if (Array.isArray(item.groups)) {
      for (const group of item.groups) collect(group);
    }
  };
  collect(value);
  return [...new Set(tools.flatMap((tool) => {
    if (typeof tool === "string") return [tool];
    if (!isRecord(tool)) return [];
    if (typeof tool.name === "string") return [tool.name];
    if (typeof tool.id === "string") return [tool.id];
    if (Array.isArray(tool.names)) return tool.names.filter((name): name is string => typeof name === "string");
    return [];
  }))];
}

function collectSourceRefs(value: unknown): string[] {
  const refs = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === "string") {
      if (/^(codex_thread|codex_event|lcm_summary):/.test(item)) refs.add(item);
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (isRecord(item)) {
      for (const [key, child] of Object.entries(item)) {
        if ((key === "sourceRef" || key === "source_ref") && typeof child === "string") visit(child);
        else if (key === "threadId" || key === "thread_id" || key === "sourceRef" || key === "source_ref" || key === "results") visit(child);
      }
    }
  };
  visit(value);
  return [...refs];
}

function extractThreadId(value: unknown, sourceRefs: string[]): string | undefined {
  const direct = findFirstStringByKey(value, new Set(["threadId", "thread_id"]));
  if (direct) return direct;
  const ref = sourceRefs.find((candidate) => candidate.startsWith("codex_thread:"));
  return ref ? ref.slice("codex_thread:".length) : undefined;
}

function findFirstStringByKey(value: unknown, keys: Set<string>): string | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = findFirstStringByKey(child, keys);
      if (match) return match;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key) && typeof child === "string") return child;
    const match = findFirstStringByKey(child, keys);
    if (match) return match;
  }
  return undefined;
}

function outputKind(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null || value === undefined) return "none";
  return typeof value;
}

function outputCount(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  if (isRecord(value) && Array.isArray(value.results)) return value.results.length;
  return undefined;
}

function stringPath(value: unknown, path: string[]): string | undefined {
  const found = valueAtPath(value, path);
  return typeof found === "string" ? found : undefined;
}

function numberPath(value: unknown, path: string[]): number | undefined {
  const found = valueAtPath(value, path);
  return typeof found === "number" ? found : undefined;
}

function booleanPath(value: unknown, path: string[]): boolean | undefined {
  const found = valueAtPath(value, path);
  return typeof found === "boolean" ? found : undefined;
}

function valueAtPath(value: unknown, path: string[]): unknown {
  let cursor = value;
  for (const segment of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
