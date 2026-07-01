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
  sourceKind: "github_check_summary" | "safe_event" | "desktop_title" | "watcher_log" | "plan" | "final_message" | "session_metadata" | "github" | "plan_state";
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

export type SourceCoverageState = "ok" | "partial" | "not_configured" | "unavailable";

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
};

export type GithubOperatingItem = {
  id: string;
  title: string;
  state?: OperatingState;
  urgency?: OperatingUrgency;
  reasonCodes?: string[];
  updatedAt?: string | null;
  nextAction?: string;
};

export type OperatingDigestOptions = {
  window?: OperatingDigest["window"];
  limit?: number;
  planStatePins?: PlanStatePinsReport;
  githubItems?: GithubOperatingItem[];
};

export type BusinessPulseReport = {
  schema: "lco.businessPulse.v1";
  publicSafe: true;
  question: "How is the business?";
  digest: OperatingDigest;
  sourceCoverage: OperatingDigest["sourceCoverage"];
  proofBoundary: string;
};

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
} = {}): RecentSessionsReport {
  const scope = options.scope ?? "recent";
  const limit = clamp(options.limit ?? 20, 1, 500);
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
  let cards = entries.map((entry) => codexSessionCard(db, entry));
  if (options.touchedPath) {
    const needle = options.touchedPath.toLowerCase();
    cards = cards.filter((card) => touchedPathMatches(db, card.threadId, needle));
  }
  if (options.risk) cards = cards.filter((card) => card.risk.level === options.risk);
  cards.sort(codexSessionCardComparator);
  const total = cards.length;
  cards = cards.slice(0, limit);

  return {
    schema: "lco.codex.recentSessions.v1",
    publicSafe: true,
    queryRequired: false,
    scope,
    generatedAt: new Date().toISOString(),
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

export function getCockpitInbox(db: LooDatabase, options: { limit?: number; priorityOrder?: string[] } = {}): CockpitInboxReport {
  const limit = clamp(options.limit ?? 20, 1, 500);
  const cards = getRecentSessions(db, {
    scope: "active",
    limit: 500,
    includeCards: true
  }).cards;
  const items = cards
    .map((card) => ({
      card,
      reasonCodes: cockpitReasonCodes(card),
      urgencyScore: cockpitUrgencyScore(card, options.priorityOrder),
      nextAction: card.nextAction
    }))
    .filter((item) => item.reasonCodes.length > 0)
    .sort((left, right) => right.urgencyScore - left.urgencyScore || compareUpdatedAtDesc(left.card.freshness.lastEventAt, right.card.freshness.lastEventAt) || left.card.threadId.localeCompare(right.card.threadId));
  const selected = items.slice(0, limit);
  return {
    schema: "lco.codex.cockpitInbox.v1",
    publicSafe: true,
    generatedAt: new Date().toISOString(),
    summary: {
      totalCards: cards.length,
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

export function createProjectDigest(db: LooDatabase, options: OperatingDigestOptions = {}): OperatingDigest {
  const limit = clamp(options.limit ?? 20, 1, 200);
  const codexSignals = getRecentSessions(db, { scope: "recent", limit: 200, includeCards: true }).cards.map(signalFromSessionCard);
  const githubSignals = (options.githubItems ?? []).slice(0, 100).map(signalFromGithubItem);
  const planSignals = (options.planStatePins?.manualPins ?? []).map(signalFromPlanPin);
  const signals = [...codexSignals, ...githubSignals, ...planSignals];
  const signalById = new Map(signals.map((signal) => [signal.signalId, signal]));
  const cards = signals.map(operatingCardFromSignal).sort(operatingCardComparator);
  const selected = cards.slice(0, limit);
  const selectedSignalIds = new Set(selected.flatMap((card) => card.signals));
  const selectedSignals = signals.filter((signal) => selectedSignalIds.has(signal.signalId));
  const evidence = selected.flatMap((card) => evidenceCardsForOperatingCard(card, signalById.get(card.signals[0] ?? "")));
  const sourceCoverage = {
    lco: codexSignals.length > 0 ? "ok" as const : "partial" as const,
    github: githubSignals.length > 0 ? "ok" as const : "not_configured" as const,
    plan_state: planSignals.length > 0 ? "ok" as const : "not_configured" as const,
    notion: "not_configured" as const,
    support_control: "not_configured" as const,
    company_brain: "not_configured" as const,
    stripe: "not_configured" as const
  };
  return {
    schema: "lco.operatingDigest.v1",
    publicSafe: true,
    generatedAt: new Date().toISOString(),
    window: options.window ?? "today",
    health: operatingHealth(selected),
    topAttention: selected.filter((card) => card.state === "red" || card.state === "yellow" || card.state === "unknown").slice(0, 5).map((card) => card.cardId),
    cards: selected,
    signals: selectedSignals,
    evidence,
    omitted: {
      count: Math.max(0, cards.length - selected.length),
      reason: cards.length > selected.length ? "limit" : "none"
    },
    sourceCoverage
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

function codexSessionCard(db: LooDatabase, entry: CodexThreadMapEntry): CodexSessionCard {
  const counts = codexSessionCardCounts(db, entry.threadId, entry.metadata);
  const state = codexSessionCardState(entry);
  const reasonCodes = codexSessionReasonCodes(entry, state, counts);
  const confidence = codexSessionConfidence(entry, reasonCodes);
  const risk = codexSessionRisk(entry, reasonCodes, confidence);
  const evidenceIds = [`ev_${stableId(`${entry.threadId}:session_metadata`).slice(0, 16)}`];
  const objective = publicSafeText(entry.metadata.nextAction || entry.summary || entry.title || "No objective extracted.");
  return {
    schema: "lco.codex.sessionCard.v1",
    sessionId: `sess_${stableId(entry.threadId).slice(0, 16)}`,
    threadId: codexThreadRef(entry.threadId),
    title: publicSafeText(entry.title || entry.threadId, 160),
    state,
    objective: publicSafeText(objective, 260),
    freshness: sessionFreshness(entry.updatedAt),
    scope: {
      repo: publicSafeText(entry.metadata.project || "lossless-openclaw-orchestrator", 120),
      branch: null,
      gitSha: null,
      refs: unique([...entry.metadata.sourceRefs, codexThreadRef(entry.threadId)]).map((ref) => publicSafeText(ref, 180)).slice(0, 8)
    },
    risk,
    nextAction: codexSessionNextAction(entry, state, confidence),
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

function codexSessionReasonCodes(entry: CodexThreadMapEntry, state: CodexSessionCardState, counts: CodexSessionCard["counts"]): string[] {
  const codes: string[] = [];
  const status = normalizedMetadataValue(entry.metadata.status);
  if (state === "blocked") codes.push("blocked");
  if (state === "needs_approval") codes.push("approval_needed");
  if (state === "waiting") codes.push("external_wait");
  if (state === "unknown") codes.push("low_confidence");
  if (hasRealBlocker(entry.metadata.blocker) && ["complete", "completed", "done", "closed", "merged"].includes(status)) codes.push("conflicting_state");
  if (counts.evidence < 3) codes.push("missing_evidence");
  if (sessionFreshness(entry.updatedAt).stale) codes.push("active_stale");
  if (normalizedMetadataValue(entry.metadata.nextAction).includes("resume")) codes.push("resume_ready");
  return unique(codes);
}

function codexSessionConfidence(entry: CodexThreadMapEntry, reasonCodes: string[]): number {
  let confidence = 0.92;
  if (!entry.updatedAt) confidence -= 0.1;
  if (!entry.metadata.status) confidence -= 0.12;
  if (!entry.metadata.nextAction) confidence -= 0.08;
  if (!hasEvidenceRefs(entry.metadata)) confidence -= 0.28;
  if (reasonCodes.includes("conflicting_state")) confidence -= 0.36;
  if (reasonCodes.includes("active_stale")) confidence -= 0.08;
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

function codexSessionNextAction(entry: CodexThreadMapEntry, state: CodexSessionCardState, confidence: number): CodexSessionCard["nextAction"] {
  const next = normalizedMetadataValue(entry.metadata.nextAction);
  const kind: CodexSessionCard["nextAction"]["kind"] = state === "needs_approval"
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
    reason: publicSafeText(entry.metadata.nextAction || entry.metadata.blocker || state, 220)
  };
}

function sessionFreshness(updatedAt: string | null): CodexSessionCard["freshness"] {
  const updatedMs = timestampMillis(updatedAt);
  const ageSeconds = updatedMs === null ? null : Math.max(0, Math.round((Date.now() - updatedMs) / 1000));
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

function cockpitReasonCodes(card: CodexSessionCard): string[] {
  const actionable = card.reasonCodes.filter((code) => [
    "blocked",
    "approval_needed",
    "low_confidence",
    "active_stale",
    "resume_ready",
    "external_wait",
    "conflicting_state"
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
    resume_ready: 30,
    external_wait: 25,
    missing_evidence: 10
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
  const state: OperatingState = card.state === "blocked" ? "red" : card.state === "unknown" || card.state === "needs_approval" || card.state === "waiting" ? "yellow" : card.state === "done" ? "green" : "green";
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
  return {
    schema: "lco.operatingSignal.v1",
    signalId: `sig_${stableId(sourceRef).slice(0, 16)}`,
    sourceKind: "github",
    sourceRef,
    observedAt: item.updatedAt ?? null,
    subject: {
      kind: item.id.includes("#") ? "issue" : "repo",
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
    confidence: 0.86,
    evidenceIds: [`ev_${stableId(`${sourceRef}:github`).slice(0, 16)}`]
  };
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

function operatingCardFromSignal(signal: OperatingSignal): OperatingCard {
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
    state: signal.reasonCodes.includes("conflicting_state") ? "unknown" : signal.state,
    lastMovementAt: signal.observedAt,
    summary: publicSafeText(signal.summary, 320),
    nextAction: publicSafeText(signal.nextAction.text, 240),
    owner: "eva",
    confidence: signal.reasonCodes.includes("conflicting_state") ? Math.min(signal.confidence, 0.45) : signal.confidence,
    signals: [signal.signalId],
    evidenceIds: signal.evidenceIds,
    reasonCodes: signal.reasonCodes,
    approvalBoundary: signal.nextAction.requiresApproval
      ? "Approval required before resume, send, steer, interrupt, GUI action, external message, commit, push, deploy, or production/customer mutation."
      : "Read-only inspection only; no mutation is authorized by this card."
  };
}

function operatingCardComparator(left: OperatingCard, right: OperatingCard): number {
  const stateRank = { red: 0, yellow: 1, unknown: 2, green: 3 } as const;
  const leftRank = stateRank[left.state];
  const rightRank = stateRank[right.state];
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.confidence !== right.confidence) return left.confidence - right.confidence;
  const updatedAtCompare = compareUpdatedAtDesc(left.lastMovementAt, right.lastMovementAt);
  if (updatedAtCompare !== 0) return updatedAtCompare;
  return left.cardId.localeCompare(right.cardId);
}

function evidenceCardsForOperatingCard(card: OperatingCard, signal: OperatingSignal | undefined): EvidenceCard[] {
  return card.evidenceIds.map((evidenceId) => ({
    schema: "lco.evidenceCard.v1",
    evidenceId,
    claim: publicSafeText(`${card.title} is ${card.state}.`, 180),
    sourceKind: signal?.sourceKind === "github" ? "github" : signal?.sourceKind === "plan_state" ? "plan_state" : "session_metadata",
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
  const missingFields = closeoutEnvelopeMissingFields(metadata);
  const warnings: string[] = [];
  if (envelopeStats.openCount === 0 && sessionMetadataHasAnyValue(sessionMetadata)) warnings.push("closeout_envelope_missing");
  if (envelopeStats.openCount > 1) warnings.push("duplicate_closeout_envelopes");
  if (envelopeStats.openCount !== envelopeStats.closeCount) warnings.push("malformed_closeout_envelope");
  if (metadata.finalMessageRefs.length === 0) warnings.push("final_message_ref_missing");
  if (metadata.sourceRefs.length === 0) warnings.push("source_ref_missing");

  const hasCloseoutSignal = sessionMetadataHasAnyValue(sessionMetadata) || envelopeStats.openCount > 0 || envelopeStats.closeCount > 0;
  const malformed = warnings.includes("malformed_closeout_envelope");
  const duplicate = warnings.includes("duplicate_closeout_envelopes");
  const state: CloseoutEnvelopeState = envelopeText !== null && missingFields.length === 0 && !malformed && !duplicate
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
    .replace(/\/(?:private\/)?(?:tmp|var)\/[^\s"'`)]+/g, "<redacted-path>")
    .replace(/~\/\.codex\/[^\s"'`)]+/g, "<redacted-path>");
  return truncate(redacted, maxChars);
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
