import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createAuditStore } from "../packages/adapters/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";

import {
  configuredLcmPeerDbPaths,
  createDatabase,
  describeRecallRef,
  expandQuery,
  expandRecallRef,
  getPreparedCards,
  getPreparedInbox,
  grepRecall,
  indexCodexSessions,
  materializePreparedCards,
  probeLcmPeerDbs
} from "../packages/core/src/index.js";

function createLcmPeerSchema(lcm: DatabaseSync): void {
  lcm.exec(`
    CREATE TABLE conversations (
      conversation_id INTEGER PRIMARY KEY,
      title TEXT,
      session_key TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE summaries (
      summary_id TEXT PRIMARY KEY,
      conversation_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      depth INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      file_ids TEXT,
      earliest_at TEXT,
      latest_at TEXT,
      descendant_count INTEGER,
      created_at TEXT,
      model TEXT
    );
    CREATE TABLE summary_parents (
      summary_id TEXT NOT NULL,
      parent_summary_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      PRIMARY KEY (summary_id, parent_summary_id)
    );
    CREATE TABLE summary_messages (
      summary_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      PRIMARY KEY (summary_id, message_id)
    );
    CREATE VIRTUAL TABLE summaries_fts USING fts5(summary_id UNINDEXED, content, tokenize = 'unicode61');
  `);
}

