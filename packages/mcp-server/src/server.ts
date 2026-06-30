#!/usr/bin/env node
import { createInterface } from "node:readline";
import { createAuditStore, createCodexAppServerStdioClient } from "../../adapters/src/index.js";
import { createDatabase } from "../../core/src/index.js";
import { createLooTools } from "./tools.js";

const db = createDatabase();
const audit = createAuditStore(process.env.LOO_AUDIT_PATH || `${process.env.HOME || "."}/.openclaw/lossless-openclaw-orchestrator/audit.jsonl`);
const tools = createLooTools({
  db,
  audit,
  codexClient: createCodexAppServerStdioClient({
    command: process.env.LOO_CODEX_BIN || "codex",
    args: (process.env.LOO_CODEX_APP_SERVER_ARGS || "app-server --stdio").split(/\s+/).filter(Boolean),
    surface: "control"
  })
});

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  try {
    if (message.method === "initialize") {
      send({ id: message.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "lossless-openclaw-orchestrator", version: "0.1.0-beta.1" }, capabilities: { tools: {} } } });
    } else if (message.method === "tools/list") {
      send({ id: message.id, result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
    } else if (message.method === "tools/call") {
      const tool = tools.find((candidate) => candidate.name === message.params?.name);
      if (!tool) throw new Error(`Unknown tool: ${message.params?.name}`);
      const result = await tool.execute(message.params?.arguments ?? {});
      send({ id: message.id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result } });
    } else {
      send({ id: message.id, error: { code: -32601, message: `Unsupported method: ${message.method}` } });
    }
  } catch (error) {
    send({ id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
  }
});

function send(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("JSON-RPC payload must be an object");
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...payload })}\n`);
}
