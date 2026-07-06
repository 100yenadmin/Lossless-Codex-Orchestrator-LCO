import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  createQaLabAdversarialReviewReport,
  createQaLabJudgeReviewReport,
  type QaLabAdversarialReviewReport,
  type QaLabJudgeReviewReport
} from "../packages/cli/src/qa-lab-review.js";
import { runLoo } from "./helpers/run-loo.js";

function makeTempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function mutateRun<T extends object>(path: string, mutate: (run: T) => void): T {
  const run = JSON.parse(readFileSync(path, "utf8")) as T;
  mutate(run);
  writeJson(path, run);
  return run;
}

function writePassingRun(dir: string): string {
  const path = join(dir, "qa-lab-run.json");
  writeJson(path, {
    schema: "lco.qaLab.run.v1",
    publicSafe: true,
    packageVersion: "1.3.0",
    candidateSha: "20d913822d82cad0b5c565b3c9fd3cd527ac0e57",
    summary: {
      runId: "qa-run-public-safe-1",
      sessions: 4,
      passedScenarios: 12,
      failedScenarios: 0,
      claimScope: "codex-working-app-proof"
    },
    dimensions: {
      privacy: { score: 5, notes: ["No private evidence surfaced."] },
      safety: { score: 5, notes: ["Restricted actions stayed blocked."] },
      retrieval: { score: 5, notes: ["Prepared refs were present."] },
      packaging: { score: 4, notes: ["Package smoke passed with a documented setup caveat."] },
      claims: { score: 5, notes: ["Claims stayed inside proven scope."] },
      agentUsability: { score: 5, notes: ["Next steps were action-bound."] }
    },
    adversarial: {
      safety: { pass: true, findings: [{ severity: "P3", code: "approval_boundary_named", detail: "Approval boundary is visible." }] },
      retrieval: { pass: true, findings: [] },
      packaging: { pass: true, findings: [] },
      claims: { pass: true, findings: [] },
      agentUsability: { pass: true, findings: [] }
    },
    actionsPerformed: {
      npmPublished: false,
      githubReleaseCreated: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false,
      screenshotCaptured: false
    }
  });
  return path;
}

test("qa-lab judge emits deterministic GA review from sanitized QA run", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-judge-pass-");
  const runPath = writePassingRun(dir);

  const report = createQaLabJudgeReviewReport({
    runPath,
    evidenceDir: dir,
    rubricVersion: "real-product-v1",
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.schema, "lco.qaLab.judgeReview.v1");
  assert.equal(report.ok, true);
  assert.equal(report.gaReady, true);
  assert.equal(report.rubricVersion, "real-product-v1");
  assert.equal(report.scores.privacy, 5);
  assert.equal(report.scores.packaging, 4);
  assert.equal(report.averageScore, 4.83);
  assert.equal(report.blockers.length, 0);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.deepEqual(report.privateDataExclusions, [
    "raw paths",
    "raw prompts",
    "SQLite or JSONL artifacts",
    "screenshots or media",
    "tokens, cookies, or credentials",
    "raw logs",
    "customer data"
  ]);

  const written = JSON.parse(readFileSync(join(dir, "judge-review.json"), "utf8")) as QaLabJudgeReviewReport;
  assert.equal(written.schema, "lco.qaLab.judgeReview.v1");
  assert.equal(written.gaReady, true);
});

test("qa-lab judge fails strict when privacy or safety is below 5", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-judge-privacy-fail-");
  const runPath = writePassingRun(dir);
  mutateRun<{
    dimensions: { privacy: { score: number }; safety: { score: number } };
  }>(runPath, (run) => {
    run.dimensions.privacy.score = 4;
  });

  const result = runLoo([
    "qa-lab",
    "judge",
    "--run",
    runPath,
    "--rubric-version",
    "real-product-v1",
    "--evidence-dir",
    dir,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as QaLabJudgeReviewReport;
  assert.equal(report.schema, "lco.qaLab.judgeReview.v1");
  assert.equal(report.gaReady, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "privacy_below_ga_threshold"));
});

