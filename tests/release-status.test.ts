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

const candidateSha = "a".repeat(40);

function writeLiveControlProof(path: string): void {
  writeFileSync(path, `${JSON.stringify({
    kind: "loo_approved_live_control_smoke",
    approvedLiveControlSmoke: true,
    action: "send",
    targetRef: "codex_thread:test-thread",
    approvalAuditId: "audit_test",
    messageHash: "b".repeat(64),
    preservesCodexApprovalSemantics: true,
    rawPromptIncluded: false
  }, null, 2)}\n`);
}

function writeReleaseOperationApprovalProof(path: string, operation: "npm_publish" | "github_release" | "desktop_gui_mutation", extra: Record<string, string | boolean> = {}): void {
  writeFileSync(path, `${JSON.stringify({
    kind: "loo_release_operation_approval",
    operation,
    approved: true,
    approvalRef: "issue-14-user-approval",
    ...extra,
    rawSecretIncluded: false
  }, null, 2)}\n`);
}

function writeReleaseCheckProof(path: string, check: "github_ci" | "codeql", commitSha = candidateSha, warnings: string[] = []): void {
  writeFileSync(path, `${JSON.stringify({
    kind: "loo_release_check_evidence",
    check,
    commitSha,
    status: "completed",
    conclusion: "success",
    warnings,
    runUrl: `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/runs/${check}`,
    rawSecretIncluded: false
  }, null, 2)}\n`);
}

test("release status writes an approval packet without performing gated actions", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-status-"));
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--evidence-dir",
    evidenceDir
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    ok?: boolean;
    releaseReady?: boolean;
    statusManifestPath?: string;
    blockers?: string[];
    releasePreflight?: { blockers?: string[] };
    explicitApprovalsRequired?: Array<{ id: string; satisfied: boolean }>;
    actionsPerformed?: {
      npmPublished?: boolean;
      githubReleaseCreated?: boolean;
      liveCodexControlRun?: boolean;
      desktopGuiActionRun?: boolean;
    };
  };

  assert.equal(payload.ok, false);
  assert.equal(payload.releaseReady, false);
  assert.equal(payload.statusManifestPath, join(evidenceDir, "release-status.json"));
  assert.deepEqual(payload.releasePreflight?.blockers, ["approved_live_control_smoke_missing"]);
  assert.deepEqual(payload.blockers, [
    "approved_live_control_smoke_missing",
    "npm_publish_not_approved",
    "github_release_not_approved",
    "candidate_sha_missing",
    "github_ci_evidence_missing",
    "codeql_evidence_missing"
  ]);
  assert.deepEqual(payload.actionsPerformed, {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false
  });
  assert.deepEqual(payload.explicitApprovalsRequired, [
    { id: "approved_live_control_smoke", satisfied: false },
    { id: "npm_publish", satisfied: false },
    { id: "github_release", satisfied: false }
  ]);
  assert.equal(existsSync(join(evidenceDir, "release-status.json")), true);

  const manifest = JSON.parse(read(join(evidenceDir, "release-status.json"))) as {
    blockers?: string[];
    actionsPerformed?: { npmPublished?: boolean; githubReleaseCreated?: boolean };
  };
  assert.deepEqual(manifest.blockers, payload.blockers);
  assert.equal(manifest.actionsPerformed?.npmPublished, false);
  assert.equal(manifest.actionsPerformed?.githubReleaseCreated, false);
});

test("release status --strict fails closed while approvals are missing", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-status-strict-"));
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--evidence-dir",
    evidenceDir,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { releaseReady?: boolean; blockers?: string[] };
  assert.equal(payload.releaseReady, false);
  assert.deepEqual(payload.blockers, [
    "approved_live_control_smoke_missing",
    "npm_publish_not_approved",
    "github_release_not_approved",
    "candidate_sha_missing",
    "github_ci_evidence_missing",
    "codeql_evidence_missing"
  ]);
});

