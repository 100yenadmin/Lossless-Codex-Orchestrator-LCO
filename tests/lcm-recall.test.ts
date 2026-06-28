import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createDatabase,
  describeRecallRef,
  expandQuery,
  expandRecallRef,
  grepRecall,
  indexCodexSessions,
  probeLcmPeerDbs
} from "../packages/core/src/index.js";

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
      CREATE VIRTUAL TABLE summaries_fts USING fts5(summary_id UNINDEXED, content, tokenize = 'unicode61');
    `);
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
      "leaf",
      0,
      "Peer recall summary links OpenClaw LCM to Codex without merging stores. It mentions /Users/lume/private and authorization: Bearer sk-test_1234567890 so safe outputs must redact secrets.",
      44,
      JSON.stringify(["packages/core/src/index.ts"]),
      "2026-06-28T00:00:00Z",
      "2026-06-28T00:10:00Z",
      0,
      "2026-06-28T00:11:00Z",
      "gpt-5.5"
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

function peerDbState(path: string) {
  const beforeStat = statSync(path);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM summaries").get() as { count: number };
    const schema = db.prepare("PRAGMA schema_version").get() as { schema_version: number };
    return { mtimeMs: beforeStat.mtimeMs, count: row.count, schemaVersion: schema.schema_version };
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
    assert.equal(peers.peers[0]?.summaryCount, 1);

    const grep = grepRecall(db, { query: "recall", lcmDbPaths: [fixture.lcmPath], limit: 10 });
    assert.equal(grep.profile.name, "brief");
    assert.deepEqual(grep.matches.map((match) => match.sourceKind).sort(), ["codex_thread", "lcm_summary"]);
    assert.equal(grep.matches.some((match) => match.sourceRef === "codex_thread:019f-recall-thread"), true);
    const lcmRef = grep.matches.find((match) => match.sourceKind === "lcm_summary")?.sourceRef;
    assert.ok(lcmRef?.startsWith("lcm_summary:"));

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

    const brief = expandQuery(db, {
      query: "OpenClaw LCM",
      lcmDbPaths: [fixture.lcmPath],
      profile: "brief"
    });
    assert.equal(brief.sourceRef, lcmRef);
    assert.equal(brief.profile.name, "brief");
    assert.equal(brief.tokenBudget, 1000);
    assert.equal(brief.text.includes("~/private"), true);
    assert.equal(brief.text.includes("authorization: <redacted-secret>"), true);

    const evidence = expandRecallRef(db, { sourceRef: lcmRef!, lcmDbPaths: [fixture.lcmPath], profile: "evidence" });
    assert.equal(evidence.profile.name, "evidence");
    assert.equal(evidence.tokenBudget, 4000);
    assert.equal(evidence.text.length >= brief.text.length, true);

    const relativePeer = relative(process.cwd(), fixture.lcmPath);
    const relativeRef = grepRecall(db, { query: "OpenClaw LCM", lcmDbPaths: [relativePeer], limit: 5 })
      .matches.find((match) => match.sourceKind === "lcm_summary")?.sourceRef;
    assert.equal(describeRecallRef(db, { sourceRef: relativeRef!, lcmDbPaths: [fixture.lcmPath] })?.summaryId, "sum_peer_recall");

    const after = peerDbState(fixture.lcmPath);
    assert.deepEqual(after, before);
    assert.equal(existsSync(`${fixture.lcmPath}-wal`), false);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
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
