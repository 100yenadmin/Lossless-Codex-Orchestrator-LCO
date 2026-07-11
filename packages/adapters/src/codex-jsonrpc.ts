import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { URL } from "node:url";
import { assertCodexMethodAllowed, type CodexMethodSurface } from "./policy.js";
import { redactDiagnosticString, redactValue } from "./redaction.js";

export type JsonRpcTransport = {
  sendJson(payload: unknown): void | Promise<void>;
  readLine(deadline: number): string | null | Promise<string | null>;
  close(): void | Promise<void>;
};

export type CodexJsonRpcResponse = {
  ok: boolean;
  result?: unknown;
  error?: string;
  notifications: JsonRpcNotification[];
};

export type JsonRpcNotification = {
  method: string;
  params: Record<string, unknown>;
};

export type JsonRpcServerRequest = {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
};

export type NotificationWaitResult = {
  matched: boolean;
  notifications: JsonRpcNotification[];
  serverRequests: JsonRpcServerRequest[];
};

export type JsonRpcTurnResolution = {
  id?: string;
  status: string | null;
  completed: boolean;
  notificationMethods: string[];
  approvalRequestCount: number;
  serverRequestCount: number;
  error?: string;
};

export type CodexJsonRpcClientOptions = {
  timeoutMs?: number;
  surface?: CodexMethodSurface;
};

export const CODEX_TURN_NOTIFICATION_METHOD_STATUS = {
  "turn/completed": "completed",
  "turn/failed": "failed",
  "turn/interrupted": "interrupted",
  "turn/cancelled": "cancelled",
  "turn/canceled": "cancelled",
  "turn/started": "running"
} as const;

const DEFAULT_TIMEOUT_MS = 10_000;
const CLIENT_INFO = {
  name: "lossless-openclaw-orchestrator",
  title: "Lossless OpenClaw Orchestrator",
  version: "1.0.0"
};

export class CodexJsonRpcClient {
  readonly notifications: JsonRpcNotification[] = [];
  readonly serverRequests: JsonRpcServerRequest[] = [];
  private transport: JsonRpcTransport | null = null;
  private nextId = 1;
  private readonly timeoutMs: number;
  private readonly surface: CodexMethodSurface;

  constructor(
    private readonly transportFactory: () => JsonRpcTransport,
    options: CodexJsonRpcClientOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.surface = options.surface ?? "generic";
  }

  async connect(): Promise<void> {
    this.transport = this.transportFactory();
    const initialized = await this.requestRaw("initialize", {
      clientInfo: CLIENT_INFO,
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: []
      }
    });
    if (!initialized.ok) {
      await this.close();
      throw new Error(initialized.error ?? "Codex JSON-RPC initialize failed");
    }
    await this.sendNotification("initialized");
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<CodexJsonRpcResponse> {
    assertCodexMethodAllowed(method, this.surface);
    return this.requestRaw(method, params);
  }

  async readNotificationsUntil(
    predicate: (notification: JsonRpcNotification) => boolean,
    options: { timeoutMs?: number; stopOnServerRequest?: boolean } = {}
  ): Promise<NotificationWaitResult> {
    const transport = this.requireTransport();
    const deadline = Date.now() + (options.timeoutMs ?? this.timeoutMs);
    const notifications: JsonRpcNotification[] = [];
    const serverRequests: JsonRpcServerRequest[] = [];

    while (Date.now() < deadline) {
      const line = await transport.readLine(deadline);
      if (!line) {
        await delay(2);
        continue;
      }
      const payload = parsePayload(line);
      if (!payload) continue;

      const serverRequest = serverRequestFromPayload(payload);
      if (serverRequest) {
        this.serverRequests.push(serverRequest);
        serverRequests.push(serverRequest);
        if (options.stopOnServerRequest) {
          return { matched: false, notifications, serverRequests };
        }
        continue;
      }

      const notification = notificationFromPayload(payload);
      if (!notification) continue;
      this.notifications.push(notification);
      notifications.push(notification);
      if (predicate(notification)) {
        return { matched: true, notifications, serverRequests };
      }
    }

    return { matched: false, notifications, serverRequests };
  }

  async close(): Promise<void> {
    if (!this.transport) return;
    const transport = this.transport;
    this.transport = null;
    await transport.close();
  }

  private async sendNotification(method: string): Promise<void> {
    this.requireTransport().sendJson({ method });
  }

