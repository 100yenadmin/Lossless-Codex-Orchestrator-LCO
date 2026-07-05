import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { normalizeReleaseClaimScope, releaseClaimScopeRequiresLiveControl, type ReleaseClaimScope } from "./release-claim-scope.js";
import { ACCEPTED_LIVE_TURN_STATUSES, type OpenClawGatewayLiveControlAction } from "./openclaw-live-control-smoke.js";

export type QaLabLiveControlMatrixOptions = {
  evidenceDir: string;
  packageVersion?: string;
  candidateSha?: string;
  claimScope?: ReleaseClaimScope;
  sendReport?: string;
  resumeReport?: string;
  steerReport?: string;
  interruptReport?: string;
  sacrificialThreadIds?: string[];
  now?: string;
};

export type QaLabLiveControlMatrixStatus = "ready" | "blocked" | "skipped" | "excluded_by_claim_scope";

export type QaLabLiveControlMatrixReport = {
  schema: "lco.qaLab.liveControlMatrix.v1";
  ok: boolean;
  liveControlMatrixReady: boolean;
  publicSafe: true;
  generatedAt: string;
  packageVersion?: string;
  candidateSha?: string;
  claimScope: ReleaseClaimScope;
  mode: "aggregate-only";
  rows: QaLabLiveControlMatrixRow[];
  summary: {
    requiredRows: number;
    readyRows: number;
    blockedRows: number;
    skippedRequiredRows: number;
    excludedRows: number;
  };
  blockers: Array<{ severity: "P0" | "P1" | "P2"; code: string; source: string; detail: string }>;
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
    npmPublished: false;
    githubReleaseCreated: false;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
  nextSafeCommands: string[];
};

export type QaLabLiveControlMatrixRow = {
  id: string;
  surface: "openclaw-gateway";
  action: OpenClawGatewayLiveControlAction;
  requiredForClaim: boolean;
  status: QaLabLiveControlMatrixStatus;
  evidenceRef: string | null;
  target: {
    kind: "approved_sacrificial_thread" | "unknown" | "not_applicable";
    refClass: "codex_thread" | "unknown" | "not_applicable";
    ref: string | null;
  };
  dryRun: {
    present: boolean;
    live: false | null;
    approvalAuditId: string | null;
    paramsHash: string | null;
    messageHash: string | null;
    expectedTurnIdPresent: boolean;
  };
  liveProof: {
    present: boolean;
    matchesDryRun: boolean;
    method: string | null;
    responseOk: boolean | null;
    turnStatus: string | null;
    expectedTurnIdPresent: boolean;
    expectedTurnIdMatchesDryRun: boolean | null;
    bindingScope: "turn_bound" | "thread_scoped" | "not_applicable" | null;
    rawPromptIncluded: false | null;
  };
  audit: {
    matchingDryRunRecord: boolean;
    matchingLiveRecord: boolean;
  };
  blockerCodes: string[];
};

type JsonRecord = Record<string, unknown>;

const ACTIONS: OpenClawGatewayLiveControlAction[] = ["send", "resume", "steer", "interrupt"];
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const HASH_PATTERN = /^[a-f0-9]{32,128}$/i;
const AUDIT_ID_PATTERN = /^loo_audit_[a-f0-9_:-]+$/i;
const PRIVATE_PATTERN = /(RAW_TRANSCRIPT|private raw session|BEGIN [A-Z ]*PRIVATE KEY|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|\.jsonl\b|\.sqlite\b|\.png\b|\.jpg\b|\.jpeg\b|\.mp4\b|\.mov\b|\/Users\/|\/Volumes\/)/i;
const PRIVATE_DATA_EXCLUSIONS = [
  "raw OpenClaw gateway stdout/stderr",
  "raw tool output",
  "raw Codex transcripts",
  "raw prompts or message text",
  "SQLite DB contents",
  "screenshots or videos",
  "tokens, credentials, API keys, cookies",
  "private customer data"
];

