import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import {
  DEFAULT_REQUIRED_TOOL_CALLS,
  OPENCLAW_GATEWAY_BACKEND_CLIENT_ID,
  OPENCLAW_GATEWAY_BACKEND_PROTOCOL,
  runOpenClawToolSmoke
} from "../packages/cli/src/openclaw-tool-smoke.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
type DryRunOutputShape = "plain" | "content" | "details" | "both";

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForJsonFile<T>(path: string, timeoutMs = 5000): T {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as T;
    sleepSync(25);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function createFakeGatewayBackend(dir: string): { serverPath: string; readyPath: string; capturePath: string } {
  const serverPath = join(dir, "fake-openclaw-backend.mjs");
  const readyPath = join(dir, "gateway-ready.json");
  const capturePath = join(dir, "gateway-capture.jsonl");
  writeFileSync(serverPath, `#!/usr/bin/env node
import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const readyPath = process.env.LOO_FAKE_GATEWAY_READY;
const capturePath = process.env.LOO_FAKE_GATEWAY_CAPTURE;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function redact(message) {
  const copy = JSON.parse(JSON.stringify(message));
  if (copy?.params?.auth?.token) copy.params.auth.token = "<redacted>";
  return copy;
}

function encodeFrame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function readFrames(buffer) {
  const messages = [];
  let closeSeen = false;
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }
    const masked = Boolean(second & 0x80);
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) break;
    const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : undefined;
    const payloadStart = offset + headerLength + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length));
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }
    const opcode = first & 0x0f;
    if (opcode === 0x1) messages.push(payload.toString("utf8"));
    if (opcode === 0x8) closeSeen = true;
    offset += frameLength;
  }
  return { messages, closeSeen, remaining: buffer.subarray(offset) };
}

const server = createServer();
server.on("upgrade", (req, socket) => {
  const key = String(req.headers["sec-websocket-key"] || "");
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Accept: " + accept,
    "",
    ""
  ].join("\\r\\n"));

  let buffered = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    const parsed = readFrames(buffered);
    buffered = parsed.remaining;
    if (parsed.closeSeen) {
      socket.write(Buffer.from([0x88, 0x00]));
      socket.end();
      return;
    }
    for (const raw of parsed.messages) {
      const message = JSON.parse(raw);
      appendFileSync(capturePath, JSON.stringify(redact(message)) + "\\n");
      if (message.method === "connect") {
        socket.write(encodeFrame({ type: "res", id: message.id, ok: true, payload: { protocol: 4 } }));
        continue;
      }
      if (message.method === "tools.catalog") {
        socket.write(encodeFrame({ type: "res", id: message.id, ok: true, payload: { tools: [{ name: "loo_doctor" }] } }));
        continue;
      }
      if (message.method === "tools.invoke") {
        socket.write(encodeFrame({ type: "res", id: message.id, ok: true, payload: { ok: true, toolName: message.params.name, source: "plugin", output: { ok: true, localOnly: true } } }));
        continue;
      }
      socket.write(encodeFrame({ type: "res", id: message.id, ok: false, error: { message: "unexpected method" } }));
    }
  });
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  writeFileSync(readyPath, JSON.stringify({ port: address.port }));
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
setTimeout(() => process.exit(124), 30000);
`);
  chmodSync(serverPath, 0o755);
  return { serverPath, readyPath, capturePath };
}

test("OpenClaw tool smoke backend gateway connect payload follows current OpenClaw protocol", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-backend-"));
  const { serverPath, readyPath, capturePath } = createFakeGatewayBackend(dir);
  const server = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      LOO_FAKE_GATEWAY_READY: readyPath,
      LOO_FAKE_GATEWAY_CAPTURE: capturePath
    },
    stdio: "ignore"
  });

  try {
    const { port } = waitForJsonFile<{ port: number }>(readyPath);
    const report = runOpenClawToolSmoke({
      gatewayUrl: `ws://127.0.0.1:${port}`,
      token: "test-backend-token",
      requiredTools: ["loo_doctor"],
      gatewayTimeoutMs: 3000
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.toolSmokeReady, true, JSON.stringify(report, null, 2));
    assert.equal(report.command, "loo backend-gateway tools.catalog --json --params <redacted>");
    const frames = readFileSync(capturePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { method?: string; params?: { minProtocol?: number; maxProtocol?: number; client?: { id?: string; displayName?: string; mode?: string }; auth?: { token?: string } } });
    const connectFrames = frames.filter((frame) => frame.method === "connect");
    assert.equal(connectFrames.length, 2);
    assert.deepEqual(
      connectFrames.map((frame) => ({
        minProtocol: frame.params?.minProtocol,
        maxProtocol: frame.params?.maxProtocol,
        clientId: frame.params?.client?.id,
        displayName: frame.params?.client?.displayName,
        mode: frame.params?.client?.mode,
        token: frame.params?.auth?.token
      })),
      [
        {
          minProtocol: OPENCLAW_GATEWAY_BACKEND_PROTOCOL.minProtocol,
          maxProtocol: OPENCLAW_GATEWAY_BACKEND_PROTOCOL.maxProtocol,
          clientId: OPENCLAW_GATEWAY_BACKEND_CLIENT_ID,
          displayName: "loo-openclaw-tool-smoke",
          mode: "backend",
          token: "<redacted>"
        },
        {
          minProtocol: OPENCLAW_GATEWAY_BACKEND_PROTOCOL.minProtocol,
          maxProtocol: OPENCLAW_GATEWAY_BACKEND_PROTOCOL.maxProtocol,
          clientId: OPENCLAW_GATEWAY_BACKEND_CLIENT_ID,
          displayName: "loo-openclaw-tool-smoke",
          mode: "backend",
          token: "<redacted>"
        }
      ]
    );
  } finally {
    server.kill("SIGTERM");
  }
});

