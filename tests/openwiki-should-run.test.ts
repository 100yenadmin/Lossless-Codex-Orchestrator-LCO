import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const scriptPath = resolve("scripts/should-run-openwiki-update.mjs");

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function write(path: string, content: string) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function makeRepo() {
  const cwd = mkdtempSync(join(process.cwd(), ".tmp-openwiki-should-run-"));
  git(cwd, ["init"]);
  git(cwd, ["config", "user.email", "codex@example.invalid"]);
  git(cwd, ["config", "user.name", "Codex Test"]);
  write(join(cwd, "package.json"), `${JSON.stringify({ version: "1.5.0" }, null, 2)}\n`);
  write(join(cwd, "openwiki", "quickstart.md"), "# Quickstart\n");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "initial source"]);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  write(join(cwd, "openwiki", ".last-update.json"), `${JSON.stringify({ gitHead: base }, null, 2)}\n`);
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "docs update"]);
  return { cwd, base };
}

function runDecision(cwd: string, options: { command?: string; githubOutput?: string } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...(options.githubOutput ? ["--github-output"] : [])], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      COMMAND: options.command ?? "update",
      ...(options.githubOutput ? { GITHUB_OUTPUT: options.githubOutput } : {})
    }
  });
  return result;
}

function parseDecision(stdout: string) {
  return JSON.parse(stdout) as {
    shouldRun: boolean;
    reason: string;
    changedPaths: string[];
    sourceChangedPaths: string[];
  };
}

test("OpenWiki preflight skips docs-only deltas since last update", () => {
  const { cwd } = makeRepo();
  try {
    const result = runDecision(cwd);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = parseDecision(result.stdout);
    assert.equal(parsed.shouldRun, false);
    assert.equal(parsed.reason, "docs_or_workflow_only_delta");
    assert.deepEqual(parsed.sourceChangedPaths, []);
    assert.deepEqual(parsed.changedPaths, ["openwiki/.last-update.json"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("OpenWiki preflight skips OpenWiki workflow plumbing only", () => {
  const { cwd } = makeRepo();
  try {
    write(join(cwd, ".github", "workflows", "openwiki-update.yml"), "name: OpenWiki\n");
    write(join(cwd, "scripts", "should-run-openwiki-update.mjs"), "#!/usr/bin/env node\n");
    write(join(cwd, "tests", "openwiki-should-run.test.ts"), "import test from 'node:test';\n");
    git(cwd, ["add", "."]);
    git(cwd, ["commit", "-m", "ci openwiki workflow"]);

    const result = runDecision(cwd);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = parseDecision(result.stdout);
    assert.equal(parsed.shouldRun, false);
    assert.equal(parsed.reason, "docs_or_workflow_only_delta");
    assert.deepEqual(parsed.sourceChangedPaths, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("OpenWiki preflight runs for source deltas since last update", () => {
  const { cwd } = makeRepo();
  try {
    write(join(cwd, "package.json"), `${JSON.stringify({ version: "1.5.1" }, null, 2)}\n`);
    git(cwd, ["add", "."]);
    git(cwd, ["commit", "-m", "source change"]);

    const result = runDecision(cwd);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = parseDecision(result.stdout);
    assert.equal(parsed.shouldRun, true);
    assert.equal(parsed.reason, "source_delta");
    assert.deepEqual(parsed.sourceChangedPaths, ["package.json"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("OpenWiki preflight runs for init and missing state", () => {
  const { cwd } = makeRepo();
  try {
    const init = runDecision(cwd, { command: "init" });
    assert.equal(init.status, 0, init.stderr || init.stdout);
    assert.equal(parseDecision(init.stdout).reason, "init_command");
    assert.equal(parseDecision(init.stdout).shouldRun, true);

    rmSync(join(cwd, "openwiki", ".last-update.json"));
    const missing = runDecision(cwd);
    assert.equal(missing.status, 0, missing.stderr || missing.stdout);
    assert.equal(parseDecision(missing.stdout).reason, "missing_or_invalid_last_update");
    assert.equal(parseDecision(missing.stdout).shouldRun, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("OpenWiki preflight writes GitHub outputs", () => {
  const { cwd } = makeRepo();
  const outputPath = join(cwd, "github-output");
  try {
    const result = runDecision(cwd, { githubOutput: outputPath });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = readFileSync(outputPath, "utf8");
    assert.match(output, /^should_run=false$/m);
    assert.match(output, /^reason=docs_or_workflow_only_delta$/m);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
