import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  captureCloseoutHookPacket,
  captureCompactionMarkerHookPacket,
  createDatabase,
  runStatePrepHook
} from "../packages/core/src/index.js";

const rawTranscriptPath = "/Users/lume/.codex/sessions/2026/07/04/raw-thread.jsonl";
const rawToken = "npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";

function closeoutMessage(): string {
  return [
    "Final: hook sidecar capture complete.",
    "<loo_closeout>",
    "Project: lossless-openclaw-orchestrator",
    "Status: complete",
    "Priority: high",
    "Owner: codex",
    "Blocker: none",
    "Next action: open the #412 PR after focused validation",
    "Closeout state: complete",
    "Proposed plan completion: complete",
    "Source refs: codex_thread:019f-hook-sidecar",
    "</loo_closeout>",
    `Do not leak ${rawTranscriptPath} or ${rawToken}.`
  ].join("\n");
}

test("closeout hook sidecar writes idempotent public-safe derived-cache packets", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-hook-closeout-"));
  try {
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const first = captureCloseoutHookPacket(db, {
        threadId: "019f-hook-sidecar",
        turnId: "turn-1",
        eventId: "event-1",
        transcriptPath: rawTranscriptPath,
        lastAssistantMessage: closeoutMessage()
      });
      const second = captureCloseoutHookPacket(db, {
        threadId: "019f-hook-sidecar",
        turnId: "turn-1",
        eventId: "event-1",
        transcriptPath: rawTranscriptPath,
        lastAssistantMessage: closeoutMessage()
      });
      const serialized = JSON.stringify(first);
      const rowCount = (db.prepare("SELECT COUNT(*) AS count FROM hook_capture_packets").get() as { count: number }).count;

      assert.equal(first.publicSafe, true);
      assert.equal(first.readOnly, false);
      assert.deepEqual(first.mutationClasses, ["derived_cache"]);
      assert.equal(first.inserted, true);
      assert.equal(second.inserted, false);
      assert.equal(second.packet.packetId, first.packet.packetId);
      assert.equal(rowCount, 1);
      assert.equal(first.packet.hookKind, "closeout_capture");
      assert.equal(first.packet.targetRef, "codex_thread:019f-hook-sidecar");
      assert.equal(first.packet.payload.transcriptPathRedacted, true);
      assert.match(first.packet.payload.transcriptPathHash, /^[0-9a-f]{32}$/);
      assert.equal(first.packet.payload.messagePreview, null);
      assert.equal(first.packet.payload.messageRedacted, true);
      assert.match(first.packet.payload.messageHash ?? "", /^[0-9a-f]{32}$/);
      assert.equal(first.packet.payload.closeout?.text, null);
      assert.equal(first.packet.payload.closeout?.textRedacted, true);
      assert.match(first.packet.payload.closeout?.textHash ?? "", /^[0-9a-f]{32}$/);
      assert.match(first.packet.payload.closeout?.omissions.join(","), /closeout_text_hash_only/);
      assert.equal(first.actionsPerformed.derivedCacheWrite, true);
      assert.equal(first.actionsPerformed.codexMutation, false);
      assert.equal(first.actionsPerformed.sourceStoreMutation, false);
      assert.equal(first.actionsPerformed.externalWrite, false);
      assert.equal(first.actionsPerformed.liveControl, false);
      assert.equal(first.actionsPerformed.guiMutation, false);
      assert.equal(first.actionsPerformed.rawTranscriptRead, false);
      assert.equal(first.actionsPerformed.modelCompactionRun, false);
      assert.equal(first.actionsPerformed.trueCompactionSummaryCaptured, false);
      assert.doesNotMatch(serialized, /\/Users\/lume|raw-thread\.jsonl|npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456/);
      assert.doesNotMatch(serialized, /Final: hook sidecar capture complete|<loo_closeout>|<\/loo_closeout>|Do not leak/);
      assert.match(first.packet.payload.omissions.join(","), /transcript_path_hash_only/);
      assert.match(first.packet.payload.omissions.join(","), /message_hash_only/);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compaction hook records marker lifecycle only without true summary-capture claims", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-hook-compaction-"));
  try {
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const report = captureCompactionMarkerHookPacket(db, {
        threadId: "019f-hook-sidecar",
        mode: "marker",
        lifecycle: "pre_compact",
        transcriptPath: rawTranscriptPath,
        markerNote: `PreCompact marker before ${rawTranscriptPath}`,
        summary: `This raw summary-shaped value must not be captured ${rawToken}.`
      });
      const serialized = JSON.stringify(report);

      assert.equal(report.publicSafe, true);
      assert.equal(report.packet.hookKind, "compaction_marker");
      assert.equal(report.packet.payload.mode, "marker");
      assert.equal(report.packet.payload.lifecycle, "pre_compact");
      assert.equal(report.actionsPerformed.trueCompactionSummaryCaptured, false);
      assert.equal(report.actionsPerformed.modelCompactionRun, false);
      assert.equal(report.packet.payload.summaryCaptured, false);
      assert.equal(report.blockers.length, 0);
      assert.doesNotMatch(serialized, /raw summary-shaped value|\/Users\/lume|raw-thread\.jsonl|npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456/);
      assert.match(report.proofBoundary, /Codex-native/i);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("closeout hook flags truncated closeout payloads where fields may be incomplete", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-hook-closeout-truncated-"));
  try {
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const longCloseout = [
        "<loo_closeout>",
        `Status: ${"padding ".repeat(260)}`,
        "Next action: this field is intentionally beyond the 1800 char capture boundary",
        "</loo_closeout>"
      ].join("\n");
      const report = captureCloseoutHookPacket(db, {
        threadId: "019f-hook-truncated",
        lastAssistantMessage: longCloseout
      });

      assert.equal(report.packet.payload.closeout?.present, true);
      assert.equal(report.packet.payload.closeout?.truncated, true);
      assert.deepEqual(report.packet.payload.closeout?.omissions, ["closeout_text_hash_only", "closeout_text_truncated"]);
      assert.equal(report.packet.payload.closeout?.text, null);
      assert.match(report.packet.payload.closeout?.textHash ?? "", /^[0-9a-f]{32}$/);
      assert.equal(report.packet.payload.closeout?.fields.next_action, "this field is intentionally beyond the 1800 char capture boundary");
      assert.match(report.packet.payload.omissions.join(","), /closeout_text_truncated/);
      assert.match(report.packet.reasonCodes.join(","), /closeout_text_truncated/);
      assert.equal(report.blockers.length, 0);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("closeout hook reuses latest balanced attributed envelope semantics", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-hook-closeout-parser-"));
  try {
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const report = captureCloseoutHookPacket(db, {
        threadId: "019f-hook-parser",
        lastAssistantMessage: [
          "<loo_closeout version=\"old\">",
          "Status: stale",
          "Next action: ignore older envelope",
          "</loo_closeout>",
          "intervening text",
          "<loo_closeout version=\"current\" source=\"hook\">",
          "Status: complete",
          "Next action: use latest attributed envelope",
          "</loo_closeout>"
        ].join("\n")
      });

      assert.equal(report.packet.payload.closeout?.present, true);
      assert.equal(report.packet.payload.closeout?.fields.status, "complete");
      assert.equal(report.packet.payload.closeout?.fields.next_action, "use latest attributed envelope");
      assert.doesNotMatch(JSON.stringify(report), /ignore older envelope|<loo_closeout/);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hook redaction covers common Linux and sensitive transcript path roots", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-hook-path-redaction-"));
  try {
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const linuxTranscriptPath = "/mnt/workspace/.codex/sessions/2026/raw-thread.jsonl";
      const report = captureCloseoutHookPacket(db, {
        threadId: "019f-hook-linux-paths",
        transcriptPath: linuxTranscriptPath,
        lastAssistantMessage: [
          "<loo_closeout>",
          "Status: complete",
          "Blocker: none",
          "Next action: inspect /data/lco/transcript/raw.jsonl and /opt/codex/sessions/session.jsonl",
          "</loo_closeout>",
          "Also never leak /srv/lco/sessions/hidden.jsonl or /etc/codex/transcript.secret"
        ].join("\n")
      });
      const serialized = JSON.stringify(report);

      assert.equal(report.publicSafe, true);
      assert.equal(report.blockers.length, 0);
      assert.doesNotMatch(serialized, /\/mnt\/workspace|\/data\/lco|\/opt\/codex|\/srv\/lco|\/etc\/codex|raw-thread\.jsonl|hidden\.jsonl|transcript\.secret/);
      assert.match(serialized, /<redacted-local-path>/);
      assert.equal(report.packet.payload.transcriptPathRedacted, true);
      assert.match(report.packet.payload.transcriptPathHash ?? "", /^[0-9a-f]{32}$/);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("closeout transcript path fields are redacted without false strict blockers", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-hook-transcript-field-"));
  try {
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const report = captureCloseoutHookPacket(db, {
        threadId: "019f-hook-transcript-field",
        lastAssistantMessage: [
          "<loo_closeout>",
          "Status: complete",
          "Transcript path: /data/lco/transcript/raw.jsonl",
          "Next action: continue with public-safe hook packet",
          "</loo_closeout>"
        ].join("\n")
      });
      const serialized = JSON.stringify(report);

      assert.equal(report.blockers.length, 0);
      assert.equal(report.packet.payload.closeout?.fields.transcript_path, "<redacted-local-path>");
      assert.doesNotMatch(serialized, /\/data\/lco|raw\.jsonl|raw_transcript_path_key/);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("state-prep hook writes a bounded job from prepared state only", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-hook-state-prep-"));
  try {
    const db = createDatabase(join(root, "orchestrator.sqlite"));
    try {
      const report = runStatePrepHook(db, {
        threadId: "019f-hook-sidecar",
        limit: 2,
        payload: {
          lastAssistantMessage: `Ignore this raw hook payload ${rawToken} ${rawTranscriptPath}`
        }
      });
      const serialized = JSON.stringify(report);
      const rowCount = (db.prepare("SELECT COUNT(*) AS count FROM state_prep_jobs").get() as { count: number }).count;

      assert.equal(report.publicSafe, true);
      assert.equal(report.readOnly, false);
      assert.deepEqual(report.mutationClasses, ["derived_cache"]);
      assert.equal(rowCount, 1);
      assert.equal(report.actionsPerformed.derivedCacheWrite, true);
      assert.equal(report.actionsPerformed.rawTranscriptRead, false);
      assert.equal(report.actionsPerformed.codexMutation, false);
      assert.equal(report.actionsPerformed.externalWrite, false);
      assert.equal(report.packet.preparedState.status.sourceCoverage.summaryLeaves, "not_configured");
      assert.equal(report.packet.preparedCards.cards.length, 0);
      assert.equal(report.packet.preparedInbox.items.length, 0);
      assert.doesNotMatch(serialized, /Ignore this raw hook payload|\/Users\/lume|raw-thread\.jsonl|npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456/);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI hook commands write sanitized evidence for closeout state prep and compaction markers", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-hook-cli-"));
  try {
    const dbPath = join(root, "orchestrator.sqlite");
    const payloadPath = join(root, "payload.json");
    const compactionPayloadPath = join(root, "compaction-payload.json");
    const closeoutEvidencePath = join(root, "hook-closeout.json");
    const statePrepEvidencePath = join(root, "hook-state-prep.json");
    const compactionEvidencePath = join(root, "hook-compaction.json");
    writeFileSync(payloadPath, `${JSON.stringify({
      thread_id: "019f-hook-sidecar-cli",
      turn_id: "turn-cli",
      event_id: "event-cli",
      transcript_path: rawTranscriptPath,
      last_assistant_message: closeoutMessage()
    })}\n`);
    writeFileSync(compactionPayloadPath, `${JSON.stringify({
      thread_id: "019f-hook-sidecar-cli",
      turn_id: "turn-cli",
      event_id: "event-cli-precompact",
      transcript_path: rawTranscriptPath,
      mode: "marker",
      lifecycle: "pre_compact",
      marker_note: `PreCompact marker before ${rawTranscriptPath}`,
      summary: `Do not capture this summary-shaped payload ${rawToken}.`
    })}\n`);

    const closeoutResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "hook",
      "closeout-capture",
      "--payload-file",
      payloadPath,
      "--evidence-path",
      closeoutEvidencePath,
      "--strict"
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        LOO_DB_PATH: dbPath
      }
    });
    const statePrepResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "hook",
      "state-prep",
      "--payload-json",
      JSON.stringify({ thread_id: "019f-hook-sidecar-cli", last_assistant_message: `Ignore ${rawTranscriptPath} ${rawToken}` }),
      "--evidence-path",
      statePrepEvidencePath,
      "--strict"
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        LOO_DB_PATH: dbPath
      }
    });
    const compactionResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "hook",
      "compaction-capture",
      "--payload-file",
      compactionPayloadPath,
      "--summary",
      `Do not capture this CLI summary-shaped payload ${rawToken}.`,
      "--evidence-path",
      compactionEvidencePath,
      "--strict"
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        LOO_DB_PATH: dbPath
      }
    });

    assert.equal(closeoutResult.status, 0, closeoutResult.stderr);
    assert.equal(statePrepResult.status, 0, statePrepResult.stderr);
    assert.equal(compactionResult.status, 0, compactionResult.stderr);
    assert.equal(existsSync(closeoutEvidencePath), true);
    assert.equal(existsSync(statePrepEvidencePath), true);
    assert.equal(existsSync(compactionEvidencePath), true);
    const stdoutReport = JSON.parse(closeoutResult.stdout) as ReturnType<typeof captureCloseoutHookPacket>;
    const closeoutEvidence = readFileSync(closeoutEvidencePath, "utf8");
    const statePrepEvidence = readFileSync(statePrepEvidencePath, "utf8");
    const compactionEvidence = readFileSync(compactionEvidencePath, "utf8");
    const statePrepReport = JSON.parse(statePrepResult.stdout) as ReturnType<typeof runStatePrepHook>;
    const compactionReport = JSON.parse(compactionResult.stdout) as ReturnType<typeof captureCompactionMarkerHookPacket>;
    assert.equal(stdoutReport.publicSafe, true);
    assert.equal(stdoutReport.packet.targetRef, "codex_thread:019f-hook-sidecar-cli");
    assert.equal(statePrepReport.job.targetRef, "codex_thread:019f-hook-sidecar-cli");
    assert.equal(statePrepReport.packet.targetRef, "codex_thread:019f-hook-sidecar-cli");
    assert.equal(compactionReport.packet.payload.summaryCaptured, false);
    assert.match(compactionReport.packet.payload.omissions.join(","), /summary_payload_not_captured_marker_mode/);
    for (const output of [closeoutResult.stdout, statePrepResult.stdout, compactionResult.stdout, closeoutEvidence, statePrepEvidence, compactionEvidence]) {
      assert.doesNotMatch(output, /\/Users\/lume|raw-thread\.jsonl|npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456|summary-shaped payload|CLI summary-shaped/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
