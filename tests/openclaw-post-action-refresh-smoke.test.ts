import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { runOpenClawPostActionRefreshSmoke } from "../packages/cli/src/openclaw-post-action-refresh-smoke.js";
import { createScenarioSweep } from "../packages/cli/src/scenario-sweep.js";
import { startFakeGatewayBackend } from "./helpers/fake-gateway-backend.js";

const tsxImport = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const TARGET_THREAD_ID = "thr_gateway_live";
const TARGET_REF = `codex_thread:${TARGET_THREAD_ID}`;
const OTHER_REF = "codex_thread:other";

test("OpenClaw post-action refresh keeps explicit gateway credentials out of OpenClaw argv", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-backend-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath, { targetRef: "codex_thread:backend-thread" });
  const { server, port, capturePath } = startFakeGatewayBackend(root);
  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: join(root, "must-not-run-openclaw"),
      gatewayUrl: `ws://127.0.0.1:${port}`,
      token: "scoped-refresh-token",
      evidenceDir,
      liveProofReportPath,
      threadId: "backend-thread",
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.command, "loo backend-gateway tools.catalog/tools.invoke --json --params <redacted>");
    assert.doesNotMatch(readFileSync(capturePath, "utf8"), /scoped-refresh-token/);
  } finally {
    server.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh rejects plaintext remote gateway URLs before sending a token", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-remote-ws-"));
  const liveProofReportPath = join(root, "live-proof.json");
  writeLiveProofReport(liveProofReportPath, { targetRef: "codex_thread:backend-thread" });
  try {
    const report = runOpenClawPostActionRefreshSmoke({
      gatewayUrl: "ws://gateway.example.test:18789",
      token: "must-not-leave-process",
      evidenceDir: join(root, "evidence"),
      liveProofReportPath,
      threadId: "backend-thread"
    });
    assert.equal(report.ok, false);
    assert.ok(report.blockers.includes("post_action_refresh_gateway_url_insecure"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh preserves ambient configured-profile token auth without argv exposure", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-profile-token-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "live-proof.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root);
  const previousCalls = process.env.OPENCLAW_FAKE_CALLS;
  const previousToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  process.env.OPENCLAW_GATEWAY_TOKEN = "ambient-profile-token";
  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      profile: "lco-refresh-profile",
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; hasTokenEnv: boolean });
    assert.equal(calls.every((call) => call.hasTokenEnv), true);
    assert.equal(calls.some((call) => call.args.includes("--token") || call.args.includes("ambient-profile-token")), false);
  } finally {
    if (previousCalls === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previousCalls;
    if (previousToken === undefined) delete process.env.OPENCLAW_GATEWAY_TOKEN;
    else process.env.OPENCLAW_GATEWAY_TOKEN = previousToken;
    rmSync(root, { recursive: true, force: true });
  }
});

function writeLiveProofReport(path: string, overrides: Record<string, unknown> = {}): void {
  writeFileSync(path, `${JSON.stringify({
    ok: true,
    proofReady: true,
    publicSafe: true,
    generatedAt: "2026-07-01T00:01:00.000Z",
    targetRef: TARGET_REF,
    dryRun: {
      approvalAuditId: "loo_audit_abcd1234",
      paramsHash: "a".repeat(64),
      messageHash: "b".repeat(64),
      live: false
    },
    live: {
      approvalAuditId: "loo_audit_def45678",
      paramsHash: "a".repeat(64),
      messageHash: "b".repeat(64),
      live: true,
      method: "turn/start",
      turnStatus: "completed",
      actionObservedAt: "2026-07-01T00:01:00.000Z"
    },
    authorization: {
      approvalAuditIdUsed: "loo_audit_abcd1234",
      approvalAuditIdMatchesDryRun: true
    },
    blockers: [],
    actionsPerformed: {
      liveCodexControlRun: true,
      desktopGuiActionRun: false,
      npmPublished: false,
      githubReleaseCreated: false,
      rawTranscriptRead: false
    },
    ...overrides
  }, null, 2)}\n`);
}

