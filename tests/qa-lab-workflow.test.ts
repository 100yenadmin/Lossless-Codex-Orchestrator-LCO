import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createQaLabWorkflowReport, type QaLabWorkflowReport } from "../packages/cli/src/qa-lab-workflow.js";
import { callGatewayBackendJson } from "../packages/cli/src/openclaw-tool-smoke.js";
import { startFakeGatewayBackend } from "./helpers/fake-gateway-backend.js";
import { runLoo } from "./helpers/run-loo.js";

const packageVersion = "1.3.0";
const candidateSha = "20d913822d82cad0b5c565b3c9fd3cd527ac0e57";

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
appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify({
  method,
  params,
  argv: args,
  envSecretPresent: Boolean(process.env.NPM_TOKEN || process.env.SECRET_TOKEN || process.env.GITHUB_TOKEN)
}) + "\\n");

if (method === "tools.catalog") {
  const tools = [
    { name: "loo_search_sessions" },
    { name: "loo_describe_ref" },
    { name: "loo_expand_session" },
    { name: "loo_codex_plans" },
    { name: "loo_codex_final_messages" },
    { name: "loo_codex_touched_files" },
    { name: "loo_codex_control_dry_run" },
    { name: "loo_drive" }
  ].filter((tool) => tool.name !== process.env.OPENCLAW_FAKE_MISSING_TOOL);
  if (process.env.OPENCLAW_FAKE_CATALOG_ERROR === "1") {
    console.log(JSON.stringify({ ok: false, status: "error", tools }));
    process.exit(0);
  }
  if (process.env.OPENCLAW_FAKE_DEEP_CATALOG === "1") {
    let output = { tools: [] };
    for (let index = 0; index < 20; index += 1) output = { payload: output };
    console.log(JSON.stringify(output));
    process.exit(0);
  }
  console.log(JSON.stringify({ tools }));
  process.exit(0);
}

