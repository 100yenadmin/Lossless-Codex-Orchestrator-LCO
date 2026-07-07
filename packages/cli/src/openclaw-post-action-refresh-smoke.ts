import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export type OpenClawPostActionRefreshSmokeOptions = {
  openclawBin?: string;
  dev?: boolean;
  profile?: string;
  gatewayUrl?: string;
  token?: string;
  sessionKey?: string;
  threadId: string;
  query?: string;
  expandProfile?: "metadata" | "brief" | "evidence";
  tokenBudget?: number;
  evidenceDir: string;
  liveProofReportPath: string;
  gatewayTimeoutMs?: number;
  now?: string;
};

export type OpenClawPostActionRefreshSmokeReport = {
  ok: boolean;
  proofReady: boolean;
  publicSafe: boolean;
  generatedAt: string;
  command: string;
  requiredTools: string[];
  targetRef: string;
  liveProof: {
    path: string;
    accepted: boolean;
    targetMatches: boolean;
    actionObservedAt: string | null;
  };
  refresh: {
    postActionRefresh: boolean;
    refreshedAt: string | null;
    refreshedAfterLiveAction: boolean;
    statusBucket: string | null;
    safeSummaryDelta: boolean;
    boundedExpansionProfile: string | null;
  };
  reasoning: {
    agentReasoningNote: string;
    sourceRefs: string[];
    omittedMarkers: string[];
  };
  runtimeProofPath: string;
  reportPath: string;
  blockers: string[];
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    npmPublished: false;
    githubReleaseCreated: false;
    rawTranscriptRead: false;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

type GatewayCallResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  parsed?: unknown;
  parseError?: string;
};

type LiveProofSummary = {
  accepted: boolean;
  targetRef: string | null;
  actionObservedAt: string | null;
  blockers: string[];
};

