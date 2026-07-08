#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLooToolDeclarations,
  createLooToolSurfaceSummary
} from "../packages/mcp-server/src/tools.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

export const OPENCLAW_MANIFEST_PATHS = [
  "openclaw.plugin.json",
  "packages/openclaw-plugin/openclaw.plugin.json"
];

export function createOpenClawPluginManifest({ packageVersion }) {
  const toolDeclarations = createLooToolDeclarations({ includeAliases: true });
  return {
    id: "lossless-openclaw-orchestrator",
    name: "Lossless OpenClaw Orchestrator",
    description:
      "Collaborate with local Codex sessions through OpenClaw using local indexing, prepared-state recall, bounded expansion, approval-gated dry-runs, and optional Codex controls.",
    version: packageVersion,
    kind: "tool",
    tools: {
      prefix: "lco_"
    },
    mcp: {
      command: "lco-mcp-server",
      transport: "stdio"
    },
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    },
    safety: {
      localOnlyByDefault: true,
      liveControlRequires: [
        "dry_run",
        "approval_audit_id"
      ]
    },
    activation: {
      onStartup: true
    },
    contracts: {
      tools: toolDeclarations.map((tool) => tool.name),
      toolDeclarations,
      toolSurface: createLooToolSurfaceSummary()
    }
  };
}

export function manifestJson(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function readPackageVersion(root = repoRoot) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (typeof pkg.version !== "string" || !pkg.version) {
    throw new Error("package.json must contain a version string");
  }
  return pkg.version;
}

export function syncOpenClawManifests({ root = repoRoot, check = false } = {}) {
  const manifest = createOpenClawPluginManifest({ packageVersion: readPackageVersion(root) });
  const expected = manifestJson(manifest);
  const mismatches = [];
  for (const path of OPENCLAW_MANIFEST_PATHS) {
    const absolutePath = join(root, path);
    if (check) {
      let actual = "";
      try {
        actual = readFileSync(absolutePath, "utf8");
      } catch {
        mismatches.push(path);
        continue;
      }
      if (actual !== expected) mismatches.push(path);
    } else {
      writeFileSync(absolutePath, expected);
    }
  }
  return {
    ok: mismatches.length === 0,
    check,
    paths: [...OPENCLAW_MANIFEST_PATHS],
    mismatches
  };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  if (args.some((arg) => arg !== "--check")) {
    console.error("Usage: node --import tsx scripts/sync-openclaw-manifests.mjs [--check]");
    process.exitCode = 2;
    return;
  }
  const result = syncOpenClawManifests({ check });
  if (!result.ok) {
    console.error(`OpenClaw manifests are out of sync: ${result.mismatches.join(", ")}`);
    console.error("Run: npm run openclaw:manifest");
    process.exitCode = 1;
    return;
  }
  console.log(check ? "OpenClaw manifests are in sync." : "OpenClaw manifests synced.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
