import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fingerprintAuditTextIfConfigured } from "../packages/adapters/src/index.js";
import {
  createDatabase,
  getSessionDiff as getSessionDiffCore,
  indexCodexSessions,
  materializePreparedCards,
  materializeSummaryLeaves,
  persistWatcherObservations,
  type SessionDiffOptions,
  type WatchSpec
} from "../packages/core/src/index.js";
import {
  createLooToolDeclarations,
  createLooTools,
  executeLooToolForOpenClaw
} from "../packages/mcp-server/src/tools.js";
import { writeSyntheticCodexSession } from "./helpers/synthetic-codex.js";

function id(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

const TEST_CURSOR_SIGNING_KEY = "test-session-diff-cursor-key-v1";

function getSessionDiff(
  db: ReturnType<typeof createDatabase>,
  options: SessionDiffOptions = {}
): ReturnType<typeof getSessionDiffCore> {
  return getSessionDiffCore(db, {
    cursorSigningKey: TEST_CURSOR_SIGNING_KEY,
    ...options
  });
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
      source_path_ref, source_hash, content_hash, session_diff_key, range_kind, line_start,
      line_end, byte_start, byte_end, ordinal, observed_at, extractor_version,
      privacy_class, omission_status, confidence, reason_codes_json,
      metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    `${sourcePathRef}:${String(input.ordinal).padStart(12, "0")}:${input.kind ?? "user_prompt"}:${contentHash}`,
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

test("session diff accepts a newly indexed source after an empty unscoped cursor", () => {
  withSessionDiffDb((db) => {
    const baseline = getSessionDiff(db, { now: "2026-07-09T00:01:00.000Z" });
    const threadId = "019f-session-diff-new-source";
    insertSession(db, threadId);
    insertPreparedRange(db, {
      threadId,
      ordinal: 1,
      createdAt: "2026-07-09T00:02:00.000Z"
    });

    const diff = getSessionDiff(db, {
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z"
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.ok(diff.changes.some((change) => change.threadId === threadId));
  });
});

test("session diff marks a mixed source rewrite and addition stale", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-session-diff-mixed-source-"));
  const sessionsDir = join(root, "sessions");
  const firstFile = join(sessionsDir, "rollout-2026-07-09T00-00-00-019f-session-diff-mixed-a.jsonl");
  const secondFile = join(sessionsDir, "rollout-2026-07-09T00-00-01-019f-session-diff-mixed-b.jsonl");
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    writeSyntheticCodexSession(firstFile, {
      threadId: "019f-session-diff-mixed-a",
      title: "Mixed source A",
      finalMessage: "Final: source A before rewrite."
    });
    assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
    const baseline = getSessionDiff(db, { now: "2026-07-09T00:01:00.000Z" });

    writeSyntheticCodexSession(firstFile, {
      threadId: "019f-session-diff-mixed-a",
      title: "Mixed source A rewritten",
      finalMessage: "Final: source A history was rewritten.",
      timestamp: "2026-07-09T00:02:00.000Z"
    });
    writeSyntheticCodexSession(secondFile, {
      threadId: "019f-session-diff-mixed-b",
      title: "Mixed source B",
      finalMessage: "Final: source B was newly indexed.",
      timestamp: "2026-07-09T00:02:01.000Z"
    });
    assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10, verify: true }).indexedFiles, 2);

    const diff = getSessionDiff(db, {
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z"
    });
    assert.equal(diff.cursor.status, "stale");
    assert.ok(diff.cursor.reasonCodes.includes("source_history_rewritten"));
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session diff custom target ignores unrelated Codex source changes", () => {
  withSessionDiffDb((db) => {
    const baseline = getSessionDiff(db, {
      targetRef: "project:custom",
      now: "2026-07-09T00:01:00.000Z"
    });
    insertSession(db, "019f-session-diff-unrelated-source");

    const diff = getSessionDiff(db, {
      targetRef: "project:custom",
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z"
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.equal(diff.summary.returned, 0);
  });
});

test("session diff reports a watcher persisted after the cursor even when its observation is older", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-late-watcher";
    insertSession(db, threadId);
    const baseline = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T10:00:00.000Z"
    });

    persistWatcherObservations(db, [watcherSpec(threadId, "2026-07-09T09:00:00.000Z")], {
      now: "2026-07-09T10:01:00.000Z"
    });

    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T10:02:00.000Z"
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.ok(diff.changes.some((change) => change.changeKind === "watcher_observation"));
  });
});

test("session diff does not lose a same-timestamp watcher replacement with a lower hashed key", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-watcher-same-ms";
    const changedAt = "2026-07-09T00:01:00.000Z";
    insertSession(db, threadId);
    const initial: WatchSpec = {
      ...watcherSpec(threadId, changedAt),
      observed: { finalMessageCount: 8 },
      evidenceIds: ["ev_8"]
    };
    persistWatcherObservations(db, [initial], { now: changedAt });
    const initialRow = db.prepare("SELECT observation_id AS observationId, created_at AS createdAt FROM watcher_observations").get() as { observationId: string; createdAt: string };
    const initialId = String(initialRow.observationId);
    const baseline = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:02:00.000Z",
      limit: 500,
      tokenBudget: 8000
    });
    assert.equal(baseline.summary.changedWatcherObservations, 1);

    const replacement: WatchSpec = {
      ...initial,
      observed: { finalMessageCount: 0 },
      evidenceIds: ["ev_0"]
    };
    persistWatcherObservations(db, [replacement], { now: changedAt });
    const replacementRow = db.prepare("SELECT observation_id AS observationId, created_at AS createdAt FROM watcher_observations").get() as { observationId: string; createdAt: string };
    const replacementId = String(replacementRow.observationId);
    assert.ok(replacementId < initialId, "fixture must replace with a lexically lower cursor key");
    assert.ok(replacementRow.createdAt > initialRow.createdAt, "changed logical rows need a monotonic change timestamp");
    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z",
      limit: 500,
      tokenBudget: 8000
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.equal(diff.summary.changedWatcherObservations, 1);
    assert.equal(diff.changes.filter((change) => change.changeKind === "watcher_observation").length, 1);
  });
});

