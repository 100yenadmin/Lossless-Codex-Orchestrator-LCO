import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabase,
  expandSummaryLeaves,
  getSummaryLeaves,
  indexCodexSessions,
  materializeSummaryLeaves
} from "../packages/core/src/index.js";
import { createLooToolDeclarations, createLooTools } from "../packages/mcp-server/src/tools.js";

function writeSummaryJsonl(path: string, threadId: string): void {
  const lines = [
    { timestamp: "2026-07-03T00:00:00Z", session_meta: { payload: { id: threadId, cwd: "/Users/lume/private/project", model: "gpt-5.4-mini" } } },
    { timestamp: "2026-07-03T00:00:01Z", event_msg: { type: "thread_name", name: "Summary leaf proof" } },
    { timestamp: "2026-07-03T00:00:02Z", event_msg: { type: "user_message", message: "Please inspect /Users/lume/private/customer.txt with token PRIVATE_CANARY_TOKEN_1234567890" } },
    {
      timestamp: "2026-07-03T00:00:03Z",
      response_item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "<proposed_plan>\n1. Build summary leaves.\n</proposed_plan>" }]
      }
    },
    {
      timestamp: "2026-07-03T00:00:04Z",
      response_item: {
        type: "function_call",
        call_id: "call_huge_payload",
        name: "functions.exec_command",
        arguments: JSON.stringify({ cmd: `cat /Users/lume/private/customer.txt ${"PRIVATE_CANARY_TOKEN_1234567890 ".repeat(80)}` })
      }
    },
    { timestamp: "2026-07-03T00:00:05Z", event_msg: { type: "agent_message", message: "Final: summary leaves complete. Closeout State: done." } }
  ];
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
}

function writeLargeSummaryJsonl(path: string, threadId: string): void {
  const lines: unknown[] = [
    { timestamp: "2026-07-03T00:00:00Z", session_meta: { payload: { id: threadId, model: "gpt-5.4-mini" } } },
    { timestamp: "2026-07-03T00:00:01Z", event_msg: { type: "thread_name", name: "Large summary leaf proof" } }
  ];
  for (let index = 0; index < 1100; index += 1) {
    lines.push({ timestamp: "2026-07-03T00:00:02Z", event_msg: { type: "user_message", message: `Public-safe prompt marker ${index}` } });
  }
  lines.push({ timestamp: "2026-07-03T00:00:03Z", event_msg: { type: "agent_message", message: "Final: large summary leaves complete. Closeout State: done." } });
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
}

