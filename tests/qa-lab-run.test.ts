import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  createQaLabRunReport,
  type QaLabRunReport
} from "../packages/cli/src/qa-lab-run.js";
import {
  createQaLabAdversarialReviewReport,
  createQaLabJudgeReviewReport
} from "../packages/cli/src/qa-lab-review.js";
import { createReleaseGaSmokeReport } from "../packages/cli/src/release-ga-smoke.js";
import { runLoo } from "./helpers/run-loo.js";

const packageVersion = "1.3.0";
const candidateSha = "20d913822d82cad0b5c565b3c9fd3cd527ac0e57";

function makeTempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function noActions(): Record<string, false> {
  return {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false,
    rawTranscriptRead: false,
    rawPromptRead: false,
    screenshotCaptured: false,
    sourceStoreMutation: false,
    gatewayScopeApproval: false,
    broadGatewayScopeApproval: false
  };
}

function writeReadyEvidence(dir: string): void {
  writeJson(join(dir, "tool-coverage.json"), {
    schema: "lco.qaLab.toolCoverage.v1",
    ok: true,
    qaLabToolCoverageReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    coveragePolicy: "full",
    declaredToolCount: 60,
    invocationCoverage: {
      totalDeclaredTools: 60,
      invokedDeclaredTools: 60,
      missingDeclaredTools: [],
      publicFacadeTotal: 8,
      publicFacadeInvoked: 8,
      publicFacadeMissing: []
    },
    blockers: [],
    warnings: [],
    actionsPerformed: noActions()
  });
  writeJson(join(dir, "workflow-run.json"), {
    schema: "lco.qaLab.workflowRun.v1",
    ok: true,
    workflowRunReady: true,
    publicSafe: true,
    scenarioId: "real-agent-core-workflow",
    packageVersion,
    candidateSha,
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(join(dir, "cli-mcp-product-smoke.json"), {
    schema: "lco.qaLab.cliMcpProductSmoke.v1",
    ok: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    cliReady: true,
    mcpReady: true,
    mcpToolsCallReady: true,
    toolsListed: 60,
    blockers: [],
    setupBlockers: [],
    actionsPerformed: noActions()
  });
  writeJson(join(dir, "desktop-contract.json"), {
    schema: "lco.qaLab.desktopContract.v1",
    ok: true,
    desktopContractReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(join(dir, "live-control-matrix.json"), {
    schema: "lco.qaLab.liveControlMatrix.v1",
    ok: true,
    liveControlMatrixReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    claimScope: "codex-working-app-proof",
    rows: ["send", "resume", "steer", "interrupt"].map((action) => ({
      id: `openclaw-gateway-${action}`,
      surface: "openclaw-gateway",
      action,
      requiredForClaim: true,
      status: "ready",
      evidenceRef: `${action}-report.json`,
      target: { kind: "approved_sacrificial_thread", refClass: "codex_thread", ref: `codex_thread:thr_${action}` },
      dryRun: {
        present: true,
        live: false,
        approvalAuditId: "loo_audit_abcd1234",
        paramsHash: "a".repeat(64),
        messageHash: action === "send" || action === "steer" ? "b".repeat(64) : null,
        expectedTurnIdPresent: action === "steer" || action === "interrupt"
      },
      liveProof: {
        present: true,
        matchesDryRun: true,
        method: action === "send" ? "turn/start" : action === "resume" ? "thread/resume" : action === "steer" ? "turn/steer" : "turn/interrupt",
        responseOk: true,
        turnStatus: action === "send" ? "completed" : null,
        expectedTurnIdPresent: action === "steer" || action === "interrupt",
        expectedTurnIdMatchesDryRun: action === "steer" || action === "interrupt" ? true : null,
        bindingScope: action === "steer" || action === "interrupt" ? "turn_bound" : "not_applicable",
        rawPromptIncluded: null
      },
      audit: { matchingDryRunRecord: true, matchingLiveRecord: true },
      blockerCodes: []
    })),
    summary: { requiredRows: 4, readyRows: 4, blockedRows: 0, skippedRequiredRows: 0, excludedRows: 0 },
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(join(dir, "scenario-sweep.json"), {
    schema: "lco.scenarioSweep.v1",
    ok: true,
    scenarioReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    scenarioCount: 12,
    failedScenarioCount: 0,
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(join(dir, "scorecard-sweep.json"), {
    schema: "lco.scorecardSweep.v1",
    ok: true,
    sweepReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    scorecardSweepReady: true,
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(join(dir, "privacy-scan.json"), {
    schema: "lco.privacyScan.v1",
    ok: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    blockers: [],
    rawSessionArtifacts: [],
    secretLikeEvidenceFindings: [],
    actionsPerformed: noActions()
  });
}

test("qa-lab run fails strict with recovery commands when required evidence is missing", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-missing-");

  const result = runLoo([
    "qa-lab",
    "run",
    "--suite",
    "ga",
    "--artifact",
    "published",
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--evidence-dir",
    dir,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as QaLabRunReport;
  assert.equal(report.schema, "lco.qaLab.run.v1");
  assert.equal(report.qaLabReady, false);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P1" && blocker.code === "tool_coverage_evidence_missing"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "workflow_run_evidence_missing"));
  assert.ok(report.nextSafeCommands.some((command) => command.includes("loo qa-lab tool-coverage")));
  assert.ok(report.nextSafeCommands.some((command) => command.includes("loo qa-lab workflow")));
  assert.equal(existsSync(join(dir, "qa-lab-run.json")), true);
});

test("qa-lab run aggregates ready product evidence into judgeable public-safe GA report", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-pass-");
  writeReadyEvidence(dir);

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    claimScope: "codex-working-app-proof",
    evidenceDir: dir,
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.schema, "lco.qaLab.run.v1");
  assert.equal(report.ok, true);
  assert.equal(report.qaLabReady, true);
  assert.equal(report.summary.passedScenarios, 12);
  assert.equal(report.summary.failedScenarios, 0);
  assert.equal(report.scenarioCount, 12);
  assert.equal(report.failedScenarioCount, 0);
  assert.equal(report.dimensions.privacy.score, 5);
  assert.equal(report.dimensions.safety.score, 5);
  assert.equal(report.dimensions.packaging.score, 5);
  assert.equal(report.adversarial.safety.pass, true);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.evidenceIndex.toolCoverage.status, "ready");
  assert.equal(report.evidenceIndex.workflowRun.status, "ready");

  const judge = createQaLabJudgeReviewReport({
    runPath: join(dir, "qa-lab-run.json"),
    evidenceDir: dir,
    rubricVersion: "real-product-v1"
  });
  const adversarial = createQaLabAdversarialReviewReport({
    runPath: join(dir, "qa-lab-run.json"),
    evidenceDir: dir,
    lenses: ["safety", "retrieval", "packaging", "claims", "agentUsability"]
  });
  assert.equal(judge.gaReady, true);
  assert.equal(adversarial.ok, true);
});

test("qa-lab run fails on package version or candidate SHA mismatch", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-mismatch-");
  writeReadyEvidence(dir);
  writeJson(join(dir, "tool-coverage.json"), {
    schema: "lco.qaLab.toolCoverage.v1",
    ok: true,
    qaLabToolCoverageReady: true,
    publicSafe: true,
    packageVersion: "9.9.9",
    candidateSha: "f".repeat(40),
    coveragePolicy: "full",
    declaredToolCount: 60,
    invocationCoverage: {
      totalDeclaredTools: 60,
      invokedDeclaredTools: 60,
      missingDeclaredTools: [],
      publicFacadeTotal: 8,
      publicFacadeInvoked: 8,
      publicFacadeMissing: []
    },
    blockers: [],
    warnings: [],
    actionsPerformed: noActions()
  });

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    evidenceDir: dir,
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.qaLabReady, false);
  const toolCoverageBlockerCodes = report.blockers.filter((blocker) => blocker.source === "toolCoverage").map((blocker) => blocker.code).sort();
  assert.deepEqual(toolCoverageBlockerCodes, ["tool_coverage_sha_mismatch", "tool_coverage_version_mismatch"]);
});

test("qa-lab run fails when source evidence omits package version or candidate SHA binding", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-missing-binding-");
  writeReadyEvidence(dir);
  writeJson(join(dir, "workflow-run.json"), {
    schema: "lco.qaLab.workflowRun.v1",
    ok: true,
    workflowRunReady: true,
    publicSafe: true,
    scenarioId: "real-agent-core-workflow",
    blockers: [],
    actionsPerformed: noActions()
  });

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    evidenceDir: dir,
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.qaLabReady, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "workflow_run_version_missing"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "workflow_run_sha_missing"));
});

test("qa-lab run rejects schema-less scenario scorecard and privacy artifacts", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-schema-missing-");
  writeReadyEvidence(dir);
  for (const fileName of ["scenario-sweep.json", "scorecard-sweep.json", "privacy-scan.json"]) {
    const path = join(dir, fileName);
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    delete value.schema;
    writeJson(path, value);
  }

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    evidenceDir: dir,
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.qaLabReady, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "scenario_sweep_schema_invalid"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "scorecard_sweep_schema_invalid"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "privacy_scan_schema_invalid"));
});

