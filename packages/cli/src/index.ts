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
  writeDesktopProofAction,
  type DesktopBackend
} from "../../adapters/src/index.js";
import {
  configuredLcmPeerDbPaths,
  createCloseoutEnvelopeReport,
  createDatabase,
  createIndexedSessionSanitizerRepairPlan,
  createIndexedSessionSanitizerReport,
  defaultCodexRoots,
  defaultDatabasePath,
  describeRecallRef,
  describeSession,
  evaluateRetrievalScenarios,
  expandQuery,
  expandRecallRef,
  getCodexThreadMap,
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
import { createReleaseFinalizationStatus } from "./release-finalization-status.js";
import { runReleasePreflight } from "./release-preflight.js";
import { createReleaseStatus } from "./release-status.js";
import { createGeneralReleaseReadiness } from "./general-release-readiness.js";
import { runOpenClawDogfood } from "./openclaw-dogfood.js";
import { DEFAULT_REQUIRED_TOOL_CALLS, runOpenClawToolSmoke } from "./openclaw-tool-smoke.js";
import { createPublishedPackageSmokeReport } from "./published-package-smoke.js";
import { runOpenClawGatewayLiveControlSmoke } from "./openclaw-live-control-smoke.js";
import { runOpenClawPostActionRefreshSmoke } from "./openclaw-post-action-refresh-smoke.js";
import { createScorecardSweep } from "./scorecard-sweep.js";
import { createScenarioSweep } from "./scenario-sweep.js";
import { createRuntimeProofIssuePacket } from "./runtime-issue-packet.js";
import { createOnboardingStatusReport, writeOnboardingStatusReport } from "./onboarding-status.js";
import { createRuntimeSweepSummary } from "./runtime-sweep-summary.js";
import { normalizeReleaseClaimScope, type ReleaseClaimScope } from "./release-claim-scope.js";
import { AppServerLiveControlSmokeClient, runLiveControlSmoke } from "./live-control-smoke.js";
import {
  createLocalMacSearchUiShell,
  REQUIRED_LOCAL_MAC_SEARCH_UI_TOOLS,
  sampleLocalMacSearchUiShell,
  writeLocalMacSearchUiEvidence,
  type LocalMacSearchUiFilters,
  type LocalMacSearchUiResult,
  type LocalMacSearchUiShellReport
} from "../../local-mac-ui/src/shell.js";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const [, , command, ...args] = process.argv;
const cliFilePath = fileURLToPath(import.meta.url);

async function main() {
  if (!command) {
    printMainUsage("error");
    process.exitCode = 2;
    return;
  }
  if (command === "--help" || command === "-h") {
    printMainUsage("log");
    return;
  }
  if (command === "--version" || command === "-v") {
    console.log(readCliPackageVersion());
    return;
  }
  if (command === "onboard" && args[0] === "status") {
    if (hasHelpFlag(args.slice(1))) {
      printOnboardingStatusHelp();
      return;
    }
    const parsed = parseOnboardingStatusArgs(args.slice(1));
    const report = createOnboardingStatusReport({
      rootDir: parsed.rootDir,
      now: parsed.now,
      registryVersion: parsed.registryVersion,
      registryBetaVersion: parsed.registryBetaVersion,
      gatewaySetupStatus: parsed.gatewaySetupStatus
    });
    if (parsed.evidenceDir) writeOnboardingStatusReport(report, parsed.evidenceDir);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.ok) process.exitCode = 1;
    return;
  }
  if (command === "doctor") {
    console.log(JSON.stringify({
      ok: true,
      database: {
        configured: Boolean(process.env.LOO_DB_PATH),
        activePresent: existsSync(defaultDatabasePath()),
        location: "local"
      },
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
  if (command === "desktop" && args[0] === "proof-action") {
    if (hasHelpFlag(args.slice(1))) {
      printDesktopProofActionHelp();
      return;
    }
    const parsed = parseDesktopProofActionArgs(args.slice(1));
    const report = writeDesktopProofAction(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.proofActionReady) process.exitCode = 1;
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
    if (isBareHelpInvocation(args)) {
      printSearchHelp();
      return;
    }
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
  if (command === "sanitize" && args[0] === "sessions") {
    if (hasHelpFlag(args.slice(1))) {
      printSanitizeSessionsHelp();
      return;
    }
    const parsed = parseSanitizeSessionsArgs(args.slice(1));
    const db = createDatabase();
    try {
      const report = createIndexedSessionSanitizerReport(db, parsed);
      if (parsed.evidenceDir) {
        mkdirSync(parsed.evidenceDir, { recursive: true });
        writeFileSync(join(parsed.evidenceDir, "session-sanitizer-report.json"), `${JSON.stringify(report, null, 2)}\n`);
        if (parsed.repairPlan) {
          const repairPlan = createIndexedSessionSanitizerRepairPlan(report);
          writeFileSync(join(parsed.evidenceDir, "session-sanitizer-repair-plan.json"), `${JSON.stringify(repairPlan, null, 2)}\n`);
        }
      }
      console.log(JSON.stringify(report, null, 2));
      if (parsed.strict && (!report.ok || report.findingCount > 0)) process.exitCode = 1;
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
    if (hasHelpFlag(args.slice(1))) {
      printOpenClawDogfoodHelp();
      return;
    }
    const parsed = parseOpenClawDogfoodArgs(args.slice(1));
    const report = runOpenClawDogfood(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.dogfoodReady) process.exitCode = 1;
    return;
  }
  if (command === "openclaw" && args[0] === "tool-smoke") {
    if (hasHelpFlag(args.slice(1))) {
      printOpenClawToolSmokeHelp();
      return;
    }
    const parsed = parseOpenClawToolSmokeArgs(args.slice(1));
    const report = runOpenClawToolSmoke(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.toolSmokeReady) process.exitCode = 1;
    return;
  }
  if (command === "openclaw" && args[0] === "published-smoke") {
    if (hasHelpFlag(args.slice(1))) {
      printOpenClawPublishedSmokeHelp();
      return;
    }
    const parsed = parseOpenClawPublishedSmokeArgs(args.slice(1));
    const report = createPublishedPackageSmokeReport(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.ok) process.exitCode = 1;
    return;
  }
  if (command === "openclaw" && args[0] === "live-control-smoke") {
    if (hasHelpFlag(args.slice(1))) {
      printOpenClawLiveControlSmokeHelp();
      return;
    }
    const parsed = parseOpenClawLiveControlSmokeArgs(args.slice(1));
    const report = runOpenClawGatewayLiveControlSmoke(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.proofReady) process.exitCode = 1;
    return;
  }
  if (command === "openclaw" && args[0] === "post-action-refresh-smoke") {
    if (hasHelpFlag(args.slice(1))) {
      printOpenClawPostActionRefreshSmokeHelp();
      return;
    }
    const parsed = parseOpenClawPostActionRefreshSmokeArgs(args.slice(1));
    const report = runOpenClawPostActionRefreshSmoke(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.proofReady) process.exitCode = 1;
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
  if (command === "runtime" && args[0] === "sweep-summary") {
    if (hasHelpFlag(args.slice(1))) {
      printRuntimeSweepSummaryHelp();
      return;
    }
    const parsed = parseRuntimeSweepSummaryArgs(args.slice(1));
    const report = createRuntimeSweepSummary(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.summaryReady) process.exitCode = 1;
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
      : parsed.liveCli
        ? createLiveCliLocalMacSearchUiShell(parsed)
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
    if (parsed.runtimeProofDir) writeConnectedLocalUiRuntimeProof(parsed.runtimeProofDir, report);
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
  if (command === "runtime" && args[0] === "issue-packet") {
    if (hasHelpFlag(args.slice(1))) {
      printRuntimeIssuePacketHelp();
      return;
    }
    const parsed = parseRuntimeIssuePacketArgs(args.slice(1));
    const report = createRuntimeProofIssuePacket({
      evidenceDir: parsed.evidenceDir,
      failureReport: parsed.failureReport,
      parentIssue: parsed.parentIssue,
      operatingLoopIssue: parsed.operatingLoopIssue,
      milestone: parsed.milestone,
      now: parsed.now
    });
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.issuePacketReady) process.exitCode = 1;
    return;
  }
  if (command === "release" && args[0] === "preflight") {
    if (hasHelpFlag(args.slice(1))) {
      printReleasePreflightHelp();
      return;
    }
    const parsed = parseReleasePreflightArgs(args.slice(1));
    const report = runReleasePreflight({
      evidenceDir: parsed.evidenceDir,
      approvedLiveControlEvidence: parsed.approvedLiveControlEvidence,
      claimScope: parsed.claimScope,
      runtimeProofDir: parsed.runtimeProofDir
    });
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.releaseReady) process.exitCode = 1;
    return;
  }
  if (command === "release" && args[0] === "bundle") {
    if (hasHelpFlag(args.slice(1))) {
      printReleaseBundleHelp();
      return;
    }
    const parsed = parseReleaseBundleArgs(args.slice(1));
    const report = createReleaseBundle({
      evidenceDir: parsed.evidenceDir,
      approvedLiveControlEvidence: parsed.approvedLiveControlEvidence,
      claimScope: parsed.claimScope,
      runtimeProofDir: parsed.runtimeProofDir
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
      runtimeProofDir: parsed.runtimeProofDir,
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
  if (command === "release" && args[0] === "finalization-status") {
    if (hasHelpFlag(args.slice(1))) {
      printReleaseFinalizationStatusHelp();
      return;
    }
    const parsed = parseReleaseFinalizationStatusArgs(args.slice(1));
    const report = createReleaseFinalizationStatus(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.finalized) process.exitCode = 1;
    return;
  }
  if (command === "release" && args[0] === "general-readiness") {
    if (hasHelpFlag(args.slice(1))) {
      printGeneralReleaseReadinessHelp();
      return;
    }
    const parsed = parseGeneralReleaseReadinessArgs(args.slice(1));
    const report = createGeneralReleaseReadiness({
      evidenceDir: parsed.evidenceDir,
      freshNpmEvidence: parsed.freshNpmEvidence,
      agentDogfoodEvidence: parsed.agentDogfoodEvidence,
      now: parsed.now
    });
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.stableReady) process.exitCode = 1;
    return;
  }
  if (command === "release" && args[0] === "demo-status") {
    if (hasHelpFlag(args.slice(1))) {
      printReleaseDemoStatusHelp();
      return;
    }
    const parsed = parseReleaseDemoStatusArgs(args.slice(1));
    const report = createReleaseDemoStatus({
      evidenceDir: parsed.evidenceDir,
      approvedLiveControlEvidence: parsed.approvedLiveControlEvidence,
      claimScope: parsed.claimScope,
      runtimeProofDir: parsed.runtimeProofDir,
      minSessions: parsed.minSessions
    });
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.demoReady) process.exitCode = 1;
    return;
  }
  printMainUsage("error");
  process.exitCode = 2;
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const usageError = isCliUsageErrorMessage(message);
  console.error(`Error: ${sanitizeCliErrorMessage(message)}`);
  process.exitCode = usageError ? 2 : 1;
}

type ParsedLocalMacSearchUiArgs = {
  evidenceDir: string;
  sample: boolean;
  liveCli: boolean;
  strict: boolean;
  filters: LocalMacSearchUiFilters;
  expansionProfile?: "metadata" | "brief" | "evidence";
  tokenBudget?: number;
  runtimeProofDir?: string;
};

function createLiveCliLocalMacSearchUiShell(parsed: ParsedLocalMacSearchUiArgs): LocalMacSearchUiShellReport {
  const db = createDatabase();
  const query = parsed.filters.query?.trim() || "handoff";
  const expansionProfile = parsed.expansionProfile ?? "brief";
  const requestedTokenBudget = parsed.tokenBudget;
  try {
    const allSearch = searchSessions(db, { query, limit: 10 });
    const threadMap = getCodexThreadMap(db, {
      limit: 50,
      project: parsed.filters.project,
      status: parsed.filters.status,
      priority: parsed.filters.priority,
      blocker: parsed.filters.blocker
    });
    const mapByRef = new Map(threadMap.map((entry) => [`codex_thread:${entry.threadId}`, entry]));
    const hasMetadataFilters = Boolean(parsed.filters.project?.trim()
      || parsed.filters.status?.trim()
      || parsed.filters.priority?.trim()
      || parsed.filters.blocker?.trim());
    const search = hasMetadataFilters ? allSearch.filter((result) => mapByRef.has(result.sourceRef)) : allSearch;
    const results: LocalMacSearchUiResult[] = search.map((result) => {
      const mapped = mapByRef.get(result.sourceRef);
      return {
        title: result.title ?? result.threadId,
        sourceRef: result.sourceRef,
        safeSummary: result.summary ?? result.snippet ?? "Safe summary unavailable for this result.",
        project: mapped?.metadata.project ?? "unknown",
        status: mapped?.metadata.status ?? "unknown",
        priority: mapped?.metadata.priority ?? "unknown",
        blocker: mapped?.metadata.blocker ?? "unknown",
        updatedAt: result.updatedAt ?? mapped?.updatedAt ?? "unknown"
      };
    });
    const firstSourceRef = search[0]?.sourceRef;
    const firstThreadId = firstSourceRef?.startsWith("codex_thread:") ? firstSourceRef.slice("codex_thread:".length) : undefined;
    if (firstThreadId) {
      describeSession(db, firstThreadId);
    } else if (firstSourceRef) {
      describeRecallRef(db, { sourceRef: firstSourceRef, lcmDbPaths: configuredLcmPeerDbPaths() });
    }
    const expansion = expandQuery(db, {
      query,
      profile: expansionProfile,
      tokenBudget: requestedTokenBudget,
      lcmDbPaths: configuredLcmPeerDbPaths()
    });
    const searchSourceRefs = new Set(search.map((result) => result.sourceRef));
    const expandedSourceRef = expansion.sourceRef && searchSourceRefs.has(expansion.sourceRef) ? expansion.sourceRef : firstSourceRef;
    return createLocalMacSearchUiShell({
      requireLiveToolSource: true,
      status: {
        platform: process.platform,
        localDbAvailable: true,
        openclawPluginLoaded: true,
        availableTools: [...REQUIRED_LOCAL_MAC_SEARCH_UI_TOOLS],
        cuaStatus: "diagnostics-only",
        peekabooStatus: "permissions-status-only"
      },
      filters: {
        ...parsed.filters,
        query
      },
      expansionProfile,
      results,
      toolSource: {
        mode: "live",
        surface: "cli",
        queryId: `cli-${createHash("sha256").update(query).digest("base64url").slice(0, 24)}`,
        toolsCalled: [
          "loo_search_sessions",
          "loo_describe_session",
          "loo_expand_query",
          "loo_codex_thread_map"
        ],
        sourceRefs: search.map((result) => result.sourceRef),
        boundedExpansion: {
          profile: expansion.profile.name,
          tokenBudget: expansion.profile.tokenBudget,
          ...(expandedSourceRef ? { sourceRef: expandedSourceRef } : {})
        },
        copyAction: {
          ...(firstSourceRef ? { sourceRef: firstSourceRef } : {}),
          publicSafe: true
        }
      }
    });
  } finally {
    db.close();
  }
}

function writeConnectedLocalUiRuntimeProof(runtimeProofDir: string, shell: LocalMacSearchUiShellReport): void {
  const proofDir = resolve(runtimeProofDir);
  mkdirSync(proofDir, { recursive: true });
  const localMacShellReady = shell.shellReady === true && shell.platform === "darwin";
  const sourceRefsPresent = shell.toolSource.sourceRefs.length > 0;
  const liveToolSource = shell.toolSource.mode === "live"
    && (shell.toolSource.surface === "cli" || shell.toolSource.surface === "mcp" || shell.toolSource.surface === "openclaw-gateway")
    && shell.toolSource.toolsCalled.includes("loo_search_sessions")
    && shell.toolSource.toolsCalled.includes("loo_describe_session")
    && shell.toolSource.toolsCalled.includes("loo_expand_query")
    && shell.toolSource.toolsCalled.includes("loo_codex_thread_map");
  const publicSafe = localMacShellReady && shell.publicSafe === true && shell.rawTranscriptRendered === false && !shell.blockerCodes.some((blocker) =>
    blocker.startsWith("raw_result_field_rejected") || blocker.startsWith("unsafe_source_ref")
  );
  const proof = {
    kind: "loo_runtime_scenario_proof",
    scenario_id: "connected-local-ui-proof-v1-1",
    scenario_version: "1.1",
    proof_mode: "runtime_required",
    claim_scope: "codex-working-app-proof",
    public_safe: publicSafe,
    proof_markers: {
      local_mac_shell_ready: localMacShellReady,
      live_tool_source: liveToolSource,
      public_safe_scan: publicSafe,
      source_refs: sourceRefsPresent
    },
    raw_transcript_read: false,
    raw_prompt_included: false,
    raw_secret_included: false,
    screenshot_included: false,
    sqlite_included: false,
    live_action_count: 0,
    raw_prompt_chars: 0,
    raw_transcript_spans: 0,
    screenshot_count: 0,
    tool_surface: shell.toolSource.surface,
    result_count: shell.resultCount,
    source_ref_count: shell.toolSource.sourceRefs.length,
    bounded_expansion_profile: shell.toolSource.boundedExpansion.profile,
    copy_source_ref_present: Boolean(shell.toolSource.copyAction.sourceRef),
    platform: shell.platform,
    shell_ready: shell.shellReady
  };
  writeFileSync(join(proofDir, "connected-local-ui-proof-v1-1.runtime-proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
}

function hasHelpFlag(input: string[]): boolean {
  return input.includes("--help") || input.includes("-h");
}

function isBareHelpInvocation(input: string[]): boolean {
  return input.length > 0 && input.every((arg) => arg === "--help" || arg === "-h");
}

function printMainUsage(stream: "log" | "error"): void {
  console[stream](mainUsageText());
}

function mainUsageText(): string {
  return [
    "Usage:",
    "  loo --help",
    "  loo --version",
    "  loo onboard status [--evidence-dir path] [--root path] [--now iso] [--registry-version version] [--registry-beta-version version] [--gateway-setup-status ready|gateway_setup_required|package_failure_or_unknown] [--strict]",
    "  loo doctor",
    "  loo desktop see [direct|cua-driver|peekaboo] [--snapshot] [--max-nodes n] [--max-chars n]",
    "  loo desktop act [direct|cua-driver|peekaboo] <action>",
    "  loo desktop proof-report --evidence-dir path --observation-file path [--strict]",
    "  loo desktop live-proof-harness --evidence-dir path [--backend direct|cua-driver|peekaboo] [--target-app app] [--target-window title] [--action text] [--approval-ref ref] [--scratch-file path] [--strict]",
    "  loo desktop proof-action --evidence-dir path --backend cua-driver --target-app TextEdit --target-window lco-desktop-proof.txt --action \"launch_app TextEdit scratch window\" --action-hash hash --approval-ref ref --approval-file path --permission-state state --scratch-file path --execute [--strict]",
    "  loo index codex [--max-files n] [--max-bytes-per-file n] [--max-events-per-file n] [roots...]",
    "  loo probe codex-sqlite [roots...]",
    "  loo search <query>",
    "  loo session-map [--project name] [--status value] [--priority value] [--blocker value] [--priority-order urgent,high,medium,low] [--limit n]",
    "  loo grep [--lcm-db path] [--profile metadata|brief|evidence] [--token-budget n] <query>",
    "  loo describe [--lcm-db path] <source-ref>",
    "  loo expand-query [--lcm-db path] [--profile metadata|brief|evidence] [--token-budget n] <query>",
    "  loo expand-ref [--lcm-db path] [--profile metadata|brief|evidence] [--token-budget n] <source-ref>",
    "  loo closeout dry-run [--thread-id id] [--limit n] [--include-unavailable]",
    "  loo sanitize sessions [--thread-id id] [--limit n] [--evidence-dir path] [--strict]",
    "  loo serve",
    "  loo audit-path",
    "  loo codex live-control-smoke --evidence-dir path [--thread-id id] [--message text] [--cwd path] [--timeout-ms ms] [--audit-path path] [--codex-bin path] [--app-server-args \"app-server --stdio\"]",
    "  loo openclaw dogfood [--dev] [--profile name] [--install-source path] [--link] [--force-install] [--evidence-path path] [--strict]",
    "  loo openclaw tool-smoke [--openclaw-bin path] [--dev] [--profile name] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--query text] [--thread-id id] [--expand-profile metadata|brief|evidence] [--token-budget n] [--required-tool name] [--evidence-path path] [--strict]",
    "  loo openclaw published-smoke --evidence-dir path --dogfood-report path --tool-smoke-report path [--configured-tool-smoke-report path] [--npm-install-diagnostic-report path] [--registry-version version] [--registry-beta-version version] [--root path] [--now iso] [--strict]",
    "  loo openclaw live-control-smoke --evidence-dir path --thread-id id [--openclaw-bin path] [--dev] [--profile name] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--message text] [--strict]",
    "  loo openclaw post-action-refresh-smoke --evidence-dir path --thread-id id --live-proof-report path [--openclaw-bin path] [--dev] [--profile name] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--query text] [--expand-profile metadata|brief|evidence] [--token-budget n] [--strict]",
    "  loo scorecards sweep --evidence-dir path [--scorecard-dir path] [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--strict]",
    "  loo runtime sweep-summary --evidence-dir path --dry-run-scenarios path --runtime-scenarios path --scorecard-sweep path --published-smoke path [--runtime-proof-dir path] [--now iso] [--strict]",
    "  loo ui local-mac-search --evidence-dir path [--sample] [--strict]",
    "  loo eval retrieval --scenario-file path [--evidence-path path] [--strict]",
    "  loo eval scenarios --evidence-dir path [--scenario-dir path] [--runtime-proof-dir path] [--strict]",
    "  loo runtime issue-packet --evidence-dir path --failure-report path [--parent-issue #n] [--operating-loop #n] [--milestone name] [--now iso] [--strict]",
    "  loo release preflight [--evidence-dir path] [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--approved-live-control-evidence path] [--runtime-proof-dir path] [--strict]",
    "  loo release bundle --evidence-dir path [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--approved-live-control-evidence path] [--runtime-proof-dir path] [--strict]",
    "  loo release status --evidence-dir path --candidate-sha sha [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--approved-live-control-evidence path] [--runtime-proof-dir path] [--npm-publish-approval-evidence path] [--github-release-approval-evidence path] [--github-ci-evidence path] [--codeql-evidence path] [--desktop-gui-required --desktop-gui-approval-evidence path] [--now iso] [--strict]",
    "  loo release finalization-status --evidence-dir path --candidate-sha sha --npm-publish-evidence path --git-tag-evidence path --github-release-evidence path [--package-name name] [--package-version version] [--expected-dist-tag beta|next|latest] [--expected-github-prerelease true|false] [--now iso] [--strict]",
    "  loo release general-readiness --evidence-dir path [--fresh-npm-evidence path] [--agent-dogfood-evidence path] [--now iso] [--strict]",
    "  loo release demo-status --evidence-dir path [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--approved-live-control-evidence path] [--runtime-proof-dir path] [--min-sessions n] [--strict]"
  ].join("\n");
}

function readCliPackageVersion(): string {
  const packageRoot = findCliPackageRoot(dirname(cliFilePath)) ?? findCliPackageRoot(process.cwd());
  if (!packageRoot) return "unknown";
  try {
    const parsed = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    return "unknown";
  }
}

function findCliPackageRoot(start: string): string | null {
  let cursor = start;
  while (true) {
    const packageJsonPath = join(cursor, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown };
        if (parsed.name === "lossless-openclaw-orchestrator") return cursor;
      } catch {
        // Keep walking: a malformed ancestor package.json should not hide the real CLI package root.
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function sanitizeCliErrorMessage(message: string): string {
  return message
    .replace(/file:\/\/[^\r\n)]*?(?=:\s|\)|$)/g, "<redacted-local-path>")
    .replace(/(?:\/Users|\/Volumes|\/private\/var|\/var\/folders|\/home|\/root|\/tmp|\/workspace|\/workspaces)\/[^\r\n)]*?(?=:\s|\)|$)/g, "<redacted-local-path>")
    .replace(/(?:[A-Za-z]:)?\\(?:Users|home|tmp|workspace|workspaces)\\[^\r\n)]*?(?=:\s|\)|$)/g, "<redacted-local-path>");
}

function isCliUsageErrorMessage(message: string): boolean {
  return /^Unknown .+ option: /.test(message)
    || /^Unknown release claim scope: /.test(message)
    || /^Invalid --[\w-]+: /.test(message)
    || / requires (?:a value|a path|a number|a positive integer|an integer|--[\w-]+)/.test(message)
    || /^--[\w-]+ must be /.test(message);
}

function printSearchHelp(): void {
  console.log([
    "Usage:",
    "  loo search <query>",
    "",
    "Search indexed Codex sessions with bounded safe text.",
    "",
    "Safety boundary:",
    "  The help command does not open or query the local orchestrator database.",
    "  Search results use source-prefixed refs and safe summaries rather than raw transcripts."
  ].join("\n"));
}

function printOpenClawDogfoodHelp(): void {
  console.log([
    "Usage:",
    "  loo openclaw dogfood [--openclaw-bin path] [--dev] [--profile name] [--plugin-list-json path] [--install-source path] [--link] [--force-install] [--required-tool name] [--evidence-path path] [--strict]",
    "",
    "Checks whether the Lossless OpenClaw Orchestrator plugin is installed, loaded, and exposes required loo_* tools through OpenClaw.",
    "",
    "Options:",
    "  --plugin-list-json path  Read a captured OpenClaw plugin list fixture instead of invoking OpenClaw.",
    "  --install-source path    Install the plugin from a local package or checkout before checking it.",
    "  --link                  Install a local plugin source as a link.",
    "  --force-install         Force reinstall when not using --link.",
    "  --required-tool name    Replace the default required loo_* tool set with explicit entries; may be repeated.",
    "  --evidence-path path    Write a public-safe dogfood report.",
    "  --strict                Exit non-zero when the plugin or required tools are not ready.",
    "",
    "Safety boundary:",
    "  The command writes public-safe plugin/tool readiness evidence.",
    "  With --install-source, it may run OpenClaw plugin install before writing evidence.",
    "  It does not read raw Codex transcripts, run live Codex control, mutate a desktop GUI, publish npm, or create a GitHub Release."
  ].join("\n"));
}

function printOpenClawToolSmokeHelp(): void {
  console.log([
    "Usage:",
    "  loo openclaw tool-smoke [--openclaw-bin path] [--dev] [--profile name] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--query text] [--thread-id id] [--expand-profile metadata|brief|evidence] [--token-budget n] [--desktop-fallback-coherence fixture|omit] [--required-tool name] [--evidence-path path] [--strict]",
    "",
    "Runs a public-safe OpenClaw gateway smoke for selected loo_* tools.",
    "",
    "Default tools:",
    `  ${DEFAULT_REQUIRED_TOOL_CALLS.join(", ")}`,
    "",
    "Options:",
    "  --required-tool name    Replace the default required loo_* tool set with explicit entries; may be repeated.",
    "  --desktop-fallback-coherence fixture|omit",
    "                          For loo_codex_desktop_fallback_status, send the default public-safe coherence fixture or omit coherence to prove the coherence_input_missing handoff.",
    "  --evidence-path path    Write a public-safe tool-smoke report.",
    "  --strict                Exit non-zero when the catalog or required tool calls are not ready.",
    "",
    "Safety boundary:",
    "  The command invokes selected tools through OpenClaw Gateway and stores only public-safe summaries.",
    "  loo_codex_control_dry_run remains dry-run only; the command does not run live Codex control.",
    "  It does not mutate a desktop GUI, does not publish npm, does not create a GitHub Release, does not deliver messages, and does not approve broad gateway scope."
  ].join("\n"));
}

function printScorecardSweepHelp(): void {
  console.log([
    "Usage:",
    "  loo scorecards sweep --evidence-dir path [--scorecard-dir path] [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--strict]",
    "",
    "Writes a public-safe scorecard sweep packet for the beta acceptance scorecards.",
    "",
    "Required:",
    "  --evidence-dir is required and must not be the same directory as --scorecard-dir.",
    "  --claim-scope follows the release gate scope; reduced-scope beta sweeps do not require working-app runtime proof scorecards.",
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
    "  loo eval scenarios --evidence-dir path [--scenario-dir path] [--runtime-proof-dir path] [--scenario-id id ...] [--strict]",
    "",
    "Writes public-safe QA Lab scenario scorecards for orchestrator eval tasks.",
    "",
    "Required:",
    "  --evidence-dir is required and must not be the same directory as --scenario-dir.",
    "",
    "Runtime proof:",
    "  --runtime-proof-dir provides public-safe v1.1 proof marker JSON files named <scenario-id>.runtime-proof.json.",
    "  v1.1 runtime-required scenarios fail closed with runtime_proof_missing:<id>:<marker> until those proof markers exist.",
    "  --scenario-id may be repeated to scope a runtime sweep to the explicitly claimed surfaces.",
    "",
    "Strict mode:",
    "  --strict exits non-zero when scenarios are missing, malformed, omit required forbidden behaviors, or when raw evidence artifacts are present.",
    "  Common blockers include scenario_missing_field:<id>:<field>, runtime_proof_missing:<id>:<marker>, and raw_artifact:<reason>:<name>.",
    "",
    "Safety boundary:",
    "  The command validates dry-run contracts or supplied public-safe runtime proof markers.",
    "  It does not read raw Codex transcripts, run live Codex control, mutate a desktop GUI, publish npm, or create a GitHub Release."
  ].join("\n"));
}

function printRuntimeIssuePacketHelp(): void {
  console.log([
    "Usage:",
    "  loo runtime issue-packet --evidence-dir path --failure-report path [--parent-issue #n] [--operating-loop #n] [--milestone name] [--now iso] [--strict]",
    "",
    "Writes a public-safe issue-ready handoff packet from a failed runtime proof or scenario sweep report.",
    "",
    "Required:",
    "  --evidence-dir is required and receives runtime-proof-issue-packet.json.",
    "  --failure-report points to the failed public-safe runtime proof, smoke, or scenario-sweep JSON report.",
    "",
    "Strict mode:",
    "  --strict exits non-zero when the failure report is missing, malformed, lacks blocker codes, or when packet redaction fails.",
    "",
    "Safety boundary:",
    "  The command never runs gh issue create and never writes to GitHub.",
    "  It records only blocker codes, scenario ids, duplicate-check query, acceptance criteria, proof boundary, and redaction categories.",
    "  It does not read raw Codex transcripts, run live Codex control, mutate a GUI, publish npm, or create a GitHub Release."
  ].join("\n"));
}

function printRuntimeSweepSummaryHelp(): void {
  console.log([
    "Usage:",
    "  loo runtime sweep-summary --evidence-dir path --dry-run-scenarios path --runtime-scenarios path --scorecard-sweep path --published-smoke path [--runtime-proof-dir path] [--now iso] [--strict]",
    "",
    "Writes a public-safe summary that separates dry-run scenario readiness from missing runtime proof markers.",
    "",
    "Required:",
    "  --dry-run-scenarios points to the v1 dry-run scenario sweep report.",
    "  --runtime-scenarios points to the v1.1 runtime-required scenario sweep report.",
    "  --scorecard-sweep points to the working-app scorecard sweep report.",
    "  --published-smoke points to the published-package or gateway setup smoke report.",
    "",
    "Strict mode:",
    "  --strict exits non-zero only when the summary itself cannot be produced safely.",
    "  Missing runtime markers remain claim-boundary blockers, not packet-generation failures.",
    "",
    "Safety boundary:",
    "  The command consumes public-safe reports only.",
    "  It does not read raw Codex transcripts, run live Codex control, mutate a GUI, publish npm, create tags, or create a GitHub Release."
  ].join("\n"));
}

function printOnboardingStatusHelp(): void {
  console.log([
    "Usage:",
    "  loo onboard status [--evidence-dir path] [--root path] [--now iso] [--registry-version version] [--registry-beta-version version] [--gateway-setup-status ready|gateway_setup_required|package_failure_or_unknown] [--strict]",
    "",
    "Writes a public-safe first-run readiness report for local package, plugin, and entrypoint state.",
    "",
    "Strict mode:",
    "  --strict exits non-zero when required source files, manifests, or required loo_* tool declarations are missing.",
    "",
    "Deterministic evidence:",
    "  --now pins generatedAt for reproducible release packets.",
    "  --root overrides the detected package root for fixture or package inspection.",
    "",
    "Safety boundary:",
    "  The command reads local package metadata and manifests only.",
    "  It does not install plugins, read raw Codex transcripts, run live Codex control, or mutate a GUI.",
    "  It does not publish npm packages or create a GitHub Release."
  ].join("\n"));
}

function printSanitizeSessionsHelp(): void {
  console.log([
    "Usage:",
    "  loo sanitize sessions [--thread-id id] [--limit n] [--evidence-dir path] [--repair-plan] [--strict]",
    "",
    "Writes a public-safe sanitizer report from local indexed Codex safe text.",
    "  --repair-plan also writes session-sanitizer-repair-plan.json with redacted dry-run repair tasks.",
    "",
    "Strict mode:",
    "  --strict exits non-zero when no indexed source is selected or when sanitizer findings are present.",
    "",
    "Safety boundary:",
    "  The command reads the local orchestrator index only.",
    "  It does not read raw Codex transcripts directly, perform repairs, run live Codex control, mutate a GUI, publish npm, or create a GitHub Release."
  ].join("\n"));
}

function printReleaseStatusHelp(): void {
  console.log([
    "Usage:",
    "  loo release status --evidence-dir path --candidate-sha sha [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--approved-live-control-evidence path] [--runtime-proof-dir path] [--npm-publish-approval-evidence path] [--github-release-approval-evidence path] [--github-ci-evidence path] [--codeql-evidence path] [--desktop-gui-required --desktop-gui-approval-evidence path] [--strict]",
    "",
    "Writes a public-safe release status packet without performing gated release actions.",
    "",
    "Proof markers:",
    "  CI and CodeQL checks use kind: \"loo_release_check_evidence\" with check, commitSha, status, conclusion, runUrl, warnings, and rawSecretIncluded: false.",
    "  npm, GitHub Release, and optional desktop GUI approvals use kind: \"loo_release_operation_approval\" with operation, approved: true, approvalRef, and rawSecretIncluded: false.",
    "  Desktop GUI approvals also require desktopBackend, targetApp, targetWindow, action, actionHash, approvalNonce, issuedAt, expiresAt, focusBeforeApplication, focusAfterApplication, focusChanged: false, focusProof, and rawScreenshotIncluded: false.",
    "  When --desktop-gui-required is present, --runtime-proof-dir must also include desktop-collaboration-action-bound-v1-1.runtime-proof.json.",
    "  Live-control proof is validated through release preflight and must be a structured approved live-control smoke marker unless --claim-scope codex-read-search-expand-dry-run explicitly excludes live-control claims.",
    "  The codex-working-app-proof scope also requires --runtime-proof-dir with public-safe #158 and #159 v1.1 marker files.",
    "",
    "Strict mode:",
    "  --strict exits non-zero until the candidate SHA, CI/CodeQL proofs, explicit release approvals, and scope-required approved live-control smoke evidence satisfy the release gates.",
    "",
    "Safety boundary:",
    "  The command does not publish npm, does not create a GitHub Release, does not run live Codex control, and does not perform desktop GUI mutation."
  ].join("\n"));
}

function printReleaseFinalizationStatusHelp(): void {
  console.log([
    "Usage:",
    "  loo release finalization-status --evidence-dir path --candidate-sha sha --npm-publish-evidence path --git-tag-evidence path --github-release-evidence path [--package-name name] [--package-version version] [--expected-dist-tag beta|next|latest] [--expected-github-prerelease true|false] [--now iso] [--strict]",
    "",
    "Writes a public-safe post-publish release finalization packet.",
    "",
    "Proof markers:",
    "  npm evidence uses kind: \"loo_release_npm_publish_evidence\" with packageName, packageVersion, distTag, distTagVersion, latestVersion, published: true, and rawSecretIncluded: false.",
    "  git tag evidence uses kind: \"loo_release_git_tag_evidence\" with tagName, tagCommitSha, and rawSecretIncluded: false.",
    "  GitHub Release evidence uses kind: \"loo_release_github_release_evidence\" with tagName, releaseUrl, isPrerelease, optional targetCommitSha, and rawSecretIncluded: false.",
    "",
    "Strict mode:",
    "  --strict exits non-zero until npm package/dist-tag, git tag SHA, and GitHub Release/prerelease evidence all match the candidate.",
    "",
    "Safety boundary:",
    "  The command consumes sanitized evidence only.",
    "  It does not publish npm, create tags, create GitHub Releases, promote npm latest, run live Codex control, or mutate a GUI."
  ].join("\n"));
}

function printGeneralReleaseReadinessHelp(): void {
  console.log([
    "Usage:",
    "  loo release general-readiness --evidence-dir path [--fresh-npm-evidence path] [--agent-dogfood-evidence path] [--now iso] [--strict]",
    "",
    "Writes a public-safe 1.0 general-release readiness packet without performing release actions.",
    "",
    "Required evidence:",
    "  --fresh-npm-evidence points to a public-safe `loo openclaw published-smoke` report with clean-profile gateway status ready.",
    "  --agent-dogfood-evidence points to a public-safe `loo openclaw tool-smoke` report with agentReasoning and dry-run evidence.",
    "",
    "Strict mode:",
    "  --strict exits non-zero until docs, skill/playbook, M9 scenarios, fresh npm proof, and agent dogfood proof are complete.",
    "",
    "Safety boundary:",
    "  The command does not publish npm, does not move npm latest, does not create a GitHub Release, does not run live Codex control, and does not perform desktop GUI mutation."
  ].join("\n"));
}

function printOpenClawPublishedSmokeHelp(): void {
  console.log([
    "Usage:",
    "  loo openclaw published-smoke --evidence-dir path --dogfood-report path --tool-smoke-report path [--configured-tool-smoke-report path] [--npm-install-diagnostic-report path] [--registry-version version] [--registry-beta-version version] [--root path] [--now iso] [--strict]",
    "",
    "Writes a public-safe summary of the published npm beta install path and gateway setup state.",
    "",
    "This command consumes sanitized reports from `loo openclaw dogfood` and `loo openclaw tool-smoke`.",
    "Optional `--configured-tool-smoke-report` records a separately named configured-profile gateway proof without marking the fresh published profile ready.",
    "Optional `--npm-install-diagnostic-report` records public-safe npm selector drift and tarball fallback proof without storing raw npm output.",
    "It does not run npm install, does not call OpenClaw, does not run live Codex control, and does not mutate a desktop GUI."
  ].join("\n"));
}

function printReleasePreflightHelp(): void {
  console.log([
    "Usage:",
    "  loo release preflight [--evidence-dir path] [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--approved-live-control-evidence path] [--runtime-proof-dir path] [--strict]",
    "",
    "Writes a public-safe release preflight packet without performing gated release actions.",
    "",
    "Claim scopes:",
    "  codex-read-search-expand-dry-run excludes live-control and working-app runtime proof claims.",
    "  codex-working-app-proof requires approved live-control proof and public-safe #158/#159 v1.1 runtime proof markers.",
    "",
    "Common blockers:",
    "  approved_live_control_smoke_missing",
    "  runtime_proof_missing:<scenario-id>:<marker>",
    "  release_notes_missing",
    "",
    "Strict mode:",
    "  --strict exits non-zero while scope-required evidence is missing or unsafe.",
    "",
    "Safety boundary:",
    "  The command does not publish npm, does not create a GitHub Release, does not run live Codex control, and does not perform desktop GUI mutation."
  ].join("\n"));
}

function printReleaseBundleHelp(): void {
  console.log([
    "Usage:",
    "  loo release bundle --evidence-dir path [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--approved-live-control-evidence path] [--runtime-proof-dir path] [--strict]",
    "",
    "Writes public-safe release notes and bundle manifests without performing gated release actions.",
    "",
    "Claim scopes:",
    "  codex-read-search-expand-dry-run excludes live-control and working-app runtime proof claims.",
    "  codex-working-app-proof requires approved live-control proof and public-safe #158/#159 v1.1 runtime proof markers.",
    "",
    "Strict mode:",
    "  --strict exits non-zero while scope-required release evidence is missing or unsafe.",
    "",
    "Safety boundary:",
    "  The command does not publish npm, does not create a GitHub Release, does not run live Codex control, and does not perform desktop GUI mutation."
  ].join("\n"));
}

function printReleaseDemoStatusHelp(): void {
  console.log([
    "Usage:",
    "  loo release demo-status --evidence-dir path [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--approved-live-control-evidence path] [--runtime-proof-dir path] [--min-sessions n] [--strict]",
    "",
    "Checks public-safe beta demo evidence without performing gated release actions.",
    "",
    "Demo evidence:",
    "  Requires indexed-session counts, plan/final search evidence, bounded expansion evidence, and control dry-run evidence.",
    "  codex-working-app-proof also requires approved live-control proof and public-safe #158/#159 v1.1 runtime proof markers.",
    "",
    "Strict mode:",
    "  --strict exits non-zero while required demo evidence is missing, unsafe, or inconsistent.",
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

function printOpenClawLiveControlSmokeHelp(): void {
  console.log([
    "Usage:",
    "  loo openclaw live-control-smoke --evidence-dir path --thread-id id [--openclaw-bin path] [--dev] [--profile name] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--message text] [--strict]",
    "",
    "Runs one approval-gated live Codex send through the installed OpenClaw gateway tools.invoke path.",
    "",
    "Outputs:",
    "  openclaw-gateway-live-codex-v1-1.runtime-proof.json",
    "  openclaw-gateway-live-control-smoke-report.json",
    "",
    "Safety boundary:",
    "  The command requires an explicit --thread-id target.",
    "  It invokes loo_codex_control_dry_run first, then uses the matching approval_audit_id for loo_codex_send_message with dry_run:false.",
    "  It reads loo_audit_tail to prove matching dry-run/live audit metadata.",
    "  Evidence contains refs, audit ids, hashes, tool names, and status only.",
    "  It does not write raw prompt text, raw transcript spans, screenshots, SQLite DBs, tokens, or credentials.",
    "  It does not approve broad gateway scope, GUI mutation, unattended control, Claude parity, npm publish, or GitHub Release creation."
  ].join("\n"));
}

function printOpenClawPostActionRefreshSmokeHelp(): void {
  console.log([
    "Usage:",
    "  loo openclaw post-action-refresh-smoke --evidence-dir path --thread-id id --live-proof-report path [--openclaw-bin path] [--dev] [--profile name] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--query text] [--expand-profile metadata|brief|evidence] [--token-budget n] [--strict]",
    "",
    "Runs the #159 post-action refresh and safe reasoning proof through OpenClaw gateway tools.invoke.",
    "",
    "Outputs:",
    "  post-action-refresh-reasoning-v1-1.runtime-proof.json",
    "  post-action-refresh-reasoning-report.json",
    "",
    "Safety boundary:",
    "  The command requires a #158 live-control proof report for the same thread.",
    "  It invokes only read/recall tools: loo_codex_thread_map, loo_search_sessions, loo_describe_session, and loo_expand_query.",
    "  Evidence contains source refs, safe summary deltas, bounded profile metadata, omitted markers, and a safe reasoning note only.",
    "  It does not run live Codex control, GUI mutation, npm publish, GitHub Release creation, or raw transcript inspection."
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
    "  desktop-collaboration-action-bound-v1-1.runtime-proof.json when the observation satisfies the runtime proof contract",
    "",
    "Safety boundary:",
    "  This command does not run a desktop GUI action, does not capture screenshots, and does not authorize unattended desktop takeover."
  ].join("\n"));
}

function printDesktopLiveProofHarnessHelp(): void {
  console.log([
    "Usage:",
    "  loo desktop live-proof-harness --evidence-dir path [--backend direct|cua-driver|peekaboo] [--target-app app] [--target-window title] [--action text] [--approval-ref ref] [--scratch-file path] [--strict]",
    "",
    "Writes a public-safe desktop live/no-focus proof harness packet without performing the action.",
    "",
    "Outputs:",
    "  desktop-live-proof-harness.json",
    "  desktop-proof-action-approval.json when the exact CUA/TextEdit proof-action tuple and scratch path are present",
    "",
    "Strict mode:",
    "  --strict exits non-zero until a GUI fallback backend, target app/window, action, approval ref, available backend, and stable no-focus status probe are present.",
    "",
    "Safety boundary:",
    "  This command does not run a desktop GUI action, does not capture screenshots, does not run live Codex control, and does not authorize unattended desktop takeover."
  ].join("\n"));
}

function printDesktopProofActionHelp(): void {
  console.log([
    "Usage:",
    "  loo desktop proof-action --evidence-dir path --backend cua-driver --target-app TextEdit --target-window lco-desktop-proof.txt --action \"launch_app TextEdit scratch window\" --action-hash hash --approval-ref ref --approval-file path --permission-state state --scratch-file path --execute [--strict]",
    "",
    "Runs the single supported desktop proof action: CUA Driver launch_app into a TextEdit scratch window.",
    "",
    "Outputs:",
    "  desktop-proof-action.json",
    "  desktop-gui-observation.json when a backend action was attempted",
    "",
    "Strict mode:",
    "  --strict exits non-zero until the action is proof-ready and public-safe.",
    "",
    "Safety boundary:",
    "  This command requires --execute, an exact action hash, and a matching approval artifact before it calls the backend.",
    "  It does not enable generic GUI mutation, Codex GUI mutation, prompt typing, screenshots, or unattended desktop takeover.",
    "  It records only public-safe action metadata and a proof-report observation; raw backend stdout/stderr and scratch file paths are excluded from evidence."
  ].join("\n"));
}

function printLocalMacSearchUiHelp(): void {
  console.log([
    "Usage:",
    "  loo ui local-mac-search --evidence-dir path [--sample|--live-cli] [--query text] [--project name] [--status value] [--priority value] [--blocker value] [--expansion-profile metadata|brief|evidence] [--token-budget n] [--runtime-proof-dir path] [--strict]",
    "",
    "Writes a public-safe local Mac search UI packet.",
    "",
    "Outputs:",
    "  local-mac-search-ui.html",
    "  local-mac-search-ui-report.json",
    "  local-mac-search-ui-scorecard.json",
    "  connected-local-ui-proof-v1-1.runtime-proof.json when --runtime-proof-dir is provided",
    "",
    "Safety boundary:",
    "  The command does not read raw Codex transcripts, does not run live Codex control, does not mutate the GUI, and does not claim a signed or release-ready macOS app.",
    "  --live-cli uses the local orchestrator DB through read-only CLI recall surfaces and records tool provenance.",
    "  Runtime proof marks local_mac_shell_ready only when the shell is actually ready on macOS.",
    "  Without --sample or --live-cli, the shell intentionally fails closed until local DB, OpenClaw plugin, and required loo_* tools are proven available."
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
  scratchFilePath?: string;
  strict: boolean;
} {
  let evidenceDir = "";
  let backend: DesktopBackend | undefined;
  let targetApp: string | undefined;
  let targetWindow: string | undefined;
  let action: string | undefined;
  let approvalRef: string | undefined;
  let scratchFilePath: string | undefined;
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
    } else if (arg === "--scratch-file") {
      scratchFilePath = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown desktop live-proof-harness option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("desktop live-proof-harness requires --evidence-dir");
  return { evidenceDir, backend, targetApp, targetWindow, action, approvalRef, scratchFilePath, strict };
}

function parseDesktopProofActionArgs(input: string[]): {
  evidenceDir: string;
  backend?: DesktopBackend;
  targetApp?: string;
  targetWindow?: string;
  action?: string;
  actionHash?: string;
  approvalRef?: string;
  approvalArtifact?: unknown;
  permissionState?: string;
  scratchFilePath?: string;
  execute: boolean;
  strict: boolean;
} {
  let evidenceDir = "";
  let backend: DesktopBackend | undefined;
  let targetApp: string | undefined;
  let targetWindow: string | undefined;
  let action: string | undefined;
  let actionHash: string | undefined;
  let approvalRef: string | undefined;
  let approvalFilePath: string | undefined;
  let permissionState: string | undefined;
  let scratchFilePath: string | undefined;
  let execute = false;
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
    } else if (arg === "--action-hash") {
      actionHash = requireOptionValue(input[++index], arg);
    } else if (arg === "--approval-ref") {
      approvalRef = requireOptionValue(input[++index], arg);
    } else if (arg === "--approval-file") {
      approvalFilePath = requireOptionValue(input[++index], arg);
    } else if (arg === "--permission-state") {
      permissionState = requireOptionValue(input[++index], arg);
    } else if (arg === "--scratch-file") {
      scratchFilePath = requireOptionValue(input[++index], arg);
    } else if (arg === "--execute") {
      execute = true;
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown desktop proof-action option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("desktop proof-action requires --evidence-dir");
  return { evidenceDir, backend, targetApp, targetWindow, action, actionHash, approvalRef, approvalArtifact: approvalFilePath ? readJsonFile(approvalFilePath, "approval file") : undefined, permissionState, scratchFilePath, execute, strict };
}

function readJsonFile(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${label} ${path}: ${(error as Error).message}`);
  }
}

function readDesktopProofReportObservation(path: string): unknown {
  return readJsonFile(path, "observation file");
}

function parseLocalMacSearchUiArgs(input: string[]): ParsedLocalMacSearchUiArgs {
  let evidenceDir = "";
  let sample = false;
  let liveCli = false;
  let strict = false;
  const filters: LocalMacSearchUiFilters = {};
  let expansionProfile: "metadata" | "brief" | "evidence" | undefined;
  let tokenBudget: number | undefined;
  let runtimeProofDir: string | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--sample") {
      sample = true;
    } else if (arg === "--live-cli") {
      liveCli = true;
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
    } else if (arg === "--token-budget") {
      tokenBudget = parsePositiveInteger(input[++index], arg, 8000);
    } else if (arg === "--runtime-proof-dir") {
      runtimeProofDir = requireOptionValue(input[++index], arg);
    } else {
      throw new Error(`Unknown ui local-mac-search option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("ui local-mac-search requires --evidence-dir");
  if (sample && liveCli) throw new Error("ui local-mac-search accepts only one of --sample or --live-cli");
  return { evidenceDir, sample, liveCli, strict, filters, expansionProfile, tokenBudget, runtimeProofDir };
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

function parseOnboardingStatusArgs(input: string[]): {
  evidenceDir?: string;
  rootDir?: string;
  now?: string;
  registryVersion?: string;
  registryBetaVersion?: string;
  gatewaySetupStatus?: "ready" | "gateway_setup_required" | "package_failure_or_unknown";
  strict: boolean;
} {
  const parsed: {
    evidenceDir?: string;
    rootDir?: string;
    now?: string;
    registryVersion?: string;
    registryBetaVersion?: string;
    gatewaySetupStatus?: "ready" | "gateway_setup_required" | "package_failure_or_unknown";
    strict: boolean;
  } = { strict: false };
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      parsed.evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--root") {
      parsed.rootDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--now") {
      parsed.now = requireOptionValue(input[++index], arg);
    } else if (arg === "--registry-version") {
      parsed.registryVersion = requireOptionValue(input[++index], arg);
    } else if (arg === "--registry-beta-version") {
      parsed.registryBetaVersion = requireOptionValue(input[++index], arg);
    } else if (arg === "--gateway-setup-status") {
      parsed.gatewaySetupStatus = parseGatewaySetupStatus(requireOptionValue(input[++index], arg));
    } else if (arg === "--strict") {
      parsed.strict = true;
    } else {
      throw new Error(`Unknown onboard status option: ${arg}`);
    }
  }
  return parsed;
}

function parseGatewaySetupStatus(value: string): "ready" | "gateway_setup_required" | "package_failure_or_unknown" {
  if (value === "ready" || value === "gateway_setup_required" || value === "package_failure_or_unknown") return value;
  throw new Error(`Invalid --gateway-setup-status: ${value}`);
}

function parseSanitizeSessionsArgs(input: string[]): { threadId?: string; limit?: number; evidenceDir?: string; repairPlan: boolean; strict: boolean } {
  const parsed: { threadId?: string; limit?: number; evidenceDir?: string; repairPlan: boolean; strict: boolean } = { repairPlan: false, strict: false };
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--thread-id") {
      parsed.threadId = requireOptionValue(input[++index], arg);
    } else if (arg === "--limit") {
      parsed.limit = parsePositiveInteger(input[++index], "--limit", 500);
    } else if (arg === "--evidence-dir") {
      parsed.evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--repair-plan") {
      parsed.repairPlan = true;
    } else if (arg === "--strict") {
      parsed.strict = true;
    } else {
      throw new Error(`Unknown sanitize sessions option: ${arg}`);
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

function parseScenarioSweepArgs(input: string[]): { evidenceDir: string; scenarioDir?: string; runtimeProofDir?: string; scenarioIds?: string[]; strict: boolean } {
  let evidenceDir = "";
  let scenarioDir: string | undefined;
  let runtimeProofDir: string | undefined;
  const scenarioIds: string[] = [];
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--scenario-dir") {
      scenarioDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--runtime-proof-dir") {
      runtimeProofDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--scenario-id") {
      scenarioIds.push(requireOptionValue(input[++index], arg));
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown eval scenarios option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("eval scenarios requires --evidence-dir");
  return { evidenceDir, scenarioDir, runtimeProofDir, scenarioIds: scenarioIds.length ? scenarioIds : undefined, strict };
}

function parseRuntimeIssuePacketArgs(input: string[]): {
  evidenceDir: string;
  failureReport: string;
  parentIssue?: string;
  operatingLoopIssue?: string;
  milestone?: string;
  now?: string;
  strict: boolean;
} {
  let evidenceDir = "";
  let failureReport = "";
  let parentIssue: string | undefined;
  let operatingLoopIssue: string | undefined;
  let milestone: string | undefined;
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--failure-report") {
      failureReport = requireOptionValue(input[++index], arg);
    } else if (arg === "--parent-issue") {
      parentIssue = requireOptionValue(input[++index], arg);
    } else if (arg === "--operating-loop") {
      operatingLoopIssue = requireOptionValue(input[++index], arg);
    } else if (arg === "--milestone") {
      milestone = requireOptionValue(input[++index], arg);
    } else if (arg === "--now") {
      now = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown runtime issue-packet option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("runtime issue-packet requires --evidence-dir");
  if (!failureReport) throw new Error("runtime issue-packet requires --failure-report");
  return { evidenceDir, failureReport, parentIssue, operatingLoopIssue, milestone, now, strict };
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
  desktopFallbackCoherence?: "fixture" | "omit";
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
    } else if (arg === "--desktop-fallback-coherence") {
      const value = requireOptionValue(input[++index], arg);
      if (value !== "fixture" && value !== "omit") throw new Error("--desktop-fallback-coherence must be fixture or omit");
      parsed.desktopFallbackCoherence = value;
    } else if (arg === "--evidence-path") {
      parsed.evidencePath = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      parsed.strict = true;
    } else {
      throw new Error(`Unknown openclaw tool-smoke option: ${arg}`);
    }
  }
  if (requiredTools.length > 0) parsed.requiredTools = requiredTools;
  const effectiveRequiredTools = requiredTools.length > 0 ? requiredTools : DEFAULT_REQUIRED_TOOL_CALLS;
  if (parsed.desktopFallbackCoherence === "omit" && !effectiveRequiredTools.includes("loo_codex_desktop_fallback_status")) {
    throw new Error("--desktop-fallback-coherence omit requires --required-tool loo_codex_desktop_fallback_status");
  }
  return parsed;
}

function parseOpenClawPublishedSmokeArgs(input: string[]): {
  evidenceDir?: string;
  rootDir?: string;
  now?: string;
  registryVersion?: string;
  registryBetaVersion?: string;
  dogfoodReportPath: string;
  toolSmokeReportPath: string;
  configuredToolSmokeReportPath?: string;
  npmInstallDiagnosticReportPath?: string;
  strict: boolean;
} {
  const parsed: {
    evidenceDir?: string;
    rootDir?: string;
    now?: string;
    registryVersion?: string;
    registryBetaVersion?: string;
    dogfoodReportPath?: string;
    toolSmokeReportPath?: string;
    configuredToolSmokeReportPath?: string;
    npmInstallDiagnosticReportPath?: string;
    strict: boolean;
  } = { strict: false };
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      parsed.evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--root") {
      parsed.rootDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--now") {
      parsed.now = requireOptionValue(input[++index], arg);
    } else if (arg === "--registry-version") {
      parsed.registryVersion = requireOptionValue(input[++index], arg);
    } else if (arg === "--registry-beta-version") {
      parsed.registryBetaVersion = requireOptionValue(input[++index], arg);
    } else if (arg === "--dogfood-report") {
      parsed.dogfoodReportPath = requireOptionValue(input[++index], arg);
    } else if (arg === "--tool-smoke-report") {
      parsed.toolSmokeReportPath = requireOptionValue(input[++index], arg);
    } else if (arg === "--configured-tool-smoke-report") {
      parsed.configuredToolSmokeReportPath = requireOptionValue(input[++index], arg);
    } else if (arg === "--npm-install-diagnostic-report") {
      parsed.npmInstallDiagnosticReportPath = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      parsed.strict = true;
    } else {
      throw new Error(`Unknown openclaw published-smoke option: ${arg}`);
    }
  }
  if (!parsed.dogfoodReportPath) throw new Error("openclaw published-smoke requires --dogfood-report");
  if (!parsed.toolSmokeReportPath) throw new Error("openclaw published-smoke requires --tool-smoke-report");
  return {
    evidenceDir: parsed.evidenceDir,
    rootDir: parsed.rootDir,
    now: parsed.now,
    registryVersion: parsed.registryVersion,
    registryBetaVersion: parsed.registryBetaVersion,
    dogfoodReportPath: parsed.dogfoodReportPath,
    toolSmokeReportPath: parsed.toolSmokeReportPath,
    configuredToolSmokeReportPath: parsed.configuredToolSmokeReportPath,
    npmInstallDiagnosticReportPath: parsed.npmInstallDiagnosticReportPath,
    strict: parsed.strict
  };
}

function parseOpenClawLiveControlSmokeArgs(input: string[]): {
  openclawBin?: string;
  dev?: boolean;
  profile?: string;
  gatewayUrl?: string;
  token?: string;
  sessionKey?: string;
  threadId: string;
  message?: string;
  evidenceDir: string;
  gatewayTimeoutMs?: number;
  strict?: boolean;
} {
  const parsed: Partial<ReturnType<typeof parseOpenClawLiveControlSmokeArgs>> = {};
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
    } else if (arg === "--thread-id") {
      parsed.threadId = requireOptionValue(input[++index], arg);
    } else if (arg === "--message") {
      parsed.message = requireOptionValue(input[++index], arg);
    } else if (arg === "--evidence-dir") {
      parsed.evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      parsed.strict = true;
    } else {
      throw new Error(`Unknown openclaw live-control-smoke option: ${arg}`);
    }
  }
  if (!parsed.evidenceDir) throw new Error("openclaw live-control-smoke requires --evidence-dir");
  if (!parsed.threadId) throw new Error("openclaw live-control-smoke requires --thread-id");
  return parsed as ReturnType<typeof parseOpenClawLiveControlSmokeArgs>;
}

function parseOpenClawPostActionRefreshSmokeArgs(input: string[]): {
  openclawBin?: string;
  dev?: boolean;
  profile?: string;
  gatewayUrl?: string;
  token?: string;
  sessionKey?: string;
  threadId: string;
  query?: string;
  expandProfile?: "metadata" | "brief" | "evidence";
  tokenBudget?: number;
  evidenceDir: string;
  liveProofReportPath: string;
  gatewayTimeoutMs?: number;
  strict?: boolean;
} {
  const parsed: Partial<ReturnType<typeof parseOpenClawPostActionRefreshSmokeArgs>> = {};
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
    } else if (arg === "--thread-id") {
      parsed.threadId = requireOptionValue(input[++index], arg);
    } else if (arg === "--query") {
      parsed.query = requireOptionValue(input[++index], arg);
    } else if (arg === "--expand-profile") {
      const value = requireOptionValue(input[++index], arg);
      if (value !== "metadata" && value !== "brief" && value !== "evidence") throw new Error("--expand-profile must be metadata, brief, or evidence");
      parsed.expandProfile = value;
    } else if (arg === "--token-budget") {
      parsed.tokenBudget = parsePositiveInteger(input[++index], arg, 8000);
    } else if (arg === "--evidence-dir") {
      parsed.evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--live-proof-report") {
      parsed.liveProofReportPath = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      parsed.strict = true;
    } else {
      throw new Error(`Unknown openclaw post-action-refresh-smoke option: ${arg}`);
    }
  }
  if (!parsed.evidenceDir) throw new Error("openclaw post-action-refresh-smoke requires --evidence-dir");
  if (!parsed.threadId) throw new Error("openclaw post-action-refresh-smoke requires --thread-id");
  if (!parsed.liveProofReportPath) throw new Error("openclaw post-action-refresh-smoke requires --live-proof-report");
  return parsed as ReturnType<typeof parseOpenClawPostActionRefreshSmokeArgs>;
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

function parseScorecardSweepArgs(input: string[]): { evidenceDir: string; scorecardDir?: string; claimScope?: ReleaseClaimScope; strict: boolean } {
  let evidenceDir: string | undefined;
  let scorecardDir: string | undefined;
  let claimScope: ReleaseClaimScope | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--scorecard-dir") {
      scorecardDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--claim-scope") {
      claimScope = parseReleaseClaimScope(input, ++index, arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown scorecards sweep option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("scorecards sweep requires --evidence-dir");
  return { evidenceDir, scorecardDir, claimScope, strict };
}

function parseRuntimeSweepSummaryArgs(input: string[]): {
  evidenceDir: string;
  dryRunScenarios: string;
  runtimeScenarios: string;
  scorecardSweep: string;
  publishedSmoke: string;
  runtimeProofDir?: string;
  now?: string;
  strict: boolean;
} {
  let evidenceDir: string | undefined;
  let dryRunScenarios: string | undefined;
  let runtimeScenarios: string | undefined;
  let scorecardSweep: string | undefined;
  let publishedSmoke: string | undefined;
  let runtimeProofDir: string | undefined;
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--dry-run-scenarios") {
      dryRunScenarios = requireOptionValue(input[++index], arg);
    } else if (arg === "--runtime-scenarios") {
      runtimeScenarios = requireOptionValue(input[++index], arg);
    } else if (arg === "--scorecard-sweep") {
      scorecardSweep = requireOptionValue(input[++index], arg);
    } else if (arg === "--published-smoke") {
      publishedSmoke = requireOptionValue(input[++index], arg);
    } else if (arg === "--runtime-proof-dir") {
      runtimeProofDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--now") {
      now = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown runtime sweep-summary option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("runtime sweep-summary requires --evidence-dir");
  if (!dryRunScenarios) throw new Error("runtime sweep-summary requires --dry-run-scenarios");
  if (!runtimeScenarios) throw new Error("runtime sweep-summary requires --runtime-scenarios");
  if (!scorecardSweep) throw new Error("runtime sweep-summary requires --scorecard-sweep");
  if (!publishedSmoke) throw new Error("runtime sweep-summary requires --published-smoke");
  return { evidenceDir, dryRunScenarios, runtimeScenarios, scorecardSweep, publishedSmoke, runtimeProofDir, now, strict };
}

function parsePositiveInteger(value: string | undefined, name: string, max?: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || (max !== undefined && parsed > max)) {
    throw new Error(max === undefined ? `${name} requires a positive integer` : `${name} requires an integer between 1 and ${max}`);
  }
  return parsed;
}

function parseReleasePreflightArgs(input: string[]): { evidenceDir?: string; approvedLiveControlEvidence?: string; claimScope?: ReleaseClaimScope; runtimeProofDir?: string; strict: boolean } {
  let evidenceDir: string | undefined;
  let approvedLiveControlEvidence: string | undefined;
  let claimScope: ReleaseClaimScope | undefined;
  let runtimeProofDir: string | undefined;
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
    if (arg === "--runtime-proof-dir") {
      runtimeProofDir = input[++index];
      if (!runtimeProofDir) throw new Error("--runtime-proof-dir requires a path");
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    throw new Error(`Unknown release preflight option: ${arg}`);
  }
  return { evidenceDir, approvedLiveControlEvidence, claimScope, runtimeProofDir, strict };
}

function parseReleaseBundleArgs(input: string[]): { evidenceDir: string; approvedLiveControlEvidence?: string; claimScope?: ReleaseClaimScope; runtimeProofDir?: string; strict: boolean } {
  const parsed = parseReleasePreflightArgs(input);
  if (!parsed.evidenceDir) throw new Error("release bundle requires --evidence-dir");
  return { evidenceDir: parsed.evidenceDir, approvedLiveControlEvidence: parsed.approvedLiveControlEvidence, claimScope: parsed.claimScope, runtimeProofDir: parsed.runtimeProofDir, strict: parsed.strict };
}

function parseReleaseStatusArgs(input: string[]): {
  evidenceDir: string;
  candidateSha?: string;
  approvedLiveControlEvidence?: string;
  claimScope?: ReleaseClaimScope;
  runtimeProofDir?: string;
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
  let runtimeProofDir: string | undefined;
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
    if (arg === "--runtime-proof-dir") {
      runtimeProofDir = readReleaseStatusPath(input, ++index, "--runtime-proof-dir");
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
    runtimeProofDir,
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

function parseReleaseFinalizationStatusArgs(input: string[]): {
  evidenceDir: string;
  candidateSha: string;
  packageName?: string;
  packageVersion?: string;
  expectedDistTag?: string;
  expectedGithubPrerelease?: boolean;
  npmPublishEvidence?: string;
  gitTagEvidence?: string;
  githubReleaseEvidence?: string;
  now?: string;
  strict: boolean;
} {
  let evidenceDir: string | undefined;
  let candidateSha: string | undefined;
  let packageName: string | undefined;
  let packageVersion: string | undefined;
  let expectedDistTag: string | undefined;
  let expectedGithubPrerelease: boolean | undefined;
  let npmPublishEvidence: string | undefined;
  let gitTagEvidence: string | undefined;
  let githubReleaseEvidence: string | undefined;
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
    if (arg === "--package-name") {
      packageName = readReleaseStatusValue(input, ++index, "--package-name");
      continue;
    }
    if (arg === "--package-version") {
      packageVersion = readReleaseStatusValue(input, ++index, "--package-version");
      continue;
    }
    if (arg === "--expected-dist-tag") {
      expectedDistTag = readReleaseStatusValue(input, ++index, "--expected-dist-tag");
      continue;
    }
    if (arg === "--expected-github-prerelease") {
      expectedGithubPrerelease = parseBooleanFlagValue(readReleaseStatusValue(input, ++index, "--expected-github-prerelease"), "--expected-github-prerelease");
      continue;
    }
    if (arg === "--npm-publish-evidence") {
      npmPublishEvidence = readReleaseStatusPath(input, ++index, "--npm-publish-evidence");
      continue;
    }
    if (arg === "--git-tag-evidence") {
      gitTagEvidence = readReleaseStatusPath(input, ++index, "--git-tag-evidence");
      continue;
    }
    if (arg === "--github-release-evidence") {
      githubReleaseEvidence = readReleaseStatusPath(input, ++index, "--github-release-evidence");
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
    throw new Error(`Unknown release finalization-status option: ${arg}`);
  }
  if (!evidenceDir) throw new Error("release finalization-status requires --evidence-dir");
  if (!candidateSha) throw new Error("release finalization-status requires --candidate-sha");
  return {
    evidenceDir,
    candidateSha,
    packageName,
    packageVersion,
    expectedDistTag,
    expectedGithubPrerelease,
    npmPublishEvidence,
    gitTagEvidence,
    githubReleaseEvidence,
    now,
    strict
  };
}

function parseGeneralReleaseReadinessArgs(input: string[]): {
  evidenceDir: string;
  freshNpmEvidence?: string;
  agentDogfoodEvidence?: string;
  now?: string;
  strict: boolean;
} {
  let evidenceDir: string | undefined;
  let freshNpmEvidence: string | undefined;
  let agentDogfoodEvidence: string | undefined;
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = readReleaseStatusPath(input, ++index, "--evidence-dir");
      continue;
    }
    if (arg === "--fresh-npm-evidence") {
      freshNpmEvidence = readReleaseStatusPath(input, ++index, "--fresh-npm-evidence");
      continue;
    }
    if (arg === "--agent-dogfood-evidence") {
      agentDogfoodEvidence = readReleaseStatusPath(input, ++index, "--agent-dogfood-evidence");
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
    throw new Error(`Unknown release general-readiness option: ${arg}`);
  }
  if (!evidenceDir) throw new Error("release general-readiness requires --evidence-dir");
  return { evidenceDir, freshNpmEvidence, agentDogfoodEvidence, now, strict };
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

function parseBooleanFlagValue(value: string, flag: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flag} requires true or false`);
}

function parseReleaseDemoStatusArgs(input: string[]): { evidenceDir: string; approvedLiveControlEvidence?: string; claimScope?: ReleaseClaimScope; runtimeProofDir?: string; minSessions?: number; strict: boolean } {
  let evidenceDir: string | undefined;
  let approvedLiveControlEvidence: string | undefined;
  let claimScope: ReleaseClaimScope | undefined;
  let runtimeProofDir: string | undefined;
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
    if (arg === "--runtime-proof-dir") {
      runtimeProofDir = readReleaseStatusPath(input, ++index, "--runtime-proof-dir");
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
  return { evidenceDir, approvedLiveControlEvidence, claimScope, runtimeProofDir, minSessions, strict };
}

function parseReleaseClaimScope(input: string[], index: number, flag: string): ReleaseClaimScope {
  return normalizeReleaseClaimScope(readReleaseStatusValue(input, index, flag));
}