const SCENARIO_ID = "post-action-refresh-reasoning-v1-1";
const REQUIRED_TOOLS = ["loo_codex_thread_map", "loo_search_sessions", "loo_describe_session", "loo_expand_query"];
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
const DEFAULT_QUERY = "gateway live smoke acknowledged";
const RAW_PRIVATE_PATTERN = /(RAW_TRANSCRIPT|private raw session|BEGIN [A-Z ]*PRIVATE KEY|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/i;
const POST_ACTION_DELTA_PATTERN = /(post[- ]action|safe summary delta|delta marker|gateway live smoke|acknowledged|refreshed after)/i;

export function runOpenClawPostActionRefreshSmoke(options: OpenClawPostActionRefreshSmokeOptions): OpenClawPostActionRefreshSmokeReport {
  mkdirSync(options.evidenceDir, { recursive: true });
  const openclawBin = options.openclawBin || "openclaw";
  const baseArgs = [
    ...(options.dev ? ["--dev"] : []),
    ...(options.profile ? ["--profile", options.profile] : [])
  ];
  const gatewayTimeoutMs = options.gatewayTimeoutMs ?? 120_000;
  const gatewayOptions = [
    ...(options.gatewayUrl ? ["--url", options.gatewayUrl] : []),
    "--timeout",
    String(gatewayTimeoutMs)
  ];
  const callOptions = { timeoutMs: gatewayTimeoutMs, env: options.token ? { OPENCLAW_GATEWAY_TOKEN: options.token } : undefined };
  const sessionKey = options.sessionKey || "agent:main:lco-post-action-refresh-smoke";
  const targetRef = `codex_thread:${options.threadId}`;
  const query = options.query || DEFAULT_QUERY;
  const expandProfile = options.expandProfile || "brief";
  const tokenBudget = options.tokenBudget ?? 1000;
  const idempotencyNonce = sanitizeId(`${options.now ?? new Date().toISOString()}-${randomUUID()}`);
  const blockers: string[] = [];

  const liveProof = readLiveProof(options.liveProofReportPath, targetRef);
  blockers.push(...liveProof.blockers);

  const catalog = callGatewayJson(openclawBin, baseArgs, gatewayOptions, "tools.catalog", {}, callOptions);
  const catalogTools = catalog.status === 0 && catalog.parsed !== undefined ? extractCatalogToolNames(unwrapGatewayPayload(catalog.parsed)) : [];
  blockers.push(...gatewayCallBlockers(catalog, "post_action_refresh_catalog_failed"));
  blockers.push(...REQUIRED_TOOLS.filter((tool) => !catalogTools.includes(tool)).map((tool) => `post_action_refresh_catalog_missing_tool:${tool}`));

  const threadMap = blockers.length === 0
    ? callGatewayJson(openclawBin, baseArgs, gatewayOptions, "tools.invoke", {
      name: "loo_codex_thread_map",
      args: { limit: 100 },
      sessionKey,
      confirm: false,
      idempotencyKey: `loo-post-action-thread-map-${options.threadId}-${idempotencyNonce}`
    }, callOptions)
    : null;
  blockers.push(...(threadMap ? gatewayCallBlockers(threadMap, "post_action_thread_map_failed") : []));

  const search = blockers.length === 0
    ? callGatewayJson(openclawBin, baseArgs, gatewayOptions, "tools.invoke", {
      name: "loo_search_sessions",
      args: { query, limit: 10 },
      sessionKey,
      confirm: false,
      idempotencyKey: `loo-post-action-search-${options.threadId}-${idempotencyNonce}`
    }, callOptions)
    : null;
  blockers.push(...(search ? gatewayCallBlockers(search, "post_action_search_failed") : []));

  const describe = blockers.length === 0
    ? callGatewayJson(openclawBin, baseArgs, gatewayOptions, "tools.invoke", {
      name: "loo_describe_session",
      args: { thread_id: options.threadId },
      sessionKey,
      confirm: false,
      idempotencyKey: `loo-post-action-describe-${options.threadId}-${idempotencyNonce}`
    }, callOptions)
    : null;
  blockers.push(...(describe ? gatewayCallBlockers(describe, "post_action_describe_failed") : []));

  const expand = blockers.length === 0
    ? callGatewayJson(openclawBin, baseArgs, gatewayOptions, "tools.invoke", {
      name: "loo_expand_query",
      args: { query, profile: expandProfile, token_budget: tokenBudget },
      sessionKey,
      confirm: false,
      idempotencyKey: `loo-post-action-expand-${options.threadId}-${idempotencyNonce}`
    }, callOptions)
    : null;
  blockers.push(...(expand ? gatewayCallBlockers(expand, "post_action_expand_failed") : []));

  const outputs = [threadMap, search, describe, expand]
    .flatMap((call) => call?.parsed === undefined ? [] : [unwrapToolOutput(unwrapGatewayPayload(call.parsed))]);
  const textPreview = outputs.map((output) => JSON.stringify(output)).join("\n");
  const containsRawPrivate = RAW_PRIVATE_PATTERN.test(textPreview);
  if (containsRawPrivate) blockers.push("post_action_refresh_raw_private_output");

  const threadMapOutput = threadMap?.parsed ? unwrapToolOutput(unwrapGatewayPayload(threadMap.parsed)) : undefined;
  const searchOutput = search?.parsed ? unwrapToolOutput(unwrapGatewayPayload(search.parsed)) : undefined;
  const describeOutput = describe?.parsed ? unwrapToolOutput(unwrapGatewayPayload(describe.parsed)) : undefined;
  const expandOutput = expand?.parsed ? unwrapToolOutput(unwrapGatewayPayload(expand.parsed)) : undefined;

  const topLevelTargetSearch = { descendIntoRecords: false };
  const targetThreadMapOutput = findTargetRecord(threadMapOutput, targetRef, topLevelTargetSearch);
  const targetSearchOutput = findTargetRecord(searchOutput, targetRef, topLevelTargetSearch);
  const targetDescribeOutput = findTargetRecord(describeOutput, targetRef, topLevelTargetSearch);
  const targetExpandOutput = findTargetRecord(expandOutput, targetRef, { descendIntoRecords: false });
  const sourceRefs = unique([targetThreadMapOutput, targetSearchOutput, targetDescribeOutput, targetExpandOutput]
    .flatMap((output) => output === undefined ? [] : collectSourceRefs(output)))
    .filter((ref) => ref.startsWith("codex_thread:"));

  const refreshedAt = targetThreadMapOutput ? firstString(targetThreadMapOutput, ["refreshedAt", "refreshed_at", "updatedAt", "updated_at"]) : null;
  const statusBucket = targetThreadMapOutput ? firstString(targetThreadMapOutput, ["statusBucket", "status_bucket", "status"]) ?? (refreshedAt ? "refreshed" : null) : null;
  const safeSummaryDelta = hasTargetSafeSummaryDelta(targetSearchOutput, targetDescribeOutput, query);
  const boundedExpansionProfile = targetExpandOutput ? firstString(targetExpandOutput, ["profile"]) || expandProfile : null;
  const refreshTimestampValid = refreshedAt ? parseTimestamp(refreshedAt) !== null : false;
  const refreshedAfterLiveAction = refreshedAt !== null
    && refreshTimestampValid
    && liveProof.actionObservedAt !== null
    && timestampAfter(refreshedAt, liveProof.actionObservedAt);
  if (blockers.length === 0) {
    if (!targetThreadMapOutput) blockers.push("post_action_refresh_thread_map_target_missing");
    if (!targetSearchOutput) blockers.push("post_action_refresh_search_target_missing");
    if (!targetDescribeOutput) blockers.push("post_action_refresh_describe_target_missing");
    if (!targetExpandOutput) blockers.push("post_action_refresh_expand_target_missing");
    if (!sourceRefs.includes(targetRef)) blockers.push("post_action_refresh_target_ref_missing");
    if (!refreshedAt) blockers.push("post_action_refresh_timestamp_missing");
    else if (!refreshTimestampValid) blockers.push("post_action_refresh_timestamp_invalid");
    else if (!refreshedAfterLiveAction) blockers.push("post_action_refresh_not_after_live_action");
    if (!statusBucket) blockers.push("post_action_refresh_status_bucket_missing");
    if (!safeSummaryDelta) blockers.push("post_action_refresh_safe_summary_delta_missing");
  }

  const uniqueBlockers = unique(blockers);
  const reportPath = join(options.evidenceDir, "post-action-refresh-reasoning-report.json");
  const runtimeProofPath = join(options.evidenceDir, `${SCENARIO_ID}.runtime-proof.json`);
  const proofReady = uniqueBlockers.length === 0;
  const report: OpenClawPostActionRefreshSmokeReport = {
    ok: proofReady,
    proofReady,
    publicSafe: !containsRawPrivate,
    generatedAt: options.now ?? new Date().toISOString(),
    command: `${sanitizeCommandBinary(openclawBin)} ${[...baseArgs, "gateway", "call", "tools.invoke", "--json", "--params", "<redacted>"].join(" ")}`,
    requiredTools: REQUIRED_TOOLS,
    targetRef,
    liveProof: {
      path: options.liveProofReportPath,
      accepted: liveProof.accepted,
      targetMatches: liveProof.targetRef === targetRef,
      actionObservedAt: liveProof.actionObservedAt
    },
    refresh: {
      postActionRefresh: proofReady,
      refreshedAt: proofReady ? refreshedAt : null,
      refreshedAfterLiveAction: proofReady && refreshedAfterLiveAction,
      statusBucket: proofReady ? statusBucket : null,
      safeSummaryDelta: proofReady && safeSummaryDelta,
      boundedExpansionProfile: proofReady ? boundedExpansionProfile : null
    },
    reasoning: {
      agentReasoningNote: proofReady
        ? "safe summaries and source refs show the selected Codex thread refreshed after the approved gateway action; continue with #172 release sweep only after #159 evidence is paired with the #158 marker."
        : "Post-action refresh proof is blocked; resolve blockers before reasoning from this evidence.",
      sourceRefs: proofReady ? [targetRef] : [],
      omittedMarkers: PRIVATE_DATA_EXCLUSIONS
    },
    runtimeProofPath,
    reportPath,
    blockers: uniqueBlockers,
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      npmPublished: false,
      githubReleaseCreated: false,
      rawTranscriptRead: false
    },
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS,
    proofBoundary: "This proves one public-tool post-action refresh and safe reasoning loop for a named Codex thread only; it does not prove continuous sync, cloud sync, raw transcript ingestion, or unattended orchestration.",
    nextAction: proofReady
      ? "Run the v1.1 scenario sweep with the #158 and #159 runtime proof markers, then continue the #172 proof packet."
      : "Resolve the listed post-action refresh blockers before claiming #159 runtime proof."
  };
  writeJson(reportPath, report);
  writeJson(runtimeProofPath, runtimeProofForReport(report));
  return report;
}