test("qa-lab run requires scenario sweep failure counts", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-scenario-count-missing-");
  writeReadyEvidence(dir);
  const path = join(dir, "scenario-sweep.json");
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  delete value.failedScenarioCount;
  writeJson(path, value);

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    evidenceDir: dir,
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.qaLabReady, false);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P1" && blocker.code === "scenario_sweep_failed_count_missing"));
});

test("qa-lab run rejects unsafe report values without echoing canaries", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-unsafe-");
  writeReadyEvidence(dir);
  writeJson(join(dir, "workflow-run.json"), {
    schema: "lco.qaLab.workflowRun.v1",
    ok: true,
    workflowRunReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    notes: ["/Users/lume/.codex/sessions/private-thread.jsonl", "TEST_CANARY_NPM_TOKEN_INVALID!"],
    blockers: [],
    actionsPerformed: noActions()
  });

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    evidenceDir: dir,
    now: "2026-07-05T00:00:00.000Z"
  });

  const serialized = JSON.stringify(report);
  assert.equal(report.qaLabReady, false);
  assert.equal(report.publicSafe, false);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "workflow_run_unsafe_evidence_value"));
  assert.equal(report.evidenceIndex.workflowRun.status, "unsafe");
  assert.doesNotMatch(serialized, /private-thread\.jsonl/);
  assert.doesNotMatch(serialized, /TEST_CANARY_NPM_TOKEN_INVALID/);
});

