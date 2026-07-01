import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createOnboardingStatusReport } from "../packages/cli/src/onboarding-status.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
const cliEntry = fileURLToPath(new URL("../packages/cli/src/index.ts", import.meta.url));

test("loo onboard status writes a public-safe first-run readiness artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-onboard-status-"));
  const evidenceDir = join(root, "evidence");
  try {
    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      cliEntry,
      "onboard",
      "status",
      "--evidence-dir",
      evidenceDir,
      "--strict"
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      publicSafe: boolean;
      dryRun: boolean;
      localOnly: boolean;
      packageName: string;
      version: string;
      blockers: string[];
      warnings: string[];
      requiredFiles: Array<{ id: string; exists: boolean; required: boolean }>;
      sourceEntrypoints: Array<{ id: string; exists: boolean; required: boolean }>;
      packageEntrypoints: Array<{ id: string; exists: boolean; required: boolean }>;
      openclaw: {
        manifestPath: string;
        toolCount: number;
        requiredToolsPresent: string[];
        missingRequiredTools: string[];
      };
      installRecovery: {
        publishedPackage: string;
        cleanProfile: string;
        registryCheckCommand: string;
        globalInstallCommand: string;
        openclawInstallCommand: string;
        dogfoodCommand: string;
        toolSmokeCommand: string;
        setupGuidance: string[];
      };
      nextSafeCommands: string[];
      forbiddenActions: string[];
      proofBoundary: string;
    };

    assert.equal(report.ok, true);
    assert.equal(report.publicSafe, true);
    assert.equal(report.dryRun, true);
    assert.equal(report.localOnly, true);
    assert.equal(report.packageName, "lossless-openclaw-orchestrator");
    assert.match(report.version, /^0\.1\.0-beta\./);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.requiredFiles.every((item) => item.exists), true);
    assert.equal(report.sourceEntrypoints.every((item) => item.exists), true);
    assert.equal(report.packageEntrypoints.some((item) => item.id === "loo"), true);
    assert.equal(report.openclaw.manifestPath, "openclaw.plugin.json");
    assert.ok(report.openclaw.toolCount >= 20);
    assert.deepEqual(report.openclaw.missingRequiredTools, []);
    for (const toolName of ["loo_doctor", "loo_search_sessions", "loo_describe_session", "loo_expand_query"]) {
      assert.ok(report.openclaw.requiredToolsPresent.includes(toolName), toolName);
    }
    assert.ok(report.nextSafeCommands.includes("loo doctor"));
    assert.ok(report.nextSafeCommands.some((command) => command.includes("loo openclaw dogfood")));
    assert.equal(report.installRecovery.publishedPackage, "lossless-openclaw-orchestrator@beta");
    assert.equal(report.installRecovery.cleanProfile, "lco-dogfood-published");
    assert.equal(report.installRecovery.registryCheckCommand, "npm view lossless-openclaw-orchestrator@beta version dist-tags --json");
    assert.equal(report.installRecovery.globalInstallCommand, "npm install -g lossless-openclaw-orchestrator@beta");
    assert.equal(report.installRecovery.openclawInstallCommand, "openclaw --profile lco-dogfood-published plugins install lossless-openclaw-orchestrator@beta");
    assert.equal(report.installRecovery.dogfoodCommand, "loo openclaw dogfood --profile lco-dogfood-published --install-source lossless-openclaw-orchestrator@beta --required-tool loo_doctor --required-tool loo_search_sessions --strict");
    assert.equal(report.installRecovery.toolSmokeCommand, "loo openclaw tool-smoke --profile lco-dogfood-published --required-tool loo_doctor --required-tool loo_search_sessions --strict");
    assert.ok(report.installRecovery.setupGuidance.some((item) => item.includes("gateway_setup_required")));
    assert.ok(report.nextSafeCommands.includes(report.installRecovery.registryCheckCommand));
    assert.ok(report.nextSafeCommands.includes(report.installRecovery.globalInstallCommand));
    assert.ok(report.nextSafeCommands.includes(report.installRecovery.openclawInstallCommand));
    assert.ok(report.forbiddenActions.includes("npm publish"));
    assert.match(report.proofBoundary, /published-beta install recovery/i);

    const evidencePath = join(evidenceDir, "onboarding-status.json");
    assert.equal(existsSync(evidencePath), true);
    assert.deepEqual(JSON.parse(readFileSync(evidencePath, "utf8")), report);
    assertNoPrivateEvidence(result.stdout);
    assertNoPrivateEvidence(readFileSync(evidencePath, "utf8"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo onboard status resolves the package root outside the caller cwd and honors --now", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-onboard-status-cwd-"));
  const evidenceDir = join(root, "evidence");
  try {
    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      cliEntry,
      "onboard",
      "status",
      "--evidence-dir",
      evidenceDir,
      "--now",
      "2026-07-01T00:00:00.000Z",
      "--strict"
    ], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as { ok: boolean; generatedAt: string; blockers: string[] };
    assert.equal(report.ok, true);
    assert.equal(report.generatedAt, "2026-07-01T00:00:00.000Z");
    assert.deepEqual(report.blockers, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("onboard status fails closed for malformed package metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-onboard-status-bad-package-"));
  try {
    writeMinimalOnboardingTree(root);
    writeFileSync(join(root, "package.json"), "{bad-json");

    const report = createOnboardingStatusReport({ rootDir: root, now: "2026-07-01T00:00:00.000Z" });

    assert.equal(report.ok, false);
    assert.ok(report.blockers.includes("package_json_invalid"), report.blockers.join(", "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("onboard status validates OpenClaw manifest wiring, not only declared tool names", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-onboard-status-bad-manifest-"));
  try {
    writeMinimalOnboardingTree(root);
    writeFileSync(join(root, "openclaw.plugin.json"), JSON.stringify({
      contracts: { tools: requiredOpenClawToolsForTest() },
      mcp: { command: "wrong-server", transport: "http" },
      tools: { prefix: "bad_" }
    }, null, 2));

    const report = createOnboardingStatusReport({ rootDir: root, now: "2026-07-01T00:00:00.000Z" });

    assert.equal(report.ok, false);
    assert.ok(report.blockers.includes("invalid_openclaw_manifest_mcp_command"), report.blockers.join(", "));
    assert.ok(report.blockers.includes("invalid_openclaw_manifest_transport"), report.blockers.join(", "));
    assert.ok(report.blockers.includes("invalid_openclaw_manifest_tool_prefix"), report.blockers.join(", "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("onboard status normalizes package entrypoint paths consistently", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-onboard-status-entrypoints-"));
  try {
    writeMinimalOnboardingTree(root, {
      packageJson: {
        name: "lossless-openclaw-orchestrator",
        version: "0.1.0-beta.fixture",
        bin: {
          loo: "./dist/packages/cli/src/index.js"
        },
        openclaw: {
          extensions: ["./dist/packages/openclaw-plugin/src/index.js"]
        }
      }
    });

    const report = createOnboardingStatusReport({ rootDir: root, now: "2026-07-01T00:00:00.000Z" });

    assert.equal(report.ok, true, report.blockers.join(", "));
    assert.deepEqual(report.warnings, []);
    assert.equal(report.packageEntrypoints.find((entry) => entry.id === "loo")?.path, "dist/packages/cli/src/index.js");
    assert.equal(report.packageEntrypoints.find((entry) => entry.id === "openclaw_extension_1")?.path, "dist/packages/openclaw-plugin/src/index.js");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function assertNoPrivateEvidence(value: string): void {
  assert.doesNotMatch(value, /sk-[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(value, /Bearer\s+[^\s"]{16,}/);
  assert.doesNotMatch(value, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  assert.doesNotMatch(value, /\.sqlite\b/);
  assert.doesNotMatch(value, /raw Codex transcript/i);
}

function writeMinimalOnboardingTree(root: string, options: {
  packageJson?: unknown;
} = {}): void {
  const fileContents: Record<string, string> = {
    "package.json": JSON.stringify(options.packageJson ?? {
      name: "lossless-openclaw-orchestrator",
      version: "0.1.0-beta.fixture",
      bin: {
        loo: "dist/packages/cli/src/index.js"
      },
      openclaw: {
        extensions: ["./dist/packages/openclaw-plugin/src/index.js"]
      }
    }, null, 2),
    "README.md": "fixture",
    "VISION.md": "fixture",
    "openclaw.plugin.json": JSON.stringify({
      contracts: { tools: requiredOpenClawToolsForTest() },
      mcp: { command: "loo-mcp-server", transport: "stdio" },
      tools: { prefix: "loo_" }
    }, null, 2),
    "docs/OPENCLAW_PLUGIN.md": "fixture",
    "docs/BETA_RELEASE_DEMO.md": "fixture",
    "docs/BETA_RELEASE_RUNBOOK.md": "fixture",
    "evals/scorecards/v1.0/packaging-install-review.json": "{}",
    "packages/cli/src/index.ts": "fixture",
    "packages/mcp-server/src/server.ts": "fixture",
    "packages/openclaw-plugin/src/index.ts": "fixture",
    "dist/packages/cli/src/index.js": "fixture",
    "dist/packages/openclaw-plugin/src/index.js": "fixture"
  };

  for (const [relativePath, content] of Object.entries(fileContents)) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

function requiredOpenClawToolsForTest(): string[] {
  return [
    "loo_doctor",
    "loo_search_sessions",
    "loo_describe_session",
    "loo_expand_query",
    "loo_codex_plans",
    "loo_codex_final_messages",
    "loo_codex_thread_map",
    "loo_codex_control_dry_run"
  ];
}