function createFakeOpenClaw(
  dir: string,
  catalogTools: string[],
  catalogShape: "flat" | "groups" = "flat",
  options: { dryRunOutputShape?: DryRunOutputShape; wrapDryRunOutput?: boolean; omitFallbackNextToolCall?: boolean } = {}
): { bin: string; callsPath: string } {
  const callsPath = join(dir, "calls.jsonl");
  const bin = join(dir, "openclaw-fake.mjs");
  const catalogPayload = catalogShape === "groups"
    ? { groups: [{ id: "plugin:lossless-openclaw-orchestrator", tools: catalogTools.map((id) => ({ id, label: id, source: "plugin" })) }] }
    : { tools: catalogTools.map((name) => ({ name, description: "fake" })) };
  const dryRunOutputShape = options.dryRunOutputShape ?? (options.wrapDryRunOutput ? "both" : "plain");
  const dryRunDetailsCode = `{ action: "codex_send_message", threadId: toolArgs.thread_id, live: false, approvalAuditId: "loo_audit_test", paramsHash: "params-hash", messageHash: "message-hash", method: "turn/start", approval_audit_id: "loo_audit_test", params_hash: "params-hash", message_hash: "message-hash" }`;
  const dryRunContentCode = `[{ type: "text", text: JSON.stringify(${dryRunDetailsCode}) }]`;
  const dryRunOutputCode = dryRunOutputShape === "both"
    ? `{ content: ${dryRunContentCode}, details: ${dryRunDetailsCode} }`
    : dryRunOutputShape === "content"
      ? `{ content: ${dryRunContentCode} }`
      : dryRunOutputShape === "details"
        ? `{ details: ${dryRunDetailsCode} }`
        : dryRunDetailsCode;
  const fallbackNextToolCallCode = options.omitFallbackNextToolCall
    ? "null"
    : `missingCoherence ? { tool: "loo_codex_desktop_coherence", args: { thread_id: toolArgs.thread_id, source_ref: toolArgs.source_ref } } : null`;
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const callIndex = args.indexOf("call");
const method = callIndex >= 0 ? args[callIndex + 1] : "";
const paramsIndex = args.indexOf("--params");
const params = paramsIndex >= 0 ? JSON.parse(args[paramsIndex + 1] || "{}") : {};
appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify({ method, params, args, envTokenPresent: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN) }) + "\\n");
if (method === "tools.catalog") {
  console.log(JSON.stringify(${JSON.stringify(catalogPayload)}));
  process.exit(0);
}
if (method === "tools.invoke") {
  const name = params.name;
  const toolArgs = params.args || {};
  if (name === "loo_gateway_refused") {
    console.log(JSON.stringify({ ok: false, toolName: name, source: "plugin", error: { code: "forbidden", message: "super-secret-transcript-span" } }));
    process.exit(0);
  }
  if (name === "loo_plugin_details_refused") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { content: [{ type: "text", text: JSON.stringify({ ok: false, blockers: ["execute_flag_missing"], private: "super-secret-transcript-span" }) }], details: { ok: false, blockers: ["execute_flag_missing"], private: "super-secret-transcript-span" } } }));
    process.exit(0);
  }
  if (name === "loo_doctor") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { ok: true, localOnly: true, toolPrefix: "loo_*" } }));
    process.exit(0);
  }
  if (name === "loo_search_sessions") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: [{ sourceRef: "codex_thread:thread-1", threadId: "thread-1", score: 9, snippet: "super-secret-transcript-span" }] }));
    process.exit(0);
  }
  if (name === "loo_describe_session") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { threadId: toolArgs.thread_id, sourceRef: "codex_thread:" + toolArgs.thread_id, status: "active", summary: "super-secret-transcript-span" } }));
    process.exit(0);
  }
  if (name === "loo_expand_query") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { sourceRef: "codex_thread:thread-1", profile: { name: toolArgs.profile || "brief" }, tokenBudget: toolArgs.token_budget, text: "super-secret-transcript-span" } }));
    process.exit(0);
  }
  if (name === "loo_expand_session") {
    if (!toolArgs.thread_id) {
      console.log(JSON.stringify({ ok: false, toolName: name, source: "plugin", error: { code: "missing_thread_id", message: "thread_id is required" } }));
      process.exit(0);
    }
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { sourceRef: "codex_thread:" + toolArgs.thread_id, threadId: toolArgs.thread_id, text: "super-secret-transcript-span" } }));
    process.exit(0);
  }
  if (name === "loo_codex_plans" || name === "loo_codex_final_messages" || name === "loo_codex_touched_files") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: [{ sourceRef: "codex_thread:" + toolArgs.thread_id, threadId: toolArgs.thread_id, count: 1, text: "super-secret-transcript-span" }] }));
    process.exit(0);
  }
  if (name === "loo_codex_thread_map") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { results: [{ sourceRef: "codex_thread:thread-1", threadId: "thread-1", status: "active" }] } }));
    process.exit(0);
  }
  if (name === "loo_recent_sessions") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, cards: [{ threadId: "codex_thread:thread-1" }] } }));
    process.exit(0);
  }
  if (name === "loo_cockpit_inbox") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, items: [{ card: { threadId: "codex_thread:thread-1" } }] } }));
    process.exit(0);
  }
  if (name === "loo_codex_collaboration_cockpit") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, schema: "lco.codex.collaborationCockpit.v1", lanes: [{ threadId: "codex_thread:thread-1", attention: { level: "high", urgencyScore: 80 }, desktop: { state: "fallback_ready", requiresFallback: true, preferredBackend: "cua-driver" } }], sourceCoverage: { recentSessions: "ok", cockpitInbox: "ok", desktopCoherence: "ok", desktopFallback: "ok" }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
    process.exit(0);
  }
  if (name === "loo_codex_collaboration_next_steps") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, schema: "lco.codex.collaborationNextSteps.v1", steps: [{ threadId: "codex_thread:thread-1", category: "desktop_coherence", status: "ready", toolCall: { tool: "loo_codex_desktop_coherence", args: { thread_id: "thread-1", source_ref: "codex_thread:thread-1" }, execute: false } }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
    process.exit(0);
  }
  if (name === "loo_watchers_list" || name === "loo_watcher_status") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, watchers: [{ watchId: "watch_tool_smoke_checks", targetRef: "codex_thread:thread-1", status: "triggered", mutates: false, reasonCodes: ["watcher_triggered"] }], summary: { triggered: 1 } } }));
    process.exit(0);
  }
  if (name === "loo_watcher_dry_run") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, resumeRequestPackets: [{ schema: "lco.resumeRequestPacket.v1", targetRef: "codex_thread:thread-1", requiresApproval: true, mutates: false }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, externalWrite: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_resume_request_packet") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, schema: "lco.resumeRequestPacket.v1", targetRef: "codex_thread:thread-1", requiresApproval: true, mutates: false } }));
    process.exit(0);
  }
  if (name === "loo_codex_app_server_status") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, schema: "lco.codex.appServerStatus.v1", readOnly: true, sourceCoverage: { codexAppServer: "partial" }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_codex_app_server_threads") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, schema: "lco.codex.appServerThreads.v1", sourceCoverage: { codexAppServer: "ok" }, threads: [{ appServerRef: "codex_app_thread:thread-1", threadId: "thread-1", sourceRef: "codex_thread:thread-1" }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_visible_codex_map") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, schema: "lco.visibleCodexSessionMap.v1", sourceCoverage: { indexedLco: "ok", visibleCodex: "not_configured", codexAppServer: "ok" }, items: [{ appServerRef: "codex_app_thread:thread-1", sourceRef: "codex_thread:thread-1", sessionCardRef: "codex_thread:thread-1", confidence: 0.86 }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_codex_desktop_coherence") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, schema: "lco.codexDesktopCoherence.v1", state: "cli_visible", visibility: { cli: "proven", desktop: "not_seen" }, target: { threadId: "thread-1", sourceRef: "codex_thread:thread-1" }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_codex_desktop_fallback_status") {
    const missingCoherence = !toolArgs.coherence;
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, schema: "lco.codex.desktopFallback.v1", target: { threadId: toolArgs.thread_id, sourceRef: toolArgs.source_ref }, fallback: { required: !missingCoherence, reason: missingCoherence ? "coherence_input_missing" : "desktop_visibility_not_proven" }, blockers: missingCoherence ? ["coherence_input_missing"] : [], nextToolCall: ${fallbackNextToolCallCode}, preferredBackend: "cua-driver", backends: [{ backend: "cua-driver", role: "preferred_background", status: "blocked" }, { backend: "peekaboo", role: "secondary_visible_fallback", status: "blocked", takesScreenWarning: true }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, screenshotCaptured: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_plan_state_pins") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, manualPins: [] } }));
    process.exit(0);
  }
  if (name === "loo_github_operating_items") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, items: [{ id: "100yenadmin/Lossless-Codex-Orchestrator-LCO#264", kind: "pr", state: "red", reasonCodes: ["ci_failed"] }], sourceCoverage: { github: "ok" }, actionsPerformed: { githubWriteRun: false, liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_project_digest" || name === "loo_attention_inbox") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, sourceCoverage: { lco: "ok", github: "not_configured", plan_state: "not_configured" }, cards: [] } }));
    process.exit(0);
  }
  if (name === "loo_business_pulse") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, digest: { sourceCoverage: { lco: "ok", github: "not_configured", plan_state: "not_configured" } } } }));
    process.exit(0);
  }
  if (name === "loo_codex_control_dry_run") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: ${dryRunOutputCode} }));
    process.exit(0);
  }
}
console.error("unexpected fake OpenClaw call");
process.exit(7);
`);
  chmodSync(bin, 0o755);
  return { bin, callsPath };
}

function createScopeUpgradeFakeOpenClaw(dir: string): { bin: string; callsPath: string } {
  const callsPath = join(dir, "calls.jsonl");
  const bin = join(dir, "openclaw-scope-upgrade-fake.mjs");
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const callIndex = args.indexOf("call");
const method = callIndex >= 0 ? args[callIndex + 1] : "";
const paramsIndex = args.indexOf("--params");
const params = paramsIndex >= 0 ? JSON.parse(args[paramsIndex + 1] || "{}") : {};
appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify({ method, params, args, envTokenPresent: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN) }) + "\\n");
if (method === "tools.catalog") {
  console.log(JSON.stringify({ groups: [{ tools: ${JSON.stringify(DEFAULT_REQUIRED_TOOL_CALLS.map((id) => ({ id })))} }] }));
  process.exit(0);
}
if (method === "tools.invoke") {
  console.error("gateway connect failed: GatewayClientRequestError: scope upgrade pending approval (requestId: req-123)");
  process.exit(1);
}
process.exit(7);
`);
  chmodSync(bin, 0o755);
  return { bin, callsPath };
}