test("qa-lab run treats evidence overrides outside the evidence directory as P0 invalid evidence", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-outside-evidence-");
  const outsideDir = makeTempDir(t, "loo-qa-lab-run-outside-target-");
  const outsideReport = join(outsideDir, "workflow-run.json");
  writeReadyEvidence(dir);
  writeJson(outsideReport, {
    schema: "lco.qaLab.workflowRun.v1",
    ok: true,
    workflowRunReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    scenarioId: "real-agent-core-workflow",
    blockers: [],
    actionsPerformed: noActions()
  });

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    evidenceDir: dir,
    workflowRun: outsideReport,
    now: "2026-07-05T00:00:00.000Z"
  });

  const serialized = JSON.stringify(report);
  assert.equal(report.qaLabReady, false);
  assert.equal(report.evidenceIndex.workflowRun.status, "invalid");
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "workflow_run_outside_evidence_dir"));
  assert.doesNotMatch(serialized, /outside-target/);
});

test("qa-lab run treats generic malformed evidence as P1 invalid evidence", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-generic-invalid-evidence-");
  writeReadyEvidence(dir);
  writeJson(join(dir, "workflow-run.json"), []);

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    evidenceDir: dir,
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.qaLabReady, false);
  assert.equal(report.evidenceIndex.workflowRun.status, "invalid");
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P1" && blocker.code === "workflow_run_invalid_json_object"));
});

