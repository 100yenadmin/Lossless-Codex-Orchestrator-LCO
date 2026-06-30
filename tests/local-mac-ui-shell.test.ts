import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createDatabase } from "../packages/core/src/index.js";
import {
  createLocalMacSearchUiShell,
  REQUIRED_LOCAL_MAC_SEARCH_UI_TOOLS
} from "../packages/local-mac-ui/src/shell.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
const cliSpawnOptions = {
  encoding: "utf8" as const,
  timeout: 15_000,
  killSignal: "SIGKILL" as const
};

test("local Mac search UI shell fails closed when local dependencies are unavailable", () => {
  const shell = createLocalMacSearchUiShell({
    status: {
      platform: "darwin",
      localDbAvailable: false,
      openclawPluginLoaded: false,
      availableTools: ["loo_search_sessions"]
    },
    filters: { query: "release smoke" },
    results: []
  });

  assert.equal(shell.shellReady, false);
  assert.equal(shell.publicSafe, true);
  assert.match(shell.blockers.join("\n"), /local_db_unavailable/);
  assert.match(shell.blockers.join("\n"), /openclaw_plugin_unavailable/);
  assert.match(shell.blockers.join("\n"), /required_tool_missing:loo_describe_session/);
  assert.match(shell.html, /Fail-Closed/);
  assert.match(shell.html, /release smoke/);
  assert.doesNotMatch(shell.html, /raw transcript/i);
});

test("local Mac search UI shell renders only safe summaries, refs, filters, and status surfaces", () => {
  const shell = createLocalMacSearchUiShell({
    status: {
      platform: "darwin",
      localDbAvailable: true,
      openclawPluginLoaded: true,
      availableTools: REQUIRED_LOCAL_MAC_SEARCH_UI_TOOLS,
      cuaStatus: "available",
      peekabooStatus: "permissions-granted"
    },
    filters: {
      query: "handoff packet",
      project: "lco",
      status: "active",
      priority: "high",
      blocker: "none"
    },
    expansionProfile: "brief",
    results: [
      {
        title: "Codex release thread",
        sourceRef: "codex_thread:abc123",
        safeSummary: "Public-safe summary with no private transcript text and npm_ABCDEFGHIJKLMNOPQRSTUVWX redacted.",
        project: "lco",
        status: "active",
        priority: "high",
        blocker: "none",
        updatedAt: "2026-06-30T06:00:00Z",
        rawTranscript: "PRIVATE_TRANSCRIPT_SHOULD_NOT_RENDER"
      }
    ]
  });

  assert.equal(shell.shellReady, false, "raw-like result fields must keep the shell fail-closed");
  assert.match(shell.blockers.join("\n"), /raw_result_field_rejected:0:rawTranscript/);
  assert.equal(shell.resultCount, 1);
  assert.deepEqual(shell.copyTargets, ["codex_thread:abc123"]);
  assert.match(shell.html, /handoff packet/);
  assert.match(shell.html, /codex_thread:abc123/);
  assert.match(shell.html, /Public-safe summary/);
  assert.match(shell.html, /project/);
  assert.match(shell.html, /status/);
  assert.match(shell.html, /priority/);
  assert.match(shell.html, /CUA/);
  assert.match(shell.html, /Peekaboo/);
  assert.match(shell.html, /brief/);
  assert.doesNotMatch(shell.html, /PRIVATE_TRANSCRIPT_SHOULD_NOT_RENDER/);
  assert.doesNotMatch(shell.html, /npm_ABCDEFGHIJKLMNOPQRSTUVWX/);
});

test("local Mac search UI shell omits unsafe refs from rendered and copied output", () => {
  const shell = createLocalMacSearchUiShell({
    status: {
      platform: "darwin",
      localDbAvailable: true,
      openclawPluginLoaded: true,
      availableTools: REQUIRED_LOCAL_MAC_SEARCH_UI_TOOLS
    },
    results: [
      {
        title: "Unsafe ref",
        sourceRef: "file:///Users/lume/.codex/raw-session.jsonl",
        safeSummary: "This should not render because the ref was rejected."
      },
      {
        title: "Safe ref",
        sourceRef: "codex_thread:safe",
        safeSummary: "This safe result can render."
      }
    ]
  });

  assert.equal(shell.shellReady, false);
  assert.match(shell.blockers.join("\n"), /unsafe_source_ref:0/);
  assert.deepEqual(shell.copyTargets, ["codex_thread:safe"]);
  assert.equal(shell.resultCount, 1);
  assert.doesNotMatch(shell.html, /file:\/\/\/Users\/lume/);
  assert.doesNotMatch(shell.html, /This should not render/);
  assert.match(shell.html, /codex_thread:safe/);
});