  private async requestRaw(method: string, params: Record<string, unknown>): Promise<CodexJsonRpcResponse> {
    const transport = this.requireTransport();
    const id = this.nextId;
    this.nextId += 1;
    await transport.sendJson({ id, method, params });

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const line = await transport.readLine(deadline);
      if (!line) {
        await delay(2);
        continue;
      }
      const payload = parsePayload(line);
      if (!payload) continue;

      const notification = notificationFromPayload(payload);
      if (notification) {
        this.notifications.push(notification);
        continue;
      }

      if (payload.id !== id) continue;
      if ("error" in payload) {
        return { ok: false, error: JSON.stringify(redactValue(payload.error)), notifications: [...this.notifications] };
      }
      if ("result" in payload) {
        return { ok: true, result: payload.result, notifications: [...this.notifications] };
      }
      return { ok: true, result: payload, notifications: [...this.notifications] };
    }
    return { ok: false, error: `Timed out waiting for ${method}`, notifications: [...this.notifications] };
  }

  private requireTransport(): JsonRpcTransport {
    if (!this.transport) throw new Error("Codex JSON-RPC client is not connected");
    return this.transport;
  }
}

export class LineProcessTransport implements JsonRpcTransport {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly readline: Interface;
  private readonly lines: string[] = [];
  private readonly waiters: Array<(line: string | null) => void> = [];
  private stdoutClosed = false;

  constructor(command: string, args: string[], private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });
    this.readline = createInterface({ input: this.process.stdout, crlfDelay: Infinity });
    this.readline.on("line", (line) => this.pushLine(line));
    this.readline.on("close", () => this.finishOutput());
    this.process.on("error", () => this.finishOutput());
  }

  sendJson(payload: unknown): void {
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  readLine(deadline: number): Promise<string | null> {
    const existing = this.lines.shift();
    if (existing !== undefined) return Promise.resolve(existing);
    if (this.stdoutClosed) return Promise.resolve(null);

    const remaining = Math.max(1, Math.min(this.timeoutMs, deadline - Date.now()));
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const waiter = (line: string | null) => {
        clearTimeout(timer);
        resolve(line);
      };
      timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(null);
      }, remaining);
      this.waiters.push(waiter);
    });
  }

  close(): void {
    this.readline.close();
    this.process.stdin.destroy();
    this.process.stdout.destroy();
    this.process.stderr.destroy();
    if (!this.process.killed && this.process.exitCode === null) this.process.kill("SIGTERM");
  }

  private pushLine(line: string | null): void {
    if (line === null) {
      this.finishOutput();
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(line);
      return;
    }
    this.lines.push(line);
  }

  private finishOutput(): void {
    if (this.stdoutClosed) return;
    this.stdoutClosed = true;
    let waiter = this.waiters.shift();
    while (waiter) {
      waiter(null);
      waiter = this.waiters.shift();
    }
  }
}

export function createCodexMcpStdioClient(options: {
  command?: string;
  args?: string[];
  timeoutMs?: number;
  surface?: CodexMethodSurface;
} = {}) {
  return {
    async request(method: string, params: Record<string, unknown>) {
      const client = new CodexJsonRpcClient(
        () => new LineProcessTransport(options.command ?? "codex", options.args ?? ["app-server", "--stdio"], options.timeoutMs),
        { timeoutMs: options.timeoutMs, surface: options.surface ?? "control" }
      );
      await client.connect();
      try {
        return await client.request(method, params);
      } finally {
        await client.close();
      }
    },
    async requestSequence(steps: Array<{ method: string; params: Record<string, unknown> }>) {
      const surface = options.surface ?? "control";
      for (const step of steps) assertCodexMethodAllowed(step.method, surface);
      const client = new CodexJsonRpcClient(
        () => new LineProcessTransport(options.command ?? "codex", options.args ?? ["app-server", "--stdio"], options.timeoutMs),
        { timeoutMs: options.timeoutMs, surface }
      );
      await client.connect();
      try {
        const responses: CodexJsonRpcResponse[] = [];
        for (const step of steps) {
          const response = await client.request(step.method, step.params);
          responses.push(response);
          if (!response.ok) break;
        }
        return responses;
      } finally {
        await client.close();
      }
    },
    async requestSequenceUntilTurnResolved(
      steps: Array<{ method: string; params: Record<string, unknown> }>,
      turnOptions: { threadId: string; expectedTurnId?: string; turnWaitMs: number; requireSafeActiveRuntime?: boolean }
    ) {
      const surface = options.surface ?? "control";
      for (const step of steps) assertCodexMethodAllowed(step.method, surface);
      const client = new CodexJsonRpcClient(
        () => new LineProcessTransport(options.command ?? "codex", options.args ?? ["app-server", "--stdio"], options.timeoutMs),
        { timeoutMs: options.timeoutMs, surface }
      );
      await client.connect();
      try {
        const responses: CodexJsonRpcResponse[] = [];
        let turnId = turnOptions.expectedTurnId;
        let latestStatus: string | null = null;
        let latestError: string | undefined;
        for (const [index, step] of steps.entries()) {
          const response = await client.request(step.method, step.params);
          responses.push(response);
          const responseTurn = turnResolutionFromResponse(response, step.method);
          turnId ??= responseTurn.id;
          latestStatus = responseTurn.status ?? latestStatus;
          latestError = responseTurn.error ?? latestError;
          if (!response.ok) break;
          if (index === 0 && turnOptions.requireSafeActiveRuntime && step.method === "thread/resume" && !safeActiveRuntimeFromResume(response)) {
            responses.push({
              ok: false,
              error: "Codex safe runtime posture was not proven after thread/resume; active-turn control was not sent",
              notifications: []
            });
            break;
          }
        }
        if (responses.some((response) => !response.ok)) {
          return { responses };
        }
        const turn = await waitForJsonRpcTurnResolution(client, {
          turnId,
          initialStatus: latestStatus,
          initialError: latestError,
          timeoutMs: turnOptions.turnWaitMs
        });
        return { responses, turn };
      } finally {
        await client.close();
      }
    }
  };
}

