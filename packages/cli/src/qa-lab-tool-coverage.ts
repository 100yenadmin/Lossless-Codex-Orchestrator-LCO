import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalLooToolName,
  createLooToolDeclarations,
  isLooToolAlias,
  isUnknownLcoAliasName
} from "../../mcp-server/src/tools.js";
import { normalizeReleaseClaimScope, type ReleaseClaimScope } from "./release-claim-scope.js";

export type QaLabCoveragePolicy = "full" | "facade";
export type QaLabToolTier = "public_facade" | "workflow_detail" | "proof_debug" | "internal_low_level";
export type QaLabBlockerSeverity = "P0" | "P1" | "P2" | "P3";
export type QaLabToolCoverageStatus =
  | "covered"
  | "missing_invocation"
  | "manifest_missing"
  | "not_required_by_policy";

export type QaLabToolCoverageOptions = {
  evidenceDir: string;
  claimScope?: ReleaseClaimScope;
  packageVersion?: string;
  candidateSha?: string;
  coveragePolicy?: QaLabCoveragePolicy;
  toolSmokeReport?: string;
  dogfoodReport?: string;
  publishedSmoke?: string;
  manifestPath?: string;
  now?: string;
};

export type QaLabToolCoverageBlocker = {
  severity: QaLabBlockerSeverity;
  code: string;
  source: string;
  detail: string;
};

export type QaLabToolCoverageSetupBlocker = {
  code: string;
  source: string;
  detail: string;
  allowed: boolean;
};

export type QaLabToolCoverageWarning = {
  code: string;
  source: string;
  detail: string;
};

export type QaLabToolCoverageEvidenceStatus = "missing" | "invalid" | "unsafe" | "blocked" | "ready" | "not_provided";

export type QaLabToolCoverageEvidenceIndexEntry = {
  status: QaLabToolCoverageEvidenceStatus;
  evidenceRef: string | null;
  blockerCodes: string[];
};

export type QaLabToolCoverageRow = {
  name: string;
  tier: QaLabToolTier;
  requiredForPolicy: boolean;
  manifestPresent: boolean;
  gatewayCatalogProved: boolean;
  invoked: boolean;
  invocationOk: boolean;
  evidenceRefs: string[];
  coverageStatus: QaLabToolCoverageStatus;
  blockerCodes: string[];
};

export type QaLabToolCoverageReport = {
  schema: "lco.qaLab.toolCoverage.v1";
  ok: boolean;
  qaLabToolCoverageReady: boolean;
  generatedAt: string;
  packageName: "lossless-openclaw-orchestrator";
  packageVersion: string | null;
  candidateSha: string | null;
  claimScope: ReleaseClaimScope;
  coveragePolicy: QaLabCoveragePolicy;
  declaredToolCount: number;
  tierCounts: Record<QaLabToolTier, number>;
  catalogCoverage: {
    runtimeDeclaredTools: number;
    manifestTools: number | null;
    manifestParity: boolean;
    missingFromManifest: string[];
    extraInManifest: string[];
  };
  invocationCoverage: {
    totalDeclaredTools: number;
    invokedDeclaredTools: number;
    missingDeclaredTools: string[];
    publicFacadeTotal: number;
    publicFacadeInvoked: number;
    publicFacadeMissing: string[];
  };
  toolRows: QaLabToolCoverageRow[];
  blockers: QaLabToolCoverageBlocker[];
  setupBlockers: QaLabToolCoverageSetupBlocker[];
  warnings: QaLabToolCoverageWarning[];
  evidenceIndex: Record<"toolSmokeReport" | "dogfoodReport" | "publishedSmoke" | "manifest", QaLabToolCoverageEvidenceIndexEntry>;
  actionsVerified: {
    runtimeToolRegistryLoaded: boolean;
    pluginManifestLoaded: boolean;
    toolSmokeLoaded: boolean;
    declaredToolCoverageChecked: boolean;
    publicFacadeCoverageChecked: boolean;
  };
  actionsPerformed: {
    npmPublished: false;
    githubReleaseCreated: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    broadGatewayScopeApproval: false;
  };
  nextSafeCommands: string[];
  privateDataExclusions: string[];
  proofBoundary: string;
};

type JsonRecord = Record<string, unknown>;

