import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";

export const DEFAULT_REQUIRED_TOOL_CALLS = [
  "loo_doctor",
  "loo_search_sessions",
  "loo_codex_thread_map",
  "loo_describe_session",
  "loo_expand_query",
  "loo_codex_plans",
  "loo_codex_final_messages",
  "loo_codex_touched_files",
  "loo_codex_control_dry_run",
  "loo_recent_sessions",
  "loo_cockpit_inbox",
  "loo_codex_collaboration_cockpit",
  "loo_codex_collaboration_next_steps",
  "loo_codex_runtime_desktop_visibility_status",
  "loo_codex_desktop_collaboration_proof",
  "loo_watchers_list",
  "loo_watcher_status",
  "loo_watcher_dry_run",
  "loo_resume_request_packet",
  "loo_codex_app_server_status",
  "loo_codex_app_server_threads",
  "loo_visible_codex_map",
  "loo_codex_desktop_coherence",
  "loo_plan_state_pins",
  "loo_github_operating_items",
  "loo_project_digest",
  "loo_attention_inbox",
  "loo_business_pulse"
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
  desktopFallbackCoherence?: "fixture" | "omit";
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
    fallbackReason?: string;
    toolBlockers?: string[];
    nextToolCall?: {
      tool: "loo_codex_desktop_coherence" | "loo_desktop_live_proof_harness";
      args: {
        thread_id?: string;
        source_ref?: string;
        backend?: string;
        target_app?: string;
        target_window?: string;
        action?: string;
        approval_ref?: string;
      };
      execute?: false;
    };
    proofStatus?: string;
    approvalVerified?: boolean;
    actionHash?: string;
    runtimeVisibilityStatus?: string;
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
  agentReasoning?: {
    safeRecommendation: string;
    selectedThreadId?: string;
    sourceRefs: string[];
    workflowEvidence: string[];
    expansionProfile?: string;
    expansionTokenBudget?: number;
    dryRunApprovalAuditId?: string;
    dryRunParamsHash?: string;
    dryRunMessageHash?: string;
    dryRunLive?: boolean;
    rawTranscriptRead: false;
  };
  blockers: string[];
  setupBlockers: string[];
  setupGuidance: string[];
  setupStatus: {
    classification: "ready" | "gateway_setup_required" | "gateway_blocked";
    packageInstallLikelyOk: boolean;
    recoverable: boolean;
    retryAfterSetup: boolean;
    doesNotIndicatePackageFailure: boolean;
  };
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
export const OPENCLAW_GATEWAY_BACKEND_CLIENT_ID = "gateway-client";
export const OPENCLAW_GATEWAY_BACKEND_PROTOCOL = { minProtocol: 4, maxProtocol: 4 } as const;

export function runOpenClawToolSmoke(options: OpenClawToolSmokeOptions = {}): OpenClawToolSmokeReport {
  const requiredTools = [...new Set(options.requiredTools?.length ? options.requiredTools : DEFAULT_REQUIRED_TOOL_CALLS)];
  const openclawBin = options.openclawBin || "openclaw";
  const baseArgs = [
    ...(options.dev && !options.profile ? ["--dev"] : []),
    ...(options.profile ? ["--profile", options.profile] : [])
  ];
  const gatewayTimeoutMs = options.gatewayTimeoutMs ?? 60_000;
  const gatewayOptions = [
    ...(options.gatewayUrl ? ["--url", options.gatewayUrl] : []),
    ...gatewayTokenArgs(options.token || process.env.OPENCLAW_GATEWAY_TOKEN),
    "--timeout",
    String(gatewayTimeoutMs)
  ];
  const gatewayToken = options.token || process.env.OPENCLAW_GATEWAY_TOKEN;
  const gatewayEnv = options.token ? { OPENCLAW_GATEWAY_TOKEN: options.token } : undefined;
  const usesBackendGateway = Boolean(options.gatewayUrl && gatewayToken && gatewayToken !== "__OPENCLAW_REDACTED__");
  const sessionKey = options.sessionKey || "agent:main:lco-tool-smoke";
  const query = options.query || "Proposed plan";
  const expandProfile = options.expandProfile || "brief";
  const tokenBudget = options.tokenBudget ?? 1000;
  const runId = randomUUID();

  const gatewayCallOptions = { env: gatewayEnv, timeoutMs: gatewayTimeoutMs, backendUrl: options.gatewayUrl, token: gatewayToken };
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
        tokenBudget,
        desktopFallbackCoherence: options.desktopFallbackCoherence
      });
      if (toolName === "loo_describe_session" || toolName === "loo_expand_session" || toolName === "loo_codex_control_dry_run" || toolName === "loo_codex_desktop_coherence" || toolName === "loo_codex_desktop_fallback_status") {
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
      annotateRequestedExpansionProfile(summary, args);
      invocations.push(summary);
      blockers.push(...summary.blockers);
      if (!selectedThreadId) {
        selectedThreadId = summary.summary.threadId;
      }
    }
  }

  const uniqueBlockers = [...new Set(blockers)];
  const setupBlockers = setupBlockersFor(uniqueBlockers);
  const setupStatus = setupStatusFor(uniqueBlockers, setupBlockers);
  const agentReasoning = buildAgentReasoning(invocations, uniqueBlockers);
  const report: OpenClawToolSmokeReport = {
    ok: uniqueBlockers.length === 0,
    toolSmokeReady: uniqueBlockers.length === 0,
    publicSafe: true,
    command: usesBackendGateway
      ? "loo backend-gateway tools.catalog --json --params <redacted>"
      : `${sanitizeCommandBinary(openclawBin)} ${[...baseArgs, "gateway", "call", "tools.catalog", "--json", "--params", "<redacted>"].join(" ")}`,
    catalog: {
      exitStatus: catalogCall.status,
      requiredTools,
      requiredToolsPresent: catalogComparable && missingRequiredTools.length === 0,
      missingRequiredTools,
      toolCount: catalogToolNames.length
    },
    invocations,
    ...(agentReasoning ? { agentReasoning } : {}),
    blockers: uniqueBlockers,
    setupBlockers,
    setupGuidance: setupGuidanceFor(setupBlockers),
    setupStatus,
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
    nextAction: nextActionForBlockers(uniqueBlockers)
  };

  if (options.evidencePath) {
    mkdirSync(dirname(options.evidencePath), { recursive: true });
    writeFileSync(options.evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

function buildAgentReasoning(
  invocations: OpenClawToolInvocationSummary[],
  blockers: string[]
): OpenClawToolSmokeReport["agentReasoning"] | undefined {
  if (blockers.length > 0) return undefined;
  const byTool = new Map(invocations.map((invocation) => [invocation.toolName, invocation]));
  const search = byTool.get("loo_search_sessions");
  const describe = byTool.get("loo_describe_session");
  const expand = byTool.get("loo_expand_query") ?? byTool.get("loo_expand_session");
  const dryRun = byTool.get("loo_codex_control_dry_run");
  const sourceRefs = [...new Set(invocations.flatMap((invocation) => invocation.summary.sourceRefs ?? []))].slice(0, 5);
  const selectedThreadId = describe?.summary.threadId || search?.summary.threadId || dryRun?.summary.threadId;
  const workflowEvidence = [
    ...(byTool.get("loo_doctor")?.ok ? ["doctor_ready"] : []),
    ...(sourceRefs.length ? ["search_source_ref"] : []),
    ...(describe?.summary.threadId ? ["describe_thread"] : []),
    ...(expand?.summary.profile || expand?.summary.tokenBudget ? ["bounded_expand"] : []),
    ...(byTool.get("loo_codex_plans")?.ok ? ["plan_lookup"] : []),
    ...(byTool.get("loo_codex_final_messages")?.ok ? ["final_message_lookup"] : []),
    ...(byTool.get("loo_codex_touched_files")?.ok ? ["touched_files_lookup"] : []),
    ...(dryRun?.summary.approvalAuditId && dryRun.summary.live === false ? ["dry_run_audit"] : [])
  ];

  if (!selectedThreadId || sourceRefs.length === 0 || !workflowEvidence.includes("bounded_expand")) return undefined;

  return {
    safeRecommendation: "Review the selected Codex session from source refs, then ask the user before any live Codex control.",
    selectedThreadId,
    sourceRefs,
    workflowEvidence,
    ...(expand?.summary.profile ? { expansionProfile: expand.summary.profile } : {}),
    ...(expand?.summary.tokenBudget !== undefined ? { expansionTokenBudget: expand.summary.tokenBudget } : {}),
    ...(dryRun?.summary.approvalAuditId ? { dryRunApprovalAuditId: dryRun.summary.approvalAuditId } : {}),
    ...(dryRun?.summary.paramsHash ? { dryRunParamsHash: dryRun.summary.paramsHash } : {}),
    ...(dryRun?.summary.messageHash ? { dryRunMessageHash: dryRun.summary.messageHash } : {}),
    ...(dryRun?.summary.live !== undefined ? { dryRunLive: dryRun.summary.live } : {}),
    rawTranscriptRead: false
  };
}

function annotateRequestedExpansionProfile(summary: OpenClawToolInvocationSummary, args: Record<string, unknown> | null): void {
  if (summary.toolName !== "loo_expand_query" && summary.toolName !== "loo_expand_session") return;
  if (!args) return;
  if (summary.summary.profile === undefined && typeof args.profile === "string") summary.summary.profile = args.profile;
  if (summary.summary.tokenBudget === undefined && typeof args.token_budget === "number") summary.summary.tokenBudget = args.token_budget;
}

function gatewayTokenArgs(token: string | undefined): string[] {
  if (!token || token === "__OPENCLAW_REDACTED__") return [];
  return ["--token", token];
}

function callGatewayJson(
  openclawBin: string,
  baseArgs: string[],
  gatewayOptions: string[],
  method: string,
  params: unknown,
  options: { env?: Record<string, string>; timeoutMs?: number; backendUrl?: string; token?: string } = {}
): GatewayJsonResult {
  if (options.backendUrl && options.token && options.token !== "__OPENCLAW_REDACTED__") {
    return callGatewayBackendJson(options.backendUrl, options.token, method, params, options.timeoutMs ?? 60_000);
  }
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

function callGatewayBackendJson(
  gatewayUrl: string,
  token: string,
  method: string,
  params: unknown,
  timeoutMs: number
): GatewayJsonResult {
  const request = JSON.stringify({
    url: gatewayUrl,
    method,
    params,
    timeoutMs,
    userAgent: "loo-openclaw-tool-smoke"
  });
  const call = spawnSync(process.execPath, ["--input-type=module", "-e", GATEWAY_BACKEND_CALL_SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      LOO_GATEWAY_BACKEND_REQUEST: request,
      LOO_GATEWAY_BACKEND_TOKEN: token
    },
    maxBuffer: 20 * 1024 * 1024,
    timeout: gatewayProcessTimeoutMs(timeoutMs)
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

const GATEWAY_BACKEND_CALL_SCRIPT = `
const rawRequest = process.env.LOO_GATEWAY_BACKEND_REQUEST || "{}";
const token = process.env.LOO_GATEWAY_BACKEND_TOKEN || "";
const request = JSON.parse(rawRequest);
const timeoutMs = Math.max(250, Number(request.timeoutMs) || 60000);
const ws = new WebSocket(request.url);
const timer = setTimeout(() => {
  try { ws.close(); } catch {}
  console.error("gateway backend call timed out");
  process.exit(124);
}, timeoutMs);
let connectSent = false;
function sendConnect() {
  if (connectSent) return;
  connectSent = true;
  ws.send(JSON.stringify({
    type: "req",
    id: "connect-1",
    method: "connect",
    params: {
      minProtocol: ${OPENCLAW_GATEWAY_BACKEND_PROTOCOL.minProtocol},
      maxProtocol: ${OPENCLAW_GATEWAY_BACKEND_PROTOCOL.maxProtocol},
      client: {
        id: ${JSON.stringify(OPENCLAW_GATEWAY_BACKEND_CLIENT_ID)},
        displayName: "loo-openclaw-tool-smoke",
        version: "loo",
        platform: process.platform,
        mode: "backend"
      },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      caps: [],
      commands: [],
      permissions: {},
      auth: { token },
      locale: "en-US",
      userAgent: request.userAgent || "loo-openclaw-tool-smoke"
    }
  }));
}
ws.addEventListener("open", () => setTimeout(sendConnect, 10));
ws.addEventListener("message", (event) => {
  let message;
  try {
    message = JSON.parse(String(event.data || ""));
  } catch {
    return;
  }
  if (message.type === "event" && message.event === "connect.challenge") sendConnect();
  if (message.type !== "res") return;
  if (message.id === "connect-1") {
    if (!message.ok) {
      clearTimeout(timer);
      console.error(JSON.stringify(message.error || { message: "gateway connect failed" }));
      process.exit(1);
    }
    ws.send(JSON.stringify({
      type: "req",
      id: "call-1",
      method: request.method,
      params: request.params || {}
    }));
    return;
  }
  if (message.id === "call-1") {
    clearTimeout(timer);
    if (!message.ok) {
      console.error(JSON.stringify(message.error || { message: "gateway call failed" }));
      process.exit(2);
    }
    console.log(JSON.stringify(message.payload));
    ws.close();
  }
});
ws.addEventListener("error", () => {
  clearTimeout(timer);
  console.error("gateway websocket error");
  process.exit(1);
});
`;

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
  desktopFallbackCoherence?: "fixture" | "omit";
}): Record<string, unknown> | null {
  if (params.toolName === "loo_search_sessions") return { query: params.query, limit: 3 };
  if (params.toolName === "loo_describe_session") return params.threadId ? { thread_id: params.threadId } : null;
  if (params.toolName === "loo_expand_session") {
    return params.threadId ? { thread_id: params.threadId, profile: params.expandProfile, token_budget: params.tokenBudget } : null;
  }
  if (params.toolName === "loo_expand_query") return { query: params.query, profile: params.expandProfile, token_budget: params.tokenBudget };
  if (params.toolName === "loo_codex_plans" || params.toolName === "loo_codex_final_messages" || params.toolName === "loo_codex_touched_files") {
    return {
      ...(params.threadId ? { thread_id: params.threadId } : {}),
      limit: 3
    };
  }
  if (params.toolName === "loo_codex_thread_map") return { limit: 20 };
  if (params.toolName === "loo_cockpit_inbox") {
    return params.threadId ? { limit: 5, watcher_specs: smokeWatcherSpecs(params.threadId), now: TOOL_SMOKE_NOW } : { limit: 5 };
  }
  if (params.toolName === "loo_codex_collaboration_cockpit" || params.toolName === "loo_codex_collaboration_next_steps") {
    return smokeCollaborationFixtureArgs(params.threadId);
  }
  if (params.toolName === "loo_codex_runtime_desktop_visibility_status") {
    return {
      ...smokeCollaborationFixtureArgs(params.threadId),
      desktop_collaboration_proof_reports: [smokeCodexDesktopCollaborationProofReport(params.threadId)]
    };
  }
  if (params.toolName === "loo_codex_desktop_collaboration_proof") {
    return smokeCodexDesktopCollaborationProofArgs(params.threadId);
  }
  if (params.toolName === "loo_watchers_list" || params.toolName === "loo_watcher_dry_run") {
    return { watcher_specs: smokeWatcherSpecs(params.threadId), now: TOOL_SMOKE_NOW };
  }
  if (params.toolName === "loo_watcher_status") {
    return { watcher_specs: smokeWatcherSpecs(params.threadId), watch_id: "watch_tool_smoke_checks", now: TOOL_SMOKE_NOW };
  }
  if (params.toolName === "loo_resume_request_packet") {
    return { watcher_spec: smokeWatcherSpecs(params.threadId)[0], now: TOOL_SMOKE_NOW, ttl_seconds: 900 };
  }
  if (params.toolName === "loo_codex_app_server_status") return {};
  if (params.toolName === "loo_codex_app_server_threads") return { limit: 5 };
  if (params.toolName === "loo_visible_codex_map") return { limit: 5, include_app_server: true, include_visible_snapshot: false };
  if (params.toolName === "loo_codex_desktop_coherence") {
    if (!params.threadId) return null;
    return {
      thread_id: params.threadId,
      limit: 5,
      include_app_server: true,
      include_visible_snapshot: false,
      action_evidence: {
        action_kind: "codex_app_server",
        action: "read-only gateway tool smoke",
        dry_run: true,
        live: false,
        evidence_id: "ev_tool_smoke_desktop_coherence"
      },
      now: TOOL_SMOKE_NOW
    };
  }
  if (params.toolName === "loo_codex_desktop_fallback_status") {
    if (!params.threadId) return null;
    const base = {
      thread_id: params.threadId,
      source_ref: `codex_thread:${params.threadId}`,
      include_visible_snapshot: false,
      now: TOOL_SMOKE_NOW
    };
    if (params.desktopFallbackCoherence === "omit") return base;
    return {
      ...base,
      coherence: {
        state: "cli_visible",
        visibility: {
          cli: "proven",
          desktop: "not_seen"
        },
        confidence: 0.72
      }
    };
  }
  if (params.toolName === "loo_github_operating_items") {
    return {
      github_records: [{
        repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
        number: 264,
        type: "pull_request",
        title: "deterministic GitHub operating item collector",
        state: "open",
        updatedAt: TOOL_SMOKE_NOW,
        checks: { conclusion: "failure", failing: 1 }
      }],
      now: TOOL_SMOKE_NOW
    };
  }
  if (params.toolName === "loo_codex_control_dry_run") {
    return params.threadId ? {
      action: "send",
      thread_id: params.threadId,
      message: CONTROL_DRY_RUN_MESSAGE
    } : null;
  }
  return {};
}

const TOOL_SMOKE_NOW = "2026-07-01T12:00:00.000Z";

function smokeBareThreadId(threadId?: string): string {
  return (threadId || "tool-smoke-placeholder").replace(/^codex_thread:/, "");
}

function smokeCodexThreadRef(threadId?: string): string {
  const bareThreadId = smokeBareThreadId(threadId);
  return `codex_thread:${bareThreadId}`;
}

function smokeWatcherSpecs(threadId?: string): Record<string, unknown>[] {
  const targetRef = smokeCodexThreadRef(threadId);
  return [{
    schema: "lco.watchSpec.v1",
    watchId: "watch_tool_smoke_checks",
    targetRef,
    kind: "pr_checks_changed",
    createdAt: "2026-07-01T11:00:00.000Z",
    lastObservedAt: "2026-07-01T11:55:00.000Z",
    ttlSeconds: 7200,
    stopConditions: ["checks_green", "explicit_cancel"],
    wakeReason: "pr_checks_changed",
    evidenceIds: ["ev_tool_smoke_watcher"],
    confidence: 0.9,
    mutates: false
  }];
}

function smokeCollaborationFixtureArgs(threadId?: string): Record<string, unknown> {
  return {
    limit: 5,
    watcher_specs: smokeWatcherSpecs(threadId),
    desktop_coherence_reports: [smokeDesktopCoherenceReport(threadId)],
    desktop_fallback_reports: [smokeDesktopFallbackReport(threadId)],
    now: TOOL_SMOKE_NOW
  };
}

function smokeDesktopCoherenceReport(threadId?: string): Record<string, unknown> {
  const bareThreadId = smokeBareThreadId(threadId);
  return {
    schema: "lco.codexDesktopCoherence.v1",
    publicSafe: true,
    target: {
      threadId: bareThreadId,
      sourceRef: smokeCodexThreadRef(threadId)
    },
    state: "cli_visible",
    confidence: 0.72,
    evidenceIds: ["ev_tool_smoke_desktop_coherence"],
    blockers: ["desktop_visibility_not_proven"],
    reasonCodes: ["cli_direct_visible_without_desktop_proof"],
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false
    }
  };
}

function smokeDesktopFallbackReport(threadId?: string): Record<string, unknown> {
  const bareThreadId = smokeBareThreadId(threadId);
  return {
    schema: "lco.codex.desktopFallback.v1",
    publicSafe: true,
    readOnly: true,
    target: {
      threadId: bareThreadId,
      sourceRef: smokeCodexThreadRef(threadId)
    },
    fallback: {
      required: true,
      reason: "desktop_visibility_not_proven",
      coherenceState: "cli_visible",
      desktopVisibility: "not_proven"
    },
    preferredBackend: "cua-driver",
    backends: [
      { backend: "cua-driver", role: "preferred_background", status: "ready", blockers: [], warnings: [], takesScreenWarning: false },
      { backend: "peekaboo", role: "secondary_visible_fallback", status: "blocked", blockers: ["visible_fallback_requires_explicit_user_visible_run"], warnings: [], takesScreenWarning: true }
    ],
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      screenshotCaptured: false,
      rawTranscriptRead: false
    }
  };
}

function smokeCodexDesktopCollaborationProofArgs(threadId?: string): Record<string, unknown> {
  const targetRef = smokeCodexThreadRef(threadId);
  const targetThreadId = smokeBareThreadId(threadId);
  const backend = "cua-driver";
  const targetApp = "Codex";
  const targetWindow = "Lossless OpenClaw Orchestrator";
  const action = "verify_visible_thread_alignment";
  const actionHash = createHash("sha256").update(JSON.stringify({
    targetRef,
    desktopBackend: backend,
    targetApp,
    targetWindow,
    action
  })).digest("hex");
  return {
    target_ref: targetRef,
    target_thread_id: targetThreadId,
    backend,
    target_app: targetApp,
    target_window: targetWindow,
    action,
    action_hash: actionHash,
    approval_packet: {
      schema: "lco.codexDesktopCollaborationProofApproval.v1",
      approvalRef: "tool-smoke-action-bound-proof",
      approved: true,
      targetRef,
      targetThreadId,
      desktopBackend: backend,
      targetApp,
      targetWindow,
      action,
      actionHash,
      issuedAt: "2026-07-01T11:55:00.000Z",
      expiresAt: "2999-01-01T00:00:00.000Z",
      preconditions: ["desktop_coherence_desktop_visible", "fallback_backend_ready", "no_screenshot_policy"],
      sourceCoverage: {
        indexedSession: "ok",
        desktopCoherence: "ok",
        desktopFallback: "ok",
        approvalPacket: "ok"
      },
      focusPolicy: {
        screenshotAllowed: false,
        requireNoFocusSteal: true
      }
    },
    execute: false,
    now: TOOL_SMOKE_NOW
  };
}

function smokeCodexDesktopCollaborationProofReport(threadId?: string): Record<string, unknown> {
  const args = smokeCodexDesktopCollaborationProofArgs(threadId);
  return {
    schema: "lco.codexDesktopCollaborationProof.v1",
    publicSafe: true,
    readOnly: true,
    ok: true,
    status: "ready",
    target: {
      targetRef: args.target_ref,
      targetThreadId: args.target_thread_id
    },
    actionHash: args.action_hash,
    approvalVerified: true,
    blockers: [],
    sourceCoverage: {
      indexedSession: "ok",
      desktopCoherence: "ok",
      desktopFallback: "ok",
      approvalPacket: "ok"
    },
    proofMarkers: {
      actionBoundTarget: true,
      approvalPacketBound: true,
      publicSafeEvidenceOnly: true,
      noScreenshotPolicy: true,
      dryRunOnly: true
    },
    requiredNextToolCall: {
      tool: "loo_desktop_live_proof_harness",
      args: {
        backend: args.backend,
        target_app: args.target_app,
        target_window: args.target_window,
        action: args.action,
        approval_ref: "tool-smoke-action-bound-proof"
      },
      execute: false
    },
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false,
      screenshotCaptured: false
    }
  };
}

