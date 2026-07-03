import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabase } from "../packages/core/src/index.js";
import { LOO_COMMAND_POLICY, createAuditStore, createCodexControl } from "../packages/adapters/src/index.js";
import { createLooToolDeclarations, createLooTools } from "../packages/mcp-server/src/tools.js";

test("Codex control requires dry-run audit before live message, steer, resume, or interrupt", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const calls: Array<{ method: string; params: unknown }> = [];
  const control = createCodexControl({
    audit,
    client: {
      request: async (method, params) => {
        calls.push({ method, params });
        return { ok: true };
      }
    }
  });

  try {
    const dryRun = await control.sendMessage({
      threadId: "thr_1",
      message: "continue",
      dryRun: true
    });
    assert.equal(dryRun.live, false);
    assert.match(dryRun.approvalAuditId, /^loo_audit_/);
    assert.match(dryRun.paramsHash, /^[a-f0-9]{64}$/);
    assert.match(dryRun.messageHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(dryRun.messageHash, audit.fingerprintText("continue"));
    assert.notEqual(dryRun.messageHash, sha256("continue"));
    assert.equal(calls.length, 0);

    const repeatedDryRun = await control.sendMessage({
      threadId: "thr_1",
      message: "continue",
      dryRun: true
    });
    assert.equal(repeatedDryRun.messageHash, dryRun.messageHash);

    await assert.rejects(
      () => control.sendMessage({ threadId: "thr_1", message: "continue", dryRun: false }),
      /approval_audit_id is required/
    );
    appendFileSync(audit.path, `${JSON.stringify({
      id: "loo_audit_expired",
      action: dryRun.action,
      target: dryRun.threadId,
      paramsHash: dryRun.paramsHash,
      messageHash: dryRun.messageHash,
      live: false,
      createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString()
    })}\n`);
    await assert.rejects(
      () => control.sendMessage({
        threadId: "thr_1",
        message: "continue",
        dryRun: false,
        approvalAuditId: "loo_audit_expired"
      }),
      /dry-run record expired/
    );
    assert.equal(calls.length, 0);

    await assert.rejects(
      () => control.sendMessage({
        threadId: "thr_1",
        message: "continue",
        dryRun: false,
        approvalAuditId: dryRun.approvalAuditId
      }),
      /same-connection control sequence/
    );
    assert.equal(calls.length, 0);

    const sequenceCalls: Array<Array<{ method: string; params: Record<string, unknown> }>> = [];
    const sequenceControl = createCodexControl({
      audit,
      client: {
        request: async (method, params) => {
          calls.push({ method, params });
          return { ok: true };
        },
        requestSequence: async (steps) => {
          sequenceCalls.push(steps);
          return steps.map((step) => ({ ok: true, method: step.method }));
        }
      }
    });
    const sequenceDryRun = await sequenceControl.sendMessage({
      threadId: "thr_1",
      message: "continue",
      dryRun: true
    });
    const live = await sequenceControl.sendMessage({
      threadId: "thr_1",
      message: "continue",
      dryRun: false,
      approvalAuditId: sequenceDryRun.approvalAuditId
    });
    assert.equal(live.live, true);
    assert.deepEqual(live.methodSequence, ["thread/resume", "turn/start"]);
    assert.deepEqual(sequenceCalls[0]?.map((step) => step.method), ["thread/resume", "turn/start"]);
    assert.deepEqual(sequenceCalls[0]?.[0]?.params, { threadId: "thr_1", excludeTurns: true });
    assert.deepEqual(sequenceCalls[0]?.[1]?.params, { threadId: "thr_1", input: [{ type: "text", text: "continue" }] });
    await assert.rejects(
      () => sequenceControl.sendMessage({
        threadId: "thr_1",
        message: "continue",
        dryRun: false,
        approvalAuditId: live.approvalAuditId
      }),
      /must reference a dry-run/
    );
    assert.equal(calls.length, 0);

    const resumeDryRun = await control.resumeThread({ threadId: "thr_1", dryRun: true });
    assert.equal(resumeDryRun.live, false);
    assert.match(resumeDryRun.paramsHash, /^[a-f0-9]{64}$/);
    assert.equal(resumeDryRun.messageHash, undefined);
    await control.resumeThread({ threadId: "thr_1", dryRun: false, approvalAuditId: resumeDryRun.approvalAuditId });
    assert.equal(calls[0]?.method, "thread/resume");

    assert.throws(
      () => control.steerThread({ threadId: "thr_1", message: "focus on tests", dryRun: true }),
      /expected_turn_id is required/
    );
    const steerDryRun = await control.steerThread({ threadId: "thr_1", message: "focus on tests", expectedTurnId: "turn_1", dryRun: true });
    assert.throws(
      () => control.steerThread({ threadId: "thr_1", message: "focus on tests", dryRun: false, approvalAuditId: steerDryRun.approvalAuditId }),
      /expected_turn_id is required/
    );
    await control.steerThread({ threadId: "thr_1", message: "focus on tests", expectedTurnId: "turn_1", dryRun: false, approvalAuditId: steerDryRun.approvalAuditId });
    assert.equal(calls[1]?.method, "turn/steer");
    assert.deepEqual(calls[1]?.params, { threadId: "thr_1", expectedTurnId: "turn_1", input: [{ type: "text", text: "focus on tests" }] });

    const interruptDryRun = await control.interruptThread({ threadId: "thr_1", dryRun: true });
    await control.interruptThread({ threadId: "thr_1", dryRun: false, approvalAuditId: interruptDryRun.approvalAuditId });
    assert.equal(calls[2]?.method, "turn/interrupt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex control redacts live transport responses before returning them through tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-redaction-"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const control = createCodexControl({
    audit,
    client: {
      request: async () => ({ ok: true }),
      requestSequence: async () => [
        { ok: true },
        { content: `authorization: ${homedir()}/secret sk-test_1234567890` }
      ]
    }
  });

  try {
    const dryRun = await control.sendMessage({ threadId: "thr_1", message: "continue", dryRun: true });
    const live = await control.sendMessage({
      threadId: "thr_1",
      message: "continue",
      dryRun: false,
      approvalAuditId: dryRun.approvalAuditId
    });

    assert.deepEqual(live.response, {
      content: "authorization: <redacted-secret>"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP tool registry exposes loo-prefixed tools with local-only control safety", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-mcp-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const tools = createLooTools({
    db,
    audit,
    codexClient: { request: async () => ({ ok: true }) }
  });

  try {
    const toolNames = tools.map((tool) => tool.name).sort();
    const declaredToolNames = createLooToolDeclarations().map((tool) => tool.name).sort();
    assert.deepEqual(declaredToolNames, toolNames);
    assert.equal(toolNames.includes("loo_index_sessions"), true);
    assert.equal(toolNames.includes("loo_grep"), true);
    assert.equal(toolNames.includes("loo_search_sessions"), true);
    assert.equal(toolNames.includes("loo_describe_ref"), true);
    assert.equal(toolNames.includes("loo_closeout_dry_run"), true);
    assert.equal(toolNames.includes("loo_codex_send_message"), true);
    assert.equal(toolNames.includes("loo_desktop_see"), true);
    assert.deepEqual(toolNames.filter((name) => !LOO_COMMAND_POLICY[name]), []);

    const closeoutTool = tools.find((tool) => tool.name === "loo_closeout_dry_run");
    assert.ok(closeoutTool);
    const closeoutReport = closeoutTool.execute({ limit: 5 }) as {
      dryRun: boolean;
      mutatesCodex: boolean;
      summary: { total: number };
    };
    assert.equal(closeoutReport.dryRun, true);
    assert.equal(closeoutReport.mutatesCodex, false);
    assert.equal(closeoutReport.summary.total, 0);

    db.prepare(`
      INSERT INTO codex_sessions (thread_id, title, source_path, indexed_at, safe_text, event_count, tool_call_count)
      VALUES (?, ?, ?, ?, '', 0, 0)
    `).run(
      "thr_unavailable_closeout",
      "Unavailable closeout seed",
      join(root, "seed.jsonl"),
      "2026-06-29T00:00:00Z"
    );
    const mappedCloseoutReport = closeoutTool.execute({
      thread_id: "thr_unavailable_closeout",
      include_unavailable: true
    }) as {
      dryRun: boolean;
      summary: { total: number; unavailable: number };
      candidates: Array<{ threadId: string; state: string; wouldAttach: boolean }>;
    };
    assert.equal(mappedCloseoutReport.dryRun, true);
    assert.equal(mappedCloseoutReport.summary.total, 1);
    assert.equal(mappedCloseoutReport.summary.unavailable, 1);
    assert.equal(mappedCloseoutReport.candidates[0]?.threadId, "thr_unavailable_closeout");
    assert.equal(mappedCloseoutReport.candidates[0]?.state, "unavailable");
    assert.equal(mappedCloseoutReport.candidates[0]?.wouldAttach, false);

    const sendTool = tools.find((tool) => tool.name === "loo_codex_send_message");
    assert.ok(sendTool);
    const dryRun = await sendTool.execute({ thread_id: "thr_1", message: "continue", dry_run: true }) as {
      live: boolean;
      approval_audit_id: string;
      params_hash: string;
      message_hash: string;
      approval_packet: {
        action: string;
        methodSequence: string[];
      };
    };
    assert.equal(dryRun.live, false);
    assert.match(dryRun.approval_audit_id, /^loo_audit_/);
    assert.match(dryRun.params_hash, /^[a-f0-9]{64}$/);
    assert.match(dryRun.message_hash, /^[a-f0-9]{64}$/);
    assert.equal(dryRun.message_hash, audit.fingerprintText("continue"));
    assert.notEqual(dryRun.message_hash, sha256("continue"));
    assert.equal(dryRun.approval_packet.action, "send_message");
    assert.deepEqual(dryRun.approval_packet.methodSequence, ["thread/resume", "turn/start"]);

    const dryRunTool = tools.find((tool) => tool.name === "loo_codex_control_dry_run");
    assert.ok(dryRunTool);
    const genericDryRun = await dryRunTool.execute({ action: "send", thread_id: "thr_1", message: "continue" }) as {
      approval_audit_id: string;
      params_hash: string;
      message_hash: string;
    };
    assert.match(genericDryRun.approval_audit_id, /^loo_audit_/);
    assert.match(genericDryRun.params_hash, /^[a-f0-9]{64}$/);
    assert.match(genericDryRun.message_hash, /^[a-f0-9]{64}$/);
    assert.equal(genericDryRun.message_hash, audit.fingerprintText("continue"));
    assert.notEqual(genericDryRun.message_hash, sha256("continue"));
    assert.equal(genericDryRun.message_hash, dryRun.message_hash);

    const steerTool = tools.find((tool) => tool.name === "loo_codex_steer_thread");
    assert.ok(steerTool);
    assert.ok((steerTool.inputSchema.properties as Record<string, unknown>).expected_turn_id);
    const dryRunToolSchema = dryRunTool.inputSchema.properties as Record<string, unknown>;
    assert.ok(dryRunToolSchema.expected_turn_id);
    assert.throws(
      () => steerTool.execute({ thread_id: "thr_1", message: "focus", dry_run: true }),
      /expected_turn_id is required/
    );

    appendFileSync(audit.path, "{malformed audit jsonl\n");

    const auditTailTool = tools.find((tool) => tool.name === "loo_audit_tail");
    assert.ok(auditTailTool);
    const auditTail = await auditTailTool.execute({ limit: 5 }) as {
      auditPath: string;
      records: Array<{ id: string; paramsHash: string; messageHash?: string }>;
    };
    assert.equal(auditTail.auditPath, audit.path);
    assert.equal(auditTail.records.some((record) => record.id === genericDryRun.approval_audit_id), true);
    assert.equal(auditTail.records.some((record) => record.paramsHash === genericDryRun.params_hash), true);
    assert.equal(JSON.stringify(auditTail).includes("continue"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP stdio server returns JSON-RPC errors for malformed input frames", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-mcp-stdio-"));
  const server = spawn(process.execPath, [
    "--import",
    "tsx",
    join(process.cwd(), "packages/mcp-server/src/server.ts")
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: root,
      LOO_DB_PATH: join(root, "orchestrator.sqlite"),
      LOO_AUDIT_PATH: join(root, "audit.jsonl"),
      LOO_CODEX_BIN: "loo-codex-not-needed-for-parse-error"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    const outputLine = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for MCP parse error response. stderr=${stderr}`));
      }, 5_000);
      const cleanup = () => {
        clearTimeout(timeout);
        server.stdout.off("data", onStdout);
        server.off("exit", onExit);
      };
      const onStdout = (chunk: string) => {
        stdout += chunk;
        const line = stdout.split("\n").find((candidate) => candidate.trim());
        if (line) {
          cleanup();
          resolve(line);
        }
      };
      const onExit = (code: number | null) => {
        cleanup();
        reject(new Error(`MCP server exited before parse error response. code=${code} stderr=${stderr}`));
      };
      server.stdout.on("data", onStdout);
      server.once("exit", onExit);
      server.stdin.write("{\n");
    });

    const response = JSON.parse(outputLine) as { jsonrpc?: string; id?: unknown; error?: { code?: number; message?: string } };
    assert.equal(response.jsonrpc, "2.0");
    assert.equal(response.id, null);
    assert.equal(response.error?.code, -32000);
    assert.match(response.error?.message ?? "", /JSON|Expected|Unexpected/i);
    assert.doesNotMatch(stderr, /Unhandled|uncaught|ERR_UNHANDLED/i);
  } finally {
    server.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Audit fingerprint key is memoized after first use", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-audit-key-"));
  const audit = createAuditStore(join(root, "audit.jsonl"));

  try {
    const first = audit.fingerprintText("continue");
    writeFileSync(`${audit.path}.key`, `${"0".repeat(64)}\n`);
    assert.equal(audit.fingerprintText("continue"), first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
