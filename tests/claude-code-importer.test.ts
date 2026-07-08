import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabase,
  describeRecallRef,
  expandRecallRef,
  grepRecall,
  indexClaudeSessions
} from "../packages/core/src/index.js";

function writeJsonl(path: string, rows: unknown[]): void {
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"));
}

test("Claude Code importer indexes real JSONL files into recall without raw transcript paths", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-claude-importer-"));
  const projectRoot = join(root, ".claude", "projects", "-Volumes-LEXAR-repos-lco");
  mkdirSync(projectRoot, { recursive: true });
  const sessionPath = join(projectRoot, "session-with-secret.jsonl");
  const rawToken = `npm_${"a".repeat(32)}`;
  writeJsonl(sessionPath, [
    {
      type: "user",
      sessionId: "claude-import-1",
      uuid: "user-1",
      timestamp: "2026-07-08T06:00:00.000Z",
      message: {
        role: "user",
        content: `Please build the imported Claude recall path while hiding ${rawToken} and /Users/lume/private/session.jsonl.`
      }
    },
    {
      type: "assistant",
      sessionId: "claude-import-1",
      uuid: "assistant-1",
      timestamp: "2026-07-08T06:01:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "I will preserve public-safe source ranges and opaque Claude refs." },
          { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/Users/lume/private/session.jsonl" } }
        ]
      }
    },
    {
      type: "summary",
      sessionId: "claude-import-1",
      uuid: "summary-1",
      timestamp: "2026-07-08T06:02:00.000Z",
      summary: "Imported Claude recall path is ready for grep describe expand proof."
    }
  ]);

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const first = indexClaudeSessions(db, { roots: [join(root, ".claude", "projects")], maxFiles: 10 });
    assert.equal(first.publicSafe, true);
    assert.deepEqual(first.mutationClasses, ["derived_cache"]);
    assert.equal(first.indexedFiles, 1);
    assert.equal(first.indexedSessions, 1);
    assert.equal(first.indexedEvents, 3);
    assert.deepEqual(first.errors, []);

    const grep = grepRecall(db, { query: "imported Claude recall path", limit: 5 });
    assert.equal(grep.matches[0]?.sourceKind, "claude_session");
    assert.equal(grep.matches[0]?.sourceRef, "claude_session:claude-import-1");

    const description = describeRecallRef(db, { sourceRef: "claude_session:claude-import-1" });
    assert.equal(description?.sourceKind, "claude_session");
    assert.equal(description?.sourcePath?.startsWith("claude_source:"), true);

    const brief = expandRecallRef(db, { sourceRef: "claude_session:claude-import-1", profile: "brief" });
    const serialized = JSON.stringify({ first, grep, description, brief });
    assert.equal(brief.text.includes("Imported Claude recall path"), true);
    assert.equal(serialized.includes(rawToken), false);
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("/Volumes/LEXAR"), false);
    assert.equal(serialized.includes("session-with-secret.jsonl"), false);
    assert.equal(serialized.includes("session.jsonl"), false);

    const second = indexClaudeSessions(db, { roots: [join(root, ".claude", "projects")], maxFiles: 10 });
    assert.equal(second.indexedSessions, 1);
    const duplicateCheck = grepRecall(db, { query: "imported Claude recall path", limit: 10 });
    assert.equal(duplicateCheck.matches.filter((match) => match.sourceRef === "claude_session:claude-import-1").length, 1);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude Code importer reports caps and parse errors without leaking paths or raw rows", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-claude-importer-caps-"));
  const projectRoot = join(root, ".claude", "projects", "-private-project");
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(projectRoot, "too-many-events.jsonl"), [
    JSON.stringify({ type: "user", sessionId: "claude-capped", message: { role: "user", content: "first" } }),
    JSON.stringify({ type: "user", sessionId: "claude-capped", message: { role: "user", content: "second" } })
  ].join("\n"));
  writeFileSync(join(projectRoot, "malformed.jsonl"), [
    JSON.stringify({ type: "user", sessionId: "claude-malformed", message: { role: "user", content: "safe malformed import survives" } }),
    "{ raw malformed /Users/lume/private/session.jsonl npm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  ].join("\n"));

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const result = indexClaudeSessions(db, {
      roots: [join(root, ".claude", "projects")],
      maxFiles: 10,
      maxEventsPerFile: 1
    });
    const serialized = JSON.stringify(result);

    assert.equal(result.indexedFiles, 1);
    assert.equal(result.indexedSessions, 1);
    assert.equal(result.skippedFiles, 1);
    assert.equal(result.limitedFiles[0]?.reason, "max_events_per_file");
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("session.jsonl"), false);
    assert.equal(serialized.includes("too-many-events.jsonl"), false);
    assert.equal(serialized.includes("npm_aaaaaaaa"), false);

    const match = grepRecall(db, { query: "safe malformed import survives", limit: 5 }).matches[0];
    assert.equal(match?.sourceRef, "claude_session:claude-malformed");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
