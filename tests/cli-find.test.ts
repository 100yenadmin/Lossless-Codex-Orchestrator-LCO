import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createAuditStore } from "../packages/adapters/src/index.js";
import { createDatabase, createFindRecallReport } from "../packages/core/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";
import { runLoo } from "./helpers/run-loo.js";

function writeFindSession(path: string, threadId: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [
    JSON.stringify({ timestamp: "2026-07-08T00:00:00.000Z", session_meta: { payload: { id: threadId, cwd: "/Users/lume/private-find-worktree" } } }),
    JSON.stringify({ timestamp: "2026-07-08T00:00:01.000Z", event_msg: { type: "thread_name", name: "Find adoption wedge proof" } }),
    JSON.stringify({ timestamp: "2026-07-08T00:00:02.000Z", response_item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Launch spotlight needle appears in the event content result for the new find command." }] } }),
    JSON.stringify({ timestamp: "2026-07-08T00:00:03.000Z", response_item: { type: "function_call", name: "functions.exec_command", arguments: "{\"cmd\":\"cat /Users/lume/PRIVATE_FIND_CANARY.env && echo npm_SECRET_TOKEN\"}" } })
  ].join("\n") + "\n");
}

function writeClaudeFindSession(path: string, sessionId: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [
    JSON.stringify({
      type: "user",
      sessionId,
      uuid: `${sessionId}-user-1`,
      timestamp: "2026-07-08T00:10:00.000Z",
      message: {
        role: "user",
        content: "Claude find adoption wedge should surface from zero-config first-run indexing without raw prompt dumps."
      }
    }),
    JSON.stringify({
      type: "summary",
      sessionId,
      uuid: `${sessionId}-summary-1`,
      timestamp: "2026-07-08T00:11:00.000Z",
      summary: "Claude zero config find marker appears in local recall."
    })
  ].join("\n") + "\n");
}

function isolatedEnv(home: string): NodeJS.ProcessEnv {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.LCO_DB_PATH;
  delete env.LOO_DB_PATH;
  return env;
}

