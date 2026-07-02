import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuditStore } from "../packages/adapters/src/index.js";
import {
  createAttentionInbox,
  createBusinessPulse,
  createCodexActiveThreadState,
  createDatabase,
  createDefaultSourceAuthorityProfile,
  createCodexCollaborationNextSteps,
  createCodexCollaborationCockpit,
  createCodexRuntimeDesktopVisibilityStatus,
  createGithubOperatingItemsReport,
  createPlanStatePinsReport,
  createProjectDigest,
  createResumeRequestPacket,
  createWatcherStatusReport,
  getCockpitInbox,
  getRecentSessions,
  indexCodexSessions,
  type LooDatabase
} from "../packages/core/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";

type SessionFixture = {
  id: string;
  title: string;
  status: string;
  priority: string;
  nextAction: string;
  blocker?: string;
  updatedAt: string;
  refs?: boolean;
  project?: string | null;
  extra?: string[];
};

test("recent session cards are public-safe and do not require query text", () => {
  withIndexedSessions((sessions) => {
    const rawPathCanary = join(sessions, "rollout-2026-07-01T00-00-00-019f-recent-active.jsonl");
    const linuxCodexPathCanary = "/home/alice/.codex/sessions/rollout-private.jsonl";
    return {
      fixtures: [
        {
          id: "019f-recent-active",
          title: "Autonomy cockpit active lane",
          status: "active",
          priority: "high",
          nextAction: `continue after review from ${linuxCodexPathCanary}`,
          updatedAt: relativeIso(90),
          refs: true,
          project: null,
          extra: [
            `Private path canary ${rawPathCanary}`,
            "authorization: Bearer abcdefghijklmnopqrstuvwxyz"
          ]
        },
        {
          id: "019f-recent-blocked",
          title: "Autonomy cockpit blocked lane",
          status: "blocked",
          priority: "urgent",
          blocker: "CodeRabbit review pending",
          nextAction: "wait for review",
          updatedAt: relativeIso(30),
          refs: true
        }
      ],
      canaries: [rawPathCanary, linuxCodexPathCanary]
    };
  }, ({ db, canaries }) => {
    const report = getRecentSessions(db, { scope: "recent", limit: 10, includeCards: true });
    const activeCard = report.cards.find((card) => card.threadId === "codex_thread:019f-recent-active");

    assert.equal(report.schema, "lco.codex.recentSessions.v1");
    assert.equal(report.publicSafe, true);
    assert.equal(report.queryRequired, false);
    assert.deepEqual(report.cards.map((card) => card.threadId), [
      "codex_thread:019f-recent-blocked",
      "codex_thread:019f-recent-active"
    ]);
    assert.equal(report.cards[0]?.state, "blocked");
    assert.equal(report.cards[0]?.risk.level, "high");
    assert.equal(report.cards[0]?.reasonCodes.includes("blocked"), true);
    assert.equal(report.cards[0]?.hidden.transcriptPath, true);
    assert.equal(activeCard?.scope.repo, null);
    assertNoUnsafeStrings(report, ...canaries);
  });
});

test("cockpit inbox ranks blocked approval and stale work deterministically", () => {
  withIndexedSessions([
    {
      id: "019f-moving",
      title: "Moving lane",
      status: "active",
      priority: "medium",
      nextAction: "continue implementation",
      updatedAt: relativeIso(120),
      refs: true
    },
    {
      id: "019f-needs-approval",
      title: "Approval lane",
      status: "needs_approval",
      priority: "high",
      nextAction: "approve dry-run packet",
      updatedAt: relativeIso(150),
      refs: true
    },
    {
      id: "019f-blocked",
      title: "Blocked lane",
      status: "blocked",
      priority: "urgent",
      blocker: "CI failed",
      nextAction: "inspect failed workflow",
      updatedAt: relativeIso(180),
      refs: true
    },
    {
      id: "019f-low-confidence",
      title: "Sparse lane",
      status: "active",
      priority: "low",
      nextAction: "expand before action",
      updatedAt: relativeIso(60)
    }
  ] satisfies SessionFixture[], ({ db }) => {
    const inbox = getCockpitInbox(db, {
      limit: 10,
      priorityOrder: ["urgent", "high", "medium", "low"]
    });

    assert.equal(inbox.schema, "lco.codex.cockpitInbox.v1");
    assert.equal(inbox.publicSafe, true);
    assert.deepEqual(inbox.items.map((item) => item.card.threadId), [
      "codex_thread:019f-blocked",
      "codex_thread:019f-needs-approval",
      "codex_thread:019f-low-confidence"
    ]);
    assert.deepEqual(inbox.items.map((item) => item.reasonCodes[0]), [
      "blocked",
      "approval_needed",
      "low_confidence"
    ]);
    assert.equal(inbox.items[2]?.card.state, "unknown");
    assert.equal(inbox.items[2]?.card.confidence < 0.7, true);

    const highRisk = getRecentSessions(db, { risk: "high", limit: 10, includeCards: true });
    assert.equal(highRisk.summary.total, highRisk.cards.length);
    assert.equal(highRisk.cards.every((card) => card.risk.level === "high"), true);
  });
});

test("active session scope demotes stale low-confidence blocked residue below current work", () => {
  withIndexedSessions((sessions) => {
    const rawPathCanary = join(sessions, "rollout-2026-07-01T00-00-00-019f-stale-blocked-residue.jsonl");
    return {
      fixtures: [
        {
          id: "019f-stale-blocked-residue",
          title: "Old blocked residue",
          status: "blocked",
          priority: "urgent",
          blocker: "stale private review residue",
          nextAction: `inspect stale local proof ${rawPathCanary}`,
          updatedAt: relativeIso(36 * 60),
          refs: false
        },
        {
          id: "019f-current-running",
          title: "Current running lane",
          status: "running",
          priority: "medium",
          nextAction: "continue current implementation",
          updatedAt: relativeIso(6),
          refs: true
        },
        {
          id: "019f-human-approval",
          title: "Human approval lane",
          status: "needs_approval",
          priority: "high",
          nextAction: "approve dry-run packet",
          updatedAt: relativeIso(8),
          refs: true
        },
        {
          id: "019f-waiting-review",
          title: "Waiting review lane",
          status: "waiting",
          priority: "high",
          nextAction: "wait for terminal review status",
          updatedAt: relativeIso(10),
          refs: true
        }
      ],
      canaries: [rawPathCanary]
    };
  }, ({ db, canaries }) => {
    const active = getRecentSessions(db, { scope: "active", limit: 4, includeCards: true });

    assert.deepEqual(active.cards.map((card) => card.threadId), [
      "codex_thread:019f-human-approval",
      "codex_thread:019f-current-running",
      "codex_thread:019f-waiting-review",
      "codex_thread:019f-stale-blocked-residue"
    ]);
    const staleResidue = active.cards.find((card) => card.threadId === "codex_thread:019f-stale-blocked-residue");
    const running = active.cards.find((card) => card.threadId === "codex_thread:019f-current-running");
    assert.equal(staleResidue?.reasonCodes.includes("stale_low_confidence_blocked"), true);
    assert.equal(running?.reasonCodes.includes("running_state_signal"), true);
    assertNoUnsafeStrings(active, ...canaries);
  });
});

test("active cockpit freshness uses injected clock for deterministic stale state", () => {
  const fixedUpdatedAt = "2026-07-01T00:00:00.000Z";
  const earlyNow = "2026-07-02T00:00:00.000Z";
  const lateNow = "2026-07-10T00:00:00.000Z";
  withIndexedSessions([
    {
      id: "019f-clocked-active",
      title: "Clocked active lane",
      status: "running",
      priority: "high",
      nextAction: "keep watching deterministic lane",
      updatedAt: fixedUpdatedAt,
      refs: true
    }
  ], ({ db }) => {
    const early = getRecentSessions(db, { scope: "active", limit: 5, includeCards: true, now: earlyNow });
    const late = getRecentSessions(db, { scope: "active", limit: 5, includeCards: true, now: lateNow });

    assert.equal(early.generatedAt, earlyNow);
    assert.equal(late.generatedAt, lateNow);
    assert.equal(early.cards[0]?.freshness.ageSeconds, 24 * 60 * 60);
    assert.equal(early.cards[0]?.freshness.stale, false);
    assert.equal(early.cards[0]?.reasonCodes.includes("active_stale"), false);
    assert.equal(late.cards[0]?.freshness.ageSeconds, 9 * 24 * 60 * 60);
    assert.equal(late.cards[0]?.freshness.stale, true);
    assert.equal(late.cards[0]?.reasonCodes.includes("active_stale"), true);

    const inbox = getCockpitInbox(db, { limit: 5, now: lateNow });
    assert.equal(inbox.generatedAt, lateNow);
    assert.equal(inbox.items[0]?.card.reasonCodes.includes("active_stale"), true);

    const cockpit = createCodexCollaborationCockpit(db, { limit: 5, now: lateNow });
    assert.equal(cockpit.generatedAt, lateNow);
    assert.equal(cockpit.lanes[0]?.card.reasonCodes.includes("active_stale"), true);
  });
});

test("watcher primitives are read-only, approval-bounded, and feed cockpit inbox", () => {
  const now = "2026-07-01T12:00:00.000Z";
  withIndexedSessions([
    {
      id: "019f-watch-target",
      title: "Watcher target lane",
      status: "active",
      priority: "high",
      nextAction: "wait for checks",
      updatedAt: "2026-07-01T11:55:00.000Z",
      refs: true
    }
  ], ({ db, sessions }) => {
    const watcherSpecs = [
      {
        schema: "lco.watchSpec.v1",
        watchId: "watch_checks_changed",
        targetRef: "codex_thread:019f-watch-target",
        kind: "pr_checks_changed",
        createdAt: "2026-07-01T11:00:00.000Z",
        lastObservedAt: "2026-07-01T11:58:00.000Z",
        ttlSeconds: 7200,
        stopConditions: ["checks_green", "explicit_cancel"],
        wakeReason: "pr_checks_changed",
        evidenceIds: ["ev_checks"],
        confidence: 0.95,
        mutates: false
      },
      {
        schema: "lco.watchSpec.v1",
        watchId: "watch_no_activity",
        targetRef: "codex_thread:019f-watch-target",
        kind: "no_activity",
        createdAt: "2026-07-01T10:00:00.000Z",
        lastObservedAt: "2026-07-01T10:30:00.000Z",
        ttlSeconds: 14400,
        staleAfterSeconds: 3600,
        stopConditions: ["new_turn_seen", "explicit_cancel"],
        evidenceIds: ["ev_stale"],
        confidence: 0.8,
        mutates: false
      },
      {
        schema: "lco.watchSpec.v1",
        watchId: "watch_expired",
        targetRef: "codex_thread:019f-watch-target",
        kind: "approval_expired",
        createdAt: "2026-07-01T09:00:00.000Z",
        lastObservedAt: "2026-07-01T09:30:00.000Z",
        ttlSeconds: 3600,
        stopConditions: ["approval_renewed", "explicit_cancel"],
        evidenceIds: ["ev_expired"],
        confidence: 0.9,
        mutates: false
      }
    ];

    const status = createWatcherStatusReport(watcherSpecs, { now, limit: 10 });
    assert.equal(status.schema, "lco.watchers.status.v1");
    assert.equal(status.publicSafe, true);
    assert.equal(status.summary.triggered, 1);
    assert.equal(status.summary.stale, 1);
    assert.equal(status.summary.expired, 1);
    assert.equal(status.watchers.every((watcher) => watcher.mutates === false), true);

    const triggered = status.watchers.find((watcher) => watcher.watchId === "watch_checks_changed");
    assert.equal(triggered?.status, "triggered");
    assert.equal(triggered?.reasonCodes.includes("watcher_triggered"), true);

    const packet = createResumeRequestPacket(triggered!, { now, ttlSeconds: 900 });
    assert.equal(packet.schema, "lco.resumeRequestPacket.v1");
    assert.equal(packet.requiresApproval, true);
    assert.equal(packet.mutates, false);
    assert.equal(packet.recommendedAction, "inspect");
    assert.match(packet.approvalBoundary, /no live control/i);
    assert.deepEqual(packet.evidenceIds, ["ev_checks"]);

    const inbox = getCockpitInbox(db, { limit: 5, watcherSpecs, now });
    const watcherItem = inbox.items.find((item) => item.reasonCodes.includes("watcher_triggered"));
    assert.equal(watcherItem?.card.threadId, "codex_thread:019f-watch-target");
    assert.equal(watcherItem?.nextAction.requiresApproval, true);
    assert.equal(watcherItem?.nextAction.kind, "resume");
    assertNoUnsafeStrings({ status, packet, inbox }, sessions);
  });
});

test("watcher status filtering matches public-safe plain and sensitive watch ids", () => {
  const now = "2026-07-01T12:00:00.000Z";
  const sensitiveWatchId = "npm_notarealtokenbutshouldberemoved1234567890";
  const watcherSpecs = [
    {
      schema: "lco.watchSpec.v1" as const,
      watchId: "watch_plain_filter",
      targetRef: "codex_thread:019f-watch-plain",
      kind: "final_message_appeared" as const,
      createdAt: "2026-07-01T11:50:00.000Z",
      lastObservedAt: "2026-07-01T11:55:00.000Z",
      ttlSeconds: 3600,
      stopConditions: ["final_message_seen"],
      confidence: 0.9,
      mutates: false as const,
      observed: { finalMessageCount: 1 }
    },
    {
      schema: "lco.watchSpec.v1" as const,
      watchId: sensitiveWatchId,
      targetRef: "codex_thread:019f-watch-sensitive",
      kind: "review_comment_arrived" as const,
      createdAt: "2026-07-01T11:50:00.000Z",
      lastObservedAt: "2026-07-01T11:55:00.000Z",
      ttlSeconds: 3600,
      stopConditions: ["review_handled", sensitiveWatchId],
      confidence: 0.9,
      mutates: false as const,
      observed: { reviewCommentCount: 1 }
    }
  ];

  const plain = createWatcherStatusReport(watcherSpecs, { now, watchId: "watch_plain_filter" });
  assert.equal(plain.summary.returned, 1);
  assert.equal(plain.watchers[0]?.watchId, "watch_plain_filter");

  const sensitive = createWatcherStatusReport(watcherSpecs, { now, watchId: sensitiveWatchId });
  assert.equal(sensitive.summary.returned, 1);
  assert.match(sensitive.watchers[0]?.watchId ?? "", /^watch_[0-9a-f]{16}$/);
  assert.equal(sensitive.watchers[0]?.targetRef, "codex_thread:019f-watch-sensitive");
  assertNoUnsafeStrings(sensitive, sensitiveWatchId);
});

test("watcher status ignores invalid wake reasons but still allows structured inference", () => {
  const now = "2026-07-01T12:00:00.000Z";
  const invalidWakeReason = "npm_notarealtokenbutshouldnottrigger1234567890";
  const watcherSpecs = [
    {
      schema: "lco.watchSpec.v1" as const,
      watchId: "watch_invalid_wake_only",
      targetRef: "codex_thread:019f-watch-invalid-only",
      kind: "no_activity" as const,
      createdAt: "2026-07-01T11:50:00.000Z",
      lastObservedAt: "2026-07-01T11:55:00.000Z",
      ttlSeconds: 3600,
      staleAfterSeconds: 3600,
      stopConditions: ["explicit_cancel"],
      wakeReason: invalidWakeReason as any,
      confidence: 0.9,
      mutates: false as const
    },
    {
      schema: "lco.watchSpec.v1" as const,
      watchId: "watch_invalid_wake_inferred",
      targetRef: "codex_thread:019f-watch-invalid-inferred",
      kind: "final_message_appeared" as const,
      createdAt: "2026-07-01T11:50:00.000Z",
      lastObservedAt: "2026-07-01T11:55:00.000Z",
      ttlSeconds: 3600,
      stopConditions: ["final_message_seen"],
      wakeReason: invalidWakeReason as any,
      confidence: 0.9,
      mutates: false as const,
      observed: { finalMessageCount: 1 }
    }
  ];

  const status = createWatcherStatusReport(watcherSpecs, { now, limit: 10 });
  const invalidOnly = status.watchers.find((watcher) => watcher.watchId === "watch_invalid_wake_only");
  const inferred = status.watchers.find((watcher) => watcher.watchId === "watch_invalid_wake_inferred");

  assert.equal(invalidOnly?.status, "active");
  assert.equal(invalidOnly?.wakeReason, null);
  assert.equal(invalidOnly?.reasonCodes.some((code) => code.includes(invalidWakeReason)), false);
  assert.equal(inferred?.status, "triggered");
  assert.equal(inferred?.wakeReason, "final_message_appeared");
  assert.equal(inferred?.reasonCodes.includes("watcher_triggered"), true);
  assertNoUnsafeStrings(status, invalidWakeReason);
});

