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
const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version as string;
const releaseNotesPath = `docs/RELEASE_NOTES_${packageVersion}.md`;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("0.1.0-beta.4 release metadata captures the desktop proof harness without overclaiming publication", () => {
  const packageJson = JSON.parse(read("package.json")) as { version?: string };
  const packageLock = JSON.parse(read("package-lock.json")) as { version?: string; packages?: Record<string, { version?: string }> };

  assert.equal(packageJson.version, "0.1.0-beta.4");
  assert.equal(packageLock.version, "0.1.0-beta.4");
  assert.equal(packageLock.packages?.[""]?.version, "0.1.0-beta.4");
  assert.equal(existsSync("docs/RELEASE_NOTES_0.1.0-beta.4.md"), true, "0.1.0-beta.4 release notes must exist");

  const releaseNotes = read("docs/RELEASE_NOTES_0.1.0-beta.4.md");
  assert.match(releaseNotes, /loo desktop live-proof-harness/i);
  assert.match(releaseNotes, /loo_desktop_live_proof_harness/i);
  assert.match(releaseNotes, /desktop live\/no-focus proof harness/i);
  assert.match(releaseNotes, /does not run live GUI mutation/i);
  assert.match(releaseNotes, /does not publish to npm/i);
  assert.match(releaseNotes, /does not create a GitHub Release/i);
  assert.match(releaseNotes, /codex-read-search-expand-dry-run/i);
  assert.doesNotMatch(releaseNotes, /Full Claude Code parity|cloud sync supported|unattended desktop takeover supported/i);
});

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
  const releaseNotes = read(releaseNotesPath);

  for (const [surface, content] of [
    ["README", readme],
    ["release notes", releaseNotes]
  ] as const) {
    assert.match(content, /loo release status[^\n]+--approved-live-control-evidence[^\n]+--npm-publish-approval-evidence[^\n]+--github-release-approval-evidence/i, surface);
    assert.match(content, /loo release status[^\n]+--candidate-sha[^\n]+--github-ci-evidence[^\n]+--codeql-evidence/i, surface);
    assert.doesNotMatch(content, /loo release status[^\n]+--desktop-gui-approval-evidence/i, `${surface} must not pass GUI approval evidence in a non-GUI release example`);
  }
});

test("read-search-expand-dry-run release examples name the explicit claim scope before omitting live-control proof", () => {
  const surfaces = [
    ["README", read("README.md")],
    ["claim audit", read("docs/CLAIM_AUDIT.md")],
    ["release runbook", read("docs/BETA_RELEASE_RUNBOOK.md")],
    ["release notes", read(releaseNotesPath)]
  ] as const;

  for (const [surface, content] of surfaces) {
    assert.match(content, /codex-read-search-expand-dry-run/i, `${surface} must name the read/search/expand/dry-run claim scope`);
    assert.match(content, /--claim-scope\s+codex-read-search-expand-dry-run/i, `${surface} must show the explicit claim-scope flag`);
  }
  assert.match(read("README.md"), /loo release bundle[^\n]+--claim-scope\s+codex-read-search-expand-dry-run/i);

  const claimAudit = read("docs/CLAIM_AUDIT.md");
  assert.match(claimAudit, /excludedClaims/i);
  assert.match(claimAudit, /approved_live_control_smoke[\s\S]*excluded/i);
});

test("npm beta dist-tag policy is explicit until the first stable release", () => {
  const readme = read("README.md");
  const claimAudit = read("docs/CLAIM_AUDIT.md");
  const runbook = read("docs/BETA_RELEASE_RUNBOOK.md");

  for (const [surface, content] of [
    ["README", readme],
    ["claim audit", claimAudit],
    ["release runbook", runbook]
  ] as const) {
    assert.match(content, /npm dist-tag policy/i, surface);
    assert.match(content, /latest/i, surface);
    assert.match(content, /beta/i, surface);
    assert.match(content, /first stable release/i, surface);
    assert.match(content, /Do not publish\s+a\s+fake stable/i, surface);
  }

  assert.match(readme, /latest[\s\S]{0,200}newest public beta/i);
  assert.match(runbook, /npm dist-tag ls lossless-openclaw-orchestrator/i);
  assert.match(runbook, /move `latest` to the stable/i);
});

