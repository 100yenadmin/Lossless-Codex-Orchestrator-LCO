import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createScenarioSweep } from "../packages/cli/src/scenario-sweep.js";

type CompactionPacketFixture = {
  packet_kind?: unknown;
  source?: unknown;
  lifecycle?: unknown;
  claim?: unknown;
  summaryCaptured?: unknown;
  summaryHash?: unknown;
  summaryExcerpt?: unknown;
  excerptCharLimit?: unknown;
  tokenCount?: unknown;
  sourceRefs?: unknown;
  omitted?: unknown;
  mutationClasses?: unknown;
  storage?: unknown;
  createsAdvisorySummaryLeaf?: unknown;
  rejected?: unknown;
  disallowedFields?: unknown;
};

type CompactionProposalScenario = {
  id?: unknown;
  surface?: unknown;
  user_task?: unknown;
  allowed_tools?: unknown;
  forbidden_behaviors?: unknown;
  expected_public_safe_evidence?: unknown;
  private_data_exclusions?: unknown;
  metrics?: Record<string, unknown>;
  proof_boundary?: unknown;
  packet_fixtures?: {
    outside_codex_marker?: CompactionPacketFixture;
    sanitized_codex_native_packet?: CompactionPacketFixture;
    rejected_packets?: CompactionPacketFixture[];
  };
};

const proposalDocPath = "docs/CODEX_NATIVE_COMPACTION_CAPTURE.md";
const proposalScenarioPath = join("evals", "scenarios", "v1", "codex-native-compaction-capture-proposal-v1.json");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function readScenario(): CompactionProposalScenario {
  return JSON.parse(read(proposalScenarioPath)) as CompactionProposalScenario;
}

test("Codex-native compaction proposal documents marker-only reality and public claim boundary", () => {
  const proposal = read(proposalDocPath);
  const claimAudit = read("docs/CLAIM_AUDIT.md");

  assert.match(proposal, /PreCompact\/PostCompact/i);
  assert.match(proposal, /cannot honestly capture the generated summary/i);
  assert.match(proposal, /CompactionCaptured/i);
  assert.match(proposal, /enriched `PostCompact`/i);
  assert.match(proposal, /summary hash/i);
  assert.match(proposal, /bounded summary excerpt/i);
  assert.match(proposal, /token count/i);
  assert.match(proposal, /source refs/i);
  assert.match(proposal, /no-history-rewrite/i);
  assert.match(proposal, /bounded-fragment/i);
  assert.match(proposal, /LCO-owned sidecar/i);
  assert.match(proposal, /public claim remains `compaction observed`/i);
  assert.doesNotMatch(proposal, /public claim.*compaction summary captured/i);
  assert.match(claimAudit, /compaction observed/i);
  assert.match(claimAudit, /Codex-native sanitized/i);
});

