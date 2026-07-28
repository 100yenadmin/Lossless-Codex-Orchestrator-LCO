import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createHermesReadinessReport } from "../packages/cli/src/hermes-readiness.js";
import { runLoo } from "./helpers/run-loo.js";

const CANDIDATE_SHA = "0123456789abcdef0123456789abcdef01234567";
const PACKAGE_NAME = "lossless-codex-orchestrator";

test("Hermes readiness binds a successful smoke and package probe to one candidate", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-hermes-readiness-"));
  try {
    const hermesSmokePath = join(root, "hermes-smoke.json");
    const packageSmokePath = join(root, "cli-mcp-product-smoke.json");
    writeFileSync(hermesSmokePath, `${JSON.stringify({
      schema: "lco.hermesSmoke.v1",
      ok: true,
      publicSafe: true,
      packageName: PACKAGE_NAME,
      packageVersion: "1.6.0",
      candidateSha: CANDIDATE_SHA,
      notificationSilenceReady: true,
      structuredContentObjectReady: true,
      defaultFindIndexSkipped: true,
      requiredToolsPresent: true,
      actionsPerformed: restrictedActions()
    })}\n`);
    writeFileSync(packageSmokePath, `${JSON.stringify({
      schema: "lco.qaLab.cliMcpProductSmoke.v1",
      ok: true,
      publicSafe: true,
      packageName: PACKAGE_NAME,
      packageVersion: "1.6.0",
      candidateSha: CANDIDATE_SHA,
      actionsPerformed: restrictedActions()
    })}\n`);

    const report = createHermesReadinessReport({
      evidenceDir: root,
      packageVersion: "1.6.0",
      candidateSha: CANDIDATE_SHA,
      hermesSmokePath,
      packageSmokePath,
      now: "2026-07-29T00:00:00.000Z"
    });

    assert.equal(report.schema, "lco.release.hermesReadiness.v1");
    assert.equal(report.ok, true);
    assert.equal(report.candidateReady, true);
    assert.equal(report.packageName, PACKAGE_NAME);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.actionsPerformed.npmPublished, false);
    assert.deepEqual(report.requiredEvidence, {
      hermesSmoke: "hermes-smoke.json",
      packageSmoke: "cli-mcp-product-smoke.json"
    });
    assert.match(report.proofBoundary, /does not prove merge, publication, or active Eva runtime/i);
    assert.doesNotMatch(
      readFileSync(join(root, "hermes-readiness.json"), "utf8"),
      /raw transcript|Bearer |\/Users\/|\/Volumes\/|\/private\//
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Hermes readiness fails closed on SHA drift and restricted actions", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-hermes-readiness-fail-"));
  try {
    const hermesSmokePath = join(root, "hermes-smoke.json");
    const packageSmokePath = join(root, "cli-mcp-product-smoke.json");
    writeFileSync(hermesSmokePath, `${JSON.stringify({
      schema: "lco.hermesSmoke.v1",
      ok: true,
      publicSafe: true,
      packageName: "lossless-openclaw-orchestrator",
      packageVersion: "1.6.0",
      candidateSha: "ffffffffffffffffffffffffffffffffffffffff",
      actionsPerformed: restrictedActions()
    })}\n`);
    writeFileSync(packageSmokePath, `${JSON.stringify({
      schema: "lco.qaLab.cliMcpProductSmoke.v1",
      ok: true,
      publicSafe: true,
      packageName: PACKAGE_NAME,
      packageVersion: "1.6.0",
      candidateSha: CANDIDATE_SHA,
      actionsPerformed: { ...restrictedActions(), liveCodexControlRun: true }
    })}\n`);

    const report = createHermesReadinessReport({
      evidenceDir: root,
      packageVersion: "1.6.0",
      candidateSha: CANDIDATE_SHA,
      hermesSmokePath,
      packageSmokePath
    });

    assert.equal(report.ok, false);
    assert.equal(report.candidateReady, false);
    assert.equal(report.blockers.includes("hermes_smoke_package_name_mismatch"), true);
    assert.equal(report.blockers.includes("hermes_smoke_candidate_sha_mismatch"), true);
    assert.equal(report.blockers.includes("candidate_package_smoke_restricted_actions_performed"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Hermes readiness reports blockers without strict and exits non-zero with strict", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-hermes-readiness-cli-"));
  try {
    const args = [
      "release",
      "hermes-readiness",
      "--evidence-dir",
      join(root, "evidence"),
      "--package-version",
      "1.6.0",
      "--candidate-sha",
      CANDIDATE_SHA,
      "--hermes-smoke",
      join(root, "missing-hermes.json"),
      "--package-smoke",
      join(root, "missing-package.json")
    ];
    const nonStrict = runLoo(args);
    const strict = runLoo([...args, "--strict"]);

    assert.equal(nonStrict.status, 0, nonStrict.stderr);
    assert.equal(JSON.parse(nonStrict.stdout).candidateReady, false);
    assert.equal(strict.status, 1, strict.stderr);
    assert.equal(JSON.parse(strict.stdout).candidateReady, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Hermes readiness requires every restricted action marker to be explicitly false", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-hermes-readiness-actions-"));
  try {
    const hermesSmokePath = join(root, "hermes-smoke.json");
    const packageSmokePath = join(root, "cli-mcp-product-smoke.json");
    const base = {
      ok: true,
      publicSafe: true,
      packageName: PACKAGE_NAME,
      packageVersion: "1.6.0",
      candidateSha: CANDIDATE_SHA
    };
    writeFileSync(hermesSmokePath, `${JSON.stringify({
      ...base,
      schema: "lco.hermesSmoke.v1",
      actionsPerformed: { npmPublished: false }
    })}\n`);
    writeFileSync(packageSmokePath, `${JSON.stringify({
      ...base,
      schema: "lco.qaLab.cliMcpProductSmoke.v1",
      actionsPerformed: restrictedActions()
    })}\n`);

    const report = createHermesReadinessReport({
      evidenceDir: root,
      packageVersion: "1.6.0",
      candidateSha: CANDIDATE_SHA,
      hermesSmokePath,
      packageSmokePath
    });

    assert.equal(report.ok, false);
    assert.equal(report.blockers.includes("hermes_smoke_restricted_actions_performed"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function restrictedActions(): Record<string, boolean> {
  return {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false,
    screenshotsCaptured: false
  };
}
