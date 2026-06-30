import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createScenarioSweep } from "../packages/cli/src/scenario-sweep.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

test("scenario sweep writes dry-run-ready public-safe scenario scorecards", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-scenario-sweep-"));
  const scenarioDir = mkdtempSync(join(tmpdir(), "loo-scenario-source-"));
  writeFileSync(join(scenarioDir, "plan-retrieval.json"), `${JSON.stringify(minimalScenario(), null, 2)}\n`);

  const report = createScenarioSweep({
    evidenceDir,
    scenarioDir,
    now: "2026-06-30T09:00:00.000Z"
  });

  assert.equal(report.ok, true);
  assert.equal(report.scenarioReady, true);
  assert.equal(report.publicSafe, true);
  assert.equal(report.scenarioVersion, "1.0");
  assert.equal(report.generatedAt, "2026-06-30T09:00:00.000Z");
  assert.deepEqual(report.actionsPerformed, {
    liveCodexControlRun: false,
    desktopGuiActionRun: false,
    rawTranscriptRead: false,
    npmPublished: false,
    githubReleaseCreated: false
  });
  assert.equal(report.scenarios.length, 1);
  assert.equal(report.scenarios[0]?.id, "plan-retrieval-release-scorecard-v1");
  assert.equal(report.scenarios[0]?.status, "dry_run_ready");
  assert.deepEqual(report.scenarios[0]?.allowedTools, ["loo_search_sessions", "loo_codex_plans", "loo_expand_query"]);
  assert.deepEqual(report.blockers, []);
  assert.equal(existsSync(join(evidenceDir, "scenario-sweep.json")), true);
  assert.equal(existsSync(join(evidenceDir, "plan-retrieval-release-scorecard-v1.json")), true);

  const saved = readFileSync(join(evidenceDir, "scenario-sweep.json"), "utf8");
  assert.doesNotMatch(saved, /raw prompt text value|BEGIN PRIVATE|SECRET_|<proposed_plan>/);
});

test("loo eval scenarios strict mode succeeds for complete dry-run scenario contracts", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-scenario-cli-"));
  const scenarioDir = mkdtempSync(join(tmpdir(), "loo-scenario-cli-source-"));
  writeFileSync(join(scenarioDir, "plan-retrieval.json"), `${JSON.stringify(minimalScenario(), null, 2)}\n`);

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "eval",
    "scenarios",
    "--scenario-dir",
    scenarioDir,
    "--evidence-dir",
    evidenceDir,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(join(evidenceDir, "scenario-sweep.json"), "utf8")) as {
    scenarioReady?: boolean;
    scenarios?: Array<{ status?: string }>;
  };
  assert.equal(report.scenarioReady, true);
  assert.equal(report.scenarios?.[0]?.status, "dry_run_ready");
});

test("scenario sweep fails closed for malformed scenarios and raw artifacts", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-scenario-unsafe-"));
  const scenarioDir = mkdtempSync(join(tmpdir(), "loo-scenario-invalid-source-"));
  writeFileSync(join(scenarioDir, "broken.json"), `${JSON.stringify({
    ...minimalScenario(),
    allowed_tools: [],
    forbidden_behaviors: ["live_control"]
  }, null, 2)}\n`);
  writeFileSync(join(evidenceDir, "private.sqlite"), "");

  const report = createScenarioSweep({ evidenceDir, scenarioDir });

  assert.equal(report.ok, false);
  assert.equal(report.scenarioReady, false);
  assert.equal(report.publicSafe, false);
  assert.match(report.blockers.join("\n"), /scenario_missing_field:plan-retrieval-release-scorecard-v1:allowedTools/);
  assert.match(report.blockers.join("\n"), /scenario_missing_required_forbidden_behavior:plan-retrieval-release-scorecard-v1:raw_transcript_read/);
  assert.match(report.blockers.join("\n"), /raw_artifact:sqlite_database:private\.sqlite/);
});

test("VISION and README document the scenario runner command", () => {
  assert.match(readFileSync("VISION.md", "utf8"), /loo eval scenarios/);
  assert.match(readFileSync("README.md", "utf8"), /loo eval scenarios/);
  assert.match(readFileSync("README.md", "utf8"), /evals\/scenarios\/v1/);
});

function minimalScenario() {
  return {
    scenario_version: "1.0",
    id: "plan-retrieval-release-scorecard-v1",
    title: "Known proposed-plan retrieval",
    claim_scope: "codex-read-search-expand-dry-run",
    user_task: "Find the session where release scorecard gates were planned.",
    surface: "openclaw-gateway",
    allowed_tools: ["loo_search_sessions", "loo_codex_plans", "loo_expand_query"],
    forbidden_behaviors: ["raw_transcript_read", "live_control", "gui_mutation", "secret_or_private_data_output"],
    expected_public_safe_evidence: ["query id", "top-k source refs", "plan source refs", "omitted markers"],
    private_data_exclusions: ["raw Codex transcripts", "raw prompts or transcript spans", "SQLite DBs", "tokens, credentials, API keys, cookies"],
    metrics: {
      top_k_hit_required: 5,
      max_expansion_tokens: 1000,
      requires_source_refs: true,
      requires_omitted_markers: true
    },
    proof_boundary: "Dry-run scenario contract only; this does not prove live local retrieval quality."
  };
}
