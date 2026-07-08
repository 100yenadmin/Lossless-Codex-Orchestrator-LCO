#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const query = process.argv.slice(2);

if (query.length === 0) {
  console.error("Usage: lco-find <query>");
  process.exit(2);
}

const spawnOptions = { stdio: "inherit", env: process.env };
const direct = spawnSync("lco", ["find", "--json", ...query], spawnOptions);

if (direct.error?.code === "ENOENT") {
  const fallback = spawnSync("npx", [
    "--yes",
    "lossless-codex-orchestrator@latest",
    "find",
    "--json",
    ...query
  ], spawnOptions);

  if (fallback.error) {
    console.error("Unable to run lco or npx fallback.");
    process.exit(127);
  }

  process.exit(fallback.status ?? 1);
}

if (direct.error) {
  console.error("Unable to run lco.");
  process.exit(127);
}

process.exit(direct.status ?? 1);