test("local Mac search UI shell records live CLI tool provenance and bounded expansion state", () => {
  const shell = createLocalMacSearchUiShell({
    requireLiveToolSource: true,
    status: {
      platform: "darwin",
      localDbAvailable: true,
      openclawPluginLoaded: true,
      availableTools: REQUIRED_LOCAL_MAC_SEARCH_UI_TOOLS
    },
    filters: { query: "release handoff" },
    expansionProfile: "brief",
    toolSource: {
      mode: "live",
      surface: "cli",
      queryId: "query_123",
      toolsCalled: [
        "loo_search_sessions",
        "loo_describe_session",
        "loo_expand_query",
        "loo_codex_thread_map"
      ],
      sourceRefs: ["codex_thread:thread-1"],
      boundedExpansion: {
        profile: "brief",
        tokenBudget: 1000,
        sourceRef: "codex_thread:thread-1"
      },
      copyAction: {
        sourceRef: "codex_thread:thread-1",
        publicSafe: true
      }
    },
    results: [
      {
        title: "Live Codex thread",
        sourceRef: "codex_thread:thread-1",
        safeSummary: "Safe summary from live read-only recall tools.",
        project: "lco",
        status: "active",
        priority: "high",
        blocker: "none"
      }
    ]
  });

  assert.equal(shell.shellReady, true);
  assert.equal(shell.toolSource.mode, "live");
  assert.equal(shell.toolSource.surface, "cli");
  assert.equal(shell.toolSource.queryId, "query_123");
  assert.deepEqual(shell.toolSource.toolsCalled, [
    "loo_search_sessions",
    "loo_describe_session",
    "loo_expand_query",
    "loo_codex_thread_map"
  ]);
  assert.equal(shell.toolSource.resultCount, 1);
  assert.deepEqual(shell.toolSource.sourceRefs, ["codex_thread:thread-1"]);
  assert.deepEqual(shell.toolSource.boundedExpansion, {
    profile: "brief",
    tokenBudget: 1000,
    sourceRef: "codex_thread:thread-1"
  });
  assert.deepEqual(shell.toolSource.copyAction, {
    sourceRef: "codex_thread:thread-1",
    publicSafe: true
  });
  assert.match(shell.html, /tool source: cli/);
  assert.match(shell.html, /bounded expansion: brief/);
  assert.doesNotMatch(JSON.stringify(shell), /PRIVATE_TRANSCRIPT_SHOULD_NOT_RENDER|npm_[A-Za-z0-9]/i);
});

test("local Mac search UI shell preserves metadata profile zero token budget", () => {
  const shell = createLocalMacSearchUiShell({
    requireLiveToolSource: true,
    status: {
      platform: "darwin",
      localDbAvailable: true,
      openclawPluginLoaded: true,
      availableTools: REQUIRED_LOCAL_MAC_SEARCH_UI_TOOLS
    },
    expansionProfile: "metadata",
    toolSource: {
      mode: "live",
      surface: "cli",
      toolsCalled: [
        "loo_search_sessions",
        "loo_describe_session",
        "loo_expand_query",
        "loo_codex_thread_map"
      ],
      sourceRefs: ["codex_thread:thread-1"],
      boundedExpansion: {
        profile: "metadata",
        tokenBudget: 0,
        sourceRef: "codex_thread:thread-1"
      },
      copyAction: {
        sourceRef: "codex_thread:thread-1",
        publicSafe: true
      }
    },
    results: [
      {
        title: "Metadata-only Codex thread",
        sourceRef: "codex_thread:thread-1",
        safeSummary: "Safe metadata-only summary."
      }
    ]
  });

  assert.equal(shell.shellReady, true);
  assert.equal(shell.toolSource.boundedExpansion.profile, "metadata");
  assert.equal(shell.toolSource.boundedExpansion.tokenBudget, 0);
});

