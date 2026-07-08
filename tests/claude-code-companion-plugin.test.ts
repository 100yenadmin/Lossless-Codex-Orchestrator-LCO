import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

test("Claude Code companion plugin is namespaced and packageable", () => {
  const packageJson = readJson<{ files?: string[] }>("package.json");
  const marketplace = readJson<{
    name?: string;
    plugins?: Array<{ name?: string; source?: string; description?: string }>;
  }>(".claude-plugin/marketplace.json");
  const plugin = readJson<{ name?: string; description?: string; version?: string }>(
    "plugins/lco-recall/.claude-plugin/plugin.json"
  );
  const skill = read("plugins/lco-recall/skills/find/SKILL.md");
  const wrapper = read("plugins/lco-recall/scripts/lco-find.mjs");
  const readme = read("README.md");
  const setup = read("docs/SETUP.md");
  const claimAudit = read("docs/CLAIM_AUDIT.md");

  assert.equal(packageJson.files?.includes(".claude-plugin"), true);
  assert.equal(packageJson.files?.includes("plugins"), true);

  assert.equal(marketplace.name, "lco");
  assert.deepEqual(
    marketplace.plugins?.map((entry) => entry.name),
    ["lco-recall"]
  );
  assert.equal(marketplace.plugins?.[0]?.source, "./plugins/lco-recall");

  assert.equal(plugin.name, "lco-recall");
  assert.match(plugin.description ?? "", /Lossless Codex Orchestrator/i);
  assert.match(plugin.description ?? "", /local recall/i);

  assert.match(skill, /^name:\s*find/m);
  assert.match(skill, /lco find --json/i);
  assert.match(skill, /npx --yes lossless-codex-orchestrator@latest/i);
  assert.doesNotMatch(skill, /\/codex:/i);
  assert.doesNotMatch(skill, /\bStop\b/i);
  assert.equal(existsSync("plugins/lco-recall/hooks"), false);
  assert.match(wrapper, /spawnSync\("lco"/);
  assert.match(wrapper, /npx/);
  assert.match(wrapper, /lossless-codex-orchestrator@latest/);

  for (const [surface, content] of [
    ["README", readme],
    ["SETUP", setup]
  ] as const) {
    assert.match(content, /codex-plugin-cc/i, `${surface} must position alongside codex-plugin-cc`);
    assert.match(content, /\/plugin marketplace add 100yenadmin\/Lossless-Codex-Orchestrator-LCO/i);
    assert.match(content, /\/plugin install lco-recall@lco/i);
    assert.doesNotMatch(content, /\/codex:lco|\/codex:find/i);
    assert.doesNotMatch(content, /Full Claude Code parity/i);
  }

  assert.match(claimAudit, /native Codex or Claude recall/i);
  assert.match(claimAudit, /cross-harness recall/i);
  assert.match(claimAudit, /audited control/i);
});
