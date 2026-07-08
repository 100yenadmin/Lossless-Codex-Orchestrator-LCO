import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

function frontmatterField(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

function containsWords(content: string, words: string[]): boolean {
  const normalized = content.toLowerCase();
  return words.every((word) => normalized.includes(word.toLowerCase()));
}

function containsCommandTokens(content: string, tokens: string[]): boolean {
  return content
    .split(/\r?\n/)
    .some((line) => tokens.every((token) => line.toLowerCase().includes(token.toLowerCase())));
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
  assert.equal(containsWords(plugin.description ?? "", ["Codex", "orchestrator", "recall"]), true);

  assert.equal(frontmatterField(skill, "name"), "find");
  assert.equal(containsCommandTokens(skill, ["lco", "find", "--json"]), true);
  assert.equal(containsCommandTokens(skill, ["npx", "lossless-codex-orchestrator@latest"]), true);
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
    assert.equal(
      containsWords(content, ["codex-plugin-cc"]),
      true,
      `${surface} must position alongside codex-plugin-cc`
    );
    assert.equal(
      containsCommandTokens(content, ["/plugin", "marketplace", "add", "100yenadmin/Lossless-Codex-Orchestrator-LCO"]),
      true
    );
    assert.equal(containsCommandTokens(content, ["/plugin", "install", "lco-recall@lco"]), true);
    assert.doesNotMatch(content, /\/codex:lco|\/codex:find/i);
    assert.doesNotMatch(content, /Full Claude Code parity/i);
  }

  assert.equal(containsWords(claimAudit, ["Codex", "Claude", "recall"]), true);
  assert.equal(containsWords(claimAudit, ["cross", "harness", "recall"]), true);
  assert.equal(containsWords(claimAudit, ["audit", "control"]), true);
});
