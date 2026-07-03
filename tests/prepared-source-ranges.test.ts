import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createDatabase,
  getPreparedSourceRanges,
  indexCodexSessions
} from "../packages/core/src/index.js";

function writePreparedJsonl(path: string, threadId: string, title: string, extraLines: unknown[] = []): void {
  const lines = [
    { timestamp: "2026-07-03T00:00:00Z", session_meta: { payload: { id: threadId, cwd: "/Users/lume/private/project", model: "gpt-5.4-mini" } } },
    { timestamp: "2026-07-03T00:00:01Z", event_msg: { type: "thread_name", name: title } },
    { timestamp: "2026-07-03T00:00:02Z", event_msg: { type: "user_message", message: "Please inspect /Users/lume/private/customer.txt with token PRIVATE_CANARY_TOKEN_1234567890" } },
    {
      timestamp: "2026-07-03T00:00:03Z",
      response_item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "<proposed_plan>\n1. Build prepared source ranges.\n</proposed_plan>" }]
      }
    },
    {
      timestamp: "2026-07-03T00:00:04Z",
      response_item: {
        type: "function_call",
        call_id: "call_prepared_range",
        name: "functions.exec_command",
        arguments: "{\"cmd\":\"cat /Users/lume/private/customer.txt && echo PRIVATE_CANARY_TOKEN_1234567890\"}"
      }
    },
    { timestamp: "2026-07-03T00:00:05Z", event_msg: { type: "agent_message", message: `Final: ${title} complete. Next action: open #408 PR.` } },
    ...extraLines
  ];
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
}