if (method === "tools.invoke") {
  const name = params.name;
  const toolArgs = params.args || {};
  if (process.env.OPENCLAW_FAKE_EXIT_NONZERO === name) {
    console.error("fake gateway invocation failed");
    process.exit(9);
  }
  const wrap = (output) => {
    if (process.env.OPENCLAW_FAKE_OMIT_TOOL_OK === name) return { toolName: name, source: "plugin", output };
    if (process.env.OPENCLAW_FAKE_TOOL_OK_FALSE === name) return { ok: false, toolName: name, source: "plugin", output };
    return { ok: true, toolName: name, source: "plugin", output };
  };
  if (name === "loo_search_sessions") {
    let output = process.env.OPENCLAW_FAKE_MISMATCH_SELECTION === "1"
    ? [
        { sourceRef: "codex_thread:z-thread", threadId: "z-thread", score: 10, snippet: "PRIVATE RAW PROMPT CANARY" },
        { sourceRef: "codex_thread:a-thread", threadId: "a-thread", score: 9, snippet: "PRIVATE RAW PROMPT CANARY" }
      ]
      : process.env.OPENCLAW_FAKE_UNSAFE_SOURCE_REF === "1"
        ? [
          { sourceRef: "/Users/lume/private/session.jsonl", threadId: "agent-thread-1", score: 10, snippet: "PRIVATE RAW PROMPT CANARY" }
        ]
      : process.env.OPENCLAW_FAKE_UNSAFE_THREAD_ID === "1"
        ? [
          { sourceRef: "codex_thread:agent-thread-1", threadId: "/Users/lume/private/session.jsonl", score: 10, snippet: "PRIVATE RAW PROMPT CANARY" }
        ]
      : [
        { sourceRef: "codex_thread:agent-thread-1", threadId: "agent-thread-1", score: 10, snippet: "PRIVATE RAW PROMPT CANARY" }
      ];
    if (process.env.OPENCLAW_FAKE_DEEP_SEARCH === "1") {
      output = { sourceRef: "codex_thread:deep-thread", threadId: "deep-thread", score: 10 };
      for (let index = 0; index < 96; index += 1) output = { nested: output };
    }
    console.log(JSON.stringify(wrap(output)));
    process.exit(0);
  }
  if (name === "loo_describe_ref") {
    const output = process.env.OPENCLAW_FAKE_MANY_SOURCE_REFS === "1"
      ? {
        sourceRefs: Array.from({ length: 12 }, (_, index) => "codex_event:event-" + String(index).padStart(2, "0")),
        sourceRef: toolArgs.source_ref,
        threadId: process.env.OPENCLAW_FAKE_DESCRIBE_OTHER_THREAD === "1" ? "other-thread" : toolArgs.source_ref?.replace("codex_thread:", "") || "agent-thread-1",
        title: "Public-safe session card",
        summary: "PRIVATE RAW TRANSCRIPT CANARY"
      }
      : {
      sourceRef: toolArgs.source_ref,
      threadId: process.env.OPENCLAW_FAKE_DESCRIBE_OTHER_THREAD === "1" ? "other-thread" : toolArgs.source_ref?.replace("codex_thread:", "") || "agent-thread-1",
      title: "Public-safe session card",
      summary: "PRIVATE RAW TRANSCRIPT CANARY"
    };
    console.log(JSON.stringify(wrap(output)));
    process.exit(0);
  }
  if (name === "loo_expand_session") {
    console.log(JSON.stringify(wrap({
      sourceRef: "codex_thread:" + toolArgs.thread_id,
      threadId: toolArgs.thread_id,
      profile: "brief",
      tokenBudget: toolArgs.token_budget,
      text: "PRIVATE RAW EXPANSION CANARY"
    })));
    process.exit(0);
  }
  if (name === "loo_codex_plans") {
    console.log(JSON.stringify(wrap([
      { sourceRef: "codex_thread:" + toolArgs.thread_id, text: "PRIVATE RAW PLAN CANARY" }
    ])));
    process.exit(0);
  }
  if (name === "loo_codex_final_messages") {
    console.log(JSON.stringify(wrap([
      { sourceRef: "codex_thread:" + toolArgs.thread_id, text: "PRIVATE RAW FINAL CANARY" }
    ])));
    process.exit(0);
  }
  if (name === "loo_codex_touched_files") {
    console.log(JSON.stringify(wrap({
      files: ["/Users/lume/private/project/secret.ts"],
      count: 1
    })));
    process.exit(0);
  }
  if (name === "loo_codex_control_dry_run") {
    const output = {
      action: "resume",
      threadId: toolArgs.thread_id,
      approvalAuditId: process.env.OPENCLAW_FAKE_UNSAFE_DRY_RUN_AUDIT === "1" ? "/Users/lume/private/audit.jsonl" : "loo_audit_agent_workflow",
      paramsHash: process.env.OPENCLAW_FAKE_UNSAFE_DRY_RUN_AUDIT === "1" ? "Bearer secret" : "params-hash"
    };
    if (process.env.OPENCLAW_FAKE_DRY_RUN_LIVE_TRUE === "1") output.live = true;
    else if (process.env.OPENCLAW_FAKE_DRY_RUN_LIVE_STRING === "1") output.live = "false";
    else if (process.env.OPENCLAW_FAKE_OMIT_DRY_RUN_LIVE !== "1") output.live = false;
    const responseOutput = process.env.OPENCLAW_FAKE_PLAIN_DRY_RUN === "1"
      ? output
      : {
        content: [{ type: "text", text: "redacted dry-run packet" }],
        details: output
      };
    console.log(JSON.stringify(wrap(responseOutput)));
    process.exit(0);
  }
  if (name === "loo_drive") {
    const output = {
      schema: "lco.drive.report.v1",
      status: "dry_run_ready",
      surface: "openclaw-gateway",
      target: { ref: toolArgs.target_ref, driver: toolArgs.driver },
      dryRun: {
        live: false,
        approvalAuditId: "loo_audit_drive_workflow",
        paramsHash: "drive-params-hash"
      },
      actionsPerformed: {
        liveControl: false,
        externalWrite: false
      }
    };
    console.log(JSON.stringify(wrap(process.env.OPENCLAW_FAKE_DRIVE_DETAILS === "1"
      ? { content: [{ type: "text", text: "redacted drive packet" }], details: output }
      : output)));
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
    packageVersion,
    candidateSha,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath },
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.schema, "lco.qaLab.workflowRun.v1");
  assert.equal(report.packageVersion, packageVersion);
  assert.equal(report.candidateSha, candidateSha);
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
    "loo_codex_control_dry_run",
    "loo_drive"
  ]);
  assert.equal(report.workflow.selectedSourceRef, "codex_thread:agent-thread-1");
  assert.match(report.command, /tools\.catalog\/tools\.invoke/);
  assert.equal(report.workflow.rawTranscriptReadRequired, false);
  assert.equal(report.workflow.recommendedNextAction.kind, "dry_run_resume");
  assert.equal(report.workflow.recommendedNextAction.tool, "loo_drive");
  assert.equal(report.workflow.dryRunControl.live, false);
  assert.equal(report.workflow.dryRunControl.approvalAuditId, "loo_audit_drive_workflow");
  assert.equal(report.workflow.dryRunControl.paramsHash, "drive-params-hash");
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
  assert.doesNotMatch(serialized, /\.jsonl|\.sqlite|screenshot|token|cookie/i);

  const savedArtifact = readFileSync(join(dir, "workflow-run.json"), "utf8");
  assert.doesNotMatch(savedArtifact, /PRIVATE RAW|\/Users\/lume|\.jsonl|\.sqlite|screenshot|token|cookie/i);
  const saved = JSON.parse(savedArtifact) as QaLabWorkflowReport;
  assert.equal(saved.schema, "lco.qaLab.workflowRun.v1");
  assert.equal(saved.packageVersion, packageVersion);
  assert.equal(saved.candidateSha, candidateSha);

  const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls.filter((call) => call.method === "tools.catalog").length, 1);
  assert.equal(calls.filter((call) => call.method === "tools.invoke").length, 8);
  const driveCall = calls.find((call) => call.params?.name === "loo_drive");
  assert.equal(driveCall.params.args.target_ref, "codex_thread:agent-thread-1");
  assert.equal(driveCall.params.args.reviewer, "claude");
  assert.equal(driveCall.params.args.driver, "codex");
  assert.equal(driveCall.params.args.dry_run, true);
  assert.equal(calls.some((call) => call.envSecretPresent), false);
  assert.ok(calls
    .filter((call) => call.method === "tools.invoke")
    .every((call) => /^loo-qa-workflow-[a-f0-9]{24}-loo_/.test(call.params.idempotencyKey)));
});

