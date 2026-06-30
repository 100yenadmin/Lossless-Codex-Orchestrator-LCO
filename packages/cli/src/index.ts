#!/usr/bin/env node
import {
  codexTransportStatus,
  createAuditStore,
  desktopActDryRun,
  desktopFallbackDiagnostics,
  desktopSee,
  isDesktopBackend,
  writeDesktopGuiProofReport,
  writeDesktopLiveProofHarness,
  type DesktopBackend
} from "../../adapters/src/index.js";
import {
  configuredLcmPeerDbPaths,
  createCloseoutEnvelopeReport,
  createDatabase,
  defaultCodexRoots,
  defaultDatabasePath,
  describeRecallRef,
  evaluateRetrievalScenarios,
  expandQuery,
  expandRecallRef,
  getCodexSessionManagementMap,
  grepRecall,
  indexCodexSessions,
  probeCodexSqliteStores,
  probeLcmPeerDbs,
  searchSessions,
  type RecallProfileName
} from "../../core/src/index.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createReleaseBundle } from "./release-bundle.js";
import { createReleaseDemoStatus } from "./release-demo-status.js";
import { runReleasePreflight } from "./release-preflight.js";
import { createReleaseStatus } from "./release-status.js";
import { runOpenClawDogfood } from "./openclaw-dogfood.js";
import { runOpenClawToolSmoke } from "./openclaw-tool-smoke.js";
import { createScorecardSweep } from "./scorecard-sweep.js";
import { createScenarioSweep } from "./scenario-sweep.js";
import { normalizeReleaseClaimScope, type ReleaseClaimScope } from "./release-claim-scope.js";
import { AppServerLiveControlSmokeClient, runLiveControlSmoke } from "./live-control-smoke.js";
import {
  createLocalMacSearchUiShell,
  sampleLocalMacSearchUiShell,
  writeLocalMacSearchUiEvidence,
  type LocalMacSearchUiFilters
} from "../../local-mac-ui/src/shell.js";

const [, , command, ...args] = process.argv;

