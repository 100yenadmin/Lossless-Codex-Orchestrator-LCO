import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabase,
  getSessionDiff,
  persistWatcherObservations,
  type WatchSpec
} from "../packages/core/src/index.js";
import { createLooToolDeclarations, createLooTools } from "../packages/mcp-server/src/tools.js";

function id(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

function withSessionDiffDb<T>(fn: (db: ReturnType<typeof createDatabase>) => T): T {
  const root = mkdtempSync(join(tmpdir(), "lco-session-diff-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    return fn(db);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function insertSession(db: ReturnType<typeof createDatabase>, threadId: string, sourcePath = `/Users/lume/.codex/sessions/${threadId}.jsonl`): void {
  db.prepare(`
    INSERT INTO codex_sessions (
      thread_id, title, cwd, model, branch, git_sha, source_path, created_at,
      updated_at, summary, final_message, safe_text, event_count,
      tool_call_count, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    threadId,
    "Session diff fixture",
    "/Users/lume/private/project",
    "gpt-5.4-mini",
    null,
    null,
    sourcePath,
    "2026-07-09T00:00:00.000Z",
    "2026-07-09T00:00:00.000Z",
    "Metadata summary only",
    null,
    "safe row",
    0,
    0,
    "2026-07-09T00:00:00.000Z"
  );
  db.prepare(`
    INSERT INTO codex_source_files (
      source_path, path_hash, size, mtime_ms, last_indexed_at,
      metadata_extractor_version, prepared_range_extractor_version,
      summary_leaf_extractor_version, prepared_card_extractor_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sourcePath,
    id(`path:${sourcePath}`),
    2048,
    1783555200000,
    "2026-07-09T00:00:00.000Z",
    "metadata-v1",
    "prepared-source-ranges-v1",
    "summary-leaves-v1",
    "prepared-cards-v2"
  );
}

function insertPreparedRange(
  db: ReturnType<typeof createDatabase>,
  input: {
    threadId: string;
    ordinal: number;
    kind?: string;
    createdAt: string;
    observedAt?: string;
    sourceHash?: string;
    confidence?: number;
  }
): string {
  const eventId = id(`event:${input.threadId}:${input.ordinal}`);
  const rangeId = id(`range:${input.threadId}:${input.ordinal}`);
  const sourceRef = `codex_thread:${input.threadId}`;
  const sourcePathRef = `codex_source:${id(`source:${input.threadId}`).slice(0, 16)}`;
  const sourceHash = input.sourceHash ?? id(`source-hash:${input.threadId}`);
  const contentHash = id(`content:${input.threadId}:${input.ordinal}`);
  const observedAt = input.observedAt ?? input.createdAt;
  db.prepare(`
    INSERT INTO prepared_source_events (
      event_id, event_ref, thread_id, source_ref, source_path_ref, source_hash,
      content_hash, event_kind, line_start, line_end, byte_start, byte_end,
      ordinal, observed_at, extractor_version, privacy_class, omission_status,
      confidence, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    `codex_event:${eventId}`,
    input.threadId,
    sourceRef,
    sourcePathRef,
    sourceHash,
    contentHash,
    input.kind ?? "user_prompt",
    input.ordinal + 1,
    input.ordinal + 1,
    input.ordinal * 100,
    input.ordinal * 100 + 80,
    input.ordinal,
    observedAt,
    "prepared-source-ranges-v1",
    "public_safe_metadata",
    "metadata_only",
    input.confidence ?? 0.91,
    "{}",
    input.createdAt
  );
  db.prepare(`
    INSERT INTO prepared_source_ranges (
      range_id, range_ref, event_id, event_ref, thread_id, source_ref,
      source_path_ref, source_hash, content_hash, range_kind, line_start,
      line_end, byte_start, byte_end, ordinal, observed_at, extractor_version,
      privacy_class, omission_status, confidence, reason_codes_json,
      metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rangeId,
    `codex_range:${rangeId}`,
    eventId,
    `codex_event:${eventId}`,
    input.threadId,
    sourceRef,
    sourcePathRef,
    sourceHash,
    contentHash,
    input.kind ?? "user_prompt",
    input.ordinal + 1,
    input.ordinal + 1,
    input.ordinal * 100,
    input.ordinal * 100 + 80,
    input.ordinal,
    observedAt,
    "prepared-source-ranges-v1",
    "public_safe_metadata",
    "metadata_only",
    input.confidence ?? 0.91,
    JSON.stringify(["fixture_range"]),
    "{}",
    input.createdAt
  );
  return `codex_range:${rangeId}`;
}

function insertSummaryLeaf(
  db: ReturnType<typeof createDatabase>,
  input: {
    threadId: string;
    ordinal: number;
    sourceRangeRef: string;
    summaryText?: string;
    createdAt: string;
    freshnessAt?: string;
  }
): string {
  const leafId = id(`leaf:${input.threadId}:${input.ordinal}`);
  const summaryText = "Final assistant message evidence: 1 prepared source range available. Expand by summary leaf or source range for bounded evidence.";
  db.prepare(`
    INSERT INTO summary_leaves (
      leaf_id, leaf_ref, thread_id, leaf_kind, summary_text, source_refs_json,
      source_range_refs_json, input_hash, output_hash, extractor_version,
      privacy_class, authority_coverage_json, confidence, freshness_at, stale,
      omission_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    leafId,
    `summary_leaf:${leafId}`,
    input.threadId,
    "final_message",
    summaryText,
    JSON.stringify([`codex_thread:${input.threadId}`]),
    JSON.stringify([input.sourceRangeRef]),
    id(`leaf-input:${input.threadId}:${input.ordinal}`),
    id(`leaf-output:${input.threadId}:${input.ordinal}`),
    "summary-leaves-v1",
    "public_safe_metadata",
    JSON.stringify({ source: "prepared_source_ranges", status: "ok", rangeCount: 1 }),
    0.9,
    input.freshnessAt ?? input.createdAt,
    0,
    "metadata_only",
    input.createdAt
  );
  return `summary_leaf:${leafId}`;
}

function insertPreparedCard(db: ReturnType<typeof createDatabase>, threadId: string, sourceRangeRef: string, updatedAt: string): string {
  const cardId = id(`card:${threadId}:${updatedAt}`);
  db.prepare(`
    INSERT INTO prepared_cards (
      card_id, card_ref, target_ref, card_kind, title, objective, summary_text,
      blocker, next_action, source_refs_json, source_range_refs_json,
      source_range_refs_omitted, authority_coverage_json, input_hash,
      extractor_version, privacy_class, confidence, freshness_at, stale, state,
      reason_codes_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cardId,
    `prepared_card:${cardId}`,
    `codex_thread:${threadId}`,
    "codex_session",
    "Session diff fixture",
    "Diff cards should summarize derived-cache changes.",
    "Final state changed after the cursor.",
    null,
    "Inspect the session diff before driving.",
    JSON.stringify([`codex_thread:${threadId}`]),
    JSON.stringify([sourceRangeRef]),
    0,
    JSON.stringify({
      summaryLeaves: { status: "ok", leafCount: 1, rangeCount: 1 },
      sessionMetadata: { status: "ok" },
      watcherObservations: { status: "not_configured" }
    }),
    id(`card-input:${threadId}:${updatedAt}`),
    "prepared-cards-v2",
    "public_safe_metadata",
    0.92,
    updatedAt,
    0,
    "ready",
    JSON.stringify(["prepared_card_ready"]),
    updatedAt,
    updatedAt
  );
  return `prepared_card:${cardId}`;
}

function insertPreparedInboxItem(db: ReturnType<typeof createDatabase>, threadId: string, cardRef: string, updatedAt: string): void {
  const itemId = `prepared_inbox:${id(`inbox:${threadId}:${updatedAt}`)}`;
  db.prepare(`
    INSERT INTO prepared_inbox_items (
      item_id, card_ref, target_ref, urgency_score, state, reason_codes_json,
      source_refs_json, execute_false, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    itemId,
    cardRef,
    `codex_thread:${threadId}`,
    86,
    "ready",
    JSON.stringify(["session_diff_ready"]),
    JSON.stringify([`codex_thread:${threadId}`]),
    1,
    updatedAt,
    updatedAt
  );
}

function watcherSpec(threadId: string, now: string): WatchSpec {
  return {
    schema: "lco.watchSpec.v1",
    watchId: "watch_session_diff",
    targetRef: `codex_thread:${threadId}`,
    kind: "final_message_appeared",
    createdAt: "2026-07-09T00:00:00.000Z",
    lastObservedAt: now,
    ttlSeconds: 3600,
    staleAfterSeconds: 1800,
    stopConditions: ["final_message_seen"],
    evidenceIds: ["ev_session_diff"],
    confidence: 0.91,
    mutates: false,
    observed: { finalMessageCount: 1 }
  };
}

test("session diff returns append changes after an opaque cursor without leaking raw paths", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-append";
    insertSession(db, threadId);
    const initialRange = insertPreparedRange(db, { threadId, ordinal: 1, createdAt: "2026-07-09T00:00:00.000Z" });
    insertSummaryLeaf(db, {
      threadId,
      ordinal: 1,
      sourceRangeRef: initialRange,
      summaryText: "Initial final-message leaf.",
      createdAt: "2026-07-09T00:00:00.000Z"
    });

    const baseline = getSessionDiff(db, { threadId, now: "2026-07-09T00:01:00.000Z", limit: 10 });
    assert.equal(baseline.schema, "lco.session.diff.v1");
    assert.equal(baseline.publicSafe, true);
    assert.equal(baseline.cursor.status, "none");
    assert.match(baseline.cursor.nextCursor, /^lco_cursor_/);

    const appendedRange = insertPreparedRange(db, { threadId, ordinal: 2, createdAt: "2026-07-09T00:02:00.000Z" });
    insertSummaryLeaf(db, {
      threadId,
      ordinal: 2,
      sourceRangeRef: appendedRange,
      summaryText: "Appended final-message summary leaf after cursor.",
      createdAt: "2026-07-09T00:02:01.000Z"
    });
    const cardRef = insertPreparedCard(db, threadId, appendedRange, "2026-07-09T00:02:02.000Z");
    insertPreparedInboxItem(db, threadId, cardRef, "2026-07-09T00:02:03.000Z");
    persistWatcherObservations(db, [watcherSpec(threadId, "2026-07-09T00:02:04.000Z")], {
      now: "2026-07-09T00:02:04.000Z"
    });

    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z",
      limit: 20,
      tokenBudget: 600
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.equal(diff.summary.changedSourceRanges, 1);
    assert.equal(diff.summary.changedSummaryLeaves, 1);
    assert.equal(diff.summary.changedPreparedCards, 1);
    assert.equal(diff.summary.changedInboxItems, 1);
    assert.equal(diff.summary.changedWatcherObservations, 1);
    assert.deepEqual(diff.sourceCoverage, {
      indexedSession: "ok",
      preparedSourceRanges: "ok",
      summaryLeaves: "ok",
      preparedCards: "ok",
      preparedInboxItems: "ok",
      watcherObservations: "ok"
    });
    assert.ok(diff.changes.some((change) => change.changeKind === "summary_leaf"));
    assert.ok(diff.changes.some((change) => change.changeKind === "prepared_card"));
    assert.ok(diff.changes.some((change) => change.changeKind === "watcher_observation"));
    assert.equal(diff.actionsPerformed.rawTranscriptRead, false);
    assert.equal(diff.actionsPerformed.liveControl, false);
    const joined = JSON.stringify(diff);
    assert.doesNotMatch(joined, /\/Users\/lume/);
    assert.doesNotMatch(joined, /PRIVATE_CANARY|npm_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9_]+/);
  });
});

test("session diff marks stale cursor when source hash changes after cursor issuance", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-stale";
    insertSession(db, threadId);
    insertPreparedRange(db, {
      threadId,
      ordinal: 1,
      sourceHash: id("source-before"),
      createdAt: "2026-07-09T00:00:00.000Z"
    });
    const baseline = getSessionDiff(db, { threadId, now: "2026-07-09T00:01:00.000Z" });

    db.prepare("UPDATE prepared_source_events SET source_hash = ? WHERE thread_id = ?").run(id("source-after"), threadId);
    db.prepare("UPDATE prepared_source_ranges SET source_hash = ? WHERE thread_id = ?").run(id("source-after"), threadId);

    const diff = getSessionDiff(db, { threadId, cursor: baseline.cursor.nextCursor, now: "2026-07-09T00:02:00.000Z" });
    assert.equal(diff.cursor.status, "stale");
    assert.ok(diff.cursor.reasonCodes.includes("source_hash_changed"));
    assert.equal(diff.sourceCoverage.preparedSourceRanges, "partial");
    assert.ok(diff.nextSafeCommands.some((command) => command.includes("lco index codex")));
  });
});

test("session diff enforces token budget with omission markers", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-token-budget";
    insertSession(db, threadId);
    for (let index = 0; index < 8; index += 1) {
      const range = insertPreparedRange(db, {
        threadId,
        ordinal: index + 1,
        createdAt: `2026-07-09T00:0${index}:00.000Z`
      });
      insertSummaryLeaf(db, {
        threadId,
        ordinal: index + 1,
        sourceRangeRef: range,
        summaryText: `Long public-safe summary leaf ${index} `.repeat(30),
        createdAt: `2026-07-09T00:0${index}:01.000Z`
      });
    }

    const diff = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:10:00.000Z",
      limit: 20,
      tokenBudget: 60
    });

    assert.equal(diff.omitted.reasons.includes("token_budget"), true);
    assert.ok(diff.summary.returned < diff.summary.totalChanges);
    assert.ok(diff.omitted.tokenBudgetCount > 0);
  });
});

test("session diff is exposed through MCP/OpenClaw declarations and legacy alias", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-tool";
    insertSession(db, threadId);
    insertPreparedRange(db, { threadId, ordinal: 1, createdAt: "2026-07-09T00:00:00.000Z" });

    const declarations = createLooToolDeclarations({ includeAliases: true });
    assert.ok(declarations.some((tool) => tool.name === "lco_session_diff"));
    assert.ok(declarations.some((tool) => tool.name === "loo_session_diff"));

    const tools = createLooTools({
      db,
      audit: {
        path: "test",
        append() {
          throw new Error("not used");
        },
        find() {
          return null;
        },
        tail() {
          return [];
        },
        fingerprintText() {
          return "test";
        },
        fingerprintValue() {
          return "test";
        }
      },
      codexClient: {
        async request() {
          throw new Error("not used");
        }
      }
    });
    const tool = tools.find((entry) => entry.name === "lco_session_diff");
    assert.ok(tool);
    const report = tool.execute({ thread_id: threadId, now: "2026-07-09T00:02:00.000Z" }) as ReturnType<typeof getSessionDiff>;
    assert.equal(report.schema, "lco.session.diff.v1");
    assert.equal(report.publicSafe, true);
  });
});