test("session diff does not lose same-timestamp prepared-card and inbox replacements", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-07-09T00:01:00.000Z") });
  withSessionDiffDb((db) => {
    const threadId = "same-ms-card";
    insertSession(db, threadId);
    const rangeRef = insertPreparedRange(db, {
      threadId,
      ordinal: 1,
      createdAt: "2026-07-09T00:00:00.000Z"
    });
    insertSummaryLeaf(db, {
      threadId,
      ordinal: 1,
      sourceRangeRef: rangeRef,
      createdAt: "2026-07-09T00:00:00.000Z"
    });
    materializePreparedCards(db, { threadId });
    const initialCard = db.prepare(`
      SELECT card_ref AS cardRef, updated_at AS updatedAt
      FROM prepared_cards WHERE target_ref = ?
    `).get(`codex_thread:${threadId}`) as { cardRef: string; updatedAt: string };
    const initialInbox = db.prepare(`
      SELECT item_id AS itemRef, updated_at AS updatedAt
      FROM prepared_inbox_items WHERE target_ref = ?
    `).get(`codex_thread:${threadId}`) as { itemRef: string; updatedAt: string };
    const baseline = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:02:00.000Z",
      limit: 500,
      tokenBudget: 8000
    });

    db.prepare(`
      INSERT INTO codex_session_metadata (thread_id, blocker, metadata_schema_version)
      VALUES (?, ?, 1)
    `).run(threadId, "blocker-6");
    materializePreparedCards(db, { threadId });
    const replacementCard = db.prepare(`
      SELECT card_ref AS cardRef, updated_at AS updatedAt
      FROM prepared_cards WHERE target_ref = ?
    `).get(`codex_thread:${threadId}`) as { cardRef: string; updatedAt: string };
    const replacementInbox = db.prepare(`
      SELECT item_id AS itemRef, updated_at AS updatedAt
      FROM prepared_inbox_items WHERE target_ref = ?
    `).get(`codex_thread:${threadId}`) as { itemRef: string; updatedAt: string };

    assert.ok(replacementCard.cardRef < initialCard.cardRef, `${replacementCard.cardRef} must sort below ${initialCard.cardRef}`);
    assert.ok(replacementCard.updatedAt > initialCard.updatedAt);
    assert.ok(replacementInbox.updatedAt > initialInbox.updatedAt);
    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z",
      limit: 500,
      tokenBudget: 8000
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.equal(diff.summary.changedPreparedCards, 1);
    assert.equal(diff.summary.changedInboxItems, 1);
  });
});

test("session diff does not replay unchanged prepared rows after same-timestamp rematerialization", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-07-09T00:01:00.000Z") });
  withSessionDiffDb((db) => {
    const threadId = "same-ms-idempotent-materialization";
    insertSession(db, threadId);
    insertPreparedRange(db, {
      threadId,
      ordinal: 1,
      createdAt: "2026-07-09T00:00:00.000Z"
    });
    materializeSummaryLeaves(db, { threadId });
    materializePreparedCards(db, { threadId });
    const baseline = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:02:00.000Z",
      limit: 500,
      tokenBudget: 8000
    });

    materializeSummaryLeaves(db, { threadId });
    materializePreparedCards(db, { threadId });
    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z",
      limit: 500,
      tokenBudget: 8000
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.equal(diff.summary.returned, 0);
  });
});

test("session diff accepts a monotonic source append when reindexing updates the source hash", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-source-append";
    const sourceHashBefore = id("source-append-before");
    const sourceHashAfter = id("source-append-after");
    insertSession(db, threadId);
    db.prepare("UPDATE codex_source_files SET path_hash = ?, content_epoch = ?, append_generation = 0 WHERE source_path = ?")
      .run(sourceHashBefore, sourceHashBefore, `/Users/lume/.codex/sessions/${threadId}.jsonl`);
    insertPreparedRange(db, {
      threadId,
      ordinal: 1,
      sourceHash: sourceHashBefore,
      createdAt: "2026-07-09T00:00:00.000Z"
    });
    const baseline = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:01:00.000Z"
    });

    db.prepare("UPDATE codex_source_files SET path_hash = ?, content_epoch = ?, append_generation = 1, size = 4096 WHERE source_path = ?")
      .run(sourceHashAfter, sourceHashBefore, `/Users/lume/.codex/sessions/${threadId}.jsonl`);
    db.prepare("UPDATE prepared_source_events SET source_hash = ? WHERE thread_id = ?")
      .run(sourceHashAfter, threadId);
    db.prepare("UPDATE prepared_source_ranges SET source_hash = ? WHERE thread_id = ?")
      .run(sourceHashAfter, threadId);
    const appendedRange = insertPreparedRange(db, {
      threadId,
      ordinal: 2,
      sourceHash: sourceHashAfter,
      createdAt: "2026-07-09T00:02:00.000Z"
    });

    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z"
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.ok(diff.changes.some((change) => change.sourceRangeRefs.includes(appendedRange)));
  });
});