type LoadedEvidence = {
  source: "toolSmokeReport" | "dogfoodReport" | "publishedSmoke" | "manifest";
  path: string | null;
  evidenceRef: string | null;
  value: JsonRecord | null;
  missing: boolean;
  invalid: boolean;
  outsideEvidenceDir: boolean;
  optional: boolean;
};

type ToolInvocation = {
  name: string;
  ok: boolean;
  evidenceRef: string;
};

const PACKAGE_NAME = "lossless-openclaw-orchestrator";
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const LOO_TOOL_NAME_PATTERN = /^(?:loo|lco)_[a-z0-9_]+$/;
const SECRET_LIKE_PATTERN = /(npm_[A-Za-z0-9]{20,}|bearer\s+[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const RAW_ARTIFACT_VALUE_PATTERN = /(?:\/Users\/[^"'\s]+|\/Volumes\/[^"'\s]+|~\/[^"'\s]+).*\.(?:jsonl|sqlite|sqlite-wal|sqlite-shm|db|png|jpg|jpeg|gif|webp|mp4|mov|webm)(?:["'\s]|$)/i;
const RAW_ARTIFACT_REF_PATTERN = /\.(?:jsonl|sqlite|sqlite-wal|sqlite-shm|db|png|jpg|jpeg|gif|webp|mp4|mov|webm|log)(?:$|[?#])/i;
const RESTRICTED_ACTION_KEYS = new Set([
  "npmPublished",
  "githubReleaseCreated",
  "liveCodexControlRun",
  "desktopGuiActionRun",
  "broadGatewayScopeApproval",
  "rawTranscriptRead",
  "screenshotCaptured",
  "screenshotsCaptured"
]);
const PRIVATE_DATA_EXCLUSIONS = [
  "raw Codex transcripts",
  "raw prompts or message text",
  "SQLite DBs",
  "JSONL transcripts",
  "screenshots or videos",
  "tokens, credentials, API keys, cookies",
  "raw OpenClaw gateway stdout/stderr",
  "raw MCP stdout/stderr",
  "customer data"
];

export function createQaLabToolCoverageReport(options: QaLabToolCoverageOptions): QaLabToolCoverageReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });

  const coveragePolicy = options.coveragePolicy ?? "full";
  const claimScope = normalizeReleaseClaimScope(options.claimScope);
  const blockers: QaLabToolCoverageBlocker[] = [];
  const setupBlockers: QaLabToolCoverageSetupBlocker[] = [];
  const warnings: QaLabToolCoverageWarning[] = [];
  const evidenceIndex = {} as QaLabToolCoverageReport["evidenceIndex"];
  const invalidAliasNames = new Set<string>();

  const declaredTools = createLooToolDeclarations({ includeAliases: true })
    .filter((tool) => !isLooToolAlias(tool))
    .map((tool) => ({
    name: tool.name,
    tier: normalizeTier(tool.metadata?.tier)
  }));
  const declaredToolNames = declaredTools.map((tool) => tool.name);
  const declaredToolNameSet = new Set(declaredToolNames);
  const tierCounts = buildTierCounts(declaredTools);

  const loadedToolSmoke = loadEvidence("toolSmokeReport", options.toolSmokeReport ?? join(evidenceDir, "openclaw-tool-smoke.json"), evidenceDir, false);
  const loadedDogfood = loadEvidence("dogfoodReport", options.dogfoodReport, evidenceDir, true);
  const loadedPublishedSmoke = loadEvidence("publishedSmoke", options.publishedSmoke, evidenceDir, true);
  const loadedManifest = loadEvidence("manifest", options.manifestPath ?? defaultManifestPath(), evidenceDir, false, !options.manifestPath);
  const loadedReports = [loadedToolSmoke, loadedDogfood, loadedPublishedSmoke, loadedManifest];

  for (const evidence of loadedReports) {
    const start = blockers.length;
    validateLoadedEvidence(evidence, blockers, setupBlockers, warnings, options);
    evidenceIndex[evidence.source] = {
      status: evidenceStatus(evidence, blockers.slice(start).map((blocker) => blocker.code)),
      evidenceRef: evidence.evidenceRef,
      blockerCodes: blockers.slice(start).map((blocker) => blocker.code)
    };
  }

  if (options.candidateSha && !SHA_PATTERN.test(options.candidateSha)) {
    addBlocker(blockers, "P1", "candidate_sha_invalid", "qaLabToolCoverage", "Candidate SHA must be a 40-character hexadecimal commit SHA.");
  }

  const manifestTools = extractManifestToolNames(loadedManifest.value, invalidAliasNames);
  const missingFromManifest = manifestTools ? declaredToolNames.filter((name) => !manifestTools.has(name)) : declaredToolNames;
  const extraInManifest = manifestTools ? [...manifestTools].filter((name) => !declaredToolNameSet.has(name)).sort() : [];
  if (!manifestTools) {
    addBlocker(blockers, "P1", "plugin_manifest_missing_or_invalid", "manifest", "Plugin manifest must be present and expose the declared LCO tool list.");
  } else if (missingFromManifest.length > 0 || extraInManifest.length > 0) {
    addBlocker(blockers, "P1", "plugin_manifest_runtime_tool_mismatch", "manifest", "Plugin manifest tool list must match the runtime LCO tool registry.");
  }

  const catalogTools = new Set<string>();
  collectCatalogTools(catalogTools, loadedToolSmoke.value, invalidAliasNames);
  collectPublishedSmokeTools(catalogTools, loadedPublishedSmoke.value, invalidAliasNames);

  const invocations = collectInvocations(invalidAliasNames, loadedToolSmoke, loadedPublishedSmoke, loadedDogfood);
  const invocationMap = new Map<string, ToolInvocation>();
  for (const invocation of invocations) {
    if (!invocationMap.has(invocation.name) || invocation.ok) invocationMap.set(invocation.name, invocation);
  }

  const toolRows = declaredTools.map((tool) => buildToolRow({
    tool,
    manifestTools,
    catalogTools,
    invocation: invocationMap.get(tool.name),
    coveragePolicy
  }));

  for (const row of toolRows) {
    if (!row.manifestPresent) {
      // Row-level detail only; the aggregate manifest mismatch blocker above owns strict-mode failure.
      row.blockerCodes.push("declared_tool_missing_from_manifest");
      continue;
    }
    if (row.requiredForPolicy && !row.invocationOk) {
      row.blockerCodes.push(row.tier === "public_facade" ? "public_facade_product_evidence_missing" : "declared_tool_product_evidence_missing");
    }
  }

  const missingDeclaredTools = toolRows.filter((row) => row.requiredForPolicy && !row.invocationOk).map((row) => row.name);
  const publicFacadeRows = toolRows.filter((row) => row.tier === "public_facade");
  const publicFacadeMissing = publicFacadeRows.filter((row) => !row.invocationOk).map((row) => row.name);
  if (publicFacadeMissing.length > 0) {
    addBlocker(blockers, "P1", "public_facade_product_evidence_missing", "toolCoverage", `${publicFacadeMissing.length} public facade tool(s) lack product invocation evidence.`);
  }
  // Under facade policy, missingDeclaredTools intentionally contains only public facade tools.
  // Non-facade evidence gaps become strict blockers only when the full-surface gate is requested.
  const nonFacadeMissing = missingDeclaredTools.filter((name) => !publicFacadeMissing.includes(name));
  if (coveragePolicy === "full" && nonFacadeMissing.length > 0) {
    addBlocker(blockers, "P2", "declared_tool_product_evidence_missing", "toolCoverage", `${nonFacadeMissing.length} declared non-facade tool(s) lack tier-appropriate product evidence.`);
  }
  if (invalidAliasNames.size > 0) {
    addBlocker(blockers, "P1", "invalid_lco_alias_reference", "toolCoverage", "Evidence or manifest references lco_* aliases that are not public facade aliases.");
  }

  const unsafeReports = loadedReports.filter((evidence) => evidence.value && containsUnsafeValue(evidence.value));
  if (unsafeReports.length > 0) {
    addBlocker(blockers, "P0", "unsafe_evidence_value", "evidence", "Evidence contains a secret-like value, raw local transcript path, raw SQLite/JSONL path, screenshot, or media artifact reference.");
    for (const evidence of unsafeReports) {
      evidenceIndex[evidence.source].status = "unsafe";
      evidenceIndex[evidence.source].blockerCodes.push("unsafe_evidence_value");
    }
  }

  const dedupedBlockers = uniqueBlockers(blockers);
  const qaLabToolCoverageReady = dedupedBlockers.filter((blocker) => blocker.severity !== "P3").length === 0;
  const report: QaLabToolCoverageReport = {
    schema: "lco.qaLab.toolCoverage.v1",
    ok: qaLabToolCoverageReady,
    qaLabToolCoverageReady,
    generatedAt: options.now ?? new Date().toISOString(),
    packageName: PACKAGE_NAME,
    packageVersion: options.packageVersion ?? null,
    candidateSha: options.candidateSha ?? null,
    claimScope,
    coveragePolicy,
    declaredToolCount: declaredTools.length,
    tierCounts,
    catalogCoverage: {
      runtimeDeclaredTools: declaredTools.length,
      manifestTools: manifestTools?.size ?? null,
      manifestParity: Boolean(manifestTools && missingFromManifest.length === 0 && extraInManifest.length === 0),
      missingFromManifest,
      extraInManifest
    },
    invocationCoverage: {
      totalDeclaredTools: declaredTools.length,
      invokedDeclaredTools: toolRows.filter((row) => row.invocationOk).length,
      missingDeclaredTools,
      publicFacadeTotal: publicFacadeRows.length,
      publicFacadeInvoked: publicFacadeRows.filter((row) => row.invocationOk).length,
      publicFacadeMissing
    },
    toolRows,
    blockers: dedupedBlockers,
    setupBlockers,
    warnings,
    evidenceIndex,
    actionsVerified: {
      runtimeToolRegistryLoaded: declaredTools.length > 0,
      pluginManifestLoaded: Boolean(manifestTools),
      toolSmokeLoaded: Boolean(loadedToolSmoke.value),
      declaredToolCoverageChecked: true,
      publicFacadeCoverageChecked: true
    },
    actionsPerformed: {
      npmPublished: false,
      githubReleaseCreated: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      broadGatewayScopeApproval: false
    },
    nextSafeCommands: nextSafeCommands(options, missingDeclaredTools),
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS,
    proofBoundary: "Aggregates existing public-safe QA Lab tool evidence only; it does not invoke tools, authorize gateways, run live Codex control, mutate a GUI, publish npm, create tags, or create GitHub Releases."
  };

  writeFileSync(join(evidenceDir, "tool-coverage.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function buildToolRow(input: {
  tool: { name: string; tier: QaLabToolTier };
  manifestTools: Set<string> | null;
  catalogTools: Set<string>;
  invocation: ToolInvocation | undefined;
  coveragePolicy: QaLabCoveragePolicy;
}): QaLabToolCoverageRow {
  const manifestPresent = input.manifestTools?.has(input.tool.name) ?? false;
  const requiredForPolicy = input.coveragePolicy === "full" || input.tool.tier === "public_facade";
  const invocationOk = Boolean(input.invocation?.ok);
  const gatewayCatalogProved = input.catalogTools.has(input.tool.name) || Boolean(input.invocation);
  let coverageStatus: QaLabToolCoverageStatus = "covered";
  if (!manifestPresent) coverageStatus = "manifest_missing";
  else if (invocationOk) coverageStatus = "covered";
  else coverageStatus = requiredForPolicy ? "missing_invocation" : "not_required_by_policy";
  return {
    name: input.tool.name,
    tier: input.tool.tier,
    requiredForPolicy,
    manifestPresent,
    gatewayCatalogProved,
    invoked: Boolean(input.invocation),
    invocationOk,
    evidenceRefs: input.invocation ? [input.invocation.evidenceRef] : [],
    coverageStatus,
    blockerCodes: []
  };
}

function loadEvidence(
  source: LoadedEvidence["source"],
  path: string | undefined,
  evidenceDir: string,
  optional: boolean,
  allowRepoManifest = false
): LoadedEvidence {
  if (!path) {
    return { source, path: null, evidenceRef: null, value: null, missing: true, invalid: false, outsideEvidenceDir: false, optional };
  }
  const resolved = resolve(path);
  const outsideEvidenceDir = !allowRepoManifest && !isPathInside(resolved, evidenceDir);
  if (!existsSync(resolved)) {
    return { source, path: resolved, evidenceRef: evidenceRef(resolved, evidenceDir), value: null, missing: true, invalid: false, outsideEvidenceDir, optional };
  }
  try {
    const parsed = JSON.parse(readFileSync(resolved, "utf8")) as unknown;
    return {
      source,
      path: resolved,
      evidenceRef: evidenceRef(resolved, evidenceDir),
      value: isRecord(parsed) ? parsed : null,
      missing: false,
      invalid: !isRecord(parsed),
      outsideEvidenceDir,
      optional
    };
  } catch {
    return { source, path: resolved, evidenceRef: evidenceRef(resolved, evidenceDir), value: null, missing: false, invalid: true, outsideEvidenceDir, optional };
  }
}

function validateLoadedEvidence(
  evidence: LoadedEvidence,
  blockers: QaLabToolCoverageBlocker[],
  setupBlockers: QaLabToolCoverageSetupBlocker[],
  warnings: QaLabToolCoverageWarning[],
  options: QaLabToolCoverageOptions
): void {
  if (evidence.outsideEvidenceDir) {
    addBlocker(blockers, "P0", `${evidence.source}_outside_evidence_dir`, evidence.source, `${titleForSource(evidence.source)} must stay inside the evidence directory.`);
    return;
  }
  if (evidence.missing) {
    if (evidence.optional) {
      warnings.push({ code: `${evidence.source}_not_provided`, source: evidence.source, detail: `${titleForSource(evidence.source)} was not provided.` });
    } else {
      addBlocker(blockers, "P1", `${evidence.source}_missing`, evidence.source, `${titleForSource(evidence.source)} is missing.`);
    }
    return;
  }
  if (evidence.invalid || !evidence.value) {
    addBlocker(blockers, "P1", `${evidence.source}_invalid_json`, evidence.source, `${titleForSource(evidence.source)} is not a valid JSON object.`);
    return;
  }
  if (evidence.source !== "manifest" && evidence.value.publicSafe !== true) {
    addBlocker(blockers, "P0", `${evidence.source}_not_public_safe`, evidence.source, `${titleForSource(evidence.source)} must declare publicSafe: true.`);
  }
  if (hasRestrictedAction(evidence.value)) {
    addBlocker(blockers, "P0", `${evidence.source}_restricted_action_performed`, evidence.source, `${titleForSource(evidence.source)} indicates a restricted action was performed.`);
  }
  if (Array.isArray(evidence.value.blockers) && evidence.value.blockers.length > 0) {
    addBlocker(blockers, "P1", `${evidence.source}_has_blockers`, evidence.source, `${titleForSource(evidence.source)} contains upstream blockers.`);
  }
  collectSetupBlockers(evidence, blockers, setupBlockers);
  validatePackageTruth(evidence, options, blockers);
}

function validatePackageTruth(evidence: LoadedEvidence, options: QaLabToolCoverageOptions, blockers: QaLabToolCoverageBlocker[]): void {
  if (!evidence.value || evidence.source === "manifest") return;
  if (options.packageVersion && typeof evidence.value.packageVersion === "string" && evidence.value.packageVersion !== options.packageVersion) {
    addBlocker(blockers, "P1", "package_version_mismatch", evidence.source, `${titleForSource(evidence.source)} targets a different package version.`);
  }
  if (options.candidateSha && typeof evidence.value.candidateSha === "string" && evidence.value.candidateSha !== options.candidateSha) {
    addBlocker(blockers, "P1", "candidate_sha_mismatch", evidence.source, `${titleForSource(evidence.source)} targets a different candidate SHA.`);
  }
}

function collectSetupBlockers(
  evidence: LoadedEvidence,
  blockers: QaLabToolCoverageBlocker[],
  setupBlockers: QaLabToolCoverageSetupBlocker[]
): void {
  if (!evidence.value || evidence.source === "manifest") return;
  const status = readPath(evidence.value, ["setupStatus", "classification"]) ?? readPath(evidence.value, ["configuredGateway", "gatewaySetupClassification"]);
  if (typeof status === "string" && status !== "ready") {
    setupBlockers.push({ code: `${evidence.source}_setup_${status}`, source: evidence.source, detail: `${titleForSource(evidence.source)} reports setup status ${status}.`, allowed: false });
    addBlocker(blockers, "P2", `${evidence.source}_setup_not_ready`, evidence.source, `${titleForSource(evidence.source)} setup is not ready.`);
  }
}

function extractManifestToolNames(value: JsonRecord | null, invalidAliasNames: Set<string>): Set<string> | null {
  if (!value) return null;
  const contractsDeclarations = readPath(value, ["contracts", "toolDeclarations"]);
  if (Array.isArray(contractsDeclarations)) {
    const names = new Set<string>();
    for (const item of contractsDeclarations) {
      if (!isRecord(item) || isLooToolAlias(item)) continue;
      const name = canonicalQaLabToolName(item.name, invalidAliasNames);
      if (name) names.add(name);
    }
    if (names.size > 0) return names;
  }
  const contractsTools = readPath(value, ["contracts", "tools"]);
  const tools = Array.isArray(contractsTools) ? contractsTools : value.tools;
  if (!Array.isArray(tools)) return null;
  const names = new Set<string>();
  for (const item of tools) {
    const name = typeof item === "string"
      ? canonicalQaLabToolName(item, invalidAliasNames)
      : isRecord(item)
        ? canonicalQaLabToolName(item.name, invalidAliasNames)
        : null;
    if (name) names.add(name);
  }
  return names.size > 0 ? names : null;
}

function collectCatalogTools(catalogTools: Set<string>, value: JsonRecord | null, invalidAliasNames: Set<string>): void {
  if (!value) return;
  const requiredTools = readPath(value, ["catalog", "requiredTools"]);
  if (Array.isArray(requiredTools)) {
    for (const tool of requiredTools) {
      const name = canonicalQaLabToolName(tool, invalidAliasNames);
      if (name) catalogTools.add(name);
    }
  }
  const catalogToolsList = readPath(value, ["catalog", "tools"]);
  if (Array.isArray(catalogToolsList)) {
    for (const tool of catalogToolsList) {
      const name = typeof tool === "string"
        ? canonicalQaLabToolName(tool, invalidAliasNames)
        : isRecord(tool)
          ? canonicalQaLabToolName(tool.name, invalidAliasNames)
          : null;
      if (name) catalogTools.add(name);
    }
  }
}

function collectPublishedSmokeTools(catalogTools: Set<string>, value: JsonRecord | null, invalidAliasNames: Set<string>): void {
  if (!value) return;
  const invoked = readPath(value, ["configuredGateway", "invokedTools"]);
  if (Array.isArray(invoked)) {
    for (const tool of invoked) {
      const name = canonicalQaLabToolName(tool, invalidAliasNames);
      if (name) catalogTools.add(name);
    }
  }
}

function collectInvocations(invalidAliasNames: Set<string>, ...evidenceItems: LoadedEvidence[]): ToolInvocation[] {
  const invocations: ToolInvocation[] = [];
  for (const evidence of evidenceItems) {
    const report = evidence.value;
    if (!report) continue;
    const ref = invocationEvidenceRef(evidence);
    const reportInvocations = report.invocations;
    if (Array.isArray(reportInvocations)) {
      for (const invocation of reportInvocations) {
        if (isRecord(invocation)) {
          const name = canonicalQaLabToolName(invocation.toolName, invalidAliasNames);
          if (name) invocations.push({ name, ok: invocation.ok === true, evidenceRef: ref });
        }
      }
    }
    const configuredInvoked = readPath(report, ["configuredGateway", "invokedTools"]);
    if (Array.isArray(configuredInvoked)) {
      for (const tool of configuredInvoked) {
        const name = canonicalQaLabToolName(tool, invalidAliasNames);
        if (name) invocations.push({ name, ok: true, evidenceRef: ref });
      }
    }
  }
  return invocations;
}

function canonicalQaLabToolName(value: unknown, invalidAliasNames: Set<string>): string | null {
  if (typeof value !== "string" || !isValidLooToolName(value)) return null;
  if (isUnknownLcoAliasName(value)) {
    invalidAliasNames.add(value);
    return null;
  }
  return canonicalLooToolName(value);
}

function invocationEvidenceRef(evidence: LoadedEvidence): string {
  if (evidence.evidenceRef) return evidence.evidenceRef;
  if (evidence.source === "dogfoodReport") return "dogfood-report.json";
  if (evidence.source === "publishedSmoke") return "published-package-smoke.json";
  return "openclaw-tool-smoke.json";
}

function isValidLooToolName(value: string): boolean {
  return LOO_TOOL_NAME_PATTERN.test(value);
}

function containsUnsafeValue(value: unknown): boolean {
  if (typeof value === "string") {
    return SECRET_LIKE_PATTERN.test(value) || RAW_ARTIFACT_VALUE_PATTERN.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsUnsafeValue(item));
  if (isRecord(value)) return Object.values(value).some((item) => containsUnsafeValue(item));
  return false;
}

function hasRestrictedAction(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasRestrictedAction(item));
  if (!isRecord(value)) return false;
  for (const [key, item] of Object.entries(value)) {
    if (RESTRICTED_ACTION_KEYS.has(key) && item === true) return true;
    if (hasRestrictedAction(item)) return true;
  }
  return false;
}

function normalizeTier(value: unknown): QaLabToolTier {
  if (value === "public_facade" || value === "workflow_detail" || value === "proof_debug" || value === "internal_low_level") return value;
  return "workflow_detail";
}

function buildTierCounts(tools: Array<{ tier: QaLabToolTier }>): Record<QaLabToolTier, number> {
  return {
    public_facade: tools.filter((tool) => tool.tier === "public_facade").length,
    workflow_detail: tools.filter((tool) => tool.tier === "workflow_detail").length,
    proof_debug: tools.filter((tool) => tool.tier === "proof_debug").length,
    internal_low_level: tools.filter((tool) => tool.tier === "internal_low_level").length
  };
}

function addBlocker(blockers: QaLabToolCoverageBlocker[], severity: QaLabBlockerSeverity, code: string, source: string, detail: string): void {
  blockers.push({ severity, code, source, detail });
}

function uniqueBlockers(blockers: QaLabToolCoverageBlocker[]): QaLabToolCoverageBlocker[] {
  const seen = new Set<string>();
  const result: QaLabToolCoverageBlocker[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.severity}:${blocker.code}:${blocker.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(blocker);
  }
  return result;
}

function evidenceStatus(evidence: LoadedEvidence, blockerCodes: string[]): QaLabToolCoverageEvidenceStatus {
  if (evidence.optional && !evidence.path) return "not_provided";
  if (evidence.missing) return evidence.optional ? "not_provided" : "missing";
  if (evidence.invalid) return "invalid";
  if (blockerCodes.includes("unsafe_evidence_value")) return "unsafe";
  if (blockerCodes.length > 0) return "blocked";
  return "ready";
}

function defaultManifestPath(): string | undefined {
  const roots = uniqueStrings([
    packageRootFor(process.cwd()),
    packageRootFor(dirname(fileURLToPath(import.meta.url)))
  ].filter((root): root is string => Boolean(root)));
  for (const root of roots) {
    const candidate = join(root, "openclaw.plugin.json");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function packageRootFor(start: string): string | undefined {
  let cursor = resolve(start);
  while (true) {
    const packageJsonPath = join(cursor, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown };
        if (parsed.name === PACKAGE_NAME) return cursor;
      } catch {
        return undefined;
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

function evidenceRef(path: string, evidenceDir: string): string {
  const ref = isPathInside(path, evidenceDir) ? relative(evidenceDir, path) || basename(path) : basename(path);
  return safeEvidenceRef(ref);
}

function safeEvidenceRef(value: string): string {
  if (SECRET_LIKE_PATTERN.test(value) || RAW_ARTIFACT_REF_PATTERN.test(value) || RAW_ARTIFACT_VALUE_PATTERN.test(value)) {
    return "redacted-evidence-ref";
  }
  return value;
}

function isPathInside(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function readPath(record: JsonRecord, path: string[]): unknown {
  let cursor: unknown = record;
  for (const part of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function titleForSource(source: LoadedEvidence["source"]): string {
  if (source === "toolSmokeReport") return "OpenClaw tool-smoke report";
  if (source === "dogfoodReport") return "OpenClaw dogfood report";
  if (source === "publishedSmoke") return "Published-package smoke report";
  return "OpenClaw plugin manifest";
}

function nextSafeCommands(options: QaLabToolCoverageOptions, missingDeclaredTools: string[]): string[] {
  const evidenceDir = "<evidence-dir>";
  const commands = [
    `loo openclaw tool-smoke --evidence-path ${join(evidenceDir, "openclaw-tool-smoke.json")} --required-tool <tool> --strict`,
    `loo qa-lab tool-coverage --evidence-dir ${evidenceDir} --tool-smoke-report ${join(evidenceDir, "openclaw-tool-smoke.json")} --coverage-policy full --strict`
  ];
  const safeMissingTools = missingDeclaredTools.filter(isValidLooToolName);
  if (safeMissingTools.length > 0) commands.unshift(`Add product-safe evidence for ${safeMissingTools.slice(0, 5).join(", ")}${safeMissingTools.length > 5 ? ", ..." : ""}.`);
  return commands;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
