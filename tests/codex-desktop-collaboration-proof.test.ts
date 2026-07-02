import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createCodexDesktopCollaborationProof,
  type CodexDesktopCollaborationProofApprovalPacket
} from "../packages/adapters/src/index.js";
import { createDatabase } from "../packages/core/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";

const targetRef = "codex_thread:019f-action-bound";
const targetThreadId = "019f-action-bound";
const desktopBackend = "cua-driver";
const targetApp = "Codex";
const targetWindow = "Lossless OpenClaw Orchestrator";
const action = "verify_visible_thread_alignment";

function actionHashFor(input: {
  targetRef?: string;
  desktopBackend?: string;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
}) {
  return createHash("sha256").update(JSON.stringify({
    targetRef: input.targetRef,
    desktopBackend: input.desktopBackend,
    targetApp: input.targetApp,
    targetWindow: input.targetWindow,
    action: input.action
  })).digest("hex");
}

function validApprovalPacket(overrides: Partial<CodexDesktopCollaborationProofApprovalPacket> = {}): CodexDesktopCollaborationProofApprovalPacket {
  const actionHash = actionHashFor({ targetRef, desktopBackend, targetApp, targetWindow, action });
  return {
    schema: "lco.codexDesktopCollaborationProofApproval.v1",
    approvalRef: "issue-333-action-bound-proof",
    approved: true,
    targetRef,
    targetThreadId,
    desktopBackend,
    targetApp,
    targetWindow,
    action,
    actionHash,
    issuedAt: "2026-07-02T15:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z",
    preconditions: [
      "desktop_coherence_desktop_visible",
      "fallback_backend_ready",
      "no_screenshot_policy"
    ],
    sourceCoverage: {
      indexedSession: "ok",
      desktopCoherence: "ok",
      desktopFallback: "ok",
      approvalPacket: "ok"
    },
    focusPolicy: {
      screenshotAllowed: false,
      requireNoFocusSteal: true
    },
    ...overrides
  };
}

test("Codex Desktop collaboration proof rejects generic GUI and live-control requests without acting", () => {
  const rawPathCanary = "/Users/lume/.codex/sessions/raw/private-thread.jsonl";
  const tokenCanary = "npm_notarealtokenbutshouldberemoved1234567890";
  const report = createCodexDesktopCollaborationProof({
    targetRef: `${targetRef}${rawPathCanary}`,
    targetThreadId,
    desktopBackend: "cua-driver",
    targetApp: "Codex",
    targetWindow: `click the visible Codex input ${rawPathCanary}`,
    action: `type prompt and continue thread ${tokenCanary}`,
    actionHash: "0".repeat(64),
    approvalPacket: validApprovalPacket(),
    execute: true
  });

  assert.equal(report.schema, "lco.codexDesktopCollaborationProof.v1");
  assert.equal(report.publicSafe, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.ok, false);
  assert.equal(report.status, "blocked");
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
  assert.equal(report.actionsPerformed.screenshotCaptured, false);
  assert.equal(report.approvalVerified, false);
  assert.equal(report.proofMarkers.approvalPacketBound, false);
  assert.equal(report.blockers.includes("execute_not_supported"), true);
  assert.equal(report.blockers.includes("generic_gui_action_blocked"), true);
  assert.equal(report.blockers.includes("live_codex_control_blocked"), true);
  assert.equal(JSON.stringify(report).includes(rawPathCanary), false);
  assert.equal(JSON.stringify(report).includes(tokenCanary), false);
});

test("Codex Desktop collaboration proof accepts exact dry-run approval packet and emits proof markers", () => {
  const approvalPacket = validApprovalPacket();
  const report = createCodexDesktopCollaborationProof({
    targetRef,
    targetThreadId,
    desktopBackend,
    targetApp,
    targetWindow,
    action,
    actionHash: approvalPacket.actionHash,
    approvalPacket,
    execute: false,
    now: "2026-07-02T15:05:00.000Z"
  });

  assert.equal(report.ok, true);
  assert.equal(report.status, "ready");
  assert.equal(report.actionHash, approvalPacket.actionHash);
  assert.equal(report.approvalVerified, true);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.proofMarkers, {
    actionBoundTarget: true,
    approvalPacketBound: true,
    publicSafeEvidenceOnly: true,
    noScreenshotPolicy: true,
    dryRunOnly: true
  });
  assert.equal(report.requiredNextToolCall?.tool, "loo_desktop_live_proof_harness");
  assert.equal(report.requiredNextToolCall?.execute, false);
  assert.deepEqual(report.requiredNextToolCall?.args, {
    backend: "cua-driver",
    target_app: "Codex",
    target_window: "Lossless OpenClaw Orchestrator",
    action: "verify_visible_thread_alignment",
    approval_ref: "issue-333-action-bound-proof"
  });
});

