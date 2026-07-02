import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPublishedPackageSmokeReport } from "../packages/cli/src/published-package-smoke.js";

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

test("published-smoke emits clean-profile setup recovery classifications", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-published-smoke-setup-recovery-"));
  try {
    const dogfoodPath = join(dir, "dogfood.json");
    const fakeNpmTokenCanary = `npm_${"a".repeat(24)}`;
    writeJson(dogfoodPath, {
      ok: true,
      dogfoodReady: true,
      publicSafe: true,
      targetPlugin: { id: "lossless-openclaw-orchestrator", enabled: true, loaded: true, toolCount: 30 },
      requiredToolsPresent: true,
      installOutcome: { status: "installed", exitStatus: 0 }
    });

    const cases = [
      {
        name: "credentials",
        blockers: ["fresh_profile_gateway_credentials_required"],
        expected: "credential_required",
        expectedCommand: "openclaw doctor --generate-gateway-token --non-interactive --yes"
      },
      {
        name: "device",
        blockers: ["openclaw_device_identity_pairing_required"],
        expected: "device_pairing_required",
        expectedCommand: "openclaw devices approve --latest"
      },
      {
        name: "scope",
        blockers: ["openclaw_gateway_scope_approval_required"],
        expected: "scope_upgrade_required",
        expectedCommand: "openclaw devices approve --latest"
      },
      {
        name: "token",
        blockers: ["openclaw_gateway_token_rotation_required"],
        expected: "token_rotation_required",
        expectedCommand: "openclaw devices rotate --device <deviceId> --role operator"
      },
      {
        name: "generic-setup",
        blockers: ["openclaw_gateway_unknown_setup_required"],
        expected: "setup_required",
        expectedCommand: "loo openclaw tool-smoke"
      }
    ] as const;

    for (const item of cases) {
      const toolSmokePath = join(dir, `${item.name}-tool-smoke.json`);
      writeJson(toolSmokePath, {
        ok: false,
        toolSmokeReady: false,
        publicSafe: true,
        setupBlockers: item.blockers,
        setupStatus: {
          classification: "gateway_setup_required",
          packageInstallLikelyOk: true,
          recoverable: true,
          retryAfterSetup: true,
          doesNotIndicatePackageFailure: true
        },
        private: `raw-openclaw-output ${fakeNpmTokenCanary} state_5.sqlite`
      });

      const report = createPublishedPackageSmokeReport({
        rootDir: new URL("..", import.meta.url).pathname,
        dogfoodReportPath: dogfoodPath,
        toolSmokeReportPath: toolSmokePath
      });

      assert.equal(report.ok, true);
      assert.equal(report.setupRecovery.classification, item.expected);
      assert.equal(report.setupRecovery.packageInstallLikelyOk, true);
      assert.equal(report.setupRecovery.ready, false);
      assert.equal(report.setupRecovery.retryAfterSetup, true);
      assert.equal(report.setupRecovery.configuredGatewayProofSeparate, true);
      assert.ok(report.setupRecovery.nextSafeCommands.some((command) => command.includes(item.expectedCommand)));
      if (item.expected === "credential_required") {
        assert.ok(
          report.setupRecovery.nextSafeCommands.some((command) =>
            command.includes("openclaw onboard --non-interactive --accept-risk --gateway-auth token --gateway-token-ref-env OPENCLAW_GATEWAY_TOKEN")
          )
        );
        assert.ok(
          report.setupRecovery.nextSafeCommands.some((command) =>
            command.includes("openclaw gateway status --json --token '<scoped-token>'")
          )
        );
        assert.ok(
          report.setupRecovery.guidance.some((guidance) => guidance.includes("SecretRef/env-var"))
        );
      }
      assert.equal(report.setupRecovery.readinessProof.required, true);
      assert.equal(report.setupRecovery.readinessProof.satisfied, false);
      assert.match(report.setupRecovery.readinessProof.command, /loo openclaw tool-smoke/);
      assert.deepEqual(report.setupRecovery.readinessProof.evidence, []);
      assert.ok(report.setupRecovery.guidance.length > 0);
      assert.doesNotMatch(JSON.stringify(report.setupRecovery), /raw-openclaw-output|npm_[A-Za-z0-9]{20,}|state_5\.sqlite/i);
    }

    const multiBlockerToolSmokePath = join(dir, "multi-blocker-tool-smoke.json");
    writeJson(multiBlockerToolSmokePath, {
      ok: false,
      toolSmokeReady: false,
      publicSafe: true,
      setupBlockers: [
        "fresh_profile_gateway_credentials_required",
        "openclaw_gateway_scope_approval_required",
        "openclaw_device_identity_pairing_required"
      ],
      setupStatus: {
        classification: "gateway_setup_required",
        packageInstallLikelyOk: true,
        recoverable: true,
        retryAfterSetup: true,
        doesNotIndicatePackageFailure: true
      }
    });
    const multiBlockerReport = createPublishedPackageSmokeReport({
      rootDir: new URL("..", import.meta.url).pathname,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: multiBlockerToolSmokePath
    });
    assert.equal(multiBlockerReport.setupRecovery.classification, "credential_required");
    assert.deepEqual(multiBlockerReport.setupRecovery.requiredSetup, [
      "gateway_credentials",
      "device_pairing",
      "gateway_scope_approval"
    ]);
    assert.ok(
      multiBlockerReport.setupRecovery.nextSafeCommands.some((command) =>
        command.includes("OPENCLAW_GATEWAY_TOKEN='<scoped-token>'")
      )
    );
    assert.ok(
      multiBlockerReport.setupRecovery.nextSafeCommands.some((command) =>
        command.includes("openclaw devices approve --latest")
      )
    );
    assert.equal(multiBlockerReport.setupRecovery.guidance.length, 3);

    const readyToolSmokePath = join(dir, "ready-tool-smoke.json");
    writeJson(readyToolSmokePath, {
      ok: true,
      toolSmokeReady: true,
      publicSafe: true,
      setupBlockers: [],
      setupStatus: {
        classification: "ready",
        packageInstallLikelyOk: true,
        recoverable: false,
        retryAfterSetup: false,
        doesNotIndicatePackageFailure: true
      }
    });
    const readyReport = createPublishedPackageSmokeReport({
      rootDir: new URL("..", import.meta.url).pathname,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: readyToolSmokePath
    });
    assert.equal(readyReport.setupRecovery.classification, "ready");
    assert.equal(readyReport.setupRecovery.ready, true);
    assert.deepEqual(readyReport.setupRecovery.requiredSetup, []);
    assert.equal(readyReport.setupRecovery.readinessProof.required, false);
    assert.equal(readyReport.setupRecovery.readinessProof.satisfied, true);
    assert.match(readyReport.setupRecovery.readinessProof.command, /loo openclaw tool-smoke/);
    assert.deepEqual(readyReport.setupRecovery.readinessProof.evidence, ["fresh_profile_tool_smoke_ready"]);
    assert.ok(readyReport.setupRecovery.guidance.some((item) => item.includes("Fresh profile gateway tool-smoke is ready")));

    const readyUnknownToolSmokePath = join(dir, "ready-unknown-tool-smoke.json");
    writeJson(readyUnknownToolSmokePath, {
      ok: true,
      toolSmokeReady: true,
      publicSafe: true,
      setupBlockers: [],
      setupStatus: {
        packageInstallLikelyOk: true,
        recoverable: false,
        retryAfterSetup: false,
        doesNotIndicatePackageFailure: true
      }
    });
    const readyUnknownReport = createPublishedPackageSmokeReport({
      rootDir: new URL("..", import.meta.url).pathname,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: readyUnknownToolSmokePath
    });
    assert.equal(readyUnknownReport.publishedSmokeReady, true);
    assert.equal(readyUnknownReport.setupRecovery.classification, "ready");
    assert.equal(readyUnknownReport.setupRecovery.ready, true);

    const failedDogfoodPath = join(dir, "failed-dogfood.json");
    writeJson(failedDogfoodPath, {
      ok: false,
      dogfoodReady: false,
      publicSafe: true,
      targetPlugin: { id: "lossless-openclaw-orchestrator", enabled: false, loaded: false, toolCount: 0 },
      requiredToolsPresent: false,
      installOutcome: { status: "failed", exitStatus: 1 }
    });
    const packagePathFailureWithReadyToolSmokeReport = createPublishedPackageSmokeReport({
      rootDir: new URL("..", import.meta.url).pathname,
      dogfoodReportPath: failedDogfoodPath,
      toolSmokeReportPath: readyToolSmokePath
    });
    assert.equal(packagePathFailureWithReadyToolSmokeReport.packagePathOk, false);
    assert.equal(packagePathFailureWithReadyToolSmokeReport.setupRecovery.classification, "package_failure_or_unknown");
    assert.equal(packagePathFailureWithReadyToolSmokeReport.setupRecovery.ready, false);
    assert.equal(packagePathFailureWithReadyToolSmokeReport.setupRecovery.packageInstallLikelyOk, false);
    assert.deepEqual(packagePathFailureWithReadyToolSmokeReport.setupRecovery.requiredSetup, []);
    assert.equal(packagePathFailureWithReadyToolSmokeReport.setupRecovery.readinessProof.required, true);
    assert.equal(packagePathFailureWithReadyToolSmokeReport.setupRecovery.readinessProof.satisfied, false);
    assert.deepEqual(packagePathFailureWithReadyToolSmokeReport.setupRecovery.readinessProof.evidence, []);
    assert.ok(
      packagePathFailureWithReadyToolSmokeReport.setupRecovery.guidance.some((item) =>
        item.includes("possible package or plugin defect")
      )
    );

    const packageFailureToolSmokePath = join(dir, "package-failure-tool-smoke.json");
    writeJson(packageFailureToolSmokePath, {
      ok: false,
      toolSmokeReady: false,
      publicSafe: true,
      setupBlockers: [],
      setupStatus: {
        classification: "gateway_blocked",
        packageInstallLikelyOk: false,
        recoverable: false,
        retryAfterSetup: false,
        doesNotIndicatePackageFailure: false
      }
    });
    const packageFailureReport = createPublishedPackageSmokeReport({
      rootDir: new URL("..", import.meta.url).pathname,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: packageFailureToolSmokePath
    });
    assert.equal(packageFailureReport.setupRecovery.classification, "package_failure_or_unknown");
    assert.equal(packageFailureReport.setupRecovery.packageInstallLikelyOk, false);
    assert.equal(packageFailureReport.setupRecovery.ready, false);
    assert.equal(packageFailureReport.setupRecovery.readinessProof.satisfied, false);
    assert.ok(packageFailureReport.setupRecovery.guidance.some((item) => item.includes("possible package or plugin defect")));

    const packageFailurePrecedenceToolSmokePath = join(dir, "package-failure-precedence-tool-smoke.json");
    writeJson(packageFailurePrecedenceToolSmokePath, {
      ok: false,
      toolSmokeReady: false,
      publicSafe: true,
      setupBlockers: ["fresh_profile_gateway_credentials_required"],
      setupStatus: {
        classification: "gateway_setup_required",
        packageInstallLikelyOk: false,
        recoverable: false,
        retryAfterSetup: false,
        doesNotIndicatePackageFailure: false
      }
    });
    const packageFailurePrecedenceReport = createPublishedPackageSmokeReport({
      rootDir: new URL("..", import.meta.url).pathname,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: packageFailurePrecedenceToolSmokePath
    });
    assert.equal(packageFailurePrecedenceReport.setupRecovery.classification, "package_failure_or_unknown");
    assert.equal(packageFailurePrecedenceReport.setupRecovery.retryAfterSetup, false);
    assert.deepEqual(packageFailurePrecedenceReport.setupRecovery.requiredSetup, []);
    assert.equal(packageFailurePrecedenceReport.setupRecovery.readinessProof.satisfied, false);
    assert.ok(
      packageFailurePrecedenceReport.setupRecovery.nextSafeCommands.some((command) =>
        command.includes("Inspect package install")
      )
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
