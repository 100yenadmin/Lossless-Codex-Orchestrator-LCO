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
  const client = new FakeCodexReadClient({
    "remoteControl/status/read": new Error(`Cannot connect to ${process.env.HOME}/.codex/socket with Bearer abcdefghijklmnop`)
  });

  const report = await createCodexAppServerStatusReport({
    client,
    transport: {
      mode: "stdio",
      command: `${process.env.HOME}/bin/codex`,
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
  assert.doesNotMatch(JSON.stringify(report), new RegExp(process.env.HOME!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(report), /Bearer abcdefghijklmnop/);
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
          updatedAt: 1782867600,
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
  assert.equal(report.sourceCoverage.codexAppServer, "ok");
  assert.deepEqual(client.requests.map((request) => request.method), ["thread/list", "thread/loaded/list", "thread/read"]);
  assert.deepEqual(client.requests[2]?.params, { threadId: "thr_visible", includeTurns: false });
  assert.equal(report.threads[0]?.threadId, "thr_visible");
  assert.equal(report.threads[0]?.loaded, true);
  assert.equal(report.threads[0]?.titleSanitized, "Visible safe title");
  assert.equal(report.readProbe?.threadId, "thr_visible");
  assert.equal(report.readProbe?.turnsOmitted, true);
  assert.doesNotMatch(JSON.stringify(report), /raw prompt|raw read|private\.jsonl|read-private|\/Users\/lume|\/Volumes\/LEXAR\/repos\/private/);
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
        }],
        loadedThreadRefs: ["codex_app_thread:thr_visible"],
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
    assert.equal(map.items[0]?.desktopRef, "visible-1");
    assert.equal(map.items[0]?.appServerRef, "codex_app_thread:thr_visible");
    assert.equal(map.items[0]?.sourceRef, "codex_thread:thr_visible");
    assert.equal(map.items[0]?.sessionCardRef, "codex_thread:thr_visible");
    assert.equal(map.items[0]?.confidence >= 0.75, true);
    assert.deepEqual(map.items[0]?.ambiguity, []);
    const ambiguous = map.items.find((item) => item.desktopRef === "visible-ambiguous");
    assert.ok(ambiguous);
    assert.equal(ambiguous.confidence < 0.5, true);
    assert.equal(ambiguous.ambiguity.includes("multiple_indexed_title_matches"), true);
    assert.equal(map.actionsPerformed.liveCodexControlRun, false);
    assert.equal(map.actionsPerformed.desktopGuiActionRun, false);
    assert.equal(map.actionsPerformed.rawTranscriptRead, false);
    assert.doesNotMatch(JSON.stringify(map), /sk-test_1234567890|\/Users\/lume|private\.jsonl/);
  });
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
