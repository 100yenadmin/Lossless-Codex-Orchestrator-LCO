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

function runLoo(args: string[], env: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--import", "tsx", "packages/cli/src/index.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env
  });
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

test("CLI index claude supports grep describe expand product recall", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-index-claude-"));
  const projectRoot = join(root, ".claude", "projects", "-Volumes-LEXAR-repos-lco");
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(projectRoot, "claude-cli-session.jsonl"), [
    JSON.stringify({
      type: "user",
      sessionId: "claude-cli-import",
      timestamp: "2026-07-08T07:00:00.000Z",
      message: {
        role: "user",
        content: "Please prove the Claude CLI import recall path works without exposing /Users/lume/private/session.jsonl."
      }
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "claude-cli-import",
      timestamp: "2026-07-08T07:01:00.000Z",
      message: {
        role: "assistant",
        content: "Claude CLI import recall path is indexed for grep describe expand."
      }
    })
  ].join("\n") + "\n");
  const env = {
    ...process.env,
    LOO_DB_PATH: join(root, "orchestrator.sqlite")
  };

  try {
    const index = runLoo(["index", "claude", "--max-files", "10", join(root, ".claude", "projects")], env);
    assert.equal(index.status, 0, index.stderr);
    const indexPayload = JSON.parse(index.stdout) as { publicSafe: boolean; indexedFiles: number; indexedSessions: number; errors: unknown[] };
    assert.equal(indexPayload.publicSafe, true);
    assert.equal(indexPayload.indexedFiles, 1);
    assert.equal(indexPayload.indexedSessions, 1);
    assert.deepEqual(indexPayload.errors, []);

    const grep = runLoo(["grep", "Claude", "CLI", "import", "recall", "path"], env);
    assert.equal(grep.status, 0, grep.stderr);
    const grepPayload = JSON.parse(grep.stdout) as { matches: Array<{ sourceRef: string; sourceKind: string }> };
    assert.equal(grepPayload.matches[0]?.sourceKind, "claude_session");
    assert.equal(grepPayload.matches[0]?.sourceRef, "claude_session:claude-cli-import");

    const describe = runLoo(["describe", "claude_session:claude-cli-import"], env);
    assert.equal(describe.status, 0, describe.stderr);
    const describePayload = JSON.parse(describe.stdout) as { sourceKind: string; sourcePath: string };
    assert.equal(describePayload.sourceKind, "claude_session");
    assert.equal(describePayload.sourcePath.startsWith("claude_source:"), true);

    const expand = runLoo(["expand-ref", "--profile", "brief", "claude_session:claude-cli-import"], env);
    assert.equal(expand.status, 0, expand.stderr);
    const expandPayload = JSON.parse(expand.stdout) as { text: string };
    const serialized = JSON.stringify({ indexPayload, grepPayload, describePayload, expandPayload });
    assert.match(expandPayload.text, /Claude CLI import recall path/);
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("/Volumes/LEXAR"), false);
    assert.equal(serialized.includes("claude-cli-session.jsonl"), false);
    assert.equal(serialized.includes("session.jsonl"), false);
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

test("CLI index codex surfaces cap skip warnings with recovery commands", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-index-warnings-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const sessionPath = join(sessions, "rollout-2026-06-28T00-00-00-019f-cli-warning.jsonl");
  writeJsonl(sessionPath, "019f-cli-warning", "CLI cap warning");

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
      indexLimits: { maxBytesPerFile: number; maxEventsPerFile: number };
      warnings: Array<{
        code: string;
        limitedFiles: number;
        skippedFiles: number;
        reasons: Array<{ reason: string; count: number; limit: number; maxActual: number }>;
        nextSafeCommands: string[];
      }>;
    };
    assert.deepEqual(payload.indexLimits, { maxBytesPerFile: 100000, maxEventsPerFile: 2 });
    assert.equal(payload.warnings[0]?.code, "codex_index_limited_files_skipped");
    assert.equal(payload.warnings[0]?.limitedFiles, 1);
    assert.equal(payload.warnings[0]?.skippedFiles, 1);
    assert.deepEqual(payload.warnings[0]?.reasons, [{
      reason: "max_events_per_file",
      count: 1,
      limit: 2,
      maxActual: 3
    }]);
    assert.match(payload.warnings[0]?.nextSafeCommands.join("\n") ?? "", /--max-events-per-file 1000000/);
    assert.doesNotMatch(JSON.stringify(payload.warnings), /\/Volumes\/|\/Users\/|\/var\/|\.jsonl/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI index codex accepts --verify for full-content unchanged checks", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-index-verify-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  writeJsonl(join(sessions, "rollout-2026-06-28T00-00-00-019f-cli-verify.jsonl"), "019f-cli-verify", "CLI verify");
  const env = {
    ...process.env,
    LOO_DB_PATH: join(root, "orchestrator.sqlite")
  };

  try {
    const first = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "index",
      "codex",
      sessions
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env
    });
    assert.equal(first.status, 0, first.stderr);

    const second = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "index",
      "codex",
      "--verify",
      sessions
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env
    });

    assert.equal(second.status, 0, second.stderr);
    const payload = JSON.parse(second.stdout) as { indexedFiles: number; skippedFiles: number; errors: unknown[] };
    assert.equal(payload.indexedFiles, 0);
    assert.equal(payload.skippedFiles, 1);
    assert.deepEqual(payload.errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI index bench reports public-safe cold and no-change timings", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "packages/cli/src/index.ts",
    "index",
    "bench",
    "--sessions",
    "5"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /\/Users\/|\/Volumes\/|\/var\/|\/tmp\//);
  const payload = JSON.parse(result.stdout) as {
    schema: string;
    publicSafe: boolean;
    sessions: number;
    verify: boolean;
    timingsMs: { coldIndex: number; noChangeReindex: number };
    counts: {
      coldIndex: { indexedFiles: number; skippedFiles: number; errors: number };
      noChangeReindex: { indexedFiles: number; skippedFiles: number; errors: number };
    };
  };
  assert.equal(payload.schema, "lco.index.bench.v1");
  assert.equal(payload.publicSafe, true);
  assert.equal(payload.sessions, 5);
  assert.equal(payload.verify, false);
  assert.equal(payload.counts.coldIndex.indexedFiles, 5);
  assert.equal(payload.counts.noChangeReindex.indexedFiles, 0);
  assert.equal(payload.counts.noChangeReindex.skippedFiles, 5);
  assert.equal(payload.counts.coldIndex.errors, 0);
  assert.equal(payload.counts.noChangeReindex.errors, 0);
  assert.equal(Number.isFinite(payload.timingsMs.coldIndex), true);
  assert.equal(Number.isFinite(payload.timingsMs.noChangeReindex), true);
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