test("qa-lab run treats symlinked evidence reports as P0 invalid evidence", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-symlink-evidence-");
  const targetDir = makeTempDir(t, "loo-qa-lab-run-symlink-target-");
  const workflowReport = join(dir, "workflow-run.json");
  const targetReport = join(targetDir, "workflow-run.json");
  writeReadyEvidence(dir);
  writeJson(targetReport, {
    schema: "lco.qaLab.workflowRun.v1",
    ok: true,
    workflowRunReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    scenarioId: "real-agent-core-workflow",
    blockers: [],
    actionsPerformed: noActions()
  });
  rmSync(workflowReport, { force: true });
  symlinkSync(targetReport, workflowReport);

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    evidenceDir: dir,
    now: "2026-07-05T00:00:00.000Z"
  });

  const serialized = JSON.stringify(report);
  assert.equal(report.qaLabReady, false);
  assert.equal(report.evidenceIndex.workflowRun.status, "invalid");
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "workflow_run_symlink_disallowed"));
  assert.doesNotMatch(serialized, /symlink-target/);
});

test("qa-lab run treats raw local path keys without extensions as unsafe", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-raw-path-key-");
  writeReadyEvidence(dir);
  writeJson(join(dir, "workflow-run.json"), {
    schema: "lco.qaLab.workflowRun.v1",
    ok: true,
    workflowRunReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    "/Users/lume/private/session": "redacted",
    blockers: [],
    actionsPerformed: noActions()
  });

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    evidenceDir: dir,
    now: "2026-07-05T00:00:00.000Z"
  });

  const serialized = JSON.stringify(report);
  assert.equal(report.qaLabReady, false);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "workflow_run_unsafe_evidence_value"));
  assert.doesNotMatch(serialized, /Users/);
});

test("qa-lab run blocks privacy-scan leak findings", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-privacy-scan-findings-");
  writeReadyEvidence(dir);
  writeJson(join(dir, "privacy-scan.json"), {
    schema: "lco.privacyScan.v1",
    ok: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    blockers: [],
    rawSessionArtifacts: [{ name: "redacted", reason: "raw_codex_jsonl" }],
    secretLikeEvidenceFindings: [{ name: "redacted", reason: "secret_like_value" }],
    actionsPerformed: noActions()
  });

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    evidenceDir: dir,
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.qaLabReady, false);
  assert.equal(report.publicSafe, false);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "privacy_scan_has_findings"));
});

test("qa-lab run preserves P0 severity from prefixed string upstream blockers", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-prefixed-blocker-");
  writeReadyEvidence(dir);
  writeJson(join(dir, "scenario-sweep.json"), {
    schema: "lco.scenarioSweep.v1",
    ok: false,
    scenarioReady: false,
    publicSafe: true,
    packageVersion,
    candidateSha,
    scenarioCount: 1,
    failedScenarioCount: 1,
    blockers: ["P0: raw transcript leak marker"],
    actionsPerformed: noActions()
  });

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    evidenceDir: dir,
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.qaLabReady, false);
  assert.equal(report.publicSafe, false);
  assert.ok(report.blockers.some((blocker) =>
    blocker.source === "scenarioSweep"
    && blocker.severity === "P0"
    && blocker.code === "raw_transcript_leak_marker"
    && blocker.detail === "raw transcript leak marker"
  ));
});

