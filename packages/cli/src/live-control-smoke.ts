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
  await options.client.connect();
  try {
    const target = options.threadId
      ? { threadId: options.threadId, source: "provided_thread" as const }
      : { threadId: await startEphemeralThread(options.client, options.cwd), source: "ephemeral_thread_start" as const };
    const control = createCodexControl({
      audit: options.audit,
      client: {
        request: (method, params) => options.client.request(method, params),
        requestSequence: async (requests) => {
          let response: unknown;
          for (const request of requests) {
            response = await options.client.request(request.method, request.params);
            if (isFailedCodexResponse(response)) return response;
          }
          return response;
        }
      }
    });
    const dryRun = await control.sendMessage({ threadId: target.threadId, message, dryRun: true });
    if (!dryRun.messageHash) throw new Error("dry-run did not produce a message hash");
    const live = await control.sendMessage({
      threadId: target.threadId,
      message,
      dryRun: false,
      approvalAuditId: dryRun.approvalAuditId
    });
    const turnId = extractTurnId(live.response);
    if (!turnId) throw new Error("live Codex control response did not include a turn id");
    const completion = await options.client.waitForTurnCompletion({ threadId: target.threadId, turnId, timeoutMs });
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
  } finally {
    await options.client.close();
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

function isFailedCodexResponse(value: unknown): boolean {
  return objectField(value).ok === false;
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