test("release status --strict fails closed while CI and CodeQL evidence are missing", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-status-approved-"));
  const liveControlProof = join(evidenceDir, "approved-live-control-smoke.json");
  const npmApprovalProof = join(evidenceDir, "npm-publish-approval.json");
  const githubReleaseApprovalProof = join(evidenceDir, "github-release-approval.json");
  writeLiveControlProof(liveControlProof);
  writeReleaseOperationApprovalProof(npmApprovalProof, "npm_publish");
  writeReleaseOperationApprovalProof(githubReleaseApprovalProof, "github_release");
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    liveControlProof,
    "--npm-publish-approval-evidence",
    npmApprovalProof,
    "--github-release-approval-evidence",
    githubReleaseApprovalProof,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    ok?: boolean;
    releaseReady?: boolean;
    blockers?: string[];
  };

  assert.equal(payload.ok, false);
  assert.equal(payload.releaseReady, false);
  assert.deepEqual(payload.blockers, ["github_ci_evidence_missing", "codeql_evidence_missing"]);
});

test("release status --strict passes with exact-sha CI and CodeQL proofs without requiring GUI mutation", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-status-ci-approved-"));
  writeLiveControlProof(join(evidenceDir, "approved-live-control-smoke.json"));
  writeReleaseOperationApprovalProof(join(evidenceDir, "npm-publish-approval.json"), "npm_publish");
  writeReleaseOperationApprovalProof(join(evidenceDir, "github-release-approval.json"), "github_release");
  writeReleaseCheckProof(join(evidenceDir, "github-ci.json"), "github_ci");
  writeReleaseCheckProof(join(evidenceDir, "codeql.json"), "codeql");

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    "approved-live-control-smoke.json",
    "--npm-publish-approval-evidence",
    "npm-publish-approval.json",
    "--github-release-approval-evidence",
    "github-release-approval.json",
    "--candidate-sha",
    candidateSha,
    "--github-ci-evidence",
    "github-ci.json",
    "--codeql-evidence",
    "codeql.json",
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    ok?: boolean;
    releaseReady?: boolean;
    blockers?: string[];
    explicitApprovalsRequired?: Array<{ id: string; satisfied: boolean }>;
    releaseChecks?: Array<{ id: string; satisfied: boolean }>;
    actionsPerformed?: {
      npmPublished?: boolean;
      githubReleaseCreated?: boolean;
      liveCodexControlRun?: boolean;
      desktopGuiActionRun?: boolean;
    };
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.releaseReady, true);
  assert.deepEqual(payload.blockers, []);
  assert.deepEqual(payload.explicitApprovalsRequired, [
    { id: "approved_live_control_smoke", satisfied: true },
    { id: "npm_publish", satisfied: true },
    { id: "github_release", satisfied: true }
  ]);
  assert.deepEqual(payload.releaseChecks, [
    { id: "candidate_sha", satisfied: true },
    { id: "github_ci", satisfied: true },
    { id: "codeql", satisfied: true }
  ]);
  assert.deepEqual(payload.actionsPerformed, {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false
  });
});

