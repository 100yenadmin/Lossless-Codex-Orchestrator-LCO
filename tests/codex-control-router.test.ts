import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createAuditStore,
  createCodexControl,
  type CodexClient,
  type CodexControlSequenceOptions,
  type CodexControlStep
} from "../packages/adapters/src/index.js";
import { createCodexControlRouter } from "../packages/mcp-server/src/codex-control-router.js";

type FixtureThread = {
  id: string;
  name: string;
  state: "active" | "idle";
  turnId?: string;
};

function fixtureClient(threads: FixtureThread[], sequenceFailure?: "active_turn_not_steerable") {
  let current = threads;
  const requestCalls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const sequenceCalls: Array<{ steps: CodexControlStep[]; options: CodexControlSequenceOptions }> = [];
  const client: CodexClient = {
    async request(method, params) {
      requestCalls.push({ method, params });
      if (method === "thread/loaded/list") {
        return { ok: true, result: { data: current.map((thread) => thread.id) }, notifications: [] };
      }
      if (method === "thread/read") {
        const thread = current.find((candidate) => candidate.id === params.threadId);
        if (!thread) return { ok: false, error: "not found", notifications: [] };
        return {
          ok: true,
          result: {
            thread: {
              id: thread.id,
              name: thread.name,
              status: { type: thread.state },
              cwd: "/private/fixture/path",
              preview: "PRIVATE_TRANSCRIPT_CANARY",
              turns: thread.turnId
                ? [{ id: thread.turnId, status: "inProgress", items: [{ text: "PRIVATE_TURN_CANARY" }] }]
                : []
            }
          },
          notifications: []
        };
      }
      if (method === "turn/start") {
        return {
          ok: true,
          result: { turn: { id: "turn-new", status: "inProgress" } },
          notifications: []
        };
      }
      throw new Error(`Unexpected method ${method}`);
    },
    async requestSequenceUntilTurnResolved(steps, options) {
      sequenceCalls.push({ steps, options });
      if (sequenceFailure === "active_turn_not_steerable") {
        return {
          responses: [
            {
              ok: true,
              result: {
                approvalPolicy: "never",
                sandbox: { type: "readOnly", networkAccess: false }
              }
            },
            {
              ok: false,
              error: { codexErrorInfo: { activeTurnNotSteerable: { turnKind: "review" } } }
            }
          ]
        };
      }
      const turnResponse = { ok: true, result: { turn: { id: options.expectedTurnId ?? "turn-new", status: "completed" } } };
      return {
        responses: steps[0]?.method === "turn/start"
          ? [turnResponse]
          : [
              {
                ok: true,
                result: {
                  approvalPolicy: "never",
                  sandbox: { type: "readOnly", networkAccess: false }
                }
              },
              turnResponse
            ],
        turn: {
          id: options.expectedTurnId ?? "turn-new",
          status: "completed",
          completed: true,
          notificationMethods: ["turn/completed"],
          approvalRequestCount: 0,
          serverRequestCount: 0
        }
      };
    }
  };
  return {
    client,
    requestCalls,
    sequenceCalls,
    setThreads(next: FixtureThread[]) {
      current = next;
    }
  };
}