test("qa-lab workflow routes every gateway call through the selected OpenClaw profile", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-profile-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-777-profile-routing",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    profile: "lco-dogfood",
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath }
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls.length, 9);
  for (const call of calls) {
    assert.deepEqual(call.argv.slice(0, 2), ["--profile", "lco-dogfood"]);
    assert.equal(call.argv[2], "gateway");
  }
  assert.match(report.command, /^openclaw-fake\.mjs --profile <profile> gateway call/);
});

test("qa-lab workflow keeps explicit gateway tokens out of OpenClaw argv", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-token-transport-");
  const { bin, callsPath } = createFakeOpenClaw(dir);
  const token = "scoped-test-gateway-token";

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-756-gateway-token-transport",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    gatewayUrl: "ws://127.0.0.1:65534",
    token,
    gatewayTimeoutMs: 250,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath }
  });

  assert.equal(existsSync(callsPath), false, "explicit URL+token calls must use the environment-only gateway backend instead of OpenClaw argv");
  assert.equal(report.command, "loo backend-gateway tools.catalog/tools.invoke --json --params <redacted>");
  assert.doesNotMatch(JSON.stringify(report), new RegExp(token));
  assert.doesNotMatch(readFileSync(join(dir, "workflow-run.json"), "utf8"), new RegExp(token));
});

