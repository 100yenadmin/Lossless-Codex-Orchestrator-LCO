import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function writePassingRun(dir: string): string {
  const path = join(dir, "qa-lab-run.json");
  writeJson(path, {
    schema: "lco.qaLab.run.v1",
    publicSafe: true,
    packageVersion: "1.2.5",
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
  const run = JSON.parse(readFileSync(runPath, "utf8")) as {
    dimensions: { privacy: { score: number }; safety: { score: number } };
  };
  run.dimensions.privacy.score = 4;
  writeJson(runPath, run);

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
  const run = JSON.parse(readFileSync(runPath, "utf8")) as {
    dimensions: {
      retrieval: { score: number };
      packaging: { score: number };
      claims: { score: number };
      agentUsability: { score: number };
    };
  };
  run.dimensions.retrieval.score = 4;
  run.dimensions.packaging.score = 4;
  run.dimensions.claims.score = 4;
  run.dimensions.agentUsability.score = 4;
  writeJson(runPath, run);

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
  const run = JSON.parse(readFileSync(runPath, "utf8")) as {
    adversarial: {
      safety: { pass: boolean; findings: Array<{ severity: string; code: string; detail: string; rawEvidence?: string }> };
      claims: { pass: boolean; findings: Array<{ severity: string; code: string; detail: string; rawPrompt?: string }> };
    };
  };
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
  writeJson(runPath, run);

  const report = createQaLabAdversarialReviewReport({
    runPath,
    evidenceDir: dir,
    lenses: ["safety", "claims"],
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.schema, "lco.qaLab.adversarialReview.v1");
  assert.equal(report.ok, false);
  assert.deepEqual(report.requestedLenses, ["safety", "claims"]);
  assert.equal(report.lensResults.safety.pass, false);
  assert.equal(report.lensResults.claims.pass, false);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P1" && blocker.code === "restricted_action_ambiguous"));
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P2" && blocker.code === "claim_scope_overreach"));
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /private\.jsonl/);
  assert.doesNotMatch(serialized, /customer secret prompt/);

  const written = JSON.parse(readFileSync(join(dir, "adversarial-review.json"), "utf8")) as QaLabAdversarialReviewReport;
  assert.equal(written.schema, "lco.qaLab.adversarialReview.v1");
  assert.equal(written.ok, false);
});

test("loo qa-lab adversarial-review --strict exits nonzero for blocking lens findings", (t) => {
  const dir = makeTempDir(t, "loo-qa-lab-adversarial-cli-");
  const runPath = writePassingRun(dir);
  const run = JSON.parse(readFileSync(runPath, "utf8")) as {
    adversarial: { packaging: { pass: boolean; findings: Array<{ severity: string; code: string; detail: string }> } };
  };
  run.adversarial.packaging.pass = false;
  run.adversarial.packaging.findings.push({
    severity: "P1",
    code: "package_artifact_missing",
    detail: "Package artifact evidence is missing."
  });
  writeJson(runPath, run);

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
  assert.equal(report.lensResults.packaging.pass, false);
});