function createGatewayAuthFailureFakeOpenClaw(dir: string, failureText: string): { bin: string; callsPath: string } {
  const callsPath = join(dir, "calls.jsonl");
  const bin = join(dir, "openclaw-auth-failure-fake.mjs");
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const callIndex = args.indexOf("call");
const method = callIndex >= 0 ? args[callIndex + 1] : "";
const paramsIndex = args.indexOf("--params");
const params = paramsIndex >= 0 ? JSON.parse(args[paramsIndex + 1] || "{}") : {};
appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify({ method, params, args, envTokenPresent: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN) }) + "\\n");
if (method === "tools.catalog") {
  console.log(JSON.stringify({ groups: [{ tools: [{ id: "loo_doctor" }] }] }));
  process.exit(0);
}
if (method === "tools.invoke") {
  console.error(${JSON.stringify(failureText)});
  process.exit(1);
}
process.exit(7);
`);
  chmodSync(bin, 0o755);
  return { bin, callsPath };
}

function createMixedSetupAndToolFailureFakeOpenClaw(dir: string): { bin: string; callsPath: string } {
  const callsPath = join(dir, "calls.jsonl");
  const bin = join(dir, "openclaw-mixed-failure-fake.mjs");
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const callIndex = args.indexOf("call");
const method = callIndex >= 0 ? args[callIndex + 1] : "";
const paramsIndex = args.indexOf("--params");
const params = paramsIndex >= 0 ? JSON.parse(args[paramsIndex + 1] || "{}") : {};
appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify({ method, params, args, envTokenPresent: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN) }) + "\\n");
if (method === "tools.catalog") {
  console.log(JSON.stringify({ tools: [{ name: "loo_gateway_refused" }, { name: "loo_needs_credentials" }] }));
  process.exit(0);
}
if (method === "tools.invoke" && params.name === "loo_gateway_refused") {
  console.log(JSON.stringify({ ok: false, toolName: params.name, source: "plugin", error: { code: "forbidden", message: "super-secret-transcript-span" } }));
  process.exit(0);
}
if (method === "tools.invoke" && params.name === "loo_needs_credentials") {
  console.error("gateway tools.invoke requires credentials before opening a websocket");
  process.exit(1);
}
process.exit(7);
`);
  chmodSync(bin, 0o755);
  return { bin, callsPath };
}