function createFakeOpenClaw(dir: string, options: { rawExpansion?: boolean; rawContentEnvelope?: boolean; detailsNotOk?: boolean; directDetailsErrorStatus?: boolean; nestedDetailsResponseNotOk?: boolean; nestedSuccessWrapper?: boolean; nestedDomainFailureStatus?: boolean; directDomainFailureStatus?: boolean; directDetailsEnvelope?: boolean; directDetailsOk?: boolean; detailsWithoutContent?: boolean; staleSearchAndExpansion?: boolean; nestedTargetOnlyExpansion?: boolean; nestedTargetOnlyCoreOutputs?: boolean; nestedArrayTargetOnlySearch?: boolean; staleRefreshTimestamp?: boolean; missingRefreshTimestamp?: boolean; nestedRefreshTimestampOnly?: boolean; missingMapMarkers?: boolean; publicThreadMapShape?: boolean; missingMapStatus?: boolean; nestedStatusLookalike?: boolean; topLevelStatusLookalike?: boolean; domainEnvelopeLookalikes?: boolean; alternateTopLevelSearchCollection?: boolean; detailsEnvelope?: boolean } = {}): { bin: string; callsPath: string } {
  const callsPath = join(dir, "calls.jsonl");
  const bin = join(dir, "openclaw-refresh-fake.mjs");
  const refreshedAt = options.staleRefreshTimestamp ? "2026-07-01T00:00:30.000Z" : "2026-07-01T00:02:00.000Z";
  const sourceUpdatedAt = "2026-07-01T00:01:00.000Z";
  const publicRefreshedAt = options.missingRefreshTimestamp || options.nestedRefreshTimestampOnly ? "" : `refreshedAt: "${refreshedAt}",`;
  const nestedRefreshedAt = options.nestedRefreshTimestampOnly ? `related: { refreshedAt: "${refreshedAt}" },` : "";
  const expansionText = options.rawExpansion
    ? "RAW_TRANSCRIPT: private raw session text"
    : "Safe post-action evidence bundle. Raw transcript omitted. Source refs preserved.";
  const threadMapOutput = options.publicThreadMapShape
    ? `{
      threads: [{
        threadId: "${TARGET_THREAD_ID}",
        title: "Gateway live smoke",
        summary: "Post-action safe summary delta marker",
        updatedAt: "${sourceUpdatedAt}",
        ${publicRefreshedAt}
        ${nestedRefreshedAt}
        ${options.topLevelStatusLookalike ? 'status: "transport-ok",' : ""}
        metadata: { status: ${options.missingMapStatus ? "null" : "\"active\""} },
        ${options.nestedStatusLookalike ? 'related: { status: "blocked" },' : ""}
      }]
    }`
    : options.missingMapMarkers
    ? `{
      targetRef: "${TARGET_REF}",
      sourceRefs: ["${TARGET_REF}"]
    }`
    : `{
      targetRef: "${TARGET_REF}",
      statusBucket: "active",
      refreshedAt: "${refreshedAt}",
      sourceRefs: ["${TARGET_REF}"]${options.domainEnvelopeLookalikes ? ', details: { note: "domain details" }, result: { note: "domain result" }' : ""}
    }`;
  const searchResults = options.nestedArrayTargetOnlySearch
    ? `[
        { sourceRef: "${OTHER_REF}", title: "Different thread", safeSummary: "Post-action safe summary delta marker", updatedAt: "2026-07-01T00:02:01.000Z", items: [{ sourceRef: "${TARGET_REF}" }] }
      ]`
    : options.staleSearchAndExpansion || options.nestedTargetOnlyCoreOutputs
    ? `[
        { sourceRef: "${OTHER_REF}", title: "Different thread", safeSummary: "Post-action safe summary delta marker", updatedAt: "2026-07-01T00:02:01.000Z", related: { sourceRef: "${TARGET_REF}" } }
      ]`
    : `[
        { sourceRef: "${TARGET_REF}", title: "Gateway live smoke", safeSummary: "Post-action safe summary delta marker", updatedAt: "2026-07-01T00:02:01.000Z" }
      ]`;
  const expandSourceRefs = options.staleSearchAndExpansion ? [`"${OTHER_REF}"`] : [`"${TARGET_REF}"`];
  const nestedCoreThreadMapOutput = `{
      targetRef: "${OTHER_REF}",
      statusBucket: "active",
      refreshedAt: "${refreshedAt}",
      sourceRefs: ["${OTHER_REF}"],
      related: { sourceRef: "${TARGET_REF}", refreshedAt: "${refreshedAt}" }
    }`;
  const wrapOutput = (output: string) => options.detailsEnvelope
    ? `${options.directDetailsEnvelope ? `{ ${options.directDetailsOk ? "ok: true, " : ""}` : "{ ok: true, output: { "}${options.detailsWithoutContent ? "" : `content: [{ type: "text", text: "${options.rawContentEnvelope ? "RAW_TRANSCRIPT: private raw session text" : "public-safe output"}" }], `}details: ${options.detailsNotOk
      ? output.replace(/^\s*\{/, "{ ok: false,")
      : options.nestedDetailsResponseNotOk
        ? output.replace(/^\s*\{/, "{ response: { ok: false },")
        : options.directDetailsErrorStatus
          ? `{ status: "error", result: ${output} }`
        : options.nestedSuccessWrapper
          ? `{ response: { result: ${output} } }`
          : output} }${options.directDetailsEnvelope ? "" : " }"}`
    : `{ ok: true, output: ${output} }`;
  const selectedThreadMapOutput = options.nestedTargetOnlyCoreOutputs ? nestedCoreThreadMapOutput : threadMapOutput;
  const threadMapResponse = options.directDomainFailureStatus
    ? wrapOutput(selectedThreadMapOutput.replace(/^\s*\{/, '{ status: "failed",'))
    : options.nestedDomainFailureStatus
    ? wrapOutput(`{ response: ${selectedThreadMapOutput.replace(/^\s*\{/, '{ status: "failed",')} }`)
    : wrapOutput(selectedThreadMapOutput);
  const searchOutput = options.alternateTopLevelSearchCollection
    ? `{
      query: "gateway live smoke acknowledged",
      records: ${searchResults}
    }`
    : `{
      query: "gateway live smoke acknowledged",
      results: ${searchResults}
    }`;
  const searchResponse = wrapOutput(searchOutput);
  const describeResponse = wrapOutput(`{
      sourceRef: "${options.nestedTargetOnlyCoreOutputs ? OTHER_REF : TARGET_REF}",
      status: "completed",
      safeSummary: "The selected Codex thread contains a post-action safe closeout marker.",
      finalAssistantMessage: "LCO gateway live smoke acknowledged.",
      touchedFiles: [],
      related: { sourceRef: "${TARGET_REF}" }
    }`);
  const expandOutput = options.nestedTargetOnlyExpansion
    ? `{
      sourceRefs: ["${OTHER_REF}"],
      profile: "brief",
      tokenBudget: 1000,
      text: "${expansionText}",
      related: { sourceRef: "${TARGET_REF}", note: "nested target mention must not prove the expanded target" }
    }`
    : `{
      sourceRefs: [${expandSourceRefs.join(", ")}],
      profile: "brief",
      tokenBudget: 1000,
      text: "${expansionText}"
    }`;
  const expandResponse = wrapOutput(expandOutput);
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const callIndex = args.indexOf("call");
const method = callIndex >= 0 ? args[callIndex + 1] : "";
const paramsIndex = args.indexOf("--params");
const params = paramsIndex >= 0 ? JSON.parse(args[paramsIndex + 1] || "{}") : {};
appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify({ method, params, args, hasTokenEnv: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN) }) + "\\n");
if (method === "tools.catalog") {
  console.log(JSON.stringify({ groups: [{ tools: [
    { id: "loo_codex_thread_map" },
    { id: "loo_search_sessions" },
    { id: "loo_describe_session" },
    { id: "loo_expand_query" }
  ] }] }));
  process.exit(0);
}
if (method === "tools.invoke") {
  const name = params.name;
  if (name === "loo_codex_thread_map") {
    console.log(JSON.stringify(${threadMapResponse}));
    process.exit(0);
  }
  if (name === "loo_search_sessions") {
    console.log(JSON.stringify(${searchResponse}));
    process.exit(0);
  }
  if (name === "loo_describe_session") {
    console.log(JSON.stringify(${describeResponse}));
    process.exit(0);
  }
  if (name === "loo_expand_query") {
    console.log(JSON.stringify(${expandResponse}));
    process.exit(0);
  }
}
console.error("unexpected fake OpenClaw call");
process.exit(7);
`);
  chmodSync(bin, 0o755);
  return { bin, callsPath };
}

test("OpenClaw post-action refresh smoke proves safe reasoning through public tools", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-"));
  const evidenceDir = join(root, "evidence");
  const scenarioDir = join(root, "scenarios");
  const scenarioEvidenceDir = join(root, "scenario-evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, true);
    assert.equal(report.proofReady, true);
    assert.equal(report.targetRef, TARGET_REF);
    assert.equal(report.refresh.postActionRefresh, true);
    assert.equal(report.liveProof.actionObservedAt, "2026-07-01T00:01:00.000Z");
    assert.equal(report.refresh.refreshedAfterLiveAction, true);
    assert.equal(report.reasoning.agentReasoningNote.includes("safe summaries"), true);
    assert.deepEqual(report.reasoning.sourceRefs, [TARGET_REF]);
    assert.equal(report.actionsPerformed.liveCodexControlRun, false);
    assert.equal(report.actionsPerformed.rawTranscriptRead, false);

    const reportText = readFileSync(join(evidenceDir, "post-action-refresh-reasoning-report.json"), "utf8");
    const proofText = readFileSync(join(evidenceDir, "post-action-refresh-reasoning-v1-1.runtime-proof.json"), "utf8");
    assert.doesNotMatch(reportText, /RAW_TRANSCRIPT:|private raw session/i);
    assert.doesNotMatch(proofText, /RAW_TRANSCRIPT:|private raw session/i);

    mkdirSync(scenarioDir);
    copyFileSync(join("evals", "scenarios", "v1.1", "post-action-refresh-reasoning.json"), join(scenarioDir, "post-action-refresh-reasoning.json"));
    const scenarioReport = createScenarioSweep({
      scenarioDir,
      evidenceDir: scenarioEvidenceDir,
      runtimeProofDir: evidenceDir,
      now: "2026-07-01T00:04:00.000Z"
    });
    assert.equal(scenarioReport.ok, true);
    assert.deepEqual(scenarioReport.blockers, []);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    assert.deepEqual(calls.map((call) => call.method), ["tools.catalog", "tools.invoke", "tools.invoke", "tools.invoke", "tools.invoke"]);
    assert.deepEqual(calls.slice(1).map((call) => call.params.name), [
      "loo_codex_thread_map",
      "loo_search_sessions",
      "loo_describe_session",
      "loo_expand_query"
    ]);
    assert.equal(calls[3]?.params.args?.thread_id, TARGET_THREAD_ID);
    assert.equal(calls[4]?.params.args?.profile, "brief");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke accepts target rows in unknown top-level collections", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-alt-collection-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { alternateTopLevelSearchCollection: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, true);
    assert.equal(report.proofReady, true);
    assert.deepEqual(report.blockers, []);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke fails closed when the refresh predates the live action", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-live-order-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { staleRefreshTimestamp: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, false);
    assert.equal(report.proofReady, false);
    assert.equal(report.liveProof.actionObservedAt, "2026-07-01T00:01:00.000Z");
    assert.equal(report.refresh.refreshedAfterLiveAction, false);
    assert.match(report.blockers.join("\n"), /post_action_refresh_not_after_live_action/);
    assert.match(report.nextAction, /loo_index_sessions/);
    assert.match(report.nextAction, /after the live action/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke binds public thread-map entries by thread id", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-thread-id-map-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { publicThreadMapShape: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, true);
    assert.equal(report.proofReady, true);
    assert.equal(report.refresh.postActionRefresh, true);
    assert.equal(report.refresh.refreshedAt, "2026-07-01T00:02:00.000Z");
    assert.equal(report.refresh.statusBucket, "active");
    assert.deepEqual(report.reasoning.sourceRefs, [TARGET_REF]);
    assert.deepEqual(report.blockers, []);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke unwraps native plugin output details", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-details-envelope-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { publicThreadMapShape: true, detailsEnvelope: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, true);
    assert.equal(report.proofReady, true);
    assert.equal(report.refresh.refreshedAt, "2026-07-01T00:02:00.000Z");
    assert.deepEqual(report.reasoning.sourceRefs, [TARGET_REF]);
    assert.deepEqual(report.blockers, []);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke unwraps native plugin details without content", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-details-without-content-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, {
    publicThreadMapShape: true,
    detailsEnvelope: true,
    detailsWithoutContent: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.proofReady, true);
    assert.equal(report.refresh.refreshedAt, "2026-07-01T00:02:00.000Z");
    assert.deepEqual(report.reasoning.sourceRefs, [TARGET_REF]);
    assert.deepEqual(report.blockers, []);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke unwraps direct native details without content", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-direct-details-without-content-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, {
    publicThreadMapShape: true,
    detailsEnvelope: true,
    directDetailsEnvelope: true,
    directDetailsOk: true,
    detailsWithoutContent: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.proofReady, true);
    assert.equal(report.refresh.refreshedAt, "2026-07-01T00:02:00.000Z");
    assert.deepEqual(report.reasoning.sourceRefs, [TARGET_REF]);
    assert.deepEqual(report.blockers, []);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke unwraps successful nested native response details", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-nested-success-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { publicThreadMapShape: true, detailsEnvelope: true, nestedSuccessWrapper: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.proofReady, true);
    assert.equal(report.refresh.refreshedAt, "2026-07-01T00:02:00.000Z");
    assert.deepEqual(report.reasoning.sourceRefs, [TARGET_REF]);
    assert.deepEqual(report.blockers, []);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke preserves domain failure statuses inside successful native details", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-domain-failure-status-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, {
    detailsEnvelope: true,
    nestedDomainFailureStatus: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.proofReady, true);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.refresh.statusBucket, "active");
    assert.equal(report.refresh.refreshedAt, "2026-07-01T00:02:00.000Z");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke preserves direct domain failure statuses inside successful native details", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-direct-domain-failure-status-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, {
    detailsEnvelope: true,
    directDomainFailureStatus: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.proofReady, true);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.refresh.statusBucket, "active");
    assert.equal(report.refresh.refreshedAt, "2026-07-01T00:02:00.000Z");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke scans native content before trusting details", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-private-content-envelope-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, {
    publicThreadMapShape: true,
    detailsEnvelope: true,
    rawContentEnvelope: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, false);
    assert.equal(report.proofReady, false);
    assert.equal(report.publicSafe, false);
    assert.equal(report.blockers.includes("post_action_refresh_raw_private_output"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke rejects native details marked not ok", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-details-not-ok-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, {
    publicThreadMapShape: true,
    detailsEnvelope: true,
    detailsNotOk: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, false);
    assert.equal(report.proofReady, false);
    assert.equal(report.blockers.includes("post_action_thread_map_failed:tool_not_ok"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke rejects nested native response failures", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-nested-response-not-ok-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, {
    publicThreadMapShape: true,
    detailsEnvelope: true,
    nestedDetailsResponseNotOk: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, false);
    assert.equal(report.proofReady, false);
    assert.equal(report.blockers.includes("post_action_thread_map_failed:tool_not_ok"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke rejects direct native error statuses", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-direct-error-status-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, {
    publicThreadMapShape: true,
    detailsEnvelope: true,
    directDetailsErrorStatus: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, false);
    assert.equal(report.proofReady, false);
    assert.equal(report.blockers.some((blocker) => blocker.endsWith(":tool_not_ok")), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke rejects direct native response failures", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-direct-response-not-ok-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, {
    publicThreadMapShape: true,
    detailsEnvelope: true,
    directDetailsEnvelope: true,
    nestedDetailsResponseNotOk: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, false);
    assert.equal(report.proofReady, false);
    assert.equal(report.blockers.includes("post_action_thread_map_failed:tool_not_ok"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke fails closed without an index refresh timestamp", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-missing-refresh-time-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, {
    publicThreadMapShape: true,
    detailsEnvelope: true,
    missingRefreshTimestamp: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, false);
    assert.equal(report.proofReady, false);
    assert.equal(report.refresh.refreshedAt, null);
    assert.equal(report.blockers.includes("post_action_refresh_timestamp_missing"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke rejects nested refresh timestamp lookalikes", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-nested-refresh-time-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, {
    publicThreadMapShape: true,
    detailsEnvelope: true,
    nestedRefreshTimestampOnly: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, false);
    assert.equal(report.proofReady, false);
    assert.equal(report.refresh.refreshedAt, null);
    assert.equal(report.blockers.includes("post_action_refresh_timestamp_missing"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke buckets refreshed public map entries without metadata status", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-refreshed-bucket-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { publicThreadMapShape: true, missingMapStatus: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      now: "2026-07-01T00:03:00.000Z"
    });

    assert.equal(report.ok, true);
    assert.equal(report.proofReady, true);
    assert.equal(report.refresh.refreshedAt, "2026-07-01T00:02:00.000Z");
    assert.equal(report.refresh.statusBucket, "refreshed");
    assert.deepEqual(report.blockers, []);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke ignores nested status lookalikes", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-payload-fields-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { publicThreadMapShape: true, missingMapStatus: true, nestedStatusLookalike: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawPostActionRefreshSmoke({ openclawBin: bin, evidenceDir: join(root, "evidence"), liveProofReportPath, threadId: TARGET_THREAD_ID, now: "2026-07-01T00:03:00.000Z" });
    assert.equal(report.ok, true);
    assert.equal(report.refresh.statusBucket, "refreshed");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke prefers authoritative metadata status", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-status-authority-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { publicThreadMapShape: true, topLevelStatusLookalike: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawPostActionRefreshSmoke({ openclawBin: bin, evidenceDir: join(root, "evidence"), liveProofReportPath, threadId: TARGET_THREAD_ID, now: "2026-07-01T00:03:00.000Z" });
    assert.equal(report.ok, true);
    assert.equal(report.refresh.statusBucket, "active");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke preserves semantic details and result fields", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-domain-envelope-fields-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { domainEnvelopeLookalikes: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawPostActionRefreshSmoke({ openclawBin: bin, evidenceDir: join(root, "evidence"), liveProofReportPath, threadId: TARGET_THREAD_ID, now: "2026-07-01T00:03:00.000Z" });
    assert.equal(report.ok, true);
    assert.equal(report.refresh.statusBucket, "active");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke fails closed without matching #158 proof", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-mismatch-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath, { targetRef: "codex_thread:other" });
  const { bin, callsPath } = createFakeOpenClaw(root);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      liveProofReportPath,
      threadId: TARGET_THREAD_ID
    });

    assert.equal(report.ok, false);
    assert.match(report.blockers.join("\n"), /post_action_live_proof_target_mismatch/);
    const proof = JSON.parse(readFileSync(join(root, "evidence", "post-action-refresh-reasoning-v1-1.runtime-proof.json"), "utf8")) as {
      public_safe?: boolean;
      proof_markers?: Record<string, boolean>;
    };
    assert.equal(proof.public_safe, false);
    assert.equal(proof.proof_markers?.post_action_refresh, false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke fails closed on raw-looking expansion output", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-raw-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { rawExpansion: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      liveProofReportPath,
      threadId: TARGET_THREAD_ID
    });

    assert.equal(report.ok, false);
    assert.match(report.blockers.join("\n"), /post_action_refresh_raw_private_output/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke binds refresh evidence to the target thread", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-stale-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { staleSearchAndExpansion: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      liveProofReportPath,
      threadId: TARGET_THREAD_ID
    });

    assert.equal(report.ok, false);
    assert.match(report.blockers.join("\n"), /post_action_refresh_search_target_missing/);
    assert.match(report.blockers.join("\n"), /post_action_refresh_expand_target_missing/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke rejects nested target refs inside wrong expansion output", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-nested-expand-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { nestedTargetOnlyExpansion: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      liveProofReportPath,
      threadId: TARGET_THREAD_ID
    });

    assert.equal(report.ok, false);
    assert.match(report.blockers.join("\n"), /post_action_refresh_expand_target_missing/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke rejects nested target refs inside wrong core outputs", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-nested-core-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { nestedTargetOnlyCoreOutputs: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      liveProofReportPath,
      threadId: TARGET_THREAD_ID
    });

    assert.equal(report.ok, false);
    assert.match(report.blockers.join("\n"), /post_action_refresh_thread_map_target_missing/);
    assert.match(report.blockers.join("\n"), /post_action_refresh_search_target_missing/);
    assert.match(report.blockers.join("\n"), /post_action_refresh_describe_target_missing/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke rejects nested array target refs inside wrong search rows", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-nested-array-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { nestedArrayTargetOnlySearch: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      liveProofReportPath,
      threadId: TARGET_THREAD_ID
    });

    assert.equal(report.ok, false);
    assert.match(report.blockers.join("\n"), /post_action_refresh_search_target_missing/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke requires target timestamp and status markers", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-markers-"));
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root, { missingMapMarkers: true });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      liveProofReportPath,
      threadId: TARGET_THREAD_ID
    });

    assert.equal(report.ok, false);
    assert.match(report.blockers.join("\n"), /post_action_refresh_timestamp_missing/);
    assert.match(report.blockers.join("\n"), /post_action_refresh_status_bucket_missing/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke rejects token-only auth without putting it in process argv", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-token-"));
  const evidenceDir = join(root, "evidence");
  const liveProofReportPath = join(root, "openclaw-gateway-live-control-smoke-report.json");
  writeLiveProofReport(liveProofReportPath);
  const { bin, callsPath } = createFakeOpenClaw(root);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir,
      liveProofReportPath,
      threadId: TARGET_THREAD_ID,
      token: "unit-test-token-never-in-argv"
    });

    assert.equal(report.ok, false);
    assert.ok(report.blockers.includes("post_action_refresh_gateway_token_requires_url"));
    assert.equal(existsSync(callsPath), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw post-action refresh smoke emits the expected missing proof blocker", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-openclaw-refresh-smoke-missing-proof-"));
  const { bin, callsPath } = createFakeOpenClaw(root);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;

  try {
    const report = runOpenClawPostActionRefreshSmoke({
      openclawBin: bin,
      evidenceDir: join(root, "evidence"),
      liveProofReportPath: join(root, "missing-live-proof.json"),
      threadId: TARGET_THREAD_ID
    });

    assert.equal(report.ok, false);
    assert.match(report.blockers.join("\n"), /post_action_refresh_proof_missing/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI exposes OpenClaw post-action refresh smoke help", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "openclaw",
    "post-action-refresh-smoke",
    "--help"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /loo openclaw post-action-refresh-smoke/i);
  assert.match(result.stdout, /post-action-refresh-reasoning-v1-1\.runtime-proof\.json/i);
});
