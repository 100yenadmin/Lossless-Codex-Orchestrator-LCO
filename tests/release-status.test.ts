import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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
