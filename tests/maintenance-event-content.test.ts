import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabase, indexCodexSessions, type LooDatabase } from "../packages/core/src/index.js";
import { runLoo } from "./helpers/run-loo.js";

function writeMaintenanceSession(path: string, threadId: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, [
    JSON.stringify({ timestamp: "2026-07-08T00:00:00.000Z", session_meta: { payload: { id: threadId, cwd: "/Users/lume/private-worktree" } } }),
    JSON.stringify({ timestamp: "2026-07-08T00:00:01.000Z", event_msg: { type: "thread_name", name: "Maintenance drop event content" } }),
    JSON.stringify({ timestamp: "2026-07-08T00:00:02.000Z", response_item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Maintenance event-content drop CLI fixture." }] } })
  ].join("\n") + "\n");
}

function countRows(db: LooDatabase, tableName: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }).count);
}

test("CLI maintenance --drop-event-content removes only the derived event-content cache", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-maintenance-event-content-"));
  try {
    const sessionsDir = join(root, "sessions");
    const dbPath = join(root, "orchestrator.sqlite");
    writeMaintenanceSession(join(sessionsDir, "rollout-2026-07-08T00-00-00-019f-maintenance-drop.jsonl"), "019f-maintenance-drop");
    const db = createDatabase(dbPath);
    try {
      assert.equal(indexCodexSessions(db, { roots: [sessionsDir], maxFiles: 10 }).indexedFiles, 1);
      assert.ok(countRows(db, "codex_event_content") > 0);
    } finally {
      db.close();
    }

    const result = runLoo(["maintenance", "--drop-event-content", "--timeout-ms", "5000"], {
      ...process.env,
      LCO_DB_PATH: dbPath
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /\/Users\/|\/Volumes\/|private-worktree|Maintenance event-content/);
    const report = JSON.parse(result.stdout) as Record<string, any>;
    assert.equal(report.schema, "lco.codexEventContent.drop.v1");
    assert.equal(report.ok, true);
    assert.equal(report.before.eventContentRows > 0, true);
    assert.equal(report.after.eventContentRows, 0);
    assert.equal(report.after.eventContentFtsRows, 0);
    assert.match(report.nextSafeCommands.join("\n"), /loo index codex/);

    const afterDb = createDatabase(dbPath);
    try {
      assert.equal(countRows(afterDb, "codex_sessions"), 1);
      assert.ok(countRows(afterDb, "prepared_source_events") > 0);
      assert.equal(countRows(afterDb, "codex_event_content"), 0);
      assert.equal(countRows(afterDb, "codex_event_content_fts"), 0);
    } finally {
      afterDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
