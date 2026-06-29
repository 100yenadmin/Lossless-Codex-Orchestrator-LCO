import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

export type ReleaseDemoStatusOptions = {
  evidenceDir: string;
  approvedLiveControlEvidence?: string;
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
  reason: "raw_codex_jsonl" | "sqlite_database" | "screenshot_or_image" | "video_capture";
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

  const minSessions = options.minSessions ?? DEFAULT_MIN_SESSIONS;
  const evidenceFiles = {
    index: join(evidenceDir, "index-codex.json"),
    planSearch: join(evidenceDir, "plans-search.json"),
    finalSearch: join(evidenceDir, "finals-search.json"),
    briefExpansion: join(evidenceDir, "expand-brief.json"),
    evidenceExpansion: join(evidenceDir, "expand-evidence.json"),
    controlDryRun: join(evidenceDir, "control-dry-run.json"),
    approvedLiveControl: resolveEvidencePath(evidenceDir, options.approvedLiveControlEvidence ?? "approved-live-control-smoke.json")
  };

  const indexEvidence = readJson(evidenceFiles.index);
  const planSearchEvidence = readJson(evidenceFiles.planSearch);
  const finalSearchEvidence = readJson(evidenceFiles.finalSearch);
  const briefExpansionEvidence = readJson(evidenceFiles.briefExpansion);
  const evidenceExpansionEvidence = readJson(evidenceFiles.evidenceExpansion);
  const controlDryRunEvidence = readJson(evidenceFiles.controlDryRun);
  const controlDryRunProof = parseControlDryRun(controlDryRunEvidence.value);
  const approvedLiveControl = validateApprovedLiveControlProof(evidenceFiles.approvedLiveControl);
  const rawSessionArtifacts = scanRawDemoArtifacts(evidenceDir);

  const checks: Record<string, ReleaseDemoStatusCheck> = {
    indexedSessions: check(observedIndexedSessions(indexEvidence.value) >= minSessions, demoReadError(indexEvidence) ?? `observed ${observedIndexedSessions(indexEvidence.value)} indexed sessions; expected at least ${minSessions}`),
    importerErrors: check(readArray(indexEvidence.value, "errors")?.length === 0, demoReadError(indexEvidence) ?? "Codex index evidence must report zero importer errors"),
    limitedFiles: check(readArray(indexEvidence.value, "limitedFiles")?.length === 0, demoReadError(indexEvidence) ?? "Codex index evidence must report zero unexpected limited files"),
    planSearch: check(hasSearchHit(planSearchEvidence.value, "plan"), demoReadError(planSearchEvidence) ?? "plan search evidence must include at least one codex_thread hit with plan proof"),
    finalSearch: check(hasSearchHit(finalSearchEvidence.value, "final"), demoReadError(finalSearchEvidence) ?? "final-message search evidence must include at least one codex_thread hit with final-message proof"),
    briefExpansion: check(hasExpansion(briefExpansionEvidence.value, "brief"), demoReadError(briefExpansionEvidence) ?? "brief expansion evidence must include codex_thread text with the brief profile"),
    evidenceExpansion: check(hasExpansion(evidenceExpansionEvidence.value, "evidence"), demoReadError(evidenceExpansionEvidence) ?? "evidence expansion proof must include codex_thread text with the evidence profile"),
    controlDryRun: check(Boolean(controlDryRunProof), demoReadError(controlDryRunEvidence) ?? "control dry-run evidence must include live=false, approval audit id, params hash, and message hash for send/steer"),
    rawArtifacts: check(rawSessionArtifacts.length === 0, rawSessionArtifacts.length === 0 ? "no raw session/private DB/screenshot artifacts found" : "raw/private artifacts are present in demo evidence"),
    approvedLiveControl: approvedLiveControl.check,
    approvedLiveControlMatchesDryRun: matchApprovedLiveControlToDryRun(approvedLiveControl.proof, controlDryRunProof)
  };

  const blockers = [
    checks.indexedSessions.ok ? null : "codex_index_min_sessions_missing",
    checks.importerErrors.ok ? null : "codex_index_errors_present",
    checks.limitedFiles.ok ? null : "codex_index_limited_files_present",
    checks.planSearch.ok ? null : "plan_search_evidence_missing",
    checks.finalSearch.ok ? null : "final_search_evidence_missing",
    checks.briefExpansion.ok ? null : "brief_expansion_evidence_missing",
    checks.evidenceExpansion.ok ? null : "evidence_expansion_evidence_missing",
    checks.controlDryRun.ok ? null : "control_dry_run_evidence_missing",
    checks.rawArtifacts.ok ? null : "raw_session_artifacts_present",
    checks.approvedLiveControl.ok ? null : "approved_live_control_smoke_missing",
    checks.approvedLiveControlMatchesDryRun.ok ? null : "approved_live_control_dry_run_mismatch"
  ].filter((blocker): blocker is string => blocker !== null);

  const demoStatusManifestPath = join(evidenceDir, "release-demo-status.json");
  const report: ReleaseDemoStatusReport = {
    ok: blockers.length === 0,
    demoReady: blockers.length === 0,
    generatedAt: options.now ?? new Date().toISOString(),
    demoStatusManifestPath,
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

  writeFileSync(demoStatusManifestPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
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
    return Boolean((sourceRef?.startsWith("codex_thread:") || threadId) && hasSearchProof(record, kind));
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

function parseControlDryRun(value: unknown): ControlDryRunProof | null {
  const record = asRecord(value);
  if (!record) return null;
  const action = stringField(record, "action");
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

function validateApprovedLiveControlProof(path: string): ApprovedProofResult {
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
    "approvalAuditId",
    "messageHash",
    "preservesCodexApprovalSemantics",
    "rawPromptIncluded"
  ]);
  const ok = proof.kind === "loo_approved_live_control_smoke"
    && proof.approvedLiveControlSmoke === true
    && actionOk
    && Boolean(proof.targetRef?.startsWith("codex_thread:"))
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
  const searchable = [
    stringField(record, "snippet"),
    stringField(record, "title"),
    stringField(record, "summary"),
    stringField(record, "text")
  ].filter(Boolean).join("\n");
  return kind === "plan" ? /proposed\s+plan|plan/i.test(searchable) : /final\s+message|final/i.test(searchable);
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
  return collectEvidenceFileNames(evidenceDir)
    .map((name) => rawArtifactForName(name))
    .filter((entry): entry is RawDemoArtifact => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function collectEvidenceFileNames(root: string, current = root): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      names.push(...collectEvidenceFileNames(root, path));
    } else if (entry.isFile()) {
      names.push(relative(root, path).replace(/\\/g, "/"));
    }
  }
  return names;
}

function rawArtifactForName(name: string): RawDemoArtifact | null {
  if (name === "release-demo-status.json") return null;
  const extension = extname(name).toLowerCase();
  if (extension === ".jsonl") return { name, reason: "raw_codex_jsonl" };
  if (extension === ".sqlite" || extension === ".sqlite3" || extension === ".db") return { name, reason: "sqlite_database" };
  if (extension === ".png" || extension === ".jpg" || extension === ".jpeg" || extension === ".heic" || extension === ".webp") return { name, reason: "screenshot_or_image" };
  if (extension === ".mov" || extension === ".mp4" || extension === ".webm") return { name, reason: "video_capture" };
  return null;
}
