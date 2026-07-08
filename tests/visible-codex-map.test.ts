import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CODEX_CONTROL_METHODS,
  CODEX_FORBIDDEN_METHODS,
  assertCodexMethodAllowed,
  createCodexAppServerStatusReport,
  createCodexAppServerThreadsReport,
  type CodexClient
} from "../packages/adapters/src/index.js";
import {
  createDatabase,
  createVisibleCodexSessionMap,
  indexCodexSessions
} from "../packages/core/src/index.js";
import { createAuditStore } from "../packages/adapters/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";

class FakeCodexReadClient implements CodexClient {
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];

  constructor(private readonly responses: Record<string, unknown | Error>) {}

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.requests.push({ method, params });
    const response = this.responses[method];
    if (response instanceof Error) throw response;
    if (response !== undefined) return response;
    throw new Error(`unexpected method ${method}`);
  }
}

test("Codex read surface blocks current app-server mutation families", () => {
  for (const method of [
    "turn/start",
    "thread/resume",
    "thread/fork",
    "thread/archive",
    "thread/delete",
    "thread/name/set",
    "thread/metadata/update",
    "fs/writeFile",
    "fs/remove",
    "plugin/install",
    "plugin/uninstall",
    "account/login/start",
    "account/logout",
    "remoteControl/enable",
    "remoteControl/pairing/start",
    "remoteControl/approve",
    "remoteControl/deny",
    "remoteControl/client/revoke",
    "config/value/write",
    "command/exec"
  ]) {
    if (!CODEX_CONTROL_METHODS.has(method)) {
      assert.equal(CODEX_FORBIDDEN_METHODS.has(method), true, `${method} must be explicitly forbidden`);
    }
    assert.throws(() => assertCodexMethodAllowed(method, "read"), /forbidden|not allowed|not allowlisted/, method);
  }

  assert.doesNotThrow(() => assertCodexMethodAllowed("thread/list", "read"));
  assert.doesNotThrow(() => assertCodexMethodAllowed("thread/loaded/list", "read"));
  assert.doesNotThrow(() => assertCodexMethodAllowed("remoteControl/status/read", "read"));
});

test("app-server status report is read-only and sanitizes unavailable probes", async () => {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/home/lco-test";
  const client = new FakeCodexReadClient({
    "remoteControl/status/read": new Error(`Cannot connect to ${home}/.codex/socket with Bearer abcdefghijklmnop`)
  });

  const report = await createCodexAppServerStatusReport({
    client,
    transport: {
      mode: "stdio",
      command: `${home}/bin/codex`,
      available: true,
      version: "codex 0.0.0-test",
      error: null
    }
  });

  assert.equal(report.schema, "lco.codex.appServerStatus.v1");
  assert.equal(report.publicSafe, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.sourceCoverage.codexAppServer, "partial");
  assert.equal(report.remoteControl.status, "unavailable");
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
  assert.equal(report.actionsPerformed.rawTranscriptRead, false);
  assert.equal(client.requests.length, 1);
  assert.equal(client.requests[0]?.method, "remoteControl/status/read");
  assert.doesNotMatch(JSON.stringify(report), new RegExp(escapeRegExp(home)));
  assert.doesNotMatch(JSON.stringify(report), /Bearer abcdefghijklmnop/);
});

test("app-server status report fails fast when the Codex binary is missing", async () => {
  const client = new FakeCodexReadClient({});

  const report = await createCodexAppServerStatusReport({
    client,
    command: "definitely-missing-lco-codex-binary"
  });

  assert.equal(report.schema, "lco.codex.appServerStatus.v1");
  assert.equal(report.publicSafe, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.transport.available, false);
  assert.equal(report.remoteControl.status, "unavailable");
  assert.equal(report.remoteControl.readiness, "unknown");
  assert.equal(report.sourceCoverage.codexAppServer, "unavailable");
  assert.equal(client.requests.length, 0);
  assert.match(report.transport.error ?? "", /ENOENT|not found|no such file/i);
  assert.ok(report.errors.some((error) => /codex_binary_unavailable/i.test(error)));
  assert.match(report.remoteControl.error ?? "", /codex_binary_unavailable/i);
});

