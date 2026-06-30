import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabase,
  describeRecallRef,
  expandRecallRef,
  grepRecall,
  indexClaudeSessionInventory
} from "../packages/core/src/index.js";

test("redacted Claude metadata fixtures join recall without raw transcript text", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-claude-readonly-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const result = indexClaudeSessionInventory(db, {
      sessions: [
        {
          sessionId: "claude-redacted-1",
          title: "Claude adapter inventory proof",
          project: "Lossless OpenClaw Orchestrator",
          workspaceHint: "lossless-openclaw-orchestrator",
          status: "fixture-only",
          safeSummary: "Metadata-only Claude fixture for read-only adapter inventory.",
          updatedAt: "2026-06-30T17:20:00Z"
        }
      ]
    });

    assert.equal(result.indexedSessions, 1);
    assert.deepEqual(result.rejectedSessions, []);

    const grep = grepRecall(db, { query: "Claude fixture inventory", limit: 5 });
    assert.equal(grep.matches[0]?.sourceKind, "claude_session");
    assert.equal(grep.matches[0]?.sourceRef, "claude_session:claude-redacted-1");
    assert.equal(grep.matches[0]?.title, "Claude adapter inventory proof");
    assert.equal(grep.matches[0]?.snippet.includes("Metadata-only"), true);
    assert.equal(grep.matches[0]?.snippet.includes("[Claude]"), true);

    const description = describeRecallRef(db, { sourceRef: "claude_session:claude-redacted-1" });
    assert.equal(description?.sourceKind, "claude_session");
    assert.equal(description?.sourceRef, "claude_session:claude-redacted-1");
    assert.equal(description?.summary, "Metadata-only Claude fixture for read-only adapter inventory.");
    assert.equal(description?.sourcePath, "fixture:claude-redacted-1");

    const metadata = expandRecallRef(db, { sourceRef: "claude_session:claude-redacted-1", profile: "metadata" });
    assert.equal(metadata.sourceKind, "claude_session");
    assert.equal(metadata.tokenBudget, 0);
    assert.equal(metadata.text.includes("Claude session ID: claude-redacted-1"), true);
    assert.equal(metadata.text.includes("Project: Lossless OpenClaw Orchestrator"), true);
    assert.equal(metadata.text.includes("Safe summary:"), false);

    const brief = expandRecallRef(db, { sourceRef: "claude_session:claude-redacted-1", profile: "brief" });
    assert.equal(brief.text.includes("Safe summary:"), true);
    assert.equal(brief.text.includes("raw transcript"), false);
    assert.equal(brief.text.includes("tool payload"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude inventory rejects transcript-shaped fixture fields without indexing partial rows", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-claude-readonly-reject-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexClaudeSessionInventory(db, {
      sessions: [
        {
          sessionId: "claude-unsafe-1",
          title: "Stale Claude fixture",
          safeSummary: "Previously safe metadata that must be cleared on rejected re-index.",
          updatedAt: "2026-06-30T17:24:00Z"
        }
      ]
    });
    assert.equal(grepRecall(db, { query: "Previously safe metadata", limit: 5 }).matches.length, 1);

    const result = indexClaudeSessionInventory(db, {
      sessions: [
        {
          sessionId: "claude-unsafe-1",
          title: "Unsafe Claude fixture",
          safeSummary: "This row must not be indexed.",
          updatedAt: "2026-06-30T17:25:00Z",
          messages: [{ role: "user", content: "raw transcript text" }]
        }
      ]
    });

    assert.equal(result.indexedSessions, 0);
    assert.deepEqual(result.rejectedSessions, [
      {
        sessionId: "claude-unsafe-1",
        reason: "forbidden_fixture_field",
        field: "messages"
      }
    ]);
    assert.equal(grepRecall(db, { query: "Unsafe Claude fixture", limit: 5 }).matches.length, 0);
    assert.equal(grepRecall(db, { query: "Previously safe metadata", limit: 5 }).matches.length, 0);
    assert.equal(describeRecallRef(db, { sourceRef: "claude_session:claude-unsafe-1" }), null);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude inventory rejects snake_case transcript-shaped fixture fields", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-claude-readonly-snake-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const result = indexClaudeSessionInventory(db, {
      sessions: [
        {
          sessionId: "claude-snake-unsafe-1",
          title: "Snake unsafe Claude fixture",
          safeSummary: "This row must not be indexed.",
          updatedAt: "2026-06-30T17:26:00Z",
          raw_transcript: "redacted fixture generator accidentally included transcript-shaped text"
        }
      ]
    });

    assert.equal(result.indexedSessions, 0);
    assert.deepEqual(result.rejectedSessions, [
      {
        sessionId: "claude-snake-unsafe-1",
        reason: "forbidden_fixture_field",
        field: "raw_transcript"
      }
    ]);
    assert.equal(grepRecall(db, { query: "Snake unsafe Claude fixture", limit: 5 }).matches.length, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude inventory hashes unsafe session ids and supplied refs before public indexing", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-claude-readonly-safe-id-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const result = indexClaudeSessionInventory(db, {
      sessions: [
        {
          sessionId: "/Users/lume/private/claude-session.jsonl sk-test_1234567890",
          title: "Unsafe identifier Claude fixture",
          safeSummary: "Metadata-only row with unsafe source identifiers normalized before indexing.",
          updatedAt: "2026-06-30T17:27:00Z",
          sourceRefs: [
            "claude_session:/Users/lume/private/source-ref sk-test_1234567890",
            "lcm_summary:not-accepted"
          ]
        }
      ]
    });

    assert.equal(result.indexedSessions, 1);
    assert.deepEqual(result.rejectedSessions, []);

    const match = grepRecall(db, { query: "unsafe source identifiers normalized", limit: 5 }).matches[0];
    assert.equal(match?.sourceKind, "claude_session");
    assert.match(match?.sourceRef ?? "", /^claude_session:claude_[a-f0-9]{16}$/);
    assert.equal(match?.sourceRef.includes("/Users/lume"), false);
    assert.equal(match?.sourceRef.includes("sk-test_1234567890"), false);

    const description = describeRecallRef(db, { sourceRef: match!.sourceRef });
    assert.match(description?.sourcePath ?? "", /^fixture:claude_[a-f0-9]{16}$/);
    const brief = expandRecallRef(db, { sourceRef: match!.sourceRef, profile: "brief" });
    assert.equal(brief.text.includes("/Users/lume"), false);
    assert.equal(brief.text.includes("sk-test_1234567890"), false);
    assert.equal(brief.text.includes("lcm_summary:not-accepted"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
