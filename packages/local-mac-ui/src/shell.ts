import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const REQUIRED_LOCAL_MAC_SEARCH_UI_TOOLS = [
  "loo_search_sessions",
  "loo_grep",
  "loo_describe_session",
  "loo_describe_ref",
  "loo_expand_query",
  "loo_codex_thread_map",
  "loo_doctor",
  "loo_permissions",
  "loo_desktop_see"
] as const;

const PRIVATE_RESULT_FIELDS = new Set([
  "raw",
  "rawText",
  "rawPrompt",
  "rawMessage",
  "rawTranscript",
  "transcript",
  "prompt",
  "messageText",
  "sqliteRow",
  "screenshot",
  "video"
]);

export type LocalMacSearchUiStatus = {
  platform?: string;
  localDbAvailable: boolean;
  openclawPluginLoaded: boolean;
  availableTools: string[];
  cuaStatus?: string;
  peekabooStatus?: string;
};

export type LocalMacSearchUiFilters = {
  query?: string;
  project?: string;
  status?: string;
  priority?: string;
  blocker?: string;
};

export type LocalMacSearchUiResult = {
  title: string;
  sourceRef: string;
  safeSummary: string;
  project?: string;
  status?: string;
  priority?: string;
  blocker?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type LocalMacSearchUiShellOptions = {
  status: LocalMacSearchUiStatus;
  filters?: LocalMacSearchUiFilters;
  expansionProfile?: "metadata" | "brief" | "evidence";
  results?: LocalMacSearchUiResult[];
};

export type LocalMacSearchUiShellReport = {
  kind: "loo_local_mac_search_ui_shell";
  shellReady: boolean;
  publicSafe: true;
  generatedAt: string;
  platform: string;
  blockerCodes: string[];
  blockers: string[];
  requiredTools: string[];
  missingTools: string[];
  filters: LocalMacSearchUiFilters;
  expansionProfile: "metadata" | "brief" | "evidence";
  resultCount: number;
  copyTargets: string[];
  statusSurfaces: {
    cua: string;
    peekaboo: string;
  };
  rawTranscriptRendered: false;
  proofBoundary: string;
  privateDataExclusions: string[];
  html: string;
  artifacts?: {
    html: string;
    report: string;
    scorecard: string;
  };
};

export function createLocalMacSearchUiShell(options: LocalMacSearchUiShellOptions): LocalMacSearchUiShellReport {
  const platform = options.status.platform ?? process.platform;
  const filters = normalizeFilters(options.filters);
  const expansionProfile = options.expansionProfile ?? "metadata";
  const results = (options.results ?? []).map(normalizeResult);
  const renderableResults = results.filter((result) => isSafeSourceRef(result.sourceRef));
  const missingTools = REQUIRED_LOCAL_MAC_SEARCH_UI_TOOLS.filter((tool) => !options.status.availableTools.includes(tool));
  const rawFieldBlockers = collectRawFieldBlockers(options.results ?? []);
  const unsafeRefBlockers = results
    .map((result, index) => isSafeSourceRef(result.sourceRef) ? "" : `unsafe_source_ref:${index}`)
    .filter(Boolean);
  const blockerCodes = [
    ...(platform !== "darwin" ? ["macos_platform_required"] : []),
    ...(options.status.localDbAvailable ? [] : ["local_db_unavailable"]),
    ...(options.status.openclawPluginLoaded ? [] : ["openclaw_plugin_unavailable"]),
    ...missingTools.map((tool) => `required_tool_missing:${tool}`),
    ...rawFieldBlockers,
    ...unsafeRefBlockers
  ];
  const shellReady = blockerCodes.length === 0;
  const copyTargets = renderableResults.map((result) => result.sourceRef);
  const statusSurfaces = {
    cua: sanitizeStatus(options.status.cuaStatus ?? "not-probed"),
    peekaboo: sanitizeStatus(options.status.peekabooStatus ?? "not-probed")
  };
  const proofBoundary = "Prototype local Mac search shell only; not a signed or release-ready macOS app, not Claude parity, not live Codex control, and not GUI mutation.";
  const reportBase = {
    kind: "loo_local_mac_search_ui_shell" as const,
    shellReady,
    publicSafe: true as const,
    generatedAt: new Date().toISOString(),
    platform,
    blockerCodes,
    blockers: blockerCodes,
    requiredTools: [...REQUIRED_LOCAL_MAC_SEARCH_UI_TOOLS],
    missingTools,
    filters,
    expansionProfile,
    resultCount: renderableResults.length,
    copyTargets,
    statusSurfaces,
    rawTranscriptRendered: false as const,
    proofBoundary,
    privateDataExclusions: [
      "raw Codex transcripts",
      "raw prompts or message text",
      "SQLite DBs",
      "screenshots or videos",
      "tokens, credentials, API keys, cookies",
      "private customer data"
    ]
  };

  const html = renderLocalMacSearchUiHtml({ ...reportBase, results: renderableResults });
  return { ...reportBase, html };
}

export function writeLocalMacSearchUiEvidence(options: {
  evidenceDir: string;
  shell: LocalMacSearchUiShellReport;
  scorecardSourcePath?: string;
}): LocalMacSearchUiShellReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const htmlName = "local-mac-search-ui.html";
  const reportName = "local-mac-search-ui-report.json";
  const scorecardName = "local-mac-search-ui-scorecard.json";
  const htmlPath = join(evidenceDir, htmlName);
  const reportPath = join(evidenceDir, reportName);
  const scorecardPath = join(evidenceDir, scorecardName);
  const artifacts = { html: htmlName, report: reportName, scorecard: scorecardName };
  const shell = { ...options.shell, artifacts };
  const scorecard = createIssueScorecard(options.scorecardSourcePath, shell, scorecardPath);

  writeFileSync(htmlPath, shell.html);
  writeJson(reportPath, omitHtml(shell));
  writeJson(scorecardPath, scorecard);
  return shell;
}