test("control route returns an opaque active target without transcript, path, thread, or turn identifiers", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-router-active-"));
  const fixture = fixtureClient([{
    id: "thread-secret-active",
    name: "Release task",
    state: "active",
    turnId: "turn-secret-active"
  }]);
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const router = createCodexControlRouter({
    client: fixture.client,
    control: createCodexControl({ audit, client: fixture.client }),
    createRef: () => "lco_target_opaque",
    now: () => new Date("2026-07-30T10:00:00Z")
  });

  try {
    const route = await router.route({});
    assert.equal(route.schema, "lco.codex.controlRoute.v1");
    assert.equal(route.status, "selected");
    assert.equal(route.route, "app_server");
    assert.equal(route.target_ref, "lco_target_opaque");
    assert.equal(route.state, "active");
    assert.deepEqual(route.supported_actions, ["steer", "interrupt"]);
    const serialized = JSON.stringify(route);
    for (const forbidden of [
      "thread-secret-active",
      "turn-secret-active",
      "PRIVATE_TRANSCRIPT_CANARY",
      "PRIVATE_TURN_CANARY",
      "/private/fixture/path"
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
    assert.deepEqual(
      fixture.requestCalls
        .filter((call) => call.method === "thread/read")
        .map((call) => call.params.includeTurns),
      [false, true]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("delivery chooses active steer, revalidates state, and blocks a changed turn before mutation", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-router-deliver-"));
  const fixture = fixtureClient([{
    id: "thread-active",
    name: "Active task",
    state: "active",
    turnId: "turn-active-1"
  }]);
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const router = createCodexControlRouter({
    client: fixture.client,
    control: createCodexControl({ audit, client: fixture.client }),
    createRef: () => "lco_target_active",
    now: () => new Date("2026-07-30T10:00:00Z")
  });

  try {
    const route = await router.route({});
    const dryRun = await router.deliver({
      targetRef: route.target_ref!,
      message: "Continue safely"
    });
    assert.equal(dryRun.status, "dry_run_ready");
    assert.equal(dryRun.action, "steer");
    assert.equal(fixture.sequenceCalls.length, 0);

    fixture.setThreads([{
      id: "thread-active",
      name: "Active task",
      state: "active",
      turnId: "turn-active-2"
    }]);
    const blocked = await router.deliver({
      targetRef: route.target_ref!,
      message: "Continue safely",
      dryRun: false,
      approvalAuditId: dryRun.approval_audit_id
    });
    assert.equal(blocked.status, "blocked");
    assert.deepEqual(blocked.reason_codes, ["target_turn_changed"]);
    assert.equal(fixture.sequenceCalls.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("delivery sends to idle targets and interrupt accepts the same opaque active reference", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-router-actions-"));
  const idleFixture = fixtureClient([{
    id: "thread-idle",
    name: "Idle task",
    state: "idle"
  }]);
  const idleAudit = createAuditStore(join(root, "idle-audit.jsonl"));
  const idleRouter = createCodexControlRouter({
    client: idleFixture.client,
    control: createCodexControl({ audit: idleAudit, client: idleFixture.client }),
    createRef: () => "lco_target_idle"
  });

  const activeFixture = fixtureClient([{
    id: "thread-active",
    name: "Active task",
    state: "active",
    turnId: "turn-active"
  }]);
  const activeAudit = createAuditStore(join(root, "active-audit.jsonl"));
  const activeRouter = createCodexControlRouter({
    client: activeFixture.client,
    control: createCodexControl({ audit: activeAudit, client: activeFixture.client }),
    createRef: () => "lco_target_active"
  });

  try {
    const idleRoute = await idleRouter.route({});
    assert.deepEqual(
      idleFixture.requestCalls
        .filter((call) => call.method === "thread/read")
        .map((call) => call.params.includeTurns),
      [false]
    );
    const idleDryRun = await idleRouter.deliver({
      targetRef: idleRoute.target_ref!,
      message: "Start work"
    });
    assert.equal(idleDryRun.action, "send");
    const idleLive = await idleRouter.deliver({
      targetRef: idleRoute.target_ref!,
      message: "Start work",
      dryRun: false,
      approvalAuditId: idleDryRun.approval_audit_id
    });
    assert.equal(idleLive.status, "accepted");
    assert.equal(idleFixture.requestCalls.some((call) => call.method === "turn/start"), true);
    assert.equal(idleFixture.sequenceCalls.length, 0);

    const activeRoute = await activeRouter.route({});
    const interruptDryRun = await activeRouter.interrupt({ targetRef: activeRoute.target_ref! });
    assert.equal(interruptDryRun.action, "interrupt");
    const interruptLive = await activeRouter.interrupt({
      targetRef: activeRoute.target_ref!,
      dryRun: false,
      approvalAuditId: interruptDryRun.approval_audit_id
    });
    assert.equal(interruptLive.status, "completed");
    assert.deepEqual(activeFixture.sequenceCalls[0]?.steps.map((step) => step.method), ["thread/resume", "turn/interrupt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("routing is deterministic for ambiguous, missing, and desktop-observation-required targets", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-router-selection-"));
  const fixture = fixtureClient([
    { id: "thread-a", name: "A", state: "active", turnId: "turn-a" },
    { id: "thread-b", name: "B", state: "active", turnId: "turn-b" }
  ]);
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const router = createCodexControlRouter({
    client: fixture.client,
    control: createCodexControl({ audit, client: fixture.client })
  });

  try {
    const ambiguous = await router.route({});
    assert.equal(ambiguous.status, "ambiguous");
    assert.equal(ambiguous.target_ref, null);
    assert.deepEqual(ambiguous.reason_codes, ["multiple_active_daemon_targets"]);

    const selected = await router.route({ hint: "B" });
    assert.equal(selected.status, "selected");
    assert.equal(selected.title_sanitized, "B");

    const desktop = await router.route({ hint: "Desktop-only task" });
    assert.equal(desktop.status, "unavailable");
    assert.equal(desktop.route, "desktop_observation_required");
    assert.deepEqual(desktop.reason_codes, ["explicit_hint_not_daemon_loaded"]);

    fixture.setThreads([]);
    const none = await router.route({});
    assert.equal(none.status, "none");
    assert.equal(none.route, "unknown");
    assert.deepEqual(none.reason_codes, ["no_daemon_target"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("expired and ownership-changed opaque targets fail before control mutation", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-router-stale-"));
  const fixture = fixtureClient([{
    id: "thread-stale",
    name: "Stale task",
    state: "idle"
  }]);
  const audit = createAuditStore(join(root, "audit.jsonl"));
  let clock = new Date("2026-07-30T10:00:00Z");
  const router = createCodexControlRouter({
    client: fixture.client,
    control: createCodexControl({ audit, client: fixture.client }),
    ttlMs: 1_000,
    createRef: () => "lco_target_stale",
    now: () => clock
  });

  try {
    const route = await router.route({});
    fixture.setThreads([]);
    const ownershipChanged = await router.deliver({
      targetRef: route.target_ref!,
      message: "Do not send"
    });
    assert.deepEqual(ownershipChanged.reason_codes, ["target_ownership_changed"]);
    assert.equal(fixture.sequenceCalls.length, 0);

    fixture.setThreads([{ id: "thread-stale", name: "Stale task", state: "idle" }]);
    const fresh = await router.route({});
    clock = new Date("2026-07-30T10:00:02Z");
    const expired = await router.deliver({
      targetRef: fresh.target_ref!,
      message: "Do not send"
    });
    assert.deepEqual(expired.reason_codes, ["target_ref_expired"]);
    assert.equal(fixture.sequenceCalls.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("delivery returns the specific non-steerable blocker from Codex", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-router-non-steerable-"));
  const fixture = fixtureClient([{
    id: "thread-review",
    name: "Review task",
    state: "active",
    turnId: "turn-review"
  }], "active_turn_not_steerable");
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const router = createCodexControlRouter({
    client: fixture.client,
    control: createCodexControl({ audit, client: fixture.client })
  });

  try {
    const route = await router.route({});
    const dryRun = await router.deliver({
      targetRef: route.target_ref!,
      message: "Steer review"
    });
    const live = await router.deliver({
      targetRef: route.target_ref!,
      message: "Steer review",
      dryRun: false,
      approvalAuditId: dryRun.approval_audit_id
    });
    assert.equal(live.status, "blocked");
    assert.equal(live.control_sent, false);
    assert.deepEqual(live.reason_codes, ["active_turn_not_steerable"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