export function createQaLabLiveControlMatrixReport(options: QaLabLiveControlMatrixOptions): QaLabLiveControlMatrixReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const claimScope = normalizeReleaseClaimScope(options.claimScope);
  const requiredActions = releaseClaimScopeRequiresLiveControl(claimScope) ? new Set(ACTIONS) : new Set<OpenClawGatewayLiveControlAction>();
  const sacrificialRefs = new Set((options.sacrificialThreadIds ?? []).map(normalizeSacrificialThreadRef).filter(Boolean));
  const reportPaths: Record<OpenClawGatewayLiveControlAction, string | undefined> = {
    send: options.sendReport,
    resume: options.resumeReport,
    steer: options.steerReport,
    interrupt: options.interruptReport
  };

  const rows = ACTIONS.map((action) => createRow({
    action,
    requiredForClaim: requiredActions.has(action),
    evidenceDir,
    reportPath: reportPaths[action],
    sacrificialRefs
  }));
  applyActionIsolationBlockers(rows);
  const blockers = rows.flatMap((row) => row.requiredForClaim
    ? row.blockerCodes.map((code) => ({
        severity: severityForCode(code),
        code,
        source: row.id,
        detail: detailForCode(code, row.action)
      }))
    : []);
  const summary = {
    requiredRows: rows.filter((row) => row.requiredForClaim).length,
    readyRows: rows.filter((row) => row.requiredForClaim && row.status === "ready").length,
    blockedRows: rows.filter((row) => row.requiredForClaim && row.status === "blocked").length,
    skippedRequiredRows: rows.filter((row) => row.requiredForClaim && row.status === "skipped").length,
    excludedRows: rows.filter((row) => row.status === "excluded_by_claim_scope").length
  };
  if (options.candidateSha && !SHA_PATTERN.test(options.candidateSha)) {
    blockers.push({
      severity: "P1",
      code: "candidate_sha_invalid",
      source: "liveControlMatrix",
      detail: "Candidate SHA must be a 40-character hexadecimal commit SHA."
    });
  }
  if (requiredActions.size > 0 && sacrificialRefs.size === 0) {
    blockers.push({
      severity: "P1",
      code: "sacrificial_target_allowlist_missing",
      source: "liveControlMatrix",
      detail: "Live-control matrix requires an explicit sacrificial thread allowlist for live-control claims."
    });
  }

  const report: QaLabLiveControlMatrixReport = {
    schema: "lco.qaLab.liveControlMatrix.v1",
    ok: blockers.length === 0,
    liveControlMatrixReady: blockers.length === 0,
    publicSafe: true,
    generatedAt: options.now ?? new Date().toISOString(),
    ...(options.packageVersion ? { packageVersion: options.packageVersion } : {}),
    ...(options.candidateSha ? { candidateSha: options.candidateSha } : {}),
    claimScope,
    mode: "aggregate-only",
    rows,
    summary,
    blockers,
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS,
    proofBoundary: "Aggregate-only live-control matrix. It consumes public-safe per-action proof reports and does not run live Codex control, mutate a GUI, read raw transcripts, publish npm, or create GitHub Releases. Interrupt rows only satisfy live-control release claims when source proof includes turn-bound expectedTurnId evidence; thread-scoped interrupt reports are recorded but blocked.",
    nextSafeCommands: blockers.length === 0
      ? ["Feed live-control-matrix.json into release ga-smoke for live-control claim reconciliation."]
      : ["Run per-action OpenClaw live-control smokes against approved sacrificial Codex QA targets, then rebuild this matrix."]
  };
  writeFileSync(join(evidenceDir, "live-control-matrix.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function createRow(input: {
  action: OpenClawGatewayLiveControlAction;
  requiredForClaim: boolean;
  evidenceDir: string;
  reportPath: string | undefined;
  sacrificialRefs: Set<string>;
}): QaLabLiveControlMatrixRow {
  const id = `openclaw-gateway-${input.action}`;
  if (!input.reportPath) {
    return emptyRow(id, input.action, input.requiredForClaim, input.requiredForClaim ? "skipped" : "excluded_by_claim_scope", input.requiredForClaim ? ["live_control_action_report_missing"] : []);
  }
  const evidencePath = evidencePathForPath(input.evidenceDir, input.reportPath);
  const blockerCodes: string[] = [];
  let record: JsonRecord | null = null;
  if (!evidencePath) {
    blockerCodes.push("live_control_report_outside_evidence_dir");
    return emptyRow(id, input.action, input.requiredForClaim, "blocked", blockerCodes, null);
  }
  const { evidenceRef, readPath } = evidencePath;
  if (PRIVATE_PATTERN.test(evidenceRef)) {
    blockerCodes.push("live_control_report_path_private_data_canary");
    return emptyRow(id, input.action, input.requiredForClaim, "blocked", blockerCodes, null);
  }
  if (!existsSync(readPath)) blockerCodes.push("live_control_action_report_missing");
  try {
    record = JSON.parse(readFileSync(readPath, "utf8")) as JsonRecord;
  } catch {
    blockerCodes.push("live_control_action_report_invalid_json");
  }
  if (!record) {
    return emptyRow(id, input.action, input.requiredForClaim, "blocked", blockerCodes, evidenceRef);
  }

  const targetRef = stringPath(record, ["targetRef"]);
  const targetRefIsPrivate = Boolean(targetRef && PRIVATE_PATTERN.test(targetRef));
  const targetRefIsPublicSafe = Boolean(targetRef && /^codex_thread:[A-Za-z0-9._:-]+$/.test(targetRef) && !targetRefIsPrivate);
  const normalizedTargetRef = targetRefIsPublicSafe ? normalizeSacrificialThreadRef(targetRef ?? "") : "";
  const targetAllowed = Boolean(normalizedTargetRef && input.sacrificialRefs.has(normalizedTargetRef));
  const dryRun = isRecord(record.dryRun) ? record.dryRun : {};
  const live = isRecord(record.live) ? record.live : {};
  const audit = isRecord(record.audit) ? record.audit : {};
  const authorization = isRecord(record.authorization) ? record.authorization : {};
  const actionsPerformed = isRecord(record.actionsPerformed) ? record.actionsPerformed : {};
  let leakScanText = "";
  try {
    leakScanText = JSON.stringify(cloneForLeakScan(record));
  } catch {
    blockerCodes.push("live_control_report_private_data_canary");
  }

  if (leakScanText && PRIVATE_PATTERN.test(leakScanText)) blockerCodes.push("live_control_report_private_data_canary");
  if (record.ok !== true || record.proofReady !== true || record.publicSafe !== true) blockerCodes.push("live_control_report_not_ready");
  if (record.action !== input.action) blockerCodes.push("live_control_action_mismatch");
  if (!targetRef?.startsWith("codex_thread:")) blockerCodes.push("live_control_target_ref_invalid");
  if (targetRefIsPrivate || !targetRefIsPublicSafe && Boolean(targetRef?.startsWith("codex_thread:"))) blockerCodes.push("live_control_target_ref_private_data_canary");
  if (!targetAllowed) blockerCodes.push("live_control_target_not_sacrificial");
  if (booleanPath(dryRun, ["live"]) !== false) blockerCodes.push("live_control_dry_run_not_proven");
  if (!safeAuditId(stringPath(dryRun, ["approvalAuditId"]))) blockerCodes.push("live_control_dry_run_audit_id_invalid");
  if (!safeHash(stringPath(dryRun, ["paramsHash"]))) blockerCodes.push("live_control_dry_run_params_hash_invalid");
  if (requiresMessageHash(input.action) && !safeHash(stringPath(dryRun, ["messageHash"]))) blockerCodes.push("live_control_dry_run_message_hash_invalid");
  if (booleanPath(live, ["live"]) !== true) blockerCodes.push("live_control_live_action_not_proven");
  if (!safeAuditId(stringPath(live, ["approvalAuditId"]))) blockerCodes.push("live_control_live_audit_id_invalid");
  if (!safeHash(stringPath(live, ["paramsHash"]))) blockerCodes.push("live_control_live_params_hash_invalid");
  if (requiresMessageHash(input.action) && !safeHash(stringPath(live, ["messageHash"]))) blockerCodes.push("live_control_live_message_hash_invalid");
  if (authorization.approvalAuditIdMatchesDryRun !== true) blockerCodes.push("live_control_approval_mismatch");
  if (audit.matchingDryRunRecord !== true) blockerCodes.push("live_control_audit_tail_missing_dry_run_record");
  if (audit.matchingLiveRecord !== true) blockerCodes.push("live_control_audit_tail_missing_live_record");
  if (actionsPerformed.liveCodexControlRun !== true) blockerCodes.push("live_control_action_flag_missing");
  if (actionsPerformed.rawTranscriptRead !== false) blockerCodes.push("live_control_raw_transcript_boundary_missing");
  blockerCodes.push(...actionSpecificBlockers(input.action, dryRun, live));

  return {
    id,
    surface: "openclaw-gateway",
    action: input.action,
    requiredForClaim: input.requiredForClaim,
    status: blockerCodes.length === 0 ? "ready" : "blocked",
    evidenceRef,
    target: {
      kind: targetAllowed ? "approved_sacrificial_thread" : "unknown",
      refClass: targetAllowed ? "codex_thread" : "unknown",
      ref: targetAllowed ? targetRef : null
    },
    dryRun: {
      present: isRecord(record.dryRun),
      live: booleanPath(dryRun, ["live"]) === false ? false : null,
      approvalAuditId: safeAuditId(stringPath(dryRun, ["approvalAuditId"])) ? stringPath(dryRun, ["approvalAuditId"]) : null,
      paramsHash: safeHash(stringPath(dryRun, ["paramsHash"])) ? stringPath(dryRun, ["paramsHash"]) : null,
      messageHash: safeHash(stringPath(dryRun, ["messageHash"])) ? stringPath(dryRun, ["messageHash"]) : null,
      expectedTurnIdPresent: Boolean(stringPath(dryRun, ["expectedTurnId"]))
    },
    liveProof: {
      present: isRecord(record.live),
      matchesDryRun: authorization.approvalAuditIdMatchesDryRun === true,
      method: stringPath(live, ["method"]),
      responseOk: booleanPath(live, ["responseOk"]),
      turnStatus: stringPath(live, ["turnStatus"]),
      expectedTurnIdPresent: Boolean(stringPath(live, ["expectedTurnId"])),
      expectedTurnIdMatchesDryRun: turnBindingMatchesDryRun(dryRun, live),
      bindingScope: bindingScopeForAction(input.action, live),
      rawPromptIncluded: null
    },
    audit: {
      matchingDryRunRecord: audit.matchingDryRunRecord === true,
      matchingLiveRecord: audit.matchingLiveRecord === true
    },
    blockerCodes: unique(blockerCodes)
  };
}