function makeRecallFixture() {
  const root = mkdtempSync(join(tmpdir(), "loo-lcm-recall-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-28T00-00-00-019f-recall-thread.jsonl");
  const lines = [
    {
      session_meta: {
        payload: {
          id: "019f-recall-thread",
          cwd: "/Volumes/LEXAR/repos/example",
          model: "gpt-5.5",
          git: { branch: "main", commit_hash: "def5678" }
        }
      }
    },
    { event_msg: { type: "thread_name", name: "Codex recall adapter" } },
    {
      response_item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "<proposed_plan>\nShip Codex recall refs.\n</proposed_plan>" }]
      }
    },
    { event_msg: { type: "agent_message", message: "Final: Codex recall adapter complete." } }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const lcmPath = join(root, "lcm-peer.sqlite");
  const lcm = new DatabaseSync(lcmPath);
  try {
    createLcmPeerSchema(lcm);
    lcm.prepare("INSERT INTO conversations (conversation_id, title, session_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      42,
      "OpenClaw peer memory",
      "peer-session",
      "2026-06-28T00:00:00Z",
      "2026-06-28T00:10:00Z"
    );
    lcm.prepare(`
      INSERT INTO summaries (
        summary_id, conversation_id, kind, depth, content, token_count, file_ids,
        earliest_at, latest_at, descendant_count, created_at, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sum_peer_recall",
      42,
      "condensed",
      1,
      "Peer recall summary links OpenClaw LCM to Codex without merging stores. It mentions /Users/lume/private, ~/private/notes.md, /home/lume/private, /tmp/lcm-peer.sqlite, and authorization: Bearer sk-test_1234567890 so safe outputs must redact secrets.",
      44,
      JSON.stringify(["packages/core/src/index.ts"]),
      "2026-06-28T00:00:00Z",
      "2026-06-28T00:10:00Z",
      0,
      "2026-06-28T00:11:00Z",
      "gpt-5.5"
    );
    lcm.prepare(`
      INSERT INTO summaries (
        summary_id, conversation_id, kind, depth, content, token_count, file_ids,
        earliest_at, latest_at, descendant_count, created_at, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sum_peer_leaf_prompt",
      42,
      "leaf",
      0,
      "User asked how OpenClaw should recall Codex sessions without rereading raw tool-call payloads.",
      18,
      JSON.stringify([]),
      "2026-06-28T00:01:00Z",
      "2026-06-28T00:02:00Z",
      0,
      "2026-06-28T00:03:00Z",
      "gpt-5.5"
    );
    lcm.prepare(`
      INSERT INTO summaries (
        summary_id, conversation_id, kind, depth, content, token_count, file_ids,
        earliest_at, latest_at, descendant_count, created_at, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sum_peer_leaf_plan",
      42,
      "leaf",
      0,
      "Assistant proposed a public-safe recall adapter with source refs, bounded expansion, and no source-store mutation.",
      20,
      JSON.stringify([]),
      "2026-06-28T00:04:00Z",
      "2026-06-28T00:05:00Z",
      0,
      "2026-06-28T00:06:00Z",
      "gpt-5.5"
    );
    lcm.prepare("INSERT INTO summary_parents (summary_id, parent_summary_id, ordinal) VALUES (?, ?, ?)").run(
      "sum_peer_recall",
      "sum_peer_leaf_prompt",
      0
    );
    lcm.prepare("INSERT INTO summary_parents (summary_id, parent_summary_id, ordinal) VALUES (?, ?, ?)").run(
      "sum_peer_recall",
      "sum_peer_leaf_plan",
      1
    );
    lcm.prepare("INSERT INTO summary_parents (summary_id, parent_summary_id, ordinal) VALUES (?, ?, ?)").run(
      "sum_peer_leaf_plan",
      "sum_peer_recall",
      0
    );
    lcm.prepare("INSERT INTO summaries_fts (summary_id, content) VALUES (?, ?)").run(
      "sum_peer_recall",
      "Peer recall summary links OpenClaw LCM to Codex without merging stores."
    );
  } finally {
    lcm.close();
  }

  return { root, sessions, lcmPath };
}

type DagFixture = {
  root: string;
  lcmPath: string;
  addSummary: (summaryId: string, content: string, options?: { kind?: string; depth?: number; ordinal?: number }) => void;
  addParent: (summaryId: string, parentSummaryId: string, ordinal: number) => void;
  close: () => void;
};

function makeDagFixture(): DagFixture {
  const root = mkdtempSync(join(tmpdir(), "loo-lcm-dag-"));
  const lcmPath = join(root, "lcm-peer.sqlite");
  const lcm = new DatabaseSync(lcmPath);
  createLcmPeerSchema(lcm);
  lcm.prepare("INSERT INTO conversations (conversation_id, title, session_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    314,
    "LCM DAG guard fixture",
    "dag-guard",
    "2026-07-08T00:00:00Z",
    "2026-07-08T00:01:00Z"
  );
  const insertSummary = lcm.prepare(`
    INSERT INTO summaries (
      summary_id, conversation_id, kind, depth, content, token_count, file_ids,
      earliest_at, latest_at, descendant_count, created_at, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = lcm.prepare("INSERT INTO summaries_fts (summary_id, content) VALUES (?, ?)");
  const insertParent = lcm.prepare("INSERT INTO summary_parents (summary_id, parent_summary_id, ordinal) VALUES (?, ?, ?)");

  return {
    root,
    lcmPath,
    addSummary(summaryId, content, options = {}) {
      insertSummary.run(
        summaryId,
        314,
        options.kind ?? "condensed",
        options.depth ?? 0,
        content,
        Math.max(1, Math.ceil(content.length / 4)),
        JSON.stringify([]),
        "2026-07-08T00:00:00Z",
        "2026-07-08T00:01:00Z",
        0,
        "2026-07-08T00:02:00Z",
        "gpt-5.5"
      );
      insertFts.run(summaryId, content);
    },
    addParent(summaryId, parentSummaryId, ordinal) {
      insertParent.run(summaryId, parentSummaryId, ordinal);
    },
    close() {
      lcm.close();
    }
  };
}

function expandDagFixtureSummary(fixture: { root: string; lcmPath: string }, query: string, profile: "brief" | "evidence" = "evidence") {
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    const lcmRef = grepRecall(db, { query, lcmDbPaths: [fixture.lcmPath], limit: 5 })
      .matches.find((match) => match.sourceKind === "lcm_summary")?.sourceRef;
    assert.ok(lcmRef?.startsWith("lcm_summary:"));
    return expandRecallRef(db, { sourceRef: lcmRef, lcmDbPaths: [fixture.lcmPath], profile });
  } finally {
    db.close();
  }
}

function peerDbState(path: string) {
  const beforeStat = statSync(path);
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM summaries").get() as { count: number };
    const schema = db.prepare("PRAGMA schema_version").get() as { schema_version: number };
    return { mtimeMs: beforeStat.mtimeMs, hash, count: row.count, schemaVersion: schema.schema_version };
  } finally {
    db.close();
  }
}

test("grep -> describe -> expand_query preserves Codex and read-only LCM source refs", () => {
  const fixture = makeRecallFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [fixture.sessions] });
    const before = peerDbState(fixture.lcmPath);

    const peers = probeLcmPeerDbs([fixture.lcmPath]);
    assert.equal(peers.peers[0]?.supported, true);
    assert.equal(peers.peers[0]?.readOnly, true);
    assert.equal(peers.peers[0]?.queryOnly, true);
    assert.equal(peers.peers[0]?.summaryCount, 3);
    assert.match(peers.peers[0]?.path ?? "", /^<redacted-local-path>\/lcm-peer-[a-f0-9]{12}\.sqlite$/);
    assert.notEqual(peers.peers[0]?.path, fixture.lcmPath);

    const grep = grepRecall(db, { query: "recall", lcmDbPaths: [fixture.lcmPath], limit: 10 });
    assert.equal(grep.profile.name, "brief");
    assert.deepEqual(grep.matches.map((match) => match.sourceKind).sort(), ["codex_thread", "lcm_summary"]);
    assert.equal(grep.matches.some((match) => match.sourceRef === "codex_thread:019f-recall-thread"), true);
    const lcmRef = grep.matches.find((match) => match.sourceKind === "lcm_summary")?.sourceRef;
    assert.ok(lcmRef?.startsWith("lcm_summary:"));

    const noPeerMatch = grepRecall(db, { query: "definitely absent peer term", lcmDbPaths: [fixture.lcmPath], limit: 5 });
    assert.equal(noPeerMatch.matches.some((match) => match.sourceKind === "lcm_summary"), false);
    assert.equal(noPeerMatch.reasonCodes?.includes("lcm_peer_source_read"), true);

    const codexDescription = describeRecallRef(db, {
      sourceRef: "codex_thread:019f-recall-thread",
      lcmDbPaths: [fixture.lcmPath]
    });
    assert.equal(codexDescription?.sourceKind, "codex_thread");
    assert.equal(codexDescription?.sourceRef, "codex_thread:019f-recall-thread");

    const lcmDescription = describeRecallRef(db, { sourceRef: lcmRef!, lcmDbPaths: [fixture.lcmPath] });
    assert.equal(lcmDescription?.sourceKind, "lcm_summary");
    assert.equal(lcmDescription?.summaryId, "sum_peer_recall");
    assert.equal(lcmDescription?.conversationId, 42);

    const metadata = expandRecallRef(db, { sourceRef: lcmRef!, lcmDbPaths: [fixture.lcmPath], profile: "metadata" });
    assert.equal(metadata.profile.name, "metadata");
    assert.equal(metadata.tokenBudget, 0);
    assert.equal(metadata.text.includes("Content:"), false);
    assert.equal(metadata.text.includes("Summary ID: sum_peer_recall"), true);
    assert.equal(metadata.text.includes("Source path:"), false);
    assert.equal(metadata.text.includes(fixture.lcmPath), false);
    assert.equal(metadata.text.includes("lcm-peer.sqlite"), false);

    const brief = expandQuery(db, {
      query: "OpenClaw LCM",
      lcmDbPaths: [fixture.lcmPath],
      profile: "brief"
    });
    assert.equal(brief.sourceRef, lcmRef);
    assert.equal(brief.profile.name, "brief");
    assert.equal(brief.tokenBudget, 1000);
    assert.equal(brief.text.includes("<redacted-path>"), true);
    assert.equal(brief.text.includes("~/private"), false);
    assert.equal(brief.text.includes("authorization: <redacted-secret>"), true);
    assert.equal(brief.text.includes("/Users/lume/private"), false);
    assert.equal(brief.text.includes("/home/lume/private"), false);
    assert.equal(brief.text.includes("/tmp/lcm-peer.sqlite"), false);
    assert.equal(brief.text.includes("lcm-peer.sqlite"), false);
    assert.equal(brief.text.includes("Source path:"), false);
    assert.equal(brief.text.includes("sk-test_1234567890"), false);

    const evidence = expandRecallRef(db, { sourceRef: lcmRef!, lcmDbPaths: [fixture.lcmPath], profile: "evidence" });
    assert.equal(evidence.profile.name, "evidence");
    assert.equal(evidence.tokenBudget, 4000);
    assert.equal(evidence.text.length >= brief.text.length, true);
    assert.equal(evidence.text.includes("~/private"), false);
    assert.equal(evidence.text.includes("/Users/lume/private"), false);
    assert.equal(evidence.text.includes("lcm-peer.sqlite"), false);
    assert.equal(evidence.text.includes("Source path:"), false);
    assert.equal(evidence.text.includes("sk-test_1234567890"), false);

    const relativePeer = relative(process.cwd(), fixture.lcmPath);
    const relativeRef = grepRecall(db, { query: "OpenClaw LCM", lcmDbPaths: [relativePeer], limit: 5 })
      .matches.find((match) => match.sourceKind === "lcm_summary")?.sourceRef;
    assert.equal(describeRecallRef(db, { sourceRef: relativeRef!, lcmDbPaths: [relativePeer] })?.summaryId, "sum_peer_recall");

    const after = peerDbState(fixture.lcmPath);
    assert.deepEqual(after, before);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      assert.equal(existsSync(`${fixture.lcmPath}${suffix}`), false);
    }
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("LCM peer doctor classifies ready degraded and unavailable without mutation", () => {
  const ready = makeDagFixture();
  const degraded = makeDagFixture();
  ready.addSummary("ready_root", "Ready LCM root summary.", { kind: "condensed", depth: 1 });
  ready.addSummary("ready_leaf", "Ready LCM source leaf.", { kind: "leaf", depth: 0 });
  ready.addParent("ready_root", "ready_leaf", 0);
  degraded.addSummary("degraded_root", "Degraded LCM root summary.", { kind: "condensed", depth: 1 });
  degraded.addParent("degraded_root", "missing_leaf", 0);
  degraded.addSummary("empty_leaf", "", { kind: "leaf", depth: 0 });
  const missingPath = join(degraded.root, "missing-peer.sqlite");
  const readyBefore = peerDbState(ready.lcmPath);
  const degradedBefore = peerDbState(degraded.lcmPath);
  try {
    const report = probeLcmPeerDbs([ready.lcmPath, degraded.lcmPath, missingPath]);
    assert.equal(report.status, "degraded");
    assert.deepEqual(report.summary, { ready: 1, degraded: 1, unavailable: 1 });
    assert.equal(report.peers[0]?.status, "ready");
    assert.deepEqual(report.peers[0]?.integrity.reasonCodes, []);
    assert.equal(report.peers[1]?.status, "degraded");
    assert.equal(report.peers[1]?.integrity.emptySummaries, 1);
    assert.equal(report.peers[1]?.integrity.staleDagLinks, 1);
    assert.equal(report.peers[1]?.integrity.degradedExpansions >= 1, true);
    assert.equal(report.peers[2]?.status, "unavailable");
    assert.equal(report.readOnly, true);
    assert.deepEqual(peerDbState(ready.lcmPath), readyBefore);
    assert.deepEqual(peerDbState(degraded.lcmPath), degradedBefore);
    for (const path of [ready.lcmPath, degraded.lcmPath]) {
      for (const suffix of ["-wal", "-shm", "-journal"]) assert.equal(existsSync(`${path}${suffix}`), false);
    }
  } finally {
    ready.close();
    degraded.close();
    rmSync(ready.root, { recursive: true, force: true });
    rmSync(degraded.root, { recursive: true, force: true });
  }
});

