import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  createDatabase,
  describeRecallRef,
  expandRecallRef,
  expandSession,
  grepRecall,
  harvestRetrievalTelemetry,
  indexClaudeSessionInventory,
  indexCodexSessions,
  searchSessions
} from "../packages/core/src/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtCliPath = join(repoRoot, "dist/packages/cli/src/index.js");

function runBuiltLoo(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  assert.equal(existsSync(builtCliPath), true, "Run `npm run build` before retrieval telemetry CLI tests");
  return spawnSync(process.execPath, [builtCliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: options.env ?? process.env
  });
}

function writeSession(path: string, threadId: string, title: string, body: string): void {
  writeFileSync(path, [
    JSON.stringify({
      session_meta: {
        payload: {
          id: threadId,
          cwd: "/Volumes/LEXAR/repos/lco",
          model: "gpt-5.5"
        }
      }
    }),
    JSON.stringify({ event_msg: { type: "thread_name", name: title } }),
    JSON.stringify({
      response_item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: body }]
      }
    })
  ].join("\n") + "\n");
}

function makeTelemetryFixture() {
  const root = mkdtempSync(join(tmpdir(), "loo-retrieval-telemetry-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  writeSession(
    join(sessions, "rollout-2026-07-06T00-00-00-019f-telemetry-alpha.jsonl"),
    "019f-telemetry-alpha",
    "Telemetry alpha rank target",
    "Alpha proposed plan mentions search expansion telemetry harvest target."
  );
  writeSession(
    join(sessions, "rollout-2026-07-06T00-01-00-019f-telemetry-bravo.jsonl"),
    "019f-telemetry-bravo",
    "Telemetry bravo distractor",
    "Bravo final message mentions telemetry harvest distractor."
  );
  return { root, sessions };
}

test("opt-in search telemetry correlates describe and expand follows with rank", () => {
  const fixture = makeTelemetryFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [fixture.sessions], maxFiles: 10 });

    const results = searchSessions(db, {
      query: "search expansion telemetry harvest target",
      limit: 5,
      telemetry: true,
      telemetrySessionId: "agent-alpha",
      now: "2026-07-06T00:00:00.000Z"
    });
    assert.equal(results[0]?.sourceRef, "codex_thread:019f-telemetry-alpha");

    const described = describeRecallRef(db, {
      sourceRef: "codex_thread:019f-telemetry-alpha",
      telemetry: true,
      telemetrySessionId: "agent-alpha",
      now: "2026-07-06T00:05:00.000Z"
    });
    assert.equal(described?.sourceRef, "codex_thread:019f-telemetry-alpha");

    const expanded = expandRecallRef(db, {
      sourceRef: "codex_thread:019f-telemetry-alpha",
      profile: "metadata",
      telemetry: true,
      telemetrySessionId: "agent-alpha",
      now: "2026-07-06T00:06:00.000Z"
    });
    assert.equal(expanded.sourceRef, "codex_thread:019f-telemetry-alpha");

    const searchRows = db.prepare("SELECT query_text AS queryText, query_hash AS queryHash, result_refs_json AS resultRefsJson FROM telemetry_search_events").all() as Array<{
      queryText: string;
      queryHash: string;
      resultRefsJson: string;
    }>;
    assert.equal(searchRows.length, 1);
    assert.equal(searchRows[0]?.queryText, "search expansion telemetry harvest target");
    assert.match(searchRows[0]?.queryHash ?? "", /^[a-f0-9]{64}$/);
    assert.deepEqual(JSON.parse(searchRows[0]?.resultRefsJson ?? "[]").slice(0, 1), ["codex_thread:019f-telemetry-alpha"]);

    const followRows = db.prepare("SELECT chosen_ref AS chosenRef, rank_position AS rankPosition, follow_kind AS followKind FROM telemetry_follow_events ORDER BY ts").all()
      .map((row) => ({ ...(row as Record<string, unknown>) }));
    assert.deepEqual(followRows, [
      { chosenRef: "codex_thread:019f-telemetry-alpha", rankPosition: 1, followKind: "describe" },
      { chosenRef: "codex_thread:019f-telemetry-alpha", rankPosition: 1, followKind: "expand" }
    ]);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("LOO_TELEMETRY env records one follow event per recall action", () => {
  const fixture = makeTelemetryFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  const originalTelemetry = process.env.LOO_TELEMETRY;
  process.env.LOO_TELEMETRY = "1";
  try {
    indexCodexSessions(db, { roots: [fixture.sessions], maxFiles: 10 });

    const results = searchSessions(db, {
      query: "search expansion telemetry harvest target",
      limit: 5,
      telemetrySessionId: "env-agent-alpha",
      now: "2026-07-06T00:00:00.000Z"
    });
    assert.equal(results[0]?.sourceRef, "codex_thread:019f-telemetry-alpha");

    describeRecallRef(db, {
      sourceRef: "codex_thread:019f-telemetry-alpha",
      telemetrySessionId: "env-agent-alpha",
      now: "2026-07-06T00:05:00.000Z"
    });
    expandRecallRef(db, {
      sourceRef: "codex_thread:019f-telemetry-alpha",
      profile: "metadata",
      telemetrySessionId: "env-agent-alpha",
      now: "2026-07-06T00:06:00.000Z"
    });

    const followRows = db.prepare("SELECT chosen_ref AS chosenRef, rank_position AS rankPosition, follow_kind AS followKind FROM telemetry_follow_events ORDER BY ts").all()
      .map((row) => ({ ...(row as Record<string, unknown>) }));
    assert.deepEqual(followRows, [
      { chosenRef: "codex_thread:019f-telemetry-alpha", rankPosition: 1, followKind: "describe" },
      { chosenRef: "codex_thread:019f-telemetry-alpha", rankPosition: 1, followKind: "expand" }
    ]);
  } finally {
    if (originalTelemetry === undefined) {
      delete process.env.LOO_TELEMETRY;
    } else {
      process.env.LOO_TELEMETRY = originalTelemetry;
    }
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("search telemetry is off by default and ignores follows outside the correlation window", () => {
  const fixture = makeTelemetryFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [fixture.sessions], maxFiles: 10 });

    searchSessions(db, {
      query: "search expansion telemetry harvest target",
      limit: 5,
      now: "2026-07-06T00:00:00.000Z"
    });
    searchSessions(db, {
      query: "search expansion telemetry harvest target",
      limit: 5,
      telemetry: true,
      now: "2026-07-06T00:01:00.000Z"
    });
    describeRecallRef(db, {
      sourceRef: "codex_thread:019f-telemetry-alpha",
      telemetry: true,
      now: "2026-07-06T00:05:00.000Z"
    });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM telemetry_search_events").get() as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM telemetry_follow_events").get() as { count: number }).count, 0);

    searchSessions(db, {
      query: "search expansion telemetry harvest target",
      limit: 5,
      telemetry: true,
      telemetrySessionId: "agent-expired",
      now: "2026-07-06T00:00:00.000Z"
    });
    describeRecallRef(db, {
      sourceRef: "codex_thread:019f-telemetry-alpha",
      telemetry: true,
      telemetrySessionId: "agent-expired",
      now: "2026-07-06T00:16:01.000Z"
    });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM telemetry_search_events").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM telemetry_follow_events").get() as { count: number }).count, 0);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("expand telemetry records one expand follow without an internal describe follow", () => {
  const fixture = makeTelemetryFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [fixture.sessions], maxFiles: 10 });
    searchSessions(db, {
      query: "search expansion telemetry harvest target",
      limit: 5,
      telemetry: true,
      telemetrySessionId: "agent-expand-only",
      now: "2026-07-06T00:00:00.000Z"
    });

    expandRecallRef(db, {
      sourceRef: "codex_thread:019f-telemetry-alpha",
      profile: "metadata",
      telemetry: true,
      telemetrySessionId: "agent-expand-only",
      now: "2026-07-06T00:02:00.000Z"
    });

    const followRows = db.prepare("SELECT follow_kind AS followKind, COUNT(*) AS count FROM telemetry_follow_events GROUP BY follow_kind ORDER BY follow_kind").all()
      .map((row) => ({ ...(row as Record<string, unknown>) }));
    assert.deepEqual(followRows, [{ followKind: "expand", count: 1 }]);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("direct expandSession telemetry records one expand follow without an internal describe follow", () => {
  const fixture = makeTelemetryFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [fixture.sessions], maxFiles: 10 });
    searchSessions(db, {
      query: "search expansion telemetry harvest target",
      limit: 5,
      telemetry: true,
      telemetrySessionId: "agent-expand-session",
      now: "2026-07-06T00:00:00.000Z"
    });

    expandSession(db, {
      threadId: "019f-telemetry-alpha",
      profile: "metadata",
      telemetry: true,
      telemetrySessionId: "agent-expand-session",
      now: "2026-07-06T00:02:00.000Z"
    });

    const followRows = db.prepare("SELECT follow_kind AS followKind, COUNT(*) AS count FROM telemetry_follow_events GROUP BY follow_kind ORDER BY follow_kind").all()
      .map((row) => ({ ...(row as Record<string, unknown>) }));
    assert.deepEqual(followRows, [{ followKind: "expand", count: 1 }]);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("LOO_TELEMETRY env direct expandSession records one expand follow without an internal describe follow", () => {
  const fixture = makeTelemetryFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  const originalTelemetry = process.env.LOO_TELEMETRY;
  const originalSession = process.env.LOO_TELEMETRY_SESSION_ID;
  process.env.LOO_TELEMETRY = "1";
  delete process.env.LOO_TELEMETRY_SESSION_ID;
  try {
    indexCodexSessions(db, { roots: [fixture.sessions], maxFiles: 10 });
    searchSessions(db, {
      query: "search expansion telemetry harvest target",
      limit: 5,
      now: "2026-07-06T00:00:00.000Z"
    });

    expandSession(db, {
      threadId: "019f-telemetry-alpha",
      profile: "metadata",
      now: "2026-07-06T00:02:00.000Z"
    });

    const searchCount = (db.prepare("SELECT COUNT(*) AS count FROM telemetry_search_events").get() as { count: number }).count;
    const followRows = db.prepare("SELECT follow_kind AS followKind, COUNT(*) AS count FROM telemetry_follow_events GROUP BY follow_kind ORDER BY follow_kind").all()
      .map((row) => ({ ...(row as Record<string, unknown>) }));
    assert.equal(searchCount, 1);
    assert.deepEqual(followRows, [{ followKind: "expand", count: 1 }]);
  } finally {
    if (originalTelemetry === undefined) {
      delete process.env.LOO_TELEMETRY;
    } else {
      process.env.LOO_TELEMETRY = originalTelemetry;
    }
    if (originalSession === undefined) {
      delete process.env.LOO_TELEMETRY_SESSION_ID;
    } else {
      process.env.LOO_TELEMETRY_SESSION_ID = originalSession;
    }
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Claude recall telemetry correlates describe and expand follows with rank", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-retrieval-telemetry-claude-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexClaudeSessionInventory(db, {
      sessions: [{
        sessionId: "claude-telemetry-1",
        title: "Claude telemetry recall proof",
        project: "Lossless OpenClaw Orchestrator",
        workspaceHint: "lossless-openclaw-orchestrator",
        status: "fixture-only",
        safeSummary: "Claude telemetry branch coverage for recall follow correlation.",
        updatedAt: "2026-07-06T00:00:00.000Z",
        sourcePath: "/Users/lume/private/claude-telemetry.sqlite"
      }]
    });

    const grep = grepRecall(db, {
      query: "Claude telemetry branch coverage",
      limit: 5,
      telemetry: true,
      telemetrySessionId: "agent-claude",
      now: "2026-07-06T00:00:00.000Z"
    });
    assert.equal(grep.matches[0]?.sourceRef, "claude_session:claude-telemetry-1");

    describeRecallRef(db, {
      sourceRef: "claude_session:claude-telemetry-1",
      telemetry: true,
      telemetrySessionId: "agent-claude",
      now: "2026-07-06T00:01:00.000Z"
    });
    expandRecallRef(db, {
      sourceRef: "claude_session:claude-telemetry-1",
      profile: "metadata",
      telemetry: true,
      telemetrySessionId: "agent-claude",
      now: "2026-07-06T00:02:00.000Z"
    });

    const followRows = db.prepare(`
      SELECT f.chosen_ref AS chosenRef, f.rank_position AS rankPosition, f.follow_kind AS followKind
      FROM telemetry_follow_events f
      JOIN telemetry_search_events s ON s.id = f.search_event_id
      ORDER BY f.ts ASC
    `).all().map((row) => ({ ...(row as Record<string, unknown>) }));
    assert.deepEqual(followRows, [
      { chosenRef: "claude_session:claude-telemetry-1", rankPosition: 1, followKind: "describe" },
      { chosenRef: "claude_session:claude-telemetry-1", rankPosition: 1, followKind: "expand" }
    ]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("retrieval telemetry harvest proposes local non-public-safe scenarios and public-safe aggregate metrics", () => {
  const fixture = makeTelemetryFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [fixture.sessions], maxFiles: 10 });
    searchSessions(db, {
      query: "search expansion telemetry harvest target",
      limit: 5,
      telemetry: true,
      telemetrySessionId: "agent-harvest",
      now: "2026-07-06T00:00:00.000Z"
    });
    describeRecallRef(db, {
      sourceRef: "codex_thread:019f-telemetry-alpha",
      telemetry: true,
      telemetrySessionId: "agent-harvest",
      now: "2026-07-06T00:03:00.000Z"
    });
    expandRecallRef(db, {
      sourceRef: "codex_thread:019f-telemetry-alpha",
      profile: "metadata",
      telemetry: true,
      telemetrySessionId: "agent-harvest",
      now: "2026-07-06T00:04:00.000Z"
    });

    const proposalPath = join(fixture.root, "harvest-proposals.json");
    const metricsPath = join(fixture.root, "telemetry-metrics.json");
    const report = harvestRetrievalTelemetry(db, { proposalPath, metricsPath, now: "2026-07-06T00:10:00.000Z" });

    assert.equal(report.publicSafe, true);
    assert.equal(report.proposalFile.publicSafe, false);
    assert.equal(report.proposalFile.requiresManualCuration, true);
    assert.equal(report.metricsFile?.publicSafe, true);
    assert.equal(report.summary.proposedScenarios, 1);

    const proposal = JSON.parse(readFileSync(proposalPath, "utf8")) as {
      publicSafe?: boolean;
      requiresManualCuration?: boolean;
      doNotCommit?: boolean;
      rawQueryTextIncluded?: boolean;
      scenarios?: Array<{ publicSafe?: boolean; requiresManualCuration?: boolean; redactionRequired?: boolean; query?: string; expectedSourceRefs?: string[]; observedRank?: number; followKinds?: string[]; occurrenceCount?: number }>;
    };
    assert.equal(proposal.publicSafe, false);
    assert.equal(proposal.requiresManualCuration, true);
    assert.equal(proposal.doNotCommit, true);
    assert.equal(proposal.rawQueryTextIncluded, true);
    assert.deepEqual(proposal.scenarios, [{
      id: "harvested-query-1",
      publicSafe: false,
      requiresManualCuration: true,
      redactionRequired: true,
      query: "search expansion telemetry harvest target",
      queryHash: sha256("search expansion telemetry harvest target"),
      expectedSourceRefs: ["codex_thread:019f-telemetry-alpha"],
      observedRank: 1,
      followKinds: ["describe", "expand"],
      occurrenceCount: 2
    }]);

    const metricsText = readFileSync(metricsPath, "utf8");
    assert.doesNotMatch(metricsText, /search expansion telemetry harvest target/);
    const metrics = JSON.parse(metricsText) as { publicSafe?: boolean; metrics?: { rankDistribution?: Record<string, number>; topMissQueries?: unknown[] } };
    assert.equal(metrics.publicSafe, true);
    assert.deepEqual(metrics.metrics?.rankDistribution, { "1": 1 });
    assert.deepEqual(metrics.metrics?.topMissQueries, []);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("retrieval telemetry harvest rejects private proposal output inside a git checkout", () => {
  const fixture = makeTelemetryFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    assert.throws(
      () => harvestRetrievalTelemetry(db, {
        proposalPath: join(repoRoot, ".tmp-telemetry-harvest-proposal.json"),
        metricsPath: join(fixture.root, "telemetry-metrics.json"),
        now: "2026-07-06T00:10:00.000Z"
      }),
      /Telemetry harvest proposal files include private query text and must be written outside git checkouts/
    );
    assert.equal(existsSync(join(repoRoot, ".tmp-telemetry-harvest-proposal.json")), false);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("retrieval telemetry follows require a matching telemetry session key", () => {
  const fixture = makeTelemetryFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [fixture.sessions], maxFiles: 10 });
    searchSessions(db, {
      query: "search expansion telemetry harvest target",
      limit: 5,
      telemetry: true,
      telemetrySessionId: "agent-a",
      now: "2026-07-06T00:00:00.000Z"
    });
    searchSessions(db, {
      query: "telemetry",
      limit: 5,
      telemetry: true,
      telemetrySessionId: "agent-b",
      now: "2026-07-06T00:01:00.000Z"
    });

    describeRecallRef(db, {
      sourceRef: "codex_thread:019f-telemetry-alpha",
      telemetry: true,
      telemetrySessionId: "agent-a",
      now: "2026-07-06T00:02:00.000Z"
    });
    describeRecallRef(db, {
      sourceRef: "codex_thread:019f-telemetry-alpha",
      telemetry: true,
      now: "2026-07-06T00:03:00.000Z"
    });

    const rows = db.prepare(`
      SELECT s.query_text AS queryText, f.rank_position AS rankPosition, f.follow_kind AS followKind
      FROM telemetry_follow_events f
      JOIN telemetry_search_events s ON s.id = f.search_event_id
      ORDER BY f.ts ASC
    `).all().map((row) => ({ ...(row as Record<string, unknown>) }));
    assert.deepEqual(rows, [{
      queryText: "search expansion telemetry harvest target",
      rankPosition: 1,
      followKind: "describe"
    }]);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("public telemetry miss metrics do not expose stable per-query hashes", () => {
  const fixture = makeTelemetryFixture();
  const db = createDatabase(join(fixture.root, "orchestrator.sqlite"));
  try {
    const privateQuery = "ssn 1234 private miss query";
    db.prepare(`
      INSERT INTO telemetry_search_events (
        id, ts, query_text, query_hash, telemetry_session_key, result_refs_json, matched_field_distribution_json, engine_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "manual-search-private-miss",
      "2026-07-06T00:00:00.000Z",
      privateQuery,
      sha256(privateQuery),
      sha256("manual-session"),
      JSON.stringify(["codex_thread:a", "codex_thread:b", "codex_thread:c", "codex_thread:d", "codex_thread:e", "codex_thread:target"]),
      "{}",
      "test"
    );
    db.prepare(`
      INSERT INTO telemetry_follow_events (
        id, ts, search_event_id, chosen_ref, rank_position, follow_kind
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run("manual-follow-private-miss", "2026-07-06T00:01:00.000Z", "manual-search-private-miss", "codex_thread:target", 6, "describe");

    const proposalPath = join(fixture.root, "harvest-proposals.json");
    const metricsPath = join(fixture.root, "telemetry-metrics.json");
    const report = harvestRetrievalTelemetry(db, { proposalPath, metricsPath, now: "2026-07-06T00:10:00.000Z" });
    const metricsText = readFileSync(metricsPath, "utf8");
    const metrics = JSON.parse(metricsText) as { metrics?: { topMissQueries?: Array<Record<string, unknown>> } };

    assert.equal(report.publicSafe, true);
    assert.deepEqual(report.summary, {
      telemetrySearchEvents: 1,
      telemetryFollowEvents: 1,
      proposedScenarios: 1
    });
    assert.equal(metrics.metrics?.topMissQueries?.length, 1);
    assert.equal("queryHash" in (metrics.metrics?.topMissQueries?.[0] ?? {}), false);
    assert.match(String(metrics.metrics?.topMissQueries?.[0]?.missId), /^miss_\d+$/);
    assert.doesNotMatch(metricsText, /ssn 1234|private miss query/);
    assert.doesNotMatch(metricsText, new RegExp(sha256(privateQuery)));
    assert.doesNotMatch(JSON.stringify(report.metrics), new RegExp(sha256(privateQuery)));
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("CLI harvest mode rejects evidence paths and writes no scenario-file output", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-retrieval-harvest-cli-"));
  try {
    const result = runBuiltLoo([
      "eval",
      "retrieval",
      "--harvest",
      join(root, "proposal.json"),
      "--evidence-path",
      join(root, "evidence.json")
    ], {
      env: {
        ...process.env,
        LOO_DB_PATH: join(root, "orchestrator.sqlite")
      }
    });

    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), "");
    assert.match(result.stderr, /^Error: Invalid --harvest: cannot be combined with --evidence-path\n$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI harvest strict mode exits non-zero when no scenarios are proposed", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-retrieval-harvest-strict-"));
  try {
    const result = runBuiltLoo([
      "eval",
      "retrieval",
      "--harvest",
      join(root, "proposal.json"),
      "--metrics-path",
      join(root, "metrics.json"),
      "--now",
      "2026-07-06T00:00:00.000Z",
      "--strict"
    ], {
      env: {
        ...process.env,
        LOO_DB_PATH: join(root, "orchestrator.sqlite")
      }
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as { summary?: { proposedScenarios?: number } };
    assert.equal(report.summary?.proposedScenarios, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