test("lco find performs zero-config first-run indexing and renders public-safe human results", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-find-first-run-"));
  try {
    const sessions = join(root, ".codex", "sessions");
    const dbPath = join(root, ".openclaw", "lossless-openclaw-orchestrator", "orchestrator.sqlite");
    writeFindSession(join(sessions, "rollout-2026-07-08T00-00-00-019f-find-first-run.jsonl"), "019f-find-first-run");

    const result = runLoo(["find", "spotlight", "needle"], isolatedEnv(root), 10_000);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /indexing local Codex and Claude sessions/i);
    assert.equal(existsSync(dbPath), true);
    assert.match(result.stdout, /LCO Find/i);
    assert.match(result.stdout, /spotlight needle/i);
    assert.match(result.stdout, /Find adoption wedge proof/);
    assert.match(result.stdout, /codex_thread:019f-find-first-run/);
    assert.match(result.stdout, /codex_event:/);
    assert.match(result.stdout, /event: codex_event:[a-f0-9]+ \(message line 3-3\)/);
    assert.match(result.stdout, /Launch .*needle/i);
    assert.doesNotMatch(result.stdout, /^\s*[\[{]/);
    assert.doesNotMatch(result.stdout, /\/Users\/|\/Volumes\/|\.jsonl|orchestrator\.sqlite|PRIVATE_FIND_CANARY|npm_SECRET_TOKEN/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lco find --json returns a scriptable public-safe packet", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-find-json-"));
  try {
    const sessions = join(root, ".codex", "sessions");
    writeFindSession(join(sessions, "rollout-2026-07-08T00-00-00-019f-find-json.jsonl"), "019f-find-json");

    const result = runLoo(["find", "--json", "--limit", "3", "spotlight", "needle"], isolatedEnv(root), 10_000);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /indexing local Codex and Claude sessions/i);
    const payload = JSON.parse(result.stdout) as Record<string, any>;
    assert.equal(payload.schema, "lco.find.v1");
    assert.equal(payload.publicSafe, true);
    assert.equal(payload.query, "spotlight needle");
    assert.equal(payload.indexed.indexedFiles, 1);
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].sourceRef, "codex_thread:019f-find-json");
    assert.equal(payload.results[0].sourceKind, "codex_thread");
    assert.match(payload.results[0].event.eventRef, /^codex_event:/);
    assert.equal(payload.results[0].event.lineStart, 3);
    assert.equal(payload.results[0].event.sourceStatus, "source_available");
    assert.match(payload.results[0].snippet, /spotlight|needle/i);
    assert.deepEqual(payload.actionsPerformed.liveControl, false);
    assert.deepEqual(payload.actionsPerformed.guiMutation, false);
    assert.deepEqual(payload.actionsPerformed.localCodexSourceRead, true);
    assert.deepEqual(payload.actionsPerformed.rawTranscriptRead, true);
    assert.deepEqual(payload.actionsPerformed.rawTranscriptReturned, false);
    assert.doesNotMatch(result.stdout, /\/Users\/|\/Volumes\/|\.jsonl|orchestrator\.sqlite|PRIVATE_FIND_CANARY|npm_SECRET_TOKEN/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lco find performs zero-config first-run Claude indexing when only Claude sessions exist", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-find-claude-first-run-"));
  try {
    const claudeProject = join(root, ".claude", "projects", "-Volumes-LEXAR-repos-lco");
    const dbPath = join(root, ".openclaw", "lossless-openclaw-orchestrator", "orchestrator.sqlite");
    writeClaudeFindSession(join(claudeProject, "claude-find-private-session.jsonl"), "claude-find-first-run");

    const result = runLoo(["find", "--json", "Claude", "zero", "config", "find", "marker"], isolatedEnv(root), 10_000);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /indexing local Codex and Claude sessions/i);
    assert.equal(existsSync(dbPath), true);
    const payload = JSON.parse(result.stdout) as Record<string, any>;
    assert.equal(payload.schema, "lco.find.v1");
    assert.equal(payload.publicSafe, true);
    assert.deepEqual(payload.indexed.sourceKinds, ["codex", "claude"]);
    assert.equal(payload.indexed.indexedFiles, 1);
    assert.equal(payload.indexed.indexedThreads, 0);
    assert.equal(payload.indexed.indexedSessions, 1);
    assert.equal(payload.results[0].sourceKind, "claude_session");
    assert.equal(payload.results[0].sourceRef, "claude_session:claude-find-first-run");
    assert.match(payload.results[0].snippet, /\[?Claude\]?.*\[?zero\]?.*\[?config\]?.*\[?find\]?.*\[?marker\]?/i);
    assert.equal(payload.actionsPerformed.localRecallSourceRead, true);
    assert.equal(payload.actionsPerformed.localClaudeSourceRead, true);
    assert.equal(payload.actionsPerformed.localCodexSourceRead, true);
    assert.equal(payload.actionsPerformed.rawTranscriptReturned, false);
    assert.doesNotMatch(result.stdout, /\/Users\/|\/Volumes\/|\.jsonl|orchestrator\.sqlite|private-session/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lco find report redacts JWT and AWS-shaped values", () => {
  const report = createFindRecallReport({
    query: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signatureTOKEN123 AKIAABCDEFGHIJKLMNOP",
    limit: 1,
    indexed: null,
    recall: {
      query: "secrets",
      profile: "brief",
      matches: [{
        sourceKind: "codex_thread",
        sourceRef: "codex_thread:secret-redaction",
        title: "Token redaction",
        summary: null,
        updatedAt: null,
        score: 1,
        snippet: "JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signatureTOKEN123 AWS AKIAABCDEFGHIJKLMNOP",
        reasonCodes: ["event_content_fts_match"]
      }]
    }
  });

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /eyJhbGci|AKIAABCDEFGHIJKLMNOP/);
  assert.match(serialized, /<redacted-secret>/);
});

