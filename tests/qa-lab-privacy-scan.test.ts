import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { runLoo } from "./helpers/run-loo.js";

const packageVersion = "1.3.0";
const candidateSha = "20d913822d82cad0b5c565b3c9fd3cd527ac0e57";

type PrivacyScanReport = {
  schema: "lco.privacyScan.v1";
  ok: boolean;
  publicSafe: boolean;
  packageVersion: string;
  candidateSha: string | null;
  rawSessionArtifacts: Array<{ ref: string; reason: string }>;
  secretLikeEvidenceFindings: Array<{ ref: string; reason: string }>;
  blockers: Array<{ severity: string; code: string; source: string; detail: string }>;
  actionsPerformed: Record<string, boolean>;
  evidenceIndex: Array<{ ref: string; status: string; reasonCodes: string[] }>;
};

function makeTempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeDemoStatusCanaryEvidence(dir: string): void {
  writeJson(join(dir, "index-codex.json"), {
    indexedFiles: 125,
    skippedFiles: 0,
    indexedThreads: 125,
    indexedEvents: 1200,
    limitedFiles: [],
    errors: []
  });
  writeJson(join(dir, "plans-search.json"), [
    { sourceRef: "codex_thread:plan-thread", threadId: "plan-thread", snippet: "Proposed plan" }
  ]);
  writeJson(join(dir, "finals-search.json"), [
    { sourceRef: "codex_thread:final-thread", threadId: "final-thread", snippet: "Final message" }
  ]);
  writeJson(join(dir, "expand-brief.json"), {
    sourceRef: "codex_thread:plan-thread",
    text: "Metadata\nFinal message\nProposed plan\nTouched files",
    profile: { name: "brief" }
  });
  writeJson(join(dir, "expand-evidence.json"), {
    sourceRef: "codex_thread:final-thread",
    text: "Metadata\nFinal message\nProposed plan\nTouched files\nSafe summary",
    profile: { name: "evidence" }
  });
  writeJson(join(dir, "control-dry-run.json"), {
    action: "send",
    threadId: "plan-thread",
    live: false,
    approvalAuditId: "loo_audit_test",
    paramsHash: "a".repeat(64),
    messageHash: "b".repeat(64)
  });
}

function writeReleaseGateProjectSkeleton(rootDir: string): void {
  mkdirSync(join(rootDir, "dist/packages/openclaw-plugin/src"), { recursive: true });
  mkdirSync(join(rootDir, "docs/releases"), { recursive: true });
  writeFileSync(join(rootDir, "dist/packages/openclaw-plugin/src/index.js"), "export default {};\n");
  writeJson(join(rootDir, "package.json"), {
    name: "lossless-openclaw-orchestrator",
    version: packageVersion,
    description: "Index, search, and prepare local Codex sessions for OpenClaw with approval-gated dry-run/control boundaries.",
    files: ["dist", "packages", "docs", "openclaw.plugin.json", "README.md", "LICENSE", "SECURITY.md"],
    openclaw: {
      extensions: ["./dist/packages/openclaw-plugin/src/index.js"],
      compat: { pluginApi: ">=2026.6.8" },
      build: { openclawVersion: ">=2026.6.8" }
    }
  });
  writeJson(join(rootDir, "openclaw.plugin.json"), {
    id: "lossless-openclaw-orchestrator",
    name: "Lossless OpenClaw Orchestrator",
    description: "Index, search, and prepare local Codex sessions for OpenClaw with approval-gated dry-run/control boundaries.",
    version: packageVersion,
    kind: "tool",
    tools: { prefix: "lco_" },
    mcp: { command: "lco-mcp-server", transport: "stdio" },
    safety: {
      localOnlyByDefault: true,
      liveControlRequires: ["dry_run", "approval_audit_id"],
      forbiddenClaims: ["Full Claude Code parity", "cloud sync", "unattended desktop takeover", "permission bypass"]
    }
  });
  writeFileSync(join(rootDir, "README.md"), [
    "# Lossless OpenClaw Orchestrator",
    "docs/SETUP.md",
    "npm install -g lossless-codex-orchestrator@latest",
    "npm install -g lossless-openclaw-orchestrator@latest",
    "loo index codex",
    "loo-mcp-server",
    "CONTRIBUTING.md",
    "AGENTS.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    "VISION.md",
    "docs/OPENCLAW_PLUGIN.md",
    "docs/PRIVACY.md",
    "docs/releases/CHANGELOG.md",
    "License",
    "Give your main agent a memory and command layer for all your Codex projects and threads.",
    "field-weighted FTS5 search",
    "prepared cards",
    "summary leaves",
    "attention inbox",
    "project digest",
    "dry-run command packets",
    "## OpenClaw And MCP"
  ].join("\n"));
  writeFileSync(join(rootDir, "docs/CLAIM_AUDIT.md"), [
    "Forbidden Beta Claims",
    "approved_live_control_smoke_missing",
    "Full Claude Code parity",
    "No cloud sync",
    "No unattended desktop takeover",
    "No permission bypass",
    "release-grade enterprise security",
    "generic GUI mutation"
  ].join("\n"));
  writeFileSync(join(rootDir, "docs/BETA_RELEASE_DEMO.md"), [
    "100+ local Codex sessions",
    "does not run live control"
  ].join("\n"));
  writeFileSync(join(rootDir, `docs/releases/RELEASE_NOTES_${packageVersion}.md`), `# Release ${packageVersion}\n`);
}

