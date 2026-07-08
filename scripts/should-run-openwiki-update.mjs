#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const lastUpdatePath = "openwiki/.last-update.json";
const ignoredPathPrefixes = ["openwiki/"];
const ignoredExactPaths = new Set([
  ".github/workflows/openwiki-update.yml",
  "scripts/detect-openwiki-real-changes.mjs",
  "scripts/guard-openwiki-diff.mjs",
  "scripts/normalize-openwiki-output.mjs",
  "scripts/should-run-openwiki-update.mjs",
  "tests/openwiki-real-changes.test.ts",
  "tests/openwiki-normalize-output.test.ts",
  "tests/openwiki-should-run.test.ts",
  "tests/openwiki-workflow.test.ts"
]);

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8"
  });
  if (result.status !== 0 && !options.allowFailure) {
    process.stderr.write(result.stderr || `git ${args.join(" ")} failed\n`);
    process.exit(result.status ?? 1);
  }
  return result;
}

function writeGitHubOutput(values) {
  if (!process.env.GITHUB_OUTPUT) {
    console.error("--github-output was requested, but GITHUB_OUTPUT is not set");
    process.exit(1);
  }

  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    "utf8"
  );
}

function isIgnoredPath(path) {
  const normalized = normalizePath(path);
  return ignoredExactPaths.has(normalized) || ignoredPathPrefixes.some((prefix) => normalized.startsWith(prefix));
}

function readLastGitHead() {
  if (!existsSync(lastUpdatePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(lastUpdatePath, "utf8"));
    return typeof parsed.gitHead === "string" && /^[0-9a-f]{40}$/i.test(parsed.gitHead) ? parsed.gitHead : null;
  } catch {
    return null;
  }
}

function decision({ shouldRun, reason, changedPaths = [], sourceChangedPaths = [], lastGitHead = null }) {
  const payload = {
    ok: true,
    shouldRun,
    reason,
    lastGitHead,
    changedPathCount: changedPaths.length,
    sourceChangedPathCount: sourceChangedPaths.length,
    ignoredPathPrefixes,
    ignoredExactPaths: [...ignoredExactPaths].sort(),
    changedPaths,
    sourceChangedPaths
  };

  if (process.argv.includes("--github-output")) {
    writeGitHubOutput({
      should_run: shouldRun ? "true" : "false",
      reason,
      changed_path_count: String(changedPaths.length),
      source_changed_path_count: String(sourceChangedPaths.length)
    });
  }

  console.log(JSON.stringify(payload, null, 2));
}

const command = process.env.COMMAND || "update";

if (command === "init") {
  decision({ shouldRun: true, reason: "init_command" });
  process.exit(0);
}

if (command !== "update") {
  decision({ shouldRun: true, reason: "unknown_command" });
  process.exit(0);
}

const lastGitHead = readLastGitHead();
if (!lastGitHead) {
  decision({ shouldRun: true, reason: "missing_or_invalid_last_update" });
  process.exit(0);
}

const hasBaseCommit = git(["cat-file", "-e", `${lastGitHead}^{commit}`], { allowFailure: true }).status === 0;
if (!hasBaseCommit) {
  decision({ shouldRun: true, reason: "last_update_commit_unavailable", lastGitHead });
  process.exit(0);
}

const diff = git(["diff", "--name-only", "--diff-filter=ACMRTD", lastGitHead, "HEAD"]).stdout;
const changedPaths = [...new Set(diff.split(/\r?\n/).map(normalizePath).filter(Boolean))].sort();
const sourceChangedPaths = changedPaths.filter((path) => !isIgnoredPath(path));

if (sourceChangedPaths.length === 0) {
  decision({
    shouldRun: false,
    reason: changedPaths.length === 0 ? "already_current" : "docs_or_workflow_only_delta",
    changedPaths,
    sourceChangedPaths,
    lastGitHead
  });
  process.exit(0);
}

decision({
  shouldRun: true,
  reason: "source_delta",
  changedPaths,
  sourceChangedPaths,
  lastGitHead
});
