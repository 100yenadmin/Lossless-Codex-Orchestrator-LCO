import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type DistTag, type RegistryVersionMatchStatus, distTagForVersion, matchingRegistryStatus, mismatchedRegistryStatus } from "./dist-tag.js";
import { SUPPORTED_PACKAGE_NAMES, findSupportedPackageRoot, isSupportedPackageName, packageNameForRoot } from "./package-identity.js";

export type PublishedPackageSmokeOptions = {
  evidenceDir?: string;
  rootDir?: string;
  now?: string;
  registryVersion?: string;
  registryBetaVersion?: string;
  dogfoodReportPath: string;
  toolSmokeReportPath: string;
  configuredToolSmokeReportPath?: string;
  npmInstallDiagnosticReportPath?: string;
  binaryProbeReportPath?: string;
};

export type PublishedPackageSmokeReport = {
  ok: boolean;
  publishedSmokeReady: boolean;
  packagePathOk: boolean;
  readinessSemantics: Readonly<{
    okField: "packagePathOk";
    strictModeExitsOn: "packagePathOk_false";
    gatewayReadyStrictExitsOn: "publishedSmokeReady_false";
    cleanProfileGatewayReadyField: "publishedSmokeReady";
    configuredGatewayProofSeparate: true;
  }>;
  publicSafe: true;
  localOnly: true;
  dryRun: true;
  generatedAt: string;
  packageName: string;
  localVersion: string;
  expectedDistTag: DistTag;
  expectedPackage: string;
  registryVersion: string | null;
  registryBetaVersion: string | null;
  versionMatchStatus: RegistryVersionMatchStatus;
  dogfood: {
    dogfoodReady: boolean;
    installOutcomeStatus: string;
    requiredToolsPresent: boolean;
  };
  toolSmoke: {
    toolSmokeReady: boolean;
    gatewaySetupClassification: "ready" | "gateway_setup_required" | "gateway_blocked" | "unknown";
    packageInstallLikelyOk: boolean;
  };
  configuredGateway: {
    provided: boolean;
    toolSmokeReady: boolean;
    gatewaySetupClassification: "ready" | "gateway_setup_required" | "gateway_blocked" | "unknown";
    packageInstallLikelyOk: boolean;
    toolCount: number;
    invokedTools: string[];
  };
  setupRequired: boolean;
  setupBlockers: string[];
  setupRecovery: {
    cleanProfile: "lco-dogfood-published";
    classification:
      | "ready"
      | "credential_required"
      | "device_pairing_required"
      | "scope_upgrade_required"
      | "token_rotation_required"
      | "setup_required"
      | "package_failure_or_unknown";
    ready: boolean;
    packageInstallLikelyOk: boolean;
    retryAfterSetup: boolean;
    configuredGatewayProofSeparate: true;
    requiredSetup: string[];
    nextSafeCommands: string[];
    guidance: string[];
    readinessProof: {
      required: boolean;
      satisfied: boolean;
      command: string;
      evidence: string[];
    };
  };
  npmInstallDiagnostic: {
    provided: boolean;
    classification:
      | "not_provided"
      | "invalid"
      | "npm_selector_drift_with_tarball_fallback"
      | "npm_selector_drift_unproved"
      | "npm_before_cutoff_drift"
      | "npm_version_unavailable"
      | "npm_install_failed";
    packageInstallLikelyOk: boolean;
    registryTarballVisible: boolean;
    tarballFallbackInstallable: boolean;
    trueUnpublishedVersion: boolean;
    suggestedRetry: string | null;
    evidenceInputs: string[];
    guidance: string[];
  };
  binaryProbeDiagnostic: {
    provided: boolean;
    classification:
      | "not_provided"
      | "valid_candidate_binary"
      | "smoke_harness_path_shadow"
      | "candidate_binary_version_mismatch"
      | "invalid";
    packageInstallLikelyOk: boolean;
    resolvedBinarySource: "package_tarball" | "package_exec" | "global_path" | "unknown";
    observedVersion: string | null;
    packageVersion: string;
    tarballBinaryVersion: string | null;
    evidenceInputs: string[];
    guidance: string[];
  };
  blockers: string[];
  nextSafeCommands: string[];
  actionsPerformed: {
    npmPublished: false;
    githubReleaseCreated: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
};

const READINESS_SEMANTICS = Object.freeze({
  okField: "packagePathOk",
  strictModeExitsOn: "packagePathOk_false",
  gatewayReadyStrictExitsOn: "publishedSmokeReady_false",
  cleanProfileGatewayReadyField: "publishedSmokeReady",
  configuredGatewayProofSeparate: true
} as const);

export function createPublishedPackageSmokeReport(options: PublishedPackageSmokeOptions): PublishedPackageSmokeReport {
  const rootDir = options.rootDir
    ? resolve(options.rootDir)
    : findSupportedPackageRoot(dirname(fileURLToPath(import.meta.url))) ?? process.cwd();
  const packageJson = readPackageJson(rootDir);
  const packageName = packageNameForRoot(rootDir);
  const expectedDistTag = distTagForVersion(packageJson.version);
  const expectedPackage = `${packageName}@${expectedDistTag}`;
  const dogfood = readJsonObject(options.dogfoodReportPath);
  const toolSmoke = readJsonObject(options.toolSmokeReportPath);
  const configuredToolSmoke = options.configuredToolSmokeReportPath ? readJsonObject(options.configuredToolSmokeReportPath) : null;
  const dogfoodReady = dogfood.ok === true && dogfood.dogfoodReady === true;
  const requiredToolsPresent = dogfood.requiredToolsPresent === true;
  const installOutcomeStatus = readNestedString(dogfood, ["installOutcome", "status"]) || "unknown";
  const installOutcomeProven = isAcceptableDogfoodInstallOutcome(installOutcomeStatus);
  const toolSmokeReady = toolSmoke.ok === true && toolSmoke.toolSmokeReady === true;
  const gatewaySetupClassification = readGatewaySetupClassification(toolSmoke);
  const packageInstallLikelyOk = readNestedBoolean(toolSmoke, ["setupStatus", "packageInstallLikelyOk"]);
  const configuredGateway = configuredToolSmoke ? {
    provided: true,
    toolSmokeReady: configuredToolSmoke.ok === true && configuredToolSmoke.toolSmokeReady === true,
    gatewaySetupClassification: readGatewaySetupClassification(configuredToolSmoke),
    packageInstallLikelyOk: readNestedBoolean(configuredToolSmoke, ["setupStatus", "packageInstallLikelyOk"]),
    toolCount: readNestedNumber(configuredToolSmoke, ["catalog", "toolCount"]),
    invokedTools: readInvokedTools(configuredToolSmoke)
  } : {
    provided: false,
    toolSmokeReady: false,
    gatewaySetupClassification: "unknown" as const,
    packageInstallLikelyOk: false,
    toolCount: 0,
    invokedTools: []
  };
  const setupBlockers = readStringArray(toolSmoke.setupBlockers);
  const setupRequired = gatewaySetupClassification === "gateway_setup_required";
  const registryVersion = options.registryVersion ?? options.registryBetaVersion;
  const registryEvidenceDistTag = options.registryVersion
    ? expectedDistTag
    : options.registryBetaVersion
      ? "beta"
      : null;
  const versionMatchStatus = registryVersion
    ? registryVersion === packageJson.version && registryEvidenceDistTag === expectedDistTag
      ? matchingRegistryStatus(expectedDistTag)
      : mismatchedRegistryStatus(expectedDistTag)
    : "not_run";
  const binaryProbeDiagnostic = readBinaryProbeDiagnostic(options.binaryProbeReportPath, packageJson.version);
  const blockers = [
    ...(isSupportedPackageName(packageJson.name) ? [] : ["package_name_mismatch"]),
    ...(versionMatchStatus.endsWith("_mismatch") ? [`registry_${expectedDistTag}_version_mismatch`] : []),
    ...(dogfoodReady ? [] : ["openclaw_dogfood_not_ready"]),
    ...(installOutcomeProven ? [] : ["openclaw_dogfood_install_outcome_unproven"]),
    ...(requiredToolsPresent ? [] : ["openclaw_required_tools_missing"]),
    ...(!toolSmokeReady && !setupRequired ? ["openclaw_tool_smoke_not_ready"] : []),
    ...(setupRequired && !packageInstallLikelyOk ? ["openclaw_gateway_setup_not_package_safe"] : []),
    ...binaryProbeBlockers(binaryProbeDiagnostic)
  ];
  const packagePathOk = blockers.length === 0;
  const npmInstallDiagnostic = readNpmInstallDiagnostic(options.npmInstallDiagnosticReportPath);
  const setupRecovery = buildSetupRecovery({
    expectedPackage,
    toolSmokeReady,
    gatewaySetupClassification,
    packageInstallLikelyOk,
    packagePathOk,
    setupBlockers,
    npmInstallDiagnostic
  });
  const report: PublishedPackageSmokeReport = {
    ok: packagePathOk,
    publishedSmokeReady: packagePathOk && toolSmokeReady,
    packagePathOk,
    readinessSemantics: READINESS_SEMANTICS,
    publicSafe: true,
    localOnly: true,
    dryRun: true,
    generatedAt: options.now ?? new Date().toISOString(),
    packageName: packageJson.name,
    localVersion: packageJson.version,
    expectedDistTag,
    expectedPackage,
    registryVersion: registryVersion ?? null,
    registryBetaVersion: options.registryBetaVersion ?? null,
    versionMatchStatus,
    dogfood: {
      dogfoodReady,
      installOutcomeStatus,
      requiredToolsPresent
    },
    toolSmoke: {
      toolSmokeReady,
      gatewaySetupClassification,
      packageInstallLikelyOk
    },
    configuredGateway,
    setupRequired,
    setupBlockers,
    setupRecovery,
    npmInstallDiagnostic,
    binaryProbeDiagnostic,
    blockers,
    nextSafeCommands: uniqueStrings([
      ...npmInstallDiagnosticCommands(expectedPackage, npmInstallDiagnostic),
      ...binaryProbeDiagnosticCommands(expectedPackage, packageJson.version, binaryProbeDiagnostic),
      `npm view ${expectedPackage} version dist-tags --json`,
      `loo openclaw dogfood --profile lco-dogfood-published --install-source ${expectedPackage} --required-tool loo_doctor --required-tool loo_search_sessions --strict`,
      "loo openclaw tool-smoke --profile lco-dogfood-published --required-tool loo_doctor --required-tool loo_search_sessions --strict",
      "loo openclaw tool-smoke --profile lco-dogfood --required-tool loo_doctor --required-tool loo_search_sessions --strict",
      `loo onboard status --registry-version <version> --gateway-setup-status ready --strict`
    ]),
    actionsPerformed: {
      npmPublished: false,
      githubReleaseCreated: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false
    },
    privateDataExclusions: [
      "raw npm stdout/stderr",
      "raw OpenClaw gateway output",
      "raw Codex transcripts",
      "raw prompts or message text",
      "tokens, credentials, API keys, cookies",
      "private customer data"
    ],
    proofBoundary: `This published package smoke report summarizes public-safe ${expectedDistTag} install and gateway setup evidence only. ok/packagePathOk are package-path claims; publishedSmokeReady is the clean-profile gateway-ready claim. This command does not run live Codex control, mutate a desktop GUI, publish npm, create a GitHub Release, store raw npm output, or store raw OpenClaw gateway output.`
  };
  if (options.evidenceDir) writePublishedPackageSmokeReport(report, options.evidenceDir);
  return report;
}

function isAcceptableDogfoodInstallOutcome(status: string): boolean {
  return status === "installed" || status === "already_installed" || status === "link_force_unsupported";
}

export function writePublishedPackageSmokeReport(report: PublishedPackageSmokeReport, evidenceDir: string): string {
  mkdirSync(evidenceDir, { recursive: true });
  const outputPath = join(evidenceDir, "published-package-smoke.json");
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return outputPath;
}

function buildSetupRecovery(input: {
  expectedPackage: string;
  toolSmokeReady: boolean;
  gatewaySetupClassification: PublishedPackageSmokeReport["toolSmoke"]["gatewaySetupClassification"];
  packageInstallLikelyOk: boolean;
  packagePathOk: boolean;
  setupBlockers: string[];
  npmInstallDiagnostic: PublishedPackageSmokeReport["npmInstallDiagnostic"];
}): PublishedPackageSmokeReport["setupRecovery"] {
  const classification = setupRecoveryClassification(input);
  const cleanProfile = "lco-dogfood-published";
  const toolSmokeCommand = `loo openclaw tool-smoke --profile ${cleanProfile} --required-tool loo_doctor --required-tool loo_search_sessions --strict`;
  const nextSafeCommands = uniqueStrings([
    ...npmInstallDiagnosticCommands(input.expectedPackage, input.npmInstallDiagnostic),
    ...setupRecoveryCommands(classification, toolSmokeCommand, input.setupBlockers)
  ]);
  return {
    cleanProfile,
    classification,
    ready: classification === "ready",
    packageInstallLikelyOk: input.packagePathOk && input.packageInstallLikelyOk,
    retryAfterSetup: classification !== "ready" && classification !== "package_failure_or_unknown",
    configuredGatewayProofSeparate: true,
    requiredSetup: setupRecoveryRequiredSetup(classification, input.setupBlockers),
    nextSafeCommands,
    guidance: setupRecoveryGuidance(classification, input.setupBlockers, input.npmInstallDiagnostic),
    readinessProof: {
      required: classification !== "ready",
      satisfied: classification === "ready",
      command: toolSmokeCommand,
      evidence: classification === "ready" ? ["fresh_profile_tool_smoke_ready"] : []
    }
  };
}

function setupRecoveryClassification(input: {
  toolSmokeReady: boolean;
  gatewaySetupClassification: PublishedPackageSmokeReport["toolSmoke"]["gatewaySetupClassification"];
  packageInstallLikelyOk: boolean;
  packagePathOk: boolean;
  setupBlockers: string[];
}): PublishedPackageSmokeReport["setupRecovery"]["classification"] {
  if (!input.packagePathOk) return "package_failure_or_unknown";
  if (input.toolSmokeReady && input.packageInstallLikelyOk && input.gatewaySetupClassification !== "gateway_blocked") return "ready";
  if (!input.packageInstallLikelyOk || input.gatewaySetupClassification === "gateway_blocked") return "package_failure_or_unknown";
  if (input.setupBlockers.includes("fresh_profile_gateway_credentials_required")) return "credential_required";
  if (input.setupBlockers.includes("openclaw_device_identity_pairing_required")) return "device_pairing_required";
  if (input.setupBlockers.includes("openclaw_gateway_scope_approval_required")) return "scope_upgrade_required";
  if (input.setupBlockers.includes("openclaw_gateway_token_rotation_required")) return "token_rotation_required";
  if (input.gatewaySetupClassification === "gateway_setup_required") return "setup_required";
  return "package_failure_or_unknown";
}

function setupRecoveryCommands(
  classification: PublishedPackageSmokeReport["setupRecovery"]["classification"],
  toolSmokeCommand: string,
  setupBlockers: string[]
): string[] {
  if (classification === "ready") return [toolSmokeCommand];
  if (classification === "package_failure_or_unknown") {
    return [
      "Inspect package install and OpenClaw plugin load locally without copying raw stdout/stderr into public evidence.",
      toolSmokeCommand
    ];
  }
  const commands = setupBlockerRecoveryItems(setupBlockers).flatMap((item) => item.commands);
  if (commands.length > 0) return uniqueStrings([...commands, toolSmokeCommand]);
  if (classification === "setup_required") return [toolSmokeCommand];
  return [toolSmokeCommand];
}

function setupRecoveryRequiredSetup(
  classification: PublishedPackageSmokeReport["setupRecovery"]["classification"],
  setupBlockers: string[]
): string[] {
  if (classification === "ready" || classification === "package_failure_or_unknown") return [];
  const requiredSetup = setupBlockerRecoveryItems(setupBlockers).map((item) => item.requiredSetup);
  if (requiredSetup.length > 0) return uniqueStrings(requiredSetup);
  return ["gateway_setup"];
}

function setupRecoveryGuidance(
  classification: PublishedPackageSmokeReport["setupRecovery"]["classification"],
  setupBlockers: string[],
  npmInstallDiagnostic: PublishedPackageSmokeReport["npmInstallDiagnostic"]
): string[] {
  const npmGuidance = npmInstallDiagnostic.guidance;
  if (classification === "ready") {
    return uniqueStrings([
      ...npmGuidance,
      "Fresh profile gateway tool-smoke is ready; this is the only state that may support a clean-profile gateway-ready claim."
    ]);
  }
  const guidance = setupBlockerRecoveryItems(setupBlockers).map((item) => item.guidance);
  if (guidance.length > 0 && classification !== "package_failure_or_unknown") return uniqueStrings([...npmGuidance, ...guidance]);
  if (classification === "setup_required") return uniqueStrings([...npmGuidance, "Resolve the named setup blockers and rerun fresh-profile tool-smoke before reporting readiness."]);
  return uniqueStrings([...npmGuidance, "Treat this as a possible package or plugin defect until install/load evidence proves otherwise."]);
}

function npmInstallDiagnosticCommands(
  expectedPackage: string,
  diagnostic: PublishedPackageSmokeReport["npmInstallDiagnostic"]
): string[] {
  if (diagnostic.classification !== "npm_selector_drift_with_tarball_fallback") return [];
  const tarballLookup = `npm view ${expectedPackage} dist.tarball`;
  return [
    `${tarballLookup} --json`,
    `tarball_url="$(${tarballLookup})" && test -n "$tarball_url" && npm install -g "$tarball_url"`
  ];
}

function binaryProbeDiagnosticCommands(
  expectedPackage: string,
  packageVersion: string,
  diagnostic: PublishedPackageSmokeReport["binaryProbeDiagnostic"]
): string[] {
  const tarballLookup = `npm view ${expectedPackage} dist.tarball`;
  const tarballExtractPrefix = publishedPackageTarballExtractCommand(expectedPackage);
  if (diagnostic.classification === "not_provided") {
    const binaryProbePath = "$LCO_EVIDENCE_DIR/binary-probe.json";
    return [
      `${tarballLookup} --json`,
      recoverySubshellCommand(`dogfood_report="\${LCO_DOGFOOD_REPORT:?set LCO_DOGFOOD_REPORT to a fresh dogfood report path}" && tool_smoke_report="\${LCO_TOOL_SMOKE_REPORT:?set LCO_TOOL_SMOKE_REPORT to a fresh tool-smoke report path}" && evidence_dir="\${LCO_EVIDENCE_DIR:?set LCO_EVIDENCE_DIR to the evidence directory for published-smoke output}" && mkdir -p "$evidence_dir" && ${tarballExtractPrefix} && binary_probe_report="$evidence_dir/binary-probe.json" && package_version="$(node -pe "require(process.argv.at(-1)).version" "$tmp_dir/package/package.json")" && tarball_binary_version="$package_version" && test -n "$package_version" && test -n "$tarball_binary_version" && test "$tarball_binary_version" = "$package_version" && resolved_binary_source="package_tarball" && path_shadowed="false" && version="$tarball_binary_version" && path_binary="$(command -v loo || true)" && if test -n "$path_binary"; then path_version="$(loo --version 2>/dev/null || true)"; if test "$path_version" = "$package_version"; then resolved_binary_source="package_exec"; version="$path_version"; else resolved_binary_source="global_path"; path_shadowed="true"; version="$path_version"; fi; fi && test -n "$version" && ${binaryProbeJsonWriteCommand(packageVersion)}`),
      `loo openclaw published-smoke --dogfood-report "$LCO_DOGFOOD_REPORT" --tool-smoke-report "$LCO_TOOL_SMOKE_REPORT" --binary-probe-report "${binaryProbePath}" --evidence-dir "$LCO_EVIDENCE_DIR" --strict`
    ];
  }
  if (diagnostic.classification !== "smoke_harness_path_shadow" && diagnostic.classification !== "candidate_binary_version_mismatch") return [];
  return [
    `${tarballLookup} --json`,
    recoverySubshellCommand(`${tarballExtractPrefix} && node -pe "require(process.argv.at(-1)).version" "$tmp_dir/package/package.json"`)
  ];
}

function recoverySubshellCommand(command: string): string {
  return `(${command})`;
}

function publishedPackageTarballExtractCommand(expectedPackage: string): string {
  const metadataLookup = `npm view ${expectedPackage} dist --json`;
  return [
    `tmp_dir="$(mktemp -d)"`,
    `trap 'test -n "\${tmp_dir:-}" && rm -rf "$tmp_dir"' EXIT`,
    `${metadataLookup} > "$tmp_dir/npm-dist.json"`,
    npmDistMetadataReaderCommand(),
    `node "$tmp_dir/read-npm-dist.mjs" "$tmp_dir/npm-dist.json" "$tmp_dir/tarball-url.txt" "$tmp_dir/integrity.txt"`,
    `tarball_url="$(cat "$tmp_dir/tarball-url.txt")"`,
    `integrity="$(cat "$tmp_dir/integrity.txt")"`,
    `test -n "$tarball_url"`,
    `test -n "$integrity"`,
    `curl -fsSL "$tarball_url" -o "$tmp_dir/package.tgz"`,
    npmTarballIntegrityVerifierCommand(),
    `node "$tmp_dir/verify-tarball-integrity.mjs" "$tmp_dir/package.tgz" "$integrity"`,
    `tar -xzf "$tmp_dir/package.tgz" -C "$tmp_dir"`
  ].join(" && ");
}

function npmDistMetadataReaderCommand(): string {
  const lines = [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "const [metadataPath, tarballOut, integrityOut] = process.argv.slice(2);",
    "const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));",
    "const tarball = typeof metadata.tarball === 'string' ? metadata.tarball : typeof metadata.dist?.tarball === 'string' ? metadata.dist.tarball : '';",
    "const integrity = typeof metadata.integrity === 'string' ? metadata.integrity : typeof metadata.dist?.integrity === 'string' ? metadata.dist.integrity : '';",
    "if (!tarball || !integrity) process.exit(1);",
    "writeFileSync(tarballOut, `${tarball}\\n`);",
    "writeFileSync(integrityOut, `${integrity}\\n`);"
  ];
  return `printf '%s\\n' ${lines.map(shellSingleQuote).join(" ")} > "$tmp_dir/read-npm-dist.mjs"`;
}

function npmTarballIntegrityVerifierCommand(): string {
  const lines = [
    "import { createHash } from 'node:crypto';",
    "import { readFileSync } from 'node:fs';",
    "const [tarballPath, integrity] = process.argv.slice(2);",
    "const match = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity ?? '');",
    "if (!match) process.exit(1);",
    "const actual = createHash('sha512').update(readFileSync(tarballPath)).digest('base64');",
    "if (actual !== match[1]) process.exit(1);"
  ];
  return `printf '%s\\n' ${lines.map(shellSingleQuote).join(" ")} > "$tmp_dir/verify-tarball-integrity.mjs"`;
}

function binaryProbeJsonWriteCommand(packageVersion: string): string {
  // This fragment is composed into a larger shell && chain; keep caller-owned literals shell-single-quoted.
  const writerLines = [
    "import { writeFileSync } from 'node:fs';",
    "const [outPath, expectedVersion, observedVersion, packageJsonVersion, resolvedBinarySource = 'package_tarball', pathShadowedValue = 'false', tarballBinaryVersionValue = ''] = process.argv.slice(2);",
    "const pathShadowed = pathShadowedValue === 'true';",
    "const tarballBinaryVersion = tarballBinaryVersionValue || (resolvedBinarySource === 'package_tarball' && observedVersion === packageJsonVersion ? observedVersion : null);",
    "writeFileSync(outPath, JSON.stringify({ kind: 'loo_published_binary_probe_evidence', publicSafe: true, rawSecretIncluded: false, expectedVersion, observedVersion, resolvedBinarySource, pathShadowed, tarballBinaryVersion, packageJsonVersion }) + '\\n');"
  ];
  return `printf '%s\\n' ${writerLines.map(shellSingleQuote).join(" ")} > "$tmp_dir/write-binary-probe.mjs" && node "$tmp_dir/write-binary-probe.mjs" "$binary_probe_report" ${shellSingleQuote(packageVersion)} "$version" "$package_version" "$resolved_binary_source" "$path_shadowed" "$tarball_binary_version"`;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function binaryProbeBlockers(diagnostic: PublishedPackageSmokeReport["binaryProbeDiagnostic"]): string[] {
  if (!diagnostic.provided || diagnostic.classification === "not_provided") return ["binary_probe_missing"];
  if (diagnostic.classification === "valid_candidate_binary" || diagnostic.classification === "smoke_harness_path_shadow") return [];
  if (diagnostic.classification === "candidate_binary_version_mismatch") return ["binary_probe_candidate_version_mismatch"];
  return ["binary_probe_invalid"];
}

function readBinaryProbeDiagnostic(path: string | undefined, packageVersion: string): PublishedPackageSmokeReport["binaryProbeDiagnostic"] {
  if (!path) {
    return {
      provided: false,
      classification: "not_provided",
      packageInstallLikelyOk: false,
      resolvedBinarySource: "unknown",
      observedVersion: null,
      packageVersion,
      tarballBinaryVersion: null,
      evidenceInputs: [],
      guidance: ["Provide --binary-probe-report evidence that attributes the resolved loo binary to the candidate package before claiming package-path readiness."]
    };
  }
  const payload = readJsonObject(path);
  const publicSafe = payload.publicSafe === true && payload.rawSecretIncluded === false;
  if (!publicSafe) return invalidBinaryProbeDiagnostic(packageVersion, ["invalid_or_non_public_safe_binary_probe"]);
  const observedVersion = safeVersionString(readNestedString(payload, ["observedVersion"]));
  const expectedVersion = safeVersionString(readNestedString(payload, ["expectedVersion"])) ?? packageVersion;
  const tarballBinaryVersion = safeVersionString(readNestedString(payload, ["tarballBinaryVersion"]));
  const pathShadowed = readNestedBoolean(payload, ["pathShadowed"]);
  const resolvedBinarySource = readResolvedBinarySource(payload);
  const tarballMatches = tarballBinaryVersion === packageVersion;
  const evidenceInputs = [
    "binary_probe",
    pathShadowed ? "path_shadowed" : null,
    tarballMatches ? "candidate_tarball_version_match" : null
  ].filter((item): item is string => Boolean(item));

  if (pathShadowed && tarballMatches) {
    return {
      provided: true,
      classification: "smoke_harness_path_shadow",
      packageInstallLikelyOk: true,
      resolvedBinarySource,
      observedVersion,
      packageVersion,
      tarballBinaryVersion,
      evidenceInputs,
      guidance: [
        "The command runner resolved a non-candidate loo binary, but binary-probe tarball evidence matched the package version; treat this as smoke harness PATH shadowing.",
        "Rerun product smoke from the exact published tarball or validate the resolved binary path before claiming a package version defect."
      ]
    };
  }

  const packageTarballCandidate = resolvedBinarySource === "package_tarball"
    && tarballMatches
    && expectedVersion === packageVersion
    && observedVersion === packageVersion;
  const packageExecCandidate = resolvedBinarySource === "package_exec"
    && expectedVersion === packageVersion
    && observedVersion === packageVersion;

  if (!pathShadowed && (packageTarballCandidate || packageExecCandidate)) {
    return {
      provided: true,
      classification: "valid_candidate_binary",
      packageInstallLikelyOk: true,
      resolvedBinarySource,
      observedVersion,
      packageVersion,
      tarballBinaryVersion,
      evidenceInputs: uniqueStrings([...evidenceInputs, "candidate_binary_version_match"]),
      guidance: ["The resolved binary was attributed to the candidate package and reported the expected version."]
    };
  }

  return {
    provided: true,
    classification: "candidate_binary_version_mismatch",
    packageInstallLikelyOk: false,
    resolvedBinarySource,
    observedVersion,
    packageVersion,
    tarballBinaryVersion,
    evidenceInputs,
    guidance: [
      "The binary probe did not prove the candidate package version; keep package readiness fail-closed until exact tarball or package-scoped binary proof passes."
    ]
  };
}

function invalidBinaryProbeDiagnostic(
  packageVersion: string,
  evidenceInputs: string[]
): PublishedPackageSmokeReport["binaryProbeDiagnostic"] {
  return {
    provided: true,
    classification: "invalid",
    packageInstallLikelyOk: false,
    resolvedBinarySource: "unknown",
    observedVersion: null,
    packageVersion,
    tarballBinaryVersion: null,
    evidenceInputs,
    guidance: ["The binary probe report was absent, malformed, or not public-safe; keep package readiness fail-closed if this probe is required for the claim."]
  };
}

function readResolvedBinarySource(input: Record<string, unknown>): PublishedPackageSmokeReport["binaryProbeDiagnostic"]["resolvedBinarySource"] {
  const value = readNestedString(input, ["resolvedBinarySource"]);
  if (value === "package_tarball" || value === "package_exec" || value === "global_path") return value;
  return "unknown";
}

function safeVersionString(value: string | null): string | null {
  return value && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.test(value) ? value : null;
}

function readNpmInstallDiagnostic(path: string | undefined): PublishedPackageSmokeReport["npmInstallDiagnostic"] {
  if (!path) {
    return {
      provided: false,
      classification: "not_provided",
      packageInstallLikelyOk: false,
      registryTarballVisible: false,
      tarballFallbackInstallable: false,
      trueUnpublishedVersion: false,
      suggestedRetry: null,
      evidenceInputs: [],
      guidance: []
    };
  }
  const payload = readJsonObject(path);
  const code = readNestedString(payload, ["code"]);
  const publicSafe = payload.publicSafe === true && payload.rawSecretIncluded === false;
  if (!publicSafe) return invalidNpmInstallDiagnostic(["invalid_or_non_public_safe_diagnostic"]);
  const suggestedRetry = publicSafeSuggestedRetry(readNestedString(payload, ["suggestedRetry"]));
  const registryTarballVisible = readNestedBoolean(payload, ["registryTarballVisible"])
    || SUPPORTED_PACKAGE_NAMES.some((packageName) => suggestedRetry?.startsWith(`npm install https://registry.npmjs.org/${packageName}/-/`));
  const tarballFallbackInstallable = readNestedBoolean(payload, ["tarballFallbackInstallOk"])
    || readNestedBoolean(payload, ["tarballInstallOk"]);
  const trueUnpublishedVersion = readNestedBoolean(payload, ["trueUnpublishedVersion"]);
  const evidenceInputs = [
    "npm_install_diagnostic",
    registryTarballVisible ? "registry_tarball_visible" : null,
    tarballFallbackInstallable ? "tarball_fallback_install_ok" : null
  ].filter((item): item is string => Boolean(item));

  if (code === "npm_selector_cutoff_drift") {
    if (!trueUnpublishedVersion && registryTarballVisible && tarballFallbackInstallable) {
      return {
        provided: true,
        classification: "npm_selector_drift_with_tarball_fallback",
        packageInstallLikelyOk: true,
        registryTarballVisible,
        tarballFallbackInstallable,
        trueUnpublishedVersion,
        suggestedRetry,
        evidenceInputs,
        guidance: [
          "npm selector drift was observed, but registry tarball fallback proof is installable; treat this as selector drift, not a true unpublished package.",
          "Use the guarded registry tarball fallback command for first-run recovery and keep raw npm stderr out of public evidence."
        ]
      };
    }
    return {
      provided: true,
      classification: "npm_selector_drift_unproved",
      packageInstallLikelyOk: false,
      registryTarballVisible,
      tarballFallbackInstallable,
      trueUnpublishedVersion,
      suggestedRetry,
      evidenceInputs,
      guidance: [
        "npm selector drift was observed, but tarball fallback install proof is missing; keep package readiness fail-closed until fallback dogfood/tool-smoke evidence is supplied."
      ]
    };
  }

  if (code === "npm_before_cutoff_drift") {
    return npmInstallDiagnostic("npm_before_cutoff_drift", false, registryTarballVisible, tarballFallbackInstallable, trueUnpublishedVersion, suggestedRetry, evidenceInputs, [
      "npm before-cutoff drift was observed; retry with a future --before value before treating the package as unpublished."
    ]);
  }
  if (code === "npm_version_unavailable") {
    return npmInstallDiagnostic("npm_version_unavailable", false, registryTarballVisible, tarballFallbackInstallable, trueUnpublishedVersion, suggestedRetry, evidenceInputs, [
      "npm registry metadata did not prove the requested version; keep package readiness fail-closed."
    ]);
  }
  if (code === "npm_install_failed") {
    return npmInstallDiagnostic("npm_install_failed", false, registryTarballVisible, tarballFallbackInstallable, trueUnpublishedVersion, suggestedRetry, evidenceInputs, [
      "npm install failed without a selector-drift proof; inspect sanitized local evidence before claiming package readiness."
    ]);
  }
  return invalidNpmInstallDiagnostic(["unknown_diagnostic_code"]);
}

function npmInstallDiagnostic(
  classification: PublishedPackageSmokeReport["npmInstallDiagnostic"]["classification"],
  packageInstallLikelyOk: boolean,
  registryTarballVisible: boolean,
  tarballFallbackInstallable: boolean,
  trueUnpublishedVersion: boolean,
  suggestedRetry: string | null,
  evidenceInputs: string[],
  guidance: string[]
): PublishedPackageSmokeReport["npmInstallDiagnostic"] {
  return {
    provided: true,
    classification,
    packageInstallLikelyOk,
    registryTarballVisible,
    tarballFallbackInstallable,
    trueUnpublishedVersion,
    suggestedRetry,
    evidenceInputs,
    guidance
  };
}

function invalidNpmInstallDiagnostic(evidenceInputs: string[]): PublishedPackageSmokeReport["npmInstallDiagnostic"] {
  return {
    provided: true,
    classification: "invalid",
    packageInstallLikelyOk: false,
    registryTarballVisible: false,
    tarballFallbackInstallable: false,
    trueUnpublishedVersion: false,
    suggestedRetry: null,
    evidenceInputs,
    guidance: ["The npm install diagnostic report was absent, malformed, or not public-safe; keep package readiness fail-closed."]
  };
}

function publicSafeSuggestedRetry(value: string | null): string | null {
  if (!value) return null;
  if (/\/Users\/|\.npmrc|Bearer\s+|npm_[A-Za-z0-9]{20,}|token|password|secret/i.test(value)) return null;
  for (const packageName of SUPPORTED_PACKAGE_NAMES) {
    if (value.startsWith(`npm install https://registry.npmjs.org/${packageName}/-/`)) return value;
    if (value.startsWith(`npm view ${packageName}@`) && value.includes(" dist.tarball")) return value;
  }
  return null;
}

function setupBlockerRecoveryItems(setupBlockers: string[]): Array<{
  blocker: string;
  requiredSetup: string;
  commands: string[];
  guidance: string;
}> {
  return setupBlockerRecoveryCatalog().filter((item) => setupBlockers.includes(item.blocker));
}

function setupBlockerRecoveryCatalog(): Array<{
  blocker: string;
  requiredSetup: string;
  commands: string[];
  guidance: string;
}> {
  return [
    {
      blocker: "fresh_profile_gateway_credentials_required",
      requiredSetup: "gateway_credentials",
      commands: [
        "openclaw doctor --generate-gateway-token --non-interactive --yes",
        "OPENCLAW_GATEWAY_TOKEN='<scoped-token>' openclaw onboard --non-interactive --accept-risk --gateway-auth token --gateway-token-ref-env OPENCLAW_GATEWAY_TOKEN",
        "OPENCLAW_GATEWAY_TOKEN='<scoped-token>' openclaw gateway status --json --token '<scoped-token>'",
        "OPENCLAW_GATEWAY_TOKEN='<scoped-token>' loo openclaw tool-smoke --profile lco-dogfood-published --required-tool loo_doctor --required-tool loo_search_sessions --strict"
      ],
      guidance: "Provide a scoped local gateway token through a SecretRef/env-var path or complete profile credential setup, then rerun fresh-profile tool-smoke. Do not store the token in public evidence."
    },
    {
      blocker: "openclaw_device_identity_pairing_required",
      requiredSetup: "device_pairing",
      commands: ["openclaw devices approve --latest"],
      guidance: "Complete local OpenClaw device identity pairing before claiming the clean profile is gateway-ready."
    },
    {
      blocker: "openclaw_gateway_scope_approval_required",
      requiredSetup: "gateway_scope_approval",
      commands: ["openclaw devices approve --latest"],
      guidance: "Approve only the required read/search/dry-run gateway scopes; this is not broad gateway scope or live-control approval."
    },
    {
      blocker: "openclaw_gateway_token_rotation_required",
      requiredSetup: "gateway_token_rotation",
      commands: ["openclaw devices rotate --device <deviceId> --role operator"],
      guidance: "Rotate or reissue the gateway token outside public evidence; never store the token in the smoke report."
    }
  ];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function readPackageJson(rootDir: string): { name: string; version: string } {
  try {
    const parsed = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
    return {
      name: typeof parsed.name === "string" ? parsed.name : "unknown",
      version: typeof parsed.version === "string" ? parsed.version : "unknown"
    };
  } catch {
    return { name: "unknown", version: "unknown" };
  }
}

function readJsonObject(path: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function readGatewaySetupClassification(input: Record<string, unknown>): PublishedPackageSmokeReport["toolSmoke"]["gatewaySetupClassification"] {
  const value = readNestedString(input, ["setupStatus", "classification"]);
  if (value === "ready" || value === "gateway_setup_required" || value === "gateway_blocked") return value;
  return "unknown";
}

function readNestedString(input: Record<string, unknown>, path: string[]): string | null {
  let cursor: unknown = input;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" ? cursor : null;
}

function readNestedBoolean(input: Record<string, unknown>, path: string[]): boolean {
  let cursor: unknown = input;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor === true;
}

function readNestedNumber(input: Record<string, unknown>, path: string[]): number {
  let cursor: unknown = input;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return 0;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "number" && Number.isFinite(cursor) && cursor >= 0 ? cursor : 0;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readInvokedTools(input: Record<string, unknown>): string[] {
  if (!Array.isArray(input.invocations)) return [];
  const tools = input.invocations
    .map((item) => item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>).toolName : null)
    .filter((tool): tool is string => typeof tool === "string" && /^loo_[a-z0-9_]+$/.test(tool));
  return [...new Set(tools)].slice(0, 20);
}
