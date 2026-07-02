import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import {
  createSessionSanitizerRepairPlan,
  createSessionSanitizerReport,
  type SessionSanitizerRepairPlan,
  type SessionSanitizerReport,
  type SessionSanitizerSource
} from "./session-sanitizer.js";

export { createSessionSanitizerRepairPlan, createSessionSanitizerReport } from "./session-sanitizer.js";
export type {
  SessionSanitizerConfidence,
  SessionSanitizerFinding,
  SessionSanitizerPatternClass,
  SessionSanitizerRepairPlan,
  SessionSanitizerRepairTask,
  SessionSanitizerReport,
  SessionSanitizerSource
} from "./session-sanitizer.js";

export type LooDatabase = NodeDatabaseSync;
type DatabaseSyncConstructor = new (path: string, options?: { readOnly?: boolean }) => NodeDatabaseSync;

const require = createRequire(import.meta.url);
let cachedDatabaseSync: DatabaseSyncConstructor | null = null;

function getDatabaseSync(): DatabaseSyncConstructor {
  if (!cachedDatabaseSync) {
    cachedDatabaseSync = (require("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor }).DatabaseSync;
  }
  return cachedDatabaseSync;
}

export type IndexCodexOptions = {
  roots: string[];
  maxFiles?: number;
  maxBytesPerFile?: number;
  maxEventsPerFile?: number;
};

export type LimitedCodexFile = {
  path: string;
  reason: "max_bytes_per_file" | "max_events_per_file";
  limit: number;
  actual: number;
};

export type IndexCodexResult = {
  indexedFiles: number;
  skippedFiles: number;
  indexedThreads: number;
  indexedEvents: number;
  limitedFiles: LimitedCodexFile[];
  errors: Array<{ path: string; message: string }>;
};

export type SourceFileWatermark = {
  sourcePath: string;
  pathHash: string;
  size: number;
  mtimeMs: number;
  lastIndexedAt: string;
};

export type CodexSqliteProbe = {
  path: string;
  kind: "state" | "logs" | "unknown";
  supported: boolean;
  tables: string[];
  reason: string | null;
};

export type SessionSearchResult = {
  sourceKind: "codex_thread";
  sourceRef: string;
  threadId: string;
  title: string | null;
  summary: string | null;
  updatedAt: string | null;
  score: number;
  snippet: string;
};

export type SessionMetadata = {
  project: string | null;
  status: string | null;
  priority: string | null;
  owner: string | null;
  blocker: string | null;
  nextAction: string | null;
  closeoutState: string | null;
  planCompletionState: string | null;
  proposedPlanRefs: string[];
  finalMessageRefs: string[];
  touchedFileRefs: string[];
  sourceRefs: string[];
};

export type ClaudeSessionInventoryFixture = Record<string, unknown> & {
  sessionId?: string;
  title?: string | null;
  project?: string | null;
  workspaceHint?: string | null;
  status?: string | null;
  safeSummary?: string | null;
  updatedAt?: string | null;
  sourcePath?: string | null;
  sourceRefs?: string[];
};

export type ClaudeSessionInventoryRejected = {
  sessionId: string | null;
  reason: "missing_session_id" | "forbidden_fixture_field";
  field?: string;
};

export type IndexClaudeSessionInventoryResult = {
  indexedSessions: number;
  rejectedSessions: ClaudeSessionInventoryRejected[];
};

export type ClaudeSessionInventoryDescription = {
  sourceKind: "claude_session";
  sourceRef: string;
  sessionId: string;
  title: string | null;
  project: string | null;
  workspaceHint: string | null;
  status: string | null;
  summary: string | null;
  updatedAt: string | null;
  sourcePath: string;
  sourceRefs: string[];
};

export type PublicCommentHygieneStatus = "pass" | "warning" | "blocked";

export type PublicCommentHygieneCode =
  | "absolute_path_prefix_repeated"
  | "path_fragment_repeated"
  | "path_token_density_high"
  | "public_reference_missing"
  | "human_summary_too_short";

export type PublicCommentHygieneFinding = {
  code: PublicCommentHygieneCode;
  severity: "blocker" | "warning";
  count: number;
  threshold: number;
  detail: string;
  sample: string | null;
  publicSafe: true;
};

export type PublicCommentHygieneReport = {
  schema: "lco.publicCommentHygiene.v1";
  ok: boolean;
  status: PublicCommentHygieneStatus;
  publicSafe: true;
  generatedAt: string;
  bodyHash: string;
  summary: string;
  blockers: PublicCommentHygieneCode[];
  warnings: PublicCommentHygieneCode[];
  findings: PublicCommentHygieneFinding[];
  redactedPreview: string;
  metrics: {
    characters: number;
    words: number;
    absolutePathPrefixCount: number;
    pathTokenCount: number;
    pathTokenDensity: number;
  };
  actionsPerformed: {
    githubWrite: false;
    liveControl: false;
    guiMutation: false;
    rawTranscriptRead: false;
    npmPublish: false;
    githubRelease: false;
  };
  proofBoundary: string;
};

export type PublicCommentHygieneOptions = {
  now?: string;
  maxAbsolutePathPrefixRepeats?: number;
  maxRepeatedPathFragmentCount?: number;
  maxPathTokenDensity?: number;
  minHumanReadableWords?: number;
  requireIssueOrPrRef?: boolean;
  maxPreviewChars?: number;
};

export type CloseoutEnvelopeState = "ready" | "partial" | "unavailable";

export type CloseoutEnvelopeCandidate = {
  threadId: string;
  sourceRef: string;
  title: string | null;
  updatedAt: string | null;
  state: CloseoutEnvelopeState;
  wouldAttach: boolean;
  metadata: SessionMetadata;
  missingFields: string[];
  warnings: string[];
  closeoutEnvelopeCount: number;
  publicCommentHygiene: PublicCommentHygieneReport | null;
  publicSafe: true;
};

export type CloseoutEnvelopeReport = {
  dryRun: true;
  mutatesCodex: false;
  hookAgentReady: false;
  approvalRequiredForHookExecution: true;
  candidates: CloseoutEnvelopeCandidate[];
  summary: {
    total: number;
    ready: number;
    partial: number;
    unavailable: number;
  };
};

export type CloseoutEnvelopeReportOptions = {
  threadId?: string;
  limit?: number;
  includeUnavailable?: boolean;
};

export type CodexThreadMapOptions = {
  limit?: number;
  project?: string;
  status?: string;
  priority?: string;
  blocker?: string;
  priorityOrder?: string[];
};

const COLLABORATION_COCKPIT_INTERNAL_CARD_LIMIT = 5000;

export type SessionManagementAction = "expand" | "archive" | "fork" | "resume";

export type SessionManagementEntry = {
  threadId: string;
  sourceRef: string;
  title: string | null;
  updatedAt: string | null;
  status: string | null;
  priority: string | null;
  nextAction: string | null;
  reason: string;
  metadata: SessionMetadata;
};

export type SessionManagementRecommendation = SessionManagementEntry & {
  action: SessionManagementAction;
  targetTool: string | null;
  requiresDryRun: boolean;
  requiresApproval: boolean;
  approvalAuditIdRequired: boolean;
};

export type CodexSessionManagementMap = {
  publicSafe: true;
  dryRun: true;
  mutatesCodex: false;
  liveControlRequires: ["dry_run", "approval_audit_id"];
  summary: {
    total: number;
    active: number;
    blocked: number;
    needsExpansion: number;
    safeToArchive: number;
    shouldFork: number;
    shouldResume: number;
  };
  groups: {
    activeWork: SessionManagementEntry[];
    blockedWork: SessionManagementEntry[];
    needsExpansion: SessionManagementEntry[];
    safeToArchive: SessionManagementEntry[];
    shouldFork: SessionManagementEntry[];
    shouldResume: SessionManagementEntry[];
  };
  recommendations: SessionManagementRecommendation[];
};

export type OperatingState = "green" | "yellow" | "red" | "unknown";
export type OperatingUrgency = "low" | "medium" | "high" | "critical";

export type EvidenceCard = {
  schema: "lco.evidenceCard.v1";
  evidenceId: string;
  claim: string;
  sourceKind: "github_check_summary" | "safe_event" | "desktop_title" | "watcher_log" | "plan" | "final_message" | "session_metadata" | "plan_state";
  sourceRef: string;
  observedAt: string | null;
  excerpt: string;
  redactions: string[];
  confidence: number;
};

export type CodexSessionCardState = "running" | "waiting" | "needs_approval" | "blocked" | "done" | "unknown";

export type CodexSessionCard = {
  schema: "lco.codex.sessionCard.v1";
  sessionId: string;
  threadId: string;
  title: string;
  state: CodexSessionCardState;
  objective: string;
  freshness: {
    lastEventAt: string | null;
    ageSeconds: number | null;
    stale: boolean;
  };
  scope: {
    repo: string | null;
    branch: string | null;
    gitSha: string | null;
    refs: string[];
  };
  risk: {
    level: "low" | "medium" | "high";
    reasons: string[];
  };
  nextAction: {
    kind: "watch" | "resume" | "approve" | "ignore" | "inspect";
    confidence: number;
    reason: string;
    requiresApproval?: boolean;
  };
  counts: {
    plans: number;
    finalMessages: number;
    toolCalls: number;
    touchedFiles: number;
    evidence: number;
  };
  evidenceIds: string[];
  hidden: {
    transcriptPath: true;
    rawTranscript: true;
    secrets: true;
  };
  confidence: number;
  reasonCodes: string[];
};

export type RecentSessionsReport = {
  schema: "lco.codex.recentSessions.v1";
  publicSafe: true;
  queryRequired: false;
  scope: "active" | "recent" | "all";
  generatedAt: string;
  summary: {
    total: number;
    returned: number;
    stale: number;
    lowConfidence: number;
  };
  cards: CodexSessionCard[];
  evidence: EvidenceCard[];
};

export type CockpitInboxItem = {
  card: CodexSessionCard;
  reasonCodes: string[];
  urgencyScore: number;
  nextAction: CodexSessionCard["nextAction"];
};

export type CockpitInboxReport = {
  schema: "lco.codex.cockpitInbox.v1";
  publicSafe: true;
  generatedAt: string;
  summary: {
    totalCards: number;
    returned: number;
    critical: number;
    high: number;
    lowConfidence: number;
  };
  items: CockpitInboxItem[];
  omitted: {
    count: number;
    reason: "limit" | "none";
  };
};

export type CodexCollaborationDesktopState = "desktop_visible" | "fallback_ready" | "fallback_blocked" | "cli_visible" | "unknown" | "not_configured";

export type CodexCollaborationCockpitLane = {
  threadId: string;
  title: string;
  sessionState: CodexSessionCardState;
  attention: {
    level: OperatingUrgency;
    urgencyScore: number;
  };
  reasonCodes: string[];
  nextAction: CodexSessionCard["nextAction"];
  desktop: {
    state: CodexCollaborationDesktopState;
    requiresFallback: boolean;
    preferredBackend: "cua-driver" | null;
    confidence: number;
    sourceCoverage: {
      desktopCoherence: VisibleCodexCoverageState;
      desktopFallback: VisibleCodexCoverageState;
    };
    evidenceIds: string[];
    blockers: string[];
    reasonCodes: string[];
  };
  card: CodexSessionCard;
};

export type CodexCollaborationCockpitReport = {
  schema: "lco.codex.collaborationCockpit.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  summary: {
    totalCards: number;
    returned: number;
    running: number;
    waiting: number;
    needsApproval: number;
    blocked: number;
    desktopVisible: number;
    fallbackRequired: number;
    highAttention: number;
    lowConfidence: number;
  };
  sourceCoverage: {
    recentSessions: VisibleCodexCoverageState;
    cockpitInbox: VisibleCodexCoverageState;
    desktopCoherence: VisibleCodexCoverageState;
    desktopFallback: VisibleCodexCoverageState;
  };
  lanes: CodexCollaborationCockpitLane[];
  omitted: {
    count: number;
    reason: "limit" | "none";
  };
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
    screenshotCaptured: false;
    npmPublished: false;
    githubReleaseCreated: false;
  };
  proofBoundary: string;
};

export type CodexCollaborationCockpitOptions = {
  limit?: number;
  priorityOrder?: string[];
  watcherSpecs?: WatchSpec[];
  desktopCoherenceReports?: unknown[];
  desktopFallbackReports?: unknown[];
  now?: string;
};

export type CodexCollaborationNextStepCategory =
  | "watcher_resume_packet"
  | "approval_boundary"
  | "desktop_coherence"
  | "desktop_fallback_status"
  | "desktop_action_approval"
  | "observe";

export type CodexCollaborationNextStepStatus = "ready" | "blocked" | "noop";

export type CodexCollaborationNextStepToolCall = {
  tool: "loo_resume_request_packet" | "loo_codex_desktop_coherence" | "loo_codex_desktop_fallback_status";
  args: Record<string, unknown>;
  execute: false;
};

export type CodexCollaborationNextStep = {
  stepId: string;
  threadId: string;
  title: string;
  category: CodexCollaborationNextStepCategory;
  status: CodexCollaborationNextStepStatus;
  attention: CodexCollaborationCockpitLane["attention"];
  sessionState: CodexSessionCardState;
  desktopState: CodexCollaborationDesktopState;
  reasonCodes: string[];
  blockers: string[];
  evidenceIds: string[];
  confidence: number;
  toolCall: CodexCollaborationNextStepToolCall | null;
  approvalBoundary: string;
};

export type CodexCollaborationNextStepsReport = {
  schema: "lco.codex.collaborationNextSteps.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  summary: {
    totalLanes: number;
    returned: number;
    ready: number;
    blocked: number;
    noop: number;
  };
  sourceCoverage: CodexCollaborationCockpitReport["sourceCoverage"];
  steps: CodexCollaborationNextStep[];
  omitted: CodexCollaborationCockpitReport["omitted"];
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
    screenshotCaptured: false;
    npmPublished: false;
    githubReleaseCreated: false;
  };
  proofBoundary: string;
};

export type CodexCollaborationNextStepsOptions = CodexCollaborationCockpitOptions;

export type CodexRuntimeDesktopVisibilityCoverage = "covered" | "partial" | "blocked";

export type CodexRuntimeDesktopVisibilityToolCall = {
  tool:
    | "loo_codex_desktop_coherence"
    | "loo_codex_desktop_fallback_status"
    | "loo_codex_desktop_collaboration_proof"
    | "loo_desktop_live_proof_harness";
  args: Record<string, unknown>;
  execute: false;
};

export type CodexRuntimeDesktopVisibilityLane = {
  threadId: string;
  title: string;
  coverage: CodexRuntimeDesktopVisibilityCoverage;
  desktopState: CodexCollaborationDesktopState;
  confidence: number;
  blockers: string[];
  reasonCodes: string[];
  evidenceIds: string[];
  nextToolCall: CodexRuntimeDesktopVisibilityToolCall | null;
};

export type CodexRuntimeDesktopVisibilityStatusReport = {
  schema: "lco.codex.runtimeDesktopVisibilityStatus.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  status: CodexRuntimeDesktopVisibilityCoverage;
  confidence: number;
  summary: {
    totalLanes: number;
    returned: number;
    covered: number;
    partial: number;
    blocked: number;
    nextReadOnlyActions: number;
  };
  sourceCoverage: {
    collaborationCockpit: VisibleCodexCoverageState;
    desktopCoherence: VisibleCodexCoverageState;
    desktopFallback: VisibleCodexCoverageState;
    desktopCollaborationProof: VisibleCodexCoverageState;
  };
  lanes: CodexRuntimeDesktopVisibilityLane[];
  omitted: CodexCollaborationCockpitReport["omitted"];
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
    screenshotCaptured: false;
    npmPublished: false;
    githubReleaseCreated: false;
  };
  proofBoundary: string;
};

export type CodexRuntimeDesktopVisibilityStatusOptions = CodexCollaborationCockpitOptions & {
  desktopCollaborationProofReports?: unknown[];
};

export type WatcherKind = "thread_finished" | "final_message_appeared" | "pr_checks_changed" | "review_comment_arrived" | "no_activity" | "approval_expired";
export type WatcherStatus = "active" | "triggered" | "stale" | "expired" | "low_confidence";
export type WatcherRecommendedAction = "inspect" | "resume" | "approve" | "ignore";

export type WatchSpec = {
  schema: "lco.watchSpec.v1";
  watchId: string;
  targetRef: string;
  kind: WatcherKind;
  createdAt: string;
  lastObservedAt: string | null;
  ttlSeconds: number;
  staleAfterSeconds?: number;
  stopConditions: string[];
  wakeReason?: WatcherKind;
  evidenceIds?: string[];
  confidence?: number;
  mutates?: false;
  observed?: {
    threadStatus?: string;
    finalMessageCount?: number;
    prChecksChanged?: boolean;
    reviewCommentCount?: number;
    approvalExpiresAt?: string | null;
    noActivitySeconds?: number;
  };
};

export type WatcherState = {
  schema: "lco.watcherState.v1";
  watchId: string;
  targetRef: string;
  kind: WatcherKind;
  status: WatcherStatus;
  wakeReason: WatcherKind | null;
  recommendedAction: WatcherRecommendedAction;
  requiresApproval: true;
  mutates: false;
  stale: boolean;
  expired: boolean;
  expiresAt: string | null;
  lastObservedAt: string | null;
  stopConditions: string[];
  reasonCodes: string[];
  confidence: number;
  evidenceIds: string[];
  approvalBoundary: string;
};

