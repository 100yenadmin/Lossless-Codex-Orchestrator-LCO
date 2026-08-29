import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("GA README is a public landing page with first-run setup path", () => {
  const readme = read("README.md");

  assert.match(readme, /^# Lossless Codex Orchestrator/m);
  assert.doesNotMatch(readme, /^# Orchestrator CCC\+L/m);

  for (const required of [
    /docs\/SETUP\.md/,
    /## What It Does/,
    /## Install/,
    /## Set Up/,
    /## First Workflow/,
    /## OpenClaw And MCP/,
    /## Privacy And Local Data/,
    /npm install -g lossless-codex-orchestrator@latest/,
    /lco doctor/,
    /lco index codex/,
    /lco search/,
    /lco describe/,
    /lco expand/,
    /lco-mcp-server/,
    /skills\/lossless-openclaw-orchestrator\/SKILL\.md/,
    /docs\/OPENCLAW_PLUGIN\.md/,
    /docs\/PRIVACY\.md/
  ]) {
    assert.match(readme, required);
  }

  assert.doesNotMatch(readme, /## Current Sprint:/);
  assert.doesNotMatch(readme, /What a local OpenClaw agent can do today[\s\S]{1000,}/);
  assert.doesNotMatch(readme, /Scorecard and release proof commands:/);
  assert.doesNotMatch(readme, /Claim Audit|lco release preflight|lco release general-readiness|issue-<number>-scorecard-sweep/);
  assert.doesNotMatch(readme, /#307 separates[\s\S]+#308 reports/i);
});

test("setup guide covers install, local indexing, OpenClaw, MCP, and troubleshooting", () => {
  assert.equal(existsSync("docs/SETUP.md"), true, "docs/SETUP.md must exist");
  const setup = read("docs/SETUP.md");

  for (const required of [
    /^# Setup Guide/m,
    /Node\.js 22/,
    /npm install -g lossless-codex-orchestrator@latest/,
    /LCO_DB_PATH/,
    /LCO_LCM_DB_PATHS/,
    /isolated npm prefix/i,
    /fresh LCO_DB_PATH/i,
    /local repo build/i,
    /lco doctor/,
    /not_indexed_yet/,
    /codexJsonlDrift/,
    /lco index codex/,
    /~\/.codex\/sessions/,
    /~\/.codex\/archived_sessions/,
    /lco search/,
    /lco describe/,
    /lco expand/,
    /lco-mcp-server/,
    /managed Eva operator flow[\s\S]+standard socket under `CODEX_HOME`/i,
    /explicit-socket override[\s\S]+cannot target or certify/i,
    /OpenClaw/,
    /lco openclaw published-smoke/,
    /--binary-probe-report binary-probe\.json/,
    /LCO_DOGFOOD_REPORT/,
    /invalid audit key/i,
    /do not silently regenerate/i,
    /earlier session-diff cursors.*invalid/i,
    /LCO_TOOL_SMOKE_REPORT/,
    /LCO_EVIDENCE_DIR/,
    /npm selector.*tarball fallback/i,
    /lco openclaw tool-smoke/,
    /CUA Driver is the preferred\/default\s+desktop fallback backend/i,
    /not bundled by LCO/i,
    /desktop-fallback readiness blocker/i,
    /cua-driver mcp --help/,
    /do not treat a CUA `type_text` success\s+payload or ready desktop proof packet as proof/i,
    /Troubleshooting/,
    /Uninstall/,
    /does not read raw transcripts by default/i,
    /dry-run/i,
    /approval_audit_id/
  ]) {
    assert.match(setup, required);
  }
});

test("Hermes docs keep stdio first-run separate from managed-daemon admission", () => {
  const readme = read("README.md");
  const setup = read("docs/SETUP.md");
  const operations = read("openwiki/operations.md");

  assert.match(readme, /Hermes configuration[\s\S]+LCO_CODEX_TRANSPORT: stdio/);
  assert.match(readme, /docs\/SETUP\.md#managed-daemon-admission-and-rollback/);
  assert.doesNotMatch(readme, /Hermes configuration[\s\S]{0,400}LCO_CODEX_TRANSPORT: daemon/);

  for (const required of [
    /#### Managed Daemon Admission And Rollback/,
    /managed executable\s+realpath and hash/i,
    /CLI\/managed\/app-server version tuple/i,
    /socket\s+type\/mode\/owner\/inode/i,
    /process id\/start time\/command/i,
    /chmod 600/,
    /shasum -a 256/,
    /stat -f/,
    /managed_codex_path=.*managed-path/,
    /pgrep -f "\^\$\{managed_codex_path\} app-server --listen unix:\/\/\$"/,
    /ps -p/,
    /diff -rq/,
    /codex app-server daemon stop/,
    /pre-existing listener and never stop it/i
  ]) {
    assert.match(setup, required);
  }

  assert.match(operations, /\.\.\/docs\/SETUP\.md#managed-daemon-admission-and-rollback/);
  assert.match(operations, /byte-identical/i);
  assert.match(operations, /forbidden for a pre-existing or\s+unclassified listener/i);
});

test("managed-daemon rollback reaches stop only for a matching candidate-created fingerprint", () => {
  const setup = read("docs/SETUP.md");
  const rollback = setup.match(/```bash\n(if test "\$daemon_origin"[\s\S]*?)\n```/);
  assert.ok(rollback, "setup must contain the executable conditional-stop block");

  function run(origin: string, diffStatus: 0 | 1) {
    const script = `
daemon_origin=${JSON.stringify(origin)}
daemon_receipt_dir=/private/original
daemon_recheck_dir=/private/recheck
diff() { return ${diffStatus}; }
codex() { printf 'codex:%s\\n' "$*"; }
${rollback[1]}
`;
    const shell = process.platform === "darwin" ? "zsh" : "bash";
    const result = spawnSync(shell, ["-c", script], { encoding: "utf8" });
    assert.equal(result.error, undefined, `${shell} must execute the documented guard`);
    return result;
  }

  const preexisting = run("preexisting", 0);
  assert.notEqual(preexisting.status, 0);
  assert.doesNotMatch(preexisting.stdout, /app-server daemon stop/);

  const mismatch = run("candidate-created", 1);
  assert.notEqual(mismatch.status, 0);
  assert.doesNotMatch(mismatch.stdout, /app-server daemon stop/);

  const exactMatch = run("candidate-created", 0);
  assert.equal(exactMatch.status, 0);
  assert.match(exactMatch.stdout, /^codex:app-server daemon stop\n$/);
});

test("public control docs use the route and identical-delivery facade", () => {
  const readme = read("README.md");
  const openclaw = read("docs/OPENCLAW_PLUGIN.md");

  for (const [surface, content] of [
    ["README", readme],
    ["OpenClaw guide", openclaw]
  ] as const) {
    assert.match(content, /lco_codex_control_route/, `${surface} must name opaque routing`);
    assert.match(content, /lco_codex_deliver/, `${surface} must name public delivery`);
  }

  assert.match(openclaw, /route → identical `lco_codex_deliver` dry-run →\s+approval → live delivery/i);
  assert.match(openclaw, /route again[\s\S]+fresh active, turn-bound target/i);
  assert.doesNotMatch(
    openclaw,
    /`public_facade`:[\s\S]{0,500}`lco_codex_control_dry_run`[\s\S]{0,100}`lco_codex_resume_thread`/
  );
});

test("public operator docs explain the bounded lco drive dry-run workflow", () => {
  const setup = read("docs/SETUP.md");
  const openclaw = read("docs/OPENCLAW_PLUGIN.md");
  const vision = read("VISION.md");

  for (const [surface, content] of [
    ["setup guide", setup],
    ["OpenClaw guide", openclaw],
    ["vision", vision]
  ] as const) {
    assert.match(content, /lco drive/i, `${surface} must name the bounded drive workflow`);
    assert.match(content, /review-then-drive/i, `${surface} must describe the workflow purpose`);
    assert.match(content, /dry-run/i, `${surface} must keep the proof boundary explicit`);
  }

  assert.match(setup, /--reviewer claude[\s\S]*--driver codex/);
  assert.match(openclaw, /lco_drive/);
  assert.match(openclaw, /"target_ref": "codex_thread:<thread-id>"/);
  assert.match(openclaw, /"max_turns": 4[\s\S]*"token_budget": 1000[\s\S]*"timeout_ms": 120000[\s\S]*"cost_ceiling_usd": 1/);
  assert.match(vision, /does not run a reviewer/i);
});

test("public docs document index byte cap and fresh-user tarball recovery commands", () => {
  const readme = read("README.md");
  const setup = read("docs/SETUP.md");

  for (const [surface, content] of [
    ["README", readme],
    ["setup guide", setup]
  ] as const) {
    assert.match(content, /256\s*MB\s*\/\s*200,000-event per-file index cap/i, `${surface} must name the default per-file cap`);
    assert.match(content, /--max-bytes-per-file/i, `${surface} must document the override flag`);
    assert.match(content, /--max-events-per-file/i, `${surface} must document the event override flag`);
    assert.match(content, /npm view lossless-codex-orchestrator@[a-z]+ dist\.tarball/i, `${surface} must show a raw npm tarball lookup`);
    assert.match(content, /npm install -g "\$tarball_url"/i, `${surface} must show a raw npm tarball install`);
  }
});

test("setup guide tells Codex and Claude users how to install agent provenance rules safely", () => {
  const setup = read("docs/SETUP.md");

  for (const required of [
    /AGENTS\.md/,
    /CLAUDE\.md/,
    /Codex-oriented/i,
    /Claude-oriented/i,
    /#436/,
    /correlation handles, not authorization/i,
    /raw transcripts, secrets,[\s\S]*private logs/i,
    /private paths/i,
    /screenshots/i,
    /customer data/i,
    /connector URLs/i,
    /visible block/i,
    /hidden marker/i
  ]) {
    assert.match(setup, required);
  }
});

test("public docs preserve release claim boundaries", () => {
  const readme = read("README.md");
  const setup = read("docs/SETUP.md");
  const claimAudit = read("docs/CLAIM_AUDIT.md");
  const publicDocs = `${readme}\n${setup}\n${claimAudit}`;

  for (const required of [
    /local Codex/i,
    /local SQLite/i,
    /Claude Code local JSONL read\/recall/i,
    /lco index claude/i,
    /no cloud sync/i,
    /no unattended desktop takeover/i,
    /no permission bypass/i,
    /no enterprise/i,
    /generic GUI mutation/i
  ]) {
    assert.match(publicDocs, required);
  }

  assert.match(readme, /`lco`, `lco-mcp-server`, and canonical `lco_\*` tools/i);
  assert.match(readme, /historical `loo`[\s\S]{0,180}compatibility aliases/i);
  assert.match(readme, /`loo-mcp-server`[\s\S]{0,180}compatibility aliases/i);
  assert.match(readme, /lossless-codex-orchestrator[\s\S]{0,180}current published npm package/i);
  assert.match(readme, /deprecated compat package[\s\S]{0,180}lossless-openclaw-orchestrator/i);
  assert.match(readme, /at least two minor releases/i);
  assert.match(readme, /Give your main agent a memory and command layer for all your Codex projects and threads\./i);
  assert.match(readme, /field-weighted FTS5 search[\s\S]{0,80}session-card discovery/i);
  assert.match(readme, /remembered content phrases[\s\S]{0,120}`lco grep`[\s\S]{0,120}`lco expand-query`/i);
  assert.match(readme, /prepared cards/i);
  assert.match(readme, /summary leaves/i);
  assert.match(readme, /attention inbox/i);
  assert.match(readme, /project digest/i);
  assert.match(readme, /dry-run command packets/i);
  assert.match(readme, /npm selector[\s\S]*tarball\s+fallback/i);
  assert.match(setup, /CUA Driver is the preferred\/default\s+desktop fallback backend/i);
  assert.match(setup, /do not treat a CUA `type_text` success\s+payload or ready desktop proof packet as proof/i);
  assert.match(claimAudit, /No cloud sync/i);
  assert.doesNotMatch(readme, /no cloud sync|no unattended desktop takeover|no permission bypass|CUA Driver/i);

  assert.doesNotMatch(publicDocs, /Full Claude Code parity is supported/i);
  assert.doesNotMatch(publicDocs, /cloud sync is supported/i);
  assert.doesNotMatch(publicDocs, /unattended desktop takeover is supported/i);
  assert.doesNotMatch(publicDocs, /bypasses Codex permissions/i);
  assert.doesNotMatch(publicDocs, /generic GUI mutation is supported/i);
  assert.doesNotMatch(readme, /verify `cua-driver mcp` availability through `lco doctor/i);
});

test("release-captain docs include repeatable full gateway coverage smoke", () => {
  const qaLab = read("docs/QA_LAB.md");
  const runbook = read("docs/BETA_RELEASE_RUNBOOK.md");
  const releaseDocs = `${qaLab}\n${runbook}`;

  assert.match(releaseDocs, /release-captain/i);
  assert.match(releaseDocs, /openclaw tool-smoke[^\n]+--coverage full/i);
  assert.match(releaseDocs, /full\s+68-call|68-call\s+gateway/i);
  assert.match(releaseDocs, /lco_watchers/);
  assert.match(releaseDocs, /lco_codex_extract/);
  assert.match(releaseDocs, /lco_prepared_state/);
  assert.match(releaseDocs, /lco_operating_picture/);
  assert.match(releaseDocs, /lco_desktop_proof/);
  assert.match(releaseDocs, /lco_session_diff/);
  assert.match(releaseDocs, /lco_drive/);
  assert.match(qaLab, /37 of the 39[\s\S]+must remain[\s\S]+blocked at 37\/39/i);
  assert.match(qaLab, /LCO_CODEX_TRANSPORT=daemon\s+node \.\/dist\/packages\/cli\/src\/index\.js qa-lab eva-idle-route/i);
  assert.match(qaLab, /--candidate-sha\s+78bd6e7d4e5656d09e76c4c85d01a85b3515b354/i);
  assert.doesNotMatch(qaLab, /LCO_CODEX_TRANSPORT=daemon\s+lco qa-lab eva-idle-route/i);
});

test("operator control docs re-route before interrupting an idle send", () => {
  const setup = read("docs/SETUP.md");
  const workflows = read("openwiki/workflows.md");
  const operatorDocs = `${setup}\n${workflows}`;

  assert.match(operatorDocs, /before[^\n]+interrupt[\s\S]+route[^\n]+again[\s\S]+fresh active, turn-bound/i);
  assert.match(operatorDocs, /never reuse[\s\S]+pre-delivery[^\n]+target/i);
  assert.doesNotMatch(operatorDocs, /interrupt[^\n]+same opaque target/i);
});

test("control-plane threat model stays in operator docs, not public release notes", () => {
  assert.equal(existsSync("docs/CONTROL_PLANE_THREAT_MODEL.md"), true);
  const threatModel = read("docs/CONTROL_PLANE_THREAT_MODEL.md");
  const checklist = read("docs/RELEASE_CHECKLIST.md");
  const changelog = read("docs/releases/CHANGELOG.md");
  const linkedNotes = [...changelog.matchAll(/\]\((RELEASE_NOTES_[^)]+\.md)\)/g)].map(
    (match) => `docs/releases/${match[1]}`
  );

  for (const required of [
    /^# Control Plane Threat Model/m,
    /operator-facing/i,
    /token scope/i,
    /local binding/i,
    /database and cache blast radius/i,
    /gateway-token leakage/i,
    /approval audit semantics/i,
    /scratch-session doctrine/i,
    /rollback handles/i
  ]) {
    assert.match(threatModel, required);
  }

  assert.match(checklist, /docs\/CONTROL_PLANE_THREAT_MODEL\.md/);
  assert.match(checklist, /control-plane threat model/i);

  const operatorOnlyLanguage =
    /gateway-token leakage|database and cache blast radius|scratch-session doctrine|rollback handles|approval audit semantics/i;
  for (const file of linkedNotes) {
    assert.doesNotMatch(read(file), operatorOnlyLanguage, file);
  }
});

test("dual-name npm rollback runbook is operator-facing and linked from release gates", () => {
  const runbookPath = "docs/RELEASE_ROLLBACK.md";
  assert.equal(existsSync(runbookPath), true, "operator rollback runbook must exist");
  const runbook = read(runbookPath);
  const checklist = read("docs/RELEASE_CHECKLIST.md");
  const betaRunbook = read("docs/BETA_RELEASE_RUNBOOK.md");
  const changelog = read("docs/releases/CHANGELOG.md");
  const linkedNotes = [...changelog.matchAll(/\]\((RELEASE_NOTES_[^)]+\.md)\)/g)].map(
    (match) => `docs/releases/${match[1]}`
  );

  for (const required of [
    /^# Release Rollback Runbook/m,
    /operator-facing/i,
    /lossless-codex-orchestrator/,
    /lossless-openclaw-orchestrator/,
    /dual-name npm release/i,
    /npm dist-tag add/,
    /npm dist-tag rm/,
    /npm deprecate/,
    /npm view .*dist-tags/i,
    /security find-generic-password/,
    /NPM_CONFIG_USERCONFIG/,
    /mktemp/,
    /GitHub Release/i,
    /fresh install verification/i,
    /lco openclaw published-smoke/,
    /lco release finalization-status/
  ]) {
    assert.match(runbook, required);
  }

  assert.match(checklist, /docs\/RELEASE_ROLLBACK\.md/);
  assert.match(checklist, /Release Rollback Runbook/i);
  assert.match(betaRunbook, /docs\/RELEASE_ROLLBACK\.md/);
  assert.match(betaRunbook, /Release Rollback Runbook/i);

  const privateLeakPattern =
    /npm_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]{10,}|\/Users\/|\/Volumes\/|\.npmrc\s*=/i;
  assert.doesNotMatch(runbook, privateLeakPattern);

  for (const file of linkedNotes) {
    assert.doesNotMatch(read(file), /RELEASE_ROLLBACK|Release Rollback Runbook|dist-tag correction/i, file);
  }
});

test("current docs do not present closed issue references as pending work", () => {
  const currentDocs = [
    "README.md",
    "VISION.md",
    "docs/SETUP.md",
    "docs/OPENCLAW_PLUGIN.md",
    "docs/BETA_RELEASE_RUNBOOK.md",
    "docs/RELEASE_CHECKLIST.md",
    "docs/QA_LAB.md",
    "docs/CLAIM_AUDIT.md",
    "skills/lossless-openclaw-orchestrator/SKILL.md"
  ].map(read).join("\n");

  for (const forbidden of [
    /until\s+#434/i,
    /Naming policy for #434/i,
    /For #434 continuity/i,
    /#157[\s\S]{0,120}fails closed until/i,
    /#158[\s\S]{0,120}must prove/i,
    /#159[\s\S]{0,120}must prove/i,
    /pre-#570/i,
    /pre-#583/i,
    /pre-#585/i,
    /known issue/i,
    /does not work/i
  ]) {
    assert.doesNotMatch(currentDocs, forbidden);
  }
});

test("public changelog links only customer-facing release notes", () => {
  const changelog = read("docs/releases/CHANGELOG.md");
  const linkedNotes = [...changelog.matchAll(/\]\((RELEASE_NOTES_[^)]+\.md)\)/g)].map(
    (match) => `docs/releases/${match[1]}`
  );

  assert.ok(linkedNotes.length > 0, "public changelog must link release notes");

  const internalReleaseNoteLanguage =
    /##\s*(?:Current Claim Scope|Stable Claim Scope|Proof Boundary|Explicit Non-Claims|Release Gates?|Release Gate Notes)|\bDo not claim:|approved_live_control_smoke_missing|codex-read-search-expand-dry-run|same proof boundary as beta\.35|No cloud sync|No unattended desktop takeover|No release-grade enterprise security|\bclaim(?:ed|s|ing|-conditional|\s+scope|\s+scoped|\s+boundary)?\b|\bproof(?:-action|\s+boundary|\s+gate|\s+gates|\s+path|\s+packet|\s+packets)?\b/i;

  for (const file of linkedNotes) {
    assert.equal(existsSync(file), true, `${file} must exist`);
    assert.doesNotMatch(read(file), internalReleaseNoteLanguage, file);
  }
});
