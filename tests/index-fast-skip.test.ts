import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
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