export function sampleLocalMacSearchUiShell(options: {
  filters?: LocalMacSearchUiFilters;
  expansionProfile?: "metadata" | "brief" | "evidence";
} = {}): LocalMacSearchUiShellReport {
  return createLocalMacSearchUiShell({
    status: {
      platform: "darwin",
      localDbAvailable: true,
      openclawPluginLoaded: true,
      availableTools: [...REQUIRED_LOCAL_MAC_SEARCH_UI_TOOLS],
      cuaStatus: "diagnostics-only",
      peekabooStatus: "permissions-status-only"
    },
    filters: {
      query: "handoff",
      project: "lco",
      status: "active",
      priority: "high",
      blocker: "none",
      ...options.filters
    },
    expansionProfile: options.expansionProfile ?? "brief",
    results: [
      {
        title: "Active Codex beta thread",
        sourceRef: "codex_thread:sample-active",
        safeSummary: "Safe summary: live-control smoke proof is available through a bounded evidence packet.",
        project: "lco",
        status: "active",
        priority: "high",
        blocker: "none",
        updatedAt: "2026-06-30T06:14:01Z"
      },
      {
        title: "OpenClaw handoff summary",
        sourceRef: "lcm_summary:sample-handoff",
        safeSummary: "Safe summary: OpenClaw agents can receive source refs and bounded summary text without raw transcripts.",
        project: "lco",
        status: "ready",
        priority: "medium",
        blocker: "none",
        updatedAt: "2026-06-30T06:15:00Z"
      }
    ]
  });
}

function normalizeFilters(filters: LocalMacSearchUiFilters | undefined): LocalMacSearchUiFilters {
  return {
    query: safeText(filters?.query ?? ""),
    project: safeText(filters?.project ?? "all"),
    status: safeText(filters?.status ?? "all"),
    priority: safeText(filters?.priority ?? "all"),
    blocker: safeText(filters?.blocker ?? "all")
  };
}

function normalizeResult(result: LocalMacSearchUiResult): LocalMacSearchUiResult {
  return {
    title: safeText(result.title),
    sourceRef: safeText(result.sourceRef),
    safeSummary: safeText(result.safeSummary, 360),
    project: safeText(result.project ?? "unknown"),
    status: safeText(result.status ?? "unknown"),
    priority: safeText(result.priority ?? "unknown"),
    blocker: safeText(result.blocker ?? "unknown"),
    updatedAt: safeText(result.updatedAt ?? "unknown")
  };
}

function collectRawFieldBlockers(results: LocalMacSearchUiResult[]): string[] {
  return results.flatMap((result, index) => Object.keys(result)
    .filter((key) => PRIVATE_RESULT_FIELDS.has(key))
    .map((key) => `raw_result_field_rejected:${index}:${key}`));
}

function isSafeSourceRef(value: string): boolean {
  return /^(codex_thread|codex_event|lcm_summary):[A-Za-z0-9._:%/-]+$/.test(value);
}

function sanitizeStatus(value: string): string {
  return safeText(value || "unknown", 80);
}

