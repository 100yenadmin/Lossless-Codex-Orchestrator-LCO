import type {
  AppServerThreadsInput,
  LooDatabase,
  SessionSearchResult
} from "./index.js";

export type CodexSearchFtsField =
  | "title"
  | "summary"
  | "plans"
  | "finals"
  | "touched_files"
  | "tool_meta"
  | "body";

export type CodexSearchMatchFeatures = {
  bm25: number;
  sText: number;
  sRec: number;
  matchedFields: string[];
};

type CodexSearchRow = Record<string, unknown>;

type CodexFtsQueryPlan = {
  rawTerms: string[];
  terms: string[];
  truncated: boolean;
  andQuery: string;
  orQuery: string;
  prefixTerms: string[];
};

type RankedCodexFtsRow = {
  row: CodexSearchRow;
  bm25: number;
  sText: number;
  sRec: number;
  score: number;
  identifierScore: number;
  matchedFields: CodexSearchFtsField[];
};

export const CODEX_SEARCH_FTS_MIGRATION_ID = "2026-07-06-codex-search-fts";
export const CODEX_SEARCH_FTS_TERM_CAP = 32;
export const CODEX_SEARCH_FTS_FIELDS: CodexSearchFtsField[] = [
  "title",
  "summary",
  "plans",
  "finals",
  "touched_files",
  "tool_meta",
  "body"
];

export const CODEX_SEARCH_FTS_WEIGHTS = {
  thread_id: 0,
  title: 8.0,
  summary: 4.0,
  plans: 6.0,
  finals: 6.0,
  touched_files: 3.0,
  tool_meta: 2.0,
  body: 1.0
} as const;

const CODEX_SEARCH_BM25_WEIGHTS = [
  CODEX_SEARCH_FTS_WEIGHTS.thread_id,
  CODEX_SEARCH_FTS_WEIGHTS.title,
  CODEX_SEARCH_FTS_WEIGHTS.summary,
  CODEX_SEARCH_FTS_WEIGHTS.plans,
  CODEX_SEARCH_FTS_WEIGHTS.finals,
  CODEX_SEARCH_FTS_WEIGHTS.touched_files,
  CODEX_SEARCH_FTS_WEIGHTS.tool_meta,
  CODEX_SEARCH_FTS_WEIGHTS.body
].join(", ");

const MATCH_START = "[";
const MATCH_END = "]";
// Unicode private-use sentinels for FTS snippet() match markers. Using
// non-content code points avoids false match attribution when real snippet
// text already contains public brackets (e.g. "[TODO]"). Detection runs on the
// sentinels; rendered snippets translate them back to public brackets.
const SNIPPET_MATCH_START = "";
const SNIPPET_MATCH_END = "";

