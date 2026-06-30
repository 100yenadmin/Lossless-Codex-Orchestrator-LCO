import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writePassingDemoEvidence(evidenceDir: string): string {
  const liveControlProof = join(evidenceDir, "approved-live-control-smoke.json");
  writeJson(join(evidenceDir, "index-codex.json"), {
    indexedFiles: 125,
    skippedFiles: 0,
    indexedThreads: 125,
    indexedEvents: 1200,
    limitedFiles: [],
    errors: []
  });
  writeJson(join(evidenceDir, "plans-search.json"), [
    { sourceRef: "codex_thread:plan-thread", threadId: "plan-thread", snippet: "Proposed plan" }
  ]);
  writeJson(join(evidenceDir, "finals-search.json"), [
    { sourceRef: "codex_thread:final-thread", threadId: "final-thread", snippet: "Final message" }
  ]);
  writeJson(join(evidenceDir, "expand-brief.json"), {
    sourceKind: "codex_thread",
    sourceRef: "codex_thread:plan-thread",
    text: "Metadata\nFinal message\nProposed plan\nTouched files",
    profile: { name: "brief" },
    tokenBudget: 1000
  });
  writeJson(join(evidenceDir, "expand-evidence.json"), {
    sourceKind: "codex_thread",
    sourceRef: "codex_thread:final-thread",
    text: "Metadata\nFinal message\nProposed plan\nTouched files\nSafe summary",
    profile: { name: "evidence" },
    tokenBudget: 4000
  });
  writeJson(join(evidenceDir, "control-dry-run.json"), {
    action: "send",
    threadId: "plan-thread",
    live: false,
    approvalAuditId: "loo_audit_test",
    paramsHash: "a".repeat(64),
    messageHash: "b".repeat(64)
  });
  writeJson(liveControlProof, {
    kind: "loo_approved_live_control_smoke",
    approvedLiveControlSmoke: true,
    action: "send",
    targetRef: "codex_thread:plan-thread",
    approvalAuditId: "loo_audit_test",
    messageHash: "b".repeat(64),
    preservesCodexApprovalSemantics: true,
    rawPromptIncluded: false
  });
  return liveControlProof;
}

test("release demo-status reports demo blockers without performing gated actions", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-demo-status-missing-"));
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "demo-status",
    "--evidence-dir",
    evidenceDir
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    ok?: boolean;
    demoReady?: boolean;
    demoStatusManifestPath?: string;
    blockers?: string[];
    actionsPerformed?: {
      liveCodexControlRun?: boolean;
      desktopGuiActionRun?: boolean;
      npmPublished?: boolean;
      githubReleaseCreated?: boolean;
    };
  };

  assert.equal(payload.ok, false);
  assert.equal(payload.demoReady, false);
  assert.equal(payload.demoStatusManifestPath, join(evidenceDir, "release-demo-status.json"));
  assert.deepEqual(payload.actionsPerformed, {
    liveCodexControlRun: false,
    desktopGuiActionRun: false,
    npmPublished: false,
    githubReleaseCreated: false
  });
  assert.deepEqual(payload.blockers, [
    "codex_index_min_sessions_missing",
    "codex_index_errors_present",
    "codex_index_limited_files_present",
    "plan_search_evidence_missing",
    "final_search_evidence_missing",
    "brief_expansion_evidence_missing",
    "evidence_expansion_evidence_missing",
    "control_dry_run_evidence_missing",
    "approved_live_control_smoke_missing"
  ]);
  assert.equal(existsSync(join(evidenceDir, "release-demo-status.json")), true);
});

test("release demo-status --strict fails closed while required proof is missing", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-demo-status-strict-"));
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "demo-status",
    "--evidence-dir",
    evidenceDir,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { demoReady?: boolean; blockers?: string[] };
  assert.equal(payload.demoReady, false);
  assert.equal(payload.blockers?.includes("approved_live_control_smoke_missing"), true);
});

test("release demo-status accepts public-safe demo evidence and optional live-control proof", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-demo-status-ready-"));
  const liveControlProof = writePassingDemoEvidence(evidenceDir);

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "demo-status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    liveControlProof,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    ok?: boolean;
    demoReady?: boolean;
    blockers?: string[];
    checks?: Record<string, { ok: boolean }>;
    actionsPerformed?: {
      liveCodexControlRun?: boolean;
      desktopGuiActionRun?: boolean;
      npmPublished?: boolean;
      githubReleaseCreated?: boolean;
    };
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.demoReady, true);
  assert.deepEqual(payload.blockers, []);
  assert.equal(payload.checks?.indexedSessions?.ok, true);
  assert.equal(payload.checks?.approvedLiveControl?.ok, true);
  assert.deepEqual(payload.actionsPerformed, {
    liveCodexControlRun: false,
    desktopGuiActionRun: false,
    npmPublished: false,
    githubReleaseCreated: false
  });
});

