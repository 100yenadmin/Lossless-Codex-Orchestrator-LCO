import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runOpenClawToolSmoke } from "../packages/cli/src/openclaw-tool-smoke.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
type DryRunOutputShape = "plain" | "content" | "details" | "both";

function createFakeOpenClaw(
  dir: string,
  catalogTools: string[],
  catalogShape: "flat" | "groups" = "flat",
  options: { dryRunOutputShape?: DryRunOutputShape; wrapDryRunOutput?: boolean } = {}
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
  if (name === "loo_codex_plans" || name === "loo_codex_final_messages") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: [{ sourceRef: "codex_thread:" + toolArgs.thread_id, threadId: toolArgs.thread_id, count: 1, text: "super-secret-transcript-span" }] }));
    process.exit(0);
  }
  if (name === "loo_codex_thread_map") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { results: [{ sourceRef: "codex_thread:thread-1", threadId: "thread-1", status: "active" }] } }));
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
  console.log(JSON.stringify({ groups: [{ tools: [
    { id: "loo_doctor" },
    { id: "loo_search_sessions" },
    { id: "loo_describe_session" },
    { id: "loo_expand_query" },
    { id: "loo_codex_plans" },
    { id: "loo_codex_final_messages" },
    { id: "loo_codex_thread_map" },
    { id: "loo_codex_control_dry_run" }
  ] }] }));
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
  const { bin, callsPath } = createFakeOpenClaw(dir, [
    "loo_doctor",
    "loo_search_sessions",
    "loo_describe_session",
    "loo_expand_query",
    "loo_codex_plans",
    "loo_codex_final_messages",
    "loo_codex_thread_map",
    "loo_codex_control_dry_run"
  ]);

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
    assert.equal(report.catalog.requiredToolsPresent, true);
    assert.deepEqual(report.invocations.map((call) => call.toolName), [
      "loo_doctor",
      "loo_search_sessions",
      "loo_describe_session",
      "loo_expand_query",
      "loo_codex_plans",
      "loo_codex_final_messages",
      "loo_codex_thread_map",
      "loo_codex_control_dry_run"
    ]);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_search_sessions")?.summary.sourceRefs?.[0], "codex_thread:thread-1");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_describe_session")?.summary.threadId, "thread-1");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_expand_query")?.summary.profile, "brief");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_codex_control_dry_run")?.summary.live, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_codex_control_dry_run")?.summary.approvalAuditId, "loo_audit_test");
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

test("OpenClaw tool smoke accepts gateway content/details wrapped dry-run proof", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-wrapped-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, [
    "loo_doctor",
    "loo_search_sessions",
    "loo_describe_session",
    "loo_expand_query",
    "loo_codex_plans",
    "loo_codex_final_messages",
    "loo_codex_thread_map",
    "loo_codex_control_dry_run"
  ], "flat", { dryRunOutputShape: "both" });

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
  const { bin, callsPath } = createFakeOpenClaw(dir, [
    "loo_doctor",
    "loo_search_sessions",
    "loo_describe_session",
    "loo_expand_query",
    "loo_codex_plans",
    "loo_codex_final_messages",
    "loo_codex_thread_map",
    "loo_codex_control_dry_run"
  ], "flat", { dryRunOutputShape: "content" });

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

test("OpenClaw tool smoke passes gateway token through env instead of argv", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-token-"));
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
      gatewayTimeoutMs: 12345
    });

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; envTokenPresent?: boolean });
    assert.equal(calls.every((call) => call.envTokenPresent === true), true);
    assert.equal(calls.some((call) => call.args.includes("--token")), false);
    assert.equal(calls.some((call) => call.args.includes("test-gateway-token")), false);
    assert.equal(calls.every((call) => call.args.includes("--timeout")), true);
    assert.equal(calls.every((call) => call.args[call.args.indexOf("--timeout") + 1] === "12345"), true);
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
  const { bin, callsPath } = createFakeOpenClaw(dir, [
    "loo_doctor",
    "loo_search_sessions",
    "loo_describe_session",
    "loo_expand_query",
    "loo_codex_plans",
    "loo_codex_final_messages",
    "loo_codex_thread_map",
    "loo_codex_control_dry_run"
  ], "groups");

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
    assert.equal(report.catalog.toolCount, 8);
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
      rawLeak: /device identity required/
    },
    {
      failureText: "unauthorized: device token mismatch (rotate/reissue device token)",
      expectedBlocker: "openclaw_gateway_device_token_mismatch:loo_doctor",
      rawLeak: /device token mismatch/
    },
    {
      failureText: "gateway tools.invoke requires credentials before opening a websocket",
      expectedBlocker: "openclaw_gateway_credentials_required:loo_doctor",
      rawLeak: /requires credentials before opening a websocket/
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
      assert.doesNotMatch(readFileSync(evidencePath, "utf8"), testCase.rawLeak);
    } finally {
      if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
      else process.env.OPENCLAW_FAKE_CALLS = previous;
    }
  }
});
