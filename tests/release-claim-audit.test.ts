import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("public beta package and README do not overclaim Claude or desktop control", () => {
  const packageJson = JSON.parse(read("package.json")) as { description?: string };
  const readme = read("README.md");
  const plugin = read("packages/openclaw-plugin/src/index.ts");
  const readmePitch = readme.split("Forbidden beta claims:")[0] ?? readme;
  const pluginDescription = plugin.match(/description:\s*"([^"]+)"/)?.[1] ?? plugin;

  for (const [surface, content] of [
    ["package description", packageJson.description ?? ""],
    ["README pitch", readmePitch],
    ["OpenClaw plugin description", pluginDescription]
  ] as const) {
    assert.doesNotMatch(content, /Control your Codex Desktop and Claude Code remotely/i, surface);
    assert.doesNotMatch(content, /unattended desktop takeover/i, `${surface} must not claim unattended takeover`);
  }

  assert.match(packageJson.description ?? "", /local Codex sessions/i);
  assert.match(packageJson.description ?? "", /approval-gated/i);
  assert.match(readme, /Claude Code support is intentionally shipped as an adapter stub/i);
  assert.match(plugin, /approval-gated controls/i);
});

test("public beta docs include install, MCP/OpenClaw, demo, and approval-boundary proof", () => {
  assert.equal(existsSync("docs/BETA_RELEASE_DEMO.md"), true, "docs/BETA_RELEASE_DEMO.md must exist");
  assert.equal(existsSync("docs/CLAIM_AUDIT.md"), true, "docs/CLAIM_AUDIT.md must exist");

  const readme = read("README.md");
  const openclawDocs = read("docs/OPENCLAW_PLUGIN.md");
  const demo = read("docs/BETA_RELEASE_DEMO.md");
  const claimAudit = read("docs/CLAIM_AUDIT.md");

  assert.match(readme, /docs\/OPENCLAW_PLUGIN\.md/);
  assert.match(readme, /docs\/BETA_RELEASE_DEMO\.md/);
  assert.match(readme, /loo release preflight/);
  assert.match(openclawDocs, /loo-mcp-server/);
  assert.match(openclawDocs, /dry_run=true/);
  assert.match(openclawDocs, /approval_audit_id/);

  for (const required of [
    /100\+ local Codex sessions/i,
    /loo index codex/i,
    /loo search/i,
    /loo_codex_plans/i,
    /loo_codex_final_messages/i,
    /expand.*two sessions/i,
    /loo_codex_control_dry_run/i,
    /approval_audit_id/i,
    /does not run live control/i
  ]) {
    assert.match(demo, required);
  }

  for (const required of [
    /Allowed public beta claim/i,
    /Forbidden beta claims/i,
    /Claude Code.*adapter stub/i,
    /No cloud sync/i,
    /No unattended desktop takeover/i,
    /No permission bypass/i,
    /loo release preflight/i,
    /approved_live_control_smoke_missing/i
  ]) {
    assert.match(claimAudit, required);
  }
});

test("OpenClaw plugin manifest is packageable and matches the beta safety boundary", () => {
  assert.equal(existsSync("packages/openclaw-plugin/openclaw.plugin.json"), true, "OpenClaw plugin manifest must exist");

  const manifest = JSON.parse(read("packages/openclaw-plugin/openclaw.plugin.json")) as {
    id?: string;
    name?: string;
    description?: string;
    mcp?: { command?: string; transport?: string };
    tools?: { prefix?: string };
    safety?: { localOnlyByDefault?: boolean; liveControlRequires?: string[]; forbiddenClaims?: string[] };
  };

  assert.equal(manifest.id, "lossless-openclaw-orchestrator");
  assert.equal(manifest.name, "Lossless OpenClaw Orchestrator");
  assert.match(manifest.description ?? "", /local Codex sessions/i);
  assert.match(manifest.description ?? "", /approval-gated controls/i);
  assert.doesNotMatch(manifest.description ?? "", /Claude Code remotely/i);
  assert.equal(manifest.mcp?.command, "loo-mcp-server");
  assert.equal(manifest.mcp?.transport, "stdio");
  assert.equal(manifest.tools?.prefix, "loo_");
  assert.equal(manifest.safety?.localOnlyByDefault, true);
  assert.deepEqual(manifest.safety?.liveControlRequires, ["dry_run", "approval_audit_id"]);
  assert.deepEqual(manifest.safety?.forbiddenClaims, [
    "Full Claude Code parity",
    "cloud sync",
    "unattended desktop takeover",
    "bypasses Codex permissions"
  ]);
});

