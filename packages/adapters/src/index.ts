import { createHash, createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { codexTransportStatus } from "./codex-jsonrpc.js";
import { CODEX_CONTROL_METHODS, CODEX_FORBIDDEN_METHODS, CODEX_READ_METHODS, CODEX_TARGET_METHOD_POLICY, assertCodexMethodAllowed, assertTargetMethodAllowed, type TargetMethodPolicy } from "./policy.js";
import { redactDiagnosticString, redactDiagnosticValue, redactValue } from "./redaction.js";
import { readEnv, readEnvWithFallback, resolveHomeDir } from "../../runtime/src/env.js";

export * from "./codex-jsonrpc.js";
export * from "./policy.js";
export * from "./redaction.js";

export type CodexClient = {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  requestSequence?(steps: CodexControlStep[]): Promise<unknown[]>;
  requestSequenceUntilTurnResolved?(steps: CodexControlStep[], options: CodexControlSequenceOptions): Promise<CodexControlSequenceResult>;
};

export type CodexControlStep = {
  method: string;
  params: Record<string, unknown>;
};

export type CodexControlSequenceOptions = {
  threadId: string;
  expectedTurnId?: string;
  turnWaitMs: number;
  requireSafeActiveRuntime?: boolean;
};

export type CodexControlSequenceResult = {
  responses: unknown[];
  turn?: CodexTurnResolution;
};

export type CodexTurnResolution = {
  id?: string;
  status: string | null;
  completed: boolean;
  notificationMethods: string[];
  approvalRequestCount: number;
  serverRequestCount: number;
  error?: string;
};

export type SourceCoverageState = "ok" | "partial" | "unavailable" | "not_configured";

export type CodexAppServerStatusReport = {
  schema: "lco.codex.appServerStatus.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  transport: {
    mode: "stdio";
    command: string;
    available: boolean;
    version: string | null;
    error: string | null;
  };
  methodPolicy: {
    surface: "read";
    allowedReadMethods: string[];
    controlMethods: string[];
    forbiddenMethods: string[];
  };
  remoteControl: {
    status: "ok" | "unavailable";
    readiness: "disabled" | "connecting" | "connected" | "errored" | "unknown";
    environmentRef: string | null;
    serverName: string | null;
    error: string | null;
  };
  sourceCoverage: {
    codexAppServer: SourceCoverageState;
  };
  errors: string[];
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type CodexAppServerThreadSignal = {
  appServerRef: string;
  threadId: string;
  titleSanitized: string | null;
  titleAliases: string[];
  titleHash: string | null;
  status: string | null;
  loaded: boolean | null;
  loadedState: "loaded" | "not_loaded" | "not_claimed";
  updatedAt: string | null;
  sourceRef: string;
  confidence: number;
};

export type CodexAppServerThreadsReport = {
  schema: "lco.codex.appServerThreads.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  sourceCoverage: {
    codexAppServer: SourceCoverageState;
  };
  threads: CodexAppServerThreadSignal[];
  loadedThreadRefs: string[] | null;
  loadedSignalSource: "same_connection" | "not_claimed_one_shot_client";
  readProbe?: {
    threadId: string;
    appServerRef: string;
    status: string | null;
    titleSanitized: string | null;
    turnsOmitted: true;
    rawFieldsOmitted: ["preview", "cwd", "path", "turns"];
    error: string | null;
  };
  errors: string[];
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type DesktopBackend = "direct" | "cua-driver" | "peekaboo";
export const DESKTOP_BACKENDS = ["direct", "cua-driver", "peekaboo"] as const satisfies readonly DesktopBackend[];
export const DESKTOP_GUI_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const CODEX_THREAD_LIST_SOURCE_KINDS = ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"] as const;
const DESKTOP_PROOF_BACKEND = "cua-driver";
const DESKTOP_PROOF_TARGET_APP = "TextEdit";
const DESKTOP_PROOF_TARGET_WINDOW = "lco-desktop-proof.txt";
const DESKTOP_PROOF_ACTION = "launch_app TextEdit scratch window";

export function isDesktopBackend(value: unknown): value is DesktopBackend {
  return typeof value === "string" && (DESKTOP_BACKENDS as readonly string[]).includes(value);
}

export type DesktopProbe = {
  commandStatus(command: string, args?: string[], options?: DesktopCommandOptions): DesktopCommandStatus;
  commandOutput?(command: string, args?: string[], timeoutMs?: number, options?: DesktopCommandOptions): DesktopCommandOutput;
  activeApplication?(): string | undefined;
};

export type DesktopCommandOptions = {
  env?: Record<string, string>;
};

export type DesktopCommandStatus = {
  available: boolean;
  command: string;
  version?: string;
  error?: string;
};

export type DesktopCommandOutput = {
  status: number;
  command: string;
  stdout?: string;
  stderr?: string;
  error?: string;
};

export type DesktopStatus = {
  backend: DesktopBackend;
  available: boolean;
  preferred: boolean;
  dryRunOnly: boolean;
  launch: {
    command: string;
    args: string[];
    transport: "stdio" | "none";
    readiness: {
      status: "not_probed" | "unavailable" | "not_applicable";
      note: string;
    };
  };
  permissions: {
    accessibility: DesktopPermissionStatus;
    screenRecording: DesktopPermissionStatus;
  };
  focus: {
    beforeApplication?: string;
    afterApplication?: string;
    changed: boolean | null;
    proof: "status_probe_only_no_action" | "not_measured";
  };
  snapshot?: DesktopSnapshotStatus;
  visibleCodex?: {
    macros: VisibleCodexMacro[];
    safetyRules: string[];
    windows?: VisibleCodexWindows;
    threadMap?: VisibleCodexThreadMap;
  };
  limitations: string[];
  backgroundSafeClaim: "not_proven" | "not_supported";
  note: string;
  version?: string;
  error?: string;
};

export type CodexDesktopFallbackBackendStatus = {
  backend: "cua-driver" | "peekaboo";
  role: "preferred_background" | "secondary_visible_fallback";
  status: "ready" | "blocked" | "unavailable";
  available: boolean;
  permissionState: "ready" | "unknown" | "denied";
  focus: DesktopStatus["focus"];
  backgroundSafeClaim: DesktopStatus["backgroundSafeClaim"];
  visibleCodex: {
    windows: number | null;
    threadCandidates: number | null;
    snapshotRequested: boolean;
    snapshotBlocked: boolean | null;
  };
  blockers: string[];
  warnings: string[];
  takesScreenWarning: boolean;
};

export type CodexDesktopFallbackReport = {
  schema: "lco.codex.desktopFallback.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  target: {
    threadId: string | null;
    sourceRef: string | null;
  };
  fallback: {
    required: boolean;
    reason: "desktop_visibility_not_proven" | "desktop_visibility_already_proven" | "desktop_visibility_unknown" | "coherence_input_missing";
    coherenceState: string | null;
    desktopVisibility: string | null;
  };
  blockers: string[];
  nextToolCall: {
    tool: "lco_desktop_proof";
    args: {
      check: "coherence";
      thread_id?: string;
      source_ref?: string;
    };
  } | null;
  preferredBackend: "cua-driver";
  backends: CodexDesktopFallbackBackendStatus[];
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    screenshotCaptured: false;
    rawTranscriptRead: false;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

export type DesktopGuiActionObservation = {
  kind?: string;
  desktopBackend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  approvalRef?: string;
  approved?: boolean;
  liveActionObserved?: boolean;
  focusBeforeApplication?: string;
  focusAfterApplication?: string;
  focusChanged?: boolean;
  focusProof?: string;
  rawScreenshotIncluded?: boolean;
  rawSecretIncluded?: boolean;
};

export type DesktopProofActionReport = {
  ok: boolean;
  proofActionReady: boolean;
  publicSafe: boolean;
  kind: "loo_desktop_proof_action";
  desktopBackend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  actionHash?: string;
  approvalRef?: string;
  approvalVerified: boolean;
  blockers: string[];
  backendCommand?: {
    command: string;
    tool: "launch_app";
    status: number;
    rawStdoutIncluded: false;
    rawStderrIncluded: false;
    scratchFilePathIncluded: false;
    selfActivationSuppressed?: boolean;
  };
  observation: DesktopGuiActionObservation | null;
  evidencePath?: string;
  observationEvidencePath?: string;
  actionsPerformed: {
    desktopGuiActionRun: boolean;
    screenshotCaptured: false;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

export type DesktopProofActionApproval = {
  kind: "loo_desktop_proof_action_approval";
  approved: true;
  approvalRef: string;
  desktopBackend: "cua-driver";
  targetApp: "TextEdit";
  targetWindow: "lco-desktop-proof.txt";
  action: "launch_app TextEdit scratch window";
  actionHash: string;
  scratchFilePathHash: string;
  issuedAt: string;
  expiresAt: string;
  approvalSignature: string;
};

export type DesktopGuiReleaseApprovalProof = {
  kind: "loo_release_operation_approval";
  operation: "desktop_gui_mutation";
  approved: true;
  approvalRef: string;
  desktopBackend: "cua-driver" | "peekaboo";
  targetApp: string;
  targetWindow: string;
  action: string;
  actionHash: string;
  approvalNonce: string;
  issuedAt: string;
  expiresAt: string;
  focusBeforeApplication: string;
  focusAfterApplication: string;
  focusChanged: false;
  focusProof: string;
  rawScreenshotIncluded: false;
  rawSecretIncluded: false;
};

export type DesktopCollaborationRuntimeProof = {
  kind: "loo_runtime_scenario_proof";
  scenario_id: "desktop-collaboration-action-bound-v1-1";
  scenario_version: "1.1";
  proof_mode: "runtime_required";
  claim_scope: "codex-working-app-proof";
  public_safe: true;
  proof_markers: {
    action_bound_target: true;
    approval_packet_bound: true;
    backend_specific_observation: true;
    no_focus_measurement: true;
  };
  raw_transcript_read: false;
  raw_prompt_included: false;
  raw_secret_included: false;
  screenshot_included: false;
  sqlite_included: false;
  screenshot_count: 0;
  action_hash: string;
};

export type DesktopGuiProofReport = {
  ok: boolean;
  proofReady: boolean;
  publicSafe: boolean;
  kind: "loo_desktop_gui_proof_report";
  desktopBackend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  actionHash?: string;
  approvalNonce?: string;
  issuedAt?: string;
  expiresAt?: string;
  approvalRef?: string;
  liveActionObserved: boolean;
  focusBeforeApplication?: string;
  focusAfterApplication?: string;
  focusChanged?: boolean;
  focusProof?: string;
  rawScreenshotIncluded: boolean | null;
  rawSecretIncluded: boolean | null;
  blockers: string[];
  approval: DesktopGuiReleaseApprovalProof | null;
  runtimeProof: DesktopCollaborationRuntimeProof | null;
  proofReportPath?: string;
  approvalEvidencePath?: string;
  runtimeProofEvidencePath?: string;
  actionsPerformed: {
    desktopGuiActionRun: false;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

export type DesktopLiveProofHarnessReport = {
  ok: boolean;
  proofHarnessReady: boolean;
  publicSafe: boolean;
  kind: "loo_desktop_live_proof_harness";
  desktopBackend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  actionHash?: string;
  approvalRef?: string;
  approvalArtifact: DesktopProofActionApproval | null;
  backendStatus?: DesktopStatus;
  blockers: string[];
  evidencePath?: string;
  proofMarkers: {
    noActionObserved: true;
  };
  actionsPerformed: {
    desktopGuiActionRun: false;
    screenshotCaptured: false;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

export type CodexDesktopCollaborationProofApprovalPacket = {
  schema: "lco.codexDesktopCollaborationProofApproval.v1";
  approvalRef: string;
  approved: true;
  targetRef: string;
  targetThreadId?: string;
  desktopBackend: DesktopBackend;
  targetApp: string;
  targetWindow: string;
  action: string;
  actionHash: string;
  issuedAt: string;
  expiresAt: string;
  preconditions?: string[];
  sourceCoverage?: {
    indexedSession?: SourceCoverageState;
    desktopCoherence?: SourceCoverageState;
    desktopFallback?: SourceCoverageState;
    approvalPacket?: SourceCoverageState;
  };
  focusPolicy?: {
    screenshotAllowed?: boolean;
    requireNoFocusSteal?: boolean;
  };
};

export type CodexDesktopCollaborationProofReport = {
  schema: "lco.codexDesktopCollaborationProof.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  ok: boolean;
  status: "ready" | "blocked";
  target: {
    targetRef?: string;
    targetThreadId?: string;
  };
  desktopBackend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  actionHash?: string;
  expectedActionHash?: string;
  approvalRef?: string;
  approvalVerified: boolean;
  blockers: string[];
  reasonCodes: string[];
  sourceCoverage: {
    indexedSession: SourceCoverageState;
    desktopCoherence: SourceCoverageState;
    desktopFallback: SourceCoverageState;
    approvalPacket: SourceCoverageState;
  };
  proofMarkers: {
    actionBoundTarget: boolean;
    approvalPacketBound: boolean;
    publicSafeEvidenceOnly: true;
    noScreenshotPolicy: boolean;
    dryRunOnly: true;
  };
  requiredNextToolCall: {
    tool: "lco_desktop_proof";
    args: {
      check: "live_proof_harness";
      backend: DesktopBackend;
      target_app: string;
      target_window: string;
      action: string;
      approval_ref: string;
    };
    execute: false;
  } | null;
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
    screenshotCaptured: false;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

export type DesktopActReport = {
  backend: DesktopBackend;
  action: string;
  live: false;
  dryRunOnly: true;
  approvalRequired: true;
  requestedLive: boolean;
  blockers: string[];
  requiredProof: string[];
  actionsPerformed: {
    desktopGuiActionRun: false;
    screenshotCaptured: false;
  };
  proofBoundary: string;
  note: string;
  nextAction: string;
};

type DesktopPermissionStatus = {
  status: "unknown" | "not_applicable" | "granted" | "denied";
  note: string;
};

type VisibleCodexMacro = {
  name: string;
  mode: "read_only" | "dry_run_only";
  legacyCommand: string[];
  sideEffects: string[];
  description: string;
};

type VisibleCodexWindows = {
  source: "peekaboo_snapshot";
  count: number;
  windows: VisibleCodexWindow[];
  warnings: string[];
};

type VisibleCodexWindow = {
  visibleId: string;
  index: number;
  appName: string;
  title?: string;
  titleHash?: string;
  snapshotId?: string;
  frontmost: boolean;
  source: "peekaboo_snapshot";
};

type VisibleCodexThreadMap = {
  source: "peekaboo_snapshot";
  count: number;
  maxItems: number;
  threads: VisibleCodexThreadCandidate[];
  warnings: string[];
};

type VisibleCodexThreadCandidate = {
  visibleId: string;
  index: number;
  title: string;
  rawTitle: string;
  project?: string;
  status?: string;
  updatedLabel?: string;
  titleHash: string;
  role?: string;
  sourceElementId: string;
  bounds?: { x: number; y: number; width: number; height: number };
  center?: { x: number; y: number };
  confidence: "low" | "medium" | "high";
  source: "peekaboo_snapshot";
  titleAvailable: boolean;
};

type DesktopSnapshotStatus = {
  requested: boolean;
  blocked: boolean;
  reason?: "sensitive_app_blocked" | "frontmost_app_unknown" | "peekaboo_unavailable" | "peekaboo_probe_unavailable" | "peekaboo_snapshot_failed";
  engine?: "peekaboo";
  frontmostApp?: string;
  windowTitle?: string;
  snapshotId?: string;
  elements: DesktopSnapshotElement[];
  truncated: boolean;
  maxNodes: number;
  warnings: string[];
};

type DesktopSnapshotElement = {
  elementId: string;
  role?: string;
  label?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  actionable: boolean;
};

export type ControlResult = {
  action: string;
  threadId: string;
  live: boolean;
  approvalAuditId: string;
  paramsHash: string;
  messageHash?: string;
  method?: string;
  methodSequence?: string[];
  connectionScope?: "single_request" | "same_connection_sequence";
  controlSent?: boolean;
  loadedThreadReusable?: boolean;
  createdThreadId?: string;
  createdThreadCandidateId?: string;
  createdThreadResumable?: boolean;
  createdThreadDurability?: "persisted" | "unverified_pending";
  expectedTurnId?: string;
  status?: string;
  turn?: CodexTurnResolution;
  proofState: ControlProofState;
  response?: unknown;
};

export type ControlProofStateStatus =
  | "dry_run"
  | "accepted_by_transport"
  | "started"
  | "completed"
  | "persisted"
  | "unverified_pending"
  | "transport_rejected"
  | "turn_started_unconfirmed"
  | "turn_transport_error"
  | "turn_server_request_unconfirmed"
  | "turn_id_missing";

export type ControlProofState = {
  acceptedByTransport: boolean;
  started: boolean;
  completed: boolean;
  persisted: boolean;
  unverifiedPending: boolean;
  status: ControlProofStateStatus;
  threadId?: string;
  turnId?: string;
  responseStatus?: string;
  nextProof?: {
    tool: "lco_codex_app_server_threads" | "lco_desktop_proof";
    execute: false;
    args: Record<string, string | number>;
    reason: string;
    stopConditions: string[];
  };
  callerInstruction: string;
  proofBoundary: string;
};

export type AuditStore = Omit<ReturnType<typeof createAuditStore>, "deriveSubkeyIfConfigured" | "fingerprintTextIfConfigured"> & {
  deriveSubkeyIfConfigured?(domain: string): string | null;
  fingerprintTextIfConfigured?(value: string): string | null;
};
type ControlAuditStore = Pick<AuditStore, "path" | "append" | "find" | "fingerprintText" | "fingerprintValue">;

export type TargetControlExecuteSpec = {
  action: string;
  method: string;
  threadId: string;
  params: Record<string, unknown>;
  steps?: CodexControlStep[];
  message?: string;
  dryRun?: boolean;
  approvalAuditId?: string;
  loadedThreadReusable?: boolean;
  createdThreadFromResponse?: boolean;
  expectedTurnId?: string;
  turnResolution?: {
    expectedTurnId?: string;
    turnWaitMs?: number;
    requireSafeActiveRuntime?: boolean;
  };
};

export type TargetControl = {
  targetName: string;
  execute(spec: TargetControlExecuteSpec): Promise<ControlResult>;
};

export type AuditRecord = {
  id: string;
  action: string;
  target: string;
  paramsHash: string;
  messageHash?: string;
  approvalAuditId?: string;
  live: boolean;
  createdAt: string;
};

export const CODEX_CONTROL_DRY_RUN_TTL_MS = 15 * 60 * 1000;
const DEFAULT_CODEX_TURN_WAIT_MS = 120_000;
const MAX_CODEX_TURN_WAIT_MS = 600_000;
const CODEX_SAFE_APPROVAL_POLICY = "never";
const CODEX_SAFE_SANDBOX_MODE = "read-only";
const CODEX_SAFE_TURN_SANDBOX_POLICY = { type: "readOnly", networkAccess: false } as const;

export function createAuditStore(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  let auditKey: Buffer | undefined;
  const getAuditKey = () => {
    auditKey ??= readOrCreateAuditKey(path);
    return auditKey;
  };
  return {
    path,
    fingerprintTextIfConfigured(value: string): string | null {
      const key = readAuditKeyIfConfigured(path);
      return key ? hmacDigest(key, value) : null;
    },
    deriveSubkeyIfConfigured(domain: string): string | null {
      const key = readAuditKeyIfConfigured(path);
      return key ? deriveAuditSubkey(key, domain) : null;
    },
    fingerprintText(value: string): string {
      return hmacDigest(getAuditKey(), value);
    },
    fingerprintValue(value: unknown): string {
      return hmacDigest(getAuditKey(), JSON.stringify(value));
    },
    append(record: Omit<AuditRecord, "id" | "createdAt">): AuditRecord {
      const full: AuditRecord = {
        id: `loo_audit_${randomUUID().replaceAll("-", "")}`,
        createdAt: new Date().toISOString(),
        ...record
      };
      appendFileSync(path, `${JSON.stringify(full)}\n`);
      return full;
    },
    find(id: string): AuditRecord | null {
      if (!existsSync(path)) return null;
      const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const parsed = JSON.parse(lines[index]!) as AuditRecord;
        if (parsed.id === id) return parsed;
      }
      return null;
    },
    tail(limit = 20): AuditRecord[] {
      if (!existsSync(path)) return [];
      const boundedLimit = Math.max(1, Math.min(limit, 1000));
      const records: AuditRecord[] = [];
      for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
        try {
          records.push(JSON.parse(line) as AuditRecord);
        } catch {
          // Ignore corrupt partial writes so audit inspection stays available.
        }
      }
      return records.slice(-boundedLimit);
    }
  };
}

export function fingerprintAuditTextIfConfigured(auditPath: string, value: string): string | null {
  const key = readAuditKeyIfConfigured(auditPath);
  return key ? hmacDigest(key, value) : null;
}

export function deriveAuditSubkeyIfConfigured(auditPath: string, domain: string): string | null {
  const key = readAuditKeyIfConfigured(auditPath);
  return key ? deriveAuditSubkey(key, domain) : null;
}

export function createTargetControl(options: { targetName: string; methodPolicy: TargetMethodPolicy; audit: ControlAuditStore; client: CodexClient }): TargetControl {
  const execute = async (spec: TargetControlExecuteSpec): Promise<ControlResult> => {
    assertTargetMethodAllowed(options.methodPolicy, spec.method, "control");
    const steps = spec.steps?.length ? spec.steps : [{ method: spec.method, params: spec.params }];
    const methodSequence = steps.map((step) => step.method);
    for (const step of steps) assertTargetMethodAllowed(options.methodPolicy, step.method, "control");
    const requiresSequence = steps.length > 1 || Boolean(spec.turnResolution);
    const connectionScope = requiresSequence ? "same_connection_sequence" : "single_request";
    const paramsHash = options.audit.fingerprintValue({
      action: spec.action,
      method: spec.method,
      methodSequence,
      threadId: spec.threadId,
      params: spec.params,
      steps
    });
    const messageHash = spec.message === undefined ? undefined : options.audit.fingerprintText(spec.message);
    if (spec.dryRun !== false) {
      const record = options.audit.append({
        action: spec.action,
        target: spec.threadId,
        paramsHash,
        messageHash,
        live: false
      });
      return {
        action: spec.action,
        threadId: spec.threadId,
        live: false,
        approvalAuditId: record.id,
        paramsHash,
        messageHash,
        method: spec.method,
        methodSequence,
        connectionScope,
        loadedThreadReusable: spec.loadedThreadReusable,
        expectedTurnId: spec.expectedTurnId,
        proofState: dryRunProofState()
      };
    }

    if (!spec.approvalAuditId) {
      throw new Error(`approval_audit_id is required for live ${options.targetName} control actions`);
    }
    const previous = options.audit.find(spec.approvalAuditId);
    if (!previous) {
      throw new Error("approval_audit_id was not found in the local audit log");
    }
    if (previous.live !== false) {
      throw new Error("approval_audit_id must reference a dry-run Codex control audit record");
    }
    if (previous.action !== spec.action || previous.target !== spec.threadId || previous.paramsHash !== paramsHash) {
      throw new Error("approval_audit_id does not match this Codex control action");
    }
    const dryRunCreatedAtMs = Date.parse(previous.createdAt);
    if (!Number.isFinite(dryRunCreatedAtMs) || dryRunCreatedAtMs + CODEX_CONTROL_DRY_RUN_TTL_MS <= Date.now()) {
      throw new Error("approval_audit_id dry-run record expired");
    }
    const sequenceResult = requiresSequence
      ? await requestCodexControlSequence(options.client, steps, spec.turnResolution
        ? {
            threadId: spec.threadId,
            expectedTurnId: spec.turnResolution.expectedTurnId,
            turnWaitMs: resolveCodexTurnWaitMs(spec.turnResolution.turnWaitMs),
            ...(spec.turnResolution.requireSafeActiveRuntime ? { requireSafeActiveRuntime: true } : {})
          }
        : undefined)
      : undefined;
    const safeRuntimeBlock = safeRuntimeBlockFromSequence(sequenceResult);
    if (safeRuntimeBlock) {
      return {
        action: spec.action,
        threadId: spec.threadId,
        live: true,
        approvalAuditId: previous.id,
        paramsHash,
        messageHash,
        method: spec.method,
        methodSequence,
        connectionScope,
        controlSent: false,
        expectedTurnId: spec.expectedTurnId,
        proofState: {
          acceptedByTransport: false,
          started: false,
          completed: false,
          persisted: false,
          unverifiedPending: false,
          status: "transport_rejected",
          threadId: spec.threadId,
          callerInstruction: "Codex active runtime posture was not proven safe after resume. The active-turn control was not sent; use a fresh dry-run after establishing the supported never-approve, read-only, no-network posture.",
          proofBoundary: "This public-safe result proves that LCO stopped before steer or interrupt. It does not prove execution, completion, persistence, or any Codex GUI action."
        },
        response: sanitizeCodexControlResponse(safeRuntimeBlock)
      };
    }
    const rawResponse = sequenceResult
      ? sequenceResult.responses.at(-1) ?? { ok: true }
      : await options.client.request(spec.method, spec.params);
    const response = responseWithTurnResolution(rawResponse, sequenceResult?.turn);
    const liveRecord = options.audit.append({
      action: spec.action,
      target: spec.threadId,
      paramsHash,
      messageHash,
      approvalAuditId: previous.id,
      live: true
    });
    const createdThreadCandidateId = spec.createdThreadFromResponse ? extractControlThreadId(response) : undefined;
    const proofThreadId = createdThreadCandidateId ?? spec.threadId;
    const status = sequenceResult?.turn?.status ?? extractControlStatus(response) ?? undefined;
    const proofState = liveProofState({
      method: spec.method,
      methodSequence,
      threadId: proofThreadId,
      response,
      turnResolution: sequenceResult?.turn
    });
    const createdThreadResumable = spec.createdThreadFromResponse ? proofState.persisted === true : undefined;
    const createdThreadId = spec.createdThreadFromResponse && createdThreadResumable ? createdThreadCandidateId : undefined;
    return {
      action: spec.action,
      threadId: spec.threadId,
      live: true,
      approvalAuditId: liveRecord.id,
      paramsHash,
      messageHash,
      method: spec.method,
      methodSequence,
      connectionScope,
      loadedThreadReusable: spec.loadedThreadReusable,
      controlSent: true,
      createdThreadId,
      createdThreadCandidateId,
      createdThreadResumable,
      createdThreadDurability: spec.createdThreadFromResponse
        ? createdThreadResumable ? "persisted" : "unverified_pending"
        : undefined,
      expectedTurnId: spec.expectedTurnId,
      status,
      turn: sequenceResult?.turn ? publicTurnResolution(sequenceResult.turn) : undefined,
      proofState,
      response: sanitizeCodexControlResponse(response)
    };
  };

  return { targetName: options.targetName, execute };
}

export function createCodexControl(options: { audit: ControlAuditStore; client: CodexClient }) {
  const target = createTargetControl({
    targetName: "Codex",
    methodPolicy: CODEX_TARGET_METHOD_POLICY,
    audit: options.audit,
    client: options.client
  });

  return {
    startThread(input: { dryRun?: boolean; approvalAuditId?: string } = {}) {
      const startParams = {
        approvalPolicy: CODEX_SAFE_APPROVAL_POLICY,
        sandbox: CODEX_SAFE_SANDBOX_MODE,
        ephemeral: false
      };
      return target.execute({
        action: "codex_start_thread",
        method: "thread/start",
        threadId: "new_thread",
        dryRun: input.dryRun,
        approvalAuditId: input.approvalAuditId,
        params: startParams,
        createdThreadFromResponse: true
      });
    },
    sendMessage(input: { threadId: string; message: string; dryRun?: boolean; approvalAuditId?: string; turnWaitMs?: number }) {
      const resumeParams = safeCodexResumeParams(input.threadId);
      // A new turn pins its own restrictive posture. Unlike steer/interrupt,
      // it does not act inside an already-running turn whose posture is fixed.
      const turnStartParams = {
        threadId: input.threadId,
        input: [{ type: "text", text: input.message }],
        approvalPolicy: CODEX_SAFE_APPROVAL_POLICY,
        sandboxPolicy: CODEX_SAFE_TURN_SANDBOX_POLICY
      };
      return target.execute({
        action: "codex_send_message",
        method: "turn/start",
        threadId: input.threadId,
        message: input.message,
        dryRun: input.dryRun,
        approvalAuditId: input.approvalAuditId,
        params: turnStartParams,
        steps: [
          { method: "thread/resume", params: resumeParams },
          { method: "turn/start", params: turnStartParams }
        ],
        loadedThreadReusable: true,
        turnResolution: {
          turnWaitMs: input.turnWaitMs
        }
      });
    },
    resumeThread(input: { threadId: string; dryRun?: boolean; approvalAuditId?: string }) {
      const resumeParams = safeCodexResumeParams(input.threadId);
      return target.execute({
        action: "codex_resume_thread",
        method: "thread/resume",
        threadId: input.threadId,
        dryRun: input.dryRun,
        approvalAuditId: input.approvalAuditId,
        params: resumeParams,
        loadedThreadReusable: false
      });
    },
    steerThread(input: { threadId: string; message: string; expectedTurnId?: string; dryRun?: boolean; approvalAuditId?: string; turnWaitMs?: number }) {
      if (!input.expectedTurnId) throw new Error("expected_turn_id is required for steer actions");
      const resumeParams = safeCodexResumeParams(input.threadId);
      const steerParams = { threadId: input.threadId, expectedTurnId: input.expectedTurnId, input: [{ type: "text", text: input.message }] };
      return target.execute({
        action: "codex_steer_thread",
        method: "turn/steer",
        threadId: input.threadId,
        message: input.message,
        dryRun: input.dryRun,
        approvalAuditId: input.approvalAuditId,
        params: steerParams,
        steps: [
          { method: "thread/resume", params: resumeParams },
          { method: "turn/steer", params: steerParams }
        ],
        expectedTurnId: input.expectedTurnId,
        turnResolution: {
          expectedTurnId: input.expectedTurnId,
          turnWaitMs: input.turnWaitMs,
          requireSafeActiveRuntime: true
        }
      });
    },
    interruptThread(input: { threadId: string; expectedTurnId?: string; dryRun?: boolean; approvalAuditId?: string; turnWaitMs?: number }) {
      if (!input.expectedTurnId) throw new Error("expected_turn_id is required for interrupt actions");
      const resumeParams = safeCodexResumeParams(input.threadId);
      const interruptParams = { threadId: input.threadId, turnId: input.expectedTurnId };
      return target.execute({
        action: "codex_interrupt_thread",
        method: "turn/interrupt",
        threadId: input.threadId,
        dryRun: input.dryRun,
        approvalAuditId: input.approvalAuditId,
        params: interruptParams,
        steps: [
          { method: "thread/resume", params: resumeParams },
          { method: "turn/interrupt", params: interruptParams }
        ],
        expectedTurnId: input.expectedTurnId,
        turnResolution: {
          expectedTurnId: input.expectedTurnId,
          turnWaitMs: input.turnWaitMs,
          requireSafeActiveRuntime: true
        }
      });
    }
  };
}

function safeCodexResumeParams(threadId: string): Record<string, unknown> {
  return {
    threadId,
    excludeTurns: true,
    approvalPolicy: CODEX_SAFE_APPROVAL_POLICY,
    sandbox: CODEX_SAFE_SANDBOX_MODE
  };
}

function dryRunProofState(): ControlProofState {
  return {
    acceptedByTransport: false,
    started: false,
    completed: false,
    persisted: false,
    unverifiedPending: false,
    status: "dry_run",
    callerInstruction: "Dry-run only. Live Codex control still requires the matching approval_audit_id for the exact params_hash.",
    proofBoundary: "A dry-run approval packet does not execute Codex control and cannot prove transport acceptance, execution, completion, or persistence."
  };
}

function liveProofState(input: {
  method: string;
  methodSequence: string[];
  threadId: string;
  response: unknown;
  turnResolution?: CodexTurnResolution;
}): ControlProofState {
  const acceptedByTransport = asRecord(input.response)?.ok === false ? false : true;
  const turnId = input.turnResolution?.id ?? extractControlTurnId(input.response);
  const responseThreadId = extractControlThreadId(input.response);
  const responseStatus = input.turnResolution?.status ?? extractControlStatus(input.response);
  const normalizedStatus = normalizeControlStatus(responseStatus);
  const failClosedStatus = failClosedTurnProofStatus(normalizedStatus);
  const started = acceptedByTransport && Boolean(
    turnId
    || responseThreadId
    || normalizedStatus === "in_progress"
    || normalizedStatus === "running"
    || normalizedStatus === "started"
    || normalizedStatus === "pending"
    || normalizedStatus === "queued"
  );
  const completed = acceptedByTransport && Boolean(
    input.turnResolution?.completed === true
    || normalizedStatus === "completed"
    || normalizedStatus === "complete"
    || normalizedStatus === "done"
  );
  const persisted = false;
  const unverifiedPending = acceptedByTransport && !persisted && (started || completed || normalizedStatus !== null);
  const status: ControlProofStateStatus = !acceptedByTransport
    ? "transport_rejected"
    : failClosedStatus
      ? failClosedStatus
      : persisted
        ? "persisted"
        : unverifiedPending
          ? "unverified_pending"
          : completed
            ? "completed"
            : started
              ? "started"
              : "accepted_by_transport";
  const proofThreadId = responseThreadId ?? input.threadId;
  const failClosed = Boolean(failClosedStatus);
  return {
    acceptedByTransport,
    started,
    completed,
    persisted,
    unverifiedPending,
    status,
    threadId: proofThreadId,
    ...(turnId ? { turnId } : {}),
    ...(responseStatus ? { responseStatus } : {}),
    ...(acceptedByTransport && !persisted && proofThreadId !== "new_thread" ? {
      nextProof: input.method === "thread/start"
        ? {
            tool: "lco_desktop_proof",
            execute: false,
            args: {
              check: "start_thread_post_create_proof",
              created_thread_id: proofThreadId,
              created_thread_ref: `codex_thread:${proofThreadId}`,
              limit: 20
            },
            reason: "Run the bounded read-only post-create proof before treating transport acceptance as durable Codex thread creation or persistence.",
            stopConditions: ["execute_false_only", "raw_transcript_not_read", "do_not_claim_created_or_persisted_until_post_create_proof"]
          }
        : {
            tool: "lco_codex_app_server_threads",
            execute: false,
            args: { read_thread_id: proofThreadId, limit: 20 },
            reason: "Bounded read-only follow-up proof is required before treating transport acceptance as durable Codex execution or persistence.",
            stopConditions: ["execute_false_only", "raw_transcript_not_read", "do_not_claim_completed_or_persisted_until_durable_read"]
          }
    } : {}),
    callerInstruction: failClosed
      ? `Codex turn proof failed closed with ${status}. Do not treat this live control as completed or build on it without a fresh dry-run and new proof.`
      : acceptedByTransport
        ? input.method === "thread/start"
          ? "Transport acceptance is not durable thread creation. Run the bounded post-create proof before claiming the new thread completed, persisted, or is safe to build on."
          : "Transport acceptance is not durable execution. Run the bounded follow-up proof before claiming the turn or thread completed, persisted, or is safe to build on."
        : "Codex transport did not accept the control request. Do not retry live control without a fresh dry-run and approval.",
    proofBoundary: "This proof state is public-safe transport/output classification only. It does not read raw transcripts, prove durable local-session persistence, mutate the GUI, or claim completed orchestration without follow-up evidence."
  };
}

function failClosedTurnProofStatus(value: string | null): ControlProofStateStatus | null {
  if (value === "turn_started_unconfirmed") return "turn_started_unconfirmed";
  if (value === "turn_transport_error") return "turn_transport_error";
  if (value === "turn_server_request_unconfirmed") return "turn_server_request_unconfirmed";
  if (value === "turn_id_missing") return "turn_id_missing";
  return null;
}

function responseWithTurnResolution(response: unknown, turn: CodexTurnResolution | undefined): unknown {
  if (!turn) return response;
  const record = asRecord(response);
  const next: Record<string, unknown> = record ? { ...record } : { value: response };
  const publicTurn = publicTurnResolution(turn);
  const result = asRecord(next.result);
  if (result) {
    next.result = {
      ...result,
      turn: {
        ...(asRecord(result.turn) ?? {}),
        ...publicTurn
      }
    };
  }
  next.turn = {
    ...(asRecord(next.turn) ?? {}),
    ...publicTurn
  };
  if (turn.status) next.status = turn.status;
  return next;
}

const CODEX_CONTROL_RESPONSE_FORBIDDEN_KEYS = new Set([
  "cwd",
  "instructionSources",
  "path",
  "preview",
  "runtimeWorkspaceRoots",
  "turns"
]);

function sanitizeCodexControlResponse(response: unknown): unknown {
  return sanitizeCodexControlResponseValue(redactValue(response));
}

function sanitizeCodexControlResponseValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeCodexControlResponseValue(item));
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([key]) => !CODEX_CONTROL_RESPONSE_FORBIDDEN_KEYS.has(key))
      .map(([key, item]) => [
        key,
        sanitizeCodexControlResponseValue(key.toLowerCase() === "error" ? redactDiagnosticValue(item) : item)
      ]);
    return Object.fromEntries(entries);
  }
  return value;
}

function publicTurnResolution(turn: CodexTurnResolution): CodexTurnResolution {
  return {
    ...(turn.id ? { id: turn.id } : {}),
    status: turn.status,
    completed: turn.completed,
    notificationMethods: [...new Set(turn.notificationMethods)].sort(compareTurnNotificationMethods),
    approvalRequestCount: turn.approvalRequestCount,
    serverRequestCount: turn.serverRequestCount,
    ...(turn.error ? { error: redactDiagnosticString(turn.error).slice(0, 260) } : {})
  };
}

const TURN_NOTIFICATION_METHOD_ORDER = [
  "thread/started",
  "turn/started",
  "turn/completed",
  "turn/failed",
  "turn/interrupted",
  // Codex has historically surfaced both spellings; keep the original
  // double-l form before the single-l alias for deterministic compatibility.
  "turn/cancelled",
  "turn/canceled"
] as const;

function compareTurnNotificationMethods(left: string, right: string): number {
  const leftIndex = TURN_NOTIFICATION_METHOD_ORDER.indexOf(left as typeof TURN_NOTIFICATION_METHOD_ORDER[number]);
  const rightIndex = TURN_NOTIFICATION_METHOD_ORDER.indexOf(right as typeof TURN_NOTIFICATION_METHOD_ORDER[number]);
  // Public turn summaries expose this deterministic order: known lifecycle
  // notifications first, then unknown future methods sorted lexicographically.
  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolveCodexTurnWaitMs(value?: number): number {
  if (Number.isFinite(value) && value && value > 0) {
    return Math.min(Math.floor(value), MAX_CODEX_TURN_WAIT_MS);
  }
  const fromEnv = Number.parseInt(readEnv("CODEX_TURN_WAIT_MS") ?? "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.min(fromEnv, MAX_CODEX_TURN_WAIT_MS);
  return DEFAULT_CODEX_TURN_WAIT_MS;
}

function extractControlTurnId(value: unknown): string | undefined {
  const turn = nestedRecord(value, ["result", "turn"]) ?? nestedRecord(value, ["turn"]);
  return stringField(turn?.id) ?? undefined;
}

function extractControlThreadId(value: unknown): string | undefined {
  const thread = nestedRecord(value, ["result", "thread"]) ?? nestedRecord(value, ["thread"]);
  return stringField(thread?.id) ?? undefined;
}

function extractControlStatus(value: unknown): string | null {
  const turn = nestedRecord(value, ["result", "turn"]) ?? nestedRecord(value, ["turn"]);
  const thread = nestedRecord(value, ["result", "thread"]) ?? nestedRecord(value, ["thread"]);
  return stringField(turn?.status)
    ?? stringField(thread?.status)
    ?? stringField(nestedRecord(value, ["result"])?.status)
    ?? stringField(asRecord(value)?.status);
}

function nestedRecord(value: unknown, path: string[]): Record<string, unknown> | null {
  let current: unknown = value;
  for (const segment of path) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[segment];
  }
  return asRecord(current);
}

function normalizeControlStatus(value: string | null): string | null {
  if (!value) return null;
  return value.trim().replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase();
}

async function requestCodexControlSequence(
  client: CodexClient,
  steps: CodexControlStep[],
  turnResolution?: CodexControlSequenceOptions
): Promise<CodexControlSequenceResult> {
  if (turnResolution) {
    if (!client.requestSequenceUntilTurnResolved) {
      throw new Error("turn lifecycle proof is required for this Codex control action");
    }
    const result = await client.requestSequenceUntilTurnResolved(steps, turnResolution);
    assertCodexControlSequenceResponses(result.responses, steps);
    return result;
  }
  if (!client.requestSequence) {
    throw new Error("same-connection control sequence is required for this Codex control action");
  }
  const responses = await client.requestSequence(steps);
  assertCodexControlSequenceResponses(responses, steps);
  return { responses };
}

function assertCodexControlSequenceResponses(responses: unknown[], steps: CodexControlStep[]): void {
  for (let index = 0; index < responses.length; index += 1) {
    const response = asRecord(responses[index]);
    const isLcoSafetyBlock = response?.code === "safe_runtime_posture_unproven"
      && response.origin === "lco_safety_gate";
    if (response?.ok === false && !isLcoSafetyBlock) {
      throw new Error(`Codex control sequence step failed: ${steps[index]?.method ?? "unknown"}`);
    }
  }
  if (responses.length !== steps.length) {
    throw new Error(`Codex control sequence returned ${responses.length} response(s) for ${steps.length} step(s)`);
  }
}

function safeRuntimeBlockFromSequence(sequence: CodexControlSequenceResult | undefined): Record<string, unknown> | null {
  const response = asRecord(sequence?.responses.at(-1));
  return response?.ok === false
    && response.code === "safe_runtime_posture_unproven"
    && response.origin === "lco_safety_gate"
    ? response
    : null;
}

export async function createCodexAppServerStatusReport(options: {
  client: CodexClient;
  transport?: ReturnType<typeof codexTransportStatus>;
  command?: string;
  now?: string;
}): Promise<CodexAppServerStatusReport> {
  const transport = options.transport ?? codexTransportStatus({ command: options.command ?? readEnvWithFallback("CODEX_BIN", "codex") });
  if (!transport.available) {
    const label = codexTransportUnavailableLabel(transport.error);
    const error = transport.error ? `${label}: ${transport.error}` : label;
    return {
      schema: "lco.codex.appServerStatus.v1",
      publicSafe: true,
      readOnly: true,
      generatedAt: options.now ?? new Date().toISOString(),
      transport: {
        mode: "stdio",
        command: capTextValue(transport.command, 160),
        available: false,
        version: transport.version ? capTextValue(transport.version, 160) : null,
        error: transport.error ? capTextValue(transport.error, 260) : label
      },
      methodPolicy: {
        surface: "read",
        allowedReadMethods: [...CODEX_READ_METHODS].sort(),
        controlMethods: [...CODEX_CONTROL_METHODS].sort(),
        forbiddenMethods: [...CODEX_FORBIDDEN_METHODS].sort()
      },
      remoteControl: {
        status: "unavailable",
        readiness: "unknown",
        environmentRef: null,
        serverName: null,
        error: capTextValue(error, 260)
      },
      sourceCoverage: {
        codexAppServer: "unavailable"
      },
      errors: [capTextValue(error, 260)],
      actionsPerformed: {
        liveCodexControlRun: false,
        desktopGuiActionRun: false,
        rawTranscriptRead: false
      },
      proofBoundary: "This report probes only read-allowlisted Codex app-server status. It does not enable remote control, send turns, resume threads, read raw transcript turns, mutate files, or mutate the desktop GUI."
    };
  }
  const remoteControl = await codexReadRequest(options.client, "remoteControl/status/read", {});
  const remoteRecord = asRecord(remoteControl.result);
  const statusValue = stringField(remoteRecord?.status);
  const readiness = statusValue && ["disabled", "connecting", "connected", "errored"].includes(statusValue)
    ? statusValue as CodexAppServerStatusReport["remoteControl"]["readiness"]
    : "unknown";
  const errors = remoteControl.ok ? [] : [remoteControl.error ?? "remoteControl/status/read failed"];
  return {
    schema: "lco.codex.appServerStatus.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt: options.now ?? new Date().toISOString(),
    transport: {
      mode: "stdio",
      command: capTextValue(transport.command, 160),
      available: transport.available,
      version: transport.version ? capTextValue(transport.version, 160) : null,
      error: transport.error ? capTextValue(transport.error, 260) : null
    },
    methodPolicy: {
      surface: "read",
      allowedReadMethods: [...CODEX_READ_METHODS].sort(),
      controlMethods: [...CODEX_CONTROL_METHODS].sort(),
      forbiddenMethods: [...CODEX_FORBIDDEN_METHODS].sort()
    },
    remoteControl: {
      status: remoteControl.ok ? "ok" : "unavailable",
      readiness,
      environmentRef: stringField(remoteRecord?.environmentId) ? `codex_remote_environment:${shortHash(String(remoteRecord?.environmentId))}` : null,
      serverName: publicTextField(remoteRecord?.serverName, 120) ?? null,
      error: remoteControl.ok ? null : capTextValue(remoteControl.error ?? "remoteControl/status/read failed", 260)
    },
    sourceCoverage: {
      codexAppServer: remoteControl.ok ? "ok" : transport.available ? "partial" : "unavailable"
    },
    errors: errors.map((error) => capTextValue(error, 260)),
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false
    },
    proofBoundary: "This report probes only read-allowlisted Codex app-server status. It does not enable remote control, send turns, resume threads, read raw transcript turns, mutate files, or mutate the desktop GUI."
  };
}

function codexTransportUnavailableLabel(error: string | null): "codex_binary_unavailable" | "codex_transport_unavailable" {
  if (!error) return "codex_binary_unavailable";
  return /\b(?:ENOENT|EACCES)\b|not found|no such file|permission denied/i.test(error)
    ? "codex_binary_unavailable"
    : "codex_transport_unavailable";
}

export async function createCodexAppServerThreadsReport(options: {
  client: CodexClient;
  limit?: number;
  readThreadId?: string;
  claimLoadedSignals?: boolean;
  now?: string;
}): Promise<CodexAppServerThreadsReport> {
  const limit = boundedInteger(options.limit, 20, 1, 100);
  const errors: string[] = [];
  const list = await codexReadRequest(options.client, "thread/list", {
    limit,
    useStateDbOnly: true,
    sortKey: "recency_at",
    sortDirection: "desc",
    sourceKinds: [...CODEX_THREAD_LIST_SOURCE_KINDS]
  });
  if (!list.ok && list.error) errors.push(list.error);
  const loaded = options.claimLoadedSignals === true
    ? await codexReadRequest(options.client, "thread/loaded/list", {})
    : null;
  if (loaded && !loaded.ok && loaded.error) errors.push(loaded.error);
  const loadedThreadIds = loaded?.ok ? new Set(threadIdsFromLoadedResult(loaded.result)) : null;
  const threads = threadRecordsFromListResult(list.result)
    .slice(0, limit)
    .map((thread) => appServerThreadSignal(thread, loadedThreadIds));

  let readProbe: CodexAppServerThreadsReport["readProbe"];
  let readProbeOk: boolean | undefined;
  if (options.readThreadId) {
    const requestedThreadId = options.readThreadId;
    const threadId = capTextValue(requestedThreadId, 160);
    const read = await codexReadRequest(options.client, "thread/read", { threadId: requestedThreadId, includeTurns: false });
    readProbeOk = read.ok;
    if (!read.ok) {
      if (read.error) errors.push(read.error);
      readProbe = {
        threadId,
        appServerRef: codexAppThreadRef(threadId),
        status: null,
        titleSanitized: null,
        turnsOmitted: true,
        rawFieldsOmitted: ["preview", "cwd", "path", "turns"],
        error: read.error ? capTextValue(read.error, 260) : "thread/read failed"
      };
    } else {
      const thread = asRecord(asRecord(read.result)?.thread);
      readProbe = {
        threadId,
        appServerRef: codexAppThreadRef(threadId),
        status: threadStatus(thread?.status),
        titleSanitized: publicTextField(thread?.name, 160) ?? null,
        turnsOmitted: true,
        rawFieldsOmitted: ["preview", "cwd", "path", "turns"],
        error: null
      };
    }
  }

  return {
    schema: "lco.codex.appServerThreads.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt: options.now ?? new Date().toISOString(),
    sourceCoverage: {
      codexAppServer: list.ok && (!loaded || loaded.ok) && readProbeOk !== false
        ? "ok"
        : list.ok || loaded?.ok || readProbeOk === true
          ? "partial"
          : "unavailable"
    },
    threads,
    loadedThreadRefs: loadedThreadIds ? [...loadedThreadIds].sort().map(codexAppThreadRef) : null,
    loadedSignalSource: loadedThreadIds ? "same_connection" : "not_claimed_one_shot_client",
    readProbe,
    errors: errors.map((error) => capTextValue(error, 260)),
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false
    },
    proofBoundary: "This report uses thread/list with explicit source and recency filters plus optional thread/read with includeTurns:false. Loaded-thread signals are only claimed for an explicit same-connection source; the default one-shot stdio client does not claim loaded state. It omits preview, cwd, path, and turns, and does not resume, send, steer, interrupt, or mutate Codex."
  };
}

export async function desktopSee(input: { backend?: DesktopBackend; includeSnapshot?: boolean; maxChars?: number; maxNodes?: number; probe?: DesktopProbe } = {}): Promise<DesktopStatus> {
  return desktopBackendStatus(input.backend ?? "direct", input.probe ?? systemDesktopProbe(), {
    includeSnapshot: input.includeSnapshot === true,
    maxChars: input.maxChars,
    maxNodes: input.maxNodes
  });
}

export function desktopFallbackDiagnostics(input: { probe?: DesktopProbe } = {}) {
  const probe = input.probe ?? systemDesktopProbe();
  return {
    preferred: "cua-driver" as const,
    backends: [
      desktopBackendStatus("cua-driver", probe),
      desktopBackendStatus("peekaboo", probe),
      desktopBackendStatus("direct", probe)
    ]
  };
}

export async function createCodexDesktopFallbackReport(input: {
  threadId?: string | null;
  sourceRef?: string | null;
  coherence?: unknown;
  includePeekabooSnapshot?: boolean;
  maxChars?: number;
  maxNodes?: number;
  now?: string;
  probe?: DesktopProbe;
} = {}): Promise<CodexDesktopFallbackReport> {
  const probe = input.probe ?? systemDesktopProbe();
  const coherence = asRecord(input.coherence);
  const threadId = publicTextField(input.threadId, 120) ?? null;
  const sourceRef = publicTextField(input.sourceRef, 180) ?? null;
  const hasTarget = Boolean(threadId || sourceRef);
  const state = publicTextField(coherence?.state, 80) ?? null;
  const visibility = asRecord(coherence?.visibility);
  const desktopVisibility = publicTextField(visibility?.desktop, 80) ?? null;
  const coherenceInputMissing = hasTarget && !codexDesktopFallbackHasUsableCoherence(state, desktopVisibility);
  const targetMismatch = codexDesktopFallbackTargetMismatch(threadId, sourceRef);
  const fallbackReason = coherenceInputMissing
    ? "coherence_input_missing"
    : state === "desktop_visible" || desktopVisibility === "proven"
    ? "desktop_visibility_already_proven"
    : state || desktopVisibility
      ? "desktop_visibility_not_proven"
      : "desktop_visibility_unknown";
  const nextToolCall = coherenceInputMissing && !targetMismatch
    ? {
        tool: "lco_desktop_proof" as const,
        args: {
          check: "coherence" as const,
          ...(threadId ? { thread_id: threadId } : {}),
          ...(sourceRef ? { source_ref: sourceRef } : {})
        }
      }
    : null;
  const blockers = [
    ...(coherenceInputMissing ? ["coherence_input_missing"] : []),
    ...(targetMismatch ? ["target_mismatch"] : [])
  ];
  const cua = await desktopSee({ backend: "cua-driver", probe });
  const peekaboo = await desktopSee({
    backend: "peekaboo",
    includeSnapshot: input.includePeekabooSnapshot === true,
    maxChars: input.maxChars,
    maxNodes: input.maxNodes,
    probe
  });
  const backends = [
    codexDesktopFallbackBackendStatus(cua, {
      role: "preferred_background",
      fallbackReason,
      takesScreenWarning: false
    }),
    codexDesktopFallbackBackendStatus(peekaboo, {
      role: "secondary_visible_fallback",
      fallbackReason,
      takesScreenWarning: true
    })
  ];

  return {
    schema: "lco.codex.desktopFallback.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt: input.now ?? new Date().toISOString(),
    target: {
      threadId,
      sourceRef
    },
    fallback: {
      required: fallbackReason === "desktop_visibility_not_proven",
      reason: fallbackReason,
      coherenceState: state,
      desktopVisibility
    },
    blockers,
    nextToolCall,
    preferredBackend: "cua-driver",
    backends,
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      screenshotCaptured: false,
      rawTranscriptRead: false
    },
    privateDataExclusions: [
      "raw screenshots or videos",
      "raw accessibility trees",
      "raw backend stdout or stderr",
      "raw Codex transcripts",
      "raw prompts or message text",
      "tokens, credentials, API keys, cookies",
      "private customer data",
      "absolute local transcript paths"
    ],
    proofBoundary: "This report prepares the #308 CUA-first / Peekaboo-secondary Codex Desktop fallback path using public-safe status and optional bounded visible metadata only. It does not run live Codex control, click, type, select, refresh, restart, mutate Codex Desktop, capture screenshots, or prove unattended desktop takeover.",
    nextAction: targetMismatch
      ? "Resolve the target mismatch before running loo_codex_desktop_coherence; pass either a matching thread_id/source_ref pair or a single unambiguous target."
      : fallbackReason === "coherence_input_missing"
      ? `Run loo_codex_desktop_coherence with ${JSON.stringify(nextToolCall?.args ?? {})}, then pass the returned coherence object to loo_codex_desktop_fallback_status.`
      : fallbackReason === "desktop_visibility_already_proven"
      ? "Keep using direct Codex protocol and visible-map evidence; no desktop fallback action is required for this target."
      : "Continue #308 with an action-bound CUA no-focus Codex Desktop proof or a documented Peekaboo visible fallback blocker before claiming Desktop-visible collaboration."
  };
}