test("local Mac search UI shell fails closed when live proof contract fields are incomplete", () => {
  const shell = createLocalMacSearchUiShell({
    requireLiveToolSource: true,
    status: {
      platform: "darwin",
      localDbAvailable: true,
      openclawPluginLoaded: true,
      availableTools: REQUIRED_LOCAL_MAC_SEARCH_UI_TOOLS
    },
    expansionProfile: "brief",
    toolSource: {
      mode: "live",
      surface: "cli",
      toolsCalled: [
        "loo_search_sessions",
        "loo_describe_session",
        "loo_expand_query",
        "loo_codex_thread_map"
      ],
      sourceRefs: ["codex_thread:thread-1"],
      boundedExpansion: {
        profile: "brief"
      },
      copyAction: {
        publicSafe: true
      }
    },
    results: [
      {
        title: "Incomplete live proof thread",
        sourceRef: "codex_thread:thread-1",
        safeSummary: "Safe summary with incomplete live proof metadata."
      }
    ]
  });

  assert.equal(shell.shellReady, false);
  assert.match(shell.blockers.join("\n"), /live_tool_bounded_token_budget_missing/);
  assert.match(shell.blockers.join("\n"), /live_tool_bounded_source_ref_missing/);
  assert.match(shell.blockers.join("\n"), /live_tool_copy_source_ref_missing/);
});

test("local Mac search UI shell fails closed when live tool provenance is required but absent", () => {
  const shell = createLocalMacSearchUiShell({
    requireLiveToolSource: true,
    status: {
      platform: "darwin",
      localDbAvailable: true,
      openclawPluginLoaded: true,
      availableTools: REQUIRED_LOCAL_MAC_SEARCH_UI_TOOLS
    },
    results: [
      {
        title: "Static Codex thread",
        sourceRef: "codex_thread:thread-1",
        safeSummary: "Safe static summary."
      }
    ]
  });

  assert.equal(shell.shellReady, false);
  assert.match(shell.blockers.join("\n"), /live_tool_source_missing/);
  assert.equal(shell.toolSource.mode, "static");
  assert.equal(shell.toolSource.resultCount, 1);
});