test("app-server status report distinguishes non-zero Codex transport failures from missing binaries", async () => {
  const client = new FakeCodexReadClient({});

  const report = await createCodexAppServerStatusReport({
    client,
    transport: {
      mode: "stdio",
      command: "codex",
      available: false,
      version: "codex version probe failed",
      error: "exit 2"
    }
  });

  assert.equal(report.transport.available, false);
  assert.equal(report.transport.error, "exit 2");
  assert.equal(report.remoteControl.status, "unavailable");
  assert.equal(report.remoteControl.readiness, "unknown");
  assert.equal(report.sourceCoverage.codexAppServer, "unavailable");
  assert.equal(client.requests.length, 0);
  assert.ok(report.errors.some((error) => /codex_transport_unavailable: exit 2/i.test(error)));
  assert.match(report.remoteControl.error ?? "", /codex_transport_unavailable: exit 2/i);
});

test("app-server threads report never requests turns and omits raw path cwd preview fields", async () => {
  const client = new FakeCodexReadClient({
    "thread/list": {
      ok: true,
      result: {
        data: [{
          id: "thr_visible",
          name: "Visible safe title",
          preview: "raw prompt preview must not leak",
          path: "/Users/lume/.codex/sessions/private.jsonl",
          cwd: "/Volumes/LEXAR/repos/private",
          updatedAt: Number.MAX_VALUE,
          createdAt: 1782860000,
          status: { type: "active", activeFlags: [] },
          turns: [{ items: ["raw turn"] }]
        }]
      },
      notifications: []
    },
    "thread/loaded/list": { ok: true, result: { data: ["thr_visible"] }, notifications: [] },
    "thread/read": {
      ok: true,
      result: {
        thread: {
          id: "thr_visible",
          name: "Visible safe title",
          preview: "read preview must not leak",
          path: "/Users/lume/.codex/read-private.jsonl",
          cwd: "/Volumes/LEXAR/repos/read-private",
          status: { type: "active" },
          turns: [{ items: ["raw read turn"] }]
        }
      },
      notifications: []
    }
  });

  const report = await createCodexAppServerThreadsReport({
    client,
    limit: 5,
    readThreadId: "thr_visible"
  });

  assert.equal(report.schema, "lco.codex.appServerThreads.v1");
  assert.equal(report.publicSafe, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.sourceCoverage.codexAppServer, "ok");
  assert.deepEqual(client.requests.map((request) => request.method), ["thread/list", "thread/read"]);
  assert.deepEqual(client.requests[0]?.params, {
    limit: 5,
    useStateDbOnly: true,
    sortKey: "recency_at",
    sortDirection: "desc",
    sourceKinds: ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"]
  });
  assert.deepEqual(client.requests[1]?.params, { threadId: "thr_visible", includeTurns: false });
  assert.equal(report.threads[0]?.threadId, "thr_visible");
  assert.equal(report.threads[0]?.loaded, null);
  assert.equal(report.threads[0]?.loadedState, "not_claimed");
  assert.equal(report.loadedSignalSource, "not_claimed_one_shot_client");
  assert.equal(report.loadedThreadRefs, null);
  assert.equal(report.threads[0]?.titleSanitized, "Visible safe title");
  assert.equal(report.threads[0]?.updatedAt, null);
  assert.equal(report.readProbe?.threadId, "thr_visible");
  assert.equal(report.readProbe?.turnsOmitted, true);
  assert.doesNotMatch(JSON.stringify(report), /raw prompt|raw read|private\.jsonl|read-private|\/Users\/lume|\/Volumes\/LEXAR\/repos\/private/);
});

test("app-server threads report downgrades coverage when metadata probe fails", async () => {
  const client = new FakeCodexReadClient({
    "thread/list": {
      ok: true,
      result: { data: [] },
      notifications: []
    },
    "thread/read": new Error("thread/read failed for /Users/lume/.codex/sessions/private.jsonl sk-test_1234567890")
  });

  const report = await createCodexAppServerThreadsReport({
    client,
    readThreadId: "thr_missing"
  });

  assert.equal(report.publicSafe, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.sourceCoverage.codexAppServer, "partial");
  assert.equal(report.readProbe?.threadId, "thr_missing");
  assert.equal(report.readProbe?.error !== null, true);
  assert.doesNotMatch(JSON.stringify(report), /\/Users\/lume|private\.jsonl|sk-test_1234567890/);
});