test("Codex Desktop collaboration proof fails closed on hash, target, freshness, and approval mismatch", () => {
  const report = createCodexDesktopCollaborationProof({
    targetRef,
    targetThreadId,
    desktopBackend,
    targetApp,
    targetWindow,
    action,
    actionHash: "a".repeat(64),
    approvalPacket: validApprovalPacket({
      targetRef: "codex_thread:other",
      expiresAt: "2026-07-02T14:00:00.000Z"
    }),
    execute: false,
    now: "2026-07-02T15:05:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.equal(report.status, "blocked");
  assert.equal(report.approvalVerified, false);
  assert.equal(report.blockers.includes("action_hash_mismatch"), true);
  assert.equal(report.blockers.includes("approval_target_ref_mismatch"), true);
  assert.equal(report.blockers.includes("approval_action_hash_mismatch"), true);
  assert.equal(report.blockers.includes("approval_packet_expired"), true);
  assert.equal(report.requiredNextToolCall, null);
});

test("Codex Desktop collaboration proof accepts public punctuation when caller hashes the same public fields", () => {
  const punctuatedWindow = "Codex user's lane & review!";
  const punctuatedAction = "verify_visible_thread_alignment";
  const punctuatedHash = actionHashFor({
    targetRef,
    desktopBackend,
    targetApp,
    targetWindow: punctuatedWindow,
    action: punctuatedAction
  });
  const report = createCodexDesktopCollaborationProof({
    targetRef,
    targetThreadId,
    desktopBackend,
    targetApp,
    targetWindow: punctuatedWindow,
    action: punctuatedAction,
    actionHash: punctuatedHash,
    approvalPacket: validApprovalPacket({
      targetWindow: punctuatedWindow,
      action: punctuatedAction,
      actionHash: punctuatedHash
    }),
    execute: false,
    now: "2026-07-02T15:05:00.000Z"
  });

  assert.equal(report.ok, true);
  assert.equal(report.targetWindow, punctuatedWindow);
  assert.equal(report.actionHash, punctuatedHash);
  assert.deepEqual(report.blockers, []);
});

test("Codex Desktop collaboration proof blocks direct backend and future-issued approval packets", () => {
  const directHash = actionHashFor({
    targetRef,
    desktopBackend: "direct",
    targetApp,
    targetWindow,
    action
  });
  const report = createCodexDesktopCollaborationProof({
    targetRef,
    targetThreadId,
    desktopBackend: "direct",
    targetApp,
    targetWindow,
    action,
    actionHash: directHash,
    approvalPacket: validApprovalPacket({
      desktopBackend: "direct",
      actionHash: directHash,
      issuedAt: "2026-07-02T16:00:00.000Z",
      expiresAt: "2999-01-01T00:00:00.000Z"
    }),
    execute: false,
    now: "2026-07-02T15:05:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.equal(report.status, "blocked");
  assert.equal(report.blockers.includes("desktop_backend_not_gui_fallback"), true);
  assert.equal(report.blockers.includes("approval_packet_issued_at_in_future"), true);
  assert.equal(report.requiredNextToolCall, null);
});

test("MCP declarations expose the action-bound Codex Desktop collaboration proof tool", async () => {
  const db = createDatabase(":memory:");
  try {
    const tool = createLooTools({
      db,
      audit: {
        path: "metadata-only",
        append() { throw new Error("not needed"); },
        find() { return null; },
        tail() { return []; },
        fingerprintText() { return "metadata-only"; },
        fingerprintValue() { return "metadata-only"; }
      },
      codexClient: {
        async request() {
          throw new Error("not needed");
        }
      }
    }).find((tool) => tool.name === "loo_codex_desktop_collaboration_proof");

    assert.ok(tool);
    const inputProperties = tool.inputSchema.properties as Record<string, { type?: string }>;
    assert.equal(inputProperties.execute?.type, "boolean");

    const approvalPacket = validApprovalPacket();
    const output = await tool.execute({
      target_ref: targetRef,
      target_thread_id: targetThreadId,
      backend: desktopBackend,
      target_app: targetApp,
      target_window: targetWindow,
      action,
      action_hash: approvalPacket.actionHash,
      approval_packet: approvalPacket,
      now: "2026-07-02T15:05:00.000Z"
    }) as { ok?: boolean; status?: string; actionsPerformed?: { desktopGuiActionRun?: boolean } };

    assert.equal(output.ok, true);
    assert.equal(output.status, "ready");
    assert.equal(output.actionsPerformed?.desktopGuiActionRun, false);
  } finally {
    db.close();
  }
});
