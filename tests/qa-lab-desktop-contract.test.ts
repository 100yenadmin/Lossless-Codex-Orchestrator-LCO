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
  assert.equal(report.evidenceIndex.actionBoundScratchProof.status, "unsafe");
  assert.ok(report.blockers.some((blocker) => blocker.code === "unsafe_evidence_value"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "screenshot_or_video_not_contract_proof"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "raw_window_text_not_public_safe"));
  assert.doesNotMatch(serialized, /private\.jsonl/);
  assert.doesNotMatch(serialized, /ghp_notarealtoken/);
  assert.doesNotMatch(serialized, /private customer note/);
});

test("qa-lab desktop contract blocks non-Users raw artifact paths and common token shapes", () => {
  const report = createQaLabDesktopContractReport({
    packageVersion,
    candidateSha,
    readinessReport: readinessReport({
      rawArtifacts: [
        "/tmp/session.sqlite",
        "/private/var/folders/screenshot.png",
        "C:\\Users\\lume\\AppData\\Local\\codex\\transcript.jsonl",
        "../../sessions/x.sqlite"
      ],
      leakedTokens: [
        "AKIA1234567890ABCDEF",
        "eyJhbGciOiJIUzI1NiJ9.payload.signature"
      ]
    })
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.ok, false);
  assert.equal(report.evidenceIndex.readinessReport.status, "unsafe");
  assert.ok(report.blockers.some((blocker) => blocker.code === "unsafe_evidence_value"));
  assert.doesNotMatch(serialized, /session\.sqlite|screenshot\.png|transcript\.jsonl|x\.sqlite/);
  assert.doesNotMatch(serialized, /AKIA1234567890ABCDEF|eyJhbGciOiJIUzI1NiJ9/);
});

test("qa-lab desktop contract fails closed on deeply nested hostile evidence", () => {
  let nested: Record<string, unknown> = { marker: "safe" };
  for (let index = 0; index < 96; index += 1) nested = { child: nested };

  const report = createQaLabDesktopContractReport({
    packageVersion,
    candidateSha,
    readinessReport: readinessReport({
      nested
    })
  });

  assert.equal(report.ok, false);
  assert.equal(report.evidenceIndex.readinessReport.status, "unsafe");
  assert.ok(report.blockers.some((blocker) => blocker.code === "unsafe_evidence_value"));
});

test("qa-lab desktop contract treats array/object screenshot claims as provided proof", () => {
  const report = createQaLabDesktopContractReport({
    packageVersion,
    candidateSha,
    readinessReport: readinessReport({
      screenshotCaptured: [{ ref: "redacted-screenshot-evidence" }]
    })
  });

  assert.equal(report.ok, false);
  assert.equal(report.screenshotVideoProof.screenshotProvided, true);
  assert.ok(report.blockers.some((blocker) => blocker.code === "screenshot_or_video_not_contract_proof"));
});

test("qa-lab desktop contract honors explicit false readiness over generic ok fallbacks", () => {
  const cliReport = createQaLabDesktopContractReport({
    packageVersion,
    candidateSha,
    readinessReport: readinessReport({
      ok: true,
      qaLabToolCoverageReady: true,
      cliReady: false
    })
  });
  assert.equal(cliReport.ok, false);
  assert.equal(cliReport.metadataProof.cliReady, false);
  assert.equal(cliReport.evidenceIndex.readinessReport.status, "blocked");
  assert.ok(cliReport.evidenceIndex.readinessReport.blockerCodes.includes("cli_readiness_missing"));
  assert.ok(cliReport.blockers.some((blocker) => blocker.code === "cli_readiness_missing"));

  const appServerReport = createQaLabDesktopContractReport({
    packageVersion,
    candidateSha,
    readinessReport: readinessReport({
      gatewayReady: true,
      configuredGateway: { gatewaySetupClassification: "ready" },
      appServerReady: false
    })
  });
  assert.equal(appServerReport.ok, false);
  assert.equal(appServerReport.metadataProof.appServerReady, false);
  assert.equal(appServerReport.evidenceIndex.readinessReport.status, "blocked");
  assert.ok(appServerReport.evidenceIndex.readinessReport.blockerCodes.includes("app_server_readiness_missing"));
  assert.ok(appServerReport.blockers.some((blocker) => blocker.code === "app_server_readiness_missing"));
});

test("qa-lab desktop contract does not treat string false flags as screenshot or video proof", () => {
  const report = createQaLabDesktopContractReport({
    packageVersion,
    candidateSha,
    readinessReport: readinessReport({
      screenshotIncluded: "false",
      videoIncluded: "0",
      desktopVisibility: {
        desktopVisible: true,
        fallbackBackendReady: true,
        codexDesktopReady: true,
        screenshotIncluded: "false",
        videoIncluded: "no"
      }
    }),
    actionBoundScratchProof: scratchProof({
      rawWindowTextIncluded: "false",
      rawTranscriptIncluded: "0"
    })
  });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.screenshotVideoProof.screenshotProvided, false);
  assert.equal(report.screenshotVideoProof.videoProvided, false);
  assert.equal(report.evidenceIndex.readinessReport.status, "ready");
  assert.equal(report.evidenceIndex.actionBoundScratchProof.status, "ready");
});

test("qa-lab desktop contract blocks stale and malformed candidate sha evidence", () => {
  const mismatch = createQaLabDesktopContractReport({
    packageVersion,
    candidateSha,
    readinessReport: readinessReport({
      candidateSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    })
  });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.blockers.some((blocker) => blocker.code === "candidate_sha_mismatch"));

  const invalid = createQaLabDesktopContractReport({
    packageVersion,
    candidateSha: "not-a-sha",
    readinessReport: readinessReport()
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.blockers.some((blocker) => blocker.code === "candidate_sha_invalid"));

  const malformedUpstream = createQaLabDesktopContractReport({
    packageVersion,
    readinessReport: readinessReport({
      candidateSha: "/tmp/private-candidate.jsonl"
    })
  });
  assert.equal(malformedUpstream.ok, false);
  assert.equal(malformedUpstream.candidateSha, null);
  assert.ok(malformedUpstream.blockers.some((blocker) => blocker.code === "candidate_sha_invalid"));
  assert.doesNotMatch(JSON.stringify(malformedUpstream), /private-candidate\.jsonl/);
});
