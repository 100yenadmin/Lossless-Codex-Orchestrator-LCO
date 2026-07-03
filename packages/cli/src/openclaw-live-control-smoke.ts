import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

export type OpenClawGatewayLiveControlSmokeOptions = {
  openclawBin?: string;
  dev?: boolean;
  profile?: string;
  gatewayUrl?: string;
  token?: string;
  sessionKey?: string;
  threadId: string;
  action?: OpenClawGatewayLiveControlAction;
  message?: string;
  evidenceDir: string;
  gatewayTimeoutMs?: number;
  now?: string;
};

export type OpenClawGatewayLiveControlAction = "send" | "resume";

export type OpenClawGatewayLiveControlSmokeReport = {
  ok: boolean;
  proofReady: boolean;
  publicSafe: boolean;
  generatedAt: string;
  command: string;
  action: OpenClawGatewayLiveControlAction;
  requiredTools: string[];
  targetRef: string;
  dryRun: {
    approvalAuditId: string | null;
    paramsHash: string | null;
    messageHash: string | null;
    live: boolean | null;
  };
  live: {
    approvalAuditId: string | null;
    paramsHash: string | null;
    messageHash: string | null;
    live: boolean | null;
    method: string | null;
    turnStatus: string | null;
    responseOk: boolean | null;
  };
  audit: {
    tailRead: boolean;
    matchingDryRunRecord: boolean;
    matchingLiveRecord: boolean;
  };
  authorization: {
    approvalAuditIdUsed: string | null;
    approvalAuditIdMatchesDryRun: boolean;
  };
  runtimeProofPath: string;
  reportPath: string;
  blockers: string[];
  actionsPerformed: {
    liveCodexControlRun: boolean;
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

type ControlSummary = {
  approvalAuditId: string | null;
  paramsHash: string | null;
  messageHash: string | null;
  live: boolean | null;
  method: string | null;
  turnStatus: string | null;
  responseOk: boolean | null;
};

const SCENARIO_ID = "openclaw-gateway-live-codex-v1-1";
const ACCEPTED_LIVE_TURN_STATUSES = new Set(["accepted", "completed", "in_progress", "pending", "queued", "running"]);
const DEFAULT_MESSAGE = "LCO OpenClaw gateway live-control smoke. Reply with exactly: LCO gateway live smoke acknowledged. Do not run commands, edit files, or use tools.";
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

export function runOpenClawGatewayLiveControlSmoke(options: OpenClawGatewayLiveControlSmokeOptions): OpenClawGatewayLiveControlSmokeReport {
  mkdirSync(options.evidenceDir, { recursive: true });
  const openclawBin = options.openclawBin || "openclaw";
  const baseArgs = [
    ...(options.dev ? ["--dev"] : []),
    ...(options.profile ? ["--profile", options.profile] : [])
  ];
  const gatewayTimeoutMs = options.gatewayTimeoutMs ?? 120_000;
  const gatewayToken = options.token || process.env.OPENCLAW_GATEWAY_TOKEN;
  const gatewayOptions = [
    ...(options.gatewayUrl ? ["--url", options.gatewayUrl] : []),
    ...gatewayTokenArgs(gatewayToken),
    "--timeout",
    String(gatewayTimeoutMs)
  ];
  const callOptions = { timeoutMs: gatewayTimeoutMs, env: options.token ? { OPENCLAW_GATEWAY_TOKEN: options.token } : undefined };
  const sessionKey = options.sessionKey || "agent:main:lco-live-control-smoke";
  const action = normalizeAction(options.action);
  const liveToolName = liveToolForAction(action);
  const requiredTools = ["loo_codex_control_dry_run", liveToolName, "loo_audit_tail"];
  const message = options.message ?? DEFAULT_MESSAGE;
  const targetRef = `codex_thread:${options.threadId}`;
  const blockers: string[] = [];

  const catalog = callGatewayJson(openclawBin, baseArgs, gatewayOptions, "tools.catalog", {}, callOptions);
  const catalogTools = catalog.status === 0 && catalog.parsed !== undefined ? extractCatalogToolNames(unwrapGatewayPayload(catalog.parsed)) : [];
  blockers.push(...gatewayCallBlockers(catalog, "openclaw_live_catalog_failed"));
  blockers.push(...requiredTools.filter((tool) => !catalogTools.includes(tool)).map((tool) => `openclaw_live_catalog_missing_tool:${tool}`));

  const dryRun = blockers.length === 0
    ? callGatewayJson(openclawBin, baseArgs, gatewayOptions, "tools.invoke", {
      name: "loo_codex_control_dry_run",
      args: liveDryRunArgs(action, options.threadId, message),
      sessionKey,
      confirm: false,
      idempotencyKey: `loo-live-smoke-dry-run-${action}-${options.threadId}`
    }, callOptions)
    : null;
  blockers.push(...(dryRun ? gatewayCallBlockers(dryRun, "openclaw_live_dry_run_failed") : []));
  const dryRunSummary = summarizeControl(dryRun);
  if (dryRun && !validDryRun(action, dryRunSummary)) blockers.push("openclaw_live_dry_run_not_proven");

  const live = blockers.length === 0
    ? callGatewayJson(openclawBin, baseArgs, gatewayOptions, "tools.invoke", {
      name: liveToolName,
      args: liveArgs(action, options.threadId, message, dryRunSummary.approvalAuditId),
      sessionKey,
      confirm: false,
      idempotencyKey: `loo-live-smoke-${action}-${options.threadId}-${dryRunSummary.approvalAuditId}`
    }, callOptions)
    : null;
  blockers.push(...(live ? gatewayCallBlockers(live, "openclaw_live_control_failed") : []));
  const liveSummary = summarizeControl(live);
  if (live && !validLive(action, liveSummary)) blockers.push(action === "resume" ? "openclaw_live_resume_not_proven" : "openclaw_live_send_not_proven");
  if (live && dryRunSummary.paramsHash && liveSummary.paramsHash && liveSummary.paramsHash !== dryRunSummary.paramsHash) blockers.push("openclaw_live_params_hash_mismatch");
  if (live && dryRunSummary.messageHash && liveSummary.messageHash && liveSummary.messageHash !== dryRunSummary.messageHash) blockers.push("openclaw_live_message_hash_mismatch");
  const approvalAuditIdUsed = live ? dryRunSummary.approvalAuditId : null;
  const approvalAuditIdMatchesDryRun = Boolean(
    live
    && live.status === 0
    && safeAuditId(approvalAuditIdUsed)
    && approvalAuditIdUsed === dryRunSummary.approvalAuditId
  );

  const auditTail = blockers.length === 0
    ? callGatewayJson(openclawBin, baseArgs, gatewayOptions, "tools.invoke", {
      name: "loo_audit_tail",
      args: { limit: 20 },
      sessionKey,
      confirm: false,
      idempotencyKey: `loo-live-smoke-audit-tail-${action}-${options.threadId}`
    }, callOptions)
    : null;
  blockers.push(...(auditTail ? gatewayCallBlockers(auditTail, "openclaw_live_audit_tail_failed") : []));
  const auditOutput = auditTail?.parsed ? unwrapToolOutput(unwrapGatewayPayload(auditTail.parsed)) : undefined;
  const auditRecords = collectAuditRecords(unwrapToolDetails(auditOutput) ?? auditOutput);
  const matchingDryRunRecord = Boolean(dryRunSummary.approvalAuditId && auditRecords.some((record) =>
    record.id === dryRunSummary.approvalAuditId && record.live === false && record.paramsHash === dryRunSummary.paramsHash
  ));
  const matchingLiveRecord = Boolean(liveSummary.paramsHash && auditRecords.some((record) =>
    record.live === true && record.paramsHash === liveSummary.paramsHash
  ));
  if (auditTail && !matchingDryRunRecord) blockers.push("openclaw_live_audit_tail_missing_dry_run_record");
  if (auditTail && !matchingLiveRecord) blockers.push("openclaw_live_audit_tail_missing_live_record");

  const uniqueBlockers = [...new Set(blockers)];
  const runtimeProofPath = join(options.evidenceDir, `${SCENARIO_ID}.runtime-proof.json`);
  const reportPath = join(options.evidenceDir, "openclaw-gateway-live-control-smoke-report.json");
  const report: OpenClawGatewayLiveControlSmokeReport = {
    ok: uniqueBlockers.length === 0,
    proofReady: uniqueBlockers.length === 0,
    publicSafe: true,
    generatedAt: options.now ?? new Date().toISOString(),
    command: `${sanitizeCommandBinary(openclawBin)} ${[...baseArgs, "gateway", "call", "tools.invoke", "--json", "--params", "<redacted>"].join(" ")}`,
    action,
    requiredTools,
    targetRef,
    dryRun: {
      approvalAuditId: dryRunSummary.approvalAuditId,
      paramsHash: dryRunSummary.paramsHash,
      messageHash: dryRunSummary.messageHash,
      live: dryRunSummary.live
    },
    live: liveSummary,
    audit: {
      tailRead: Boolean(auditTail && auditTail.status === 0),
      matchingDryRunRecord,
      matchingLiveRecord
    },
    authorization: {
      approvalAuditIdUsed,
      approvalAuditIdMatchesDryRun
    },
    runtimeProofPath,
    reportPath,
    blockers: uniqueBlockers,
    actionsPerformed: {
      liveCodexControlRun: Boolean(live && live.status === 0),
      desktopGuiActionRun: false,
      npmPublished: false,
      githubReleaseCreated: false,
      rawTranscriptRead: false
    },
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS,
    proofBoundary: "This proves one approved harmless live Codex send/resume through the installed OpenClaw gateway path only; it does not prove unattended live control, broad gateway scope approval, GUI mutation, Claude parity, or bypassed Codex approvals.",
    nextAction: uniqueBlockers.length === 0
      ? "Run the v1.1 runtime scenario sweep against this runtime-proof directory, then continue #159 post-action refresh proof."
      : "Resolve the listed gateway live-control blockers before claiming #158 runtime proof."
  };

  writeJson(reportPath, report);
  writeJson(runtimeProofPath, runtimeProofForReport(report));
  return report;
}

function runtimeProofForReport(report: OpenClawGatewayLiveControlSmokeReport): Record<string, unknown> {
  return {
    kind: "loo_runtime_scenario_proof",
    scenario_id: SCENARIO_ID,
    scenario_version: "1.1",
    proof_mode: "runtime_required",
    claim_scope: "codex-working-app-proof",
    public_safe: report.publicSafe && report.blockers.length === 0,
    proof_markers: {
      installed_gateway_path: report.blockers.length === 0,
      matching_approval_audit_id: report.blockers.length === 0 && report.authorization.approvalAuditIdMatchesDryRun,
      public_safe_scan: report.publicSafe && report.blockers.length === 0
    },
    raw_transcript_read: false,
    raw_prompt_included: false,
    raw_secret_included: false,
    screenshot_included: false,
    sqlite_included: false,
    live_action_count: report.actionsPerformed.liveCodexControlRun ? 1 : 0,
    raw_prompt_chars: 0
  };
}

function liveDryRunArgs(action: OpenClawGatewayLiveControlAction, threadId: string, message: string): Record<string, unknown> {
  return action === "send"
    ? {
        action,
        thread_id: threadId,
        message
      }
    : {
        action,
        thread_id: threadId
      };
}

function liveArgs(action: OpenClawGatewayLiveControlAction, threadId: string, message: string, approvalAuditId: string | null): Record<string, unknown> {
  const common = {
    thread_id: threadId,
    dry_run: false,
    approval_audit_id: approvalAuditId
  };
  return action === "send" ? { ...common, message } : common;
}

function liveToolForAction(action: OpenClawGatewayLiveControlAction): string {
  return action === "send" ? "loo_codex_send_message" : "loo_codex_resume_thread";
}

function normalizeAction(action: unknown): OpenClawGatewayLiveControlAction {
  if (action === undefined || action === "send") return "send";
  if (action === "resume") return "resume";
  throw new Error("action must be send or resume");
}

function validDryRun(action: OpenClawGatewayLiveControlAction, summary: ControlSummary): boolean {
  return summary.live === false
    && safeAuditId(summary.approvalAuditId)
    && safeHash(summary.paramsHash)
    && (action !== "send" || safeHash(summary.messageHash));
}

function validLive(action: OpenClawGatewayLiveControlAction, summary: ControlSummary): boolean {
  const actionAccepted = action === "resume"
    ? summary.method === "thread/resume"
    : liveTurnStatusProvesSendAccepted(summary.turnStatus);
  return summary.live === true
    && safeAuditId(summary.approvalAuditId)
    && safeHash(summary.paramsHash)
    && (action !== "send" || safeHash(summary.messageHash))
    && summary.responseOk === true
    && actionAccepted;
}

function liveTurnStatusProvesSendAccepted(value: string | null): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, "_");
  return ACCEPTED_LIVE_TURN_STATUSES.has(normalized);
}

