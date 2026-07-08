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
  const bytes = [];

  for (let index = 0; index < path.length; index += 1) {
    const char = path[index];
    if (char !== "\\") {
      bytes.push(...Buffer.from(char));
      continue;
    }

    const rest = path.slice(index + 1);
    const octal = rest.match(/^[0-7]{1,3}/u)?.[0];
    if (octal) {
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }

    const escaped = rest[0] ?? "";
    index += 1;
    switch (escaped) {
      case "a":
        bytes.push(0x07);
        break;
      case "b":
        bytes.push(0x08);
        break;
      case "f":
        bytes.push(0x0c);
        break;
      case "n":
        bytes.push(0x0a);
        break;
      case "r":
        bytes.push(0x0d);
        break;
      case "t":
        bytes.push(0x09);
        break;
      case "v":
        bytes.push(0x0b);
        break;
      default:
        bytes.push(...Buffer.from(escaped));
    }
  }

  return Buffer.from(bytes).toString("utf8");
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
