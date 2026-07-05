import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabase,
  describeSession,
  indexCodexSessions,
  type LooDatabase
} from "../packages/core/src/index.js";
import {
  writeSyntheticCodexCorpus,
  writeSyntheticCodexSession
} from "./helpers/synthetic-codex.js";

type IndexSnapshot = {
  sessions: number;
  safeTextRows: number;
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
