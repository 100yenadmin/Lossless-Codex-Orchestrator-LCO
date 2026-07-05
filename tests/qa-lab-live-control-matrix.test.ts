import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createQaLabLiveControlMatrixReport } from "../packages/cli/src/qa-lab-live-control-matrix.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
const SHA = "9".repeat(40);
const PARAMS_HASH = "a".repeat(64);
const MESSAGE_HASH = "b".repeat(64);
const DRY_RUN_AUDIT_ID = "loo_audit_abcd1234";
const LIVE_AUDIT_ID = "loo_audit_def45678";

type Action = "send" | "resume" | "steer" | "interrupt";

function writeActionReport(dir: string, action: Action, overrides: Record<string, unknown> = {}): string {
  mkdirSync(dir, { recursive: true });
  const threadId = `thr_matrix_${action}`;
  const path = join(dir, `${action}-report.json`);
  const live = liveForAction(action);
  const messageHash = action === "send" || action === "steer" ? MESSAGE_HASH : null;
  const expectedTurnId = typeof live.expectedTurnId === "string" ? live.expectedTurnId : null;
  writeFileSync(path, `${JSON.stringify({
    ok: true,
    proofReady: true,
    publicSafe: true,
    action,
    targetRef: `codex_thread:${threadId}`,
    proofPath: join(dir, `${action}-proof.json`),
    reportPath: path,
    runtimeProofPath: join(dir, `${action}-runtime-proof.json`),
    dryRun: {
      approvalAuditId: DRY_RUN_AUDIT_ID,
      paramsHash: PARAMS_HASH,
      messageHash,
      live: false,
      expectedTurnId
    },
    live: {
      approvalAuditId: LIVE_AUDIT_ID,
      paramsHash: PARAMS_HASH,
      messageHash,
      live: true,
      ...live
    },
    audit: {
      matchingDryRunRecord: true,
      matchingLiveRecord: true
    },
    authorization: {
      approvalAuditIdUsed: DRY_RUN_AUDIT_ID,
      approvalAuditIdMatchesDryRun: true
    },
    blockers: [],
    actionsPerformed: {
      liveCodexControlRun: true,
      desktopGuiActionRun: false,
      npmPublished: false,
      githubReleaseCreated: false,
      rawTranscriptRead: false
    },
    ...overrides
  }, null, 2)}\n`);
  return path;
}

function liveForAction(action: Action): Record<string, unknown> {
  if (action === "send") return { method: "turn/start", turnStatus: "completed", responseOk: true };
  if (action === "resume") return { method: "thread/resume", turnStatus: null, responseOk: true };
  if (action === "steer") return { method: "turn/steer", turnStatus: "accepted", responseOk: true, expectedTurnId: "turn_sacrificial_1" };
  return { method: "turn/interrupt", turnStatus: "accepted", responseOk: true, expectedTurnId: "turn_sacrificial_interrupt" };
}

function allReports(dir: string): Record<string, string> {
  return {
    sendReport: writeActionReport(dir, "send"),
    resumeReport: writeActionReport(dir, "resume"),
    steerReport: writeActionReport(dir, "steer"),
    interruptReport: writeActionReport(dir, "interrupt")
  };
}

function sacrificialThreadIds(): string[] {
  return ["thr_matrix_send", "thr_matrix_resume", "thr_matrix_steer", "thr_matrix_interrupt"];
}

