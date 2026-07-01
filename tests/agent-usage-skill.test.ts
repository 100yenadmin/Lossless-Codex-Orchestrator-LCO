import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
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
