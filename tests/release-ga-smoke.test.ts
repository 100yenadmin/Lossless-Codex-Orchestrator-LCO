import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
const packageName = "lossless-openclaw-orchestrator";
const packageVersion = "1.2.4";
const candidateSha = "0f8802f9fe198e50e20c9f0a3e5f5c85b9fcafb5";

type GaSmokeReport = {
  ok: boolean;
  gaSmokeReady: boolean;
  schema: string;
  packageVersion: string;
  candidateSha: string;
  blockers: Array<{ severity: string; code: string; source: string; detail: string }>;
  setupBlockers: Array<{ code: string; source: string; detail: string; allowed: boolean }>;
  warnings: Array<{ code: string; source: string; detail: string }>;
  actionsVerified: Record<string, boolean>;
  actionsPerformed: Record<string, boolean>;
  evidenceIndex: Record<string, { status: string; evidenceRef: string | null; blockerCodes: string[] }>;
  nextSafeCommands: string[];
  proofBoundary: string;
};

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function runGaSmoke(args: string[]) {
  return spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "ga-smoke",
    ...args
  ], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    timeout: 20_000
  });
}

function makeTempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeHappyEvidence(dir: string): Record<string, string> {
  const paths = {
    releaseStatus: join(dir, "release-status.json"),
    finalization: join(dir, "release-finalization-status.json"),
    publishedSmoke: join(dir, "published-package-smoke.json"),
    dogfood: join(dir, "openclaw-dogfood.json"),
    toolSmoke: join(dir, "openclaw-tool-smoke.json"),
    scenarioSweep: join(dir, "scenario-sweep.json"),
    scorecardSweep: join(dir, "scorecard-sweep.json"),
    releasePreflight: join(dir, "release-preflight.json"),
    releaseBundle: join(dir, "release-bundle.json"),
    privacyScan: join(dir, "privacy-scan.json"),
    qaLabRun: join(dir, "qa-lab-run.json"),
    toolCoverage: join(dir, "tool-coverage.json"),
    judgeReview: join(dir, "judge-review.json"),
    adversarialReview: join(dir, "adversarial-review.json")
  };
  writeJson(paths.releaseStatus, {
    ok: true,
    releaseReady: true,
    packageName,
    packageVersion,
    candidateSha,
    claimScope: "codex-working-app-proof",
    blockers: [],
    releaseChecks: [
      { id: "candidate_sha", satisfied: true },
      { id: "github_ci", satisfied: true },
      { id: "codeql", satisfied: true }
    ],
    actionsPerformed: noActions()
  });
  writeJson(paths.finalization, {
    ok: true,
    finalized: true,
    packageName,
    packageVersion,
    candidateSha,
    expectedDistTag: "latest",
    actionsVerified: {
      npmPublished: true,
      gitTagPushed: true,
      githubReleaseCreated: true
    },
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(paths.publishedSmoke, {
    ok: true,
    publishedSmokeReady: true,
    packagePathOk: true,
    publicSafe: true,
    packageName,
    localVersion: packageVersion,
    expectedDistTag: "latest",
    expectedPackage: `${packageName}@latest`,
    versionMatchStatus: "matches_registry_latest",
    dogfood: { dogfoodReady: true, requiredToolsPresent: true },
    toolSmoke: {
      toolSmokeReady: true,
      gatewaySetupClassification: "ready",
      packageInstallLikelyOk: true
    },
    configuredGateway: {
      provided: true,
      toolSmokeReady: true,
      gatewaySetupClassification: "ready",
      packageInstallLikelyOk: true,
      toolCount: 60,
      invokedTools: ["loo_doctor", "loo_search_sessions"]
    },
    setupRequired: false,
    setupBlockers: [],
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(paths.dogfood, {
    ok: true,
    dogfoodReady: true,
    publicSafe: true,
    requiredToolsPresent: true,
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(paths.toolSmoke, {
    ok: true,
    toolSmokeReady: true,
    publicSafe: true,
    catalog: { requiredToolsPresent: true, missingRequiredTools: [], toolCount: 60 },
    setupStatus: { classification: "ready", packageInstallLikelyOk: true },
    agentReasoning: {
      rawTranscriptRead: false,
      dryRunLive: false,
      workflowEvidence: ["doctor_ready", "search_source_ref", "bounded_expand", "dry_run_audit"]
    },
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(paths.scenarioSweep, {
    ok: true,
    scenarioReady: true,
    publicSafe: true,
    blockers: [],
    actionsPerformed: { ...noActions(), rawTranscriptRead: false }
  });
  writeJson(paths.scorecardSweep, {
    ok: true,
    sweepReady: true,
    publicSafe: true,
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(paths.releasePreflight, {
    ok: true,
    releaseReady: true,
    publicSafe: true,
    blockers: [],
    rawSessionArtifacts: [],
    evidenceScanDepthExceeded: [],
    actionsPerformed: noActions()
  });
  writeJson(paths.releaseBundle, {
    ok: true,
    publishReady: true,
    publicSafe: true,
    blockers: [],
    rawSessionArtifacts: [],
    actionsPerformed: noActions()
  });
  writeJson(paths.privacyScan, {
    ok: true,
    publicSafe: true,
    blockers: [],
    rawSessionArtifacts: [],
    secretLikeEvidenceFindings: [],
    actionsPerformed: noActions()
  });
  writeJson(paths.qaLabRun, {
    schema: "lco.qaLab.run.v1",
    ok: true,
    qaLabReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    claimScope: "codex-working-app-proof",
    scenarioCount: 12,
    failedScenarioCount: 0,
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(paths.toolCoverage, {
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
    actionsPerformed: noActions()
  });
  writeJson(paths.judgeReview, {
    schema: "lco.qaLab.judgeReview.v1",
    ok: true,
    gaReady: true,
    publicSafe: true,
    summary: { packageVersion, candidateSha, claimScope: "codex-working-app-proof" },
    scores: { privacy: 5, safety: 5, retrieval: 5, packaging: 5, claims: 5, agentUsability: 5 },
    averageScore: 5,
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(paths.adversarialReview, {
    schema: "lco.qaLab.adversarialReview.v1",
    ok: true,
    publicSafe: true,
    blockersBySeverity: { P0: 0, P1: 0, P2: 0, P3: 1 },
    blockers: [],
    warnings: [{ severity: "P3", code: "docs_followup", source: "claims", detail: "Filed non-blocking docs follow-up." }],
    actionsPerformed: noActions()
  });
  return paths;
}

function noActions(): Record<string, false> {
  return {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false
  };
}

test("release ga-smoke writes one public-safe ready packet from existing evidence", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-pass-");
  writeHappyEvidence(dir);

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.equal(report.schema, "lco.release.gaSmoke.v1");
  assert.equal(report.ok, true);
  assert.equal(report.gaSmokeReady, true);
  assert.equal(report.packageVersion, packageVersion);
  assert.equal(report.candidateSha, candidateSha);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.setupBlockers, []);
  assert.equal(report.actionsVerified.releaseFinalized, true);
  assert.equal(report.actionsVerified.publishedPackageSmokeReady, true);
  assert.equal(report.actionsVerified.qaLabRunReady, true);
  assert.equal(report.actionsVerified.qaLabToolCoverageReady, true);
  assert.equal(report.actionsVerified.qaLabJudgeReviewReady, true);
  assert.equal(report.actionsVerified.qaLabAdversarialReviewReady, true);
  assert.deepEqual(report.actionsPerformed, {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false
  });
  assert.equal(report.evidenceIndex.releaseFinalizationStatus?.status, "ready");
  assert.equal(report.evidenceIndex.releaseFinalizationStatus?.evidenceRef, "release-finalization-status.json");
  assert.equal(report.evidenceIndex.qaLabRun?.status, "ready");
  assert.equal(report.evidenceIndex.qaLabToolCoverage?.status, "ready");
  assert.equal(report.evidenceIndex.qaLabJudgeReview?.status, "ready");
  assert.equal(report.evidenceIndex.qaLabAdversarialReview?.status, "ready");
  assert.match(report.proofBoundary, /does not publish npm/i);
  assert.equal(existsSync(join(dir, "release-ga-smoke.json")), true);
});

test("release ga-smoke requires QA Lab evidence for a GA-ready claim", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-missing-qa-lab-");
  const paths = writeHappyEvidence(dir);
  rmSync(paths.qaLabRun, { force: true });
  rmSync(paths.toolCoverage, { force: true });
  rmSync(paths.judgeReview, { force: true });
  rmSync(paths.adversarialReview, { force: true });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.code === "qa_lab_run_evidence_missing"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "qa_lab_tool_coverage_evidence_missing"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "qa_lab_judge_review_evidence_missing"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "qa_lab_adversarial_review_evidence_missing"));
  assert.ok(report.nextSafeCommands.some((command) => command.includes("loo qa-lab run")));
  assert.ok(report.nextSafeCommands.some((command) => command.includes("loo qa-lab tool-coverage")));
});

test("release ga-smoke blocks non-ready QA Lab reports but allows P3 adversarial warnings", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-qa-lab-blocked-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.toolCoverage, {
    ...readJson(paths.toolCoverage) as Record<string, unknown>,
    ok: false,
    qaLabToolCoverageReady: false,
    blockers: [{ severity: "P2", code: "declared_tool_product_evidence_missing", source: "toolCoverage", detail: "One declared tool lacks product evidence." }]
  });
  writeJson(paths.adversarialReview, {
    ...readJson(paths.adversarialReview) as Record<string, unknown>,
    ok: true,
    blockers: [],
    warnings: [{ severity: "P3", code: "copy_tweak", source: "claims", detail: "Non-blocking launch copy follow-up." }]
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P2" && blocker.code === "qa_lab_tool_coverage_not_ready"));
  assert.ok(report.warnings.some((warning) => warning.code === "copy_tweak"));
  assert.ok(!report.blockers.some((blocker) => blocker.code === "copy_tweak"));
});

test("release ga-smoke requires QA Lab run and coverage evidence to bind package version and candidate SHA", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-qa-lab-binding-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.qaLabRun, {
    schema: "lco.qaLab.workflowRun.v1",
    ok: true,
    workflowRunReady: true,
    publicSafe: true,
    blockers: [],
    actionsPerformed: noActions()
  });
  writeJson(paths.toolCoverage, {
    schema: "lco.qaLab.toolCoverage.v1",
    ok: true,
    qaLabToolCoverageReady: true,
    publicSafe: true,
    coveragePolicy: "full",
    blockers: [],
    actionsPerformed: noActions()
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.code === "qa_lab_run_version_mismatch"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "qa_lab_run_sha_mismatch"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "qa_lab_tool_coverage_version_mismatch"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "qa_lab_tool_coverage_sha_mismatch"));
});

test("release ga-smoke propagates structured QA Lab judge and adversarial findings", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-qa-lab-structured-findings-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.judgeReview, {
    ...readJson(paths.judgeReview) as Record<string, unknown>,
    blockers: [{ severity: "P0", code: "privacy.leak? canary", source: "privacy", detail: "Privacy rubric failed." }],
    warnings: [{ severity: "P3", code: "judge docs followup", source: "claims", detail: "Non-blocking judge note." }]
  });
  writeJson(paths.adversarialReview, {
    ...readJson(paths.adversarialReview) as Record<string, unknown>,
    blockers: [{ severity: "P1", code: "adversarial safety blocker", source: "safety", detail: "Safety lens failed." }],
    warnings: [{ severity: "P3", code: "adversarial note", source: "claims", detail: "Non-blocking adversarial note." }]
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "privacy_leak_canary" && blocker.source === "qaLabJudgeReview"));
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P1" && blocker.code === "adversarial_safety_blocker" && blocker.source === "qaLabAdversarialReview"));
  assert.ok(report.warnings.some((warning) => warning.code === "judge_docs_followup" && warning.source === "qaLabJudgeReview"));
  assert.ok(report.warnings.some((warning) => warning.code === "adversarial_note" && warning.source === "qaLabAdversarialReview"));
});

test("release ga-smoke treats plain-string QA Lab warnings as non-blocking P3 findings", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-qa-lab-string-warnings-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.judgeReview, {
    ...readJson(paths.judgeReview) as Record<string, unknown>,
    warnings: ["copy.tweak"]
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.warnings.some((warning) => warning.code === "copy_tweak" && warning.source === "qaLabJudgeReview"));
  assert.ok(!report.blockers.some((blocker) => blocker.code === "copy_tweak"));
});

test("release ga-smoke reconciles aggregate QA Lab failure counters even when findings self-downgrade", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-qa-lab-aggregate-guards-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.qaLabRun, {
    ...readJson(paths.qaLabRun) as Record<string, unknown>,
    failedScenarioCount: 2,
    warnings: [{ severity: "P3", code: "run downgraded", detail: "This warning must not hide failed scenarios." }]
  });
  writeJson(paths.adversarialReview, {
    ...readJson(paths.adversarialReview) as Record<string, unknown>,
    blockersBySeverity: { P0: 1, P1: 1, P2: 0, P3: 0 },
    blockers: [{ severity: "P3", code: "adversarial downgraded", detail: "This warning must not hide aggregate blockers." }]
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P1" && blocker.code === "qa_lab_run_failed_scenarios" && blocker.source === "qaLabRun"));
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "qa_lab_adversarial_review_aggregate_p0" && blocker.source === "qaLabAdversarialReview"));
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P1" && blocker.code === "qa_lab_adversarial_review_aggregate_p1" && blocker.source === "qaLabAdversarialReview"));
});

test("release ga-smoke preserves distinct QA Lab findings that sanitize to the same code", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-qa-lab-code-collision-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.judgeReview, {
    ...readJson(paths.judgeReview) as Record<string, unknown>,
    blockers: [
      { severity: "P1", code: "claim.audit", detail: "First blocker." },
      { severity: "P1", code: "claim_audit", detail: "Second blocker." }
    ]
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  const judgeCodes = report.blockers
    .filter((blocker) => blocker.source === "qaLabJudgeReview")
    .map((blocker) => blocker.code);
  assert.ok(judgeCodes.includes("claim_audit"));
  assert.equal(judgeCodes.filter((code) => code.startsWith("claim_audit_")).length, 1);
});

test("release ga-smoke --strict fails closed with missing evidence and recovery commands", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-missing-");

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.equal(report.gaSmokeReady, false);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P1" && blocker.code === "release_status_evidence_missing"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "release_finalization_status_evidence_missing"));
  assert.ok(report.nextSafeCommands.some((command) => command.includes("loo release status")));
  assert.ok(report.nextSafeCommands.some((command) => command.includes("loo release finalization-status")));
});

test("release ga-smoke rejects version, SHA, and finalization mismatches", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-mismatch-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.releaseStatus, {
    ...readJson(paths.releaseStatus) as Record<string, unknown>,
    candidateSha: "e".repeat(40)
  });
  writeJson(paths.finalization, {
    ...readJson(paths.finalization) as Record<string, unknown>,
    packageVersion: "1.2.3",
    candidateSha: "f".repeat(40)
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.code === "release_status_sha_mismatch"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "release_finalization_version_mismatch"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "release_finalization_sha_mismatch"));
});

