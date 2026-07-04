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

test("lookup treats supplied but unresolvable string filters as misses", () => {
  const comment = `<!-- lco-agent-provenance repo=100yenadmin/Lossless-Codex-Orchestrator-LCO issue=436 parent_thread=codex_thread:${parentThreadId} worker_thread=codex_thread:${workerThreadId} branch=${branchName} final_turn=${finalTurnId} -->`;
  const report = parseAgentProvenanceText(comment, {
    sourceKind: "issue_comment",
    sourceRef: "github_issue_comment:436#lookup-miss"
  });

  assert.equal(findAgentProvenanceRecords(report.records, { parentThreadId: "none" }).length, 0);
  assert.equal(findAgentProvenanceRecords(report.records, { workerThreadId: "unavailable" }).length, 0);
  assert.equal(findAgentProvenanceRecords(report.records, { branch: "/private/path" }).length, 0);
  assert.equal(findAgentProvenanceRecords(report.records, { finalTurnId: "" }).length, 0);
  assert.equal(findAgentProvenanceRecords(report.records, {}).length, 1);
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

test("provenance parser detects Linux, Windows, cloud, Slack, Google, and bearer secrets", () => {
  const awsAccessKeyCanary = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
  const slackTokenCanary = ["xoxb", "123456789012", "123456789012", "abcdefghijklmnopqrstuvwx"].join("-");
  const googleApiKeyCanary = ["AIza", "SyA-0123456789abcdefghijklmnopqrstuvwxyz"].join("");
  const bearerJwtCanary = [
    "Bearer",
    [
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      "signature"
    ].join(".")
  ].join(" ");
  const unsafeValues = [
    "/home/alice/.codex/sessions/private.jsonl",
    "/root/.aws/credentials",
    "C:\\Users\\Alice\\Documents\\private-session.jsonl",
    awsAccessKeyCanary,
    slackTokenCanary,
    googleApiKeyCanary,
    bearerJwtCanary
  ];
  const report = parseAgentProvenanceText(unsafeValues.join("\n"), {
    sourceKind: "agent_output",
    sourceRef: "agent_provenance:secret-regression"
  });

  assert.deepEqual(report.findings.map((finding) => finding.patternClass).sort(), [
    "local_path",
    "local_path",
    "local_path",
    "secret",
    "secret",
    "secret",
    "secret"
  ]);
  assert.equal(JSON.stringify(report).includes(awsAccessKeyCanary), false);
  assert.equal(JSON.stringify(report).includes(slackTokenCanary), false);
  assert.equal(JSON.stringify(report).includes(googleApiKeyCanary), false);
  assert.equal(JSON.stringify(report).includes(bearerJwtCanary), false);
});

test("provenance finding classes expose only emitted sanitizer categories", () => {
  const report = parseAgentProvenanceText([
    "/Users/exampleuser/.codex/private.jsonl",
    "sk-test_private_canary_1234567890",
    "app://connector_123",
    "RAW_TRANSCRIPT_CANARY private"
  ].join("\n"));

  assert.deepEqual(
    [...new Set(report.findings.map((finding) => finding.patternClass))].sort(),
    ["connector_url", "local_path", "raw_transcript", "secret"]
  );
});

test("hidden marker parser keeps quoted attributes with whitespace and greater-than characters intact", () => {
  const comment = [
    `<!-- lco-agent-provenance repo="100yenadmin/Lossless-Codex-Orchestrator-LCO" issue="436" pr="https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/pull/461" parent_thread="codex_thread:${parentThreadId}" worker_thread="codex_thread:${workerThreadId}" branch="${branchName}" sha="abcdef1234567890" final_turn="${finalTurnId}" evidence="artifact:reports/agent provenance > packet" agent_role="schema reviewer > parser" model="gpt-5.1-codex" -->`
  ].join("\n");

  const report = parseAgentProvenanceText(comment, {
    sourceKind: "issue_comment",
    sourceRef: "github_issue_comment:436#quoted-hidden"
  });

  assert.equal(report.records.length, 1);
  assert.equal(report.records[0]?.repo, "100yenadmin/Lossless-Codex-Orchestrator-LCO");
  assert.deepEqual(report.records[0]?.pullRequests, [461]);
  assert.equal(report.records[0]?.commit, "abcdef1234567890");
  assert.equal(report.records[0]?.evidenceRef, "artifact:reports/agent provenance > packet");
  assert.equal(report.records[0]?.agentRole, "schema reviewer > parser");
  assert.equal(report.records[0]?.model, "gpt-5.1-codex");
});

test("visible block parses commit aliases, model, agent role, github evidence URL, and pull request lookup", () => {
  const prBody = [
    "## Agent provenance",
    "",
    "- Repo: `100yenadmin/Lossless-Codex-Orchestrator-LCO`",
    `- Parent thread: \`codex_thread:${parentThreadId}\``,
    `- Worker thread: \`codex_thread:${workerThreadId}\``,
    "- Agent role/name: `schema-review-worker`",
    "- Model: `gpt-5.1-codex`",
    "- Target issues: `#436`",
    "- Pull request: `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/pull/461`",
    "- Branch: `issue-436-agent-provenance-schema`",
    "- SHA: `abcdef1234567890`",
    `- Final turn: \`${finalTurnId}\``,
    "- Evidence ref: `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/436#agent-provenance`"
  ].join("\n");

  const report = parseAgentProvenanceText(prBody, {
    sourceKind: "pr_body",
    sourceRef: "github_pr:461"
  });

  assert.equal(report.records.length, 1);
  assert.equal(report.records[0]?.repo, "100yenadmin/Lossless-Codex-Orchestrator-LCO");
  assert.deepEqual(report.records[0]?.targetIssues, [436]);
  assert.deepEqual(report.records[0]?.pullRequests, [461]);
  assert.equal(report.records[0]?.branch, branchName);
  assert.equal(report.records[0]?.commit, "abcdef1234567890");
  assert.equal(report.records[0]?.agentRole, "schema-review-worker");
  assert.equal(report.records[0]?.model, "gpt-5.1-codex");
  assert.equal(
    report.records[0]?.evidenceRef,
    "https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/436#agent-provenance"
  );

  const matches = findAgentProvenanceRecords(report.records, { pullRequest: 461 });
  assert.deepEqual(matches.map((record) => record.sourceRef), ["github_pr:461"]);
});

test("malformed repo values are rejected while connector URLs are reported as public-safe findings", () => {
  const text = [
    "connector_url canary app://connector_private_12345",
    `<!-- lco-agent-provenance repo="100yenadmin/Lossless-Codex-Orchestrator-LCO/private" issue=436 parent_thread=codex_thread:${parentThreadId} worker_thread=codex_thread:${workerThreadId} branch=${branchName} -->`
  ].join("\n");

  const report = parseAgentProvenanceText(text, {
    sourceKind: "issue_comment",
    sourceRef: "github_issue_comment:436#connector-url"
  });

  assert.equal(report.records.length, 1);
  assert.equal(report.records[0]?.repo, null);
  assert.deepEqual(report.findings.map((finding) => finding.patternClass), ["connector_url"]);
  assert.equal(JSON.stringify(report).includes("app://connector_private_12345"), false);
});
