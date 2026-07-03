import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { createRuntimeProofIssuePacket } from "../packages/cli/src/runtime-issue-packet.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("runtime proof issue packet converts failed proof into public-safe GitHub handoff", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-runtime-issue-packet-"));
  const evidenceDir = join(root, "evidence");
  const failureReport = join(root, "failed-runtime-proof.json");
  writeJson(failureReport, {
    ok: false,
    scenarioReady: false,
    claimScope: "codex-working-app-proof",
    blockers: [
      "runtime_proof_missing:openclaw-gateway-live-codex-v1-1:installed_gateway_path",
      "openclaw_gateway_credentials_required"
    ],
    scenarios: [
      {
        id: "openclaw-gateway-live-codex-v1-1",
        status: "runtime_proof_required",
        proofBoundary: "Runtime proof marker is missing."
      }
    ],
    rawGatewayOutput: `token npm_${"A".repeat(24)} in /Users/lume/.codex/sessions/2026/07/03/session.jsonl`
  });

  const report = createRuntimeProofIssuePacket({
    evidenceDir,
    failureReport,
    parentIssue: "#309",
    operatingLoopIssue: "#16",
    milestone: "Milestone 8: 1.0 RC Hardening and User-Ready Release Path",
    now: "2026-07-03T09:30:00.000Z"
  });

  assert.equal(report.ok, true);
  assert.equal(report.issuePacketReady, true);
  assert.equal(report.actionsPerformed.githubIssueCreated, false);
  assert.equal(report.redactionScan.publicSafe, true);
  assert.equal(report.redactionScan.rawSecretIncluded, false);
  assert.equal(report.redactionScan.rawTranscriptPathIncluded, false);
  assert.equal(report.source.inputFindings.some((finding) => finding.reason === "secret_like_value"), true);
  assert.equal(report.source.inputFindings.some((finding) => finding.reason === "raw_transcript_path"), true);
  assert.match(report.title, /Runtime proof failed/i);
  assert.match(report.duplicateCheckQuery, /repo:100yenadmin\/Lossless-Codex-Orchestrator-LCO/);
  assert.deepEqual(report.parentRefs, ["#309", "#16"]);
  assert.equal(report.labels.includes("safety"), true);
  assert.equal(report.labels.includes("eval"), true);
  assert.match(report.issueBody, /Acceptance Criteria/);
  assert.match(report.issueBody, /runtime_proof_missing:openclaw-gateway-live-codex-v1-1:installed_gateway_path/);
  assert.doesNotMatch(JSON.stringify(report), /npm_A/);
  assert.equal(JSON.stringify(report).includes(".codex/sessions"), false);
  assert.equal(existsSync(join(evidenceDir, "runtime-proof-issue-packet.json")), true);
});

test("loo runtime issue-packet writes packet and fails closed for malformed input in strict mode", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-runtime-issue-packet-cli-"));
  const evidenceDir = join(root, "evidence");
  const failureReport = join(root, "malformed.json");
  writeFileSync(failureReport, `{ "ok": false, "token": "npm_${"B".repeat(24)}" `);

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "runtime",
    "issue-packet",
    "--evidence-dir",
    evidenceDir,
    "--failure-report",
    failureReport,
    "--parent-issue",
    "#309",
    "--operating-loop",
    "#16",
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    ok?: boolean;
    issuePacketReady?: boolean;
    blockers?: string[];
    redactionScan?: { publicSafe?: boolean; rawSecretIncluded?: boolean };
    actionsPerformed?: { githubIssueCreated?: boolean; externalWrite?: boolean };
  };
  assert.equal(payload.ok, false);
  assert.equal(payload.issuePacketReady, false);
  assert.equal(payload.blockers?.includes("failure_report_invalid_json"), true);
  assert.equal(payload.redactionScan?.publicSafe, true);
  assert.equal(payload.redactionScan?.rawSecretIncluded, false);
  assert.equal(payload.actionsPerformed?.githubIssueCreated, false);
  assert.equal(payload.actionsPerformed?.externalWrite, false);
  assert.doesNotMatch(result.stdout, /npm_B/);
  assert.equal(existsSync(join(evidenceDir, "runtime-proof-issue-packet.json")), true);
});

test("runtime proof issue packet redacts blocker values before writing public packet fields", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-runtime-issue-packet-redact-blockers-"));
  const evidenceDir = join(root, "evidence");
  const failureReport = join(root, "failed-runtime-proof.json");
  const secretBlocker = `runtime_proof_missing:npm_${"C".repeat(24)}`;
  const transcriptPath = "/home/alice/.codex/sessions/private-thread.jsonl";
  writeJson(failureReport, {
    ok: false,
    blockers: [secretBlocker, transcriptPath],
    rawEvidenceBlockers: [`ghp_${"D".repeat(24)}`],
    scenarios: [{ id: "openclaw-gateway-live-codex-v1-1" }]
  });

  const report = createRuntimeProofIssuePacket({ evidenceDir, failureReport });
  const serialized = JSON.stringify(report);

  assert.equal(report.ok, true);
  assert.equal(report.issuePacketReady, true);
  assert.equal(report.redactionScan.publicSafe, true);
  assert.equal(report.source.inputFindings.some((finding) => finding.reason === "secret_like_value"), true);
  assert.equal(report.source.inputFindings.some((finding) => finding.reason === "raw_transcript_path"), true);
  assert.doesNotMatch(serialized, /npm_C/);
  assert.doesNotMatch(serialized, /ghp_D/);
  assert.equal(serialized.includes("/home/alice/.codex/sessions"), false);
  assert.match(serialized, /redacted_secret_like_value/);
  assert.match(serialized, /redacted_raw_transcript_path/);
});