function createInvalidCatalogFakeOpenClaw(dir: string): { bin: string; callsPath: string } {
  const callsPath = join(dir, "calls.jsonl");
  const bin = join(dir, "openclaw-invalid-catalog-fake.mjs");
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const callIndex = args.indexOf("call");
const method = callIndex >= 0 ? args[callIndex + 1] : "";
appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify({ method, args }) + "\\n");
if (method === "tools.catalog") {
  process.stdout.write("not json");
  process.exit(0);
}
process.exit(7);
`);
  chmodSync(bin, 0o755);
  return { bin, callsPath };
}

function createSlowCatalogFakeOpenClaw(dir: string): { bin: string; callsPath: string } {
  const callsPath = join(dir, "calls.jsonl");
  const bin = join(dir, "openclaw-slow-catalog-fake.mjs");
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const callIndex = args.indexOf("call");
const method = callIndex >= 0 ? args[callIndex + 1] : "";
const paramsIndex = args.indexOf("--params");
const params = paramsIndex >= 0 ? JSON.parse(args[paramsIndex + 1] || "{}") : {};
appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify({ method, params, args }) + "\\n");
if (method === "tools.catalog") {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log(JSON.stringify({ tools: [{ name: "loo_doctor" }] }));
  process.exit(0);
}
if (method === "tools.invoke") {
  console.log(JSON.stringify({ ok: true, toolName: params.name, output: { ok: true } }));
  process.exit(0);
}
process.exit(7);
`);
  chmodSync(bin, 0o755);
  return { bin, callsPath };
}

