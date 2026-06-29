import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

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
    approvedLiveControl: options.approvedLiveControlEvidence ? resolve(options.approvedLiveControlEvidence) : join(evidenceDir, "approved-live-control-smoke.json")
  };

  const indexEvidence = readJson(evidenceFiles.index);
  const planSearchEvidence = readJson(evidenceFiles.planSearch);
  const finalSearchEvidence = readJson(evidenceFiles.finalSearch);
  const briefExpansionEvidence = readJson(evidenceFiles.briefExpansion);
  const evidenceExpansionEvidence = readJson(evidenceFiles.evidenceExpansion);
  const controlDryRunEvidence = readJson(evidenceFiles.controlDryRun);
  const rawSessionArtifacts = scanRawDemoArtifacts(evidenceDir);

  const checks: Record<string, ReleaseDemoStatusCheck> = {
    indexedSessions: check(observedIndexedSessions(indexEvidence.value) >= minSessions, demoReadError(indexEvidence) ?? `observed ${observedIndexedSessions(indexEvidence.value)} indexed sessions; expected at least ${minSessions}`),
    importerErrors: check(readArray(indexEvidence.value, "errors")?.length === 0, demoReadError(indexEvidence) ?? "Codex index evidence must report zero importer errors"),
    limitedFiles: check(readArray(indexEvidence.value, "limitedFiles")?.length === 0, demoReadError(indexEvidence) ?? "Codex index evidence must report zero unexpected limited files"),
    planSearch: check(hasSearchHit(planSearchEvidence.value), demoReadError(planSearchEvidence) ?? "plan search evidence must include at least one codex_thread hit"),
    finalSearch: check(hasSearchHit(finalSearchEvidence.value), demoReadError(finalSearchEvidence) ?? "final-message search evidence must include at least one codex_thread hit"),
    briefExpansion: check(hasExpansion(briefExpansionEvidence.value, "brief"), demoReadError(briefExpansionEvidence) ?? "brief expansion evidence must include codex_thread text with the brief profile"),
    evidenceExpansion: check(hasExpansion(evidenceExpansionEvidence.value, "evidence"), demoReadError(evidenceExpansionEvidence) ?? "evidence expansion proof must include codex_thread text with the evidence profile"),
    controlDryRun: check(hasControlDryRun(controlDryRunEvidence.value), demoReadError(controlDryRunEvidence) ?? "control dry-run evidence must include live=false and an approval audit id"),
    rawArtifacts: check(rawSessionArtifacts.length === 0, rawSessionArtifacts.length === 0 ? "no raw session/private DB/screenshot artifacts found" : "raw/private artifacts are present in demo evidence"),
    approvedLiveControl: validateApprovedLiveControlProof(evidenceFiles.approvedLiveControl)
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
    checks.approvedLiveControl.ok ? null : "approved_live_control_smoke_missing"
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
    numericField(record, "threadCount")
  );
}

function readArray(value: unknown, field: string): unknown[] | null {
  const record = asRecord(value);
  if (!record) return null;
  return Array.isArray(record[field]) ? record[field] : null;
}

function hasSearchHit(value: unknown): boolean {
  return extractEvidenceArray(value).some((entry) => {
    const record = asRecord(entry);
    if (!record) return false;
    const sourceRef = stringField(record, "sourceRef") ?? stringField(record, "source_ref");
    const threadId = stringField(record, "threadId") ?? stringField(record, "thread_id");
    return Boolean(sourceRef?.startsWith("codex_thread:") || threadId);
  });
}

function hasExpansion(value: unknown, expectedProfile: "brief" | "evidence"): boolean {
  const record = asRecord(value);
  if (!record) return false;
  const sourceRef = stringField(record, "sourceRef") ?? stringField(record, "source_ref");
  const text = stringField(record, "text");
  const profile = asRecord(record.profile);
  const profileName = stringField(profile, "name") ?? stringField(record, "profile");
  return Boolean(sourceRef?.startsWith("codex_thread:") && text?.trim() && profileName === expectedProfile);
}

function hasControlDryRun(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  const approvalAuditId = stringField(record, "approvalAuditId") ?? stringField(record, "approval_audit_id");
  const paramsHash = stringField(record, "paramsHash") ?? stringField(record, "params_hash");
  const messageHash = stringField(record, "messageHash") ?? stringField(record, "message_hash");
  return record.live === false
    && Boolean(approvalAuditId?.startsWith("loo_audit_"))
    && isSafeFingerprint(paramsHash)
    && (messageHash === null || isSafeFingerprint(messageHash));
}

function validateApprovedLiveControlProof(path: string): ReleaseDemoStatusCheck {
  if (!existsSync(path)) return check(false, "approved live-control evidence was not provided");
  let proof: ApprovedLiveControlSmokeProof;
  try {
    proof = JSON.parse(readFileSync(path, "utf8")) as ApprovedLiveControlSmokeProof;
  } catch {
    return check(false, "approved live-control evidence must be JSON");
  }
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return check(false, "approved live-control evidence is not an object");
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
  return check(ok, ok ? "structured approved live-control smoke proof accepted" : "approved live-control evidence is not a safe structured proof marker");
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
  return readdirSync(evidenceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => rawArtifactForName(entry.name))
    .filter((entry): entry is RawDemoArtifact => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function rawArtifactForName(name: string): RawDemoArtifact | null {
  if (name === "release-demo-status.json") return null;
  const extension = extname(name).toLowerCase();
  if (extension === ".jsonl") return { name: basename(name), reason: "raw_codex_jsonl" };
  if (extension === ".sqlite" || extension === ".sqlite3" || extension === ".db") return { name: basename(name), reason: "sqlite_database" };
  if (extension === ".png" || extension === ".jpg" || extension === ".jpeg" || extension === ".heic" || extension === ".webp") return { name: basename(name), reason: "screenshot_or_image" };
  if (extension === ".mov" || extension === ".mp4" || extension === ".webm") return { name: basename(name), reason: "video_capture" };
  return null;
}
