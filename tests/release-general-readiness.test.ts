import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
const candidateSha = "c".repeat(40);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function runGeneralReadiness(args: string[]) {
  return spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "general-readiness",
    ...args
  ], { encoding: "utf8" });
}

function writeAgentSkillEvidence(path: string): void {
  writeFileSync(path, `${JSON.stringify({
    issue: 232,
    publicSafe: true,
    npmPackDryRun: {
      skillIncluded: true
    },
    privateDataExcluded: ["raw transcripts", "tokens"]
  }, null, 2)}\n`);
}

function writeAgentDogfoodEvidence(path: string): void {
  writeFileSync(path, `${JSON.stringify({
    ok: true,
    toolSmokeReady: true,
    publicSafe: true,
    catalog: {
      requiredToolsPresent: true
    },
    agentReasoning: {
      workflowEvidence: [
        "doctor_ready",
        "search_source_ref",
        "describe_thread",
        "bounded_expand",
        "plan_lookup",
        "final_message_lookup",
        "touched_files_lookup",
        "dry_run_audit"
      ],
      dryRunLive: false,
      rawTranscriptRead: false
    },
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    blockers: []
  }, null, 2)}\n`);
}

function writeFreshNpmEvidence(path: string): void {
  writeFileSync(path, `${JSON.stringify({
    issue: 235,
    publicSafe: true,
    registryBetaVersion: "0.1.0-beta.28",
    distTags: {
      latest: "0.1.0-beta.4",
      beta: "0.1.0-beta.28"
    },
    initialSelectorDiagnostic: {
      trueUnpublishedVersion: false,
      rawSecretIncluded: false
    },
    binaryCheck: {
      publicSafe: true,
      installMethod: "registry_tarball_fallback",
      looExists: true,
      looMcpServerExists: true,
      rawStdoutStored: false,
      rawStderrStored: false
    },
    dogfood: {
      ok: true,
      dogfoodReady: true,
      requiredToolsPresent: true,
      blockers: []
    },
    publishedSmoke: {
      ok: true,
      packagePathOk: true,
      versionMatchStatus: "matches_registry_beta",
      blockers: []
    },
    onboardStatus: {
      ok: true,
      blockers: []
    }
  }, null, 2)}\n`);
}

function writeScorecardSweepEvidence(path: string): void {
  writeFileSync(path, `${JSON.stringify({
    ok: true,
    sweepReady: true,
    publicSafe: true,
    claimScope: "codex-read-search-expand-dry-run",
    scorecards: [
      "local-agent-usability-review",
      "packaging-install-review",
      "public-claim-review",
      "retrieval-quality-review",
      "safety-bypass-review"
    ].map((name) => ({
      name,
      currentScore: "pass",
      status: "scored",
      blockers: []
    })),
    blockers: [],
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      npmPublished: false,
      githubReleaseCreated: false
    }
  }, null, 2)}\n`);
}

function writeReleaseCheckProof(path: string, check: "github_ci" | "codeql", commitSha = candidateSha): void {
  writeFileSync(path, `${JSON.stringify({
    kind: "loo_release_check_evidence",
    check,
    commitSha,
    status: "completed",
    conclusion: "success",
    warnings: [],
    runUrl: `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/runs/${check}`,
    rawSecretIncluded: false
  }, null, 2)}\n`);
}

test("release general-readiness fails closed with exact missing M9 evidence blockers", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-general-readiness-missing-"));
  const result = runGeneralReadiness([
    "--evidence-dir",
    evidenceDir,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    ok?: boolean;
    generalReady?: boolean;
    statusManifestPath?: string;
    blockers?: string[];
    actionsPerformed?: Record<string, boolean>;
  };

  assert.equal(payload.ok, false);
  assert.equal(payload.generalReady, false);
  assert.equal(payload.statusManifestPath, join(evidenceDir, "general-readiness.json"));
  assert.deepEqual(payload.blockers, [
    "agent_skill_evidence_missing",
    "agent_dogfood_evidence_missing",
    "fresh_npm_evidence_missing",
    "scorecard_sweep_evidence_missing",
    "github_ci_evidence_missing",
    "codeql_evidence_missing"
  ]);
  assert.deepEqual(payload.actionsPerformed, {
    npmPublished: false,
    githubReleaseCreated: false,
    npmLatestPromoted: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false
  });
  assert.equal(existsSync(join(evidenceDir, "general-readiness.json")), true);
});

test("release general-readiness passes with M9 evidence, scorecards, docs, and CI proofs", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-general-readiness-ready-"));
  writeAgentSkillEvidence(join(evidenceDir, "agent-skill.json"));
  writeAgentDogfoodEvidence(join(evidenceDir, "agent-dogfood.json"));
  writeFreshNpmEvidence(join(evidenceDir, "fresh-npm.json"));
  writeScorecardSweepEvidence(join(evidenceDir, "scorecards.json"));
  writeReleaseCheckProof(join(evidenceDir, "github-ci.json"), "github_ci");
  writeReleaseCheckProof(join(evidenceDir, "codeql.json"), "codeql");

  const result = runGeneralReadiness([
    "--evidence-dir",
    evidenceDir,
    "--candidate-sha",
    candidateSha,
    "--agent-skill-evidence",
    "agent-skill.json",
    "--agent-dogfood-evidence",
    "agent-dogfood.json",
    "--fresh-npm-evidence",
    "fresh-npm.json",
    "--scorecard-sweep-evidence",
    "scorecards.json",
    "--github-ci-evidence",
    "github-ci.json",
    "--codeql-evidence",
    "codeql.json",
    "--strict"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    ok?: boolean;
    generalReady?: boolean;
    blockers?: string[];
    checks?: Array<{ id: string; satisfied: boolean }>;
    actionsPerformed?: Record<string, boolean>;
    proofBoundary?: string;
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.generalReady, true);
  assert.deepEqual(payload.blockers, []);
  assert.equal(payload.checks?.every((check) => check.satisfied), true);
  assert.deepEqual(payload.actionsPerformed, {
    npmPublished: false,
    githubReleaseCreated: false,
    npmLatestPromoted: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false
  });
  assert.match(String(payload.proofBoundary), /does not publish 1\.0/i);

  const manifest = JSON.parse(read(join(evidenceDir, "general-readiness.json"))) as {
    generalReady?: boolean;
    blockers?: string[];
  };
  assert.equal(manifest.generalReady, true);
  assert.deepEqual(manifest.blockers, []);
});