test("OpenClaw tool smoke invokes required loo tools through gateway call and writes public-safe evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, DEFAULT_REQUIRED_TOOL_CALLS);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-80",
      sessionKey: "agent:main:lco-issue-80",
      evidencePath,
      query: "Proposed plan"
    });

    assert.equal(report.ok, true);
    assert.equal(report.toolSmokeReady, true);
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(report.setupStatus, {
      classification: "ready",
      packageInstallLikelyOk: true,
      recoverable: false,
      retryAfterSetup: false,
      doesNotIndicatePackageFailure: true
    });
    assert.equal(report.catalog.requiredToolsPresent, true);
    assert.deepEqual(report.invocations.map((call) => call.toolName), DEFAULT_REQUIRED_TOOL_CALLS);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_search_sessions")?.summary.sourceRefs?.[0], "codex_thread:thread-1");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_describe_session")?.summary.threadId, "thread-1");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_expand_query")?.summary.profile, "brief");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_codex_control_dry_run")?.summary.live, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_codex_control_dry_run")?.summary.approvalAuditId, "loo_audit_test");
    assert.equal(report.agentReasoning?.safeRecommendation, "Review the selected Codex session from source refs, then ask the user before any live Codex control.");
    assert.equal(report.agentReasoning?.selectedThreadId, "thread-1");
    assert.deepEqual(report.agentReasoning?.sourceRefs, ["codex_thread:thread-1"]);
    assert.deepEqual(report.agentReasoning?.workflowEvidence, [
      "doctor_ready",
      "search_source_ref",
      "describe_thread",
      "bounded_expand",
      "plan_lookup",
      "final_message_lookup",
      "touched_files_lookup",
      "dry_run_audit"
    ]);
    assert.equal(report.agentReasoning?.dryRunApprovalAuditId, "loo_audit_test");
    assert.equal(report.agentReasoning?.dryRunLive, false);
    assert.equal(report.agentReasoning?.rawTranscriptRead, false);
    assert.equal(report.actionsPerformed.liveCodexControlRun, false);
    assert.equal(report.actionsPerformed.channelDelivery, false);
    assert.equal(report.command.includes(dir), false);
    assert.equal(report.evidencePath, "<redacted-local-path>/tool-smoke.json");
    assert.equal(existsSync(evidencePath), true);
    assert.doesNotMatch(JSON.stringify(report), /super-secret-transcript-span|Harmless beta smoke/);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> }; args: string[] });
    assert.equal(calls[0]?.method, "tools.catalog");
    assert.deepEqual(calls.slice(1).map((call) => call.params.name), report.invocations.map((call) => call.toolName));
    assert.equal(calls.find((call) => call.params.name === "loo_describe_session")?.params.args?.thread_id, "thread-1");
    assert.equal(calls.some((call) => call.args.includes("--token")), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke avoids OpenClaw dev/profile flag conflict", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-dev-profile-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_doctor"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      dev: true,
      profile: "lco-dogfood",
      evidencePath,
      requiredTools: ["loo_doctor"]
    });

    assert.equal(report.ok, true);
    assert.doesNotMatch(report.command, /--dev/);
    assert.match(report.command, /--profile lco-dogfood/);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[] });
    assert.equal(calls.length > 0, true);
    assert.equal(calls.every((call) => !call.args.includes("--dev")), true);
    assert.equal(calls.every((call) => call.args.includes("--profile")), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke passes discovered thread id to loo_expand_session", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-expand-session-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, [
    "loo_search_sessions",
    "loo_expand_session"
  ]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-192",
      sessionKey: "agent:main:lco-issue-192",
      evidencePath,
      requiredTools: ["loo_search_sessions", "loo_expand_session"],
      query: "Proposed plan"
    });

    assert.equal(report.ok, true);
    assert.equal(report.toolSmokeReady, true);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_expand_session")?.summary.threadId, "thread-1");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_expand_session")?.summary.profile, "brief");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_expand_session")?.summary.tokenBudget, 1000);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span|thread_id is required/);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    assert.equal(calls.find((call) => call.params.name === "loo_expand_session")?.params.args?.thread_id, "thread-1");
    assert.equal(calls.find((call) => call.params.name === "loo_expand_session")?.params.args?.profile, "brief");
    assert.equal(calls.find((call) => call.params.name === "loo_expand_session")?.params.args?.token_budget, 1000);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke requires target before desktop coherence smoke", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-desktop-coherence-target-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_desktop_coherence"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-307",
      sessionKey: "agent:main:lco-issue-307",
      evidencePath,
      requiredTools: ["loo_codex_desktop_coherence"]
    });

    assert.equal(report.ok, false);
    assert.deepEqual(report.blockers, ["openclaw_tool_smoke_missing_thread_ref"]);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string } });
    assert.equal(calls.some((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_desktop_coherence"), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke passes target and coherence fixture to desktop fallback status", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-desktop-fallback-status-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_desktop_fallback_status"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-308",
      sessionKey: "agent:main:lco-issue-308",
      evidencePath,
      requiredTools: ["loo_codex_desktop_fallback_status"],
      threadId: "thread-1"
    });

    assert.equal(report.ok, true);
    assert.deepEqual(report.blockers, []);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    const invoke = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_desktop_fallback_status");
    assert.equal(invoke?.params.args?.thread_id, "thread-1");
    assert.equal(invoke?.params.args?.source_ref, "codex_thread:thread-1");
    assert.deepEqual(invoke?.params.args?.coherence, {
      state: "cli_visible",
      visibility: {
        cli: "proven",
        desktop: "not_seen"
      },
      confidence: 0.72
    });
    assert.equal(invoke?.params.args?.include_visible_snapshot, false);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke invokes collaboration cockpit through the gateway surface", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-collaboration-cockpit-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_collaboration_cockpit"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-313",
      sessionKey: "agent:main:lco-issue-313",
      evidencePath,
      requiredTools: ["loo_codex_collaboration_cockpit"],
      threadId: "thread-1"
    });

    assert.equal(report.ok, true);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.invocations[0]?.toolName, "loo_codex_collaboration_cockpit");
    assert.equal(report.invocations[0]?.summary.count, 1);
    assert.equal(report.invocations[0]?.summary.threadId, "codex_thread:thread-1");
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    const invoke = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_collaboration_cockpit");
    assert.ok(invoke);
    assert.equal(Array.isArray(invoke.params.args?.watcher_specs), true);
    assert.equal(Array.isArray(invoke.params.args?.desktop_coherence_reports), true);
    assert.equal(Array.isArray(invoke.params.args?.desktop_fallback_reports), true);
    assert.equal((invoke.params.args?.desktop_coherence_reports as Array<{ target?: { threadId?: string } }>)[0]?.target?.threadId, "thread-1");
    assert.equal((invoke.params.args?.desktop_fallback_reports as Array<{ target?: { threadId?: string } }>)[0]?.target?.threadId, "thread-1");
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke can exercise desktop fallback status without a supplied coherence fixture", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-desktop-fallback-no-coherence-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_desktop_fallback_status"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-315",
      sessionKey: "agent:main:lco-issue-315",
      evidencePath,
      requiredTools: ["loo_codex_desktop_fallback_status"],
      threadId: "thread-1",
      desktopFallbackCoherence: "omit"
    });

    assert.equal(report.ok, true);
    assert.deepEqual(report.blockers, []);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    const invoke = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_desktop_fallback_status");
    assert.equal(invoke?.params.args?.thread_id, "thread-1");
    assert.equal(invoke?.params.args?.source_ref, "codex_thread:thread-1");
    assert.equal("coherence" in (invoke?.params.args ?? {}), false);
    const fallbackInvocation = report.invocations.find((invocation) => invocation.toolName === "loo_codex_desktop_fallback_status");
    assert.deepEqual(fallbackInvocation?.summary.nextToolCall, {
      tool: "loo_codex_desktop_coherence",
      args: {
        thread_id: "thread-1",
        source_ref: "codex_thread:thread-1"
      }
    });
    const evidence = readFileSync(evidencePath, "utf8");
    assert.match(evidence, /coherence_input_missing/);
    assert.match(evidence, /loo_codex_desktop_coherence/);
    assert.match(evidence, /codex_thread:thread-1/);
    assert.doesNotMatch(evidence, /super-secret-transcript-span/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke blocks strict fallback status when missing-coherence handoff is absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-desktop-fallback-missing-handoff-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_desktop_fallback_status"], "flat", { omitFallbackNextToolCall: true });

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-315",
      sessionKey: "agent:main:lco-issue-315",
      evidencePath,
      requiredTools: ["loo_codex_desktop_fallback_status"],
      threadId: "thread-1",
      desktopFallbackCoherence: "omit",
      strict: true
    });

    assert.equal(report.ok, false);
    assert.ok(report.blockers.includes("desktop_fallback_next_tool_call_missing"));
    assert.equal(report.invocations.find((invocation) => invocation.toolName === "loo_codex_desktop_fallback_status")?.summary.fallbackReason, "coherence_input_missing");
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke exposes omitted desktop fallback coherence through the CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-cli-desktop-fallback-no-coherence-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_desktop_fallback_status"]);
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "openclaw",
    "tool-smoke",
    "--openclaw-bin",
    bin,
    "--profile",
    "lco-issue-315-cli",
    "--session-key",
    "agent:main:lco-issue-315-cli",
    "--evidence-path",
    evidencePath,
    "--required-tool",
    "loo_codex_desktop_fallback_status",
    "--thread-id",
    "thread-1",
    "--desktop-fallback-coherence",
    "omit",
    "--strict"
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCLAW_FAKE_CALLS: callsPath
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
  const invoke = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_desktop_fallback_status");
  assert.equal(invoke?.params.args?.thread_id, "thread-1");
  assert.equal("coherence" in (invoke?.params.args ?? {}), false);
  assert.match(readFileSync(evidencePath, "utf8"), /coherence_input_missing/);
});