function readLiveProof(path: string, targetRef: string): LiveProofSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return { accepted: false, targetRef: null, actionObservedAt: null, blockers: ["post_action_refresh_proof_missing"] };
  }
  const record = isRecord(parsed) ? parsed : {};
  const proofTarget = stringPath(record, ["targetRef"]) || stringPath(record, ["target_ref"]);
  const actionObservedAt = firstString(record, ["actionObservedAt", "action_observed_at"]) || stringPath(record, ["generatedAt"]) || stringPath(record, ["generated_at"]);
  const actionObservedAtTimestamp = actionObservedAt ? parseTimestamp(actionObservedAt) : null;
  const actionRecord = isRecord(record.actionsPerformed) ? record.actionsPerformed : {};
  const authorization = isRecord(record.authorization) ? record.authorization : {};
  const blockers = [
    ...(record.ok === true && record.proofReady === true && record.publicSafe === true ? [] : ["post_action_live_proof_not_ready"]),
    ...(proofTarget === targetRef ? [] : ["post_action_live_proof_target_mismatch"]),
    ...(authorization.approvalAuditIdMatchesDryRun === true ? [] : ["post_action_live_proof_approval_mismatch"]),
    ...(actionRecord.liveCodexControlRun === true ? [] : ["post_action_live_proof_action_missing"]),
    ...(actionRecord.rawTranscriptRead === false ? [] : ["post_action_live_proof_raw_transcript"]),
    ...(actionObservedAt ? [] : ["post_action_live_proof_timestamp_missing"]),
    ...(actionObservedAt && actionObservedAtTimestamp === null ? ["post_action_live_proof_timestamp_invalid"] : [])
  ];
  return { accepted: blockers.length === 0, targetRef: proofTarget, actionObservedAt: actionObservedAtTimestamp ? actionObservedAt : null, blockers };
}