test("lco find report preserves public-safe refs for next commands and lineage", () => {
  const longRef = `codex_thread:${"a".repeat(260)}`;
  const report = createFindRecallReport({
    query: "already indexed needle",
    limit: 1,
    indexed: null,
    recall: {
      query: "already indexed needle",
      profile: "brief",
      matches: [{
        sourceKind: "codex_thread",
        sourceRef: longRef,
        title: "Already indexed",
        summary: null,
        updatedAt: null,
        score: 1,
        snippet: "Existing event-content FTS row matched without a fresh index pass.",
        reasonCodes: ["event_content_fts_match"]
      }]
    }
  });

  assert.equal(report.results[0].sourceRef, longRef);
  assert.equal(report.nextSafeCommands[0], `lco describe ${longRef}`);
  assert.equal(report.actionsPerformed.localCodexSourceRead, false);
  assert.equal(report.actionsPerformed.rawTranscriptRead, true);
});

test("lco find reports direct LCM peer reads without claiming transcript access", () => {
  const report = createFindRecallReport({
    query: "peer summary",
    indexed: null,
    recall: {
      query: "peer summary",
      profile: "brief",
      matches: [{
        sourceKind: "lcm_summary",
        sourceRef: "lcm_summary:0123456789ab:peer_summary",
        title: "Peer summary",
        summary: "Public-safe peer memory.",
        updatedAt: "2026-07-08T00:00:00.000Z",
        score: 1,
        snippet: "Public-safe peer memory.",
        summaryId: "peer_summary",
        reasonCodes: ["lcm_summary_match"]
      }]
    }
  });

  assert.equal(report.indexed.attempted, false);
  assert.equal(report.actionsPerformed.derivedCacheWrite, false);
  assert.equal(report.actionsPerformed.localRecallSourceRead, true);
  assert.equal(report.actionsPerformed.localLcmSourceRead, true);
  assert.equal(report.actionsPerformed.rawTranscriptRead, false);
  assert.equal(report.reasonCodes.includes("lcm_peer_source_read"), true);

  const noMatch = createFindRecallReport({
    query: "missing peer term",
    indexed: null,
    recall: {
      query: "missing peer term",
      profile: "brief",
      matches: [],
      reasonCodes: ["lcm_peer_source_read"]
    }
  });
  assert.equal(noMatch.resultCount, 0);
  assert.equal(noMatch.actionsPerformed.localRecallSourceRead, true);
  assert.equal(noMatch.actionsPerformed.localLcmSourceRead, true);
  assert.equal(noMatch.actionsPerformed.derivedCacheWrite, false);
  assert.equal(noMatch.actionsPerformed.rawTranscriptRead, false);
});

test("lco find filters encoded private-looking LCM references", () => {
  const encodedPrivateRef = "lcm_summary:0123456789ab:%252FUsers%252Flume%252Fprivate-summary";
  const recursivelyEncodedPrivateRef = "lcm_summary:0123456789ab:%2525252FUsers%2525252Flume%2525252Fprivate-summary";
  const report = createFindRecallReport({
    query: "private peer",
    indexed: null,
    recall: {
      query: "private peer",
      profile: "brief",
      reasonCodes: ["lcm_peer_source_read"],
      matches: [{
        sourceKind: "lcm_summary",
        sourceRef: encodedPrivateRef,
        title: "Private peer",
        summary: "Should not escape.",
        updatedAt: null,
        score: 1,
        snippet: "Should not escape.",
        summaryId: "%2FUsers%2Flume%2Fprivate-summary",
        reasonCodes: ["lcm_summary_match"]
      }, {
        sourceKind: "lcm_summary",
        sourceRef: recursivelyEncodedPrivateRef,
        title: "Recursively encoded private peer",
        summary: "Should not escape either.",
        updatedAt: null,
        score: 1,
        snippet: "Should not escape either.",
        summaryId: "%25252FUsers%25252Flume%25252Fprivate-summary",
        reasonCodes: ["lcm_summary_match"]
      }]
    }
  });

  assert.equal(report.resultCount, 0);
  assert.equal(report.actionsPerformed.localLcmSourceRead, true);
  assert.equal(report.reasonCodes.includes("unsafe_results_filtered"), true);
  assert.doesNotMatch(JSON.stringify(report), /%2FUsers|%252FUsers|%25252FUsers|private-summary/);
});

