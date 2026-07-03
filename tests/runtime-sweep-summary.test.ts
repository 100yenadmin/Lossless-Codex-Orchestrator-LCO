import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { createRuntimeSweepSummary } from "../packages/cli/src/runtime-sweep-summary.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeZeroRuntimeMarkerInputs(root: string): {
  evidenceDir: string;
  dryRunScenarios: string;
  runtimeScenarios: string;
  scorecardSweep: string;
  publishedSmoke: string;
  runtimeProofDir: string;
} {
  const evidenceDir = join(root, "summary");
  const runtimeProofDir = join(root, "runtime-proof");
  const dryRunScenarios = join(root, "scenarios-v1.json");
  const runtimeScenarios = join(root, "scenarios-v1-1.json");
  const scorecardSweep = join(root, "scorecards-working-app.json");
  const publishedSmoke = join(root, "published-smoke.json");
  writeJson(dryRunScenarios, {
    ok: true,
    scenarioReady: true,
    scenarioVersion: "1.0",
    scenarios: [
      { id: "plan-retrieval-v1", status: "dry_run_ready" },
      { id: "control-dry-run-audit-v1", status: "dry_run_ready" }
    ],
    blockers: []
  });
  writeJson(runtimeScenarios, {
    ok: false,
    scenarioReady: false,
    scenarioVersion: "1.1",
    scenarios: [
      {
        id: "openclaw-gateway-live-codex-v1-1",
        status: "runtime_proof_required",
        runtimeProof: {
          requiredMarkers: ["installed_gateway_path", "matching_approval_audit_id", "public_safe_scan"],
          presentMarkers: []
        },
        blockers: [
          "runtime_proof_missing:openclaw-gateway-live-codex-v1-1:installed_gateway_path",
          "runtime_proof_missing:openclaw-gateway-live-codex-v1-1:matching_approval_audit_id",
          "runtime_proof_missing:openclaw-gateway-live-codex-v1-1:public_safe_scan"
        ]
      }
    ],
    blockers: [
      "runtime_proof_missing:openclaw-gateway-live-codex-v1-1:installed_gateway_path",
      "runtime_proof_missing:openclaw-gateway-live-codex-v1-1:matching_approval_audit_id",
      "runtime_proof_missing:openclaw-gateway-live-codex-v1-1:public_safe_scan"
    ]
  });
  writeJson(scorecardSweep, {
    ok: false,
    claimScope: "codex-working-app-proof",
    blockers: ["scorecard_not_run:working-app-runtime-proof-review"],
    scorecards: [
      {
        name: "working-app-runtime-proof-review",
        status: "not_run",
        blockers: ["scorecard_not_run:working-app-runtime-proof-review"]
      }
    ]
  });
  writeJson(publishedSmoke, {
    ok: true,
    publishedSmokeReady: true,
    setupRequired: true,
    setupBlockers: ["openclaw_gateway_credentials_required"],
    setupRecovery: {
      classification: "gateway_setup_required",
      packageInstallLikelyOk: true
    },
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      npmPublished: false,
      githubReleaseCreated: false
    }
  });
  return { evidenceDir, dryRunScenarios, runtimeScenarios, scorecardSweep, publishedSmoke, runtimeProofDir };
}

test("runtime sweep summary separates dry-run readiness from missing runtime proof markers", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-runtime-sweep-summary-"));
  const inputs = writeZeroRuntimeMarkerInputs(root);

  const report = createRuntimeSweepSummary({
    ...inputs,
    now: "2026-07-03T10:00:00.000Z"
  });

  assert.equal(report.ok, true);
  assert.equal(report.summaryReady, true);
  assert.equal(report.dryRunScenarios.scenarioReady, true);
  assert.equal(report.runtimeRequiredScenarios.scenarioReady, false);
  assert.equal(report.runtimeProofMarkers.foundCount, 0);
  assert.equal(report.runtimeProofMarkers.missingCount, 3);
  assert.deepEqual(report.scorecards.workingAppRuntimeProofReview.blockers, ["scorecard_not_run:working-app-runtime-proof-review"]);
  assert.equal(report.gatewaySetup.classification, "setup_required");
  assert.equal(report.gatewaySetup.packageFailure, false);
  assert.deepEqual(report.gatewaySetup.setupBlockers, ["openclaw_gateway_credentials_required"]);
  assert.deepEqual(report.claimBoundary, {
    readSearchExpandDryRun: true,
    workingAppProof: false,
    liveControlProof: false,
    desktopGuiMutationProof: false,
    supportedClaimScope: "codex-read-search-expand-dry-run",
    reasonCodes: [
      "runtime_proof_markers_missing",
      "working_app_scorecard_not_run",
      "gateway_setup_required"
    ]
  });
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
  assert.equal(existsSync(join(inputs.evidenceDir, "runtime-sweep-summary.json")), true);
});

test("loo runtime sweep-summary strict mode writes public-safe summary for zero-marker sweep", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-runtime-sweep-summary-cli-"));
  const inputs = writeZeroRuntimeMarkerInputs(root);

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "runtime",
    "sweep-summary",
    "--evidence-dir",
    inputs.evidenceDir,
    "--dry-run-scenarios",
    inputs.dryRunScenarios,
    "--runtime-scenarios",
    inputs.runtimeScenarios,
    "--scorecard-sweep",
    inputs.scorecardSweep,
    "--published-smoke",
    inputs.publishedSmoke,
    "--runtime-proof-dir",
    inputs.runtimeProofDir,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as ReturnType<typeof createRuntimeSweepSummary>;
  assert.equal(payload.summaryReady, true);
  assert.equal(payload.runtimeProofMarkers.foundCount, 0);
  assert.equal(payload.claimBoundary.workingAppProof, false);
  assert.equal(payload.claimBoundary.supportedClaimScope, "codex-read-search-expand-dry-run");
  assert.match(readFileSync(join(inputs.evidenceDir, "runtime-sweep-summary.json"), "utf8"), /scorecard_not_run:working-app-runtime-proof-review/);
});