function codexDesktopFallbackHasUsableCoherence(state: string | null, desktopVisibility: string | null): boolean {
  return Boolean(state || desktopVisibility);
}

function codexDesktopFallbackTargetMismatch(threadId: string | null, sourceRef: string | null): boolean {
  const normalizedThreadId = codexDesktopFallbackTargetThreadId(threadId);
  const normalizedSourceThreadId = codexDesktopFallbackSourceThreadId(sourceRef);
  if (!normalizedThreadId || !normalizedSourceThreadId) return false;
  return normalizedThreadId !== normalizedSourceThreadId;
}

function codexDesktopFallbackTargetThreadId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const candidate = trimmed.startsWith("codex_thread:")
    ? trimmed.slice("codex_thread:".length)
    : trimmed;
  if (!/^[A-Za-z0-9._:-]+$/.test(candidate)) return null;
  return candidate.toLowerCase();
}

function codexDesktopFallbackSourceThreadId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("codex_thread:")) return null;
  const candidate = trimmed.slice("codex_thread:".length);
  if (!/^[A-Za-z0-9._:-]+$/.test(candidate)) return null;
  return candidate.toLowerCase();
}

export function desktopActDryRun(input: {
  backend?: DesktopBackend;
  action?: string;
  dryRun?: boolean;
  targetApp?: string;
  targetWindow?: string;
  actionHash?: string;
  approvalRef?: string;
  permissionState?: string;
  focusBeforeApplication?: string;
  focusAfterApplication?: string;
  publicSafeObservation?: boolean;
} = {}): DesktopActReport {
  const requestedLive = input.dryRun === false;
  const requiredProof = [
    "backend",
    "target_app",
    "target_window",
    "action",
    "action_hash",
    "approval_ref",
    "permission_state",
    "focus_before_application",
    "focus_after_application",
    "public_safe_observation"
  ];
  const blockers = requestedLive ? ["desktop_live_action_not_enabled"] : [];
  if (requestedLive) {
    const targetApp = publicTextField(input.targetApp, 120);
    const targetWindow = publicTextField(input.targetWindow, 160);
    const action = publicTextField(input.action, 160);
    const suppliedActionHash = publicHashField(input.actionHash) ? input.actionHash : undefined;
    if (!input.backend) blockers.push("desktop_backend_missing");
    if (input.backend === "direct") blockers.push("desktop_backend_not_gui_fallback");
    if (!targetApp) blockers.push("target_app_missing");
    if (!targetWindow) blockers.push("target_window_missing");
    if (!action) blockers.push("action_missing");
    if (!suppliedActionHash) {
      blockers.push("action_hash_missing");
    } else if (input.backend && targetApp && targetWindow && action) {
      const expectedActionHash = desktopActionHash(input.backend, targetApp, targetWindow, action);
      if (suppliedActionHash.toLowerCase() !== expectedActionHash) blockers.push("action_hash_mismatch");
    }
    if (!publicTextField(input.approvalRef, 160)) blockers.push("approval_ref_missing");
    if (!publicTextField(input.permissionState, 120)) blockers.push("permission_state_missing");
    const focusBefore = publicTextField(input.focusBeforeApplication, 120);
    const focusAfter = publicTextField(input.focusAfterApplication, 120);
    if (!focusBefore || !focusAfter) {
      blockers.push("focus_before_after_missing");
    } else if (focusBefore !== focusAfter) {
      blockers.push("focus_changed");
    }
    if (input.publicSafeObservation !== true) blockers.push("public_safe_observation_missing");
  }
  return {
    backend: input.backend ?? "direct",
    action: input.action ?? "unknown",
    live: false,
    dryRunOnly: true,
    approvalRequired: true,
    requestedLive,
    blockers,
    requiredProof,
    actionsPerformed: {
      desktopGuiActionRun: false,
      screenshotCaptured: false
    },
    proofBoundary: "This tool does not perform desktop GUI mutation. Live desktop action remains disabled unless a future backend-specific implementation consumes validated action-bound, permission, no-focus, and public-safe proof.",
    note: "Desktop live action is not enabled in this beta without backend-specific approval and permission proof.",
    nextAction: requestedLive
      ? "Run loo_desktop_live_proof_harness to prepare the public-safe action plan, perform any separately scoped backend-specific action outside this dry-run tool, then validate the observation with loo_desktop_proof_report."
      : "Dry-run only; use loo_desktop_live_proof_harness before any separately scoped backend-specific desktop proof."
  };
}

