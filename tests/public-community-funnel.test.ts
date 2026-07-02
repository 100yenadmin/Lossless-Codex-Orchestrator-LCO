import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("public README routes users and contributors into the GA community funnel", () => {
  const readme = read("README.md");

  for (const required of [
    /Contributing\.md/i,
    /AGENTS\.md/i,
    /CODE_OF_CONDUCT\.md/i,
    /SECURITY\.md/i,
    /docs\/SETUP\.md/i,
    /good first issue/i,
    /agent-authored/i,
    /file a bug/i,
    /request an adapter/i
  ]) {
    assert.match(readme, required);
  }

  assert.doesNotMatch(readme, /125k stars|download the app|production-ready enterprise/i);
});

test("CONTRIBUTING.md is useful to both humans and coding agents", () => {
  const contributing = read("CONTRIBUTING.md");

  for (const required of [
    /^# Contributing/m,
    /Quick Links/i,
    /Issue Routing/i,
    /Before You Open A PR/i,
    /Agent-Authored Contributions/i,
    /Validation/i,
    /Evidence/i,
    /Review Threads/i,
    /Good First Contributions/i,
    /Safety Boundaries/i,
    /docs\/SETUP\.md/i,
    /AGENTS\.md/i,
    /SECURITY\.md/i,
    /CODE_OF_CONDUCT\.md/i,
    /Closes #<issue>/i,
    /raw Codex transcripts/i,
    /approval_audit_id/i
  ]) {
    assert.match(contributing, required);
  }
});

test("AGENTS.md gives repository agents a concise first-read checklist", () => {
  const agents = read("AGENTS.md");

  for (const required of [
    /Repository Agent Quick Start/i,
    /Read README\.md/i,
    /Read CONTRIBUTING\.md/i,
    /Read docs\/SETUP\.md/i,
    /Create or reuse a GitHub issue/i,
    /Write or update a failing test/i,
    /Do not commit raw transcripts/i,
    /Update the issue before handoff/i
  ]) {
    assert.match(agents, required);
  }
});

test("community health files and templates exist for public GitHub readiness", () => {
  for (const path of [
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/docs_bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/ISSUE_TEMPLATE/adapter_request.yml",
    ".github/ISSUE_TEMPLATE/protocol_drift.yml",
    ".github/ISSUE_TEMPLATE/unsafe_control_report.yml"
  ]) {
    assert.equal(existsSync(path), true, `${path} must exist`);
  }

  const bug = read(".github/ISSUE_TEMPLATE/bug_report.yml");
  const feature = read(".github/ISSUE_TEMPLATE/feature_request.yml");
  const unsafe = read(".github/ISSUE_TEMPLATE/unsafe_control_report.yml");
  const pr = read(".github/PULL_REQUEST_TEMPLATE.md");

  for (const form of [bug, feature, unsafe]) {
    assert.match(form, /body:/);
    assert.match(form, /validations:\n\s+required: true/);
    assert.match(form, /Redaction|public-safe|tokens|credentials/i);
  }

  for (const required of [
    /What Problem This Solves/i,
    /User Impact/i,
    /Validation/i,
    /Safety Boundary/i,
    /Evidence/i,
    /Closes #<issue>/i,
    /agent-authored/i
  ]) {
    assert.match(pr, required);
  }
});

test("package and scorecards include public community readiness assets", () => {
  const packageJson = JSON.parse(read("package.json")) as { files?: string[] };
  assert.equal(packageJson.files?.includes("CONTRIBUTING.md"), true);
  assert.equal(packageJson.files?.includes("AGENTS.md"), true);
  assert.equal(packageJson.files?.includes("CODE_OF_CONDUCT.md"), true);

  const scorecardPath = "evals/scorecards/v1.0/public-community-readiness-review.json";
  assert.equal(existsSync(scorecardPath), true, `${scorecardPath} must exist`);
  const scorecard = JSON.parse(read(scorecardPath)) as {
    current_score?: string;
    surface?: string;
    pass_criteria?: string[];
    proof_boundary?: string;
  };
  assert.equal(scorecard.current_score, "pass");
  assert.equal(scorecard.surface, "public GitHub repository");
  assert.match(JSON.stringify(scorecard.pass_criteria), /README/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /CONTRIBUTING/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /AGENTS/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /issue templates/i);
  assert.match(String(scorecard.proof_boundary), /does not prove star growth/i);
});
