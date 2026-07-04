import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LOO_COMMAND_POLICY } from "../packages/adapters/src/index.js";
import { createLooToolDeclarations } from "../packages/mcp-server/src/tools.js";

const PLUGIN_ENTRY = "./dist/packages/openclaw-plugin/src/index.js";
const PACKAGE_BINS = {
  loo: "dist/packages/cli/src/index.js",
  "loo-mcp-server": "dist/packages/mcp-server/src/server.js"
};
const TOOL_TIERS = ["public_facade", "workflow_detail", "proof_debug", "internal_low_level"];
const PUBLIC_FACADE_TOOLS = [
  "loo_prepared_inbox",
  "loo_describe_ref",
  "loo_expand_query",
  "loo_recent_sessions",
  "loo_attention_inbox",
  "loo_project_digest",
  "loo_codex_control_dry_run",
  "loo_codex_resume_thread"
];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

test("OpenClaw package metadata points at the compiled native tool plugin entry", () => {
  const pkg = readJson("package.json");
  const openclaw = pkg.openclaw as { extensions?: unknown; runtimeExtensions?: unknown } | undefined;

  assert.deepEqual(openclaw?.extensions, [PLUGIN_ENTRY]);
  assert.equal(openclaw?.runtimeExtensions, undefined);
});

test("npm bin metadata is publish-normalized for the beta CLI entrypoints", () => {
  const pkg = readJson("package.json");
  const bins = pkg.bin as Record<string, unknown> | undefined;

  assert.deepEqual(bins, PACKAGE_BINS);
  for (const [command, binPath] of Object.entries(PACKAGE_BINS)) {
    assert.equal(binPath.startsWith("./"), false, `${command} bin path must not use a leading ./`);
    assert.equal(binPath.startsWith("/"), false, `${command} bin path must stay package-relative`);
  }
});

test("OpenClaw plugin contracts match the exported loo tool declarations", () => {
  const manifest = readJson("openclaw.plugin.json");
  const sourceManifest = readJson("packages/openclaw-plugin/openclaw.plugin.json");
  const contracts = manifest.contracts as { tools?: unknown; toolDeclarations?: unknown } | undefined;
  const sourceContracts = sourceManifest.contracts as { tools?: unknown; toolDeclarations?: unknown } | undefined;
  const expectedTools = createLooToolDeclarations();

  assert.deepEqual(contracts?.tools, expectedTools.map((tool) => tool.name));
  assert.deepEqual(contracts?.toolDeclarations, expectedTools);
  assert.deepEqual(sourceContracts?.toolDeclarations, expectedTools);
  for (const declaration of [...(contracts?.toolDeclarations as typeof expectedTools), ...(sourceContracts?.toolDeclarations as typeof expectedTools)]) {
    assert.deepEqual(declaration.safety, LOO_COMMAND_POLICY[declaration.name]);
  }
  assert.deepEqual(manifest.activation, { onStartup: true });
  assert.deepEqual(manifest.configSchema, {
    type: "object",
    additionalProperties: false,
    properties: {}
  });
});

test("OpenClaw plugin contracts classify every tool into an operator surface tier", () => {
  const manifest = readJson("openclaw.plugin.json");
  const sourceManifest = readJson("packages/openclaw-plugin/openclaw.plugin.json");
  const contracts = manifest.contracts as { toolDeclarations?: unknown; toolSurface?: unknown } | undefined;
  const sourceContracts = sourceManifest.contracts as { toolDeclarations?: unknown; toolSurface?: unknown } | undefined;
  const declarations = createLooToolDeclarations() as Array<{
    name: string;
    metadata?: {
      tier?: unknown;
      operatorPathRank?: unknown;
      operatorPathRole?: unknown;
    };
  }>;

  assert.equal(declarations.length > PUBLIC_FACADE_TOOLS.length, true, "expert/debug tools must remain declared");
  for (const declaration of declarations) {
    assert.equal(
      TOOL_TIERS.includes(String(declaration.metadata?.tier)),
      true,
      `${declaration.name} must choose one supported tool tier`
    );
  }

  const publicFacade = declarations
    .filter((declaration) => declaration.metadata?.tier === "public_facade")
    .sort((left, right) => Number(left.metadata?.operatorPathRank) - Number(right.metadata?.operatorPathRank));
  assert.equal(publicFacade.length >= 6 && publicFacade.length <= 8, true, "public facade must stay compact");
  assert.deepEqual(publicFacade.map((declaration) => declaration.name), PUBLIC_FACADE_TOOLS);
  assert.deepEqual(publicFacade.map((declaration) => declaration.metadata?.operatorPathRank), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const declaration of publicFacade) {
    assert.equal(typeof declaration.metadata?.operatorPathRole, "string", `${declaration.name} must describe its facade role`);
  }

  for (const manifestContracts of [contracts, sourceContracts]) {
    assert.deepEqual(manifestContracts?.toolDeclarations, declarations);
    assert.deepEqual(
      (manifestContracts?.toolSurface as { publicFacadeTools?: unknown } | undefined)?.publicFacadeTools,
      PUBLIC_FACADE_TOOLS
    );
    assert.deepEqual(
      (manifestContracts?.toolSurface as { tiers?: unknown } | undefined)?.tiers,
      TOOL_TIERS
    );
    assert.match(
      JSON.stringify((manifestContracts?.toolSurface as { namingPolicy?: unknown } | undefined)?.namingPolicy),
      /#434/
    );
    assert.match(
      JSON.stringify((manifestContracts?.toolSurface as { namingPolicy?: unknown } | undefined)?.namingPolicy),
      /loo_/
    );
    assert.match(
      JSON.stringify((manifestContracts?.toolSurface as { namingPolicy?: unknown } | undefined)?.namingPolicy),
      /lco/i
    );
  }
});
