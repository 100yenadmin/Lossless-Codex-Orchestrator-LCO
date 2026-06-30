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
  "local-mac-search-ui-review",
  "orchestrator-leverage-prioritization",
  "packaging-install-review",
  "public-claim-review",
  "retrieval-quality-review",
  "safety-bypass-review",
  "working-app-runtime-proof-review"
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

test("loo scorecards sweep --help exits zero with strict-mode and evidence guidance", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "scorecards",
    "sweep",
    "--help"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr, /Unknown scorecards sweep option|Error:/);
  assert.match(result.stdout, /loo scorecards sweep --evidence-dir path/);
  assert.match(result.stdout, /--evidence-dir is required/);
  assert.match(result.stdout, /--strict exits non-zero/i);
  assert.match(result.stdout, /scorecard_not_run/);
  assert.match(result.stdout, /does not run live Codex control/i);
  assert.match(result.stdout, /does not publish npm/i);
});

test("loo scorecards sweep unknown options still fail closed after help support", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "scorecards",
    "sweep",
    "--not-a-real-option"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Unknown scorecards sweep option: --not-a-real-option/);
  assert.equal(result.stdout, "");
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

test("scorecard sweep blocks raw artifacts in the evidence directory", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-scorecard-raw-"));
  const scorecardDir = mkdtempSync(join(tmpdir(), "loo-scorecard-clean-source-"));
  writeRequiredScorecards(scorecardDir);
  writeFileSync(join(evidenceDir, "session.jsonl"), "{}\n");
  writeFileSync(join(evidenceDir, "archive.jsonl.gz"), "");
  writeFileSync(join(evidenceDir, "private.sqlite"), "");
  writeFileSync(join(evidenceDir, "private.sqlite-wal"), "");

  const report = createScorecardSweep({ evidenceDir, scorecardDir });

  assert.equal(report.publicSafe, false);
  assert.equal(report.sweepReady, false);
  assert.match(report.blockers.join("\n"), /raw_artifact:raw_codex_jsonl:session\.jsonl/);
  assert.match(report.blockers.join("\n"), /raw_artifact:raw_codex_jsonl:archive\.jsonl\.gz/);
  assert.match(report.blockers.join("\n"), /raw_artifact:sqlite_database:private\.sqlite/);
  assert.match(report.blockers.join("\n"), /raw_artifact:sqlite_database:private\.sqlite-wal/);
});

test("scorecard sweep treats missing v1 fields and failing scores as blockers", () => {
  const missingFieldEvidenceDir = mkdtempSync(join(tmpdir(), "loo-scorecard-field-"));
  const missingFieldScorecardDir = mkdtempSync(join(tmpdir(), "loo-scorecard-field-source-"));
  writeRequiredScorecards(missingFieldScorecardDir);
  const missingField = minimalScoredScorecard();
  delete (missingField as { proof_boundary?: string }).proof_boundary;
  writeFileSync(join(missingFieldScorecardDir, "safety-bypass-review.json"), `${JSON.stringify(missingField, null, 2)}\n`);
  const missingFieldReport = createScorecardSweep({ evidenceDir: missingFieldEvidenceDir, scorecardDir: missingFieldScorecardDir });
  assert.equal(missingFieldReport.sweepReady, false);
  assert.match(missingFieldReport.blockers.join("\n"), /scorecard_missing_field:safety-bypass-review:proof_boundary/);

  const emptyFieldEvidenceDir = mkdtempSync(join(tmpdir(), "loo-scorecard-empty-field-"));
  const emptyFieldScorecardDir = mkdtempSync(join(tmpdir(), "loo-scorecard-empty-field-source-"));
  writeRequiredScorecards(emptyFieldScorecardDir);
  const emptyField = minimalScoredScorecard();
  emptyField.pass_criteria = [];
  emptyField.proof_boundary = "";
  writeFileSync(join(emptyFieldScorecardDir, "public-claim-review.json"), `${JSON.stringify(emptyField, null, 2)}\n`);
  const emptyFieldReport = createScorecardSweep({ evidenceDir: emptyFieldEvidenceDir, scorecardDir: emptyFieldScorecardDir });
  assert.equal(emptyFieldReport.sweepReady, false);
  assert.match(emptyFieldReport.blockers.join("\n"), /scorecard_missing_field:public-claim-review:pass_criteria/);
  assert.match(emptyFieldReport.blockers.join("\n"), /scorecard_missing_field:public-claim-review:proof_boundary/);

  const failedScoreEvidenceDir = mkdtempSync(join(tmpdir(), "loo-scorecard-failed-"));
  const failedScorecardDir = mkdtempSync(join(tmpdir(), "loo-scorecard-failed-source-"));
  writeRequiredScorecards(failedScorecardDir);
  writeFileSync(join(failedScorecardDir, "retrieval-quality-review.json"), `${JSON.stringify(minimalScorecard("failed"), null, 2)}\n`);
  const failedScoreReport = createScorecardSweep({ evidenceDir: failedScoreEvidenceDir, scorecardDir: failedScorecardDir });
  assert.equal(failedScoreReport.sweepReady, false);
  assert.match(failedScoreReport.blockers.join("\n"), /scorecard_failed:retrieval-quality-review:failed/);
});

test("scorecard sweep can pass for complete public-safe passing scorecards", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-scorecard-pass-"));
  const scorecardDir = mkdtempSync(join(tmpdir(), "loo-scorecard-pass-source-"));
  writeRequiredScorecards(scorecardDir);

  const report = createScorecardSweep({ evidenceDir, scorecardDir });

  assert.equal(report.publicSafe, true);
  assert.equal(report.sweepReady, true);
  assert.deepEqual(report.blockers, []);
});

test("VISION and README document the scorecard sweep command", () => {
  assert.match(readFileSync("VISION.md", "utf8"), /loo scorecards sweep/);
  assert.match(readFileSync("README.md", "utf8"), /loo scorecards sweep/);
  assert.match(readFileSync("README.md", "utf8"), /issue-<number>-scorecard-sweep/);
});

function minimalScoredScorecard() {
  return minimalScorecard("pass");
}

function minimalScorecard(currentScore: string) {
  return {
    scorecard_version: "1.0",
    claim_class: "advisory",
    scenario: "test scenario",
    surface: "test",
    command_or_tool: ["test command"],
    expected_public_safe_evidence: ["count"],
    private_data_exclusions: ["raw Codex transcripts"],
    pass_criteria: ["pass"],
    fail_criteria: ["fail"],
    current_score: currentScore,
    evidence_path: "/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/test/scorecard.json",
    known_gaps: ["none"],
    next_action: "none",
    proof_boundary: "local public-safe test fixture"
  };
}

function writeRequiredScorecards(scorecardDir: string): void {
  for (const name of expectedScorecards) {
    writeFileSync(join(scorecardDir, `${name}.json`), `${JSON.stringify(minimalScoredScorecard(), null, 2)}\n`);
  }
}
