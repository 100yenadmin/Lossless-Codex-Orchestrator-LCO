import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createQaLabWorkflowReport, type QaLabWorkflowReport } from "../packages/cli/src/qa-lab-workflow.js";
import { runLoo } from "./helpers/run-loo.js";

function makeTempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function createFakeOpenClaw(dir: string): { bin: string; callsPath: string } {
  const callsPath = join(dir, "openclaw-calls.jsonl");
  const bin = join(dir, "openclaw-fake.mjs");
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const callIndex = args.indexOf("call");
const method = callIndex >= 0 ? args[callIndex + 1] : "";
const paramsIndex = args.indexOf("--params");
const params = paramsIndex >= 0 ? JSON.parse(args[paramsIndex + 1] || "{}") : {};
appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify({ method, params }) + "\\n");

if (method === "tools.catalog") {
  console.log(JSON.stringify({ tools: [
    { name: "loo_search_sessions" },
    { name: "loo_describe_ref" },
    { name: "loo_expand_session" },
    { name: "loo_codex_plans" },
    { name: "loo_codex_final_messages" },
    { name: "loo_codex_touched_files" },
    { name: "loo_codex_control_dry_run" }
  ] }));
  process.exit(0);
}

if (method === "tools.invoke") {
  const name = params.name;
  const toolArgs = params.args || {};
  if (name === "loo_search_sessions") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: [
      { sourceRef: "codex_thread:agent-thread-1", threadId: "agent-thread-1", score: 10, snippet: "PRIVATE RAW PROMPT CANARY" }
    ] }));
    process.exit(0);
  }
  if (name === "loo_describe_ref") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: {
      sourceRef: toolArgs.source_ref,
      threadId: "agent-thread-1",
      title: "Public-safe session card",
      summary: "PRIVATE RAW TRANSCRIPT CANARY"
    } }));
    process.exit(0);
  }
  if (name === "loo_expand_session") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: {
      sourceRef: "codex_thread:agent-thread-1",
      threadId: "agent-thread-1",
      profile: "brief",
      tokenBudget: toolArgs.token_budget,
      text: "PRIVATE RAW EXPANSION CANARY"
    } }));
    process.exit(0);
  }
  if (name === "loo_codex_plans") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: [
      { sourceRef: "codex_thread:agent-thread-1", text: "PRIVATE RAW PLAN CANARY" }
    ] }));
    process.exit(0);
  }
  if (name === "loo_codex_final_messages") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: [
      { sourceRef: "codex_thread:agent-thread-1", text: "PRIVATE RAW FINAL CANARY" }
    ] }));
    process.exit(0);
  }
  if (name === "loo_codex_touched_files") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: {
      files: ["/Users/lume/private/project/secret.ts"],
      count: 1
    } }));
    process.exit(0);
  }
  if (name === "loo_codex_control_dry_run") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: {
      action: "resume",
      threadId: toolArgs.thread_id,
      live: false,
      approvalAuditId: "loo_audit_agent_workflow",
      paramsHash: "params-hash"
    } }));
    process.exit(0);
  }
}

console.error("unexpected fake OpenClaw call");
process.exit(7);
`);
  chmodSync(bin, 0o755);
  return { bin, callsPath };
}

test("qa-lab workflow creates a public-safe dry-run OpenClaw gateway report", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath },
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.schema, "lco.qaLab.workflowRun.v1");
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.workflowRunReady, true);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.workflow.toolsInvoked, [
    "loo_search_sessions",
    "loo_describe_ref",
    "loo_expand_session",
    "loo_codex_plans",
    "loo_codex_final_messages",
    "loo_codex_touched_files",
    "loo_codex_control_dry_run"
  ]);
  assert.equal(report.workflow.selectedSourceRef, "codex_thread:agent-thread-1");
  assert.equal(report.workflow.rawTranscriptReadRequired, false);
  assert.equal(report.workflow.recommendedNextAction.kind, "dry_run_resume");
  assert.equal(report.workflow.dryRunControl.live, false);
  assert.deepEqual(report.actionsPerformed, {
    liveCodexControlRun: false,
    desktopGuiActionRun: false,
    rawTranscriptRead: false,
    rawPromptRead: false,
    screenCaptureRun: false,
    sourceStoreMutation: false,
    gatewayScopeApproval: false,
    npmPublished: false,
    githubReleaseCreated: false
  });

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /PRIVATE RAW/);
  assert.doesNotMatch(serialized, /\/Users\/lume/);
  assert.doesNotMatch(serialized, /\\.jsonl|\\.sqlite|screenshot|token|cookie/i);

  const saved = JSON.parse(readFileSync(join(dir, "workflow-run.json"), "utf8")) as QaLabWorkflowReport;
  assert.equal(saved.schema, "lco.qaLab.workflowRun.v1");

  const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls.filter((call) => call.method === "tools.catalog").length, 1);
  assert.equal(calls.filter((call) => call.method === "tools.invoke").length, 7);
});

test("qa-lab workflow fails closed for unsupported surfaces and live mode", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-blocked-");

  const unsupported = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "cli",
    mode: "dry-run",
    evidenceDir: dir
  });
  assert.equal(unsupported.ok, false);
  assert.ok(unsupported.blockers.some((blocker) => blocker.code === "workflow_surface_not_supported"));

  const live = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "live-approved",
    evidenceDir: dir
  });
  assert.equal(live.ok, false);
  assert.ok(live.blockers.some((blocker) => blocker.code === "workflow_mode_not_supported"));
  assert.equal(live.actionsPerformed.liveCodexControlRun, false);
});

test("loo qa-lab workflow --strict exits nonzero when the workflow is blocked", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-cli-blocked-");

  const result = runLoo([
    "qa-lab",
    "workflow",
    "--scenario-id",
    "issue-517-agent-workflow",
    "--surface",
    "desktop-contract",
    "--mode",
    "dry-run",
    "--evidence-dir",
    dir,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as QaLabWorkflowReport;
  assert.equal(report.schema, "lco.qaLab.workflowRun.v1");
  assert.ok(report.blockers.some((blocker) => blocker.code === "workflow_surface_not_supported"));
});

test("loo qa-lab workflow writes a strict public-safe report through fake OpenClaw", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-cli-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const result = runLoo([
    "qa-lab",
    "workflow",
    "--scenario-id",
    "issue-517-agent-workflow",
    "--surface",
    "openclaw-gateway",
    "--mode",
    "dry-run",
    "--evidence-dir",
    dir,
    "--strict"
  ], { ...process.env, LOO_OPENCLAW_BIN: bin, OPENCLAW_FAKE_CALLS: callsPath });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as QaLabWorkflowReport;
  assert.equal(report.schema, "lco.qaLab.workflowRun.v1");
  assert.equal(report.workflowRunReady, true);
  assert.equal(report.workflow.toolsInvoked.length, 7);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE RAW|\/Users\/lume|\\.jsonl|\\.sqlite|screenshot|token|cookie/i);
});
