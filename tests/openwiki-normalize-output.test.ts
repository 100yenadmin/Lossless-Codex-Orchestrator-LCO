import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const scriptPath = resolve("scripts/normalize-openwiki-output.mjs");

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function withTempRepo(fn: (repo: string) => void) {
  const repo = mkdtempSync(join(process.cwd(), ".tmp-openwiki-normalize-"));
  try {
    run("git", ["init"], repo);
    run("git", ["config", "user.email", "codex@example.invalid"], repo);
    run("git", ["config", "user.name", "Codex"], repo);
    fn(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test("OpenWiki output normalizer moves penwiki output and clears the typo path", () => {
  withTempRepo((repo) => {
    mkdirSync(join(repo, "openwiki"), { recursive: true });
    writeFileSync(join(repo, "openwiki", "existing.md"), "existing\n");
    run("git", ["add", "openwiki/existing.md"], repo);
    run("git", ["commit", "-m", "seed openwiki"], repo);

    mkdirSync(join(repo, "penwiki", "_metadata"), { recursive: true });
    writeFileSync(join(repo, "penwiki", "operations.md"), "generated operations\n");
    writeFileSync(join(repo, "penwiki", "_metadata", "workflow-run.json"), "{}\n");

    const result = run(process.execPath, [scriptPath], repo);
    assert.match(result.stdout, /"normalizedTypoOutput": true/);
    assert.equal(existsSync(join(repo, "penwiki")), false);
    assert.equal(readFileSync(join(repo, "openwiki", "operations.md"), "utf8"), "generated operations\n");
    assert.equal(readFileSync(join(repo, "openwiki", "_metadata", "workflow-run.json"), "utf8"), "{}\n");

    const status = run("git", ["status", "--porcelain", "--untracked-files=all"], repo).stdout;
    assert.doesNotMatch(status, /^.. penwiki\//m);
    assert.match(status, /\?\? openwiki\/_metadata\/workflow-run\.json/);
    assert.match(status, /\?\? openwiki\/operations\.md/);
  });
});

test("OpenWiki output normalizer is a no-op when penwiki was not generated", () => {
  withTempRepo((repo) => {
    mkdirSync(join(repo, "openwiki"), { recursive: true });
    writeFileSync(join(repo, "openwiki", "existing.md"), "existing\n");

    const result = run(process.execPath, [scriptPath], repo);
    assert.match(result.stdout, /"normalizedTypoOutput": false/);
    assert.equal(existsSync(join(repo, "penwiki")), false);
    assert.equal(readFileSync(join(repo, "openwiki", "existing.md"), "utf8"), "existing\n");
  });
});