async function main() {
  if (command === "doctor") {
    console.log(JSON.stringify({
      ok: true,
      dbPath: defaultDatabasePath(),
      localOnly: true,
      codex: codexTransportStatus({ command: process.env.LOO_CODEX_BIN || "codex" }),
      lcmPeers: probeLcmPeerDbs(configuredLcmPeerDbPaths()),
      desktopFallbacks: desktopFallbackDiagnostics()
    }, null, 2));
    return;
  }
  if (command === "desktop" && args[0] === "see") {
    const desktopSeeInput = parseDesktopSee(args.slice(1));
    console.log(JSON.stringify(await desktopSee(desktopSeeInput), null, 2));
    return;
  }
  if (command === "desktop" && args[0] === "act") {
    const desktopAction = parseDesktopAction(args.slice(1));
    console.log(JSON.stringify(desktopActDryRun({
      backend: desktopAction.backend,
      action: desktopAction.action,
      dryRun: true
    }), null, 2));
    return;
  }
  if (command === "desktop" && args[0] === "proof-report") {
    if (hasHelpFlag(args.slice(1))) {
      printDesktopProofReportHelp();
      return;
    }
    const parsed = parseDesktopProofReportArgs(args.slice(1));
    const observation = readDesktopProofReportObservation(parsed.observationFile);
    const report = writeDesktopGuiProofReport({
      evidenceDir: parsed.evidenceDir,
      observation
    });
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.proofReady) process.exitCode = 1;
    return;
  }
  if (command === "desktop" && args[0] === "live-proof-harness") {
    if (hasHelpFlag(args.slice(1))) {
      printDesktopLiveProofHarnessHelp();
      return;
    }
    const parsed = parseDesktopLiveProofHarnessArgs(args.slice(1));
    const report = writeDesktopLiveProofHarness(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.proofHarnessReady) process.exitCode = 1;
    return;
  }
  if (command === "index" && args[0] === "codex") {
    const parsed = parseIndexCodexArgs(args.slice(1));
    const db = createDatabase();
    try {
      console.log(JSON.stringify(indexCodexSessions(db, {
        roots: parsed.roots.length ? parsed.roots : defaultCodexRoots(),
        maxFiles: parsed.maxFiles,
        maxBytesPerFile: parsed.maxBytesPerFile,
        maxEventsPerFile: parsed.maxEventsPerFile
      }), null, 2));
    } finally {
      db.close();
    }
    return;
  }
  if (command === "probe" && args[0] === "codex-sqlite") {
    const roots = args.slice(1);
    console.log(JSON.stringify(probeCodexSqliteStores(roots.length ? roots : [join(process.env.HOME || ".", ".codex")]), null, 2));
    return;
  }
  if (command === "search") {
    const db = createDatabase();
    try {
      console.log(JSON.stringify(searchSessions(db, { query: args.join(" "), limit: 10 }), null, 2));
    } finally {
      db.close();
    }
    return;
  }
  if (command === "session-map") {
    const parsed = parseSessionMapArgs(args);
    const db = createDatabase();
    try {
      console.log(JSON.stringify(getCodexSessionManagementMap(db, parsed), null, 2));
    } finally {
      db.close();
    }
    return;
  }
  if (command === "grep") {
    const parsed = parseRecallArgs(args);
    const query = requireQuery("grep", parsed.rest);
    const db = createDatabase();
    try {
      console.log(JSON.stringify(grepRecall(db, {
        query,
        profile: parsed.profile,
        tokenBudget: parsed.tokenBudget,
        lcmDbPaths: parsed.lcmDbPaths
      }), null, 2));
    } finally {
      db.close();
    }
    return;
  }
  if (command === "describe") {
    const parsed = parseRecallArgs(args);
    const sourceRef = parsed.rest[0];
    if (!sourceRef) throw new Error("describe requires a source ref");
    const db = createDatabase();
    try {
      console.log(JSON.stringify(describeRecallRef(db, { sourceRef, lcmDbPaths: parsed.lcmDbPaths }), null, 2));
    } finally {
      db.close();
    }
    return;
  }
  if (command === "expand-query") {
    const parsed = parseRecallArgs(args);
    const query = requireQuery("expand-query", parsed.rest);
    const db = createDatabase();
    try {
      console.log(JSON.stringify(expandQuery(db, {
        query,
        profile: parsed.profile,
        tokenBudget: parsed.tokenBudget,
        lcmDbPaths: parsed.lcmDbPaths
      }), null, 2));
    } finally {
      db.close();
    }
    return;
  }
  if (command === "expand-ref") {
    const parsed = parseRecallArgs(args);
    const sourceRef = parsed.rest[0];
    if (!sourceRef) throw new Error("expand-ref requires a source ref");
    const db = createDatabase();
    try {
      console.log(JSON.stringify(expandRecallRef(db, {
        sourceRef,
        profile: parsed.profile,
        tokenBudget: parsed.tokenBudget,
        lcmDbPaths: parsed.lcmDbPaths
      }), null, 2));
    } finally {
      db.close();
    }
    return;
  }
  if (command === "closeout" && args[0] === "dry-run") {
    const parsed = parseCloseoutDryRunArgs(args.slice(1));
    const db = createDatabase();
    try {
      console.log(JSON.stringify(createCloseoutEnvelopeReport(db, parsed), null, 2));
    } finally {
      db.close();
    }
    return;
  }
  if (command === "serve") {
    await import("../../mcp-server/src/server.js");
    return;
  }
  if (command === "audit-path") {
    console.log(createAuditStore(process.env.LOO_AUDIT_PATH || `${process.env.HOME}/.openclaw/lossless-openclaw-orchestrator/audit.jsonl`).path);
    return;
  }
  if (command === "codex" && args[0] === "live-control-smoke") {
    if (hasHelpFlag(args.slice(1))) {
      printLiveControlSmokeHelp();
      return;
    }
    const parsed = parseLiveControlSmokeArgs(args.slice(1));
    const audit = createAuditStore(parsed.auditPath ?? process.env.LOO_AUDIT_PATH ?? `${process.env.HOME}/.openclaw/lossless-openclaw-orchestrator/audit.jsonl`);
    const report = await runLiveControlSmoke({
      client: new AppServerLiveControlSmokeClient({
        command: parsed.codexBin ?? process.env.LOO_CODEX_BIN ?? "codex",
        args: parsed.appServerArgs,
        timeoutMs: parsed.timeoutMs
      }),
      audit,
      evidenceDir: parsed.evidenceDir,
      message: parsed.message,
      threadId: parsed.threadId,
      cwd: parsed.cwd,
      timeoutMs: parsed.timeoutMs
    });
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (command === "openclaw" && args[0] === "dogfood") {
    const parsed = parseOpenClawDogfoodArgs(args.slice(1));
    const report = runOpenClawDogfood(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.dogfoodReady) process.exitCode = 1;
    return;
  }
  if (command === "openclaw" && args[0] === "tool-smoke") {
    const parsed = parseOpenClawToolSmokeArgs(args.slice(1));
    const report = runOpenClawToolSmoke(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.toolSmokeReady) process.exitCode = 1;
    return;
  }
  if (command === "scorecards" && args[0] === "sweep") {
    if (hasHelpFlag(args.slice(1))) {
      printScorecardSweepHelp();
      return;
    }
    const parsed = parseScorecardSweepArgs(args.slice(1));
    const report = createScorecardSweep(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.sweepReady) process.exitCode = 1;
    return;
  }
  if (command === "ui" && args[0] === "local-mac-search") {
    if (hasHelpFlag(args.slice(1))) {
      printLocalMacSearchUiHelp();
      return;
    }
    const parsed = parseLocalMacSearchUiArgs(args.slice(1));
    const shell = parsed.sample
      ? sampleLocalMacSearchUiShell({
        filters: parsed.filters,
        expansionProfile: parsed.expansionProfile
      })
      : createLocalMacSearchUiShell({
        status: {
          platform: process.platform,
          localDbAvailable: false,
          openclawPluginLoaded: false,
          availableTools: []
        },
        filters: parsed.filters,
        expansionProfile: parsed.expansionProfile
      });
    const sourceScorecard = "evals/scorecards/v1.0/local-mac-search-ui-review.json";
    const report = writeLocalMacSearchUiEvidence({
      evidenceDir: parsed.evidenceDir,
      shell,
      scorecardSourcePath: existsSync(sourceScorecard) ? sourceScorecard : undefined
    });
    const { html: _html, ...publicReport } = report;
    console.log(JSON.stringify(publicReport, null, 2));
    if (parsed.strict && !report.shellReady) process.exitCode = 1;
    return;
  }
  if (command === "eval" && args[0] === "retrieval") {
    const parsed = parseRetrievalEvalArgs(args.slice(1));
    const payload = readRetrievalScenarioFile(parsed.scenarioFile);
    const db = createDatabase(payload.codexRoots.length > 0 ? ":memory:" : undefined);
    try {
      if (payload.codexRoots.length > 0) {
        indexCodexSessions(db, {
          roots: payload.codexRoots,
          maxFiles: payload.maxFiles,
          maxBytesPerFile: payload.maxBytesPerFile,
          maxEventsPerFile: payload.maxEventsPerFile
        });
      }
      const report = evaluateRetrievalScenarios(db, { scenarios: payload.scenarios });
      if (parsed.evidencePath) {
        mkdirSync(dirname(parsed.evidencePath), { recursive: true });
        writeFileSync(parsed.evidencePath, `${JSON.stringify(report, null, 2)}\n`);
      }
      console.log(JSON.stringify(report, null, 2));
      if (parsed.strict && !report.ok) process.exitCode = 1;
    } finally {
      db.close();
    }
    return;
  }
  if (command === "eval" && args[0] === "scenarios") {
    if (hasHelpFlag(args.slice(1))) {
      printScenarioSweepHelp();
      return;
    }
    const parsed = parseScenarioSweepArgs(args.slice(1));
    const report = createScenarioSweep(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.scenarioReady) process.exitCode = 1;
    return;
  }
  if (command === "release" && args[0] === "preflight") {
    const parsed = parseReleasePreflightArgs(args.slice(1));
    const report = runReleasePreflight({
      evidenceDir: parsed.evidenceDir,
      approvedLiveControlEvidence: parsed.approvedLiveControlEvidence,
      claimScope: parsed.claimScope
    });
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.releaseReady) process.exitCode = 1;
    return;
  }
  if (command === "release" && args[0] === "bundle") {
    const parsed = parseReleaseBundleArgs(args.slice(1));
    const report = createReleaseBundle({
      evidenceDir: parsed.evidenceDir,
      approvedLiveControlEvidence: parsed.approvedLiveControlEvidence,
      claimScope: parsed.claimScope
    });
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.publishReady) process.exitCode = 1;
    return;
  }
  if (command === "release" && args[0] === "status") {
    if (hasHelpFlag(args.slice(1))) {
      printReleaseStatusHelp();
      return;
    }
    const parsed = parseReleaseStatusArgs(args.slice(1));
    const report = createReleaseStatus({
      evidenceDir: parsed.evidenceDir,
      candidateSha: parsed.candidateSha,
      approvedLiveControlEvidence: parsed.approvedLiveControlEvidence,
      claimScope: parsed.claimScope,
      npmPublishApprovalEvidence: parsed.npmPublishApprovalEvidence,
      githubReleaseApprovalEvidence: parsed.githubReleaseApprovalEvidence,
      desktopGuiApprovalEvidence: parsed.desktopGuiApprovalEvidence,
      githubCiEvidence: parsed.githubCiEvidence,
      codeqlEvidence: parsed.codeqlEvidence,
      desktopGuiRequired: parsed.desktopGuiRequired,
      now: parsed.now
    });
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.releaseReady) process.exitCode = 1;
    return;
  }
  if (command === "release" && args[0] === "demo-status") {
    const parsed = parseReleaseDemoStatusArgs(args.slice(1));
    const report = createReleaseDemoStatus({
      evidenceDir: parsed.evidenceDir,
      approvedLiveControlEvidence: parsed.approvedLiveControlEvidence,
      claimScope: parsed.claimScope,
      minSessions: parsed.minSessions
    });
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.demoReady) process.exitCode = 1;
    return;
  }
  console.error([
    "Usage:",
    "  loo doctor",
    "  loo desktop see [direct|cua-driver|peekaboo] [--snapshot] [--max-nodes n] [--max-chars n]",
    "  loo desktop act [direct|cua-driver|peekaboo] <action>",
    "  loo desktop proof-report --evidence-dir path --observation-file path [--strict]",
    "  loo desktop live-proof-harness --evidence-dir path [--backend direct|cua-driver|peekaboo] [--target-app app] [--target-window title] [--action text] [--approval-ref ref] [--strict]",
    "  loo index codex [--max-files n] [--max-bytes-per-file n] [--max-events-per-file n] [roots...]",
    "  loo probe codex-sqlite [roots...]",
    "  loo search <query>",
    "  loo session-map [--project name] [--status value] [--priority value] [--blocker value] [--priority-order urgent,high,medium,low] [--limit n]",
    "  loo grep [--lcm-db path] [--profile metadata|brief|evidence] [--token-budget n] <query>",
    "  loo describe [--lcm-db path] <source-ref>",
    "  loo expand-query [--lcm-db path] [--profile metadata|brief|evidence] [--token-budget n] <query>",
    "  loo expand-ref [--lcm-db path] [--profile metadata|brief|evidence] [--token-budget n] <source-ref>",
    "  loo closeout dry-run [--thread-id id] [--limit n] [--include-unavailable]",
    "  loo serve",
    "  loo audit-path",
    "  loo codex live-control-smoke --evidence-dir path [--thread-id id] [--message text] [--cwd path] [--timeout-ms ms] [--audit-path path] [--codex-bin path] [--app-server-args \"app-server --stdio\"]",
    "  loo openclaw dogfood [--dev] [--profile name] [--install-source path] [--link] [--force-install] [--evidence-path path] [--strict]",
    "  loo openclaw tool-smoke [--openclaw-bin path] [--dev] [--profile name] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--query text] [--thread-id id] [--expand-profile metadata|brief|evidence] [--token-budget n] [--required-tool name] [--evidence-path path] [--strict]",
    "  loo scorecards sweep --evidence-dir path [--scorecard-dir path] [--strict]",
    "  loo ui local-mac-search --evidence-dir path [--sample] [--strict]",
    "  loo eval retrieval --scenario-file path [--evidence-path path] [--strict]",
    "  loo eval scenarios --evidence-dir path [--scenario-dir path] [--strict]",
    "  loo release preflight [--evidence-dir path] [--claim-scope codex-live-control|codex-read-search-expand-dry-run] [--approved-live-control-evidence path] [--strict]",
    "  loo release bundle --evidence-dir path [--claim-scope codex-live-control|codex-read-search-expand-dry-run] [--approved-live-control-evidence path] [--strict]",
    "  loo release status --evidence-dir path --candidate-sha sha [--claim-scope codex-live-control|codex-read-search-expand-dry-run] [--approved-live-control-evidence path] [--npm-publish-approval-evidence path] [--github-release-approval-evidence path] [--github-ci-evidence path] [--codeql-evidence path] [--desktop-gui-required --desktop-gui-approval-evidence path] [--now iso] [--strict]",
    "  loo release demo-status --evidence-dir path [--claim-scope codex-live-control|codex-read-search-expand-dry-run] [--approved-live-control-evidence path] [--min-sessions n] [--strict]"
  ].join("\n"));
  process.exitCode = 2;
}

