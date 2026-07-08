#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const outputDir = "openwiki";
const typoDir = "penwiki";

function gitOutput(args, allowFailure = false) {
  const result = spawnSync("git", args, {
    encoding: "utf8"
  });
  if (result.status !== 0 && !allowFailure) {
    process.stderr.write(result.stderr || `git ${args.join(" ")} failed\n`);
    process.exit(result.status ?? 1);
  }
  return result.status === 0 ? result.stdout : "";
}

function typoStatus() {
  return gitOutput(["status", "--porcelain", "--untracked-files=all", "--", typoDir], true).trim();
}

const hadTypoDir = existsSync(typoDir);
const hadTypoStatus = Boolean(typoStatus());

if (hadTypoDir) {
  mkdirSync(outputDir, { recursive: true });
  cpSync(typoDir, outputDir, { recursive: true, force: true });
}

if (hadTypoDir || hadTypoStatus) {
  gitOutput(["reset", "--quiet", "--", typoDir], true);
  gitOutput(["restore", "--worktree", "--", typoDir], true);
  gitOutput(["clean", "-fd", "--", typoDir], true);
  rmSync(typoDir, { recursive: true, force: true });
}

const remaining = typoStatus();
if (remaining) {
  console.error("OpenWiki output normalization failed: penwiki/** changes remain");
  console.error(remaining);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      normalizedTypoOutput: hadTypoDir,
      clearedTypoGitStatus: hadTypoStatus || hadTypoDir
    },
    null,
    2
  )
);
