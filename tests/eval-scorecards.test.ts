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
const packageVersion = JSON.parse(read("package.json")) as { version?: string };
const currentBetaNumber = typeof packageVersion.version === "string" ? packageVersion.version.match(/-beta\.(\d+)$/)?.[1] : undefined;
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
    "public-community-readiness-review.json",
    "tool-facade-usability-review.json",
    "local-agent-usability-review.json",
    "local-mac-search-ui-review.json",
    "working-app-runtime-proof-review.json"
  ];

  for (const file of expectedFiles) {
    const path = join(scorecardDir, file);
    assert.equal(existsSync(path), true, `${path} must exist`);
    const scorecard = readScorecard(file);

    for (const field of requiredFields) {
      assert.equal(Object.hasOwn(scorecard, field), true, `${file} must include ${field}`);
    }

    const serializedScorecard = JSON.stringify(scorecard);
    assert.equal(scorecard.scorecard_version, "1.0", `${file} must use scorecard version 1.0`);
    const evidencePath = String(scorecard.evidence_path);
    if (file === "public-community-readiness-review.json") {
      assert.match(evidencePath, /^evidence\/YYYY-MM-DD\//);
    } else {
      assert.match(evidencePath, /^\/Volumes\/LEXAR\/Codex\/lossless-openclaw-orchestrator\/YYYY-MM-DD\//);
    }
    assert.match(String(scorecard.proof_boundary), /local|public-safe|beta|not proven/i);

    const exclusions = assertStringArray(scorecard.private_data_exclusions, "private_data_exclusions", file).join("\n");
    assert.match(exclusions, /raw Codex transcripts/i);
    assert.match(exclusions, /tokens|credentials|API keys/i);
    assert.match(exclusions, /SQLite DBs/i);
    assert.doesNotMatch(serializedScorecard, /unattended desktop takeover|cloud sync|Claude parity/i);
    // Forward-looking guard: beta candidates must not leave stale publish instructions in scorecards.
    for (const match of serializedScorecard.matchAll(/\bPublish beta\.(\d+)\b/gi)) {
      assert.equal(match[1], currentBetaNumber, `${file} must not mention stale ${match[0]} when package version is ${packageVersion.version ?? "unknown"}`);
    }
  }
});

test("tool facade scorecard proves compact path selection without hiding expert tools", () => {
  const scorecard = readScorecard("tool-facade-usability-review.json");
  const serialized = JSON.stringify(scorecard);

  assert.equal(scorecard.surface, "OpenClaw gateway");
  assert.match(serialized, /public_facade/);
  assert.match(serialized, /workflow_detail/);
  assert.match(serialized, /proof_debug/);
  assert.match(serialized, /internal_low_level/);
  assert.match(serialized, /loo_prepared_inbox/);
  assert.match(serialized, /loo_describe_ref/);
  assert.match(serialized, /loo_expand_query/);
  assert.match(serialized, /loo_attention_inbox/);
  assert.match(serialized, /loo_project_digest/);
  assert.match(serialized, /loo_codex_control_dry_run/);
  assert.match(serialized, /loo_codex_resume_thread/);
  assert.match(serialized, /metadata\.tier/);
  assert.match(serialized, /requiresApproval/);
  assert.match(serialized, /mutationClasses/);
  assert.match(serialized, /lco_\*.*forward public alias target/i);
  assert.match(serialized, /currently callable loo_\* runtime prefix/i);
  assert.match(serialized, /backward compatible/i);
  assert.doesNotMatch(serialized, /loo_\* as the canonical tool prefix/i);
  assert.match(serialized, /#434/);
  assert.match(serialized, /does not remove tools/i);
  assert.match(serialized, /broad lco_\* aliases/i);
  assert.doesNotMatch(serialized, /Full Claude Code parity|cloud sync|unattended desktop takeover/i);
});

test("local-agent usability scorecard requires OpenClaw gateway dogfood without raw transcript access", () => {
  const scorecard = readScorecard("local-agent-usability-review.json");
  assert.equal(scorecard.surface, "OpenClaw gateway");
  assert.match(JSON.stringify(scorecard.command_or_tool), /loo_/);
  assert.match(JSON.stringify(scorecard.pass_criteria), /search/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /describe/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /expand/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /dry-run/i);
  assert.match(JSON.stringify(scorecard.command_or_tool), /loo_watcher_events/);
  assert.match(JSON.stringify(scorecard.expected_public_safe_evidence), /persisted watcher observation refs/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /attention queue items/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /execute:false/i);
  assert.match(JSON.stringify(scorecard.private_data_exclusions), /raw Codex transcripts/i);
});

test("safety bypass scorecard covers persisted watcher events and execute-false queues", () => {
  const scorecard = readScorecard("safety-bypass-review.json");
  const serialized = JSON.stringify(scorecard);

  assert.equal(scorecard.surface, "safety control");
  assert.match(JSON.stringify(scorecard.command_or_tool), /loo_watcher_events/);
  assert.match(JSON.stringify(scorecard.command_or_tool), /loo hook closeout-capture/);
  assert.match(JSON.stringify(scorecard.expected_public_safe_evidence), /local attention queue items/i);
  assert.match(JSON.stringify(scorecard.expected_public_safe_evidence), /hook sidecar capture outputs/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /watcher persistence.*derived_cache/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /compaction marker commands.*derived_cache/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /watcher event read tools remain pure reads/i);
  assert.match(JSON.stringify(scorecard.fail_criteria), /execute=true/i);
  assert.match(JSON.stringify(scorecard.fail_criteria), /approval ids/i);
  assert.match(String(scorecard.proof_boundary), /through issue #412/i);
  assert.doesNotMatch(serialized, /unattended desktop takeover|cloud sync|Claude parity/i);
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
  assert.match(vision, /local-mac-search-ui-review\.json/);
  assert.match(vision, /working-app-runtime-proof-review\.json/);
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