test("release demo-status --claim-scope codex-read-search-expand-dry-run accepts dry-run demo evidence without live-control proof", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-demo-status-read-scope-"));
  const liveControlProof = writePassingDemoEvidence(evidenceDir);
  unlinkSync(liveControlProof);

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "demo-status",
    "--evidence-dir",
    evidenceDir,
    "--claim-scope",
    "codex-read-search-expand-dry-run",
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    claimScope?: string;
    demoReady?: boolean;
    blockers?: string[];
    excludedClaims?: Array<{ id: string; blockerIfClaimed: string }>;
    checks?: Record<string, { ok: boolean; detail: string }>;
  };

  assert.equal(payload.claimScope, "codex-read-search-expand-dry-run");
  assert.equal(payload.demoReady, true);
  assert.deepEqual(payload.blockers, []);
  assert.equal(payload.checks?.approvedLiveControl?.ok, false);
  assert.match(payload.checks?.approvedLiveControl?.detail ?? "", /excluded by claim scope/i);
  assert.deepEqual(payload.excludedClaims, [
    { id: "approved_live_control_smoke", blockerIfClaimed: "approved_live_control_smoke_missing" }
  ]);
});

test("release demo-status accepts documented MCP plan and final text outputs", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-demo-status-mcp-text-"));
  const liveControlProof = writePassingDemoEvidence(evidenceDir);
  writeJson(join(evidenceDir, "plans-search.json"), [
    {
      threadId: "plan-thread",
      text: "- Add fixture coverage\n- Run focused validation"
    }
  ]);
  writeJson(join(evidenceDir, "finals-search.json"), [
    {
      thread_id: "final-thread",
      text: "Done."
    }
  ]);

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "demo-status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    liveControlProof,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { blockers?: string[]; checks?: Record<string, { ok: boolean }> };
  assert.deepEqual(payload.blockers, []);
  assert.equal(payload.checks?.planSearch?.ok, true);
  assert.equal(payload.checks?.finalSearch?.ok, true);
});

test("release demo-status matches Codex adapter action names to approved proof", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-demo-status-action-"));
  const liveControlProof = writePassingDemoEvidence(evidenceDir);
  writeJson(join(evidenceDir, "control-dry-run.json"), {
    action: "codex_send_message",
    threadId: "plan-thread",
    live: false,
    approvalAuditId: "loo_audit_test",
    paramsHash: "a".repeat(64),
    messageHash: "b".repeat(64)
  });

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "demo-status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    liveControlProof,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { blockers?: string[]; checks?: Record<string, { ok: boolean }> };
  assert.deepEqual(payload.blockers, []);
  assert.equal(payload.checks?.controlDryRun?.ok, true);
  assert.equal(payload.checks?.approvedLiveControlMatchesDryRun?.ok, true);
});

test("release demo-status resolves relative approval proof paths from the evidence directory", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-demo-status-relative-"));
  writePassingDemoEvidence(evidenceDir);

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "demo-status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    "approved-live-control-smoke.json",
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { demoReady?: boolean; blockers?: string[] };
  assert.equal(payload.demoReady, true);
  assert.deepEqual(payload.blockers, []);
});

test("release demo-status counts warm-cache skipped Codex session files", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-demo-status-skipped-"));
  const liveControlProof = writePassingDemoEvidence(evidenceDir);
  writeJson(join(evidenceDir, "index-codex.json"), {
    indexedFiles: 0,
    skippedFiles: 125,
    indexedThreads: 0,
    indexedEvents: 0,
    limitedFiles: [],
    errors: []
  });

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "demo-status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    liveControlProof,
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { checks?: Record<string, { ok: boolean }>; blockers?: string[] };
  assert.equal(payload.checks?.indexedSessions?.ok, true);
  assert.deepEqual(payload.blockers, []);
});

test("release demo-status rejects raw artifacts and malformed dry-run proof", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-demo-status-raw-"));
  const liveControlProof = writePassingDemoEvidence(evidenceDir);
  writeFileSync(join(evidenceDir, "session.jsonl"), "{}\n");
  writeFileSync(join(evidenceDir, "compressed-session.jsonl.gz"), "compressed private transcript");
  writeJson(join(evidenceDir, "control-dry-run.json"), {
    action: "send",
    threadId: "plan-thread",
    live: true,
    approvalAuditId: "loo_audit_test"
  });

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "demo-status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    liveControlProof
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    demoReady?: boolean;
    blockers?: string[];
    rawSessionArtifacts?: Array<{ name: string; reason: string }>;
  };
  assert.equal(payload.demoReady, false);
  assert.equal(payload.blockers?.includes("control_dry_run_evidence_missing"), true);
  assert.equal(payload.blockers?.includes("raw_session_artifacts_present"), true);
  assert.deepEqual(payload.rawSessionArtifacts, [
    { name: "compressed-session.jsonl.gz", reason: "raw_codex_jsonl" },
    { name: "session.jsonl", reason: "raw_codex_jsonl" }
  ]);
  assert.match(read(join(evidenceDir, "release-demo-status.json")), /raw_session_artifacts_present/);
});

