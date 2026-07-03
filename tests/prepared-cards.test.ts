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
    assert.equal(card.reasonCodes.includes("summary_leaves_ready"), true);
    assert.equal(card.sourceRefs.includes(`codex_thread:${threadId}`), true);
    assert.equal(card.sourceRangeRefs.every((ref) => /^codex_range:[0-9a-f]{32}$/.test(ref)), true);

    const inbox = getPreparedInbox(db, { limit: 10 });
    assert.equal(inbox.publicSafe, true);
    assert.equal(inbox.readOnly, true);
    assert.equal(inbox.summary.total, 1);
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0]!.cardRef, card.cardRef);
    assert.equal(inbox.items[0]!.targetRef, card.targetRef);
    assert.equal(inbox.items[0]!.execute, false);
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

    materializePreparedCards(db, { threadId });
    const cards = getPreparedCards(db, { threadId });
    assert.equal(cards.cards.length, 1);
    const card = cards.cards[0]!;
    assert.equal(card.stale, true);
    assert.equal(card.state, "stale");
    assert.equal(card.confidence <= 0.49, true);
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

    const report = getPreparedCards(db);
    const serialized = JSON.stringify(report);
    assert.equal(report.cards.length, 0);
    assert.equal(report.sourceCoverage.preparedCards, "partial");
    assert.equal(report.omitted.filteredUnsafeRows, 1);
    assert.equal(serialized.includes("PRIVATE_CANARY_TOKEN"), false);
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("customer.txt"), false);
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

  const root = mkdtempSync(join(tmpdir(), "loo-prepared-card-tools-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    insertSummaryLeafRow(db, {
      id: "50000000000000000000000000000005",
      threadId: "019f-prepared-tools"
    });
    materializePreparedCards(db);
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
    assert.equal((await statusTool?.execute({}) as { publicSafe?: boolean }).publicSafe, true);
    assert.equal((await cardsTool?.execute({ thread_id: "019f-prepared-tools" }) as { publicSafe?: boolean }).publicSafe, true);
    assert.equal((await inboxTool?.execute({}) as { publicSafe?: boolean }).publicSafe, true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
