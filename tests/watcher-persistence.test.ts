import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabase,
  createWatcherStatusReport,
  getWatcherEvents,
  persistWatcherObservations,
  type WatchSpec
} from "../packages/core/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";

function withWatcherDb<T>(fn: (db: ReturnType<typeof createDatabase>) => T): T {
  const root = mkdtempSync(join(tmpdir(), "loo-watcher-persistence-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    return fn(db);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function finalMessageWatchSpec(overrides: Partial<WatchSpec> = {}): WatchSpec {
  return {
    schema: "lco.watchSpec.v1",
    watchId: "watch_final_message",
    targetRef: "codex_thread:019f-watcher-final",
    kind: "final_message_appeared",
    createdAt: "2026-07-03T20:00:00.000Z",
    lastObservedAt: "2026-07-03T20:04:00.000Z",
    ttlSeconds: 3600,
    staleAfterSeconds: 1800,
    stopConditions: ["final_message_seen", "explicit_cancel"],
    evidenceIds: ["ev_final_message"],
    confidence: 0.91,
    mutates: false,
    observed: {
      finalMessageCount: 1
    },
    ...overrides
  };
}

test("persisted watcher observations reproduce deterministic watcher state and execute-false attention queue", () => {
  withWatcherDb((db) => {
    const now = "2026-07-03T20:05:00.000Z";
    const spec = finalMessageWatchSpec();
    const expected = createWatcherStatusReport([spec], { now, limit: 5 });

    const writeReport = persistWatcherObservations(db, [spec], { now });
    assert.equal(writeReport.schema, "lco.watchers.persistence.v1");
    assert.equal(writeReport.publicSafe, false);
    assert.deepEqual(writeReport.mutationClasses, ["derived_cache"]);
    assert.equal(writeReport.summary.specs, 1);
    assert.equal(writeReport.summary.observations, 1);
    assert.equal(writeReport.summary.queueItems, 1);
    assert.equal(writeReport.actionsPerformed.derivedCacheWrite, true);
    assert.equal(writeReport.actionsPerformed.liveControl, false);

    const events = getWatcherEvents(db, { now, limit: 5 });
    assert.equal(events.schema, "lco.watchers.events.v1");
    assert.equal(events.publicSafe, true);
    assert.equal(events.readOnly, true);
    assert.equal(events.summary.total, 1);
    assert.equal(events.summary.triggered, 1);
    assert.equal(events.summary.queueItems, 1);
    assert.equal(events.sourceCoverage.watcherObservations, "ok");
    assert.equal(events.observations[0]?.watcher.status, expected.watchers[0]?.status);
    assert.deepEqual(events.observations[0]?.watcher.reasonCodes, expected.watchers[0]?.reasonCodes);
    assert.equal(events.queue[0]?.execute, false);
    assert.equal(events.queue[0]?.toolCall.execute, false);
    assert.equal(events.queue[0]?.toolCall.tool, "loo_resume_request_packet");
    assert.equal(events.actionsPerformed.liveControl, false);
    assert.equal(events.actionsPerformed.externalWrite, false);
    assert.equal(events.actionsPerformed.rawTranscriptRead, false);
  });
});

test("watcher persistence treats same timestamp and spec replay as idempotent", () => {
  withWatcherDb((db) => {
    const now = "2026-07-03T20:05:00.000Z";
    const spec = finalMessageWatchSpec();

    persistWatcherObservations(db, [spec], { now });
    persistWatcherObservations(db, [spec], { now });

    const events = getWatcherEvents(db, { now, targetRef: spec.targetRef, limit: 10 });
    assert.equal(events.summary.total, 1);
    assert.equal(events.summary.queueItems, 1);
    assert.equal(events.omitted.reason, "none");
  });
});

test("watcher persistence sanitizes raw paths tokens and transcript canaries before cache writes", () => {
  withWatcherDb((db) => {
    const npmTokenCanary = `npm_${"A".repeat(36)}`;
    const githubTokenCanary = `ghp_${"B".repeat(36)}`;
    const unsafeSpec = finalMessageWatchSpec({
      watchId: "/Users/lume/private/watch-id",
      targetRef: "/Users/lume/.codex/sessions/private-thread.jsonl",
      stopConditions: ["cat /Users/lume/private/customer.txt", npmTokenCanary],
      evidenceIds: [githubTokenCanary, "/Users/lume/private/evidence.txt"],
      observed: {
        finalMessageCount: 1,
        threadStatus: "PRIVATE_CANARY_TOKEN in /Users/lume/private/customer.txt"
      }
    });

    persistWatcherObservations(db, [unsafeSpec], { now: "2026-07-03T20:05:00.000Z" });
    const publicReport = getWatcherEvents(db, { now: "2026-07-03T20:05:00.000Z", limit: 10 });
    const cacheRows = db.prepare(`
      SELECT spec_json AS value FROM watcher_specs
      UNION ALL SELECT observation_json AS value FROM watcher_observations
      UNION ALL SELECT COALESCE(tool_call_json, '') AS value FROM attention_queue
      UNION ALL SELECT source_refs_json AS value FROM attention_queue
      UNION ALL SELECT reason_codes_json AS value FROM attention_queue
    `).all() as Array<{ value: string }>;
    const joined = JSON.stringify({ publicReport, cacheRows });

    assert.doesNotMatch(joined, /PRIVATE_CANARY/);
    assert.doesNotMatch(joined, /npm_[A-Za-z0-9]{20,}/);
    assert.doesNotMatch(joined, /ghp_[A-Za-z0-9_]+/);
    assert.doesNotMatch(joined, /\/Users\/lume\/\.codex\/sessions/);
    assert.doesNotMatch(joined, /\/Users\/lume\/private/);
    assert.equal(publicReport.observations[0]?.targetRef.startsWith("target_"), true);
    assert.equal(publicReport.queue[0]?.execute, false);
  });
});

test("watcher persistence keeps underscore-like watch ids from deleting or over-reading neighbors", () => {
  withWatcherDb((db) => {
    const now = "2026-07-03T20:05:00.000Z";
    const targetRef = "codex_thread:019f-watcher-shared";
    const first = finalMessageWatchSpec({
      watchId: "watch_final_message",
      targetRef,
      evidenceIds: ["ev_first"]
    });
    const second = finalMessageWatchSpec({
      watchId: "watchXfinal_message",
      targetRef,
      evidenceIds: ["ev_second"]
    });

    persistWatcherObservations(db, [first, second], { now });
    assert.equal(getWatcherEvents(db, { now, targetRef, limit: 10 }).summary.queueItems, 2);

    persistWatcherObservations(db, [first], { now });
    const allEvents = getWatcherEvents(db, { now, targetRef, limit: 10 });
    assert.equal(allEvents.summary.queueItems, 2);

    const firstEvents = getWatcherEvents(db, { now, targetRef, watchId: first.watchId, limit: 10 });
    assert.equal(firstEvents.summary.queueItems, 1);
    assert.equal(firstEvents.queue[0]?.sourceRefs.includes(`watcher:${first.watchId}`), true);
    assert.equal(firstEvents.queue[0]?.sourceRefs.includes(`watcher:${second.watchId}`), false);
  });
});

test("watcher event coverage reports unknown when every observation row is filtered unsafe", () => {
  withWatcherDb((db) => {
    db.prepare(`
      INSERT INTO watcher_observations (
        observation_id, watch_id, target_ref, observation_json, evidence_refs_json,
        input_hash, privacy_class, confidence, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "unsafe_observation",
      "watch_final_message",
      "codex_thread:019f-watcher-final",
      JSON.stringify({ schema: "lco.watcherState.v1", kind: "not_a_real_kind", status: "triggered" }),
      JSON.stringify(["ev_unsafe"]),
      "hash_unsafe",
      "public_safe_metadata",
      0.9,
      "2026-07-03T20:05:00.000Z",
      "2026-07-03T20:05:00.000Z"
    );

    const events = getWatcherEvents(db, { now: "2026-07-03T20:05:00.000Z", limit: 10 });
    assert.equal(events.summary.total, 0);
    assert.equal(events.summary.filteredUnsafeRows, 1);
    assert.equal(events.sourceCoverage.watcherObservations, "unknown");
  });
});

test("watcher events report omitted queue items when queue output is limited", () => {
  withWatcherDb((db) => {
    const now = "2026-07-03T20:05:00.000Z";
    const targetRef = "codex_thread:019f-watcher-limit";
    persistWatcherObservations(db, [
      finalMessageWatchSpec({ watchId: "watch_alpha", targetRef, evidenceIds: ["ev_alpha"] }),
      finalMessageWatchSpec({ watchId: "watch_beta", targetRef, evidenceIds: ["ev_beta"] }),
      finalMessageWatchSpec({ watchId: "watch_gamma", targetRef, evidenceIds: ["ev_gamma"] })
    ], { now });

    const events = getWatcherEvents(db, { now, targetRef, limit: 1 });
    assert.equal(events.observations.length, 1);
    assert.equal(events.queue.length, 1);
    assert.equal(events.omitted.reason, "limit");
    assert.equal(events.omitted.observationLimitCount, 2);
    assert.equal(events.omitted.queueLimitCount, 2);
    assert.equal(events.omitted.limitCount, 4);
    assert.equal(events.omitted.count, 4);
    assert.equal(events.sourceCoverage.attentionQueue, "ok");
  });
});

test("watcher persistence fails closed when a watcher attempts mutation", () => {
  withWatcherDb((db) => {
    assert.throws(
      () => persistWatcherObservations(db, [{ ...finalMessageWatchSpec(), mutates: true } as unknown as WatchSpec], {
        now: "2026-07-03T20:05:00.000Z"
      }),
      /mutates=false/
    );
    const rows = db.prepare("SELECT COUNT(*) AS count FROM watcher_observations").get() as { count: number };
    assert.equal(rows.count, 0);
  });
});

test("MCP exposes persisted watcher events as a read-only public-safe tool", async () => {
  await withWatcherDb(async (db) => {
    persistWatcherObservations(db, [finalMessageWatchSpec()], { now: "2026-07-03T20:05:00.000Z" });
    const tools = createLooTools({
      db,
      audit: {
        path: "metadata-only",
        append() {
          throw new Error("unexpected audit write");
        },
        find() {
          return null;
        },
        tail() {
          return [];
        },
        fingerprintText() {
          return "metadata-only";
        },
        fingerprintValue() {
          return "metadata-only";
        }
      },
      codexClient: {
        async request() {
          throw new Error("unexpected Codex request");
        }
      }
    });
    const tool = tools.find((candidate) => candidate.name === "loo_watcher_events");
    assert.ok(tool);
    assert.equal(tool.safety.mode, "read_only");
    assert.deepEqual(tool.safety.mutationClasses, []);
    const report = await tool.execute({ limit: 5, now: "2026-07-03T20:05:00.000Z" });
    assert.equal((report as { publicSafe?: boolean }).publicSafe, true);
    assert.equal((report as { summary?: { queueItems?: number } }).summary?.queueItems, 1);
  });
});
