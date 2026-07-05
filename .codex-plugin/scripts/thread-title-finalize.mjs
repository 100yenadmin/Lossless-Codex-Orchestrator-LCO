#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const payload = await readStdin();
const localCli = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");
const command = existsSync(localCli) ? process.execPath : "loo";
const args = existsSync(localCli)
  ? [localCli, "hook", "thread-title-finalize", "--payload-stdin"]
  : ["hook", "thread-title-finalize", "--payload-stdin"];

const result = spawnSync(command, args, {
  input: payload,
  encoding: "utf8",
  stdio: ["pipe", "pipe", "pipe"]
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