test("release ga-smoke accepts legacy release-status evidence without embedded candidate SHA with a warning", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-legacy-status-");
  const paths = writeHappyEvidence(dir);
  const releaseStatus = readJson(paths.releaseStatus) as Record<string, unknown>;
  delete releaseStatus.candidateSha;
  writeJson(paths.releaseStatus, releaseStatus);

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.equal(report.gaSmokeReady, true);
  assert.ok(report.warnings.some((warning) => warning.code === "release_status_candidate_sha_not_embedded"));
  assert.equal(report.evidenceIndex.releaseStatus?.status, "ready");
});

test("release ga-smoke allows large public-safe JSON evidence sidecars", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-large-json-");
  writeHappyEvidence(dir);
  writeJson(join(dir, "large-public-safe-scorecard.json"), {
    publicSafe: true,
    payload: "a".repeat(1_100_000)
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.equal(report.gaSmokeReady, true);
  assert.ok(!report.blockers.some((blocker) => blocker.code === "unsafe_evidence_artifact_present"));
});

test("release ga-smoke rejects evidence override paths outside the evidence directory", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-outside-");
  const outside = makeTempDir(t, "loo-ga-smoke-outside-src-");
  const paths = writeHappyEvidence(dir);
  writeJson(join(outside, "release-status.json"), readJson(paths.releaseStatus));

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--release-status",
    join(outside, "release-status.json"),
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "release_status_outside_evidence_dir"));
  assert.equal(report.evidenceIndex.releaseStatus?.status, "blocked");
});

