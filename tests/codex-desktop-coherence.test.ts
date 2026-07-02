import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuditStore } from "../packages/adapters/src/index.js";
import {
  createCodexDesktopCoherenceReport,
  createDatabase,
  type VisibleCodexSessionMapReport
} from "../packages/core/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";

function visibleMapFixture(
  item: Partial<VisibleCodexSessionMapReport["items"][number]>,
  coverage: Partial<VisibleCodexSessionMapReport["sourceCoverage"]> = {}
): VisibleCodexSessionMapReport {
  return {
    schema: "lco.visibleCodexSessionMap.v1",
    publicSafe: true,
    generatedAt: "2026-07-02T08:00:00.000Z",
    items: [{
      desktopRef: null,
      appServerRef: "codex_app_thread:thr_cli",
      sourceRef: "codex_thread:thr_cli",
      titleSanitized: "Desktop parity proof",
      sessionCardRef: "codex_thread:thr_cli",
      confidence: 0.86,
      evidenceIds: ["ev_app_server_thr_cli"],
      ambiguity: [],
      freshness: {
        indexedUpdatedAt: "2026-07-02T07:58:00.000Z",
        appServerUpdatedAt: "2026-07-02T07:59:00.000Z",
        visibleUpdatedLabel: null,
        freshestSource: "codex_app_server"
      },
      reasonCodes: ["app_server_signal", "indexed_session_card"],
      ...item
    }],
    sourceCoverage: {
      indexedLco: "ok",
      visibleCodex: "ok",
      codexAppServer: "ok",
      ...coverage
    },
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      rawTranscriptRead: false
    },
    proofBoundary: "fixture"
  };
}

test("Codex Desktop coherence report distinguishes CLI-visible from Desktop-visible proof", () => {
  const report = createCodexDesktopCoherenceReport({
    threadId: "thr_cli",
    visibleMap: visibleMapFixture({ desktopRef: null }),
    actionEvidence: {
      actionKind: "direct_protocol",
      action: "thread/read metadata probe",
      dryRun: true,
      live: false,
      evidenceId: "ev_direct_probe",
      observedAt: "2026-07-02T07:59:30.000Z"
    },
    now: "2026-07-02T08:00:00.000Z"
  });

  assert.equal(report.schema, "lco.codexDesktopCoherence.v1");
  assert.equal(report.publicSafe, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.state, "cli_visible");
  assert.equal(report.visibility.cli, "proven");
  assert.equal(report.visibility.desktop, "not_seen");
  assert.equal(report.observations.current?.cliVisible, true);
  assert.equal(report.observations.current?.desktopVisible, false);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
  assert.equal(report.actionsPerformed.rawTranscriptRead, false);
  assert.match(report.nextAction, /visible|Desktop|fallback/i);
});

test("Codex Desktop coherence report treats app-server-only matches as CLI visible", () => {
  const report = createCodexDesktopCoherenceReport({
    threadId: "thr_cli",
    visibleMap: visibleMapFixture({
      desktopRef: null,
      sessionCardRef: null,
      confidence: 0.42,
      ambiguity: ["no_visible_codex_candidate"],
      reasonCodes: ["app_server_signal", "ambiguous_join"]
    }, {
      visibleCodex: "not_configured"
    }),
    actionEvidence: {
      actionKind: "codex_app_server",
      action: "thread/list metadata probe",
      dryRun: true,
      live: false,
      evidenceId: "ev_app_server_probe"
    },
    now: "2026-07-02T08:00:30.000Z"
  });

  assert.equal(report.state, "cli_visible");
  assert.equal(report.visibility.cli, "proven");
  assert.equal(report.visibility.desktop, "not_seen");
  assert.equal(report.observations.current?.ambiguous, false);
  assert.equal(report.blockers.includes("ambiguous_desktop_join"), false);
  assert.equal(report.reasonCodes.includes("ambiguous_join"), false);
  assert.ok(report.reasonCodes.includes("cli_direct_visible_without_desktop_proof"));
});