await main();

function hasHelpFlag(input: string[]): boolean {
  return input.includes("--help") || input.includes("-h");
}

function printScorecardSweepHelp(): void {
  console.log([
    "Usage:",
    "  loo scorecards sweep --evidence-dir path [--scorecard-dir path] [--strict]",
    "",
    "Writes a public-safe scorecard sweep packet for the beta acceptance scorecards.",
    "",
    "Required:",
    "  --evidence-dir is required and must not be the same directory as --scorecard-dir.",
    "",
    "Strict mode:",
    "  --strict exits non-zero when scorecards are missing, invalid, example-not-run, failed, or when raw evidence artifacts are present.",
    "  Common blockers include scorecard_not_run:<name>, scorecard_missing:<name>, and raw_artifact:<reason>:<name>.",
    "",
    "Safety boundary:",
    "  The command does not run live Codex control, does not mutate a desktop GUI, does not publish npm, and does not create a GitHub Release."
  ].join("\n"));
}

function printScenarioSweepHelp(): void {
  console.log([
    "Usage:",
    "  loo eval scenarios --evidence-dir path [--scenario-dir path] [--strict]",
    "",
    "Writes public-safe QA Lab dry-run scenario scorecards for orchestrator eval tasks.",
    "",
    "Required:",
    "  --evidence-dir is required and must not be the same directory as --scenario-dir.",
    "",
    "Strict mode:",
    "  --strict exits non-zero when scenarios are missing, malformed, omit required forbidden behaviors, or when raw evidence artifacts are present.",
    "  Common blockers include scenario_missing_field:<id>:<field>, scenario_missing_required_forbidden_behavior:<id>:<behavior>, and raw_artifact:<reason>:<name>.",
    "",
    "Safety boundary:",
    "  The command validates dry-run scenario contracts only.",
    "  It does not read raw Codex transcripts, run live Codex control, mutate a desktop GUI, publish npm, or create a GitHub Release."
  ].join("\n"));
}