test("PLAN_STATE report extracts only explicit pins and ignores stale prose", () => {
  const report = createPlanStatePinsReport(`
# PLAN_STATE

Random stale prose: customer Alpha is red and should be canonical.

<!-- loo:manual-pin -->
- Project: LCO
- State: yellow
- Summary: Finish public-safe autonomy cockpit contracts.
- Next: Open a PR with focused tests.
- Source: issue#256
<!-- /loo:manual-pin -->

<!-- loo:approval-boundary -->
- No live Codex control or GUI mutation during P0.
<!-- /loo:approval-boundary -->

<!-- loo:exception-ledger -->
- Stripe source is intentionally not configured in P0.
<!-- /loo:exception-ledger -->
`);

  assert.equal(report.schema, "lco.planStatePins.v1");
  assert.equal(report.publicSafe, true);
  assert.equal(report.bootloaderOnly, true);
  assert.equal(report.manualPins.length, 1);
  assert.equal(report.manualPins[0]?.title, "LCO");
  assert.equal(report.manualPins[0]?.summary.includes("autonomy cockpit"), true);
  assert.deepEqual(report.approvalBoundaries, ["No live Codex control or GUI mutation during P0."]);
  assert.deepEqual(report.exceptionLedger, ["Stripe source is intentionally not configured in P0."]);
  assert.equal(JSON.stringify(report).includes("customer Alpha is red"), false);
});

