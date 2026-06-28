import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createAuditStore } from "../packages/adapters/src/index.js";
import {
  createDatabase,
  defaultCodexRoots,
  getSourceFileWatermark,
  indexCodexSessions,
  probeCodexSqliteStores,
  searchSessions
} from "../packages/core/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";

function writeJsonl(path: string, threadId: string, title: string): void {
  writeFileSync(path, [
    JSON.stringify({ session_meta: { payload: { id: threadId, cwd: "/Volumes/LEXAR/repos/example" } } }),
    JSON.stringify({ event_msg: { type: "thread_name", name: title } }),
    JSON.stringify({ event_msg: { type: "agent_message", message: `Final: ${title} complete.` } })
  ].join("\n") + "\n");
}

test("default Codex roots include active and archived session stores", () => {
  const home = "/Users/example";
  assert.deepEqual(defaultCodexRoots(home), [
    "/Users/example/.codex/sessions",
    "/Users/example/.codex/archived_sessions"
  ]);
});

test("indexes active and archived JSONL roots and skips unchanged files with watermarks", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-importer-"));
  const active = join(root, "sessions");
  const archived = join(root, "archived_sessions");
  mkdirSync(active, { recursive: true });
  mkdirSync(archived, { recursive: true });
  const activePath = join(active, "rollout-2026-06-28T00-00-00-019f-active.jsonl");
  const archivedPath = join(archived, "rollout-2026-06-27T00-00-00-019f-archived.jsonl");
  writeJsonl(activePath, "019f-active", "Active bridge work");
  writeJsonl(archivedPath, "019f-archived", "Archived bridge work");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const first = indexCodexSessions(db, { roots: [active, archived], maxFiles: 10 });
    assert.equal(first.indexedFiles, 2);
    assert.equal(first.skippedFiles, 0);
    assert.equal(first.indexedThreads, 2);
    assert.equal(searchSessions(db, { query: "Archived bridge", limit: 5 })[0]?.threadId, "019f-archived");

    const before = getSourceFileWatermark(db, activePath);
    assert.ok(before);

    const second = indexCodexSessions(db, { roots: [active, archived], maxFiles: 10 });
    assert.equal(second.indexedFiles, 0);
    assert.equal(second.skippedFiles, 2);
    assert.equal(second.indexedThreads, 0);
    assert.equal(second.indexedEvents, 0);
    assert.deepEqual(getSourceFileWatermark(db, activePath), before);

    writeJsonl(activePath, "019f-active", "Active bridge work updated");
    const third = indexCodexSessions(db, { roots: [active, archived], maxFiles: 10 });
    assert.equal(third.indexedFiles, 1);
    assert.equal(third.skippedFiles, 1);
    assert.equal(third.indexedThreads, 1);
    assert.notEqual(getSourceFileWatermark(db, activePath)?.pathHash, before.pathHash);
    assert.equal(searchSessions(db, { query: "updated", limit: 5 })[0]?.threadId, "019f-active");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("reindexes same-size files when content hash changes despite matching mtime", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-importer-hash-"));
  const active = join(root, "sessions");
  mkdirSync(active, { recursive: true });
  const fixedTime = new Date("2026-06-28T00:00:00Z");
  const activePath = join(active, "rollout-2026-06-28T00-00-00-019f-hash.jsonl");
  writeJsonl(activePath, "019f-hash", "Alpha title");
  utimesSync(activePath, fixedTime, fixedTime);
  const firstSize = statSync(activePath).size;

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const first = indexCodexSessions(db, { roots: [active], maxFiles: 10 });
    assert.equal(first.indexedFiles, 1);
    const before = getSourceFileWatermark(db, activePath);
    assert.ok(before);

    writeJsonl(activePath, "019f-hash", "Bravo title");
    utimesSync(activePath, fixedTime, fixedTime);
    assert.equal(statSync(activePath).size, firstSize);

    const second = indexCodexSessions(db, { roots: [active], maxFiles: 10 });
    assert.equal(second.indexedFiles, 1);
    assert.equal(second.skippedFiles, 0);
    assert.notEqual(getSourceFileWatermark(db, activePath)?.pathHash, before.pathHash);
    assert.equal(searchSessions(db, { query: "Bravo", limit: 5 })[0]?.threadId, "019f-hash");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("probes Codex SQLite stores read-only and reports schema support", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-sqlite-probe-"));
  const supported = join(root, "state_5.sqlite");
  const unsupported = join(root, "logs_2.sqlite");

  const stateDb = new DatabaseSync(supported);
  stateDb.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT); INSERT INTO threads VALUES ('thr_1', 'Hello');");
  stateDb.close();

  const logsDb = new DatabaseSync(unsupported);
  logsDb.exec("CREATE TABLE random_table (id TEXT PRIMARY KEY); INSERT INTO random_table VALUES ('row_1');");
  logsDb.close();

  const beforeSupported = statSync(supported).mtimeMs;
  const beforeUnsupported = statSync(unsupported).mtimeMs;

  const result = probeCodexSqliteStores([root]);
  const byPath = new Map(result.stores.map((store) => [store.path, store]));

  assert.equal(result.stores.length, 2);
  assert.equal(byPath.get(supported)?.kind, "state");
  assert.equal(byPath.get(supported)?.supported, true);
  assert.deepEqual(byPath.get(supported)?.tables.includes("threads"), true);
  assert.equal(byPath.get(unsupported)?.kind, "logs");
  assert.equal(byPath.get(unsupported)?.supported, false);
  assert.match(byPath.get(unsupported)?.reason ?? "", /missing supported tables/);
  assert.equal(existsSync(`${supported}-wal`), false);
  assert.equal(statSync(supported).mtimeMs, beforeSupported);
  assert.equal(statSync(unsupported).mtimeMs, beforeUnsupported);
  assert.deepEqual(probeCodexSqliteStores([supported]).stores, []);

  rmSync(root, { recursive: true, force: true });
});