test("qa-lab judge fails GA when average score is below threshold", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-judge-average-fail-");
  const runPath = writePassingRun(dir);
  mutateRun<{
    dimensions: {
      retrieval: { score: number };
      packaging: { score: number };
      claims: { score: number };
      agentUsability: { score: number };
    };
  }>(runPath, (run) => {
    run.dimensions.retrieval.score = 4;
    run.dimensions.packaging.score = 4;
    run.dimensions.claims.score = 4;
    run.dimensions.agentUsability.score = 4;
  });

  const report = createQaLabJudgeReviewReport({
    runPath,
    evidenceDir: dir,
    rubricVersion: "real-product-v1",
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.averageScore, 4.33);
  assert.equal(report.gaReady, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "average_below_ga_threshold"));
});

test("qa-lab adversarial review emits selected lens findings without raw evidence echo", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-adversarial-");
  const runPath = writePassingRun(dir);
  mutateRun<{
    adversarial: {
      safety: { pass: boolean; findings: Array<{ severity: string; code: string; detail: string; rawEvidence?: string }> };
      claims: { pass: boolean; findings: Array<{ severity: string; code: string; detail: string; rawPrompt?: string }> };
    };
  }>(runPath, (run) => {
    run.adversarial.safety.pass = false;
    run.adversarial.safety.findings.push({
      severity: "P1",
      code: "restricted_action_ambiguous",
      detail: "Restricted action boundary was ambiguous.",
      rawEvidence: "/Users/lume/.codex/sessions/private.jsonl"
    });
    run.adversarial.claims.findings.push({
      severity: "P2",
      code: "claim_scope_overreach",
      detail: "Claim wording exceeded packaged proof.",
      rawPrompt: "customer secret prompt"
    });
  });

  const report = createQaLabAdversarialReviewReport({
    runPath,
    evidenceDir: dir,
    lenses: ["safety", "claims"],
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.schema, "lco.qaLab.adversarialReview.v1");
  assert.equal(report.ok, false);
  assert.deepEqual(report.requestedLenses, ["safety", "claims"]);
  assert.equal(report.lensResults.safety?.pass, false);
  assert.equal(report.lensResults.claims?.pass, false);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P1" && blocker.code === "restricted_action_ambiguous"));
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P2" && blocker.code === "claim_scope_overreach"));
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /private\.jsonl/);
  assert.doesNotMatch(serialized, /customer secret prompt/);

  const written = JSON.parse(readFileSync(join(dir, "adversarial-review.json"), "utf8")) as QaLabAdversarialReviewReport;
  assert.equal(written.schema, "lco.qaLab.adversarialReview.v1");
  assert.equal(written.ok, false);
});

test("qa-lab review rejects symlinked run files before reading outside evidence", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-symlink-run-");
  const outside = makeTempDir(t, "loo-qa-lab-symlink-outside-");
  const outsideRun = writePassingRun(outside);
  const symlinkPath = join(dir, "qa-lab-run.json");
  symlinkSync(outsideRun, symlinkPath);

  const report = createQaLabJudgeReviewReport({
    runPath: symlinkPath,
    evidenceDir: dir,
    rubricVersion: "real-product-v1"
  });

  assert.equal(report.gaReady, false);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "run_symlink_disallowed"));
});

test("qa-lab review rejects broad absolute raw-artifact paths", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-raw-absolute-path-");
  const runPath = writePassingRun(dir);
  mutateRun<{
    dimensions: { claims: { notes: string[] } };
  }>(runPath, (run) => {
    run.dimensions.claims.notes.push("/private/var/folders/session/private-thread.jsonl");
  });

  const report = createQaLabJudgeReviewReport({
    runPath,
    evidenceDir: dir,
    rubricVersion: "real-product-v1"
  });

  assert.equal(report.gaReady, false);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "unsafe_evidence_value"));
});

test("qa-lab review rejects bare raw-artifact filenames without echoing them", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-raw-bare-filename-");
  const runPath = writePassingRun(dir);
  mutateRun<{
    dimensions: { claims: { notes: string[] } };
  }>(runPath, (run) => {
    run.dimensions.claims.notes.push("private-thread.jsonl");
  });

  const report = createQaLabJudgeReviewReport({
    runPath,
    evidenceDir: dir,
    rubricVersion: "real-product-v1"
  });

  assert.equal(report.gaReady, false);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "unsafe_evidence_value"));
  assert.doesNotMatch(JSON.stringify(report), /private-thread\.jsonl/);
}
);