test("qa-lab run redacts short cookie auth and key material in upstream findings", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-sensitive-finding-");
  writeReadyEvidence(dir);
  writeJson(join(dir, "workflow-run.json"), {
    schema: "lco.qaLab.workflowRun.v1",
    ok: true,
    workflowRunReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    blockers: [{
      severity: "P1",
      code: "cookie=sessionid=abc123",
      detail: "apiKey=short-secret and Authorization: Basic abc123 were present"
    }],
    actionsPerformed: noActions()
  });

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    evidenceDir: dir,
    now: "2026-07-05T00:00:00.000Z"
  });

  const serialized = JSON.stringify(report);
  assert.equal(report.qaLabReady, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "redacted_finding"));
  assert.doesNotMatch(serialized, /sessionid/);
  assert.doesNotMatch(serialized, /short-secret/);
  assert.doesNotMatch(serialized, /Basic abc123/);
});

test("qa-lab run preserves distinct upstream findings with matching source code and severity", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-distinct-findings-");
  writeReadyEvidence(dir);
  writeJson(join(dir, "workflow-run.json"), {
    schema: "lco.qaLab.workflowRun.v1",
    ok: true,
    workflowRunReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    blockers: [
      { severity: "P1", code: "required_tool_missing", source: "workflow", detail: "loo_prepared_cards was not invoked." },
      { severity: "P1", code: "required_tool_missing", source: "workflow", detail: "loo_summary_expand was not invoked." },
      { severity: "P1", code: "required_tool_missing", source: "workflow", detail: "loo_summary_expand was not invoked." }
    ],
    actionsPerformed: noActions()
  });

  const report = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    evidenceDir: dir,
    now: "2026-07-05T00:00:00.000Z"
  });

  const requiredToolFindings = report.blockers.filter((blocker) => blocker.code === "required_tool_missing");
  assert.equal(report.qaLabReady, false);
  assert.equal(requiredToolFindings.length, 2);
  assert.deepEqual(requiredToolFindings.map((blocker) => blocker.detail).sort(), [
    "loo_prepared_cards was not invoked.",
    "loo_summary_expand was not invoked."
  ]);
});

for (const restrictedActionFlag of [
  "liveCodexControlRun",
  "desktopGuiActionRun",
  "rawTranscriptRead",
  "rawPromptRead",
  "npmPublished",
  "githubReleaseCreated",
  "sourceStoreMutation",
  "gatewayScopeApproval",
  "broadGatewayScopeApproval"
] as const) {
  test(`qa-lab run blocks restricted action flag ${restrictedActionFlag} in source evidence`, (t) => {
    const dir = makeTempDir(t, `loo-qa-lab-run-restricted-${restrictedActionFlag}-`);
    writeReadyEvidence(dir);
    writeJson(join(dir, "desktop-contract.json"), {
      schema: "lco.qaLab.desktopContract.v1",
      ok: true,
      desktopContractReady: true,
      publicSafe: true,
      packageVersion,
      candidateSha,
      blockers: [],
      actionsPerformed: {
        ...noActions(),
        [restrictedActionFlag]: true
      }
    });

    const report = createQaLabRunReport({
      suite: "ga",
      artifact: "published",
      packageVersion,
      candidateSha,
      evidenceDir: dir,
      now: "2026-07-05T00:00:00.000Z"
    });

    assert.equal(report.qaLabReady, false);
    assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "desktop_contract_restricted_action_performed"));
  });
}

test("qa-lab run requires live-control matrix only for live-control claim scopes", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-live-optional-");
  writeReadyEvidence(dir);
  rmSync(join(dir, "live-control-matrix.json"), { force: true });

  const readOnly = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    claimScope: "codex-read-search-expand-dry-run",
    evidenceDir: dir
  });
  assert.equal(readOnly.qaLabReady, true);
  assert.equal(readOnly.evidenceIndex.liveControlMatrix.status, "not_required_by_claim_scope");

  const live = createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    claimScope: "codex-working-app-proof",
    evidenceDir: dir
  });
  assert.equal(live.qaLabReady, false);
  assert.ok(live.blockers.some((blocker) => blocker.code === "live_control_matrix_evidence_missing"));
});

