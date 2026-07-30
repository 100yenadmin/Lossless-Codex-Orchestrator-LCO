#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CANONICAL_PACKAGE_NAME = "lossless-codex-orchestrator";
export const COMPATIBILITY_PACKAGE_NAME = "lossless-openclaw-orchestrator";

const SUPPORTED_PACKAGE_NAMES = new Set([
  CANONICAL_PACKAGE_NAME,
  COMPATIBILITY_PACKAGE_NAME,
]);

export function distTagForVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid package version: ${version}`);
  }
  if (!version.includes("-")) return "latest";
  if (/-beta(?:\.|$)/.test(version)) return "beta";
  if (/-rc(?:\.|$)/.test(version)) return "next";
  throw new Error(`Unsupported prerelease version: ${version}`);
}

export function assertReleaseIdentity({ version, releaseTag, publishTag }) {
  const expectedReleaseTag = `v${version}`;
  if (releaseTag !== expectedReleaseTag) {
    throw new Error(
      `Release tag mismatch: expected ${expectedReleaseTag}, received ${releaseTag}`,
    );
  }
  const expectedPublishTag = distTagForVersion(version);
  if (publishTag !== expectedPublishTag) {
    throw new Error(
      `Publish tag mismatch: expected ${expectedPublishTag}, received ${publishTag}`,
    );
  }
}

export async function prepareDualNpmRelease({
  sourceDir,
  outputDir,
  releaseTag,
}) {
  const sourceRoot = path.resolve(sourceDir);
  const outputRoot = path.resolve(outputDir);
  assertSafeOutputRoot(sourceRoot, outputRoot);

  const sourcePackage = JSON.parse(
    await readFile(path.join(sourceRoot, "package.json"), "utf8"),
  );
  if (!SUPPORTED_PACKAGE_NAMES.has(sourcePackage.name)) {
    throw new Error(`Unsupported source package identity: ${sourcePackage.name}`);
  }

  const version = sourcePackage.version;
  const publishTag = sourcePackage.publishConfig?.tag;
  assertReleaseIdentity({ version, releaseTag, publishTag });

  await rm(outputRoot, { recursive: true, force: true });
  const sourcePackRoot = path.join(outputRoot, "source-pack");
  const extractedRoot = path.join(outputRoot, "extracted");
  const stagingRoot = path.join(outputRoot, "staging");
  const artifactRoot = path.join(outputRoot, "artifacts");
  await Promise.all([
    mkdir(sourcePackRoot, { recursive: true }),
    mkdir(extractedRoot, { recursive: true }),
    mkdir(stagingRoot, { recursive: true }),
    mkdir(artifactRoot, { recursive: true }),
  ]);

  const sourcePack = runNpmPack(sourceRoot, sourcePackRoot);
  const sourceTarball = safeArtifactPath(sourcePackRoot, sourcePack.filename);
  run("tar", ["-xzf", sourceTarball, "-C", extractedRoot], sourceRoot);

  const extractedPackageRoot = path.join(extractedRoot, "package");
  const canonicalRoot = path.join(stagingRoot, "canonical");
  const compatibilityRoot = path.join(stagingRoot, "compatibility");
  await cp(extractedPackageRoot, canonicalRoot, { recursive: true });
  await cp(extractedPackageRoot, compatibilityRoot, { recursive: true });

  await writePackageIdentity(canonicalRoot, CANONICAL_PACKAGE_NAME);
  await writePackageIdentity(
    compatibilityRoot,
    COMPATIBILITY_PACKAGE_NAME,
  );

  const canonicalPayload = await payloadHashes(canonicalRoot);
  const compatibilityPayload = await payloadHashes(compatibilityRoot);
  if (JSON.stringify(canonicalPayload) !== JSON.stringify(compatibilityPayload)) {
    throw new Error("Package payload parity check failed");
  }

  await assertNormalizedPackageJsonParity(canonicalRoot, compatibilityRoot);

  const canonicalPack = runNpmPack(canonicalRoot, artifactRoot);
  const compatibilityPack = runNpmPack(compatibilityRoot, artifactRoot);
  const packages = [
    await packageManifestEntry(
      artifactRoot,
      CANONICAL_PACKAGE_NAME,
      canonicalPack,
    ),
    await packageManifestEntry(
      artifactRoot,
      COMPATIBILITY_PACKAGE_NAME,
      compatibilityPack,
    ),
  ];

  const manifest = {
    schema: "lco.npmDualPackage.v1",
    version,
    releaseTag,
    distTag: publishTag,
    payloadParity: true,
    packages,
    restrictedActionsPerformed: [],
    rawSecretIncluded: false,
  };
  await writeFile(
    path.join(outputRoot, "dual-package-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export async function verifyPreparedDualNpmRelease(outputDir) {
  const outputRoot = path.resolve(outputDir);
  const manifest = JSON.parse(
    await readFile(path.join(outputRoot, "dual-package-manifest.json"), "utf8"),
  );
  if (
    manifest.schema !== "lco.npmDualPackage.v1" ||
    manifest.payloadParity !== true ||
    manifest.rawSecretIncluded !== false ||
    !Array.isArray(manifest.restrictedActionsPerformed) ||
    manifest.restrictedActionsPerformed.length !== 0
  ) {
    throw new Error("Prepared release manifest failed its safety contract");
  }
  if (
    !Array.isArray(manifest.packages) ||
    manifest.packages.length !== 2 ||
    manifest.packages[0]?.name !== CANONICAL_PACKAGE_NAME ||
    manifest.packages[1]?.name !== COMPATIBILITY_PACKAGE_NAME
  ) {
    throw new Error("Prepared release manifest has unexpected package identities");
  }
  assertReleaseIdentity({
    version: manifest.version,
    releaseTag: manifest.releaseTag,
    publishTag: manifest.distTag,
  });
  for (const entry of manifest.packages) {
    if (
      typeof entry.file !== "string" ||
      !entry.file.startsWith("artifacts/") ||
      path.isAbsolute(entry.file) ||
      entry.file.includes("..")
    ) {
      throw new Error("Prepared release manifest has an unsafe artifact path");
    }
    const content = await readFile(path.join(outputRoot, entry.file));
    const sha256 = createHash("sha256").update(content).digest("hex");
    if (sha256 !== entry.sha256) {
      throw new Error(`Prepared artifact checksum mismatch for ${entry.name}`);
    }
  }
  return manifest;
}

function assertSafeOutputRoot(sourceRoot, outputRoot) {
  const parsed = path.parse(outputRoot);
  if (outputRoot === parsed.root || outputRoot === os.homedir()) {
    throw new Error("Output directory is too broad");
  }
  const relativeToSource = path.relative(sourceRoot, outputRoot);
  if (
    relativeToSource === "" ||
    (!relativeToSource.startsWith(`..${path.sep}`) &&
      relativeToSource !== ".." &&
      !path.isAbsolute(relativeToSource))
  ) {
    throw new Error("Output directory must be outside the source checkout");
  }
}

function runNpmPack(packageRoot, artifactRoot) {
  const result = run(
    "npm",
    [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      artifactRoot,
      packageRoot,
    ],
    packageRoot,
  );
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("npm pack did not return valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("npm pack returned an unexpected package count");
  }
  const entry = parsed[0];
  safeArtifactPath(artifactRoot, entry.filename);
  return entry;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result;
}

function safeArtifactPath(root, filename) {
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    path.basename(filename) !== filename
  ) {
    throw new Error("npm pack returned an unsafe artifact filename");
  }
  return path.join(root, filename);
}

async function writePackageIdentity(packageRoot, name) {
  const packagePath = path.join(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  packageJson.name = name;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function assertNormalizedPackageJsonParity(canonicalRoot, compatibilityRoot) {
  const [canonical, compatibility] = await Promise.all([
    readPackageJson(canonicalRoot),
    readPackageJson(compatibilityRoot),
  ]);
  delete canonical.name;
  delete compatibility.name;
  if (JSON.stringify(canonical) !== JSON.stringify(compatibility)) {
    throw new Error("Package manifests differ beyond the approved name field");
  }
}

async function readPackageJson(packageRoot) {
  return JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
}

async function payloadHashes(root) {
  const files = [];
  await collectFiles(root, root, files);
  return files
    .filter((entry) => entry.relativePath !== "package.json")
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function collectFiles(root, current, files) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      throw new Error("Symlinks are not allowed in staged npm package payloads");
    }
    if (metadata.isDirectory()) {
      await collectFiles(root, absolutePath, files);
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error("Unsupported npm package payload entry");
    }
    const content = await readFile(absolutePath);
    files.push({
      relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
}

async function packageManifestEntry(artifactRoot, name, packResult) {
  const artifactPath = safeArtifactPath(artifactRoot, packResult.filename);
  const content = await readFile(artifactPath);
  return {
    name,
    file: `artifacts/${packResult.filename}`,
    sha256: createHash("sha256").update(content).digest("hex"),
    shasum: packResult.shasum,
    integrity: packResult.integrity,
    fileCount: packResult.entryCount,
    unpackedSize: packResult.unpackedSize,
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error("Expected --source-dir, --output-dir, and --release-tag values");
    }
    values[flag.slice(2)] = value;
  }
  return {
    sourceDir: values["source-dir"] ?? process.cwd(),
    outputDir: values["output-dir"],
    releaseTag: values["release-tag"],
    verifyOutputDir: values["verify-output-dir"],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.verifyOutputDir) {
    const manifest = await verifyPreparedDualNpmRelease(
      options.verifyOutputDir,
    );
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
    return;
  }
  if (!options.outputDir || !options.releaseTag) {
    throw new Error("--output-dir and --release-tag are required");
  }
  const manifest = await prepareDualNpmRelease(options);
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
