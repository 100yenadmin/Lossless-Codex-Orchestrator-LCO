import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createDatabase, indexCodexSessions } from "../packages/core/src/index.js";
import { runLoo } from "./helpers/run-loo.js";

function writeSession(path: string, threadId: string, title: string, body: string): void {
  writeFileSync(path, [
    JSON.stringify({ timestamp: "2026-07-06T15:00:00.000Z", session_meta: { payload: { id: threadId, cwd: "/Volumes/LEXAR/repos/private-cli-search" } } }),
    JSON.stringify({ timestamp: "2026-07-06T15:00:01.000Z", event_msg: { type: "thread_name", name: title } }),
    JSON.stringify({ timestamp: "2026-07-06T15:00:02.000Z", event_msg: { type: "agent_message", message: body } })
  ].join("\n") + "\n");
}

test("loo search supports bounded limit and timeout arguments on a large fixture", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-search-large-"));
  try {
    const dbPath = join(root, "orchestrator.sqlite");
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    for (let index = 0; index < 40; index += 1) {
      const id = `019f-search-large-${String(index).padStart(3, "0")}`;
      writeSession(
        join(sessions, `${id}.jsonl`),
        id,
        `Plan search fixture ${index}`,
        `Final: bounded plan search fixture ${index} complete. PRIVATE_CANARY_SEARCH_${index}`
      );
    }
    const db = createDatabase(dbPath);
    try {
      indexCodexSessions(db, { roots: [sessions], maxFiles: 100 });
    } finally {
      db.close();
    }

    const result = runLoo(["search", "--limit", "3", "--timeout-ms", "1000", "plan"], {
      ...process.env,
      LOO_DB_PATH: dbPath
    }, 5_000);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr.trim(), "");
    const payload = JSON.parse(result.stdout) as unknown[];
    assert.equal(Array.isArray(payload), true);
    assert.equal(payload.length, 3);
    assert.doesNotMatch(result.stdout, /\/Volumes\/LEXAR|\/Users\/|\/tmp\/|orchestrator\.sqlite|\.jsonl|PRIVATE_CANARY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo search classifies locked databases without leaking local paths", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-search-locked-"));
  let locker: DatabaseSync | null = null;
  try {
    const dbPath = join(root, "orchestrator.sqlite");
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeSession(
      join(sessions, "locked.jsonl"),
      "019f-search-locked",
      "Locked plan search fixture",
      "Final: locked plan search fixture complete."
    );
    const db = createDatabase(dbPath);
    try {
      indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    } finally {
      db.close();
    }

    // This intentionally holds an exclusive write transaction so the spawned CLI
    // proves the SQLite busy-timeout path rather than relying on a slow query.
    locker = new DatabaseSync(dbPath, { timeout: 1 });
    locker.exec("PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS lock_hold (id INTEGER); INSERT INTO lock_hold VALUES (1);");

    const result = runLoo(["search", "--timeout-ms", "50", "plan"], {
      ...process.env,
      LOO_DB_PATH: dbPath
    }, 5_000);

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(result.stderr.trim(), "");
    const payload = JSON.parse(result.stdout) as {
      ok?: unknown;
      code?: unknown;
      classification?: unknown;
      publicSafe?: unknown;
      actionsPerformed?: Record<string, unknown>;
      nextSafeCommands?: unknown[];
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "database_busy");
    assert.equal(payload.classification, "recoverable_setup_error");
    assert.equal(payload.publicSafe, true);
    assert.equal(payload.actionsPerformed?.rawTranscriptRead, false);
    assert.equal(payload.actionsPerformed?.liveControl, false);
    assert.ok(Array.isArray(payload.nextSafeCommands));
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /\/Volumes\/LEXAR|\/Users\/|\/tmp\/|orchestrator\.sqlite|\.jsonl|PRIVATE_CANARY/);
  } finally {
    if (locker) {
      try {
        locker.exec("ROLLBACK;");
      } catch {
        // The lock may already be released if the fixture failed before BEGIN.
      }
      locker.close();
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo search supports flag-like query text after the option delimiter", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-search-delimiter-"));
  try {
    const dbPath = join(root, "orchestrator.sqlite");
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeSession(
      join(sessions, "flaglike.jsonl"),
      "019f-search-flaglike",
      "Flag-like query fixture",
      "Final: --limit flaglikequery is searchable as text."
    );
    const db = createDatabase(dbPath);
    try {
      indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    } finally {
      db.close();
    }

    const result = runLoo(["search", "--limit", "1", "--", "--limit", "flaglikequery"], {
      ...process.env,
      LOO_DB_PATH: dbPath
    }, 5_000);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout) as Array<{ sourceRef?: unknown }>;
    assert.equal(payload.length, 1);
    assert.equal(payload[0]?.sourceRef, "codex_thread:019f-search-flaglike");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct CLI recall commands suppress telemetry side effects", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-recall-telemetry-"));
  try {
    const dbPath = join(root, "orchestrator.sqlite");
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeSession(
      join(sessions, "telemetry.jsonl"),
      "019f-search-telemetry",
      "Telemetry-free plan search fixture",
      "Final: telemetry-free plan search fixture complete."
    );
    const db = createDatabase(dbPath);
    try {
      indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    } finally {
      db.close();
    }

    const env = {
      ...process.env,
      LOO_DB_PATH: dbPath,
      LOO_TELEMETRY: "1",
      LOO_TELEMETRY_SESSION_ID: "cli-smoke-should-not-write"
    };
    const search = runLoo(["search", "--limit", "1", "--timeout-ms", "1000", "plan"], env, 5_000);
    assert.equal(search.status, 0, search.stderr || search.stdout);
    const describe = runLoo(["describe", "--timeout-ms", "1000", "codex_thread:019f-search-telemetry"], env, 5_000);
    assert.equal(describe.status, 0, describe.stderr || describe.stdout);
    const expand = runLoo(["expand-ref", "--profile", "metadata", "--timeout-ms", "1000", "codex_thread:019f-search-telemetry"], env, 5_000);
    assert.equal(expand.status, 0, expand.stderr || expand.stdout);

    const reopened = createDatabase(dbPath, { maintenance: "schema-only" });
    try {
      assert.equal((reopened.prepare("SELECT COUNT(*) AS count FROM telemetry_search_events").get() as { count: number }).count, 0);
      assert.equal((reopened.prepare("SELECT COUNT(*) AS count FROM telemetry_follow_events").get() as { count: number }).count, 0);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo describe and expand classify locked databases without leaking local paths", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-recall-locked-"));
  let locker: DatabaseSync | null = null;
  try {
    const dbPath = join(root, "orchestrator.sqlite");
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeSession(
      join(sessions, "locked-recall.jsonl"),
      "019f-recall-locked",
      "Locked recall fixture",
      "Final: locked recall fixture complete."
    );
    const db = createDatabase(dbPath);
    try {
      indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    } finally {
      db.close();
    }

    // This intentionally holds an exclusive write transaction so the spawned CLI
    // proves the SQLite busy-timeout path rather than relying on a slow query.
    locker = new DatabaseSync(dbPath, { timeout: 1 });
    locker.exec("PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS lock_hold (id INTEGER); INSERT INTO lock_hold VALUES (1);");
    const env = { ...process.env, LOO_DB_PATH: dbPath };

    for (const args of [
      ["describe", "--timeout-ms", "50", "codex_thread:019f-recall-locked"],
      ["expand-ref", "--timeout-ms", "50", "codex_thread:019f-recall-locked"],
      ["expand-query", "--timeout-ms", "50", "locked recall"]
    ]) {
      const result = runLoo(args, env, 5_000);
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.equal(result.stderr.trim(), "");
      const payload = JSON.parse(result.stdout) as {
        ok?: unknown;
        code?: unknown;
        classification?: unknown;
        publicSafe?: unknown;
        actionsPerformed?: Record<string, unknown>;
      };
      assert.equal(payload.ok, false);
      assert.equal(payload.code, "database_busy");
      assert.equal(payload.classification, "recoverable_setup_error");
      assert.equal(payload.publicSafe, true);
      assert.equal(payload.actionsPerformed?.rawTranscriptRead, false);
      assert.equal(payload.actionsPerformed?.liveControl, false);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /\/Volumes\/LEXAR|\/Users\/|\/tmp\/|orchestrator\.sqlite|\.jsonl|PRIVATE_CANARY/);
    }
  } finally {
    if (locker) {
      try {
        locker.exec("ROLLBACK;");
      } catch {
        // The lock may already be released if the fixture failed before BEGIN.
      }
      locker.close();
    }
    rmSync(root, { recursive: true, force: true });
  }
});
