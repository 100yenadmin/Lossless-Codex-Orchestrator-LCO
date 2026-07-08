#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function unquotePath(path) {
  return path.replace(/^"|"$/g, "");
}

function changedPathsFromPorcelain(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const raw = line.slice(3).trim();
      const renamed = raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
      return renamed ? [unquotePath(renamed)] : [];
    });
}

function changedPathsFromStdin() {
  return changedPathsFromPorcelain(readFileSync(0, "utf8"));
}

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

function currentChangedPaths() {
  const baseSha = process.env.GITHUB_SHA || "HEAD";
  return [
    ...changedPathsFromPorcelain(gitOutput(["status", "--porcelain", "--untracked-files=all"])),
    ...changedPathsFromNameOnly(gitOutput(["diff", "--name-only", "--cached", "--"], true)),
    ...changedPathsFromNameOnly(gitOutput(["diff", "--name-only", baseSha, "--"], true))
  ];
}

function changedPathsFromNameOnly(output) {
  return output
    .split(/\r?\n/)
    .map((line) => unquotePath(line.trim()))
    .filter(Boolean);
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function isAllowedOpenWikiPath(path) {
  if (!path || path.startsWith("/") || path.includes("\0")) return false;
  const normalized = normalizePath(path);
  const parts = normalized.split("/");
  if (parts.includes("..")) return false;
  return normalized.startsWith("openwiki/") && normalized.length > "openwiki/".length;
}

const useStdin = process.argv.includes("--stdin");
const paths = [...new Set((useStdin ? changedPathsFromStdin() : currentChangedPaths()).map(normalizePath))];
const violations = paths.filter((path) => !isAllowedOpenWikiPath(path));

if (violations.length > 0) {
  console.error("OpenWiki docs update refused: changed paths outside openwiki/**");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      changedPathCount: paths.length,
      allowedPrefix: "openwiki/**"
    },
    null,
    2
  )
);