test("release ga-smoke rejects lowercase bearer tokens and sensitive evidence keys", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-secret-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.toolSmoke, {
    ...readJson(paths.toolSmoke) as Record<string, unknown>,
    authorization: `bearer ${"a".repeat(24)}`,
    nested: {
      cookie: "session=public-looking-but-still-cookie"
    }
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "openclaw_tool_smoke_contains_secret_like_value"));
});

test("release ga-smoke rejects nested publicSafe false reports", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-nested-unsafe-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.publishedSmoke, {
    ...readJson(paths.publishedSmoke) as Record<string, unknown>,
    configuredGateway: {
      publicSafe: false,
      toolSmokeReady: true
    }
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "published_smoke_not_public_safe"));
});

test("release ga-smoke reports non-setup published-smoke blockers", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-published-blocker-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.publishedSmoke, {
    ...readJson(paths.publishedSmoke) as Record<string, unknown>,
    blockers: ["package_install_failed"]
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P1" && blocker.code === "published_smoke_reports_blockers"));
});

test("release ga-smoke rejects raw npm and gateway output artifact names", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-raw-output-");
  writeHappyEvidence(dir);
  writeFileSync(join(dir, "npm-output.log"), "public-looking raw command output\n");
  writeJson(join(dir, "gateway-output.json"), { ok: true });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "unsafe_evidence_artifact_present"));
});