test("lco_find MCP facade indexes then returns the same public-safe find packet", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-find-mcp-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  try {
    const sessions = join(root, ".codex", "sessions");
    writeFindSession(join(sessions, "rollout-2026-07-08T00-00-00-019f-find-mcp.jsonl"), "019f-find-mcp");
    const tools = createLooTools({
      db,
      audit,
      codexClient: {
        request: async () => ({ ok: true })
      },
      includeAliases: true
    });
    const findTool = tools.find((tool) => tool.name === "lco_find");
    const findAlias = tools.find((tool) => tool.name === "loo_find");

    assert.ok(findTool);
    assert.ok(findAlias);
    const payload = await findTool.execute({
      query: "spotlight needle",
      limit: 3,
      roots: [sessions]
    }) as Record<string, any>;

    assert.equal(payload.schema, "lco.find.v1");
    assert.equal(payload.publicSafe, true);
    assert.equal(payload.indexed.indexedFiles, 1);
    assert.equal(payload.results[0].sourceRef, "codex_thread:019f-find-mcp");
    assert.match(payload.results[0].event.eventRef, /^codex_event:/);
    assert.equal(payload.actionsPerformed.localCodexSourceRead, true);
    assert.equal(payload.actionsPerformed.rawTranscriptRead, true);
    assert.equal(payload.actionsPerformed.rawTranscriptReturned, false);
    assert.doesNotMatch(JSON.stringify(payload), /\/Users\/|\/Volumes\/|\.jsonl|orchestrator\.sqlite|PRIVATE_FIND_CANARY|npm_SECRET_TOKEN/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("lco_find MCP facade degrades safely when an index root is not a directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-find-bad-root-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  try {
    const badRoot = join(root, "not-a-directory.jsonl");
    writeFileSync(badRoot, "not a directory");
    const tools = createLooTools({
      db,
      audit,
      codexClient: {
        request: async () => ({ ok: true })
      },
      includeAliases: true
    });
    const findTool = tools.find((tool) => tool.name === "lco_find");

    assert.ok(findTool);
    const payload = await findTool.execute({
      query: "needle",
      roots: [badRoot]
    }) as Record<string, any>;

    assert.equal(payload.schema, "lco.find.v1");
    assert.equal(payload.publicSafe, true);
    assert.equal(payload.indexed.errors, 1);
    assert.equal(payload.resultCount, 0);
    assert.equal(payload.actionsPerformed.derivedCacheWrite, true);
    assert.equal(payload.actionsPerformed.rawTranscriptReturned, false);
    assert.doesNotMatch(JSON.stringify(payload), /not-a-directory\.jsonl|ENOTDIR|\/private|\/var|\/tmp|\/Users\/|\/Volumes\//);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("lco_find rejects missing query before any derived-cache index write", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-find-missing-query-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  try {
    const sessions = join(root, ".codex", "sessions");
    writeFindSession(join(sessions, "rollout-2026-07-08T00-00-00-019f-find-missing-query.jsonl"), "019f-find-missing-query");
    const tools = createLooTools({
      db,
      audit,
      codexClient: {
        request: async () => ({ ok: true })
      },
      includeAliases: true
    });
    const findTool = tools.find((tool) => tool.name === "lco_find");

    assert.ok(findTool);
    assert.throws(
      () => findTool.execute({ roots: [sessions] }),
      /query is required/
    );
    const row = db.prepare("SELECT COUNT(*) AS count FROM codex_sessions").get() as { count: number };
    assert.equal(row.count, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