function safeText(value: unknown, maxLength = 160): string {
  const text = typeof value === "string" ? value : "";
  return text
    .replace(/\b(npm|ghp|sk)-?[A-Za-z0-9_]{16,}\b/g, "[redacted-token]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLocalMacSearchUiHtml(input: {
  shellReady: boolean;
  blockerCodes: string[];
  filters: LocalMacSearchUiFilters;
  expansionProfile: "metadata" | "brief" | "evidence";
  resultCount: number;
  statusSurfaces: { cua: string; peekaboo: string };
  proofBoundary: string;
  results: LocalMacSearchUiResult[];
}): string {
  const results = input.results.map((result) => [
    `<article class="result" data-ref="${escapeHtml(result.sourceRef)}">`,
    `  <div class="result-title">${escapeHtml(result.title)}</div>`,
    `  <button type="button" data-copy-ref="${escapeHtml(result.sourceRef)}">Copy ref</button>`,
    `  <code>${escapeHtml(result.sourceRef)}</code>`,
    `  <p>${escapeHtml(result.safeSummary)}</p>`,
    `  <dl><dt>project</dt><dd>${escapeHtml(result.project ?? "unknown")}</dd><dt>status</dt><dd>${escapeHtml(result.status ?? "unknown")}</dd><dt>priority</dt><dd>${escapeHtml(result.priority ?? "unknown")}</dd><dt>blocker</dt><dd>${escapeHtml(result.blocker ?? "unknown")}</dd><dt>updated</dt><dd>${escapeHtml(result.updatedAt ?? "unknown")}</dd></dl>`,
    "</article>"
  ].join("\n")).join("\n");
  const blockers = input.blockerCodes.length
    ? `<section class="fail-closed"><h2>Fail-Closed</h2><ul>${input.blockerCodes.map((blocker) => `<li>${escapeHtml(blocker)}</li>`).join("")}</ul></section>`
    : `<section class="ready"><h2>Ready</h2><p>Shell can display public-safe summaries and source refs.</p></section>`;
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "  <title>Lossless Local Search</title>",
    "  <style>",
    "    body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:#f7f7f3;color:#1f2528}",
    "    header,main{max-width:980px;margin:0 auto;padding:24px}",
    "    header{border-bottom:1px solid #d7d8d2}",
    "    .filters,.status{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:16px 0}",
    "    .pill,.result,.fail-closed,.ready{border:1px solid #d7d8d2;border-radius:8px;background:#fff;padding:12px}",
    "    .result{margin:12px 0}.result-title{font-weight:700;margin-bottom:8px}button{border:1px solid #59636a;background:#fff;border-radius:6px;padding:6px 10px}code{display:block;margin:8px 0;color:#315f72}dl{display:grid;grid-template-columns:90px 1fr;gap:4px 10px}dt{color:#667085}dd{margin:0}",
    "  </style>",
    "</head>",
    "<body>",
    "  <header>",
    "    <h1>Lossless Local Search</h1>",
    `    <p>${escapeHtml(input.proofBoundary)}</p>`,
    "  </header>",
    "  <main>",
    blockers,
    "    <section class=\"filters\" aria-label=\"Filters\">",
    `      <div class="pill">query: ${escapeHtml(input.filters.query ?? "")}</div>`,
    `      <div class="pill">project: ${escapeHtml(input.filters.project ?? "all")}</div>`,
    `      <div class="pill">status: ${escapeHtml(input.filters.status ?? "all")}</div>`,
    `      <div class="pill">priority: ${escapeHtml(input.filters.priority ?? "all")}</div>`,
    `      <div class="pill">blocker: ${escapeHtml(input.filters.blocker ?? "all")}</div>`,
    `      <div class="pill">expansion: ${escapeHtml(input.expansionProfile)}</div>`,
    "    </section>",
    "    <section class=\"status\" aria-label=\"Status surfaces\">",
    `      <div class="pill">CUA: ${escapeHtml(input.statusSurfaces.cua)}</div>`,
    `      <div class="pill">Peekaboo: ${escapeHtml(input.statusSurfaces.peekaboo)}</div>`,
    `      <div class="pill">results: ${input.resultCount}</div>`,
    "    </section>",
    "    <section aria-label=\"Search results\">",
    results || "<p>No public-safe results in this shell packet.</p>",
    "    </section>",
    "  </main>",
    "</body>",
    "</html>"
  ].join("\n");
}

function omitHtml(shell: LocalMacSearchUiShellReport): Omit<LocalMacSearchUiShellReport, "html"> {
  const { html: _html, ...rest } = shell;
  return rest;
}

function createIssueScorecard(sourcePath: string | undefined, shell: LocalMacSearchUiShellReport, evidencePath: string): Record<string, unknown> {
  const source = sourcePath ? JSON.parse(readFileSync(sourcePath, "utf8")) as Record<string, unknown> : {};
  return {
    ...source,
    current_score: shell.shellReady ? "partial" : "blocked",
    evidence_path: evidencePath,
    expected_public_safe_evidence: [
      "static local Mac search shell HTML",
      "public-safe shell report",
      "source refs and safe summary snippets",
      "filter state and status surfaces",
      "fail-closed blocker codes when dependencies are missing"
    ],
    known_gaps: [
      "Prototype shell only; no signed or notarized macOS app artifact.",
      "No live OpenClaw gateway UI event loop is driven by this command.",
      "No GUI mutation, screenshots, videos, CUA no-focus proof, or Peekaboo snapshot proof is claimed.",
      "Claude Code remains a future adapter boundary."
    ],
    next_action: "Wire the shell to live loo_* tool calls or a packaged macOS wrapper only after this prototype remains public-safe under gateway dogfood.",
    proof_boundary: shell.proofBoundary
  };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