test("qa-lab workflow completes through the authenticated backend transport", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-backend-round-trip-");
  const { server, port, capturePath } = startFakeGatewayBackend(dir);
  t.after(() => server.kill("SIGTERM"));

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-756-backend-round-trip",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    gatewayUrl: `ws://127.0.0.1:${port}`,
    token: "scoped-test-gateway-token",
    gatewayTimeoutMs: 5000
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.command, "loo backend-gateway tools.catalog/tools.invoke --json --params <redacted>");
  assert.equal(report.workflow.toolsInvoked.length, 8);
  assert.equal(report.workflow.dryRunControl.live, false);
  const frames = readFileSync(capturePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(frames.filter((frame) => frame.method === "tools.catalog").length, 1);
  assert.equal(frames.filter((frame) => frame.method === "tools.invoke").length, 8);
  assert.ok(frames.filter((frame) => frame.method === "tools.invoke").every((frame) => /^loo-qa-workflow-[a-f0-9]{24}-loo_/.test(frame.params.idempotencyKey)));
});

test("qa-lab workflow fails closed when a scoped token has no explicit gateway URL", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-token-without-url-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-756-token-without-url",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    token: "scoped-test-gateway-token",
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath }
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "workflow_gateway_token_requires_url"));
  assert.equal(existsSync(callsPath), false, "ambiguous token-only auth must fail before spawning OpenClaw");
});

test("qa-lab workflow rejects a profile on the direct authenticated backend transport", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-profile-backend-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-777-profile-routing",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    profile: "lco-dogfood",
    gatewayUrl: "ws://127.0.0.1:18790",
    token: "scoped-token",
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath }
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "workflow_profile_backend_transport_unsupported"));
  assert.throws(() => readFileSync(callsPath, "utf8"), /ENOENT/);
});

test("gateway backend child strips ambient Node startup controls", () => {
  const result = callGatewayBackendJson(
    "ws://127.0.0.1:65534",
    "scoped-test-gateway-token",
    "tools.catalog",
    {},
    1000,
    { ...process.env, NODE_OPTIONS: "--eval=process.exit(91)" }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /gateway websocket error/);
  assert.doesNotMatch(result.stderr, /NODE_OPTIONS|--eval/);
});

test("qa-lab workflow reads drive proof from the real OpenClaw content/details envelope", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-drive-details-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-756-drive-details-envelope",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_DRIVE_DETAILS: "1" }
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.workflow.dryRunControl.live, false);
  assert.equal(report.workflow.dryRunControl.approvalAuditId, "loo_audit_drive_workflow");
  assert.equal(report.workflow.dryRunControl.paramsHash, "drive-params-hash");
});

test("qa-lab workflow fails closed when a required gateway tool is missing", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-missing-tool-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_MISSING_TOOL: "loo_expand_session" }
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "openclaw_workflow_catalog_missing_required_tools"));
});

test("qa-lab workflow fails closed when catalog reports an error shape", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-catalog-error-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_CATALOG_ERROR: "1" }
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "openclaw_workflow_catalog_not_ok"));
  assert.equal(report.workflow.toolsInvoked.length, 0);
});

test("qa-lab workflow fails closed when a tool reports ok false", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-ok-false-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_TOOL_OK_FALSE: "loo_describe_ref" }
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "openclaw_workflow_tool_not_ok:loo_describe_ref"));
  const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls.filter((call) => call.method === "tools.invoke").length, 2);
});

