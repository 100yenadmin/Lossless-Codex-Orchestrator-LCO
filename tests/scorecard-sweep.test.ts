import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createScorecardSweep } from "../packages/cli/src/scorecard-sweep.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

const expectedScorecards = [
  "local-agent-usability-review",
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
  assert.equal(report.scorecards.every((scorecard) => scorecard.evidencePath.startsWith(`${evidenceDir}/`)), true);
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

test("VISION and README document the scorecard sweep command", () => {
  assert.match(readFileSync("VISION.md", "utf8"), /loo scorecards sweep/);
  assert.match(readFileSync("README.md", "utf8"), /loo scorecards sweep/);
});