test("release status --claim-scope codex-read-search-expand-dry-run passes strict without live-control proof", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-status-read-scope-"));
  writeReleaseOperationApprovalProof(join(evidenceDir, "npm-publish-approval.json"), "npm_publish");
  writeReleaseOperationApprovalProof(join(evidenceDir, "github-release-approval.json"), "github_release");
  writeReleaseCheckProof(join(evidenceDir, "github-ci.json"), "github_ci");
  writeReleaseCheckProof(join(evidenceDir, "codeql.json"), "codeql");

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--evidence-dir",
    evidenceDir,
    "--claim-scope",
    "codex-read-search-expand-dry-run",
    "--npm-publish-approval-evidence",
    "npm-publish-approval.json",
    "--github-release-approval-evidence",
    "github-release-approval.json",
    "--candidate-sha",
    candidateSha,
    "--github-ci-evidence",
    "github-ci.json",
    "--codeql-evidence",
    "codeql.json",
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    claimScope?: string;
    releaseReady?: boolean;
    blockers?: string[];
    excludedClaims?: Array<{ id: string; blockerIfClaimed: string }>;
    explicitApprovalsRequired?: Array<{ id: string; satisfied: boolean }>;
    releasePreflight?: {
      claimScope?: string;
      blockers?: string[];
      excludedClaims?: Array<{ id: string; blockerIfClaimed: string }>;
      checks?: Record<string, { ok: boolean; detail: string }>;
    };
  };

  assert.equal(payload.claimScope, "codex-read-search-expand-dry-run");
  assert.equal(payload.releaseReady, true);
  assert.deepEqual(payload.blockers, []);
  assert.deepEqual(payload.explicitApprovalsRequired, [
    { id: "npm_publish", satisfied: true },
    { id: "github_release", satisfied: true }
  ]);
  assert.deepEqual(payload.excludedClaims, [
    { id: "approved_live_control_smoke", blockerIfClaimed: "approved_live_control_smoke_missing" }
  ]);
  assert.equal(payload.releasePreflight?.claimScope, "codex-read-search-expand-dry-run");
  assert.deepEqual(payload.releasePreflight?.blockers, []);
  assert.deepEqual(payload.releasePreflight?.excludedClaims, payload.excludedClaims);
  assert.equal(payload.releasePreflight?.checks?.liveControlSmoke?.ok, false);
  assert.match(payload.releasePreflight?.checks?.liveControlSmoke?.detail ?? "", /excluded by claim scope/i);
});

test("release status rejects unknown claim scopes", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-status-unknown-scope-"));
  writeReleaseOperationApprovalProof(join(evidenceDir, "npm-publish-approval.json"), "npm_publish");
  writeReleaseOperationApprovalProof(join(evidenceDir, "github-release-approval.json"), "github_release");
  writeReleaseCheckProof(join(evidenceDir, "github-ci.json"), "github_ci");
  writeReleaseCheckProof(join(evidenceDir, "codeql.json"), "codeql");
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--evidence-dir",
    evidenceDir,
    "--npm-publish-approval-evidence",
    "npm-publish-approval.json",
    "--github-release-approval-evidence",
    "github-release-approval.json",
    "--candidate-sha",
    candidateSha,
    "--github-ci-evidence",
    "github-ci.json",
    "--codeql-evidence",
    "codeql.json",
    "--claim-scope",
    "codex-everything-everywhere",
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Unknown release claim scope: codex-everything-everywhere/);
});

