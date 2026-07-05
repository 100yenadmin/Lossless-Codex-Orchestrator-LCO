import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runOpenClawGatewayLiveControlSmoke } from "../packages/cli/src/openclaw-live-control-smoke.js";
import { createScenarioSweep } from "../packages/cli/src/scenario-sweep.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
const PARAMS_HASH = "a".repeat(64);
const MESSAGE_HASH = "b".repeat(64);
const DRY_RUN_AUDIT_ID = "loo_audit_abcd1234";
const LIVE_AUDIT_ID = "loo_audit_def45678";

function createFakeOpenClaw(dir: string, options: {
  auditDetailsEnvelope?: boolean;
  liveResponseMissingOk?: boolean;
  liveTurnStatus?: string;
  liveResponseOkFalse?: boolean;
  mismatchedLiveMessageHash?: boolean;
  missingLiveTurnStatus?: boolean;
  resumeResponseMissingStatus?: boolean;
  resumeResponseOkFalse?: boolean;
  resumeMethod?: string;
  steerMethod?: string;
  interruptMethod?: string;
  mismatchedExpectedTurnId?: boolean;
} = {}): { bin: string; callsPath: string } {
  const callsPath = join(dir, "calls.jsonl");
  const bin = join(dir, "openclaw-live-fake.mjs");
  const liveMessageHash = options.mismatchedLiveMessageHash ? "c".repeat(64) : MESSAGE_HASH;
  const liveResponse = options.liveResponseOkFalse
    ? `{ ok: false, error: "thread not found: thr_gateway_live" }`
    : options.missingLiveTurnStatus
      ? `{ ok: true }`
      : options.liveResponseMissingOk
        ? `{ turn: { id: "turn_1", status: "${options.liveTurnStatus ?? "completed"}" } }`
      : `{ ok: true, turn: { id: "turn_1", status: "${options.liveTurnStatus ?? "completed"}" } }`;
  const resumeResponse = options.resumeResponseOkFalse
    ? `{ ok: false, error: "resume rejected" }`
    : options.resumeResponseMissingStatus
      ? `{ ok: true }`
      : `{ ok: true, status: "completed" }`;
  const resumeMethod = options.resumeMethod ?? "thread/resume";
  const steerMethod = options.steerMethod ?? "turn/steer";
  const interruptMethod = options.interruptMethod ?? "turn/interrupt";
  const liveExpectedTurnIdExpression = options.mismatchedExpectedTurnId ? `"turn_unexpected"` : "toolArgs.expected_turn_id";
  const auditTailPayload = `{
      auditPath: "metadata-only",
      records: [
        { id: "${DRY_RUN_AUDIT_ID}", live: false, paramsHash: "${PARAMS_HASH}" },
        { id: "${LIVE_AUDIT_ID}", live: true, paramsHash: "${PARAMS_HASH}" }
      ]
    }`;
  const auditTailResponse = options.auditDetailsEnvelope
    ? `{ ok: true, content: [{ type: "text", text: JSON.stringify(${auditTailPayload}) }], details: ${auditTailPayload} }`
    : `{ ok: true, output: ${auditTailPayload} }`;
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const callIndex = args.indexOf("call");
const method = callIndex >= 0 ? args[callIndex + 1] : "";
const paramsIndex = args.indexOf("--params");
const params = paramsIndex >= 0 ? JSON.parse(args[paramsIndex + 1] || "{}") : {};
appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify({ method, params, args }) + "\\n");
  if (method === "tools.catalog") {
  console.log(JSON.stringify({ groups: [{ tools: [
    { id: "loo_codex_control_dry_run" },
    { id: "loo_codex_send_message" },
    { id: "loo_codex_resume_thread" },
    { id: "loo_codex_steer_thread" },
    { id: "loo_codex_interrupt_thread" },
    { id: "loo_audit_tail" }
  ] }] }));
  process.exit(0);
}
if (method === "tools.invoke") {
  const name = params.name;
  const toolArgs = params.args || {};
  if (name === "loo_codex_control_dry_run") {
    const action = toolArgs.action === "resume" ? "codex_resume_thread" : toolArgs.action === "steer" ? "codex_steer_thread" : toolArgs.action === "interrupt" ? "codex_interrupt_thread" : "codex_send_message";
    const output = {
      action,
      threadId: toolArgs.thread_id,
      live: false,
      approvalAuditId: "${DRY_RUN_AUDIT_ID}",
      paramsHash: "${PARAMS_HASH}",
      method: toolArgs.action === "resume" ? "thread/resume" : toolArgs.action === "steer" ? "turn/steer" : toolArgs.action === "interrupt" ? "turn/interrupt" : "turn/start",
      approval_audit_id: "${DRY_RUN_AUDIT_ID}",
      params_hash: "${PARAMS_HASH}"
    };
    if (toolArgs.action === "steer" || toolArgs.action === "interrupt") {
      output.expectedTurnId = toolArgs.expected_turn_id;
      output.expected_turn_id = toolArgs.expected_turn_id;
    }
    if (toolArgs.action === "send" || toolArgs.action === "steer") {
      output.messageHash = "${MESSAGE_HASH}";
      output.message_hash = "${MESSAGE_HASH}";
    }
    console.log(JSON.stringify({ ok: true, output }));
    process.exit(0);
  }
  if (name === "loo_codex_send_message") {
    if (toolArgs.approval_audit_id !== "${DRY_RUN_AUDIT_ID}" || toolArgs.dry_run !== false) {
      console.log(JSON.stringify({ ok: false, error: { code: "approval_mismatch" } }));
      process.exit(0);
    }
    console.log(JSON.stringify({ ok: true, output: {
      action: "codex_send_message",
      threadId: toolArgs.thread_id,
      live: true,
      approvalAuditId: "${LIVE_AUDIT_ID}",
      paramsHash: "${PARAMS_HASH}",
      messageHash: "${liveMessageHash}",
      method: "turn/start",
      approval_audit_id: "${LIVE_AUDIT_ID}",
      params_hash: "${PARAMS_HASH}",
      message_hash: "${liveMessageHash}",
      response: ${liveResponse}
    } }));
    process.exit(0);
  }
  if (name === "loo_codex_resume_thread") {
    if (toolArgs.approval_audit_id !== "${DRY_RUN_AUDIT_ID}" || toolArgs.dry_run !== false) {
      console.log(JSON.stringify({ ok: false, error: { code: "approval_mismatch" } }));
      process.exit(0);
    }
    console.log(JSON.stringify({ ok: true, output: {
      action: "codex_resume_thread",
      threadId: toolArgs.thread_id,
      live: true,
      approvalAuditId: "${LIVE_AUDIT_ID}",
      paramsHash: "${PARAMS_HASH}",
      method: "${resumeMethod}",
      approval_audit_id: "${LIVE_AUDIT_ID}",
      params_hash: "${PARAMS_HASH}",
      response: ${resumeResponse}
    } }));
    process.exit(0);
  }
  if (name === "loo_codex_steer_thread") {
    if (toolArgs.approval_audit_id !== "${DRY_RUN_AUDIT_ID}" || toolArgs.dry_run !== false || !toolArgs.expected_turn_id) {
      console.log(JSON.stringify({ ok: false, error: { code: "approval_or_turn_mismatch" } }));
      process.exit(0);
    }
    console.log(JSON.stringify({ ok: true, output: {
      action: "codex_steer_thread",
      threadId: toolArgs.thread_id,
      live: true,
      approvalAuditId: "${LIVE_AUDIT_ID}",
      paramsHash: "${PARAMS_HASH}",
      messageHash: "${liveMessageHash}",
      method: "${steerMethod}",
      expectedTurnId: ${liveExpectedTurnIdExpression},
      expected_turn_id: ${liveExpectedTurnIdExpression},
      approval_audit_id: "${LIVE_AUDIT_ID}",
      params_hash: "${PARAMS_HASH}",
      message_hash: "${liveMessageHash}",
      response: { ok: true, status: "accepted" }
    } }));
    process.exit(0);
  }
  if (name === "loo_codex_interrupt_thread") {
    if (toolArgs.approval_audit_id !== "${DRY_RUN_AUDIT_ID}" || toolArgs.dry_run !== false || !toolArgs.expected_turn_id) {
      console.log(JSON.stringify({ ok: false, error: { code: "approval_or_turn_mismatch" } }));
      process.exit(0);
    }
    console.log(JSON.stringify({ ok: true, output: {
      action: "codex_interrupt_thread",
      threadId: toolArgs.thread_id,
      live: true,
      approvalAuditId: "${LIVE_AUDIT_ID}",
      paramsHash: "${PARAMS_HASH}",
      method: "${interruptMethod}",
      expectedTurnId: toolArgs.expected_turn_id,
      expected_turn_id: toolArgs.expected_turn_id,
      approval_audit_id: "${LIVE_AUDIT_ID}",
      params_hash: "${PARAMS_HASH}",
      response: { ok: true, status: "accepted" }
    } }));
    process.exit(0);
  }
  if (name === "loo_audit_tail") {
    console.log(JSON.stringify(${auditTailResponse}));
    process.exit(0);
  }
}
console.error("unexpected fake OpenClaw call");
process.exit(7);
`);
  chmodSync(bin, 0o755);
  return { bin, callsPath };
}

test("OpenClaw live-control smoke proves dry-run live send and audit tail through tools.invoke", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-"));
  const evidenceDir = join(root, "evidence");
  const scenarioDir = join(root, "scenarios");
  const scenarioEvidenceDir = join(root, "scenario-evidence");
  const { bin, callsPath } = createFakeOpenClaw(root);
  const message = "raw prompt text should never be written";
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir,
      threadId: "thr_gateway_live",
      action: "send",
      message,
      now: "2026-07-01T00:00:00.000Z"
    });

    assert.equal(report.ok, true);
    assert.equal(report.proofReady, true);
    assert.equal(report.targetRef, "codex_thread:thr_gateway_live");
    assert.equal(report.dryRun.approvalAuditId, DRY_RUN_AUDIT_ID);
    assert.equal(report.dryRun.live, false);
    assert.equal(report.live.live, true);
    assert.equal(report.live.approvalAuditId, LIVE_AUDIT_ID);
    assert.equal(report.live.turnStatus, "completed");
    assert.equal(report.authorization.approvalAuditIdUsed, DRY_RUN_AUDIT_ID);
    assert.equal(report.authorization.approvalAuditIdMatchesDryRun, true);
    assert.equal(report.audit.matchingDryRunRecord, true);
    assert.equal(report.audit.matchingLiveRecord, true);
    assert.equal(report.actionsPerformed.liveCodexControlRun, true);
    assert.equal(JSON.stringify(report).includes(message), false);

    const reportText = readFileSync(join(evidenceDir, "openclaw-gateway-live-control-smoke-report.json"), "utf8");
    const proofText = readFileSync(join(evidenceDir, "openclaw-gateway-live-codex-v1-1.runtime-proof.json"), "utf8");
    assert.equal(reportText.includes(message), false);
    assert.equal(proofText.includes(message), false);

    mkdirSync(scenarioDir);
    copyFileSync(join("evals", "scenarios", "v1.1", "openclaw-gateway-live-codex.json"), join(scenarioDir, "openclaw-gateway-live-codex.json"));
    const scenarioReport = createScenarioSweep({
      scenarioDir,
      evidenceDir: scenarioEvidenceDir,
      runtimeProofDir: evidenceDir,
      now: "2026-07-01T00:01:00.000Z"
    });
    assert.equal(scenarioReport.ok, true);
    assert.deepEqual(scenarioReport.blockers, []);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    assert.deepEqual(calls.map((call) => call.method), ["tools.catalog", "tools.invoke", "tools.invoke", "tools.invoke"]);
    assert.equal(calls[1]?.params.name, "loo_codex_control_dry_run");
    assert.equal(calls[2]?.params.name, "loo_codex_send_message");
    assert.equal(calls[2]?.params.args?.approval_audit_id, DRY_RUN_AUDIT_ID);
    assert.equal(calls[2]?.params.args?.dry_run, false);
    assert.equal(calls[3]?.params.name, "loo_audit_tail");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke proves a recommended resume action through tools.invoke", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-resume-"));
  const evidenceDir = join(root, "evidence");
  const { bin, callsPath } = createFakeOpenClaw(root);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir,
      threadId: "thr_gateway_resume",
      action: "resume",
      now: "2026-07-01T00:00:00.000Z"
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.action, "resume");
    assert.equal(report.targetRef, "codex_thread:thr_gateway_resume");
    assert.equal(report.dryRun.approvalAuditId, DRY_RUN_AUDIT_ID);
    assert.equal(report.dryRun.live, false);
    assert.equal(report.dryRun.messageHash, null);
    assert.equal(report.live.live, true);
    assert.equal(report.live.method, "thread/resume");
    assert.equal(report.live.messageHash, null);
    assert.equal(report.live.turnStatus, "completed");
    assert.equal(report.audit.matchingDryRunRecord, true);
    assert.equal(report.audit.matchingLiveRecord, true);
    assert.deepEqual(report.blockers, []);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    assert.equal(calls[1]?.params.name, "loo_codex_control_dry_run");
    assert.equal(calls[1]?.params.args?.action, "resume");
    assert.equal(calls[2]?.params.name, "loo_codex_resume_thread");
    assert.equal(calls[2]?.params.args?.approval_audit_id, DRY_RUN_AUDIT_ID);
    assert.equal(calls[2]?.params.args?.dry_run, false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke accepts status-less ok response for resume actions", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-resume-statusless-"));
  const evidenceDir = join(root, "evidence");
  const { bin, callsPath } = createFakeOpenClaw(root, { resumeResponseMissingStatus: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir,
      threadId: "thr_gateway_resume_statusless",
      action: "resume",
      now: "2026-07-01T00:00:00.000Z"
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.action, "resume");
    assert.equal(report.live.method, "thread/resume");
    assert.equal(report.live.responseOk, true);
    assert.equal(report.live.turnStatus, null);
    assert.equal(report.audit.matchingDryRunRecord, true);
    assert.equal(report.audit.matchingLiveRecord, true);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string } });
    assert.equal(calls[3]?.params.name, "loo_audit_tail");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke proves a steer action bound to an expected turn", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-steer-"));
  const evidenceDir = join(root, "evidence");
  const { bin, callsPath } = createFakeOpenClaw(root);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir,
      threadId: "thr_gateway_steer",
      action: "steer",
      expectedTurnId: "turn_sacrificial_1",
      now: "2026-07-01T00:00:00.000Z"
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.action, "steer");
    assert.equal(report.dryRun.messageHash, MESSAGE_HASH);
    assert.equal(report.live.live, true);
    assert.equal(report.live.method, "turn/steer");
    assert.equal(report.live.expectedTurnId, "turn_sacrificial_1");
    assert.equal(report.audit.matchingDryRunRecord, true);
    assert.equal(report.audit.matchingLiveRecord, true);
    assert.deepEqual(report.blockers, []);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    assert.equal(calls[1]?.params.name, "loo_codex_control_dry_run");
    assert.equal(calls[1]?.params.args?.action, "steer");
    assert.equal(calls[1]?.params.args?.expected_turn_id, "turn_sacrificial_1");
    assert.equal(calls[2]?.params.name, "loo_codex_steer_thread");
    assert.equal(calls[2]?.params.args?.approval_audit_id, DRY_RUN_AUDIT_ID);
    assert.equal(calls[2]?.params.args?.dry_run, false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke proves an interrupt action through tools.invoke", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-interrupt-"));
  const evidenceDir = join(root, "evidence");
  const { bin, callsPath } = createFakeOpenClaw(root);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir,
      threadId: "thr_gateway_interrupt",
      action: "interrupt",
      expectedTurnId: "turn_sacrificial_interrupt",
      now: "2026-07-01T00:00:00.000Z"
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.action, "interrupt");
    assert.equal(report.dryRun.messageHash, null);
    assert.equal(report.live.live, true);
    assert.equal(report.live.method, "turn/interrupt");
    assert.equal(report.live.messageHash, null);
    assert.equal(report.live.expectedTurnId, "turn_sacrificial_interrupt");
    assert.equal(report.audit.matchingDryRunRecord, true);
    assert.equal(report.audit.matchingLiveRecord, true);
    assert.deepEqual(report.blockers, []);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    assert.equal(calls[1]?.params.name, "loo_codex_control_dry_run");
    assert.equal(calls[1]?.params.args?.action, "interrupt");
    assert.equal(calls[1]?.params.args?.expected_turn_id, "turn_sacrificial_interrupt");
    assert.equal(calls[2]?.params.name, "loo_codex_interrupt_thread");
    assert.equal(calls[2]?.params.args?.approval_audit_id, DRY_RUN_AUDIT_ID);
    assert.equal(calls[2]?.params.args?.dry_run, false);
    assert.equal(calls[2]?.params.args?.expected_turn_id, "turn_sacrificial_interrupt");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke fails closed when steer returns a different expected turn id", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-steer-mismatch-"));
  const evidenceDir = join(root, "evidence");
  const { bin, callsPath } = createFakeOpenClaw(root, { mismatchedExpectedTurnId: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir,
      threadId: "thr_gateway_steer_mismatch",
      action: "steer",
      expectedTurnId: "turn_requested",
      now: "2026-07-01T00:00:00.000Z"
    });

    assert.equal(report.ok, false);
    assert.equal(report.live.expectedTurnId, "turn_unexpected");
    assert.match(report.blockers.join("\n"), /openclaw_live_steer_not_proven/);
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    assert.equal(calls[1]?.params.args?.expected_turn_id, "turn_requested");
    assert.equal(calls[2]?.params.args?.expected_turn_id, "turn_requested");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke requires expected turn id for steer before gateway calls", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-steer-no-turn-"));
  const evidenceDir = join(root, "evidence");
  const { bin, callsPath } = createFakeOpenClaw(root);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    assert.throws(() => runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir,
      threadId: "thr_gateway_steer_no_turn",
      action: "steer",
      now: "2026-07-01T00:00:00.000Z"
    }), /requires --expected-turn-id/);
    assert.equal(existsSync(callsPath), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke requires expected turn id for interrupt before gateway calls", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-interrupt-no-turn-"));
  const evidenceDir = join(root, "evidence");
  const { bin, callsPath } = createFakeOpenClaw(root);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    assert.throws(() => runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir,
      threadId: "thr_gateway_interrupt_no_turn",
      action: "interrupt",
      now: "2026-07-01T00:00:00.000Z"
    }), /requires --expected-turn-id for interrupt/);
    assert.equal(existsSync(callsPath), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke fails closed when resume response is not ok", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-resume-not-ok-"));
  const evidenceDir = join(root, "evidence");
  const { bin, callsPath } = createFakeOpenClaw(root, { resumeResponseOkFalse: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir,
      threadId: "thr_gateway_resume_not_ok",
      action: "resume",
      now: "2026-07-01T00:00:00.000Z"
    });

    assert.equal(report.ok, false);
    assert.equal(report.action, "resume");
    assert.equal(report.live.method, "thread/resume");
    assert.equal(report.live.responseOk, false);
    assert.match(report.blockers.join("\n"), /openclaw_live_resume_not_proven/);

    const proof = JSON.parse(readFileSync(join(evidenceDir, "openclaw-gateway-live-codex-v1-1.runtime-proof.json"), "utf8")) as {
      proof_markers?: { matching_approval_audit_id?: boolean };
    };
    assert.equal(proof.proof_markers?.matching_approval_audit_id, false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke fails closed when resume method is not thread/resume", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-resume-wrong-method-"));
  const evidenceDir = join(root, "evidence");
  const { bin, callsPath } = createFakeOpenClaw(root, { resumeMethod: "turn/start" });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir,
      threadId: "thr_gateway_resume_wrong_method",
      action: "resume",
      now: "2026-07-01T00:00:00.000Z"
    });

    assert.equal(report.ok, false);
    assert.equal(report.action, "resume");
    assert.equal(report.live.method, "turn/start");
    assert.equal(report.live.responseOk, true);
    assert.match(report.blockers.join("\n"), /openclaw_live_resume_not_proven/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke rejects unknown action values before gateway calls", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-bad-action-"));
  const evidenceDir = join(root, "evidence");
  const { bin, callsPath } = createFakeOpenClaw(root);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    assert.throws(() => runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir,
      threadId: "thr_gateway_bad_action",
      action: "Resume" as "resume",
      now: "2026-07-01T00:00:00.000Z"
    }), /action must be send, resume, steer, or interrupt/);
    assert.equal(existsSync(callsPath), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke requires explicit action before gateway calls", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-missing-action-"));
  const evidenceDir = join(root, "evidence");
  const { bin, callsPath } = createFakeOpenClaw(root);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    assert.throws(() => runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir,
      threadId: "thr_gateway_missing_action",
      now: "2026-07-01T00:00:00.000Z"
    }), /requires explicit action/);
    assert.equal(existsSync(callsPath), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke accepts documented in-flight turn statuses", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-running-status-"));
  const { bin, callsPath } = createFakeOpenClaw(root, { liveTurnStatus: "running" });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      threadId: "thr_gateway_live",
      action: "send"
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.live.turnStatus, "running");
    assert.deepEqual(report.blockers, []);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke accepts audit tail records from tool details envelope", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-audit-details-"));
  const evidenceDir = join(root, "evidence");
  const { bin, callsPath } = createFakeOpenClaw(root, { auditDetailsEnvelope: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir,
      threadId: "thr_gateway_live",
      action: "send",
      now: "2026-07-01T00:00:00.000Z"
    });

    assert.equal(report.ok, true);
    assert.equal(report.audit.matchingDryRunRecord, true);
    assert.equal(report.audit.matchingLiveRecord, true);
    assert.deepEqual(report.blockers, []);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke fails closed when live output does not match dry-run hash", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-mismatch-"));
  const { bin, callsPath } = createFakeOpenClaw(root, { mismatchedLiveMessageHash: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      threadId: "thr_gateway_live",
      action: "send"
    });

    assert.equal(report.ok, false);
    assert.match(report.blockers.join("\n"), /openclaw_live_message_hash_mismatch/);
    const proof = JSON.parse(readFileSync(join(root, "evidence", "openclaw-gateway-live-codex-v1-1.runtime-proof.json"), "utf8")) as {
      public_safe?: boolean;
      proof_markers?: Record<string, boolean>;
    };
    assert.equal(proof.public_safe, false);
    assert.equal(proof.proof_markers?.matching_approval_audit_id, false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke fails closed when live output lacks accepted turn status", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-no-turn-status-"));
  const { bin, callsPath } = createFakeOpenClaw(root, { missingLiveTurnStatus: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      threadId: "thr_gateway_live",
      action: "send"
    });

    assert.equal(report.ok, false);
    assert.equal(report.live.turnStatus, null);
    assert.match(report.blockers.join("\n"), /openclaw_live_send_not_proven/);
    const proof = JSON.parse(readFileSync(join(root, "evidence", "openclaw-gateway-live-codex-v1-1.runtime-proof.json"), "utf8")) as {
      public_safe?: boolean;
      proof_markers?: Record<string, boolean>;
    };
    assert.equal(proof.public_safe, false);
    assert.equal(proof.proof_markers?.matching_approval_audit_id, false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke fails closed when live response is not ok", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-response-not-ok-"));
  const { bin, callsPath } = createFakeOpenClaw(root, { liveResponseOkFalse: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      threadId: "thr_gateway_live",
      action: "send"
    });

    assert.equal(report.ok, false);
    assert.equal(report.live.responseOk, false);
    assert.match(report.blockers.join("\n"), /openclaw_live_send_not_proven/);
    const proof = JSON.parse(readFileSync(join(root, "evidence", "openclaw-gateway-live-codex-v1-1.runtime-proof.json"), "utf8")) as {
      public_safe?: boolean;
      proof_markers?: Record<string, boolean>;
    };
    assert.equal(proof.public_safe, false);
    assert.equal(proof.proof_markers?.matching_approval_audit_id, false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw live-control smoke fails closed when live response omits ok proof", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-live-smoke-response-missing-ok-"));
  const { bin, callsPath } = createFakeOpenClaw(root, { liveResponseMissingOk: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawGatewayLiveControlSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      threadId: "thr_gateway_live",
      action: "send"
    });

    assert.equal(report.ok, false);
    assert.equal(report.live.responseOk, null);
    assert.match(report.blockers.join("\n"), /openclaw_live_send_not_proven/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI exposes OpenClaw live-control smoke help without running live control", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "openclaw",
    "live-control-smoke",
    "--help"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /loo openclaw live-control-smoke/i);
  assert.match(result.stdout, /send\|resume\|steer\|interrupt/i);
  assert.match(result.stdout, /--expected-turn-id/i);
  assert.match(result.stdout, /openclaw-gateway-live-codex-v1-1\.runtime-proof\.json/i);
  assert.match(result.stdout, /requires an explicit --thread-id/i);
  assert.match(result.stdout, /requires an explicit --action/i);
});