test("release ga-smoke fails closed for non-public-safe evidence without leaking canaries", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-private-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.publishedSmoke, {
    ...readJson(paths.publishedSmoke) as Record<string, unknown>,
    publicSafe: false,
    privateDiagnostic: "raw npm error /Users/lume/private/.npmrc npm_123456789012345678901234"
  });
  writeJson(join(dir, "secret-session.sqlite"), { private: true });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "published_smoke_not_public_safe"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "unsafe_evidence_artifact_present"));
  const serialized = `${result.stdout}\n${readFileSync(join(dir, "release-ga-smoke.json"), "utf8")}`;
  assert.doesNotMatch(serialized, /\/Users\/lume|privateDiagnostic|npm_123456789012345678901234|secret-session\.sqlite/);
});

test("release ga-smoke rejects top-level restricted action flags in evidence", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-top-action-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.releaseBundle, {
    ...readJson(paths.releaseBundle) as Record<string, unknown>,
    npmPublished: true,
    githubReleaseCreated: true
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "release_bundle_restricted_action_performed"));
  assert.equal(report.evidenceIndex.releaseBundle?.status, "unsafe");
  assert.equal(report.actionsPerformed.npmPublished, false);
  assert.equal(report.actionsPerformed.githubReleaseCreated, false);
});

