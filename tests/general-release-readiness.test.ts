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

const packageJson = JSON.parse(read("package.json")) as { name: string; version: string };
const expectedDistTag = packageJson.version.includes("-rc.") ? "next" : packageJson.version.includes("-beta.") ? "beta" : "latest";
const expectedPackage = `${packageJson.name}@${expectedDistTag}`;
const expectedVersionMatchStatus = expectedDistTag === "beta"
  ? "matches_registry_beta"
  : expectedDistTag === "next"
    ? "matches_registry_next"
    : "matches_registry_latest";

function writePassingPublishedSmoke(path: string): void {
  writeJson(path, {
    ok: true,
    publishedSmokeReady: true,
    packagePathOk: true,
    publicSafe: true,
    localOnly: true,
    dryRun: true,
    expectedDistTag,
    expectedPackage,
    versionMatchStatus: expectedVersionMatchStatus,
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

function writeCredentialRequiredPublishedSmoke(path: string): void {
  writeJson(path, {
    ok: true,
    publishedSmokeReady: false,
    packagePathOk: true,
    publicSafe: true,
    localOnly: true,
    dryRun: true,
    expectedDistTag,
    expectedPackage,
    versionMatchStatus: expectedVersionMatchStatus,
    dogfood: {
      dogfoodReady: true,
      installOutcomeStatus: "installed",
      requiredToolsPresent: true
    },
    toolSmoke: {
      toolSmokeReady: false,
      gatewaySetupClassification: "gateway_setup_required",
      packageInstallLikelyOk: true
    },
    setupRequired: true,
    setupBlockers: ["fresh_profile_gateway_credentials_required"],
    setupRecovery: {
      classification: "credential_required",
      ready: false,
      packageInstallLikelyOk: true,
      retryAfterSetup: true,
      requiredSetup: ["gateway_credentials"],
      nextSafeCommands: [
        "OPENCLAW_GATEWAY_TOKEN='<scoped-token>' loo openclaw tool-smoke --profile lco-dogfood-published --required-tool loo_doctor --required-tool loo_search_sessions --strict"
      ],
      guidance: [
        "Provide a scoped local gateway token or complete profile credential setup, then rerun fresh-profile tool-smoke."
      ],
      readinessProof: {
        required: true,
        satisfied: false,
        command: "loo openclaw tool-smoke --profile lco-dogfood-published --required-tool loo_doctor --required-tool loo_search_sessions --strict",
        evidence: []
      }
    },
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
      missingRequiredTools: []
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

test("general release readiness rejects wrong dist-tag evidence for the candidate", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-general-release-wrong-dist-tag-"));
  const wrongDistTag = expectedDistTag === "beta" ? "next" : "beta";
  const wrongPackage = `${packageJson.name}@${wrongDistTag}`;
  const wrongVersionMatchStatus = wrongDistTag === "beta"
    ? "matches_registry_beta"
    : wrongDistTag === "next"
      ? "matches_registry_next"
      : "matches_registry_latest";
  writeJson(join(evidenceDir, "published-package-smoke.json"), {
    ok: true,
    publishedSmokeReady: true,
    packagePathOk: true,
    publicSafe: true,
    localOnly: true,
    dryRun: true,
    expectedDistTag: wrongDistTag,
    expectedPackage: wrongPackage,
    versionMatchStatus: wrongVersionMatchStatus,
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

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    blockers?: string[];
    checks?: Record<string, { ok: boolean; detail: string }>;
  };

  assert.deepEqual(payload.blockers, ["fresh_npm_clean_profile_wrong_dist_tag"]);
  assert.equal(payload.checks?.freshNpmCleanProfile?.ok, false);
  assert.match(payload.checks?.freshNpmCleanProfile?.detail ?? "", new RegExp(`requires ${expectedPackage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("general release readiness rejects legacy beta-sourced evidence even when status is mislabeled", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-general-release-legacy-beta-"));
  writeJson(join(evidenceDir, "published-package-smoke.json"), {
    ok: true,
    publishedSmokeReady: true,
    packagePathOk: true,
    publicSafe: true,
    localOnly: true,
    dryRun: true,
    expectedDistTag,
    expectedPackage,
    registryVersion: packageJson.version,
    registryBetaVersion: packageJson.version,
    versionMatchStatus: expectedVersionMatchStatus,
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

  if (expectedDistTag === "beta") {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return;
  }
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    blockers?: string[];
    checks?: Record<string, { ok: boolean; detail: string }>;
  };

  assert.deepEqual(payload.blockers, ["fresh_npm_clean_profile_wrong_dist_tag"]);
  assert.equal(payload.checks?.freshNpmCleanProfile?.ok, false);
  assert.match(payload.checks?.freshNpmCleanProfile?.detail ?? "", /legacy beta registry evidence/i);
});

test("general release readiness reports present fresh npm setup recovery instead of missing evidence", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-general-release-setup-required-"));
  writeCredentialRequiredPublishedSmoke(join(evidenceDir, "published-package-smoke.json"));
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

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    stableReady?: boolean;
    blockers?: string[];
    checks?: Record<string, { ok: boolean; detail: string; setupRecovery?: { classification?: string; requiredSetup?: string[] } }>;
  };

  assert.equal(payload.stableReady, false);
  assert.deepEqual(payload.blockers, [
    "fresh_npm_clean_profile_credential_required"
  ]);
  assert.equal(payload.checks?.freshNpmCleanProfile?.ok, false);
  assert.match(payload.checks?.freshNpmCleanProfile?.detail ?? "", /credential_required/);
  assert.equal(payload.checks?.freshNpmCleanProfile?.setupRecovery?.classification, "credential_required");
  assert.deepEqual(payload.checks?.freshNpmCleanProfile?.setupRecovery?.requiredSetup, ["gateway_credentials"]);
  assert.equal(payload.checks?.agentDogfood?.ok, true);
  assert.doesNotMatch(result.stdout, /fresh_npm_clean_profile_evidence_missing/);
  assert.doesNotMatch(result.stdout, /npm_[A-Za-z0-9]{20,}|Bearer\s+|state_\\d+\\.sqlite|raw transcript/i);
});

test("general release readiness does not echo setup recovery from unsafe fresh npm evidence", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-general-release-unsafe-"));
  const unsafeToken = `npm_${"a".repeat(24)}`;
  writeJson(join(evidenceDir, "published-package-smoke.json"), {
    ok: true,
    publishedSmokeReady: false,
    packagePathOk: true,
    publicSafe: false,
    expectedPackage: "lossless-openclaw-orchestrator@beta",
    versionMatchStatus: "matches_registry_beta",
    dogfood: {
      dogfoodReady: true,
      requiredToolsPresent: true
    },
    toolSmoke: {
      toolSmokeReady: false,
      gatewaySetupClassification: "gateway_setup_required",
      packageInstallLikelyOk: true
    },
    setupRecovery: {
      classification: "credential_required",
      ready: false,
      packageInstallLikelyOk: true,
      retryAfterSetup: true,
      requiredSetup: ["gateway_credentials"],
      nextSafeCommands: [`OPENCLAW_GATEWAY_TOKEN=${unsafeToken} loo openclaw tool-smoke --strict`],
      guidance: [`raw gateway token ${unsafeToken}`],
      readinessProof: {
        required: true,
        satisfied: false
      }
    },
    actionsPerformed: {
      npmPublished: false,
      githubReleaseCreated: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false
    }
  });
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

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    blockers?: string[];
    checks?: Record<string, { ok: boolean; detail: string; setupRecovery?: unknown }>;
  };

  assert.deepEqual(payload.blockers, [
    "fresh_npm_clean_profile_not_public_safe"
  ]);
  assert.equal(payload.checks?.freshNpmCleanProfile?.ok, false);
  assert.equal(payload.checks?.freshNpmCleanProfile?.setupRecovery, undefined);
  assert.doesNotMatch(result.stdout, new RegExp(unsafeToken));
  assert.doesNotMatch(readFileSync(join(evidenceDir, "general-release-readiness.json"), "utf8"), new RegExp(unsafeToken));
});

test("general release readiness does not echo setup recovery when restricted actions were performed", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-general-release-action-unsafe-"));
  writeCredentialRequiredPublishedSmoke(join(evidenceDir, "published-package-smoke.json"));
  const report = JSON.parse(readFileSync(join(evidenceDir, "published-package-smoke.json"), "utf8")) as Record<string, unknown>;
  report.actionsPerformed = {
    npmPublished: true,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false
  };
  writeJson(join(evidenceDir, "published-package-smoke.json"), report);
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

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    blockers?: string[];
    checks?: Record<string, { ok: boolean; setupRecovery?: unknown }>;
  };

  assert.deepEqual(payload.blockers, [
    "fresh_npm_clean_profile_restricted_actions_performed"
  ]);
  assert.equal(payload.checks?.freshNpmCleanProfile?.setupRecovery, undefined);
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