test("LCM peer doctor treats an optional unconfigured peer set as ready", () => {
  const report = probeLcmPeerDbs([]);
  assert.equal(report.status, "ready");
  assert.deepEqual(report.summary, { ready: 0, degraded: 0, unavailable: 0 });
  assert.deepEqual(report.peers, []);
});

test("LCM peer doctor degrades cyclic summary DAGs", () => {
  const fixture = makeDagFixture();
  fixture.addSummary("cycle_a", "Cycle A summary.");
  fixture.addSummary("cycle_b", "Cycle B summary.");
  fixture.addParent("cycle_a", "cycle_b", 0);
  fixture.addParent("cycle_b", "cycle_a", 0);
  try {
    const report = probeLcmPeerDbs([fixture.lcmPath]);
    assert.equal(report.status, "degraded");
    assert.equal(report.peers[0]?.status, "degraded");
    assert.equal(report.peers[0]?.integrity.degradedExpansions >= 1, true);
    assert.equal(report.peers[0]?.integrity.reasonCodes.includes("lcm_peer_dag_cycle"), true);
  } finally {
    fixture.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("LCM summary DAGs materialize public-safe prepared cards and inbox items", () => {
  const fixture = makeDagFixture();
  fixture.addSummary("card_root", "Prepared LCM root summary for the next operator at /Users/lume/private. Bearer sk-test_1234567890", { kind: "condensed", depth: 1 });
  fixture.addSummary("card_leaf", "Prepared LCM source leaf with bounded evidence.", { kind: "leaf", depth: 0 });
  fixture.addParent("card_root", "card_leaf", 0);
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  const before = peerDbState(fixture.lcmPath);
  try {
    const indexed = indexCodexSessions(db, { roots: [], lcmDbPaths: [fixture.lcmPath] });
    assert.deepEqual(indexed.errors, []);
    const cards = getPreparedCards(db, { limit: 10 }).cards.filter((card) => card.cardKind === "lcm_summary");
    assert.equal(cards.length, 2);
    const rootCard = cards.find((card) => card.targetRef.includes("card_root"));
    assert.ok(rootCard);
    assert.equal(rootCard.summaryText.includes("Prepared LCM root summary"), true);
    assert.equal(rootCard.sourceRefs.some((ref) => ref.includes("card_leaf")), true);
    assert.equal(rootCard.authorityCoverage.summaryLeaves.status, "ok");
    assert.equal(rootCard.freshnessAt, "2026-07-08T00:02:00.000Z");
    const inbox = getPreparedInbox(db, { limit: 10 }).items.filter((item) => item.targetRef.startsWith("lcm_summary:"));
    assert.equal(inbox.length, 2);
    assert.equal(inbox.every((item) => item.execute === false), true);
    const serializedPreparedState = JSON.stringify({ cards, inbox });
    assert.doesNotMatch(serializedPreparedState, /\/Users\/lume\/private|sk-test_1234567890|Bearer/);
    assert.doesNotMatch(serializedPreparedState, new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(peerDbState(fixture.lcmPath), before);
  } finally {
    db.close();
    fixture.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("LCM prepared cards accept the full encodeURIComponent unescaped ID set", () => {
  const fixture = makeDagFixture();
  fixture.addSummary("valid!*'()", "Prepared LCM summary with a valid public identifier.");
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    const indexed = indexCodexSessions(db, { roots: [], lcmDbPaths: [fixture.lcmPath] });
    assert.deepEqual(indexed.errors, []);
    const cards = getPreparedCards(db, { limit: 10 }).cards.filter((card) => card.cardKind === "lcm_summary");
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.targetRef.endsWith(":valid%21%2A%27%28%29"), true);
    const description = describeRecallRef(db, { sourceRef: cards[0]!.targetRef, lcmDbPaths: [fixture.lcmPath] });
    assert.equal(description?.summaryId, "valid!*'()");
  } finally {
    db.close();
    fixture.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("LCM prepared cards reconcile disabled peers and retain unavailable peer cache", () => {
  const fixture = makeDagFixture();
  fixture.addSummary("retained_root", "Retained peer summary.");
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [], lcmDbPaths: [fixture.lcmPath] });
    assert.equal(getPreparedCards(db, { limit: 10 }).cards.filter((card) => card.cardKind === "lcm_summary").length, 1);

    materializePreparedCards(db);
    assert.equal(getPreparedCards(db, { limit: 10 }).cards.filter((card) => card.cardKind === "lcm_summary").length, 1);

    fixture.close();
    rmSync(fixture.lcmPath, { force: true });
    indexCodexSessions(db, { roots: [], lcmDbPaths: [fixture.lcmPath] });
    assert.equal(getPreparedCards(db, { limit: 10 }).cards.filter((card) => card.cardKind === "lcm_summary").length, 1);

    indexCodexSessions(db, { roots: [], lcmDbPaths: [] });
    assert.equal(getPreparedCards(db, { limit: 10 }).cards.filter((card) => card.cardKind === "lcm_summary").length, 0);
    assert.equal(getPreparedInbox(db, { limit: 10 }).items.filter((item) => item.targetRef.startsWith("lcm_summary:")).length, 0);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("empty LCM configuration skips reconciliation when no peer cache exists", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-lcm-empty-reconcile-"));
  const dbPath = join(root, "orchestrator.sqlite");
  const db = createDatabase(dbPath);
  const locker = createDatabase(dbPath);
  try {
    locker.exec("BEGIN IMMEDIATE");
    const indexed = indexCodexSessions(db, { roots: [], lcmDbPaths: [] });
    assert.deepEqual(indexed.errors, []);
    locker.exec("ROLLBACK");
  } finally {
    try {
      locker.exec("ROLLBACK");
    } catch {
      // The assertion path may already have released the lock.
    }
    locker.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("LCM peer aliases canonicalize to one doctor peer and one prepared-card set", () => {
  const fixture = makeDagFixture();
  fixture.addSummary("alias_root", "Alias dedup summary.");
  const aliasPath = join(fixture.root, "lcm-peer-alias.sqlite");
  symlinkSync(fixture.lcmPath, aliasPath);
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    const report = probeLcmPeerDbs([fixture.lcmPath, aliasPath]);
    assert.equal(report.peers.length, 1);
    indexCodexSessions(db, { roots: [], lcmDbPaths: [fixture.lcmPath, aliasPath] });
    assert.equal(getPreparedCards(db, { limit: 10 }).cards.filter((card) => card.cardKind === "lcm_summary").length, 1);
  } finally {
    db.close();
    fixture.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("LCM prepared-card materialization caps oversized peers with omission markers", () => {
  const fixture = makeDagFixture();
  for (let index = 0; index <= 500; index += 1) {
    fixture.addSummary(`bounded_${String(index).padStart(3, "0")}`, `Bounded LCM summary ${index}.`);
  }
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [], lcmDbPaths: [fixture.lcmPath] });
    const cards = getPreparedCards(db, { limit: 500 }).cards.filter((card) => card.cardKind === "lcm_summary");
    assert.equal(cards.length, 500);
    assert.equal(cards.every((card) => card.reasonCodes.includes("lcm_peer_materialization_cap")), true);
  } finally {
    db.close();
    fixture.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("MCP index, prepared cards, and doctor share the configured LCM peer contract", async () => {
  const fixture = makeDagFixture();
  fixture.addSummary("mcp_root", "MCP-visible LCM prepared summary.", { kind: "condensed", depth: 1 });
  const dbPath = join(fixture.root, "orchestrator.sqlite");
  const db = createDatabase(dbPath);
  const audit = createAuditStore(join(fixture.root, "audit.jsonl"));
  const previousCanonicalPeers = process.env.LCO_LCM_DB_PATHS;
  const previousLegacyPeers = process.env.LOO_LCM_DB_PATHS;
  process.env.LCO_LCM_DB_PATHS = fixture.lcmPath;
  delete process.env.LOO_LCM_DB_PATHS;
  const tools = createLooTools({
    db,
    dbPath,
    audit,
    codexClient: { request: async () => ({ ok: true }) },
    includeAliases: false
  });
  try {
    const indexTool = tools.find((tool) => tool.name === "lco_index_sessions");
    const cardsTool = tools.find((tool) => tool.name === "lco_prepared_state");
    const doctorTool = tools.find((tool) => tool.name === "lco_doctor");
    const peerTool = tools.find((tool) => tool.name === "lco_lcm_peer_dbs");
    assert.ok(indexTool && cardsTool && doctorTool && peerTool);
    await indexTool.execute({ roots: [fixture.root], lcm_db_paths: [fixture.lcmPath] });
    const cards = await cardsTool.execute({ view: "cards", limit: 10 }) as { cards: Array<{ cardKind: string; targetRef: string }> };
    assert.equal(cards.cards.some((card) => card.cardKind === "lcm_summary" && card.targetRef.includes("mcp_root")), true);
    const doctor = await doctorTool.execute({}) as { lcmPeers: unknown };
    const peers = await peerTool.execute({ lcm_db_paths: [fixture.lcmPath] });
    assert.deepEqual(doctor.lcmPeers, peers);
  } finally {
    if (previousCanonicalPeers === undefined) delete process.env.LCO_LCM_DB_PATHS;
    else process.env.LCO_LCM_DB_PATHS = previousCanonicalPeers;
    if (previousLegacyPeers === undefined) delete process.env.LOO_LCM_DB_PATHS;
    else process.env.LOO_LCM_DB_PATHS = previousLegacyPeers;
    db.close();
    fixture.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("LCM summary expansion walks summary_parents DAG without raw peer data", () => {
  const fixture = makeRecallFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    const lcmRef = grepRecall(db, { query: "OpenClaw LCM", lcmDbPaths: [fixture.lcmPath], limit: 5 })
      .matches.find((match) => match.sourceKind === "lcm_summary")?.sourceRef;
    assert.ok(lcmRef?.startsWith("lcm_summary:"));

    const expanded = expandRecallRef(db, { sourceRef: lcmRef, lcmDbPaths: [fixture.lcmPath], profile: "brief" });
    assert.equal(expanded.sourceKind, "lcm_summary");
    assert.equal(expanded.summaryId, "sum_peer_recall");
    assert.match(expanded.text, /Source summaries:/);
    assert.match(expanded.text, /sum_peer_leaf_prompt/);
    assert.match(expanded.text, /sum_peer_leaf_plan/);
    assert.match(expanded.text, /User asked how OpenClaw should recall Codex sessions/);
    assert.match(expanded.text, /Assistant proposed a public-safe recall adapter/);
    assert.match(expanded.text, /lcm_summary_dag_cycle_omitted/);
    assert.doesNotMatch(expanded.text, /\/Users\/|\/Volumes\/|\/tmp\/|~\/|sk-test_1234567890|Bearer sk-test/);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("LCM summary expansion reports depth cap without walking beyond max depth", () => {
  const fixture = makeDagFixture();
  try {
    fixture.addSummary("sum_depth_root", "Depth cap root summary for LCM DAG guard proof.");
    for (let index = 1; index <= 5; index += 1) {
      fixture.addSummary(
        `sum_depth_${index}`,
        `Depth cap child ${index} should ${index > 4 ? "not appear" : "remain bounded"} in source summaries.`,
        { depth: index }
      );
    }
    fixture.addParent("sum_depth_root", "sum_depth_1", 0);
    fixture.addParent("sum_depth_1", "sum_depth_2", 0);
    fixture.addParent("sum_depth_2", "sum_depth_3", 0);
    fixture.addParent("sum_depth_3", "sum_depth_4", 0);
    fixture.addParent("sum_depth_4", "sum_depth_5", 0);
    fixture.close();

    const expanded = expandDagFixtureSummary(fixture, "Depth cap root");
    assert.match(expanded.text, /sum_depth_4/);
    assert.doesNotMatch(expanded.text, /sum_depth_5|child 5 should not appear/);
    assert.match(expanded.text, /lcm_summary_dag_depth_cap/);
    assert.doesNotMatch(expanded.text, /lcm_summary_dag_node_cap|lcm_summary_dag_truncated/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("LCM summary expansion reports node cap and truncation when source DAG is too wide", () => {
  const fixture = makeDagFixture();
  try {
    fixture.addSummary("sum_node_root", "Node cap root summary for LCM DAG guard proof.");
    for (let index = 1; index <= 13; index += 1) {
      fixture.addSummary(`sum_node_${index}`, `Node cap child ${index} summary.`);
      fixture.addParent("sum_node_root", `sum_node_${index}`, index);
    }
    fixture.close();

    const expanded = expandDagFixtureSummary(fixture, "Node cap root");
    assert.match(expanded.text, /sum_node_12/);
    assert.doesNotMatch(expanded.text, /sum_node_13|Node cap child 13/);
    assert.match(expanded.text, /lcm_summary_dag_node_cap/);
    assert.match(expanded.text, /lcm_summary_dag_truncated/);
    assert.doesNotMatch(expanded.text, /lcm_summary_dag_depth_cap/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("LCM summary expansion reports missing child refs while preserving available sources", () => {
  const fixture = makeDagFixture();
  try {
    fixture.addSummary("sum_missing_root", "Missing child root summary for LCM DAG guard proof.");
    fixture.addSummary("sum_missing_present", "Available child should still appear when a sibling ref is missing.");
    fixture.addParent("sum_missing_root", "sum_missing_absent", 0);
    fixture.addParent("sum_missing_root", "sum_missing_present", 1);
    fixture.close();

    const expanded = expandDagFixtureSummary(fixture, "Missing child root");
    assert.match(expanded.text, /sum_missing_present/);
    assert.doesNotMatch(expanded.text, /sum_missing_absent/);
    assert.match(expanded.text, /lcm_summary_dag_missing_child/);
    assert.doesNotMatch(expanded.text, /lcm_summary_dag_node_cap|lcm_summary_dag_depth_cap/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("LCM summary expansion preserves DAG omission markers when root content is long", () => {
  const fixture = makeDagFixture();
  try {
    fixture.addSummary("sum_long_root", `Long omission root ${"budget filler ".repeat(700)}`);
    fixture.addParent("sum_long_root", "sum_long_missing_child", 0);
    fixture.close();

    const expanded = expandDagFixtureSummary(fixture, "Long omission root", "brief");
    assert.match(expanded.text, /Omissions: lcm_summary_dag_missing_child/);
    assert.doesNotMatch(expanded.text, /sum_long_missing_child|\/Users\/|\/Volumes\/|\/tmp\//);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("LCM summary expansion falls back when optional summary_parents table is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-lcm-truncated-peer-"));
  const lcmPath = join(root, "lcm-peer.sqlite");
  const lcm = new DatabaseSync(lcmPath);
  try {
    lcm.exec(`
      CREATE TABLE summaries (
        summary_id TEXT PRIMARY KEY,
        conversation_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        depth INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        created_at TEXT,
        latest_at TEXT,
        model TEXT
      );
    `);
    lcm.prepare(`
      INSERT INTO summaries (
        summary_id, conversation_id, kind, depth, content, token_count, created_at, latest_at, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sum_truncated_peer",
      7,
      "leaf",
      0,
      "Truncated LCM peer recall summary remains expandable without optional DAG tables.",
      12,
      "2026-07-08T00:00:00Z",
      "2026-07-08T00:01:00Z",
      "gpt-5.5"
    );
  } finally {
    lcm.close();
  }

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const lcmRef = grepRecall(db, { query: "Truncated LCM peer", lcmDbPaths: [lcmPath], limit: 5 })
      .matches.find((match) => match.sourceKind === "lcm_summary")?.sourceRef;
    assert.ok(lcmRef?.startsWith("lcm_summary:"));
    const expanded = expandRecallRef(db, { sourceRef: lcmRef, lcmDbPaths: [lcmPath], profile: "brief" });
    assert.match(expanded.text, /Truncated LCM peer recall summary/);
    assert.doesNotMatch(expanded.text, /Source summaries:/);
    assert.doesNotMatch(expanded.text, /lcm-peer\.sqlite|\/Users\/|\/Volumes\/|\/tmp\//);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("stale LCM refs degrade to not found without leaking peer open errors", () => {
  const fixture = makeRecallFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    const lcmRef = grepRecall(db, { query: "OpenClaw LCM", lcmDbPaths: [fixture.lcmPath], limit: 5 })
      .matches.find((match) => match.sourceKind === "lcm_summary")?.sourceRef;
    assert.ok(lcmRef?.startsWith("lcm_summary:"));

    rmSync(fixture.lcmPath, { force: true });

    assert.equal(describeRecallRef(db, { sourceRef: lcmRef!, lcmDbPaths: [fixture.lcmPath] }), null);
    let error: Error | null = null;
    try {
      expandRecallRef(db, { sourceRef: lcmRef!, lcmDbPaths: [fixture.lcmPath], profile: "brief" });
    } catch (caught) {
      error = caught as Error;
    }
    assert.ok(error);
    assert.match(error.message, /Unknown LCM summary ref/);
    const message = error.message.toLowerCase();
    assert.equal(message.includes("sqlite"), false);
    assert.equal(message.includes("cantopen"), false);
    assert.equal(message.includes("unable to open"), false);
    assert.equal(error.message.includes(fixture.lcmPath), false);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("configured LCM peer paths resolve home-relative paths from the OS home", () => {
  const previousHome = process.env.HOME;
  try {
    delete process.env.HOME;
    assert.deepEqual(configuredLcmPeerDbPaths("~/peer.sqlite"), [join(homedir(), "peer.sqlite")]);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
});

test("missing optional LCM peers do not break Codex recall", () => {
  const fixture = makeRecallFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [fixture.sessions] });
    const missingPeer = join(fixture.root, "missing-lcm.sqlite");

    const grep = grepRecall(db, { query: "Codex recall", lcmDbPaths: [missingPeer], limit: 5 });
    assert.deepEqual(grep.matches.map((match) => match.sourceRef), ["codex_thread:019f-recall-thread"]);

    const expanded = expandQuery(db, { query: "Codex recall", lcmDbPaths: [missingPeer], profile: "metadata" });
    assert.equal(expanded.sourceRef, "codex_thread:019f-recall-thread");
    assert.equal(expanded.profile.name, "metadata");
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("CLI recall flags pass token budgets and explicit LCM peer paths override env defaults", () => {
  const fixture = makeRecallFixture();
  const dbPath = join(fixture.root, "orchestrator.sqlite");
  const db = createDatabase(dbPath);
  try {
    indexCodexSessions(db, { roots: [fixture.sessions] });
  } finally {
    db.close();
  }

  try {
    const env = { ...process.env, LOO_DB_PATH: dbPath, LOO_LCM_DB_PATHS: fixture.lcmPath };
    const budget = runCli(["grep", "--token-budget", "42", "Codex", "recall"], env);
    assert.equal(budget.profile.tokenBudget, 42);

    const missingPeer = join(fixture.root, "missing-peer.sqlite");
    const override = runCli(["grep", "--lcm-db", missingPeer, "OpenClaw", "LCM"], env);
    assert.deepEqual(override.matches, []);

    const usage = spawnSync(process.execPath, ["--import", "tsx", "packages/cli/src/index.ts"], {
      cwd: process.cwd(),
      env,
      encoding: "utf8"
    });
    assert.equal(usage.status, 2);
    assert.equal(usage.stderr.includes("--token-budget"), true);
    assert.equal(usage.stderr.includes("describe [--lcm-db path] [--timeout-ms ms] <source-ref>"), true);
    assert.equal(usage.stderr.includes("expand-ref [--lcm-db path] [--profile metadata|brief|evidence] [--token-budget n] [--timeout-ms ms] <source-ref>"), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("CLI recall commands reject empty query inputs", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-lcm-cli-empty-"));
  try {
    const env = { ...process.env, LOO_DB_PATH: join(root, "orchestrator.sqlite") };

    const grep = runCliFailure(["grep", "--token-budget", "42"], env);
    assert.notEqual(grep.status, 0);
    assert.equal(grep.stderr.includes("grep requires a query"), true);

    const expand = runCliFailure(["expand-query", "--profile", "metadata"], env);
    assert.notEqual(expand.status, 0);
    assert.equal(expand.stderr.includes("expand-query requires a query"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runCli(args: string[], env: NodeJS.ProcessEnv): any {
  const result = spawnSync(process.execPath, ["--import", "tsx", "packages/cli/src/index.ts", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function runCliFailure(args: string[], env: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--import", "tsx", "packages/cli/src/index.ts", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8"
  });
}
