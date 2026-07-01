import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabase,
  describeSession,
  describeRecallRef,
  expandSession,
  getCodexFinalMessages,
  getCodexPlans,
  getCodexThreadMap,
  getCodexTouchedFiles,
  getRecentSessions,
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
    assert.equal(description?.summary?.includes("Model: gpt-5.5"), true);
    assert.equal(description?.summary?.includes("Branch: main@abc1234"), true);
    assert.equal(description?.summary?.includes("Files: /Volumes/LEXAR/repos/example/src/billing.ts"), true);
    assert.equal(description?.summary?.includes("Tools: functions.exec_command"), true);
    assert.equal(description?.planCount, 1);
    assert.equal(description?.touchedFiles.length, 1);
    assert.equal(description?.touchedFiles[0], "/Volumes/LEXAR/repos/example/src/billing.ts");

    assert.equal(getCodexThreadMap(db, { limit: 10 })[0]?.threadId, "019f-test-thread");
    assert.equal(getCodexFinalMessages(db, { limit: 10 })[0]?.text.includes("Next action"), true);
    assert.equal(getCodexPlans(db, { limit: 10 })[0]?.text.includes("Billing bridge"), true);
    assert.deepEqual(getCodexTouchedFiles(db, { threadId: "019f-test-thread" }), ["/Volumes/LEXAR/repos/example/src/billing.ts"]);
    assert.deepEqual(getRecentSessions(db, { touchedPath: "src/billing.ts", includeCards: true }).cards.map((card) => card.threadId), ["codex_thread:019f-test-thread"]);

    const expanded = expandSession(db, { threadId: "019f-test-thread", tokenBudget: 80 });
    assert.equal(expanded.threadId, "019f-test-thread");
    assert.equal(expanded.text.includes("Implement billing bridge"), true);
    assert.equal(expanded.text.includes("billing bridge smoke passed"), true);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("extracts public-safe session metadata and closeout fields", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-metadata-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-29T00-00-00-019f-metadata-thread.jsonl");
  const lines = [
    {
      session_meta: {
        payload: {
          id: "019f-metadata-thread",
          cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator",
          model: "gpt-5.5",
          git: { branch: "issue-49-session-metadata-closeout", commit_hash: "def5678" }
        }
      }
    },
    { event_msg: { type: "thread_name", name: "Session metadata closeout schema" } },
    {
      response_item: {
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: "<proposed_plan>\n# Session metadata\nExtract public-safe closeout fields.\n</proposed_plan>"
        }]
      }
    },
    {
      event_msg: {
        type: "agent_message",
        message: [
          "Closeout state: blocked",
          "- Project: lossless-openclaw-orchestrator",
          "- Status: external-review-wait",
          "- Priority: high",
          "- Owner: codex",
          "- Blocker: CodeRabbit approval pending",
          "- Next action: re-check PR gate",
          "- Proposed plan refs: codex_event:plan-1",
          "- Final-message refs: codex_event:final-1",
          "- Touched-file refs: codex_event:file-1",
          "- Source refs: codex_thread:019f-metadata-thread"
        ].join("\n")
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    const description = describeSession(db, "019f-metadata-thread");
    assert.deepEqual(description?.metadata, {
      project: "lossless-openclaw-orchestrator",
      status: "external-review-wait",
      priority: "high",
      owner: "codex",
      blocker: "CodeRabbit approval pending",
      nextAction: "re-check PR gate",
      closeoutState: "blocked",
      planCompletionState: null,
      proposedPlanRefs: ["codex_event:plan-1"],
      finalMessageRefs: ["codex_event:final-1"],
      touchedFileRefs: ["codex_event:file-1"],
      sourceRefs: ["codex_thread:019f-metadata-thread"]
    });

    const [threadMapEntry] = getCodexThreadMap(db, { limit: 10 });
    assert.equal(threadMapEntry?.metadata.status, "external-review-wait");
    assert.equal(threadMapEntry?.metadata.nextAction, "re-check PR gate");

    const recallDescription = describeRecallRef(db, { sourceRef: "codex_thread:019f-metadata-thread" });
    assert.deepEqual(recallDescription?.metadata, description?.metadata);

    const expanded = expandSession(db, { threadId: "019f-metadata-thread", profile: "metadata" });
    assert.equal(expanded.text.includes("Project: lossless-openclaw-orchestrator"), true);
    assert.equal(expanded.text.includes("Blocker: CodeRabbit approval pending"), true);
    assert.equal(expanded.text.includes("Next action: re-check PR gate"), true);
    assert.equal(expanded.text.includes("Proposed plan refs: codex_event:plan-1"), true);
    assert.equal(expanded.text.includes("Final-message refs: codex_event:final-1"), true);
    assert.equal(expanded.text.includes("Touched-file refs: codex_event:file-1"), true);
    assert.equal(expanded.text.includes("Source refs: codex_thread:019f-metadata-thread"), true);
    const brief = expandSession(db, { threadId: "019f-metadata-thread", profile: "brief" });
    const evidence = expandSession(db, { threadId: "019f-metadata-thread", profile: "evidence" });
    assert.equal(brief.text.includes("\nProject: lossless-openclaw-orchestrator"), false);
    assert.equal(evidence.text.includes("\nProject: lossless-openclaw-orchestrator"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("backfills session metadata when unchanged source files were already indexed", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-metadata-backfill-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-29T00-00-00-019f-backfill-thread.jsonl");
  const lines = [
    { session_meta: { payload: { id: "019f-backfill-thread", cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator" } } },
    { event_msg: { type: "thread_name", name: "Metadata backfill" } },
    {
      event_msg: {
        type: "agent_message",
        message: [
          "Closeout state: complete",
          "- Project: lossless-openclaw-orchestrator",
          "- Status: merged",
          "- Next action: continue next eval lane"
        ].join("\n")
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    db.prepare("DELETE FROM codex_session_metadata WHERE thread_id = ?").run("019f-backfill-thread");

    const result = indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.equal(result.errors.length, 0);
    assert.equal(describeSession(db, "019f-backfill-thread")?.metadata.status, "merged");
    assert.equal(describeSession(db, "019f-backfill-thread")?.metadata.nextAction, "continue next eval lane");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("extracts newline-only closeout labels before safe text normalization", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-metadata-newlines-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-29T00-00-00-019f-newline-thread.jsonl");
  const lines = [
    { session_meta: { payload: { id: "019f-newline-thread", cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator" } } },
    { event_msg: { type: "thread_name", name: "Newline closeout labels" } },
    {
      event_msg: {
        type: "agent_message",
        message: [
          "Project: lossless-openclaw-orchestrator",
          "Status: external-review-wait",
          "Priority: high",
          "Owner: codex",
          "Blocker: CodeRabbit approval pending",
          "Next action: re-check PR gate",
          "Closeout state: blocked",
          "Source refs: codex_thread:019f-newline-thread"
        ].join("\n")
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    assert.deepEqual(describeSession(db, "019f-newline-thread")?.metadata, {
      project: "lossless-openclaw-orchestrator",
      status: "external-review-wait",
      priority: "high",
      owner: "codex",
      blocker: "CodeRabbit approval pending",
      nextAction: "re-check PR gate",
      closeoutState: "blocked",
      planCompletionState: null,
      proposedPlanRefs: [],
      finalMessageRefs: [],
      touchedFileRefs: [],
      sourceRefs: ["codex_thread:019f-newline-thread"]
    });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses the latest closeout metadata when sessions revise status", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-metadata-latest-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-29T00-00-00-019f-latest-thread.jsonl");
  const lines = [
    { session_meta: { payload: { id: "019f-latest-thread", cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator" } } },
    { event_msg: { type: "thread_name", name: "Latest closeout labels" } },
    {
      event_msg: {
        type: "agent_message",
        message: [
          "Project: lossless-openclaw-orchestrator",
          "Status: in-progress",
          "Blocker: CodeRabbit review pending",
          "Next action: patch implementation"
        ].join("\n")
      }
    },
    {
      event_msg: {
        type: "agent_message",
        message: [
          "Project: lossless-openclaw-orchestrator",
          "Status: complete",
          "Blocker: none",
          "Next action: merge after review",
          "Closeout state: ready"
        ].join("\n")
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const metadata = describeSession(db, "019f-latest-thread")?.metadata;
    assert.equal(metadata?.status, "complete");
    assert.equal(metadata?.blocker, null);
    assert.equal(metadata?.nextAction, "merge after review");
    assert.equal(metadata?.closeoutState, "ready");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("thread map filters and ranks by session metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-thread-map-metadata-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const fixtures = [
    {
      id: "019f-map-low",
      title: "Low priority metadata",
      status: "blocked",
      priority: "low",
      blocker: "waiting on docs",
      nextAction: "document gap"
    },
    {
      id: "019f-map-high",
      title: "High priority metadata",
      status: "blocked",
      priority: "high",
      blocker: "CodeRabbit approval pending",
      nextAction: "patch review"
    },
    {
      id: "019f-map-open",
      title: "Open metadata",
      status: "ready",
      priority: "medium",
      blocker: "none",
      nextAction: "merge after review"
    },
    {
      id: "019f-map-escaped-blocker",
      title: "Escaped blocker metadata",
      status: "blocked",
      priority: "medium",
      blocker: "100% ci_required",
      nextAction: "fix escaped blocker query"
    }
  ];
  for (const fixture of fixtures) {
    const threadPath = join(sessions, `rollout-2026-06-29T00-00-00-${fixture.id}.jsonl`);
    const lines = [
      { session_meta: { payload: { id: fixture.id, cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator" } } },
      { event_msg: { type: "thread_name", name: fixture.title } },
      {
        event_msg: {
          type: "agent_message",
          message: [
            "Project: lossless-openclaw-orchestrator",
            `Status: ${fixture.status}`,
            `Priority: ${fixture.priority}`,
            `Blocker: ${fixture.blocker}`,
            `Next action: ${fixture.nextAction}`
          ].join("\n")
        }
      }
    ];
    writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  }

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const blocked = getCodexThreadMap(db, {
      limit: 10,
      project: "lossless-openclaw-orchestrator",
      status: "blocked",
      priorityOrder: ["high", "medium", "low"]
    });

    assert.deepEqual(blocked.map((entry) => entry.threadId), ["019f-map-high", "019f-map-escaped-blocker", "019f-map-low"]);
    assert.equal(blocked[0]?.metadata.priority, "high");

    const blockerMatches = getCodexThreadMap(db, { limit: 10, blocker: "coderabbit" });
    assert.deepEqual(blockerMatches.map((entry) => entry.threadId), ["019f-map-high"]);

    const escapedBlockerMatches = getCodexThreadMap(db, { limit: 10, blocker: "100% ci_required" });
    assert.deepEqual(escapedBlockerMatches.map((entry) => entry.threadId), ["019f-map-escaped-blocker"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("preserves percent-encoded source refs and avoids false label splits", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-metadata-ref-parser-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-29T00-00-00-019f-ref-parser-thread.jsonl");
  const lines = [
    { session_meta: { payload: { id: "019f-ref-parser-thread", cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator" } } },
    { event_msg: { type: "thread_name", name: "Ref parser metadata" } },
    {
      event_msg: {
        type: "agent_message",
        message: [
          "Project: lossless-openclaw-orchestrator",
          "Blocker: waiting for CI status: required check pending",
          "Source refs: lcm_summary:abc123:folder%2Fsummary%20one"
        ].join("\n")
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    const metadata = describeSession(db, "019f-ref-parser-thread")?.metadata;
    assert.equal(metadata?.blocker, "waiting for CI status: required check pending");
    assert.equal(metadata?.status, null);
    assert.deepEqual(metadata?.sourceRefs, ["lcm_summary:abc123:folder%2Fsummary%20one"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("indexes source paths for metadata backfill checks", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-source-path-index-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const indexes = db.prepare("PRAGMA index_list(codex_sessions)").all() as Array<{ name: string }>;
    assert.equal(indexes.some((row) => row.name === "codex_sessions_source_path_idx"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("bounded expansion keeps proposed plans and touched files visible when final message is long", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-codex-long-final-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, "rollout-2026-06-28T00-00-00-019f-long-final.jsonl");
  const lines = [
    { session_meta: { payload: { id: "019f-long-final", cwd: "/Volumes/LEXAR/repos/example" } } },
    { event_msg: { type: "thread_name", name: "Long final expansion" } },
    {
      response_item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "<proposed_plan>\n1. Keep the plan visible.\n</proposed_plan>" }]
      }
    },
    {
      response_item: {
        type: "function_call",
        call_id: "call_long",
        name: "functions.exec_command",
        arguments: JSON.stringify({
          cmd: [
            "sed -n '1,20p' /Volumes/LEXAR/repos/example/src/expansion.ts",
            ...Array.from({ length: 12 }, (_, index) => `/Volumes/LEXAR/repos/example/packages/really-long-path-segment-${index}/nested/with/many/directories/for/expansion-${index}.ts`)
          ].join(" ")
        })
      }
    },
    {
      event_msg: {
        type: "agent_message",
        message: `Final: ${"long final evidence ".repeat(500)}`
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    const expanded = expandSession(db, { threadId: "019f-long-final", profile: "brief" });

    assert.equal(expanded.text.includes("Final message:"), true);
    assert.equal(expanded.text.includes("Touched files:"), true);
    assert.equal(expanded.text.includes("really-long-path-segment"), true);
    assert.equal(expanded.text.includes("more touched files omitted"), true);
    const touchedBlock = expanded.text.match(/Touched files:\n(?<block>[\s\S]*?)\n\nPlans:/)?.groups?.block ?? "";
    const renderedFiles = touchedBlock.split("\n").filter((line) => line.startsWith("- ") && !line.startsWith("- ... ")).length;
    const omittedFiles = Number(touchedBlock.match(/- \.\.\. (?<count>\d+) more touched files omitted/)?.groups?.count ?? 0);
    assert.equal(renderedFiles + omittedFiles, getCodexTouchedFiles(db, { threadId: "019f-long-final" }).length);
    assert.equal(expanded.text.length <= 4000, true);
    assert.equal(expanded.text.includes("Plans:"), true);
    assert.equal(expanded.text.includes("Keep the plan visible"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