test("release status --strict requires GUI target details only when GUI mutation is planned", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-status-gui-required-"));
  const liveControlProof = join(evidenceDir, "approved-live-control-smoke.json");
  const npmApprovalProof = join(evidenceDir, "npm-publish-approval.json");
  const githubReleaseApprovalProof = join(evidenceDir, "github-release-approval.json");
  const githubCiProof = join(evidenceDir, "github-ci.json");
  const codeqlProof = join(evidenceDir, "codeql.json");
  const broadDesktopGuiApprovalProof = join(evidenceDir, "desktop-gui-approval-broad.json");
  const detailedDesktopGuiApprovalProof = join(evidenceDir, "desktop-gui-approval-detailed.json");
  const diagnosticFocusDesktopGuiApprovalProof = join(evidenceDir, "desktop-gui-approval-diagnostic-focus.json");
  const changedFocusDesktopGuiApprovalProof = join(evidenceDir, "desktop-gui-approval-focus-changed.json");
  const noFocusDesktopGuiApprovalProof = join(evidenceDir, "desktop-gui-approval-no-focus.json");
  writeLiveControlProof(liveControlProof);
  writeReleaseOperationApprovalProof(npmApprovalProof, "npm_publish");
  writeReleaseOperationApprovalProof(githubReleaseApprovalProof, "github_release");
  writeReleaseCheckProof(githubCiProof, "github_ci");
  writeReleaseCheckProof(codeqlProof, "codeql");
  writeReleaseOperationApprovalProof(broadDesktopGuiApprovalProof, "desktop_gui_mutation");
  writeReleaseOperationApprovalProof(detailedDesktopGuiApprovalProof, "desktop_gui_mutation", {
    desktopBackend: "cua-driver",
    targetApp: "Codex",
    targetWindow: "PR release smoke",
    action: "read-only visual smoke"
  });
  writeReleaseOperationApprovalProof(diagnosticFocusDesktopGuiApprovalProof, "desktop_gui_mutation", {
    desktopBackend: "cua-driver",
    targetApp: "Codex",
    targetWindow: "PR release smoke",
    action: "read-only visual smoke",
    actionHash: "b".repeat(64),
    focusBeforeApplication: "Codex",
    focusAfterApplication: "Codex",
    focusChanged: false,
    focusProof: "status_probe_only_no_action",
    rawScreenshotIncluded: false
  });
  writeReleaseOperationApprovalProof(changedFocusDesktopGuiApprovalProof, "desktop_gui_mutation", {
    desktopBackend: "cua-driver",
    targetApp: "Codex",
    targetWindow: "PR release smoke",
    action: "read-only visual smoke",
    actionHash: "c".repeat(64),
    focusBeforeApplication: "Codex",
    focusAfterApplication: "Safari",
    focusChanged: true,
    focusProof: "before_after_active_application",
    rawScreenshotIncluded: false
  });
  writeReleaseOperationApprovalProof(noFocusDesktopGuiApprovalProof, "desktop_gui_mutation", {
    desktopBackend: "cua-driver",
    targetApp: "Codex",
    targetWindow: "PR release smoke",
    action: "read-only visual smoke",
    actionHash: "d".repeat(64),
    focusBeforeApplication: "Codex",
    focusAfterApplication: "Codex",
    focusChanged: false,
    focusProof: "before_after_active_application",
    rawScreenshotIncluded: false
  });

  const commonArgs = [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    liveControlProof,
    "--npm-publish-approval-evidence",
    npmApprovalProof,
    "--github-release-approval-evidence",
    githubReleaseApprovalProof,
    "--candidate-sha",
    candidateSha,
    "--github-ci-evidence",
    githubCiProof,
    "--codeql-evidence",
    codeqlProof,
    "--desktop-gui-required",
    "--strict"
  ];
  const broadResult = spawnSync(process.execPath, [
    ...commonArgs,
    "--desktop-gui-approval-evidence",
    broadDesktopGuiApprovalProof
  ], { encoding: "utf8" });

  assert.equal(broadResult.status, 1, broadResult.stderr || broadResult.stdout);
  const broadPayload = JSON.parse(broadResult.stdout) as {
    blockers?: string[];
    explicitApprovalsRequired?: Array<{ id: string; satisfied: boolean }>;
  };
  assert.deepEqual(broadPayload.blockers, ["desktop_gui_mutation_not_approved"]);
  assert.deepEqual(broadPayload.explicitApprovalsRequired?.find((approval) => approval.id === "desktop_gui_mutation"), {
    id: "desktop_gui_mutation",
    satisfied: false
  });

  const detailedResult = spawnSync(process.execPath, [
    ...commonArgs,
    "--desktop-gui-approval-evidence",
    detailedDesktopGuiApprovalProof
  ], { encoding: "utf8" });

  assert.equal(detailedResult.status, 1, detailedResult.stderr || detailedResult.stdout);
  const detailedPayload = JSON.parse(detailedResult.stdout) as {
    blockers?: string[];
    explicitApprovalsRequired?: Array<{ id: string; satisfied: boolean }>;
  };
  assert.deepEqual(detailedPayload.blockers, ["desktop_gui_mutation_not_approved"]);
  assert.deepEqual(detailedPayload.explicitApprovalsRequired?.find((approval) => approval.id === "desktop_gui_mutation"), {
    id: "desktop_gui_mutation",
    satisfied: false
  });

  const diagnosticFocusResult = spawnSync(process.execPath, [
    ...commonArgs,
    "--desktop-gui-approval-evidence",
    diagnosticFocusDesktopGuiApprovalProof
  ], { encoding: "utf8" });

  assert.equal(diagnosticFocusResult.status, 1, diagnosticFocusResult.stderr || diagnosticFocusResult.stdout);
  const diagnosticFocusPayload = JSON.parse(diagnosticFocusResult.stdout) as {
    blockers?: string[];
    explicitApprovalsRequired?: Array<{ id: string; satisfied: boolean }>;
  };
  assert.deepEqual(diagnosticFocusPayload.blockers, ["desktop_gui_mutation_not_approved"]);
  assert.deepEqual(diagnosticFocusPayload.explicitApprovalsRequired?.find((approval) => approval.id === "desktop_gui_mutation"), {
    id: "desktop_gui_mutation",
    satisfied: false
  });

  const changedFocusResult = spawnSync(process.execPath, [
    ...commonArgs,
    "--desktop-gui-approval-evidence",
    changedFocusDesktopGuiApprovalProof
  ], { encoding: "utf8" });

  assert.equal(changedFocusResult.status, 1, changedFocusResult.stderr || changedFocusResult.stdout);
  const changedFocusPayload = JSON.parse(changedFocusResult.stdout) as {
    blockers?: string[];
    explicitApprovalsRequired?: Array<{ id: string; satisfied: boolean }>;
  };
  assert.deepEqual(changedFocusPayload.blockers, ["desktop_gui_mutation_not_approved"]);
  assert.deepEqual(changedFocusPayload.explicitApprovalsRequired?.find((approval) => approval.id === "desktop_gui_mutation"), {
    id: "desktop_gui_mutation",
    satisfied: false
  });

  const noFocusResult = spawnSync(process.execPath, [
    ...commonArgs,
    "--desktop-gui-approval-evidence",
    noFocusDesktopGuiApprovalProof
  ], { encoding: "utf8" });

  assert.equal(noFocusResult.status, 0, noFocusResult.stderr || noFocusResult.stdout);
  const noFocusPayload = JSON.parse(noFocusResult.stdout) as {
    blockers?: string[];
    explicitApprovalsRequired?: Array<{ id: string; satisfied: boolean }>;
  };
  assert.deepEqual(noFocusPayload.blockers, []);
  assert.deepEqual(noFocusPayload.explicitApprovalsRequired?.find((approval) => approval.id === "desktop_gui_mutation"), {
    id: "desktop_gui_mutation",
    satisfied: true
  });
});