test("loo ui local-mac-search writes a public-safe prototype shell packet", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-local-mac-ui-"));

  try {
    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "ui",
      "local-mac-search",
      "--evidence-dir",
      evidenceDir,
      "--sample",
      "--query",
      "custom query",
      "--expansion-profile",
      "evidence"
    ], cliSpawnOptions);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const reportPath = join(evidenceDir, "local-mac-search-ui-report.json");
    const htmlPath = join(evidenceDir, "local-mac-search-ui.html");
    const scorecardPath = join(evidenceDir, "local-mac-search-ui-scorecard.json");

    assert.equal(existsSync(reportPath), true);
    assert.equal(existsSync(htmlPath), true);
    assert.equal(existsSync(scorecardPath), true);

    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      shellReady?: boolean;
      publicSafe?: boolean;
      resultCount?: number;
      blockerCodes?: string[];
      filters?: { query?: string };
      expansionProfile?: string;
      rawTranscriptRendered?: boolean;
      proofBoundary?: string;
      artifacts?: { html?: string; scorecard?: string };
    };
    const html = readFileSync(htmlPath, "utf8");
    const scorecard = JSON.parse(readFileSync(scorecardPath, "utf8")) as {
      current_score?: string;
      evidence_path?: string;
      known_gaps?: string[];
      proof_boundary?: string;
    };

    assert.equal(report.shellReady, true);
    assert.equal(report.publicSafe, true);
    assert.equal(report.resultCount, 2);
    assert.deepEqual(report.blockerCodes, []);
    assert.equal(report.filters?.query, "custom query");
    assert.equal(report.expansionProfile, "evidence");
    assert.equal(report.rawTranscriptRendered, false);
    assert.equal(report.artifacts?.html, "local-mac-search-ui.html");
    assert.equal(report.artifacts?.scorecard, "local-mac-search-ui-scorecard.json");
    assert.match(report.proofBoundary ?? "", /CUA Driver scratch-window no-focus proof exists only for one approved TextEdit launch_app action/i);
    assert.equal(scorecard.current_score, "partial");
    assert.match(String(scorecard.evidence_path), /local-mac-search-ui-scorecard\.json/);
    assert.match(String(scorecard.proof_boundary), /one approved TextEdit launch_app action/i);
    assert.match((scorecard.known_gaps ?? []).join("\n"), /CUA Driver scratch-window no-focus proof exists only for one approved TextEdit launch_app action/i);
    assert.doesNotMatch((scorecard.known_gaps ?? []).join("\n"), /CUA no-focus proof/i);
    assert.match(html, /Lossless Local Search/);
    assert.match(html, /codex_thread:sample-active/);
    assert.match(html, /lcm_summary:sample-handoff/);
    assert.doesNotMatch(`${result.stdout}\n${html}\n${JSON.stringify(report)}\n${JSON.stringify(scorecard)}`, /PRIVATE_TRANSCRIPT|npm_[A-Za-z0-9]/i);
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test("loo ui local-mac-search live CLI mode writes connected public-safe tool proof", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-local-mac-ui-live-"));
  const evidenceDir = join(dir, "evidence");
  const runtimeProofDir = join(dir, "runtime-proof");
  const dbPath = join(dir, "orchestrator.sqlite");
  const db = createDatabase(dbPath);
  db.prepare(`
    INSERT INTO codex_sessions (
      thread_id, title, cwd, source_path, updated_at, summary, final_message,
      safe_text, event_count, tool_call_count, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "thread-live-1",
    "Live UI proof thread",
    "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator",
    "/Volumes/LEXAR/Codex/redacted/thread-live-1.jsonl",
    "2026-07-01T00:00:00Z",
    "Safe live UI summary.",
    "Safe final closeout.",
    "release handoff safe live UI summary source refs bounded expansion",
    3,
    0,
    "2026-07-01T00:00:00Z"
  );
  db.prepare(`
    INSERT INTO codex_sessions (
      thread_id, title, cwd, source_path, updated_at, summary, final_message,
      safe_text, event_count, tool_call_count, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "thread-live-2",
    "Out of filter live UI proof thread",
    "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator",
    "/Volumes/LEXAR/Codex/redacted/thread-live-2.jsonl",
    "2026-07-01T01:00:00Z",
    "Safe out-of-filter live UI summary.",
    "Safe out-of-filter final closeout.",
    "release handoff safe live UI summary source refs bounded expansion",
    2,
    0,
    "2026-07-01T01:00:00Z"
  );
  db.prepare(`
    INSERT INTO codex_session_metadata (
      thread_id, project, status, priority, blocker, metadata_schema_version, source_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "thread-live-1",
    "lco",
    "active",
    "high",
    "none",
    4,
    JSON.stringify(["codex_thread:thread-live-1"])
  );
  db.prepare(`
    INSERT INTO codex_session_metadata (
      thread_id, project, status, priority, blocker, metadata_schema_version, source_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "thread-live-2",
    "other",
    "active",
    "high",
    "none",
    4,
    JSON.stringify(["codex_thread:thread-live-2"])
  );
  db.close();

  try {
    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "ui",
      "local-mac-search",
      "--evidence-dir",
      evidenceDir,
      "--live-cli",
      "--query",
      "release handoff",
      "--project",
      "lco",
      "--expansion-profile",
      "evidence",
      "--runtime-proof-dir",
      runtimeProofDir,
      "--strict"
    ], {
      ...cliSpawnOptions,
      env: {
        ...process.env,
        LOO_DB_PATH: dbPath
      }
    });

    const isLocalMac = process.platform === "darwin";
    assert.equal(result.status, isLocalMac ? 0 : 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const report = JSON.parse(readFileSync(join(evidenceDir, "local-mac-search-ui-report.json"), "utf8")) as {
      shellReady?: boolean;
      resultCount?: number;
      copyTargets?: string[];
      toolSource?: {
        mode?: string;
        surface?: string;
        queryId?: string;
        toolsCalled?: string[];
        resultCount?: number;
        sourceRefs?: string[];
        boundedExpansion?: { profile?: string; tokenBudget?: number; sourceRef?: string };
        copyAction?: { sourceRef?: string; publicSafe?: boolean };
      };
      rawTranscriptRendered?: boolean;
    };
    const html = readFileSync(join(evidenceDir, "local-mac-search-ui.html"), "utf8");
    const runtimeProof = JSON.parse(readFileSync(
      join(runtimeProofDir, "connected-local-ui-proof-v1-1.runtime-proof.json"),
      "utf8"
    )) as {
      scenario_id?: string;
      public_safe?: boolean;
      proof_markers?: Record<string, boolean>;
      raw_transcript_spans?: number;
      screenshot_included?: boolean;
      tool_surface?: string;
      result_count?: number;
      platform?: string;
      shell_ready?: boolean;
    };

    assert.equal(report.shellReady, isLocalMac);
    if (isLocalMac) {
      assert.deepEqual((report as { blockerCodes?: string[] }).blockerCodes, []);
    } else {
      assert.match(((report as { blockerCodes?: string[] }).blockerCodes ?? []).join("\n"), /macos_platform_required/);
    }
    assert.equal(report.resultCount, 1);
    assert.equal(report.rawTranscriptRendered, false);
    assert.equal(report.toolSource?.mode, "live");
    assert.equal(report.toolSource?.surface, "cli");
    assert.match(report.toolSource?.queryId ?? "", /^cli-[A-Za-z0-9_-]{24}$/);
    assert.notEqual(report.toolSource?.queryId, `cli-${Buffer.from("release handoff").toString("base64url").slice(0, 24)}`);
    assert.deepEqual(report.toolSource?.toolsCalled, [
      "loo_search_sessions",
      "loo_describe_session",
      "loo_expand_query",
      "loo_codex_thread_map"
    ]);
    assert.equal(report.toolSource?.resultCount, 1);
    assert.deepEqual(report.toolSource?.sourceRefs, ["codex_thread:thread-live-1"]);
    assert.equal(report.toolSource?.boundedExpansion?.profile, "evidence");
    assert.equal(report.toolSource?.boundedExpansion?.tokenBudget, 4000);
    assert.equal(report.toolSource?.boundedExpansion?.sourceRef, "codex_thread:thread-live-1");
    assert.equal(report.toolSource?.copyAction?.sourceRef, "codex_thread:thread-live-1");
    assert.equal(report.toolSource?.copyAction?.publicSafe, true);
    assert.equal(runtimeProof.scenario_id, "connected-local-ui-proof-v1-1");
    assert.equal(runtimeProof.public_safe, isLocalMac);
    assert.deepEqual(runtimeProof.proof_markers, {
      local_mac_shell_ready: isLocalMac,
      live_tool_source: true,
      public_safe_scan: isLocalMac,
      source_refs: true
    });
    assert.equal(runtimeProof.platform, process.platform);
    assert.equal(runtimeProof.shell_ready, isLocalMac);
    assert.equal(runtimeProof.raw_transcript_spans, 0);
    assert.equal(runtimeProof.screenshot_included, false);
    assert.equal(runtimeProof.tool_surface, "cli");
    assert.equal(runtimeProof.result_count, 1);
    assert.match(html, /tool source: cli/);
    assert.match(html, /bounded expansion: evidence/);
    assert.doesNotMatch(
      `${result.stdout}\n${html}\n${JSON.stringify(report)}`,
      /PRIVATE_TRANSCRIPT|npm_[A-Za-z0-9]|raw sqlite|cmVsZWFzZSBoYW5kb2Zm|codex_thread:thread-live-2/i
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo ui local-mac-search exits non-zero in strict mode when dependencies are unavailable", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-local-mac-ui-strict-"));

  try {
    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "ui",
      "local-mac-search",
      "--evidence-dir",
      evidenceDir,
      "--strict"
    ], cliSpawnOptions);

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(readFileSync(join(evidenceDir, "local-mac-search-ui-report.json"), "utf8")) as {
      shellReady?: boolean;
      blockerCodes?: string[];
      artifacts?: { html?: string; report?: string; scorecard?: string };
    };

    assert.equal(report.shellReady, false);
    assert.match(report.blockerCodes?.join("\n") ?? "", /local_db_unavailable/);
    assert.match(report.blockerCodes?.join("\n") ?? "", /openclaw_plugin_unavailable/);
    assert.equal(report.artifacts?.html, "local-mac-search-ui.html");
    assert.equal(existsSync(join(evidenceDir, "local-mac-search-ui.html")), true);
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});