test("app-server thread titles and aliases redact token and path patterns", async () => {
  const client = new FakeCodexReadClient({
    "thread/list": {
      ok: true,
      result: {
        data: [{
          id: "thr_secret_title",
          name: "/Users/lume/private sk-test_1234567890",
          titleAliases: ["EVA-LCO", "/Volumes/LEXAR/private github_pat_1234567890abcdefghij"],
          status: { type: "active" }
        }]
      },
      notifications: []
    }
  });

  const report = await createCodexAppServerThreadsReport({ client, limit: 5 });
  const serialized = JSON.stringify(report);

  assert.equal(report.threads[0]?.titleSanitized?.includes("<redacted"), true);
  assert.ok(report.threads[0]?.titleAliases.includes("EVA-LCO"));
  assert.doesNotMatch(serialized, /\/Users\/lume|\/Volumes\/LEXAR|sk-test_1234567890|github_pat_1234567890abcdefghij/);
});

test("app-server threads report can claim loaded signals only for an explicit same-connection source", async () => {
  const client = new FakeCodexReadClient({
    "thread/list": {
      ok: true,
      result: {
        data: [{
          id: "thr_visible",
          name: "Visible safe title",
          updatedAt: 1782867600,
          status: { type: "active", activeFlags: [] }
        }]
      },
      notifications: []
    },
    "thread/loaded/list": { ok: true, result: { data: ["thr_visible"] }, notifications: [] }
  });

  const report = await createCodexAppServerThreadsReport({
    client,
    limit: 5,
    claimLoadedSignals: true
  });

  assert.deepEqual(client.requests.map((request) => request.method), ["thread/list", "thread/loaded/list"]);
  assert.equal(report.loadedSignalSource, "same_connection");
  assert.deepEqual(report.loadedThreadRefs, ["codex_app_thread:thr_visible"]);
  assert.equal(report.threads[0]?.loaded, true);
  assert.equal(report.threads[0]?.loadedState, "loaded");
});

test("visible Codex map joins public-safe visible app-server and indexed session cards", async () => {
  withIndexedSessions([
    {
      id: "thr_visible",
      title: "Visible safe title",
      status: "active",
      priority: "high",
      nextAction: "continue visible map join",
      refs: true
    },
    {
      id: "thr_duplicate_a",
      title: "Duplicate visible title",
      status: "active",
      priority: "medium",
      nextAction: "inspect duplicate a",
      refs: true
    },
    {
      id: "thr_duplicate_b",
      title: "Duplicate visible title",
      status: "active",
      priority: "medium",
      nextAction: "inspect duplicate b",
      refs: true
    }
  ], ({ db, rawPathCanary }) => {
    const map = createVisibleCodexSessionMap(db, {
      now: "2026-07-01T10:00:00.000Z",
      visibleCodex: {
        threadMap: {
          threads: [
            {
              visibleId: "visible-1",
              title: "Visible safe title",
              rawTitle: `Visible safe title Running 2h ${rawPathCanary} sk-test_1234567890`,
              status: "Running",
              updatedLabel: "2h",
              titleHash: "unused",
              confidence: "high",
              source: "peekaboo_snapshot"
            },
            {
              visibleId: "visible-ambiguous",
              title: "Duplicate visible title",
              rawTitle: "Duplicate visible title Running 1h",
              status: "Running",
              updatedLabel: "1h",
              titleHash: "unused",
              confidence: "high",
              source: "peekaboo_snapshot"
            }
          ]
        }
      },
      appServerThreads: {
        schema: "lco.codex.appServerThreads.v1",
        publicSafe: true,
        readOnly: true,
        generatedAt: "2026-07-01T10:00:00.000Z",
        sourceCoverage: { codexAppServer: "ok" },
        threads: [{
          appServerRef: "codex_app_thread:thr_visible",
          threadId: "thr_visible",
          titleSanitized: "Visible safe title",
          titleHash: "test",
          status: "active",
          loaded: true,
          updatedAt: "2026-07-01T09:00:00.000Z",
          sourceRef: "codex_thread:thr_visible",
          confidence: 0.9
        }, {
          appServerRef: "codex_app_thread:thr_duplicate_b",
          threadId: "thr_duplicate_b",
          titleSanitized: "Duplicate visible title",
          titleHash: "test-duplicate",
          status: "active",
          loaded: null,
          loadedState: "not_claimed",
          updatedAt: `${rawPathCanary} sk-test_1234567890`,
          sourceRef: "codex_thread:thr_duplicate_b",
          confidence: 0.9
        }],
        loadedThreadRefs: ["codex_app_thread:thr_visible"],
        loadedSignalSource: "same_connection",
        errors: [],
        actionsPerformed: {
          liveCodexControlRun: false,
          desktopGuiActionRun: false,
          rawTranscriptRead: false
        },
        proofBoundary: "test"
      }
    });

    assert.equal(map.schema, "lco.visibleCodexSessionMap.v1");
    assert.equal(map.publicSafe, true);
    assert.deepEqual(map.sourceCoverage, {
      indexedLco: "ok",
      visibleCodex: "ok",
      codexAppServer: "ok"
    });
    const visible = map.items.find((item) => item.desktopRef === "visible-1");
    assert.ok(visible);
    assert.equal(visible.appServerRef, "codex_app_thread:thr_visible");
    assert.equal(visible.sourceRef, "codex_thread:thr_visible");
    assert.equal(visible.sessionCardRef, "codex_thread:thr_visible");
    assert.equal(visible.confidence >= 0.75, true);
    assert.deepEqual(visible.ambiguity, []);
    const ambiguous = map.items.find((item) => item.desktopRef === "visible-ambiguous");
    assert.ok(ambiguous);
    assert.equal(ambiguous.sourceRef, "codex_thread:thr_duplicate_b");
    assert.equal(ambiguous.sessionCardRef, "codex_thread:thr_duplicate_b");
    assert.equal(ambiguous.ambiguity.includes("multiple_indexed_title_matches"), false);
    assert.equal(ambiguous.reasonCodes.includes("resolved_duplicate_title_by_app_server_id"), true);
    assert.equal(ambiguous.freshness.appServerUpdatedAt, null);
    assert.equal(map.actionsPerformed.liveCodexControlRun, false);
    assert.equal(map.actionsPerformed.desktopGuiActionRun, false);
    assert.equal(map.actionsPerformed.rawTranscriptRead, false);
    assert.doesNotMatch(JSON.stringify(map), /sk-test_1234567890|\/Users\/lume|private\.jsonl/);
  });
});