test("Codex Desktop coherence report records refresh and restart requirements explicitly", () => {
  const before = visibleMapFixture({ desktopRef: null, evidenceIds: ["ev_before_app_server"] });
  const afterRefresh = visibleMapFixture({
    desktopRef: "visible-window-thread-1",
    evidenceIds: ["ev_after_refresh_visible"],
    reasonCodes: ["visible_codex_candidate", "app_server_signal", "indexed_session_card"],
    freshness: {
      indexedUpdatedAt: "2026-07-02T07:58:00.000Z",
      appServerUpdatedAt: "2026-07-02T07:59:00.000Z",
      visibleUpdatedLabel: "just now",
      freshestSource: "visible_codex"
    }
  });

  const refreshReport = createCodexDesktopCoherenceReport({
    threadId: "thr_cli",
    beforeMap: before,
    afterMap: afterRefresh,
    refreshKind: "desktop_refresh",
    now: "2026-07-02T08:01:00.000Z"
  });

  assert.equal(refreshReport.state, "desktop_refresh_required");
  assert.equal(refreshReport.visibility.desktop, "refresh_required");
  assert.equal(refreshReport.observations.before?.desktopVisible, false);
  assert.equal(refreshReport.observations.after?.desktopVisible, true);
  assert.deepEqual(refreshReport.evidenceIds, ["ev_before_app_server", "ev_after_refresh_visible"]);

  const restartReport = createCodexDesktopCoherenceReport({
    threadId: "thr_cli",
    beforeMap: before,
    afterMap: afterRefresh,
    refreshKind: "desktop_restart",
    now: "2026-07-02T08:02:00.000Z"
  });

  assert.equal(restartReport.state, "desktop_restart_required");
  assert.equal(restartReport.visibility.desktop, "restart_required");
});

test("Codex Desktop coherence report degrades ambiguous or missing joins to unknown", () => {
  const report = createCodexDesktopCoherenceReport({
    sourceRef: "codex_thread:thr_cli",
    visibleMap: visibleMapFixture({
      desktopRef: "visible-ambiguous",
      confidence: 0.42,
      ambiguity: ["multiple_indexed_title_matches"],
      reasonCodes: ["visible_codex_candidate", "ambiguous_join"],
      evidenceIds: ["ev_ambiguous"]
    }),
    now: "2026-07-02T08:03:00.000Z"
  });

  assert.equal(report.state, "unknown");
  assert.equal(report.visibility.cli, "ambiguous");
  assert.equal(report.visibility.desktop, "ambiguous");
  assert.ok(report.blockers.includes("ambiguous_desktop_join"));
  assert.ok(report.reasonCodes.includes("ambiguous_join"));
  assert.equal(report.confidence < 0.5, true);
  assert.doesNotMatch(JSON.stringify(report), /\/Users\/lume|\/Volumes\/LEXAR|sk-test_1234567890/);
});

test("MCP exposes #307 Codex Desktop coherence tool without performing live actions", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-coherence-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  try {
    const tools = createLooTools({
      db,
      audit,
      codexClient: { request: async () => ({ ok: true }) }
    });
    const tool = tools.find((candidate) => candidate.name === "loo_codex_desktop_coherence");
    assert.ok(tool, "loo_codex_desktop_coherence should be registered");

    const report = await tool.execute({
      thread_id: "thr_cli",
      visible_map: visibleMapFixture({ desktopRef: null }),
      action_evidence: {
        actionKind: "cli",
        action: "codex thread list",
        dryRun: true,
        live: false
      }
    });

    assert.equal((report as { publicSafe?: boolean }).publicSafe, true);
    assert.equal((report as { state?: string }).state, "cli_visible");
    assert.equal((report as { actionsPerformed?: { liveCodexControlRun?: boolean } }).actionsPerformed?.liveCodexControlRun, false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
