import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("loo openclaw published-smoke summarizes install and gateway setup without raw output", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-published-smoke-"));
  try {
    const evidenceDir = join(dir, "evidence");
    const dogfoodPath = join(dir, "dogfood.json");
    const toolSmokePath = join(dir, "tool-smoke.json");
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    writeJson(dogfoodPath, {
      ok: true,
      dogfoodReady: true,
      publicSafe: true,
      targetPlugin: { id: "lossless-openclaw-orchestrator", enabled: true, loaded: true, toolCount: 30 },
      requiredToolsPresent: true,
      missingRequiredTools: [],
      blockers: [],
      warnings: [],
      installAttempted: true,
      installOutcome: { status: "installed", exitStatus: 0 },
      private: "super-secret-openclaw-output"
    });
    writeJson(toolSmokePath, {
      ok: false,
      toolSmokeReady: false,
      publicSafe: true,
      catalog: {
        requiredToolsPresent: false,
        missingRequiredTools: [],
        toolCount: 0
      },
      blockers: ["openclaw_gateway_credentials_required"],
      setupBlockers: ["fresh_profile_gateway_credentials_required"],
      setupStatus: {
        classification: "gateway_setup_required",
        packageInstallLikelyOk: true,
        recoverable: true,
        retryAfterSetup: true,
        doesNotIndicatePackageFailure: true
      },
      private: "super-secret-gateway-output"
    });

    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "openclaw",
      "published-smoke",
      "--evidence-dir",
      evidenceDir,
      "--registry-beta-version",
      packageJson.version,
      "--dogfood-report",
      dogfoodPath,
      "--tool-smoke-report",
      toolSmokePath,
      "--strict"
    ], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      publishedSmokeReady: boolean;
      packagePathOk: boolean;
      publicSafe: boolean;
      packageName: string;
      localVersion: string;
      registryBetaVersion: string | null;
      versionMatchStatus: string;
      dogfood: { dogfoodReady: boolean; installOutcomeStatus: string; requiredToolsPresent: boolean };
      toolSmoke: { toolSmokeReady: boolean; gatewaySetupClassification: string; packageInstallLikelyOk: boolean };
      setupRequired: boolean;
      setupBlockers: string[];
      blockers: string[];
      nextSafeCommands: string[];
      actionsPerformed: { npmPublished: boolean; githubReleaseCreated: boolean; liveCodexControlRun: boolean; desktopGuiActionRun: boolean };
      proofBoundary: string;
    };
    assert.equal(report.ok, true);
    assert.equal(report.publishedSmokeReady, false);
    assert.equal(report.packagePathOk, true);
    assert.equal(report.publicSafe, true);
    assert.equal(report.packageName, "lossless-openclaw-orchestrator");
    assert.equal(report.localVersion, packageJson.version);
    assert.equal(report.registryBetaVersion, packageJson.version);
    assert.equal(report.versionMatchStatus, "matches_registry_beta");
    assert.deepEqual(report.dogfood, {
      dogfoodReady: true,
      installOutcomeStatus: "installed",
      requiredToolsPresent: true
    });
    assert.deepEqual(report.toolSmoke, {
      toolSmokeReady: false,
      gatewaySetupClassification: "gateway_setup_required",
      packageInstallLikelyOk: true
    });
    assert.equal(report.setupRequired, true);
    assert.deepEqual(report.setupBlockers, ["fresh_profile_gateway_credentials_required"]);
    assert.deepEqual(report.blockers, []);
    assert.ok(report.nextSafeCommands.some((command) => command.includes("loo openclaw tool-smoke")));
    assert.deepEqual(report.actionsPerformed, {
      npmPublished: false,
      githubReleaseCreated: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false
    });
    assert.match(report.proofBoundary, /does not run live Codex control/i);
    assert.equal(existsSync(join(evidenceDir, "published-package-smoke.json")), true);
    assert.doesNotMatch(result.stdout, /super-secret|\.sqlite\b|\.db\b|Bearer\s+/i);
    assert.doesNotMatch(readFileSync(join(evidenceDir, "published-package-smoke.json"), "utf8"), /super-secret|\.sqlite\b|\.db\b|Bearer\s+/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("published-smoke reports configured gateway proof separately from fresh-profile setup", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-published-smoke-configured-"));
  try {
    const evidenceDir = join(dir, "evidence");
    const dogfoodPath = join(dir, "dogfood.json");
    const toolSmokePath = join(dir, "tool-smoke-fresh.json");
    const configuredToolSmokePath = join(dir, "tool-smoke-configured.json");
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    writeJson(dogfoodPath, {
      ok: true,
      dogfoodReady: true,
      publicSafe: true,
      targetPlugin: { id: "lossless-openclaw-orchestrator", enabled: true, loaded: true, toolCount: 30 },
      requiredToolsPresent: true,
      installOutcome: { status: "already_installed", exitStatus: 1 }
    });
    writeJson(toolSmokePath, {
      ok: false,
      toolSmokeReady: false,
      publicSafe: true,
      setupBlockers: ["fresh_profile_gateway_credentials_required"],
      setupStatus: {
        classification: "gateway_setup_required",
        packageInstallLikelyOk: true,
        recoverable: true,
        retryAfterSetup: true,
        doesNotIndicatePackageFailure: true
      }
    });
    writeJson(configuredToolSmokePath, {
      ok: true,
      toolSmokeReady: true,
      publicSafe: true,
      catalog: {
        requiredToolsPresent: true,
        missingRequiredTools: [],
        toolCount: 85
      },
      invocations: [
        { toolName: "loo_doctor", ok: true },
        { toolName: "loo_search_sessions", ok: true }
      ],
      setupStatus: {
        classification: "ready",
        packageInstallLikelyOk: true,
        recoverable: false,
        retryAfterSetup: false,
        doesNotIndicatePackageFailure: true
      },
      private: "super-secret-configured-gateway-output state_5.sqlite session.db"
    });

    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "openclaw",
      "published-smoke",
      "--evidence-dir",
      evidenceDir,
      "--registry-beta-version",
      packageJson.version,
      "--dogfood-report",
      dogfoodPath,
      "--tool-smoke-report",
      toolSmokePath,
      "--configured-tool-smoke-report",
      configuredToolSmokePath,
      "--strict"
    ], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      publishedSmokeReady: boolean;
      packagePathOk: boolean;
      setupRequired: boolean;
      dogfood: { dogfoodReady: boolean; installOutcomeStatus: string; requiredToolsPresent: boolean };
      toolSmoke: { toolSmokeReady: boolean; gatewaySetupClassification: string; packageInstallLikelyOk: boolean };
      configuredGateway: {
        provided: boolean;
        toolSmokeReady: boolean;
        gatewaySetupClassification: string;
        packageInstallLikelyOk: boolean;
        toolCount: number;
        invokedTools: string[];
      };
      blockers: string[];
    };

    assert.equal(report.ok, true);
    assert.equal(report.packagePathOk, true);
    assert.equal(report.publishedSmokeReady, false);
    assert.equal(report.setupRequired, true);
    assert.deepEqual(report.dogfood, {
      dogfoodReady: true,
      installOutcomeStatus: "already_installed",
      requiredToolsPresent: true
    });
    assert.deepEqual(report.toolSmoke, {
      toolSmokeReady: false,
      gatewaySetupClassification: "gateway_setup_required",
      packageInstallLikelyOk: true
    });
    assert.deepEqual(report.configuredGateway, {
      provided: true,
      toolSmokeReady: true,
      gatewaySetupClassification: "ready",
      packageInstallLikelyOk: true,
      toolCount: 85,
      invokedTools: ["loo_doctor", "loo_search_sessions"]
    });
    assert.deepEqual(report.blockers, []);
    assert.doesNotMatch(result.stdout, /super-secret|\.sqlite\b|\.db\b|Bearer\s+|npm_[A-Za-z0-9]{20,}/i);
    assert.doesNotMatch(readFileSync(join(evidenceDir, "published-package-smoke.json"), "utf8"), /super-secret|\.sqlite\b|\.db\b|Bearer\s+|npm_[A-Za-z0-9]{20,}/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
