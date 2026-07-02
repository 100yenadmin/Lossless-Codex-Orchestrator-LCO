import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

test("scenario sweep rejects unsafe ids before writing evidence paths", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-scenario-unsafe-id-"));
  const evidenceDir = join(root, "evidence");
  const scenarioDir = join(root, "scenarios");
  mkdirSync(scenarioDir, { recursive: true });
  writeFileSync(join(scenarioDir, "unsafe.json"), `${JSON.stringify({
    ...minimalScenario(),
    id: "../outside"
  }, null, 2)}\n`);

  const report = createScenarioSweep({ evidenceDir, scenarioDir });

  assert.equal(report.ok, false);
  assert.equal(report.scenarios[0]?.id, "unsafe");
  assert.equal(report.scenarios[0]?.evidencePath, join(evidenceDir, "unsafe.json"));
  assert.match(report.blockers.join("\n"), /scenario_invalid_id:unsafe/);
  assert.equal(existsSync(join(root, "outside.json")), false);
});

test("VISION and README document the scenario runner command", () => {
  assert.match(readFileSync("VISION.md", "utf8"), /loo eval scenarios/);
  assert.match(readFileSync("README.md", "utf8"), /loo eval scenarios/);
  assert.match(readFileSync("README.md", "utf8"), /evals\/scenarios\/v1/);
});

test("M9 agent dogfood scenario captures the gateway-only handoff workflow", () => {
  const scenario = JSON.parse(readFileSync(join("evals", "scenarios", "v1", "m9-agent-dogfood-core-workflow.json"), "utf8")) as {
    id?: string;
    surface?: string;
    user_task?: string;
    allowed_tools?: string[];
    expected_public_safe_evidence?: string[];
    forbidden_behaviors?: string[];
    metrics?: Record<string, unknown>;
    proof_boundary?: string;
  };

  assert.equal(scenario.id, "m9-agent-dogfood-core-workflow-v1");
  assert.equal(scenario.surface, "openclaw-gateway");
  assert.match(String(scenario.user_task), /doctor.*search.*describe.*expand.*recommend.*dry-run/i);
  assert.deepEqual(scenario.allowed_tools, [
    "loo_doctor",
    "loo_search_sessions",
    "loo_codex_thread_map",
    "loo_describe_session",
    "loo_expand_session",
    "loo_expand_query",
    "loo_codex_plans",
    "loo_codex_final_messages",
    "loo_codex_touched_files",
    "loo_codex_control_dry_run"
  ]);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /agent recommendation/i);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /source refs/i);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /approval_audit_id/i);
  assert.match(JSON.stringify(scenario.forbidden_behaviors), /raw_transcript_read/);
  assert.match(JSON.stringify(scenario.forbidden_behaviors), /live_control/);
  assert.equal(scenario.metrics?.requires_agent_reasoning_note, true);
  assert.equal(scenario.metrics?.max_raw_transcript_spans, 0);
  assert.match(String(scenario.proof_boundary), /does not prove live Codex control/i);
});

test("M9 fresh npm clean-profile scenario captures external beta install path", () => {
  const scenario = JSON.parse(readFileSync(join("evals", "scenarios", "v1", "m9-fresh-npm-clean-profile.json"), "utf8")) as {
    id?: string;
    surface?: string;
    user_task?: string;
    allowed_tools?: string[];
    expected_public_safe_evidence?: string[];
    forbidden_behaviors?: string[];
    metrics?: Record<string, unknown>;
    proof_boundary?: string;
  };

  assert.equal(scenario.id, "m9-fresh-npm-clean-profile-v1");
  assert.equal(scenario.surface, "npm-openclaw-install");
  assert.match(String(scenario.user_task), /npm.*beta.*clean.*OpenClaw profile/i);
  assert.deepEqual(scenario.allowed_tools, [
    "npm view lossless-openclaw-orchestrator@beta version dist-tags --json",
    "npm install lossless-openclaw-orchestrator@beta --prefix <isolated-prefix>",
    "loo openclaw dogfood",
    "loo openclaw tool-smoke",
    "loo openclaw published-smoke",
    "loo onboard status"
  ]);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /binary paths/i);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /clean profile/i);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /setupStatus/i);
  assert.match(JSON.stringify(scenario.forbidden_behaviors), /raw_transcript_read/);
  assert.match(JSON.stringify(scenario.forbidden_behaviors), /live_control/);
  assert.equal(scenario.metrics?.requires_registry_beta_version_match, true);
  assert.equal(scenario.metrics?.requires_loo_binary, true);
  assert.equal(scenario.metrics?.max_raw_transcript_spans, 0);
  assert.match(String(scenario.proof_boundary), /does not prove stable release/i);
});

