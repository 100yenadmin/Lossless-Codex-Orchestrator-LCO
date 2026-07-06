import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { createReleaseBundle } from "../packages/cli/src/release-bundle.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version as string;
const releaseNotesFile = `RELEASE_NOTES_${packageVersion}.md`;
const releaseNotesPath = `docs/releases/${releaseNotesFile}`;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("public beta release notes exist and preserve the proof boundary", () => {
  assert.equal(existsSync(releaseNotesPath), true, "release notes must exist before a GitHub Release");
  const notes = read(releaseNotesPath);

  assert.match(notes, new RegExp(packageVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(notes, /local Codex sessions/i);
  assert.match(notes, /approved_live_control_smoke_missing/);
  assert.match(notes, /Claude Code.*adapter stub/i);
  assert.match(notes, /No cloud sync/i);
  assert.match(notes, /No unattended desktop takeover/i);
  assert.match(notes, /No release-grade enterprise security/i);
  assert.doesNotMatch(notes, /Full Claude Code parity/i);
  assert.doesNotMatch(notes, /\/Volumes\/LEXAR|\/Users\/lume/i);
});

test("release bundle writes public-safe local artifacts without publishing", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-bundle-"));
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "bundle",
    "--evidence-dir",
    evidenceDir
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    ok?: boolean;
    publishReady?: boolean;
    npmPublished?: boolean;
    githubReleaseCreated?: boolean;
    releaseNotesPath?: string;
    bundleManifestPath?: string;
    blockers?: string[];
    rawSessionArtifacts?: unknown[];
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.publishReady, false);
  assert.equal(payload.npmPublished, false);
  assert.equal(payload.githubReleaseCreated, false);
  assert.deepEqual(payload.blockers, ["approved_live_control_smoke_missing"]);
  assert.deepEqual(payload.rawSessionArtifacts, []);
  assert.equal(payload.releaseNotesPath, releaseNotesFile);
  assert.equal(payload.bundleManifestPath, "release-bundle.json");
  assert.equal(existsSync(join(evidenceDir, releaseNotesFile)), true);
  assert.equal(existsSync(join(evidenceDir, "release-bundle.json")), true);

  const notes = read(join(evidenceDir, releaseNotesFile));
  assert.match(notes, /approved_live_control_smoke_missing/);
  assert.match(notes, /not publish to npm/i);
  assert.match(notes, /not create a GitHub Release/i);
  assert.doesNotMatch(notes, /Full Claude Code parity/i);

  const manifest = JSON.parse(read(join(evidenceDir, "release-bundle.json"))) as {
    releasePreflight?: { releaseReady?: boolean };
    artifacts?: { releaseNotes?: string; preflightManifest?: string };
  };
  assert.equal(manifest.releasePreflight?.releaseReady, false);
  assert.equal(manifest.artifacts?.releaseNotes, releaseNotesFile);
  assert.equal(manifest.artifacts?.preflightManifest, "release-preflight.json");
});

test("release bundle --strict fails closed while live-control approval is missing", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-bundle-strict-"));
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "bundle",
    "--evidence-dir",
    evidenceDir,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { blockers?: string[] };
  assert.deepEqual(payload.blockers, ["approved_live_control_smoke_missing"]);
});

test("release bundle --claim-scope codex-read-search-expand-dry-run passes strict without live-control proof", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-bundle-read-scope-"));
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "bundle",
    "--evidence-dir",
    evidenceDir,
    "--claim-scope",
    "codex-read-search-expand-dry-run",
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    claimScope?: string;
    publishReady?: boolean;
    blockers?: string[];
    excludedClaims?: Array<{ id: string; blockerIfClaimed: string }>;
    releasePreflight?: {
      claimScope?: string;
      excludedClaims?: Array<{ id: string; blockerIfClaimed: string }>;
    };
  };

  assert.equal(payload.claimScope, "codex-read-search-expand-dry-run");
  assert.equal(payload.publishReady, true);
  assert.deepEqual(payload.blockers, []);
  assert.deepEqual(payload.excludedClaims, [
    { id: "approved_live_control_smoke", blockerIfClaimed: "approved_live_control_smoke_missing" },
    { id: "codex_working_app_runtime_proof", blockerIfClaimed: "working_app_runtime_proof_missing" }
  ]);
  assert.equal(payload.releasePreflight?.claimScope, "codex-read-search-expand-dry-run");
  assert.deepEqual(payload.releasePreflight?.excludedClaims, payload.excludedClaims);
});

test("release bundle requires version-specific release notes", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "loo-release-bundle-root-"));
  mkdirSync(join(rootDir, "docs"), { recursive: true });
  writeFileSync(join(rootDir, "package.json"), JSON.stringify({
    name: "lossless-openclaw-orchestrator",
    version: "9.9.9-test.0",
    description: "Test package for local Codex sessions"
  }));

  assert.throws(
    () => createReleaseBundle({ evidenceDir: join(rootDir, "evidence"), rootDir }),
    /docs\/releases\/RELEASE_NOTES_9\.9\.9-test\.0\.md/
  );
});