function runtimeProofForReport(report: OpenClawPostActionRefreshSmokeReport): Record<string, unknown> {
  return {
    kind: "loo_runtime_scenario_proof",
    scenario_id: SCENARIO_ID,
    scenario_version: "1.1",
    proof_mode: "runtime_required",
    claim_scope: "codex-working-app-proof",
    public_safe: report.publicSafe && report.blockers.length === 0,
    proof_markers: {
      post_action_refresh: report.blockers.length === 0 && report.refresh.postActionRefresh,
      refreshed_after_live_action: report.blockers.length === 0 && report.refresh.refreshedAfterLiveAction,
      agent_reasoning_note: report.blockers.length === 0 && report.reasoning.agentReasoningNote.length > 0,
      source_refs: report.blockers.length === 0 && report.reasoning.sourceRefs.includes(report.targetRef)
    },
    raw_transcript_read: false,
    raw_prompt_included: false,
    raw_secret_included: false,
    screenshot_included: false,
    sqlite_included: false,
    raw_transcript_spans: 0
  };
}

function callGatewayJson(
  openclawBin: string,
  baseArgs: string[],
  gatewayOptions: string[],
  method: string,
  params: unknown,
  options: { env?: Record<string, string>; timeoutMs?: number } = {}
): GatewayCallResult {
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
    timeout: gatewayProcessTimeoutMs(options.timeoutMs ?? 120_000)
  });
  const result: GatewayCallResult = {
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

function gatewayCallBlockers(call: GatewayCallResult, fallback: string): string[] {
  if (call.status !== 0) return [fallback];
  if (call.parsed === undefined) return [`${fallback}:invalid_json`];
  const payload = unwrapGatewayPayload(call.parsed);
  if (isRecord(payload) && payload.ok === false) return [`${fallback}:tool_not_ok`];
  return [];
}

function gatewayProcessTimeoutMs(timeoutMs: number): number {
  const graceMs = Math.min(5_000, Math.max(250, Math.ceil(timeoutMs * 0.2)));
  return timeoutMs + graceMs;
}

function sanitizeCommandBinary(openclawBin: string): string {
  return openclawBin.includes("/") ? basename(openclawBin) : openclawBin;
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
  return unique(tools.flatMap((tool) => {
    if (typeof tool === "string") return [tool];
    if (!isRecord(tool)) return [];
    if (typeof tool.name === "string") return [tool.name];
    if (typeof tool.id === "string") return [tool.id];
    if (Array.isArray(tool.names)) return tool.names.filter((name): name is string => typeof name === "string");
    return [];
  }));
}

function collectSourceRefs(value: unknown): string[] {
  if (typeof value === "string") return value.startsWith("codex_thread:") ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectSourceRefs(item));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, nested]) => {
    if ((key === "sourceRef" || key === "source_ref") && typeof nested === "string") return [nested];
    if ((key === "sourceRefs" || key === "source_refs") && Array.isArray(nested)) return nested.filter((item): item is string => typeof item === "string");
    if ((key === "threadId" || key === "thread_id") && typeof nested === "string") return [codexThreadRef(nested)];
    return collectSourceRefs(nested);
  });
}

