import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("Trusted Publishing workflow is OIDC-only and fail-closed before dual publication", async () => {
  const [workflow, ciWorkflow] = await Promise.all([
    readFile(
      path.join(repoRoot, ".github", "workflows", "publish-npm.yml"),
      "utf8",
    ),
    readFile(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8"),
  ]);

  assert.match(workflow, /tags:\s*\n\s*-\s*["']v\*["']/);
  assert.match(workflow, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /environment:\s*npm-release/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /npm install --global npm@11\.17\.0/);
  assert.match(ciWorkflow, /npm install --global npm@11\.17\.0/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./);

  const validateJobIndex = workflow.indexOf("\n  validate:");
  const publishJobIndex = workflow.indexOf("\n  publish:");
  assert.notEqual(validateJobIndex, -1);
  assert.notEqual(publishJobIndex, -1);
  const validateJob = workflow.slice(validateJobIndex, publishJobIndex);
  const publishJob = workflow.slice(publishJobIndex);
  assert.doesNotMatch(validateJob, /id-token:\s*write/);
  assert.match(publishJob, /id-token:\s*write/);

  const checkIndex = workflow.indexOf("npm run check");
  const repositoryGateIndex = workflow.indexOf(
    "for workflow_name in CI CodeQL",
  );
  const prepareIndex = workflow.indexOf("prepare-dual-npm-release.mjs");
  const packageSmokeIndex = workflow.indexOf("qa-lab cli-mcp-smoke");
  const hermesSmokeIndex = workflow.indexOf("hermes smoke");
  const readinessIndex = workflow.indexOf("release hermes-readiness");
  const canonicalPublishIndex = workflow.indexOf(
    'npm publish "$release_root/$CANONICAL_TARBALL"',
  );
  const compatibilityPublishIndex = workflow.indexOf(
    'npm publish "$release_root/$COMPATIBILITY_TARBALL"',
  );
  const downloadIndex = publishJob.indexOf("Download the exact validated packages");
  const transferredChecksumIndex = publishJob.indexOf(
    "Verify artifact identity and checksums after transfer",
  );
  const publishIndex = publishJob.indexOf("Publish canonical then compatibility package");

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
  assert.ok(downloadIndex < transferredChecksumIndex);
  assert.ok(transferredChecksumIndex < publishIndex);
  assert.match(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.match(workflow, /--mode recoverable/);
  assert.match(workflow, /--mode published/);
});

test("dual-package preparation maps release tags and preserves package payload parity", async () => {
  const module = await import("../scripts/prepare-dual-npm-release.mjs");
  const packageJson = JSON.parse(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
  );
  const packageVersion = packageJson.version;
  const releaseTag = `v${packageVersion}`;
  const expectedDistTag = module.distTagForVersion(packageVersion);

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
      releaseTag,
    });

    assert.equal(manifest.schema, "lco.npmDualPackage.v1");
    assert.equal(manifest.version, packageVersion);
    assert.equal(manifest.distTag, expectedDistTag);
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
    assert.equal(verified.version, packageVersion);

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

test("release output safety and registry recovery fail closed", async () => {
  const releaseModule = await import("../scripts/prepare-dual-npm-release.mjs");
  const registryModule = await import("../scripts/check-npm-release-slots.mjs");

  assert.throws(
    () => releaseModule.assertSafeOutputRoot("/work/repo", "/work"),
    /must not contain/i,
  );
  assert.throws(
    () => releaseModule.assertSafeOutputRoot("/work/repo", "/work/repo/output"),
    /outside the source checkout/i,
  );
  assert.doesNotThrow(() =>
    releaseModule.assertSafeOutputRoot("/work/repo", "/release/output"),
  );

  const expected = {
    expectedVersion: "1.8.0",
    expectedIntegrity: "sha512-candidate",
  };
  assert.equal(
    registryModule.classifyRegistrySlot({
      mode: "recoverable",
      ...expected,
      registryEntry: { exists: false },
    }),
    "missing",
  );
  assert.equal(
    registryModule.classifyRegistrySlot({
      mode: "recoverable",
      ...expected,
      registryEntry: {
        exists: true,
        version: "1.8.0",
        integrity: "sha512-candidate",
        distTagVersion: "1.8.0",
      },
    }),
    "matching",
  );
  assert.throws(
    () =>
      registryModule.classifyRegistrySlot({
        mode: "recoverable",
        ...expected,
        registryEntry: {
          exists: true,
          version: "1.8.0",
          integrity: "sha512-other",
          distTagVersion: "1.8.0",
        },
      }),
    /does not match/i,
  );
  assert.throws(
    () =>
      registryModule.classifyRegistrySlot({
        mode: "unused",
        ...expected,
        registryEntry: {
          exists: true,
          version: "1.8.0",
          integrity: "sha512-candidate",
          distTagVersion: "1.8.0",
        },
      }),
    /already published/i,
  );
  assert.throws(
    () =>
      registryModule.classifyRegistrySlot({
        mode: "recoverable",
        ...expected,
        registryEntry: {
          exists: true,
          version: "1.8.0",
          integrity: "sha512-candidate",
          distTagVersion: "1.7.0",
        },
      }),
    /dist-tag does not match/i,
  );
  assert.throws(
    () =>
      registryModule.classifyRegistrySlot({
        mode: "published",
        ...expected,
        registryEntry: { exists: false },
      }),
    /not published/i,
  );
});
