import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
});