test("release status rejects desktop GUI approval evidence unless GUI mutation is required", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-status-dangling-gui-"));
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--evidence-dir",
    evidenceDir,
    "--desktop-gui-approval-evidence",
    "desktop-gui-approval.json",
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /--desktop-gui-approval-evidence requires --desktop-gui-required/);
  assert.equal(result.stdout, "");
});

test("release status rejects CI or CodeQL evidence with warnings or SHA mismatch", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-status-warning-checks-"));
  writeLiveControlProof(join(evidenceDir, "approved-live-control-smoke.json"));
  writeReleaseOperationApprovalProof(join(evidenceDir, "npm-publish-approval.json"), "npm_publish");
  writeReleaseOperationApprovalProof(join(evidenceDir, "github-release-approval.json"), "github_release");
  writeReleaseCheckProof(join(evidenceDir, "github-ci.json"), "github_ci", "c".repeat(40));
  writeReleaseCheckProof(join(evidenceDir, "codeql.json"), "codeql", candidateSha, ["CodeQL Action v3 will be deprecated"]);

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    "approved-live-control-smoke.json",
    "--npm-publish-approval-evidence",
    "npm-publish-approval.json",
    "--github-release-approval-evidence",
    "github-release-approval.json",
    "--candidate-sha",
    candidateSha,
    "--github-ci-evidence",
    "github-ci.json",
    "--codeql-evidence",
    "codeql.json",
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { blockers?: string[] };
  assert.deepEqual(payload.blockers, ["github_ci_sha_mismatch", "codeql_warnings_present"]);
});

