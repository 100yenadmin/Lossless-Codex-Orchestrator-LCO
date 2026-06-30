import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { runReleasePreflight, type ReleasePreflightReport } from "./release-preflight.js";
import {
  releaseClaimScopeRequiresLiveControl,
  type ReleaseClaimScope,
  type ReleaseExcludedClaim
} from "./release-claim-scope.js";

export type ReleaseStatusOptions = {
  evidenceDir: string;
  candidateSha?: string;
  approvedLiveControlEvidence?: string;
  claimScope?: ReleaseClaimScope;
  runtimeProofDir?: string;
  npmPublishApprovalEvidence?: string;
  githubReleaseApprovalEvidence?: string;
  desktopGuiApprovalEvidence?: string;
  githubCiEvidence?: string;
  codeqlEvidence?: string;
  desktopGuiRequired?: boolean;
  now?: string;
  rootDir?: string;
};

export type ReleaseApprovalStatus = {
  id: "approved_live_control_smoke" | "npm_publish" | "github_release" | "desktop_gui_mutation";
  satisfied: boolean;
};

export type ReleaseCheckStatus = {
  id: "candidate_sha" | "github_ci" | "codeql";
  satisfied: boolean;
};

type ReleaseOperationApprovalProof = {
  kind?: string;
  operation?: ReleaseOperationApproval;
  approved?: boolean;
  approvalRef?: string;
  desktopBackend?: string;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  actionHash?: string;
  approvalNonce?: string;
  issuedAt?: string;
  expiresAt?: string;
  focusBeforeApplication?: string;
  focusAfterApplication?: string;
  focusChanged?: boolean;
  focusProof?: string;
  rawScreenshotIncluded?: boolean;
  rawSecretIncluded?: boolean;
};

type ReleaseOperationApproval = "npm_publish" | "github_release" | "desktop_gui_mutation";
type ReleaseCheckId = "github_ci" | "codeql";

type ReleaseCheckProof = {
  kind?: string;
  check?: ReleaseCheckId;
  commitSha?: string;
  status?: string;
  conclusion?: string;
  runUrl?: string;
  warnings?: unknown;
  rawSecretIncluded?: boolean;
};

type ReleaseCheckValidation = {
  satisfied: boolean;
  blocker?: string;
};

export type ReleaseStatusReport = {
  ok: boolean;
  releaseReady: boolean;
  generatedAt: string;
  claimScope: ReleaseClaimScope;
  excludedClaims: ReleaseExcludedClaim[];
  packageName: string | null;
  packageVersion: string | null;
  statusManifestPath: string;
  blockers: string[];
  explicitApprovalsRequired: ReleaseApprovalStatus[];
  releaseChecks: ReleaseCheckStatus[];
  actionsPerformed: {
    npmPublished: false;
    githubReleaseCreated: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
  };
  forbiddenActions: string[];
  releasePreflight: ReleasePreflightReport;
};

