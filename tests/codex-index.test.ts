import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuditStore } from "../packages/adapters/src/index.js";
import {
  captureThreadTitleFinalizerHookPacket,
  createDatabase,
  describeSession,
  describeRecallRef,
  expandSession,
  getCodexJsonlDriftStatus,
  getCodexFinalMessages,
  getCodexPlans,
  getCodexToolCalls,
  getCodexThreadMap,
  getCodexTouchedFiles,
  getRecentSessions,
  indexCodexSessions,
  migrate,
  normalizeBm25TextScores,
  searchSessions
} from "../packages/core/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";
import {
  writeSyntheticCodexCorpus,
  writeSyntheticCodexSession
} from "./helpers/synthetic-codex.js";
import * as searchModule from "../packages/core/src/search.js";

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-28T00-00-00-019f-test-thread.jsonl");
  const lines = [
    {
      session_meta: {
        payload: {
          id: "019f-test-thread",
          cwd: "/Volumes/LEXAR/repos/example",
          model: "gpt-5.5",
          git: { branch: "main", commit_hash: "abc1234" }
        }
      }
    },
    { event_msg: { type: "thread_name", name: "Implement billing bridge" } },
    {
      response_item: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "<proposed_plan>\n# Billing bridge\nShip a guarded bridge.\n</proposed_plan>"
          }
        ]
      }
    },
    {
      response_item: {
        type: "function_call",
        call_id: "call_1",
        name: "functions.exec_command",
        arguments: "{\"cmd\":\"sed -n '1,20p' /Volumes/LEXAR/repos/example/src/billing.ts\"}"
      }
    },
    {
      event_msg: {
        type: "agent_message",
        message: "Final: billing bridge smoke passed. Next action: open PR."
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return { root, sessions, threadPath };
}

function sqliteTableExists(db: ReturnType<typeof createDatabase>, tableName: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') AND name = ?").get(tableName);
  return row !== undefined;
}

function writeMinimalCodexSession(path: string, threadId: string, title: string): void {
  writeFileSync(path, [
    { timestamp: "2026-07-06T00:00:00.000Z", session_meta: { payload: { id: threadId } } },
    { timestamp: "2026-07-06T00:00:01.000Z", event_msg: { type: "thread_name", name: title } },
    { timestamp: "2026-07-06T00:00:02.000Z", event_msg: { type: "agent_message", message: `Final: ${title}` } }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");
}

function codexFtsRowidSnapshot(db: ReturnType<typeof createDatabase>): Array<{
  threadId: string;
  sessionRowid: number;
  safeTextFtsRowid: number | null;
  searchFtsRowid: number | null;
}> {
  return db.prepare(`
    SELECT
      s.thread_id AS threadId,
      s.rowid AS sessionRowid,
      safe.rowid AS safeTextFtsRowid,
      search.rowid AS searchFtsRowid
    FROM codex_sessions s
    LEFT JOIN codex_safe_text_fts safe ON safe.thread_id = s.thread_id
    LEFT JOIN codex_search_fts search ON search.thread_id = s.thread_id
    ORDER BY s.thread_id
  `).all() as Array<{
    threadId: string;
    sessionRowid: number;
    safeTextFtsRowid: number | null;
    searchFtsRowid: number | null;
  }>;
}

function assertCodexFtsPinnedToSessionRowids(db: ReturnType<typeof createDatabase>): void {
  const snapshot = codexFtsRowidSnapshot(db);
  assert.equal(snapshot.length, Number((db.prepare("SELECT COUNT(*) AS count FROM codex_sessions").get() as { count: number }).count));
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM codex_safe_text_fts").get() as { count: number }).count), snapshot.length);
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM codex_search_fts").get() as { count: number }).count), snapshot.length);
  for (const row of snapshot) {
    assert.equal(row.safeTextFtsRowid, row.sessionRowid, `${row.threadId} codex_safe_text_fts rowid must match codex_sessions rowid`);
    assert.equal(row.searchFtsRowid, row.sessionRowid, `${row.threadId} codex_search_fts rowid must match codex_sessions rowid`);
  }
}

test("indexes Codex sessions with plans, finals, touched files, and search text", () => {
  const fixture = makeFixture();
  const dbPath = join(fixture.root, "orchestrator.sqlite");
  const db = createDatabase(dbPath);
  try {
    const result = indexCodexSessions(db, { roots: [fixture.sessions], maxFiles: 10 });
    assert.equal(result.indexedFiles, 1);
    assert.equal(result.indexedThreads, 1);
    assert.equal(result.errors.length, 0);

    const matches = searchSessions(db, { query: "billing bridge", limit: 5 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.threadId, "019f-test-thread");
    assert.equal(matches[0]?.title, "Implement billing bridge");

    const description = describeSession(db, "019f-test-thread");
    assert.equal(description?.summary?.includes("billing bridge smoke passed"), true);
    assert.equal(description?.summary?.includes("Model: gpt-5.5"), true);
    assert.equal(description?.summary?.includes("Branch: main@abc1234"), true);
    assert.equal(description?.summary?.includes("Files: /Volumes/LEXAR/repos/example/src/billing.ts"), true);
    assert.equal(description?.summary?.includes("Tools: functions.exec_command"), true);
    assert.equal(description?.planCount, 1);
    assert.equal(description?.touchedFiles.length, 1);
    assert.equal(description?.touchedFiles[0], "/Volumes/LEXAR/repos/example/src/billing.ts");

    assert.equal(getCodexThreadMap(db, { limit: 10 })[0]?.threadId, "019f-test-thread");
    assert.equal(getCodexFinalMessages(db, { limit: 10 })[0]?.text.includes("Next action"), true);
    assert.equal(getCodexPlans(db, { limit: 10 })[0]?.text.includes("Billing bridge"), true);
    assert.deepEqual(getCodexTouchedFiles(db, { threadId: "019f-test-thread" }), ["/Volumes/LEXAR/repos/example/src/billing.ts"]);
    assert.deepEqual(getRecentSessions(db, { touchedPath: "src/billing.ts", includeCards: true }).cards.map((card) => card.threadId), ["codex_thread:019f-test-thread"]);

    const expanded = expandSession(db, { threadId: "019f-test-thread", tokenBudget: 80 });
    assert.equal(expanded.threadId, "019f-test-thread");
    assert.equal(expanded.text.includes("Implement billing bridge"), true);
    assert.equal(expanded.text.includes("billing bridge smoke passed"), true);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("maxFiles selects newest JSONL files first and reports dropped oldest candidates", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-max-files-recency-"));
  const sessions = join(root, "sessions");
  const oldDir = join(sessions, "2026", "01", "01");
  const newDir = join(sessions, "2026", "07", "05");
  mkdirSync(oldDir, { recursive: true });
  mkdirSync(newDir, { recursive: true });

  const oldPath = join(oldDir, "rollout-2026-01-01T00-00-00-019f-oldest.jsonl");
  const newAPath = join(newDir, "rollout-2026-07-05T10-00-00-019f-new-a.jsonl");
  const newBPath = join(newDir, "rollout-2026-07-05T11-00-00-019f-new-b.jsonl");
  writeMinimalCodexSession(oldPath, "019f-oldest", "Oldest capped candidate");
  writeMinimalCodexSession(newAPath, "019f-new-a", "New capped candidate A");
  writeMinimalCodexSession(newBPath, "019f-new-b", "New capped candidate B");
  utimesSync(oldPath, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
  utimesSync(newAPath, new Date("2026-07-05T10:00:00.000Z"), new Date("2026-07-05T10:00:00.000Z"));
  utimesSync(newBPath, new Date("2026-07-05T11:00:00.000Z"), new Date("2026-07-05T11:00:00.000Z"));

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const result = indexCodexSessions(db, { roots: [sessions], maxFiles: 2 });
    const rows = db.prepare("SELECT thread_id AS threadId FROM codex_sessions ORDER BY thread_id").all() as Array<{ threadId: string }>;

    assert.equal(result.indexedFiles, 2);
    assert.equal(result.skippedFiles, 1);
    assert.deepEqual(rows.map((row) => row.threadId), ["019f-new-a", "019f-new-b"]);
    assert.deepEqual(result.limitedFiles, [{
      path: sessions,
      reason: "max_files_dropped_oldest",
      limit: 2,
      actual: 3
    }]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("search module does not export obsolete FTS maintenance helpers", () => {
  assert.equal("upsertCodexSearchFtsForThread" in searchModule, false);
  assert.equal("codexSearchFtsNeedsBackfill" in searchModule, false);
});

test("index pruning removes deleted Codex source rows from drift status", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-prune-sources-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const keepPath = join(sessions, "rollout-2026-07-06T00-00-00-019f-prune-keep.jsonl");
  const deletePath = join(sessions, "rollout-2026-07-06T00-00-00-019f-prune-delete.jsonl");
  writeMinimalCodexSession(keepPath, "019f-prune-keep", "Keep source row");
  writeFileSync(deletePath, [
    JSON.stringify({ timestamp: "2026-07-06T00:00:00.000Z", session_meta: { payload: { id: "019f-prune-delete" } } }),
    "{not-json",
    JSON.stringify({ timestamp: "2026-07-06T00:00:01.000Z", event_msg: { type: "thread_name", name: "Delete source row" } })
  ].join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    assert.equal(indexCodexSessions(db, { roots: [sessions], maxFiles: 10 }).indexedFiles, 2);
    assert.equal(getCodexJsonlDriftStatus(db).filesIndexed, 2);
    assert.equal(getCodexJsonlDriftStatus(db).filesWithDrift, 1);
    const aliasReport = captureThreadTitleFinalizerHookPacket(db, {
      thread_id: "019f-prune-delete",
      cwd: root,
      current_title: "Delete source row",
      last_assistant_message: "Final: pruned source alias should disappear with its deleted JSONL."
    });
    assert.equal(aliasReport.aliasInserted, true);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM codex_thread_title_aliases WHERE thread_id = ?").get("019f-prune-delete") as { count: number }).count), 1);
    assert.equal(searchSessions(db, { query: "pruned source alias", limit: 5 }).some((result) => result.threadId === "019f-prune-delete"), true);
    db.prepare(`
      INSERT INTO prepared_cards (
        card_id, card_ref, target_ref, card_kind, title, objective, summary_text,
        source_refs_json, source_range_refs_json, authority_coverage_json,
        input_hash, extractor_version, privacy_class, confidence, freshness_at,
        stale, state, reason_codes_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "prepared-card-prune-delete",
      "prepared_card:019f-prune-delete:test",
      "codex_thread:019f-prune-delete",
      "session",
      "Delete source row",
      "Prune stale prepared state",
      "Prepared state must disappear with the deleted JSONL source.",
      JSON.stringify(["codex_thread:019f-prune-delete"]),
      JSON.stringify([]),
      JSON.stringify({ lco: "ok" }),
      "hash-prune-delete",
      "test",
      "public_safe",
      0.9,
      "2026-07-06T00:00:02.000Z",
      0,
      "ready",
      JSON.stringify([]),
      "2026-07-06T00:00:02.000Z",
      "2026-07-06T00:00:02.000Z"
    );
    db.prepare(`
      INSERT INTO prepared_inbox_items (
        item_id, card_ref, target_ref, urgency_score, state, reason_codes_json,
        source_refs_json, execute_false, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "prepared-inbox-prune-delete",
      "prepared_card:019f-prune-delete:test",
      "codex_thread:019f-prune-delete",
      0.5,
      "ready",
      JSON.stringify([]),
      JSON.stringify(["codex_thread:019f-prune-delete"]),
      1,
      "2026-07-06T00:00:02.000Z",
      "2026-07-06T00:00:02.000Z"
    );
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM prepared_cards WHERE card_id = ?").get("prepared-card-prune-delete") as { count: number }).count), 1);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM prepared_inbox_items WHERE item_id = ?").get("prepared-inbox-prune-delete") as { count: number }).count), 1);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM prepared_cards WHERE target_ref = ?").get("codex_thread:019f-prune-delete") as { count: number }).count) > 0, true);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM prepared_inbox_items WHERE target_ref = ?").get("codex_thread:019f-prune-delete") as { count: number }).count) > 0, true);

    rmSync(deletePath, { force: true });
    const pruned = indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    assert.equal(pruned.errors.length, 0);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM codex_source_files").get() as { count: number }).count), 1);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM codex_sessions").get() as { count: number }).count), 1);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM codex_thread_title_aliases WHERE thread_id = ?").get("019f-prune-delete") as { count: number }).count), 0);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM prepared_cards WHERE target_ref = ?").get("codex_thread:019f-prune-delete") as { count: number }).count), 0);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM prepared_inbox_items WHERE target_ref = ?").get("codex_thread:019f-prune-delete") as { count: number }).count), 0);
    assert.equal(searchSessions(db, { query: "019f-prune-delete", limit: 5 }).length, 0);
    assert.equal(searchSessions(db, { query: "pruned source alias", limit: 5 }).some((result) => result.threadId === "019f-prune-delete"), false);
    assert.equal(getCodexJsonlDriftStatus(db).filesIndexed, 1);
    assert.equal(getCodexJsonlDriftStatus(db).filesWithDrift, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex FTS documents stay pinned to session rowids across cold index, reindex, and mutation", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-fts-rowids-"));
  try {
    const corpus = writeSyntheticCodexCorpus(root, 3);
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const cold = indexCodexSessions(db, { roots: [corpus.sessionsDir], maxFiles: 10 });
      assert.equal(cold.indexedFiles, 3);
      assertCodexFtsPinnedToSessionRowids(db);

      db.prepare("UPDATE codex_source_files SET metadata_extractor_version = NULL").run();
      const reindex = indexCodexSessions(db, { roots: [corpus.sessionsDir], maxFiles: 10 });
      assert.equal(reindex.indexedFiles, 3);
      assertCodexFtsPinnedToSessionRowids(db);

      writeSyntheticCodexSession(corpus.files[1]!, {
        threadId: "019f-bench-000001",
        title: "Synthetic issue 571 mutated rowid pinning session",
        finalMessage: "Final: synthetic issue 571 mutation completed with rowid-pinned FTS documents. Next action: benchmark."
      });
      const mutation = indexCodexSessions(db, { roots: [corpus.sessionsDir], maxFiles: 10 });
      assert.equal(mutation.indexedFiles, 1);
      assertCodexFtsPinnedToSessionRowids(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("migrate repairs legacy Codex FTS rowid drift without reindexing", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-migrate-fts-repair-"));
  try {
    const corpus = writeSyntheticCodexCorpus(root, 2);
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      indexCodexSessions(db, { roots: [corpus.sessionsDir], maxFiles: 10 });
      const driftRow = db.prepare("SELECT rowid AS sessionRowid, thread_id AS threadId FROM codex_sessions ORDER BY rowid ASC LIMIT 1").get() as { sessionRowid: number; threadId: string };
      const driftThreadId = driftRow.threadId;
      db.prepare("DELETE FROM codex_safe_text_fts WHERE rowid = ?").run(driftRow.sessionRowid);
      db.prepare("INSERT INTO codex_safe_text_fts (thread_id, content) VALUES (?, ?)").run(driftThreadId, "legacy unpinned safe text");
      db.prepare("DELETE FROM codex_search_fts WHERE rowid = ?").run(driftRow.sessionRowid);
      db.prepare(`
        INSERT INTO codex_search_fts (thread_id, title, summary, plans, finals, touched_files, tool_meta, body)
        VALUES (?, ?, '', '', '', '', '', ?)
      `).run(driftThreadId, "legacy unpinned search title", "legacy unpinned search body");

      const before = codexFtsRowidSnapshot(db).find((row) => row.threadId === driftThreadId);
      assert.notEqual(before?.safeTextFtsRowid, before?.sessionRowid);
      assert.notEqual(before?.searchFtsRowid, before?.sessionRowid);

      migrate(db);

      assert.equal(sqliteTableExists(db, "codex_safe_text_fts"), true);
      assertCodexFtsPinnedToSessionRowids(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex indexing repairs legacy FTS rowid drift before mutating a session", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-fts-rowid-repair-"));
  try {
    const corpus = writeSyntheticCodexCorpus(root, 3);
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      indexCodexSessions(db, { roots: [corpus.sessionsDir], maxFiles: 10 });
      const driftThreadId = "019f-bench-000001";
      const driftRow = db.prepare("SELECT rowid AS sessionRowid FROM codex_sessions WHERE thread_id = ?").get(driftThreadId) as { sessionRowid: number };
      db.prepare("DELETE FROM codex_safe_text_fts WHERE rowid = ?").run(driftRow.sessionRowid);
      db.prepare("INSERT INTO codex_safe_text_fts (thread_id, content) VALUES (?, ?)").run(driftThreadId, "legacy drifted safe text row");
      db.prepare("DELETE FROM codex_search_fts WHERE rowid = ?").run(driftRow.sessionRowid);
      db.prepare(`
        INSERT INTO codex_search_fts (thread_id, title, summary, plans, finals, touched_files, tool_meta, body)
        VALUES (?, ?, '', '', '', '', '', ?)
      `).run(driftThreadId, "legacy drifted search row", "legacy drifted body row");

      assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM codex_safe_text_fts").get() as { count: number }).count), 3);
      assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM codex_search_fts").get() as { count: number }).count), 3);

      writeSyntheticCodexSession(corpus.files[1]!, {
        threadId: driftThreadId,
        title: "Synthetic issue 571 repaired rowid drift session",
        finalMessage: "Final: synthetic issue 571 repaired pre-existing FTS rowid drift. Next action: benchmark."
      });
      const mutation = indexCodexSessions(db, { roots: [corpus.sessionsDir], maxFiles: 10 });
      assert.equal(mutation.indexedFiles, 1);
      assertCodexFtsPinnedToSessionRowids(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("search uses field-weighted FTS scores and matched-field attribution", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-field-fts-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });

  writeFileSync(join(sessions, "rollout-2026-07-06T00-00-00-019f-title-ranked.jsonl"), [
    { timestamp: "2026-07-06T00:00:00.000Z", session_meta: { payload: { id: "019f-title-ranked" } } },
    { timestamp: "2026-07-06T00:00:01.000Z", event_msg: { type: "thread_name", name: "Needle ranking calibration" } },
    { timestamp: "2026-07-06T00:00:02.000Z", event_msg: { type: "agent_message", message: "Final: unrelated closeout with no extra signal." } }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");

  writeFileSync(join(sessions, "rollout-2026-07-06T00-00-00-019f-body-ranked.jsonl"), [
    { timestamp: "2026-07-06T00:00:00.000Z", session_meta: { payload: { id: "019f-body-ranked" } } },
    { timestamp: "2026-07-06T00:00:01.000Z", event_msg: { type: "thread_name", name: "General retrieval note" } },
    { timestamp: "2026-07-06T00:00:02.000Z", event_msg: { type: "agent_message", message: "Final: body-only note about needle ranking calibration for a broad recall path." } }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    assert.equal(sqliteTableExists(db, "codex_search_fts"), true);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM codex_safe_text_fts").get() as { count: number }).count), 2);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM codex_search_fts").get() as { count: number }).count), 2);

    const matches = searchSessions(db, {
      query: "needle ranking calibration",
      limit: 2,
      now: "2026-07-06T00:00:02.000Z"
    });

    assert.equal(matches.length, 2);
    assert.equal(matches[0]?.threadId, "019f-title-ranked");
    assert.equal(matches[0]?.matchKind, "full_text");
    assert.equal(matches[0]?.score > (matches[1]?.score ?? 0), true);
    assert.equal(Number.isFinite(matches[0]?.matchFeatures?.bm25), true);
    assert.equal(Number.isFinite(matches[0]?.matchFeatures?.sText), true);
    assert.equal(Number.isFinite(matches[0]?.matchFeatures?.sRec), true);
    assert.equal(matches[0]?.matchFeatures?.matchedFields.includes("title"), true);
    assert.equal(matches[0]?.reasonCodes.includes("matched_field:title"), true);
    assert.equal(matches[1]?.matchFeatures?.matchedFields.includes("body"), true);
    assert.equal(matches[1]?.reasonCodes.includes("matched_field:body"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ranked search joins FTS rows by pinned rowid instead of mutable thread id text", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-search-rowid-join-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });

  writeFileSync(join(sessions, "rollout-2026-07-06T00-00-00-019f-rowid-search-target.jsonl"), [
    { timestamp: "2026-07-06T00:00:00.000Z", session_meta: { payload: { id: "019f-rowid-search-target" } } },
    { timestamp: "2026-07-06T00:00:01.000Z", event_msg: { type: "thread_name", name: "Rowid invariant ranked search" } },
    { timestamp: "2026-07-06T00:00:02.000Z", event_msg: { type: "agent_message", message: "Final: rowid invariant ranked search completed. Next action: benchmark." } }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const target = db.prepare("SELECT rowid AS rowid FROM codex_sessions WHERE thread_id = ?").get("019f-rowid-search-target") as { rowid: number };
    db.prepare("UPDATE codex_search_fts SET thread_id = ? WHERE rowid = ?").run("019f-rowid-search-drifted", target.rowid);

    const matches = searchSessions(db, {
      query: "rowid invariant ranked search",
      limit: 5,
      now: "2026-07-06T00:00:02.000Z"
    });

    assert.equal(matches[0]?.threadId, "019f-rowid-search-target");
    assert.equal(matches[0]?.matchKind, "full_text");
    assert.equal(matches[0]?.reasonCodes.includes("fts_match"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("field-weight beats recency: older strong-title outranks newer weak-body", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-recency-inv-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });

  // Older thread, strong TITLE match (all query terms, field weight 8).
  writeFileSync(join(sessions, "rollout-2026-06-01T00-00-00-019f-old-title.jsonl"), [
    { timestamp: "2026-06-01T00:00:00.000Z", session_meta: { payload: { id: "019f-old-title" } } },
    { timestamp: "2026-06-01T00:00:01.000Z", event_msg: { type: "thread_name", name: "Needle ranking calibration" } },
    { timestamp: "2026-06-01T00:00:02.000Z", event_msg: { type: "agent_message", message: "Final: closeout notes about deployment and unrelated tooling chores." } }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");

  // Much newer thread, weak BODY-only match (one query term, diluted, weight 1).
  writeFileSync(join(sessions, "rollout-2026-07-05T00-00-00-019f-new-body.jsonl"), [
    { timestamp: "2026-07-05T00:00:00.000Z", session_meta: { payload: { id: "019f-new-body" } } },
    { timestamp: "2026-07-05T00:00:01.000Z", event_msg: { type: "thread_name", name: "General retrieval note" } },
    { timestamp: "2026-07-05T00:00:02.000Z", event_msg: { type: "agent_message", message: "Final: broad recall path body mentioning needle once among many other unrelated words about deployment, tooling, refactors, and assorted chores that dilute the term frequency substantially here." } }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    const matches = searchSessions(db, {
      query: "needle ranking calibration",
      limit: 2,
      now: "2026-07-06T00:00:00.000Z"
    });

    assert.equal(matches.length, 2);
    // The 0.8 text + 0.2 recency blend must not let a much-newer weak body match
    // overtake an older strong title match: the older thread is ~34 days older
    // (recency favors the newer one) yet must still rank first on field weight.
    assert.equal(matches[0]?.threadId, "019f-old-title");
    assert.equal(matches[0]?.matchFeatures?.matchedFields.includes("title"), true);
    assert.equal((matches[0]?.matchFeatures?.sRec ?? 1) < (matches[1]?.matchFeatures?.sRec ?? 0), true);
    assert.equal(matches[1]?.threadId, "019f-new-body");
    assert.equal(matches[0]?.score > (matches[1]?.score ?? 0), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("recency breaks ties: equal text scores rank the newer thread first", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-recency-tie-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });

  // Two threads with identical title matches (equal text score) but different
  // recency; the newer one must win on the 0.2 recency term.
  writeFileSync(join(sessions, "rollout-2026-06-01T00-00-00-019f-tie-older.jsonl"), [
    { timestamp: "2026-06-01T00:00:00.000Z", session_meta: { payload: { id: "019f-tie-older" } } },
    { timestamp: "2026-06-01T00:00:01.000Z", event_msg: { type: "thread_name", name: "Needle ranking calibration" } },
    { timestamp: "2026-06-01T00:00:02.000Z", event_msg: { type: "agent_message", message: "Final: shared closeout body." } }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");

  writeFileSync(join(sessions, "rollout-2026-07-05T00-00-00-019f-tie-newer.jsonl"), [
    { timestamp: "2026-07-05T00:00:00.000Z", session_meta: { payload: { id: "019f-tie-newer" } } },
    { timestamp: "2026-07-05T00:00:01.000Z", event_msg: { type: "thread_name", name: "Needle ranking calibration" } },
    { timestamp: "2026-07-05T00:00:02.000Z", event_msg: { type: "agent_message", message: "Final: shared closeout body." } }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    const matches = searchSessions(db, {
      query: "needle ranking calibration",
      limit: 2,
      now: "2026-07-06T00:00:00.000Z"
    });

    assert.equal(matches.length, 2);
    assert.equal(matches[0]?.matchFeatures?.sText, matches[1]?.matchFeatures?.sText);
    assert.equal(matches[0]?.threadId, "019f-tie-newer");
    assert.equal((matches[0]?.matchFeatures?.sRec ?? 0) > (matches[1]?.matchFeatures?.sRec ?? 0), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("normalizeBm25TextScores preserves order deterministically on mixed-sign sets", () => {
  // FTS5 bm25() is negative-is-better; the normalizer must map a mixed-sign
  // candidate set into [0, 1] with the strongest (most-negative) match at 1.0
  // and preserve relative order regardless of any anomalous non-negative value,
  // replacing the old global sign heuristic that could invert the whole set.
  const bm25Values = [-9, -3, -0.5, 0, 2.5];
  const normalized = normalizeBm25TextScores(bm25Values);

  for (const value of normalized) {
    assert.equal(Number.isFinite(value), true);
    assert.equal(value >= 0 && value <= 1, true);
  }
  // Strongest match (most negative bm25) scales to 1.0.
  assert.equal(normalized[0], 1);
  // Strictly decreasing with weaker relevance; non-positive bm25 => 0.
  assert.equal(normalized[0]! > normalized[1]!, true);
  assert.equal(normalized[1]! > normalized[2]!, true);
  assert.equal(normalized[2]! > normalized[3]!, true);
  assert.equal(normalized[3], 0);
  assert.equal(normalized[4], 0);
  // Deterministic: same input => same output, no dependence on sign mix.
  assert.deepEqual(normalizeBm25TextScores(bm25Values), normalized);
});

test("codex_search_fts migration backfills from existing relational rows", () => {
  const db = createDatabase(":memory:");
  try {
    db.prepare(`
      INSERT INTO codex_sessions (thread_id, title, source_path, created_at, updated_at, summary, final_message, safe_text, event_count, tool_call_count, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "019f-backfill-search",
      "Backfill title lane",
      "backfill.jsonl",
      "2026-07-06T00:00:00.000Z",
      "2026-07-06T00:00:02.000Z",
      "Backfill summary lane",
      "Final: backfill final lane",
      "Backfill body lane",
      3,
      1,
      "2026-07-06T00:00:03.000Z"
    );
    db.prepare("INSERT INTO codex_plans (plan_id, thread_id, text, ordinal) VALUES (?, ?, ?, ?)").run("plan-backfill", "019f-backfill-search", "Backfill plan lane", 0);
    db.prepare("INSERT INTO codex_touched_files (touched_file_id, thread_id, path, source_kind) VALUES (?, ?, ?, ?)").run("file-backfill", "019f-backfill-search", "packages/core/src/search.ts", "codex_text");
    db.prepare("INSERT INTO codex_tool_calls (call_id, thread_id, tool_name, arguments_text, reason_code) VALUES (?, ?, ?, ?, ?)").run("tool-backfill", "019f-backfill-search", "functions.exec_command", "rg Backfill", null);

    assert.equal(sqliteTableExists(db, "codex_search_fts"), true);
    db.prepare("DELETE FROM codex_search_fts").run();
    db.prepare("DELETE FROM loo_schema_migrations WHERE migration_id = ?").run("2026-07-06-codex-search-fts");

    migrate(db);

    const row = db.prepare(`
      SELECT
        s.rowid AS sessionRowid,
        search.rowid AS searchRowid,
        search.title,
        search.summary,
        search.plans,
        search.finals,
        search.touched_files AS touchedFiles,
        search.tool_meta AS toolMeta,
        search.body
      FROM codex_sessions s
      LEFT JOIN codex_search_fts search ON search.thread_id = s.thread_id
      WHERE s.thread_id = ?
    `).get("019f-backfill-search") as Record<string, string> | undefined;
    assert.ok(row);
    assert.equal(row.searchRowid, row.sessionRowid);
    assert.match(row.title, /Backfill title lane/);
    assert.match(row.summary, /Backfill summary lane/);
    assert.match(row.plans, /Backfill plan lane/);
    assert.match(row.finals, /backfill final lane/);
    assert.match(row.touchedFiles, /packages\/core\/src\/search\.ts/);
    assert.match(row.toolMeta, /functions\.exec_command rg Backfill/);
    assert.match(row.body, /Backfill body lane/);
  } finally {
    db.close();
  }
});

test("search resolves exact thread ids and app-server display aliases without raw paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-session-discovery-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const rawPathCanary = join(sessions, "private-thread.jsonl");
  const threadPath = join(sessions, "rollout-2026-07-03T00-00-00-019f-app-alias-thread.jsonl");
  const lines = [
    {
      timestamp: "2026-07-03T00:00:00.000Z",
      session_meta: {
        payload: {
          id: "019f-app-alias-thread",
          cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator",
          model: "gpt-5.5"
        }
      }
    },
    { timestamp: "2026-07-03T00:00:01.000Z", event_msg: { type: "thread_name", name: "Indexed canonical session title" } },
    {
      timestamp: "2026-07-03T00:00:02.000Z",
      event_msg: {
        type: "agent_message",
        message: `Final: canonical session finished. Private source ${rawPathCanary} must stay hidden.`
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const readRequests: Array<{ method: string; params: Record<string, unknown> }> = [];
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    const byBareId = searchSessions(db, {
      query: "019f-app-alias-thread",
      limit: 5,
      now: "2026-07-03T00:00:05.000Z"
    });
    assert.equal(byBareId[0]?.threadId, "019f-app-alias-thread");
    assert.equal(byBareId[0]?.matchKind, "thread_id");
    assert.equal(byBareId[0]?.freshness.stale, false);

    const byRef = searchSessions(db, { query: "codex_thread:019f-app-alias-thread", limit: 5 });
    assert.equal(byRef[0]?.threadId, "019f-app-alias-thread");
    assert.equal(byRef[0]?.reasonCodes.includes("exact_thread_id"), true);

    const tools = createLooTools({
      db,
      audit: createAuditStore(join(root, "audit.jsonl")),
      codexClient: { request: async () => ({ ok: true }) },
      codexReadClient: {
        async request(method, params) {
          readRequests.push({ method, params });
          if (method === "thread/list") {
            return {
              ok: true,
              result: {
                data: [{
                  id: "019f-app-alias-thread",
                  name: "Indexed canonical session title",
                  displayName: "EVA-LCO",
                  titleAliases: ["EVA-LCO", `${rawPathCanary} sk-test_1234567890`],
                  updatedAt: 1783036802,
                  status: { type: "active" }
                }]
              },
              notifications: []
            };
          }
          throw new Error(`unexpected read method ${method}`);
        }
      }
    });

    const searchTool = tools.find((tool) => tool.name === "loo_search_sessions");
    assert.ok(searchTool);
    const byAlias = await searchTool.execute({
      query: "EVA-LCO",
      limit: 5,
      include_app_server: true
    }) as Array<ReturnType<typeof searchSessions>[number]>;

    assert.equal(byAlias[0]?.threadId, "019f-app-alias-thread");
    assert.equal(byAlias[0]?.matchKind, "app_server_alias");
    assert.equal(byAlias[0]?.reasonCodes.includes("app_server_alias"), true);
    assert.equal(byAlias[0]?.snippet, "App-server alias: EVA-LCO");
    assert.deepEqual(readRequests.map((request) => request.method), ["thread/list"]);
    assert.doesNotMatch(JSON.stringify(byAlias), /private-thread|sk-test_1234567890|\/Volumes\/LEXAR/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("search resolves one-shot thread title finalizer aliases without raw transcript reads", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-title-finalizer-search-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const rawPathCanary = join(sessions, "private-title-thread.jsonl");
  const threadPath = join(sessions, "rollout-2026-07-05T00-00-00-019f-title-finalizer-search.jsonl");
  const lines = [
    {
      timestamp: "2026-07-05T00:00:00.000Z",
      session_meta: {
        payload: {
          id: "019f-title-finalizer-search",
          cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator",
          model: "gpt-5.5"
        }
      }
    },
    { timestamp: "2026-07-05T00:00:01.000Z", event_msg: { type: "thread_name", name: "how do you name threads when you create a new thread under..." } },
    {
      timestamp: "2026-07-05T00:00:02.000Z",
      event_msg: {
        type: "agent_message",
        message: `Final: implemented the Codex thread title finalizer hook for LCO indexing. Private source ${rawPathCanary} must stay hidden.`
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    const report = captureThreadTitleFinalizerHookPacket(db, {
      thread_id: "019f-title-finalizer-search",
      cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator",
      current_title: "how do you name threads when you create a new thread under...",
      last_assistant_message: "Implemented the Codex thread title finalizer hook for LCO indexing."
    });
    const matches = searchSessions(db, {
      query: "Codex thread title finalizer",
      limit: 5,
      now: "2026-07-05T00:00:05.000Z"
    });

    assert.equal(report.aliasInserted, true);
    assert.equal(matches[0]?.threadId, "019f-title-finalizer-search");
    assert.equal(matches[0]?.matchKind, "full_text");
    assert.equal(matches[0]?.reasonCodes.includes("thread_title_finalizer_alias"), true);
    assert.notEqual(matches[0]?.snippet, "Thread title alias: lossless-openclaw-orchestrator: Codex thread title finalizer");
    assert.equal(matches[0]?.title, "how do you name threads when you create a new thread under...");
    assert.doesNotMatch(JSON.stringify(matches), /private-title-thread|\/Volumes\/LEXAR/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("thread title aliases do not crowd out precise FTS matches for broad one-token queries", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-title-alias-broad-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    captureThreadTitleFinalizerHookPacket(db, {
      thread_id: "019f-alias-only",
      cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator",
      current_title: "ambiguous title",
      last_assistant_message: "Implemented the Codex thread title finalizer hook for LCO indexing."
    });

    const broad = searchSessions(db, {
      query: "codex",
      limit: 5,
      now: "2026-07-05T00:00:05.000Z"
    });
    const specific = searchSessions(db, {
      query: "thread finalizer",
      limit: 5,
      now: "2026-07-05T00:00:05.000Z"
    });

    assert.deepEqual(broad, []);
    assert.equal(specific[0]?.threadId, "019f-alias-only");
    assert.equal(specific[0]?.matchKind, "thread_title_alias");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy tool-call extraction recovers structured names and emits reason codes for unsupported shapes", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-legacy-tools-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-07-03T00-00-00-019f-legacy-tools.jsonl");
  const privatePath = join(sessions, "private-tool-input.txt");
  const longValue = "bounded legacy argument ".repeat(250);
  const lines = [
    { timestamp: "2026-07-03T00:00:00.000Z", session_meta: { payload: { id: "019f-legacy-tools" } } },
    {
      timestamp: "2026-07-03T00:00:01.000Z",
      response_item: {
        type: "message",
        role: "assistant",
        tool_calls: [{
          id: "legacy_openai_call",
          type: "function",
          function: {
            name: "functions.exec_command",
            arguments: JSON.stringify({
              cmd: `sed -n '1,20p' ${privatePath}`,
              token: "sk-test_1234567890abcdef",
              longValue
            })
          }
        }]
      }
    },
    {
      timestamp: "2026-07-03T00:00:02.000Z",
      response_item: {
        type: "function_call",
        call_id: "missing_name_call",
        arguments: { cmd: "echo safe missing name" }
      }
    },
    {
      timestamp: "2026-07-03T00:00:03.000Z",
      response_item: {
        type: "tool_call",
        id: "unsupported_shape_call",
        function: {}
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    const calls = getCodexToolCalls(db, { threadId: "019f-legacy-tools", limit: 10 });
    const byId = new Map(calls.map((call) => [call.callId, call]));
    assert.equal(byId.get("legacy_openai_call")?.toolName, "functions.exec_command");
    assert.equal(byId.get("legacy_openai_call")?.reasonCode, null);
    assert.match(byId.get("legacy_openai_call")?.argumentsText ?? "", /sed -n/);
    assert.match(byId.get("legacy_openai_call")?.argumentsText ?? "", /<redacted-secret>/);
    assert.equal((byId.get("legacy_openai_call")?.argumentsText.length ?? 0) <= 2000, true);
    assert.equal(byId.get("missing_name_call")?.toolName, "unknown");
    assert.equal(byId.get("missing_name_call")?.reasonCode, "missing_tool_name_source");
    assert.equal(byId.get("unsupported_shape_call")?.toolName, "unknown");
    assert.equal(byId.get("unsupported_shape_call")?.reasonCode, "unsupported_legacy_shape");
    assert.doesNotMatch(JSON.stringify(calls), /sk-test_1234567890|private-tool-input|\/Volumes\/LEXAR/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("extracts public-safe session metadata and closeout fields", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-metadata-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-29T00-00-00-019f-metadata-thread.jsonl");
  const lines = [
    {
      session_meta: {
        payload: {
          id: "019f-metadata-thread",
          cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator",
          model: "gpt-5.5",
          git: { branch: "issue-49-session-metadata-closeout", commit_hash: "def5678" }
        }
      }
    },
    { event_msg: { type: "thread_name", name: "Session metadata closeout schema" } },
    {
      response_item: {
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: "<proposed_plan>\n# Session metadata\nExtract public-safe closeout fields.\n</proposed_plan>"
        }]
      }
    },
    {
      event_msg: {
        type: "agent_message",
        message: [
          "Closeout state: blocked",
          "- Project: lossless-openclaw-orchestrator",
          "- Status: external-review-wait",
          "- Priority: high",
          "- Owner: codex",
          "- Blocker: CodeRabbit approval pending",
          "- Next action: re-check PR gate",
          "- Proposed plan refs: codex_event:plan-1",
          "- Final-message refs: codex_event:final-1",
          "- Touched-file refs: codex_event:file-1",
          "- Source refs: codex_thread:019f-metadata-thread"
        ].join("\n")
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    const description = describeSession(db, "019f-metadata-thread");
    assert.deepEqual(description?.metadata, {
      project: "lossless-openclaw-orchestrator",
      status: "external-review-wait",
      priority: "high",
      owner: "codex",
      blocker: "CodeRabbit approval pending",
      nextAction: "re-check PR gate",
      closeoutState: "blocked",
      planCompletionState: null,
      proposedPlanRefs: ["codex_event:plan-1"],
      finalMessageRefs: ["codex_event:final-1"],
      touchedFileRefs: ["codex_event:file-1"],
      sourceRefs: ["codex_thread:019f-metadata-thread"]
    });

    const [threadMapEntry] = getCodexThreadMap(db, { limit: 10 });
    assert.equal(threadMapEntry?.metadata.status, "external-review-wait");
    assert.equal(threadMapEntry?.metadata.nextAction, "re-check PR gate");

    const recallDescription = describeRecallRef(db, { sourceRef: "codex_thread:019f-metadata-thread" });
    assert.deepEqual(recallDescription?.metadata, description?.metadata);

    const expanded = expandSession(db, { threadId: "019f-metadata-thread", profile: "metadata" });
    assert.equal(expanded.text.includes("Project: lossless-openclaw-orchestrator"), true);
    assert.equal(expanded.text.includes("Blocker: CodeRabbit approval pending"), true);
    assert.equal(expanded.text.includes("Next action: re-check PR gate"), true);
    assert.equal(expanded.text.includes("Proposed plan refs: codex_event:plan-1"), true);
    assert.equal(expanded.text.includes("Final-message refs: codex_event:final-1"), true);
    assert.equal(expanded.text.includes("Touched-file refs: codex_event:file-1"), true);
    assert.equal(expanded.text.includes("Source refs: codex_thread:019f-metadata-thread"), true);
    const brief = expandSession(db, { threadId: "019f-metadata-thread", profile: "brief" });
    const evidence = expandSession(db, { threadId: "019f-metadata-thread", profile: "evidence" });
    assert.equal(brief.text.includes("\nProject: lossless-openclaw-orchestrator"), false);
    assert.equal(evidence.text.includes("\nProject: lossless-openclaw-orchestrator"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("backfills session metadata when unchanged source files were already indexed", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-metadata-backfill-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-29T00-00-00-019f-backfill-thread.jsonl");
  const lines = [
    { session_meta: { payload: { id: "019f-backfill-thread", cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator" } } },
    { event_msg: { type: "thread_name", name: "Metadata backfill" } },
    {
      event_msg: {
        type: "agent_message",
        message: [
          "Closeout state: complete",
          "- Project: lossless-openclaw-orchestrator",
          "- Status: merged",
          "- Next action: continue next eval lane"
        ].join("\n")
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    db.prepare("DELETE FROM codex_session_metadata WHERE thread_id = ?").run("019f-backfill-thread");
    db.prepare("UPDATE codex_source_files SET metadata_extractor_version = NULL WHERE source_path = ?").run(threadPath);

    const result = indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.equal(result.errors.length, 0);
    assert.equal(describeSession(db, "019f-backfill-thread")?.metadata.status, "merged");
    assert.equal(describeSession(db, "019f-backfill-thread")?.metadata.nextAction, "continue next eval lane");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("extracts newline-only closeout labels before safe text normalization", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-metadata-newlines-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-29T00-00-00-019f-newline-thread.jsonl");
  const lines = [
    { session_meta: { payload: { id: "019f-newline-thread", cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator" } } },
    { event_msg: { type: "thread_name", name: "Newline closeout labels" } },
    {
      event_msg: {
        type: "agent_message",
        message: [
          "Project: lossless-openclaw-orchestrator",
          "Status: external-review-wait",
          "Priority: high",
          "Owner: codex",
          "Blocker: CodeRabbit approval pending",
          "Next action: re-check PR gate",
          "Closeout state: blocked",
          "Source refs: codex_thread:019f-newline-thread"
        ].join("\n")
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.deepEqual(describeSession(db, "019f-newline-thread")?.metadata, {
      project: "lossless-openclaw-orchestrator",
      status: "external-review-wait",
      priority: "high",
      owner: "codex",
      blocker: "CodeRabbit approval pending",
      nextAction: "re-check PR gate",
      closeoutState: "blocked",
      planCompletionState: null,
      proposedPlanRefs: [],
      finalMessageRefs: [],
      touchedFileRefs: [],
      sourceRefs: ["codex_thread:019f-newline-thread"]
    });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses the latest closeout metadata when sessions revise status", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-metadata-latest-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-29T00-00-00-019f-latest-thread.jsonl");
  const lines = [
    { session_meta: { payload: { id: "019f-latest-thread", cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator" } } },
    { event_msg: { type: "thread_name", name: "Latest closeout labels" } },
    {
      event_msg: {
        type: "agent_message",
        message: [
          "Project: lossless-openclaw-orchestrator",
          "Status: in-progress",
          "Blocker: CodeRabbit review pending",
          "Next action: patch implementation"
        ].join("\n")
      }
    },
    {
      event_msg: {
        type: "agent_message",
        message: [
          "Project: lossless-openclaw-orchestrator",
          "Status: complete",
          "Blocker: none",
          "Next action: merge after review",
          "Closeout state: ready"
        ].join("\n")
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const metadata = describeSession(db, "019f-latest-thread")?.metadata;
    assert.equal(metadata?.status, "complete");
    assert.equal(metadata?.blocker, null);
    assert.equal(metadata?.nextAction, "merge after review");
    assert.equal(metadata?.closeoutState, "ready");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("thread map filters and ranks by session metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-thread-map-metadata-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const fixtures = [
    {
      id: "019f-map-low",
      title: "Low priority metadata",
      status: "blocked",
      priority: "low",
      blocker: "waiting on docs",
      nextAction: "document gap"
    },
    {
      id: "019f-map-high",
      title: "High priority metadata",
      status: "blocked",
      priority: "high",
      blocker: "CodeRabbit approval pending",
      nextAction: "patch review"
    },
    {
      id: "019f-map-open",
      title: "Open metadata",
      status: "ready",
      priority: "medium",
      blocker: "none",
      nextAction: "merge after review"
    },
    {
      id: "019f-map-escaped-blocker",
      title: "Escaped blocker metadata",
      status: "blocked",
      priority: "medium",
      blocker: "100% ci_required",
      nextAction: "fix escaped blocker query"
    }
  ];
  for (const fixture of fixtures) {
    const threadPath = join(sessions, `rollout-2026-06-29T00-00-00-${fixture.id}.jsonl`);
    const lines = [
      { session_meta: { payload: { id: fixture.id, cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator" } } },
      { event_msg: { type: "thread_name", name: fixture.title } },
      {
        event_msg: {
          type: "agent_message",
          message: [
            "Project: lossless-openclaw-orchestrator",
            `Status: ${fixture.status}`,
            `Priority: ${fixture.priority}`,
            `Blocker: ${fixture.blocker}`,
            `Next action: ${fixture.nextAction}`
          ].join("\n")
        }
      }
    ];
    writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  }

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const blocked = getCodexThreadMap(db, {
      limit: 10,
      project: "lossless-openclaw-orchestrator",
      status: "blocked",
      priorityOrder: ["high", "medium", "low"]
    });

    assert.deepEqual(blocked.map((entry) => entry.threadId), ["019f-map-high", "019f-map-escaped-blocker", "019f-map-low"]);
    assert.equal(blocked[0]?.metadata.priority, "high");

    const blockerMatches = getCodexThreadMap(db, { limit: 10, blocker: "coderabbit" });
    assert.deepEqual(blockerMatches.map((entry) => entry.threadId), ["019f-map-high"]);

    const escapedBlockerMatches = getCodexThreadMap(db, { limit: 10, blocker: "100% ci_required" });
    assert.deepEqual(escapedBlockerMatches.map((entry) => entry.threadId), ["019f-map-escaped-blocker"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("preserves percent-encoded source refs and avoids false label splits", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-metadata-ref-parser-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-29T00-00-00-019f-ref-parser-thread.jsonl");
  const lines = [
    { session_meta: { payload: { id: "019f-ref-parser-thread", cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator" } } },
    { event_msg: { type: "thread_name", name: "Ref parser metadata" } },
    {
      event_msg: {
        type: "agent_message",
        message: [
          "Project: lossless-openclaw-orchestrator",
          "Blocker: waiting for CI status: required check pending",
          "Source refs: lcm_summary:abc123:folder%2Fsummary%20one"
        ].join("\n")
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const metadata = describeSession(db, "019f-ref-parser-thread")?.metadata;
    assert.equal(metadata?.blocker, "waiting for CI status: required check pending");
    assert.equal(metadata?.status, null);
    assert.deepEqual(metadata?.sourceRefs, ["lcm_summary:abc123:folder%2Fsummary%20one"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("indexes source paths for metadata backfill checks", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-source-path-index-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const indexes = db.prepare("PRAGMA index_list(codex_sessions)").all() as Array<{ name: string }>;
    assert.equal(indexes.some((row) => row.name === "codex_sessions_source_path_idx"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("bounded expansion keeps proposed plans and touched files visible when final message is long", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-long-final-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-28T00-00-00-019f-long-final.jsonl");
  const lines = [
    { session_meta: { payload: { id: "019f-long-final", cwd: "/Volumes/LEXAR/repos/example" } } },
    { event_msg: { type: "thread_name", name: "Long final expansion" } },
    {
      response_item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "<proposed_plan>\n1. Keep the plan visible.\n</proposed_plan>" }]
      }
    },
    {
      response_item: {
        type: "function_call",
        call_id: "call_long",
        name: "functions.exec_command",
        arguments: JSON.stringify({
          cmd: [
            "sed -n '1,20p' /Volumes/LEXAR/repos/example/src/expansion.ts",
            "cat /Users/lume/.codex/sessions/private-thread.jsonl",
            "cat /private/tmp/lco/private-cache.sqlite",
            ...Array.from({ length: 12 }, (_, index) => `/Volumes/LEXAR/repos/example/packages/really-long-path-segment-${index}/nested/with/many/directories/for/expansion-${index}.ts`)
          ].join(" ")
        })
      }
    },
    {
      event_msg: {
        type: "agent_message",
        message: [
          "Final:",
          "/Volumes/My Backup Drive/lco/private secret.ts",
          "/Users/lume/User Projects/lco/private secret.ts",
          "/home/lume/work/private-cache.sqlite",
          "/var/folders/lco/private-cache.sqlite",
          "/root/.codex/sessions/private-thread.jsonl",
          "~/.codex/sessions/private-thread.jsonl",
          "long final evidence ".repeat(500)
        ].join(" ")
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    const expanded = expandSession(db, { threadId: "019f-long-final", profile: "brief" });

    assert.equal(expanded.text.includes("Final message:"), true);
    assert.equal(expanded.text.includes("Touched files:"), true);
    assert.equal(expanded.text.includes("<redacted-path>"), true);
    assert.equal(expanded.text.includes("/Volumes/"), false);
    assert.equal(expanded.text.includes("/Users/"), false);
    assert.equal(expanded.text.includes("/home/"), false);
    assert.equal(expanded.text.includes("/var/"), false);
    assert.equal(expanded.text.includes("/root/.codex/"), false);
    assert.equal(expanded.text.includes("~/.codex/"), false);
    assert.equal(expanded.text.includes("/private/tmp/"), false);
    assert.equal(expanded.text.includes(".codex/sessions"), false);
    assert.equal(expanded.text.includes("Backup Drive"), false);
    assert.equal(expanded.text.includes("User Projects"), false);
    assert.equal(expanded.text.includes("more touched files omitted"), true);
    const touchedBlock = expanded.text.match(/Touched files:\n(?<block>[\s\S]*?)\n\nPlans:/)?.groups?.block ?? "";
    const renderedFiles = touchedBlock.split("\n").filter((line) => line.startsWith("- ") && !line.startsWith("- ... ")).length;
    const omittedFiles = Number(touchedBlock.match(/- \.\.\. (?<count>\d+) more touched files omitted/)?.groups?.count ?? 0);
    assert.equal(renderedFiles + omittedFiles, getCodexTouchedFiles(db, { threadId: "019f-long-final" }).length);
    assert.equal(expanded.text.length <= 4000, true);
    assert.equal(expanded.text.includes("Plans:"), true);
    assert.equal(expanded.text.includes("Keep the plan visible"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
