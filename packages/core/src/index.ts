import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type LooDatabase = DatabaseSync;

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
};

export type CodexToolCall = {
  threadId: string;
  callId: string;
  toolName: string;
  argumentsText: string;
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

export type RecallSourceKind = "codex_thread" | "lcm_summary";

export type RecallSearchResult = {
  sourceKind: RecallSourceKind;
  sourceRef: string;
  title: string | null;
  summary: string | null;
  updatedAt: string | null;
  score: number;
  snippet: string;
  threadId?: string;
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
  summaryId?: string;
  conversationId?: number;
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
};

export type ExpandRecallResult = {
  sourceKind: RecallSourceKind;
  sourceRef: string;
  text: string;
  tokenBudget: number;
  profile: RecallProfile;
  threadId?: string;
  summaryId?: string;
  query?: string;
  matches?: RecallSearchResult[];
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
  safeText: string;
  eventCount: number;
};

const DEFAULT_CODEX_MAX_BYTES_PER_FILE = 50 * 1024 * 1024;
const DEFAULT_CODEX_MAX_EVENTS_PER_FILE = 50_000;

export function createDatabase(dbPath?: string): LooDatabase {
  const resolved = dbPath ?? defaultDatabasePath();
  mkdirSync(dirname(resolved), { recursive: true });
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

    CREATE VIRTUAL TABLE IF NOT EXISTS codex_safe_text_fts USING fts5(
      thread_id UNINDEXED,
      content,
      tokenize = 'unicode61'
    );
  `);
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
        recordLimitedFile(result, path, "max_bytes_per_file", maxBytesPerFile, stat.size);
        continue;
      }
      const watermark = getSourceFileWatermark(db, path);
      const mtimeMs = Math.trunc(stat.mtimeMs);
      const text = readFileSync(path, "utf8");
      const eventCount = countJsonlEvents(text);
      if (eventCount > maxEventsPerFile) {
        recordLimitedFile(result, path, "max_events_per_file", maxEventsPerFile, eventCount);
        continue;
      }
      if (watermark && watermark.size === stat.size && watermark.mtimeMs === mtimeMs) {
        if (watermark.pathHash === stableId(text)) {
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

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`${name} requires a positive integer`);
  return limit;
}

function recordLimitedFile(result: IndexCodexResult, path: string, reason: LimitedCodexFile["reason"], limit: number, actual: number): void {
  result.skippedFiles += 1;
  result.limitedFiles.push({ path, reason, limit, actual });
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
    sourcePath: String(row.sourcePath)
  };
}

export function getCodexThreadMap(db: LooDatabase, options: { limit?: number } = {}): Array<{
  threadId: string;
  title: string | null;
  summary: string | null;
  updatedAt: string | null;
  sourcePath: string;
}> {
  return (db.prepare(`
    SELECT thread_id AS threadId, title, summary, updated_at AS updatedAt, source_path AS sourcePath
    FROM codex_sessions
    ORDER BY COALESCE(updated_at, indexed_at) DESC
    LIMIT ?
  `).all(clamp(options.limit ?? 50, 1, 500)) as Array<Record<string, unknown>>).map((row) => ({
    threadId: String(row.threadId),
    title: nullableString(row.title),
    summary: nullableString(row.summary),
    updatedAt: nullableString(row.updatedAt),
    sourcePath: String(row.sourcePath)
  }));
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
  const lcmMatches = searchLcmPeers(options.lcmDbPaths ?? [], query, limit);
  const matches = [...codexMatches, ...lcmMatches].slice(0, limit).map((match, index) => ({ ...match, score: index + 1 }));
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
      toolCallCount: description.toolCallCount
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

function lcmSummaryRef(path: string, summaryId: string): string {
  return `lcm_summary:${lcmPeerHash(path)}:${encodeURIComponent(summaryId)}`;
}

function lcmPeerHash(path: string): string {
  return stableId(normalizePeerPath(path)).slice(0, 12);
}

function parseSourceRef(sourceRef: string): { kind: "codex_thread"; id: string } | { kind: "lcm_summary"; dbHash: string; id: string } {
  if (sourceRef.startsWith("codex_thread:")) {
    const id = sourceRef.slice("codex_thread:".length);
    if (!id) throw new Error("codex_thread source ref is missing thread id");
    return { kind: "codex_thread", id };
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

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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