test("Eva operating picture dogfood scenario captures the full cockpit workflow", () => {
  const scenario = JSON.parse(readFileSync(join("evals", "scenarios", "v1", "eva-operating-picture-dogfood.json"), "utf8")) as {
    id?: string;
    surface?: string;
    user_task?: string;
    allowed_tools?: string[];
    expected_public_safe_evidence?: string[];
    forbidden_behaviors?: string[];
    metrics?: Record<string, unknown>;
    proof_boundary?: string;
  };

  assert.equal(scenario.id, "eva-operating-picture-dogfood-v1");
  assert.equal(scenario.surface, "openclaw-gateway");
  assert.match(String(scenario.user_task), /normalize GitHub.*recent Codex.*attention.*business pulse/i);
  assert.deepEqual(scenario.allowed_tools, [
    "loo_github_operating_items",
    "loo_recent_sessions",
    "loo_project_digest",
    "loo_attention_inbox",
    "loo_business_pulse"
  ]);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /checks_pending/i);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /ci_failed/i);
  assert.doesNotMatch(JSON.stringify(scenario.expected_public_safe_evidence), /checks_failed/i);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /clean card/i);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /customer_impact/i);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /sourceCoverage/i);
  assert.match(JSON.stringify(scenario.forbidden_behaviors), /raw_transcript_read/);
  assert.match(JSON.stringify(scenario.forbidden_behaviors), /external_write/);
  assert.equal(scenario.metrics?.requires_current_lane_source_balance, true);
  assert.equal(scenario.metrics?.requires_clean_card_presentation, true);
  assert.equal(scenario.metrics?.requires_customer_runtime_red_priority, true);
  assert.equal(scenario.metrics?.max_raw_transcript_spans, 0);
  assert.match(String(scenario.proof_boundary), /does not prove.*full business truth/i);
});

test("Codex collaboration cockpit scenario captures read-only Desktop evidence composition", () => {
  const scenario = JSON.parse(readFileSync(join("evals", "scenarios", "v1", "codex-collaboration-cockpit.json"), "utf8")) as {
    id?: string;
    surface?: string;
    user_task?: string;
    allowed_tools?: string[];
    expected_public_safe_evidence?: string[];
    forbidden_behaviors?: string[];
    metrics?: Record<string, unknown>;
    proof_boundary?: string;
  };

  assert.equal(scenario.id, "codex-collaboration-cockpit-v1");
  assert.equal(scenario.surface, "openclaw-gateway");
  assert.match(String(scenario.user_task), /active Codex collaboration lanes.*Desktop coherence\/fallback/i);
  assert.deepEqual(scenario.allowed_tools, [
    "loo_recent_sessions",
    "loo_cockpit_inbox",
    "loo_codex_collaboration_cockpit",
    "loo_codex_collaboration_next_steps",
    "loo_codex_desktop_coherence",
    "loo_codex_desktop_fallback_status"
  ]);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /lco\.codex\.collaborationCockpit\.v1/);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /lco\.codex\.collaborationNextSteps\.v1/);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /actionsPerformed/);
  assert.match(JSON.stringify(scenario.forbidden_behaviors), /raw_transcript_read/);
  assert.match(JSON.stringify(scenario.forbidden_behaviors), /gui_mutation/);
  assert.match(JSON.stringify(scenario.forbidden_behaviors), /npm_publish/);
  assert.equal(scenario.metrics?.requires_collaboration_cockpit_report, true);
  assert.equal(scenario.metrics?.requires_collaboration_next_steps_report, true);
  assert.equal(scenario.metrics?.requires_desktop_state_boundary, true);
  assert.equal(scenario.metrics?.max_live_actions, 0);
  assert.match(String(scenario.proof_boundary), /does not prove live Codex control/i);
});

