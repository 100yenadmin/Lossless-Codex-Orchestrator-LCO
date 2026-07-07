import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOpenClawDogfoodReport } from "../packages/cli/src/openclaw-dogfood.js";
import { createPublishedPackageSmokeReport } from "../packages/cli/src/published-package-smoke.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
const packageVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeValidBinaryProbe(path: string, version = packageVersion): void {
  writeJson(path, {
    kind: "loo_published_binary_probe_evidence",
    publicSafe: true,
    rawSecretIncluded: false,
    expectedVersion: version,
    observedVersion: version,
    resolvedBinarySource: "package_exec",
    pathShadowed: false,
    packageJsonVersion: version
  });
}

function writeReadyToolSmoke(path: string): void {
  writeJson(path, {
    ok: true,
    toolSmokeReady: true,
    setupStatus: {
      classification: "ready",
      packageInstallLikelyOk: true
    },
    setupBlockers: [],
    catalog: { toolCount: 34 },
    invocations: [{ toolName: "lco_doctor", ok: true }]
  });
}

function expectedDistTag(version: string): "beta" | "next" | "latest" {
  if (version.includes("-rc.")) return "next";
  if (version.includes("-beta.")) return "beta";
  return "latest";
}

function expectedVersionMatchStatus(version: string): string {
  const distTag = expectedDistTag(version);
  if (distTag === "beta") return "matches_registry_beta";
  if (distTag === "next") return "matches_registry_next";
  return "matches_registry_latest";
}

function expectedMismatchStatus(version: string): string {
  const distTag = expectedDistTag(version);
  if (distTag === "beta") return "registry_beta_mismatch";
  if (distTag === "next") return "registry_next_mismatch";
  return "registry_latest_mismatch";
}

