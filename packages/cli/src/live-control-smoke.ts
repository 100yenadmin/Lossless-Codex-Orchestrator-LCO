import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CodexJsonRpcClient,
  createCodexControl,
  LineProcessTransport,
  type AuditStore,
  type CodexJsonRpcResponse,
  type JsonRpcNotification
} from "../../adapters/src/index.js";

export type LiveControlSmokeWaitResult = {
  completed: boolean;
  status: string | null;
  notificationMethods: string[];
  approvalRequestCount: number;
  serverRequestCount: number;
};

export type LiveControlSmokeClient = {
  connect(): Promise<void>;
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  waitForTurnCompletion(input: { threadId: string; turnId: string; timeoutMs: number }): Promise<LiveControlSmokeWaitResult>;
  close(): Promise<void>;
};

export type LiveControlSmokeProof = {
  kind: "loo_approved_live_control_smoke";
  approvedLiveControlSmoke: true;
  action: "send";
  targetRef: string;
  approvalAuditId: string;
  messageHash: string;
  preservesCodexApprovalSemantics: true;
  rawPromptIncluded: false;
};

export type LiveControlSmokeReport = {
  ok: boolean;
  generatedAt: string;
  proofPath: string;
  reportPath: string;
  target: {
    source: "ephemeral_thread_start" | "provided_thread";
    ref: string;
  };
  dryRun: {
    approvalAuditId: string;
    paramsHash: string;
    messageHash: string;
    live: false;
  };
  live: {
    approvalAuditId: string;
    method: string | undefined;
    completed: boolean;
    status: string | null;
    notificationMethods: string[];
    approvalRequestCount: number;
    serverRequestCount: number;
  };
  proof: LiveControlSmokeProof;
  rawPromptIncluded: false;
};

export type LiveControlSmokeFailureReport = {
  kind: "loo_live_control_smoke_failure";
  ok: false;
  proofReady: false;
  generatedAt: string;
  blocker: string;
  command: {
    action: "send";
    actionClass: "codex_live_control_send";
  };
  target: {
    source: "ephemeral_thread_start" | "provided_thread" | "unknown";
    refClass: "codex_thread" | "unknown";
    ref: string | null;
  };
  dryRun: {
    attempted: boolean;
    approvalAuditId: string | null;
    paramsHash: string | null;
    messageHash: string | null;
    live: false | null;
  };
  transport: {
    class: "codex_app_server";
    connection: "single_connection_sequence";
  };
  live: {
    accepted: boolean;
    approvalAuditId: string | null;
    method: string | null;
    completed: boolean;
    status: string | null;
    notificationMethods: string[];
    approvalRequestCount: number;
    serverRequestCount: number;
  };
  postActionRefresh: {
    ran: false;
  };
  nextDiagnosticStep: string;
  rawPromptIncluded: false;
  rawTranscriptIncluded: false;
  rawSecretIncluded: false;
  screenshotIncluded: false;
  sqliteIncluded: false;
};