test("MCP tools expose default Codex roots and read-only SQLite probes", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-mcp-importer-"));
  const codexHome = join(root, ".codex");
  const active = join(codexHome, "sessions");
  const archived = join(codexHome, "archived_sessions");
  mkdirSync(active, { recursive: true });
  mkdirSync(archived, { recursive: true });
  writeJsonl(join(active, "rollout-2026-06-28T00-00-00-019f-mcp-active.jsonl"), "019f-mcp-active", "MCP active");
  writeJsonl(join(archived, "rollout-2026-06-27T00-00-00-019f-mcp-archived.jsonl"), "019f-mcp-archived", "MCP archived");
  const statePath = join(codexHome, "state_5.sqlite");
  const stateDb = new DatabaseSync(statePath);
  stateDb.exec("CREATE TABLE threads (id TEXT PRIMARY KEY);");
  stateDb.close();

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const oldHome = process.env.HOME;
  try {
    process.env.HOME = root;
    const tools = createLooTools({
      db,
      audit: createAuditStore(join(root, "audit.jsonl")),
      codexClient: { request: async () => ({ ok: true }) }
    });
    const indexTool = tools.find((tool) => tool.name === "loo_index_sessions");
    assert.ok(indexTool);
    const indexed = await indexTool.execute({ roots: [] }) as { indexedFiles: number; indexedThreads: number };
    assert.equal(indexed.indexedFiles, 2);
    assert.equal(indexed.indexedThreads, 2);

    const probeTool = tools.find((tool) => tool.name === "loo_codex_sqlite_stores");
    assert.ok(probeTool);
    const probe = await probeTool.execute({ roots: [] }) as { stores: Array<{ path: string; supported: boolean }> };
    assert.equal(probe.stores.length, 1);
    assert.equal(probe.stores[0]?.path, statePath);
    assert.equal(probe.stores[0]?.supported, true);
  } finally {
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
