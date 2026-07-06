import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LOO_COMMAND_POLICY } from "../packages/adapters/src/index.js";
import {
  canonicalLooToolName,
  createLooToolDeclarations,
  createLooToolSurfaceSummary,
  isLooToolAlias
} from "../packages/mcp-server/src/tools.js";

const PLUGIN_ENTRY = "./dist/packages/openclaw-plugin/src/index.js";
const PACKAGE_BINS = {
  loo: "dist/packages/cli/src/index.js",
  "loo-mcp-server": "dist/packages/mcp-server/src/server.js"
};
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

test("Codex plugin bundle installs the thread title finalizer hook without adding an agent tool", () => {
  const pkg = readJson("package.json");
  const files = pkg.files as unknown[] | undefined;
  const plugin = readJson(".codex-plugin/plugin.json");
  const hookConfig = readJson("hooks/hooks.json");
  const hooksRoot = hookConfig.hooks as { Stop?: Array<{ hooks?: Array<{ type?: unknown; command?: unknown; async?: unknown }> }> } | undefined;
  const declarations = createLooToolDeclarations();

  assert.equal(files?.includes(".codex-plugin"), true);
  assert.equal(files?.includes("hooks"), true);
  assert.equal(plugin.name, "lossless-openclaw-orchestrator");
  assert.equal(plugin.hooks, undefined);
  assert.equal(plugin.skills, undefined);
  assert.equal(hooksRoot?.Stop?.[0]?.hooks?.[0]?.type, "command");
  assert.equal(hooksRoot?.Stop?.[0]?.hooks?.[0]?.command, "node \"${CLAUDE_PLUGIN_ROOT}/.codex-plugin/scripts/thread-title-finalize.mjs\"");
  assert.equal(hooksRoot?.Stop?.[0]?.hooks?.[0]?.async, false);
  assert.equal(declarations.some((declaration) => /title|thread-title|rename/i.test(declaration.name)), false);
  assert.doesNotMatch(JSON.stringify({ plugin, hookConfig }), /AGENTS\.md|thread\/name\/set|gui mutation/i);
});

