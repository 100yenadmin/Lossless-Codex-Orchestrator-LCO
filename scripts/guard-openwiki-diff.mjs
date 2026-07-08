#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function changedPathsFromPorcelain(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const raw = line.slice(3).trim();
      const renamed = raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
      return renamed ? [renamed.replace(/^"|"$/g, "")] : [];
    });
}

function changedPathsFromStdin() {
  return readFileSync(0, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function currentChangedPaths() {
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8"
  });
  if (status.status !== 0) {
    process.stderr.write(status.stderr || "git status failed\n");
    process.exit(status.status ?? 1);
  }
  return changedPathsFromPorcelain(status.stdout);
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

const useStdin = process.argv.includes("--stdin");
const paths = (useStdin ? changedPathsFromStdin() : currentChangedPaths()).map(normalizePath);
const violations = paths.filter((path) => !path.startsWith("openwiki/"));

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
