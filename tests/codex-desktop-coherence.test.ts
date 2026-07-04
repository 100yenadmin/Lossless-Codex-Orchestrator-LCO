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

test("Codex Desktop coherence report sanitizes supplied map identifiers", () => {
  const report = createCodexDesktopCoherenceReport({
    threadId: "thr_cli",
    visibleMap: visibleMapFixture({
      desktopRef: "/Users/lume/.codex/sessions/raw-window-title",
      evidenceIds: ["npm_secretTokenValue", "/Volumes/LEXAR/private/evidence.json"],
      sourceRef: "codex_thread:thr_cli",
      appServerRef: "codex_app_thread:thr_cli"
    }),
    now: "2026-07-02T08:00:40.000Z"
  });

  const serialized = JSON.stringify(report);
  assert.equal(report.state, "desktop_visible");
  assert.doesNotMatch(serialized, /\/Users\/lume|\/Volumes\/LEXAR|npm_secretTokenValue/);
  assert.equal(report.evidenceIds.every((id) => /^evidence_[A-Za-z0-9]+$/.test(id) || /^[A-Za-z0-9._:-]+$/.test(id)), true);
  assert.equal(report.observations.current?.desktopRefs.every((ref) => !ref.includes("/")), true);
});

test("Codex Desktop coherence report sanitizes supplied action evidence", () => {
  const report = createCodexDesktopCoherenceReport({
    threadId: "thr_cli",
    visibleMap: visibleMapFixture({ desktopRef: null }),
    actionEvidence: {
      actionKind: "codex_app_server",
      action: "thread/read metadata probe with ghp_secretTokenValue123456 and /Users/lume/.codex/sessions/raw.jsonl",
      dryRun: true,
      live: false,
      evidenceId: "github_pat_secretTokenValue1234567890"
    },
    now: "2026-07-02T08:00:50.000Z"
  });

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /ghp_secretTokenValue|github_pat_secretTokenValue|\/Users\/lume|raw\.jsonl/);
  assert.match(report.actionEvidence.action ?? "", /^action_[A-Za-z0-9]+$/);
  assert.match(report.actionEvidence.evidenceId ?? "", /^evidence_[A-Za-z0-9]+$/);
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

  const afterOnlyReport = createCodexDesktopCoherenceReport({
    threadId: "thr_cli",
    afterMap: afterRefresh,
    refreshKind: "desktop_refresh",
    now: "2026-07-02T08:03:00.000Z"
  });

  assert.equal(afterOnlyReport.state, "desktop_visible");
  assert.equal(afterOnlyReport.visibility.desktop, "proven");
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

test("Codex Desktop coherence report treats duplicate exact-target rows as corroborating evidence", () => {
  const map = visibleMapFixture({
    desktopRef: "visible-window-thread-1",
    evidenceIds: ["ev_desktop"],
    reasonCodes: ["visible_codex_candidate"],
    sourceRef: "codex_thread:thr_cli",
    appServerRef: null,
    sessionCardRef: null,
    confidence: 0.82
  });
  map.items.push({
    ...map.items[0]!,
    desktopRef: null,
    appServerRef: "codex_app_thread:thr_cli",
    evidenceIds: ["ev_app_server"],
    reasonCodes: ["app_server_signal"],
    confidence: 0.72
  });

  const report = createCodexDesktopCoherenceReport({
    threadId: "thr_cli",
    visibleMap: map,
    now: "2026-07-02T08:03:30.000Z"
  });

  assert.equal(report.state, "desktop_visible");
  assert.equal(report.visibility.cli, "proven");
  assert.equal(report.visibility.desktop, "proven");
  assert.equal(report.observations.current?.matchedItemCount, 2);
  assert.equal(report.observations.current?.ambiguous, false);
  assert.equal(report.blockers.includes("ambiguous_desktop_join"), false);
});

test("Codex Desktop coherence report waits for post-observation read-state evidence before marking CUA GUI state stale", () => {
  const report = createCodexDesktopCoherenceReport({
    threadId: "019f291c-0dc6-7281-95e1-85bbcaaa9ca1",
    visibleMap: visibleMapFixture({
      desktopRef: null,
      appServerRef: "codex_app_thread:019f291c-0dc6-7281-95e1-85bbcaaa9ca1",
      sourceRef: "codex_thread:019f291c-0dc6-7281-95e1-85bbcaaa9ca1",
      sessionCardRef: "codex_thread:019f291c-0dc6-7281-95e1-85bbcaaa9ca1",
      titleSanitized: "EVA-LCO",
      confidence: 0.78,
      evidenceIds: ["ev_jsonl_ack_0311"],
      reasonCodes: ["app_server_signal", "indexed_session_card"]
    }, {
      visibleCodex: "partial",
      codexAppServer: "ok",
      indexedLco: "ok"
    }),
    actionEvidence: {
      actionKind: "desktop_gui_observation",
      action: "CUA selected target thread, verified composer value, sent prompt, and observed JSONL task_complete ack",
      live: true,
      dryRun: false,
      evidenceId: "ev_cua_lco_ack_0311",
      observedAt: "2026-07-03T20:11:00.000Z"
    },
    now: "2026-07-03T20:12:00.000Z"
  });

  assert.equal(report.state, "unknown");
  assert.equal(report.visibility.cli, "proven");
  assert.equal(report.visibility.desktop, "unknown");
  assert.ok(report.reasonCodes.includes("desktop_gui_observation_supplied"));
  assert.ok(report.reasonCodes.includes("read_state_post_observation_evidence_pending"));
  assert.equal(report.reasonCodes.includes("read_state_stale_after_gui_observation"), false);
  assert.equal(report.blockers.includes("read_state_stale_after_gui_observation"), false);
  assert.match(report.nextAction, /post-observation|read-state|reconcil/i);
  assert.equal(report.actionEvidence.actionKind, "desktop_gui_observation");
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
  assert.equal(report.actionsPerformed.rawTranscriptRead, false);
});

test("Codex Desktop coherence report marks CUA GUI read-state stale only with current post-observation evidence", () => {
  const postObservationMap = visibleMapFixture({
    desktopRef: null,
    appServerRef: "codex_app_thread:019f291c-0dc6-7281-95e1-85bbcaaa9ca1",
    sourceRef: "codex_thread:019f291c-0dc6-7281-95e1-85bbcaaa9ca1",
    sessionCardRef: "codex_thread:019f291c-0dc6-7281-95e1-85bbcaaa9ca1",
    titleSanitized: "EVA-LCO",
    confidence: 0.78,
    evidenceIds: ["ev_jsonl_ack_0311"],
    freshness: {
      indexedUpdatedAt: "2026-07-03T20:10:00.000Z",
      appServerUpdatedAt: "2026-07-03T20:11:30.000Z",
      visibleUpdatedLabel: null,
      freshestSource: "codex_app_server"
    },
    reasonCodes: ["app_server_signal", "indexed_session_card"]
  }, {
    visibleCodex: "partial",
    codexAppServer: "ok",
    indexedLco: "ok"
  });
  postObservationMap.generatedAt = "2026-07-03T20:11:45.000Z";

  const report = createCodexDesktopCoherenceReport({
    threadId: "019f291c-0dc6-7281-95e1-85bbcaaa9ca1",
    visibleMap: postObservationMap,
    actionEvidence: {
      actionKind: "desktop_gui_observation",
      action: "CUA selected target thread, verified composer value, sent prompt, and observed JSONL task_complete ack",
      live: true,
      dryRun: false,
      evidenceId: "ev_cua_lco_ack_0311",
      observedAt: "2026-07-03T20:11:00.000Z"
    },
    now: "2026-07-03T20:12:00.000Z"
  });

  assert.equal(report.state, "gui_persisted_read_state_stale");
  assert.equal(report.visibility.cli, "proven");
  assert.equal(report.visibility.desktop, "not_seen");
  assert.ok(report.reasonCodes.includes("desktop_gui_observation_supplied"));
  assert.ok(report.reasonCodes.includes("read_state_post_observation_evidence_current"));
  assert.ok(report.reasonCodes.includes("read_state_stale_after_gui_observation"));
  assert.ok(report.blockers.includes("read_state_stale_after_gui_observation"));
  assert.equal(report.actionEvidence.actionKind, "desktop_gui_observation");
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
  assert.equal(report.actionsPerformed.rawTranscriptRead, false);
  assert.match(report.proofBoundary, /does not.*send|steer|refresh|restart|select|click|type/i);
});

test("Codex Desktop coherence report rejects mismatched thread targets", () => {
  const report = createCodexDesktopCoherenceReport({
    threadId: "thr_cli_a",
    sourceRef: "codex_thread:thr_cli_b",
    visibleMap: visibleMapFixture({
      desktopRef: "visible-window-thread-b",
      sourceRef: "codex_thread:thr_cli_b",
      sessionCardRef: "codex_thread:thr_cli_b",
      appServerRef: "codex_app_thread:thr_cli_b"
    }),
    now: "2026-07-02T08:03:45.000Z"
  });

  assert.equal(report.state, "unknown");
  assert.equal(report.target.threadId, "thr_cli_a");
  assert.equal(report.target.sourceRef, null);
  assert.ok(report.blockers.includes("mismatched_thread_target"));
  assert.equal(report.visibility.desktop, "unknown");
});

test("Codex Desktop coherence report fails closed on malformed supplied maps", () => {
  const report = createCodexDesktopCoherenceReport({
    threadId: "thr_cli",
    visibleMap: { items: {} } as unknown as VisibleCodexSessionMapReport,
    now: "2026-07-02T08:03:50.000Z"
  });

  assert.equal(report.state, "unknown");
  assert.ok(report.blockers.includes("malformed_visible_map"));
  assert.ok(report.blockers.includes("desktop_coherence_map_missing"));
  assert.equal(report.observations.current?.mapPresent, false);
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

test("MCP generated coherence maps probe the requested app-server thread", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-coherence-probe-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  try {
    const tools = createLooTools({
      db,
      audit,
      codexClient: { request: async () => ({ ok: true }) },
      codexReadClient: {
        async request(method, params) {
          requests.push({ method, params });
          if (method === "thread/list") return {
            ok: true,
            result: {
              data: [{
                id: "thr_recent_other",
                name: "Recent other session",
                updatedAt: 1782960000,
                status: { type: "complete" }
              }]
            }
          };
          if (method === "thread/read") return {
            ok: true,
            result: {
              thread: {
                id: "thr_outside_recent_list",
                name: "Outside recent list",
                status: { type: "running" }
              }
            }
          };
          return { ok: true, result: {} };
        }
      }
    });
    const tool = tools.find((candidate) => candidate.name === "loo_codex_desktop_coherence");
    assert.ok(tool, "loo_codex_desktop_coherence should be registered");

    const report = await tool.execute({
      thread_id: "thr_outside_recent_list",
      include_app_server: true,
      include_visible_snapshot: false,
      limit: 1
    });

    assert.deepEqual(requests.map((request) => request.method), ["thread/list", "thread/read"]);
    assert.equal(requests[1]?.params.threadId, "thr_outside_recent_list");
    assert.equal(requests[1]?.params.includeTurns, false);
    assert.equal((report as { state?: string }).state, "cli_visible");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