test("qa-lab run feeds release ga-smoke through judge and adversarial review reports", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-run-ga-smoke-");
  writeReadyEvidence(dir);
  createQaLabRunReport({
    suite: "ga",
    artifact: "published",
    packageVersion,
    candidateSha,
    claimScope: "codex-working-app-proof",
    evidenceDir: dir
  });
  createQaLabJudgeReviewReport({
    runPath: join(dir, "qa-lab-run.json"),
    evidenceDir: dir,
    rubricVersion: "real-product-v1"
  });
  createQaLabAdversarialReviewReport({
    runPath: join(dir, "qa-lab-run.json"),
    evidenceDir: dir,
    lenses: ["safety", "retrieval", "packaging", "claims", "agentUsability"]
  });
  writeJson(join(dir, "release-status.json"), {
    ok: true,
    releaseReady: true,
    packageName: "lossless-openclaw-orchestrator",
    packageVersion,
    candidateSha,
    claimScope: "codex-working-app-proof",
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(join(dir, "release-finalization-status.json"), {
    ok: true,
    finalized: true,
    packageName: "lossless-openclaw-orchestrator",
    packageVersion,
    candidateSha,
    expectedDistTag: "latest",
    npm: { packageVersion, distTag: "latest" },
    gitTag: { tag: `v${packageVersion}`, targetSha: candidateSha },
    githubRelease: { tag: `v${packageVersion}`, targetSha: candidateSha },
    actionsVerified: {
      npmPublished: true,
      gitTagPushed: true,
      githubReleaseCreated: true
    },
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(join(dir, "published-package-smoke.json"), {
    ok: true,
    publishedSmokeReady: true,
    publicSafe: true,
    packageVersion,
    localVersion: packageVersion,
    candidateSha,
    packagePathOk: true,
    setupRequired: false,
    registry: { version: packageVersion },
    configuredGateway: {
      provided: true,
      toolSmokeReady: true,
      gatewaySetupClassification: "ready",
      packageInstallLikelyOk: true,
      invokedTools: ["loo_doctor"]
    },
    blockers: [],
    setupBlockers: [],
    actionsPerformed: noActions()
  });
  writeJson(join(dir, "openclaw-dogfood.json"), {
    ok: true,
    dogfoodReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    requiredToolsPresent: true,
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(join(dir, "openclaw-tool-smoke.json"), {
    ok: true,
    toolSmokeReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    catalog: { requiredToolsPresent: true, missingRequiredTools: [], toolCount: 60 },
    setupStatus: { classification: "ready", packageInstallLikelyOk: true },
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(join(dir, "release-preflight.json"), {
    ok: true,
    releaseReady: true,
    publicSafe: true,
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(join(dir, "release-bundle.json"), {
    ok: true,
    publishReady: true,
    publicSafe: true,
    blockers: [],
    actionsPerformed: noActions()
  });

  const ga = createReleaseGaSmokeReport({
    evidenceDir: dir,
    packageVersion,
    candidateSha,
    claimScope: "codex-working-app-proof"
  });

  assert.equal(ga.gaSmokeReady, true, JSON.stringify(ga.blockers, null, 2));
  assert.equal(ga.actionsVerified.qaLabRunReady, true);
  assert.equal(ga.actionsVerified.qaLabJudgeReviewReady, true);
  assert.equal(ga.actionsVerified.qaLabAdversarialReviewReady, true);
});

test("loo qa-lab run --help exposes aggregate-only real-product gate", () => {
  const result = runLoo(["qa-lab", "run", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo qa-lab run/);
  assert.match(result.stdout, /--suite ga/);
  assert.match(result.stdout, /--artifact published\|candidate/);
  assert.match(result.stdout, /aggregate-only/i);
  assert.match(result.stdout, /does not run live Codex control/i);
  assert.match(result.stdout, /qa-lab-run\.json/);
});
