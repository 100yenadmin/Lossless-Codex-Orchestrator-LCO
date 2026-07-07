import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const FORBIDDEN_PACKAGED_ARTIFACT = /\.(jsonl|sqlite|sqlite-wal|sqlite-shm|db|db-journal|log|png|jpe?g|gif|webp|mp4|mov|webm)$/i;

interface NpmPackFile {
  path: string;
}

interface NpmPackReport {
  files: NpmPackFile[];
}

function npmPackFileList(): string[] {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as NpmPackReport[];
  return report.flatMap((entry) => entry.files.map((file) => file.path)).sort();
}

test("npm package excludes raw-ish fixture, database, log, and media artifacts", () => {
  const files = npmPackFileList();
  const forbidden = files.filter((file) => FORBIDDEN_PACKAGED_ARTIFACT.test(file));

  assert.deepEqual(forbidden, []);
});

test("npm package keeps public eval scenario and scorecard examples without raw retrieval sessions", () => {
  const files = npmPackFileList();

  for (const required of [
    "evals/scenarios/v1/session-map-triage.json",
    "evals/scenarios/retrieval-goldens/v1/goldens.json",
    "evals/scorecards/v1.0/public-claim-review.json",
    "evals/scorecards/v1.0/issue-scorecard-update-template.md"
  ]) {
    assert.equal(files.includes(required), true, `${required} must remain packaged`);
  }

  assert.equal(files.some((file) => file.startsWith("evals/scenarios/retrieval-goldens/v1/sessions/")), false);
});