function printReleaseStatusHelp(): void {
  console.log([
    "Usage:",
    "  loo release status --evidence-dir path --candidate-sha sha [--claim-scope codex-live-control|codex-read-search-expand-dry-run] [--approved-live-control-evidence path] [--npm-publish-approval-evidence path] [--github-release-approval-evidence path] [--github-ci-evidence path] [--codeql-evidence path] [--desktop-gui-required --desktop-gui-approval-evidence path] [--strict]",
    "",
    "Writes a public-safe release status packet without performing gated release actions.",
    "",
    "Proof markers:",
    "  CI and CodeQL checks use kind: \"loo_release_check_evidence\" with check, commitSha, status, conclusion, runUrl, warnings, and rawSecretIncluded: false.",
    "  npm, GitHub Release, and optional desktop GUI approvals use kind: \"loo_release_operation_approval\" with operation, approved: true, approvalRef, and rawSecretIncluded: false.",
    "  Desktop GUI approvals also require desktopBackend, targetApp, targetWindow, action, actionHash, approvalNonce, issuedAt, expiresAt, focusBeforeApplication, focusAfterApplication, focusChanged: false, focusProof, and rawScreenshotIncluded: false.",
    "  Live-control proof is validated through release preflight and must be a structured approved live-control smoke marker unless --claim-scope codex-read-search-expand-dry-run explicitly excludes live-control claims.",
    "",
    "Strict mode:",
    "  --strict exits non-zero until the candidate SHA, CI/CodeQL proofs, explicit release approvals, and scope-required approved live-control smoke evidence satisfy the release gates.",
    "",
    "Safety boundary:",
    "  The command does not publish npm, does not create a GitHub Release, does not run live Codex control, and does not perform desktop GUI mutation."
  ].join("\n"));
}

function printLiveControlSmokeHelp(): void {
  console.log([
    "Usage:",
    "  loo codex live-control-smoke --evidence-dir path [--thread-id id] [--message text] [--cwd path] [--timeout-ms ms] [--audit-path path] [--codex-bin path] [--app-server-args \"app-server --stdio\"]",
    "",
    "Runs one approval-gated live Codex send smoke with a harmless prompt.",
    "",
    "Outputs:",
    "  approved-live-control-smoke.json",
    "  live-control-smoke-report.json",
    "",
    "Safety boundary:",
    "  The command creates a dry-run audit id first, then uses the matching approval_audit_id for live send.",
    "  Evidence contains refs, audit ids, hashes, notification method names, and status only.",
    "  It does not write raw prompt text, raw transcript spans, screenshots, SQLite DBs, tokens, or credentials.",
    "  When --thread-id is omitted, it starts an ephemeral Codex thread as the disposable target."
  ].join("\n"));
}

function printDesktopProofReportHelp(): void {
  console.log([
    "Usage:",
    "  loo desktop proof-report --evidence-dir path --observation-file path [--strict]",
    "",
    "Validates a public-safe desktop GUI action observation and writes proof evidence.",
    "",
    "Inputs:",
    "  Observation kind must be \"loo_desktop_gui_action_observation\" and include desktopBackend, targetApp, targetWindow, action, approvalRef, approved: true, liveActionObserved: true, focus-before/after app labels, focusChanged: false, non-diagnostic focusProof, rawScreenshotIncluded: false, and rawSecretIncluded: false.",
    "",
    "Outputs:",
    "  desktop-gui-proof-report.json",
    "  desktop-gui-approval.json when the observation satisfies the release approval contract",
    "",
    "Safety boundary:",
    "  This command does not run a desktop GUI action, does not capture screenshots, and does not authorize unattended desktop takeover."
  ].join("\n"));
}

function printDesktopLiveProofHarnessHelp(): void {
  console.log([
    "Usage:",
    "  loo desktop live-proof-harness --evidence-dir path [--backend direct|cua-driver|peekaboo] [--target-app app] [--target-window title] [--action text] [--approval-ref ref] [--strict]",
    "",
    "Writes a public-safe desktop live/no-focus proof harness packet without performing the action.",
    "",
    "Outputs:",
    "  desktop-live-proof-harness.json",
    "",
    "Strict mode:",
    "  --strict exits non-zero until a GUI fallback backend, target app/window, action, approval ref, available backend, and stable no-focus status probe are present.",
    "",
    "Safety boundary:",
    "  This command does not run a desktop GUI action, does not capture screenshots, does not run live Codex control, and does not authorize unattended desktop takeover."
  ].join("\n"));
}