function findTargetRecord(value: unknown, targetRef: string, options: { descendIntoRecords?: boolean } = {}): unknown | undefined {
  const descendIntoRecords = options.descendIntoRecords ?? true;
  if (Array.isArray(value)) {
    // The option gates object-field recursion only; arrays still expose each record's direct refs.
    for (const item of value) {
      const found = findTargetRecord(item, targetRef, options);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (directSourceRefs(value).includes(targetRef)) return value;
  if (!descendIntoRecords) return findTargetRecordInTopLevelCollections(value, targetRef, options);
  for (const nested of Object.values(value)) {
    const found = findTargetRecord(nested, targetRef, options);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findTargetRecordInTopLevelCollections(value: Record<string, unknown>, targetRef: string, options: { descendIntoRecords?: boolean }): unknown | undefined {
  for (const key of ["threads", "results", "items", "cards", "sessions"]) {
    const collection = value[key];
    if (!Array.isArray(collection)) continue;
    const found = findTargetRecord(collection, targetRef, options);
    if (found !== undefined) return found;
  }
  return undefined;
}

function directSourceRefs(value: Record<string, unknown>): string[] {
  return Object.entries(value).flatMap(([key, nested]) => {
    if ((key === "sourceRef" || key === "source_ref" || key === "targetRef" || key === "target_ref" || key === "ref")
      && typeof nested === "string"
      && nested.startsWith("codex_thread:")) {
      return [nested];
    }
    if ((key === "threadId" || key === "thread_id") && typeof nested === "string" && nested.trim()) {
      return [codexThreadRef(nested)];
    }
    if ((key === "sourceRefs" || key === "source_refs") && Array.isArray(nested)) {
      return nested.filter((item): item is string => typeof item === "string" && item.startsWith("codex_thread:"));
    }
    return [];
  });
}

function codexThreadRef(threadId: string): string {
  const trimmed = threadId.trim();
  return trimmed.startsWith("codex_thread:") ? trimmed : `codex_thread:${trimmed}`;
}

function hasTargetSafeSummaryDelta(searchOutput: unknown, describeOutput: unknown, query: string): boolean {
  const text = [
    ...findStrings(searchOutput, ["safeSummary", "safe_summary", "summary", "text", "finalAssistantMessage", "final_assistant_message"]),
    ...findStrings(describeOutput, ["safeSummary", "safe_summary", "summary", "text", "finalAssistantMessage", "final_assistant_message"])
  ].join("\n");
  if (!text) return false;
  if (POST_ACTION_DELTA_PATTERN.test(text)) return true;
  const queryTerms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 5);
  if (queryTerms.length === 0) return false;
  const normalized = text.toLowerCase();
  return queryTerms.some((term) => normalized.includes(term));
}

function sanitizeId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "run";
}

function timestampAfter(later: string, earlier: string): boolean {
  const laterMs = parseTimestamp(later);
  const earlierMs = parseTimestamp(earlier);
  return laterMs !== null && earlierMs !== null && laterMs > earlierMs;
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstString(value: unknown, keys: string[]): string | null {
  const found = findStrings(value, keys)[0];
  return found ?? null;
}

function findStrings(value: unknown, keys: string[]): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => findStrings(item, keys));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, nested]) => {
    const direct = keys.includes(key) && typeof nested === "string" && nested ? [nested] : [];
    return [...direct, ...findStrings(nested, keys)];
  });
}

function stringPath(value: unknown, path: string[]): string | null {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === "string" && current ? current : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