test("loo openclaw published-smoke summarizes install and gateway setup without raw output", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-published-smoke-"));
  try {
    const evidenceDir = join(dir, "evidence");
    const dogfoodPath = join(dir, "dogfood.json");
    const toolSmokePath = join(dir, "tool-smoke.json");
    const binaryProbePath = join(dir, "binary-probe.json");
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    writeValidBinaryProbe(binaryProbePath, packageJson.version);
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
      "--registry-version",
      packageJson.version,
      "--dogfood-report",
      dogfoodPath,
      "--tool-smoke-report",
      toolSmokePath,
      "--binary-probe-report",
      binaryProbePath,
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
      readinessSemantics: {
        okField: string;
        strictModeExitsOn: string;
        gatewayReadyStrictExitsOn: string;
        cleanProfileGatewayReadyField: string;
        configuredGatewayProofSeparate: boolean;
      };
      publicSafe: boolean;
      packageName: string;
      localVersion: string;
      expectedDistTag: string;
      expectedPackage: string;
      registryVersion: string | null;
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
    assert.deepEqual(report.readinessSemantics, {
      okField: "packagePathOk",
      strictModeExitsOn: "packagePathOk_false",
      gatewayReadyStrictExitsOn: "publishedSmokeReady_false",
      cleanProfileGatewayReadyField: "publishedSmokeReady",
      configuredGatewayProofSeparate: true
    });
    assert.equal(report.publicSafe, true);
    assert.equal(report.packageName, "lossless-openclaw-orchestrator");
    assert.equal(report.localVersion, packageJson.version);
    assert.equal(report.expectedDistTag, expectedDistTag(packageJson.version));
    assert.equal(report.expectedPackage, `lossless-openclaw-orchestrator@${expectedDistTag(packageJson.version)}`);
    assert.equal(report.registryVersion, packageJson.version);
    assert.equal(report.registryBetaVersion, null);
    assert.equal(report.versionMatchStatus, expectedVersionMatchStatus(packageJson.version));
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
    assert.match(report.proofBoundary, /ok\/packagePathOk are package-path claims/i);
    assert.match(report.proofBoundary, /publishedSmokeReady is the clean-profile gateway-ready claim/i);
    assert.match(report.proofBoundary, /does not run live Codex control/i);
    assert.equal(existsSync(join(evidenceDir, "published-package-smoke.json")), true);
    assert.doesNotMatch(result.stdout, /super-secret|\.sqlite\b|\.db\b|Bearer\s+/i);
    assert.doesNotMatch(readFileSync(join(evidenceDir, "published-package-smoke.json"), "utf8"), /super-secret|\.sqlite\b|\.db\b|Bearer\s+/i);

    const gatewayReadyResult = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "openclaw",
      "published-smoke",
      "--evidence-dir",
      evidenceDir,
      "--registry-version",
      packageJson.version,
      "--dogfood-report",
      dogfoodPath,
      "--tool-smoke-report",
      toolSmokePath,
      "--binary-probe-report",
      binaryProbePath,
      "--gateway-ready-strict"
    ], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(gatewayReadyResult.status, 1, gatewayReadyResult.stderr || gatewayReadyResult.stdout);
    const gatewayReadyReport = JSON.parse(gatewayReadyResult.stdout) as {
      ok: boolean;
      packagePathOk: boolean;
      publishedSmokeReady: boolean;
    };
    assert.equal(gatewayReadyReport.ok, true);
    assert.equal(gatewayReadyReport.packagePathOk, true);
    assert.equal(gatewayReadyReport.publishedSmokeReady, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("published-smoke accepts the canonical lossless-codex package root", () => {
  const dir = mkdtempSync(join(tmpdir(), "lco-published-smoke-canonical-"));
  try {
    const rootDir = join(dir, "package");
    const evidenceDir = join(dir, "evidence");
    const dogfoodPath = join(dir, "dogfood.json");
    const toolSmokePath = join(dir, "tool-smoke.json");
    const binaryProbePath = join(dir, "binary-probe.json");
    mkdirSync(rootDir, { recursive: true });
    writeValidBinaryProbe(binaryProbePath);
    writeJson(join(rootDir, "package.json"), {
      name: "lossless-codex-orchestrator",
      version: packageVersion
    });
    writeJson(dogfoodPath, {
      ok: true,
      dogfoodReady: true,
      requiredToolsPresent: true,
      installOutcome: { status: "installed" }
    });
    writeJson(toolSmokePath, {
      ok: true,
      toolSmokeReady: true,
      setupStatus: {
        classification: "ready",
        packageInstallLikelyOk: true
      },
      setupBlockers: [],
      catalog: { toolCount: 34 },
      invocations: [{ toolName: "lco_doctor", ok: true }]
    });

    const report = createPublishedPackageSmokeReport({
      rootDir,
      evidenceDir,
      registryVersion: packageVersion,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: toolSmokePath,
      binaryProbeReportPath: binaryProbePath,
      now: "2026-07-07T00:00:00.000Z"
    });

    assert.equal(report.ok, true, report.blockers.join(", "));
    assert.equal(report.packageName, "lossless-codex-orchestrator");
    assert.equal(report.expectedPackage, "lossless-codex-orchestrator@latest");
    assert.equal(report.versionMatchStatus, "matches_registry_latest");
    assert.deepEqual(report.blockers, []);
    assert.equal(existsSync(join(evidenceDir, "published-package-smoke.json")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("published-smoke rejects self-attested dogfood readiness without an acceptable install outcome", () => {
  const dir = mkdtempSync(join(tmpdir(), "lco-published-smoke-install-outcome-"));
  try {
    const rootDir = join(dir, "package");
    const dogfoodPath = join(dir, "dogfood.json");
    const toolSmokePath = join(dir, "tool-smoke.json");
    const binaryProbePath = join(dir, "binary-probe.json");
    mkdirSync(rootDir, { recursive: true });
    writeValidBinaryProbe(binaryProbePath);
    writeJson(join(rootDir, "package.json"), {
      name: "lossless-codex-orchestrator",
      version: packageVersion
    });
    writeJson(dogfoodPath, {
      ok: true,
      dogfoodReady: true,
      requiredToolsPresent: true,
      installOutcome: { status: "unknown" }
    });
    writeJson(toolSmokePath, {
      ok: true,
      toolSmokeReady: true,
      setupStatus: {
        classification: "ready",
        packageInstallLikelyOk: true
      },
      setupBlockers: [],
      catalog: { toolCount: 34 },
      invocations: [{ toolName: "lco_doctor", ok: true }]
    });

    const report = createPublishedPackageSmokeReport({
      rootDir,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: toolSmokePath,
      binaryProbeReportPath: binaryProbePath,
      now: "2026-07-07T00:00:00.000Z"
    });

    assert.equal(report.ok, false);
    assert.equal(report.packagePathOk, false);
    assert.deepEqual(report.blockers, ["openclaw_dogfood_install_outcome_unproven"]);
    assert.equal(report.setupRecovery.classification, "package_failure_or_unknown");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("published-smoke accepts install outcomes emitted by the OpenClaw dogfood producer", () => {
  const cases: Array<{
    name: string;
    installInput: Partial<Parameters<typeof createOpenClawDogfoodReport>[0]>;
    expectedStatus: string;
  }> = [
    {
      name: "installed",
      installInput: { installAttempted: true, installExitStatus: 0 },
      expectedStatus: "installed"
    },
    {
      name: "already-installed",
      installInput: {
        installAttempted: true,
        installExitStatus: 1,
        installStdout: "plugin already exists: lossless-openclaw-orchestrator"
      },
      expectedStatus: "already_installed"
    },
    {
      name: "link-force-unsupported",
      installInput: {
        installAttempted: true,
        installExitStatus: 1,
        installStderr: "error: --force is not supported with --link"
      },
      expectedStatus: "link_force_unsupported"
    }
  ];

  for (const fixture of cases) {
    const dir = mkdtempSync(join(tmpdir(), `lco-published-smoke-dogfood-contract-${fixture.name}-`));
    try {
      const rootDir = join(dir, "package");
      const dogfoodPath = join(dir, "dogfood.json");
      const toolSmokePath = join(dir, "tool-smoke.json");
      const binaryProbePath = join(dir, "binary-probe.json");
      mkdirSync(rootDir, { recursive: true });
      writeJson(join(rootDir, "package.json"), {
        name: "lossless-codex-orchestrator",
        version: packageVersion
      });
      writeValidBinaryProbe(binaryProbePath);
      writeReadyToolSmoke(toolSmokePath);
      const dogfoodReport = createOpenClawDogfoodReport({
        pluginListExitStatus: 0,
        pluginListStdout: JSON.stringify({
          plugins: [{
            id: "lossless-openclaw-orchestrator",
            enabled: true,
            status: "loaded",
            toolNames: [
              "loo_search_sessions",
              "loo_describe_session",
              "loo_expand_query",
              "loo_codex_control_dry_run"
            ]
          }]
        }),
        ...fixture.installInput
      });
      assert.equal(dogfoodReport.dogfoodReady, true);
      assert.equal(dogfoodReport.installOutcome.status, fixture.expectedStatus);
      writeJson(dogfoodPath, dogfoodReport);

      const report = createPublishedPackageSmokeReport({
        rootDir,
        dogfoodReportPath: dogfoodPath,
        toolSmokeReportPath: toolSmokePath,
        binaryProbeReportPath: binaryProbePath,
        now: "2026-07-07T00:00:00.000Z"
      });

      assert.equal(report.ok, true, `${fixture.name}: ${report.blockers.join(", ")}`);
      assert.equal(report.dogfood.installOutcomeStatus, fixture.expectedStatus);
      assert.equal(report.dogfood.dogfoodReady, true);
      assert.deepEqual(report.blockers, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("published-smoke requires public-safe candidate binary probe evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "lco-published-smoke-binary-required-"));
  try {
    const rootDir = join(dir, "package");
    const dogfoodPath = join(dir, "dogfood.json");
    const toolSmokePath = join(dir, "tool-smoke.json");
    mkdirSync(rootDir, { recursive: true });
    writeJson(join(rootDir, "package.json"), {
      name: "lossless-codex-orchestrator",
      version: packageVersion
    });
    writeJson(dogfoodPath, {
      ok: true,
      dogfoodReady: true,
      requiredToolsPresent: true,
      installOutcome: { status: "installed" }
    });
    writeJson(toolSmokePath, {
      ok: true,
      toolSmokeReady: true,
      setupStatus: {
        classification: "ready",
        packageInstallLikelyOk: true
      },
      setupBlockers: [],
      catalog: { toolCount: 34 },
      invocations: [{ toolName: "lco_doctor", ok: true }]
    });

    const report = createPublishedPackageSmokeReport({
      rootDir,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: toolSmokePath,
      now: "2026-07-07T00:00:00.000Z"
    });

    assert.equal(report.ok, false);
    assert.equal(report.packagePathOk, false);
    assert.equal(report.binaryProbeDiagnostic.provided, false);
    assert.equal(report.binaryProbeDiagnostic.classification, "not_provided");
    assert.deepEqual(report.blockers, ["binary_probe_missing"]);
    assert.ok(report.nextSafeCommands.some((command) => command.includes("--binary-probe-report")));
    assert.doesNotMatch(report.nextSafeCommands.join("\n"), /"<version>"/);
    const recoveryCommand = report.nextSafeCommands.find((command) => command.includes("binary_probe_report=") && command.includes("write-binary-probe.mjs"));
    const recoveryRerunCommand = report.nextSafeCommands.find((command) => command.includes("openclaw published-smoke") && command.includes("$LCO_EVIDENCE_DIR/binary-probe.json"));
    assert.equal(typeof recoveryCommand, "string");
    assert.equal(typeof recoveryRerunCommand, "string");
    assert.match(recoveryCommand, /^\(/);
    assert.match(recoveryCommand, /LCO_DOGFOOD_REPORT/);
    assert.match(recoveryCommand, /LCO_TOOL_SMOKE_REPORT/);
    assert.match(recoveryCommand, /LCO_EVIDENCE_DIR/);
    assert.match(recoveryRerunCommand, /--dogfood-report "\$LCO_DOGFOOD_REPORT"/);
    assert.match(recoveryRerunCommand, /--tool-smoke-report "\$LCO_TOOL_SMOKE_REPORT"/);
    assert.match(recoveryRerunCommand, /--evidence-dir "\$LCO_EVIDENCE_DIR"/);
    assert.doesNotMatch(recoveryCommand, /--dogfood-report dogfood\.json/);
    assert.doesNotMatch(recoveryCommand, /--tool-smoke-report tool-smoke\.json/);
    assert.match(recoveryCommand, /npm view lossless-codex-orchestrator@latest dist --json/);
    assert.match(recoveryCommand, /read-npm-dist\.mjs/);
    assert.match(recoveryCommand, /verify-tarball-integrity\.mjs/);
    assert.match(recoveryCommand, /createHash/);
    assert.match(recoveryCommand, /sha512/);
    assert.match(recoveryCommand, /\^sha512-/);
    assert.match(recoveryCommand, /tarball_url="\$\(cat "\$tmp_dir\/tarball-url\.txt"\)"/);
    assert.match(recoveryCommand, /integrity="\$\(cat "\$tmp_dir\/integrity\.txt"\)"/);
    assert.ok(recoveryCommand.indexOf("verify-tarball-integrity.mjs") < recoveryCommand.indexOf("tar -xzf"));
    assert.ok(recoveryCommand.indexOf("tar -xzf") < recoveryCommand.indexOf("test -f"));
    assert.match(recoveryCommand, /test -f "\$tmp_dir\/package\/package\.json"/);
    assert.ok(recoveryCommand.indexOf("tar -xzf") < recoveryCommand.indexOf("package.json"));
    assert.doesNotMatch(recoveryCommand, /dist\/packages\/cli\/src\/index\.js" --version/);
    assert.match(recoveryCommand, /node -pe "require\(process\.argv\.at\(-1\)\)\.version" "\$tmp_dir\/package\/package\.json"/);
    assert.match(recoveryCommand, /package_version=/);
    assert.match(recoveryCommand, /tarball_binary_version=/);
    assert.match(recoveryCommand, /resolved_binary_source="package_tarball"/);
    assert.match(recoveryCommand, /path_shadowed="false"/);
    assert.doesNotMatch(recoveryCommand, /command -v loo/);
    assert.doesNotMatch(recoveryCommand, /loo --version/);
    assert.doesNotMatch(recoveryCommand, /resolved_binary_source="package_exec"/);
    assert.doesNotMatch(recoveryCommand, /resolved_binary_source="global_path"/);
    assert.match(recoveryCommand, /JSON\.stringify/);
    assert.match(recoveryCommand, /tarballVersionSource/);
    assert.match(recoveryCommand, /package_json_metadata/);
    assert.match(recoveryCommand, /process\.argv\.at\(-1\)/);
    assert.match(recoveryCommand, /process\.argv\.slice\(2\)/);
    assert.match(recoveryCommand, /mkdir -p "\$evidence_dir"/);
    assert.match(recoveryCommand, /binary_probe_report="\$evidence_dir\/binary-probe\.json"/);
    assert.match(recoveryCommand, /printf '%s\\n'/);
    assert.match(recoveryCommand, /node "\$tmp_dir\/write-binary-probe\.mjs"/);
    assert.match(recoveryRerunCommand, /--binary-probe-report "\$LCO_EVIDENCE_DIR\/binary-probe\.json"/);
    assert.doesNotMatch(recoveryCommand, /node -e/);
    assert.doesNotMatch(recoveryCommand, /openclaw published-smoke/);
    assert.doesNotMatch(recoveryCommand, /&& loo openclaw published-smoke/);
    assert.doesNotMatch(recoveryCommand, /writeFileSync\('binary-probe\.json'/);
    assert.ok(recoveryCommand.includes("trap 'test -n \"${tmp_dir:-}\" && rm -rf \"$tmp_dir\"' EXIT"));
    assert.match(recoveryCommand, /tarballBinaryVersion/);
    assert.match(recoveryCommand, /tarballVersionSource/);
    assert.match(recoveryCommand, /tarball_binary_version="\$package_version"/);
    assert.match(recoveryCommand, /test -n "\$tarball_binary_version"/);
    assert.match(recoveryCommand, /test -n "\$package_version"/);
    assert.match(recoveryCommand, /test "\$tarball_binary_version" = "\$package_version"/);
    assert.match(recoveryCommand, /test -n "\$version"/);
    assert.match(recoveryCommand, /"\$binary_probe_report" .*"\$version" "\$package_version" "\$resolved_binary_source" "\$path_shadowed" "\$tarball_binary_version"/);
    assert.ok(recoveryCommand.includes(`'${packageVersion}'`));
    assert.ok(recoveryCommand.includes(packageVersion));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("published-smoke recovery tarball lookup follows beta and next dist tags", () => {
  for (const fixture of [
    { version: "1.4.4-beta.1", distTag: "beta" },
    { version: "1.4.4-rc.1", distTag: "next" }
  ]) {
    const dir = mkdtempSync(join(tmpdir(), `lco-published-smoke-recovery-${fixture.distTag}-`));
    try {
      const rootDir = join(dir, "package");
      const dogfoodPath = join(dir, "dogfood.json");
      const toolSmokePath = join(dir, "tool-smoke.json");
      mkdirSync(rootDir, { recursive: true });
      writeJson(join(rootDir, "package.json"), {
        name: "lossless-codex-orchestrator",
        version: fixture.version
      });
      writeJson(dogfoodPath, {
        ok: true,
        dogfoodReady: true,
        requiredToolsPresent: true,
        installOutcome: { status: "installed" }
      });
      writeReadyToolSmoke(toolSmokePath);

      const report = createPublishedPackageSmokeReport({
        rootDir,
        dogfoodReportPath: dogfoodPath,
        toolSmokeReportPath: toolSmokePath,
        now: "2026-07-07T00:00:00.000Z"
      });
      const recoveryCommand = report.nextSafeCommands.find((command) => command.includes("binary_probe_report=") && command.includes("write-binary-probe.mjs"));
      assert.equal(typeof recoveryCommand, "string", fixture.distTag);
      assert.match(recoveryCommand, new RegExp(`npm view lossless-codex-orchestrator@${fixture.distTag} dist --json`));
      assert.match(recoveryCommand, /verify-tarball-integrity\.mjs/);
      assert.match(recoveryCommand, /test -f "\$tmp_dir\/package\/package\.json"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("published-smoke requires tarball binary version for package-tarball candidate evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "lco-published-smoke-tarball-proof-"));
  try {
    const rootDir = join(dir, "package");
    const dogfoodPath = join(dir, "dogfood.json");
    const toolSmokePath = join(dir, "tool-smoke.json");
    const binaryProbePath = join(dir, "binary-probe.json");
    mkdirSync(rootDir, { recursive: true });
    writeJson(join(rootDir, "package.json"), {
      name: "lossless-codex-orchestrator",
      version: packageVersion
    });
    writeJson(dogfoodPath, {
      ok: true,
      dogfoodReady: true,
      requiredToolsPresent: true,
      installOutcome: { status: "installed" }
    });
    writeJson(toolSmokePath, {
      ok: true,
      toolSmokeReady: true,
      setupStatus: {
        classification: "ready",
        packageInstallLikelyOk: true
      },
      setupBlockers: [],
      catalog: { toolCount: 34 },
      invocations: [{ toolName: "lco_doctor", ok: true }]
    });
    writeJson(binaryProbePath, {
      kind: "loo_published_binary_probe_evidence",
      publicSafe: true,
      rawSecretIncluded: false,
      expectedVersion: packageVersion,
      observedVersion: packageVersion,
      resolvedBinarySource: "package_tarball",
      pathShadowed: false,
      packageJsonVersion: packageVersion
    });

    const missingTarballMarkerReport = createPublishedPackageSmokeReport({
      rootDir,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: toolSmokePath,
      binaryProbeReportPath: binaryProbePath,
      now: "2026-07-07T00:00:00.000Z"
    });

    assert.equal(missingTarballMarkerReport.ok, false);
    assert.equal(missingTarballMarkerReport.packagePathOk, false);
    assert.equal(missingTarballMarkerReport.binaryProbeDiagnostic.classification, "candidate_binary_version_mismatch");
    assert.equal(missingTarballMarkerReport.binaryProbeDiagnostic.tarballBinaryVersion, null);
    assert.deepEqual(missingTarballMarkerReport.blockers, ["binary_probe_candidate_version_mismatch"]);

    writeJson(binaryProbePath, {
      kind: "loo_published_binary_probe_evidence",
      publicSafe: true,
      rawSecretIncluded: false,
      expectedVersion: packageVersion,
      observedVersion: packageVersion,
      resolvedBinarySource: "package_tarball",
      pathShadowed: false,
      tarballBinaryVersion: packageVersion,
      packageJsonVersion: packageVersion
    });

    const missingTarballSourceReport = createPublishedPackageSmokeReport({
      rootDir,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: toolSmokePath,
      binaryProbeReportPath: binaryProbePath,
      now: "2026-07-07T00:00:00.000Z"
    });

    assert.equal(missingTarballSourceReport.ok, true);
    assert.equal(missingTarballSourceReport.packagePathOk, true);
    assert.equal(missingTarballSourceReport.binaryProbeDiagnostic.classification, "valid_candidate_binary");
    assert.equal(missingTarballSourceReport.binaryProbeDiagnostic.tarballBinaryVersion, packageVersion);
    assert.equal(missingTarballSourceReport.binaryProbeDiagnostic.tarballVersionSource, null);
    assert.doesNotMatch(JSON.stringify(missingTarballSourceReport.binaryProbeDiagnostic.evidenceInputs), /candidate_tarball_package_json_metadata/);

    writeJson(binaryProbePath, {
      kind: "loo_published_binary_probe_evidence",
      publicSafe: true,
      rawSecretIncluded: false,
      expectedVersion: packageVersion,
      observedVersion: packageVersion,
      resolvedBinarySource: "package_tarball",
      pathShadowed: false,
      tarballBinaryVersion: packageVersion,
      tarballVersionSource: "package_json_metadata",
      packageJsonVersion: packageVersion
    });

    const tarballMarkerReport = createPublishedPackageSmokeReport({
      rootDir,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: toolSmokePath,
      binaryProbeReportPath: binaryProbePath,
      now: "2026-07-07T00:00:00.000Z"
    });

    assert.equal(tarballMarkerReport.ok, true);
    assert.equal(tarballMarkerReport.packagePathOk, true);
    assert.equal(tarballMarkerReport.binaryProbeDiagnostic.classification, "valid_candidate_binary");
    assert.equal(tarballMarkerReport.binaryProbeDiagnostic.tarballBinaryVersion, packageVersion);
    assert.equal(tarballMarkerReport.binaryProbeDiagnostic.tarballVersionSource, "package_json_metadata");
    assert.ok(tarballMarkerReport.binaryProbeDiagnostic.guidance.some((item) => item.includes("package.json metadata")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo openclaw published-smoke --gateway-ready-strict exits zero when clean profile gateway is ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-published-smoke-gateway-ready-"));
  try {
    const evidenceDir = join(dir, "evidence");
    const dogfoodPath = join(dir, "dogfood.json");
    const toolSmokePath = join(dir, "tool-smoke.json");
    const binaryProbePath = join(dir, "binary-probe.json");
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    writeValidBinaryProbe(binaryProbePath, packageJson.version);
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
      installOutcome: { status: "installed", exitStatus: 0 }
    });
    writeJson(toolSmokePath, {
      ok: true,
      toolSmokeReady: true,
      publicSafe: true,
      catalog: {
        requiredToolsPresent: true,
        missingRequiredTools: [],
        toolCount: 30
      },
      setupBlockers: [],
      setupStatus: {
        classification: "ready",
        packageInstallLikelyOk: true,
        recoverable: false,
        retryAfterSetup: false,
        doesNotIndicatePackageFailure: true
      }
    });

    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "openclaw",
      "published-smoke",
      "--evidence-dir",
      evidenceDir,
      "--registry-version",
      packageJson.version,
      "--dogfood-report",
      dogfoodPath,
      "--tool-smoke-report",
      toolSmokePath,
      "--binary-probe-report",
      binaryProbePath,
      "--gateway-ready-strict"
    ], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      packagePathOk: boolean;
      publishedSmokeReady: boolean;
      setupRequired: boolean;
      setupRecovery: { classification: string; ready: boolean };
    };
    assert.equal(report.ok, true);
    assert.equal(report.packagePathOk, true);
    assert.equal(report.publishedSmokeReady, true);
    assert.equal(report.setupRequired, false);
    assert.equal(report.setupRecovery.classification, "ready");
    assert.equal(report.setupRecovery.ready, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("published-smoke rejects legacy beta registry evidence for non-beta candidates", { skip: expectedDistTag(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version) === "beta" ? "legacy beta evidence is valid on beta candidates" : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-published-smoke-legacy-beta-"));
  try {
    const evidenceDir = join(dir, "evidence");
    const dogfoodPath = join(dir, "dogfood.json");
    const toolSmokePath = join(dir, "tool-smoke.json");
    const binaryProbePath = join(dir, "binary-probe.json");
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    writeValidBinaryProbe(binaryProbePath, packageJson.version);
    writeJson(dogfoodPath, {
      ok: true,
      dogfoodReady: true,
      publicSafe: true,
      targetPlugin: { id: "lossless-openclaw-orchestrator", enabled: true, loaded: true, toolCount: 30 },
      requiredToolsPresent: true,
      missingRequiredTools: [],
      blockers: [],
      installAttempted: true,
      installOutcome: { status: "installed", exitStatus: 0 }
    });
    writeJson(toolSmokePath, {
      ok: true,
      toolSmokeReady: true,
      publicSafe: true,
      catalog: {
        requiredToolsPresent: true,
        missingRequiredTools: [],
        toolCount: 30
      },
      setupBlockers: [],
      setupStatus: {
        classification: "ready",
        packageInstallLikelyOk: true,
        recoverable: false,
        retryAfterSetup: false,
        doesNotIndicatePackageFailure: true
      }
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
      "--binary-probe-report",
      binaryProbePath,
      "--strict"
    ], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      expectedDistTag: string;
      registryVersion: string | null;
      registryBetaVersion: string | null;
      versionMatchStatus: string;
      blockers: string[];
    };
    assert.equal(report.ok, false);
    assert.notEqual(report.expectedDistTag, "beta");
    assert.equal(report.registryVersion, packageJson.version);
    assert.equal(report.registryBetaVersion, packageJson.version);
    assert.equal(report.versionMatchStatus, expectedMismatchStatus(packageJson.version));
    assert.deepEqual(report.blockers, [`registry_${expectedDistTag(packageJson.version)}_version_mismatch`]);
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
    const binaryProbePath = join(dir, "binary-probe.json");
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    writeValidBinaryProbe(binaryProbePath, packageJson.version);
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
      "--registry-version",
      packageJson.version,
      "--dogfood-report",
      dogfoodPath,
      "--tool-smoke-report",
      toolSmokePath,
      "--configured-tool-smoke-report",
      configuredToolSmokePath,
      "--binary-probe-report",
      binaryProbePath,
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
      readinessSemantics: { configuredGatewayProofSeparate: boolean };
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
    assert.equal(report.readinessSemantics.configuredGatewayProofSeparate, true);
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
    const binaryProbePath = join(dir, "binary-probe.json");
    const fakeNpmTokenCanary = `npm_${"a".repeat(24)}`;
    writeValidBinaryProbe(binaryProbePath);
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
        toolSmokeReportPath: toolSmokePath,
        binaryProbeReportPath: binaryProbePath
      });

      assert.equal(report.ok, true);
      assert.equal(Object.isFrozen(report.readinessSemantics), true);
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
      toolSmokeReportPath: multiBlockerToolSmokePath,
      binaryProbeReportPath: binaryProbePath
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
      toolSmokeReportPath: readyToolSmokePath,
      binaryProbeReportPath: binaryProbePath
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
      toolSmokeReportPath: readyUnknownToolSmokePath,
      binaryProbeReportPath: binaryProbePath
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
      toolSmokeReportPath: readyToolSmokePath,
      binaryProbeReportPath: binaryProbePath
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
      toolSmokeReportPath: packageFailureToolSmokePath,
      binaryProbeReportPath: binaryProbePath
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
      toolSmokeReportPath: packageFailurePrecedenceToolSmokePath,
      binaryProbeReportPath: binaryProbePath
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

test("published-smoke records npm selector drift with installable tarball fallback as package-safe evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-published-smoke-selector-drift-"));
  try {
    const dogfoodPath = join(dir, "dogfood.json");
    const toolSmokePath = join(dir, "tool-smoke.json");
    const npmInstallDiagnosticPath = join(dir, "npm-install-diagnostic.json");
    const binaryProbePath = join(dir, "binary-probe.json");
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    writeValidBinaryProbe(binaryProbePath, packageJson.version);
    writeJson(dogfoodPath, {
      ok: true,
      dogfoodReady: true,
      publicSafe: true,
      targetPlugin: { id: "lossless-openclaw-orchestrator", enabled: true, loaded: true, toolCount: 30 },
      requiredToolsPresent: true,
      missingRequiredTools: [],
      blockers: [],
      installAttempted: true,
      installOutcome: { status: "installed", exitStatus: 0, guidance: "tarball fallback used after selector drift" },
      private: "raw npm error code ENOVERSIONS /Users/lume/.npmrc npm_secret_should_not_leak"
    });
    writeJson(toolSmokePath, {
      ok: true,
      toolSmokeReady: true,
      publicSafe: true,
      catalog: { requiredToolsPresent: true, missingRequiredTools: [], toolCount: 30 },
      setupBlockers: [],
      setupStatus: {
        classification: "ready",
        packageInstallLikelyOk: true,
        recoverable: false,
        retryAfterSetup: false,
        doesNotIndicatePackageFailure: true
      }
    });
    writeJson(npmInstallDiagnosticPath, {
      code: "npm_selector_cutoff_drift",
      publicSafe: true,
      summary: "npm selector failed with ENOVERSIONS while registry metadata exposed the package tarball.",
      suggestedRetry: `npm install https://registry.npmjs.org/lossless-openclaw-orchestrator/-/lossless-openclaw-orchestrator-${packageJson.version}.tgz`,
      trueUnpublishedVersion: false,
      rawSecretIncluded: false,
      registryTarballVisible: true,
      tarballFallbackInstallOk: true
    });

    const report = createPublishedPackageSmokeReport({
      rootDir: new URL("..", import.meta.url).pathname,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: toolSmokePath,
      npmInstallDiagnosticReportPath: npmInstallDiagnosticPath,
      binaryProbeReportPath: binaryProbePath
    });

    assert.equal(report.ok, true);
    assert.equal(report.packagePathOk, true);
    assert.equal(report.publishedSmokeReady, true);
    assert.equal(report.npmInstallDiagnostic.provided, true);
    assert.equal(report.npmInstallDiagnostic.classification, "npm_selector_drift_with_tarball_fallback");
    assert.equal(report.npmInstallDiagnostic.packageInstallLikelyOk, true);
    assert.equal(report.npmInstallDiagnostic.tarballFallbackInstallable, true);
    assert.equal(report.npmInstallDiagnostic.trueUnpublishedVersion, false);
    assert.ok(report.npmInstallDiagnostic.guidance.some((item) => item.includes("registry tarball fallback")));
    assert.ok(report.setupRecovery.guidance.some((item) => item.includes("npm selector drift")));
    assert.ok(report.setupRecovery.nextSafeCommands.some((command) => command.includes("npm view lossless-openclaw-orchestrator@")));
    assert.ok(report.nextSafeCommands.some((command) => command.includes("npm install -g \"$tarball_url\"")));
    assert.doesNotMatch(JSON.stringify(report), /raw npm error|ENOVERSIONS \/Users\/lume|npm_secret_should_not_leak|\.npmrc/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("published-smoke blocks global loo PATH shadowing even with tarball metadata evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-published-smoke-path-shadow-"));
  try {
    const dogfoodPath = join(dir, "dogfood.json");
    const toolSmokePath = join(dir, "tool-smoke.json");
    const binaryProbePath = join(dir, "binary-probe.json");
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    writeJson(dogfoodPath, {
      ok: true,
      dogfoodReady: true,
      publicSafe: true,
      targetPlugin: { id: "lossless-openclaw-orchestrator", enabled: true, loaded: true, toolCount: 30 },
      requiredToolsPresent: true,
      missingRequiredTools: [],
      blockers: [],
      installAttempted: true,
      installOutcome: { status: "installed", exitStatus: 0 },
      private: "/opt/homebrew/bin/loo reported an old version with raw npm output"
    });
    writeJson(toolSmokePath, {
      ok: true,
      toolSmokeReady: true,
      publicSafe: true,
      catalog: { requiredToolsPresent: true, missingRequiredTools: [], toolCount: 30 },
      setupBlockers: [],
      setupStatus: {
        classification: "ready",
        packageInstallLikelyOk: true,
        recoverable: false,
        retryAfterSetup: false,
        doesNotIndicatePackageFailure: true
      }
    });
    writeJson(binaryProbePath, {
      kind: "loo_published_binary_probe_evidence",
      publicSafe: true,
      rawSecretIncluded: false,
      expectedPackage: "lossless-openclaw-orchestrator",
      expectedVersion: packageJson.version,
      observedVersion: "1.2.6",
      resolvedBinarySource: "global_path",
      pathShadowed: true,
      tarballBinaryVersion: packageJson.version,
      tarballVersionSource: "package_json_metadata",
      packageJsonVersion: packageJson.version,
      rawPath: "/opt/homebrew/bin/loo",
      rawOutput: "private shell output should not leak"
    });

    const report = createPublishedPackageSmokeReport({
      rootDir: new URL("..", import.meta.url).pathname,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: toolSmokePath,
      binaryProbeReportPath: binaryProbePath
    });

    assert.equal(report.ok, false);
    assert.equal(report.packagePathOk, false);
    assert.equal(report.publishedSmokeReady, false);
    assert.equal(report.binaryProbeDiagnostic.provided, true);
    assert.equal(report.binaryProbeDiagnostic.classification, "smoke_harness_path_shadow");
    assert.equal(report.binaryProbeDiagnostic.packageInstallLikelyOk, false);
    assert.equal(report.binaryProbeDiagnostic.observedVersion, "1.2.6");
    assert.equal(report.binaryProbeDiagnostic.packageVersion, packageJson.version);
    assert.equal(report.binaryProbeDiagnostic.tarballBinaryVersion, packageJson.version);
    assert.equal(report.binaryProbeDiagnostic.tarballVersionSource, "package_json_metadata");
    assert.equal(report.binaryProbeDiagnostic.resolvedBinarySource, "global_path");
    assert.deepEqual(report.blockers, ["binary_probe_path_shadow"]);
    assert.ok(report.binaryProbeDiagnostic.guidance.some((item) => item.includes("PATH shadowing")));
    assert.ok(report.nextSafeCommands.some((command) => command.includes("npm view lossless-openclaw-orchestrator@")));
    assert.ok(report.nextSafeCommands.some((command) => command.includes("trap 'test -n \"${tmp_dir:-}\" && rm -rf \"$tmp_dir\"' EXIT")));
    assert.doesNotMatch(JSON.stringify(report), /\/opt\/homebrew|private shell output|old version with raw npm output/i);

    writeJson(binaryProbePath, {
      kind: "loo_published_binary_probe_evidence",
      publicSafe: true,
      rawSecretIncluded: false,
      expectedPackage: "lossless-openclaw-orchestrator",
      expectedVersion: packageJson.version,
      observedVersion: "1.2.6",
      resolvedBinarySource: "global_path",
      pathShadowed: true,
      packageJsonVersion: packageJson.version
    });
    const selfAttestedReport = createPublishedPackageSmokeReport({
      rootDir: new URL("..", import.meta.url).pathname,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: toolSmokePath,
      binaryProbeReportPath: binaryProbePath
    });
    assert.equal(selfAttestedReport.ok, false);
    assert.equal(selfAttestedReport.packagePathOk, false);
    assert.equal(selfAttestedReport.binaryProbeDiagnostic.classification, "candidate_binary_version_mismatch");
    assert.equal(selfAttestedReport.binaryProbeDiagnostic.packageInstallLikelyOk, false);
    assert.equal(selfAttestedReport.binaryProbeDiagnostic.tarballBinaryVersion, null);
    assert.deepEqual(selfAttestedReport.blockers, ["binary_probe_candidate_version_mismatch"]);

    writeJson(binaryProbePath, {
      kind: "loo_published_binary_probe_evidence",
      publicSafe: true,
      rawSecretIncluded: false,
      expectedPackage: "lossless-openclaw-orchestrator",
      expectedVersion: packageJson.version,
      observedVersion: "1.2.6",
      resolvedBinarySource: "global_path",
      pathShadowed: true,
      tarballBinaryVersion: "1.2.6",
      packageJsonVersion: packageJson.version,
      rawPath: "/opt/homebrew/bin/loo",
      rawOutput: "private shell output should not leak"
    });
    const mismatchedTarballReport = createPublishedPackageSmokeReport({
      rootDir: new URL("..", import.meta.url).pathname,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: toolSmokePath,
      binaryProbeReportPath: binaryProbePath
    });
    assert.equal(mismatchedTarballReport.ok, false);
    assert.equal(mismatchedTarballReport.packagePathOk, false);
    assert.equal(mismatchedTarballReport.binaryProbeDiagnostic.classification, "candidate_binary_version_mismatch");
    assert.equal(mismatchedTarballReport.binaryProbeDiagnostic.packageInstallLikelyOk, false);
    assert.equal(mismatchedTarballReport.binaryProbeDiagnostic.tarballBinaryVersion, "1.2.6");
    assert.deepEqual(mismatchedTarballReport.blockers, ["binary_probe_candidate_version_mismatch"]);
    assert.doesNotMatch(JSON.stringify(mismatchedTarballReport), /\/opt\/homebrew|private shell output/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("published-smoke keeps package failure classification when selector drift lacks tarball fallback proof", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-published-smoke-selector-drift-unproved-"));
  try {
    const dogfoodPath = join(dir, "dogfood.json");
    const toolSmokePath = join(dir, "tool-smoke.json");
    const npmInstallDiagnosticPath = join(dir, "npm-install-diagnostic.json");
    const binaryProbePath = join(dir, "binary-probe.json");
    writeValidBinaryProbe(binaryProbePath);
    writeJson(dogfoodPath, {
      ok: false,
      dogfoodReady: false,
      publicSafe: true,
      targetPlugin: null,
      requiredToolsPresent: false,
      missingRequiredTools: ["loo_doctor"],
      blockers: ["openclaw_plugin_install_failed"],
      installAttempted: true,
      installOutcome: { status: "failed", exitStatus: 1 }
    });
    writeJson(toolSmokePath, {
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
    writeJson(npmInstallDiagnosticPath, {
      code: "npm_selector_cutoff_drift",
      publicSafe: true,
      summary: "npm selector failed, but no public-safe tarball install proof was supplied.",
      suggestedRetry: "npm view lossless-openclaw-orchestrator@beta dist.tarball --json",
      trueUnpublishedVersion: false,
      rawSecretIncluded: false,
      registryTarballVisible: true,
      tarballFallbackInstallOk: false
    });

    const report = createPublishedPackageSmokeReport({
      rootDir: new URL("..", import.meta.url).pathname,
      dogfoodReportPath: dogfoodPath,
      toolSmokeReportPath: toolSmokePath,
      npmInstallDiagnosticReportPath: npmInstallDiagnosticPath,
      binaryProbeReportPath: binaryProbePath
    });

    assert.equal(report.ok, false);
    assert.equal(report.packagePathOk, false);
    assert.equal(report.publishedSmokeReady, false);
    assert.equal(report.npmInstallDiagnostic.provided, true);
    assert.equal(report.npmInstallDiagnostic.classification, "npm_selector_drift_unproved");
    assert.equal(report.npmInstallDiagnostic.packageInstallLikelyOk, false);
    assert.equal(report.setupRecovery.classification, "package_failure_or_unknown");
    assert.equal(report.setupRecovery.packageInstallLikelyOk, false);
    assert.ok(report.setupRecovery.guidance.some((item) => item.includes("possible package or plugin defect")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
