import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("VISION.md captures product, eval, dogfood, cadence, and capability-boundary contract", () => {
  assert.equal(existsSync("VISION.md"), true, "VISION.md must exist at the repo root");
  const vision = read("VISION.md");
  const readme = read("README.md");
  const packageJson = JSON.parse(read("package.json")) as { files?: string[] };

  for (const heading of [
    "## North Star",
    "## Current Release Roadmap: 1.5 Coverage And Cockpit",
    "## Completed Proof: Working App Runtime",
    "## Primary User Stories",
    "## Orchestrator Product-Management Mode",
    "## Scorecards",
    "## Eval Scenarios",
    "## Local OpenClaw Gateway Dogfood",
    "## Milestone Review Cadence",
    "## Capability Boundaries",
    "## Evidence Rules"
  ]) {
    assert.match(vision, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const required of [
    /100\+ local Codex sessions/i,
    /hundreds of local agent sessions/i,
    /least context/i,
    /thread metadata/i,
    /project/i,
    /status/i,
    /archive/i,
    /fork/i,
    /hybrid search/i,
    /session sanitizer/i,
    /Codex Autonomy Cockpit/i,
    /Eva Operating Picture/i,
    /PLAN_STATE\.md/i,
    /lco_recent_sessions/i,
    /lco_cockpit_inbox/i,
    /lco_plan_state_pins/i,
    /lco_github_operating_items/i,
    /lco_business_pulse/i,
    /lco_codex_desktop_coherence/i,
    /cli_visible/i,
    /desktop_visible/i,
    /desktop_refresh_required/i,
    /desktop_restart_required/i,
    /P1 source adapters/i,
    /not_configured/i,
    /M9 added/i,
    /agent handoff/i,
    /first-class OpenClaw agent usage skill/i,
    /M11 proved/i,
    /Milestone 13/i,
    /1\.5 Coverage/i,
    /Milestone 14/i,
    /1\.6 Control Plane/i,
    /Milestone 15/i,
    /1\.7 Matrix Stretch/i,
    /public release notes/i,
    /M12 built[\s\S]+QA Lab/i,
    /lco qa-lab tool-coverage/i,
    /1\.2 prepared-state tracker as completed proof/i,
    /What a local OpenClaw agent can do today/i,
    /Completed proof/i,
    /Milestone 7/i,
    /Working App Proof Sprint/i,
    /evals\/scenarios\/v1\.1/i,
    /working-app-runtime-proof-review\.json/i,
    /brief-lco-1\.2-prepared-state-summary-leaves-2026-07-03\.md/i,
    /prepared state/i,
    /summary leaves/i,
    /source ranges/i,
    /advisory cache/i,
    /compaction observed/i,
    /bounded file, byte, and event limits/i,
    /lco_codex_control_dry_run/i,
    /local OpenClaw gateway/i,
    /issue comments or evidence summaries/i,
    /raw Codex JSONL files/i,
    /tokens, cookies, API keys, credentials/i,
    /Claude Code adapter parity/i,
    /Hosted or synced coordination/i,
    /Unattended desktop automation/i,
    /Enterprise security hardening/i
  ]) {
    assert.match(vision, required);
  }

  assert.match(readme, /VISION\.md/);
  assert.match(readme, /docs\/SETUP\.md/);
  assert.match(readme, /## What It Does/);
  assert.match(readme, /## Install/);
  assert.match(readme, /## Set Up/);
  assert.match(readme, /## First Workflow/);
  assert.match(readme, /## OpenClaw And MCP/);
  assert.match(readme, /## Privacy And Local Data/);
  assert.match(readme, /skills\/lossless-openclaw-orchestrator\/SKILL\.md/);
  assert.match(readme, /docs\/OPENCLAW_PLUGIN\.md/);
  assert.match(readme, /Give your main agent a memory and command layer for all your Codex projects and threads\./i);
  assert.match(readme, /field-weighted FTS5 search/i);
  assert.match(readme, /prepared cards/i);
  assert.match(readme, /summary leaves/i);
  assert.match(readme, /project digest/i);
  assert.doesNotMatch(readme, /not claimed|no cloud sync|no unattended desktop takeover|CUA Driver/i);
  assert.match(readme, /## Roadmap/i);
  assert.match(readme, /1\.2 prepared-state and summary-leaves lane/i);
  assert.match(readme, /brief-lco-1\.2-prepared-state-summary-leaves-2026-07-03\.md/i);
  assert.doesNotMatch(readme, /## Current Sprint:/);
  assert.doesNotMatch(readme, /What a local OpenClaw agent can do today[\s\S]{1000,}/i);
  assert.doesNotMatch(readme, /## Current Sprint: Working App Proof/);
  assert.doesNotMatch(readme, /## Current Sprint: M9 Agent Handoff Beta Sprint/);
  assert.doesNotMatch(readme, /## Current Sprint: 1\.0 Stable Release Gate/);
  assert.doesNotMatch(readme, /## Current Sprint: Post-GA Desktop Visibility Proof/);
  assert.doesNotMatch(readme, /and first child\s+\[#256\]/i);
  assert.doesNotMatch(readme, /#307 separates[\s\S]+#308 owns/i);
  assert.doesNotMatch(readme, /Codex Desktop coherence\s*\|\s*Proof-gated/i);
  assert.doesNotMatch(vision, /Active hardening continues with[\s\S]*#271[\s\S]*#272/i);
  assert.doesNotMatch(vision, /Desktop-visible collaboration remains proof-gated behind #307\/#308/i);
  assert.doesNotMatch(vision, /active tracker is desktop fallback/i);
  assert.doesNotMatch(readme, /Working app runtime proof\s*\|\s*Next sprint/i);
  assert.equal(packageJson.files?.includes("VISION.md"), true, "npm package must include VISION.md because README links to it");
});

test("VISION.md distinguishes release-quality gates from runtime feature gates", () => {
  const vision = read("VISION.md");

  assert.match(vision, /workflows the QA Lab actually proves/i);
  assert.match(vision, /public release notes[\s\S]+user-facing changes/i);
  assert.match(vision, /release doctrine[\s\S]+RELEASE_CHECKLIST/i);
  assert.match(vision, /live control[\s\S]+desktop collaboration[\s\S]+adapter parity/i);
  assert.match(vision, /approved live Codex control smoke/i);
  assert.match(vision, /Installed OpenClaw gateway path[\s\S]+approved live Codex action/i);
  assert.match(vision, /Post-action refresh[\s\S]+safe agent reasoning/i);
  assert.match(vision, /Runtime release profiles[\s\S]+fail-closed gates/i);
  assert.match(vision, /dry-run packets alone/i);
  assert.match(vision, /npm publish[\s\S]+GitHub Release[\s\S]+separate release actions/i);
});
