import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabase } from "../packages/core/src/index.js";
import { createAuditStore, createCodexControl } from "../packages/adapters/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";

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
    assert.equal(calls.length, 0);

    await assert.rejects(
      () => control.sendMessage({ threadId: "thr_1", message: "continue", dryRun: false }),
      /approval_audit_id is required/
    );

    const live = await control.sendMessage({
      threadId: "thr_1",
      message: "continue",
      dryRun: false,
      approvalAuditId: dryRun.approvalAuditId
    });
    assert.equal(live.live, true);
    assert.equal(calls[0]?.method, "turn/start");

    const resumeDryRun = await control.resumeThread({ threadId: "thr_1", dryRun: true });
    assert.equal(resumeDryRun.live, false);
    await control.resumeThread({ threadId: "thr_1", dryRun: false, approvalAuditId: resumeDryRun.approvalAuditId });
    assert.equal(calls[1]?.method, "thread/resume");

    const steerDryRun = await control.steerThread({ threadId: "thr_1", message: "focus on tests", dryRun: true });
    await control.steerThread({ threadId: "thr_1", message: "focus on tests", dryRun: false, approvalAuditId: steerDryRun.approvalAuditId });
    assert.equal(calls[2]?.method, "turn/steer");

    const interruptDryRun = await control.interruptThread({ threadId: "thr_1", dryRun: true });
    await control.interruptThread({ threadId: "thr_1", dryRun: false, approvalAuditId: interruptDryRun.approvalAuditId });
    assert.equal(calls[3]?.method, "turn/interrupt");
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
      request: async () => ({
        content: `authorization: ${process.env.HOME}/secret sk-test_1234567890`
      })
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
      content: "authorization: <redacted-secret> <redacted-secret>"
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
    assert.equal(toolNames.includes("loo_index_sessions"), true);
    assert.equal(toolNames.includes("loo_search_sessions"), true);
    assert.equal(toolNames.includes("loo_codex_send_message"), true);
    assert.equal(toolNames.includes("loo_desktop_see"), true);

    const sendTool = tools.find((tool) => tool.name === "loo_codex_send_message");
    assert.ok(sendTool);
    const dryRun = await sendTool.execute({ thread_id: "thr_1", message: "continue", dry_run: true }) as {
      live: boolean;
      approval_audit_id: string;
    };
    assert.equal(dryRun.live, false);
    assert.match(dryRun.approval_audit_id, /^loo_audit_/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