export type WatcherStatusReport = {
  schema: "lco.watchers.status.v1";
  publicSafe: true;
  generatedAt: string;
  summary: {
    total: number;
    returned: number;
    active: number;
    triggered: number;
    stale: number;
    expired: number;
    lowConfidence: number;
  };
  watchers: WatcherState[];
  omitted: {
    count: number;
    reason: "limit" | "none";
  };
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    externalWrite: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type ResumeRequestPacket = {
  schema: "lco.resumeRequestPacket.v1";
  publicSafe: true;
  packetId: string;
  targetRef: string;
  reason: "watcher_triggered" | "manual_request";
  recommendedAction: WatcherRecommendedAction;
  requiresApproval: true;
  mutates: false;
  approvalBoundary: string;
  evidenceIds: string[];
  reasonCodes: string[];
  expiresAt: string;
};

export type VisibleCodexCoverageState = "ok" | "partial" | "unavailable" | "not_configured";

export type VisibleCodexThreadCandidateInput = {
  visibleId?: string;
  title?: string | null;
  rawTitle?: string | null;
  status?: string | null;
  updatedLabel?: string | null;
  titleHash?: string | null;
  confidence?: "low" | "medium" | "high" | number | null;
  source?: string | null;
};

export type VisibleCodexInput = {
  threadMap?: {
    threads?: VisibleCodexThreadCandidateInput[];
  };
};

export type AppServerThreadSignalInput = {
  appServerRef?: string;
  threadId?: string;
  titleSanitized?: string | null;
  titleHash?: string | null;
  status?: string | null;
  loaded?: boolean | null;
  loadedState?: "loaded" | "not_loaded" | "not_claimed";
  updatedAt?: string | null;
  sourceRef?: string;
  confidence?: number | null;
};

export type AppServerThreadsInput = {
  schema?: string;
  publicSafe?: boolean;
  generatedAt?: string;
  sourceCoverage?: {
    codexAppServer?: VisibleCodexCoverageState;
  };
  threads?: AppServerThreadSignalInput[];
  loadedThreadRefs?: string[] | null;
  errors?: string[];
};

export type VisibleCodexSessionMapItem = {
  desktopRef: string | null;
  appServerRef: string | null;
  sourceRef: string | null;
  titleSanitized: string;
  sessionCardRef: string | null;
  confidence: number;
  evidenceIds: string[];
  ambiguity: string[];
  freshness: {
    indexedUpdatedAt: string | null;
    appServerUpdatedAt: string | null;
    visibleUpdatedLabel: string | null;
    freshestSource: "indexed_lco" | "codex_app_server" | "visible_codex" | "unknown";
  };
  reasonCodes: string[];
};

export type VisibleCodexSessionMapReport = {
  schema: "lco.visibleCodexSessionMap.v1";
  publicSafe: true;
  generatedAt: string;
  items: VisibleCodexSessionMapItem[];
  sourceCoverage: {
    indexedLco: VisibleCodexCoverageState;
    visibleCodex: VisibleCodexCoverageState;
    codexAppServer: VisibleCodexCoverageState;
  };
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type CodexDesktopCoherenceState = "cli_visible" | "desktop_visible" | "desktop_refresh_required" | "desktop_restart_required" | "unknown";

export type CodexDesktopCoherenceVisibility = "proven" | "not_seen" | "refresh_required" | "restart_required" | "ambiguous" | "unknown";

export type CodexDesktopCoherenceActionEvidence = {
  actionKind: "none" | "cli" | "direct_protocol" | "codex_app_server" | "lco_control" | "unknown";
  action: string | null;
  dryRun: boolean | null;
  live: boolean | null;
  approvalAuditIdPresent: boolean;
  evidenceId: string | null;
  observedAt: string | null;
};

export type CodexDesktopCoherenceObservation = {
  mapPresent: boolean;
  matchedItemCount: number;
  cliVisible: boolean;
  desktopVisible: boolean;
  ambiguous: boolean;
  confidence: number;
  evidenceIds: string[];
  sourceRefs: string[];
  appServerRefs: string[];
  desktopRefs: string[];
  reasonCodes: string[];
  sourceCoverage: VisibleCodexSessionMapReport["sourceCoverage"];
};

export type CodexDesktopCoherenceReport = {
  schema: "lco.codexDesktopCoherence.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  target: {
    threadId: string | null;
    sourceRef: string | null;
  };
  state: CodexDesktopCoherenceState;
  visibility: {
    cli: CodexDesktopCoherenceVisibility;
    desktop: CodexDesktopCoherenceVisibility;
  };
  confidence: number;
  observations: {
    before: CodexDesktopCoherenceObservation | null;
    current: CodexDesktopCoherenceObservation | null;
    after: CodexDesktopCoherenceObservation | null;
  };
  refreshKind: "none" | "desktop_refresh" | "desktop_restart";
  actionEvidence: CodexDesktopCoherenceActionEvidence;
  evidenceIds: string[];
  blockers: string[];
  reasonCodes: string[];
  sourceCoverage: {
    indexedLco: VisibleCodexCoverageState;
    visibleCodex: VisibleCodexCoverageState;
    codexAppServer: VisibleCodexCoverageState;
  };
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
  nextAction: string;
};

export type CodexDesktopCoherenceReportOptions = {
  threadId?: string | null;
  sourceRef?: string | null;
  visibleMap?: VisibleCodexSessionMapReport | null;
  beforeMap?: VisibleCodexSessionMapReport | null;
  afterMap?: VisibleCodexSessionMapReport | null;
  refreshKind?: "none" | "desktop_refresh" | "desktop_restart";
  actionEvidence?: Record<string, unknown> | null;
  now?: string;
};

export type PlanStateManualPin = {
  pinId: string;
  title: string;
  state: OperatingState;
  summary: string;
  nextAction: string;
  sourceRef: string;
};

export type PlanStatePinsReport = {
  schema: "lco.planStatePins.v1";
  publicSafe: true;
  bootloaderOnly: true;
  manualPins: PlanStateManualPin[];
  approvalBoundaries: string[];
  exceptionLedger: string[];
  ignoredStaleProse: true;
};

export type OperatingSignal = {
  schema: "lco.operatingSignal.v1";
  signalId: string;
  sourceKind: "codex" | "github" | "notion" | "support_control" | "company_brain" | "stripe" | "plan_state";
  sourceRef: string;
  observedAt: string | null;
  subject: {
    kind: "project" | "customer" | "repo" | "pr" | "issue" | "codex_session" | "billing" | "support";
    id: string;
    title: string;
  };
  state: OperatingState;
  urgency: OperatingUrgency;
  reasonCodes: string[];
  summary: string;
  nextAction: {
    kind: "inspect" | "watch" | "resume" | "approve" | "delegate" | "ignore";
    text: string;
    requiresApproval: boolean;
  };
  confidence: number;
  evidenceIds: string[];
};

export type OperatingCard = {
  schema: "lco.operatingCard.v1";
  cardId: string;
  kind: "project" | "customer" | "repo" | "business" | "incident";
  title: string;
  state: OperatingState;
  lastMovementAt: string | null;
  summary: string;
  nextAction: string;
  owner: string;
  confidence: number;
  signals: string[];
  evidenceIds: string[];
  reasonCodes: string[];
  approvalBoundary: string;
};

export type SourceCoverageState = "ok" | "partial" | "empty" | "not_configured" | "unavailable";
export type OperatingSourceKind = "lco" | "github" | "plan_state" | "notion" | "support_control" | "company_brain" | "stripe";
export type SourceAuthorityKind = "authoritative" | "cache_only" | "fallback_only";
export type SourceAuthorityFallbackBehavior = "unknown" | "low_confidence" | "use_cached_with_warning";

export type SourceAuthoritySource = {
  sourceKind: OperatingSourceKind;
  setupStatus: SourceCoverageState;
  status: SourceCoverageState;
  authority: SourceAuthorityKind;
  owns: string[];
  allowedClaims: string[];
  fallbackBehavior: SourceAuthorityFallbackBehavior;
  freshnessTtlSeconds: number;
};

export type SourceAuthorityProfile = {
  schema: "lco.sourceAuthorityProfile.v1";
  publicSafe: true;
  sources: Record<OperatingSourceKind, SourceAuthoritySource>;
};

export type SourceAuthorityProfileOverrides = Partial<Record<OperatingSourceKind, Partial<Omit<SourceAuthoritySource, "sourceKind" | "status">>>>;

export type OperatingDigest = {
  schema: "lco.operatingDigest.v1";
  publicSafe: true;
  generatedAt: string;
  window: "today" | "24h" | "7d" | "custom";
  health: {
    overall: OperatingState;
    customers: { red: number; yellow: number; green: number; unknown: number };
    projects: { blocked: number; moving: number; stale: number };
    codex: { needsAttention: number; waiting: number; done: number };
    finance: { state: OperatingState; reason: string };
  };
  topAttention: string[];
  cards: OperatingCard[];
  signals: OperatingSignal[];
  evidence: EvidenceCard[];
  omitted: {
    count: number;
    reason: "token_budget" | "limit" | "none";
  };
  sourceCoverage: {
    lco: SourceCoverageState;
    github: SourceCoverageState;
    plan_state: SourceCoverageState;
    notion: SourceCoverageState;
    support_control: SourceCoverageState;
    company_brain: SourceCoverageState;
    stripe: SourceCoverageState;
  };
  authorityCoverage: Record<OperatingSourceKind, SourceAuthoritySource>;
};

export type GithubOperatingItem = {
  id: string;
  title: string;
  kind?: "repo" | "issue" | "pr";
  state?: OperatingState;
  urgency?: OperatingUrgency;
  reasonCodes?: string[];
  updatedAt?: string | null;
  nextAction?: string;
  confidence?: number;
};

export type GithubOperatingItemsReport = {
  schema: "lco.githubOperatingItems.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  items: GithubOperatingItem[];
  rejected: Array<{
    index: number;
    reason: "missing_id" | "missing_title" | "invalid_record";
  }>;
  omitted: {
    count: number;
    reasons: string[];
  };
  sourceCoverage: {
    github: SourceCoverageState;
  };
  actionsPerformed: {
    githubWriteRun: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type OperatingDigestOptions = {
  window?: OperatingDigest["window"];
  limit?: number;
  planStatePins?: PlanStatePinsReport;
  githubItems?: GithubOperatingItem[];
  sourceAuthorityProfile?: SourceAuthorityProfile;
  now?: string;
};

export type BusinessPulseReport = {
  schema: "lco.businessPulse.v1";
  publicSafe: true;
  question: "How is the business?";
  digest: OperatingDigest;
  sourceCoverage: OperatingDigest["sourceCoverage"];
  authorityCoverage: OperatingDigest["authorityCoverage"];
  proofBoundary: string;
};

const OPERATING_SOURCE_KINDS: OperatingSourceKind[] = [
  "lco",
  "github",
  "plan_state",
  "notion",
  "support_control",
  "company_brain",
  "stripe"
];

export function createDefaultSourceAuthorityProfile(overrides: SourceAuthorityProfileOverrides = {}): SourceAuthorityProfile {
  const base: Record<OperatingSourceKind, SourceAuthoritySource> = {
    lco: {
      sourceKind: "lco",
      setupStatus: "ok",
      status: "ok",
      authority: "authoritative",
      owns: ["codex_session_state", "session_cards", "safe_summaries", "plans", "final_messages", "touched_files"],
      allowedClaims: ["codex_session", "session_card", "safe_summary", "plan", "final_message", "touched_file"],
      fallbackBehavior: "unknown",
      freshnessTtlSeconds: 900
    },
    github: {
      sourceKind: "github",
      setupStatus: "ok",
      status: "ok",
      authority: "authoritative",
      owns: ["pr_status", "ci_status", "review_state", "issue_state"],
      allowedClaims: ["repo", "branch", "pr", "issue", "checks", "reviews"],
      fallbackBehavior: "unknown",
      freshnessTtlSeconds: 600
    },
    plan_state: {
      sourceKind: "plan_state",
      setupStatus: "ok",
      status: "ok",
      authority: "fallback_only",
      owns: ["manual_pin", "approval_boundary", "stop_condition", "exception_ledger"],
      allowedClaims: ["manual_pin", "approval_boundary", "stop_condition", "exception_ledger"],
      fallbackBehavior: "low_confidence",
      freshnessTtlSeconds: 86400
    },
    notion: p1AuthoritySource("notion"),
    support_control: p1AuthoritySource("support_control"),
    company_brain: p1AuthoritySource("company_brain"),
    stripe: p1AuthoritySource("stripe")
  };
  const sources = Object.fromEntries(OPERATING_SOURCE_KINDS.map((sourceKind) => {
    const override = overrides[sourceKind] ?? {};
    const merged: SourceAuthoritySource = {
      ...base[sourceKind],
      ...override,
      sourceKind,
      status: base[sourceKind].status,
      owns: safeAuthorityList(override.owns ?? base[sourceKind].owns),
      allowedClaims: safeAuthorityList(override.allowedClaims ?? base[sourceKind].allowedClaims)
    };
    return [sourceKind, merged];
  })) as Record<OperatingSourceKind, SourceAuthoritySource>;
  return {
    schema: "lco.sourceAuthorityProfile.v1",
    publicSafe: true,
    sources
  };
}

function p1AuthoritySource(sourceKind: OperatingSourceKind): SourceAuthoritySource {
  return {
    sourceKind,
    setupStatus: "not_configured",
    status: "not_configured",
    authority: "cache_only",
    owns: [],
    allowedClaims: [],
    fallbackBehavior: "unknown",
    freshnessTtlSeconds: 0
  };
}

function safeAuthorityList(values: string[]): string[] {
  return unique(values.map((value) => publicSafeText(value, 80)).filter(Boolean)).slice(0, 20);
}

export type ApprovalPacket = {
  schema: "lco.approvalPacket.v1";
  packetId: string;
  action: "resume_session" | "send_message" | "steer_thread" | "interrupt_thread";
  target: {
    sessionId: string;
    title: string;
  };
  intent: string;
  predictedMutation: string[];
  preconditions: string[];
  risk: {
    level: "low" | "medium" | "high";
    requiresHuman: true;
    reasons: string[];
  };
  rollback: {
    available: false;
    reason: string;
  };
  approvalBoundary: string;
  expiresAt: string;
  hashes: {
    messageHash?: string;
    paramsHash: string;
  };
};

type SessionManagementLane = keyof CodexSessionManagementMap["groups"];

export type SessionDescription = {
  sourceKind: "codex_thread";
  sourceRef: string;
  threadId: string;
  title: string | null;
  cwd: string | null;
  model: string | null;
  branch: string | null;
  gitSha: string | null;
  summary: string | null;
  finalMessage: string | null;
  planCount: number;
  touchedFiles: string[];
  toolCallCount: number;
  sourcePath: string;
  metadata: SessionMetadata;
};

export type CodexToolCall = {
  threadId: string;
  callId: string;
  toolName: string;
  argumentsText: string;
};

export type IndexedSessionSanitizerOptions = {
  threadId?: string;
  limit?: number;
  now?: string;
  auditKey?: string;
};

export type IndexedSessionSanitizerReport = SessionSanitizerReport & {
  dryRun: true;
  mutatesCodex: false;
  source: "indexed-safe-text";
  sourceLimit: number;
  scannedRefs: string[];
};

export type IndexedSessionSanitizerRepairPlan = SessionSanitizerRepairPlan & {
  source: "indexed-safe-text";
  sourceLimit: number;
  scannedRefs: string[];
};

export type ExpandSessionOptions = {
  threadId: string;
  tokenBudget?: number;
  profile?: RecallProfileName;
};

export type RecallProfileName = "metadata" | "brief" | "evidence";

export type RecallProfile = {
  name: RecallProfileName;
  tokenBudget: number;
  description: string;
};

const SESSION_METADATA_SCHEMA_VERSION = 4;

export type RecallSourceKind = "codex_thread" | "lcm_summary" | "claude_session";

export type RecallSearchResult = {
  sourceKind: RecallSourceKind;
  sourceRef: string;
  title: string | null;
  summary: string | null;
  updatedAt: string | null;
  score: number;
  snippet: string;
  threadId?: string;
  sessionId?: string;
  summaryId?: string;
  conversationId?: number;
  sourcePath?: string;
};

export type RecallDescription = {
  sourceKind: RecallSourceKind;
  sourceRef: string;
  title: string | null;
  summary: string | null;
  updatedAt: string | null;
  sourcePath: string;
  threadId?: string;
  sessionId?: string;
  summaryId?: string;
  conversationId?: number;
  project?: string | null;
  workspaceHint?: string | null;
  status?: string | null;
  kind?: string | null;
  depth?: number | null;
  tokenCount?: number | null;
  model?: string | null;
  cwd?: string | null;
  branch?: string | null;
  gitSha?: string | null;
  finalMessage?: string | null;
  planCount?: number;
  touchedFiles?: string[];
  toolCallCount?: number;
  metadata?: SessionMetadata;
};

export type ExpandRecallResult = {
  sourceKind: RecallSourceKind;
  sourceRef: string;
  text: string;
  tokenBudget: number;
  profile: RecallProfile;
  threadId?: string;
  sessionId?: string;
  summaryId?: string;
  query?: string;
  matches?: RecallSearchResult[];
};

export type RetrievalEvalScenario = {
  id: string;
  query: string;
  expectedSourceRefs: string[];
  expansionQueries?: string[];
  limit?: number;
};

export type RetrievalEvalStageResult = {
  hitAtK: boolean;
  firstExpectedRank: number | null;
  reciprocalRank: number;
  topRefs: string[];
};

export type RetrievalEvalScenarioResult = {
  id: string;
  query: string;
  expectedSourceRefs: string[];
  limit: number;
  baseline: RetrievalEvalStageResult;
  hybrid: RetrievalEvalStageResult & {
    expansionQueries: string[];
    reranker: "query-expansion-term-overlap";
  };
};

export type RetrievalEvalReport = {
  ok: boolean;
  publicSafe: true;
  generatedAt: string;
  strategy: "hybrid-expansion-rerank";
  vector: {
    enabled: false;
    reason: string;
  };
  metrics: {
    scenarioCount: number;
    baselineHitRate: number;
    hybridHitRate: number;
    baselineMrr: number;
    hybridMrr: number;
  };
  scenarios: RetrievalEvalScenarioResult[];
  blockers: string[];
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

export type LcmPeerProbe = {
  path: string;
  readable: boolean;
  readOnly: boolean;
  queryOnly: boolean;
  supported: boolean;
  tables: string[];
  summaryCount: number | null;
  ftsAvailable: boolean;
  reason: string | null;
};

type LcmSummaryRecord = {
  summaryId: string;
  conversationId: number;
  conversationTitle: string | null;
  kind: string | null;
  depth: number | null;
  content: string;
  tokenCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  model: string | null;
  sourcePath: string;
};

type ImportedSession = {
  threadId: string;
  title: string | null;
  cwd: string | null;
  model: string | null;
  branch: string | null;
  gitSha: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  finalMessage: string | null;
  plans: string[];
  touchedFiles: string[];
  toolCalls: Array<{ callId: string; toolName: string; argumentsText: string }>;
  metadata: SessionMetadata;
  closeoutEnvelopeText: string | null;
  closeoutEnvelopeOpenCount: number;
  closeoutEnvelopeCloseCount: number;
  safeText: string;
  eventCount: number;
};

const DEFAULT_CODEX_MAX_BYTES_PER_FILE = 50 * 1024 * 1024;
const DEFAULT_CODEX_MAX_EVENTS_PER_FILE = 50_000;

export function createDatabase(dbPath?: string): LooDatabase {
  const resolved = dbPath ?? defaultDatabasePath();
  mkdirSync(dirname(resolved), { recursive: true });
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(resolved);
  migrate(db);
  return db;
}

export function defaultDatabasePath(): string {
  return process.env.LOO_DB_PATH?.trim() || join(process.env.HOME || ".", ".openclaw", "lossless-openclaw-orchestrator", "orchestrator.sqlite");
}

export function defaultCodexRoots(home = process.env.HOME || "."): string[] {
  return [
    join(home, ".codex", "sessions"),
    join(home, ".codex", "archived_sessions")
  ];
}

export function configuredLcmPeerDbPaths(raw = process.env.LOO_LCM_DB_PATHS ?? ""): string[] {
  return unique(normalizePeerPaths(raw.split(new RegExp(`[${escapeRegExp(delimiter)},\\n]`, "g")).map((part) => part.trim()).filter(Boolean)));
}

export function migrate(db: LooDatabase): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS codex_sessions (
      thread_id TEXT PRIMARY KEY,
      title TEXT,
      cwd TEXT,
      model TEXT,
      branch TEXT,
      git_sha TEXT,
      source_path TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      summary TEXT,
      final_message TEXT,
      safe_text TEXT NOT NULL DEFAULT '',
      event_count INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS codex_sessions_source_path_idx ON codex_sessions(source_path);

    CREATE TABLE IF NOT EXISTS codex_source_files (
      source_path TEXT PRIMARY KEY,
      path_hash TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      last_indexed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS codex_plans (
      plan_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES codex_sessions(thread_id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      ordinal INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS codex_touched_files (
      touched_file_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES codex_sessions(thread_id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      UNIQUE(thread_id, path, source_kind)
    );

    CREATE TABLE IF NOT EXISTS codex_tool_calls (
      call_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES codex_sessions(thread_id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      arguments_text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS codex_session_metadata (
      thread_id TEXT PRIMARY KEY REFERENCES codex_sessions(thread_id) ON DELETE CASCADE,
      project TEXT,
      status TEXT,
      priority TEXT,
      owner TEXT,
      blocker TEXT,
      next_action TEXT,
      closeout_state TEXT,
      plan_completion_state TEXT,
      proposed_plan_refs_json TEXT NOT NULL DEFAULT '[]',
      final_message_refs_json TEXT NOT NULL DEFAULT '[]',
      touched_file_refs_json TEXT NOT NULL DEFAULT '[]',
      metadata_schema_version INTEGER NOT NULL DEFAULT 0,
      closeout_envelope_text TEXT,
      closeout_envelope_open_count INTEGER NOT NULL DEFAULT 0,
      closeout_envelope_close_count INTEGER NOT NULL DEFAULT 0,
      source_refs_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS codex_safe_text_fts USING fts5(
      thread_id UNINDEXED,
      content,
      tokenize = 'unicode61'
    );

    CREATE TABLE IF NOT EXISTS claude_sessions (
      session_id TEXT PRIMARY KEY,
      title TEXT,
      project TEXT,
      workspace_hint TEXT,
      status TEXT,
      source_path TEXT NOT NULL,
      updated_at TEXT,
      safe_summary TEXT,
      safe_text TEXT NOT NULL DEFAULT '',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      indexed_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS claude_safe_text_fts USING fts5(
      session_id UNINDEXED,
      content,
      tokenize = 'unicode61'
    );
  `);
  ensureColumn(db, "codex_session_metadata", "proposed_plan_refs_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "codex_session_metadata", "final_message_refs_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "codex_session_metadata", "touched_file_refs_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "codex_session_metadata", "metadata_schema_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "codex_session_metadata", "plan_completion_state", "TEXT");
  ensureColumn(db, "codex_session_metadata", "closeout_envelope_text", "TEXT");
  ensureColumn(db, "codex_session_metadata", "closeout_envelope_open_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "codex_session_metadata", "closeout_envelope_close_count", "INTEGER NOT NULL DEFAULT 0");
}

function ensureColumn(db: LooDatabase, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((row) => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function indexCodexSessions(db: LooDatabase, options: IndexCodexOptions): IndexCodexResult {
  const files = collectJsonlFiles(options.roots, options.maxFiles ?? 10_000);
  const maxBytesPerFile = positiveLimit(options.maxBytesPerFile, DEFAULT_CODEX_MAX_BYTES_PER_FILE, "maxBytesPerFile");
  const maxEventsPerFile = positiveLimit(options.maxEventsPerFile, DEFAULT_CODEX_MAX_EVENTS_PER_FILE, "maxEventsPerFile");
  const result: IndexCodexResult = { indexedFiles: 0, skippedFiles: 0, indexedThreads: 0, indexedEvents: 0, limitedFiles: [], errors: [] };
  const seenThreads = new Set<string>();

  for (const path of files) {
    try {
      const stat = statSync(path);
      if (stat.size > maxBytesPerFile) {
        recordLimitedFile(db, result, path, "max_bytes_per_file", maxBytesPerFile, stat.size);
        continue;
      }
      const watermark = getSourceFileWatermark(db, path);
      const mtimeMs = Math.trunc(stat.mtimeMs);
      const text = readFileSync(path, "utf8");
      const eventCount = countJsonlEvents(text);
      if (eventCount > maxEventsPerFile) {
        recordLimitedFile(db, result, path, "max_events_per_file", maxEventsPerFile, eventCount);
        continue;
      }
      if (watermark && watermark.size === stat.size && watermark.mtimeMs === mtimeMs) {
        if (watermark.pathHash === stableId(text) && !sourceNeedsMetadataBackfill(db, path)) {
          result.skippedFiles += 1;
          continue;
        }
      }
      const session = parseCodexJsonl(path, text);
      upsertSession(db, path, text, session, { size: stat.size, mtimeMs });
      result.indexedFiles += 1;
      result.indexedEvents += session.eventCount;
      seenThreads.add(session.threadId);
    } catch (error) {
      result.errors.push({ path, message: error instanceof Error ? error.message : String(error) });
    }
  }

  result.indexedThreads = seenThreads.size;
  return result;
}

const CLAUDE_FORBIDDEN_FIXTURE_FIELDS = [
  "rawTranscript",
  "raw_transcript",
  "transcript",
  "rawPrompt",
  "raw_prompt",
  "prompt",
  "messages",
  "toolCalls",
  "tool_calls",
  "toolResults",
  "tool_results",
  "toolPayloads",
  "tool_payloads",
  "screenshot",
  "screenshots",
  "video",
  "cookies",
  "token",
  "tokens",
  "credentials",
  "apiKey"
] as const;

export function indexClaudeSessionInventory(
  db: LooDatabase,
  options: { sessions: ClaudeSessionInventoryFixture[]; now?: string }
): IndexClaudeSessionInventoryResult {
  const now = options.now ?? new Date().toISOString();
  const rejectedSessions: ClaudeSessionInventoryRejected[] = [];
  const rejectedSessionIds = new Set<string>();
  const accepted = options.sessions.flatMap((fixture) => {
    const rawSessionId = stringOrNull(fixture.sessionId);
    const sessionId = rawSessionId ? safeClaudeSessionId(rawSessionId) : null;
    if (!sessionId) {
      rejectedSessions.push({ sessionId: null, reason: "missing_session_id" });
      return [];
    }
    const forbiddenField = CLAUDE_FORBIDDEN_FIXTURE_FIELDS.find((field) => Object.prototype.hasOwnProperty.call(fixture, field));
    if (forbiddenField) {
      rejectedSessions.push({ sessionId, reason: "forbidden_fixture_field", field: forbiddenField });
      rejectedSessionIds.add(sessionId);
      return [];
    }
    const title = safeNullableFixtureString(fixture.title);
    const project = safeNullableFixtureString(fixture.project);
    const workspaceHint = safeNullableFixtureString(fixture.workspaceHint);
    const status = safeNullableFixtureString(fixture.status);
    const safeSummary = safeNullableFixtureString(fixture.safeSummary);
    const updatedAt = safeNullableFixtureString(fixture.updatedAt) ?? now;
    const sourcePath = safeNullableFixtureString(fixture.sourcePath) ?? `fixture:${sessionId}`;
    const sourceRefs = unique([
      claudeSessionRef(sessionId),
      ...(Array.isArray(fixture.sourceRefs) ? fixture.sourceRefs.flatMap((ref) => {
        const normalized = normalizeClaudeSessionRef(ref);
        return normalized ? [normalized] : [];
      }) : [])
    ]);
    const safeText = [
      title,
      project ? `Project: ${project}` : null,
      workspaceHint ? `Workspace: ${workspaceHint}` : null,
      status ? `Status: ${status}` : null,
      safeSummary,
      sourceRefs.join(" ")
    ].filter(Boolean).join("\n");
    return [{
      sessionId,
      title,
      project,
      workspaceHint,
      status,
      safeSummary,
      updatedAt,
      sourcePath,
      sourceRefs,
      safeText
    }];
  });

  db.exec("BEGIN");
  try {
    const deleteSession = db.prepare("DELETE FROM claude_sessions WHERE session_id = ?");
    const deleteFts = db.prepare("DELETE FROM claude_safe_text_fts WHERE session_id = ?");
    for (const sessionId of rejectedSessionIds) {
      deleteFts.run(sessionId);
      deleteSession.run(sessionId);
    }
    const upsert = db.prepare(`
      INSERT INTO claude_sessions (
        session_id, title, project, workspace_hint, status, source_path, updated_at,
        safe_summary, safe_text, source_refs_json, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        title = excluded.title,
        project = excluded.project,
        workspace_hint = excluded.workspace_hint,
        status = excluded.status,
        source_path = excluded.source_path,
        updated_at = excluded.updated_at,
        safe_summary = excluded.safe_summary,
        safe_text = excluded.safe_text,
        source_refs_json = excluded.source_refs_json,
        indexed_at = excluded.indexed_at
    `);
    const insertFts = db.prepare("INSERT INTO claude_safe_text_fts (session_id, content) VALUES (?, ?)");
    for (const session of accepted) {
      upsert.run(
        session.sessionId,
        session.title,
        session.project,
        session.workspaceHint,
        session.status,
        session.sourcePath,
        session.updatedAt,
        session.safeSummary,
        session.safeText,
        JSON.stringify(session.sourceRefs),
        now
      );
      deleteFts.run(session.sessionId);
      insertFts.run(session.sessionId, session.safeText);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { indexedSessions: accepted.length, rejectedSessions };
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`${name} requires a positive integer`);
  return limit;
}

function recordLimitedFile(db: LooDatabase, result: IndexCodexResult, path: string, reason: LimitedCodexFile["reason"], limit: number, actual: number): void {
  clearSourceFileIndex(db, path);
  result.skippedFiles += 1;
  result.limitedFiles.push({ path, reason, limit, actual });
}

function clearSourceFileIndex(db: LooDatabase, sourcePath: string): void {
  const rows = db.prepare("SELECT thread_id AS threadId FROM codex_sessions WHERE source_path = ?").all(sourcePath) as Array<{ threadId: string }>;
  db.exec("BEGIN");
  try {
    const deleteFts = db.prepare("DELETE FROM codex_safe_text_fts WHERE thread_id = ?");
    for (const row of rows) deleteFts.run(String(row.threadId));
    db.prepare("DELETE FROM codex_sessions WHERE source_path = ?").run(sourcePath);
    db.prepare("DELETE FROM codex_source_files WHERE source_path = ?").run(sourcePath);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getSourceFileWatermark(db: LooDatabase, sourcePath: string): SourceFileWatermark | null {
  const row = db.prepare(`
    SELECT source_path AS sourcePath, path_hash AS pathHash, size, mtime_ms AS mtimeMs, last_indexed_at AS lastIndexedAt
    FROM codex_source_files
    WHERE source_path = ?
  `).get(sourcePath) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    sourcePath: String(row.sourcePath),
    pathHash: String(row.pathHash),
    size: Number(row.size ?? 0),
    mtimeMs: Number(row.mtimeMs ?? 0),
    lastIndexedAt: String(row.lastIndexedAt)
  };
}

function sourceNeedsMetadataBackfill(db: LooDatabase, sourcePath: string): boolean {
  const rows = db.prepare(`
    SELECT s.thread_id AS threadId, m.thread_id AS metadataThreadId, m.metadata_schema_version AS metadataSchemaVersion
    FROM codex_sessions s
    LEFT JOIN codex_session_metadata m ON m.thread_id = s.thread_id
    WHERE s.source_path = ?
  `).all(sourcePath) as Array<{ threadId: string; metadataThreadId: string | null; metadataSchemaVersion: number | null }>;
  return rows.length === 0 || rows.some((row) => !row.metadataThreadId || Number(row.metadataSchemaVersion ?? 0) < SESSION_METADATA_SCHEMA_VERSION);
}

export function probeCodexSqliteStores(roots: string[], maxFiles = 100): { stores: CodexSqliteProbe[] } {
  const paths = collectSqliteFiles(roots, maxFiles);
  return { stores: paths.map((path) => probeCodexSqliteStore(path)) };
}

export function searchSessions(db: LooDatabase, options: { query: string; limit?: number }): SessionSearchResult[] {
  const query = options.query.trim();
  if (!query) return [];
  const limit = clamp(options.limit ?? 10, 1, 100);
  const rows = safeFtsTerms(query).length > 0
    ? db.prepare(`
        SELECT s.thread_id AS threadId, s.title, s.summary, s.updated_at AS updatedAt, snippet(codex_safe_text_fts, 1, '[', ']', '...', 18) AS snippet, rank AS rank
        FROM codex_safe_text_fts
        JOIN codex_sessions s ON s.thread_id = codex_safe_text_fts.thread_id
        WHERE codex_safe_text_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(safeFtsTerms(query).join(" "), limit) as Array<Record<string, unknown>>
    : [];

  if (rows.length > 0) {
    return rows.map((row, index) => ({
      sourceKind: "codex_thread",
      sourceRef: codexThreadRef(String(row.threadId)),
      threadId: String(row.threadId),
      title: nullableString(row.title),
      summary: nullableString(row.summary),
      updatedAt: nullableString(row.updatedAt),
      score: index + 1,
      snippet: String(row.snippet ?? "")
    }));
  }

  const like = `%${escapeLike(query)}%`;
  return (db.prepare(`
    SELECT thread_id AS threadId, title, summary, updated_at AS updatedAt, safe_text AS safeText
    FROM codex_sessions
    WHERE title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR safe_text LIKE ? ESCAPE '\\'
    ORDER BY COALESCE(updated_at, indexed_at) DESC
    LIMIT ?
  `).all(like, like, like, limit) as Array<Record<string, unknown>>).map((row, index) => ({
    sourceKind: "codex_thread",
    sourceRef: codexThreadRef(String(row.threadId)),
    threadId: String(row.threadId),
    title: nullableString(row.title),
    summary: nullableString(row.summary),
    updatedAt: nullableString(row.updatedAt),
    score: index + 1,
    snippet: createSnippet(String(row.safeText ?? ""), query)
  }));
}

function searchClaudeSessions(db: LooDatabase, options: { query: string; limit?: number }): RecallSearchResult[] {
  const query = options.query.trim();
  if (!query) return [];
  const limit = clamp(options.limit ?? 10, 1, 100);
  const rows = safeFtsTerms(query).length > 0
    ? db.prepare(`
        SELECT s.session_id AS sessionId, s.title, s.safe_summary AS summary, s.updated_at AS updatedAt,
          s.source_path AS sourcePath, snippet(claude_safe_text_fts, 1, '[', ']', '...', 18) AS snippet, rank AS rank
        FROM claude_safe_text_fts
        JOIN claude_sessions s ON s.session_id = claude_safe_text_fts.session_id
        WHERE claude_safe_text_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(safeFtsTerms(query).join(" "), limit) as Array<Record<string, unknown>>
    : [];

  if (rows.length > 0) {
    return rows.map((row, index) => ({
      sourceKind: "claude_session",
      sourceRef: claudeSessionRef(String(row.sessionId)),
      sessionId: String(row.sessionId),
      title: nullableString(row.title),
      summary: nullableString(row.summary),
      updatedAt: nullableString(row.updatedAt),
      sourcePath: String(row.sourcePath ?? ""),
      score: index + 1,
      snippet: String(row.snippet ?? "")
    }));
  }

  const like = `%${escapeLike(query)}%`;
  return (db.prepare(`
    SELECT session_id AS sessionId, title, safe_summary AS summary, updated_at AS updatedAt, source_path AS sourcePath, safe_text AS safeText
    FROM claude_sessions
    WHERE title LIKE ? ESCAPE '\\' OR project LIKE ? ESCAPE '\\' OR workspace_hint LIKE ? ESCAPE '\\'
      OR status LIKE ? ESCAPE '\\' OR safe_summary LIKE ? ESCAPE '\\' OR safe_text LIKE ? ESCAPE '\\'
    ORDER BY COALESCE(updated_at, indexed_at) DESC
    LIMIT ?
  `).all(like, like, like, like, like, like, limit) as Array<Record<string, unknown>>).map((row, index) => ({
    sourceKind: "claude_session",
    sourceRef: claudeSessionRef(String(row.sessionId)),
    sessionId: String(row.sessionId),
    title: nullableString(row.title),
    summary: nullableString(row.summary),
    updatedAt: nullableString(row.updatedAt),
    sourcePath: String(row.sourcePath ?? ""),
    score: index + 1,
    snippet: createSnippet(String(row.safeText ?? ""), query)
  }));
}

export function describeSession(db: LooDatabase, threadId: string): SessionDescription | null {
  const row = db.prepare(`
    SELECT thread_id AS threadId, title, cwd, model, branch, git_sha AS gitSha, summary, final_message AS finalMessage,
      source_path AS sourcePath, tool_call_count AS toolCallCount
    FROM codex_sessions
    WHERE thread_id = ?
  `).get(threadId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    sourceKind: "codex_thread",
    sourceRef: codexThreadRef(String(row.threadId)),
    threadId: String(row.threadId),
    title: nullableString(row.title),
    cwd: nullableString(row.cwd),
    model: nullableString(row.model),
    branch: nullableString(row.branch),
    gitSha: nullableString(row.gitSha),
    summary: nullableString(row.summary),
    finalMessage: nullableString(row.finalMessage),
    planCount: Number((db.prepare("SELECT COUNT(*) AS count FROM codex_plans WHERE thread_id = ?").get(threadId) as { count: number }).count),
    touchedFiles: getCodexTouchedFiles(db, { threadId }),
    toolCallCount: Number(row.toolCallCount ?? 0),
    sourcePath: publicSourcePathRef(String(row.sourcePath)),
    metadata: getSessionMetadata(db, threadId)
  };
}

export function describeClaudeSessionInventory(db: LooDatabase, sessionId: string): ClaudeSessionInventoryDescription | null {
  const row = db.prepare(`
    SELECT
      session_id AS sessionId,
      title,
      project,
      workspace_hint AS workspaceHint,
      status,
      safe_summary AS safeSummary,
      updated_at AS updatedAt,
      source_path AS sourcePath,
      source_refs_json AS sourceRefsJson
    FROM claude_sessions
    WHERE session_id = ?
  `).get(sessionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    sourceKind: "claude_session",
    sourceRef: claudeSessionRef(String(row.sessionId)),
    sessionId: String(row.sessionId),
    title: nullableString(row.title),
    project: nullableString(row.project),
    workspaceHint: nullableString(row.workspaceHint),
    status: nullableString(row.status),
    summary: nullableString(row.safeSummary),
    updatedAt: nullableString(row.updatedAt),
    sourcePath: String(row.sourcePath),
    sourceRefs: parseSourceRefsJson(row.sourceRefsJson)
  };
}

function formatClaudeSessionInventoryMetadata(description: ClaudeSessionInventoryDescription): string {
  return [
    `Claude session ID: ${description.sessionId}`,
    `Ref: ${description.sourceRef}`,
    description.title ? `Title: ${description.title}` : null,
    description.project ? `Project: ${description.project}` : null,
    description.workspaceHint ? `Workspace: ${description.workspaceHint}` : null,
    description.status ? `Status: ${description.status}` : null,
    description.updatedAt ? `Updated: ${description.updatedAt}` : null,
    `Source path: ${description.sourcePath}`,
    description.sourceRefs.length ? `Source refs: ${description.sourceRefs.join(", ")}` : null,
    "Proof boundary: read-only Claude metadata fixture inventory only; no private transcript content, live control, GUI mutation, parity, or cloud sync proof."
  ].filter(Boolean).join("\n");
}

export function getCodexThreadMap(db: LooDatabase, options: CodexThreadMapOptions = {}): Array<{
  threadId: string;
  title: string | null;
  summary: string | null;
  updatedAt: string | null;
  sourcePath: string;
  metadata: SessionMetadata;
}> {
  const where: string[] = [];
  const params: Array<string | number> = [];
  const metadataFilters = [
    ["project", options.project],
    ["status", options.status],
    ["priority", options.priority]
  ] as const;
  for (const [column, value] of metadataFilters) {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) continue;
    where.push(`LOWER(COALESCE(m.${column}, '')) = ?`);
    params.push(normalized);
  }
  const blocker = options.blocker?.trim().toLowerCase();
  if (blocker) {
    where.push("LOWER(COALESCE(m.blocker, '')) LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(blocker)}%`);
  }
  const priorityOrder = unique((options.priorityOrder ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean)).slice(0, 10);
  const priorityRank = priorityOrder.length > 0
    ? `CASE LOWER(COALESCE(m.priority, '')) ${priorityOrder.map(() => "WHEN ? THEN ?").join(" ")} ELSE ${priorityOrder.length} END,`
    : "";
  const priorityParams: Array<string | number> = priorityOrder.flatMap((value, index) => [value, index]);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return (db.prepare(`
    SELECT
      s.thread_id AS threadId,
      s.title,
      s.summary,
      s.updated_at AS updatedAt,
      s.source_path AS sourcePath,
      m.project,
      m.status,
      m.priority,
      m.owner,
      m.blocker,
      m.next_action AS nextAction,
      m.closeout_state AS closeoutState,
      m.plan_completion_state AS planCompletionState,
      m.proposed_plan_refs_json AS proposedPlanRefsJson,
      m.final_message_refs_json AS finalMessageRefsJson,
      m.touched_file_refs_json AS touchedFileRefsJson,
      m.source_refs_json AS sourceRefsJson
    FROM codex_sessions s
    LEFT JOIN codex_session_metadata m ON m.thread_id = s.thread_id
    ${whereSql}
    ORDER BY ${priorityRank} COALESCE(s.updated_at, s.indexed_at) DESC
    LIMIT ?
  `).all(...params, ...priorityParams, clamp(options.limit ?? 50, 1, 500)) as Array<Record<string, unknown>>).map((row) => ({
    threadId: String(row.threadId),
    title: nullableString(row.title),
    summary: nullableString(row.summary),
    updatedAt: nullableString(row.updatedAt),
    sourcePath: publicSourcePathRef(String(row.sourcePath)),
    metadata: sessionMetadataFromRow(row)
  }));
}

export function getCodexSessionManagementMap(db: LooDatabase, options: CodexThreadMapOptions = {}): CodexSessionManagementMap {
  const entries = getCodexThreadMap(db, options);
  const compare = managementEntryComparator(options.priorityOrder);
  const groups: CodexSessionManagementMap["groups"] = {
    activeWork: [],
    blockedWork: [],
    needsExpansion: [],
    safeToArchive: [],
    shouldFork: [],
    shouldResume: []
  };
  for (const entry of entries) {
    const classification = classifyManagementEntry(entry);
    if (!classification) continue;
    groups[classification.lane].push(managementEntry(entry, classification.reason));
  }
  for (const group of Object.values(groups)) group.sort(compare);

  return {
    publicSafe: true,
    dryRun: true,
    mutatesCodex: false,
    liveControlRequires: ["dry_run", "approval_audit_id"],
    summary: {
      total: entries.length,
      active: groups.activeWork.length,
      blocked: groups.blockedWork.length,
      needsExpansion: groups.needsExpansion.length,
      safeToArchive: groups.safeToArchive.length,
      shouldFork: groups.shouldFork.length,
      shouldResume: groups.shouldResume.length
    },
    groups,
    recommendations: [
      ...groups.needsExpansion.map((entry) => recommendation("expand", entry, "loo_expand_session", false, false, false)),
      ...groups.safeToArchive.map((entry) => recommendation("archive", entry, null, true, true, false)),
      ...groups.shouldFork.map((entry) => recommendation("fork", entry, null, true, true, false)),
      ...groups.shouldResume.map((entry) => recommendation("resume", entry, "loo_codex_resume_thread", true, true, true))
    ]
  };
}

export function getRecentSessions(db: LooDatabase, options: {
  scope?: "active" | "recent" | "all";
  since?: string;
  limit?: number;
  repo?: string;
  status?: string;
  hasPlan?: boolean;
  hasFinal?: boolean;
  hasBlocker?: boolean;
  touchedPath?: string;
  risk?: "low" | "medium" | "high";
  includeCards?: boolean;
  now?: string;
} = {}): RecentSessionsReport {
  const scope = options.scope ?? "recent";
  const limit = clamp(options.limit ?? 20, 1, 500);
  const nowMs = timestampMillis(options.now ?? null) ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  let entries = getCodexThreadMap(db, {
    limit: 500,
    project: options.repo,
    status: options.status
  });
  if (scope === "active") entries = entries.filter((entry) => !["done", "complete", "completed", "closed", "merged"].includes(normalizedMetadataValue(entry.metadata.status)));
  if (options.since) {
    const sinceMs = Date.parse(options.since);
    if (Number.isFinite(sinceMs)) entries = entries.filter((entry) => (timestampMillis(entry.updatedAt) ?? 0) >= sinceMs);
  }
  if (options.hasPlan === true) entries = entries.filter((entry) => entry.metadata.proposedPlanRefs.length > 0);
  if (options.hasFinal === true) entries = entries.filter((entry) => entry.metadata.finalMessageRefs.length > 0);
  if (options.hasBlocker === true) entries = entries.filter((entry) => hasRealBlocker(entry.metadata.blocker));
  let cards = entries.map((entry) => codexSessionCard(db, entry, nowMs));
  if (options.touchedPath) {
    const needle = options.touchedPath.toLowerCase();
    cards = cards.filter((card) => touchedPathMatches(db, card.threadId, needle));
  }
  if (options.risk) cards = cards.filter((card) => card.risk.level === options.risk);
  cards.sort(scope === "active" ? activeCodexSessionCardComparator : codexSessionCardComparator);
  const total = cards.length;
  cards = cards.slice(0, limit);

  return {
    schema: "lco.codex.recentSessions.v1",
    publicSafe: true,
    queryRequired: false,
    scope,
    generatedAt,
    summary: {
      total,
      returned: cards.length,
      stale: cards.filter((card) => card.freshness.stale).length,
      lowConfidence: cards.filter((card) => card.confidence < 0.7).length
    },
    cards: options.includeCards === false ? [] : cards,
    evidence: cards.flatMap((card) => evidenceCardsForSessionCard(card))
  };
}

export function createWatcherStatusReport(specs: WatchSpec[], options: { now?: string; limit?: number; watchId?: string } = {}): WatcherStatusReport {
  const now = timestampMillis(options.now ?? null) ?? Date.now();
  const limit = clamp(options.limit ?? 100, 1, 1000);
  const requestedWatchId = options.watchId ? publicSafeWatcherIdentifier(options.watchId, "watch") : null;
  const states = specs
    .filter((spec) => !requestedWatchId || publicSafeWatcherIdentifier(spec.watchId, "watch") === requestedWatchId)
    .map((spec) => watcherStateFromSpec(spec, now))
    .sort(watcherStateComparator);
  const selected = states.slice(0, limit);
  return {
    schema: "lco.watchers.status.v1",
    publicSafe: true,
    generatedAt: new Date(now).toISOString(),
    summary: {
      total: states.length,
      returned: selected.length,
      active: selected.filter((watcher) => watcher.status === "active").length,
      triggered: selected.filter((watcher) => watcher.status === "triggered").length,
      stale: selected.filter((watcher) => watcher.status === "stale").length,
      expired: selected.filter((watcher) => watcher.status === "expired").length,
      lowConfidence: selected.filter((watcher) => watcher.status === "low_confidence").length
    },
    watchers: selected,
    omitted: {
      count: Math.max(0, states.length - selected.length),
      reason: states.length > selected.length ? "limit" : "none"
    },
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      externalWrite: false,
      rawTranscriptRead: false
    },
    proofBoundary: "Watcher status is a read-only deterministic report over supplied watcher specs. It can request attention or a resume packet, but it does not send, resume, steer, interrupt, click, type, clean up, or mutate external systems."
  };
}

export function createResumeRequestPacket(watcher: WatcherState, options: { now?: string; ttlSeconds?: number; recommendedAction?: WatcherRecommendedAction } = {}): ResumeRequestPacket {
  const now = timestampMillis(options.now ?? null) ?? Date.now();
  const ttlSeconds = clamp(options.ttlSeconds ?? 900, 60, 86400);
  const expiresAt = new Date(now + ttlSeconds * 1000).toISOString();
  return {
    schema: "lco.resumeRequestPacket.v1",
    publicSafe: true,
    packetId: `resume_req_${stableId(`${watcher.watchId}:${watcher.targetRef}:${expiresAt}`).slice(0, 16)}`,
    targetRef: watcher.targetRef,
    reason: watcher.status === "triggered" ? "watcher_triggered" : "manual_request",
    recommendedAction: options.recommendedAction ?? "inspect",
    requiresApproval: true,
    mutates: false,
    approvalBoundary: "Request only; no live control without a separate matching approval packet and Codex approval/sandbox gates.",
    evidenceIds: watcher.evidenceIds,
    reasonCodes: unique(["resume_request", ...watcher.reasonCodes]).slice(0, 12),
    expiresAt
  };
}

export function getCockpitInbox(db: LooDatabase, options: { limit?: number; priorityOrder?: string[]; watcherSpecs?: WatchSpec[]; now?: string } = {}): CockpitInboxReport {
  const limit = clamp(options.limit ?? 20, 1, 500);
  const nowMs = timestampMillis(options.now ?? null) ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const activeSessionCount = countActiveCodexSessions(db);
  const { cards } = getCollaborationActiveSessionCards(db, {
    activeSessionCount,
    priorityOrder: options.priorityOrder,
    nowMs
  });
  const watcherReport = options.watcherSpecs?.length ? createWatcherStatusReport(options.watcherSpecs, { now: generatedAt, limit: 1000 }) : null;
  const watchersByTarget = watcherReport ? triggeredWatchersByTarget(watcherReport.watchers) : new Map<string, WatcherState[]>();
  const items = cards
    .map((card) => {
      const watcherStates = watchersByTarget.get(card.threadId) ?? [];
      const watcherTriggered = watcherStates.some((watcher) => watcher.status === "triggered");
      const watcherStale = watcherStates.some((watcher) => watcher.status === "stale");
      const reasonCodes = unique([
        ...cockpitReasonCodes(card),
        ...(watcherTriggered ? ["watcher_triggered"] : []),
        ...(watcherStale ? ["watcher_stale"] : [])
      ]);
      const urgencyScore = cockpitUrgencyScore(card, options.priorityOrder) + (watcherTriggered ? 35 : watcherStale ? 15 : 0);
      return {
        card,
        reasonCodes,
        urgencyScore,
        nextAction: watcherTriggered
          ? {
              kind: "resume" as const,
              confidence: Math.min(0.95, Math.max(card.nextAction.confidence, ...watcherStates.map((watcher) => watcher.confidence))),
              reason: "watcher_triggered",
              requiresApproval: true
            }
          : card.nextAction
      };
    })
    .filter((item) => item.reasonCodes.length > 0)
    .sort((left, right) => compareOperatingUrgency(cockpitInboxItemAttentionLevel(left), cockpitInboxItemAttentionLevel(right)) || right.urgencyScore - left.urgencyScore || compareUpdatedAtDesc(left.card.freshness.lastEventAt, right.card.freshness.lastEventAt) || left.card.threadId.localeCompare(right.card.threadId));
  const selected = items.slice(0, limit);
  return {
    schema: "lco.codex.cockpitInbox.v1",
    publicSafe: true,
    generatedAt,
    summary: {
      totalCards: activeSessionCount,
      returned: selected.length,
      critical: selected.filter((item) => item.urgencyScore >= 90).length,
      high: selected.filter((item) => item.urgencyScore >= 70).length,
      lowConfidence: selected.filter((item) => item.card.confidence < 0.7).length
    },
    items: selected,
    omitted: {
      count: Math.max(0, items.length - selected.length),
      reason: items.length > selected.length ? "limit" : "none"
    }
  };
}

export function createCodexCollaborationCockpit(db: LooDatabase, options: CodexCollaborationCockpitOptions = {}): CodexCollaborationCockpitReport {
  const limit = clamp(options.limit ?? 20, 1, 500);
  const generatedAt = publicIsoTimestamp(options.now) ?? new Date().toISOString();
  const nowMs = timestampMillis(generatedAt) ?? Date.now();
  const activeSessionCount = countActiveCodexSessions(db);
  const recent = getCollaborationActiveSessionCards(db, {
    activeSessionCount,
    priorityOrder: options.priorityOrder,
    nowMs
  });
  const inbox = getCockpitInbox(db, {
    limit: 500,
    priorityOrder: options.priorityOrder,
    watcherSpecs: options.watcherSpecs,
    now: generatedAt
  });
  const inboxByThread = new Map(inbox.items.map((item) => [item.card.threadId, item]));
  const coherenceByThread = collaborationReportsByThread(options.desktopCoherenceReports ?? [], "coherence");
  const fallbackByThread = collaborationReportsByThread(options.desktopFallbackReports ?? [], "fallback");
  const laneInputs = recent.cards.map((card) => ({
    card,
    inboxItem: inboxByThread.get(card.threadId) ?? null,
    coherence: coherenceByThread.get(card.threadId) ?? null,
    fallback: fallbackByThread.get(card.threadId) ?? null
  }));
  const sortedLaneInputs = laneInputs
    .map((input) => ({
      input,
      lane: collaborationLane(input.card, {
        ...input,
        priorityOrder: options.priorityOrder,
        desktopCoherenceCoverage: "partial",
        desktopFallbackCoverage: "partial"
      })
    }))
    .sort((left, right) => collaborationLaneComparator(left.lane, right.lane));
  const selectedInputs = sortedLaneInputs.slice(0, limit).map(({ input }) => input);
  const selectedThreadRefs = new Set(selectedInputs.map(({ card }) => card.threadId));
  const desktopCoherenceCoverage = collaborationCoverage(options.desktopCoherenceReports, collaborationJoinedReportCount(coherenceByThread, selectedThreadRefs), selectedThreadRefs.size);
  const desktopFallbackCoverage = collaborationCoverage(options.desktopFallbackReports, collaborationJoinedReportCount(fallbackByThread, selectedThreadRefs), selectedThreadRefs.size);
  const selected = selectedInputs.map((input) => collaborationLane(input.card, {
    ...input,
    priorityOrder: options.priorityOrder,
    desktopCoherenceCoverage,
    desktopFallbackCoverage
  }));

  return {
    schema: "lco.codex.collaborationCockpit.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt,
    summary: {
      totalCards: activeSessionCount,
      returned: selected.length,
      running: selected.filter((lane) => lane.sessionState === "running").length,
      waiting: selected.filter((lane) => lane.sessionState === "waiting").length,
      needsApproval: selected.filter(collaborationLaneNeedsApproval).length,
      blocked: selected.filter((lane) => lane.sessionState === "blocked").length,
      desktopVisible: selected.filter((lane) => lane.desktop.state === "desktop_visible").length,
      fallbackRequired: selected.filter((lane) => lane.desktop.requiresFallback).length,
      highAttention: selected.filter((lane) => lane.attention.level === "high" || lane.attention.level === "critical").length,
      lowConfidence: selected.filter((lane) => lane.card.confidence < 0.7 || collaborationLaneHasLowConfidenceDesktopEvidence(lane)).length
    },
    sourceCoverage: {
      recentSessions: recent.capped ? "partial" : recent.cards.length > 0 ? "ok" : "partial",
      cockpitInbox: inbox.summary.totalCards > 0 ? "ok" : "partial",
      desktopCoherence: desktopCoherenceCoverage,
      desktopFallback: desktopFallbackCoverage
    },
    lanes: selected,
    omitted: {
      count: Math.max(0, activeSessionCount - selected.length),
      reason: activeSessionCount > selected.length ? "limit" : "none"
    },
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false,
      screenshotCaptured: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    proofBoundary: "This read-only collaboration cockpit summarizes indexed Codex session cards, deterministic inbox urgency, watcher requests, and optional public-safe Desktop coherence/fallback reports. It does not run live Codex control, click, type, select, refresh, restart, mutate Codex Desktop, capture screenshots, publish npm, create GitHub releases, or claim unattended Desktop collaboration."
  };
}

export function createCodexCollaborationNextSteps(db: LooDatabase, options: CodexCollaborationNextStepsOptions = {}): CodexCollaborationNextStepsReport {
  const generatedAt = publicIsoTimestamp(options.now) ?? new Date().toISOString();
  const cockpit = createCodexCollaborationCockpit(db, options);
  const watcherReport = createWatcherStatusReport(options.watcherSpecs ?? [], {
    now: options.now,
    limit: 1000
  });
  const watcherSpecsById = new Map((options.watcherSpecs ?? []).map((spec) => [
    watcherSpecLookupKey(publicSafeWatcherIdentifier(spec.watchId, "watch"), publicSafeWatcherTargetRef(spec.targetRef || "unknown")),
    spec
  ]));
  const triggeredWatchers = new Map<string, WatcherState>();
  for (const watcher of watcherReport.watchers) {
    if (watcher.status !== "triggered") continue;
    if (!triggeredWatchers.has(watcher.targetRef)) triggeredWatchers.set(watcher.targetRef, watcher);
  }
  const coherenceByThread = collaborationReportsByThread(options.desktopCoherenceReports ?? [], "coherence");
  const fallbackByThread = collaborationReportsByThread(options.desktopFallbackReports ?? [], "fallback");
  const steps = cockpit.lanes.map((lane) => collaborationNextStepForLane(lane, {
    watcher: triggeredWatchers.get(lane.threadId) ?? null,
    watcherSpec: (() => {
      const watcher = triggeredWatchers.get(lane.threadId);
      return watcher ? watcherSpecsById.get(watcherSpecLookupKey(watcher.watchId, watcher.targetRef)) ?? null : null;
    })(),
    coherence: coherenceByThread.get(lane.threadId) ?? null,
    fallback: fallbackByThread.get(lane.threadId) ?? null,
    now: generatedAt
  }));

  return {
    schema: "lco.codex.collaborationNextSteps.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt,
    summary: {
      totalLanes: cockpit.summary.totalCards,
      returned: steps.length,
      ready: steps.filter((step) => step.status === "ready").length,
      blocked: steps.filter((step) => step.status === "blocked").length,
      noop: steps.filter((step) => step.status === "noop").length
    },
    sourceCoverage: cockpit.sourceCoverage,
    steps,
    omitted: cockpit.omitted,
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false,
      screenshotCaptured: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    proofBoundary: "This read-only collaboration next-step planner emits exact public-safe tool-call packets with execute=false or explicit blockers. It does not run live Codex control, click, type, select, refresh, restart, mutate Codex Desktop, capture screenshots, publish npm, create GitHub releases, or claim unattended Desktop collaboration."
  };
}

export function createCodexRuntimeDesktopVisibilityStatus(
  db: LooDatabase,
  options: CodexRuntimeDesktopVisibilityStatusOptions = {}
): CodexRuntimeDesktopVisibilityStatusReport {
  const generatedAt = publicIsoTimestamp(options.now) ?? new Date().toISOString();
  const cockpit = createCodexCollaborationCockpit(db, options);
  const nextSteps = createCodexCollaborationNextSteps(db, { ...options, now: generatedAt });
  const nextStepByThread = new Map(nextSteps.steps.map((step) => [step.threadId, step]));
  const proofByThread = collaborationDesktopProofReportsByThread(options.desktopCollaborationProofReports ?? []);
  const lanes = cockpit.lanes.map((lane) => runtimeDesktopVisibilityLane(lane, {
    proof: proofByThread.get(lane.threadId) ?? null,
    nextStep: nextStepByThread.get(lane.threadId) ?? null
  }));
  const covered = lanes.filter((lane) => lane.coverage === "covered").length;
  const partial = lanes.filter((lane) => lane.coverage === "partial").length;
  const blocked = lanes.filter((lane) => lane.coverage === "blocked").length;
  const status: CodexRuntimeDesktopVisibilityCoverage = blocked > 0
    ? covered > 0 || partial > 0 ? "partial" : "blocked"
    : partial > 0 ? "partial" : "covered";
  const confidence = lanes.length === 0
    ? 0.4
    : Math.max(0.1, Math.min(1, lanes.reduce((sum, lane) => sum + lane.confidence, 0) / lanes.length));
  const selectedThreadRefs = new Set(cockpit.lanes.map((lane) => lane.threadId));
  const proofCoverage = collaborationCoverage(
    options.desktopCollaborationProofReports,
    collaborationJoinedReportCount(proofByThread, selectedThreadRefs),
    selectedThreadRefs.size
  );

  return {
    schema: "lco.codex.runtimeDesktopVisibilityStatus.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt,
    status,
    confidence,
    summary: {
      totalLanes: cockpit.summary.totalCards,
      returned: lanes.length,
      covered,
      partial,
      blocked,
      nextReadOnlyActions: lanes.filter((lane) => lane.nextToolCall !== null).length
    },
    sourceCoverage: {
      collaborationCockpit: cockpit.sourceCoverage.recentSessions === "ok" || cockpit.sourceCoverage.cockpitInbox === "ok" ? "ok" : "partial",
      desktopCoherence: cockpit.sourceCoverage.desktopCoherence,
      desktopFallback: cockpit.sourceCoverage.desktopFallback,
      desktopCollaborationProof: proofCoverage
    },
    lanes,
    omitted: cockpit.omitted,
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false,
      screenshotCaptured: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    proofBoundary: "This read-only runtime Desktop visibility status summarizes public-safe collaboration cockpit, coherence, fallback, and action-bound proof records. It does not run live Codex control, click, type, select, refresh, restart, mutate Codex Desktop, capture screenshots, publish npm, create GitHub releases, or claim unattended Desktop collaboration."
  };
}

function countActiveCodexSessions(db: LooDatabase): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS total
    FROM codex_sessions AS s
    LEFT JOIN codex_session_metadata AS m ON m.thread_id = s.thread_id
    WHERE lower(trim(coalesce(m.status, ''))) NOT IN ('done', 'complete', 'completed', 'closed', 'merged')
  `).get() as { total?: number } | undefined;
  return typeof row?.total === "number" ? row.total : 0;
}

function getCollaborationActiveSessionCards(
  db: LooDatabase,
  options: { activeSessionCount: number; priorityOrder?: string[]; nowMs: number }
): { cards: CodexSessionCard[]; capped: boolean } {
  const prefetchLimit = clamp(
    Math.max(500, options.activeSessionCount),
    1,
    COLLABORATION_COCKPIT_INTERNAL_CARD_LIMIT
  );
  const priorityOrder = unique((options.priorityOrder ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean)).slice(0, 10);
  const priorityRank = priorityOrder.length > 0
    ? `CASE LOWER(COALESCE(m.priority, '')) ${priorityOrder.map(() => "WHEN ? THEN ?").join(" ")} ELSE ${priorityOrder.length} END,`
    : "";
  const priorityParams: Array<string | number> = priorityOrder.flatMap((value, index) => [value, index]);
  const rows = db.prepare(`
    SELECT
      s.thread_id AS threadId,
      s.title,
      s.summary,
      s.updated_at AS updatedAt,
      s.source_path AS sourcePath,
      m.project,
      m.status,
      m.priority,
      m.owner,
      m.blocker,
      m.next_action AS nextAction,
      m.closeout_state AS closeoutState,
      m.plan_completion_state AS planCompletionState,
      m.proposed_plan_refs_json AS proposedPlanRefsJson,
      m.final_message_refs_json AS finalMessageRefsJson,
      m.touched_file_refs_json AS touchedFileRefsJson,
      m.source_refs_json AS sourceRefsJson
    FROM codex_sessions s
    LEFT JOIN codex_session_metadata m ON m.thread_id = s.thread_id
    WHERE lower(trim(coalesce(m.status, ''))) NOT IN ('done', 'complete', 'completed', 'closed', 'merged')
    ORDER BY ${priorityRank} COALESCE(s.updated_at, s.indexed_at) DESC
    LIMIT ?
  `).all(...priorityParams, prefetchLimit) as Array<Record<string, unknown>>;
  const cards = rows.map((row) => codexSessionCard(db, {
    threadId: String(row.threadId),
    title: nullableString(row.title),
    summary: nullableString(row.summary),
    updatedAt: nullableString(row.updatedAt),
    sourcePath: publicSourcePathRef(String(row.sourcePath)),
    metadata: sessionMetadataFromRow(row)
  }, options.nowMs));
  cards.sort(activeCodexSessionCardComparator);
  return {
    cards,
    capped: options.activeSessionCount > prefetchLimit
  };
}

function collaborationLane(
  card: CodexSessionCard,
  input: {
    inboxItem: CockpitInboxItem | null;
    coherence: Record<string, unknown> | null;
    fallback: Record<string, unknown> | null;
    priorityOrder?: string[];
    desktopCoherenceCoverage: VisibleCodexCoverageState;
    desktopFallbackCoverage: VisibleCodexCoverageState;
  }
): CodexCollaborationCockpitLane {
  const desktop = collaborationDesktopState(input);
  const baseUrgencyScore = input.inboxItem?.urgencyScore ?? cockpitUrgencyScore(card, input.priorityOrder);
  const urgencyScore = collaborationDesktopUrgencyScore(baseUrgencyScore, desktop);
  const reasonCodes = unique([
    ...card.reasonCodes,
    ...(input.inboxItem?.reasonCodes ?? []),
    ...collaborationDesktopReasonCodes(input.coherence, input.fallback)
  ].map((code) => publicSafeIdentifier(code) ?? "").filter(Boolean));
  return {
    threadId: card.threadId,
    title: card.title,
    sessionState: card.state,
    attention: {
      level: collaborationAttentionLevel(urgencyScore, reasonCodes),
      urgencyScore
    },
    reasonCodes,
    nextAction: input.inboxItem?.nextAction ?? card.nextAction,
    desktop,
    card
  };
}

function collaborationNextStepForLane(
  lane: CodexCollaborationCockpitLane,
  input: {
    watcher: WatcherState | null;
    watcherSpec: WatchSpec | null;
    coherence: Record<string, unknown> | null;
    fallback: Record<string, unknown> | null;
    now?: string;
  }
): CodexCollaborationNextStep {
  const base = {
    threadId: lane.threadId,
    title: lane.title,
    attention: lane.attention,
    sessionState: lane.sessionState,
    desktopState: lane.desktop.state,
    evidenceIds: lane.desktop.evidenceIds,
    approvalBoundary: "Planner packets are read-only suggestions. Execute no live Codex control, Desktop refresh/restart, GUI action, or external write without a separate matching approval gate."
  };
  const sourceRef = lane.threadId;
  const threadId = bareCodexThreadId(sourceRef);

  if (collaborationLaneHasSessionApprovalBoundary(lane)) {
    return collaborationNextStep({
      ...base,
      category: "approval_boundary",
      status: "blocked",
      reasonCodes: unique([...lane.reasonCodes, "approval_required"]),
      blockers: ["approval_required"],
      confidence: Math.max(0.55, lane.card.confidence),
      toolCall: null
    });
  }

  if (input.watcher && input.watcherSpec) {
    return collaborationNextStep({
      ...base,
      category: "watcher_resume_packet",
      status: "ready",
      reasonCodes: unique([...lane.reasonCodes, "watcher_triggered", "resume_request_packet"]),
      blockers: [],
      confidence: Math.min(0.98, Math.max(lane.card.confidence, input.watcher.confidence)),
      toolCall: collaborationToolCall("loo_resume_request_packet", {
        watcher_spec: collaborationPublicSafeWatchSpecArg(input.watcherSpec),
        now: input.now,
        recommended_action: input.watcher.recommendedAction
      })
    });
  }

  const fallbackReason = collaborationString((isObjectRecord(input.fallback?.fallback) ? input.fallback.fallback : null)?.reason, 120);
  const fallbackBlockers = collaborationStringArray(input.fallback?.blockers, 120);
  if (fallbackReason === "coherence_input_missing" || fallbackBlockers.includes("coherence_input_missing")) {
    return collaborationNextStep({
      ...base,
      category: "desktop_coherence",
      status: "ready",
      reasonCodes: unique([...lane.reasonCodes, "coherence_input_missing", "desktop_coherence_required"]),
      blockers: [],
      confidence: Math.max(0.55, lane.desktop.confidence),
      toolCall: collaborationToolCall("loo_codex_desktop_coherence", collaborationDesktopCoherenceArgsFromFallback(input.fallback, threadId, sourceRef))
    });
  }

  if (lane.desktop.state === "not_configured") {
    return collaborationNextStep({
      ...base,
      category: "desktop_coherence",
      status: "ready",
      reasonCodes: unique([...lane.reasonCodes, "desktop_coherence_missing", "desktop_coherence_required"]),
      blockers: [],
      confidence: Math.max(0.6, lane.desktop.confidence),
      toolCall: collaborationToolCall("loo_codex_desktop_coherence", {
        thread_id: threadId,
        source_ref: sourceRef
      })
    });
  }

  if ((lane.desktop.state === "cli_visible" || lane.desktop.state === "unknown") && !input.coherence) {
    return collaborationNextStep({
      ...base,
      category: "desktop_coherence",
      status: "ready",
      reasonCodes: unique([...lane.reasonCodes, "desktop_coherence_missing", "desktop_coherence_required"]),
      blockers: [],
      confidence: Math.max(0.55, lane.desktop.confidence),
      toolCall: collaborationToolCall("loo_codex_desktop_coherence", {
        thread_id: threadId,
        source_ref: sourceRef
      })
    });
  }

  const coherenceState = input.coherence ? publicSafeCoherenceState(input.coherence.state) : null;
  if ((lane.desktop.state === "cli_visible" || lane.desktop.state === "unknown") && input.coherence && coherenceState !== "desktop_visible") {
    return collaborationNextStep({
      ...base,
      category: "desktop_fallback_status",
      status: "ready",
      reasonCodes: unique([...lane.reasonCodes, "desktop_fallback_status_required"]),
      blockers: [],
      confidence: Math.max(0.55, lane.desktop.confidence),
      toolCall: collaborationToolCall("loo_codex_desktop_fallback_status", {
        thread_id: threadId,
        source_ref: sourceRef,
        coherence: collaborationPublicSafeCoherenceArg(input.coherence, threadId, sourceRef)
      })
    });
  }

  if (lane.desktop.state === "fallback_ready") {
    const approvalReasons = collaborationDesktopActionApprovalReasons(lane);
    return collaborationNextStep({
      ...base,
      category: "desktop_action_approval",
      status: "blocked",
      reasonCodes: unique([...lane.reasonCodes, "desktop_action_approval_required", ...approvalReasons]),
      blockers: unique(["desktop_action_approval_required", ...approvalReasons]),
      confidence: lane.desktop.confidence,
      toolCall: null
    });
  }

  if (lane.desktop.state === "fallback_blocked") {
    const approvalReasons = collaborationDesktopActionApprovalReasons(lane);
    return collaborationNextStep({
      ...base,
      category: "desktop_action_approval",
      status: "blocked",
      reasonCodes: unique([...lane.reasonCodes, "desktop_fallback_blocked", ...approvalReasons]),
      blockers: unique([...(lane.desktop.blockers.length > 0 ? lane.desktop.blockers : ["desktop_fallback_blocked"]), ...approvalReasons]),
      confidence: lane.desktop.confidence,
      toolCall: null
    });
  }

  return collaborationNextStep({
    ...base,
    category: "observe",
    status: "noop",
    reasonCodes: unique([...lane.reasonCodes, lane.desktop.state === "desktop_visible" ? "desktop_visible_no_action" : "observe_only"]),
    blockers: [],
    confidence: lane.desktop.confidence,
    toolCall: null
  });
}

function collaborationNextStep(input: Omit<CodexCollaborationNextStep, "stepId">): CodexCollaborationNextStep {
  return {
    ...input,
    stepId: `collab_step_${stableId(`${input.threadId}:${input.category}:${input.status}:${input.toolCall?.tool ?? "none"}`).slice(0, 16)}`,
    reasonCodes: unique(input.reasonCodes.map((code) => publicSafeIdentifier(code) ?? "").filter(Boolean)).slice(0, 20),
    blockers: unique(input.blockers.map(collaborationPublicSafeBlocker).filter((blocker): blocker is string => Boolean(blocker))).slice(0, 20),
    evidenceIds: unique(input.evidenceIds.map((id) => publicSafeRefLike(id, "evidence") ?? "").filter(Boolean)).slice(0, 20),
    confidence: Math.max(0.1, Math.min(1, input.confidence))
  };
}

function collaborationToolCall(
  tool: CodexCollaborationNextStepToolCall["tool"],
  args: Record<string, unknown>
): CodexCollaborationNextStepToolCall {
  const sanitizedArgs = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
  return {
    tool,
    args: sanitizedArgs,
    execute: false
  };
}

function runtimeDesktopVisibilityLane(
  lane: CodexCollaborationCockpitLane,
  input: {
    proof: Record<string, unknown> | null;
    nextStep: CodexCollaborationNextStep | null;
  }
): CodexRuntimeDesktopVisibilityLane {
  const proofToolCall = input.proof ? runtimeDesktopVisibilityProofToolCall(input.proof) : null;
  if (lane.desktop.state === "desktop_visible") {
    return runtimeDesktopVisibilityLaneRecord(lane, {
      coverage: "covered",
      confidence: Math.max(lane.desktop.confidence, 0.85),
      blockers: [],
      reasonCodes: unique([...lane.reasonCodes, "desktop_visible_runtime_covered"]),
      evidenceIds: lane.desktop.evidenceIds,
      nextToolCall: null
    });
  }
  if (input.proof) {
    return runtimeDesktopVisibilityLaneRecord(lane, {
      coverage: "covered",
      confidence: Math.max(lane.desktop.confidence, 0.82),
      blockers: [],
      reasonCodes: unique([...lane.reasonCodes, "action_bound_desktop_proof_ready"]),
      evidenceIds: unique([...lane.desktop.evidenceIds, ...collaborationStringArray(input.proof.evidenceIds, 160)]),
      nextToolCall: proofToolCall
    });
  }
  if (lane.desktop.state === "fallback_ready") {
    return runtimeDesktopVisibilityLaneRecord(lane, {
      coverage: "partial",
      confidence: Math.min(0.78, Math.max(lane.desktop.confidence, 0.62)),
      blockers: ["action_bound_desktop_proof_missing"],
      reasonCodes: unique([...lane.reasonCodes, "desktop_fallback_ready", "action_bound_desktop_proof_missing"]),
      evidenceIds: lane.desktop.evidenceIds,
      nextToolCall: null
    });
  }
  const nextToolCall = runtimeDesktopVisibilityNextToolCall(input.nextStep);
  const blockers = unique([
    ...(lane.desktop.blockers.length > 0 ? lane.desktop.blockers : ["desktop_visibility_runtime_proof_missing"]),
    ...(nextToolCall ? [] : ["desktop_visibility_runtime_proof_missing"])
  ]);
  return runtimeDesktopVisibilityLaneRecord(lane, {
    coverage: "blocked",
    confidence: Math.min(0.7, lane.desktop.confidence),
    blockers,
    reasonCodes: unique([...lane.reasonCodes, "desktop_visibility_runtime_proof_missing"]),
    evidenceIds: lane.desktop.evidenceIds,
    nextToolCall
  });
}

function runtimeDesktopVisibilityLaneRecord(
  lane: CodexCollaborationCockpitLane,
  input: {
    coverage: CodexRuntimeDesktopVisibilityCoverage;
    confidence: number;
    blockers: string[];
    reasonCodes: string[];
    evidenceIds: string[];
    nextToolCall: CodexRuntimeDesktopVisibilityToolCall | null;
  }
): CodexRuntimeDesktopVisibilityLane {
  return {
    threadId: lane.threadId,
    title: publicSafeText(lane.title, 180),
    coverage: input.coverage,
    desktopState: lane.desktop.state,
    confidence: Math.max(0.1, Math.min(1, input.confidence)),
    blockers: unique(input.blockers.map(collaborationPublicSafeBlocker).filter((blocker): blocker is string => Boolean(blocker))).slice(0, 20),
    reasonCodes: unique(input.reasonCodes.map(collaborationPublicSafeReasonCode).filter((code): code is string => Boolean(code))).slice(0, 20),
    evidenceIds: unique(input.evidenceIds.map((id) => publicSafeRefLike(id, "evidence") ?? "").filter(Boolean)).slice(0, 20),
    nextToolCall: input.nextToolCall
  };
}

function runtimeDesktopVisibilityNextToolCall(step: CodexCollaborationNextStep | null): CodexRuntimeDesktopVisibilityToolCall | null {
  if (!step?.toolCall) return null;
  const tool = step.toolCall.tool;
  if (tool !== "loo_codex_desktop_coherence" && tool !== "loo_codex_desktop_fallback_status") return null;
  return {
    tool,
    args: runtimeDesktopVisibilityPublicSafeArgs(step.toolCall.args),
    execute: false
  };
}

function runtimeDesktopVisibilityProofToolCall(proof: Record<string, unknown>): CodexRuntimeDesktopVisibilityToolCall | null {
  const candidate = isObjectRecord(proof.requiredNextToolCall) ? proof.requiredNextToolCall : null;
  if (!candidate) return null;
  const tool = collaborationString(candidate.tool, 120);
  if (tool !== "loo_desktop_live_proof_harness") return null;
  if (candidate.execute !== false) return null;
  return {
    tool,
    args: runtimeDesktopVisibilityPublicSafeArgs(isObjectRecord(candidate.args) ? candidate.args : {}),
    execute: false
  };
}

function runtimeDesktopVisibilityPublicSafeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(args)) {
    const safeKey = publicSafeIdentifier(key);
    if (!safeKey) continue;
    if (typeof value === "boolean") {
      entries.push([safeKey, value]);
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      entries.push([safeKey, Math.trunc(value)]);
      continue;
    }
    if (typeof value === "string") {
      const safeValue = publicSafeText(value, 240);
      if (safeValue) entries.push([safeKey, safeValue]);
      continue;
    }
    if (isObjectRecord(value)) {
      entries.push([safeKey, runtimeDesktopVisibilityPublicSafeArgs(value)]);
      continue;
    }
    if (Array.isArray(value)) {
      entries.push([safeKey, value.map((item) => typeof item === "string" ? publicSafeText(item, 160) : null).filter(Boolean).slice(0, 20)]);
    }
  }
  return Object.fromEntries(entries);
}

function collaborationDesktopProofReportsByThread(reports: unknown[]): Map<string, Record<string, unknown>> {
  const byThread = new Map<string, Record<string, unknown>>();
  for (const report of reports) {
    if (!isObjectRecord(report)) continue;
    if (!collaborationDesktopProofReportIsUsable(report)) continue;
    const targetRef = collaborationDesktopProofTargetRef(report);
    if (!targetRef) continue;
    byThread.set(targetRef, report);
  }
  return byThread;
}

function collaborationDesktopProofReportIsUsable(report: Record<string, unknown>): boolean {
  if (report.schema !== "lco.codexDesktopCollaborationProof.v1") return false;
  if (report.publicSafe !== true || report.readOnly !== true) return false;
  if (report.ok !== true || report.status !== "ready" || report.approvalVerified !== true) return false;
  const actions = isObjectRecord(report.actionsPerformed) ? report.actionsPerformed : null;
  if (!actions) return false;
  if (actions.liveCodexControlRun !== false) return false;
  if (actions.desktopGuiActionRun !== false) return false;
  if (actions.rawTranscriptRead !== false) return false;
  if (actions.screenshotCaptured !== false) return false;
  const proofMarkers = isObjectRecord(report.proofMarkers) ? report.proofMarkers : null;
  if (!proofMarkers) return false;
  if (proofMarkers.actionBoundTarget !== true) return false;
  if (proofMarkers.approvalPacketBound !== true) return false;
  if (proofMarkers.publicSafeEvidenceOnly !== true) return false;
  if (proofMarkers.noScreenshotPolicy !== true) return false;
  if (proofMarkers.dryRunOnly !== true) return false;
  const sourceCoverage = isObjectRecord(report.sourceCoverage) ? report.sourceCoverage : null;
  return Boolean(sourceCoverage
    && sourceCoverage.indexedSession === "ok"
    && sourceCoverage.desktopCoherence === "ok"
    && sourceCoverage.desktopFallback === "ok"
    && sourceCoverage.approvalPacket === "ok");
}

function collaborationDesktopProofTargetRef(report: Record<string, unknown>): string | null {
  const target = isObjectRecord(report.target) ? report.target : {};
  const sourceRef = collaborationString(target.targetRef ?? target.sourceRef ?? report.targetRef ?? report.sourceRef, 180);
  const threadId = collaborationString(target.targetThreadId ?? target.threadId ?? report.targetThreadId ?? report.threadId, 120);
  if (codexDesktopCoherenceTargetMismatch(threadId, sourceRef)) return null;
  return normalizeCodexThreadSourceRef(sourceRef, threadId);
}

function collaborationDesktopCoherenceArgsFromFallback(
  fallback: Record<string, unknown> | null,
  threadId: string,
  sourceRef: string
): Record<string, unknown> {
  const nextToolCall = isObjectRecord(fallback?.nextToolCall) ? fallback.nextToolCall : null;
  const args = isObjectRecord(nextToolCall?.args) ? nextToolCall.args : {};
  const argThreadId = collaborationString(args.thread_id ?? args.threadId, 120);
  const argSourceRef = collaborationString(args.source_ref ?? args.sourceRef, 180);
  const normalized = normalizeCodexThreadSourceRef(argSourceRef, argThreadId) ?? sourceRef;
  const candidateThreadId = argThreadId ? safeThreadId(argThreadId) : bareCodexThreadId(normalized);
  if (
    codexDesktopCoherenceTargetMismatch(argThreadId, normalized)
    || candidateThreadId !== threadId
    || normalized !== sourceRef
  ) {
    return { thread_id: threadId, source_ref: sourceRef };
  }
  return {
    thread_id: argThreadId ? safeThreadId(argThreadId) : threadId,
    source_ref: normalized
  };
}

function collaborationPublicSafeCoherenceArg(
  report: Record<string, unknown>,
  threadId: string,
  sourceRef: string
): Record<string, unknown> {
  const target = isObjectRecord(report.target) ? report.target : {};
  const targetThreadId = collaborationString(target.threadId ?? target.thread_id, 120);
  const targetSourceRef = collaborationString(target.sourceRef ?? target.source_ref, 180);
  const normalized = normalizeCodexThreadSourceRef(targetSourceRef, targetThreadId) ?? sourceRef;
  return {
    schema: "lco.codexDesktopCoherence.v1",
    publicSafe: true,
    target: {
      threadId: codexDesktopCoherenceTargetMismatch(targetThreadId, normalized) ? threadId : safeThreadId(targetThreadId ?? threadId),
      sourceRef: codexDesktopCoherenceTargetMismatch(targetThreadId, normalized) ? sourceRef : normalized
    },
    state: publicSafeCoherenceState(report.state),
    confidence: collaborationNumber(report.confidence) ?? 0.6,
    evidenceIds: collaborationStringArray(report.evidenceIds, 160).map((id) => publicSafeRefLike(id, "evidence") ?? "").filter(Boolean).slice(0, 20),
    reasonCodes: collaborationStringArray(report.reasonCodes, 120).map(collaborationPublicSafeReasonCode).filter(Boolean).slice(0, 20),
    blockers: collaborationStringArray(report.blockers, 120).map(collaborationPublicSafeBlocker).filter(Boolean).slice(0, 20),
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false
    }
  };
}

function collaborationPublicSafeWatchSpecArg(spec: WatchSpec): Record<string, unknown> {
  return {
    schema: "lco.watchSpec.v1",
    watch_id: publicSafeWatcherIdentifier(spec.watchId, "watch"),
    target_ref: publicSafeRefLike(spec.targetRef, "target") ?? `target_${stableId(spec.targetRef).slice(0, 16)}`,
    kind: spec.kind,
    created_at: publicSafeWatcherTimestamp(spec.createdAt, "created_at"),
    last_observed_at: spec.lastObservedAt ? publicSafeWatcherTimestamp(spec.lastObservedAt, "last_observed_at") : null,
    ttl_seconds: clamp(Math.trunc(spec.ttlSeconds), 60, 30 * 24 * 60 * 60),
    ...(spec.staleAfterSeconds !== undefined ? { stale_after_seconds: clamp(Math.trunc(spec.staleAfterSeconds), 60, 30 * 24 * 60 * 60) } : {}),
    stop_conditions: spec.stopConditions.map((condition) => publicSafeWatcherIdentifier(condition, "condition")).slice(0, 12),
    ...(spec.wakeReason ? { wake_reason: publicSafeWatcherIdentifier(spec.wakeReason, "wake") } : {}),
    evidence_ids: (spec.evidenceIds ?? []).map((id) => publicSafeRefLike(id, "evidence") ?? "").filter(Boolean).slice(0, 20),
    ...(spec.confidence !== undefined ? { confidence: Math.max(0, Math.min(1, spec.confidence)) } : {}),
    mutates: false,
    ...(spec.observed ? { observed: collaborationPublicSafeWatcherObservedArg(spec.observed) } : {})
  };
}

function collaborationPublicSafeWatcherObservedArg(observed: NonNullable<WatchSpec["observed"]>): Record<string, unknown> {
  return {
    ...(observed.threadStatus ? { thread_status: publicSafeWatcherText(observed.threadStatus, 80, "thread_status") } : {}),
    ...(observed.finalMessageCount !== undefined ? { final_message_count: Math.max(0, Math.trunc(observed.finalMessageCount)) } : {}),
    ...(observed.prChecksChanged !== undefined ? { pr_checks_changed: observed.prChecksChanged === true } : {}),
    ...(observed.reviewCommentCount !== undefined ? { review_comment_count: Math.max(0, Math.trunc(observed.reviewCommentCount)) } : {}),
    ...(observed.approvalExpiresAt !== undefined ? { approval_expires_at: observed.approvalExpiresAt ? publicSafeWatcherTimestamp(observed.approvalExpiresAt, "approval_expires_at") : null } : {}),
    ...(observed.noActivitySeconds !== undefined ? { no_activity_seconds: Math.max(0, Math.trunc(observed.noActivitySeconds)) } : {})
  };
}

function collaborationDesktopState(input: {
  coherence: Record<string, unknown> | null;
  fallback: Record<string, unknown> | null;
  desktopCoherenceCoverage: VisibleCodexCoverageState;
  desktopFallbackCoverage: VisibleCodexCoverageState;
}): CodexCollaborationCockpitLane["desktop"] {
  const coherence = input.coherence;
  const fallback = input.fallback;
  const fallbackDetails = isObjectRecord(fallback?.fallback) ? fallback.fallback : null;
  const coherenceState = collaborationString(coherence?.state, 80);
  const coherenceConfidence = collaborationNumber(coherence?.confidence);
  const fallbackRequired = typeof fallbackDetails?.required === "boolean"
    ? fallbackDetails.required
    : collaborationCoherenceRequiresFallback(Boolean(coherence), coherenceState);
  const fallbackReason = collaborationString(fallbackDetails?.reason, 120);
  const preferredBackend = fallback && collaborationString(fallback.preferredBackend, 40) === "cua-driver" ? "cua-driver" : null;
  const backendRecords = Array.isArray(fallback?.backends)
    ? fallback.backends.filter(isObjectRecord)
    : [];
  const readyBackend = backendRecords.some((backend) => {
    if (collaborationString(backend.status, 40) !== "ready") return false;
    if (!preferredBackend) return true;
    return collaborationString(backend.backend, 40) === preferredBackend;
  });
  const fallbackTopLevelBlockers = collaborationStringArray(fallback?.blockers, 120);
  const fallbackBlockers = [
    ...fallbackTopLevelBlockers,
    ...backendRecords.flatMap((backend) => collaborationStringArray(backend.blockers, 120))
  ];
  const blockers = unique([
    ...collaborationStringArray(coherence?.blockers, 120),
    ...fallbackBlockers
  ].map(collaborationPublicSafeBlocker).filter((blocker): blocker is string => Boolean(blocker)));
  const fallbackCoherenceInputMissing = fallbackReason === "coherence_input_missing" ||
    fallbackTopLevelBlockers.includes("coherence_input_missing");
  const fallbackBlocked = Boolean(
    fallback && (fallbackCoherenceInputMissing || (fallbackRequired && !readyBackend))
  );
  const reasonCodes = unique([
    ...collaborationStringArray(coherence?.reasonCodes, 120),
    ...(fallbackReason ? [fallbackReason] : []),
    ...(fallbackRequired ? ["desktop_fallback_required"] : []),
    ...(fallbackRequired && readyBackend ? ["desktop_fallback_ready"] : []),
    ...(fallbackBlocked ? ["desktop_fallback_blocked"] : [])
  ].map(collaborationPublicSafeReasonCode).filter((code): code is string => Boolean(code)));
  const state: CodexCollaborationDesktopState = fallbackCoherenceInputMissing
      ? "fallback_blocked"
      : fallbackRequired && readyBackend
      ? "fallback_ready"
      : fallbackRequired && fallback
        ? "fallback_blocked"
        : coherenceState === "desktop_visible" || fallbackReason === "desktop_visibility_already_proven"
          ? "desktop_visible"
          : coherenceState && ["cli_visible", "desktop_refresh_required", "desktop_restart_required"].includes(coherenceState)
            ? "cli_visible"
            : !coherence && !fallback
              ? "not_configured"
              : "unknown";
  const confidence = Math.max(0.1, Math.min(1,
    state === "not_configured" ? 0.4
      : state === "fallback_ready" ? Math.max(0.72, coherenceConfidence ?? 0.72)
        : state === "fallback_blocked" ? Math.min(0.7, coherenceConfidence ?? 0.65)
          : coherenceConfidence ?? (state === "desktop_visible" ? 0.85 : 0.6)
  ));
  return {
    state,
    requiresFallback: fallbackRequired,
    preferredBackend,
    confidence,
    sourceCoverage: {
      desktopCoherence: input.desktopCoherenceCoverage,
      desktopFallback: input.desktopFallbackCoverage
    },
    evidenceIds: unique([
      ...collaborationStringArray(coherence?.evidenceIds, 160),
      ...collaborationStringArray(fallback?.evidenceIds, 160)
    ].map((evidenceId) => publicSafeRefLike(evidenceId, "evidence") ?? "").filter(Boolean)),
    blockers,
    reasonCodes
  };
}

function collaborationReportsByThread(reports: unknown[], kind: "coherence" | "fallback"): Map<string, Record<string, unknown>> {
  const byThread = new Map<string, Record<string, unknown>>();
  for (const report of reports) {
    if (!isObjectRecord(report)) continue;
    if (!collaborationReportIsUsable(report, kind)) continue;
    const targetRef = collaborationTargetRef(report);
    if (!targetRef) continue;
    byThread.set(targetRef, report);
  }
  return byThread;
}

function collaborationReportIsUsable(report: Record<string, unknown>, kind: "coherence" | "fallback"): boolean {
  if (kind === "coherence" && report.schema !== "lco.codexDesktopCoherence.v1") return false;
  if (kind === "fallback" && report.schema !== "lco.codex.desktopFallback.v1") return false;
  if (report.publicSafe !== true) return false;
  if (kind === "fallback" && report.readOnly !== true) return false;
  const actions = isObjectRecord(report.actionsPerformed) ? report.actionsPerformed : null;
  if (!actions) return false;
  if (actions.liveCodexControlRun !== false) return false;
  if (actions.desktopGuiActionRun !== false) return false;
  if (actions.rawTranscriptRead !== false) return false;
  if (kind === "fallback" && actions.screenshotCaptured !== false) return false;
  return true;
}

function collaborationTargetRef(report: Record<string, unknown>): string | null {
  const target = isObjectRecord(report.target) ? report.target : {};
  const sourceRef = collaborationString(target.sourceRef ?? target.source_ref ?? report.sourceRef ?? report.source_ref, 180);
  const threadId = collaborationString(target.threadId ?? target.thread_id ?? report.threadId ?? report.thread_id, 120);
  if (codexDesktopCoherenceTargetMismatch(threadId, sourceRef)) return null;
  return normalizeCodexThreadSourceRef(sourceRef, threadId);
}

function collaborationCoverage(reports: unknown[] | undefined, matchedCount: number, selectedLaneCount: number): VisibleCodexCoverageState {
  if (!reports || reports.length === 0) return "not_configured";
  if (matchedCount === 0) return "partial";
  return selectedLaneCount > 0 && matchedCount === selectedLaneCount ? "ok" : "partial";
}

function collaborationJoinedReportCount(reportsByThread: Map<string, Record<string, unknown>>, activeThreadRefs: Set<string>): number {
  return [...reportsByThread.keys()].filter((threadRef) => activeThreadRefs.has(threadRef)).length;
}

function collaborationCoherenceRequiresFallback(hasCoherence: boolean, coherenceState: string | null): boolean {
  if (!hasCoherence) return false;
  return coherenceState !== "desktop_visible";
}

function collaborationDesktopUrgencyScore(baseScore: number, desktop: CodexCollaborationCockpitLane["desktop"]): number {
  if (desktop.state === "fallback_ready") return Math.max(baseScore, 88);
  if (desktop.state === "fallback_blocked") return Math.max(baseScore, 82);
  if (desktop.requiresFallback) return Math.max(baseScore, 78);
  return baseScore;
}

function collaborationLaneHasLowConfidenceDesktopEvidence(lane: CodexCollaborationCockpitLane): boolean {
  return lane.desktop.state !== "not_configured" && lane.desktop.confidence < 0.7;
}

function collaborationAttentionLevel(urgencyScore: number, reasonCodes: string[]): OperatingUrgency {
  if (reasonCodes.includes("watcher_triggered") || urgencyScore >= 90) return "critical";
  if (urgencyScore >= 70) return "high";
  if (urgencyScore >= 35) return "medium";
  return "low";
}

function cockpitInboxItemAttentionLevel(item: CockpitInboxItem): OperatingUrgency {
  return collaborationAttentionLevel(item.urgencyScore, item.reasonCodes);
}

function compareOperatingUrgency(left: OperatingUrgency, right: OperatingUrgency): number {
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return rank[left] - rank[right];
}

function collaborationLaneNeedsApproval(lane: CodexCollaborationCockpitLane): boolean {
  return lane.sessionState === "needs_approval"
    || lane.reasonCodes.includes("approval_needed")
    || lane.nextAction.requiresApproval
    || lane.nextAction.kind === "approve"
    || collaborationReasonRequestsApproval(lane.nextAction.reason);
}

function collaborationLaneHasSessionApprovalBoundary(lane: CodexCollaborationCockpitLane): boolean {
  if (lane.desktop.state === "fallback_ready" || lane.desktop.state === "fallback_blocked") return false;
  return lane.sessionState === "needs_approval"
    || lane.card.reasonCodes.includes("approval_needed")
    || lane.card.nextAction.kind === "approve"
    || lane.card.nextAction.requiresApproval === true
    || collaborationReasonRequestsApproval(lane.card.nextAction.reason);
}

function collaborationDesktopActionApprovalReasons(lane: CodexCollaborationCockpitLane): string[] {
  return collaborationLaneNeedsApproval(lane) ? ["approval_required"] : [];
}

function collaborationReasonRequestsApproval(reason: string): boolean {
  const normalized = normalizedMetadataValue(reason);
  if (!normalized.includes("approval")) return false;
  if (
    /\bno approval (?:needed|required|necessary)\b/.test(normalized) ||
    /\bapproval (?:not needed|not required|is not needed|is not required|isnt needed|isnt required|isn't needed|isn't required)\b/.test(normalized) ||
    /\bdoes not require approval\b/.test(normalized) ||
    /\bapproval optional\b/.test(normalized)
  ) {
    return false;
  }
  return true;
}

function collaborationDesktopReasonCodes(coherence: Record<string, unknown> | null, fallback: Record<string, unknown> | null): string[] {
  const fallbackDetails = isObjectRecord(fallback?.fallback) ? fallback.fallback : null;
  return unique([
    ...collaborationStringArray(coherence?.reasonCodes, 120).map(collaborationPublicSafeReasonCode).filter((code): code is string => Boolean(code)),
    ...collaborationStringArray(coherence?.blockers, 120).map(collaborationPublicSafeBlocker).filter((blocker): blocker is string => Boolean(blocker)),
    ...(collaborationString(fallbackDetails?.reason, 120) ? [collaborationPublicSafeReasonCode(collaborationString(fallbackDetails?.reason, 120)!)].filter((code): code is string => Boolean(code)) : []),
    ...(fallback ? ["desktop_fallback_report_present"] : []),
    ...(coherence ? ["desktop_coherence_report_present"] : [])
  ]);
}

function collaborationLaneComparator(left: CodexCollaborationCockpitLane, right: CodexCollaborationCockpitLane): number {
  const urgencyCompare = compareOperatingUrgency(left.attention.level, right.attention.level);
  if (urgencyCompare !== 0) return urgencyCompare;
  if (left.attention.urgencyScore !== right.attention.urgencyScore) return right.attention.urgencyScore - left.attention.urgencyScore;
  const updatedAtCompare = compareUpdatedAtDesc(left.card.freshness.lastEventAt, right.card.freshness.lastEventAt);
  if (updatedAtCompare !== 0) return updatedAtCompare;
  return left.threadId.localeCompare(right.threadId);
}

function collaborationString(value: unknown, maxChars: number): string | null {
  return typeof value === "string" && value.trim() ? publicSafeText(value.trim(), maxChars) : null;
}

function collaborationStringArray(value: unknown, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = collaborationString(item, maxChars);
    return text ? [text] : [];
  });
}

function collaborationPublicSafeBlocker(value: string): string | null {
  return publicSafeRefLike(value, "blocker") ?? null;
}

function collaborationPublicSafeReasonCode(value: string): string | null {
  return publicSafeRefLike(value, "reason") ?? null;
}

function collaborationNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

export function createVisibleCodexSessionMap(db: LooDatabase, options: {
  visibleCodex?: VisibleCodexInput | null;
  appServerThreads?: AppServerThreadsInput | null;
  limit?: number;
  now?: string;
} = {}): VisibleCodexSessionMapReport {
  const limit = clamp(options.limit ?? 50, 1, 500);
  const cards = getRecentSessions(db, { scope: "all", limit: 500, includeCards: true }).cards;
  const cardsByThreadId = new Map(cards.map((card) => [bareCodexThreadId(card.threadId), card]));
  const cardsByTitle = groupedByNormalizedTitle(cards.map((card) => ({ title: card.title, card })));
  const appThreads = (options.appServerThreads?.threads ?? []).map(publicAppServerThreadSignal);
  const appThreadsByThreadId = new Map(appThreads.map((thread) => [thread.threadId, thread]));
  const appThreadsByTitle = groupedByNormalizedTitle(appThreads.map((thread) => ({ title: thread.titleSanitized ?? "", thread })));
  const visibleThreads = (options.visibleCodex?.threadMap?.threads ?? [])
    .map((candidate, index) => publicVisibleThreadCandidate(candidate, index));
  const items: VisibleCodexSessionMapItem[] = [];
  const seen = new Set<string>();
  const usedAppServerRefs = new Set<string>();

  for (const visible of visibleThreads) {
    const titleMatches = cardsByTitle.get(normalizedTitle(visible.titleSanitized)) ?? [];
    const appTitleMatches = appThreadsByTitle.get(normalizedTitle(visible.titleSanitized)) ?? [];
    const appThread = appTitleMatches.length === 1 ? appTitleMatches[0]!.thread : null;
    const cardFromAppThread = appThread ? cardsByThreadId.get(appThread.threadId) ?? null : null;
    const card = cardFromAppThread ?? (titleMatches.length === 1 ? titleMatches[0]!.card : null);
    const ambiguity = [
      ...(titleMatches.length > 1 && !cardFromAppThread ? ["multiple_indexed_title_matches"] : []),
      ...(appTitleMatches.length > 1 ? ["multiple_app_server_title_matches"] : []),
      ...(!card && titleMatches.length === 0 ? ["no_indexed_title_match"] : [])
    ];
    const item = visibleMapItem({
      visible,
      card,
      appThread,
      ambiguity,
      reasonCodes: [
        "visible_codex_candidate",
        ...(appThread ? ["app_server_signal"] : []),
        ...(card ? ["indexed_session_card"] : []),
        ...(cardFromAppThread && titleMatches.length > 1 ? ["resolved_duplicate_title_by_app_server_id"] : [])
      ]
    });
    items.push(item);
    seen.add(visibleMapSeenKey(item));
    if (item.appServerRef) usedAppServerRefs.add(item.appServerRef);
  }

  for (const appThread of appThreads) {
    if (usedAppServerRefs.has(appThread.appServerRef)) continue;
    const card = cardsByThreadId.get(appThread.threadId)
      ?? ((cardsByTitle.get(normalizedTitle(appThread.titleSanitized ?? "")) ?? []).length === 1
        ? (cardsByTitle.get(normalizedTitle(appThread.titleSanitized ?? "")) ?? [])[0]!.card
        : null);
    const claimedCardKey = card ? `card:${card.threadId}` : null;
    const titleMatches = appThread.titleSanitized ? cardsByTitle.get(normalizedTitle(appThread.titleSanitized)) ?? [] : [];
    const ambiguity = [
      ...(titleMatches.length > 1 ? ["multiple_indexed_title_matches"] : []),
      ...(claimedCardKey && seen.has(claimedCardKey) ? ["indexed_card_already_claimed"] : []),
      ...(!card ? ["no_visible_codex_candidate"] : [])
    ];
    const item = visibleMapItem({
      visible: null,
      card,
      appThread,
      ambiguity,
      reasonCodes: ["app_server_signal", ...(card ? ["indexed_session_card"] : [])]
    });
    items.push(item);
    seen.add(visibleMapSeenKey(item));
  }

  items.sort(visibleMapItemComparator);
  return {
    schema: "lco.visibleCodexSessionMap.v1",
    publicSafe: true,
    generatedAt: options.now ?? new Date().toISOString(),
    items: items.slice(0, limit),
    sourceCoverage: {
      indexedLco: cards.length > 0 ? "ok" : "partial",
      visibleCodex: visibleCoverage(options.visibleCodex),
      codexAppServer: options.appServerThreads?.sourceCoverage?.codexAppServer ?? "not_configured"
    },
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false
    },
    proofBoundary: "This map joins public-safe indexed session cards, sanitized visible Codex metadata, and read-only app-server thread signals. It does not read raw transcript turns, run live Codex control, mutate a GUI, enable remote control, or claim unattended operation."
  };
}

export function createCodexDesktopCoherenceReport(options: CodexDesktopCoherenceReportOptions = {}): CodexDesktopCoherenceReport {
  const targetMismatch = codexDesktopCoherenceTargetMismatch(options.threadId ?? null, options.sourceRef ?? null);
  const sourceRef = targetMismatch ? null : normalizeCodexThreadSourceRef(options.sourceRef ?? null, options.threadId ?? null);
  const threadId = options.threadId ? safeThreadId(options.threadId) : (sourceRef ? bareCodexThreadId(sourceRef) : null);
  const refreshKind = options.refreshKind ?? "none";
  const beforeMap = options.beforeMap as unknown;
  const visibleMap = options.visibleMap as unknown;
  const afterMap = options.afterMap as unknown;
  const beforeMapSupplied = beforeMap !== null && beforeMap !== undefined;
  const visibleMapSupplied = visibleMap !== null && visibleMap !== undefined;
  const afterMapSupplied = afterMap !== null && afterMap !== undefined;
  const before = beforeMapSupplied ? codexDesktopCoherenceObservation(beforeMap, sourceRef) : null;
  const currentMap = visibleMapSupplied ? visibleMap : (!beforeMapSupplied && !afterMapSupplied ? null : undefined);
  const current = currentMap !== null && currentMap !== undefined ? codexDesktopCoherenceObservation(currentMap, sourceRef) : null;
  const after = afterMapSupplied ? codexDesktopCoherenceObservation(afterMap, sourceRef) : null;
  const latest = after ?? current ?? before;
  const actionEvidence = publicCodexDesktopActionEvidence(options.actionEvidence);
  const evidenceIds = [...new Set([
    ...(before?.evidenceIds ?? []),
    ...(current?.evidenceIds ?? []),
    ...(after?.evidenceIds ?? []),
    ...(actionEvidence.evidenceId ? [actionEvidence.evidenceId] : [])
  ])];
  const ambiguous = Boolean(before?.ambiguous || current?.ambiguous || after?.ambiguous);
  const cliVisible = Boolean(before?.cliVisible || current?.cliVisible || after?.cliVisible);
  const desktopVisibleBefore = before?.desktopVisible === true;
  const desktopVisibleCurrent = current?.desktopVisible === true;
  const desktopVisibleAfter = after?.desktopVisible === true;
  const desktopVisible = desktopVisibleBefore || desktopVisibleCurrent || desktopVisibleAfter;
  const priorDesktopMiss = Boolean(
    (before && before.matchedItemCount > 0 && !before.ambiguous && !before.desktopVisible)
    || (current && current.matchedItemCount > 0 && !current.ambiguous && !current.desktopVisible)
  );
  const blockers = [
    ...(!sourceRef ? ["missing_thread_target"] : []),
    ...(targetMismatch ? ["mismatched_thread_target"] : []),
    ...([
      beforeMapSupplied && !isVisibleCodexSessionMapReport(beforeMap),
      visibleMapSupplied && !isVisibleCodexSessionMapReport(visibleMap),
      afterMapSupplied && !isVisibleCodexSessionMapReport(afterMap)
    ].some(Boolean) ? ["malformed_visible_map"] : []),
    ...(ambiguous ? ["ambiguous_desktop_join"] : []),
    ...(!latest?.mapPresent ? ["desktop_coherence_map_missing"] : []),
    ...(latest && latest.matchedItemCount === 0 ? ["target_not_found_in_visible_map"] : [])
  ];
  const state = codexDesktopCoherenceState({
    ambiguous,
    cliVisible,
    desktopVisibleBefore,
    desktopVisibleCurrent,
    desktopVisibleAfter,
    priorDesktopMiss,
    refreshKind
  });
  const visibility = codexDesktopVisibility({
    state,
    ambiguous,
    cliVisible,
    desktopVisible,
    refreshKind
  });
  const confidence = codexDesktopCoherenceConfidence({
    state,
    ambiguous,
    observations: [before, current, after].filter((item): item is CodexDesktopCoherenceObservation => item !== null)
  });
  const reasonCodes = [...new Set([
    ...codexDesktopCoherenceReasonCodes(state),
    ...(before?.reasonCodes ?? []),
    ...(current?.reasonCodes ?? []),
    ...(after?.reasonCodes ?? []),
    ...(ambiguous ? ["ambiguous_join"] : []),
    ...(cliVisible && !desktopVisible ? ["cli_direct_visible_without_desktop_proof"] : []),
    ...(desktopVisible ? ["desktop_visible_candidate"] : [])
  ])].map((reason) => publicSafeIdentifier(reason)).filter((reason): reason is string => Boolean(reason));

  return {
    schema: "lco.codexDesktopCoherence.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt: options.now ?? new Date().toISOString(),
    target: {
      threadId,
      sourceRef
    },
    state,
    visibility,
    confidence,
    observations: {
      before,
      current,
      after
    },
    refreshKind,
    actionEvidence,
    evidenceIds,
    blockers,
    reasonCodes,
    sourceCoverage: mergeCoherenceSourceCoverage(before, current, after),
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false
    },
    proofBoundary: "This report classifies public-safe evidence about whether a Codex CLI/direct-protocol/app-server thread is also visible in Codex Desktop. It does not read raw transcript turns, send or steer a Codex thread, refresh/restart/select/click/type in Codex Desktop, mutate a GUI, or prove Desktop-visible collaboration unless supplied evidence proves it.",
    nextAction: codexDesktopCoherenceNextAction(state)
  };
}

export function createPlanStatePinsReport(text: string): PlanStatePinsReport {
  const manualPins = extractMarkedBlocks(text, "manual-pin").map((block, index) => planStateManualPin(block, index));
  return {
    schema: "lco.planStatePins.v1",
    publicSafe: true,
    bootloaderOnly: true,
    manualPins,
    approvalBoundaries: extractMarkedBlocks(text, "approval-boundary").flatMap(planStateListItems).map((item) => publicSafeText(item)).filter(Boolean),
    exceptionLedger: extractMarkedBlocks(text, "exception-ledger").flatMap(planStateListItems).map((item) => publicSafeText(item)).filter(Boolean),
    ignoredStaleProse: true
  };
}

export function createGithubOperatingItemsReport(
  records: unknown[] = [],
  options: { includeGreen?: boolean; limit?: number; now?: string } = {}
): GithubOperatingItemsReport {
  const limit = clamp(options.limit ?? 100, 1, 200);
  const nowMs = timestampMillis(options.now ?? null) ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const rejected: GithubOperatingItemsReport["rejected"] = [];
  const normalized: GithubOperatingItem[] = [];
  let greenOmitted = 0;

  records.forEach((record, index) => {
    const result = githubOperatingItemFromRecord(record, index, nowMs);
    if ("rejected" in result) {
      rejected.push(result.rejected);
      return;
    }
    if (!options.includeGreen && result.item.state === "green") {
      greenOmitted += 1;
      return;
    }
    normalized.push(result.item);
  });

  const sorted = normalized.sort(githubOperatingItemComparator);
  const items = sorted.slice(0, limit);
  const limitOmitted = Math.max(0, sorted.length - items.length);
  const omittedReasons = [
    ...(greenOmitted > 0 ? ["green_default"] : []),
    ...(limitOmitted > 0 ? ["limit"] : [])
  ];
  const coverage: SourceCoverageState = records.length === 0
    ? "not_configured"
    : rejected.length > 0
      ? "partial"
      : "ok";

  return {
    schema: "lco.githubOperatingItems.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt,
    items,
    rejected,
    omitted: {
      count: greenOmitted + limitOmitted,
      reasons: omittedReasons.length ? omittedReasons : ["none"]
    },
    sourceCoverage: {
      github: coverage
    },
    actionsPerformed: {
      githubWriteRun: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false
    },
    proofBoundary: "This report normalizes caller-provided public-safe GitHub issue/PR/check records into operating-picture items. It does not call GitHub, write comments, labels, reviews, branches, releases, read raw logs or bodies, run live Codex control, or mutate a GUI."
  };
}

export function createProjectDigest(db: LooDatabase, options: OperatingDigestOptions = {}): OperatingDigest {
  const limit = clamp(options.limit ?? 20, 1, 200);
  const window = options.window ?? "today";
  const nowMs = timestampMillis(options.now ?? null) ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const windowStartMs = operatingWindowStartMs(window, nowMs);
  const sourceAuthorityProfile = options.sourceAuthorityProfile ?? createDefaultSourceAuthorityProfile();
  const codexSignals = getRecentSessions(db, { scope: "recent", limit: 200, includeCards: true, now: generatedAt }).cards.map(signalFromSessionCard);
  const githubSignals = (options.githubItems ?? []).slice(0, 100).map(signalFromGithubItem);
  const planSignals = (options.planStatePins?.manualPins ?? []).map(signalFromPlanPin);
  const signals = [...codexSignals, ...githubSignals, ...planSignals]
    .map((signal) => applySourceAuthority(signal, sourceAuthorityProfile))
    .filter((signal) => signalWithinOperatingWindow(signal, windowStartMs));
  const ranked = signals
    .map((signal) => ({ signal, card: operatingCardFromSignal(signal) }))
    .sort((left, right) => operatingCardComparator(left.card, right.card));
  const selectedEntries = ranked.slice(0, limit);
  const selected = selectedEntries.map(({ card }) => card);
  const selectedSignals = selectedEntries.map(({ signal }) => signal);
  const evidence = selectedEntries.flatMap(({ card, signal }) => evidenceCardsForOperatingCard(card, signal));
  const hasPlanStateCoverage = Boolean(
    (options.planStatePins?.manualPins.length ?? 0) > 0 ||
    (options.planStatePins?.approvalBoundaries.length ?? 0) > 0 ||
    (options.planStatePins?.exceptionLedger.length ?? 0) > 0
  );
  const sourceCoverage = {
    lco: codexSignals.length > 0 ? "ok" as const : "partial" as const,
    github: githubSignals.length > 0 ? "ok" as const : "not_configured" as const,
    plan_state: hasPlanStateCoverage ? "ok" as const : options.planStatePins ? "empty" as const : "not_configured" as const,
    notion: "not_configured" as const,
    support_control: "not_configured" as const,
    company_brain: "not_configured" as const,
    stripe: "not_configured" as const
  };
  const authorityCoverage = createAuthorityCoverage(sourceAuthorityProfile, sourceCoverage);
  return {
    schema: "lco.operatingDigest.v1",
    publicSafe: true,
    generatedAt,
    window,
    health: operatingHealth(selected),
    topAttention: selected.filter((card) => card.state === "red" || card.state === "yellow" || card.state === "unknown").slice(0, 5).map((card) => card.cardId),
    cards: selected,
    signals: selectedSignals,
    evidence,
    omitted: {
      count: Math.max(0, ranked.length - selected.length),
      reason: ranked.length > selected.length ? "limit" : "none"
    },
    sourceCoverage,
    authorityCoverage
  };
}

export function createAttentionInbox(db: LooDatabase, options: OperatingDigestOptions = {}): OperatingDigest {
  const digest = createProjectDigest(db, options);
  const cards = digest.cards.filter((card) => card.state === "red" || card.state === "yellow" || card.state === "unknown");
  return {
    ...digest,
    cards,
    topAttention: cards.slice(0, 5).map((card) => card.cardId),
    omitted: {
      count: Math.max(0, digest.cards.length - cards.length),
      reason: digest.cards.length > cards.length ? "limit" : "none"
    }
  };
}

export function createBusinessPulse(db: LooDatabase, options: OperatingDigestOptions = {}): BusinessPulseReport {
  const digest = createProjectDigest(db, options);
  return {
    schema: "lco.businessPulse.v1",
    publicSafe: true,
    question: "How is the business?",
    digest,
    sourceCoverage: digest.sourceCoverage,
    authorityCoverage: digest.authorityCoverage,
    proofBoundary: "P0 business pulse is read-only and source-covered for LCO/Codex, optional structured GitHub items, and PLAN_STATE pins only. Notion, support-control, Company Brain, and Stripe remain not_configured until separate adapters prove source-backed collection."
  };
}

type CodexThreadMapEntry = {
  threadId: string;
  title: string | null;
  summary?: string | null;
  updatedAt: string | null;
  sourcePath?: string;
  metadata: SessionMetadata;
};

function codexSessionCard(db: LooDatabase, entry: CodexThreadMapEntry, nowMs: number = Date.now()): CodexSessionCard {
  const counts = codexSessionCardCounts(db, entry.threadId, entry.metadata);
  const state = codexSessionCardState(entry);
  const presentation = codexSessionPresentation(entry);
  const reasonCodes = unique([...codexSessionReasonCodes(entry, state, counts, nowMs), ...presentation.reasonCodes]);
  const confidence = codexSessionConfidence(entry, reasonCodes);
  const risk = codexSessionRisk(entry, reasonCodes, confidence);
  const evidenceIds = [`ev_${stableId(`${entry.threadId}:session_metadata`).slice(0, 16)}`];
  return {
    schema: "lco.codex.sessionCard.v1",
    sessionId: `sess_${stableId(entry.threadId).slice(0, 16)}`,
    threadId: codexThreadRef(entry.threadId),
    title: presentation.title,
    state,
    objective: presentation.objective,
    freshness: sessionFreshness(entry.updatedAt, nowMs),
    scope: {
      repo: entry.metadata.project ? publicSafeText(entry.metadata.project, 120) : null,
      branch: null,
      gitSha: null,
      refs: unique([...entry.metadata.sourceRefs, codexThreadRef(entry.threadId)]).map((ref) => publicSafeText(ref, 180)).slice(0, 8)
    },
    risk,
    nextAction: codexSessionNextAction(entry, state, confidence, presentation.nextActionReason, presentation.lowConfidence),
    counts,
    evidenceIds,
    hidden: {
      transcriptPath: true,
      rawTranscript: true,
      secrets: true
    },
    confidence,
    reasonCodes
  };
}

function codexSessionCardCounts(db: LooDatabase, threadId: string, metadata: SessionMetadata): CodexSessionCard["counts"] {
  const toolCountRow = db.prepare("SELECT tool_call_count AS toolCallCount FROM codex_sessions WHERE thread_id = ?").get(threadId) as { toolCallCount?: number } | undefined;
  const evidence = Number(metadata.proposedPlanRefs.length > 0) + Number(metadata.finalMessageRefs.length > 0) + Number(metadata.touchedFileRefs.length > 0) + Number(metadata.sourceRefs.length > 0);
  return {
    plans: Number((db.prepare("SELECT COUNT(*) AS count FROM codex_plans WHERE thread_id = ?").get(threadId) as { count: number }).count),
    finalMessages: metadata.finalMessageRefs.length,
    toolCalls: Number(toolCountRow?.toolCallCount ?? 0),
    touchedFiles: metadata.touchedFileRefs.length || getCodexTouchedFiles(db, { threadId }).length,
    evidence
  };
}

function codexSessionCardState(entry: CodexThreadMapEntry): CodexSessionCardState {
  const status = normalizedMetadataValue(entry.metadata.status);
  const blocker = hasRealBlocker(entry.metadata.blocker);
  if (blocker && ["complete", "completed", "done", "closed", "merged"].includes(status)) return "unknown";
  if (blocker || status.includes("blocked")) return "blocked";
  if (status.includes("approval") || normalizedMetadataValue(entry.metadata.nextAction).includes("approve")) return "needs_approval";
  if (["complete", "completed", "done", "closed", "merged"].includes(status)) return "done";
  if (["paused", "waiting", "external-review-wait"].includes(status)) return "waiting";
  if (["active", "in-progress", "ready", "running"].includes(status)) return hasEvidenceRefs(entry.metadata) ? "running" : "unknown";
  return "unknown";
}

type CardPresentationCleanResult = {
  text: string;
  cleaned: boolean;
  lowConfidence: boolean;
};

type CardPresentation = {
  title: string;
  objective: string;
  nextActionReason: string;
  lowConfidence: boolean;
  reasonCodes: string[];
};

function codexSessionPresentation(entry: CodexThreadMapEntry): CardPresentation {
  const nextDirective = presentationDirectiveFields(entry.metadata.nextAction);
  const title = cleanCardPresentationText(nextDirective.title ?? entry.title ?? entry.threadId, {
    fallback: publicSafeText(entry.threadId, 160),
    maxChars: 160,
    role: "title"
  });
  const objectiveSource = nextDirective.summary
    ?? (entry.metadata.nextAction ? entry.metadata.nextAction : entry.summary ?? entry.title ?? null);
  const objective = cleanCardPresentationText(objectiveSource, {
    fallback: entry.metadata.nextAction ? "Inspect source ref." : title.text,
    maxChars: 260,
    role: "summary"
  });
  const nextAction = cleanCardPresentationText(nextDirective.next ?? nextDirective.action ?? entry.metadata.nextAction ?? entry.metadata.blocker ?? null, {
    fallback: "Inspect source ref.",
    maxChars: 220,
    role: "nextAction"
  });
  const lowConfidence = objective.lowConfidence || nextAction.lowConfidence;
  const reasonCodes = [
    title.cleaned || objective.cleaned || nextAction.cleaned ? "presentation_cleaned" : "",
    lowConfidence ? "presentation_low_confidence" : ""
  ].filter(Boolean);
  return {
    title: title.text,
    objective: objective.text,
    nextActionReason: nextAction.text,
    lowConfidence,
    reasonCodes
  };
}

function cleanCardPresentationText(value: string | null | undefined, options: { fallback: string; maxChars: number; role: "title" | "summary" | "nextAction" }): CardPresentationCleanResult {
  const fallback = publicSafeText(options.fallback, options.maxChars);
  const raw = publicSafeText(value ?? "", Math.max(options.maxChars * 3, 500));
  const withoutDirectives = raw.replace(/(?:::)?[A-Za-z0-9_-]+\{[\s\S]*?\}/g, " ");
  const fragments = withoutDirectives
    .split(/\r?\n/)
    .map((line) => cleanCardPresentationFragment(line, options.role))
    .filter((line) => line.length > 0 && !isMarkdownTableLine(line));
  const candidate = dedupePresentationSentences(fragments[0] ?? "");
  if (!usableCardPresentationText(candidate)) {
    return {
      text: fallback,
      cleaned: raw.trim() !== fallback,
      lowConfidence: true
    };
  }
  const text = publicSafeText(candidate, options.maxChars);
  return {
    text,
    cleaned: text !== publicSafeText(value ?? "", options.maxChars),
    lowConfidence: false
  };
}

function presentationDirectiveFields(value: string | null | undefined): Record<string, string> {
  const fields: Record<string, string> = {};
  const raw = publicSafeText(value ?? "", 1200);
  const directivePattern = /(?:::)?[A-Za-z0-9_-]+\{([\s\S]*?)(?:\}|$)/g;
  let directive: RegExpExecArray | null;
  while ((directive = directivePattern.exec(raw)) !== null) {
    const body = directive[1] ?? "";
    const attrPattern = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,}]+))/g;
    let attr: RegExpExecArray | null;
    while ((attr = attrPattern.exec(body)) !== null) {
      const key = normalizedDirectiveField(attr[1] ?? "");
      const fieldValue = (attr[2] ?? attr[3] ?? attr[4] ?? "").trim();
      if (key && fieldValue && !fields[key]) fields[key] = fieldValue;
    }
  }
  return fields;
}

function normalizedDirectiveField(value: string): string {
  const normalized = value.toLowerCase().replace(/[-_\s]+/g, "");
  if (normalized === "nextaction") return "next";
  if (normalized === "summary" || normalized === "title" || normalized === "next" || normalized === "action") return normalized;
  return "";
}

function cleanCardPresentationFragment(value: string, role: "title" | "summary" | "nextAction"): string {
  let text = value
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(/^(?:title|final|summary|objective|next action|next|action)\s*:\s*/i, "").trim();
  }
  const embeddedLabel = text.match(/\s(?:title|final|summary|objective|next action|next|status|priority|owner|blocker|source refs?|proposed plan refs?|final-message refs?|touched-file refs?)\s*:/i);
  if (embeddedLabel?.index && embeddedLabel.index > 0) text = text.slice(0, embeddedLabel.index).trim();
  if (role === "title") text = text.replace(/\s+(?:final|summary|next action|next)\s*:.*$/i, "").trim();
  return text;
}

function isMarkdownTableLine(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(text)) return true;
  return text.startsWith("|") && text.endsWith("|") && (text.match(/\|/g)?.length ?? 0) >= 2;
}

function dedupePresentationSentences(value: string): string {
  const sentences = value.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  if (sentences.length <= 1) return value.trim();
  return unique(sentences).join(" ").trim();
}

function usableCardPresentationText(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/(?:::)?[A-Za-z0-9_-]+\{/.test(text)) return false;
  if (isMarkdownTableLine(text)) return false;
  if ((text.match(/\|/g)?.length ?? 0) >= 2) return false;
  return /[A-Za-z0-9]{3,}/.test(text);
}

function codexSessionReasonCodes(entry: CodexThreadMapEntry, state: CodexSessionCardState, counts: CodexSessionCard["counts"], nowMs: number): string[] {
  const codes: string[] = [];
  const status = normalizedMetadataValue(entry.metadata.status);
  if (state === "blocked") codes.push("blocked");
  if (state === "needs_approval") codes.push("approval_needed");
  if (state === "waiting") codes.push("external_wait");
  if (state === "running") codes.push("running_state_signal");
  if (state === "unknown") codes.push("low_confidence");
  if (hasRealBlocker(entry.metadata.blocker) && ["complete", "completed", "done", "closed", "merged"].includes(status)) codes.push("conflicting_state");
  if (counts.evidence < 3) codes.push("missing_evidence");
  if (state === "blocked" && counts.evidence < 3 && activeScopeResidueIsStale(entry.updatedAt, nowMs)) codes.push("stale_low_confidence_blocked");
  if (sessionFreshness(entry.updatedAt, nowMs).stale) codes.push("active_stale");
  if (normalizedMetadataValue(entry.metadata.nextAction).includes("resume")) codes.push("resume_ready");
  return unique([...codes, ...codexSessionImpactReasonCodes(entry)]);
}

function codexSessionImpactReasonCodes(entry: CodexThreadMapEntry): string[] {
  const text = normalizedMetadataValue([
    entry.title,
    entry.summary,
    entry.metadata.project,
    entry.metadata.status,
    entry.metadata.priority,
    entry.metadata.blocker,
    entry.metadata.nextAction
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" "));
  const codes: string[] = [];
  const customerPattern = /\b(?:customers?|clients?|external[- ]users?|user-facing|customer-facing)\b.{0,80}\b(?:impact|incident|outage|blocked|down|cannot|can't|unable|affected|failure|risk)\b|\b(?:impact|incident|outage|blocked|failure|affected)\b.{0,80}\b(?:customers?|clients?|external[- ]users?)\b/;
  const runtimePattern = /\b(?:runtime|control-plane)\b.{0,80}\b(?:incident|outage|failure|down|blocked|unavailable|degraded|impact)\b|\b(?:incident|outage|failure|degraded|unavailable)\b.{0,80}\b(?:runtime|control-plane)\b/;
  const securityPattern = /\bsecurity\b.{0,80}\b(?:incident|impact|risk|vulnerability|breach|issue|failure|blocked)\b|\b(?:secret|credential|vulnerability)\b.{0,80}\b(?:leak|exposure|exposed|incident|risk|breach|failure)\b/;
  const productionPattern = /\b(?:production|prod|customer-facing)\s+(?:incident|outage|impact|down|failure|blocked|unavailable|degraded)\b|\b(?:incident|outage|down|failure|blocked|unavailable|degraded)\s+(?:production|prod|customer-facing)\b/;
  if (customerPattern.test(text) && !impactPhraseNegated(text, "customer")) codes.push("customer_impact");
  if (runtimePattern.test(text) && !impactPhraseNegated(text, "runtime")) codes.push("runtime_impact");
  if (securityPattern.test(text) && !impactPhraseNegated(text, "security")) codes.push("security_impact");
  if (productionPattern.test(text) && !impactPhraseNegated(text, "production")) codes.push("production_impact");
  return codes;
}

function impactPhraseNegated(text: string, kind: "customer" | "runtime" | "security" | "production"): boolean {
  const patterns = {
    customer: /\b(?:no|not|without)\s+(?:customers?|clients?|external[- ]users?|user-facing|customer-facing)\s+(?:impact|incident|outage|risk|effect)s?\b/,
    runtime: /\b(?:no|not|without)\s+(?:runtime|control-plane)\s+(?:impact|incident|outage|risk|effect|failure)s?\b/,
    security: /\b(?:no|not|without)\s+(?:security|secret|credential|vulnerability)\s+(?:impact|incident|risk|effect|leak|exposure|breach)s?\b/,
    production: /\b(?:not\s+production|no\s+(?:production|prod|customer-facing)\s+(?:impact|incident|outage|risk|effect|failure)s?)\b/
  } as const;
  return patterns[kind].test(text);
}

function codexSessionConfidence(entry: CodexThreadMapEntry, reasonCodes: string[]): number {
  let confidence = 0.92;
  if (!entry.updatedAt) confidence -= 0.1;
  if (!entry.metadata.status) confidence -= 0.12;
  if (!entry.metadata.nextAction) confidence -= 0.08;
  if (!hasEvidenceRefs(entry.metadata)) confidence -= 0.28;
  if (reasonCodes.includes("conflicting_state")) confidence -= 0.36;
  if (reasonCodes.includes("stale_low_confidence_blocked")) confidence -= 0.14;
  if (reasonCodes.includes("active_stale")) confidence -= 0.08;
  if (reasonCodes.includes("presentation_low_confidence")) confidence -= 0.22;
  return Math.max(0.2, Math.min(0.99, Number(confidence.toFixed(2))));
}

function codexSessionRisk(entry: CodexThreadMapEntry, reasonCodes: string[], confidence: number): CodexSessionCard["risk"] {
  const priority = normalizedMetadataValue(entry.metadata.priority);
  const reasons = [...reasonCodes];
  const level = priority === "urgent" || reasonCodes.includes("blocked") || reasonCodes.includes("approval_needed")
    ? "high"
    : confidence < 0.7 || priority === "high"
      ? "medium"
      : "low";
  return { level, reasons: unique(reasons) };
}

function codexSessionNextAction(entry: CodexThreadMapEntry, state: CodexSessionCardState, confidence: number, reason: string, lowConfidence: boolean): CodexSessionCard["nextAction"] {
  const next = normalizedMetadataValue(reason);
  const kind: CodexSessionCard["nextAction"]["kind"] = lowConfidence
    ? "inspect"
    : state === "needs_approval"
    ? "approve"
    : state === "blocked" || state === "unknown"
      ? "inspect"
      : next.includes("resume")
        ? "resume"
        : state === "done"
          ? "ignore"
          : "watch";
  return {
    kind,
    confidence,
    reason: publicSafeText(reason || entry.metadata.blocker || state, 220)
  };
}

function sessionFreshness(updatedAt: string | null, nowMs: number = Date.now()): CodexSessionCard["freshness"] {
  const updatedMs = timestampMillis(updatedAt);
  const ageSeconds = updatedMs === null ? null : Math.max(0, Math.round((nowMs - updatedMs) / 1000));
  return {
    lastEventAt: updatedAt,
    ageSeconds,
    stale: ageSeconds !== null && ageSeconds >= 7 * 24 * 60 * 60
  };
}

function codexSessionCardComparator(left: CodexSessionCard, right: CodexSessionCard): number {
  const riskRank = { high: 0, medium: 1, low: 2 } as const;
  const leftRank = riskRank[left.risk.level];
  const rightRank = riskRank[right.risk.level];
  if (leftRank !== rightRank) return leftRank - rightRank;
  const updatedAtCompare = compareUpdatedAtDesc(left.freshness.lastEventAt, right.freshness.lastEventAt);
  if (updatedAtCompare !== 0) return updatedAtCompare;
  return left.threadId.localeCompare(right.threadId);
}

function activeCodexSessionCardComparator(left: CodexSessionCard, right: CodexSessionCard): number {
  const scoreDelta = activeCodexSessionCardScore(right) - activeCodexSessionCardScore(left);
  if (scoreDelta !== 0) return scoreDelta;
  const updatedAtCompare = compareUpdatedAtDesc(left.freshness.lastEventAt, right.freshness.lastEventAt);
  if (updatedAtCompare !== 0) return updatedAtCompare;
  if (left.confidence !== right.confidence) return right.confidence - left.confidence;
  return left.threadId.localeCompare(right.threadId);
}

function activeCodexSessionCardScore(card: CodexSessionCard): number {
  const stateScore = {
    needs_approval: 320,
    running: 280,
    waiting: 235,
    blocked: 160,
    unknown: 80,
    done: 0
  } as const;
  const ageSeconds = card.freshness.ageSeconds;
  const freshnessScore = ageSeconds === null
    ? 0
    : ageSeconds <= 60 * 60
      ? 80
      : ageSeconds <= 24 * 60 * 60
        ? 40
        : ageSeconds <= 48 * 60 * 60
          ? 10
          : -30;
  const riskScore = card.risk.level === "high" ? 30 : card.risk.level === "medium" ? 15 : 0;
  const codeScore = card.reasonCodes.reduce((score, code) => score + ({
    approval_needed: 90,
    running_state_signal: 65,
    external_wait: 55,
    resume_ready: 50,
    customer_impact: 80,
    runtime_impact: 80,
    security_impact: 80,
    production_impact: 80,
    blocked: 30,
    low_confidence: -70,
    missing_evidence: -90,
    active_stale: -90,
    stale_low_confidence_blocked: -260,
    conflicting_state: -120
  }[code] ?? 0), 0);
  return stateScore[card.state] + freshnessScore + riskScore + codeScore + Math.round(card.confidence * 50);
}

function activeScopeResidueIsStale(updatedAt: string | null, nowMs: number = Date.now()): boolean {
  const updatedMs = timestampMillis(updatedAt);
  if (updatedMs === null) return true;
  return nowMs - updatedMs >= 18 * 60 * 60 * 1000;
}

function cockpitReasonCodes(card: CodexSessionCard): string[] {
  const actionable = card.reasonCodes.filter((code) => [
    "blocked",
    "approval_needed",
    "low_confidence",
    "active_stale",
    "resume_ready",
    "external_wait",
    "conflicting_state",
    "customer_impact",
    "runtime_impact",
    "security_impact",
    "production_impact"
  ].includes(code));
  return unique(actionable);
}

function cockpitUrgencyScore(card: CodexSessionCard, priorityOrder: string[] | undefined): number {
  const priorityRank = new Map(unique((priorityOrder ?? []).map(normalizedMetadataValue).filter(Boolean)).map((value, index) => [value, index]));
  const priority = card.risk.level === "high" ? "urgent" : card.risk.level;
  const priorityScore = Math.max(0, 20 - (priorityRank.get(priority) ?? priorityRank.size) * 4);
  const codeScore = card.reasonCodes.reduce((score, code) => score + ({
    blocked: 60,
    approval_needed: 55,
    conflicting_state: 50,
    low_confidence: 42,
    active_stale: 35,
    running_state_signal: 18,
    resume_ready: 30,
    external_wait: 25,
    customer_impact: 45,
    runtime_impact: 45,
    security_impact: 45,
    production_impact: 45,
    missing_evidence: 10,
    stale_low_confidence_blocked: -140
  }[code] ?? 0), 0);
  return codeScore + priorityScore + Math.round(card.confidence * 10);
}

function evidenceCardsForSessionCard(card: CodexSessionCard): EvidenceCard[] {
  return [{
    schema: "lco.evidenceCard.v1",
    evidenceId: card.evidenceIds[0] ?? `ev_${stableId(card.threadId).slice(0, 16)}`,
    claim: publicSafeText(`Session ${card.threadId} state is ${card.state}.`, 180),
    sourceKind: "session_metadata",
    sourceRef: card.threadId,
    observedAt: card.freshness.lastEventAt,
    excerpt: publicSafeText(`${card.title}: ${card.nextAction.reason}`, 260),
    redactions: ["paths", "tokens", "raw_transcript"],
    confidence: card.confidence
  }];
}

function groupedByNormalizedTitle<T extends { title: string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = normalizedTitle(item.title);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function publicVisibleThreadCandidate(input: VisibleCodexThreadCandidateInput, index = 0): {
  visibleId: string;
  titleSanitized: string;
  status: string | null;
  updatedLabel: string | null;
  confidence: number;
} {
  const fallbackIdentity = [
    index,
    input.title ?? "",
    input.rawTitle ?? "",
    input.status ?? "",
    input.updatedLabel ?? "",
    input.source ?? ""
  ].join("|");
  const visibleId = publicSafeText(input.visibleId || `visible-${stableId(fallbackIdentity)}`, 160);
  return {
    visibleId,
    titleSanitized: publicSafeText(input.title || input.rawTitle || "Untitled visible Codex thread", 160),
    status: input.status ? publicSafeText(input.status, 80) : null,
    updatedLabel: input.updatedLabel ? publicSafeText(input.updatedLabel, 40) : null,
    confidence: visibleConfidence(input.confidence)
  };
}

function publicAppServerThreadSignal(input: AppServerThreadSignalInput): Required<Pick<AppServerThreadSignalInput, "appServerRef" | "threadId" | "sourceRef">> & AppServerThreadSignalInput {
  const threadId = publicSafeText(input.threadId || "unknown", 160);
  return {
    appServerRef: publicSafeText(input.appServerRef || `codex_app_thread:${threadId}`, 180),
    threadId,
    titleSanitized: input.titleSanitized ? publicSafeText(input.titleSanitized, 160) : null,
    titleHash: input.titleHash ? publicSafeText(input.titleHash, 80) : null,
    status: input.status ? publicSafeText(input.status, 80) : null,
    loaded: input.loaded === true ? true : input.loaded === false ? false : null,
    loadedState: input.loadedState ?? (input.loaded === true ? "loaded" : input.loaded === false ? "not_loaded" : "not_claimed"),
    updatedAt: publicIsoTimestamp(input.updatedAt),
    sourceRef: publicSafeText(input.sourceRef || codexThreadRef(threadId), 180),
    confidence: typeof input.confidence === "number" && Number.isFinite(input.confidence) ? Math.max(0.2, Math.min(0.99, input.confidence)) : 0.72
  };
}

function visibleMapItem(input: {
  visible: ReturnType<typeof publicVisibleThreadCandidate> | null;
  card: CodexSessionCard | null;
  appThread: ReturnType<typeof publicAppServerThreadSignal> | null;
  ambiguity: string[];
  reasonCodes: string[];
}): VisibleCodexSessionMapItem {
  const exactAppServerMatch = Boolean(input.card && input.appThread && bareCodexThreadId(input.card.threadId) === input.appThread.threadId);
  const titleOnlyMatch = Boolean(input.card && !exactAppServerMatch && input.visible);
  const ambiguity = unique(input.ambiguity);
  const baseConfidence = exactAppServerMatch
    ? 0.86
    : titleOnlyMatch
      ? 0.74
      : input.card && input.appThread
        ? 0.8
        : input.card || input.appThread
          ? 0.58
          : 0.32;
  const sourceConfidence = Math.min(
    input.visible?.confidence ?? 0.72,
    input.card?.confidence ?? 0.72,
    input.appThread?.confidence ?? 0.72
  );
  const confidence = ambiguity.length > 0
    ? Math.min(0.45, Number((baseConfidence * sourceConfidence).toFixed(2)))
    : Number(Math.min(0.99, baseConfidence * sourceConfidence).toFixed(2));
  const title = input.card?.title ?? input.appThread?.titleSanitized ?? input.visible?.titleSanitized ?? "Unknown Codex thread";
  const evidenceIds = unique([
    ...(input.card?.evidenceIds ?? []),
    ...(input.visible ? [`ev_visible_${stableId(input.visible.visibleId).slice(0, 12)}`] : []),
    ...(input.appThread ? [`ev_app_server_${stableId(input.appThread.appServerRef).slice(0, 12)}`] : [])
  ]);
  return {
    desktopRef: input.visible?.visibleId ?? null,
    appServerRef: input.appThread?.appServerRef ?? null,
    sourceRef: input.card?.threadId ?? input.appThread?.sourceRef ?? null,
    titleSanitized: publicSafeText(title, 160),
    sessionCardRef: input.card?.threadId ?? null,
    confidence,
    evidenceIds,
    ambiguity,
    freshness: {
      indexedUpdatedAt: input.card?.freshness.lastEventAt ?? null,
      appServerUpdatedAt: input.appThread?.updatedAt ?? null,
      visibleUpdatedLabel: input.visible?.updatedLabel ?? null,
      freshestSource: freshestVisibleMapSource(input.card?.freshness.lastEventAt ?? null, input.appThread?.updatedAt ?? null, input.visible?.updatedLabel ?? null)
    },
    reasonCodes: unique([
      ...input.reasonCodes,
      ...(ambiguity.length ? ["ambiguous_join"] : []),
      ...(exactAppServerMatch ? ["exact_thread_id_match"] : titleOnlyMatch ? ["unique_title_match"] : [])
    ])
  };
}

function visibleMapSeenKey(item: VisibleCodexSessionMapItem): string {
  if (item.sessionCardRef) return `card:${item.sessionCardRef}`;
  if (item.appServerRef) return `app:${item.appServerRef}`;
  return `desktop:${item.desktopRef}`;
}

function visibleMapItemComparator(left: VisibleCodexSessionMapItem, right: VisibleCodexSessionMapItem): number {
  if (right.confidence !== left.confidence) return right.confidence - left.confidence;
  const freshness = compareUpdatedAtDesc(left.freshness.indexedUpdatedAt ?? left.freshness.appServerUpdatedAt, right.freshness.indexedUpdatedAt ?? right.freshness.appServerUpdatedAt);
  if (freshness !== 0) return freshness;
  return left.titleSanitized.localeCompare(right.titleSanitized) || (left.desktopRef ?? "").localeCompare(right.desktopRef ?? "");
}

function visibleCoverage(input: VisibleCodexInput | null | undefined): VisibleCodexCoverageState {
  if (!input) return "not_configured";
  if (Array.isArray(input.threadMap?.threads)) return "ok";
  return "partial";
}

function codexDesktopCoherenceObservation(
  map: unknown,
  sourceRef: string | null
): CodexDesktopCoherenceObservation {
  if (!isVisibleCodexSessionMapReport(map)) return missingCodexDesktopCoherenceObservation();
  const matched = sourceRef
    ? map.items.filter((item) => visibleMapItemMatchesTarget(item, sourceRef))
    : [];
  const ambiguous = matched.some((item) => coherenceItemHasJoinAmbiguity(item));
  const confidence = matched.length === 0 ? 0 : Math.max(...matched.map((item) => item.confidence));
  const desktopVisible = matched.some((item) => Boolean(item.desktopRef) && item.confidence >= 0.5) && !ambiguous;
  const cliVisible = matched.some((item) => Boolean(item.sourceRef || item.appServerRef || item.sessionCardRef)) && !ambiguous;
  return {
    mapPresent: true,
    matchedItemCount: matched.length,
    cliVisible,
    desktopVisible,
    ambiguous,
    confidence: Number(confidence.toFixed(2)),
    evidenceIds: unique(matched.flatMap((item) => item.evidenceIds)).map((value) => publicSafeRefLike(value, "evidence")).filter((value): value is string => Boolean(value)).slice(0, 20),
    sourceRefs: unique(matched.flatMap((item) => [item.sourceRef, item.sessionCardRef].filter((value): value is string => typeof value === "string"))).map((value) => publicSafeRefLike(value, "source")).filter((value): value is string => Boolean(value)).slice(0, 20),
    appServerRefs: unique(matched.map((item) => item.appServerRef).filter((value): value is string => typeof value === "string")).map((value) => publicSafeRefLike(value, "app")).filter((value): value is string => Boolean(value)).slice(0, 20),
    desktopRefs: unique(matched.map((item) => item.desktopRef).filter((value): value is string => typeof value === "string")).map((value) => publicSafeRefLike(value, "desktop")).filter((value): value is string => Boolean(value)).slice(0, 20),
    reasonCodes: unique(matched.flatMap((item) => item.reasonCodes)).filter((reason) =>
      reason !== "ambiguous_join" || matched.some((item) => coherenceItemHasJoinAmbiguity(item))
    ).map(publicSafeIdentifier).filter((reason): reason is string => Boolean(reason)),
    sourceCoverage: map.sourceCoverage
  };
}

function missingCodexDesktopCoherenceObservation(): CodexDesktopCoherenceObservation {
  return {
    mapPresent: false,
    matchedItemCount: 0,
    cliVisible: false,
    desktopVisible: false,
    ambiguous: false,
    confidence: 0,
    evidenceIds: [],
    sourceRefs: [],
    appServerRefs: [],
    desktopRefs: [],
    reasonCodes: ["visible_map_unavailable"],
    sourceCoverage: {
      indexedLco: "partial",
      visibleCodex: "partial",
      codexAppServer: "partial"
    }
  };
}

function isVisibleCodexSessionMapReport(value: unknown): value is VisibleCodexSessionMapReport {
  if (!isObjectRecord(value)) return false;
  if (value.schema !== "lco.visibleCodexSessionMap.v1" && value.schema !== undefined) return false;
  if (!Array.isArray(value.items)) return false;
  if (!isObjectRecord(value.sourceCoverage)) return false;
  return value.items.every((item) => isObjectRecord(item) && Array.isArray(item.evidenceIds) && Array.isArray(item.ambiguity) && Array.isArray(item.reasonCodes));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coherenceItemHasJoinAmbiguity(item: VisibleCodexSessionMapItem): boolean {
  return item.ambiguity.some((reason) =>
    reason.startsWith("multiple_")
    || reason === "indexed_card_already_claimed"
  );
}

function publicSafeRefLike(value: string, prefix: string): string | null {
  const identifier = looksSensitiveRefLike(value) ? null : publicSafeIdentifier(value);
  if (identifier) return identifier;
  const redacted = publicSafeText(value, 160).trim();
  return redacted ? `${prefix}_${stableId(redacted).slice(0, 16)}` : null;
}

function publicSafeWatcherIdentifier(value: string, prefix: string): string {
  const raw = String(value ?? "");
  const identifier = looksSensitiveRefLike(raw) ? null : publicSafeIdentifier(raw);
  if (identifier) return identifier;
  const redacted = publicSafeText(raw, 160).trim() || raw.trim() || prefix;
  return `${prefix}_${stableId(redacted).slice(0, 16)}`;
}

function publicSafeWatcherTargetRef(value: string): string {
  return publicSafeRefLike(value || "unknown", "target") ?? `target_${stableId(value || "unknown").slice(0, 16)}`;
}

function watcherSpecLookupKey(watchId: string, targetRef: string): string {
  return `${watchId}\u0000${targetRef}`;
}

function publicSafeWatcherTimestamp(value: string, prefix: string): string {
  const raw = String(value ?? "");
  const iso = looksSensitiveRefLike(raw) ? null : publicIsoTimestamp(raw);
  if (iso) return iso;
  return publicSafeWatcherIdentifier(raw, prefix);
}

function publicSafeWatcherText(value: string, maxChars: number, prefix: string): string {
  const raw = String(value ?? "");
  if (looksSensitiveRefLike(raw)) return publicSafeWatcherIdentifier(raw, prefix);
  return publicSafeText(raw, maxChars);
}

function publicSafeCoherenceState(value: unknown): CodexDesktopCoherenceState {
  return value === "cli_visible"
    || value === "desktop_visible"
    || value === "desktop_refresh_required"
    || value === "desktop_restart_required"
    || value === "unknown"
    ? value
    : "unknown";
}

function looksSensitiveRefLike(value: string): boolean {
  return /(?:^|[^A-Za-z0-9])(npm_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|xox[baprs]-[A-Za-z0-9-]{10,})/.test(value)
    || value.includes("/")
    || value.includes("\\");
}

function visibleMapItemMatchesTarget(item: VisibleCodexSessionMapItem, sourceRef: string): boolean {
  const threadId = bareCodexThreadId(sourceRef);
  return item.sourceRef === sourceRef
    || item.sessionCardRef === sourceRef
    || item.appServerRef === `codex_app_thread:${threadId}`;
}

function normalizeCodexThreadSourceRef(sourceRef: string | null, threadId: string | null): string | null {
  if (sourceRef && /^codex_thread:[A-Za-z0-9._:-]+$/.test(sourceRef)) return sourceRef;
  if (threadId) return codexThreadRef(safeThreadId(threadId));
  return null;
}

function codexDesktopCoherenceTargetMismatch(threadId: string | null, sourceRef: string | null): boolean {
  if (!threadId || !sourceRef || !/^codex_thread:[A-Za-z0-9._:-]+$/.test(sourceRef)) return false;
  return safeThreadId(threadId) !== bareCodexThreadId(sourceRef);
}

function safeThreadId(value: string): string {
  const trimmed = value.startsWith("codex_thread:") ? value.slice("codex_thread:".length) : value;
  const safe = publicSafeText(trimmed, 120).replace(/[^A-Za-z0-9._:-]+/g, "");
  return safe || `thread_${stableId(trimmed).slice(0, 16)}`;
}

function publicCodexDesktopActionEvidence(input: Record<string, unknown> | null | undefined): CodexDesktopCoherenceActionEvidence {
  const actionKind = optionalActionKind(input?.actionKind ?? input?.action_kind);
  const action = typeof input?.action === "string" ? publicSafeActionText(input.action) : null;
  const evidenceId = typeof input?.evidenceId === "string"
    ? publicSafeRefLike(input.evidenceId, "evidence")
    : typeof input?.evidence_id === "string"
      ? publicSafeRefLike(input.evidence_id, "evidence")
      : null;
  const approvalAuditId = typeof input?.approvalAuditId === "string"
    ? input.approvalAuditId
    : typeof input?.approval_audit_id === "string"
      ? input.approval_audit_id
      : null;
  const observedAt = publicIsoTimestamp(
    typeof input?.observedAt === "string"
      ? input.observedAt
      : typeof input?.observed_at === "string"
        ? input.observed_at
        : null
  );
  return {
    actionKind,
    action,
    dryRun: typeof input?.dryRun === "boolean" ? input.dryRun : typeof input?.dry_run === "boolean" ? input.dry_run : null,
    live: typeof input?.live === "boolean" ? input.live : null,
    approvalAuditIdPresent: Boolean(approvalAuditId),
    evidenceId,
    observedAt
  };
}

function publicSafeActionText(value: string): string | null {
  const redacted = publicSafeText(value, 120).trim();
  if (!redacted) return null;
  return looksSensitiveRefLike(value) ? `action_${stableId(redacted).slice(0, 16)}` : redacted;
}

function optionalActionKind(value: unknown): CodexDesktopCoherenceActionEvidence["actionKind"] {
  return value === "cli"
    || value === "direct_protocol"
    || value === "codex_app_server"
    || value === "lco_control"
    || value === "none"
    ? value
    : "unknown";
}

function codexDesktopCoherenceState(input: {
  ambiguous: boolean;
  cliVisible: boolean;
  desktopVisibleBefore: boolean;
  desktopVisibleCurrent: boolean;
  desktopVisibleAfter: boolean;
  priorDesktopMiss: boolean;
  refreshKind: CodexDesktopCoherenceReport["refreshKind"];
}): CodexDesktopCoherenceState {
  if (input.ambiguous) return "unknown";
  if (input.desktopVisibleBefore || input.desktopVisibleCurrent) return "desktop_visible";
  if (input.desktopVisibleAfter && input.refreshKind === "desktop_refresh" && input.priorDesktopMiss) return "desktop_refresh_required";
  if (input.desktopVisibleAfter && input.refreshKind === "desktop_restart" && input.priorDesktopMiss) return "desktop_restart_required";
  if (input.desktopVisibleAfter) return "desktop_visible";
  if (input.cliVisible) return "cli_visible";
  return "unknown";
}

function codexDesktopVisibility(input: {
  state: CodexDesktopCoherenceState;
  ambiguous: boolean;
  cliVisible: boolean;
  desktopVisible: boolean;
  refreshKind: CodexDesktopCoherenceReport["refreshKind"];
}): CodexDesktopCoherenceReport["visibility"] {
  if (input.ambiguous) return { cli: "ambiguous", desktop: "ambiguous" };
  const cli = input.cliVisible ? "proven" : "unknown";
  if (input.state === "desktop_refresh_required") return { cli, desktop: "refresh_required" };
  if (input.state === "desktop_restart_required") return { cli, desktop: "restart_required" };
  if (input.desktopVisible) return { cli, desktop: "proven" };
  if (input.state === "cli_visible") return { cli, desktop: "not_seen" };
  return { cli, desktop: "unknown" };
}

function codexDesktopCoherenceConfidence(input: {
  state: CodexDesktopCoherenceState;
  ambiguous: boolean;
  observations: CodexDesktopCoherenceObservation[];
}): number {
  if (input.ambiguous) return 0.3;
  const max = input.observations.length ? Math.max(...input.observations.map((item) => item.confidence)) : 0;
  if (input.state === "desktop_visible") return Number(Math.max(0.75, max).toFixed(2));
  if (input.state === "desktop_refresh_required" || input.state === "desktop_restart_required") return Number(Math.max(0.68, max).toFixed(2));
  if (input.state === "cli_visible") return Number(Math.max(0.62, max).toFixed(2));
  return Number(Math.min(0.4, max || 0.2).toFixed(2));
}

function codexDesktopCoherenceReasonCodes(state: CodexDesktopCoherenceState): string[] {
  if (state === "desktop_visible") return ["desktop_visible_without_refresh"];
  if (state === "desktop_refresh_required") return ["desktop_visible_after_refresh_only"];
  if (state === "desktop_restart_required") return ["desktop_visible_after_restart_only"];
  if (state === "cli_visible") return ["cli_or_direct_protocol_visible"];
  return ["desktop_coherence_unknown"];
}

function mergeCoherenceSourceCoverage(
  before: CodexDesktopCoherenceObservation | null,
  current: CodexDesktopCoherenceObservation | null,
  after: CodexDesktopCoherenceObservation | null
): CodexDesktopCoherenceReport["sourceCoverage"] {
  const observations = [before, current, after].filter((item): item is CodexDesktopCoherenceObservation => item !== null);
  return {
    indexedLco: strongestCoverage(observations.map((item) => item.sourceCoverage.indexedLco)),
    visibleCodex: strongestCoverage(observations.map((item) => item.sourceCoverage.visibleCodex)),
    codexAppServer: strongestCoverage(observations.map((item) => item.sourceCoverage.codexAppServer))
  };
}

function strongestCoverage(values: VisibleCodexCoverageState[]): VisibleCodexCoverageState {
  if (values.includes("ok")) return "ok";
  if (values.includes("partial")) return "partial";
  if (values.includes("unavailable")) return "unavailable";
  return "not_configured";
}

function codexDesktopCoherenceNextAction(state: CodexDesktopCoherenceState): string {
  if (state === "desktop_visible") return "Desktop visibility is proven by supplied public-safe map evidence; do not treat this as GUI mutation approval.";
  if (state === "desktop_refresh_required") return "Record the safe Desktop refresh flow before claiming live visible collaboration.";
  if (state === "desktop_restart_required") return "Route the live-refresh gap to the desktop fallback lane before claiming same-session Desktop collaboration.";
  if (state === "cli_visible") return "CLI/direct/app-server visibility is proven, but Desktop visibility is not; gather visible Codex evidence or route #308 fallback proof.";
  return "Gather a public-safe visible Codex map and app-server signal for the target thread before making a Desktop-visible collaboration claim.";
}

function publicSafeIdentifier(value: string): string | null {
  const redacted = publicSafeText(value, 160).trim();
  return /^[A-Za-z0-9._:-]{1,160}$/.test(redacted) ? redacted : null;
}

function visibleConfidence(value: VisibleCodexThreadCandidateInput["confidence"]): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0.2, Math.min(0.99, value));
  if (value === "high") return 0.9;
  if (value === "medium") return 0.72;
  if (value === "low") return 0.48;
  return 0.6;
}

function normalizedTitle(value: string | null | undefined): string {
  return publicSafeText(value ?? "", 180).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function publicIsoTimestamp(value: string | null | undefined): string | null {
  const parsed = timestampMillis(typeof value === "string" ? value : null);
  return parsed === null ? null : new Date(parsed).toISOString();
}

function freshestVisibleMapSource(indexedUpdatedAt: string | null, appServerUpdatedAt: string | null, visibleUpdatedLabel: string | null): VisibleCodexSessionMapItem["freshness"]["freshestSource"] {
  const indexed = timestampMillis(indexedUpdatedAt);
  const appServer = timestampMillis(appServerUpdatedAt);
  if (indexed !== null || appServer !== null) {
    if (indexed !== null && (appServer === null || indexed >= appServer)) return "indexed_lco";
    return "codex_app_server";
  }
  return visibleUpdatedLabel ? "visible_codex" : "unknown";
}

function touchedPathMatches(db: LooDatabase, threadRef: string, needle: string): boolean {
  const threadId = bareCodexThreadId(threadRef);
  return getCodexTouchedFiles(db, { threadId }).some((path) => path.toLowerCase().includes(needle));
}

function extractMarkedBlocks(text: string, marker: string): string[] {
  const pattern = new RegExp(`<!--\\s*loo:${escapeRegExp(marker)}\\s*-->([\\s\\S]*?)<!--\\s*/loo:${escapeRegExp(marker)}\\s*-->`, "gi");
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) blocks.push(match[1] ?? "");
  return blocks;
}

function planStateManualPin(block: string, index: number): PlanStateManualPin {
  const fields = planStateFields(block);
  const title = fields.project || fields.title || `manual-pin-${index + 1}`;
  const state = operatingState(fields.state || fields.status || "unknown");
  return {
    pinId: `pin_${stableId(`${title}:${index}:${block}`).slice(0, 16)}`,
    title: publicSafeText(title, 120),
    state,
    summary: publicSafeText(fields.summary || fields.note || "Manual pin has no summary.", 260),
    nextAction: publicSafeText(fields.next || fields["next action"] || "Inspect manual pin.", 220),
    sourceRef: publicSafeText(fields.source || `plan_state:manual_pin:${index + 1}`, 160)
  };
}

function planStateFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.trim().match(/^-?\s*([^:]{1,60}):\s*(.+)$/);
    if (!match) continue;
    fields[match[1]!.trim().toLowerCase()] = match[2]!.trim();
  }
  return fields;
}

function planStateListItems(block: string): string[] {
  return block.split(/\r?\n/)
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter((line) => line.length > 0);
}

function signalFromSessionCard(card: CodexSessionCard): OperatingSignal {
  const impactCodes = new Set(["customer_impact", "runtime_impact", "security_impact", "production_impact"]);
  const hasImpact = card.state !== "done" && card.reasonCodes.some((code) => impactCodes.has(code));
  const state: OperatingState = card.state === "blocked"
    ? "red"
    : card.state === "unknown" || card.state === "needs_approval" || card.state === "waiting" || hasImpact
      ? "yellow"
      : "green";
  const urgency: OperatingUrgency = card.risk.level === "high" ? "high" : card.risk.level === "medium" ? "medium" : "low";
  return {
    schema: "lco.operatingSignal.v1",
    signalId: `sig_${stableId(card.threadId).slice(0, 16)}`,
    sourceKind: "codex",
    sourceRef: card.threadId,
    observedAt: card.freshness.lastEventAt,
    subject: {
      kind: "codex_session",
      id: card.threadId,
      title: card.title
    },
    state,
    urgency,
    reasonCodes: card.reasonCodes,
    summary: publicSafeText(card.objective, 260),
    nextAction: {
      kind: card.nextAction.kind === "approve" ? "approve" : card.nextAction.kind === "resume" ? "resume" : card.nextAction.kind === "ignore" ? "ignore" : "inspect",
      text: publicSafeText(card.nextAction.reason, 220),
      requiresApproval: card.nextAction.kind === "approve" || card.nextAction.kind === "resume"
    },
    confidence: card.confidence,
    evidenceIds: card.evidenceIds
  };
}

function signalFromGithubItem(item: GithubOperatingItem): OperatingSignal {
  const state = operatingState(item.state ?? "unknown");
  const urgency = operatingUrgency(item.urgency ?? (state === "red" ? "high" : state === "yellow" ? "medium" : "low"));
  const sourceRef = `github:${publicSafeText(item.id, 180)}`;
  const subjectKind = item.kind ?? (item.id.includes("#") ? "issue" : "repo");
  return {
    schema: "lco.operatingSignal.v1",
    signalId: `sig_${stableId(sourceRef).slice(0, 16)}`,
    sourceKind: "github",
    sourceRef,
    observedAt: item.updatedAt ?? null,
    subject: {
      kind: subjectKind,
      id: publicSafeText(item.id, 180),
      title: publicSafeText(item.title, 180)
    },
    state,
    urgency,
    reasonCodes: unique((item.reasonCodes ?? ["review_requested"]).map((code) => publicSafeText(code, 80))),
    summary: publicSafeText(item.title, 260),
    nextAction: {
      kind: "inspect",
      text: publicSafeText(item.nextAction || "Inspect GitHub item.", 220),
      requiresApproval: false
    },
    confidence: typeof item.confidence === "number" ? Math.max(0.2, Math.min(0.99, item.confidence)) : 0.86,
    evidenceIds: [`ev_${stableId(`${sourceRef}:github`).slice(0, 16)}`]
  };
}

function githubOperatingItemFromRecord(
  value: unknown,
  index: number,
  nowMs: number
): { item: GithubOperatingItem } | { rejected: GithubOperatingItemsReport["rejected"][number] } {
  if (!githubRecord(value)) return { rejected: { index, reason: "invalid_record" } };
  const id = githubOperatingId(value);
  if (!id) return { rejected: { index, reason: "missing_id" } };
  const title = publicSafeText(githubString(value.title) ?? "");
  if (!title) return { rejected: { index, reason: "missing_title" } };
  const kind = githubOperatingKind(value);
  const updatedAt = publicIsoTimestamp(githubString(value.updatedAt ?? value.updated_at ?? value.updatedAtIso ?? value.updated_at_iso) ?? null);
  const reasonCodes = githubReasonCodes(value, kind, updatedAt, nowMs);
  const state = githubOperatingState(value, reasonCodes);
  const urgency = state === "red" ? "high" : state === "yellow" || state === "unknown" ? "medium" : "low";
  const confidence = reasonCodes.includes("low_confidence")
    ? 0.48
    : reasonCodes.includes("checks_unknown")
      ? 0.64
      : reasonCodes.includes("stale")
        ? 0.74
        : 0.88;
  return {
    item: {
      id,
      title,
      kind,
      state,
      urgency,
      reasonCodes,
      updatedAt,
      nextAction: githubNextAction(id, state, reasonCodes),
      confidence
    }
  };
}

function githubOperatingId(record: Record<string, unknown>): string | null {
  const repo = githubRepoName(record);
  const number = githubIssueNumber(record);
  if (repo && number && /^[0-9]+$/.test(number)) return `${repo}#${number}`;
  const direct = githubString(record.id ?? record.sourceRef ?? record.source_ref);
  if (direct && actionableGithubRef(direct)) return publicSafeText(direct.replace(/^github:/i, ""), 180);
  return null;
}

function githubRepoName(record: Record<string, unknown>): string | null {
  const direct = githubString(record.repo ?? record.repository ?? record.nameWithOwner ?? record.name_with_owner);
  if (direct && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(direct)) return publicSafeText(direct, 140);
  const owner = githubString(record.owner);
  const name = githubString(record.repoName ?? record.repo_name ?? record.repositoryName ?? record.repository_name);
  if (owner && name && /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+$/.test(name)) return `${owner}/${name}`;
  return githubRefFromUrl(record)?.repo ?? null;
}

function githubIssueNumber(record: Record<string, unknown>): string | null {
  const direct = githubString(record.number ?? record.issueNumber ?? record.issue_number ?? record.pullRequestNumber ?? record.pull_request_number);
  if (direct && /^[0-9]+$/.test(direct)) return direct;
  return githubRefFromUrl(record)?.number ?? null;
}

function githubRefFromUrl(record: Record<string, unknown>): { repo: string; number: string; kind: GithubOperatingItem["kind"] } | null {
  const rawUrl = githubString(record.url ?? record.html_url ?? record.permalink ?? record.webUrl ?? record.web_url);
  if (!rawUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!["github.com", "www.github.com"].includes(parsed.hostname.toLowerCase())) return null;
  const match = parsed.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(pull|issues)\/([0-9]+)(?:\/|$)/);
  if (!match) return null;
  return {
    repo: `${match[1]}/${match[2]}`,
    number: match[4],
    kind: match[3] === "pull" ? "pr" : "issue"
  };
}

function actionableGithubRef(value: string): boolean {
  return /^(?:github:)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[0-9]+$/i.test(value);
}

function hasPullRequestNumber(record: Record<string, unknown>): boolean {
  return githubIssueNumber({ pullRequestNumber: record.pullRequestNumber ?? record.pull_request_number }) !== null;
}

function githubUrlKind(record: Record<string, unknown>): GithubOperatingItem["kind"] | null {
  return githubRefFromUrl(record)?.kind ?? null;
}

function githubCheckRecords(record: Record<string, unknown>): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  collectGithubCheckRecords(record, records, new Set(), 0);
  return records;
}

const GITHUB_CHECK_CONTAINER_KEYS = [
  "checks",
  "statusCheckRollup",
  "status_check_rollup",
  "checkRuns",
  "check_runs",
  "checkSuites",
  "check_suites",
  "statusContexts",
  "status_contexts",
  "contexts",
  "nodes",
  "edges",
  "node"
] as const;

function collectGithubCheckRecords(
  value: unknown,
  records: Record<string, unknown>[],
  seen: Set<Record<string, unknown>>,
  depth: number
): void {
  if (depth > 6) return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectGithubCheckRecords(entry, records, seen, depth + 1));
    return;
  }
  if (!githubRecord(value)) return;
  if (githubDirectCheckRecord(value) && !seen.has(value)) {
    seen.add(value);
    records.push(value);
  }
  for (const key of GITHUB_CHECK_CONTAINER_KEYS) {
    const child = value[key];
    if (child !== undefined) collectGithubCheckRecords(child, records, seen, depth + 1);
  }
}

function githubDirectCheckRecord(record: Record<string, unknown>): boolean {
  const typename = normalizedMetadataValue(githubString(record.__typename) ?? "");
  if (["checkrun", "statuscontext", "checksuite", "check_run", "status_context", "check_suite"].includes(typename)) return true;
  if ([
    "status",
    "checkStatus",
    "check_status",
    "conclusion",
    "checkConclusion",
    "check_conclusion",
    "bucket"
  ].some((key) => githubString(record[key]) !== null)) return true;
  const state = normalizedMetadataValue(githubString(record.state) ?? "");
  if (state && githubCheckStateLikeValue(state)) return true;
  return [
    "failing",
    "failed",
    "pending",
    "failureCount",
    "failure_count",
    "pendingCount",
    "pending_count"
  ].some((key) => githubNumber(record[key]) !== null);
}

function githubCheckValues(checks: Record<string, unknown>): string[] {
  return [
    checks.status,
    checks.checkStatus,
    checks.check_status,
    checks.conclusion,
    checks.checkConclusion,
    checks.check_conclusion,
    checks.state,
    checks.bucket
  ]
    .map((value) => normalizedMetadataValue(githubString(value) ?? ""))
    .filter(Boolean);
}

function githubCheckStateLikeValue(value: string): boolean {
  return githubFailedCheckValue(value) || githubPendingCheckValue(value) || githubSuccessfulCheckValue(value) || ["completed"].includes(value);
}

function githubFailedCheckValue(value: string): boolean {
  return ["failure", "failed", "error", "timed_out", "cancelled", "action_required", "startup_failure", "stale", "fail", "red"].includes(value);
}

function githubPendingCheckValue(value: string): boolean {
  return ["queued", "in_progress", "pending", "neutral_pending", "requested", "waiting", "expected"].includes(value);
}

function githubSuccessfulCheckValue(value: string): boolean {
  return ["success", "successful", "passed", "pass", "neutral", "skipped", "green"].includes(value);
}

function githubCheckCount(checks: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = githubNumber(checks[key]);
    if (value !== null) return value;
  }
  return null;
}

function githubOperatingKind(record: Record<string, unknown>): GithubOperatingItem["kind"] {
  const raw = normalizedMetadataValue(githubString(record.type ?? record.kind ?? record.__typename) ?? "");
  if (["pull_request", "pullrequest", "pr"].includes(raw)) return "pr";
  if (["issue"].includes(raw)) return "issue";
  if (hasPullRequestNumber(record)) return "pr";
  const urlKind = githubUrlKind(record);
  if (urlKind) return urlKind;
  return githubOperatingId(record)?.includes("#") ? "issue" : "repo";
}

function githubReasonCodes(
  record: Record<string, unknown>,
  kind: GithubOperatingItem["kind"],
  updatedAt: string | null,
  nowMs: number
): string[] {
  const codes = [
    kind === "pr" ? "pr_open" : kind === "issue" ? "issue_open" : "repo_signal"
  ];
  const state = normalizedMetadataValue(githubString(record.state) ?? "");
  const checkRecords = githubCheckRecords(record);
  const hasChecks = githubHasCheckData(checkRecords);
  const checksFailed = githubChecksFailed(checkRecords);
  const checksPending = githubChecksPending(checkRecords);
  const checksPassed = hasChecks && !checksFailed && !checksPending && githubChecksPassed(checkRecords);
  if (state === "closed") codes.push("closed");
  if (githubBoolean(record.merged) || state === "merged") codes.push("merged");
  if (checksFailed) codes.push("ci_failed");
  if (checksPending) codes.push("checks_pending");
  if (kind === "pr" && checksPassed) codes.push("checks_passed");
  if (kind === "pr" && state === "open" && !checksFailed && !checksPending && !checksPassed) codes.push("checks_unknown");
  const reviewDecision = normalizedMetadataValue(githubString(record.reviewDecision ?? record.review_decision) ?? "");
  if (reviewDecision === "changes_requested") codes.push("changes_requested");
  if (reviewDecision === "review_required" || githubBoolean(record.reviewRequested ?? record.review_requested)) codes.push("review_requested");
  if (githubBoolean(record.draft)) codes.push("draft");
  const ageMs = updatedAt ? nowMs - (timestampMillis(updatedAt) ?? nowMs) : 0;
  if (ageMs >= 7 * 24 * 60 * 60 * 1000 && !codes.includes("merged") && !codes.includes("closed")) codes.push("stale");
  if (!updatedAt) codes.push("low_confidence");
  return unique(codes.map((code) => publicSafeText(code, 80)));
}

function githubOperatingState(record: Record<string, unknown>, reasonCodes: string[]): OperatingState {
  const rawState = normalizedMetadataValue(githubString(record.state) ?? "");
  if (reasonCodes.includes("ci_failed") || reasonCodes.includes("changes_requested")) return "red";
  if (reasonCodes.includes("checks_pending") || reasonCodes.includes("review_requested") || reasonCodes.includes("stale") || reasonCodes.includes("draft")) return "yellow";
  if (reasonCodes.includes("merged") || rawState === "closed") return "green";
  if (reasonCodes.includes("checks_passed")) return "green";
  if (rawState === "open") return "yellow";
  return "unknown";
}

function githubHasCheckData(checkRecords: Record<string, unknown>[]): boolean {
  return checkRecords.length > 0;
}

function githubChecksFailed(checkRecords: Record<string, unknown>[]): boolean {
  return checkRecords.some((checks) => {
    const failing = githubCheckCount(checks, ["failing", "failed", "failureCount", "failure_count"]);
    return githubCheckValues(checks).some(githubFailedCheckValue) || (failing ?? 0) > 0;
  });
}

function githubChecksPending(checkRecords: Record<string, unknown>[]): boolean {
  return checkRecords.some((checks) => {
    const pending = githubCheckCount(checks, ["pending", "pendingCount", "pending_count"]);
    return githubCheckValues(checks).some(githubPendingCheckValue) || (pending ?? 0) > 0;
  });
}

function githubChecksPassed(checkRecords: Record<string, unknown>[]): boolean {
  return checkRecords.length > 0 && checkRecords.every(githubCheckPassed);
}

function githubCheckPassed(checks: Record<string, unknown>): boolean {
  const values = githubCheckValues(checks);
  if (values.some(githubFailedCheckValue) || values.some(githubPendingCheckValue)) return false;
  if (values.some(githubSuccessfulCheckValue)) return true;
  const total = githubCheckCount(checks, ["total", "totalCount", "total_count", "checkCount", "check_count"]);
  const failingRaw = githubCheckCount(checks, ["failing", "failed", "failureCount", "failure_count"]);
  const pendingRaw = githubCheckCount(checks, ["pending", "pendingCount", "pending_count"]);
  const failing = failingRaw ?? 0;
  const pending = pendingRaw ?? 0;
  return total !== null && total > 0 && failingRaw !== null && pendingRaw !== null && failing === 0 && pending === 0;
}

function githubNextAction(id: string, state: OperatingState, reasonCodes: string[]): string {
  if (reasonCodes.includes("ci_failed")) return `Inspect failing GitHub checks for ${id}.`;
  if (reasonCodes.includes("changes_requested")) return `Address requested GitHub review changes for ${id}.`;
  if (reasonCodes.includes("checks_pending")) return `Watch GitHub checks for ${id}.`;
  if (reasonCodes.includes("checks_unknown")) return `Inspect GitHub check state for ${id}.`;
  if (reasonCodes.includes("stale")) return `Review stale GitHub item ${id}.`;
  if (reasonCodes.includes("review_requested")) return `Review GitHub item ${id}.`;
  if (state === "green") return `No action needed for ${id}.`;
  return `Inspect GitHub item ${id}.`;
}

function githubOperatingItemComparator(left: GithubOperatingItem, right: GithubOperatingItem): number {
  const stateRank = { red: 0, yellow: 1, unknown: 2, green: 3 } as const;
  const urgencyRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  const leftState = stateRank[operatingState(left.state ?? "unknown")];
  const rightState = stateRank[operatingState(right.state ?? "unknown")];
  if (leftState !== rightState) return leftState - rightState;
  const leftUrgency = urgencyRank[operatingUrgency(left.urgency ?? "medium")];
  const rightUrgency = urgencyRank[operatingUrgency(right.urgency ?? "medium")];
  if (leftUrgency !== rightUrgency) return leftUrgency - rightUrgency;
  const freshness = compareUpdatedAtDesc(left.updatedAt ?? null, right.updatedAt ?? null);
  if (freshness !== 0) return freshness;
  return left.id.localeCompare(right.id);
}

function githubRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function githubString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function githubNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function githubBoolean(value: unknown): boolean {
  return value === true || (typeof value === "string" && ["true", "yes"].includes(value.trim().toLowerCase()));
}

function signalFromPlanPin(pin: PlanStateManualPin): OperatingSignal {
  const urgency = pin.state === "red" ? "high" : pin.state === "yellow" || pin.state === "unknown" ? "medium" : "low";
  return {
    schema: "lco.operatingSignal.v1",
    signalId: `sig_${stableId(pin.pinId).slice(0, 16)}`,
    sourceKind: "plan_state",
    sourceRef: pin.sourceRef,
    observedAt: null,
    subject: {
      kind: "project",
      id: pin.pinId,
      title: pin.title
    },
    state: pin.state,
    urgency,
    reasonCodes: ["manual_pin"],
    summary: pin.summary,
    nextAction: {
      kind: "inspect",
      text: pin.nextAction,
      requiresApproval: false
    },
    confidence: 0.72,
    evidenceIds: [`ev_${stableId(`${pin.pinId}:plan_state`).slice(0, 16)}`]
  };
}

function sourceKindForSignal(signal: OperatingSignal): OperatingSourceKind {
  return signal.sourceKind === "codex" ? "lco" : signal.sourceKind;
}

function applySourceAuthority(signal: OperatingSignal, profile: SourceAuthorityProfile): OperatingSignal {
  const sourceKind = sourceKindForSignal(signal);
  const authority = profile.sources[sourceKind] ?? createDefaultSourceAuthorityProfile().sources[sourceKind];
  const reasonCodes = [...signal.reasonCodes];
  let state = signal.state;
  let confidence = signal.confidence;
  if (authority.setupStatus === "unavailable") {
    reasonCodes.push("authority_unavailable");
    confidence = Math.min(confidence, 0.45);
    if (authority.fallbackBehavior === "unknown") state = "unknown";
  } else if (authority.setupStatus === "not_configured") {
    reasonCodes.push("authority_not_configured");
    confidence = Math.min(confidence, 0.45);
    if (authority.fallbackBehavior === "unknown") state = "unknown";
  } else if (authority.setupStatus === "partial") {
    reasonCodes.push("authority_partial");
    confidence = Math.min(confidence, 0.7);
  }
  if (authority.authority === "cache_only") {
    reasonCodes.push("authority_cache_only");
    confidence = Math.min(confidence, 0.55);
    if (authority.fallbackBehavior === "unknown") state = "unknown";
  } else if (authority.authority === "fallback_only") {
    reasonCodes.push("authority_fallback_only");
    confidence = Math.min(confidence, 0.72);
    if (authority.fallbackBehavior === "unknown") state = "unknown";
  }
  if (authority.fallbackBehavior === "low_confidence") {
    confidence = Math.min(confidence, 0.72);
  }
  return {
    ...signal,
    state,
    confidence,
    reasonCodes: unique(reasonCodes)
  };
}

function watcherStateFromSpec(spec: WatchSpec, now: number): WatcherState {
  const targetRef = publicSafeWatcherTargetRef(spec.targetRef || "unknown");
  const watchId = publicSafeWatcherIdentifier(spec.watchId || `watch_${stableId(targetRef).slice(0, 12)}`, "watch");
  const confidence = Math.max(0, Math.min(1, spec.confidence ?? 0.75));
  const createdAtMs = timestampMillis(spec.createdAt);
  const lastObservedAtMs = timestampMillis(spec.lastObservedAt ?? null);
  const ttlSeconds = clamp(Math.trunc(spec.ttlSeconds || 0), 60, 30 * 24 * 60 * 60);
  const expiresAtMs = createdAtMs === null ? null : createdAtMs + ttlSeconds * 1000;
  const staleAfterSeconds = Math.trunc(spec.staleAfterSeconds ?? Math.max(60, Math.floor(ttlSeconds / 2)));
  const stale = lastObservedAtMs !== null && now - lastObservedAtMs >= staleAfterSeconds * 1000;
  const expired = expiresAtMs !== null && now >= expiresAtMs;
  const inferredWakeReason = inferWatcherWakeReason(spec, now);
  const wakeReason = knownWatcherKind(spec.wakeReason) ?? inferredWakeReason;
  const triggered = Boolean(wakeReason);
  const status: WatcherStatus = expired
    ? "expired"
    : confidence < 0.5
      ? "low_confidence"
      : triggered
        ? "triggered"
        : stale
          ? "stale"
          : "active";
  return {
    schema: "lco.watcherState.v1",
    watchId,
    targetRef,
    kind: spec.kind,
    status,
    wakeReason: status === "triggered" ? wakeReason : null,
    recommendedAction: watcherRecommendedAction(status, spec.kind),
    requiresApproval: true,
    mutates: false,
    stale,
    expired,
    expiresAt: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
    lastObservedAt: lastObservedAtMs === null ? null : new Date(lastObservedAtMs).toISOString(),
    stopConditions: (spec.stopConditions ?? []).map((condition) => publicSafeWatcherIdentifier(String(condition), "condition")).slice(0, 12),
    reasonCodes: watcherReasonCodes(spec.kind, status, wakeReason, stale, expired, confidence),
    confidence,
    evidenceIds: (spec.evidenceIds ?? []).map((id) => publicSafeRefLike(String(id), "evidence") ?? "").filter(Boolean).slice(0, 20),
    approvalBoundary: "Read-only watcher; requests attention only. No live Codex control, GUI mutation, external write, or cleanup without a separate matching approval packet."
  };
}

function knownWatcherKind(value: unknown): WatcherKind | null {
  return value === "thread_finished"
    || value === "final_message_appeared"
    || value === "pr_checks_changed"
    || value === "review_comment_arrived"
    || value === "no_activity"
    || value === "approval_expired"
    ? value
    : null;
}

function inferWatcherWakeReason(spec: WatchSpec, now: number): WatcherKind | null {
  const observed = spec.observed;
  if (!observed) return null;
  if (spec.kind === "thread_finished" && observed.threadStatus && ["done", "complete", "completed", "closed", "merged"].includes(normalizedMetadataValue(observed.threadStatus))) return "thread_finished";
  if (spec.kind === "final_message_appeared" && (observed.finalMessageCount ?? 0) > 0) return "final_message_appeared";
  if (spec.kind === "pr_checks_changed" && observed.prChecksChanged === true) return "pr_checks_changed";
  if (spec.kind === "review_comment_arrived" && (observed.reviewCommentCount ?? 0) > 0) return "review_comment_arrived";
  if (spec.kind === "approval_expired") {
    const approvalExpiresAt = timestampMillis(observed.approvalExpiresAt ?? null);
    if (approvalExpiresAt !== null && now >= approvalExpiresAt) return "approval_expired";
  }
  if (spec.kind === "no_activity" && (observed.noActivitySeconds ?? 0) >= Math.trunc(spec.staleAfterSeconds ?? spec.ttlSeconds)) return "no_activity";
  return null;
}

function watcherReasonCodes(kind: WatcherKind, status: WatcherStatus, wakeReason: WatcherKind | null, stale: boolean, expired: boolean, confidence: number): string[] {
  return unique([
    "watcher_read_only",
    `watcher_kind:${kind}`,
    status === "triggered" ? "watcher_triggered" : "",
    wakeReason ? `wake_reason:${wakeReason}` : "",
    stale ? "watcher_stale" : "",
    expired ? "ttl_expired" : "",
    status === "low_confidence" || confidence < 0.5 ? "low_confidence" : "",
    "requires_approval"
  ].filter(Boolean));
}

function watcherRecommendedAction(status: WatcherStatus, kind: WatcherKind): WatcherRecommendedAction {
  if (status === "expired") return "ignore";
  if (status === "stale") return "inspect";
  if (status !== "triggered") return "inspect";
  if (kind === "approval_expired") return "approve";
  return "resume";
}

function triggeredWatchersByTarget(watchers: WatcherState[]): Map<string, WatcherState[]> {
  const map = new Map<string, WatcherState[]>();
  for (const watcher of watchers) {
    if (watcher.status !== "triggered" && watcher.status !== "stale") continue;
    const existing = map.get(watcher.targetRef) ?? [];
    existing.push(watcher);
    map.set(watcher.targetRef, existing);
  }
  for (const states of map.values()) states.sort(watcherStateComparator);
  return map;
}

function watcherStateComparator(left: WatcherState, right: WatcherState): number {
  const statusDelta = watcherStatusRank(right.status) - watcherStatusRank(left.status);
  if (statusDelta !== 0) return statusDelta;
  return left.watchId.localeCompare(right.watchId);
}

function watcherStatusRank(status: WatcherStatus): number {
  if (status === "triggered") return 5;
  if (status === "stale") return 4;
  if (status === "low_confidence") return 3;
  if (status === "expired") return 2;
  return 1;
}

function createAuthorityCoverage(
  profile: SourceAuthorityProfile,
  sourceCoverage: OperatingDigest["sourceCoverage"]
): OperatingDigest["authorityCoverage"] {
  return Object.fromEntries(OPERATING_SOURCE_KINDS.map((sourceKind) => {
    const source = profile.sources[sourceKind] ?? createDefaultSourceAuthorityProfile().sources[sourceKind];
    return [sourceKind, {
      ...source,
      sourceKind,
      status: authorityStatusFor(source, sourceCoverage[sourceKind]),
      owns: safeAuthorityList(source.owns),
      allowedClaims: safeAuthorityList(source.allowedClaims)
    }];
  })) as OperatingDigest["authorityCoverage"];
}

function authorityStatusFor(source: SourceAuthoritySource, coverage: SourceCoverageState): SourceCoverageState {
  if (source.setupStatus === "unavailable" || source.setupStatus === "not_configured") return source.setupStatus;
  if (source.setupStatus === "partial" && coverage === "ok") return "partial";
  return coverage;
}

function operatingCardFromSignal(signal: OperatingSignal): OperatingCard {
  const reasonCodes = operatingCardReasonCodes(signal);
  const kind: OperatingCard["kind"] = signal.subject.kind === "codex_session" || signal.subject.kind === "project"
    ? "project"
    : signal.subject.kind === "issue" || signal.subject.kind === "pr" || signal.subject.kind === "repo"
      ? "repo"
      : signal.subject.kind === "customer"
        ? "customer"
        : signal.subject.kind === "billing"
          ? "business"
          : "incident";
  return {
    schema: "lco.operatingCard.v1",
    cardId: `card_${stableId(signal.signalId).slice(0, 16)}`,
    kind,
    title: signal.subject.title,
    state: reasonCodes.includes("conflicting_state") ? "unknown" : signal.state,
    lastMovementAt: signal.observedAt,
    summary: publicSafeText(signal.summary, 320),
    nextAction: publicSafeText(signal.nextAction.text, 240),
    owner: "eva",
    confidence: reasonCodes.includes("conflicting_state") ? Math.min(signal.confidence, 0.45) : signal.confidence,
    signals: [signal.signalId],
    evidenceIds: signal.evidenceIds,
    reasonCodes,
    approvalBoundary: signal.nextAction.requiresApproval
      ? "Approval required before resume, send, steer, interrupt, GUI action, external message, commit, push, deploy, or production/customer mutation."
      : "Read-only inspection only; no mutation is authorized by this card."
  };
}

function operatingCardReasonCodes(signal: OperatingSignal): string[] {
  const fresh = signalIsFresh(signal.observedAt);
  const codes = [
    ...signal.reasonCodes,
    signal.sourceKind === "github" && signal.state !== "green" && fresh ? "fresh_signal" : "",
    signal.sourceKind === "github" && signal.state !== "green" && fresh && ["repo", "pr", "issue"].includes(signal.subject.kind) ? "current_lane" : "",
    signal.sourceKind === "codex" && signal.reasonCodes.includes("missing_evidence") && signal.confidence <= 0.72 ? "low_confidence_downgraded" : ""
  ];
  return unique(codes.filter(Boolean).map((code) => publicSafeText(code, 80)));
}

function signalIsFresh(observedAt: string | null): boolean {
  const observedAtMs = timestampMillis(observedAt);
  if (observedAtMs === null) return false;
  return Date.now() - observedAtMs <= 24 * 60 * 60 * 1000;
}

function operatingCardComparator(left: OperatingCard, right: OperatingCard): number {
  const leftScore = operatingCardPriorityScore(left);
  const rightScore = operatingCardPriorityScore(right);
  if (leftScore !== rightScore) return rightScore - leftScore;
  const updatedAtCompare = compareUpdatedAtDesc(left.lastMovementAt, right.lastMovementAt);
  if (updatedAtCompare !== 0) return updatedAtCompare;
  if (left.confidence !== right.confidence) return right.confidence - left.confidence;
  return left.cardId.localeCompare(right.cardId);
}

function operatingCardPriorityScore(card: OperatingCard): number {
  const stateScore = { red: 300, yellow: 220, unknown: 140, green: 20 } as const;
  const codeScore = card.reasonCodes.reduce((score, code) => score + ({
    customer_impact: 220,
    runtime_impact: 220,
    security_impact: 220,
    production_impact: 220,
    current_lane: 160,
    fresh_signal: 80,
    ci_failed: 80,
    changes_requested: 75,
    approval_needed: 70,
    checks_pending: 55,
    review_requested: 45,
    blocked: 45,
    manual_pin: 30,
    checks_unknown: 20,
    low_confidence_downgraded: -190,
    missing_evidence: -120,
    active_stale: -80,
    authority_not_configured: -40,
    authority_unavailable: -40,
    authority_cache_only: -30
  }[code] ?? 0), 0);
  return stateScore[card.state] + codeScore + Math.round(card.confidence * 40);
}

function evidenceCardsForOperatingCard(card: OperatingCard, signal: OperatingSignal | undefined): EvidenceCard[] {
  return card.evidenceIds.map((evidenceId) => ({
    schema: "lco.evidenceCard.v1",
    evidenceId,
    claim: publicSafeText(`${card.title} is ${card.state}.`, 180),
    sourceKind: signal?.sourceKind === "github" ? "github_check_summary" : signal?.sourceKind === "plan_state" ? "plan_state" : "session_metadata",
    sourceRef: signal?.sourceRef ?? card.cardId,
    observedAt: card.lastMovementAt,
    excerpt: publicSafeText(card.summary, 260),
    redactions: ["paths", "tokens", "raw_transcript"],
    confidence: card.confidence
  }));
}

function operatingHealth(cards: OperatingCard[]): OperatingDigest["health"] {
  const red = cards.filter((card) => card.state === "red").length;
  const yellow = cards.filter((card) => card.state === "yellow").length;
  const unknown = cards.filter((card) => card.state === "unknown").length;
  const green = cards.filter((card) => card.state === "green").length;
  return {
    overall: red > 0 ? "red" : yellow > 0 || unknown > 0 ? "yellow" : "green",
    customers: { red: 0, yellow: 0, green: 0, unknown: 0 },
    projects: {
      blocked: red,
      moving: green,
      stale: cards.filter((card) => card.reasonCodes.includes("active_stale")).length
    },
    codex: {
      needsAttention: red + yellow + unknown,
      waiting: cards.filter((card) => card.reasonCodes.includes("external_wait")).length,
      done: green
    },
    finance: {
      state: "unknown",
      reason: "stripe_adapter_not_configured"
    }
  };
}

function operatingState(value: string): OperatingState {
  const normalized = normalizedMetadataValue(value);
  if (["green", "ok", "good", "done", "complete"].includes(normalized)) return "green";
  if (["yellow", "warn", "warning", "attention"].includes(normalized)) return "yellow";
  if (["red", "critical", "blocked", "bad"].includes(normalized)) return "red";
  return "unknown";
}

function operatingUrgency(value: string): OperatingUrgency {
  const normalized = normalizedMetadataValue(value);
  if (["critical", "high", "medium", "low"].includes(normalized)) return normalized as OperatingUrgency;
  return "medium";
}

function managementEntry(entry: CodexThreadMapEntry, reason: string): SessionManagementEntry {
  return {
    threadId: entry.threadId,
    sourceRef: codexThreadRef(entry.threadId),
    title: entry.title,
    updatedAt: entry.updatedAt,
    status: entry.metadata.status,
    priority: entry.metadata.priority,
    nextAction: entry.metadata.nextAction,
    reason,
    metadata: entry.metadata
  };
}

function recommendation(
  action: SessionManagementAction,
  entry: SessionManagementEntry,
  targetTool: string | null,
  requiresDryRun: boolean,
  requiresApproval: boolean,
  approvalAuditIdRequired: boolean
): SessionManagementRecommendation {
  return {
    ...entry,
    action,
    targetTool,
    requiresDryRun,
    requiresApproval,
    approvalAuditIdRequired
  };
}

function managementEntryComparator(priorityOrder: string[] | undefined): (left: SessionManagementEntry, right: SessionManagementEntry) => number {
  const priorityRank = new Map(unique((priorityOrder ?? []).map(normalizedMetadataValue).filter(Boolean)).map((value, index) => [value, index]));
  const fallbackRank = priorityRank.size;
  return (left, right) => {
    const leftRank = priorityRank.get(normalizedMetadataValue(left.priority)) ?? fallbackRank;
    const rightRank = priorityRank.get(normalizedMetadataValue(right.priority)) ?? fallbackRank;
    if (leftRank !== rightRank) return leftRank - rightRank;
    const updatedAtCompare = compareUpdatedAtDesc(left.updatedAt, right.updatedAt);
    if (updatedAtCompare !== 0) return updatedAtCompare;
    return left.threadId.localeCompare(right.threadId);
  };
}

function classifyManagementEntry(entry: CodexThreadMapEntry): { lane: SessionManagementLane; reason: string } | null {
  const { metadata } = entry;
  if (isBlockedWork(metadata)) {
    return {
      lane: "blockedWork",
      reason: `blocked: ${metadata.blocker || metadata.status || "metadata indicates blocked work"}`
    };
  }
  if (isSafeArchiveCandidate(entry)) {
    const reason = isStaleManagementEntry(entry.updatedAt)
      ? "stale paused work with archive/close intent; archive remains recommendation-only"
      : "complete work with no active blocker; archive remains recommendation-only";
    return { lane: "safeToArchive", reason };
  }
  if (shouldForkSession(metadata)) {
    return { lane: "shouldFork", reason: "metadata asks for a forked follow-up lane" };
  }
  if (shouldResumeSession(entry)) {
    return { lane: "shouldResume", reason: "metadata asks to resume or continue the session" };
  }
  if (isActiveWork(metadata)) {
    return { lane: "activeWork", reason: "active work with enough refs for low-context triage" };
  }
  if (needsExpansionBeforeAction(metadata)) {
    return { lane: "needsExpansion", reason: "missing plan/final/file refs or next action asks for bounded expansion" };
  }
  return null;
}

function isActiveWork(metadata: SessionMetadata): boolean {
  const status = normalizedMetadataValue(metadata.status);
  return ["active", "in-progress", "ready"].includes(status)
    && !isBlockedWork(metadata)
    && hasEvidenceRefs(metadata);
}

function isBlockedWork(metadata: SessionMetadata): boolean {
  const status = normalizedMetadataValue(metadata.status);
  return status.includes("blocked")
    || status === "external-review-wait"
    || hasRealBlocker(metadata.blocker);
}

function needsExpansionBeforeAction(metadata: SessionMetadata): boolean {
  const nextAction = normalizedMetadataValue(metadata.nextAction);
  return nextAction.includes("expand")
    || metadata.proposedPlanRefs.length === 0
    || metadata.finalMessageRefs.length === 0
    || metadata.touchedFileRefs.length === 0;
}

function isSafeArchiveCandidate(entry: CodexThreadMapEntry): boolean {
  const { metadata } = entry;
  const status = normalizedMetadataValue(metadata.status);
  const nextAction = normalizedMetadataValue(metadata.nextAction);
  if (hasRealBlocker(metadata.blocker) || !(nextAction.includes("archive") || nextAction.includes("close"))) return false;
  if (["complete", "completed", "done", "merged", "closed"].includes(status)) return true;
  return ["paused", "stale"].includes(status) && isStaleManagementEntry(entry.updatedAt);
}

function shouldForkSession(metadata: SessionMetadata): boolean {
  const status = normalizedMetadataValue(metadata.status);
  const nextAction = normalizedMetadataValue(metadata.nextAction);
  return status.includes("fork") || nextAction.includes("fork");
}

function shouldResumeSession(entry: CodexThreadMapEntry): boolean {
  const { metadata } = entry;
  const status = normalizedMetadataValue(metadata.status);
  const nextAction = normalizedMetadataValue(metadata.nextAction);
  if (hasRealBlocker(metadata.blocker) || nextAction.includes("archive") || nextAction.includes("close")) return false;
  if (nextAction.includes("resume") || status === "resume") return true;
  return status === "paused" && !isStaleManagementEntry(entry.updatedAt);
}

function hasEvidenceRefs(metadata: SessionMetadata): boolean {
  return metadata.proposedPlanRefs.length > 0
    && metadata.finalMessageRefs.length > 0
    && metadata.touchedFileRefs.length > 0;
}

function hasRealBlocker(value: string | null): boolean {
  const normalized = normalizedMetadataValue(value);
  return Boolean(normalized)
    && !["none", "no", "n/a", "na", "not blocked", "unblocked"].includes(normalized);
}

function normalizedMetadataValue(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function compareUpdatedAtDesc(left: string | null, right: string | null): number {
  const leftMs = timestampMillis(left);
  const rightMs = timestampMillis(right);
  if (leftMs === rightMs) return 0;
  if (leftMs === null) return 1;
  if (rightMs === null) return -1;
  return rightMs - leftMs;
}

function isStaleManagementEntry(updatedAt: string | null): boolean {
  const updatedMs = timestampMillis(updatedAt);
  if (updatedMs === null) return false;
  return Date.now() - updatedMs >= 30 * 24 * 60 * 60 * 1000;
}

function timestampMillis(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getCodexFinalMessages(db: LooDatabase, options: { limit?: number; threadId?: string } = {}): Array<{ threadId: string; text: string }> {
  const limit = clamp(options.limit ?? 50, 1, 500);
  const rows = options.threadId
    ? db.prepare("SELECT thread_id AS threadId, final_message AS text FROM codex_sessions WHERE thread_id = ? AND final_message IS NOT NULL LIMIT ?").all(options.threadId, limit)
    : db.prepare("SELECT thread_id AS threadId, final_message AS text FROM codex_sessions WHERE final_message IS NOT NULL ORDER BY COALESCE(updated_at, indexed_at) DESC LIMIT ?").all(limit);
  return (rows as Array<Record<string, unknown>>).map((row) => ({ threadId: String(row.threadId), text: String(row.text ?? "") }));
}

export function getCodexPlans(db: LooDatabase, options: { limit?: number; threadId?: string } = {}): Array<{ threadId: string; text: string; ordinal: number }> {
  const limit = clamp(options.limit ?? 50, 1, 500);
  const rows = options.threadId
    ? db.prepare("SELECT thread_id AS threadId, text, ordinal FROM codex_plans WHERE thread_id = ? ORDER BY ordinal LIMIT ?").all(options.threadId, limit)
    : db.prepare("SELECT thread_id AS threadId, text, ordinal FROM codex_plans ORDER BY rowid DESC LIMIT ?").all(limit);
  return (rows as Array<Record<string, unknown>>).map((row) => ({ threadId: String(row.threadId), text: String(row.text ?? ""), ordinal: Number(row.ordinal ?? 0) }));
}

export function getCodexTouchedFiles(db: LooDatabase, options: { threadId: string }): string[] {
  return (db.prepare("SELECT path FROM codex_touched_files WHERE thread_id = ? ORDER BY path").all(options.threadId) as Array<{ path: string }>).map((row) => row.path);
}

export function getCodexToolCalls(db: LooDatabase, options: { limit?: number; threadId?: string } = {}): CodexToolCall[] {
  const limit = clamp(options.limit ?? 100, 1, 1000);
  const rows = options.threadId
    ? db.prepare(`
        SELECT thread_id AS threadId, call_id AS callId, tool_name AS toolName, arguments_text AS argumentsText
        FROM codex_tool_calls
        WHERE thread_id = ?
        ORDER BY rowid DESC
        LIMIT ?
      `).all(options.threadId, limit)
    : db.prepare(`
        SELECT thread_id AS threadId, call_id AS callId, tool_name AS toolName, arguments_text AS argumentsText
        FROM codex_tool_calls
        ORDER BY rowid DESC
        LIMIT ?
      `).all(limit);
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    threadId: String(row.threadId),
    callId: String(row.callId),
    toolName: String(row.toolName),
    argumentsText: String(row.argumentsText ?? "")
  }));
}

export function createIndexedSessionSanitizerReport(db: LooDatabase, options: IndexedSessionSanitizerOptions = {}): IndexedSessionSanitizerReport {
  const limit = clamp(options.limit ?? 50, 1, 500);
  const rows = options.threadId
    ? db.prepare(`
        SELECT thread_id AS threadId, safe_text AS safeText
        FROM codex_sessions
        WHERE thread_id = ?
        ORDER BY COALESCE(updated_at, indexed_at) DESC
        LIMIT ?
      `).all(options.threadId, limit)
    : db.prepare(`
        SELECT thread_id AS threadId, safe_text AS safeText
        FROM codex_sessions
        ORDER BY COALESCE(updated_at, indexed_at) DESC
        LIMIT ?
      `).all(limit);
  const sources: SessionSanitizerSource[] = (rows as Array<Record<string, unknown>>).map((row) => ({
    sourceRef: codexThreadRef(String(row.threadId)),
    text: String(row.safeText ?? "")
  }));
  const report = createSessionSanitizerReport({
    sources,
    now: options.now,
    auditKey: options.auditKey
  });
  const blockers = sources.length === 0 ? ["no_indexed_session_sanitizer_sources"] : [];
  return {
    ...report,
    ok: report.ok && blockers.length === 0,
    blockers: [...report.blockers, ...blockers],
    dryRun: true,
    mutatesCodex: false,
    source: "indexed-safe-text",
    sourceLimit: limit,
    scannedRefs: sources.map((source) => source.sourceRef),
    proofBoundary: "This indexed-session sanitizer report scans local indexed safe text only. It does not read raw Codex transcripts directly, upload local data, mutate sessions, perform repairs, run live Codex control, or mutate a desktop GUI.",
    nextAction: report.findingCount > 0
      ? "Review redacted findings locally, rotate any real secrets, and create separately approved repair tasks without attaching raw session text."
      : blockers.length > 0
        ? "Index or select at least one local session before using the sanitizer report as evidence."
        : "No sanitizer findings were detected in the selected indexed safe text."
  };
}

export function createIndexedSessionSanitizerRepairPlan(report: IndexedSessionSanitizerReport): IndexedSessionSanitizerRepairPlan {
  const plan = createSessionSanitizerRepairPlan(report, {
    source: report.source,
    sourceLimit: report.sourceLimit,
    scannedRefs: report.scannedRefs
  });
  return {
    ...plan,
    source: report.source,
    sourceLimit: report.sourceLimit,
    scannedRefs: report.scannedRefs
  };
}

const PUBLIC_COMMENT_PATH_PREFIX_PATTERN = /\/Volumes\/|\/Users\/|\/home\/|\/root\/|\/tmp\/|\/private\/tmp\/|\/var\/folders\/|~\/\.codex\//g;
const PUBLIC_COMMENT_PATH_TOKEN_PATTERN = /(?:\/Volumes|\/Users|\/home|\/root|\/tmp|\/private\/tmp|\/var\/folders|~\/\.codex)\/(?:(?!(?:\/Volumes|\/Users|\/home|\/root|\/tmp|\/private\/tmp|\/var\/folders|~\/\.codex)\/)[^\s"'`<>\])}])+/g;
const PUBLIC_COMMENT_REFERENCE_PATTERN = /(?:#\d+|https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull)\/\d+|\b(?:PR|issue)\s*#?\d+)/i;

export function createPublicCommentHygieneReport(body: string, options: PublicCommentHygieneOptions = {}): PublicCommentHygieneReport {
  const text = String(body ?? "");
  const maxAbsolutePathPrefixRepeats = clamp(options.maxAbsolutePathPrefixRepeats ?? 2, 0, 1000);
  const maxRepeatedPathFragmentCount = clamp(options.maxRepeatedPathFragmentCount ?? 1, 0, 1000);
  const maxPathTokenDensity = options.maxPathTokenDensity ?? 0.2;
  const minHumanReadableWords = clamp(options.minHumanReadableWords ?? 8, 0, 1000);
  const pathPrefixCount = [...text.matchAll(PUBLIC_COMMENT_PATH_PREFIX_PATTERN)].length;
  const pathTokens = [...text.matchAll(PUBLIC_COMMENT_PATH_TOKEN_PATTERN)]
    .map((match) => normalizePublicCommentPathToken(match[0]))
    .filter(Boolean);
  const pathTokenCounts = new Map<string, number>();
  for (const token of pathTokens) {
    pathTokenCounts.set(token, (pathTokenCounts.get(token) ?? 0) + 1);
  }
  const repeatedPathTokenCount = Math.max(0, ...[...pathTokenCounts.values()]);
  const pathFreeText = text.replace(PUBLIC_COMMENT_PATH_TOKEN_PATTERN, " ");
  const words = pathFreeText.trim() ? pathFreeText.trim().split(/\s+/).length : 0;
  const denominatorWords = Math.max(1, words + pathTokens.length);
  const pathTokenDensity = pathTokens.length / denominatorWords;
  const findings: PublicCommentHygieneFinding[] = [];

  if (pathPrefixCount > maxAbsolutePathPrefixRepeats) {
    findings.push(publicCommentHygieneFinding({
      code: "absolute_path_prefix_repeated",
      severity: "blocker",
      count: pathPrefixCount,
      threshold: maxAbsolutePathPrefixRepeats,
      detail: "Comment body repeats absolute local path prefixes above the public-safe threshold.",
      sample: "<redacted-path>"
    }));
  }
  if (repeatedPathTokenCount > maxRepeatedPathFragmentCount) {
    findings.push(publicCommentHygieneFinding({
      code: "path_fragment_repeated",
      severity: "blocker",
      count: repeatedPathTokenCount,
      threshold: maxRepeatedPathFragmentCount,
      detail: "Comment body repeats the same local path fragment.",
      sample: "path-fragment:" + stableId([...pathTokenCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "").slice(0, 12)
    }));
  }
  if (pathTokens.length >= 3 && pathTokenDensity > maxPathTokenDensity) {
    findings.push(publicCommentHygieneFinding({
      code: "path_token_density_high",
      severity: "blocker",
      count: Math.round(pathTokenDensity * 100),
      threshold: Math.round(maxPathTokenDensity * 100),
      detail: "Comment body is dominated by local path-like tokens instead of a human-readable status summary.",
      sample: "<redacted-path-density>"
    }));
  }
  if (options.requireIssueOrPrRef === true && !PUBLIC_COMMENT_REFERENCE_PATTERN.test(text)) {
    findings.push(publicCommentHygieneFinding({
      code: "public_reference_missing",
      severity: "warning",
      count: 0,
      threshold: 1,
      detail: "Comment body should include at least one public issue or PR reference.",
      sample: null
    }));
  }
  if (words < minHumanReadableWords) {
    findings.push(publicCommentHygieneFinding({
      code: "human_summary_too_short",
      severity: "warning",
      count: words,
      threshold: minHumanReadableWords,
      detail: "Comment body has too little non-path prose to work as a public closeout.",
      sample: null
    }));
  }

  const blockers = unique(findings.filter((finding) => finding.severity === "blocker").map((finding) => finding.code)) as PublicCommentHygieneCode[];
  const warnings = unique(findings.filter((finding) => finding.severity === "warning").map((finding) => finding.code)) as PublicCommentHygieneCode[];
  const status: PublicCommentHygieneStatus = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "pass";
  return {
    schema: "lco.publicCommentHygiene.v1",
    ok: blockers.length === 0,
    status,
    publicSafe: true,
    generatedAt: options.now ?? new Date().toISOString(),
    bodyHash: `sha256:${stableId(text)}`,
    summary: status === "blocked"
      ? "Public comment hygiene blocked malformed or path-heavy output before any GitHub write."
      : status === "warning"
        ? "Public comment hygiene passed with warnings; review concise public references before posting."
        : "Public comment hygiene passed.",
    blockers,
    warnings,
    findings,
    redactedPreview: publicCommentSafePreview(text, clamp(options.maxPreviewChars ?? 800, 80, 5000)),
    metrics: {
      characters: text.length,
      words,
      absolutePathPrefixCount: pathPrefixCount,
      pathTokenCount: pathTokens.length,
      pathTokenDensity: Number(pathTokenDensity.toFixed(3))
    },
    actionsPerformed: {
      githubWrite: false,
      liveControl: false,
      guiMutation: false,
      rawTranscriptRead: false,
      npmPublish: false,
      githubRelease: false
    },
    proofBoundary: "This report validates a proposed public comment body only; it does not post to GitHub, read raw transcripts, run live Codex control, mutate a GUI, publish npm, or create a GitHub Release."
  };
}

function publicCommentHygieneFinding(input: Omit<PublicCommentHygieneFinding, "publicSafe">): PublicCommentHygieneFinding {
  return { ...input, publicSafe: true };
}

function normalizePublicCommentPathToken(token: string): string {
  return token.trim().replace(/[.,;:!?]+$/g, "");
}

function publicCommentSafePreview(text: string, maxChars: number): string {
  return publicSafeText(text.replace(PUBLIC_COMMENT_PATH_TOKEN_PATTERN, "<redacted-path>"), maxChars);
}

export function createCloseoutEnvelopeReport(db: LooDatabase, options: CloseoutEnvelopeReportOptions = {}): CloseoutEnvelopeReport {
  const limit = clamp(options.limit ?? 50, 1, 500);
  const rows = options.threadId
    ? db.prepare(`
        SELECT
          s.thread_id AS threadId,
          s.title,
          s.updated_at AS updatedAt,
          m.project,
          m.status,
          m.priority,
          m.owner,
          m.blocker,
          m.next_action AS nextAction,
          m.closeout_state AS closeoutState,
          m.plan_completion_state AS planCompletionState,
          m.proposed_plan_refs_json AS proposedPlanRefsJson,
          m.final_message_refs_json AS finalMessageRefsJson,
          m.touched_file_refs_json AS touchedFileRefsJson,
          m.closeout_envelope_text AS closeoutEnvelopeText,
          m.closeout_envelope_open_count AS closeoutEnvelopeOpenCount,
          m.closeout_envelope_close_count AS closeoutEnvelopeCloseCount,
          m.source_refs_json AS sourceRefsJson
        FROM codex_sessions s
        LEFT JOIN codex_session_metadata m ON m.thread_id = s.thread_id
        WHERE s.thread_id = ?
        LIMIT 1
      `).all(options.threadId) as Array<Record<string, unknown>>
    : options.includeUnavailable === true
      ? db.prepare(`
        SELECT
          s.thread_id AS threadId,
          s.title,
          s.updated_at AS updatedAt,
          m.project,
          m.status,
          m.priority,
          m.owner,
          m.blocker,
          m.next_action AS nextAction,
          m.closeout_state AS closeoutState,
          m.plan_completion_state AS planCompletionState,
          m.proposed_plan_refs_json AS proposedPlanRefsJson,
          m.final_message_refs_json AS finalMessageRefsJson,
          m.touched_file_refs_json AS touchedFileRefsJson,
          m.closeout_envelope_text AS closeoutEnvelopeText,
          m.closeout_envelope_open_count AS closeoutEnvelopeOpenCount,
          m.closeout_envelope_close_count AS closeoutEnvelopeCloseCount,
          m.source_refs_json AS sourceRefsJson
        FROM codex_sessions s
        LEFT JOIN codex_session_metadata m ON m.thread_id = s.thread_id
        ORDER BY COALESCE(s.updated_at, s.indexed_at) DESC
        LIMIT ?
      `).all(limit) as Array<Record<string, unknown>>
      : db.prepare(`
        SELECT
          s.thread_id AS threadId,
          s.title,
          s.updated_at AS updatedAt,
          m.project,
          m.status,
          m.priority,
          m.owner,
          m.blocker,
          m.next_action AS nextAction,
          m.closeout_state AS closeoutState,
          m.plan_completion_state AS planCompletionState,
          m.proposed_plan_refs_json AS proposedPlanRefsJson,
          m.final_message_refs_json AS finalMessageRefsJson,
          m.touched_file_refs_json AS touchedFileRefsJson,
          m.closeout_envelope_text AS closeoutEnvelopeText,
          m.closeout_envelope_open_count AS closeoutEnvelopeOpenCount,
          m.closeout_envelope_close_count AS closeoutEnvelopeCloseCount,
          m.source_refs_json AS sourceRefsJson
        FROM codex_sessions s
        LEFT JOIN codex_session_metadata m ON m.thread_id = s.thread_id
        WHERE
          COALESCE(m.closeout_envelope_open_count, 0) > 0 OR
          COALESCE(m.closeout_envelope_close_count, 0) > 0 OR
          m.project IS NOT NULL OR
          m.status IS NOT NULL OR
          m.priority IS NOT NULL OR
          m.owner IS NOT NULL OR
          m.blocker IS NOT NULL OR
          m.next_action IS NOT NULL OR
          m.closeout_state IS NOT NULL OR
          m.plan_completion_state IS NOT NULL OR
          COALESCE(m.proposed_plan_refs_json, '[]') <> '[]' OR
          COALESCE(m.final_message_refs_json, '[]') <> '[]' OR
          COALESCE(m.touched_file_refs_json, '[]') <> '[]' OR
          COALESCE(m.source_refs_json, '[]') <> '[]'
        ORDER BY COALESCE(s.updated_at, s.indexed_at) DESC
        LIMIT ?
      `).all(limit) as Array<Record<string, unknown>>;

  const candidates = rows
    .map((row) => closeoutEnvelopeCandidateFromRow(row))
    .filter((candidate) => options.includeUnavailable === true || candidate.state !== "unavailable")
    .slice(0, limit);
  const summary = {
    total: candidates.length,
    ready: candidates.filter((candidate) => candidate.state === "ready").length,
    partial: candidates.filter((candidate) => candidate.state === "partial").length,
    unavailable: candidates.filter((candidate) => candidate.state === "unavailable").length
  };
  return {
    dryRun: true,
    mutatesCodex: false,
    hookAgentReady: false,
    approvalRequiredForHookExecution: true,
    candidates,
    summary
  };
}

function closeoutEnvelopeCandidateFromRow(row: Record<string, unknown>): CloseoutEnvelopeCandidate {
  const threadId = String(row.threadId);
  const sessionMetadata = sessionMetadataFromRow(row);
  const envelopeStats = {
    openCount: Number(row.closeoutEnvelopeOpenCount ?? 0),
    closeCount: Number(row.closeoutEnvelopeCloseCount ?? 0)
  };
  const envelopeText = nullableString(row.closeoutEnvelopeText);
  const metadata = envelopeText === null ? emptySessionMetadata() : extractCloseoutEnvelopeMetadata(envelopeText);
  const publicCommentHygiene = envelopeText === null
    ? null
    : createPublicCommentHygieneReport(envelopeText, { requireIssueOrPrRef: true });
  const missingFields = closeoutEnvelopeMissingFields(metadata);
  const warnings: string[] = [];
  if (envelopeStats.openCount === 0 && sessionMetadataHasAnyValue(sessionMetadata)) warnings.push("closeout_envelope_missing");
  if (envelopeStats.openCount > 1) warnings.push("duplicate_closeout_envelopes");
  if (envelopeStats.openCount !== envelopeStats.closeCount) warnings.push("malformed_closeout_envelope");
  if (publicCommentHygiene?.status === "blocked") warnings.push("public_comment_hygiene_blocked");
  if (publicCommentHygiene?.status === "warning") warnings.push("public_comment_hygiene_warning");
  if (metadata.finalMessageRefs.length === 0) warnings.push("final_message_ref_missing");
  if (metadata.sourceRefs.length === 0) warnings.push("source_ref_missing");

  const hasCloseoutSignal = sessionMetadataHasAnyValue(sessionMetadata) || envelopeStats.openCount > 0 || envelopeStats.closeCount > 0;
  const malformed = warnings.includes("malformed_closeout_envelope");
  const duplicate = warnings.includes("duplicate_closeout_envelopes");
  const publicCommentBlocked = warnings.includes("public_comment_hygiene_blocked");
  const state: CloseoutEnvelopeState = envelopeText !== null && missingFields.length === 0 && !malformed && !duplicate && !publicCommentBlocked
    ? "ready"
    : hasCloseoutSignal
      ? "partial"
      : "unavailable";

  return {
    threadId,
    sourceRef: codexThreadRef(threadId),
    title: nullableString(row.title),
    updatedAt: nullableString(row.updatedAt),
    state,
    wouldAttach: state === "ready",
    metadata,
    missingFields,
    warnings,
    closeoutEnvelopeCount: envelopeStats.openCount,
    publicCommentHygiene,
    publicSafe: true
  };
}

function closeoutEnvelopeMissingFields(metadata: SessionMetadata): string[] {
  const missing: string[] = [];
  if (!metadata.project) missing.push("project");
  if (!metadata.status) missing.push("status");
  if (!metadata.nextAction) missing.push("nextAction");
  if (!metadata.closeoutState) missing.push("closeoutState");
  if (!metadata.planCompletionState) missing.push("planCompletionState");
  if (metadata.finalMessageRefs.length === 0) missing.push("finalMessageRefs");
  if (metadata.sourceRefs.length === 0) missing.push("sourceRefs");
  return missing;
}

function sessionMetadataHasAnyValue(metadata: SessionMetadata): boolean {
  return Boolean(
    metadata.project ||
    metadata.status ||
    metadata.priority ||
    metadata.owner ||
    metadata.blocker ||
    metadata.nextAction ||
    metadata.closeoutState ||
    metadata.planCompletionState ||
    metadata.proposedPlanRefs.length ||
    metadata.finalMessageRefs.length ||
    metadata.touchedFileRefs.length ||
    metadata.sourceRefs.length
  );
}

function closeoutEnvelopeStats(text: string): { openCount: number; closeCount: number } {
  return {
    openCount: text.match(/<loo_closeout\b[^>]*>/gi)?.length ?? 0,
    closeCount: text.match(/<\/loo_closeout>/gi)?.length ?? 0
  };
}

function latestBalancedCloseoutEnvelopeText(text: string): string | null {
  let latest: string | null = null;
  for (const match of text.matchAll(/<loo_closeout\b[^>]*>([\s\S]*?)<\/loo_closeout>/gi)) {
    latest = match[1]?.trim() ?? "";
  }
  return latest;
}

function recordCloseoutEnvelopeEvidence(session: ImportedSession, text: string): void {
  const stats = closeoutEnvelopeStats(text);
  session.closeoutEnvelopeOpenCount += stats.openCount;
  session.closeoutEnvelopeCloseCount += stats.closeCount;
  const envelopeText = latestBalancedCloseoutEnvelopeText(text);
  if (envelopeText !== null) session.closeoutEnvelopeText = truncate(envelopeText, 50_000);
}

function extractCloseoutEnvelopeMetadata(text: string): SessionMetadata {
  const labelPattern = CLOSEOUT_ENVELOPE_LABEL_BOUNDARIES.map(escapeRegExp).join("|");
  const withLabelBreaks = text.replace(new RegExp(`\\s+(${labelPattern})\\s*:`, "gi"), "\n$1:");
  return extractSessionMetadata(withLabelBreaks).metadata;
}

function capitalizeLabelStart(label: string): string {
  return label ? `${label.slice(0, 1).toUpperCase()}${label.slice(1)}` : label;
}

export function expandSession(db: LooDatabase, options: ExpandSessionOptions): ExpandRecallResult & { threadId: string } {
  const description = describeSession(db, options.threadId);
  if (!description) throw new Error(`Unknown Codex thread: ${options.threadId}`);
  const plans = getCodexPlans(db, { threadId: options.threadId, limit: 10 }).map((plan) => plan.text);
  const profile = resolveRecallProfile(options.profile, options.tokenBudget);
  if (profile.name === "metadata") {
    const metadata = [
      `Thread: ${description.title ?? description.threadId}`,
      `Ref: ${description.sourceRef}`,
      `ID: ${description.threadId}`,
      description.cwd ? `CWD: ${description.cwd}` : null,
      description.branch ? `Branch: ${description.branch}` : null,
      description.gitSha ? `Git SHA: ${description.gitSha}` : null,
      description.summary ? `Summary: ${description.summary}` : null,
      formatSessionMetadata(description.metadata),
      `Plans: ${description.planCount}`,
      `Touched files: ${description.touchedFiles.length}`,
      `Tool calls: ${description.toolCallCount}`,
      `Source path: ${description.sourcePath}`
    ].filter(Boolean).join("\n");
    return {
      sourceKind: "codex_thread",
      sourceRef: description.sourceRef,
      threadId: options.threadId,
      text: metadata,
      tokenBudget: profile.tokenBudget,
      profile
    };
  }
  const text = [
    `Thread: ${description.title ?? description.threadId}`,
    `ID: ${description.threadId}`,
    description.cwd ? `CWD: ${description.cwd}` : null,
    description.branch ? `Branch: ${description.branch}` : null,
    description.gitSha ? `Git SHA: ${description.gitSha}` : null,
    description.summary ? `Summary: ${description.summary}` : null,
    description.finalMessage ? `Final message: ${truncate(description.finalMessage, profile.name === "evidence" ? 3200 : 900)}` : null,
    description.touchedFiles.length ? `Touched files:\n${formatTouchedFiles(description.touchedFiles, profile.name === "evidence" ? 50 : 12, profile.name === "evidence" ? 3200 : 900)}` : null,
    plans.length ? `Plans:\n${plans.map((plan) => truncate(plan, profile.name === "evidence" ? 3200 : 1200)).join("\n\n")}` : null
  ].filter(Boolean).join("\n\n");
  return {
    sourceKind: "codex_thread",
    sourceRef: description.sourceRef,
    threadId: options.threadId,
    text: truncateByApproxTokens(text, profile.tokenBudget),
    tokenBudget: profile.tokenBudget,
    profile
  };
}

function formatTouchedFiles(files: string[], limit: number, maxChars: number): string {
  const perPathLimit = maxChars > 1000 ? 180 : 120;
  const visible: string[] = [];
  for (const file of files.slice(0, limit)) {
    const next = `- ${truncate(file, perPathLimit)}`;
    const hiddenIfAccepted = files.length - (visible.length + 1);
    const markerIfAccepted = hiddenIfAccepted > 0 ? `- ... ${hiddenIfAccepted} more touched files omitted` : null;
    const visibleMaxChars = markerIfAccepted ? Math.max(0, maxChars - markerIfAccepted.length - 1) : maxChars;
    const candidate = [...visible, next].join("\n");
    if (candidate.length > visibleMaxChars) break;
    visible.push(next);
  }
  const omittedMarker = files.length > visible.length ? `- ... ${files.length - visible.length} more touched files omitted` : null;
  const visibleMaxChars = omittedMarker ? Math.max(0, maxChars - omittedMarker.length - 1) : maxChars;
  const visibleText = truncate(visible.join("\n"), visibleMaxChars);
  return [visibleText, omittedMarker].filter(Boolean).join("\n");
}

export function probeLcmPeerDbs(paths = configuredLcmPeerDbPaths()): { peers: LcmPeerProbe[] } {
  return { peers: paths.map((path) => probeLcmPeerDb(path)) };
}

export function grepRecall(db: LooDatabase, options: {
  query: string;
  limit?: number;
  profile?: RecallProfileName;
  tokenBudget?: number;
  lcmDbPaths?: string[];
}): { query: string; profile: RecallProfile; matches: RecallSearchResult[] } {
  const query = options.query.trim();
  const limit = clamp(options.limit ?? 10, 1, 100);
  const profile = resolveRecallProfile(options.profile, options.tokenBudget);
  if (!query) return { query, profile, matches: [] };
  const codexMatches: RecallSearchResult[] = searchSessions(db, { query, limit }).map((match) => ({
    ...match,
    sourceKind: "codex_thread",
    sourceRef: codexThreadRef(match.threadId),
    threadId: match.threadId
  }));
  const claudeMatches = searchClaudeSessions(db, { query, limit });
  const lcmMatches = searchLcmPeers(options.lcmDbPaths ?? [], query, limit);
  const matches = [...codexMatches, ...claudeMatches, ...lcmMatches].slice(0, limit).map((match, index) => ({ ...match, score: index + 1 }));
  return { query, profile, matches };
}

export function describeRecallRef(db: LooDatabase, options: { sourceRef: string; lcmDbPaths?: string[] }): RecallDescription | null {
  const parsed = parseSourceRef(options.sourceRef);
  if (parsed.kind === "codex_thread") {
    const description = describeSession(db, parsed.id);
    if (!description) return null;
    return {
      sourceKind: "codex_thread",
      sourceRef: description.sourceRef,
      title: description.title,
      summary: description.summary,
      updatedAt: null,
      sourcePath: description.sourcePath,
      threadId: description.threadId,
      cwd: description.cwd,
      branch: description.branch,
      gitSha: description.gitSha,
      model: description.model,
      finalMessage: description.finalMessage,
      planCount: description.planCount,
      touchedFiles: description.touchedFiles,
      toolCallCount: description.toolCallCount,
      metadata: description.metadata
    };
  }
  if (parsed.kind === "claude_session") {
    const description = describeClaudeSessionInventory(db, parsed.id);
    if (!description) return null;
    return {
      sourceKind: "claude_session",
      sourceRef: description.sourceRef,
      title: description.title,
      summary: description.summary,
      updatedAt: description.updatedAt,
      sourcePath: description.sourcePath,
      sessionId: description.sessionId,
      project: description.project,
      workspaceHint: description.workspaceHint,
      status: description.status
    };
  }
  const summary = getLcmSummaryByRef(options.lcmDbPaths ?? [], parsed.dbHash, parsed.id);
  if (!summary) return null;
  return lcmSummaryDescription(summary);
}

export function expandRecallRef(db: LooDatabase, options: {
  sourceRef: string;
  lcmDbPaths?: string[];
  profile?: RecallProfileName;
  tokenBudget?: number;
}): ExpandRecallResult {
  const parsed = parseSourceRef(options.sourceRef);
  if (parsed.kind === "codex_thread") {
    return expandSession(db, { threadId: parsed.id, profile: options.profile, tokenBudget: options.tokenBudget });
  }
  if (parsed.kind === "claude_session") {
    const description = describeClaudeSessionInventory(db, parsed.id);
    if (!description) throw new Error(`Unknown Claude session ref: ${options.sourceRef}`);
    const profile = resolveRecallProfile(options.profile, options.tokenBudget);
    const metadata = formatClaudeSessionInventoryMetadata(description);
    const text = profile.name === "metadata"
      ? metadata
      : truncateByApproxTokens(`${metadata}\n\nSafe summary:\n${description.summary ?? ""}`, profile.tokenBudget);
    return {
      sourceKind: "claude_session",
      sourceRef: description.sourceRef,
      sessionId: description.sessionId,
      text,
      tokenBudget: profile.tokenBudget,
      profile
    };
  }
  const summary = getLcmSummaryByRef(options.lcmDbPaths ?? [], parsed.dbHash, parsed.id);
  if (!summary) throw new Error(`Unknown LCM summary ref: ${options.sourceRef}`);
  const profile = resolveRecallProfile(options.profile, options.tokenBudget);
  const metadata = [
    `Summary ID: ${summary.summaryId}`,
    `Ref: ${lcmSummaryRef(summary.sourcePath, summary.summaryId)}`,
    `Conversation: ${summary.conversationTitle ?? summary.conversationId}`,
    `Conversation ID: ${summary.conversationId}`,
    summary.kind ? `Kind: ${summary.kind}` : null,
    summary.depth !== null ? `Depth: ${summary.depth}` : null,
    summary.tokenCount !== null ? `Token count: ${summary.tokenCount}` : null,
    summary.model ? `Model: ${summary.model}` : null,
    summary.updatedAt ? `Updated: ${summary.updatedAt}` : null,
    `Source path: ${summary.sourcePath}`
  ].filter(Boolean).join("\n");
  const text = profile.name === "metadata"
    ? metadata
    : truncateByApproxTokens(`${metadata}\n\nContent:\n${summary.content}`, profile.tokenBudget);
  return {
    sourceKind: "lcm_summary",
    sourceRef: lcmSummaryRef(summary.sourcePath, summary.summaryId),
    summaryId: summary.summaryId,
    text,
    tokenBudget: profile.tokenBudget,
    profile
  };
}

export function expandQuery(db: LooDatabase, options: {
  query: string;
  limit?: number;
  profile?: RecallProfileName;
  tokenBudget?: number;
  lcmDbPaths?: string[];
}): ExpandRecallResult {
  const grep = grepRecall(db, options);
  const first = grep.matches[0];
  if (!first) {
    const profile = resolveRecallProfile(options.profile, options.tokenBudget);
    return {
      sourceKind: "codex_thread",
      sourceRef: "",
      text: "",
      tokenBudget: profile.tokenBudget,
      profile,
      query: grep.query,
      matches: []
    };
  }
  return {
    ...expandRecallRef(db, { sourceRef: first.sourceRef, lcmDbPaths: options.lcmDbPaths, profile: options.profile, tokenBudget: options.tokenBudget }),
    query: grep.query,
    matches: grep.matches
  };
}

export function evaluateRetrievalScenarios(db: LooDatabase, options: {
  scenarios: RetrievalEvalScenario[];
  now?: string;
}): RetrievalEvalReport {
  const scenarios = options.scenarios.map((scenario) => evaluateRetrievalScenario(db, scenario));
  const baselineHitRate = rate(scenarios.filter((scenario) => scenario.baseline.hitAtK).length, scenarios.length);
  const hybridHitRate = rate(scenarios.filter((scenario) => scenario.hybrid.hitAtK).length, scenarios.length);
  const baselineMrr = average(scenarios.map((scenario) => scenario.baseline.reciprocalRank));
  const hybridMrr = average(scenarios.map((scenario) => scenario.hybrid.reciprocalRank));
  const blockers = [
    ...(scenarios.length === 0 ? ["no_scenarios"] : []),
    ...scenarios.flatMap((scenario) => scenario.hybrid.hitAtK ? [] : [`scenario_missed:${scenario.id}`]),
    ...(hybridHitRate < baselineHitRate ? ["hybrid_hit_rate_regressed"] : []),
    ...(hybridMrr < baselineMrr ? ["hybrid_mrr_regressed"] : [])
  ];
  return {
    ok: blockers.length === 0,
    publicSafe: true,
    generatedAt: options.now ?? new Date().toISOString(),
    strategy: "hybrid-expansion-rerank",
    vector: {
      enabled: false,
      reason: "Vector retrieval is not configured; this prototype scores query expansion and reranking only."
    },
    metrics: {
      scenarioCount: scenarios.length,
      baselineHitRate,
      hybridHitRate,
      baselineMrr,
      hybridMrr
    },
    scenarios,
    blockers,
    privateDataExclusions: [
      "raw Codex transcripts",
      "raw prompts or transcript spans",
      "SQLite DBs",
      "screenshots or videos",
      "tokens, credentials, API keys, cookies",
      "private customer data"
    ],
    proofBoundary: "This public-safe eval compares source refs and ranking metrics only; it does not prove production semantic search, vector quality, or private-store retrieval quality.",
    nextAction: blockers.length === 0
      ? "Add more redacted scenarios before enabling any hybrid retrieval path by default."
      : "Inspect missed scenario refs and improve expansion/reranking before claiming retrieval-quality movement."
  };
}

function searchLcmPeers(paths: string[], query: string, limit: number): RecallSearchResult[] {
  const matches: RecallSearchResult[] = [];
  for (const path of paths) {
    if (matches.length >= limit) break;
    let db: LooDatabase | null = null;
    try {
      const normalizedPath = normalizePeerPath(path);
      db = openLcmPeerDb(normalizedPath);
      matches.push(...searchLcmPeer(db, normalizedPath, query, limit - matches.length));
    } catch {
      // Peer reads are optional and must not break Codex recall.
    } finally {
      db?.close();
    }
  }
  return matches;
}

function evaluateRetrievalScenario(db: LooDatabase, scenario: RetrievalEvalScenario): RetrievalEvalScenarioResult {
  const limit = clamp(scenario.limit ?? 5, 1, 20);
  const expectedSourceRefs = unique(scenario.expectedSourceRefs.filter(Boolean));
  const baselineMatches = grepRecall(db, { query: scenario.query, limit }).matches;
  const expansionQueries = unique((scenario.expansionQueries ?? []).map((query) => query.trim()).filter(Boolean));
  const hybridMatches = rerankHybridMatches(db, scenario.query, expansionQueries, limit);
  return {
    id: scenario.id,
    query: scenario.query,
    expectedSourceRefs,
    limit,
    baseline: stageResult(baselineMatches, expectedSourceRefs, limit),
    hybrid: {
      ...stageResult(hybridMatches, expectedSourceRefs, limit),
      expansionQueries,
      reranker: "query-expansion-term-overlap"
    }
  };
}

function rerankHybridMatches(db: LooDatabase, query: string, expansionQueries: string[], limit: number): RecallSearchResult[] {
  const candidateLimit = clamp(Math.max(limit, 5), 1, 100);
  const queries = unique([query, ...expansionQueries]);
  const candidates = new Map<string, { match: RecallSearchResult; score: number; bestRank: number }>();
  queries.forEach((candidateQuery, queryIndex) => {
    grepRecall(db, { query: candidateQuery, limit: candidateLimit }).matches.forEach((match, matchIndex) => {
      const existing = candidates.get(match.sourceRef);
      const score = retrievalTermScore(match, candidateQuery) + (queryIndex === 0 ? 1 : 2);
      const bestRank = Math.min(existing?.bestRank ?? Number.POSITIVE_INFINITY, matchIndex + 1);
      candidates.set(match.sourceRef, {
        match,
        score: (existing?.score ?? 0) + score,
        bestRank
      });
    });
  });
  return [...candidates.values()]
    .sort((left, right) => right.score - left.score || left.bestRank - right.bestRank || left.match.sourceRef.localeCompare(right.match.sourceRef))
    .slice(0, limit)
    .map((entry, index) => ({ ...entry.match, score: index + 1 }));
}

function retrievalTermScore(match: RecallSearchResult, query: string): number {
  const haystack = [match.title, match.summary, match.snippet, match.sourceRef].filter(Boolean).join(" ").toLowerCase();
  return safeFtsTerms(query).reduce((score, term) => score + (haystack.includes(term.toLowerCase()) ? 1 : 0), 0);
}

function stageResult(matches: RecallSearchResult[], expectedSourceRefs: string[], limit: number): RetrievalEvalStageResult {
  const topRefs = matches.slice(0, limit).map((match) => match.sourceRef);
  const firstExpectedIndex = topRefs.findIndex((ref) => expectedSourceRefs.includes(ref));
  const firstExpectedRank = firstExpectedIndex >= 0 ? firstExpectedIndex + 1 : null;
  return {
    hitAtK: firstExpectedRank !== null,
    firstExpectedRank,
    reciprocalRank: firstExpectedRank === null ? 0 : 1 / firstExpectedRank,
    topRefs
  };
}

function searchLcmPeer(db: LooDatabase, path: string, query: string, limit: number): RecallSearchResult[] {
  if (!tableExists(db, "summaries")) return [];
  const hasFts = tableExists(db, "summaries_fts");
  const hasConversations = tableExists(db, "conversations");
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  if (hasFts) {
    try {
      const rows = db.prepare(`
        SELECT
          s.summary_id AS summaryId,
          s.conversation_id AS conversationId,
          ${hasConversations ? "c.title" : "NULL"} AS conversationTitle,
          s.kind,
          s.depth,
          s.content,
          s.token_count AS tokenCount,
          s.model,
          s.created_at AS createdAt,
          COALESCE(s.latest_at, s.created_at${hasConversations ? ", c.updated_at" : ""}) AS updatedAt,
          snippet(summaries_fts, 1, '[', ']', '...', 18) AS snippet
        FROM summaries_fts
        JOIN summaries s ON s.summary_id = summaries_fts.summary_id
        ${hasConversations ? "LEFT JOIN conversations c ON c.conversation_id = s.conversation_id" : ""}
        WHERE summaries_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(safeFtsTerms(query).join(" "), limit) as Array<Record<string, unknown>>;
      if (rows.length > 0) return rows.map((row, index) => lcmSearchResult(path, row, query, index));
    } catch {
      // Fall back to LIKE below when peer FTS is unavailable or extension-backed.
    }
  }
  const where = terms.map(() => "s.content LIKE ? ESCAPE '\\'").join(" AND ");
  const rows = db.prepare(`
    SELECT
      s.summary_id AS summaryId,
      s.conversation_id AS conversationId,
      ${hasConversations ? "c.title" : "NULL"} AS conversationTitle,
      s.kind,
      s.depth,
      s.content,
      s.token_count AS tokenCount,
      s.model,
      s.created_at AS createdAt,
      COALESCE(s.latest_at, s.created_at${hasConversations ? ", c.updated_at" : ""}) AS updatedAt
    FROM summaries s
    ${hasConversations ? "LEFT JOIN conversations c ON c.conversation_id = s.conversation_id" : ""}
    WHERE ${where}
    ORDER BY COALESCE(s.latest_at, s.created_at) DESC
    LIMIT ?
  `).all(...terms.map((term) => `%${escapeLike(term)}%`), limit) as Array<Record<string, unknown>>;
  return rows.map((row, index) => lcmSearchResult(path, row, query, index));
}

function lcmSearchResult(path: string, row: Record<string, unknown>, query: string, index: number): RecallSearchResult {
  const summaryId = String(row.summaryId);
  const content = redactSafeString(String(row.content ?? ""));
  const title = nullableString(row.conversationTitle) ?? `LCM summary ${summaryId}`;
  return {
    sourceKind: "lcm_summary",
    sourceRef: lcmSummaryRef(path, summaryId),
    summaryId,
    conversationId: Number(row.conversationId ?? 0),
    title,
    summary: truncate(content, 300),
    updatedAt: nullableString(row.updatedAt ?? row.createdAt),
    score: index + 1,
    snippet: redactSafeString(String(row.snippet ?? createSnippet(content, query))),
    sourcePath: path
  };
}

function getLcmSummaryByRef(paths: string[], dbHash: string, summaryId: string): LcmSummaryRecord | null {
  const path = normalizePeerPaths(paths).find((candidate) => lcmPeerHash(candidate) === dbHash);
  if (!path) return null;
  let db: LooDatabase | null = null;
  try {
    db = openLcmPeerDb(path);
    if (!tableExists(db, "summaries")) return null;
    const hasConversations = tableExists(db, "conversations");
    const row = db.prepare(`
      SELECT
        s.summary_id AS summaryId,
        s.conversation_id AS conversationId,
        ${hasConversations ? "c.title" : "NULL"} AS conversationTitle,
        s.kind,
        s.depth,
        s.content,
        s.token_count AS tokenCount,
        s.model,
        s.created_at AS createdAt,
        COALESCE(s.latest_at, s.created_at${hasConversations ? ", c.updated_at" : ""}) AS updatedAt
      FROM summaries s
      ${hasConversations ? "LEFT JOIN conversations c ON c.conversation_id = s.conversation_id" : ""}
      WHERE s.summary_id = ?
    `).get(summaryId) as Record<string, unknown> | undefined;
    return row ? lcmSummaryRecord(path, row) : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function lcmSummaryRecord(path: string, row: Record<string, unknown>): LcmSummaryRecord {
  return {
    summaryId: String(row.summaryId),
    conversationId: Number(row.conversationId ?? 0),
    conversationTitle: nullableString(row.conversationTitle),
    kind: nullableString(row.kind),
    depth: row.depth === null || row.depth === undefined ? null : Number(row.depth),
    content: redactSafeString(String(row.content ?? "")),
    tokenCount: row.tokenCount === null || row.tokenCount === undefined ? null : Number(row.tokenCount),
    createdAt: nullableString(row.createdAt),
    updatedAt: nullableString(row.updatedAt),
    model: nullableString(row.model),
    sourcePath: path
  };
}

function lcmSummaryDescription(summary: LcmSummaryRecord): RecallDescription {
  return {
    sourceKind: "lcm_summary",
    sourceRef: lcmSummaryRef(summary.sourcePath, summary.summaryId),
    title: summary.conversationTitle,
    summary: truncate(summary.content, 500),
    updatedAt: summary.updatedAt,
    sourcePath: summary.sourcePath,
    summaryId: summary.summaryId,
    conversationId: summary.conversationId,
    kind: summary.kind,
    depth: summary.depth,
    tokenCount: summary.tokenCount,
    model: summary.model
  };
}

function probeLcmPeerDb(path: string): LcmPeerProbe {
  let normalizedPath = path;
  try {
    normalizedPath = normalizePeerPath(path);
    const db = openLcmPeerDb(normalizedPath);
    try {
      const tables = listTables(db);
      const supported = tables.includes("summaries");
      const summaryCount = supported ? Number((db.prepare("SELECT COUNT(*) AS count FROM summaries").get() as { count: number }).count) : null;
      return {
        path: normalizedPath,
        readable: true,
        readOnly: true,
        queryOnly: queryOnlyEnabled(db),
        supported,
        tables: tables.filter((table) => ["summaries", "summaries_fts", "conversations", "summary_messages", "summary_parents"].includes(table)),
        summaryCount,
        ftsAvailable: tables.includes("summaries_fts"),
        reason: supported ? null : "missing summaries table"
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      path: normalizedPath,
      readable: false,
      readOnly: true,
      queryOnly: false,
      supported: false,
      tables: [],
      summaryCount: null,
      ftsAvailable: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function openLcmPeerDb(path: string): LooDatabase {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec("PRAGMA query_only = ON");
  return db;
}

function tableExists(db: LooDatabase, name: string): boolean {
  const row = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type IN ('table', 'virtual table') AND name = ?").get(name) as { found: number } | undefined;
  return row?.found === 1;
}

function listTables(db: LooDatabase): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
}

function queryOnlyEnabled(db: LooDatabase): boolean {
  const row = db.prepare("PRAGMA query_only").get() as Record<string, unknown> | undefined;
  return Number(Object.values(row ?? {})[0] ?? 0) === 1;
}

function resolveRecallProfile(profile: RecallProfileName = "brief", tokenBudget?: number): RecallProfile {
  if (profile === "metadata") {
    return {
      name: "metadata",
      tokenBudget: 0,
      description: "Metadata-only source map with no expanded summary or plan body."
    };
  }
  const defaultBudget = profile === "evidence" ? 4000 : 1000;
  return {
    name: profile,
    tokenBudget: clamp(tokenBudget ?? defaultBudget, 20, 8000),
    description: profile === "evidence" ? "4k evidence bundle." : "1k recall brief."
  };
}

function codexThreadRef(threadId: string): string {
  return `codex_thread:${threadId}`;
}

function bareCodexThreadId(threadRef: string): string {
  return threadRef.startsWith("codex_thread:") ? threadRef.slice("codex_thread:".length) : threadRef;
}

function publicSourcePathRef(sourcePath: string): string {
  return `codex_source:${stableId(sourcePath).slice(0, 16)}`;
}

function publicSafeText(value: string, maxChars = 500): string {
  const redacted = redactSafeString(value)
    .replace(/\/Volumes\/[^\s"'`)]+/g, "<redacted-path>")
    .replace(/\/(?:Users|home)\/[^/\s"'`)]+\/\.codex\/[^\s"'`)]+/g, "<redacted-path>")
    .replace(/\/root\/\.codex\/[^\s"'`)]+/g, "<redacted-path>")
    .replace(/\/(?:private\/)?(?:tmp|var)\/[^\s"'`)]+/g, "<redacted-path>")
    .replace(/~\/\.codex\/[^\s"'`)]+/g, "<redacted-path>");
  return truncate(redacted, maxChars);
}

function operatingWindowStartMs(window: OperatingDigest["window"], nowMs: number = Date.now()): number | null {
  const now = new Date(nowMs);
  if (window === "24h") return nowMs - 24 * 60 * 60 * 1000;
  if (window === "7d") return nowMs - 7 * 24 * 60 * 60 * 1000;
  if (window === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return null;
}

function signalWithinOperatingWindow(signal: OperatingSignal, windowStartMs: number | null): boolean {
  if (windowStartMs === null || signal.observedAt === null) return true;
  const observedAtMs = Date.parse(signal.observedAt);
  return !Number.isFinite(observedAtMs) || observedAtMs >= windowStartMs;
}

function claudeSessionRef(sessionId: string): string {
  return `claude_session:${encodeURIComponent(sessionId)}`;
}

function safeClaudeSessionId(value: string): string {
  const trimmed = value.trim();
  const redacted = redactSafeString(trimmed);
  if (trimmed && redacted === trimmed && /^[A-Za-z0-9._-]{1,96}$/.test(trimmed)) return trimmed;
  return `claude_${stableId(trimmed).slice(0, 16)}`;
}

function normalizeClaudeSessionRef(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("claude_session:")) return null;
  const encodedId = value.slice("claude_session:".length);
  if (!encodedId) return null;
  let decodedId = encodedId;
  try {
    decodedId = decodeURIComponent(encodedId);
  } catch {
    decodedId = encodedId;
  }
  return claudeSessionRef(safeClaudeSessionId(decodedId));
}

function lcmSummaryRef(path: string, summaryId: string): string {
  return `lcm_summary:${lcmPeerHash(path)}:${encodeURIComponent(summaryId)}`;
}

function lcmPeerHash(path: string): string {
  return stableId(normalizePeerPath(path)).slice(0, 12);
}

function parseSourceRef(sourceRef: string): { kind: "codex_thread"; id: string } | { kind: "claude_session"; id: string } | { kind: "lcm_summary"; dbHash: string; id: string } {
  if (sourceRef.startsWith("codex_thread:")) {
    const id = sourceRef.slice("codex_thread:".length);
    if (!id) throw new Error("codex_thread source ref is missing thread id");
    return { kind: "codex_thread", id };
  }
  if (sourceRef.startsWith("claude_session:")) {
    const id = sourceRef.slice("claude_session:".length);
    if (!id) throw new Error("claude_session source ref is missing session id");
    return { kind: "claude_session", id: decodeURIComponent(id) };
  }
  if (sourceRef.startsWith("lcm_summary:")) {
    const rest = sourceRef.slice("lcm_summary:".length);
    const separator = rest.indexOf(":");
    const dbHash = separator >= 0 ? rest.slice(0, separator) : "";
    const encodedId = separator >= 0 ? rest.slice(separator + 1) : "";
    if (!dbHash || !encodedId) throw new Error("lcm_summary source ref must be lcm_summary:<db-hash>:<summary-id>");
    return { kind: "lcm_summary", dbHash, id: decodeURIComponent(encodedId) };
  }
  throw new Error(`Unsupported source ref: ${sourceRef}`);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizePeerPaths(paths: string[]): string[] {
  return paths.flatMap((path) => {
    try {
      return [normalizePeerPath(path)];
    } catch {
      return [];
    }
  });
}

function queryTerms(query: string): string[] {
  return query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 12) ?? [];
}

function normalizePeerPath(path: string): string {
  if (path === "~") return resolve(homeDirectory());
  if (path.startsWith("~/")) return resolve(join(homeDirectory(), path.slice(2)));
  return resolve(path);
}

function homeDirectory(): string {
  const home = homedir();
  if (!home) throw new Error("Cannot resolve home-relative LCM peer path");
  return home;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectJsonlFiles(roots: string[], maxFiles: number): string[] {
  const files: string[] = [];
  for (const root of roots) {
    if (!existsSync(root) || files.length >= maxFiles) continue;
    walk(root, files, maxFiles);
  }
  return files;
}

function walk(path: string, files: string[], maxFiles: number): void {
  if (files.length >= maxFiles) return;
  const entries = readdirSync(path, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= maxFiles) return;
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(child, files, maxFiles);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(child);
    }
  }
}

function countJsonlEvents(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function parseCodexJsonl(sourcePath: string, text: string): ImportedSession {
  const fallbackId = fallbackThreadId(sourcePath);
  const session: ImportedSession = {
    threadId: fallbackId.replace(/^rollout-[^-]+-/, ""),
    title: null,
    cwd: null,
    model: null,
    branch: null,
    gitSha: null,
    createdAt: null,
    updatedAt: null,
    finalMessage: null,
    plans: [],
    touchedFiles: [],
    toolCalls: [],
    metadata: emptySessionMetadata(),
    closeoutEnvelopeText: null,
    closeoutEnvelopeOpenCount: 0,
    closeoutEnvelopeCloseCount: 0,
    safeText: "",
    eventCount: 0
  };

  const safeParts: string[] = [];
  const touched = new Set<string>();
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (let i = 0; i < lines.length; i += 1) {
    let item: any;
    try {
      item = JSON.parse(lines[i]!);
    } catch {
      continue;
    }
    session.eventCount += 1;
    const timestamp = findTimestamp(item);
    if (timestamp) {
      session.createdAt ??= timestamp;
      session.updatedAt = timestamp;
    }
    const meta = item.session_meta?.payload ?? item.session_meta ?? item.turn_context?.payload ?? null;
    if (meta) {
      session.threadId = String(meta.id ?? meta.thread_id ?? session.threadId);
      const cwd = stringOrNull(meta.cwd ?? meta.workdir ?? session.cwd);
      session.cwd = cwd ? redactSafeString(cwd) : null;
      session.model = stringOrNull(meta.model ?? session.model);
      session.branch = stringOrNull(meta.git?.branch ?? meta.git_branch ?? session.branch);
      session.gitSha = stringOrNull(meta.git?.commit_hash ?? meta.git_sha ?? session.gitSha);
    }

    const title = item.event_msg?.name ?? item.thread_name ?? item.payload?.title;
    if (typeof title === "string" && title.trim()) {
      session.title = redactSafeString(title.trim());
      safeParts.push(session.title);
    }

    const textPayloads = extractTextPayloads(item);
    for (const payload of textPayloads) {
      const metadataText = redactSafeString(payload.trim());
      if (metadataText) {
        mergeSessionMetadata(session.metadata, extractSessionMetadata(metadataText));
        recordCloseoutEnvelopeEvidence(session, metadataText);
      }
      const clean = redactSafeString(normalizeText(payload));
      if (!clean) continue;
      safeParts.push(clean);
      for (const plan of extractPlans(clean)) session.plans.push(plan);
      if (isLikelyFinal(clean)) session.finalMessage = clean;
      for (const file of extractTouchedFiles(clean)) touched.add(file);
    }

    const responseItem = item.response_item ?? item.item ?? item.payload;
    if (responseItem?.type === "function_call" || responseItem?.call_id || responseItem?.name?.includes?.(".")) {
      const callId = String(responseItem.call_id ?? responseItem.id ?? stableId(`${sourcePath}:${i}`));
      const toolName = String(responseItem.name ?? responseItem.tool_name ?? "unknown");
      const args = redactSafeString(stringifyMaybe(responseItem.arguments ?? responseItem.input ?? ""));
      session.toolCalls.push({ callId, toolName, argumentsText: args });
      for (const file of extractTouchedFiles(args)) touched.add(file);
      safeParts.push(`${toolName} ${args}`);
    }
  }

  session.touchedFiles = [...touched].sort();
  session.safeText = safeParts.join("\n").slice(0, 250_000);
  session.finalMessage ??= lastAssistantText(safeParts);
  session.title ??= session.finalMessage ? truncate(session.finalMessage, 80) : session.threadId;
  session.updatedAt ??= new Date().toISOString();
  session.createdAt ??= session.updatedAt;
  return session;
}

function fallbackThreadId(sourcePath: string): string {
  const name = basename(sourcePath).replace(/\.jsonl$/i, "");
  const uuidLike = name.match(/(019[0-9a-f]{5,}(?:-[0-9a-f]{4,}){2,})/i)?.[1];
  if (uuidLike) return uuidLike;
  const rolloutSuffix = name.match(/^rollout-.+?-([0-9a-f][0-9a-f-]{16,})$/i)?.[1];
  return rolloutSuffix ?? stableId(sourcePath);
}

function upsertSession(db: LooDatabase, sourcePath: string, rawText: string, session: ImportedSession, stat: { size: number; mtimeMs: number }): void {
  const now = new Date().toISOString();
  const sourceHash = stableId(rawText);
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO codex_source_files (source_path, path_hash, size, mtime_ms, last_indexed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_path) DO UPDATE SET path_hash = excluded.path_hash, size = excluded.size, mtime_ms = excluded.mtime_ms, last_indexed_at = excluded.last_indexed_at
    `).run(sourcePath, sourceHash, stat.size, stat.mtimeMs, now);
    db.prepare(`
      INSERT INTO codex_sessions (
        thread_id, title, cwd, model, branch, git_sha, source_path, created_at, updated_at,
        summary, final_message, safe_text, event_count, tool_call_count, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        title = excluded.title,
        cwd = excluded.cwd,
        model = excluded.model,
        branch = excluded.branch,
        git_sha = excluded.git_sha,
        source_path = excluded.source_path,
        updated_at = excluded.updated_at,
        summary = excluded.summary,
        final_message = excluded.final_message,
        safe_text = excluded.safe_text,
        event_count = excluded.event_count,
        tool_call_count = excluded.tool_call_count,
        indexed_at = excluded.indexed_at
    `).run(
      session.threadId,
      session.title,
      session.cwd,
      session.model,
      session.branch,
      session.gitSha,
      sourcePath,
      session.createdAt,
      session.updatedAt,
      buildSummary(session),
      session.finalMessage,
      session.safeText,
      session.eventCount,
      session.toolCalls.length,
      now
    );
    db.prepare("DELETE FROM codex_plans WHERE thread_id = ?").run(session.threadId);
    db.prepare("DELETE FROM codex_touched_files WHERE thread_id = ?").run(session.threadId);
    db.prepare("DELETE FROM codex_tool_calls WHERE thread_id = ?").run(session.threadId);
    db.prepare("DELETE FROM codex_safe_text_fts WHERE thread_id = ?").run(session.threadId);
    db.prepare(`
      INSERT INTO codex_session_metadata (
        thread_id, project, status, priority, owner, blocker, next_action, closeout_state, plan_completion_state,
        proposed_plan_refs_json, final_message_refs_json, touched_file_refs_json,
        closeout_envelope_text, closeout_envelope_open_count, closeout_envelope_close_count,
        source_refs_json, metadata_schema_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        project = excluded.project,
        status = excluded.status,
        priority = excluded.priority,
        owner = excluded.owner,
        blocker = excluded.blocker,
        next_action = excluded.next_action,
        closeout_state = excluded.closeout_state,
        plan_completion_state = excluded.plan_completion_state,
        proposed_plan_refs_json = excluded.proposed_plan_refs_json,
        final_message_refs_json = excluded.final_message_refs_json,
        touched_file_refs_json = excluded.touched_file_refs_json,
        closeout_envelope_text = excluded.closeout_envelope_text,
        closeout_envelope_open_count = excluded.closeout_envelope_open_count,
        closeout_envelope_close_count = excluded.closeout_envelope_close_count,
        source_refs_json = excluded.source_refs_json,
        metadata_schema_version = excluded.metadata_schema_version
    `).run(
      session.threadId,
      session.metadata.project,
      session.metadata.status,
      session.metadata.priority,
      session.metadata.owner,
      session.metadata.blocker,
      session.metadata.nextAction,
      session.metadata.closeoutState,
      session.metadata.planCompletionState,
      JSON.stringify(session.metadata.proposedPlanRefs),
      JSON.stringify(session.metadata.finalMessageRefs),
      JSON.stringify(session.metadata.touchedFileRefs),
      session.closeoutEnvelopeText,
      session.closeoutEnvelopeOpenCount,
      session.closeoutEnvelopeCloseCount,
      JSON.stringify(session.metadata.sourceRefs),
      SESSION_METADATA_SCHEMA_VERSION
    );
    session.plans.forEach((plan, index) => {
      db.prepare("INSERT INTO codex_plans (plan_id, thread_id, text, ordinal) VALUES (?, ?, ?, ?)").run(stableId(`${session.threadId}:plan:${index}:${plan}`), session.threadId, plan, index);
    });
    session.touchedFiles.forEach((file) => {
      db.prepare("INSERT OR IGNORE INTO codex_touched_files (touched_file_id, thread_id, path, source_kind) VALUES (?, ?, ?, ?)").run(stableId(`${session.threadId}:file:${file}`), session.threadId, file, "codex_text");
    });
    session.toolCalls.forEach((call) => {
      db.prepare("INSERT OR REPLACE INTO codex_tool_calls (call_id, thread_id, tool_name, arguments_text) VALUES (?, ?, ?, ?)").run(call.callId, session.threadId, call.toolName, call.argumentsText);
    });
    db.prepare("INSERT INTO codex_safe_text_fts (thread_id, content) VALUES (?, ?)").run(session.threadId, session.safeText);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function collectSqliteFiles(roots: string[], maxFiles: number): string[] {
  const files: string[] = [];
  for (const root of roots) {
    if (!existsSync(root) || files.length >= maxFiles) continue;
    try {
      const stat = statSync(root);
      if (stat.isFile()) {
        if (/^(state|logs)_\d+\.sqlite$/i.test(basename(root))) {
          files.push(root);
        }
        continue;
      }
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    walkSqlite(root, files, maxFiles);
  }
  return files;
}

function walkSqlite(path: string, files: string[], maxFiles: number): void {
  if (files.length >= maxFiles) return;
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= maxFiles) return;
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walkSqlite(child, files, maxFiles);
    } else if (entry.isFile() && /^(state|logs)_\d+\.sqlite$/i.test(entry.name)) {
      files.push(child);
    }
  }
}

function probeCodexSqliteStore(path: string): CodexSqliteProbe {
  const name = basename(path).toLowerCase();
  const kind: CodexSqliteProbe["kind"] = name.startsWith("state_") ? "state" : name.startsWith("logs_") ? "logs" : "unknown";
  try {
    const DatabaseSync = getDatabaseSync();
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec("PRAGMA query_only = ON");
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
      const supported = kind === "state" ? tables.some((table) => ["threads", "sessions", "conversations"].includes(table)) : tables.some((table) => ["events", "logs", "turns"].includes(table));
      return {
        path,
        kind,
        supported,
        tables,
        reason: supported ? null : `missing supported tables for ${kind} store`
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      path,
      kind,
      supported: false,
      tables: [],
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildSummary(session: ImportedSession): string {
  const tools = unique(session.toolCalls.map((call) => call.toolName).filter(Boolean));
  const branch = session.branch ? `${session.branch}${session.gitSha ? `@${truncate(session.gitSha, 12)}` : ""}` : null;
  const files = session.touchedFiles.slice(0, 3);
  const parts = [
    session.title ? `Title: ${session.title}` : null,
    session.model ? `Model: ${session.model}` : null,
    branch ? `Branch: ${branch}` : null,
    session.cwd ? `CWD: ${session.cwd}` : null,
    session.finalMessage ? `Final: ${truncate(session.finalMessage, 240)}` : null,
    session.plans[0] ? `Plan: ${truncate(session.plans[0], 240)}` : null,
    files.length ? `Files: ${files.join(", ")}${session.touchedFiles.length > files.length ? ` +${session.touchedFiles.length - files.length} more` : ""}` : null,
    tools.length ? `Tools: ${tools.slice(0, 5).join(", ")}${tools.length > 5 ? ` +${tools.length - 5} more` : ""}` : null
  ].filter(Boolean);
  return truncate(parts.join(" "), 900);
}

const SESSION_METADATA_LABELS: Array<{ field: keyof Omit<SessionMetadata, "proposedPlanRefs" | "finalMessageRefs" | "touchedFileRefs" | "sourceRefs">; labels: string[] }> = [
  { field: "closeoutState", labels: ["closeout state", "closeout"] },
  { field: "planCompletionState", labels: ["proposed plan completion", "plan completion", "completion marker"] },
  { field: "project", labels: ["project", "repo", "repository"] },
  { field: "status", labels: ["status"] },
  { field: "priority", labels: ["priority", "urgency"] },
  { field: "owner", labels: ["owner", "agent"] },
  { field: "blocker", labels: ["blocker", "blocked by"] },
  { field: "nextAction", labels: ["next action", "next"] }
];

const SESSION_METADATA_REF_LABELS: Array<{ field: keyof Pick<SessionMetadata, "proposedPlanRefs" | "finalMessageRefs" | "touchedFileRefs" | "sourceRefs">; labels: string[] }> = [
  { field: "proposedPlanRefs", labels: ["proposed plan refs", "proposed-plan refs", "plan refs"] },
  { field: "finalMessageRefs", labels: ["final message refs", "final-message refs", "final refs"] },
  { field: "touchedFileRefs", labels: ["touched file refs", "touched-file refs", "file refs"] },
  { field: "sourceRefs", labels: ["source refs", "source ref", "refs", "ref"] }
];

const CLOSEOUT_ENVELOPE_LABEL_BOUNDARIES = unique([
  ...SESSION_METADATA_LABELS.flatMap((definition) => definition.labels),
  ...SESSION_METADATA_REF_LABELS.flatMap((definition) => definition.labels)
].map(capitalizeLabelStart)).sort((left, right) => right.length - left.length);

type SessionMetadataTextField = keyof Omit<SessionMetadata, "proposedPlanRefs" | "finalMessageRefs" | "touchedFileRefs" | "sourceRefs">;
type SessionMetadataRefField = keyof Pick<SessionMetadata, "proposedPlanRefs" | "finalMessageRefs" | "touchedFileRefs" | "sourceRefs">;

type ExtractedSessionMetadata = {
  metadata: SessionMetadata;
  presentTextFields: Set<SessionMetadataTextField>;
  presentRefFields: Set<SessionMetadataRefField>;
};

function emptySessionMetadata(): SessionMetadata {
  return {
    project: null,
    status: null,
    priority: null,
    owner: null,
    blocker: null,
    nextAction: null,
    closeoutState: null,
    planCompletionState: null,
    proposedPlanRefs: [],
    finalMessageRefs: [],
    touchedFileRefs: [],
    sourceRefs: []
  };
}

function extractSessionMetadata(text: string): ExtractedSessionMetadata {
  const metadata = emptySessionMetadata();
  const presentTextFields = new Set<SessionMetadataTextField>();
  const presentRefFields = new Set<SessionMetadataRefField>();
  for (const definition of SESSION_METADATA_LABELS) {
    const raw = extractRawLabeledValue(text, definition.labels);
    if (raw !== null) {
      presentTextFields.add(definition.field);
      metadata[definition.field] = cleanMetadataValue(raw);
    }
  }
  for (const definition of SESSION_METADATA_REF_LABELS) {
    const raw = extractRawLabeledValue(text, definition.labels);
    if (raw !== null) {
      presentRefFields.add(definition.field);
      metadata[definition.field] = extractSourceRefs(raw);
    }
  }
  return { metadata, presentTextFields, presentRefFields };
}

function mergeSessionMetadata(target: SessionMetadata, source: ExtractedSessionMetadata): void {
  const metadata = source.metadata;
  for (const field of ["project", "status", "priority", "owner", "blocker", "nextAction", "closeoutState", "planCompletionState"] as const) {
    if (source.presentTextFields.has(field)) target[field] = metadata[field];
  }
  for (const field of ["proposedPlanRefs", "finalMessageRefs", "touchedFileRefs", "sourceRefs"] as const) {
    if (source.presentRefFields.has(field)) target[field] = metadata[field];
  }
}

function extractRawLabeledValue(text: string, labels: string[]): string | null {
  const labelPattern = labels.map(escapeRegExp).join("|");
  const allLabels = [
    ...SESSION_METADATA_LABELS.flatMap((definition) => definition.labels),
    ...SESSION_METADATA_REF_LABELS.flatMap((definition) => definition.labels)
  ];
  const nextLabelPattern = allLabels.sort((left, right) => right.length - left.length).map(escapeRegExp).join("|");
  const labelStart = "(?:^\\s*(?:[-*]\\s*)?|[\\r\\n;.]\\s*(?:[-*]\\s*)?|\\s[-*]\\s*)";
  const nextLabelStart = "(?:[\\r\\n;.]\\s*(?:[-*]\\s*)?|\\s[-*]\\s*)";
  const match = text.match(new RegExp(`${labelStart}(${labelPattern})\\s*:\\s*([\\s\\S]*?)(?=\\s*${nextLabelStart}(?:${nextLabelPattern})\\s*:|$)`, "i"));
  return match ? (match[2]?.trim() ?? "") : null;
}

function cleanMetadataValue(value: string): string | null {
  const clean = value.replace(/^[\s:;-]+/, "").replace(/[\s;]+$/, "").trim();
  if (!clean || /^none$/i.test(clean) || /^n\/a$/i.test(clean)) return null;
  return truncate(clean, 180);
}

function extractSourceRefs(text: string): string[] {
  const refs = text.match(/\b(?:codex_thread|codex_event|lcm_summary|claude_session):[A-Za-z0-9._:/%-]+/g) ?? [];
  return unique(refs.map((ref) => ref.replace(/[).,"'`;]+$/, "")));
}

function formatSessionMetadata(metadata: SessionMetadata): string | null {
  const lines = [
    metadata.project ? `Project: ${metadata.project}` : null,
    metadata.status ? `Status: ${metadata.status}` : null,
    metadata.priority ? `Priority: ${metadata.priority}` : null,
    metadata.owner ? `Owner: ${metadata.owner}` : null,
    metadata.blocker ? `Blocker: ${metadata.blocker}` : null,
    metadata.nextAction ? `Next action: ${metadata.nextAction}` : null,
    metadata.closeoutState ? `Closeout state: ${metadata.closeoutState}` : null,
    metadata.planCompletionState ? `Proposed plan completion: ${metadata.planCompletionState}` : null,
    metadata.proposedPlanRefs.length ? `Proposed plan refs: ${metadata.proposedPlanRefs.join(", ")}` : null,
    metadata.finalMessageRefs.length ? `Final-message refs: ${metadata.finalMessageRefs.join(", ")}` : null,
    metadata.touchedFileRefs.length ? `Touched-file refs: ${metadata.touchedFileRefs.join(", ")}` : null,
    metadata.sourceRefs.length ? `Source refs: ${metadata.sourceRefs.join(", ")}` : null
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

function getSessionMetadata(db: LooDatabase, threadId: string): SessionMetadata {
  const row = db.prepare(`
    SELECT
      project,
      status,
      priority,
      owner,
      blocker,
      next_action AS nextAction,
      closeout_state AS closeoutState,
      plan_completion_state AS planCompletionState,
      proposed_plan_refs_json AS proposedPlanRefsJson,
      final_message_refs_json AS finalMessageRefsJson,
      touched_file_refs_json AS touchedFileRefsJson,
      source_refs_json AS sourceRefsJson
    FROM codex_session_metadata
    WHERE thread_id = ?
  `).get(threadId) as Record<string, unknown> | undefined;
  if (!row) return emptySessionMetadata();
  return sessionMetadataFromRow(row);
}

function sessionMetadataFromRow(row: Record<string, unknown>): SessionMetadata {
  return {
    project: nullableString(row.project),
    status: nullableString(row.status),
    priority: nullableString(row.priority),
    owner: nullableString(row.owner),
    blocker: nullableString(row.blocker),
    nextAction: nullableString(row.nextAction),
    closeoutState: nullableString(row.closeoutState),
    planCompletionState: nullableString(row.planCompletionState),
    proposedPlanRefs: parseSourceRefsJson(row.proposedPlanRefsJson),
    finalMessageRefs: parseSourceRefsJson(row.finalMessageRefsJson),
    touchedFileRefs: parseSourceRefsJson(row.touchedFileRefsJson),
    sourceRefs: parseSourceRefsJson(row.sourceRefsJson)
  };
}

function parseSourceRefsJson(value: unknown): string[] {
  try {
    const parsed = JSON.parse(typeof value === "string" ? value : "[]");
    return Array.isArray(parsed) ? unique(parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)) : [];
  } catch {
    return [];
  }
}

function extractTextPayloads(item: any): string[] {
  const out: string[] = [];
  const candidates = [
    item.event_msg?.message,
    item.event_msg?.text,
    item.response_item?.text,
    item.response_item?.content,
    item.message?.content,
    item.payload?.message,
    item.payload?.text
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") out.push(candidate);
    if (Array.isArray(candidate)) {
      for (const part of candidate) {
        if (typeof part === "string") out.push(part);
        if (typeof part?.text === "string") out.push(part.text);
      }
    }
  }
  return out;
}

function extractPlans(text: string): string[] {
  return [...text.matchAll(/<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/gi)].map((match) => match[1]?.trim() ?? "").filter(Boolean);
}

function extractTouchedFiles(text: string): string[] {
  const matches = text.match(/(?:\/Volumes\/LEXAR|\/Users|~\/|\.\/|packages\/|src\/|tests\/)[A-Za-z0-9._~/%@:+\-=]+/g) ?? [];
  return matches.map((match) => match.replace(/[).,"'`;:]+$/, "")).filter((match) => match.includes("/") && !match.endsWith("/"));
}

function safeFtsTerms(query: string): string[] {
  return query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 12).map((term) => `"${term.replaceAll('"', '""')}"`) ?? [];
}

function isLikelyFinal(text: string): boolean {
  return /(^|\b)(final|next action|complete|summary|closeout)\b/i.test(text);
}

function lastAssistantText(parts: string[]): string | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]?.trim();
    if (part) return truncate(part, 900);
  }
  return null;
}

function findTimestamp(item: any): string | null {
  const value = item.timestamp ?? item.ts ?? item.created_at ?? item.event_msg?.timestamp;
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  return null;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function redactSafeString(value: string): string {
  let redacted = value.replace(/\/Users\/[^/\s"'`)]+/g, "~");
  redacted = redacted.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<redacted-secret>");
  redacted = redacted.replace(/sk-[A-Za-z0-9_-]{10,}/g, "<redacted-secret>");
  redacted = redacted.replace(/(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, "$1<redacted-secret>");
  redacted = redacted.replace(/(Basic\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1<redacted-secret>");
  redacted = redacted.replace(/(\bauthorization\s*:\s*)[^\r\n"'`)]+/gi, "$1<redacted-secret>");
  redacted = redacted.replace(/(\bcookie\s*:\s*)[^\r\n"'`)]+/gi, "$1<redacted-secret>");
  return redacted;
}

function stringifyMaybe(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stableId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function truncateByApproxTokens(text: string, tokenBudget: number): string {
  return truncate(text, tokenBudget * 4);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function safeNullableFixtureString(value: unknown): string | null {
  const raw = stringOrNull(value);
  return raw ? redactSafeString(raw) : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function createSnippet(text: string, query: string): string {
  const lower = text.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index < 0) return truncate(text, 240);
  return truncate(text.slice(Math.max(0, index - 80), index + query.length + 160), 260);
}
