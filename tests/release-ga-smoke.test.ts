import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
    privacyScan: join(dir, "privacy-scan.json")
  };
  writeJson(paths.releaseStatus, {
    ok: true,
    releaseReady: true,
    packageName,
    packageVersion,
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

test("release ga-smoke writes one public-safe ready packet from existing evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-ga-smoke-pass-"));
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
  assert.deepEqual(report.actionsPerformed, {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false
  });
  assert.equal(report.evidenceIndex.releaseFinalizationStatus?.status, "ready");
  assert.equal(report.evidenceIndex.releaseFinalizationStatus?.evidenceRef, "release-finalization-status.json");
  assert.match(report.proofBoundary, /does not publish npm/i);
  assert.equal(existsSync(join(dir, "release-ga-smoke.json")), true);
});

test("release ga-smoke --strict fails closed with missing evidence and recovery commands", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-ga-smoke-missing-"));

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

test("release ga-smoke rejects version, SHA, and finalization mismatches", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-ga-smoke-mismatch-"));
  const paths = writeHappyEvidence(dir);
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
  assert.ok(report.blockers.some((blocker) => blocker.code === "release_finalization_version_mismatch"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "release_finalization_sha_mismatch"));
});

test("release ga-smoke fails closed for non-public-safe evidence without leaking canaries", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-ga-smoke-private-"));
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

test("release ga-smoke rejects top-level restricted action flags in evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-ga-smoke-top-action-"));
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
  assert.equal(report.actionsPerformed.npmPublished, false);
  assert.equal(report.actionsPerformed.githubReleaseCreated, false);
});

test("release ga-smoke classifies setup-required fresh profiles separately from package defects", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-ga-smoke-setup-"));
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
});