test("Codex-native compaction proposal scenario validates marker fixture and sanitized packet fixture", () => {
  const scenario = readScenario();
  const serialized = JSON.stringify(scenario);
  const outsideMarker = scenario.packet_fixtures?.outside_codex_marker;
  const sanitizedPacket = scenario.packet_fixtures?.sanitized_codex_native_packet;
  const rejectedPackets = scenario.packet_fixtures?.rejected_packets ?? [];

  assert.equal(scenario.id, "codex-native-compaction-capture-proposal-v1");
  assert.equal(scenario.surface, "claim-audit");
  assert.match(String(scenario.user_task), /Codex-native.*compaction-summary capture/i);
  assert.deepEqual(scenario.allowed_tools, [
    "loo hook compaction-capture --mode marker",
    "loo_summary_leaves",
    "loo eval scenarios",
    "docs claim audit"
  ]);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /CompactionCaptured/);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /summary hash/);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /bounded excerpt/);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /token count/);
  assert.match(JSON.stringify(scenario.expected_public_safe_evidence), /source refs/);
  assert.match(JSON.stringify(scenario.forbidden_behaviors), /raw_replacement_history/);
  assert.match(JSON.stringify(scenario.forbidden_behaviors), /transcript_path_output/);
  assert.match(JSON.stringify(scenario.forbidden_behaviors), /source_store_mutation/);
  assert.match(JSON.stringify(scenario.forbidden_behaviors), /true_compaction_summary_capture_claim_without_codex_native_packet/);
  assert.equal(scenario.metrics?.requires_outside_codex_marker_observed_only, true);
  assert.equal(scenario.metrics?.requires_sanitized_summary_hash_excerpt_token_refs, true);
  assert.equal(scenario.metrics?.requires_advisory_summary_leaf_only, true);
  assert.equal(scenario.metrics?.requires_reject_raw_replacement_history_packet, true);
  assert.equal(scenario.metrics?.requires_reject_transcript_path_packet, true);
  assert.equal(scenario.metrics?.max_raw_transcript_spans, 0);
  assert.equal(scenario.metrics?.max_raw_transcript_paths, 0);
  assert.equal(scenario.metrics?.max_raw_replacement_history_items, 0);

  assert.equal(outsideMarker?.source, "outside_codex_hook_sidecar");
  assert.equal(outsideMarker?.claim, "compaction observed");
  assert.equal(outsideMarker?.summaryCaptured, false);
  assert.equal(outsideMarker?.summaryHash, null);
  assert.equal(outsideMarker?.summaryExcerpt, null);
  assert.equal(outsideMarker?.tokenCount, null);
  assert.match(JSON.stringify(outsideMarker?.omitted), /generated_summary_unavailable_outside_codex/);

  assert.equal(sanitizedPacket?.packet_kind, "CompactionCaptured");
  assert.equal(sanitizedPacket?.source, "codex_native");
  assert.match(String(sanitizedPacket?.summaryHash), /^sha256:[0-9a-f]{64}$/);
  assert.equal(typeof sanitizedPacket?.summaryExcerpt, "string");
  assert.equal(sanitizedPacket?.excerptCharLimit, 240);
  assert.equal(typeof sanitizedPacket?.tokenCount, "number");
  assert.equal(sanitizedPacket?.createsAdvisorySummaryLeaf, true);
  assert.deepEqual(sanitizedPacket?.mutationClasses, ["derived_cache"]);
  assert.equal(sanitizedPacket?.storage, "lco_sidecar_only");
  assert.match(JSON.stringify(sanitizedPacket?.sourceRefs), /codex_(?:range|event):/);
  assert.match(JSON.stringify(sanitizedPacket?.omitted), /raw_replacement_history/);
  assert.match(JSON.stringify(sanitizedPacket?.omitted), /transcript_path/);

  assert.equal(rejectedPackets.length, 2);
  assert.equal(rejectedPackets.every((packet) => packet.rejected === true), true);
  assert.match(JSON.stringify(rejectedPackets), /rawReplacementHistory/);
  assert.match(JSON.stringify(rejectedPackets), /transcriptPath/);
  assert.doesNotMatch(serialized, /\/Users\/|\/Volumes\/|\.jsonl|state_5\.sqlite|logs_2\.sqlite|npm_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|BEGIN [A-Z ]*PRIVATE KEY/);
});

test("Codex-native compaction proposal scenario remains a dry-run claim-audit contract", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-compaction-proposal-scenario-"));
  try {
    const report = createScenarioSweep({
      evidenceDir,
      scenarioDir: join(process.cwd(), "evals", "scenarios", "v1"),
      scenarioIds: ["codex-native-compaction-capture-proposal-v1"],
      now: "2026-07-04T00:00:00.000Z"
    });

    assert.equal(report.ok, true);
    assert.equal(report.scenarioReady, true);
    assert.equal(report.publicSafe, true);
    assert.equal(report.scenarios.length, 1);
    assert.equal(report.scenarios[0]?.id, "codex-native-compaction-capture-proposal-v1");
    assert.equal(report.scenarios[0]?.status, "dry_run_ready");
    assert.equal(report.actionsPerformed.rawTranscriptRead, false);
    assert.equal(report.actionsPerformed.liveCodexControlRun, false);
    assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
    assert.match(report.scenarios[0]?.proofBoundary ?? "", /does not prove true Codex compaction-summary capture/i);
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test("VISION and 1.2 sprint brief link the Codex-native compaction proposal without widening claims", () => {
  const vision = read("VISION.md");
  const sprintBrief = read("docs/sprints/brief-lco-1.2-prepared-state-summary-leaves-2026-07-03.md");

  for (const [surface, content] of [
    ["VISION.md", vision],
    ["1.2 sprint brief", sprintBrief]
  ] as const) {
    assert.match(content, /docs\/CODEX_NATIVE_COMPACTION_CAPTURE\.md/, `${surface} must link the proposal doc`);
    assert.match(content, /codex-native-compaction-capture-proposal-v1/, `${surface} must link the scenario fixture`);
    assert.match(content, /compaction observed/i, `${surface} must preserve observed-only public claim`);
    assert.match(content, /sanitized/i, `${surface} must require Codex-native sanitized packet support`);
    assert.doesNotMatch(content, /public claim.*compaction summary captured/i, `${surface} must not widen the public claim`);
  }
});
