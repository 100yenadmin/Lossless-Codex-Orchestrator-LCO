import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
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
      artifacts?: { html?: string; scorecard?: string };
    };
    const html = readFileSync(htmlPath, "utf8");
    const scorecard = JSON.parse(readFileSync(scorecardPath, "utf8")) as { current_score?: string; evidence_path?: string };

    assert.equal(report.shellReady, true);
    assert.equal(report.publicSafe, true);
    assert.equal(report.resultCount, 2);
    assert.deepEqual(report.blockerCodes, []);
    assert.equal(report.filters?.query, "custom query");
    assert.equal(report.expansionProfile, "evidence");
    assert.equal(report.rawTranscriptRendered, false);
    assert.equal(report.artifacts?.html, "local-mac-search-ui.html");
    assert.equal(report.artifacts?.scorecard, "local-mac-search-ui-scorecard.json");
    assert.equal(scorecard.current_score, "partial");
    assert.match(String(scorecard.evidence_path), /local-mac-search-ui-scorecard\.json/);
    assert.match(html, /Lossless Local Search/);
    assert.match(html, /codex_thread:sample-active/);
    assert.match(html, /lcm_summary:sample-handoff/);
    assert.doesNotMatch(`${result.stdout}\n${html}\n${JSON.stringify(report)}\n${JSON.stringify(scorecard)}`, /PRIVATE_TRANSCRIPT|npm_[A-Za-z0-9]/i);
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
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
