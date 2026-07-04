import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type DistTag, distTagForVersion, registryStatusMatchesDistTag } from "./dist-tag.js";

export type GeneralReleaseReadinessOptions = {
  evidenceDir: string;
  freshNpmEvidence?: string;
  agentDogfoodEvidence?: string;
  now?: string;
  rootDir?: string;
};

export type GeneralReleaseReadinessCheck = {
  ok: boolean;
  detail: string;
  blocker?: string;
  setupRecovery?: {
    classification: string;
    ready: boolean | null;
    packageInstallLikelyOk: boolean | null;
    retryAfterSetup: boolean | null;
    requiredSetup: string[];
    nextSafeCommands: string[];
    guidance: string[];
    readinessProofSatisfied: boolean | null;
  };
};

export type GeneralReleaseReadinessReport = {
  ok: boolean;
  stableReady: boolean;
  generatedAt: string;
  packageName: string | null;
  packageVersion: string | null;
  readinessManifestPath: string;
  checks: Record<string, GeneralReleaseReadinessCheck>;
  blockers: string[];
  requiredEvidence: {
    freshNpmEvidence: string | null;
    agentDogfoodEvidence: string | null;
  };
  actionsPerformed: {
    npmPublished: false;
    githubReleaseCreated: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
  };
  proofBoundary: string;
  nextAction: string;
};

type JsonObject = Record<string, unknown>;

const REQUIRED_AGENT_WORKFLOW_MARKERS = [
  "doctor_ready",
  "search_source_ref",
  "describe_thread",
  "bounded_expand",
  "plan_lookup",
  "final_message_lookup",
  "touched_files_lookup",
  "dry_run_audit"
];