test("prepared-state migration adds additive shadow tables to an existing 1.1-style DB", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-migration-"));
  const dbPath = join(root, "orchestrator.sqlite");
  const oldDb = new DatabaseSync(dbPath);
  try {
    oldDb.exec(`
      CREATE TABLE codex_sessions (
        thread_id TEXT PRIMARY KEY,
        title TEXT,
        cwd TEXT,
        model TEXT,
        branch TEXT,
        git_sha TEXT,
        source_path TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        summary TEXT,
        final_message TEXT,
        safe_text TEXT NOT NULL DEFAULT '',
        event_count INTEGER NOT NULL DEFAULT 0,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        indexed_at TEXT NOT NULL
      );
      CREATE TABLE codex_source_files (
        source_path TEXT PRIMARY KEY,
        path_hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        last_indexed_at TEXT NOT NULL
      );
    `);
  } finally {
    oldDb.close();
  }

  const db = createDatabase(dbPath);
  try {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
    for (const table of [
      "loo_schema_migrations",
      "prepared_source_events",
      "prepared_source_ranges",
      "summary_leaves",
      "summary_edges",
      "prepared_cards",
      "prepared_inbox_items",
      "watcher_specs",
      "watcher_observations",
      "attention_queue",
      "hook_capture_packets",
      "state_prep_jobs"
    ]) {
      assert.equal(tables.has(table), true, `${table} exists`);
    }
    const migrationIds = new Set((db.prepare("SELECT migration_id AS migrationId FROM loo_schema_migrations").all() as Array<{ migrationId: string }>).map((row) => row.migrationId));
    for (const migrationId of [
      "2026-07-03-prepared-source-ranges",
      "2026-07-03-summary-leaves",
      "2026-07-03-prepared-cards",
      "2026-07-03-watcher-observations",
      "2026-07-03-hook-capture-packets",
      "2026-07-03-state-prep-jobs"
    ]) {
      assert.equal(migrationIds.has(migrationId), true, `${migrationId} migration is logged`);
    }
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared source range report skips malformed unsafe derived-cache rows", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-safe-row-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const sourcePath = join(sessions, "rollout-2026-07-03T00-00-00-019f-prepared-safe-row.jsonl");
  writePreparedJsonl(sourcePath, "019f-prepared-safe-row", "Prepared safe row proof");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const before = getPreparedSourceRanges(db, { threadId: "019f-prepared-safe-row", limit: 50 });
    assert.equal(before.ranges.length > 1, true);

    db.prepare("UPDATE prepared_source_ranges SET source_path_ref = ?, privacy_class = ? WHERE range_ref = ?").run(
      "/Users/lume/private/raw-transcript.jsonl",
      "public_safe_metadata",
      before.ranges[0]!.rangeRef
    );

    const report = getPreparedSourceRanges(db, { threadId: "019f-prepared-safe-row", limit: 50 });
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes("/Users/lume/private"), false);
    assert.equal(report.ranges.some((range) => range.sourcePathRef === "/Users/lume/private/raw-transcript.jsonl"), false);
    assert.equal(report.ranges.every((range) => /^codex_source:[0-9a-f]{16}$/.test(range.sourcePathRef)), true);
    assert.equal(report.ranges.length, before.ranges.length - 1);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared source ranges are public-safe opaque refs with hashes and no raw path text", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-ranges-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const sourcePath = join(sessions, "rollout-2026-07-03T00-00-00-019f-prepared-ranges.jsonl");
  writePreparedJsonl(sourcePath, "019f-prepared-ranges", "Prepared range proof");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const indexed = indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.equal(indexed.indexedFiles, 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

    const report = getPreparedSourceRanges(db, { threadId: "019f-prepared-ranges", limit: 50 });
    const serialized = JSON.stringify(report);
    assert.equal(report.publicSafe, true);
    assert.equal(report.readOnly, true);
    assert.equal(report.summary.total, report.ranges.length);
    assert.equal(report.sourceCoverage.preparedSourceRanges, "ok");
    assert.equal(serialized.includes(sourcePath), false);
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("PRIVATE_CANARY_TOKEN"), false);
    assert.equal(serialized.includes("customer.txt"), false);
    assert.equal(serialized.includes("cat "), false);

    const kinds = new Set(report.ranges.map((range) => range.rangeKind));
    assert.equal(kinds.has("session_metadata"), true);
    assert.equal(kinds.has("thread_title"), true);
    assert.equal(kinds.has("user_prompt"), true);
    assert.equal(kinds.has("proposed_plan"), true);
    assert.equal(kinds.has("final_message"), true);
    assert.equal(kinds.has("tool_call_metadata"), true);

    for (const range of report.ranges) {
      assert.match(range.rangeRef, /^codex_range:/);
      assert.match(range.eventRef, /^codex_event:/);
      assert.match(range.sourcePathRef, /^codex_source:/);
      assert.equal(range.threadId, "019f-prepared-ranges");
      assert.equal(range.extractorVersion, "prepared-source-ranges-v1");
      assert.equal(range.privacyClass, "public_safe_metadata");
      assert.equal(range.omissionStatus, "metadata_only");
      assert.equal(range.sourceHash.length, 32);
      assert.equal(range.contentHash.length, 32);
      assert.equal(range.confidence > 0 && range.confidence <= 1, true);
    }

    const rawRows = db.prepare("SELECT * FROM prepared_source_ranges").all();
    const rawRowsSerialized = JSON.stringify(rawRows);
    assert.equal(rawRowsSerialized.includes(sourcePath), false);
    assert.equal(rawRowsSerialized.includes("/Users/lume"), false);
    assert.equal(rawRowsSerialized.includes("PRIVATE_CANARY_TOKEN"), false);
    assert.equal(report.summary.lowConfidence > 0, true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared source ranges reindex append truncate and same-size changes without stale high-confidence rows", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-reindex-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const sourcePath = join(sessions, "rollout-2026-07-03T00-00-00-019f-prepared-reindex.jsonl");
  const fixedTime = new Date("2026-07-03T00:00:00Z");
  writePreparedJsonl(sourcePath, "019f-prepared-reindex", "Alpha range proof");
  utimesSync(sourcePath, fixedTime, fixedTime);
  const baseSize = statSync(sourcePath).size;

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const first = getPreparedSourceRanges(db, { threadId: "019f-prepared-reindex", limit: 100 });
    assert.equal(first.summary.total > 0, true);
    const firstRefs = new Set(first.ranges.map((range) => range.rangeRef));
    assert.equal(firstRefs.size, first.ranges.length);
    const firstHash = first.ranges[0]?.sourceHash;
    assert.ok(firstHash);

    writePreparedJsonl(sourcePath, "019f-prepared-reindex", "Alpha range proof", [
      { timestamp: "2026-07-03T00:00:06Z", event_msg: { type: "agent_message", message: "Final: appended prepared range observation." } }
    ]);
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const appended = getPreparedSourceRanges(db, { threadId: "019f-prepared-reindex", limit: 100 });
    assert.equal(appended.summary.total > first.summary.total, true);
    assert.equal(new Set(appended.ranges.map((range) => range.rangeRef)).size, appended.ranges.length);
    assertNoDuplicatePreparedEvents(db, "019f-prepared-reindex");

    writePreparedJsonl(sourcePath, "019f-prepared-reindex", "Bravo range proof");
    utimesSync(sourcePath, fixedTime, fixedTime);
    assert.equal(statSync(sourcePath).size, baseSize);
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const sameSize = getPreparedSourceRanges(db, { threadId: "019f-prepared-reindex", limit: 100 });
    assert.notEqual(sameSize.ranges[0]?.sourceHash, firstHash);
    assertNoDuplicatePreparedEvents(db, "019f-prepared-reindex");

    writeFileSync(sourcePath, [
      JSON.stringify({ timestamp: "2026-07-03T00:00:00Z", session_meta: { payload: { id: "019f-prepared-reindex" } } }),
      JSON.stringify({ timestamp: "2026-07-03T00:00:01Z", event_msg: { type: "thread_name", name: "Truncated range proof" } })
    ].join("\n") + "\n");
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const truncated = getPreparedSourceRanges(db, { threadId: "019f-prepared-reindex", limit: 100 });
    assert.equal(truncated.ranges.some((range) => range.rangeKind === "final_message"), false);
    assert.equal(truncated.ranges.every((range) => range.lineEnd <= 2), true);
    assert.equal(truncated.ranges.every((range) => range.confidence < 0.99), true);
    assertNoDuplicatePreparedEvents(db, "019f-prepared-reindex");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared source ranges backfill unchanged watermarked sources after migration", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-backfill-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const sourcePath = join(sessions, "rollout-2026-07-03T00-00-00-019f-prepared-backfill.jsonl");
  writePreparedJsonl(sourcePath, "019f-prepared-backfill", "Prepared backfill proof");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const first = indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.equal(first.indexedFiles, 1);
    db.prepare("DELETE FROM prepared_source_ranges").run();
    db.prepare("DELETE FROM prepared_source_events").run();

    const backfill = indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.equal(backfill.skippedFiles, 0);
    assert.equal(backfill.indexedFiles, 1);
    const report = getPreparedSourceRanges(db, { threadId: "019f-prepared-backfill", limit: 50 });
    assert.equal(report.summary.total > 0, true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared source events are scoped to opaque source path refs for identical fallback transcripts", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-source-scope-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const lines = [
    { timestamp: "2026-07-03T00:00:00Z", event_msg: { type: "thread_name", name: "Fallback duplicate proof" } },
    { timestamp: "2026-07-03T00:00:01Z", event_msg: { type: "user_message", message: "Build duplicate fallback proof." } }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";
  writeFileSync(join(sessions, "rollout-2026-07-03T00-00-00-019f-source-copy-a.jsonl"), lines);
  writeFileSync(join(sessions, "rollout-2026-07-03T00-00-00-019f-source-copy-b.jsonl"), lines);

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const indexed = indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.equal(indexed.errors.length, 0);
    assert.equal(indexed.indexedFiles, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM prepared_source_events").get().count, 4);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared source range cleanup removes stale rows when a source path maps to a new thread", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-source-remap-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const sourcePath = join(sessions, "rollout-2026-07-03T00-00-00-019f-source-remap.jsonl");
  writePreparedJsonl(sourcePath, "019f-source-remap-a", "Source remap A");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.equal(getPreparedSourceRanges(db, { threadId: "019f-source-remap-a", limit: 50 }).summary.total > 0, true);

    writePreparedJsonl(sourcePath, "019f-source-remap-b", "Source remap B");
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.equal(getPreparedSourceRanges(db, { threadId: "019f-source-remap-a", limit: 50 }).summary.total, 0);
    assert.equal(getPreparedSourceRanges(db, { threadId: "019f-source-remap-b", limit: 50 }).summary.total > 0, true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function assertNoDuplicatePreparedEvents(db: DatabaseSync, threadId: string): void {
  const eventRows = db.prepare("SELECT event_id AS eventId, event_ref AS eventRef FROM prepared_source_events WHERE thread_id = ?").all(threadId) as Array<{ eventId: string; eventRef: string }>;
  assert.equal(new Set(eventRows.map((row) => row.eventId)).size, eventRows.length, "no duplicate prepared_source_events.event_id rows");
  assert.equal(new Set(eventRows.map((row) => row.eventRef)).size, eventRows.length, "no duplicate prepared_source_events.event_ref rows");
}