test("runtime-required v1.1 scenarios define working-app proof beyond dry-run contracts", () => {
  const scenarioDir = join("evals", "scenarios", "v1.1");
  const files = readdirSync(scenarioDir).filter((file) => file.endsWith(".json")).sort();
  assert.deepEqual(files, [
    "codex-desktop-coherence.json",
    "codex-desktop-fallback-status.json",
    "connected-local-ui-proof.json",
    "desktop-collaboration-action-bound.json",
    "openclaw-gateway-live-codex.json",
    "post-action-refresh-reasoning.json",
    "runtime-desktop-visibility-status.json"
  ]);

  for (const file of files) {
    const scenario = JSON.parse(readFileSync(join(scenarioDir, file), "utf8")) as {
      scenario_version?: unknown;
      proof_mode?: unknown;
      claim_scope?: unknown;
      expected_public_safe_evidence?: unknown;
      forbidden_behaviors?: unknown;
      proof_boundary?: unknown;
      issue?: unknown;
    };
    assert.equal(scenario.scenario_version, "1.1", `${file} must use runtime scenario version 1.1`);
    assert.equal(scenario.proof_mode, "runtime_required", `${file} must require runtime proof`);
    assert.equal(scenario.claim_scope, "codex-working-app-proof", `${file} must target the working-app claim scope`);
    assert.match(String(scenario.issue), /^(#1(5[8-9]|6[0-1])|#30[78]|#333|#342)$/);
    assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /source ref|plugin id|tool surface|desktop backend/i);
    assert.match(JSON.stringify(scenario.forbidden_behaviors), /raw|unauthorized|secret/i);
    assert.match(String(scenario.proof_boundary), /Proves one|Proves only|does not prove/i);
  }
});

test("scenario sweep fails closed for v1.1 runtime scenarios until proof markers exist", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-runtime-scenario-missing-proof-"));

  const report = createScenarioSweep({
    evidenceDir,
    scenarioDir: join("evals", "scenarios", "v1.1"),
    now: "2026-06-30T16:40:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.equal(report.scenarioReady, false);
  assert.equal(report.publicSafe, true);
  assert.equal(report.scenarioVersion, "1.1");
  assert.equal(report.scenarios.length, 7);
  assert.equal(report.scenarios.every((scenario) => scenario.status === "runtime_proof_required"), true);
  assert.match(report.blockers.join("\n"), /runtime_proof_missing:codex-desktop-coherence-v1-1:codex_desktop_coherence_report/);
  assert.match(report.blockers.join("\n"), /runtime_proof_missing:codex-desktop-coherence-v1-1:desktop_visibility_classification/);
  assert.match(report.blockers.join("\n"), /runtime_proof_missing:codex-desktop-fallback-status-v1-1:codex_desktop_fallback_status_report/);
  assert.match(report.blockers.join("\n"), /runtime_proof_missing:codex-desktop-fallback-status-v1-1:peekaboo_secondary_warning/);
  assert.match(report.blockers.join("\n"), /runtime_proof_missing:desktop-collaboration-action-bound-v1-1:approval_packet_bound/);
  assert.match(report.blockers.join("\n"), /runtime_proof_missing:runtime-desktop-visibility-status-v1-1:runtime_desktop_visibility_status_report/);
  assert.match(report.blockers.join("\n"), /runtime_proof_missing:runtime-desktop-visibility-status-v1-1:execute_false_next_tool_calls/);
  assert.match(report.blockers.join("\n"), /runtime_proof_missing:openclaw-gateway-live-codex-v1-1:installed_gateway_path/);
  assert.match(report.blockers.join("\n"), /runtime_proof_missing:openclaw-gateway-live-codex-v1-1:matching_approval_audit_id/);
  assert.match(report.blockers.join("\n"), /runtime_proof_missing:post-action-refresh-reasoning-v1-1:post_action_refresh/);
  assert.doesNotMatch(report.blockers.join("\n"), /scenario_invalid_version/);
  assert.doesNotMatch(report.blockers.join("\n"), /scenario_missing_required_forbidden_behavior:.*:live_control/);

  const saved = JSON.parse(readFileSync(join(evidenceDir, "scenario-sweep.json"), "utf8")) as typeof report;
  assert.equal(saved.scenarioVersion, "1.1");
  assert.equal(saved.scenarios[0]?.status, "runtime_proof_required");
});

test("loo eval scenarios accepts v1.1 runtime proof markers through the CLI", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-runtime-scenario-cli-evidence-"));
  const runtimeProofDir = mkdtempSync(join(tmpdir(), "loo-runtime-scenario-cli-proof-"));
  writeRuntimeProof(runtimeProofDir, "openclaw-gateway-live-codex-v1-1", {
    installed_gateway_path: true,
    matching_approval_audit_id: true,
    public_safe_scan: true
  }, { live_action_count: 1, raw_prompt_chars: 0 });
  writeRuntimeProof(runtimeProofDir, "post-action-refresh-reasoning-v1-1", {
    agent_reasoning_note: true,
    post_action_refresh: true,
    source_refs: true
  }, { raw_transcript_spans: 0 });
  writeRuntimeProof(runtimeProofDir, "desktop-collaboration-action-bound-v1-1", {
    action_bound_target: true,
    approval_packet_bound: true,
    backend_specific_observation: true,
    no_focus_measurement: true
  }, { screenshot_count: 0 });
  writeRuntimeProof(runtimeProofDir, "connected-local-ui-proof-v1-1", {
    local_mac_shell_ready: true,
    live_tool_source: true,
    public_safe_scan: true,
    source_refs: true
  }, { raw_transcript_spans: 0 });
  writeRuntimeProof(runtimeProofDir, "codex-desktop-coherence-v1-1", {
    cli_visible_signal: true,
    codex_desktop_coherence_report: true,
    desktop_visibility_classification: true,
    public_safe_scan: true
  }, {
    live_action_count: 0,
    raw_prompt_chars: 0,
    raw_transcript_spans: 0,
    screenshot_count: 0
  });
  writeRuntimeProof(runtimeProofDir, "codex-desktop-fallback-status-v1-1", {
    codex_desktop_fallback_status_report: true,
    cua_first_backend: true,
    missing_coherence_guidance: true,
    no_gui_action: true,
    peekaboo_secondary_warning: true,
    public_safe_scan: true
  }, {
    live_action_count: 0,
    raw_prompt_chars: 0,
    raw_transcript_spans: 0,
    screenshot_count: 0
  });
  writeRuntimeProof(runtimeProofDir, "runtime-desktop-visibility-status-v1-1", {
    execute_false_next_tool_calls: true,
    lane_coverage_counts: true,
    public_safe_scan: true,
    runtime_desktop_visibility_status_report: true
  }, {
    live_action_count: 0,
    raw_prompt_chars: 0,
    raw_transcript_spans: 0,
    screenshot_count: 0
  });

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "eval",
    "scenarios",
    "--scenario-dir",
    join("evals", "scenarios", "v1.1"),
    "--runtime-proof-dir",
    runtimeProofDir,
    "--evidence-dir",
    evidenceDir,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(join(evidenceDir, "scenario-sweep.json"), "utf8")) as {
    scenarioReady?: boolean;
    scenarioVersion?: string;
    scenarios?: Array<{ status?: string; runtimeProof?: { publicSafe?: boolean } }>;
    blockers?: string[];
    nextAction?: string;
  };
  assert.equal(report.scenarioReady, true);
  assert.equal(report.scenarioVersion, "1.1");
  assert.deepEqual(report.blockers, []);
  assert.match(String(report.nextAction), /runtime-proof-ready scenario markers/i);
  assert.equal(report.scenarios?.every((scenario) => scenario.status === "runtime_proof_ready"), true);
  assert.equal(report.scenarios?.every((scenario) => scenario.runtimeProof?.publicSafe === true), true);
});

