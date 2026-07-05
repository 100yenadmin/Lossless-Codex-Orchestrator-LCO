import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  createQaLabDesktopContractReport,
  type QaLabDesktopContractReport
} from "../packages/cli/src/qa-lab-desktop-contract.js";

const candidateSha = "20d913822d82cad0b5c565b3c9fd3cd527ac0e57";
const packageVersion = "1.2.5";

function makeTempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readinessReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lco.qaLab.toolCoverage.v1",
    ok: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    cliReady: true,
    appServerReady: true,
    desktopVisibility: {
      desktopVisible: true,
      fallbackBackendReady: true,
      codexDesktopReady: true,
      screenshotIncluded: false,
      videoIncluded: false
    },
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      genericGuiMutationRun: false
    },
    blockers: [],
    ...overrides
  };
}

function scratchProof(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lco.desktopTextEditScratchProof.v1",
    publicSafe: true,
    actionBound: true,
    targetApp: "TextEdit",
    action: "launch_textedit_scratch",
    executed: true,
    screenshotIncluded: false,
    videoIncluded: false,
    rawWindowTextIncluded: false,
    rawTranscriptIncluded: false,
    ...overrides
  };
}

test("qa-lab desktop contract accepts metadata readiness without overclaiming screenshot or action proof", () => {
  const report = createQaLabDesktopContractReport({
    packageVersion,
    candidateSha,
    now: "2026-07-05T08:00:00.000Z",
    readinessReport: readinessReport()
  });

  assert.equal(report.schema, "lco.qaLab.desktopContract.v1");
  assert.equal(report.ok, true);
  assert.equal(report.desktopContractReady, true);
  assert.deepEqual(report.metadataProof, {
    cliReady: true,
    appServerReady: true,
    desktopVisible: true,
    fallbackBackendReady: true,
    codexDesktopReady: true
  });
  assert.deepEqual(report.screenshotVideoProof, {
    screenshotProvided: false,
    videoProvided: false,
    screenshotOrVideoProofAccepted: false
  });
  assert.deepEqual(report.actionsPerformed, {
    textEditScratchActionRun: false,
    genericGuiMutationRun: false,
    codexGuiMutationRun: false,
    liveCodexControlRun: false
  });
  assert.equal(report.allowedActionBoundScratchProof, false);
  assert.equal(report.genericGuiMutationClaimAccepted, false);
  assert.equal(report.codexGuiMutationClaimAccepted, false);
  assert.deepEqual(report.blockers, []);
});

test("qa-lab desktop contract blocks generic and Codex GUI mutation claims without explicit matching evidence", () => {
  const report = createQaLabDesktopContractReport({
    now: "2026-07-05T08:00:00.000Z",
    readinessReport: readinessReport({
      claims: {
        genericGuiMutation: true,
        codexGuiMutation: true
      },
      actionsPerformed: {
        liveCodexControlRun: true,
        desktopGuiActionRun: true,
        codexGuiMutationRun: true,
        genericGuiMutationRun: true
      }
    })
  });

  assert.equal(report.ok, false);
  assert.equal(report.desktopContractReady, false);
  assert.equal(report.actionsPerformed.genericGuiMutationRun, false);
  assert.equal(report.actionsPerformed.codexGuiMutationRun, false);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.genericGuiMutationClaimAccepted, false);
  assert.equal(report.codexGuiMutationClaimAccepted, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "generic_gui_mutation_claim_unproved"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "codex_gui_mutation_claim_unproved"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "restricted_action_claimed"));
});

test("qa-lab desktop contract allows only explicit action-bound TextEdit scratch execution", () => {
  const report = createQaLabDesktopContractReport({
    now: "2026-07-05T08:00:00.000Z",
    readinessReport: readinessReport(),
    actionBoundScratchProof: scratchProof()
  });

  assert.equal(report.ok, true);
  assert.equal(report.actionsPerformed.textEditScratchActionRun, true);
  assert.equal(report.actionsPerformed.genericGuiMutationRun, false);
  assert.equal(report.actionsPerformed.codexGuiMutationRun, false);
  assert.equal(report.allowedActionBoundScratchProof, true);
  assert.equal(report.genericGuiMutationClaimAccepted, false);
  assert.equal(report.codexGuiMutationClaimAccepted, false);
  assert.equal(report.proofBoundary.includes("does not prove generic GUI mutation"), true);
});

test("qa-lab desktop contract fails closed and redacts unsafe raw evidence", (t) => {
  const dir = makeTempDir(t, "loo-qa-desktop-contract-");
  const readinessPath = join(dir, "desktop-readiness.json");
  const scratchPath = join(dir, "scratch-proof.json");
  writeJson(readinessPath, readinessReport({
    rawPath: "/Users/lume/.codex/sessions/private.jsonl",
    token: "ghp_notarealtokenbutshouldberemoved1234567890",
    desktopVisibility: {
      desktopVisible: true,
      fallbackBackendReady: true,
      codexDesktopReady: true,
      screenshotIncluded: true
    }
  }));
  writeJson(scratchPath, scratchProof({
    rawWindowText: "private customer note",
    rawWindowTextIncluded: true
  }));

  const report: QaLabDesktopContractReport = createQaLabDesktopContractReport({
    now: "2026-07-05T08:00:00.000Z",
    readinessReport: readinessPath,
    actionBoundScratchProof: scratchPath
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.ok, false);
  assert.equal(report.screenshotVideoProof.screenshotProvided, true);
  assert.equal(report.screenshotVideoProof.screenshotOrVideoProofAccepted, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "unsafe_evidence_value"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "screenshot_or_video_not_contract_proof"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "raw_window_text_not_public_safe"));
  assert.doesNotMatch(serialized, /private\.jsonl/);
  assert.doesNotMatch(serialized, /ghp_notarealtoken/);
  assert.doesNotMatch(serialized, /private customer note/);
});