test("release workflows use non-deprecated action majors", () => {
  const ciWorkflow = read(".github/workflows/ci.yml");
  const codeqlWorkflow = read(".github/workflows/codeql.yml");
  const workflows = `${ciWorkflow}\n${codeqlWorkflow}`;

  assert.match(ciWorkflow, /actions\/checkout@v7/);
  assert.match(ciWorkflow, /actions\/setup-node@v6/);
  assert.match(codeqlWorkflow, /actions\/checkout@v7/);
  assert.match(codeqlWorkflow, /github\/codeql-action\/init@v4/);
  assert.match(codeqlWorkflow, /github\/codeql-action\/analyze@v4/);
  assert.doesNotMatch(workflows, /actions\/checkout@v4/);
  assert.doesNotMatch(workflows, /actions\/setup-node@v4/);
  assert.doesNotMatch(workflows, /github\/codeql-action\/(?:init|analyze)@v3/);
});

test("beta release runbook defines RC cadence and keeps main distinct from releases", () => {
  assert.equal(existsSync("docs/BETA_RELEASE_RUNBOOK.md"), true, "docs/BETA_RELEASE_RUNBOOK.md must exist");
  assert.equal(existsSync(".github/workflows/codeql.yml"), true, ".github/workflows/codeql.yml must exist");

  const readme = read("README.md");
  const vision = read("VISION.md");
  const runbook = read("docs/BETA_RELEASE_RUNBOOK.md");

  assert.match(readme, /docs\/BETA_RELEASE_RUNBOOK\.md/);
  assert.match(vision, /docs\/BETA_RELEASE_RUNBOOK\.md/);

  for (const required of [
    /npm run check/i,
    /main is the integration branch, not a release/i,
    /release candidate/i,
    /Release Context Freshness Scan/i,
    /long-context release-review agent/i,
    /gpt-5\.4/i,
    /1M-context/i,
    /docs, workflows, skills, and runbooks/i,
    /update this runbook/i,
    /release-context-freshness/i,
    /package scripts/i,
    /local release skills/i,
    /CodeQL code scanning/i,
    /release_scorecard_source/i,
    /cp evals\/scorecards\/v1\.0\/\*\.json "\$release_scorecard_source"/i,
    /fill the copied scorecards/i,
    /node \.\/dist\/packages\/cli\/src\/index\.js scorecards sweep[^\n]+--scorecard-dir "\$release_scorecard_source"/i,
    /node \.\/dist\/packages\/cli\/src\/index\.js release preflight/i,
    /node \.\/dist\/packages\/cli\/src\/index\.js release bundle/i,
    /node \.\/dist\/packages\/cli\/src\/index\.js release demo-status/i,
    /node \.\/dist\/packages\/cli\/src\/index\.js release status[^\n]+--candidate-sha "\$release_candidate_sha"[^\n]+--github-ci-evidence[^\n]+--codeql-evidence/i,
    /high-context document\/workflow scan/i,
    /README\.md, `VISION\.md`, release notes, claim audit, GitHub workflows, and CLI release gates/i,
    /repository gate evidence/i,
    /gh workflow list/i,
    /gh run list[^\n]+--commit "\$release_candidate_sha"[^\n]+--workflow CI/i,
    /gh run list[^\n]+--commit "\$release_candidate_sha"[^\n]+--workflow CodeQL/i,
    /gh api repos\/100yenadmin\/Lossless-Codex-Orchestrator-LCO\/rulesets/i,
    /code-scanning\/alerts\?state=open/i,
    /loo_release_check_evidence/i,
    /warnings: \[\]/i,
    /github_ci_warnings_present/i,
    /codeql_warnings_present/i,
    /safety bypass review/i,
    /retrieval quality review/i,
    /packaging\/install review/i,
    /public-claim review/i,
    /local-agent usability review/i,
    /node \.\/dist\/packages\/cli\/src\/index\.js openclaw dogfood[^\n]+--required-tool loo_doctor[^\n]+--required-tool loo_search_sessions[^\n]+--required-tool loo_describe_session[^\n]+--required-tool loo_expand_query[^\n]+--required-tool loo_codex_plans[^\n]+--required-tool loo_codex_final_messages[^\n]+--required-tool loo_codex_thread_map[^\n]+--required-tool loo_codex_control_dry_run/i,
    /node \.\/dist\/packages\/cli\/src\/index\.js openclaw tool-smoke[^\n]+--profile lco-dogfood[^\n]+--session-key agent:main:lco-dogfood[^\n]+--required-tool loo_doctor[^\n]+--required-tool loo_search_sessions[^\n]+--required-tool loo_describe_session[^\n]+--required-tool loo_expand_query[^\n]+--required-tool loo_codex_plans[^\n]+--required-tool loo_codex_final_messages[^\n]+--required-tool loo_codex_thread_map[^\n]+--required-tool loo_codex_control_dry_run[^\n]+--evidence-path[^\n]+--strict/i,
    /--approved-live-control-evidence \/Volumes\/LEXAR\/Codex\/lossless-openclaw-orchestrator\/YYYY-MM-DD\/release-status\/approved-live-control-smoke\.json/i,
    /--npm-publish-approval-evidence \/Volumes\/LEXAR\/Codex\/lossless-openclaw-orchestrator\/YYYY-MM-DD\/release-status\/npm-approval\.json/i,
    /--github-release-approval-evidence \/Volumes\/LEXAR\/Codex\/lossless-openclaw-orchestrator\/YYYY-MM-DD\/release-status\/github-release-approval\.json/i,
    /--github-ci-evidence \/Volumes\/LEXAR\/Codex\/lossless-openclaw-orchestrator\/YYYY-MM-DD\/release-status\/github-ci\.json/i,
    /--codeql-evidence \/Volumes\/LEXAR\/Codex\/lossless-openclaw-orchestrator\/YYYY-MM-DD\/release-status\/codeql\.json/i,
    /--desktop-gui-required --desktop-gui-approval-evidence \/Volumes\/LEXAR\/Codex\/lossless-openclaw-orchestrator\/YYYY-MM-DD\/release-status\/desktop-gui-approval\.json/i,
    /desktopBackend/i,
    /targetApp/i,
    /targetWindow/i,
    /actionHash/i,
    /focusBeforeApplication/i,
    /focusAfterApplication/i,
    /focusChanged: false/i,
    /focusProof/i,
    /rawScreenshotIncluded: false/i,
    /status_probe_only_no_action/i,
    /not_measured/i,
    /metadata-only\s+install\/tool-declaration coverage/i,
    /real OpenClaw\s+gateway tool-call evidence/i,
    /npm pack --dry-run/i,
    /GitHub Release/i,
    /npm publish/i,
    /explicit user approval/i,
    /public release means both the npm package surface and the\s+GitHub Release surface/i,
    /requires\s+both `operation: "npm_publish"` and `operation: "github_release"` approval\s+markers/i,
    /single-surface maintenance\s+publication/i,
    /do not run live Codex control/i,
    /do not run GUI mutation/i,
    /evidence.*\/Volumes\/LEXAR\/Codex\/lossless-openclaw-orchestrator/i,
    /issue #6/i,
    /issue #14/i
  ]) {
    assert.match(runbook, required);
  }

  for (const required of [
    /release_scorecard_source/i,
    /cp evals\/scorecards\/v1\.0\/\*\.json "\$release_scorecard_source"/i,
    /fill the copied scorecards/i,
    /loo scorecards sweep[^\n]+--scorecard-dir "\$release_scorecard_source"/i,
    /--candidate-sha <release-candidate-sha>/i,
    /--github-ci-evidence/i,
    /--codeql-evidence/i,
    /high-context document\/workflow scan/i,
    /safety bypass review/i,
    /public-claim review/i,
    /local-agent usability review/i,
    /github_ci_warnings_present/i,
    /codeql_warnings_present/i,
    /public release means both npm package publication and\s+GitHub Release creation/i,
    /single-surface maintenance\s+publication/i
  ]) {
    assert.match(read("docs/CLAIM_AUDIT.md"), required);
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
    contracts?: { tools?: unknown[]; toolDeclarations?: unknown[] };
    safety?: { localOnlyByDefault?: boolean; liveControlRequires?: string[]; forbiddenClaims?: string[] };
  };
  const sourceManifest = JSON.parse(read("packages/openclaw-plugin/openclaw.plugin.json")) as {
    id?: string;
    mcp?: { command?: string; transport?: string };
    contracts?: { tools?: unknown[]; toolDeclarations?: unknown[] };
  };
  const expectedTools = createLooToolDeclarations();
  const expectedToolNames = expectedTools.map((tool) => tool.name);

  assert.equal(packageJson.name, "lossless-openclaw-orchestrator");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.files?.includes("openclaw.plugin.json"), true);
  assert.deepEqual(packageJson.openclaw?.extensions, ["./dist/packages/openclaw-plugin/src/index.js"]);
  assert.equal(packageJson.openclaw?.runtimeExtensions, undefined);
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
  assert.deepEqual(manifest.contracts?.toolDeclarations, expectedTools);
  assert.deepEqual(sourceManifest.contracts?.toolDeclarations, expectedTools);
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

test("release preflight --claim-scope codex-read-search-expand-dry-run excludes live-control proof without hiding the boundary", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-read-scope-"));
  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "preflight",
    "--evidence-dir",
    evidenceDir,
    "--claim-scope",
    "codex-read-search-expand-dry-run",
    "--strict"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout) as {
    claimScope?: string;
    releaseReady?: boolean;
    checks?: Record<string, { ok: boolean; detail: string }>;
    blockers?: string[];
    excludedClaims?: Array<{ id: string; blockerIfClaimed: string }>;
  };

  assert.equal(payload.claimScope, "codex-read-search-expand-dry-run");
  assert.equal(payload.releaseReady, true);
  assert.equal(payload.checks?.liveControlSmoke?.ok, false);
  assert.match(payload.checks?.liveControlSmoke?.detail ?? "", /excluded by claim scope/i);
  assert.deepEqual(payload.blockers, []);
  assert.deepEqual(payload.excludedClaims, [
    { id: "approved_live_control_smoke", blockerIfClaimed: "approved_live_control_smoke_missing" }
  ]);

  const manifest = JSON.parse(read(join(evidenceDir, "release-preflight.json"))) as {
    claimScope?: string;
    excludedClaims?: Array<{ id: string; blockerIfClaimed: string }>;
  };
  assert.equal(manifest.claimScope, "codex-read-search-expand-dry-run");
  assert.deepEqual(manifest.excludedClaims, payload.excludedClaims);
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

test("release preflight rejects stale OpenClaw runtimeExtensions metadata", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-stale-runtime-"));
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-stale-runtime-evidence-"));
  const liveControlProof = join(evidenceDir, "approved-live-control-smoke.json");
  writeProjectSkeleton(rootDir, {
    runtimeExtensions: ["./packages/openclaw-plugin/src/index.ts"]
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

function writeProjectSkeleton(rootDir: string, overrides: { readme?: string; runtimeArtifact?: boolean; packageFiles?: string[]; runtimeExtensions?: string[] } = {}): void {
  mkdirSync(join(rootDir, "docs"), { recursive: true });
  mkdirSync(join(rootDir, "packages/openclaw-plugin"), { recursive: true });
  if (overrides.runtimeArtifact !== false) {
    mkdirSync(join(rootDir, "dist/packages/openclaw-plugin/src"), { recursive: true });
    writeFileSync(join(rootDir, "dist/packages/openclaw-plugin/src/index.js"), "export default {};\n");
  }
  const tools = createLooToolDeclarations();
  writeFileSync(join(rootDir, "package.json"), JSON.stringify({
    name: "lossless-openclaw-orchestrator",
    version: "0.1.0-beta.0",
    description: "Index, search, and control local Codex sessions through OpenClaw with approval-gated safety.",
    files: overrides.packageFiles ?? ["dist", "packages", "docs", "openclaw.plugin.json", "README.md", "LICENSE", "SECURITY.md"],
    openclaw: {
      extensions: ["./dist/packages/openclaw-plugin/src/index.js"],
      ...(overrides.runtimeExtensions ? { runtimeExtensions: overrides.runtimeExtensions } : {}),
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
    contracts: { tools: tools.map((tool) => tool.name), toolDeclarations: tools },
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