test("qa-lab workflow fails closed when a tool omits affirmative ok", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-missing-ok-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_OMIT_TOOL_OK: "loo_describe_ref" }
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "openclaw_workflow_tool_not_ok:loo_describe_ref"));
});

test("qa-lab workflow fails closed when a tool exits nonzero", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-nonzero-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_EXIT_NONZERO: "loo_describe_ref" }
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "openclaw_workflow_tool_failed:loo_describe_ref"));
});

test("qa-lab workflow fails closed on malformed deep gateway wrappers", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-deep-wrapper-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_DEEP_CATALOG: "1" }
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "openclaw_workflow_catalog_missing_required_tools"));
});

test("qa-lab workflow rejects unsafe public summary identifiers", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-unsafe-summary-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_UNSAFE_THREAD_ID: "1" }
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "openclaw_workflow_output_summary_not_public_safe:loo_search_sessions"));
  assert.equal(report.workflow.steps.find((step) => step.step === "search")?.outputSummary.threadId, undefined);
  assert.doesNotMatch(JSON.stringify(report), /\/Users\/lume|session\.jsonl/);
  assert.doesNotMatch(readFileSync(join(dir, "workflow-run.json"), "utf8"), /\/Users\/lume|session\.jsonl/);
});

test("qa-lab workflow rejects unsafe selected source refs while keeping the artifact public-safe", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-unsafe-source-ref-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_UNSAFE_SOURCE_REF: "1" }
  });

  assert.equal(report.ok, false);
  assert.equal(report.workflow.selectedSourceRef, null);
  assert.equal(report.workflow.selectedThreadId, "agent-thread-1");
  assert.ok(report.blockers.some((blocker) => blocker.code === "workflow_selected_source_ref_not_public_safe"));
  assert.doesNotMatch(JSON.stringify(report), /\/Users\/lume|session\.jsonl/);
  assert.doesNotMatch(readFileSync(join(dir, "workflow-run.json"), "utf8"), /\/Users\/lume|session\.jsonl/);
});

test("qa-lab workflow writes dry-run audit fields only after summary sanitization", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-unsafe-dry-run-audit-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_UNSAFE_DRY_RUN_AUDIT: "1" }
  });

  assert.equal(report.ok, false);
  assert.equal(report.workflow.dryRunControl.approvalAuditId, null);
  assert.equal(report.workflow.dryRunControl.paramsHash, null);
  assert.ok(report.blockers.some((blocker) => blocker.code === "openclaw_workflow_output_summary_not_public_safe:loo_codex_control_dry_run"));
  assert.doesNotMatch(JSON.stringify(report), /\/Users\/lume|Bearer secret/);
  assert.doesNotMatch(readFileSync(join(dir, "workflow-run.json"), "utf8"), /\/Users\/lume|Bearer secret/);
});

test("qa-lab workflow requires dry-run control to explicitly report live false", (t) => {
  const missingDir = makeTempDir(t, "loo-qa-workflow-live-missing-");
  const missing = createFakeOpenClaw(missingDir);
  const missingReport = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: missingDir,
    openclawBin: missing.bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: missing.callsPath, OPENCLAW_FAKE_OMIT_DRY_RUN_LIVE: "1" }
  });
  assert.equal(missingReport.ok, false);
  assert.ok(missingReport.blockers.some((blocker) => blocker.code === "workflow_dry_run_control_live_missing"));

  const trueDir = makeTempDir(t, "loo-qa-workflow-live-true-");
  const liveTrue = createFakeOpenClaw(trueDir);
  const trueReport = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: trueDir,
    openclawBin: liveTrue.bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: liveTrue.callsPath, OPENCLAW_FAKE_DRY_RUN_LIVE_TRUE: "1" }
  });
  assert.equal(trueReport.ok, false);
  assert.ok(trueReport.blockers.some((blocker) => blocker.code === "workflow_dry_run_control_not_false"));

  const stringDir = makeTempDir(t, "loo-qa-workflow-live-string-");
  const liveString = createFakeOpenClaw(stringDir);
  const stringReport = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: stringDir,
    openclawBin: liveString.bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: liveString.callsPath, OPENCLAW_FAKE_DRY_RUN_LIVE_STRING: "1" }
  });
  assert.equal(stringReport.ok, false);
  assert.ok(stringReport.blockers.some((blocker) => blocker.code === "workflow_dry_run_control_live_missing"));
});

