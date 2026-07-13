import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { startFakeGatewayBackend } from "./helpers/fake-gateway-backend.js";
import {
  DEFAULT_REQUIRED_TOOL_CALLS,
  FULL_GATEWAY_SMOKE_TOOL_CALLS,
  OPENCLAW_GATEWAY_BACKEND_CLIENT_ID,
  OPENCLAW_GATEWAY_BACKEND_PROTOCOL,
  runOpenClawToolSmoke
} from "../packages/cli/src/openclaw-tool-smoke.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
const C1_UMBRELLA_TOOL_CALLS = [
  "lco_watchers",
  "lco_codex_extract",
  "lco_prepared_state",
  "lco_operating_picture",
  "lco_desktop_proof"
] as const;
type DryRunOutputShape = "plain" | "content" | "details" | "both";

test("OpenClaw tool smoke backend gateway connect payload follows current OpenClaw protocol", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-backend-"));
  const { server, port, capturePath } = startFakeGatewayBackend(dir);

  try {
    const report = runOpenClawToolSmoke({
      gatewayUrl: `ws://127.0.0.1:${port}`,
      token: "test-backend-token",
      requiredTools: ["loo_doctor"],
      gatewayTimeoutMs: 3000
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.toolSmokeReady, true, JSON.stringify(report, null, 2));
    assert.equal(report.command, "loo backend-gateway tools.catalog --json --params <redacted>");
    const frames = readFileSync(capturePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { method?: string; params?: { minProtocol?: number; maxProtocol?: number; client?: { id?: string; displayName?: string; mode?: string }; auth?: { token?: string } } });
    const connectFrames = frames.filter((frame) => frame.method === "connect");
    assert.equal(connectFrames.length, 2);
    assert.deepEqual(
      connectFrames.map((frame) => ({
        minProtocol: frame.params?.minProtocol,
        maxProtocol: frame.params?.maxProtocol,
        clientId: frame.params?.client?.id,
        displayName: frame.params?.client?.displayName,
        mode: frame.params?.client?.mode,
        token: frame.params?.auth?.token
      })),
      [
        {
          minProtocol: OPENCLAW_GATEWAY_BACKEND_PROTOCOL.minProtocol,
          maxProtocol: OPENCLAW_GATEWAY_BACKEND_PROTOCOL.maxProtocol,
          clientId: OPENCLAW_GATEWAY_BACKEND_CLIENT_ID,
          displayName: "loo-openclaw-tool-smoke",
          mode: "backend",
          token: "<redacted>"
        },
        {
          minProtocol: OPENCLAW_GATEWAY_BACKEND_PROTOCOL.minProtocol,
          maxProtocol: OPENCLAW_GATEWAY_BACKEND_PROTOCOL.maxProtocol,
          clientId: OPENCLAW_GATEWAY_BACKEND_CLIENT_ID,
          displayName: "loo-openclaw-tool-smoke",
          mode: "backend",
          token: "<redacted>"
        }
      ]
    );
  } finally {
    server.kill("SIGTERM");
  }
});

function createFakeOpenClaw(
  dir: string,
  catalogTools: string[],
  catalogShape: "flat" | "groups" = "flat",
  options: {
    dryRunOutputShape?: DryRunOutputShape;
    wrapDryRunOutput?: boolean;
    omitFallbackNextToolCall?: boolean;
    unsafeCollaborationNextSteps?: boolean;
    searchThreadId?: string;
    preparedThreadId?: string;
    queryExpansionTokenBudget?: number;
    summaryExpansionTokenBudget?: number;
    omitPreparedTargetCoverage?: boolean;
    mismatchedPreparedTargetCoverage?: boolean;
    incompletePreparedTargetCoverage?: boolean;
    omitDryRunMessageHash?: boolean;
    weakDesktopActProof?: boolean;
    bareDesktopActStatus?: boolean;
    markerOnlyDesktopActProof?: boolean;
    missingDesktopActActions?: boolean;
    desktopActValidationError?: boolean;
    arbitraryProofReportBlocker?: boolean;
    deepDesktopActProof?: boolean;
    wideDesktopActProof?: boolean;
    currentProductFailClosedShapes?: boolean;
    unsafeIndexErrorPath?: boolean;
    unsafeIndexMutationClass?: boolean;
    unsafeIndexPublicSafe?: boolean;
    unsafeIndexRestrictedAction?: boolean;
    unsafeLcmPeerPath?: boolean;
    unsafeLcmPeerRef?: boolean;
    unsafeLcmPeerRelativePath?: boolean;
    weakHarnessReadyProof?: boolean;
    snakeCaseHarnessReadyProof?: boolean;
    gatewayRefusedToolName?: string;
    pluginDetailsRefusedToolName?: string;
  } = {}
): { bin: string; callsPath: string } {
  const callsPath = join(dir, "calls.jsonl");
  const bin = join(dir, "openclaw-fake.mjs");
  const catalogPayload = catalogShape === "groups"
    ? { groups: [{ id: "plugin:lossless-openclaw-orchestrator", tools: catalogTools.map((id) => ({ id, label: id, source: "plugin" })) }] }
    : { tools: catalogTools.map((name) => ({ name, description: "fake" })) };
  const dryRunOutputShape = options.dryRunOutputShape ?? (options.wrapDryRunOutput ? "both" : "plain");
  const searchThreadId = options.searchThreadId ?? "thread-1";
  const preparedThreadId = options.preparedThreadId ?? "thread-1";
  const queryExpansionTokenBudget = options.queryExpansionTokenBudget;
  const summaryExpansionTokenBudget = options.summaryExpansionTokenBudget;
  const gatewayRefusedToolName = options.gatewayRefusedToolName ?? "loo_gateway_refused";
  const pluginDetailsRefusedToolName = options.pluginDetailsRefusedToolName ?? "loo_plugin_details_refused";
  const dryRunMessageHashCode = options.omitDryRunMessageHash
    ? ""
    : `, messageHash: "message-hash", message_hash: "message-hash"`;
  const dryRunDetailsCode = `{ action: "codex_send_message", threadId: toolArgs.thread_id, live: false, approvalAuditId: "loo_audit_test", paramsHash: "params-hash"${dryRunMessageHashCode}, method: "turn/start", approval_audit_id: "loo_audit_test", params_hash: "params-hash" }`;
  const dryRunContentCode = `[{ type: "text", text: JSON.stringify(${dryRunDetailsCode}) }]`;
  const dryRunOutputCode = dryRunOutputShape === "both"
    ? `{ content: ${dryRunContentCode}, details: ${dryRunDetailsCode} }`
    : dryRunOutputShape === "content"
      ? `{ content: ${dryRunContentCode} }`
      : dryRunOutputShape === "details"
        ? `{ details: ${dryRunDetailsCode} }`
        : dryRunDetailsCode;
  const desktopActOutputCode = options.currentProductFailClosedShapes
    ? `{ backend: "cua-driver", action: toolArgs.action, live: false, dryRunOnly: true, approvalRequired: true, requestedLive: false, blockers: []${options.missingDesktopActActions ? "" : ", actionsPerformed: { desktopGuiActionRun: false, screenshotCaptured: false }"} }`
    : options.weakDesktopActProof
    ? `{ publicSafe: true, readOnly: true, reasonCodes: ["blocked"], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false } }`
    : options.bareDesktopActStatus
      ? `{ publicSafe: true, readOnly: true, status: "blocked", actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false } }`
    : options.markerOnlyDesktopActProof
      ? `{ publicSafe: true, readOnly: true, status: "blocked", proofMarkers: { noActionObserved: true }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false } }`
    : options.deepDesktopActProof
      ? `(() => { const output = { publicSafe: true, readOnly: true, status: "blocked", actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false } }; let cursor = output; for (let index = 0; index < 80; index += 1) { cursor.nested = {}; cursor = cursor.nested; } return output; })()`
      : options.wideDesktopActProof
        ? `(() => { const output = { publicSafe: true, readOnly: true, status: "blocked", blockers: ["desktop_live_action_disallowed"], proofMarkers: { noActionObserved: true }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false } }; output.wide = Object.fromEntries(Array.from({ length: 600 }, (_, index) => ["k" + index, false])); return output; })()`
      : `{ publicSafe: true, readOnly: true, status: "blocked", blockers: ["desktop_live_action_disallowed"], action: toolArgs.action, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false } }`;
  const fallbackNextToolCallCode = options.omitFallbackNextToolCall
    ? "null"
    : `missingCoherence ? { tool: "loo_codex_desktop_coherence", args: { thread_id: toolArgs.thread_id, source_ref: toolArgs.source_ref } } : null`;
  const collaborationNextStepsOutputCode = options.unsafeCollaborationNextSteps
    ? `{ publicSafe: true, readOnly: true, schema: "lco.codex.collaborationNextSteps.v1", steps: [{ threadId: "codex_thread:thread-1", category: "desktop_coherence", status: "ready", toolCall: null }], actionsPerformed: { liveCodexControlRun: true, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } }`
    : `{ publicSafe: true, readOnly: true, schema: "lco.codex.collaborationNextSteps.v1", steps: [{ threadId: "codex_thread:thread-1", category: "desktop_coherence", status: "ready", toolCall: { tool: "loo_codex_desktop_coherence", args: { thread_id: "thread-1", source_ref: "codex_thread:thread-1" }, execute: false } }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } }`;
  const preparedTargetCoverageCode = options.omitPreparedTargetCoverage
    ? "undefined"
    : options.mismatchedPreparedTargetCoverage
      ? `toolArgs.thread_id ? { schema: "lco.prepared.targetCoverage.v1", threadId: "other-thread", targetRef: "codex_thread:other-thread", status: "ready", sourceRefs: ["codex_thread:other-thread", "codex_source:5000000000000000"], sourceCoverage: { indexedSession: "ok", sourceFile: "ok", preparedSourceEvents: "ok", preparedSourceRanges: "ok", summaryLeaves: "ok", preparedCards: "ok", preparedInboxItems: "ok", watcherObservations: "not_configured" }, counts: { preparedSourceEvents: 3, preparedSourceRanges: 3, summaryLeaves: 1, preparedCards: 1, preparedInboxItems: 1 }, freshness: { sourceUpdatedAt: "2026-07-01T12:00:00.000Z", indexedAt: "2026-07-01T12:00:00.000Z", preparedFreshnessAt: "2026-07-01T12:00:00.000Z", stale: false }, reasonCodes: ["targeted_thread_coverage", "indexed_session_present", "prepared_state_ready"], nextAction: "Use prepared cards, prepared inbox, or summary expansion for bounded public-safe evidence." } : undefined`
      : options.incompletePreparedTargetCoverage
        ? `toolArgs.thread_id ? { schema: "lco.prepared.targetCoverage.v1", threadId: toolArgs.thread_id, targetRef: "codex_thread:" + toolArgs.thread_id, status: "ready", sourceCoverage: {} } : undefined`
    : `toolArgs.thread_id ? { schema: "lco.prepared.targetCoverage.v1", threadId: toolArgs.thread_id, targetRef: "codex_thread:" + toolArgs.thread_id, status: "ready", sourceRefs: ["codex_thread:" + toolArgs.thread_id, "codex_source:5000000000000000"], sourceCoverage: { indexedSession: "ok", sourceFile: "ok", preparedSourceEvents: "ok", preparedSourceRanges: "ok", summaryLeaves: "ok", preparedCards: "ok", preparedInboxItems: "ok", watcherObservations: "not_configured" }, counts: { preparedSourceEvents: 3, preparedSourceRanges: 3, summaryLeaves: 1, preparedCards: 1, preparedInboxItems: 1 }, freshness: { sourceUpdatedAt: "2026-07-01T12:00:00.000Z", indexedAt: "2026-07-01T12:00:00.000Z", preparedFreshnessAt: "2026-07-01T12:00:00.000Z", stale: false }, reasonCodes: ["targeted_thread_coverage", "indexed_session_present", "prepared_state_ready"], nextAction: "Use prepared cards, prepared inbox, or summary expansion for bounded public-safe evidence." } : undefined`;
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
	const args = process.argv.slice(2);
	const callIndex = args.indexOf("call");
	const method = callIndex >= 0 ? args[callIndex + 1] : "";
	const paramsIndex = args.indexOf("--params");
	const params = paramsIndex >= 0 ? JSON.parse(args[paramsIndex + 1] || "{}") : {};
	const searchThreadId = ${JSON.stringify(searchThreadId)};
	const preparedThreadId = ${JSON.stringify(preparedThreadId)};
	const queryExpansionTokenBudget = ${queryExpansionTokenBudget === undefined ? "undefined" : JSON.stringify(queryExpansionTokenBudget)};
	const summaryExpansionTokenBudget = ${summaryExpansionTokenBudget === undefined ? "undefined" : JSON.stringify(summaryExpansionTokenBudget)};
	appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify({ method, params, args, envTokenPresent: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN) }) + "\\n");