function printLocalMacSearchUiHelp(): void {
  console.log([
    "Usage:",
    "  loo ui local-mac-search --evidence-dir path [--sample] [--query text] [--project name] [--status value] [--priority value] [--blocker value] [--expansion-profile metadata|brief|evidence] [--strict]",
    "",
    "Writes a static public-safe local Mac search UI prototype packet.",
    "",
    "Outputs:",
    "  local-mac-search-ui.html",
    "  local-mac-search-ui-report.json",
    "  local-mac-search-ui-scorecard.json",
    "",
    "Safety boundary:",
    "  The command does not read raw Codex transcripts, does not run live Codex control, does not mutate the GUI, and does not claim a signed or release-ready macOS app.",
    "  Without --sample, the shell intentionally fails closed until local DB, OpenClaw plugin, and required loo_* tools are proven available."
  ].join("\n"));
}

function parseLiveControlSmokeArgs(input: string[]): {
  evidenceDir: string;
  threadId?: string;
  message?: string;
  cwd?: string;
  timeoutMs?: number;
  auditPath?: string;
  codexBin?: string;
  appServerArgs?: string[];
} {
  const parsed: Partial<ReturnType<typeof parseLiveControlSmokeArgs>> = {};
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      parsed.evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--thread-id") {
      parsed.threadId = requireOptionValue(input[++index], arg);
    } else if (arg === "--message") {
      parsed.message = requireOptionValue(input[++index], arg);
    } else if (arg === "--cwd") {
      parsed.cwd = requireOptionValue(input[++index], arg);
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = parsePositiveInteger(input[++index], arg, 600_000);
    } else if (arg === "--audit-path") {
      parsed.auditPath = requireOptionValue(input[++index], arg);
    } else if (arg === "--codex-bin") {
      parsed.codexBin = requireOptionValue(input[++index], arg);
    } else if (arg === "--app-server-args") {
      parsed.appServerArgs = requireOptionValue(input[++index], arg).split(/\s+/).filter(Boolean);
    } else {
      throw new Error(`Unknown codex live-control-smoke option: ${arg}`);
    }
  }
  if (!parsed.evidenceDir) throw new Error("codex live-control-smoke requires --evidence-dir");
  return parsed as ReturnType<typeof parseLiveControlSmokeArgs>;
}

function parseDesktopProofReportArgs(input: string[]): {
  evidenceDir: string;
  observationFile: string;
  strict: boolean;
} {
  let evidenceDir = "";
  let observationFile = "";
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--observation-file") {
      observationFile = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown desktop proof-report option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("desktop proof-report requires --evidence-dir");
  if (!observationFile) throw new Error("desktop proof-report requires --observation-file");
  return { evidenceDir, observationFile, strict };
}

function parseDesktopLiveProofHarnessArgs(input: string[]): {
  evidenceDir: string;
  backend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  approvalRef?: string;
  strict: boolean;
} {
  let evidenceDir = "";
  let backend: DesktopBackend | undefined;
  let targetApp: string | undefined;
  let targetWindow: string | undefined;
  let action: string | undefined;
  let approvalRef: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--backend") {
      backend = parseDesktopBackend(requireOptionValue(input[++index], arg));
    } else if (arg === "--target-app") {
      targetApp = requireOptionValue(input[++index], arg);
    } else if (arg === "--target-window") {
      targetWindow = requireOptionValue(input[++index], arg);
    } else if (arg === "--action") {
      action = requireOptionValue(input[++index], arg);
    } else if (arg === "--approval-ref") {
      approvalRef = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown desktop live-proof-harness option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("desktop live-proof-harness requires --evidence-dir");
  return { evidenceDir, backend, targetApp, targetWindow, action, approvalRef, strict };
}

function readDesktopProofReportObservation(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read observation file ${path}: ${(error as Error).message}`);
  }
}

function parseLocalMacSearchUiArgs(input: string[]): {
  evidenceDir: string;
  sample: boolean;
  strict: boolean;
  filters: LocalMacSearchUiFilters;
  expansionProfile?: "metadata" | "brief" | "evidence";
} {
  let evidenceDir = "";
  let sample = false;
  let strict = false;
  const filters: LocalMacSearchUiFilters = {};
  let expansionProfile: "metadata" | "brief" | "evidence" | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--sample") {
      sample = true;
    } else if (arg === "--strict") {
      strict = true;
    } else if (arg === "--query") {
      filters.query = requireOptionValue(input[++index], arg);
    } else if (arg === "--project") {
      filters.project = requireOptionValue(input[++index], arg);
    } else if (arg === "--status") {
      filters.status = requireOptionValue(input[++index], arg);
    } else if (arg === "--priority") {
      filters.priority = requireOptionValue(input[++index], arg);
    } else if (arg === "--blocker") {
      filters.blocker = requireOptionValue(input[++index], arg);
    } else if (arg === "--expansion-profile") {
      const value = requireOptionValue(input[++index], arg);
      if (value !== "metadata" && value !== "brief" && value !== "evidence") throw new Error("--expansion-profile must be metadata, brief, or evidence");
      expansionProfile = value;
    } else {
      throw new Error(`Unknown ui local-mac-search option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("ui local-mac-search requires --evidence-dir");
  return { evidenceDir, sample, strict, filters, expansionProfile };
}

function parseCloseoutDryRunArgs(input: string[]): { threadId?: string; limit?: number; includeUnavailable?: boolean } {
  const parsed: { threadId?: string; limit?: number; includeUnavailable?: boolean } = {};
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--thread-id") {
      parsed.threadId = requireOptionValue(input[++index], arg);
    } else if (arg === "--limit") {
      parsed.limit = parsePositiveInteger(input[++index], "--limit", 500);
    } else if (arg === "--include-unavailable") {
      parsed.includeUnavailable = true;
    } else {
      throw new Error(`Unknown closeout dry-run option: ${arg}`);
    }
  }
  return parsed;
}

function parseSessionMapArgs(input: string[]): {
  project?: string;
  status?: string;
  priority?: string;
  blocker?: string;
  priorityOrder?: string[];
  limit?: number;
} {
  const parsed: ReturnType<typeof parseSessionMapArgs> = {};
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--project") {
      parsed.project = requireOptionValue(input[++index], arg);
    } else if (arg === "--status") {
      parsed.status = requireOptionValue(input[++index], arg);
    } else if (arg === "--priority") {
      parsed.priority = requireOptionValue(input[++index], arg);
    } else if (arg === "--blocker") {
      parsed.blocker = requireOptionValue(input[++index], arg);
    } else if (arg === "--priority-order") {
      parsed.priorityOrder = requireOptionValue(input[++index], arg)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg === "--limit") {
      parsed.limit = parsePositiveInteger(input[++index], "--limit", 500);
    } else {
      throw new Error(`Unknown session-map option: ${arg}`);
    }
  }
  return parsed;
}