test("qa-lab workflow selects source ref and thread id from the same session card", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-selection-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_MISMATCH_SELECTION: "1" }
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.workflow.selectedSourceRef, "codex_thread:z-thread");
  assert.equal(report.workflow.selectedThreadId, "z-thread");
  const invokedSteps = report.workflow.steps.filter((step) => step.toolName.startsWith("loo_"));
  assert.ok(invokedSteps.every((step) => step.outputSummary.sourceRefs?.includes("codex_thread:z-thread")), JSON.stringify(invokedSteps, null, 2));
});

test("qa-lab workflow keeps the selected source ref in each published step summary", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-selected-ref-summary-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_MANY_SOURCE_REFS: "1" }
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  const describeStep = report.workflow.steps.find((step) => step.step === "describe");
  assert.ok(describeStep?.outputSummary.sourceRefs?.includes("codex_thread:agent-thread-1"));
});

test("qa-lab workflow binds request-scoped step thread ids to the selected session", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-step-thread-binding-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_DESCRIBE_OTHER_THREAD: "1" }
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  const describeStep = report.workflow.steps.find((step) => step.step === "describe");
  const expandStep = report.workflow.steps.find((step) => step.step === "expand");
  assert.equal(describeStep?.outputSummary.threadId, "agent-thread-1");
  assert.equal(expandStep?.outputSummary.threadId, "agent-thread-1");
});

test("qa-lab workflow fails closed when selectable session is beyond scan depth", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-deep-search-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath, OPENCLAW_FAKE_DEEP_SEARCH: "1" }
  });

  assert.equal(report.ok, false);
  assert.equal(report.workflow.selectedSourceRef, null);
  assert.equal(report.workflow.selectedThreadId, null);
  assert.ok(report.blockers.some((blocker) => blocker.code === "workflow_selected_session_missing"));
});

test("qa-lab workflow uses deterministic idempotency keys for retry-safe gateway calls", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-idempotency-");
  const { bin, callsPath } = createFakeOpenClaw(dir);
  const options = {
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway" as const,
    mode: "dry-run" as const,
    evidenceDir: dir,
    openclawBin: bin,
    sessionKey: "agent:test:workflow",
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath }
  };

  const first = createQaLabWorkflowReport(options);
  const second = createQaLabWorkflowReport(options);
  const third = createQaLabWorkflowReport({ ...options, profile: "lco-dogfood" });

  assert.equal(first.ok, true, JSON.stringify(first, null, 2));
  assert.equal(second.ok, true, JSON.stringify(second, null, 2));
  const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const invokeKeys = calls
    .filter((call) => call.method === "tools.invoke")
    .map((call) => call.params.idempotencyKey);
  assert.deepEqual(invokeKeys.slice(0, 8), invokeKeys.slice(8, 16));
  assert.notDeepEqual(invokeKeys.slice(0, 8), invokeKeys.slice(16, 24));
});

test("qa-lab workflow rejects unsafe OpenClaw profile names before spawning", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-profile-invalid-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-777-profile-routing",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    profile: "../../private profile",
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath }
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "workflow_profile_invalid"));
  assert.throws(() => readFileSync(callsPath, "utf8"), /ENOENT/);
  assert.doesNotMatch(JSON.stringify(report), /private profile/);
});