if (method === "tools.catalog") {
  console.log(JSON.stringify(${JSON.stringify(catalogPayload)}));
  process.exit(0);
}
if (method === "tools.invoke") {
  const name = params.name;
  const toolArgs = params.args || {};
  if (name === ${JSON.stringify(gatewayRefusedToolName)}) {
    console.log(JSON.stringify({ ok: false, toolName: name, source: "plugin", error: { code: "forbidden", message: "super-secret-transcript-span" } }));
    process.exit(0);
  }
  if (name === ${JSON.stringify(pluginDetailsRefusedToolName)}) {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { content: [{ type: "text", text: JSON.stringify({ ok: false, blockers: ["execute_flag_missing"], private: "super-secret-transcript-span" }) }], details: { ok: false, blockers: ["execute_flag_missing"], private: "super-secret-transcript-span" } } }));
    process.exit(0);
  }
  if (name === "loo_doctor") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { ok: true, localOnly: true, toolPrefix: "loo_*" } }));
    process.exit(0);
  }
  if (name === "lco_doctor") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { ok: true, localOnly: true, toolPrefix: "lco_*" } }));
    process.exit(0);
  }
  if (name === "loo_find") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.find.v1", ok: true, publicSafe: true, query: toolArgs.query || "Proposed plan", limit: toolArgs.limit || 3, indexed: { attempted: false, indexedFiles: 0, skippedFiles: 0, indexedThreads: 0, indexedEvents: 0, limitedFiles: 0, warnings: 0, errors: 0 }, resultCount: 1, results: [{ rank: 1, sourceKind: "codex_thread", sourceRef: "codex_thread:" + searchThreadId, title: "Thread 1", summary: "public-safe summary", updatedAt: "2026-07-01T12:00:00.000Z", snippet: "public-safe find snippet", threadId: searchThreadId, reasonCodes: ["event_content_fts_match"] }], nextSafeCommands: ["lco describe codex_thread:" + searchThreadId], actionsPerformed: { derivedCacheWrite: false, localCodexSourceRead: false, sourceStoreMutation: false, externalWrite: false, liveControl: false, guiMutation: false, rawTranscriptRead: false, rawTranscriptReturned: false, rawTranscriptUploaded: false }, reasonCodes: ["find_command", "index_skipped_by_flag"] } }));
    process.exit(0);
  }
  if (name === "lco_watchers") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.watchers.events.v1", publicSafe: true, readOnly: true, sourceCoverage: { watcherSpecs: "ok", watcherObservations: "ok", attentionQueue: "ok" }, summary: { total: 1, returned: 1, triggered: 1, queueItems: 1 }, observations: [{ observationRef: "watcher_observation:50000000000000000000000000000005", watchId: "watch_tool_smoke_checks", targetRef: "codex_thread:thread-1", sourceRefs: ["codex_thread:thread-1", "watcher:watch_tool_smoke_checks"], reasonCodes: ["watcher_triggered"], confidence: 0.9 }], actionsPerformed: { derivedCacheWrite: false, sourceStoreMutation: false, externalWrite: false, liveControl: false, guiMutation: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "lco_codex_extract") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: [{ sourceRef: "codex_thread:" + (toolArgs.thread_id || searchThreadId), threadId: toolArgs.thread_id || searchThreadId, count: 1, text: "super-secret-transcript-span" }] }));
    process.exit(0);
  }
  if (name === "lco_prepared_state") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.preparedState.status.v1", publicSafe: true, readOnly: true, sourceCoverage: { summaryLeaves: "ok", preparedCards: "ok", preparedInboxItems: "ok", watcherObservations: "not_configured" }, targetCoverage: ${preparedTargetCoverageCode}, summary: { summaryLeaves: 1, cards: 1, inboxItems: 1, staleCards: 0, partialCards: 0, unknownCards: 0, lowConfidenceCards: 0 }, actionsPerformed: { derivedCacheWrite: false, sourceStoreMutation: false, externalWrite: false, liveControl: false, guiMutation: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "lco_operating_picture") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codex.activeThreadState.v1", publicSafe: true, readOnly: true, generatedAt: "2026-07-01T12:00:00.000Z", summary: { totalLanes: 1, returned: 1, running: 1, blocked: 0, needsApproval: 0, needsNudge: 0, stale: 0, waiting: 0, idle: 0, unknown: 0, lowConfidence: 0, attentionCovered: 1, attentionPartial: 0, attentionNeedsProbe: 0, attentionUnknown: 0, nextReadOnlyActions: 0 }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" }, items: [{ threadId: "codex_thread:thread-1", title: "Thread 1", state: "running", sessionState: "running", attention: { level: "low", urgencyScore: 10 }, freshness: { lastEventAt: "2026-07-01T11:59:00.000Z", ageSeconds: 60, stale: false }, nextAction: { kind: "inspect", confidence: 0.9, reason: "read-only smoke" }, confidence: 0.9, reasonCodes: ["active_state:running"], evidenceIds: ["ev_tool_smoke"], attentionCoverage: { status: "covered", confidence: 0.9, reasonCodes: ["attention_covered"], nextReadOnlyAction: null }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" } }], omitted: { count: 0, reason: "none" }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
    process.exit(0);
  }
  if (name === "lco_desktop_proof") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, schema: "lco.codexDesktopCoherence.v1", state: "cli_visible", visibility: { cli: "proven", desktop: "not_seen" }, target: { threadId: toolArgs.thread_id || "thread-1", sourceRef: "codex_thread:" + (toolArgs.thread_id || "thread-1") }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_index_sessions") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: ${options.unsafeIndexPublicSafe ? "false" : "true"}, readOnly: false, mutationClasses: ${options.unsafeIndexMutationClass ? "[\"derived_cache\", \"sourceStoreMutation\"]" : "[\"derived_cache\"]"}, indexedFiles: 0, skippedFiles: 0, indexedThreads: 0, indexedEvents: 0, limitedFiles: ${options.unsafeIndexErrorPath ? "[{ path: \"./repos/private/session.jsonl\", reason: \"too_large\" }]" : "[]"}, errors: ${options.unsafeIndexErrorPath ? "[{ path: \"./repos/private/session.jsonl\", message: \"failed\" }]" : "[]"}, actionsPerformed: { derivedCacheWrite: true, sourceStoreMutation: ${options.unsafeIndexRestrictedAction ? "true" : "false"}, externalWrite: false, liveControl: false, guiMutation: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
	  if (name === "loo_search_sessions") {
	    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: [{ sourceRef: "codex_thread:" + searchThreadId, threadId: searchThreadId, score: 9, snippet: "super-secret-transcript-span" }] }));
	    process.exit(0);
	  }
  if (name === "lco_search_sessions") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: [{ sourceRef: "codex_thread:" + searchThreadId, threadId: searchThreadId, score: 9, snippet: "super-secret-transcript-span" }] }));
    process.exit(0);
  }
  if (name === "lco_session_diff") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.sessionDiff.v1", publicSafe: true, readOnly: true, threadId: toolArgs.thread_id, targetRef: "codex_thread:" + toolArgs.thread_id, changes: [], nextCursor: "opaque-cursor" } }));
    process.exit(0);
  }
  if (name === "lco_drive") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.drive.v1", status: "dry_run_ready", dryRun: { live: false, approvalAuditId: "loo_audit_drive", paramsHash: "drive-params-hash", messageHash: "drive-message-hash" }, finalReport: { liveActions: 0 }, actionsPerformed: { liveControl: false, auditWrite: true } } }));
    process.exit(0);
  }
  if (name === "lco_codex_control_dry_run") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: ${dryRunOutputCode} }));
    process.exit(0);
  }
  if (name === "loo_describe_session") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { threadId: toolArgs.thread_id, sourceRef: "codex_thread:" + toolArgs.thread_id, status: "active", summary: "super-secret-transcript-span" } }));
    process.exit(0);
  }
  if (name === "loo_describe_ref") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { threadId: String(toolArgs.source_ref || "").replace(/^codex_thread:/, ""), sourceRef: toolArgs.source_ref, status: "active", summary: "super-secret-transcript-span" } }));
    process.exit(0);
  }
	  if (name === "loo_expand_query") {
	    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { sourceRef: "codex_thread:" + searchThreadId, profile: { name: toolArgs.profile || "brief" }, tokenBudget: queryExpansionTokenBudget ?? toolArgs.token_budget, text: "super-secret-transcript-span" } }));
	    process.exit(0);
	  }
  if (name === "loo_expand_session") {
    if (!toolArgs.thread_id) {
      console.log(JSON.stringify({ ok: false, toolName: name, source: "plugin", error: { code: "missing_thread_id", message: "thread_id is required" } }));
      process.exit(0);
    }
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { sourceRef: "codex_thread:" + toolArgs.thread_id, threadId: toolArgs.thread_id, profile: { name: toolArgs.profile || "brief" }, tokenBudget: toolArgs.token_budget, text: "super-secret-transcript-span" } }));
    process.exit(0);
  }
  if (name === "loo_grep") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, query: toolArgs.query, profile: toolArgs.profile, tokenBudget: toolArgs.token_budget, matches: [{ sourceRef: "codex_thread:" + searchThreadId, threadId: searchThreadId, line: 1, snippet: "bounded public-safe match" }], count: 1 } }));
    process.exit(0);
  }
  if (name === "loo_codex_plans" || name === "loo_codex_final_messages" || name === "loo_codex_touched_files") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: [{ sourceRef: "codex_thread:" + toolArgs.thread_id, threadId: toolArgs.thread_id, count: 1, text: "super-secret-transcript-span" }] }));
    process.exit(0);
  }
	  if (name === "loo_codex_thread_map") {
	    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { results: [{ sourceRef: "codex_thread:" + searchThreadId, threadId: searchThreadId, status: "active" }] } }));
	    process.exit(0);
	  }
  if (name === "loo_codex_session_management_map") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, items: [{ sourceRef: "codex_thread:" + searchThreadId, threadId: searchThreadId, priority: "high" }], summary: { returned: 1 } } }));
    process.exit(0);
  }
  if (name === "loo_codex_tool_calls") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, threadId: toolArgs.thread_id, sourceRef: "codex_thread:" + toolArgs.thread_id, calls: [{ tool: "shell", status: "completed" }], count: 1 } }));
    process.exit(0);
  }
  if (name === "loo_closeout_dry_run") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, threadId: toolArgs.thread_id, sourceRef: "codex_thread:" + toolArgs.thread_id, envelope: { status: "dry_run" }, actionsPerformed: { externalWrite: false, liveControl: false, guiMutation: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_session_sanitizer") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, threadId: toolArgs.thread_id, sourceRef: "codex_thread:" + toolArgs.thread_id, findings: [], repairPlan: null, actionsPerformed: { sourceStoreMutation: false, externalWrite: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_recent_sessions") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, cards: [{ threadId: "codex_thread:thread-1" }] } }));
    process.exit(0);
  }
  if (name === "loo_cockpit_inbox") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, items: [{ card: { threadId: "codex_thread:thread-1" } }] } }));
    process.exit(0);
  }
  if (name === "loo_codex_collaboration_cockpit") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, schema: "lco.codex.collaborationCockpit.v1", lanes: [{ threadId: "codex_thread:thread-1", attention: { level: "high", urgencyScore: 80 }, desktop: { state: "fallback_ready", requiresFallback: true, preferredBackend: "cua-driver" } }], sourceCoverage: { recentSessions: "ok", cockpitInbox: "ok", desktopCoherence: "ok", desktopFallback: "ok" }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
    process.exit(0);
  }
  if (name === "loo_codex_collaboration_next_steps") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: ${collaborationNextStepsOutputCode} }));
    process.exit(0);
  }
  if (name === "loo_codex_runtime_desktop_visibility_status") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codex.runtimeDesktopVisibilityStatus.v1", publicSafe: true, readOnly: true, status: "covered", confidence: 0.86, summary: { totalLanes: 1, returned: 1, covered: 1, partial: 0, blocked: 0, nextReadOnlyActions: 1 }, sourceCoverage: { collaborationCockpit: "ok", desktopCoherence: "ok", desktopFallback: "ok", desktopCollaborationProof: "ok" }, lanes: [{ threadId: "codex_thread:thread-1", title: "Thread 1", coverage: "covered", desktopState: "fallback_ready", confidence: 0.86, blockers: [], reasonCodes: ["action_bound_desktop_proof_ready"], evidenceIds: ["ev_tool_smoke"], nextToolCall: { tool: "lco_desktop_proof", args: { check: "live_proof_harness", backend: "cua-driver", target_app: "Codex", target_window: "Lossless OpenClaw Orchestrator", action: "verify_visible_thread_alignment", approval_ref: "tool-smoke-action-bound-proof" }, execute: false } }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
    process.exit(0);
  }
  if (name === "loo_codex_active_thread_state") {
    const activeThreadId = toolArgs.app_server_threads?.threads?.[0]?.threadId;
    if (activeThreadId === "bad-attention-action-args") {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codex.activeThreadState.v1", publicSafe: true, readOnly: true, generatedAt: "2026-07-01T12:00:00.000Z", summary: { totalLanes: 1, returned: 1, running: 0, blocked: 0, needsApproval: 0, needsNudge: 1, stale: 0, waiting: 0, idle: 0, unknown: 0, lowConfidence: 0, attentionCovered: 0, attentionPartial: 1, attentionNeedsProbe: 0, attentionUnknown: 0, nextReadOnlyActions: 1 }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" }, items: [{ threadId: "codex_thread:bad-attention-action-args", title: "Thread 1", state: "needs_nudge", sessionState: "running", attention: { level: "high", urgencyScore: 80 }, freshness: { lastEventAt: "2026-07-01T11:59:00.000Z", ageSeconds: 60, stale: false }, nextAction: { kind: "resume", confidence: 0.9, reason: "resume after watcher trigger" }, confidence: 0.9, reasonCodes: ["active_state:needs_nudge", "watcher_triggered", "app_server_state_overridden_by_watcher"], evidenceIds: ["ev_tool_smoke"], attentionCoverage: { status: "partial", confidence: 0.9, reasonCodes: ["attention_partial", "attention_conflicting_state", "attention_read_only_probe_available"], nextReadOnlyAction: { tool: "loo_codex_app_server_threads", execute: false, args: {}, reason: "Refresh read-only Codex app-server thread metadata before trusting the active-state lane." } }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" } }], omitted: { count: 0, reason: "none" }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
      process.exit(0);
    }
    if (activeThreadId === "malformed-attention-action") {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codex.activeThreadState.v1", publicSafe: true, readOnly: true, generatedAt: "2026-07-01T12:00:00.000Z", summary: { totalLanes: 1, returned: 1, running: 0, blocked: 0, needsApproval: 0, needsNudge: 1, stale: 0, waiting: 0, idle: 0, unknown: 0, lowConfidence: 0, attentionCovered: 0, attentionPartial: 1, attentionNeedsProbe: 0, attentionUnknown: 0, nextReadOnlyActions: 1 }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" }, items: [{ threadId: "codex_thread:malformed-attention-action", title: "Thread 1", state: "needs_nudge", sessionState: "running", attention: { level: "high", urgencyScore: 80 }, freshness: { lastEventAt: "2026-07-01T11:59:00.000Z", ageSeconds: 60, stale: false }, nextAction: { kind: "resume", confidence: 0.9, reason: "resume after watcher trigger" }, confidence: 0.9, reasonCodes: ["active_state:needs_nudge", "watcher_triggered", "app_server_state_overridden_by_watcher"], evidenceIds: ["ev_tool_smoke"], attentionCoverage: { status: "partial", confidence: 0.9, reasonCodes: ["attention_partial", "attention_conflicting_state", "attention_read_only_probe_available"], nextReadOnlyAction: "loo_codex_app_server_threads" }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" } }], omitted: { count: 0, reason: "none" }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
      process.exit(0);
    }
    if (activeThreadId === "core-missing-action") {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codex.activeThreadState.v1", publicSafe: true, readOnly: true, generatedAt: "2026-07-01T12:00:00.000Z", summary: { totalLanes: 1, returned: 1, running: 0, blocked: 0, needsApproval: 0, needsNudge: 0, stale: 0, waiting: 0, idle: 0, unknown: 1, lowConfidence: 1, attentionCovered: 0, attentionPartial: 0, attentionNeedsProbe: 1, attentionUnknown: 0, nextReadOnlyActions: 1 }, sourceCoverage: { indexedSession: "unavailable", cockpitInbox: "ok", watchers: "not_configured", codexAppServer: "ok", visibleCodexMap: "not_configured" }, items: [{ threadId: "codex_thread:core-missing-action", title: "Thread 1", state: "unknown", sessionState: "unknown", attention: { level: "medium", urgencyScore: 40 }, freshness: { lastEventAt: "2026-07-01T11:59:00.000Z", ageSeconds: 60, stale: false }, nextAction: { kind: "observe", confidence: 0.4, reason: "recover indexed source coverage" }, confidence: 0.4, reasonCodes: ["active_state:unknown"], evidenceIds: ["ev_tool_smoke"], attentionCoverage: { status: "needs_probe", confidence: 0.4, reasonCodes: ["attention_needs_probe", "attention_indexed_session_unavailable", "attention_low_confidence", "attention_read_only_probe_available"], nextReadOnlyAction: { tool: "lco_recent_sessions", execute: false, args: { scope: "active", include_cards: true, limit: 20 }, reason: "Refresh public-safe indexed active session cards before trusting the active-state lane." } }, sourceCoverage: { indexedSession: "unavailable", cockpitInbox: "ok", watchers: "not_configured", codexAppServer: "ok", visibleCodexMap: "not_configured" } }], omitted: { count: 0, reason: "none" }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
      process.exit(0);
    }
    if (activeThreadId === "empty-active-state") {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codex.activeThreadState.v1", publicSafe: true, readOnly: true, generatedAt: "2026-07-01T12:00:00.000Z", summary: { totalLanes: 0, returned: 0, running: 0, blocked: 0, needsApproval: 0, needsNudge: 0, stale: 0, waiting: 0, idle: 0, unknown: 0, lowConfidence: 0, attentionCovered: 0, attentionPartial: 0, attentionNeedsProbe: 0, attentionUnknown: 0, nextReadOnlyActions: 0 }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "not_configured", codexAppServer: "ok", visibleCodexMap: "not_configured" }, items: [], omitted: { count: 0, reason: "none" }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
      process.exit(0);
    }
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codex.activeThreadState.v1", publicSafe: true, readOnly: true, generatedAt: "2026-07-01T12:00:00.000Z", summary: { totalLanes: 1, returned: 1, running: 0, blocked: 0, needsApproval: 0, needsNudge: 1, stale: 0, waiting: 0, idle: 0, unknown: 0, lowConfidence: 0, attentionCovered: 0, attentionPartial: 1, attentionNeedsProbe: 0, attentionUnknown: 0, nextReadOnlyActions: 1 }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" }, items: [{ threadId: "codex_thread:thread-1", title: "Thread 1", state: "needs_nudge", sessionState: "running", attention: { level: "high", urgencyScore: 80 }, freshness: { lastEventAt: "2026-07-01T11:59:00.000Z", ageSeconds: 60, stale: false }, nextAction: { kind: "resume", confidence: 0.9, reason: "resume after watcher trigger" }, confidence: 0.9, reasonCodes: ["active_state:needs_nudge", "watcher_triggered", "app_server_state_overridden_by_watcher"], evidenceIds: ["ev_tool_smoke"], attentionCoverage: { status: "partial", confidence: 0.9, reasonCodes: ["attention_partial", "attention_conflicting_state", "attention_read_only_probe_available"], nextReadOnlyAction: { tool: "lco_codex_app_server_threads", execute: false, args: { read_thread_id: "thread-1", limit: 20 }, reason: "Refresh read-only Codex app-server thread metadata before trusting the active-state lane." } }, nextControlDryRun: { tool: "lco_codex_control_dry_run", execute: false, status: "ready", args: { action: "resume", thread_id: "thread-1" }, messageIncluded: false, messageRef: "control_dry_run_message:toolsmoke", approvalBoundary: "Live control still requires approval_audit_id.", blockers: [], reasonCodes: ["control_dry_run_recommended"], confidence: 0.9 }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" } }], omitted: { count: 0, reason: "none" }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
    process.exit(0);
  }
  if (name === "loo_codex_autonomy_tick") {
    const autonomyThreadId = toolArgs.app_server_threads?.threads?.[0]?.threadId;
    if (autonomyThreadId === "unsafe-autonomy-tick-schema") {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codex.autonomyTick.v1", publicSafe: false, readOnly: true, generatedAt: "2026-07-01T12:00:00.000Z", summary: { totalLanes: 1, returnedSteps: 1, readOnlyProbes: 1, controlDryRunRecommendations: 0, blockedControlDryRuns: 0 }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" }, steps: [{ stepId: "autonomy_step_probe", threadId: "codex_thread:unsafe-autonomy-tick-schema", stepType: "read_only_probe", priority: 1880, tool: "loo_codex_app_server_threads", execute: false, args: { read_thread_id: "unsafe-autonomy-tick-schema", limit: 20 }, reason: "Refresh read-only Codex app-server thread metadata before trusting the active-state lane.", idempotencyKey: "autonomy_tick:unsafe-schema", stopConditions: ["execute_false_only", "recompute_tick_after_probe", "raw_transcript_not_read"], reasonCodes: ["autonomy_tick_read_only_probe", "autonomy_tool:loo_codex_app_server_threads"], evidenceIds: ["ev_tool_smoke"], confidence: 0.9, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" } }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
      process.exit(0);
    }
    if (autonomyThreadId === "malformed-autonomy-tick-steps") {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codex.autonomyTick.v1", publicSafe: true, readOnly: true, generatedAt: "2026-07-01T12:00:00.000Z", summary: { totalLanes: 1, returnedSteps: 1, readOnlyProbes: 1, controlDryRunRecommendations: 0, blockedControlDryRuns: 0 }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" }, steps: [null], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
      process.exit(0);
    }
    if (autonomyThreadId === "mismatched-autonomy-tick-total-lanes") {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codex.autonomyTick.v1", publicSafe: true, readOnly: true, generatedAt: "2026-07-01T12:00:00.000Z", summary: { totalLanes: 0, returnedSteps: 1, readOnlyProbes: 1, controlDryRunRecommendations: 0, blockedControlDryRuns: 0 }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" }, steps: [{ stepId: "autonomy_step_probe", threadId: "codex_thread:mismatched-autonomy-tick-total-lanes", stepType: "read_only_probe", priority: 1880, tool: "loo_codex_app_server_threads", execute: false, args: { read_thread_id: "mismatched-autonomy-tick-total-lanes", limit: 20 }, reason: "Refresh read-only Codex app-server thread metadata before trusting the active-state lane.", idempotencyKey: "autonomy_tick:mismatched-total-lanes", stopConditions: ["execute_false_only", "recompute_tick_after_probe", "raw_transcript_not_read"], reasonCodes: ["autonomy_tick_read_only_probe", "autonomy_tool:loo_codex_app_server_threads"], evidenceIds: ["ev_tool_smoke"], confidence: 0.9, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" } }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
      process.exit(0);
    }
    if (autonomyThreadId === "missing-autonomy-tick-summary") {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codex.autonomyTick.v1", publicSafe: true, readOnly: true, generatedAt: "2026-07-01T12:00:00.000Z", sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" }, steps: [], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
      process.exit(0);
    }
    if (autonomyThreadId === "blocked-autonomy-dry-run") {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codex.autonomyTick.v1", publicSafe: true, readOnly: true, generatedAt: "2026-07-01T12:00:00.000Z", summary: { totalLanes: 1, returnedSteps: 1, readOnlyProbes: 0, controlDryRunRecommendations: 1, blockedControlDryRuns: 1 }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" }, steps: [{ stepId: "autonomy_step_blocked", threadId: "codex_thread:blocked-autonomy-dry-run", stepType: "control_dry_run", status: "blocked", priority: 1700, tool: "lco_codex_control_dry_run", execute: false, args: { action: "resume", thread_id: "blocked-autonomy-dry-run" }, reason: "Record that a future control dry-run is blocked until the approval boundary is resolved.", approvalBoundary: "Live control still requires approval_audit_id.", blockers: ["codex_approval_required"], idempotencyKey: "autonomy_tick:blocked-dry-run", stopConditions: ["execute_false_only", "live_control_requires_approval_audit_id", "codex_approval_sandbox_gates_preserved"], reasonCodes: ["autonomy_tick_control_dry_run", "autonomy_tool:lco_codex_control_dry_run", "control_dry_run_blocked"], evidenceIds: ["ev_tool_smoke"], confidence: 0.86, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" } }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
      process.exit(0);
    }
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codex.autonomyTick.v1", publicSafe: true, readOnly: true, generatedAt: "2026-07-01T12:00:00.000Z", summary: { totalLanes: 1, returnedSteps: 2, readOnlyProbes: 1, controlDryRunRecommendations: 1, blockedControlDryRuns: 0 }, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" }, steps: [{ stepId: "autonomy_step_probe", threadId: "codex_thread:thread-1", stepType: "read_only_probe", priority: 1880, tool: "lco_codex_app_server_threads", execute: false, args: { read_thread_id: "thread-1", limit: 20 }, reason: "Refresh read-only Codex app-server thread metadata before trusting the active-state lane.", idempotencyKey: "autonomy_tick:probe-thread-1", stopConditions: ["execute_false_only", "recompute_tick_after_probe", "raw_transcript_not_read"], reasonCodes: ["autonomy_tick_read_only_probe", "autonomy_tool:lco_codex_app_server_threads"], evidenceIds: ["ev_tool_smoke"], confidence: 0.9, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" } }, { stepId: "autonomy_step_dry_run", threadId: "codex_thread:thread-1", stepType: "control_dry_run", status: "ready", priority: 1780, tool: "lco_codex_control_dry_run", execute: false, args: { action: "resume", thread_id: "thread-1" }, reason: "Prepare a dry-run resume packet after read-only attention probes are refreshed.", approvalBoundary: "Live control still requires approval_audit_id.", idempotencyKey: "autonomy_tick:dry-run-thread-1", stopConditions: ["execute_false_only", "live_control_requires_approval_audit_id", "codex_approval_sandbox_gates_preserved"], reasonCodes: ["autonomy_tick_control_dry_run", "autonomy_tool:lco_codex_control_dry_run", "control_dry_run_ready"], evidenceIds: ["ev_tool_smoke"], confidence: 0.9, sourceCoverage: { indexedSession: "ok", cockpitInbox: "ok", watchers: "ok", codexAppServer: "ok", visibleCodexMap: "not_configured" } }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false, npmPublished: false, githubReleaseCreated: false } } }));
    process.exit(0);
  }
  if (name === "loo_codex_desktop_collaboration_proof") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.codexDesktopCollaborationProof.v1", publicSafe: true, readOnly: true, ok: true, status: "ready", target: { targetRef: toolArgs.target_ref, targetThreadId: toolArgs.target_thread_id }, actionHash: toolArgs.action_hash, approvalVerified: true, blockers: [], sourceCoverage: { indexedSession: "ok", desktopCoherence: "ok", desktopFallback: "ok", approvalPacket: "ok" }, requiredNextToolCall: { tool: "lco_desktop_proof", args: { check: "live_proof_harness", backend: toolArgs.backend, target_app: toolArgs.target_app, target_window: toolArgs.target_window, action: toolArgs.action, approval_ref: toolArgs.approval_packet?.approvalRef }, execute: false }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false } } }));
    process.exit(0);
  }
  if (name === "loo_watchers_list" || name === "loo_watcher_status") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, watchers: [{ watchId: "watch_tool_smoke_checks", targetRef: "codex_thread:thread-1", status: "triggered", mutates: false, reasonCodes: ["watcher_triggered"] }], summary: { triggered: 1 } } }));
    process.exit(0);
  }
  if (name === "loo_watcher_dry_run") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, resumeRequestPackets: [{ schema: "lco.resumeRequestPacket.v1", targetRef: "codex_thread:thread-1", requiresApproval: true, mutates: false }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, externalWrite: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_watcher_events") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.watchers.events.v1", publicSafe: true, readOnly: true, sourceCoverage: { watcherSpecs: "ok", watcherObservations: "ok", attentionQueue: "ok" }, summary: { total: 1, returned: 1, active: 0, triggered: 1, stale: 0, expired: 0, lowConfidence: 0, queueItems: 1, filteredUnsafeRows: 0 }, observations: [{ schema: "lco.watcherObservation.v1", observationRef: "watcher_observation:50000000000000000000000000000005", watchId: "watch_tool_smoke_checks", targetRef: "codex_thread:thread-1", watcher: { schema: "lco.watcherState.v1", watchId: "watch_tool_smoke_checks", targetRef: "codex_thread:thread-1", kind: "final_message_appeared", status: "triggered", wakeReason: "final_message_appeared", recommendedAction: "resume", requiresApproval: true, mutates: false, stale: false, expired: false, expiresAt: "2026-07-01T12:15:00.000Z", lastObservedAt: "2026-07-01T12:00:00.000Z", stopConditions: ["final_message_seen"], reasonCodes: ["watcher_triggered"], confidence: 0.9, evidenceIds: ["ev_tool_smoke"], approvalBoundary: "Read-only watcher." }, evidenceRefs: ["ev_tool_smoke"], sourceRefs: ["codex_thread:thread-1", "watcher:watch_tool_smoke_checks"], observedAt: "2026-07-01T12:00:00.000Z", freshness: { lastObservedAt: "2026-07-01T12:00:00.000Z", expiresAt: "2026-07-01T12:15:00.000Z", stale: false, expired: false }, reasonCodes: ["watcher_triggered"], confidence: 0.9, privacyClass: "public_safe_metadata" }], queue: [{ schema: "lco.attentionQueue.item.v1", itemRef: "attention_queue:50000000000000000000000000000005", targetRef: "codex_thread:thread-1", itemKind: "watcher_resume_request", status: "triggered", toolCall: { tool: "loo_resume_request_packet", execute: false, args: { watcher_spec: { schema: "lco.watchSpec.v1", watchId: "watch_tool_smoke_checks", targetRef: "codex_thread:thread-1", kind: "final_message_appeared", mutates: false }, recommended_action: "resume" } }, execute: false, sourceRefs: ["codex_thread:thread-1", "watcher:watch_tool_smoke_checks"], reasonCodes: ["watcher_attention_queue"], confidence: 0.9, freshnessAt: "2026-07-01T12:00:00.000Z" }], actionsPerformed: { derivedCacheWrite: false, sourceStoreMutation: false, externalWrite: false, liveControl: false, guiMutation: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_resume_request_packet") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, schema: "lco.resumeRequestPacket.v1", targetRef: "codex_thread:thread-1", requiresApproval: true, mutates: false } }));
    process.exit(0);
  }
  if (name === "loo_codex_app_server_status") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, schema: "lco.codex.appServerStatus.v1", readOnly: true, sourceCoverage: { codexAppServer: "partial" }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_codex_app_server_threads") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, schema: "lco.codex.appServerThreads.v1", sourceCoverage: { codexAppServer: "ok" }, threads: [{ appServerRef: "codex_app_thread:thread-1", threadId: "thread-1", sourceRef: "codex_thread:thread-1" }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_visible_codex_map") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, schema: "lco.visibleCodexSessionMap.v1", sourceCoverage: { indexedLco: "ok", visibleCodex: "not_configured", codexAppServer: "ok" }, items: [{ appServerRef: "codex_app_thread:thread-1", sourceRef: "codex_thread:thread-1", sessionCardRef: "codex_thread:thread-1", confidence: 0.86 }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_codex_desktop_coherence") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, schema: "lco.codexDesktopCoherence.v1", state: "cli_visible", visibility: { cli: "proven", desktop: "not_seen" }, target: { threadId: "thread-1", sourceRef: "codex_thread:thread-1" }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_codex_desktop_fallback_status") {
    const missingCoherence = !toolArgs.coherence;
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, schema: "lco.codex.desktopFallback.v1", target: { threadId: toolArgs.thread_id, sourceRef: toolArgs.source_ref }, fallback: { required: !missingCoherence, reason: missingCoherence ? "coherence_input_missing" : "desktop_visibility_not_proven" }, blockers: missingCoherence ? ["coherence_input_missing"] : [], nextToolCall: ${fallbackNextToolCallCode}, preferredBackend: "cua-driver", backends: [{ backend: "cua-driver", role: "preferred_background", status: "blocked" }, { backend: "peekaboo", role: "secondary_visible_fallback", status: "blocked", takesScreenWarning: true }], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, screenshotCaptured: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_desktop_act") {
    if (${options.desktopActValidationError ? "true" : "false"}) {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { ok: false, error: { code: "validation_failed", message: "action is required" }, publicSafe: true, readOnly: true, status: "blocked", blockers: ["desktop_live_action_disallowed"], proofMarkers: { noActionObserved: true }, actionsPerformed: { desktopGuiActionRun: false, screenshotCaptured: false } } }));
      process.exit(0);
    }
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: ${desktopActOutputCode} }));
    process.exit(0);
  }
  if (name === "loo_desktop_proof_report") {
    if (${options.currentProductFailClosedShapes ? "true" : "false"}) {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { details: { ok: false, proofReady: false, publicSafe: true, kind: "loo_desktop_gui_proof_report", liveActionObserved: false, rawScreenshotIncluded: false, rawSecretIncluded: false, blockers: ["observation_kind_invalid", "desktop_backend_missing", "desktop_live_action_not_observed", "focus_proof_missing"], actionsPerformed: { desktopGuiActionRun: false } } } }));
      process.exit(0);
    }
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, status: "not_observed", blockers: ${options.arbitraryProofReportBlocker ? "[\"any-reason\"]" : "[\"live_action_not_observed\"]"}, proofMarkers: ${options.arbitraryProofReportBlocker ? "{}" : "{ liveActionObserved: false, rawScreenshotIncluded: false, rawSecretIncluded: false }"}, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false } } }));
    process.exit(0);
  }
  if (name === "loo_desktop_live_proof_harness") {
    if (${options.weakHarnessReadyProof ? "true" : "false"}) {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { details: { ok: true, proofHarnessReady: true, publicSafe: true, kind: "loo_desktop_live_proof_harness", blockers: [] } } }));
      process.exit(0);
    }
    if (${options.snakeCaseHarnessReadyProof ? "true" : "false"}) {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { details: { ok: true, proof_harness_ready: true, proofHarnessReady: true, public_safe: true, kind: "loo_desktop_live_proof_harness", desktop_backend: "cua-driver", target_app: toolArgs.target_app, target_window: toolArgs.target_window, action: toolArgs.action, action_hash: "action-hash", approval_ref: toolArgs.approval_ref, blockers: [], proof_markers: { noActionObserved: true }, actions_performed: { desktop_gui_action_run: false, screenshot_captured: false } } } }));
      process.exit(0);
    }
    if (${options.currentProductFailClosedShapes ? "true" : "false"}) {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { details: { ok: true, proofHarnessReady: true, publicSafe: true, kind: "loo_desktop_live_proof_harness", desktopBackend: "cua-driver", targetApp: toolArgs.target_app, targetWindow: toolArgs.target_window, action: toolArgs.action, actionHash: "action-hash", approvalRef: toolArgs.approval_ref, blockers: [], proofMarkers: { noActionObserved: true }, actionsPerformed: { desktopGuiActionRun: false, screenshotCaptured: false } } } }));
      process.exit(0);
    }
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, status: "blocked", blockers: ["desktop_live_action_not_run"], nextToolCall: { tool: "loo_desktop_proof_action", args: { backend: toolArgs.backend, target_app: "TextEdit", target_window: "lco-desktop-proof.txt", action: "launch_app TextEdit scratch window" }, execute: false }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false } } }));
    process.exit(0);
  }
  if (name === "loo_desktop_proof_action") {
    if (${options.currentProductFailClosedShapes ? "true" : "false"}) {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { details: { ok: false, proofActionReady: false, publicSafe: true, kind: "loo_desktop_proof_action", desktopBackend: toolArgs.backend, targetApp: toolArgs.target_app, targetWindow: toolArgs.target_window, action: toolArgs.action, approvalVerified: false, blockers: ["execute_flag_missing", "approval_ref_missing", "permission_state_missing", "scratch_file_missing", "action_hash_missing", "approval_artifact_missing"], actionsPerformed: { desktopGuiActionRun: false, screenshotCaptured: false } } } }));
      process.exit(0);
    }
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, status: "blocked", blockers: ["execute_false_no_action"], execute: false, proofMarkers: { noActionObserved: true }, actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false } } }));
    process.exit(0);
  }
  if (name === "loo_plan_state_pins") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, manualPins: [] } }));
    process.exit(0);
  }
  if (name === "loo_github_operating_items") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, items: [{ id: "100yenadmin/Lossless-Codex-Orchestrator-LCO#264", kind: "pr", state: "red", reasonCodes: ["ci_failed"] }], sourceCoverage: { github: "ok" }, actionsPerformed: { githubWriteRun: false, liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
  if (name === "loo_project_digest" || name === "loo_attention_inbox") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, sourceCoverage: { lco: "ok", github: "not_configured", plan_state: "not_configured" }, cards: [] } }));
    process.exit(0);
  }
  if (name === "loo_business_pulse") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, digest: { sourceCoverage: { lco: "ok", github: "not_configured", plan_state: "not_configured" } } } }));
    process.exit(0);
  }
  if (name === "loo_summary_leaves") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.summary.leaves.v1", publicSafe: true, readOnly: true, sourceCoverage: { summaryLeaves: "ok", preparedSourceRanges: "ok" }, summary: { total: 1, returned: 1 }, leaves: [{ schema: "lco.summary.leaf.v1", leafRef: "summary_leaf:50000000000000000000000000000005", threadId: toolArgs.thread_id || "thread-1", leafKind: "final_message", sourceRefs: ["codex_thread:" + (toolArgs.thread_id || "thread-1")], sourceRangeRefs: ["codex_range:50000000000000000000000000000005"], confidence: 0.9, privacyClass: "public_safe_metadata" }], actionsPerformed: { derivedCacheWrite: false, sourceStoreMutation: false, externalWrite: false, liveControl: false, guiMutation: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
	  if (name === "loo_summary_expand") {
	    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.summary.expansion.v1", publicSafe: true, readOnly: true, root: { leafRef: null, threadId: preparedThreadId }, limits: { maxDepth: toolArgs.max_depth, maxNodes: toolArgs.max_nodes, tokenBudget: summaryExpansionTokenBudget ?? toolArgs.token_budget }, leaves: [{ leafRef: "summary_leaf:50000000000000000000000000000005", threadId: preparedThreadId, sourceRangeRefs: ["codex_range:50000000000000000000000000000005"] }], omissions: [], actionsPerformed: { derivedCacheWrite: false, sourceStoreMutation: false, externalWrite: false, liveControl: false, guiMutation: false, rawTranscriptRead: false } } }));
	    process.exit(0);
	  }
  if (name === "loo_prepared_state_status") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.preparedState.status.v1", publicSafe: true, readOnly: true, sourceCoverage: { summaryLeaves: "ok", preparedCards: "ok", preparedInboxItems: "ok", watcherObservations: "not_configured" }, targetCoverage: ${preparedTargetCoverageCode}, summary: { summaryLeaves: 1, cards: 1, inboxItems: 1, staleCards: 0, partialCards: 0, unknownCards: 0, lowConfidenceCards: 0 }, actionsPerformed: { derivedCacheWrite: false, sourceStoreMutation: false, externalWrite: false, liveControl: false, guiMutation: false, rawTranscriptRead: false } } }));
    process.exit(0);
  }
	  if (name === "loo_prepared_cards") {
	    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.prepared.cards.v1", publicSafe: true, readOnly: true, sourceCoverage: { preparedCards: "ok", summaryLeaves: "ok", watcherObservations: "not_configured" }, summary: { total: 1, returned: 1, stale: 0, partial: 0, unknown: 0, lowConfidence: 0 }, cards: [{ schema: "lco.prepared.card.v1", cardRef: "prepared_card:50000000000000000000000000000005", targetRef: "codex_thread:" + preparedThreadId, cardKind: "codex_session", title: "Thread 1", summary: "Public-safe prepared card.", nextAction: "Review bounded summary evidence.", sourceRefs: ["codex_thread:" + preparedThreadId, "summary_leaf:50000000000000000000000000000005"], sourceRangeRefs: ["codex_range:50000000000000000000000000000005"], sourceRangeRefsOmitted: 2, authorityCoverage: { summaryLeaves: { status: "ok", leafCount: 1, rangeCount: 3 }, sessionMetadata: { status: "ok" }, watcherObservations: { status: "not_configured" } }, confidence: 0.9, freshnessAt: "2026-07-01T12:00:00.000Z", stale: false, state: "ready", reasonCodes: ["summary_leaves_ready"], privacyClass: "public_safe_metadata" }], actionsPerformed: { derivedCacheWrite: false, sourceStoreMutation: false, externalWrite: false, liveControl: false, guiMutation: false, rawTranscriptRead: false } } }));
	    process.exit(0);
	  }
	  if (name === "loo_prepared_inbox") {
	    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { schema: "lco.prepared.inbox.v1", publicSafe: true, readOnly: true, sourceCoverage: { preparedCards: "ok", summaryLeaves: "ok", watcherObservations: "not_configured" }, summary: { total: 1, returned: 1, critical: 0, high: 1, lowConfidence: 0 }, items: [{ schema: "lco.prepared.inboxItem.v1", itemRef: "prepared_inbox:50000000000000000000000000000005", cardRef: "prepared_card:50000000000000000000000000000005", targetRef: "codex_thread:" + preparedThreadId, urgencyScore: 80, state: "ready", reasonCodes: ["summary_leaves_ready"], sourceRefs: ["codex_thread:" + preparedThreadId, "prepared_card:50000000000000000000000000000005"], execute: false }], actionsPerformed: { derivedCacheWrite: false, sourceStoreMutation: false, externalWrite: false, liveControl: false, guiMutation: false, rawTranscriptRead: false } } }));
	    process.exit(0);
	  }
  if (name === "loo_codex_control_dry_run") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: ${dryRunOutputCode} }));
    process.exit(0);
  }
  if (name === "loo_codex_start_thread") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { action: "codex_start_thread", live: false, approvalAuditId: "loo_audit_start_test", paramsHash: "start-params-hash", method: "thread/start", approval_audit_id: "loo_audit_start_test", params_hash: "start-params-hash" } }));
    process.exit(0);
  }
  if (name === "loo_codex_resume_thread") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { action: "codex_resume_thread", threadId: toolArgs.thread_id, live: false, approvalAuditId: "loo_audit_resume_test", paramsHash: "resume-params-hash", method: "thread/resume", approval_audit_id: "loo_audit_resume_test", params_hash: "resume-params-hash" } }));
    process.exit(0);
  }
  if (name === "loo_codex_send_message") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { action: "codex_send_message", threadId: toolArgs.thread_id, live: false, approvalAuditId: "loo_audit_send_test", paramsHash: "send-params-hash", messageHash: "send-message-hash", method: "turn/start", approval_audit_id: "loo_audit_send_test", params_hash: "send-params-hash", message_hash: "send-message-hash" } }));
    process.exit(0);
  }
  if (name === "loo_codex_steer_thread") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { action: "codex_steer_thread", threadId: toolArgs.thread_id, live: false, approvalAuditId: "loo_audit_steer_test", paramsHash: "steer-params-hash", messageHash: "steer-message-hash", method: "turn/steer", approval_audit_id: "loo_audit_steer_test", params_hash: "steer-params-hash", message_hash: "steer-message-hash" } }));
    process.exit(0);
  }
  if (name === "loo_codex_interrupt_thread") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { action: "codex_interrupt_thread", threadId: toolArgs.thread_id, live: false, approvalAuditId: "loo_audit_interrupt_test", paramsHash: "interrupt-params-hash", method: "thread/interrupt", approval_audit_id: "loo_audit_interrupt_test", params_hash: "interrupt-params-hash" } }));
    process.exit(0);
  }
  if (name === "loo_codex_start_thread_post_create_proof") {
    if (${options.currentProductFailClosedShapes ? "true" : "false"}) {
      console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { details: { schema: "lco.codex.startThreadPostCreateProof.v1", public_safe: true, read_only: true, status: "unresolved_unknown", created_thread_ref: toolArgs.created_thread_ref, reason_codes: ["app_server_thread_missing", "read_probe_missing_or_failed", "created_but_unindexed_pending", "indexed_description_missing", "prepared_card_missing", "unresolved_unknown"], actions_performed: { live_codex_control_run: false, desktop_gui_action_run: false, raw_transcript_read: false, source_store_mutation: false, npm_publish: false, github_release: false } } } }));
      process.exit(0);
    }
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, status: "unresolved_unknown", createdThreadId: toolArgs.created_thread_id, createdThreadRef: toolArgs.created_thread_ref, reasonCodes: ["post_create_proof_missing_persisted_evidence"], blockers: ["created_thread_not_persisted"], actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false, screenshotCaptured: false } } }));
    process.exit(0);
  }
  if (name === "loo_permissions") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { liveControlRequires: ["dry_run", "approval_audit_id"], uploadsLocalText: false } }));
    process.exit(0);
  }
  if (name === "loo_audit_tail") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, entries: [{ auditId: "loo_audit_test", action: "dry_run" }], count: 1 } }));
    process.exit(0);
  }
  if (name === "loo_codex_sqlite_stores") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, stores: [{ storeRef: "codex_sqlite_store:tool-smoke", status: "present" }], count: 1 } }));
    process.exit(0);
  }
  if (name === "loo_lcm_peer_dbs") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { peers: [{ path: ${options.unsafeLcmPeerPath ? "\"/Users/lume/.openclaw/lco-private-peer.sqlite\"" : options.unsafeLcmPeerRef ? "\"lcm_peer_db:/Users/lume/.openclaw/lco-private-peer.sqlite\"" : options.unsafeLcmPeerRelativePath ? "\"relative/../../etc/secret\"" : "\"<redacted-local-path>/lcm-peer-000000000000.sqlite\""}, readable: false, readOnly: true, queryOnly: false, supported: false, tables: [], summaryCount: null, ftsAvailable: false, reason: "not found" }] } }));
    process.exit(0);
  }
  if (name === "loo_desktop_see") {
    console.log(JSON.stringify({ ok: true, toolName: name, source: "plugin", output: { publicSafe: true, readOnly: true, backend: toolArgs.backend, snapshotIncluded: false, nodes: [{ role: "window", name: "Lossless OpenClaw Orchestrator" }], actionsPerformed: { desktopGuiActionRun: false, screenshotCaptured: false, rawTranscriptRead: false } } }));
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
  console.log(JSON.stringify({ groups: [{ tools: ${JSON.stringify(DEFAULT_REQUIRED_TOOL_CALLS.map((id) => ({ id })))} }] }));
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

function createMixedSetupAndToolFailureFakeOpenClaw(dir: string): { bin: string; callsPath: string } {
  const callsPath = join(dir, "calls.jsonl");
  const bin = join(dir, "openclaw-mixed-failure-fake.mjs");
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const callIndex = args.indexOf("call");
const method = callIndex >= 0 ? args[callIndex + 1] : "";
const paramsIndex = args.indexOf("--params");
const params = paramsIndex >= 0 ? JSON.parse(args[paramsIndex + 1] || "{}") : {};
appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify({ method, params, args, envTokenPresent: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN) }) + "\\n");
if (method === "tools.catalog") {
  console.log(JSON.stringify({ tools: [{ name: "loo_doctor" }, { name: "loo_search_sessions" }] }));
  process.exit(0);
}
if (method === "tools.invoke" && params.name === "loo_doctor") {
  console.log(JSON.stringify({ ok: false, toolName: params.name, source: "plugin", error: { code: "forbidden", message: "super-secret-transcript-span" } }));
  process.exit(0);
}
if (method === "tools.invoke" && params.name === "loo_search_sessions") {
  console.error("gateway tools.invoke requires credentials before opening a websocket");
  process.exit(1);
}
process.exit(7);
`);
  chmodSync(bin, 0o755);
  return { bin, callsPath };
}

function createValidationFailureFakeOpenClaw(dir: string): { bin: string; callsPath: string } {
  const callsPath = join(dir, "calls.jsonl");
  const bin = join(dir, "openclaw-validation-failure-fake.mjs");
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const callIndex = args.indexOf("call");
const method = callIndex >= 0 ? args[callIndex + 1] : "";
const paramsIndex = args.indexOf("--params");
const params = paramsIndex >= 0 ? JSON.parse(args[paramsIndex + 1] || "{}") : {};
appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify({ method, params, args, envTokenPresent: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN) }) + "\\n");
if (method === "tools.catalog") {
  console.log(JSON.stringify({ tools: [{ name: "loo_codex_steer_thread" }] }));
  process.exit(0);
}
if (method === "tools.invoke") {
  console.log(JSON.stringify({
    ok: false,
    toolName: params.name,
    source: "plugin",
    error: {
      code: "internal_error",
      message: "expected_turn_id is required for steer actions; raw prompt at /Users/example/.codex/sessions/private.jsonl super-secret-transcript-span"
    }
  }));
  process.exit(0);
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
  const { bin, callsPath } = createFakeOpenClaw(dir, DEFAULT_REQUIRED_TOOL_CALLS);

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
    assert.deepEqual(report.setupStatus, {
      classification: "ready",
      packageInstallLikelyOk: true,
      recoverable: false,
      retryAfterSetup: false,
      doesNotIndicatePackageFailure: true
    });
    assert.equal(report.catalog.requiredToolsPresent, true);
    assert.deepEqual(report.invocations.map((call) => call.toolName), DEFAULT_REQUIRED_TOOL_CALLS);
    for (const toolName of C1_UMBRELLA_TOOL_CALLS) {
      assert.equal(DEFAULT_REQUIRED_TOOL_CALLS.includes(toolName), true, `${toolName} is part of the base gateway smoke`);
      assert.equal(report.invocations.some((call) => call.toolName === toolName), true, `${toolName} was invoked`);
    }
    assert.equal(report.invocations.find((call) => call.toolName === "loo_find")?.summary.sourceRefs?.[0], "codex_thread:thread-1");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_search_sessions")?.summary.sourceRefs?.[0], "codex_thread:thread-1");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_describe_session")?.summary.threadId, "thread-1");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_expand_query")?.summary.profile, "brief");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_summary_leaves")?.summary.sourceRefs?.some((ref) => ref.startsWith("summary_leaf:")), true);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_summary_expand")?.summary.tokenBudget, 1000);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_prepared_cards")?.summary.sourceRefs?.some((ref) => ref.startsWith("prepared_card:")), true);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_prepared_inbox")?.summary.sourceRefs?.some((ref) => ref.startsWith("prepared_inbox:")), true);
    assert.equal((report.invocations.find((call) => call.toolName === "loo_watcher_events")?.summary.watcherEvents as Record<string, number> | undefined)?.queueItems, 1);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_codex_control_dry_run")?.summary.live, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_codex_control_dry_run")?.summary.approvalAuditId, "loo_audit_test");
    assert.equal(report.smokeDispositionPlan.counts.unknown_non_claim, 0);
    assert.equal(report.smokeDispositionPlan.entries.find((entry) => entry.toolName === "loo_doctor")?.disposition, "successful_invocation");
    assert.equal(report.smokeDispositionPlan.entries.find((entry) => entry.toolName === "loo_codex_control_dry_run")?.disposition, "successful_dry_run");
    assert.equal(report.agentReasoning?.safeRecommendation, "Review the selected Codex session from source refs, then ask the user before any live Codex control.");
    assert.equal(report.agentReasoning?.selectedThreadId, "thread-1");
    assert.equal(report.agentReasoning?.sourceRefs.includes("codex_thread:thread-1"), true);
    assert.equal(report.agentReasoning?.sourceRefs.some((ref) => ref.startsWith("summary_leaf:")), true);
    assert.equal(report.agentReasoning?.sourceRefs.some((ref) => ref.startsWith("prepared_card:")), true);
    assert.deepEqual(report.agentReasoning?.workflowEvidence, [
      "doctor_ready",
      "search_source_ref",
      "describe_thread",
      "bounded_expand",
      "plan_lookup",
      "final_message_lookup",
      "touched_files_lookup",
      "prepared_state_status",
      "prepared_cards",
      "prepared_inbox",
      "summary_leaf_lookup",
      "summary_expand",
      "dry_run_audit"
    ]);
    assert.equal(report.agentReasoning?.dryRunApprovalAuditId, "loo_audit_test");
    assert.equal(report.agentReasoning?.dryRunLive, false);
    assert.equal(report.agentReasoning?.rawTranscriptRead, false);
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
    assert.equal(calls.find((call) => call.params.name === "loo_prepared_state_status")?.params.args?.thread_id, "thread-1");
    assert.equal(calls.find((call) => call.params.name === "loo_prepared_cards")?.params.args?.thread_id, "thread-1");
    assert.equal(calls.find((call) => call.params.name === "loo_prepared_inbox")?.params.args?.thread_id, "thread-1");
    assert.equal(calls.find((call) => call.params.name === "loo_summary_expand")?.params.args?.thread_id, "thread-1");
    assert.equal(calls.some((call) => call.args.includes("--token")), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke invokes canonical 1.6 facade and control-plane tools", () => {
  const dir = mkdtempSync(join(tmpdir(), "lco-openclaw-tool-smoke-canonical-"));
  const requiredTools = [
    "lco_doctor",
    "lco_search_sessions",
    "lco_session_diff",
    "lco_drive",
    "lco_codex_control_dry_run"
  ];
  const { bin, callsPath } = createFakeOpenClaw(dir, requiredTools);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-canonical-smoke",
      requiredTools,
      tokenBudget: 500
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(report.invocations.map((call) => call.toolName), requiredTools);
    assert.equal(report.smokeDispositionPlan.counts.unknown_non_claim, 0);
    assert.equal(report.invocations.find((call) => call.toolName === "lco_session_diff")?.summary.threadId, "thread-1");
    assert.equal(report.invocations.find((call) => call.toolName === "lco_drive")?.summary.live, false);
    assert.equal(report.invocations.find((call) => call.toolName === "lco_drive")?.summary.approvalAuditId, "loo_audit_drive");
    assert.equal(report.invocations.find((call) => call.toolName === "lco_codex_control_dry_run")?.summary.live, false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke emits safe full-gateway disposition plan for missing tools", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-dispositions-"));
  const successfulInvocationTools = [
    "loo_index_sessions",
    "loo_describe_ref",
    "loo_expand_session",
    "loo_grep",
    "loo_codex_session_management_map",
    "loo_codex_tool_calls",
    "loo_closeout_dry_run",
    "loo_session_sanitizer",
    "loo_permissions",
    "loo_audit_tail",
    "loo_codex_sqlite_stores",
    "loo_lcm_peer_dbs",
    "loo_desktop_see"
  ];
  const successfulDryRunTools = [
    "loo_codex_start_thread",
    "loo_codex_resume_thread",
    "loo_codex_send_message",
    "loo_codex_steer_thread",
    "loo_codex_interrupt_thread"
  ];
  const expectedFailClosedTools = [
    "loo_codex_start_thread_post_create_proof",
    "loo_codex_desktop_fallback_status",
    "loo_desktop_act",
    "loo_desktop_proof_report",
    "loo_desktop_live_proof_harness",
    "loo_desktop_proof_action"
  ];
  const excludedNonClaimTools: string[] = [];
  const requiredTools = [
    ...successfulInvocationTools,
    ...successfulDryRunTools,
    ...expectedFailClosedTools,
    ...excludedNonClaimTools
  ];
  const { bin, callsPath } = createFakeOpenClaw(dir, requiredTools);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools,
      threadId: "thread-1",
      query: "Proposed plan",
      expandProfile: "brief",
      tokenBudget: 1000
    }) as ReturnType<typeof runOpenClawToolSmoke> & {
      smokeDispositionPlan?: {
        counts: Record<string, number>;
        entries: Array<{
          toolName: string;
          disposition: string;
          productEvidenceClaimed: boolean;
          invoked: boolean;
        }>;
      };
    };

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(report.smokeDispositionPlan?.counts, {
      successful_invocation: successfulInvocationTools.length,
      successful_dry_run: successfulDryRunTools.length,
      expected_fail_closed: expectedFailClosedTools.length,
      excluded_non_claim: excludedNonClaimTools.length,
      unknown_non_claim: 0
    });
    assert.deepEqual(
      Object.fromEntries(report.smokeDispositionPlan?.entries.map((entry) => [entry.toolName, entry.disposition]) ?? []),
      Object.fromEntries([
        ...successfulInvocationTools.map((toolName) => [toolName, "successful_invocation"]),
        ...successfulDryRunTools.map((toolName) => [toolName, "successful_dry_run"]),
        ...expectedFailClosedTools.map((toolName) => [toolName, "expected_fail_closed"]),
        ...excludedNonClaimTools.map((toolName) => [toolName, "excluded_non_claim"])
      ])
    );
    assert.equal(report.invocations.find((call) => call.toolName === "loo_codex_start_thread")?.summary.live, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_desktop_act")?.ok, true);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_desktop_act")?.summary.toolBlockers?.includes("desktop_live_action_disallowed"), true);
    assert.match(report.smokeDispositionPlan?.proofBoundary ?? "", /trust explicit dry_run\/live:false plus audit\/hash markers/);
    assert.equal(report.smokeDispositionPlan?.entries.find((entry) => entry.toolName === "loo_index_sessions")?.productEvidenceClaimed, true);
    assert.equal(report.smokeDispositionPlan?.entries.find((entry) => entry.toolName === "loo_lcm_peer_dbs")?.productEvidenceClaimed, true);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    assert.deepEqual(calls.filter((call) => call.method === "tools.invoke").map((call) => call.params.name), [
      ...successfulInvocationTools,
      ...successfulDryRunTools,
      ...expectedFailClosedTools
    ]);
    assert.deepEqual(calls.find((call) => call.params.name === "loo_index_sessions")?.params.args, {
      roots: ["./lco-tool-smoke-no-such-codex-root"],
      max_files: 1,
      max_bytes_per_file: 1024,
      max_events_per_file: 1
    });
    assert.deepEqual(calls.find((call) => call.params.name === "loo_lcm_peer_dbs")?.params.args, {
      lcm_db_paths: ["./lco-tool-smoke-no-such-lcm.sqlite"]
    });
    assert.equal(calls.find((call) => call.params.name === "loo_grep")?.params.args?.profile, "metadata");
    assert.equal(calls.find((call) => call.params.name === "loo_grep")?.params.args?.token_budget, 200);
    assert.equal(calls.find((call) => call.params.name === "loo_codex_steer_thread")?.params.args?.expected_turn_id, "tool-smoke-turn");
    assert.equal(calls.find((call) => call.params.name === "loo_codex_interrupt_thread")?.params.args?.expected_turn_id, "tool-smoke-turn");
    assert.equal(calls.find((call) => call.params.name === "loo_desktop_act")?.params.args?.dry_run, true);
    assert.equal(calls.find((call) => call.params.name === "loo_desktop_see")?.params.args?.include_snapshot, false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke CLI --coverage full selects the disposition matrix", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-cli-full-coverage-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, FULL_GATEWAY_SMOKE_TOOL_CALLS);
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "openclaw",
    "tool-smoke",
    "--openclaw-bin",
    bin,
    "--profile",
    "lco-m12-full-gateway",
    "--session-key",
    "agent:main:lco-m12-full-gateway",
    "--evidence-path",
    evidencePath,
    "--coverage",
    "full",
    "--thread-id",
    "thread-1",
    "--query",
    "Proposed plan",
    "--strict"
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCLAW_FAKE_CALLS: callsPath
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as ReturnType<typeof runOpenClawToolSmoke>;
  assert.equal(report.toolSmokeReady, true, JSON.stringify(report, null, 2));
  assert.equal(report.catalog.requiredTools.length, FULL_GATEWAY_SMOKE_TOOL_CALLS.length);
  assert.equal(report.smokeDispositionPlan.counts.excluded_non_claim, 0);
  assert.equal(report.smokeDispositionPlan.entries.find((entry) => entry.toolName === "loo_index_sessions")?.productEvidenceClaimed, true);
  assert.equal(report.smokeDispositionPlan.entries.find((entry) => entry.toolName === "loo_lcm_peer_dbs")?.productEvidenceClaimed, true);

  const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string } });
  const invokedToolNames = calls.filter((call) => call.method === "tools.invoke").map((call) => call.params.name);
  assert.equal(invokedToolNames.includes("loo_index_sessions"), true);
  assert.equal(invokedToolNames.includes("loo_lcm_peer_dbs"), true);
  assert.equal(invokedToolNames.includes("loo_desktop_proof_action"), true);
  for (const toolName of C1_UMBRELLA_TOOL_CALLS) {
    assert.equal(invokedToolNames.includes(toolName), true, `${toolName} was invoked by --coverage full`);
  }
  assert.equal(existsSync(evidencePath), true);
  assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span|Harmless beta smoke|npm_/);
});

test("OpenClaw tool smoke rejects --coverage full with explicit --required-tool", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-full-required-conflict-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin } = createFakeOpenClaw(dir, FULL_GATEWAY_SMOKE_TOOL_CALLS);
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "openclaw",
    "tool-smoke",
    "--openclaw-bin",
    bin,
    "--coverage",
    "full",
    "--required-tool",
    "loo_doctor",
    "--evidence-path",
    evidencePath,
    "--strict"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /--coverage full cannot be combined with --required-tool/);
});

test("OpenClaw tool smoke full coverage blocks thread-bound control tools without thread id", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-no-thread-control-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, [
    "loo_codex_send_message",
    "loo_codex_steer_thread",
    "loo_codex_interrupt_thread"
  ]);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: [
        "loo_codex_send_message",
        "loo_codex_steer_thread",
        "loo_codex_interrupt_thread"
      ]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.equal(report.blockers.includes("openclaw_tool_smoke_missing_thread_ref"), true);
    assert.equal(report.invocations.length, 0);
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { method: string });
    assert.equal(calls.filter((call) => call.method === "tools.invoke").length, 0);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke full coverage without explicit thread id uses discovered target before thread-bound control calls", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-full-no-thread-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, FULL_GATEWAY_SMOKE_TOOL_CALLS);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: FULL_GATEWAY_SMOKE_TOOL_CALLS
    });

    assert.equal(report.toolSmokeReady, true, JSON.stringify(report, null, 2));
    assert.equal(report.agentReasoning?.selectedThreadId, "thread-1");
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { method: string; params: { name?: string } });
    const invoked = calls.filter((call) => call.method === "tools.invoke").map((call) => call.params.name);
    assert.equal(invoked.includes("loo_codex_send_message"), true);
    assert.equal(invoked.includes("loo_codex_steer_thread"), true);
    assert.equal(invoked.includes("loo_codex_interrupt_thread"), true);
    assert.equal(invoked.includes("loo_codex_resume_thread"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke blocks unknown tool disposition instead of claiming product evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-unknown-disposition-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_future_control_tool"]);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_future_control_tool"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.ok(report.blockers.includes("openclaw_tool_smoke_unknown_disposition"), JSON.stringify(report, null, 2));
    assert.equal(report.invocations.length, 0);
    assert.equal(report.smokeDispositionPlan.entries[0]?.productEvidenceClaimed, false);
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { method: string });
    assert.equal(calls.filter((call) => call.method === "tools.invoke").length, 0);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects vague reason-code-only desktop action proof", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-weak-desktop-act-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_desktop_act"], "flat", {
    weakDesktopActProof: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_desktop_act"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.ok(report.blockers.includes("expected_fail_closed_not_proven:loo_desktop_act"), JSON.stringify(report, null, 2));
    assert.equal(report.invocations.find((call) => call.toolName === "loo_desktop_act")?.ok, false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects bare blocked desktop action status without no-action proof", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-bare-desktop-act-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_desktop_act"], "flat", {
    bareDesktopActStatus: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_desktop_act"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.ok(report.blockers.includes("expected_fail_closed_not_proven:loo_desktop_act"), JSON.stringify(report, null, 2));
    assert.equal(report.invocations.find((call) => call.toolName === "loo_desktop_act")?.ok, false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke accepts explicit no-action marker for desktop action proof without blockers", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-marker-desktop-act-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_desktop_act"], "flat", {
    markerOnlyDesktopActProof: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_desktop_act"]
    });

    assert.equal(report.toolSmokeReady, true, JSON.stringify(report, null, 2));
    assert.equal(report.invocations.find((call) => call.toolName === "loo_desktop_act")?.ok, true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke accepts current product fail-closed envelopes for boundary tools", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-current-failclosed-"));
  const tools = [
    "loo_codex_start_thread_post_create_proof",
    "loo_desktop_act",
    "loo_desktop_proof_report",
    "loo_desktop_live_proof_harness",
    "loo_desktop_proof_action"
  ];
  const { bin, callsPath } = createFakeOpenClaw(dir, tools, "flat", {
    currentProductFailClosedShapes: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: tools,
      threadId: "00000000-0000-4000-8000-000000000001"
    });

    assert.equal(report.toolSmokeReady, true, JSON.stringify(report, null, 2));
    for (const toolName of tools) {
      const invocation = report.invocations.find((call) => call.toolName === toolName);
      assert.equal(invocation?.ok, true, JSON.stringify(invocation, null, 2));
      assert.equal(invocation?.productEvidenceClaimed, false);
    }
    assert.deepEqual(report.actionsPerformed, {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      npmPublished: false,
      githubReleaseCreated: false,
      channelDelivery: false,
      broadGatewayScopeApproval: false
    });
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects desktop act dry-run metadata without action markers", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-missing-desktop-action-markers-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_desktop_act"], "flat", {
    currentProductFailClosedShapes: true,
    missingDesktopActActions: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_desktop_act"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_desktop_act")?.ok, false);
    assert.equal(report.blockers.includes("expected_fail_closed_not_proven:loo_desktop_act"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke preserves coded not-ok blockers for fail-closed tools", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-coded-not-ok-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_desktop_act"], "flat", {
    desktopActValidationError: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_desktop_act"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_desktop_act")?.ok, false);
    assert.equal(report.blockers.includes("openclaw_tool_result_not_ok:loo_desktop_act:validation_failed"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects bare harness-ready desktop proof without no-action evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-weak-harness-proof-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_desktop_live_proof_harness"], "flat", {
    weakHarnessReadyProof: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_desktop_live_proof_harness"],
      threadId: "00000000-0000-4000-8000-000000000001"
    });

    assert.equal(report.toolSmokeReady, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_desktop_live_proof_harness")?.ok, false);
    assert.equal(report.blockers.includes("expected_fail_closed_not_proven:loo_desktop_live_proof_harness"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke accepts snake_case no-action desktop harness proof", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-snake-harness-proof-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_desktop_live_proof_harness"], "flat", {
    snakeCaseHarnessReadyProof: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_desktop_live_proof_harness"],
      threadId: "00000000-0000-4000-8000-000000000001"
    });

    assert.equal(report.toolSmokeReady, true, JSON.stringify(report, null, 2));
    assert.equal(report.invocations.find((call) => call.toolName === "loo_desktop_live_proof_harness")?.ok, true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects index-session errors and limited files as product evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-index-errors-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_index_sessions"], "flat", {
    unsafeIndexErrorPath: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_index_sessions"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_index_sessions")?.ok, false);
    assert.equal(report.blockers.includes("index_sessions_errors_not_public_evidence"), true);
    assert.equal(report.blockers.includes("index_sessions_limited_files_not_public_evidence"), true);
    assert.equal(JSON.stringify(report).includes("session.jsonl"), false);
    assert.equal(JSON.stringify(report).includes("./repos/private"), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects camelCase forbidden index mutation classes", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-index-mutation-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_index_sessions"], "flat", {
    unsafeIndexMutationClass: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_index_sessions"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_index_sessions")?.ok, false);
    assert.equal(report.blockers.includes("index_sessions_forbidden_mutation_class"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects index sessions without a public-safe marker", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-index-public-safe-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_index_sessions"], "flat", {
    unsafeIndexPublicSafe: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_index_sessions"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_index_sessions")?.ok, false);
    assert.equal(report.blockers.includes("index_sessions_public_safe_marker_missing"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects index sessions with restricted action markers", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-index-restricted-action-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_index_sessions"], "flat", {
    unsafeIndexRestrictedAction: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_index_sessions"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_index_sessions")?.ok, false);
    assert.equal(report.blockers.includes("index_sessions_restricted_action_performed"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects unredacted LCM peer DB paths as product evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-unsafe-lcm-peer-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_lcm_peer_dbs"], "flat", {
    unsafeLcmPeerPath: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_lcm_peer_dbs"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_lcm_peer_dbs")?.ok, false);
    assert.equal(report.blockers.includes("lcm_peer_dbs_path_not_redacted"), true);
    assert.equal(JSON.stringify(report).includes("lco-private-peer"), false);
    assert.equal(JSON.stringify(report).includes("/Users/lume"), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects lcm_peer_db refs with embedded local paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-unsafe-lcm-ref-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_lcm_peer_dbs"], "flat", {
    unsafeLcmPeerRef: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_lcm_peer_dbs"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_lcm_peer_dbs")?.ok, false);
    assert.equal(report.blockers.includes("lcm_peer_dbs_path_not_redacted"), true);
    assert.equal(JSON.stringify(report).includes("lco-private-peer"), false);
    assert.equal(JSON.stringify(report).includes("/Users/lume"), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects relative LCM peer paths as product evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-relative-lcm-peer-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_lcm_peer_dbs"], "flat", {
    unsafeLcmPeerRelativePath: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_lcm_peer_dbs"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_lcm_peer_dbs")?.ok, false);
    assert.equal(report.blockers.includes("lcm_peer_dbs_path_not_redacted"), true);
    assert.equal(JSON.stringify(report).includes("../"), false);
    assert.equal(JSON.stringify(report).includes("secret"), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects arbitrary blocker strings as fail-closed proof", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-arbitrary-blocker-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_desktop_proof_report"], "flat", {
    arbitraryProofReportBlocker: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_desktop_proof_report"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.ok(report.blockers.includes("expected_fail_closed_not_proven:loo_desktop_proof_report"), JSON.stringify(report, null, 2));
    assert.equal(report.invocations.find((call) => call.toolName === "loo_desktop_proof_report")?.summary.toolBlockers, undefined);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke fails closed on over-deep desktop action output instead of recursing forever", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-deep-desktop-act-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_desktop_act"], "flat", {
    deepDesktopActProof: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_desktop_act"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.ok(report.blockers.includes("expected_fail_closed_not_proven:loo_desktop_act"), JSON.stringify(report, null, 2));
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke fails closed on over-wide desktop action output instead of unbounded scanning", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-wide-desktop-act-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_desktop_act"], "flat", {
    wideDesktopActProof: true
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_desktop_act"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.ok(report.blockers.includes("expected_fail_closed_not_proven:loo_desktop_act"), JSON.stringify(report, null, 2));
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw facade tool smoke supplies safe args for describe-ref and resume dry-run", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-facade-tool-smoke-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_describe_ref", "loo_codex_resume_thread"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-facade",
      sessionKey: "agent:main:lco-facade",
      requiredTools: ["loo_describe_ref", "loo_codex_resume_thread"],
      threadId: "thread-1",
      query: "Proposed plan"
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.toolSmokeReady, true, JSON.stringify(report, null, 2));

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    const describe = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_describe_ref");
    const resume = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_resume_thread");
    const resumeInvocation = report.invocations.find((call) => call.toolName === "loo_codex_resume_thread");

    assert.deepEqual(describe?.params.args, { source_ref: "codex_thread:thread-1" });
    assert.deepEqual(resume?.params.args, { thread_id: "thread-1", dry_run: true });
    assert.equal(resumeInvocation?.summary.live, false);
    assert.equal(resumeInvocation?.summary.approvalAuditId, "loo_audit_resume_test");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw facade tool smoke blocks describe-ref and resume when target thread is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-facade-tool-smoke-missing-thread-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_describe_ref", "loo_codex_resume_thread"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-facade",
      sessionKey: "agent:main:lco-facade",
      requiredTools: ["loo_describe_ref", "loo_codex_resume_thread"],
      query: "Proposed plan"
    });

    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(report.toolSmokeReady, false, JSON.stringify(report, null, 2));
    assert.equal(report.blockers.includes("openclaw_tool_smoke_missing_thread_ref"), true, JSON.stringify(report, null, 2));
    assert.equal(report.invocations.length, 0, JSON.stringify(report, null, 2));

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string } });
    assert.equal(calls.some((call) => call.method === "tools.invoke"), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke blocks targeted prepared-state status without target coverage", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-missing-target-coverage-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, DEFAULT_REQUIRED_TOOL_CALLS, "flat", {
    omitPreparedTargetCoverage: true
  });

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-451",
      sessionKey: "agent:main:lco-issue-451",
      query: "Proposed plan"
    });

    assert.equal(report.ok, false);
    assert.equal(report.blockers.includes("prepared_state_status_target_coverage_missing"), true);
    const statusCall = report.invocations.find((call) => call.toolName === "loo_prepared_state_status");
    assert.equal(statusCall?.blockers.includes("prepared_state_status_target_coverage_missing"), true);
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { params: { name?: string; args?: Record<string, unknown> } });
    assert.equal(calls.find((call) => call.params.name === "loo_prepared_state_status")?.params.args?.thread_id, "thread-1");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke blocks target coverage for the wrong requested thread", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-mismatched-target-coverage-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, DEFAULT_REQUIRED_TOOL_CALLS, "flat", {
    mismatchedPreparedTargetCoverage: true
  });

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-451",
      sessionKey: "agent:main:lco-issue-451",
      query: "Proposed plan"
    });

    assert.equal(report.ok, false);
    assert.equal(report.blockers.includes("prepared_state_status_target_coverage_mismatch"), true);
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { params: { name?: string; args?: Record<string, unknown> } });
    assert.equal(calls.find((call) => call.params.name === "loo_prepared_state_status")?.params.args?.thread_id, "thread-1");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke blocks incomplete targeted prepared-state details", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-incomplete-target-coverage-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, DEFAULT_REQUIRED_TOOL_CALLS, "flat", {
    incompletePreparedTargetCoverage: true
  });

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-451",
      sessionKey: "agent:main:lco-issue-451",
      query: "Proposed plan"
    });

    assert.equal(report.ok, false);
    assert.equal(report.blockers.includes("prepared_state_status_target_coverage_details_missing"), true);
    const statusCall = report.invocations.find((call) => call.toolName === "loo_prepared_state_status");
    assert.equal(statusCall?.blockers.includes("prepared_state_status_target_coverage_details_missing"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke anchors agent reasoning to prepared-state evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-prepared-priority-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, DEFAULT_REQUIRED_TOOL_CALLS, "flat", {
    searchThreadId: "search-thread",
    preparedThreadId: "prepared-thread",
    queryExpansionTokenBudget: 4000,
    summaryExpansionTokenBudget: 1000
  });

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-413",
      sessionKey: "agent:main:lco-issue-413",
      evidencePath,
      query: "Proposed plan",
      tokenBudget: 4000
    });

    assert.equal(report.ok, true);
    assert.equal(report.agentReasoning?.selectedThreadId, "prepared-thread");
    assert.equal(report.agentReasoning?.expansionTokenBudget, 1000);
    assert.equal(report.agentReasoning?.expansionProfile, undefined);
    assert.equal(report.agentReasoning?.sourceRefs[0], "prepared_inbox:50000000000000000000000000000005");
    assert.equal(report.agentReasoning?.sourceRefs.includes("codex_thread:prepared-thread"), true);
    assert.equal(report.agentReasoning?.sourceRefs.includes("prepared_card:50000000000000000000000000000005"), true);
    assert.equal(report.agentReasoning?.sourceRefs.includes("summary_leaf:50000000000000000000000000000005"), true);
    assert.equal(report.agentReasoning?.sourceRefs.includes("codex_thread:search-thread"), false);
    assert.equal(report.agentReasoning?.workflowEvidence.includes("prepared_inbox"), true);
    assert.equal(report.agentReasoning?.workflowEvidence.includes("summary_expand"), true);
    assert.equal(report.agentReasoning?.rawTranscriptRead, false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke avoids OpenClaw dev/profile flag conflict", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-dev-profile-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_doctor"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      dev: true,
      profile: "lco-dogfood",
      evidencePath,
      requiredTools: ["loo_doctor"]
    });

    assert.equal(report.ok, true);
    assert.doesNotMatch(report.command, /--dev/);
    assert.match(report.command, /--profile lco-dogfood/);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[] });
    assert.equal(calls.length > 0, true);
    assert.equal(calls.every((call) => !call.args.includes("--dev")), true);
    assert.equal(calls.every((call) => call.args.includes("--profile")), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke passes discovered thread id to loo_expand_session", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-expand-session-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, [
    "loo_search_sessions",
    "loo_expand_session"
  ]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-192",
      sessionKey: "agent:main:lco-issue-192",
      evidencePath,
      requiredTools: ["loo_search_sessions", "loo_expand_session"],
      query: "Proposed plan"
    });

    assert.equal(report.ok, true);
    assert.equal(report.toolSmokeReady, true);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.invocations.find((call) => call.toolName === "loo_expand_session")?.summary.threadId, "thread-1");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_expand_session")?.summary.profile, "brief");
    assert.equal(report.invocations.find((call) => call.toolName === "loo_expand_session")?.summary.tokenBudget, 1000);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span|thread_id is required/);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    assert.equal(calls.find((call) => call.params.name === "loo_expand_session")?.params.args?.thread_id, "thread-1");
    assert.equal(calls.find((call) => call.params.name === "loo_expand_session")?.params.args?.profile, "brief");
    assert.equal(calls.find((call) => call.params.name === "loo_expand_session")?.params.args?.token_budget, 1000);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke requires target before desktop coherence smoke", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-desktop-coherence-target-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_desktop_coherence"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-307",
      sessionKey: "agent:main:lco-issue-307",
      evidencePath,
      requiredTools: ["loo_codex_desktop_coherence"]
    });

    assert.equal(report.ok, false);
    assert.deepEqual(report.blockers, ["openclaw_tool_smoke_missing_thread_ref"]);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string } });
    assert.equal(calls.some((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_desktop_coherence"), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke passes target and coherence fixture to desktop fallback status", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-desktop-fallback-status-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_desktop_fallback_status"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-308",
      sessionKey: "agent:main:lco-issue-308",
      evidencePath,
      requiredTools: ["loo_codex_desktop_fallback_status"],
      threadId: "thread-1"
    });

    assert.equal(report.ok, true);
    assert.deepEqual(report.blockers, []);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    const invoke = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_desktop_fallback_status");
    assert.equal(invoke?.params.args?.thread_id, "thread-1");
    assert.equal(invoke?.params.args?.source_ref, "codex_thread:thread-1");
    assert.deepEqual(invoke?.params.args?.coherence, {
      state: "cli_visible",
      visibility: {
        cli: "proven",
        desktop: "not_seen"
      },
      confidence: 0.72
    });
    assert.equal(invoke?.params.args?.include_visible_snapshot, false);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke invokes collaboration cockpit through the gateway surface", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-collaboration-cockpit-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_collaboration_cockpit"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-313",
      sessionKey: "agent:main:lco-issue-313",
      evidencePath,
      requiredTools: ["loo_codex_collaboration_cockpit"],
      threadId: "thread-1"
    });

    assert.equal(report.ok, true);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.invocations[0]?.toolName, "loo_codex_collaboration_cockpit");
    assert.equal(report.invocations[0]?.summary.count, 1);
    assert.equal(report.invocations[0]?.summary.threadId, "codex_thread:thread-1");
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    const invoke = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_collaboration_cockpit");
    assert.ok(invoke);
    assert.equal(Array.isArray(invoke.params.args?.watcher_specs), true);
    assert.equal(Array.isArray(invoke.params.args?.desktop_coherence_reports), true);
    assert.equal(Array.isArray(invoke.params.args?.desktop_fallback_reports), true);
    assert.equal((invoke.params.args?.desktop_coherence_reports as Array<{ target?: { threadId?: string } }>)[0]?.target?.threadId, "thread-1");
    assert.equal((invoke.params.args?.desktop_fallback_reports as Array<{ target?: { threadId?: string } }>)[0]?.target?.threadId, "thread-1");
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke fails closed for unsafe collaboration next-step output", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-collaboration-next-steps-unsafe-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_collaboration_next_steps"], "flat", { unsafeCollaborationNextSteps: true });

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-326",
      sessionKey: "agent:main:lco-issue-326",
      evidencePath,
      requiredTools: ["loo_codex_collaboration_next_steps"],
      threadId: "thread-1",
      strict: true
    });

    assert.equal(report.ok, false);
    assert.ok(report.blockers.includes("collaboration_next_step_ready_missing_tool_call"));
    assert.ok(report.blockers.includes("collaboration_next_steps_restricted_action"));
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke invokes runtime Desktop visibility status through the gateway surface", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-runtime-visibility-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_runtime_desktop_visibility_status"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-342",
      sessionKey: "agent:main:lco-issue-342",
      evidencePath,
      requiredTools: ["loo_codex_runtime_desktop_visibility_status"],
      threadId: "thread-1",
      strict: true
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(report.blockers, []);
    assert.equal(report.invocations[0]?.toolName, "loo_codex_runtime_desktop_visibility_status");
    assert.equal(report.invocations[0]?.summary.runtimeVisibilityStatus, "covered");
    assert.equal(report.invocations[0]?.summary.nextToolCall?.tool, "lco_desktop_proof");
    assert.equal(report.invocations[0]?.summary.nextToolCall?.execute, false);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, any> } });
    const invoke = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_runtime_desktop_visibility_status");
    assert.equal(invoke?.params.args?.desktop_collaboration_proof_reports?.[0]?.schema, "lco.codexDesktopCollaborationProof.v1");
    assert.equal(invoke?.params.args?.desktop_collaboration_proof_reports?.[0]?.requiredNextToolCall?.execute, false);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke invokes active-thread state through the gateway surface", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-active-state-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_active_thread_state"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-351",
      sessionKey: "agent:main:lco-issue-351",
      evidencePath,
      requiredTools: ["loo_codex_active_thread_state"],
      threadId: "thread-1",
      strict: true
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(report.blockers, []);
    assert.equal(report.invocations[0]?.toolName, "loo_codex_active_thread_state");
    assert.equal((report.invocations[0]?.summary.activeThreadState as Record<string, number> | undefined)?.needsNudge, 1);
    assert.equal((report.invocations[0]?.summary.activeThreadAttentionCoverage as Record<string, number> | undefined)?.partial, 1);
    assert.equal(report.invocations[0]?.summary.activeThreadNextReadOnlyActions, 1);
    assert.equal(report.invocations[0]?.summary.activeThreadControlDryRunRecommendations, 1);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, any> } });
    const invoke = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_active_thread_state");
    assert.equal(invoke?.params.args?.app_server_threads?.sourceCoverage?.codexAppServer, "ok");
    assert.equal(invoke?.params.args?.watcher_specs?.[0]?.mutates, false);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke invokes autonomy tick through the gateway surface", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-autonomy-tick-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_autonomy_tick"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-371",
      sessionKey: "agent:main:lco-issue-371",
      evidencePath,
      requiredTools: ["loo_codex_autonomy_tick"],
      threadId: "thread-1",
      strict: true
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(report.blockers, []);
    assert.equal(report.invocations[0]?.toolName, "loo_codex_autonomy_tick");
    assert.equal((report.invocations[0]?.summary.autonomyTick as Record<string, number> | undefined)?.returnedSteps, 2);
    assert.equal((report.invocations[0]?.summary.autonomyTick as Record<string, number> | undefined)?.readOnlyProbes, 1);
    assert.equal((report.invocations[0]?.summary.autonomyTick as Record<string, number> | undefined)?.controlDryRunRecommendations, 1);
    assert.equal(report.invocations[0]?.summary.nextToolCall?.tool, "lco_codex_app_server_threads");
    assert.equal(report.invocations[0]?.summary.nextToolCall?.execute, false);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, any> } });
    const invoke = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_autonomy_tick");
    assert.equal(invoke?.params.args?.app_server_threads?.sourceCoverage?.codexAppServer, "ok");
    assert.equal(invoke?.params.args?.watcher_specs?.[0]?.mutates, false);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects malformed raw autonomy tick steps", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-autonomy-tick-bad-steps-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_autonomy_tick"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-371-bad-steps",
      sessionKey: "agent:main:lco-issue-371-bad-steps",
      evidencePath,
      requiredTools: ["loo_codex_autonomy_tick"],
      threadId: "malformed-autonomy-tick-steps",
      strict: true
    });

    assert.equal(report.ok, false);
    assert.match(report.blockers.join("\n"), /autonomy_tick_step_count_mismatch/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke validates autonomy tick total lane coverage", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-autonomy-tick-total-lanes-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_autonomy_tick"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-371-total-lanes",
      sessionKey: "agent:main:lco-issue-371-total-lanes",
      evidencePath,
      requiredTools: ["loo_codex_autonomy_tick"],
      threadId: "mismatched-autonomy-tick-total-lanes",
      strict: true
    });

    assert.equal(report.ok, false);
    assert.match(report.blockers.join("\n"), /autonomy_tick_total_lanes_mismatch/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke reports missing autonomy tick summary precisely", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-autonomy-tick-missing-summary-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_autonomy_tick"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-371-missing-summary",
      sessionKey: "agent:main:lco-issue-371-missing-summary",
      evidencePath,
      requiredTools: ["loo_codex_autonomy_tick"],
      threadId: "missing-autonomy-tick-summary",
      strict: true
    });

    assert.equal(report.ok, false);
    assert.match(report.blockers.join("\n"), /autonomy_tick_summary_missing/);
    assert.doesNotMatch(report.blockers.join("\n"), /autonomy_tick_step_count_mismatch/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke does not expose autonomy next tool calls from invalid reports", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-autonomy-tick-invalid-schema-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_autonomy_tick"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-371-invalid-schema",
      sessionKey: "agent:main:lco-issue-371-invalid-schema",
      evidencePath,
      requiredTools: ["loo_codex_autonomy_tick"],
      threadId: "unsafe-autonomy-tick-schema",
      strict: true
    });

    assert.equal(report.ok, false);
    assert.match(report.blockers.join("\n"), /autonomy_tick_public_safe_read_only_missing/);
    assert.equal(report.invocations[0]?.summary.nextToolCall, undefined);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke does not promote blocked autonomy dry-runs as next tool calls", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-autonomy-tick-blocked-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_autonomy_tick"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-371-blocked",
      sessionKey: "agent:main:lco-issue-371-blocked",
      evidencePath,
      requiredTools: ["loo_codex_autonomy_tick"],
      threadId: "blocked-autonomy-dry-run",
      strict: true
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal((report.invocations[0]?.summary.autonomyTick as Record<string, number> | undefined)?.blockedControlDryRuns, 1);
    assert.equal(report.invocations[0]?.summary.nextToolCall, undefined);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke accepts empty active-thread state reports", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-active-state-empty-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_active_thread_state"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-351-empty",
      sessionKey: "agent:main:lco-issue-351-empty",
      evidencePath,
      requiredTools: ["loo_codex_active_thread_state"],
      threadId: "empty-active-state",
      strict: true
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(report.blockers, []);
    assert.equal(report.invocations[0]?.toolName, "loo_codex_active_thread_state");
    assert.equal((report.invocations[0]?.summary.activeThreadState as Record<string, number> | undefined)?.running, 0);
    assert.equal((report.invocations[0]?.summary.activeThreadState as Record<string, number> | undefined)?.unknown, 0);
    assert.equal((report.invocations[0]?.summary.activeThreadAttentionCoverage as Record<string, number> | undefined)?.covered, 0);
    assert.equal(report.invocations[0]?.summary.activeThreadNextReadOnlyActions, 0);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke accepts active-thread core recovery read-only actions", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-active-state-core-action-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_active_thread_state"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-367-core-action",
      sessionKey: "agent:main:lco-issue-367-core-action",
      evidencePath,
      requiredTools: ["loo_codex_active_thread_state"],
      threadId: "core-missing-action",
      strict: true
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(report.blockers, []);
    assert.equal(report.invocations[0]?.summary.activeThreadNextReadOnlyActions, 1);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects malformed active-thread read-only action args", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-active-state-bad-action-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_active_thread_state"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-367-bad-action",
      sessionKey: "agent:main:lco-issue-367-bad-action",
      evidencePath,
      requiredTools: ["loo_codex_active_thread_state"],
      threadId: "bad-attention-action-args",
      strict: true
    });

    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(report.toolSmokeReady, false, JSON.stringify(report, null, 2));
    assert.equal(report.blockers.includes("active_thread_state_invalid_attention_coverage"), true, JSON.stringify(report.blockers));
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects malformed active-thread read-only actions", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-active-state-malformed-action-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_active_thread_state"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-367-malformed-action",
      sessionKey: "agent:main:lco-issue-367-malformed-action",
      evidencePath,
      requiredTools: ["loo_codex_active_thread_state"],
      threadId: "malformed-attention-action",
      strict: true
    });

    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(report.toolSmokeReady, false, JSON.stringify(report, null, 2));
    assert.equal(report.blockers.includes("active_thread_state_invalid_attention_coverage"), true, JSON.stringify(report.blockers));
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke invokes action-bound Codex Desktop collaboration proof through the gateway surface", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-codex-desktop-proof-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_desktop_collaboration_proof"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-333",
      sessionKey: "agent:main:lco-issue-333",
      evidencePath,
      requiredTools: ["loo_codex_desktop_collaboration_proof"],
      threadId: "thread-1",
      strict: true
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(report.blockers, []);
    assert.equal(report.invocations[0]?.toolName, "loo_codex_desktop_collaboration_proof");
    assert.equal(report.invocations[0]?.summary.proofStatus, "ready");
    assert.equal(report.invocations[0]?.summary.approvalVerified, true);
    assert.match(report.invocations[0]?.summary.actionHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(report.invocations[0]?.summary.nextToolCall?.tool, "lco_desktop_proof");
    assert.equal(report.invocations[0]?.summary.nextToolCall?.execute, false);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, any> } });
    const invoke = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_desktop_collaboration_proof");
    assert.equal(invoke?.params.args?.target_ref, "codex_thread:thread-1");
    assert.equal(invoke?.params.args?.target_thread_id, "thread-1");
    assert.equal(invoke?.params.args?.backend, "cua-driver");
    assert.equal(invoke?.params.args?.target_app, "Codex");
    assert.equal(invoke?.params.args?.action, "verify_visible_thread_alignment");
    assert.equal(invoke?.params.args?.approval_packet?.focusPolicy?.screenshotAllowed, false);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke can exercise desktop fallback status without a supplied coherence fixture", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-desktop-fallback-no-coherence-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_desktop_fallback_status"]);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-315",
      sessionKey: "agent:main:lco-issue-315",
      evidencePath,
      requiredTools: ["loo_codex_desktop_fallback_status"],
      threadId: "thread-1",
      desktopFallbackCoherence: "omit"
    });

    assert.equal(report.ok, true);
    assert.deepEqual(report.blockers, []);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
    const invoke = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_desktop_fallback_status");
    assert.equal(invoke?.params.args?.thread_id, "thread-1");
    assert.equal(invoke?.params.args?.source_ref, "codex_thread:thread-1");
    assert.equal("coherence" in (invoke?.params.args ?? {}), false);
    const fallbackInvocation = report.invocations.find((invocation) => invocation.toolName === "loo_codex_desktop_fallback_status");
    assert.deepEqual(fallbackInvocation?.summary.nextToolCall, {
      tool: "loo_codex_desktop_coherence",
      args: {
        thread_id: "thread-1",
        source_ref: "codex_thread:thread-1"
      }
    });
    const evidence = readFileSync(evidencePath, "utf8");
    assert.match(evidence, /coherence_input_missing/);
    assert.match(evidence, /loo_codex_desktop_coherence/);
    assert.match(evidence, /codex_thread:thread-1/);
    assert.doesNotMatch(evidence, /super-secret-transcript-span/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke blocks strict fallback status when missing-coherence handoff is absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-desktop-fallback-missing-handoff-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_desktop_fallback_status"], "flat", { omitFallbackNextToolCall: true });

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-315",
      sessionKey: "agent:main:lco-issue-315",
      evidencePath,
      requiredTools: ["loo_codex_desktop_fallback_status"],
      threadId: "thread-1",
      desktopFallbackCoherence: "omit",
      strict: true
    });

    assert.equal(report.ok, false);
    assert.ok(report.blockers.includes("desktop_fallback_next_tool_call_missing"));
    assert.equal(report.invocations.find((invocation) => invocation.toolName === "loo_codex_desktop_fallback_status")?.summary.fallbackReason, "coherence_input_missing");
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke exposes omitted desktop fallback coherence through the CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-cli-desktop-fallback-no-coherence-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_desktop_fallback_status"]);
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "openclaw",
    "tool-smoke",
    "--openclaw-bin",
    bin,
    "--profile",
    "lco-issue-315-cli",
    "--session-key",
    "agent:main:lco-issue-315-cli",
    "--evidence-path",
    evidencePath,
    "--required-tool",
    "loo_codex_desktop_fallback_status",
    "--thread-id",
    "thread-1",
    "--desktop-fallback-coherence",
    "omit",
    "--strict"
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCLAW_FAKE_CALLS: callsPath
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { name?: string; args?: Record<string, unknown> } });
  const invoke = calls.find((call) => call.method === "tools.invoke" && call.params.name === "loo_codex_desktop_fallback_status");
  assert.equal(invoke?.params.args?.thread_id, "thread-1");
  assert.equal("coherence" in (invoke?.params.args ?? {}), false);
  assert.match(readFileSync(evidencePath, "utf8"), /coherence_input_missing/);
});

test("OpenClaw tool smoke rejects omitted desktop fallback coherence when fallback status is not invoked", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "openclaw",
    "tool-smoke",
    "--desktop-fallback-coherence",
    "omit",
    "--strict"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires --required-tool loo_codex_desktop_fallback_status/);
});

test("OpenClaw tool smoke accepts gateway content/details wrapped dry-run proof", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-wrapped-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, DEFAULT_REQUIRED_TOOL_CALLS, "flat", { dryRunOutputShape: "both" });

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
  const { bin, callsPath } = createFakeOpenClaw(dir, DEFAULT_REQUIRED_TOOL_CALLS, "flat", { dryRunOutputShape: "content" });

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

test("OpenClaw tool smoke still requires message hash for send-message dry-runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-dryrun-message-hash-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_codex_control_dry_run"], "flat", {
    omitDryRunMessageHash: true
  });

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      requiredTools: ["loo_codex_control_dry_run"],
      threadId: "thread-1",
      query: "Proposed plan"
    });

    const dryRun = report.invocations.find((call) => call.toolName === "loo_codex_control_dry_run");
    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(dryRun?.summary.live, false);
    assert.equal(dryRun?.summary.approvalAuditId, "loo_audit_test");
    assert.equal(dryRun?.summary.paramsHash, "params-hash");
    assert.equal(dryRun?.summary.messageHash, undefined);
    assert.equal(dryRun?.blockers.includes("openclaw_control_dry_run_not_proven"), true, JSON.stringify(report, null, 2));
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke rejects explicit token-only auth before spawning OpenClaw", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-token-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_doctor"]);
  const previousCalls = process.env.OPENCLAW_FAKE_CALLS;
  const previousToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  delete process.env.OPENCLAW_GATEWAY_TOKEN;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-80",
      requiredTools: ["loo_doctor"],
      token: "test-gateway-token",
      gatewayTimeoutMs: 12345,
      evidencePath
    });

    assert.equal(report.ok, false);
    assert.ok(report.blockers.includes("openclaw_gateway_token_requires_url"));
    assert.ok(report.setupBlockers.includes("openclaw_gateway_route_configuration_required"));
    assert.deepEqual(report.setupStatus, {
      classification: "gateway_setup_required",
      packageInstallLikelyOk: true,
      recoverable: true,
      retryAfterSetup: true,
      doesNotIndicatePackageFailure: true
    });
    assert.equal(existsSync(callsPath), false);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /test-gateway-token/);
  } finally {
    if (previousCalls === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previousCalls;
    if (previousToken === undefined) delete process.env.OPENCLAW_GATEWAY_TOKEN;
    else process.env.OPENCLAW_GATEWAY_TOKEN = previousToken;
  }
});

test("OpenClaw tool smoke preserves ambient configured-profile token auth without argv exposure", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-env-token-"));
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_doctor"]);
  const previousCalls = process.env.OPENCLAW_FAKE_CALLS;
  const previousToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  process.env.OPENCLAW_GATEWAY_TOKEN = "ambient-gateway-token";
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-106",
      requiredTools: ["loo_doctor"]
    });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; envTokenPresent?: boolean });
    assert.equal(calls.every((call) => call.envTokenPresent === true), true);
    assert.equal(calls.some((call) => call.args.includes("--token")), false);
    assert.equal(calls.some((call) => call.args.includes("ambient-gateway-token")), false);
  } finally {
    if (previousCalls === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previousCalls;
    if (previousToken === undefined) delete process.env.OPENCLAW_GATEWAY_TOKEN;
    else process.env.OPENCLAW_GATEWAY_TOKEN = previousToken;
  }
});

test("OpenClaw tool smoke rejects plaintext remote gateway URLs before sending a token", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-remote-ws-"));
  const report = runOpenClawToolSmoke({
    gatewayUrl: "ws://gateway.example.test:18789",
    token: "must-not-leave-process",
    requiredTools: ["loo_doctor"]
  });
  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("openclaw_gateway_url_insecure"));
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
    assert.deepEqual(report.setupStatus, {
      classification: "gateway_blocked",
      packageInstallLikelyOk: false,
      recoverable: false,
      retryAfterSetup: false,
      doesNotIndicatePackageFailure: false
    });
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
  const { bin, callsPath } = createFakeOpenClaw(dir, DEFAULT_REQUIRED_TOOL_CALLS, "groups");

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
    assert.equal(report.catalog.toolCount, DEFAULT_REQUIRED_TOOL_CALLS.length);
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

test("OpenClaw tool smoke does not mask mixed setup and tool-defect blockers as setup-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-mixed-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createMixedSetupAndToolFailureFakeOpenClaw(dir);
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-216",
      sessionKey: "agent:main:lco-issue-216",
      evidencePath,
      requiredTools: ["loo_doctor", "loo_search_sessions"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.match(report.blockers.join("\n"), /openclaw_tool_result_not_ok:loo_doctor:forbidden/);
    assert.match(report.blockers.join("\n"), /openclaw_gateway_credentials_required:loo_search_sessions/);
    assert.deepEqual(report.setupBlockers, ["fresh_profile_gateway_credentials_required"]);
    assert.deepEqual(report.setupStatus, {
      classification: "gateway_blocked",
      packageInstallLikelyOk: false,
      recoverable: false,
      retryAfterSetup: false,
      doesNotIndicatePackageFailure: false
    });
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span|requires credentials before opening a websocket/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke preserves public-safe validation reasons from tools.invoke failures", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-validation-failure-"));
  const { bin, callsPath } = createValidationFailureFakeOpenClaw(dir);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      threadId: "thread-1",
      requiredTools: ["loo_codex_steer_thread"]
    });

    assert.equal(report.ok, false);
    assert.ok(
      report.blockers.includes("openclaw_tool_validation_failed:loo_codex_steer_thread:expected_turn_id_required"),
      JSON.stringify(report.blockers)
    );
    assert.ok(
      report.blockers.includes("openclaw_tool_result_not_ok:loo_codex_steer_thread:internal_error"),
      JSON.stringify(report.blockers)
    );
    assert.doesNotMatch(JSON.stringify(report), /super-secret-transcript-span|\/Users\/example|private\.jsonl/);
    assert.equal(report.invocations[0]?.toolName, "loo_codex_steer_thread");
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke fails closed when tools.invoke returns ok false in a successful envelope", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-ok-false-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_permissions"], "flat", {
    gatewayRefusedToolName: "loo_permissions"
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-80",
      sessionKey: "agent:main:lco-issue-80",
      evidencePath,
      requiredTools: ["loo_permissions"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.deepEqual(report.blockers, ["openclaw_tool_result_not_ok:loo_permissions:forbidden"]);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span|forbidden message|Harmless beta smoke/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});

test("OpenClaw tool smoke fails closed when plugin output details return ok false", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-details-ok-false-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createFakeOpenClaw(dir, ["loo_audit_tail"], "flat", {
    pluginDetailsRefusedToolName: "loo_audit_tail"
  });
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-issue-160",
      sessionKey: "agent:main:lco-issue-160",
      evidencePath,
      requiredTools: ["loo_audit_tail"]
    });

    assert.equal(report.toolSmokeReady, false);
    assert.deepEqual(report.blockers, ["openclaw_tool_result_not_ok:loo_audit_tail"]);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /super-secret-transcript-span|Harmless beta smoke/);
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
    assert.match(report.nextAction, /scope approval/i);
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
      rawLeak: /device identity required/,
      expectedNextAction: /pair or approve/i
    },
    {
      failureText: "unauthorized: device token mismatch (rotate/reissue device token)",
      expectedBlocker: "openclaw_gateway_device_token_mismatch:loo_doctor",
      rawLeak: /device token mismatch/,
      expectedNextAction: /(rotate|reissue).*(current token)/i
    },
    {
      failureText: "gateway tools.invoke requires credentials before opening a websocket",
      expectedBlocker: "openclaw_gateway_credentials_required:loo_doctor",
      rawLeak: /requires credentials before opening a websocket/,
      expectedNextAction: /(?=.*credentials)(?=.*loopback token-auth gateway)/i
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
      assert.match(report.nextAction, testCase.expectedNextAction);
      assert.doesNotMatch(readFileSync(evidencePath, "utf8"), testCase.rawLeak);
    } finally {
      if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
      else process.env.OPENCLAW_FAKE_CALLS = previous;
    }
  }
});

test("OpenClaw tool smoke marks missing gateway credentials as first-run setup blockers", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-tool-smoke-fresh-profile-"));
  const evidencePath = join(dir, "tool-smoke.json");
  const { bin, callsPath } = createGatewayAuthFailureFakeOpenClaw(
    dir,
    "gateway tools.catalog requires credentials before opening a websocket"
  );
  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawToolSmoke({
      openclawBin: bin,
      profile: "lco-fresh-profile",
      sessionKey: "agent:main:lco-fresh-profile",
      evidencePath,
      requiredTools: ["loo_doctor"]
    }) as ReturnType<typeof runOpenClawToolSmoke> & {
      setupBlockers?: string[];
      setupGuidance?: string[];
    };

    assert.equal(report.toolSmokeReady, false);
    assert.deepEqual(report.blockers, ["openclaw_gateway_credentials_required:loo_doctor"]);
    assert.deepEqual(report.setupBlockers, ["fresh_profile_gateway_credentials_required"]);
    assert.deepEqual(report.setupStatus, {
      classification: "gateway_setup_required",
      packageInstallLikelyOk: true,
      recoverable: true,
      retryAfterSetup: true,
      doesNotIndicatePackageFailure: true
    });
    assert.match(report.nextAction, /profile/i);
    assert.match(report.nextAction, /token/i);
    assert.match(report.setupGuidance?.join("\n") || "", /profile/i);
    assert.equal(report.actionsPerformed.broadGatewayScopeApproval, false);
    const saved = readFileSync(evidencePath, "utf8");
    assert.match(saved, /fresh_profile_gateway_credentials_required/);
    assert.doesNotMatch(saved, /requires credentials before opening a websocket/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});
