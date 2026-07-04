import assert from "node:assert/strict";
import test from "node:test";

import {
  findAgentProvenanceRecords,
  parseAgentProvenanceText
} from "../packages/core/src/index.js";

const parentThreadId = "019f-parent-thread";
const workerThreadId = "019f-worker-thread";
const finalTurnId = "turn_final_01JZ4AGENT436";
const branchName = "issue-436-agent-provenance-schema";

test("parses hidden issue-comment provenance marker into public-safe lane schema", () => {
  const comment = [
    "Implemented the focused parser fixture slice.",
    `<!-- lco-agent-provenance repo=100yenadmin/Lossless-Codex-Orchestrator-LCO issue=436 pr=454 parent_thread=codex_thread:${parentThreadId} worker_thread=codex_thread:${workerThreadId} branch=${branchName} commit=abc1234 final_turn=${finalTurnId} -->`
  ].join("\n\n");

  const report = parseAgentProvenanceText(comment, {
    sourceKind: "issue_comment",
    sourceRef: "github_issue_comment:436#agent-provenance"
  });

  assert.equal(report.schema, "lco.agent.provenance.parse.v1");
  assert.equal(report.publicSafe, true);
  assert.equal(report.records.length, 1);
  assert.deepEqual(report.findings, []);

  assert.deepEqual(report.records[0], {
    schema: "lco.agent.provenance.v1",
    publicSafe: true,
    sourceKind: "issue_comment",
    sourceRef: "github_issue_comment:436#agent-provenance",
    repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
    targetIssues: [436],
    pullRequests: [454],
    parentThreadId,
    workerThreadId,
    branch: branchName,
    commit: "abc1234",
    finalTurnId,
    evidenceRef: null,
    agentRole: null,
    model: null,
    markerKind: "hidden_marker"
  });
});

test("parses visible PR-body provenance block and lookup finds lanes by thread ids", () => {
  const prBody = [
    "## Summary",
    "Adds a public-safe parser.",
    "",
    "## Agent provenance",
    "",
    `- Orchestrator thread: \`codex_thread:${parentThreadId}\``,
    `- Worker thread: \`codex_thread:${workerThreadId}\``,
    "- Agent role/name: `schema-fixture-worker`",
    "- Model: `gpt-5.5`",
    "- Target issue(s): `#436`",
    `- PR/branch: \`${branchName}\``,
    `- Final turn id: \`${finalTurnId}\``,
    "- Evidence packet: `github_issue:436#agent-provenance`"
  ].join("\n");

  const report = parseAgentProvenanceText(prBody, {
    sourceKind: "pr_body",
    sourceRef: "github_pr:454"
  });

  assert.equal(report.records.length, 1);
  assert.equal(report.records[0]?.markerKind, "visible_block");
  assert.equal(report.records[0]?.parentThreadId, parentThreadId);
  assert.equal(report.records[0]?.workerThreadId, workerThreadId);
  assert.deepEqual(report.records[0]?.targetIssues, [436]);
  assert.equal(report.records[0]?.branch, branchName);
  assert.equal(report.records[0]?.finalTurnId, finalTurnId);

  const matches = findAgentProvenanceRecords(report.records, {
    parentThreadId,
    workerThreadId,
    targetIssue: 436,
    branch: branchName,
    finalTurnId
  });
  assert.deepEqual(matches.map((record) => record.sourceRef), ["github_pr:454"]);
});

test("provenance parser reports redaction canaries without leaking raw private values", () => {
  const rawLocalPath = "/Users/exampleuser/.codex/sessions/raw-private.jsonl";
  const rawSecret = "sk-test_private_canary_1234567890";
  const rawTranscript = "RAW_TRANSCRIPT_CANARY customer prompt should never be returned";
  const comment = [
    rawTranscript,
    `<!-- lco-agent-provenance repo=100yenadmin/Lossless-Codex-Orchestrator-LCO issue=436 parent_thread=codex_thread:${parentThreadId} worker_thread=codex_thread:${workerThreadId} branch=${branchName} final_turn=${finalTurnId} evidence=${rawLocalPath} token=${rawSecret} -->`
  ].join("\n");

  const report = parseAgentProvenanceText(comment, {
    sourceKind: "issue_comment",
    sourceRef: "github_issue_comment:436#unsafe-canaries"
  });

  assert.equal(report.publicSafe, true);
  assert.equal(report.records.length, 1);
  assert.equal(report.records[0]?.evidenceRef, null);
  assert.deepEqual(report.findings.map((finding) => finding.patternClass).sort(), ["local_path", "raw_transcript", "secret"]);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(rawLocalPath), false);
  assert.equal(serialized.includes(rawSecret), false);
  assert.equal(serialized.includes(rawTranscript), false);
  assert.equal(serialized.includes("customer prompt"), false);
});
