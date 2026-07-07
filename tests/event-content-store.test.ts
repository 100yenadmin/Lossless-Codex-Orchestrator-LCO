import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabase,
  grepRecall,
  indexCodexSessions,
  readCodexIndexHealthStatusFromPath,
  type LooDatabase
} from "../packages/core/src/index.js";

function writeEventContentSession(path: string, options: {
  threadId: string;
  phrase: string;
  extraAssistantText?: string;
}): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, [
    {
      timestamp: "2026-07-08T00:00:00.000Z",
      session_meta: {
        payload: {
          id: options.threadId,
          cwd: "/Volumes/LEXAR/repos/private-worktree",
          model: "gpt-5.5"
        }
      }
    },
    {
      timestamp: "2026-07-08T00:00:01.000Z",
      event_msg: {
        type: "thread_name",
        name: "Event content recall proof"
      }
    },
    {
      timestamp: "2026-07-08T00:00:02.000Z",
      response_item: {
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: `${options.phrase} ${options.extraAssistantText ?? ""}`
        }]
      }
    },
    {
      timestamp: "2026-07-08T00:00:03.000Z",
      response_item: {
        type: "function_call",
        call_id: `call_${options.threadId}`,
        name: "functions.exec_command",
        arguments: "{\"cmd\":\"echo sk-test_eventcontent1234567890 && cat /Users/alice/private.env\"}"
      }
    }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");
}

function tableExists(db: LooDatabase, tableName: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE name = ? AND type IN ('table', 'virtual table')").get(tableName) !== undefined;
}

function countRows(db: LooDatabase, tableName: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }).count);
}

function eventContentRows(db: LooDatabase, threadId: string): Array<{
  eventId: string;
  eventText: string;
  storedChars: number;
  sourceStatus: string | null;
}> {
  return db.prepare(`
    SELECT event_id AS eventId, event_text AS eventText, stored_chars AS storedChars, source_status AS sourceStatus
    FROM codex_event_content
    WHERE thread_id = ?
    ORDER BY ordinal ASC
  `).all(threadId) as Array<{ eventId: string; eventText: string; storedChars: number; sourceStatus: string | null }>;
}