test("QA Lab live-control matrix proves all required sacrificial live-control rows without performing actions", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-control-matrix-ready-"));
  const evidenceDir = join(root, "evidence");
  try {
    const reports = allReports(evidenceDir);
    const report = createQaLabLiveControlMatrixReport({
      evidenceDir,
      packageVersion: "1.2.6",
      candidateSha: SHA,
      claimScope: "codex-live-control",
      sacrificialThreadIds: sacrificialThreadIds(),
      now: "2026-07-05T00:00:00.000Z",
      ...reports
    });

    assert.equal(report.schema, "lco.qaLab.liveControlMatrix.v1");
    assert.equal(report.liveControlMatrixReady, true, JSON.stringify(report, null, 2));
    assert.equal(report.summary.requiredRows, 4);
    assert.equal(report.summary.readyRows, 4);
    assert.equal(report.actionsPerformed.liveCodexControlRun, false);
    assert.equal(report.actionsPerformed.rawTranscriptRead, false);
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(report.rows.map((row) => row.action), ["send", "resume", "steer", "interrupt"]);
    assert.equal(report.rows.every((row) => row.target.kind === "approved_sacrificial_thread"), true);
    assert.equal(report.rows.find((row) => row.action === "steer")?.liveProof.expectedTurnIdPresent, true);
    assert.equal(report.rows.find((row) => row.action === "steer")?.liveProof.expectedTurnIdMatchesDryRun, true);
    assert.equal(report.rows.find((row) => row.action === "interrupt")?.liveProof.bindingScope, "turn_bound");

    const written = readFileSync(join(evidenceDir, "live-control-matrix.json"), "utf8");
    assert.doesNotMatch(written, /liveCodexControlRun": true/);
    assert.doesNotMatch(written, /\/private|RAW_TRANSCRIPT|Bearer\s+/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("QA Lab live-control matrix blocks thread-scoped interrupt from satisfying a bound live-control claim", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-control-matrix-interrupt-thread-scoped-"));
  const evidenceDir = join(root, "evidence");
  try {
    const reports = allReports(evidenceDir);
    reports.interruptReport = writeActionReport(evidenceDir, "interrupt", {
      live: {
        approvalAuditId: LIVE_AUDIT_ID,
        paramsHash: PARAMS_HASH,
        messageHash: null,
        live: true,
        method: "turn/interrupt",
        turnStatus: "accepted",
        responseOk: true
      }
    });
    const report = createQaLabLiveControlMatrixReport({
      evidenceDir,
      packageVersion: "1.2.6",
      candidateSha: SHA,
      claimScope: "codex-live-control",
      sacrificialThreadIds: sacrificialThreadIds(),
      now: "2026-07-05T00:00:00.000Z",
      ...reports
    });
    const interrupt = report.rows.find((row) => row.action === "interrupt");

    assert.equal(report.liveControlMatrixReady, false);
    assert.equal(report.summary.readyRows, 3);
    assert.equal(interrupt?.status, "blocked");
    assert.equal(interrupt?.liveProof.bindingScope, "thread_scoped");
    assert.ok(interrupt?.blockerCodes.includes("live_control_interrupt_turn_binding_missing"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("QA Lab live-control matrix blocks steer rows whose live turn binding differs from the dry-run turn", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-control-matrix-steer-turn-mismatch-"));
  const evidenceDir = join(root, "evidence");
  try {
    const reports = allReports(evidenceDir);
    reports.steerReport = writeActionReport(evidenceDir, "steer", {
      dryRun: {
        approvalAuditId: DRY_RUN_AUDIT_ID,
        paramsHash: PARAMS_HASH,
        messageHash: MESSAGE_HASH,
        live: false,
        expectedTurnId: "turn_requested"
      },
      live: {
        approvalAuditId: LIVE_AUDIT_ID,
        paramsHash: PARAMS_HASH,
        messageHash: MESSAGE_HASH,
        live: true,
        method: "turn/steer",
        turnStatus: "accepted",
        responseOk: true,
        expectedTurnId: "turn_unexpected"
      }
    });
    const report = createQaLabLiveControlMatrixReport({
      evidenceDir,
      packageVersion: "1.2.6",
      candidateSha: SHA,
      claimScope: "codex-live-control",
      sacrificialThreadIds: sacrificialThreadIds(),
      now: "2026-07-05T00:00:00.000Z",
      ...reports
    });
    const steer = report.rows.find((row) => row.action === "steer");

    assert.equal(report.liveControlMatrixReady, false);
    assert.equal(steer?.status, "blocked");
    assert.equal(steer?.liveProof.expectedTurnIdMatchesDryRun, false);
    assert.ok(steer?.blockerCodes.includes("live_control_steer_turn_binding_mismatch"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("QA Lab live-control matrix blocks skipped required rows", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-control-matrix-skipped-"));
  const evidenceDir = join(root, "evidence");
  try {
    const report = createQaLabLiveControlMatrixReport({
      evidenceDir,
      packageVersion: "1.2.6",
      candidateSha: SHA,
      claimScope: "codex-live-control",
      sacrificialThreadIds: sacrificialThreadIds(),
      sendReport: writeActionReport(evidenceDir, "send"),
      resumeReport: writeActionReport(evidenceDir, "resume"),
      interruptReport: writeActionReport(evidenceDir, "interrupt")
    });

    assert.equal(report.liveControlMatrixReady, false);
    assert.equal(report.summary.skippedRequiredRows, 1);
    assert.equal(report.rows.find((row) => row.action === "steer")?.status, "skipped");
    assert.ok(report.blockers.some((blocker) => blocker.code === "live_control_action_report_missing" && blocker.source === "openclaw-gateway-steer"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("QA Lab live-control matrix blocks dry-run-only rows from counting as live proof", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-control-matrix-dry-only-"));
  const evidenceDir = join(root, "evidence");
  try {
    const reports = allReports(evidenceDir);
    reports.sendReport = writeActionReport(evidenceDir, "send", {
      live: { live: false, method: "turn/start", responseOk: true, turnStatus: "completed" },
      actionsPerformed: { liveCodexControlRun: false, rawTranscriptRead: false }
    });
    const report = createQaLabLiveControlMatrixReport({
      evidenceDir,
      candidateSha: SHA,
      claimScope: "codex-live-control",
      sacrificialThreadIds: sacrificialThreadIds(),
      ...reports
    });

    const send = report.rows.find((row) => row.action === "send");
    assert.equal(send?.status, "blocked");
    assert.ok(send?.blockerCodes.includes("live_control_live_action_not_proven"));
    assert.ok(send?.blockerCodes.includes("live_control_action_flag_missing"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("QA Lab live-control matrix blocks non-sacrificial targets", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-control-matrix-target-"));
  const evidenceDir = join(root, "evidence");
  try {
    const reports = allReports(evidenceDir);
    const report = createQaLabLiveControlMatrixReport({
      evidenceDir,
      candidateSha: SHA,
      claimScope: "codex-live-control",
      sacrificialThreadIds: ["thr_matrix_send"],
      ...reports
    });

    assert.equal(report.liveControlMatrixReady, false);
    assert.ok(report.blockers.some((blocker) => blocker.code === "sacrificial_target_allowlist_missing") === false);
    const blockedRows = report.rows.filter((row) => row.action !== "send");
    assert.deepEqual(blockedRows.map((row) => row.status), ["blocked", "blocked", "blocked"]);
    assert.deepEqual(blockedRows.map((row) => row.target.refClass), ["unknown", "unknown", "unknown"]);
    assert.deepEqual(blockedRows.map((row) => row.blockerCodes), [
      ["live_control_target_not_sacrificial"],
      ["live_control_target_not_sacrificial"],
      ["live_control_target_not_sacrificial"]
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("QA Lab live-control matrix blocks one sacrificial thread from satisfying multiple required actions", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-control-matrix-shared-target-"));
  const evidenceDir = join(root, "evidence");
  try {
    const sharedTarget = "codex_thread:thr_matrix_shared";
    const report = createQaLabLiveControlMatrixReport({
      evidenceDir,
      candidateSha: SHA,
      claimScope: "codex-live-control",
      sacrificialThreadIds: ["thr_matrix_shared"],
      sendReport: writeActionReport(evidenceDir, "send", { targetRef: sharedTarget }),
      resumeReport: writeActionReport(evidenceDir, "resume", { targetRef: sharedTarget }),
      steerReport: writeActionReport(evidenceDir, "steer", { targetRef: sharedTarget }),
      interruptReport: writeActionReport(evidenceDir, "interrupt", { targetRef: sharedTarget })
    });
    const duplicateRows = report.rows.filter((row) => row.blockerCodes.includes("live_control_target_not_action_isolated"));

    assert.equal(report.liveControlMatrixReady, false);
    assert.equal(report.summary.readyRows, 0);
    assert.equal(duplicateRows.length, 4);
    assert.deepEqual(duplicateRows.map((row) => row.status), ["blocked", "blocked", "blocked", "blocked"]);
    assert.equal(new Set(duplicateRows.map((row) => row.target.ref)).size, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("QA Lab live-control matrix blocks unsafe input without echoing private canaries", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-control-matrix-private-"));
  const evidenceDir = join(root, "evidence");
  try {
    const reports = allReports(evidenceDir);
    reports.sendReport = writeActionReport(evidenceDir, "send", {
      unsafeFinding: "RAW_TRANSCRIPT: /Volumes/LEXAR/private.sqlite Bearer abcdefghijklmnopqrstuvwxyz"
    });
    const report = createQaLabLiveControlMatrixReport({
      evidenceDir,
      candidateSha: SHA,
      claimScope: "codex-live-control",
      sacrificialThreadIds: sacrificialThreadIds(),
      ...reports
    });
    const serialized = JSON.stringify(report);

    assert.equal(report.liveControlMatrixReady, false);
    assert.ok(report.blockers.some((blocker) => blocker.code === "live_control_report_private_data_canary"));
    assert.doesNotMatch(serialized, /RAW_TRANSCRIPT|private\.sqlite|Bearer abc/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("QA Lab live-control matrix redacts unsafe target refs instead of echoing paths", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-control-matrix-unsafe-target-"));
  const evidenceDir = join(root, "evidence");
  try {
    const reports = allReports(evidenceDir);
    reports.sendReport = writeActionReport(evidenceDir, "send", {
      targetRef: "codex_thread:/Volumes/LEXAR/private.sqlite"
    });
    const report = createQaLabLiveControlMatrixReport({
      evidenceDir,
      candidateSha: SHA,
      claimScope: "codex-live-control",
      sacrificialThreadIds: sacrificialThreadIds(),
      ...reports
    });
    const serialized = JSON.stringify(report);
    const send = report.rows.find((row) => row.action === "send");

    assert.equal(report.liveControlMatrixReady, false);
    assert.equal(send?.target.ref, null);
    assert.ok(send?.blockerCodes.includes("live_control_report_private_data_canary"));
    assert.ok(send?.blockerCodes.includes("live_control_target_ref_private_data_canary"));
    assert.doesNotMatch(serialized, /\/Volumes\/LEXAR|private\.sqlite/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("QA Lab live-control matrix does not read reports outside the evidence directory", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-control-matrix-outside-"));
  const evidenceDir = join(root, "evidence");
  const outsideDir = join(root, "outside");
  try {
    mkdirSync(outsideDir, { recursive: true });
    const outsideReport = writeActionReport(outsideDir, "send");
    const report = createQaLabLiveControlMatrixReport({
      evidenceDir,
      candidateSha: SHA,
      claimScope: "codex-live-control",
      sacrificialThreadIds: sacrificialThreadIds(),
      sendReport: outsideReport,
      resumeReport: writeActionReport(evidenceDir, "resume"),
      steerReport: writeActionReport(evidenceDir, "steer"),
      interruptReport: writeActionReport(evidenceDir, "interrupt")
    });
    const send = report.rows.find((row) => row.action === "send");

    assert.equal(report.liveControlMatrixReady, false);
    assert.equal(send?.status, "blocked");
    assert.equal(send?.evidenceRef, null);
    assert.equal(send?.target.ref, null);
    assert.ok(send?.blockerCodes.includes("live_control_report_outside_evidence_dir"));
    assert.equal(existsSync(join(evidenceDir, "live-control-matrix.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("QA Lab live-control matrix does not follow symlinked reports outside the evidence directory", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-control-matrix-symlink-"));
  const evidenceDir = join(root, "evidence");
  const outsideDir = join(root, "outside");
  try {
    mkdirSync(evidenceDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    const outsideReport = writeActionReport(outsideDir, "send");
    const linkedReport = join(evidenceDir, "send-report.json");
    symlinkSync(outsideReport, linkedReport);
    const report = createQaLabLiveControlMatrixReport({
      evidenceDir,
      candidateSha: SHA,
      claimScope: "codex-live-control",
      sacrificialThreadIds: sacrificialThreadIds(),
      sendReport: linkedReport,
      resumeReport: writeActionReport(evidenceDir, "resume"),
      steerReport: writeActionReport(evidenceDir, "steer"),
      interruptReport: writeActionReport(evidenceDir, "interrupt")
    });
    const send = report.rows.find((row) => row.action === "send");

    assert.equal(report.liveControlMatrixReady, false);
    assert.equal(send?.status, "blocked");
    assert.equal(send?.evidenceRef, null);
    assert.equal(send?.target.ref, null);
    assert.ok(send?.blockerCodes.includes("live_control_report_outside_evidence_dir"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("QA Lab live-control matrix blocks unsafe report filenames without echoing evidence refs", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-control-matrix-unsafe-filename-"));
  const evidenceDir = join(root, "evidence");
  try {
    mkdirSync(evidenceDir, { recursive: true });
    const unsafeReport = join(evidenceDir, "sacrificial.sqlite");
    writeFileSync(unsafeReport, `${JSON.stringify({ shouldNotBeRead: true })}\n`);
    const report = createQaLabLiveControlMatrixReport({
      evidenceDir,
      candidateSha: SHA,
      claimScope: "codex-live-control",
      sacrificialThreadIds: sacrificialThreadIds(),
      sendReport: unsafeReport,
      resumeReport: writeActionReport(evidenceDir, "resume"),
      steerReport: writeActionReport(evidenceDir, "steer"),
      interruptReport: writeActionReport(evidenceDir, "interrupt")
    });
    const send = report.rows.find((row) => row.action === "send");
    const serialized = JSON.stringify(report);

    assert.equal(report.liveControlMatrixReady, false);
    assert.equal(send?.evidenceRef, null);
    assert.equal(send?.target.ref, null);
    assert.ok(send?.blockerCodes.includes("live_control_report_path_private_data_canary"));
    assert.doesNotMatch(serialized, /sacrificial\.sqlite|shouldNotBeRead/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("QA Lab live-control matrix excludes live rows for read-search-dry-run claim scope", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-live-control-matrix-excluded-"));
  const evidenceDir = join(root, "evidence");
  try {
    const report = createQaLabLiveControlMatrixReport({
      evidenceDir,
      packageVersion: "1.2.6",
      candidateSha: SHA,
      claimScope: "codex-read-search-expand-dry-run",
      now: "2026-07-05T00:00:00.000Z"
    });

    assert.equal(report.liveControlMatrixReady, true, JSON.stringify(report, null, 2));
    assert.equal(report.summary.requiredRows, 0);
    assert.equal(report.summary.excludedRows, 4);
    assert.equal(report.rows.every((row) => row.status === "excluded_by_claim_scope"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI exposes QA Lab live-control matrix help without running live control", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "qa-lab",
    "live-control-matrix",
    "--help"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /loo qa-lab live-control-matrix/i);
  assert.match(result.stdout, /--sacrificial-thread-id/i);
  assert.match(result.stdout, /aggregate-only/i);
});