export function createGeneralReleaseReadiness(options: GeneralReleaseReadinessOptions): GeneralReleaseReadinessReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const rootDir = options.rootDir
    ? resolve(options.rootDir)
    : findPackageRoot(dirname(fileURLToPath(import.meta.url))) ?? process.cwd();
  const packageJson = readJson(join(rootDir, "package.json"));
  const packageName = readString(packageJson, "name");
  const packageVersion = readString(packageJson, "version");
  const expectedDistTag = distTagForVersion(packageVersion ?? "");
  const expectedPackage = packageName ? `${packageName}@${expectedDistTag}` : null;
  const releaseLabel = expectedPackage && packageVersion
    ? `${expectedPackage} (${packageVersion})`
    : "the current package release";
  const freshNpmEvidence = resolveEvidencePath(evidenceDir, options.freshNpmEvidence);
  const agentDogfoodEvidence = resolveEvidencePath(evidenceDir, options.agentDogfoodEvidence);
  const checks: Record<string, GeneralReleaseReadinessCheck> = {
    releaseChecklist: validateReleaseChecklist(rootDir),
    agentSkill: validateAgentSkill(rootDir),
    m9Scenarios: validateM9Scenarios(rootDir),
    docsTruth: validateDocsTruth(rootDir),
    freshNpmCleanProfile: validateFreshNpmEvidence(freshNpmEvidence, { expectedPackage, expectedDistTag }),
    agentDogfood: validateAgentDogfoodEvidence(agentDogfoodEvidence)
  };
  const blockers = Object.entries(checks)
    .filter(([, check]) => !check.ok)
    .map(([id, check]) => check.blocker ?? blockerForCheck(id));
  const readinessManifestPath = join(evidenceDir, "general-release-readiness.json");
  const report: GeneralReleaseReadinessReport = {
    ok: blockers.length === 0,
    stableReady: blockers.length === 0,
    generatedAt: options.now ?? new Date().toISOString(),
    packageName,
    packageVersion,
    readinessManifestPath,
    checks,
    blockers,
    requiredEvidence: {
      freshNpmEvidence: freshNpmEvidence ?? null,
      agentDogfoodEvidence: agentDogfoodEvidence ?? null
    },
    actionsPerformed: {
      npmPublished: false,
      githubReleaseCreated: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false
    },
    proofBoundary: `This gate defines and validates general-release readiness evidence for ${releaseLabel}; it does not publish npm, move npm dist-tags, create a GitHub Release, run live Codex control, mutate a GUI, claim Claude parity, or claim enterprise/customer-ready security.`,
    nextAction: blockers.length === 0
      ? "Use this packet as one input to a separate explicit stable release issue before any npm dist-tag promotion or GitHub Release."
      : "Produce the missing public-safe evidence or update docs before treating this release candidate as generally ready."
  };
  writeFileSync(readinessManifestPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function validateReleaseChecklist(rootDir: string): GeneralReleaseReadinessCheck {
  const checklist = readText(join(rootDir, "docs", "RELEASE_CHECKLIST.md"));
  return check(Boolean(
    checklist
    && /Every Release/i.test(checklist)
    && /Claim Tiers/i.test(checklist)
    && /loo release general-readiness/i.test(checklist)
    && /fresh npm/i.test(checklist)
    && /agent dogfood/i.test(checklist)
    && /Do not move `latest`/i.test(checklist)
    && /resume[\s\S]*steer[\s\S]*interrupt/i.test(checklist)
  ), "docs/RELEASE_CHECKLIST.md exists and names every-release, claim-tier, fresh npm, agent dogfood, latest, and control-matrix gates");
}

function validateAgentSkill(rootDir: string): GeneralReleaseReadinessCheck {
  const skill = readText(join(rootDir, "skills", "lossless-openclaw-orchestrator", "SKILL.md"));
  return check(Boolean(
    skill
    && /Safety Boundary/i.test(skill)
    && /Recommended Agent Loop/i.test(skill)
    && /loo_search_sessions/i.test(skill)
    && /loo_expand_query/i.test(skill)
    && /loo_codex_control_dry_run/i.test(skill)
    && /raw transcripts/i.test(skill)
  ), "agent skill exists and teaches staged recall plus dry-run boundaries");
}

function validateM9Scenarios(rootDir: string): GeneralReleaseReadinessCheck {
  const fresh = readJson(join(rootDir, "evals", "scenarios", "v1", "m9-fresh-npm-clean-profile.json"));
  const dogfood = readJson(join(rootDir, "evals", "scenarios", "v1", "m9-agent-dogfood-core-workflow.json"));
  return check(Boolean(
    readString(fresh, "id") === "m9-fresh-npm-clean-profile-v1"
    && readString(fresh, "surface") === "npm-openclaw-install"
    && readString(dogfood, "id") === "m9-agent-dogfood-core-workflow-v1"
    && readString(dogfood, "surface") === "openclaw-gateway"
  ), "M9 fresh npm and agent dogfood scenario contracts are present");
}

function validateDocsTruth(rootDir: string): GeneralReleaseReadinessCheck {
  const readme = readText(join(rootDir, "README.md"));
  const vision = readText(join(rootDir, "VISION.md"));
  const runbook = readText(join(rootDir, "docs", "BETA_RELEASE_RUNBOOK.md"));
  const surfaces = [readme, vision, runbook];
  return check(Boolean(
    surfaces.every((content) => content
      && /loo release general-readiness/i.test(content)
      && /fresh npm/i.test(content)
      && /agent dogfood/i.test(content))
  ), "README, VISION, and release runbook point to the general-readiness gate");
}

function validateFreshNpmEvidence(
  path: string | undefined,
  expected: { expectedPackage: string | null; expectedDistTag: DistTag }
): GeneralReleaseReadinessCheck {
  if (!path || !existsSync(path)) {
    return check(false, "fresh npm clean-profile evidence is missing", "fresh_npm_clean_profile_evidence_missing");
  }
  const report = readJson(path);
  if (report.publicSafe !== true) {
    return check(false, "fresh npm evidence is present but is not marked public-safe", "fresh_npm_clean_profile_not_public_safe");
  }
  if (!noReleaseActions(report)) {
    return check(false, "fresh npm evidence is present but performed restricted release/runtime actions", "fresh_npm_clean_profile_restricted_actions_performed");
  }
  if (expected.expectedDistTag !== "beta" && readString(report, "registryBetaVersion")) {
    return check(
      false,
      `fresh npm evidence uses legacy beta registry evidence, but this candidate requires ${expected.expectedPackage}`,
      "fresh_npm_clean_profile_wrong_dist_tag"
    );
  }
  const ready = Boolean(
    report.ok === true
    && report.publishedSmokeReady === true
    && report.packagePathOk === true
    && report.publicSafe === true
    && report.expectedPackage === expected.expectedPackage
    && report.expectedDistTag === expected.expectedDistTag
    && registryStatusMatchesDistTag(report.versionMatchStatus, expected.expectedDistTag)
    && readNestedBoolean(report, ["dogfood", "dogfoodReady"])
    && readNestedBoolean(report, ["dogfood", "requiredToolsPresent"])
    && readNestedBoolean(report, ["toolSmoke", "toolSmokeReady"])
    && readNestedString(report, ["toolSmoke", "gatewaySetupClassification"]) === "ready"
    && readNestedBoolean(report, ["toolSmoke", "packageInstallLikelyOk"])
    && report.setupRequired === false
    && noReleaseActions(report)
  );
  if (ready) {
    return check(true, `fresh npm ${expected.expectedDistTag} install, clean-profile plugin load, and gateway invocation are public-safe and ready`);
  }
  if (report.expectedPackage && expected.expectedPackage && report.expectedPackage !== expected.expectedPackage) {
    return check(
      false,
      `fresh npm evidence is for ${report.expectedPackage}, but this candidate requires ${expected.expectedPackage}`,
      "fresh_npm_clean_profile_wrong_dist_tag"
    );
  }
  if (typeof report.versionMatchStatus === "string" && !registryStatusMatchesDistTag(report.versionMatchStatus, expected.expectedDistTag)) {
    return check(
      false,
      `fresh npm evidence registry match status ${report.versionMatchStatus} does not match expected ${expected.expectedDistTag} dist-tag`,
      "fresh_npm_clean_profile_registry_version_mismatch"
    );
  }
  const setupRecovery = readSetupRecovery(report);
  if (setupRecovery && setupRecovery.classification !== "ready") {
    return check(
      false,
      `fresh npm evidence is present; clean-profile setup recovery is ${setupRecovery.classification}`,
      freshNpmSetupRecoveryBlocker(setupRecovery.classification),
      setupRecovery
    );
  }
  return check(false, "fresh npm evidence is present but clean-profile package/gateway proof is not ready", "fresh_npm_clean_profile_not_ready");
}

function validateAgentDogfoodEvidence(path: string | undefined): GeneralReleaseReadinessCheck {
  if (!path || !existsSync(path)) return check(false, "agent dogfood evidence is missing");
  const report = readJson(path);
  const workflowEvidence = readNestedStringArray(report, ["agentReasoning", "workflowEvidence"]);
  return check(Boolean(
    report.ok === true
    && report.toolSmokeReady === true
    && report.publicSafe === true
    && readNestedBoolean(report, ["catalog", "requiredToolsPresent"])
    && readNestedString(report, ["setupStatus", "classification"]) === "ready"
    && readNestedBoolean(report, ["setupStatus", "packageInstallLikelyOk"])
    && readNestedBoolean(report, ["agentReasoning", "rawTranscriptRead"]) === false
    && readNestedBoolean(report, ["agentReasoning", "dryRunLive"]) === false
    && REQUIRED_AGENT_WORKFLOW_MARKERS.every((marker) => workflowEvidence.includes(marker))
    && noReleaseActions(report)
  ), "agent dogfood proves search, describe, expand, details, recommendation, and dry-run through gateway tools");
}

function blockerForCheck(id: string): string {
  const blockers: Record<string, string> = {
    releaseChecklist: "release_checklist_missing_or_incomplete",
    agentSkill: "agent_skill_missing_or_incomplete",
    m9Scenarios: "m9_scenario_contracts_missing_or_incomplete",
    docsTruth: "docs_general_readiness_links_missing",
    freshNpmCleanProfile: "fresh_npm_clean_profile_evidence_missing",
    agentDogfood: "agent_dogfood_evidence_missing"
  };
  return blockers[id] ?? `${id}_failed`;
}

function check(
  ok: boolean,
  detail: string,
  blocker?: string,
  setupRecovery?: GeneralReleaseReadinessCheck["setupRecovery"]
): GeneralReleaseReadinessCheck {
  return {
    ok,
    detail,
    ...(blocker ? { blocker } : {}),
    ...(setupRecovery ? { setupRecovery } : {})
  };
}

function readSetupRecovery(report: JsonObject): GeneralReleaseReadinessCheck["setupRecovery"] | null {
  const classification = readNestedString(report, ["setupRecovery", "classification"]);
  if (!classification) return null;
  return {
    classification,
    ready: readNestedBoolean(report, ["setupRecovery", "ready"]),
    packageInstallLikelyOk: readNestedBoolean(report, ["setupRecovery", "packageInstallLikelyOk"]),
    retryAfterSetup: readNestedBoolean(report, ["setupRecovery", "retryAfterSetup"]),
    requiredSetup: readNestedStringArray(report, ["setupRecovery", "requiredSetup"]),
    nextSafeCommands: readNestedStringArray(report, ["setupRecovery", "nextSafeCommands"]),
    guidance: readNestedStringArray(report, ["setupRecovery", "guidance"]),
    readinessProofSatisfied: readNestedBoolean(report, ["setupRecovery", "readinessProof", "satisfied"])
  };
}

function freshNpmSetupRecoveryBlocker(classification: string): string {
  const safe = classification.replace(/[^a-z0-9_]+/gi, "_").toLowerCase();
  return `fresh_npm_clean_profile_${safe}`;
}

function resolveEvidencePath(evidenceDir: string, path: string | undefined): string | undefined {
  if (!path) return undefined;
  return isAbsolute(path) ? path : join(evidenceDir, path);
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readJson(path: string): JsonObject {
  const text = readText(path);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

function readString(input: JsonObject, key: string): string | null {
  const value = input[key];
  return typeof value === "string" ? value : null;
}

function readNestedString(input: JsonObject, path: string[]): string | null {
  const value = readNested(input, path);
  return typeof value === "string" ? value : null;
}

function readNestedBoolean(input: JsonObject, path: string[]): boolean | null {
  const value = readNested(input, path);
  return typeof value === "boolean" ? value : null;
}

function readNestedStringArray(input: JsonObject, path: string[]): string[] {
  const value = readNested(input, path);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readNested(input: JsonObject, path: string[]): unknown {
  let cursor: unknown = input;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as JsonObject)[key];
  }
  return cursor;
}

function noReleaseActions(report: JsonObject): boolean {
  return readNestedBoolean(report, ["actionsPerformed", "npmPublished"]) === false
    && readNestedBoolean(report, ["actionsPerformed", "githubReleaseCreated"]) === false
    && readNestedBoolean(report, ["actionsPerformed", "liveCodexControlRun"]) === false
    && readNestedBoolean(report, ["actionsPerformed", "desktopGuiActionRun"]) === false;
}

function findPackageRoot(start: string): string | null {
  let cursor = start;
  while (true) {
    if (existsSync(join(cursor, "package.json"))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}