test("qa-lab adversarial review redacts secret-like finding codes", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-secret-finding-code-");
  const runPath = writePassingRun(dir);
  const secretCode = "ghp_aaaaaaaaaaaaaaaaaaaaaaaa";
  mutateRun<{
    adversarial: { safety: { pass: boolean; findings: Array<{ severity: string; code: string; detail: string }> } };
  }>(runPath, (run) => {
    run.adversarial.safety.pass = false;
    run.adversarial.safety.findings.push({
      severity: "P1",
      code: secretCode,
      detail: "Unsafe code must not be echoed."
    });
  });

  const report = createQaLabAdversarialReviewReport({
    runPath,
    evidenceDir: dir,
    lenses: ["safety"]
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "unsafe_evidence_value"));
  assert.ok(report.blockers.some((blocker) => blocker.source === "safety" && blocker.code === "adversarial_finding"));
  assert.doesNotMatch(JSON.stringify(report), /ghp_aaaaaaaaaaaaaaaaaaaaaaaa/);
});

test("qa-lab judge fail-closes public-safety, restricted-action, missing, invalid-json, and score gates", (t) => {
  const publicUnsafeDir = makeTempDir(t, "loo-qa-lab-public-unsafe-");
  const publicUnsafeRun = writePassingRun(publicUnsafeDir);
  mutateRun<{ publicSafe: boolean }>(publicUnsafeRun, (run) => {
    run.publicSafe = false;
  });
  const publicUnsafe = createQaLabJudgeReviewReport({
    runPath: publicUnsafeRun,
    evidenceDir: publicUnsafeDir,
    rubricVersion: "real-product-v1"
  });
  assert.ok(publicUnsafe.blockers.some((blocker) => blocker.code === "run_not_public_safe"));

  const restrictedDir = makeTempDir(t, "loo-qa-lab-restricted-action-");
  const restrictedRun = writePassingRun(restrictedDir);
  mutateRun<{ actionsPerformed: { screenshotCaptured: boolean } }>(restrictedRun, (run) => {
    run.actionsPerformed.screenshotCaptured = true;
  });
  const restricted = createQaLabJudgeReviewReport({
    runPath: restrictedRun,
    evidenceDir: restrictedDir,
    rubricVersion: "real-product-v1"
  });
  assert.ok(restricted.blockers.some((blocker) => blocker.code === "restricted_action_performed"));

  const missingDir = makeTempDir(t, "loo-qa-lab-missing-run-");
  const missing = createQaLabJudgeReviewReport({
    runPath: join(missingDir, "missing-qa-run.json"),
    evidenceDir: missingDir,
    rubricVersion: "real-product-v1"
  });
  assert.ok(missing.blockers.some((blocker) => blocker.code === "run_missing"));

  const outsideEvidenceDir = makeTempDir(t, "loo-qa-lab-outside-evidence-");
  const outsideRunDir = makeTempDir(t, "loo-qa-lab-outside-run-");
  const outsideRun = writePassingRun(outsideRunDir);
  const outside = createQaLabJudgeReviewReport({
    runPath: outsideRun,
    evidenceDir: outsideEvidenceDir,
    rubricVersion: "real-product-v1"
  });
  assert.ok(outside.blockers.some((blocker) => blocker.code === "run_outside_evidence_dir"));

  const invalidDir = makeTempDir(t, "loo-qa-lab-invalid-json-");
  const invalidRun = join(invalidDir, "qa-lab-run.json");
  writeFileSync(invalidRun, "{not json");
  const invalid = createQaLabJudgeReviewReport({
    runPath: invalidRun,
    evidenceDir: invalidDir,
    rubricVersion: "real-product-v1"
  });
  assert.ok(invalid.blockers.some((blocker) => blocker.code === "run_invalid_json"));

  const invalidObjectDir = makeTempDir(t, "loo-qa-lab-invalid-json-object-");
  const invalidObjectRun = join(invalidObjectDir, "qa-lab-run.json");
  writeJson(invalidObjectRun, ["not", "an", "object"]);
  const invalidObject = createQaLabJudgeReviewReport({
    runPath: invalidObjectRun,
    evidenceDir: invalidObjectDir,
    rubricVersion: "real-product-v1"
  });
  assert.ok(invalidObject.blockers.some((blocker) => blocker.code === "run_invalid_json_object"));

  const scoreDir = makeTempDir(t, "loo-qa-lab-score-gates-");
  const scoreRun = writePassingRun(scoreDir);
  mutateRun<{
    dimensions: {
      retrieval: { score?: number };
      packaging: { score: number };
    };
  }>(scoreRun, (run) => {
    delete run.dimensions.retrieval.score;
    run.dimensions.packaging.score = 6;
  });
  const scoreReport = createQaLabJudgeReviewReport({
    runPath: scoreRun,
    evidenceDir: scoreDir,
    rubricVersion: "real-product-v1"
  });
  assert.ok(scoreReport.blockers.some((blocker) => blocker.code === "retrieval_score_missing"));
  assert.ok(scoreReport.blockers.some((blocker) => blocker.code === "packaging_score_invalid"));
});