export function searchCodexSessions(db: LooDatabase, options: {
  query: string;
  limit?: number;
  appServerThreads?: AppServerThreadsInput | null;
  now?: string;
}): SessionSearchResult[] {
  const query = options.query.trim();
  if (!query) return [];
  const limit = clamp(options.limit ?? 10, 1, 100);
  const nowMs = timestampMillis(options.now ?? null) ?? Date.now();
  const exactThreadId = searchThreadIdCandidate(query);
  if (exactThreadId) {
    const exactRow = codexSearchRowByThreadId(db, exactThreadId);
    if (exactRow) {
      return [
        sessionSearchResultFromRow(
          exactRow,
          exactThreadScore(exactRow, nowMs),
          `Thread id: ${codexThreadRef(String(exactRow.threadId))}`,
          "thread_id",
          ["exact_thread_id"],
          nowMs,
          exactThreadMatchFeatures(exactRow, nowMs)
        )
      ];
    }
  }

  const results: SessionSearchResult[] = [];
  const seenRefs = new Set<string>();
  const plan = codexFtsQueryPlan(query);
  const includeBodyColumns = plan.prefixTerms.length > 0;
  const candidateLimit = clamp(limit * 4, limit, 400);
  let ftsRowCount = 0;

  if (plan.andQuery) {
    const andRows = selectCodexFtsRows(db, plan.andQuery, candidateLimit, includeBodyColumns);
    ftsRowCount += andRows.length;
    for (const ranked of rankCodexFtsRows(andRows, nowMs, plan)) {
      const result = codexFtsResultFromRankedRow(ranked, plan, [], nowMs);
      if (seenRefs.has(result.sourceRef)) continue;
      seenRefs.add(result.sourceRef);
      results.push(result);
      if (results.length >= limit) break;
    }
  }

  if (results.length < limit && plan.orQuery && plan.orQuery !== plan.andQuery) {
    const orRows = selectCodexFtsRows(db, plan.orQuery, candidateLimit, includeBodyColumns);
    ftsRowCount += orRows.length;
    for (const ranked of rankCodexFtsRows(orRows, nowMs, plan)) {
      const prefixMatched = ranked.identifierScore > 0;
      const result = codexFtsResultFromRankedRow(
        ranked,
        plan,
        ["or_degraded", prefixMatched ? "prefix_match" : ""].filter(Boolean),
        nowMs
      );
      if (seenRefs.has(result.sourceRef)) continue;
      seenRefs.add(result.sourceRef);
      results.push(result);
      if (results.length >= limit) break;
    }
  }

  for (const aliasResult of threadTitleAliasSearchResults(db, query, nowMs)) {
    const existing = results.find((result) => result.sourceRef === aliasResult.sourceRef);
    if (existing) {
      existing.reasonCodes = unique([...existing.reasonCodes, ...aliasResult.reasonCodes]);
      continue;
    }
    if (results.length >= limit) break;
    seenRefs.add(aliasResult.sourceRef);
    results.push(aliasResult);
  }

  if (ftsRowCount === 0 && results.length === 0) {
    const like = `%${escapeLike(query)}%`;
    for (const row of db.prepare(`
      SELECT thread_id AS threadId, title, summary, updated_at AS updatedAt, safe_text AS safeText
      FROM codex_sessions
      WHERE title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR safe_text LIKE ? ESCAPE '\\'
      ORDER BY COALESCE(updated_at, indexed_at) DESC
      LIMIT ?
    `).all(like, like, like, limit) as CodexSearchRow[]) {
      const result = sessionSearchResultFromRow(row, likeFallbackScore(row, nowMs), createSnippet(String(row.safeText ?? ""), query), "safe_text", ["safe_text_match"], nowMs);
      if (seenRefs.has(result.sourceRef)) continue;
      seenRefs.add(result.sourceRef);
      results.push(result);
      if (results.length >= limit) break;
    }
  }

  for (const aliasResult of appServerAliasSearchResults(db, options.appServerThreads ?? null, query, nowMs)) {
    if (seenRefs.has(aliasResult.sourceRef)) continue;
    seenRefs.add(aliasResult.sourceRef);
    results.push(aliasResult);
    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}

export function rebuildCodexSearchFts(db: LooDatabase): void {
  db.prepare("DELETE FROM codex_search_fts").run();
  for (const row of codexSearchFtsDocumentRows(db)) {
    insertCodexSearchFtsDocument(db, row);
  }
}

export function upsertCodexSearchFtsForThread(db: LooDatabase, threadId: string): void {
  const row = codexSearchFtsDocumentRow(db, threadId);
  if (!row) return;
  const sessionRowid = codexSearchFtsDocumentSessionRowid(row);
  deleteCodexSearchFtsForSessionRowid(db, sessionRowid);
  insertCodexSearchFtsDocument(db, row);
}

export function deleteCodexSearchFtsForSessionRowid(db: LooDatabase, sessionRowid: number): void {
  db.prepare("DELETE FROM codex_search_fts WHERE rowid = ?").run(sessionRowid);
}

export function insertCodexSearchFtsForThreadRowid(db: LooDatabase, threadId: string, sessionRowid: number): void {
  const row = codexSearchFtsDocumentRow(db, threadId);
  if (row) insertCodexSearchFtsDocument(db, { ...row, sessionRowid });
}

export function codexSearchFtsNeedsBackfill(db: LooDatabase): boolean {
  const sessionCount = Number((db.prepare("SELECT COUNT(*) AS count FROM codex_sessions").get() as { count: number }).count);
  const ftsCount = Number((db.prepare("SELECT COUNT(*) AS count FROM codex_search_fts").get() as { count: number }).count);
  // Backfill on any count drift in either direction (missing rows OR stale
  // leftovers), not just an underfilled table. Dual-write (upsert/delete per
  // thread) keeps row identity in sync once counts match.
  return ftsCount !== sessionCount;
}

export function safeFtsTerms(query: string): string[] {
  return codexFtsQueryPlan(query).terms.map((term) => quoteFtsTerm(term));
}

export function lexicalQueryTerms(query: string): string[] {
  return query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, CODEX_SEARCH_FTS_TERM_CAP) ?? [];
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function createSnippet(text: string, query: string): string {
  const lower = text.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index < 0) return truncate(text, 240);
  return truncate(text.slice(Math.max(0, index - 80), index + query.length + 160), 260);
}