test("indexing stores redacted per-event content and pins event FTS rowids", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-event-content-store-"));
  try {
    const sessionsDir = join(root, "sessions");
    const threadId = "019f-event-content-store";
    const file = join(sessionsDir, "rollout-2026-07-08T00-00-00-019f-event-content-store.jsonl");
    writeEventContentSession(file, {
      threadId,
      phrase: "S1 keystone phrase lands in an event scoped content row."
    });
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const indexed = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(indexed.indexedFiles, 1);
      assert.equal(indexed.errors.length, 0);

      assert.equal(tableExists(db, "codex_event_content"), true);
      assert.equal(tableExists(db, "codex_event_content_fts"), true);
      assert.equal(countRows(db, "codex_event_content"), countRows(db, "prepared_source_events"));
      assert.equal(countRows(db, "codex_event_content_fts"), countRows(db, "codex_event_content"));

      const rows = eventContentRows(db, threadId);
      assert.ok(rows.some((row) => row.eventText.includes("S1 keystone phrase lands")));
      assert.equal(rows.some((row) => row.eventText.includes("sk-test_eventcontent1234567890")), false);
      assert.equal(rows.some((row) => row.eventText.includes("/Users/alice/private.env")), false);
      assert.equal(rows.some((row) => row.eventText.includes("/Volumes/LEXAR/repos/private-worktree")), false);
      assert.ok(rows.every((row) => row.storedChars <= 8000));

      const unpinned = db.prepare(`
        SELECT COUNT(*) AS count
        FROM codex_event_content c
        LEFT JOIN codex_event_content_fts f ON f.rowid = c.rowid AND f.event_id = c.event_id
        WHERE f.rowid IS NULL
      `).get() as { count: number };
      assert.equal(unpinned.count, 0);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("append-delta appends event content without rebuilding the whole event FTS table", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-event-content-append-"));
  try {
    const sessionsDir = join(root, "sessions");
    const threadId = "019f-event-content-append";
    const file = join(sessionsDir, "rollout-2026-07-08T00-00-00-019f-event-content-append.jsonl");
    writeEventContentSession(file, {
      threadId,
      phrase: "Initial append content proof."
    });
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    const preparedSql: string[] = [];
    const originalPrepare = db.prepare;
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      const beforeContentRows = countRows(db, "codex_event_content");
      appendFileSync(file, `${JSON.stringify({
        timestamp: "2026-07-08T00:00:04.000Z",
        response_item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Delta-only event content marker is indexed incrementally." }]
        }
      })}\n`);

      (db as unknown as { prepare: LooDatabase["prepare"] }).prepare = ((sql: string) => {
        preparedSql.push(sql.replace(/\s+/g, " ").trim());
        return originalPrepare.call(db, sql);
      }) as LooDatabase["prepare"];
      const delta = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 });
      assert.equal(delta.indexedFiles, 1);
      assert.equal(delta.appendDeltaIndexedFiles, 1);
      assert.equal(countRows(db, "codex_event_content"), beforeContentRows + 1);
      assert.equal(grepRecall(db, { query: "Delta-only event content marker", limit: 5 }).matches[0]?.sourceRef, `codex_thread:${threadId}`);
      assert.deepEqual(preparedSql.filter((sql) => /^DELETE FROM codex_event_content(?:_fts)?$/i.test(sql)), []);
    } finally {
      (db as unknown as { prepare: LooDatabase["prepare"] }).prepare = originalPrepare;
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("grep returns an event-granular durable hit after the source JSONL is removed", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-event-content-durable-grep-"));
  try {
    const sessionsDir = join(root, "sessions");
    const threadId = "019f-event-content-durable";
    const file = join(sessionsDir, "rollout-2026-07-08T00-00-00-019f-event-content-durable.jsonl");
    writeEventContentSession(file, {
      threadId,
      phrase: "Durable per-event recall survives source rotation."
    });
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      const liveMatch = grepRecall(db, { query: "per-event recall survives", limit: 5 }).matches[0] as Record<string, any> | undefined;
      assert.equal(liveMatch?.sourceRef, `codex_thread:${threadId}`);
      assert.equal(liveMatch?.event?.sourceStatus, "source_available");
      assert.match(liveMatch?.event?.eventId ?? "", /^[a-f0-9]{32}$/);
      assert.match(liveMatch?.event?.eventRef ?? "", /^codex_event:[a-f0-9]{32}$/);
      assert.equal(liveMatch?.event?.lineStart, 3);
      assert.equal(typeof liveMatch?.event?.byteStart, "number");
      assert.match(liveMatch?.snippet ?? "", /\[per-event\].*\[recall\].*\[survives\]/);
      assert.ok(liveMatch?.reasonCodes?.includes("event_content_fts_match"));

      unlinkSync(file);
      const rotatedMatch = grepRecall(db, { query: "per-event recall survives", limit: 5 }).matches[0] as Record<string, any> | undefined;
      assert.equal(rotatedMatch?.sourceRef, `codex_thread:${threadId}`);
      assert.equal(rotatedMatch?.event?.sourceStatus, "source_rotated");
      assert.ok(rotatedMatch?.reasonCodes?.includes("source_rotated"));
      assert.match(rotatedMatch?.snippet ?? "", /\[per-event\].*\[recall\].*\[survives\]/);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor health reports event-content coverage and database size accounting", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-event-content-doctor-"));
  try {
    const sessionsDir = join(root, "sessions");
    const dbPath = join(root, "orchestrator.sqlite");
    writeEventContentSession(join(sessionsDir, "rollout-2026-07-08T00-00-00-019f-event-content-doctor.jsonl"), {
      threadId: "019f-event-content-doctor",
      phrase: "Doctor should count event content bytes."
    });
    const db = createDatabase(dbPath);
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
    } finally {
      db.close();
    }

    const health = readCodexIndexHealthStatusFromPath(dbPath) as Record<string, any>;
    assert.equal(health.codexEventContent.schema, "lco.codexEventContent.status.v1");
    assert.equal(health.codexEventContent.state, "ready");
    assert.equal(health.codexEventContent.coverage.totalEvents, 4);
    assert.equal(health.codexEventContent.coverage.eventsWithContent, 4);
    assert.equal(health.codexEventContent.coverage.coveragePct, 100);
    assert.ok(health.codexEventContent.size.dbBytes > 0);
    assert.ok(health.codexEventContent.size.walBytes >= 0);
    assert.ok(health.codexEventContent.size.eventContentBytes > 0);
    assert.ok(health.codexEventContent.size.eventContentFtsRows >= 4);
    assert.doesNotMatch(JSON.stringify(health.codexEventContent), /\/Volumes\/LEXAR|\/Users\/|private-worktree/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
