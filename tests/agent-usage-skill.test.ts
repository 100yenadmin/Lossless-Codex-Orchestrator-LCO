import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function section(markdown: string, heading: string): string {
  const marker = `## ${heading}\n`;
  const start = markdown.indexOf(marker);
  assert.notEqual(start, -1, `missing section: ${heading}`);
  const rest = markdown.slice(start + marker.length);
  const next = rest.search(/^## /m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

test("OpenClaw agent usage skill is packaged and linked from operator docs", () => {
  const skillPath = "skills/lossless-openclaw-orchestrator/SKILL.md";
  assert.equal(existsSync(skillPath), true, "agent-facing LCO skill must exist");

  const packageJson = JSON.parse(read("package.json")) as { files?: string[] };
  assert.equal(packageJson.files?.includes("skills"), true, "npm package must include agent skills");

  const readme = read("README.md");
  const pluginDocs = read("docs/OPENCLAW_PLUGIN.md");
  assert.match(readme, new RegExp(skillPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(pluginDocs, new RegExp(skillPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("OpenClaw agent usage skill teaches bounded recall and approval-gated control", () => {
  const skill = read("skills/lossless-openclaw-orchestrator/SKILL.md");

  for (const required of [
    /Find active Codex sessions/i,
    /Describe this session/i,
    /Expand 1k\/4k/i,
    /Find plans, finals, and touched files/i,
    /Dry-run steer, send, or resume/i,
    /loo_doctor/,
    /loo_search_sessions/,
    /loo_describe_session/,
    /loo_expand_session/,
    /loo_expand_query/,
    /loo_codex_plans/,
    /loo_codex_final_messages/,
    /loo_codex_touched_files/,
    /loo_codex_control_dry_run/,
    /approval_audit_id/,
    /do not read raw transcripts/i,
    /public-safe summaries/i,
    /local-only/i
  ]) {
    assert.match(skill, required);
  }

  for (const forbidden of [
    /Full Claude Code parity/i,
    /cloud sync/i,
    /unattended desktop takeover/i,
    /generic GUI mutation is supported/i,
    /bypasses Codex permissions/i
  ]) {
    assert.doesNotMatch(skill, forbidden);
  }
});

test("OpenClaw agent usage skill teaches the Desktop-first daily loop without widening claims", () => {
  const skill = read("skills/lossless-openclaw-orchestrator/SKILL.md");
  const dailyLoop = section(skill, "Codex Desktop-First Daily Loop");

  for (const required of [
    /loo_codex_app_server_status/,
    /loo_codex_app_server_threads/,
    /loo_visible_codex_map/,
    /loo_codex_desktop_coherence/,
    /cli_visible/,
    /desktop_refresh_required/,
    /desktop_restart_required/,
    /unknown/,
    /proof gaps/i,
    /loo_codex_desktop_fallback_status/,
    /coherence_input_missing/,
    /loo_codex_collaboration_cockpit/,
    /loo_codex_runtime_desktop_visibility_status/,
    /loo_codex_active_thread_state/,
    /loo_codex_autonomy_tick/,
    /needs_nudge/,
    /needs_approval/,
    /nextControlDryRun/,
    /execute=false/,
    /all autonomy tick steps as recommendations/i,
    /requesting user/i,
    /separately asks for and approves the exact action/i,
    /exact dry-run audit id/i,
    /explicit requesting-user approval/i,
    /post-action refresh/i,
    /issue-ready public-safe packet/i
  ]) {
    assert.match(dailyLoop, required);
  }

  for (const forbidden of [
    /Andrew approval/i,
    /use raw transcripts as the default/i,
    /run unapproved live control/i,
    /generic GUI mutation is supported/i,
    /\b(?:should|must|can|may)\s+capture screenshots by default/i,
    /unattended Desktop collaboration is supported/i,
    /make direct GitHub writes without approval/i
  ]) {
    assert.doesNotMatch(skill, forbidden);
  }
});