export function createReleaseStatus(options: ReleaseStatusOptions): ReleaseStatusReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const generatedAt = options.now ?? new Date().toISOString();
  const candidateSha = options.candidateSha?.trim();
  const candidateShaSatisfied = Boolean(candidateSha && /^[0-9a-f]{40}$/i.test(candidateSha));
  const approvedLiveControlEvidence = resolveEvidencePath(evidenceDir, options.approvedLiveControlEvidence);
  const npmPublishApprovalEvidence = resolveEvidencePath(evidenceDir, options.npmPublishApprovalEvidence);
  const githubReleaseApprovalEvidence = resolveEvidencePath(evidenceDir, options.githubReleaseApprovalEvidence);
  const desktopGuiApprovalEvidence = resolveEvidencePath(evidenceDir, options.desktopGuiApprovalEvidence);
  const githubCiEvidence = resolveEvidencePath(evidenceDir, options.githubCiEvidence);
  const codeqlEvidence = resolveEvidencePath(evidenceDir, options.codeqlEvidence);
  const releasePreflight = runReleasePreflight({
    evidenceDir,
    approvedLiveControlEvidence,
    claimScope: options.claimScope,
    runtimeProofDir: options.runtimeProofDir,
    now: options.now,
    rootDir: options.rootDir
  });
  const liveControlRequired = releaseClaimScopeRequiresLiveControl(releasePreflight.claimScope);
  const liveControlSmokeSatisfied = liveControlRequired && !releasePreflight.blockers.includes("approved_live_control_smoke_missing");
  const npmPublishSatisfied = validateReleaseOperationApprovalProof(npmPublishApprovalEvidence, "npm_publish", generatedAt);
  const githubReleaseSatisfied = validateReleaseOperationApprovalProof(githubReleaseApprovalEvidence, "github_release", generatedAt);
  const desktopGuiRequired = options.desktopGuiRequired === true;
  const desktopGuiSatisfied = desktopGuiRequired
    ? validateReleaseOperationApprovalProof(desktopGuiApprovalEvidence, "desktop_gui_mutation", generatedAt)
    : false;
  const githubCiValidation = validateReleaseCheckProof(githubCiEvidence, "github_ci", candidateSha);
  const codeqlValidation = validateReleaseCheckProof(codeqlEvidence, "codeql", candidateSha);
  const explicitApprovalsRequired: ReleaseApprovalStatus[] = [
    { id: "npm_publish", satisfied: npmPublishSatisfied },
    { id: "github_release", satisfied: githubReleaseSatisfied }
  ];
  if (liveControlRequired) explicitApprovalsRequired.unshift({ id: "approved_live_control_smoke", satisfied: liveControlSmokeSatisfied });
  if (desktopGuiRequired) explicitApprovalsRequired.push({ id: "desktop_gui_mutation", satisfied: desktopGuiSatisfied });
  const releaseChecks: ReleaseCheckStatus[] = [
    { id: "candidate_sha", satisfied: candidateShaSatisfied },
    { id: "github_ci", satisfied: githubCiValidation.satisfied },
    { id: "codeql", satisfied: codeqlValidation.satisfied }
  ];
  const blockers = [...releasePreflight.blockers];
  if (!npmPublishSatisfied) blockers.push("npm_publish_not_approved");
  if (!githubReleaseSatisfied) blockers.push("github_release_not_approved");
  if (desktopGuiRequired && !desktopGuiSatisfied) blockers.push("desktop_gui_mutation_not_approved");
  if (!candidateShaSatisfied) blockers.push(candidateSha ? "candidate_sha_invalid" : "candidate_sha_missing");
  if (githubCiValidation.blocker) blockers.push(githubCiValidation.blocker);
  if (codeqlValidation.blocker) blockers.push(codeqlValidation.blocker);
  const statusManifestPath = join(evidenceDir, "release-status.json");
  const report: ReleaseStatusReport = {
    ok: blockers.length === 0,
    releaseReady: blockers.length === 0,
    generatedAt,
    claimScope: releasePreflight.claimScope,
    excludedClaims: releasePreflight.excludedClaims,
    packageName: releasePreflight.packageName,
    packageVersion: releasePreflight.packageVersion,
    statusManifestPath,
    blockers,
    explicitApprovalsRequired,
    releaseChecks,
    actionsPerformed: {
      npmPublished: false,
      githubReleaseCreated: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false
    },
    forbiddenActions: [
      "npm publish",
      "GitHub Release creation",
      "live Codex control",
      "desktop GUI mutation"
    ],
    releasePreflight
  };

  writeFileSync(statusManifestPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function resolveEvidencePath(evidenceDir: string, path: string | undefined): string | undefined {
  if (!path) return undefined;
  return isAbsolute(path) ? path : join(evidenceDir, path);
}

function validateReleaseOperationApprovalProof(path: string | undefined, operation: ReleaseOperationApproval, nowIso: string): boolean {
  if (!path || !existsSync(path)) return false;
  let proof: ReleaseOperationApprovalProof;
  try {
    proof = JSON.parse(readFileSync(path, "utf8")) as ReleaseOperationApprovalProof;
  } catch {
    return false;
  }
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return false;
  const allowedKeys = new Set(["kind", "operation", "approved", "approvalRef", "rawSecretIncluded"]);
  const commonApprovalValid = proof.kind === "loo_release_operation_approval"
    && proof.operation === operation
    && proof.approved === true
    && typeof proof.approvalRef === "string"
    && Boolean(proof.approvalRef.trim())
    && proof.rawSecretIncluded === false;
  if (!commonApprovalValid) return false;
  if (operation !== "desktop_gui_mutation") return Object.keys(proof).every((key) => allowedKeys.has(key));

  const desktopAllowedKeys = new Set([
    ...allowedKeys,
    "desktopBackend",
    "targetApp",
    "targetWindow",
    "action",
    "actionHash",
    "approvalNonce",
    "issuedAt",
    "expiresAt",
    "focusBeforeApplication",
    "focusAfterApplication",
    "focusChanged",
    "focusProof",
    "rawScreenshotIncluded"
  ]);
  return stringFieldPresent(proof.desktopBackend)
    && stringFieldPresent(proof.targetApp)
    && stringFieldPresent(proof.targetWindow)
    && stringFieldPresent(proof.action)
    && hashFieldPresent(proof.actionHash)
    && stringFieldPresent(proof.approvalNonce)
    && desktopGuiApprovalFresh(proof, nowIso)
    && stringFieldPresent(proof.focusBeforeApplication)
    && stringFieldPresent(proof.focusAfterApplication)
    && proof.focusBeforeApplication === proof.focusAfterApplication
    && proof.focusChanged === false
    && actionFocusProofFieldPresent(proof.focusProof)
    && proof.rawScreenshotIncluded === false
    && Object.keys(proof).every((key) => desktopAllowedKeys.has(key));
}

function desktopGuiApprovalFresh(proof: ReleaseOperationApprovalProof, nowIso: string): boolean {
  if (!stringFieldPresent(proof.issuedAt) || !stringFieldPresent(proof.expiresAt)) return false;
  const nowMs = Date.parse(nowIso);
  const issuedAtMs = Date.parse(proof.issuedAt);
  const expiresAtMs = Date.parse(proof.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) return false;
  if (expiresAtMs <= issuedAtMs) return false;
  const futureSkewMs = 5 * 60 * 1000;
  if (issuedAtMs > nowMs + futureSkewMs) return false;
  return expiresAtMs > nowMs;
}

function validateReleaseCheckProof(path: string | undefined, check: ReleaseCheckId, candidateSha: string | undefined): ReleaseCheckValidation {
  if (!path) return { satisfied: false, blocker: `${check}_evidence_missing` };
  if (!existsSync(path)) return { satisfied: false, blocker: `${check}_evidence_missing` };
  let proof: ReleaseCheckProof;
  try {
    proof = JSON.parse(readFileSync(path, "utf8")) as ReleaseCheckProof;
  } catch {
    return { satisfied: false, blocker: `${check}_evidence_invalid` };
  }
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return { satisfied: false, blocker: `${check}_evidence_invalid` };
  const allowedKeys = new Set(["kind", "check", "commitSha", "status", "conclusion", "runUrl", "warnings", "rawSecretIncluded"]);
  const warnings = proof.warnings;
  if (proof.kind !== "loo_release_check_evidence"
    || proof.check !== check
    || typeof proof.commitSha !== "string"
    || typeof proof.status !== "string"
    || typeof proof.conclusion !== "string"
    || proof.rawSecretIncluded !== false
    || (warnings !== undefined && !Array.isArray(warnings))
    || !Object.keys(proof).every((key) => allowedKeys.has(key))) {
    return { satisfied: false, blocker: `${check}_evidence_invalid` };
  }
  if (!candidateSha || !/^[0-9a-f]{40}$/i.test(candidateSha)) return { satisfied: false, blocker: `${check}_sha_mismatch` };
  if (proof.commitSha.toLowerCase() !== candidateSha.toLowerCase()) return { satisfied: false, blocker: `${check}_sha_mismatch` };
  if (proof.status !== "completed") return { satisfied: false, blocker: `${check}_pending` };
  if (proof.conclusion !== "success") return { satisfied: false, blocker: `${check}_failed` };
  if (Array.isArray(warnings) && warnings.length > 0) return { satisfied: false, blocker: `${check}_warnings_present` };
  return { satisfied: true };
}

function stringFieldPresent(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function hashFieldPresent(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function actionFocusProofFieldPresent(value: unknown): value is string {
  if (!stringFieldPresent(value)) return false;
  const diagnosticOnlyProofs = new Set(["not_measured", "status_probe_only_no_action"]);
  return !diagnosticOnlyProofs.has(value.trim().toLowerCase());
}