test("runtime proof issue packet fails closed for empty failure report input", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-runtime-issue-packet-empty-"));
  const evidenceDir = join(root, "evidence");
  const failureReport = join(root, "empty.json");
  writeFileSync(failureReport, "");

  const report = createRuntimeProofIssuePacket({ evidenceDir, failureReport });

  assert.equal(report.ok, false);
  assert.equal(report.issuePacketReady, false);
  assert.equal(report.blockers.includes("failure_report_invalid_json"), true);
  assert.equal(report.nextAction, "Repair the failure report input or packet redaction blockers before filing an issue.");
});

test("runtime proof issue packet rejects transcript-like failure report paths before reading content", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-runtime-issue-packet-transcript-input-"));
  const codexSessionsDir = join(root, ".codex", "sessions", "2026", "07", "03");
  mkdirSync(codexSessionsDir, { recursive: true });
  const evidenceDir = join(root, "evidence");
  const failureReport = join(codexSessionsDir, "private-thread.jsonl");
  writeFileSync(failureReport, `{"token":"npm_${"E".repeat(24)}","blockers":["would_leak_if_read"]}\n`);

  const report = createRuntimeProofIssuePacket({ evidenceDir, failureReport });
  const serialized = JSON.stringify(report);

  assert.equal(report.ok, false);
  assert.equal(report.issuePacketReady, false);
  assert.equal(report.blockers.includes("failure_report_transcript_path_rejected"), true);
  assert.equal(report.actionsPerformed.rawTranscriptRead, false);
  assert.deepEqual(report.source.inputFindings, []);
  assert.doesNotMatch(serialized, /npm_E/);
  assert.doesNotMatch(serialized, /would_leak_if_read/);
});

test("runtime proof issue packet redacts claim scope and public issue body evidence path", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-runtime-issue-packet-claim-scope-"));
  const evidenceDir = join(root, "user-home-like", "evidence");
  const failureReport = join(root, "failed-runtime-proof.json");
  writeJson(failureReport, {
    ok: false,
    claimScope: `npm_${"F".repeat(24)}`,
    blockers: ["runtime_proof_missing:openclaw-gateway-live-codex-v1-1:installed_gateway_path"]
  });

  const report = createRuntimeProofIssuePacket({ evidenceDir, failureReport });

  assert.equal(report.ok, true);
  assert.equal(report.source.claimScope, "redacted_secret_like_value");
  assert.match(report.issueBody, /local-evidence-dir:evidence/);
  assert.equal(report.issueBody.includes(root), false);
  assert.doesNotMatch(JSON.stringify(report), /npm_F/);
});

test("runtime proof issue packet fails closed for invalid generatedAt input", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-runtime-issue-packet-invalid-now-"));
  const evidenceDir = join(root, "evidence");
  const failureReport = join(root, "failed-runtime-proof.json");
  writeJson(failureReport, {
    ok: false,
    blockers: ["runtime_proof_missing:openclaw-gateway-live-codex-v1-1:installed_gateway_path"]
  });

  const report = createRuntimeProofIssuePacket({ evidenceDir, failureReport, now: "not-an-iso-date" });

  assert.equal(report.ok, false);
  assert.equal(report.issuePacketReady, false);
  assert.equal(report.blockers.includes("invalid_generated_at"), true);
  assert.notEqual(Number.isNaN(Date.parse(report.generatedAt)), true);
  assert.notEqual(report.generatedAt, "not-an-iso-date");
});

test("runtime proof issue packet does not force default tracker refs when explicit refs are supplied", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-runtime-issue-packet-parent-refs-"));
  const evidenceDir = join(root, "evidence");
  const failureReport = join(root, "failed-runtime-proof.json");
  writeJson(failureReport, {
    ok: false,
    blockers: ["runtime_proof_missing:custom-lane-v1:runtime_marker"]
  });

  const report = createRuntimeProofIssuePacket({
    evidenceDir,
    failureReport,
    parentIssue: "#999",
    operatingLoopIssue: "#998"
  });

  assert.deepEqual(report.parentRefs, ["#999", "#998"]);
});

test("runtime proof issue packet writes a minimal stub when final redaction scan fails", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-runtime-issue-packet-redaction-stub-"));
  const evidenceDir = join(root, "evidence");
  const failureReport = join(root, "failed-runtime-proof.json");
  writeJson(failureReport, {
    ok: false,
    blockers: ["runtime_proof_missing:openclaw-gateway-live-codex-v1-1:installed_gateway_path"]
  });

  const report = createRuntimeProofIssuePacket({
    evidenceDir,
    failureReport,
    milestone: `npm_${"G".repeat(24)}`
  });
  const persisted = readFileSync(join(evidenceDir, "runtime-proof-issue-packet.json"), "utf8");

  assert.equal(report.ok, false);
  assert.equal(report.issuePacketReady, false);
  assert.equal(report.blockers.includes("issue_packet_redaction_failed"), true);
  assert.equal(report.milestone, null);
  assert.doesNotMatch(JSON.stringify(report), /npm_G/);
  assert.doesNotMatch(persisted, /npm_G/);
  assert.equal(JSON.parse(persisted).issueBody, "");
});
