import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const observedNonFlaggingInnerKinds = [
  "function_call",
  "function_call_output",
  "message",
  "token_count",
  "agent_message",
  "reasoning",
  "custom_tool_call",
  "custom_tool_call_output",
  "patch_apply_end",
  "user_message",
  "task_started",
  "task_complete",
  "mcp_tool_call_end",
  "tool_search_call",
  "tool_search_output",
  "context_compacted",
  "item_completed",
  "turn_aborted"
] as const;

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
      { kind: "assistant_packet_v2", count: 1 }
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
      "unparsed_line"
    ]);
    assert.deepEqual((indexed as any).driftSummary, {
      files: 1,
      unknownEventKinds: 1,
      unparsedLines: 1,
      missingExpectedFields: 2
    });
    assert.doesNotMatch(JSON.stringify(driftReport), /Renamed payload field|this is not valid json/);
  });
});

test("observed modern Codex JSONL inner kinds pass the unknown-kind noise gate", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-drift-observed-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "observed-modern-kinds.jsonl");
  const lines = [
    {
      timestamp: "2026-07-02T10:00:00.000Z",
      type: "session_meta",
      payload: { id: "019f-drift-observed", cwd: "/Volumes/LEXAR/repos/example", model: "gpt-5.5" }
    },
    { timestamp: "2026-07-02T10:00:01.000Z", type: "event_msg", payload: { type: "thread_name", name: "Observed modern kind noise gate" } },
    ...observedNonFlaggingInnerKinds.map((kind, index) => observedKindRecord(kind, index))
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const indexed = indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.equal(indexed.errors.length, 0);
    assert.equal(indexed.indexedFiles, 1);
    assert.equal(indexed.indexedThreads, 1);
    assert.deepEqual((indexed as any).driftReport, []);
    assert.deepEqual((indexed as any).driftSummary, {
      files: 0,
      unknownEventKinds: 0,
      unparsedLines: 0,
      missingExpectedFields: 0
    });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function observedKindRecord(kind: (typeof observedNonFlaggingInnerKinds)[number], index: number): Record<string, unknown> {
  const timestamp = `2026-07-02T10:00:${String(index + 2).padStart(2, "0")}.000Z`;
  if (kind === "agent_message" || kind === "user_message") {
    return { timestamp, type: "event_msg", payload: { type: kind, message: `Synthetic ${kind} payload.` } };
  }
  if (kind === "message") {
    return {
      timestamp,
      type: "response_item",
      payload: { type: kind, role: "assistant", content: [{ type: "output_text", text: "Synthetic observed message payload." }] }
    };
  }
  if (kind === "function_call" || kind === "custom_tool_call") {
    return {
      timestamp,
      type: "response_item",
      payload: { type: kind, call_id: `call_${index}`, name: "functions.exec_command", arguments: "{\"cmd\":\"true\"}" }
    };
  }
  if (kind === "reasoning") {
    return {
      timestamp,
      type: "response_item",
      payload: { type: kind, summary: [{ type: "summary_text", text: "Synthetic reasoning text is known bookkeeping." }] }
    };
  }
  if (kind === "token_count") {
    return { timestamp, type: "response_item", payload: { type: kind, input_tokens: 10, output_tokens: 5 } };
  }
  return { timestamp, type: "response_item", payload: { type: kind, call_id: `call_${index}`, status: "ok" } };
}
