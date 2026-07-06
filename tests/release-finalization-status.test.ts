import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
const candidateSha = "07efef16fb7806e1281001c4a7afe61890db5480";
const packageName = "lossless-openclaw-orchestrator";
const packageVersion = "0.1.0-beta.48";
const tagName = `v${packageVersion}`;

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeNpmEvidence(path: string, overrides: Record<string, unknown> = {}): void {
  writeJson(path, {
    kind: "loo_release_npm_publish_evidence",
    packageName,
    packageVersion,
    distTag: "beta",
    distTagVersion: packageVersion,
    latestVersion: "1.0.0",
    candidateSha,
    published: true,
    rawSecretIncluded: false,
    ...overrides
  });
}

function writeGitTagEvidence(path: string, overrides: Record<string, unknown> = {}): void {
  writeJson(path, {
    kind: "loo_release_git_tag_evidence",
    tagName,
    tagCommitSha: candidateSha,
    rawSecretIncluded: false,
    ...overrides
  });
}

function writeGitHubReleaseEvidence(path: string, overrides: Record<string, unknown> = {}): void {
  writeJson(path, {
    kind: "loo_release_github_release_evidence",
    tagName,
    releaseUrl: `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/releases/tag/${tagName}`,
    isPrerelease: true,
    targetCommitSha: candidateSha,
    rawSecretIncluded: false,
    ...overrides
  });
}

function runFinalizationStatus(args: string[]) {
  return spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "finalization-status",
    ...args
  ], { encoding: "utf8" });
}

function writeHappyEvidence(dir: string) {
  const npmEvidence = join(dir, "npm.json");
  const gitTagEvidence = join(dir, "git-tag.json");
  const githubReleaseEvidence = join(dir, "github-release.json");
  writeNpmEvidence(npmEvidence);
  writeGitTagEvidence(gitTagEvidence);
  writeGitHubReleaseEvidence(githubReleaseEvidence);
  return { npmEvidence, gitTagEvidence, githubReleaseEvidence };
}