test("loo eval scenarios can scope runtime-required sweeps to claimed scenario ids", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-runtime-scenario-scoped-evidence-"));
  const runtimeProofDir = mkdtempSync(join(tmpdir(), "loo-runtime-scenario-scoped-proof-"));
  writeRuntimeProof(runtimeProofDir, "openclaw-gateway-live-codex-v1-1", {
    installed_gateway_path: true,
    matching_approval_audit_id: true,
    public_safe_scan: true
  }, { live_action_count: 1, raw_prompt_chars: 0 });
  writeRuntimeProof(runtimeProofDir, "post-action-refresh-reasoning-v1-1", {
    agent_reasoning_note: true,
    post_action_refresh: true,
    source_refs: true
  }, { raw_transcript_spans: 0 });

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "eval",
    "scenarios",
    "--scenario-dir",
    join("evals", "scenarios", "v1.1"),
    "--runtime-proof-dir",
    runtimeProofDir,
    "--scenario-id",
    "openclaw-gateway-live-codex-v1-1",
    "--scenario-id",
    "post-action-refresh-reasoning-v1-1",
    "--evidence-dir",
    evidenceDir,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(join(evidenceDir, "scenario-sweep.json"), "utf8")) as {
    scenarioReady?: boolean;
    scenarios?: Array<{ id?: string; status?: string }>;
    blockers?: string[];
  };
  assert.equal(report.scenarioReady, true);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.scenarios?.map((scenario) => scenario.id), [
    "openclaw-gateway-live-codex-v1-1",
    "post-action-refresh-reasoning-v1-1"
  ]);
  assert.equal(report.scenarios?.every((scenario) => scenario.status === "runtime_proof_ready"), true);
});