export function createDesktopGuiProofReport(input: unknown): DesktopGuiProofReport {
  const observation = asRecord(input) ?? {};
  const desktopBackend = optionalDesktopBackendObservation(observation.desktopBackend);
  const targetApp = publicTextField(observation.targetApp, 120);
  const targetWindow = publicTextField(observation.targetWindow, 160);
  const action = publicTextField(observation.action, 160);
  const approvalRef = publicTextField(observation.approvalRef, 160);
  const focusBeforeApplication = publicTextField(observation.focusBeforeApplication, 120);
  const focusAfterApplication = publicTextField(observation.focusAfterApplication, 120);
  const focusProof = publicTextField(observation.focusProof, 120);
  const rawScreenshotIncluded = typeof observation.rawScreenshotIncluded === "boolean" ? observation.rawScreenshotIncluded : null;
  const rawSecretIncluded = typeof observation.rawSecretIncluded === "boolean" ? observation.rawSecretIncluded : null;
  const focusChanged = typeof observation.focusChanged === "boolean" ? observation.focusChanged : undefined;
  const liveActionObserved = observation.liveActionObserved === true;
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.parse(issuedAt) + DESKTOP_GUI_APPROVAL_TTL_MS).toISOString();
  const approvalNonce = randomBytes(16).toString("hex");
  const blockers: string[] = [];

  if (observation.kind !== "loo_desktop_gui_action_observation") blockers.push("observation_kind_invalid");
  if (!desktopBackend) blockers.push("desktop_backend_missing");
  if (desktopBackend === "direct") blockers.push("desktop_backend_not_gui_fallback");
  if (!targetApp) blockers.push("target_app_missing");
  if (!targetWindow) blockers.push("target_window_missing");
  if (!action) blockers.push("action_missing");
  if (!approvalRef) blockers.push("approval_ref_missing");
  if (observation.approved !== true) blockers.push("approval_missing");
  if (!liveActionObserved) blockers.push("desktop_live_action_not_observed");
  if (!focusBeforeApplication) blockers.push("focus_before_application_missing");
  if (!focusAfterApplication) blockers.push("focus_after_application_missing");
  if (focusChanged !== false) blockers.push("focus_changed_or_unmeasured");
  if (focusBeforeApplication && focusAfterApplication && focusBeforeApplication !== focusAfterApplication) blockers.push("focus_application_changed");
  if (!focusProof) {
    blockers.push("focus_proof_missing");
  } else if (isDiagnosticOnlyFocusProof(focusProof)) {
    blockers.push("focus_proof_diagnostic_only");
  }
  if (rawScreenshotIncluded !== false) blockers.push("raw_screenshot_included");
  if (rawSecretIncluded !== false) blockers.push("raw_secret_included");

  const actionHash = desktopBackend && targetApp && targetWindow && action
    ? desktopActionHash(desktopBackend, targetApp, targetWindow, action)
    : undefined;
  const guiBackend = desktopBackend === "cua-driver" || desktopBackend === "peekaboo" ? desktopBackend : undefined;
  const proofReady = blockers.length === 0;
  const publicSafe = rawScreenshotIncluded === false && rawSecretIncluded === false;
  const approval = proofReady && guiBackend && targetApp && targetWindow && action && actionHash && approvalRef && focusBeforeApplication && focusAfterApplication && focusProof
    ? {
      kind: "loo_release_operation_approval" as const,
      operation: "desktop_gui_mutation" as const,
      approved: true as const,
      approvalRef,
      desktopBackend: guiBackend,
      targetApp,
      targetWindow,
      action,
      actionHash,
      approvalNonce,
      issuedAt,
      expiresAt,
      focusBeforeApplication,
      focusAfterApplication,
      focusChanged: false as const,
      focusProof,
      rawScreenshotIncluded: false as const,
      rawSecretIncluded: false as const
    }
    : null;
  const runtimeProof: DesktopCollaborationRuntimeProof | null = approval
    ? {
      kind: "loo_runtime_scenario_proof",
      scenario_id: "desktop-collaboration-action-bound-v1-1",
      scenario_version: "1.1",
      proof_mode: "runtime_required",
      claim_scope: "codex-working-app-proof",
      public_safe: true,
      proof_markers: {
        action_bound_target: true,
        approval_packet_bound: true,
        backend_specific_observation: true,
        no_focus_measurement: true
      },
      raw_transcript_read: false,
      raw_prompt_included: false,
      raw_secret_included: false,
      screenshot_included: false,
      sqlite_included: false,
      screenshot_count: 0,
      action_hash: approval.actionHash
    }
    : null;

  return {
    ok: proofReady,
    proofReady,
    publicSafe,
    kind: "loo_desktop_gui_proof_report",
    desktopBackend,
    targetApp,
    targetWindow,
    action,
    actionHash,
    approvalNonce: approval ? approvalNonce : undefined,
    issuedAt: approval ? issuedAt : undefined,
    expiresAt: approval ? expiresAt : undefined,
    approvalRef,
    liveActionObserved,
    focusBeforeApplication,
    focusAfterApplication,
    focusChanged,
    focusProof,
    rawScreenshotIncluded,
    rawSecretIncluded,
    blockers,
    approval,
    runtimeProof,
    actionsPerformed: {
      desktopGuiActionRun: false
    },
    privateDataExclusions: [
      "raw screenshots or videos",
      "raw accessibility trees",
      "raw Codex transcripts",
      "raw prompts or message text",
      "tokens, credentials, API keys, cookies",
      "private customer data"
    ],
    proofBoundary: "This report validates a supplied public-safe desktop GUI action observation and may emit release approval evidence. It does not perform desktop GUI mutation, prove backend behavior by itself, or authorize unattended desktop takeover.",
    nextAction: proofReady
      ? "Use desktop-gui-approval.json only with release status gates that intentionally claim desktop GUI mutation readiness."
      : "Collect a backend-specific live/no-focus observation with public-safe fields and rerun the proof report."
  };
}