function codexFtsQueryPlan(query: string): CodexFtsQueryPlan {
  const rawTerms = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const terms = rawTerms.slice(0, CODEX_SEARCH_FTS_TERM_CAP);
  const quoted = terms.map((term) => quoteFtsTerm(term));
  const prefixTerms = terms.filter(isIdentifierShapedTerm);
  const orParts = unique([
    ...quoted,
    ...prefixTerms.map((term) => `${quoteFtsTerm(term)}*`)
  ]);
  return {
    rawTerms,
    terms,
    truncated: rawTerms.length > terms.length,
    andQuery: quoted.join(" "),
    orQuery: orParts.join(" OR "),
    prefixTerms
  };
}

function quoteFtsTerm(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

function isIdentifierShapedTerm(term: string): boolean {
  // Digits/underscores/hyphens or an internal camelCase boundary signal an
  // identifier (thread id, file path, symbol). A bare length threshold would
  // misclassify ordinary long words ("authorization") and over-broaden prefix
  // expansion, degrading precision.
  return /[0-9_-]/.test(term) || /[a-z][A-Z]/.test(term);
}

// Body columns (codex_search_fts.body etc.) are only needed for identifier
// prefix scoring; searchBody can be the full session text, so we avoid selecting
// it on the common bm25-only path. Two prepared variants keep non-prefix
// searches lean while still supplying prefix candidates the columns they need.
const CODEX_FTS_SNIPPET_COLUMNS = `
      snippet(codex_search_fts, -1, '${SNIPPET_MATCH_START}', '${SNIPPET_MATCH_END}', '...', 18) AS snippet,
      snippet(codex_search_fts, 1, '${SNIPPET_MATCH_START}', '${SNIPPET_MATCH_END}', '...', 18) AS titleSnippet,
      snippet(codex_search_fts, 2, '${SNIPPET_MATCH_START}', '${SNIPPET_MATCH_END}', '...', 18) AS summarySnippet,
      snippet(codex_search_fts, 3, '${SNIPPET_MATCH_START}', '${SNIPPET_MATCH_END}', '...', 18) AS plansSnippet,
      snippet(codex_search_fts, 4, '${SNIPPET_MATCH_START}', '${SNIPPET_MATCH_END}', '...', 18) AS finalsSnippet,
      snippet(codex_search_fts, 5, '${SNIPPET_MATCH_START}', '${SNIPPET_MATCH_END}', '...', 18) AS touchedFilesSnippet,
      snippet(codex_search_fts, 6, '${SNIPPET_MATCH_START}', '${SNIPPET_MATCH_END}', '...', 18) AS toolMetaSnippet,
      snippet(codex_search_fts, 7, '${SNIPPET_MATCH_START}', '${SNIPPET_MATCH_END}', '...', 18) AS bodySnippet`;

const CODEX_FTS_BODY_COLUMNS = `
      codex_search_fts.title AS searchTitle,
      codex_search_fts.summary AS searchSummary,
      codex_search_fts.plans AS searchPlans,
      codex_search_fts.finals AS searchFinals,
      codex_search_fts.touched_files AS searchTouchedFiles,
      codex_search_fts.tool_meta AS searchToolMeta,
      codex_search_fts.body AS searchBody,`;

function codexFtsRowsSql(includeBodyColumns: boolean): string {
  return `
    SELECT
      s.thread_id AS threadId,
      s.title,
      s.summary,
      s.updated_at AS updatedAt,${CODEX_FTS_SNIPPET_COLUMNS},
      ${includeBodyColumns ? CODEX_FTS_BODY_COLUMNS : ""}
      bm25(codex_search_fts, ${CODEX_SEARCH_BM25_WEIGHTS}) AS bm25
    FROM codex_search_fts
    JOIN codex_sessions s ON s.thread_id = codex_search_fts.thread_id
    WHERE codex_search_fts MATCH ?
    ORDER BY bm25(codex_search_fts, ${CODEX_SEARCH_BM25_WEIGHTS}) ASC
    LIMIT ?
  `;
}

function selectCodexFtsRows(db: LooDatabase, matchQuery: string, limit: number, includeBodyColumns: boolean): CodexSearchRow[] {
  if (!matchQuery) return [];
  return db.prepare(codexFtsRowsSql(includeBodyColumns)).all(matchQuery, limit) as CodexSearchRow[];
}

function rankCodexFtsRows(rows: CodexSearchRow[], nowMs: number, plan: CodexFtsQueryPlan): RankedCodexFtsRow[] {
  if (rows.length === 0) return [];
  const bm25Values = rows.map((row) => finiteNumber(row.bm25, 0));
  const bm25TextScores = normalizeBm25TextScores(bm25Values);
  return rows.map((row, index) => {
    const bm25 = bm25Values[index] ?? 0;
    const bm25TextScore = bm25TextScores[index] ?? 0;
    const sRec = sessionRecencyScore(nullableString(row.updatedAt), nowMs);
    const identifierScore = rowIdentifierTermScore(row, plan.prefixTerms);
    const identifierTextScore = plan.prefixTerms.length > 0
      ? Math.min(1, identifierScore / plan.prefixTerms.length)
      : 0;
    const sText = Math.max(bm25TextScore, identifierTextScore);
    return {
      row,
      bm25,
      sText,
      sRec,
      score: 0.8 * sText + 0.2 * sRec,
      identifierScore,
      matchedFields: matchedFieldsFromRow(row)
    };
  }).sort((left, right) => right.score - left.score || right.identifierScore - left.identifierScore || left.bm25 - right.bm25 || String(left.row.threadId).localeCompare(String(right.row.threadId)));
}

// FTS5 bm25() is always negative-is-better in modern SQLite (more relevant rows
// score more negative). Convert to relevance = max(0, -bm25) and min-max scale
// across the candidate set so the strongest match maps to 1.0 and field-weight
// spread stays visible against the recency term. This is deterministic and
// monotonic in match quality: it replaces the prior global sign heuristic
// (`bm25Values.some(v < 0)`), which could invert relative order on mixed-sign
// candidate sets. Exported for regression coverage.
export function normalizeBm25TextScores(bm25Values: number[]): number[] {
  const relevances = bm25Values.map((value) => Math.max(0, -finiteNumber(value, 0)));
  const maxRelevance = relevances.length ? Math.max(...relevances) : 0;
  // No positive relevance signal (e.g. all bm25 >= 0): treat every candidate as
  // equally (un)ranked so the recency term becomes the tie-break, matching the
  // prior behavior.
  if (maxRelevance <= 0) return relevances.map(() => 1);
  return relevances.map((relevance) => relevance / maxRelevance);
}

function codexFtsResultFromRankedRow(
  ranked: RankedCodexFtsRow,
  plan: CodexFtsQueryPlan,
  extraReasonCodes: string[],
  nowMs: number
): SessionSearchResult {
  const reasonCodes = unique([
    "fts_match",
    plan.truncated ? "query_terms_truncated" : "",
    ...extraReasonCodes,
    ...ranked.matchedFields.map((field) => `matched_field:${field}`)
  ].filter(Boolean));
  return sessionSearchResultFromRow(
    ranked.row,
    ranked.score,
    renderSnippetMarkers(String(ranked.row.snippet ?? "")),
    "full_text",
    reasonCodes,
    nowMs,
    {
      bm25: ranked.bm25,
      sText: ranked.sText,
      sRec: ranked.sRec,
      matchedFields: ranked.matchedFields
    }
  );
}

function matchedFieldsFromRow(row: CodexSearchRow): CodexSearchFtsField[] {
  const fields: Array<[CodexSearchFtsField, string, string]> = [
    ["title", "titleSnippet", "searchTitle"],
    ["summary", "summarySnippet", "searchSummary"],
    ["plans", "plansSnippet", "searchPlans"],
    ["finals", "finalsSnippet", "searchFinals"],
    ["touched_files", "touchedFilesSnippet", "searchTouchedFiles"],
    ["tool_meta", "toolMetaSnippet", "searchToolMeta"],
    ["body", "bodySnippet", "searchBody"]
  ];
  return fields.flatMap(([field, snippetKey]) => snippetHasMatch(row[snippetKey]) ? [field] : []);
}

function snippetHasMatch(value: unknown): boolean {
  return typeof value === "string" && value.includes(SNIPPET_MATCH_START) && value.includes(SNIPPET_MATCH_END);
}

function renderSnippetMarkers(value: string): string {
  return value.split(SNIPPET_MATCH_START).join(MATCH_START).split(SNIPPET_MATCH_END).join(MATCH_END);
}

function rowIdentifierTermScore(row: CodexSearchRow, prefixTerms: string[]): number {
  const terms = prefixTerms.map((term) => term.toLowerCase());
  if (terms.length === 0) return 0;
  const haystack = [
    row.searchTitle,
    row.searchSummary,
    row.searchPlans,
    row.searchFinals,
    row.searchTouchedFiles,
    row.searchToolMeta,
    row.searchBody
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");
  const tokens = haystack.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return terms.reduce((score, term) => {
    if (haystack.includes(term) || tokens.some((token) => token.startsWith(term))) return score + 1;
    return score;
  }, 0);
}

function codexSearchFtsDocumentRows(db: LooDatabase): CodexSearchRow[] {
  return db.prepare(codexSearchFtsDocumentSql()).all() as CodexSearchRow[];
}

function codexSearchFtsDocumentRow(db: LooDatabase, threadId: string): CodexSearchRow | null {
  const row = db.prepare(`${codexSearchFtsDocumentSql()} WHERE s.thread_id = ?`).get(threadId) as CodexSearchRow | undefined;
  return row ?? null;
}

function codexSearchFtsDocumentSql(): string {
  return `
    SELECT
      s.rowid AS sessionRowid,
      s.thread_id AS threadId,
      COALESCE(s.title, '') AS title,
      COALESCE(s.summary, '') AS summary,
      COALESCE((
        SELECT group_concat(text, ' ')
        FROM (SELECT text FROM codex_plans WHERE thread_id = s.thread_id ORDER BY ordinal)
      ), '') AS plans,
      COALESCE(s.final_message, '') AS finals,
      COALESCE((
        SELECT group_concat(path, ' ')
        FROM (SELECT path FROM codex_touched_files WHERE thread_id = s.thread_id ORDER BY path)
      ), '') AS touchedFiles,
      COALESCE((
        SELECT group_concat(text, ' ')
        FROM (
          SELECT trim(tool_name || ' ' || arguments_text) AS text
          FROM codex_tool_calls
          WHERE thread_id = s.thread_id
          ORDER BY call_id
        )
      ), '') AS toolMeta,
      COALESCE(s.safe_text, '') AS body
    FROM codex_sessions s
  `;
}

function insertCodexSearchFtsDocument(db: LooDatabase, row: CodexSearchRow): void {
  const sessionRowid = codexSearchFtsDocumentSessionRowid(row);
  db.prepare(`
    INSERT INTO codex_search_fts (rowid, thread_id, title, summary, plans, finals, touched_files, tool_meta, body)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionRowid,
    String(row.threadId),
    String(row.title ?? ""),
    String(row.summary ?? ""),
    String(row.plans ?? ""),
    String(row.finals ?? ""),
    String(row.touchedFiles ?? ""),
    String(row.toolMeta ?? ""),
    String(row.body ?? "")
  );
}

function codexSearchFtsDocumentSessionRowid(row: CodexSearchRow): number {
  const sessionRowid = Number(row.sessionRowid);
  if (!Number.isSafeInteger(sessionRowid) || sessionRowid < 1) {
    throw new Error("codex_search_fts document requires a positive codex_sessions rowid");
  }
  return sessionRowid;
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
  `).all() as CodexSearchRow[];
  return rows.filter((row) => titleAliasMatchesQuery(String(row.aliasNorm ?? ""), queryKey)).slice(0, 25).map((row) => {
    const threadId = String(row.threadId);
    const updatedAt = nullableString(row.sessionUpdatedAt) ?? nullableString(row.updatedAt);
    const aliasText = publicSafeSearchText(String(row.aliasText ?? ""), 160);
    const sRec = sessionRecencyScore(updatedAt, nowMs);
    return {
      sourceKind: "codex_thread",
      sourceRef: codexThreadRef(threadId),
      threadId,
      title: nullablePublicSafeSearchString(row.title, 160) ?? aliasText,
      summary: nullablePublicSafeSearchString(row.summary, 900),
      updatedAt,
      score: 0.65 + 0.2 * sRec,
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

function codexSearchRowByThreadId(db: LooDatabase, threadId: string): CodexSearchRow | null {
  const row = db.prepare(`
    SELECT thread_id AS threadId, title, summary, updated_at AS updatedAt, safe_text AS safeText
    FROM codex_sessions
    WHERE thread_id = ?
  `).get(threadId) as CodexSearchRow | undefined;
  return row ?? null;
}

function searchThreadIdCandidate(query: string): string | null {
  const bare = bareCodexThreadId(query.trim());
  if (!bare || /\s/.test(bare)) return null;
  if (!/^[A-Za-z0-9._:-]{4,200}$/.test(bare)) return null;
  return bare;
}

function sessionSearchResultFromRow(
  row: CodexSearchRow,
  score: number,
  snippet: string,
  matchKind: SessionSearchResult["matchKind"],
  reasonCodes: string[],
  nowMs: number,
  matchFeatures?: CodexSearchMatchFeatures
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
    reasonCodes: unique(reasonCodes.map((code) => publicSafeText(code, 80))),
    ...(matchFeatures ? { matchFeatures } : {})
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
      const sRec = sessionRecencyScore(nullableString(row.updatedAt), nowMs);
      results.push(sessionSearchResultFromRow(row, 0.7 + 0.2 * sRec, `App-server alias: ${matchedAlias}`, "app_server_alias", ["app_server_alias", "read_only_app_server_signal"], nowMs));
    } else {
      const updatedAt = publicThread.updatedAt ?? null;
      const sRec = sessionRecencyScore(updatedAt, nowMs);
      results.push({
        sourceKind: "codex_thread",
        sourceRef: codexThreadRef(publicThread.threadId),
        threadId: publicThread.threadId,
        title: publicThread.titleSanitized ?? null,
        summary: null,
        updatedAt,
        score: 0.55 + 0.2 * sRec,
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

function publicAppServerThreadSignal(input: NonNullable<AppServerThreadsInput["threads"]>[number]): Required<Pick<NonNullable<AppServerThreadsInput["threads"]>[number], "appServerRef" | "threadId" | "sourceRef">> & NonNullable<AppServerThreadsInput["threads"]>[number] {
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

function exactThreadScore(row: CodexSearchRow, nowMs: number): number {
  return 0.8 + 0.2 * sessionRecencyScore(nullableString(row.updatedAt), nowMs);
}

function exactThreadMatchFeatures(row: CodexSearchRow, nowMs: number): CodexSearchMatchFeatures {
  const sRec = sessionRecencyScore(nullableString(row.updatedAt), nowMs);
  return { bm25: 0, sText: 1, sRec, matchedFields: [] };
}

function likeFallbackScore(row: CodexSearchRow, nowMs: number): number {
  return 0.25 + 0.2 * sessionRecencyScore(nullableString(row.updatedAt), nowMs);
}

function sessionRecencyScore(updatedAt: string | null, nowMs: number): number {
  const updatedMs = timestampMillis(updatedAt);
  if (updatedMs === null) return 0;
  const ageDays = Math.max(0, (nowMs - updatedMs) / (24 * 60 * 60 * 1000));
  return Math.exp(-ageDays / 30);
}

function sessionFreshness(updatedAt: string | null, nowMs: number = Date.now()): SessionSearchResult["freshness"] {
  const updatedMs = timestampMillis(updatedAt);
  const ageSeconds = updatedMs === null ? null : Math.max(0, Math.round((nowMs - updatedMs) / 1000));
  return {
    lastEventAt: updatedAt,
    ageSeconds,
    stale: ageSeconds !== null && ageSeconds >= 7 * 24 * 60 * 60
  };
}

function timestampMillis(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function codexThreadRef(threadId: string): string {
  return `codex_thread:${threadId}`;
}

function bareCodexThreadId(threadRef: string): string {
  return threadRef.startsWith("codex_thread:") ? threadRef.slice("codex_thread:".length) : threadRef;
}

function normalizedTitle(value: string | null | undefined): string {
  return publicSafeText(value ?? "", 180).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function publicIsoTimestamp(value: string | null | undefined): string | null {
  const parsed = timestampMillis(typeof value === "string" ? value : null);
  return parsed === null ? null : new Date(parsed).toISOString();
}

function publicSafeSearchText(value: string, maxChars = 500): string {
  return publicSafeText(value, maxChars);
}

function nullablePublicSafeSearchString(value: unknown, maxChars: number): string | null {
  return typeof value === "string" && value.length > 0 ? publicSafeSearchText(value, maxChars) : null;
}

function publicSafeText(value: string, maxChars = 500): string {
  return truncate(redactPublicSafeString(value), maxChars);
}

// Compiled once at module load: this runs for every field of every rendered row, and the pattern
// is static. Safe to share because it is only used via String.replace (no lastIndex state leaks).
const LOCAL_PATH_PATTERN = (() => {
  const localPathRootPattern =
    "(?:\\/Volumes\\/|\\/(?:Users|home|root)\\/|\\/(?:private\\/)?(?:tmp|var)\\/|~\\/|(?<![A-Za-z])[A-Za-z]:[\\\\/])";
  const structuredLabelPattern = "[A-Za-z][A-Za-z0-9 _-]{0,32}:";
  const relativePathStartPattern = "(?:\\.{1,2}\\/|[A-Za-z0-9_.-]+\\/)";
  const omissionMarkerPattern = "\\+\\d+\\s+more\\b";
  const localPathTerminatorPattern =
    "(?=$|[\\r\\n\"'`)\\]}]|\\s+(?:" +
    `${localPathRootPattern}|${relativePathStartPattern}|${omissionMarkerPattern}|${structuredLabelPattern}))`;
  return new RegExp(`${localPathRootPattern}(?:(?!${localPathTerminatorPattern}).)+`, "g");
})();

function redactPublicSafeString(value: string): string {
  const pathRedacted = value.replace(LOCAL_PATH_PATTERN, "<redacted-path>");
  return redactSafeString(pathRedacted).replace(LOCAL_PATH_PATTERN, "<redacted-path>");
}

function redactSafeString(value: string): string {
  let redacted = value.replace(/\/Users\/[^/\s"'`)]+/g, "~");
  redacted = redacted.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<redacted-secret>");
  redacted = redacted.replace(/sk-[A-Za-z0-9_-]{10,}/g, "<redacted-secret>");
  redacted = redacted.replace(/PRIVATE_CANARY[A-Za-z0-9_:-]*/g, "<redacted-secret>");
  redacted = redacted.replace(/(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, "$1<redacted-secret>");
  redacted = redacted.replace(/(Basic\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1<redacted-secret>");
  redacted = redacted.replace(/(\bauthorization\s*:\s*)[^\r\n"'`)]+/gi, "$1<redacted-secret>");
  redacted = redacted.replace(/(\bcookie\s*:\s*)[^\r\n"'`)]+/gi, "$1<redacted-secret>");
  return redacted;
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
