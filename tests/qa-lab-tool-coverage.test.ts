import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createQaLabToolCoverageReport, type QaLabToolCoverageReport } from "../packages/cli/src/qa-lab-tool-coverage.js";
import { DEFAULT_REQUIRED_TOOL_CALLS } from "../packages/cli/src/openclaw-tool-smoke.js";
import { createLooToolDeclarations } from "../packages/mcp-server/src/tools.js";
import { runLoo } from "./helpers/run-loo.js";

const candidateSha = "20d913822d82cad0b5c565b3c9fd3cd527ac0e57";
const packageVersion = "1.2.5";

function makeTempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function allDeclaredToolNames(): string[] {
  return createLooToolDeclarations().map((tool) => tool.name);
}

function noActions(): Record<string, false> {
  return {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false,
    broadGatewayScopeApproval: false
  };
}

function writeToolSmokeReport(dir: string, invokedTools: string[]): string {
  const path = join(dir, "openclaw-tool-smoke.json");
  writeJson(path, {
    ok: true,
    toolSmokeReady: true,
    publicSafe: true,
    packageVersion,
    candidateSha,
    catalog: {
      exitStatus: 0,
      requiredTools: invokedTools,
      requiredToolsPresent: true,
      missingRequiredTools: [],
      toolCount: 232
    },
    invocations: invokedTools.map((toolName) => ({
      toolName,
      exitStatus: 0,
      ok: true,
      gatewayMethod: "tools.invoke",
      summary: { outputKind: "object" },
      blockers: []
    })),
    setupStatus: {
      classification: "ready",
      packageInstallLikelyOk: true,
      recoverable: false,
      retryAfterSetup: false,
      doesNotIndicatePackageFailure: true
    },
    blockers: [],
    setupBlockers: [],
    actionsPerformed: noActions()
  });
  return path;
}

test("qa-lab tool coverage passes strict full coverage only when every declared tool has product evidence", (t) => {
  const dir = makeTempDir(t, "loo-qa-tool-coverage-pass-");
  const toolSmokeReport = writeToolSmokeReport(dir, allDeclaredToolNames());

  const report = createQaLabToolCoverageReport({
    evidenceDir: dir,
    packageVersion,
    candidateSha,
    toolSmokeReport,
    coveragePolicy: "full",
    claimScope: "codex-working-app-proof",
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.schema, "lco.qaLab.toolCoverage.v1");
  assert.equal(report.ok, true);
  assert.equal(report.qaLabToolCoverageReady, true);
  assert.equal(report.declaredToolCount, 60);
  assert.deepEqual(report.tierCounts, {
    public_facade: 8,
    workflow_detail: 34,
    proof_debug: 15,
    internal_low_level: 3
  });
  assert.equal(report.invocationCoverage.invokedDeclaredTools, 60);
  assert.equal(report.invocationCoverage.missingDeclaredTools.length, 0);
  assert.equal(report.blockers.length, 0);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.actionsPerformed.desktopGuiActionRun, false);

  const written = JSON.parse(readFileSync(join(dir, "tool-coverage.json"), "utf8")) as QaLabToolCoverageReport;
  assert.equal(written.schema, "lco.qaLab.toolCoverage.v1");
  assert.equal(written.qaLabToolCoverageReady, true);
});

test("qa-lab tool coverage fails strict for the 1.2.5-style 36 of 60 gateway evidence", (t) => {
  const dir = makeTempDir(t, "loo-qa-tool-coverage-gap-");
  const toolSmokeReport = writeToolSmokeReport(dir, DEFAULT_REQUIRED_TOOL_CALLS);

  const report = createQaLabToolCoverageReport({
    evidenceDir: dir,
    packageVersion,
    candidateSha,
    toolSmokeReport,
    coveragePolicy: "full",
    claimScope: "codex-working-app-proof",
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(DEFAULT_REQUIRED_TOOL_CALLS.length, 36);
  assert.equal(report.ok, false);
  assert.equal(report.qaLabToolCoverageReady, false);
  assert.equal(report.invocationCoverage.invokedDeclaredTools, 36);
  assert.equal(report.invocationCoverage.missingDeclaredTools.length, 24);
  assert.ok(report.blockers.some((blocker) => blocker.code === "declared_tool_product_evidence_missing"));
  assert.ok(report.toolRows.some((row) => row.name === "loo_describe_ref" && row.coverageStatus === "missing_invocation"));
});

test("qa-lab tool coverage redacts unsafe evidence values instead of echoing canaries", (t) => {
  const dir = makeTempDir(t, "loo-qa-tool-coverage-unsafe-");
  const toolSmokeReport = join(dir, "openclaw-tool-smoke.json");
  writeJson(toolSmokeReport, {
    ok: true,
    toolSmokeReady: true,
    publicSafe: true,
    catalog: {
      requiredTools: ["loo_doctor"],
      requiredToolsPresent: true,
      missingRequiredTools: [],
      toolCount: 1
    },
    invocations: [{
      toolName: "loo_doctor",
      ok: true,
      exitStatus: 0,
      summary: {
        rawPathCanary: "/Users/lume/.codex/sessions/2026/private.jsonl",
        spacedPathCanary: "see /Volumes/LEXAR/private/evidence/raw.sqlite before release",
        tokenCanary: "npm_abcdefghijklmnopqrstuvwxyz123456"
      },
      blockers: []
    }],
    blockers: [],
    setupBlockers: [],
    actionsPerformed: noActions()
  });

  const report = createQaLabToolCoverageReport({
    evidenceDir: dir,
    toolSmokeReport,
    coveragePolicy: "facade",
    now: "2026-07-05T00:00:00.000Z"
  });

  const serialized = JSON.stringify(report);
  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "unsafe_evidence_value"));
  assert.doesNotMatch(serialized, /private\\.jsonl/);
  assert.doesNotMatch(serialized, /raw\\.sqlite/);
  assert.doesNotMatch(serialized, /npm_abcdefghijklmnopqrstuvwxyz123456/);
});

test("qa-lab tool coverage rejects explicit manifest override paths outside evidence dir", (t) => {
  const dir = makeTempDir(t, "loo-qa-tool-coverage-manifest-");
  const outside = makeTempDir(t, "loo-qa-tool-coverage-manifest-outside-");
  const toolSmokeReport = writeToolSmokeReport(dir, allDeclaredToolNames());
  const manifestPath = join(outside, "openclaw.plugin.json");
  writeJson(manifestPath, { contracts: { tools: allDeclaredToolNames() } });

  const report = createQaLabToolCoverageReport({
    evidenceDir: dir,
    toolSmokeReport,
    manifestPath,
    coveragePolicy: "full",
    now: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "manifest_outside_evidence_dir"));
  assert.equal(report.evidenceIndex.manifest.status, "blocked");
  assert.doesNotMatch(JSON.stringify(report), new RegExp(outside.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("loo qa-lab tool-coverage --strict exits nonzero for missing product evidence", (t) => {
  const dir = makeTempDir(t, "loo-qa-tool-coverage-cli-");
  const toolSmokeReport = writeToolSmokeReport(dir, DEFAULT_REQUIRED_TOOL_CALLS);

  const result = runLoo([
    "qa-lab",
    "tool-coverage",
    "--evidence-dir",
    dir,
    "--tool-smoke-report",
    toolSmokeReport,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--coverage-policy",
    "full",
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as QaLabToolCoverageReport;
  assert.equal(report.schema, "lco.qaLab.toolCoverage.v1");
  assert.equal(report.invocationCoverage.missingDeclaredTools.length, 24);
});