function summarizeInvocation(toolName: string, call: GatewayJsonResult): OpenClawToolInvocationSummary {
  const payload = call.parsed ? unwrapGatewayPayload(call.parsed) : undefined;
  const blockers = [
    ...gatewayFailureBlockers(call, `openclaw_tool_invoke_failed:${toolName}`, toolName),
    ...(call.status === 0 && !call.parsed ? [`openclaw_tool_result_invalid_json:${toolName}`] : []),
    ...toolPayloadBlockers(toolName, payload)
  ];
  const output = unwrapToolOutput(payload);
  const details = output ? unwrapToolDetails(output) : undefined;
  const summarySource = details ?? output;
  const sourceRefs = summarySource ? collectSourceRefs(summarySource).slice(0, 5) : [];
  const threadId = summarySource ? extractThreadId(summarySource, sourceRefs) : undefined;
  const summary: OpenClawToolInvocationSummary["summary"] = {
    outputKind: outputKind(output),
    ...(sourceRefs.length ? { sourceRefs } : {}),
    ...(threadId ? { threadId } : {})
  };

  const count = outputCount(summarySource);
  if (count !== undefined) summary.count = count;
  if (toolName === "loo_expand_query" || toolName === "loo_expand_session") {
    const profile = stringPath(summarySource, ["profile", "name"]) || stringPath(summarySource, ["profile"]);
    if (profile) summary.profile = profile;
    const tokenBudget = numberPath(summarySource, ["tokenBudget"]) ?? numberPath(summarySource, ["token_budget"]);
    if (tokenBudget !== undefined) summary.tokenBudget = tokenBudget;
  }
  if (toolName === "loo_codex_control_dry_run") {
    const upstreamBlocked = blockers.length > 0;
    const dryRunOutput = details ?? output;
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
  if (toolName === "loo_codex_desktop_fallback_status") {
    const fallbackOutput = details ?? output;
    const fallbackReason = stringPath(fallbackOutput, ["fallback", "reason"]);
    const toolBlockers = arrayPath(fallbackOutput, ["blockers"])
      .filter((value): value is string => typeof value === "string" && /^[a-z0-9_.:-]+$/i.test(value))
      .slice(0, 8);
    const nextToolCall = publicSafeFallbackNextToolCall(isRecord(fallbackOutput) ? fallbackOutput.nextToolCall : undefined);
    if (fallbackReason && /^[a-z0-9_.:-]+$/i.test(fallbackReason)) summary.fallbackReason = fallbackReason;
    if (toolBlockers.length) summary.toolBlockers = toolBlockers;
    if (nextToolCall) summary.nextToolCall = nextToolCall;
    if (
      fallbackReason === "coherence_input_missing" &&
      (!nextToolCall || (!nextToolCall.args.thread_id && !nextToolCall.args.source_ref))
    ) {
      blockers.push("desktop_fallback_next_tool_call_missing");
    }
  }
  if (toolName === "loo_codex_collaboration_next_steps") {
    const steps = arrayPath(summarySource, ["steps"]).filter(isRecord);
    const unsafeExecutable = steps.some((step) => {
      const toolCall = isRecord(step.toolCall) ? step.toolCall : null;
      return toolCall && toolCall.execute !== false;
    });
    if (unsafeExecutable) blockers.push("collaboration_next_step_execute_not_false");
    const invalidStatus = steps.some((step) => {
      const status = stringPath(step, ["status"]);
      return status !== "ready" && status !== "blocked" && status !== "noop";
    });
    if (invalidStatus) blockers.push("collaboration_next_step_invalid_status");
    const readyMissingToolCall = steps.some((step) => stringPath(step, ["status"]) === "ready" && !isRecord(step.toolCall));
    if (readyMissingToolCall) blockers.push("collaboration_next_step_ready_missing_tool_call");
    const blockedMissingBoundary = steps.some((step) => {
      if (stringPath(step, ["status"]) !== "blocked") return false;
      const toolCall = isRecord(step.toolCall) ? step.toolCall : null;
      const stepBlockers = arrayPath(step, ["blockers"]).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
      return Boolean(toolCall) || stepBlockers.length === 0;
    });
    if (blockedMissingBoundary) blockers.push("collaboration_next_step_blocked_boundary_missing");
    const actions = isRecord(summarySource) && isRecord(summarySource.actionsPerformed) ? summarySource.actionsPerformed : null;
    if (
      !actions ||
      actions.liveCodexControlRun !== false ||
      actions.desktopGuiActionRun !== false ||
      actions.rawTranscriptRead !== false ||
      actions.screenshotCaptured !== false ||
      actions.npmPublished !== false ||
      actions.githubReleaseCreated !== false
    ) {
      blockers.push("collaboration_next_steps_restricted_action");
    }
  }
  if (toolName === "loo_codex_desktop_collaboration_proof") {
    const proofOutput = details ?? output;
    const status = stringPath(proofOutput, ["status"]);
    const actionHash = stringPath(proofOutput, ["actionHash"]) || stringPath(proofOutput, ["action_hash"]);
    const nextToolCall = publicSafeCollaborationProofNextToolCall(isRecord(proofOutput) ? proofOutput.requiredNextToolCall : undefined);
    summary.proofStatus = status;
    summary.approvalVerified = booleanPath(proofOutput, ["approvalVerified"]);
    if (actionHash && /^[a-f0-9]{64}$/i.test(actionHash)) summary.actionHash = actionHash;
    if (nextToolCall) summary.nextToolCall = nextToolCall;
    if (status !== "ready" && status !== "blocked") blockers.push("desktop_collaboration_proof_invalid_status");
    if (status === "ready" && !nextToolCall) blockers.push("desktop_collaboration_proof_next_tool_missing");
    if (status === "ready" && nextToolCall?.execute !== false) blockers.push("desktop_collaboration_proof_next_tool_execute_not_false");
    const actions = isRecord(proofOutput) && isRecord(proofOutput.actionsPerformed) ? proofOutput.actionsPerformed : null;
    if (
      !actions ||
      actions.liveCodexControlRun !== false ||
      actions.desktopGuiActionRun !== false ||
      actions.rawTranscriptRead !== false ||
      actions.screenshotCaptured !== false
    ) {
      blockers.push("desktop_collaboration_proof_restricted_action");
    }
  }
  if (toolName === "loo_codex_runtime_desktop_visibility_status") {
    const runtimeOutput = details ?? output;
    const status = stringPath(runtimeOutput, ["status"]);
    const lanes = arrayPath(runtimeOutput, ["lanes"]).filter(isRecord);
    const nextToolCall = lanes
      .map((lane) => isRecord(lane.nextToolCall) ? lane.nextToolCall : null)
      .find((candidate): candidate is Record<string, unknown> => Boolean(candidate));
    if (status) summary.runtimeVisibilityStatus = status;
    if (nextToolCall) summary.nextToolCall = publicSafeRuntimeVisibilityNextToolCall(nextToolCall);
    if (status !== "covered" && status !== "partial" && status !== "blocked") blockers.push("runtime_desktop_visibility_invalid_status");
    if (lanes.some((lane) => {
      const coverage = stringPath(lane, ["coverage"]);
      return coverage !== "covered" && coverage !== "partial" && coverage !== "blocked";
    })) blockers.push("runtime_desktop_visibility_invalid_lane_coverage");
    if (lanes.some((lane) => {
      const toolCall = isRecord(lane.nextToolCall) ? lane.nextToolCall : null;
      return toolCall && toolCall.execute !== false;
    })) blockers.push("runtime_desktop_visibility_next_tool_execute_not_false");
    const actions = isRecord(runtimeOutput) && isRecord(runtimeOutput.actionsPerformed) ? runtimeOutput.actionsPerformed : null;
    if (
      !actions ||
      actions.liveCodexControlRun !== false ||
      actions.desktopGuiActionRun !== false ||
      actions.rawTranscriptRead !== false ||
      actions.screenshotCaptured !== false ||
      actions.npmPublished !== false ||
      actions.githubReleaseCreated !== false
    ) {
      blockers.push("runtime_desktop_visibility_restricted_action");
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
  const output = unwrapToolOutput(payload);
  const details = unwrapToolDetails(output) ?? output;
  const failedPayload = [payload, output, details].find((candidate) => isRecord(candidate) && candidate.ok === false);
  if (!isRecord(failedPayload)) return [];
  const code = stringPath(failedPayload, ["error", "code"]);
  const safeCode = code && /^[a-z0-9_.-]+$/i.test(code) ? `:${code}` : "";
  return [`openclaw_tool_result_not_ok:${toolName}${safeCode}`];
}

function publicSafeFallbackNextToolCall(value: unknown): OpenClawToolInvocationSummary["summary"]["nextToolCall"] | undefined {
  if (!isRecord(value)) return undefined;
  if (stringPath(value, ["tool"]) !== "loo_codex_desktop_coherence") return undefined;
  const args = isRecord(value.args) ? value.args : {};
  const threadId = stringPath(args, ["thread_id"]) || stringPath(args, ["threadId"]);
  const sourceRef = stringPath(args, ["source_ref"]) || stringPath(args, ["sourceRef"]);
  const safeArgs: { thread_id?: string; source_ref?: string } = {};
  if (threadId && /^[A-Za-z0-9._:-]+$/.test(threadId)) safeArgs.thread_id = threadId;
  if (sourceRef && /^codex_thread:[A-Za-z0-9._:-]+$/.test(sourceRef)) safeArgs.source_ref = sourceRef;
  return { tool: "loo_codex_desktop_coherence", args: safeArgs };
}

function publicSafeCollaborationProofNextToolCall(value: unknown): OpenClawToolInvocationSummary["summary"]["nextToolCall"] | undefined {
  if (!isRecord(value)) return undefined;
  if (stringPath(value, ["tool"]) !== "loo_desktop_live_proof_harness") return undefined;
  const args = isRecord(value.args) ? value.args : {};
  const backend = stringPath(args, ["backend"]);
  const targetApp = stringPath(args, ["target_app"]);
  const targetWindow = stringPath(args, ["target_window"]);
  const action = stringPath(args, ["action"]);
  const approvalRef = stringPath(args, ["approval_ref"]);
  if (!backend || !/^(cua-driver|peekaboo)$/.test(backend)) return undefined;
  if (!targetApp || !targetWindow || !action || !approvalRef) return undefined;
  return {
    tool: "loo_desktop_live_proof_harness",
    args: {
      backend,
      target_app: targetApp.slice(0, 120),
      target_window: targetWindow.slice(0, 160),
      action: action.slice(0, 160),
      approval_ref: approvalRef.slice(0, 160)
    },
    execute: value.execute === false ? false : undefined
  };
}

function publicSafeRuntimeVisibilityNextToolCall(value: unknown): OpenClawToolInvocationSummary["summary"]["nextToolCall"] | undefined {
  if (!isRecord(value)) return undefined;
  const tool = stringPath(value, ["tool"]);
  if (tool === "loo_desktop_live_proof_harness") return publicSafeCollaborationProofNextToolCall(value);
  if (tool === "loo_codex_desktop_coherence") return publicSafeFallbackNextToolCall(value);
  return undefined;
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

function nextActionForBlockers(blockers: string[]): string {
  if (blockers.length === 0) return "Use this packet to update the local-agent usability scorecard before RC signoff.";
  if (hasBlocker(blockers, "openclaw_gateway_scope_upgrade_pending")) {
    return "Resolve the OpenClaw gateway scope approval for the listed loo_* tools, then rerun the tool-smoke. Do not treat this as approval for live Codex control or broad gateway scope.";
  }
  if (hasBlocker(blockers, "openclaw_gateway_device_identity_required")) {
    return "Pair or approve the local OpenClaw device identity, or run an explicit loopback token-auth gateway for local dogfood, then rerun the tool-smoke.";
  }
  if (hasBlocker(blockers, "openclaw_gateway_device_token_mismatch")) {
    return "Rotate or reissue the OpenClaw gateway device token, confirm the caller uses the current token, then rerun the tool-smoke without storing the token in evidence.";
  }
  if (hasBlocker(blockers, "openclaw_gateway_credentials_required")) {
    return "Use a profile with OpenClaw gateway credentials, pass a scoped --token or OPENCLAW_GATEWAY_TOKEN, or run an explicit loopback token-auth gateway for local dogfood; then rerun the tool-smoke.";
  }
  return "Fix or document the gateway tool-call blocker before claiming first-class OpenClaw agent usability.";
}

function setupBlockersFor(blockers: string[]): string[] {
  const setupBlockers: string[] = [];
  if (hasBlocker(blockers, "openclaw_gateway_credentials_required")) {
    setupBlockers.push("fresh_profile_gateway_credentials_required");
  }
  if (hasBlocker(blockers, "openclaw_gateway_device_identity_required")) {
    setupBlockers.push("openclaw_device_identity_pairing_required");
  }
  if (hasBlocker(blockers, "openclaw_gateway_device_token_mismatch")) {
    setupBlockers.push("openclaw_gateway_token_rotation_required");
  }
  if (hasBlocker(blockers, "openclaw_gateway_scope_upgrade_pending")) {
    setupBlockers.push("openclaw_gateway_scope_approval_required");
  }
  return [...new Set(setupBlockers)];
}

function setupGuidanceFor(setupBlockers: string[]): string[] {
  return setupBlockers.map((blocker) => {
    if (blocker === "fresh_profile_gateway_credentials_required") {
      return "Fresh OpenClaw profiles may install and list the plugin before they can call gateway tools. Select a provisioned profile, pass a scoped gateway token, or complete device/profile pairing before treating tool-smoke as product failure.";
    }
    if (blocker === "openclaw_device_identity_pairing_required") {
      return "Pair or approve the local OpenClaw device identity before rerunning gateway tool-smoke.";
    }
    if (blocker === "openclaw_gateway_token_rotation_required") {
      return "Rotate or reissue the gateway token and keep the replacement out of public evidence.";
    }
    if (blocker === "openclaw_gateway_scope_approval_required") {
      return "Approve only the required gateway tool scopes; this is not broad gateway scope or live-control approval.";
    }
    return "Resolve the OpenClaw gateway setup blocker before claiming first-class agent usability.";
  });
}

function setupStatusFor(blockers: string[], setupBlockers: string[]): OpenClawToolSmokeReport["setupStatus"] {
  // Keep both booleans: one guides install/package triage, the other guards release-claim wording.
  if (blockers.length === 0) {
    return {
      classification: "ready",
      packageInstallLikelyOk: true,
      recoverable: false,
      retryAfterSetup: false,
      doesNotIndicatePackageFailure: true
    };
  }
  if (isSetupOnlyBlockerSet(blockers, setupBlockers)) {
    return {
      classification: "gateway_setup_required",
      packageInstallLikelyOk: true,
      recoverable: true,
      retryAfterSetup: true,
      doesNotIndicatePackageFailure: true
    };
  }
  return {
    classification: "gateway_blocked",
    packageInstallLikelyOk: false,
    recoverable: false,
    retryAfterSetup: false,
    doesNotIndicatePackageFailure: false
  };
}

function isSetupOnlyBlockerSet(blockers: string[], setupBlockers: string[]): boolean {
  const setupTriggerPrefixes = [
    "openclaw_gateway_credentials_required",
    "openclaw_gateway_device_identity_required",
    "openclaw_gateway_device_token_mismatch",
    "openclaw_gateway_scope_upgrade_pending"
  ];
  return setupBlockers.length > 0 && blockers.every((blocker) => setupTriggerPrefixes.some((prefix) => hasBlocker([blocker], prefix)));
}

function hasBlocker(blockers: string[], prefix: string): boolean {
  return blockers.some((blocker) => blocker === prefix || blocker.startsWith(`${prefix}:`));
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
  if (isRecord(value) && Array.isArray(value.lanes)) return value.lanes.length;
  if (isRecord(value) && Array.isArray(value.steps)) return value.steps.length;
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

function arrayPath(value: unknown, path: string[]): unknown[] {
  const found = valueAtPath(value, path);
  return Array.isArray(found) ? found : [];
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
