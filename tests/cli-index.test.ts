import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function writeJsonl(path: string, threadId: string, title: string): void {
  writeFileSync(path, [
    JSON.stringify({ session_meta: { payload: { id: threadId, cwd: "/Volumes/LEXAR/repos/example" } } }),
    JSON.stringify({ event_msg: { type: "thread_name", name: title } }),
    JSON.stringify({ event_msg: { type: "agent_message", message: `Final: ${title} complete.` } })
  ].join("\n") + "\n");
}

test("CLI index codex supports bounded --max-files smoke runs", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-index-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  writeJsonl(join(sessions, "rollout-2026-06-28T00-00-00-019f-cli-a.jsonl"), "019f-cli-a", "CLI bounded A");
  writeJsonl(join(sessions, "rollout-2026-06-28T00-00-00-019f-cli-b.jsonl"), "019f-cli-b", "CLI bounded B");

  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "index",
      "codex",
      "--max-files",
      "1",
      sessions
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        LOO_DB_PATH: join(root, "orchestrator.sqlite")
      }
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as { indexedFiles: number; indexedThreads: number; errors: unknown[] };
    assert.equal(payload.indexedFiles, 1);
    assert.equal(payload.indexedThreads, 1);
    assert.deepEqual(payload.errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI index codex forwards byte and event ceilings", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-index-ceilings-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const sessionPath = join(sessions, "rollout-2026-06-28T00-00-00-019f-cli-ceiling.jsonl");
  writeJsonl(sessionPath, "019f-cli-ceiling", "CLI event ceiling");

  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "index",
      "codex",
      "--max-files",
      "10",
      "--max-bytes-per-file",
      "100000",
      "--max-events-per-file",
      "2",
      sessions
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        LOO_DB_PATH: join(root, "orchestrator.sqlite")
      }
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as {
      indexedFiles: number;
      skippedFiles: number;
      limitedFiles: Array<{ path: string; reason: string; limit: number; actual: number }>;
    };
    assert.equal(payload.indexedFiles, 0);
    assert.equal(payload.skippedFiles, 1);
    assert.deepEqual(payload.limitedFiles, [{
      path: sessionPath,
      reason: "max_events_per_file",
      limit: 2,
      actual: 3
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI index codex rejects invalid --max-files values before indexing", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-index-invalid-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  writeJsonl(join(sessions, "rollout-2026-06-28T00-00-00-019f-cli-invalid.jsonl"), "019f-cli-invalid", "CLI invalid");

  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "index",
      "codex",
      "--max-files",
      "nope",
      sessions
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        LOO_DB_PATH: join(root, "orchestrator.sqlite")
      }
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--max-files requires an integer between 1 and 100000/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI index codex rejects invalid ceiling values before indexing", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-index-invalid-ceiling-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  writeJsonl(join(sessions, "rollout-2026-06-28T00-00-00-019f-cli-invalid-ceiling.jsonl"), "019f-cli-invalid-ceiling", "CLI invalid ceiling");

  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "index",
      "codex",
      "--max-events-per-file",
      "0",
      sessions
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        LOO_DB_PATH: join(root, "orchestrator.sqlite")
      }
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--max-events-per-file requires an integer between 1 and 1000000/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
