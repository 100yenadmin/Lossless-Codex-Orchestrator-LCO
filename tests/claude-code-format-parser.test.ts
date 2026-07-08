import assert from "node:assert/strict";
import test from "node:test";

import { parseClaudeCodeJsonl } from "../packages/core/src/index.js";

const SOURCE_PATH = "/Users/lume/.claude/projects/-Volumes-LEXAR-repos-Lossless-Codex-Orchestrator-LCO/session-with-secret.jsonl";

test("Claude Code JSONL parser emits public-safe session metadata, ranges, and omissions", () => {
  const rawSecret = "sk-test_claude_parser_secret_1234567890";
  const jsonl = [
    JSON.stringify({
      type: "user",
      sessionId: "claude-live-1",
      uuid: "user-1",
      timestamp: "2026-07-08T05:20:00.000Z",
      cwd: "/Users/lume/private/customer-workspace",
      message: {
        role: "user",
        content: `Please implement the Claude importer from /Users/lume/private/customer-workspace and keep ${rawSecret} hidden.`
      }
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "claude-live-1",
      uuid: "assistant-1",
      parentUuid: "user-1",
      timestamp: "2026-07-08T05:21:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "I will map safe event ranges and summarize tool metadata only." },
          {
            type: "tool_use",
            id: "toolu_01",
            name: "Bash",
            input: { command: `cat /Users/lume/private/customer-workspace/session.jsonl && echo ${rawSecret}` }
          }
        ]
      }
    }),
    JSON.stringify({
      type: "user",
      sessionId: "claude-live-1",
      uuid: "tool-result-1",
      parentUuid: "assistant-1",
      timestamp: "2026-07-08T05:22:00.000Z",
      toolUseResult: {
        stdout: `raw tool output with /Users/lume/private/customer-workspace/session.jsonl and ${rawSecret}`,
        stderr: ""
      },
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "tool output omitted" }]
      }
    }),
    JSON.stringify({
      type: "summary",
      sessionId: "claude-live-1",
      uuid: "summary-1",
      timestamp: "2026-07-08T05:25:00.000Z",
      summary: "Claude importer mapped events, tool metadata, and safe source ranges."
    })
  ].join("\n");

  const parsed = parseClaudeCodeJsonl(SOURCE_PATH, jsonl);
  const serialized = JSON.stringify(parsed);

  assert.equal(parsed.sessionId, "claude-live-1");
  assert.equal(parsed.sourceKind, "claude_session");
  assert.equal(parsed.sourceRef, "claude_session:claude-live-1");
  assert.match(parsed.sourcePathRef, /^claude_source:[a-f0-9]{16}$/);
  assert.match(parsed.projectSlug ?? "", /^claude_project_[a-f0-9]{16}$/);
  assert.equal(parsed.eventCount, 4);
  assert.equal(parsed.eventCounts.userMessages, 1);
  assert.equal(parsed.eventCounts.assistantMessages, 1);
  assert.equal(parsed.eventCounts.toolUses, 1);
  assert.equal(parsed.eventCounts.toolResults, 1);
  assert.equal(parsed.eventCounts.summaries, 1);
  assert.equal(parsed.sourceRanges.length, 4);
  assert.ok(parsed.sourceRanges.every((range) => /^claude_event:[a-f0-9]{32}$/.test(range.eventRef)));
  assert.ok(parsed.sourceRanges.every((range) => /^claude_range:[a-f0-9]{32}$/.test(range.rangeRef)));
  assert.ok(parsed.omissions.some((omission) => omission.reason === "tool_payload_omitted"));
  assert.ok(parsed.safeText.includes("Please implement the Claude importer"));
  assert.ok(parsed.safeText.includes("<redacted-path>"));
  assert.ok(parsed.safeText.includes("Tool use: Bash"));
  assert.ok(parsed.safeText.includes("Tool result omitted"));

  assert.equal(serialized.includes("/Users/lume"), false);
  assert.equal(serialized.includes("customer-workspace"), false);
  assert.equal(serialized.includes("session-with-secret.jsonl"), false);
  assert.equal(serialized.includes("session.jsonl"), false);
  assert.equal(serialized.includes(rawSecret), false);
  assert.equal(serialized.includes("raw tool output"), false);
});

test("Claude Code JSONL parser reports malformed rows without leaking their text", () => {
  const jsonl = [
    JSON.stringify({
      type: "user",
      sessionId: "/Users/lume/private/session-id",
      uuid: "user-1",
      timestamp: "2026-07-08T05:30:00.000Z",
      message: { role: "user", content: "Find recall gaps" }
    }),
    "{ not json /Users/lume/private/raw-row sk-test_badrow_1234567890"
  ].join("\n");

  const parsed = parseClaudeCodeJsonl(SOURCE_PATH, jsonl);
  const serialized = JSON.stringify(parsed);

  assert.match(parsed.sessionId, /^claude_[a-f0-9]{16}$/);
  assert.equal(parsed.eventCount, 1);
  assert.equal(parsed.parseErrors.length, 1);
  assert.deepEqual(parsed.parseErrors[0], { lineNumber: 2, reason: "invalid_json" });
  assert.ok(parsed.omissions.some((omission) => omission.reason === "invalid_json_line"));
  assert.equal(serialized.includes("/Users/lume"), false);
  assert.equal(serialized.includes("sk-test_badrow"), false);
  assert.equal(serialized.includes("not json"), false);
});

