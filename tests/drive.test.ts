import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDriveReport } from "../packages/adapters/src/drive.js";
import type { AuditRecord } from "../packages/adapters/src/index.js";
import { runLoo } from "./helpers/run-loo.js";

function auditStub() {
  const records: AuditRecord[] = [];
  const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);
  return {
    path: "memory",
    fingerprintText: fingerprint,
    fingerprintValue(value: unknown) {
      return fingerprint(JSON.stringify(value));
    },
    append(record: Omit<AuditRecord, "id" | "createdAt">): AuditRecord {
      const full = {
        id: `loo_audit_${String(records.length + 1).padStart(32, "0")}`,
        createdAt: "2026-07-11T00:00:00.000Z",
        ...record
      };
      records.push(full);
      return full;
    },
    find(id: string) {
      return records.find((record) => record.id === id) ?? null;
    }
  };
}

test("drive creates a bounded Codex dry-run packet without exposing objective text", async () => {
  const objective = "Review the private patch and propose the next safe edit.";
  const report = await createDriveReport({
    reviewer: "claude",
    driver: "codex",
    targetRef: "codex_thread:thread-1",
    objective,
    surface: "cli",
    audit: auditStub(),
    now: "2026-07-11T00:00:00.000Z"
  });

  assert.equal(report.schema, "lco.drive.report.v1");
  assert.equal(report.status, "dry_run_ready");
  assert.equal(report.reviewPacket.execute, false);
  assert.equal(report.reviewPacket.objectiveLength, objective.length);
  assert.match(report.reviewPacket.objectiveHash, /^[0-9a-f]{32}$/);
  assert.equal(report.drivePlan.steps.length, 6);
  assert.deepEqual(report.drivePlan.steps.map((step) => step.kind), ["review", "plan", "dry_run", "confirm", "live", "report"]);
  assert.equal(report.dryRun.live, false);
  assert.match(report.dryRun.approvalAuditId ?? "", /^loo_audit_[0-9]+$/);
  assert.equal(report.finalReport.liveActions, 0);
  assert.equal(report.actionsPerformed.liveControl, false);
  assert.equal(report.actionsPerformed.externalWrite, false);
  assert.doesNotMatch(JSON.stringify(report), /Review the private patch|private patch|next safe edit/);
});

test("drive enforces bounded budgets before writing an audit record", async () => {
  for (const input of [
    { maxTurns: 0 },
    { maxTurns: 21 },
    { tokenBudget: 99 },
    { tokenBudget: 8001 },
    { timeoutMs: 999 },
    { timeoutMs: 600001 },
    { costCeilingUsd: -0.01 },
    { costCeilingUsd: 100.01 }
  ]) {
    await assert.rejects(
      () => createDriveReport({
        reviewer: "codex",
        driver: "codex",
        targetRef: "codex_thread:thread-1",
        objective: "Review safely.",
        audit: auditStub(),
        ...input
      }),
      /drive .* requires|drive .* must be/i
    );
  }
});

test("drive rejects target namespaces that do not match the driver", async () => {
  await assert.rejects(
    () => createDriveReport({
      reviewer: "codex",
      driver: "claude",
      targetRef: "codex_thread:thread-1",
      objective: "Review safely.",
      audit: auditStub()
    }),
    /driver and target namespace/i
  );
});

test("drive returns a public-safe blocked report when Claude is unavailable", async () => {
  const report = await createDriveReport({
    reviewer: "codex",
    driver: "claude",
    targetRef: "claude_session:session-1",
    objective: "Review safely.",
    audit: auditStub(),
    claudeAvailability: {
      available: false,
      command: "claude",
      version: null,
      error: "Claude CLI is missing."
    }
  });

  assert.equal(report.status, "blocked");
  assert.deepEqual(report.blockers, ["claude_driver_not_configured"]);
  assert.equal(report.dryRun.approvalAuditId, null);
  assert.equal(report.finalReport.liveActions, 0);
  assert.equal(report.actionsPerformed.auditWrite, false);
});

test("drive mints a Claude dry-run packet when the supported adapter is available", async () => {
  const report = await createDriveReport({
    reviewer: "codex",
    driver: "claude",
    targetRef: "claude_session:session-1",
    objective: "Review safely.",
    surface: "mcp",
    audit: auditStub(),
    claudeAvailability: {
      available: true,
      command: "claude",
      version: "Claude Code 1.0.0",
      error: null
    }
  });

  assert.equal(report.status, "dry_run_ready");
  assert.equal(report.surface, "mcp");
  assert.equal(report.dryRun.target, "claude_session:session-1");
  assert.equal(report.dryRun.live, false);
  assert.equal(report.controllerMatrix.find((row) => row.controller === "mcp")?.status, "dry_run_available");
  assert.equal(report.controllerMatrix.find((row) => row.controller === "openclaw")?.status, "dry_run_available");
});

test("loo drive help exposes the bounded dry-run contract", () => {
  const result = runLoo(["drive", "--help"], process.env, 5_000);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /--reviewer codex\|claude/);
  assert.match(result.stdout, /--driver codex\|claude/);
  assert.match(result.stdout, /--max-turns/);
  assert.match(result.stdout, /--cost-ceiling-usd/);
  assert.match(result.stdout, /dry-run/i);
});

test("loo drive emits a public-safe Codex dry-run report", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-drive-cli-"));
  try {
    const objective = "Review the bounded CLI fixture.";
    const result = runLoo([
      "drive",
      "--reviewer", "claude",
      "--driver", "codex",
      "--target-ref", "codex_thread:thread-1",
      "--objective", objective,
      "--audit-path", join(root, "audit.jsonl"),
      "--dry-run"
    ], process.env, 5_000);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as { schema?: string; status?: string; dryRun?: { live?: boolean } };
    assert.equal(report.schema, "lco.drive.report.v1");
    assert.equal(report.status, "dry_run_ready");
    assert.equal(report.dryRun?.live, false);
    assert.doesNotMatch(result.stdout, /bounded CLI fixture/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo drive rejects live requests before audit mutation", () => {
  const result = runLoo([
    "drive",
    "--reviewer", "codex",
    "--driver", "codex",
    "--target-ref", "codex_thread:thread-1",
    "--objective", "Review safely.",
    "--live"
  ], process.env, 5_000);
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr, /live.*not supported|unknown drive option/i);
});
