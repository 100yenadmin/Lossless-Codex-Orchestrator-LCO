import assert from "node:assert/strict";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  CODEX_CONTROL_METHODS,
  CodexJsonRpcClient,
  LineProcessTransport,
  assertCodexMethodAllowed,
  buildLoopbackWebSocketConfig,
  codexTransportStatus,
  createCodexControl,
  redactValue
} from "../packages/adapters/src/index.js";

class FakeTransport {
  sent: unknown[] = [];
  closed = false;
  private readonly lines: string[];

  constructor(lines: unknown[]) {
    this.lines = lines.map((line) => JSON.stringify(line));
  }

  sendJson(payload: unknown): void {
    this.sent.push(payload);
  }

  readLine(): string | null {
    return this.lines.shift() ?? null;
  }

  close(): void {
    this.closed = true;
  }
}

test("redacts local paths and common credential shapes from shareable envelopes", () => {
  const home = homedir();
  const redacted = redactValue({
    home: `${home}/.codex/config.toml`,
    apiKey: "sk-test_1234567890abcdef",
    bearer: "Bearer abcdefghijklmnop",
    header: "authorization: Basic secret-token-value",
    headers: {
      authorization: "Basic abcdefghijklmnop",
      Authorization: "Bearer qwertyuiopasdfgh"
    }
  });

  assert.deepEqual(redacted, {
    home: "~/.codex/config.toml",
    apiKey: "<redacted-secret>",
    bearer: "Bearer <redacted-secret>",
    header: "authorization: <redacted-secret>",
    headers: {
      authorization: "<redacted-secret>",
      Authorization: "<redacted-secret>"
    }
  });
});

test("Codex method policy blocks generic mutation passthrough but allows approved control surface methods", () => {
  assert.doesNotThrow(() => assertCodexMethodAllowed("thread/list", "generic"));
  assert.throws(() => assertCodexMethodAllowed("turn/start", "generic"), /not allowed on generic/);
  assert.doesNotThrow(() => assertCodexMethodAllowed("turn/start", "control"));
  assert.throws(() => assertCodexMethodAllowed("config/value/write", "control"), /forbidden/);
});

test("Codex JSON-RPC client initializes, sends initialized notification, buffers notifications, and returns results", async () => {
  const transport = new FakeTransport([
    { jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "fake-codex" } } },
    { jsonrpc: "2.0", method: "thread/status/changed", params: { threadId: "thr_1" } },
    { jsonrpc: "2.0", id: 2, result: { data: [{ id: "thr_1" }] } }
  ]);
  const client = new CodexJsonRpcClient(() => transport, { timeoutMs: 50 });

  await client.connect();
  const result = await client.request("thread/list", {});
  client.close();

  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { data: [{ id: "thr_1" }] });
  assert.equal(client.notifications.length, 1);
  assert.equal(client.notifications[0]?.method, "thread/status/changed");
  assert.deepEqual(transport.sent, [
    {
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "lossless-openclaw-orchestrator", title: "Lossless OpenClaw Orchestrator", version: "0.1.0-beta.0" },
        capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: [] }
      }
    },
    { method: "initialized" },
    { id: 2, method: "thread/list", params: {} }
  ]);
  assert.equal(transport.closed, true);
});

test("Codex JSON-RPC client reports timeout and redacts JSON-RPC errors", async () => {
  const timeoutClient = new CodexJsonRpcClient(() => new FakeTransport([
    { jsonrpc: "2.0", id: 1, result: {} }
  ]), { timeoutMs: 50 });
  await timeoutClient.connect();
  const timeout = await timeoutClient.request("thread/read", { threadId: "thr_1" });
  assert.equal(timeout.ok, false);
  assert.match(timeout.error ?? "", /Timed out waiting for thread\/read/);
  timeoutClient.close();

  const errorClient = new CodexJsonRpcClient(() => new FakeTransport([
    { jsonrpc: "2.0", id: 1, result: {} },
    { jsonrpc: "2.0", id: 2, error: { message: `authorization: ${process.env.HOME}/secret sk-test_1234567890` } }
  ]), { timeoutMs: 50 });
  await errorClient.connect();
  const error = await errorClient.request("thread/read", { threadId: "thr_1" });
  assert.equal(error.ok, false);
  assert.match(error.error ?? "", /authorization: <redacted-secret>/);
  assert.doesNotMatch(error.error ?? "", /sk-test_1234567890/);
  errorClient.close();
});

