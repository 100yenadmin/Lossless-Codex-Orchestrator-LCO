import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { LOO_COMMAND_POLICY } from "../packages/adapters/src/index.js";
import { runReleasePreflight } from "../packages/cli/src/release-preflight.js";
import { createLooToolDeclarations } from "../packages/mcp-server/src/tools.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

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
  assert.match(readme, /loo release demo-status/);
  assert.match(readme, /loo index codex --max-files \d+/);
  assert.match(openclawDocs, /loo-mcp-server/);
  assert.match(openclawDocs, /dry_run=true/);
  assert.match(openclawDocs, /approval_audit_id/);

  for (const required of [
    /100\+ local Codex sessions/i,
    /node dist\/packages\/cli\/src\/index\.js index codex --max-files \d+/i,
    /node dist\/packages\/cli\/src\/index\.js search/i,
    /loo_codex_plans/i,
    /loo_codex_final_messages/i,
    /expand.*two sessions/i,
    /loo_codex_control_dry_run/i,
    /approval_audit_id/i,
    /does not run live control/i,
    /loo release demo-status/i
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
  assert.match(claimAudit, /loo release preflight[^\n]+--strict/i);
});

test("release status examples include live-control evidence alongside release approvals", () => {
  const readme = read("README.md");
  const releaseNotes = read("docs/RELEASE_NOTES_0.1.0-beta.0.md");

  for (const [surface, content] of [
    ["README", readme],
    ["release notes", releaseNotes]
  ] as const) {
    assert.match(content, /loo release status[^\n]+--approved-live-control-evidence[^\n]+--npm-publish-approval-evidence[^\n]+--github-release-approval-evidence/i, surface);
  }
});

test("beta release runbook defines RC cadence and keeps main distinct from releases", () => {
  assert.equal(existsSync("docs/BETA_RELEASE_RUNBOOK.md"), true, "docs/BETA_RELEASE_RUNBOOK.md must exist");

  const readme = read("README.md");
  const vision = read("VISION.md");
  const runbook = read("docs/BETA_RELEASE_RUNBOOK.md");

  assert.match(readme, /docs\/BETA_RELEASE_RUNBOOK\.md/);
  assert.match(vision, /docs\/BETA_RELEASE_RUNBOOK\.md/);

  for (const required of [
    /main is the integration branch, not a release/i,
    /release candidate/i,
    /loo release preflight/i,
    /loo release demo-status/i,
    /loo release status/i,
    /loo openclaw dogfood/i,
    /npm pack --dry-run/i,
    /GitHub Release/i,
    /npm publish/i,
    /explicit user approval/i,
    /do not run live Codex control/i,
    /do not run GUI mutation/i,
    /evidence.*\/Volumes\/LEXAR\/Codex\/lossless-openclaw-orchestrator/i,
    /issue #6/i,
    /issue #14/i
  ]) {
    assert.match(runbook, required);
  }
});