test("OpenClaw tool smoke rejects omitted desktop fallback coherence when fallback status is not invoked", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "openclaw",
    "tool-smoke",
    "--desktop-fallback-coherence",
    "omit",
    "--strict"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires --required-tool loo_codex_desktop_fallback_status/);
});

test("OpenClaw tool smoke accepts gateway content/details wrapped dry-run proof", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-wrapped-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, DEFAULT_REQUIRED_TOOL_CALLS, "flat", { dryRunOutputShape: "both" });

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "default",
      sessionKey: "agent:main:lco-issue-80",
      evidencePath,
      query: "Proposed plan"
    });

    const dryRun = report.invocations.find((call) => call.toolName === "loo_codex_control_dry_run");
    assert.equal(report.ok, true);
    assert.equal(report.blockers.includes("openclaw_control_dry_run_not_proven"), false);
    assert.equal(dryRun?.summary.live, false);
    assert.equal(dryRun?.summary.approvalAuditId, "loo_audit_test");
    assert.equal(dryRun?.summary.paramsHash, "params-hash");
    assert.equal(dryRun?.summary.messageHash, "message-hash");
    assert.equal(dryRun?.summary.method, "turn/start");
    assert.equal(dryRun?.summary.action, "codex_send_message");
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /Harmless beta smoke/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke accepts gateway content-only dry-run proof", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-content-only-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, DEFAULT_REQUIRED_TOOL_CALLS, "flat", { dryRunOutputShape: "content" });

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "default",
      sessionKey: "agent:main:lco-issue-80",
      evidencePath,
      query: "Proposed plan"
    });

    const dryRun = report.invocations.find((call) => call.toolName === "loo_codex_control_dry_run");
    assert.equal(report.ok, true);
    assert.equal(report.blockers.includes("openclaw_control_dry_run_not_proven"), false);
    assert.equal(dryRun?.summary.live, false);
    assert.equal(dryRun?.summary.approvalAuditId, "loo_audit_test");
    assert.equal(dryRun?.summary.paramsHash, "params-hash");
    assert.equal(dryRun?.summary.messageHash, "message-hash");
    assert.equal(dryRun?.summary.method, "turn/start");
    assert.equal(dryRun?.summary.action, "codex_send_message");
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /Harmless beta smoke/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke passes gateway token through call argv and keeps evidence redacted", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-token-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_doctor"]);
  const previousCalls = process.env.OPENCLAW_FAKE_CALLS;
  const previousToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  delete process.env.OPENCLAW_GATEWAY_TOKEN;
  try {
    runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-80",
      requiredTools: ["loo_doctor"],
      token: "test-gateway-token",
      gatewayTimeoutMs: 12345,
      evidencePath
    });

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; envTokenPresent?: boolean });
    assert.equal(calls.every((call) => call.envTokenPresent === true), true);
    assert.equal(calls.every((call) => call.args.includes("--token")), true);
    assert.equal(calls.every((call) => call.args[call.args.indexOf("--token") + 1] === "test-gateway-token"), true);
    assert.equal(calls.every((call) => call.args.includes("--timeout")), true);
    assert.equal(calls.every((call) => call.args[call.args.indexOf("--timeout") + 1] === "12345"), true);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /test-gateway-token/);
    assert.doesNotMatch(JSON.stringify(runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-80",
      requiredTools: ["loo_doctor"],
      token: "test-gateway-token"
    })), /test-gateway-token/);
  } finally {
    if (previousCalls === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previousCalls;
    if (previousToken === undefined) delete process.env.OPENCLAW_GATEWAY_TOKEN;
    else process.env.OPENCLAW_GATEWAY_TOKEN = previousToken;
  }
});