test("visible Codex map joins sidebar child-title candidate to app-server thread id", async () => {
  withIndexedSessions([
    {
      id: "019f291c-0dc6-7281-95e1-85bbcaaa9ca1",
      title: "EVA-LCO",
      status: "active",
      priority: "high",
      nextAction: "verify visible sidebar inventory",
      refs: true
    }
  ], ({ db }) => {
    const map = createVisibleCodexSessionMap(db, {
      visibleCodex: {
        threadMap: {
          threads: [{
            visibleId: "visible-sidebar-eva",
            title: "EVA-LCO",
            rawTitle: "EVA-LCO 1h",
            updatedLabel: "1h",
            confidence: "high",
            source: "peekaboo_snapshot"
          }]
        }
      },
      appServerThreads: {
        schema: "lco.codex.appServerThreads.v1",
        publicSafe: true,
        readOnly: true,
        generatedAt: "2026-07-04T10:00:00.000Z",
        sourceCoverage: { codexAppServer: "ok" },
        threads: [{
          appServerRef: "codex_app_thread:019f291c-0dc6-7281-95e1-85bbcaaa9ca1",
          threadId: "019f291c-0dc6-7281-95e1-85bbcaaa9ca1",
          titleSanitized: "EVA-LCO",
          titleHash: "unused",
          status: "notLoaded",
          loaded: false,
          loadedState: "not_loaded",
          updatedAt: null,
          sourceRef: "codex_thread:019f291c-0dc6-7281-95e1-85bbcaaa9ca1",
          confidence: 0.9
        }],
        loadedThreadRefs: [],
        loadedSignalSource: "same_connection",
        errors: [],
        actionsPerformed: {
          liveCodexControlRun: false,
          desktopGuiActionRun: false,
          rawTranscriptRead: false
        },
        proofBoundary: "redacted fixture"
      }
    });

    const item = map.items.find((candidate) => candidate.desktopRef === "visible-sidebar-eva");
    assert.ok(item);
    assert.equal(item.appServerRef, "codex_app_thread:019f291c-0dc6-7281-95e1-85bbcaaa9ca1");
    assert.equal(item.sourceRef, "codex_thread:019f291c-0dc6-7281-95e1-85bbcaaa9ca1");
    assert.equal(item.sessionCardRef, "codex_thread:019f291c-0dc6-7281-95e1-85bbcaaa9ca1");
    assert.equal(item.reasonCodes.includes("visible_codex_candidate"), true);
    assert.equal(item.reasonCodes.includes("app_server_signal"), true);
    assert.deepEqual(item.ambiguity, []);
    assert.equal(map.actionsPerformed.desktopGuiActionRun, false);
    assert.equal(map.actionsPerformed.rawTranscriptRead, false);
    assert.doesNotMatch(JSON.stringify(map), /\/Users\/lume|sk-test_|private\.jsonl|Pin chat|Archive chat/);
  });
});