export function writeDesktopGuiProofReport(input: { evidenceDir: string; observation: unknown }): DesktopGuiProofReport {
  const evidenceDir = resolve(input.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const reportPath = join(evidenceDir, "desktop-gui-proof-report.json");
  const approvalPath = join(evidenceDir, "desktop-gui-approval.json");
  const runtimeProofPath = join(evidenceDir, "desktop-collaboration-action-bound-v1-1.runtime-proof.json");
  const report = createDesktopGuiProofReport(input.observation);
  const withPaths = {
    ...report,
    proofReportPath: reportPath,
    approvalEvidencePath: report.approval ? approvalPath : undefined,
    runtimeProofEvidencePath: report.runtimeProof ? runtimeProofPath : undefined
  };
  writeFileSync(reportPath, `${JSON.stringify(withPaths, null, 2)}\n`);
  if (report.approval) {
    writeFileSync(approvalPath, `${JSON.stringify(report.approval, null, 2)}\n`);
  }
  if (report.runtimeProof) {
    writeFileSync(runtimeProofPath, `${JSON.stringify(report.runtimeProof, null, 2)}\n`);
  }
  return withPaths;
}

export function createDesktopLiveProofHarness(input: {
  backend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  approvalRef?: string;
  scratchFilePath?: string;
  allowPersistentApprovalKey?: boolean;
  probe?: DesktopProbe;
} = {}): DesktopLiveProofHarnessReport {
  const desktopBackend = input.backend;
  const targetApp = publicTextField(input.targetApp, 120);
  const targetWindow = publicTextField(input.targetWindow, 160);
  const action = publicTextField(input.action, 160);
  const approvalRef = publicTextField(input.approvalRef, 160);
  const scratchFilePath = typeof input.scratchFilePath === "string" && input.scratchFilePath.trim() ? input.scratchFilePath.trim() : undefined;
  const backendStatus = desktopBackend
    ? desktopBackendStatus(desktopBackend, input.probe ?? systemDesktopProbe())
    : undefined;
  const blockers: string[] = [];

  if (!desktopBackend) blockers.push("desktop_backend_missing");
  if (desktopBackend === "direct") blockers.push("desktop_backend_not_gui_fallback");
  if (!targetApp) blockers.push("target_app_missing");
  if (!targetWindow) blockers.push("target_window_missing");
  if (!action) blockers.push("action_missing");
  if (!approvalRef) blockers.push("approval_ref_missing");
  if (desktopBackend && desktopBackend !== "direct" && backendStatus) {
    if (!backendStatus.available) blockers.push("desktop_backend_unavailable");
    if (backendStatus.focus.changed === null) {
      blockers.push("focus_not_measured");
    } else if (backendStatus.focus.changed) {
      blockers.push("focus_probe_changed_application");
    }
  }

  const actionHash = desktopBackend && targetApp && targetWindow && action
    ? desktopActionHash(desktopBackend, targetApp, targetWindow, action)
    : undefined;
  const proofActionTupleRequested = desktopBackend === DESKTOP_PROOF_BACKEND
    && targetApp === DESKTOP_PROOF_TARGET_APP
    && targetWindow === DESKTOP_PROOF_TARGET_WINDOW
    && action === DESKTOP_PROOF_ACTION;
  if (proofActionTupleRequested) {
    if (!scratchFilePath) blockers.push("scratch_file_missing");
    else if (!scratchFilePathAllowed(scratchFilePath, targetWindow)) blockers.push("scratch_file_path_not_bound");
  }
  let approvalArtifact: DesktopProofActionApproval | null = null;
  if (blockers.length === 0 && proofActionTupleRequested && actionHash && approvalRef && scratchFilePath) {
    approvalArtifact = createDesktopProofActionApproval({
      approvalRef,
      actionHash,
      scratchFilePath,
      allowPersistentKeyCreate: input.allowPersistentApprovalKey === true
    });
    if (!approvalArtifact) blockers.push("approval_signing_key_missing");
  }
  const proofHarnessReady = blockers.length === 0;
  const publicBackendStatus = backendStatus
    ? {
      ...backendStatus,
      focus: {
        changed: backendStatus.focus.changed,
        proof: backendStatus.focus.proof
      }
    }
    : undefined;

  return {
    ok: proofHarnessReady,
    proofHarnessReady,
    publicSafe: true,
    kind: "loo_desktop_live_proof_harness",
    desktopBackend,
    targetApp,
    targetWindow,
    action,
    actionHash,
    approvalRef,
    approvalArtifact,
    backendStatus: publicBackendStatus,
    blockers,
    proofMarkers: {
      noActionObserved: true
    },
    actionsPerformed: {
      desktopGuiActionRun: false,
      screenshotCaptured: false
    },
    privateDataExclusions: [
      "raw screenshots or videos",
      "raw accessibility trees",
      "raw Codex transcripts",
      "raw prompts or message text",
      "tokens, credentials, API keys, cookies",
      "private customer data"
    ],
    proofBoundary: "This harness prepares a public-safe live/no-focus desktop fallback proof plan. It does not perform desktop GUI mutation, capture screenshots, run live Codex control, or authorize unattended desktop takeover.",
    nextAction: proofHarnessReady
      ? "Run the backend-specific live action outside this harness, capture a public-safe no-focus observation, then validate it with loo desktop proof-report."
      : "Resolve the listed blockers before attempting any backend-specific live desktop proof."
  };
}

export function createCodexDesktopCollaborationProof(input: {
  targetRef?: string;
  targetThreadId?: string;
  desktopBackend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  actionHash?: string;
  approvalPacket?: unknown;
  execute?: boolean;
  now?: string;
} = {}): CodexDesktopCollaborationProofReport {
  const generatedAt = publicIsoTimestamp(input.now) ?? new Date().toISOString();
  const targetRef = publicCodexThreadRef(input.targetRef);
  const targetThreadId = publicCodexThreadId(input.targetThreadId) ?? (targetRef ? targetRef.slice("codex_thread:".length) : undefined);
  const desktopBackend = input.desktopBackend;
  const targetApp = publicProofTextField(input.targetApp, 120);
  const targetWindow = publicProofTextField(input.targetWindow, 160);
  const action = publicProofAction(input.action);
  const suppliedActionHash = publicHashField(input.actionHash) ? input.actionHash.toLowerCase() : undefined;
  const approvalPacket = asRecord(input.approvalPacket);
  const approvalRef = publicProofTextField(approvalPacket?.approvalRef, 160);
  const approvalSourceCoverage = codexDesktopCollaborationApprovalSourceCoverage(approvalPacket);
  const expectedActionHash = targetRef && desktopBackend && targetApp && targetWindow && action
    ? codexDesktopCollaborationActionHash(targetRef, desktopBackend, targetApp, targetWindow, action)
    : undefined;
  const blockers: string[] = [];

  if (input.execute === true) blockers.push("execute_not_supported");
  if (!targetRef) blockers.push("target_ref_missing_or_invalid");
  if (!targetThreadId) blockers.push("target_thread_id_missing_or_invalid");
  if (!desktopBackend) blockers.push("desktop_backend_missing");
  if (desktopBackend === "direct") blockers.push("desktop_backend_not_gui_fallback");
  if (!targetApp) blockers.push("target_app_missing");
  if (!targetWindow) blockers.push("target_window_missing");
  if (!action) blockers.push("action_missing");
  if (input.action && genericGuiActionRequested(input.action)) blockers.push("generic_gui_action_blocked");
  if (input.action && liveCodexControlRequested(input.action)) blockers.push("live_codex_control_blocked");
  if (action && !codexDesktopCollaborationActionAllowed(action)) blockers.push("unsupported_collaboration_action");
  if (!suppliedActionHash) {
    blockers.push("action_hash_missing");
  } else if (expectedActionHash && suppliedActionHash !== expectedActionHash) {
    blockers.push("action_hash_mismatch");
  }

  if (!approvalPacket) {
    blockers.push("approval_packet_missing");
  } else {
    blockers.push(...validateCodexDesktopCollaborationApprovalPacket(approvalPacket, {
      generatedAt,
      targetRef,
      targetThreadId,
      desktopBackend,
      targetApp,
      targetWindow,
      action,
      actionHash: suppliedActionHash,
      expectedActionHash
    }));
  }

  const uniqueBlockers = uniquePublicBlockers(blockers);
  const approvalVerified = approvalPacket !== null && uniqueBlockers.length === 0;
  const ready = uniqueBlockers.length === 0
    && Boolean(targetRef && targetThreadId && desktopBackend && targetApp && targetWindow && action && suppliedActionHash && approvalRef);

  return {
    schema: "lco.codexDesktopCollaborationProof.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt,
    ok: ready,
    status: ready ? "ready" : "blocked",
    target: {
      targetRef,
      targetThreadId
    },
    desktopBackend,
    targetApp,
    targetWindow,
    action,
    actionHash: suppliedActionHash,
    expectedActionHash,
    approvalRef,
    approvalVerified,
    blockers: uniqueBlockers,
    reasonCodes: uniquePublicBlockers([
      ready ? "action_bound_collaboration_proof_ready" : "action_bound_collaboration_proof_blocked",
      ...uniqueBlockers
    ]),
    sourceCoverage: approvalSourceCoverage,
    proofMarkers: {
      actionBoundTarget: Boolean(targetRef && targetThreadId && desktopBackend && targetApp && targetWindow && action && suppliedActionHash && expectedActionHash && suppliedActionHash === expectedActionHash),
      approvalPacketBound: approvalVerified,
      publicSafeEvidenceOnly: true,
      noScreenshotPolicy: Boolean(approvalPacket?.focusPolicy && asRecord(approvalPacket.focusPolicy)?.screenshotAllowed === false),
      dryRunOnly: true
    },
    requiredNextToolCall: ready && desktopBackend && targetApp && targetWindow && action && approvalRef
      ? {
        tool: "lco_desktop_proof",
        args: {
          check: "live_proof_harness",
          backend: desktopBackend,
          target_app: targetApp,
          target_window: targetWindow,
          action,
          approval_ref: approvalRef
        },
        execute: false
      }
      : null,
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false,
      screenshotCaptured: false
    },
    privateDataExclusions: [
      "raw screenshots or videos",
      "raw accessibility trees",
      "raw Codex transcripts",
      "raw prompts or message text",
      "tokens, credentials, API keys, cookies",
      "private customer data",
      "absolute local transcript paths"
    ],
    proofBoundary: "This Codex Desktop collaboration proof validates an exact dry-run, action-bound packet for a visible Codex target. It does not run live Codex control, click, type, select, refresh, restart, mutate Codex Desktop, capture screenshots, or claim unattended Desktop collaboration.",
    nextAction: ready
      ? "Use the emitted execute=false loo_desktop_live_proof_harness packet only if a later, separately scoped approval intentionally attempts backend-specific visible Desktop proof."
      : "Resolve blockers before attempting any Codex Desktop collaboration proof. Generic GUI or live Codex control requests must stay blocked."
  };
}