test("OpenClaw tool smoke uses ambient gateway token for call-mode auth", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-env-token-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_doctor"]);
  const previousCalls = process.env.OPENCLAW_FAKE_CALLS;
  const previousToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  process.env.OPENCLAW_GATEWAY_TOKEN = "ambient-gateway-token";
  try {
    runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-106",
      requiredTools: ["loo_doctor"]
    });

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[] });
    assert.equal(calls.every((call) => call.args.includes("--token")), true);
    assert.equal(calls.every((call) => call.args[call.args.indexOf("--token") + 1] === "ambient-gateway-token"), true);
  } finally {
    if (previousCalls === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previousCalls;
    if (previousToken === undefined) delete process.env.OPENCLAW_GATEWAY_TOKEN;
    else process.env.OPENCLAW_GATEWAY_TOKEN = previousToken;
  }
});

test("OpenClaw tool smoke reports catalog parse failure without synthetic missing-tool blockers", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-invalid-catalog-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createInvalidCatalogFakeOpenClaw(dir);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      evidencePath,
      requiredTools: ["loo_doctor", "loo_search_sessions"]
    });

    assert.deepEqual(report.blockers, ["openclaw_catalog_invalid_json"]);
    assert.deepEqual(report.catalog.missingRequiredTools, []);
    assert.equal(report.catalog.requiredToolsPresent, false);
    assert.deepEqual(report.setupStatus, {
      classification: "gateway_blocked",
      packageInstallLikelyOk: false,
      recoverable: false,
      retryAfterSetup: false,
      doesNotIndicatePackageFailure: false
    });
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke times out stalled gateway calls", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-timeout-"));
  const { bin, callsPath } = createSlowCatalogFakeOpenClaw(dir);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const startedAt = Date.now();
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_doctor"],
      gatewayTimeoutMs: 50
    });

    assert.equal(Date.now() - startedAt < 1000, true);
    assert.deepEqual(report.blockers, ["openclaw_catalog_failed"]);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke reads grouped tools.catalog output from the real gateway shape", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-groups-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, DEFAULT_REQUIRED_TOOL_CALLS, "groups");

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-80",
      sessionKey: "agent:main:lco-issue-80",
      evidencePath,
      query: "Proposed plan"
    });

    assert.equal(report.toolSmokeReady, true);
    assert.equal(report.catalog.toolCount, DEFAULT_REQUIRED_TOOL_CALLS.length);
    assert.deepEqual(report.catalog.missingRequiredTools, []);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke strict mode fails closed when catalog omits required loo tools", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-missing-"));
  const evidencePath = join(dir, "fresh", "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_doctor", "loo_search_sessions"]);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "openclaw",
      "tool-smoke",
      "--openclaw-bin",
      bin,
      "--profile",
      "lco-issue-80",
      "--evidence-path",
      evidencePath,
      "--strict"
    ], { encoding: "utf8" });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(existsSync(evidencePath), true);
    const report = JSON.parse(readFileSync(evidencePath, "utf8")) as { blockers?: string[]; publicSafe?: boolean };
    assert.deepEqual(report.blockers, ["openclaw_catalog_missing_required_tools"]);
    assert.equal(report.publicSafe, true);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span|Harmless beta smoke/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke does not mask mixed setup and tool-defect blockers as setup-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-mixed-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createMixedSetupAndToolFailureFakeOpenClaw(dir);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-216",
      sessionKey: "agent:main:lco-issue-216",
      evidencePath,
      requiredTools: ["loo_gateway_refused", "loo_needs_credentials"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.match(report.blockers.join("\n"), /openclaw_tool_result_not_ok:loo_gateway_refused:forbidden/);
    assert.match(report.blockers.join("\n"), /openclaw_gateway_credentials_required:loo_needs_credentials/);
    assert.deepEqual(report.setupBlockers, ["fresh_profile_gateway_credentials_required"]);
    assert.deepEqual(report.setupStatus, {
      classification: "gateway_blocked",
      packageInstallLikelyOk: false,
      recoverable: false,
      retryAfterSetup: false,
      doesNotIndicatePackageFailure: false
    });
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span|requires credentials before opening a websocket/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke fails closed when tools.invoke returns ok false in a successful envelope", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-ok-false-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_gateway_refused"]);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-80",
      sessionKey: "agent:main:lco-issue-80",
      evidencePath,
      requiredTools: ["loo_gateway_refused"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.deepEqual(report.blockers, ["openclaw_tool_result_not_ok:loo_gateway_refused:forbidden"]);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span|forbidden message|Harmless beta smoke/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke fails closed when plugin output details return ok false", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-details-ok-false-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_plugin_details_refused"]);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-160",
      sessionKey: "agent:main:lco-issue-160",
      evidencePath,
      requiredTools: ["loo_plugin_details_refused"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.deepEqual(report.blockers, ["openclaw_tool_result_not_ok:loo_plugin_details_refused"]);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span|Harmless beta smoke/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke uses a fresh idempotency key prefix for each smoke run", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-idempotency-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_doctor", "loo_search_sessions"]);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-80",
      requiredTools: ["loo_doctor", "loo_search_sessions"]
    });
    runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-80",
      requiredTools: ["loo_doctor", "loo_search_sessions"]
    });

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { idempotencyKey?: string } });
    const invokeKeys = calls.filter((call) => call.method === "tools.invoke").map((call) => call.params.idempotencyKey);
    assert.equal(invokeKeys.length, 4);
    assert.match(invokeKeys[0] || "", /^loo-tool-smoke-[0-9a-f-]+-loo_doctor$/);
    assert.match(invokeKeys[1] || "", /^loo-tool-smoke-[0-9a-f-]+-loo_search_sessions$/);
    const firstRunPrefix = invokeKeys[0]?.replace(/-loo_doctor$/, "");
    const firstRunSecondPrefix = invokeKeys[1]?.replace(/-loo_search_sessions$/, "");
    const secondRunPrefix = invokeKeys[2]?.replace(/-loo_doctor$/, "");
    assert.equal(firstRunPrefix, firstRunSecondPrefix);
    assert.notEqual(firstRunPrefix, secondRunPrefix);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke classifies gateway scope-upgrade blocks without storing raw stderr", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-scope-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createScopeUpgradeFakeOpenClaw(dir);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-80",
      sessionKey: "agent:main:lco-issue-80",
      evidencePath,
      threadId: "thread-1"
    });

    assert.equal(report.toolSmokeReady, false);
    assert.match(report.blockers.join("\n"), /openclaw_gateway_scope_upgrade_pending:loo_doctor/);
    assert.match(report.nextAction, /scope approval/i);
    assert.equal(report.blockers.includes("openclaw_control_dry_run_not_proven"), false);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /GatewayClientRequestError|requestId: req-123/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke classifies gateway device and credential blockers without storing raw stderr", () => {
  const cases = [
    {
      failureText: "gateway connect failed: device identity required",
      expectedBlocker: "openclaw_gateway_device_identity_required:loo_doctor",
      rawLeak: /device identity required/,
      expectedNextAction: /pair or approve/i
    },
    {
      failureText: "unauthorized: device token mismatch (rotate/reissue device token)",
      expectedBlocker: "openclaw_gateway_device_token_mismatch:loo_doctor",
      rawLeak: /device token mismatch/,
      expectedNextAction: /(rotate|reissue).*(current token)/i
    },
    {
      failureText: "gateway tools.invoke requires credentials before opening a websocket",
      expectedBlocker: "openclaw_gateway_credentials_required:loo_doctor",
      rawLeak: /requires credentials before opening a websocket/,
      expectedNextAction: /(?=.*credentials)(?=.*loopback token-auth gateway)/i
    }
  ];

  for (const testCase of cases) {
    const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-auth-"));
    const evidencePath = join(dir, "tool-smoke.json");
    const { bin, callsPath } = createGatewayAuthFailureFakeOpenClaw(dir, testCase.failureText);
    const previous = process.env.OPENCLAW_FAKE_CALLS;
    process.env.OPENCLAW_FAKE_CALLS = callsPath;
    try {
      const report = runOpenClawToolSmoke({
        openclawBin: bin,
        profile: "lco-issue-85",
        sessionKey: "agent:main:lco-issue-85",
        evidencePath,
        requiredTools: ["loo_doctor"]
      });

      assert.equal(report.toolSmokeReady, false);
      assert.deepEqual(report.blockers, [testCase.expectedBlocker]);
      assert.match(report.nextAction, testCase.expectedNextAction);
      assert.doesNotMatch(readFileSync(evidencePath, "utf8"), testCase.rawLeak);
    } finally {
      if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
      else process.env.OPENCLAW_FAKE_CALLS = previous;
    }
  }
});