function emptyRow(
  id: string,
  action: OpenClawGatewayLiveControlAction,
  requiredForClaim: boolean,
  status: QaLabLiveControlMatrixStatus,
  blockerCodes: string[],
  evidenceRef: string | null = null
): QaLabLiveControlMatrixRow {
  return {
    id,
    surface: "openclaw-gateway",
    action,
    requiredForClaim,
    status,
    evidenceRef,
    target: { kind: "not_applicable", refClass: "not_applicable", ref: null },
    dryRun: { present: false, live: null, approvalAuditId: null, paramsHash: null, messageHash: null, expectedTurnIdPresent: false },
    liveProof: { present: false, matchesDryRun: false, method: null, responseOk: null, turnStatus: null, expectedTurnIdPresent: false, expectedTurnIdMatchesDryRun: null, bindingScope: null, rawPromptIncluded: null },
    audit: { matchingDryRunRecord: false, matchingLiveRecord: false },
    blockerCodes
  };
}

function applyActionIsolationBlockers(rows: QaLabLiveControlMatrixRow[]): void {
  const refs = new Map<string, QaLabLiveControlMatrixRow[]>();
  for (const row of rows) {
    if (!row.requiredForClaim || !row.target.ref) continue;
    refs.set(row.target.ref, [...(refs.get(row.target.ref) ?? []), row]);
  }
  for (const duplicateRows of refs.values()) {
    if (duplicateRows.length < 2) continue;
    for (const row of duplicateRows) {
      row.blockerCodes = unique([...row.blockerCodes, "live_control_target_not_action_isolated"]);
      row.status = "blocked";
    }
  }
}

