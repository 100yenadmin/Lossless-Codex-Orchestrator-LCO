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

test("public first-run docs are lco-first while preserving loo compatibility", () => {
  const readme = read("README.md");
  const setup = read("docs/SETUP.md");
  const firstWorkflow = section(readme, "First Workflow");
  const mcpSetup = section(setup, "7. Connect MCP");

  for (const required of [
    /npm install -g lossless-codex-orchestrator@latest/,
    /\blco doctor\b/,
    /\blco index codex\b/,
    /\blco search\b/,
    /\blco describe\b/,
    /\blco expand-ref\b/,
    /\blco expand-query\b/,
    /lco-mcp-server/,
    /LCO_DB_PATH/,
    /LCO_LCM_DB_PATHS/,
    /LCO_TOOL_PROFILE/
  ]) {
    assert.match(`${readme}\n${setup}`, required);
  }

  assert.doesNotMatch(firstWorkflow, /\bloo (?:search|describe|expand-ref|expand-query)\b/);
  assert.doesNotMatch(mcpSetup, /"command":\s*"loo-mcp-server"/);
  assert.match(`${readme}\n${setup}`, /lossless-openclaw-orchestrator[\s\S]{0,180}maintained/i);
  assert.match(`${readme}\n${setup}`, /`loo`[\s\S]{0,180}compat/i);
  assert.match(`${readme}\n${setup}`, /`LOO_\*`[\s\S]{0,180}compat/i);
  assert.match(`${readme}\n${setup}`, /at least two minor releases/i);
});

test("setup guide includes per-client MCP mounting examples and multi-client storage guidance", () => {
  const setup = read("docs/SETUP.md");
  const mcpSetup = section(setup, "7. Connect MCP");

  for (const required of [
    /Claude Code/i,
    /\.mcp\.json/,
    /Cursor/i,
    /Generic MCP client/i,
    /"command":\s*"lco-mcp-server"/,
    /"LCO_DB_PATH":\s*"~\/\.openclaw\/lossless-openclaw-orchestrator\/orchestrator\.sqlite"/,
    /"LCO_TOOL_PROFILE":\s*"facade"/,
    /multiple clients can mount the same local store/i,
    /shared `LCO_DB_PATH`/i,
    /separate stores per client/i,
    /isolation is test-proven/i
  ]) {
    assert.match(mcpSetup, required);
  }
});

test("adapter-tier docs and Hermes boundary are linked without widening Hermes claims", () => {
  assert.equal(existsSync("docs/HERMES_ADAPTER_BOUNDARY.md"), true, "Hermes boundary doc must exist");

  const readme = read("README.md");
  const vision = read("VISION.md");
  const hermes = read("docs/HERMES_ADAPTER_BOUNDARY.md");

  assert.match(readme, /docs\/HERMES_ADAPTER_BOUNDARY\.md/);
  assert.match(vision, /docs\/HERMES_ADAPTER_BOUNDARY\.md/);
  assert.match(vision, /## Adapter Tiers/);
  assert.match(vision, /Tier 1[\s\S]{0,160}OpenClaw/i);
  assert.match(vision, /Tier 2[\s\S]{0,180}Hermes/i);
  assert.match(vision, /Tier 3[\s\S]{0,180}Generic MCP/i);
  assert.match(vision, /`lco_\*`[\s\S]{0,120}`LCO_\*`[\s\S]{0,120}`lco`/);
  assert.match(vision, /`loo_\*`[\s\S]{0,160}compat/i);

  assert.match(hermes, /# Hermes Adapter Boundary/);
  assert.match(hermes, /priority-2 adapter tier/i);
  assert.match(hermes, /lco-mcp-server/);
  assert.match(hermes, /LCO_DB_PATH/);
  assert.match(hermes, /first-class supported path/i);
  assert.match(hermes, /No native Hermes adapter/i);
  assert.match(hermes, /not "LCO has a Hermes adapter\."/);
});

test("shipped product names and Codex plugin metadata match the 1.4 LCO identity lane", () => {
  const pkg = JSON.parse(read("package.json")) as { version?: string };
  const plugin = JSON.parse(read(".codex-plugin/plugin.json")) as {
    version?: string;
    interface?: { longDescription?: string };
  };
  const setup = read("docs/SETUP.md");

  assert.match(read("VISION.md"), /^# Lossless Codex Orchestrator Vision/m);
  assert.match(read("skills/lossless-openclaw-orchestrator/SKILL.md"), /^# Lossless Codex Orchestrator/m);
  assert.match(read("docs/BETA_RELEASE_RUNBOOK.md"), /public beta of Lossless\s+Codex Orchestrator/i);
  assert.equal(plugin.version, pkg.version);
  assert.match(plugin.interface?.longDescription ?? "", /Stop hook thread-title finalizer/i);
  assert.match(setup, /Stop hook thread-title finalizer/i);
  assert.match(setup, /\.codex-plugin\/plugin\.json/);
  assert.match(setup, /hooks\/hooks\.json/);
  assert.match(setup, /CLAUDE_PLUGIN_ROOT/);
  assert.match(setup, /not a general tool surface/i);
});