test("release ga-smoke classifies setup-required fresh profiles separately from package defects", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-setup-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.publishedSmoke, {
    ...readJson(paths.publishedSmoke) as Record<string, unknown>,
    ok: true,
    packagePathOk: true,
    publishedSmokeReady: false,
    setupRequired: true,
    setupBlockers: ["fresh_profile_gateway_credentials_required"],
    toolSmoke: {
      toolSmokeReady: false,
      gatewaySetupClassification: "gateway_setup_required",
      packageInstallLikelyOk: true
    },
    configuredGateway: {
      provided: true,
      toolSmokeReady: true,
      gatewaySetupClassification: "ready",
      packageInstallLikelyOk: true,
      toolCount: 60,
      invokedTools: ["loo_doctor", "loo_search_sessions"]
    }
  });

  const blocked = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);
  assert.equal(blocked.status, 1, blocked.stderr || blocked.stdout);
  const blockedReport = JSON.parse(blocked.stdout) as GaSmokeReport;
  assert.ok(blockedReport.blockers.some((blocker) => blocker.severity === "P2" && blocker.code === "fresh_profile_gateway_setup_required"));
  assert.deepEqual(blockedReport.setupBlockers, [{
    code: "fresh_profile_gateway_credentials_required",
    source: "publishedPackageSmoke",
    detail: "Fresh-profile OpenClaw gateway setup is required before clean-profile gateway-ready proof.",
    allowed: false
  }]);

  const allowed = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--allow-setup-required",
    "--strict"
  ]);
  assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
  const allowedReport = JSON.parse(allowed.stdout) as GaSmokeReport;
  assert.equal(allowedReport.gaSmokeReady, true);
  assert.deepEqual(allowedReport.blockers, []);
  assert.equal(allowedReport.setupBlockers[0]?.allowed, true);
  assert.ok(allowedReport.warnings.some((warning) => warning.code === "published_smoke_setup_required_allowed"));
});