test("OpenClaw plugin contracts match the exported loo tool declarations", () => {
  const manifest = readJson("openclaw.plugin.json");
  const sourceManifest = readJson("packages/openclaw-plugin/openclaw.plugin.json");
  const contracts = manifest.contracts as { tools?: unknown; toolDeclarations?: unknown } | undefined;
  const sourceContracts = sourceManifest.contracts as { tools?: unknown; toolDeclarations?: unknown } | undefined;
  const expectedTools = createLooToolDeclarations({ includeAliases: true });

  assert.deepEqual(contracts?.tools, expectedTools.map((tool) => tool.name));
  assert.deepEqual(contracts?.toolDeclarations, expectedTools);
  assert.deepEqual(sourceContracts?.toolDeclarations, expectedTools);
  for (const declaration of [...(contracts?.toolDeclarations as typeof expectedTools), ...(sourceContracts?.toolDeclarations as typeof expectedTools)]) {
    assert.deepEqual(declaration.safety, LOO_COMMAND_POLICY[canonicalLooToolName(declaration.name)]);
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
  const generatedToolSurface = createLooToolSurfaceSummary();
  const declarations = createLooToolDeclarations({ includeAliases: true }) as Array<{
    name: string;
    metadata?: {
      tier?: unknown;
      operatorPathRank?: unknown;
      operatorPathRole?: unknown;
      aliasOf?: unknown;
    };
  }>;
  const baseDeclarations = declarations.filter((declaration) => !isLooToolAlias(declaration));

  assert.equal(baseDeclarations.length > generatedToolSurface.publicFacadeTools.length, true, "expert/debug tools must remain declared");
  for (const declaration of declarations) {
    assert.equal(
      (generatedToolSurface.tiers as string[]).includes(String(declaration.metadata?.tier)),
      true,
      `${declaration.name} must choose one supported tool tier`
    );
  }

  const publicFacade = baseDeclarations
    .filter((declaration) => declaration.metadata?.tier === "public_facade")
    .sort((left, right) => Number(left.metadata?.operatorPathRank) - Number(right.metadata?.operatorPathRank));
  assert.equal(publicFacade.length >= 6 && publicFacade.length <= 8, true, "public facade must stay compact");
  assert.deepEqual(publicFacade.map((declaration) => declaration.name), generatedToolSurface.publicFacadeTools);
  assert.deepEqual(publicFacade.map((declaration) => declaration.metadata?.operatorPathRank), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const declaration of publicFacade) {
    assert.equal(typeof declaration.metadata?.operatorPathRole, "string", `${declaration.name} must describe its facade role`);
  }
  const aliases = declarations.filter((declaration) => isLooToolAlias(declaration));
  const lcoAliases = aliases.filter((declaration) => declaration.name.startsWith("lco_"));
  const compatibilityAliases = aliases.filter((declaration) => declaration.name.startsWith("loo_"));
  assert.deepEqual(
    lcoAliases.map((declaration) => declaration.name).sort(),
    generatedToolSurface.publicFacadeTools.map((name) => name.replace(/^loo_/, "lco_")).sort()
  );
  assert.equal(compatibilityAliases.length, 31);
  for (const alias of lcoAliases) {
    assert.equal(generatedToolSurface.publicFacadeTools.includes(String(alias.metadata?.aliasOf)), true);
  }
  for (const alias of compatibilityAliases) {
    assert.equal(baseDeclarations.some((declaration) => declaration.name === alias.metadata?.aliasOf), true);
  }

  for (const manifestContracts of [contracts, sourceContracts]) {
    const toolSurface = manifestContracts?.toolSurface as
      | {
          publicFacadeTools?: unknown;
          tiers?: unknown;
          namingPolicy?: {
            publicProductAbbreviation?: unknown;
            forwardPublicAliasTarget?: unknown;
            currentRuntimePrefix?: unknown;
            legacyCompatiblePrefix?: unknown;
            compatibilityIssue?: unknown;
            aliasPolicy?: unknown;
          };
          desktopFallback?: {
            normalFirstPath?: unknown;
            preferredBackend?: unknown;
            preferredLaunch?: unknown;
            bundledByLco?: unknown;
            secondaryBackend?: unknown;
            missingPreferredBackendBehavior?: unknown;
            proofBoundary?: unknown;
          };
          exposureProfile?: {
            environmentVariable?: unknown;
            defaultProfile?: unknown;
            profiles?: {
              facade?: {
                tiers?: unknown;
              };
            };
            callPolicy?: unknown;
          };
        }
      | undefined;

    assert.deepEqual(manifestContracts?.toolDeclarations, declarations);
    assert.deepEqual(manifestContracts?.toolSurface, generatedToolSurface);
    assert.equal(toolSurface?.namingPolicy?.publicProductAbbreviation, "LCO");
    assert.equal(toolSurface?.namingPolicy?.forwardPublicAliasTarget, "lco_*");
    assert.equal(toolSurface?.namingPolicy?.currentRuntimePrefix, "loo_");
    assert.equal(toolSurface?.namingPolicy?.legacyCompatiblePrefix, "loo_");
    assert.equal(toolSurface?.namingPolicy?.compatibilityIssue, "#434");
    assert.match(String(toolSurface?.namingPolicy?.aliasPolicy), /backward compatible/);
    assert.equal(toolSurface?.exposureProfile?.environmentVariable, "LOO_TOOL_PROFILE");
    assert.equal(toolSurface?.exposureProfile?.defaultProfile, "all");
    assert.deepEqual(toolSurface?.exposureProfile?.profiles?.facade?.tiers, ["public_facade"]);
    assert.match(String(toolSurface?.exposureProfile?.callPolicy), /hidden.*callable/i);
    assert.equal(toolSurface?.desktopFallback?.normalFirstPath, "direct Codex protocol");
    assert.equal(toolSurface?.desktopFallback?.preferredBackend, "cua-driver");
    assert.equal(toolSurface?.desktopFallback?.preferredLaunch, "cua-driver mcp");
    assert.equal(toolSurface?.desktopFallback?.bundledByLco, false);
    assert.equal(toolSurface?.desktopFallback?.secondaryBackend, "peekaboo");
    assert.match(String(toolSurface?.desktopFallback?.missingPreferredBackendBehavior), /read\/search\/describe/);
    assert.match(String(toolSurface?.desktopFallback?.proofBoundary), /cua-driver mcp --help/);
    assert.match(String(toolSurface?.desktopFallback?.proofBoundary), /do not validate a composer read-back field/);
    assert.match(String(toolSurface?.desktopFallback?.proofBoundary), /composer send approval/);
    assert.match(String(toolSurface?.desktopFallback?.proofBoundary), /No generic GUI mutation/);
  }
});

test("native OpenClaw plugin wrapper passes facade metadata to runtime tool definitions", () => {
  const pluginSource = readFileSync("packages/openclaw-plugin/src/index.ts", "utf8");

  assert.match(pluginSource, /metadata:\s*LooTool\["metadata"\]/);
  assert.match(pluginSource, /metadata:\s*declaration\.metadata/);
  assert.match(pluginSource, /parameters:\s*declaration\.inputSchema/);
});

test("always-on MCP and native plugin surfaces use bounded schema-only DB startup", () => {
  const pluginSource = readFileSync("packages/openclaw-plugin/src/index.ts", "utf8");
  const mcpServerSource = readFileSync("packages/mcp-server/src/server.ts", "utf8");
  const mcpRuntimeSource = readFileSync("packages/mcp-server/src/server-runtime.ts", "utf8");

  assert.match(pluginSource, /createDatabase\(\{\s*maintenance:\s*"schema-only"\s*\}\)/);
  assert.doesNotMatch(mcpServerSource, /createDatabase|core\/src\/index|node:sqlite/);
  assert.match(mcpRuntimeSource, /createDatabase\(\{\s*maintenance:\s*"schema-only"\s*\}\)/);
  assert.match(mcpRuntimeSource, /function getRuntimeState\(\)/);
});
