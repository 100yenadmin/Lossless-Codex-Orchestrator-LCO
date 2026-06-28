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
    "github_release_not_approved"
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
    "github_release_not_approved"
  ]);
});

test("release status --strict passes with safe approval proofs without performing gated actions", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-status-approved-"));
  const liveControlProof = join(evidenceDir, "approved-live-control-smoke.json");
  const npmApprovalProof = join(evidenceDir, "npm-publish-approval.json");
  const githubReleaseApprovalProof = join(evidenceDir, "github-release-approval.json");
  writeFileSync(liveControlProof, `${JSON.stringify({
    kind: "loo_approved_live_control_smoke",
    approvedLiveControlSmoke: true,
    action: "send",
    targetRef: "codex_thread:test-thread",
    approvalAuditId: "audit_test",
    messageHash: "sha256:test",
    preservesCodexApprovalSemantics: true,
    rawPromptIncluded: false
  }, null, 2)}\n`);
  writeFileSync(npmApprovalProof, `${JSON.stringify({
    kind: "loo_release_operation_approval",
    operation: "npm_publish",
    approved: true,
    approvalRef: "issue-14-user-approval",
    rawSecretIncluded: false
  }, null, 2)}\n`);
  writeFileSync(githubReleaseApprovalProof, `${JSON.stringify({
    kind: "loo_release_operation_approval",
    operation: "github_release",
    approved: true,
    approvalRef: "issue-14-user-approval",
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
    "--approved-live-control-evidence",
    liveControlProof,
    "--npm-publish-approval-evidence",
    npmApprovalProof,
    "--github-release-approval-evidence",
    githubReleaseApprovalProof,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    ok?: boolean;
    releaseReady?: boolean;
    blockers?: string[];
    explicitApprovalsRequired?: Array<{ id: string; satisfied: boolean }>;
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
  assert.deepEqual(payload.actionsPerformed, {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false
  });
});
