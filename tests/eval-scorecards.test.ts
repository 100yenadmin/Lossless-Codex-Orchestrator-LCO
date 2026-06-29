import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

type Scorecard = {
  scorecard_version?: unknown;
  claim_class?: unknown;
  scenario?: unknown;
  surface?: unknown;
  command_or_tool?: unknown;
  expected_public_safe_evidence?: unknown;
  private_data_exclusions?: unknown;
  pass_criteria?: unknown;
  fail_criteria?: unknown;
  current_score?: unknown;
  evidence_path?: unknown;
  known_gaps?: unknown;
  next_action?: unknown;
  proof_boundary?: unknown;
};

const scorecardDir = join("evals", "scorecards", "v1.0");
const requiredFields: Array<keyof Scorecard> = [
  "scorecard_version",
  "claim_class",
  "scenario",
  "surface",
  "command_or_tool",
  "expected_public_safe_evidence",
  "private_data_exclusions",
  "pass_criteria",
  "fail_criteria",
  "current_score",
  "evidence_path",
  "known_gaps",
  "next_action",
  "proof_boundary"
];

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function readScorecard(name: string): Scorecard {
  return JSON.parse(read(join(scorecardDir, name))) as Scorecard;
}

function assertStringArray(value: unknown, field: string, file: string): string[] {
  assert.equal(Array.isArray(value), true, `${file} ${field} must be an array`);
  const array = value as unknown[];
  assert.equal(array.length > 0, true, `${file} ${field} must not be empty`);
  for (const item of array) assert.equal(typeof item, "string", `${file} ${field} entries must be strings`);
  return array as string[];
}

test("scorecard v1 examples exist, are versioned, and preserve the beta evidence boundary", () => {
  const expectedFiles = [
    "safety-bypass-review.json",
    "retrieval-quality-review.json",
    "orchestrator-leverage-prioritization.json",
    "packaging-install-review.json",
    "public-claim-review.json",
    "local-agent-usability-review.json"
  ];

  for (const file of expectedFiles) {
    const path = join(scorecardDir, file);
    assert.equal(existsSync(path), true, `${path} must exist`);
    const scorecard = readScorecard(file);

    for (const field of requiredFields) {
      assert.equal(Object.hasOwn(scorecard, field), true, `${file} must include ${field}`);
    }

    assert.equal(scorecard.scorecard_version, "1.0", `${file} must use scorecard version 1.0`);
    assert.match(String(scorecard.evidence_path), /^\/Volumes\/LEXAR\/Codex\/lossless-openclaw-orchestrator\/YYYY-MM-DD\//);
    assert.match(String(scorecard.proof_boundary), /local|public-safe|beta|not proven/i);

    const exclusions = assertStringArray(scorecard.private_data_exclusions, "private_data_exclusions", file).join("\n");
    assert.match(exclusions, /raw Codex transcripts/i);
    assert.match(exclusions, /tokens|credentials|API keys/i);
    assert.match(exclusions, /SQLite DBs/i);
    assert.doesNotMatch(JSON.stringify(scorecard), /unattended desktop takeover|cloud sync|Claude parity/i);
  }
});

test("local-agent usability scorecard requires OpenClaw gateway dogfood without raw transcript access", () => {
  const scorecard = readScorecard("local-agent-usability-review.json");
  assert.equal(scorecard.surface, "OpenClaw gateway");
  assert.match(JSON.stringify(scorecard.command_or_tool), /loo_/);
  assert.match(JSON.stringify(scorecard.pass_criteria), /search/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /describe/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /expand/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /dry-run/i);
  assert.match(JSON.stringify(scorecard.private_data_exclusions), /raw Codex transcripts/i);
});

test("orchestrator leverage scorecard prioritizes highest-signal session management for bounded context", () => {
  const scorecard = readScorecard("orchestrator-leverage-prioritization.json") as Scorecard & {
    scoring_weights?: unknown;
    highest_priority_examples?: unknown;
  };
  assert.equal(scorecard.surface, "product roadmap");
  assert.match(String(scorecard.scenario), /hundreds of (Codex|agent) sessions/i);
  assert.match(String(scorecard.scenario), /least context/i);

  const weights = scorecard.scoring_weights as Record<string, unknown>;
  assert.equal(typeof weights, "object", "orchestrator leverage scorecard must include scoring_weights");
  assert.equal(weights.context_compression_signal_per_token, 30);
  assert.equal(weights.session_management_leverage, 20);
  assert.equal(weights.retrieval_quality, 15);
  assert.equal(weights.safe_actionability, 15);
  assert.equal(weights.automation_hook_leverage, 10);
  assert.equal(weights.user_facing_utility, 5);
  assert.equal(weights.implementation_reuse, 5);

  const examples = assertStringArray(scorecard.highest_priority_examples, "highest_priority_examples", "orchestrator-leverage-prioritization.json").join("\n");
  assert.match(examples, /thread metadata/i);
  assert.match(examples, /closeout/i);
  assert.match(examples, /project/i);
  assert.match(examples, /status/i);
  assert.match(examples, /archive/i);
  assert.match(examples, /fork/i);
  assert.match(examples, /hybrid search/i);
  assert.match(examples, /sanitizer/i);
});

test("release status scorecard commands include required evidence directory placeholders", () => {
  for (const file of ["packaging-install-review.json", "public-claim-review.json"]) {
    const commands = assertStringArray(readScorecard(file).command_or_tool, "command_or_tool", file);
    const releaseStatusCommands = commands.filter((command) => /\bloo release status\b/.test(command));
    assert.equal(releaseStatusCommands.length > 0, true, `${file} must include release status coverage`);
    for (const command of releaseStatusCommands) {
      assert.match(command, /--evidence-dir\s+\S+/, `${file} release status command must include --evidence-dir`);
    }
  }
});

test("VISION.md routes milestone sweeps and issue updates to scorecard v1 examples", () => {
  const vision = read("VISION.md");
  const readme = read("README.md");
  const packageJson = JSON.parse(read("package.json")) as { files?: string[] };

  assert.match(vision, /evals\/scorecards\/v1\.0/);
  assert.match(vision, /per-issue scorecard update template/i);
  assert.match(vision, /safety-bypass-review\.json/);
  assert.match(vision, /orchestrator-leverage-prioritization\.json/);
  assert.match(vision, /local-agent-usability-review\.json/);
  assert.match(readme, /evals\/scorecards\/v1\.0/);
  assert.equal(packageJson.files?.includes("evals"), true, "npm package must include versioned scorecard examples");

  const template = read(join(scorecardDir, "issue-scorecard-update-template.md"));
  for (const required of [
    /Failing test, smoke, or eval/i,
    /Focused validation/i,
    /OpenClaw gateway dogfood/i,
    /Scorecard update/i,
    /Evidence path/i,
    /Proof boundary/i,
    /Next action/i
  ]) {
    assert.match(template, required);
  }
});