test("OpenClaw plugin manifest is packageable and matches the beta safety boundary", () => {
  assert.equal(existsSync("openclaw.plugin.json"), true, "root OpenClaw plugin manifest must exist");
  assert.equal(existsSync("packages/openclaw-plugin/openclaw.plugin.json"), true, "OpenClaw plugin manifest must exist");
  assert.equal(existsSync("packages/openclaw-plugin/package.json"), false, "nested plugin source must not shadow the root package install source");

  const packageJson = JSON.parse(read("package.json")) as {
    name?: string;
    type?: string;
    files?: string[];
    openclaw?: { extensions?: string[]; runtimeExtensions?: string[]; compat?: { pluginApi?: string }; build?: { openclawVersion?: string } };
  };
  const manifest = JSON.parse(read("openclaw.plugin.json")) as {
    id?: string;
    name?: string;
    description?: string;
    mcp?: { command?: string; transport?: string };
    tools?: { prefix?: string };
    configSchema?: { type?: string; additionalProperties?: boolean; properties?: Record<string, unknown> };
    activation?: { onStartup?: boolean };
    contracts?: { tools?: string[] };
    safety?: { localOnlyByDefault?: boolean; liveControlRequires?: string[]; forbiddenClaims?: string[] };
  };
  const sourceManifest = JSON.parse(read("packages/openclaw-plugin/openclaw.plugin.json")) as {
    id?: string;
    mcp?: { command?: string; transport?: string };
    contracts?: { tools?: string[] };
  };
  const expectedToolNames = createLooToolDeclarations().map((tool) => tool.name);

  assert.equal(packageJson.name, "lossless-openclaw-orchestrator");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.files?.includes("openclaw.plugin.json"), true);
  assert.deepEqual(packageJson.openclaw?.extensions, ["./packages/openclaw-plugin/src/index.ts"]);
  assert.deepEqual(packageJson.openclaw?.runtimeExtensions, ["./dist/packages/openclaw-plugin/src/index.js"]);
  assert.equal(packageJson.openclaw?.compat?.pluginApi, ">=2026.6.8");
  assert.equal(packageJson.openclaw?.build?.openclawVersion, ">=2026.6.8");
  assert.equal(manifest.id, "lossless-openclaw-orchestrator");
  assert.equal(sourceManifest.id, manifest.id);
  assert.equal(sourceManifest.mcp?.command, manifest.mcp?.command);
  assert.deepEqual([...expectedToolNames].sort(), Object.keys(LOO_COMMAND_POLICY).sort());
  assert.equal(manifest.name, "Lossless OpenClaw Orchestrator");
  assert.match(manifest.description ?? "", /local Codex sessions/i);
  assert.match(manifest.description ?? "", /approval-gated controls/i);
  assert.doesNotMatch(manifest.description ?? "", /Claude Code remotely/i);
  assert.equal(manifest.mcp?.command, "loo-mcp-server");
  assert.equal(manifest.mcp?.transport, "stdio");
  assert.equal(manifest.tools?.prefix, "loo_");
  assert.deepEqual(manifest.configSchema, { type: "object", additionalProperties: false, properties: {} });
  assert.equal(manifest.activation?.onStartup, true);
  assert.deepEqual(manifest.contracts?.tools, expectedToolNames);
  assert.deepEqual(sourceManifest.contracts?.tools, expectedToolNames);
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
    tsxImport,
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
    tsxImport,
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
    messageHash: "b".repeat(64),
    preservesCodexApprovalSemantics: true,
    rawPromptIncluded: false
  }, null, 2)}\n`);

  const proofResult = spawnSync(process.execPath, [
    "--import",
    tsxImport,
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

test("release preflight rejects proof markers with unexpected private fields", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-extra-proof-"));
  const proofFile = join(evidenceDir, "approved-live-control-smoke.json");
  writeFileSync(proofFile, `${JSON.stringify({
    kind: "loo_approved_live_control_smoke",
    approvedLiveControlSmoke: true,
    action: "send",
    targetRef: "codex_thread:test-thread",
    approvalAuditId: "audit_test",
    messageHash: "sha256:test",
    preservesCodexApprovalSemantics: true,
    rawPromptIncluded: false,
    screenshotPath: "/private/tmp/codex.png"
  }, null, 2)}\n`);

  const payload = runReleasePreflight({ approvedLiveControlEvidence: proofFile });
  assert.equal(payload.releaseReady, false);
  assert.equal(payload.checks.liveControlSmoke?.ok, false);
  assert.deepEqual(payload.blockers, ["approved_live_control_smoke_missing"]);
});

test("release preflight fails closed when the OpenClaw runtime extension artifact is missing", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-missing-runtime-root-"));
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-missing-runtime-evidence-"));
  const liveControlProof = join(evidenceDir, "approved-live-control-smoke.json");
  writeProjectSkeleton(rootDir, { runtimeArtifact: false });
  writeFileSync(liveControlProof, `${JSON.stringify({
    kind: "loo_approved_live_control_smoke",
    approvedLiveControlSmoke: true,
    action: "send",
    targetRef: "codex_thread:test-thread",
    approvalAuditId: "audit_test",
    messageHash: "sha256:test",
    preservesCodexApprovalSemantics: true,
    rawPromptIncluded: false
  }, null, 2)}\n`);

  const payload = runReleasePreflight({
    rootDir,
    evidenceDir,
    approvedLiveControlEvidence: liveControlProof
  });

  assert.equal(payload.releaseReady, false);
  assert.equal(payload.checks.openclawManifest?.ok, false);
  assert.deepEqual(payload.blockers, ["openclawManifest_failed"]);
});

test("release preflight fails closed when OpenClaw artifacts are missing from the npm publish list", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-missing-files-root-"));
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-missing-files-evidence-"));
  const liveControlProof = join(evidenceDir, "approved-live-control-smoke.json");
  writeProjectSkeleton(rootDir, {
    packageFiles: ["packages", "docs", "README.md", "LICENSE", "SECURITY.md"]
  });
  writeFileSync(liveControlProof, `${JSON.stringify({
    kind: "loo_approved_live_control_smoke",
    approvedLiveControlSmoke: true,
    action: "send",
    targetRef: "codex_thread:test-thread",
    approvalAuditId: "audit_test",
    messageHash: "sha256:test",
    preservesCodexApprovalSemantics: true,
    rawPromptIncluded: false
  }, null, 2)}\n`);

  const payload = runReleasePreflight({
    rootDir,
    evidenceDir,
    approvedLiveControlEvidence: liveControlProof
  });

  assert.equal(payload.releaseReady, false);
  assert.equal(payload.checks.openclawManifest?.ok, false);
  assert.deepEqual(payload.blockers, ["openclawManifest_failed"]);
});

test("release preflight reports malformed package JSON as a structured blocker", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-invalid-root-"));
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-invalid-evidence-"));
  writeProjectSkeleton(rootDir);
  writeFileSync(join(rootDir, "package.json"), "{not json\n");

  const payload = runReleasePreflight({ rootDir, evidenceDir });

  assert.equal(payload.ok, false);
  assert.equal(payload.releaseReady, false);
  assert.equal(payload.checks.packageJson?.ok, false);
  assert.match(payload.checks.packageJson?.detail ?? "", /invalid JSON/i);
  assert.equal(existsSync(join(evidenceDir, "release-preflight.json")), true);
  assert.deepEqual(payload.blockers, ["packageJson_failed", "approved_live_control_smoke_missing"]);
});

test("release preflight README gate enforces the full forbidden-claims boundary", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-readme-root-"));
  writeProjectSkeleton(rootDir, {
    readme: [
      "# Lossless OpenClaw Orchestrator",
      "Allowed public beta claim:",
      "loo release preflight",
      "Full Claude Code parity",
      "cloud sync",
      "unattended desktop takeover",
      "bypasses Codex permissions"
    ].join("\n")
  });

  const payload = runReleasePreflight({ rootDir });

  assert.equal(payload.checks.readme?.ok, false);
  assert.match(payload.checks.readme?.detail ?? "", /forbidden claims/i);
  assert.deepEqual(payload.blockers, ["readme_failed", "approved_live_control_smoke_missing"]);
});

test("release preflight --strict exits non-zero when blockers remain", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "preflight",
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as { releaseReady?: boolean; blockers?: string[] };
  assert.equal(payload.releaseReady, false);
  assert.deepEqual(payload.blockers, ["approved_live_control_smoke_missing"]);
});

test("release preflight checks package files from the package root regardless of caller cwd", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-cwd-"));
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    join(process.cwd(), "packages/cli/src/index.ts"),
    "release",
    "preflight",
    "--evidence-dir",
    evidenceDir
  ], { cwd: evidenceDir, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    checks?: Record<string, { ok: boolean }>;
    blockers?: string[];
  };
  assert.equal(payload.checks?.packageJson?.ok, true);
  assert.equal(payload.checks?.readme?.ok, true);
  assert.equal(payload.checks?.openclawManifest?.ok, true);
  assert.equal(payload.checks?.claimAudit?.ok, true);
  assert.equal(payload.checks?.betaDemo?.ok, true);
  assert.deepEqual(payload.blockers, ["approved_live_control_smoke_missing"]);
});

test("release preflight reports raw artifacts already present in the evidence directory", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-raw-"));
  writeFileSync(join(evidenceDir, "session.jsonl"), "{}\n");
  writeFileSync(join(evidenceDir, "private.sqlite"), "");
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
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
    blockers?: string[];
    rawSessionArtifacts?: Array<{ name: string; reason: string }>;
  };
  assert.equal(payload.ok, false);
  assert.equal(payload.releaseReady, false);
  assert.deepEqual(payload.blockers, ["raw_session_artifacts_present", "approved_live_control_smoke_missing"]);
  assert.deepEqual(payload.rawSessionArtifacts, [
    { name: "private.sqlite", reason: "sqlite_database" },
    { name: "session.jsonl", reason: "raw_codex_jsonl" }
  ]);
});

function writeProjectSkeleton(rootDir: string, overrides: { readme?: string; runtimeArtifact?: boolean; packageFiles?: string[] } = {}): void {
  mkdirSync(join(rootDir, "docs"), { recursive: true });
  mkdirSync(join(rootDir, "packages/openclaw-plugin"), { recursive: true });
  if (overrides.runtimeArtifact !== false) {
    mkdirSync(join(rootDir, "dist/packages/openclaw-plugin/src"), { recursive: true });
    writeFileSync(join(rootDir, "dist/packages/openclaw-plugin/src/index.js"), "export default {};\n");
  }
  const toolNames = createLooToolDeclarations().map((tool) => tool.name);
  writeFileSync(join(rootDir, "package.json"), JSON.stringify({
    name: "lossless-openclaw-orchestrator",
    version: "0.1.0-beta.0",
    description: "Index, search, and control local Codex sessions through OpenClaw with approval-gated safety.",
    files: overrides.packageFiles ?? ["dist", "packages", "docs", "openclaw.plugin.json", "README.md", "LICENSE", "SECURITY.md"],
    openclaw: {
      extensions: ["./packages/openclaw-plugin/src/index.ts"],
      runtimeExtensions: ["./dist/packages/openclaw-plugin/src/index.js"],
      compat: { pluginApi: ">=2026.6.8" },
      build: { openclawVersion: ">=2026.6.8" }
    }
  }));
  writeFileSync(join(rootDir, "README.md"), overrides.readme ?? [
    "# Lossless OpenClaw Orchestrator",
    "Allowed public beta claim:",
    "loo release preflight",
    "Full Claude Code parity",
    "cloud sync",
    "unattended desktop takeover",
    "bypasses Codex permissions",
    "release-grade enterprise security"
  ].join("\n"));
  writeFileSync(join(rootDir, "docs/CLAIM_AUDIT.md"), [
    "Forbidden Beta Claims",
    "approved_live_control_smoke_missing"
  ].join("\n"));
  writeFileSync(join(rootDir, "docs/BETA_RELEASE_DEMO.md"), [
    "100+ local Codex sessions",
    "does not run live control"
  ].join("\n"));
  const manifest = JSON.stringify({
    id: "lossless-openclaw-orchestrator",
    name: "Lossless OpenClaw Orchestrator",
    description: "Index, search, and control local Codex sessions through OpenClaw with approval-gated safety.",
    mcp: { command: "loo-mcp-server", transport: "stdio" },
    tools: { prefix: "loo_" },
    configSchema: { type: "object", additionalProperties: false, properties: {} },
    activation: { onStartup: true },
    contracts: { tools: toolNames },
    safety: {
      localOnlyByDefault: true,
      liveControlRequires: ["dry_run", "approval_audit_id"],
      forbiddenClaims: [
        "Full Claude Code parity",
        "cloud sync",
        "unattended desktop takeover",
        "bypasses Codex permissions"
      ]
    }
  });
  writeFileSync(join(rootDir, "openclaw.plugin.json"), manifest);
  writeFileSync(join(rootDir, "packages/openclaw-plugin/openclaw.plugin.json"), manifest);
}