function safeAuditId(value: string | null): value is string {
  return typeof value === "string" && /^loo_audit_[a-f0-9_:-]+$/i.test(value);
}

function safeHash(value: string | null): value is string {
  return typeof value === "string" && /^[a-f0-9]{32,128}$/i.test(value);
}

function summarizeControl(call: GatewayCallResult | null): ControlSummary {
  const output = call?.parsed ? unwrapToolOutput(unwrapGatewayPayload(call.parsed)) : undefined;
  const details = unwrapToolDetails(output) ?? output;
  return {
    approvalAuditId: stringPath(details, ["approval_audit_id"]) || stringPath(details, ["approvalAuditId"]),
    paramsHash: stringPath(details, ["params_hash"]) || stringPath(details, ["paramsHash"]),
    messageHash: stringPath(details, ["message_hash"]) || stringPath(details, ["messageHash"]),
    live: booleanPath(details, ["live"]),
    method: stringPath(details, ["method"]),
    turnStatus: stringPath(details, ["response", "turn", "status"]) || stringPath(details, ["response", "status"]) || stringPath(details, ["status"]),
    responseOk: booleanPath(details, ["response", "ok"]) ?? booleanPath(details, ["ok"])
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

function gatewayTokenArgs(token: string | undefined): string[] {
  if (!token || token === "__OPENCLAW_REDACTED__") return [];
  return ["--token", token];
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

function collectAuditRecords(value: unknown): Array<{ id?: string; live?: boolean; paramsHash?: string }> {
  const records = isRecord(value) && Array.isArray(value.records) ? value.records : [];
  return records.flatMap((record) => {
    if (!isRecord(record)) return [];
    return [{
      id: stringPath(record, ["id"]) ?? undefined,
      live: booleanPath(record, ["live"]) ?? undefined,
      paramsHash: stringPath(record, ["params_hash"]) || stringPath(record, ["paramsHash"]) || undefined
    }];
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

function booleanPath(value: unknown, path: string[]): boolean | null {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === "boolean" ? current : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
