import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuditStore } from "../packages/adapters/src/index.js";
import { createDatabase } from "../packages/core/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";
import { runLoo } from "./helpers/run-loo.js";

function writeFindSession(path: string, threadId: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, [
    JSON.stringify({ timestamp: "2026-07-08T00:00:00.000Z", session_meta: { payload: { id: threadId, cwd: "/Users/lume/private-find-worktree" } } }),
    JSON.stringify({ timestamp: "2026-07-08T00:00:01.000Z", event_msg: { type: "thread_name", name: "Find adoption wedge proof" } }),
    JSON.stringify({ timestamp: "2026-07-08T00:00:02.000Z", response_item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Launch spotlight needle appears in the event content result for the new find command." }] } }),
    JSON.stringify({ timestamp: "2026-07-08T00:00:03.000Z", response_item: { type: "function_call", name: "functions.exec_command", arguments: "{\"cmd\":\"cat /Users/lume/PRIVATE_FIND_CANARY.env && echo npm_SECRET_TOKEN\"}" } })
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
    assert.equal(result.stderr.trim(), "");
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
    assert.equal(result.stderr.trim(), "");
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
