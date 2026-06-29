import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createOpenClawDogfoodReport, runOpenClawDogfood } from "../packages/cli/src/openclaw-dogfood.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("OpenClaw dogfood report fails closed without leaking raw plugin output", () => {
  const report = createOpenClawDogfoodReport({
    pluginListExitStatus: 0,
    pluginListStdout: JSON.stringify([
      {
        plugin: { id: "other-plugin", name: "Other plugin" },
        tools: [{ name: "not_a_loo_tool", description: "token secret should not echo" }]
      }
    ])
  });

  assert.equal(report.ok, false);
  assert.equal(report.dogfoodReady, false);
  assert.deepEqual(report.blockers, ["target_plugin_not_loaded"]);
  assert.deepEqual(report.missingRequiredTools, [
    "loo_search_sessions",
    "loo_describe_session",
    "loo_expand_query",
    "loo_codex_control_dry_run"
  ]);
  assert.equal(report.publicSafe, true);
  assert.doesNotMatch(JSON.stringify(report), /secret|not_a_loo_tool|Other plugin/);
});

test("OpenClaw dogfood report accepts loaded target plugin with required loo tools", () => {
  const report = createOpenClawDogfoodReport({
    pluginListExitStatus: 0,
    pluginListStdout: JSON.stringify([
      {
        plugin: { id: "lossless-openclaw-orchestrator", name: "Lossless OpenClaw Orchestrator" },
        enabled: true,
        status: "loaded",
        toolNames: [
          "loo_search_sessions",
          "loo_describe_session",
          "loo_expand_query",
          "loo_codex_control_dry_run",
          "loo_doctor"
        ]
      }
    ])
  });

  assert.equal(report.ok, true);
  assert.equal(report.dogfoodReady, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.targetPlugin?.id, "lossless-openclaw-orchestrator");
  assert.equal(report.targetPlugin?.toolCount, 5);
  assert.equal(report.requiredToolsPresent, true);
});

test("OpenClaw dogfood report uses runtime inspect tools when plugin list omits tool names", () => {
  const report = createOpenClawDogfoodReport({
    pluginListExitStatus: 0,
    pluginListStdout: JSON.stringify({
      plugins: [{
        id: "lossless-openclaw-orchestrator",
        enabled: true,
        status: "loaded",
        toolNames: []
      }]
    }),
    runtimeInspectExitStatus: 0,
    runtimeInspectStdout: JSON.stringify({
      plugin: {
        id: "lossless-openclaw-orchestrator",
        enabled: true,
        status: "loaded"
      },
      tools: [
        { names: ["loo_search_sessions"] },
        { names: ["loo_describe_session"] },
        { names: ["loo_expand_query"] },
        { names: ["loo_codex_control_dry_run"] }
      ]
    })
  });

  assert.equal(report.dogfoodReady, true);
  assert.equal(report.targetPlugin?.toolCount, 4);
  assert.deepEqual(report.blockers, []);
});

test("OpenClaw dogfood report tolerates OpenClaw log preambles before runtime JSON", () => {
  const report = createOpenClawDogfoodReport({
    pluginListExitStatus: 0,
    pluginListStdout: JSON.stringify({
      plugins: [{
        id: "lossless-openclaw-orchestrator",
        enabled: true,
        status: "loaded",
        toolNames: []
      }]
    }),
    runtimeInspectExitStatus: 0,
    runtimeInspectStdout: [
      "warning: migrating OpenClaw plugin state",
      JSON.stringify({
        plugin: {
          id: "lossless-openclaw-orchestrator",
          enabled: true,
          status: "loaded"
        },
        tools: [
          { names: ["loo_search_sessions"] },
          { names: ["loo_describe_session"] },
          { names: ["loo_expand_query"] },
          { names: ["loo_codex_control_dry_run"] }
        ]
      })
    ].join("\n")
  });

  assert.equal(report.dogfoodReady, true);
  assert.equal(report.targetPlugin?.toolCount, 4);
  assert.deepEqual(report.blockers, []);
});

test("loo openclaw dogfood writes public-safe evidence and honors strict mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-dogfood-"));
  const pluginListJson = join(dir, "plugins.json");
  const evidencePath = join(dir, "dogfood.json");
  writeJson(pluginListJson, []);

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "openclaw",
    "dogfood",
    "--plugin-list-json",
    pluginListJson,
    "--evidence-path",
    evidencePath,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(evidencePath, "utf8")) as { blockers?: string[]; publicSafe?: boolean };
  assert.deepEqual(report.blockers, ["target_plugin_not_loaded"]);
  assert.equal(report.publicSafe, true);
  assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /plugins\\.json/);
});

test("loo openclaw dogfood creates parent directories for evidence output", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-dogfood-"));
  const pluginListJson = join(dir, "plugins.json");
  const evidencePath = join(dir, "fresh", "packet", "dogfood.json");
  writeJson(pluginListJson, []);

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "openclaw",
    "dogfood",
    "--plugin-list-json",
    pluginListJson,
    "--evidence-path",
    evidencePath,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(existsSync(evidencePath), true);
  const report = JSON.parse(readFileSync(evidencePath, "utf8")) as { blockers?: string[]; publicSafe?: boolean };
  assert.deepEqual(report.blockers, ["target_plugin_not_loaded"]);
  assert.equal(report.publicSafe, true);
});

test("OpenClaw dogfood omits force when installing a linked plugin", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-openclaw-fake-"));
  const callsPath = join(dir, "calls.jsonl");
  const fakeOpenClaw = join(dir, "openclaw-fake.mjs");
  writeFileSync(fakeOpenClaw, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.OPENCLAW_FAKE_CALLS, JSON.stringify(args) + "\\n");
if (args.includes("plugins") && args.includes("install") && args.includes("--link") && args.includes("--force")) process.exit(9);
if (args.includes("plugins") && args.includes("list")) {
  console.log(JSON.stringify({ plugins: [{
    id: "lossless-openclaw-orchestrator",
    enabled: true,
    status: "loaded",
    toolNames: ["loo_search_sessions", "loo_describe_session", "loo_expand_query", "loo_codex_control_dry_run"]
  }] }));
  process.exit(0);
}
process.exit(0);
`);
  chmodSync(fakeOpenClaw, 0o755);

  const previous = process.env.OPENCLAW_FAKE_CALLS;
  process.env.OPENCLAW_FAKE_CALLS = callsPath;
  try {
    const report = runOpenClawDogfood({
      openclawBin: fakeOpenClaw,
      profile: "lco-dogfood",
      installSource: ".",
      link: true,
      forceInstall: true
    });

    assert.equal(report.dogfoodReady, true);
    assert.equal(report.installAttempted, true);
    assert.equal(report.installExitStatus, 0);
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
    const installCall = calls.find((call) => call.includes("install"));
    assert.ok(installCall, "fake OpenClaw should receive install call");
    assert.equal(installCall.includes("--link"), true);
    assert.equal(installCall.includes("--force"), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_FAKE_CALLS;
    else process.env.OPENCLAW_FAKE_CALLS = previous;
  }
});
