import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { normalizeMcpStructuredContent } from "../packages/mcp-server/src/mcp-protocol.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

test("Hermes MCP structuredContent remains an object for every logical result shape", () => {
  const objectResult = { ok: true, value: 1 };
  assert.equal(normalizeMcpStructuredContent(objectResult), objectResult);
  assert.deepEqual(normalizeMcpStructuredContent([{ id: 1 }]), { result: [{ id: 1 }] });
  assert.deepEqual(normalizeMcpStructuredContent([]), { result: [] });
  assert.deepEqual(normalizeMcpStructuredContent("ready"), { result: "ready" });
  assert.deepEqual(normalizeMcpStructuredContent(7), { result: 7 });
  assert.deepEqual(normalizeMcpStructuredContent(false), { result: false });
  assert.deepEqual(normalizeMcpStructuredContent(null), { result: null });
});

test("MCP stdio notifications are silent, cannot execute tools, and array results validate for Hermes", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-hermes-mcp-contract-"));
  const sessions = join(root, "sessions");
  const sessionPath = join(sessions, "rollout-2026-07-29T00-00-00-019f-hermes-contract.jsonl");
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, [
    JSON.stringify({
      timestamp: "2026-07-29T00:00:00.000Z",
      session_meta: { payload: { id: "019f-hermes-contract", cwd: "/private/redacted" } }
    }),
    JSON.stringify({
      timestamp: "2026-07-29T00:00:01.000Z",
      response_item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "HERMES_NOTIFICATION_MUST_NOT_INDEX" }]
      }
    })
  ].join("\n") + "\n");

  const server = spawn(process.execPath, ["--import", tsxImport, "packages/mcp-server/src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      LCO_DB_PATH: join(root, "orchestrator.sqlite"),
      LCO_AUDIT_PATH: join(root, "audit.jsonl"),
      LCO_CODEX_BIN: "lco-codex-not-needed-for-hermes-contract"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdoutBuffer = "";
  let stderr = "";
  const messages: Array<Record<string, unknown>> = [];
  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      messages.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  server.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const send = (payload: Record<string, unknown>) => {
    server.stdin.write(`${JSON.stringify(payload)}\n`);
  };
  const response = async (id: number): Promise<Record<string, any>> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const match = messages.find((message) => message.id === id);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for JSON-RPC id=${id}; stderr=${stderr}`);
  };

  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await response(1);

    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", method: "notifications/unknown", params: {} });
    send({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "lco_index_sessions",
        arguments: { target: "codex", roots: [sessions] }
      }
    });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await response(2);

    assert.deepEqual(messages.map((message) => message.id), [1, 2]);

    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "lco_find",
        arguments: { query: "HERMES_NOTIFICATION_MUST_NOT_INDEX", index: false }
      }
    });
    const find = await response(3);
    assert.equal(find.result?.structuredContent?.resultCount, 0);

    send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "lco_codex_extract",
        arguments: { kind: "plans", limit: 1 }
      }
    });
    const extract = await response(4);
    assert.deepEqual(extract.result?.structuredContent, { result: [] });
    assert.equal(extract.result?.content?.[0]?.text, "[]");

    send({ jsonrpc: "2.0", id: 5, method: "unsupported/request", params: {} });
    const unsupported = await response(5);
    assert.equal(unsupported.error?.code, -32601);
  } finally {
    server.kill();
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) {
        resolve();
        return;
      }
      server.once("exit", () => resolve());
    });
    rmSync(root, { recursive: true, force: true });
  }
});