test("release preflight writes a public-safe artifact manifest without hiding live-control blockers", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-"));
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "packages/cli/src/index.ts",
    "release",
    "preflight",
    "--evidence-dir",
    evidenceDir
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    ok?: boolean;
    releaseReady?: boolean;
    artifactManifestPath?: string;
    checks?: Record<string, { ok: boolean }>;
    blockers?: string[];
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.releaseReady, false);
  assert.equal(payload.checks?.packageJson?.ok, true);
  assert.equal(payload.checks?.openclawManifest?.ok, true);
  assert.equal(payload.checks?.claimAudit?.ok, true);
  assert.deepEqual(payload.blockers, ["approved_live_control_smoke_missing"]);
  assert.equal(payload.artifactManifestPath, join(evidenceDir, "release-preflight.json"));
  assert.equal(existsSync(join(evidenceDir, "release-preflight.json")), true);

  const manifest = JSON.parse(read(join(evidenceDir, "release-preflight.json"))) as {
    rawSessionArtifacts?: unknown[];
    forbiddenClaims?: string[];
    blockers?: string[];
  };
  assert.deepEqual(manifest.rawSessionArtifacts, []);
  assert.deepEqual(manifest.blockers, ["approved_live_control_smoke_missing"]);
  assert.deepEqual(manifest.forbiddenClaims, [
    "Full Claude Code parity",
    "cloud sync",
    "unattended desktop takeover",
    "bypasses Codex permissions",
    "release-grade enterprise security"
  ]);
});

test("release preflight only clears live-control blocker for structured approval-smoke proof", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-proof-"));
  const arbitraryFile = join(evidenceDir, "arbitrary.txt");
  writeFileSync(arbitraryFile, "not a live control proof\n");

  const arbitraryResult = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "packages/cli/src/index.ts",
    "release",
    "preflight",
    "--approved-live-control-evidence",
    arbitraryFile
  ], { encoding: "utf8" });

  assert.equal(arbitraryResult.status, 0, arbitraryResult.stderr || arbitraryResult.stdout);
  const arbitraryPayload = JSON.parse(arbitraryResult.stdout) as {
    releaseReady?: boolean;
    checks?: Record<string, { ok: boolean }>;
    blockers?: string[];
  };
  assert.equal(arbitraryPayload.releaseReady, false);
  assert.equal(arbitraryPayload.checks?.liveControlSmoke?.ok, false);
  assert.deepEqual(arbitraryPayload.blockers, ["approved_live_control_smoke_missing"]);

  const proofFile = join(evidenceDir, "approved-live-control-smoke.json");
  writeFileSync(proofFile, `${JSON.stringify({
    kind: "loo_approved_live_control_smoke",
    approvedLiveControlSmoke: true,
    action: "send",
    targetRef: "codex_thread:test-thread",
    approvalAuditId: "audit_test",
    messageHash: "sha256:test",
    preservesCodexApprovalSemantics: true,
    rawPromptIncluded: false
  }, null, 2)}\n`);

  const proofResult = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "packages/cli/src/index.ts",
    "release",
    "preflight",
    "--approved-live-control-evidence",
    proofFile
  ], { encoding: "utf8" });

  assert.equal(proofResult.status, 0, proofResult.stderr || proofResult.stdout);
  const proofPayload = JSON.parse(proofResult.stdout) as {
    releaseReady?: boolean;
    checks?: Record<string, { ok: boolean }>;
    blockers?: string[];
  };
  assert.equal(proofPayload.releaseReady, true);
  assert.equal(proofPayload.checks?.liveControlSmoke?.ok, true);
  assert.deepEqual(proofPayload.blockers, []);
});