test("line process transport removes timed-out waiters before later output arrives", async () => {
  const transport = new LineProcessTransport(process.execPath, [
    "-e",
    "setTimeout(() => console.log('late-line'), 80); setTimeout(() => {}, 180);"
  ], 20);

  try {
    const timedOut = await transport.readLine(Date.now() + 10);
    assert.equal(timedOut, null);
    await delay(120);
    assert.equal(await transport.readLine(Date.now() + 50), "late-line");
  } finally {
    transport.close();
  }
});

test("JSON-RPC policy blocks forbidden methods before sending transport requests", async () => {
  const transport = new FakeTransport([
    { jsonrpc: "2.0", id: 1, result: {} }
  ]);
  const client = new CodexJsonRpcClient(() => transport, { timeoutMs: 50, surface: "control" });

  await client.connect();
  await assert.rejects(
    () => client.request("config/value/write", { key: "danger", value: true }),
    /forbidden/
  );
  await client.close();

  assert.deepEqual(transport.sent, [
    {
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "lossless-openclaw-orchestrator", title: "Lossless OpenClaw Orchestrator", version: "0.1.0-beta.0" },
        capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: [] }
      }
    },
    { method: "initialized" }
  ]);
});

test("Codex control checks method policy before live transport calls", async () => {
  let requestCalled = false;
  let auditRecord: any = null;
  const control = createCodexControl({
    audit: {
      path: "memory",
      fingerprintText(value) {
        return `test-text-${value}`;
      },
      fingerprintValue(value) {
        return `test-params-${JSON.stringify(value)}`;
      },
      append(record) {
        auditRecord = { id: "loo_audit_test", createdAt: new Date().toISOString(), ...record };
        return auditRecord;
      },
      find(id) {
        return auditRecord?.id === id ? auditRecord : null;
      }
    },
    client: {
      request: async () => {
        requestCalled = true;
        return { ok: true };
      }
    }
  });
  const dryRun = await control.sendMessage({ threadId: "thr_1", message: "continue", dryRun: true });
  const removed = CODEX_CONTROL_METHODS.delete("turn/start");

  try {
    await assert.rejects(
      () => control.sendMessage({ threadId: "thr_1", message: "continue", dryRun: false, approvalAuditId: dryRun.approvalAuditId }),
      /not allowlisted/
    );
    assert.equal(requestCalled, false);
  } finally {
    if (removed) CODEX_CONTROL_METHODS.add("turn/start");
  }
});

test("loopback WebSocket config rejects credentials, non-loopback, paths, and non-ws schemes", () => {
  assert.deepEqual(buildLoopbackWebSocketConfig("ws://127.0.0.1:4567"), { url: "ws://127.0.0.1:4567/" });
  assert.throws(() => buildLoopbackWebSocketConfig("ws://user:pass@127.0.0.1:4567"), /credentials/);
  assert.throws(() => buildLoopbackWebSocketConfig("wss://127.0.0.1:4567"), /must use ws/);
  assert.throws(() => buildLoopbackWebSocketConfig("ws://example.com:4567"), /loopback/);
  assert.throws(() => buildLoopbackWebSocketConfig("ws://127.0.0.1:4567/path"), /must not include a path/);
});

test("Codex transport status reports command availability without starting a live session", () => {
  const status = codexTransportStatus({
    command: process.execPath,
    versionArgs: ["--version"]
  });

  assert.equal(status.available, true);
  assert.match(status.version ?? "", /^v/);

  const missing = codexTransportStatus({
    command: `${homedir()}/definitely/not/a/codex/binary`
  });
  assert.equal(missing.available, false);
  assert.equal(missing.mode, "stdio");
  assert.equal(missing.command, "~/definitely/not/a/codex/binary");
});

test("Codex control rejects approval mismatch before live transport calls", async () => {
  let requestCalled = false;
  const control = createCodexControl({
    audit: {
      path: "memory",
      fingerprintText(value) {
        return `test-text-${value}`;
      },
      fingerprintValue(value) {
        return `test-params-${JSON.stringify(value)}`;
      },
      append(record) {
        return { id: "loo_audit_test", createdAt: new Date().toISOString(), ...record };
      },
      find() {
        return {
          id: "loo_audit_test",
          action: "codex_send_message",
          target: "thr_1",
          paramsHash: "wrong",
          live: false,
          createdAt: new Date().toISOString()
        };
      }
    },
    client: {
      request: async () => {
        requestCalled = true;
        return { ok: true };
      }
    }
  });

  await assert.rejects(
    () => control.sendMessage({ threadId: "thr_1", message: "continue", dryRun: false, approvalAuditId: "loo_audit_test" }),
    /does not match/
  );
  assert.equal(requestCalled, false);
});