export type LiveControlSmokeOptions = {
  client: LiveControlSmokeClient;
  audit: AuditStore;
  evidenceDir: string;
  message?: string;
  threadId?: string;
  cwd?: string;
  timeoutMs?: number;
  now?: string;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MESSAGE = "LCO approved live-control smoke. Reply with exactly: LCO live smoke acknowledged. Do not run commands, edit files, or use tools.";

export class AppServerLiveControlSmokeClient implements LiveControlSmokeClient {
  private client: CodexJsonRpcClient | null = null;

  constructor(private readonly options: { command?: string; args?: string[]; timeoutMs?: number } = {}) {}

  async connect(): Promise<void> {
    const client = new CodexJsonRpcClient(
      () => new LineProcessTransport(
        this.options.command ?? "codex",
        this.options.args ?? defaultAppServerArgs(),
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      ),
      { timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS, surface: "smoke_setup" }
    );
    await client.connect();
    this.client = client;
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.requireClient().request(method, params);
  }

  async waitForTurnCompletion(input: { threadId: string; turnId: string; timeoutMs: number }): Promise<LiveControlSmokeWaitResult> {
    let status: string | null = null;
    const wait = await this.requireClient().readNotificationsUntil((notification) => {
      if (notification.method !== "turn/completed") return false;
      const turn = objectField(notification.params.turn);
      const turnId = stringField(turn, "id");
      if (turnId !== input.turnId) return false;
      status = stringField(turn, "status");
      return true;
    }, { timeoutMs: input.timeoutMs, stopOnServerRequest: true });
    return {
      completed: wait.matched,
      status,
      notificationMethods: wait.notifications.map((notification) => notification.method),
      approvalRequestCount: wait.serverRequests.filter((request) => isApprovalRequest(request.method)).length,
      serverRequestCount: wait.serverRequests.length
    };
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }

  private requireClient(): CodexJsonRpcClient {
    if (!this.client) throw new Error("Codex smoke client is not connected");
    return this.client;
  }
}

export async function runLiveControlSmoke(options: LiveControlSmokeOptions): Promise<LiveControlSmokeReport> {
  mkdirSync(options.evidenceDir, { recursive: true });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const message = options.message ?? DEFAULT_MESSAGE;
  let targetState: { threadId: string | null; source: "ephemeral_thread_start" | "provided_thread" | "unknown" } = {
    threadId: options.threadId ?? null,
    source: options.threadId ? "provided_thread" : "unknown"
  };
  let dryRunState: { approvalAuditId: string; paramsHash: string; messageHash?: string; live: false } | null = null;
  let liveState: {
    accepted: boolean;
    approvalAuditId: string | null;
    method: string | null;
    completed: boolean;
    status: string | null;
    notificationMethods: string[];
    approvalRequestCount: number;
    serverRequestCount: number;
  } = {
    accepted: false,
    approvalAuditId: null,
    method: null,
    completed: false,
    status: null,
    notificationMethods: [],
    approvalRequestCount: 0,
    serverRequestCount: 0
  };
  let failed = false;
  try {
    await options.client.connect();
    const target = options.threadId
      ? { threadId: options.threadId, source: "provided_thread" as const }
      : { threadId: await startEphemeralThread(options.client, options.cwd), source: "ephemeral_thread_start" as const };
    targetState = target;
    const control = createCodexControl({
      audit: options.audit,
      client: {
        request: (method, params) => options.client.request(method, params),
        requestSequenceUntilTurnResolved: async (steps, turnOptions) => {
          const responses = [];
          let turnId = turnOptions.expectedTurnId;
          for (const step of steps) {
            const response = await options.client.request(step.method, step.params);
            responses.push(response);
            if (isFailedCodexResponse(response)) {
              throw new Error(`Codex control sequence step failed: ${step.method}`);
            }
            turnId ??= extractTurnId(response) ?? undefined;
          }
          if (!turnId) {
            return {
              responses,
              turn: {
                status: "turn_id_missing",
                completed: false,
                notificationMethods: [],
                approvalRequestCount: 0,
                serverRequestCount: 0
              }
            };
          }
          const completion = await options.client.waitForTurnCompletion({
            threadId: turnOptions.threadId,
            turnId,
            timeoutMs: turnOptions.turnWaitMs
          });
          return {
            responses,
            turn: {
              id: turnId,
              status: statusFromCompletion(completion),
              completed: completion.completed && completion.status === "completed",
              notificationMethods: completion.notificationMethods,
              approvalRequestCount: completion.approvalRequestCount,
              serverRequestCount: completion.serverRequestCount
            }
          };
        }
      }
    });
    const dryRun = await control.sendMessage({ threadId: target.threadId, message, dryRun: true });
    dryRunState = {
      approvalAuditId: dryRun.approvalAuditId,
      paramsHash: dryRun.paramsHash,
      messageHash: dryRun.messageHash,
      live: false
    };
    if (!dryRun.messageHash) throw new Error("dry-run did not produce a message hash");
    const live = await control.sendMessage({
      threadId: target.threadId,
      message,
      dryRun: false,
      approvalAuditId: dryRun.approvalAuditId
    });
    liveState = {
      ...liveState,
      accepted: true,
      approvalAuditId: live.approvalAuditId,
      method: live.method ?? null
    };
    const turnId = live.turn?.id ?? extractTurnId(live.response);
    if (!turnId) throw new Error("live Codex control response did not include a turn id");
    const completion = live.turn
      ? {
          completed: live.turn.completed,
          status: live.turn.status,
          notificationMethods: live.turn.notificationMethods,
          approvalRequestCount: live.turn.approvalRequestCount,
          serverRequestCount: live.turn.serverRequestCount
        }
      : await options.client.waitForTurnCompletion({ threadId: target.threadId, turnId, timeoutMs });
    liveState = {
      ...liveState,
      completed: completion.completed,
      status: completion.status,
      notificationMethods: summarizeMethods(completion.notificationMethods),
      approvalRequestCount: completion.approvalRequestCount,
      serverRequestCount: completion.serverRequestCount
    };
    if (completion.approvalRequestCount > 0) {
      throw new Error("live Codex control smoke observed a Codex approval request; harmless smoke must not require approvals");
    }
    if (completion.serverRequestCount > 0) {
      throw new Error("live Codex control smoke observed a server request; harmless smoke must not require client-side decisions");
    }
    if (!completion.completed || completion.status !== "completed") {
      throw new Error(`live Codex control smoke did not complete cleanly: ${completion.status ?? "timeout"}`);
    }

    const proof: LiveControlSmokeProof = {
      kind: "loo_approved_live_control_smoke",
      approvedLiveControlSmoke: true,
      action: "send",
      targetRef: `codex_thread:${target.threadId}`,
      approvalAuditId: dryRun.approvalAuditId,
      messageHash: dryRun.messageHash,
      preservesCodexApprovalSemantics: true,
      rawPromptIncluded: false
    };
    const proofPath = join(options.evidenceDir, "approved-live-control-smoke.json");
    const reportPath = join(options.evidenceDir, "live-control-smoke-report.json");
    const report: LiveControlSmokeReport = {
      ok: true,
      generatedAt: options.now ?? new Date().toISOString(),
      proofPath,
      reportPath,
      target: {
        source: target.source,
        ref: proof.targetRef
      },
      dryRun: {
        approvalAuditId: dryRun.approvalAuditId,
        paramsHash: dryRun.paramsHash,
        messageHash: dryRun.messageHash,
        live: false
      },
      live: {
        approvalAuditId: live.approvalAuditId,
        method: live.method,
        completed: completion.completed,
        status: completion.status,
        notificationMethods: summarizeMethods(completion.notificationMethods),
        approvalRequestCount: completion.approvalRequestCount,
        serverRequestCount: completion.serverRequestCount
      },
      proof,
      rawPromptIncluded: false
    };
    writeJson(proofPath, proof);
    writeJson(reportPath, report);
    return report;
  } catch (error) {
    failed = true;
    try {
      writeFailureReport(options, {
        error,
        target: targetState,
        dryRun: dryRunState,
        live: liveState
      });
    } catch {
      // Best-effort evidence: never let report-writing failures mask the original smoke failure.
    }
    throw error;
  } finally {
    try {
      await options.client.close();
    } catch (closeError) {
      if (!failed) throw closeError;
    }
  }
}

export function defaultAppServerArgs(): string[] {
  const configured = process.env.LOO_CODEX_APP_SERVER_ARGS?.trim();
  if (configured) return configured.split(/\s+/).filter(Boolean);
  return ["app-server", "--stdio"];
}

async function startEphemeralThread(client: LiveControlSmokeClient, cwd: string | undefined): Promise<string> {
  const response = await client.request("thread/start", {
    ephemeral: true,
    ...(cwd ? { cwd } : {}),
    approvalPolicy: "on-request",
    sandbox: "read-only"
  });
  const result = unwrapResult(response);
  const thread = objectField(result.thread);
  const threadId = stringField(thread, "id");
  if (!threadId) throw new Error("thread/start did not return a thread id");
  return threadId;
}

function extractTurnId(response: unknown): string | null {
  const result = unwrapResult(response);
  const turn = objectField(result.turn);
  return stringField(turn, "id");
}

function isFailedCodexResponse(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).ok === false);
}

