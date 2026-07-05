import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

export function runLoo(args: string[], env: NodeJS.ProcessEnv = process.env, timeout = 20_000) {
  return spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    ...args
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    timeout
  });
}
