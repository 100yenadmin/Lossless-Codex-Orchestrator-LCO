import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("Trusted Publishing workflow is OIDC-only and fail-closed before dual publication", async () => {
  const workflow = await readFile(
    path.join(repoRoot, ".github", "workflows", "publish-npm.yml"),
    "utf8",
  );

  assert.match(workflow, /tags:\s*\n\s*-\s*["']v\*["']/);
  assert.match(workflow, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /environment:\s*npm-release/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /npm install --global npm@11\.17\.0/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./);

  const checkIndex = workflow.indexOf("npm run check");
  const repositoryGateIndex = workflow.indexOf(
    "for workflow_name in CI CodeQL",
  );
  const prepareIndex = workflow.indexOf("prepare-dual-npm-release.mjs");
  const packageSmokeIndex = workflow.indexOf("qa-lab cli-mcp-smoke");
  const hermesSmokeIndex = workflow.indexOf("hermes smoke");
  const readinessIndex = workflow.indexOf("release hermes-readiness");
  const canonicalPublishIndex = workflow.indexOf('npm publish "$canonical_tarball"');
  const compatibilityPublishIndex = workflow.indexOf('npm publish "$compatibility_tarball"');

  for (const [label, index] of [
    ["repo check", checkIndex],
    ["exact-sha CI and CodeQL checks", repositoryGateIndex],
    ["dual-package preparation", prepareIndex],
    ["package smoke", packageSmokeIndex],
    ["Hermes smoke", hermesSmokeIndex],
    ["Hermes readiness", readinessIndex],
    ["canonical publish", canonicalPublishIndex],
    ["compatibility publish", compatibilityPublishIndex],
  ] as const) {
    assert.notEqual(index, -1, `${label} must be present`);
  }

  assert.ok(checkIndex < canonicalPublishIndex);
  assert.ok(repositoryGateIndex < canonicalPublishIndex);
  assert.ok(prepareIndex < canonicalPublishIndex);
  assert.ok(packageSmokeIndex < canonicalPublishIndex);
  assert.ok(hermesSmokeIndex < canonicalPublishIndex);
  assert.ok(readinessIndex < canonicalPublishIndex);
  assert.ok(canonicalPublishIndex < compatibilityPublishIndex);
  assert.match(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.match(workflow, /npm view "\$package_name@\$package_version" version/);
});

test("dual-package preparation maps release tags and preserves package payload parity", async () => {
  const module = await import("../scripts/prepare-dual-npm-release.mjs");

  assert.equal(module.distTagForVersion("1.8.0"), "latest");
  assert.equal(module.distTagForVersion("1.8.0-beta.1"), "beta");
  assert.equal(module.distTagForVersion("1.8.0-rc.2"), "next");
  assert.throws(() => module.distTagForVersion("1.8.0-alpha.1"), /unsupported prerelease/i);
  assert.throws(
    () =>
      module.assertReleaseIdentity({
        version: "1.8.0",
        releaseTag: "v1.8.1",
        publishTag: "latest",
      }),
    /release tag mismatch/i,
  );

  const outputDir = await mkdtemp(path.join(os.tmpdir(), "lco-dual-npm-test-"));
  try {
    const manifest = await module.prepareDualNpmRelease({
      sourceDir: repoRoot,
      outputDir,
      releaseTag: "v1.7.0",
    });

    assert.equal(manifest.schema, "lco.npmDualPackage.v1");
    assert.equal(manifest.version, "1.7.0");
    assert.equal(manifest.distTag, "latest");
    assert.equal(manifest.payloadParity, true);
    assert.deepEqual(
      manifest.packages.map((entry: { name: string }) => entry.name),
      ["lossless-codex-orchestrator", "lossless-openclaw-orchestrator"],
    );
    for (const entry of manifest.packages) {
      assert.match(entry.sha256, /^[a-f0-9]{64}$/);
      assert.ok(entry.file.endsWith(".tgz"));
      assert.ok(entry.fileCount > 0);
    }
    const verified = await module.verifyPreparedDualNpmRelease(outputDir);
    assert.equal(verified.version, "1.7.0");

    await writeFile(
      path.join(outputDir, manifest.packages[0].file),
      "tampered artifact",
    );
    await assert.rejects(
      () => module.verifyPreparedDualNpmRelease(outputDir),
      /checksum mismatch/i,
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