function assertLooOk(args: string[]): void {
  const result = runLoo(args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("loo qa-lab privacy-scan writes a public-safe clean evidence report", (t) => {
  const dir = makeTempDir(t, "loo-qa-privacy-clean-");
  writeJson(join(dir, "scenario-sweep.json"), {
    schema: "lco.scenarioSweep.v1",
    ok: true,
    publicSafe: true,
    blockers: [],
    actionsPerformed: { rawTranscriptRead: false, liveCodexControlRun: false }
  });

  const result = runLoo([
    "qa-lab",
    "privacy-scan",
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--now",
    "2026-07-05T09:30:00.000Z",
    "--strict"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as PrivacyScanReport;
  const persisted = JSON.parse(readFileSync(join(dir, "privacy-scan.json"), "utf8")) as PrivacyScanReport;

  assert.equal(report.schema, "lco.privacyScan.v1");
  assert.equal(report.ok, true);
  assert.equal(report.publicSafe, true);
  assert.equal(report.packageVersion, packageVersion);
  assert.equal(report.candidateSha, candidateSha);
  assert.deepEqual(report.rawSessionArtifacts, []);
  assert.deepEqual(report.secretLikeEvidenceFindings, []);
  assert.equal(persisted.ok, true);
  assert.equal(report.actionsPerformed.npmPublished, false);
  assert.equal(report.actionsPerformed.githubReleaseCreated, false);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
  assert.equal(report.actionsPerformed.rawTranscriptRead, false);
  assert.equal(report.actionsPerformed.screenshotsCaptured, false);
  assert.doesNotMatch(result.stdout, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(result.stderr.trim(), "");
});

test("release gate evidence reports are self-compatible with privacy scan", (t) => {
  const dir = makeTempDir(t, "loo-qa-privacy-release-gates-");
  const rootDir = makeTempDir(t, "loo-qa-privacy-release-root-");
  writeReleaseGateProjectSkeleton(rootDir);
  writeDemoStatusCanaryEvidence(dir);

  assertLooOk([
    "scorecards",
    "sweep",
    "--evidence-dir",
    dir,
    "--claim-scope",
    "codex-read-search-expand-dry-run",
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);
  assertLooOk([
    "eval",
    "scenarios",
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);
  assertLooOk([
    "release",
    "preflight",
    "--evidence-dir",
    dir,
    "--claim-scope",
    "codex-read-search-expand-dry-run",
    "--root",
    rootDir,
    "--strict"
  ]);
  assertLooOk([
    "release",
    "demo-status",
    "--evidence-dir",
    dir,
    "--claim-scope",
    "codex-read-search-expand-dry-run",
    "--strict"
  ]);
  assertLooOk([
    "release",
    "bundle",
    "--evidence-dir",
    dir,
    "--claim-scope",
    "codex-read-search-expand-dry-run",
    "--root",
    rootDir,
    "--strict"
  ]);
  assertLooOk([
    "release",
    "status",
    "--evidence-dir",
    dir,
    "--claim-scope",
    "codex-read-search-expand-dry-run",
    "--root",
    rootDir
  ]);

  const result = runLoo([
    "qa-lab",
    "privacy-scan",
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as PrivacyScanReport;
  assert.equal(report.ok, true);
  assert.deepEqual(report.rawSessionArtifacts, []);
  assert.deepEqual(report.secretLikeEvidenceFindings, []);
});

test("loo qa-lab privacy-scan strict mode blocks raw artifacts and secret-like values without echoing them", (t) => {
  const dir = makeTempDir(t, "loo-qa-privacy-unsafe-");
  writeFileSync(join(dir, "private-session.jsonl"), "{\"private\":true}\n");
  writeJson(join(dir, "gateway-report.json"), {
    publicSafe: true,
    authorization: `bearer ${"a".repeat(32)}`,
    localPath: "/Users/lume/.codex/sessions/private-session.jsonl"
  });

  const result = runLoo([
    "qa-lab",
    "privacy-scan",
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as PrivacyScanReport;

  assert.equal(report.ok, false);
  assert.equal(report.publicSafe, false);
  assert.equal(report.rawSessionArtifacts.length, 1);
  assert.equal(report.secretLikeEvidenceFindings.length, 1);
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "raw_session_artifact_found"));
  assert.ok(report.blockers.some((blocker) => blocker.severity === "P0" && blocker.code === "secret_like_evidence_found"));
  assert.ok(report.evidenceIndex.some((entry) => entry.status === "unsafe" && entry.reasonCodes.includes("raw_codex_jsonl")));
  assert.ok(report.evidenceIndex.some((entry) => entry.status === "unsafe" && entry.reasonCodes.includes("secret_like_value")));
  assert.doesNotMatch(result.stdout, /private-session\.jsonl/);
  assert.doesNotMatch(result.stdout, /gateway-report\.json/);
  assert.doesNotMatch(result.stdout, /bearer a+/i);
  assert.doesNotMatch(result.stdout, /\/Users\/lume/);
  assert.doesNotMatch(result.stdout, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(existsSync(join(dir, "privacy-scan.json")), true);
  assert.equal(result.stderr.trim(), "");
});

test("loo qa-lab privacy-scan fails closed on bad candidate sha without leaking the supplied value", (t) => {
  const dir = makeTempDir(t, "loo-qa-privacy-bad-sha-");

  const result = runLoo([
    "qa-lab",
    "privacy-scan",
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    "/tmp/private-candidate.jsonl",
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as PrivacyScanReport;
  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "candidate_sha_invalid"));
  assert.doesNotMatch(result.stdout, /private-candidate\.jsonl/);
  assert.doesNotMatch(result.stdout, /\/tmp\//);
});

test("loo qa-lab privacy-scan refuses scan dirs outside the evidence directory without reading them", (t) => {
  const evidenceDir = makeTempDir(t, "loo-qa-privacy-contained-");
  const outsideDir = makeTempDir(t, "loo-qa-privacy-outside-");
  writeJson(join(outsideDir, "outside-private.json"), {
    localPath: "/Users/lume/private/session.jsonl",
    token: `npm_${"a".repeat(32)}`
  });

  const result = runLoo([
    "qa-lab",
    "privacy-scan",
    "--evidence-dir",
    evidenceDir,
    "--scan-dir",
    outsideDir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as PrivacyScanReport;
  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "scan_dir_outside_evidence_dir"));
  assert.deepEqual(report.rawSessionArtifacts, []);
  assert.deepEqual(report.secretLikeEvidenceFindings, []);
  assert.doesNotMatch(result.stdout, /outside-private\.json/);
  assert.doesNotMatch(result.stdout, /\/Users\/lume/);
  assert.doesNotMatch(result.stdout, /npm_a+/);
  assert.doesNotMatch(result.stdout, new RegExp(outsideDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("loo qa-lab privacy-scan fails closed on unscanned evidence file types", (t) => {
  const dir = makeTempDir(t, "loo-qa-privacy-unknown-type-");
  writeFileSync(join(dir, "release.env"), "LCO_PUBLIC_SAFE=true\n");

  const result = runLoo([
    "qa-lab",
    "privacy-scan",
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as PrivacyScanReport;
  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === "unscanned_file_type"));
  assert.ok(report.evidenceIndex.some((entry) => entry.status === "unsafe" && entry.reasonCodes.includes("unscanned_file_type")));
  assert.doesNotMatch(result.stdout, /release\.env/);
  assert.doesNotMatch(result.stdout, /LCO_PUBLIC_SAFE/);
});

test("loo qa-lab privacy-scan scans large benign text evidence instead of size-failing it", (t) => {
  const dir = makeTempDir(t, "loo-qa-privacy-large-");
  writeJson(join(dir, "large-public.json"), {
    schema: "lco.largePublicFixture.v1",
    publicSafe: true,
    payload: "a".repeat(2_200_000)
  });

  const result = runLoo([
    "qa-lab",
    "privacy-scan",
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as PrivacyScanReport;
  assert.equal(report.ok, true);
  assert.equal(report.publicSafe, true);
  assert.ok(!report.blockers.some((blocker) => blocker.code === "text_scan_size_limit_exceeded"));
  assert.ok(report.evidenceIndex.every((entry) => !entry.reasonCodes.includes("text_scan_size_limit_exceeded")));
  assert.doesNotMatch(result.stdout, /large-public\.json/);
});

test("loo qa-lab privacy-scan reports symlinks as skipped public-safe warnings", (t) => {
  const dir = makeTempDir(t, "loo-qa-privacy-symlink-");
  const outsideDir = makeTempDir(t, "loo-qa-privacy-symlink-target-");
  writeJson(join(outsideDir, "safe.json"), { publicSafe: true });
  symlinkSync(join(outsideDir, "safe.json"), join(dir, "linked.json"));

  const result = runLoo([
    "qa-lab",
    "privacy-scan",
    "--evidence-dir",
    dir,
    "--package-version",
    packageVersion,
    "--candidate-sha",
    candidateSha,
    "--strict"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as PrivacyScanReport;
  assert.equal(report.ok, true);
  assert.ok(report.evidenceIndex.some((entry) => entry.status === "unsafe" && entry.reasonCodes.includes("symlink_not_scanned")));
  assert.doesNotMatch(result.stdout, /linked\.json|safe\.json/);
  assert.doesNotMatch(result.stdout, new RegExp(outsideDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