function actionSpecificBlockers(action: OpenClawGatewayLiveControlAction, dryRun: JsonRecord, live: JsonRecord): string[] {
  const method = stringPath(live, ["method"]);
  const responseOk = booleanPath(live, ["responseOk"]);
  const status = normalizeStatus(stringPath(live, ["turnStatus"]));
  const dryRunExpectedTurnId = stringPath(dryRun, ["expectedTurnId"]);
  const liveExpectedTurnId = stringPath(live, ["expectedTurnId"]);
  if (action === "send") {
    return method === "turn/start" && responseOk === true && status && ACCEPTED_LIVE_TURN_STATUSES.has(status)
      ? []
      : ["live_control_send_runtime_marker_missing"];
  }
  if (action === "resume") {
    return method === "thread/resume" && responseOk === true ? [] : ["live_control_resume_runtime_marker_missing"];
  }
  if (action === "steer") {
    if (method !== "turn/steer" || responseOk !== true) return ["live_control_steer_runtime_marker_missing"];
    if (!dryRunExpectedTurnId || !liveExpectedTurnId) return ["live_control_steer_turn_binding_missing"];
    return liveExpectedTurnId === dryRunExpectedTurnId ? [] : ["live_control_steer_turn_binding_mismatch"];
  }
  if (method !== "turn/interrupt" || responseOk !== true) return ["live_control_interrupt_runtime_marker_missing"];
  if (!dryRunExpectedTurnId || !liveExpectedTurnId) return ["live_control_interrupt_turn_binding_missing"];
  return liveExpectedTurnId === dryRunExpectedTurnId ? [] : ["live_control_interrupt_turn_binding_mismatch"];
}

