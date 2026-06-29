import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createScorecardSweep } from "../packages/cli/src/scorecard-sweep.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

const expectedScorecards = [
  "local-agent-usability-review",
  "orchestrator-leverage-prioritization",
  "packaging-install-review",
  "public-claim-review",
  "retrieval-quality-review",
  "safety-bypass-review"
];

test("scorecard sweep writes a public-safe fail-closed aggregate packet", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-scorecard-sweep-"));
  const report = createScorecardSweep({
    evidenceDir,
    now: "2026-06-29T10:05:00.000Z"
  });

  assert.equal(report.publicSafe, true);
  assert.equal(report.scorecardVersion, "1.0");
  assert.equal(report.sweepReady, false);
  assert.equal(report.generatedAt, "2026-06-29T10:05:00.000Z");
  assert.deepEqual(report.actionsPerformed, {
    liveCodexControlRun: false,
    desktopGuiActionRun: false,
    npmPublished: false,
    githubReleaseCreated: false
  });
  assert.deepEqual(report.scorecards.map((scorecard) => scorecard.name).sort(), expectedScorecards);
  assert.equal(report.scorecards.every((scorecard) => scorecard.status === "pending_evidence"), true);
  assert.equal(report.scorecards.every((scorecard) => dirname(scorecard.evidencePath) === evidenceDir), true);
  assert.equal(report.blockers.length, expectedScorecards.length);
  assert.match(report.blockers.join("\n"), /scorecard_not_run:safety-bypass-review/);
  assert.equal(existsSync(join(evidenceDir, "scorecard-sweep.json")), true);

  const saved = JSON.parse(readFileSync(join(evidenceDir, "scorecard-sweep.json"), "utf8")) as typeof report;
  assert.equal(saved.publicSafe, true);
  assert.equal(saved.scorecards.length, expectedScorecards.length);
  assert.doesNotMatch(JSON.stringify(saved), /raw prompt text value|BEGIN PRIVATE|SECRET_/);
});

test("loo scorecards sweep strict mode exits non-zero until scorecards have evidence", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-scorecard-sweep-cli-"));
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "scorecards",
    "sweep",
    "--evidence-dir",
    evidenceDir,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(join(evidenceDir, "scorecard-sweep.json"), "utf8")) as {
    sweepReady?: boolean;
    blockers?: string[];
    scorecards?: unknown[];
  };
  assert.equal(report.sweepReady, false);
  assert.equal(report.scorecards?.length, expectedScorecards.length);
  assert.match((report.blockers ?? []).join("\n"), /scorecard_not_run/);
});

test("scorecard sweep rejects evidence directory that would overwrite source scorecards", () => {
  const scorecardDir = mkdtempSync(join(tmpdir(), "loo-scorecard-source-"));

  assert.throws(
    () => createScorecardSweep({ evidenceDir: scorecardDir, scorecardDir }),
    /--evidence-dir must be different from --scorecard-dir/
  );
});

test("scorecard sweep fails closed when required scorecards are missing", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-scorecard-missing-"));
  const scorecardDir = mkdtempSync(join(tmpdir(), "loo-scorecard-partial-"));
  writeFileSync(join(scorecardDir, "safety-bypass-review.json"), `${JSON.stringify(minimalScoredScorecard(), null, 2)}\n`);

  const report = createScorecardSweep({ evidenceDir, scorecardDir });

  assert.equal(report.sweepReady, false);
  assert.match(report.blockers.join("\n"), /scorecard_missing:retrieval-quality-review/);
  assert.match(report.blockers.join("\n"), /scorecard_missing:orchestrator-leverage-prioritization/);
});

test("scorecard sweep writes evidence files for missing directories and invalid JSON", () => {
  const missingEvidenceDir = mkdtempSync(join(tmpdir(), "loo-scorecard-missing-dir-"));
  const missingReport = createScorecardSweep({
    evidenceDir: missingEvidenceDir,
    scorecardDir: join(missingEvidenceDir, "does-not-exist")
  });
  assert.equal(existsSync(join(missingEvidenceDir, "scorecard-directory.json")), true);
  assert.match(missingReport.blockers.join("\n"), /scorecard_directory_missing/);

  const invalidEvidenceDir = mkdtempSync(join(tmpdir(), "loo-scorecard-invalid-"));
  const invalidScorecardDir = mkdtempSync(join(tmpdir(), "loo-scorecard-invalid-source-"));
  writeFileSync(join(invalidScorecardDir, "broken.json"), "{not json");
  const invalidReport = createScorecardSweep({ evidenceDir: invalidEvidenceDir, scorecardDir: invalidScorecardDir });
  assert.equal(existsSync(join(invalidEvidenceDir, "broken.json")), true);
  assert.match(invalidReport.blockers.join("\n"), /scorecard_invalid_json:broken/);
});

test("VISION and README document the scorecard sweep command", () => {
  assert.match(readFileSync("VISION.md", "utf8"), /loo scorecards sweep/);
  assert.match(readFileSync("README.md", "utf8"), /loo scorecards sweep/);
  assert.match(readFileSync("README.md", "utf8"), /issue-<number>-scorecard-sweep/);
});

function minimalScoredScorecard() {
  return {
    scorecard_version: "1.0",
    claim_class: "advisory",
    surface: "test",
    current_score: "scored",
    expected_public_safe_evidence: ["count"],
    private_data_exclusions: ["raw Codex transcripts"],
    known_gaps: ["none"],
    next_action: "none",
    proof_boundary: "local public-safe test fixture"
  };
}