export function writeDesktopLiveProofHarness(input: {
  evidenceDir: string;
  backend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  approvalRef?: string;
  scratchFilePath?: string;
  probe?: DesktopProbe;
}): DesktopLiveProofHarnessReport {
  const evidenceDir = resolve(input.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = join(evidenceDir, "desktop-live-proof-harness.json");
  const approvalPath = join(evidenceDir, "desktop-proof-action-approval.json");
  const report = createDesktopLiveProofHarness({
    ...input,
    allowPersistentApprovalKey: true
  });
  const withPath = { ...report, evidencePath };
  writeFileSync(evidencePath, `${JSON.stringify(withPath, null, 2)}\n`);
  if (report.approvalArtifact) {
    writeFileSync(approvalPath, `${JSON.stringify(report.approvalArtifact, null, 2)}\n`);
  } else if (existsSync(approvalPath)) {
    unlinkSync(approvalPath);
  }
  return withPath;
}

export function createDesktopProofAction(input: {
  backend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  actionHash?: string;
  approvalRef?: string;
  permissionState?: string;
  execute?: boolean;
  scratchFilePath?: string;
  approvalArtifact?: unknown;
  probe?: DesktopProbe;
} = {}): DesktopProofActionReport {
  const desktopBackend = input.backend;
  const targetApp = publicTextField(input.targetApp, 120);
  const targetWindow = publicTextField(input.targetWindow, 160);
  const action = publicTextField(input.action, 160);
  const suppliedActionHash = publicHashField(input.actionHash) ? input.actionHash.toLowerCase() : undefined;
  const approvalRef = publicTextField(input.approvalRef, 160);
  const permissionState = publicTextField(input.permissionState, 160);
  const scratchFilePath = typeof input.scratchFilePath === "string" && input.scratchFilePath.trim() ? input.scratchFilePath.trim() : undefined;
  const blockers: string[] = [];
  const probe = input.probe ?? systemDesktopProbe();

  if (input.execute !== true) blockers.push("execute_flag_missing");
  if (!desktopBackend) blockers.push("desktop_backend_missing");
  if (desktopBackend === "direct") blockers.push("desktop_backend_not_gui_fallback");
  if (desktopBackend && desktopBackend !== "cua-driver") blockers.push("unsupported_desktop_proof_backend");
  if (!targetApp) blockers.push("target_app_missing");
  if (!targetWindow) blockers.push("target_window_missing");
  if (!action) blockers.push("action_missing");
  if (!approvalRef) blockers.push("approval_ref_missing");
  if (!permissionState) blockers.push("permission_state_missing");
  if (!scratchFilePath) blockers.push("scratch_file_missing");
  if (scratchFilePath && targetWindow && !scratchFilePathAllowed(scratchFilePath, targetWindow)) blockers.push("scratch_file_path_not_bound");
  if (targetApp && targetApp !== DESKTOP_PROOF_TARGET_APP) blockers.push("unsupported_desktop_proof_target_app");
  if (targetWindow && targetWindow !== DESKTOP_PROOF_TARGET_WINDOW) blockers.push("unsupported_desktop_proof_target_window");
  if (action && action !== DESKTOP_PROOF_ACTION) blockers.push("unsupported_desktop_proof_action");
  if (permissionState && !desktopPermissionStateReady(permissionState)) blockers.push("permission_state_not_ready");
  if (!suppliedActionHash) {
    blockers.push("action_hash_missing");
  } else if (desktopBackend && targetApp && targetWindow && action) {
    const expectedActionHash = desktopActionHash(desktopBackend, targetApp, targetWindow, action);
    if (suppliedActionHash !== expectedActionHash) blockers.push("action_hash_mismatch");
  }
  const approvalBlockers = validateDesktopProofActionApproval(input.approvalArtifact, {
    desktopBackend,
    targetApp,
    targetWindow,
    action,
    actionHash: suppliedActionHash,
    approvalRef,
    scratchFilePath
  });
  blockers.push(...approvalBlockers);

  let commandStatus: DesktopCommandStatus | undefined;
  if (desktopBackend === "cua-driver") {
    const config = desktopBackendConfig("cua-driver");
    commandStatus = probe.commandStatus(config.command, config.probeArgs, { env: config.env });
    if (!commandStatus.available) blockers.push("desktop_backend_unavailable");
    if (!probe.commandOutput) blockers.push("desktop_backend_command_output_unavailable");
  }

  let commandResult: DesktopCommandOutput | undefined;
  let focusBeforeApplication: string | undefined;
  let focusAfterApplication: string | undefined;
  if (blockers.length === 0) {
    focusBeforeApplication = publicTextField(probe.activeApplication?.(), 120);
    if (!focusBeforeApplication) blockers.push("focus_before_application_missing");
  }
  if (blockers.length === 0 && desktopBackend === "cua-driver" && scratchFilePath && probe.commandOutput) {
    const config = desktopBackendConfig("cua-driver");
    commandResult = probe.commandOutput(config.command, [
      "call",
      "launch_app",
      JSON.stringify({
        bundle_id: "com.apple.TextEdit",
        name: DESKTOP_PROOF_TARGET_APP,
        urls: [scratchFilePath],
        creates_new_application_instance: true
      })
    ], 30_000, { env: config.env });
    focusAfterApplication = publicTextField(probe.activeApplication?.(), 120);
    if (!focusBeforeApplication || !focusAfterApplication) {
      blockers.push("focus_before_after_missing");
    } else if (focusBeforeApplication !== focusAfterApplication) {
      blockers.push("focus_changed");
    }
    if (commandResult.status !== 0) blockers.push("desktop_backend_action_failed");
  }

  const commandAttempted = commandResult !== undefined;
  const parsedOutput = parseDesktopCommandOutputObject(commandResult?.stdout);
  const commandSucceeded = commandResult?.status === 0;
  const selfActivationSuppressed = typeof parsedOutput?.self_activation_suppressed === "boolean"
    ? parsedOutput.self_activation_suppressed
    : undefined;
  let backendOutputMatchesTarget = parsedOutput ? desktopProofBackendOutputMatches(parsedOutput, targetApp, targetWindow) : false;
  if (commandSucceeded && selfActivationSuppressed === true && !backendOutputMatchesTarget && desktopBackend === "cua-driver" && parsedOutput && probe.commandOutput) {
    const launchedPid = typeof parsedOutput.pid === "number" && Number.isFinite(parsedOutput.pid) ? Math.trunc(parsedOutput.pid) : undefined;
    if (launchedPid !== undefined) {
      const config = desktopBackendConfig("cua-driver");
      const windowListResult = probe.commandOutput(config.command, [
        "call",
        "list_windows",
        JSON.stringify({ pid: launchedPid })
      ], 30_000, { env: config.env });
      if (windowListResult.status === 0) {
        const windowListOutput = parseDesktopCommandOutputObject(windowListResult.stdout);
        backendOutputMatchesTarget = windowListOutput ? desktopProofBackendOutputMatches(windowListOutput, targetApp, targetWindow, launchedPid) : false;
      }
    }
  }
  const backendOutputVerified = commandAttempted && commandSucceeded && selfActivationSuppressed === true && backendOutputMatchesTarget;
  if (commandAttempted && commandSucceeded && !backendOutputVerified) blockers.push("desktop_backend_output_not_verified");
  if (commandAttempted && commandSucceeded && selfActivationSuppressed === true && !backendOutputMatchesTarget) blockers.push("desktop_backend_output_target_mismatch");
  const proofActionReady = commandAttempted && commandSucceeded && backendOutputVerified && blockers.length === 0;
  const observation = proofActionReady && desktopBackend === "cua-driver" && targetApp && targetWindow && action && approvalRef
    ? {
      kind: "loo_desktop_gui_action_observation",
      desktopBackend,
      targetApp,
      targetWindow,
      action,
      approvalRef,
      approved: true,
      liveActionObserved: commandSucceeded,
      focusBeforeApplication,
      focusAfterApplication,
      focusChanged: focusBeforeApplication && focusAfterApplication ? focusBeforeApplication !== focusAfterApplication : undefined,
      focusProof: focusBeforeApplication && focusAfterApplication && focusBeforeApplication === focusAfterApplication
        ? "cua_driver_launch_app_no_focus_v1"
        : "cua_driver_launch_app_focus_changed_v1",
      rawScreenshotIncluded: false,
      rawSecretIncluded: false
    } satisfies DesktopGuiActionObservation
    : null;

  return {
    ok: proofActionReady,
    proofActionReady,
    publicSafe: true,
    kind: "loo_desktop_proof_action",
    desktopBackend,
    targetApp,
    targetWindow,
    action,
    actionHash: suppliedActionHash,
    approvalRef,
    approvalVerified: approvalBlockers.length === 0,
    blockers,
    backendCommand: commandResult
      ? {
        command: commandStatus?.command || "cua-driver",
        tool: "launch_app",
        status: commandResult.status,
        rawStdoutIncluded: false,
        rawStderrIncluded: false,
        scratchFilePathIncluded: false,
        selfActivationSuppressed
      }
      : undefined,
    observation,
    actionsPerformed: {
      desktopGuiActionRun: commandAttempted,
      screenshotCaptured: false
    },
    privateDataExclusions: [
      "raw screenshots or videos",
      "raw accessibility trees",
      "raw backend stdout or stderr",
      "scratch file paths",
      "raw Codex transcripts",
      "raw prompts or message text",
      "tokens, credentials, API keys, cookies",
      "private customer data"
    ],
    proofBoundary: "This proof action is limited to one approved CUA Driver TextEdit scratch launch. It does not enable generic GUI mutation, Codex GUI mutation, prompt typing, screenshots, or unattended desktop takeover.",
    nextAction: proofActionReady
      ? "Pass observation to loo_desktop_proof_report and use the emitted approval/runtime markers only when desktop collaboration is intentionally claimed."
      : "Resolve blockers before attempting the CUA Driver TextEdit scratch proof action."
  };
}

export function writeDesktopProofAction(input: {
  evidenceDir: string;
  backend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  actionHash?: string;
  approvalRef?: string;
  permissionState?: string;
  execute?: boolean;
  scratchFilePath?: string;
  approvalArtifact?: unknown;
  probe?: DesktopProbe;
}): DesktopProofActionReport {
  const evidenceDir = resolve(input.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = join(evidenceDir, "desktop-proof-action.json");
  const observationEvidencePath = join(evidenceDir, "desktop-gui-observation.json");
  const report = createDesktopProofAction(input);
  const withPath = {
    ...report,
    evidencePath,
    observationEvidencePath: report.observation ? observationEvidencePath : undefined
  };
  writeFileSync(evidencePath, `${JSON.stringify(withPath, null, 2)}\n`);
  if (report.observation) {
    writeFileSync(observationEvidencePath, `${JSON.stringify(report.observation, null, 2)}\n`);
  } else if (existsSync(observationEvidencePath)) {
    unlinkSync(observationEvidencePath);
  }
  return withPath;
}

function readOrCreateAuditKey(auditPath: string): Buffer {
  const keyPath = `${auditPath}.key`;
  try {
    writeFileSync(keyPath, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
  }
  const encoded = readFileSync(keyPath, "utf8").trim();
  if (!/^[a-f0-9]{64}$/i.test(encoded)) {
    throw new Error("Audit fingerprint key is invalid");
  }
  return Buffer.from(encoded, "hex");
}

function readAuditKeyIfConfigured(auditPath: string): Buffer | null {
  const keyPath = `${auditPath}.key`;
  let encoded: string;
  try {
    encoded = readFileSync(keyPath, "utf8").trim();
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw new Error("Audit fingerprint key is unavailable");
  }
  if (!/^[a-f0-9]{64}$/i.test(encoded)) {
    throw new Error("Audit fingerprint key is invalid");
  }
  return Buffer.from(encoded, "hex");
}

function hmacDigest(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

function deriveAuditSubkey(key: Buffer, domain: string): string {
  return Buffer.from(hkdfSync(
    "sha256",
    key,
    Buffer.from("lco.audit.subkey.hkdf.v1", "utf8"),
    Buffer.from(domain, "utf8"),
    32
  )).toString("hex");
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function desktopBackendStatus(
  backend: DesktopBackend,
  probe: DesktopProbe,
  options: { includeSnapshot?: boolean; maxChars?: number; maxNodes?: number } = {}
): DesktopStatus {
  const config = desktopBackendConfig(backend);
  const command = config.command ?? "";
  const beforeApplication = probe.activeApplication?.();
  const commandStatus = command ? probe.commandStatus(command, config.probeArgs, { env: config.env }) : { available: false, command };
  const afterApplication = probe.activeApplication?.();
  const focusMeasured = Boolean(beforeApplication || afterApplication);
  const permissions = backend === "peekaboo" ? peekabooPermissions(command, commandStatus.available, probe) : config.permissions;
  const snapshot = backend === "peekaboo" && options.includeSnapshot ? peekabooSnapshot(command, commandStatus.available, probe, options) : undefined;
  return {
    backend,
    available: commandStatus.available,
    preferred: backend === "cua-driver",
    dryRunOnly: true,
    launch: {
      command: commandStatus.command || command,
      args: config.launchArgs,
      transport: config.transport,
      readiness: desktopLaunchReadiness(backend, commandStatus.available)
    },
    permissions,
    focus: {
      beforeApplication,
      afterApplication,
      changed: focusMeasured ? beforeApplication !== afterApplication : null,
      proof: focusMeasured ? "status_probe_only_no_action" : "not_measured"
    },
    snapshot,
    visibleCodex: backend === "peekaboo" ? visibleCodexMacroPack(snapshot) : undefined,
    limitations: config.limitations,
    backgroundSafeClaim: config.backgroundSafeClaim,
    note: config.note,
    version: commandStatus.version,
    error: commandStatus.error
  };
}

function codexDesktopFallbackBackendStatus(
  status: DesktopStatus,
  input: {
    role: CodexDesktopFallbackBackendStatus["role"];
    fallbackReason: CodexDesktopFallbackReport["fallback"]["reason"];
    takesScreenWarning: boolean;
  }
): CodexDesktopFallbackBackendStatus {
  const permissionState = desktopStatusPermissionState(status.permissions);
  const blockers = [
    ...(!status.available ? ["desktop_backend_unavailable"] : []),
    ...(permissionState === "unknown" ? ["permission_state_unknown"] : []),
    ...(permissionState === "denied" ? ["permission_state_denied"] : []),
    ...(status.focus.changed === true ? ["focus_changed_during_status_probe"] : []),
    ...(status.backend === "cua-driver" && input.fallbackReason !== "desktop_visibility_already_proven" ? ["no_focus_codex_visibility_not_proven"] : []),
    ...(status.backend === "peekaboo" && input.takesScreenWarning ? ["visible_fallback_requires_explicit_user_visible_run"] : [])
  ];
  const snapshotRequested = status.snapshot?.requested === true;
  const warnings = [
    ...status.limitations.map((limitation) => capTextValue(limitation, 220)),
    ...(status.snapshot?.warnings ?? []).map((warning) => capTextValue(warning, 220)),
    ...(input.takesScreenWarning ? ["Peekaboo may use visible macOS accessibility flows and can disturb the user's visible screen; use only as a secondary explicit fallback."] : [])
  ];
  const availableAndUnblocked = status.available && blockers.length === 0;
  return {
    backend: status.backend === "peekaboo" ? "peekaboo" : "cua-driver",
    role: input.role,
    status: !status.available ? "unavailable" : availableAndUnblocked ? "ready" : "blocked",
    available: status.available,
    permissionState,
    focus: status.focus,
    backgroundSafeClaim: status.backgroundSafeClaim,
    visibleCodex: {
      windows: status.visibleCodex?.windows?.count ?? null,
      threadCandidates: status.visibleCodex?.threadMap?.count ?? null,
      snapshotRequested,
      snapshotBlocked: snapshotRequested ? status.snapshot?.blocked === true : null
    },
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    takesScreenWarning: input.takesScreenWarning
  };
}

function desktopStatusPermissionState(permissions: DesktopStatus["permissions"]): "ready" | "unknown" | "denied" {
  const statuses = [permissions.accessibility.status, permissions.screenRecording.status];
  if (statuses.includes("denied")) return "denied";
  if (statuses.includes("unknown")) return "unknown";
  return "ready";
}

function desktopBackendConfig(backend: DesktopBackend) {
  if (backend === "cua-driver") {
    return {
      command: readEnvWithFallback("CUA_DRIVER_BIN", "cua-driver"),
      launchArgs: ["mcp"],
      probeArgs: ["--version"],
      env: {
        CUA_DRIVER_RS_TELEMETRY_ENABLED: "0"
      },
      transport: "stdio" as const,
      permissions: unknownDesktopPermissions("CUA Driver permissions have not been verified by this tool; run CUA diagnostics or OS settings before live use."),
      limitations: [
        "Direct Codex protocol remains preferred for thread control.",
        "No live GUI action is enabled until backend-specific approval exists.",
        "No-focus behavior is not claimed without local no-focus proof."
      ],
      backgroundSafeClaim: "not_proven" as const,
      note: "CUA Driver is the preferred desktop fallback and is expected to run as an MCP stdio backend with `cua-driver mcp`, but this diagnostic does not perform GUI actions."
    };
  }
  if (backend === "peekaboo") {
    return {
      command: readEnvWithFallback("PEEKABOO_BIN", "peekaboo"),
      launchArgs: [],
      probeArgs: ["--version"],
      transport: "none" as const,
      permissions: unknownDesktopPermissions("Peekaboo macOS Accessibility and Screen Recording permissions have not been verified by this tool."),
      limitations: [
        "Peekaboo is secondary to CUA Driver for desktop fallback.",
        "Live Peekaboo actions require separate backend approval and permission proof.",
        "May use visible macOS accessibility flows; no background/no-focus claim is made here."
      ],
      backgroundSafeClaim: "not_proven" as const,
      note: "Peekaboo is packaged as a macOS fallback diagnostic surface only in this beta."
    };
  }
  return {
    command: "",
    launchArgs: [],
    probeArgs: [],
    transport: "none" as const,
    permissions: {
      accessibility: { status: "not_applicable" as const, note: "Direct Codex protocol does not use desktop Accessibility permissions." },
      screenRecording: { status: "not_applicable" as const, note: "Direct Codex protocol does not use desktop Screen Recording permissions." }
    },
    limitations: [
      "Direct backend means use Codex protocol/read tools before GUI fallback.",
      "No desktop GUI action is available through the direct backend."
    ],
    backgroundSafeClaim: "not_supported" as const,
    note: "Direct backend uses Codex protocol surfaces and is preferred before GUI fallback."
  };
}

function unknownDesktopPermissions(note: string) {
  return {
    accessibility: { status: "unknown" as const, note },
    screenRecording: { status: "unknown" as const, note }
  };
}

function peekabooPermissions(command: string, available: boolean, probe: DesktopProbe) {
  const fallback = unknownDesktopPermissions("Peekaboo permissions could not be verified with `peekaboo permissions status --json --no-remote`.");
  if (!available || !probe.commandOutput) return fallback;
  const result = probe.commandOutput(command, ["permissions", "status", "--json", "--no-remote"], 3000);
  if (result.status !== 0 || !result.stdout) return fallback;
  const parsed = parseJsonObject(result.stdout);
  const data = asRecord(asRecord(parsed)?.data);
  const permissions = Array.isArray(data?.permissions) ? data.permissions : [];
  return {
    accessibility: peekabooPermissionStatus(permissions, "Accessibility"),
    screenRecording: peekabooPermissionStatus(permissions, "Screen Recording")
  };
}

function peekabooPermissionStatus(permissions: unknown[], name: string): DesktopPermissionStatus {
  const permission = permissions.map(asRecord).find((item) => item?.name === name);
  if (!permission) {
    return { status: "unknown", note: `${name} permission was not reported by Peekaboo.` };
  }
  return {
    status: permission.isGranted === true ? "granted" : "denied",
    note: `${name} permission reported by Peekaboo permissions status.`
  };
}

function peekabooSnapshot(
  command: string,
  available: boolean,
  probe: DesktopProbe,
  options: { maxChars?: number; maxNodes?: number }
): DesktopSnapshotStatus {
  const maxNodes = boundedInteger(options.maxNodes, 50, 1, 500);
  const maxChars = boundedInteger(options.maxChars, 4000, 1, 20000);
  const frontmostApp = probe.activeApplication?.();
  if (!frontmostApp) {
    return emptySnapshot({ maxNodes, blocked: true, reason: "frontmost_app_unknown", warnings: ["Frontmost app is unknown; snapshot capture was skipped."] });
  }
  const safeFrontmostApp = capTextValue(frontmostApp, maxChars);
  if (isSensitiveFrontmostApp(frontmostApp)) {
    return emptySnapshot({
      maxNodes,
      blocked: true,
      reason: "sensitive_app_blocked",
      frontmostApp: safeFrontmostApp,
      warnings: [`Frontmost app ${safeFrontmostApp} is denylisted; Peekaboo capture was skipped.`]
    });
  }
  if (!available) {
    return emptySnapshot({ maxNodes, blocked: true, reason: "peekaboo_unavailable", frontmostApp: safeFrontmostApp, warnings: ["Peekaboo is unavailable; snapshot capture was skipped."] });
  }
  if (!probe.commandOutput) {
    return emptySnapshot({ maxNodes, blocked: true, reason: "peekaboo_probe_unavailable", frontmostApp: safeFrontmostApp, warnings: ["No command output probe is configured for Peekaboo snapshot capture."] });
  }

  const result = probe.commandOutput(command, ["see", "--mode", "frontmost", "--capture-engine", "classic", "--json", "--no-remote"], 10000);
  if (result.status !== 0 || !result.stdout) {
    return emptySnapshot({
      maxNodes,
      blocked: true,
      reason: "peekaboo_snapshot_failed",
      frontmostApp: safeFrontmostApp,
      warnings: [capTextValue(result.stderr || result.error || "Peekaboo snapshot command failed.", maxChars)]
    });
  }
  const parsed = asRecord(parseJsonObject(result.stdout));
  if (!parsed || parsed.success === false) {
    return emptySnapshot({
      maxNodes,
      blocked: true,
      reason: "peekaboo_snapshot_failed",
      frontmostApp: safeFrontmostApp,
      warnings: [capTextValue(typeof parsed?.error === "string" ? parsed.error : "Peekaboo snapshot output was not valid JSON.", maxChars)]
    });
  }
  const data = asRecord(parsed.data) ?? parsed;
  const capturedApp = typeof data.application_name === "string" ? data.application_name : frontmostApp;
  const safeCapturedApp = capTextValue(capturedApp, maxChars);
  if (isSensitiveFrontmostApp(capturedApp)) {
    return emptySnapshot({
      maxNodes,
      blocked: true,
      reason: "sensitive_app_blocked",
      frontmostApp: safeCapturedApp,
      warnings: [`Captured app ${safeCapturedApp} is denylisted; snapshot output was discarded.`]
    });
  }
  const rawElements = Array.isArray(data.ui_elements) ? data.ui_elements : [];
  const elements = rawElements.slice(0, maxNodes).map((item) => peekabooElement(item, maxChars)).filter((item): item is DesktopSnapshotElement => item !== null);
  const elementCount = typeof data.element_count === "number" ? data.element_count : rawElements.length;
  return {
    requested: true,
    blocked: false,
    engine: "peekaboo",
    frontmostApp: safeCapturedApp,
    windowTitle: typeof data.window_title === "string" ? capTextValue(data.window_title, maxChars) : undefined,
    snapshotId: typeof data.snapshot_id === "string" ? capTextValue(data.snapshot_id, maxChars) : undefined,
    elements,
    truncated: rawElements.length > maxNodes || elementCount > elements.length,
    maxNodes,
    warnings: []
  };
}

function emptySnapshot(input: {
  maxNodes: number;
  blocked: boolean;
  reason: DesktopSnapshotStatus["reason"];
  frontmostApp?: string;
  warnings?: string[];
}): DesktopSnapshotStatus {
  return {
    requested: true,
    blocked: input.blocked,
    reason: input.reason,
    frontmostApp: input.frontmostApp,
    elements: [],
    truncated: false,
    maxNodes: input.maxNodes,
    warnings: input.warnings ?? []
  };
}

function peekabooElement(value: unknown, maxChars: number): DesktopSnapshotElement | null {
  const item = asRecord(value);
  if (!item) return null;
  const bounds = asRecord(item.bounds);
  return {
    elementId: capTextValue(String(item.id || item.element_id || "unknown"), maxChars),
    role: typeof item.role === "string" ? capTextValue(item.role, maxChars) : undefined,
    label: typeof item.label === "string" ? capTextValue(item.label, maxChars) : undefined,
    bounds: boundsToRect(bounds),
    actionable: item.is_actionable === true || item.actionable === true
  };
}

const threadStatusLabels = [
  "Awaiting response",
  "Running",
  "Working",
  "Thinking",
  "Needs approval",
  "Approval needed",
  "Queued",
  "Done",
  "Failed",
  "Error"
];
const threadStatusLabelSet = new Set(threadStatusLabels.map((label) => label.toLowerCase()));
const threadSectionLabels = new Set(["pinned", "projects", "chats", "recent", "show more"]);
// Codex Desktop currently groups visible sessions under these sidebar headers.
// Keep this as the single source for parser guards so product renames fail in one place.
const threadProjectHeaderLabels = new Set(["codex", "vantage"]);
const threadControlLabels = new Set(["archive chat", "automation folders", "automations", "unarchive chat", "pin chat", "unpin chat", "continue", "copy", "copy message", "new chat", "new thread", "search", "settings", "send", "plugins"]);
const threadControlPrefixLabels = ["archive chat", "automation folders", "automations", "pin chat", "unarchive chat", "unpin chat"];
const threadTimePattern = /^(?:now|yesterday|\d+\s?(?:s|m|h|d|w|mo|y))$/i;

function visibleCodexMacroPack(snapshot?: DesktopSnapshotStatus) {
  const codexSnapshot = snapshot && !snapshot.blocked && isCodexSnapshot(snapshot) ? snapshot : undefined;
  return {
    macros: [
      visibleMacro("codex_frontmost", ["codex", "frontmost", "--json"], "Read whether Codex Desktop is frontmost."),
      visibleMacro("codex_windows", ["codex", "windows", "--json"], "Read visible Codex Desktop window metadata."),
      visibleMacro("codex_threads", ["codex", "threads", "--json"], "Read visible Codex Desktop thread candidates."),
      visibleMacro("codex_thread_map", ["codex", "thread-map", "--json"], "Read a joined visible-thread and stored-thread map."),
      visibleMacro("codex_snapshot", ["codex", "snapshot", "--json"], "Read a guarded visible Codex snapshot.")
    ],
    safetyRules: [
      "Run status/frontmost/windows before visible mutation.",
      "No generic prompt typing, send, approve, or generic click actions in this public beta surface.",
      "Snapshot capture must pass sensitive-app denylist checks before invoking Peekaboo.",
      "Live visible GUI actions remain disabled until backend-specific approval and permission gates exist."
    ],
    windows: codexSnapshot ? visibleWindowsFromSnapshot(codexSnapshot) : undefined,
    threadMap: codexSnapshot ? visibleThreadMapFromSnapshot(codexSnapshot) : undefined
  };
}

function visibleMacro(name: string, legacyCommand: string[], description: string): VisibleCodexMacro {
  return { name, legacyCommand, description, mode: "read_only", sideEffects: [] };
}

function visibleWindowsFromSnapshot(snapshot: DesktopSnapshotStatus): VisibleCodexWindows {
  const title = snapshot.windowTitle ? capTextValue(snapshot.windowTitle, 200) : undefined;
  const window: VisibleCodexWindow = {
    visibleId: `visible-window-${shortHash(`${snapshot.frontmostApp || "Codex"}:${snapshot.snapshotId || ""}:${title || ""}`)}`,
    index: 0,
    appName: capTextValue(snapshot.frontmostApp || "Codex", 80),
    title,
    titleHash: title ? shortHash(title) : undefined,
    snapshotId: snapshot.snapshotId,
    frontmost: true,
    source: "peekaboo_snapshot"
  };
  return {
    source: "peekaboo_snapshot",
    count: 1,
    windows: [window],
    warnings: snapshot.truncated ? ["Snapshot was truncated; visible window metadata is still bounded to the captured frontmost Codex window."] : []
  };
}

function visibleThreadMapFromSnapshot(snapshot: DesktopSnapshotStatus): VisibleCodexThreadMap {
  const threads: VisibleCodexThreadCandidate[] = [];
  const seen = new Set<string>();
  const consumedChildElementIds = new Set<string>();
  const consumedChildFingerprints = new Set<string>();
  const acceptedElementFingerprints = new Set<string>();
  let currentProject: string | undefined;
  let inProjects = false;
  let structuralCandidatesSkipped = 0;
  let degenerateCandidatesSkipped = 0;
  for (const element of snapshot.elements) {
    if (threads.length >= snapshot.maxNodes) break;
    const elementFingerprint = sidebarChildFingerprint(element);
    if (consumedChildElementIds.has(element.elementId) || (elementFingerprint && consumedChildFingerprints.has(elementFingerprint))) continue;
    const rawLabel = element.label?.trim();
    if (!rawLabel || !isThreadCandidateRole(element.role)) continue;
    const lowered = rawLabel.toLowerCase();
    if (threadSectionLabels.has(lowered)) {
      inProjects = lowered === "projects" || inProjects;
      continue;
    }
    if (isStructuralSidebarLabel(lowered)) {
      structuralCandidatesSkipped += 1;
      continue;
    }
    if (inProjects && isStaticThreadRole(element.role) && looksLikeProjectHeader(rawLabel)) {
      currentProject = capTextValue(rawLabel, 160);
      continue;
    }
    if (isStaticThreadRole(element.role) && threadProjectHeaderLabels.has(lowered)) {
      currentProject = capTextValue(rawLabel, 160);
      continue;
    }
    const childCandidate = isThreadControlLabel(lowered)
      ? sidebarThreadCandidateFromChildText(snapshot.elements, element)
      : null;
    if (isThreadControlLabel(lowered) && !childCandidate) continue;
    if (isDegenerateThreadCandidate(element) && !childCandidate) {
      degenerateCandidatesSkipped += 1;
      continue;
    }
    if (childCandidate?.titleElementFingerprint && acceptedElementFingerprints.has(childCandidate.titleElementFingerprint)) continue;
    const split = childCandidate?.split ?? splitThreadTitleStatus(rawLabel);
    if (!split.title || isThreadControlLabel(split.title.toLowerCase())) continue;
    if (!isVisibleSidebarCandidateTitle({ title: split.title, rawLabel, element, childCandidate: Boolean(childCandidate), split })) continue;
    if (split.title.length < 3 || isKnownThreadProjectHeader(split.title)) continue;
    const visibleId = visibleThreadId({ index: threads.length, title: split.title, sourceElementId: element.elementId });
    if (seen.has(visibleId)) continue;
    seen.add(visibleId);
    for (const childId of childCandidate?.consumedElementIds ?? []) consumedChildElementIds.add(childId);
    for (const childFingerprint of childCandidate?.consumedElementFingerprints ?? []) consumedChildFingerprints.add(childFingerprint);
    if (elementFingerprint) acceptedElementFingerprints.add(elementFingerprint);
    const center = centerFromBounds(element.bounds);
    threads.push({
      visibleId,
      index: threads.length,
      title: split.title,
      rawTitle: capTextValue(childCandidate?.rawLabel ?? rawLabel, 200),
      project: currentProject,
      status: split.status,
      updatedLabel: split.updatedLabel,
      titleHash: shortHash(split.title),
      role: element.role,
      sourceElementId: element.elementId,
      bounds: element.bounds,
      center,
      confidence: threadConfidence({ role: element.role, center, status: split.status, updatedLabel: split.updatedLabel, project: currentProject }),
      source: "peekaboo_snapshot",
      titleAvailable: true
    });
  }
  return {
    source: "peekaboo_snapshot",
    count: threads.length,
    maxItems: snapshot.maxNodes,
    threads,
    warnings: [
      ...(snapshot.truncated ? ["Snapshot was truncated before thread-map extraction; rerun with a larger bounded max_nodes value if more visible rows are needed."] : []),
      ...(structuralCandidatesSkipped ? [`Skipped ${structuralCandidatesSkipped} structural sidebar candidate(s) while extracting visible Codex threads.`] : []),
      ...(degenerateCandidatesSkipped ? [`Skipped ${degenerateCandidatesSkipped} degenerate sidebar candidate(s) while extracting visible Codex threads.`] : [])
    ]
  };
}

function sidebarThreadCandidateFromChildText(
  elements: DesktopSnapshotElement[],
  row: DesktopSnapshotElement
): {
  split: ReturnType<typeof splitThreadTitleStatus>;
  rawLabel: string;
  consumedElementIds: string[];
  consumedElementFingerprints: string[];
  titleElementFingerprint?: string;
} | null {
  if (!row.bounds) return null;
  const children = elements
    .filter((element) => element.elementId !== row.elementId && element.label && isStaticThreadRole(element.role) && rectContains(row.bounds, element.bounds))
    .sort((left, right) => (left.bounds?.y ?? 0) - (right.bounds?.y ?? 0) || (left.bounds?.x ?? 0) - (right.bounds?.x ?? 0));
  if (!children.length) return null;
  const updatedLabel = children.map((child) => child.label?.trim()).find((label): label is string => Boolean(label && threadTimePattern.test(label)))
    ?? splitThreadTitleStatus(row.label ?? "").updatedLabel;
  const statusLabel = children.map((child) => child.label?.trim()).find((label): label is string => Boolean(label && threadStatusLabelSet.has(label.toLowerCase())));
  const titleChild = children.find((child) => looksLikeSidebarThreadTitle(child.label ?? ""));
  const title = titleChild?.label?.trim();
  if (!title) return null;
  const rawLabel = [title, statusLabel, updatedLabel].filter(Boolean).join(" ");
  return {
    split: splitThreadTitleStatus(rawLabel),
    rawLabel,
    consumedElementIds: children.map((child) => stableElementId(child)).filter((id): id is string => Boolean(id)),
    consumedElementFingerprints: children.map(sidebarChildFingerprint).filter((fingerprint): fingerprint is string => Boolean(fingerprint)),
    titleElementFingerprint: sidebarChildFingerprint(titleChild)
  };
}

function looksLikeSidebarThreadTitle(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed || trimmed.length < 3) return false;
  const lowered = trimmed.toLowerCase();
  if (threadSectionLabels.has(lowered) || isThreadControlLabel(lowered) || threadTimePattern.test(lowered) || threadStatusLabelSet.has(lowered)) return false;
  return !/[\\/]/.test(trimmed) && !trimmed.includes("<redacted-");
}

function isStructuralSidebarLabel(lowered: string): boolean {
  if (lowered === "scheduled task folders") return true;
  return false;
}

function isKnownThreadProjectHeader(label: string): boolean {
  return threadProjectHeaderLabels.has(label.trim().toLowerCase());
}

function isDegenerateThreadCandidate(element: DesktopSnapshotElement): boolean {
  if (!element.bounds) return false;
  return element.bounds.height <= 1 || element.bounds.width <= 1;
}

function isVisibleSidebarCandidateTitle({
  title,
  rawLabel,
  element,
  childCandidate,
  split
}: {
  title: string;
  rawLabel: string;
  element: DesktopSnapshotElement;
  childCandidate: boolean;
  split: ReturnType<typeof splitThreadTitleStatus>;
}): boolean {
  if (looksLikeSidebarThreadTitle(title)) return true;
  if (childCandidate || isStaticThreadRole(element.role)) return false;
  if (!title.includes("<redacted-")) return false;
  const rawSplit = splitThreadTitleStatus(rawLabel);
  return Boolean(split.status || split.updatedLabel || rawSplit.status || rawSplit.updatedLabel);
}

function stableElementId(element: DesktopSnapshotElement): string | undefined {
  const id = element.elementId.trim();
  return id && id !== "unknown" ? id : undefined;
}

function sidebarChildFingerprint(element: DesktopSnapshotElement | undefined): string | undefined {
  if (!element?.bounds || !element.label) return undefined;
  const label = element.label.trim();
  if (!label) return undefined;
  const role = (element.role || "").trim().toLowerCase();
  const { x, y, width, height } = element.bounds;
  return `${role}:${label}:${x}:${y}:${width}:${height}`;
}

function isCodexSnapshot(snapshot: DesktopSnapshotStatus): boolean {
  const app = (snapshot.frontmostApp || "").trim().toLowerCase();
  return app === "codex" || app === "codex desktop";
}

function splitThreadTitleStatus(rawLabel: string): { title: string; status?: string; updatedLabel?: string } {
  const parts = rawLabel.trim().split(/\s+/);
  let updatedLabel: string | undefined;
  let titleText = rawLabel.trim();
  if (parts.length && threadTimePattern.test(parts[parts.length - 1]!)) {
    updatedLabel = parts.pop();
    titleText = parts.join(" ").trim();
  }
  let status: string | undefined;
  for (const label of threadStatusLabels) {
    const suffix = ` ${label}`.toLowerCase();
    if (titleText.toLowerCase().endsWith(suffix)) {
      status = label;
      titleText = titleText.slice(0, -label.length).trim();
      break;
    }
  }
  return { title: capTextValue(titleText, 160), status, updatedLabel };
}

function isThreadCandidateRole(role: string | undefined): boolean {
  const value = (role || "").toLowerCase();
  return ["button", "statictext", "text", "textfield", "group", "row", "link"].some((candidate) => value.includes(candidate));
}

function isStaticThreadRole(role: string | undefined): boolean {
  const value = (role || "").toLowerCase();
  return value.includes("statictext") || value === "text";
}

function isThreadControlLabel(lowered: string): boolean {
  if (threadControlLabels.has(lowered)) return true;
  if (threadControlPrefixLabels.some((control) => lowered.startsWith(control))) return true;
  return ["archive chat", "unpin chat", "pin chat"].some((control) => lowered.includes(control));
}

function looksLikeProjectHeader(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > 80) return false;
  const lowered = trimmed.toLowerCase();
  if (threadSectionLabels.has(lowered) || isThreadControlLabel(lowered)) return false;
  return !threadTimePattern.test(lowered);
}

function visibleThreadId(input: { index: number; title: string; sourceElementId: string }): string {
  return `visible-${input.index}-${shortHash(`${input.sourceElementId}:${input.index}:${input.title}`)}`;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function centerFromBounds(bounds: DesktopSnapshotElement["bounds"]): { x: number; y: number } | undefined {
  if (!bounds) return undefined;
  return { x: Math.trunc(bounds.x + bounds.width / 2), y: Math.trunc(bounds.y + bounds.height / 2) };
}

function rectContains(parent: DesktopSnapshotElement["bounds"], child: DesktopSnapshotElement["bounds"]): boolean {
  if (!parent || !child) return false;
  return child.x >= parent.x
    && child.y >= parent.y
    && child.x + child.width <= parent.x + parent.width
    && child.y + child.height <= parent.y + parent.height;
}

function threadConfidence(input: {
  role?: string;
  center?: { x: number; y: number };
  status?: string;
  updatedLabel?: string;
  project?: string;
}): "low" | "medium" | "high" {
  let score = 0;
  if (input.center) score += 2;
  const role = (input.role || "").toLowerCase();
  if (role.includes("button") || role.includes("row") || role.includes("group")) score += 1;
  if (input.status || input.updatedLabel) score += 1;
  if (input.project) score += 1;
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

function isSensitiveFrontmostApp(value: string): boolean {
  return ["messages", "mail", "1password", "passwords", "keychain access"].includes(value.trim().toLowerCase());
}

function boundsToRect(bounds: Record<string, unknown> | null): DesktopSnapshotElement["bounds"] {
  if (!bounds) return undefined;
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  return { x, y, width, height };
}

function capTextValue(value: unknown, maxChars: number): string {
  const redacted = String(redactValue(String(value)))
    .replace(/~\/\.codex\/(?:sessions|archived_sessions)\/[^\s"'`)]+/g, "<redacted-path>")
    .replace(/\/Volumes\/[^\s"'`)]+/g, "<redacted-path>")
    .replace(/\/(?:private\/)?(?:tmp|var)\/[^\s"'`)]+/g, "<redacted-path>");
  return redacted.length > maxChars ? redacted.slice(0, maxChars) : redacted;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback));
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseDesktopCommandOutputObject(value?: string): Record<string, unknown> | null {
  const output = asRecord(parseJsonObject(value || ""));
  if (!output) return null;
  const structuredContent = asRecord(output.structuredContent);
  if (structuredContent) return structuredContent;
  const content = Array.isArray(output.content) ? output.content : [];
  for (const item of content) {
    const record = asRecord(item);
    const text = typeof record?.text === "string" ? record.text : typeof item === "string" ? item : undefined;
    const parsedText = asRecord(parseJsonObject(text || ""));
    if (parsedText) return parsedText;
  }
  return output;
}

async function codexReadRequest(client: CodexClient, method: string, params: Record<string, unknown>): Promise<{
  ok: boolean;
  result?: unknown;
  error?: string;
}> {
  assertCodexMethodAllowed(method, "read");
  try {
    const response = await client.request(method, params);
    const record = asRecord(response);
    if (record && typeof record.ok === "boolean") {
      return record.ok
        ? { ok: true, result: redactValue(record.result) }
        : { ok: false, error: capTextValue(record.error ?? `${method} failed`, 260) };
    }
    return { ok: true, result: redactValue(response) };
  } catch (error) {
    return { ok: false, error: capTextValue(error instanceof Error ? error.message : String(error), 260) };
  }
}

function threadRecordsFromListResult(result: unknown): Record<string, unknown>[] {
  const record = asRecord(result);
  const data = Array.isArray(record?.data) ? record.data : Array.isArray(record?.threads) ? record.threads : [];
  return data.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item));
}

function threadIdsFromLoadedResult(result: unknown): string[] {
  const record = asRecord(result);
  const data = Array.isArray(record?.data) ? record.data : Array.isArray(record?.threads) ? record.threads : [];
  return data.map((item) => typeof item === "string" ? item : stringField(asRecord(item)?.id)).filter((id): id is string => Boolean(id));
}

function appServerThreadSignal(thread: Record<string, unknown>, loadedThreadIds: Set<string> | null): CodexAppServerThreadSignal {
  const threadId = capTextValue(stringField(thread.id) ?? "unknown", 160);
  const title = publicTextField(thread.name, 160);
  const titleAliases = publicTitleAliases(thread, title);
  const loaded = loadedThreadIds ? loadedThreadIds.has(threadId) : null;
  return {
    appServerRef: codexAppThreadRef(threadId),
    threadId,
    titleSanitized: title ?? null,
    titleAliases,
    titleHash: title ? shortHash(title) : null,
    status: threadStatus(thread.status),
    loaded,
    loadedState: loaded === null ? "not_claimed" : loaded ? "loaded" : "not_loaded",
    updatedAt: unixSecondsToIso(thread.updatedAt),
    sourceRef: `codex_thread:${threadId}`,
    confidence: title ? 0.9 : 0.62
  };
}

function publicTitleAliases(thread: Record<string, unknown>, primaryTitle: string | undefined): string[] {
  const aliases = [
    thread.displayName,
    thread.display_name,
    thread.title,
    thread.titleSanitized,
    ...(Array.isArray(thread.titleAliases) ? thread.titleAliases : []),
    ...(Array.isArray(thread.title_aliases) ? thread.title_aliases : [])
  ];
  const sanitized = aliases
    .map((alias) => publicTextField(alias, 160))
    .filter((alias): alias is string => Boolean(alias && alias.trim()))
    .filter((alias) => alias !== primaryTitle);
  return [...new Set(sanitized)].slice(0, 12);
}

function threadStatus(value: unknown): string | null {
  if (typeof value === "string") return capTextValue(value, 80);
  const record = asRecord(value);
  return publicTextField(record?.type, 80) ?? null;
}

function unixSecondsToIso(value: unknown): string | null {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (numeric === null) return null;
  const date = new Date(numeric * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function codexAppThreadRef(threadId: string): string {
  return `codex_app_thread:${threadId}`;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalDesktopBackendObservation(value: unknown): DesktopBackend | undefined {
  return isDesktopBackend(value) ? value : undefined;
}

function publicTextField(value: unknown, maxChars: number): string | undefined {
  return publicProofTextField(value, maxChars);
}

function publicHashField(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function publicIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function publicCodexThreadRef(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^codex_thread:[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : undefined;
}

function publicCodexThreadId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : undefined;
}

function publicProofTextField(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const redacted = String(redactValue(trimmed))
    .replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, "<redacted-secret>")
    .replace(/\b(?:ghp|github_pat|glpat|xox[baprs]|AKIA|ASIA|AIza)[A-Za-z0-9_=-]{10,}\b/g, "<redacted-secret>")
    .replace(/~\/\.codex\/(?:sessions|archived_sessions)\/[^\s"'`)]+/g, "<redacted-path>")
    .replace(/\/Volumes\/[^\s"'`)]+/g, "<redacted-path>")
    .replace(/\/(?:private\/)?(?:tmp|var)\/[^\s"'`)]+/g, "<redacted-path>");
  const publicOnly = redacted.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return publicOnly ? capTextValue(publicOnly, maxChars) : undefined;
}

function publicProofAction(value: unknown): string | undefined {
  return publicProofTextField(value, 160);
}

function codexDesktopCollaborationActionHash(
  targetRef: string,
  desktopBackend: DesktopBackend,
  targetApp: string,
  targetWindow: string,
  action: string
): string {
  return createHash("sha256").update(JSON.stringify({ targetRef, desktopBackend, targetApp, targetWindow, action })).digest("hex");
}

function codexDesktopCollaborationActionAllowed(action: string): boolean {
  return action === "verify_visible_thread_alignment";
}

function genericGuiActionRequested(value: string): boolean {
  return /\b(click|type|paste|key(?:press)?|drag|drop|select|scroll|tap|press|write|input)\b/i.test(value);
}

function liveCodexControlRequested(value: string): boolean {
  return /\b(continue|send|steer|resume|interrupt|approve|start turn|turn\/start|thread\/resume)\b/i.test(value);
}

function codexDesktopCollaborationApprovalSourceCoverage(approvalPacket: Record<string, unknown> | null): CodexDesktopCollaborationProofReport["sourceCoverage"] {
  const coverage = asRecord(approvalPacket?.sourceCoverage);
  return {
    indexedSession: sourceCoverageState(coverage?.indexedSession),
    desktopCoherence: sourceCoverageState(coverage?.desktopCoherence),
    desktopFallback: sourceCoverageState(coverage?.desktopFallback),
    approvalPacket: approvalPacket ? sourceCoverageState(coverage?.approvalPacket) : "unavailable"
  };
}

function sourceCoverageState(value: unknown): SourceCoverageState {
  return value === "ok" || value === "partial" || value === "unavailable" || value === "not_configured"
    ? value
    : "partial";
}

function validateCodexDesktopCollaborationApprovalPacket(approvalPacket: Record<string, unknown>, expected: {
  generatedAt: string;
  targetRef?: string;
  targetThreadId?: string;
  desktopBackend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  actionHash?: string;
  expectedActionHash?: string;
}): string[] {
  const blockers: string[] = [];
  if (approvalPacket.schema !== "lco.codexDesktopCollaborationProofApproval.v1") blockers.push("approval_packet_schema_invalid");
  if (approvalPacket.approved !== true) blockers.push("approval_packet_not_approved");
  if (!publicProofTextField(approvalPacket.approvalRef, 160)) blockers.push("approval_ref_missing");
  if (approvalPacket.targetRef !== expected.targetRef) blockers.push("approval_target_ref_mismatch");
  if (approvalPacket.targetThreadId !== undefined && approvalPacket.targetThreadId !== expected.targetThreadId) blockers.push("approval_target_thread_id_mismatch");
  if (approvalPacket.desktopBackend !== expected.desktopBackend) blockers.push("approval_backend_mismatch");
  if (approvalPacket.targetApp !== expected.targetApp) blockers.push("approval_target_app_mismatch");
  if (approvalPacket.targetWindow !== expected.targetWindow) blockers.push("approval_target_window_mismatch");
  if (approvalPacket.action !== expected.action) blockers.push("approval_action_mismatch");
  if (approvalPacket.actionHash !== expected.actionHash || approvalPacket.actionHash !== expected.expectedActionHash) blockers.push("approval_action_hash_mismatch");
  const issuedAt = publicIsoTimestamp(approvalPacket.issuedAt);
  const expiresAt = publicIsoTimestamp(approvalPacket.expiresAt);
  if (!issuedAt) {
    blockers.push("approval_packet_issued_at_invalid");
  } else if (Date.parse(issuedAt) > Date.parse(expected.generatedAt)) {
    blockers.push("approval_packet_issued_at_in_future");
  }
  if (!expiresAt) {
    blockers.push("approval_packet_expires_at_invalid");
  } else if (Date.parse(expiresAt) <= Date.parse(expected.generatedAt)) {
    blockers.push("approval_packet_expired");
  }
  const focusPolicy = asRecord(approvalPacket.focusPolicy);
  if (focusPolicy?.screenshotAllowed !== false) blockers.push("approval_screenshot_policy_missing");
  if (focusPolicy?.requireNoFocusSteal !== true) blockers.push("approval_no_focus_policy_missing");
  const coverage = codexDesktopCollaborationApprovalSourceCoverage(approvalPacket);
  if (coverage.indexedSession !== "ok" || coverage.desktopCoherence !== "ok" || coverage.desktopFallback !== "ok" || coverage.approvalPacket !== "ok") {
    blockers.push("source_coverage_incomplete");
  }
  return blockers;
}

function uniquePublicBlockers(values: string[]): string[] {
  return [...new Set(values.map((value) => publicProofTextField(value, 100)).filter((value): value is string => Boolean(value)))].slice(0, 30);
}

function desktopActionHash(desktopBackend: DesktopBackend, targetApp: string, targetWindow: string, action: string): string {
  return createHash("sha256").update(JSON.stringify({ desktopBackend, targetApp, targetWindow, action })).digest("hex");
}

function desktopScratchFilePathHash(scratchFilePath: string): string {
  return createHash("sha256").update(scratchFilePath).digest("hex");
}

function createDesktopProofActionApproval(input: {
  approvalRef: string;
  actionHash: string;
  scratchFilePath: string;
  allowPersistentKeyCreate?: boolean;
}): DesktopProofActionApproval | null {
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.parse(issuedAt) + DESKTOP_GUI_APPROVAL_TTL_MS).toISOString();
  const scratchFilePathHash = desktopScratchFilePathHash(input.scratchFilePath);
  const approvalSignature = desktopProofApprovalSignature({
    approvalRef: input.approvalRef,
    actionHash: input.actionHash,
    scratchFilePathHash,
    issuedAt,
    expiresAt
  }, {
    allowPersistentKeyCreate: input.allowPersistentKeyCreate === true
  });
  if (!approvalSignature) return null;
  return {
    kind: "loo_desktop_proof_action_approval",
    approved: true,
    approvalRef: input.approvalRef,
    desktopBackend: DESKTOP_PROOF_BACKEND,
    targetApp: DESKTOP_PROOF_TARGET_APP,
    targetWindow: DESKTOP_PROOF_TARGET_WINDOW,
    action: DESKTOP_PROOF_ACTION,
    actionHash: input.actionHash,
    scratchFilePathHash,
    issuedAt,
    expiresAt,
    approvalSignature
  };
}

function scratchFilePathAllowed(scratchFilePath: string, targetWindow: string): boolean {
  if (!isAbsolute(scratchFilePath) || basename(scratchFilePath) !== targetWindow) return false;
  try {
    if (lstatSync(scratchFilePath).isSymbolicLink()) return false;
    const root = realpathSync(desktopProofScratchRoot());
    const file = realpathSync(scratchFilePath);
    return isPathInside(root, file) && basename(file) === targetWindow;
  } catch {
    return false;
  }
}

function validateDesktopProofActionApproval(approvalArtifact: unknown, expected: {
  desktopBackend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  actionHash?: string;
  approvalRef?: string;
  scratchFilePath?: string;
}): string[] {
  const approval = asRecord(approvalArtifact);
  const blockers: string[] = [];
  if (!approval) return ["approval_artifact_missing"];
  if (approval.kind !== "loo_desktop_proof_action_approval") blockers.push("approval_artifact_kind_invalid");
  if (approval.approved !== true) blockers.push("approval_artifact_not_approved");
  if (approval.approvalRef !== expected.approvalRef) blockers.push("approval_ref_mismatch");
  if (approval.desktopBackend !== expected.desktopBackend) blockers.push("approval_backend_mismatch");
  if (approval.targetApp !== expected.targetApp) blockers.push("approval_target_app_mismatch");
  if (approval.targetWindow !== expected.targetWindow) blockers.push("approval_target_window_mismatch");
  if (approval.action !== expected.action) blockers.push("approval_action_mismatch");
  if (approval.actionHash !== expected.actionHash) blockers.push("approval_action_hash_mismatch");
  if (!expected.scratchFilePath || approval.scratchFilePathHash !== desktopScratchFilePathHash(expected.scratchFilePath)) blockers.push("approval_scratch_file_hash_mismatch");
  const expiresAt = typeof approval.expiresAt === "string" ? Date.parse(approval.expiresAt) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) blockers.push("approval_artifact_expired");
  if (!publicHashField(approval.approvalSignature)) {
    blockers.push("approval_signature_missing");
  } else if (
    expected.approvalRef
    && expected.actionHash
    && expected.scratchFilePath
    && typeof approval.issuedAt === "string"
    && typeof approval.expiresAt === "string"
  ) {
    const expectedSignature = desktopProofApprovalSignature({
      approvalRef: expected.approvalRef,
      actionHash: expected.actionHash,
      scratchFilePathHash: desktopScratchFilePathHash(expected.scratchFilePath),
      issuedAt: approval.issuedAt,
      expiresAt: approval.expiresAt
    }, {
      allowPersistentKeyCreate: false
    });
    if (!expectedSignature) blockers.push("approval_signature_key_missing");
    else if (approval.approvalSignature.toLowerCase() !== expectedSignature) blockers.push("approval_signature_mismatch");
  } else {
    blockers.push("approval_signature_mismatch");
  }
  return blockers;
}

function desktopProofScratchRoot(): string {
  return resolve(readEnvWithFallback("DESKTOP_PROOF_SCRATCH_ROOT", "/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator"));
}

function isPathInside(parent: string, child: string): boolean {
  const pathDelta = relative(parent, child);
  return pathDelta === "" || (!!pathDelta && !pathDelta.startsWith("..") && !isAbsolute(pathDelta));
}

function desktopProofApprovalKeyPath(): string {
  return readEnv("DESKTOP_PROOF_APPROVAL_KEY_PATH")
    || join(resolveHomeDir(), ".openclaw", "lossless-openclaw-orchestrator", "desktop-proof-action.key");
}

function desktopProofApprovalSecret(options: { allowPersistentKeyCreate?: boolean } = {}): Buffer | null {
  const envSecret = readEnv("DESKTOP_PROOF_APPROVAL_SECRET");
  if (envSecret && envSecret.trim()) return Buffer.from(envSecret.trim(), "utf8");
  const keyPath = desktopProofApprovalKeyPath();
  if (!existsSync(keyPath)) {
    if (options.allowPersistentKeyCreate !== true) return null;
    mkdirSync(dirname(keyPath), { recursive: true });
  }
  try {
    writeFileSync(keyPath, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
  }
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // Best effort only; writeFileSync(mode) already sets the intended mode on creation.
  }
  const encoded = readFileSync(keyPath, "utf8").trim();
  if (!/^[a-f0-9]{64}$/i.test(encoded)) {
    throw new Error(`Desktop proof approval key is invalid: ${keyPath}`);
  }
  return Buffer.from(encoded, "hex");
}

function desktopProofApprovalPayload(input: {
  approvalRef: string;
  actionHash: string;
  scratchFilePathHash: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return JSON.stringify({
    kind: "loo_desktop_proof_action_approval",
    approvalRef: input.approvalRef,
    desktopBackend: DESKTOP_PROOF_BACKEND,
    targetApp: DESKTOP_PROOF_TARGET_APP,
    targetWindow: DESKTOP_PROOF_TARGET_WINDOW,
    action: DESKTOP_PROOF_ACTION,
    actionHash: input.actionHash,
    scratchFilePathHash: input.scratchFilePathHash,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt
  });
}

function desktopProofApprovalSignature(input: {
  approvalRef: string;
  actionHash: string;
  scratchFilePathHash: string;
  issuedAt: string;
  expiresAt: string;
}, options: { allowPersistentKeyCreate?: boolean } = {}): string | null {
  const secret = desktopProofApprovalSecret(options);
  if (!secret) return null;
  return createHmac("sha256", secret).update(desktopProofApprovalPayload(input)).digest("hex");
}

function desktopProofBackendOutputMatches(output: Record<string, unknown>, targetApp?: string, targetWindow?: string, targetPid?: number): boolean {
  if (targetApp !== DESKTOP_PROOF_TARGET_APP || targetWindow !== DESKTOP_PROOF_TARGET_WINDOW) return false;
  const outputName = typeof output.name === "string" ? output.name : undefined;
  const bundleId = typeof output.bundle_id === "string" ? output.bundle_id : undefined;
  const appMatches = outputName === targetApp || bundleId === "com.apple.TextEdit";
  const windows = Array.isArray(output.windows) ? output.windows : [];
  const windowMatches = windows.some((item) => {
    const record = asRecord(item);
    const windowPid = typeof record?.pid === "number" && Number.isFinite(record.pid) ? Math.trunc(record.pid) : undefined;
    const windowPidMatches = targetPid === undefined || windowPid === targetPid;
    const windowAppMatches = record?.app_name === targetApp || record?.owner_name === targetApp;
    return record?.title === targetWindow && windowPidMatches && (appMatches || windowAppMatches);
  });
  return windowMatches;
}

function desktopPermissionStateReady(value: string): boolean {
  const entries = new Map<string, string>();
  for (const token of value.split(/[;,\n]+/)) {
    const match = token.trim().toLowerCase().match(/^([a-z_-]+)\s*[:=]\s*(true|false)$/);
    if (match) entries.set(match[1]!, match[2]!);
  }
  return entries.get("accessibility") === "true" && (entries.get("screen_recording") === "true" || entries.get("screen-recording") === "true");
}

function isDiagnosticOnlyFocusProof(value: string): boolean {
  return ["not_measured", "status_probe_only_no_action"].includes(value.trim().toLowerCase());
}

function desktopLaunchReadiness(backend: DesktopBackend, commandAvailable: boolean) {
  if (backend === "direct") {
    return {
      status: "not_applicable" as const,
      note: "Direct Codex protocol does not launch a desktop fallback backend."
    };
  }
  if (!commandAvailable) {
    return {
      status: "unavailable" as const,
      note: "Binary status probe failed; launch readiness was not checked."
    };
  }
  return {
    status: "not_probed" as const,
    note: "Binary status probe succeeded; stdio launch readiness is not probed because starting the backend would run a GUI-control server."
  };
}

function systemDesktopProbe(): DesktopProbe {
  return {
    commandStatus(command, args = ["--version"], options) {
      const result = spawnSync(command, args, { encoding: "utf8", timeout: 3000, env: mergedDesktopEnv(options) });
      const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
      const safeOutput = String(redactValue(output));
      const safeError = result.error?.message ? String(redactValue(result.error.message)) : undefined;
      return {
        available: result.status === 0,
        command: redactValue(command) as string,
        version: result.status === 0 && safeOutput ? safeOutput.split(/\r?\n/)[0] : undefined,
        error: result.status === 0 ? undefined : safeOutput || safeError || "command unavailable"
      };
    },
    commandOutput(command, args = [], timeoutMs = 5000, options) {
      const result = spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs, env: mergedDesktopEnv(options) });
      return {
        status: result.status ?? (result.error ? 1 : 0),
        command: redactValue(command) as string,
        stdout: result.stdout || "",
        stderr: String(redactValue(result.stderr || "")),
        error: result.error?.message ? String(redactValue(result.error.message)) : undefined
      };
    },
    activeApplication() {
      const result = spawnSync("osascript", ["-e", 'tell application "System Events" to get name of first application process whose frontmost is true'], {
        encoding: "utf8",
        timeout: 3000
      });
      return result.status === 0 ? result.stdout.trim() || undefined : undefined;
    }
  };
}

function mergedDesktopEnv(options?: DesktopCommandOptions): NodeJS.ProcessEnv {
  return options?.env ? { ...process.env, ...options.env } : process.env;
}

export * from "./drive.js";
