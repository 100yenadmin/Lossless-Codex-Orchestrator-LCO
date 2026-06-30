import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createAuditStore } from "../packages/adapters/src/index.js";
import {
  defaultAppServerArgs,
  runLiveControlSmoke,
  type LiveControlSmokeClient
} from "../packages/cli/src/live-control-smoke.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

class FakeLiveControlSmokeClient implements LiveControlSmokeClient {
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  private nextThreadId = "thr_live_smoke";

  async connect(): Promise<void> {}

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.requests.push({ method, params });
    if (method === "thread/start") {
      return { ok: true, result: { thread: { id: this.nextThreadId, ephemeral: true } } };
    }
    if (method === "turn/start") {
      return { ok: true, result: { turn: { id: "turn_live_smoke", status: "inProgress" } } };
    }
    throw new Error(`unexpected method ${method}`);
  }

  async waitForTurnCompletion(): Promise<{ completed: boolean; status: string | null; notificationMethods: string[]; approvalRequestCount: number; serverRequestCount: number }> {
    return {
      completed: true,
      status: "completed",
      notificationMethods: ["thread/started", "turn/started", "turn/completed"],
      approvalRequestCount: 0,
      serverRequestCount: 0
    };
  }

  async close(): Promise<void> {}
}

test("live control smoke writes strict public-safe proof without raw prompt text", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-smoke-"));
  const client = new FakeLiveControlSmokeClient();
  const message = "LCO raw prompt that must never appear in evidence";

  try {
    const report = await runLiveControlSmoke({
      client,
      audit: createAuditStore(join(root, "audit.jsonl")),
      evidenceDir: root,
      message,
      now: "2026-06-30T00:00:00.000Z"
    });

    assert.equal(report.ok, true);
    assert.equal(report.proof.kind, "loo_approved_live_control_smoke");
    assert.equal(report.proof.approvedLiveControlSmoke, true);
    assert.equal(report.proof.action, "send");
    assert.equal(report.proof.targetRef, "codex_thread:thr_live_smoke");
    assert.match(report.proof.approvalAuditId, /^loo_audit_/);
    assert.match(report.proof.messageHash, /^[a-f0-9]{64}$/);
    assert.equal(report.proof.preservesCodexApprovalSemantics, true);
    assert.equal(report.proof.rawPromptIncluded, false);
    assert.deepEqual(Object.keys(report.proof).sort(), [
      "action",
      "approvalAuditId",
      "approvedLiveControlSmoke",
      "kind",
      "messageHash",
      "preservesCodexApprovalSemantics",
      "rawPromptIncluded",
      "targetRef"
    ].sort());

    const proofText = readFileSync(join(root, "approved-live-control-smoke.json"), "utf8");
    const reportText = readFileSync(join(root, "live-control-smoke-report.json"), "utf8");
    assert.doesNotMatch(proofText, /raw prompt/i);
    assert.doesNotMatch(reportText, /raw prompt/i);
    assert.equal(JSON.stringify(report).includes(message), false);

    assert.deepEqual(client.requests.map((request) => request.method), ["thread/start", "turn/start"]);
    assert.equal(client.requests[1]?.params.threadId, "thr_live_smoke");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("live control smoke fails closed when Codex requests approval during the harmless prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-smoke-approval-"));
  const client = new FakeLiveControlSmokeClient();
  client.waitForTurnCompletion = async () => ({
    completed: true,
    status: "completed",
    notificationMethods: ["execCommandApproval", "turn/completed"],
    approvalRequestCount: 1,
    serverRequestCount: 1
  });

  try {
    await assert.rejects(
      () => runLiveControlSmoke({
        client,
        audit: createAuditStore(join(root, "audit.jsonl")),
        evidenceDir: root,
        message: "Approval-triggering prompt"
      }),
      /approval request/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("live control smoke fails closed on unexpected server requests during the harmless prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-smoke-server-request-"));
  const client = new FakeLiveControlSmokeClient();
  client.waitForTurnCompletion = async () => ({
    completed: true,
    status: "completed",
    notificationMethods: ["tool/requestUserInput", "turn/completed"],
    approvalRequestCount: 0,
    serverRequestCount: 1
  });

  try {
    await assert.rejects(
      () => runLiveControlSmoke({
        client,
        audit: createAuditStore(join(root, "audit.jsonl")),
        evidenceDir: root,
        message: "Server request triggering prompt"
      }),
      /server request/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("live control smoke defaults to JSONL stdio app-server transport", () => {
  const original = process.env.LOO_CODEX_APP_SERVER_ARGS;
  delete process.env.LOO_CODEX_APP_SERVER_ARGS;
  try {
    assert.deepEqual(defaultAppServerArgs(), ["app-server", "--stdio"]);
  } finally {
    if (original === undefined) {
      delete process.env.LOO_CODEX_APP_SERVER_ARGS;
    } else {
      process.env.LOO_CODEX_APP_SERVER_ARGS = original;
    }
  }
});

test("CLI exposes the live-control smoke command without running it in help mode", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "codex",
    "live-control-smoke",
    "--help"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /loo codex live-control-smoke/i);
  assert.match(result.stdout, /approved-live-control-smoke\.json/i);
});