test("qa-lab workflow fails closed without spawning more calls after deadline exhaustion", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-deadline-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    gatewayTimeoutMs: 0,
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath }
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "openclaw_workflow_catalog_failed"));
  assert.throws(() => readFileSync(callsPath, "utf8"), /ENOENT/);
});

test("qa-lab workflow rejects untrusted OpenClaw binary names before spawning", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-untrusted-bin-");

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: "/bin/sh"
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "workflow_openclaw_bin_untrusted_name"));
  assert.equal(report.workflow.steps.length, 0);
});

test("qa-lab workflow rejects non-loopback gateway URLs before spawning", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-gateway-url-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const report = createQaLabWorkflowReport({
    scenarioId: "issue-517-agent-workflow",
    surface: "openclaw-gateway",
    mode: "dry-run",
    evidenceDir: dir,
    openclawBin: bin,
    gatewayUrl: "ws://example.com:1234",
    env: { ...process.env, OPENCLAW_FAKE_CALLS: callsPath }
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "workflow_gateway_url_not_loopback"));
  assert.throws(() => readFileSync(callsPath, "utf8"), /ENOENT/);
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

test("loo qa-lab workflow fails closed on bad candidate sha without echoing it", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-cli-bad-sha-");

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
    "--candidate-sha",
    "/tmp/private-candidate.jsonl",
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as QaLabWorkflowReport;
  assert.equal(report.candidateSha, null);
  assert.ok(report.blockers.some((blocker) => blocker.code === "candidate_sha_invalid"));
  assert.doesNotMatch(result.stdout, /private-candidate\.jsonl/);
  assert.doesNotMatch(result.stdout, /\/tmp\//);
});

test("loo qa-lab workflow rejects invalid gateway timeout values at the CLI boundary", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-timeout-cli-");

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
    "--gateway-timeout-ms",
    "0"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--gateway-timeout-ms requires an integer between 1 and 600000/);

  const missing = runLoo([
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
    "--gateway-timeout-ms"
  ]);

  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--gateway-timeout-ms requires a value/);
});

test("loo qa-lab workflow ignores an ambient gateway token without an explicit URL", (t) => {
  const dir = makeTempDir(t, "loo-qa-workflow-cli-ambient-token-");
  const { bin, callsPath } = createFakeOpenClaw(dir);

  const result = runLoo([
    "qa-lab",
    "workflow",
    "--scenario-id",
    "issue-756-ambient-token",
    "--surface",
    "openclaw-gateway",
    "--mode",
    "dry-run",
    "--openclaw-bin",
    bin,
    "--profile",
    "lco-dogfood",
    "--evidence-dir",
    dir,
    "--strict"
  ], {
    ...process.env,
    OPENCLAW_FAKE_CALLS: callsPath,
    OPENCLAW_GATEWAY_TOKEN: "ambient-token-for-another-client"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as QaLabWorkflowReport;
  assert.equal(report.workflowRunReady, true);
  assert.equal(report.command.startsWith("openclaw-fake.mjs --profile <profile> gateway call"), true);
  const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls.length, 9);
  assert.equal(calls.every((call) => call.argv[0] === "--profile" && call.argv[1] === "lco-dogfood"), true);
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
    "--openclaw-bin",
    bin,
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ], { ...process.env, OPENCLAW_FAKE_CALLS: callsPath });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as QaLabWorkflowReport;
  assert.equal(report.schema, "lco.qaLab.workflowRun.v1");
  assert.equal(report.packageVersion, packageVersion);
  assert.equal(report.candidateSha, candidateSha);
  assert.equal(report.workflowRunReady, true);
  assert.equal(report.workflow.toolsInvoked.length, 8);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE RAW|\/Users\/lume|\.jsonl|\.sqlite|screenshot|token|cookie/i);
  assert.doesNotMatch(readFileSync(join(dir, "workflow-run.json"), "utf8"), /PRIVATE RAW|\/Users\/lume|\.jsonl|\.sqlite|screenshot|token|cookie/i);
});