test("visible Codex map marks duplicate indexed titles ambiguous without app-server disambiguation", async () => {
  withIndexedSessions([
    {
      id: "thr_duplicate_a",
      title: "Duplicate visible title",
      status: "active",
      priority: "medium",
      nextAction: "inspect duplicate a",
      refs: true
    },
    {
      id: "thr_duplicate_b",
      title: "Duplicate visible title",
      status: "active",
      priority: "medium",
      nextAction: "inspect duplicate b",
      refs: true
    }
  ], ({ db }) => {
    const map = createVisibleCodexSessionMap(db, {
      visibleCodex: {
        threadMap: {
          threads: [{
            visibleId: "visible-ambiguous",
            title: "Duplicate visible title",
            confidence: "high"
          }]
        }
      },
      appServerThreads: { sourceCoverage: { codexAppServer: "not_configured" }, threads: [] }
    });

    const item = map.items.find((candidate) => candidate.desktopRef === "visible-ambiguous");
    assert.ok(item);
    assert.equal(item.sessionCardRef, null);
    assert.equal(item.ambiguity.includes("multiple_indexed_title_matches"), true);
    assert.equal(item.reasonCodes.includes("ambiguous_join"), true);
    assert.equal(item.confidence <= 0.45, true);
  });
});

test("visible Codex map reports unconsumed duplicate app-server title matches", async () => {
  withIndexedSessions([
    {
      id: "thr_visible",
      title: "Visible safe title",
      status: "active",
      priority: "high",
      nextAction: "keep visible thread mapped",
      refs: true
    }
  ], ({ db }) => {
    const map = createVisibleCodexSessionMap(db, {
      visibleCodex: {
        threadMap: {
          threads: [{ visibleId: "visible-1", title: "Visible safe title", confidence: "high" }]
        }
      },
      appServerThreads: {
        sourceCoverage: { codexAppServer: "ok" },
        threads: [{
          appServerRef: "codex_app_thread:thr_app_a",
          threadId: "thr_app_a",
          titleSanitized: "Visible safe title",
          sourceRef: "codex_thread:thr_app_a",
          confidence: 0.9
        }, {
          appServerRef: "codex_app_thread:thr_app_b",
          threadId: "thr_app_b",
          titleSanitized: "Visible safe title",
          sourceRef: "codex_thread:thr_app_b",
          confidence: 0.9
        }]
      }
    });

    assert.equal(map.items.some((item) => item.appServerRef === "codex_app_thread:thr_app_a"), true);
    assert.equal(map.items.some((item) => item.appServerRef === "codex_app_thread:thr_app_b"), true);
    assert.equal(map.items.some((item) => item.ambiguity.includes("indexed_card_already_claimed")), true);
  });
});

test("visible Codex map preserves low confidence and unique untitled desktop refs", async () => {
  withIndexedSessions([
    {
      id: "thr_visible",
      title: "Visible safe title",
      status: "active",
      priority: "medium",
      nextAction: "inspect confidence",
      refs: true
    }
  ], ({ db }) => {
    const map = createVisibleCodexSessionMap(db, {
      visibleCodex: {
        threadMap: {
          threads: [
            { title: "Visible safe title", confidence: "low" },
            { status: "Running", updatedLabel: "1m", confidence: "low" },
            { status: "Idle", updatedLabel: "2m", confidence: "low" }
          ]
        }
      },
      appServerThreads: { sourceCoverage: { codexAppServer: "not_configured" }, threads: [] }
    });

    const lowConfidenceMatch = map.items.find((item) => item.sessionCardRef === "codex_thread:thr_visible");
    assert.ok(lowConfidenceMatch);
    assert.equal(lowConfidenceMatch.confidence < 0.5, true);
    const desktopRefs = map.items.map((item) => item.desktopRef).filter(Boolean);
    assert.equal(new Set(desktopRefs).size, desktopRefs.length);
    assert.equal(map.sourceCoverage.visibleCodex, "ok");
  });
});

