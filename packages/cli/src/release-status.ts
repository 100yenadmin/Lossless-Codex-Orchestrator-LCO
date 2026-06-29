import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runReleasePreflight, type ReleasePreflightReport } from "./release-preflight.js";

export type ReleaseStatusOptions = {
  evidenceDir: string;
  approvedLiveControlEvidence?: string;
  npmPublishApprovalEvidence?: string;
  githubReleaseApprovalEvidence?: string;
  desktopGuiApprovalEvidence?: string;
  now?: string;
  rootDir?: string;
};

export type ReleaseApprovalStatus = {
  id: "approved_live_control_smoke" | "npm_publish" | "github_release" | "desktop_gui_mutation";
  satisfied: boolean;
};

type ReleaseOperationApprovalProof = {
  kind?: string;
  operation?: ReleaseOperationApproval;
  approved?: boolean;
  approvalRef?: string;
  rawSecretIncluded?: boolean;
};

type ReleaseOperationApproval = "npm_publish" | "github_release" | "desktop_gui_mutation";

export type ReleaseStatusReport = {
  ok: boolean;
  releaseReady: boolean;
  generatedAt: string;
  packageName: string | null;
  packageVersion: string | null;
  statusManifestPath: string;
  blockers: string[];
  explicitApprovalsRequired: ReleaseApprovalStatus[];
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
  const releasePreflight = runReleasePreflight({
    evidenceDir,
    approvedLiveControlEvidence: options.approvedLiveControlEvidence,
    now: options.now,
    rootDir: options.rootDir
  });
  const liveControlSmokeSatisfied = !releasePreflight.blockers.includes("approved_live_control_smoke_missing");
  const npmPublishSatisfied = validateReleaseOperationApprovalProof(options.npmPublishApprovalEvidence, "npm_publish");
  const githubReleaseSatisfied = validateReleaseOperationApprovalProof(options.githubReleaseApprovalEvidence, "github_release");
  const desktopGuiSatisfied = validateReleaseOperationApprovalProof(options.desktopGuiApprovalEvidence, "desktop_gui_mutation");
  const explicitApprovalsRequired: ReleaseApprovalStatus[] = [
    { id: "approved_live_control_smoke", satisfied: liveControlSmokeSatisfied },
    { id: "npm_publish", satisfied: npmPublishSatisfied },
    { id: "github_release", satisfied: githubReleaseSatisfied },
    { id: "desktop_gui_mutation", satisfied: desktopGuiSatisfied }
  ];
  const blockers = [...releasePreflight.blockers];
  if (!npmPublishSatisfied) blockers.push("npm_publish_not_approved");
  if (!githubReleaseSatisfied) blockers.push("github_release_not_approved");
  if (!desktopGuiSatisfied) blockers.push("desktop_gui_mutation_not_approved");
  const statusManifestPath = join(evidenceDir, "release-status.json");
  const report: ReleaseStatusReport = {
    ok: blockers.length === 0,
    releaseReady: blockers.length === 0,
    generatedAt: options.now ?? new Date().toISOString(),
    packageName: releasePreflight.packageName,
    packageVersion: releasePreflight.packageVersion,
    statusManifestPath,
    blockers,
    explicitApprovalsRequired,
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

function validateReleaseOperationApprovalProof(path: string | undefined, operation: ReleaseOperationApproval): boolean {
  if (!path || !existsSync(path)) return false;
  let proof: ReleaseOperationApprovalProof;
  try {
    proof = JSON.parse(readFileSync(path, "utf8")) as ReleaseOperationApprovalProof;
  } catch {
    return false;
  }
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return false;
  const allowedKeys = new Set(["kind", "operation", "approved", "approvalRef", "rawSecretIncluded"]);
  return proof.kind === "loo_release_operation_approval"
    && proof.operation === operation
    && proof.approved === true
    && typeof proof.approvalRef === "string"
    && Boolean(proof.approvalRef.trim())
    && proof.rawSecretIncluded === false
    && Object.keys(proof).every((key) => allowedKeys.has(key));
}
