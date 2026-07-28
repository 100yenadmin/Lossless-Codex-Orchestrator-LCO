import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export type HermesReadinessOptions = {
  evidenceDir: string;
  packageVersion: string;
  candidateSha: string;
  hermesSmokePath: string;
  packageSmokePath: string;
  now?: string;
};

export type HermesReadinessReport = {
  schema: "lco.release.hermesReadiness.v1";
  ok: boolean;
  candidateReady: boolean;
  publicSafe: true;
  generatedAt: string;
  packageVersion: string;
  candidateSha: string;
  checks: {
    hermesSmoke: boolean;
    candidatePackageSmoke: boolean;
    identityMatch: boolean;
    restrictedActionsAbsent: boolean;
  };
  requiredEvidence: {
    hermesSmoke: string;
    packageSmoke: string;
  };
  blockers: string[];
  actionsPerformed: {
    npmPublished: false;
    githubReleaseCreated: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    screenshotsCaptured: false;
  };
  proofBoundary: string;
  nextAction: string;
};

type JsonObject = Record<string, unknown>;

export function createHermesReadinessReport(options: HermesReadinessOptions): HermesReadinessReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const hermesSmokePath = resolve(options.hermesSmokePath);
  const packageSmokePath = resolve(options.packageSmokePath);
  const hermesSmoke = readJson(hermesSmokePath);
  const packageSmoke = readJson(packageSmokePath);
  const blockers: string[] = [];

  validateReport({
    report: hermesSmoke,
    path: hermesSmokePath,
    label: "hermes_smoke",
    expectedSchema: "lco.hermesSmoke.v1",
    expectedVersion: options.packageVersion,
    expectedSha: options.candidateSha,
    blockers
  });
  validateReport({
    report: packageSmoke,
    path: packageSmokePath,
    label: "candidate_package_smoke",
    expectedSchema: "lco.qaLab.cliMcpProductSmoke.v1",
    expectedVersion: options.packageVersion,
    expectedSha: options.candidateSha,
    blockers
  });

  const hermesSmokeReady = reportReady(hermesSmoke, "lco.hermesSmoke.v1");
  const packageSmokeReady = reportReady(packageSmoke, "lco.qaLab.cliMcpProductSmoke.v1");
  const identityMatch = reportIdentityMatches(hermesSmoke, options)
    && reportIdentityMatches(packageSmoke, options);
  const restrictedActionsAbsent = noRestrictedActions(hermesSmoke)
    && noRestrictedActions(packageSmoke);
  const uniqueBlockers = [...new Set(blockers)];
  const candidateReady = uniqueBlockers.length === 0
    && hermesSmokeReady
    && packageSmokeReady
    && identityMatch
    && restrictedActionsAbsent;
  const report: HermesReadinessReport = {
    schema: "lco.release.hermesReadiness.v1",
    ok: candidateReady,
    candidateReady,
    publicSafe: true,
    generatedAt: options.now ?? new Date().toISOString(),
    packageVersion: options.packageVersion,
    candidateSha: options.candidateSha,
    checks: {
      hermesSmoke: hermesSmokeReady,
      candidatePackageSmoke: packageSmokeReady,
      identityMatch,
      restrictedActionsAbsent
    },
    requiredEvidence: {
      hermesSmoke: basename(hermesSmokePath),
      packageSmoke: basename(packageSmokePath)
    },
    blockers: uniqueBlockers,
    actionsPerformed: restrictedActions(),
    proofBoundary: "This aggregate report may prove that the named source candidate passed sanitized package and Hermes compatibility smoke. It does not prove merge, publication, or active Eva runtime; it does not publish npm, create a tag or GitHub Release, change a Hermes profile, or run live Codex control.",
    nextAction: candidateReady
      ? "Use this candidate packet with current-head CI and independent review before requesting merge authority."
      : "Repair the named candidate evidence blockers and rerun the same smoke inputs."
  };
  writeFileSync(join(evidenceDir, "hermes-readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function validateReport(options: {
  report: JsonObject;
  path: string;
  label: string;
  expectedSchema: string;
  expectedVersion: string;
  expectedSha: string;
  blockers: string[];
}): void {
  if (!existsSync(options.path) || Object.keys(options.report).length === 0) {
    options.blockers.push(`${options.label}_missing`);
    return;
  }
  if (options.report.schema !== options.expectedSchema) options.blockers.push(`${options.label}_schema_invalid`);
  if (options.report.publicSafe !== true) options.blockers.push(`${options.label}_not_public_safe`);
  if (options.report.ok !== true) options.blockers.push(`${options.label}_not_ready`);
  if (options.report.packageVersion !== options.expectedVersion) options.blockers.push(`${options.label}_package_version_mismatch`);
  if (options.report.candidateSha !== options.expectedSha) options.blockers.push(`${options.label}_candidate_sha_mismatch`);
  if (!noRestrictedActions(options.report)) options.blockers.push(`${options.label}_restricted_actions_performed`);
}

function reportReady(report: JsonObject, schema: string): boolean {
  return report.schema === schema && report.ok === true && report.publicSafe === true;
}

function reportIdentityMatches(
  report: JsonObject,
  expected: { packageVersion: string; candidateSha: string }
): boolean {
  return report.packageVersion === expected.packageVersion && report.candidateSha === expected.candidateSha;
}

function noRestrictedActions(report: JsonObject): boolean {
  const actions = isRecord(report.actionsPerformed) ? report.actionsPerformed : {};
  return actions.npmPublished !== true
    && actions.githubReleaseCreated !== true
    && actions.liveCodexControlRun !== true
    && actions.desktopGuiActionRun !== true
    && actions.screenshotsCaptured !== true;
}

function restrictedActions(): HermesReadinessReport["actionsPerformed"] {
  return {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false,
    screenshotsCaptured: false
  };
}

function readJson(path: string): JsonObject {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