function insertSummaryLeafRow(
  db: ReturnType<typeof createDatabase>,
  input: {
    id: string;
    threadId: string;
    leafKind?: string;
    authorityCoverage?: Record<string, unknown>;
    summaryText?: string;
  }
): void {
  db.prepare(`
    INSERT OR IGNORE INTO codex_sessions (
      thread_id, title, source_path, safe_text, indexed_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    input.threadId,
    "Summary leaf direct fixture",
    `summary-fixture-${input.threadId}.jsonl`,
    "",
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
    input.leafKind ?? "user_prompt",
    input.summaryText ?? "Public-safe summary leaf",
    JSON.stringify([`codex_thread:${input.threadId}`]),
    JSON.stringify([`codex_range:${input.id}`]),
    input.id,
    input.id.split("").reverse().join(""),
    "summary-leaves-v1",
    "public_safe_metadata",
    JSON.stringify(input.authorityCoverage ?? { source: "prepared_source_ranges", status: "ok", rangeCount: 1 }),
    0.9,
    "2026-07-03T00:00:00.000Z",
    0,
    "metadata_only",
    "2026-07-03T00:00:00.000Z"
  );
}

test("summary leaves materialize deterministic public-safe routing cards from source ranges", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-summary-leaves-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadId = "019f-summary-leaves";
  writeSummaryJsonl(join(sessions, "rollout-2026-07-03T00-00-00-019f-summary-leaves.jsonl"), threadId);

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const materialized = materializeSummaryLeaves(db, { threadId });
    assert.equal(materialized.publicSafe, false);
    assert.equal(materialized.mutationClasses.includes("derived_cache"), true);
    assert.equal(materialized.summary.created > 0, true);

    const report = getSummaryLeaves(db, { threadId, limit: 50 });
    const serialized = JSON.stringify(report);
    assert.equal(report.publicSafe, true);
    assert.equal(report.readOnly, true);
    assert.equal(report.summary.total, report.leaves.length);
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("PRIVATE_CANARY_TOKEN"), false);
    assert.equal(serialized.includes("cat "), false);

    const kinds = new Set(report.leaves.map((leaf) => leaf.leafKind));
    assert.equal(kinds.has("user_prompt"), true);
    assert.equal(kinds.has("proposed_plan"), true);
    assert.equal(kinds.has("final_message"), true);
    assert.equal(kinds.has("closeout"), true);
    assert.equal(kinds.has("tool_call_metadata"), true);
    for (const leaf of report.leaves) {
      assert.match(leaf.leafRef, /^summary_leaf:[0-9a-f]{32}$/);
      assert.equal(leaf.privacyClass, "public_safe_metadata");
      assert.equal(leaf.omissionStatus, "metadata_only");
      assert.equal(leaf.sourceRefs.includes(`codex_thread:${threadId}`), true);
      assert.equal(leaf.sourceRangeRefs.length > 0, true);
      assert.equal(leaf.confidence >= 0 && leaf.confidence <= 1, true);
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("indexing materializes summary leaves for production read surfaces", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-summary-index-path-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadId = "019f-summary-index-path";
  writeSummaryJsonl(join(sessions, "rollout-2026-07-03T00-00-00-019f-summary-index-path.jsonl"), threadId);

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    const report = getSummaryLeaves(db, { threadId, limit: 50 });
    assert.equal(report.sourceCoverage.summaryLeaves, "ok");
    assert.equal(report.summary.total > 0, true);
    assert.equal(report.leaves.some((leaf) => leaf.leafKind === "final_message"), true);

    const expanded = expandSummaryLeaves(db, {
      leafRef: report.leaves[0]!.leafRef,
      maxDepth: 2,
      maxNodes: 5,
      tokenBudget: 300
    });
    assert.equal(expanded.root.leafRef, report.leaves[0]!.leafRef);
    assert.equal(expanded.leaves.length > 0, true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("summary leaves backfill unchanged watermarked sources after prepared-range migration", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-summary-backfill-path-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadId = "019f-summary-backfill-path";
  writeSummaryJsonl(join(sessions, "rollout-2026-07-03T00-00-00-019f-summary-backfill-path.jsonl"), threadId);

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const first = indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.equal(first.indexedFiles, 1);
    assert.equal(getSummaryLeaves(db, { threadId, limit: 50 }).summary.total > 0, true);

    db.prepare("DELETE FROM summary_edges").run();
    db.prepare("DELETE FROM summary_leaves").run();
    assert.equal(getSummaryLeaves(db, { threadId, limit: 50 }).summary.total, 0);

    const backfilled = indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.equal(backfilled.indexedFiles, 1);
    assert.equal(backfilled.skippedFiles, 0);
    const report = getSummaryLeaves(db, { threadId, limit: 50 });
    assert.equal(report.sourceCoverage.summaryLeaves, "ok");
    assert.equal(report.summary.total > 0, true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("summary materialization scans all public-safe ranges for large sessions", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-summary-large-ranges-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadId = "019f-summary-large-ranges";
  writeLargeSummaryJsonl(join(sessions, "rollout-2026-07-03T00-00-00-019f-summary-large-ranges.jsonl"), threadId);

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10, maxEventsPerFile: 2000 });

    const report = getSummaryLeaves(db, { threadId, limit: 50 });
    const kinds = new Set(report.leaves.map((leaf) => leaf.leafKind));
    assert.equal(kinds.has("user_prompt"), true);
    assert.equal(kinds.has("final_message"), true);
    assert.equal(kinds.has("closeout"), true);
    const userPromptLeaf = report.leaves.find((leaf) => leaf.leafKind === "user_prompt");
    assert.equal(userPromptLeaf?.authorityCoverage.rangeCount, 1100);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("summary leaf reports filter rows without source ranges or event lineage", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-summary-unsafe-row-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    db.prepare(`
      INSERT INTO codex_sessions (
        thread_id, title, source_path, safe_text, indexed_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      "019f-summary-unsafe",
      "Unsafe summary leaf fixture",
      join(root, "fixture.jsonl"),
      "",
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
      "unsafe-empty-range",
      "summary_leaf:0123456789abcdef0123456789abcdef",
      "019f-summary-unsafe",
      "user_prompt",
      "Unsafe missing range",
      JSON.stringify(["codex_thread:019f-summary-unsafe"]),
      JSON.stringify([]),
      "0".repeat(32),
      "1".repeat(32),
      "summary-leaves-v1",
      "public_safe_metadata",
      JSON.stringify({ source: "prepared_source_ranges", status: "ok" }),
      0.9,
      "2026-07-03T00:00:00.000Z",
      0,
      "metadata_only",
      "2026-07-03T00:00:00.000Z"
    );

    const report = getSummaryLeaves(db, { threadId: "019f-summary-unsafe", limit: 10 });
    assert.equal(report.leaves.length, 0);
    assert.equal(report.omitted.filteredUnsafeRows, 1);
    assert.equal(report.omitted.reasons.includes("filtered_unsafe_rows"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("summary leaf reports sanitize authority coverage metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-summary-authority-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const leafId = "a".repeat(32);
    insertSummaryLeafRow(db, {
      id: leafId,
      threadId: "019f-summary-authority",
      authorityCoverage: {
        source: "prepared_source_ranges",
        status: "ok",
        rangeCount: 1,
        path: "/Users/lume/private/customer.txt",
        token: "PRIVATE_CANARY_TOKEN_1234567890"
      }
    });

    const report = getSummaryLeaves(db, { threadId: "019f-summary-authority", limit: 10 });
    assert.equal(report.leaves.length, 1);
    assert.deepEqual(report.leaves[0]!.authorityCoverage, {
      source: "prepared_source_ranges",
      status: "ok",
      rangeCount: 1
    });
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("PRIVATE_CANARY_TOKEN"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("summary expansion rejects cycles and reports node and token omissions", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-summary-expand-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadId = "019f-summary-expand";
  writeSummaryJsonl(join(sessions, "rollout-2026-07-03T00-00-00-019f-summary-expand.jsonl"), threadId);

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    materializeSummaryLeaves(db, { threadId });
    const leaves = getSummaryLeaves(db, { threadId, limit: 50 }).leaves;
    assert.equal(leaves.length >= 3, true);

    db.prepare("INSERT INTO summary_edges (edge_id, parent_leaf_ref, child_leaf_ref, edge_kind, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "cycle-a",
      leaves[0]!.leafRef,
      leaves[1]!.leafRef,
      "derived_from",
      "2026-07-03T00:00:00.000Z"
    );
    db.prepare("INSERT INTO summary_edges (edge_id, parent_leaf_ref, child_leaf_ref, edge_kind, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "cycle-b",
      leaves[1]!.leafRef,
      leaves[0]!.leafRef,
      "derived_from",
      "2026-07-03T00:00:00.000Z"
    );

    const expanded = expandSummaryLeaves(db, {
      leafRef: leaves[0]!.leafRef,
      maxDepth: 5,
      maxNodes: 20,
      tokenBudget: 1000
    });
    const serialized = JSON.stringify(expanded);
    assert.equal(expanded.publicSafe, true);
    assert.equal(expanded.omitted.cycleCount > 0, true);
    assert.equal(expanded.omitted.reasons.includes("cycle"), true);
    const nodeLimited = expandSummaryLeaves(db, {
      leafRef: leaves[0]!.leafRef,
      maxDepth: 5,
      maxNodes: 1,
      tokenBudget: 1000
    });
    assert.equal(nodeLimited.leaves.length, 1);
    assert.equal(nodeLimited.omitted.reasons.includes("node_limit"), true);
    const tokenLimited = expandSummaryLeaves(db, {
      leafRef: leaves[0]!.leafRef,
      maxDepth: 5,
      maxNodes: 20,
      tokenBudget: 8
    });
    assert.equal(tokenLimited.omitted.reasons.includes("token_budget"), true);
    assert.equal(tokenLimited.leaves.length, 0);
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("PRIVATE_CANARY_TOKEN"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("summary expansion can root on a valid leaf outside the first public page", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-summary-expand-page-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    for (let index = 0; index < 1001; index += 1) {
      const id = index.toString(16).padStart(32, "0");
      insertSummaryLeafRow(db, {
        id,
        threadId: `019f-summary-page-${index.toString().padStart(4, "0")}`,
        summaryText: `Public-safe summary leaf ${index}`
      });
    }
    const targetId = (1000).toString(16).padStart(32, "0");
    const expanded = expandSummaryLeaves(db, {
      leafRef: `summary_leaf:${targetId}`,
      maxDepth: 1,
      maxNodes: 5,
      tokenBudget: 300
    });
    assert.equal(expanded.root.leafRef, `summary_leaf:${targetId}`);
    assert.equal(expanded.leaves.length, 1);
    assert.equal(expanded.leaves[0]!.threadId, "019f-summary-page-1000");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("summary expansion reports missing roots as null and stays within the root thread", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-summary-expand-root-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const firstThreadId = "019f-summary-expand-root-a";
  const secondThreadId = "019f-summary-expand-root-b";
  writeSummaryJsonl(join(sessions, "rollout-2026-07-03T00-00-00-019f-summary-expand-root-a.jsonl"), firstThreadId);
  writeSummaryJsonl(join(sessions, "rollout-2026-07-03T00-01-00-019f-summary-expand-root-b.jsonl"), secondThreadId);

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    materializeSummaryLeaves(db, { threadId: firstThreadId });
    materializeSummaryLeaves(db, { threadId: secondThreadId });
    const firstLeaf = getSummaryLeaves(db, { threadId: firstThreadId, limit: 50 }).leaves[0]!;
    const secondLeaf = getSummaryLeaves(db, { threadId: secondThreadId, limit: 50 }).leaves[0]!;

    const missing = expandSummaryLeaves(db, {
      leafRef: `summary_leaf:${"f".repeat(32)}`,
      maxDepth: 2,
      maxNodes: 5,
      tokenBudget: 300
    });
    assert.equal(missing.root.leafRef, null);
    assert.equal(missing.leaves.length, 0);

    db.prepare("INSERT INTO summary_edges (edge_id, parent_leaf_ref, child_leaf_ref, edge_kind, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "cross-thread-edge",
      firstLeaf.leafRef,
      secondLeaf.leafRef,
      "same_thread_context",
      "2026-07-03T00:00:00.000Z"
    );

    const expanded = expandSummaryLeaves(db, {
      leafRef: firstLeaf.leafRef,
      maxDepth: 5,
      maxNodes: 20,
      tokenBudget: 1000
    });
    assert.equal(expanded.leaves.some((leaf) => leaf.threadId === secondThreadId), false);
    assert.equal(expanded.edges.some((edge) => edge.childLeafRef === secondLeaf.leafRef), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("summary leaf tools expose read-only public-safe leaf and expansion reports", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-summary-tools-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadId = "019f-summary-tools";
  writeSummaryJsonl(join(sessions, "rollout-2026-07-03T00-00-00-019f-summary-tools.jsonl"), threadId);

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    materializeSummaryLeaves(db, { threadId });

    const declarations = new Map(createLooToolDeclarations().map((tool) => [tool.name, tool]));
    assert.equal(declarations.get("loo_summary_leaves")?.safety.mode, "read_only");
    assert.deepEqual(declarations.get("loo_summary_leaves")?.safety.mutationClasses, []);
    assert.equal(declarations.get("loo_summary_expand")?.safety.mode, "read_only");
    assert.deepEqual(declarations.get("loo_summary_expand")?.safety.mutationClasses, []);

    const tools = createLooTools({
      db,
      audit: {
        path: "summary-tools-audit",
        append() {
          throw new Error("summary leaf tools must not append audit records");
        },
        find() {
          return null;
        },
        tail() {
          return [];
        },
        fingerprintText(value: string) {
          return value;
        },
        fingerprintValue(value: unknown) {
          return String(value);
        }
      },
      codexClient: {
        async request() {
          throw new Error("summary leaf tools must not call Codex transport");
        }
      }
    });
    const leavesTool = tools.find((tool) => tool.name === "loo_summary_leaves");
    const expandTool = tools.find((tool) => tool.name === "loo_summary_expand");
    assert.ok(leavesTool);
    assert.ok(expandTool);

    const leavesReport = await leavesTool.execute({
      thread_id: threadId,
      leaf_kind: "final_message",
      limit: 10
    }) as ReturnType<typeof getSummaryLeaves>;
    assert.equal(leavesReport.schema, "lco.summary.leaves.v1");
    assert.equal(leavesReport.publicSafe, true);
    assert.equal(leavesReport.readOnly, true);
    assert.equal(leavesReport.actionsPerformed.derivedCacheWrite, false);
    assert.equal(leavesReport.leaves.every((leaf) => leaf.leafKind === "final_message"), true);
    assert.equal(leavesReport.leaves.length, 1);

    const expandReport = await expandTool.execute({
      leaf_ref: leavesReport.leaves[0]!.leafRef,
      max_depth: 2,
      max_nodes: 5,
      token_budget: 300
    }) as ReturnType<typeof expandSummaryLeaves>;
    const serialized = JSON.stringify({ leavesReport, expandReport });
    assert.equal(expandReport.schema, "lco.summary.expansion.v1");
    assert.equal(expandReport.publicSafe, true);
    assert.equal(expandReport.readOnly, true);
    assert.equal(expandReport.actionsPerformed.derivedCacheWrite, false);
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("PRIVATE_CANARY_TOKEN"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
