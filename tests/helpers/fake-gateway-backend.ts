import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForJsonFile<T>(path: string, timeoutMs = 5000): T {
  const deadline = Date.now() + timeoutMs;
  let lastParseError: unknown;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, "utf8")) as T;
      } catch (error) {
        lastParseError = error;
      }
    }
    sleepSync(25);
  }
  if (lastParseError instanceof Error) {
    throw new Error(`Timed out waiting for valid JSON in ${path}: ${lastParseError.message}`);
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
        const names = [
          "loo_doctor",
          "loo_search_sessions",
          "loo_describe_ref",
          "loo_expand_session",
          "loo_codex_plans",
          "loo_codex_final_messages",
          "loo_codex_touched_files",
          "loo_codex_control_dry_run",
          "loo_codex_send_message",
          "loo_codex_resume_thread",
          "loo_codex_steer_thread",
          "loo_codex_interrupt_thread",
          "loo_audit_tail",
          "loo_codex_thread_map",
          "loo_describe_session",
          "loo_expand_query",
          "loo_drive"
        ];
        socket.write(encodeFrame({ type: "res", id: message.id, ok: true, payload: { tools: names.map((name) => ({ name })) } }));
        continue;
      }
      if (message.method === "tools.invoke") {
        const name = message.params.name;
        const args = message.params.args || {};
        let output = { ok: true, localOnly: true };
        if (name === "loo_search_sessions") output = [{ sourceRef: "codex_thread:backend-thread", threadId: "backend-thread", score: 10, safeSummary: "Post-action safe summary delta marker" }];
        if (name === "loo_describe_ref") output = { sourceRef: args.source_ref, threadId: "backend-thread" };
        if (name === "loo_expand_session") output = { sourceRef: "codex_thread:backend-thread", threadId: args.thread_id };
        if (name === "loo_codex_plans" || name === "loo_codex_final_messages") output = [{ sourceRef: "codex_thread:backend-thread" }];
        if (name === "loo_codex_touched_files") output = { files: [], count: 0 };
        if (name === "loo_codex_control_dry_run") output = {
          content: [{ type: "text", text: "redacted dry-run packet" }],
          details: {
            live: false,
            approvalAuditId: "loo_audit_bacced01",
            paramsHash: "a".repeat(64),
            messageHash: "b".repeat(64),
            expectedTurnId: args.expected_turn_id,
            expected_turn_id: args.expected_turn_id
          }
        };
        if (name === "loo_codex_send_message") output = { content: [{ type: "text", text: "redacted live packet" }], details: { live: true, approvalAuditId: "loo_audit_feed1234", paramsHash: "a".repeat(64), messageHash: "b".repeat(64), method: "turn/start", turn_status: "completed", proof_state: { completed: true }, response: { ok: true, turn: { status: "completed" } } } };
        if (name === "loo_codex_resume_thread") output = { content: [{ type: "text", text: "redacted live packet" }], details: { live: true, approvalAuditId: "loo_audit_feed1234", paramsHash: "a".repeat(64), method: "thread/resume", response: { ok: true } } };
        if (name === "loo_codex_steer_thread") output = { content: [{ type: "text", text: "redacted live packet" }], details: { live: true, approvalAuditId: "loo_audit_feed1234", paramsHash: "a".repeat(64), messageHash: "b".repeat(64), method: "turn/steer", expectedTurnId: args.expected_turn_id, response: { ok: true } } };
        if (name === "loo_codex_interrupt_thread") output = { content: [{ type: "text", text: "redacted live packet" }], details: { live: true, approvalAuditId: "loo_audit_feed1234", paramsHash: "a".repeat(64), method: "turn/interrupt", expectedTurnId: args.expected_turn_id, response: { ok: true } } };
        if (name === "loo_audit_tail") output = { records: [{ id: "loo_audit_bacced01", live: false, paramsHash: "a".repeat(64) }, { id: "loo_audit_feed1234", live: true, paramsHash: "a".repeat(64) }] };
        if (name === "loo_codex_thread_map") output = { targetRef: "codex_thread:backend-thread", statusBucket: "active", refreshedAt: "2026-07-01T00:02:00.000Z", sourceRefs: ["codex_thread:backend-thread"] };
        if (name === "loo_describe_session") output = { sourceRef: "codex_thread:backend-thread", safeSummary: "Post-action safe summary delta marker" };
        if (name === "loo_expand_query") output = { sourceRefs: ["codex_thread:backend-thread"], profile: "brief", text: "Safe post-action evidence bundle." };
        if (name === "loo_drive") output = {
          content: [{ type: "text", text: "redacted drive packet" }],
          details: {
            schema: "lco.drive.report.v1",
            status: "dry_run_ready",
            surface: "openclaw-gateway",
            dryRun: { live: false, approvalAuditId: "loo_audit_backend_drive", paramsHash: "backend-drive-params" },
            actionsPerformed: { liveControl: false, externalWrite: false }
          }
        };
        socket.write(encodeFrame({ type: "res", id: message.id, ok: true, payload: { ok: true, toolName: name, source: "plugin", output } }));
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

export function startFakeGatewayBackend(dir: string): { server: ChildProcess; port: number; capturePath: string } {
  const { serverPath, readyPath, capturePath } = createFakeGatewayBackend(dir);
  const server = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      LOO_FAKE_GATEWAY_READY: readyPath,
      LOO_FAKE_GATEWAY_CAPTURE: capturePath
    },
    stdio: "ignore"
  });
  const { port } = waitForJsonFile<{ port: number }>(readyPath);
  return { server, port, capturePath };
}