function parseRecallArgs(input: string[]): { rest: string[]; lcmDbPaths: string[]; profile?: RecallProfileName; tokenBudget?: number } {
  const rest: string[] = [];
  const explicitLcmDbPaths: string[] = [];
  let profile: RecallProfileName | undefined;
  let tokenBudget: number | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--lcm-db") {
      const value = input[++index];
      if (!value) throw new Error("--lcm-db requires a path");
      explicitLcmDbPaths.push(value);
      continue;
    }
    if (arg === "--profile") {
      const value = input[++index];
      if (value !== "metadata" && value !== "brief" && value !== "evidence") throw new Error("--profile must be metadata, brief, or evidence");
      profile = value;
      continue;
    }
    if (arg === "--token-budget") {
      const value = input[++index];
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error("--token-budget requires a number");
      tokenBudget = parsed;
      continue;
    }
    rest.push(arg);
  }
  const lcmDbPaths = explicitLcmDbPaths.length > 0 ? explicitLcmDbPaths : configuredLcmPeerDbPaths();
  return { rest, lcmDbPaths: [...new Set(lcmDbPaths)], profile, tokenBudget };
}

function parseRetrievalEvalArgs(input: string[]): { scenarioFile: string; evidencePath?: string; strict: boolean } {
  let scenarioFile = "";
  let evidencePath: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--scenario-file") {
      scenarioFile = requireOptionValue(input[++index], arg);
    } else if (arg === "--evidence-path") {
      evidencePath = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown eval retrieval option: ${arg}`);
    }
  }
  if (!scenarioFile) throw new Error("eval retrieval requires --scenario-file");
  return { scenarioFile, evidencePath, strict };
}

function parseScenarioSweepArgs(input: string[]): { evidenceDir: string; scenarioDir?: string; strict: boolean } {
  let evidenceDir = "";
  let scenarioDir: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--scenario-dir") {
      scenarioDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown eval scenarios option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("eval scenarios requires --evidence-dir");
  return { evidenceDir, scenarioDir, strict };
}

function readRetrievalScenarioFile(path: string): {
  codexRoots: string[];
  maxFiles?: number;
  maxBytesPerFile?: number;
  maxEventsPerFile?: number;
  scenarios: Parameters<typeof evaluateRetrievalScenarios>[1]["scenarios"];
} {
  const scenarioPath = resolve(path);
  if (!existsSync(scenarioPath)) throw new Error(`Scenario file does not exist: ${path}`);
  const payload = JSON.parse(readFileSync(scenarioPath, "utf8")) as Record<string, unknown>;
  const scenarioDir = dirname(scenarioPath);
  const scenarios = Array.isArray(payload.scenarios) ? payload.scenarios : [];
  return {
    codexRoots: Array.isArray(payload.codexRoots)
      ? payload.codexRoots
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => resolve(scenarioDir, item))
      : [],
    maxFiles: optionalJsonPositiveInteger(payload.maxFiles, "maxFiles", 100000),
    maxBytesPerFile: optionalJsonPositiveInteger(payload.maxBytesPerFile, "maxBytesPerFile", 1073741824),
    maxEventsPerFile: optionalJsonPositiveInteger(payload.maxEventsPerFile, "maxEventsPerFile", 1000000),
    scenarios: scenarios.map((scenario) => normalizeRetrievalScenario(scenario))
  };
}

function normalizeRetrievalScenario(value: unknown): Parameters<typeof evaluateRetrievalScenarios>[1]["scenarios"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Each retrieval scenario must be an object");
  const record = value as Record<string, unknown>;
  const expectedSourceRefs = Array.isArray(record.expectedSourceRefs)
    ? record.expectedSourceRefs.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const expansionQueries = Array.isArray(record.expansionQueries)
    ? record.expansionQueries.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  return {
    id: requiredJsonString(record.id, "id"),
    query: requiredJsonString(record.query, "query"),
    expectedSourceRefs,
    expansionQueries,
    limit: optionalJsonPositiveInteger(record.limit, "limit", 100)
  };
}

function requiredJsonString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} requires a non-empty string`);
  return value.trim();
}

function optionalJsonPositiveInteger(value: unknown, name: string, max?: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || (max !== undefined && value > max)) {
    throw new Error(max === undefined ? `${name} requires a positive integer` : `${name} requires an integer between 1 and ${max}`);
  }
  return value;
}

function requireQuery(command: string, parts: string[]): string {
  const query = parts.join(" ").trim();
  if (!query) throw new Error(`${command} requires a query`);
  return query;
}