test("GitHub operating item collector maps public-safe PR and issue state for operating picture", () => {
  const report = createGithubOperatingItemsReport([
    {
      repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
      number: 264,
      type: "pull_request",
      title: "deterministic GitHub collector /Volumes/LEXAR/private/raw.jsonl",
      state: "open",
      updatedAt: relativeIso(5),
      checks: { status: "completed", conclusion: "failure", failing: 2, total: 5 },
      reviewDecision: "CHANGES_REQUESTED",
      body: "authorization: Bearer abcdefghijklmnopqrstuvwxyz"
    },
    {
      id: "100yenadmin/Lossless-Codex-Orchestrator-LCO#255",
      type: "issue",
      title: "Eva Operating Picture tracker",
      state: "open",
      updatedAt: "2026-06-20T12:00:00.000Z",
      reviewRequested: true
    },
    {
      id: "100yenadmin/Lossless-Codex-Orchestrator-LCO#200",
      type: "pull_request",
      title: "merged green item",
      state: "closed",
      merged: true,
      updatedAt: relativeIso(1),
      checks: { status: "completed", conclusion: "success", total: 5 }
    }
  ], { now: "2026-07-01T12:00:00.000Z" });

  assert.equal(report.schema, "lco.githubOperatingItems.v1");
  assert.equal(report.publicSafe, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.sourceCoverage.github, "ok");
  assert.equal(report.items.length, 2);
  assert.equal(report.omitted.count, 1);

  const failedPr = report.items.find((item) => item.id.endsWith("#264"));
  assert.equal(failedPr?.kind, "pr");
  assert.equal(failedPr?.state, "red");
  assert.equal(failedPr?.urgency, "high");
  assert.equal(failedPr?.reasonCodes?.includes("ci_failed"), true);
  assert.equal(failedPr?.reasonCodes?.includes("changes_requested"), true);
  assert.match(failedPr?.nextAction ?? "", /Inspect failing GitHub checks/i);

  const staleIssue = report.items.find((item) => item.id.endsWith("#255"));
  assert.equal(staleIssue?.kind, "issue");
  assert.equal(staleIssue?.state, "yellow");
  assert.equal(staleIssue?.reasonCodes?.includes("stale"), true);
  assert.equal(staleIssue?.reasonCodes?.includes("review_requested"), true);

  const root = mkdtempSync(join(tmpdir(), "loo-github-operating-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const digest = createProjectDigest(db, { window: "custom", githubItems: report.items, limit: 5 });
    assert.equal(digest.sourceCoverage.github, "ok");
    assert.equal(digest.cards.some((card) => card.reasonCodes.includes("ci_failed") && card.state === "red"), true);
    assert.equal(digest.signals.some((signal) => signal.subject.kind === "pr"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }

  assertNoUnsafeStrings(report, "/Volumes/LEXAR/private/raw.jsonl", "authorization: Bearer abcdefghijklmnopqrstuvwxyz");
});

test("GitHub operating item collector handles common gh and GraphQL PR shapes", () => {
  const report = createGithubOperatingItemsReport([
    {
      id: "PR_kwDOOpaqueNodeId",
      repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
      number: 265,
      type: "PullRequest",
      title: "GraphQL status rollup failure",
      state: "open",
      updatedAt: relativeIso(10),
      statusCheckRollup: [
        { name: "test", state: "SUCCESS" },
        { name: "CodeQL", state: "FAILURE" }
      ]
    },
    {
      repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
      pullRequestNumber: 266,
      title: "gh JSON requested check state",
      state: "open",
      updatedAt: relativeIso(9),
      checks: [
        { name: "test", status: "REQUESTED" }
      ]
    },
    {
      url: "https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/pull/267",
      title: "URL-only pull request waiting on checks",
      state: "open",
      updatedAt: relativeIso(8),
      statusCheckRollup: [
        { name: "CodeQL", status: "WAITING" }
      ]
    },
    {
      html_url: "https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/268",
      title: "URL-only issue",
      state: "open",
      updatedAt: relativeIso(7)
    }
  ], { now: "2026-07-01T12:00:00.000Z" });

  const failedPr = report.items.find((item) => item.id.endsWith("#265"));
  assert.equal(failedPr?.id, "100yenadmin/Lossless-Codex-Orchestrator-LCO#265");
  assert.equal(failedPr?.kind, "pr");
  assert.equal(failedPr?.state, "red");
  assert.equal(failedPr?.reasonCodes.includes("ci_failed"), true);

  const requestedPr = report.items.find((item) => item.id.endsWith("#266"));
  assert.equal(requestedPr?.kind, "pr");
  assert.equal(requestedPr?.state, "yellow");
  assert.equal(requestedPr?.reasonCodes.includes("checks_pending"), true);

  const urlOnlyPr = report.items.find((item) => item.id.endsWith("#267"));
  assert.equal(urlOnlyPr?.id, "100yenadmin/Lossless-Codex-Orchestrator-LCO#267");
  assert.equal(urlOnlyPr?.kind, "pr");
  assert.equal(urlOnlyPr?.reasonCodes.includes("checks_pending"), true);

  const urlOnlyIssue = report.items.find((item) => item.id.endsWith("#268"));
  assert.equal(urlOnlyIssue?.id, "100yenadmin/Lossless-Codex-Orchestrator-LCO#268");
  assert.equal(urlOnlyIssue?.kind, "issue");

  assertNoUnsafeStrings(report, "PR_kwDOOpaqueNodeId");
});

test("GitHub operating item collector preserves statusCheckRollup fidelity", () => {
  const rawPathCanary = "/Volumes/LEXAR/private/status-rollup.jsonl";
  const tokenCanary = "authorization: Bearer abcdefghijklmnopqrstuvwxyz";
  const opaqueNodeCanary = "PR_kwDOStatusRollupOpaque";
  const pendingReport = createGithubOperatingItemsReport([
    {
      id: opaqueNodeCanary,
      repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
      number: 270,
      kind: "pull_request",
      title: `Live queued statusCheckRollup ${rawPathCanary}`,
      state: "open",
      updatedAt: relativeIso(4),
      statusCheckRollup: {
        contexts: {
          nodes: [
            { __typename: "CheckRun", name: "test", status: "QUEUED", conclusion: null, details: tokenCanary },
            { __typename: "CheckRun", name: "CodeQL", status: "IN_PROGRESS", conclusion: null }
          ]
        }
      }
    }
  ], { now: "2026-07-01T12:00:00.000Z" });

  const pendingPr = pendingReport.items.find((item) => item.id.endsWith("#270"));
  assert.equal(pendingPr?.state, "yellow");
  assert.equal(pendingPr?.reasonCodes.includes("pr_open"), true);
  assert.equal(pendingPr?.reasonCodes.includes("checks_pending"), true);
  assert.match(pendingPr?.nextAction ?? "", /Watch GitHub checks/i);

  const greenDefaultReport = createGithubOperatingItemsReport([
    {
      repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
      pullRequestNumber: 271,
      title: "Open PR with successful checks",
      state: "open",
      updatedAt: relativeIso(3),
      statusCheckRollup: [
        { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "StatusContext", context: "CodeQL", state: "SUCCESS" }
      ]
    }
  ], { now: "2026-07-01T12:00:00.000Z" });

  assert.equal(greenDefaultReport.items.length, 0);
  assert.equal(greenDefaultReport.omitted.count, 1);
  assert.equal(greenDefaultReport.omitted.reasons.includes("green_default"), true);

  const greenIncludedReport = createGithubOperatingItemsReport([
    {
      repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
      pullRequestNumber: 271,
      title: "Open PR with successful checks",
      state: "open",
      updatedAt: relativeIso(3),
      statusCheckRollup: [
        { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "StatusContext", context: "CodeQL", state: "SUCCESS" }
      ]
    }
  ], { includeGreen: true, now: "2026-07-01T12:00:00.000Z" });
  assert.equal(greenIncludedReport.items[0]?.state, "green");
  assert.equal(greenIncludedReport.items[0]?.reasonCodes.includes("checks_passed"), true);

  const unknownReport = createGithubOperatingItemsReport([
    {
      repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
      number: 272,
      type: "pull_request",
      title: "Open PR with no check data",
      state: "open",
      updatedAt: relativeIso(2)
    }
  ], { now: "2026-07-01T12:00:00.000Z" });

  const unknownPr = unknownReport.items.find((item) => item.id.endsWith("#272"));
  assert.equal(unknownPr?.state, "yellow");
  assert.equal(unknownPr?.reasonCodes.includes("pr_open"), true);
  assert.equal(unknownPr?.reasonCodes.includes("checks_unknown"), true);

  const startupFailureReport = createGithubOperatingItemsReport([
    {
      repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
      number: 273,
      type: "pull_request",
      title: "Startup failure check run",
      state: "open",
      updatedAt: relativeIso(1),
      statusCheckRollup: {
        contexts: {
          nodes: [
            { __typename: "CheckRun", name: "test", status: "STARTUP_FAILURE", conclusion: null }
          ]
        }
      }
    }
  ], { now: "2026-07-01T12:00:00.000Z" });
  const startupFailurePr = startupFailureReport.items.find((item) => item.id.endsWith("#273"));
  assert.equal(startupFailurePr?.state, "red");
  assert.equal(startupFailurePr?.reasonCodes.includes("ci_failed"), true);

  const failedConclusionVariants = ["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "STALE"] as const;
  const failureVariantReport = createGithubOperatingItemsReport(failedConclusionVariants.map((conclusion, index) => ({
    repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
    number: 276 + index,
    type: "pull_request",
    title: `${conclusion} check run`,
    state: "open",
    updatedAt: relativeIso(1),
    statusCheckRollup: {
      contexts: {
        nodes: [
          { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion }
        ]
      }
    }
  })), { now: "2026-07-01T12:00:00.000Z" });
  for (const [index, conclusion] of failedConclusionVariants.entries()) {
    const failureVariantPr = failureVariantReport.items.find((item) => item.id.endsWith(`#${276 + index}`));
    assert.equal(failureVariantPr?.state, "red", `${conclusion} should be red`);
    assert.equal(failureVariantPr?.reasonCodes.includes("ci_failed"), true, `${conclusion} should set ci_failed`);
  }

  const expectedContextReport = createGithubOperatingItemsReport([
    {
      repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
      number: 274,
      type: "pull_request",
      title: "Expected required status context",
      state: "open",
      updatedAt: relativeIso(1),
      statusCheckRollup: {
        contexts: {
          nodes: [
            { context: "required-check", state: "EXPECTED" }
          ]
        }
      }
    }
  ], { now: "2026-07-01T12:00:00.000Z" });
  const expectedContextPr = expectedContextReport.items.find((item) => item.id.endsWith("#274"));
  assert.equal(expectedContextPr?.state, "yellow");
  assert.equal(expectedContextPr?.reasonCodes.includes("checks_pending"), true);

  const totalCountOnlyReport = createGithubOperatingItemsReport([
    {
      repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
      number: 275,
      type: "pull_request",
      title: "Total count without loaded checks",
      state: "open",
      updatedAt: relativeIso(1),
      statusCheckRollup: {
        contexts: {
          totalCount: 3
        }
      }
    }
  ], { includeGreen: true, now: "2026-07-01T12:00:00.000Z" });
  const totalCountOnlyPr = totalCountOnlyReport.items.find((item) => item.id.endsWith("#275"));
  assert.equal(totalCountOnlyPr?.state, "yellow");
  assert.equal(totalCountOnlyPr?.reasonCodes.includes("checks_unknown"), true);
  assert.equal(totalCountOnlyPr?.reasonCodes.includes("checks_passed"), false);
  assertNoUnsafeStrings({
    pendingReport,
    greenDefaultReport,
    greenIncludedReport,
    unknownReport,
    startupFailureReport,
    failureVariantReport,
    expectedContextReport,
    totalCountOnlyReport
  }, rawPathCanary, tokenCanary, opaqueNodeCanary);

  const root = mkdtempSync(join(tmpdir(), "loo-github-check-fidelity-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const digest = createProjectDigest(db, { window: "custom", githubItems: pendingReport.items, limit: 5 });
    assert.equal(digest.cards.some((card) => card.reasonCodes.includes("checks_pending")), true);
    assert.equal(digest.signals.some((signal) => signal.nextAction.text.includes("Watch GitHub checks")), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("operating picture marks missing P1 sources and preserves low-confidence conflicts", () => {
  withIndexedSessions([
    {
      id: "019f-operating-blocked",
      title: "GitHub blocked lane",
      status: "blocked",
      priority: "urgent",
      blocker: "CodeRabbit review pending",
      nextAction: "inspect PR review",
      updatedAt: relativeIso(30),
      refs: true
    },
    {
      id: "019f-operating-conflict",
      title: "Conflicting lane",
      status: "complete",
      priority: "low",
      blocker: "customer blocked",
      nextAction: "archive after closeout",
      updatedAt: relativeIso(60),
      refs: true
    },
    {
      id: "019f-operating-old",
      title: "Old lane",
      status: "blocked",
      priority: "urgent",
      blocker: "stale proof",
      nextAction: "ignore outside window",
      updatedAt: relativeIso(8 * 24 * 60),
      refs: true
    }
  ], ({ db }) => {
    const pins = createPlanStatePinsReport(`
<!-- loo:manual-pin -->
- Project: LCO
- State: yellow
- Summary: Public-safe redaction contract is the next sprint gate.
- Next: Run focused autonomy tests.
- Source: issue#256
<!-- /loo:manual-pin -->
`);
    const digest = createProjectDigest(db, {
      window: "7d",
      limit: 10,
      planStatePins: pins,
      githubItems: [
        {
          id: "100yenadmin/Lossless-Codex-Orchestrator-LCO#256",
          title: "shared public-safe autonomy cockpit contracts",
          state: "yellow",
          urgency: "high",
          reasonCodes: ["review_requested"],
          updatedAt: relativeIso(15),
          nextAction: "review PR"
        }
      ]
    });
    const missingStructuredSources = createProjectDigest(db, {
      window: "7d",
      limit: 10,
      planStatePins: createPlanStatePinsReport(""),
      githubItems: []
    });
    const boundaryOnlyDigest = createProjectDigest(db, {
      window: "7d",
      limit: 10,
      planStatePins: createPlanStatePinsReport("<!-- loo:approval-boundary -->\n- Stop before live control.\n<!-- /loo:approval-boundary -->")
    });
    const limitedDigest = createProjectDigest(db, {
      window: "7d",
      limit: 2,
      planStatePins: pins,
      githubItems: [
        {
          id: "100yenadmin/Lossless-Codex-Orchestrator-LCO#256",
          title: "shared public-safe autonomy cockpit contracts",
          state: "yellow",
          urgency: "high",
          reasonCodes: ["review_requested"],
          updatedAt: relativeIso(15),
          nextAction: "review PR"
        }
      ]
    });

    assert.equal(digest.schema, "lco.operatingDigest.v1");
    assert.equal(digest.publicSafe, true);
    assert.equal(digest.sourceCoverage.lco, "ok");
    assert.equal(digest.sourceCoverage.github, "ok");
    assert.equal(digest.sourceCoverage.plan_state, "ok");
    assert.equal(digest.sourceCoverage.notion, "not_configured");
    assert.equal(digest.sourceCoverage.support_control, "not_configured");
    assert.equal(digest.sourceCoverage.company_brain, "not_configured");
    assert.equal(digest.sourceCoverage.stripe, "not_configured");
    assert.equal(digest.cards.some((card) => card.kind === "project" && card.title === "LCO"), true);
    assert.equal(digest.cards.some((card) => card.kind === "repo" && card.reasonCodes.includes("review_requested")), true);
    assert.equal(digest.evidence.some((evidence) =>
      evidence.sourceKind === "github_check_summary" &&
      evidence.sourceRef === "github:100yenadmin/Lossless-Codex-Orchestrator-LCO#256"
    ), true);
    assert.equal(digest.cards.some((card) => card.title === "Old lane"), false);
    assert.equal(digest.cards.some((card) => card.state === "unknown" && card.reasonCodes.includes("conflicting_state")), true);
    assert.equal(digest.topAttention.length > 0, true);
    assert.equal(missingStructuredSources.sourceCoverage.github, "not_configured");
    assert.equal(missingStructuredSources.sourceCoverage.plan_state, "empty");
    assert.equal(boundaryOnlyDigest.sourceCoverage.plan_state, "ok");
    assert.equal(limitedDigest.cards.length, 2);
    assert.equal(limitedDigest.signals.length, 2);

    const attention = createBusinessPulse(db, { window: "7d", limit: 5, planStatePins: pins });
    assert.equal(attention.digest.health.finance.state, "unknown");
    assert.equal(attention.digest.health.finance.reason, "stripe_adapter_not_configured");
  });
});

test("operating picture balances current GitHub lane above stale low-confidence Codex cards", () => {
  withIndexedSessions((sessions) => {
    const rawPathCanary = join(sessions, "rollout-2026-07-01T00-00-00-019f-old-red-a.jsonl");
    return {
      fixtures: [
        {
          id: "019f-old-red-a",
          title: "Old missing-evidence blocked lane A",
          status: "blocked",
          priority: "urgent",
          blocker: "stale private proof",
          nextAction: `inspect stale local proof ${rawPathCanary}`,
          updatedAt: relativeIso(23 * 60),
          refs: false
        },
        {
          id: "019f-old-red-b",
          title: "Old missing-evidence blocked lane B",
          status: "blocked",
          priority: "urgent",
          blocker: "stale review residue",
          nextAction: "expand before acting",
          updatedAt: relativeIso(22 * 60),
          refs: false
        },
        {
          id: "019f-old-red-c",
          title: "Old missing-evidence blocked lane C",
          status: "blocked",
          priority: "urgent",
          blocker: "old missing evidence",
          nextAction: "inspect only if current lane clears",
          updatedAt: relativeIso(21 * 60),
          refs: false
        }
      ],
      canaries: [rawPathCanary]
    };
  }, ({ db, canaries }) => {
    const currentGithubItem = {
      id: "100yenadmin/Lossless-Codex-Orchestrator-LCO#269",
      title: "current-lane source balancing",
      kind: "pr" as const,
      state: "yellow" as const,
      urgency: "medium" as const,
      reasonCodes: ["checks_pending"],
      updatedAt: relativeIso(4),
      nextAction: "Watch GitHub checks for #269.",
      confidence: 0.88
    };
    const customerRuntimeItem = {
      id: "100yenadmin/Lossless-Codex-Orchestrator-LCO#999",
      title: "customer runtime incident",
      kind: "issue" as const,
      state: "red" as const,
      urgency: "critical" as const,
      reasonCodes: ["ci_failed", "customer_impact", "runtime_impact"],
      updatedAt: relativeIso(10),
      nextAction: "Inspect customer runtime failure.",
      confidence: 0.92
    };

    const digest = createProjectDigest(db, {
      window: "24h",
      limit: 6,
      githubItems: [currentGithubItem]
    });
    const attention = createAttentionInbox(db, {
      window: "24h",
      limit: 6,
      githubItems: [currentGithubItem]
    });
    const pulse = createBusinessPulse(db, {
      window: "24h",
      limit: 6,
      githubItems: [currentGithubItem]
    });

    const firstAttentionCard = attention.cards[0];
    assert.equal(firstAttentionCard?.title, "current-lane source balancing");
    assert.equal(firstAttentionCard?.reasonCodes.includes("current_lane"), true);
    assert.equal(firstAttentionCard?.reasonCodes.includes("fresh_signal"), true);
    assert.equal(firstAttentionCard?.reasonCodes.includes("checks_pending"), true);
    assert.equal(digest.sourceCoverage.github, "ok");
    assert.equal(digest.sourceCoverage.notion, "not_configured");
    assert.equal(digest.cards.some((card) => card.reasonCodes.includes("authority_not_configured")), false);
    assert.equal(pulse.digest.topAttention[0], firstAttentionCard?.cardId);
    assert.equal(attention.cards.some((card) => card.reasonCodes.includes("low_confidence_downgraded")), true);

    const customerRuntimeDigest = createProjectDigest(db, {
      window: "24h",
      limit: 6,
      githubItems: [currentGithubItem, customerRuntimeItem]
    });
    assert.equal(customerRuntimeDigest.cards[0]?.title, "customer runtime incident");
    assert.equal(customerRuntimeDigest.cards[0]?.reasonCodes.includes("customer_impact"), true);
    assert.equal(customerRuntimeDigest.cards[0]?.reasonCodes.includes("runtime_impact"), true);

    assertNoUnsafeStrings({ digest, attention, pulse, customerRuntimeDigest }, ...canaries);
  });
});

test("Eva cockpit dogfood joins GitHub checks recent sessions and operating digests", () => {
  withIndexedSessions((sessions) => {
    const rawPathCanary = join(sessions, "rollout-2026-07-01T00-00-00-019f-dogfood-stale.jsonl");
    return {
      fixtures: [
        {
          id: "019f-dogfood-stale",
          title: "Old blocked missing-evidence lane",
          status: "blocked",
          priority: "urgent",
          blocker: "stale local proof",
          nextAction: `inspect stale proof ${rawPathCanary}`,
          updatedAt: relativeIso(23 * 60),
          refs: false
        },
        {
          id: "019f-dogfood-dirty-card",
          title: "Title: Dirty cockpit card Final: duplicated residue",
          status: "active",
          priority: "medium",
          nextAction: "::inbox-item{title=\"Dirty cockpit card\", summary=\"Final: Clean dogfood summary. Final: Clean dogfood summary.\", next=\"Inspect dogfood source ref.\"}",
          updatedAt: relativeIso(40),
          refs: true
        },
        {
          id: "019f-dogfood-customer-runtime",
          title: "Customer runtime security incident",
          status: "blocked",
          priority: "urgent",
          blocker: "Customer runtime security impact",
          nextAction: "Inspect customer runtime failure.",
          updatedAt: relativeIso(15),
          refs: true
        }
      ],
      canaries: [rawPathCanary]
    };
  }, ({ db, canaries }) => {
    const githubReport = createGithubOperatingItemsReport([
      {
        repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
        number: 272,
        type: "pull_request",
        title: "Eva cockpit dogfood PR",
        state: "open",
        updatedAt: relativeIso(5),
        statusCheckRollup: [
          { name: "test", status: "QUEUED" },
          { name: "CodeQL", status: "IN_PROGRESS" }
        ]
      },
      {
        repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
        number: 255,
        type: "issue",
        title: "Eva Operating Picture tracker",
        state: "open",
        updatedAt: relativeIso(30)
      },
      {
        repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
        number: 200,
        type: "pull_request",
        title: "green closed issue should be omitted",
        state: "closed",
        merged: true,
        updatedAt: relativeIso(10),
        statusCheckRollup: [
          { name: "test", status: "COMPLETED", conclusion: "SUCCESS" }
        ]
      }
    ]);
    const recent = getRecentSessions(db, { scope: "recent", limit: 10, includeCards: true });
    const digest = createProjectDigest(db, { window: "24h", limit: 10, githubItems: githubReport.items });
    const attention = createAttentionInbox(db, { window: "24h", limit: 10, githubItems: githubReport.items });
    const pulse = createBusinessPulse(db, { window: "24h", limit: 10, githubItems: githubReport.items });

    const currentPr = digest.cards.find((card) => card.title === "Eva cockpit dogfood PR");
    assert.ok(currentPr);
    assert.equal(currentPr.reasonCodes.includes("checks_pending"), true);
    assert.equal(currentPr.reasonCodes.includes("current_lane"), true);
    assert.equal(githubReport.omitted.count, 1);

    const dirtyCard = recent.cards.find((card) => card.threadId === "codex_thread:019f-dogfood-dirty-card");
    assert.ok(dirtyCard);
    assert.equal(dirtyCard.title, "Dirty cockpit card");
    assert.equal(dirtyCard.objective, "Clean dogfood summary.");
    assert.equal(dirtyCard.nextAction.reason, "Inspect dogfood source ref.");

    const runtimeCard = attention.cards[0];
    assert.equal(runtimeCard?.title, "Customer runtime security incident");
    assert.equal(runtimeCard.reasonCodes.includes("customer_impact"), true);
    assert.equal(runtimeCard.reasonCodes.includes("runtime_impact"), true);
    assert.equal(runtimeCard.reasonCodes.includes("security_impact"), true);
    assert.equal(attention.cards.some((card) => card.reasonCodes.includes("low_confidence_downgraded")), true);

    assert.equal(digest.sourceCoverage.github, "ok");
    assert.equal(digest.sourceCoverage.notion, "not_configured");
    assert.equal(pulse.sourceCoverage.stripe, "not_configured");
    assert.equal(pulse.digest.topAttention[0], runtimeCard?.cardId);
    assert.equal(JSON.stringify({ recent, digest, attention, pulse }).includes("::inbox-item"), false);
    assertNoUnsafeStrings({ githubReport, recent, digest, attention, pulse }, ...canaries);
  });
});

test("operating picture surfaces active customer impact without treating product-surface wording as impact", () => {
  withIndexedSessions([
    {
      id: "019f-active-customer-impact",
      title: "Customers cannot log in during runtime incident",
      status: "active",
      priority: "medium",
      nextAction: "inspect external users blocked by runtime incident",
      updatedAt: relativeIso(8),
      refs: true
    },
    {
      id: "019f-routine-gateway-token-budget",
      title: "OpenClaw gateway token budget retrieval tuning",
      status: "active",
      priority: "high",
      nextAction: "continue ordinary gateway tool-smoke token budget work",
      updatedAt: relativeIso(5),
      refs: true
    },
    {
      id: "019f-completed-customer-incident",
      title: "Completed customer security incident closeout",
      status: "done",
      priority: "medium",
      nextAction: "customer security incident resolved and closed",
      updatedAt: relativeIso(4),
      refs: true
    },
    {
      id: "019f-no-impact-readiness",
      title: "No customer impact production readiness auth token refactor",
      status: "active",
      priority: "high",
      nextAction: "document no customer impact and continue production readiness auth token refactor",
      updatedAt: relativeIso(3),
      refs: true
    }
  ] satisfies SessionFixture[], ({ db }) => {
    const recent = getRecentSessions(db, { scope: "recent", limit: 10, includeCards: true });
    const impactedSession = recent.cards.find((card) => card.threadId === "codex_thread:019f-active-customer-impact");
    const routineSession = recent.cards.find((card) => card.threadId === "codex_thread:019f-routine-gateway-token-budget");
    const completedSession = recent.cards.find((card) => card.threadId === "codex_thread:019f-completed-customer-incident");
    const noImpactSession = recent.cards.find((card) => card.threadId === "codex_thread:019f-no-impact-readiness");

    assert.ok(impactedSession);
    assert.equal(impactedSession.reasonCodes.includes("customer_impact"), true);
    assert.equal(impactedSession.reasonCodes.includes("runtime_impact"), true);
    assert.ok(routineSession);
    assert.equal(routineSession.reasonCodes.includes("runtime_impact"), false);
    assert.equal(routineSession.reasonCodes.includes("security_impact"), false);
    assert.ok(completedSession);
    assert.equal(completedSession.state, "done");
    assert.equal(completedSession.reasonCodes.includes("customer_impact"), true);
    assert.ok(noImpactSession);
    assert.equal(noImpactSession.reasonCodes.includes("customer_impact"), false);
    assert.equal(noImpactSession.reasonCodes.includes("production_impact"), false);
    assert.equal(noImpactSession.reasonCodes.includes("security_impact"), false);

    const attention = createAttentionInbox(db, { window: "24h", limit: 10 });
    assert.equal(attention.cards[0]?.title, "Customers cannot log in during runtime incident");
    assert.equal(attention.cards[0]?.state, "yellow");
    assert.equal(attention.cards.some((card) => card.title === "OpenClaw gateway token budget retrieval tuning"), false);
    assert.equal(attention.cards.some((card) => card.title === "Completed customer security incident closeout"), false);
    assert.equal(attention.cards.some((card) => card.title === "No customer impact production readiness auth token refactor"), false);

    const cockpit = getCockpitInbox(db, { limit: 10 });
    assert.equal(cockpit.items[0]?.card.title, "Customers cannot log in during runtime incident");
    assert.equal(cockpit.items[0]?.reasonCodes.includes("customer_impact"), true);
    assert.equal(cockpit.items.some((item) => item.card.title === "OpenClaw gateway token budget retrieval tuning"), false);
  });
});

test("codex cockpit cards clean directive fragments and markdown-heavy presentation text", () => {
  withIndexedSessions((sessions) => {
    const rawPathCanary = join(sessions, "rollout-2026-07-01T00-00-00-019f-card-directive.jsonl");
    return {
      fixtures: [
        {
          id: "019f-card-directive",
          title: "Title: Card cleanup lane Final: duplicated title residue",
          status: "active",
          priority: "medium",
          nextAction: [
            "::inbox-item{title=\"Card cleanup lane\", summary=\"Final: Clean card summaries. Final: Clean card summaries.\", next=\"Inspect #271 source ref.\"}",
            "| field | value |",
            "| --- | --- |",
            `| path | ${rawPathCanary} |`
          ].join("\n"),
          updatedAt: relativeIso(5),
          refs: true
        }
      ],
      canaries: [rawPathCanary]
    };
  }, ({ db, canaries }) => {
    const report = getRecentSessions(db, { scope: "recent", limit: 5, includeCards: true });
    const card = report.cards.find((candidate) => candidate.threadId === "codex_thread:019f-card-directive");
    assert.ok(card);
    assert.equal(card.title, "Card cleanup lane");
    assert.equal(card.objective, "Clean card summaries.");
    assert.equal(card.nextAction.reason, "Inspect #271 source ref.");
    assert.equal(card.reasonCodes.includes("presentation_cleaned"), true);

    const digest = createProjectDigest(db, { window: "24h", limit: 5 });
    const digestCard = digest.cards.find((candidate) => candidate.title === "Card cleanup lane");
    assert.ok(digestCard);
    assert.equal(digestCard.summary, "Clean card summaries.");
    assert.equal(digestCard.nextAction, "Inspect #271 source ref.");

    const json = JSON.stringify({ report, digest });
    for (const forbidden of ["::inbox-item", "Final:", "Title:", "| field |", "duplicated title residue"]) {
      assert.equal(json.includes(forbidden), false, `presentation residue leaked: ${forbidden}`);
    }
    assertNoUnsafeStrings({ report, digest }, ...canaries);
  });
});

test("codex cockpit cards fall back to source inspection for unclean summaries", () => {
  withIndexedSessions([
    {
      id: "019f-card-fallback",
      title: "Fallback cleanup lane",
      status: "active",
      priority: "low",
      nextAction: [
        "| stale | fragment |",
        "| --- | --- |",
        "| ??? | ??? |",
        "::inbox-item{summary=\"| broken | table |\"}"
      ].join("\n"),
      updatedAt: relativeIso(8),
      refs: true
    }
  ], ({ db }) => {
    const report = getRecentSessions(db, { scope: "recent", limit: 5, includeCards: true });
    const card = report.cards.find((candidate) => candidate.threadId === "codex_thread:019f-card-fallback");
    assert.ok(card);
    assert.equal(card.objective, "Inspect source ref.");
    assert.equal(card.nextAction.kind, "inspect");
    assert.equal(card.nextAction.reason, "Inspect source ref.");
    assert.equal(card.reasonCodes.includes("presentation_low_confidence"), true);
    assert.equal(card.confidence <= 0.72, true);
    assertNoUnsafeStrings(report);
  });
});

test("operating picture includes source authority and degrades unavailable authorities", () => {
  withIndexedSessions([
    {
      id: "019f-authority-session",
      title: "Authority profile session",
      status: "active",
      priority: "medium",
      nextAction: "inspect source authority",
      updatedAt: relativeIso(12),
      refs: true
    }
  ], ({ db, sessions }) => {
    const pins = createPlanStatePinsReport(`
<!-- loo:manual-pin -->
- Project: LCO
- State: yellow
- Summary: PLAN_STATE is a manual pin, not canonical current state.
- Next: Verify current state at authoritative source.
- Source: plan_state:manual_pin:authority
<!-- /loo:manual-pin -->
`);
    const profile = createDefaultSourceAuthorityProfile();
    const digest = createProjectDigest(db, {
      window: "custom",
      limit: 10,
      planStatePins: pins,
      sourceAuthorityProfile: profile,
      githubItems: [
        {
          id: "100yenadmin/Lossless-Codex-Orchestrator-LCO#258",
          title: "source authority profile",
          state: "yellow",
          urgency: "medium",
          updatedAt: relativeIso(8),
          reasonCodes: ["issue_open"],
          nextAction: "implement source authority semantics"
        }
      ]
    });

    assert.equal(profile.schema, "lco.sourceAuthorityProfile.v1");
    assert.equal(profile.publicSafe, true);
    assert.equal(digest.authorityCoverage.github.setupStatus, "ok");
    assert.equal(digest.authorityCoverage.github.authority, "authoritative");
    assert.equal(digest.authorityCoverage.github.owns.includes("pr_status"), true);
    assert.equal(digest.authorityCoverage.plan_state.authority, "fallback_only");
    assert.equal(digest.authorityCoverage.plan_state.allowedClaims.includes("approval_boundary"), true);
    assert.equal(digest.authorityCoverage.notion.setupStatus, "not_configured");
    assert.equal(digest.authorityCoverage.stripe.status, "not_configured");

    const degraded = createProjectDigest(db, {
      window: "custom",
      limit: 10,
      sourceAuthorityProfile: createDefaultSourceAuthorityProfile({
        github: {
          setupStatus: "unavailable",
          authority: "cache_only",
          fallbackBehavior: "unknown"
        }
      }),
      githubItems: [
        {
          id: "100yenadmin/Lossless-Codex-Orchestrator-LCO#258",
          title: "source authority profile",
          state: "red",
          urgency: "critical",
          updatedAt: relativeIso(5),
          reasonCodes: ["ci_failed"],
          nextAction: "do not trust unavailable GitHub authority"
        }
      ]
    });
    const githubCard = degraded.cards.find((card) => card.title === "source authority profile");
    assert.equal(degraded.sourceCoverage.github, "ok");
    assert.equal(degraded.authorityCoverage.github.setupStatus, "unavailable");
    assert.equal(degraded.authorityCoverage.github.status, "unavailable");
    assert.equal(githubCard?.state, "unknown");
    assert.equal(githubCard?.reasonCodes.includes("authority_unavailable"), true);
    assert.equal((githubCard?.confidence ?? 1) <= 0.5, true);
    assertNoUnsafeStrings({ profile, digest, degraded }, sessions);
  });
});

test("new cockpit and operating-picture tools are exposed through MCP with public-safe results", async () => {
  await withIndexedSessionsAsync([
    {
      id: "019f-tool-blocked",
      title: "Tool blocked lane",
      status: "blocked",
      priority: "urgent",
      blocker: "approval needed",
      nextAction: "dry-run only",
      updatedAt: relativeIso(10),
      refs: true
    }
  ], async ({ db, root, sessions }) => {
    const tools = createLooTools({
      db,
      audit: createAuditStore(join(root, "audit.jsonl")),
      codexClient: { request: async () => ({ ok: true }) }
    });
    for (const name of [
      "loo_recent_sessions",
      "loo_cockpit_inbox",
      "loo_codex_collaboration_cockpit",
      "loo_codex_runtime_desktop_visibility_status",
      "loo_watchers_list",
      "loo_watcher_status",
      "loo_watcher_dry_run",
      "loo_resume_request_packet",
      "loo_plan_state_pins",
      "loo_github_operating_items",
      "loo_project_digest",
      "loo_attention_inbox",
      "loo_business_pulse"
    ]) {
      assert.equal(tools.some((tool) => tool.name === name), true, `${name} missing`);
    }

    const recentTool = tools.find((tool) => tool.name === "loo_recent_sessions");
    assert.ok(recentTool);
    assert.deepEqual((recentTool.inputSchema.properties as Record<string, unknown>).now, { type: "string" });
    const recent = await recentTool.execute({ limit: 5, include_cards: true, now: "2026-07-01T12:00:00.000Z" });
    assert.equal((recent as { publicSafe?: boolean }).publicSafe, true);
    assert.equal((recent as { generatedAt?: string }).generatedAt, "2026-07-01T12:00:00.000Z");

    const collaborationCockpit = await tools.find((tool) => tool.name === "loo_codex_collaboration_cockpit")?.execute({
      limit: 5,
      now: "2026-07-01T12:00:00.000Z"
    });
    assert.equal((collaborationCockpit as { publicSafe?: boolean }).publicSafe, true);
    assert.equal((collaborationCockpit as { actionsPerformed?: { desktopGuiActionRun?: boolean } }).actionsPerformed?.desktopGuiActionRun, false);

    const runtimeVisibility = await tools.find((tool) => tool.name === "loo_codex_runtime_desktop_visibility_status")?.execute({
      limit: 5,
      now: "2026-07-01T12:00:00.000Z"
    });
    assert.equal((runtimeVisibility as { publicSafe?: boolean }).publicSafe, true);
    assert.equal((runtimeVisibility as { actionsPerformed?: { desktopGuiActionRun?: boolean } }).actionsPerformed?.desktopGuiActionRun, false);

    const pins = await tools.find((tool) => tool.name === "loo_plan_state_pins")?.execute({
      plan_state_text: "<!-- loo:manual-pin -->\n- Project: LCO\n- State: yellow\n- Summary: Test pin.\n- Next: Review.\n<!-- /loo:manual-pin -->"
    });
    assert.equal((pins as { manualPins?: unknown[] }).manualPins?.length, 1);

    const planStatePath = join(root, "PLAN_STATE.md");
    writeFileSync(planStatePath, "<!-- loo:manual-pin -->\n- Project: Path pin\n- State: yellow\n- Summary: Allowed path pin.\n- Next: Review.\n<!-- /loo:manual-pin -->\n");
    const pathPins = await tools.find((tool) => tool.name === "loo_plan_state_pins")?.execute({ plan_state_path: planStatePath });
    assert.equal((pathPins as { manualPins?: unknown[] }).manualPins?.length, 1);

    const disallowedPlanPath = join(root, "NOT_PLAN_STATE.md");
    writeFileSync(disallowedPlanPath, "<!-- loo:manual-pin -->\n- Project: Unsafe path\n- State: red\n- Summary: Should not be read.\n- Next: Stop.\n<!-- /loo:manual-pin -->\n");
    const disallowedPins = await tools.find((tool) => tool.name === "loo_plan_state_pins")?.execute({ plan_state_path: disallowedPlanPath });
    assert.equal((disallowedPins as { manualPins?: unknown[] }).manualPins?.length, 0);

    const githubItems = await tools.find((tool) => tool.name === "loo_github_operating_items")?.execute({
      github_records: [{
        repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
        number: 264,
        type: "pull_request",
        title: "deterministic GitHub collector",
        state: "open",
        updatedAt: relativeIso(3),
        checks: { conclusion: "failure", failing: 1 }
      }],
      now: "2026-07-01T12:00:00.000Z"
    });
    assert.equal((githubItems as { publicSafe?: boolean }).publicSafe, true);
    assert.equal((githubItems as { items?: Array<{ state?: string; reasonCodes?: string[] }> }).items?.[0]?.state, "red");
    assert.equal((githubItems as { items?: Array<{ state?: string; reasonCodes?: string[] }> }).items?.[0]?.reasonCodes?.includes("ci_failed"), true);

    const projectDigestTool = tools.find((tool) => tool.name === "loo_project_digest");
    assert.ok(projectDigestTool);
    assert.deepEqual((projectDigestTool.inputSchema.properties as Record<string, unknown>).now, { type: "string" });
    await assert.rejects(
      async () => projectDigestTool.execute({ github_items: [{}] }),
      /github_items\[0\] requires id and title/
    );
    const projectDigest = await projectDigestTool.execute({ limit: 5, now: "2026-07-01T12:00:00.000Z" });
    assert.equal((projectDigest as { generatedAt?: string }).generatedAt, "2026-07-01T12:00:00.000Z");

    const attentionTool = tools.find((tool) => tool.name === "loo_attention_inbox");
    assert.ok(attentionTool);
    assert.deepEqual((attentionTool.inputSchema.properties as Record<string, unknown>).now, { type: "string" });
    const attentionFromTool = await attentionTool.execute({ limit: 5, now: "2026-07-01T12:00:00.000Z" });
    assert.equal((attentionFromTool as { generatedAt?: string }).generatedAt, "2026-07-01T12:00:00.000Z");

    const pulseTool = tools.find((tool) => tool.name === "loo_business_pulse");
    assert.ok(pulseTool);
    assert.deepEqual((pulseTool.inputSchema.properties as Record<string, unknown>).now, { type: "string" });
    const pulse = await pulseTool.execute({ limit: 5, now: "2026-07-01T12:00:00.000Z" });
    assert.equal((pulse as { digest?: { sourceCoverage?: { plan_state?: string; stripe?: string } } }).digest?.sourceCoverage?.plan_state, "not_configured");
    assert.equal((pulse as { digest?: { sourceCoverage?: { plan_state?: string; stripe?: string } } }).digest?.sourceCoverage?.stripe, "not_configured");
    assert.equal((pulse as { digest?: { generatedAt?: string } }).digest?.generatedAt, "2026-07-01T12:00:00.000Z");
    assert.equal((pulse as { authorityCoverage?: { github?: { authority?: string } } }).authorityCoverage?.github?.authority, "authoritative");

    const watcherSpec = {
      schema: "lco.watchSpec.v1",
      watchId: "watch_mcp_final",
      targetRef: "codex_thread:019f-tool-blocked",
      kind: "final_message_appeared",
      createdAt: relativeIso(30),
      lastObservedAt: relativeIso(5),
      ttlSeconds: 3600,
      stopConditions: ["final_message_seen", "explicit_cancel"],
      wakeReason: "final_message_appeared",
      evidenceIds: ["ev_mcp"],
      confidence: 0.9,
      mutates: false
    };
    const watcherDryRun = await tools.find((tool) => tool.name === "loo_watcher_dry_run")?.execute({
      watcher_specs: [watcherSpec],
      now: "2026-07-01T12:00:00.000Z"
    });
    assert.equal((watcherDryRun as { publicSafe?: boolean }).publicSafe, true);
    assert.equal((watcherDryRun as { resumeRequestPackets?: unknown[] }).resumeRequestPackets?.length, 1);

    const unsafeWatcher = await tools.find((tool) => tool.name === "loo_watchers_list");
    assert.ok(unsafeWatcher);
    assert.throws(
      () => unsafeWatcher.execute({ watcher_specs: [{ ...watcherSpec, mutates: true }] }),
      /mutates=false/
    );
    assertNoUnsafeStrings({ recent, collaborationCockpit, runtimeVisibility, pins, pulse, watcherDryRun }, sessions);
  });
});

test("Codex collaboration cockpit summarizes attention and Desktop fallback readiness without actions", () => {
  withIndexedSessions((sessions) => {
    const transcriptPathCanary = join(sessions, "rollout-2026-07-01T00-00-00-019f-collab-cli.jsonl");
    return {
      fixtures: [
        {
          id: "019f-collab-cli",
          title: "CLI visible collaboration lane",
          status: "running",
          priority: "high",
          nextAction: `inspect Desktop fallback without raw path ${transcriptPathCanary}`,
          updatedAt: relativeIso(4),
          refs: true,
          extra: ["authorization: Bearer abcdefghijklmnopqrstuvwxyz"]
        },
        {
          id: "019f-collab-approval",
          title: "Approval waiting collaboration lane",
          status: "needs_approval",
          priority: "urgent",
          blocker: "approval needed",
          nextAction: "prepare approval packet only",
          updatedAt: relativeIso(7),
          refs: true
        }
      ],
      canaries: [transcriptPathCanary]
    };
  }, ({ db, canaries }) => {
    const report = createCodexCollaborationCockpit(db, {
      limit: 5,
      now: "2026-07-02T00:00:00.000Z",
      watcherSpecs: [
        {
          schema: "lco.watchSpec.v1",
          watchId: "watch_collab_cli",
          targetRef: "codex_thread:019f-collab-cli",
          kind: "final_message_appeared",
          createdAt: "2026-07-01T23:40:00.000Z",
          lastObservedAt: "2026-07-01T23:59:00.000Z",
          ttlSeconds: 3600,
          stopConditions: ["final_message_seen", "explicit_cancel"],
          wakeReason: "final_message_appeared",
          evidenceIds: ["ev_watch_collab"],
          confidence: 0.92,
          mutates: false
        }
      ],
      desktopCoherenceReports: [
        {
          schema: "lco.codexDesktopCoherence.v1",
          publicSafe: true,
          target: { threadId: "019f-collab-cli", sourceRef: "codex_thread:019f-collab-cli" },
          state: "cli_visible",
          confidence: 0.82,
          evidenceIds: ["ev_coherence_cli"],
          blockers: ["desktop_visibility_not_proven"],
          reasonCodes: ["cli_direct_visible_without_desktop_proof"],
          sourceCoverage: { indexedLco: "ok", visibleCodex: "partial", codexAppServer: "ok" },
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
        }
      ],
      desktopFallbackReports: [
        {
          schema: "lco.codex.desktopFallback.v1",
          publicSafe: true,
          readOnly: true,
          target: { threadId: "019f-collab-cli", sourceRef: "codex_thread:019f-collab-cli" },
          fallback: { required: true, reason: "desktop_visibility_not_proven", coherenceState: "cli_visible", desktopVisibility: "not_proven" },
          preferredBackend: "cua-driver",
          backends: [
            { backend: "cua-driver", role: "preferred_background", status: "ready", blockers: [], warnings: [], takesScreenWarning: false },
            { backend: "peekaboo", role: "secondary_visible_fallback", status: "blocked", blockers: ["visible_fallback_requires_explicit_user_visible_run"], warnings: [], takesScreenWarning: true }
          ],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, screenshotCaptured: false, rawTranscriptRead: false }
        }
      ]
    });

    assert.equal(report.schema, "lco.codex.collaborationCockpit.v1");
    assert.equal(report.publicSafe, true);
    assert.equal(report.summary.returned, 2);
    assert.equal(report.summary.needsApproval, 2);
    assert.equal(report.summary.fallbackRequired, 1);
    assert.equal(report.sourceCoverage.desktopCoherence, "partial");
    assert.equal(report.sourceCoverage.desktopFallback, "partial");
    assert.deepEqual(report.actionsPerformed, {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false,
      screenshotCaptured: false,
      npmPublished: false,
      githubReleaseCreated: false
    });

    const cliLane = report.lanes.find((lane) => lane.threadId === "codex_thread:019f-collab-cli");
    assert.ok(cliLane);
    assert.equal(cliLane.attention.level, "critical");
    assert.equal(cliLane.nextAction.requiresApproval, true);
    assert.equal(cliLane.desktop.state, "fallback_ready");
    assert.equal(cliLane.desktop.requiresFallback, true);
    assert.equal(cliLane.desktop.preferredBackend, "cua-driver");
    assert.equal(cliLane.reasonCodes.includes("watcher_triggered"), true);
    assert.equal(cliLane.desktop.reasonCodes.includes("cli_direct_visible_without_desktop_proof"), true);
    assertNoUnsafeStrings(report, ...canaries);
  });
});

test("Codex collaboration cockpit does not count stale Desktop reports as active-lane coverage", () => {
  withIndexedSessions(() => ({
    fixtures: [{
      id: "019f-collab-active-only",
      title: "Active lane without Desktop evidence",
      status: "running",
      priority: "high",
      nextAction: "inspect active lane",
      updatedAt: relativeIso(4),
      refs: true
    }]
  }), ({ db }) => {
    const report = createCodexCollaborationCockpit(db, {
      limit: 5,
      now: "2026-07-02T00:00:00.000Z",
      desktopCoherenceReports: [{
        schema: "lco.codexDesktopCoherence.v1",
        publicSafe: true,
        target: { threadId: "019f-stale-other-thread", sourceRef: "codex_thread:019f-stale-other-thread" },
        state: "desktop_visible",
        confidence: 0.9,
        evidenceIds: ["ev_stale_desktop"],
        actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
      }]
    });

    assert.equal(report.sourceCoverage.desktopCoherence, "partial");
    const lane = report.lanes.find((item) => item.threadId === "codex_thread:019f-collab-active-only");
    assert.ok(lane);
    assert.equal(lane.desktop.sourceCoverage.desktopCoherence, "partial");
    assert.deepEqual(lane.desktop.evidenceIds, []);
  });
});

test("Codex collaboration cockpit treats unknown Desktop proof as fallback-required and ignores negated approval notes", () => {
  withIndexedSessions(() => ({
    fixtures: [
      {
        id: "019f-collab-unknown-desktop",
        title: "Unknown Desktop lane",
        status: "running",
        priority: "high",
        nextAction: "inspect Desktop visibility",
        updatedAt: relativeIso(4),
        refs: true
      },
      {
        id: "019f-collab-no-approval",
        title: "No approval needed lane",
        status: "running",
        priority: "medium",
        nextAction: "no approval required; keep watching",
        updatedAt: relativeIso(8),
        refs: true
      },
      {
        id: "019f-collab-approval-required",
        title: "Approval required lane",
        status: "running",
        priority: "medium",
        nextAction: "approval required before resume",
        updatedAt: relativeIso(9),
        refs: true
      }
    ]
  }), ({ db }) => {
    const report = createCodexCollaborationCockpit(db, {
      limit: 5,
      now: "2026-07-02T00:00:00.000Z",
      desktopCoherenceReports: [{
        schema: "lco.codexDesktopCoherence.v1",
        publicSafe: true,
        target: { threadId: "019f-collab-unknown-desktop", sourceRef: "codex_thread:019f-collab-unknown-desktop" },
        state: "unknown",
        confidence: 0.45,
        evidenceIds: ["ev_unknown_desktop"],
        actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
      }]
    });

    assert.equal(report.summary.fallbackRequired, 1);
    assert.equal(report.summary.needsApproval, 1);

    const unknownLane = report.lanes.find((item) => item.threadId === "codex_thread:019f-collab-unknown-desktop");
    assert.ok(unknownLane);
    assert.equal(unknownLane.desktop.state, "unknown");
    assert.equal(unknownLane.desktop.requiresFallback, true);
    assert.equal(unknownLane.desktop.reasonCodes.includes("desktop_fallback_required"), true);

    const noApprovalLane = report.lanes.find((item) => item.threadId === "codex_thread:019f-collab-no-approval");
    assert.ok(noApprovalLane);
    assert.equal(noApprovalLane.nextAction.reason.includes("approval"), true);
    assert.equal(noApprovalLane.reasonCodes.includes("approval_needed"), false);

    const approvalRequiredLane = report.lanes.find((item) => item.threadId === "codex_thread:019f-collab-approval-required");
    assert.ok(approvalRequiredLane);
    assert.equal(approvalRequiredLane.nextAction.reason.includes("approval required"), true);
    assert.equal(approvalRequiredLane.reasonCodes.includes("approval_needed"), false);
  });
});

test("Codex collaboration cockpit keeps selected-lane Desktop evidence public-safe and approval honest", () => {
  const tokenCanary = "ghp_abcdefghijklmnopqrstuvwxyz123456";
  withIndexedSessions(() => ({
    fixtures: [
      {
        id: "019f-collab-limit-visible",
        title: "Hidden Desktop evidence lane",
        status: "running",
        priority: "medium",
        nextAction: "keep watching lower priority lane",
        updatedAt: relativeIso(10),
        refs: true
      },
      {
        id: "019f-collab-limit-selected",
        title: "Selected lane without Desktop evidence",
        status: "running",
        priority: "urgent",
        blocker: "critical operator attention",
        nextAction: "inspect selected lane",
        updatedAt: relativeIso(2),
        refs: true
      },
      {
        id: "019f-collab-without-approval",
        title: "Without approval blocked lane",
        status: "running",
        priority: "medium",
        nextAction: "do not resume without approval",
        updatedAt: relativeIso(6),
        refs: true
      },
      {
        id: "019f-collab-no-approval-received",
        title: "Approval not received blocked lane",
        status: "running",
        priority: "medium",
        nextAction: "no approval received yet; do not resume",
        updatedAt: relativeIso(6),
        refs: true
      },
      {
        id: "019f-collab-invalid-report",
        title: "Invalid Desktop report lane",
        status: "running",
        priority: "medium",
        nextAction: "validate Desktop report schema",
        updatedAt: relativeIso(7),
        refs: true
      },
      {
        id: "019f-collab-conflict",
        title: "Conflicting Desktop evidence lane",
        status: "running",
        priority: "medium",
        nextAction: "route fallback conflict",
        updatedAt: relativeIso(8),
        refs: true
      }
    ],
    canaries: [tokenCanary]
  }), ({ db, canaries }) => {
    const limited = createCodexCollaborationCockpit(db, {
      limit: 1,
      now: "2026-07-02T00:00:00.000Z",
      desktopCoherenceReports: [{
        schema: "lco.codexDesktopCoherence.v1",
        publicSafe: true,
        target: { threadId: "019f-collab-limit-visible", sourceRef: "codex_thread:019f-collab-limit-visible" },
        state: "desktop_visible",
        confidence: 0.94,
        evidenceIds: ["ev_hidden_visible"],
        actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
      }]
    });

    assert.equal(limited.summary.returned, 1);
    assert.equal(limited.lanes[0]?.threadId, "codex_thread:019f-collab-limit-selected");
    assert.equal(limited.sourceCoverage.desktopCoherence, "partial");
    assert.equal(limited.lanes[0]?.desktop.sourceCoverage.desktopCoherence, "partial");
    assert.deepEqual(limited.lanes[0]?.desktop.evidenceIds, []);

    const visibleBranch = createCodexCollaborationCockpit(db, {
      limit: 10,
      now: "2026-07-02T00:00:00.000Z",
      desktopCoherenceReports: [{
        schema: "lco.codexDesktopCoherence.v1",
        publicSafe: true,
        target: { threadId: "019f-collab-limit-visible", sourceRef: "codex_thread:019f-collab-limit-visible" },
        state: "desktop_visible",
        confidence: 0.94,
        evidenceIds: ["ev_visible_branch"],
        actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
      }]
    });
    const visibleLane = visibleBranch.lanes.find((lane) => lane.threadId === "codex_thread:019f-collab-limit-visible");
    assert.ok(visibleLane);
    assert.equal(visibleLane.desktop.state, "desktop_visible");
    assert.equal(visibleLane.desktop.confidence, 0.94);
    assert.equal(visibleBranch.summary.desktopVisible, 1);
    assert.equal(visibleBranch.sourceCoverage.desktopCoherence, "partial");
    const visibleBranchWithoutEvidence = visibleBranch.lanes.find((lane) => lane.threadId === "codex_thread:019f-collab-limit-selected");
    assert.ok(visibleBranchWithoutEvidence);
    assert.equal(visibleBranchWithoutEvidence.desktop.sourceCoverage.desktopCoherence, "partial");

    const invalidAndSensitive = createCodexCollaborationCockpit(db, {
      limit: 10,
      now: "2026-07-02T00:00:00.000Z",
      desktopCoherenceReports: [
        {
          target: { threadId: "019f-collab-invalid-report", sourceRef: "codex_thread:019f-collab-invalid-report" },
          state: "desktop_visible",
          confidence: 0.95,
          evidenceIds: ["ev_invalid_schema"]
        },
        {
          schema: "lco.codexDesktopCoherence.v1",
          publicSafe: true,
          target: { threadId: "019f-collab-without-approval", sourceRef: "codex_thread:019f-collab-without-approval" },
          state: "unknown",
          confidence: 0.5,
          blockers: [tokenCanary, "desktop_visibility_not_proven"],
          reasonCodes: [tokenCanary, "desktop_visibility_not_proven"],
          evidenceIds: ["ev_sensitive_blocker"],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
        },
        {
          schema: "lco.codexDesktopCoherence.v1",
          publicSafe: true,
          target: { threadId: "019f-collab-conflict", sourceRef: "codex_thread:019f-collab-conflict" },
          state: "desktop_visible",
          confidence: 0.9,
          evidenceIds: ["ev_conflict_visible"],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
        }
      ],
      desktopFallbackReports: [{
        schema: "lco.codex.desktopFallback.v1",
        publicSafe: true,
        readOnly: true,
        target: { threadId: "019f-collab-conflict", sourceRef: "codex_thread:019f-collab-conflict" },
        fallback: { required: true, reason: "desktop_visibility_not_proven", coherenceState: "desktop_visible", desktopVisibility: "not_proven" },
        preferredBackend: "cua-driver",
        backends: [
          { backend: "cua-driver", role: "preferred_background", status: "blocked", blockers: ["permission_missing"], warnings: [], takesScreenWarning: false }
        ],
        actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, screenshotCaptured: false, rawTranscriptRead: false }
      }]
    });

    assert.equal(invalidAndSensitive.summary.needsApproval, 2);
    assertNoUnsafeStrings(invalidAndSensitive, ...canaries);
    // Approval phrase detection is currently a summary-level signal; text-only detection does not add a lane reasonCode.
    const approvalBlockedLane = invalidAndSensitive.lanes.find((lane) => lane.threadId === "codex_thread:019f-collab-without-approval");
    assert.ok(approvalBlockedLane);
    assert.equal(approvalBlockedLane.reasonCodes.includes("approval_needed"), false);

    const withoutApprovalLane = invalidAndSensitive.lanes.find((lane) => lane.threadId === "codex_thread:019f-collab-without-approval");
    assert.ok(withoutApprovalLane);
    assert.equal(withoutApprovalLane.desktop.blockers.some((blocker) => blocker.startsWith("blocker_")), true);
    assert.equal(withoutApprovalLane.desktop.blockers.includes("desktop_visibility_not_proven"), true);
    assert.equal(withoutApprovalLane.desktop.reasonCodes.some((reason) => reason.startsWith("reason_")), true);
    assert.equal(withoutApprovalLane.desktop.reasonCodes.includes("desktop_visibility_not_proven"), true);

    const noApprovalReceivedLane = invalidAndSensitive.lanes.find((lane) => lane.threadId === "codex_thread:019f-collab-no-approval-received");
    assert.ok(noApprovalReceivedLane);
    assert.equal(noApprovalReceivedLane.nextAction.reason.includes("no approval received"), true);
    assert.equal(noApprovalReceivedLane.reasonCodes.includes("approval_needed"), false);

    const invalidLane = invalidAndSensitive.lanes.find((lane) => lane.threadId === "codex_thread:019f-collab-invalid-report");
    assert.ok(invalidLane);
    assert.equal(invalidLane.desktop.state, "not_configured");
    assert.deepEqual(invalidLane.desktop.evidenceIds, []);

    const conflictLane = invalidAndSensitive.lanes.find((lane) => lane.threadId === "codex_thread:019f-collab-conflict");
    assert.ok(conflictLane);
    assert.equal(conflictLane.desktop.state, "fallback_blocked");
    assert.equal(conflictLane.desktop.requiresFallback, true);
    assert.equal(invalidAndSensitive.summary.desktopVisible, 0);
    assert.equal(invalidAndSensitive.summary.fallbackRequired, 2);
  });
});

test("Codex collaboration cockpit applies priority order to lanes without inbox reasons", () => {
  withIndexedSessions(() => ({
    fixtures: [
      {
        id: "019f-collab-priority-urgent",
        title: "Urgent ordinary collaboration lane",
        status: "running",
        priority: "urgent",
        nextAction: "keep watching ordinary urgent lane",
        updatedAt: relativeIso(25),
        refs: true
      },
      {
        id: "019f-collab-priority-low",
        title: "Low ordinary collaboration lane",
        status: "running",
        priority: "low",
        nextAction: "keep watching ordinary low lane",
        updatedAt: relativeIso(2),
        refs: true
      }
    ]
  }), ({ db }) => {
    const report = createCodexCollaborationCockpit(db, {
      limit: 1,
      now: "2026-07-02T00:00:00.000Z",
      priorityOrder: ["urgent", "high", "medium", "low"]
    });

    assert.equal(report.summary.returned, 1);
    assert.equal(report.lanes[0]?.threadId, "codex_thread:019f-collab-priority-urgent");
  });
});

test("Codex collaboration cockpit ranks Desktop fallback gaps before limiting", () => {
  withIndexedSessions(() => ({
    fixtures: [
      {
        id: "019f-collab-ordinary-urgent",
        title: "Ordinary urgent collaboration lane",
        status: "running",
        priority: "urgent",
        nextAction: "keep watching ordinary urgent lane",
        updatedAt: relativeIso(1),
        refs: true
      },
      {
        id: "019f-collab-desktop-gap",
        title: "Desktop fallback gap lane",
        status: "running",
        priority: "medium",
        nextAction: "inspect Desktop fallback gap",
        updatedAt: relativeIso(20),
        refs: true
      }
    ]
  }), ({ db }) => {
    const report = createCodexCollaborationCockpit(db, {
      limit: 1,
      now: "2026-07-02T00:00:00.000Z",
      priorityOrder: ["urgent", "high", "medium", "low"],
      desktopCoherenceReports: [{
        schema: "lco.codexDesktopCoherence.v1",
        publicSafe: true,
        target: { threadId: "019f-collab-desktop-gap", sourceRef: "codex_thread:019f-collab-desktop-gap" },
        state: "unknown",
        confidence: 0.46,
        evidenceIds: ["ev_desktop_gap"],
        actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
      }]
    });

    assert.equal(report.summary.returned, 1);
    assert.equal(report.lanes[0]?.threadId, "codex_thread:019f-collab-desktop-gap");
    assert.equal(report.lanes[0]?.desktop.requiresFallback, true);
  });
});

test("Codex collaboration cockpit applies attention priority before internal prefetch caps", () => {
  const fixtures = [
    ...Array.from({ length: 500 }, (_, index) => ({
      id: `019f-collab-prefetch-urgent-${String(index).padStart(3, "0")}`,
      title: `Recent urgent lane ${index}`,
      status: "running" as const,
      priority: "urgent" as const,
      nextAction: "keep watching recent urgent lane",
      updatedAt: relativeIso(index + 1),
      refs: true
    })),
    {
      id: "019f-collab-prefetch-desktop-gap",
      title: "Older urgent Desktop gap lane",
      status: "running",
      priority: "urgent",
      nextAction: "inspect older Desktop gap lane",
      updatedAt: relativeIso(1000),
      refs: true
    }
  ];
  withIndexedSessions(fixtures, ({ db }) => {
    const report = createCodexCollaborationCockpit(db, {
      limit: 1,
      now: "2026-07-02T00:00:00.000Z",
      priorityOrder: ["urgent", "high", "medium", "low"],
      desktopCoherenceReports: [{
        schema: "lco.codexDesktopCoherence.v1",
        publicSafe: true,
        target: { threadId: "019f-collab-prefetch-desktop-gap", sourceRef: "codex_thread:019f-collab-prefetch-desktop-gap" },
        state: "unknown",
        confidence: 0.48,
        evidenceIds: ["ev_prefetch_desktop_gap"],
        actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
      }]
    });

    assert.equal(report.summary.totalCards, 501);
    assert.equal(report.summary.returned, 1);
    assert.equal(report.lanes[0]?.threadId, "codex_thread:019f-collab-prefetch-desktop-gap");
    assert.equal(report.lanes[0]?.desktop.requiresFallback, true);
  });
});

test("Codex collaboration cockpit keeps watcher-critical lanes ahead of merely high lanes", () => {
  withIndexedSessions([
    {
      id: "019f-collab-blocked-high",
      title: "Blocked high attention lane",
      status: "blocked",
      priority: "medium",
      blocker: "external wait",
      nextAction: "inspect blocked lane",
      updatedAt: relativeIso(1),
      refs: true
    },
    {
      id: "019f-collab-watcher-critical",
      title: "Watcher critical lane",
      status: "running",
      priority: "low",
      nextAction: "inspect after watcher trigger",
      updatedAt: relativeIso(12),
      refs: true
    }
  ], ({ db }) => {
    const report = createCodexCollaborationCockpit(db, {
      limit: 1,
      now: "2026-07-02T00:00:00.000Z",
      watcherSpecs: [{
        schema: "lco.watchSpec.v1",
        watchId: "watch_collab_critical_ordering",
        targetRef: "codex_thread:019f-collab-watcher-critical",
        kind: "final_message_appeared",
        createdAt: "2026-07-01T23:40:00.000Z",
        lastObservedAt: "2026-07-01T23:59:00.000Z",
        ttlSeconds: 3600,
        stopConditions: ["final_message_seen", "explicit_cancel"],
        wakeReason: "final_message_appeared",
        evidenceIds: ["ev_watch_critical_ordering"],
        confidence: 0.92,
        mutates: false
      }]
    });

    assert.equal(report.summary.returned, 1);
    assert.equal(report.lanes[0]?.threadId, "codex_thread:019f-collab-watcher-critical");
    assert.equal(report.lanes[0]?.attention.level, "critical");
    assert.equal(report.lanes[0]?.reasonCodes.includes("watcher_triggered"), true);
  });
});

test("Codex collaboration cockpit rejects mismatched Desktop targets and requires preferred fallback readiness", () => {
  withIndexedSessions(() => ({
    fixtures: [
      {
        id: "019f-collab-target-a",
        title: "Target A lane",
        status: "running",
        priority: "medium",
        nextAction: "validate target A",
        updatedAt: relativeIso(5),
        refs: true
      },
      {
        id: "019f-collab-target-b",
        title: "Target B lane",
        status: "running",
        priority: "medium",
        nextAction: "validate target B",
        updatedAt: relativeIso(6),
        refs: true
      },
      {
        id: "019f-collab-preferred-blocked",
        title: "Preferred fallback blocked lane",
        status: "running",
        priority: "high",
        nextAction: "check preferred fallback readiness",
        updatedAt: relativeIso(7),
        refs: true
      }
    ]
  }), ({ db }) => {
    const report = createCodexCollaborationCockpit(db, {
      limit: 10,
      now: "2026-07-02T00:00:00.000Z",
      desktopCoherenceReports: [
        {
          schema: "lco.codexDesktopCoherence.v1",
          publicSafe: true,
          target: { threadId: "019f-collab-target-a", sourceRef: "codex_thread:019f-collab-target-b" },
          state: "desktop_visible",
          confidence: 0.98,
          evidenceIds: ["ev_mismatched_target"],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
        },
        {
          schema: "lco.codexDesktopCoherence.v1",
          publicSafe: true,
          target: { threadId: "019f-collab-preferred-blocked", sourceRef: "codex_thread:019f-collab-preferred-blocked" },
          state: "cli_visible",
          confidence: 0.72,
          evidenceIds: ["ev_preferred_blocked_coherence"],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
        }
      ],
      desktopFallbackReports: [{
        schema: "lco.codex.desktopFallback.v1",
        publicSafe: true,
        readOnly: true,
        target: { threadId: "019f-collab-preferred-blocked", sourceRef: "codex_thread:019f-collab-preferred-blocked" },
        fallback: { required: true, reason: "desktop_visibility_not_proven", coherenceState: "cli_visible", desktopVisibility: "not_proven" },
        preferredBackend: "cua-driver",
        backends: [
          { backend: "cua-driver", role: "preferred_background", status: "blocked", blockers: ["permission_missing"], warnings: [], takesScreenWarning: false },
          { backend: "peekaboo", role: "secondary_visible_fallback", status: "ready", blockers: [], warnings: [], takesScreenWarning: true }
        ],
        actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, screenshotCaptured: false, rawTranscriptRead: false }
      }]
    });

    const targetALane = report.lanes.find((lane) => lane.threadId === "codex_thread:019f-collab-target-a");
    const targetBLane = report.lanes.find((lane) => lane.threadId === "codex_thread:019f-collab-target-b");
    const preferredBlockedLane = report.lanes.find((lane) => lane.threadId === "codex_thread:019f-collab-preferred-blocked");

    assert.ok(targetALane);
    assert.ok(targetBLane);
    assert.ok(preferredBlockedLane);
    assert.equal(targetALane.desktop.state, "not_configured");
    assert.equal(targetBLane.desktop.state, "not_configured");
    assert.equal(preferredBlockedLane.desktop.state, "fallback_blocked");
    assert.equal(preferredBlockedLane.desktop.reasonCodes.includes("desktop_fallback_ready"), false);
    assert.equal(preferredBlockedLane.desktop.reasonCodes.includes("desktop_fallback_blocked"), true);
  });
});

test("Codex collaboration cockpit preserves top-level fallback coherence handoff blockers", () => {
  withIndexedSessions(() => ({
    fixtures: [
      {
        id: "019f-collab-coherence-missing",
        title: "Coherence missing fallback lane",
        status: "running",
        priority: "high",
        nextAction: "run coherence before fallback status",
        updatedAt: relativeIso(5),
        refs: true
      }
    ]
  }), ({ db }) => {
    const report = createCodexCollaborationCockpit(db, {
      limit: 5,
      now: "2026-07-02T00:00:00.000Z",
      desktopFallbackReports: [{
        schema: "lco.codex.desktopFallback.v1",
        publicSafe: true,
        readOnly: true,
        target: { threadId: "019f-collab-coherence-missing", sourceRef: "codex_thread:019f-collab-coherence-missing" },
        fallback: { required: false, reason: "coherence_input_missing", coherenceState: null, desktopVisibility: null },
        blockers: ["coherence_input_missing"],
        nextToolCall: {
          tool: "loo_codex_desktop_coherence",
          args: {
            thread_id: "019f-collab-coherence-missing",
            source_ref: "codex_thread:019f-collab-coherence-missing"
          }
        },
        preferredBackend: "cua-driver",
        backends: [
          { backend: "cua-driver", role: "preferred_background", status: "blocked", blockers: [], warnings: [], takesScreenWarning: false },
          { backend: "peekaboo", role: "secondary_visible_fallback", status: "blocked", blockers: [], warnings: [], takesScreenWarning: true }
        ],
        actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, screenshotCaptured: false, rawTranscriptRead: false }
      }]
    });

    const lane = report.lanes.find((candidate) => candidate.threadId === "codex_thread:019f-collab-coherence-missing");
    assert.ok(lane);
    assert.equal(lane.desktop.state, "fallback_blocked");
    assert.equal(lane.desktop.requiresFallback, false);
    assert.equal(lane.desktop.blockers.includes("coherence_input_missing"), true);
    assert.equal(lane.desktop.reasonCodes.includes("coherence_input_missing"), true);
  });
});

test("Codex collaboration cockpit does not treat missing Desktop evidence as low confidence", () => {
  withIndexedSessions(() => ({
    fixtures: [{
      id: "019f-collab-no-desktop-evidence",
      title: "No Desktop evidence lane",
      status: "running",
      priority: "high",
      nextAction: "keep watching indexed lane",
      updatedAt: relativeIso(3),
      refs: true
    }]
  }), ({ db }) => {
    const report = createCodexCollaborationCockpit(db, {
      limit: 5,
      now: "2026-07-02T00:00:00.000Z"
    });

    assert.equal(report.lanes[0]?.desktop.state, "not_configured");
    assert.equal(report.summary.lowConfidence, 0);
  });
});

test("Codex collaboration cockpit reports omitted totals from the full active-session count", () => {
  const fixtures = Array.from({ length: 505 }, (_, index) => ({
    id: `019f-collab-bulk-${String(index).padStart(3, "0")}`,
    title: `Bulk active lane ${index}`,
    status: "running" as const,
    priority: "medium" as const,
    nextAction: "keep watching bulk lane",
    updatedAt: relativeIso(index + 1),
    refs: true
  }));
  withIndexedSessions(fixtures, ({ db }) => {
    const report = createCodexCollaborationCockpit(db, {
      limit: 500,
      now: "2026-07-02T00:00:00.000Z"
    });

    assert.equal(report.summary.totalCards, 505);
    assert.equal(report.summary.returned, 500);
    assert.equal(report.omitted.count, 5);
    assert.equal(report.omitted.reason, "limit");
  });
});

test("Codex collaboration next-step planner emits read-only exact tool packets", () => {
  const tokenCanary = "npm_notarealtokenbutshouldberemoved1234567890";
  withIndexedSessions((sessions) => {
    const rawPathCanary = join(sessions, "rollout-2026-07-02T00-00-00-019f-plan-missing.jsonl");
    return {
      fixtures: [
        {
          id: "019f-plan-watch",
          title: "Watcher triggered planner lane",
          status: "running",
          priority: "urgent",
          nextAction: "inspect watcher update",
          updatedAt: relativeIso(2),
          refs: true
        },
        {
          id: "019f-plan-watch-other",
          title: "Second watcher same id planner lane",
          status: "running",
          priority: "urgent",
          nextAction: "inspect second watcher update",
          updatedAt: relativeIso(2),
          refs: true
        },
        {
          id: "019f-plan-missing",
          title: "Missing Desktop evidence lane",
          status: "running",
          priority: "high",
          nextAction: `gather Desktop evidence from ${rawPathCanary}`,
          updatedAt: relativeIso(3),
          refs: true
        },
        {
          id: "019f-plan-approval-needed",
          title: "Approval needed planner lane",
          status: "needs_approval",
          priority: "high",
          nextAction: "approve dry-run packet before any probe",
          updatedAt: relativeIso(3),
          refs: true
        },
        {
          id: "019f-plan-cli-visible",
          title: "CLI visible planner lane",
          status: "running",
          priority: "medium",
          nextAction: "check fallback readiness",
          updatedAt: relativeIso(4),
          refs: true
        },
        {
          id: "019f-plan-cli-visible-proven",
          title: "CLI visible but coherence proven planner lane",
          status: "running",
          priority: "medium",
          nextAction: "observe proven Desktop visibility",
          updatedAt: relativeIso(4),
          refs: true
        },
        {
          id: "019f-plan-coherence-missing",
          title: "Fallback coherence handoff lane",
          status: "running",
          priority: "medium",
          nextAction: "run coherence handoff",
          updatedAt: relativeIso(5),
          refs: true
        },
        {
          id: "019f-plan-desktop-visible",
          title: "Desktop visible planner lane",
          status: "running",
          priority: "low",
          nextAction: "observe only",
          updatedAt: relativeIso(6),
          refs: true
        },
        {
          id: "019f-plan-unknown-no-coherence",
          title: "Unknown missing coherence planner lane",
          status: "running",
          priority: "low",
          nextAction: "gather coherence first",
          updatedAt: relativeIso(7),
          refs: true
        },
        {
          id: "019f-plan-fallback-ready",
          title: "Fallback ready approval lane",
          status: "running",
          priority: "low",
          nextAction: "wait for approval",
          updatedAt: relativeIso(8),
          refs: true
        },
        {
          id: "019f-plan-fallback-blocked",
          title: "Fallback blocked planner lane",
          status: "running",
          priority: "low",
          nextAction: "approval required before blocked fallback",
          updatedAt: relativeIso(9),
          refs: true
        }
      ],
      canaries: [rawPathCanary, tokenCanary]
    };
  }, ({ db, canaries }) => {
    const now = "2026-07-02T00:00:00.000Z";
    const watcherSpec = {
      schema: "lco.watchSpec.v1" as const,
      watchId: tokenCanary,
      targetRef: "codex_thread:019f-plan-watch",
      kind: "final_message_appeared" as const,
      createdAt: tokenCanary,
      lastObservedAt: tokenCanary,
      ttlSeconds: 3600,
      stopConditions: ["final_message_seen", tokenCanary],
      wakeReason: tokenCanary as any,
      evidenceIds: ["ev_watch_planner", tokenCanary],
      confidence: 0.94,
      mutates: false as const,
      observed: {
        finalMessageCount: 1,
        threadStatus: tokenCanary,
        approvalExpiresAt: tokenCanary
      }
    };
    const duplicateWatcherSpec = {
      ...watcherSpec,
      targetRef: "codex_thread:019f-plan-watch-other",
      evidenceIds: ["ev_watch_planner_other", tokenCanary]
    };
    const report = createCodexCollaborationNextSteps(db, {
      limit: 12,
      now,
      priorityOrder: ["urgent", "high", "medium", "low"],
      watcherSpecs: [watcherSpec, duplicateWatcherSpec],
      desktopCoherenceReports: [
        {
          schema: "lco.codexDesktopCoherence.v1",
          publicSafe: true,
          target: { threadId: "019f-plan-cli-visible", sourceRef: "codex_thread:019f-plan-cli-visible" },
          state: "cli_visible",
          confidence: 0.78,
          evidenceIds: ["ev_cli_visible"],
          reasonCodes: ["desktop_visibility_not_proven"],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
        },
        {
          schema: "lco.codexDesktopCoherence.v1",
          publicSafe: true,
          target: { threadId: "019f-plan-cli-visible-proven", sourceRef: "codex_thread:019f-plan-cli-visible-proven" },
          state: "desktop_visible",
          confidence: 0.88,
          evidenceIds: ["ev_cli_visible_proven"],
          reasonCodes: ["desktop_visible_without_refresh"],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
        },
        {
          schema: "lco.codexDesktopCoherence.v1",
          publicSafe: true,
          target: { threadId: "019f-plan-desktop-visible", sourceRef: "codex_thread:019f-plan-desktop-visible" },
          state: "desktop_visible",
          confidence: 0.9,
          evidenceIds: ["ev_desktop_visible"],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
        }
      ],
      desktopFallbackReports: [
        {
          schema: "lco.codex.desktopFallback.v1",
          publicSafe: true,
          readOnly: true,
          target: { threadId: "019f-plan-coherence-missing", sourceRef: "codex_thread:019f-plan-coherence-missing" },
          fallback: { required: false, reason: "coherence_input_missing", coherenceState: null, desktopVisibility: null },
          blockers: ["coherence_input_missing", tokenCanary],
          nextToolCall: {
            tool: "loo_codex_desktop_coherence",
            args: {
              thread_id: "019f-plan-stale-other",
              source_ref: "codex_thread:019f-plan-stale-other"
            }
          },
          preferredBackend: "cua-driver",
          backends: [
            { backend: "cua-driver", role: "preferred_background", status: "blocked", blockers: [], warnings: [], takesScreenWarning: false }
          ],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, screenshotCaptured: false, rawTranscriptRead: false }
        },
        {
          schema: "lco.codex.desktopFallback.v1",
          publicSafe: true,
          readOnly: true,
          target: { threadId: "019f-plan-unknown-no-coherence", sourceRef: "codex_thread:019f-plan-unknown-no-coherence" },
          fallback: { required: false, reason: "desktop_visibility_unknown", coherenceState: null, desktopVisibility: null },
          blockers: [],
          preferredBackend: "cua-driver",
          backends: [
            { backend: "cua-driver", role: "preferred_background", status: "blocked", blockers: [], warnings: [], takesScreenWarning: false }
          ],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, screenshotCaptured: false, rawTranscriptRead: false }
        },
        {
          schema: "lco.codex.desktopFallback.v1",
          publicSafe: true,
          readOnly: true,
          target: { threadId: "019f-plan-fallback-ready", sourceRef: "codex_thread:019f-plan-fallback-ready" },
          fallback: { required: true, reason: "desktop_fallback_required", coherenceState: "cli_visible", desktopVisibility: null },
          blockers: [],
          preferredBackend: "cua-driver",
          backends: [
            { backend: "cua-driver", role: "preferred_background", status: "ready", blockers: [], warnings: [], takesScreenWarning: false }
          ],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, screenshotCaptured: false, rawTranscriptRead: false }
        },
        {
          schema: "lco.codex.desktopFallback.v1",
          publicSafe: true,
          readOnly: true,
          target: { threadId: "019f-plan-fallback-blocked", sourceRef: "codex_thread:019f-plan-fallback-blocked" },
          fallback: { required: true, reason: "desktop_fallback_required", coherenceState: "cli_visible", desktopVisibility: null },
          blockers: ["permission_missing", tokenCanary],
          preferredBackend: "cua-driver",
          backends: [
            { backend: "cua-driver", role: "preferred_background", status: "blocked", blockers: ["permission_missing"], warnings: [], takesScreenWarning: false }
          ],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, screenshotCaptured: false, rawTranscriptRead: false }
        }
      ]
    });

    const byThread = new Map(report.steps.map((step) => [step.threadId, step]));
    const watcherStep = byThread.get("codex_thread:019f-plan-watch");
    const watcherOtherStep = byThread.get("codex_thread:019f-plan-watch-other");
    const missingStep = byThread.get("codex_thread:019f-plan-missing");
    const approvalNeededStep = byThread.get("codex_thread:019f-plan-approval-needed");
    const cliStep = byThread.get("codex_thread:019f-plan-cli-visible");
    const cliVisibleProvenStep = byThread.get("codex_thread:019f-plan-cli-visible-proven");
    const coherenceHandoffStep = byThread.get("codex_thread:019f-plan-coherence-missing");
    const visibleStep = byThread.get("codex_thread:019f-plan-desktop-visible");
    const unknownNoCoherenceStep = byThread.get("codex_thread:019f-plan-unknown-no-coherence");
    const fallbackReadyStep = byThread.get("codex_thread:019f-plan-fallback-ready");
    const fallbackBlockedStep = byThread.get("codex_thread:019f-plan-fallback-blocked");

    assert.equal(report.schema, "lco.codex.collaborationNextSteps.v1");
    assert.equal(report.publicSafe, true);
    assert.equal(report.readOnly, true);
    assert.equal(report.summary.returned, 11);
    assert.equal(report.summary.blocked, 3);
    assert.equal(report.summary.ready + report.summary.blocked + report.summary.noop, report.summary.returned);
    assert.equal(report.actionsPerformed.liveCodexControlRun, false);
    assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
    assert.equal(report.actionsPerformed.screenshotCaptured, false);

    assert.equal(watcherStep?.category, "watcher_resume_packet");
    assert.equal(watcherStep?.status, "ready");
    assert.equal(watcherStep?.toolCall?.tool, "loo_resume_request_packet");
    assert.equal(watcherStep?.toolCall?.execute, false);
    assert.equal(watcherStep?.toolCall?.args.recommended_action, "resume");
    assert.equal((watcherStep?.toolCall?.args.watcher_spec as Record<string, unknown> | undefined)?.target_ref, "codex_thread:019f-plan-watch");
    assert.equal((watcherOtherStep?.toolCall?.args.watcher_spec as Record<string, unknown> | undefined)?.target_ref, "codex_thread:019f-plan-watch-other");

    assert.equal(missingStep?.category, "desktop_coherence");
    assert.equal(missingStep?.toolCall?.tool, "loo_codex_desktop_coherence");
    assert.deepEqual(missingStep?.toolCall?.args, {
      thread_id: "019f-plan-missing",
      source_ref: "codex_thread:019f-plan-missing"
    });

    assert.equal(approvalNeededStep?.category, "approval_boundary");
    assert.equal(approvalNeededStep?.status, "blocked");
    assert.equal(approvalNeededStep?.toolCall, null);
    assert.equal(approvalNeededStep?.blockers.includes("approval_required"), true);

    assert.equal(cliStep?.category, "desktop_fallback_status");
    assert.equal(cliStep?.toolCall?.tool, "loo_codex_desktop_fallback_status");
    assert.equal(cliStep?.toolCall?.execute, false);
    assert.equal((cliStep?.toolCall?.args.coherence as Record<string, unknown> | undefined)?.state, "cli_visible");

    assert.equal(cliVisibleProvenStep?.category, "observe");
    assert.equal(cliVisibleProvenStep?.status, "noop");
    assert.equal(cliVisibleProvenStep?.toolCall, null);
    assert.equal(cliVisibleProvenStep?.reasonCodes.includes("desktop_fallback_status_required"), false);

    assert.equal(coherenceHandoffStep?.category, "desktop_coherence");
    assert.equal(coherenceHandoffStep?.reasonCodes.includes("coherence_input_missing"), true);
    assert.equal(coherenceHandoffStep?.toolCall?.tool, "loo_codex_desktop_coherence");
    assert.equal(coherenceHandoffStep?.toolCall?.execute, false);
    assert.deepEqual(coherenceHandoffStep?.toolCall?.args, {
      thread_id: "019f-plan-coherence-missing",
      source_ref: "codex_thread:019f-plan-coherence-missing"
    });

    assert.equal(visibleStep?.category, "observe");
    assert.equal(visibleStep?.status, "noop");
    assert.equal(visibleStep?.toolCall, null);
    assert.equal(visibleStep?.reasonCodes.includes("desktop_visible_no_action"), true);

    assert.equal(unknownNoCoherenceStep?.category, "desktop_coherence");
    assert.equal(unknownNoCoherenceStep?.toolCall?.tool, "loo_codex_desktop_coherence");
    assert.equal(unknownNoCoherenceStep?.toolCall?.execute, false);
    assert.deepEqual(unknownNoCoherenceStep?.toolCall?.args, {
      thread_id: "019f-plan-unknown-no-coherence",
      source_ref: "codex_thread:019f-plan-unknown-no-coherence"
    });

    assert.equal(fallbackReadyStep?.category, "desktop_action_approval");
    assert.equal(fallbackReadyStep?.status, "blocked");
    assert.equal(fallbackReadyStep?.toolCall, null);
    assert.equal(fallbackReadyStep?.reasonCodes.includes("approval_required"), true);
    assert.deepEqual(fallbackReadyStep?.blockers, ["desktop_action_approval_required", "approval_required"]);

    assert.equal(fallbackBlockedStep?.category, "desktop_action_approval");
    assert.equal(fallbackBlockedStep?.status, "blocked");
    assert.equal(fallbackBlockedStep?.toolCall, null);
    assert.equal(fallbackBlockedStep?.reasonCodes.includes("approval_required"), true);
    assert.equal(fallbackBlockedStep?.blockers.includes("permission_missing"), true);
    assert.equal(fallbackBlockedStep?.blockers.includes("approval_required"), true);

    assertNoUnsafeStrings(report, ...canaries);
  });
});

test("Codex collaboration next-step planner sanitizes caller-controlled now and coherence state", () => {
  const tokenCanary = "ghp_notarealtokenbutshouldnotleak1234567890";
  withIndexedSessions([
    {
      id: "019f-plan-approval-text",
      title: "Approval text planner lane",
      status: "running",
      priority: "high",
      nextAction: "approval required before Desktop probe",
      updatedAt: relativeIso(2),
      refs: true
    },
    {
      id: "019f-plan-state-clamp",
      title: "Coherence state clamp planner lane",
      status: "running",
      priority: "medium",
      nextAction: "check fallback readiness",
      updatedAt: relativeIso(3),
      refs: true
    }
  ], ({ db }) => {
    const report = createCodexCollaborationNextSteps(db, {
      limit: 5,
      now: tokenCanary,
      desktopCoherenceReports: [
        {
          schema: "lco.codexDesktopCoherence.v1",
          publicSafe: true,
          target: { threadId: "019f-plan-state-clamp", sourceRef: "codex_thread:019f-plan-state-clamp" },
          state: tokenCanary,
          confidence: 0.78,
          evidenceIds: ["ev_state_clamp"],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
        }
      ]
    });

    const byThread = new Map(report.steps.map((step) => [step.threadId, step]));
    const approvalTextStep = byThread.get("codex_thread:019f-plan-approval-text");
    const stateClampStep = byThread.get("codex_thread:019f-plan-state-clamp");
    const coherenceArg = stateClampStep?.toolCall?.args.coherence as Record<string, unknown> | undefined;

    assert.equal(approvalTextStep?.category, "approval_boundary");
    assert.equal(approvalTextStep?.status, "blocked");
    assert.equal(approvalTextStep?.toolCall, null);
    assert.equal(stateClampStep?.toolCall?.tool, "loo_codex_desktop_fallback_status");
    assert.equal(coherenceArg?.state, "unknown");
    assert.notEqual(report.generatedAt, tokenCanary);
    assertNoUnsafeStrings(report, tokenCanary);
  });
});

test("Codex runtime Desktop visibility status summarizes coverage without actions", () => {
  const rawPathCanary = "/Volumes/LEXAR/Codex/private/codex/session.jsonl";
  const tokenCanary = "npm_notarealtokenbutshouldnotleak1234567890";
  withIndexedSessions([
    {
      id: "019f-runtime-visible",
      title: "Runtime visible lane",
      status: "running",
      priority: "high",
      nextAction: "observe visible state",
      updatedAt: relativeIso(2),
      refs: true
    },
    {
      id: "019f-runtime-missing",
      title: "Runtime missing lane",
      status: "running",
      priority: "high",
      nextAction: `prove Desktop visibility ${rawPathCanary}`,
      updatedAt: relativeIso(3),
      refs: true
    },
    {
      id: "019f-runtime-proof-ready",
      title: "Runtime proof ready lane",
      status: "running",
      priority: "medium",
      nextAction: "validate action-bound proof",
      updatedAt: relativeIso(4),
      refs: true
    }
  ], ({ db }) => {
    const report = createCodexRuntimeDesktopVisibilityStatus(db, {
      limit: 5,
      now: tokenCanary,
      desktopCoherenceReports: [
        {
          schema: "lco.codexDesktopCoherence.v1",
          publicSafe: true,
          target: { threadId: "019f-runtime-visible", sourceRef: "codex_thread:019f-runtime-visible" },
          state: "desktop_visible",
          confidence: 0.93,
          evidenceIds: ["ev_runtime_visible"],
          reasonCodes: ["desktop_visible_candidate"],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
        },
        {
          schema: "lco.codexDesktopCoherence.v1",
          publicSafe: true,
          target: { threadId: "019f-runtime-proof-ready", sourceRef: "codex_thread:019f-runtime-proof-ready" },
          state: "cli_visible",
          confidence: 0.78,
          evidenceIds: ["ev_runtime_cli"],
          reasonCodes: ["cli_direct_visible_without_desktop_proof"],
          actionsPerformed: { liveCodexControlRun: false, desktopGuiActionRun: false, rawTranscriptRead: false }
        }
      ],
      desktopCollaborationProofReports: [
        {
          schema: "lco.codexDesktopCollaborationProof.v1",
          publicSafe: true,
          readOnly: true,
          ok: true,
          status: "ready",
          target: {
            targetRef: "codex_thread:019f-runtime-proof-ready",
            targetThreadId: "019f-runtime-proof-ready"
          },
          actionHash: "a".repeat(64),
          approvalVerified: true,
          blockers: [],
          sourceCoverage: {
            indexedSession: "ok",
            desktopCoherence: "ok",
            desktopFallback: "ok",
            approvalPacket: "ok"
          },
          proofMarkers: {
            actionBoundTarget: true,
            approvalPacketBound: true,
            publicSafeEvidenceOnly: true,
            noScreenshotPolicy: true,
            dryRunOnly: true
          },
          requiredNextToolCall: {
            tool: "loo_desktop_live_proof_harness",
            args: { backend: "cua-driver", approval_ref: "issue-342" },
            execute: false
          },
          actionsPerformed: {
            liveCodexControlRun: false,
            desktopGuiActionRun: false,
            rawTranscriptRead: false,
            screenshotCaptured: false
          }
        },
        {
          schema: "lco.codexDesktopCollaborationProof.v1",
          publicSafe: true,
          readOnly: true,
          ok: true,
          status: "ready",
          target: {
            targetRef: `codex_thread:019f-runtime-missing${rawPathCanary}`,
            targetThreadId: "019f-runtime-missing"
          },
          actionHash: "b".repeat(64),
          approvalVerified: true,
          blockers: [tokenCanary],
          sourceCoverage: {
            indexedSession: "ok",
            desktopCoherence: "partial",
            desktopFallback: "ok",
            approvalPacket: "ok"
          },
          proofMarkers: {
            actionBoundTarget: true,
            approvalPacketBound: true,
            publicSafeEvidenceOnly: false,
            noScreenshotPolicy: true,
            dryRunOnly: true
          },
          actionsPerformed: {
            liveCodexControlRun: false,
            desktopGuiActionRun: false,
            rawTranscriptRead: false,
            screenshotCaptured: false
          }
        }
      ]
    });

    const byThread = new Map(report.lanes.map((lane) => [lane.threadId, lane]));
    const visible = byThread.get("codex_thread:019f-runtime-visible");
    const missing = byThread.get("codex_thread:019f-runtime-missing");
    const proofReady = byThread.get("codex_thread:019f-runtime-proof-ready");

    assert.equal(report.schema, "lco.codex.runtimeDesktopVisibilityStatus.v1");
    assert.equal(report.publicSafe, true);
    assert.equal(report.readOnly, true);
    assert.equal(report.status, "partial");
    assert.equal(report.summary.covered, 2);
    assert.equal(report.summary.blocked, 1);
    assert.equal(report.sourceCoverage.desktopCollaborationProof, "partial");
    assert.equal(visible?.coverage, "covered");
    assert.equal(visible?.nextToolCall, null);
    assert.equal(proofReady?.coverage, "covered");
    assert.equal(proofReady?.reasonCodes.includes("action_bound_desktop_proof_ready"), true);
    assert.equal(proofReady?.nextToolCall?.execute, false);
    assert.equal(proofReady?.nextToolCall?.tool, "loo_desktop_live_proof_harness");
    assert.equal(missing?.coverage, "blocked");
    assert.equal(missing?.blockers.includes("desktop_visibility_runtime_proof_missing"), true);
    assert.equal(missing?.nextToolCall?.tool, "loo_codex_desktop_coherence");
    assert.equal(missing?.nextToolCall?.execute, false);
    assert.deepEqual(missing?.nextToolCall?.args, {
      thread_id: "019f-runtime-missing",
      source_ref: "codex_thread:019f-runtime-missing"
    });
    assert.equal(report.actionsPerformed.liveCodexControlRun, false);
    assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
    assert.equal(report.actionsPerformed.screenshotCaptured, false);
    assert.notEqual(report.generatedAt, tokenCanary);
    assertNoUnsafeStrings(report, rawPathCanary, tokenCanary);
  });
});

test("Codex active-thread state classifies running blocked stale and needs-nudge lanes read-only", () => {
  const rawPathCanary = "/Volumes/LEXAR/Codex/private/codex/session.jsonl";
  const tokenCanary = "npm_notarealtokenbutshouldnotleak1234567890";
  withIndexedSessions([
    {
      id: "019f-state-running",
      title: "Running state lane",
      status: "running",
      priority: "medium",
      nextAction: "continue watching running lane",
      updatedAt: relativeIso(2),
      refs: true
    },
    {
      id: "019f-state-blocked",
      title: "Blocked state lane",
      status: "blocked",
      priority: "urgent",
      blocker: "CI failed",
      nextAction: "inspect blocked lane",
      updatedAt: relativeIso(3),
      refs: true
    },
    {
      id: "019f-state-approval",
      title: "Approval state lane",
      status: "needs_approval",
      priority: "high",
      nextAction: "approve dry-run packet",
      updatedAt: relativeIso(4),
      refs: true
    },
    {
      id: "019f-state-needs-nudge",
      title: "Needs nudge state lane",
      status: "running",
      priority: "high",
      nextAction: "resume after watcher trigger",
      updatedAt: relativeIso(120),
      refs: true
    },
    {
      id: "019f-state-stale",
      title: "Stale state lane",
      status: "running",
      priority: "medium",
      nextAction: `inspect stale lane ${rawPathCanary}`,
      updatedAt: "2026-06-20T00:00:00.000Z",
      refs: true
    },
    {
      id: "019f-state-conflict",
      title: "Conflict state lane",
      status: "running",
      priority: "medium",
      nextAction: "inspect conflicting app-server state",
      updatedAt: relativeIso(5),
      refs: true
    },
    {
      id: "019f-state-loaded-only",
      title: "Loaded only app-server lane",
      status: "mysterious",
      priority: "medium",
      nextAction: "inspect loaded metadata only",
      updatedAt: relativeIso(6),
      refs: true
    }
  ], ({ db }) => {
    const now = "2026-07-02T00:00:00.000Z";
    const report = createCodexActiveThreadState(db, {
      limit: 10,
      now,
      watcherSpecs: [
        {
          schema: "lco.watchSpec.v1",
          watchId: tokenCanary,
          targetRef: "codex_thread:019f-state-needs-nudge",
          kind: "no_activity",
          createdAt: "2026-07-01T22:00:00.000Z",
          lastObservedAt: "2026-07-01T22:00:00.000Z",
          ttlSeconds: 14400,
          staleAfterSeconds: 1800,
          stopConditions: ["thread_resumed", tokenCanary],
          evidenceIds: ["ev_no_activity", tokenCanary],
          confidence: 0.91,
          mutates: false,
          observed: { noActivitySeconds: 3600 }
        },
        {
          schema: "lco.watchSpec.v1",
          watchId: "watch_state_stale",
          targetRef: "codex_thread:019f-state-stale",
          kind: "no_activity",
          createdAt: "2026-07-01T12:00:00.000Z",
          lastObservedAt: "2026-07-01T12:00:00.000Z",
          ttlSeconds: 172800,
          staleAfterSeconds: 1800,
          stopConditions: ["thread_resumed"],
          evidenceIds: ["ev_stale_watch"],
          confidence: 0.82,
          mutates: false
        }
      ],
      appServerThreads: {
        schema: "lco.codex.appServerThreads.v1",
        publicSafe: true,
        sourceCoverage: { codexAppServer: "ok" },
        threads: [
          {
            threadId: "019f-state-running",
            sourceRef: "codex_thread:019f-state-running",
            status: "running",
            loaded: true,
            loadedState: "loaded",
            confidence: 0.95
          },
          {
            threadId: "019f-state-needs-nudge",
            sourceRef: "codex_thread:019f-state-needs-nudge",
            status: "blocked",
            loaded: true,
            loadedState: "loaded",
            confidence: 0.93
          },
          {
            threadId: "019f-state-conflict",
            sourceRef: "codex_thread:019f-state-conflict",
            status: "blocked",
            loaded: true,
            loadedState: "loaded",
            confidence: 0
          },
          {
            threadId: "019f-state-loaded-only",
            sourceRef: "codex_thread:019f-state-loaded-only",
            loaded: true,
            loadedState: "loaded",
            confidence: 0.89
          }
        ],
        loadedThreadRefs: ["codex_thread:019f-state-running", "codex_thread:019f-state-needs-nudge", "codex_thread:019f-state-conflict", "codex_thread:019f-state-loaded-only"]
      }
    });

    const tools = createLooTools({
      db,
      audit: createAuditStore(join(tmpdir(), "loo-active-state-audit.jsonl")),
      codexClient: { request: async () => ({ ok: true }) }
    });
    const tool = tools.find((candidate) => candidate.name === "loo_codex_active_thread_state");
    assert.ok(tool, "MCP registry should expose loo_codex_active_thread_state");

    const byThread = new Map(report.items.map((item) => [item.threadId, item]));
    assert.equal(report.schema, "lco.codex.activeThreadState.v1");
    assert.equal(report.publicSafe, true);
    assert.equal(report.readOnly, true);
    assert.equal(report.generatedAt, now);
    assert.equal(report.summary.returned, 7);
    assert.equal(report.summary.running, 1);
    assert.equal(report.summary.blocked, 1);
    assert.equal(report.summary.needsApproval, 1);
    assert.equal(report.summary.needsNudge, 1);
    assert.equal(report.summary.stale, 1);
    assert.equal(report.summary.unknown, 2);
    assert.equal(report.sourceCoverage.watchers, "ok");
    assert.equal(report.sourceCoverage.codexAppServer, "ok");
    assert.equal(byThread.get("codex_thread:019f-state-running")?.state, "running");
    assert.equal(byThread.get("codex_thread:019f-state-running")?.reasonCodes.includes("app_server_running"), true);
    assert.equal(byThread.get("codex_thread:019f-state-running")?.sourceCoverage.watchers, "partial");
    assert.equal(byThread.get("codex_thread:019f-state-running")?.sourceCoverage.codexAppServer, "ok");
    assert.equal(byThread.get("codex_thread:019f-state-blocked")?.state, "blocked");
    assert.equal(byThread.get("codex_thread:019f-state-blocked")?.sourceCoverage.codexAppServer, "partial");
    assert.equal(byThread.get("codex_thread:019f-state-approval")?.state, "needs_approval");
    assert.equal(byThread.get("codex_thread:019f-state-needs-nudge")?.state, "needs_nudge");
    assert.equal(byThread.get("codex_thread:019f-state-needs-nudge")?.reasonCodes.includes("watcher_triggered"), true);
    assert.equal(byThread.get("codex_thread:019f-state-needs-nudge")?.reasonCodes.includes("app_server_state_overridden_by_watcher"), true);
    assert.equal((byThread.get("codex_thread:019f-state-needs-nudge")?.confidence ?? 1) <= 0.74, true);
    assert.equal(byThread.get("codex_thread:019f-state-needs-nudge")?.sourceCoverage.watchers, "ok");
    assert.equal(byThread.get("codex_thread:019f-state-stale")?.state, "stale");
    assert.equal(byThread.get("codex_thread:019f-state-stale")?.reasonCodes.includes("watcher_stale"), true);
    assert.equal(byThread.get("codex_thread:019f-state-conflict")?.state, "unknown");
    assert.equal(byThread.get("codex_thread:019f-state-conflict")?.confidence, 0);
    assert.equal(byThread.get("codex_thread:019f-state-conflict")?.reasonCodes.includes("conflicting_state"), true);
    assert.equal(byThread.get("codex_thread:019f-state-loaded-only")?.state, "unknown");
    assert.equal(byThread.get("codex_thread:019f-state-loaded-only")?.reasonCodes.includes("app_server_loaded"), true);
    assert.equal(byThread.get("codex_thread:019f-state-loaded-only")?.reasonCodes.includes("app_server_running"), false);
    assert.equal(report.items[0]?.state, "needs_nudge");
    assert.equal(report.actionsPerformed.liveCodexControlRun, false);
    assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
    assert.equal(report.actionsPerformed.rawTranscriptRead, false);
    assert.equal(report.actionsPerformed.screenshotCaptured, false);
    assertNoUnsafeStrings(report, rawPathCanary, tokenCanary);
  });
});

test("Codex active-thread state classifies before applying caller limit", () => {
  const fixtures = [
    ...Array.from({ length: 25 }, (_, index) => ({
      id: `019f-active-limit-running-${String(index).padStart(2, "0")}`,
      title: `Fresh running lane ${index}`,
      status: "running",
      priority: "urgent",
      nextAction: "continue current work",
      updatedAt: relativeIso(index + 1),
      refs: true
    })),
    {
      id: "019f-active-limit-nudge",
      title: "Watcher triggered low priority lane",
      status: "running",
      priority: "low",
      nextAction: "resume watcher-triggered work",
      updatedAt: relativeIso(120),
      refs: true
    }
  ];

  withIndexedSessions(fixtures, ({ db }) => {
    const report = createCodexActiveThreadState(db, {
      limit: 1,
      now: "2026-07-02T00:00:00.000Z",
      watcherSpecs: [{
        schema: "lco.watchSpec.v1",
        watchId: "watch_active_limit_nudge",
        targetRef: "codex_thread:019f-active-limit-nudge",
        kind: "no_activity",
        createdAt: "2026-07-01T22:00:00.000Z",
        lastObservedAt: "2026-07-01T22:00:00.000Z",
        ttlSeconds: 14400,
        staleAfterSeconds: 1800,
        stopConditions: ["thread_resumed"],
        evidenceIds: ["ev_active_limit_nudge"],
        confidence: 0.93,
        mutates: false,
        observed: { noActivitySeconds: 3600 }
      }]
    });

    assert.equal(report.summary.totalLanes, 26);
    assert.equal(report.summary.returned, 1);
    assert.equal(report.items[0]?.threadId, "codex_thread:019f-active-limit-nudge");
    assert.equal(report.items[0]?.state, "needs_nudge");
    assert.equal(report.omitted.count, 25);
    assert.equal(report.omitted.reason, "limit");
  });
});

type IndexedSessionContext = {
  db: LooDatabase;
  root: string;
  sessions: string;
  canaries: string[];
};

type SessionFixtureFactoryResult = {
  fixtures: SessionFixture[];
  canaries?: string[];
};

function withIndexedSessions(
  fixturesOrFactory: SessionFixture[] | ((sessions: string) => SessionFixture[] | SessionFixtureFactoryResult),
  run: (context: IndexedSessionContext) => void
): void {
  const root = mkdtempSync(join(tmpdir(), "loo-autonomy-operating-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const result = typeof fixturesOrFactory === "function" ? fixturesOrFactory(sessions) : fixturesOrFactory;
  const fixtures = Array.isArray(result) ? result : result.fixtures;
  const canaries = Array.isArray(result) ? [] : result.canaries ?? [];
  for (const fixture of fixtures) writeSessionFixture(sessions, fixture);
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: Math.max(10, fixtures.length + 1) });
    run({ db, root, sessions, canaries });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

async function withIndexedSessionsAsync(
  fixturesOrFactory: SessionFixture[] | ((sessions: string) => SessionFixture[] | SessionFixtureFactoryResult),
  run: (context: IndexedSessionContext) => Promise<void>
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "loo-autonomy-operating-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const result = typeof fixturesOrFactory === "function" ? fixturesOrFactory(sessions) : fixturesOrFactory;
  const fixtures = Array.isArray(result) ? result : result.fixtures;
  const canaries = Array.isArray(result) ? [] : result.canaries ?? [];
  for (const fixture of fixtures) writeSessionFixture(sessions, fixture);
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    await run({ db, root, sessions, canaries });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function relativeIso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function writeSessionFixture(root: string, fixture: SessionFixture): void {
  const refs = fixture.refs === true
    ? [
        `Proposed plan refs: codex_event:${fixture.id}-plan`,
        `Final-message refs: codex_event:${fixture.id}-final`,
        `Touched-file refs: codex_event:${fixture.id}-file`
      ]
    : [];
  const lines = [
    {
      timestamp: fixture.updatedAt,
      session_meta: {
        payload: {
          id: fixture.id,
          cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator",
          model: "gpt-5.5",
          git: { branch: "main", commit_hash: "abc1234" }
        }
      }
    },
    { timestamp: fixture.updatedAt, event_msg: { type: "thread_name", name: fixture.title } },
    {
      timestamp: fixture.updatedAt,
      event_msg: {
        type: "agent_message",
        message: [
          ...(fixture.project === null ? [] : [`Project: ${fixture.project ?? "lossless-openclaw-orchestrator"}`]),
          `Status: ${fixture.status}`,
          `Priority: ${fixture.priority}`,
          "Owner: codex",
          `Blocker: ${fixture.blocker ?? "none"}`,
          `Next action: ${fixture.nextAction}`,
          "Closeout state: ready",
          ...refs,
          `Source refs: codex_thread:${fixture.id}`,
          ...(fixture.extra ?? [])
        ].join("\n")
      }
    }
  ];
  writeFileSync(join(root, `rollout-2026-07-01T00-00-00-${fixture.id}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

function assertNoUnsafeStrings(value: unknown, ...canaries: string[]): void {
  const json = JSON.stringify(value);
  for (const canary of canaries) assert.equal(json.includes(canary), false, `unsafe canary leaked: ${canary}`);
  assert.equal(/\/Volumes\/LEXAR\/[^\s"\\]+\.jsonl/.test(json), false, "absolute transcript path leaked");
  assert.equal(/authorization:\s*Bearer\s+[A-Za-z0-9._-]+/i.test(json), false, "bearer token leaked");
}
