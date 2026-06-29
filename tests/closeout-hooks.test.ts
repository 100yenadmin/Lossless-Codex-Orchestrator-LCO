import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createCloseoutEnvelopeReport,
  createDatabase,
  describeSession,
  indexCodexSessions
} from "../packages/core/src/index.js";

function writeSession(root: string, threadId: string, title: string, messages: string[]): void {
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, `rollout-2026-06-29T00-00-00-${threadId}.jsonl`);
  const lines = [
    { timestamp: "2026-06-29T00:00:00Z", session_meta: { payload: { id: threadId, cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator" } } },
    { timestamp: "2026-06-29T00:00:01Z", event_msg: { type: "thread_name", name: title } },
    {
      timestamp: "2026-06-29T00:00:02Z",
      response_item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "<proposed_plan>\n1. Keep the closeout metadata public-safe.\n</proposed_plan>" }]
      }
    },
    ...messages.map((message, index) => ({
      timestamp: `2026-06-29T00:00:${String(index + 3).padStart(2, "0")}Z`,
      event_msg: { type: "agent_message", message }
    }))
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
}

test("closeout dry-run report distinguishes ready, partial, duplicate, and malformed envelopes without mutating Codex", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-closeout-hooks-"));
  try {
    writeSession(root, "019f-closeout-ready", "Ready closeout envelope", [
      [
        "<loo_closeout>",
        "Project: lossless-openclaw-orchestrator",
        "Status: merged",
        "Priority: high",
        "Owner: codex",
        "Blocker: none",
        "Next action: start issue #51 session map",
        "Closeout state: complete",
        "Proposed plan completion: complete",
        "Proposed plan refs: codex_event:plan-ready",
        "Final-message refs: codex_event:final-ready",
        "Touched-file refs: codex_event:file-ready",
        "Source refs: codex_thread:019f-closeout-ready",
        "</loo_closeout>",
        "Final: closeout hook dry-run proof complete. Next action: start issue #51."
      ].join("\n")
    ]);

    writeSession(root, "019f-closeout-partial", "Partial closeout envelope", [
      [
        "Status: in-progress",
        "Next action: finish implementation",
        "Final: still building; do not attach a completed closeout envelope."
      ].join("\n")
    ]);

    writeSession(root, "019f-closeout-duplicate", "Duplicate closeout envelope", [
      [
        "<loo_closeout>",
        "Project: lossless-openclaw-orchestrator",
        "Status: blocked",
        "Next action: wait for review",
        "Closeout state: blocked",
        "Proposed plan completion: partial",
        "Final-message refs: codex_event:final-old",
        "Source refs: codex_thread:019f-closeout-duplicate",
        "</loo_closeout>"
      ].join("\n"),
      [
        "<loo_closeout>",
        "Project: lossless-openclaw-orchestrator",
        "Status: complete",
        "Next action: merge after approval",
        "Closeout state: complete",
        "Proposed plan completion: complete",
        "Final-message refs: codex_event:final-new",
        "Source refs: codex_thread:019f-closeout-duplicate",
        "</loo_closeout>"
      ].join("\n")
    ]);

    writeSession(root, "019f-closeout-malformed", "Malformed closeout envelope", [
      [
        "<loo_closeout>",
        "Project: lossless-openclaw-orchestrator",
        "Status: blocked",
        "Next action: repair closeout envelope"
      ].join("\n")
    ]);

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const indexed = indexCodexSessions(db, { roots: [join(root, "sessions")], maxFiles: 10 });
      assert.equal(indexed.errors.length, 0);
      assert.equal(indexed.indexedThreads, 4);

      const readyMetadata = describeSession(db, "019f-closeout-ready")?.metadata;
      assert.equal(readyMetadata?.planCompletionState, "complete");

      const report = createCloseoutEnvelopeReport(db, { limit: 10 });
      assert.equal(report.dryRun, true);
      assert.equal(report.mutatesCodex, false);
      assert.equal(report.hookAgentReady, false);
      assert.equal(report.approvalRequiredForHookExecution, true);
      assert.equal(report.summary.total, 4);
      assert.equal(report.summary.ready, 2);
      assert.equal(report.summary.partial, 2);

      const byThread = new Map(report.candidates.map((candidate) => [candidate.threadId, candidate]));
      const ready = byThread.get("019f-closeout-ready");
      assert.equal(ready?.state, "ready");
      assert.equal(ready?.wouldAttach, true);
      assert.equal(ready?.metadata.project, "lossless-openclaw-orchestrator");
      assert.equal(ready?.metadata.blocker, null);
      assert.equal(ready?.metadata.planCompletionState, "complete");
      assert.deepEqual(ready?.missingFields, []);
      assert.deepEqual(ready?.warnings, []);

      const partial = byThread.get("019f-closeout-partial");
      assert.equal(partial?.state, "partial");
      assert.equal(partial?.wouldAttach, false);
      assert.equal(partial?.missingFields.includes("project"), true);
      assert.equal(partial?.missingFields.includes("closeoutState"), true);
      assert.equal(partial?.missingFields.includes("finalMessageRefs"), true);

      const duplicate = byThread.get("019f-closeout-duplicate");
      assert.equal(duplicate?.state, "ready");
      assert.equal(duplicate?.wouldAttach, true);
      assert.equal(duplicate?.metadata.status, "complete");
      assert.deepEqual(duplicate?.metadata.finalMessageRefs, ["codex_event:final-new"]);
      assert.equal(duplicate?.warnings.includes("duplicate_closeout_envelopes"), true);

      const malformed = byThread.get("019f-closeout-malformed");
      assert.equal(malformed?.state, "partial");
      assert.equal(malformed?.wouldAttach, false);
      assert.equal(malformed?.warnings.includes("malformed_closeout_envelope"), true);

      const cli = spawnSync(process.execPath, [
        "--import",
        "tsx",
        "packages/cli/src/index.ts",
        "closeout",
        "dry-run",
        "--thread-id",
        "019f-closeout-ready"
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          LOO_DB_PATH: join(root, "orchestrator.sqlite")
        }
      });
      assert.equal(cli.status, 0, cli.stderr);
      const cliReport = JSON.parse(cli.stdout) as ReturnType<typeof createCloseoutEnvelopeReport>;
      assert.equal(cliReport.summary.total, 1);
      assert.equal(cliReport.candidates[0]?.threadId, "019f-closeout-ready");
      assert.equal(cliReport.candidates[0]?.wouldAttach, true);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