function statusFromCompletion(completion: LiveControlSmokeWaitResult): string {
  if (completion.serverRequestCount > 0) return "turn_server_request_unconfirmed";
  if (completion.completed) return completion.status ?? "completed";
  return "turn_started_unconfirmed";
}

function unwrapResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  if ("ok" in record) {
    const response = record as CodexJsonRpcResponse;
    if (!response.ok) throw new Error(response.error ?? "Codex JSON-RPC request failed");
    return objectField(response.result);
  }
  return record;
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" && record[key] ? record[key] : null;
}

function isApprovalRequest(method: string): boolean {
  return method === "applyPatchApproval" || method === "execCommandApproval" || /Approval$/.test(method);
}

function summarizeMethods(methods: string[]): string[] {
  return [...new Set(methods)].sort();
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFailureReport(
  options: LiveControlSmokeOptions,
  state: {
    error: unknown;
    target: { threadId: string | null; source: "ephemeral_thread_start" | "provided_thread" | "unknown" };
    dryRun: { approvalAuditId: string; paramsHash: string; messageHash?: string; live: false } | null;
    live: {
      accepted: boolean;
      approvalAuditId: string | null;
      method: string | null;
      completed: boolean;
      status: string | null;
      notificationMethods: string[];
      approvalRequestCount: number;
      serverRequestCount: number;
    };
  }
): void {
  const blocker = classifyFailureBlocker(state.error);
  const report: LiveControlSmokeFailureReport = {
    kind: "loo_live_control_smoke_failure",
    ok: false,
    proofReady: false,
    generatedAt: options.now ?? new Date().toISOString(),
    blocker,
    command: {
      action: "send",
      actionClass: "codex_live_control_send"
    },
    target: {
      source: state.target.source,
      refClass: state.target.threadId ? "codex_thread" : "unknown",
      ref: state.target.threadId ? `codex_thread:${state.target.threadId}` : null
    },
    dryRun: {
      attempted: state.dryRun !== null,
      approvalAuditId: state.dryRun?.approvalAuditId ?? null,
      paramsHash: state.dryRun?.paramsHash ?? null,
      messageHash: state.dryRun?.messageHash ?? null,
      live: state.dryRun ? false : null
    },
    transport: {
      class: "codex_app_server",
      connection: "single_connection_sequence"
    },
    live: state.live,
    postActionRefresh: {
      ran: false
    },
    nextDiagnosticStep: nextDiagnosticStep(blocker),
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    rawSecretIncluded: false,
    screenshotIncluded: false,
    sqliteIncluded: false
  };
  writeJson(join(options.evidenceDir, "live-control-smoke-failure-report.json"), report);
}

function classifyFailureBlocker(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/connect|handshake|spawn|ENOENT|codex.*not found|not connected/i.test(message)) {
    return "codex_app_server_setup_failed";
  }
  if (/thread(?:\/resume| not found)|control sequence step failed:\s*thread\/resume/i.test(message)) {
    return "same_connection_resume_load_diagnostics_required";
  }
  if (/approval request/i.test(message)) return "codex_approval_request_observed";
  if (/server request/i.test(message)) return "codex_server_request_observed";
  if (/turn id/i.test(message)) return "live_control_turn_id_missing";
  if (/did not complete cleanly|timeout/i.test(message)) return "live_control_smoke_not_completed_cleanly";
  return "live_control_smoke_failed";
}

function nextDiagnosticStep(blocker: string): string {
  switch (blocker) {
    case "codex_app_server_setup_failed":
      return "Check Codex app-server command availability, stdio handshake, and local transport setup before retrying live control.";
    case "same_connection_resume_load_diagnostics_required":
      return "Run same-connection resume/load diagnostics for the selected thread before retrying live control.";
    case "codex_approval_request_observed":
      return "Inspect why the harmless smoke triggered a Codex approval request; do not treat this as approved live-control proof.";
    case "codex_server_request_observed":
      return "Inspect unexpected server requests from the app-server smoke; do not retry live control until the request class is understood.";
    case "live_control_turn_id_missing":
      return "Inspect the app-server turn/start response shape and protocol drift before retrying.";
    case "live_control_smoke_not_completed_cleanly":
      return "Inspect turn completion notifications, status, and timeout behavior before retrying live control.";
    default:
      return "Inspect the public-safe failure report and route a focused issue before retrying live control.";
  }
}