test("release demo-status rejects proof gaps that would overstate demo readiness", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-demo-status-gaps-"));
  const liveControlProof = writePassingDemoEvidence(evidenceDir);
  writeJson(join(evidenceDir, "plans-search.json"), [
    { sourceRef: "codex_thread:plan-thread", threadId: "plan-thread", snippet: "Unrelated thread map row" }
  ]);
  writeJson(join(evidenceDir, "finals-search.json"), [
    { sourceRef: "codex_thread:final-thread", threadId: "final-thread", snippet: "Unrelated thread map row" }
  ]);
  writeJson(join(evidenceDir, "expand-brief.json"), {
    sourceKind: "codex_thread",
    sourceRef: "codex_thread:plan-thread",
    text: "ok",
    profile: { name: "brief" },
    tokenBudget: 1000
  });
  writeJson(join(evidenceDir, "control-dry-run.json"), {
    action: "send",
    threadId: "plan-thread",
    live: false,
    approvalAuditId: "loo_audit_test",
    paramsHash: "a".repeat(64)
  });

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "demo-status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    liveControlProof
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { demoReady?: boolean; blockers?: string[] };
  assert.equal(payload.demoReady, false);
  assert.equal(payload.blockers?.includes("plan_search_evidence_missing"), true);
  assert.equal(payload.blockers?.includes("final_search_evidence_missing"), true);
  assert.equal(payload.blockers?.includes("brief_expansion_evidence_missing"), true);
  assert.equal(payload.blockers?.includes("control_dry_run_evidence_missing"), true);
});

test("release demo-status rejects nested raw artifacts and mismatched approval proof", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-demo-status-nested-"));
  const liveControlProof = writePassingDemoEvidence(evidenceDir);
  mkdirSync(join(evidenceDir, "raw"));
  writeFileSync(join(evidenceDir, "raw", "session.jsonl"), "{}\n");
  writeJson(liveControlProof, {
    kind: "loo_approved_live_control_smoke",
    approvedLiveControlSmoke: true,
    action: "send",
    targetRef: "codex_thread:different-thread",
    approvalAuditId: "loo_audit_different",
    messageHash: "sha256:different",
    preservesCodexApprovalSemantics: true,
    rawPromptIncluded: false
  });

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "demo-status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    liveControlProof
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    demoReady?: boolean;
    blockers?: string[];
    rawSessionArtifacts?: Array<{ name: string; reason: string }>;
  };
  assert.equal(payload.demoReady, false);
  assert.equal(payload.blockers?.includes("raw_session_artifacts_present"), true);
  assert.equal(payload.blockers?.includes("approved_live_control_dry_run_mismatch"), true);
  assert.deepEqual(payload.rawSessionArtifacts, [{ name: "raw/session.jsonl", reason: "raw_codex_jsonl" }]);
});

test("release demo-status rejects SQLite sidecar evidence artifacts", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-demo-status-sidecars-"));
  const liveControlProof = writePassingDemoEvidence(evidenceDir);
  writeFileSync(join(evidenceDir, "orchestrator.sqlite-wal"), "private pages");
  writeFileSync(join(evidenceDir, "orchestrator.sqlite-shm"), "private pages");
  writeFileSync(join(evidenceDir, "orchestrator.db-journal"), "private pages");

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "demo-status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    liveControlProof
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    demoReady?: boolean;
    blockers?: string[];
    rawSessionArtifacts?: Array<{ name: string; reason: string }>;
  };
  assert.equal(payload.demoReady, false);
  assert.equal(payload.blockers?.includes("raw_session_artifacts_present"), true);
  assert.deepEqual(payload.rawSessionArtifacts, [
    { name: "orchestrator.db-journal", reason: "sqlite_database" },
    { name: "orchestrator.sqlite-shm", reason: "sqlite_database" },
    { name: "orchestrator.sqlite-wal", reason: "sqlite_database" }
  ]);
});

test("release demo-status requires brief and evidence expansion refs to be distinct", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-demo-status-distinct-expansions-"));
  const liveControlProof = writePassingDemoEvidence(evidenceDir);
  writeJson(join(evidenceDir, "expand-evidence.json"), {
    sourceKind: "codex_thread",
    sourceRef: "codex_thread:plan-thread",
    text: "Metadata\nFinal message\nProposed plan\nTouched files\nSafe summary",
    profile: { name: "evidence" },
    tokenBudget: 4000
  });

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "demo-status",
    "--evidence-dir",
    evidenceDir,
    "--approved-live-control-evidence",
    liveControlProof
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { demoReady?: boolean; blockers?: string[]; checks?: Record<string, { ok: boolean }> };
  assert.equal(payload.demoReady, false);
  assert.equal(payload.checks?.distinctExpansionRefs?.ok, false);
  assert.equal(payload.blockers?.includes("expansion_refs_not_distinct"), true);
});