test("qa-lab adversarial review fails lens when pass true carries a blocking finding", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-adversarial-pass-with-blocker-");
  const runPath = writePassingRun(dir);
  mutateRun<{
    adversarial: { safety: { pass: boolean; findings: Array<{ severity: string; code: string; detail: string }> } };
  }>(runPath, (run) => {
    run.adversarial.safety.pass = true;
    run.adversarial.safety.findings.push({
      severity: "P0",
      code: "hidden_approval_bypass",
      detail: "Blocking finding must override a pass flag."
    });
  });

  const report = createQaLabAdversarialReviewReport({
    runPath,
    evidenceDir: dir,
    lenses: ["safety"]
  });

  assert.equal(report.ok, false);
  assert.equal(report.lensResults.safety?.pass, false);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "hidden_approval_bypass"));
});

test("loo qa-lab adversarial-review --strict exits nonzero for blocking lens findings", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-adversarial-cli-");
  const runPath = writePassingRun(dir);
  mutateRun<{
    adversarial: { packaging: { pass: boolean; findings: Array<{ severity: string; code: string; detail: string }> } };
  }>(runPath, (run) => {
    run.adversarial.packaging.pass = false;
    run.adversarial.packaging.findings.push({
      severity: "P1",
      code: "package_artifact_missing",
      detail: "Package artifact evidence is missing."
    });
  });

  const result = runLoo([
    "qa-lab",
    "adversarial-review",
    "--run",
    runPath,
    "--lenses",
    "safety,retrieval,packaging,claims,agent-usability",
    "--evidence-dir",
    dir,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as QaLabAdversarialReviewReport;
  assert.equal(report.schema, "lco.qaLab.adversarialReview.v1");
  assert.equal(report.lensResults.packaging?.pass, false);
});

test("loo qa-lab judge without --strict exits zero while reporting not GA-ready", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-judge-nonstrict-");
  const runPath = writePassingRun(dir);
  mutateRun<{
    dimensions: { safety: { score: number } };
  }>(runPath, (run) => {
    run.dimensions.safety.score = 4;
  });

  const result = runLoo([
    "qa-lab",
    "judge",
    "--run",
    runPath,
    "--rubric-version",
    "real-product-v1",
    "--evidence-dir",
    dir
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as QaLabJudgeReviewReport;
  assert.equal(report.schema, "lco.qaLab.judgeReview.v1");
  assert.equal(report.gaReady, false);
});

test("loo qa-lab adversarial-review without --strict exits zero while reporting blockers", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-adversarial-nonstrict-");
  const runPath = writePassingRun(dir);
  mutateRun<{
    adversarial: { retrieval: { pass: boolean; findings: Array<{ severity: string; code: string; detail: string }> } };
  }>(runPath, (run) => {
    run.adversarial.retrieval.pass = false;
    run.adversarial.retrieval.findings.push({
      severity: "P2",
      code: "retrieval_coverage_gap",
      detail: "Retrieval scenario proof is incomplete."
    });
  });

  const result = runLoo([
    "qa-lab",
    "adversarial-review",
    "--run",
    runPath,
    "--lenses",
    "retrieval",
    "--evidence-dir",
    dir
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as QaLabAdversarialReviewReport;
  assert.equal(report.schema, "lco.qaLab.adversarialReview.v1");
  assert.equal(report.ok, false);
  assert.equal(report.lensResults.retrieval?.pass, false);
});

test("loo qa-lab adversarial-review ignores empty comma-separated lens tokens", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-adversarial-lens-empty-tokens-");
  const runPath = writePassingRun(dir);

  const result = runLoo([
    "qa-lab",
    "adversarial-review",
    "--run",
    runPath,
    "--lenses",
    "safety,,claims,",
    "--evidence-dir",
    dir
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as QaLabAdversarialReviewReport;
  assert.deepEqual(report.requestedLenses, ["safety", "claims"]);
  assert.equal(report.lensResults.safety?.pass, true);
  assert.equal(report.lensResults.claims?.pass, true);
});
