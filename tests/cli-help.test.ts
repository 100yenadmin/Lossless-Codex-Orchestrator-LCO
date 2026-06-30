import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

function runLoo(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    ...args
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env
  });
}

test("loo search --help exits zero without querying the local index", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-search-help-"));
  const dbPath = join(root, "orchestrator.sqlite");
  try {
    const result = runLoo(["search", "--help"], {
      ...process.env,
      LOO_DB_PATH: dbPath
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Usage:\n  loo search <query>/);
    assert.match(result.stdout, /Search indexed Codex sessions/i);
    assert.doesNotMatch(result.stdout, /^\s*\[/);
    assert.equal(result.stderr.trim(), "");
    assert.equal(existsSync(dbPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo search treats --help as query text when it is not the only argument", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-search-query-help-"));
  try {
    const result = runLoo(["search", "foo", "--help"], {
      ...process.env,
      LOO_DB_PATH: join(root, "orchestrator.sqlite")
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stdout, /Usage:\n  loo search <query>/);
    assert.match(result.stdout, /^\s*\[/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo openclaw dogfood --help exits zero with command-specific usage", () => {
  const result = runLoo(["openclaw", "dogfood", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo openclaw dogfood/);
  assert.match(result.stdout, /--install-source path/);
  assert.match(result.stdout, /public-safe/i);
  assert.match(result.stdout, /Replace the default required loo_\* tool set/i);
  assert.match(result.stdout, /With --install-source, it may run OpenClaw plugin install/i);
  assert.equal(result.stderr.trim(), "");
});
