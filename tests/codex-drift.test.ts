import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabase,
  getCodexFinalMessages,
  indexCodexSessions,
  searchSessions
} from "../packages/core/src/index.js";

const fixtureRoot = join(process.cwd(), "tests", "fixtures", "codex-drift");

function withDb<T>(name: string, callback: (db: ReturnType<typeof createDatabase>) => T): T {
  const root = mkdtempSync(join(tmpdir(), name));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    return callback(db);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("legacy and current Codex JSONL fixtures index with no drift report", () => {
  for (const [shape, query] of [
    ["legacy-shape", "legacy fixture indexed cleanly"],
    ["current-shape", "current fixture indexed cleanly"]
  ] as const) {
    withDb(`loo-codex-drift-${shape}-`, (db) => {
      const indexed = indexCodexSessions(db, { roots: [join(fixtureRoot, shape)], maxFiles: 10 });

      assert.equal(indexed.errors.length, 0);
      assert.equal(indexed.indexedFiles, 1);
      assert.equal(indexed.indexedThreads, 1);
      assert.equal(searchSessions(db, { query, limit: 5 }).length, 1);
      assert.deepEqual((indexed as any).driftReport, []);
      assert.deepEqual((indexed as any).driftSummary, {
        files: 0,
        unknownEventKinds: 0,
        unparsedLines: 0,
        missingExpectedFields: 0
      });
    });
  }
});

test("future Codex JSONL drift fixture reports reason-coded drift and still indexes parseable events", () => {
  withDb("loo-codex-drift-future-", (db) => {
    const indexed = indexCodexSessions(db, { roots: [join(fixtureRoot, "future-drift")], maxFiles: 10 });

    assert.equal(indexed.errors.length, 0);
    assert.equal(indexed.indexedFiles, 1);
    assert.equal(indexed.indexedThreads, 1);
    assert.equal(indexed.indexedEvents, 7);
    assert.equal(searchSessions(db, { query: "Future drift packet remains parseable", limit: 5 }).length, 1);
    assert.equal(getCodexFinalMessages(db, { threadId: "019f-drift-future" })[0]?.text, "Final: future drift fixture still indexed.");

    const driftReport = (indexed as any).driftReport;
    assert.equal(driftReport.length, 1);
    assert.equal(driftReport[0].path.endsWith("future-session.jsonl"), true);
    assert.deepEqual(driftReport[0].unknownEventKinds, [
      { kind: "assistant_packet_v2", count: 1 },
      { kind: "future_delta", count: 1 }
    ]);
    assert.equal(driftReport[0].unparsedLines, 1);
    assert.deepEqual(driftReport[0].missingExpectedFields, [
      { field: "event_msg.message", count: 1 },
      { field: "response_item.content", count: 1 }
    ]);
    assert.deepEqual(driftReport[0].reasonCodes, [
      "missing_field:event_msg.message",
      "missing_field:response_item.content",
      "unknown_event_kind:assistant_packet_v2",
      "unknown_event_kind:future_delta",
      "unparsed_line"
    ]);
    assert.deepEqual((indexed as any).driftSummary, {
      files: 1,
      unknownEventKinds: 2,
      unparsedLines: 1,
      missingExpectedFields: 2
    });
    assert.doesNotMatch(JSON.stringify(driftReport), /Renamed payload field|this is not valid json/);
  });
});
