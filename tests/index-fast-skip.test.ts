import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabase,
  describeSession,
  indexCodexSessions,
  searchSessions,
  type LooDatabase
} from "../packages/core/src/index.js";
import {
  writeSyntheticCodexCorpus,
  writeSyntheticCodexSession
} from "./helpers/synthetic-codex.js";

type IndexSnapshot = {
  sessions: number;
  safeTextRows: number;
  searchRows: number;
  sourceFiles: number;
  preparedSourceRanges: number;
  summaryLeaves: number;
  preparedCards: number;
  preparedInboxItems: number;
};

function indexSnapshot(db: LooDatabase): IndexSnapshot {
  return {
    sessions: countRows(db, "codex_sessions"),
    safeTextRows: countRows(db, "codex_safe_text_fts"),
    searchRows: countRows(db, "codex_search_fts"),
    sourceFiles: countRows(db, "codex_source_files"),
    preparedSourceRanges: countRows(db, "prepared_source_ranges"),
    summaryLeaves: countRows(db, "summary_leaves"),
    preparedCards: countRows(db, "prepared_cards"),
    preparedInboxItems: countRows(db, "prepared_inbox_items")
  };
}

function countRows(db: LooDatabase, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function preparedCounts(db: LooDatabase, threadId: string): { events: number; ranges: number; leaves: number; cards: number; inbox: number } {
  return {
    events: Number((db.prepare("SELECT COUNT(*) AS count FROM prepared_source_events WHERE thread_id = ?").get(threadId) as { count: number }).count),
    ranges: Number((db.prepare("SELECT COUNT(*) AS count FROM prepared_source_ranges WHERE thread_id = ?").get(threadId) as { count: number }).count),
    leaves: Number((db.prepare("SELECT COUNT(*) AS count FROM summary_leaves WHERE thread_id = ?").get(threadId) as { count: number }).count),
    cards: Number((db.prepare("SELECT COUNT(*) AS count FROM prepared_cards WHERE target_ref = ?").get(`codex_thread:${threadId}`) as { count: number }).count),
    inbox: Number((db.prepare("SELECT COUNT(*) AS count FROM prepared_inbox_items WHERE target_ref = ?").get(`codex_thread:${threadId}`) as { count: number }).count)
  };
}

function preparedRangeSnapshot(db: LooDatabase, threadId: string): Array<{ rangeRef: string; eventRef: string; sourceHash: string; rangeKind: string; lineStart: number; byteStart: number; ordinal: number }> {
  return db.prepare(`
    SELECT
      range_ref AS rangeRef,
      event_ref AS eventRef,
      source_hash AS sourceHash,
      range_kind AS rangeKind,
      line_start AS lineStart,
      byte_start AS byteStart,
      ordinal
    FROM prepared_source_ranges
    WHERE thread_id = ?
    ORDER BY ordinal ASC, range_ref ASC
  `).all(threadId) as Array<{ rangeRef: string; eventRef: string; sourceHash: string; rangeKind: string; lineStart: number; byteStart: number; ordinal: number }>;
}

function sessionEventCount(db: LooDatabase, threadId: string): number {
  return Number((db.prepare("SELECT event_count AS eventCount FROM codex_sessions WHERE thread_id = ?").get(threadId) as { eventCount: number } | undefined)?.eventCount ?? 0);
}

function toolCallIds(db: LooDatabase, threadId: string): string[] {
  return (db.prepare("SELECT call_id AS callId FROM codex_tool_calls WHERE thread_id = ? ORDER BY rowid ASC").all(threadId) as Array<{ callId: string }>).map((row) => row.callId);
}

function countOrphanFtsRows(db: LooDatabase, table: "codex_safe_text_fts" | "codex_search_fts"): number {
  return Number((db.prepare(`
    SELECT COUNT(*) AS count
    FROM ${table} fts
    LEFT JOIN codex_sessions s ON s.rowid = fts.rowid
    WHERE s.rowid IS NULL
  `).get() as { count: number }).count);
}

function ftsRowIds(db: LooDatabase, threadId: string): { sessionRowid: number; safeTextRowid: number | null; searchRowid: number | null } {
  return db.prepare(`
    SELECT
      s.rowid AS sessionRowid,
      safe.rowid AS safeTextRowid,
      search.rowid AS searchRowid
    FROM codex_sessions s
    LEFT JOIN codex_safe_text_fts safe ON safe.thread_id = s.thread_id
    LEFT JOIN codex_search_fts search ON search.thread_id = s.thread_id
    WHERE s.thread_id = ?
  `).get(threadId) as { sessionRowid: number; safeTextRowid: number | null; searchRowid: number | null };
}

function capturePreparedSql(db: LooDatabase): { statements: string[]; restore: () => void } {
  const statements: string[] = [];
  const originalPrepare = db.prepare;
  (db as unknown as { prepare: LooDatabase["prepare"] }).prepare = ((sql: string) => {
    statements.push(sql.replace(/\s+/g, " ").trim());
    return originalPrepare.call(db, sql);
  }) as LooDatabase["prepare"];
  return {
    statements,
    restore: () => {
      (db as unknown as { prepare: LooDatabase["prepare"] }).prepare = originalPrepare;
    }
  };
}

test("unchanged fast-skip and verify reindex preserve equivalent derived state", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-fast-skip-parity-"));
  try {
    const corpus = writeSyntheticCodexCorpus(root, 3);
    const fastDb = createDatabase(join(root, "fast.sqlite"));
    const verifyDb = createDatabase(join(root, "verify.sqlite"));
    try {
      assert.equal(indexCodexSessions(fastDb, { roots: [corpus.sessionsDir], maxFiles: 10 }).indexedFiles, 3);
      assert.equal(indexCodexSessions(verifyDb, { roots: [corpus.sessionsDir], maxFiles: 10 }).indexedFiles, 3);

      const fast = indexCodexSessions(fastDb, { roots: [corpus.sessionsDir], maxFiles: 10 });
      const verify = indexCodexSessions(verifyDb, { roots: [corpus.sessionsDir], maxFiles: 10, verify: true });

      assert.equal(fast.indexedFiles, 0);
      assert.equal(fast.skippedFiles, 3);
      assert.equal(verify.errors.length, 0);
      assert.deepEqual(indexSnapshot(fastDb), indexSnapshot(verifyDb));
    } finally {
      fastDb.close();
      verifyDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FTS rowids stay pinned to session rowids after verified reindex", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-rowid-pinned-fts-"));
  try {
    const sessionsDir = join(root, "sessions");
    const firstFile = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-rowid-first.jsonl");
    const secondFile = join(sessionsDir, "rollout-2026-07-06T00-00-01-019f-rowid-second.jsonl");
    writeSyntheticCodexSession(firstFile, {
      threadId: "019f-rowid-first",
      title: "Rowid obsolete alpha marker",
      finalMessage: "Final: rowid obsolete alpha marker complete. Next action: benchmark."
    });
    writeSyntheticCodexSession(secondFile, {
      threadId: "019f-rowid-second",
      title: "Rowid second version",
      finalMessage: "Final: rowid second version complete. Next action: benchmark."
    });

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 2);
      const before = ftsRowIds(db, "019f-rowid-first");
      assert.equal(before.safeTextRowid, before.sessionRowid);
      assert.equal(before.searchRowid, before.sessionRowid);

      writeSyntheticCodexSession(firstFile, {
        threadId: "019f-rowid-first",
        title: "Rowid first verified update",
        finalMessage: "Final: rowid first verified update complete. Next action: benchmark."
      });

      const preparedSql = capturePreparedSql(db);
      let verified: ReturnType<typeof indexCodexSessions>;
      try {
        verified = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10, verify: true });
      } finally {
        preparedSql.restore();
      }
      assert.equal(verified.indexedFiles, 1);
      assert.equal(countRows(db, "codex_sessions"), 2);
      assert.equal(countRows(db, "codex_safe_text_fts"), 2);
      assert.equal(countRows(db, "codex_search_fts"), 2);
      assert.deepEqual(preparedSql.statements.filter((sql) => /DELETE FROM codex_(?:safe_text|search)_fts WHERE thread_id = \?/i.test(sql)), []);

      const after = ftsRowIds(db, "019f-rowid-first");
      assert.equal(after.safeTextRowid, after.sessionRowid);
      assert.equal(after.searchRowid, after.sessionRowid);
      assert.equal(describeSession(db, "019f-rowid-first")?.title, "Rowid first verified update");
      assert.equal(searchSessions(db, { query: "verified update", limit: 5 })[0]?.threadId, "019f-rowid-first");
      const ftsPayload = db.prepare(`
        SELECT
          search.title AS searchTitle,
          search.finals AS searchFinals,
          search.body AS searchBody,
          safe.content AS safeText
        FROM codex_sessions s
        JOIN codex_search_fts search ON search.rowid = s.rowid
        JOIN codex_safe_text_fts safe ON safe.rowid = s.rowid
        WHERE s.thread_id = ?
      `).get("019f-rowid-first") as { searchTitle: string; searchFinals: string; searchBody: string; safeText: string };
      assert.equal(Object.values(ftsPayload).some((value) => value.includes("obsolete alpha marker")), false);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("thread-id remap on the same source path removes stale rowid-pinned FTS rows", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-rowid-remap-cleanup-"));
  try {
    const sessionsDir = join(root, "sessions");
    const file = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-rowid-remap.jsonl");
    writeSyntheticCodexSession(file, {
      threadId: "019f-rowid-remap-old",
      title: "Rowid old remap marker",
      finalMessage: "Final: rowid old remap marker complete. Next action: replace."
    });

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      assert.equal(countRows(db, "codex_sessions"), 1);
      assert.equal(countRows(db, "codex_safe_text_fts"), 1);
      assert.equal(countRows(db, "codex_search_fts"), 1);

      writeSyntheticCodexSession(file, {
        threadId: "019f-rowid-remap-new",
        title: "Rowid new remap marker",
        finalMessage: "Final: rowid new remap marker complete. Next action: keep."
      });

      const verified = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10, verify: true });
      assert.equal(verified.indexedFiles, 1);
      assert.equal(countRows(db, "codex_sessions"), 1);
      assert.equal(countRows(db, "codex_safe_text_fts"), 1);
      assert.equal(countRows(db, "codex_search_fts"), 1);
      assert.equal(countOrphanFtsRows(db, "codex_safe_text_fts"), 0);
      assert.equal(countOrphanFtsRows(db, "codex_search_fts"), 0);
      assert.equal(describeSession(db, "019f-rowid-remap-old"), null);

      const after = ftsRowIds(db, "019f-rowid-remap-new");
      assert.equal(after.safeTextRowid, after.sessionRowid);
      assert.equal(after.searchRowid, after.sessionRowid);
      assert.equal(searchSessions(db, { query: "old remap marker", limit: 5 }).some((row) => row.threadId === "019f-rowid-remap-old"), false);
      assert.equal(searchSessions(db, { query: "new remap marker", limit: 5 })[0]?.threadId, "019f-rowid-remap-new");
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("append-only session updates use delta indexing and match full reparse public state", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-append-delta-index-"));
  try {
    const sessionsDir = join(root, "sessions");
    const file = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-append-delta.jsonl");
    const threadId = "019f-append-delta";
    writeSyntheticCodexSession(file, {
      threadId,
      title: "Append delta initial title",
      finalMessage: "Final: append delta initial marker complete. Next action: append."
    });
    appendFileSync(file, "\n");
    const deltaDb = createDatabase(join(root, "delta.sqlite"));
    const fullDb = createDatabase(join(root, "full.sqlite"));
    try {
      assert.equal(indexCodexSessions(deltaDb, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      appendFileSync(file, [
        JSON.stringify({
          timestamp: "2026-07-06T00:00:10.000Z",
          event_msg: { type: "thread_name", name: "Append delta updated title" }
        }),
        JSON.stringify({
          timestamp: "2026-07-06T00:00:11.000Z",
          response_item: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Final: appended delta marker complete. Next action: keep indexing fast." }]
          }
        }),
        ""
      ].join("\n"));

      const delta = indexCodexSessions(deltaDb, { roots: [sessionsDir], maxFiles: 10 }) as ReturnType<typeof indexCodexSessions> & { appendDeltaIndexedFiles?: number };
      const full = indexCodexSessions(fullDb, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(delta.indexedFiles, 1);
      assert.equal(delta.appendDeltaIndexedFiles, 1);
      assert.equal(delta.indexedEvents, 2);
      assert.equal(full.indexedFiles, 1);
      assert.equal(full.indexedEvents, 7);

      const deltaDescription = describeSession(deltaDb, threadId);
      const fullDescription = describeSession(fullDb, threadId);
      assert.ok(deltaDescription);
      assert.ok(fullDescription);
      assert.equal(deltaDescription.title, fullDescription.title);
      assert.equal(deltaDescription.finalMessage, fullDescription.finalMessage);
      assert.equal(sessionEventCount(deltaDb, threadId), sessionEventCount(fullDb, threadId));
      assert.equal(deltaDescription.toolCallCount, fullDescription.toolCallCount);
      assert.deepEqual(preparedCounts(deltaDb, threadId), preparedCounts(fullDb, threadId));
      assert.deepEqual(preparedRangeSnapshot(deltaDb, threadId), preparedRangeSnapshot(fullDb, threadId));
      assert.equal(searchSessions(deltaDb, { query: "appended delta marker", limit: 5 })[0]?.threadId, threadId);
      assert.equal(searchSessions(fullDb, { query: "appended delta marker", limit: 5 })[0]?.threadId, threadId);
    } finally {
      deltaDb.close();
      fullDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("append-delta falls back to full reparse when the indexed prefix changes", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-append-delta-prefix-rewrite-"));
  try {
    const sessionsDir = join(root, "sessions");
    const file = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-prefix-rewrite.jsonl");
    const threadId = "019f-prefix-rewrite";
    writeSyntheticCodexSession(file, {
      threadId,
      title: "Prefix rewrite original",
      finalMessage: "Final: prefix rewrite original complete. Next action: rewrite."
    });

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      writeSyntheticCodexSession(file, {
        threadId,
        title: "Prefix rewrite changed",
        finalMessage: "Final: prefix rewrite changed complete. Next action: full reparse."
      });
      appendFileSync(file, `${JSON.stringify({
        timestamp: "2026-07-06T00:00:20.000Z",
        response_item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Final: prefix mismatch append complete. Next action: keep correctness." }]
        }
      })}\n`);

      const result = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(result.indexedFiles, 1);
      assert.equal(result.appendDeltaIndexedFiles, 0);
      assert.equal(describeSession(db, threadId)?.title, "Prefix rewrite changed");
      assert.equal(searchSessions(db, { query: "prefix mismatch append", limit: 5 })[0]?.threadId, threadId);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("append-delta falls back to full reparse when the indexed prefix has drift", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-append-delta-drift-fallback-"));
  try {
    const sessionsDir = join(root, "sessions");
    const file = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-drift-fallback.jsonl");
    const threadId = "019f-drift-fallback";
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(file, `not-json\n${JSON.stringify({
      timestamp: "2026-07-06T00:00:00.000Z",
      session_meta: { payload: { id: threadId, cwd: "/Volumes/LEXAR/repos/example", model: "gpt-5.5" } }
    })}\n${JSON.stringify({
      timestamp: "2026-07-06T00:00:01.000Z",
      event_msg: { type: "thread_name", name: "Drift fallback title" }
    })}\n`);

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const first = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(first.indexedFiles, 1);
      assert.equal(first.driftSummary.unparsedLines, 1);
      appendFileSync(file, `${JSON.stringify({
        timestamp: "2026-07-06T00:00:02.000Z",
        response_item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Final: drift fallback append complete. Next action: full reparse." }]
        }
      })}\n`);

      const result = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(result.indexedFiles, 1);
      assert.equal(result.appendDeltaIndexedFiles, 0);
      assert.equal(result.driftSummary.unparsedLines, 1);
      assert.equal(searchSessions(db, { query: "drift fallback append", limit: 5 })[0]?.threadId, threadId);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("append-delta uses global ordinals for fallback tool-call ids", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-append-delta-tool-ordinal-"));
  try {
    const sessionsDir = join(root, "sessions");
    const file = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-tool-ordinal.jsonl");
    const threadId = "019f-tool-ordinal";
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(file, [
      JSON.stringify({
        timestamp: "2026-07-06T00:00:00.000Z",
        session_meta: { payload: { id: threadId, cwd: "/Volumes/LEXAR/repos/example", model: "gpt-5.5" } }
      }),
      JSON.stringify({
        timestamp: "2026-07-06T00:00:01.000Z",
        response_item: { type: "function_call", name: "functions.exec_command", arguments: "{\"cmd\":\"date\"}" }
      }),
      ""
    ].join("\n"));

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      appendFileSync(file, `${JSON.stringify({
        timestamp: "2026-07-06T00:00:02.000Z",
        response_item: { type: "function_call", name: "functions.exec_command", arguments: "{\"cmd\":\"pwd\"}" }
      })}\n`);

      const result = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(result.indexedFiles, 1);
      assert.equal(result.appendDeltaIndexedFiles, 1);
      const callIds = toolCallIds(db, threadId);
      assert.equal(callIds.length, 2);
      assert.equal(new Set(callIds).size, 2);
      assert.equal(describeSession(db, threadId)?.toolCallCount, 2);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("append-delta falls back to full reparse when prepared source event count drifts", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-append-delta-prepared-count-drift-"));
  try {
    const sessionsDir = join(root, "sessions");
    const file = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-prepared-count-drift.jsonl");
    const threadId = "019f-prepared-count-drift";
    writeSyntheticCodexSession(file, {
      threadId,
      title: "Prepared count drift title",
      finalMessage: "Final: prepared count drift initial complete. Next action: repair."
    });

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      const before = preparedCounts(db, threadId);
      assert.ok(before.events > 1);
      const orphaned = db.prepare(`
        SELECT event_ref AS eventRef
        FROM prepared_source_events
        WHERE thread_id = ?
        ORDER BY ordinal ASC
        LIMIT 1
      `).get(threadId) as { eventRef: string };
      db.prepare("DELETE FROM prepared_source_ranges WHERE event_ref = ?").run(orphaned.eventRef);
      db.prepare("DELETE FROM prepared_source_events WHERE event_ref = ?").run(orphaned.eventRef);
      assert.equal(preparedCounts(db, threadId).events, before.events - 1);

      appendFileSync(file, `${JSON.stringify({
        timestamp: "2026-07-06T00:00:03.000Z",
        response_item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Final: prepared count drift append complete. Next action: full reparse." }]
        }
      })}\n`);

      const result = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(result.indexedFiles, 1);
      assert.equal(result.appendDeltaIndexedFiles, 0);
      assert.equal(preparedCounts(db, threadId).events, sessionEventCount(db, threadId));
      assert.equal(searchSessions(db, { query: "prepared count drift append", limit: 5 })[0]?.threadId, threadId);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("append-delta falls back to full reparse when appended tail contains malformed JSONL", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-append-delta-malformed-tail-"));
  try {
    const sessionsDir = join(root, "sessions");
    const file = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-malformed-tail.jsonl");
    const threadId = "019f-malformed-tail";
    writeSyntheticCodexSession(file, {
      threadId,
      title: "Malformed tail fallback title",
      finalMessage: "Final: malformed tail fallback initial complete. Next action: append."
    });

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      appendFileSync(file, [
        "not-json",
        JSON.stringify({
          timestamp: "2026-07-06T00:00:03.000Z",
          response_item: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Final: malformed tail append marker complete. Next action: full reparse." }]
          }
        }),
        ""
      ].join("\n"));

      const result = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(result.indexedFiles, 1);
      assert.equal(result.appendDeltaIndexedFiles, 0);
      assert.equal(result.driftSummary.unparsedLines, 1);
      assert.equal(searchSessions(db, { query: "malformed tail append marker", limit: 5 })[0]?.threadId, threadId);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("append-delta preserves stable explicit title and final when appended tail has no explicit replacements", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-append-delta-stable-title-final-"));
  try {
    const sessionsDir = join(root, "sessions");
    const file = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-stable-title-final.jsonl");
    const threadId = "019f-stable-title-final";
    writeSyntheticCodexSession(file, {
      threadId,
      title: "Stable explicit thread title",
      finalMessage: "Final: stable explicit final marker complete. Next action: preserve."
    });
    const deltaDb = createDatabase(join(root, "delta.sqlite"));
    const fullDb = createDatabase(join(root, "full.sqlite"));
    try {
      assert.equal(indexCodexSessions(deltaDb, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      appendFileSync(file, `${JSON.stringify({
        timestamp: "2026-07-06T00:00:20.000Z",
        response_item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Intermediate progress note only." }]
        }
      })}\n`);

      const delta = indexCodexSessions(deltaDb, { roots: [sessionsDir], maxFiles: 10 });
      const full = indexCodexSessions(fullDb, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(delta.appendDeltaIndexedFiles, 1);
      assert.equal(full.appendDeltaIndexedFiles, 0);
      assert.equal(describeSession(deltaDb, threadId)?.title, describeSession(fullDb, threadId)?.title);
      assert.equal(describeSession(deltaDb, threadId)?.finalMessage, describeSession(fullDb, threadId)?.finalMessage);
      assert.equal(describeSession(deltaDb, threadId)?.title, "Stable explicit thread title");
      assert.equal(describeSession(deltaDb, threadId)?.finalMessage, "Final: stable explicit final marker complete. Next action: preserve.");
    } finally {
      deltaDb.close();
      fullDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("append-delta applies explicit metadata clears such as Blocker none", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-append-delta-metadata-clear-"));
  try {
    const sessionsDir = join(root, "sessions");
    const file = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-metadata-clear.jsonl");
    const threadId = "019f-metadata-clear";
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(file, [
      JSON.stringify({
        timestamp: "2026-07-06T00:00:00.000Z",
        session_meta: { payload: { id: threadId, cwd: "/Volumes/LEXAR/repos/example", model: "gpt-5.5" } }
      }),
      JSON.stringify({
        timestamp: "2026-07-06T00:00:01.000Z",
        event_msg: { type: "thread_name", name: "Metadata clear title" }
      }),
      JSON.stringify({
        timestamp: "2026-07-06T00:00:02.000Z",
        event_msg: {
          type: "agent_message",
          message: [
            "Project: lossless-openclaw-orchestrator",
            "Status: in-progress",
            "Blocker: CodeRabbit review pending",
            "Next action: patch implementation"
          ].join("\n")
        }
      }),
      ""
    ].join("\n"));
    const deltaDb = createDatabase(join(root, "delta.sqlite"));
    const fullDb = createDatabase(join(root, "full.sqlite"));
    try {
      assert.equal(indexCodexSessions(deltaDb, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      appendFileSync(file, `${JSON.stringify({
        timestamp: "2026-07-06T00:00:03.000Z",
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
      })}\n`);

      const delta = indexCodexSessions(deltaDb, { roots: [sessionsDir], maxFiles: 10 });
      const full = indexCodexSessions(fullDb, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(delta.appendDeltaIndexedFiles, 1);
      assert.equal(full.appendDeltaIndexedFiles, 0);
      assert.deepEqual(describeSession(deltaDb, threadId)?.metadata, describeSession(fullDb, threadId)?.metadata);
      assert.equal(describeSession(deltaDb, threadId)?.metadata?.blocker, null);
      assert.equal(describeSession(deltaDb, threadId)?.metadata?.status, "complete");
      assert.equal(describeSession(deltaDb, threadId)?.metadata?.closeoutState, "ready");
    } finally {
      deltaDb.close();
      fullDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("append-delta falls back to full reparse when cached safe text is already capped", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-append-delta-safe-text-cap-"));
  try {
    const sessionsDir = join(root, "sessions");
    const file = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-safe-text-cap.jsonl");
    const threadId = "019f-safe-text-cap";
    mkdirSync(sessionsDir, { recursive: true });
    writeSyntheticCodexSession(file, {
      threadId,
      title: "Safe text cap fallback title",
      finalMessage: "Final: safe text cap fallback initial complete."
    });
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      db.prepare("UPDATE codex_sessions SET safe_text = ? WHERE thread_id = ?").run("x".repeat(250_000), threadId);
      appendFileSync(file, `${JSON.stringify({
        timestamp: "2026-07-06T00:00:02.000Z",
        response_item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Final: safe text cap append marker complete." }]
        }
      })}\n`);

      const result = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(result.indexedFiles, 1);
      assert.equal(result.appendDeltaIndexedFiles, 0);
      assert.equal(searchSessions(db, { query: "safe text cap append marker", limit: 5 })[0]?.threadId, threadId);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("limited source cleanup deletes rowid-pinned FTS rows without orphans", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-rowid-cleanup-"));
  try {
    const sessionsDir = join(root, "sessions");
    const file = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-rowid-cleanup.jsonl");
    writeSyntheticCodexSession(file, {
      threadId: "019f-rowid-cleanup",
      title: "Rowid cleanup source",
      finalMessage: "Final: rowid cleanup source complete. Next action: benchmark."
    });

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      assert.equal(countRows(db, "codex_sessions"), 1);
      assert.equal(countRows(db, "codex_safe_text_fts"), 1);
      assert.equal(countRows(db, "codex_search_fts"), 1);

      const limited = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10, maxBytesPerFile: 1 });
      assert.equal(limited.indexedFiles, 0);
      assert.equal(limited.skippedFiles, 1);
      assert.equal(limited.limitedFiles[0]?.reason, "max_bytes_per_file");
      assert.equal(countRows(db, "codex_sessions"), 0);
      assert.equal(countRows(db, "codex_safe_text_fts"), 0);
      assert.equal(countRows(db, "codex_search_fts"), 0);
      assert.equal(countOrphanFtsRows(db, "codex_safe_text_fts"), 0);
      assert.equal(countOrphanFtsRows(db, "codex_search_fts"), 0);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fast-skip documents same-size same-mtime limitation and verify catches it", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-fast-skip-verify-"));
  try {
    const sessionsDir = join(root, "sessions");
    const file = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-fast-skip-same-size.jsonl");
    writeSyntheticCodexSession(file, {
      threadId: "019f-fast-skip-same-size",
      title: "Alpha version",
      finalMessage: "Final: Alpha version complete. Next action: benchmark."
    });
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      const before = statSync(file);
      writeSyntheticCodexSession(file, {
        threadId: "019f-fast-skip-same-size",
        title: "Bravo version",
        finalMessage: "Final: Bravo version complete. Next action: benchmark."
      });
      assert.equal(statSync(file).size, before.size);
      const indexedMtime = new Date(Math.trunc(before.mtimeMs));
      utimesSync(file, indexedMtime, indexedMtime);
      const forcedMtimeMs = Math.trunc(statSync(file).mtimeMs);
      db.prepare("UPDATE codex_source_files SET mtime_ms = ? WHERE source_path = ?").run(forcedMtimeMs, file);

      const fast = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(fast.indexedFiles, 0);
      assert.equal(fast.skippedFiles, 1);
      assert.equal(describeSession(db, "019f-fast-skip-same-size")?.title, "Alpha version");

      const verified = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10, verify: true });
      assert.equal(verified.indexedFiles, 1);
      assert.equal(describeSession(db, "019f-fast-skip-same-size")?.title, "Bravo version");
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fast-skip reindexes when unchanged mtime has a changed size", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-fast-skip-size-"));
  try {
    const sessionsDir = join(root, "sessions");
    const file = join(sessionsDir, "rollout-2026-07-06T00-00-00-019f-fast-skip-size.jsonl");
    writeSyntheticCodexSession(file, {
      threadId: "019f-fast-skip-size",
      title: "Small version",
      finalMessage: "Final: small version complete."
    });
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      const before = statSync(file);
      writeSyntheticCodexSession(file, {
        threadId: "019f-fast-skip-size",
        title: "Large version with extra bytes",
        finalMessage: "Final: large version complete with enough extra bytes to change the source-file watermark size."
      });
      const indexedMtime = new Date(Math.trunc(before.mtimeMs));
      utimesSync(file, indexedMtime, indexedMtime);

      const fast = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(fast.indexedFiles, 1);
      assert.equal(describeSession(db, "019f-fast-skip-size")?.title, "Large version with extra bytes");
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("NULL cached extractor versions in an existing database force backfill once", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-fast-skip-backfill-"));
  try {
    const corpus = writeSyntheticCodexCorpus(root, 1);
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      assert.equal(indexCodexSessions(db, { roots: [corpus.sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      db.prepare(`
        UPDATE codex_source_files
        SET
          metadata_extractor_version = NULL,
          prepared_range_extractor_version = NULL,
          summary_leaf_extractor_version = NULL,
          prepared_card_extractor_version = NULL
      `).run();

      const backfill = indexCodexSessions(db, { roots: [corpus.sessionsDir], maxFiles: 10 });
      assert.equal(backfill.indexedFiles, 1);
      assert.equal(backfill.skippedFiles, 0);

      const row = db.prepare(`
        SELECT
          metadata_extractor_version AS metadata,
          prepared_range_extractor_version AS preparedRanges,
          summary_leaf_extractor_version AS summaryLeaves,
          prepared_card_extractor_version AS preparedCards
        FROM codex_source_files
        LIMIT 1
      `).get() as { metadata: string | null; preparedRanges: string | null; summaryLeaves: string | null; preparedCards: string | null };
      assert.equal(row.metadata, "session-metadata-v4");
      assert.equal(row.preparedRanges, "prepared-source-ranges-v1");
      assert.equal(row.summaryLeaves, "summary-leaves-v1");
      assert.equal(row.preparedCards, "prepared-cards-v1");
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
