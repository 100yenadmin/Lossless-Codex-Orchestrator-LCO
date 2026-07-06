import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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
const escapedPackageVersion = packageVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const releaseNotesPath = `docs/releases/RELEASE_NOTES_${packageVersion}.md`;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("current release metadata ships desktop proof-action without widening claims", () => {
  const packageJson = JSON.parse(read("package.json")) as { version?: string };
  const packageLock = JSON.parse(read("package-lock.json")) as { version?: string; packages?: Record<string, { version?: string }> };
  const rootPlugin = JSON.parse(read("openclaw.plugin.json")) as { version?: string };
  const workspacePlugin = JSON.parse(read("packages/openclaw-plugin/openclaw.plugin.json")) as { version?: string };

  assert.equal(packageJson.version, packageVersion);
  assert.equal(packageLock.version, packageVersion);
  assert.equal(packageLock.packages?.[""]?.version, packageVersion);
  assert.equal(rootPlugin.version, packageVersion);
  assert.equal(workspacePlugin.version, packageVersion);
  assert.equal(existsSync(releaseNotesPath), true, `${packageVersion} release notes must exist`);

  const releaseNotes = read(releaseNotesPath);
  assert.match(releaseNotes, /Codex-first local orchestration/i);
  assert.match(releaseNotes, /#160/i);
  assert.match(releaseNotes, /loo_desktop_proof_action/i);
  assert.match(releaseNotes, /loo desktop proof-action/i);
  assert.match(releaseNotes, /CUA Driver TextEdit scratch/i);
  assert.match(releaseNotes, /exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`/i);
  assert.match(releaseNotes, /generic gateway invocation without exact proof args fails closed/i);
  assert.match(releaseNotes, /openclaw_tool_result_not_ok:<tool>/i);
  assert.match(releaseNotes, /output\.details\.ok: false/i);
  assert.match(releaseNotes, /same proof boundary as beta\.35/i);
  assert.match(releaseNotes, /No automatic gateway authorization/i);
  assert.match(releaseNotes, /no broad gateway scope approval/i);
  assert.match(releaseNotes, /no prompt typing/i);
  assert.match(releaseNotes, /no clicking/i);
  assert.match(releaseNotes, /no arbitrary app control/i);
  assert.match(releaseNotes, /no new live Codex control smoke/i);
  assert.match(releaseNotes, /does not run generic GUI mutation/i);
  assert.match(releaseNotes, /does not run Codex GUI mutation/i);
  assert.doesNotMatch(releaseNotes, /Full Claude Code parity|cloud sync supported|unattended desktop takeover supported|generic GUI mutation supported|Codex GUI mutation supported|connected local UI is release-ready/i);
});

test("public beta package and README do not overclaim Claude or desktop control", () => {
  const packageJson = JSON.parse(read("package.json")) as { description?: string };
  const readme = read("README.md");
  const openclawDocs = read("docs/OPENCLAW_PLUGIN.md");
  const plugin = read("packages/openclaw-plugin/src/index.ts");
  const readmePitch = readme.split("## Safety Boundaries")[0] ?? readme;
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
  assert.match(readme, /Claude Code support is an adapter stub/i);
  assert.match(openclawDocs, /approval-gated dry-run/i);
  assert.match(openclawDocs, /live controls approval-gated/i);
});

test("public docs include setup, MCP/OpenClaw, demo, and approval-boundary proof", () => {
  assert.equal(existsSync("docs/SETUP.md"), true, "docs/SETUP.md must exist");
  assert.equal(existsSync("docs/BETA_RELEASE_DEMO.md"), true, "docs/BETA_RELEASE_DEMO.md must exist");
  assert.equal(existsSync("docs/CLAIM_AUDIT.md"), true, "docs/CLAIM_AUDIT.md must exist");
  assert.equal(existsSync("docs/CLAUDE_ADAPTER_BOUNDARY.md"), true, "docs/CLAUDE_ADAPTER_BOUNDARY.md must exist");

  const readme = read("README.md");
  const setup = read("docs/SETUP.md");
  const openclawDocs = read("docs/OPENCLAW_PLUGIN.md");
  const demo = read("docs/BETA_RELEASE_DEMO.md");
  const claimAudit = read("docs/CLAIM_AUDIT.md");
  const claudeBoundary = read("docs/CLAUDE_ADAPTER_BOUNDARY.md");

  assert.match(readme, /docs\/OPENCLAW_PLUGIN\.md/);
  assert.match(readme, /docs\/SETUP\.md/);
  assert.match(readme, /loo index codex --max-files \d+/);
  assert.match(setup, /loo-mcp-server/);
  assert.match(setup, /loo openclaw dogfood/);
  assert.match(setup, /loo openclaw tool-smoke/);
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
    new RegExp(`Allowed Stable ${escapedPackageVersion} Claim`, "i"),
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
  assert.match(claudeBoundary, /read-only session inventory/i);
  assert.match(claudeBoundary, /does not prove Claude Code indexing, control, parity, GUI mutation, or cloud sync/i);
  assert.doesNotMatch(claudeBoundary, /full Claude Code parity|control Claude Code remotely|unattended Claude takeover/i);
});

test("release status examples include live-control evidence alongside release approvals", () => {
  const runbook = read("docs/BETA_RELEASE_RUNBOOK.md");
  const releaseNotes = read(releaseNotesPath);

  for (const [surface, content] of [
    ["release runbook", runbook],
    ["release notes", releaseNotes]
  ] as const) {
    assert.match(content, /release status[^\n]+--approved-live-control-evidence[^\n]+--npm-publish-approval-evidence[^\n]+--github-release-approval-evidence/i, surface);
    assert.match(content, /release status[^\n]+--candidate-sha[^\n]+--github-ci-evidence[^\n]+--codeql-evidence/i, surface);
    assert.doesNotMatch(content, /release status[^\n]+--desktop-gui-approval-evidence/i, `${surface} must not pass GUI approval evidence in a non-GUI release example`);
  }
});

test("read-search-expand-dry-run release examples name the explicit claim scope before omitting live-control proof", () => {
  const surfaces = [
    ["claim audit", read("docs/CLAIM_AUDIT.md")],
    ["release runbook", read("docs/BETA_RELEASE_RUNBOOK.md")],
    ["release notes", read(releaseNotesPath)]
  ] as const;

  for (const [surface, content] of surfaces) {
    assert.match(content, /codex-read-search-expand-dry-run/i, `${surface} must name the read/search/expand/dry-run claim scope`);
    assert.match(content, /--claim-scope\s+codex-read-search-expand-dry-run/i, `${surface} must show the explicit claim-scope flag`);
  }

  const claimAudit = read("docs/CLAIM_AUDIT.md");
  assert.match(claimAudit, /excludedClaims/i);
  assert.match(claimAudit, /approved_live_control_smoke[\s\S]*excluded/i);
});

test("npm dist-tag policy is explicit for stable, beta, and rc channels", () => {
  const readme = read("README.md");
  const setup = read("docs/SETUP.md");
  const claimAudit = read("docs/CLAIM_AUDIT.md");
  const runbook = read("docs/BETA_RELEASE_RUNBOOK.md");

  for (const [surface, content] of [
    ["claim audit", claimAudit],
    ["release runbook", runbook]
  ] as const) {
    assert.match(content, /npm dist-tag policy/i, surface);
    assert.match(content, /latest/i, surface);
    assert.match(content, /beta/i, surface);
    assert.match(content, new RegExp("stable channel\\s+target for this package version is\\s+`" + escapedPackageVersion + "`", "i"), surface);
    assert.match(content, /npm `latest` must move only after/i, surface);
    assert.match(content, /Do not publish\s+a\s+fake stable/i, surface);
    assert.doesNotMatch(content, new RegExp("stable channel\\s+currently points at\\s+`" + escapedPackageVersion + "`", "i"), `${surface} must not claim unpublished candidates are already on latest`);
    assert.doesNotMatch(content, /latest[\s\S]{0,80}1\.0\.0/i, `${surface} must not say latest currently moves to 1.0.0`);
    assert.doesNotMatch(content, /latest[\s\S]{0,200}(?:follows|point at|resolves to)[\s\S]{0,120}newest public beta/i, `${surface} must not imply latest follows the newest beta`);
  }

  assert.match(readme, /npm install -g lossless-openclaw-orchestrator@latest/i);
  assert.match(readme, /npm install -g lossless-openclaw-orchestrator@beta/i);
  assert.match(readme, /`latest` is the stable public channel/i);
  assert.match(readme, /`beta` is the active prerelease train/i);
  assert.match(setup, /npm install -g lossless-openclaw-orchestrator@latest/i);
  assert.match(runbook, /npm dist-tag ls lossless-openclaw-orchestrator/i);
  assert.match(runbook, /npm `latest` must move only after/i);
});

test("README and VISION describe the current stable package without stale release-candidate wording", () => {
  const readme = read("README.md");
  const vision = read("VISION.md");

  assert.match(readme, new RegExp("Current stable:\\s+`" + escapedPackageVersion + "`", "i"));
  assert.match(readme, new RegExp("`" + escapedPackageVersion + "`[\\s\\S]{0,240}shipped", "i"));
  assert.match(readme, /Since 1\.2\.x[\s\S]{0,120}1\.2 prepared-state and summary-leaves lane/i);
  assert.match(vision, new RegExp("stable[\\s\\S]{0,120}`" + escapedPackageVersion + "`[\\s\\S]{0,240}shipped", "i"));
  assert.doesNotMatch(readme, /`1\.3\.[0-9]+` release candidate/i);
  assert.doesNotMatch(vision, /`1\.3\.[0-9]+` release candidate/i);
  assert.doesNotMatch(readme, /release candidate carries post-sprint feature hardening/i);
  assert.doesNotMatch(vision, /release candidate carries the M12 feature/i);
});

test("VISION keeps scratch-thread live smokes standing-approved without widening real-thread approval", () => {
  const vision = read("VISION.md");
  const claimAudit = read("docs/CLAIM_AUDIT.md");
  const proofBoundarySection = vision.match(/## Proof Boundary[\s\S]*?(?=\n## Current Release Gates)/)?.[0] ?? "";
  const doNotClaimSection = proofBoundarySection.match(/Do not claim:[\s\S]*?(?=\nApproval doctrine:)/)?.[0] ?? "";
  const approvalDoctrineSection = proofBoundarySection.match(/Approval doctrine:[\s\S]*$/)?.[0] ?? "";

  for (const [surface, content] of [
    ["VISION", vision],
    ["claim audit", claimAudit]
  ] as const) {
    assert.match(content, /scratch-thread live smokes/i, surface);
    assert.match(content, /standing-approved/i, surface);
    assert.match(content, /thread created by the smoke/i, surface);
    assert.match(content, /harmless/i, surface);
    assert.match(content, /real user threads[\s\S]{0,240}exact-target approval/i, surface);
    assert.doesNotMatch(content, /standing-approved\s+(?:class\s+)?for real user threads/i, `${surface} must not approve real-thread live control broadly`);
  }

  assert.match(approvalDoctrineSection, /scratch-thread live smokes[\s\S]{0,160}standing-approved/i);
  assert.doesNotMatch(doNotClaimSection, /scratch-thread live smokes[\s\S]{0,160}standing-approved/i);
});

test("stable and prerelease package metadata pins the intended npm dist-tag", () => {
  const packageJson = JSON.parse(read("package.json")) as {
    version?: string;
    publishConfig?: { tag?: string };
  };
  const runbook = read("docs/BETA_RELEASE_RUNBOOK.md");
  const version = packageJson.version ?? "";

  if (version.includes("-beta.")) {
    assert.equal(packageJson.publishConfig?.tag, "beta");
    assert.match(runbook, /npm publish --tag beta/i);
    assert.match(runbook, /public betas publish with `npm publish --tag beta`/i);
    return;
  }

  if (version.includes("-rc.")) {
    assert.equal(packageJson.publishConfig?.tag, "next");
    assert.match(runbook, /npm publish --tag next/i);
    assert.match(runbook, /publishConfig\.tag[\s\S]{0,120}`next`/i);
    assert.match(runbook, /Do not run untagged `npm publish` for\s+any prerelease lane/i);
    return;
  }

  assert.equal(packageJson.publishConfig?.tag, "latest");
  assert.match(runbook, /npm publish --tag latest/i);
  assert.match(runbook, /npm `latest` must move only after/i);
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
    /relative --evidence-dir/i,
    /from inside the evidence root/i,
    /synthetic corpus/i,
    /live-store content can never be public evidence/i,
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
    /node \.\/dist\/packages\/cli\/src\/index\.js scorecards sweep[^\n]+--claim-scope codex-live-control[^\n]+--scorecard-dir "\$release_scorecard_source"/i,
    /If the release candidate intentionally excludes live Codex control[\s\S]+node \.\/dist\/packages\/cli\/src\/index\.js scorecards sweep[^\n]+--claim-scope codex-read-search-expand-dry-run/i,
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
    /node \.\/dist\/packages\/cli\/src\/index\.js openclaw dogfood[^\n]+--required-tool loo_doctor[^\n]+--required-tool loo_search_sessions[^\n]+--required-tool loo_describe_session[^\n]+--required-tool loo_expand_session[^\n]+--required-tool loo_expand_query[^\n]+--required-tool loo_codex_plans[^\n]+--required-tool loo_codex_final_messages[^\n]+--required-tool loo_codex_thread_map[^\n]+--required-tool loo_codex_control_dry_run/i,
    /node \.\/dist\/packages\/cli\/src\/index\.js openclaw tool-smoke[^\n]+--profile lco-dogfood[^\n]+--session-key agent:main:lco-dogfood[^\n]+--required-tool loo_doctor[^\n]+--required-tool loo_search_sessions[^\n]+--required-tool loo_describe_session[^\n]+--required-tool loo_expand_session[^\n]+--required-tool loo_expand_query[^\n]+--required-tool loo_codex_plans[^\n]+--required-tool loo_codex_final_messages[^\n]+--required-tool loo_codex_thread_map[^\n]+--required-tool loo_codex_control_dry_run[^\n]+--evidence-path[^\n]+--strict/i,
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
    /relative --evidence-dir/i,
    /synthetic corpus/i,
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
    version?: string;
    type?: string;
    files?: string[];
    openclaw?: { extensions?: string[]; runtimeExtensions?: string[]; compat?: { pluginApi?: string }; build?: { openclawVersion?: string } };
  };
  const manifest = JSON.parse(read("openclaw.plugin.json")) as {
    id?: string;
    version?: string;
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
    version?: string;
    mcp?: { command?: string; transport?: string };
    contracts?: { tools?: unknown[]; toolDeclarations?: unknown[] };
  };
  const expectedTools = createLooToolDeclarations({ includeAliases: true });
  const expectedBaseTools = createLooToolDeclarations({ includeAliases: false });
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
  assert.equal(manifest.version, packageJson.version);
  assert.equal(sourceManifest.version, packageJson.version);
  assert.equal(sourceManifest.mcp?.command, manifest.mcp?.command);
  assert.deepEqual([...expectedBaseTools.map((tool) => tool.name)].sort(), Object.keys(LOO_COMMAND_POLICY).sort());
  assert.equal(manifest.name, "Lossless OpenClaw Orchestrator");
  assert.match(manifest.description ?? "", /local Codex sessions/i);
  assert.match(manifest.description ?? "", /approval-gated dry-run\/control boundaries/i);
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
    "permission bypass"
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
  assert.equal(payload.artifactManifestPath, "release-preflight.json");
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
    "permission bypass",
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
    { id: "approved_live_control_smoke", blockerIfClaimed: "approved_live_control_smoke_missing" },
    { id: "codex_working_app_runtime_proof", blockerIfClaimed: "working_app_runtime_proof_missing" }
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
      "permission bypass"
    ].join("\n")
  });

  const payload = runReleasePreflight({ rootDir });

  assert.equal(payload.checks.readme?.ok, false);
  assert.match(payload.checks.readme?.detail ?? "", /safety boundaries/i);
  assert.deepEqual(payload.blockers, ["readme_failed", "approved_live_control_smoke_missing"]);
});

test("release preflight README gate preserves maintainer proof commands", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-readme-commands-root-"));
  writeProjectSkeleton(rootDir);
  const readmeWithoutProofCommands = readFileSync(join(rootDir, "README.md"), "utf8")
    .replace(/^loo release preflight$/m, "")
    .replace(/^loo release demo-status$/m, "")
    .replace(/^loo release status$/m, "");
  writeFileSync(join(rootDir, "README.md"), readmeWithoutProofCommands);

  const payload = runReleasePreflight({ rootDir });

  assert.equal(payload.checks.readme?.ok, false);
  assert.match(payload.checks.readme?.detail ?? "", /public setup path/i);
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
  mkdirSync(join(evidenceDir, "nested", "state"), { recursive: true });
  writeFileSync(join(evidenceDir, "session.jsonl"), "{}\n");
  writeFileSync(join(evidenceDir, "private.sqlite"), "");
  writeFileSync(join(evidenceDir, "nested", "state", "openclaw.sqlite-wal"), "");
  writeFileSync(join(evidenceDir, "nested", "state", "openclaw.sqlite-shm"), "");
  writeFileSync(join(evidenceDir, "nested", "config-audit.jsonl"), "{}\n");
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
    { name: "nested/config-audit.jsonl", reason: "raw_codex_jsonl" },
    { name: "nested/state/openclaw.sqlite-shm", reason: "sqlite_database" },
    { name: "nested/state/openclaw.sqlite-wal", reason: "sqlite_database" },
    { name: "private.sqlite", reason: "sqlite_database" },
    { name: "session.jsonl", reason: "raw_codex_jsonl" }
  ]);
});

test("release preflight ignores symlinked evidence directories and catches SQLite sidecar variants", (t) => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-symlinks-"));
  const externalDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-external-"));
  mkdirSync(join(evidenceDir, "nested", "state"), { recursive: true });
  mkdirSync(join(evidenceDir, ".hidden"), { recursive: true });
  writeFileSync(join(evidenceDir, "nested", "state", "cache.sqlite-wal"), "");
  writeFileSync(join(evidenceDir, "nested", "state", "cache.sqlite-shm"), "");
  writeFileSync(join(evidenceDir, "nested", "state", "cache.sqlite3-wal"), "");
  writeFileSync(join(evidenceDir, "nested", "state", "cache.sqlite3-shm"), "");
  writeFileSync(join(evidenceDir, "nested", "state", "cache.db-wal"), "");
  writeFileSync(join(evidenceDir, "nested", "state", "cache.db-shm"), "");
  writeFileSync(join(evidenceDir, ".hidden", "hidden.sqlite3"), "");
  writeFileSync(join(externalDir, "external.sqlite"), "");
  writeFileSync(join(externalDir, "external.jsonl"), "{}\n");

  try {
    symlinkSync(evidenceDir, join(evidenceDir, "loop"), "dir");
    symlinkSync(externalDir, join(evidenceDir, "external-link"), "dir");
  } catch {
    t.skip("filesystem does not allow directory symlinks in this environment");
    return;
  }

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "preflight",
    "--claim-scope",
    "codex-working-app-proof",
    "--evidence-dir",
    evidenceDir,
    "--strict"
  ], { cwd: process.cwd(), encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Maximum call stack|ELOOP|external\.sqlite|external\.jsonl/i);
  const payload = JSON.parse(result.stdout) as {
    blockers: string[];
    rawSessionArtifacts: Array<{ name: string; reason: string }>;
  };
  assert.equal(payload.blockers.includes("raw_session_artifacts_present"), true);
  assert.deepEqual(payload.rawSessionArtifacts, [
    { name: ".hidden/hidden.sqlite3", reason: "sqlite_database" },
    { name: "nested/state/cache.db-shm", reason: "sqlite_database" },
    { name: "nested/state/cache.db-wal", reason: "sqlite_database" },
    { name: "nested/state/cache.sqlite-shm", reason: "sqlite_database" },
    { name: "nested/state/cache.sqlite-wal", reason: "sqlite_database" },
    { name: "nested/state/cache.sqlite3-shm", reason: "sqlite_database" },
    { name: "nested/state/cache.sqlite3-wal", reason: "sqlite_database" }
  ]);
});

test("release preflight reports a deterministic blocker for too-deep evidence trees", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "loo-release-preflight-depth-"));
  let cursor = evidenceDir;
  for (let index = 0; index < 42; index += 1) {
    cursor = join(cursor, `d${index}`);
    mkdirSync(cursor);
  }

  const result = spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    "release",
    "preflight",
    "--claim-scope",
    "codex-read-search-expand-dry-run",
    "--evidence-dir",
    evidenceDir,
    "--strict"
  ], { cwd: process.cwd(), encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Maximum call stack|RangeError/i);
  const payload = JSON.parse(result.stdout) as {
    blockers: string[];
    rawSessionArtifacts: Array<{ name: string; reason: string }>;
    evidenceScanDepthExceeded: string[];
  };
  assert.deepEqual(payload.blockers, ["evidence_scan_depth_exceeded"]);
  assert.deepEqual(payload.rawSessionArtifacts, []);
  assert.deepEqual(payload.evidenceScanDepthExceeded, [
    "d0/d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d12/d13/d14/d15/d16/d17/d18/d19/d20/d21/d22/d23/d24/d25/d26/d27/d28/d29/d30/d31/d32/d33/d34/d35/d36/d37/d38/d39/d40"
  ]);
});

function writeProjectSkeleton(rootDir: string, overrides: { readme?: string; runtimeArtifact?: boolean; packageFiles?: string[]; runtimeExtensions?: string[] } = {}): void {
  mkdirSync(join(rootDir, "docs"), { recursive: true });
  mkdirSync(join(rootDir, "packages/openclaw-plugin"), { recursive: true });
  if (overrides.runtimeArtifact !== false) {
    mkdirSync(join(rootDir, "dist/packages/openclaw-plugin/src"), { recursive: true });
    writeFileSync(join(rootDir, "dist/packages/openclaw-plugin/src/index.js"), "export default {};\n");
  }
  const tools = createLooToolDeclarations({ includeAliases: true });
  writeFileSync(join(rootDir, "package.json"), JSON.stringify({
    name: "lossless-openclaw-orchestrator",
    version: "0.1.0-beta.0",
    description: "Index, search, and prepare local Codex sessions for OpenClaw with approval-gated dry-run/control boundaries.",
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
    "docs/SETUP.md",
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
    "docs/CLAIM_AUDIT.md",
    "docs/releases/CHANGELOG.md",
    "License",
    "## Safety Boundaries",
    "Core proof commands",
    "loo release preflight",
    "loo release demo-status",
    "loo release status",
    "Full Claude Code parity",
    "cloud sync",
    "unattended desktop takeover",
    "permission bypass",
    "generic GUI mutation",
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
    description: "Index, search, and prepare local Codex sessions for OpenClaw with approval-gated dry-run/control boundaries.",
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
        "permission bypass"
      ]
    }
  });
  writeFileSync(join(rootDir, "openclaw.plugin.json"), manifest);
  writeFileSync(join(rootDir, "packages/openclaw-plugin/openclaw.plugin.json"), manifest);
}
