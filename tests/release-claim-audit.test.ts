import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("public beta package and README do not overclaim Claude or desktop control", () => {
  const packageJson = JSON.parse(read("package.json")) as { description?: string };
  const readme = read("README.md");
  const plugin = read("packages/openclaw-plugin/src/index.ts");
  const readmePitch = readme.split("Forbidden beta claims:")[0] ?? readme;
  const pluginDescription = plugin.match(/description:\s*"([^"]+)"/)?.[1] ?? plugin;

  for (const [surface, content] of [
    ["package description", packageJson.description ?? ""],
    ["README pitch", readmePitch],
    ["OpenClaw plugin description", pluginDescription]
  ] as const) {
    assert.doesNotMatch(content, /Control your Codex Desktop and Claude Code remotely/i, surface);
    assert.doesNotMatch(content, /unattended desktop takeover/i, `${surface} must not claim unattended takeover`);
  }

  assert.match(packageJson.description ?? "", /local Codex sessions/i);
  assert.match(packageJson.description ?? "", /approval-gated/i);
  assert.match(readme, /Claude Code support is intentionally shipped as an adapter stub/i);
  assert.match(plugin, /approval-gated controls/i);
});

test("public beta docs include install, MCP/OpenClaw, demo, and approval-boundary proof", () => {
  assert.equal(existsSync("docs/BETA_RELEASE_DEMO.md"), true, "docs/BETA_RELEASE_DEMO.md must exist");
  assert.equal(existsSync("docs/CLAIM_AUDIT.md"), true, "docs/CLAIM_AUDIT.md must exist");

  const readme = read("README.md");
  const openclawDocs = read("docs/OPENCLAW_PLUGIN.md");
  const demo = read("docs/BETA_RELEASE_DEMO.md");
  const claimAudit = read("docs/CLAIM_AUDIT.md");

  assert.match(readme, /docs\/OPENCLAW_PLUGIN\.md/);
  assert.match(readme, /docs\/BETA_RELEASE_DEMO\.md/);
  assert.match(openclawDocs, /loo-mcp-server/);
  assert.match(openclawDocs, /dry_run=true/);
  assert.match(openclawDocs, /approval_audit_id/);

  for (const required of [
    /100\+ local Codex sessions/i,
    /loo index codex/i,
    /loo search/i,
    /loo_codex_plans/i,
    /loo_codex_final_messages/i,
    /expand.*two sessions/i,
    /loo_codex_control_dry_run/i,
    /approval_audit_id/i,
    /does not run live control/i
  ]) {
    assert.match(demo, required);
  }

  for (const required of [
    /Allowed public beta claim/i,
    /Forbidden beta claims/i,
    /Claude Code.*adapter stub/i,
    /No cloud sync/i,
    /No unattended desktop takeover/i,
    /No permission bypass/i
  ]) {
    assert.match(claimAudit, required);
  }
});

test("OpenClaw plugin manifest is packageable and matches the beta safety boundary", () => {
  assert.equal(existsSync("packages/openclaw-plugin/openclaw.plugin.json"), true, "OpenClaw plugin manifest must exist");

  const manifest = JSON.parse(read("packages/openclaw-plugin/openclaw.plugin.json")) as {
    id?: string;
    name?: string;
    description?: string;
    mcp?: { command?: string; transport?: string };
    tools?: { prefix?: string };
    safety?: { localOnlyByDefault?: boolean; liveControlRequires?: string[]; forbiddenClaims?: string[] };
  };

  assert.equal(manifest.id, "lossless-openclaw-orchestrator");
  assert.equal(manifest.name, "Lossless OpenClaw Orchestrator");
  assert.match(manifest.description ?? "", /local Codex sessions/i);
  assert.match(manifest.description ?? "", /approval-gated controls/i);
  assert.doesNotMatch(manifest.description ?? "", /Claude Code remotely/i);
  assert.equal(manifest.mcp?.command, "loo-mcp-server");
  assert.equal(manifest.mcp?.transport, "stdio");
  assert.equal(manifest.tools?.prefix, "loo_");
  assert.equal(manifest.safety?.localOnlyByDefault, true);
  assert.deepEqual(manifest.safety?.liveControlRequires, ["dry_run", "approval_audit_id"]);
  assert.deepEqual(manifest.safety?.forbiddenClaims, [
    "Full Claude Code parity",
    "cloud sync",
    "unattended desktop takeover",
    "bypasses Codex permissions"
  ]);
});
