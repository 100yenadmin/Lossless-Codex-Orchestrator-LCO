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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWordsInOrder(content: string, words: string[]): boolean {
  const normalized = content.toLowerCase();
  const pattern = words
    .map((word) => `\\b${escapeRegex(word.toLowerCase())}\\b`)
    .join("[\\s\\S]*");
  return new RegExp(pattern).test(normalized);
}

function containsCommandTokens(content: string, tokens: string[]): boolean {
  return content
    .split(/\r?\n/)
    .some((line) => {
      const parts = line.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let cursor = 0;
      for (const token of tokens.map((item) => item.toLowerCase())) {
        const next = parts.indexOf(token, cursor);
        if (next < 0) return false;
        cursor = next + 1;
      }
      return true;
    });
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
  assert.equal(containsWordsInOrder(plugin.description ?? "", ["Codex", "orchestrator", "recall"]), true);

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
      containsWordsInOrder(content, ["codex-plugin-cc"]),
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

  assert.equal(containsWordsInOrder(claimAudit, ["Codex", "Claude", "recall"]), true);
  assert.equal(containsWordsInOrder(claimAudit, ["cross", "harness", "recall"]), true);
  assert.equal(containsWordsInOrder(claimAudit, ["audit", "control"]), true);
});
