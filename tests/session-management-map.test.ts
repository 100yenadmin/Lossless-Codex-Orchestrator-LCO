import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createAuditStore } from "../packages/adapters/src/index.js";
import {
  createDatabase,
  getCodexSessionManagementMap,
  indexCodexSessions
} from "../packages/core/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
const cliEntry = fileURLToPath(new URL("../packages/cli/src/index.ts", import.meta.url));

type FixtureSession = {
  id: string;
  title: string;
  status: string;
  priority: string;
  blocker?: string;
  nextAction: string;
  refs?: boolean;
  updatedAt?: string;
};

test("session management map answers active blocked expansion archive fork and resume lanes from 20 metadata-only sessions", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-session-management-map-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });

  const fixtures: FixtureSession[] = [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `019f-active-${index}`,
      title: `Active implementation ${index}`,
      status: "active",
      priority: index === 0 ? "urgent" : "high",
      nextAction: "continue implementation after bounded review",
      refs: true
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `019f-blocked-${index}`,
      title: `Blocked review ${index}`,
      status: "blocked",
      priority: index === 0 ? "urgent" : "medium",
      blocker: "CodeRabbit approval pending",
      nextAction: "wait for review gate",
      refs: true
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `019f-expand-${index}`,
      title: `Needs expansion ${index}`,
      status: "active",
      priority: "medium",
      nextAction: "expand metadata brief before choosing action"
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `019f-archive-${index}`,
      title: `Completed archive candidate ${index}`,
      status: "complete",
      priority: "low",
      nextAction: "archive after release evidence is linked",
      refs: true
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      id: `019f-fork-${index}`,
      title: `Fork candidate ${index}`,
      status: "needs-fork",
      priority: "high",
      nextAction: "fork into release hardening lane",
      refs: true
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      id: `019f-resume-${index}`,
      title: `Resume candidate ${index}`,
      status: "paused",
      priority: "high",
      nextAction: "resume with a harmless dry-run prompt",
      refs: true
    }))
  ];

  for (const fixture of fixtures) writeSessionFixture(sessions, fixture);

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 25 });

    const map = getCodexSessionManagementMap(db, {
      project: "lossless-openclaw-orchestrator",
      limit: 50,
      priorityOrder: ["urgent", "high", "medium", "low"]
    });

    assert.equal(map.publicSafe, true);
    assert.equal(map.dryRun, true);
    assert.equal(map.mutatesCodex, false);
    assert.deepEqual(map.liveControlRequires, ["dry_run", "approval_audit_id"]);
    assert.deepEqual(map.summary, {
      total: 20,
      active: 5,
      blocked: 4,
      needsExpansion: 3,
      safeToArchive: 4,
      shouldFork: 2,
      shouldResume: 2
    });

    assert.deepEqual(map.groups.activeWork.map((entry) => entry.threadId), [
      "019f-active-0",
      "019f-active-1",
      "019f-active-2",
      "019f-active-3",
      "019f-active-4"
    ]);
    assert.equal(map.groups.blockedWork[0]?.threadId, "019f-blocked-0");
    assert.equal(map.groups.blockedWork[0]?.reason, "blocked: CodeRabbit approval pending");
    assert.deepEqual(map.groups.needsExpansion.map((entry) => entry.threadId), [
      "019f-expand-0",
      "019f-expand-1",
      "019f-expand-2"
    ]);
    assert.deepEqual(map.groups.safeToArchive.map((entry) => entry.threadId), [
      "019f-archive-0",
      "019f-archive-1",
      "019f-archive-2",
      "019f-archive-3"
    ]);
    assert.deepEqual(map.groups.shouldFork.map((entry) => entry.threadId), ["019f-fork-0", "019f-fork-1"]);
    assert.deepEqual(map.groups.shouldResume.map((entry) => entry.threadId), ["019f-resume-0", "019f-resume-1"]);

    const recommendationCounts = map.recommendations.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.action] = (counts[entry.action] ?? 0) + 1;
      return counts;
    }, {});
    assert.equal(recommendationCounts.expand, 3);
    assert.equal(recommendationCounts.archive, 4);
    assert.equal(recommendationCounts.fork, 2);
    assert.equal(recommendationCounts.resume, 2);

    const resume = map.recommendations.find((entry) => entry.action === "resume");
    assert.equal(resume?.sourceRef, "codex_thread:019f-resume-0");
    assert.equal(resume?.targetTool, "loo_codex_resume_thread");
    assert.equal(resume?.requiresDryRun, true);
    assert.equal(resume?.requiresApproval, true);
    assert.equal(resume?.approvalAuditIdRequired, true);

    const expand = map.recommendations.find((entry) => entry.action === "expand");
    assert.equal(expand?.targetTool, "loo_expand_session");
    assert.equal(expand?.requiresDryRun, false);
    assert.equal(expand?.requiresApproval, false);
    assertNoTranscriptFields(map);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session management map is available through MCP tools and CLI without raw transcripts", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-session-management-map-public-"));
  const sessions = join(root, "sessions");
  const dbPath = join(root, "orchestrator.sqlite");
  mkdirSync(sessions, { recursive: true });

  for (const fixture of [
    {
      id: "019f-public-active",
      title: "Public active lane",
      status: "active",
      priority: "urgent",
      nextAction: "continue implementation after bounded review",
      refs: true
    },
    {
      id: "019f-public-blocked",
      title: "Public blocked lane",
      status: "blocked",
      priority: "high",
      blocker: "external review pending",
      nextAction: "wait for review gate",
      refs: true
    },
    {
      id: "019f-public-expand",
      title: "Public expansion lane",
      status: "active",
      priority: "medium",
      nextAction: "expand metadata brief before choosing action"
    },
    {
      id: "019f-public-resume",
      title: "Public resume lane",
      status: "paused",
      priority: "high",
      nextAction: "resume with a harmless dry-run prompt",
      refs: true
    }
  ] satisfies FixtureSession[]) {
    writeSessionFixture(sessions, fixture);
  }

  const db = createDatabase(dbPath);
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    const tools = createLooTools({
      db,
      audit: createAuditStore(join(root, "audit.jsonl")),
      codexClient: { request: async () => ({ ok: true }) }
    });
    const mapTool = tools.find((tool) => tool.name === "loo_codex_session_management_map");
    assert.ok(mapTool);
    const toolMap = await mapTool.execute({
      project: "lossless-openclaw-orchestrator",
      limit: 10,
      priority_order: ["urgent", "high", "medium", "low"]
    }) as ReturnType<typeof getCodexSessionManagementMap>;

    assert.equal(toolMap.publicSafe, true);
    assert.equal(toolMap.dryRun, true);
    assert.equal(toolMap.mutatesCodex, false);
    assert.deepEqual(toolMap.summary, {
      total: 4,
      active: 1,
      blocked: 1,
      needsExpansion: 1,
      safeToArchive: 0,
      shouldFork: 0,
      shouldResume: 1
    });
    assert.equal(toolMap.recommendations.some((entry) => entry.targetTool === "loo_codex_resume_thread" && entry.requiresApproval), true);

    const cliResult = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      cliEntry,
      "session-map",
      "--project",
      "lossless-openclaw-orchestrator",
      "--limit",
      "10",
      "--priority-order",
      "urgent,high,medium,low"
    ], {
      cwd: root,
      env: { ...process.env, LOO_DB_PATH: dbPath },
      encoding: "utf8",
      timeout: 15_000
    });
    assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);
    const cliMap = JSON.parse(cliResult.stdout) as ReturnType<typeof getCodexSessionManagementMap>;
    assert.equal(cliMap.publicSafe, true);
    assert.equal(cliMap.summary.total, 4);
    assert.deepEqual(cliMap.groups.blockedWork.map((entry) => entry.threadId), ["019f-public-blocked"]);
    assertNoTranscriptFields(cliMap);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session management map emits one primary recommendation per thread and uses recency for stale paused work", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-session-management-exclusive-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });

  const fixtures: FixtureSession[] = [
    {
      id: "019f-complete-missing-refs",
      title: "Complete without refs",
      status: "complete",
      priority: "high",
      nextAction: "archive after closeout",
      updatedAt: "2026-06-29T12:00:00.000Z"
    },
    {
      id: "019f-paused-old-archive",
      title: "Old paused archive",
      status: "paused",
      priority: "high",
      nextAction: "archive after stale review",
      refs: true,
      updatedAt: "2025-01-01T00:00:00.000Z"
    },
    {
      id: "019f-paused-fresh-resume",
      title: "Fresh paused resume",
      status: "paused",
      priority: "high",
      nextAction: "resume with bounded prompt",
      refs: true,
      updatedAt: "2026-06-29T11:00:00.000Z"
    },
    {
      id: "019f-high-older-active",
      title: "Older active",
      status: "active",
      priority: "high",
      nextAction: "continue implementation after bounded review",
      refs: true,
      updatedAt: "2026-06-29T09:00:00.000Z"
    },
    {
      id: "019f-high-newer-active",
      title: "Newer active",
      status: "active",
      priority: "high",
      nextAction: "continue implementation after bounded review",
      refs: true,
      updatedAt: "2026-06-29T10:00:00.000Z"
    },
    {
      id: "019f-active-expand",
      title: "Active expansion needed",
      status: "active",
      priority: "medium",
      nextAction: "expand metadata brief before choosing action",
      updatedAt: "2026-06-29T08:00:00.000Z"
    }
  ];

  for (const fixture of fixtures) writeSessionFixture(sessions, fixture);

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });

    const map = getCodexSessionManagementMap(db, {
      project: "lossless-openclaw-orchestrator",
      limit: 20,
      priorityOrder: ["high", "medium"]
    });

    assert.deepEqual(map.groups.activeWork.map((entry) => entry.threadId), [
      "019f-high-newer-active",
      "019f-high-older-active"
    ]);
    assert.deepEqual(map.groups.needsExpansion.map((entry) => entry.threadId), ["019f-active-expand"]);
    assert.deepEqual(map.groups.safeToArchive.map((entry) => entry.threadId), [
      "019f-complete-missing-refs",
      "019f-paused-old-archive"
    ]);
    assert.deepEqual(map.groups.shouldResume.map((entry) => entry.threadId), ["019f-paused-fresh-resume"]);

    const recommendationsByRef = new Map<string, string[]>();
    for (const recommendation of map.recommendations) {
      const actions = recommendationsByRef.get(recommendation.sourceRef) ?? [];
      actions.push(recommendation.action);
      recommendationsByRef.set(recommendation.sourceRef, actions);
    }
    for (const [sourceRef, actions] of recommendationsByRef) {
      assert.equal(actions.length, 1, `${sourceRef} had conflicting recommendations: ${actions.join(",")}`);
    }
    assert.deepEqual(recommendationsByRef.get("codex_thread:019f-complete-missing-refs"), ["archive"]);
    assert.deepEqual(recommendationsByRef.get("codex_thread:019f-paused-old-archive"), ["archive"]);
    assert.deepEqual(recommendationsByRef.get("codex_thread:019f-paused-fresh-resume"), ["resume"]);
    assert.deepEqual(recommendationsByRef.get("codex_thread:019f-active-expand"), ["expand"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function writeSessionFixture(root: string, fixture: FixtureSession): void {
  const updatedAt = fixture.updatedAt ?? "2026-06-29T00:00:00.000Z";
  const refs = fixture.refs === true
    ? [
        `Proposed plan refs: codex_event:${fixture.id}-plan`,
        `Final-message refs: codex_event:${fixture.id}-final`,
        `Touched-file refs: codex_event:${fixture.id}-file`
      ]
    : [];
  const lines = [
    {
      timestamp: updatedAt,
      session_meta: {
        payload: {
          id: fixture.id,
          cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator",
          model: "gpt-5.5",
          git: { branch: "main", commit_hash: "abc1234" }
        }
      }
    },
    { timestamp: updatedAt, event_msg: { type: "thread_name", name: fixture.title } },
    {
      timestamp: updatedAt,
      event_msg: {
        type: "agent_message",
        message: [
          "Project: lossless-openclaw-orchestrator",
          `Status: ${fixture.status}`,
          `Priority: ${fixture.priority}`,
          "Owner: codex",
          `Blocker: ${fixture.blocker ?? "none"}`,
          `Next action: ${fixture.nextAction}`,
          "Closeout state: ready",
          ...refs,
          `Source refs: codex_thread:${fixture.id}`
        ].join("\n")
      }
    }
  ];
  writeFileSync(join(root, `rollout-2026-06-29T00-00-00-${fixture.id}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

function assertNoTranscriptFields(value: unknown, path = "root"): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) assertNoTranscriptFields(value[index], `${path}[${index}]`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assert.equal(/transcript/i.test(key), false, `${path}.${key} exposes a transcript-like field`);
    assertNoTranscriptFields(child, `${path}.${key}`);
  }
}