export const createCodexAppServerStdioClient = createCodexMcpStdioClient;

export function codexTransportStatus(options: {
  command?: string;
  versionArgs?: string[];
  timeoutMs?: number;
} = {}): {
  mode: "stdio";
  command: string;
  available: boolean;
  version: string | null;
  error: string | null;
} {
  const command = options.command ?? "codex";
  const safeCommand = String(redactValue(command));
  const completed = spawnSync(command, options.versionArgs ?? ["--version"], {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 5_000
  });
  if (completed.error) {
    return {
      mode: "stdio",
      command: safeCommand,
      available: false,
      version: null,
      error: String(redactValue(completed.error.message))
    };
  }
  const text = `${completed.stdout ?? ""}${completed.stderr ?? ""}`.trim();
  return {
    mode: "stdio",
    command: safeCommand,
    available: completed.status === 0,
    version: text || null,
    error: completed.status === 0 ? null : String(redactValue(text || `exit ${completed.status}`))
  };
}

export function buildLoopbackWebSocketConfig(rawUrl: string): { url: string } {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "ws:") throw new Error("Codex app-server websocket URLs must use ws://");
  if (!parsed.port) throw new Error("Codex app-server websocket URL must include a port");
  if (parsed.username || parsed.password) throw new Error("Codex app-server websocket URL must not include credentials");
  if (!isLoopbackHost(parsed.hostname)) throw new Error("Codex app-server websocket URLs must be loopback endpoints");
  if (parsed.pathname !== "/") throw new Error("Codex app-server websocket URL must not include a path");
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return { url: parsed.toString() };
}