test("release ga-smoke does not allow setup-required without explicit setup blocker evidence", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-unclassified-setup-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.publishedSmoke, {
    ...readJson(paths.publishedSmoke) as Record<string, unknown>,
    ok: true,
    packagePathOk: true,
    publishedSmokeReady: false,
    setupRequired: true,
    setupBlockers: [],
    blockers: [],
    configuredGateway: {
      provided: true,
      toolSmokeReady: true,
      gatewaySetupClassification: "ready",
      packageInstallLikelyOk: true
    }
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--allow-setup-required",
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P2" && blocker.code === "published_smoke_setup_required_unclassified"));
  assert.equal(report.setupBlockers[0]?.allowed, false);
});

test("release ga-smoke classifies setup blockers from published-smoke blockers even without setupRequired flag", (t) => {
  const dir = makeTempDir(t, "loo-ga-smoke-setup-blocker-field-");
  const paths = writeHappyEvidence(dir);
  writeJson(paths.publishedSmoke, {
    ...readJson(paths.publishedSmoke) as Record<string, unknown>,
    ok: true,
    packagePathOk: true,
    publishedSmokeReady: false,
    setupRequired: false,
    blockers: ["fresh_profile_gateway_setup_required"],
    configuredGateway: {
      provided: true,
      toolSmokeReady: true,
      gatewaySetupClassification: "ready",
      packageInstallLikelyOk: true
    }
  });

  const result = runGaSmoke([
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--allow-setup-required",
    "--strict"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as GaSmokeReport;
  assert.equal(report.gaSmokeReady, true);
  assert.deepEqual(report.setupBlockers, [{
    code: "fresh_profile_gateway_setup_required",
    source: "publishedPackageSmoke",
    detail: "Fresh-profile OpenClaw gateway setup is required before clean-profile gateway-ready proof.",
    allowed: true
  }]);
});