test("visible Codex map treats an explicit empty visible probe as complete", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-visible-map-empty-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const map = createVisibleCodexSessionMap(db, {
      visibleCodex: { threadMap: { threads: [] } },
      appServerThreads: { sourceCoverage: { codexAppServer: "not_configured" }, threads: [] }
    });
    assert.equal(map.sourceCoverage.visibleCodex, "ok");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP exposes #260 read-only tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-visible-map-mcp-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const readClient = new FakeCodexReadClient({
    "remoteControl/status/read": { ok: true, result: { status: "disabled", environmentId: null }, notifications: [] },
    "thread/list": { ok: true, result: { data: [] }, notifications: [] },
    "thread/loaded/list": { ok: true, result: { data: [] }, notifications: [] }
  });

  try {
    const tools = createLooTools({
      db,
      audit,
      codexClient: { request: async () => ({ ok: true }) },
      codexReadClient: readClient
    });
    for (const name of ["loo_codex_app_server_status", "loo_codex_app_server_threads", "loo_visible_codex_map"]) {
      assert.ok(tools.find((tool) => tool.name === name), `${name} should be registered`);
    }

    const status = await tools.find((tool) => tool.name === "loo_codex_app_server_status")!.execute({});
    assert.equal((status as { publicSafe?: boolean }).publicSafe, true);
    const threads = await tools.find((tool) => tool.name === "loo_codex_app_server_threads")!.execute({ limit: 5 });
    assert.equal((threads as { publicSafe?: boolean }).publicSafe, true);
    const map = await tools.find((tool) => tool.name === "loo_visible_codex_map")!.execute({
      include_app_server: false,
      visible_codex: { threadMap: { threads: [] } }
    });
    assert.equal((map as { publicSafe?: boolean }).publicSafe, true);
    assert.equal((map as { sourceCoverage?: { visibleCodex?: string } }).sourceCoverage?.visibleCodex, "ok");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function withIndexedSessions<T>(
  fixtures: Array<{ id: string; title: string; status: string; priority: string; nextAction: string; refs?: boolean }>,
  run: (context: { db: ReturnType<typeof createDatabase>; root: string; sessions: string; rawPathCanary: string }) => T
): T {
  const root = mkdtempSync(join(tmpdir(), "loo-visible-map-"));
  const sessions = join(root, "sessions");
  const rawPathCanary = join(sessions, "private-canary.jsonl");
  mkdirSync(sessions, { recursive: true });
  for (const fixture of fixtures) writeSessionFixture(sessions, fixture);
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 50 });
    return run({ db, root, sessions, rawPathCanary });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writeSessionFixture(
  sessions: string,
  fixture: { id: string; title: string; status: string; priority: string; nextAction: string; refs?: boolean }
): void {
  const updatedAt = "2026-07-01T09:00:00.000Z";
  const refs = fixture.refs === true
    ? [
        `Proposed plan refs: codex_event:${fixture.id}-plan`,
        `Final-message refs: codex_event:${fixture.id}-final`,
        `Touched-file refs: codex_event:${fixture.id}-file`
      ]
    : [];
  const metadata = [
    `Project: lossless-openclaw-orchestrator`,
    `Status: ${fixture.status}`,
    `Priority: ${fixture.priority}`,
    "Owner: codex",
    "Blocker: none",
    `Next action: ${fixture.nextAction}`,
    "Closeout state: ready",
    ...refs,
    `Source refs: codex_thread:${fixture.id}`
  ].filter(Boolean).join("\n");
  const events = [
    {
      timestamp: updatedAt,
      session_meta: {
        payload: {
          id: fixture.id,
          cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator",
          model: "gpt-5.5",
          git: { branch: "main", commit_hash: "abc1234" }
        }
      }
    },
    { timestamp: updatedAt, event_msg: { type: "thread_name", name: fixture.title } },
    {
      timestamp: updatedAt,
      event_msg: {
        type: "agent_message",
        message: metadata
      }
    }
  ];
  writeFileSync(join(sessions, `rollout-2026-07-01T00-00-00-${fixture.id}.jsonl`), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}