test("OpenClaw tool smoke marks missing gateway credentials as first-run setup blockers", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-fresh-profile-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createGatewayAuthFailureFakeOpenClaw(
    dir,
    "gateway tools.catalog requires credentials before opening a websocket"
  );
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-fresh-profile",
      sessionKey: "agent:main:lco-fresh-profile",
      evidencePath,
      requiredTools: ["loo_doctor"]
    }) as ReturnType<typeof runOpenClawToolSmoke> & {
      setupBlockers?: string[];
      setupGuidance?: string[];
    };

    assert.equal(report.toolSmokeReady, false);
    assert.deepEqual(report.blockers, ["openclaw_gateway_credentials_required:loo_doctor"]);
    assert.deepEqual(report.setupBlockers, ["fresh_profile_gateway_credentials_required"]);
    assert.deepEqual(report.setupStatus, {
      classification: "gateway_setup_required",
      packageInstallLikelyOk: true,
      recoverable: true,
      retryAfterSetup: true,
      doesNotIndicatePackageFailure: true
    });
    assert.match(report.nextAction, /profile/i);
    assert.match(report.nextAction, /token/i);
    assert.match(report.setupGuidance?.join("\n") || "", /profile/i);
    assert.equal(report.actionsPerformed.broadGatewayScopeApproval, false);
    const saved = readFileSync(evidencePath, "utf8");
    assert.match(saved, /fresh_profile_gateway_credentials_required/);
    assert.doesNotMatch(saved, /requires credentials before opening a websocket/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});
