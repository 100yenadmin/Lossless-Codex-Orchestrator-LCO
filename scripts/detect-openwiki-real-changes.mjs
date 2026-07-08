#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const ignoredMetadataPath = "openwiki/_metadata/workflow-run.json";

function unquotePath(path) {
  const trimmed = path.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed;
  }

  return decodeGitQuotedPath(trimmed.slice(1, -1));
}

function decodeGitQuotedPath(path) {
  return path.replace(/\\(?:([0-7]{1,3})|(.))/g, (_match, octal, escaped) => {
    if (octal) {
      return String.fromCharCode(Number.parseInt(octal, 8));
    }
    switch (escaped) {
      case "a":
        return "\x07";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "v":
        return "\v";
      default:
        return escaped;
    }
  });
}

function changedPathsFromPorcelain(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.replace(/\r$/, ""))
    .filter(Boolean)
    .flatMap((line) => {
      const raw = line.slice(3).trim();
      const renamed = raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
      return renamed ? [unquotePath(renamed)] : [];
    });
}

function gitOutput(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `git ${args.join(" ")} failed\n`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
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

function writeGitHubOutput(values) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    "utf8"
  );
}

const useStdin = process.argv.includes("--stdin");
const writeOutputs = process.argv.includes("--github-output");
const porcelain = useStdin
  ? readFileSync(0, "utf8")
  : gitOutput(["status", "--porcelain", "--untracked-files=all"]);
const paths = [...new Set(changedPathsFromPorcelain(porcelain).map(normalizePath))];
const violations = paths.filter((path) => !isAllowedOpenWikiPath(path));

if (violations.length > 0) {
  console.error("OpenWiki docs update refused: changed paths outside openwiki/**");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

const realChangedPaths = paths.filter((path) => path !== ignoredMetadataPath);
const hasChanges = realChangedPaths.length > 0;

if (writeOutputs) {
  writeGitHubOutput({
    has_changes: hasChanges ? "true" : "false",
    changed_path_count: String(paths.length),
    real_changed_path_count: String(realChangedPaths.length)
  });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      hasRealOpenWikiChanges: hasChanges,
      changedPathCount: paths.length,
      realChangedPathCount: realChangedPaths.length,
      ignoredMetadataPath,
      realChangedPaths
    },
    null,
    2
  )
);
