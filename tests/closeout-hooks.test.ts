import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createCloseoutEnvelopeReport,
  createDatabase,
  createPublicCommentHygieneReport,
  describeSession,
  indexCodexSessions
} from "../packages/core/src/index.js";

function writeSession(root: string, threadId: string, title: string, messages: string[], minute = 0): void {
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, `rollout-2026-06-29T00-00-00-${threadId}.jsonl`);
  const minutePart = String(minute).padStart(2, "0");
  const lines = [
    { timestamp: `2026-06-29T00:${minutePart}:00Z`, session_meta: { payload: { id: threadId, cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator" } } },
    { timestamp: `2026-06-29T00:${minutePart}:01Z`, event_msg: { type: "thread_name", name: title } },
    {
      timestamp: `2026-06-29T00:${minutePart}:02Z`,
      response_item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "<proposed_plan>\n1. Keep the closeout metadata public-safe.\n</proposed_plan>" }]
      }
    },
    ...messages.map((message, index) => ({
      timestamp: `2026-06-29T00:${minutePart}:${String(index + 3).padStart(2, "0")}Z`,
      event_msg: { type: "agent_message", message }
    }))
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
}

function writeFunctionCallSession(root: string, threadId: string, title: string, toolArguments: string): void {
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const threadPath = join(sessions, `rollout-2026-06-29T00-00-00-${threadId}.jsonl`);
  const lines = [
    { timestamp: "2026-06-29T00:00:00Z", session_meta: { payload: { id: threadId, cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator" } } },
    { timestamp: "2026-06-29T00:00:01Z", event_msg: { type: "thread_name", name: title } },
    {
      timestamp: "2026-06-29T00:00:02Z",
      response_item: {
        type: "function_call",
        call_id: `${threadId}-tool-call`,
        name: "shell.write_file",
        arguments: toolArguments
      }
    }
  ];
  writeFileSync(threadPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
}

test("public comment hygiene blocks repeated local-path fragments without echoing the path", () => {
  const rawPath = "/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/issue-306-ga-validation/";
  const malformedBody = [
    "Closeout: release validation finished for #306.",
    `${rawPath}${rawPath}${rawPath}`,
    rawPath,
    rawPath,
    "Next action: use the concise evidence summary instead."
  ].join("\n");

  const report = createPublicCommentHygieneReport(malformedBody, {
    requireIssueOrPrRef: true
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.publicSafe, true);
  assert.equal(report.ok, false);
  assert.equal(report.status, "blocked");
  assert.equal(report.blockers.includes("absolute_path_prefix_repeated"), true);
  assert.equal(report.blockers.includes("path_fragment_repeated"), true);
  assert.equal(report.actionsPerformed.githubWrite, false);
  assert.equal(serialized.includes(rawPath), false);
  assert.equal(serialized.includes("/Volumes/LEXAR"), false);
  assert.match(report.redactedPreview, /<redacted-path>/);
});

test("public comment hygiene redacts user and temp path previews before reporting", () => {
  const userPath = "/Users/lume/private/release-notes.md";
  const tmpPath = "/tmp/lco-public-comment/comment.txt";
  const report = createPublicCommentHygieneReport([
    "Closeout: #316 should block private path previews before public issue comments.",
    userPath,
    userPath,
    tmpPath,
    tmpPath
  ].join("\n"));
  const serialized = JSON.stringify(report);

  assert.equal(report.status, "blocked");
  assert.equal(report.blockers.includes("absolute_path_prefix_repeated"), true);
  assert.equal(serialized.includes(userPath), false);
  assert.equal(serialized.includes(tmpPath), false);
  assert.equal(serialized.includes("~/private"), false);
  assert.equal(serialized.includes("/tmp/lco-public-comment"), false);
  assert.match(report.redactedPreview, /<redacted-path>/);
});

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
      assert.equal(report.summary.ready, 1);
      assert.equal(report.summary.partial, 3);

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
      assert.equal(duplicate?.state, "partial");
      assert.equal(duplicate?.wouldAttach, false);
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

test("closeout dry-run blocks otherwise ready public comments with repeated local-path spam", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-closeout-hygiene-"));
  const rawPath = "/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/issue-306-ga-validation/";
  try {
    writeSession(root, "019f-closeout-path-spam", "Path-spam closeout envelope", [
      [
        "<loo_closeout>",
        "Project: lossless-openclaw-orchestrator",
        "Status: complete",
        "Next action: close issue #306 after concise evidence comment",
        "Closeout state: complete",
        "Proposed plan completion: complete",
        "Final-message refs: codex_event:final-path-spam",
        "Source refs: codex_thread:019f-closeout-path-spam",
        `Evidence: ${rawPath}${rawPath}${rawPath}`,
        rawPath,
        "</loo_closeout>"
      ].join("\n")
    ]);

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const indexed = indexCodexSessions(db, { roots: [join(root, "sessions")], maxFiles: 10 });
      assert.equal(indexed.errors.length, 0);

      const report = createCloseoutEnvelopeReport(db, { threadId: "019f-closeout-path-spam" });
      const candidate = report.candidates[0];
      const serialized = JSON.stringify(report);

      assert.equal(report.summary.ready, 0);
      assert.equal(report.summary.partial, 1);
      assert.equal(candidate?.state, "partial");
      assert.equal(candidate?.wouldAttach, false);
      assert.equal(candidate?.warnings.includes("public_comment_hygiene_blocked"), true);
      assert.equal(candidate?.publicCommentHygiene?.ok, false);
      assert.equal(candidate?.publicCommentHygiene?.blockers.includes("absolute_path_prefix_repeated"), true);
      assert.equal(serialized.includes(rawPath), false);
      assert.equal(serialized.includes("/Volumes/LEXAR"), false);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("closeout dry-run uses full message envelope evidence beyond safe-text truncation", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-closeout-hooks-full-source-"));
  try {
    writeSession(root, "019f-closeout-after-padding", "Envelope after long context", [
      "Public-safe progress padding. ".repeat(12_000),
      [
        "<loo_closeout>",
        "Project: lossless-openclaw-orchestrator",
        "Status: complete",
        "Next action: merge issue #50",
        "Closeout state: complete",
        "Proposed plan completion: complete",
        "Final-message refs: codex_event:final-after-padding",
        "Source refs: codex_thread:019f-closeout-after-padding",
        "</loo_closeout>"
      ].join("\n")
    ]);

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const indexed = indexCodexSessions(db, { roots: [join(root, "sessions")], maxFiles: 10 });
      assert.equal(indexed.errors.length, 0);

      const report = createCloseoutEnvelopeReport(db, { threadId: "019f-closeout-after-padding" });
      assert.equal(report.summary.ready, 1);
      assert.equal(report.candidates[0]?.wouldAttach, true);
      assert.equal(report.candidates[0]?.metadata.project, "lossless-openclaw-orchestrator");
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("closeout dry-run parses envelope labels case-insensitively", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-closeout-hooks-lowercase-"));
  try {
    writeSession(root, "019f-closeout-lowercase", "Lowercase closeout envelope", [
      [
        "<loo_closeout>",
        "project: lossless-openclaw-orchestrator",
        "status: complete",
        "next action: merge issue #50",
        "closeout state: complete",
        "proposed plan completion: complete",
        "final-message refs: codex_event:final-lowercase",
        "source refs: codex_thread:019f-closeout-lowercase",
        "</loo_closeout>"
      ].join("\n")
    ]);

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const indexed = indexCodexSessions(db, { roots: [join(root, "sessions")], maxFiles: 10 });
      assert.equal(indexed.errors.length, 0);

      const report = createCloseoutEnvelopeReport(db, { threadId: "019f-closeout-lowercase" });
      assert.equal(report.summary.ready, 1);
      assert.equal(report.candidates[0]?.metadata.status, "complete");
      assert.equal(report.candidates[0]?.metadata.planCompletionState, "complete");
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("closeout dry-run ignores sample envelopes inside tool-call payloads", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-closeout-hooks-tool-payload-"));
  try {
    writeFunctionCallSession(root, "019f-closeout-tool-sample", "Tool payload sample envelope", [
      "Writing a fixture that contains a sample envelope:",
      "<loo_closeout>",
      "Project: lossless-openclaw-orchestrator",
      "Status: complete",
      "Next action: do not attach this sample",
      "Closeout state: complete",
      "Proposed plan completion: complete",
      "Final-message refs: codex_event:sample-final",
      "Source refs: codex_thread:019f-closeout-tool-sample",
      "</loo_closeout>"
    ].join("\n"));

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const indexed = indexCodexSessions(db, { roots: [join(root, "sessions")], maxFiles: 10 });
      assert.equal(indexed.errors.length, 0);

      const report = createCloseoutEnvelopeReport(db, { limit: 10, includeUnavailable: true });
      const candidate = report.candidates.find((item) => item.threadId === "019f-closeout-tool-sample");
      assert.equal(candidate?.state, "unavailable");
      assert.equal(candidate?.wouldAttach, false);
      assert.equal(candidate?.closeoutEnvelopeCount, 0);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("closeout dry-run filters unavailable candidates before applying limit", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-closeout-hooks-limit-"));
  try {
    writeSession(root, "019f-closeout-ready-old", "Older ready closeout envelope", [
      [
        "<loo_closeout>",
        "Project: lossless-openclaw-orchestrator",
        "Status: complete",
        "Next action: merge issue #50",
        "Closeout state: complete",
        "Proposed plan completion: complete",
        "Final-message refs: codex_event:final-old-ready",
        "Source refs: codex_thread:019f-closeout-ready-old",
        "</loo_closeout>"
      ].join("\n")
    ], 1);
    writeSession(root, "019f-closeout-unavailable-new", "Newer session without closeout", [
      "This is ordinary working context without any closeout labels or envelope."
    ], 10);

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const indexed = indexCodexSessions(db, { roots: [join(root, "sessions")], maxFiles: 10 });
      assert.equal(indexed.errors.length, 0);

      const report = createCloseoutEnvelopeReport(db, { limit: 1 });
      assert.equal(report.summary.total, 1);
      assert.equal(report.candidates[0]?.threadId, "019f-closeout-ready-old");
      assert.equal(report.candidates[0]?.wouldAttach, true);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("closeout dry-run requires a balanced envelope and scopes metadata to that envelope", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-closeout-hooks-scope-"));
  try {
    writeSession(root, "019f-closeout-labels-only", "Metadata labels without envelope", [
      [
        "Project: lossless-openclaw-orchestrator",
        "Status: complete",
        "Next action: do not attach without an envelope",
        "Closeout state: complete",
        "Proposed plan completion: complete",
        "Final-message refs: codex_event:final-labels-only",
        "Source refs: codex_thread:019f-closeout-labels-only"
      ].join("\n")
    ]);
    writeSession(root, "019f-closeout-stale-envelope", "Incomplete envelope with later discussion labels", [
      [
        "<loo_closeout>",
        "Project: lossless-openclaw-orchestrator",
        "Status: in-progress",
        "Next action: finish the real closeout payload",
        "</loo_closeout>"
      ].join("\n"),
      [
        "Later discussion, not a closeout envelope.",
        "Closeout state: complete",
        "Proposed plan completion: complete",
        "Final-message refs: codex_event:final-outside-envelope",
        "Source refs: codex_thread:019f-closeout-stale-envelope"
      ].join("\n")
    ]);

    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const indexed = indexCodexSessions(db, { roots: [join(root, "sessions")], maxFiles: 10 });
      assert.equal(indexed.errors.length, 0);

      const report = createCloseoutEnvelopeReport(db, { limit: 10, includeUnavailable: true });
      const byThread = new Map(report.candidates.map((candidate) => [candidate.threadId, candidate]));

      const labelsOnly = byThread.get("019f-closeout-labels-only");
      assert.equal(labelsOnly?.state, "partial");
      assert.equal(labelsOnly?.wouldAttach, false);
      assert.equal(labelsOnly?.closeoutEnvelopeCount, 0);
      assert.equal(labelsOnly?.metadata.project, null);
      assert.equal(labelsOnly?.missingFields.includes("project"), true);

      const staleEnvelope = byThread.get("019f-closeout-stale-envelope");
      assert.equal(staleEnvelope?.state, "partial");
      assert.equal(staleEnvelope?.wouldAttach, false);
      assert.equal(staleEnvelope?.metadata.project, "lossless-openclaw-orchestrator");
      assert.equal(staleEnvelope?.metadata.closeoutState, null);
      assert.equal(staleEnvelope?.metadata.finalMessageRefs.length, 0);
      assert.equal(staleEnvelope?.missingFields.includes("closeoutState"), true);
      assert.equal(staleEnvelope?.missingFields.includes("finalMessageRefs"), true);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
