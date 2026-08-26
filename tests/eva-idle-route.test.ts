import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  containsTerminalAssistantMarker,
  EVA_IDLE_ROUTE_MESSAGE,
  runEvaIdleRoute,
  type EvaIdleRouteDaemonClient,
  type EvaIdleRouteReport,
  type EvaIdleRouteSetupClient
} from "../packages/cli/src/qa-lab-eva-idle-route.js";

const PACKAGE_VERSION = "1.7.0";
const CANDIDATE_SHA = "78bd6e7d4e5656d09e76c4c85d01a85b3515b354";
const PARAMS_HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MESSAGE_HASH = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function tempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function packageProof(subject: ReturnType<typeof fakeSubject>): { packageTarball: string; expectedPackageIntegrity: string; expectedPackageShasum: string; repoRoot: string } {
  return { packageTarball: subject.tarball, expectedPackageIntegrity: subject.tarballIntegrity, expectedPackageShasum: subject.tarballShasum, repoRoot: subject.repoRoot };
}

function fakeSubject(t: TestContext, options: { behavior?: string; wrongPrefix?: boolean; packageName?: string; tarballBinMode?: number } = {}): { bin: string; callsPath: string; sha256: string; tarball: string; tarballIntegrity: string; tarballShasum: string; repoRoot: string } {
  const dir = tempDir(t, options.wrongPrefix ? "lco-wrong-prefix-" : "lossless-codex-orchestrator-1.7.0-9b4199489324-");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: options.packageName ?? "lossless-codex-orchestrator", version: PACKAGE_VERSION }));
  const callsPath = join(dir, "calls.jsonl");
  const bin = join(dir, "lco-mcp-server.mjs");
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn as spawnChild } from "node:child_process";
const calls = ${JSON.stringify(callsPath)};
const behavior = ${JSON.stringify(options.behavior ?? "")};
let buffer = "";
const write = (payload) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...payload }) + "\\n");
const output = (id, value) => write({ id, result: { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] } });
if (behavior.startsWith("ignore-sigterm")) process.on("SIGTERM", () => {});
if (behavior === "ignore-sigterm-hold-stdio") {
  const holder = spawnChild(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] });
  writeFileSync(calls + ".holder", String(holder.pid));
  holder.unref();
}
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
      const response = { id: msg.id, result: { protocolVersion: "2025-11-25", serverInfo: { name: "lossless-openclaw-orchestrator", version: "${PACKAGE_VERSION}" }, capabilities: { tools: {} } } };
      if (behavior === "slow-init-list") setTimeout(() => write(response), 15);
      else write(response);
      continue;
    }
    if (msg.method === "notifications/initialized") continue;
    if (msg.method === "tools/list") {
      const response = { id: msg.id, result: { tools: [{ name: "lco_codex_control_route" }, { name: "lco_codex_deliver" }] } };
      if (behavior === "slow-init-list") setTimeout(() => write(response), 15);
      else write(response);
      continue;
    }
    if (msg.method !== "tools/call") continue;
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};
    if (name === "lco_codex_control_route") {
      if (behavior === "route-ambiguous") output(msg.id, { schema: "lco.codex.controlRoute.v1", status: "ambiguous", route: "app_server", target_ref: null, title_sanitized: null, state: null, supported_actions: [], expires_at: null, reason_codes: ["ambiguous_target"], public_safe: true, raw_transcript_returned: false });
      else output(msg.id, { schema: "lco.codex.controlRoute.v1", status: "selected", route: "app_server", target_ref: "opaque_target_for_test", title_sanitized: args.hint, state: behavior === "route-active" ? "active" : "idle", supported_actions: behavior === "route-active" ? ["steer"] : ["send"], expires_at: behavior === "route-expired" ? "2000-01-01T00:00:00.000Z" : "2099-01-01T00:00:00.000Z", reason_codes: [], public_safe: true, raw_transcript_returned: false });
    } else if (name === "lco_codex_deliver") {
      if (args.dry_run === false) {
        if (behavior.startsWith("separate-live-audit-") && process.env.LCO_AUDIT_PATH) appendFileSync(process.env.LCO_AUDIT_PATH, JSON.stringify({ id: "loo_audit_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", action: "codex_send_message", live: true, approvalAuditId: behavior === "separate-live-audit-unlinked" ? "wrong-approval" : args.approval_audit_id, approvalState: "completed", paramsHash: "${PARAMS_HASH}", messageHash: "${MESSAGE_HASH}" }) + "\\n");
        const live = { schema: "lco.codex.delivery.v1", status: behavior === "live-reject" || behavior === "contradictory-live" ? "blocked" : "accepted", action: "send", target_ref: args.target_ref, live: true, control_sent: behavior !== "live-reject", approval_audit_id: behavior === "approval-mismatch" ? "other-approval" : behavior.startsWith("separate-live-audit-") ? "loo_audit_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" : args.approval_audit_id, params_hash: behavior === "approval-hash-mismatch" ? "other-params" : behavior === "malformed-hash" ? "params-hash" : "${PARAMS_HASH}", message_hash: behavior === "malformed-hash" ? "message-hash" : "${MESSAGE_HASH}", reason_codes: behavior === "live-reject" ? ["control_rejected"] : [], public_safe: true, raw_transcript_returned: false, raw_thread_id: "do-not-leak" };
        if (behavior === "slow-live") setTimeout(() => output(msg.id, live), 1_000);
        else output(msg.id, live);
      }
      else if (behavior === "generic-dry-run-reject") output(msg.id, { schema: "lco.codex.delivery.v1", status: "accepted", action: "send", target_ref: args.target_ref, live: true, control_sent: true, reason_codes: [], public_safe: true, raw_transcript_returned: false });
      else if (behavior === "contradictory-dry-run") output(msg.id, { schema: "lco.codex.delivery.v1", status: "dry_run_ready", action: "send", target_ref: args.target_ref, live: false, control_sent: true, approval_audit_id: "approval-for-test", params_hash: "${PARAMS_HASH}", message_hash: "${MESSAGE_HASH}", reason_codes: [], public_safe: true, raw_transcript_returned: false });
      else {
        output(msg.id, { schema: "lco.codex.delivery.v1", status: "dry_run_ready", action: "send", target_ref: behavior === "target-drift" ? "different_target" : args.target_ref, live: false, control_sent: false, approval_audit_id: "approval-for-test", params_hash: behavior === "malformed-hash" ? "params-hash" : "${PARAMS_HASH}", message_hash: behavior === "malformed-hash" ? "message-hash" : "${MESSAGE_HASH}", reason_codes: [], public_safe: true, raw_transcript_returned: false, audit_path: "/private/audit.jsonl" });
        if (behavior === "disconnect-after-dry-run") setImmediate(() => process.exit(0));
      }
    } else {
      output(msg.id, { ok: false, reason_codes: ["unknown_tool"] });
    }
  }
});
`, { mode: 0o755 });
  chmodSync(bin, 0o755);
  const packageStaging = tempDir(t, "lco-package-staging-");
  const packageDir = join(packageStaging, "package");
  mkdirSync(packageDir);
  writeFileSync(join(packageDir, "package.json"), readFileSync(join(dir, "package.json")));
  const packagedBin = join(packageDir, "lco-mcp-server.mjs");
  writeFileSync(packagedBin, readFileSync(bin), { mode: options.tarballBinMode ?? 0o755 });
  chmodSync(packagedBin, options.tarballBinMode ?? 0o755);
  const tarball = join(packageStaging, "lossless-codex-orchestrator-1.7.0.tgz");
  execFileSync("tar", ["-czf", tarball, "-C", packageStaging, "package"]);
  const tarballBytes = readFileSync(tarball);
  const repoRoot = tempDir(t, "lco-eva-clean-harness-");
  const source = join(repoRoot, "packages/cli/src/qa-lab-eva-idle-route.ts");
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, readFileSync(fileURLToPath(new URL("../packages/cli/src/qa-lab-eva-idle-route.ts", import.meta.url))));
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "test"], { cwd: repoRoot });
  execFileSync("git", ["add", source], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "test harness"], { cwd: repoRoot });
  return { bin, callsPath, sha256: createHash("sha256").update(readFileSync(bin)).digest("hex"), tarball, tarballIntegrity: `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`, tarballShasum: createHash("sha1").update(tarballBytes).digest("hex"), repoRoot };
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

function daemonSetupClient(
  requests: Array<{ method: string; params: Record<string, unknown> }>,
  options: { rejectStart?: boolean; rejectName?: boolean } = {}
): EvaIdleRouteDaemonClient {
  return {
    async connect() {},
    async request(method, params) {
      requests.push({ method, params });
      if (method === "thread/start") {
        return options.rejectStart
          ? { ok: false, error: "private-start-error-must-not-escape" }
          : { ok: true, result: { thread: { id: "raw-task-id-must-not-escape" } } };
      }
      if (method === "thread/name/set") {
        return options.rejectName
          ? { ok: false, error: "private-rpc-error-must-not-escape" }
          : { ok: true, result: {} };
      }
      if (method === "thread/read") {
        return { ok: true, result: { thread: { turns: [{ status: "completed", items: [{ type: "agentMessage", text: "LCO_IDLE_OK" }] }] } } };
      }
      return { ok: false };
    },
    async close() {}
  };
}

test("eva idle daemon setup creates a persistent no-approval read-only task before naming it", async (t) => {
  const subject = fakeSubject(t);
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    execute: true,
    env: { PATH: process.env.PATH, LCO_CODEX_TRANSPORT: "daemon" },
    daemonClientFactoryForTest: async () => daemonSetupClient(requests),
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, true);
  assert.deepEqual(requests[0], {
    method: "thread/start",
    params: { ephemeral: false, approvalPolicy: "never", sandbox: "read-only" }
  });
  assert.equal(requests[1]?.method, "thread/name/set");
  assert.equal(requests[1]?.params.threadId, "raw-task-id-must-not-escape");
  assert.equal(requests[1]?.params.name, report.publicSafeTitle);
  assert.equal(report.actionsPerformed.sourceStoreMutation, true);
  assert.doesNotMatch(JSON.stringify(report), /raw-task-id-must-not-escape/);
});

test("eva idle daemon naming rejection stays sanitized", async (t) => {
  const subject = fakeSubject(t);
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    execute: true,
    env: { PATH: process.env.PATH, LCO_CODEX_TRANSPORT: "daemon" },
    daemonClientFactoryForTest: async () => daemonSetupClient(requests, { rejectName: true }),
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("thread_name_rejected"));
  assert.equal(report.actionsPerformed.sourceStoreMutation, true);
  assert.doesNotMatch(JSON.stringify(report), /raw-task-id-must-not-escape|private-rpc-error-must-not-escape/);
});

test("eva idle daemon conservatively reports a transmitted persistent start rejection as a mutation", async (t) => {
  const subject = fakeSubject(t);
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    execute: true,
    env: { PATH: process.env.PATH, LCO_CODEX_TRANSPORT: "daemon" },
    daemonClientFactoryForTest: async () => daemonSetupClient(requests, { rejectStart: true }),
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.equal(requests[0]?.method, "thread/start");
  assert.ok(report.blockers.includes("thread_start_rejected"));
  assert.equal(report.actionsPerformed.sourceStoreMutation, true);
  assert.equal(report.actionsPerformed.liveCodexControlRun, true);
  assert.doesNotMatch(JSON.stringify(report), /raw-task-id-must-not-escape|private-start-error-must-not-escape/);
});

test("eva idle daemon closes the client and preserves the connect blocker when setup fails", async (t) => {
  const subject = fakeSubject(t);
  let closeCalls = 0;
  const connectError = new Error("private-connect-error-must-not-escape");
  connectError.name = "daemon_connect_failed";
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    execute: true,
    env: { PATH: process.env.PATH, LCO_CODEX_TRANSPORT: "daemon" },
    daemonClientFactoryForTest: async () => ({
      async connect() {
        throw connectError;
      },
      async request() {
        throw new Error("unexpected daemon request");
      },
      async close() {
        closeCalls += 1;
        const cleanupError = new Error("private-cleanup-error-must-not-escape");
        cleanupError.name = "daemon_cleanup_failed";
        throw cleanupError;
      }
    }),
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.equal(closeCalls, 1);
  assert.ok(report.blockers.includes("daemon_connect_failed"));
  assert.ok(!report.blockers.includes("daemon_cleanup_failed"));
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.actionsPerformed.sourceStoreMutation, false);
  assert.doesNotMatch(JSON.stringify(report), /private-connect-error-must-not-escape|private-cleanup-error-must-not-escape/);
});

test("eva idle completion accepts only an exact terminal assistant marker", () => {
  assert.doesNotMatch(EVA_IDLE_ROUTE_MESSAGE, /LCO_IDLE_OK/);
  assert.equal(containsTerminalAssistantMarker({ thread: { turns: [{ status: "completed", items: [{ type: "userMessage", text: "LCO_IDLE_OK" }] }] } }), false);
  assert.equal(containsTerminalAssistantMarker({ thread: { turns: [{ status: "inProgress", items: [{ type: "agentMessage", text: "LCO_IDLE_OK" }] }] } }), false);
  assert.equal(containsTerminalAssistantMarker({ thread: { turns: [{ status: "failed", items: [{ type: "agentMessage", text: "LCO_IDLE_OK" }] }] } }), false);
  assert.equal(containsTerminalAssistantMarker({ thread: { turns: [{ status: "completed", items: [{ type: "agentMessage", text: "LCO_IDLE_OK" }] }] } }), true);
  assert.equal(containsTerminalAssistantMarker({ result: { thread: { turns: [{ status: "completed", items: [{ role: "assistant", content: [{ type: "output_text", text: "LCO_IDLE_OK" }] }] }] } } }), true);
  assert.equal(containsTerminalAssistantMarker({ thread: { turns: [{ status: "completed", items: [{ type: "agentMessage", text: "Done: LCO_IDLE_OK" }] }] } }), false);
});

test("eva idle route defaults to non-executing and never starts a task", async (t) => {
  const subject = fakeSubject(t);
  const evidenceDir = tempDir(t, "lco-eva-idle-evidence-");
  const calls: string[] = [];
  const report = await runEvaIdleRoute({
    evidenceDir,
    mcpBin: subject.bin,
    ...packageProof(subject),
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
    ...packageProof(subject),
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
    ...packageProof(subject),
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
    ...packageProof(subject),
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
    ...packageProof(subject),
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
  assert.equal(report.parameterHashes.dryRunSha256, PARAMS_HASH);
  assert.equal(report.parameterHashes.liveSha256, PARAMS_HASH);
  assert.equal(report.lastObservedMarker, "completion_probe");
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /raw-task-id-must-not-escape|opaque_target_for_test|LCO_IDLE_OK|\/private\/audit\.jsonl/i);
  assert.equal(report.subject.packageIntegrity, subject.tarballIntegrity);
  assert.equal(report.subject.packageShasum, subject.tarballShasum);
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

test("eva idle route accepts the package's separate completed live-audit record", async (t) => {
  const subject = fakeSubject(t, { behavior: "separate-live-audit-record" });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    execute: true,
    setupClientFactory: async () => setupClient([]),
    now: "2026-08-24T00:00:00.000Z",
    env: { ...process.env, LCO_EVA_IDLE_CALLS: subject.callsPath }
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.accepted, true);
  assert.equal(report.approvalBindingVerified, true);
  const calls = readFileSync(subject.callsPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { params?: { name?: string; arguments?: { dry_run?: boolean; approval_audit_id?: string } } });
  const liveCalls = calls.filter((call) => call.params?.name === "lco_codex_deliver" && call.params.arguments?.dry_run === false);
  assert.equal(liveCalls.length, 1);
  assert.equal(liveCalls[0]?.params?.arguments?.approval_audit_id, "approval-for-test");
  assert.doesNotMatch(JSON.stringify(report), /approval-for-test|loo_audit_b{32}/);
});

test("eva idle route rejects an unlinked canonical completed live-audit record", async (t) => {
  const subject = fakeSubject(t, { behavior: "separate-live-audit-unlinked" });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    execute: true,
    setupClientFactory: async () => setupClient([]),
    now: "2026-08-24T00:00:00.000Z",
    env: { ...process.env, LCO_EVA_IDLE_CALLS: subject.callsPath }
  });

  assert.equal(report.ok, false);
  assert.equal(report.accepted, false);
  assert.equal(report.approvalBindingVerified, false);
  assert.ok(report.blockers.includes("approval_binding_mismatch"));
  assert.doesNotMatch(JSON.stringify(report), /wrong-approval|loo_audit_b{32}/);
});

test("eva idle route spawns the verified private package snapshot after an original-bin replacement", async (t) => {
  const subject = fakeSubject(t);
  let spawnedBin: string | null = null;
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    spawnFactory: ((...args: Parameters<typeof spawn>) => {
      spawnedBin = String(args[0]);
      writeFileSync(subject.bin, "#!/usr/bin/env node\nprocess.exit(1);\n", { mode: 0o755 });
      return spawn(...args);
    }) as typeof spawn,
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.ok(spawnedBin);
  assert.notEqual(spawnedBin, subject.bin);
});

test("eva idle route promotes the verified npm tar snapshot bin to executable before spawn", async (t) => {
  const subject = fakeSubject(t, { tarballBinMode: 0o644 });
  chmodSync(subject.bin, 0o644);
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.subject.manifestMatchVerified, true);
  assert.equal(report.actionsPerformed.liveCodexControlRun, true);
});

test("eva idle route stops before live delivery after the overall acceptance deadline", async (t) => {
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
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => delayedSetup,
    execute: true,
    completionTimeoutMs: 20,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("outer_deadline_exceeded"));
  const calls = readFileSync(subject.callsPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { params?: { name?: string; arguments?: { dry_run?: boolean } } });
  assert.equal(calls.some((call) => call.params?.name === "lco_codex_deliver" && call.params.arguments?.dry_run === false), false);
});

test("eva idle route bounds live delivery to the remaining overall deadline", async (t) => {
  const subject = fakeSubject(t, { behavior: "slow-live" });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    execute: true,
    completionTimeoutMs: 700,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.equal(report.accepted, false);
  assert.equal(report.approvalBindingVerified, false);
  assert.ok(report.blockers.some((blocker) => /timeout|deadline/.test(blocker)));
});

test("eva idle route requires an explicit package tarball before execution", async (t) => {
  const subject = fakeSubject(t);
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
  assert.ok(report.blockers.includes("package_tarball_required"));
  assert.equal(report.mcpSessionCount, 0);
});

test("eva idle route fails closed when harness provenance resolution fails", async (t) => {
  const subject = fakeSubject(t);
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    repoRoot: join(subject.repoRoot, "missing-checkout"),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });
  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("harness_provenance_unavailable"));
  assert.equal(report.mcpSessionCount, 0);
});

test("eva idle route uses one initialize/list deadline", async (t) => {
  const subject = fakeSubject(t, { behavior: "slow-init-list" });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    execute: true,
    initializeListTimeoutMs: 20,
    now: "2026-08-24T00:00:00.000Z"
  });
  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => /initialize|tools_list|deadline|timeout/.test(blocker)));
});

test("eva idle route rejects contradictory dry-run posture", async (t) => {
  const subject = fakeSubject(t, { behavior: "contradictory-dry-run" });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });
  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("generic_dry_run_rejected"));
});

test("eva idle route rejects a contradictory live delivery status", async (t) => {
  const subject = fakeSubject(t, { behavior: "contradictory-live" });
  const calls: string[] = [];
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient(calls),
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.equal(report.accepted, false);
  assert.equal(report.approvalBindingVerified, false);
  assert.ok(report.blockers.includes("live_delivery_status_invalid"));
  assert.equal(calls.some((call) => call.startsWith("thread/read:")), false);
});

test("eva idle route reserves the receipt destination before live execution", async (t) => {
  const subject = fakeSubject(t);
  const evidenceDir = tempDir(t, "lco-eva-idle-evidence-");
  mkdirSync(join(evidenceDir, "eva-idle-route.json"));
  const calls: string[] = [];

  await assert.rejects(runEvaIdleRoute({
    evidenceDir,
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient(calls),
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  }), /evidence_destination_unavailable/);

  assert.deepEqual(calls, []);
  assert.equal(existsSync(subject.callsPath), false);
});

test("eva idle route rejects an existing receipt before live execution", async (t) => {
  const subject = fakeSubject(t);
  const evidenceDir = tempDir(t, "lco-eva-idle-evidence-");
  writeFileSync(join(evidenceDir, "eva-idle-route.json"), "existing receipt\n", { mode: 0o600 });
  const calls: string[] = [];

  await assert.rejects(runEvaIdleRoute({
    evidenceDir,
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient(calls),
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  }), /evidence_destination_unavailable/);

  assert.deepEqual(calls, []);
  assert.equal(existsSync(subject.callsPath), false);
  assert.equal(readFileSync(join(evidenceDir, "eva-idle-route.json"), "utf8"), "existing receipt\n");
});

test("eva idle route hashes a resolved CLI target when invoked through a symlink", async (t) => {
  const subject = fakeSubject(t);
  const originalArgv1 = process.argv[1];
  const cliLink = join(tempDir(t, "lco-eva-cli-link-"), "lco");
  symlinkSync(fileURLToPath(import.meta.url), cliLink);
  process.argv[1] = cliLink;
  try {
    const report = await runEvaIdleRoute({
      evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
      mcpBin: subject.bin,
      repoRoot: subject.repoRoot,
      expectedMcpBinarySha256: subject.sha256,
      packageVersion: PACKAGE_VERSION,
      candidateSha: CANDIDATE_SHA,
      now: "2026-08-24T00:00:00.000Z"
    });
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.match(report.executing_cli_sha256 ?? "", /^[0-9a-f]{64}$/);
  } finally {
    process.argv[1] = originalArgv1;
  }
});

test("eva idle route resolves the canonical npm MCP bin symlink before validation", async (t) => {
  const subject = fakeSubject(t);
  const npmBinDir = join(dirname(subject.bin), "node_modules", ".bin");
  mkdirSync(npmBinDir, { recursive: true });
  const npmBin = join(npmBinDir, "lco-mcp-server");
  symlinkSync("../../lco-mcp-server.mjs", npmBin);

  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: npmBin,
    repoRoot: subject.repoRoot,
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.subject.mcpBinaryHashVerified, true);
  assert.equal(report.subject.immutablePrefixVerified, true);
  assert.equal(report.blockers.includes("mcp_binary_not_regular"), false);
});

test("eva idle route rejects malformed adapter hashes before receipt assignment", async (t) => {
  const subject = fakeSubject(t, { behavior: "malformed-hash" });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });
  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("approval_hash_invalid"));
  assert.equal(report.parameterHashes.dryRunSha256, null);
  assert.equal(report.messageHashes.dryRunSha256, null);
});

test("eva idle route gives initialize and tools/list their full stage budget after preflight", async (t) => {
  const subject = fakeSubject(t);
  let clock = 0;
  let clockReads = 0;
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    execute: true,
    initializeListTimeoutMs: 500,
    initializeListClockForTest: () => { clockReads += 1; return clock; },
    beforeInitializeListForTest: () => { clock += 1_000; },
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.ok(clockReads >= 3);
  assert.equal(report.stages.find((stage) => stage.name === "mcp_initialize")?.status, "passed");
  assert.equal(report.stages.find((stage) => stage.name === "mcp_tools_list")?.status, "passed");
});

test("eva idle route rejects a completion that settles at the outer deadline", async (t) => {
  const subject = fakeSubject(t);
  const delayed = setupClient([], true);
  delayed.completionObserved = async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return true;
  };
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => delayed,
    execute: true,
    completionTimeoutMs: 700,
    now: "2026-08-24T00:00:00.000Z"
  });
  assert.equal(report.ok, false);
  assert.equal(report.completionSeen, false);
  assert.equal(report.terminalMarkerObserved, false);
  assert.ok(report.blockers.some((blocker) => blocker === "completion_deadline_exceeded" || blocker === "outer_deadline_exceeded"));
});

test("eva idle route confirms forced MCP exit before deleting audit storage", async (t) => {
  const subject = fakeSubject(t, { behavior: "ignore-sigterm" });
  let observedSignal: NodeJS.Signals | null = null;
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    spawnFactory: ((...args: Parameters<typeof spawn>) => {
      const child = spawn(...args);
      child.on("close", (_code, signal) => { observedSignal = signal; });
      return child;
    }) as typeof spawn,
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(observedSignal, "SIGKILL");
  assert.equal(report.auditBoundary.cleanupStatus, "cleaned");
  assert.equal(report.blockers.includes("mcp_process_exit_unconfirmed"), false);
});

test("eva idle route retains audit storage until the forced MCP close event is confirmed", async (t) => {
  const subject = fakeSubject(t, { behavior: "ignore-sigterm-hold-stdio" });
  let auditPath: string | null = null;
  let subjectClosed: Promise<void> | null = null;
  let retainedRoot: string | null = null;
  let snapshotOwner: string | null = null;
  let runtimeRoot: string | null = null;
  let holderPid: number | null = null;
  t.after(async () => {
    try {
      if (holderPid && Number.isInteger(holderPid)) process.kill(holderPid, "SIGKILL");
    } catch {
      // The holder may already be gone; cleanup below remains bounded to this test.
    }
    if (subjectClosed) await subjectClosed;
    if (retainedRoot) rmSync(retainedRoot, { recursive: true, force: true });
    if (snapshotOwner && existsSync(snapshotOwner)) rmSync(snapshotOwner, { recursive: true, force: true });
    if (runtimeRoot && existsSync(runtimeRoot)) rmSync(runtimeRoot, { recursive: true, force: true });
  });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    spawnFactory: ((...args: Parameters<typeof spawn>) => {
      auditPath = (args[2] as { env?: NodeJS.ProcessEnv } | undefined)?.env?.LCO_AUDIT_PATH ?? null;
      runtimeRoot = (args[2] as { env?: NodeJS.ProcessEnv } | undefined)?.env?.HOME ?? null;
      const spawnedBin = String(args[0]);
      if (spawnedBin !== subject.bin && spawnedBin.includes("lco-eva-idle-package-")) snapshotOwner = dirname(dirname(dirname(spawnedBin)));
      const child = spawn(...args);
      subjectClosed = new Promise((resolve) => child.once("close", () => resolve()));
      return child;
    }) as typeof spawn,
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });
  holderPid = Number(readFileSync(`${subject.callsPath}.holder`, "utf8"));
  assert.ok(auditPath);
  retainedRoot = dirname(auditPath);

  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("mcp_process_exit_unconfirmed"));
  assert.ok(report.blockers.includes("audit_boundary_verification_failed"));
  assert.equal(report.auditBoundary.cleanupStatus, "retained_for_operator");
  assert.equal(statSync(retainedRoot).mode & 0o777, 0o700);
  assert.ok(snapshotOwner && existsSync(snapshotOwner));
  assert.ok(report.blockers.includes("runtime_root_retained"));
  assert.ok(runtimeRoot && existsSync(runtimeRoot));
});

test("eva idle route writes a sanitized receipt when audit cleanup fails", async (t) => {
  const subject = fakeSubject(t);
  const evidenceDir = tempDir(t, "lco-eva-idle-evidence-");
  let retainedRoot: string | null = null;
  t.after(() => {
    if (retainedRoot && existsSync(retainedRoot)) rmSync(retainedRoot, { recursive: true, force: true });
  });

  const report = await runEvaIdleRoute({
    evidenceDir,
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([]),
    spawnFactory: ((...args: Parameters<typeof spawn>) => {
      const auditPath = (args[2] as { env?: NodeJS.ProcessEnv } | undefined)?.env?.LCO_AUDIT_PATH;
      retainedRoot = auditPath ? dirname(auditPath) : null;
      return spawn(...args);
    }) as typeof spawn,
    auditRootRemoveForTest: () => { throw new Error("simulated cleanup failure"); },
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("audit_cleanup_failed"));
  assert.ok(report.blockers.includes("audit_boundary_verification_failed"));
  assert.equal(report.auditBoundary.cleanupStatus, "retained_for_operator");
  assert.ok(retainedRoot && existsSync(retainedRoot));
  const receipt = readFileSync(join(evidenceDir, "eva-idle-route.json"), "utf8");
  assert.ok(receipt.length > 0);
  assert.doesNotMatch(receipt, new RegExp(retainedRoot!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("eva idle route rejects and redacts a noncanonical candidate SHA before execution", async (t) => {
  const subject = fakeSubject(t);
  const evidenceDir = tempDir(t, "lco-eva-idle-evidence-");
  const calls: string[] = [];
  const unsafeCandidate = "/tmp/token-shaped-candidate-value";

  const report = await runEvaIdleRoute({
    evidenceDir,
    mcpBin: subject.bin,
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: unsafeCandidate,
    setupClientFactory: async () => setupClient(calls),
    execute: true,
    now: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("candidate_sha_invalid"));
  assert.equal(report.candidateSha, null);
  assert.deepEqual(calls, []);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.ok(report.nextSafeCommands.every((command) => command.includes(`--candidate-sha ${CANDIDATE_SHA}`)));
  assert.ok(report.nextSafeCommands.some((command) => command.includes("npm run build")));
  assert.ok(
    report.nextSafeCommands.some((command) =>
      command.includes("node ./dist/packages/cli/src/index.js qa-lab eva-idle-route")
    )
  );
  assert.ok(report.nextSafeCommands.every((command) => command.startsWith("cd <reviewed-checkout> && ")));
  assert.doesNotMatch(report.nextSafeCommands.join("\n"), /(^|\s)lco qa-lab eva-idle-route\b/);
  const receipt = readFileSync(join(evidenceDir, "eva-idle-route.json"), "utf8");
  assert.doesNotMatch(receipt, /token-shaped-candidate-value/);
});

test("eva idle route preserves the first sanitized live rejection reason", async (t) => {
  const subject = fakeSubject(t, { behavior: "live-reject" });
  const report = await runEvaIdleRoute({
    evidenceDir: tempDir(t, "lco-eva-idle-evidence-"),
    mcpBin: subject.bin,
    ...packageProof(subject),
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
    ...packageProof(subject),
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
    ...packageProof(subject),
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
    ...packageProof(subject),
    expectedMcpBinarySha256: subject.sha256,
    packageVersion: PACKAGE_VERSION,
    candidateSha: CANDIDATE_SHA,
    setupClientFactory: async () => setupClient([], false),
    execute: true,
    completionTimeoutMs: 1_000,
    now: "2026-08-24T00:00:00.000Z"
  });
  assert.equal(report.ok, false);
  assert.equal(report.accepted, true);
  assert.equal(report.completionSeen, false);
  assert.equal(report.terminalMarkerObserved, false);
  assert.ok(report.blockers.includes("completion_deadline_exceeded"));
});

test("eva idle route fails closed for ambiguous, active, expired, or drifted targets", async (t) => {
  for (const behavior of ["route-ambiguous", "route-active", "route-expired", "target-drift"]) {
    const subject = fakeSubject(t, { behavior });
    const report = await runEvaIdleRoute({
      evidenceDir: tempDir(t, `lco-eva-idle-evidence-${behavior}-`),
      mcpBin: subject.bin,
      ...packageProof(subject),
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
    ...packageProof(subject),
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
    ...packageProof(subject),
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