function bindingScopeForAction(action: OpenClawGatewayLiveControlAction, live: JsonRecord): "turn_bound" | "thread_scoped" | "not_applicable" {
  if (action === "steer") return Boolean(stringPath(live, ["expectedTurnId"])) ? "turn_bound" : "not_applicable";
  if (action === "interrupt") return Boolean(stringPath(live, ["expectedTurnId"])) ? "turn_bound" : "thread_scoped";
  return "not_applicable";
}

function turnBindingMatchesDryRun(dryRun: JsonRecord, live: JsonRecord): boolean | null {
  const dryRunExpectedTurnId = stringPath(dryRun, ["expectedTurnId"]);
  const liveExpectedTurnId = stringPath(live, ["expectedTurnId"]);
  if (!dryRunExpectedTurnId && !liveExpectedTurnId) return null;
  return Boolean(dryRunExpectedTurnId && liveExpectedTurnId && liveExpectedTurnId === dryRunExpectedTurnId);
}

function evidencePathForPath(evidenceDir: string, path: string): { evidenceRef: string; readPath: string } | null {
  const resolvedEvidenceDir = realpathSync(evidenceDir);
  const resolved = resolve(path);
  const readPath = existsSync(resolved) ? realpathSync(resolved) : resolved;
  const rel = relative(resolvedEvidenceDir, readPath);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return { evidenceRef: rel || basename(readPath), readPath };
}

function cloneForLeakScan(record: JsonRecord): JsonRecord {
  const clone = JSON.parse(JSON.stringify(record)) as JsonRecord;
  delete clone.proofPath;
  delete clone.reportPath;
  delete clone.runtimeProofPath;
  delete clone.command;
  return clone;
}

function normalizeSacrificialThreadRef(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("codex_thread:") ? trimmed : `codex_thread:${trimmed}`;
}

function requiresMessageHash(action: OpenClawGatewayLiveControlAction): boolean {
  return action === "send" || action === "steer";
}

function severityForCode(code: string): "P0" | "P1" | "P2" {
  if (code.includes("private_data") || code.includes("raw_transcript") || code.includes("outside_evidence_dir")) return "P0";
  if (code.includes("missing") || code.includes("not_ready") || code.includes("not_sacrificial") || code.includes("not_proven")) return "P1";
  return "P2";
}

function detailForCode(code: string, action: OpenClawGatewayLiveControlAction): string {
  return `Live-control matrix row ${action} failed ${code}.`;
}

function normalizeStatus(value: string | null): string | null {
  return value ? value.trim().toLowerCase().replace(/[-\s]+/g, "_") : null;
}

function safeAuditId(value: string | null): value is string {
  return typeof value === "string" && AUDIT_ID_PATTERN.test(value);
}

function safeHash(value: string | null): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function stringPath(value: unknown, path: string[]): string | null {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === "string" && current ? current : null;
}

function booleanPath(value: unknown, path: string[]): boolean | null {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === "boolean" ? current : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function qaLabLiveControlMatrixReportId(report: QaLabLiveControlMatrixReport): string {
  return createHash("sha256").update(JSON.stringify({
    schema: report.schema,
    claimScope: report.claimScope,
    rows: report.rows.map((row) => ({
      action: row.action,
      requiredForClaim: row.requiredForClaim,
      status: row.status,
      blockerCodes: row.blockerCodes
    }))
  })).digest("hex").slice(0, 16);
}
