import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabase,
  getPreparedCards,
  getPreparedInbox,
  getPreparedStateStatus,
  indexCodexSessions,
  indexNativeCodexSubagentResults,
  materializePreparedCards,
  materializeSummaryLeaves
} from "../packages/core/src/index.js";
import { createLooToolDeclarations, createLooTools } from "../packages/mcp-server/src/tools.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => ReturnType<typeof createDatabase> };

function writePreparedCardJsonl(path: string, threadId: string, title: string): void {
  const lines = [
    { timestamp: "2026-07-03T00:00:00Z", session_meta: { payload: { id: threadId, model: "gpt-5.4-mini" } } },
    { timestamp: "2026-07-03T00:00:01Z", event_msg: { type: "thread_name", name: title } },
    { timestamp: "2026-07-03T00:00:02Z", event_msg: { type: "user_message", message: "Please prepare a public-safe state card without reading raw transcript payloads." } },
    {
      timestamp: "2026-07-03T00:00:03Z",
      response_item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "<proposed_plan>\n1. Build prepared cards.\n</proposed_plan>" }]
      }
    },
    {
      timestamp: "2026-07-03T00:00:04Z",
      response_item: {
        type: "function_call",
        call_id: "call_private_payload",
        name: "functions.exec_command",
        arguments: JSON.stringify({ cmd: "cat /Users/lume/private/customer.txt PRIVATE_CANARY_TOKEN_1234567890" })
      }
    },
    { timestamp: "2026-07-03T00:00:05Z", event_msg: { type: "agent_message", message: "Final: prepared card proof complete. Closeout State: done." } }
  ];
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
}

function writePreparedWorkStateJsonl(path: string): string {
  const threadId = "019f-prepared-work-state";
  const lines = [
    { timestamp: "2026-07-05T10:00:00.000Z", session_meta: { payload: { id: threadId, model: "gpt-5.5" } } },
    { timestamp: "2026-07-05T10:00:01.000Z", event_msg: { type: "thread_name", name: "Stale starter title" } },
    { timestamp: "2026-07-05T10:00:02.000Z", event_msg: { type: "thread_name_updated", display_text: "Fresh prepared cards lane" } },
    {
      timestamp: "2026-07-05T10:00:03.000Z",
      response_item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "<proposed_plan>\n1. Old generic prep.\n2. Ignore older plan.\n</proposed_plan>" }]
      }
    },
    {
      timestamp: "2026-07-05T10:00:04.000Z",
      response_item: {
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: [
            "<proposed_plan>",
            "1. Deliver prepared card objective fields.",
            "2. Carry blocker details into the card.",
            "3. Verify prepared-card canaries.",
            "</proposed_plan>",
            "Touched packages/core/src/index.ts while keeping raw spans hidden."
          ].join("\n")
        }]
      }
    },
    {
      timestamp: "2026-07-05T10:00:05.000Z",
      event_msg: {
        type: "agent_message",
        message: "Final: prepared card derivation is ready for review. Next action: Verify prepared-card canaries."
      }
    }
  ];
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return threadId;
}

function writePreparedFinalOnlyJsonl(path: string): string {
  const threadId = "019f-prepared-final-only";
  const lines = [
    { timestamp: "2026-07-05T11:00:00.000Z", session_meta: { payload: { id: threadId, model: "gpt-5.5" } } },
    { timestamp: "2026-07-05T11:00:01.000Z", event_msg: { type: "thread_name", name: "Final-only card lane" } },
    {
      timestamp: "2026-07-05T11:00:02.000Z",
      event_msg: {
        type: "agent_message",
        message: "Final: deterministic final-only card proof is ready. Next action: Publish the review handoff."
      }
    }
  ];
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return threadId;
}

function writePreparedMarkedPlanJsonl(path: string): string {
  const threadId = "019f-prepared-marked-plan";
  const lines = [
    { timestamp: "2026-07-05T12:00:00.000Z", session_meta: { payload: { id: threadId, model: "gpt-5.5" } } },
    {
      timestamp: "2026-07-05T12:00:01.000Z",
      event_msg: {
        type: "thread_name",
        name: "<proposed_plan>\n## Debug Plan For Prepared Cards ### Summary Using only public-safe rows to reproduce flattened plan heading bleed after newlines are collapsed into one card field candidate with enough detail to exceed the old suffix-only cleanup limit."
      }
    },
    {
      timestamp: "2026-07-05T12:00:02.000Z",
      response_item: {
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: [
            "<proposed_plan>",
            "## Debug Plan For Prepared Cards ## Summary Using only public-safe rows to reproduce flattened plan heading bleed after newlines are collapsed into one card field candidate with enough detail to exceed the old suffix-only cleanup limit.",
            "## Summary",
            "1. Strip plan envelope from presentation fields. ### Summary",
            "2. Verify clean card fields.",
            "### Summary",
            "</proposed_plan>"
          ].join("\n")
        }]
      }
    },
    {
      timestamp: "2026-07-05T12:00:03.000Z",
      event_msg: {
        type: "agent_message",
        message: "Final: marked plan card cleanup is ready for review."
      }
    }
  ];
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return threadId;
}

function writePreparedDuplicateFinalOnlyJsonl(path: string): string {
  const threadId = "019f-prepared-duplicate-final";
  const lines = [
    { timestamp: "2026-07-05T13:00:00.000Z", session_meta: { payload: { id: threadId, model: "gpt-5.5" } } },
    { timestamp: "2026-07-05T13:00:01.000Z", event_msg: { type: "thread_name", name: "Ship final-only duplicate lane." } },
    {
      timestamp: "2026-07-05T13:00:02.000Z",
      event_msg: {
        type: "agent_message",
        message: "Final: Ship final-only duplicate lane."
      }
    }
  ];
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return threadId;
}

function summaryLeafText(leafKind: string, rangeCount: number): string {
  const label: Record<string, string> = {
    user_prompt: "User prompt evidence",
    assistant_message: "Assistant message evidence",
    proposed_plan: "Proposed plan evidence",
    final_message: "Final message evidence",
    closeout: "Closeout evidence",
    tool_call_metadata: "Tool-call metadata evidence",
    event_metadata: "Event metadata evidence"
  };
  return `${label[leafKind] ?? "Session evidence"}: ${rangeCount} prepared source range${rangeCount === 1 ? "" : "s"} available. Expand by summary leaf or source range for bounded evidence.`;
}