test("Claude Code JSONL parser hashes token-shaped session ids and redacts extracted token text", () => {
  const rawToken = `npm_${"a".repeat(32)}`;
  const jsonl = JSON.stringify({
    type: "user",
    sessionId: rawToken,
    uuid: "user-token-1",
    timestamp: "2026-07-08T05:35:00.000Z",
    message: {
      role: "user",
      content: `Do not leak this package token ${rawToken}.`
    }
  });

  const parsed = parseClaudeCodeJsonl(SOURCE_PATH, jsonl);
  const serialized = JSON.stringify(parsed);

  assert.match(parsed.sessionId, /^claude_[a-f0-9]{16}$/);
  assert.equal(parsed.sourceRef, `claude_session:${parsed.sessionId}`);
  assert.equal(serialized.includes(rawToken), false);
  assert.equal(parsed.safeText.includes("<redacted-secret>"), true);
});

test("Claude Code JSONL parser preserves structural event kinds when summary text is incidental", () => {
  const jsonl = [
    JSON.stringify({
      type: "assistant",
      sessionId: "claude-summary-edge",
      uuid: "assistant-summary-edge",
      timestamp: "2026-07-08T05:36:00.000Z",
      summary: "Sidecar summary field for UI display, not a summary event.",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "I will inspect the session map." },
          { type: "tool_use", id: "toolu_summary_edge", name: "Read", input: { file_path: "/Users/lume/private/session.jsonl" } }
        ]
      }
    }),
    JSON.stringify({
      type: "user",
      sessionId: "claude-summary-edge",
      uuid: "tool-result-summary-edge",
      parentUuid: "assistant-summary-edge",
      timestamp: "2026-07-08T05:37:00.000Z",
      summary: "Result sidecar summary field.",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_summary_edge", content: "raw result omitted" }]
      }
    })
  ].join("\n");

  const parsed = parseClaudeCodeJsonl(SOURCE_PATH, jsonl);

  assert.equal(parsed.eventCounts.summaries, 0);
  assert.equal(parsed.eventCounts.assistantMessages, 1);
  assert.equal(parsed.eventCounts.toolResults, 1);
  assert.equal(parsed.sourceRanges[0]?.eventKind, "assistant_message");
  assert.equal(parsed.sourceRanges[1]?.eventKind, "tool_result");
});

test("Claude Code JSONL parser keeps attachment and rich-content records structure-only", () => {
  const rawSecret = "npm_abcdefghijklmnopqrstuvwxyz123456";
  const jsonl = [
    JSON.stringify({
      type: "assistant",
      sessionId: "claude-rich-1",
      uuid: "assistant-rich-1",
      timestamp: "2026-07-08T05:40:00.000Z",
      cwd: "/Users/lume/private/rich-project",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: `private chain with ${rawSecret}`, signature: "sig-private" },
          { type: "source", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgoPRIVATE" } },
          { type: "tool_use", id: "toolu_rich", name: "Read", input: { file_path: "/Users/lume/private/rich-project/secrets.ts" } }
        ]
      },
      attachment: {
        type: "hook",
        command: `cat /Users/lume/private/rich-project/secrets.ts && echo ${rawSecret}`,
        stdout: "raw output should never surface",
        stderr: "raw error should never surface",
        exitCode: 0,
        durationMs: 42,
        hookName: "PostToolUse",
        hookEvent: "post_tool_use",
        toolUseID: "toolu_rich"
      },
      addedLines: [`const token = "${rawSecret}"`],
      addedNames: ["/Users/lume/private/rich-project/secrets.ts"],
      pendingMcpServers: ["private-server"]
    })
  ].join("\n");

  const parsed = parseClaudeCodeJsonl(SOURCE_PATH, jsonl);
  const serialized = JSON.stringify(parsed);

  assert.equal(parsed.sessionId, "claude-rich-1");
  assert.equal(parsed.eventCount, 1);
  assert.equal(parsed.eventCounts.assistantMessages, 1);
  assert.equal(parsed.eventCounts.toolUses, 1);
  assert.equal(parsed.eventCounts.toolResults, 0);
  assert.ok(parsed.omissions.some((omission) => omission.reason === "tool_payload_omitted"));
  assert.ok(parsed.safeText.includes("Tool use: Read"));
  assert.equal(serialized.includes(rawSecret), false);
  assert.equal(serialized.includes("/Users/lume"), false);
  assert.equal(serialized.includes("rich-project"), false);
  assert.equal(serialized.includes("secrets.ts"), false);
  assert.equal(serialized.includes("private chain"), false);
  assert.equal(serialized.includes("sig-private"), false);
  assert.equal(serialized.includes("iVBORw0KGgoPRIVATE"), false);
  assert.equal(serialized.includes("raw output"), false);
  assert.equal(serialized.includes("raw error"), false);
  assert.equal(serialized.includes("private-server"), false);
});
