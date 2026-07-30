#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SUPPORTED_MODES = new Set(["unused", "recoverable", "published"]);

export function classifyRegistrySlot({
  mode,
  expectedVersion,
  expectedIntegrity,
  registryEntry,
}) {
  if (!SUPPORTED_MODES.has(mode)) {
    throw new Error(`Unsupported registry-slot mode: ${mode}`);
  }
  if (!registryEntry.exists) {
    if (mode === "published") {
      throw new Error("Registry slot is not published");
    }
    return "missing";
  }
  if (mode === "unused") {
    throw new Error("Registry slot is already published");
  }
  if (
    registryEntry.version !== expectedVersion ||
    registryEntry.integrity !== expectedIntegrity
  ) {
    throw new Error("Published registry artifact does not match the candidate");
  }
  if (registryEntry.distTagVersion !== expectedVersion) {
    throw new Error("Published registry dist-tag does not match the candidate");
  }
  return "matching";
}

export async function checkNpmReleaseSlots({
  manifest,
  mode,
  lookup = lookupRegistryEntry,
}) {
  assertManifest(manifest);
  const packages = [];
  for (const entry of manifest.packages) {
    const registryEntry = await lookup(
      entry.name,
      manifest.version,
      manifest.distTag,
    );
    const state = classifyRegistrySlot({
      mode,
      expectedVersion: manifest.version,
      expectedIntegrity: entry.integrity,
      registryEntry,
    });
    packages.push({ name: entry.name, state });
  }
  return {
    schema: "lco.npmRegistrySlots.v1",
    version: manifest.version,
    mode,
    packages,
  };
}

function assertManifest(manifest) {
  if (
    manifest?.schema !== "lco.npmDualPackage.v1" ||
    typeof manifest.version !== "string" ||
    typeof manifest.distTag !== "string" ||
    manifest.distTag.length === 0 ||
    !Array.isArray(manifest.packages) ||
    manifest.packages.length !== 2
  ) {
    throw new Error("Prepared release manifest is invalid");
  }
  for (const entry of manifest.packages) {
    if (
      typeof entry?.name !== "string" ||
      entry.name.length === 0 ||
      typeof entry.integrity !== "string" ||
      !entry.integrity.startsWith("sha512-")
    ) {
      throw new Error("Prepared release manifest package entry is invalid");
    }
  }
}

function lookupRegistryEntry(packageName, version, distTag) {
  const result = spawnSync(
    "npm",
    [
      "view",
      `${packageName}@${version}`,
      "version",
      "dist.integrity",
      "--json",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status === 0) {
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error(`Registry returned malformed metadata for ${packageName}`);
    }
    return {
      exists: true,
      version: parsed.version,
      integrity: parsed["dist.integrity"],
      distTagVersion: readDistTagVersion(packageName, distTag),
    };
  }
  const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/\bE404\b|404 Not Found/i.test(diagnostic)) {
    return { exists: false };
  }
  throw new Error(`Registry lookup failed for ${packageName}`);
}

function readDistTagVersion(packageName, distTag) {
  const result = spawnSync(
    "npm",
    ["view", `${packageName}@${distTag}`, "version", "--json"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    throw new Error(`Registry dist-tag lookup failed for ${packageName}`);
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (typeof parsed !== "string" || parsed.length === 0) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw new Error(`Registry returned malformed dist-tag metadata for ${packageName}`);
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error("Expected --manifest, --mode, and --output values");
    }
    values[flag.slice(2)] = value;
  }
  return {
    manifestPath: values.manifest,
    mode: values.mode,
    outputPath: values.output,
  };
}

async function main() {
  const { manifestPath, mode, outputPath } = parseArgs(process.argv.slice(2));
  if (!manifestPath || !mode || !outputPath) {
    throw new Error("--manifest, --mode, and --output are required");
  }
  const manifest = JSON.parse(await readFile(path.resolve(manifestPath), "utf8"));
  const result = await checkNpmReleaseSlots({ manifest, mode });
  await writeFile(
    path.resolve(outputPath),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
