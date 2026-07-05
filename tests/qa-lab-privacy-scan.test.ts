import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { runLoo } from "./helpers/run-loo.js";

const packageVersion = "1.2.5";
const candidateSha = "20d913822d82cad0b5c565b3c9fd3cd527ac0e57";

type PrivacyScanReport = {
  schema: "lco.privacyScan.v1";
  ok: boolean;
  publicSafe: boolean;
  packageVersion: string;
  candidateSha: string;
  rawSessionArtifacts: Array<{ ref: string; reason: string }>;
  secretLikeEvidenceFindings: Array<{ ref: string; reason: string }>;
  blockers: Array<{ severity: string; code: string; source: string; detail: string }>;
  actionsPerformed: Record<string, boolean>;
  evidenceIndex: Array<{ ref: string; status: string; reasonCodes: string[] }>;
};

function makeTempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("loo qa-lab privacy-scan writes a public-safe clean evidence report", (t) => {
  const dir = makeTempDir(t, "loo-qa-privacy-clean-");
  writeJson(join(dir, "scenario-sweep.json"), {
    schema: "lco.scenarioSweep.v1",
    ok: true,
    publicSafe: true,
    blockers: [],
    actionsPerformed: { rawTranscriptRead: false, liveCodexControlRun: false }
  });

  const result = runLoo([
    "qa-lab",
    "privacy-scan",
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--now",
    "2026-07-05T09:30:00.000Z",
    "--strict"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as PrivacyScanReport;
  const persisted = JSON.parse(readFileSync(join(dir, "privacy-scan.json"), "utf8")) as PrivacyScanReport;

  assert.equal(report.schema, "lco.privacyScan.v1");
  assert.equal(report.ok, true);
  assert.equal(report.publicSafe, true);
  assert.equal(report.packageVersion, packageVersion);
  assert.equal(report.candidateSha, candidateSha);
  assert.deepEqual(report.rawSessionArtifacts, []);
  assert.deepEqual(report.secretLikeEvidenceFindings, []);
  assert.equal(persisted.ok, true);
  assert.equal(report.actionsPerformed.npmPublished, false);
  assert.equal(report.actionsPerformed.githubReleaseCreated, false);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
  assert.equal(report.actionsPerformed.rawTranscriptRead, false);
  assert.equal(report.actionsPerformed.screenshotsCaptured, false);
  assert.doesNotMatch(result.stdout, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(result.stderr.trim(), "");
});

test("loo qa-lab privacy-scan strict mode blocks raw artifacts and secret-like values without echoing them", (t) => {
  const dir = makeTempDir(t, "loo-qa-privacy-unsafe-");
  writeFileSync(join(dir, "private-session.jsonl"), "{\"private\":true}\n");
  writeJson(join(dir, "gateway-report.json"), {
    publicSafe: true,
    authorization: `bearer ${"a".repeat(32)}`,
    localPath: "/Users/lume/.codex/sessions/private-session.jsonl"
  });

  const result = runLoo([
    "qa-lab",
    "privacy-scan",
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as PrivacyScanReport;

  assert.equal(report.ok, false);
  assert.equal(report.publicSafe, false);
  assert.equal(report.rawSessionArtifacts.length, 1);
  assert.equal(report.secretLikeEvidenceFindings.length, 1);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "raw_session_artifact_found"));
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "secret_like_evidence_found"));
  assert.ok(report.evidenceIndex.some((entry) => entry.status === "unsafe" && entry.reasonCodes.includes("raw_codex_jsonl")));
  assert.ok(report.evidenceIndex.some((entry) => entry.status === "unsafe" && entry.reasonCodes.includes("secret_like_value")));
  assert.doesNotMatch(result.stdout, /private-session\.jsonl/);
  assert.doesNotMatch(result.stdout, /gateway-report\.json/);
  assert.doesNotMatch(result.stdout, /bearer a+/i);
  assert.doesNotMatch(result.stdout, /\/Users\/lume/);
  assert.doesNotMatch(result.stdout, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(existsSync(join(dir, "privacy-scan.json")), true);
  assert.equal(result.stderr.trim(), "");
});

test("loo qa-lab privacy-scan fails closed on bad candidate sha without leaking the supplied value", (t) => {
  const dir = makeTempDir(t, "loo-qa-privacy-bad-sha-");

  const result = runLoo([
    "qa-lab",
    "privacy-scan",
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    "/tmp/private-candidate.jsonl",
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as PrivacyScanReport;
  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "candidate_sha_invalid"));
  assert.doesNotMatch(result.stdout, /private-candidate\.jsonl/);
  assert.doesNotMatch(result.stdout, /\/tmp\//);
});
