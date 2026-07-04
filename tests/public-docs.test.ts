import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("GA README is a public landing page with first-run setup path", () => {
  const readme = read("README.md");

  assert.match(readme, /^# Lossless OpenClaw Orchestrator/m);
  assert.doesNotMatch(readme, /^# Orchestrator CCC\+L/m);

  for (const required of [
    /docs\/SETUP\.md/,
    /## What It Does/,
    /## Install/,
    /## Set Up/,
    /## First Workflow/,
    /## OpenClaw And MCP/,
    /## Safety Boundaries/,
    /npm install -g lossless-openclaw-orchestrator@latest/,
    /loo doctor/,
    /loo index codex/,
    /loo search/,
    /loo describe/,
    /loo expand/,
    /loo-mcp-server/,
    /skills\/lossless-openclaw-orchestrator\/SKILL\.md/,
    /docs\/OPENCLAW_PLUGIN\.md/,
    /docs\/PRIVACY\.md/,
    /docs\/CLAIM_AUDIT\.md/
  ]) {
    assert.match(readme, required);
  }

  assert.doesNotMatch(readme, /## Current Sprint:/);
  assert.doesNotMatch(readme, /What a local OpenClaw agent can do today[\s\S]{1000,}/);
  assert.doesNotMatch(readme, /Scorecard and release proof commands:/);
  assert.doesNotMatch(readme, /#307 separates[\s\S]+#308 reports/i);
});

test("setup guide covers install, local indexing, OpenClaw, MCP, and troubleshooting", () => {
  assert.equal(existsSync("docs/SETUP.md"), true, "docs/SETUP.md must exist");
  const setup = read("docs/SETUP.md");

  for (const required of [
    /^# Setup Guide/m,
    /Node\.js 22/,
    /npm install -g lossless-openclaw-orchestrator@latest/,
    /LOO_DB_PATH/,
    /LOO_LCM_DB_PATHS/,
    /loo doctor/,
    /loo index codex/,
    /~\/.codex\/sessions/,
    /~\/.codex\/archived_sessions/,
    /loo search/,
    /loo describe/,
    /loo expand/,
    /loo-mcp-server/,
    /OpenClaw/,
    /loo openclaw published-smoke/,
    /loo openclaw tool-smoke/,
    /Troubleshooting/,
    /Uninstall/,
    /does not read raw transcripts by default/i,
    /dry-run/i,
    /approval_audit_id/
  ]) {
    assert.match(setup, required);
  }
});

test("setup guide tells Codex and Claude users how to install agent provenance rules safely", () => {
  const setup = read("docs/SETUP.md");

  for (const required of [
    /AGENTS\.md/,
    /CLAUDE\.md/,
    /Codex-oriented/i,
    /Claude-oriented/i,
    /#436/,
    /correlation handles, not authorization/i,
    /raw transcripts, secrets,[\s\S]*private logs/i,
    /private paths/i,
    /screenshots/i,
    /customer data/i,
    /connector URLs/i,
    /visible block/i,
    /hidden marker/i
  ]) {
    assert.match(setup, required);
  }
});

test("public docs preserve release claim boundaries", () => {
  const readme = read("README.md");
  const setup = read("docs/SETUP.md");
  const publicDocs = `${readme}\n${setup}`;

  for (const required of [
    /Codex-first/i,
    /local-first/i,
    /Claude Code.*adapter stub/i,
    /no cloud sync/i,
    /no unattended desktop takeover/i,
    /no permission bypass/i,
    /no enterprise/i,
    /generic GUI mutation.*not/i
  ]) {
    assert.match(publicDocs, required);
  }

  assert.doesNotMatch(publicDocs, /Full Claude Code parity is supported/i);
  assert.doesNotMatch(publicDocs, /cloud sync is supported/i);
  assert.doesNotMatch(publicDocs, /unattended desktop takeover is supported/i);
  assert.doesNotMatch(publicDocs, /bypasses Codex permissions/i);
  assert.doesNotMatch(publicDocs, /generic GUI mutation is supported/i);
});
