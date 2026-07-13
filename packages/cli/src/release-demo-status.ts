import { randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readlinkSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  excludedClaimsForScope,
  liveControlExcludedDetail,
  normalizeReleaseClaimScope,
  releaseClaimScopeRequiresLiveControl,
  releaseClaimScopeRequiresWorkingAppRuntimeProof,
  type ReleaseClaimScope,
  type ReleaseExcludedClaim
} from "./release-claim-scope.js";
import { validateWorkingAppRuntimeProof } from "./runtime-proof-gate.js";

export type ReleaseDemoStatusOptions = {
  evidenceDir: string;
  candidateSha?: string;
  approvedLiveControlEvidence?: string;
  claimScope?: ReleaseClaimScope;
  runtimeProofDir?: string;
  minSessions?: number;
  now?: string;
};

export type ReleaseDemoStatusCheck = {
  ok: boolean;
  detail: string;
};

export type ReleaseDemoStatusReport = {
  ok: boolean;
  demoReady: boolean;
  generatedAt: string;
  claimScope: ReleaseClaimScope;
  excludedClaims: ReleaseExcludedClaim[];
  demoStatusManifestPath: string;
  minSessions: number;
  blockers: string[];
  checks: Record<string, ReleaseDemoStatusCheck>;
  evidenceFiles: Record<string, string>;
  rawSessionArtifacts: RawDemoArtifact[];
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    npmPublished: false;
    githubReleaseCreated: false;
  };
  forbiddenActions: string[];
};

type RawDemoArtifact = {
  name: string;
  reason: "raw_codex_jsonl" | "sqlite_database" | "screenshot_or_image" | "video_capture" | "symlinked_directory" | "symlinked_artifact";
};

type JsonReadResult = {
  value: unknown | null;
  error: string | null;
};

type ApprovedLiveControlSmokeProof = {
  kind?: string;
  approvedLiveControlSmoke?: boolean;
  action?: string;
  targetRef?: string;
  candidateSha?: string;
  approvalAuditId?: string;
  messageHash?: string;
  preservesCodexApprovalSemantics?: boolean;
  rawPromptIncluded?: boolean;
};

const DEFAULT_MIN_SESSIONS = 100;
type SearchEvidenceKind = "plan" | "final";
type ControlDryRunProof = {
  action: string;
  threadId: string;
  approvalAuditId: string;
  paramsHash: string;
  messageHash?: string;
};
type ApprovedProofResult = {
  check: ReleaseDemoStatusCheck;
  proof: ApprovedLiveControlSmokeProof | null;
};