test("scenario sweep rejects secret-like values inside runtime proof markers", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-runtime-scenario-secret-evidence-"));
  const runtimeProofDir = mkdtempSync(join(tmpdir(), "loo-runtime-scenario-secret-proof-"));
  writeRuntimeProof(runtimeProofDir, "openclaw-gateway-live-codex-v1-1", {
    installed_gateway_path: true,
    matching_approval_audit_id: true,
    public_safe_scan: true
  }, { live_action_count: 1, raw_prompt_chars: 0 }, {
    accidental_token: `npm_${"A".repeat(24)}`
  });

  const report = createScenarioSweep({
    evidenceDir,
    scenarioDir: join("evals", "scenarios", "v1.1"),
    runtimeProofDir
  });

  assert.equal(report.ok, false);
  assert.equal(report.publicSafe, false);
  assert.match(report.blockers.join("\n"), /runtime_proof_secret_like:openclaw-gateway-live-codex-v1-1/);
  assert.equal(
    report.scenarios.find((scenario) => scenario.id === "openclaw-gateway-live-codex-v1-1")?.runtimeProof?.publicSafe,
    false
  );
});

test("scenario sweep scans malformed runtime proof JSON for secret-like values", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-runtime-scenario-malformed-secret-evidence-"));
  const runtimeProofDir = mkdtempSync(join(tmpdir(), "loo-runtime-scenario-malformed-secret-proof-"));
  writeFileSync(
    join(runtimeProofDir, "openclaw-gateway-live-codex-v1-1.runtime-proof.json"),
    `{ "kind": "loo_runtime_scenario_proof", "accidental_token": "npm_${"B".repeat(24)}" `
  );

  const report = createScenarioSweep({
    evidenceDir,
    scenarioDir: join("evals", "scenarios", "v1.1"),
    runtimeProofDir
  });

  assert.match(report.blockers.join("\n"), /runtime_proof_invalid_json:openclaw-gateway-live-codex-v1-1/);
  assert.match(report.blockers.join("\n"), /runtime_proof_secret_like:openclaw-gateway-live-codex-v1-1/);
  assert.equal(
    report.scenarios.find((scenario) => scenario.id === "openclaw-gateway-live-codex-v1-1")?.runtimeProof?.publicSafe,
    false
  );
});

test("scenario sweep rejects negative and fractional runtime proof count markers", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-runtime-scenario-invalid-count-evidence-"));
  const runtimeProofDir = mkdtempSync(join(tmpdir(), "loo-runtime-scenario-invalid-count-proof-"));
  writeRuntimeProof(runtimeProofDir, "openclaw-gateway-live-codex-v1-1", {
    installed_gateway_path: true,
    matching_approval_audit_id: true,
    public_safe_scan: true
  }, { live_action_count: -1, raw_prompt_chars: 0.5 });

  const report = createScenarioSweep({
    evidenceDir,
    scenarioDir: join("evals", "scenarios", "v1.1"),
    runtimeProofDir
  });

  assert.match(report.blockers.join("\n"), /runtime_proof_invalid:openclaw-gateway-live-codex-v1-1:live_action_count/);
  assert.match(report.blockers.join("\n"), /runtime_proof_invalid:openclaw-gateway-live-codex-v1-1:raw_prompt_chars/);
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

function writeRuntimeProof(
  runtimeProofDir: string,
  scenarioId: string,
  proofMarkers: Record<string, boolean>,
  limits: Record<string, number>,
  extra: Record<string, unknown> = {}
) {
  writeFileSync(join(runtimeProofDir, `${scenarioId}.runtime-proof.json`), `${JSON.stringify({
    kind: "loo_runtime_scenario_proof",
    scenario_id: scenarioId,
    scenario_version: "1.1",
    proof_mode: "runtime_required",
    claim_scope: "codex-working-app-proof",
    public_safe: true,
    proof_markers: proofMarkers,
    raw_transcript_read: false,
    raw_prompt_included: false,
    raw_secret_included: false,
    screenshot_included: false,
    sqlite_included: false,
    ...limits,
    ...extra
  }, null, 2)}\n`);
}