test("session diff stays accepted and lossless across the production append-delta rekey path", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-session-diff-real-append-"));
  const sessionsDir = join(root, "sessions");
  const file = join(sessionsDir, "rollout-2026-07-09T00-00-00-019f-session-diff-real-append.jsonl");
  const threadId = "019f-session-diff-real-append";
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    writeSyntheticCodexSession(file, {
      threadId,
      title: "Session diff append fixture",
      finalMessage: "Final: initial session diff append fixture."
    });
    appendFileSync(file, "\n");
    assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
    const baseline = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:01:00.000Z",
      limit: 1,
      tokenBudget: 8000
    });
    const returnedOrdinals = new Set(baseline.changes.flatMap((change) => {
      if (change.changeKind !== "source_range") return [];
      return [Number((change.item as { ordinal?: number }).ordinal)];
    }));

    appendFileSync(file, [
      JSON.stringify({
        timestamp: "2026-07-09T00:02:00.000Z",
        event_msg: { type: "thread_name", name: "Session diff append fixture updated" }
      }),
      JSON.stringify({
        timestamp: "2026-07-09T00:02:01.000Z",
        response_item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Final: appended session diff fixture." }]
        }
      }),
      ""
    ].join("\n"));
    const indexed = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }) as ReturnType<typeof indexCodexSessions> & {
      appendDeltaIndexedFiles?: number;
    };
    assert.equal(indexed.appendDeltaIndexedFiles, 1);

    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z",
      limit: 500,
      tokenBudget: 8000
    });

    assert.equal(diff.cursor.status, "accepted");
    const diffOrdinals = diff.changes.flatMap((change) => {
      if (change.changeKind !== "source_range") return [];
      return [Number((change.item as { ordinal?: number }).ordinal)];
    });
    assert.ok(diffOrdinals.length > 0);
    assert.ok(diffOrdinals.every((ordinal) => !returnedOrdinals.has(ordinal)));
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session diff accepts a production append when event-content storage is disabled", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-session-diff-no-event-content-"));
  const sessionsDir = join(root, "sessions");
  const file = join(sessionsDir, "rollout-2026-07-09T00-00-00-019f-session-diff-no-event-content.jsonl");
  const threadId = "019f-session-diff-no-event-content";
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    writeSyntheticCodexSession(file, {
      threadId,
      title: "Session diff no event content",
      finalMessage: "Final: initial no-event-content fixture."
    });
    assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10, eventContent: false }).indexedFiles, 1);
    const baseline = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:01:00.000Z"
    });
    const baselineKeys = new Set((db.prepare(`
      SELECT session_diff_key AS sessionDiffKey
      FROM prepared_source_ranges
      WHERE thread_id = ?
    `).all(threadId) as Array<{ sessionDiffKey: string }>).map((row) => row.sessionDiffKey));

    appendFileSync(file, `${JSON.stringify({
      timestamp: "2026-07-09T00:02:00.000Z",
      event_msg: { type: "agent_message", message: "Final: appended without event-content storage." }
    })}\n`);
    const appendResult = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10, eventContent: false });
    assert.equal(appendResult.indexedFiles, 1);
    assert.equal(appendResult.appendDeltaIndexedFiles, 1);
    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z"
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.ok(diff.changes.some((change) => change.changeKind === "source_range"));
    for (const change of diff.changes.filter((item) => item.changeKind === "source_range")) {
      const range = change.item as { sourcePathRef: string; ordinal: number; rangeKind: string; contentHash: string };
      const semanticKey = `${range.sourcePathRef}:${String(range.ordinal).padStart(12, "0")}:${range.rangeKind}:${range.contentHash}`;
      assert.equal(baselineKeys.has(semanticKey), false, `replayed baseline range ${semanticKey}`);
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session diff verify-mode append does not replay previously consumed source ranges", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-session-diff-verified-append-"));
  const sessionsDir = join(root, "sessions");
  const file = join(sessionsDir, "rollout-2026-07-09T00-00-00-019f-session-diff-verified-append.jsonl");
  const threadId = "019f-session-diff-verified-append";
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    writeSyntheticCodexSession(file, {
      threadId,
      title: "Verified append fixture",
      finalMessage: "Final: verified append baseline."
    });
    assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
    const baseline = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:01:00.000Z",
      limit: 500,
      tokenBudget: 8000
    });
    const baselineKeys = new Set((db.prepare(`
      SELECT session_diff_key AS sessionDiffKey
      FROM prepared_source_ranges
      WHERE thread_id = ?
    `).all(threadId) as Array<{ sessionDiffKey: string }>).map((row) => row.sessionDiffKey));

    appendFileSync(file, `${JSON.stringify({
      timestamp: "2026-07-09T00:02:00.000Z",
      event_msg: { type: "agent_message", message: "Final: verified append delta." }
    })}\n`);
    const indexed = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10, verify: true });
    assert.equal(indexed.indexedFiles, 1);

    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z",
      limit: 500,
      tokenBudget: 8000
    });
    assert.equal(diff.cursor.status, "accepted");
    assert.ok(diff.changes.some((change) => change.changeKind === "source_range"));
    for (const change of diff.changes.filter((item) => item.changeKind === "source_range")) {
      const range = change.item as { sourcePathRef: string; ordinal: number; rangeKind: string; contentHash: string };
      const semanticKey = `${range.sourcePathRef}:${String(range.ordinal).padStart(12, "0")}:${range.rangeKind}:${range.contentHash}`;
      assert.equal(baselineKeys.has(semanticKey), false, `replayed baseline range ${semanticKey}`);
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session diff does not replay prepared state when event-content storage is re-enabled", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-session-diff-event-content-reenable-"));
  const sessionsDir = join(root, "sessions");
  const file = join(sessionsDir, "rollout-2026-07-09T00-00-00-019f-session-diff-event-content-reenable.jsonl");
  const threadId = "019f-session-diff-event-content-reenable";
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    writeSyntheticCodexSession(file, {
      threadId,
      title: "Session diff event-content re-enable",
      finalMessage: "Final: unchanged source for cache backfill."
    });
    assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10, eventContent: false }).indexedFiles, 1);
    const baseline = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:01:00.000Z"
    });

    const backfill = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10, eventContent: true });
    assert.equal(backfill.indexedFiles, 1);
    assert.ok(Number((db.prepare("SELECT COUNT(*) AS count FROM codex_event_content").get() as { count: number }).count) > 0);
    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:02:00.000Z"
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.equal(diff.summary.returned, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session diff does not replay prepared state when only source mtime changes", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-session-diff-mtime-only-"));
  const sessionsDir = join(root, "sessions");
  const file = join(sessionsDir, "rollout-2026-07-09T00-00-00-019f-session-diff-mtime-only.jsonl");
  const threadId = "019f-session-diff-mtime-only";
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    writeSyntheticCodexSession(file, {
      threadId,
      title: "Session diff mtime only",
      finalMessage: "Final: source content stays identical."
    });
    assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
    const baseline = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:01:00.000Z"
    });

    const changedMtime = new Date("2026-07-09T00:02:00.000Z");
    utimesSync(file, changedMtime, changedMtime);
    const refresh = indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 });
    assert.equal(refresh.indexedFiles, 0);
    assert.equal(refresh.skippedFiles, 1);
    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z"
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.equal(diff.summary.returned, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session diff scoped cursor ignores destructive changes to another thread", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-session-diff-scoped-integrity-"));
  const sessionsDir = join(root, "sessions");
  const firstFile = join(sessionsDir, "rollout-2026-07-09T00-00-00-019f-session-diff-scope-a.jsonl");
  const secondFile = join(sessionsDir, "rollout-2026-07-09T00-00-01-019f-session-diff-scope-b.jsonl");
  const firstThreadId = "019f-session-diff-scope-a";
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    writeSyntheticCodexSession(firstFile, {
      threadId: firstThreadId,
      title: "Scoped source A",
      finalMessage: "Final: source A stays unchanged."
    });
    writeSyntheticCodexSession(secondFile, {
      threadId: "019f-session-diff-scope-b",
      title: "Scoped source B",
      finalMessage: "Final: source B before rewrite."
    });
    assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 2);
    const baseline = getSessionDiff(db, {
      threadId: firstThreadId,
      now: "2026-07-09T00:01:00.000Z"
    });

    writeSyntheticCodexSession(secondFile, {
      threadId: "019f-session-diff-scope-b",
      title: "Scoped source B rewritten",
      finalMessage: "Final: source B changed independently.",
      timestamp: "2026-07-09T00:02:00.000Z"
    });
    assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10, verify: true }).indexedFiles, 1);
    const diff = getSessionDiff(db, {
      threadId: firstThreadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z"
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.equal(diff.summary.returned, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session diff marks a same-path growing source rotation stale when prior content is replaced", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-source-rotate";
    const sourceHashBefore = id("source-rotate-before");
    const sourceHashAfter = id("source-rotate-after");
    insertSession(db, threadId);
    db.prepare("UPDATE codex_source_files SET path_hash = ?, content_epoch = ?, append_generation = 0 WHERE source_path = ?")
      .run(sourceHashBefore, sourceHashBefore, `/Users/lume/.codex/sessions/${threadId}.jsonl`);
    insertPreparedRange(db, {
      threadId,
      ordinal: 1,
      sourceHash: sourceHashBefore,
      createdAt: "2026-07-09T00:00:00.000Z"
    });
    const baseline = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:01:00.000Z"
    });

    db.prepare("UPDATE codex_source_files SET path_hash = ?, content_epoch = ?, append_generation = 0, size = 4096 WHERE source_path = ?")
      .run(sourceHashAfter, sourceHashAfter, `/Users/lume/.codex/sessions/${threadId}.jsonl`);
    db.prepare("DELETE FROM prepared_source_ranges WHERE thread_id = ?").run(threadId);
    db.prepare("DELETE FROM prepared_source_events WHERE thread_id = ?").run(threadId);
    insertPreparedRange(db, {
      threadId,
      ordinal: 1,
      sourceHash: sourceHashAfter,
      createdAt: "2026-07-09T00:02:00.000Z"
    });
    insertPreparedRange(db, {
      threadId,
      ordinal: 2,
      sourceHash: sourceHashAfter,
      createdAt: "2026-07-09T00:02:01.000Z"
    });
    db.prepare("UPDATE prepared_source_events SET content_hash = ? WHERE thread_id = ? AND ordinal = 1")
      .run(id("rotated-event-content"), threadId);
    db.prepare("UPDATE prepared_source_ranges SET content_hash = ? WHERE thread_id = ? AND ordinal = 1")
      .run(id("rotated-range-content"), threadId);

    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z"
    });

    assert.equal(diff.cursor.status, "stale");
    assert.ok(diff.cursor.reasonCodes.includes("source_history_rewritten"));
  });
});