test("release finalization-status fails closed while publish/tag/release evidence is missing", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-finalization-missing-"));
  const result = runFinalizationStatus([
    "--evidence-dir",
    evidenceDir,
    "--candidate-sha",
    candidateSha,
    "--package-version",
    packageVersion,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { finalized?: boolean; blockers?: string[]; actionsVerified?: Record<string, boolean> };
  assert.equal(payload.finalized, false);
  assert.deepEqual(payload.blockers, [
    "npm_publish_evidence_missing",
    "git_tag_evidence_missing",
    "github_release_evidence_missing"
  ]);
  assert.deepEqual(payload.actionsVerified, {
    npmPublished: false,
    gitTagPushed: false,
    githubReleaseCreated: false
  });
  assert.equal(existsSync(join(evidenceDir, "release-finalization-status.json")), true);
});

test("release finalization-status accepts matching npm beta, git tag, and GitHub prerelease evidence", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-finalization-pass-"));
  const { npmEvidence, gitTagEvidence, githubReleaseEvidence } = writeHappyEvidence(evidenceDir);
  const result = runFinalizationStatus([
    "--evidence-dir",
    evidenceDir,
    "--candidate-sha",
    candidateSha,
    "--package-name",
    packageName,
    "--package-version",
    packageVersion,
    "--expected-dist-tag",
    "beta",
    "--expected-github-prerelease",
    "true",
    "--npm-publish-evidence",
    npmEvidence,
    "--git-tag-evidence",
    gitTagEvidence,
    "--github-release-evidence",
    githubReleaseEvidence,
    "--strict"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    finalized?: boolean;
    blockers?: string[];
    packageVersion?: string;
    gitTag?: { tagName?: string; tagCommitSha?: string };
    githubRelease?: { isPrerelease?: boolean; releaseUrl?: string };
    actionsVerified?: Record<string, boolean>;
  };
  assert.equal(payload.finalized, true);
  assert.deepEqual(payload.blockers, []);
  assert.equal(payload.packageVersion, packageVersion);
  assert.equal(payload.gitTag?.tagName, tagName);
  assert.equal(payload.gitTag?.tagCommitSha, candidateSha);
  assert.equal(payload.githubRelease?.isPrerelease, true);
  assert.match(payload.githubRelease?.releaseUrl || "", /^https:\/\/github\.com\//);
  assert.deepEqual(payload.actionsVerified, {
    npmPublished: true,
    gitTagPushed: true,
    githubReleaseCreated: true
  });
});

test("release finalization-status rejects tag SHA mismatch", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-finalization-tag-"));
  const { npmEvidence, gitTagEvidence, githubReleaseEvidence } = writeHappyEvidence(evidenceDir);
  writeGitTagEvidence(gitTagEvidence, { tagCommitSha: "f".repeat(40) });
  const result = runFinalizationStatus([
    "--evidence-dir",
    evidenceDir,
    "--candidate-sha",
    candidateSha,
    "--package-version",
    packageVersion,
    "--npm-publish-evidence",
    npmEvidence,
    "--git-tag-evidence",
    gitTagEvidence,
    "--github-release-evidence",
    githubReleaseEvidence,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { blockers?: string[] };
  assert.ok(payload.blockers?.includes("git_tag_sha_mismatch"));
});

test("release finalization-status rejects beta dist-tag mismatch", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-finalization-disttag-"));
  const { npmEvidence, gitTagEvidence, githubReleaseEvidence } = writeHappyEvidence(evidenceDir);
  writeNpmEvidence(npmEvidence, { distTagVersion: "0.1.0-beta.47" });
  const result = runFinalizationStatus([
    "--evidence-dir",
    evidenceDir,
    "--candidate-sha",
    candidateSha,
    "--package-version",
    packageVersion,
    "--npm-publish-evidence",
    npmEvidence,
    "--git-tag-evidence",
    gitTagEvidence,
    "--github-release-evidence",
    githubReleaseEvidence,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { blockers?: string[] };
  assert.ok(payload.blockers?.includes("npm_dist_tag_version_mismatch"));
});

test("release finalization-status rejects npm candidate SHA mismatch", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-finalization-npm-sha-"));
  const { npmEvidence, gitTagEvidence, githubReleaseEvidence } = writeHappyEvidence(evidenceDir);
  writeNpmEvidence(npmEvidence, { candidateSha: "f".repeat(40) });
  const result = runFinalizationStatus([
    "--evidence-dir",
    evidenceDir,
    "--candidate-sha",
    candidateSha,
    "--package-version",
    packageVersion,
    "--npm-publish-evidence",
    npmEvidence,
    "--git-tag-evidence",
    gitTagEvidence,
    "--github-release-evidence",
    githubReleaseEvidence,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { blockers?: string[]; actionsVerified?: Record<string, boolean> };
  assert.ok(payload.blockers?.includes("npm_candidate_sha_mismatch"));
  assert.equal(payload.actionsVerified?.npmPublished, false);
});

test("release finalization-status rejects parsed falsy evidence files", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-finalization-falsy-"));
  const { npmEvidence, gitTagEvidence, githubReleaseEvidence } = writeHappyEvidence(evidenceDir);
  writeJson(npmEvidence, false);
  const result = runFinalizationStatus([
    "--evidence-dir",
    evidenceDir,
    "--candidate-sha",
    candidateSha,
    "--package-version",
    packageVersion,
    "--npm-publish-evidence",
    npmEvidence,
    "--git-tag-evidence",
    gitTagEvidence,
    "--github-release-evidence",
    githubReleaseEvidence,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { blockers?: string[]; actionsVerified?: Record<string, boolean> };
  assert.ok(payload.blockers?.includes("npm_evidence_invalid"));
  assert.equal(payload.actionsVerified?.npmPublished, false);
});

test("release finalization-status rejects non-prerelease beta GitHub Release evidence", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-finalization-prerelease-"));
  const { npmEvidence, gitTagEvidence, githubReleaseEvidence } = writeHappyEvidence(evidenceDir);
  writeGitHubReleaseEvidence(githubReleaseEvidence, { isPrerelease: false });
  const result = runFinalizationStatus([
    "--evidence-dir",
    evidenceDir,
    "--candidate-sha",
    candidateSha,
    "--package-version",
    packageVersion,
    "--npm-publish-evidence",
    npmEvidence,
    "--git-tag-evidence",
    gitTagEvidence,
    "--github-release-evidence",
    githubReleaseEvidence,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { blockers?: string[] };
  assert.ok(payload.blockers?.includes("github_release_prerelease_mismatch"));
});

test("release finalization-status rejects token-like evidence values", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-finalization-secret-"));
  const { npmEvidence, gitTagEvidence, githubReleaseEvidence } = writeHappyEvidence(evidenceDir);
  writeNpmEvidence(npmEvidence, { diagnostic: "npm_123456789012345678901234567890" });
  const result = runFinalizationStatus([
    "--evidence-dir",
    evidenceDir,
    "--candidate-sha",
    candidateSha,
    "--package-version",
    packageVersion,
    "--npm-publish-evidence",
    npmEvidence,
    "--git-tag-evidence",
    gitTagEvidence,
    "--github-release-evidence",
    githubReleaseEvidence,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { blockers?: string[] };
  assert.ok(payload.blockers?.includes("npm_evidence_contains_secret_like_value"));
});
