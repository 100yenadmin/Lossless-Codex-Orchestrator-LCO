import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import {
  createSessionSanitizerRepairPlan,
  createSessionSanitizerReport,
  type SessionSanitizerRepairPlan,
  type SessionSanitizerReport,
  type SessionSanitizerSource
} from "./session-sanitizer.js";
import {
  CODEX_SEARCH_FTS_MIGRATION_ID,
  CODEX_SEARCH_FTS_TERM_CAP,
  CODEX_SEARCH_FTS_WEIGHTS,
  createSnippet,
  deleteCodexSearchFtsForSessionRowid,
  escapeLike,
  insertCodexSearchFtsForThreadRowid,
  lexicalQueryTerms,
  rebuildCodexSearchFts,
  safeFtsTerms,
  searchCodexSessions
} from "./search.js";
import type { CodexSearchMatchFeatures } from "./search.js";
import { readEnv, resolveHomeDir } from "../../runtime/src/env.js";

export { createSessionSanitizerRepairPlan, createSessionSanitizerReport } from "./session-sanitizer.js";
export { CODEX_SEARCH_FTS_WEIGHTS, normalizeBm25TextScores } from "./search.js";
export type { CodexSearchMatchFeatures } from "./search.js";
export {
  AGENT_PROVENANCE_PARSE_SCHEMA,
  AGENT_PROVENANCE_SCHEMA,
  findAgentProvenanceRecords,
  parseAgentProvenanceText
} from "./agent-provenance.js";
export type {
  AgentProvenanceFinding,
  AgentProvenanceLookup,
  AgentProvenanceMarkerKind,
  AgentProvenanceParseReport,
  AgentProvenanceRecord,
  AgentProvenanceSourceKind,
  ParseAgentProvenanceOptions
} from "./agent-provenance.js";
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
type DatabaseSyncConstructor = new (path: string, options?: { readOnly?: boolean; timeout?: number }) => NodeDatabaseSync;
export type DatabaseMaintenanceMode = "full" | "schema-only";
export type CreateDatabaseOptions = {
  path?: string;
  maintenance?: DatabaseMaintenanceMode;
  busyTimeoutMs?: number;
};
type CreateDatabasePathOptions = Omit<CreateDatabaseOptions, "path">;

const require = createRequire(import.meta.url);
let cachedDatabaseSync: DatabaseSyncConstructor | null = null;

function getDatabaseSync(): DatabaseSyncConstructor {
  if (!cachedDatabaseSync) {
    cachedDatabaseSync = withSuppressedNodeSqliteExperimentalWarning(
      () => (require("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor }).DatabaseSync
    );
  }
  return cachedDatabaseSync;
}

function withSuppressedNodeSqliteExperimentalWarning<T>(load: () => T): T {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const warningName = warning instanceof Error ? warning.name : typeof args[0] === "string" ? args[0] : undefined;
    const warningMessage = warning instanceof Error ? warning.message : String(warning);
    if (warningName === "ExperimentalWarning" && /SQLite is an experimental feature/i.test(warningMessage)) return;
    return (originalEmitWarning as (...emitArgs: unknown[]) => void).call(process, warning, ...args);
  }) as typeof process.emitWarning;
  try {
    return load();
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

export type IndexCodexOptions = {
  roots: string[];
  lcmDbPaths?: string[];
  maxFiles?: number;
  maxBytesPerFile?: number;
  maxEventsPerFile?: number;
  verify?: boolean;
  eventContent?: boolean;
};

export type LimitedCodexFile = {
  path: string;
  reason: "max_bytes_per_file" | "max_events_per_file" | "max_files_dropped_oldest";
  limit: number;
  actual: number;
};

export type CodexIndexLimitReasonSummary = {
  reason: LimitedCodexFile["reason"];
  count: number;
  limit: number;
  maxActual: number;
};

export type CodexIndexLimitWarning = {
  code: "codex_index_limited_files_skipped";
  message: string;
  limitedFiles: number;
  skippedFiles: number;
  reasons: CodexIndexLimitReasonSummary[];
  nextSafeCommands: string[];
  proofBoundary: string;
};

export type CodexJsonlDriftNamedCount = {
  kind: string;
  count: number;
};

export type CodexJsonlDriftFieldCount = {
  field: string;
  count: number;
};

export type CodexJsonlDriftReport = {
  path: string;
  unknownEventKinds: CodexJsonlDriftNamedCount[];
  unparsedLines: number;
  missingExpectedFields: CodexJsonlDriftFieldCount[];
  reasonCodes: string[];
};

export type CodexJsonlDriftSummary = {
  files: number;
  unknownEventKinds: number;
  unparsedLines: number;
  missingExpectedFields: number;
};

export type CodexJsonlDriftStatus = {
  schema: "lco.codexJsonlDrift.status.v1";
  publicSafe: true;
  readOnly: true;
  state: "clean" | "drift_detected" | "not_indexed_yet" | "unavailable";
  availability: "ready" | "database_missing" | "requires_index_run" | "read_error";
  docsRef: "docs/CODEX_JSONL_DRIFT.md";
  nextAction: string | null;
  filesIndexed: number;
  filesWithDrift: number;
  unknownEventKinds: number;
  unparsedLines: number;
  missingExpectedFields: number;
  topUnknownEventKinds: CodexJsonlDriftNamedCount[];
  topMissingExpectedFields: CodexJsonlDriftFieldCount[];
  reasonCodes: string[];
  lastIndexedAt: string | null;
};

export type CodexIndexLimitStatus = {
  schema: "lco.codexIndexLimits.status.v1";
  publicSafe: true;
  readOnly: true;
  state: "clean" | "limited" | "not_indexed_yet" | "unavailable";
  availability: "ready" | "database_missing" | "requires_index_run" | "read_error";
  docsRef: "docs/SETUP.md#4-index-local-codex-sessions";
  defaultIndexLimits: {
    maxBytesPerFile: number;
    maxEventsPerFile: number;
  };
  limitedFiles: number;
  skippedFiles: number;
  reasons: CodexIndexLimitReasonSummary[];
  nextSafeCommands: string[];
  reasonCodes: string[];
  lastObservedAt: string | null;
};

export type CodexEventContentStatus = {
  schema: "lco.codexEventContent.status.v1";
  publicSafe: true;
  readOnly: true;
  state: "ready" | "partial" | "disabled" | "dropped" | "not_indexed_yet" | "unavailable";
  availability: "ready" | "disabled" | "database_missing" | "requires_index_run" | "read_error";
  coverage: {
    totalEvents: number;
    eventsWithContent: number;
    coveragePct: number;
  };
  size: {
    dbBytes: number;
    walBytes: number;
    eventContentBytes: number;
    eventContentFtsRows: number;
  };
  reasonCodes: string[];
  lastIndexedAt: string | null;
};

export type CodexIndexHealthStatus = {
  databaseStorage: DatabaseStorageStatus;
  codexJsonlDrift: CodexJsonlDriftStatus;
  codexIndexLimits: CodexIndexLimitStatus;
  codexEventContent: CodexEventContentStatus;
};

export type DatabaseStorageStatus = {
  schema: "lco.databaseStorage.status.v1";
  publicSafe: true;
  readOnly: true;
  state: "ready" | "missing" | "maintenance_recommended" | "unavailable";
  size: {
    dbBytes: number;
    walBytes: number;
    totalBytes: number;
  };
  thresholds: {
    dbBytes: number;
    walBytes: number;
    totalBytes: number;
  };
  maintenanceRecommended: boolean;
  reasonCodes: string[];
  nextSafeCommands: string[];
};

export type DatabaseMaintenanceReport = {
  schema: "lco.databaseMaintenance.v1";
  ok: boolean;
  publicSafe: true;
  readOnly: false;
  strictMode: boolean;
  mutationClasses: ["derived_cache"];
  actionsPerformed: {
    checkpoint: boolean;
    analyze: boolean;
    vacuum: boolean;
  };
  before: DatabaseStorageStatus;
  after: DatabaseStorageStatus;
  operations: Array<{
    name: "wal_checkpoint_truncate" | "analyze" | "vacuum";
    ok: boolean;
    skipped?: boolean;
    reason?: string;
  }>;
  nextSafeCommands: string[];
  reasonCodes: string[];
};

export type IndexCodexResult = {
  // Fixed safety stamp: indexing writes only LCO-owned derived cache, while
  // limited/error rows can contain local paths and are not public evidence.
  publicSafe: false;
  readOnly: false;
  mutationClasses: ["derived_cache"];
  indexedFiles: number;
  appendDeltaIndexedFiles: number;
  indexLimits: {
    maxBytesPerFile: number;
    maxEventsPerFile: number;
  };
  skippedFiles: number;
  indexedThreads: number;
  indexedEvents: number;
  preparedMaterialization: {
    requestedThreads: number;
    completedThreads: number;
    pendingThreads: number;
  };
  limitedFiles: LimitedCodexFile[];
  warnings: CodexIndexLimitWarning[];
  errors: Array<{ path: string; message: string }>;
  driftReport: CodexJsonlDriftReport[];
  driftSummary: CodexJsonlDriftSummary;
};

export type IndexClaudeOptions = {
  roots: string[];
  maxFiles?: number;
  maxBytesPerFile?: number;
  maxEventsPerFile?: number;
};

export type ClaudeIndexLimitWarning = {
  code: "claude_index_limited_files_skipped";
  message: string;
  limitedFiles: number;
  skippedFiles: number;
  reasons: CodexIndexLimitReasonSummary[];
  nextSafeCommands: string[];
};

export type IndexClaudeResult = {
  publicSafe: true;
  readOnly: false;
  mutationClasses: ["derived_cache"];
  indexedFiles: number;
  indexLimits: {
    maxBytesPerFile: number;
    maxEventsPerFile: number;
  };
  skippedFiles: number;
  indexedSessions: number;
  indexedEvents: number;
  limitedFiles: LimitedCodexFile[];
  warnings: ClaudeIndexLimitWarning[];
  errors: Array<{ path: string; message: string }>;
};

export type RecallIndexSourceKind = "codex" | "claude";

export type RecallIndexSummary = {
  publicSafe: true;
  readOnly: false;
  mutationClasses: ["derived_cache"];
  attempted: boolean;
  sourceKinds: RecallIndexSourceKind[];
  indexedFiles: number;
  skippedFiles: number;
  indexedThreads: number;
  indexedSessions: number;
  indexedEvents: number;
  limitedFiles: number;
  warnings: number;
  errors: number;
};

export type CodexEventContentDropReport = {
  schema: "lco.codexEventContent.drop.v1";
  ok: true;
  publicSafe: true;
  readOnly: false;
  mutationClasses: ["derived_cache"];
  before: {
    eventContentRows: number;
    eventContentFtsRows: number;
    eventContentBytes: number;
    dbBytes: number;
    walBytes: number;
  };
  after: {
    eventContentRows: number;
    eventContentFtsRows: number;
    eventContentBytes: number;
    dbBytes: number;
    walBytes: number;
  };
  delta: {
    eventContentRows: number;
    eventContentFtsRows: number;
    eventContentBytes: number;
    dbBytes: number;
  };
  preserved: {
    codexSessions: number;
    preparedSourceEvents: number;
    preparedSourceRanges: number;
  };
  nextSafeCommands: string[];
  reasonCodes: string[];
};

export type SourceFileWatermark = {
  sourcePath: string;
  pathHash: string;
  size: number;
  mtimeMs: number;
  lastIndexedAt: string;
  metadataExtractorVersion: string | null;
  preparedRangeExtractorVersion: string | null;
  summaryLeafExtractorVersion: string | null;
  preparedCardExtractorVersion: string | null;
};

export type PreparedSourceRangeKind =
  | "session_metadata"
  | "thread_title"
  | "user_prompt"
  | "assistant_message"
  | "proposed_plan"
  | "final_message"
  | "closeout"
  | "tool_call_metadata"
  | "event_metadata";

export type PreparedSourceRange = {
  schema: "lco.prepared.sourceRange.v1";
  rangeRef: string;
  eventRef: string;
  threadId: string;
  sourceRef: string;
  sourcePathRef: string;
  rangeKind: PreparedSourceRangeKind;
  lineStart: number;
  lineEnd: number;
  byteStart: number;
  byteEnd: number;
  ordinal: number;
  sourceHash: string;
  contentHash: string;
  extractorVersion: "prepared-source-ranges-v1";
  privacyClass: "public_safe_metadata";
  omissionStatus: "metadata_only";
  confidence: number;
  observedAt: string | null;
  reasonCodes: string[];
};

export type PreparedSourceRangesReport = {
  schema: "lco.prepared.sourceRanges.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  sourceCoverage: {
    preparedSourceRanges: "ok" | "partial" | "not_configured";
  };
  summary: {
    total: number;
    returned: number;
    /** Count of low-confidence rows across the full matching public-safe set, not just the returned page. */
    lowConfidence: number;
    lowConfidenceScope: "matching_public_safe_total";
  };
  ranges: PreparedSourceRange[];
  omitted: {
    count: number;
    reason: "limit" | "filtered_unsafe_rows" | "limit_and_filtered_unsafe_rows" | "none";
    reasons: Array<"limit" | "filtered_unsafe_rows"> | ["none"];
    limitCount: number;
    filteredUnsafeRows: number;
  };
  actionsPerformed: {
    derivedCacheWrite: false;
    sourceStoreMutation: false;
    externalWrite: false;
    liveControl: false;
    guiMutation: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type PreparedSourceRangesOptions = {
  threadId?: string;
  rangeKind?: PreparedSourceRangeKind;
  limit?: number;
};

export type SummaryLeafKind =
  | "user_prompt"
  | "assistant_message"
  | "proposed_plan"
  | "final_message"
  | "closeout"
  | "tool_call_metadata"
  | "event_metadata";

export type SummaryLeaf = {
  schema: "lco.summary.leaf.v1";
  leafRef: string;
  threadId: string | null;
  leafKind: SummaryLeafKind;
  summaryText: string;
  sourceRefs: string[];
  sourceRangeRefs: string[];
  sourceRangeRefsOmitted: number;
  inputHash: string;
  outputHash: string;
  extractorVersion: "summary-leaves-v1";
  privacyClass: "public_safe_metadata";
  authorityCoverage: Record<string, unknown>;
  confidence: number;
  freshnessAt: string | null;
  stale: boolean;
  omissionStatus: "metadata_only";
};

export type SummaryLeavesReport = {
  schema: "lco.summary.leaves.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  sourceCoverage: {
    summaryLeaves: "ok" | "partial" | "not_configured";
  };
  summary: {
    total: number;
    returned: number;
    lowConfidence: number;
    lowConfidenceScope: "matching_public_safe_total";
  };
  leaves: SummaryLeaf[];
  omitted: {
    count: number;
    reason: "limit" | "filtered_unsafe_rows" | "limit_and_filtered_unsafe_rows" | "none";
    reasons: Array<"limit" | "filtered_unsafe_rows"> | ["none"];
    limitCount: number;
    filteredUnsafeRows: number;
  };
  actionsPerformed: {
    derivedCacheWrite: false;
    sourceStoreMutation: false;
    externalWrite: false;
    liveControl: false;
    guiMutation: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type SummaryLeavesOptions = {
  threadId?: string;
  leafKind?: SummaryLeafKind;
  limit?: number;
};

export type SummaryLeafMaterializationReport = {
  schema: "lco.summary.materialization.v1";
  publicSafe: false;
  readOnly: false;
  mutationClasses: ["derived_cache"];
  generatedAt: string;
  target: {
    threadId: string | null;
  };
  summary: {
    scannedRanges: number;
    created: number;
    edges: number;
    skippedUnsafeRanges: number;
    omittedRanges: number;
  };
  actionsPerformed: {
    derivedCacheWrite: true;
    sourceStoreMutation: false;
    externalWrite: false;
    liveControl: false;
    guiMutation: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type SummaryLeafMaterializationOptions = {
  threadId?: string;
  /** Maximum prepared source ranges scanned per target thread. For all-thread materialization, this limit applies independently to each thread. */
  limit?: number;
};

export const PREPARED_CARD_STATES = [
  "ready",
  "stale",
  "partial",
  "unknown",
  "completed",
  "blocked_missing_info",
  "waiting_approval",
  "watching_external_check",
  "needs_resume",
  "dirty_worktree_handoff",
  "stale_or_partial",
  "ready_for_review",
  "unknown_lifecycle"
] as const;
export type PreparedCardState = (typeof PREPARED_CARD_STATES)[number];
export type PreparedCardKind = "codex_session" | "claude_session" | "lcm_summary";
export type PreparedStateCoverage = "ok" | "partial" | "not_configured" | "unknown";

export type PreparedCard = {
  schema: "lco.prepared.card.v1";
  cardRef: string;
  targetRef: string;
  cardKind: PreparedCardKind;
  title: string;
  objective: string | null;
  summaryText: string;
  blocker: string | null;
  nextAction: string | null;
  sourceRefs: string[];
  sourceRangeRefs: string[];
  sourceRangeRefsOmitted: number;
  authorityCoverage: {
    summaryLeaves: { status: PreparedStateCoverage; leafCount: number; rangeCount: number };
    sessionMetadata: { status: PreparedStateCoverage };
    watcherObservations: { status: PreparedStateCoverage };
  };
  sourceCoverage: {
    summaryLeaves: PreparedStateCoverage;
    sessionMetadata: PreparedStateCoverage;
    watcherObservations: PreparedStateCoverage;
  };
  inputHash: string;
  extractorVersion: "prepared-cards-v2";
  privacyClass: "public_safe_metadata";
  confidence: number;
  freshnessAt: string | null;
  stale: boolean;
  state: PreparedCardState;
  reasonCodes: string[];
};

export type PreparedInboxItem = {
  schema: "lco.prepared.inboxItem.v1";
  itemRef: string;
  cardRef: string;
  targetRef: string;
  urgencyScore: number;
  state: PreparedCardState;
  reasonCodes: string[];
  sourceRefs: string[];
  execute: false;
};

export type PreparedCardMaterializationReport = {
  schema: "lco.preparedCards.materialization.v1";
  publicSafe: false;
  readOnly: false;
  mutationClasses: ["derived_cache"];
  generatedAt: string;
  target: {
    threadId: string | null;
  };
  summary: {
    summaryLeaves: number;
    cards: number;
    inboxItems: number;
    skippedUnsafeRows: number;
  };
  actionsPerformed: {
    derivedCacheWrite: true;
    sourceStoreMutation: false;
    externalWrite: false;
    liveControl: false;
    guiMutation: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type PreparedCardsOptions = {
  threadId?: string;
  state?: PreparedCardState;
  limit?: number;
};

export type PreparedTargetCoverageStatus = "ready" | "source_present_not_indexed" | "not_found" | "partial" | "unknown";

export type PreparedTargetCoverage = {
  schema: "lco.prepared.targetCoverage.v1";
  threadId: string;
  targetRef: string;
  status: PreparedTargetCoverageStatus;
  sourceRefs: string[];
  sourceCoverage: {
    indexedSession: PreparedStateCoverage;
    sourceFile: PreparedStateCoverage;
    preparedSourceEvents: PreparedStateCoverage;
    preparedSourceRanges: PreparedStateCoverage;
    summaryLeaves: PreparedStateCoverage;
    preparedCards: PreparedStateCoverage;
    preparedInboxItems: PreparedStateCoverage;
    watcherObservations: PreparedStateCoverage;
  };
  counts: {
    preparedSourceEvents: number;
    preparedSourceRanges: number;
    summaryLeaves: number;
    preparedCards: number;
    preparedInboxItems: number;
  };
  freshness: {
    sourceUpdatedAt: string | null;
    indexedAt: string | null;
    preparedFreshnessAt: string | null;
    stale: boolean;
  };
  reasonCodes: string[];
  nextAction: string;
};

export type PreparedCardsReport = {
  schema: "lco.prepared.cards.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  sourceCoverage: {
    preparedCards: PreparedStateCoverage;
    summaryLeaves: PreparedStateCoverage;
    watcherObservations: PreparedStateCoverage;
  };
  targetCoverage?: PreparedTargetCoverage | null;
  summary: {
    total: number;
    returned: number;
    stale: number;
    partial: number;
    unknown: number;
    completed: number;
    lowConfidence: number;
  };
  cards: PreparedCard[];
  omitted: {
    count: number;
    reason: "limit" | "filtered_unsafe_rows" | "limit_and_filtered_unsafe_rows" | "none";
    reasons: Array<"limit" | "filtered_unsafe_rows"> | ["none"];
    limitCount: number;
    filteredUnsafeRows: number;
  };
  actionsPerformed: {
    derivedCacheWrite: false;
    sourceStoreMutation: false;
    externalWrite: false;
    liveControl: false;
    guiMutation: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type PreparedInboxOptions = {
  threadId?: string;
  limit?: number;
};

export type PreparedInboxReport = {
  schema: "lco.prepared.inbox.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  sourceCoverage: PreparedCardsReport["sourceCoverage"] & {
    preparedInboxItems: PreparedStateCoverage;
  };
  targetCoverage?: PreparedTargetCoverage | null;
  summary: {
    total: number;
    returned: number;
    critical: number;
    high: number;
    lowConfidence: number;
  };
  items: PreparedInboxItem[];
  omitted: {
    count: number;
    reason: "limit" | "none";
  };
  actionsPerformed: PreparedCardsReport["actionsPerformed"];
  proofBoundary: string;
};

export type PreparedStateStatusOptions = {
  threadId?: string;
};

export type PreparedStateStatusReport = {
  schema: "lco.preparedState.status.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  sourceCoverage: {
    summaryLeaves: PreparedStateCoverage;
    preparedCards: PreparedStateCoverage;
    preparedInboxItems: PreparedStateCoverage;
    watcherObservations: PreparedStateCoverage;
  };
  targetCoverage?: PreparedTargetCoverage | null;
  summary: {
    summaryLeaves: number;
    cards: number;
    inboxItems: number;
    staleCards: number;
    partialCards: number;
    unknownCards: number;
    lowConfidenceCards: number;
  };
  actionsPerformed: PreparedCardsReport["actionsPerformed"];
  proofBoundary: string;
};

export type HookCaptureKind = "closeout_capture" | "compaction_marker" | "thread_title_finalizer";
export type HookCompactionLifecycle = "pre_compact" | "post_compact";
export type ThreadTitleFinalizerState = "ready" | "already_finalized" | "insufficient_signal";

export type HookSidecarActions = {
  derivedCacheWrite: true;
  codexMutation: false;
  sourceStoreMutation: false;
  externalWrite: false;
  liveControl: false;
  guiMutation: false;
  rawTranscriptRead: false;
  modelCompactionRun: false;
  trueCompactionSummaryCaptured: false;
};

export type HookCapturePacket = {
  schema: "lco.hookCapturePacket.v1";
  packetId: string;
  hookKind: HookCaptureKind;
  targetRef: string;
  threadId: string | null;
  turnId: string | null;
  eventId: string | null;
  payloadHash: string;
  payload: {
    transcriptPathHash: string | null;
    transcriptPathRedacted: boolean;
    messageHash?: string | null;
    messageRedacted?: boolean;
    messagePreview?: string | null;
    closeout?: {
      present: boolean;
      text: string | null;
      textHash: string | null;
      textRedacted: boolean;
      fields: Record<string, string>;
      truncated: boolean;
      omissions: string[];
    };
    mode?: "marker";
    lifecycle?: HookCompactionLifecycle;
    markerNote?: string | null;
    markerNoteHash?: string | null;
    summaryCaptured?: false;
    titleFinalizer?: {
      suggestedTitle: string | null;
      suggestedTitleHash: string | null;
      repoOrProject: string | null;
      summary: string | null;
      state: ThreadTitleFinalizerState;
      aliasKind: "thread_title_finalizer";
      sourceSignals: string[];
    };
    omissions: string[];
  };
  sourceRefs: string[];
  privacyClass: "public_safe_metadata";
  confidence: number;
  createdAt: string;
  reasonCodes: string[];
};

export type HookCaptureReport = {
  schema: "lco.hookCapture.v1";
  publicSafe: true;
  readOnly: false;
  mutationClasses: ["derived_cache"];
  generatedAt: string;
  inserted: boolean;
  packet: HookCapturePacket;
  blockers: string[];
  actionsPerformed: HookSidecarActions;
  proofBoundary: string;
};

export type CloseoutHookCaptureInput = {
  threadId?: string;
  thread_id?: string;
  targetRef?: string;
  target_ref?: string;
  turnId?: string;
  turn_id?: string;
  eventId?: string;
  event_id?: string;
  transcriptPath?: string;
  transcript_path?: string;
  lastAssistantMessage?: string;
  last_assistant_message?: string;
};

export type ThreadTitleFinalizerInput = {
  threadId?: string;
  thread_id?: string;
  sessionId?: string;
  session_id?: string;
  targetRef?: string;
  target_ref?: string;
  turnId?: string;
  turn_id?: string;
  eventId?: string;
  event_id?: string;
  transcriptPath?: string;
  transcript_path?: string;
  cwd?: string;
  project?: string;
  repo?: string;
  repoName?: string;
  repo_name?: string;
  currentTitle?: string;
  current_title?: string;
  taskSummary?: string;
  task_summary?: string;
  userMessage?: string;
  user_message?: string;
  userMessages?: string[];
  user_messages?: string[];
  lastAssistantMessage?: string;
  last_assistant_message?: string;
};

export type ThreadTitleFinalizerReport = {
  schema: "lco.threadTitleFinalizer.v1";
  publicSafe: true;
  readOnly: false;
  mutationClasses: ["derived_cache"];
  generatedAt: string;
  inserted: boolean;
  aliasInserted: boolean;
  title: {
    suggestedTitle: string | null;
    state: ThreadTitleFinalizerState;
    repoOrProject: string | null;
    summary: string | null;
    existingTitle: string | null;
  };
  packet: HookCapturePacket;
  blockers: string[];
  actionsPerformed: HookSidecarActions;
  proofBoundary: string;
};

export type CompactionMarkerHookInput = {
  threadId?: string;
  thread_id?: string;
  targetRef?: string;
  target_ref?: string;
  turnId?: string;
  turn_id?: string;
  eventId?: string;
  event_id?: string;
  transcriptPath?: string;
  transcript_path?: string;
  mode: "marker";
  lifecycle: HookCompactionLifecycle | "PreCompact" | "PostCompact";
  markerNote?: string;
  marker_note?: string;
  summary?: string;
};

export type StatePrepHookInput = {
  threadId?: string;
  thread_id?: string;
  targetRef?: string;
  target_ref?: string;
  limit?: number;
  payload?: Record<string, unknown>;
};

export type StatePrepHookReport = {
  schema: "lco.hook.statePrep.v1";
  publicSafe: true;
  readOnly: false;
  mutationClasses: ["derived_cache"];
  generatedAt: string;
  inserted: boolean;
  job: {
    jobId: string;
    jobKind: "state_prep";
    status: "complete";
    targetRef: string;
    inputHash: string;
    outputHash: string;
    mutationClasses: ["derived_cache"];
  };
  packet: {
    schema: "lco.hook.statePrepPacket.v1";
    targetRef: string;
    inputHash: string;
    limits: {
      cards: number;
      inboxItems: number;
      summaryLeaves: number;
    };
    preparedState: {
      status: PreparedStateStatusReport;
    };
    preparedCards: PreparedCardsReport;
    preparedInbox: PreparedInboxReport;
    summaryLeaves: SummaryLeavesReport;
    omissions: string[];
  };
  blockers: string[];
  actionsPerformed: HookSidecarActions;
  proofBoundary: string;
};

export type SummaryExpansionReport = {
  schema: "lco.summary.expansion.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  root: {
    leafRef: string | null;
    threadId: string | null;
  };
  limits: {
    maxDepth: number;
    maxNodes: number;
    tokenBudget: number;
  };
  leaves: SummaryLeaf[];
  edges: Array<{
    parentLeafRef: string;
    childLeafRef: string;
    edgeKind: string;
  }>;
  omitted: {
    count: number;
    reasons: Array<"cycle" | "depth" | "node_limit" | "token_budget"> | ["none"];
    cycleCount: number;
    depthCount: number;
    nodeLimitCount: number;
    tokenBudgetCount: number;
  };
  actionsPerformed: {
    derivedCacheWrite: false;
    sourceStoreMutation: false;
    externalWrite: false;
    liveControl: false;
    guiMutation: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type SummaryExpansionOptions = {
  leafRef?: string;
  threadId?: string;
  maxDepth?: number;
  maxNodes?: number;
  tokenBudget?: number;
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
  matchKind: "thread_id" | "full_text" | "safe_text" | "thread_title_alias" | "app_server_alias";
  freshness: {
    lastEventAt: string | null;
    ageSeconds: number | null;
    stale: boolean;
  };
  reasonCodes: string[];
  matchFeatures?: CodexSearchMatchFeatures;
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

export type ClaudeCodeEventKind =
  | "user_message"
  | "assistant_message"
  | "tool_use"
  | "tool_result"
  | "summary"
  | "metadata"
  | "unknown";

export type ClaudeCodeSourceRange = {
  eventRef: string;
  rangeRef: string;
  eventKind: ClaudeCodeEventKind;
  lineStart: number;
  lineEnd: number;
  byteStart: number;
  byteEnd: number;
  ordinal: number;
  observedAt: string | null;
  privacyClass: "public_safe_metadata";
  confidence: number;
  reasonCodes: string[];
};

export type ClaudeCodeParseOmissionReason =
  | "invalid_json_line"
  | "tool_payload_omitted"
  | "raw_result_payload_omitted"
  | "unknown_event_kind"
  | "safe_text_truncated";

export type ClaudeCodeParseOmission = {
  reason: ClaudeCodeParseOmissionReason;
  count: number;
};

export type ClaudeCodeParseError = {
  lineNumber: number;
  reason: "invalid_json";
};

export type ParsedClaudeCodeSession = {
  sourceKind: "claude_session";
  sessionId: string;
  sourceRef: string;
  sourcePathRef: string;
  projectSlug: string | null;
  title: string | null;
  updatedAt: string | null;
  eventCount: number;
  eventCounts: {
    userMessages: number;
    assistantMessages: number;
    toolUses: number;
    toolResults: number;
    summaries: number;
    metadata: number;
    unknown: number;
  };
  sourceRanges: ClaudeCodeSourceRange[];
  safeText: string;
  omissions: ClaudeCodeParseOmission[];
  parseErrors: ClaudeCodeParseError[];
  privacyClass: "public_safe_metadata";
  confidence: number;
  freshness: {
    updatedAt: string | null;
    stale: boolean;
  };
};

export type NativeCodexSubagentResultFixture = Record<string, unknown> & {
  resultId?: string;
  id?: string;
  title?: string | null;
  summary?: string | null;
  finalReport?: string | null;
  provenance?: Record<string, unknown> | null;
  touchedFiles?: string[];
  blockers?: string[];
  observedAt?: string | null;
};

export type NativeCodexSubagentResultRejected = {
  resultId: string | null;
  reason: "missing_result_id";
};

export type IndexNativeCodexSubagentResultsResult = {
  publicSafe: false;
  readOnly: false;
  mutationClasses: ["derived_cache"];
  indexedResults: number;
  rejectedResults: NativeCodexSubagentResultRejected[];
  actionsPerformed: {
    derivedCacheWrite: true;
    sourceStoreMutation: false;
    externalWrite: false;
    liveControl: false;
    guiMutation: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
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
  tool: "lco_watchers" | "lco_desktop_proof";
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
  tool: "lco_desktop_proof";
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

export type CodexActiveThreadStateKind = "running" | "blocked" | "needs_nudge" | "stale" | "waiting" | "needs_approval" | "idle" | "unknown";

export type CodexActiveThreadControlDryRunRecommendation = {
  tool: "lco_codex_control_dry_run";
  execute: false;
  status: "ready" | "blocked";
  args: {
    action: "resume";
    thread_id: string;
  };
  messageIncluded: false;
  messageRef: string;
  approvalBoundary: string;
  blockers: string[];
  reasonCodes: string[];
  confidence: number;
};

export type CodexActiveThreadReadOnlyAction = {
  tool: "lco_recent_sessions" | "lco_operating_picture" | "lco_codex_app_server_threads" | "lco_visible_codex_map";
  execute: false;
  args: Record<string, string | number | boolean>;
  reason: string;
};

export type CodexActiveThreadAttentionCoverage = {
  status: "covered" | "partial" | "needs_probe" | "unknown";
  confidence: number;
  reasonCodes: string[];
  nextReadOnlyAction: CodexActiveThreadReadOnlyAction | null;
};

export type CodexActiveThreadStateItem = {
  threadId: string;
  title: string;
  state: CodexActiveThreadStateKind;
  sessionState: CodexSessionCardState;
  attention: CodexCollaborationCockpitLane["attention"];
  freshness: CodexSessionCard["freshness"];
  nextAction: CodexSessionCard["nextAction"];
  confidence: number;
  reasonCodes: string[];
  evidenceIds: string[];
  attentionCoverage: CodexActiveThreadAttentionCoverage;
  nextControlDryRun: CodexActiveThreadControlDryRunRecommendation | null;
  sourceCoverage: {
    indexedSession: VisibleCodexCoverageState;
    cockpitInbox: VisibleCodexCoverageState;
    watchers: VisibleCodexCoverageState;
    codexAppServer: VisibleCodexCoverageState;
    visibleCodexMap: VisibleCodexCoverageState;
  };
};

export type CodexActiveThreadStateReport = {
  schema: "lco.codex.activeThreadState.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  summary: {
    totalLanes: number;
    returned: number;
    running: number;
    blocked: number;
    needsApproval: number;
    needsNudge: number;
    stale: number;
    waiting: number;
    idle: number;
    unknown: number;
    lowConfidence: number;
    attentionCovered: number;
    attentionPartial: number;
    attentionNeedsProbe: number;
    attentionUnknown: number;
    nextReadOnlyActions: number;
  };
  sourceCoverage: {
    indexedSession: VisibleCodexCoverageState;
    cockpitInbox: VisibleCodexCoverageState;
    watchers: VisibleCodexCoverageState;
    codexAppServer: VisibleCodexCoverageState;
    visibleCodexMap: VisibleCodexCoverageState;
  };
  items: CodexActiveThreadStateItem[];
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

export type CodexActiveThreadStateOptions = CodexCollaborationCockpitOptions & {
  appServerThreads?: AppServerThreadsInput | null;
  visibleMap?: VisibleCodexSessionMapReport | null;
};

export type CodexAutonomyTickStepType = "read_only_probe" | "control_dry_run";

export type CodexAutonomyTickTool =
  | CodexActiveThreadReadOnlyAction["tool"]
  | CodexActiveThreadControlDryRunRecommendation["tool"];

export type CodexAutonomyTickStep = {
  stepId: string;
  threadId: string;
  stepType: CodexAutonomyTickStepType;
  status?: "ready" | "blocked";
  priority: number;
  tool: CodexAutonomyTickTool;
  execute: false;
  args: Record<string, string | number | boolean>;
  reason: string;
  approvalBoundary?: string;
  blockers?: string[];
  idempotencyKey: string;
  stopConditions: string[];
  reasonCodes: string[];
  evidenceIds: string[];
  confidence: number;
  sourceCoverage: CodexActiveThreadStateItem["sourceCoverage"];
};

export type CodexAutonomyTickReport = {
  schema: "lco.codex.autonomyTick.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  summary: {
    totalLanes: number;
    returnedSteps: number;
    readOnlyProbes: number;
    controlDryRunRecommendations: number;
    blockedControlDryRuns: number;
  };
  sourceCoverage: CodexActiveThreadStateReport["sourceCoverage"];
  steps: CodexAutonomyTickStep[];
  omitted: {
    count: number;
    reason: "limit" | "upstream_lanes_omitted" | "limit_and_upstream_lanes_omitted" | "none";
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

export type CodexAutonomyTickOptions = CodexActiveThreadStateOptions;

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

export type WatcherPersistenceReport = {
  schema: "lco.watchers.persistence.v1";
  publicSafe: false;
  readOnly: false;
  mutationClasses: ["derived_cache"];
  generatedAt: string;
  summary: {
    specs: number;
    observations: number;
    queueItems: number;
    skippedUnsafeRows: number;
  };
  actionsPerformed: {
    derivedCacheWrite: true;
    sourceStoreMutation: false;
    externalWrite: false;
    liveControl: false;
    guiMutation: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type WatcherObservationRecord = {
  schema: "lco.watcherObservation.v1";
  observationRef: string;
  watchId: string;
  targetRef: string;
  watcher: WatcherState;
  evidenceRefs: string[];
  sourceRefs: string[];
  observedAt: string;
  freshness: {
    lastObservedAt: string | null;
    expiresAt: string | null;
    stale: boolean;
    expired: boolean;
  };
  reasonCodes: string[];
  confidence: number;
  privacyClass: "public_safe_metadata";
};

export type WatcherAttentionQueueItem = {
  schema: "lco.attentionQueue.item.v1";
  itemRef: string;
  targetRef: string;
  itemKind: "watcher_resume_request" | "watcher_inspection";
  status: WatcherStatus;
  toolCall: {
    tool: "lco_watchers";
    execute: false;
    args: Record<string, unknown>;
  };
  execute: false;
  sourceRefs: string[];
  reasonCodes: string[];
  confidence: number;
  freshnessAt: string | null;
};

export type WatcherEventsReport = {
  schema: "lco.watchers.events.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  sourceCoverage: {
    watcherSpecs: PreparedStateCoverage;
    watcherObservations: PreparedStateCoverage;
    attentionQueue: PreparedStateCoverage;
  };
  summary: WatcherStatusReport["summary"] & {
    queueItems: number;
    filteredUnsafeRows: number;
  };
  observations: WatcherObservationRecord[];
  queue: WatcherAttentionQueueItem[];
  omitted: {
    count: number;
    reason: "limit" | "filtered_unsafe_rows" | "limit_and_filtered_unsafe_rows" | "none";
    reasons: Array<"limit" | "filtered_unsafe_rows"> | ["none"];
    limitCount: number;
    observationLimitCount: number;
    queueLimitCount: number;
    filteredUnsafeRows: number;
    filteredUnsafeObservationRows: number;
    filteredUnsafeQueueRows: number;
  };
  actionsPerformed: {
    derivedCacheWrite: false;
    sourceStoreMutation: false;
    externalWrite: false;
    liveControl: false;
    guiMutation: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type WatcherEventsOptions = {
  now?: string;
  limit?: number;
  watchId?: string;
  targetRef?: string;
};

export type SessionDiffCursorStatus = "none" | "accepted" | "stale" | "invalid";
export type SessionDiffCursorKeySource = "explicit" | "environment" | "audit_fallback";
export type SessionDiffChangeKind =
  | "source_range"
  | "summary_leaf"
  | "prepared_card"
  | "prepared_inbox_item"
  | "watcher_observation";

export type SessionDiffChange = {
  schema: "lco.session.diff.change.v1";
  changeRef: string;
  changeKind: SessionDiffChangeKind;
  targetRef: string;
  threadId: string | null;
  changedAt: string;
  freshnessAt: string | null;
  sourceRefs: string[];
  sourceRangeRefs: string[];
  confidence: number;
  stale: boolean;
  reasonCodes: string[];
  summary: string;
  item:
    | PreparedSourceRange
    | SummaryLeaf
    | PreparedCard
    | PreparedInboxItem
    | WatcherObservationRecord;
};

export type SessionDiffReport = {
  schema: "lco.session.diff.v1";
  publicSafe: true;
  readOnly: true;
  generatedAt: string;
  target: {
    threadId: string | null;
    targetRef: string | null;
  };
  cursor: {
    provided: boolean;
    status: SessionDiffCursorStatus;
    keySource: SessionDiffCursorKeySource;
    issuedAt: string | null;
    nextCursor: string;
    reasonCodes: string[];
  };
  sourceCoverage: {
    indexedSession: PreparedStateCoverage;
    preparedSourceRanges: PreparedStateCoverage;
    summaryLeaves: PreparedStateCoverage;
    preparedCards: PreparedStateCoverage;
    preparedInboxItems: PreparedStateCoverage;
    watcherObservations: PreparedStateCoverage;
  };
  summary: {
    totalChanges: number;
    totalChangesExact: boolean;
    hasMore: boolean;
    returned: number;
    changedSourceEvents: number;
    changedSourceRanges: number;
    changedSummaryLeaves: number;
    changedPreparedCards: number;
    changedInboxItems: number;
    changedWatcherObservations: number;
    lowConfidence: number;
  };
  limits: {
    limit: number;
    tokenBudget: number;
  };
  changes: SessionDiffChange[];
  omitted: {
    count: number;
    countExact: boolean;
    hasMore: boolean;
    reason: "limit" | "token_budget" | "filtered_unsafe_rows" | "mixed" | "none";
    reasons: Array<"limit" | "token_budget" | "filtered_unsafe_rows"> | ["none"];
    limitCount: number;
    limitCountExact: boolean;
    tokenBudgetCount: number;
    filteredUnsafeRows: number;
    invalidTimestampRows: number;
  };
  nextSafeCommands: string[];
  actionsPerformed: {
    derivedCacheWrite: false;
    sourceStoreMutation: false;
    externalWrite: false;
    liveControl: false;
    guiMutation: false;
    rawTranscriptRead: false;
  };
  proofBoundary: string;
};

export type SessionDiffSetupReport = {
  schema: "lco.session.diff.setup.v1";
  publicSafe: true;
  readOnly: true;
  ok: false;
  status: "setup_required";
  blockers: ["session_diff_cursor_signing_key_required"];
  nextSafeCommands: [string];
  actionsPerformed: {
    rawTranscriptRead: false;
    sourceStoreMutation: false;
    derivedCacheWrite: false;
    liveControl: false;
    guiMutation: false;
    externalWrite: false;
    npmPublished: false;
    githubReleaseCreated: false;
  };
  proofBoundary: string;
};

export type SessionDiffOptions = {
  threadId?: string;
  targetRef?: string;
  cursor?: string;
  cursorSigningKey?: string;
  cursorKeySource?: SessionDiffCursorKeySource;
  limit?: number;
  tokenBudget?: number;
  now?: string;
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
  titleAliases?: string[];
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
  readOnly?: boolean;
  generatedAt?: string;
  sourceCoverage?: {
    codexAppServer?: VisibleCodexCoverageState;
  };
  threads?: AppServerThreadSignalInput[];
  loadedThreadRefs?: string[] | null;
  // App-server fixtures may carry future opaque source labels; known literals are documented here.
  loadedSignalSource?: "same_connection" | "not_claimed_one_shot_client" | string;
  errors?: string[];
  actionsPerformed?: Record<string, unknown>;
  proofBoundary?: string;
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

export type CodexDesktopCoherenceState = "cli_visible" | "desktop_visible" | "desktop_refresh_required" | "desktop_restart_required" | "gui_persisted_read_state_stale" | "unknown";

export type CodexDesktopCoherenceVisibility = "proven" | "not_seen" | "refresh_required" | "restart_required" | "ambiguous" | "unknown";

export type CodexDesktopCoherenceActionEvidence = {
  actionKind: "none" | "cli" | "direct_protocol" | "codex_app_server" | "desktop_gui_observation" | "lco_control" | "unknown";
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
  reasonCode: "missing_tool_name_source" | "unsupported_legacy_shape" | null;
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
  telemetry?: boolean;
  telemetrySessionId?: string;
  now?: string;
};

export type RecallProfileName = "metadata" | "brief" | "evidence";

export type RecallProfile = {
  name: RecallProfileName;
  tokenBudget: number;
  description: string;
};

const SESSION_METADATA_SCHEMA_VERSION = 4;
const SESSION_METADATA_EXTRACTOR_VERSION = `session-metadata-v${SESSION_METADATA_SCHEMA_VERSION}` as const;
const RETRIEVAL_TELEMETRY_MIGRATION_ID = "2026-07-06-retrieval-telemetry";
const RETRIEVAL_TELEMETRY_SESSION_KEY_MIGRATION_ID = "2026-07-06-retrieval-telemetry-session-key";
const RETRIEVAL_TELEMETRY_ENGINE_VERSION = "field-weighted-fts-v1";
const RETRIEVAL_TELEMETRY_WINDOW_MS = 15 * 60 * 1000;
const RETRIEVAL_TELEMETRY_HARVEST_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const RETRIEVAL_TELEMETRY_HARVEST_MAX_ROWS = 1000;
const RETRIEVAL_TELEMETRY_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const RETRIEVAL_TELEMETRY_PRUNE_BATCH_SIZE = 5000;
const RETRIEVAL_TELEMETRY_CORRELATION_SEARCH_LIMIT = 50;
const retrievalTelemetryLastPruneByDb = new WeakMap<object, number>();

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
  matchFeatures?: CodexSearchMatchFeatures;
  reasonCodes?: string[];
  event?: {
    eventId: string;
    eventRef: string;
    eventKind: string;
    lineStart: number;
    lineEnd: number;
    byteStart: number;
    byteEnd: number;
    ordinal: number;
    sourceStatus: "source_available" | "source_rotated";
  };
};

export type GrepRecallResult = {
  query: string;
  profile: RecallProfile;
  matches: RecallSearchResult[];
  reasonCodes?: string[];
};

export type FindRecallReport = {
  schema: "lco.find.v1";
  ok: boolean;
  publicSafe: true;
  query: string;
  limit: number;
  indexed: {
    attempted: boolean;
    sourceKinds: RecallIndexSourceKind[];
    indexedFiles: number;
    skippedFiles: number;
    indexedThreads: number;
    indexedSessions: number;
    indexedEvents: number;
    limitedFiles: number;
    warnings: number;
    errors: number;
  };
  resultCount: number;
  results: FindRecallResult[];
  nextSafeCommands: string[];
  actionsPerformed: {
    derivedCacheWrite: boolean;
    localRecallSourceRead: boolean;
    localCodexSourceRead: boolean;
    localClaudeSourceRead: boolean;
    localLcmSourceRead: boolean;
    sourceStoreMutation: false;
    externalWrite: false;
    liveControl: false;
    guiMutation: false;
    rawTranscriptRead: boolean;
    rawTranscriptReturned: false;
    rawTranscriptUploaded: false;
  };
  reasonCodes: string[];
};

export type FindRecallResult = {
  rank: number;
  sourceKind: RecallSearchResult["sourceKind"];
  sourceRef: string;
  title: string | null;
  summary: string | null;
  updatedAt: string | null;
  snippet: string;
  threadId?: string;
  sessionId?: string;
  summaryId?: string;
  event?: {
    eventRef: string;
    eventKind: string;
    lineStart: number;
    lineEnd: number;
    ordinal: number;
    sourceStatus: string;
  };
  reasonCodes: string[];
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

export type RecallRefNotFoundResult = {
  ok: false;
  code: "ref_not_found";
  ref: string;
  reason: "ref_not_found";
  message: string;
  nearestMatches: Array<{
    sourceRef: string;
    title: string | null;
    score: number;
  }>;
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
  requires?: string[];
  limit?: number;
  k?: number;
  family?: string;
  rationale?: string;
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

export type RetrievalBaselineMetricSet = {
  hitAt1: number;
  hitAt5: number;
  mrr: number;
};

export type RetrievalBaselineFloors = {
  schema?: string;
  engine?: string;
  scenarioSet?: string;
  scenarioCount?: number;
  measuredAt?: string;
  overall: RetrievalBaselineMetricSet;
  families: Record<string, RetrievalBaselineMetricSet & { scenarioCount?: number }>;
};

export type RetrievalBaselineScenarioResult = {
  id: string;
  family: string;
  rationale: string | null;
  query: string;
  expectedSourceRefs: string[];
  k: number;
  requires: string[];
  skipped: boolean;
  hitAt1: boolean;
  hitAt5: boolean;
  hitAtK: boolean;
  firstExpectedRank: number | null;
  reciprocalRank: number;
  topRefs: string[];
  reasonCodes: string[];
};

export type RetrievalBaselineReport = {
  ok: boolean;
  publicSafe: true;
  generatedAt: string;
  strategy: "field-weighted-fts-ranking";
  metrics: {
    scenarioCount: number;
    skippedScenarioCount: number;
    overall: RetrievalBaselineMetricSet;
    families: Record<string, RetrievalBaselineMetricSet & { scenarioCount: number }>;
  };
  scenarios: RetrievalBaselineScenarioResult[];
  blockers: string[];
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

export type RetrievalTelemetryFollowKind = "describe" | "expand";

export type RetrievalTelemetryHarvestReport = {
  schema: "lco.retrieval.telemetryHarvestReport.v1";
  publicSafe: true;
  generatedAt: string;
  summary: {
    telemetrySearchEvents: number;
    telemetryFollowEvents: number;
    proposedScenarios: number;
    sampledGroups: number;
    maxRows: number;
    sampleTruncated: boolean;
  };
  proposalFile: {
    written: boolean;
    publicSafe: false;
    requiresManualCuration: true;
  };
  metricsFile: {
    written: boolean;
    publicSafe: true;
  } | null;
  metrics: RetrievalTelemetryMetrics;
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

export type RetrievalTelemetryMetrics = {
  sample: {
    sampledGroups: number;
    maxRows: number;
    sampleTruncated: boolean;
  };
  rankDistribution: Record<string, number>;
  topMissQueries: Array<{
    missId: string;
    observedRank: number;
    occurrenceCount: number;
  }>;
};

export type RetrievalTelemetryHarvestOptions = {
  proposalPath: string;
  metricsPath?: string | null;
  now?: string;
  lookbackMs?: number;
  maxRows?: number;
};

export type LcmPeerProbe = {
  status: "ready" | "degraded" | "unavailable";
  path: string;
  readable: boolean;
  readOnly: boolean;
  queryOnly: boolean;
  supported: boolean;
  tables: string[];
  summaryCount: number | null;
  ftsAvailable: boolean;
  reason: string | null;
  integrity: {
    missingOptionalTables: string[];
    emptySummaries: number;
    staleDagLinks: number;
    degradedExpansions: number;
    reasonCodes: string[];
  };
};

export type LcmPeerProbeReport = {
  schema: "lco.lcm.peerDoctor.v1";
  status: "ready" | "degraded" | "unavailable";
  readOnly: true;
  summary: { ready: number; degraded: number; unavailable: number };
  peers: LcmPeerProbe[];
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

type LcmSummaryExpansion = {
  root: LcmSummaryRecord;
  sourceSummaries: LcmSummaryRecord[];
  reasonCodes: string[];
};

type ImportedSession = {
  threadId: string;
  title: string | null;
  titleExplicit: boolean;
  cwd: string | null;
  model: string | null;
  branch: string | null;
  gitSha: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  finalMessage: string | null;
  finalMessageExplicit: boolean;
  plans: string[];
  touchedFiles: string[];
  toolCalls: CodexToolCallDraft[];
  metadata: SessionMetadata;
  metadataPresentTextFields: Set<SessionMetadataTextField>;
  metadataPresentRefFields: Set<SessionMetadataRefField>;
  closeoutEnvelopeText: string | null;
  closeoutEnvelopeOpenCount: number;
  closeoutEnvelopeCloseCount: number;
  safeText: string;
  eventCount: number;
  sourceEvents: PreparedSourceEventDraft[];
  driftReport: CodexJsonlDriftReport | null;
};

type JsonlLineRecord = {
  lineNumber: number;
  text: string;
  byteStart: number;
  byteEnd: number;
};

type CodexToolCallDraft = Omit<CodexToolCall, "threadId"> & {
  rawArgumentsText: string;
};

type PreparedSourceEventDraft = {
  eventRef: string;
  eventKind: string;
  sourcePathRef: string;
  sourceHash: string;
  contentHash: string;
  eventText: string;
  eventTextHash: string;
  storedChars: number;
  truncated: boolean;
  lineStart: number;
  lineEnd: number;
  byteStart: number;
  byteEnd: number;
  ordinal: number;
  observedAt: string | null;
  ranges: PreparedSourceRangeDraft[];
};

type CodexJsonlParseOptions = {
  threadId?: string;
  sourceHash?: string;
  lineNumberOffset?: number;
  byteOffset?: number;
  ordinalOffset?: number;
};

type CodexJsonlDriftAccumulator = {
  unknownEventKinds: Map<string, number>;
  unparsedLines: number;
  missingExpectedFields: Map<string, number>;
};

type PreparedSourceRangeDraft = {
  rangeRef: string;
  rangeKind: PreparedSourceRangeKind;
  contentHash: string;
  ordinal: number;
  reasonCodes: string[];
};

const DEFAULT_CODEX_MAX_BYTES_PER_FILE = 256 * 1024 * 1024;
const DEFAULT_CODEX_MAX_EVENTS_PER_FILE = 200_000;
const CODEX_RECOVERY_MAX_BYTES_PER_FILE = 1_073_741_824;
const CODEX_RECOVERY_MAX_EVENTS_PER_FILE = 1_000_000;
const CODEX_EVENT_CONTENT_CHAR_LIMIT = 8000;
const CODEX_EVENT_CONTENT_REBUILD_COMMAND = 'loo index codex "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"';
const PREPARED_SOURCE_EXTRACTOR_VERSION = "prepared-source-ranges-v1" as const;
const SUMMARY_LEAF_EXTRACTOR_VERSION = "summary-leaves-v1" as const;
const PREPARED_CARD_EXTRACTOR_VERSION = "prepared-cards-v2" as const;
const SUMMARY_LEAF_EDGE_DELETE_BATCH_SIZE = 400;
const SUMMARY_LEAF_SOURCE_RANGE_REF_LIMIT = 50;
const PREPARED_CARD_SOURCE_RANGE_REF_LIMIT = 50;
const DATABASE_MAINTENANCE_DB_BYTES_THRESHOLD = 512 * 1024 * 1024;
const DATABASE_MAINTENANCE_WAL_BYTES_THRESHOLD = 32 * 1024 * 1024;
const DATABASE_MAINTENANCE_TOTAL_BYTES_THRESHOLD = 768 * 1024 * 1024;
const CODEX_JSONL_DRIFT_INDEX_NEXT_ACTION = "loo index codex --max-files 500 \"$HOME/.codex/sessions\" \"$HOME/.codex/archived_sessions\"";
const CODEX_JSONL_DRIFT_MISSING_DB_NEXT_ACTION = "loo index codex \"$HOME/.codex/sessions\"";
const CODEX_INDEX_LIMIT_RECOVERY_COMMAND = `loo index codex --max-files 100000 --max-bytes-per-file ${CODEX_RECOVERY_MAX_BYTES_PER_FILE} --max-events-per-file ${CODEX_RECOVERY_MAX_EVENTS_PER_FILE} "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"`;
const LCM_SUMMARY_DAG_MAX_NODES = 12;
const LCM_SUMMARY_DAG_MAX_DEPTH = 4;
const LCM_PEER_SUMMARY_SCAN_MAX = 500;
const LCM_SUMMARY_ID_MAX_CHARS = 200;
const LCM_SUMMARY_CONTENT_MAX_CHARS = 16_000;
const CLAUDE_INDEX_LIMIT_RECOVERY_COMMAND = `loo index claude --max-files 100000 --max-bytes-per-file ${CODEX_RECOVERY_MAX_BYTES_PER_FILE} --max-events-per-file ${CODEX_RECOVERY_MAX_EVENTS_PER_FILE} "$HOME/.claude/projects"`;

export function createDatabase(dbPath?: string): LooDatabase;
export function createDatabase(options: CreateDatabaseOptions): LooDatabase;
export function createDatabase(dbPath: string, options: CreateDatabasePathOptions): LooDatabase;
export function createDatabase(dbPathOrOptions?: string | CreateDatabaseOptions, pathOptions?: CreateDatabasePathOptions): LooDatabase {
  const resolved = typeof dbPathOrOptions === "string"
    ? dbPathOrOptions
    : dbPathOrOptions?.path ?? defaultDatabasePath();
  const maintenance = typeof dbPathOrOptions === "string"
    ? pathOptions?.maintenance ?? "full"
    : dbPathOrOptions?.maintenance ?? "full";
  const busyTimeoutMs = typeof dbPathOrOptions === "string"
    ? pathOptions?.busyTimeoutMs
    : dbPathOrOptions?.busyTimeoutMs;
  mkdirSync(dirname(resolved), { recursive: true });
  const DatabaseSync = getDatabaseSync();
  const openOptions = databaseOpenOptions(busyTimeoutMs);
  const db = openOptions ? new DatabaseSync(resolved, openOptions) : new DatabaseSync(resolved);
  migrate(db, { maintenance });
  return db;
}

function databaseOpenOptions(busyTimeoutMs?: number): { timeout?: number } | undefined {
  if (busyTimeoutMs === undefined) return undefined;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 1) return undefined;
  return { timeout: Math.min(busyTimeoutMs, 600_000) };
}

export function defaultDatabasePath(): string {
  return readEnv("DB_PATH") || join(resolveHomeDir(), ".openclaw", "lossless-openclaw-orchestrator", "orchestrator.sqlite");
}

export function codexEventContentEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = readEnv("EVENT_CONTENT", env)?.trim().toLowerCase();
  return !value || !["0", "false", "no", "off", "disabled"].includes(value);
}

export function defaultCodexRoots(home = resolveHomeDir()): string[] {
  return [
    join(home, ".codex", "sessions"),
    join(home, ".codex", "archived_sessions")
  ];
}

export function defaultClaudeRoots(home = resolveHomeDir()): string[] {
  return [join(home, ".claude", "projects")];
}

export function configuredLcmPeerDbPaths(raw = readEnv("LCM_DB_PATHS") ?? ""): string[] {
  return unique(normalizePeerPaths(raw.split(new RegExp(`[${escapeRegExp(delimiter)},\\n]`, "g")).map((part) => part.trim()).filter(Boolean)));
}

export function migrate(db: LooDatabase, options: { maintenance?: DatabaseMaintenanceMode } = {}): void {
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
      content_epoch TEXT,
      append_generation INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      last_indexed_at TEXT NOT NULL,
      metadata_extractor_version TEXT,
      prepared_range_extractor_version TEXT,
      summary_leaf_extractor_version TEXT,
      prepared_card_extractor_version TEXT,
      jsonl_drift_unknown_event_kinds_json TEXT NOT NULL DEFAULT '[]',
      jsonl_drift_unparsed_lines INTEGER NOT NULL DEFAULT 0,
      jsonl_drift_missing_expected_fields_json TEXT NOT NULL DEFAULT '[]',
      jsonl_drift_reason_codes_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS codex_source_integrity_state (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      destructive_generation INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO codex_source_integrity_state (singleton_id, destructive_generation)
    VALUES (1, 0);

    CREATE TABLE IF NOT EXISTS codex_index_limited_files (
      source_path TEXT PRIMARY KEY,
      path_hash TEXT NOT NULL,
      reason TEXT NOT NULL,
      limit_value INTEGER NOT NULL,
      actual_value INTEGER NOT NULL,
      observed_at TEXT NOT NULL
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
      arguments_text TEXT NOT NULL,
      reason_code TEXT
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

    CREATE VIRTUAL TABLE IF NOT EXISTS codex_search_fts USING fts5(
      thread_id UNINDEXED,
      title,
      summary,
      plans,
      finals,
      touched_files,
      tool_meta,
      body,
      tokenize = 'unicode61'
    );

    -- Audit ledger only: migration DDL in this module must remain independently
    -- idempotent via IF NOT EXISTS, INSERT OR IGNORE, or explicit guards.
    CREATE TABLE IF NOT EXISTS loo_schema_migrations (
      migration_id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    );

    INSERT OR IGNORE INTO loo_schema_migrations (migration_id, applied_at, description)
    VALUES
      (
        '2026-07-03-prepared-source-ranges',
        datetime('now'),
        'Additive prepared-state source events and source ranges'
      ),
      (
        '2026-07-03-summary-leaves',
        datetime('now'),
        'Additive prepared-state summary leaf and edge tables'
      ),
      (
        '2026-07-03-prepared-cards',
        datetime('now'),
        'Additive prepared-state card and inbox tables'
      ),
      (
        '2026-07-03-watcher-observations',
        datetime('now'),
        'Additive prepared-state watcher spec, observation, and attention queue tables'
      ),
      (
        '2026-07-03-hook-capture-packets',
        datetime('now'),
        'Additive prepared-state hook capture packet table'
      ),
      (
        '2026-07-03-state-prep-jobs',
        datetime('now'),
        'Additive prepared-state prep job table'
      ),
      (
        '2026-07-04-prepared-card-source-range-omissions',
        datetime('now'),
        'Persist prepared-card source range omission counts'
      ),
      (
        '2026-07-05-thread-title-aliases',
        datetime('now'),
        'Additive Codex thread title finalizer alias table'
      ),
      (
        '2026-07-06-index-fast-skip-and-hot-path-indexes',
        datetime('now'),
        'Additive Codex source extractor-state columns and hot read-path indexes'
      ),
      (
        '2026-07-08-codex-event-content-store',
        datetime('now'),
        'Additive redacted Codex event-content table and content-backed FTS index; existing corpora backfill on next index run'
      ),
      (
        '${RETRIEVAL_TELEMETRY_MIGRATION_ID}',
        datetime('now'),
        'Additive opt-in retrieval telemetry search and follow tables'
      ),
      (
        '2026-07-11-session-diff-cursor-indexes',
        datetime('now'),
        'Additive keyset indexes for bounded session-diff scans'
      ),
      (
        '2026-07-11-source-integrity-generation',
        datetime('now'),
        'Track destructive source rewrites separately from monotonic source additions'
      );

    CREATE TABLE IF NOT EXISTS prepared_source_events (
      event_id TEXT PRIMARY KEY,
      event_ref TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL REFERENCES codex_sessions(thread_id) ON DELETE CASCADE,
      source_ref TEXT NOT NULL,
      source_path_ref TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      event_kind TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      byte_start INTEGER NOT NULL,
      byte_end INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      observed_at TEXT,
      extractor_version TEXT NOT NULL,
      privacy_class TEXT NOT NULL,
      omission_status TEXT NOT NULL,
      confidence REAL NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS prepared_source_events_thread_idx ON prepared_source_events(thread_id, ordinal);
    CREATE INDEX IF NOT EXISTS prepared_source_events_source_ref_idx ON prepared_source_events(source_ref);
    CREATE INDEX IF NOT EXISTS prepared_source_events_source_path_ref_idx ON prepared_source_events(source_path_ref);

    CREATE TABLE IF NOT EXISTS codex_event_content (
      event_id TEXT PRIMARY KEY REFERENCES prepared_source_events(event_id) ON DELETE CASCADE,
      event_ref TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL REFERENCES codex_sessions(thread_id) ON DELETE CASCADE,
      source_ref TEXT NOT NULL,
      source_path_ref TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      event_kind TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      byte_start INTEGER NOT NULL,
      byte_end INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      observed_at TEXT,
      event_text TEXT NOT NULL DEFAULT '',
      event_text_hash TEXT NOT NULL,
      stored_chars INTEGER NOT NULL,
      truncated INTEGER NOT NULL DEFAULT 0,
      source_status TEXT NOT NULL DEFAULT 'source_available',
      privacy_class TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS codex_event_content_thread_idx ON codex_event_content(thread_id, ordinal);
    CREATE INDEX IF NOT EXISTS codex_event_content_event_ref_idx ON codex_event_content(event_ref);
    CREATE INDEX IF NOT EXISTS codex_event_content_source_path_ref_idx ON codex_event_content(source_path_ref);

    CREATE VIRTUAL TABLE IF NOT EXISTS codex_event_content_fts USING fts5(
      event_id UNINDEXED,
      thread_id UNINDEXED,
      event_text,
      content = 'codex_event_content',
      content_rowid = 'rowid',
      tokenize = 'unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS codex_event_content_ai AFTER INSERT ON codex_event_content BEGIN
      INSERT INTO codex_event_content_fts(rowid, event_id, thread_id, event_text)
      VALUES (new.rowid, new.event_id, new.thread_id, new.event_text);
    END;

    CREATE TRIGGER IF NOT EXISTS codex_event_content_ad AFTER DELETE ON codex_event_content BEGIN
      INSERT INTO codex_event_content_fts(codex_event_content_fts, rowid, event_id, thread_id, event_text)
      VALUES('delete', old.rowid, old.event_id, old.thread_id, old.event_text);
    END;

    CREATE TRIGGER IF NOT EXISTS codex_event_content_au AFTER UPDATE ON codex_event_content BEGIN
      INSERT INTO codex_event_content_fts(codex_event_content_fts, rowid, event_id, thread_id, event_text)
      VALUES('delete', old.rowid, old.event_id, old.thread_id, old.event_text);
      INSERT INTO codex_event_content_fts(rowid, event_id, thread_id, event_text)
      VALUES (new.rowid, new.event_id, new.thread_id, new.event_text);
    END;

    CREATE TABLE IF NOT EXISTS prepared_source_ranges (
      range_id TEXT PRIMARY KEY,
      range_ref TEXT NOT NULL UNIQUE,
      event_id TEXT NOT NULL REFERENCES prepared_source_events(event_id) ON DELETE CASCADE,
      event_ref TEXT NOT NULL,
      thread_id TEXT NOT NULL REFERENCES codex_sessions(thread_id) ON DELETE CASCADE,
      source_ref TEXT NOT NULL,
      source_path_ref TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      session_diff_key TEXT,
      range_kind TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      byte_start INTEGER NOT NULL,
      byte_end INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      observed_at TEXT,
      extractor_version TEXT NOT NULL,
      privacy_class TEXT NOT NULL,
      omission_status TEXT NOT NULL,
      confidence REAL NOT NULL,
      reason_codes_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS prepared_source_ranges_thread_idx ON prepared_source_ranges(thread_id, ordinal);
    CREATE INDEX IF NOT EXISTS prepared_source_ranges_kind_idx ON prepared_source_ranges(range_kind);
    CREATE INDEX IF NOT EXISTS prepared_source_ranges_source_ref_idx ON prepared_source_ranges(source_ref);
    CREATE INDEX IF NOT EXISTS prepared_source_ranges_source_path_ref_idx ON prepared_source_ranges(source_path_ref);

    CREATE TABLE IF NOT EXISTS summary_leaves (
      leaf_id TEXT PRIMARY KEY,
      leaf_ref TEXT NOT NULL UNIQUE,
      thread_id TEXT REFERENCES codex_sessions(thread_id) ON DELETE CASCADE,
      leaf_kind TEXT NOT NULL,
      summary_text TEXT NOT NULL DEFAULT '',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      source_range_refs_json TEXT NOT NULL DEFAULT '[]',
      input_hash TEXT NOT NULL,
      output_hash TEXT NOT NULL,
      extractor_version TEXT NOT NULL,
      privacy_class TEXT NOT NULL,
      authority_coverage_json TEXT NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL,
      freshness_at TEXT,
      stale INTEGER NOT NULL DEFAULT 0,
      omission_status TEXT NOT NULL DEFAULT 'metadata_only',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS summary_edges (
      edge_id TEXT PRIMARY KEY,
      parent_leaf_ref TEXT NOT NULL,
      child_leaf_ref TEXT NOT NULL,
      edge_kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(parent_leaf_ref, child_leaf_ref, edge_kind)
    );

    CREATE INDEX IF NOT EXISTS summary_leaves_thread_extractor_idx ON summary_leaves(thread_id, extractor_version, privacy_class, omission_status);
    CREATE INDEX IF NOT EXISTS summary_leaves_session_diff_idx ON summary_leaves(created_at, leaf_ref);
    CREATE INDEX IF NOT EXISTS summary_leaves_thread_session_diff_idx ON summary_leaves(thread_id, created_at, leaf_ref);

    CREATE TABLE IF NOT EXISTS prepared_cards (
      card_id TEXT PRIMARY KEY,
      card_ref TEXT NOT NULL UNIQUE,
      target_ref TEXT NOT NULL,
      card_kind TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      objective TEXT NOT NULL DEFAULT '',
      summary_text TEXT NOT NULL DEFAULT '',
      blocker TEXT,
      next_action TEXT,
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      source_range_refs_json TEXT NOT NULL DEFAULT '[]',
      source_range_refs_omitted INTEGER NOT NULL DEFAULT 0,
      authority_coverage_json TEXT NOT NULL DEFAULT '{}',
      input_hash TEXT NOT NULL,
      extractor_version TEXT NOT NULL,
      privacy_class TEXT NOT NULL,
      confidence REAL NOT NULL,
      freshness_at TEXT,
      stale INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'unknown',
      reason_codes_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS prepared_cards_target_extractor_idx ON prepared_cards(target_ref, extractor_version, privacy_class, state);
    CREATE INDEX IF NOT EXISTS prepared_cards_session_diff_idx ON prepared_cards(updated_at, card_ref);
    CREATE INDEX IF NOT EXISTS prepared_cards_target_session_diff_idx ON prepared_cards(target_ref, updated_at, card_ref);

    CREATE TABLE IF NOT EXISTS prepared_inbox_items (
      item_id TEXT PRIMARY KEY,
      card_ref TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      urgency_score REAL NOT NULL,
      state TEXT NOT NULL DEFAULT 'unknown',
      reason_codes_json TEXT NOT NULL DEFAULT '[]',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      execute_false INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS prepared_inbox_target_score_idx ON prepared_inbox_items(target_ref, urgency_score DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS prepared_inbox_session_diff_idx ON prepared_inbox_items(updated_at, item_id);
    CREATE INDEX IF NOT EXISTS prepared_inbox_target_session_diff_idx ON prepared_inbox_items(target_ref, updated_at, item_id);

    CREATE TABLE IF NOT EXISTS watcher_specs (
      watch_id TEXT PRIMARY KEY,
      target_ref TEXT NOT NULL,
      spec_json TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      privacy_class TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS watcher_observations (
      observation_id TEXT PRIMARY KEY,
      watch_id TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      observation_json TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL DEFAULT '[]',
      input_hash TEXT NOT NULL,
      privacy_class TEXT NOT NULL,
      confidence REAL NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS watcher_observations_session_diff_idx ON watcher_observations(created_at, observation_id);
    CREATE INDEX IF NOT EXISTS watcher_observations_target_session_diff_idx ON watcher_observations(target_ref, created_at, observation_id);

    CREATE TABLE IF NOT EXISTS attention_queue (
      queue_id TEXT PRIMARY KEY,
      target_ref TEXT NOT NULL,
      item_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      tool_call_json TEXT,
      execute_false INTEGER NOT NULL DEFAULT 1,
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      reason_codes_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hook_capture_packets (
      packet_id TEXT PRIMARY KEY,
      hook_kind TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      packet_json TEXT NOT NULL,
      privacy_class TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(hook_kind, target_ref, payload_hash)
    );

    CREATE TABLE IF NOT EXISTS state_prep_jobs (
      job_id TEXT PRIMARY KEY,
      job_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      target_ref TEXT,
      input_hash TEXT NOT NULL,
      output_hash TEXT,
      mutation_classes_json TEXT NOT NULL DEFAULT '["derived_cache"]',
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS codex_thread_title_aliases (
      alias_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      alias_kind TEXT NOT NULL,
      alias_text TEXT NOT NULL,
      alias_norm TEXT NOT NULL,
      source_packet_id TEXT NOT NULL,
      reason_codes_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(thread_id, alias_kind)
    );

    CREATE INDEX IF NOT EXISTS codex_thread_title_aliases_norm_idx ON codex_thread_title_aliases(alias_norm);
    CREATE INDEX IF NOT EXISTS codex_thread_title_aliases_thread_idx ON codex_thread_title_aliases(thread_id);

    CREATE TABLE IF NOT EXISTS telemetry_search_events (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      query_text TEXT NOT NULL DEFAULT '',
      query_hash TEXT NOT NULL,
      result_refs_json TEXT NOT NULL DEFAULT '[]',
      matched_field_distribution_json TEXT NOT NULL DEFAULT '{}',
      engine_version TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS telemetry_search_events_ts_idx ON telemetry_search_events(ts DESC);
    CREATE INDEX IF NOT EXISTS telemetry_search_events_query_hash_idx ON telemetry_search_events(query_hash, ts DESC);

    CREATE TABLE IF NOT EXISTS telemetry_follow_events (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      search_event_id TEXT NOT NULL REFERENCES telemetry_search_events(id) ON DELETE CASCADE,
      chosen_ref TEXT NOT NULL,
      rank_position INTEGER NOT NULL,
      follow_kind TEXT NOT NULL,
      CHECK (follow_kind IN ('describe', 'expand'))
    );

    CREATE INDEX IF NOT EXISTS telemetry_follow_events_search_idx ON telemetry_follow_events(search_event_id, ts DESC);
    CREATE INDEX IF NOT EXISTS telemetry_follow_events_chosen_ref_idx ON telemetry_follow_events(chosen_ref, ts DESC);
    CREATE INDEX IF NOT EXISTS telemetry_follow_events_ts_idx ON telemetry_follow_events(ts DESC);

    CREATE INDEX IF NOT EXISTS codex_sessions_recent_coalesce_idx ON codex_sessions(COALESCE(updated_at, indexed_at) DESC, thread_id);
    CREATE INDEX IF NOT EXISTS codex_session_metadata_filters_idx ON codex_session_metadata(
      LOWER(COALESCE(project, '')),
      LOWER(COALESCE(status, '')),
      LOWER(COALESCE(priority, '')),
      thread_id
    );
    CREATE INDEX IF NOT EXISTS prepared_cards_extractor_order_idx ON prepared_cards(
      extractor_version,
      privacy_class,
      stale DESC,
      confidence ASC,
      freshness_at DESC,
      target_ref ASC,
      card_ref ASC
    );
    CREATE INDEX IF NOT EXISTS prepared_inbox_execute_score_idx ON prepared_inbox_items(
      execute_false,
      urgency_score DESC,
      state ASC,
      target_ref ASC,
      card_ref ASC
    );
    CREATE INDEX IF NOT EXISTS prepared_inbox_execute_target_score_idx ON prepared_inbox_items(
      execute_false,
      target_ref,
      urgency_score DESC,
      state ASC,
      card_ref ASC
    );
    CREATE INDEX IF NOT EXISTS attention_queue_execute_kind_confidence_idx ON attention_queue(
      execute_false,
      item_kind,
      confidence DESC,
      updated_at DESC,
      queue_id ASC
    );
    CREATE INDEX IF NOT EXISTS attention_queue_execute_target_kind_confidence_idx ON attention_queue(
      execute_false,
      target_ref,
      item_kind,
      confidence DESC,
      updated_at DESC,
      queue_id ASC
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
  ensureColumn(db, "prepared_cards", "objective", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "prepared_cards", "blocker", "TEXT");
  ensureColumn(db, "prepared_cards", "source_range_refs_omitted", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "prepared_source_ranges", "session_diff_key", "TEXT");
  ensureColumn(db, "codex_tool_calls", "reason_code", "TEXT");
  ensureColumn(db, "codex_source_files", "metadata_extractor_version", "TEXT");
  ensureColumn(db, "codex_source_files", "content_epoch", "TEXT");
  ensureColumn(db, "codex_source_files", "append_generation", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "codex_source_files", "prepared_range_extractor_version", "TEXT");
  ensureColumn(db, "codex_source_files", "summary_leaf_extractor_version", "TEXT");
  ensureColumn(db, "codex_source_files", "prepared_card_extractor_version", "TEXT");
  ensureColumn(db, "codex_source_files", "jsonl_drift_unknown_event_kinds_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "codex_source_files", "jsonl_drift_unparsed_lines", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "codex_source_files", "jsonl_drift_missing_expected_fields_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "codex_source_files", "jsonl_drift_reason_codes_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "telemetry_search_events", "telemetry_session_key", "TEXT");
  const sessionDiffKeyMigrationRecorded = db
    .prepare("SELECT 1 FROM loo_schema_migrations WHERE migration_id = ?")
    .get("2026-07-11-session-diff-persisted-key") !== undefined;
  if (!sessionDiffKeyMigrationRecorded) {
    db.exec(`
      UPDATE prepared_source_ranges
      SET session_diff_key = source_path_ref || ':' || printf('%012d', ordinal) || ':' || range_kind || ':' || content_hash
      WHERE session_diff_key IS NULL;
      INSERT OR IGNORE INTO loo_schema_migrations (migration_id, applied_at, description)
      VALUES (
        '2026-07-11-session-diff-persisted-key',
        datetime('now'),
        'Persist the stable semantic source-range cursor key for seekable session-diff pagination'
      );
    `);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS prepared_source_ranges_session_diff_key_idx ON prepared_source_ranges(created_at, session_diff_key);
    CREATE INDEX IF NOT EXISTS prepared_source_ranges_thread_session_diff_key_idx ON prepared_source_ranges(thread_id, created_at, session_diff_key);
    CREATE INDEX IF NOT EXISTS prepared_source_ranges_source_session_diff_key_idx ON prepared_source_ranges(source_ref, created_at, session_diff_key);
    CREATE TRIGGER IF NOT EXISTS prepared_source_ranges_session_diff_key_ai
    AFTER INSERT ON prepared_source_ranges
    WHEN new.session_diff_key IS NULL
    BEGIN
      UPDATE prepared_source_ranges
      SET session_diff_key = new.source_path_ref || ':' || printf('%012d', new.ordinal) || ':' || new.range_kind || ':' || new.content_hash
      WHERE range_id = new.range_id;
    END;
    CREATE TRIGGER IF NOT EXISTS prepared_source_ranges_session_diff_key_au
    AFTER UPDATE OF source_path_ref, ordinal, range_kind, content_hash ON prepared_source_ranges
    WHEN new.session_diff_key IS NULL
      OR new.session_diff_key <> (new.source_path_ref || ':' || printf('%012d', new.ordinal) || ':' || new.range_kind || ':' || new.content_hash)
    BEGIN
      UPDATE prepared_source_ranges
      SET session_diff_key = new.source_path_ref || ':' || printf('%012d', new.ordinal) || ':' || new.range_kind || ':' || new.content_hash
      WHERE range_id = new.range_id;
    END;
    CREATE INDEX IF NOT EXISTS telemetry_search_events_session_ts_idx ON telemetry_search_events(telemetry_session_key, ts DESC);
    INSERT OR IGNORE INTO loo_schema_migrations (migration_id, applied_at, description)
    VALUES (
      '${RETRIEVAL_TELEMETRY_SESSION_KEY_MIGRATION_ID}',
      datetime('now'),
      'Additive retrieval telemetry session-key column and session timestamp index'
    );
  `);
  if (options.maintenance !== "schema-only") {
    // Gate FTS maintenance on rowid-pinning drift. The pinned-count check also
    // detects count drift, so migration and index paths share one repair test.
    const codexSearchFtsMigrationRecorded = db
      .prepare("SELECT 1 FROM loo_schema_migrations WHERE migration_id = ?")
      .get(CODEX_SEARCH_FTS_MIGRATION_ID) !== undefined;
    repairCodexFtsRowidPinning(db, {
      forceSearchRepair: !codexSearchFtsMigrationRecorded,
      recordSearchMigration: !codexSearchFtsMigrationRecorded
    });
  }
}

function ensureColumn(db: LooDatabase, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((row) => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function indexCodexSessions(db: LooDatabase, options: IndexCodexOptions): IndexCodexResult {
  const fileSelection = collectJsonlFiles(options.roots, options.maxFiles ?? 10_000);
  const files = fileSelection.files;
  const maxBytesPerFile = positiveLimit(options.maxBytesPerFile, DEFAULT_CODEX_MAX_BYTES_PER_FILE, "maxBytesPerFile");
  const maxEventsPerFile = positiveLimit(options.maxEventsPerFile, DEFAULT_CODEX_MAX_EVENTS_PER_FILE, "maxEventsPerFile");
  const verify = options.verify === true;
  const eventContentEnabled = options.eventContent ?? codexEventContentEnabled();
  const result: IndexCodexResult = {
    publicSafe: false,
    readOnly: false,
    mutationClasses: ["derived_cache"],
    indexedFiles: 0,
    appendDeltaIndexedFiles: 0,
    indexLimits: {
      maxBytesPerFile,
      maxEventsPerFile
    },
    skippedFiles: 0,
    indexedThreads: 0,
    indexedEvents: 0,
    preparedMaterialization: {
      requestedThreads: 0,
      completedThreads: 0,
      pendingThreads: 0
    },
    limitedFiles: [],
    warnings: [],
    errors: [],
    driftReport: [],
    driftSummary: emptyCodexJsonlDriftSummary()
  };
  if (fileSelection.droppedOldest) {
    result.skippedFiles += Math.max(0, fileSelection.droppedOldest.actual - fileSelection.droppedOldest.limit);
    result.limitedFiles.push(fileSelection.droppedOldest);
  }
  result.errors.push(...fileSelection.errors);
  pruneMissingCodexSourceFiles(db, options.roots, fileSelection.candidateFiles);
  repairCodexFtsRowidPinning(db);
  const seenThreads = new Set<string>();
  const summaryThreadsToMaterialize = new Set<string>();
  const preparedThreadsToMaterialize = new Set<string>();

  for (const path of files) {
    try {
      const stat = statSync(path);
      if (stat.size > maxBytesPerFile) {
        recordLimitedFile(db, result, path, "max_bytes_per_file", maxBytesPerFile, stat.size);
        continue;
      }
      const watermark = getSourceFileWatermark(db, path);
      const mtimeMs = Math.trunc(stat.mtimeMs);
      const sameWatermark = Boolean(watermark && watermark.size === stat.size && watermark.mtimeMs === mtimeMs);
      const extractorStateCurrent = watermark ? sourceFileExtractorStateIsCurrent(watermark) : false;
      const eventContentCurrent = !eventContentEnabled || (watermark ? sourceFileEventContentCurrent(db, path) : false);
      if (sameWatermark && extractorStateCurrent && eventContentCurrent && !verify) {
        result.skippedFiles += 1;
        continue;
      }
      if (watermark && extractorStateCurrent && eventContentCurrent && stat.size > watermark.size) {
        const appendDelta = tryIndexCodexAppendDelta(db, path, stat, watermark, maxEventsPerFile, eventContentEnabled);
        if (appendDelta) {
          result.indexedFiles += 1;
          result.appendDeltaIndexedFiles += 1;
          result.indexedEvents += appendDelta.eventCount;
          if (appendDelta.driftReport) recordCodexJsonlDriftReport(result, appendDelta.driftReport);
          seenThreads.add(appendDelta.threadId);
          summaryThreadsToMaterialize.add(appendDelta.threadId);
          preparedThreadsToMaterialize.add(appendDelta.threadId);
          continue;
        }
      }
      const text = readFileSync(path, "utf8");
      const eventCount = countJsonlEvents(text);
      if (eventCount > maxEventsPerFile) {
        recordLimitedFile(db, result, path, "max_events_per_file", maxEventsPerFile, eventCount);
        continue;
      }
      const sourceHash = stableId(text);
      if (watermark && extractorStateCurrent && eventContentCurrent && watermark.pathHash === sourceHash) {
        if (!sameWatermark) refreshSourceFileWatermarkMetadata(db, path, stat);
        result.skippedFiles += 1;
        continue;
      }
      const session = parseCodexJsonl(path, text, maxEventsPerFile);
      if (
        eventContentEnabled
        && watermark
        && extractorStateCurrent
        && !eventContentCurrent
        && watermark.pathHash === sourceHash
      ) {
        backfillCodexEventContentForSession(db, session);
        result.indexedFiles += 1;
        result.indexedEvents += session.eventCount;
        seenThreads.add(session.threadId);
        continue;
      }
      upsertSession(db, path, text, session, { size: stat.size, mtimeMs }, {
        eventContentEnabled,
        monotonicAppend: watermark ? sourceTextExtendsWatermark(text, watermark) : false
      });
      result.indexedFiles += 1;
      result.indexedEvents += session.eventCount;
      if (session.driftReport) recordCodexJsonlDriftReport(result, session.driftReport);
      seenThreads.add(session.threadId);
      summaryThreadsToMaterialize.add(session.threadId);
      preparedThreadsToMaterialize.add(session.threadId);
    } catch (error) {
      result.errors.push({ path, message: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const threadId of summaryThreadsToMaterialize) {
    try {
      materializeSummaryLeaves(db, { threadId });
      markSourceFilesSummaryLeafCurrent(db, threadId);
    } catch (error) {
      result.errors.push({ path: codexThreadRef(threadId), message: error instanceof Error ? error.message : String(error) });
    }
  }
  const preparedThreadIds = [...preparedThreadsToMaterialize];
  result.preparedMaterialization.requestedThreads = preparedThreadIds.length;
  result.preparedMaterialization.pendingThreads = preparedThreadIds.length;
  const preparedCardLookupCache = buildPreparedCardWorkStateLookupCache(db, preparedThreadIds);
  for (const threadId of preparedThreadIds) {
    try {
      materializePreparedCardsForTarget(db, threadId, preparedCardLookupCache);
      markSourceFilesPreparedCardCurrent(db, threadId);
      result.preparedMaterialization.completedThreads += 1;
      result.preparedMaterialization.pendingThreads -= 1;
    } catch (error) {
      result.errors.push({ path: codexThreadRef(threadId), message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (options.lcmDbPaths !== undefined && (options.lcmDbPaths.length > 0 || hasPreparedLcmState(db))) {
    db.exec("BEGIN IMMEDIATE");
    try {
      materializePreparedCardsForLcmPeers(db, options.lcmDbPaths, allocateSessionDiffMutationTimestamp(db));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      result.errors.push({ path: "lcm_summary:configured_peers", message: error instanceof Error ? error.message : String(error) });
    }
  }

  result.indexedThreads = seenThreads.size;
  result.warnings = createCodexIndexLimitWarnings(result.limitedFiles);
  return result;
}

function refreshSourceFileWatermarkMetadata(
  db: LooDatabase,
  sourcePath: string,
  stat: { size: number; mtimeMs: number }
): void {
  db.prepare(`
    UPDATE codex_source_files
    SET size = ?, mtime_ms = ?, last_indexed_at = ?
    WHERE source_path = ?
  `).run(stat.size, Math.trunc(stat.mtimeMs), new Date().toISOString(), sourcePath);
  db.prepare("DELETE FROM codex_index_limited_files WHERE source_path = ?").run(sourcePath);
}

function backfillCodexEventContentForSession(db: LooDatabase, session: ImportedSession): void {
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    for (const event of session.sourceEvents) {
      const eventId = event.eventRef.slice("codex_event:".length);
      upsertCodexEventContentForDraft(db, {
        event,
        eventId,
        threadId: session.threadId,
        sourceRef: codexThreadRef(session.threadId),
        sourcePathRef: event.sourcePathRef,
        sourceHash: event.sourceHash,
        privacyClass: "public_safe_metadata",
        now
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function parseClaudeCodeJsonl(sourcePath: string, text: string): ParsedClaudeCodeSession {
  const records = jsonlLineRecords(text);
  const sourcePathRef = publicClaudeSourcePathRef(sourcePath);
  const sourceHash = stableId(text);
  const projectSlug = safeClaudeProjectSlug(sourcePath);
  const safeParts: string[] = [];
  const sourceRanges: ClaudeCodeSourceRange[] = [];
  const parseErrors: ClaudeCodeParseError[] = [];
  const omissions = new Map<ClaudeCodeParseOmissionReason, number>();
  const eventCounts: ParsedClaudeCodeSession["eventCounts"] = {
    userMessages: 0,
    assistantMessages: 0,
    toolUses: 0,
    toolResults: 0,
    summaries: 0,
    metadata: 0,
    unknown: 0
  };
  let sessionId: string | null = null;
  let updatedAt: string | null = null;

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    let item: any;
    try {
      item = JSON.parse(record.text);
    } catch {
      parseErrors.push({ lineNumber: record.lineNumber, reason: "invalid_json" });
      incrementClaudeOmission(omissions, "invalid_json_line");
      continue;
    }
    const parsedEvent = parseClaudeCodeEvent(item);
    sessionId ??= safeClaudeCodeSessionIdFromItem(item);
    updatedAt = parsedEvent.observedAt ?? updatedAt;
    if (parsedEvent.safeParts.length > 0) safeParts.push(...parsedEvent.safeParts);
    eventCounts.userMessages += parsedEvent.kind === "user_message" ? 1 : 0;
    eventCounts.assistantMessages += parsedEvent.kind === "assistant_message" ? 1 : 0;
    eventCounts.toolUses += parsedEvent.toolUses;
    eventCounts.toolResults += parsedEvent.toolResults;
    eventCounts.summaries += parsedEvent.kind === "summary" ? 1 : 0;
    eventCounts.metadata += parsedEvent.kind === "metadata" ? 1 : 0;
    eventCounts.unknown += parsedEvent.kind === "unknown" ? 1 : 0;
    for (const reason of parsedEvent.omissions) incrementClaudeOmission(omissions, reason);
    const contentHash = stableId(record.text);
    const eventId = stableId(`${sourcePathRef}:${sourceHash}:${i}:${record.lineNumber}:${parsedEvent.kind}:${contentHash}`);
    const eventRef = `claude_event:${eventId}`;
    sourceRanges.push({
      eventRef,
      rangeRef: `claude_range:${stableId(`${eventRef}:${parsedEvent.kind}`)}`,
      eventKind: parsedEvent.kind,
      lineStart: record.lineNumber,
      lineEnd: record.lineNumber,
      byteStart: record.byteStart,
      byteEnd: record.byteEnd,
      ordinal: i,
      observedAt: parsedEvent.observedAt,
      privacyClass: "public_safe_metadata",
      confidence: parsedEvent.kind === "unknown" ? 0.35 : 0.9,
      reasonCodes: claudeCodeRangeReasonCodes(parsedEvent)
    });
  }

  const safeSessionId = sessionId ?? `claude_${stableId(sourcePath).slice(0, 16)}`;
  const safeTextRaw = unique(safeParts.map((part) => normalizeText(part)).filter(Boolean)).join("\n");
  const safeText = publicSafeText(safeTextRaw, CODEX_SAFE_TEXT_CHAR_LIMIT);
  if (safeTextRaw.length > safeText.length) incrementClaudeOmission(omissions, "safe_text_truncated");
  const title = firstClaudeTitle(safeParts);
  return {
    sourceKind: "claude_session",
    sessionId: safeSessionId,
    sourceRef: claudeSessionRef(safeSessionId),
    sourcePathRef,
    projectSlug,
    title,
    updatedAt,
    eventCount: sourceRanges.length,
    eventCounts,
    sourceRanges,
    safeText,
    omissions: [...omissions.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => a.reason.localeCompare(b.reason)),
    parseErrors,
    privacyClass: "public_safe_metadata",
    confidence: parseErrors.length > 0 || eventCounts.unknown > 0 ? 0.7 : 0.9,
    freshness: {
      updatedAt,
      stale: false
    }
  };
}

export function indexClaudeSessions(db: LooDatabase, options: IndexClaudeOptions): IndexClaudeResult {
  const fileSelection = collectJsonlFiles(options.roots, options.maxFiles ?? 10_000);
  const maxBytesPerFile = positiveLimit(options.maxBytesPerFile, DEFAULT_CODEX_MAX_BYTES_PER_FILE, "maxBytesPerFile");
  const maxEventsPerFile = positiveLimit(options.maxEventsPerFile, DEFAULT_CODEX_MAX_EVENTS_PER_FILE, "maxEventsPerFile");
  const result: IndexClaudeResult = {
    publicSafe: true,
    readOnly: false,
    mutationClasses: ["derived_cache"],
    indexedFiles: 0,
    indexLimits: {
      maxBytesPerFile,
      maxEventsPerFile
    },
    skippedFiles: 0,
    indexedSessions: 0,
    indexedEvents: 0,
    limitedFiles: [],
    warnings: [],
    errors: []
  };

  if (fileSelection.droppedOldest) {
    const dropped = publicSafeClaudeLimitedFile(fileSelection.droppedOldest);
    result.skippedFiles += Math.max(0, dropped.actual - dropped.limit);
    result.limitedFiles.push(dropped);
  }
  result.errors.push(...fileSelection.errors.map((error) => ({
    path: publicClaudeSourcePathRef(error.path),
    message: publicSafeText(error.message, 500)
  })));

  const seenSessions = new Set<string>();
  for (const path of fileSelection.files) {
    try {
      const sourcePathRef = publicClaudeSourcePathRef(path);
      const stat = statSync(path);
      if (stat.size > maxBytesPerFile) {
        recordLimitedClaudeFile(db, result, sourcePathRef, "max_bytes_per_file", maxBytesPerFile, stat.size);
        continue;
      }
      const text = readFileSync(path, "utf8");
      const parsed = parseClaudeCodeJsonl(path, text);
      if (parsed.eventCount > maxEventsPerFile) {
        recordLimitedClaudeFile(db, result, parsed.sourcePathRef, "max_events_per_file", maxEventsPerFile, parsed.eventCount);
        continue;
      }
      upsertParsedClaudeCodeSession(db, parsed);
      result.indexedFiles += 1;
      result.indexedEvents += parsed.eventCount;
      seenSessions.add(parsed.sessionId);
      for (const parseError of parsed.parseErrors) {
        result.errors.push({
          path: parsed.sourcePathRef,
          message: `invalid_json_line:${parseError.lineNumber}`
        });
      }
    } catch (error) {
      result.errors.push({
        path: publicClaudeSourcePathRef(path),
        message: publicSafeText(error instanceof Error ? error.message : String(error), 500)
      });
    }
  }

  result.indexedSessions = seenSessions.size;
  result.warnings = createClaudeIndexLimitWarnings(result.limitedFiles);
  return result;
}

function upsertParsedClaudeCodeSession(db: LooDatabase, parsed: ParsedClaudeCodeSession, now = new Date().toISOString()): void {
  const sourceRefs = unique([
    parsed.sourceRef,
    parsed.sourcePathRef,
    ...parsed.sourceRanges.map((range) => range.rangeRef).slice(0, 50)
  ]);
  const safeSummary = publicSafeText(parsed.safeText || parsed.title || "", 4000);
  const ftsContent = [
    parsed.title,
    parsed.projectSlug ? `Project: ${parsed.projectSlug}` : null,
    safeSummary,
    sourceRefs.join(" ")
  ].filter(Boolean).join("\n");

  db.exec("BEGIN");
  try {
    clearRemappedClaudeSourcePathSessions(db, parsed.sourcePathRef, parsed.sessionId);
    db.prepare("DELETE FROM claude_safe_text_fts WHERE session_id = ?").run(parsed.sessionId);
    db.prepare("DELETE FROM claude_sessions WHERE session_id = ?").run(parsed.sessionId);
    db.prepare(`
      INSERT INTO claude_sessions (
        session_id, title, project, workspace_hint, status, source_path, updated_at,
        safe_summary, safe_text, source_refs_json, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.sessionId,
      parsed.title,
      parsed.projectSlug,
      null,
      "indexed",
      parsed.sourcePathRef,
      parsed.updatedAt,
      safeSummary,
      publicSafeText(parsed.safeText, CODEX_SAFE_TEXT_CHAR_LIMIT),
      JSON.stringify(sourceRefs),
      now
    );
    db.prepare("INSERT INTO claude_safe_text_fts (session_id, content) VALUES (?, ?)").run(parsed.sessionId, ftsContent);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function clearRemappedClaudeSourcePathSessions(db: LooDatabase, sourcePathRef: string, sessionId: string): void {
  const rows = db.prepare("SELECT session_id AS sessionId FROM claude_sessions WHERE source_path = ? AND session_id <> ?").all(sourcePathRef, sessionId) as Array<{ sessionId: string }>;
  if (rows.length === 0) return;
  const deleteFts = db.prepare("DELETE FROM claude_safe_text_fts WHERE session_id = ?");
  const deleteSession = db.prepare("DELETE FROM claude_sessions WHERE session_id = ?");
  for (const row of rows) {
    deleteFts.run(row.sessionId);
    deleteSession.run(row.sessionId);
  }
}

function clearClaudeSessionsForSourcePathRef(db: LooDatabase, sourcePathRef: string): void {
  const rows = db.prepare("SELECT session_id AS sessionId FROM claude_sessions WHERE source_path = ?").all(sourcePathRef) as Array<{ sessionId: string }>;
  if (rows.length === 0) return;
  const deleteFts = db.prepare("DELETE FROM claude_safe_text_fts WHERE session_id = ?");
  const deleteSession = db.prepare("DELETE FROM claude_sessions WHERE session_id = ?");
  for (const row of rows) {
    deleteFts.run(row.sessionId);
    deleteSession.run(row.sessionId);
  }
}

function recordLimitedClaudeFile(
  db: LooDatabase,
  result: IndexClaudeResult,
  sourcePathRef: string,
  reason: LimitedCodexFile["reason"],
  limit: number,
  actual: number
): void {
  clearClaudeSessionsForSourcePathRef(db, sourcePathRef);
  result.skippedFiles += 1;
  result.limitedFiles.push({ path: sourcePathRef, reason, limit, actual });
}

function publicSafeClaudeLimitedFile(file: LimitedCodexFile): LimitedCodexFile {
  return {
    path: publicClaudeSourcePathRef(file.path),
    reason: file.reason,
    limit: file.limit,
    actual: file.actual
  };
}

function createClaudeIndexLimitWarnings(limitedFiles: LimitedCodexFile[]): ClaudeIndexLimitWarning[] {
  if (limitedFiles.length === 0) return [];
  return [{
    code: "claude_index_limited_files_skipped",
    message: "Some Claude Code JSONL session files were skipped by index caps. Re-run with intentional local-only overrides to include capped files.",
    limitedFiles: limitedFiles.length,
    skippedFiles: countCodexIndexLimitSkippedFiles(limitedFiles),
    reasons: summarizeCodexIndexLimitReasons(limitedFiles),
    nextSafeCommands: [CLAUDE_INDEX_LIMIT_RECOVERY_COMMAND]
  }];
}

type ParsedClaudeCodeEvent = {
  kind: ClaudeCodeEventKind;
  observedAt: string | null;
  safeParts: string[];
  toolUses: number;
  toolResults: number;
  omissions: ClaudeCodeParseOmissionReason[];
};

function parseClaudeCodeEvent(item: any): ParsedClaudeCodeEvent {
  const type = publicSafeIdentifier(stringOrNull(item?.type) ?? "") ?? "";
  const role = publicSafeIdentifier(stringOrNull(item?.message?.role) ?? "") ?? "";
  const observedAt = stringOrNull(item?.timestamp ?? item?.created_at ?? item?.createdAt);
  const safeParts: string[] = [];
  const omissions: ClaudeCodeParseOmissionReason[] = [];
  let toolUses = 0;
  let toolResults = 0;
  let sawToolResult = false;

  if (typeof item?.toolUseResult === "object" && item.toolUseResult !== null) {
    sawToolResult = true;
    toolResults = 1;
    omissions.push("raw_result_payload_omitted");
  }

  const messageContent = item?.message?.content;
  const contentItems = Array.isArray(messageContent) ? messageContent : [];
  for (const part of contentItems) {
    if (!part || typeof part !== "object") continue;
    const partType = stringOrNull((part as { type?: unknown }).type);
    if (partType === "text") {
      const textPart = nullablePublicSafeString((part as { text?: unknown }).text, 2000);
      if (textPart) safeParts.push(textPart);
      continue;
    }
    if (partType === "tool_use") {
      toolUses += 1;
      omissions.push("tool_payload_omitted");
      const name = publicSafeToolName(stringOrNull((part as { name?: unknown }).name) ?? "unknown");
      safeParts.push(`Tool use: ${name}`);
      continue;
    }
    if (partType === "tool_result") {
      if (!sawToolResult) {
        toolResults += 1;
        sawToolResult = true;
      }
      omissions.push("raw_result_payload_omitted");
      safeParts.push("Tool result omitted");
    }
  }

  if (typeof messageContent === "string") {
    const textPart = publicSafeText(messageContent, 2000);
    if (textPart) safeParts.push(textPart);
  }

  const summary = nullablePublicSafeString(item?.summary, 2000);
  if (summary) safeParts.push(summary);

  let kind: ClaudeCodeEventKind = "unknown";
  if (type === "summary") kind = "summary";
  else if (toolResults > 0 && role !== "assistant") kind = "tool_result";
  else if (role === "assistant" || type === "assistant") kind = "assistant_message";
  else if (role === "user" || type === "user") kind = "user_message";
  else if (type === "system" || type === "metadata") kind = "metadata";
  if (kind === "unknown") omissions.push("unknown_event_kind");

  return {
    kind,
    observedAt,
    safeParts,
    toolUses,
    toolResults,
    omissions
  };
}

function safeClaudeCodeSessionIdFromItem(item: any): string | null {
  const raw = stringOrNull(item?.sessionId ?? item?.session_id ?? item?.conversationId ?? item?.conversation_id);
  return raw ? safeClaudeSessionId(raw) : null;
}

function publicClaudeSourcePathRef(sourcePath: string): string {
  return `claude_source:${stableId(sourcePath).slice(0, 16)}`;
}

function safeClaudeProjectSlug(sourcePath: string): string | null {
  const slug = basename(dirname(sourcePath));
  if (!slug || slug === "." || slug === sep) return null;
  if (/^-?(?:Users|Volumes|home|root|private|tmp|var|[A-Za-z])-/.test(slug) || looksSensitiveRefLike(slug)) {
    return `claude_project_${stableId(slug).slice(0, 16)}`;
  }
  return publicSafeText(slug, 120) || null;
}

function incrementClaudeOmission(omissions: Map<ClaudeCodeParseOmissionReason, number>, reason: ClaudeCodeParseOmissionReason): void {
  omissions.set(reason, (omissions.get(reason) ?? 0) + 1);
}

function claudeCodeRangeReasonCodes(event: ParsedClaudeCodeEvent): string[] {
  return unique([
    `claude_${event.kind}`,
    event.toolUses > 0 ? "tool_use_metadata_only" : "",
    event.toolResults > 0 ? "tool_result_payload_omitted" : "",
    ...event.omissions.map((reason) => `omission_${reason}`)
  ].filter(Boolean));
}

function firstClaudeTitle(parts: string[]): string | null {
  const first = parts.find((part) => part.trim().length > 0);
  return first ? publicSafeText(first, 80) : null;
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

export function indexNativeCodexSubagentResults(
  db: LooDatabase,
  options: { results: NativeCodexSubagentResultFixture[]; now?: string }
): IndexNativeCodexSubagentResultsResult {
  const now = options.now ?? new Date().toISOString();
  const rejectedResults: NativeCodexSubagentResultRejected[] = [];
  let indexedResults = 0;

  for (const fixture of options.results) {
    const rawResultId = stringOrNull(fixture.resultId ?? fixture.id);
    if (!rawResultId) {
      rejectedResults.push({ resultId: null, reason: "missing_result_id" });
      continue;
    }
    const resultId = safeNativeCodexSubagentResultId(rawResultId);
    const sourceRef = nativeCodexSubagentResultRef(resultId);
    const threadId = `subagent_${resultId}`;
    const rawText = nativeCodexSubagentResultSyntheticJsonl(fixture, {
      resultId,
      threadId,
      sourceRef,
      now
    });
    const session = parseCodexJsonl(`native_codex_subagent_result:${resultId}`, rawText, 100);
    session.threadId = threadId;
    session.metadata.sourceRefs = unique([sourceRef, ...session.metadata.sourceRefs]);
    upsertSession(
      db,
      `native_codex_subagent_result:${resultId}`,
      rawText,
      session,
      { size: Buffer.byteLength(rawText), mtimeMs: Date.parse(now) || Date.now() },
      {
        sourceRef,
        rangeReasonCodes: ["native_codex_subagent_result", "derived_advisory_source"]
      }
    );
    indexedResults += 1;
  }

  return {
    publicSafe: false,
    readOnly: false,
    mutationClasses: ["derived_cache"],
    indexedResults,
    rejectedResults,
    actionsPerformed: {
      derivedCacheWrite: true,
      sourceStoreMutation: false,
      externalWrite: false,
      liveControl: false,
      guiMutation: false,
      rawTranscriptRead: false
    },
    proofBoundary: "Native Codex subagent result import writes only sanitized, advisory LCO derived-cache rows from explicit result metadata. It does not discover raw transcripts, read raw transcript paths, mutate Codex stores, run live control, mutate GUI state, write external systems, publish npm, or create GitHub releases."
  };
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`${name} requires a positive integer`);
  return limit;
}

function codexSessionRowid(db: LooDatabase, threadId: string): number | null {
  const row = db.prepare("SELECT rowid AS sessionRowid FROM codex_sessions WHERE thread_id = ?").get(threadId) as { sessionRowid: number } | undefined;
  if (!row) return null;
  return positiveSessionRowid(row.sessionRowid);
}

function requireCodexSessionRowid(db: LooDatabase, threadId: string): number {
  const sessionRowid = codexSessionRowid(db, threadId);
  if (sessionRowid === null) throw new Error(`Missing codex_sessions row for thread ${threadId}`);
  return sessionRowid;
}

function positiveSessionRowid(value: unknown): number {
  const sessionRowid = Number(value);
  if (!Number.isSafeInteger(sessionRowid) || sessionRowid < 1) {
    throw new Error("codex_sessions rowid must be a positive integer");
  }
  return sessionRowid;
}

function deleteCodexSafeTextFtsForSessionRowid(db: LooDatabase, sessionRowid: number): void {
  db.prepare("DELETE FROM codex_safe_text_fts WHERE rowid = ?").run(sessionRowid);
}

function insertCodexSafeTextFtsForSessionRowid(db: LooDatabase, sessionRowid: number, threadId: string, safeText: string): void {
  db.prepare("INSERT INTO codex_safe_text_fts (rowid, thread_id, content) VALUES (?, ?, ?)").run(sessionRowid, threadId, safeText);
}

function deleteCodexEventContentRows(db: LooDatabase, whereSql: string, ...params: Array<string | number>): void {
  db.prepare(`DELETE FROM codex_event_content WHERE ${whereSql}`).run(...params);
}

function deleteCodexEventContentForThreadId(db: LooDatabase, threadId: string): void {
  deleteCodexEventContentRows(db, "thread_id = ?", threadId);
}

function deleteCodexEventContentForEventId(db: LooDatabase, eventId: string): void {
  deleteCodexEventContentRows(db, "event_id = ?", eventId);
}

function deleteCodexEventContentForSourceOrThread(db: LooDatabase, sourcePathRef: string, threadId: string): void {
  deleteCodexEventContentRows(db, "source_path_ref = ? OR thread_id = ?", sourcePathRef, threadId);
}

type CodexEventContentInput = {
  eventId: string;
  eventRef: string;
  threadId: string;
  sourceRef: string;
  sourcePathRef: string;
  sourceHash: string;
  contentHash: string;
  eventKind: string;
  lineStart: number;
  lineEnd: number;
  byteStart: number;
  byteEnd: number;
  ordinal: number;
  observedAt: string | null;
  eventText: string;
  eventTextHash: string;
  storedChars: number;
  truncated: boolean;
  privacyClass: string;
  now: string;
};

function upsertCodexEventContent(db: LooDatabase, input: CodexEventContentInput): void {
  db.prepare(`
    INSERT INTO codex_event_content (
      event_id, event_ref, thread_id, source_ref, source_path_ref, source_hash, content_hash,
      event_kind, line_start, line_end, byte_start, byte_end, ordinal, observed_at,
      event_text, event_text_hash, stored_chars, truncated, source_status, privacy_class,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      event_ref = excluded.event_ref,
      thread_id = excluded.thread_id,
      source_ref = excluded.source_ref,
      source_path_ref = excluded.source_path_ref,
      source_hash = excluded.source_hash,
      content_hash = excluded.content_hash,
      event_kind = excluded.event_kind,
      line_start = excluded.line_start,
      line_end = excluded.line_end,
      byte_start = excluded.byte_start,
      byte_end = excluded.byte_end,
      ordinal = excluded.ordinal,
      observed_at = excluded.observed_at,
      event_text = excluded.event_text,
      event_text_hash = excluded.event_text_hash,
      stored_chars = excluded.stored_chars,
      truncated = excluded.truncated,
      source_status = excluded.source_status,
      privacy_class = excluded.privacy_class,
      updated_at = excluded.updated_at
  `).run(
    input.eventId,
    input.eventRef,
    input.threadId,
    input.sourceRef,
    input.sourcePathRef,
    input.sourceHash,
    input.contentHash,
    input.eventKind,
    input.lineStart,
    input.lineEnd,
    input.byteStart,
    input.byteEnd,
    input.ordinal,
    input.observedAt,
    input.eventText,
    input.eventTextHash,
    input.storedChars,
    input.truncated ? 1 : 0,
    "source_available",
    input.privacyClass,
    input.now,
    input.now
  );
}

function upsertCodexEventContentForDraft(db: LooDatabase, input: {
  event: PreparedSourceEventDraft;
  eventId: string;
  threadId: string;
  sourceRef: string;
  sourcePathRef: string;
  sourceHash: string;
  privacyClass: string;
  now: string;
}): void {
  upsertCodexEventContent(db, {
    eventId: input.eventId,
    eventRef: input.event.eventRef,
    threadId: input.threadId,
    sourceRef: input.sourceRef,
    sourcePathRef: input.sourcePathRef,
    sourceHash: input.sourceHash,
    contentHash: input.event.contentHash,
    eventKind: input.event.eventKind,
    lineStart: input.event.lineStart,
    lineEnd: input.event.lineEnd,
    byteStart: input.event.byteStart,
    byteEnd: input.event.byteEnd,
    ordinal: input.event.ordinal,
    observedAt: input.event.observedAt,
    eventText: input.event.eventText,
    eventTextHash: input.event.eventTextHash,
    storedChars: input.event.storedChars,
    truncated: input.event.truncated,
    privacyClass: input.privacyClass,
    now: input.now
  });
}

function rekeyCodexEventContent(db: LooDatabase, input: {
  oldEventId: string;
  newEventId: string;
  newEventRef: string;
  sourceHash: string;
  now: string;
}): void {
  const row = db.prepare(`
    SELECT
      thread_id AS threadId,
      source_ref AS sourceRef,
      source_path_ref AS sourcePathRef,
      content_hash AS contentHash,
      event_kind AS eventKind,
      line_start AS lineStart,
      line_end AS lineEnd,
      byte_start AS byteStart,
      byte_end AS byteEnd,
      ordinal,
      observed_at AS observedAt,
      event_text AS eventText,
      event_text_hash AS eventTextHash,
      stored_chars AS storedChars,
      truncated,
      privacy_class AS privacyClass
    FROM codex_event_content
    WHERE event_id = ?
  `).get(input.oldEventId) as Record<string, unknown> | undefined;
  if (!row) return;
  upsertCodexEventContent(db, {
    eventId: input.newEventId,
    eventRef: input.newEventRef,
    threadId: String(row.threadId),
    sourceRef: String(row.sourceRef),
    sourcePathRef: String(row.sourcePathRef),
    sourceHash: input.sourceHash,
    contentHash: String(row.contentHash),
    eventKind: String(row.eventKind),
    lineStart: Number(row.lineStart),
    lineEnd: Number(row.lineEnd),
    byteStart: Number(row.byteStart),
    byteEnd: Number(row.byteEnd),
    ordinal: Number(row.ordinal),
    observedAt: nullableString(row.observedAt),
    eventText: String(row.eventText ?? ""),
    eventTextHash: String(row.eventTextHash ?? stableId(String(row.eventText ?? ""))),
    storedChars: Number(row.storedChars ?? String(row.eventText ?? "").length),
    truncated: Number(row.truncated ?? 0) === 1,
    privacyClass: String(row.privacyClass ?? "public_safe_metadata"),
    now: input.now
  });
  deleteCodexEventContentForEventId(db, input.oldEventId);
}

function clearRemappedSourcePathSessions(db: LooDatabase, sourcePath: string, threadId: string): void {
  const rows = db.prepare("SELECT rowid AS sessionRowid, thread_id AS threadId FROM codex_sessions WHERE source_path = ? AND thread_id <> ?").all(sourcePath, threadId) as Array<{ sessionRowid: number; threadId: string }>;
  if (rows.length === 0) return;
  const threadIds = rows.map((row) => String(row.threadId)).filter(Boolean);
  deleteSummaryLeavesForThreadIds(db, threadIds);
  const deletePreparedRanges = db.prepare("DELETE FROM prepared_source_ranges WHERE thread_id = ?");
  const deletePreparedEvents = db.prepare("DELETE FROM prepared_source_events WHERE thread_id = ?");
  const deleteThreadTitleAliases = db.prepare("DELETE FROM codex_thread_title_aliases WHERE thread_id = ?");
  for (const row of rows) {
    const staleThreadId = String(row.threadId);
    const sessionRowid = positiveSessionRowid(row.sessionRowid);
    deleteCodexSafeTextFtsForSessionRowid(db, sessionRowid);
    deleteCodexSearchFtsForSessionRowid(db, sessionRowid);
    deleteCodexEventContentForThreadId(db, staleThreadId);
    deletePreparedRanges.run(staleThreadId);
    deletePreparedEvents.run(staleThreadId);
    deleteThreadTitleAliases.run(staleThreadId);
  }
  db.prepare("DELETE FROM codex_sessions WHERE source_path = ? AND thread_id <> ?").run(sourcePath, threadId);
}

type CodexFtsRowidPinningRepairOptions = {
  forceSearchRepair?: boolean;
  recordSearchMigration?: boolean;
};

function repairCodexFtsRowidPinning(db: LooDatabase, options: CodexFtsRowidPinningRepairOptions = {}): void {
  const repairSafeText = codexFtsRowidPinningNeedsRepair(db, "codex_safe_text_fts");
  const repairSearch = options.forceSearchRepair === true || codexFtsRowidPinningNeedsRepair(db, "codex_search_fts");
  if (!repairSafeText && !repairSearch && options.recordSearchMigration !== true) return;
  db.exec("BEGIN");
  try {
    if (repairSafeText) rebuildCodexSafeTextFts(db);
    if (repairSearch) rebuildCodexSearchFts(db);
    if (options.recordSearchMigration === true) {
      db.prepare("INSERT OR IGNORE INTO loo_schema_migrations (migration_id, applied_at, description) VALUES (?, datetime('now'), ?)").run(
        CODEX_SEARCH_FTS_MIGRATION_ID,
        "Additive field-weighted Codex search FTS table with relational backfill"
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function codexFtsRowidPinningNeedsRepair(db: LooDatabase, table: "codex_safe_text_fts" | "codex_search_fts"): boolean {
  const sessionCount = Number((db.prepare("SELECT COUNT(*) AS count FROM codex_sessions").get() as { count: number }).count);
  const ftsCount = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
  if (ftsCount !== sessionCount) return true;
  const pinnedCount = Number((db.prepare(`
    SELECT COUNT(*) AS count
    FROM codex_sessions s
    JOIN ${table} f ON f.rowid = s.rowid AND f.thread_id = s.thread_id
  `).get() as { count: number }).count);
  return pinnedCount !== sessionCount;
}

function rebuildCodexSafeTextFts(db: LooDatabase): void {
  db.prepare("DELETE FROM codex_safe_text_fts").run();
  db.prepare(`
    INSERT INTO codex_safe_text_fts (rowid, thread_id, content)
    SELECT rowid, thread_id, COALESCE(safe_text, '')
    FROM codex_sessions
  `).run();
}

function recordLimitedFile(db: LooDatabase, result: IndexCodexResult, path: string, reason: LimitedCodexFile["reason"], limit: number, actual: number): void {
  clearSourceFileIndex(db, path);
  const limitedFile = { path, reason, limit, actual };
  recordLimitedSourceFile(db, limitedFile);
  result.skippedFiles += 1;
  result.limitedFiles.push(limitedFile);
}

function recordLimitedSourceFile(db: LooDatabase, file: LimitedCodexFile): void {
  if (file.reason === "max_files_dropped_oldest") return;
  db.prepare(`
    INSERT INTO codex_index_limited_files (
      source_path,
      path_hash,
      reason,
      limit_value,
      actual_value,
      observed_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_path) DO UPDATE SET
      path_hash = excluded.path_hash,
      reason = excluded.reason,
      limit_value = excluded.limit_value,
      actual_value = excluded.actual_value,
      observed_at = excluded.observed_at
  `).run(file.path, stableId(file.path), file.reason, file.limit, file.actual, new Date().toISOString());
}

function createCodexIndexLimitWarnings(limitedFiles: LimitedCodexFile[]): CodexIndexLimitWarning[] {
  if (limitedFiles.length === 0) return [];
  return [{
    code: "codex_index_limited_files_skipped",
    message: "Some Codex JSONL session files were skipped by index caps. Re-run with intentional local-only overrides to include smaller capped files; very large files may require the future streaming importer.",
    limitedFiles: limitedFiles.length,
    skippedFiles: countCodexIndexLimitSkippedFiles(limitedFiles),
    reasons: summarizeCodexIndexLimitReasons(limitedFiles),
    nextSafeCommands: codexIndexLimitNextSafeCommands(true),
    proofBoundary: "Warning output contains counts, limits, and recovery commands only. It does not expose raw transcript text, raw source paths, screenshots, tokens, cookies, or mutate Codex source stores."
  }];
}

function countCodexIndexLimitSkippedFiles(files: LimitedCodexFile[]): number {
  return files.reduce((total, file) => total + (file.reason === "max_files_dropped_oldest" ? Math.max(0, file.actual - file.limit) : 1), 0);
}

function summarizeCodexIndexLimitReasons(files: LimitedCodexFile[]): CodexIndexLimitReasonSummary[] {
  const summaries = new Map<LimitedCodexFile["reason"], CodexIndexLimitReasonSummary>();
  for (const file of files) {
    const current = summaries.get(file.reason);
    if (current) {
      current.count += 1;
      current.limit = Math.max(current.limit, file.limit);
      current.maxActual = Math.max(current.maxActual, file.actual);
    } else {
      summaries.set(file.reason, {
        reason: file.reason,
        count: 1,
        limit: file.limit,
        maxActual: file.actual
      });
    }
  }
  return [...summaries.values()].sort((left, right) => left.reason.localeCompare(right.reason));
}

function codexIndexLimitNextSafeCommands(hasLimitedFileEvidence: boolean): string[] {
  return hasLimitedFileEvidence ? [CODEX_INDEX_LIMIT_RECOVERY_COMMAND] : [];
}

function clearSourceFileIndex(db: LooDatabase, sourcePath: string): void {
  db.exec("BEGIN");
  try {
    clearSourceFileIndexInsideTransaction(db, sourcePath);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function clearSourceFileIndexInsideTransaction(db: LooDatabase, sourcePath: string): void {
  const trackedSource = db.prepare("SELECT 1 FROM codex_source_files WHERE source_path = ?").get(sourcePath) !== undefined;
  if (trackedSource) bumpCodexSourceDestructiveGeneration(db);
  const rows = db.prepare("SELECT rowid AS sessionRowid, thread_id AS threadId FROM codex_sessions WHERE source_path = ?").all(sourcePath) as Array<{ sessionRowid: number; threadId: string }>;
  const threadIds = rows.map((row) => String(row.threadId)).filter(Boolean);
  deleteSummaryLeavesForThreadIds(db, threadIds);
  const deletePreparedRanges = db.prepare("DELETE FROM prepared_source_ranges WHERE thread_id = ?");
  const deletePreparedEvents = db.prepare("DELETE FROM prepared_source_events WHERE thread_id = ?");
  const deleteThreadTitleAliases = db.prepare("DELETE FROM codex_thread_title_aliases WHERE thread_id = ?");
  for (const row of rows) {
    const threadId = String(row.threadId);
    const sessionRowid = positiveSessionRowid(row.sessionRowid);
    deleteCodexSafeTextFtsForSessionRowid(db, sessionRowid);
    deleteCodexSearchFtsForSessionRowid(db, sessionRowid);
    deleteCodexEventContentForThreadId(db, threadId);
    deletePreparedRanges.run(threadId);
    deletePreparedEvents.run(threadId);
    deleteThreadTitleAliases.run(threadId);
  }
  db.prepare("DELETE FROM codex_sessions WHERE source_path = ?").run(sourcePath);
  db.prepare("DELETE FROM codex_source_files WHERE source_path = ?").run(sourcePath);
  db.prepare("DELETE FROM codex_index_limited_files WHERE source_path = ?").run(sourcePath);
}

function bumpCodexSourceDestructiveGeneration(db: LooDatabase): void {
  db.prepare(`
    UPDATE codex_source_integrity_state
    SET destructive_generation = destructive_generation + 1
    WHERE singleton_id = 1
  `).run();
}

function pruneMissingCodexSourceFiles(db: LooDatabase, roots: string[], candidateFiles: string[]): void {
  const existingRoots = unique(roots.map(canonicalExistingPath).filter((root): root is string => root !== null));
  if (existingRoots.length === 0) return;
  const currentResolvedPaths = new Set(candidateFiles.map((path) => resolve(path)));
  const currentCanonicalPaths = new Set(candidateFiles.map(canonicalExistingPath).filter((path): path is string => path !== null));
  const rows = [
    ...(db.prepare("SELECT source_path AS sourcePath FROM codex_source_files").all() as Array<{ sourcePath: string }>),
    ...(db.prepare("SELECT source_path AS sourcePath FROM codex_index_limited_files").all() as Array<{ sourcePath: string }>)
  ];
  const missingSourcePaths: string[] = [];
  for (const row of unique(rows.map((item) => String(item.sourcePath ?? ""))).map((sourcePath) => ({ sourcePath }))) {
    const sourcePath = String(row.sourcePath ?? "");
    if (!sourcePath.endsWith(".jsonl")) continue;
    if (currentResolvedPaths.has(resolve(sourcePath))) continue;
    const canonicalSourcePath = canonicalMaybeMissingPath(sourcePath);
    if (currentCanonicalPaths.has(canonicalSourcePath)) continue;
    if (existsSync(sourcePath)) continue;
    if (!existingRoots.some((root) => canonicalPathIsWithinRoot(canonicalSourcePath, root))) continue;
    missingSourcePaths.push(sourcePath);
  }
  if (missingSourcePaths.length === 0) return;
  db.exec("BEGIN");
  try {
    for (const sourcePath of missingSourcePaths) {
      clearSourceFileIndexInsideTransaction(db, sourcePath);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function canonicalPathIsWithinRoot(canonicalPath: string, root: string): boolean {
  const relativePath = relative(root, canonicalPath);
  return relativePath === "" || (relativePath.length > 0 && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

function canonicalExistingPath(path: string): string | null {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

function canonicalMaybeMissingPath(path: string): string {
  const resolvedPath = resolve(path);
  const existingPath = canonicalExistingPath(resolvedPath);
  if (existingPath) return existingPath;
  const segments: string[] = [];
  let cursor = resolvedPath;
  while (cursor && dirname(cursor) !== cursor) {
    segments.unshift(basename(cursor));
    cursor = dirname(cursor);
    const existingParent = canonicalExistingPath(cursor);
    if (existingParent) return resolve(existingParent, ...segments);
  }
  return resolvedPath;
}

export function getSourceFileWatermark(db: LooDatabase, sourcePath: string): SourceFileWatermark | null {
  const row = db.prepare(`
    SELECT
      source_path AS sourcePath,
      path_hash AS pathHash,
      size,
      mtime_ms AS mtimeMs,
      last_indexed_at AS lastIndexedAt,
      metadata_extractor_version AS metadataExtractorVersion,
      prepared_range_extractor_version AS preparedRangeExtractorVersion,
      summary_leaf_extractor_version AS summaryLeafExtractorVersion,
      prepared_card_extractor_version AS preparedCardExtractorVersion
    FROM codex_source_files
    WHERE source_path = ?
  `).get(sourcePath) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    sourcePath: String(row.sourcePath),
    pathHash: String(row.pathHash),
    size: Number(row.size ?? 0),
    mtimeMs: Number(row.mtimeMs ?? 0),
    lastIndexedAt: String(row.lastIndexedAt),
    metadataExtractorVersion: nullableString(row.metadataExtractorVersion),
    preparedRangeExtractorVersion: nullableString(row.preparedRangeExtractorVersion),
    summaryLeafExtractorVersion: nullableString(row.summaryLeafExtractorVersion),
    preparedCardExtractorVersion: nullableString(row.preparedCardExtractorVersion)
  };
}

function sourceTextExtendsWatermark(text: string, watermark: SourceFileWatermark): boolean {
  const bytes = Buffer.from(text, "utf8");
  if (watermark.size <= 0 || bytes.length <= watermark.size) return false;
  return stableId(bytes.subarray(0, watermark.size).toString("utf8")) === watermark.pathHash;
}

function sourceFileExtractorStateIsCurrent(watermark: SourceFileWatermark): boolean {
  return watermark.metadataExtractorVersion === SESSION_METADATA_EXTRACTOR_VERSION
    && watermark.preparedRangeExtractorVersion === PREPARED_SOURCE_EXTRACTOR_VERSION
    && watermark.summaryLeafExtractorVersion === SUMMARY_LEAF_EXTRACTOR_VERSION
    && watermark.preparedCardExtractorVersion === PREPARED_CARD_EXTRACTOR_VERSION;
}

function sourceFileEventContentCurrent(db: LooDatabase, sourcePath: string): boolean {
  if (!tableExists(db, "codex_event_content")) return false;
  const sourcePathRef = publicSourcePathRef(sourcePath);
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM codex_sessions WHERE source_path = ?) AS currentSessions,
      (SELECT COUNT(*) FROM prepared_source_events WHERE source_path_ref = ?) AS preparedEvents,
      (SELECT COUNT(*) FROM codex_event_content WHERE source_path_ref = ?) AS contentEvents,
      (
        SELECT COUNT(*)
        FROM prepared_source_events p
        JOIN codex_event_content c ON c.event_id = p.event_id
        WHERE p.source_path_ref = ?
          AND c.source_hash = p.source_hash
          AND c.content_hash = p.content_hash
      ) AS matchingContentEvents
  `).get(sourcePath, sourcePathRef, sourcePathRef, sourcePathRef) as { currentSessions: number; preparedEvents: number; contentEvents: number; matchingContentEvents: number } | undefined;
  const currentSessions = Number(row?.currentSessions ?? 0);
  const preparedEvents = Number(row?.preparedEvents ?? 0);
  const contentEvents = Number(row?.contentEvents ?? 0);
  const matchingContentEvents = Number(row?.matchingContentEvents ?? 0);
  if (currentSessions === 0 && preparedEvents === 0 && contentEvents === 0) return true;
  return preparedEvents > 0 && contentEvents === preparedEvents && matchingContentEvents === preparedEvents;
}

function sourceFileHasRecordedJsonlDrift(db: LooDatabase, sourcePath: string): boolean {
  const row = db.prepare(`
    SELECT
      jsonl_drift_unknown_event_kinds_json AS unknownEventKindsJson,
      jsonl_drift_unparsed_lines AS unparsedLines,
      jsonl_drift_missing_expected_fields_json AS missingExpectedFieldsJson,
      jsonl_drift_reason_codes_json AS reasonCodesJson
    FROM codex_source_files
    WHERE source_path = ?
  `).get(sourcePath) as Record<string, unknown> | undefined;
  if (!row) return false;
  return Number(row.unparsedLines ?? 0) > 0
    || parseCodexJsonlDriftNamedCounts(row.unknownEventKindsJson).length > 0
    || parseCodexJsonlDriftFieldCounts(row.missingExpectedFieldsJson).length > 0
    || parseCodexJsonlDriftReasonCodes(row.reasonCodesJson).length > 0;
}

type AppendDeltaCandidate = {
  appendText: string;
  fullHash: string;
  prefixHash: string;
  prefixLastByte: number | null;
  prefixLineCount: number;
};

type ExistingCodexSessionSeed = ImportedSession & {
  storedToolCallCount: number;
};

const APPEND_DELTA_READ_CHUNK_BYTES = 64 * 1024;
const CODEX_SAFE_TEXT_CHAR_LIMIT = 250_000;

function tryIndexCodexAppendDelta(
  db: LooDatabase,
  sourcePath: string,
  stat: { size: number; mtimeMs: number },
  watermark: SourceFileWatermark,
  maxEventsPerFile: number,
  eventContentEnabled: boolean
): ImportedSession | null {
  if (watermark.size <= 0 || stat.size <= watermark.size) return null;
  if (sourceFileHasRecordedJsonlDrift(db, sourcePath)) return null;
  const seed = existingCodexSessionSeedForSourcePath(db, sourcePath);
  if (!seed) return null;
  if (seed.safeText.length >= CODEX_SAFE_TEXT_CHAR_LIMIT) return null;
  const candidate = readAppendDeltaCandidate(sourcePath, watermark.size, stat.size);
  if (!candidate || candidate.prefixHash !== watermark.pathHash || candidate.prefixLastByte !== 10) return null;
  const appendEventCount = countJsonlEvents(candidate.appendText);
  if (appendEventCount <= 0 || seed.eventCount + appendEventCount > maxEventsPerFile) return null;
  const preparedSourceStats = preparedSourceStatsForAppend(db, seed.threadId);
  if (
    preparedSourceStats.eventCount !== seed.eventCount
    || preparedSourceStats.ordinalOffset !== seed.eventCount
  ) return null;
  const ordinalOffset = preparedSourceStats.ordinalOffset;
  const delta = parseCodexJsonl(sourcePath, candidate.appendText, maxEventsPerFile, {
    threadId: seed.threadId,
    sourceHash: candidate.fullHash,
    lineNumberOffset: candidate.prefixLineCount,
    byteOffset: watermark.size,
    ordinalOffset
  });
  if (delta.threadId !== seed.threadId || delta.eventCount !== appendEventCount) return null;
  const merged = mergeAppendDeltaSession(seed, delta);
  appendSessionDelta(db, sourcePath, candidate.fullHash, merged, seed, delta, stat, eventContentEnabled);
  return delta;
}

function readAppendDeltaCandidate(sourcePath: string, prefixSize: number, totalSize: number): AppendDeltaCandidate | null {
  const appendSize = totalSize - prefixSize;
  if (!Number.isSafeInteger(prefixSize) || !Number.isSafeInteger(appendSize) || prefixSize <= 0 || appendSize <= 0) return null;
  const fd = openSync(sourcePath, "r");
  try {
    const prefixHash = createHash("sha256");
    const fullHash = createHash("sha256");
    // These raw-byte hashes match the existing string-derived stableId() watermark for valid UTF-8
    // Codex JSONL; invalid UTF-8 safely misses the prefix hash and falls back to full reparse.
    const buffer = Buffer.alloc(Math.min(APPEND_DELTA_READ_CHUNK_BYTES, Math.max(prefixSize, 1)));
    let position = 0;
    let remaining = prefixSize;
    let prefixLastByte: number | null = null;
    let prefixLineCount = 0;
    while (remaining > 0) {
      const bytesToRead = Math.min(buffer.length, remaining);
      const bytesRead = readSync(fd, buffer, 0, bytesToRead, position);
      if (bytesRead <= 0) return null;
      const chunk = buffer.subarray(0, bytesRead);
      prefixHash.update(chunk);
      fullHash.update(chunk);
      prefixLastByte = chunk[bytesRead - 1] ?? prefixLastByte;
      for (const byte of chunk) {
        if (byte === 10) prefixLineCount += 1;
      }
      position += bytesRead;
      remaining -= bytesRead;
    }

    const appendBuffer = Buffer.alloc(appendSize);
    let appendOffset = 0;
    while (appendOffset < appendSize) {
      const bytesRead = readSync(fd, appendBuffer, appendOffset, appendSize - appendOffset, prefixSize + appendOffset);
      if (bytesRead <= 0) return null;
      appendOffset += bytesRead;
    }
    fullHash.update(appendBuffer);
    return {
      appendText: appendBuffer.toString("utf8"),
      fullHash: fullHash.digest("hex").slice(0, 32),
      prefixHash: prefixHash.digest("hex").slice(0, 32),
      prefixLastByte,
      prefixLineCount
    };
  } finally {
    closeSync(fd);
  }
}

function existingCodexSessionSeedForSourcePath(db: LooDatabase, sourcePath: string): ExistingCodexSessionSeed | null {
  const rows = db.prepare(`
    SELECT
      thread_id AS threadId,
      title,
      cwd,
      model,
      branch,
      git_sha AS gitSha,
      created_at AS createdAt,
      updated_at AS updatedAt,
      final_message AS finalMessage,
      safe_text AS safeText,
      event_count AS eventCount,
      tool_call_count AS toolCallCount
    FROM codex_sessions
    WHERE source_path = ?
  `).all(sourcePath) as Array<Record<string, unknown>>;
  if (rows.length !== 1) return null;
  const row = rows[0]!;
  const threadId = String(row.threadId);
  const plans = (db.prepare("SELECT text FROM codex_plans WHERE thread_id = ? ORDER BY ordinal ASC, rowid ASC").all(threadId) as Array<{ text: string }>).map((plan) => String(plan.text));
  const toolCalls = (db.prepare(`
    SELECT call_id AS callId, tool_name AS toolName, arguments_text AS argumentsText, reason_code AS reasonCode
    FROM codex_tool_calls
    WHERE thread_id = ?
    ORDER BY rowid ASC
  `).all(threadId) as Array<Record<string, unknown>>).map((call) => ({
    callId: String(call.callId),
    toolName: String(call.toolName ?? "unknown"),
    argumentsText: String(call.argumentsText ?? ""),
    rawArgumentsText: String(call.argumentsText ?? ""),
    reasonCode: call.reasonCode === null || call.reasonCode === undefined ? null : call.reasonCode as CodexToolCallDraft["reasonCode"]
  }));
  const closeout = db.prepare(`
    SELECT
      closeout_envelope_text AS closeoutEnvelopeText,
      closeout_envelope_open_count AS closeoutEnvelopeOpenCount,
      closeout_envelope_close_count AS closeoutEnvelopeCloseCount
    FROM codex_session_metadata
    WHERE thread_id = ?
  `).get(threadId) as Record<string, unknown> | undefined;
  return {
    threadId,
    title: nullableString(row.title),
    titleExplicit: existingCodexSessionHasRangeKind(db, threadId, "thread_title"),
    cwd: nullableString(row.cwd),
    model: nullableString(row.model),
    branch: nullableString(row.branch),
    gitSha: nullableString(row.gitSha),
    createdAt: nullableString(row.createdAt),
    updatedAt: nullableString(row.updatedAt),
    finalMessage: nullableString(row.finalMessage),
    finalMessageExplicit: existingCodexSessionHasRangeKind(db, threadId, "final_message"),
    plans,
    touchedFiles: getCodexTouchedFiles(db, { threadId }),
    toolCalls,
    storedToolCallCount: Number(row.toolCallCount ?? toolCalls.length),
    metadata: getSessionMetadata(db, threadId),
    metadataPresentTextFields: new Set(),
    metadataPresentRefFields: new Set(),
    closeoutEnvelopeText: nullableString(closeout?.closeoutEnvelopeText),
    closeoutEnvelopeOpenCount: Number(closeout?.closeoutEnvelopeOpenCount ?? 0),
    closeoutEnvelopeCloseCount: Number(closeout?.closeoutEnvelopeCloseCount ?? 0),
    safeText: String(row.safeText ?? ""),
    eventCount: Number(row.eventCount ?? 0),
    sourceEvents: [],
    driftReport: null
  };
}

function existingCodexSessionHasRangeKind(db: LooDatabase, threadId: string, rangeKind: PreparedSourceRangeKind): boolean {
  const row = db.prepare(`
    SELECT 1 AS found
    FROM prepared_source_ranges
    WHERE thread_id = ? AND range_kind = ?
    LIMIT 1
  `).get(threadId, rangeKind) as { found: number } | undefined;
  return Boolean(row);
}

function preparedSourceStatsForAppend(db: LooDatabase, threadId: string): { eventCount: number; ordinalOffset: number } {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS eventCount,
      COALESCE(MAX(ordinal), -1) + 1 AS ordinalOffset
    FROM prepared_source_events
    WHERE thread_id = ?
  `).get(threadId) as { eventCount: number; ordinalOffset: number } | undefined;
  return {
    eventCount: Number(row?.eventCount ?? 0),
    ordinalOffset: Number(row?.ordinalOffset ?? 0)
  };
}

function rekeyPreparedSourceRefsForAppend(db: LooDatabase, threadId: string, sourcePathRef: string, sourceHash: string): void {
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT
      event_id AS eventId,
      event_ref AS eventRef,
      event_kind AS eventKind,
      line_start AS lineStart,
      ordinal,
      content_hash AS contentHash
    FROM prepared_source_events
    WHERE thread_id = ? AND source_path_ref = ?
    ORDER BY ordinal ASC, event_ref ASC
  `).all(threadId, sourcePathRef) as Array<{ eventId: string; eventRef: string; eventKind: string; lineStart: number; ordinal: number; contentHash: string }>;
  for (const row of rows) {
    const oldEventId = String(row.eventId);
    const oldEventRef = String(row.eventRef);
    const eventKind = String(row.eventKind);
    const lineStart = Number(row.lineStart);
    const ordinal = Number(row.ordinal);
    const contentHash = String(row.contentHash);
    const newEventId = stableId(`${sourcePathRef}:${sourceHash}:${ordinal}:${lineStart}:${eventKind}:${contentHash}`);
    const newEventRef = `codex_event:${newEventId}`;
    db.prepare(`
      INSERT INTO prepared_source_events (
        event_id, event_ref, thread_id, source_ref, source_path_ref, source_hash, content_hash,
        event_kind, line_start, line_end, byte_start, byte_end, ordinal, observed_at,
        extractor_version, privacy_class, omission_status, confidence, metadata_json, created_at
      )
      SELECT
        ?, ?, thread_id, source_ref, source_path_ref, ?, content_hash,
        event_kind, line_start, line_end, byte_start, byte_end, ordinal, observed_at,
        extractor_version, privacy_class, omission_status, confidence, metadata_json, created_at
      FROM prepared_source_events
      WHERE event_id = ?
    `).run(newEventId, newEventRef, sourceHash, oldEventId);
    rekeyCodexEventContent(db, {
      oldEventId,
      newEventId,
      newEventRef,
      sourceHash,
      now
    });
    const rangeRows = db.prepare(`
      SELECT range_id AS rangeId, range_ref AS rangeRef, range_kind AS rangeKind
      FROM prepared_source_ranges
      WHERE event_ref = ?
      ORDER BY ordinal ASC, range_ref ASC
    `).all(oldEventRef) as Array<{ rangeId: string; rangeRef: string; rangeKind: string }>;
    for (const range of rangeRows) {
      const rangeKind = String(range.rangeKind);
      const newRangeId = stableId(`${newEventRef}:${rangeKind}`);
      const newRangeRef = `codex_range:${newRangeId}`;
      db.prepare(`
        INSERT INTO prepared_source_ranges (
          range_id, range_ref, event_id, event_ref, thread_id, source_ref, source_path_ref, source_hash,
          content_hash, session_diff_key, range_kind, line_start, line_end, byte_start, byte_end, ordinal, observed_at,
          extractor_version, privacy_class, omission_status, confidence, reason_codes_json, metadata_json, created_at
        )
        SELECT
          ?, ?, ?, ?, thread_id, source_ref, source_path_ref, ?,
          content_hash, session_diff_key, range_kind, line_start, line_end, byte_start, byte_end, ordinal, observed_at,
          extractor_version, privacy_class, omission_status, confidence, reason_codes_json, metadata_json, created_at
        FROM prepared_source_ranges
        WHERE range_id = ?
      `).run(newRangeId, newRangeRef, newEventId, newEventRef, sourceHash, String(range.rangeId));
    }
    db.prepare("DELETE FROM prepared_source_ranges WHERE event_ref = ?").run(oldEventRef);
    db.prepare("DELETE FROM prepared_source_events WHERE event_id = ?").run(oldEventId);
  }
}

function mergeAppendDeltaSession(seed: ExistingCodexSessionSeed, delta: ImportedSession): ImportedSession {
  const finalMessage = mergeAppendDeltaFinalMessage(seed, delta);
  return {
    threadId: seed.threadId,
    title: mergeAppendDeltaTitle(seed, delta, finalMessage),
    titleExplicit: seed.titleExplicit || delta.titleExplicit,
    cwd: delta.cwd ?? seed.cwd,
    model: delta.model ?? seed.model,
    branch: delta.branch ?? seed.branch,
    gitSha: delta.gitSha ?? seed.gitSha,
    createdAt: seed.createdAt ?? delta.createdAt,
    updatedAt: delta.updatedAt ?? seed.updatedAt,
    finalMessage,
    finalMessageExplicit: seed.finalMessageExplicit || delta.finalMessageExplicit,
    plans: [...seed.plans, ...delta.plans],
    touchedFiles: unique([...seed.touchedFiles, ...delta.touchedFiles]).sort(),
    toolCalls: [...seed.toolCalls, ...delta.toolCalls],
    metadata: mergeSessionMetadataSnapshot(seed.metadata, delta.metadata, delta.metadataPresentTextFields, delta.metadataPresentRefFields),
    metadataPresentTextFields: new Set([...seed.metadataPresentTextFields, ...delta.metadataPresentTextFields]),
    metadataPresentRefFields: new Set([...seed.metadataPresentRefFields, ...delta.metadataPresentRefFields]),
    closeoutEnvelopeText: delta.closeoutEnvelopeText ?? seed.closeoutEnvelopeText,
    closeoutEnvelopeOpenCount: seed.closeoutEnvelopeOpenCount + delta.closeoutEnvelopeOpenCount,
    closeoutEnvelopeCloseCount: seed.closeoutEnvelopeCloseCount + delta.closeoutEnvelopeCloseCount,
    safeText: [seed.safeText, delta.safeText].filter(Boolean).join("\n").slice(0, CODEX_SAFE_TEXT_CHAR_LIMIT),
    eventCount: seed.eventCount + delta.eventCount,
    sourceEvents: delta.sourceEvents,
    driftReport: delta.driftReport
  };
}

function mergeAppendDeltaFinalMessage(seed: ExistingCodexSessionSeed, delta: ImportedSession): string | null {
  if (delta.finalMessageExplicit) return delta.finalMessage;
  if (seed.finalMessageExplicit) return seed.finalMessage;
  return delta.finalMessage ?? seed.finalMessage;
}

function mergeAppendDeltaTitle(seed: ExistingCodexSessionSeed, delta: ImportedSession, finalMessage: string | null): string | null {
  if (delta.titleExplicit) return delta.title;
  if (seed.titleExplicit) return seed.title;
  return finalMessage ? truncate(finalMessage, 80) : seed.title ?? delta.title;
}

function mergeSessionMetadataSnapshot(
  base: SessionMetadata,
  delta: SessionMetadata,
  presentTextFields: Set<SessionMetadataTextField>,
  presentRefFields: Set<SessionMetadataRefField>
): SessionMetadata {
  return {
    project: presentTextFields.has("project") ? delta.project : base.project,
    status: presentTextFields.has("status") ? delta.status : base.status,
    priority: presentTextFields.has("priority") ? delta.priority : base.priority,
    owner: presentTextFields.has("owner") ? delta.owner : base.owner,
    blocker: presentTextFields.has("blocker") ? delta.blocker : base.blocker,
    nextAction: presentTextFields.has("nextAction") ? delta.nextAction : base.nextAction,
    closeoutState: presentTextFields.has("closeoutState") ? delta.closeoutState : base.closeoutState,
    planCompletionState: presentTextFields.has("planCompletionState") ? delta.planCompletionState : base.planCompletionState,
    proposedPlanRefs: presentRefFields.has("proposedPlanRefs") ? delta.proposedPlanRefs : base.proposedPlanRefs,
    finalMessageRefs: presentRefFields.has("finalMessageRefs") ? delta.finalMessageRefs : base.finalMessageRefs,
    touchedFileRefs: presentRefFields.has("touchedFileRefs") ? delta.touchedFileRefs : base.touchedFileRefs,
    sourceRefs: presentRefFields.has("sourceRefs") ? delta.sourceRefs : base.sourceRefs
  };
}

function appendSessionDelta(
  db: LooDatabase,
  sourcePath: string,
  sourceHash: string,
  merged: ImportedSession,
  seed: ExistingCodexSessionSeed,
  delta: ImportedSession,
  stat: { size: number; mtimeMs: number },
  eventContentEnabled: boolean
): void {
  const sourcePathRef = publicSourcePathRef(sourcePath);
  db.exec("BEGIN IMMEDIATE");
  try {
    const now = allocateSessionDiffMutationTimestamp(db);
    const sessionRowid = requireCodexSessionRowid(db, seed.threadId);
    db.prepare(`
      UPDATE codex_source_files
      SET
        content_epoch = COALESCE(content_epoch, path_hash),
        append_generation = append_generation + 1,
        path_hash = ?,
        size = ?,
        mtime_ms = ?,
        last_indexed_at = ?,
        metadata_extractor_version = ?,
        prepared_range_extractor_version = ?,
        summary_leaf_extractor_version = NULL,
        prepared_card_extractor_version = NULL,
        jsonl_drift_unknown_event_kinds_json = ?,
        jsonl_drift_unparsed_lines = ?,
        jsonl_drift_missing_expected_fields_json = ?,
        jsonl_drift_reason_codes_json = ?
      WHERE source_path = ?
    `).run(
      sourceHash,
      stat.size,
      Math.trunc(stat.mtimeMs),
      now,
      SESSION_METADATA_EXTRACTOR_VERSION,
      PREPARED_SOURCE_EXTRACTOR_VERSION,
      JSON.stringify(delta.driftReport?.unknownEventKinds ?? []),
      delta.driftReport?.unparsedLines ?? 0,
      JSON.stringify(delta.driftReport?.missingExpectedFields ?? []),
      JSON.stringify(delta.driftReport?.reasonCodes ?? []),
      sourcePath
    );
    db.prepare(`
      UPDATE codex_sessions
      SET
        title = ?,
        cwd = ?,
        model = ?,
        branch = ?,
        git_sha = ?,
        updated_at = ?,
        summary = ?,
        final_message = ?,
        safe_text = ?,
        event_count = ?,
        tool_call_count = ?,
        indexed_at = ?
      WHERE thread_id = ?
    `).run(
      merged.title,
      merged.cwd,
      merged.model,
      merged.branch,
      merged.gitSha,
      merged.updatedAt,
      buildSummary(merged),
      merged.finalMessage,
      merged.safeText,
      merged.eventCount,
      seed.storedToolCallCount + delta.toolCalls.length,
      now,
      seed.threadId
    );
    rekeyPreparedSourceRefsForAppend(db, seed.threadId, sourcePathRef, sourceHash);
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
      seed.threadId,
      merged.metadata.project,
      merged.metadata.status,
      merged.metadata.priority,
      merged.metadata.owner,
      merged.metadata.blocker,
      merged.metadata.nextAction,
      merged.metadata.closeoutState,
      merged.metadata.planCompletionState,
      JSON.stringify(merged.metadata.proposedPlanRefs),
      JSON.stringify(merged.metadata.finalMessageRefs),
      JSON.stringify(merged.metadata.touchedFileRefs),
      merged.closeoutEnvelopeText,
      merged.closeoutEnvelopeOpenCount,
      merged.closeoutEnvelopeCloseCount,
      JSON.stringify(merged.metadata.sourceRefs),
      SESSION_METADATA_SCHEMA_VERSION
    );

    const planOffset = seed.plans.length;
    delta.plans.forEach((plan, index) => {
      const ordinal = planOffset + index;
      db.prepare("INSERT OR REPLACE INTO codex_plans (plan_id, thread_id, text, ordinal) VALUES (?, ?, ?, ?)").run(stableId(`${seed.threadId}:plan:${ordinal}:${plan}`), seed.threadId, plan, ordinal);
    });
    delta.touchedFiles.forEach((file) => {
      db.prepare("INSERT OR IGNORE INTO codex_touched_files (touched_file_id, thread_id, path, source_kind) VALUES (?, ?, ?, ?)").run(stableId(`${seed.threadId}:file:${file}`), seed.threadId, file, "codex_text");
    });
    delta.toolCalls.forEach((call) => {
      db.prepare("INSERT OR REPLACE INTO codex_tool_calls (call_id, thread_id, tool_name, arguments_text, reason_code) VALUES (?, ?, ?, ?, ?)").run(call.callId, seed.threadId, call.toolName, call.argumentsText, call.reasonCode);
    });
    const insertPreparedEvent = db.prepare(`
      INSERT OR REPLACE INTO prepared_source_events (
        event_id, event_ref, thread_id, source_ref, source_path_ref, source_hash, content_hash,
        event_kind, line_start, line_end, byte_start, byte_end, ordinal, observed_at,
        extractor_version, privacy_class, omission_status, confidence, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPreparedRange = db.prepare(`
      INSERT OR REPLACE INTO prepared_source_ranges (
        range_id, range_ref, event_id, event_ref, thread_id, source_ref, source_path_ref, source_hash,
        content_hash, session_diff_key, range_kind, line_start, line_end, byte_start, byte_end, ordinal, observed_at,
        extractor_version, privacy_class, omission_status, confidence, reason_codes_json, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const event of delta.sourceEvents) {
      const eventId = event.eventRef.slice("codex_event:".length);
      insertPreparedEvent.run(
        eventId,
        event.eventRef,
        seed.threadId,
        codexThreadRef(seed.threadId),
        sourcePathRef,
        sourceHash,
        event.contentHash,
        event.eventKind,
        event.lineStart,
        event.lineEnd,
        event.byteStart,
        event.byteEnd,
        event.ordinal,
        event.observedAt,
        PREPARED_SOURCE_EXTRACTOR_VERSION,
        "public_safe_metadata",
        "metadata_only",
        preparedEventConfidence(event),
        JSON.stringify({ rangeCount: event.ranges.length }),
        now
      );
      if (eventContentEnabled) {
        upsertCodexEventContentForDraft(db, {
          event,
          eventId,
          threadId: seed.threadId,
          sourceRef: codexThreadRef(seed.threadId),
          sourcePathRef,
          sourceHash,
          privacyClass: "public_safe_metadata",
          now
        });
      }
      for (const range of event.ranges) {
        insertPreparedRange.run(
          range.rangeRef.slice("codex_range:".length),
          range.rangeRef,
          eventId,
          event.eventRef,
          seed.threadId,
          codexThreadRef(seed.threadId),
          sourcePathRef,
          sourceHash,
          range.contentHash,
          sessionDiffSourceRangeCursorKey(sourcePathRef, range.ordinal, range.rangeKind, range.contentHash),
          range.rangeKind,
          event.lineStart,
          event.lineEnd,
          event.byteStart,
          event.byteEnd,
          range.ordinal,
          event.observedAt,
          PREPARED_SOURCE_EXTRACTOR_VERSION,
          "public_safe_metadata",
          "metadata_only",
          preparedRangeConfidence(range.rangeKind),
          JSON.stringify(range.reasonCodes),
          JSON.stringify({ eventKind: event.eventKind }),
          now
        );
      }
    }
    deleteCodexSafeTextFtsForSessionRowid(db, sessionRowid);
    deleteCodexSearchFtsForSessionRowid(db, sessionRowid);
    insertCodexSafeTextFtsForSessionRowid(db, sessionRowid, seed.threadId, merged.safeText);
    insertCodexSearchFtsForThreadRowid(db, seed.threadId, sessionRowid);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getCodexJsonlDriftStatus(db: LooDatabase): CodexJsonlDriftStatus {
  if (!codexJsonlDriftSchemaReady(db)) return emptyCodexJsonlDriftStatus("requires_index_run");
  const rows = db.prepare(`
    SELECT
      last_indexed_at AS lastIndexedAt,
      jsonl_drift_unknown_event_kinds_json AS unknownEventKindsJson,
      jsonl_drift_unparsed_lines AS unparsedLines,
      jsonl_drift_missing_expected_fields_json AS missingExpectedFieldsJson,
      jsonl_drift_reason_codes_json AS reasonCodesJson
    FROM codex_source_files
  `).all() as Array<Record<string, unknown>>;
  if (rows.length === 0) return emptyCodexJsonlDriftStatus("requires_index_run");
  const unknownEventKindCounts = new Map<string, number>();
  const missingExpectedFieldCounts = new Map<string, number>();
  const reasonCodes = new Set<string>();
  let filesWithDrift = 0;
  let unknownEventKinds = 0;
  let unparsedLines = 0;
  let missingExpectedFields = 0;
  let lastIndexedAt: string | null = null;
  for (const row of rows) {
    const rowUnknown = parseCodexJsonlDriftNamedCounts(row.unknownEventKindsJson);
    const rowMissing = parseCodexJsonlDriftFieldCounts(row.missingExpectedFieldsJson);
    const rowUnparsed = Math.max(0, Math.floor(Number(row.unparsedLines ?? 0) || 0));
    for (const item of rowUnknown) {
      unknownEventKindCounts.set(item.kind, (unknownEventKindCounts.get(item.kind) ?? 0) + item.count);
      unknownEventKinds += item.count;
    }
    for (const item of rowMissing) {
      missingExpectedFieldCounts.set(item.field, (missingExpectedFieldCounts.get(item.field) ?? 0) + item.count);
      missingExpectedFields += item.count;
    }
    unparsedLines += rowUnparsed;
    for (const code of parseCodexJsonlDriftReasonCodes(row.reasonCodesJson)) reasonCodes.add(code);
    if (rowUnknown.length > 0 || rowMissing.length > 0 || rowUnparsed > 0) filesWithDrift += 1;
    const indexedAt = nullableString(row.lastIndexedAt);
    if (indexedAt && (!lastIndexedAt || indexedAt > lastIndexedAt)) lastIndexedAt = indexedAt;
  }
  const state = filesWithDrift > 0 || unknownEventKinds > 0 || unparsedLines > 0 || missingExpectedFields > 0
    ? "drift_detected"
    : "clean";
  return {
    schema: "lco.codexJsonlDrift.status.v1",
    publicSafe: true,
    readOnly: true,
    state,
    availability: "ready",
    docsRef: "docs/CODEX_JSONL_DRIFT.md",
    nextAction: null,
    filesIndexed: rows.length,
    filesWithDrift,
    unknownEventKinds,
    unparsedLines,
    missingExpectedFields,
    topUnknownEventKinds: topCodexJsonlDriftCounts(unknownEventKindCounts),
    topMissingExpectedFields: topCodexJsonlDriftCounts(missingExpectedFieldCounts).map((item) => ({ field: item.kind, count: item.count })),
    reasonCodes: [...reasonCodes].sort().slice(0, 20),
    lastIndexedAt
  };
}

export function readCodexJsonlDriftStatusFromPath(dbPath = defaultDatabasePath()): CodexJsonlDriftStatus {
  if (!existsSync(dbPath)) return missingCodexJsonlDriftStatus();
  const DatabaseSync = getDatabaseSync();
  let db: LooDatabase | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON");
    return getCodexJsonlDriftStatus(db);
  } catch {
    return emptyCodexJsonlDriftStatus("read_error");
  } finally {
    db?.close();
  }
}

export function readCodexIndexHealthStatusFromPath(dbPath = defaultDatabasePath()): CodexIndexHealthStatus {
  if (!existsSync(dbPath)) {
    return {
      databaseStorage: getDatabaseStorageStatus(null, dbPath),
      codexJsonlDrift: missingCodexJsonlDriftStatus(),
      codexIndexLimits: emptyCodexIndexLimitStatus("requires_index_run"),
      codexEventContent: emptyCodexEventContentStatus("database_missing")
    };
  }
  const DatabaseSync = getDatabaseSync();
  let db: LooDatabase | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON");
    return {
      databaseStorage: getDatabaseStorageStatus(db, dbPath),
      codexJsonlDrift: getCodexJsonlDriftStatus(db),
      codexIndexLimits: getCodexIndexLimitStatus(db),
      codexEventContent: getCodexEventContentStatus(db, dbPath)
    };
  } catch {
    return {
      databaseStorage: getDatabaseStorageStatus(null, dbPath, { unavailable: true }),
      codexJsonlDrift: emptyCodexJsonlDriftStatus("read_error"),
      codexIndexLimits: emptyCodexIndexLimitStatus("read_error"),
      codexEventContent: emptyCodexEventContentStatus("read_error")
    };
  } finally {
    db?.close();
  }
}

export function getDatabaseStorageStatus(
  db: LooDatabase | null,
  dbPath?: string,
  options: { unavailable?: boolean } = {}
): DatabaseStorageStatus {
  const dbBytes = sqliteMainFileBytes(db, dbPath);
  const walBytes = sqliteWalFileBytes(dbPath);
  const totalBytes = dbBytes + walBytes;
  const missing = !db && dbPath ? !existsSync(dbPath) : !db && !dbPath;
  const thresholds = {
    dbBytes: DATABASE_MAINTENANCE_DB_BYTES_THRESHOLD,
    walBytes: DATABASE_MAINTENANCE_WAL_BYTES_THRESHOLD,
    totalBytes: DATABASE_MAINTENANCE_TOTAL_BYTES_THRESHOLD
  };
  const maintenanceRecommended = !missing && !options.unavailable && (
    dbBytes >= thresholds.dbBytes
    || walBytes >= thresholds.walBytes
    || totalBytes >= thresholds.totalBytes
  );
  return {
    schema: "lco.databaseStorage.status.v1",
    publicSafe: true,
    readOnly: true,
    state: options.unavailable ? "unavailable" : missing ? "missing" : maintenanceRecommended ? "maintenance_recommended" : "ready",
    size: {
      dbBytes,
      walBytes,
      totalBytes
    },
    thresholds,
    maintenanceRecommended,
    reasonCodes: unique([
      options.unavailable ? "database_storage_status_unavailable" : "",
      missing ? "database_storage_missing" : "",
      !missing && !maintenanceRecommended && !options.unavailable ? "database_storage_ready" : "",
      dbBytes >= thresholds.dbBytes ? "database_storage_db_size_maintenance_recommended" : "",
      walBytes >= thresholds.walBytes ? "database_storage_wal_size_maintenance_recommended" : "",
      totalBytes >= thresholds.totalBytes ? "database_storage_total_size_maintenance_recommended" : ""
    ].filter(Boolean)),
    nextSafeCommands: maintenanceRecommended ? ["loo maintenance --timeout-ms 60000", "loo doctor"] : []
  };
}

export function runDatabaseMaintenance(
  db: LooDatabase,
  options: { dbPath?: string; checkpoint?: boolean; analyze?: boolean; vacuum?: boolean; strict?: boolean } = {}
): DatabaseMaintenanceReport {
  const checkpoint = options.checkpoint ?? true;
  const analyze = options.analyze ?? true;
  const vacuum = options.vacuum ?? false;
  const strictMode = options.strict ?? false;
  const before = getDatabaseStorageStatus(db, options.dbPath);
  const operations: DatabaseMaintenanceReport["operations"] = [];

  if (checkpoint) {
    const checkpointRow = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as Record<string, unknown> | undefined;
    const busy = Number(checkpointRow?.busy ?? 0);
    const ok = Number.isFinite(busy) && busy === 0;
    operations.push({
      name: "wal_checkpoint_truncate",
      ok,
      ...(ok ? {} : { reason: "busy" })
    });
  }

  if (analyze) {
    db.exec("ANALYZE");
    operations.push({ name: "analyze", ok: true });
  }

  let vacuumPerformed = false;
  if (vacuum) {
    const freeBytes = options.dbPath ? availableFilesystemBytes(dirname(options.dbPath)) : null;
    const requiredBytes = Math.max(before.size.totalBytes * 2, 64 * 1024 * 1024);
    if (freeBytes === null) {
      operations.push({ name: "vacuum", ok: true, skipped: true, reason: "free_space_unavailable" });
    } else if (freeBytes < requiredBytes) {
      operations.push({ name: "vacuum", ok: true, skipped: true, reason: "insufficient_free_space" });
    } else {
      db.exec("VACUUM");
      vacuumPerformed = true;
      operations.push({ name: "vacuum", ok: true });
    }
  }

  const after = getDatabaseStorageStatus(db, options.dbPath);
  const skippedOperations = operations.filter((operation) => operation.skipped);
  const failedOperations = operations.filter((operation) => operation.ok === false);
  const strictBlocked = strictMode && (skippedOperations.length > 0 || failedOperations.length > 0);
  const checkpointOperation = operations.find((operation) => operation.name === "wal_checkpoint_truncate");
  return {
    schema: "lco.databaseMaintenance.v1",
    ok: failedOperations.length === 0 && !strictBlocked,
    publicSafe: true,
    readOnly: false,
    strictMode,
    mutationClasses: ["derived_cache"],
    actionsPerformed: {
      checkpoint,
      analyze,
      vacuum: vacuumPerformed
    },
    before,
    after,
    operations,
    nextSafeCommands: ["loo doctor"],
    reasonCodes: unique([
      checkpointOperation?.ok ? "database_checkpoint_truncate_completed" : "",
      ...failedOperations.map((operation) => `database_${operation.name}_failed_${operation.reason ?? "unknown"}`),
      analyze ? "database_analyze_completed" : "",
      vacuumPerformed ? "database_vacuum_completed" : "",
      ...skippedOperations.map((operation) => `database_${operation.name}_skipped_${operation.reason ?? "unknown"}`),
      strictBlocked ? "database_maintenance_strict_blocker" : "",
      "derived_cache_only"
    ].filter(Boolean))
  };
}

export function getCodexEventContentStatus(db: LooDatabase, dbPath?: string): CodexEventContentStatus {
  if (!tableExists(db, "prepared_source_events") || !tableExists(db, "codex_event_content")) {
    return codexEventContentEnabled()
      ? emptyCodexEventContentStatus("requires_index_run", dbPath)
      : emptyCodexEventContentStatus("disabled", dbPath);
  }
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM prepared_source_events) AS totalEvents,
      (SELECT COUNT(*) FROM codex_event_content) AS eventsWithContent,
      (SELECT COALESCE(SUM(length(event_text)), 0) FROM codex_event_content) AS eventContentBytes,
      (SELECT COUNT(*) FROM codex_event_content_fts) AS eventContentFtsRows,
      (SELECT MAX(updated_at) FROM codex_event_content) AS lastIndexedAt
  `).get() as {
    totalEvents: number;
    eventsWithContent: number;
    eventContentBytes: number;
    eventContentFtsRows: number;
    lastIndexedAt: string | null;
  };
  const totalEvents = Number(row.totalEvents ?? 0);
  const eventsWithContent = Number(row.eventsWithContent ?? 0);
  const disabled = !codexEventContentEnabled();
  if (disabled) {
    const dbBytes = sqliteMainFileBytes(db, dbPath);
    const walBytes = sqliteWalFileBytes(dbPath);
    return {
      schema: "lco.codexEventContent.status.v1",
      publicSafe: true,
      readOnly: true,
      state: "disabled",
      availability: "disabled",
      coverage: {
        totalEvents,
        eventsWithContent,
        coveragePct: totalEvents > 0 ? Number(((eventsWithContent / totalEvents) * 100).toFixed(2)) : 0
      },
      size: {
        dbBytes,
        walBytes,
        eventContentBytes: Number(row.eventContentBytes ?? 0),
        eventContentFtsRows: Number(row.eventContentFtsRows ?? 0)
      },
      reasonCodes: unique([
        "codex_event_content_store",
        "codex_event_content_disabled_by_env",
        totalEvents === 0 ? "codex_event_content_projection_requires_index_run" : "",
        dbBytes === 0 ? "codex_event_content_db_size_unavailable" : "",
        dbPath ? "" : "codex_event_content_wal_size_path_unavailable"
      ]),
      lastIndexedAt: nullableString(row.lastIndexedAt)
    };
  }
  if (totalEvents === 0) return emptyCodexEventContentStatus("requires_index_run", dbPath);
  const coveragePct = Number(((eventsWithContent / totalEvents) * 100).toFixed(2));
  const state: CodexEventContentStatus["state"] = eventsWithContent === 0 ? "dropped" : eventsWithContent >= totalEvents ? "ready" : "partial";
  const availability: CodexEventContentStatus["availability"] = state === "ready" ? "ready" : "requires_index_run";
  const dbBytes = sqliteMainFileBytes(db, dbPath);
  const walBytes = sqliteWalFileBytes(dbPath);
  return {
    schema: "lco.codexEventContent.status.v1",
    publicSafe: true,
    readOnly: true,
    state,
    availability,
    coverage: {
      totalEvents,
      eventsWithContent,
      coveragePct
    },
    size: {
      dbBytes,
      walBytes,
      eventContentBytes: Number(row.eventContentBytes ?? 0),
      eventContentFtsRows: Number(row.eventContentFtsRows ?? 0)
    },
    reasonCodes: unique([
      "codex_event_content_store",
      state === "partial" ? "codex_event_content_backfill_partial" : "",
      state === "dropped" ? "codex_event_content_cache_dropped" : "",
      state === "ready" ? "codex_event_content_coverage_ready" : "",
      dbBytes === 0 ? "codex_event_content_db_size_unavailable" : "",
      dbPath ? "" : "codex_event_content_wal_size_path_unavailable"
    ]),
    lastIndexedAt: nullableString(row.lastIndexedAt)
  };
}

export function dropCodexEventContentCache(db: LooDatabase, options: { dbPath?: string } = {}): CodexEventContentDropReport {
  const before = codexEventContentCacheSnapshot(db, options.dbPath);
  db.exec("BEGIN");
  try {
    if (tableExists(db, "codex_event_content")) {
      db.prepare("DELETE FROM codex_event_content").run();
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const after = codexEventContentCacheSnapshot(db, options.dbPath);
  return {
    schema: "lco.codexEventContent.drop.v1",
    ok: true,
    publicSafe: true,
    readOnly: false,
    mutationClasses: ["derived_cache"],
    before: {
      eventContentRows: before.eventContentRows,
      eventContentFtsRows: before.eventContentFtsRows,
      eventContentBytes: before.eventContentBytes,
      dbBytes: before.dbBytes,
      walBytes: before.walBytes
    },
    after: {
      eventContentRows: after.eventContentRows,
      eventContentFtsRows: after.eventContentFtsRows,
      eventContentBytes: after.eventContentBytes,
      dbBytes: after.dbBytes,
      walBytes: after.walBytes
    },
    delta: {
      eventContentRows: before.eventContentRows - after.eventContentRows,
      eventContentFtsRows: before.eventContentFtsRows - after.eventContentFtsRows,
      eventContentBytes: before.eventContentBytes - after.eventContentBytes,
      dbBytes: before.dbBytes - after.dbBytes
    },
    preserved: {
      codexSessions: after.codexSessions,
      preparedSourceEvents: after.preparedSourceEvents,
      preparedSourceRanges: after.preparedSourceRanges
    },
    nextSafeCommands: [CODEX_EVENT_CONTENT_REBUILD_COMMAND],
    reasonCodes: unique([
      "codex_event_content_cache_dropped",
      before.eventContentRows === 0 ? "codex_event_content_cache_already_empty" : "",
      "derived_cache_only"
    ])
  };
}

function codexEventContentCacheSnapshot(db: LooDatabase, dbPath?: string): {
  codexSessions: number;
  preparedSourceEvents: number;
  preparedSourceRanges: number;
  eventContentRows: number;
  eventContentFtsRows: number;
  eventContentBytes: number;
  dbBytes: number;
  walBytes: number;
} {
  return {
    codexSessions: countTableRowsIfExists(db, "codex_sessions"),
    preparedSourceEvents: countTableRowsIfExists(db, "prepared_source_events"),
    preparedSourceRanges: countTableRowsIfExists(db, "prepared_source_ranges"),
    eventContentRows: countTableRowsIfExists(db, "codex_event_content"),
    eventContentFtsRows: countTableRowsIfExists(db, "codex_event_content_fts"),
    eventContentBytes: tableExists(db, "codex_event_content")
      ? Number((db.prepare("SELECT COALESCE(SUM(length(event_text)), 0) AS bytes FROM codex_event_content").get() as { bytes: number }).bytes)
      : 0,
    dbBytes: sqliteMainFileBytes(db, dbPath),
    walBytes: sqliteWalFileBytes(dbPath)
  };
}

function countTableRowsIfExists(db: LooDatabase, tableName: string): number {
  if (!tableExists(db, tableName)) return 0;
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }).count);
}

export function getCodexIndexLimitStatus(db: LooDatabase): CodexIndexLimitStatus {
  if (!codexIndexLimitSchemaReady(db)) return emptyCodexIndexLimitStatus("requires_index_run");
  const limitedRows = db.prepare(`
    SELECT
      reason,
      limit_value AS limitValue,
      actual_value AS actualValue,
      observed_at AS observedAt
    FROM codex_index_limited_files
  `).all() as Array<Record<string, unknown>>;
  const sourceFileCount = Number((db.prepare("SELECT COUNT(*) AS count FROM codex_source_files").get() as { count: number }).count);
  if (limitedRows.length === 0 && sourceFileCount === 0) return emptyCodexIndexLimitStatus("requires_index_run");
  const limitedFiles = limitedRows.map((row, index) => ({
    path: `codex_index_limited_file:${index + 1}`,
    reason: limitedCodexFileReason(row.reason),
    limit: Math.max(0, Math.floor(Number(row.limitValue ?? 0) || 0)),
    actual: Math.max(0, Math.floor(Number(row.actualValue ?? 0) || 0))
  })).filter((file) => file.reason !== null) as LimitedCodexFile[];
  const unknownReasonRows = limitedRows.length - limitedFiles.length;
  const hasLimitedFileEvidence = limitedRows.length > 0;
  const lastObservedAt = limitedRows
    .map((row) => nullableString(row.observedAt))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return {
    schema: "lco.codexIndexLimits.status.v1",
    publicSafe: true,
    readOnly: true,
    state: hasLimitedFileEvidence ? "limited" : "clean",
    availability: "ready",
    docsRef: "docs/SETUP.md#4-index-local-codex-sessions",
    defaultIndexLimits: {
      maxBytesPerFile: DEFAULT_CODEX_MAX_BYTES_PER_FILE,
      maxEventsPerFile: DEFAULT_CODEX_MAX_EVENTS_PER_FILE
    },
    limitedFiles: limitedRows.length,
    skippedFiles: limitedRows.length,
    reasons: summarizeCodexIndexLimitReasons(limitedFiles),
    nextSafeCommands: codexIndexLimitNextSafeCommands(hasLimitedFileEvidence),
    reasonCodes: hasLimitedFileEvidence
      ? ["codex_index_limited_files_skipped", ...(unknownReasonRows > 0 ? ["codex_index_limited_unknown_reason"] : [])]
      : [],
    lastObservedAt
  };
}

export function readCodexIndexLimitStatusFromPath(dbPath = defaultDatabasePath()): CodexIndexLimitStatus {
  if (!existsSync(dbPath)) return emptyCodexIndexLimitStatus("requires_index_run");
  const DatabaseSync = getDatabaseSync();
  let db: LooDatabase | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON");
    return getCodexIndexLimitStatus(db);
  } catch {
    return emptyCodexIndexLimitStatus("read_error");
  } finally {
    db?.close();
  }
}

function emptyCodexIndexLimitStatus(availability: CodexIndexLimitStatus["availability"]): CodexIndexLimitStatus {
  const requiresIndexRun = availability === "requires_index_run";
  return {
    schema: "lco.codexIndexLimits.status.v1",
    publicSafe: true,
    readOnly: true,
    state: requiresIndexRun ? "not_indexed_yet" : "unavailable",
    availability,
    docsRef: "docs/SETUP.md#4-index-local-codex-sessions",
    defaultIndexLimits: {
      maxBytesPerFile: DEFAULT_CODEX_MAX_BYTES_PER_FILE,
      maxEventsPerFile: DEFAULT_CODEX_MAX_EVENTS_PER_FILE
    },
    limitedFiles: 0,
    skippedFiles: 0,
    reasons: [],
    nextSafeCommands: requiresIndexRun ? [CODEX_JSONL_DRIFT_INDEX_NEXT_ACTION] : [],
    reasonCodes: requiresIndexRun ? ["codex_index_limits_projection_requires_index_run"] : [],
    lastObservedAt: null
  };
}

function emptyCodexEventContentStatus(availability: CodexEventContentStatus["availability"], dbPath?: string): CodexEventContentStatus {
  const requiresIndexRun = availability === "requires_index_run" || availability === "database_missing";
  const dbBytes = sqliteMainFileBytes(null, dbPath);
  const walBytes = sqliteWalFileBytes(dbPath);
  return {
    schema: "lco.codexEventContent.status.v1",
    publicSafe: true,
    readOnly: true,
    state: availability === "disabled" ? "disabled" : requiresIndexRun ? "not_indexed_yet" : "unavailable",
    availability,
    coverage: {
      totalEvents: 0,
      eventsWithContent: 0,
      coveragePct: 0
    },
    size: {
      dbBytes,
      walBytes,
      eventContentBytes: 0,
      eventContentFtsRows: 0
    },
    reasonCodes: unique([
      availability === "disabled" ? "codex_event_content_disabled_by_env" : "",
      availability === "disabled" ? "" : requiresIndexRun
        ? "codex_event_content_projection_requires_index_run"
        : "codex_event_content_status_unavailable",
      availability !== "database_missing" && dbPath && dbBytes === 0 ? "codex_event_content_db_size_unavailable" : "",
      dbPath ? "" : "codex_event_content_wal_size_path_unavailable"
    ]),
    lastIndexedAt: null
  };
}

function sqliteMainFileBytes(db: LooDatabase | null, dbPath?: string): number {
  if (db) {
    try {
      const pageCount = Number((db.prepare("PRAGMA page_count").get() as Record<string, unknown> | undefined)?.page_count ?? 0);
      const pageSize = Number((db.prepare("PRAGMA page_size").get() as Record<string, unknown> | undefined)?.page_size ?? 0);
      return Math.max(0, pageCount * pageSize);
    } catch {
      return 0;
    }
  }
  if (dbPath && existsSync(dbPath)) return statSync(dbPath).size;
  return 0;
}

function sqliteWalFileBytes(dbPath?: string): number {
  if (!dbPath) return 0;
  const walPath = `${dbPath}-wal`;
  return existsSync(walPath) ? statSync(walPath).size : 0;
}

function availableFilesystemBytes(path: string): number | null {
  try {
    const stats = statfsSync(path, { bigint: true });
    return Number(stats.bavail * stats.bsize);
  } catch {
    return null;
  }
}

function missingCodexJsonlDriftStatus(): CodexJsonlDriftStatus {
  return {
    ...emptyCodexJsonlDriftStatus("requires_index_run"),
    nextAction: CODEX_JSONL_DRIFT_MISSING_DB_NEXT_ACTION,
    reasonCodes: ["codex_jsonl_drift_database_missing", "codex_jsonl_drift_projection_requires_index_run"]
  };
}

function emptyCodexJsonlDriftStatus(availability: CodexJsonlDriftStatus["availability"]): CodexJsonlDriftStatus {
  const requiresIndexRun = availability === "requires_index_run";
  return {
    schema: "lco.codexJsonlDrift.status.v1",
    publicSafe: true,
    readOnly: true,
    state: requiresIndexRun ? "not_indexed_yet" : "unavailable",
    availability,
    docsRef: "docs/CODEX_JSONL_DRIFT.md",
    nextAction: requiresIndexRun ? CODEX_JSONL_DRIFT_INDEX_NEXT_ACTION : null,
    filesIndexed: 0,
    filesWithDrift: 0,
    unknownEventKinds: 0,
    unparsedLines: 0,
    missingExpectedFields: 0,
    topUnknownEventKinds: [],
    topMissingExpectedFields: [],
    reasonCodes: requiresIndexRun ? ["codex_jsonl_drift_projection_requires_index_run"] : [],
    lastIndexedAt: null
  };
}

function codexJsonlDriftSchemaReady(db: LooDatabase): boolean {
  try {
    const rows = db.prepare("PRAGMA table_info(codex_source_files)").all() as Array<{ name?: string }>;
    const columns = new Set(rows.map((row) => row.name).filter((value): value is string => typeof value === "string"));
    return columns.has("jsonl_drift_unknown_event_kinds_json")
      && columns.has("jsonl_drift_unparsed_lines")
      && columns.has("jsonl_drift_missing_expected_fields_json")
      && columns.has("jsonl_drift_reason_codes_json");
  } catch {
    return false;
  }
}

function codexIndexLimitSchemaReady(db: LooDatabase): boolean {
  try {
    const rows = db.prepare("PRAGMA table_info(codex_index_limited_files)").all() as Array<{ name?: string }>;
    const columns = new Set(rows.map((row) => row.name).filter((value): value is string => typeof value === "string"));
    return columns.has("source_path")
      && columns.has("reason")
      && columns.has("limit_value")
      && columns.has("actual_value")
      && columns.has("observed_at");
  } catch {
    return false;
  }
}

function limitedCodexFileReason(value: unknown): LimitedCodexFile["reason"] | null {
  if (value === "max_bytes_per_file" || value === "max_events_per_file" || value === "max_files_dropped_oldest") return value;
  return null;
}

function parseCodexJsonlDriftNamedCounts(value: unknown): CodexJsonlDriftNamedCount[] {
  const parsed = parseJsonArray(value);
  return parsed.flatMap((item) => {
    if (!isObjectRecord(item)) return [];
    const rawKind = stringOrNull(item.kind);
    const count = Math.max(0, Math.floor(Number(item.count ?? 0) || 0));
    if (!rawKind || count <= 0) return [];
    const kind = publicSafeIdentifier(rawKind) ?? publicSafeCodexJsonlKind(rawKind);
    return [{ kind, count }];
  });
}

function parseCodexJsonlDriftFieldCounts(value: unknown): CodexJsonlDriftFieldCount[] {
  const parsed = parseJsonArray(value);
  return parsed.flatMap((item) => {
    if (!isObjectRecord(item)) return [];
    const rawField = stringOrNull(item.field);
    const count = Math.max(0, Math.floor(Number(item.count ?? 0) || 0));
    if (!rawField || count <= 0) return [];
    const field = publicSafeText(rawField, 120)
      .trim()
      .replace(/[^A-Za-z0-9._:-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return field ? [{ field, count }] : [];
  });
}

function parseCodexJsonlDriftReasonCodes(value: unknown): string[] {
  return parseJsonArray(value)
    .flatMap((item) => {
      const raw = stringOrNull(item);
      if (!raw) return [];
      const safe = publicSafeText(raw, 160)
        .trim()
        .replace(/[^A-Za-z0-9._:-]+/g, "_")
        .replace(/^_+|_+$/g, "");
      return safe ? [safe] : [];
    });
}

function parseJsonArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(typeof value === "string" ? value : "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function topCodexJsonlDriftCounts(counts: Map<string, number>): CodexJsonlDriftNamedCount[] {
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind))
    .slice(0, 8);
}

function markSourceFilesSummaryLeafCurrent(db: LooDatabase, threadId: string): void {
  db.prepare(`
    UPDATE codex_source_files
    SET summary_leaf_extractor_version = ?
    WHERE source_path IN (
      SELECT source_path
      FROM codex_sessions
      WHERE thread_id = ?
    )
  `).run(SUMMARY_LEAF_EXTRACTOR_VERSION, threadId);
}

function markSourceFilesPreparedCardCurrent(db: LooDatabase, threadId: string): void {
  db.prepare(`
    UPDATE codex_source_files
    SET prepared_card_extractor_version = ?
    WHERE source_path IN (
      SELECT source_path
      FROM codex_sessions
      WHERE thread_id = ?
    )
  `).run(PREPARED_CARD_EXTRACTOR_VERSION, threadId);
}

export function getPreparedSourceRanges(db: LooDatabase, options: PreparedSourceRangesOptions = {}): PreparedSourceRangesReport {
  const limit = clamp(options.limit ?? 100, 1, 1000);
  const clauses: string[] = [
    "privacy_class = ?",
    "omission_status = ?",
    "extractor_version = ?"
  ];
  const params: Array<string | number> = [
    "public_safe_metadata",
    "metadata_only",
    PREPARED_SOURCE_EXTRACTOR_VERSION
  ];
  if (options.threadId) {
    clauses.push("thread_id = ?");
    params.push(options.threadId);
  }
  if (options.rangeKind) {
    clauses.push("range_kind = ?");
    params.push(options.rangeKind);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const publicSafeClauses = [
    ...clauses,
    "range_ref LIKE 'codex_range:%'",
    "length(range_ref) = 44",
    "substr(range_ref, 13) NOT GLOB '*[^0-9a-f]*'",
    "event_ref LIKE 'codex_event:%'",
    "length(event_ref) = 44",
    "substr(event_ref, 13) NOT GLOB '*[^0-9a-f]*'",
    "(source_ref LIKE 'codex_thread:%' OR source_ref LIKE 'codex_subagent_result:%')",
    "length(source_ref) BETWEEN 14 AND 173",
    "source_ref NOT LIKE '%/%'",
    "source_ref NOT LIKE '%\\%'",
    "source_ref NOT LIKE '% %'",
    "source_path_ref LIKE 'codex_source:%'",
    "length(source_path_ref) = 29",
    "substr(source_path_ref, 14) NOT GLOB '*[^0-9a-f]*'",
    "length(source_hash) = 32",
    "source_hash NOT GLOB '*[^0-9a-f]*'",
    "length(content_hash) = 32",
    "content_hash NOT GLOB '*[^0-9a-f]*'",
    "line_start >= 1",
    "line_end >= line_start",
    "byte_start >= 0",
    "byte_end >= byte_start",
    "ordinal >= 0",
    "confidence >= 0",
    "confidence <= 1",
    "(observed_at IS NULL OR (length(observed_at) BETWEEN 20 AND 35 AND observed_at LIKE '____-__-__T%Z'))"
  ];
  const publicSafeWhere = `WHERE ${publicSafeClauses.join(" AND ")}`;
  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM prepared_source_ranges ${where}`).get(...params) as { count: number };
  const publicSafeCountRow = db.prepare(`SELECT COUNT(*) AS count FROM prepared_source_ranges ${publicSafeWhere}`).get(...params) as { count: number };
  const rows = db.prepare(`
    SELECT
      range_ref AS rangeRef,
      event_ref AS eventRef,
      thread_id AS threadId,
      source_ref AS sourceRef,
      source_path_ref AS sourcePathRef,
      range_kind AS rangeKind,
      line_start AS lineStart,
      line_end AS lineEnd,
      byte_start AS byteStart,
      byte_end AS byteEnd,
      ordinal,
      source_hash AS sourceHash,
      content_hash AS contentHash,
      extractor_version AS extractorVersion,
      privacy_class AS privacyClass,
      omission_status AS omissionStatus,
      confidence,
      observed_at AS observedAt,
      reason_codes_json AS reasonCodesJson
    FROM prepared_source_ranges
    ${publicSafeWhere}
    ORDER BY thread_id ASC, ordinal ASC, range_ref ASC
    LIMIT ?
  `).all(...params, limit) as PreparedSourceRangeRow[];
  const lowConfidenceRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM prepared_source_ranges
    ${publicSafeWhere}
      AND confidence < 0.5
  `).get(...params) as { count: number };
  const ranges: PreparedSourceRange[] = rows.flatMap((row) => {
    const range = preparedSourceRangeFromRow(row);
    return range ? [range] : [];
  });
  const total = Number(countRow.count ?? 0);
  const publicSafeTotal = Number(publicSafeCountRow.count ?? 0);
  const strictFilteredUnsafeRows = rows.length - ranges.length;
  const filteredUnsafeRows = Math.max(0, total - publicSafeTotal) + strictFilteredUnsafeRows;
  const limitOmissions = Math.max(0, publicSafeTotal - rows.length);
  const omittedCount = limitOmissions + filteredUnsafeRows;
  const omittedReasons = [
    limitOmissions > 0 ? "limit" : null,
    filteredUnsafeRows > 0 ? "filtered_unsafe_rows" : null
  ].filter((reason): reason is "limit" | "filtered_unsafe_rows" => Boolean(reason));
  const omittedReason = omittedReasons.length === 2
    ? "limit_and_filtered_unsafe_rows"
    : omittedReasons[0] ?? "none";
  return {
    schema: "lco.prepared.sourceRanges.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt: new Date().toISOString(),
    sourceCoverage: {
      preparedSourceRanges: publicSafeTotal > 0 ? "ok" : total > 0 ? "partial" : "not_configured"
    },
    summary: {
      total: publicSafeTotal,
      returned: ranges.length,
      lowConfidence: Number(lowConfidenceRow.count ?? 0),
      lowConfidenceScope: "matching_public_safe_total"
    },
    ranges,
    omitted: {
      count: omittedCount,
      reason: omittedReason,
      reasons: omittedReasons.length ? omittedReasons : ["none"],
      limitCount: limitOmissions,
      filteredUnsafeRows
    },
    actionsPerformed: {
      derivedCacheWrite: false,
      sourceStoreMutation: false,
      externalWrite: false,
      liveControl: false,
      guiMutation: false,
      rawTranscriptRead: false
    },
    proofBoundary: "Prepared source ranges are public-safe metadata over LCO-owned derived cache rows. They expose opaque refs, hashes, and source ranges only; they do not expose raw transcript text, local transcript paths, source-store mutation, live control, GUI mutation, external writes, model compaction, or compaction-summary capture."
  };
}

function preparedSourceRangeFromRow(row: PreparedSourceRangeRow): PreparedSourceRange | null {
  if (!isPublicPreparedSourceRangeRow(row)) return null;
  return {
    schema: "lco.prepared.sourceRange.v1",
    rangeRef: row.rangeRef,
    eventRef: row.eventRef,
    threadId: row.threadId,
    sourceRef: row.sourceRef,
    sourcePathRef: row.sourcePathRef,
    rangeKind: row.rangeKind,
    lineStart: Number(row.lineStart),
    lineEnd: Number(row.lineEnd),
    byteStart: Number(row.byteStart),
    byteEnd: Number(row.byteEnd),
    ordinal: Number(row.ordinal),
    sourceHash: row.sourceHash,
    contentHash: row.contentHash,
    extractorVersion: PREPARED_SOURCE_EXTRACTOR_VERSION,
    privacyClass: "public_safe_metadata",
    omissionStatus: "metadata_only",
    confidence: Number(row.confidence),
    observedAt: row.observedAt,
    reasonCodes: parseSourceRefsJson(row.reasonCodesJson)
  };
}

function isPublicPreparedSourceRangeRow(row: {
  rangeRef: string;
  eventRef: string;
  threadId: string;
  sourceRef: string;
  sourcePathRef: string;
  rangeKind: PreparedSourceRangeKind;
  lineStart: number;
  lineEnd: number;
  byteStart: number;
  byteEnd: number;
  ordinal: number;
  sourceHash: string;
  contentHash: string;
  extractorVersion: string;
  privacyClass: string;
  omissionStatus: string;
  confidence: number;
  observedAt: string | null;
}): boolean {
  return row.extractorVersion === PREPARED_SOURCE_EXTRACTOR_VERSION
    && row.privacyClass === "public_safe_metadata"
    && row.omissionStatus === "metadata_only"
    && /^codex_range:[0-9a-f]{32}$/.test(row.rangeRef)
    && /^codex_event:[0-9a-f]{32}$/.test(row.eventRef)
    && /^(?:codex_thread|codex_subagent_result):[A-Za-z0-9._:-]{1,160}$/.test(row.sourceRef)
    && !looksSensitiveRefLike(row.sourceRef)
    && /^codex_source:[0-9a-f]{16}$/.test(row.sourcePathRef)
    && /^[0-9a-f]{32}$/.test(row.sourceHash)
    && /^[0-9a-f]{32}$/.test(row.contentHash)
    && Number.isInteger(Number(row.lineStart))
    && Number.isInteger(Number(row.lineEnd))
    && Number.isInteger(Number(row.byteStart))
    && Number.isInteger(Number(row.byteEnd))
    && Number.isInteger(Number(row.ordinal))
    && Number.isFinite(Number(row.confidence))
    && Number(row.lineStart) >= 1
    && Number(row.lineEnd) >= Number(row.lineStart)
    && Number(row.byteStart) >= 0
    && Number(row.byteEnd) >= Number(row.byteStart)
    && Number(row.ordinal) >= 0
    && Number(row.confidence) >= 0
    && Number(row.confidence) <= 1
    && (row.observedAt === null || isSafeIsoTimestamp(row.observedAt));
}

function getPreparedSourceRangesForSummaryMaterialization(
  db: LooDatabase,
  options: { threadId?: string; limit?: number } = {}
): { ranges: PreparedSourceRange[]; filteredUnsafeRows: number; omittedRanges: number } {
  const clauses: string[] = [
    "privacy_class = ?",
    "omission_status = ?",
    "extractor_version = ?"
  ];
  const params: Array<string | number> = [
    "public_safe_metadata",
    "metadata_only",
    PREPARED_SOURCE_EXTRACTOR_VERSION
  ];
  if (options.threadId) {
    clauses.push("thread_id = ?");
    params.push(options.threadId);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const publicSafeClauses = [
    ...clauses,
    "range_ref LIKE 'codex_range:%'",
    "length(range_ref) = 44",
    "substr(range_ref, 13) NOT GLOB '*[^0-9a-f]*'",
    "event_ref LIKE 'codex_event:%'",
    "length(event_ref) = 44",
    "substr(event_ref, 13) NOT GLOB '*[^0-9a-f]*'",
    "(source_ref LIKE 'codex_thread:%' OR source_ref LIKE 'codex_subagent_result:%')",
    "length(source_ref) BETWEEN 14 AND 173",
    "source_ref NOT LIKE '%/%'",
    "source_ref NOT LIKE '%\\%'",
    "source_ref NOT LIKE '% %'",
    "source_path_ref LIKE 'codex_source:%'",
    "length(source_path_ref) = 29",
    "substr(source_path_ref, 14) NOT GLOB '*[^0-9a-f]*'",
    "length(source_hash) = 32",
    "source_hash NOT GLOB '*[^0-9a-f]*'",
    "length(content_hash) = 32",
    "content_hash NOT GLOB '*[^0-9a-f]*'",
    "line_start >= 1",
    "line_end >= line_start",
    "byte_start >= 0",
    "byte_end >= byte_start",
    "ordinal >= 0",
    "confidence >= 0",
    "confidence <= 1",
    "(observed_at IS NULL OR (length(observed_at) BETWEEN 20 AND 35 AND observed_at LIKE '____-__-__T%Z'))"
  ];
  const publicSafeWhere = `WHERE ${publicSafeClauses.join(" AND ")}`;
  const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM prepared_source_ranges ${where}`).get(...params) as { count: number }).count ?? 0);
  const publicSafeTotal = Number((db.prepare(`SELECT COUNT(*) AS count FROM prepared_source_ranges ${publicSafeWhere}`).get(...params) as { count: number }).count ?? 0);
  const maxRows = options.limit ? clamp(options.limit, 1, 100_000) : publicSafeTotal;
  const pageSize = 1000;
  const ranges: PreparedSourceRange[] = [];
  let strictFilteredUnsafeRows = 0;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const rows = db.prepare(`
      SELECT
        range_ref AS rangeRef,
        event_ref AS eventRef,
        thread_id AS threadId,
        source_ref AS sourceRef,
        source_path_ref AS sourcePathRef,
        range_kind AS rangeKind,
        line_start AS lineStart,
        line_end AS lineEnd,
        byte_start AS byteStart,
        byte_end AS byteEnd,
        ordinal,
        source_hash AS sourceHash,
        content_hash AS contentHash,
        extractor_version AS extractorVersion,
        privacy_class AS privacyClass,
        omission_status AS omissionStatus,
        confidence,
        observed_at AS observedAt,
        reason_codes_json AS reasonCodesJson
      FROM prepared_source_ranges
      ${publicSafeWhere}
      ORDER BY thread_id ASC, ordinal ASC, range_ref ASC
      LIMIT ? OFFSET ?
    `).all(...params, Math.min(pageSize, maxRows - offset), offset) as PreparedSourceRangeRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      const range = preparedSourceRangeFromRow(row);
      if (range) ranges.push(range);
      else strictFilteredUnsafeRows += 1;
    }
  }
  return {
    ranges,
    filteredUnsafeRows: Math.max(0, total - publicSafeTotal) + strictFilteredUnsafeRows,
    omittedRanges: Math.max(0, publicSafeTotal - maxRows)
  };
}

export function materializeSummaryLeaves(db: LooDatabase, options: SummaryLeafMaterializationOptions = {}): SummaryLeafMaterializationReport {
  if (!options.threadId) return materializeSummaryLeavesForAllThreads(db, options);
  let generatedAt: string;
  const rangesReport = getPreparedSourceRangesForSummaryMaterialization(db, { threadId: options.threadId, limit: options.limit });
  const leafDrafts = buildSummaryLeafDrafts(rangesReport.ranges);
  db.exec("BEGIN IMMEDIATE");
  try {
    generatedAt = allocateSessionDiffMutationTimestamp(db);
    const oldLeaves = db.prepare(`
      SELECT
        leaf_ref AS leafRef,
        input_hash AS inputHash,
        output_hash AS outputHash,
        created_at AS createdAt
      FROM summary_leaves
      WHERE thread_id = ?
    `).all(options.threadId) as Array<{ leafRef: string; inputHash: string; outputHash: string; createdAt: string }>;
    const oldLeafByRef = new Map(oldLeaves.map((row) => [row.leafRef, row]));
    deleteSummaryLeafEdges(db, oldLeaves.map((row) => row.leafRef));
    db.prepare("DELETE FROM summary_leaves WHERE thread_id = ?").run(options.threadId);
    for (const leaf of leafDrafts) {
      const previousLeaf = oldLeafByRef.get(leaf.leafRef);
      const leafCreatedAt = previousLeaf
        && previousLeaf.inputHash === leaf.inputHash
        && previousLeaf.outputHash === leaf.outputHash
        ? previousLeaf.createdAt
        : generatedAt;
      db.prepare(`
        INSERT INTO summary_leaves (
          leaf_id, leaf_ref, thread_id, leaf_kind, summary_text, source_refs_json,
          source_range_refs_json, input_hash, output_hash, extractor_version,
          privacy_class, authority_coverage_json, confidence, freshness_at, stale,
          omission_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        leaf.leafId,
        leaf.leafRef,
        leaf.threadId,
        leaf.leafKind,
        leaf.summaryText,
        JSON.stringify(leaf.sourceRefs),
        JSON.stringify(leaf.sourceRangeRefs),
        leaf.inputHash,
        leaf.outputHash,
        SUMMARY_LEAF_EXTRACTOR_VERSION,
        "public_safe_metadata",
        JSON.stringify(leaf.authorityCoverage),
        leaf.confidence,
        leaf.freshnessAt,
        leaf.stale ? 1 : 0,
        "metadata_only",
        leafCreatedAt
      );
    }
    const edgeCount = insertSummaryLeafEdges(db, leafDrafts, generatedAt);
    db.exec("COMMIT");
    return {
      schema: "lco.summary.materialization.v1",
      publicSafe: false,
      readOnly: false,
      mutationClasses: ["derived_cache"],
      generatedAt,
      target: {
        threadId: options.threadId ?? null
      },
      summary: {
        scannedRanges: rangesReport.ranges.length,
        created: leafDrafts.length,
        edges: edgeCount,
        skippedUnsafeRanges: rangesReport.filteredUnsafeRows,
        omittedRanges: rangesReport.omittedRanges
      },
      actionsPerformed: {
        derivedCacheWrite: true,
        sourceStoreMutation: false,
        externalWrite: false,
        liveControl: false,
        guiMutation: false,
        rawTranscriptRead: false
      },
      proofBoundary: "Summary leaves are deterministic metadata-only routing cards over LCO prepared source ranges. They write only LCO-owned derived cache and do not read raw transcripts, run model compaction, mutate source stores, perform live control, or perform GUI actions."
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function materializeSummaryLeavesForAllThreads(db: LooDatabase, options: SummaryLeafMaterializationOptions = {}): SummaryLeafMaterializationReport {
  const generatedAt = new Date().toISOString();
  const rows = db.prepare(`
    SELECT DISTINCT thread_id AS threadId
    FROM prepared_source_ranges
    WHERE extractor_version = ?
      AND privacy_class = 'public_safe_metadata'
      AND omission_status = 'metadata_only'
    ORDER BY thread_id ASC
  `).all(PREPARED_SOURCE_EXTRACTOR_VERSION) as Array<{ threadId: string }>;
  const summary = {
    scannedRanges: 0,
    created: 0,
    edges: 0,
    skippedUnsafeRanges: 0,
    omittedRanges: 0
  };
  for (const row of rows) {
    const report = materializeSummaryLeaves(db, { threadId: String(row.threadId), limit: options.limit });
    summary.scannedRanges += report.summary.scannedRanges;
    summary.created += report.summary.created;
    summary.edges += report.summary.edges;
    summary.skippedUnsafeRanges += report.summary.skippedUnsafeRanges;
    summary.omittedRanges += report.summary.omittedRanges;
  }
  return {
    schema: "lco.summary.materialization.v1",
    publicSafe: false,
    readOnly: false,
    mutationClasses: ["derived_cache"],
    generatedAt,
    target: {
      threadId: null
    },
    summary,
    actionsPerformed: {
      derivedCacheWrite: true,
      sourceStoreMutation: false,
      externalWrite: false,
      liveControl: false,
      guiMutation: false,
      rawTranscriptRead: false
    },
    proofBoundary: "Summary leaves are deterministic metadata-only routing cards over LCO prepared source ranges. A no-thread materialization refreshes each thread independently and writes only LCO-owned derived cache; it does not read raw transcripts, run model compaction, mutate source stores, perform live control, or perform GUI actions."
  };
}

export function getSummaryLeaves(db: LooDatabase, options: SummaryLeavesOptions = {}): SummaryLeavesReport {
  const limit = clamp(options.limit ?? 100, 1, 1000);
  const clauses: string[] = [
    "privacy_class = ?",
    "omission_status = ?",
    "extractor_version = ?"
  ];
  const params: Array<string | number> = [
    "public_safe_metadata",
    "metadata_only",
    SUMMARY_LEAF_EXTRACTOR_VERSION
  ];
  if (options.threadId) {
    clauses.push("thread_id = ?");
    params.push(options.threadId);
  }
  if (options.leafKind) {
    clauses.push("leaf_kind = ?");
    params.push(options.leafKind);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const publicSafeClauses = [
    ...clauses,
    "leaf_ref LIKE 'summary_leaf:%'",
    "length(leaf_ref) = 45",
    "substr(leaf_ref, 14) NOT GLOB '*[^0-9a-f]*'",
    "length(input_hash) = 32",
    "input_hash NOT GLOB '*[^0-9a-f]*'",
    "length(output_hash) = 32",
    "output_hash NOT GLOB '*[^0-9a-f]*'",
    "confidence >= 0",
    "confidence <= 1",
    "(freshness_at IS NULL OR (length(freshness_at) BETWEEN 20 AND 35 AND freshness_at LIKE '____-__-__T%Z'))"
  ];
  const publicSafeWhere = `WHERE ${publicSafeClauses.join(" AND ")}`;
  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM summary_leaves ${where}`).get(...params) as { count: number };
  const publicSafeCountRow = db.prepare(`SELECT COUNT(*) AS count FROM summary_leaves ${publicSafeWhere}`).get(...params) as { count: number };
  const selectRows = db.prepare(`
    SELECT
      leaf_ref AS leafRef,
      thread_id AS threadId,
      leaf_kind AS leafKind,
      summary_text AS summaryText,
      source_refs_json AS sourceRefsJson,
      source_range_refs_json AS sourceRangeRefsJson,
      input_hash AS inputHash,
      output_hash AS outputHash,
      extractor_version AS extractorVersion,
      privacy_class AS privacyClass,
      authority_coverage_json AS authorityCoverageJson,
      confidence,
      freshness_at AS freshnessAt,
      stale,
      omission_status AS omissionStatus
    FROM summary_leaves
    ${publicSafeWhere}
    ORDER BY thread_id ASC, freshness_at DESC, leaf_kind ASC, leaf_ref ASC
    LIMIT ? OFFSET ?
  `);
  const total = Number(countRow.count ?? 0);
  const sqlPublicSafeTotal = Number(publicSafeCountRow.count ?? 0);
  const leaves: SummaryLeaf[] = [];
  let publicSafeTotal = 0;
  let lowConfidence = 0;
  let strictFilteredUnsafeRows = 0;
  const pageSize = 1000;
  for (let offset = 0; offset < sqlPublicSafeTotal; offset += pageSize) {
    const rows = selectRows.all(...params, pageSize, offset) as SummaryLeafRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      const leaf = publicSummaryLeafFromRow(row);
      if (!leaf) {
        strictFilteredUnsafeRows += 1;
        continue;
      }
      publicSafeTotal += 1;
      if (leaf.confidence < 0.5) lowConfidence += 1;
      if (leaves.length < limit) leaves.push(leaf);
    }
  }
  const filteredUnsafeRows = Math.max(0, total - sqlPublicSafeTotal) + strictFilteredUnsafeRows;
  const limitOmissions = Math.max(0, publicSafeTotal - leaves.length);
  const omittedReasons = [
    limitOmissions > 0 ? "limit" : null,
    filteredUnsafeRows > 0 ? "filtered_unsafe_rows" : null
  ].filter((reason): reason is "limit" | "filtered_unsafe_rows" => Boolean(reason));
  return {
    schema: "lco.summary.leaves.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt: new Date().toISOString(),
    sourceCoverage: {
      summaryLeaves: publicSafeTotal > 0 ? "ok" : total > 0 ? "partial" : "not_configured"
    },
    summary: {
      total: publicSafeTotal,
      returned: leaves.length,
      lowConfidence,
      lowConfidenceScope: "matching_public_safe_total"
    },
    leaves,
    omitted: {
      count: limitOmissions + filteredUnsafeRows,
      reason: omittedReasons.length === 2 ? "limit_and_filtered_unsafe_rows" : omittedReasons[0] ?? "none",
      reasons: omittedReasons.length ? omittedReasons : ["none"],
      limitCount: limitOmissions,
      filteredUnsafeRows
    },
    actionsPerformed: {
      derivedCacheWrite: false,
      sourceStoreMutation: false,
      externalWrite: false,
      liveControl: false,
      guiMutation: false,
      rawTranscriptRead: false
    },
    proofBoundary: "Summary leaves are public-safe metadata-only routing cards over prepared source ranges. They expose opaque refs, hashes, and bounded summary text only; they do not expose raw transcript text, local paths, secrets, source-store mutation, live control, GUI mutation, external writes, model compaction, or true Codex compaction-summary capture."
  };
}

export function expandSummaryLeaves(db: LooDatabase, options: SummaryExpansionOptions = {}): SummaryExpansionReport {
  const maxDepth = clamp(options.maxDepth ?? 3, 0, 20);
  const maxNodes = clamp(options.maxNodes ?? 20, 1, 200);
  const tokenBudget = clamp(options.tokenBudget ?? 1000, 8, 8000);
  const requestedRoot = options.leafRef ? getSummaryLeafByRef(db, options.leafRef, options.threadId) : null;
  const leafScopeThreadId = options.threadId ?? requestedRoot?.threadId ?? undefined;
  const allLeaves = getSummaryLeaves(db, { threadId: leafScopeThreadId, limit: 1000 }).leaves;
  const leafByRef = new Map(allLeaves.map((leaf) => [leaf.leafRef, leaf]));
  if (requestedRoot) leafByRef.set(requestedRoot.leafRef, requestedRoot);
  const roots = options.leafRef
    ? [requestedRoot].filter((leaf): leaf is SummaryLeaf => Boolean(leaf))
    : allLeaves.slice(0, maxNodes);
  const leaves: SummaryLeaf[] = [];
  const edges: SummaryExpansionReport["edges"] = [];
  const seen = new Set<string>();
  const queued = roots.map((leaf) => ({ leaf, depth: 0 }));
  const queuedRefs = new Set(roots.map((leaf) => leaf.leafRef));
  const edgeKeys = new Set<string>();
  let approxTokens = 0;
  const omitted = {
    cycleCount: 0,
    depthCount: 0,
    nodeLimitCount: options.leafRef ? 0 : Math.max(0, allLeaves.length - roots.length),
    tokenBudgetCount: 0
  };
  while (queued.length > 0) {
    const next = queued.shift()!;
    queuedRefs.delete(next.leaf.leafRef);
    if (seen.has(next.leaf.leafRef)) {
      omitted.cycleCount += 1;
      continue;
    }
    if (next.depth > maxDepth) {
      omitted.depthCount += 1;
      continue;
    }
    if (leaves.length >= maxNodes) {
      omitted.nodeLimitCount += 1;
      continue;
    }
    const nextTokens = approximateTokens(next.leaf.summaryText);
    if (approxTokens + nextTokens > tokenBudget) {
      omitted.tokenBudgetCount += 1;
      continue;
    }
    seen.add(next.leaf.leafRef);
    approxTokens += nextTokens;
    leaves.push(next.leaf);
    for (const edge of getSummaryEdgesForParent(db, next.leaf, maxNodes * 2)) {
      let child = leafByRef.get(edge.childLeafRef);
      if (!child) {
        child = getSummaryLeafByRef(db, edge.childLeafRef, next.leaf.threadId ?? undefined) ?? undefined;
        if (child) leafByRef.set(child.leafRef, child);
      }
      if (!child) continue;
      const edgeKey = `${edge.parentLeafRef}:${edge.childLeafRef}:${edge.edgeKind}`;
      if (!edgeKeys.has(edgeKey)) {
        edges.push(edge);
        edgeKeys.add(edgeKey);
      }
      if (seen.has(child.leafRef)) {
        omitted.cycleCount += 1;
      } else if (queuedRefs.has(child.leafRef)) {
        continue;
      } else {
        queued.push({ leaf: child, depth: next.depth + 1 });
        queuedRefs.add(child.leafRef);
      }
    }
  }
  const reasons = [
    omitted.cycleCount > 0 ? "cycle" : null,
    omitted.depthCount > 0 ? "depth" : null,
    omitted.nodeLimitCount > 0 ? "node_limit" : null,
    omitted.tokenBudgetCount > 0 ? "token_budget" : null
  ].filter((reason): reason is "cycle" | "depth" | "node_limit" | "token_budget" => Boolean(reason));
  return {
    schema: "lco.summary.expansion.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt: new Date().toISOString(),
    root: {
      leafRef: roots[0]?.leafRef ?? null,
      threadId: options.leafRef ? roots[0]?.threadId ?? options.threadId ?? null : options.threadId ?? null
    },
    limits: {
      maxDepth,
      maxNodes,
      tokenBudget
    },
    leaves,
    edges: edges.filter((edge) => seen.has(edge.parentLeafRef) && (seen.has(edge.childLeafRef) || edge.childLeafRef === options.leafRef)).slice(0, maxNodes * 2),
    omitted: {
      count: omitted.cycleCount + omitted.depthCount + omitted.nodeLimitCount + omitted.tokenBudgetCount,
      reasons: reasons.length ? reasons : ["none"],
      ...omitted
    },
    actionsPerformed: {
      derivedCacheWrite: false,
      sourceStoreMutation: false,
      externalWrite: false,
      liveControl: false,
      guiMutation: false,
      rawTranscriptRead: false
    },
    proofBoundary: "Summary expansion traverses public-safe summary-leaf metadata under depth, node, and token caps. It reports omissions explicitly and does not read raw transcripts, run model compaction, mutate source stores, perform live control, or perform GUI actions."
  };
}

export function materializePreparedCards(db: LooDatabase, options: { threadId?: string; lcmDbPaths?: string[] } = {}): PreparedCardMaterializationReport {
  if (!options.threadId) return materializePreparedCardsForAllThreads(db, options.lcmDbPaths);
  return materializePreparedCardsForTarget(db, options.threadId);
}

function materializePreparedCardsForTarget(
  db: LooDatabase,
  threadId: string,
  lookupCache?: PreparedCardWorkStateLookupCache
): PreparedCardMaterializationReport {
  let generatedAt: string;
  let summary: PreparedCardMaterializationReport["summary"];
  db.exec("BEGIN IMMEDIATE");
  try {
    generatedAt = allocateSessionDiffMutationTimestamp(db);
    // threadId is intentionally Codex-only here; Claude session cards refresh in
    // the no-thread path so caller-supplied Codex thread refreshes stay bounded.
    summary = materializePreparedCardsForThread(db, threadId, generatedAt, lookupCache);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    schema: "lco.preparedCards.materialization.v1",
    publicSafe: false,
    readOnly: false,
    mutationClasses: ["derived_cache"],
    generatedAt,
    target: {
      threadId
    },
    summary,
    actionsPerformed: preparedCardWriteActions(),
    proofBoundary: "Prepared cards are deterministic advisory cache rows over public-safe summary leaves and session metadata. They write only LCO-owned derived cache and do not read raw transcripts, run model compaction, mutate source stores, perform live control, or perform GUI actions."
  };
}

function materializePreparedCardsForAllThreads(db: LooDatabase, lcmDbPaths?: string[]): PreparedCardMaterializationReport {
  let generatedAt: string;
  const rows = db.prepare(`
    SELECT DISTINCT threadId
    FROM (
      SELECT thread_id AS threadId
      FROM summary_leaves
      WHERE extractor_version = ?
        AND privacy_class = 'public_safe_metadata'
        AND omission_status = 'metadata_only'
        AND thread_id IS NOT NULL
      UNION
      SELECT substr(target_ref, length('codex_thread:') + 1) AS threadId
      FROM prepared_cards
      WHERE extractor_version = ?
        AND privacy_class = 'public_safe_metadata'
        AND target_ref LIKE 'codex_thread:%'
    )
    WHERE threadId IS NOT NULL
    ORDER BY threadId ASC
  `).all(SUMMARY_LEAF_EXTRACTOR_VERSION, PREPARED_CARD_EXTRACTOR_VERSION) as Array<{ threadId: string }>;
  const summary = {
    // Claude prepared cards are metadata-only in this adapter: they materialize
    // cards and inbox items, but do not synthesize SummaryLeaf rows.
    summaryLeaves: 0,
    cards: 0,
    inboxItems: 0,
    skippedUnsafeRows: 0
  };
  const threadIds = unique(rows.map((row) => String(row.threadId ?? "")).filter(isPublicSummaryThreadId));
  db.exec("BEGIN IMMEDIATE");
  try {
    generatedAt = allocateSessionDiffMutationTimestamp(db);
    const lookupCache = buildPreparedCardWorkStateLookupCache(db, threadIds);
    for (const threadId of threadIds) {
      const threadSummary = materializePreparedCardsForThread(db, threadId, generatedAt, lookupCache);
      summary.summaryLeaves += threadSummary.summaryLeaves;
      summary.cards += threadSummary.cards;
      summary.inboxItems += threadSummary.inboxItems;
      summary.skippedUnsafeRows += threadSummary.skippedUnsafeRows;
    }
    const claudeSummary = materializePreparedCardsForClaudeSessions(db, generatedAt);
    summary.summaryLeaves += claudeSummary.summaryLeaves;
    summary.cards += claudeSummary.cards;
    summary.inboxItems += claudeSummary.inboxItems;
    summary.skippedUnsafeRows += claudeSummary.skippedUnsafeRows;
    if (lcmDbPaths !== undefined) {
      const lcmSummary = materializePreparedCardsForLcmPeers(db, lcmDbPaths, generatedAt);
      summary.summaryLeaves += lcmSummary.summaryLeaves;
      summary.cards += lcmSummary.cards;
      summary.inboxItems += lcmSummary.inboxItems;
      summary.skippedUnsafeRows += lcmSummary.skippedUnsafeRows;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    schema: "lco.preparedCards.materialization.v1",
    publicSafe: false,
    readOnly: false,
    mutationClasses: ["derived_cache"],
    generatedAt,
    target: {
      threadId: null
    },
    summary,
    actionsPerformed: preparedCardWriteActions(),
    proofBoundary: "Prepared cards are deterministic advisory cache rows over public-safe summary leaves and session metadata. A no-thread materialization refreshes selected threads in one derived-cache transaction and writes only LCO-owned derived cache; it does not read raw transcripts, run model compaction, mutate source stores, perform live control, or perform GUI actions."
  };
}

function materializePreparedCardsForThread(
  db: LooDatabase,
  threadId: string,
  generatedAt: string,
  lookupCache?: PreparedCardWorkStateLookupCache
): PreparedCardMaterializationReport["summary"] {
  const targetRef = codexThreadRef(threadId);
  const leavesReport = getSummaryLeaves(db, { threadId, limit: 1000 });
  const card = leavesReport.leaves.length > 0
    ? buildPreparedCardDraft(db, threadId, leavesReport.leaves, leavesReport.omitted.filteredUnsafeRows, lookupCache)
    : null;
  const previousCard = db.prepare(`
    SELECT
      card_ref AS cardRef,
      input_hash AS inputHash,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM prepared_cards
    WHERE target_ref = ?
    ORDER BY updated_at DESC, card_ref DESC
    LIMIT 1
  `).get(targetRef) as PreviousPreparedCardWrite | undefined;
  const previousInbox = db.prepare(`
    SELECT
      item_id AS itemRef,
      card_ref AS cardRef,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM prepared_inbox_items
    WHERE target_ref = ?
    ORDER BY updated_at DESC, item_id DESC
    LIMIT 1
  `).get(targetRef) as PreviousPreparedInboxWrite | undefined;
  deletePreparedCardsForTargetRefs(db, [targetRef]);
  if (card) {
    insertPreparedCardAndInbox(db, card, generatedAt, { previousCard, previousInbox });
  }
  return {
    summaryLeaves: leavesReport.summary.total,
    cards: card ? 1 : 0,
    inboxItems: card ? 1 : 0,
    skippedUnsafeRows: leavesReport.omitted.filteredUnsafeRows
  };
}

function insertPreparedCardAndInbox(
  db: LooDatabase,
  card: PreparedCardDraft,
  generatedAt: string,
  previous: { previousCard?: PreviousPreparedCardWrite; previousInbox?: PreviousPreparedInboxWrite } = {}
): void {
  const cardUnchanged = previous.previousCard?.cardRef === card.cardRef
    && previous.previousCard.inputHash === card.inputHash;
  const cardCreatedAt = cardUnchanged ? previous.previousCard!.createdAt : generatedAt;
  const cardUpdatedAt = cardUnchanged ? previous.previousCard!.updatedAt : generatedAt;
  db.prepare(`
    INSERT INTO prepared_cards (
      card_id, card_ref, target_ref, card_kind, title, objective, summary_text, blocker, next_action,
      source_refs_json, source_range_refs_json, source_range_refs_omitted, authority_coverage_json,
      input_hash, extractor_version, privacy_class, confidence, freshness_at,
      stale, state, reason_codes_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    card.cardId,
    card.cardRef,
    card.targetRef,
    card.cardKind,
    card.title,
    card.objective ?? "",
    card.summaryText,
    card.blocker,
    card.nextAction,
    JSON.stringify(card.sourceRefs),
    JSON.stringify(card.sourceRangeRefs),
    card.sourceRangeRefsOmitted,
    JSON.stringify(card.authorityCoverage),
    card.inputHash,
    PREPARED_CARD_EXTRACTOR_VERSION,
    "public_safe_metadata",
    card.confidence,
    card.freshnessAt,
    card.stale ? 1 : 0,
    card.state,
    JSON.stringify(card.reasonCodes),
    cardCreatedAt,
    cardUpdatedAt
  );
  const inbox = preparedInboxItemFromCard(card);
  const inboxUnchanged = cardUnchanged
    && previous.previousInbox?.itemRef === inbox.itemRef
    && previous.previousInbox.cardRef === inbox.cardRef;
  const inboxCreatedAt = inboxUnchanged ? previous.previousInbox!.createdAt : generatedAt;
  const inboxUpdatedAt = inboxUnchanged ? previous.previousInbox!.updatedAt : generatedAt;
  db.prepare(`
    INSERT INTO prepared_inbox_items (
      item_id, card_ref, target_ref, urgency_score, state, reason_codes_json,
      source_refs_json, execute_false, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    inbox.itemRef,
    inbox.cardRef,
    inbox.targetRef,
    inbox.urgencyScore,
    inbox.state,
    JSON.stringify(inbox.reasonCodes),
    JSON.stringify(inbox.sourceRefs),
    1,
    inboxCreatedAt,
    inboxUpdatedAt
  );
}

type ClaudePreparedSessionRow = {
  sessionId: string;
  title: string | null;
  project: string | null;
  status: string | null;
  sourcePath: string;
  updatedAt: string | null;
  safeSummary: string | null;
  safeText: string | null;
  sourceRefsJson: string;
  indexedAt: string;
};

function materializePreparedCardsForClaudeSessions(db: LooDatabase, generatedAt: string): PreparedCardMaterializationReport["summary"] {
  const rows = db.prepare(`
    SELECT
      session_id AS sessionId,
      title,
      project,
      status,
      source_path AS sourcePath,
      updated_at AS updatedAt,
      safe_summary AS safeSummary,
      safe_text AS safeText,
      source_refs_json AS sourceRefsJson,
      indexed_at AS indexedAt
    FROM claude_sessions
    ORDER BY COALESCE(updated_at, indexed_at) DESC, session_id ASC
  `).all() as ClaudePreparedSessionRow[];
  const targetRefs = unique(rows.map((row) => claudeSessionRef(safeClaudeSessionId(String(row.sessionId ?? "")))).filter(isPublicPreparedSourceRef));
  const existingRows = db.prepare(`
    SELECT
      target_ref AS targetRef,
      card_ref AS cardRef,
      input_hash AS inputHash,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM prepared_cards
    WHERE target_ref GLOB 'claude_session:*'
      AND extractor_version = ?
      AND privacy_class = 'public_safe_metadata'
  `).all(PREPARED_CARD_EXTRACTOR_VERSION) as Array<PreviousPreparedCardWrite & { targetRef: string }>;
  const existingInboxRows = db.prepare(`
    SELECT
      target_ref AS targetRef,
      item_id AS itemRef,
      card_ref AS cardRef,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM prepared_inbox_items
    WHERE target_ref GLOB 'claude_session:*'
  `).all() as Array<PreviousPreparedInboxWrite & { targetRef: string }>;
  const previousCardByTarget = new Map(existingRows.map((row) => [row.targetRef, row]));
  const previousInboxByTarget = new Map(existingInboxRows.map((row) => [row.targetRef, row]));
  const activeTargetRefs = new Set(targetRefs);
  const staleTargetRefs = existingRows.map((row) => String(row.targetRef ?? "")).filter((ref) => isPublicPreparedSourceRef(ref) && !activeTargetRefs.has(ref));
  // Delete-before-reinsert is safe because the caller keeps the whole
  // materialization pass inside one SQLite transaction. Keep Claude refresh
  // transactional if this is later made incremental.
  deletePreparedCardsForTargetRefs(db, [...targetRefs, ...staleTargetRefs]);

  const summary = {
    summaryLeaves: 0,
    cards: 0,
    inboxItems: 0,
    skippedUnsafeRows: 0
  };
  const cardsByTargetRef = new Map<string, PreparedCardDraft>();
  for (const row of rows) {
    const card = buildPreparedClaudeCardDraft(db, row);
    if (!card) {
      summary.skippedUnsafeRows += 1;
      continue;
    }
    if (cardsByTargetRef.has(card.targetRef)) continue;
    cardsByTargetRef.set(card.targetRef, card);
  }
  for (const card of cardsByTargetRef.values()) {
    insertPreparedCardAndInbox(db, card, generatedAt, {
      previousCard: previousCardByTarget.get(card.targetRef),
      previousInbox: previousInboxByTarget.get(card.targetRef)
    });
    summary.cards += 1;
    summary.inboxItems += 1;
  }
  return summary;
}

function buildPreparedClaudeCardDraft(db: LooDatabase, row: ClaudePreparedSessionRow): PreparedCardDraft | null {
  const sessionId = safeClaudeSessionId(String(row.sessionId ?? ""));
  const targetRef = claudeSessionRef(sessionId);
  if (!isPublicPreparedSourceRef(targetRef)) return null;

  const sourceRefs = unique([
    targetRef,
    row.sourcePath,
    ...parseSourceRefsJson(row.sourceRefsJson)
  ].filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0))
    .filter(isPublicPreparedSourceRef)
    .slice(0, 40);
  if (sourceRefs.length === 0) return null;

  const title = cleanPreparedCardField(row.title ?? row.project ?? "Claude Code session", {
    fallback: "Claude Code session",
    maxChars: 160,
    role: "title"
  });
  const summaryText = cleanPreparedCardField(claudePreparedCardSummarySource(row), {
    fallback: "Claude Code session indexed for local read/recall.",
    maxChars: 320,
    role: "summary"
  });
  const freshnessAt = latestIso([row.updatedAt, row.indexedAt]);
  const watcherObservationsStatus = watcherObservationCoverageForTarget(db, targetRef);
  const authorityCoverage: PreparedCard["authorityCoverage"] = {
    summaryLeaves: {
      status: "not_configured",
      leafCount: 0,
      rangeCount: 0
    },
    sessionMetadata: {
      status: "ok"
    },
    watcherObservations: {
      status: watcherObservationsStatus
    }
  };
  const state: PreparedCardState = "ready";
  const reasonCodes = unique([
    "claude_session_indexed",
    "metadata_only",
    "summary_leaves_not_configured",
    watcherObservationsStatus === "not_configured" ? "watcher_not_configured" : "watcher_observations_available",
    title.cleaned || summaryText.cleaned ? "presentation_cleaned" : "",
    title.lowConfidence || summaryText.lowConfidence ? "presentation_low_confidence" : ""
  ].filter(Boolean));
  const confidence = title.lowConfidence || summaryText.lowConfidence ? 0.49 : 0.72;
  const inputHash = stableId(JSON.stringify({
    targetRef,
    title: title.text,
    summaryText: summaryText.text,
    sourceRefs,
    status: row.status,
    freshnessAt,
    watcherObservationsStatus,
    extractorVersion: PREPARED_CARD_EXTRACTOR_VERSION
  }));
  const cardId = stableId(`prepared-card:${targetRef}:${inputHash}`);
  return {
    schema: "lco.prepared.card.v1",
    cardId,
    cardRef: `prepared_card:${cardId}`,
    targetRef,
    cardKind: "claude_session",
    title: title.text,
    objective: null,
    summaryText: summaryText.text,
    blocker: null,
    nextAction: "Use bounded Claude recall before acting on this session.",
    sourceRefs,
    sourceRangeRefs: [],
    sourceRangeRefsOmitted: 0,
    authorityCoverage,
    sourceCoverage: preparedCardSourceCoverage(authorityCoverage),
    inputHash,
    extractorVersion: PREPARED_CARD_EXTRACTOR_VERSION,
    privacyClass: "public_safe_metadata",
    confidence,
    freshnessAt,
    stale: false,
    state,
    reasonCodes: confidence < 0.5 ? unique([...reasonCodes, "low_confidence"]) : reasonCodes
  };
}

function materializePreparedCardsForLcmPeers(
  db: LooDatabase,
  paths: string[],
  generatedAt: string
): PreparedCardMaterializationReport["summary"] {
  const previousCards = db.prepare(`
    SELECT target_ref AS targetRef, card_ref AS cardRef, input_hash AS inputHash,
      created_at AS createdAt, updated_at AS updatedAt
    FROM prepared_cards
    WHERE target_ref LIKE 'lcm_summary:%'
      AND extractor_version = ?
      AND privacy_class = 'public_safe_metadata'
  `).all(PREPARED_CARD_EXTRACTOR_VERSION) as Array<PreviousPreparedCardWrite & { targetRef: string }>;
  const previousInbox = db.prepare(`
    SELECT target_ref AS targetRef, item_id AS itemRef, card_ref AS cardRef,
      created_at AS createdAt, updated_at AS updatedAt
    FROM prepared_inbox_items
    WHERE target_ref LIKE 'lcm_summary:%'
  `).all() as Array<PreviousPreparedInboxWrite & { targetRef: string }>;
  const previousCardByTarget = new Map(previousCards.map((row) => [row.targetRef, row]));
  const previousInboxByTarget = new Map(previousInbox.map((row) => [row.targetRef, row]));
  const cards = new Map<string, PreparedCardDraft>();
  const normalizedPaths = normalizePeerPaths(paths);
  const configuredPeerHashes = new Set(paths.flatMap((path) => {
    try {
      return [lcmPeerHash(path), legacyLcmPeerHash(path)];
    } catch {
      return [];
    }
  }));
  const refreshedPeerHashes = new Set<string>();
  let skippedUnsafeRows = 0;

  for (const path of normalizedPaths) {
    let peer: LooDatabase | null = null;
    try {
      peer = openLcmPeerDb(path);
      if (!tableExists(peer, "summaries")) continue;
      const rows = peer.prepare(`
        SELECT SUBSTR(summary_id, 1, ${LCM_SUMMARY_ID_MAX_CHARS + 1}) AS summaryId
        FROM summaries
        ORDER BY COALESCE(latest_at, created_at) DESC, summary_id ASC
        LIMIT ?
      `).all(LCM_PEER_SUMMARY_SCAN_MAX + 1) as Array<{ summaryId: string }>;
      const capped = rows.length > LCM_PEER_SUMMARY_SCAN_MAX;
      const peerCards = new Map<string, PreparedCardDraft>();
      if (capped) skippedUnsafeRows += 1;
      for (const row of rows.slice(0, LCM_PEER_SUMMARY_SCAN_MAX)) {
        const root = getLcmSummaryRecordFromDb(peer, path, String(row.summaryId ?? ""));
        if (!root) {
          skippedUnsafeRows += 1;
          continue;
        }
        const walked = walkLcmSummarySources(peer, path, root.summaryId);
        const expansion: LcmSummaryExpansion = {
          root,
          sourceSummaries: walked.sourceSummaries,
          reasonCodes: capped ? unique([...walked.reasonCodes, "lcm_peer_materialization_cap"]) : walked.reasonCodes
        };
        const card = buildPreparedLcmCardDraft(expansion);
        if (card) peerCards.set(card.targetRef, card);
        else skippedUnsafeRows += 1;
      }
      refreshedPeerHashes.add(lcmPeerHash(path));
      for (const [targetRef, card] of peerCards) cards.set(targetRef, card);
    } catch {
      // Retain the last derived cache for an unavailable configured peer. The
      // peer remains fail-closed and doctor reports its unavailable posture.
    } finally {
      peer?.close();
    }
  }

  const staleTargets = previousCards.map((row) => row.targetRef).filter((targetRef) => {
    const peerHash = lcmPeerHashFromRef(targetRef);
    return peerHash === null || !configuredPeerHashes.has(peerHash) || refreshedPeerHashes.has(peerHash);
  });
  deletePreparedCardsForTargetRefs(db, unique([
    ...staleTargets,
    ...cards.keys()
  ]));
  for (const card of cards.values()) {
    insertPreparedCardAndInbox(db, card, generatedAt, {
      previousCard: previousCardByTarget.get(card.targetRef),
      previousInbox: previousInboxByTarget.get(card.targetRef)
    });
  }
  return {
    summaryLeaves: [...cards.values()].reduce((count, card) => count + card.authorityCoverage.summaryLeaves.leafCount, 0),
    cards: cards.size,
    inboxItems: cards.size,
    skippedUnsafeRows
  };
}

function hasPreparedLcmState(db: LooDatabase): boolean {
  const card = db.prepare("SELECT 1 AS found FROM prepared_cards WHERE target_ref LIKE 'lcm_summary:%' LIMIT 1").get() as { found: number } | undefined;
  if (card?.found === 1) return true;
  const inbox = db.prepare("SELECT 1 AS found FROM prepared_inbox_items WHERE target_ref LIKE 'lcm_summary:%' LIMIT 1").get() as { found: number } | undefined;
  return inbox?.found === 1;
}

function buildPreparedLcmCardDraft(expansion: LcmSummaryExpansion): PreparedCardDraft | null {
  const targetRef = lcmSummaryRef(expansion.root.sourcePath, expansion.root.summaryId);
  if (!isPublicPreparedSourceRef(targetRef)) return null;
  const sourceRefs = unique([
    targetRef,
    ...expansion.sourceSummaries.map((summary) => lcmSummaryRef(summary.sourcePath, summary.summaryId))
  ]).filter(isPublicPreparedSourceRef).slice(0, 40);
  if (sourceRefs.length === 0) return null;
  const title = cleanPreparedCardField(
    expansion.root.conversationTitle ?? `LCM summary ${expansion.root.summaryId}`,
    { fallback: "LCM summary", maxChars: 160, role: "title" }
  );
  const summaryText = cleanPreparedCardField(expansion.root.content, {
    fallback: "LCM summary is empty or unavailable for prepared recall.",
    maxChars: 320,
    role: "summary"
  });
  const degraded = expansion.reasonCodes.length > 0 || summaryText.lowConfidence;
  const state: PreparedCardState = degraded ? "stale_or_partial" : "ready";
  const authorityCoverage: PreparedCard["authorityCoverage"] = {
    summaryLeaves: {
      status: degraded ? "partial" : "ok",
      leafCount: Math.max(1, expansion.sourceSummaries.length),
      rangeCount: expansion.sourceSummaries.length
    },
    sessionMetadata: { status: "ok" },
    watcherObservations: { status: "not_configured" }
  };
  const freshnessAt = latestIso([
    expansion.root.updatedAt,
    expansion.root.createdAt,
    ...expansion.sourceSummaries.flatMap((summary) => [summary.updatedAt, summary.createdAt])
  ]);
  const reasonCodes = unique([
    "lcm_summary_prepared",
    "metadata_only",
    "watcher_not_configured",
    ...expansion.reasonCodes,
    title.cleaned || summaryText.cleaned ? "presentation_cleaned" : "",
    degraded ? "authority_partial" : "summary_leaves_ready"
  ].filter(Boolean));
  const confidence = degraded ? 0.49 : 0.86;
  const inputHash = stableId(JSON.stringify({
    targetRef,
    sourceRefs,
    title: title.text,
    summaryText: summaryText.text,
    freshnessAt,
    reasonCodes,
    extractorVersion: PREPARED_CARD_EXTRACTOR_VERSION
  }));
  const cardId = stableId(`prepared-card:${targetRef}:${inputHash}`);
  return {
    schema: "lco.prepared.card.v1",
    cardId,
    cardRef: `prepared_card:${cardId}`,
    targetRef,
    cardKind: "lcm_summary",
    title: title.text,
    objective: null,
    summaryText: summaryText.text,
    blocker: null,
    nextAction: "Use bounded LCM expansion before acting on this peer summary.",
    sourceRefs,
    sourceRangeRefs: [],
    sourceRangeRefsOmitted: expansion.reasonCodes.filter((code) => code.includes("omitted") || code.includes("cap") || code.includes("truncated") || code.includes("missing")).length,
    authorityCoverage,
    sourceCoverage: preparedCardSourceCoverage(authorityCoverage),
    inputHash,
    extractorVersion: PREPARED_CARD_EXTRACTOR_VERSION,
    privacyClass: "public_safe_metadata",
    confidence,
    freshnessAt,
    stale: false,
    state,
    reasonCodes
  };
}

function claudePreparedCardSummarySource(row: ClaudePreparedSessionRow): string {
  const summaryLines = typeof row.safeSummary === "string" ? row.safeSummary.split(/\r?\n/) : [];
  const textLines = typeof row.safeText === "string" ? row.safeText.split(/\r?\n/) : [];
  const summaryCandidates = summaryLines
    .map((line) => line.trim())
    .filter(Boolean);
  const textCandidates = textLines
    .map((line) => line.trim())
    .filter(Boolean);
  const stableSummary = summaryCandidates[0];
  const preferredText = textCandidates.find((line) =>
    /\b(?:summary|final|handoff|closeout|complete|completed|ready|marker)\b/i.test(line)
  );
  return stableSummary ?? row.title ?? preferredText ?? textCandidates[0] ?? "Claude Code session indexed for local read/recall.";
}

export function getPreparedStateStatus(db: LooDatabase, options: PreparedStateStatusOptions = {}): PreparedStateStatusReport {
  const leaves = Number((db.prepare(`
    SELECT COUNT(*) AS count
    FROM summary_leaves
    WHERE extractor_version = ?
      AND privacy_class = 'public_safe_metadata'
      AND omission_status = 'metadata_only'
  `).get(SUMMARY_LEAF_EXTRACTOR_VERSION) as { count: number }).count);
  const cardsReport = getPreparedCards(db, { limit: 1 });
  const inboxReport = getPreparedInbox(db, { limit: 1 });
  const targetCoverage = getPreparedTargetCoverage(db, options.threadId);
  return {
    schema: "lco.preparedState.status.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt: new Date().toISOString(),
    sourceCoverage: {
      summaryLeaves: preparedSummaryLeafCoverage(db),
      preparedCards: cardsReport.sourceCoverage.preparedCards,
      preparedInboxItems: inboxReport.sourceCoverage.preparedInboxItems,
      watcherObservations: watcherObservationCoverage(db)
    },
    ...(targetCoverage ? { targetCoverage } : {}),
    summary: {
      summaryLeaves: leaves,
      cards: cardsReport.summary.total,
      inboxItems: inboxReport.summary.total,
      staleCards: cardsReport.summary.stale,
      partialCards: cardsReport.summary.partial,
      unknownCards: cardsReport.summary.unknown,
      lowConfidenceCards: cardsReport.summary.lowConfidence
    },
    actionsPerformed: preparedCardReadActions(),
    proofBoundary: "Prepared-state status reports only LCO-owned public-safe derived-cache coverage and counts. It does not read raw transcripts, run model compaction, mutate source stores, perform live control, perform GUI actions, or treat prepared cache as source authority."
  };
}

export function getPreparedCards(db: LooDatabase, options: PreparedCardsOptions = {}): PreparedCardsReport {
  const limit = clamp(options.limit ?? 50, 1, 500);
  const clauses = [
    "extractor_version = ?",
    "privacy_class = ?"
  ];
  const params: Array<string | number> = [PREPARED_CARD_EXTRACTOR_VERSION, "public_safe_metadata"];
  if (options.threadId) {
    clauses.push("target_ref = ?");
    params.push(codexThreadRef(options.threadId));
  }
  if (options.state) {
    clauses.push("state = ?");
    params.push(options.state);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM prepared_cards ${where}`).get(...params) as { count: number }).count);
  const rows = db.prepare(`
    SELECT
      card_ref AS cardRef,
      target_ref AS targetRef,
      card_kind AS cardKind,
      title,
      objective,
      summary_text AS summaryText,
      blocker,
      next_action AS nextAction,
      source_refs_json AS sourceRefsJson,
      source_range_refs_json AS sourceRangeRefsJson,
      source_range_refs_omitted AS sourceRangeRefsOmitted,
      authority_coverage_json AS authorityCoverageJson,
      input_hash AS inputHash,
      extractor_version AS extractorVersion,
      privacy_class AS privacyClass,
      confidence,
      freshness_at AS freshnessAt,
      stale,
      state,
      reason_codes_json AS reasonCodesJson
    FROM prepared_cards
    ${where}
    ORDER BY stale DESC, confidence ASC, freshness_at DESC, target_ref ASC, card_ref ASC
  `).all(...params) as PreparedCardRow[];
  const validCards: PreparedCard[] = [];
  let filteredUnsafeRows = 0;
  let stale = 0;
  let partial = 0;
  let unknown = 0;
  let completed = 0;
  let lowConfidence = 0;
  for (const row of rows) {
    const card = publicPreparedCardFromRow(row);
    if (!card) {
      filteredUnsafeRows += 1;
      continue;
    }
    if (card.stale || card.state === "stale") stale += 1;
    if (preparedCardCountsAsPartialSummary(card.state)) partial += 1;
    if (card.state === "unknown" || card.state === "unknown_lifecycle") unknown += 1;
    if (card.state === "completed") completed += 1;
    if (card.confidence < 0.5) lowConfidence += 1;
    if (validCards.length < limit) validCards.push(card);
  }
  const validTotal = rows.length - filteredUnsafeRows;
  const limitOmissions = Math.max(0, validTotal - validCards.length);
  const omittedReasons = [
    limitOmissions > 0 ? "limit" : null,
    filteredUnsafeRows > 0 ? "filtered_unsafe_rows" : null
  ].filter((reason): reason is "limit" | "filtered_unsafe_rows" => Boolean(reason));
  const targetCoverage = getPreparedTargetCoverage(db, options.threadId);
  const summaryLeavesCoverage = preparedSummaryLeafCoverage(db, options.threadId);
  const preparedCardsCoverage: PreparedStateCoverage = filteredUnsafeRows > 0
    ? "partial"
    : validTotal > 0
      ? "ok"
      : total > 0 || summaryLeavesCoverage === "ok" || summaryLeavesCoverage === "partial"
        ? "partial"
        : "not_configured";
  return {
    schema: "lco.prepared.cards.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt: new Date().toISOString(),
    sourceCoverage: {
      preparedCards: preparedCardsCoverage,
      summaryLeaves: summaryLeavesCoverage,
      watcherObservations: options.threadId ? watcherObservationCoverageForTarget(db, codexThreadRef(options.threadId)) : watcherObservationCoverage(db)
    },
    ...(targetCoverage ? { targetCoverage } : {}),
    summary: {
      total: validTotal,
      returned: validCards.length,
      stale,
      partial,
      unknown,
      completed,
      lowConfidence
    },
    cards: validCards,
    omitted: {
      count: limitOmissions + filteredUnsafeRows,
      reason: omittedReasons.length === 2 ? "limit_and_filtered_unsafe_rows" : omittedReasons[0] ?? "none",
      reasons: omittedReasons.length ? omittedReasons : ["none"],
      limitCount: limitOmissions,
      filteredUnsafeRows
    },
    actionsPerformed: preparedCardReadActions(),
    proofBoundary: "Prepared cards are public-safe advisory cache rows over summary leaves and session metadata. They expose opaque refs, coverage, confidence, and bounded text only; they do not expose raw transcript text, local paths, secrets, source-store mutation, live control, GUI mutation, external writes, model compaction, or true Codex compaction-summary capture."
  };
}

export function getPreparedInbox(db: LooDatabase, options: PreparedInboxOptions = {}): PreparedInboxReport {
  const limit = clamp(options.limit ?? 25, 1, 200);
  const clauses = ["execute_false = 1"];
  const params: Array<string | number> = [];
  if (options.threadId) {
    clauses.push("target_ref = ?");
    params.push(codexThreadRef(options.threadId));
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const rows = db.prepare(`
    SELECT
      item_id AS itemRef,
      card_ref AS cardRef,
      target_ref AS targetRef,
      urgency_score AS urgencyScore,
      state,
      reason_codes_json AS reasonCodesJson,
      source_refs_json AS sourceRefsJson,
      execute_false AS executeFalse
    FROM prepared_inbox_items
    ${where}
    ORDER BY urgency_score DESC, state ASC, target_ref ASC, card_ref ASC
  `).all(...params) as PreparedInboxRow[];
  const validItems: PreparedInboxItem[] = [];
  const candidateItems = rows.map(publicPreparedInboxItemFromRow).filter((item): item is PreparedInboxItem => Boolean(item));
  const cardByRef = getPublicPreparedCardsByCardRef(db, candidateItems.map((item) => item.cardRef));
  let validTotal = 0;
  let critical = 0;
  let high = 0;
  let lowConfidence = 0;
  for (const item of candidateItems) {
    if (!cardByRef.has(item.cardRef)) continue;
    validTotal += 1;
    if (item.urgencyScore >= 90) critical += 1;
    if (item.urgencyScore >= 70 && item.urgencyScore < 90) high += 1;
    if (item.reasonCodes.includes("low_confidence")) lowConfidence += 1;
    if (validItems.length < limit) validItems.push(item);
  }
  const cardsCoverage = getPreparedCards(db, { threadId: options.threadId, limit: 1 }).sourceCoverage.preparedCards;
  const targetCoverage = getPreparedTargetCoverage(db, options.threadId);
  const inboxCoverage: PreparedStateCoverage = validTotal > 0 ? "ok" : rows.length > 0 || cardsCoverage === "partial" ? "partial" : "not_configured";
  return {
    schema: "lco.prepared.inbox.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt: new Date().toISOString(),
    sourceCoverage: {
      preparedInboxItems: inboxCoverage,
      preparedCards: cardsCoverage,
      summaryLeaves: preparedSummaryLeafCoverage(db, options.threadId),
      watcherObservations: options.threadId ? watcherObservationCoverageForTarget(db, codexThreadRef(options.threadId)) : watcherObservationCoverage(db)
    },
    ...(targetCoverage ? { targetCoverage } : {}),
    summary: {
      total: validTotal,
      returned: validItems.length,
      critical,
      high,
      lowConfidence
    },
    items: validItems,
    omitted: {
      count: Math.max(0, validTotal - validItems.length),
      reason: validTotal > validItems.length ? "limit" : "none"
    },
    actionsPerformed: preparedCardReadActions(),
    proofBoundary: "Prepared inbox is a deterministic execute=false attention queue over public-safe prepared cards. It does not read raw transcripts, run model compaction, mutate source stores, perform live control, perform GUI actions, external writes, npm publish, or GitHub Release creation."
  };
}

export function captureCloseoutHookPacket(db: LooDatabase, input: CloseoutHookCaptureInput): HookCaptureReport {
  const generatedAt = new Date().toISOString();
  const resolved = resolveHookTarget(input);
  const lastAssistantMessage = hookStringInput(input.lastAssistantMessage ?? input.last_assistant_message);
  const transcriptPath = hookStringInput(input.transcriptPath ?? input.transcript_path);
  const closeout = extractHookCloseout(lastAssistantMessage);
  const payloadHash = hookPayloadHash({
    hookKind: "closeout_capture",
    targetRef: resolved.targetRef,
    turnId: resolved.turnId,
    eventId: resolved.eventId,
    transcriptPath,
    lastAssistantMessage
  });
  const packetId = stableId(`hook:closeout:${resolved.targetRef}:${payloadHash}`);
  const sourceRefs = hookSourceRefs(resolved.targetRef, Object.values(closeout.fields).join("\n"));
  const omissions = [
    transcriptPath ? "transcript_path_hash_only" : null,
    lastAssistantMessage ? "message_hash_only" : null,
    closeout.textHash ? "closeout_text_hash_only" : null,
    closeout.truncated ? "closeout_text_truncated" : null
  ].filter((item): item is string => Boolean(item));
  const packet: HookCapturePacket = {
    schema: "lco.hookCapturePacket.v1",
    packetId,
    hookKind: "closeout_capture",
    targetRef: resolved.targetRef,
    threadId: resolved.threadId,
    turnId: resolved.turnId,
    eventId: resolved.eventId,
    payloadHash,
    payload: {
      transcriptPathHash: transcriptPath ? stableId(transcriptPath) : null,
      transcriptPathRedacted: Boolean(transcriptPath),
      messageHash: lastAssistantMessage ? stableId(lastAssistantMessage) : null,
      messageRedacted: Boolean(lastAssistantMessage),
      messagePreview: null,
      closeout,
      omissions
    },
    sourceRefs,
    privacyClass: "public_safe_metadata",
    confidence: closeout.present ? 0.82 : 0.46,
    createdAt: generatedAt,
    reasonCodes: unique([
      "hook_sidecar_capture",
      "derived_cache_only",
      lastAssistantMessage ? "message_hash_only" : "",
      closeout.present ? "closeout_envelope_present" : "closeout_envelope_missing",
      closeout.textHash ? "closeout_text_hash_only" : "",
      closeout.truncated ? "closeout_text_truncated" : "",
      transcriptPath ? "transcript_path_hash_only" : "transcript_path_absent"
    ].filter(Boolean))
  };
  const inserted = insertHookCapturePacket(db, packet);
  return hookCaptureReport(packet, inserted, generatedAt, [
    ...hookPublicSafetyBlockers(packet),
    closeout.present ? null : "closeout_envelope_missing"
  ].filter((item): item is string => Boolean(item)), "Closeout hook capture writes only a sanitized LCO-owned derived-cache packet from bounded hook payloads. It hashes/redacts transcript paths, does not open transcript paths, does not mutate Codex source stores, does not run live control, does not mutate a GUI, does not write external systems, and does not run model compaction.");
}

export function captureCompactionMarkerHookPacket(db: LooDatabase, input: CompactionMarkerHookInput): HookCaptureReport {
  if (input.mode !== "marker") throw new Error("compaction-capture currently supports --mode marker only");
  const generatedAt = new Date().toISOString();
  const lifecycle = normalizeCompactionLifecycle(input.lifecycle);
  const resolved = resolveHookTarget(input);
  const transcriptPath = hookStringInput(input.transcriptPath ?? input.transcript_path);
  const markerNote = hookStringInput(input.markerNote ?? input.marker_note);
  const summary = hookStringInput(input.summary);
  const payloadHash = hookPayloadHash({
    hookKind: "compaction_marker",
    targetRef: resolved.targetRef,
    turnId: resolved.turnId,
    eventId: resolved.eventId,
    transcriptPath,
    lifecycle,
    mode: input.mode,
    markerNote,
    summaryHash: summary ? stableId(summary) : null
  });
  const packetId = stableId(`hook:compaction:${resolved.targetRef}:${payloadHash}`);
  const packet: HookCapturePacket = {
    schema: "lco.hookCapturePacket.v1",
    packetId,
    hookKind: "compaction_marker",
    targetRef: resolved.targetRef,
    threadId: resolved.threadId,
    turnId: resolved.turnId,
    eventId: resolved.eventId,
    payloadHash,
    payload: {
      transcriptPathHash: transcriptPath ? stableId(transcriptPath) : null,
      transcriptPathRedacted: Boolean(transcriptPath),
      mode: "marker",
      lifecycle,
      markerNote: null,
      markerNoteHash: markerNote ? stableId(markerNote) : null,
      summaryCaptured: false,
      omissions: unique([
        transcriptPath ? "transcript_path_hash_only" : "",
        summary ? "summary_payload_not_captured_marker_mode" : "",
        markerNote ? "marker_note_hash_only" : ""
      ].filter(Boolean))
    },
    sourceRefs: hookSourceRefs(resolved.targetRef, markerNote ?? ""),
    privacyClass: "public_safe_metadata",
    confidence: 0.72,
    createdAt: generatedAt,
    reasonCodes: unique([
      "hook_sidecar_capture",
      "derived_cache_only",
      "compaction_marker_only",
      lifecycle
    ])
  };
  const inserted = insertHookCapturePacket(db, packet);
  return hookCaptureReport(packet, inserted, generatedAt, hookPublicSafetyBlockers(packet), "Compaction hook capture records PreCompact/PostCompact lifecycle markers only. True compaction-summary capture is not claimed; it requires Codex-native sanitized event support or a separately proven adapter. This packet writes only LCO-owned derived cache and never reads raw transcripts, runs model compaction, mutates source stores, performs live control, mutates a GUI, or writes external systems.");
}

export function captureThreadTitleFinalizerHookPacket(db: LooDatabase, input: ThreadTitleFinalizerInput): ThreadTitleFinalizerReport {
  const generatedAt = new Date().toISOString();
  const resolved = resolveHookTarget(input);
  const transcriptPath = hookStringInput(input.transcriptPath ?? input.transcript_path);
  const existingAlias = resolved.threadId ? getThreadTitleAlias(db, resolved.threadId, "thread_title_finalizer") : null;
  const indexedSignal = resolved.threadId ? getThreadTitleIndexedSignal(db, resolved.threadId) : null;
  const currentTitle = hookStringInput(input.currentTitle ?? input.current_title) ?? indexedSignal?.title ?? null;
  const titleDraft = existingAlias
    ? {
      suggestedTitle: existingAlias.aliasText,
      repoOrProject: repoOrProjectFromTitle(existingAlias.aliasText),
      summary: summaryFromSuggestedTitle(existingAlias.aliasText),
      state: "already_finalized" as ThreadTitleFinalizerState,
      sourceSignals: ["existing_title_alias"]
    }
    : deriveThreadTitleDraft(input, indexedSignal);
  const payloadHash = hookPayloadHash({
    hookKind: "thread_title_finalizer",
    targetRef: resolved.targetRef,
    transcriptPathHash: transcriptPath ? stableId(transcriptPath) : null,
    existingTitleHash: currentTitle ? stableId(currentTitle) : null,
    suggestedTitleHash: titleDraft.suggestedTitle ? stableId(titleDraft.suggestedTitle) : null,
    state: titleDraft.state
  });
  const packetId = stableId(`hook:thread-title-finalizer:${resolved.targetRef}:v1`);
  const omissions = unique([
    transcriptPath ? "transcript_path_hash_only" : "",
    currentTitle ? "current_title_hash_only" : "",
    input.lastAssistantMessage || input.last_assistant_message ? "assistant_message_hash_only" : "",
    input.userMessage || input.user_message || input.userMessages || input.user_messages ? "user_message_hash_only" : "",
    titleDraft.suggestedTitle ? "" : "title_signal_insufficient"
  ].filter(Boolean));
  const packet: HookCapturePacket = {
    schema: "lco.hookCapturePacket.v1",
    packetId,
    hookKind: "thread_title_finalizer",
    targetRef: resolved.targetRef,
    threadId: resolved.threadId,
    turnId: resolved.turnId,
    eventId: resolved.eventId,
    payloadHash,
    payload: {
      transcriptPathHash: transcriptPath ? stableId(transcriptPath) : null,
      transcriptPathRedacted: Boolean(transcriptPath),
      titleFinalizer: {
        suggestedTitle: titleDraft.suggestedTitle,
        suggestedTitleHash: titleDraft.suggestedTitle ? stableId(titleDraft.suggestedTitle) : null,
        repoOrProject: titleDraft.repoOrProject,
        summary: titleDraft.summary,
        state: titleDraft.state,
        aliasKind: "thread_title_finalizer",
        sourceSignals: titleDraft.sourceSignals
      },
      omissions
    },
    sourceRefs: hookSourceRefs(resolved.targetRef, titleDraft.suggestedTitle ?? ""),
    privacyClass: "public_safe_metadata",
    confidence: titleDraft.suggestedTitle ? 0.76 : 0.28,
    createdAt: generatedAt,
    reasonCodes: unique([
      "hook_sidecar_capture",
      "derived_cache_only",
      "thread_title_finalizer",
      "canonical_title_preserved",
      titleDraft.state,
      transcriptPath ? "transcript_path_hash_only" : "transcript_path_absent"
    ].filter(Boolean))
  };
  const inserted = titleDraft.suggestedTitle && !existingAlias ? insertHookCapturePacket(db, packet) : false;
  const aliasInserted = Boolean(inserted && resolved.threadId && titleDraft.suggestedTitle && insertThreadTitleAlias(db, {
    threadId: resolved.threadId,
    targetRef: resolved.targetRef,
    aliasText: titleDraft.suggestedTitle,
    sourcePacketId: packet.packetId,
    reasonCodes: packet.reasonCodes,
    confidence: packet.confidence,
    generatedAt
  }));
  const blockers = [
    ...hookPublicSafetyBlockers(packet),
    titleDraft.suggestedTitle ? null : "title_signal_insufficient",
    resolved.threadId ? null : "thread_id_missing"
  ].filter((item): item is string => Boolean(item));
  return {
    schema: "lco.threadTitleFinalizer.v1",
    publicSafe: true,
    readOnly: false,
    mutationClasses: ["derived_cache"],
    generatedAt,
    inserted: Boolean(inserted),
    aliasInserted,
    title: {
      suggestedTitle: titleDraft.suggestedTitle,
      state: titleDraft.state,
      repoOrProject: titleDraft.repoOrProject,
      summary: titleDraft.summary,
      existingTitle: null
    },
    packet,
    blockers: unique(blockers),
    actionsPerformed: hookSidecarActions(),
    proofBoundary: "Thread title finalizer hooks write only a one-shot public-safe LCO title alias for local indexing/search. They preserve the canonical Codex title, hash/redact transcript paths, do not open transcript paths, do not mutate Codex source stores, do not run live control, do not mutate a GUI, do not write external systems, and do not add an agent-facing naming tool."
  };
}

export function runStatePrepHook(db: LooDatabase, input: StatePrepHookInput = {}): StatePrepHookReport {
  const generatedAt = new Date().toISOString();
  const resolved = resolveHookTarget(input);
  const limit = clamp(input.limit ?? 5, 1, 25);
  const status = getPreparedStateStatus(db);
  const threadId = resolved.threadId ?? undefined;
  const cards = getPreparedCards(db, { threadId, limit });
  const inbox = getPreparedInbox(db, { threadId, limit });
  const leaves = getSummaryLeaves(db, { threadId, limit });
  const inputHash = hookPayloadHash({
    hookKind: "state_prep",
    targetRef: resolved.targetRef,
    threadId: resolved.threadId,
    limit,
    payloadHash: input.payload ? stableId(canonicalJsonString(input.payload)) : null
  });
  const packet = {
    schema: "lco.hook.statePrepPacket.v1" as const,
    targetRef: resolved.targetRef,
    inputHash,
    limits: {
      cards: limit,
      inboxItems: limit,
      summaryLeaves: limit
    },
    preparedState: {
      status
    },
    preparedCards: cards,
    preparedInbox: inbox,
    summaryLeaves: leaves,
    omissions: unique([
      cards.omitted.count > 0 ? "prepared_cards_omitted" : "",
      inbox.omitted.count > 0 ? "prepared_inbox_omitted" : "",
      leaves.omitted.count > 0 ? "summary_leaves_omitted" : "",
      input.payload ? "hook_payload_hash_only" : ""
    ].filter(Boolean))
  };
  const outputHash = stableId(canonicalJsonString(packet));
  const jobId = stableId(`state-prep:${resolved.targetRef}:${inputHash}`);
  const inserted = insertStatePrepJob(db, {
    jobId,
    targetRef: resolved.targetRef,
    inputHash,
    outputHash,
    generatedAt
  });
  const report: StatePrepHookReport = {
    schema: "lco.hook.statePrep.v1",
    publicSafe: true,
    readOnly: false,
    mutationClasses: ["derived_cache"],
    generatedAt,
    inserted,
    job: {
      jobId,
      jobKind: "state_prep",
      status: "complete",
      targetRef: resolved.targetRef,
      inputHash,
      outputHash,
      mutationClasses: ["derived_cache"]
    },
    packet,
    blockers: hookPublicSafetyBlockers(packet),
    actionsPerformed: hookSidecarActions(),
    proofBoundary: "State-prep hooks generate bounded packets from existing LCO prepared-state reports only and persist a local state_prep_jobs derived-cache row. They do not read raw transcripts, open transcript paths, run model compaction, mutate Codex source stores, perform live control, mutate a GUI, or write external systems."
  };
  return report;
}

type SummaryLeafDraft = SummaryLeaf & { leafId: string };
type PreparedCardDraft = PreparedCard & { cardId: string };

type PreparedCardRow = {
  cardRef: string;
  targetRef: string;
  cardKind: string;
  title: string;
  objective: string | null;
  summaryText: string;
  blocker: string | null;
  nextAction: string | null;
  sourceRefsJson: string;
  sourceRangeRefsJson: string;
  sourceRangeRefsOmitted: number;
  authorityCoverageJson: string;
  inputHash: string;
  extractorVersion: string;
  privacyClass: string;
  confidence: number;
  freshnessAt: string | null;
  stale: number;
  state: string;
  reasonCodesJson: string;
};

type PreviousPreparedCardWrite = {
  cardRef: string;
  inputHash: string;
  createdAt: string;
  updatedAt: string;
};

type PreviousPreparedInboxWrite = {
  itemRef: string;
  cardRef: string;
  createdAt: string;
  updatedAt: string;
};

type PreparedInboxRow = {
  itemRef: string;
  cardRef: string;
  targetRef: string;
  urgencyScore: number;
  state: string;
  reasonCodesJson: string;
  sourceRefsJson: string;
  executeFalse: number;
};

function buildPreparedCardDraft(
  db: LooDatabase,
  threadId: string,
  leaves: SummaryLeaf[],
  filteredUnsafeRows: number,
  lookupCache?: PreparedCardWorkStateLookupCache
): PreparedCardDraft {
  const targetRef = codexThreadRef(threadId);
  const session = db.prepare(`
    SELECT title, summary, final_message AS finalMessage, updated_at AS updatedAt
    FROM codex_sessions
    WHERE thread_id = ?
  `).get(threadId) as { title: string | null; summary: string | null; finalMessage: string | null; updatedAt: string | null } | undefined;
  const metadata = getSessionMetadata(db, threadId);
  const sessionMetadataStatus: PreparedStateCoverage = session
    ? sessionMetadataHasAnyValue(metadata) ? "ok" : "partial"
    : "not_configured";
  const authorityStatuses = leaves.map((leaf) => String(leaf.authorityCoverage.status ?? "unknown"));
  const leafRangeCount = leaves.reduce((count, leaf) => count + summaryLeafAuthorityRangeCount(leaf.authorityCoverage), 0);
  const summaryLeavesStatus: PreparedStateCoverage = leaves.length === 0
    ? "not_configured"
    : authorityStatuses.includes("unknown")
      ? "unknown"
      : filteredUnsafeRows > 0 || authorityStatuses.includes("partial")
        ? "partial"
        : "ok";
  const watcherObservationsStatus = watcherObservationCoverageForTarget(db, targetRef);
  const freshnessAt = latestIso([...leaves.map((leaf) => leaf.freshnessAt), session?.updatedAt ?? null]);
  const stale = leaves.some((leaf) => leaf.stale);
  const evidenceState: PreparedCardState = stale
    ? "stale_or_partial"
    : summaryLeavesStatus === "unknown"
      ? "unknown_lifecycle"
      : summaryLeavesStatus === "partial" || sessionMetadataStatus === "partial"
        ? "stale_or_partial"
        : "ready";
  const lifecycle = preparedLifecycleFromMetadata(metadata, evidenceState);
  const state = lifecycle.state;
  const workState = derivePreparedCardWorkState(db, {
    threadId,
    targetRef,
    session,
    metadata,
    state,
    lookupCache
  });
  const reasonCodes = unique([
    leaves.length > 0 ? "summary_leaves_ready" : "summary_leaves_missing",
    "metadata_only",
    ...workState.reasonCodes,
    ...lifecycle.reasonCodes,
    watcherObservationsStatus === "not_configured" ? "watcher_not_configured" : "watcher_observations_available",
    stale ? "stale_cache" : "",
    summaryLeavesStatus === "partial" ? "authority_partial" : "",
    summaryLeavesStatus === "unknown" ? "authority_unknown" : "",
    sessionMetadataStatus === "partial" ? "session_metadata_partial" : "",
    watcherObservationsStatus === "partial" ? "watcher_observations_partial" : "",
    watcherObservationsStatus === "unknown" ? "watcher_observations_unknown" : "",
    filteredUnsafeRows > 0 ? "filtered_unsafe_rows" : ""
  ].filter(Boolean));
  const averageLeafConfidence = leaves.length
    ? leaves.reduce((sum, leaf) => sum + leaf.confidence, 0) / leaves.length
    : 0.3;
  const confidence = workState.lowConfidence
    ? Math.min(preparedCardConfidence(averageLeafConfidence, state, evidenceState), 0.49)
    : preparedCardConfidence(averageLeafConfidence, state, evidenceState);
  const sourceRangeRefsFull = unique(leaves.flatMap((leaf) => leaf.sourceRangeRefs));
  const sourceRangeRefs = sourceRangeRefsFull.slice(0, PREPARED_CARD_SOURCE_RANGE_REF_LIMIT);
  const sourceRangeRefsOmitted = Math.max(0, sourceRangeRefsFull.length - sourceRangeRefs.length)
    + leaves.reduce((count, leaf) => count + leaf.sourceRangeRefsOmitted, 0);
  const sourceRefs = unique([targetRef, ...workState.sourceRefs, ...leaves.map((leaf) => leaf.leafRef), ...leaves.flatMap((leaf) => leaf.sourceRefs)])
    .filter(isPublicPreparedSourceRef)
    .slice(0, 40);
  const authorityCoverage: PreparedCard["authorityCoverage"] = {
    summaryLeaves: {
      status: summaryLeavesStatus,
      leafCount: leaves.length,
      rangeCount: Math.max(0, leafRangeCount)
    },
    sessionMetadata: {
      status: sessionMetadataStatus
    },
    watcherObservations: {
      status: watcherObservationsStatus
    }
  };
  const inputHash = stableId(JSON.stringify({
    targetRef,
    leafRefs: leaves.map((leaf) => leaf.leafRef),
    inputHashes: leaves.map((leaf) => leaf.inputHash),
    outputHashes: leaves.map((leaf) => leaf.outputHash),
    metadataSignalHash: lifecycle.metadataSignalHash,
    lifecycleState: state,
    lifecycleReasonCodes: lifecycle.reasonCodes,
    title: workState.title,
    objective: workState.objective,
    blocker: workState.blocker,
    nextAction: workState.nextAction,
    summaryText: workState.summaryText,
    presentationReasonCodes: workState.reasonCodes,
    evidenceState,
    freshnessAt,
    stale,
    summaryLeavesStatus,
    sessionMetadataStatus,
    watcherObservationsStatus,
    extractorVersion: PREPARED_CARD_EXTRACTOR_VERSION
  }));
  const cardId = stableId(`prepared-card:${targetRef}:${inputHash}`);
  return {
    schema: "lco.prepared.card.v1",
    cardId,
    cardRef: `prepared_card:${cardId}`,
    targetRef,
    cardKind: "codex_session",
    title: workState.title,
    objective: workState.objective,
    summaryText: workState.summaryText,
    blocker: workState.blocker,
    nextAction: workState.nextAction,
    sourceRefs,
    sourceRangeRefs,
    sourceRangeRefsOmitted,
    authorityCoverage,
    sourceCoverage: preparedCardSourceCoverage(authorityCoverage),
    inputHash,
    extractorVersion: PREPARED_CARD_EXTRACTOR_VERSION,
    privacyClass: "public_safe_metadata",
    confidence,
    freshnessAt,
    stale,
    state,
    reasonCodes: confidence < 0.5 ? unique([...reasonCodes, "low_confidence"]) : reasonCodes
  };
}

type PreparedCardWorkState = {
  title: string;
  objective: string | null;
  summaryText: string;
  blocker: string | null;
  nextAction: string | null;
  sourceRefs: string[];
  reasonCodes: string[];
  lowConfidence: boolean;
};

type PreparedCardPlan = { text: string; ordinal: number };
type PreparedCardAttentionSignal = { blocker: string | null; reasonCodes: string[]; sourceRefs: string[] };
type PreparedCardWorkStateLookupCache = {
  threadRenameCapturedByThreadId: Map<string, boolean>;
  latestPlanByThreadId: Map<string, PreparedCardPlan | null>;
  attentionByTargetRef: Map<string, PreparedCardAttentionSignal>;
  touchedFilesByThreadId: Map<string, string[]>;
};

type PreparedCardWorkStateInput = {
  threadId: string;
  targetRef: string;
  session: { title: string | null; summary: string | null; finalMessage: string | null; updatedAt: string | null } | undefined;
  metadata: SessionMetadata;
  state: PreparedCardState;
  lookupCache?: PreparedCardWorkStateLookupCache;
};

type OptionalCardPresentationCleanResult = Omit<CardPresentationCleanResult, "text"> & {
  text: string | null;
};

function derivePreparedCardWorkState(db: LooDatabase, input: PreparedCardWorkStateInput): PreparedCardWorkState {
  const threadRenameCaptured = input.lookupCache?.threadRenameCapturedByThreadId.has(input.threadId)
    ? input.lookupCache.threadRenameCapturedByThreadId.get(input.threadId) === true
    : preparedThreadRenameCaptured(db, input.threadId);
  const title = cleanPreparedCardField(input.session?.title ?? input.threadId, {
    fallback: safeThreadId(input.threadId),
    maxChars: 160,
    role: "title"
  });
  const safeTitle = looksSensitiveRefLike(title.text) ? publicSafeText(safeThreadId(input.threadId), 160) : title.text;
  const latestPlan = input.lookupCache?.latestPlanByThreadId.has(input.threadId)
    ? input.lookupCache.latestPlanByThreadId.get(input.threadId) ?? null
    : getLatestPreparedCardPlan(db, input.threadId);
  const objectiveSource = latestPlan ? firstPreparedPlanLine(latestPlan.text) : null;
  const objective = cleanPreparedCardField(objectiveSource ?? input.session?.title ?? input.threadId, {
    fallback: safeTitle,
    maxChars: 260,
    role: "summary"
  });
  const objectiveText = presentationTextEquivalent(objective.text, safeTitle) ? null : objective.text;
  const finalMessage = input.session?.finalMessage && isLikelyFinal(input.session.finalMessage) ? input.session.finalMessage : null;
  const finalNextAction = finalMessage ? nextActionFromFinalMessage(finalMessage) : null;
  const planNextAction = latestPlan ? firstUncheckedPreparedPlanStep(latestPlan.text, [safeTitle, objectiveText]) : null;
  const nextActionSource = finalNextAction ? "from_final_message" : planNextAction ? "from_latest_plan" : null;
  const nextAction = cleanOptionalPreparedCardField(finalNextAction ?? planNextAction, {
    maxChars: 240,
    role: "nextAction"
  });
  const nextActionText = preparedCardActionOrNull(nextAction.text, [safeTitle, objectiveText]);
  const nextActionLowConfidence = nextAction.lowConfidence || (nextAction.text !== null && nextActionText === null);
  const nextActionCleaned = nextAction.cleaned || (nextAction.text !== null && nextActionText === null);
  const attention = input.lookupCache?.attentionByTargetRef.has(input.targetRef)
    ? input.lookupCache.attentionByTargetRef.get(input.targetRef)!
    : getPreparedCardAttentionSignal(db, input.targetRef);
  const metadataBlocker = hasRealBlocker(input.metadata.blocker) ? input.metadata.blocker : null;
  const blocker = cleanOptionalPreparedCardField(attention.blocker ?? metadataBlocker, {
    maxChars: 240,
    role: "summary"
  });
  const touchedFiles = input.lookupCache?.touchedFilesByThreadId.has(input.threadId)
    ? input.lookupCache.touchedFilesByThreadId.get(input.threadId)!
    : getCodexTouchedFiles(db, { threadId: input.threadId });
  const summaryText = preparedCardWorkSummary({
    state: input.state,
    objective: objectiveText,
    blocker: blocker.text,
    nextAction: nextActionText,
    finalMessage,
    touchedFiles
  });
  const reasonCodes = unique([
    threadRenameCaptured ? "from_thread_rename" : "from_thread_title",
    objectiveText ? objectiveSource ? "from_latest_plan" : "from_thread_title" : "",
    nextActionText && nextActionSource ? nextActionSource : "",
    finalMessage && input.state === "completed" ? "completed_from_final_message" : "",
    attention.blocker ? "from_attention_queue" : metadataBlocker ? "from_session_metadata" : "",
    ...attention.reasonCodes,
    title.cleaned || objective.cleaned || nextActionCleaned || blocker.cleaned ? "presentation_cleaned" : "",
    title.lowConfidence || objective.lowConfidence || nextActionLowConfidence || blocker.lowConfidence ? "presentation_low_confidence" : ""
  ].filter(Boolean));
  return {
    title: safeTitle,
    objective: objectiveText,
    summaryText,
    blocker: blocker.text,
    nextAction: nextActionText,
    sourceRefs: attention.sourceRefs,
    reasonCodes,
    lowConfidence: title.lowConfidence || objective.lowConfidence || nextActionLowConfidence || blocker.lowConfidence
  };
}

function buildPreparedCardWorkStateLookupCache(db: LooDatabase, threadIds: string[]): PreparedCardWorkStateLookupCache {
  const safeThreadIds = unique(threadIds.filter(isPublicSummaryThreadId));
  const threadRenameCapturedByThreadId = new Map<string, boolean>(safeThreadIds.map((threadId) => [threadId, false]));
  const latestPlanByThreadId = new Map<string, PreparedCardPlan | null>(safeThreadIds.map((threadId) => [threadId, null]));
  const latestPlanRowSeenByThreadId = new Set<string>();
  const attentionByTargetRef = new Map<string, PreparedCardAttentionSignal>(safeThreadIds.map((threadId) => [codexThreadRef(threadId), emptyPreparedCardAttentionSignal()]));
  const touchedFilesByThreadId = new Map<string, string[]>(safeThreadIds.map((threadId) => [threadId, []]));
  if (safeThreadIds.length === 0) {
    return {
      threadRenameCapturedByThreadId,
      latestPlanByThreadId,
      attentionByTargetRef,
      touchedFilesByThreadId
    };
  }

  for (const chunk of chunkForSqlIn(safeThreadIds)) {
    const placeholders = sqlPlaceholders(chunk.length);
    const renameRows = db.prepare(`
      SELECT DISTINCT thread_id AS threadId
      FROM prepared_source_events
      WHERE thread_id IN (${placeholders})
        AND event_kind = 'thread_name_updated'
        AND privacy_class = 'public_safe_metadata'
    `).all(...chunk) as Array<{ threadId: string | null }>;
    for (const row of renameRows) {
      const threadId = String(row.threadId ?? "");
      if (threadRenameCapturedByThreadId.has(threadId)) threadRenameCapturedByThreadId.set(threadId, true);
    }

    const planRows = db.prepare(`
      SELECT thread_id AS threadId, text, ordinal
      FROM codex_plans
      WHERE thread_id IN (${placeholders})
      ORDER BY thread_id ASC, ordinal DESC
    `).all(...chunk) as Array<{ threadId: string | null; text: string | null; ordinal: number | null }>;
    for (const row of planRows) {
      const threadId = String(row.threadId ?? "");
      if (!latestPlanByThreadId.has(threadId) || latestPlanRowSeenByThreadId.has(threadId)) continue;
      latestPlanRowSeenByThreadId.add(threadId);
      const text = row.text?.trim();
      if (text) latestPlanByThreadId.set(threadId, { text, ordinal: Number(row.ordinal ?? 0) });
    }

    const touchedRows = db.prepare(`
      SELECT thread_id AS threadId, path
      FROM codex_touched_files
      WHERE thread_id IN (${placeholders})
      ORDER BY thread_id ASC, path ASC
    `).all(...chunk) as Array<{ threadId: string | null; path: string | null }>;
    for (const row of touchedRows) {
      const threadId = String(row.threadId ?? "");
      const files = touchedFilesByThreadId.get(threadId);
      if (files && row.path) files.push(row.path);
    }
  }

  const targetRefs = safeThreadIds.map(codexThreadRef);
  for (const chunk of chunkForSqlIn(targetRefs)) {
    const placeholders = sqlPlaceholders(chunk.length);
    const rows = db.prepare(`
      SELECT target_ref AS targetRef, reason_codes_json AS reasonCodesJson, source_refs_json AS sourceRefsJson
      FROM attention_queue
      WHERE target_ref IN (${placeholders})
        AND execute_false = 1
        AND status NOT IN ('closed', 'resolved', 'dismissed')
      ORDER BY target_ref ASC, confidence DESC, updated_at DESC, queue_id ASC
    `).all(...chunk) as Array<{ targetRef: string | null; reasonCodesJson: string; sourceRefsJson: string }>;
    const grouped = new Map<string, Array<{ reasonCodesJson: string; sourceRefsJson: string }>>();
    for (const row of rows) {
      const targetRef = String(row.targetRef ?? "");
      if (!attentionByTargetRef.has(targetRef)) continue;
      const group = grouped.get(targetRef) ?? [];
      if (group.length < 3) {
        group.push({ reasonCodesJson: row.reasonCodesJson, sourceRefsJson: row.sourceRefsJson });
        grouped.set(targetRef, group);
      }
    }
    for (const [targetRef, group] of grouped) {
      attentionByTargetRef.set(targetRef, preparedCardAttentionSignalFromRows(group));
    }
  }

  return {
    threadRenameCapturedByThreadId,
    latestPlanByThreadId,
    attentionByTargetRef,
    touchedFilesByThreadId
  };
}

function sqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function chunkForSqlIn<T>(values: T[], size = 400): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function getLatestPreparedCardPlan(db: LooDatabase, threadId: string): { text: string; ordinal: number } | null {
  const row = db.prepare(`
    SELECT text, ordinal
    FROM codex_plans
    WHERE thread_id = ?
    ORDER BY ordinal DESC
    LIMIT 1
  `).get(threadId) as { text: string | null; ordinal: number | null } | undefined;
  const text = row?.text?.trim();
  return text ? { text, ordinal: Number(row?.ordinal ?? 0) } : null;
}

function firstPreparedPlanLine(planText: string): string | null {
  return preparedPlanStepCandidates(planText)[0]?.text ?? null;
}

function firstUncheckedPreparedPlanStep(planText: string, distinctFrom: Array<string | null>): string | null {
  const candidates = preparedPlanStepCandidates(planText).filter((candidate) => !candidate.checked && !candidate.heading);
  return candidates.find((candidate) =>
    isPreparedCardActionText(candidate.text)
    && !distinctFrom.some((existing) => presentationTextEquivalent(candidate.text, existing))
  )?.text ?? null;
}

function preparedPlanStepCandidates(planText: string): Array<{ text: string; checked: boolean; heading: boolean }> {
  const lineable = stripPlanEnvelopeTokens(planText).replace(/(?:^|\s+)((?:[-*+]|\d+[.)]|\[(?: |x|X)\])\s+)/g, "\n$1");
  return lineable
    .split(/\r?\n/)
    .map((line) => {
      const raw = line.trim();
      const heading = /^#{1,6}\s+/.test(raw);
      const checked = /^\s*(?:[-*+]\s*)?(?:\d+[.)]\s*)?\[[xX]\]/.test(raw);
      const text = raw
        .replace(/^#{1,6}\s+/, "")
        .replace(/^\s*(?:[-*+]\s*)?(?:\d+[.)]\s*)?\[(?: |x|X)\]\s*/, "")
        .replace(/^\s*(?:[-*+]\s*)?(?:\d+[.)]\s*)/, "")
        .replace(/^\s*[-*+]\s*/, "")
        .replace(/\s+#{1,6}\s+[A-Za-z0-9][\w\s:/.-]{0,100}$/i, "")
        .trim();
      return { text: cutEmbeddedHeadingMarker(text), checked, heading };
    })
    .filter((candidate) => candidate.text.length > 0 && !isMarkdownTableLine(candidate.text));
}

function nextActionFromFinalMessage(finalMessage: string): string | null {
  const labeled = extractRawLabeledValue(finalMessage, ["next action", "next"]);
  if (labeled) return firstFinalMessageClause(labeled);
  return null;
}

function firstFinalMessageClause(value: string): string | null {
  const cleaned = value
    .replace(/^(?:final|summary|closeout)\s*:\s*/i, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!cleaned) return null;
  return cleaned.match(/[^.!?]+[.!?]?/)?.[0]?.trim() ?? cleaned;
}

function getPreparedCardAttentionSignal(db: LooDatabase, targetRef: string): PreparedCardAttentionSignal {
  if (!isPublicPreparedSourceRef(targetRef)) return emptyPreparedCardAttentionSignal();
  const rows = db.prepare(`
    SELECT reason_codes_json AS reasonCodesJson, source_refs_json AS sourceRefsJson
    FROM attention_queue
    WHERE target_ref = ?
      AND execute_false = 1
      AND status NOT IN ('closed', 'resolved', 'dismissed')
    ORDER BY confidence DESC, updated_at DESC, queue_id ASC
    LIMIT 3
  `).all(targetRef) as Array<{ reasonCodesJson: string; sourceRefsJson: string }>;
  return preparedCardAttentionSignalFromRows(rows);
}

function preparedCardAttentionSignalFromRows(rows: Array<{ reasonCodesJson: string; sourceRefsJson: string }>): PreparedCardAttentionSignal {
  const reasonCodes = unique(rows.flatMap((row) => parseSourceRefsJson(row.reasonCodesJson))
    .map(publicSafePreparedAttentionReasonCode)
    .filter((code): code is string => Boolean(code)));
  const blockerCodes = reasonCodes.filter(isPreparedAttentionBlockerReasonCode);
  const blocker = blockerCodes.length ? blockerCodes.slice(0, 3).map(humanPreparedReasonCode).join("; ") : null;
  const sourceRefs = unique(rows.flatMap((row) => parseSourceRefsJson(row.sourceRefsJson))).filter(isPublicPreparedSourceRef).slice(0, 12);
  return { blocker, reasonCodes, sourceRefs };
}

function emptyPreparedCardAttentionSignal(): PreparedCardAttentionSignal {
  return { blocker: null, reasonCodes: [], sourceRefs: [] };
}

const PREPARED_ATTENTION_BLOCKER_REASON_CODES = new Set([
  "approval_required",
  "blocked",
  "build_failed",
  "changes_requested",
  "checks_failed",
  "ci_failed",
  "codeql_failed",
  "merge_blocked",
  "missing_info",
  "missing_operator_input",
  "missing_user_input",
  "package_install_failed",
  "publish_blocked",
  "release_blocked",
  "review_blocked",
  "security_blocked",
  "setup_required",
  "test_failed"
]);

function publicSafePreparedAttentionReasonCode(value: string): string | null {
  const trimmed = value.trim();
  if (!/^[a-z][a-z0-9]*(?:[_:-][a-z0-9]+)*$/.test(trimmed)) return null;
  return publicSafeIdentifier(trimmed);
}

function isPreparedAttentionBlockerReasonCode(code: string): boolean {
  return PREPARED_ATTENTION_BLOCKER_REASON_CODES.has(code);
}

function humanPreparedReasonCode(code: string): string {
  return code.replace(/^(?:attention|blocker|watcher|lifecycle)[_-]+/, "").replace(/[_-]+/g, " ").trim();
}

function preparedThreadRenameCaptured(db: LooDatabase, threadId: string): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM prepared_source_events
    WHERE thread_id = ?
      AND event_kind = 'thread_name_updated'
      AND privacy_class = 'public_safe_metadata'
    LIMIT 1
  `).get(threadId);
  return Boolean(row);
}

function cleanPreparedCardField(value: string | null | undefined, options: { fallback: string; maxChars: number; role: "title" | "summary" | "nextAction" }): CardPresentationCleanResult {
  const cleaned = cleanCardPresentationText(value, options);
  return looksSensitiveRefLike(cleaned.text)
    ? { text: publicSafeText(options.fallback, options.maxChars), cleaned: true, lowConfidence: true }
    : cleaned;
}

function cleanOptionalPreparedCardField(value: string | null | undefined, options: { maxChars: number; role: "summary" | "nextAction" }): OptionalCardPresentationCleanResult {
  if (!value?.trim()) return { text: null, cleaned: false, lowConfidence: options.role === "nextAction" };
  const cleaned = cleanCardPresentationText(value, { fallback: "", maxChars: options.maxChars, role: options.role });
  if (!cleaned.text || looksSensitiveRefLike(cleaned.text)) return { text: null, cleaned: true, lowConfidence: true };
  return cleaned;
}

function preparedCardActionOrNull(value: string | null, distinctFrom: Array<string | null>): string | null {
  if (!value || !isPreparedCardActionText(value)) return null;
  return distinctFrom.some((candidate) => presentationTextEquivalent(value, candidate)) ? null : value;
}

const PREPARED_CARD_ACTION_VERBS = new Set([
  "add",
  "address",
  "apply",
  "approve",
  "archive",
  "audit",
  "build",
  "check",
  "clean",
  "close",
  "commit",
  "continue",
  "create",
  "debug",
  "deploy",
  "document",
  "expand",
  "fix",
  "follow",
  "gather",
  "implement",
  "inspect",
  "investigate",
  "keep",
  "land",
  "merge",
  "monitor",
  "open",
  "patch",
  "publish",
  "push",
  "re-check",
  "refresh",
  "release",
  "remove",
  "rerun",
  "resolve",
  "resume",
  "review",
  "run",
  "ship",
  "smoke",
  "strip",
  "summarize",
  "sync",
  "update",
  "use",
  "validate",
  "verify",
  "wait",
  "watch",
  "write"
]);

function isPreparedCardActionText(value: string | null | undefined): boolean {
  const text = trimTerminalPunctuation(value ?? "").toLowerCase();
  const firstWord = text.match(/^[a-z]+(?:-[a-z]+)?/)?.[0] ?? "";
  return PREPARED_CARD_ACTION_VERBS.has(firstWord);
}

function presentationTextEquivalent(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftNorm = normalizedPresentationText(left);
  const rightNorm = normalizedPresentationText(right);
  return Boolean(leftNorm && rightNorm && (leftNorm === rightNorm || leftNorm.startsWith(`${rightNorm} `) || rightNorm.startsWith(`${leftNorm} `)));
}

function normalizedPresentationText(value: string | null | undefined): string {
  const withoutMarkup = stripPlanEnvelopeTokens(value ?? "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+#{1,6}\s+[A-Za-z0-9][\w\s:/.-]{0,100}$/gim, "")
    .replace(/^(?:title|final|summary|objective|next action|next|action)\s*:\s*/i, "")
    .replace(/[.!?;:]+$/g, "");
  return cutEmbeddedHeadingMarker(withoutMarkup)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function preparedCardWorkSummary(input: {
  state: PreparedCardState;
  objective: string | null;
  blocker: string | null;
  nextAction: string | null;
  finalMessage: string | null;
  touchedFiles: string[];
}): string {
  const topFile = input.touchedFiles.map(publicPreparedTouchedFileLabel).find((file): file is string => Boolean(file)) ?? null;
  const next = input.nextAction ? trimTerminalPunctuation(input.nextAction) : null;
  const objective = input.objective ? trimTerminalPunctuation(input.objective) : "";
  if (input.blocker) {
    const blocker = trimTerminalPunctuation(input.blocker);
    return publicSafeText(`Blocked: ${blocker}${next ? `; next ${next}` : ""}${topFile ? `; last touched ${topFile}` : ""}.`, 320);
  }
  if (input.state === "completed" && input.finalMessage) {
    const finalClause = trimTerminalPunctuation(firstFinalMessageClause(input.finalMessage) ?? input.finalMessage);
    return publicSafeText(`Finished: ${finalClause}${next ? `; next ${next}` : ""}.`, 320);
  }
  if (next) {
    return publicSafeText(`Working on: ${next}${topFile ? `; last touched ${topFile}` : ""}.`, 320);
  }
  return publicSafeText(`Working on: ${objective || preparedCardStateLabel(input.state)}${topFile ? `; last touched ${topFile}` : ""}.`, 320);
}

function trimTerminalPunctuation(value: string): string {
  return value.trim().replace(/[.!?;:]+$/g, "").trim();
}

function publicPreparedTouchedFileLabel(value: string): string | null {
  const trimmed = value.trim();
  if (!/^(?:assets|docs|evals|packages|skills|src|tests)\//.test(trimmed)) return null;
  const label = publicSafeText(basename(trimmed), 120);
  return label && !looksSensitiveRefLike(label) ? label : null;
}

function preparedInboxItemFromCard(card: PreparedCard): PreparedInboxItem {
  const reasonCodes = unique([
    ...card.reasonCodes,
    card.state === "ready" ? "prepared_card_ready" : card.state === "completed" ? "prepared_card_completed" : "needs_attention"
  ]);
  const urgencyScore = preparedInboxUrgencyScore(card, reasonCodes);
  return {
    schema: "lco.prepared.inboxItem.v1",
    itemRef: `prepared_inbox:${stableId(`${card.cardRef}:${card.inputHash}`)}`,
    cardRef: card.cardRef,
    targetRef: card.targetRef,
    urgencyScore,
    state: card.state,
    reasonCodes,
    sourceRefs: card.sourceRefs,
    execute: false
  };
}

function publicPreparedCardFromRow(row: PreparedCardRow): PreparedCard | null {
  const sourceRefs = parseSourceRefsJson(row.sourceRefsJson).filter(isPublicPreparedSourceRef).slice(0, 40);
  const sourceRangeRefs = parseSourceRefsJson(row.sourceRangeRefsJson).filter((ref) => /^codex_range:[0-9a-f]{32}$/.test(ref)).slice(0, PREPARED_CARD_SOURCE_RANGE_REF_LIMIT);
  const authorityCoverage = sanitizePreparedAuthorityCoverage(parseObjectJson(row.authorityCoverageJson));
  const reasonCodes = parseSourceRefsJson(row.reasonCodesJson).map(publicSafeIdentifier).filter((code): code is string => Boolean(code)).slice(0, 30);
  if (!isPublicPreparedCardRow(row, sourceRefs, sourceRangeRefs, authorityCoverage, reasonCodes)) return null;
  return {
    schema: "lco.prepared.card.v1",
    cardRef: row.cardRef,
    targetRef: row.targetRef,
    cardKind: row.cardKind as PreparedCardKind,
    title: publicSafeText(row.title, 160),
    objective: row.objective?.trim() ? publicSafeText(row.objective, 260) : null,
    summaryText: publicSafeText(row.summaryText, 320),
    blocker: row.blocker === null ? null : publicSafeText(row.blocker, 240),
    nextAction: row.nextAction === null ? null : publicSafeText(row.nextAction, 240),
    sourceRefs,
    sourceRangeRefs,
    sourceRangeRefsOmitted: boundedNonNegativeInteger(row.sourceRangeRefsOmitted, 1_000_000),
    authorityCoverage,
    sourceCoverage: preparedCardSourceCoverage(authorityCoverage),
    inputHash: row.inputHash,
    extractorVersion: PREPARED_CARD_EXTRACTOR_VERSION,
    privacyClass: "public_safe_metadata",
    confidence: Number(row.confidence),
    freshnessAt: row.freshnessAt,
    stale: Number(row.stale) === 1,
    state: row.state as PreparedCardState,
    reasonCodes
  };
}

function getPreparedCardRowByTargetRef(db: LooDatabase, targetRef: string): PreparedCardRow | null {
  if (!isPublicPreparedSourceRef(targetRef)) return null;
  const row = db.prepare(`
    SELECT
      card_ref AS cardRef,
      target_ref AS targetRef,
      card_kind AS cardKind,
      title,
      objective,
      summary_text AS summaryText,
      blocker,
      next_action AS nextAction,
      source_refs_json AS sourceRefsJson,
      source_range_refs_json AS sourceRangeRefsJson,
      source_range_refs_omitted AS sourceRangeRefsOmitted,
      authority_coverage_json AS authorityCoverageJson,
      input_hash AS inputHash,
      extractor_version AS extractorVersion,
      privacy_class AS privacyClass,
      confidence,
      freshness_at AS freshnessAt,
      stale,
      state,
      reason_codes_json AS reasonCodesJson
    FROM prepared_cards
    WHERE target_ref = ?
      AND extractor_version = ?
      AND privacy_class = 'public_safe_metadata'
    ORDER BY updated_at DESC, card_ref ASC
    LIMIT 1
  `).get(targetRef, PREPARED_CARD_EXTRACTOR_VERSION) as PreparedCardRow | undefined;
  return row ?? null;
}

function getPublicPreparedCardsByCardRef(db: LooDatabase, cardRefs: string[]): Map<string, PreparedCard> {
  const refs = unique(cardRefs.filter((ref) => /^prepared_card:[0-9a-f]{32}$/.test(ref)));
  const cards = new Map<string, PreparedCard>();
  for (let offset = 0; offset < refs.length; offset += 400) {
    const chunk = refs.slice(offset, offset + 400);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db.prepare(`
      SELECT
        card_ref AS cardRef,
        target_ref AS targetRef,
        card_kind AS cardKind,
        title,
        objective,
        summary_text AS summaryText,
        blocker,
        next_action AS nextAction,
        source_refs_json AS sourceRefsJson,
        source_range_refs_json AS sourceRangeRefsJson,
        source_range_refs_omitted AS sourceRangeRefsOmitted,
        authority_coverage_json AS authorityCoverageJson,
        input_hash AS inputHash,
        extractor_version AS extractorVersion,
        privacy_class AS privacyClass,
        confidence,
        freshness_at AS freshnessAt,
        stale,
        state,
        reason_codes_json AS reasonCodesJson
      FROM prepared_cards
      WHERE card_ref IN (${placeholders})
        AND extractor_version = ?
        AND privacy_class = 'public_safe_metadata'
    `).all(...chunk, PREPARED_CARD_EXTRACTOR_VERSION) as PreparedCardRow[];
    for (const row of rows) {
      const card = publicPreparedCardFromRow(row);
      if (card) cards.set(card.cardRef, card);
    }
  }
  return cards;
}

function publicPreparedInboxItemFromRow(row: PreparedInboxRow): PreparedInboxItem | null {
  const reasonCodes = parseSourceRefsJson(row.reasonCodesJson).map(publicSafeIdentifier).filter((code): code is string => Boolean(code)).slice(0, 30);
  const sourceRefs = parseSourceRefsJson(row.sourceRefsJson).filter(isPublicPreparedSourceRef).slice(0, 40);
  const urgencyScore = Number(row.urgencyScore);
  if (!/^prepared_inbox:[0-9a-f]{32}$/.test(row.itemRef)
    || !/^prepared_card:[0-9a-f]{32}$/.test(row.cardRef)
    || !isPublicPreparedSourceRef(row.targetRef)
    || !isPreparedCardState(row.state)
    || !Number.isFinite(urgencyScore)
    || urgencyScore < 0
    || urgencyScore > 100
    || Number(row.executeFalse) !== 1
    || sourceRefs.length === 0
  ) return null;
  return {
    schema: "lco.prepared.inboxItem.v1",
    itemRef: row.itemRef,
    cardRef: row.cardRef,
    targetRef: row.targetRef,
    urgencyScore,
    state: row.state,
    reasonCodes,
    sourceRefs,
    execute: false
  };
}

function isPublicPreparedCardRow(
  row: PreparedCardRow,
  sourceRefs: string[],
  sourceRangeRefs: string[],
  authorityCoverage: PreparedCard["authorityCoverage"],
  reasonCodes: string[]
): boolean {
  return /^prepared_card:[0-9a-f]{32}$/.test(row.cardRef)
    && isPublicPreparedSourceRef(row.targetRef)
    && (row.cardKind === "codex_session" || row.cardKind === "claude_session" || row.cardKind === "lcm_summary")
    && row.extractorVersion === PREPARED_CARD_EXTRACTOR_VERSION
    && row.privacyClass === "public_safe_metadata"
    && /^[0-9a-f]{32}$/.test(row.inputHash)
    && Number.isFinite(Number(row.confidence))
    && Number(row.confidence) >= 0
    && Number(row.confidence) <= 1
    && (row.freshnessAt === null || isSafeIsoTimestamp(row.freshnessAt))
    && (Number(row.stale) === 0 || Number(row.stale) === 1)
    && isPreparedCardState(row.state)
    && sourceRefs.length > 0
    && sourceRangeRefs.every((ref) => /^codex_range:[0-9a-f]{32}$/.test(ref))
    && row.title === publicSafeText(row.title, 160)
    && (row.objective === null || row.objective === "" || row.objective === publicSafeText(row.objective, 260))
    && row.summaryText === publicSafeText(row.summaryText, 320)
    && (row.blocker === null || row.blocker === publicSafeText(row.blocker, 240))
    && (row.nextAction === null || row.nextAction === publicSafeText(row.nextAction, 240))
    && !looksSensitiveRefLike(row.title)
    && !looksSensitiveRefLike(row.objective ?? "")
    && !looksSensitiveRefLike(row.summaryText)
    && !looksSensitiveRefLike(row.blocker ?? "")
    && !looksSensitiveRefLike(row.nextAction ?? "")
    && reasonCodes.length > 0
    && ["ok", "partial", "not_configured", "unknown"].includes(authorityCoverage.summaryLeaves.status)
    && ["ok", "partial", "not_configured", "unknown"].includes(authorityCoverage.sessionMetadata.status)
    && ["ok", "partial", "not_configured", "unknown"].includes(authorityCoverage.watcherObservations.status);
}

function sanitizePreparedAuthorityCoverage(value: Record<string, unknown>): PreparedCard["authorityCoverage"] {
  const summaryLeaves = isObjectRecord(value.summaryLeaves) ? value.summaryLeaves : {};
  const sessionMetadata = isObjectRecord(value.sessionMetadata) ? value.sessionMetadata : {};
  const watcherObservations = isObjectRecord(value.watcherObservations) ? value.watcherObservations : {};
  const summaryStatus = preparedCoverageState(summaryLeaves.status);
  const sessionStatus = preparedCoverageState(sessionMetadata.status);
  const watcherStatus = preparedCoverageState(watcherObservations.status);
  const leafCount = boundedNonNegativeInteger(summaryLeaves.leafCount, 1_000_000);
  const rangeCount = boundedNonNegativeInteger(summaryLeaves.rangeCount, 1_000_000);
  return {
    summaryLeaves: {
      status: summaryStatus,
      leafCount,
      rangeCount
    },
    sessionMetadata: {
      status: sessionStatus
    },
    watcherObservations: {
      status: watcherStatus
    }
  };
}

function preparedCardSourceCoverage(authorityCoverage: PreparedCard["authorityCoverage"]): PreparedCard["sourceCoverage"] {
  return {
    summaryLeaves: authorityCoverage.summaryLeaves.status,
    sessionMetadata: authorityCoverage.sessionMetadata.status,
    watcherObservations: authorityCoverage.watcherObservations.status
  };
}

function preparedSummaryLeafCoverage(db: LooDatabase, threadId?: string): PreparedStateCoverage {
  const clauses = [
    "extractor_version = ?",
    "privacy_class = 'public_safe_metadata'",
    "omission_status = 'metadata_only'"
  ];
  const params: Array<string | number> = [SUMMARY_LEAF_EXTRACTOR_VERSION];
  if (threadId) {
    clauses.push("thread_id = ?");
    params.push(threadId);
  }
  const count = Number((db.prepare(`SELECT COUNT(*) AS count FROM summary_leaves WHERE ${clauses.join(" AND ")}`).get(...params) as { count: number }).count);
  if (count > 0) return "ok";
  return preparedSourceRangeCoverage(db, threadId) === "ok" ? "partial" : "not_configured";
}

function preparedSourceRangeCoverage(db: LooDatabase, threadId?: string): PreparedStateCoverage {
  const clauses = [
    "extractor_version = ?",
    "privacy_class = 'public_safe_metadata'",
    "omission_status = 'metadata_only'"
  ];
  const params: Array<string | number> = [PREPARED_SOURCE_EXTRACTOR_VERSION];
  if (threadId) {
    clauses.push("thread_id = ?");
    params.push(threadId);
  }
  const count = Number((db.prepare(`SELECT COUNT(*) AS count FROM prepared_source_ranges WHERE ${clauses.join(" AND ")}`).get(...params) as { count: number }).count);
  return count > 0 ? "ok" : "not_configured";
}

function getPreparedTargetCoverage(db: LooDatabase, threadId?: string): PreparedTargetCoverage | null {
  if (!threadId || !isPublicSummaryThreadId(threadId)) return null;
  const targetRef = codexThreadRef(threadId);
  const session = db.prepare(`
    SELECT
      thread_id AS threadId,
      source_path AS sourcePath,
      updated_at AS updatedAt,
      indexed_at AS indexedAt
    FROM codex_sessions
    WHERE thread_id = ?
    LIMIT 1
  `).get(threadId) as { threadId: string; sourcePath: string; updatedAt: string | null; indexedAt: string | null } | undefined;
  const sourceFile = session ? db.prepare(`
    SELECT last_indexed_at AS lastIndexedAt
    FROM codex_source_files
    WHERE source_path = ?
    LIMIT 1
  `).get(session.sourcePath) as { lastIndexedAt: string | null } | undefined : undefined;
  const preparedSourceEvents = countPublicPreparedTargetSourceEvents(db, threadId);
  const preparedSourceRanges = countPublicPreparedTargetSourceRanges(db, threadId);
  const summaryLeaves = countPublicPreparedTargetSummaryLeaves(db, threadId);
  const preparedCards = countPreparedTargetRows(db, `
    SELECT COUNT(*) AS count
    FROM prepared_cards
    WHERE target_ref = ?
      AND extractor_version = ?
      AND privacy_class = 'public_safe_metadata'
  `, targetRef, PREPARED_CARD_EXTRACTOR_VERSION);
  const cardRow = getPreparedCardRowByTargetRef(db, targetRef);
  const publicCard = cardRow ? publicPreparedCardFromRow(cardRow) : null;
  const preparedInboxItems = countPreparedTargetInboxItems(db, targetRef);
  const coverage = {
    indexedSession: session ? "ok" : "not_configured",
    sourceFile: session ? sourceFile ? "ok" : "partial" : "not_configured",
    preparedSourceEvents: preparedSourceEvents.count > 0 ? "ok" : "not_configured",
    preparedSourceRanges: preparedSourceRanges.publicCount > 0 ? "ok" : preparedSourceRanges.rawCount > 0 ? "partial" : "not_configured",
    summaryLeaves: summaryLeaves.publicCount > 0 ? "ok" : summaryLeaves.rawCount > 0 ? "partial" : "not_configured",
    preparedCards: publicCard ? preparedTargetCardCoverage(publicCard) : preparedCards > 0 ? "partial" : "not_configured",
    preparedInboxItems: publicCard && preparedInboxItems.publicCount > 0 ? "ok" : preparedInboxItems.rawCount > 0 ? "partial" : "not_configured",
    watcherObservations: watcherObservationCoverageForTarget(db, targetRef)
  } satisfies PreparedTargetCoverage["sourceCoverage"];
  const cardFreshnessAt = publicCard ? maxPublicPreparedTargetCardUpdatedAt(db, targetRef) : null;
  const preparedFreshnessAt = oldestSafeTimestamp([
    preparedSourceEvents.maxCreatedAt,
    preparedSourceRanges.maxCreatedAt,
    summaryLeaves.maxCreatedAt,
    cardFreshnessAt,
    preparedInboxItems.maxUpdatedAt
  ]);
  const sourceUpdatedAt = safeIsoOrNull(session?.updatedAt ?? null);
  const indexedAt = safeIsoOrNull(session?.indexedAt ?? sourceFile?.lastIndexedAt ?? null);
  const requiredCoverage: PreparedStateCoverage[] = [
    coverage.preparedSourceEvents,
    coverage.preparedSourceRanges,
    coverage.summaryLeaves,
    coverage.preparedCards,
    coverage.preparedInboxItems
  ];
  const missingDerivedCache = requiredCoverage.some((state) => state !== "ok");
  const partialDerivedCache = requiredCoverage.some((state) => state === "partial");
  const allDerivedLayersMissing = requiredCoverage.every((state) => state === "not_configured");
  const stale = Boolean(session && (
    missingDerivedCache
    || (publicCard ? preparedTargetCardCoverage(publicCard) !== "ok" : false)
    || summaryLeaves.staleCount > 0
    || (sourceUpdatedAt && preparedFreshnessAt && sourceUpdatedAt > preparedFreshnessAt)
  ));
  const anyDerivedRows = preparedSourceEvents.count + preparedSourceRanges.rawCount + summaryLeaves.rawCount + preparedCards + preparedInboxItems.rawCount > 0;
  const status: PreparedTargetCoverageStatus = !session
    ? anyDerivedRows ? "partial" : "not_found"
    : missingDerivedCache
      ? allDerivedLayersMissing ? "source_present_not_indexed" : "partial"
      : stale ? "partial" : "ready";
  const reasonCodes = preparedTargetReasonCodes(status, coverage, stale);
  const sourceRefs = unique([
    targetRef,
    session?.sourcePath ? publicSourcePathRef(session.sourcePath) : ""
  ].filter(Boolean));
  return {
    schema: "lco.prepared.targetCoverage.v1",
    threadId,
    targetRef,
    status,
    sourceRefs,
    sourceCoverage: coverage,
    counts: {
      preparedSourceEvents: preparedSourceEvents.count,
      preparedSourceRanges: preparedSourceRanges.publicCount,
      summaryLeaves: summaryLeaves.publicCount,
      preparedCards: publicCard ? 1 : 0,
      preparedInboxItems: preparedInboxItems.publicCount
    },
    freshness: {
      sourceUpdatedAt,
      indexedAt,
      preparedFreshnessAt,
      stale
    },
    reasonCodes,
    nextAction: preparedTargetNextAction(status)
  };
}

function preparedTargetCardCoverage(card: PreparedCard): PreparedStateCoverage {
  if (card.stale) return "partial";
  return preparedCardStateHasFreshTargetCoverage(card.state) ? "ok" : "partial";
}

function preparedCardStateHasFreshTargetCoverage(state: PreparedCardState): boolean {
  return state === "ready"
    || state === "completed"
    || state === "ready_for_review"
    || state === "watching_external_check"
    || state === "needs_resume";
}

function countPreparedTargetRows(db: LooDatabase, sql: string, ...params: Array<string | number>): number {
  return Number((db.prepare(sql).get(...params) as { count: number } | undefined)?.count ?? 0);
}

function countPublicPreparedTargetSourceEvents(db: LooDatabase, threadId: string): { count: number; maxCreatedAt: string | null } {
  const row = db.prepare(`
    SELECT COUNT(*) AS count, MAX(created_at) AS maxCreatedAt
    FROM prepared_source_events
    WHERE thread_id = ?
      AND extractor_version = ?
      AND privacy_class = 'public_safe_metadata'
      AND omission_status = 'metadata_only'
  `).get(threadId, PREPARED_SOURCE_EXTRACTOR_VERSION) as { count: number; maxCreatedAt: string | null } | undefined;
  return {
    count: Number(row?.count ?? 0),
    maxCreatedAt: safeIsoOrNull(row?.maxCreatedAt ?? null)
  };
}

function countPublicPreparedTargetSourceRanges(db: LooDatabase, threadId: string): { rawCount: number; publicCount: number; maxCreatedAt: string | null } {
  const rows = db.prepare(`
    SELECT
      range_ref AS rangeRef,
      event_ref AS eventRef,
      thread_id AS threadId,
      source_ref AS sourceRef,
      source_path_ref AS sourcePathRef,
      range_kind AS rangeKind,
      line_start AS lineStart,
      line_end AS lineEnd,
      byte_start AS byteStart,
      byte_end AS byteEnd,
      ordinal,
      source_hash AS sourceHash,
      content_hash AS contentHash,
      extractor_version AS extractorVersion,
      privacy_class AS privacyClass,
      omission_status AS omissionStatus,
      confidence,
      observed_at AS observedAt,
      reason_codes_json AS reasonCodesJson,
      created_at AS createdAt
    FROM prepared_source_ranges
    WHERE thread_id = ?
      AND extractor_version = ?
      AND privacy_class = 'public_safe_metadata'
      AND omission_status = 'metadata_only'
  `).all(threadId, PREPARED_SOURCE_EXTRACTOR_VERSION) as Array<PreparedSourceRangeRow & { createdAt: string | null }>;
  const publicRows = rows.filter((row) => Boolean(preparedSourceRangeFromRow(row)));
  return {
    rawCount: rows.length,
    publicCount: publicRows.length,
    maxCreatedAt: latestSafeTimestamp(publicRows.map((row) => row.createdAt))
  };
}

function countPublicPreparedTargetSummaryLeaves(db: LooDatabase, threadId: string): { rawCount: number; publicCount: number; staleCount: number; maxCreatedAt: string | null } {
  const rows = db.prepare(`
    SELECT
      leaf_ref AS leafRef,
      thread_id AS threadId,
      leaf_kind AS leafKind,
      summary_text AS summaryText,
      source_refs_json AS sourceRefsJson,
      source_range_refs_json AS sourceRangeRefsJson,
      input_hash AS inputHash,
      output_hash AS outputHash,
      extractor_version AS extractorVersion,
      privacy_class AS privacyClass,
      authority_coverage_json AS authorityCoverageJson,
      confidence,
      freshness_at AS freshnessAt,
      stale,
      omission_status AS omissionStatus,
      created_at AS createdAt
    FROM summary_leaves
    WHERE thread_id = ?
      AND extractor_version = ?
      AND privacy_class = 'public_safe_metadata'
      AND omission_status = 'metadata_only'
  `).all(threadId, SUMMARY_LEAF_EXTRACTOR_VERSION) as Array<SummaryLeafRow & { createdAt: string | null }>;
  const publicLeaves = rows.flatMap((row) => {
    const leaf = publicSummaryLeafFromRow(row);
    return leaf ? [{ leaf, createdAt: row.createdAt }] : [];
  });
  return {
    rawCount: rows.length,
    publicCount: publicLeaves.length,
    staleCount: publicLeaves.filter(({ leaf }) => leaf.stale).length,
    maxCreatedAt: latestSafeTimestamp(publicLeaves.map(({ createdAt }) => createdAt))
  };
}

function countPreparedTargetInboxItems(db: LooDatabase, targetRef: string): { rawCount: number; publicCount: number; maxUpdatedAt: string | null } {
  if (!isPublicPreparedSourceRef(targetRef)) return { rawCount: 0, publicCount: 0, maxUpdatedAt: null };
  const rows = db.prepare(`
    SELECT
      item_id AS itemRef,
      card_ref AS cardRef,
      target_ref AS targetRef,
      urgency_score AS urgencyScore,
      state,
      reason_codes_json AS reasonCodesJson,
      source_refs_json AS sourceRefsJson,
      execute_false AS executeFalse,
      updated_at AS updatedAt
    FROM prepared_inbox_items
    WHERE target_ref = ?
      AND execute_false = 1
  `).all(targetRef) as Array<PreparedInboxRow & { updatedAt: string | null }>;
  const candidateItems = rows.map(publicPreparedInboxItemFromRow).filter((item): item is PreparedInboxItem => Boolean(item));
  const cardByRef = getPublicPreparedCardsByCardRef(db, candidateItems.map((item) => item.cardRef));
  const publicRows = rows.filter((row) => {
    const item = publicPreparedInboxItemFromRow(row);
    return item ? cardByRef.has(item.cardRef) : false;
  });
  return {
    rawCount: rows.length,
    publicCount: publicRows.length,
    maxUpdatedAt: latestSafeTimestamp(publicRows.map((row) => row.updatedAt))
  };
}

function maxPublicPreparedTargetCardUpdatedAt(db: LooDatabase, targetRef: string): string | null {
  if (!isPublicPreparedSourceRef(targetRef)) return null;
  const rows = db.prepare(`
    SELECT
      card_ref AS cardRef,
      target_ref AS targetRef,
      card_kind AS cardKind,
      title,
      objective,
      summary_text AS summaryText,
      blocker,
      next_action AS nextAction,
      source_refs_json AS sourceRefsJson,
      source_range_refs_json AS sourceRangeRefsJson,
      source_range_refs_omitted AS sourceRangeRefsOmitted,
      authority_coverage_json AS authorityCoverageJson,
      input_hash AS inputHash,
      extractor_version AS extractorVersion,
      privacy_class AS privacyClass,
      confidence,
      freshness_at AS freshnessAt,
      stale,
      state,
      reason_codes_json AS reasonCodesJson,
      updated_at AS updatedAt
    FROM prepared_cards
    WHERE target_ref = ?
      AND extractor_version = ?
      AND privacy_class = 'public_safe_metadata'
  `).all(targetRef, PREPARED_CARD_EXTRACTOR_VERSION) as Array<PreparedCardRow & { updatedAt: string | null }>;
  const publicRows = rows.filter((row) => Boolean(publicPreparedCardFromRow(row)));
  return latestSafeTimestamp(publicRows.map((row) => row.updatedAt));
}

function latestSafeTimestamp(values: Array<string | null>): string | null {
  return values.filter((value): value is string => typeof value === "string" && isSafeIsoTimestamp(value)).sort().at(-1) ?? null;
}

function oldestSafeTimestamp(values: Array<string | null>): string | null {
  return values.filter((value): value is string => typeof value === "string" && isSafeIsoTimestamp(value)).sort().at(0) ?? null;
}

function safeIsoOrNull(value: string | null | undefined): string | null {
  return value && isSafeIsoTimestamp(value) ? value : null;
}

function preparedTargetReasonCodes(
  status: PreparedTargetCoverageStatus,
  coverage: PreparedTargetCoverage["sourceCoverage"],
  stale: boolean
): string[] {
  return unique([
    "targeted_thread_coverage",
    coverage.indexedSession === "ok" ? "indexed_session_present" : "thread_not_indexed",
    coverage.sourceFile === "partial" ? "source_file_watermark_missing" : "",
    coverage.preparedSourceEvents !== "ok" ? "prepared_source_events_missing" : "",
    coverage.preparedSourceRanges !== "ok" ? "prepared_source_ranges_missing" : "",
    coverage.summaryLeaves !== "ok" ? "summary_leaves_missing" : "",
    coverage.preparedCards !== "ok" ? "prepared_cards_missing" : "",
    coverage.preparedInboxItems !== "ok" ? "prepared_inbox_missing" : "",
    status === "source_present_not_indexed" ? "source_present_not_indexed" : "",
    status === "source_present_not_indexed" ? "active_session_pending_index" : "",
    status === "ready" ? "prepared_state_ready" : "",
    status === "partial" ? "partial_prepared_state" : "",
    stale ? "prepared_cache_stale_or_missing" : ""
  ].filter(Boolean));
}

function preparedTargetNextAction(status: PreparedTargetCoverageStatus): string {
  if (status === "ready") return "Use prepared cards, prepared inbox, or summary expansion for bounded public-safe evidence.";
  if (status === "source_present_not_indexed") return "Refresh the local LCO derived cache with loo index codex or loo prep run --once, then re-check this thread.";
  if (status === "partial") return "Inspect coverage reason codes and refresh the local LCO derived cache before treating this thread as current.";
  if (status === "not_found") return "Run a bounded Codex index refresh or verify the thread is under configured local Codex session roots.";
  return "Inspect source coverage and configured local Codex roots before making a prepared-state claim.";
}

function preparedCoverageState(value: unknown): PreparedStateCoverage {
  return value === "ok" || value === "partial" || value === "not_configured" || value === "unknown" ? value : "unknown";
}

function isPreparedCardState(value: string): value is PreparedCardState {
  return (PREPARED_CARD_STATES as readonly string[]).includes(value);
}

function isPublicPreparedSourceRef(value: string): boolean {
  if (value.startsWith("codex_thread:")) return isPublicSummaryThreadId(value.slice("codex_thread:".length));
  if (value.startsWith("codex_subagent_result:")) return isPublicCodexSubagentResultRef(value);
  if (value.startsWith("claude_session:")) return isPublicClaudeSessionRef(value);
  if (value.startsWith("claude_source:")) return /^claude_source:[0-9a-f]{16}$/.test(value);
  if (value.startsWith("lcm_summary:")) {
    const match = /^lcm_summary:([0-9a-f]{12}):([A-Za-z0-9._~%-]+)$/.exec(value);
    if (!match) return false;
    try {
      let decoded = match[2];
      for (let pass = 0; pass < 3; pass += 1) {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      }
      return decoded.length > 0 && decoded.length <= 200 && !looksSensitiveRefLike(decoded);
    } catch {
      return false;
    }
  }
  if (value.startsWith("summary_leaf:")) return isPublicSummaryLeafRef(value);
  return false;
}

function isPublicClaudeSessionRef(value: string): boolean {
  const encodedId = value.slice("claude_session:".length);
  if (!encodedId || encodedId.length > 160 || !/^[A-Za-z0-9._~%-]+$/.test(encodedId)) return false;
  try {
    const decodedId = decodeURIComponent(encodedId);
    return safeClaudeSessionId(decodedId) === decodedId && !looksSensitiveRefLike(decodedId);
  } catch {
    return false;
  }
}

function isPublicCodexSubagentResultRef(value: string): boolean {
  const encodedId = value.slice("codex_subagent_result:".length);
  if (!/^[A-Za-z0-9._:%-]{1,200}$/.test(encodedId)) return false;
  let decodedId = encodedId;
  try {
    decodedId = decodeURIComponent(encodedId);
  } catch {
    return false;
  }
  return /^[A-Za-z0-9._:-]{1,160}$/.test(decodedId) && !looksSensitiveRefLike(decodedId);
}

function preparedLifecycleFromMetadata(
  metadata: SessionMetadata,
  evidenceState: PreparedCardState
): { state: PreparedCardState; reasonCodes: string[]; metadataSignalHash: string } {
  const matchSignals = {
    status: normalizedMetadataMatchValue(metadata.status),
    blocker: normalizedMetadataMatchValue(metadata.blocker),
    nextAction: normalizedMetadataMatchValue(metadata.nextAction),
    closeoutState: normalizedMetadataMatchValue(metadata.closeoutState),
    planCompletionState: normalizedMetadataMatchValue(metadata.planCompletionState)
  };
  const metadataSignalHash = stableId(JSON.stringify({
    extractorVersion: PREPARED_CARD_EXTRACTOR_VERSION,
    normalization: "match-signals",
    signals: matchSignals
  }));
  const nonBlockerText = [matchSignals.status, matchSignals.nextAction, matchSignals.closeoutState, matchSignals.planCompletionState].filter(Boolean).join(" ");
  const text = [nonBlockerText, matchSignals.blocker].filter(Boolean).join(" ");
  const sourceReasonCodes = Object.entries(matchSignals)
    .filter(([, value]) => value.length > 0)
    .map(([field]) => `lifecycle_signal:${field.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)}`);
  const completedByStatus = lifecycleCompletionLike(matchSignals.status);
  const completedByCloseoutAndPlan = lifecycleCompletionLike(matchSignals.closeoutState)
    && lifecycleCompletionLike(matchSignals.planCompletionState);
  const completed = completedByStatus || completedByCloseoutAndPlan;
  const dirtyHandoff = /\b(?:dirty[-_ ]?worktree|uncommitted|worktree[-_ ]?handoff|dirty[-_ ]?handoff|handoff[-_ ]?dirty|cleanup[-_ ]?required)\b/.test(text);
  const waitingApproval = /\b(?:waiting[-_ ]?(?:for[-_ ]?)?approval|needs[-_ ]?approval|requires[-_ ]?approval|approval[-_ ]?(?:required|needed|pending)|pending[-_ ]?approval|approval[-_ ]?gate|do[-_ ]?not[-_ ]?execute[-_ ]?without[-_ ]?explicit[-_ ]?approval)\b/.test(text);
  const needsResume = /\b(?:needs[-_ ]?(?:to[-_ ]?)?resume|resume[-_ ]?(?:session|thread|work|run|lane|needed|required|requested|request)|continue[-_ ]?(?:session|thread|lane)|nudge[-_ ]?(?:session|thread|agent|lane)|rejoin[-_ ]?(?:session|thread|lane))\b/.test(text);
  const watchingExternalCheck = /\b(?:(?:watch|watching|monitor|monitoring)[-_ ]+(?:ci|checks?|codeql|coderabbit|deploy(?:[-_ ]?check)?|external[-_ ]?(?:check|review)|review[-_ ]?check)|(?:waiting[-_ ]?(?:on|for)|pending)[-_ ]+(?:ci|checks?|codeql|coderabbit|deploy|external[-_ ]?check|review[-_ ]?check)|(?:ci|checks?|codeql|coderabbit|deploy[-_ ]?check|review[-_ ]?check)[-_ ]+(?:pending|queued|running|failing|failed|blocked|red|not[-_ ]?green|in[-_ ]?progress))\b/.test(text);
  const readyForReview = /\b(?:ready[-_ ]?for[-_ ]?review|review[-_ ]?ready|ready[-_ ]?to[-_ ]?review|pr[-_ ]?ready|needs[-_ ]?review)\b/.test(text);
  const negatedBlocker = /\b(?:not[-_ ]?blocked|no[-_ ]?blocker|unblocked|without[-_ ]?blocker|blocker[-_ ]?(?:none|na|n[-_ ]?a))\b/.test(text);
  const missingInfoSignal = /\b(?:missing[-_ ]?(?:info|input|context)|needs[-_ ]?(?:info|input|context)|waiting[-_ ]?(?:on|for)[-_ ]?(?:user|operator|human|input|context)|cannot[-_ ]?proceed)\b/.test(nonBlockerText);
  const blockedSignal = !negatedBlocker && /\b(?:blocked|blocker)\b/.test(nonBlockerText);
  const blockedMissingInfo = !waitingApproval
    && !dirtyHandoff
    && !watchingExternalCheck
    && !negatedBlocker
    && (hasRealBlocker(metadata.blocker) || missingInfoSignal || blockedSignal);
  const matchedLifecycleStates: PreparedCardState[] = [
    completed ? "completed" : null,
    dirtyHandoff ? "dirty_worktree_handoff" : null,
    waitingApproval ? "waiting_approval" : null,
    blockedMissingInfo ? "blocked_missing_info" : null,
    needsResume ? "needs_resume" : null,
    watchingExternalCheck ? "watching_external_check" : null,
    readyForReview ? "ready_for_review" : null
  ].filter((state): state is PreparedCardState => Boolean(state));
  const evidenceReasonCodes = evidenceState !== "ready" ? [`lifecycle:${evidenceState}`] : [];
  const conflict = completed && matchedLifecycleStates.some((state) => state !== "completed");
  if (conflict) {
    return {
      state: "unknown_lifecycle",
      reasonCodes: unique([
        "semantic_lifecycle",
        "lifecycle:unknown_lifecycle",
        "lifecycle_conflict",
        ...matchedLifecycleStates.map((state) => `lifecycle:${state}`),
        ...evidenceReasonCodes,
        ...sourceReasonCodes
      ]),
      metadataSignalHash
    };
  }
  const semanticState: PreparedCardState | null = dirtyHandoff
    ? "dirty_worktree_handoff"
    : waitingApproval
      ? "waiting_approval"
      : blockedMissingInfo
        ? "blocked_missing_info"
        : needsResume
          ? "needs_resume"
          : watchingExternalCheck
            ? "watching_external_check"
            : readyForReview
              ? "ready_for_review"
              : completed
                ? "completed"
                : null;
  if (semanticState === "completed" && evidenceState !== "ready") {
    return {
      state: evidenceState,
      reasonCodes: unique(["semantic_lifecycle", "lifecycle:completed", `lifecycle:${evidenceState}`, ...sourceReasonCodes]),
      metadataSignalHash
    };
  }
  if (semanticState) {
    return {
      state: semanticState,
      reasonCodes: unique(["semantic_lifecycle", `lifecycle:${semanticState}`, ...evidenceReasonCodes, ...sourceReasonCodes]),
      metadataSignalHash
    };
  }
  if (evidenceState !== "ready") {
    return {
      state: evidenceState,
      reasonCodes: unique(["semantic_lifecycle", `lifecycle:${evidenceState}`, "lifecycle_signal_missing", ...sourceReasonCodes]),
      metadataSignalHash
    };
  }
  return {
    state: "ready",
    reasonCodes: unique(["semantic_lifecycle", "lifecycle:ready_without_lifecycle_signal", "lifecycle_signal_missing"]),
    metadataSignalHash
  };
}

function lifecycleCompletionLike(value: string): boolean {
  return ["complete", "completed", "done", "closed", "merged", "success", "successful", "succeeded", "passed"].includes(value);
}

function preparedCardStateLabel(state: PreparedCardState): string {
  return ({
    ready: "evidence ready, lifecycle unknown",
    stale: "stale evidence",
    partial: "partial evidence",
    unknown: "unknown evidence",
    completed: "completed",
    blocked_missing_info: "blocked missing info",
    waiting_approval: "waiting approval",
    watching_external_check: "watching external check",
    needs_resume: "needs resume",
    dirty_worktree_handoff: "dirty worktree handoff",
    stale_or_partial: "stale or partial",
    ready_for_review: "ready for review",
    unknown_lifecycle: "unknown lifecycle"
  } as Record<PreparedCardState, string>)[state] ?? "unknown lifecycle";
}

function preparedCardConfidence(averageLeafConfidence: number, state: PreparedCardState, evidenceState: PreparedCardState = state): number {
  let confidence = Number.isFinite(averageLeafConfidence) ? averageLeafConfidence : 0.3;
  if (state === "partial") confidence = Math.min(confidence, 0.49);
  if (state === "stale") confidence = Math.min(confidence, 0.49);
  if (state === "unknown") confidence = Math.min(confidence, 0.44);
  if (state === "stale_or_partial") confidence = Math.min(confidence, 0.49);
  if (state === "unknown_lifecycle") confidence = Math.min(confidence, 0.44);
  if (evidenceState === "partial" || evidenceState === "stale" || evidenceState === "stale_or_partial") confidence = Math.min(confidence, 0.49);
  if (evidenceState === "unknown" || evidenceState === "unknown_lifecycle") confidence = Math.min(confidence, 0.44);
  return Math.max(0.2, Math.min(0.99, Number(confidence.toFixed(2))));
}

function preparedInboxUrgencyScore(card: PreparedCard, reasonCodes: string[]): number {
  const stateScore = {
    unknown: 88,
    unknown_lifecycle: 60,
    stale: 82,
    stale_or_partial: 74,
    partial: 74,
    blocked_missing_info: 94,
    waiting_approval: 92,
    dirty_worktree_handoff: 89,
    watching_external_check: 78,
    needs_resume: 76,
    ready_for_review: 68,
    ready: 42,
    completed: 18
  } as const;
  const codeScore = reasonCodes.reduce((score, code) => score + ({
    authority_unknown: 8,
    authority_partial: 6,
    stale_cache: 8,
    low_confidence: 6,
    filtered_unsafe_rows: 5,
    needs_attention: 4,
    "lifecycle_conflict": 10,
    "lifecycle:blocked_missing_info": 8,
    "lifecycle:waiting_approval": 7,
    "lifecycle:dirty_worktree_handoff": 7,
    "lifecycle:watching_external_check": 5,
    "lifecycle:needs_resume": 5
  }[code] ?? 0), 0);
  const baseStateScore = stateScore[card.state] ?? 50;
  return Math.max(0, Math.min(100, Number((baseStateScore + codeScore + Math.round((1 - card.confidence) * 10)).toFixed(2))));
}

function preparedCardCountsAsPartialSummary(state: PreparedCardState): boolean {
  return state === "partial"
    || state === "stale_or_partial"
    || state === "blocked_missing_info"
    || state === "waiting_approval"
    || state === "watching_external_check"
    || state === "needs_resume"
    || state === "dirty_worktree_handoff"
    || state === "ready_for_review";
}

function preparedCardReadActions(): PreparedCardsReport["actionsPerformed"] {
  return {
    derivedCacheWrite: false,
    sourceStoreMutation: false,
    externalWrite: false,
    liveControl: false,
    guiMutation: false,
    rawTranscriptRead: false
  };
}

function preparedCardWriteActions(): PreparedCardMaterializationReport["actionsPerformed"] {
  return {
    derivedCacheWrite: true,
    sourceStoreMutation: false,
    externalWrite: false,
    liveControl: false,
    guiMutation: false,
    rawTranscriptRead: false
  };
}

function hookSidecarActions(): HookSidecarActions {
  return {
    derivedCacheWrite: true,
    codexMutation: false,
    sourceStoreMutation: false,
    externalWrite: false,
    liveControl: false,
    guiMutation: false,
    rawTranscriptRead: false,
    modelCompactionRun: false,
    trueCompactionSummaryCaptured: false
  };
}

function hookCaptureReport(
  packet: HookCapturePacket,
  inserted: boolean,
  generatedAt: string,
  blockers: string[],
  proofBoundary: string
): HookCaptureReport {
  return {
    schema: "lco.hookCapture.v1",
    publicSafe: true,
    readOnly: false,
    mutationClasses: ["derived_cache"],
    generatedAt,
    inserted,
    packet,
    blockers: unique(blockers),
    actionsPerformed: hookSidecarActions(),
    proofBoundary
  };
}

function resolveHookTarget(input: {
  threadId?: string;
  thread_id?: string;
  sessionId?: string;
  session_id?: string;
  targetRef?: string;
  target_ref?: string;
  turnId?: string;
  turn_id?: string;
  eventId?: string;
  event_id?: string;
}): { targetRef: string; threadId: string | null; turnId: string | null; eventId: string | null } {
  const rawThreadId = hookStringInput(input.threadId ?? input.thread_id ?? input.sessionId ?? input.session_id);
  const safeId = rawThreadId ? safeThreadId(rawThreadId) : null;
  const targetCandidate = hookStringInput(input.targetRef ?? input.target_ref);
  const normalizedTarget = targetCandidate
    ? publicSafeRefLike(targetCandidate, "target")
    : safeId
      ? codexThreadRef(safeId)
      : null;
  const targetRef = normalizedTarget && normalizedTarget.startsWith("codex_thread:")
    ? codexThreadRef(safeThreadId(normalizedTarget))
    : normalizedTarget ?? "target_unknown";
  const threadId = targetRef.startsWith("codex_thread:") ? bareCodexThreadId(targetRef) : safeId;
  return {
    targetRef,
    threadId,
    turnId: hookOptionalIdentifier(input.turnId ?? input.turn_id, "turn"),
    eventId: hookOptionalIdentifier(input.eventId ?? input.event_id, "event")
  };
}

function hookOptionalIdentifier(value: unknown, prefix: string): string | null {
  const raw = hookStringInput(value);
  return raw ? publicSafeRefLike(raw, prefix) ?? `${prefix}_${stableId(raw).slice(0, 16)}` : null;
}

function hookStringInput(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hookPayloadHash(value: unknown): string {
  return stableId(canonicalJsonString(value));
}

function insertHookCapturePacket(db: LooDatabase, packet: HookCapturePacket): boolean {
  const result = db.prepare(`
    INSERT OR IGNORE INTO hook_capture_packets (
      packet_id, hook_kind, target_ref, payload_hash, packet_json,
      privacy_class, confidence, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    packet.packetId,
    packet.hookKind,
    packet.targetRef,
    packet.payloadHash,
    JSON.stringify(packet),
    packet.privacyClass,
    packet.confidence,
    packet.createdAt
  );
  return result.changes > 0;
}

function insertStatePrepJob(
  db: LooDatabase,
  input: { jobId: string; targetRef: string; inputHash: string; outputHash: string; generatedAt: string }
): boolean {
  const existing = db.prepare(`
    SELECT job_id AS jobId
    FROM state_prep_jobs
    WHERE job_id = ?
  `).get(input.jobId) as { jobId: string } | undefined;
  db.prepare(`
    INSERT INTO state_prep_jobs (
      job_id, job_kind, status, target_ref, input_hash, output_hash,
      mutation_classes_json, started_at, finished_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      status = excluded.status,
      output_hash = excluded.output_hash,
      finished_at = excluded.finished_at,
      updated_at = excluded.updated_at
  `).run(
    input.jobId,
    "state_prep",
    "complete",
    input.targetRef,
    input.inputHash,
    input.outputHash,
    JSON.stringify(["derived_cache"]),
    input.generatedAt,
    input.generatedAt,
    input.generatedAt,
    input.generatedAt
  );
  return !existing;
}

type ThreadTitleAliasRow = {
  aliasText: string;
  updatedAt: string;
};

type ThreadTitleIndexedSignal = {
  title: string | null;
  cwd: string | null;
  summary: string | null;
  finalMessage: string | null;
  safeText: string | null;
};

function getThreadTitleAlias(db: LooDatabase, threadId: string, aliasKind: "thread_title_finalizer"): ThreadTitleAliasRow | null {
  const row = db.prepare(`
    SELECT alias_text AS aliasText, updated_at AS updatedAt
    FROM codex_thread_title_aliases
    WHERE thread_id = ? AND alias_kind = ?
  `).get(threadId, aliasKind) as ThreadTitleAliasRow | undefined;
  return row ?? null;
}

function getThreadTitleIndexedSignal(db: LooDatabase, threadId: string): ThreadTitleIndexedSignal | null {
  const row = db.prepare(`
    SELECT title, cwd, summary, final_message AS finalMessage, safe_text AS safeText
    FROM codex_sessions
    WHERE thread_id = ?
  `).get(threadId) as ThreadTitleIndexedSignal | undefined;
  return row ?? null;
}

function insertThreadTitleAlias(
  db: LooDatabase,
  input: {
    threadId: string;
    targetRef: string;
    aliasText: string;
    sourcePacketId: string;
    reasonCodes: string[];
    confidence: number;
    generatedAt: string;
  }
): boolean {
  const result = db.prepare(`
    INSERT OR IGNORE INTO codex_thread_title_aliases (
      alias_id, thread_id, target_ref, alias_kind, alias_text, alias_norm,
      source_packet_id, reason_codes_json, confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    stableId(`thread-title-alias:${input.threadId}:thread_title_finalizer`),
    input.threadId,
    input.targetRef,
    "thread_title_finalizer",
    input.aliasText,
    normalizedTitle(input.aliasText),
    input.sourcePacketId,
    JSON.stringify(input.reasonCodes),
    input.confidence,
    input.generatedAt,
    input.generatedAt
  );
  return result.changes > 0;
}

function deriveThreadTitleDraft(
  input: ThreadTitleFinalizerInput,
  indexedSignal: ThreadTitleIndexedSignal | null
): {
  suggestedTitle: string | null;
  repoOrProject: string | null;
  summary: string | null;
  state: ThreadTitleFinalizerState;
  sourceSignals: string[];
} {
  const repoOrProject = deriveRepoOrProject(input, indexedSignal);
  const closeout = extractHookCloseout(hookStringInput(input.lastAssistantMessage ?? input.last_assistant_message));
  const candidates: Array<{ signal: string; value: string | null }> = [
    { signal: "task_summary", value: hookStringInput(input.taskSummary ?? input.task_summary) },
    { signal: "closeout_title", value: closeout.fields.title ?? null },
    { signal: "closeout_summary", value: closeout.fields.summary ?? null },
    { signal: "indexed_summary", value: indexedSignal?.summary ?? null },
    { signal: "indexed_final_message", value: indexedSignal?.finalMessage ?? null },
    { signal: "assistant_message", value: hookStringInput(input.lastAssistantMessage ?? input.last_assistant_message) },
    { signal: "user_message", value: latestThreadTitleUserMessage(input) },
    { signal: "indexed_safe_text", value: indexedSignal?.safeText ?? null },
    { signal: "current_title", value: hookStringInput(input.currentTitle ?? input.current_title) ?? indexedSignal?.title ?? null }
  ];
  for (const candidate of candidates) {
    const summary = deriveThreadTitleSummary(candidate.value);
    if (!summary) continue;
    const suggestedTitle = repoOrProject ? `${repoOrProject}: ${summary}` : summary;
    return {
      suggestedTitle: publicSafeThreadTitle(suggestedTitle),
      repoOrProject,
      summary,
      state: "ready",
      sourceSignals: [candidate.signal, repoOrProject ? "repo_or_project" : "summary_only"]
    };
  }
  return {
    suggestedTitle: null,
    repoOrProject,
    summary: null,
    state: "insufficient_signal",
    sourceSignals: repoOrProject ? ["repo_or_project"] : []
  };
}

function deriveRepoOrProject(input: ThreadTitleFinalizerInput, indexedSignal: ThreadTitleIndexedSignal | null): string | null {
  const direct = hookStringInput(input.project ?? input.repo ?? input.repoName ?? input.repo_name);
  const cwd = hookStringInput(input.cwd) ?? indexedSignal?.cwd ?? null;
  const raw = direct ?? (cwd ? basename(cwd) : null);
  if (!raw) return null;
  return publicSafeTitleToken(raw.replace(/\.git$/i, ""), 64);
}

function latestThreadTitleUserMessage(input: ThreadTitleFinalizerInput): string | null {
  const direct = hookStringInput(input.userMessage ?? input.user_message);
  if (direct) return direct;
  const messages = input.userMessages ?? input.user_messages;
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = hookStringInput(messages[index]);
    if (message) return message;
  }
  return null;
}

const THREAD_TITLE_FINALIZER_DIRECT_SIGNAL_SOURCE = String.raw`thread-title-finalize|title finalizer|title-finalizer`;
const THREAD_TITLE_FINALIZATION_SIGNAL_SOURCE = String.raw`finaliz(?:e|es|ed|ing).{0,40}thread.{0,20}title|thread.{0,20}title.{0,40}finaliz`;
const THREAD_TITLE_FINALIZER_DIRECT_PATTERN = new RegExp(THREAD_TITLE_FINALIZER_DIRECT_SIGNAL_SOURCE, "i");
const THREAD_TITLE_FINALIZATION_PATTERN = new RegExp(THREAD_TITLE_FINALIZATION_SIGNAL_SOURCE, "i");
const THREAD_TITLE_FINALIZER_SIGNAL_PATTERN = new RegExp(
  `${THREAD_TITLE_FINALIZER_DIRECT_SIGNAL_SOURCE}|${THREAD_TITLE_FINALIZATION_SIGNAL_SOURCE}`,
  "i"
);
const THREAD_TITLE_FINALIZER_LEADING_NEGATION_PATTERN = /\b(?:not|no|without|never)\b/i;
const THREAD_TITLE_FINALIZER_TRAILING_NEGATION_PATTERN = /\b(?:work|feature|hook|plugin|change|lane|it|this|that|was|were|is|are|has|have|had|did|does|do|will|would|can|could|should)\b.{0,40}\b(?:not|never)\b.{0,24}\b(?:ship|shipped|implemented|built|added|installed|wired|enabled|created|live|available|done)\b/i;

function deriveThreadTitleSummary(value: string | null): string | null {
  if (!value) return null;
  const redacted = redactHookStringUnbounded(value);
  const lowered = redacted.toLowerCase();
  const negatesTitleFinalizer = negatesTitleFinalizerSignal(redacted);
  if (
    (
      THREAD_TITLE_FINALIZER_DIRECT_PATTERN.test(redacted)
      && !negatesTitleFinalizer
    )
    || (
      /\b(?:implemented|built|added|installed|wired|enabled|created|shipped)\b/i.test(redacted)
      && /\b(?:codex|lco)\b/i.test(redacted)
      && /\b(?:hook|plugin)\b/i.test(redacted)
      && THREAD_TITLE_FINALIZATION_PATTERN.test(redacted)
      && !negatesTitleFinalizer
    )
  ) {
    return "Codex thread title finalizer";
  }
  if (/hook/.test(lowered) && /lco/.test(lowered) && /(index|search|title|name)/.test(lowered)) {
    return "LCO hook indexing";
  }
  const line = redacted
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length >= 12
      && !/^[-*]?\s*(status|blocker|owner|priority|source refs?)\s*:/i.test(part)
      && !(negatesTitleFinalizer && THREAD_TITLE_FINALIZER_SIGNAL_PATTERN.test(part)));
  if (!line) return null;
  const withoutLabels = line
    .replace(/^[-*]?\s*(final|summary|task|next action|implemented|complete|done)\s*:?\s*/i, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = withoutLabels.split(/[.!?]/, 1)[0]?.trim() ?? "";
  const words = sentence
    .split(/\s+/)
    .map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9/-]+$/g, ""))
    .filter((word) => word.length > 1 && !THREAD_TITLE_STOP_WORDS.has(word.toLowerCase()));
  if (words.length < 2) return null;
  return publicSafeThreadTitle(words.slice(0, 7).join(" "));
}

const THREAD_TITLE_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "into",
  "under",
  "create",
  "when",
  "what",
  "where",
  "please",
  "implemented",
  "complete",
  "final",
  "hook"
]);

function publicSafeThreadTitle(value: string): string | null {
  const normalized = publicSafeText(redactHookString(value, 120), 120)
    .replace(/\s+/g, " ")
    .replace(/\s+([:/-])\s+/g, "$1 ")
    .trim();
  if (!normalized || normalized.length < 4 || hookPublicSafetyBlockers(normalized).length > 0) return null;
  return normalized;
}

function publicSafeTitleToken(value: string, maxChars: number): string | null {
  const token = publicSafeText(redactHookString(value, maxChars), maxChars)
    .replace(/[^A-Za-z0-9._ -]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();
  return token.length >= 2 ? token : null;
}

function repoOrProjectFromTitle(title: string): string | null {
  const index = title.indexOf(":");
  return index > 0 ? publicSafeTitleToken(title.slice(0, index), 64) : null;
}

function summaryFromSuggestedTitle(title: string): string | null {
  const index = title.indexOf(":");
  return publicSafeThreadTitle(index >= 0 ? title.slice(index + 1).trim() : title);
}

function extractHookCloseout(message: string | null): NonNullable<HookCapturePacket["payload"]["closeout"]> {
  if (!message) return { present: false, text: null, textHash: null, textRedacted: false, fields: {}, truncated: false, omissions: [] };
  const rawText = latestBalancedCloseoutEnvelopeText(message);
  if (rawText === null) return { present: false, text: null, textHash: null, textRedacted: false, fields: {}, truncated: false, omissions: [] };
  const redactedText = redactHookStringUnbounded(rawText);
  const truncated = rawText.length > 1800 || redactedText.length > 1800;
  return {
    present: true,
    text: null,
    textHash: stableId(rawText),
    textRedacted: true,
    fields: hookCloseoutFields(rawText),
    truncated,
    omissions: unique([
      "closeout_text_hash_only",
      truncated ? "closeout_text_truncated" : ""
    ].filter(Boolean))
  };
}

function hookCloseoutFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z -]{1,60})\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    const key = publicSafeIdentifier(match[1]!.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_"));
    if (!key) continue;
    fields[key] = isSensitiveHookCloseoutKey(key) ? "<redacted-secret>" : redactHookString(match[2]!, 240);
  }
  return fields;
}

function isSensitiveHookCloseoutKey(key: string): boolean {
  return /(?:password|passcode|secret|token|cookie|authorization|auth|api_key|access_token|refresh_token|session_(?:id|token|cookie))/i.test(key);
}

function normalizeCompactionLifecycle(value: CompactionMarkerHookInput["lifecycle"]): HookCompactionLifecycle {
  if (value === "pre_compact" || value === "PreCompact") return "pre_compact";
  if (value === "post_compact" || value === "PostCompact") return "post_compact";
  throw new Error("compaction-capture lifecycle must be pre_compact, post_compact, PreCompact, or PostCompact");
}

function hookSourceRefs(targetRef: string, text: string): string[] {
  return unique([
    targetRef,
    ...extractSourceRefs(text)
      .map((ref) => publicSafeRefLike(ref, "source") ?? "")
      .filter(Boolean)
  ]).slice(0, 30);
}

const HOOK_POSIX_LOCAL_PATH_PATTERN = /(?:file:\/\/)?(?:\/Users|\/Volumes|\/private\/var|\/private\/tmp|\/var\/folders|\/home|\/root|\/tmp|\/workspace|\/workspaces|\/mnt|\/data|\/opt|\/srv|\/etc)\/[^\s"'`)]+/g;
const HOOK_WINDOWS_LOCAL_PATH_PATTERN = /(?:[A-Za-z]:)?\\(?:Users|home|tmp|workspace|workspaces|mnt|data|opt|srv|etc)\\[^\s"'`)]+/g;

function redactHookString(value: string, maxChars: number): string {
  return truncate(redactHookStringUnbounded(value), maxChars);
}

function redactHookStringUnbounded(value: string): string {
  return redactSensitiveHookPathTokens(value
    .replace(HOOK_POSIX_LOCAL_PATH_PATTERN, "<redacted-local-path>")
    .replace(HOOK_WINDOWS_LOCAL_PATH_PATTERN, "<redacted-local-path>")
    .replace(/~\/\.codex\/[^\s"'`)]+/g, "<redacted-local-path>")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<redacted-secret>")
    .replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, "<redacted-secret>")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<redacted-secret>")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "<redacted-secret>")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "<redacted-secret>")
    .replace(/\bPRIVATE_CANARY[A-Za-z0-9_:-]*/g, "<redacted-secret>")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, "$1<redacted-secret>")
    .replace(/(Basic\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1<redacted-secret>")
    .replace(/(\bauthorization\s*:\s*)[^\r\n"'`)]+/gi, "$1<redacted-secret>")
    .replace(/(\bcookie\s*:\s*)[^\r\n"'`)]+/gi, "$1<redacted-secret>"));
}

function redactSensitiveHookPathTokens(value: string): string {
  return value.replace(/[^\s"'`)]+/g, (token) => isSensitiveHookPathToken(token) ? "<redacted-local-path>" : token);
}

function isSensitiveHookPathToken(token: string): boolean {
  const normalizedToken = token
    .replace(/^file:\/\//i, "")
    .replace(/\\/g, "/");
  const drivePathMatch = normalizedToken.match(/[A-Za-z]:\//);
  const slashPathIndex = normalizedToken.indexOf("/");
  const pathStart = drivePathMatch?.index ?? slashPathIndex;
  if (pathStart < 0) return false;
  const normalized = normalizedToken.slice(pathStart);
  if (!normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)) return false;
  const pathPart = normalized.split(/[?#]/, 1)[0] ?? normalized;
  const segments = pathPart.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
  return segments.some((segment) => (
    segment === ".codex"
    || segment === "sessions"
    || segment === "transcripts"
    || segment === "transcript"
    || segment.startsWith("transcript.")
  ));
}

function hookPublicSafetyBlockers(value: unknown): string[] {
  const serialized = JSON.stringify(value);
  const blockers: string[] = [];
  if (
    hookRegexTest(HOOK_POSIX_LOCAL_PATH_PATTERN, serialized)
    || hookRegexTest(HOOK_WINDOWS_LOCAL_PATH_PATTERN, serialized)
    || containsSensitiveHookPathToken(serialized)
    || /~\/\.codex\//.test(serialized)
  ) blockers.push("raw_local_path_leak");
  if (/(?:npm_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{10,}|PRIVATE_CANARY[A-Za-z0-9_:-]*|BEGIN [A-Z ]*PRIVATE KEY)/.test(serialized)) blockers.push("raw_secret_like_value");
  return blockers;
}

function containsSensitiveHookPathToken(value: string): boolean {
  for (const token of value.match(/[^\s"'`)]+/g) ?? []) {
    if (isSensitiveHookPathToken(token)) return true;
  }
  return false;
}

function hookRegexTest(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  const result = pattern.test(value);
  pattern.lastIndex = 0;
  return result;
}

type WatcherObservationRow = {
  observationId: string;
  watchId: string;
  targetRef: string;
  observationJson: string;
  evidenceRefsJson: string;
  privacyClass: string;
  confidence: number;
  observedAt: string;
};

type WatcherAttentionQueueRow = {
  queueId: string;
  targetRef: string;
  itemKind: string;
  status: string;
  toolCallJson: string | null;
  executeFalse: number;
  sourceRefsJson: string;
  reasonCodesJson: string;
  confidence: number;
  updatedAt: string;
};

type WatcherAttentionQueueDraft = {
  queueId: string;
  targetRef: string;
  itemKind: WatcherAttentionQueueItem["itemKind"];
  status: WatcherStatus;
  toolCall: WatcherAttentionQueueItem["toolCall"];
  reasonCodes: string[];
  confidence: number;
};

function watcherReadActions(): WatcherEventsReport["actionsPerformed"] {
  return {
    derivedCacheWrite: false,
    sourceStoreMutation: false,
    externalWrite: false,
    liveControl: false,
    guiMutation: false,
    rawTranscriptRead: false
  };
}

function watcherWriteActions(): WatcherPersistenceReport["actionsPerformed"] {
  return {
    derivedCacheWrite: true,
    sourceStoreMutation: false,
    externalWrite: false,
    liveControl: false,
    guiMutation: false,
    rawTranscriptRead: false
  };
}

function assertWatcherSpecDoesNotMutate(spec: WatchSpec): void {
  if ((spec as { mutates?: unknown }).mutates === true) throw new Error("watcher spec must be read-only with mutates=false");
}

function publicSafePersistedWatchSpec(spec: WatchSpec, watcher: WatcherState): Record<string, unknown> {
  return collaborationPublicSafeWatchSpecArg({
    ...spec,
    watchId: watcher.watchId,
    targetRef: watcher.targetRef,
    lastObservedAt: watcher.lastObservedAt,
    stopConditions: watcher.stopConditions,
    evidenceIds: watcher.evidenceIds,
    confidence: watcher.confidence,
    mutates: false
  });
}

function watcherSourceRefs(watcher: WatcherState): string[] {
  return unique([
    watcher.targetRef,
    watcherSourceRefForWatchId(watcher.watchId),
    ...watcher.evidenceIds
  ].map((ref) => publicSafeRefLike(ref, "source") ?? "").filter(Boolean)).slice(0, 30);
}

function watcherSourceRefForWatchId(watchId: string): string {
  return `watcher:${watchId}`;
}

function watcherAttentionQueueDraft(
  watcher: WatcherState,
  safeSpec: Record<string, unknown>
): WatcherAttentionQueueDraft | null {
  if (watcher.status === "active" || watcher.status === "expired") return null;
  const toolCall: WatcherAttentionQueueItem["toolCall"] = watcher.status === "triggered"
    ? {
        tool: "lco_watchers",
        execute: false,
        args: {
          action: "resume_request_packet",
          watcher_spec: safeSpec,
          recommended_action: watcher.recommendedAction
        }
      }
    : {
        tool: "lco_watchers",
        execute: false,
        args: {
          action: "status",
          watcher_specs: [safeSpec],
          watch_id: watcher.watchId
        }
      };
  const itemKind: WatcherAttentionQueueItem["itemKind"] = watcher.status === "triggered"
    ? "watcher_resume_request"
    : "watcher_inspection";
  const reasonCodes = unique([
    "watcher_attention_queue",
    `recommended_action:${watcher.recommendedAction}`,
    ...watcher.reasonCodes
  ].map((code) => publicSafeIdentifier(code) ?? "").filter(Boolean)).slice(0, 30);
  const queueId = stableId(`attention-queue:${watcher.watchId}:${watcher.targetRef}:${watcher.status}:${canonicalJsonString(toolCall.args)}`);
  return {
    queueId,
    targetRef: watcher.targetRef,
    itemKind,
    status: watcher.status,
    toolCall,
    reasonCodes,
    confidence: watcher.confidence
  };
}

function publicWatcherObservationFromRow(row: WatcherObservationRow): WatcherObservationRecord | null {
  if (row.privacyClass !== "public_safe_metadata") return null;
  const watcher = publicWatcherStateFromRecord(parseObjectJson(row.observationJson));
  if (!watcher) return null;
  const observedAt = publicIsoTimestamp(row.observedAt) ?? watcher.lastObservedAt;
  if (!observedAt) return null;
  const evidenceRefs = parseSourceRefsJson(row.evidenceRefsJson)
    .map((ref) => publicSafeRefLike(ref, "evidence") ?? "")
    .filter(Boolean)
    .slice(0, 20);
  const observationId = publicSafeIdentifier(row.observationId) ?? stableId(row.observationId || canonicalJsonString(watcher));
  const sourceRefs = watcherSourceRefs(watcher);
  return {
    schema: "lco.watcherObservation.v1",
    observationRef: `watcher_observation:${observationId}`,
    watchId: watcher.watchId,
    targetRef: watcher.targetRef,
    watcher,
    evidenceRefs,
    sourceRefs,
    observedAt,
    freshness: {
      lastObservedAt: watcher.lastObservedAt,
      expiresAt: watcher.expiresAt,
      stale: watcher.stale,
      expired: watcher.expired
    },
    reasonCodes: watcher.reasonCodes,
    confidence: watcher.confidence,
    privacyClass: "public_safe_metadata"
  };
}

function publicWatcherStateFromRecord(record: Record<string, unknown>): WatcherState | null {
  const kind = knownWatcherKind(record.kind);
  const status = publicWatcherStatus(record.status);
  if (!kind || !status) return null;
  const watchId = publicSafeWatcherIdentifier(String(record.watchId ?? record.watch_id ?? "watch"), "watch");
  const targetRef = publicSafeWatcherTargetRef(String(record.targetRef ?? record.target_ref ?? "unknown"));
  const recommendedAction = publicWatcherRecommendedAction(record.recommendedAction ?? record.recommended_action) ?? watcherRecommendedAction(status, kind);
  const lastObservedAt = publicIsoTimestamp(String(record.lastObservedAt ?? record.last_observed_at ?? "")) ?? null;
  const expiresAt = publicIsoTimestamp(String(record.expiresAt ?? record.expires_at ?? "")) ?? null;
  const confidence = Math.max(0, Math.min(1, Number(record.confidence ?? 0.1)));
  const reasonCodes = watcherStringArray(record.reasonCodes ?? record.reason_codes)
    .map((code) => publicSafeIdentifier(code) ?? "")
    .filter(Boolean)
    .slice(0, 30);
  const evidenceIds = watcherStringArray(record.evidenceIds ?? record.evidence_ids)
    .map((id) => publicSafeRefLike(id, "evidence") ?? "")
    .filter(Boolean)
    .slice(0, 20);
  return {
    schema: "lco.watcherState.v1",
    watchId,
    targetRef,
    kind,
    status,
    wakeReason: status === "triggered" ? knownWatcherKind(record.wakeReason ?? record.wake_reason) : null,
    recommendedAction,
    requiresApproval: true,
    mutates: false,
    stale: record.stale === true,
    expired: record.expired === true,
    expiresAt,
    lastObservedAt,
    stopConditions: watcherStringArray(record.stopConditions ?? record.stop_conditions)
      .map((condition) => publicSafeWatcherIdentifier(condition, "condition"))
      .slice(0, 12),
    reasonCodes: reasonCodes.length ? reasonCodes : watcherReasonCodes(kind, status, null, record.stale === true, record.expired === true, confidence),
    confidence,
    evidenceIds,
    approvalBoundary: publicSafeText(String(record.approvalBoundary ?? record.approval_boundary ?? "Read-only watcher; requests attention only. No live Codex control, GUI mutation, external write, or cleanup without a separate matching approval packet."), 360)
  };
}

function publicWatcherAttentionQueueItemFromRow(row: WatcherAttentionQueueRow): WatcherAttentionQueueItem | null {
  if (Number(row.executeFalse) !== 1) return null;
  const itemKind = publicWatcherQueueItemKind(row.itemKind);
  const status = publicWatcherStatus(row.status);
  const toolCall = publicWatcherToolCallFromStored(parseObjectJson(row.toolCallJson ?? "{}"));
  if (!itemKind || !status || !toolCall) return null;
  const queueId = publicSafeIdentifier(row.queueId) ?? stableId(row.queueId);
  const targetRef = publicSafeWatcherTargetRef(row.targetRef);
  const sourceRefs = parseSourceRefsJson(row.sourceRefsJson).map((ref) => publicSafeRefLike(ref, "source") ?? "").filter(Boolean).slice(0, 30);
  const reasonCodes = parseSourceRefsJson(row.reasonCodesJson).map((code) => publicSafeIdentifier(code) ?? "").filter(Boolean).slice(0, 30);
  const freshnessAt = publicIsoTimestamp(row.updatedAt) ?? null;
  return {
    schema: "lco.attentionQueue.item.v1",
    itemRef: `attention_queue:${queueId}`,
    targetRef,
    itemKind,
    status,
    toolCall,
    execute: false,
    sourceRefs,
    reasonCodes,
    confidence: Math.max(0, Math.min(1, Number(row.confidence ?? 0.1))),
    freshnessAt
  };
}

function publicWatcherToolCallFromStored(record: Record<string, unknown>): WatcherAttentionQueueItem["toolCall"] | null {
  const serialized = JSON.stringify(record);
  if (looksSensitiveRefLike(serialized)) return null;
  const legacyAction = record.tool === "loo_resume_request_packet"
    ? "resume_request_packet"
    : record.tool === "loo_watcher_status"
    ? "status"
    : null;
  const tool = record.tool === "lco_watchers" || legacyAction ? "lco_watchers" : null;
  const args = isObjectRecord(record.args) ? record.args : null;
  if (!tool || !args || record.execute !== false) return null;
  return {
    tool,
    execute: false,
    args: {
      ...(legacyAction ? { action: legacyAction } : {}),
      ...args
    }
  };
}

function publicWatcherStatus(value: unknown): WatcherStatus | null {
  return value === "active"
    || value === "triggered"
    || value === "stale"
    || value === "expired"
    || value === "low_confidence"
    ? value
    : null;
}

function publicWatcherRecommendedAction(value: unknown): WatcherRecommendedAction | null {
  return value === "inspect" || value === "resume" || value === "approve" || value === "ignore" ? value : null;
}

function publicWatcherQueueItemKind(value: unknown): WatcherAttentionQueueItem["itemKind"] | null {
  return value === "watcher_resume_request" || value === "watcher_inspection" ? value : null;
}

function watcherStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function watcherSpecCoverageCount(db: LooDatabase, watchId: string | null, targetRef: string | null): number {
  const clauses = ["privacy_class = 'public_safe_metadata'"];
  const params: string[] = [];
  if (watchId) {
    clauses.push("watch_id = ?");
    params.push(watchId);
  }
  if (targetRef) {
    clauses.push("target_ref = ?");
    params.push(targetRef);
  }
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM watcher_specs WHERE ${clauses.join(" AND ")}`).get(...params) as { count: number }).count);
}

function watcherObservationCoverage(db: LooDatabase): PreparedStateCoverage {
  const rows = db.prepare(`
    SELECT
      observation_id AS observationId,
      watch_id AS watchId,
      target_ref AS targetRef,
      observation_json AS observationJson,
      evidence_refs_json AS evidenceRefsJson,
      privacy_class AS privacyClass,
      confidence,
      observed_at AS observedAt
    FROM watcher_observations
  `).all() as WatcherObservationRow[];
  return coverageFromPublicRows(rows.length, rows.filter((row) => publicWatcherObservationFromRow(row)).length);
}

function watcherObservationCoverageForTarget(db: LooDatabase, targetRef: string): PreparedStateCoverage {
  const rows = db.prepare(`
    SELECT
      observation_id AS observationId,
      watch_id AS watchId,
      target_ref AS targetRef,
      observation_json AS observationJson,
      evidence_refs_json AS evidenceRefsJson,
      privacy_class AS privacyClass,
      confidence,
      observed_at AS observedAt
    FROM watcher_observations
    WHERE target_ref = ?
  `).all(targetRef) as WatcherObservationRow[];
  return coverageFromPublicRows(rows.length, rows.filter((row) => publicWatcherObservationFromRow(row)).length);
}

function coverageFromCounts(raw: number, safe: number): PreparedStateCoverage {
  if (raw <= 0) return "not_configured";
  if (safe <= 0 || safe < raw) return "partial";
  return "ok";
}

function coverageFromPublicRows(raw: number, safe: number): PreparedStateCoverage {
  if (raw <= 0) return "not_configured";
  if (safe <= 0) return "unknown";
  if (safe < raw) return "partial";
  return "ok";
}

function deletePreparedCardsForThreadIds(db: LooDatabase, threadIds: string[]): void {
  deletePreparedCardsForTargetRefs(db, unique(threadIds).filter(Boolean).map(codexThreadRef));
}

function deletePreparedCardsForTargetRefs(db: LooDatabase, targetRefs: string[]): void {
  const safeTargetRefs = unique(targetRefs).filter(isPublicPreparedSourceRef);
  if (safeTargetRefs.length === 0) return;
  for (let index = 0; index < safeTargetRefs.length; index += SUMMARY_LEAF_EDGE_DELETE_BATCH_SIZE) {
    const batch = safeTargetRefs.slice(index, index + SUMMARY_LEAF_EDGE_DELETE_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(",");
    const cardRows = db.prepare(`SELECT card_ref AS cardRef FROM prepared_cards WHERE target_ref IN (${placeholders})`).all(...batch) as Array<{ cardRef: string }>;
    const cardRefs = cardRows.map((row) => String(row.cardRef)).filter((ref) => /^prepared_card:[0-9a-f]{32}$/.test(ref));
    db.prepare(`DELETE FROM prepared_inbox_items WHERE target_ref IN (${placeholders})`).run(...batch);
    if (cardRefs.length > 0) {
      const cardPlaceholders = cardRefs.map(() => "?").join(",");
      db.prepare(`DELETE FROM prepared_inbox_items WHERE card_ref IN (${cardPlaceholders})`).run(...cardRefs);
    }
    db.prepare(`DELETE FROM prepared_cards WHERE target_ref IN (${placeholders})`).run(...batch);
  }
}

function boundedNonNegativeInteger(value: unknown, max: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= max ? number : 0;
}


type PreparedSourceRangeRow = {
  rangeRef: string;
  eventRef: string;
  threadId: string;
  sourceRef: string;
  sourcePathRef: string;
  rangeKind: PreparedSourceRangeKind;
  lineStart: number;
  lineEnd: number;
  byteStart: number;
  byteEnd: number;
  ordinal: number;
  sourceHash: string;
  contentHash: string;
  extractorVersion: "prepared-source-ranges-v1";
  privacyClass: "public_safe_metadata";
  omissionStatus: "metadata_only";
  confidence: number;
  observedAt: string | null;
  reasonCodesJson: string;
};

type SummaryLeafRow = {
  leafRef: string;
  threadId: string | null;
  leafKind: string;
  summaryText: string;
  sourceRefsJson: string;
  sourceRangeRefsJson: string;
  inputHash: string;
  outputHash: string;
  extractorVersion: string;
  privacyClass: string;
  authorityCoverageJson: string;
  confidence: number;
  freshnessAt: string | null;
  stale: number;
  omissionStatus: string;
};

function buildSummaryLeafDrafts(ranges: PreparedSourceRange[]): SummaryLeafDraft[] {
  const groups = new Map<string, PreparedSourceRange[]>();
  for (const range of ranges) {
    const leafKind = summaryLeafKindFromRangeKind(range.rangeKind);
    const key = `${range.threadId}|${leafKind}`;
    const list = groups.get(key) ?? [];
    list.push(range);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, group]) => {
    const [, leafKind] = key.split("|");
    const sorted = group.sort((left, right) => left.ordinal - right.ordinal || left.rangeRef.localeCompare(right.rangeRef));
    const threadId = sorted[0]?.threadId ?? null;
    const sourceRefs = unique([threadId ? codexThreadRef(threadId) : null, ...sorted.map((range) => range.sourceRef)].filter((ref): ref is string => Boolean(ref))).sort();
    const fullSourceRangeRefs = unique(sorted.map((range) => range.rangeRef)).sort();
    const sourceRangeRefs = fullSourceRangeRefs.slice(0, SUMMARY_LEAF_SOURCE_RANGE_REF_LIMIT);
    const inputHash = stableId(sorted.map((range) => `${range.rangeRef}:${range.contentHash}`).join("|"));
    const summaryText = summaryLeafText(leafKind as SummaryLeafKind, sorted.length);
    const leafId = stableId(`${SUMMARY_LEAF_EXTRACTOR_VERSION}:${threadId}:${leafKind}:${inputHash}`);
    const freshnessAt = latestIso(sorted.map((range) => range.observedAt));
    const confidence = Math.min(...sorted.map((range) => range.confidence));
    const draft: SummaryLeafDraft = {
      schema: "lco.summary.leaf.v1",
      leafId,
      leafRef: `summary_leaf:${leafId}`,
      threadId,
      leafKind: leafKind as SummaryLeafKind,
      summaryText,
      sourceRefs,
      sourceRangeRefs,
      sourceRangeRefsOmitted: Math.max(0, fullSourceRangeRefs.length - sourceRangeRefs.length),
      inputHash,
      outputHash: stableId(summaryText),
      extractorVersion: SUMMARY_LEAF_EXTRACTOR_VERSION,
      privacyClass: "public_safe_metadata",
      authorityCoverage: {
        source: "prepared_source_ranges",
        status: "ok",
        rangeCount: sorted.length
      },
      confidence: Number.isFinite(confidence) ? confidence : 0.4,
      freshnessAt,
      stale: false,
      omissionStatus: "metadata_only"
    };
    return draft;
  }).sort((left, right) => (left.threadId ?? "").localeCompare(right.threadId ?? "") || summaryLeafSortOrder(left.leafKind) - summaryLeafSortOrder(right.leafKind) || left.leafRef.localeCompare(right.leafRef));
}

function summaryLeafKindFromRangeKind(rangeKind: PreparedSourceRangeKind): SummaryLeafKind {
  if (rangeKind === "user_prompt") return "user_prompt";
  if (rangeKind === "assistant_message") return "assistant_message";
  if (rangeKind === "proposed_plan") return "proposed_plan";
  if (rangeKind === "final_message") return "final_message";
  if (rangeKind === "closeout") return "closeout";
  if (rangeKind === "tool_call_metadata") return "tool_call_metadata";
  return "event_metadata";
}

function summaryLeafText(leafKind: SummaryLeafKind, rangeCount: number): string {
  const label: Record<SummaryLeafKind, string> = {
    user_prompt: "User prompt evidence",
    assistant_message: "Assistant message evidence",
    proposed_plan: "Proposed plan evidence",
    final_message: "Final assistant message evidence",
    closeout: "Closeout evidence",
    tool_call_metadata: "Tool-call metadata evidence",
    event_metadata: "Event metadata evidence"
  };
  return `${label[leafKind]}: ${rangeCount} prepared source range${rangeCount === 1 ? "" : "s"} available. Expand by summary leaf or source range for bounded evidence.`;
}

function summaryLeafSortOrder(leafKind: SummaryLeafKind): number {
  const order: Record<SummaryLeafKind, number> = {
    closeout: 0,
    final_message: 1,
    proposed_plan: 2,
    user_prompt: 3,
    assistant_message: 4,
    tool_call_metadata: 5,
    event_metadata: 6
  };
  return order[leafKind] ?? 99;
}

function insertSummaryLeafEdges(db: LooDatabase, leaves: SummaryLeafDraft[], createdAt: string): number {
  let count = 0;
  const byThread = new Map<string, SummaryLeafDraft[]>();
  for (const leaf of leaves) {
    if (!leaf.threadId) continue;
    const list = byThread.get(leaf.threadId) ?? [];
    list.push(leaf);
    byThread.set(leaf.threadId, list);
  }
  for (const list of byThread.values()) {
    const sorted = [...list].sort((left, right) => summaryLeafSortOrder(left.leafKind) - summaryLeafSortOrder(right.leafKind) || left.leafRef.localeCompare(right.leafRef));
    for (let index = 1; index < sorted.length; index += 1) {
      const parent = sorted[index - 1]!;
      const child = sorted[index]!;
      db.prepare("INSERT OR IGNORE INTO summary_edges (edge_id, parent_leaf_ref, child_leaf_ref, edge_kind, created_at) VALUES (?, ?, ?, ?, ?)").run(
        stableId(`${parent.leafRef}:${child.leafRef}:same_thread_context`),
        parent.leafRef,
        child.leafRef,
        "same_thread_context",
        createdAt
      );
      count += 1;
    }
  }
  return count;
}

function getSummaryEdgesForParent(db: LooDatabase, parent: SummaryLeaf, limit: number): Array<{ parentLeafRef: string; childLeafRef: string; edgeKind: string }> {
  if (!isPublicSummaryLeafRef(parent.leafRef)) return [];
  const clauses = [
    "e.parent_leaf_ref = ?",
    "c.extractor_version = ?",
    "c.privacy_class = 'public_safe_metadata'",
    "c.omission_status = 'metadata_only'",
    "c.leaf_ref LIKE 'summary_leaf:%'",
    "length(c.leaf_ref) = 45",
    "substr(c.leaf_ref, 14) NOT GLOB '*[^0-9a-f]*'"
  ];
  const params: Array<string | number> = [parent.leafRef, SUMMARY_LEAF_EXTRACTOR_VERSION];
  if (parent.threadId) {
    clauses.push("c.thread_id = ?");
    params.push(parent.threadId);
  } else {
    clauses.push("c.thread_id IS NULL");
  }
  const rows = db.prepare(`
    SELECT e.parent_leaf_ref AS parentLeafRef, e.child_leaf_ref AS childLeafRef, e.edge_kind AS edgeKind
    FROM summary_edges e
    JOIN summary_leaves c ON c.leaf_ref = e.child_leaf_ref
    WHERE ${clauses.join(" AND ")}
    ORDER BY e.parent_leaf_ref ASC, e.child_leaf_ref ASC, e.edge_kind ASC
    LIMIT ?
  `).all(...params, clamp(limit, 1, 400)) as Array<{ parentLeafRef: string; childLeafRef: string; edgeKind: string }>;
  return rows.filter((edge) =>
    isPublicSummaryLeafRef(edge.parentLeafRef)
    && isPublicSummaryLeafRef(edge.childLeafRef)
    && /^[A-Za-z0-9_.:-]{1,80}$/.test(edge.edgeKind)
  );
}

function deleteSummaryLeafEdges(db: LooDatabase, leafRefs: string[]): void {
  if (leafRefs.length === 0) return;
  for (let index = 0; index < leafRefs.length; index += SUMMARY_LEAF_EDGE_DELETE_BATCH_SIZE) {
    const batch = leafRefs.slice(index, index + SUMMARY_LEAF_EDGE_DELETE_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(",");
    db.prepare(`DELETE FROM summary_edges WHERE parent_leaf_ref IN (${placeholders}) OR child_leaf_ref IN (${placeholders})`).run(...batch, ...batch);
  }
}

function deleteSummaryLeavesForThreadIds(db: LooDatabase, threadIds: string[]): void {
  const uniqueThreadIds = unique(threadIds).filter(Boolean);
  if (uniqueThreadIds.length === 0) return;
  deletePreparedCardsForThreadIds(db, uniqueThreadIds);
  for (let index = 0; index < uniqueThreadIds.length; index += SUMMARY_LEAF_EDGE_DELETE_BATCH_SIZE) {
    const batch = uniqueThreadIds.slice(index, index + SUMMARY_LEAF_EDGE_DELETE_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(",");
    const leafRows = db.prepare(`SELECT leaf_ref AS leafRef FROM summary_leaves WHERE thread_id IN (${placeholders})`).all(...batch) as Array<{ leafRef: string }>;
    deleteSummaryLeafEdges(db, leafRows.map((row) => String(row.leafRef)));
    db.prepare(`DELETE FROM summary_leaves WHERE thread_id IN (${placeholders})`).run(...batch);
  }
}

function getSummaryLeafByRef(db: LooDatabase, leafRef: string, threadId?: string): SummaryLeaf | null {
  if (!isPublicSummaryLeafRef(leafRef)) return null;
  const clauses = [
    "leaf_ref = ?",
    "privacy_class = ?",
    "omission_status = ?",
    "extractor_version = ?"
  ];
  const params: Array<string | number> = [
    leafRef,
    "public_safe_metadata",
    "metadata_only",
    SUMMARY_LEAF_EXTRACTOR_VERSION
  ];
  if (threadId) {
    clauses.push("thread_id = ?");
    params.push(threadId);
  }
  const row = db.prepare(`
    SELECT
      leaf_ref AS leafRef,
      thread_id AS threadId,
      leaf_kind AS leafKind,
      summary_text AS summaryText,
      source_refs_json AS sourceRefsJson,
      source_range_refs_json AS sourceRangeRefsJson,
      input_hash AS inputHash,
      output_hash AS outputHash,
      extractor_version AS extractorVersion,
      privacy_class AS privacyClass,
      authority_coverage_json AS authorityCoverageJson,
      confidence,
      freshness_at AS freshnessAt,
      stale,
      omission_status AS omissionStatus
    FROM summary_leaves
    WHERE ${clauses.join(" AND ")}
    LIMIT 1
  `).get(...params) as SummaryLeafRow | undefined;
  return row ? publicSummaryLeafFromRow(row) : null;
}

function publicSummaryLeafFromRow(row: SummaryLeafRow): SummaryLeaf | null {
  const sourceRefs = parseSourceRefsJson(row.sourceRefsJson);
  const sourceRangeRefs = parseSourceRefsJson(row.sourceRangeRefsJson);
  const authorityCoverage = parseObjectJson(row.authorityCoverageJson);
  if (!isPublicSummaryLeafRow(row, sourceRefs, sourceRangeRefs, authorityCoverage)) return null;
  const rangeCount = summaryLeafAuthorityRangeCount(authorityCoverage);
  const cappedSourceRangeRefs = sourceRangeRefs.slice(0, SUMMARY_LEAF_SOURCE_RANGE_REF_LIMIT);
  return {
    schema: "lco.summary.leaf.v1",
    leafRef: row.leafRef,
    threadId: row.threadId,
    leafKind: row.leafKind as SummaryLeafKind,
    summaryText: publicSafeText(row.summaryText, 500),
    sourceRefs,
    sourceRangeRefs: cappedSourceRangeRefs,
    sourceRangeRefsOmitted: Math.max(0, rangeCount - cappedSourceRangeRefs.length),
    inputHash: row.inputHash,
    outputHash: row.outputHash,
    extractorVersion: SUMMARY_LEAF_EXTRACTOR_VERSION,
    privacyClass: "public_safe_metadata",
    authorityCoverage: sanitizeSummaryAuthorityCoverage(authorityCoverage),
    confidence: Number(row.confidence),
    freshnessAt: row.freshnessAt,
    stale: Number(row.stale) === 1,
    omissionStatus: "metadata_only"
  };
}

function isPublicSummaryLeafRow(row: SummaryLeafRow, sourceRefs: string[], sourceRangeRefs: string[], authorityCoverage: Record<string, unknown>): boolean {
  const threadId = row.threadId ?? "";
  const rangeCount = summaryLeafAuthorityRangeCount(authorityCoverage);
  return row.extractorVersion === SUMMARY_LEAF_EXTRACTOR_VERSION
    && row.privacyClass === "public_safe_metadata"
    && row.omissionStatus === "metadata_only"
    && isPublicSummaryLeafRef(row.leafRef)
    && isSummaryLeafKind(row.leafKind)
    && isPublicSummaryThreadId(threadId)
    && sourceRefs.length > 0
    && sourceRefs.every(isPublicPreparedSourceRef)
    && sourceRefs.includes(codexThreadRef(threadId))
    && sourceRangeRefs.length > 0
    && sourceRangeRefs.every((ref) => /^codex_range:[0-9a-f]{32}$/.test(ref))
    && rangeCount >= sourceRangeRefs.length
    && /^[0-9a-f]{32}$/.test(row.inputHash)
    && /^[0-9a-f]{32}$/.test(row.outputHash)
    && Number.isFinite(Number(row.confidence))
    && Number(row.confidence) >= 0
    && Number(row.confidence) <= 1
    && (row.freshnessAt === null || isSafeIsoTimestamp(row.freshnessAt))
    && !looksSensitiveRefLike(row.summaryText)
    && publicSafeText(row.summaryText, 500) === row.summaryText
    && row.summaryText === summaryLeafText(row.leafKind, rangeCount);
}

function sanitizeSummaryAuthorityCoverage(value: Record<string, unknown>): Record<string, unknown> {
  const source = value.source === "prepared_source_ranges" ? "prepared_source_ranges" : "unknown";
  const status = ["ok", "partial", "not_configured", "unknown"].includes(String(value.status)) ? String(value.status) : "unknown";
  const out: Record<string, unknown> = { source, status };
  const rangeCount = Number(value.rangeCount);
  if (Number.isInteger(rangeCount) && rangeCount >= 0 && rangeCount <= 1_000_000) out.rangeCount = rangeCount;
  return out;
}

function summaryLeafAuthorityRangeCount(value: Record<string, unknown>): number {
  const rangeCount = Number(value.rangeCount);
  return Number.isInteger(rangeCount) && rangeCount >= 0 && rangeCount <= 1_000_000 ? rangeCount : -1;
}

function isPublicSummaryLeafRef(value: string): boolean {
  return /^summary_leaf:[0-9a-f]{32}$/.test(value);
}

function isPublicSummaryThreadId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,160}$/.test(value) && !looksSensitiveRefLike(value);
}

function isSummaryLeafKind(value: string): value is SummaryLeafKind {
  return ["user_prompt", "assistant_message", "proposed_plan", "final_message", "closeout", "tool_call_metadata", "event_metadata"].includes(value);
}

function parseObjectJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function latestIso(values: Array<string | null>): string | null {
  const timestamps = values.flatMap((value) => value && isSafeIsoTimestamp(value) ? [Date.parse(value)] : []);
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function probeCodexSqliteStores(roots: string[], maxFiles = 100): { stores: CodexSqliteProbe[] } {
  const paths = collectSqliteFiles(roots, maxFiles);
  return { stores: paths.map((path) => probeCodexSqliteStore(path)) };
}

export function searchSessions(db: LooDatabase, options: {
  query: string;
  limit?: number;
  appServerThreads?: AppServerThreadsInput | null;
  now?: string;
  telemetry?: boolean;
  telemetrySessionId?: string;
}): SessionSearchResult[] {
  const results = searchCodexSessions(db, options);
  if (retrievalTelemetryEnabled(options.telemetry)) {
    recordTelemetrySearchEvent(db, {
      query: options.query,
      results,
      telemetrySessionId: options.telemetrySessionId,
      now: options.now
    });
  }
  return results;
}

function retrievalTelemetryEnabled(explicit?: boolean): boolean {
  // The env fallback is an intentional local opt-in write path for callers that
  // omit the explicit flag. Explicit false is definitive so nested recall calls
  // can suppress duplicate derived-cache writes even when LCO_TELEMETRY=1.
  if (explicit !== undefined) return explicit;
  return readEnv("TELEMETRY") === "1";
}

function recordTelemetrySearchEvent(db: LooDatabase, options: {
  query: string;
  results: Array<{ sourceRef: string; matchFeatures?: CodexSearchMatchFeatures }>;
  telemetrySessionId?: string;
  now?: string;
}): void {
  try {
    recordTelemetrySearchEventUnchecked(db, options);
  } catch {
    // Retrieval telemetry is an optional derived-cache side effect; never let it
    // block the primary search/describe/expand result.
  }
}

function recordTelemetrySearchEventUnchecked(db: LooDatabase, options: {
  query: string;
  results: Array<{ sourceRef: string; matchFeatures?: CodexSearchMatchFeatures }>;
  telemetrySessionId?: string;
  now?: string;
}): void {
  const query = options.query.trim();
  if (!query) return;
  const telemetrySessionKey = retrievalTelemetrySessionKey(options.telemetrySessionId);
  if (!telemetrySessionKey) return;
  const nowIso = telemetryTimestamp(options.now);
  pruneRetrievalTelemetry(db, nowIso);
  const resultRefs = options.results.map((result) => result.sourceRef).filter(Boolean);
  db.prepare(`
    INSERT INTO telemetry_search_events (
      id, ts, query_text, query_hash, telemetry_session_key, result_refs_json, matched_field_distribution_json, engine_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `tel_search_${randomUUID()}`,
    nowIso,
    "",
    sha256Hex(query),
    telemetrySessionKey,
    JSON.stringify(resultRefs),
    JSON.stringify(matchedFieldDistribution(options.results)),
    RETRIEVAL_TELEMETRY_ENGINE_VERSION
  );
}

function recordTelemetryFollowEvent(db: LooDatabase, options: {
  sourceRef: string;
  followKind: RetrievalTelemetryFollowKind;
  telemetrySessionId?: string;
  now?: string;
  telemetry?: boolean;
}): void {
  try {
    recordTelemetryFollowEventUnchecked(db, options);
  } catch {
    // Retrieval telemetry is an optional derived-cache side effect; never let it
    // block the primary search/describe/expand result.
  }
}

function recordTelemetryFollowEventUnchecked(db: LooDatabase, options: {
  sourceRef: string;
  followKind: RetrievalTelemetryFollowKind;
  telemetrySessionId?: string;
  now?: string;
  telemetry?: boolean;
}): void {
  if (!retrievalTelemetryEnabled(options.telemetry)) return;
  const sourceRef = options.sourceRef.trim();
  if (!sourceRef) return;
  const nowIso = telemetryTimestamp(options.now);
  pruneRetrievalTelemetry(db, nowIso);
  const recent = latestTelemetrySearchEventForRef(db, sourceRef, nowIso, retrievalTelemetrySessionKey(options.telemetrySessionId));
  if (!recent) return;
  db.prepare(`
    INSERT INTO telemetry_follow_events (
      id, ts, search_event_id, chosen_ref, rank_position, follow_kind
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    `tel_follow_${randomUUID()}`,
    nowIso,
    recent.searchEventId,
    sourceRef,
    recent.rankPosition,
    options.followKind
  );
}

function latestTelemetrySearchEventForRef(db: LooDatabase, sourceRef: string, nowIso: string, telemetrySessionKey: string | null): { searchEventId: string; rankPosition: number } | null {
  if (!telemetrySessionKey) return null;
  const nowMs = timestampMillis(nowIso) ?? Date.now();
  const sinceIso = new Date(nowMs - RETRIEVAL_TELEMETRY_WINDOW_MS).toISOString();
  const rows = db.prepare(`
    SELECT id, result_refs_json AS resultRefsJson
    FROM telemetry_search_events
    WHERE telemetry_session_key = ? AND ts >= ? AND ts <= ?
    ORDER BY ts DESC, id DESC
    LIMIT ?
  `).all(telemetrySessionKey, sinceIso, nowIso, RETRIEVAL_TELEMETRY_CORRELATION_SEARCH_LIMIT) as Array<{ id: string; resultRefsJson: string }>;
  for (const row of rows) {
    const refs = parseStringArrayJson(row.resultRefsJson);
    const index = refs.indexOf(sourceRef);
    if (index >= 0) return { searchEventId: row.id, rankPosition: index + 1 };
  }
  return null;
}

function retrievalTelemetrySessionKey(explicit?: string): string | null {
  const raw = explicit ?? readEnv("TELEMETRY_SESSION_ID");
  const value = raw?.trim();
  if (!value) return null;
  return sha256Hex(value);
}

function pruneRetrievalTelemetry(db: LooDatabase, nowIso: string): void {
  const nowMs = timestampMillis(nowIso) ?? Date.now();
  const lastPruneMs = retrievalTelemetryLastPruneByDb.get(db);
  if (lastPruneMs !== undefined && nowMs - lastPruneMs < RETRIEVAL_TELEMETRY_PRUNE_INTERVAL_MS) return;
  const cutoffIso = new Date(nowMs - RETRIEVAL_TELEMETRY_HARVEST_LOOKBACK_MS).toISOString();
  db.prepare(`
    DELETE FROM telemetry_follow_events
    WHERE rowid IN (
      SELECT rowid FROM telemetry_follow_events
      WHERE ts < ?
      ORDER BY ts ASC
      LIMIT ?
    )
  `).run(cutoffIso, RETRIEVAL_TELEMETRY_PRUNE_BATCH_SIZE);
  db.prepare(`
    DELETE FROM telemetry_search_events
    WHERE rowid IN (
      SELECT rowid FROM telemetry_search_events
      WHERE ts < ?
      ORDER BY ts ASC
      LIMIT ?
    )
  `).run(cutoffIso, RETRIEVAL_TELEMETRY_PRUNE_BATCH_SIZE);
  retrievalTelemetryLastPruneByDb.set(db, nowMs);
}

function matchedFieldDistribution(results: Array<{ matchFeatures?: CodexSearchMatchFeatures }>): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (const result of results) {
    for (const field of result.matchFeatures?.matchedFields ?? []) {
      distribution[field] = (distribution[field] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(distribution).sort(([left], [right]) => left.localeCompare(right)));
}

function parseStringArrayJson(value: unknown): string[] {
  return parseJsonArray(value).filter((entry): entry is string => typeof entry === "string");
}

function telemetryTimestamp(now?: string): string {
  const parsed = timestampMillis(now ?? null);
  return parsed === null ? new Date().toISOString() : new Date(parsed).toISOString();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function threadTitleAliasSearchResults(db: LooDatabase, query: string, nowMs: number): SessionSearchResult[] {
  const queryKey = normalizedTitle(query);
  if (!queryKey) return [];
  const rows = db.prepare(`
    SELECT
      a.thread_id AS threadId,
      a.alias_text AS aliasText,
      a.alias_norm AS aliasNorm,
      a.updated_at AS updatedAt,
      s.title AS title,
      s.summary AS summary,
      s.updated_at AS sessionUpdatedAt
    FROM codex_thread_title_aliases a
    LEFT JOIN codex_sessions s ON s.thread_id = a.thread_id
    WHERE a.alias_kind = 'thread_title_finalizer'
    ORDER BY COALESCE(s.updated_at, a.updated_at) DESC
    LIMIT 250
  `).all() as Array<Record<string, unknown>>;
  return rows.filter((row) => titleAliasMatchesQuery(String(row.aliasNorm ?? ""), queryKey)).slice(0, 25).map((row, index) => {
    const threadId = String(row.threadId);
    const updatedAt = nullableString(row.sessionUpdatedAt) ?? nullableString(row.updatedAt);
    const aliasText = publicSafeSearchText(String(row.aliasText ?? ""), 160);
    return {
      sourceKind: "codex_thread",
      sourceRef: codexThreadRef(threadId),
      threadId,
      title: nullablePublicSafeSearchString(row.title, 160) ?? aliasText,
      summary: nullablePublicSafeSearchString(row.summary, 900),
      updatedAt,
      score: index + 1,
      snippet: publicSafeSearchText(`Thread title alias: ${aliasText}`, 260),
      matchKind: "thread_title_alias",
      freshness: sessionFreshness(updatedAt, nowMs),
      reasonCodes: unique([
        "thread_title_finalizer_alias",
        "derived_cache_alias",
        row.title ? "" : "index_refresh_recommended"
      ].filter(Boolean))
    };
  });
}

function titleAliasMatchesQuery(aliasNorm: string, queryKey: string): boolean {
  if (aliasNorm === queryKey) return true;
  const queryTokens = queryKey.split(" ").filter((token) => token.length >= 3);
  if (queryTokens.length < 2) return false;
  const aliasTokens = new Set(aliasNorm.split(" ").filter(Boolean));
  return queryTokens.every((token) => aliasTokens.has(token));
}

function codexSearchRowByThreadId(db: LooDatabase, threadId: string): Record<string, unknown> | null {
  const row = db.prepare(`
    SELECT thread_id AS threadId, title, summary, updated_at AS updatedAt, safe_text AS safeText
    FROM codex_sessions
    WHERE thread_id = ?
  `).get(threadId) as Record<string, unknown> | undefined;
  return row ?? null;
}

function searchThreadIdCandidate(query: string): string | null {
  const bare = bareCodexThreadId(query.trim());
  if (!bare || /\s/.test(bare)) return null;
  if (!/^[A-Za-z0-9._:-]{4,200}$/.test(bare)) return null;
  return bare;
}

function sessionSearchResultFromRow(
  row: Record<string, unknown>,
  score: number,
  snippet: string,
  matchKind: SessionSearchResult["matchKind"],
  reasonCodes: string[],
  nowMs: number
): SessionSearchResult {
  const threadId = String(row.threadId);
  const updatedAt = nullableString(row.updatedAt);
  return {
    sourceKind: "codex_thread",
    sourceRef: codexThreadRef(threadId),
    threadId,
    title: nullablePublicSafeSearchString(row.title, 160),
    summary: nullablePublicSafeSearchString(row.summary, 900),
    updatedAt,
    score,
    snippet: publicSafeSearchText(snippet, 260),
    matchKind,
    freshness: sessionFreshness(updatedAt, nowMs),
    reasonCodes: unique(reasonCodes.map((code) => publicSafeText(code, 80)))
  };
}

function appServerAliasSearchResults(
  db: LooDatabase,
  appServerThreads: AppServerThreadsInput | null,
  query: string,
  nowMs: number
): SessionSearchResult[] {
  const queryKey = normalizedTitle(query);
  if (!appServerThreads || !queryKey) return [];
  const results: SessionSearchResult[] = [];
  for (const thread of appServerThreads.threads ?? []) {
    const publicThread = publicAppServerThreadSignal(thread);
    const aliases = appServerSearchAliases(publicThread);
    const matchedAlias = aliases.find((alias) => aliasMatchesSearch(alias, queryKey));
    if (!matchedAlias) continue;
    const row = codexSearchRowByThreadId(db, publicThread.threadId);
    if (row) {
      results.push(sessionSearchResultFromRow(row, results.length + 1, `App-server alias: ${matchedAlias}`, "app_server_alias", ["app_server_alias", "read_only_app_server_signal"], nowMs));
    } else {
      const updatedAt = publicThread.updatedAt ?? null;
      results.push({
        sourceKind: "codex_thread",
        sourceRef: codexThreadRef(publicThread.threadId),
        threadId: publicThread.threadId,
        title: publicThread.titleSanitized ?? null,
        summary: null,
        updatedAt,
        score: results.length + 1,
        snippet: publicSafeText(`App-server alias: ${matchedAlias}`, 260),
        matchKind: "app_server_alias",
        freshness: sessionFreshness(updatedAt, nowMs),
        reasonCodes: ["app_server_alias", "read_only_app_server_signal", "app_server_unindexed", "index_refresh_recommended"]
      });
    }
  }
  return results;
}

function appServerSearchAliases(thread: ReturnType<typeof publicAppServerThreadSignal>): string[] {
  return unique([
    thread.titleSanitized ?? "",
    ...(thread.titleAliases ?? [])
  ].map((value) => publicSafeText(value, 160).trim()).filter(Boolean)).slice(0, 12);
}

function aliasMatchesSearch(alias: string, queryKey: string): boolean {
  const aliasKey = normalizedTitle(alias);
  return aliasKey.length > 0 && (aliasKey === queryKey || aliasKey.includes(queryKey) || queryKey.includes(aliasKey));
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

export function describeSession(db: LooDatabase, threadId: string, options: { telemetry?: boolean; telemetrySessionId?: string; now?: string } = {}): SessionDescription | null {
  const row = db.prepare(`
    SELECT thread_id AS threadId, title, cwd, model, branch, git_sha AS gitSha, summary, final_message AS finalMessage,
      source_path AS sourcePath, tool_call_count AS toolCallCount
    FROM codex_sessions
    WHERE thread_id = ?
  `).get(threadId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const result: SessionDescription = {
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
  recordTelemetryFollowEvent(db, {
    sourceRef: result.sourceRef,
    followKind: "describe",
    telemetry: options.telemetry,
    telemetrySessionId: options.telemetrySessionId,
    now: options.now
  });
  return result;
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
  const sourceRef = description.sourcePath.startsWith("claude_source:")
    ? description.sourcePath
    : publicSourcePathRef(description.sourcePath);
  return [
    `Claude session ID: ${description.sessionId}`,
    `Ref: ${description.sourceRef}`,
    description.title ? `Title: ${publicSafeText(description.title, 500)}` : null,
    description.project ? `Project: ${publicSafeText(description.project, 500)}` : null,
    description.workspaceHint ? `Workspace: ${publicSafeText(description.workspaceHint, 500)}` : null,
    description.status ? `Status: ${description.status}` : null,
    description.updatedAt ? `Updated: ${description.updatedAt}` : null,
    `Source ref: ${sourceRef}`,
    description.sourceRefs.length ? `Source refs: ${description.sourceRefs.map((ref) => publicSafeText(ref, 180)).join(", ")}` : null,
    "Public-safe Claude recall metadata only; no private transcript content is returned."
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

export function persistWatcherObservations(
  db: LooDatabase,
  specs: WatchSpec[],
  options: { now?: string } = {}
): WatcherPersistenceReport {
  const nowMs = timestampMillis(options.now ?? null) ?? Date.now();
  let generatedAt: string;
  const summary = {
    specs: 0,
    observations: 0,
    queueItems: 0,
    skippedUnsafeRows: 0
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    generatedAt = allocateSessionDiffMutationTimestamp(db, new Date(nowMs).toISOString());
    for (const spec of specs) {
      assertWatcherSpecDoesNotMutate(spec);
      const watcher = watcherStateFromSpec(spec, nowMs);
      const safeSpec = publicSafePersistedWatchSpec(spec, watcher);
      const sourceRefs = watcherSourceRefs(watcher);
      const inputHash = stableId(canonicalJsonString({ safeSpec, watcher, extractorVersion: "watcher-observations-v1" }));
      const observedAt = watcher.lastObservedAt ?? generatedAt;
      // Same spec + same observedAt is an idempotent replay, not a second observation.
      const observationId = stableId(`watcher-observation:${watcher.watchId}:${watcher.targetRef}:${inputHash}:${observedAt}`);
      const previousObservation = db.prepare(`
        SELECT observation_id AS observationId, created_at AS createdAt
        FROM watcher_observations
        WHERE watch_id = ? AND target_ref = ?
      `).get(watcher.watchId, watcher.targetRef) as { observationId: string; createdAt: string } | undefined;
      const previousCreatedAt = previousObservation ? publicIsoTimestamp(previousObservation.createdAt) : null;
      const observationCreatedAt = previousObservation?.observationId === observationId
        ? previousCreatedAt ?? generatedAt
        : generatedAt;
      const evidenceRefs = watcher.evidenceIds;
      db.prepare(`
        INSERT INTO watcher_specs (
          watch_id, target_ref, spec_json, input_hash, privacy_class, confidence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(watch_id) DO UPDATE SET
          target_ref = excluded.target_ref,
          spec_json = excluded.spec_json,
          input_hash = excluded.input_hash,
          privacy_class = excluded.privacy_class,
          confidence = excluded.confidence,
          updated_at = excluded.updated_at
      `).run(
        watcher.watchId,
        watcher.targetRef,
        JSON.stringify(safeSpec),
        inputHash,
        "public_safe_metadata",
        watcher.confidence,
        generatedAt,
        generatedAt
      );
      db.prepare("DELETE FROM watcher_observations WHERE watch_id = ? AND target_ref = ?").run(watcher.watchId, watcher.targetRef);
      db.prepare(`
        INSERT OR REPLACE INTO watcher_observations (
          observation_id, watch_id, target_ref, observation_json, evidence_refs_json,
          input_hash, privacy_class, confidence, observed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        observationId,
        watcher.watchId,
        watcher.targetRef,
        JSON.stringify(watcher),
        JSON.stringify(evidenceRefs),
        inputHash,
        "public_safe_metadata",
        watcher.confidence,
        observedAt,
        observationCreatedAt
      );
      const watcherSourceRef = watcherSourceRefForWatchId(watcher.watchId);
      const queueRowsForTarget = db.prepare(`
        SELECT queue_id AS queueId, source_refs_json AS sourceRefsJson
        FROM attention_queue
        WHERE target_ref = ?
          AND item_kind IN ('watcher_resume_request', 'watcher_inspection')
      `).all(watcher.targetRef) as Array<{ queueId: string; sourceRefsJson: string }>;
      const deleteQueueById = db.prepare("DELETE FROM attention_queue WHERE queue_id = ?");
      for (const row of queueRowsForTarget) {
        if (parseSourceRefsJson(row.sourceRefsJson).includes(watcherSourceRef)) deleteQueueById.run(row.queueId);
      }
      const queue = watcherAttentionQueueDraft(watcher, safeSpec);
      if (queue) {
        db.prepare(`
          INSERT INTO attention_queue (
            queue_id, target_ref, item_kind, status, tool_call_json, execute_false,
            source_refs_json, reason_codes_json, confidence, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(queue_id) DO UPDATE SET
            status = excluded.status,
            tool_call_json = excluded.tool_call_json,
            execute_false = 1,
            source_refs_json = excluded.source_refs_json,
            reason_codes_json = excluded.reason_codes_json,
            confidence = excluded.confidence,
            updated_at = excluded.updated_at
        `).run(
          queue.queueId,
          queue.targetRef,
          queue.itemKind,
          queue.status,
          JSON.stringify(queue.toolCall),
          1,
          JSON.stringify(sourceRefs),
          JSON.stringify(queue.reasonCodes),
          queue.confidence,
          generatedAt,
          generatedAt
        );
        summary.queueItems += 1;
      }
      summary.specs += 1;
      summary.observations += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    schema: "lco.watchers.persistence.v1",
    publicSafe: false,
    readOnly: false,
    mutationClasses: ["derived_cache"],
    generatedAt,
    summary,
    actionsPerformed: watcherWriteActions(),
    proofBoundary: "Watcher observation persistence writes only sanitized LCO-owned derived-cache rows and execute=false attention queue items. It does not mint approval audit ids, resume/send/steer/interrupt Codex, mutate source stores, write external systems, perform GUI actions, read raw transcripts, publish npm, or create GitHub releases."
  };
}

export function getWatcherEvents(db: LooDatabase, options: WatcherEventsOptions = {}): WatcherEventsReport {
  const generatedAt = publicIsoTimestamp(options.now) ?? new Date().toISOString();
  const limit = clamp(options.limit ?? 100, 1, 1000);
  const requestedWatchId = options.watchId ? publicSafeWatcherIdentifier(options.watchId, "watch") : null;
  const requestedTargetRef = options.targetRef ? publicSafeWatcherTargetRef(options.targetRef) : null;
  const observationClauses = ["privacy_class = 'public_safe_metadata'"];
  const observationParams: string[] = [];
  if (requestedWatchId) {
    observationClauses.push("watch_id = ?");
    observationParams.push(requestedWatchId);
  }
  if (requestedTargetRef) {
    observationClauses.push("target_ref = ?");
    observationParams.push(requestedTargetRef);
  }
  const observationWhere = `WHERE ${observationClauses.join(" AND ")}`;
  const observationRows = db.prepare(`
    SELECT
      observation_id AS observationId,
      watch_id AS watchId,
      target_ref AS targetRef,
      observation_json AS observationJson,
      evidence_refs_json AS evidenceRefsJson,
      privacy_class AS privacyClass,
      confidence,
      observed_at AS observedAt
    FROM watcher_observations
    ${observationWhere}
    ORDER BY observed_at DESC, watch_id ASC, observation_id ASC
  `).all(...observationParams) as WatcherObservationRow[];
  const observations: WatcherObservationRecord[] = [];
  let filteredUnsafeRows = 0;
  for (const row of observationRows) {
    const observation = publicWatcherObservationFromRow(row);
    if (!observation) {
      filteredUnsafeRows += 1;
      continue;
    }
    observations.push(observation);
  }
  observations.sort((left, right) => watcherStateComparator(left.watcher, right.watcher) || right.observedAt.localeCompare(left.observedAt) || left.observationRef.localeCompare(right.observationRef));
  const selectedObservations = observations.slice(0, limit);
  const queueRowsRaw = db.prepare(`
    SELECT
      queue_id AS queueId,
      target_ref AS targetRef,
      item_kind AS itemKind,
      status,
      tool_call_json AS toolCallJson,
      execute_false AS executeFalse,
      source_refs_json AS sourceRefsJson,
      reason_codes_json AS reasonCodesJson,
      confidence,
      updated_at AS updatedAt
    FROM attention_queue
    WHERE execute_false = 1
      AND item_kind IN ('watcher_resume_request', 'watcher_inspection')
      ${requestedTargetRef ? "AND target_ref = ?" : ""}
    ORDER BY confidence DESC, updated_at DESC, queue_id ASC
  `).all(...[
    ...(requestedTargetRef ? [requestedTargetRef] : [])
  ]) as WatcherAttentionQueueRow[];
  const requestedWatcherSourceRef = requestedWatchId ? watcherSourceRefForWatchId(requestedWatchId) : null;
  const queueRows = requestedWatcherSourceRef
    ? queueRowsRaw.filter((row) => parseSourceRefsJson(row.sourceRefsJson).includes(requestedWatcherSourceRef))
    : queueRowsRaw;
  const queueItems: WatcherAttentionQueueItem[] = [];
  let filteredUnsafeQueueRows = 0;
  for (const row of queueRows) {
    const item = publicWatcherAttentionQueueItemFromRow(row);
    if (item) queueItems.push(item);
    else filteredUnsafeQueueRows += 1;
  }
  const queue = queueItems.slice(0, limit);
  const observationLimitCount = Math.max(0, observations.length - selectedObservations.length);
  const queueLimitCount = Math.max(0, queueItems.length - queue.length);
  const limitCount = observationLimitCount + queueLimitCount;
  const filteredUnsafeTotal = filteredUnsafeRows + filteredUnsafeQueueRows;
  const omittedReasons = [
    limitCount > 0 ? "limit" : null,
    filteredUnsafeTotal > 0 ? "filtered_unsafe_rows" : null
  ].filter((reason): reason is "limit" | "filtered_unsafe_rows" => Boolean(reason));
  const watcherSpecCount = watcherSpecCoverageCount(db, requestedWatchId, requestedTargetRef);
  return {
    schema: "lco.watchers.events.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt,
    sourceCoverage: {
      watcherSpecs: coverageFromCounts(watcherSpecCount, watcherSpecCount),
      watcherObservations: coverageFromPublicRows(observationRows.length, observations.length),
      attentionQueue: coverageFromPublicRows(queueRows.length, queueItems.length)
    },
    summary: {
      total: observations.length,
      returned: selectedObservations.length,
      active: selectedObservations.filter((observation) => observation.watcher.status === "active").length,
      triggered: selectedObservations.filter((observation) => observation.watcher.status === "triggered").length,
      stale: selectedObservations.filter((observation) => observation.watcher.status === "stale").length,
      expired: selectedObservations.filter((observation) => observation.watcher.status === "expired").length,
      lowConfidence: selectedObservations.filter((observation) => observation.watcher.status === "low_confidence").length,
      queueItems: queue.length,
      filteredUnsafeRows: filteredUnsafeTotal
    },
    observations: selectedObservations,
    queue,
    omitted: {
      count: limitCount + filteredUnsafeTotal,
      reason: omittedReasons.length === 2 ? "limit_and_filtered_unsafe_rows" : omittedReasons[0] ?? "none",
      reasons: omittedReasons.length ? omittedReasons : ["none"],
      limitCount,
      observationLimitCount,
      queueLimitCount,
      filteredUnsafeRows: filteredUnsafeTotal,
      filteredUnsafeObservationRows: filteredUnsafeRows,
      filteredUnsafeQueueRows
    },
    actionsPerformed: watcherReadActions(),
    proofBoundary: "Watcher events expose only public-safe persisted watcher observations and execute=false local attention queue items from LCO-owned derived cache. They do not read raw transcripts, mint approvals, run live control, mutate Desktop GUI, write external systems, publish npm, or create GitHub releases."
  };
}

type SessionDiffCursorPayload = {
  schema: "lco.session.diff.cursor.v1";
  issuedAt: string;
  watermarkAt: string;
  watermarkChangeKind: SessionDiffChangeKind | null;
  watermarkChangeRef: string | null;
  watermarkKey: string | null;
  threadId: string | null;
  targetRef: string | null;
  snapshot: SessionDiffSnapshot;
};

type SessionDiffSnapshot = {
  sourceContentDigest: string;
  sourceEpochDigest: string;
  sourceAppendGeneration: number;
  sourceDestructiveGeneration: number;
  sourceFileDigest: string;
  sourceFileCount: number;
  sourceBytes: number;
  sourceEventCount: number;
  sourceRangeCount: number;
  summaryLeafCount: number;
  preparedCardCount: number;
  preparedInboxItemCount: number;
  watcherObservationCount: number;
  stateHash: string;
};

const SESSION_DIFF_CURSOR_MAX_CHARS = 16_384;
const SESSION_DIFF_SOURCE_RANGE_CURSOR_KEY_SQL = "session_diff_key";

export function isSessionDiffSetupError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /^Session diff cursor signing key is required(?:;|$)/.test(error.message)
    || /^Audit fingerprint key is (?:invalid|unavailable)(?:$|:)/.test(error.message);
}

export function createSessionDiffSetupRequiredReport(surface: "cli" | "mcp"): SessionDiffSetupReport {
  return {
    schema: "lco.session.diff.setup.v1",
    publicSafe: true,
    readOnly: true,
    ok: false,
    status: "setup_required",
    blockers: ["session_diff_cursor_signing_key_required"],
    nextSafeCommands: [
      surface === "cli"
        ? "Configure LCO_SESSION_DIFF_CURSOR_KEY from a local secret store, then retry lco session-diff."
        : "Configure LCO_SESSION_DIFF_CURSOR_KEY from a local secret store, then retry lco_session_diff."
    ],
    actionsPerformed: {
      rawTranscriptRead: false,
      sourceStoreMutation: false,
      derivedCacheWrite: false,
      liveControl: false,
      guiMutation: false,
      externalWrite: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    proofBoundary: "Session diff setup checks do not expose cursor keys, audit-key paths, raw source data, or local transcript content."
  };
}

export function resolveSessionDiffCursorKey(
  configuredKey: string | undefined,
  auditFallbackKey: string | null | undefined
): Pick<SessionDiffOptions, "cursorSigningKey" | "cursorKeySource"> {
  return {
    cursorSigningKey: configuredKey ?? auditFallbackKey ?? undefined,
    cursorKeySource: configuredKey ? "environment" : auditFallbackKey ? "audit_fallback" : undefined
  };
}

export function allocateSessionDiffMutationTimestamp(db: LooDatabase, proposedAt = new Date().toISOString()): string {
  const proposed = publicIsoTimestamp(proposedAt) ?? new Date().toISOString();
  const proposedMs = timestampMillis(proposed) ?? Date.now();
  const row = db.prepare(`
    SELECT MAX(changed_at) AS changedAt
    FROM (
      SELECT MAX(created_at) AS changed_at FROM prepared_source_ranges
      UNION ALL SELECT MAX(created_at) FROM summary_leaves
      UNION ALL SELECT MAX(updated_at) FROM prepared_cards
      UNION ALL SELECT MAX(updated_at) FROM prepared_inbox_items
      UNION ALL SELECT MAX(created_at) FROM watcher_observations
    )
  `).get() as { changedAt?: unknown } | undefined;
  const latestAt = typeof row?.changedAt === "string" ? publicIsoTimestamp(row.changedAt) : null;
  const latestMs = timestampMillis(latestAt);
  return latestMs !== null && proposedMs <= latestMs
    ? new Date(latestMs + 1).toISOString()
    : proposed;
}

function sessionDiffSourceRangeCursorKey(
  sourcePathRef: string,
  ordinal: number,
  rangeKind: string,
  contentHash: string
): string {
  return `${sourcePathRef}:${String(Math.max(0, Math.trunc(ordinal))).padStart(12, "0")}:${rangeKind}:${contentHash}`;
}

type SessionDiffCursorParseResult = {
  status: Exclude<SessionDiffCursorStatus, "none">;
  payload: SessionDiffCursorPayload | null;
  reasonCodes: string[];
};

type SessionDiffCandidate = SessionDiffChange & {
  approxTokens: number;
  cursorKey: string;
};

type SessionDiffCursorWatermark = {
  changedAt: string;
  changeKind: SessionDiffChangeKind | null;
  changeRef: string | null;
  key: string | null;
};

type SessionDiffCollectorResult = {
  counts: SessionDiffSafeCounts;
  changedRows: number;
  filteredUnsafeRows: number;
  invalidTimestampRows: number;
  changes: SessionDiffCandidate[];
  scanWatermark: SessionDiffCursorWatermark | null;
  scanExhausted: boolean;
};

type SessionDiffSafeCounts = {
  raw: number;
  safe: number;
};

export function getSessionDiff(db: LooDatabase, options: SessionDiffOptions = {}): SessionDiffReport {
  const generatedAt = publicIsoTimestamp(options.now) ?? new Date().toISOString();
  const limit = clamp(options.limit ?? 50, 1, 500);
  const tokenBudget = clamp(options.tokenBudget ?? 1000, 20, 8000);
  const threadId = optionalPublicThreadId(options.threadId);
  const explicitTargetRef = optionalSessionDiffTargetRef(options.targetRef) ?? null;
  if (options.threadId !== undefined && !threadId) throw new Error("Invalid session diff thread id");
  if (options.targetRef !== undefined && !explicitTargetRef) throw new Error("Invalid session diff target ref");
  if (threadId && explicitTargetRef && explicitTargetRef !== codexThreadRef(threadId)) {
    throw new Error("Conflicting session diff scope");
  }
  const targetRef = threadId ? codexThreadRef(threadId) : explicitTargetRef;
  const cursorSigningKey = sessionDiffCursorSigningKey(options.cursorSigningKey);
  const cursorKeySource = sessionDiffCursorKeySource(options);
  const cursor = parseSessionDiffCursor(options.cursor, cursorSigningKey);
  const snapshot = createSessionDiffSnapshot(db, { threadId, targetRef });
  const cursorReasonCodes = [...cursor.reasonCodes];
  let cursorStatus: SessionDiffCursorStatus = options.cursor ? cursor.status : "none";
  if (cursor.payload) {
    if (cursor.payload.threadId !== (threadId ?? null)) {
      cursorStatus = "invalid";
      cursorReasonCodes.push("cursor_thread_mismatch");
    }
    if (cursor.payload.targetRef !== (targetRef ?? null)) {
      cursorStatus = "invalid";
      cursorReasonCodes.push("cursor_target_mismatch");
    }
    if (cursorStatus === "accepted") {
      const staleReasons = sessionDiffSnapshotStaleReasons(cursor.payload.snapshot, snapshot);
      if (staleReasons.length > 0) {
        cursorStatus = "stale";
        cursorReasonCodes.push(...staleReasons);
      }
    }
  }

  const cursorWatermark = sessionDiffCursorWatermark(cursorStatus === "invalid" ? null : cursor.payload);
  const cursorAt = cursorWatermark.changedAt;
  const scanLimit = 2000;

  const sourceEventsChanged = countChangedSessionDiffRows(db, "prepared_source_events", "created_at", cursorAt, { threadId, targetRef });
  const sourceRangeResult = collectChangedSourceRanges(db, { threadId, targetRef, cursorWatermark, scanLimit });
  const summaryLeafResult = collectChangedSummaryLeaves(db, { threadId, targetRef, cursorWatermark, scanLimit });
  const preparedCardResult = collectChangedPreparedCards(db, { threadId, targetRef, cursorWatermark, scanLimit });
  const inboxResult = collectChangedPreparedInboxItems(db, { threadId, targetRef, cursorWatermark, scanLimit });
  const watcherResult = collectChangedWatcherObservations(db, { targetRef, cursorWatermark, scanLimit });
  const collectorResults = [sourceRangeResult, summaryLeafResult, preparedCardResult, inboxResult, watcherResult];
  const scanBarrier = collectorResults
    .filter((result) => !result.scanExhausted && result.scanWatermark)
    .map((result) => result.scanWatermark!)
    .sort(compareSessionDiffWatermarks)
    .at(0) ?? null;
  const candidates = [
    ...sourceRangeResult.changes,
    ...summaryLeafResult.changes,
    ...preparedCardResult.changes,
    ...inboxResult.changes,
    ...watcherResult.changes
  ].filter((candidate) => sessionDiffCandidateAfterCursor(candidate, cursorWatermark))
    .filter((candidate) => !scanBarrier || compareSessionDiffCandidateToWatermark(candidate, scanBarrier) <= 0)
    .sort((left, right) => left.changedAt.localeCompare(right.changedAt)
    || left.changeKind.localeCompare(right.changeKind)
    || left.cursorKey.localeCompare(right.cursorKey));

  const selectedCandidates: SessionDiffCandidate[] = [];
  let approxTokens = 0;
  let tokenBudgetCount = 0;
  let limitCount = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (selectedCandidates.length >= limit) {
      limitCount = candidates.length - index;
      break;
    }
    if (approxTokens + candidate.approxTokens > tokenBudget && selectedCandidates.length > 0) {
      tokenBudgetCount = candidates.length - index;
      break;
    }
    approxTokens += candidate.approxTokens;
    selectedCandidates.push(candidate);
  }
  if (scanBarrier) limitCount = Math.max(1, limitCount);
  const selected = selectedCandidates.map(({ approxTokens: _approxTokens, cursorKey: _cursorKey, ...change }) => change);

  const filteredUnsafeRows = sourceRangeResult.filteredUnsafeRows
    + summaryLeafResult.filteredUnsafeRows
    + preparedCardResult.filteredUnsafeRows
    + inboxResult.filteredUnsafeRows
    + watcherResult.filteredUnsafeRows;
  const invalidTimestampRows = collectorResults.reduce((sum, result) => sum + result.invalidTimestampRows, 0);
  const hasMore = scanBarrier !== null || limitCount > 0 || tokenBudgetCount > 0;
  const omittedReasons = [
    limitCount > 0 ? "limit" : null,
    tokenBudgetCount > 0 ? "token_budget" : null,
    filteredUnsafeRows > 0 ? "filtered_unsafe_rows" : null
  ].filter((reason): reason is "limit" | "token_budget" | "filtered_unsafe_rows" => Boolean(reason));
  const nextWatermark = sessionDiffNextWatermark({
    selected: selectedCandidates,
    filteredUnsafeRows,
    cursorWatermark,
    scanBarrier,
    scanWatermarks: scanBarrier ? [scanBarrier] : [
        sourceRangeResult.scanWatermark,
        summaryLeafResult.scanWatermark,
        preparedCardResult.scanWatermark,
        inboxResult.scanWatermark,
        watcherResult.scanWatermark
      ].filter((watermark): watermark is SessionDiffCursorWatermark => watermark !== null)
  });
  const nextCursor = encodeSessionDiffCursor({
    schema: "lco.session.diff.cursor.v1",
    issuedAt: generatedAt,
    watermarkAt: nextWatermark.changedAt,
    watermarkChangeKind: nextWatermark.changeKind,
    watermarkChangeRef: nextWatermark.changeRef,
    watermarkKey: nextWatermark.key,
    threadId: threadId ?? null,
    targetRef: targetRef ?? null,
    snapshot
  }, cursorSigningKey);
  return {
    schema: "lco.session.diff.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt,
    target: {
      threadId: threadId ?? null,
      targetRef: targetRef ?? null
    },
    cursor: {
      provided: Boolean(options.cursor),
      status: cursorStatus,
      keySource: cursorKeySource,
      issuedAt: cursor.payload?.issuedAt ?? null,
      nextCursor,
      reasonCodes: unique(cursorReasonCodes.length ? cursorReasonCodes : [cursorStatus === "none" ? "cursor_not_provided" : "cursor_accepted"]).slice(0, 20)
    },
    sourceCoverage: {
      indexedSession: sessionDiffIndexedSessionCoverage(db, threadId, targetRef),
      preparedSourceRanges: cursorStatus === "stale" && cursorReasonCodes.includes("source_hash_changed")
        ? "partial"
        : sessionDiffCollectorCoverage(sourceRangeResult),
      summaryLeaves: sessionDiffCollectorCoverage(summaryLeafResult),
      preparedCards: sessionDiffCollectorCoverage(preparedCardResult),
      preparedInboxItems: sessionDiffCollectorCoverage(inboxResult),
      watcherObservations: sessionDiffCollectorCoverage(watcherResult)
    },
    summary: {
      totalChanges: candidates.length,
      totalChangesExact: scanBarrier === null,
      hasMore,
      returned: selected.length,
      changedSourceEvents: sourceEventsChanged,
      changedSourceRanges: candidates.filter((change) => change.changeKind === "source_range").length,
      changedSummaryLeaves: candidates.filter((change) => change.changeKind === "summary_leaf").length,
      changedPreparedCards: candidates.filter((change) => change.changeKind === "prepared_card").length,
      changedInboxItems: candidates.filter((change) => change.changeKind === "prepared_inbox_item").length,
      changedWatcherObservations: candidates.filter((change) => change.changeKind === "watcher_observation").length,
      lowConfidence: selected.filter((change) => change.confidence < 0.5).length
    },
    limits: {
      limit,
      tokenBudget
    },
    changes: selected,
    omitted: {
      count: limitCount + tokenBudgetCount + filteredUnsafeRows,
      countExact: scanBarrier === null,
      hasMore,
      reason: omittedReasons.length > 1 ? "mixed" : omittedReasons[0] ?? "none",
      reasons: omittedReasons.length ? omittedReasons : ["none"],
      limitCount,
      limitCountExact: scanBarrier === null,
      tokenBudgetCount,
      filteredUnsafeRows,
      invalidTimestampRows
    },
    nextSafeCommands: sessionDiffNextSafeCommands(cursorStatus),
    actionsPerformed: preparedCardReadActions(),
    proofBoundary: "Session diff reads only public-safe LCO derived-cache rows and signed opaque cursor hashes. It does not open raw JSONL or SQLite source stores, expose transcript paths/text, write cache rows, run live control, mutate GUI, write external systems, publish npm, or create GitHub releases."
  };
}

function optionalPublicThreadId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^[A-Za-z0-9._:-]{1,180}$/.test(trimmed) && !looksSensitiveRefLike(trimmed)) return trimmed;
  return undefined;
}

function optionalSessionDiffTargetRef(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith("codex_thread:")) {
    const threadId = optionalPublicThreadId(trimmed.slice("codex_thread:".length));
    return threadId && trimmed === codexThreadRef(threadId) ? trimmed : undefined;
  }
  if (!looksSensitiveRefLike(trimmed) && publicSafeIdentifier(trimmed) === trimmed) return trimmed;
  return undefined;
}

function encodeSessionDiffCursor(payload: SessionDiffCursorPayload, signingKey: string): string {
  const encodedPayload = Buffer.from(canonicalJsonString(payload)).toString("base64url");
  return `lco_cursor_${encodedPayload}.${sessionDiffCursorSignature(encodedPayload, signingKey)}`;
}

function parseSessionDiffCursor(cursor: string | undefined, signingKey: string): SessionDiffCursorParseResult {
  if (!cursor) return { status: "accepted", payload: null, reasonCodes: [] };
  if (cursor.length > SESSION_DIFF_CURSOR_MAX_CHARS) {
    return { status: "invalid", payload: null, reasonCodes: ["cursor_too_long"] };
  }
  if (!cursor.startsWith("lco_cursor_")) {
    return { status: "invalid", payload: null, reasonCodes: ["cursor_prefix_invalid"] };
  }
  try {
    const encodedWithSignature = cursor.slice("lco_cursor_".length);
    const cursorSegments = encodedWithSignature.split(".");
    if (cursorSegments.length === 1) {
      return { status: "invalid", payload: null, reasonCodes: ["cursor_signature_missing"] };
    }
    if (cursorSegments.length !== 2) {
      return { status: "invalid", payload: null, reasonCodes: ["cursor_signature_invalid"] };
    }
    const [encodedPayload, suppliedSignature] = cursorSegments;
    if (!encodedPayload) return { status: "invalid", payload: null, reasonCodes: ["cursor_payload_invalid"] };
    if (!suppliedSignature) return { status: "invalid", payload: null, reasonCodes: ["cursor_signature_missing"] };
    if (!sessionDiffCursorSignatureMatches(encodedPayload, suppliedSignature, signingKey)) {
      return { status: "invalid", payload: null, reasonCodes: ["cursor_signature_invalid"] };
    }
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown;
    if (!isObjectRecord(parsed) || parsed.schema !== "lco.session.diff.cursor.v1") {
      return { status: "invalid", payload: null, reasonCodes: ["cursor_schema_invalid"] };
    }
    const issuedAt = typeof parsed.issuedAt === "string" ? publicIsoTimestamp(parsed.issuedAt) : null;
    const watermarkAt = typeof parsed.watermarkAt === "string" ? publicIsoTimestamp(parsed.watermarkAt) : issuedAt;
    const watermarkChangeKind = sessionDiffCursorChangeKind(parsed.watermarkChangeKind);
    const watermarkChangeRef = typeof parsed.watermarkChangeRef === "string" && /^session_diff:[0-9a-f]{32}$/.test(parsed.watermarkChangeRef)
      ? parsed.watermarkChangeRef
      : null;
    const watermarkKey = parsed.watermarkKey === null
      ? null
      : typeof parsed.watermarkKey === "string"
        && /^[A-Za-z0-9._:-]{1,256}$/.test(parsed.watermarkKey)
        ? parsed.watermarkKey
        : undefined;
    if (parsed.threadId !== null && (typeof parsed.threadId !== "string" || !optionalPublicThreadId(parsed.threadId))) {
      return { status: "invalid", payload: null, reasonCodes: ["cursor_thread_invalid"] };
    }
    if (parsed.targetRef !== null && (typeof parsed.targetRef !== "string" || !optionalSessionDiffTargetRef(parsed.targetRef))) {
      return { status: "invalid", payload: null, reasonCodes: ["cursor_target_invalid"] };
    }
    const threadId = typeof parsed.threadId === "string" ? optionalPublicThreadId(parsed.threadId) ?? null : null;
    const targetRef = typeof parsed.targetRef === "string" ? optionalSessionDiffTargetRef(parsed.targetRef) ?? null : null;
    const snapshotValue = isObjectRecord(parsed.snapshot) ? parsed.snapshot : null;
    if (!issuedAt || !watermarkAt || !snapshotValue || watermarkKey === undefined) {
      return { status: "invalid", payload: null, reasonCodes: ["cursor_payload_invalid"] };
    }
    if ((watermarkChangeKind === null) !== (watermarkChangeRef === null) || (watermarkChangeKind === null) !== (watermarkKey === null)) {
      return { status: "invalid", payload: null, reasonCodes: ["cursor_watermark_invalid"] };
    }
    const snapshot = sanitizeSessionDiffSnapshot(snapshotValue);
    if (!snapshot) return { status: "invalid", payload: null, reasonCodes: ["cursor_snapshot_invalid"] };
    return {
      status: "accepted",
      payload: {
        schema: "lco.session.diff.cursor.v1",
        issuedAt,
        watermarkAt,
        watermarkChangeKind,
        watermarkChangeRef,
        watermarkKey,
        threadId,
        targetRef,
        snapshot
      },
      reasonCodes: ["cursor_accepted"]
    };
  } catch {
    return { status: "invalid", payload: null, reasonCodes: ["cursor_decode_failed"] };
  }
}

function sessionDiffCursorSigningKey(explicitKey: string | undefined): string {
  const key = explicitKey?.trim() || readEnv("SESSION_DIFF_CURSOR_KEY")?.trim();
  if (key && key.length >= 16) return key;
  throw new Error("Session diff cursor signing key is required; set LCO_SESSION_DIFF_CURSOR_KEY or initialize the local audit key through an approved dry-run control workflow");
}

function sessionDiffCursorKeySource(options: Pick<SessionDiffOptions, "cursorSigningKey" | "cursorKeySource">): SessionDiffCursorKeySource {
  if (options.cursorKeySource) {
    if (["explicit", "environment", "audit_fallback"].includes(options.cursorKeySource)) return options.cursorKeySource;
    throw new Error("Invalid session diff cursor key source");
  }
  if (options.cursorSigningKey?.trim()) return "explicit";
  return readEnv("SESSION_DIFF_CURSOR_KEY")?.trim() ? "environment" : "explicit";
}

function sessionDiffCursorSignature(encodedPayload: string, signingKey: string): string {
  return createHmac("sha256", signingKey).update(encodedPayload).digest("base64url");
}

function sessionDiffCursorSignatureMatches(encodedPayload: string, suppliedSignature: string, signingKey: string): boolean {
  const expected = sessionDiffCursorSignature(encodedPayload, signingKey);
  try {
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(suppliedSignature);
    return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
  } catch {
    return false;
  }
}

function sessionDiffCursorChangeKind(value: unknown): SessionDiffChangeKind | null {
  return value === "source_range"
    || value === "summary_leaf"
    || value === "prepared_card"
    || value === "prepared_inbox_item"
    || value === "watcher_observation"
    ? value
    : null;
}

function sessionDiffCursorWatermark(payload: SessionDiffCursorPayload | null): SessionDiffCursorWatermark {
  return {
    changedAt: payload?.watermarkAt ?? payload?.issuedAt ?? "1970-01-01T00:00:00.000Z",
    changeKind: payload?.watermarkChangeKind ?? null,
    changeRef: payload?.watermarkChangeRef ?? null,
    key: payload?.watermarkKey ?? null
  };
}

function sessionDiffCandidateAfterCursor(candidate: SessionDiffCandidate, watermark: SessionDiffCursorWatermark): boolean {
  const timeComparison = candidate.changedAt.localeCompare(watermark.changedAt);
  if (timeComparison > 0) return true;
  if (timeComparison < 0) return false;
  if (!watermark.changeKind || !watermark.changeRef || watermark.key === null) return false;
  const kindComparison = candidate.changeKind.localeCompare(watermark.changeKind);
  if (kindComparison > 0) return true;
  if (kindComparison < 0) return false;
  return candidate.cursorKey.localeCompare(watermark.key) > 0;
}

function compareSessionDiffCandidateToWatermark(
  candidate: SessionDiffCandidate,
  watermark: SessionDiffCursorWatermark
): number {
  return candidate.changedAt.localeCompare(watermark.changedAt)
    || candidate.changeKind.localeCompare(watermark.changeKind ?? "")
    || candidate.cursorKey.localeCompare(watermark.key ?? "");
}

function sessionDiffNextWatermark(input: {
  selected: SessionDiffCandidate[];
  filteredUnsafeRows: number;
  cursorWatermark: SessionDiffCursorWatermark;
  scanBarrier: SessionDiffCursorWatermark | null;
  scanWatermarks: SessionDiffCursorWatermark[];
}): SessionDiffCursorWatermark {
  const lastSelected = input.selected.at(-1);
  if (lastSelected) {
    return {
      changedAt: lastSelected.changedAt,
      changeKind: lastSelected.changeKind,
      changeRef: lastSelected.changeRef,
      key: lastSelected.cursorKey
    };
  }
  if (input.scanBarrier && compareSessionDiffWatermarks(input.scanBarrier, input.cursorWatermark) > 0) {
    return input.scanBarrier;
  }
  if (input.filteredUnsafeRows > 0 && input.scanWatermarks.length > 0) {
    return input.scanWatermarks.sort(compareSessionDiffWatermarks).at(-1)!;
  }
  return input.cursorWatermark;
}

function compareSessionDiffWatermarks(left: SessionDiffCursorWatermark, right: SessionDiffCursorWatermark): number {
  return left.changedAt.localeCompare(right.changedAt)
    || (left.changeKind ?? "").localeCompare(right.changeKind ?? "")
    || (left.key ?? "").localeCompare(right.key ?? "");
}

function sanitizeSessionDiffSnapshot(value: Record<string, unknown>): SessionDiffSnapshot | null {
  const sourceContentDigest = typeof value.sourceContentDigest === "string" && /^[0-9a-f]{32}$/.test(value.sourceContentDigest)
    ? value.sourceContentDigest
    : null;
  const sourceEpochDigest = typeof value.sourceEpochDigest === "string" && /^[0-9a-f]{32}$/.test(value.sourceEpochDigest)
    ? value.sourceEpochDigest
    : null;
  const sourceAppendGeneration = boundedNonNegativeInteger(value.sourceAppendGeneration, Number.MAX_SAFE_INTEGER);
  const sourceDestructiveGeneration = boundedNonNegativeInteger(value.sourceDestructiveGeneration, Number.MAX_SAFE_INTEGER);
  const sourceFileDigest = typeof value.sourceFileDigest === "string" && /^[0-9a-f]{32}$/.test(value.sourceFileDigest)
    ? value.sourceFileDigest
    : null;
  const sourceFileCount = value.sourceFileCount === undefined
    ? 0
    : boundedNonNegativeInteger(value.sourceFileCount, 100_000_000);
  const sourceBytes = boundedNonNegativeInteger(value.sourceBytes, Number.MAX_SAFE_INTEGER);
  const sourceEventCount = boundedNonNegativeInteger(value.sourceEventCount, 100_000_000);
  const sourceRangeCount = boundedNonNegativeInteger(value.sourceRangeCount, 100_000_000);
  const summaryLeafCount = boundedNonNegativeInteger(value.summaryLeafCount, 100_000_000);
  const preparedCardCount = boundedNonNegativeInteger(value.preparedCardCount, 100_000_000);
  const preparedInboxItemCount = boundedNonNegativeInteger(value.preparedInboxItemCount, 100_000_000);
  const watcherObservationCount = boundedNonNegativeInteger(value.watcherObservationCount, 100_000_000);
  const stateHash = typeof value.stateHash === "string" && /^[0-9a-f]{32}$/.test(value.stateHash) ? value.stateHash : null;
  if (!sourceContentDigest || !sourceEpochDigest || !sourceFileDigest || !stateHash) return null;
  return {
    sourceContentDigest,
    sourceEpochDigest,
    sourceAppendGeneration,
    sourceDestructiveGeneration,
    sourceFileDigest,
    sourceFileCount,
    sourceBytes,
    sourceEventCount,
    sourceRangeCount,
    summaryLeafCount,
    preparedCardCount,
    preparedInboxItemCount,
    watcherObservationCount,
    stateHash
  };
}

function createSessionDiffSnapshot(
  db: LooDatabase,
  target: { threadId?: string; targetRef?: string | null }
): SessionDiffSnapshot {
  const sourceFiles = sessionDiffSourceFileSnapshot(db, target);
  const usesGlobalSourceIntegrityGeneration = !target.threadId && !target.targetRef;
  const sourceEventCount = countMatchingRows(db, "prepared_source_events", target);
  const sourceRangeCount = countMatchingRows(db, "prepared_source_ranges", target);
  const summaryLeafCount = countMatchingRows(db, "summary_leaves", target);
  const preparedCardCount = countMatchingRows(db, "prepared_cards", target);
  const preparedInboxItemCount = countMatchingRows(db, "prepared_inbox_items", target);
  const watcherObservationCount = countMatchingRows(db, "watcher_observations", target);
  const stateWithoutHash = {
    sourceContentDigest: sourceFiles.contentDigest,
    sourceEpochDigest: sourceFiles.epochDigest,
    sourceAppendGeneration: sourceFiles.appendGeneration,
    sourceDestructiveGeneration: usesGlobalSourceIntegrityGeneration ? sessionDiffSourceDestructiveGeneration(db) : 0,
    sourceFileDigest: sourceFiles.digest,
    sourceFileCount: sourceFiles.count,
    sourceBytes: sourceFiles.bytes,
    sourceEventCount,
    sourceRangeCount,
    summaryLeafCount,
    preparedCardCount,
    preparedInboxItemCount,
    watcherObservationCount
  };
  return {
    ...stateWithoutHash,
    stateHash: stableId(canonicalJsonString(stateWithoutHash))
  };
}

function sessionDiffSourceFileSnapshot(
  db: LooDatabase,
  target: { threadId?: string; targetRef?: string | null }
): { count: number; bytes: number; digest: string; contentDigest: string; epochDigest: string; appendGeneration: number } {
  const threadId = target.threadId
    ?? (target.targetRef?.startsWith("codex_thread:") ? target.targetRef.slice("codex_thread:".length) : undefined);
  const rows = threadId
    ? db.prepare(`
      SELECT DISTINCT
        sources.source_path AS sourcePath,
        sources.path_hash AS contentHash,
        sources.content_epoch AS contentEpoch,
        sources.append_generation AS appendGeneration,
        sources.size AS size
      FROM codex_sessions AS sessions
      INNER JOIN codex_source_files AS sources ON sources.source_path = sessions.source_path
      WHERE sessions.thread_id = ?
      ORDER BY sources.path_hash ASC
    `).all(threadId) as Array<{ sourcePath: string; contentHash: string; contentEpoch: string | null; appendGeneration: number; size: number }>
    : target.targetRef
      ? []
      : db.prepare(`
      SELECT
        source_path AS sourcePath,
        path_hash AS contentHash,
        content_epoch AS contentEpoch,
        append_generation AS appendGeneration,
        size
      FROM codex_source_files
      ORDER BY source_path ASC
    `).all() as Array<{ sourcePath: string; contentHash: string; contentEpoch: string | null; appendGeneration: number; size: number }>;
  const safeRows = rows
    .map((row) => ({
      identityHash: stableId(String(row.sourcePath)),
      contentHash: String(row.contentHash),
      contentEpoch: String(row.contentEpoch ?? row.contentHash),
      appendGeneration: boundedNonNegativeInteger(row.appendGeneration, Number.MAX_SAFE_INTEGER),
      size: Number.isFinite(Number(row.size)) ? Math.max(0, Math.trunc(Number(row.size))) : 0
    }))
    .filter((row) => /^[0-9a-f]{32}$/.test(row.contentHash) && /^[0-9a-f]{32}$/.test(row.contentEpoch))
    .sort((left, right) => left.identityHash.localeCompare(right.identityHash));
  return {
    count: safeRows.length,
    bytes: safeRows.reduce((total, row) => Math.min(Number.MAX_SAFE_INTEGER, total + row.size), 0),
    digest: stableId(canonicalJsonString(safeRows.map((row) => row.identityHash))),
    contentDigest: stableId(canonicalJsonString(safeRows.map((row) => `${row.identityHash}:${row.contentHash}`))),
    epochDigest: stableId(canonicalJsonString(safeRows.map((row) => `${row.identityHash}:${row.contentEpoch}`))),
    appendGeneration: safeRows.reduce(
      (total, row) => Math.min(Number.MAX_SAFE_INTEGER, total + row.appendGeneration),
      0
    )
  };
}

function sessionDiffSourceDestructiveGeneration(db: LooDatabase): number {
  const row = db.prepare(`
    SELECT destructive_generation AS destructiveGeneration
    FROM codex_source_integrity_state
    WHERE singleton_id = 1
  `).get() as { destructiveGeneration?: unknown } | undefined;
  return boundedNonNegativeInteger(row?.destructiveGeneration, Number.MAX_SAFE_INTEGER);
}

function sessionDiffSnapshotStaleReasons(
  previous: SessionDiffSnapshot,
  current: SessionDiffSnapshot
): string[] {
  const reasons: string[] = [];
  if (previous.sourceFileCount > 0 && current.sourceFileCount === 0) reasons.push("source_missing");
  else if (current.sourceFileCount < previous.sourceFileCount) reasons.push("source_file_count_decreased");
  if (current.sourceBytes < previous.sourceBytes) reasons.push("source_size_decreased");
  if (current.sourceEventCount < previous.sourceEventCount) reasons.push("source_event_count_decreased");
  if (current.sourceRangeCount < previous.sourceRangeCount) reasons.push("source_range_count_decreased");
  if (current.summaryLeafCount < previous.summaryLeafCount) reasons.push("summary_leaf_count_decreased");
  if (current.preparedCardCount < previous.preparedCardCount) reasons.push("prepared_card_count_decreased");
  if (current.preparedInboxItemCount < previous.preparedInboxItemCount) reasons.push("prepared_inbox_count_decreased");
  if (current.watcherObservationCount < previous.watcherObservationCount) reasons.push("watcher_observation_count_decreased");
  if (current.sourceDestructiveGeneration !== previous.sourceDestructiveGeneration) reasons.push("source_history_rewritten");
  const sourceFilesAdded = current.sourceFileCount > previous.sourceFileCount
    && current.sourceDestructiveGeneration === previous.sourceDestructiveGeneration
    && reasons.length === 0;
  if (!sourceFilesAdded && previous.sourceFileDigest !== current.sourceFileDigest) reasons.push("source_identity_changed");
  const sourceHashChanged = previous.sourceContentDigest !== current.sourceContentDigest;
  const appendShape = current.sourceFileDigest === previous.sourceFileDigest
    && current.sourceEpochDigest === previous.sourceEpochDigest
    && current.sourceAppendGeneration > previous.sourceAppendGeneration
    && current.sourceBytes > previous.sourceBytes
    && (current.sourceEventCount > previous.sourceEventCount || current.sourceRangeCount > previous.sourceRangeCount)
    && reasons.length === 0;
  const monotonicAppend = appendShape;
  if (sourceHashChanged && !sourceFilesAdded && previous.sourceEpochDigest !== current.sourceEpochDigest) reasons.push("source_history_rewritten");
  if (sourceHashChanged && !sourceFilesAdded && !monotonicAppend) reasons.push("source_hash_changed");
  return reasons;
}

function sessionDiffWhereSql(
  table: "prepared_source_events" | "prepared_source_ranges" | "summary_leaves" | "prepared_cards" | "prepared_inbox_items" | "watcher_observations" | "codex_sessions",
  target: { threadId?: string; targetRef?: string | null }
): { where: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  const targetRef = target.threadId ? codexThreadRef(target.threadId) : target.targetRef ?? null;
  if (targetRef && optionalSessionDiffTargetRef(targetRef) !== targetRef) {
    throw new Error("Invalid session diff SQL target ref");
  }
  const scopedThreadId = target.threadId
    ?? (targetRef?.startsWith("codex_thread:")
      ? optionalPublicThreadId(targetRef.slice("codex_thread:".length))
      : undefined);
  if (table === "codex_sessions") {
    if (scopedThreadId) {
      clauses.push("thread_id = ?");
      params.push(scopedThreadId);
    }
  } else if (table === "summary_leaves") {
    if (scopedThreadId) {
      clauses.push("thread_id = ?");
      params.push(scopedThreadId);
    } else if (targetRef) {
      // Non-Codex target refs remain a bounded compatibility scan because
      // summary-leaf source refs are stored as JSON. The immediate charset
      // assertion above keeps quote and wildcard interpretation impossible.
      clauses.push("source_refs_json LIKE ? ESCAPE '\\'");
      params.push(`%"${escapeLike(targetRef)}"%`);
    }
  } else if (table === "prepared_cards" || table === "prepared_inbox_items" || table === "watcher_observations") {
    if (targetRef) {
      clauses.push("target_ref = ?");
      params.push(targetRef);
    }
  } else if (scopedThreadId) {
    clauses.push("thread_id = ?");
    params.push(scopedThreadId);
  } else if (targetRef) {
    clauses.push("source_ref = ?");
    params.push(targetRef);
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

function countMatchingRows(
  db: LooDatabase,
  table: Parameters<typeof sessionDiffWhereSql>[0],
  target: { threadId?: string; targetRef?: string | null }
): number {
  const { where, params } = sessionDiffWhereSql(table, target);
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get(...params) as { count: number }).count ?? 0);
}

function countChangedSessionDiffRows(
  db: LooDatabase,
  table: "prepared_source_events",
  changedColumn: "created_at",
  cursorAt: string,
  target: { threadId?: string; targetRef?: string | null }
): number {
  const base = sessionDiffWhereSql(table, target);
  const where = base.where ? `${base.where} AND ${changedColumn} >= ?` : `WHERE ${changedColumn} >= ?`;
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get(...base.params, cursorAt) as { count: number }).count ?? 0);
}

function sessionDiffScanWhere(
  changeKind: SessionDiffChangeKind,
  changedColumn: "created_at" | "updated_at" | "observed_at",
  keyExpression: string,
  base: { where: string; params: string[] },
  watermark: SessionDiffCursorWatermark
): { where: string; params: string[] } {
  const clauses = base.where ? [base.where.replace(/^WHERE\s+/i, "")] : [];
  const params = [...base.params];
  clauses.push(sessionDiffCanonicalTimestampSql(changedColumn));
  if (!watermark.changeKind || watermark.key === null) {
    clauses.push(`${changedColumn} > ?`);
    params.push(watermark.changedAt);
  } else {
    const kindComparison = changeKind.localeCompare(watermark.changeKind);
    if (kindComparison > 0) {
      clauses.push(`${changedColumn} >= ?`);
      params.push(watermark.changedAt);
    } else if (kindComparison < 0) {
      clauses.push(`${changedColumn} > ?`);
      params.push(watermark.changedAt);
    } else {
      clauses.push(`(${changedColumn}, ${keyExpression}) > (?, ?)`);
      params.push(watermark.changedAt, watermark.key);
    }
  }
  return { where: `WHERE ${clauses.join(" AND ")}`, params };
}

function sessionDiffCanonicalTimestampSql(column: "created_at" | "updated_at" | "observed_at"): string {
  return `typeof(${column}) = 'text' AND length(${column}) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) = ${column}`;
}

function countInvalidSessionDiffTimestamps(
  db: LooDatabase,
  table: "prepared_source_ranges" | "summary_leaves" | "prepared_cards" | "prepared_inbox_items" | "watcher_observations",
  changedColumn: "created_at" | "updated_at" | "observed_at",
  base: { where: string; params: string[] }
): number {
  const clauses = base.where ? [base.where.replace(/^WHERE\s+/i, "")] : [];
  clauses.push(`NOT (${sessionDiffCanonicalTimestampSql(changedColumn)})`);
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${clauses.join(" AND ")}`).get(...base.params) as { count: number }).count ?? 0);
}

function sessionDiffCollectorCoverage(result: SessionDiffCollectorResult): PreparedStateCoverage {
  return result.invalidTimestampRows > 0
    ? "partial"
    : coverageFromCounts(result.counts.raw, result.counts.safe);
}

function sessionDiffScannedWatermark(
  changeKind: SessionDiffChangeKind,
  row: { cursorKey: string } | undefined,
  changedAt: unknown,
  fallbackAt: string
): SessionDiffCursorWatermark | null {
  if (!row) return null;
  return {
    changedAt: typeof changedAt === "string" ? publicIsoTimestamp(changedAt) ?? fallbackAt : fallbackAt,
    changeKind,
    changeRef: `session_diff:${stableId(`${changeKind}:scan:${row.cursorKey}:${String(changedAt)}`)}`,
    key: row.cursorKey
  };
}

function collectChangedSourceRanges(
  db: LooDatabase,
  input: { threadId?: string; targetRef?: string | null; cursorWatermark: SessionDiffCursorWatermark; scanLimit: number }
): SessionDiffCollectorResult {
  const base = sessionDiffWhereSql("prepared_source_ranges", input);
  const invalidTimestampRows = countInvalidSessionDiffTimestamps(db, "prepared_source_ranges", "created_at", base);
  const scan = sessionDiffScanWhere(
    "source_range",
    "created_at",
    SESSION_DIFF_SOURCE_RANGE_CURSOR_KEY_SQL,
    base,
    input.cursorWatermark
  );
  const rawRows = db.prepare(`
    SELECT
      ${SESSION_DIFF_SOURCE_RANGE_CURSOR_KEY_SQL} AS cursorKey,
      range_ref AS rangeRef,
      event_ref AS eventRef,
      thread_id AS threadId,
      source_ref AS sourceRef,
      source_path_ref AS sourcePathRef,
      range_kind AS rangeKind,
      line_start AS lineStart,
      line_end AS lineEnd,
      byte_start AS byteStart,
      byte_end AS byteEnd,
      ordinal,
      source_hash AS sourceHash,
      content_hash AS contentHash,
      extractor_version AS extractorVersion,
      privacy_class AS privacyClass,
      omission_status AS omissionStatus,
      confidence,
      observed_at AS observedAt,
      reason_codes_json AS reasonCodesJson,
      created_at AS createdAt
    FROM prepared_source_ranges
    ${scan.where}
    ORDER BY created_at ASC, ${SESSION_DIFF_SOURCE_RANGE_CURSOR_KEY_SQL} ASC
    LIMIT ?
  `).all(...scan.params, input.scanLimit + 1) as Array<PreparedSourceRangeRow & { createdAt: string; cursorKey: string }>;
  const rows = rawRows.slice(0, input.scanLimit);
  const changes: SessionDiffCandidate[] = [];
  let filteredUnsafeRows = invalidTimestampRows;
  for (const row of rows) {
    const range = preparedSourceRangeFromRow(row);
    if (!range) {
      filteredUnsafeRows += 1;
      continue;
    }
    changes.push(sessionDiffCandidate({
      changeKind: "source_range",
      changeRefInput: range.rangeRef,
      cursorKey: row.cursorKey,
      targetRef: range.sourceRef,
      threadId: range.threadId,
      changedAt: publicIsoTimestamp(row.createdAt) ?? range.observedAt ?? input.cursorWatermark.changedAt,
      freshnessAt: range.observedAt,
      sourceRefs: [range.sourceRef],
      sourceRangeRefs: [range.rangeRef],
      confidence: range.confidence,
      stale: false,
      reasonCodes: unique(["source_range_changed", ...range.reasonCodes]),
      summary: `${range.rangeKind} metadata changed at ordinal ${range.ordinal}.`,
      item: range
    }));
  }
  return {
    counts: sessionDiffSafeCounts(db, "prepared_source_ranges", input),
    changedRows: rows.length,
    filteredUnsafeRows,
    invalidTimestampRows,
    changes,
    scanWatermark: sessionDiffScannedWatermark("source_range", rows.at(-1), rows.at(-1)?.createdAt, input.cursorWatermark.changedAt),
    scanExhausted: rawRows.length <= input.scanLimit
  };
}

function collectChangedSummaryLeaves(
  db: LooDatabase,
  input: { threadId?: string; targetRef?: string | null; cursorWatermark: SessionDiffCursorWatermark; scanLimit: number }
): SessionDiffCollectorResult {
  const base = sessionDiffWhereSql("summary_leaves", input);
  const invalidTimestampRows = countInvalidSessionDiffTimestamps(db, "summary_leaves", "created_at", base);
  const scan = sessionDiffScanWhere("summary_leaf", "created_at", "leaf_ref", base, input.cursorWatermark);
  const rawRows = db.prepare(`
    SELECT
      leaf_ref AS cursorKey,
      leaf_ref AS leafRef,
      thread_id AS threadId,
      leaf_kind AS leafKind,
      summary_text AS summaryText,
      source_refs_json AS sourceRefsJson,
      source_range_refs_json AS sourceRangeRefsJson,
      input_hash AS inputHash,
      output_hash AS outputHash,
      extractor_version AS extractorVersion,
      privacy_class AS privacyClass,
      authority_coverage_json AS authorityCoverageJson,
      confidence,
      freshness_at AS freshnessAt,
      stale,
      omission_status AS omissionStatus,
      created_at AS createdAt
    FROM summary_leaves
    ${scan.where}
    ORDER BY created_at ASC, leaf_ref ASC
    LIMIT ?
  `).all(...scan.params, input.scanLimit + 1) as Array<SummaryLeafRow & { createdAt: string; cursorKey: string }>;
  const rows = rawRows.slice(0, input.scanLimit);
  const changes: SessionDiffCandidate[] = [];
  let filteredUnsafeRows = invalidTimestampRows;
  for (const row of rows) {
    const leaf = publicSummaryLeafFromRow(row);
    if (!leaf) {
      filteredUnsafeRows += 1;
      continue;
    }
    changes.push(sessionDiffCandidate({
      changeKind: "summary_leaf",
      changeRefInput: leaf.leafRef,
      cursorKey: row.cursorKey,
      targetRef: leaf.sourceRefs[0] ?? (leaf.threadId ? codexThreadRef(leaf.threadId) : "target_unknown"),
      threadId: leaf.threadId,
      changedAt: publicIsoTimestamp(row.createdAt) ?? leaf.freshnessAt ?? input.cursorWatermark.changedAt,
      freshnessAt: leaf.freshnessAt,
      sourceRefs: leaf.sourceRefs,
      sourceRangeRefs: leaf.sourceRangeRefs,
      confidence: leaf.confidence,
      stale: leaf.stale,
      reasonCodes: ["summary_leaf_changed", `leaf_kind:${leaf.leafKind}`],
      summary: publicSafeText(leaf.summaryText, 220),
      item: leaf
    }));
  }
  return {
    counts: sessionDiffSafeCounts(db, "summary_leaves", input),
    changedRows: rows.length,
    filteredUnsafeRows,
    invalidTimestampRows,
    changes,
    scanWatermark: sessionDiffScannedWatermark("summary_leaf", rows.at(-1), rows.at(-1)?.createdAt, input.cursorWatermark.changedAt),
    scanExhausted: rawRows.length <= input.scanLimit
  };
}

function collectChangedPreparedCards(
  db: LooDatabase,
  input: { threadId?: string; targetRef?: string | null; cursorWatermark: SessionDiffCursorWatermark; scanLimit: number }
): SessionDiffCollectorResult {
  const base = sessionDiffWhereSql("prepared_cards", input);
  const invalidTimestampRows = countInvalidSessionDiffTimestamps(db, "prepared_cards", "updated_at", base);
  const scan = sessionDiffScanWhere("prepared_card", "updated_at", "card_ref", base, input.cursorWatermark);
  const rawRows = db.prepare(`
    SELECT
      card_ref AS cursorKey,
      card_ref AS cardRef,
      target_ref AS targetRef,
      card_kind AS cardKind,
      title,
      objective,
      summary_text AS summaryText,
      blocker,
      next_action AS nextAction,
      source_refs_json AS sourceRefsJson,
      source_range_refs_json AS sourceRangeRefsJson,
      source_range_refs_omitted AS sourceRangeRefsOmitted,
      authority_coverage_json AS authorityCoverageJson,
      input_hash AS inputHash,
      extractor_version AS extractorVersion,
      privacy_class AS privacyClass,
      confidence,
      freshness_at AS freshnessAt,
      stale,
      state,
      reason_codes_json AS reasonCodesJson,
      updated_at AS updatedAt
    FROM prepared_cards
    ${scan.where}
    ORDER BY updated_at ASC, card_ref ASC
    LIMIT ?
  `).all(...scan.params, input.scanLimit + 1) as Array<PreparedCardRow & { updatedAt: string; cursorKey: string }>;
  const rows = rawRows.slice(0, input.scanLimit);
  const changes: SessionDiffCandidate[] = [];
  let filteredUnsafeRows = invalidTimestampRows;
  for (const row of rows) {
    const card = publicPreparedCardFromRow(row);
    if (!card) {
      filteredUnsafeRows += 1;
      continue;
    }
    changes.push(sessionDiffCandidate({
      changeKind: "prepared_card",
      changeRefInput: card.cardRef,
      cursorKey: row.cursorKey,
      targetRef: card.targetRef,
      threadId: card.targetRef.startsWith("codex_thread:") ? card.targetRef.slice("codex_thread:".length) : null,
      changedAt: publicIsoTimestamp(row.updatedAt) ?? card.freshnessAt ?? input.cursorWatermark.changedAt,
      freshnessAt: card.freshnessAt,
      sourceRefs: card.sourceRefs,
      sourceRangeRefs: card.sourceRangeRefs,
      confidence: card.confidence,
      stale: card.stale,
      reasonCodes: unique(["prepared_card_changed", ...card.reasonCodes]),
      summary: publicSafeText(card.summaryText || card.title, 220),
      item: card
    }));
  }
  return {
    counts: sessionDiffSafeCounts(db, "prepared_cards", input),
    changedRows: rows.length,
    filteredUnsafeRows,
    invalidTimestampRows,
    changes,
    scanWatermark: sessionDiffScannedWatermark("prepared_card", rows.at(-1), rows.at(-1)?.updatedAt, input.cursorWatermark.changedAt),
    scanExhausted: rawRows.length <= input.scanLimit
  };
}

function collectChangedPreparedInboxItems(
  db: LooDatabase,
  input: { threadId?: string; targetRef?: string | null; cursorWatermark: SessionDiffCursorWatermark; scanLimit: number }
): SessionDiffCollectorResult {
  const base = sessionDiffWhereSql("prepared_inbox_items", input);
  const invalidTimestampRows = countInvalidSessionDiffTimestamps(db, "prepared_inbox_items", "updated_at", base);
  const scan = sessionDiffScanWhere("prepared_inbox_item", "updated_at", "item_id", base, input.cursorWatermark);
  const rawRows = db.prepare(`
    SELECT
      item_id AS cursorKey,
      item_id AS itemRef,
      card_ref AS cardRef,
      target_ref AS targetRef,
      urgency_score AS urgencyScore,
      state,
      reason_codes_json AS reasonCodesJson,
      source_refs_json AS sourceRefsJson,
      execute_false AS executeFalse,
      updated_at AS updatedAt
    FROM prepared_inbox_items
    ${scan.where}
    ORDER BY updated_at ASC, item_id ASC
    LIMIT ?
  `).all(...scan.params, input.scanLimit + 1) as Array<PreparedInboxRow & { updatedAt: string; cursorKey: string }>;
  const rows = rawRows.slice(0, input.scanLimit);
  const changes: SessionDiffCandidate[] = [];
  let filteredUnsafeRows = invalidTimestampRows;
  for (const row of rows) {
    const item = publicPreparedInboxItemFromRow(row);
    if (!item) {
      filteredUnsafeRows += 1;
      continue;
    }
    changes.push(sessionDiffCandidate({
      changeKind: "prepared_inbox_item",
      changeRefInput: item.itemRef,
      cursorKey: row.cursorKey,
      targetRef: item.targetRef,
      threadId: item.targetRef.startsWith("codex_thread:") ? item.targetRef.slice("codex_thread:".length) : null,
      changedAt: publicIsoTimestamp(row.updatedAt) ?? input.cursorWatermark.changedAt,
      freshnessAt: publicIsoTimestamp(row.updatedAt),
      sourceRefs: item.sourceRefs,
      sourceRangeRefs: [],
      confidence: Math.max(0.1, Math.min(0.99, item.urgencyScore / 100)),
      stale: false,
      reasonCodes: unique(["prepared_inbox_changed", ...item.reasonCodes]),
      summary: `Prepared inbox item ${item.state} with urgency ${Math.round(item.urgencyScore)}.`,
      item
    }));
  }
  return {
    counts: sessionDiffSafeCounts(db, "prepared_inbox_items", input),
    changedRows: rows.length,
    filteredUnsafeRows,
    invalidTimestampRows,
    changes,
    scanWatermark: sessionDiffScannedWatermark("prepared_inbox_item", rows.at(-1), rows.at(-1)?.updatedAt, input.cursorWatermark.changedAt),
    scanExhausted: rawRows.length <= input.scanLimit
  };
}

function collectChangedWatcherObservations(
  db: LooDatabase,
  input: { targetRef?: string | null; cursorWatermark: SessionDiffCursorWatermark; scanLimit: number }
): SessionDiffCollectorResult {
  const base = sessionDiffWhereSql("watcher_observations", input);
  const invalidTimestampRows = countInvalidSessionDiffTimestamps(db, "watcher_observations", "created_at", base);
  const scan = sessionDiffScanWhere("watcher_observation", "created_at", "observation_id", base, input.cursorWatermark);
  const rawRows = db.prepare(`
    SELECT
      observation_id AS cursorKey,
      observation_id AS observationId,
      watch_id AS watchId,
      target_ref AS targetRef,
      observation_json AS observationJson,
      evidence_refs_json AS evidenceRefsJson,
      privacy_class AS privacyClass,
      confidence,
      observed_at AS observedAt,
      created_at AS createdAt
    FROM watcher_observations
    ${scan.where}
    ORDER BY created_at ASC, observation_id ASC
    LIMIT ?
  `).all(...scan.params, input.scanLimit + 1) as Array<WatcherObservationRow & { cursorKey: string; createdAt: string }>;
  const rows = rawRows.slice(0, input.scanLimit);
  const changes: SessionDiffCandidate[] = [];
  let filteredUnsafeRows = invalidTimestampRows;
  for (const row of rows) {
    const observation = publicWatcherObservationFromRow(row);
    if (!observation) {
      filteredUnsafeRows += 1;
      continue;
    }
    changes.push(sessionDiffCandidate({
      changeKind: "watcher_observation",
      changeRefInput: observation.observationRef,
      cursorKey: row.cursorKey,
      targetRef: observation.targetRef,
      threadId: observation.targetRef.startsWith("codex_thread:") ? observation.targetRef.slice("codex_thread:".length) : null,
      changedAt: publicIsoTimestamp(row.createdAt) ?? input.cursorWatermark.changedAt,
      freshnessAt: observation.freshness.lastObservedAt,
      sourceRefs: observation.sourceRefs,
      sourceRangeRefs: [],
      confidence: observation.confidence,
      stale: observation.freshness.stale,
      reasonCodes: unique(["watcher_observation_changed", ...observation.reasonCodes]),
      summary: `Watcher ${observation.watcher.status} for ${observation.watcher.kind}.`,
      item: observation
    }));
  }
  return {
    counts: sessionDiffSafeCounts(db, "watcher_observations", input),
    changedRows: rows.length,
    filteredUnsafeRows,
    invalidTimestampRows,
    changes,
    scanWatermark: sessionDiffScannedWatermark("watcher_observation", rows.at(-1), rows.at(-1)?.createdAt, input.cursorWatermark.changedAt),
    scanExhausted: rawRows.length <= input.scanLimit
  };
}

function sessionDiffSafeCounts(
  db: LooDatabase,
  table: "prepared_source_ranges" | "summary_leaves" | "prepared_cards" | "prepared_inbox_items" | "watcher_observations",
  target: { threadId?: string; targetRef?: string | null }
): SessionDiffSafeCounts {
  const { where, params } = sessionDiffWhereSql(table, target);
  const raw = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get(...params) as { count: number }).count ?? 0);
  const safeClauses: string[] = [];
  if (table === "prepared_source_ranges" || table === "summary_leaves" || table === "prepared_cards" || table === "watcher_observations") {
    safeClauses.push("privacy_class = 'public_safe_metadata'");
  }
  if (table === "prepared_source_ranges" || table === "summary_leaves") {
    safeClauses.push("omission_status = 'metadata_only'");
  }
  if (table === "prepared_inbox_items") {
    safeClauses.push("execute_false = 1");
  }
  const safeWhere = [
    where ? where.replace(/^WHERE\s+/i, "") : "",
    ...safeClauses
  ].filter(Boolean).join(" AND ");
  const safe = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${safeWhere ? `WHERE ${safeWhere}` : ""}`).get(...params) as { count: number }).count ?? 0);
  return { raw, safe };
}

function sessionDiffIndexedSessionCoverage(db: LooDatabase, threadId?: string, targetRef?: string | null): PreparedStateCoverage {
  if (!threadId && !(targetRef?.startsWith("codex_thread:"))) return "unknown";
  const resolvedThreadId = threadId ?? targetRef?.slice("codex_thread:".length);
  if (!resolvedThreadId) return "unknown";
  const count = Number((db.prepare("SELECT COUNT(*) AS count FROM codex_sessions WHERE thread_id = ?").get(resolvedThreadId) as { count: number }).count ?? 0);
  return count > 0 ? "ok" : "not_configured";
}

function sessionDiffCandidate(
  input: Omit<SessionDiffChange, "schema" | "changeRef"> & { changeRefInput: string; cursorKey: string }
): SessionDiffCandidate {
  const summary = publicSafeText(input.summary, 260);
  const sourceRefs = unique(input.sourceRefs.filter(isPublicPreparedSourceRef)).slice(0, 20);
  const sourceRangeRefs = unique(input.sourceRangeRefs.filter((ref) => /^codex_range:[0-9a-f]{32}$/.test(ref))).slice(0, 20);
  return {
    schema: "lco.session.diff.change.v1",
    changeRef: `session_diff:${stableId(`${input.changeKind}:${input.changeRefInput}:${input.changedAt}`)}`,
    changeKind: input.changeKind,
    targetRef: publicSafeRefLike(input.targetRef, "target") ?? "target_unknown",
    threadId: input.threadId ? optionalPublicThreadId(input.threadId) ?? null : null,
    changedAt: publicIsoTimestamp(input.changedAt) ?? new Date(0).toISOString(),
    freshnessAt: publicIsoTimestamp(input.freshnessAt) ?? null,
    sourceRefs,
    sourceRangeRefs,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    stale: input.stale,
    reasonCodes: unique(input.reasonCodes.map(publicSafeIdentifier).filter((code): code is string => Boolean(code))).slice(0, 20),
    summary,
    item: input.item,
    cursorKey: input.cursorKey,
    approxTokens: Math.max(1, approximateTokens(`${input.changeKind} ${summary} ${sourceRefs.join(" ")} ${sourceRangeRefs.join(" ")}`))
  };
}

function sessionDiffNextSafeCommands(status: SessionDiffCursorStatus): string[] {
  if (status === "invalid") {
    return [
      "Run lco session-diff again without --cursor to mint a fresh cursor.",
      "Then retry with the returned cursor after the next index/prep refresh."
    ];
  }
  if (status === "stale") {
    return [
      "Run lco index codex with the relevant Codex roots.",
      "Run lco hook state-prep or the prepared-state refresh lane for the target session.",
      "Run lco session-diff again without the stale cursor to mint a new baseline."
    ];
  }
  return [
    "Use cursor.nextCursor on the next lco session-diff call.",
    "Use lco_prepared_cards or lco_summary_expand for bounded evidence before any drive/control step."
  ];
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

export function createCodexActiveThreadState(
  db: LooDatabase,
  options: CodexActiveThreadStateOptions = {}
): CodexActiveThreadStateReport {
  const generatedAt = publicIsoTimestamp(options.now) ?? new Date().toISOString();
  const limit = clamp(options.limit ?? 20, 1, 500);
  const cockpit = createCodexCollaborationCockpit(db, { ...options, limit: 500, now: generatedAt });
  const watcherReport = createWatcherStatusReport(options.watcherSpecs ?? [], { now: generatedAt, limit: 1000 });
  const watchersByTarget = activeStateWatchersByTarget(watcherReport.watchers);
  const appServerByThread = activeStateAppServerByThread(options.appServerThreads);
  const appServerCoverage = appServerThreadCoverage(options.appServerThreads);
  const visibleMapCoverage = isVisibleCodexSessionMapReport(options.visibleMap) ? options.visibleMap.sourceCoverage.visibleCodex : "not_configured";
  const visibleMapByThread = activeStateVisibleMapByThread(options.visibleMap);
  const items = cockpit.lanes
    .map((lane) => {
      const watchers = watchersByTarget.get(lane.threadId) ?? [];
      const appServerThread = appServerByThread.get(lane.threadId) ?? null;
      const visibleMapItem = visibleMapByThread.get(lane.threadId) ?? null;
      return activeThreadStateItem(lane, {
        watchers,
        appServerThread,
        visibleMapItem,
        sourceCoverage: activeThreadStateItemSourceCoverage({
          cockpit,
          watcherSpecs: options.watcherSpecs,
          watchers,
          appServerCoverage,
          appServerThread,
          visibleMapCoverage,
          visibleMapItem
        })
      });
    })
    .sort(activeThreadStateComparator);
  const selected = items.slice(0, limit);

  return {
    schema: "lco.codex.activeThreadState.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt,
    summary: {
      totalLanes: cockpit.summary.totalCards,
      returned: selected.length,
      running: selected.filter((item) => item.state === "running").length,
      blocked: selected.filter((item) => item.state === "blocked").length,
      needsApproval: selected.filter((item) => item.state === "needs_approval").length,
      needsNudge: selected.filter((item) => item.state === "needs_nudge").length,
      stale: selected.filter((item) => item.state === "stale").length,
      waiting: selected.filter((item) => item.state === "waiting").length,
      idle: selected.filter((item) => item.state === "idle").length,
      unknown: selected.filter((item) => item.state === "unknown").length,
      lowConfidence: selected.filter((item) => item.confidence < 0.7).length,
      attentionCovered: selected.filter((item) => item.attentionCoverage.status === "covered").length,
      attentionPartial: selected.filter((item) => item.attentionCoverage.status === "partial").length,
      attentionNeedsProbe: selected.filter((item) => item.attentionCoverage.status === "needs_probe").length,
      attentionUnknown: selected.filter((item) => item.attentionCoverage.status === "unknown").length,
      nextReadOnlyActions: selected.filter((item) => item.attentionCoverage.nextReadOnlyAction !== null).length
    },
    sourceCoverage: {
      indexedSession: cockpit.sourceCoverage.recentSessions,
      cockpitInbox: cockpit.sourceCoverage.cockpitInbox,
      watchers: (options.watcherSpecs?.length ?? 0) > 0 ? "ok" : "not_configured",
      codexAppServer: appServerCoverage,
      visibleCodexMap: visibleMapCoverage
    },
    items: selected,
    omitted: {
      count: Math.max(0, cockpit.summary.totalCards - selected.length),
      reason: cockpit.summary.totalCards > selected.length ? "limit" : "none"
    },
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false,
      screenshotCaptured: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    proofBoundary: "This read-only active-thread state report fuses indexed Codex cards, deterministic inbox urgency, watcher records, optional app-server status, and optional visible-map coverage into attention coverage cards and non-executed next-read recommendations. It does not read raw transcripts, run live Codex control, mutate Codex Desktop, capture screenshots, publish npm, create GitHub releases, or claim unattended Desktop collaboration."
  };
}

export function createCodexAutonomyTick(
  db: LooDatabase,
  options: CodexAutonomyTickOptions = {}
): CodexAutonomyTickReport {
  const generatedAt = publicIsoTimestamp(options.now) ?? new Date().toISOString();
  const limit = clamp(options.limit ?? 20, 1, 500);
  const activeState = createCodexActiveThreadState(db, {
    ...options,
    limit: 500,
    now: generatedAt
  });
  // priorityOrder is applied while selecting active lanes; final tick ordering stays safety-first.
  const candidateSteps = activeState.items.flatMap((item) => autonomyTickStepsForItem(item)).sort(autonomyTickStepComparator);
  const steps = candidateSteps.slice(0, limit);
  const tickLimitOmitted = Math.max(0, candidateSteps.length - steps.length);
  const upstreamOmitted = Math.max(0, activeState.omitted.count);
  const omittedCount = tickLimitOmitted + upstreamOmitted;

  return {
    schema: "lco.codex.autonomyTick.v1",
    publicSafe: true,
    readOnly: true,
    generatedAt,
    summary: {
      totalLanes: activeState.summary.totalLanes,
      returnedSteps: steps.length,
      readOnlyProbes: steps.filter((step) => step.stepType === "read_only_probe").length,
      controlDryRunRecommendations: steps.filter((step) => step.stepType === "control_dry_run").length,
      blockedControlDryRuns: steps.filter((step) => step.stepType === "control_dry_run" && step.reasonCodes.includes("control_dry_run_blocked")).length
    },
    sourceCoverage: activeState.sourceCoverage,
    steps,
    omitted: {
      count: omittedCount,
      reason: autonomyTickOmittedReason(tickLimitOmitted, upstreamOmitted)
    },
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false,
      screenshotCaptured: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    proofBoundary: "This deterministic autonomy tick plans only public-safe execute-false next tool calls from active-thread state. It does not read raw transcripts, mint approval audit ids, resume/send/steer/interrupt Codex, mutate Desktop UI, capture screenshots, publish npm, create GitHub releases, or claim unattended autonomy."
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
      toolCall: collaborationToolCall("lco_watchers", {
        action: "resume_request_packet",
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
      toolCall: collaborationToolCall("lco_desktop_proof", {
        check: "coherence",
        ...collaborationDesktopCoherenceArgsFromFallback(input.fallback, threadId, sourceRef)
      })
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
      toolCall: collaborationToolCall("lco_desktop_proof", {
        check: "coherence",
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
      toolCall: collaborationToolCall("lco_desktop_proof", {
        check: "coherence",
        thread_id: threadId,
        source_ref: sourceRef
      })
    });
  }

  const coherenceState = input.coherence ? publicSafeCoherenceState(input.coherence.state) : null;
  if ((lane.desktop.state === "cli_visible" || lane.desktop.state === "unknown") && input.coherence && coherenceState === "gui_persisted_read_state_stale") {
    return collaborationNextStep({
      ...base,
      category: "desktop_coherence",
      status: "ready",
      reasonCodes: unique([...lane.reasonCodes, "read_state_reconciliation_required", "desktop_coherence_required"]),
      blockers: [],
      confidence: Math.max(0.6, lane.desktop.confidence),
      toolCall: collaborationToolCall("lco_desktop_proof", {
        check: "coherence",
        thread_id: threadId,
        source_ref: sourceRef,
        action_evidence: collaborationPublicSafeActionEvidenceArg(input.coherence.actionEvidence),
        include_app_server: true,
        include_visible_snapshot: false,
        limit: 20
      })
    });
  }
  if ((lane.desktop.state === "cli_visible" || lane.desktop.state === "unknown") && input.coherence && coherenceState !== "desktop_visible") {
    return collaborationNextStep({
      ...base,
      category: "desktop_fallback_status",
      status: "ready",
      reasonCodes: unique([...lane.reasonCodes, "desktop_fallback_status_required"]),
      blockers: [],
      confidence: Math.max(0.55, lane.desktop.confidence),
      toolCall: collaborationToolCall("lco_desktop_proof", {
        check: "fallback_status",
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
  if (tool !== "lco_desktop_proof") return null;
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
  if (tool !== "lco_desktop_proof" && tool !== "loo_desktop_live_proof_harness") return null;
  if (candidate.execute !== false) return null;
  return {
    tool: "lco_desktop_proof",
    args: runtimeDesktopVisibilityPublicSafeArgs({
      ...(tool === "loo_desktop_live_proof_harness" ? { check: "live_proof_harness" } : {}),
      ...(isObjectRecord(candidate.args) ? candidate.args : {})
    }),
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

function activeThreadStateItem(
  lane: CodexCollaborationCockpitLane,
  input: {
    watchers: WatcherState[];
    appServerThread: AppServerThreadSignalInput | null;
    visibleMapItem: VisibleCodexSessionMapItem | null;
    sourceCoverage: CodexActiveThreadStateItem["sourceCoverage"];
  }
): CodexActiveThreadStateItem {
  const watcherTriggered = input.watchers.some((watcher) => watcher.status === "triggered");
  const watcherStale = input.watchers.some((watcher) => watcher.status === "stale");
  const appServerState = activeStateFromAppServerThread(input.appServerThread);
  const sessionState = activeStateFromSessionState(lane.sessionState);
  const appServerDisagrees = appServerState !== null
    && sessionState !== null
    && appServerState !== sessionState;
  const watcherOverridesAppServerConflict = appServerDisagrees && sessionState === "running" && (watcherTriggered || watcherStale);
  const conflict = appServerDisagrees && !watcherOverridesAppServerConflict;
  const state = conflict
    ? "unknown"
    : lane.sessionState === "needs_approval"
      ? "needs_approval"
      : lane.sessionState === "blocked"
        ? "blocked"
        : watcherTriggered || (lane.reasonCodes.includes("resume_ready") && lane.sessionState === "running")
          ? "needs_nudge"
          : watcherStale || lane.reasonCodes.includes("active_stale")
            ? "stale"
            : appServerState ?? sessionState ?? "unknown";
  const watcherConfidence = input.watchers.length > 0 ? Math.max(...input.watchers.map((watcher) => watcher.confidence)) : 0;
  const appServerConfidence = typeof input.appServerThread?.confidence === "number" ? Math.max(0, Math.min(1, input.appServerThread.confidence)) : 0;
  const conflictAppServerConfidence = typeof input.appServerThread?.confidence === "number" ? appServerConfidence : 0.62;
  const visibleConfidence = typeof input.visibleMapItem?.confidence === "number" ? Math.max(0, Math.min(1, input.visibleMapItem.confidence)) : 0;
  const confidence = conflict
    ? Math.min(0.62, lane.card.confidence, conflictAppServerConfidence)
    : watcherOverridesAppServerConflict
      ? Math.min(0.74, Math.max(0.1, Math.min(0.99, Math.max(lane.card.confidence, watcherConfidence, appServerConfidence, visibleConfidence))))
      : Math.max(0.1, Math.min(0.99, Math.max(lane.card.confidence, watcherConfidence, appServerConfidence, visibleConfidence)));
  const reasonCodes = unique([
    ...lane.reasonCodes,
    `active_state:${state}`,
    ...(watcherTriggered ? ["watcher_triggered"] : []),
    ...(watcherStale ? ["watcher_stale"] : []),
    ...input.watchers.flatMap((watcher) => watcher.reasonCodes),
    ...activeStateAppServerReasonCodes(input.appServerThread, appServerState),
    ...(input.visibleMapItem ? ["visible_map_joined", ...input.visibleMapItem.reasonCodes] : []),
    ...(conflict ? ["conflicting_state", "app_server_indexed_state_conflict", "low_confidence"] : []),
    ...(watcherOverridesAppServerConflict ? ["app_server_state_overridden_by_watcher", "app_server_indexed_state_conflict", "low_confidence"] : [])
  ]);
  const evidenceIds = unique([
    ...lane.card.evidenceIds,
    ...lane.desktop.evidenceIds,
    ...input.watchers.flatMap((watcher) => watcher.evidenceIds),
    ...(input.visibleMapItem?.evidenceIds ?? [])
  ]);
  const safeReasonCodes = reasonCodes.map(collaborationPublicSafeReasonCode).filter((code): code is string => Boolean(code)).slice(0, 30);
  const safeEvidenceIds = evidenceIds.map((id) => publicSafeRefLike(id, "evidence") ?? "").filter(Boolean).slice(0, 30);
  const safeConfidence = Number(confidence.toFixed(2));
  const attentionCoverage = activeThreadAttentionCoverage(lane, {
    state,
    confidence: safeConfidence,
    reasonCodes: safeReasonCodes,
    sourceCoverage: input.sourceCoverage
  });
  return {
    threadId: lane.threadId,
    title: publicSafeText(lane.title, 180),
    state,
    sessionState: lane.sessionState,
    attention: lane.attention,
    freshness: lane.card.freshness,
    nextAction: lane.nextAction,
    confidence: safeConfidence,
    reasonCodes: safeReasonCodes,
    evidenceIds: safeEvidenceIds,
    attentionCoverage,
    nextControlDryRun: activeThreadControlDryRunRecommendation(lane, state, safeConfidence, safeReasonCodes),
    sourceCoverage: input.sourceCoverage
  };
}

function activeThreadAttentionCoverage(
  lane: CodexCollaborationCockpitLane,
  input: {
    state: CodexActiveThreadStateKind;
    confidence: number;
    reasonCodes: string[];
    sourceCoverage: CodexActiveThreadStateItem["sourceCoverage"];
  }
): CodexActiveThreadAttentionCoverage {
  const hardConflict = input.reasonCodes.includes("conflicting_state");
  const softConflict = input.reasonCodes.includes("app_server_state_overridden_by_watcher")
    || (input.reasonCodes.includes("app_server_indexed_state_conflict") && input.state !== "unknown");
  const appServerMissing = input.sourceCoverage.codexAppServer === "partial"
    || input.sourceCoverage.codexAppServer === "unavailable"
    || input.sourceCoverage.codexAppServer === "not_configured";
  const visibleMapMissing = input.sourceCoverage.visibleCodexMap === "partial"
    || input.sourceCoverage.visibleCodexMap === "unavailable"
    || input.sourceCoverage.visibleCodexMap === "not_configured";
  const indexedSessionMissing = input.sourceCoverage.indexedSession === "unavailable";
  const cockpitInboxMissing = input.sourceCoverage.cockpitInbox === "unavailable";
  const coreMissing = indexedSessionMissing || cockpitInboxMissing;
  const unconfiguredUnknownState = input.state === "unknown"
    && input.sourceCoverage.watchers === "not_configured"
    && input.sourceCoverage.codexAppServer === "not_configured"
    && input.sourceCoverage.visibleCodexMap === "not_configured";
  const confidence = Math.max(0.1, Math.min(1, input.confidence));
  const confidenceFloorApplied = input.confidence < 0.1;
  const needsProbe = hardConflict || input.state === "unknown" || confidence < 0.5 || coreMissing;
  const partial = !needsProbe && (softConflict || appServerMissing || confidence < 0.7);
  const status: CodexActiveThreadAttentionCoverage["status"] = unconfiguredUnknownState
    ? "unknown"
    : needsProbe
    ? "needs_probe"
    : partial ? "partial" : "covered";
  const nextReadOnlyAction = status === "covered"
    ? null
    : activeThreadNextReadOnlyAction(lane, {
        state: input.state,
        hardConflict,
        softConflict,
        appServerMissing,
        visibleMapMissing,
        coreMissing,
        indexedSessionMissing,
        cockpitInboxMissing
      });
  const reasonCodes = unique([
    `attention_${status}`,
    unconfiguredUnknownState ? "attention_sources_not_configured" : "",
    hardConflict || softConflict ? "attention_conflicting_state" : "",
    appServerMissing ? `attention_app_server_${input.sourceCoverage.codexAppServer}` : "",
    visibleMapMissing ? `attention_visible_map_${input.sourceCoverage.visibleCodexMap}` : "",
    indexedSessionMissing ? "attention_indexed_session_unavailable" : "",
    cockpitInboxMissing ? "attention_cockpit_inbox_unavailable" : "",
    confidenceFloorApplied ? "attention_confidence_floor_applied" : "",
    confidence < 0.7 ? "attention_low_confidence" : "",
    nextReadOnlyAction ? "attention_read_only_probe_available" : ""
  ].filter(Boolean))
    .map(collaborationPublicSafeReasonCode)
    .filter((code): code is string => Boolean(code))
    .slice(0, 16);

  return {
    status,
    confidence,
    reasonCodes,
    nextReadOnlyAction
  };
}

function activeThreadNextReadOnlyAction(
  lane: CodexCollaborationCockpitLane,
  input: {
    state: CodexActiveThreadStateKind;
    hardConflict: boolean;
    softConflict: boolean;
    appServerMissing: boolean;
    visibleMapMissing: boolean;
    coreMissing: boolean;
    indexedSessionMissing: boolean;
    cockpitInboxMissing: boolean;
  }
): CodexActiveThreadReadOnlyAction {
  const threadId = safeThreadId(lane.threadId);
  if (input.indexedSessionMissing) {
    return {
      tool: "lco_recent_sessions",
      execute: false,
      args: { scope: "active", include_cards: true, limit: 20 },
      reason: "Refresh public-safe indexed active session cards before trusting the active-state lane."
    };
  }
  if (input.cockpitInboxMissing) {
    return {
      tool: "lco_operating_picture",
      execute: false,
      args: { kind: "cockpit_inbox", limit: 20 },
      reason: "Refresh the deterministic cockpit inbox before trusting the active-state lane."
    };
  }
  if (input.hardConflict || input.softConflict || input.appServerMissing) {
    return {
      tool: "lco_codex_app_server_threads",
      execute: false,
      args: { read_thread_id: threadId, limit: 20 },
      reason: "Refresh read-only Codex app-server thread metadata before trusting the active-state lane."
    };
  }
  if (input.state === "unknown" && input.visibleMapMissing) {
    return {
      tool: "lco_visible_codex_map",
      execute: false,
      args: { include_app_server: true, include_visible_snapshot: false, limit: 20 },
      reason: "Join indexed and app-server signals through the public-safe visible Codex map before claiming Desktop-visible state."
    };
  }
  return {
    tool: "lco_codex_app_server_threads",
    execute: false,
    args: { read_thread_id: threadId, limit: 20 },
    reason: "Collect one more read-only Codex app-server metadata pass before escalating the attention card."
  };
}

function activeThreadControlDryRunRecommendation(
  lane: CodexCollaborationCockpitLane,
  state: CodexActiveThreadStateKind,
  confidence: number,
  reasonCodes: string[]
): CodexActiveThreadControlDryRunRecommendation | null {
  if (state !== "needs_nudge" && state !== "needs_approval") return null;
  const threadId = safeThreadId(lane.threadId);
  const blocked = state === "needs_approval";
  const blockers = blocked ? ["approval_required_before_live_control"] : [];
  return {
    tool: "lco_codex_control_dry_run",
    execute: false,
    status: blocked ? "blocked" : "ready",
    args: {
      action: "resume",
      thread_id: threadId
    },
    messageIncluded: false,
    messageRef: `control_dry_run_message:${stableId(`${lane.threadId}:${state}:${lane.nextAction.kind}:${lane.nextAction.reason}`).slice(0, 16)}`,
    approvalBoundary: "This is a read-only recommendation for a future dry-run call. It does not mint an audit id, send a message, resume Codex, or authorize live control. Any live resume/send/steer/interrupt still requires the matching dry-run proof, approval_audit_id, and Codex approval/sandbox gates.",
    blockers,
    reasonCodes: unique([
      ...reasonCodes,
      "control_dry_run_recommended",
      "approval_audit_id_required_for_live_control",
      ...(blocked ? ["approval_required_before_live_control"] : ["nudge_resume_dry_run_ready"])
    ]).slice(0, 30),
    confidence: Math.max(0.1, Math.min(1, confidence))
  };
}

function autonomyTickStepsForItem(item: CodexActiveThreadStateItem): CodexAutonomyTickStep[] {
  const steps: CodexAutonomyTickStep[] = [];
  const readOnlyAction = item.attentionCoverage.nextReadOnlyAction;
  if (readOnlyAction) {
    steps.push(autonomyTickReadOnlyStep(item, readOnlyAction));
  }
  if (item.nextControlDryRun) {
    steps.push(autonomyTickControlDryRunStep(item, item.nextControlDryRun));
  }
  return steps;
}

function autonomyTickReadOnlyStep(
  item: CodexActiveThreadStateItem,
  action: CodexActiveThreadReadOnlyAction
): CodexAutonomyTickStep {
  return autonomyTickStepRecord(item, {
    stepType: "read_only_probe",
    tool: action.tool,
    args: action.args,
    reason: action.reason,
    reasonCodes: ["autonomy_tick_read_only_probe", `autonomy_tool:${action.tool}`],
    stopConditions: ["execute_false_only", "recompute_tick_after_probe", "raw_transcript_not_read"]
  });
}

function autonomyTickControlDryRunStep(
  item: CodexActiveThreadStateItem,
  recommendation: CodexActiveThreadControlDryRunRecommendation
): CodexAutonomyTickStep {
  return autonomyTickStepRecord(item, {
    stepType: "control_dry_run",
    tool: recommendation.tool,
    args: recommendation.args,
    status: recommendation.status,
    reason: recommendation.status === "blocked"
      ? "Record that a future control dry-run is blocked until the approval boundary is resolved."
      : "Prepare a future dry-run resume packet after read-only attention probes are refreshed.",
    approvalBoundary: recommendation.approvalBoundary,
    blockers: recommendation.blockers,
    reasonCodes: [
      "autonomy_tick_control_dry_run",
      `autonomy_tool:${recommendation.tool}`,
      recommendation.status === "blocked" ? "control_dry_run_blocked" : "control_dry_run_ready",
      ...recommendation.reasonCodes
    ],
    stopConditions: ["execute_false_only", "live_control_requires_approval_audit_id", "codex_approval_sandbox_gates_preserved"]
  });
}

function autonomyTickStepRecord(
  item: CodexActiveThreadStateItem,
  input: {
    stepType: CodexAutonomyTickStepType;
    tool: CodexAutonomyTickTool;
    args: Record<string, string | number | boolean>;
    status?: "ready" | "blocked";
    reason: string;
    approvalBoundary?: string;
    blockers?: string[];
    reasonCodes: string[];
    stopConditions: string[];
  }
): CodexAutonomyTickStep {
  const safeReasonCodes = unique([...input.reasonCodes, ...item.reasonCodes])
    .map(collaborationPublicSafeReasonCode)
    .filter((code): code is string => Boolean(code))
    .slice(0, 30);
  const argsKey = canonicalJsonString(input.args);
  const idKey = `${item.threadId}:${input.stepType}:${input.tool}:${argsKey}`;
  const confidence = Number.isFinite(item.confidence) ? Math.max(0.1, Math.min(1, item.confidence)) : 0.1;
  return {
    stepId: `autonomy_step_${stableId(idKey).slice(0, 16)}`,
    threadId: item.threadId,
    stepType: input.stepType,
    priority: autonomyTickStepPriority(item, input.stepType),
    tool: input.tool,
    execute: false,
    args: input.args,
    ...(input.status ? { status: input.status } : {}),
    reason: publicSafeText(input.reason, 240),
    ...(input.approvalBoundary ? { approvalBoundary: publicSafeText(input.approvalBoundary, 360) } : {}),
    ...(input.blockers ? { blockers: unique(input.blockers.map(collaborationPublicSafeReasonCode).filter((code): code is string => Boolean(code))).slice(0, 12) } : {}),
    idempotencyKey: `autonomy_tick:${stableId(idKey).slice(0, 24)}`,
    stopConditions: unique(input.stopConditions.map(collaborationPublicSafeReasonCode).filter((code): code is string => Boolean(code))).slice(0, 12),
    reasonCodes: safeReasonCodes,
    evidenceIds: unique(item.evidenceIds.map((id) => publicSafeRefLike(id, "evidence") ?? "").filter(Boolean)).slice(0, 20),
    confidence,
    sourceCoverage: item.sourceCoverage
  };
}

function autonomyTickOmittedReason(
  tickLimitOmitted: number,
  upstreamOmitted: number
): CodexAutonomyTickReport["omitted"]["reason"] {
  if (tickLimitOmitted > 0 && upstreamOmitted > 0) return "limit_and_upstream_lanes_omitted";
  if (tickLimitOmitted > 0) return "limit";
  if (upstreamOmitted > 0) return "upstream_lanes_omitted";
  return "none";
}

function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (isCanonicalJsonRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJsonValue(value[key])])
    );
  }
  return value;
}

function isCanonicalJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function autonomyTickStepPriority(item: CodexActiveThreadStateItem, stepType: CodexAutonomyTickStepType): number {
  const stateRank = {
    needs_nudge: 8,
    needs_approval: 7,
    blocked: 6,
    stale: 5,
    running: 4,
    waiting: 3,
    unknown: 2,
    idle: 1
  } as const satisfies Record<CodexActiveThreadStateKind, number>;
  // Urgency is intentionally bucketed; ties fall through to deterministic refs.
  const urgency = Number.isFinite(item.attention.urgencyScore) ? Math.max(0, Math.trunc(item.attention.urgencyScore)) : 0;
  const typeRank = stepType === "read_only_probe" ? 1_000 : 900;
  return typeRank + stateRank[item.state] * 100 + urgency;
}

function autonomyTickStepComparator(left: CodexAutonomyTickStep, right: CodexAutonomyTickStep): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  const threadDelta = left.threadId.localeCompare(right.threadId);
  if (threadDelta !== 0) return threadDelta;
  if (left.stepType !== right.stepType) return left.stepType === "read_only_probe" ? -1 : 1;
  if (left.stepId < right.stepId) return -1;
  if (left.stepId > right.stepId) return 1;
  return 0;
}

function activeThreadStateItemSourceCoverage(input: {
  cockpit: CodexCollaborationCockpitReport;
  watcherSpecs: WatchSpec[] | undefined;
  watchers: WatcherState[];
  appServerCoverage: VisibleCodexCoverageState;
  appServerThread: AppServerThreadSignalInput | null;
  visibleMapCoverage: VisibleCodexCoverageState;
  visibleMapItem: VisibleCodexSessionMapItem | null;
}): CodexActiveThreadStateItem["sourceCoverage"] {
  return {
    indexedSession: input.cockpit.sourceCoverage.recentSessions,
    cockpitInbox: input.cockpit.sourceCoverage.cockpitInbox,
    watchers: (input.watcherSpecs?.length ?? 0) === 0
      ? "not_configured"
      : input.watchers.length > 0 ? "ok" : "partial",
    codexAppServer: input.appServerCoverage === "ok"
      ? input.appServerThread ? "ok" : "partial"
      : input.appServerCoverage,
    visibleCodexMap: input.visibleMapCoverage === "ok"
      ? input.visibleMapItem ? "ok" : "partial"
      : input.visibleMapCoverage
  };
}

function activeStateFromSessionState(state: CodexSessionCardState): CodexActiveThreadStateKind | null {
  if (state === "running") return "running";
  if (state === "blocked") return "blocked";
  if (state === "needs_approval") return "needs_approval";
  if (state === "waiting") return "waiting";
  if (state === "done") return "idle";
  return null;
}

function activeStateFromAppServerThread(thread: AppServerThreadSignalInput | null): CodexActiveThreadStateKind | null {
  if (!thread) return null;
  const status = normalizedMetadataValue(thread.status ?? null);
  if (status.includes("blocked") || status.includes("failed") || status.includes("error")) return "blocked";
  if (status.includes("approval") || status.includes("permission")) return "needs_approval";
  if (["waiting", "queued", "pending", "paused"].some((value) => status.includes(value))) return "waiting";
  if (["done", "complete", "completed", "closed", "merged"].some((value) => status === value || status.includes(value))) return "idle";
  if (["running", "active", "in-progress", "in_progress", "ready"].some((value) => status === value || status.includes(value))) return "running";
  return null;
}

function activeStateAppServerReasonCodes(thread: AppServerThreadSignalInput | null, state: CodexActiveThreadStateKind | null): string[] {
  if (!thread) return [];
  return unique([
    "app_server_signal",
    state ? `app_server_${state}` : "",
    thread.loaded === true || thread.loadedState === "loaded" ? "app_server_loaded" : ""
  ].filter(Boolean));
}

function activeStateWatchersByTarget(watchers: WatcherState[]): Map<string, WatcherState[]> {
  const byTarget = new Map<string, WatcherState[]>();
  for (const watcher of watchers) {
    if (watcher.status !== "triggered" && watcher.status !== "stale") continue;
    const target = publicSafeRefLike(watcher.targetRef, "target") ?? watcher.targetRef;
    const existing = byTarget.get(target) ?? [];
    existing.push(watcher);
    byTarget.set(target, existing);
  }
  for (const states of byTarget.values()) states.sort(watcherStateComparator);
  return byTarget;
}

function activeStateAppServerByThread(input: AppServerThreadsInput | null | undefined): Map<string, AppServerThreadSignalInput> {
  const byThread = new Map<string, AppServerThreadSignalInput>();
  for (const thread of input?.threads ?? []) {
    const ref = activeStateAppServerThreadRef(thread);
    if (!ref) continue;
    byThread.set(ref, thread);
  }
  return byThread;
}

function activeStateAppServerThreadRef(thread: AppServerThreadSignalInput): string | null {
  const sourceRef = typeof thread.sourceRef === "string" ? normalizeCodexThreadSourceRef(thread.sourceRef, thread.threadId ?? null) : null;
  if (sourceRef) return sourceRef;
  if (typeof thread.threadId === "string" && thread.threadId.trim()) return codexThreadRef(safeThreadId(thread.threadId));
  return null;
}

function activeStateVisibleMapByThread(input: VisibleCodexSessionMapReport | null | undefined): Map<string, VisibleCodexSessionMapItem> {
  const byThread = new Map<string, VisibleCodexSessionMapItem>();
  if (!isVisibleCodexSessionMapReport(input)) return byThread;
  for (const item of input.items) {
    const ref = normalizeCodexThreadSourceRef(item.sourceRef ?? item.sessionCardRef ?? null, null);
    if (!ref || byThread.has(ref)) continue;
    byThread.set(ref, item);
  }
  return byThread;
}

function appServerThreadCoverage(input: AppServerThreadsInput | null | undefined): VisibleCodexCoverageState {
  if (!input) return "not_configured";
  if (input.sourceCoverage?.codexAppServer) return input.sourceCoverage.codexAppServer;
  if ((input.errors?.length ?? 0) > 0 && (input.threads?.length ?? 0) === 0) return "unavailable";
  return Array.isArray(input.threads) ? "ok" : "partial";
}

function activeThreadStateComparator(left: CodexActiveThreadStateItem, right: CodexActiveThreadStateItem): number {
  const stateRank = {
    needs_nudge: 8,
    needs_approval: 7,
    blocked: 6,
    stale: 5,
    running: 4,
    waiting: 3,
    unknown: 2,
    idle: 1
  } as const satisfies Record<CodexActiveThreadStateKind, number>;
  const stateDelta = stateRank[right.state] - stateRank[left.state];
  if (stateDelta !== 0) return stateDelta;
  const attentionDelta = compareOperatingUrgency(left.attention.level, right.attention.level);
  if (attentionDelta !== 0) return attentionDelta;
  if (left.attention.urgencyScore !== right.attention.urgencyScore) return right.attention.urgencyScore - left.attention.urgencyScore;
  const freshnessDelta = compareUpdatedAtDesc(left.freshness.lastEventAt, right.freshness.lastEventAt);
  if (freshnessDelta !== 0) return freshnessDelta;
  if (left.confidence !== right.confidence) return right.confidence - left.confidence;
  return left.threadId.localeCompare(right.threadId);
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

function collaborationPublicSafeActionEvidenceArg(input: unknown): Record<string, unknown> | undefined {
  if (!isObjectRecord(input)) return undefined;
  const evidence = publicCodexDesktopActionEvidence(input);
  if (evidence.actionKind === "none" || evidence.actionKind === "unknown") return undefined;
  return {
    action_kind: evidence.actionKind,
    action: evidence.action ?? undefined,
    dry_run: evidence.dryRun ?? undefined,
    live: evidence.live ?? undefined,
    approval_audit_id_present: evidence.approvalAuditIdPresent,
    evidence_id: evidence.evidenceId ?? undefined,
    observed_at: evidence.observedAt ?? undefined
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
  const readStateReconciliationRequired = coherenceState === "gui_persisted_read_state_stale";
  const fallbackRequired = readStateReconciliationRequired
    ? false
    : typeof fallbackDetails?.required === "boolean"
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
    ...(readStateReconciliationRequired ? ["read_state_reconciliation_required"] : []),
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
          : coherenceState && ["cli_visible", "desktop_refresh_required", "desktop_restart_required", "gui_persisted_read_state_stale"].includes(coherenceState)
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
  if (coherenceState === "gui_persisted_read_state_stale") return false;
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
  const cards = getRecentSessions(db, { scope: "all", limit: 500, includeCards: true, now: options.now }).cards;
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
  const desktopGuiObservationSupplied = actionEvidence.actionKind === "desktop_gui_observation" && actionEvidence.live === true && actionEvidence.dryRun === false;
  const postObservationReadStateEvidence = desktopGuiObservationSupplied && codexDesktopHasPostObservationReadStateEvidence([currentMap, afterMap], sourceRef, actionEvidence.observedAt);
  const readStatePostObservationEvidencePending = desktopGuiObservationSupplied && !desktopVisible && !ambiguous && !postObservationReadStateEvidence;
  const guiPersistedReadStateStale = desktopGuiObservationSupplied && postObservationReadStateEvidence && cliVisible && !desktopVisible && !ambiguous;
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
    ...(latest && latest.matchedItemCount === 0 ? ["target_not_found_in_visible_map"] : []),
    ...(guiPersistedReadStateStale ? ["read_state_stale_after_gui_observation"] : [])
  ];
  const state = codexDesktopCoherenceState({
    ambiguous,
    cliVisible,
    desktopVisibleBefore,
    desktopVisibleCurrent,
    desktopVisibleAfter,
    guiPersistedReadStateStale,
    readStatePostObservationEvidencePending,
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
    ...(desktopGuiObservationSupplied ? ["desktop_gui_observation_supplied"] : []),
    ...(postObservationReadStateEvidence ? ["read_state_post_observation_evidence_current"] : []),
    ...(readStatePostObservationEvidencePending ? ["read_state_post_observation_evidence_pending"] : []),
    ...(guiPersistedReadStateStale ? ["read_state_stale_after_gui_observation"] : []),
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
    nextAction: codexDesktopCoherenceNextAction(state, { readStatePostObservationEvidencePending })
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
  const withoutDirectives = stripPlanEnvelopeTokens(raw).replace(/(?:::)?[A-Za-z0-9_-]+\{[\s\S]*?\}/g, " ");
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

function stripPlanEnvelopeTokens(value: string): string {
  return value.replace(/<\/?proposed_plan>/gi, " ");
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
    .replace(/^#{1,6}\s+/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+#{1,6}\s+[A-Za-z0-9][\w\s:/.-]{0,100}$/i, "")
    .trim();
  text = cutEmbeddedHeadingMarker(text);
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(/^(?:title|final|summary|objective|next action|next|action)\s*:\s*/i, "").trim();
  }
  const embeddedLabel = text.match(/\s(?:title|final|summary|objective|next action|next|status|priority|owner|blocker|source refs?|proposed plan refs?|final-message refs?|touched-file refs?)\s*:/i);
  if (embeddedLabel?.index && embeddedLabel.index > 0) text = text.slice(0, embeddedLabel.index).trim();
  if (role === "title") text = text.replace(/\s+(?:final|summary|next action|next)\s*:.*$/i, "").trim();
  text = text.replace(/\s+#{1,6}\s+[A-Za-z0-9][\w\s:/.-]{0,100}$/i, "").trim();
  return cutEmbeddedHeadingMarker(text);
}

function cutEmbeddedHeadingMarker(value: string): string {
  const embeddedHeading = value.match(/\s#{1,3}\s+/);
  if (embeddedHeading?.index && embeddedHeading.index > 0) return value.slice(0, embeddedHeading.index).trim();
  return value.replace(/\s#{1,3}\s+/g, " ").trim();
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
  if (/<\/?proposed_plan>/i.test(text)) return false;
  if (/^#{1,6}\s+/.test(text)) return false;
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
    titleAliases: unique((input.titleAliases ?? []).map((alias) => publicSafeText(alias, 160).trim()).filter(Boolean)).slice(0, 12),
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

function codexDesktopHasPostObservationReadStateEvidence(
  maps: unknown[],
  sourceRef: string | null,
  observedAt: string | null
): boolean {
  const observedAtMs = timestampMillis(observedAt);
  if (observedAtMs === null) return false;
  return maps.some((map) => {
    const freshnessAtMs = codexDesktopReadStateFreshnessMillis(map, sourceRef);
    return freshnessAtMs !== null && freshnessAtMs >= observedAtMs;
  });
}

function codexDesktopReadStateFreshnessMillis(map: unknown, sourceRef: string | null): number | null {
  if (!isVisibleCodexSessionMapReport(map)) return null;
  const matched = sourceRef
    ? map.items.filter((item) => visibleMapItemMatchesTarget(item, sourceRef))
    : [];
  if (matched.length === 0) return null;
  const timestamps = [
    map.generatedAt,
    ...matched.flatMap(codexDesktopMapItemReadTimestamps)
  ].flatMap((value) => {
    const parsed = timestampMillis(value);
    return parsed === null ? [] : [parsed];
  });
  return timestamps.length === 0 ? null : Math.max(...timestamps);
}

function codexDesktopMapItemReadTimestamps(item: VisibleCodexSessionMapItem): string[] {
  const itemRecord = item as unknown as Record<string, unknown>;
  const freshness = isObjectRecord(itemRecord.freshness)
    ? itemRecord.freshness
    : {};
  return [
    typeof freshness.indexedUpdatedAt === "string" ? freshness.indexedUpdatedAt : null,
    typeof freshness.appServerUpdatedAt === "string" ? freshness.appServerUpdatedAt : null
  ].filter((value): value is string => Boolean(value));
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
    || value === "gui_persisted_read_state_stale"
    || value === "unknown"
    ? value
    : "unknown";
}

function looksSensitiveRefLike(value: string): boolean {
  return /(?:^|[^A-Za-z0-9])(npm_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|xox[baprs]-[A-Za-z0-9-]{10,})/.test(value)
    || /PRIVATE_CANARY|BEGIN [A-Z ]*PRIVATE KEY/i.test(value)
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
  const redacted = publicSafeText(trimmed, 120).trim();
  if (trimmed && redacted === trimmed && !looksSensitiveRefLike(trimmed) && /^[A-Za-z0-9._:-]{1,96}$/.test(trimmed)) return trimmed;
  return `thread_${stableId(redacted || trimmed || "unknown").slice(0, 16)}`;
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
    || value === "desktop_gui_observation"
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
  guiPersistedReadStateStale: boolean;
  readStatePostObservationEvidencePending: boolean;
  priorDesktopMiss: boolean;
  refreshKind: CodexDesktopCoherenceReport["refreshKind"];
}): CodexDesktopCoherenceState {
  if (input.ambiguous) return "unknown";
  if (input.guiPersistedReadStateStale) return "gui_persisted_read_state_stale";
  if (input.readStatePostObservationEvidencePending) return "unknown";
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
  if (input.state === "gui_persisted_read_state_stale") return { cli, desktop: "not_seen" };
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
  if (input.state === "gui_persisted_read_state_stale") return Number(Math.max(0.66, max).toFixed(2));
  if (input.state === "cli_visible") return Number(Math.max(0.62, max).toFixed(2));
  return Number(Math.min(0.4, max || 0.2).toFixed(2));
}

function codexDesktopCoherenceReasonCodes(state: CodexDesktopCoherenceState): string[] {
  if (state === "desktop_visible") return ["desktop_visible_without_refresh"];
  if (state === "desktop_refresh_required") return ["desktop_visible_after_refresh_only"];
  if (state === "desktop_restart_required") return ["desktop_visible_after_restart_only"];
  if (state === "gui_persisted_read_state_stale") return ["gui_persisted_read_state_stale"];
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

function codexDesktopCoherenceNextAction(state: CodexDesktopCoherenceState, options: { readStatePostObservationEvidencePending?: boolean } = {}): string {
  if (state === "desktop_visible") return "Desktop visibility is proven by supplied public-safe map evidence; do not treat this as GUI mutation approval.";
  if (state === "desktop_refresh_required") return "Record the safe Desktop refresh flow before claiming live visible collaboration.";
  if (state === "desktop_restart_required") return "Route the live-refresh gap to the desktop fallback lane before claiming same-session Desktop collaboration.";
  if (state === "gui_persisted_read_state_stale") return "A supplied public-safe Desktop observation indicates the GUI action completed, but LCO read-state surfaces have not converged; refresh indexed/session/app-server evidence before claiming coherent Desktop read-state.";
  if (state === "cli_visible") return "CLI/direct/app-server visibility is proven, but Desktop visibility is not; gather visible Codex evidence or route #308 fallback proof.";
  if (options.readStatePostObservationEvidencePending) return "Refresh post-observation Codex read-state evidence and reconcile the visible map before classifying the Desktop GUI observation as stale.";
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

function normalizedMetadataMatchValue(value: string | null): string {
  // Keep lifecycle matching as a separate call site from hash/display normalization
  // so future truncation changes cannot silently constrain semantic state scans.
  return normalizedMetadataValue(value);
}

function negatesTitleFinalizerSignal(value: string): boolean {
  return value
    .split(/[.!?;\n]+/)
    .some((clause) => {
      const titleMatch = THREAD_TITLE_FINALIZER_SIGNAL_PATTERN.exec(clause);
      if (!titleMatch) return false;
      const negationMatch = THREAD_TITLE_FINALIZER_LEADING_NEGATION_PATTERN.exec(clause);
      if (negationMatch && negationMatch.index <= titleMatch.index) return true;
      const trailing = clause.slice(titleMatch.index + titleMatch[0].length);
      return THREAD_TITLE_FINALIZER_TRAILING_NEGATION_PATTERN.test(trailing);
    });
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
        SELECT thread_id AS threadId, call_id AS callId, tool_name AS toolName, arguments_text AS argumentsText, reason_code AS reasonCode
        FROM codex_tool_calls
        WHERE thread_id = ?
        ORDER BY rowid DESC
        LIMIT ?
      `).all(options.threadId, limit)
    : db.prepare(`
        SELECT thread_id AS threadId, call_id AS callId, tool_name AS toolName, arguments_text AS argumentsText, reason_code AS reasonCode
        FROM codex_tool_calls
        ORDER BY rowid DESC
        LIMIT ?
      `).all(limit);
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    threadId: String(row.threadId),
    callId: String(row.callId),
    toolName: String(row.toolName),
    argumentsText: String(row.argumentsText ?? ""),
    reasonCode: toolCallReasonCode(row.reasonCode)
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
  const description = describeSession(db, options.threadId, { telemetry: false });
  if (!description) throw new Error(`Unknown Codex thread: ${options.threadId}`);
  const plans = getCodexPlans(db, { threadId: options.threadId, limit: 10 }).map((plan) => plan.text);
  const profile = resolveRecallProfile(options.profile, options.tokenBudget);
  if (profile.name === "metadata") {
    const metadata = [
      `Thread: ${description.title ?? description.threadId}`,
      `Ref: ${description.sourceRef}`,
      `ID: ${description.threadId}`,
      description.cwd ? `CWD: ${publicSafeText(description.cwd, 500)}` : null,
      description.branch ? `Branch: ${description.branch}` : null,
      description.gitSha ? `Git SHA: ${description.gitSha}` : null,
      description.summary ? `Summary: ${publicSafeText(description.summary, 2000)}` : null,
      formatSessionMetadata(description.metadata),
      `Plans: ${description.planCount}`,
      `Touched files: ${description.touchedFiles.length}`,
      `Tool calls: ${description.toolCallCount}`,
      `Source ref: ${publicSourcePathRef(description.sourcePath)}`
    ].filter(Boolean).join("\n");
    const result: ExpandRecallResult & { threadId: string } = {
      sourceKind: "codex_thread",
      sourceRef: description.sourceRef,
      threadId: options.threadId,
      text: metadata,
      tokenBudget: profile.tokenBudget,
      profile
    };
    recordTelemetryFollowEvent(db, {
      sourceRef: result.sourceRef,
      followKind: "expand",
      telemetry: options.telemetry,
      telemetrySessionId: options.telemetrySessionId,
      now: options.now
    });
    return result;
  }
  const text = [
    `Thread: ${description.title ?? description.threadId}`,
    `ID: ${description.threadId}`,
    description.cwd ? `CWD: ${publicSafeText(description.cwd, 500)}` : null,
    description.branch ? `Branch: ${description.branch}` : null,
    description.gitSha ? `Git SHA: ${description.gitSha}` : null,
    description.summary ? `Summary: ${publicSafeText(description.summary, profile.name === "evidence" ? 3200 : 1600)}` : null,
    description.finalMessage ? `Final message: ${publicSafeText(description.finalMessage, profile.name === "evidence" ? 3200 : 900)}` : null,
    description.touchedFiles.length ? `Touched files:\n${formatTouchedFiles(description.touchedFiles, profile.name === "evidence" ? 50 : 12, profile.name === "evidence" ? 3200 : 900)}` : null,
    plans.length ? `Plans:\n${plans.map((plan) => publicSafeText(plan, profile.name === "evidence" ? 3200 : 1200)).join("\n\n")}` : null
  ].filter(Boolean).join("\n\n");
  const result: ExpandRecallResult & { threadId: string } = {
    sourceKind: "codex_thread",
    sourceRef: description.sourceRef,
    threadId: options.threadId,
    text: truncateByApproxTokens(text, profile.tokenBudget),
    tokenBudget: profile.tokenBudget,
    profile
  };
  recordTelemetryFollowEvent(db, {
    sourceRef: result.sourceRef,
    followKind: "expand",
    telemetry: options.telemetry,
    telemetrySessionId: options.telemetrySessionId,
    now: options.now
  });
  return result;
}

function formatTouchedFiles(files: string[], limit: number, maxChars: number): string {
  const perPathLimit = maxChars > 1000 ? 180 : 120;
  const visible: string[] = [];
  for (const file of files.slice(0, limit)) {
    const next = `- ${publicSafeText(file, perPathLimit)}`;
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

export function probeLcmPeerDbs(paths = configuredLcmPeerDbPaths()): LcmPeerProbeReport {
  const peers = normalizePeerPaths(paths).map((path) => probeLcmPeerDb(path));
  const summary = {
    ready: peers.filter((peer) => peer.status === "ready").length,
    degraded: peers.filter((peer) => peer.status === "degraded").length,
    unavailable: peers.filter((peer) => peer.status === "unavailable").length
  };
  const status = peers.length === 0 || summary.ready === peers.length
    ? "ready"
    : summary.unavailable === peers.length
      ? "unavailable"
      : "degraded";
  return { schema: "lco.lcm.peerDoctor.v1", status, readOnly: true, summary, peers };
}

function searchCodexEventContent(db: LooDatabase, options: { query: string; limit: number }): { matches: RecallSearchResult[]; reasonCodes: string[] } {
  const query = options.query.trim();
  if (!query || !tableExists(db, "codex_event_content") || !tableExists(db, "codex_event_content_fts")) return { matches: [], reasonCodes: [] };
  const terms = safeFtsTerms(query);
  if (terms.length === 0) return { matches: [], reasonCodes: [] };
  let rows: Array<Record<string, unknown>>;
  try {
    rows = db.prepare(`
      SELECT
        c.event_id AS eventId,
        c.event_ref AS eventRef,
        c.thread_id AS threadId,
        c.event_kind AS eventKind,
        c.line_start AS lineStart,
        c.line_end AS lineEnd,
        c.byte_start AS byteStart,
        c.byte_end AS byteEnd,
        c.ordinal AS ordinal,
        c.event_text AS eventText,
        s.title AS title,
        s.summary AS summary,
        s.updated_at AS updatedAt,
        s.source_path AS sourcePath,
        snippet(codex_event_content_fts, 2, '[', ']', '...', 18) AS snippet,
        rank AS rank
      FROM codex_event_content_fts
      JOIN codex_event_content c ON c.rowid = codex_event_content_fts.rowid
      JOIN codex_sessions s ON s.thread_id = c.thread_id
      WHERE codex_event_content_fts MATCH ?
      ORDER BY rank ASC, c.thread_id ASC, c.ordinal ASC
      LIMIT ?
    `).all(terms.join(" "), options.limit) as Array<Record<string, unknown>>;
  } catch {
    return { matches: [], reasonCodes: ["event_content_fts_query_error"] };
  }
  return { matches: rows.map((row, index) => {
    const threadId = String(row.threadId);
    const sourcePath = String(row.sourcePath ?? "");
    const sourceStatus = sourcePath && existsSync(sourcePath) ? "source_available" : "source_rotated";
    const snippet = String(row.snippet ?? "") || createSnippet(String(row.eventText ?? ""), query);
    return {
      sourceKind: "codex_thread",
      sourceRef: codexThreadRef(threadId),
      threadId,
      title: nullableString(row.title),
      summary: nullableString(row.summary),
      updatedAt: nullableString(row.updatedAt),
      score: index + 1,
      snippet: publicSafeSearchText(snippet, 260),
      reasonCodes: unique([
        "event_content_fts_match",
        "matched_field:event_content",
        sourceStatus === "source_rotated" ? "source_rotated" : ""
      ].filter(Boolean)),
      event: {
        eventId: String(row.eventId),
        eventRef: String(row.eventRef),
        eventKind: String(row.eventKind),
        lineStart: Number(row.lineStart),
        lineEnd: Number(row.lineEnd),
        byteStart: Number(row.byteStart),
        byteEnd: Number(row.byteEnd),
        ordinal: Number(row.ordinal),
        sourceStatus
      }
    };
  }), reasonCodes: [] };
}

function collapseEventMatchesBySourceRef(matches: RecallSearchResult[]): RecallSearchResult[] {
  const bySourceRef = new Map<string, { match: RecallSearchResult; suppressed: number }>();
  for (const match of matches) {
    const existing = bySourceRef.get(match.sourceRef);
    if (!existing) {
      bySourceRef.set(match.sourceRef, { match, suppressed: 0 });
      continue;
    }
    existing.suppressed += 1;
  }
  return [...bySourceRef.values()].map(({ match, suppressed }) => suppressed > 0
    ? {
        ...match,
        reasonCodes: unique([
          ...(match.reasonCodes ?? []),
          "event_content_best_per_thread"
        ])
      }
    : match);
}

export function grepRecall(db: LooDatabase, options: {
  query: string;
  limit?: number;
  profile?: RecallProfileName;
  tokenBudget?: number;
  lcmDbPaths?: string[];
  telemetry?: boolean;
  telemetrySessionId?: string;
  now?: string;
}): GrepRecallResult {
  const query = options.query.trim();
  const limit = clamp(options.limit ?? 10, 1, 100);
  const profile = resolveRecallProfile(options.profile, options.tokenBudget);
  if (!query) return { query, profile, matches: [] };
  const sessionMatches: RecallSearchResult[] = searchSessions(db, { query, limit, telemetry: false, now: options.now }).map((match) => ({
    ...match,
    sourceKind: "codex_thread",
    sourceRef: codexThreadRef(match.threadId),
    threadId: match.threadId
  }));
  const eventSearch = searchCodexEventContent(db, { query, limit });
  const eventMatches = collapseEventMatchesBySourceRef(eventSearch.matches);
  const eventSessionRefs = new Set(eventMatches.map((match) => match.sourceRef));
  const codexMatches = [
    ...eventMatches,
    ...sessionMatches.filter((match) => !eventSessionRefs.has(match.sourceRef))
  ].slice(0, limit);
  const claudeMatches = searchClaudeSessions(db, { query, limit });
  const lcmSearch = searchLcmPeers(options.lcmDbPaths ?? [], query, limit);
  const matches = [...codexMatches, ...claudeMatches, ...lcmSearch.matches].slice(0, limit).map((match, index) => ({ ...match, score: index + 1 }));
  if (retrievalTelemetryEnabled(options.telemetry)) {
    recordTelemetrySearchEvent(db, {
      query,
      results: matches,
      telemetrySessionId: options.telemetrySessionId,
      now: options.now
    });
  }
  const reasonCodes = unique([
    ...eventSearch.reasonCodes,
    lcmSearch.peerRead ? "lcm_peer_source_read" : ""
  ].filter(Boolean));
  return reasonCodes.length > 0 ? { query, profile, matches, reasonCodes } : { query, profile, matches };
}

export function createRecallIndexSummary(options: {
  codex?: IndexCodexResult | null;
  claude?: IndexClaudeResult | null;
}): RecallIndexSummary {
  const sourceKinds: RecallIndexSourceKind[] = [];
  if (options.codex) sourceKinds.push("codex");
  if (options.claude) sourceKinds.push("claude");
  return {
    publicSafe: true,
    readOnly: false,
    mutationClasses: ["derived_cache"],
    attempted: sourceKinds.length > 0,
    sourceKinds,
    indexedFiles: (options.codex?.indexedFiles ?? 0) + (options.claude?.indexedFiles ?? 0),
    skippedFiles: (options.codex?.skippedFiles ?? 0) + (options.claude?.skippedFiles ?? 0),
    indexedThreads: options.codex?.indexedThreads ?? 0,
    indexedSessions: options.claude?.indexedSessions ?? 0,
    indexedEvents: (options.codex?.indexedEvents ?? 0) + (options.claude?.indexedEvents ?? 0),
    limitedFiles: (options.codex?.limitedFiles.length ?? 0) + (options.claude?.limitedFiles.length ?? 0),
    warnings: (options.codex?.warnings.length ?? 0) + (options.claude?.warnings.length ?? 0),
    errors: (options.codex?.errors.length ?? 0) + (options.claude?.errors.length ?? 0)
  };
}

function normalizeRecallIndexSummary(indexed: IndexCodexResult | IndexClaudeResult | RecallIndexSummary | null): RecallIndexSummary | null {
  if (!indexed) return null;
  if ("sourceKinds" in indexed) return indexed;
  if ("indexedThreads" in indexed) return createRecallIndexSummary({ codex: indexed });
  return createRecallIndexSummary({ claude: indexed });
}

export function createFindRecallReport(options: {
  query: string;
  limit?: number;
  recall: GrepRecallResult;
  indexed?: IndexCodexResult | IndexClaudeResult | RecallIndexSummary | null;
}): FindRecallReport {
  const requestedLimit = options.limit ?? (options.recall.matches.length || 10);
  const limit = clamp(requestedLimit, 1, 100);
  const indexed = normalizeRecallIndexSummary(options.indexed ?? null);
  const safeMatches = options.recall.matches.filter((match) => match.sourceKind !== "lcm_summary" || isPublicPreparedSourceRef(match.sourceRef));
  const unsafeResultsFiltered = safeMatches.length !== options.recall.matches.length;
  const results = safeMatches.slice(0, limit).map(sanitizeFindRecallResult);
  const incrementalIndexAttempted = indexed?.attempted ?? false;
  const localCodexSourceRead = Boolean(indexed?.sourceKinds.includes("codex"));
  const localClaudeSourceRead = Boolean(indexed?.sourceKinds.includes("claude"));
  const localLcmSourceRead = options.recall.reasonCodes?.includes("lcm_peer_source_read") === true
    || results.some((result) => result.sourceKind === "lcm_summary");
  const localRecallSourceRead = incrementalIndexAttempted || localLcmSourceRead;
  const transcriptDerivedContentRead = incrementalIndexAttempted
    || results.some((result) => result.reasonCodes.includes("event_content_fts_match"));
  return {
    schema: "lco.find.v1",
    ok: true,
    publicSafe: true,
    query: publicSafeFindText(options.query, 180),
    limit,
    indexed: {
      attempted: incrementalIndexAttempted,
      sourceKinds: indexed?.sourceKinds ?? [],
      indexedFiles: indexed?.indexedFiles ?? 0,
      skippedFiles: indexed?.skippedFiles ?? 0,
      indexedThreads: indexed?.indexedThreads ?? 0,
      indexedSessions: indexed?.indexedSessions ?? 0,
      indexedEvents: indexed?.indexedEvents ?? 0,
      limitedFiles: indexed?.limitedFiles ?? 0,
      warnings: indexed?.warnings ?? 0,
      errors: indexed?.errors ?? 0
    },
    resultCount: results.length,
    results,
    nextSafeCommands: findRecallNextSafeCommands(options.query, results),
    actionsPerformed: {
      derivedCacheWrite: incrementalIndexAttempted,
      localRecallSourceRead,
      localCodexSourceRead,
      localClaudeSourceRead,
      localLcmSourceRead,
      sourceStoreMutation: false,
      externalWrite: false,
      liveControl: false,
      guiMutation: false,
      rawTranscriptRead: transcriptDerivedContentRead,
      rawTranscriptReturned: false,
      rawTranscriptUploaded: false
    },
    reasonCodes: unique([
      "find_command",
      incrementalIndexAttempted ? "incremental_index_attempted" : "index_skipped_by_flag",
      localCodexSourceRead ? "codex_index_attempted" : "",
      localClaudeSourceRead ? "claude_index_attempted" : "",
      localLcmSourceRead ? "lcm_peer_source_read" : "",
      unsafeResultsFiltered ? "unsafe_results_filtered" : "",
      results.some((result) => result.reasonCodes.includes("event_content_fts_match")) ? "event_content_results_available" : "",
      results.length === 0 ? "no_matches" : ""
    ].filter(Boolean))
  };
}

function sanitizeFindRecallResult(match: RecallSearchResult, index: number): FindRecallResult {
  const result: FindRecallResult = {
    rank: index + 1,
    sourceKind: match.sourceKind,
    sourceRef: publicSafeFindRef(match.sourceRef),
    title: nullableFindRecallText(match.title, 180),
    summary: nullableFindRecallText(match.summary, 260),
    updatedAt: nullableFindRecallText(match.updatedAt, 80),
    snippet: publicSafeFindText(match.snippet, 360),
    reasonCodes: unique(match.reasonCodes ?? [])
  };
  if (match.threadId) result.threadId = publicSafeFindText(match.threadId, 160);
  if (match.sessionId) result.sessionId = publicSafeFindText(match.sessionId, 160);
  if (match.summaryId) result.summaryId = publicSafeFindText(match.summaryId, 160);
  if (match.event) {
    result.event = {
      eventRef: publicSafeFindRef(match.event.eventRef),
      eventKind: publicSafeFindText(match.event.eventKind, 80),
      lineStart: match.event.lineStart,
      lineEnd: match.event.lineEnd,
      ordinal: match.event.ordinal,
      sourceStatus: publicSafeFindText(match.event.sourceStatus, 80)
    };
  }
  return result;
}

function findRecallNextSafeCommands(query: string, results: FindRecallResult[]): string[] {
  if (results.length === 0) {
    return [
      `lco grep ${shellQuoteFindRecallForDisplay(query)}`,
      "lco index codex --verify"
    ];
  }
  const firstRef = results[0]!.sourceRef;
  return [
    `lco describe ${firstRef}`,
    `lco expand-ref --profile brief ${firstRef}`,
    `lco grep ${shellQuoteFindRecallForDisplay(query)}`
  ];
}

function shellQuoteFindRecallForDisplay(value: string): string {
  const sanitized = publicSafeFindText(value, 180);
  if (/^[A-Za-z0-9._:@/-]+$/.test(sanitized)) return sanitized;
  return `"${sanitized.replace(/["\\]/g, "\\$&")}"`;
}

function nullableFindRecallText(value: string | null | undefined, maxChars: number): string | null {
  if (!value) return null;
  return publicSafeFindText(value, maxChars);
}

function publicSafeFindText(value: string, maxChars: number): string {
  return publicSafeSearchText(value, maxChars)
    .replace(/\b(?:sk|npm|ghp|github|bearer|token|secret|cookie)[A-Za-z0-9_:-]{8,}\b/gi, "<redacted-secret>")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "<redacted-secret>")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g, "<redacted-secret>")
    .replace(/\b[A-Z0-9_]*(?:TOKEN|SECRET|COOKIE|CANARY)[A-Z0-9_:-]*\b/g, "<redacted-secret>")
    .replace(/\b\S+\.jsonl\b/g, "<redacted-source-file>")
    .replace(/\s+/g, " ")
    .trim();
}

function publicSafeFindRef(value: string): string {
  return publicSafeFindText(value, Math.max(512, value.length + 64));
}

export function describeRecallRef(db: LooDatabase, options: { sourceRef: string; lcmDbPaths?: string[]; telemetry?: boolean; telemetrySessionId?: string; now?: string }): RecallDescription | null {
  const parsed = parseSourceRef(options.sourceRef);
  if (parsed.kind === "codex_thread") {
    const description = describeSession(db, parsed.id, { telemetry: false });
    if (!description) return null;
    const result: RecallDescription = {
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
    recordTelemetryFollowEvent(db, {
      sourceRef: result.sourceRef,
      followKind: "describe",
      telemetry: options.telemetry,
      telemetrySessionId: options.telemetrySessionId,
      now: options.now
    });
    return result;
  }
  if (parsed.kind === "claude_session") {
    const description = describeClaudeSessionInventory(db, parsed.id);
    if (!description) return null;
    const result: RecallDescription = {
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
    recordTelemetryFollowEvent(db, {
      sourceRef: result.sourceRef,
      followKind: "describe",
      telemetry: options.telemetry,
      telemetrySessionId: options.telemetrySessionId,
      now: options.now
    });
    return result;
  }
  const summary = getLcmSummaryByRef(options.lcmDbPaths ?? [], parsed.dbHash, parsed.id);
  if (!summary) return null;
  const result = lcmSummaryDescription(summary);
  recordTelemetryFollowEvent(db, {
    sourceRef: result.sourceRef,
    followKind: "describe",
    telemetry: options.telemetry,
    telemetrySessionId: options.telemetrySessionId,
    now: options.now
  });
  return result;
}

export function createRecallRefNotFoundResult(db: LooDatabase, sourceRef: string): RecallRefNotFoundResult {
  const parsed = parseSourceRef(sourceRef);
  if (parsed.kind === "codex_thread") {
    return createCodexThreadNotFoundResult(db, parsed.id);
  }
  const safeRef = publicSafeText(sourceRef, 180);
  const label = parsed.kind === "claude_session" ? "Claude session ref" : "LCM summary ref";
  return {
    ok: false,
    code: "ref_not_found",
    ref: safeRef,
    reason: "ref_not_found",
    message: `Unknown ${label}: ${safeRef}`,
    nearestMatches: []
  };
}

export function createCodexThreadNotFoundResult(db: LooDatabase, threadId: string): RecallRefNotFoundResult {
  const normalizedThreadId = bareCodexThreadId(threadId);
  const safeThreadId = publicSafeText(normalizedThreadId, 160);
  const sourceRef = codexThreadRef(safeThreadId);
  return {
    ok: false,
    code: "ref_not_found",
    ref: sourceRef,
    reason: "ref_not_found",
    message: `Unknown Codex thread: ${safeThreadId}`,
    nearestMatches: nearestCodexThreadMatches(db, normalizedThreadId)
  };
}

function nearestCodexThreadMatches(db: LooDatabase, threadId: string): RecallRefNotFoundResult["nearestMatches"] {
  const query = nearestCodexThreadQuery(threadId);
  if (!query) return [];
  return searchSessions(db, { query, limit: 3, telemetry: false }).slice(0, 3).map((match, index) => ({
    sourceRef: match.sourceRef,
    title: match.title,
    score: index + 1
  }));
}

function nearestCodexThreadQuery(threadId: string): string {
  const useful = threadId
    .replace(/^codex_thread:/, "")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3)
    .filter((part) => !isCodexThreadIdLikeSearchToken(part));
  return useful.join(" ");
}

function isCodexThreadIdLikeSearchToken(part: string): boolean {
  if (/^[0-9a-f]{3,}$/i.test(part)) return true;
  return part.length >= 8 && /^[0-9a-z]+$/i.test(part) && /\d/.test(part);
}

export function expandRecallRef(db: LooDatabase, options: {
  sourceRef: string;
  lcmDbPaths?: string[];
  profile?: RecallProfileName;
  tokenBudget?: number;
  telemetry?: boolean;
  telemetrySessionId?: string;
  now?: string;
}): ExpandRecallResult {
  const parsed = parseSourceRef(options.sourceRef);
  if (parsed.kind === "codex_thread") {
    const result = expandSession(db, { threadId: parsed.id, profile: options.profile, tokenBudget: options.tokenBudget, telemetry: false });
    recordTelemetryFollowEvent(db, {
      sourceRef: result.sourceRef,
      followKind: "expand",
      telemetry: options.telemetry,
      telemetrySessionId: options.telemetrySessionId,
      now: options.now
    });
    return result;
  }
  if (parsed.kind === "claude_session") {
    const description = describeClaudeSessionInventory(db, parsed.id);
    if (!description) throw new Error(`Unknown Claude session ref: ${options.sourceRef}`);
    const profile = resolveRecallProfile(options.profile, options.tokenBudget);
    const metadata = formatClaudeSessionInventoryMetadata(description);
    const text = profile.name === "metadata"
      ? metadata
      : truncateByApproxTokens(`${metadata}\n\nSafe summary:\n${publicSafeText(description.summary ?? "", profile.tokenBudget * 6)}`, profile.tokenBudget);
    const result: ExpandRecallResult = {
      sourceKind: "claude_session",
      sourceRef: description.sourceRef,
      sessionId: description.sessionId,
      text,
      tokenBudget: profile.tokenBudget,
      profile
    };
    recordTelemetryFollowEvent(db, {
      sourceRef: result.sourceRef,
      followKind: "expand",
      telemetry: options.telemetry,
      telemetrySessionId: options.telemetrySessionId,
      now: options.now
    });
    return result;
  }
  const expansion = getLcmSummaryExpansionByRef(options.lcmDbPaths ?? [], parsed.dbHash, parsed.id);
  if (!expansion) throw new Error(`Unknown LCM summary ref: ${options.sourceRef}`);
  const summary = expansion.root;
  const profile = resolveRecallProfile(options.profile, options.tokenBudget);
  const metadata = [
    `Summary ID: ${summary.summaryId}`,
    `Ref: ${lcmSummaryRef(summary.sourcePath, summary.summaryId)}`,
    `Conversation: ${publicSafeText(summary.conversationTitle ?? String(summary.conversationId), 500)}`,
    `Conversation ID: ${summary.conversationId}`,
    summary.kind ? `Kind: ${summary.kind}` : null,
    summary.depth !== null ? `Depth: ${summary.depth}` : null,
    summary.tokenCount !== null ? `Token count: ${summary.tokenCount}` : null,
    summary.model ? `Model: ${publicSafeText(summary.model, 120)}` : null,
    summary.updatedAt ? `Updated: ${summary.updatedAt}` : null,
    `Source ref: ${publicSourcePathRef(summary.sourcePath)}`
  ].filter(Boolean).join("\n");
  const sourceSummaryText = formatLcmSourceSummaries(expansion, profile);
  const omissionLine = formatLcmOmissionsLine(expansion.reasonCodes);
  const text = profile.name === "metadata"
    ? metadata
    : truncateLcmSummaryExpansionText([
      `${metadata}\n\nContent:\n${publicSafeText(summary.content, profile.tokenBudget * 6)}`,
      sourceSummaryText
    ].filter(Boolean).join("\n\n"), profile.tokenBudget, omissionLine);
  const result: ExpandRecallResult = {
    sourceKind: "lcm_summary",
    sourceRef: lcmSummaryRef(summary.sourcePath, summary.summaryId),
    summaryId: summary.summaryId,
    text,
    tokenBudget: profile.tokenBudget,
    profile
  };
  recordTelemetryFollowEvent(db, {
    sourceRef: result.sourceRef,
    followKind: "expand",
    telemetry: options.telemetry,
    telemetrySessionId: options.telemetrySessionId,
    now: options.now
  });
  return result;
}

function formatLcmSourceSummaries(expansion: LcmSummaryExpansion, profile: RecallProfile): string {
  if (profile.name === "metadata" || expansion.sourceSummaries.length === 0) return "";
  const perSummaryBudget = Math.max(80, Math.floor((profile.tokenBudget * 6) / Math.max(1, expansion.sourceSummaries.length + 1)));
  const lines = expansion.sourceSummaries.map((summary, index) => {
    const labelParts = [
      `${index + 1}. ${publicSafeText(summary.summaryId, 120)}`,
      summary.kind ? `kind=${publicSafeText(summary.kind, 60)}` : null,
      summary.depth !== null ? `depth=${summary.depth}` : null,
      summary.tokenCount !== null ? `tokens=${summary.tokenCount}` : null
    ].filter(Boolean).join(" ");
    return `${labelParts}\n${publicSafeText(summary.content, perSummaryBudget)}`;
  });
  const omissionLine = formatLcmOmissionsLine(expansion.reasonCodes);
  if (omissionLine) lines.push(omissionLine);
  return ["Source summaries:", ...lines].join("\n");
}

function formatLcmOmissionsLine(reasonCodes: string[]): string {
  const omissions = reasonCodes.filter((reason) => reason !== "lcm_summary_dag_unavailable");
  return omissions.length > 0 ? `Omissions: ${omissions.join(", ")}` : "";
}

function truncateLcmSummaryExpansionText(text: string, tokenBudget: number, requiredTail: string): string {
  if (!requiredTail) return truncateByApproxTokens(text, tokenBudget);
  const tailTokenBudget = Math.ceil((requiredTail.length + 8) / 4);
  const bodyBudget = Math.max(1, tokenBudget - tailTokenBudget);
  const truncated = truncateByApproxTokens(text, bodyBudget);
  return truncated.includes(requiredTail) ? truncated : `${truncated}\n\n${requiredTail}`;
}

export function expandQuery(db: LooDatabase, options: {
  query: string;
  limit?: number;
  profile?: RecallProfileName;
  tokenBudget?: number;
  lcmDbPaths?: string[];
  telemetry?: boolean;
  telemetrySessionId?: string;
  now?: string;
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
    ...expandRecallRef(db, {
      sourceRef: first.sourceRef,
      lcmDbPaths: options.lcmDbPaths,
      profile: options.profile,
      tokenBudget: options.tokenBudget,
      telemetry: options.telemetry,
      telemetrySessionId: options.telemetrySessionId,
      now: options.now
    }),
    query: grep.query,
    matches: grep.matches
  };
}

type TelemetryHarvestCandidate = {
  queryHash: string;
  chosenRef: string;
  observedRank: number;
  occurrenceCount: number;
  followKinds: Set<RetrievalTelemetryFollowKind>;
};

export function harvestRetrievalTelemetry(db: LooDatabase, options: RetrievalTelemetryHarvestOptions): RetrievalTelemetryHarvestReport {
  const generatedAt = telemetryTimestamp(options.now);
  const generatedAtMs = timestampMillis(generatedAt) ?? Date.now();
  const lookbackMs = positiveLimit(options.lookbackMs, RETRIEVAL_TELEMETRY_HARVEST_LOOKBACK_MS, "lookbackMs");
  const maxRows = clamp(options.maxRows ?? RETRIEVAL_TELEMETRY_HARVEST_MAX_ROWS, 1, 10_000);
  const sinceIso = new Date(generatedAtMs - lookbackMs).toISOString();
  assertTelemetryHarvestProposalPathIsPrivate(options.proposalPath);
  const sampledRows = db.prepare(`
    SELECT
      s.query_hash AS queryHash,
      f.chosen_ref AS chosenRef,
      f.rank_position AS rankPosition,
      f.follow_kind AS followKind,
      COUNT(*) AS occurrenceCount
    FROM telemetry_follow_events f
    JOIN telemetry_search_events s ON s.id = f.search_event_id
    WHERE s.telemetry_session_key IS NOT NULL
      AND s.ts >= ?
      AND s.ts <= ?
      AND f.ts >= ?
      AND f.ts <= ?
    GROUP BY s.query_hash, f.chosen_ref, f.rank_position, f.follow_kind
    ORDER BY occurrenceCount DESC, f.rank_position ASC, s.query_hash ASC, f.chosen_ref ASC
    LIMIT ?
  `).all(sinceIso, generatedAt, sinceIso, generatedAt, maxRows + 1) as Array<{
    queryHash: string;
    chosenRef: string;
    rankPosition: number;
    followKind: RetrievalTelemetryFollowKind;
    occurrenceCount: number;
  }>;
  const sampleTruncated = sampledRows.length > maxRows;
  const rows = sampledRows.slice(0, maxRows);
  const countRow = db.prepare(`
    SELECT
      COUNT(DISTINCT s.id) AS telemetrySearchEvents,
      COUNT(DISTINCT f.id) AS telemetryFollowEvents
    FROM telemetry_follow_events f
    JOIN telemetry_search_events s ON s.id = f.search_event_id
    WHERE s.telemetry_session_key IS NOT NULL
      AND s.ts >= ?
      AND s.ts <= ?
      AND f.ts >= ?
      AND f.ts <= ?
  `).get(sinceIso, generatedAt, sinceIso, generatedAt) as { telemetrySearchEvents?: number; telemetryFollowEvents?: number } | undefined;
  const searchEventCount = Number(countRow?.telemetrySearchEvents ?? 0);
  const followEventCount = Number(countRow?.telemetryFollowEvents ?? 0);
  const candidatesByQuery = new Map<string, Map<string, TelemetryHarvestCandidate>>();
  const rankDistribution: Record<string, number> = {};

  for (const row of rows) {
    const rank = Number(row.rankPosition);
    const occurrenceCount = Number(row.occurrenceCount);
    if (!Number.isSafeInteger(rank) || rank < 1 || !Number.isSafeInteger(occurrenceCount) || occurrenceCount < 1) continue;
    const byRef = candidatesByQuery.get(row.queryHash) ?? new Map<string, TelemetryHarvestCandidate>();
    const existing = byRef.get(row.chosenRef);
    if (existing) {
      existing.observedRank = Math.min(existing.observedRank, rank);
      existing.occurrenceCount += occurrenceCount;
      existing.followKinds.add(row.followKind);
    } else {
      byRef.set(row.chosenRef, {
        queryHash: row.queryHash,
        chosenRef: row.chosenRef,
        observedRank: rank,
        occurrenceCount,
        followKinds: new Set([row.followKind])
      });
    }
    candidatesByQuery.set(row.queryHash, byRef);
  }

  const candidates = [...candidatesByQuery.values()]
    .map((byRef) => [...byRef.values()].sort(compareTelemetryHarvestCandidates)[0])
    .filter((candidate): candidate is TelemetryHarvestCandidate => Boolean(candidate))
    .sort((left, right) => left.queryHash.localeCompare(right.queryHash));
  for (const candidate of candidates) {
    const rankKey = String(candidate.observedRank);
    rankDistribution[rankKey] = (rankDistribution[rankKey] ?? 0) + 1;
  }
  const scenarios = candidates.map((candidate, index) => ({
    id: `harvested-query-${index + 1}`,
    publicSafe: false,
    requiresManualCuration: true,
    redactionRequired: true,
    query: telemetryQueryPlaceholder(candidate.queryHash),
    queryHash: candidate.queryHash,
    expectedSourceRefs: [candidate.chosenRef],
    observedRank: candidate.observedRank,
    followKinds: orderedFollowKinds(candidate.followKinds),
    occurrenceCount: candidate.occurrenceCount
  }));
  const metrics: RetrievalTelemetryMetrics = {
    sample: {
      sampledGroups: rows.length,
      maxRows,
      sampleTruncated
    },
    rankDistribution: Object.fromEntries(Object.entries(rankDistribution).sort(([left], [right]) => Number(left) - Number(right))),
    topMissQueries: candidates
      .filter((candidate) => candidate.observedRank > 5)
      .sort((left, right) => right.occurrenceCount - left.occurrenceCount || right.observedRank - left.observedRank || left.queryHash.localeCompare(right.queryHash))
      .slice(0, 10)
      .map((candidate, index) => ({
        missId: `miss_${index + 1}`,
        observedRank: candidate.observedRank,
        occurrenceCount: candidate.occurrenceCount
      }))
  };

  if (options.metricsPath) {
    mkdirSync(dirname(options.metricsPath), { recursive: true });
    // Metrics files are allowed in git checkouts because this schema is
    // publicSafe aggregate output only. Do not add raw query text, query hashes,
    // source refs, or local paths here without restoring a private path guard.
    writeFileSync(options.metricsPath, `${JSON.stringify({
      schema: "lco.retrieval.telemetryMetrics.v1",
      publicSafe: true,
      generatedAt,
      metrics
    }, null, 2)}\n`);
  }

  // Re-check immediately before writing the private proposal artifact. This is
  // an accidental-commit guard for local operators, not a sandbox boundary.
  assertTelemetryHarvestProposalPathIsPrivate(options.proposalPath);
  mkdirSync(dirname(options.proposalPath), { recursive: true });
  writeFileSync(options.proposalPath, `${JSON.stringify({
    schema: "lco.retrieval.telemetryHarvest.v1",
    publicSafe: false,
    requiresManualCuration: true,
    doNotCommit: true,
    rawQueryTextIncluded: false,
    generatedAt,
      source: "local_derived_cache",
      sampleTruncated,
      scenarios
    }, null, 2)}\n`);

  return {
    schema: "lco.retrieval.telemetryHarvestReport.v1",
    publicSafe: true,
    generatedAt,
    summary: {
      telemetrySearchEvents: searchEventCount,
      telemetryFollowEvents: followEventCount,
      proposedScenarios: scenarios.length,
      sampledGroups: rows.length,
      maxRows,
      sampleTruncated
    },
    proposalFile: {
      written: true,
      publicSafe: false,
      requiresManualCuration: true
    },
    metricsFile: options.metricsPath ? {
      written: true,
      publicSafe: true
    } : null,
    metrics,
    privateDataExclusions: [
      "raw Codex transcripts",
      "raw prompts or transcript spans in public output",
      "verbatim telemetry query text in public metrics",
      "SQLite DBs",
      "tokens, credentials, API keys, cookies",
      "private customer data"
    ],
    proofBoundary: "Harvest proposals are local, not-public-safe curation inputs from opt-in derived-cache telemetry. The returned report and metrics contain aggregate counts, sampled ranks, hashes, placeholders, truncation markers, and ephemeral miss ids only; they do not commit scenarios, widen retrieval claims, mutate source stores, or create public evidence from query text.",
    nextAction: sampleTruncated
      ? "Increase maxRows or narrow the harvest window before curating proposed retrieval scenarios."
      : scenarios.length === 0
      ? "Run opt-in search and describe/expand flows before harvesting proposed retrieval scenarios."
      : "Manually review, redact, and curate proposed scenarios before adding anything to evals/."
  };
}

function telemetryQueryPlaceholder(queryHash: string): string {
  return `[redacted-query:${queryHash.slice(0, 12)}]`;
}

function assertTelemetryHarvestProposalPathIsPrivate(proposalPath: string): void {
  const proposalDir = dirname(canonicalMaybeMissingPath(proposalPath));
  const gitRoot = nearestGitRoot(proposalDir);
  if (gitRoot) {
    throw new Error("Telemetry harvest proposal files are private curation artifacts and must be written outside git checkouts");
  }
}

function nearestGitRoot(startDir: string): string | null {
  let cursor = resolve(startDir);
  const seen = new Set<string>();
  while (cursor && dirname(cursor) !== cursor) {
    for (const candidate of [cursor, canonicalMaybeMissingPath(cursor)]) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (existsSync(join(candidate, ".git"))) return candidate;
    }
    cursor = dirname(cursor);
  }
  for (const candidate of [cursor, canonicalMaybeMissingPath(cursor)]) {
    if (!seen.has(candidate) && existsSync(join(candidate, ".git"))) return candidate;
  }
  return null;
}

function compareTelemetryHarvestCandidates(left: TelemetryHarvestCandidate, right: TelemetryHarvestCandidate): number {
  return right.occurrenceCount - left.occurrenceCount
    || left.observedRank - right.observedRank
    || left.chosenRef.localeCompare(right.chosenRef);
}

function orderedFollowKinds(kinds: Set<RetrievalTelemetryFollowKind>): RetrievalTelemetryFollowKind[] {
  return (["describe", "expand"] as RetrievalTelemetryFollowKind[]).filter((kind) => kinds.has(kind));
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

export function evaluateRetrievalBaselineScenarios(db: LooDatabase, options: {
  scenarios: RetrievalEvalScenario[];
  floors?: RetrievalBaselineFloors | null;
  now?: string;
  availableCapabilities?: string[];
}): RetrievalBaselineReport {
  const availableCapabilities = new Set((options.availableCapabilities ?? []).map((capability) => capability.trim()).filter(Boolean));
  const scenarios = options.scenarios.map((scenario) => evaluateRetrievalBaselineScenario(db, scenario, options.now, availableCapabilities));
  const scoredScenarios = scenarios.filter((scenario) => !scenario.skipped);
  const overall = retrievalBaselineMetrics(scoredScenarios);
  const families = retrievalBaselineFamilyMetrics(scoredScenarios);
  const blockers = retrievalBaselineFloorBlockers(scoredScenarios, overall, families, options.floors ?? null);
  return {
    ok: blockers.length === 0,
    publicSafe: true,
    generatedAt: options.now ?? new Date().toISOString(),
    strategy: "field-weighted-fts-ranking",
    metrics: {
      scenarioCount: scoredScenarios.length,
      skippedScenarioCount: scenarios.length - scoredScenarios.length,
      overall,
      families
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
    proofBoundary: "This public-safe eval measures source-ref retrieval metrics for the current field-weighted FTS engine only; it does not prove vector retrieval, live control, GUI mutation, or private-store retrieval quality.",
    nextAction: blockers.length === 0
      ? "Use this gate as the baseline ratchet before changing retrieval ranking."
      : "Inspect the floor blockers and update ranking or the explicitly versioned baseline floors before claiming retrieval readiness."
  };
}

function evaluateRetrievalBaselineScenario(
  db: LooDatabase,
  scenario: RetrievalEvalScenario,
  now: string | undefined,
  availableCapabilities: Set<string>
): RetrievalBaselineScenarioResult {
  const k = clamp(scenario.k ?? scenario.limit ?? 5, 1, 20);
  const limit = Math.max(5, k);
  const expectedSourceRefs = unique(scenario.expectedSourceRefs.filter(Boolean));
  const requires = unique((scenario.requires ?? []).map((capability) => capability.trim()).filter(Boolean));
  const missingRequirements = requires.filter((capability) => !availableCapabilities.has(capability));
  if (missingRequirements.length > 0) {
    return {
      id: scenario.id,
      family: scenario.family?.trim() || "uncategorized",
      rationale: scenario.rationale?.trim() || null,
      query: scenario.query,
      expectedSourceRefs,
      k,
      requires,
      skipped: true,
      hitAt1: false,
      hitAt5: false,
      hitAtK: false,
      firstExpectedRank: null,
      reciprocalRank: 0,
      topRefs: [],
      reasonCodes: missingRequirements.map((capability) => `requires:${capability}`)
    };
  }
  const matches = grepRecall(db, { query: scenario.query, limit, now }).matches;
  const topRefs = matches.map((match) => match.sourceRef);
  const firstExpectedIndex = topRefs.findIndex((ref) => expectedSourceRefs.includes(ref));
  const firstExpectedRank = firstExpectedIndex >= 0 ? firstExpectedIndex + 1 : null;
  const queryTermCount = rawQueryTermCount(scenario.query);
  const reasonCodes = unique([
    firstExpectedRank === null ? "expected_ref_missed" : `expected_ref_rank:${firstExpectedRank}`,
    firstExpectedRank !== null && firstExpectedRank <= 1 ? "hit_at_1" : "",
    firstExpectedRank !== null && firstExpectedRank <= 5 ? "hit_at_5" : "",
    firstExpectedRank !== null && firstExpectedRank <= k ? `hit_at_k:${k}` : "",
    queryTermCount > CODEX_SEARCH_FTS_TERM_CAP ? "query_terms_truncated" : "",
    matches.length === 0 ? "no_matches" : ""
  ].filter(Boolean));
  return {
    id: scenario.id,
    family: scenario.family?.trim() || "uncategorized",
    rationale: scenario.rationale?.trim() || null,
    query: scenario.query,
    expectedSourceRefs,
    k,
    requires,
    skipped: false,
    hitAt1: firstExpectedRank !== null && firstExpectedRank <= 1,
    hitAt5: firstExpectedRank !== null && firstExpectedRank <= 5,
    hitAtK: firstExpectedRank !== null && firstExpectedRank <= k,
    firstExpectedRank,
    reciprocalRank: firstExpectedRank === null ? 0 : 1 / firstExpectedRank,
    topRefs,
    reasonCodes
  };
}

function retrievalBaselineMetrics(scenarios: RetrievalBaselineScenarioResult[]): RetrievalBaselineMetricSet {
  return {
    hitAt1: roundedMetric(rate(scenarios.filter((scenario) => scenario.hitAt1).length, scenarios.length)),
    hitAt5: roundedMetric(rate(scenarios.filter((scenario) => scenario.hitAt5).length, scenarios.length)),
    mrr: roundedMetric(average(scenarios.map((scenario) => scenario.reciprocalRank)))
  };
}

function retrievalBaselineFamilyMetrics(scenarios: RetrievalBaselineScenarioResult[]): Record<string, RetrievalBaselineMetricSet & { scenarioCount: number }> {
  const byFamily = new Map<string, RetrievalBaselineScenarioResult[]>();
  for (const scenario of scenarios) {
    byFamily.set(scenario.family, [...(byFamily.get(scenario.family) ?? []), scenario]);
  }
  return Object.fromEntries([...byFamily.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([family, familyScenarios]) => [
    family,
    {
      scenarioCount: familyScenarios.length,
      ...retrievalBaselineMetrics(familyScenarios)
    }
  ]));
}

function retrievalBaselineFloorBlockers(
  scenarios: RetrievalBaselineScenarioResult[],
  overall: RetrievalBaselineMetricSet,
  families: Record<string, RetrievalBaselineMetricSet & { scenarioCount: number }>,
  floors: RetrievalBaselineFloors | null
): string[] {
  const blockers: string[] = [];
  if (scenarios.length === 0) blockers.push("no_scenarios");
  if (!floors) return blockers;
  if (floors.scenarioCount !== undefined && floors.scenarioCount !== scenarios.length) {
    blockers.push(`floor_scenario_count_mismatch:${scenarios.length}:expected_${floors.scenarioCount}`);
  }
  for (const metric of ["hitAt1", "hitAt5", "mrr"] as const) {
    if (overall[metric] < floors.overall[metric]) blockers.push(`overall_${metric}_regressed:${overall[metric]}<${floors.overall[metric]}`);
  }
  for (const [family, familyFloors] of Object.entries(floors.families ?? {})) {
    const actual = families[family];
    if (!actual) {
      blockers.push(`family_missing:${family}`);
      continue;
    }
    if (familyFloors.scenarioCount !== undefined && familyFloors.scenarioCount !== actual.scenarioCount) {
      blockers.push(`family_scenario_count_mismatch:${family}:${actual.scenarioCount}:expected_${familyFloors.scenarioCount}`);
    }
    for (const metric of ["hitAt1", "hitAt5", "mrr"] as const) {
      if (actual[metric] < familyFloors[metric]) blockers.push(`family_${family}_${metric}_regressed:${actual[metric]}<${familyFloors[metric]}`);
    }
  }
  return blockers;
}

function roundedMetric(value: number): number {
  return Number(value.toFixed(6));
}

function rawQueryTermCount(query: string): number {
  return query.match(/[\p{L}\p{N}_-]+/gu)?.length ?? 0;
}

function searchLcmPeers(paths: string[], query: string, limit: number): { matches: RecallSearchResult[]; peerRead: boolean } {
  const matches: RecallSearchResult[] = [];
  let peerRead = false;
  for (const path of paths) {
    if (matches.length >= limit) break;
    let db: LooDatabase | null = null;
    try {
      const normalizedPath = normalizePeerPath(path);
      db = openLcmPeerDb(normalizedPath);
      peerRead = true;
      matches.push(...searchLcmPeer(db, normalizedPath, query, limit - matches.length));
    } catch {
      // Peer reads are optional and must not break Codex recall.
    } finally {
      db?.close();
    }
  }
  return { matches, peerRead };
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
  return lexicalQueryTerms(query).reduce((score, term) => score + (haystack.includes(term.toLowerCase()) ? 1 : 0), 0);
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
          SUBSTR(s.content, 1, ${LCM_SUMMARY_CONTENT_MAX_CHARS}) AS content,
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
      SUBSTR(s.content, 1, ${LCM_SUMMARY_CONTENT_MAX_CHARS}) AS content,
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
  const path = findLcmPeerPathByHash(paths, dbHash);
  if (!path) return null;
  let db: LooDatabase | null = null;
  try {
    db = openLcmPeerDb(path);
    if (!tableExists(db, "summaries")) return null;
    return getLcmSummaryRecordFromDb(db, path, summaryId);
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function getLcmSummaryExpansionByRef(paths: string[], dbHash: string, summaryId: string): LcmSummaryExpansion | null {
  const path = findLcmPeerPathByHash(paths, dbHash);
  if (!path) return null;
  let db: LooDatabase | null = null;
  try {
    db = openLcmPeerDb(path);
    if (!tableExists(db, "summaries")) return null;
    const root = getLcmSummaryRecordFromDb(db, path, summaryId);
    if (!root) return null;
    return {
      root,
      ...walkLcmSummarySources(db, path, summaryId)
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function getLcmSummaryRecordFromDb(db: LooDatabase, path: string, summaryId: string): LcmSummaryRecord | null {
  const hasConversations = tableExists(db, "conversations");
  const row = db.prepare(`
    SELECT
      s.summary_id AS summaryId,
      s.conversation_id AS conversationId,
      ${hasConversations ? "c.title" : "NULL"} AS conversationTitle,
      s.kind,
      s.depth,
      SUBSTR(s.content, 1, ${LCM_SUMMARY_CONTENT_MAX_CHARS}) AS content,
      s.token_count AS tokenCount,
      s.model,
      s.created_at AS createdAt,
      COALESCE(s.latest_at, s.created_at${hasConversations ? ", c.updated_at" : ""}) AS updatedAt
    FROM summaries s
    ${hasConversations ? "LEFT JOIN conversations c ON c.conversation_id = s.conversation_id" : ""}
    WHERE s.summary_id = ?
  `).get(summaryId) as Record<string, unknown> | undefined;
  return row ? lcmSummaryRecord(path, row) : null;
}

function walkLcmSummarySources(db: LooDatabase, path: string, summaryId: string): Pick<LcmSummaryExpansion, "sourceSummaries" | "reasonCodes"> {
  if (!tableExists(db, "summary_parents")) return { sourceSummaries: [], reasonCodes: ["lcm_summary_dag_unavailable"] };
  const sourceSummaries: LcmSummaryRecord[] = [];
  const reasonCodes: string[] = [];
  const seen = new Set([summaryId]);
  const queue: Array<{ summaryId: string; depth: number }> = [{ summaryId, depth: 0 }];
  try {
    while (queue.length > 0 && sourceSummaries.length < LCM_SUMMARY_DAG_MAX_NODES) {
      const current = queue.shift()!;
      if (current.depth >= LCM_SUMMARY_DAG_MAX_DEPTH) {
        reasonCodes.push("lcm_summary_dag_depth_cap");
        continue;
      }
      const rows = db.prepare(`
        SELECT parent_summary_id AS summaryId
        FROM summary_parents
        WHERE summary_id = ?
        ORDER BY ordinal ASC, parent_summary_id ASC
      `).all(current.summaryId) as Array<{ summaryId: string }>;
      for (const row of rows) {
        if (sourceSummaries.length >= LCM_SUMMARY_DAG_MAX_NODES) {
          reasonCodes.push("lcm_summary_dag_node_cap");
          break;
        }
        const childId = String(row.summaryId ?? "");
        if (!childId) continue;
        if (seen.has(childId)) {
          reasonCodes.push("lcm_summary_dag_cycle_omitted");
          continue;
        }
        seen.add(childId);
        const child = getLcmSummaryRecordFromDb(db, path, childId);
        if (!child) {
          reasonCodes.push("lcm_summary_dag_missing_child");
          continue;
        }
        sourceSummaries.push(child);
        queue.push({ summaryId: child.summaryId, depth: current.depth + 1 });
      }
    }
    if (queue.length > 0) reasonCodes.push("lcm_summary_dag_truncated");
  } catch {
    return { sourceSummaries: [], reasonCodes: ["lcm_summary_dag_unavailable"] };
  }
  return { sourceSummaries, reasonCodes: unique(reasonCodes) };
}

function lcmSummaryRecord(path: string, row: Record<string, unknown>): LcmSummaryRecord {
  return {
    summaryId: String(row.summaryId),
    conversationId: Number(row.conversationId ?? 0),
    conversationTitle: nullableString(row.conversationTitle),
    kind: nullableString(row.kind),
    depth: row.depth === null || row.depth === undefined ? null : Number(row.depth),
    content: redactPublicSafeString(String(row.content ?? "")),
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
      const optionalTables = ["summaries_fts", "conversations", "summary_messages", "summary_parents"];
      const missingOptionalTables = optionalTables.filter((table) => !tables.includes(table));
      const emptySummaries = supported
        ? Number((db.prepare(`
            SELECT COUNT(*) AS count
            FROM (
              SELECT 1
              FROM summaries
              WHERE TRIM(COALESCE(content, '')) = ''
              LIMIT ?
            ) bounded_empty_summaries
          `).get(LCM_PEER_SUMMARY_SCAN_MAX + 1) as { count: number }).count)
        : 0;
      const emptySummaryScanCapped = emptySummaries > LCM_PEER_SUMMARY_SCAN_MAX;
      const staleDagLinks = supported && tables.includes("summary_parents")
        ? Number((db.prepare(`
            SELECT COUNT(*) AS count
            FROM (
              SELECT 1
              FROM summary_parents p
              LEFT JOIN summaries child ON child.summary_id = p.summary_id
              LEFT JOIN summaries parent ON parent.summary_id = p.parent_summary_id
              WHERE child.summary_id IS NULL OR parent.summary_id IS NULL
              LIMIT ?
            ) bounded_stale_links
          `).get(LCM_PEER_SUMMARY_SCAN_MAX + 1) as { count: number }).count)
        : 0;
      const staleDagLinkScanCapped = staleDagLinks > LCM_PEER_SUMMARY_SCAN_MAX;
      const integrityRows = supported && tables.includes("summary_parents")
        ? db.prepare(`
            SELECT SUBSTR(summary_id, 1, ${LCM_SUMMARY_ID_MAX_CHARS + 1}) AS summaryId
            FROM summaries
            ORDER BY summary_id ASC
            LIMIT ?
          `).all(LCM_PEER_SUMMARY_SCAN_MAX + 1) as Array<{ summaryId: string }>
        : [];
      const integrityScanCapped = integrityRows.length > LCM_PEER_SUMMARY_SCAN_MAX;
      let traversalDegraded = 0;
      let dagCycles = 0;
      for (const row of integrityRows.slice(0, LCM_PEER_SUMMARY_SCAN_MAX)) {
        const walked = walkLcmSummarySources(db, normalizedPath, String(row.summaryId ?? ""));
        if (walked.reasonCodes.length > 0) traversalDegraded += 1;
        if (walked.reasonCodes.includes("lcm_summary_dag_cycle_omitted")) dagCycles += 1;
      }
      const degradedExpansions = missingOptionalTables.includes("summary_parents")
        ? summaryCount ?? 0
        : Math.max(traversalDegraded, emptySummaries + staleDagLinks, integrityScanCapped ? 1 : 0);
      const reasonCodes = unique([
        ...missingOptionalTables.map((table) => `lcm_peer_optional_table_missing:${table}`),
        summaryCount === 0 ? "lcm_peer_summary_table_empty" : "",
        emptySummaries > 0 ? "lcm_peer_empty_summaries" : "",
        staleDagLinks > 0 ? "lcm_peer_stale_dag_links" : "",
        dagCycles > 0 ? "lcm_peer_dag_cycle" : "",
        integrityScanCapped || emptySummaryScanCapped || staleDagLinkScanCapped ? "lcm_peer_integrity_scan_cap" : "",
        degradedExpansions > 0 ? "lcm_peer_degraded_expansion" : ""
      ].filter(Boolean));
      const status: LcmPeerProbe["status"] = !supported
        ? "unavailable"
        : summaryCount === 0 || reasonCodes.length > 0
          ? "degraded"
          : "ready";
      return {
        status,
        path: publicSafeLcmPeerPath(normalizedPath),
        readable: true,
        readOnly: true,
        queryOnly: queryOnlyEnabled(db),
        supported,
        tables: tables.filter((table) => ["summaries", "summaries_fts", "conversations", "summary_messages", "summary_parents"].includes(table)),
        summaryCount,
        ftsAvailable: tables.includes("summaries_fts"),
        reason: supported ? null : "missing summaries table",
        integrity: { missingOptionalTables, emptySummaries, staleDagLinks, degradedExpansions, reasonCodes }
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      status: "unavailable",
      path: publicSafeLcmPeerPath(normalizedPath),
      readable: false,
      readOnly: true,
      queryOnly: false,
      supported: false,
      tables: [],
      summaryCount: null,
      ftsAvailable: false,
      reason: publicSafeText(error instanceof Error ? error.message : String(error), 300),
      integrity: {
        missingOptionalTables: [],
        emptySummaries: 0,
        staleDagLinks: 0,
        degradedExpansions: 0,
        reasonCodes: ["lcm_peer_unavailable"]
      }
    };
  }
}

function publicSafeLcmPeerPath(path: string): string {
  return `<redacted-local-path>/lcm-peer-${stableId(path).slice(0, 12)}.sqlite`;
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
  return truncate(redactPublicSafeString(value), maxChars);
}

function redactPublicSafeString(value: string): string {
  const localPathRootPattern =
    "(?:\\/Volumes\\/|\\/(?:Users|home|root)\\/|\\/(?:private\\/)?(?:tmp|var)\\/|~\\/|(?<![A-Za-z])[A-Za-z]:[\\\\/])";
  const structuredLabelPattern = "[A-Za-z][A-Za-z0-9 _-]{0,32}:";
  const relativePathStartPattern = "(?:\\.{1,2}\\/|[A-Za-z0-9_.-]+\\/)";
  const omissionMarkerPattern = "\\+\\d+\\s+more\\b";
  const localPathTerminatorPattern =
    `(?=$|[\\r\\n"'\\\`)\\]}]|\\s+(?:${localPathRootPattern}|${relativePathStartPattern}|${omissionMarkerPattern}|${structuredLabelPattern}))`;
  const localPathPattern = new RegExp(`${localPathRootPattern}(?:(?!${localPathTerminatorPattern}).)+`, "g");
  const pathRedacted = value.replace(localPathPattern, "<redacted-path>");
  return redactSafeString(pathRedacted).replace(localPathPattern, "<redacted-path>");
}

function publicSafeSearchText(value: string, maxChars = 500): string {
  return publicSafeText(value, maxChars);
}

function publicSafeToolArguments(value: string, maxChars = 2000): string {
  return publicSafeText(value, maxChars);
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
  if (trimmed && redacted === trimmed && !looksSensitiveRefLike(trimmed) && /^[A-Za-z0-9._-]{1,96}$/.test(trimmed)) return trimmed;
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
  const encodedSummaryId = encodeURIComponent(summaryId).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `lcm_summary:${lcmPeerHash(path)}:${encodedSummaryId}`;
}

function lcmPeerHashFromRef(sourceRef: string): string | null {
  const match = /^lcm_summary:([0-9a-f]{12}):/.exec(sourceRef);
  return match?.[1] ?? null;
}

function lcmPeerHash(path: string): string {
  return stableId(normalizePeerPath(path)).slice(0, 12);
}

function legacyLcmPeerHash(path: string): string {
  return stableId(resolvePeerPath(path)).slice(0, 12);
}

function findLcmPeerPathByHash(paths: string[], dbHash: string): string | null {
  for (const configuredPath of paths) {
    try {
      const canonicalPath = normalizePeerPath(configuredPath);
      if (lcmPeerHash(canonicalPath) === dbHash || legacyLcmPeerHash(configuredPath) === dbHash) return canonicalPath;
    } catch {
      // Ignore unavailable optional peers.
    }
  }
  return null;
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
  return unique(paths.flatMap((path) => {
    try {
      return [normalizePeerPath(path)];
    } catch {
      return [];
    }
  }));
}

function queryTerms(query: string): string[] {
  return lexicalQueryTerms(query);
}

function normalizePeerPath(path: string): string {
  const resolved = resolvePeerPath(path);
  try {
    return realpathSync.native(resolved);
  } catch {
    try {
      return join(realpathSync.native(dirname(resolved)), basename(resolved));
    } catch {
      return resolved;
    }
  }
}

function resolvePeerPath(path: string): string {
  const resolved = path === "~"
    ? resolve(homeDirectory())
    : path.startsWith("~/")
      ? resolve(join(homeDirectory(), path.slice(2)))
      : resolve(path);
  return resolved;
}

function homeDirectory(): string {
  const home = homedir();
  if (!home) throw new Error("Cannot resolve home-relative LCM peer path");
  return home;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type JsonlFileCandidate = {
  path: string;
  mtimeMs: number;
};

type JsonlFileSelection = {
  files: string[];
  candidateFiles: string[];
  droppedOldest: LimitedCodexFile | null;
  errors: Array<{ path: string; message: string }>;
};

function collectJsonlFiles(roots: string[], maxFiles: number): JsonlFileSelection {
  const candidates: JsonlFileCandidate[] = [];
  const errors: Array<{ path: string; message: string }> = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      walk(root, candidates);
    } catch (error) {
      errors.push({ path: root, message: error instanceof Error ? error.message : String(error) });
    }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path));
  const candidateFiles = candidates.map((candidate) => candidate.path);
  const files = candidates.slice(0, maxFiles).map((candidate) => candidate.path);
  return {
    files,
    candidateFiles,
    droppedOldest: candidates.length > maxFiles
      ? {
          path: roots.length === 1 ? roots[0] : roots.join(delimiter),
          reason: "max_files_dropped_oldest",
          limit: maxFiles,
          actual: candidates.length
        }
      : null,
    errors
  };
}

function walk(path: string, files: JsonlFileCandidate[]): void {
  const entries = readdirSync(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(child, files);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push({ path: child, mtimeMs: statSync(child).mtimeMs });
    }
  }
}

function countJsonlEvents(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

const KNOWN_CODEX_JSONL_EVENT_KINDS = new Set([
  "agent_reasoning",
  "agent_reasoning_delta",
  "agent_message",
  "context_compacted",
  "custom_tool_call",
  "custom_tool_call_output",
  "dynamic_tool_call_response",
  "event_metadata",
  "exec_command_begin",
  "exec_command_end",
  "exec_command_output_delta",
  "function_call",
  "function_call_output",
  "item_completed",
  "message",
  "mcp_tool_call_begin",
  "mcp_tool_call_end",
  "native_subagent_result_metadata",
  "noop",
  "patch_apply_end",
  "plan_update",
  "reasoning",
  "session_metadata",
  "task_complete",
  "task_started",
  "thread_name",
  "thread_name_updated",
  "token_count",
  "tool_call",
  "tool_search_call",
  "tool_search_output",
  "tool_use",
  "turn_diff",
  "turn_aborted",
  "user_message",
  "web_search_begin",
  "web_search_end"
]);

const CODEX_JSONL_TRANSPARENT_ENVELOPES = new Set([
  "compacted",
  "event_msg",
  "item",
  "response_item",
  "session_meta",
  "turn_context"
]);

function parseCodexJsonl(sourcePath: string, text: string, maxEventsPerFile: number, options: CodexJsonlParseOptions = {}): ImportedSession {
  const fallbackId = fallbackThreadId(sourcePath);
  const session: ImportedSession = {
    threadId: options.threadId ? safeThreadId(options.threadId) : fallbackId.replace(/^rollout-[^-]+-/, ""),
    title: null,
    titleExplicit: false,
    cwd: null,
    model: null,
    branch: null,
    gitSha: null,
    createdAt: null,
    updatedAt: null,
    finalMessage: null,
    finalMessageExplicit: false,
    plans: [],
    touchedFiles: [],
    toolCalls: [],
    metadata: emptySessionMetadata(),
    metadataPresentTextFields: new Set(),
    metadataPresentRefFields: new Set(),
    closeoutEnvelopeText: null,
    closeoutEnvelopeOpenCount: 0,
    closeoutEnvelopeCloseCount: 0,
    safeText: "",
    eventCount: 0,
    sourceEvents: [],
    driftReport: null
  };

  const drift = emptyCodexJsonlDriftAccumulator();
  const safeParts: string[] = [];
  const assistantSafeParts: string[] = [];
  const touched = new Set<string>();
  const records = jsonlLineRecords(text, options.lineNumberOffset ?? 0, options.byteOffset ?? 0);
  const sourceHash = options.sourceHash ?? stableId(text);
  const sourcePathRef = publicSourcePathRef(sourcePath);
  const ordinalOffset = options.ordinalOffset ?? 0;
  let sawThreadIdInFile = false;
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    const ordinal = ordinalOffset + i;
    let item: any;
    try {
      item = JSON.parse(record.text);
    } catch {
      recordCodexJsonlUnparsedLine(drift);
      continue;
    }
    const rawItem = item;
    item = normalizeCodexJsonlItem(rawItem);
    if (session.eventCount >= maxEventsPerFile) break;
    session.eventCount += 1;
    const rangeKinds = new Set<PreparedSourceRangeKind>();
    const eventTextParts: string[] = [];
    const timestamp = findTimestamp(item);
    recordCodexJsonlEventKindDrift(drift, rawItem);
    recordCodexJsonlMissingFieldDrift(drift, item);
    if (timestamp) {
      session.createdAt ??= timestamp;
      session.updatedAt = timestamp;
    }
    const meta = item.session_meta?.payload ?? item.session_meta ?? item.turn_context?.payload ?? null;
    if (meta) {
      const metaThreadId = stringOrNull(meta.id ?? meta.thread_id);
      if (metaThreadId) {
        sawThreadIdInFile = true;
        session.threadId = safeThreadId(metaThreadId);
      }
      const cwd = stringOrNull(meta.cwd ?? meta.workdir ?? session.cwd);
      session.cwd = cwd ? redactSafeString(cwd) : null;
      session.model = stringOrNull(meta.model ?? session.model);
      session.branch = stringOrNull(meta.git?.branch ?? meta.git_branch ?? session.branch);
      session.gitSha = stringOrNull(meta.git?.commit_hash ?? meta.git_sha ?? session.gitSha);
      eventTextParts.push(...[
        cwd ? `cwd ${cwd}` : "",
        session.model ? `model ${session.model}` : "",
        session.branch ? `branch ${session.branch}` : ""
      ].filter(Boolean));
      rangeKinds.add("session_metadata");
    }

    const title = codexThreadTitleFromItem(item);
    if (title) {
      session.title = redactSafeString(title);
      session.titleExplicit = true;
      safeParts.push(session.title);
      eventTextParts.push(session.title);
      rangeKinds.add("thread_title");
    }

    const textPayloads = extractTextPayloads(item);
    for (const payload of textPayloads) {
      const metadataText = redactSafeString(payload.trim());
      if (metadataText) {
        const extractedMetadata = extractSessionMetadata(metadataText);
        mergeSessionMetadata(session.metadata, extractedMetadata);
        for (const field of extractedMetadata.presentTextFields) session.metadataPresentTextFields.add(field);
        for (const field of extractedMetadata.presentRefFields) session.metadataPresentRefFields.add(field);
        recordCloseoutEnvelopeEvidence(session, metadataText);
      }
      const clean = redactSafeString(normalizeText(payload));
      if (!clean) continue;
      safeParts.push(clean);
      eventTextParts.push(clean);
      const rangeKind = textRangeKind(item);
      rangeKinds.add(rangeKind);
      // Assistant finals must come from prose payloads, not tool-call envelopes.
      if (rangeKind === "assistant_message") assistantSafeParts.push(clean);
      const plans = extractPlans(clean);
      for (const plan of plans) session.plans.push(plan);
      if (plans.length > 0) rangeKinds.add("proposed_plan");
      const finalMessage = rangeKind === "assistant_message" && isLikelyFinal(clean);
      if (finalMessage) {
        session.finalMessage = clean;
        session.finalMessageExplicit = true;
        rangeKinds.add("final_message");
      }
      if (containsCloseoutEnvelope(clean)) rangeKinds.add("closeout");
      for (const file of extractTouchedFiles(clean)) touched.add(file);
    }

    const toolCalls = extractCodexToolCalls(item, sourcePath, ordinal);
    for (const call of toolCalls) {
      session.toolCalls.push(call);
      for (const file of extractTouchedFiles(redactSafeString(call.rawArgumentsText))) touched.add(file);
      safeParts.push(`${call.toolName} ${call.argumentsText}`);
      eventTextParts.push(`${call.toolName} ${call.argumentsText}`);
      rangeKinds.add("tool_call_metadata");
    }
    if (rangeKinds.size === 0) rangeKinds.add("event_metadata");
    session.sourceEvents.push(createPreparedSourceEventDraft({
      record,
      item,
      ordinal,
      sourceHash,
      sourcePathRef,
      threadId: session.threadId,
      observedAt: timestamp,
      rangeKinds: [...rangeKinds],
      eventText: eventContentTextForRecord(eventTextParts, item, timestamp)
    }));
  }

  session.touchedFiles = [...touched].sort();
  session.safeText = safeParts.join("\n").slice(0, CODEX_SAFE_TEXT_CHAR_LIMIT);
  session.finalMessage ??= lastAssistantText(assistantSafeParts);
  session.title ??= session.finalMessage ? truncate(session.finalMessage, 80) : session.threadId;
  session.updatedAt ??= new Date().toISOString();
  session.createdAt ??= session.updatedAt;
  if (!sawThreadIdInFile && !options.threadId) recordCodexJsonlMissingField(drift, "session_meta.payload.id");
  session.driftReport = codexJsonlDriftReport(sourcePath, drift);
  return session;
}

function emptyCodexJsonlDriftAccumulator(): CodexJsonlDriftAccumulator {
  return {
    unknownEventKinds: new Map(),
    unparsedLines: 0,
    missingExpectedFields: new Map()
  };
}

function emptyCodexJsonlDriftSummary(): CodexJsonlDriftSummary {
  return {
    files: 0,
    unknownEventKinds: 0,
    unparsedLines: 0,
    missingExpectedFields: 0
  };
}

function recordCodexJsonlDriftReport(result: IndexCodexResult, report: CodexJsonlDriftReport): void {
  result.driftReport.push(report);
  result.driftSummary.files += 1;
  result.driftSummary.unknownEventKinds += report.unknownEventKinds.reduce((sum, item) => sum + item.count, 0);
  result.driftSummary.unparsedLines += report.unparsedLines;
  result.driftSummary.missingExpectedFields += report.missingExpectedFields.reduce((sum, item) => sum + item.count, 0);
}

function recordCodexJsonlUnparsedLine(drift: CodexJsonlDriftAccumulator): void {
  drift.unparsedLines += 1;
}

function recordCodexJsonlEventKindDrift(drift: CodexJsonlDriftAccumulator, item: any): void {
  const kind = codexJsonlEventKind(item);
  if (!kind || KNOWN_CODEX_JSONL_EVENT_KINDS.has(kind)) return;
  if (!codexJsonlHasUnextractedContentfulPayload(item)) return;
  const safeKind = publicSafeCodexJsonlKind(kind);
  drift.unknownEventKinds.set(safeKind, (drift.unknownEventKinds.get(safeKind) ?? 0) + 1);
}

function publicSafeCodexJsonlKind(kind: string): string {
  const identifier = publicSafeIdentifier(kind);
  if (identifier) return identifier;
  const publicText = publicSafeText(kind, 96);
  const readable = publicText
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  if (!readable) return `unknown_${stableId(kind).slice(0, 12)}`;
  return readable === kind ? readable : `${readable}_${stableId(kind).slice(0, 6)}`;
}

function recordCodexJsonlMissingFieldDrift(drift: CodexJsonlDriftAccumulator, item: any): void {
  const eventMsg = isObjectRecord(item.event_msg) ? item.event_msg : null;
  if (eventMsg) {
    const eventType = stringOrNull(eventMsg.type)?.toLowerCase() ?? "";
    if (eventType === "thread_name" && !stringOrNull(eventMsg.name)) {
      recordCodexJsonlMissingField(drift, "event_msg.name");
    }
    if (eventType === "agent_message" && !stringOrNull(eventMsg.message) && !stringOrNull(eventMsg.text)) {
      recordCodexJsonlMissingField(drift, "event_msg.message");
    }
  }

  const responseItem = isObjectRecord(item.response_item) ? item.response_item : null;
  if (responseItem) {
    const responseType = stringOrNull(responseItem.type)?.toLowerCase() ?? "";
    if (responseType === "message" && !responseItemHasText(responseItem)) {
      recordCodexJsonlMissingField(drift, "response_item.content");
    }
    if (
      (responseType === "function_call" || responseType === "tool_call" || responseType === "tool_use")
      && !responseItemHasToolName(responseItem)
    ) {
      recordCodexJsonlMissingField(drift, "response_item.name");
    }
  }

}

function recordCodexJsonlMissingField(drift: CodexJsonlDriftAccumulator, field: string): void {
  drift.missingExpectedFields.set(field, (drift.missingExpectedFields.get(field) ?? 0) + 1);
}

function codexThreadTitleFromItem(item: any): string | null {
  const eventMsg = isObjectRecord(item.event_msg) ? item.event_msg : null;
  const eventType = stringOrNull(eventMsg?.type)?.toLowerCase() ?? "";
  const value = eventType === "thread_name" || eventType === "thread_name_updated"
    ? stringOrNull(eventMsg?.name ?? eventMsg?.title ?? eventMsg?.display_text ?? item.thread_name ?? item.payload?.name ?? item.payload?.title)
    : stringOrNull(item.thread_name ?? item.payload?.title);
  return value?.trim() || null;
}

function responseItemHasText(responseItem: Record<string, unknown>): boolean {
  if (stringOrNull(responseItem.text)) return true;
  return codexJsonlArrayHasText(responseItem.content);
}

function responseItemHasToolName(responseItem: Record<string, unknown>): boolean {
  const functionRecord = isObjectRecord(responseItem.function) ? responseItem.function : {};
  const toolRecord = isObjectRecord(responseItem.tool) ? responseItem.tool : {};
  return Boolean(
    stringOrNull(responseItem.name)
    ?? stringOrNull(responseItem.tool_name)
    ?? stringOrNull(responseItem.toolName)
    ?? stringOrNull(responseItem.recipient_name)
    ?? stringOrNull(functionRecord.name)
    ?? stringOrNull(toolRecord.name)
  );
}

function codexJsonlArrayHasText(value: unknown): boolean {
  if (typeof value === "string" && value.trim()) return true;
  if (!Array.isArray(value)) return false;
  return value.some((part) => {
    if (typeof part === "string" && part.trim()) return true;
    return isObjectRecord(part) && typeof part.text === "string" && part.text.trim().length > 0;
  });
}

function normalizeCodexJsonlItem(item: any): any {
  if (!isObjectRecord(item)) return item;
  const envelope = stringOrNull(item.type)?.toLowerCase() ?? "";
  const payload = isObjectRecord(item.payload) ? item.payload : null;
  if (!payload || !CODEX_JSONL_TRANSPARENT_ENVELOPES.has(envelope)) return item;
  if (envelope === "event_msg") return { ...item, event_msg: payload };
  if (envelope === "response_item" || envelope === "item") return { ...item, response_item: payload };
  if (envelope === "session_meta") return { ...item, session_meta: { payload } };
  if (envelope === "turn_context") return { ...item, turn_context: { payload } };
  return item;
}

function codexJsonlEventKind(item: any): string | null {
  const envelope = stringOrNull(item.type)?.toLowerCase() ?? null;
  if (envelope && CODEX_JSONL_TRANSPARENT_ENVELOPES.has(envelope)) {
    const payloadKind = stringOrNull(item.payload?.type ?? item.item?.payload?.type)?.toLowerCase();
    if (payloadKind) return payloadKind;
  }

  const inlineKind = stringOrNull(
    item.event_msg?.type
    ?? item.response_item?.type
    ?? item.item?.payload?.type
    ?? item.item?.type
  )?.toLowerCase();
  if (inlineKind) return inlineKind;

  if (envelope && CODEX_JSONL_TRANSPARENT_ENVELOPES.has(envelope)) {
    return null;
  }
  return stringOrNull(item.type ?? item.payload?.type)?.toLowerCase() ?? null;
}

function codexJsonlHasUnextractedContentfulPayload(item: any): boolean {
  const payload = codexJsonlInnerPayload(item);
  const contentfulStrings = collectCodexJsonlContentfulStrings(payload);
  if (contentfulStrings.length === 0) return false;

  const normalized = normalizeCodexJsonlItem(item);
  const extractedStrings = collectCodexJsonlExtractedStrings(normalized);
  return contentfulStrings.some((value) => {
    const normalizedValue = normalizeComparableCodexText(value);
    return normalizedValue.length > 0 && !extractedStrings.some((extracted) => extracted.includes(normalizedValue));
  });
}

function codexJsonlInnerPayload(item: any): unknown {
  if (isObjectRecord(item.event_msg)) return item.event_msg;
  if (isObjectRecord(item.response_item)) return item.response_item;
  if (isObjectRecord(item.item?.payload)) return item.item.payload;
  if (isObjectRecord(item.item)) return item.item;
  if (isObjectRecord(item.payload)) return item.payload;
  return item;
}

function collectCodexJsonlExtractedStrings(item: any): string[] {
  const values = [
    item.event_msg?.name,
    item.thread_name,
    item.payload?.title,
    ...extractTextPayloads(item)
  ];
  return values
    .filter((value): value is string => typeof value === "string")
    .map(normalizeComparableCodexText)
    .filter(Boolean);
}

// Depth/node budgets keep pathological or hostile JSONL payloads from blowing the stack; real
// Codex records nest a handful of levels, so hitting a budget just means "treat as non-contentful".
const CODEX_JSONL_CONTENTFUL_MAX_DEPTH = 8;
const CODEX_JSONL_CONTENTFUL_MAX_NODES = 400;

function collectCodexJsonlContentfulStrings(value: unknown, keyHint = "", contentAncestor = false, depth = 0, budget = { nodes: CODEX_JSONL_CONTENTFUL_MAX_NODES }): string[] {
  const out: string[] = [];
  if (depth > CODEX_JSONL_CONTENTFUL_MAX_DEPTH || budget.nodes <= 0) return out;
  budget.nodes -= 1;
  const contentLike = contentAncestor || codexJsonlContentFieldName(keyHint);
  if (typeof value === "string") {
    if (contentLike && value.trim()) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) out.push(...collectCodexJsonlContentfulStrings(item, keyHint, contentLike, depth + 1, budget));
    return out;
  }
  if (!isObjectRecord(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    out.push(...collectCodexJsonlContentfulStrings(child, key, contentLike || codexJsonlContentFieldName(key), depth + 1, budget));
  }
  return out;
}

function codexJsonlContentFieldName(value: string): boolean {
  return /(?:^|[_-])(content|message|name|summary|text|title)(?:$|[_-])/i.test(value);
}

function normalizeComparableCodexText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function codexJsonlDriftReport(sourcePath: string, drift: CodexJsonlDriftAccumulator): CodexJsonlDriftReport | null {
  if (drift.unparsedLines === 0 && drift.unknownEventKinds.size === 0 && drift.missingExpectedFields.size === 0) return null;
  const unknownEventKinds = [...drift.unknownEventKinds.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 12)
    .map(([kind, count]) => ({ kind, count }));
  const missingExpectedFields = [...drift.missingExpectedFields.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, count]) => ({ field, count }));
  const reasonCodes = [
    ...missingExpectedFields.map((item) => `missing_field:${item.field}`),
    ...unknownEventKinds.map((item) => `unknown_event_kind:${item.kind}`),
    drift.unparsedLines > 0 ? "unparsed_line" : ""
  ].filter(Boolean);
  return {
    path: sourcePath,
    unknownEventKinds,
    unparsedLines: drift.unparsedLines,
    missingExpectedFields,
    reasonCodes
  };
}

function extractCodexToolCalls(item: any, sourcePath: string, ordinal: number): CodexToolCallDraft[] {
  const candidates: unknown[] = [];
  const responseItem = item.response_item ?? item.item ?? item.payload ?? null;
  for (const container of [item, responseItem]) {
    if (!container) continue;
    const record = isObjectRecord(container) ? container : null;
    if (!record) continue;
    if (isDirectCodexToolCall(record)) candidates.push(record);
    candidates.push(...toolCallArray(record.tool_calls));
    candidates.push(...toolCallArray(record.toolCalls));
    candidates.push(...toolCallArray(record.calls));
  }
  return candidates.map((candidate, index) => codexToolCallFromCandidate(candidate, sourcePath, ordinal, index));
}

function toolCallArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isDirectCodexToolCall(record: Record<string, unknown>): boolean {
  const type = stringOrNull(record.type)?.toLowerCase() ?? "";
  return type === "function_call"
    || type === "tool_call"
    || type === "tool_use"
    || typeof record.call_id === "string"
    || typeof record.tool_name === "string"
    || typeof record.toolName === "string"
    || typeof record.name === "string" && (record.arguments !== undefined || record.input !== undefined || record.args !== undefined);
}

function codexToolCallFromCandidate(candidate: unknown, sourcePath: string, ordinal: number, index: number): CodexToolCallDraft {
  const record = isObjectRecord(candidate) ? candidate : {};
  const functionRecord = isObjectRecord(record.function) ? record.function : {};
  const toolRecord = isObjectRecord(record.tool) ? record.tool : {};
  const rawName = stringOrNull(record.name)
    ?? stringOrNull(record.tool_name)
    ?? stringOrNull(record.toolName)
    ?? stringOrNull(record.recipient_name)
    ?? stringOrNull(functionRecord.name)
    ?? stringOrNull(toolRecord.name);
  const toolName = rawName ? publicSafeToolName(rawName) : "unknown";
  const rawArgumentsValue = firstDefined(
    functionRecord.arguments,
    functionRecord.input,
    record.arguments,
    record.input,
    record.args,
    record.params,
    toolRecord.arguments,
    toolRecord.input
  );
  const rawArgumentsText = rawArgumentsValue === undefined ? "" : stringifyMaybe(rawArgumentsValue);
  const reasonCode = rawName
    ? null
    : rawArgumentsText
      ? "missing_tool_name_source"
      : "unsupported_legacy_shape";
  const rawCallId = stringOrNull(record.call_id)
    ?? stringOrNull(record.callId)
    ?? stringOrNull(record.id)
    ?? stringOrNull(functionRecord.id);
  const callId = publicSafeIdentifier(rawCallId ?? "") ?? stableId(`${sourcePath}:${ordinal}:${index}:${toolName}:${rawArgumentsText}`);
  return {
    callId,
    toolName,
    argumentsText: publicSafeToolArguments(rawArgumentsText, 2000),
    rawArgumentsText,
    reasonCode
  };
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined);
}

function publicSafeToolName(value: string): string {
  const identifier = publicSafeIdentifier(value);
  if (identifier) return identifier;
  return publicSafeText(value.replace(/[^A-Za-z0-9._:-]+/g, "_"), 120) || "unknown";
}

function jsonlLineRecords(text: string, lineNumberOffset = 0, byteOffset = 0): JsonlLineRecord[] {
  const records: JsonlLineRecord[] = [];
  let cursor = 0;
  let byteCursor = byteOffset;
  let lineNumber = lineNumberOffset + 1;
  while (cursor < text.length) {
    const newlineIndex = text.indexOf("\n", cursor);
    const lineEnd = newlineIndex === -1 ? text.length : newlineIndex;
    const lineText = text.slice(cursor, lineEnd);
    const rawLine = lineText.replace(/\r$/, "");
    const byteStart = byteCursor;
    const byteEnd = byteStart + Buffer.byteLength(rawLine);
    if (rawLine.trim()) {
      records.push({
        lineNumber,
        text: rawLine,
        byteStart,
        byteEnd
      });
    }
    if (newlineIndex === -1) break;
    byteCursor += Buffer.byteLength(text.slice(cursor, newlineIndex + 1));
    cursor = newlineIndex + 1;
    lineNumber += 1;
  }
  return records;
}

function createPreparedSourceEventDraft(input: {
  record: JsonlLineRecord;
  item: any;
  ordinal: number;
  sourceHash: string;
  sourcePathRef: string;
  threadId: string;
  observedAt: string | null;
  rangeKinds: PreparedSourceRangeKind[];
  eventText: string;
}): PreparedSourceEventDraft {
  const contentHash = stableId(input.record.text);
  const eventKind = preparedEventKind(input.item, input.rangeKinds);
  const eventId = stableId(`${input.sourcePathRef}:${input.sourceHash}:${input.ordinal}:${input.record.lineNumber}:${eventKind}:${contentHash}`);
  const eventRef = `codex_event:${eventId}`;
  const uniqueKinds = [...new Set(input.rangeKinds)];
  const eventText = redactEventContentText(input.eventText || eventKind);
  return {
    eventRef,
    eventKind,
    sourcePathRef: input.sourcePathRef,
    sourceHash: input.sourceHash,
    contentHash,
    eventText,
    eventTextHash: stableId(eventText),
    storedChars: eventText.length,
    truncated: input.eventText.length > eventText.length,
    lineStart: input.record.lineNumber,
    lineEnd: input.record.lineNumber,
    byteStart: input.record.byteStart,
    byteEnd: input.record.byteEnd,
    ordinal: input.ordinal,
    observedAt: input.observedAt,
    ranges: uniqueKinds.map((rangeKind, rangeOrdinal) => {
      const rangeId = stableId(`${eventRef}:${rangeKind}`);
      return {
        rangeRef: `codex_range:${rangeId}`,
        rangeKind: rangeKind as PreparedSourceRangeKind,
        contentHash: stableId(`${contentHash}:${rangeKind}`),
        ordinal: input.ordinal * 100 + rangeOrdinal,
        reasonCodes: preparedRangeReasonCodes(rangeKind)
      };
    })
  };
}

function eventContentTextForRecord(parts: string[], item: any, timestamp: string | null): string {
  const eventKind = codexJsonlEventKind(item) ?? "event_metadata";
  const text = unique([
    eventKind,
    timestamp ? `timestamp ${timestamp}` : "",
    ...parts
  ].map((part) => normalizeText(part)).filter(Boolean)).join("\n");
  return text || eventKind;
}

function redactEventContentText(value: string): string {
  return publicSafeText(redactHookStringUnbounded(normalizeText(value)), CODEX_EVENT_CONTENT_CHAR_LIMIT);
}

function preparedEventKind(item: any, rangeKinds: PreparedSourceRangeKind[]): string {
  const eventType = codexJsonlEventKind(item);
  if (eventType && /^[A-Za-z0-9_.:-]{1,64}$/.test(eventType)) return eventType;
  return rangeKinds[0] ?? "event_metadata";
}

function textRangeKind(item: any): PreparedSourceRangeKind {
  const role = stringOrNull(item.response_item?.role ?? item.message?.role ?? item.event_msg?.role ?? item.payload?.role)?.toLowerCase();
  const eventType = codexJsonlEventKind(item);
  if (role === "user" || eventType?.includes("user")) return "user_prompt";
  if (role === "assistant" || eventType?.includes("agent") || eventType?.includes("assistant")) return "assistant_message";
  return "event_metadata";
}

function containsCloseoutEnvelope(text: string): boolean {
  return /<loo_closeout>|closeout state\s*:/i.test(text);
}

function preparedRangeReasonCodes(rangeKind: PreparedSourceRangeKind): string[] {
  return unique([
    "prepared_source_range",
    "metadata_only",
    `range_kind:${rangeKind}`
  ]);
}

function preparedRangeConfidence(rangeKind: PreparedSourceRangeKind): number {
  if (rangeKind === "event_metadata") return 0.4;
  if (rangeKind === "tool_call_metadata") return 0.45;
  if (rangeKind === "closeout" || rangeKind === "final_message" || rangeKind === "proposed_plan") return 0.95;
  return 0.9;
}

function preparedEventConfidence(event: PreparedSourceEventDraft): number {
  // Event confidence is the floor of its child range confidences; public reports expose per-range confidence.
  const confidences = event.ranges.map((range) => preparedRangeConfidence(range.rangeKind));
  return confidences.length > 0 ? Math.min(...confidences) : 0.4;
}

function fallbackThreadId(sourcePath: string): string {
  const name = basename(sourcePath).replace(/\.jsonl$/i, "");
  const uuidLike = name.match(/(019[0-9a-f]{5,}(?:-[0-9a-f]{4,}){2,})/i)?.[1];
  if (uuidLike) return uuidLike;
  const rolloutSuffix = name.match(/^rollout-.+?-([0-9a-f][0-9a-f-]{16,})$/i)?.[1];
  return rolloutSuffix ?? stableId(sourcePath);
}

function upsertSession(
  db: LooDatabase,
  sourcePath: string,
  rawText: string,
  session: ImportedSession,
  stat: { size: number; mtimeMs: number },
  options: { sourceRef?: string; rangeReasonCodes?: string[]; eventContentEnabled?: boolean; monotonicAppend?: boolean } = {}
): void {
  const sourceHash = stableId(rawText);
  const sourcePathRef = publicSourcePathRef(sourcePath);
  const preparedSourceRef = options.sourceRef ?? codexThreadRef(session.threadId);
  const rangeReasonCodes = unique(options.rangeReasonCodes ?? []);
  const writeEventContent = options.eventContentEnabled ?? true;
  const driftReport = session.driftReport;
  const driftUnknownEventKindsJson = JSON.stringify(driftReport?.unknownEventKinds ?? []);
  const driftUnparsedLines = driftReport?.unparsedLines ?? 0;
  const driftMissingExpectedFieldsJson = JSON.stringify(driftReport?.missingExpectedFields ?? []);
  const driftReasonCodesJson = JSON.stringify(driftReport?.reasonCodes ?? []);
  const previousSource = db.prepare(`
    SELECT
      path_hash AS pathHash,
      content_epoch AS contentEpoch,
      append_generation AS appendGeneration
    FROM codex_source_files
    WHERE source_path = ?
  `).get(sourcePath) as { pathHash?: unknown; contentEpoch?: unknown; appendGeneration?: unknown } | undefined;
  const monotonicAppend = Boolean(options.monotonicAppend && previousSource);
  const contentEpoch = monotonicAppend
    ? String(previousSource?.contentEpoch ?? previousSource?.pathHash ?? sourceHash)
    : sourceHash;
  const appendGeneration = monotonicAppend
    ? boundedNonNegativeInteger(previousSource?.appendGeneration, Number.MAX_SAFE_INTEGER - 1) + 1
    : 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    const now = allocateSessionDiffMutationTimestamp(db);
    if (previousSource && String(previousSource.pathHash ?? "") !== sourceHash && !monotonicAppend) {
      bumpCodexSourceDestructiveGeneration(db);
    }
    db.prepare(`
      INSERT INTO codex_source_files (
        source_path,
        path_hash,
        content_epoch,
        append_generation,
        size,
        mtime_ms,
        last_indexed_at,
        metadata_extractor_version,
        prepared_range_extractor_version,
        summary_leaf_extractor_version,
        prepared_card_extractor_version,
        jsonl_drift_unknown_event_kinds_json,
        jsonl_drift_unparsed_lines,
        jsonl_drift_missing_expected_fields_json,
        jsonl_drift_reason_codes_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
      ON CONFLICT(source_path) DO UPDATE SET
        path_hash = excluded.path_hash,
        content_epoch = excluded.content_epoch,
        append_generation = excluded.append_generation,
        size = excluded.size,
        mtime_ms = excluded.mtime_ms,
        last_indexed_at = excluded.last_indexed_at,
        metadata_extractor_version = excluded.metadata_extractor_version,
        prepared_range_extractor_version = excluded.prepared_range_extractor_version,
        summary_leaf_extractor_version = NULL,
        prepared_card_extractor_version = NULL,
        jsonl_drift_unknown_event_kinds_json = excluded.jsonl_drift_unknown_event_kinds_json,
        jsonl_drift_unparsed_lines = excluded.jsonl_drift_unparsed_lines,
        jsonl_drift_missing_expected_fields_json = excluded.jsonl_drift_missing_expected_fields_json,
        jsonl_drift_reason_codes_json = excluded.jsonl_drift_reason_codes_json
    `).run(
      sourcePath,
      sourceHash,
      contentEpoch,
      appendGeneration,
      stat.size,
      stat.mtimeMs,
      now,
      SESSION_METADATA_EXTRACTOR_VERSION,
      PREPARED_SOURCE_EXTRACTOR_VERSION,
      driftUnknownEventKindsJson,
      driftUnparsedLines,
      driftMissingExpectedFieldsJson,
      driftReasonCodesJson
    );
    db.prepare("DELETE FROM codex_index_limited_files WHERE source_path = ?").run(sourcePath);
    clearRemappedSourcePathSessions(db, sourcePath, session.threadId);
    const oldSessionRowid = codexSessionRowid(db, session.threadId);
    if (oldSessionRowid !== null) {
      deleteCodexSafeTextFtsForSessionRowid(db, oldSessionRowid);
      deleteCodexSearchFtsForSessionRowid(db, oldSessionRowid);
    }
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
    const newSessionRowid = requireCodexSessionRowid(db, session.threadId);
    db.prepare("DELETE FROM codex_plans WHERE thread_id = ?").run(session.threadId);
    db.prepare("DELETE FROM codex_touched_files WHERE thread_id = ?").run(session.threadId);
    db.prepare("DELETE FROM codex_tool_calls WHERE thread_id = ?").run(session.threadId);
    // Prepared rows are an LCO-owned derived cache for the current codex_sessions row.
    // Clear both remap directions: same source -> new thread and same thread -> new source.
    const affectedSummaryRows = db.prepare(`
      SELECT DISTINCT thread_id AS threadId
      FROM prepared_source_ranges
      WHERE source_path_ref = ? OR thread_id = ?
    `).all(sourcePathRef, session.threadId) as Array<{ threadId: string }>;
    deleteSummaryLeavesForThreadIds(db, [...affectedSummaryRows.map((row) => String(row.threadId)), session.threadId]);
    deleteCodexEventContentForSourceOrThread(db, sourcePathRef, session.threadId);
    db.prepare("DELETE FROM prepared_source_ranges WHERE source_path_ref = ? OR thread_id = ?").run(sourcePathRef, session.threadId);
    db.prepare("DELETE FROM prepared_source_events WHERE source_path_ref = ? OR thread_id = ?").run(sourcePathRef, session.threadId);
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
      db.prepare("INSERT OR REPLACE INTO codex_tool_calls (call_id, thread_id, tool_name, arguments_text, reason_code) VALUES (?, ?, ?, ?, ?)").run(call.callId, session.threadId, call.toolName, call.argumentsText, call.reasonCode);
    });
    const insertPreparedEvent = db.prepare(`
      INSERT INTO prepared_source_events (
        event_id, event_ref, thread_id, source_ref, source_path_ref, source_hash, content_hash,
        event_kind, line_start, line_end, byte_start, byte_end, ordinal, observed_at,
        extractor_version, privacy_class, omission_status, confidence, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPreparedRange = db.prepare(`
      INSERT INTO prepared_source_ranges (
        range_id, range_ref, event_id, event_ref, thread_id, source_ref, source_path_ref, source_hash,
        content_hash, session_diff_key, range_kind, line_start, line_end, byte_start, byte_end, ordinal, observed_at,
        extractor_version, privacy_class, omission_status, confidence, reason_codes_json, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const event of session.sourceEvents) {
      const eventId = event.eventRef.slice("codex_event:".length);
      insertPreparedEvent.run(
        eventId,
        event.eventRef,
        session.threadId,
        preparedSourceRef,
        event.sourcePathRef,
        event.sourceHash,
        event.contentHash,
        event.eventKind,
        event.lineStart,
        event.lineEnd,
        event.byteStart,
        event.byteEnd,
        event.ordinal,
        event.observedAt,
        PREPARED_SOURCE_EXTRACTOR_VERSION,
        "public_safe_metadata",
        "metadata_only",
        preparedEventConfidence(event),
        JSON.stringify({ rangeCount: event.ranges.length }),
        now
      );
      if (writeEventContent) {
        upsertCodexEventContentForDraft(db, {
          event,
          eventId,
          threadId: session.threadId,
          sourceRef: preparedSourceRef,
          sourcePathRef: event.sourcePathRef,
          sourceHash: event.sourceHash,
          privacyClass: "public_safe_metadata",
          now
        });
      }
      for (const range of event.ranges) {
        insertPreparedRange.run(
          range.rangeRef.slice("codex_range:".length),
          range.rangeRef,
          eventId,
          event.eventRef,
          session.threadId,
          preparedSourceRef,
          event.sourcePathRef,
          event.sourceHash,
          range.contentHash,
          sessionDiffSourceRangeCursorKey(event.sourcePathRef, range.ordinal, range.rangeKind, range.contentHash),
          range.rangeKind,
          event.lineStart,
          event.lineEnd,
          event.byteStart,
          event.byteEnd,
          range.ordinal,
          event.observedAt,
          PREPARED_SOURCE_EXTRACTOR_VERSION,
          "public_safe_metadata",
          "metadata_only",
          preparedRangeConfidence(range.rangeKind),
          JSON.stringify(unique([...range.reasonCodes, ...rangeReasonCodes])),
          JSON.stringify({ eventKind: event.eventKind }),
          now
        );
      }
    }
    insertCodexSafeTextFtsForSessionRowid(db, newSessionRowid, session.threadId, session.safeText);
    insertCodexSearchFtsForThreadRowid(db, session.threadId, newSessionRowid);
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
    item.response_item?.output,
    item.message?.content,
    item.payload?.message,
    item.payload?.text,
    item.payload?.output
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
  if (typeof value === "string") return safeIsoTimestamp(value);
  if (typeof value === "number") return safeNumericTimestamp(value);
  return null;
}

function safeNumericTimestamp(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const timestamp = value > 10_000_000_000 ? value : value * 1000;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeIsoTimestamp(value: string): string | null {
  const trimmed = value.trim();
  if (!isSafeIsoTimestamp(trimmed)) return null;
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function isSafeIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$/.test(value) && Number.isFinite(Date.parse(value));
}

function nativeCodexSubagentResultRef(resultId: string): string {
  return `codex_subagent_result:${resultId}`;
}

function safeNativeCodexSubagentResultId(value: string): string {
  const trimmed = value.trim();
  const redacted = publicSafeText(trimmed, 120).trim();
  if (trimmed && redacted === trimmed && !looksSensitiveRefLike(trimmed) && /^[A-Za-z0-9._:-]{1,96}$/.test(trimmed)) return trimmed;
  return `native_${stableId(trimmed).slice(0, 16)}`;
}

function nativeCodexSubagentResultSyntheticJsonl(
  fixture: NativeCodexSubagentResultFixture,
  options: { resultId: string; threadId: string; sourceRef: string; now: string }
): string {
  const observedAt = publicIsoTimestamp(fixture.observedAt ?? null) ?? options.now;
  const title = safeNullableFixtureString(fixture.title) ?? "Native Codex subagent result";
  const summary = safeNullableFixtureString(fixture.summary);
  const finalReport = safeNullableFixtureString(fixture.finalReport);
  const touchedFiles = publicSafeRelativePaths(fixture.touchedFiles);
  const blockers = publicSafeStringList(fixture.blockers, 120);
  const provenance = publicNativeCodexSubagentProvenance(fixture.provenance);
  const metadataLines = [
    `Native Codex subagent result: ${options.sourceRef}`,
    `Result id: ${options.resultId}`,
    provenance.length ? `Provenance: ${provenance.join(", ")}` : null,
    touchedFiles.length ? `Touched files: ${touchedFiles.join(", ")}` : null,
    blockers.length ? `Blockers: ${blockers.join(", ")}` : null
  ].filter(Boolean).join("\n");
  const finalText = finalReport ?? summary ?? "Final: Native Codex subagent result recorded as advisory prepared source metadata.";
  const lines = [
    {
      timestamp: observedAt,
      session_meta: {
        payload: {
          id: options.threadId,
          model: "native-codex-subagent-result",
          cwd: "native_codex_subagent_result"
        }
      }
    },
    { timestamp: observedAt, event_msg: { type: "thread_name", name: title } },
    { timestamp: observedAt, event_msg: { type: "native_subagent_result_metadata", message: metadataLines } },
    { timestamp: observedAt, event_msg: { type: "agent_message", role: "assistant", message: finalText } }
  ];
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

function publicNativeCodexSubagentProvenance(value: unknown): string[] {
  if (!isObjectRecord(value)) return [];
  const out: string[] = [];
  const issue = boundedNonNegativeInteger(value.issue, 1_000_000);
  const pr = boundedNonNegativeInteger(value.pr, 1_000_000);
  const branch = safeNullableFixtureString(value.branch);
  if (issue > 0) out.push(`issue:${issue}`);
  if (pr > 0) out.push(`pr:${pr}`);
  if (branch && isPublicSafeBranchRef(branch)) out.push(`branch:${publicSafeText(branch, 160)}`);
  return out.slice(0, 12);
}

function isPublicSafeBranchRef(value: string): boolean {
  return /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]{1,160}$/.test(value)
    && !value.includes("..")
    && !/^(?:Users|Volumes|private|tmp|var|home|root)(?:\/|$)/i.test(value)
    && !/(?:^|\/)\.(?:codex|ssh|aws|config)(?:\/|$)/i.test(value)
    && !/(?:npm_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|PRIVATE_CANARY)/i.test(value);
}

function publicSafeRelativePaths(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return unique(values.flatMap((value) => {
    const raw = stringOrNull(value);
    if (!raw || looksSensitiveRefLike(raw)) return [];
    const safe = publicSafeText(raw, 180);
    return /^(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+$/.test(safe) ? [safe] : [];
  })).slice(0, 40);
}

function publicSafeStringList(values: unknown, maxChars: number): string[] {
  if (!Array.isArray(values)) return [];
  return unique(values.flatMap((value) => {
    const raw = stringOrNull(value);
    if (!raw) return [];
    const safe = publicSafeText(raw, maxChars).trim();
    return safe && !looksSensitiveRefLike(safe) ? [safe] : [];
  })).slice(0, 20);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function redactSafeString(value: string): string {
  let redacted = value.replace(/\/Users\/[^/\s"'`)]+/g, "~");
  redacted = redacted.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<redacted-secret>");
  redacted = redacted.replace(/\bnpm_[A-Za-z0-9]{10,}\b/g, "<redacted-secret>");
  redacted = redacted.replace(/\bgithub_pat_[A-Za-z0-9_]{10,}\b/g, "<redacted-secret>");
  redacted = redacted.replace(/\bgh[pousr]_[A-Za-z0-9_]{10,}\b/g, "<redacted-secret>");
  redacted = redacted.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "<redacted-secret>");
  redacted = redacted.replace(/sk-[A-Za-z0-9_-]{10,}/g, "<redacted-secret>");
  redacted = redacted.replace(/PRIVATE_CANARY[A-Za-z0-9_:-]*/g, "<redacted-secret>");
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

function nullablePublicSafeString(value: unknown, maxChars: number): string | null {
  return typeof value === "string" && value.length > 0 ? publicSafeText(value, maxChars) : null;
}

function nullablePublicSafeSearchString(value: unknown, maxChars: number): string | null {
  return typeof value === "string" && value.length > 0 ? publicSafeSearchText(value, maxChars) : null;
}

function toolCallReasonCode(value: unknown): CodexToolCall["reasonCode"] {
  return value === "missing_tool_name_source" || value === "unsupported_legacy_shape" ? value : null;
}

function safeNullableFixtureString(value: unknown): string | null {
  const raw = stringOrNull(value);
  return raw ? redactSafeString(publicSafeText(raw, 900)).trim() || null : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
