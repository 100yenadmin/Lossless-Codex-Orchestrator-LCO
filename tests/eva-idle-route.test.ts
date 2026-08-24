import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { spawn } from "node:child_process";
import {
  containsTerminalAssistantMarker,
  EVA_IDLE_ROUTE_MESSAGE,
  runEvaIdleRoute,
  type EvaIdleRouteReport,
  type EvaIdleRouteSetupClient
} from "../packages/cli/src/qa-lab-eva-idle-route.js";

const PACKAGE_VERSION = "1.7.0";
const CANDIDATE_SHA = "78bd6e7d4e5656d09e76c4c85d01a85b3515b354";
const PACKAGE_INTEGRITY = "sha512-0sZShBTX/+332BEavQ46oHcoUygXwfus+NPa/B37z/6OUcMb/3Q8n7QrqOxIq1EIQmTmtgusZ35car8Spp7Evw==";
const PACKAGE_SHASUM = "9b4199489324d2fb21e6a44b5feb7eadd8000817";

function tempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeSubject(t: TestContext, options: { behavior?: string; wrongPrefix?: boolean; packageName?: string } = {}): { bin: string; callsPath: string; sha256: string } {
  const dir = tempDir(t, options.wrongPrefix ? "lco-wrong-prefix-" : "lossless-codex-orchestrator-1.7.0-9b4199489324-");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: options.packageName ?? "lossless-codex-orchestrator", version: PACKAGE_VERSION }));
  const callsPath = join(dir, "calls.jsonl");
  const bin = join(dir, "lco-mcp-server.mjs");
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const calls = ${JSON.stringify(callsPath)};
const behavior = ${JSON.stringify(options.behavior ?? "")};
let buffer = "";
const write = (payload) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...payload }) + "\\n");
const output = (id, value) => write({ id, result: { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] } });
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\\r?\\n/);
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (calls) appendFileSync(calls, JSON.stringify(msg) + "\\n");
    if (msg.method === "initialize") {
      if (process.env.LCO_AUDIT_PATH) {
        appendFileSync(process.env.LCO_AUDIT_PATH, "{}\\n");
        if (behavior !== "missing-audit-key") writeFileSync(process.env.LCO_AUDIT_PATH + ".key", "", { mode: 0o600 });
      }
      write({ id: msg.id, result: { protocolVersion: "2025-11-25", serverInfo: { name: "lossless-openclaw-orchestrator", version: "${PACKAGE_VERSION}" }, capabilities: { tools: {} } } });
      continue;
    }
    if (msg.method === "notifications/initialized") continue;
    if (msg.method === "tools/list") {
      write({ id: msg.id, result: { tools: [{ name: "lco_codex_control_route" }, { name: "lco_codex_deliver" }] } });
      continue;
    }
    if (msg.method !== "tools/call") continue;
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};
    if (name === "lco_codex_control_route") {
      if (behavior === "route-ambiguous") output(msg.id, { schema: "lco.codex.controlRoute.v1", status: "ambiguous", route: "app_server", target_ref: null, title_sanitized: null, state: null, supported_actions: [], expires_at: null, reason_codes: ["ambiguous_target"], public_safe: true, raw_transcript_returned: false });
      else output(msg.id, { schema: "lco.codex.controlRoute.v1", status: "selected", route: "app_server", target_ref: "opaque_target_for_test", title_sanitized: args.hint, state: "idle", supported_actions: ["send"], expires_at: behavior === "route-expired" ? "2000-01-01T00:00:00.000Z" : "2099-01-01T00:00:00.000Z", reason_codes: [], public_safe: true, raw_transcript_returned: false });
    } else if (name === "lco_codex_deliver") {
      if (args.dry_run === false) output(msg.id, { schema: "lco.codex.delivery.v1", status: behavior === "live-reject" ? "blocked" : "accepted", action: "send", target_ref: args.target_ref, live: true, control_sent: behavior !== "live-reject", approval_audit_id: behavior === "approval-mismatch" ? "other-approval" : args.approval_audit_id, params_hash: behavior === "approval-hash-mismatch" ? "other-params" : "params-hash", message_hash: "message-hash", reason_codes: behavior === "live-reject" ? ["control_rejected"] : [], public_safe: true, raw_transcript_returned: false, raw_thread_id: "do-not-leak" });
      else if (behavior === "generic-dry-run-reject") output(msg.id, { schema: "lco.codex.delivery.v1", status: "accepted", action: "send", target_ref: args.target_ref, live: true, control_sent: true, reason_codes: [], public_safe: true, raw_transcript_returned: false });
      else {
        output(msg.id, { schema: "lco.codex.delivery.v1", status: "dry_run_ready", action: "send", target_ref: behavior === "target-drift" ? "different_target" : args.target_ref, live: false, control_sent: false, approval_audit_id: "approval-for-test", params_hash: "params-hash", message_hash: "message-hash", reason_codes: [], public_safe: true, raw_transcript_returned: false, audit_path: "/private/audit.jsonl" });
        if (behavior === "disconnect-after-dry-run") setImmediate(() => process.exit(0));
      }
    } else {
      output(msg.id, { ok: false, reason_codes: ["unknown_tool"] });
    }
  }
});
`, { mode: 0o755 });
  chmodSync(bin, 0o755);
  return { bin, callsPath, sha256: createHash("sha256").update(readFileSync(bin)).digest("hex") };
}

function setupClient(events: string[], completionSeen = true): EvaIdleRouteSetupClient {
  return {
    async startThread() {
      events.push("thread/start");
      return "raw-task-id-must-not-escape";
    },
    async nameThread(threadId, title) {
      events.push(`thread/name/set:${threadId}:${title}`);
    },
    async completionObserved(threadId) {
      events.push(`thread/read:${threadId}`);
      return completionSeen;
    },
    async close() {
      events.push("close");
    }
  };
}

test("eva idle completion accepts only an exact terminal assistant marker", () => {
  assert.doesNotMatch(EVA_IDLE_ROUTE_MESSAGE, /LCO_IDLE_OK/);
  assert.equal(containsTerminalAssistantMarker({ thread: { turns: [{ items: [{ type: "userMessage", text: "LCO_IDLE_OK" }] }] } }), false);
  assert.equal(containsTerminalAssistantMarker({ thread: { turns: [{ items: [{ type: "agentMessage", text: "LCO_IDLE_OK" }] }] } }), true);
  assert.equal(containsTerminalAssistantMarker({ thread: { turns: [{ items: [{ role: "assistant", content: [{ type: "output_text", text: "LCO_IDLE_OK" }] }] }] } }), true);
  assert.equal(containsTerminalAssistantMarker({ thread: { turns: [{ items: [{ type: "agentMessage", text: "Done: LCO_IDLE_OK" }] }] } }), false);
});

test("eva idle route defaults to non-executing and never starts a task", async (t) => {
  const subject = fakeSubject(t);
  const evidenceDir = tempDir(t, "lco-eva-idle-evidence-");
  const calls: string[] = [];
  const report = await runEvaIdleRoute({
    evidenceDir,
    mcpBin: subject.bin,
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient(calls),
    spawnFactory: ((...args: Parameters<typeof spawn>) => {
      const child = spawn(...args);
      return child;
    }) as typeof spawn,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.schema, "lco.evaIdleRouteDeliver.v1");
  assert.equal(report.execute, false);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.deepEqual(calls, []);
  assert.equal(report.forbidden_fields_present, false);
  assert.match(report.proofBoundary, /does not prove Eva runtime safety/i);
});

test("eva idle route stops before execution when immutable subject identity is wrong", async (t) => {
  const subject = fakeSubject(t, { wrongPrefix: true });
  const calls: string[] = [];
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    execute: true,
    setupClientFactory: async () => setupClient(calls),
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("subject_immutable_prefix_mismatch"));
  assert.deepEqual(calls, []);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.mcpSessionCount, 0);
});

test("eva idle route rejects an arbitrary executable under the expected prefix", async (t) => {
  const subject = fakeSubject(t);
  const calls: string[] = [];
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    execute: true,
    setupClientFactory: async () => setupClient(calls),
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("subject_mcp_binary_hash_mismatch"));
  assert.deepEqual(calls, []);
  assert.equal(report.mcpSessionCount, 0);
});

test("eva idle route reports only an observed noncanonical package name", async (t) => {
  const subject = fakeSubject(t, { packageName: "untrusted-package-name" });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    execute: true,
    setupClientFactory: async () => setupClient([]),
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("subject_package_name_mismatch"));
  assert.equal(report.subject.packageName, null);
});

test("eva idle route composes one setup, one MCP session, dry-run/live, and completion probe", async (t) => {
  const subject = fakeSubject(t);
  const evidenceDir = tempDir(t, "lco-eva-idle-evidence-");
  const calls: string[] = [];
  const report = await runEvaIdleRoute({
    evidenceDir,
    mcpBin: subject.bin,
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    execute: true,
    setupClientFactory: async () => setupClient(calls),
    now: "2026-08-24T00:00:00.000Z",
    env: { ...process.env, LCO_EVA_IDLE_CALLS: subject.callsPath }
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.accepted, true);
  assert.equal(report.completionSeen, true);
  assert.equal(report.terminalMarkerObserved, true);
  assert.equal(report.actionsPerformed.liveCodexControlRun, true);
  assert.equal(report.mcpSessionCount, 1);
  assert.equal(report.mcpSessionReused, true);
  assert.equal(calls[0], "thread/start");
  assert.match(calls[1] ?? "", /^thread\/name\/set:raw-task-id-must-not-escape:Eva LCO idle route probe /);
  assert.match(calls[2] ?? "", /^thread\/read:raw-task-id-must-not-escape$/);
  assert.equal(calls.at(-1), "close");
  assert.equal(report.targetHashes.equal, true);
  assert.equal(report.messageHashes.equal, true);
  assert.equal(report.parameterHashes.equal, true);
  assert.equal(report.parameterHashes.dryRunSha256, "params-hash");
  assert.equal(report.parameterHashes.liveSha256, "params-hash");
  assert.equal(report.lastObservedMarker, "completion_probe");
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /raw-task-id-must-not-escape|opaque_target_for_test|LCO_IDLE_OK|\/private\/audit\.jsonl/i);
  assert.equal(report.subject.packageIntegrity, PACKAGE_INTEGRITY);
  assert.equal(report.subject.packageShasum, PACKAGE_SHASUM);
  assert.equal(report.subject.immutablePrefixVerified, true);
  assert.equal(report.subject.mcpBinaryHashVerified, true);
  assert.equal(report.auditBoundary.directoryMode700, true);
  assert.equal(report.auditBoundary.jsonlRegularMode600, true);
  assert.equal(report.auditBoundary.keyRegularMode600, true);
  assert.equal(report.auditBoundary.cleanupStatus, "cleaned");
  const mcpCalls = readFileSync(subject.callsPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { method?: string; params?: { name?: string; arguments?: { dry_run?: boolean } } });
  assert.equal(mcpCalls.filter((call) => call.method === "tools/call" && call.params?.name === "lco_codex_deliver" && call.params.arguments?.dry_run === false).length, 1);
  assert.equal(mcpCalls.some((call) => call.params?.name === "lco_codex_control_dry_run"), false);
});

test("eva idle route starts the completion budget only after live acceptance", async (t) => {
  const subject = fakeSubject(t);
  const delayedSetup = setupClient([]);
  const originalStartThread = delayedSetup.startThread;
  delayedSetup.startThread = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return originalStartThread();
  };
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => delayedSetup,
    execute: true,
    completionTimeoutMs: 20,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.completionSeen, true);
});

test("eva idle route retains an unverifiable private audit boundary", async (t) => {
  const subject = fakeSubject(t, { behavior: "missing-audit-key" });
  const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("lco-eva-idle-audit-")));
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.equal(report.auditBoundary.keyRegularMode600, false);
  assert.equal(report.auditBoundary.cleanupStatus, "retained_for_operator");
  assert.ok(report.blockers.includes("audit_boundary_verification_failed"));
  const retained = readdirSync(tmpdir()).filter((name) => name.startsWith("lco-eva-idle-audit-") && !before.has(name));
  assert.equal(retained.length, 1);
  const retainedPath = join(tmpdir(), retained[0]!);
  assert.equal(statSync(retainedPath).mode & 0o777, 0o700);
  rmSync(retainedPath, { recursive: true, force: true });
});

test("eva idle route preserves the first sanitized live rejection reason", async (t) => {
  const subject = fakeSubject(t, { behavior: "live-reject" });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("control_rejected"));
});

test("eva idle route receipt is written with redacted stage/error fields", async (t) => {
  const subject = fakeSubject(t);
  const evidenceDir = tempDir(t, "lco-eva-idle-evidence-");
  const report = await runEvaIdleRoute({
    evidenceDir,
    mcpBin: subject.bin,
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    execute: true,
    now: "2026-08-24T00:00:00.000Z",
    env: { ...process.env, LCO_EVA_IDLE_CALLS: subject.callsPath }
  });
  assert.equal(report.forbidden_fields_present, false);
  assert.ok(report.stages.every((stage) => Number.isInteger(stage.elapsedMs) && stage.elapsedMs >= 0));
  assert.ok(report.stages.every((stage) => stage.errorClass === null || /^[a-z0-9_]+$/.test(stage.errorClass)));
  const receipt = readFileSync(join(evidenceDir, "eva-idle-route.json"), "utf8");
  assert.doesNotMatch(receipt, /raw-task-id-must-not-escape|opaque_target_for_test|LCO_IDLE_OK|\/private\/audit\.jsonl/i);
});

test("eva idle route rejects a generic dry-run and does not continue to live delivery", async (t) => {
  const subject = fakeSubject(t, { behavior: "generic-dry-run-reject" });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });
  assert.equal(report.ok, false);
  assert.equal(report.accepted, false);
  assert.ok(report.blockers.includes("generic_dry_run_rejected"));
  assert.equal(report.stages.some((stage) => stage.name === "deliver_live"), false);
});

test("eva idle route separates accepted delivery from incomplete completion", async (t) => {
  const subject = fakeSubject(t, { behavior: "completion-pending" });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([], false),
    execute: true,
    completionTimeoutMs: 20,
    now: "2026-08-24T00:00:00.000Z"
  });
  assert.equal(report.ok, false);
  assert.equal(report.accepted, true);
  assert.equal(report.completionSeen, false);
  assert.equal(report.terminalMarkerObserved, false);
  assert.ok(report.blockers.includes("completion_deadline_exceeded"));
});

test("eva idle route fails closed for ambiguous, expired, or drifted targets", async (t) => {
  for (const behavior of ["route-ambiguous", "route-expired", "target-drift"]) {
    const subject = fakeSubject(t, { behavior });
    const report = await runEvaIdleRoute({
      evidenceDir: tempDir(t, `lco-eva-idle-evidence-${behavior}-`),
      mcpBin: subject.bin,
      expectedMcpBinarySha256: subject.sha256,
      packageVersion: PACKAGE_VERSION,
      candidateSha: CANDIDATE_SHA,
      setupClientFactory: async () => setupClient([]),
      execute: true,
      now: "2026-08-24T00:00:00.000Z"
    });
    assert.equal(report.ok, false, behavior);
    assert.equal(report.accepted, false, behavior);
    assert.equal(report.forbidden_fields_present, false, behavior);
  }
});

test("eva idle route rejects approval drift without retrying live delivery", async (t) => {
  const subject = fakeSubject(t, { behavior: "approval-mismatch" });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.equal(report.accepted, false);
  assert.ok(report.blockers.includes("approval_binding_mismatch"));
  const calls = readFileSync(subject.callsPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { params?: { name?: string; arguments?: { dry_run?: boolean } } });
  assert.equal(calls.filter((call) => call.params?.name === "lco_codex_deliver" && call.params.arguments?.dry_run === false).length, 1);
});

test("eva idle route does not reconnect or reuse approval after the subject session closes", async (t) => {
  const subject = fakeSubject(t, { behavior: "disconnect-after-dry-run" });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.equal(report.accepted, false);
  assert.equal(report.mcpSessionCount, 1);
  assert.equal(report.mcpSessionReused, true);
  assert.equal(report.stages.some((stage) => stage.name === "completion_probe"), false);
});