test("session diff filters or redacts seeded privacy canaries across leaf card and watcher rows", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-privacy-canary";
    const changedAt = "2026-07-09T00:01:00.000Z";
    const canary = "PRIVATE_CANARY_SESSION_DIFF_1234567890 /Users/lume/private/customer.jsonl ghp_abcdefghijklmnopqrstuvwxyz123456";
    insertSession(db, threadId);
    const rangeRef = insertPreparedRange(db, { threadId, ordinal: 1, createdAt: changedAt });
    insertSummaryLeaf(db, {
      threadId,
      ordinal: 1,
      sourceRangeRef: rangeRef,
      createdAt: changedAt
    });
    insertPreparedCard(db, threadId, rangeRef, changedAt);
    persistWatcherObservations(db, [watcherSpec(threadId, changedAt)], { now: changedAt });

    db.prepare("UPDATE summary_leaves SET summary_text = ? WHERE thread_id = ?").run(canary, threadId);
    db.prepare("UPDATE prepared_cards SET summary_text = ? WHERE target_ref = ?")
      .run(canary, `codex_thread:${threadId}`);
    const watcherRow = db.prepare("SELECT observation_id AS observationId, observation_json AS observationJson FROM watcher_observations WHERE target_ref = ?")
      .get(`codex_thread:${threadId}`) as { observationId: string; observationJson: string };
    const watcherRecord = JSON.parse(watcherRow.observationJson) as Record<string, unknown>;
    watcherRecord.approvalBoundary = canary;
    db.prepare("UPDATE watcher_observations SET observation_json = ? WHERE observation_id = ?")
      .run(JSON.stringify(watcherRecord), watcherRow.observationId);

    const diff = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:02:00.000Z",
      limit: 20,
      tokenBudget: 2000
    });
    const serialized = JSON.stringify(diff);

    assert.ok(diff.omitted.filteredUnsafeRows >= 2);
    assert.ok(diff.changes.some((change) => change.changeKind === "watcher_observation"));
    assert.match(serialized, /<redacted-secret>/);
    assert.doesNotMatch(serialized, /PRIVATE_CANARY|\/Users\/lume|ghp_[A-Za-z0-9_]+/);
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

    db.prepare("UPDATE codex_source_files SET path_hash = ?, content_epoch = ?, append_generation = 0 WHERE source_path = ?")
      .run(id("source-after"), id("source-after"), `/Users/lume/.codex/sessions/${threadId}.jsonl`);
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