export function createReleaseDemoStatus(options: ReleaseDemoStatusOptions): ReleaseDemoStatusReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const demoStatusManifestName = "release-demo-status.json";

  const claimScope = normalizeReleaseClaimScope(options.claimScope);
  const liveControlRequired = releaseClaimScopeRequiresLiveControl(claimScope);
  const workingAppRuntimeProofRequired = releaseClaimScopeRequiresWorkingAppRuntimeProof(claimScope);
  const excludedClaims = excludedClaimsForScope(claimScope);
  const minSessions = options.minSessions ?? DEFAULT_MIN_SESSIONS;
  const evidenceFilePaths = {
    index: join(evidenceDir, "index-codex.json"),
    planSearch: join(evidenceDir, "plans-search.json"),
    finalSearch: join(evidenceDir, "finals-search.json"),
    briefExpansion: join(evidenceDir, "expand-brief.json"),
    evidenceExpansion: join(evidenceDir, "expand-evidence.json"),
    controlDryRun: join(evidenceDir, "control-dry-run.json"),
    approvedLiveControl: resolveEvidencePath(evidenceDir, options.approvedLiveControlEvidence ?? "approved-live-control-smoke.json")
  };
  const evidenceFiles = {
    index: "index-codex.json",
    planSearch: "plans-search.json",
    finalSearch: "finals-search.json",
    briefExpansion: "expand-brief.json",
    evidenceExpansion: "expand-evidence.json",
    controlDryRun: "control-dry-run.json",
    approvedLiveControl: basename(evidenceFilePaths.approvedLiveControl)
  };

  const indexEvidence = readJson(evidenceFilePaths.index);
  const planSearchEvidence = readJson(evidenceFilePaths.planSearch);
  const finalSearchEvidence = readJson(evidenceFilePaths.finalSearch);
  const briefExpansionEvidence = readJson(evidenceFilePaths.briefExpansion);
  const evidenceExpansionEvidence = readJson(evidenceFilePaths.evidenceExpansion);
  const controlDryRunEvidence = readJson(evidenceFilePaths.controlDryRun);
  const controlDryRunProof = parseControlDryRun(controlDryRunEvidence.value);
  const approvedLiveControl = liveControlRequired
    ? validateApprovedLiveControlProof(evidenceFilePaths.approvedLiveControl, options.candidateSha)
    : { check: check(false, liveControlExcludedDetail(claimScope)), proof: null };
  const workingAppRuntimeProof = workingAppRuntimeProofRequired
    ? validateWorkingAppRuntimeProof(options.runtimeProofDir)
    : null;
  const rawSessionArtifacts = scanRawDemoArtifacts(evidenceDir);

  const checks: Record<string, ReleaseDemoStatusCheck> = {
    indexedSessions: check(observedIndexedSessions(indexEvidence.value) >= minSessions, demoReadError(indexEvidence) ?? `observed ${observedIndexedSessions(indexEvidence.value)} indexed sessions; expected at least ${minSessions}`),
    importerErrors: check(readArray(indexEvidence.value, "errors")?.length === 0, demoReadError(indexEvidence) ?? "Codex index evidence must report zero importer errors"),
    limitedFiles: check(readArray(indexEvidence.value, "limitedFiles")?.length === 0, demoReadError(indexEvidence) ?? "Codex index evidence must report zero unexpected limited files"),
    planSearch: check(hasSearchHit(planSearchEvidence.value, "plan"), demoReadError(planSearchEvidence) ?? "plan search evidence must include at least one codex_thread hit with plan proof"),
    finalSearch: check(hasSearchHit(finalSearchEvidence.value, "final"), demoReadError(finalSearchEvidence) ?? "final-message search evidence must include at least one codex_thread hit with final-message proof"),
    briefExpansion: check(hasExpansion(briefExpansionEvidence.value, "brief"), demoReadError(briefExpansionEvidence) ?? "brief expansion evidence must include codex_thread text with the brief profile"),
    evidenceExpansion: check(hasExpansion(evidenceExpansionEvidence.value, "evidence"), demoReadError(evidenceExpansionEvidence) ?? "evidence expansion proof must include codex_thread text with the evidence profile"),
    distinctExpansionRefs: check(hasDistinctExpansionRefs(briefExpansionEvidence.value, evidenceExpansionEvidence.value), "brief and evidence expansion files must reference two distinct codex_thread refs"),
    controlDryRun: check(Boolean(controlDryRunProof), demoReadError(controlDryRunEvidence) ?? "control dry-run evidence must include live=false, approval audit id, params hash, and message hash for send/steer"),
    rawArtifacts: check(rawSessionArtifacts.length === 0, rawSessionArtifacts.length === 0 ? "no raw session/private DB/screenshot artifacts found" : "raw/private artifacts are present in demo evidence"),
    approvedLiveControl: approvedLiveControl.check,
    approvedLiveControlMatchesDryRun: matchApprovedLiveControlToDryRun(approvedLiveControl.proof, controlDryRunProof),
    workingAppRuntimeProof: workingAppRuntimeProof
      ? check(
        workingAppRuntimeProof.ok,
        workingAppRuntimeProof.ok
          ? `${workingAppRuntimeProof.acceptedMarkerCount} runtime proof markers accepted for codex-working-app-proof`
          : "codex-working-app-proof requires public-safe runtime proof markers for #158 and #159 via --runtime-proof-dir"
      )
      : check(false, "working-app runtime proof is excluded by claim scope")
  };

  const blockers = [
    checks.indexedSessions.ok ? null : "codex_index_min_sessions_missing",
    checks.importerErrors.ok ? null : "codex_index_errors_present",
    checks.limitedFiles.ok ? null : "codex_index_limited_files_present",
    checks.planSearch.ok ? null : "plan_search_evidence_missing",
    checks.finalSearch.ok ? null : "final_search_evidence_missing",
    checks.briefExpansion.ok ? null : "brief_expansion_evidence_missing",
    checks.evidenceExpansion.ok ? null : "evidence_expansion_evidence_missing",
    checks.distinctExpansionRefs.ok ? null : "expansion_refs_not_distinct",
    checks.controlDryRun.ok ? null : "control_dry_run_evidence_missing",
    checks.rawArtifacts.ok ? null : "raw_session_artifacts_present",
    liveControlRequired && !checks.approvedLiveControl.ok ? "approved_live_control_smoke_missing" : null,
    checks.approvedLiveControlMatchesDryRun.ok ? null : "approved_live_control_dry_run_mismatch",
    ...(workingAppRuntimeProofRequired && workingAppRuntimeProof ? workingAppRuntimeProof.blockers : [])
  ].filter((blocker): blocker is string => blocker !== null);

  const demoStatusManifestPath = join(evidenceDir, demoStatusManifestName);
  const report: ReleaseDemoStatusReport = {
    ok: blockers.length === 0,
    demoReady: blockers.length === 0,
    generatedAt: options.now ?? new Date().toISOString(),
    claimScope,
    excludedClaims,
    demoStatusManifestPath: demoStatusManifestName,
    minSessions,
    blockers,
    checks,
    evidenceFiles,
    rawSessionArtifacts,
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    forbiddenActions: [
      "live Codex control",
      "desktop GUI mutation",
      "npm publish",
      "GitHub Release creation"
    ]
  };

  writeSafeDemoStatusManifest(demoStatusManifestPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function writeSafeDemoStatusManifest(path: string, contents: string): void {
  assertSafeDemoStatusManifestPath(path);
  const parent = dirname(path);
  const tempPath = join(parent, `.${basename(path)}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    writeFileSync(tempPath, contents, { flag: "wx" });
    if (lstatSync(tempPath).isSymbolicLink()) {
      throw new Error("release-demo-status temporary manifest must not be a symlink");
    }
    const tempStat = lstatSync(tempPath);
    if (!tempStat.isFile()) {
      throw new Error("release-demo-status temporary manifest must be a regular file");
    }
    assertSafeDemoStatusManifestPath(path);
    renameSync(tempPath, path);
    assertWrittenSafeDemoStatusManifestPath(path, { dev: tempStat.dev, ino: tempStat.ino });
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
}

function assertWrittenSafeDemoStatusManifestPath(path: string, expectedIdentity: { dev: number; ino: number }): void {
  const pathStat = lstatSync(path);
  if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.dev !== expectedIdentity.dev || pathStat.ino !== expectedIdentity.ino) {
    throw new Error("release-demo-status.json must be the same regular evidence file after write");
  }
  const noFollowFlag = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const fd = openSync(path, constants.O_RDONLY | noFollowFlag);
  try {
    const stat = fstatSync(fd);
    const postOpenPathStat = lstatSync(path);
    if (postOpenPathStat.isSymbolicLink()
      || !postOpenPathStat.isFile()
      || !stat.isFile()
      || stat.dev !== expectedIdentity.dev
      || stat.ino !== expectedIdentity.ino
      || stat.dev !== pathStat.dev
      || stat.ino !== pathStat.ino
      || stat.dev !== postOpenPathStat.dev
      || stat.ino !== postOpenPathStat.ino) {
      throw new Error("release-demo-status.json must be the same regular evidence file after write");
    }
  } finally {
    closeSync(fd);
  }
}

function assertSafeDemoStatusManifestPath(path: string): void {
  assertNoSymlinkAncestors(path);
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error("release-demo-status.json must be a regular evidence file, not a symlink");
  }
}

function assertNoSymlinkAncestors(path: string): void {
  const tmpRoot = resolve(tmpdir());
  let current = dirname(path);
  while (true) {
    // macOS temp paths normally live under /var, which is itself a system
    // symlink. Stop at the temp root so tests and temp evidence keep working
    // while user-controlled evidence ancestors below it are still checked.
    if (resolve(current) === tmpRoot) return;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error("release-demo-status.json parent directories must not include symlinks");
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function check(ok: boolean, detail: string): ReleaseDemoStatusCheck {
  return { ok, detail };
}

function readJson(path: string): JsonReadResult {
  if (!existsSync(path)) return { value: null, error: `missing evidence file: ${basename(path)}` };
  try {
    return { value: JSON.parse(readFileSync(path, "utf8")), error: null };
  } catch {
    return { value: null, error: `invalid JSON evidence file: ${basename(path)}` };
  }
}

function resolveEvidencePath(evidenceDir: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : join(evidenceDir, path);
}

function demoReadError(result: JsonReadResult): string | null {
  return result.error;
}

function observedIndexedSessions(value: unknown): number {
  const record = asRecord(value);
  if (!record) return 0;
  return Math.max(
    numericField(record, "indexedThreads"),
    numericField(record, "sessionCount"),
    numericField(record, "totalThreads"),
    numericField(record, "threadCount"),
    numericField(record, "indexedThreads") + numericField(record, "skippedFiles")
  );
}

function readArray(value: unknown, field: string): unknown[] | null {
  const record = asRecord(value);
  if (!record) return null;
  return Array.isArray(record[field]) ? record[field] : null;
}

function hasSearchHit(value: unknown, kind: SearchEvidenceKind): boolean {
  return extractEvidenceArray(value).some((entry) => {
    const record = asRecord(entry);
    if (!record) return false;
    const sourceRef = stringField(record, "sourceRef") ?? stringField(record, "source_ref");
    const threadId = stringField(record, "threadId") ?? stringField(record, "thread_id");
    const isCodexThreadEvidence = Boolean(sourceRef?.startsWith("codex_thread:")) || Boolean(threadId && hasToolExtractedTextProof(record));
    return Boolean(isCodexThreadEvidence && hasSearchProof(record, kind));
  });
}

function hasExpansion(value: unknown, expectedProfile: "brief" | "evidence"): boolean {
  const record = asRecord(value);
  if (!record) return false;
  const sourceRef = stringField(record, "sourceRef") ?? stringField(record, "source_ref");
  const text = stringField(record, "text");
  const profile = asRecord(record.profile);
  const profileName = stringField(profile, "name") ?? stringField(record, "profile");
  return Boolean(sourceRef?.startsWith("codex_thread:") && text?.trim() && profileName === expectedProfile && hasExpansionProofText(text));
}

function hasDistinctExpansionRefs(left: unknown, right: unknown): boolean {
  const leftRef = expansionSourceRef(left);
  const rightRef = expansionSourceRef(right);
  if (!leftRef || !rightRef) return true;
  return leftRef !== rightRef;
}

function expansionSourceRef(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const sourceRef = stringField(record, "sourceRef") ?? stringField(record, "source_ref");
  return sourceRef?.startsWith("codex_thread:") ? sourceRef : null;
}

function parseControlDryRun(value: unknown): ControlDryRunProof | null {
  const record = asRecord(value);
  if (!record) return null;
  const action = normalizeControlAction(stringField(record, "action"));
  const threadId = stringField(record, "threadId") ?? stringField(record, "thread_id");
  const approvalAuditId = stringField(record, "approvalAuditId") ?? stringField(record, "approval_audit_id");
  const paramsHash = stringField(record, "paramsHash") ?? stringField(record, "params_hash");
  const messageHash = stringField(record, "messageHash") ?? stringField(record, "message_hash");
  const actionRequiresMessageHash = action === "send" || action === "steer";
  const ok = record.live === false
    && Boolean(action)
    && Boolean(threadId)
    && Boolean(approvalAuditId?.startsWith("loo_audit_"))
    && isSafeFingerprint(paramsHash)
    && (!actionRequiresMessageHash || isSafeFingerprint(messageHash));
  return ok ? { action: action!, threadId: threadId!, approvalAuditId: approvalAuditId!, paramsHash: paramsHash!, messageHash: messageHash ?? undefined } : null;
}

function normalizeControlAction(action: string | null): string | null {
  switch (action) {
    case "send":
    case "codex_send_message":
    case "loo_codex_send_message":
      return "send";
    case "resume":
    case "codex_resume_thread":
    case "loo_codex_resume_thread":
      return "resume";
    case "steer":
    case "codex_steer_thread":
    case "loo_codex_steer_thread":
      return "steer";
    case "interrupt":
    case "codex_interrupt_thread":
    case "loo_codex_interrupt_thread":
      return "interrupt";
    default:
      return null;
  }
}

function validateApprovedLiveControlProof(path: string, expectedCandidateSha?: string): ApprovedProofResult {
  if (!existsSync(path)) return { check: check(false, "approved live-control evidence was not provided"), proof: null };
  let proof: ApprovedLiveControlSmokeProof;
  try {
    proof = JSON.parse(readFileSync(path, "utf8")) as ApprovedLiveControlSmokeProof;
  } catch {
    return { check: check(false, "approved live-control evidence must be JSON"), proof: null };
  }
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return { check: check(false, "approved live-control evidence is not an object"), proof: null };
  const actionOk = proof.action === "send" || proof.action === "resume" || proof.action === "steer" || proof.action === "interrupt";
  const hashOk = proof.action === "send" || proof.action === "steer" ? isSafeFingerprint(proof.messageHash) : true;
  const allowedKeys = new Set([
    "kind",
    "approvedLiveControlSmoke",
    "action",
    "targetRef",
    "candidateSha",
    "approvalAuditId",
    "messageHash",
    "preservesCodexApprovalSemantics",
    "rawPromptIncluded"
  ]);
  const candidateShaOk = !expectedCandidateSha || (
    typeof proof.candidateSha === "string"
    && /^[0-9a-f]{40}$/i.test(proof.candidateSha)
    && proof.candidateSha.toLowerCase() === expectedCandidateSha.toLowerCase()
  );
  const ok = proof.kind === "loo_approved_live_control_smoke"
    && proof.approvedLiveControlSmoke === true
    && actionOk
    && Boolean(proof.targetRef?.startsWith("codex_thread:"))
    && candidateShaOk
    && Boolean(proof.approvalAuditId)
    && hashOk
    && proof.preservesCodexApprovalSemantics === true
    && proof.rawPromptIncluded === false
    && Object.keys(proof).every((key) => allowedKeys.has(key));
  return { check: check(ok, ok ? "structured approved live-control smoke proof accepted" : "approved live-control evidence is not a safe structured proof marker"), proof: ok ? proof : null };
}

function matchApprovedLiveControlToDryRun(approvedProof: ApprovedLiveControlSmokeProof | null, dryRunProof: ControlDryRunProof | null): ReleaseDemoStatusCheck {
  if (!approvedProof || !dryRunProof) return check(true, "approved live-control dry-run match not evaluated until both proofs are valid");
  const targetRef = `codex_thread:${dryRunProof.threadId}`;
  const messageHashOk = dryRunProof.messageHash ? approvedProof.messageHash === dryRunProof.messageHash : true;
  const ok = approvedProof.action === dryRunProof.action
    && approvedProof.targetRef === targetRef
    && approvedProof.approvalAuditId === dryRunProof.approvalAuditId
    && messageHashOk;
  return check(ok, ok ? "approved live-control proof matches dry-run target, action, audit id, and message hash" : "approved live-control proof does not match the dry-run evidence");
}

function hasSearchProof(record: Record<string, unknown>, kind: SearchEvidenceKind): boolean {
  if (kind === "plan" && numericField(record, "planCount") > 0) return true;
  if (kind === "plan" && Array.isArray(record.plans) && record.plans.length > 0) return true;
  if (kind === "final" && (stringField(record, "finalMessage") || stringField(record, "final_message"))) return true;
  const text = stringField(record, "text");
  if (text?.trim()) return true;
  const searchable = [
    stringField(record, "snippet"),
    stringField(record, "title"),
    stringField(record, "summary"),
    text
  ].filter(Boolean).join("\n");
  return kind === "plan" ? /proposed\s+plan|plan/i.test(searchable) : /final\s+message|final/i.test(searchable);
}

function hasToolExtractedTextProof(record: Record<string, unknown>): boolean {
  return Boolean(stringField(record, "text")?.trim());
}

function hasExpansionProofText(text: string | null): boolean {
  if (!text) return false;
  return /final/i.test(text) && /plan/i.test(text) && /touched|file/i.test(text) && /metadata|thread|source/i.test(text);
}

function extractEvidenceArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["results", "matches", "items"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}

function numericField(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringField(record: Record<string, unknown> | null, field: string): string | null {
  if (!record) return null;
  const value = record[field];
  return typeof value === "string" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isSafeFingerprint(value: string | undefined | null): boolean {
  return typeof value === "string" && (/^[a-f0-9]{64}$/i.test(value) || /^sha256:[A-Za-z0-9._:-]+$/.test(value));
}

function scanRawDemoArtifacts(evidenceDir: string): RawDemoArtifact[] {
  if (!existsSync(evidenceDir)) return [];
  return collectEvidenceFiles(evidenceDir)
    .map((file) => rawArtifactForName(file.name, file.linkTarget, file.linkKind))
    .filter((entry): entry is RawDemoArtifact => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function collectEvidenceFiles(root: string, current = root): Array<{ name: string; linkTarget?: string; linkKind?: "directory" | "file" | "unknown" }> {
  const files: Array<{ name: string; linkTarget?: string; linkKind?: "directory" | "file" | "unknown" }> = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectEvidenceFiles(root, path));
    } else if (entry.isFile()) {
      files.push({ name: relative(root, path).replace(/\\/g, "/") });
    } else if (entry.isSymbolicLink()) {
      const name = relative(root, path).replace(/\\/g, "/");
      let linkKind: "directory" | "file" | "unknown" = "unknown";
      try {
        const linked = statSync(path);
        if (linked.isDirectory()) linkKind = "directory";
        else if (linked.isFile()) linkKind = "file";
      } catch {
        linkKind = "unknown";
      }
      try {
        // Do not traverse symlinked evidence directories. They are reported
        // and rejected as a single fail-closed artifact boundary.
        files.push({ name, linkTarget: readlinkSync(path).replace(/\\/g, "/"), linkKind });
      } catch {
        files.push({ name, linkKind });
      }
    }
  }
  return files;
}

function rawArtifactForName(name: string, linkTarget?: string, linkKind?: "directory" | "file" | "unknown"): RawDemoArtifact | null {
  if (name === "release-demo-status.json") return null;
  const normalizedName = name.toLowerCase();
  const normalizedLinkTarget = linkTarget?.toLowerCase() ?? "";
  const extension = extname(name).toLowerCase();
  if (linkKind === "directory") return { name, reason: "symlinked_directory" };
  if (/\.jsonl(?:\.(?:gz|zip|zst|br|xz))?$/.test(normalizedName)) return { name, reason: "raw_codex_jsonl" };
  if (/(?:\.sqlite3?|\.db)(?:-(?:wal|shm|journal))?(?:\.(?:gz|zip|zst|br|xz))?$/.test(normalizedName)) return { name, reason: "sqlite_database" };
  if (extension === ".png" || extension === ".jpg" || extension === ".jpeg" || extension === ".heic" || extension === ".webp") return { name, reason: "screenshot_or_image" };
  if (extension === ".mov" || extension === ".mp4" || extension === ".webm") return { name, reason: "video_capture" };
  if (linkTarget) {
    if (/\.jsonl(?:\.(?:gz|zip|zst|br|xz))?$/.test(normalizedLinkTarget)) return { name, reason: "raw_codex_jsonl" };
    if (/(?:\.sqlite3?|\.db)(?:-(?:wal|shm|journal))?(?:\.(?:gz|zip|zst|br|xz))?$/.test(normalizedLinkTarget)) return { name, reason: "sqlite_database" };
    if (/\.(?:png|jpe?g|heic|webp)$/.test(normalizedLinkTarget)) return { name, reason: "screenshot_or_image" };
    if (/\.(?:mov|mp4|webm)$/.test(normalizedLinkTarget)) return { name, reason: "video_capture" };
  }
  if (linkKind === "file" || linkKind === "unknown" || linkTarget) return { name, reason: "symlinked_artifact" };
  return null;
}
