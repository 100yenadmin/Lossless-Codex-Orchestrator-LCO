import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabase,
  describeSession,
  expandSession,
  getCodexFinalMessages,
  getCodexPlans,
  getCodexThreadMap,
  getCodexTouchedFiles,
  indexCodexSessions,
  searchSessions
} from "../packages/core/src/index.js";

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-28T00-00-00-019f-test-thread.jsonl");
  const lines = [
    {
      session_meta: {
        payload: {
          id: "019f-test-thread",
          cwd: "/Volumes/LEXAR/repos/example",
          model: "gpt-5.5",
          git: { branch: "main", commit_hash: "abc1234" }
        }
      }
    },
    { event_msg: { type: "thread_name", name: "Implement billing bridge" } },
    {
      response_item: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "<proposed_plan>\n# Billing bridge\nShip a guarded bridge.\n</proposed_plan>"
          }
        ]
      }
    },
    {
      response_item: {
        type: "function_call",
        call_id: "call_1",
        name: "functions.exec_command",
        arguments: "{\"cmd\":\"sed -n '1,20p' /Volumes/LEXAR/repos/example/src/billing.ts\"}"
      }
    },
    {
      event_msg: {
        type: "agent_message",
        message: "Final: billing bridge smoke passed. Next action: open PR."
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return { root, sessions, threadPath };
}

test("indexes Codex sessions with plans, finals, touched files, and search text", () => {
  const fixture = makeFixture();
  const dbPath = join(fixture.root, "orchestrator.sqlite");
  const db = createDatabase(dbPath);
  try {
    const result = indexCodexSessions(db, { roots: [fixture.sessions], maxFiles: 10 });
    assert.equal(result.indexedFiles, 1);
    assert.equal(result.indexedThreads, 1);
    assert.equal(result.errors.length, 0);

    const matches = searchSessions(db, { query: "billing bridge", limit: 5 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.threadId, "019f-test-thread");
    assert.equal(matches[0]?.title, "Implement billing bridge");

    const description = describeSession(db, "019f-test-thread");
    assert.equal(description?.summary?.includes("billing bridge smoke passed"), true);
    assert.equal(description?.planCount, 1);
    assert.equal(description?.touchedFiles.length, 1);
    assert.equal(description?.touchedFiles[0], "/Volumes/LEXAR/repos/example/src/billing.ts");

    assert.equal(getCodexThreadMap(db, { limit: 10 })[0]?.threadId, "019f-test-thread");
    assert.equal(getCodexFinalMessages(db, { limit: 10 })[0]?.text.includes("Next action"), true);
    assert.equal(getCodexPlans(db, { limit: 10 })[0]?.text.includes("Billing bridge"), true);
    assert.deepEqual(getCodexTouchedFiles(db, { threadId: "019f-test-thread" }), ["/Volumes/LEXAR/repos/example/src/billing.ts"]);

    const expanded = expandSession(db, { threadId: "019f-test-thread", tokenBudget: 80 });
    assert.equal(expanded.threadId, "019f-test-thread");
    assert.equal(expanded.text.includes("Implement billing bridge"), true);
    assert.equal(expanded.text.includes("billing bridge smoke passed"), true);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
