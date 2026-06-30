import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createLooToolDeclarations } from "../packages/mcp-server/src/tools.js";

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

test("OpenClaw plugin contracts match the exported loo tool declarations", () => {
  const manifest = readJson("openclaw.plugin.json");
  const contracts = manifest.contracts as { tools?: unknown; toolDeclarations?: unknown } | undefined;
  const expectedTools = createLooToolDeclarations();

  assert.deepEqual(contracts?.tools, expectedTools.map((tool) => tool.name));
  assert.deepEqual(contracts?.toolDeclarations, expectedTools);
  assert.deepEqual(manifest.activation, { onStartup: true });
  assert.deepEqual(manifest.configSchema, {
    type: "object",
    additionalProperties: false,
    properties: {}
  });
});