test("session diff cursor drains omitted changes instead of advancing past them", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-drain";
    insertSession(db, threadId);
    for (let index = 0; index < 5; index += 1) {
      const range = insertPreparedRange(db, {
        threadId,
        ordinal: index + 1,
        createdAt: `2026-07-09T00:0${index}:00.000Z`
      });
      insertSummaryLeaf(db, {
        threadId,
        ordinal: index + 1,
        sourceRangeRef: range,
        summaryText: `Drainable public-safe summary ${index}`,
        createdAt: `2026-07-09T00:0${index}:01.000Z`
      });
    }

    const firstPage = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:10:00.000Z",
      limit: 2,
      tokenBudget: 800
    });
    assert.equal(firstPage.omitted.reasons.includes("limit"), true);
    const firstRefs = new Set(firstPage.changes.map((change) => change.changeRef));

    const secondPage = getSessionDiff(db, {
      threadId,
      cursor: firstPage.cursor.nextCursor,
      now: "2026-07-09T00:11:00.000Z",
      limit: 20,
      tokenBudget: 8000
    });
    assert.equal(secondPage.cursor.status, "accepted");
    assert.ok(secondPage.summary.returned > 0);
    assert.ok(secondPage.changes.every((change) => !firstRefs.has(change.changeRef)));
    assert.ok(secondPage.changes.some((change) => change.changedAt < firstPage.generatedAt));
  });
});

test("session diff target-ref matching does not overmatch prefix-colliding summary leaves", () => {
  withSessionDiffDb((db) => {
    const shortThreadId = "abc";
    const longThreadId = "abcdef";
    insertSession(db, shortThreadId);
    insertSession(db, longThreadId);
    const shortRange = insertPreparedRange(db, {
      threadId: shortThreadId,
      ordinal: 1,
      createdAt: "2026-07-09T00:01:00.000Z"
    });
    const longRange = insertPreparedRange(db, {
      threadId: longThreadId,
      ordinal: 1,
      createdAt: "2026-07-09T00:01:00.000Z"
    });
    insertSummaryLeaf(db, {
      threadId: shortThreadId,
      ordinal: 1,
      sourceRangeRef: shortRange,
      summaryText: "Short thread leaf",
      createdAt: "2026-07-09T00:01:01.000Z"
    });
    insertSummaryLeaf(db, {
      threadId: longThreadId,
      ordinal: 1,
      sourceRangeRef: longRange,
      summaryText: "Long prefix-colliding thread leaf",
      createdAt: "2026-07-09T00:01:01.000Z"
    });

    const diff = getSessionDiff(db, {
      targetRef: `codex_thread:${shortThreadId}`,
      now: "2026-07-09T00:02:00.000Z",
      limit: 20,
      tokenBudget: 2000
    });

    const leafChanges = diff.changes.filter((change) => change.changeKind === "summary_leaf");
    assert.equal(leafChanges.length, 1);
    assert.equal(leafChanges[0]?.threadId, shortThreadId);
    assert.equal(diff.summary.changedSummaryLeaves, 1);
  });
});