function insertSummaryLeafRow(
  db: ReturnType<typeof createDatabase>,
  input: {
    id: string;
    threadId: string;
    leafKind?: string;
    freshnessAt?: string;
    stale?: boolean;
    confidence?: number;
    authorityStatus?: string;
  }
): void {
  const leafKind = input.leafKind ?? "user_prompt";
  db.prepare(`
    INSERT OR IGNORE INTO codex_sessions (
      thread_id, title, source_path, safe_text, updated_at, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.threadId,
    `Prepared ${input.threadId}`,
    `prepared-card-${input.threadId}.jsonl`,
    "",
    input.freshnessAt ?? "2026-07-03T00:00:00.000Z",
    "2026-07-03T00:00:00.000Z"
  );
  db.prepare(`
    INSERT INTO summary_leaves (
      leaf_id, leaf_ref, thread_id, leaf_kind, summary_text, source_refs_json,
      source_range_refs_json, input_hash, output_hash, extractor_version,
      privacy_class, authority_coverage_json, confidence, freshness_at, stale,
      omission_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    `summary_leaf:${input.id}`,
    input.threadId,
    leafKind,
    summaryLeafText(leafKind, 1),
    JSON.stringify([`codex_thread:${input.threadId}`]),
    JSON.stringify([`codex_range:${input.id}`]),
    input.id,
    input.id.split("").reverse().join(""),
    "summary-leaves-v1",
    "public_safe_metadata",
    JSON.stringify({ source: "prepared_source_ranges", status: input.authorityStatus ?? "ok", rangeCount: 1 }),
    input.confidence ?? 0.9,
    input.freshnessAt ?? "2026-07-03T00:00:00.000Z",
    input.stale ? 1 : 0,
    "metadata_only",
    "2026-07-03T00:00:00.000Z"
  );
}

function insertSessionMetadataRow(
  db: ReturnType<typeof createDatabase>,
  input: {
    threadId: string;
    status?: string | null;
    priority?: string | null;
    blocker?: string | null;
    nextAction?: string | null;
    closeoutState?: string | null;
    planCompletionState?: string | null;
  }
): void {
  db.prepare(`
    INSERT INTO codex_session_metadata (
      thread_id, status, priority, blocker, next_action, closeout_state, plan_completion_state,
      proposed_plan_refs_json, final_message_refs_json, touched_file_refs_json,
      source_refs_json, metadata_schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      status = excluded.status,
      priority = excluded.priority,
      blocker = excluded.blocker,
      next_action = excluded.next_action,
      closeout_state = excluded.closeout_state,
      plan_completion_state = excluded.plan_completion_state,
      proposed_plan_refs_json = excluded.proposed_plan_refs_json,
      final_message_refs_json = excluded.final_message_refs_json,
      touched_file_refs_json = excluded.touched_file_refs_json,
      source_refs_json = excluded.source_refs_json,
      metadata_schema_version = excluded.metadata_schema_version
  `).run(
    input.threadId,
    input.status ?? null,
    input.priority ?? null,
    input.blocker ?? null,
    input.nextAction ?? null,
    input.closeoutState ?? null,
    input.planCompletionState ?? null,
    JSON.stringify([`codex_thread:${input.threadId}`]),
    JSON.stringify([`codex_thread:${input.threadId}`]),
    JSON.stringify([`codex_thread:${input.threadId}`]),
    JSON.stringify([`codex_thread:${input.threadId}`]),
    1
  );
}

function insertAttentionQueueRow(db: ReturnType<typeof createDatabase>, threadId: string, reasonCodes: string[] = ["ci_failed", "review_blocked"]): void {
  db.prepare(`
    INSERT INTO attention_queue (
      queue_id, target_ref, item_kind, status, tool_call_json, execute_false,
      source_refs_json, reason_codes_json, confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `attention-${threadId}-${reasonCodes.join("-").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 64)}`,
    `codex_thread:${threadId}`,
    "watcher_trigger",
    "open",
    null,
    1,
    JSON.stringify([`codex_thread:${threadId}`]),
    JSON.stringify(reasonCodes),
    0.91,
    "2026-07-05T10:00:06.000Z",
    "2026-07-05T10:00:06.000Z"
  );
}

function insertPreparedCardRow(
  db: ReturnType<typeof createDatabase>,
  input: {
    id: string;
    threadId: string;
    title?: string;
    summaryText?: string;
    sourceRefs?: string[];
    sourceRangeRefs?: string[];
    confidence?: number;
    stale?: boolean;
    state?: string;
    reasonCodes?: string[];
  }
): string {
  const cardRef = `prepared_card:${input.id}`;
  db.prepare(`
    INSERT INTO prepared_cards (
      card_id, card_ref, target_ref, card_kind, title, summary_text, next_action,
      source_refs_json, source_range_refs_json, source_range_refs_omitted, authority_coverage_json,
      input_hash, extractor_version, privacy_class, confidence, freshness_at,
      stale, state, reason_codes_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `card-${input.id}`,
    cardRef,
    `codex_thread:${input.threadId}`,
    "codex_session",
    input.title ?? `Prepared ${input.threadId}`,
    input.summaryText ?? "Prepared state: public-safe card.",
    "Review bounded summary evidence.",
    JSON.stringify(input.sourceRefs ?? [`codex_thread:${input.threadId}`, `summary_leaf:${input.id}`]),
    JSON.stringify(input.sourceRangeRefs ?? [`codex_range:${input.id}`]),
    0,
    JSON.stringify({
      summaryLeaves: { status: "ok", leafCount: 1, rangeCount: 1 },
      sessionMetadata: { status: "ok" },
      watcherObservations: { status: "not_configured" }
    }),
    input.id,
    "prepared-cards-v1",
    "public_safe_metadata",
    input.confidence ?? 0.9,
    "2026-07-03T00:00:00.000Z",
    input.stale ? 1 : 0,
    input.state ?? "ready",
    JSON.stringify(input.reasonCodes ?? ["summary_leaves_ready"]),
    "2026-07-03T00:00:00.000Z",
    "2026-07-03T00:00:00.000Z"
  );
  return cardRef;
}

function insertPreparedInboxRow(
  db: ReturnType<typeof createDatabase>,
  input: {
    id: string;
    cardRef: string;
    threadId: string;
    urgencyScore: number;
    state?: string;
    reasonCodes?: string[];
  }
): void {
  db.prepare(`
    INSERT INTO prepared_inbox_items (
      item_id, card_ref, target_ref, urgency_score, state, reason_codes_json,
      source_refs_json, execute_false, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `prepared_inbox:${input.id}`,
    input.cardRef,
    `codex_thread:${input.threadId}`,
    input.urgencyScore,
    input.state ?? "ready",
    JSON.stringify(input.reasonCodes ?? ["summary_leaves_ready"]),
    JSON.stringify([`codex_thread:${input.threadId}`, input.cardRef]),
    1,
    "2026-07-03T00:00:00.000Z",
    "2026-07-03T00:00:00.000Z"
  );
}

test("prepared cards materialize public-safe advisory cards and inbox entries", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-cards-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadId = "019f-prepared-cards";
  writePreparedCardJsonl(join(sessions, "rollout-2026-07-03T00-00-00-019f-prepared-cards.jsonl"), threadId, "Prepared cards proof");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    materializeSummaryLeaves(db, { threadId });
    const materialized = materializePreparedCards(db, { threadId });
    assert.equal(materialized.publicSafe, false);
    assert.deepEqual(materialized.mutationClasses, ["derived_cache"]);
    assert.equal(materialized.summary.cards, 1);
    assert.equal(materialized.summary.inboxItems, 1);

    const status = getPreparedStateStatus(db);
    assert.equal(status.publicSafe, true);
    assert.equal(status.readOnly, true);
    assert.equal(status.sourceCoverage.summaryLeaves, "ok");
    assert.equal(status.sourceCoverage.preparedCards, "ok");
    assert.equal(status.sourceCoverage.preparedInboxItems, "ok");

    const cards = getPreparedCards(db, { threadId, limit: 10 });
    const serialized = JSON.stringify(cards);
    assert.equal(cards.publicSafe, true);
    assert.equal(cards.readOnly, true);
    assert.equal(cards.summary.total, 1);
    assert.equal(cards.cards.length, 1);
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("PRIVATE_CANARY_TOKEN"), false);
    assert.equal(serialized.includes("customer.txt"), false);

    const card = cards.cards[0]!;
    assert.match(card.cardRef, /^prepared_card:[0-9a-f]{32}$/);
    assert.equal(card.targetRef, `codex_thread:${threadId}`);
    assert.equal(card.cardKind, "codex_session");
    assert.equal(card.privacyClass, "public_safe_metadata");
    assert.equal(card.sourceCoverage.summaryLeaves, "ok");
    assert.equal(card.sourceCoverage.watcherObservations, "not_configured");
    assert.equal(card.authorityCoverage.summaryLeaves.status, "ok");
    assert.equal(card.state, "ready");
    assert.equal(card.reasonCodes.includes("lifecycle:completed"), false);
    assert.equal(card.reasonCodes.includes("summary_leaves_ready"), true);
    assert.equal(card.sourceRefs.includes(`codex_thread:${threadId}`), true);
    assert.equal(card.sourceRefs.some((ref) => /^summary_leaf:[0-9a-f]{32}$/.test(ref)), true);
    assert.equal(card.sourceRangeRefs.every((ref) => /^codex_range:[0-9a-f]{32}$/.test(ref)), true);

    const inbox = getPreparedInbox(db, { limit: 10 });
    assert.equal(inbox.publicSafe, true);
    assert.equal(inbox.readOnly, true);
    assert.equal(inbox.summary.total, 1);
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0]!.cardRef, card.cardRef);
    assert.equal(inbox.items[0]!.targetRef, card.targetRef);
    assert.equal(inbox.items[0]!.sourceRefs.some((ref) => /^summary_leaf:[0-9a-f]{32}$/.test(ref)), true);
    assert.equal(inbox.items[0]!.execute, false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared cards carry real objective blocker next action and fresh renamed title", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-work-state-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadId = writePreparedWorkStateJsonl(join(sessions, "rollout-2026-07-05T10-00-00-019f-prepared-work-state.jsonl"));

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    insertAttentionQueueRow(db, threadId);
    materializeSummaryLeaves(db, { threadId });
    db.prepare(`
      UPDATE prepared_source_events
      SET extractor_version = ?
      WHERE thread_id = ?
        AND event_kind = 'thread_name_updated'
    `).run("prepared-source-events-v0", threadId);
    materializePreparedCards(db, { threadId });

    const cards = getPreparedCards(db, { threadId, limit: 10 });
    assert.equal(cards.cards.length, 1);
    const card = cards.cards[0]! as typeof cards.cards[number] & { objective?: string; blocker?: string | null };

    assert.equal(card.title, "Fresh prepared cards lane");
    assert.equal(card.objective, "Deliver prepared card objective fields.");
    assert.equal(card.nextAction, "Verify prepared-card canaries.");
    assert.equal(card.blocker, "ci failed; review blocked");
    assert.match(card.summaryText, /Blocked: ci failed; review blocked; next Verify prepared-card canaries/);
    assert.match(card.summaryText, /last touched index\.ts/);
    assert.doesNotMatch(card.summaryText, /summary leaf|prepared source range|Lifecycle:/i);
    assert.doesNotMatch(card.summaryText, /\b(?:Title|Final|Objective|Next action):/i);
    assert.equal(card.reasonCodes.includes("from_latest_plan"), true);
    assert.equal(card.reasonCodes.includes("from_final_message"), true);
    assert.equal(card.reasonCodes.includes("from_thread_rename"), true);
    assert.equal(card.reasonCodes.includes("from_attention_queue"), true);
    assert.equal(card.reasonCodes.includes("ci_failed"), true);
    assert.equal(JSON.stringify(card).includes("Touched packages/core/src/index.ts while keeping raw spans hidden"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared cards choose the first pending plan action when no explicit final next action exists", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-plan-first-action-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadId = "019f-prepared-plan-first-action";
  const lines = [
    { timestamp: "2026-07-05T11:15:00.000Z", session_meta: { payload: { id: threadId, model: "gpt-5.5" } } },
    { timestamp: "2026-07-05T11:15:01.000Z", event_msg: { type: "thread_name", name: "Plan first action lane" } },
    {
      timestamp: "2026-07-05T11:15:02.000Z",
      response_item: {
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: "<proposed_plan>1. The product goal is ready for card proof. 2. Build the earliest pending prepared-card proof. 3. Verify the later release proof.</proposed_plan>"
        }]
      }
    },
    {
      timestamp: "2026-07-05T11:15:03.000Z",
      event_msg: {
        type: "agent_message",
        message: "Final: Plan-only card proof remains in progress."
      }
    }
  ];
  writeFileSync(
    join(sessions, "rollout-2026-07-05T11-15-00-019f-prepared-plan-first-action.jsonl"),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    materializeSummaryLeaves(db, { threadId });
    materializePreparedCards(db, { threadId });

    const card = getPreparedCards(db, { threadId, limit: 10 }).cards[0]!;
    assert.equal(card.objective, "The product goal is ready for card proof.");
    assert.equal(card.nextAction, "Build the earliest pending prepared-card proof.");
    assert.doesNotMatch(card.summaryText, /Verify the later release proof/);
    assert.equal(card.reasonCodes.includes("from_latest_plan"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared cards derive next action from likely final messages without plan rows", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-final-only-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadId = writePreparedFinalOnlyJsonl(join(sessions, "rollout-2026-07-05T11-00-00-019f-prepared-final-only.jsonl"));

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    materializeSummaryLeaves(db, { threadId });
    materializePreparedCards(db, { threadId });

    const card = getPreparedCards(db, { threadId, limit: 10 }).cards[0]!;
    assert.equal(card.title, "Final-only card lane");
    assert.equal(card.objective, null);
    assert.equal(card.nextAction, "Publish the review handoff.");
    assert.equal(card.blocker, null);
    assert.match(card.summaryText, /Working on: Publish the review handoff/);
    assert.equal(card.reasonCodes.includes("from_final_message"), true);
    assert.equal(card.reasonCodes.includes("from_latest_plan"), false);
    assert.doesNotMatch(card.summaryText, /summary leaf|prepared source range|Final:/i);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared cards do not promote unlabeled completed finals into next action", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-completed-final-no-next-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadId = "019f-prepared-completed-final-no-next";
  const lines = [
    { timestamp: "2026-07-05T11:30:00.000Z", session_meta: { payload: { id: threadId, model: "gpt-5.5" } } },
    { timestamp: "2026-07-05T11:30:01.000Z", event_msg: { type: "thread_name", name: "Completed final without next action" } },
    {
      timestamp: "2026-07-05T11:30:02.000Z",
      event_msg: {
        type: "agent_message",
        message: "Final: All prepared-card canaries passed. Evidence packet is complete."
      }
    }
  ];
  writeFileSync(
    join(sessions, "rollout-2026-07-05T11-30-00-019f-prepared-completed-final-no-next.jsonl"),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    insertSessionMetadataRow(db, { threadId, status: "completed", closeoutState: "done", planCompletionState: "complete" });
    materializeSummaryLeaves(db, { threadId });
    materializePreparedCards(db, { threadId });

    const card = getPreparedCards(db, { threadId, limit: 10 }).cards[0]!;
    assert.equal(card.state, "completed");
    assert.equal(card.nextAction, null);
    assert.match(card.summaryText, /^Finished: All prepared-card canaries passed\./);
    assert.equal(card.reasonCodes.includes("completed_from_final_message"), true);
    assert.equal(card.reasonCodes.includes("from_final_message"), false);
    assert.doesNotMatch(card.summaryText, /next All prepared-card canaries passed/i);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared card attention drops unsafe reason codes before public output", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-attention-unsafe-reasons-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const threadId = "019f-attention-unsafe-reasons";
    insertSummaryLeafRow(db, {
      id: "b1000000000000000000000000000001",
      threadId,
      leafKind: "closeout",
      confidence: 0.95
    });
    insertAttentionQueueRow(db, threadId, ["ci_failed", "/Users/lume/private/session.jsonl", "admin@example.com"]);

    materializePreparedCards(db, { threadId });

    const card = getPreparedCards(db, { threadId, limit: 10 }).cards[0]!;
    const serialized = JSON.stringify(card);
    assert.equal(card.reasonCodes.includes("ci_failed"), true);
    assert.equal(card.blocker, "ci failed");
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("session.jsonl"), false);
    assert.equal(serialized.includes("admin@example.com"), false);
    assert.equal(card.reasonCodes.some((code) => code.includes("private") || code.includes("example")), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared card attention advisory codes do not synthesize blockers", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-attention-advisory-reasons-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const threadId = "019f-attention-advisory-reasons";
    insertSummaryLeafRow(db, {
      id: "b2000000000000000000000000000002",
      threadId,
      leafKind: "closeout",
      confidence: 0.95
    });
    insertAttentionQueueRow(db, threadId, ["stale_cache", "watcher_not_configured", "summary_leaves_missing"]);

    materializePreparedCards(db, { threadId });

    const card = getPreparedCards(db, { threadId, limit: 10 }).cards[0]!;
    assert.equal(card.blocker, null);
    assert.equal(card.reasonCodes.includes("stale_cache"), true);
    assert.equal(card.reasonCodes.includes("watcher_not_configured"), true);
    assert.equal(card.reasonCodes.includes("summary_leaves_missing"), true);
    assert.doesNotMatch(card.summaryText, /^Blocked:/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared cards strip plan envelope and heading markup from presentation fields", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-marked-plan-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadId = writePreparedMarkedPlanJsonl(join(sessions, "rollout-2026-07-05T12-00-00-019f-prepared-marked-plan.jsonl"));

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    materializeSummaryLeaves(db, { threadId });
    materializePreparedCards(db, { threadId });

    const card = getPreparedCards(db, { threadId, limit: 10 }).cards[0]!;
    assert.equal(card.title, "Debug Plan For Prepared Cards");
    assert.equal(card.objective, null);
    assert.equal(card.nextAction, "Strip plan envelope from presentation fields.");
    assert.equal(card.reasonCodes.includes("presentation_cleaned"), true);

    for (const value of [card.title, card.objective, card.nextAction, card.summaryText]) {
      assert.doesNotMatch(value ?? "", /<\/?proposed_plan>/i);
      assert.doesNotMatch(value ?? "", /(^|\s)#{1,6}\s/);
    }
    assert.doesNotMatch(card.objective ?? "", /Summary/i);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared cards collapse duplicate weak final-only fields", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-duplicate-final-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadId = writePreparedDuplicateFinalOnlyJsonl(join(sessions, "rollout-2026-07-05T13-00-00-019f-prepared-duplicate-final.jsonl"));

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    materializeSummaryLeaves(db, { threadId });
    materializePreparedCards(db, { threadId });

    const card = getPreparedCards(db, { threadId, limit: 10 }).cards[0]!;
    assert.equal(card.title, "Ship final-only duplicate lane.");
    assert.equal(card.objective, null);
    assert.equal(card.nextAction, null);
    assert.equal(card.reasonCodes.includes("presentation_low_confidence"), true);
    assert.doesNotMatch(card.summaryText, /Ship final-only duplicate lane/i);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared cards and inbox cite sanitized native Codex subagent result sources", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-native-subagent-card-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const resultId = "issue-447-card-proof";
    const sourceRef = `codex_subagent_result:${resultId}`;
    const threadId = `subagent_${resultId}`;
    indexNativeCodexSubagentResults(db, {
      results: [
        {
          resultId,
          title: "Issue 447 native subagent card proof",
          summary: "Worker prepared a card-citable source.",
          finalReport: "Final: prepared-state card citation proof complete. Next action: review stacked PR.",
          provenance: {
            issue: 447,
            pr: 458,
            branch: "issue-447-subagent-prepared-citations"
          },
          touchedFiles: ["packages/core/src/index.ts", "tests/prepared-cards.test.ts"],
          blockers: ["none"],
          observedAt: "2026-07-04T11:30:00Z",
          rawTranscriptPath: "/Users/lume/.codex/private/subagent-result.jsonl",
          transcriptText: "PRIVATE_CANARY_TOKEN_1234567890 raw hidden prompt text"
        }
      ],
      now: "2026-07-04T11:31:00Z"
    });

    materializeSummaryLeaves(db, { threadId });
    materializePreparedCards(db, { threadId });

    const cards = getPreparedCards(db, { threadId, limit: 10 });
    assert.equal(cards.sourceCoverage.preparedCards, "ok");
    assert.equal(cards.cards.length, 1);
    assert.equal(cards.cards[0]!.sourceRefs.includes(sourceRef), true);
    assert.equal(cards.cards[0]!.reasonCodes.includes("summary_leaves_ready"), true);

    const inbox = getPreparedInbox(db, { threadId, limit: 10 });
    assert.equal(inbox.sourceCoverage.preparedInboxItems, "ok");
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0]!.sourceRefs.includes(sourceRef), true);

    const status = getPreparedStateStatus(db);
    assert.equal(status.sourceCoverage.summaryLeaves, "ok");
    assert.equal(status.sourceCoverage.preparedCards, "ok");
    assert.equal(status.sourceCoverage.preparedInboxItems, "ok");

    const serialized = JSON.stringify({ cards, inbox, status });
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("PRIVATE_CANARY_TOKEN"), false);
    assert.equal(serialized.includes("raw hidden prompt"), false);
    assert.equal(serialized.includes("subagent-result.jsonl"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared card and inbox outputs reject encoded unsafe native subagent result refs", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-native-subagent-encoded-ref-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const threadId = "subagent_encoded_ref";
    const unsafeEncodedRef = "codex_subagent_result:%2FUsers%2Flume%2Fprivate%2Fresult.jsonl";
    db.prepare(`
      INSERT INTO prepared_cards (
        card_id, card_ref, target_ref, card_kind, title, summary_text, next_action,
        source_refs_json, source_range_refs_json, source_range_refs_omitted,
        authority_coverage_json, input_hash, extractor_version, privacy_class,
        confidence, freshness_at, stale, state, reason_codes_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "card-encoded-ref",
      "prepared_card:55555555555555555555555555555555",
      `codex_thread:${threadId}`,
      "codex_session",
      "Encoded ref safety proof",
      "Prepared card should keep only public-safe source refs.",
      "Use bounded public-safe evidence.",
      JSON.stringify([`codex_thread:${threadId}`, unsafeEncodedRef]),
      JSON.stringify([]),
      0,
      JSON.stringify({
        summaryLeaves: { status: "ok", leafCount: 1, rangeCount: 1 },
        sessionMetadata: { status: "ok" },
        watcherObservations: { status: "not_configured" }
      }),
      "55555555555555555555555555555555",
      "prepared-cards-v1",
      "public_safe_metadata",
      0.88,
      "2026-07-04T11:40:00Z",
      0,
      "ready",
      JSON.stringify(["summary_leaves_ready"]),
      "2026-07-04T11:40:00Z",
      "2026-07-04T11:40:00Z"
    );
    db.prepare(`
      INSERT INTO prepared_inbox_items (
        item_id, card_ref, target_ref, urgency_score, state, reason_codes_json,
        source_refs_json, execute_false, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "prepared_inbox:55555555555555555555555555555555",
      "prepared_card:55555555555555555555555555555555",
      `codex_thread:${threadId}`,
      67,
      "ready",
      JSON.stringify(["summary_leaves_ready"]),
      JSON.stringify([`codex_thread:${threadId}`, unsafeEncodedRef]),
      1,
      "2026-07-04T11:40:00Z",
      "2026-07-04T11:40:00Z"
    );

    const cards = getPreparedCards(db, { threadId, limit: 10 });
    assert.equal(cards.cards.length, 1);
    assert.equal(cards.cards[0]!.sourceRefs.includes(`codex_thread:${threadId}`), true);
    assert.equal(cards.cards[0]!.sourceRefs.includes(unsafeEncodedRef), false);

    const inbox = getPreparedInbox(db, { threadId, limit: 10 });
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0]!.sourceRefs.includes(`codex_thread:${threadId}`), true);
    assert.equal(inbox.items[0]!.sourceRefs.includes(unsafeEncodedRef), false);

    const serialized = JSON.stringify({ cards, inbox });
    assert.equal(serialized.includes("%2FUsers%2Flume"), false);
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("result.jsonl"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared-state status reports a gap when native subagent ranges lack card coverage", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-native-subagent-gap-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexNativeCodexSubagentResults(db, {
      results: [
        {
          resultId: "issue-447-gap-proof",
          title: "Issue 447 native subagent gap proof",
          summary: "Worker source ranges exist before card materialization.",
          finalReport: "Final: source ranges exist without prepared card coverage.",
          provenance: { issue: 447 },
          observedAt: "2026-07-04T11:35:00Z"
        }
      ],
      now: "2026-07-04T11:36:00Z"
    });

    const status = getPreparedStateStatus(db);
    assert.equal(status.sourceCoverage.summaryLeaves, "partial");
    assert.equal(status.sourceCoverage.preparedCards, "partial");
    assert.equal(status.sourceCoverage.preparedInboxItems, "partial");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared card migration preserves existing beta databases and adds persisted omitted ranges", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-card-migration-"));
  const dbPath = join(root, "orchestrator.sqlite");
  const legacyDb = new DatabaseSync(dbPath);
  try {
    legacyDb.exec(`
      CREATE TABLE prepared_cards (
        card_id TEXT PRIMARY KEY,
        card_ref TEXT NOT NULL UNIQUE,
        target_ref TEXT NOT NULL,
        card_kind TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        summary_text TEXT NOT NULL DEFAULT '',
        next_action TEXT,
        source_refs_json TEXT NOT NULL DEFAULT '[]',
        source_range_refs_json TEXT NOT NULL DEFAULT '[]',
        authority_coverage_json TEXT NOT NULL DEFAULT '{}',
        input_hash TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        privacy_class TEXT NOT NULL,
        confidence REAL NOT NULL,
        freshness_at TEXT,
        stale INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'unknown',
        reason_codes_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } finally {
    legacyDb.close();
  }

  const db = createDatabase(dbPath);
  try {
    const columns = db.prepare("PRAGMA table_info(prepared_cards)").all() as Array<{ name: string }>;
    assert.equal(columns.some((row) => row.name === "source_range_refs_omitted"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared card materialization downgrades stale or partial authority inputs", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-card-stale-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const threadId = "019f-prepared-stale";
    insertSummaryLeafRow(db, {
      id: "10000000000000000000000000000001",
      threadId,
      stale: true,
      confidence: 0.95,
      authorityStatus: "partial",
      freshnessAt: "2026-06-01T00:00:00.000Z"
    });
    insertSessionMetadataRow(db, {
      threadId,
      status: "done",
      closeoutState: "done",
      planCompletionState: "complete"
    });

    materializePreparedCards(db, { threadId });
    const cards = getPreparedCards(db, { threadId });
    assert.equal(cards.cards.length, 1);
    const card = cards.cards[0]!;
    assert.equal(card.stale, true);
    assert.equal(card.state, "stale_or_partial");
    assert.equal(card.confidence <= 0.49, true);
    assert.equal(card.reasonCodes.includes("lifecycle:completed"), true);
    assert.equal(card.reasonCodes.includes("lifecycle:stale_or_partial"), true);
    assert.equal(card.reasonCodes.includes("stale_cache"), true);
    assert.equal(card.reasonCodes.includes("authority_partial"), true);
    assert.equal(card.authorityCoverage.summaryLeaves.status, "partial");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared status and card reads keep inbox coverage and omitted ranges independent", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-card-coverage-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    db.prepare(`
      INSERT INTO prepared_cards (
        card_id, card_ref, target_ref, card_kind, title, summary_text, next_action,
        source_refs_json, source_range_refs_json, source_range_refs_omitted, authority_coverage_json,
        input_hash, extractor_version, privacy_class, confidence, freshness_at,
        stale, state, reason_codes_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "coverage-card",
      "prepared_card:60000000000000000000000000000006",
      "codex_thread:019f-prepared-coverage",
      "codex_session",
      "Prepared coverage",
      "Prepared state: one public-safe card.",
      "Review bounded summary evidence.",
      JSON.stringify(["codex_thread:019f-prepared-coverage", "summary_leaf:60000000000000000000000000000006"]),
      JSON.stringify(["codex_range:60000000000000000000000000000006"]),
      7,
      JSON.stringify({
        summaryLeaves: { status: "ok", leafCount: 2, rangeCount: 8 },
        sessionMetadata: { status: "ok" },
        watcherObservations: { status: "not_configured" }
      }),
      "60000000000000000000000000000006",
      "prepared-cards-v1",
      "public_safe_metadata",
      0.9,
      "2026-07-03T00:00:00.000Z",
      0,
      "ready",
      JSON.stringify(["summary_leaves_ready"]),
      "2026-07-03T00:00:00.000Z",
      "2026-07-03T00:00:00.000Z"
    );

    const cards = getPreparedCards(db, { threadId: "019f-prepared-coverage" });
    assert.equal(cards.cards.length, 1);
    assert.equal(cards.cards[0]!.sourceRangeRefsOmitted, 7);

    const inbox = getPreparedInbox(db, { threadId: "019f-prepared-coverage" });
    assert.equal(inbox.sourceCoverage.preparedCards, "ok");
    assert.equal(inbox.sourceCoverage.preparedInboxItems, "not_configured");

    const status = getPreparedStateStatus(db);
    assert.equal(status.sourceCoverage.preparedCards, "ok");
    assert.equal(status.sourceCoverage.preparedInboxItems, "not_configured");
    assert.equal(status.summary.cards, 1);
    assert.equal(status.summary.inboxItems, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared targeted coverage reports indexed active threads missing prepared rows", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-active-thread-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const activeThreadId = "019f-active-prepared-miss";
  const healthyThreadId = "019f-prepared-global-ok";
  const activePath = join(sessions, "rollout-2026-07-04T00-00-00-019f-active-prepared-miss.jsonl");
  writePreparedCardJsonl(activePath, activeThreadId, "Active sprint thread");
  writePreparedCardJsonl(join(sessions, "rollout-2026-07-04T00-00-01-019f-prepared-global-ok.jsonl"), healthyThreadId, "Healthy global thread");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.equal(getPreparedStateStatus(db).sourceCoverage.preparedCards, "ok");

    const targetRef = `codex_thread:${activeThreadId}`;
    db.prepare(`
      DELETE FROM summary_edges
      WHERE parent_leaf_ref IN (SELECT leaf_ref FROM summary_leaves WHERE thread_id = ?)
         OR child_leaf_ref IN (SELECT leaf_ref FROM summary_leaves WHERE thread_id = ?)
    `).run(activeThreadId, activeThreadId);
    db.prepare("DELETE FROM summary_leaves WHERE thread_id = ?").run(activeThreadId);
    db.prepare("DELETE FROM prepared_inbox_items WHERE target_ref = ?").run(targetRef);
    db.prepare("DELETE FROM prepared_cards WHERE target_ref = ?").run(targetRef);
    db.prepare("DELETE FROM prepared_source_ranges WHERE thread_id = ?").run(activeThreadId);
    db.prepare("DELETE FROM prepared_source_events WHERE thread_id = ?").run(activeThreadId);
    db.prepare(`
      UPDATE codex_source_files
      SET
        prepared_range_extractor_version = NULL,
        summary_leaf_extractor_version = NULL,
        prepared_card_extractor_version = NULL
      WHERE source_path = ?
    `).run(activePath);

    const globalStatus = getPreparedStateStatus(db);
    assert.equal(globalStatus.sourceCoverage.preparedCards, "ok");
    assert.equal(globalStatus.summary.cards, 1);

    const status = getPreparedStateStatus(db, { threadId: activeThreadId }) as ReturnType<typeof getPreparedStateStatus> & {
      targetCoverage?: {
        status: string;
        sourceCoverage: Record<string, string>;
        reasonCodes: string[];
      } | null;
    };
    assert.equal(status.targetCoverage?.status, "source_present_not_indexed");
    assert.equal(status.targetCoverage?.sourceCoverage.indexedSession, "ok");
    assert.equal(status.targetCoverage?.sourceCoverage.preparedSourceRanges, "not_configured");
    assert.equal(status.targetCoverage?.sourceCoverage.summaryLeaves, "not_configured");
    assert.equal(status.targetCoverage?.sourceCoverage.preparedCards, "not_configured");
    assert.equal(status.targetCoverage?.reasonCodes.includes("source_present_not_indexed"), true);
    assert.equal(status.targetCoverage?.reasonCodes.includes("active_session_pending_index"), true);
    assert.equal(JSON.stringify(status).includes(root), false);

    const cards = getPreparedCards(db, { threadId: activeThreadId }) as ReturnType<typeof getPreparedCards> & {
      targetCoverage?: NonNullable<typeof status.targetCoverage>;
    };
    assert.equal(cards.summary.total, 0);
    assert.equal(cards.targetCoverage?.status, "source_present_not_indexed");
    assert.equal(cards.targetCoverage?.reasonCodes.includes("source_present_not_indexed"), true);
    assert.equal(JSON.stringify(cards).includes(root), false);

    const inbox = getPreparedInbox(db, { threadId: activeThreadId }) as ReturnType<typeof getPreparedInbox> & {
      targetCoverage?: NonNullable<typeof status.targetCoverage>;
    };
    assert.equal(inbox.summary.total, 0);
    assert.equal(inbox.targetCoverage?.status, "source_present_not_indexed");

    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const refreshed = getPreparedStateStatus(db, { threadId: activeThreadId }) as typeof status;
    assert.equal(refreshed.targetCoverage?.status, "ready");
    assert.equal(getPreparedCards(db, { threadId: activeThreadId }).summary.total, 1);
    assert.equal(getPreparedInbox(db, { threadId: activeThreadId }).summary.total, 1);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared targeted coverage downgrades stale cards and orphaned inbox rows", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-target-stale-orphan-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const staleThreadId = "019f-prepared-target-stale";
  const completedThreadId = "019f-prepared-target-completed";
  const orphanThreadId = "019f-prepared-target-orphan";
  const noInboxThreadId = "019f-prepared-target-no-inbox";
  writePreparedCardJsonl(join(sessions, "rollout-2026-07-04T00-01-00-019f-prepared-target-stale.jsonl"), staleThreadId, "Stale prepared target");
  writePreparedCardJsonl(join(sessions, "rollout-2026-07-04T00-01-03-019f-prepared-target-completed.jsonl"), completedThreadId, "Completed prepared target");
  writePreparedCardJsonl(join(sessions, "rollout-2026-07-04T00-01-01-019f-prepared-target-orphan.jsonl"), orphanThreadId, "Orphan inbox target");
  writePreparedCardJsonl(join(sessions, "rollout-2026-07-04T00-01-02-019f-prepared-target-no-inbox.jsonl"), noInboxThreadId, "No inbox target");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    db.prepare(`
      UPDATE prepared_cards
      SET stale = 1,
          state = 'stale',
          reason_codes_json = ?
      WHERE target_ref = ?
    `).run(JSON.stringify(["summary_leaves_ready", "stale_cache"]), `codex_thread:${staleThreadId}`);
    const staleStatus = getPreparedStateStatus(db, { threadId: staleThreadId }) as ReturnType<typeof getPreparedStateStatus> & {
      targetCoverage?: {
        status: string;
        sourceCoverage: Record<string, string>;
        counts: Record<string, number>;
        freshness: { stale?: boolean };
        reasonCodes: string[];
      } | null;
    };
    assert.equal(staleStatus.targetCoverage?.sourceCoverage.preparedCards, "partial");
    assert.equal(staleStatus.targetCoverage?.sourceCoverage.preparedInboxItems, "ok");
    assert.equal(staleStatus.targetCoverage?.status, "partial");
    assert.equal(staleStatus.targetCoverage?.freshness.stale, true);
    assert.equal(staleStatus.targetCoverage?.reasonCodes.includes("prepared_cache_stale_or_missing"), true);
    assert.equal(staleStatus.targetCoverage?.counts.preparedInboxItems, 1);

    const completedTargetRef = `codex_thread:${completedThreadId}`;
    db.prepare(`
      UPDATE prepared_cards
      SET state = 'completed',
          stale = 0,
          reason_codes_json = ?
      WHERE target_ref = ?
    `).run(JSON.stringify(["summary_leaves_ready", "semantic_lifecycle", "lifecycle:completed"]), completedTargetRef);
    db.prepare(`
      UPDATE prepared_inbox_items
      SET state = 'completed',
          reason_codes_json = ?
      WHERE target_ref = ?
    `).run(JSON.stringify(["summary_leaves_ready", "prepared_card_completed", "lifecycle:completed"]), completedTargetRef);
    const completedStatus = getPreparedStateStatus(db, { threadId: completedThreadId }) as typeof staleStatus;
    assert.equal(completedStatus.targetCoverage?.sourceCoverage.preparedCards, "ok");
    assert.equal(completedStatus.targetCoverage?.sourceCoverage.preparedInboxItems, "ok");
    assert.equal(completedStatus.targetCoverage?.status, "ready");
    assert.equal(completedStatus.targetCoverage?.freshness.stale, false);
    assert.equal(completedStatus.targetCoverage?.reasonCodes.includes("prepared_cards_missing"), false);
    assert.equal(completedStatus.targetCoverage?.reasonCodes.includes("prepared_cache_stale_or_missing"), false);

    const orphanTargetRef = `codex_thread:${orphanThreadId}`;
    db.prepare("DELETE FROM prepared_inbox_items WHERE target_ref = ?").run(orphanTargetRef);
    insertPreparedInboxRow(db, {
      id: "ffffffffffffffffffffffffffffffff",
      cardRef: "prepared_card:ffffffffffffffffffffffffffffffff",
      threadId: orphanThreadId,
      urgencyScore: 80
    });
    const orphanStatus = getPreparedStateStatus(db, { threadId: orphanThreadId }) as typeof staleStatus;
    assert.equal(orphanStatus.targetCoverage?.sourceCoverage.preparedCards, "ok");
    assert.equal(orphanStatus.targetCoverage?.sourceCoverage.preparedInboxItems, "partial");
    assert.equal(orphanStatus.targetCoverage?.status, "partial");
    assert.equal(orphanStatus.targetCoverage?.counts.preparedInboxItems, 0);
    assert.equal(orphanStatus.targetCoverage?.reasonCodes.includes("prepared_inbox_missing"), true);

    db.prepare("DELETE FROM prepared_inbox_items WHERE target_ref = ?").run(`codex_thread:${noInboxThreadId}`);
    const noInboxStatus = getPreparedStateStatus(db, { threadId: noInboxThreadId }) as typeof staleStatus;
    assert.equal(noInboxStatus.targetCoverage?.sourceCoverage.preparedSourceEvents, "ok");
    assert.equal(noInboxStatus.targetCoverage?.sourceCoverage.preparedSourceRanges, "ok");
    assert.equal(noInboxStatus.targetCoverage?.sourceCoverage.summaryLeaves, "ok");
    assert.equal(noInboxStatus.targetCoverage?.sourceCoverage.preparedCards, "ok");
    assert.equal(noInboxStatus.targetCoverage?.sourceCoverage.preparedInboxItems, "not_configured");
    assert.equal(noInboxStatus.targetCoverage?.status, "partial");
    assert.equal(noInboxStatus.targetCoverage?.reasonCodes.includes("source_present_not_indexed"), false);
    assert.equal(noInboxStatus.targetCoverage?.reasonCodes.includes("prepared_inbox_missing"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared targeted coverage downgrades partial cards and unsafe source layers", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-target-public-layers-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const partialCardThreadId = "019f-prepared-target-partial-card";
  const unsafeLayerThreadId = "019f-prepared-target-unsafe-layer";
  const staleLayerThreadId = "019f-prepared-target-stale-layer";
  const rawTimestampThreadId = "019f-prepared-target-raw-timestamp";
  writePreparedCardJsonl(join(sessions, "rollout-2026-07-04T00-02-00-019f-prepared-target-partial-card.jsonl"), partialCardThreadId, "Partial prepared card target");
  writePreparedCardJsonl(join(sessions, "rollout-2026-07-04T00-02-01-019f-prepared-target-unsafe-layer.jsonl"), unsafeLayerThreadId, "Unsafe prepared layer target");
  writePreparedCardJsonl(join(sessions, "rollout-2026-07-04T00-02-02-019f-prepared-target-stale-layer.jsonl"), staleLayerThreadId, "Stale prepared layer target");
  writePreparedCardJsonl(join(sessions, "rollout-2026-07-04T00-02-03-019f-prepared-target-raw-timestamp.jsonl"), rawTimestampThreadId, "Raw timestamp target");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    db.prepare(`
      UPDATE prepared_cards
      SET state = 'partial',
          confidence = 0.49,
          reason_codes_json = ?
      WHERE target_ref = ?
    `).run(JSON.stringify(["summary_leaves_partial", "partial_authority"]), `codex_thread:${partialCardThreadId}`);
    const partialCardStatus = getPreparedStateStatus(db, { threadId: partialCardThreadId }) as ReturnType<typeof getPreparedStateStatus> & {
      targetCoverage?: {
        status: string;
        sourceCoverage: Record<string, string>;
        freshness: { stale?: boolean; sourceUpdatedAt?: string | null; preparedFreshnessAt?: string | null };
        reasonCodes: string[];
        counts: Record<string, number>;
      } | null;
    };
    assert.equal(partialCardStatus.targetCoverage?.sourceCoverage.preparedCards, "partial");
    assert.equal(partialCardStatus.targetCoverage?.status, "partial");
    assert.equal(partialCardStatus.targetCoverage?.reasonCodes.includes("prepared_cards_missing"), true);

    db.prepare(`
      UPDATE prepared_source_ranges
      SET source_ref = ?
      WHERE thread_id = ?
    `).run("codex_thread:/Users/lume/private.jsonl", unsafeLayerThreadId);
    db.prepare(`
      UPDATE summary_leaves
      SET summary_text = ?
      WHERE thread_id = ?
    `).run("Unsafe /Users/lume/private transcript summary", unsafeLayerThreadId);
    const unsafeLayerStatus = getPreparedStateStatus(db, { threadId: unsafeLayerThreadId }) as typeof partialCardStatus;
    assert.equal(unsafeLayerStatus.targetCoverage?.sourceCoverage.preparedSourceRanges, "partial");
    assert.equal(unsafeLayerStatus.targetCoverage?.sourceCoverage.summaryLeaves, "partial");
    assert.equal(unsafeLayerStatus.targetCoverage?.status, "partial");
    assert.equal(unsafeLayerStatus.targetCoverage?.counts.preparedSourceRanges, 0);
    assert.equal(unsafeLayerStatus.targetCoverage?.counts.summaryLeaves, 0);

    const newerSourceTime = "2026-07-04T00:10:00.000Z";
    db.prepare("UPDATE codex_sessions SET updated_at = ? WHERE thread_id = ?").run(newerSourceTime, staleLayerThreadId);
    db.prepare("UPDATE prepared_source_events SET created_at = ? WHERE thread_id = ?").run("2026-07-04T00:11:00.000Z", staleLayerThreadId);
    db.prepare("UPDATE prepared_source_ranges SET created_at = ? WHERE thread_id = ?").run("2026-07-03T00:00:00.000Z", staleLayerThreadId);
    db.prepare("UPDATE summary_leaves SET created_at = ? WHERE thread_id = ?").run("2026-07-03T00:00:00.000Z", staleLayerThreadId);
    db.prepare("UPDATE prepared_cards SET updated_at = ? WHERE target_ref = ?").run("2026-07-04T00:11:00.000Z", `codex_thread:${staleLayerThreadId}`);
    db.prepare("UPDATE prepared_inbox_items SET updated_at = ? WHERE target_ref = ?").run("2026-07-04T00:11:00.000Z", `codex_thread:${staleLayerThreadId}`);
    const staleLayerStatus = getPreparedStateStatus(db, { threadId: staleLayerThreadId }) as typeof partialCardStatus;
    assert.equal(staleLayerStatus.targetCoverage?.sourceCoverage.preparedSourceRanges, "ok");
    assert.equal(staleLayerStatus.targetCoverage?.sourceCoverage.summaryLeaves, "ok");
    assert.equal(staleLayerStatus.targetCoverage?.status, "partial");
    assert.equal(staleLayerStatus.targetCoverage?.freshness.stale, true);
    assert.equal(staleLayerStatus.targetCoverage?.freshness.sourceUpdatedAt, newerSourceTime);
    assert.equal(staleLayerStatus.targetCoverage?.reasonCodes.includes("prepared_cache_stale_or_missing"), true);

    const oldPublicTime = "2026-07-03T00:00:00.000Z";
    const newerRawTime = "2026-07-04T00:11:00.000Z";
    db.prepare("UPDATE codex_sessions SET updated_at = ? WHERE thread_id = ?").run(newerSourceTime, rawTimestampThreadId);
    db.prepare("UPDATE prepared_source_events SET created_at = ? WHERE thread_id = ?").run(oldPublicTime, rawTimestampThreadId);
    db.prepare("UPDATE prepared_source_ranges SET created_at = ? WHERE thread_id = ?").run(newerRawTime, rawTimestampThreadId);
    db.prepare("UPDATE summary_leaves SET created_at = ? WHERE thread_id = ?").run(newerRawTime, rawTimestampThreadId);
    db.prepare("UPDATE prepared_cards SET updated_at = ? WHERE target_ref = ?").run(oldPublicTime, `codex_thread:${rawTimestampThreadId}`);
    db.prepare("UPDATE prepared_inbox_items SET updated_at = ? WHERE target_ref = ?").run(newerRawTime, `codex_thread:${rawTimestampThreadId}`);
    db.prepare(`
      INSERT INTO prepared_source_events (
        event_id, event_ref, thread_id, source_ref, source_path_ref, source_hash, content_hash,
        event_kind, line_start, line_end, byte_start, byte_end, ordinal, observed_at,
        extractor_version, privacy_class, omission_status, confidence, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "codex_event:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      rawTimestampThreadId,
      `codex_thread:${rawTimestampThreadId}`,
      "codex_source:eeeeeeeeeeeeeeee",
      "sha256:eeee",
      "sha256:ffff",
      "user_prompt",
      1,
      1,
      0,
      32,
      999,
      newerRawTime,
      "wrong-extractor",
      "private",
      "raw_text",
      0.9,
      "{}",
      newerRawTime
    );
    db.prepare(`
      INSERT INTO prepared_cards (
        card_id, card_ref, target_ref, card_kind, title, summary_text, next_action,
        source_refs_json, source_range_refs_json, source_range_refs_omitted,
        authority_coverage_json, input_hash, extractor_version, privacy_class,
        confidence, freshness_at, stale, state, reason_codes_json, created_at, updated_at
      )
      SELECT
        ?, ?, target_ref, card_kind, title, summary_text, next_action,
        source_refs_json, source_range_refs_json, source_range_refs_omitted,
        authority_coverage_json, input_hash, extractor_version, 'private',
        confidence, freshness_at, stale, state, reason_codes_json, created_at, ?
      FROM prepared_cards
      WHERE target_ref = ?
      LIMIT 1
    `).run(
      "dddddddddddddddddddddddddddddddd",
      "prepared_card:dddddddddddddddddddddddddddddddd",
      newerRawTime,
      `codex_thread:${rawTimestampThreadId}`
    );
    const rawTimestampStatus = getPreparedStateStatus(db, { threadId: rawTimestampThreadId }) as typeof partialCardStatus;
    assert.equal(rawTimestampStatus.targetCoverage?.sourceCoverage.preparedSourceEvents, "ok");
    assert.equal(rawTimestampStatus.targetCoverage?.sourceCoverage.preparedCards, "ok");
    assert.equal(rawTimestampStatus.targetCoverage?.status, "partial");
    assert.equal(rawTimestampStatus.targetCoverage?.freshness.preparedFreshnessAt, oldPublicTime);
    assert.equal(rawTimestampStatus.targetCoverage?.freshness.stale, true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared cards fall back for path-like titles before public reads", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-card-title-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const threadId = "019f-prepared-path-title";
    insertSummaryLeafRow(db, {
      id: "70000000000000000000000000000007",
      threadId
    });
    db.prepare("UPDATE codex_sessions SET title = ? WHERE thread_id = ?").run("packages/core/src/index.ts", threadId);

    materializePreparedCards(db, { threadId });
    const cards = getPreparedCards(db, { threadId });
    assert.equal(cards.cards.length, 1);
    assert.equal(cards.cards[0]!.title, threadId);
    assert.equal(cards.cards[0]!.title.includes("/"), false);

    const inbox = getPreparedInbox(db, { threadId });
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0]!.cardRef, cards.cards[0]!.cardRef);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared-card all-thread refresh deletes cards whose leaves disappeared", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-card-delete-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const threadId = "019f-prepared-delete";
    insertSummaryLeafRow(db, {
      id: "80000000000000000000000000000008",
      threadId
    });
    materializePreparedCards(db);
    assert.equal(getPreparedCards(db, { threadId }).summary.total, 1);
    assert.equal(getPreparedInbox(db, { threadId }).summary.total, 1);

    db.prepare("DELETE FROM summary_leaves WHERE thread_id = ?").run(threadId);
    const report = materializePreparedCards(db);
    assert.equal(report.summary.cards, 0);
    assert.equal(getPreparedCards(db, { threadId }).summary.total, 0);
    assert.equal(getPreparedInbox(db, { threadId }).summary.total, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared-card all-thread refresh rolls back earlier thread writes when a later thread fails", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-card-atomic-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const okThreadId = "019f-prepared-a-atomic";
    const failThreadId = "019f-prepared-z-atomic";
    insertSummaryLeafRow(db, {
      id: "81000000000000000000000000000008",
      threadId: okThreadId
    });
    insertSummaryLeafRow(db, {
      id: "82000000000000000000000000000008",
      threadId: failThreadId
    });
    db.exec(`
      CREATE TRIGGER fail_prepared_card_insert
      BEFORE INSERT ON prepared_cards
      WHEN NEW.target_ref = 'codex_thread:${failThreadId}'
      BEGIN
        SELECT RAISE(ABORT, 'forced prepared card failure');
      END;
    `);

    assert.throws(() => materializePreparedCards(db), /forced prepared card failure/);
    assert.equal(getPreparedCards(db, { threadId: okThreadId }).summary.total, 0);
    assert.equal(getPreparedInbox(db, { threadId: okThreadId }).summary.total, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared inbox ordering is deterministic and attention-first", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-inbox-order-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    insertSummaryLeafRow(db, {
      id: "20000000000000000000000000000002",
      threadId: "019f-prepared-ready",
      freshnessAt: "2026-07-03T00:00:00.000Z"
    });
    insertSummaryLeafRow(db, {
      id: "30000000000000000000000000000003",
      threadId: "019f-prepared-attention",
      stale: true,
      confidence: 0.4,
      authorityStatus: "unknown",
      freshnessAt: "2026-06-01T00:00:00.000Z"
    });

    materializePreparedCards(db);
    const first = getPreparedInbox(db, { limit: 10 });
    const second = getPreparedInbox(db, { limit: 10 });
    assert.deepEqual(first.items.map((item) => item.itemRef), second.items.map((item) => item.itemRef));
    assert.equal(first.items[0]!.targetRef, "codex_thread:019f-prepared-attention");
    assert.equal(first.items[0]!.reasonCodes.includes("needs_attention"), true);
    assert.equal(first.items.every((item) => item.execute === false), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared cards promote semantic lifecycle states into card and inbox ranking", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-card-lifecycle-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const fixtures = [
      {
        id: "a1000000000000000000000000000001",
        threadId: "019f-life-completed",
        metadata: { status: "completed", closeoutState: "done", planCompletionState: "complete" },
        expectedState: "completed"
      },
      {
        id: "a2000000000000000000000000000002",
        threadId: "019f-life-approval",
        metadata: { status: "waiting approval", nextAction: "Wait for explicit approval before live control" },
        expectedState: "waiting_approval"
      },
      {
        id: "a3000000000000000000000000000003",
        threadId: "019f-life-blocked",
        metadata: { status: "blocked", blocker: "missing user input", nextAction: "Ask for the missing context" },
        expectedState: "blocked_missing_info"
      },
      {
        id: "a4000000000000000000000000000004",
        threadId: "019f-life-ci-watch",
        metadata: { status: "waiting", blocker: "CI checks pending", nextAction: "Watch CI checks and report when green" },
        expectedState: "watching_external_check"
      },
      {
        id: "a5000000000000000000000000000005",
        threadId: "019f-life-resume",
        metadata: { status: "paused", nextAction: "Resume session after the long-running monitor" },
        expectedState: "needs_resume"
      },
      {
        id: "a6000000000000000000000000000006",
        threadId: "019f-life-dirty",
        metadata: { status: "handoff", nextAction: "Clean dirty worktree handoff before closeout" },
        expectedState: "dirty_worktree_handoff"
      },
      {
        id: "a7000000000000000000000000000007",
        threadId: "019f-life-review",
        metadata: { status: "ready for review", nextAction: "Review bounded evidence before merge" },
        expectedState: "ready_for_review"
      },
      {
        id: "a8000000000000000000000000000008",
        threadId: "019f-life-not-blocked",
        metadata: { status: "not blocked", blocker: "not blocked", nextAction: "Continue bounded evidence review" },
        expectedState: "ready"
      },
      {
        id: "a9000000000000000000000000000009",
        threadId: "019f-life-completion-negated",
        metadata: { status: "completed, pending review", nextAction: "done? not yet" },
        expectedState: "ready"
      },
      {
        id: "ab000000000000000000000000000000",
        threadId: "019f-life-conflict",
        metadata: { status: "completed", blocker: "missing operator input", nextAction: "Ask for blocker details" },
        expectedState: "unknown_lifecycle"
      },
      {
        id: "ac000000000000000000000000000000",
        threadId: "019f-life-upload-resume",
        metadata: { status: "ready", nextAction: "Upload resume to the applicant tracker after evidence review" },
        expectedState: "ready"
      },
      {
        id: "ad000000000000000000000000000000",
        threadId: "019f-life-monitor-dashboard",
        metadata: { status: "ready", nextAction: "Monitor the dashboard styling language in docs" },
        expectedState: "ready"
      },
      {
        id: "ae000000000000000000000000000000",
        threadId: "019f-life-verify-ci-note",
        metadata: { status: "ready", nextAction: "Verify CI notes were copied to release evidence" },
        expectedState: "ready"
      }
    ];
    for (const fixture of fixtures) {
      insertSummaryLeafRow(db, {
        id: fixture.id,
        threadId: fixture.threadId,
        leafKind: "closeout",
        confidence: 0.95
      });
      insertSessionMetadataRow(db, {
        threadId: fixture.threadId,
        priority: "high",
        ...fixture.metadata
      });
    }

    materializePreparedCards(db);

    const cards = getPreparedCards(db, { limit: 20 });
    const cardsByTarget = new Map(cards.cards.map((card) => [card.targetRef, card]));
    for (const fixture of fixtures) {
      const card = cardsByTarget.get(`codex_thread:${fixture.threadId}`);
      assert.ok(card, fixture.threadId);
      assert.equal(card.state, fixture.expectedState);
      assert.equal(card.reasonCodes.includes("semantic_lifecycle"), true);
      if (fixture.expectedState === "ready") {
        assert.equal(card.reasonCodes.includes("lifecycle_signal_missing"), true);
      } else {
        assert.equal(card.reasonCodes.includes(`lifecycle:${fixture.expectedState}`), true);
      }
      assert.equal(card.reasonCodes.includes("summary_leaves_ready"), true);
      assert.equal(card.summaryText.includes("Lifecycle:"), false);
      assert.doesNotMatch(card.summaryText, /summary leaf|prepared source range/i);
    }

    const inbox = getPreparedInbox(db, { limit: 20 });
    const inboxByTarget = new Map(inbox.items.map((item) => [item.targetRef, item]));
    const blocked = inboxByTarget.get("codex_thread:019f-life-blocked");
    const approval = inboxByTarget.get("codex_thread:019f-life-approval");
    const completed = inboxByTarget.get("codex_thread:019f-life-completed");
    const conflict = inboxByTarget.get("codex_thread:019f-life-conflict");
    assert.ok(blocked);
    assert.ok(approval);
    assert.ok(completed);
    assert.ok(conflict);
    assert.equal(cards.summary.partial, 6);
    assert.equal(cards.summary.unknown, 1);
    assert.equal(cards.summary.completed, 1);
    assert.equal(blocked.state, "blocked_missing_info");
    assert.equal(approval.state, "waiting_approval");
    assert.equal(completed.state, "completed");
    assert.equal(conflict.state, "unknown_lifecycle");
    assert.equal(blocked.reasonCodes.includes("needs_attention"), true);
    assert.equal(conflict.reasonCodes.includes("lifecycle_conflict"), true);
    assert.equal(conflict.reasonCodes.includes("lifecycle:completed"), true);
    assert.equal(conflict.reasonCodes.includes("lifecycle:blocked_missing_info"), true);
    assert.equal(completed.reasonCodes.includes("prepared_card_completed"), true);
    assert.equal(blocked.urgencyScore > completed.urgencyScore, true);
    assert.equal(approval.urgencyScore > completed.urgencyScore, true);

    const originalCompletedCardRef = completed.cardRef;
    insertSessionMetadataRow(db, {
      threadId: "019f-life-completed",
      status: "blocked",
      blocker: "missing operator input",
      nextAction: "Ask for the missing context"
    });
    materializePreparedCards(db, { threadId: "019f-life-completed" });
    const rematerialized = getPreparedCards(db, { threadId: "019f-life-completed" }).cards[0]!;
    assert.equal(rematerialized.state, "blocked_missing_info");
    assert.notEqual(rematerialized.cardRef, originalCompletedCardRef);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared card reports filter unsafe cached rows without leaking canaries", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-card-unsafe-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    db.prepare(`
      INSERT INTO prepared_cards (
        card_id, card_ref, target_ref, card_kind, title, summary_text, next_action,
        source_refs_json, source_range_refs_json, source_range_refs_omitted, authority_coverage_json,
        input_hash, extractor_version, privacy_class, confidence, freshness_at,
        stale, state, reason_codes_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "unsafe-card",
      "prepared_card:40000000000000000000000000000004",
      "codex_thread:019f-unsafe-card",
      "codex_session",
      "/Users/lume/private/customer.txt",
      "PRIVATE_CANARY_TOKEN_1234567890",
      "cat /Users/lume/private/customer.txt",
      JSON.stringify(["/Users/lume/private/customer.txt"]),
      JSON.stringify(["codex_range:40000000000000000000000000000004"]),
      0,
      JSON.stringify({ summaryLeaves: { status: "ok" } }),
      "40000000000000000000000000000004",
      "prepared-cards-v1",
      "public_safe_metadata",
      0.9,
      "2026-07-03T00:00:00.000Z",
      0,
      "ready",
      JSON.stringify(["summary_leaves_ready"]),
      "2026-07-03T00:00:00.000Z",
      "2026-07-03T00:00:00.000Z"
    );
    db.prepare(`
      INSERT INTO prepared_inbox_items (
        item_id, card_ref, target_ref, urgency_score, state, reason_codes_json,
        source_refs_json, execute_false, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "prepared_inbox:40000000000000000000000000000004",
      "prepared_card:40000000000000000000000000000004",
      "codex_thread:019f-unsafe-card",
      80,
      "ready",
      JSON.stringify(["summary_leaves_ready"]),
      JSON.stringify(["codex_thread:019f-unsafe-card"]),
      1,
      "2026-07-03T00:00:00.000Z",
      "2026-07-03T00:00:00.000Z"
    );

    const report = getPreparedCards(db);
    const serialized = JSON.stringify(report);
    assert.equal(report.cards.length, 0);
    assert.equal(report.sourceCoverage.preparedCards, "partial");
    assert.equal(report.omitted.filteredUnsafeRows, 1);
    assert.equal(serialized.includes("PRIVATE_CANARY_TOKEN"), false);
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("customer.txt"), false);

    const inbox = getPreparedInbox(db);
    assert.equal(inbox.items.length, 0);
    assert.equal(inbox.sourceCoverage.preparedCards, "partial");
    assert.equal(inbox.sourceCoverage.preparedInboxItems, "partial");

    const status = getPreparedStateStatus(db);
    assert.equal(status.summary.cards, 0);
    assert.equal(status.summary.staleCards, 0);
    assert.equal(status.summary.inboxItems, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared card coverage remains partial when a limited page also has filtered rows", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-card-limited-coverage-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    insertPreparedCardRow(db, {
      id: "90000000000000000000000000000009",
      threadId: "019f-prepared-limited-safe"
    });
    insertPreparedCardRow(db, {
      id: "a000000000000000000000000000000a",
      threadId: "019f-prepared-limited-unsafe",
      title: "/Users/lume/private/customer.txt",
      summaryText: "PRIVATE_CANARY_TOKEN_1234567890",
      sourceRefs: ["/Users/lume/private/customer.txt"]
    });

    const cards = getPreparedCards(db, { limit: 1 });
    assert.equal(cards.summary.total, 1);
    assert.equal(cards.summary.returned, 1);
    assert.equal(cards.omitted.filteredUnsafeRows, 1);
    assert.equal(cards.sourceCoverage.preparedCards, "partial");

    const status = getPreparedStateStatus(db);
    assert.equal(status.summary.cards, 1);
    assert.equal(status.sourceCoverage.preparedCards, "partial");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared inbox critical and high counts cover all valid items before page truncation", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-prepared-inbox-total-counts-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const criticalA = insertPreparedCardRow(db, {
      id: "b000000000000000000000000000000b",
      threadId: "019f-prepared-critical-a"
    });
    const criticalB = insertPreparedCardRow(db, {
      id: "c000000000000000000000000000000c",
      threadId: "019f-prepared-critical-b"
    });
    const high = insertPreparedCardRow(db, {
      id: "d000000000000000000000000000000d",
      threadId: "019f-prepared-high"
    });
    insertPreparedInboxRow(db, {
      id: "b000000000000000000000000000000b",
      cardRef: criticalA,
      threadId: "019f-prepared-critical-a",
      urgencyScore: 95
    });
    insertPreparedInboxRow(db, {
      id: "c000000000000000000000000000000c",
      cardRef: criticalB,
      threadId: "019f-prepared-critical-b",
      urgencyScore: 91
    });
    insertPreparedInboxRow(db, {
      id: "d000000000000000000000000000000d",
      cardRef: high,
      threadId: "019f-prepared-high",
      urgencyScore: 75
    });

    const inbox = getPreparedInbox(db, { limit: 1 });
    assert.equal(inbox.summary.total, 3);
    assert.equal(inbox.summary.returned, 1);
    assert.equal(inbox.summary.critical, 2);
    assert.equal(inbox.summary.high, 1);
    assert.equal(inbox.omitted.count, 2);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared-state tools are exposed through MCP as read-only public-safe tools", async () => {
  const declarations = createLooToolDeclarations();
  const declarationByName = new Map(declarations.map((declaration) => [declaration.name, declaration]));
  for (const toolName of ["loo_prepared_state_status", "loo_prepared_cards", "loo_prepared_inbox"]) {
    assert.equal(declarationByName.get(toolName)?.safety.mode, "read_only");
    assert.deepEqual(declarationByName.get(toolName)?.safety.mutationClasses, []);
  }
  assert.equal(
    Object.prototype.hasOwnProperty.call(declarationByName.get("loo_prepared_state_status")?.inputSchema.properties ?? {}, "thread_id"),
    true
  );

  const root = mkdtempSync(join(tmpdir(), "loo-prepared-card-tools-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  writePreparedCardJsonl(join(sessions, "rollout-2026-07-04T00-00-00-019f-prepared-tools.jsonl"), "019f-prepared-tools", "Prepared tools proof");
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const tools = createLooTools({
      db,
      audit: {
        path: "prepared-card-test",
        append() {
          throw new Error("unexpected audit append");
        },
        find() {
          return null;
        },
        tail() {
          return [];
        },
        fingerprintText() {
          return "prepared-card-test";
        },
        fingerprintValue() {
          return "prepared-card-test";
        }
      },
      codexClient: {
        async request() {
          throw new Error("unexpected live request");
        }
      }
    });
    const statusTool = tools.find((tool) => tool.name === "loo_prepared_state_status");
    const cardsTool = tools.find((tool) => tool.name === "loo_prepared_cards");
    const inboxTool = tools.find((tool) => tool.name === "loo_prepared_inbox");
    const stateEnum = ((cardsTool?.inputSchema.properties as Record<string, { enum?: string[] }> | undefined)?.state?.enum ?? []);
    assert.equal(stateEnum.includes("completed"), true);
    assert.equal(stateEnum.includes("blocked_missing_info"), true);
    const status = await statusTool?.execute({ thread_id: "019f-prepared-tools" }) as {
      publicSafe?: boolean;
      targetCoverage?: { status?: string };
    };
    assert.equal(status.publicSafe, true);
    assert.equal(status.targetCoverage?.status, "ready");
    assert.equal((await cardsTool?.execute({ thread_id: "019f-prepared-tools" }) as { publicSafe?: boolean }).publicSafe, true);
    assert.equal((await cardsTool?.execute({ thread_id: "019f-prepared-tools", state: "completed" }) as { publicSafe?: boolean }).publicSafe, true);
    assert.equal((await inboxTool?.execute({}) as { publicSafe?: boolean }).publicSafe, true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