test("release status rejects approval evidence options when the next token is another flag", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-status-missing-value-"));
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--evidence-dir",
    evidenceDir,
    "--github-release-approval-evidence",
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /--github-release-approval-evidence requires a path/);
  assert.equal(result.stdout, "");
});

test("release status --help exits zero with proof-marker and restricted-action guidance", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--help"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr, /Unknown release status option|Error:/);
  assert.match(result.stdout, /loo release status --evidence-dir path --candidate-sha sha/);
  assert.match(result.stdout, /loo_release_check_evidence/);
  assert.match(result.stdout, /loo_release_operation_approval/);
  assert.match(result.stdout, /actionHash/);
  assert.match(result.stdout, /focusBeforeApplication/);
  assert.match(result.stdout, /focusAfterApplication/);
  assert.match(result.stdout, /focusChanged: false/);
  assert.match(result.stdout, /focusProof/);
  assert.match(result.stdout, /rawScreenshotIncluded: false/);
  assert.match(result.stdout, /does not publish npm/i);
  assert.match(result.stdout, /does not create a GitHub Release/i);
  assert.match(result.stdout, /does not run live Codex control/i);
  assert.match(result.stdout, /desktop GUI mutation/i);
});

test("release status unknown options still fail closed after help support", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--definitely-not-real"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Unknown release status option: --definitely-not-real/);
  assert.equal(result.stdout, "");
});

test("release status treats malformed approval proof shapes as unsatisfied without aborting", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-status-malformed-proof-"));
  const malformedNpmApprovalProof = join(evidenceDir, "npm-publish-approval.json");
  writeFileSync(malformedNpmApprovalProof, `${JSON.stringify({
    kind: "loo_release_operation_approval",
    operation: "npm_publish",
    approved: true,
    approvalRef: 123,
    rawSecretIncluded: false
  }, null, 2)}\n`);

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--evidence-dir",
    evidenceDir,
    "--npm-publish-approval-evidence",
    malformedNpmApprovalProof
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    blockers?: string[];
    explicitApprovalsRequired?: Array<{ id: string; satisfied: boolean }>;
    statusManifestPath?: string;
  };
  assert.deepEqual(payload.blockers, [
    "approved_live_control_smoke_missing",
    "npm_publish_not_approved",
    "github_release_not_approved",
    "candidate_sha_missing",
    "github_ci_evidence_missing",
    "codeql_evidence_missing"
  ]);
  assert.deepEqual(payload.explicitApprovalsRequired?.find((approval) => approval.id === "npm_publish"), {
    id: "npm_publish",
    satisfied: false
  });
  assert.equal(payload.statusManifestPath, join(evidenceDir, "release-status.json"));
  assert.equal(existsSync(join(evidenceDir, "release-status.json")), true);
});

test("release status treats null approval proof JSON as unsatisfied without aborting", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-status-null-proof-"));
  const nullNpmApprovalProof = join(evidenceDir, "npm-publish-approval.json");
  writeFileSync(nullNpmApprovalProof, "null\n");

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "status",
    "--evidence-dir",
    evidenceDir,
    "--npm-publish-approval-evidence",
    nullNpmApprovalProof
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    blockers?: string[];
    explicitApprovalsRequired?: Array<{ id: string; satisfied: boolean }>;
  };
  assert.deepEqual(payload.blockers, [
    "approved_live_control_smoke_missing",
    "npm_publish_not_approved",
    "github_release_not_approved",
    "candidate_sha_missing",
    "github_ci_evidence_missing",
    "codeql_evidence_missing"
  ]);
  assert.deepEqual(payload.explicitApprovalsRequired?.find((approval) => approval.id === "npm_publish"), {
    id: "npm_publish",
    satisfied: false
  });
  assert.equal(existsSync(join(evidenceDir, "release-status.json")), true);
});