test("session diff rejects tampered signed cursors", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-signed";
    const cursorSigningKey = "test-session-diff-cursor-key";
    insertSession(db, threadId);
    insertPreparedRange(db, { threadId, ordinal: 1, createdAt: "2026-07-09T00:00:00.000Z" });
    const baseline = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:01:00.000Z",
      cursorSigningKey
    });
    const [, encodedPayload, signature] = baseline.cursor.nextCursor.match(/^lco_cursor_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/) ?? [];
    assert.ok(encodedPayload);
    assert.ok(signature);
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>;
    payload.issuedAt = "1970-01-01T00:00:00.000Z";
    const tamperedCursor = `lco_cursor_${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;

    const diff = getSessionDiff(db, {
      threadId,
      cursor: tamperedCursor,
      now: "2026-07-09T00:02:00.000Z",
      cursorSigningKey
    });

    assert.equal(diff.cursor.status, "invalid");
    assert.ok(diff.cursor.reasonCodes.includes("cursor_signature_invalid"));
  });
});

test("session diff rejects signed cursors with trailing segments", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-trailing-segment";
    insertSession(db, threadId);
    const baseline = getSessionDiff(db, { threadId, now: "2026-07-09T00:01:00.000Z" });

    const diff = getSessionDiff(db, {
      threadId,
      cursor: `${baseline.cursor.nextCursor}.attacker-suffix`,
      now: "2026-07-09T00:02:00.000Z"
    });

    assert.equal(diff.cursor.status, "invalid");
  });
});

test("session diff empty cursor does not lose a row committed at its issuance timestamp", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-empty-same-ms";
    const issuedAt = "2026-07-09T00:01:00.000Z";
    insertSession(db, threadId);
    const baseline = getSessionDiff(db, { threadId, now: issuedAt });
    assert.equal(baseline.summary.returned, 0);

    insertPreparedRange(db, { threadId, ordinal: 1, createdAt: issuedAt });
    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:02:00.000Z"
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.equal(diff.summary.changedSourceRanges, 1);
    assert.equal(diff.changes.filter((change) => change.changeKind === "source_range").length, 1);
  });
});

test("session diff rejects unsigned cursors when signing is configured", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-unsigned";
    insertSession(db, threadId);
    insertPreparedRange(db, { threadId, ordinal: 1, createdAt: "2026-07-09T00:00:00.000Z" });
    const baseline = getSessionDiff(db, { threadId, now: "2026-07-09T00:01:00.000Z" });
    const unsignedCursor = baseline.cursor.nextCursor.split(".", 1)[0]!;

    const diff = getSessionDiff(db, {
      threadId,
      cursor: unsignedCursor,
      now: "2026-07-09T00:02:00.000Z"
    });

    assert.equal(diff.cursor.status, "invalid");
    assert.ok(diff.cursor.reasonCodes.includes("cursor_signature_missing"));
  });
});

test("session diff cursor size stays bounded as source hash cardinality grows", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-bounded-cursor";
    insertSession(db, threadId);
    db.exec("BEGIN");
    try {
      for (let ordinal = 1; ordinal <= 3000; ordinal += 1) {
        insertPreparedRange(db, {
          threadId,
          ordinal,
          sourceHash: id(`distinct-source-hash:${ordinal}`),
          createdAt: "2026-07-09T00:00:00.000Z"
        });
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const diff = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:01:00.000Z",
      limit: 1,
      tokenBudget: 20
    });

    assert.ok(diff.cursor.nextCursor.length < 4096, `cursor length was ${diff.cursor.nextCursor.length}`);
  });
});

test("session diff rejects oversized cursor input before decoding", () => {
  withSessionDiffDb((db) => {
    const diff = getSessionDiff(db, {
      cursor: `lco_cursor_${"A".repeat(20_000)}`,
      now: "2026-07-09T00:01:00.000Z"
    });

    assert.equal(diff.cursor.status, "invalid");
    assert.ok(diff.cursor.reasonCodes.includes("cursor_too_long"));
  });
});

test("session diff core requires an explicit persistent signing key", () => {
  withSessionDiffDb((db) => {
    const previousLcoKey = process.env.LCO_SESSION_DIFF_CURSOR_KEY;
    const previousLooKey = process.env.LOO_SESSION_DIFF_CURSOR_KEY;
    delete process.env.LCO_SESSION_DIFF_CURSOR_KEY;
    delete process.env.LOO_SESSION_DIFF_CURSOR_KEY;
    try {
      assert.throws(
        () => getSessionDiffCore(db, { now: "2026-07-09T00:00:00.000Z" }),
        (error: unknown) => error instanceof Error
          && /session diff cursor signing key is required/i.test(error.message)
          && /LCO_SESSION_DIFF_CURSOR_KEY/.test(error.message)
      );
    } finally {
      if (previousLcoKey === undefined) delete process.env.LCO_SESSION_DIFF_CURSOR_KEY;
      else process.env.LCO_SESSION_DIFF_CURSOR_KEY = previousLcoKey;
      if (previousLooKey === undefined) delete process.env.LOO_SESSION_DIFF_CURSOR_KEY;
      else process.env.LOO_SESSION_DIFF_CURSOR_KEY = previousLooKey;
    }
  });
});

test("session diff read-only audit-key lookup creates no filesystem artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-session-diff-audit-key-"));
  try {
    const auditPath = join(root, "missing", "audit.jsonl");
    assert.equal(fingerprintAuditTextIfConfigured(auditPath, "lco_session_diff_cursor_v1"), null);
    assert.equal(existsSync(join(root, "missing")), false);
    assert.equal(existsSync(`${auditPath}.key`), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("session diff cursor scope binds exact null and non-null targets and ignores invalid cursor watermarks", () => {
  withSessionDiffDb((db) => {
    const firstThreadId = "019f-session-diff-scope-first";
    const secondThreadId = "019f-session-diff-scope-second";
    insertSession(db, firstThreadId);
    insertSession(db, secondThreadId);
    insertPreparedRange(db, {
      threadId: firstThreadId,
      ordinal: 1,
      createdAt: "2026-07-09T00:05:00.000Z"
    });
    const secondRange = insertPreparedRange(db, {
      threadId: secondThreadId,
      ordinal: 1,
      createdAt: "2026-07-09T00:01:00.000Z"
    });
    const scoped = getSessionDiff(db, {
      threadId: firstThreadId,
      now: "2026-07-09T00:10:00.000Z"
    });

    const unscopedReuse = getSessionDiff(db, {
      cursor: scoped.cursor.nextCursor,
      now: "2026-07-09T00:11:00.000Z"
    });
    assert.equal(unscopedReuse.cursor.status, "invalid");
    assert.ok(unscopedReuse.cursor.reasonCodes.includes("cursor_thread_mismatch"));

    const crossScopeReuse = getSessionDiff(db, {
      threadId: secondThreadId,
      cursor: scoped.cursor.nextCursor,
      now: "2026-07-09T00:12:00.000Z"
    });
    assert.equal(crossScopeReuse.cursor.status, "invalid");
    assert.ok(crossScopeReuse.cursor.reasonCodes.includes("cursor_thread_mismatch"));
    assert.ok(crossScopeReuse.changes.some((change) => change.sourceRangeRefs.includes(secondRange)));

    const unscoped = getSessionDiff(db, { now: "2026-07-09T00:13:00.000Z" });
    const scopedReuse = getSessionDiff(db, {
      threadId: firstThreadId,
      cursor: unscoped.cursor.nextCursor,
      now: "2026-07-09T00:14:00.000Z"
    });
    assert.equal(scopedReuse.cursor.status, "invalid");
    assert.ok(scopedReuse.cursor.reasonCodes.includes("cursor_thread_mismatch"));
  });
});

test("session diff rejects malformed thread and target scope instead of widening the query", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-valid-scope";
    insertSession(db, threadId);
    insertPreparedRange(db, { threadId, ordinal: 1, createdAt: "2026-07-09T00:00:00.000Z" });

    assert.throws(
      () => getSessionDiff(db, { threadId: "/Users/lume/private/session.jsonl" }),
      /invalid session diff thread id/i
    );
    assert.throws(
      () => getSessionDiff(db, { targetRef: "../../private/session.jsonl" }),
      /invalid session diff target ref/i
    );
  });
});

test("session diff rejects conflicting thread and target scopes", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-conflicting-scope";
    insertSession(db, threadId);

    assert.throws(
      () => getSessionDiff(db, {
        threadId,
        targetRef: "codex_thread:different-session"
      }),
      /conflicting session diff scope/i
    );
    assert.doesNotThrow(() => getSessionDiff(db, {
      threadId,
      targetRef: `codex_thread:${threadId}`
    }));
  });
});

test("session diff drains more than 2000 same-timestamp rows without loss or duplicates", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-large-drain";
    insertSession(db, threadId);
    db.exec("BEGIN");
    try {
      for (let ordinal = 1; ordinal <= 2001; ordinal += 1) {
        insertPreparedRange(db, {
          threadId,
          ordinal,
          createdAt: "2026-07-09T00:00:00.000Z"
        });
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 60 && seen.size < 2001; page += 1) {
      const diff = getSessionDiff(db, {
        threadId,
        cursor,
        now: `2026-07-09T00:${String(page + 1).padStart(2, "0")}:00.000Z`,
        limit: 500,
        tokenBudget: 8000
      });
      for (const change of diff.changes.filter((item) => item.changeKind === "source_range")) {
        assert.equal(seen.has(change.changeRef), false, `duplicate change ${change.changeRef}`);
        seen.add(change.changeRef);
      }
      cursor = diff.cursor.nextCursor;
      if (diff.summary.returned === 0) break;
    }

    assert.equal(seen.size, 2001);
  });
});

test("session diff keyset collectors use bounded time and key indexes", () => {
  withSessionDiffDb((db) => {
    const plans = [
      {
        name: "prepared_source_ranges_session_diff_key_idx",
        sql: `SELECT range_ref FROM prepared_source_ranges
          WHERE (created_at, session_diff_key) > (?, ?)
          ORDER BY created_at ASC, session_diff_key ASC
          LIMIT ?`
      },
      {
        name: "summary_leaves_session_diff_idx",
        sql: "SELECT leaf_ref FROM summary_leaves WHERE (created_at, leaf_ref) > (?, ?) ORDER BY created_at ASC, leaf_ref ASC LIMIT ?"
      },
      {
        name: "prepared_cards_session_diff_idx",
        sql: "SELECT card_ref FROM prepared_cards WHERE (updated_at, card_ref) > (?, ?) ORDER BY updated_at ASC, card_ref ASC LIMIT ?"
      },
      {
        name: "prepared_inbox_session_diff_idx",
        sql: "SELECT item_id FROM prepared_inbox_items WHERE (updated_at, item_id) > (?, ?) ORDER BY updated_at ASC, item_id ASC LIMIT ?"
      },
      {
        name: "watcher_observations_session_diff_idx",
        sql: "SELECT observation_id FROM watcher_observations WHERE (created_at, observation_id) > (?, ?) ORDER BY created_at ASC, observation_id ASC LIMIT ?"
      }
    ];
    for (const plan of plans) {
      const detail = (db.prepare(`EXPLAIN QUERY PLAN ${plan.sql}`).all("2026-07-09T00:00:00.000Z", "cursor-key", 2001) as Array<{ detail: string }>)
        .map((row) => row.detail)
        .join("\n");
      assert.match(detail, new RegExp(`SEARCH .* USING (?:COVERING )?INDEX ${plan.name}`));
      if (plan.name === "prepared_source_ranges_session_diff_key_idx") {
        assert.match(detail, /\(created_at,session_diff_key\)>\(\?,\?\)/);
      }
      assert.doesNotMatch(detail, /USE TEMP B-TREE/);
    }
  });
});

test("session diff does not miss a same-timestamp replacement with a lower hashed ref", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-rowid-reuse";
    const changedAt = "2026-07-09T00:01:00.000Z";
    insertSession(db, threadId);
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      insertPreparedRange(db, { threadId, ordinal, createdAt: changedAt });
    }
    const largestInitialRangeRef = [1, 2, 3]
      .map((ordinal) => `codex_range:${id(`range:${threadId}:${ordinal}`)}`)
      .sort()
      .at(-1)!;
    const baseline = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:02:00.000Z",
      limit: 500,
      tokenBudget: 8000
    });

    db.prepare("DELETE FROM prepared_source_ranges WHERE thread_id = ? AND ordinal = 3").run(threadId);
    db.prepare("DELETE FROM prepared_source_events WHERE thread_id = ? AND ordinal = 3").run(threadId);
    let replacementOrdinal = 4;
    while (`codex_range:${id(`range:${threadId}:${replacementOrdinal}`)}` >= largestInitialRangeRef) {
      replacementOrdinal += 1;
    }
    const replacementRangeRef = insertPreparedRange(db, {
      threadId,
      ordinal: replacementOrdinal,
      createdAt: changedAt
    });

    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z",
      limit: 500,
      tokenBudget: 8000
    });

    assert.equal(diff.cursor.status, "accepted");
    assert.ok(diff.changes.some((change) => change.sourceRangeRefs.includes(replacementRangeRef)));
  });
});

test("session diff advances past unsafe-only scan pages", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-unsafe-progress";
    insertSession(db, threadId);
    insertPreparedRange(db, {
      threadId,
      ordinal: 1,
      createdAt: "2026-07-09T00:01:00.000Z"
    });
    db.prepare("UPDATE prepared_source_ranges SET privacy_class = 'private' WHERE thread_id = ?").run(threadId);

    const first = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:02:00.000Z"
    });
    assert.equal(first.summary.returned, 0);
    assert.equal(first.omitted.filteredUnsafeRows, 1);

    const second = getSessionDiff(db, {
      threadId,
      cursor: first.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z"
    });
    assert.equal(second.cursor.status, "accepted");
    assert.equal(second.omitted.filteredUnsafeRows, 0);
  });
});

test("session diff does not advance a later-kind cursor past an incomplete unsafe scan page", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-unsafe-frontier";
    insertSession(db, threadId);
    db.exec("BEGIN");
    try {
      const rangeRefs: string[] = [];
      for (let ordinal = 1; ordinal <= 2001; ordinal += 1) {
        rangeRefs.push(insertPreparedRange(db, {
          threadId,
          ordinal,
          createdAt: "2026-07-09T00:01:00.000Z"
        }));
      }
      const finalRange = rangeRefs.at(-1)!;
      insertSummaryLeaf(db, {
        threadId,
        ordinal: 1,
        sourceRangeRef: finalRange,
        createdAt: "2026-07-09T00:01:00.000Z"
      });
      db.prepare("UPDATE prepared_source_ranges SET privacy_class = 'private' WHERE thread_id = ? AND range_ref <> ?")
        .run(threadId, finalRange);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const first = getSessionDiff(db, {
      threadId,
      now: "2026-07-09T00:02:00.000Z",
      limit: 500,
      tokenBudget: 8000
    });
    assert.equal(first.summary.returned, 0);
    assert.equal(first.omitted.filteredUnsafeRows, 2000);

    const second = getSessionDiff(db, {
      threadId,
      cursor: first.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z",
      limit: 500,
      tokenBudget: 8000
    });
    assert.ok(second.changes.some((change) => change.changeKind === "source_range"));
    assert.ok(second.changes.some((change) => change.changeKind === "summary_leaf"));
  });
});

test("session diff marks a cursor stale when its indexed source disappears", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-missing-source";
    insertSession(db, threadId);
    insertPreparedRange(db, { threadId, ordinal: 1, createdAt: "2026-07-09T00:00:00.000Z" });
    const baseline = getSessionDiff(db, { threadId, now: "2026-07-09T00:01:00.000Z" });

    db.prepare("DELETE FROM codex_source_files").run();
    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:02:00.000Z"
    });

    assert.equal(diff.cursor.status, "stale");
    assert.ok(diff.cursor.reasonCodes.includes("source_missing"));
  });
});

test("session diff marks truncate or delete count decreases stale", () => {
  withSessionDiffDb((db) => {
    const threadId = "019f-session-diff-truncate";
    insertSession(db, threadId);
    insertPreparedRange(db, { threadId, ordinal: 1, createdAt: "2026-07-09T00:00:00.000Z" });
    insertPreparedRange(db, { threadId, ordinal: 2, createdAt: "2026-07-09T00:01:00.000Z" });
    const baseline = getSessionDiff(db, { threadId, now: "2026-07-09T00:02:00.000Z" });

    db.prepare("DELETE FROM prepared_source_ranges WHERE thread_id = ? AND ordinal = 2").run(threadId);
    db.prepare("DELETE FROM prepared_source_events WHERE thread_id = ? AND ordinal = 2").run(threadId);
    const diff = getSessionDiff(db, {
      threadId,
      cursor: baseline.cursor.nextCursor,
      now: "2026-07-09T00:03:00.000Z"
    });

    assert.equal(diff.cursor.status, "stale");
    assert.ok(diff.cursor.reasonCodes.includes("source_event_count_decreased"));
    assert.ok(diff.cursor.reasonCodes.includes("source_range_count_decreased"));
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
          throw new Error("read-only session diff must not create an audit fingerprint key");
        },
        fingerprintTextIfConfigured() {
          return TEST_CURSOR_SIGNING_KEY;
        },
        fingerprintValue() {
          return TEST_CURSOR_SIGNING_KEY;
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

test("session diff tool keeps an explicit environment signing key authoritative", () => {
  withSessionDiffDb((db) => {
    const previousLcoKey = process.env.LCO_SESSION_DIFF_CURSOR_KEY;
    process.env.LCO_SESSION_DIFF_CURSOR_KEY = TEST_CURSOR_SIGNING_KEY;
    try {
      const baseline = getSessionDiffCore(db, { now: "2026-07-09T00:01:00.000Z" });
      const tools = createLooTools({
        db,
        audit: {
          path: "test",
          append() { throw new Error("not used"); },
          find() { return null; },
          tail() { return []; },
          fingerprintText() { return "different-audit-key"; },
          fingerprintTextIfConfigured() { return "different-audit-key"; },
          fingerprintValue() { return "different-audit-key"; }
        },
        codexClient: { async request() { throw new Error("not used"); } }
      });
      const tool = tools.find((entry) => entry.name === "lco_session_diff");
      assert.ok(tool);
      const report = tool.execute({
        cursor: baseline.cursor.nextCursor,
        now: "2026-07-09T00:02:00.000Z"
      }) as ReturnType<typeof getSessionDiff>;
      assert.equal(report.cursor.status, "accepted");
    } finally {
      if (previousLcoKey === undefined) delete process.env.LCO_SESSION_DIFF_CURSOR_KEY;
      else process.env.LCO_SESSION_DIFF_CURSOR_KEY = previousLcoKey;
    }
  });
});

test("session diff tool returns path-free setup guidance for missing or invalid signing keys", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-session-diff-setup-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const previousLcoKey = process.env.LCO_SESSION_DIFF_CURSOR_KEY;
  const previousLooKey = process.env.LOO_SESSION_DIFF_CURSOR_KEY;
  delete process.env.LCO_SESSION_DIFF_CURSOR_KEY;
  delete process.env.LOO_SESSION_DIFF_CURSOR_KEY;
  try {
    for (const fingerprintTextIfConfigured of [
      () => null,
      () => { throw new Error("Audit fingerprint key is invalid: /Users/lume/private/audit.jsonl.key"); },
      () => { throw new Error("EACCES: permission denied, open /Users/lume/private/audit.jsonl.key"); }
    ]) {
      const tools = createLooTools({
        db,
        audit: {
          path: "test",
          append() { throw new Error("not used"); },
          find() { return null; },
          tail() { return []; },
          fingerprintText() { throw new Error("not used"); },
          fingerprintTextIfConfigured,
          fingerprintValue() { throw new Error("not used"); }
        },
        codexClient: { async request() { throw new Error("not used"); } }
      });
      const tool = tools.find((entry) => entry.name === "lco_session_diff");
      assert.ok(tool);
      const response = await executeLooToolForOpenClaw(tool, {}) as {
        schema?: string;
        publicSafe?: boolean;
        status?: string;
        blockers?: string[];
      };
      assert.equal(response.schema, "lco.session.diff.setup.v1");
      assert.equal(response.publicSafe, true);
      assert.equal(response.status, "setup_required");
      assert.deepEqual(response.blockers, ["session_diff_cursor_signing_key_required"]);
      assert.doesNotMatch(JSON.stringify(response), /\/Users\/lume|private|audit\.jsonl\.key/);
    }
  } finally {
    if (previousLcoKey === undefined) delete process.env.LCO_SESSION_DIFF_CURSOR_KEY;
    else process.env.LCO_SESSION_DIFF_CURSOR_KEY = previousLcoKey;
    if (previousLooKey === undefined) delete process.env.LOO_SESSION_DIFF_CURSOR_KEY;
    else process.env.LOO_SESSION_DIFF_CURSOR_KEY = previousLooKey;
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session diff MCP schema and OpenClaw boundary reject oversized cursors", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-session-diff-mcp-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const declarations = createLooToolDeclarations({ includeAliases: true });
    const declaration = declarations.find((tool) => tool.name === "lco_session_diff");
    assert.ok(declaration);
    const properties = declaration.inputSchema.properties as Record<string, Record<string, unknown>>;
    assert.equal(properties.cursor?.maxLength, 16_384);

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
          return TEST_CURSOR_SIGNING_KEY;
        },
        fingerprintValue() {
          return TEST_CURSOR_SIGNING_KEY;
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
    const response = await executeLooToolForOpenClaw(tool, {
      cursor: `lco_cursor_${"A".repeat(20_000)}`
    }) as { code?: string; error?: { message?: string } };

    assert.equal(response.code, "validation_failed");
    assert.match(response.error?.message ?? "", /cursor.*maximum/i);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
