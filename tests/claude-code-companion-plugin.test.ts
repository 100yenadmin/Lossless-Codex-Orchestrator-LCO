import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

function frontmatterField(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^${escapeRegex(field)}:\\s*(.+)$`, "m"));
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

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function mkdirExecutableBin(path: string): void {
  mkdirSync(path);
}

function readLog(path: string): Array<{ bin: string; argv: string[] }> {
  return read(path)
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { bin: string; argv: string[] });
}

function runFindWrapper(binDir: string, logPath: string, args: string[], exits: { lco?: number; npx?: number } = {}) {
  return spawnSync(process.execPath, ["plugins/lco-recall/scripts/lco-find.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      LCO_TEST_LOG: logPath,
      LCO_TEST_LCO_EXIT: String(exits.lco ?? 0),
      LCO_TEST_NPX_EXIT: String(exits.npx ?? 0),
      PATH: binDir
    }
  });
}

function createLoggingStub(path: string, bin: "lco" | "npx"): void {
  const exitVar = bin === "lco" ? "LCO_TEST_LCO_EXIT" : "LCO_TEST_NPX_EXIT";
  writeExecutable(
    path,
    `#!${process.execPath}
import { appendFileSync } from "node:fs";
appendFileSync(process.env.LCO_TEST_LOG, JSON.stringify({ bin: ${JSON.stringify(bin)}, argv: process.argv.slice(2) }) + "\\n");
process.exit(Number(process.env.${exitVar} ?? "0"));
`
  );
}

test("frontmatterField treats field names as literals", () => {
  const content = "name: find\nna.e: literal\n";

  assert.equal(frontmatterField(content, "name"), "find");
  assert.equal(frontmatterField(content, "na.e"), "literal");
  assert.equal(frontmatterField(content, "na+e"), undefined);
});

test("lco-find wrapper prefers lco and forwards argv and exit code", () => {
  const dir = mkdtempSync(join(tmpdir(), "lco-find-wrapper-"));
  const binDir = join(dir, "bin");
  const logPath = join(dir, "calls.jsonl");

  try {
    writeFileSync(logPath, "");
    mkdirExecutableBin(binDir);
    createLoggingStub(join(binDir, "lco"), "lco");
    createLoggingStub(join(binDir, "npx"), "npx");

    const result = runFindWrapper(binDir, logPath, ["needle", "with space"], { lco: 7, npx: 0 });

    assert.equal(result.status, 7);
    assert.deepEqual(readLog(logPath), [
      { bin: "lco", argv: ["find", "--json", "needle", "with space"] }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lco-find wrapper falls back to npx when lco is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "lco-find-wrapper-"));
  const binDir = join(dir, "bin");
  const logPath = join(dir, "calls.jsonl");

  try {
    mkdirExecutableBin(binDir);
    writeFileSync(logPath, "");
    createLoggingStub(join(binDir, "npx"), "npx");

    const result = runFindWrapper(binDir, logPath, ["memory", "hook"], { npx: 13 });

    assert.equal(result.status, 13);
    assert.deepEqual(readLog(logPath), [
      {
        bin: "npx",
        argv: ["--yes", "lossless-codex-orchestrator@latest", "find", "--json", "memory", "hook"]
      }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
