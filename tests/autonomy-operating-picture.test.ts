import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuditStore } from "../packages/adapters/src/index.js";
import {
  createBusinessPulse,
  createDatabase,
  createDefaultSourceAuthorityProfile,
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
  const pendingReport = createGithubOperatingItemsReport([
    {
      repo: "100yenadmin/Lossless-Codex-Orchestrator-LCO",
      number: 270,
      kind: "pull_request",
      title: "Live queued statusCheckRollup",
      state: "open",
      updatedAt: relativeIso(4),
      statusCheckRollup: {
        contexts: {
          nodes: [
            { __typename: "CheckRun", name: "test", status: "QUEUED", conclusion: null },
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
    assert.equal(missingStructuredSources.sourceCoverage.plan_state, "not_configured");
    assert.equal(boundaryOnlyDigest.sourceCoverage.plan_state, "ok");
    assert.equal(limitedDigest.cards.length, 2);
    assert.equal(limitedDigest.signals.length, 2);

    const attention = createBusinessPulse(db, { window: "7d", limit: 5, planStatePins: pins });
    assert.equal(attention.digest.health.finance.state, "unknown");
    assert.equal(attention.digest.health.finance.reason, "stripe_adapter_not_configured");
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

    const recent = await tools.find((tool) => tool.name === "loo_recent_sessions")?.execute({ limit: 5, include_cards: true });
    assert.equal((recent as { publicSafe?: boolean }).publicSafe, true);

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
    await assert.rejects(
      async () => projectDigestTool.execute({ github_items: [{}] }),
      /github_items\[0\] requires id and title/
    );

    const pulse = await tools.find((tool) => tool.name === "loo_business_pulse")?.execute({ limit: 5 });
    assert.equal((pulse as { digest?: { sourceCoverage?: { plan_state?: string; stripe?: string } } }).digest?.sourceCoverage?.plan_state, "not_configured");
    assert.equal((pulse as { digest?: { sourceCoverage?: { plan_state?: string; stripe?: string } } }).digest?.sourceCoverage?.stripe, "not_configured");
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
    assertNoUnsafeStrings({ recent, pins, pulse, watcherDryRun }, sessions);
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
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
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
