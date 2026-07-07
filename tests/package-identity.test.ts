import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CANONICAL_PACKAGE_NAME,
  LEGACY_PACKAGE_NAME,
  findSupportedPackageRoot,
  isSupportedPackageName,
  packageNameForRoot,
  readPackageVersionFromRoots
} from "../packages/cli/src/package-identity.js";

function writePackage(root: string, name: string, version: string): void {
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name, version }, null, 2)}\n`);
}

test("package identity accepts canonical and legacy package names only", () => {
  assert.equal(isSupportedPackageName(CANONICAL_PACKAGE_NAME), true);
  assert.equal(isSupportedPackageName(LEGACY_PACKAGE_NAME), true);
  assert.equal(isSupportedPackageName("some-other-package"), false);
  assert.equal(isSupportedPackageName(null), false);
});

test("package root discovery resolves canonical package roots before legacy cwd fallbacks", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-package-identity-"));
  try {
    const canonicalRoot = join(root, "canonical");
    const canonicalStart = join(canonicalRoot, "dist", "packages", "cli", "src");
    const legacyRoot = join(root, "legacy");
    const legacyStart = join(legacyRoot, "packages", "cli", "src");
    mkdirSync(canonicalStart, { recursive: true });
    mkdirSync(legacyStart, { recursive: true });
    writePackage(canonicalRoot, CANONICAL_PACKAGE_NAME, "1.4.1-test.0");
    writePackage(legacyRoot, LEGACY_PACKAGE_NAME, "0.0.0-old");

    assert.equal(findSupportedPackageRoot(canonicalStart), canonicalRoot);
    assert.equal(packageNameForRoot(canonicalRoot), CANONICAL_PACKAGE_NAME);
    assert.equal(readPackageVersionFromRoots([canonicalStart, legacyStart]), "1.4.1-test.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("package root discovery still supports legacy package installs", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-package-identity-legacy-"));
  try {
    const legacyStart = join(root, "dist", "packages", "cli", "src");
    mkdirSync(legacyStart, { recursive: true });
    writePackage(root, LEGACY_PACKAGE_NAME, "1.4.1-legacy.0");

    assert.equal(findSupportedPackageRoot(legacyStart), root);
    assert.equal(packageNameForRoot(root), LEGACY_PACKAGE_NAME);
    assert.equal(readPackageVersionFromRoots([legacyStart]), "1.4.1-legacy.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("package version lookup ignores unsupported package roots instead of reporting false versions", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-package-identity-unsupported-"));
  try {
    const unsupportedStart = join(root, "dist", "packages", "cli", "src");
    mkdirSync(unsupportedStart, { recursive: true });
    writePackage(root, "not-lco", "9.9.9");

    assert.equal(findSupportedPackageRoot(unsupportedStart), null);
    assert.equal(readPackageVersionFromRoots([unsupportedStart]), "unknown");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
