import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("GA README is a public landing page with first-run setup path", () => {
  const readme = read("README.md");

  assert.match(readme, /^# Lossless Codex Orchestrator/m);
  assert.doesNotMatch(readme, /^# Orchestrator CCC\+L/m);

  for (const required of [
    /docs\/SETUP\.md/,
    /## What It Does/,
    /## Install/,
    /## Set Up/,
    /## First Workflow/,
    /## OpenClaw And MCP/,
    /## Privacy And Local Data/,
    /npm install -g lossless-openclaw-orchestrator@latest/,
    /loo doctor/,
    /loo index codex/,
    /loo search/,
    /loo describe/,
    /loo expand/,
    /loo-mcp-server/,
    /skills\/lossless-openclaw-orchestrator\/SKILL\.md/,
    /docs\/OPENCLAW_PLUGIN\.md/,
    /docs\/PRIVACY\.md/
  ]) {
    assert.match(readme, required);
  }

  assert.doesNotMatch(readme, /## Current Sprint:/);
  assert.doesNotMatch(readme, /What a local OpenClaw agent can do today[\s\S]{1000,}/);
  assert.doesNotMatch(readme, /Scorecard and release proof commands:/);
  assert.doesNotMatch(readme, /Claim Audit|loo release preflight|loo release general-readiness|issue-<number>-scorecard-sweep/);
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
    /isolated npm prefix/i,
    /fresh LOO_DB_PATH/i,
    /local repo build/i,
    /loo doctor/,
    /not_indexed_yet/,
    /codexJsonlDrift/,
    /loo index codex/,
    /~\/.codex\/sessions/,
    /~\/.codex\/archived_sessions/,
    /loo search/,
    /loo describe/,
    /loo expand/,
    /loo-mcp-server/,
    /OpenClaw/,
    /loo openclaw published-smoke/,
    /npm selector.*tarball fallback/i,
    /loo openclaw tool-smoke/,
    /CUA Driver is the preferred\/default\s+desktop fallback backend/i,
    /not bundled by LCO/i,
    /desktop-fallback readiness blocker/i,
    /cua-driver mcp --help/,
    /do not treat a CUA `type_text` success\s+payload or ready desktop proof packet as proof/i,
    /Troubleshooting/,
    /Uninstall/,
    /does not read raw transcripts by default/i,
    /dry-run/i,
    /approval_audit_id/
  ]) {
    assert.match(setup, required);
  }
});

test("public docs document index byte cap and fresh-user tarball recovery commands", () => {
  const readme = read("README.md");
  const setup = read("docs/SETUP.md");

  for (const [surface, content] of [
    ["README", readme],
    ["setup guide", setup]
  ] as const) {
    assert.match(content, /50\s*MB per-file index cap/i, `${surface} must name the default per-file cap`);
    assert.match(content, /--max-bytes-per-file/i, `${surface} must document the override flag`);
    assert.match(content, /npm view lossless-openclaw-orchestrator@[a-z]+ dist\.tarball/i, `${surface} must show a raw npm tarball lookup`);
    assert.match(content, /npm install -g "\$tarball_url"/i, `${surface} must show a raw npm tarball install`);
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
  const claimAudit = read("docs/CLAIM_AUDIT.md");
  const publicDocs = `${readme}\n${setup}\n${claimAudit}`;

  for (const required of [
    /local Codex/i,
    /local SQLite/i,
    /Claude Code.*adapter stub/i,
    /no cloud sync/i,
    /no unattended desktop takeover/i,
    /no permission bypass/i,
    /no enterprise/i,
    /generic GUI mutation/i
  ]) {
    assert.match(publicDocs, required);
  }

  assert.match(readme, /Published `@latest`\s+currently uses the historical `loo` CLI/i);
  assert.match(readme, /source 1\.4 line exposes[\s\S]{0,120}`lco-mcp-server`, and canonical `lco_\*` tools/i);
  assert.match(readme, /Give your main agent a memory and command layer for all your Codex projects and threads\./i);
  assert.match(readme, /field-weighted FTS5 search/i);
  assert.match(readme, /prepared cards/i);
  assert.match(readme, /summary leaves/i);
  assert.match(readme, /attention inbox/i);
  assert.match(readme, /project digest/i);
  assert.match(readme, /dry-run command packets/i);
  assert.match(readme, /npm selector[\s\S]*tarball\s+fallback/i);
  assert.match(setup, /CUA Driver is the preferred\/default\s+desktop fallback backend/i);
  assert.match(setup, /do not treat a CUA `type_text` success\s+payload or ready desktop proof packet as proof/i);
  assert.match(claimAudit, /No cloud sync/i);
  assert.doesNotMatch(readme, /no cloud sync|no unattended desktop takeover|no permission bypass|CUA Driver/i);

  assert.doesNotMatch(publicDocs, /Full Claude Code parity is supported/i);
  assert.doesNotMatch(publicDocs, /cloud sync is supported/i);
  assert.doesNotMatch(publicDocs, /unattended desktop takeover is supported/i);
  assert.doesNotMatch(publicDocs, /bypasses Codex permissions/i);
  assert.doesNotMatch(publicDocs, /generic GUI mutation is supported/i);
  assert.doesNotMatch(readme, /verify `cua-driver mcp` availability through `loo doctor/i);
});

test("release-captain docs include repeatable full gateway coverage smoke", () => {
  const qaLab = read("docs/QA_LAB.md");
  const runbook = read("docs/BETA_RELEASE_RUNBOOK.md");
  const releaseDocs = `${qaLab}\n${runbook}`;

  assert.match(releaseDocs, /release-captain/i);
  assert.match(releaseDocs, /openclaw tool-smoke[^\n]+--coverage full/i);
  assert.match(releaseDocs, /full\s+65-tool|65-tool\s+gateway/i);
  assert.match(releaseDocs, /lco_watchers/);
  assert.match(releaseDocs, /lco_codex_extract/);
  assert.match(releaseDocs, /lco_prepared_state/);
  assert.match(releaseDocs, /lco_operating_picture/);
  assert.match(releaseDocs, /lco_desktop_proof/);
});

test("current docs do not present closed issue references as pending work", () => {
  const currentDocs = [
    "README.md",
    "VISION.md",
    "docs/SETUP.md",
    "docs/OPENCLAW_PLUGIN.md",
    "docs/BETA_RELEASE_RUNBOOK.md",
    "docs/RELEASE_CHECKLIST.md",
    "docs/QA_LAB.md",
    "docs/CLAIM_AUDIT.md",
    "skills/lossless-openclaw-orchestrator/SKILL.md"
  ].map(read).join("\n");

  for (const forbidden of [
    /until\s+#434/i,
    /Naming policy for #434/i,
    /For #434 continuity/i,
    /#157[\s\S]{0,120}fails closed until/i,
    /#158[\s\S]{0,120}must prove/i,
    /#159[\s\S]{0,120}must prove/i,
    /pre-#570/i,
    /pre-#583/i,
    /pre-#585/i,
    /known issue/i,
    /does not work/i
  ]) {
    assert.doesNotMatch(currentDocs, forbidden);
  }
});