function parsePayload(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function notificationFromPayload(payload: Record<string, unknown>): JsonRpcNotification | null {
  if ("id" in payload || typeof payload.method !== "string") return null;
  return {
    method: payload.method,
    params: payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
      ? payload.params as Record<string, unknown>
      : {}
  };
}

function serverRequestFromPayload(payload: Record<string, unknown>): JsonRpcServerRequest | null {
  const id = payload.id;
  if ((typeof id !== "string" && typeof id !== "number") || typeof payload.method !== "string") return null;
  if ("result" in payload || "error" in payload) return null;
  return {
    id,
    method: payload.method,
    params: payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
      ? payload.params as Record<string, unknown>
      : {}
  };
}

async function waitForJsonRpcTurnResolution(
  client: CodexJsonRpcClient,
  input: { turnId?: string; initialStatus: string | null; initialError?: string; timeoutMs: number }
): Promise<JsonRpcTurnResolution> {
  if (!input.turnId) {
    return {
      status: "turn_id_missing",
      completed: false,
      notificationMethods: [],
      approvalRequestCount: 0,
      serverRequestCount: 0,
      ...(input.initialError ? { error: input.initialError } : {})
    };
  }
  const initialNormalized = normalizeTurnStatus(input.initialStatus);
  if (turnStatusResolved(initialNormalized)) {
    return {
      id: input.turnId,
      status: initialNormalized,
      completed: initialNormalized === "completed",
      notificationMethods: [],
      approvalRequestCount: 0,
      serverRequestCount: 0,
      ...(input.initialError ? { error: input.initialError } : {})
    };
  }

  let latestStatus = initialNormalized;
  let latestError = input.initialError;
  try {
    const wait = await client.readNotificationsUntil((notification) => {
      const turn = turnFromNotification(notification);
      if (turn.id !== input.turnId) return false;
      latestStatus = turn.status ?? latestStatus;
      latestError = turn.error ?? latestError;
      return turnStatusResolved(normalizeTurnStatus(latestStatus));
    }, { timeoutMs: input.timeoutMs, stopOnServerRequest: true });
    const notificationMethods = wait.notifications.map((notification) => notification.method);
    const approvalRequestCount = wait.serverRequests.filter((request) => isApprovalRequest(request.method)).length;
    if (wait.serverRequests.length > 0) {
      return {
        id: input.turnId,
        status: "turn_server_request_unconfirmed",
        completed: false,
        notificationMethods,
        approvalRequestCount,
        serverRequestCount: wait.serverRequests.length,
        ...(latestError ? { error: latestError } : {})
      };
    }
    const normalized = normalizeTurnStatus(latestStatus);
    if (wait.matched && normalized) {
      return {
        id: input.turnId,
        status: normalized,
        completed: normalized === "completed",
        notificationMethods,
        approvalRequestCount,
        serverRequestCount: wait.serverRequests.length,
        ...(latestError ? { error: latestError } : {})
      };
    }
    return {
      id: input.turnId,
      status: "turn_started_unconfirmed",
      completed: false,
      notificationMethods,
      approvalRequestCount,
      serverRequestCount: wait.serverRequests.length,
      ...(latestError ? { error: latestError } : {})
    };
  } catch (error) {
    return {
      id: input.turnId,
      status: "turn_transport_error",
      completed: false,
      notificationMethods: [],
      approvalRequestCount: 0,
      serverRequestCount: 0,
      error: redactDiagnosticString(error instanceof Error ? error.message : String(error))
    };
  }
}

function turnResolutionFromResponse(response: CodexJsonRpcResponse, method: string): { id?: string; status: string | null; error?: string } {
  const result = objectField(response.result);
  const turn = optionalObjectField(result.turn) ?? optionalObjectField((response as unknown as Record<string, unknown>).turn) ?? {};
  return {
    id: stringField(turn, "id"),
    status: normalizeTurnStatus(stringField(turn, "status") ?? methodStatus(method)),
    ...turnError(turn)
  };
}

function turnFromNotification(notification: JsonRpcNotification): { id?: string; status: string | null; error?: string } {
  const turn = optionalObjectField(notification.params.turn) ?? notification.params;
  return {
    id: stringField(turn, "id") ?? stringField(notification.params, "turnId"),
    status: normalizeTurnStatus(stringField(turn, "status") ?? methodStatus(notification.method)),
    ...turnError(turn)
  };
}

function turnError(turn: Record<string, unknown>): { error?: string } {
  const error = optionalObjectField(turn.error);
  const message = error ? stringField(error, "message") : undefined;
  if (!message) return {};
  return { error: "Codex turn failed; diagnostic text redacted" };
}

function safeActiveRuntimeFromResume(response: CodexJsonRpcResponse): boolean {
  const result = objectField(response.result);
  const sandbox = optionalObjectField(result.sandbox);
  return result.approvalPolicy === "never"
    && sandbox?.type === "readOnly"
    && sandbox.networkAccess === false;
}

function methodStatus(method: string): string | null {
  // Extension point for Codex protocol drift: add future terminal notification
  // methods here so bounded turn waits do not degrade into timeout packets.
  return CODEX_TURN_NOTIFICATION_METHOD_STATUS[method as keyof typeof CODEX_TURN_NOTIFICATION_METHOD_STATUS] ?? null;
}

function turnStatusResolved(status: string | null): boolean {
  return status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled" || status === "canceled";
}

function normalizeTurnStatus(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase();
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalObjectField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" && record[key] ? record[key] : undefined;
}

function isApprovalRequest(method: string): boolean {
  return method === "applyPatchApproval" || method === "execCommandApproval" || /Approval$/.test(method);
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