function parseIndexCodexArgs(input: string[]): { roots: string[]; maxFiles?: number; maxBytesPerFile?: number; maxEventsPerFile?: number } {
  const roots: string[] = [];
  let maxFiles: number | undefined;
  let maxBytesPerFile: number | undefined;
  let maxEventsPerFile: number | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--max-files") {
      maxFiles = parsePositiveInteger(input[++index], "--max-files", 100000);
      continue;
    }
    if (arg === "--max-bytes-per-file") {
      maxBytesPerFile = parsePositiveInteger(input[++index], "--max-bytes-per-file", 1073741824);
      continue;
    }
    if (arg === "--max-events-per-file") {
      maxEventsPerFile = parsePositiveInteger(input[++index], "--max-events-per-file", 1000000);
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown index codex option: ${arg}`);
    roots.push(arg);
  }
  return { roots, maxFiles, maxBytesPerFile, maxEventsPerFile };
}

function parseDesktopBackend(value: string | undefined): DesktopBackend | undefined {
  if (value === undefined) return undefined;
  if (isDesktopBackend(value)) return value;
  throw new Error("desktop backend must be direct, cua-driver, or peekaboo");
}

function parseOpenClawToolSmokeArgs(input: string[]): {
  openclawBin?: string;
  dev?: boolean;
  profile?: string;
  gatewayUrl?: string;
  token?: string;
  sessionKey?: string;
  query?: string;
  threadId?: string;
  expandProfile?: "metadata" | "brief" | "evidence";
  tokenBudget?: number;
  evidencePath?: string;
  requiredTools?: string[];
  gatewayTimeoutMs?: number;
  strict?: boolean;
} {
  const parsed: ReturnType<typeof parseOpenClawToolSmokeArgs> = {};
  const requiredTools: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--openclaw-bin") {
      parsed.openclawBin = requireOptionValue(input[++index], arg);
    } else if (arg === "--dev") {
      parsed.dev = true;
    } else if (arg === "--profile") {
      parsed.profile = requireOptionValue(input[++index], arg);
    } else if (arg === "--gateway-url") {
      parsed.gatewayUrl = requireOptionValue(input[++index], arg);
    } else if (arg === "--token") {
      parsed.token = requireOptionValue(input[++index], arg);
    } else if (arg === "--gateway-timeout-ms") {
      parsed.gatewayTimeoutMs = parsePositiveInteger(input[++index], arg, 600_000);
    } else if (arg === "--session-key") {
      parsed.sessionKey = requireOptionValue(input[++index], arg);
    } else if (arg === "--query") {
      parsed.query = requireOptionValue(input[++index], arg);
    } else if (arg === "--thread-id") {
      parsed.threadId = requireOptionValue(input[++index], arg);
    } else if (arg === "--expand-profile") {
      const value = requireOptionValue(input[++index], arg);
      if (value !== "metadata" && value !== "brief" && value !== "evidence") throw new Error("--expand-profile must be metadata, brief, or evidence");
      parsed.expandProfile = value;
    } else if (arg === "--token-budget") {
      parsed.tokenBudget = parsePositiveInteger(input[++index], arg, 8000);
    } else if (arg === "--required-tool") {
      requiredTools.push(requireOptionValue(input[++index], arg));
    } else if (arg === "--evidence-path") {
      parsed.evidencePath = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      parsed.strict = true;
    } else {
      throw new Error(`Unknown openclaw tool-smoke option: ${arg}`);
    }
  }
  if (requiredTools.length > 0) parsed.requiredTools = requiredTools;
  return parsed;
}

function parseDesktopAction(parts: string[]): { backend?: DesktopBackend; action: string } {
  const first = parts[0];
  const hasExplicitBackend = isDesktopBackend(first);
  return {
    backend: hasExplicitBackend ? first : undefined,
    action: parts.slice(hasExplicitBackend ? 1 : 0).join(" ").trim() || "unknown"
  };
}

function parseDesktopSee(parts: string[]): { backend?: DesktopBackend; includeSnapshot?: boolean; maxNodes?: number; maxChars?: number } {
  const first = parts[0];
  const hasExplicitBackend = isDesktopBackend(first);
  const options = { backend: hasExplicitBackend ? first : undefined, includeSnapshot: false, maxNodes: undefined as number | undefined, maxChars: undefined as number | undefined };
  const rest = parts.slice(hasExplicitBackend ? 1 : 0);
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--snapshot") {
      options.includeSnapshot = true;
    } else if (token === "--max-nodes") {
      options.maxNodes = parsePositiveInteger(rest[++index], "--max-nodes", 500);
    } else if (token === "--max-chars") {
      options.maxChars = parsePositiveInteger(rest[++index], "--max-chars", 20000);
    } else {
      throw new Error(`Unknown desktop see option: ${token}`);
    }
  }
  return options;
}

function parseOpenClawDogfoodArgs(input: string[]): {
  openclawBin?: string;
  dev?: boolean;
  profile?: string;
  pluginListJsonPath?: string;
  evidencePath?: string;
  requiredTools?: string[];
  installSource?: string;
  link?: boolean;
  forceInstall?: boolean;
  strict?: boolean;
} {
  const parsed: ReturnType<typeof parseOpenClawDogfoodArgs> = {};
  const requiredTools: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--openclaw-bin") {
      parsed.openclawBin = requireOptionValue(input[++index], arg);
    } else if (arg === "--dev") {
      parsed.dev = true;
    } else if (arg === "--profile") {
      parsed.profile = requireOptionValue(input[++index], arg);
    } else if (arg === "--plugin-list-json") {
      parsed.pluginListJsonPath = requireOptionValue(input[++index], arg);
    } else if (arg === "--evidence-path") {
      parsed.evidencePath = requireOptionValue(input[++index], arg);
    } else if (arg === "--required-tool") {
      requiredTools.push(requireOptionValue(input[++index], arg));
    } else if (arg === "--install-source") {
      parsed.installSource = requireOptionValue(input[++index], arg);
    } else if (arg === "--link") {
      parsed.link = true;
    } else if (arg === "--force-install") {
      parsed.forceInstall = true;
    } else if (arg === "--strict") {
      parsed.strict = true;
    } else {
      throw new Error(`Unknown openclaw dogfood option: ${arg}`);
    }
  }
  if (requiredTools.length > 0) parsed.requiredTools = requiredTools;
  return parsed;
}

function requireOptionValue(value: string | undefined, option: string): string {
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function parseScorecardSweepArgs(input: string[]): { evidenceDir: string; scorecardDir?: string; strict: boolean } {
  let evidenceDir: string | undefined;
  let scorecardDir: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--scorecard-dir") {
      scorecardDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown scorecards sweep option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("scorecards sweep requires --evidence-dir");
  return { evidenceDir, scorecardDir, strict };
}

function parsePositiveInteger(value: string | undefined, name: string, max?: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || (max !== undefined && parsed > max)) {
    throw new Error(max === undefined ? `${name} requires a positive integer` : `${name} requires an integer between 1 and ${max}`);
  }
  return parsed;
}

function parseReleasePreflightArgs(input: string[]): { evidenceDir?: string; approvedLiveControlEvidence?: string; claimScope?: ReleaseClaimScope; strict: boolean } {
  let evidenceDir: string | undefined;
  let approvedLiveControlEvidence: string | undefined;
  let claimScope: ReleaseClaimScope | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = input[++index];
      if (!evidenceDir) throw new Error("--evidence-dir requires a path");
      continue;
    }
    if (arg === "--approved-live-control-evidence") {
      approvedLiveControlEvidence = input[++index];
      if (!approvedLiveControlEvidence) throw new Error("--approved-live-control-evidence requires a path");
      continue;
    }
    if (arg === "--claim-scope") {
      claimScope = parseReleaseClaimScope(input, ++index, "--claim-scope");
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    throw new Error(`Unknown release preflight option: ${arg}`);
  }
  return { evidenceDir, approvedLiveControlEvidence, claimScope, strict };
}

function parseReleaseBundleArgs(input: string[]): { evidenceDir: string; approvedLiveControlEvidence?: string; claimScope?: ReleaseClaimScope; strict: boolean } {
  const parsed = parseReleasePreflightArgs(input);
  if (!parsed.evidenceDir) throw new Error("release bundle requires --evidence-dir");
  return { evidenceDir: parsed.evidenceDir, approvedLiveControlEvidence: parsed.approvedLiveControlEvidence, claimScope: parsed.claimScope, strict: parsed.strict };
}

function parseReleaseStatusArgs(input: string[]): {
  evidenceDir: string;
  candidateSha?: string;
  approvedLiveControlEvidence?: string;
  claimScope?: ReleaseClaimScope;
  npmPublishApprovalEvidence?: string;
  githubReleaseApprovalEvidence?: string;
  desktopGuiApprovalEvidence?: string;
  githubCiEvidence?: string;
  codeqlEvidence?: string;
  desktopGuiRequired: boolean;
  now?: string;
  strict: boolean;
} {
  let evidenceDir: string | undefined;
  let candidateSha: string | undefined;
  let approvedLiveControlEvidence: string | undefined;
  let claimScope: ReleaseClaimScope | undefined;
  let npmPublishApprovalEvidence: string | undefined;
  let githubReleaseApprovalEvidence: string | undefined;
  let desktopGuiApprovalEvidence: string | undefined;
  let githubCiEvidence: string | undefined;
  let codeqlEvidence: string | undefined;
  let desktopGuiRequired = false;
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = readReleaseStatusPath(input, ++index, "--evidence-dir");
      continue;
    }
    if (arg === "--candidate-sha") {
      candidateSha = readReleaseStatusValue(input, ++index, "--candidate-sha");
      continue;
    }
    if (arg === "--approved-live-control-evidence") {
      approvedLiveControlEvidence = readReleaseStatusPath(input, ++index, "--approved-live-control-evidence");
      continue;
    }
    if (arg === "--claim-scope") {
      claimScope = parseReleaseClaimScope(input, ++index, "--claim-scope");
      continue;
    }
    if (arg === "--npm-publish-approval-evidence") {
      npmPublishApprovalEvidence = readReleaseStatusPath(input, ++index, "--npm-publish-approval-evidence");
      continue;
    }
    if (arg === "--github-release-approval-evidence") {
      githubReleaseApprovalEvidence = readReleaseStatusPath(input, ++index, "--github-release-approval-evidence");
      continue;
    }
    if (arg === "--desktop-gui-approval-evidence") {
      desktopGuiApprovalEvidence = readReleaseStatusPath(input, ++index, "--desktop-gui-approval-evidence");
      continue;
    }
    if (arg === "--github-ci-evidence") {
      githubCiEvidence = readReleaseStatusPath(input, ++index, "--github-ci-evidence");
      continue;
    }
    if (arg === "--codeql-evidence") {
      codeqlEvidence = readReleaseStatusPath(input, ++index, "--codeql-evidence");
      continue;
    }
    if (arg === "--desktop-gui-required") {
      desktopGuiRequired = true;
      continue;
    }
    if (arg === "--now") {
      now = readReleaseStatusValue(input, ++index, "--now");
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    throw new Error(`Unknown release status option: ${arg}`);
  }
  if (!evidenceDir) throw new Error("release status requires --evidence-dir");
  if (desktopGuiApprovalEvidence && !desktopGuiRequired) {
    throw new Error("--desktop-gui-approval-evidence requires --desktop-gui-required");
  }
  return {
    evidenceDir,
    candidateSha,
    approvedLiveControlEvidence,
    claimScope,
    npmPublishApprovalEvidence,
    githubReleaseApprovalEvidence,
    desktopGuiApprovalEvidence,
    githubCiEvidence,
    codeqlEvidence,
    desktopGuiRequired,
    now,
    strict
  };
}

function readReleaseStatusPath(input: string[], index: number, flag: string): string {
  const value = input[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
  return value;
}

function readReleaseStatusValue(input: string[], index: number, flag: string): string {
  const value = input[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseReleaseDemoStatusArgs(input: string[]): { evidenceDir: string; approvedLiveControlEvidence?: string; claimScope?: ReleaseClaimScope; minSessions?: number; strict: boolean } {
  let evidenceDir: string | undefined;
  let approvedLiveControlEvidence: string | undefined;
  let claimScope: ReleaseClaimScope | undefined;
  let minSessions: number | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = readReleaseStatusPath(input, ++index, "--evidence-dir");
      continue;
    }
    if (arg === "--approved-live-control-evidence") {
      approvedLiveControlEvidence = readReleaseStatusPath(input, ++index, "--approved-live-control-evidence");
      continue;
    }
    if (arg === "--claim-scope") {
      claimScope = parseReleaseClaimScope(input, ++index, "--claim-scope");
      continue;
    }
    if (arg === "--min-sessions") {
      minSessions = parsePositiveInteger(input[++index], "--min-sessions", 100000);
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    throw new Error(`Unknown release demo-status option: ${arg}`);
  }
  if (!evidenceDir) throw new Error("release demo-status requires --evidence-dir");
  return { evidenceDir, approvedLiveControlEvidence, claimScope, minSessions, strict };
}

function parseReleaseClaimScope(input: string[], index: number, flag: string): ReleaseClaimScope {
  return normalizeReleaseClaimScope(readReleaseStatusValue(input, index, flag));
}
