import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writePassingPublishedSmoke(path: string): void {
  writeJson(path, {
    ok: true,
    publishedSmokeReady: true,
    packagePathOk: true,
    publicSafe: true,
    localOnly: true,
    dryRun: true,
    expectedPackage: "lossless-openclaw-orchestrator@beta",
    versionMatchStatus: "matches_registry_beta",
    dogfood: {
      dogfoodReady: true,
      installOutcomeStatus: "installed",
      requiredToolsPresent: true
    },
    toolSmoke: {
      toolSmokeReady: true,
      gatewaySetupClassification: "ready",
      packageInstallLikelyOk: true
    },
    setupRequired: false,
    blockers: [],
    actionsPerformed: {
      npmPublished: false,
      githubReleaseCreated: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false
    }
  });
}

function writePassingAgentDogfood(path: string): void {
  writeJson(path, {
    ok: true,
    toolSmokeReady: true,
    publicSafe: true,
    catalog: {
      requiredToolsPresent: true,
      missingRequiredTools: [],
      toolCount: 36
    },
    blockers: [],
    setupStatus: {
      classification: "ready",
      packageInstallLikelyOk: true
    },
    agentReasoning: {
      safeRecommendation: "Review source refs first.",
      selectedThreadId: "thread-1",
      sourceRefs: ["codex_thread:thread-1"],
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
      expansionProfile: "brief",
      expansionTokenBudget: 1000,
      dryRunApprovalAuditId: "loo_audit_test",
      dryRunLive: false,
      rawTranscriptRead: false
    },
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      npmPublished: false,
      githubReleaseCreated: false
    }
  });
}

test("general release readiness fails closed with exact blockers before M9 evidence", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-general-release-missing-"));
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "general-readiness",
    "--evidence-dir",
    evidenceDir,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    stableReady?: boolean;
    blockers?: string[];
    actionsPerformed?: Record<string, boolean>;
  };

  assert.equal(payload.stableReady, false);
  assert.deepEqual(payload.blockers, [
    "fresh_npm_clean_profile_evidence_missing",
    "agent_dogfood_evidence_missing"
  ]);
  assert.deepEqual(payload.actionsPerformed, {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false
  });
  assert.equal(existsSync(join(evidenceDir, "general-release-readiness.json")), true);
});

test("general release readiness passes with public-safe fresh npm and agent dogfood proof", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-general-release-ready-"));
  writePassingPublishedSmoke(join(evidenceDir, "published-package-smoke.json"));
  writePassingAgentDogfood(join(evidenceDir, "openclaw-tool-smoke.json"));

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "general-readiness",
    "--evidence-dir",
    evidenceDir,
    "--fresh-npm-evidence",
    "published-package-smoke.json",
    "--agent-dogfood-evidence",
    "openclaw-tool-smoke.json",
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    ok?: boolean;
    stableReady?: boolean;
    blockers?: string[];
    checks?: Record<string, { ok: boolean; detail: string }>;
    proofBoundary?: string;
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.stableReady, true);
  assert.deepEqual(payload.blockers, []);
  assert.equal(payload.checks?.releaseChecklist?.ok, true);
  assert.equal(payload.checks?.agentSkill?.ok, true);
  assert.equal(payload.checks?.freshNpmCleanProfile?.ok, true);
  assert.equal(payload.checks?.agentDogfood?.ok, true);
  assert.match(payload.proofBoundary ?? "", /does not publish 1\.0/i);
});

test("README, VISION, and release runbook point to the general release checklist", () => {
  assert.equal(existsSync("docs/RELEASE_CHECKLIST.md"), true);
  const checklist = read("docs/RELEASE_CHECKLIST.md");
  const readme = read("README.md");
  const vision = read("VISION.md");
  const runbook = read("docs/BETA_RELEASE_RUNBOOK.md");

  for (const [surface, content] of [
    ["release checklist", checklist],
    ["README", readme],
    ["VISION", vision],
    ["release runbook", runbook]
  ] as const) {
    assert.match(content, /loo release general-readiness/i, surface);
    assert.match(content, /fresh npm/i, surface);
    assert.match(content, /agent dogfood/i, surface);
    assert.match(content, /1\.0/i, surface);
  }

  assert.match(checklist, /Every Release/i);
  assert.match(checklist, /Claim Tiers/i);
  assert.match(checklist, /Do not move `latest`/i);
  assert.match(checklist, /resume.*steer.*interrupt/i);
});
