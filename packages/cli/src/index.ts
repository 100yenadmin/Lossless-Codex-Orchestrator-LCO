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
  captureCloseoutHookPacket,
  captureCompactionMarkerHookPacket,
  captureThreadTitleFinalizerHookPacket,
  configuredLcmPeerDbPaths,
  createCloseoutEnvelopeReport,
  createDatabase,
  createIndexedSessionSanitizerRepairPlan,
  createIndexedSessionSanitizerReport,
  defaultCodexRoots,
  defaultDatabasePath,
  describeRecallRef,
  describeSession,
  evaluateRetrievalBaselineScenarios,
  evaluateRetrievalScenarios,
  expandQuery,
  expandRecallRef,
  getCodexThreadMap,
  getCodexSessionManagementMap,
  grepRecall,
  indexCodexSessions,
  probeCodexSqliteStores,
  probeLcmPeerDbs,
  runStatePrepHook,
  searchSessions,
  type CloseoutHookCaptureInput,
  type CompactionMarkerHookInput,
  type RecallProfileName,
  type RetrievalBaselineFloors,
  type StatePrepHookInput,
  type ThreadTitleFinalizerInput
} from "../../core/src/index.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createReleaseBundle } from "./release-bundle.js";
import { createReleaseDemoStatus } from "./release-demo-status.js";
import { createReleaseFinalizationStatus } from "./release-finalization-status.js";
import { createReleaseGaSmokeReport } from "./release-ga-smoke.js";
import { runReleasePreflight } from "./release-preflight.js";
import { createReleaseStatus } from "./release-status.js";
import { createGeneralReleaseReadiness } from "./general-release-readiness.js";
import { runOpenClawDogfood } from "./openclaw-dogfood.js";
import { DEFAULT_REQUIRED_TOOL_CALLS, FULL_GATEWAY_SMOKE_TOOL_CALLS, runOpenClawToolSmoke } from "./openclaw-tool-smoke.js";
import { createPublishedPackageSmokeReport } from "./published-package-smoke.js";
import { createCliMcpProductSmokeReport, MAX_CLI_MCP_PRODUCT_SMOKE_TIMEOUT_MS } from "./cli-mcp-product-smoke.js";
import { createQaLabRunReport, type QaLabRunArtifact, type QaLabRunSuite } from "./qa-lab-run.js";
import { createQaLabToolCoverageReport, type QaLabCoveragePolicy } from "./qa-lab-tool-coverage.js";
import { createQaLabLiveControlMatrixReport } from "./qa-lab-live-control-matrix.js";
import { createQaLabDesktopContractReport } from "./qa-lab-desktop-contract.js";
import { createQaLabPrivacyScanReport } from "./qa-lab-privacy-scan.js";
import {
  createQaLabAdversarialReviewReport,
  createQaLabJudgeReviewReport,
  DEFAULT_QA_LAB_ADVERSARIAL_LENSES,
  type QaLabAdversarialLens,
  type QaLabRubricVersion
} from "./qa-lab-review.js";
import { createQaLabWorkflowReport, type QaLabWorkflowMode, type QaLabWorkflowSurface } from "./qa-lab-workflow.js";
import { runOpenClawGatewayLiveControlSmoke, type OpenClawGatewayLiveControlAction } from "./openclaw-live-control-smoke.js";
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
  if (command === "hook" && args[0] === "closeout-capture") {
    if (hasHelpFlag(args.slice(1))) {
      printHookCloseoutCaptureHelp();
      return;
    }
    const parsed = parseHookCaptureArgs(args.slice(1));
    const db = createDatabase();
    try {
      const report = captureCloseoutHookPacket(db, parsed.payload);
      writeHookEvidence(parsed.evidencePath, report);
      console.log(JSON.stringify(report, null, 2));
      if (parsed.strict && report.blockers.length > 0) process.exitCode = 1;
    } finally {
      db.close();
    }
    return;
  }
  if (command === "hook" && args[0] === "state-prep") {
    if (hasHelpFlag(args.slice(1))) {
      printHookStatePrepHelp();
      return;
    }
    const parsed = parseHookStatePrepArgs(args.slice(1));
    const db = createDatabase();
    try {
      const report = runStatePrepHook(db, parsed.payload);
      writeHookEvidence(parsed.evidencePath, report);
      console.log(JSON.stringify(report, null, 2));
      if (parsed.strict && report.blockers.length > 0) process.exitCode = 1;
    } finally {
      db.close();
    }
    return;
  }
  if (command === "hook" && args[0] === "compaction-capture") {
    if (hasHelpFlag(args.slice(1))) {
      printHookCompactionCaptureHelp();
      return;
    }
    const parsed = parseHookCompactionCaptureArgs(args.slice(1));
    const db = createDatabase();
    try {
      const report = captureCompactionMarkerHookPacket(db, parsed.payload);
      writeHookEvidence(parsed.evidencePath, report);
      console.log(JSON.stringify(report, null, 2));
      if (parsed.strict && report.blockers.length > 0) process.exitCode = 1;
    } finally {
      db.close();
    }
    return;
  }
  if (command === "hook" && args[0] === "thread-title-finalize") {
    if (hasHelpFlag(args.slice(1))) {
      printHookThreadTitleFinalizeHelp();
      return;
    }
    const parsed = parseHookThreadTitleFinalizeArgs(args.slice(1));
    const db = createDatabase();
    try {
      const report = captureThreadTitleFinalizerHookPacket(db, parsed.payload);
      writeHookEvidence(parsed.evidencePath, report);
      console.log(JSON.stringify(report, null, 2));
      if (parsed.strict && report.blockers.length > 0) process.exitCode = 1;
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
    if (parsed.gatewayReadyStrict && !report.publishedSmokeReady) process.exitCode = 1;
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
    if (parsed.strict && (!report.summaryReady || report.claimBoundary.supportedClaimScope === "none")) process.exitCode = 1;
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
      const report = parsed.floorFile
        ? evaluateRetrievalBaselineScenarios(db, {
          scenarios: payload.scenarios,
          floors: readRetrievalFloorFile(parsed.floorFile)
        })
        : evaluateRetrievalScenarios(db, { scenarios: payload.scenarios });
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
  if (command === "release" && args[0] === "ga-smoke") {
    if (hasHelpFlag(args.slice(1))) {
      printReleaseGaSmokeHelp();
      return;
    }
    const parsed = parseReleaseGaSmokeArgs(args.slice(1));
    const report = createReleaseGaSmokeReport(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.gaSmokeReady) process.exitCode = 1;
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
  if (command === "qa-lab" && args[0] === "tool-coverage") {
    if (hasHelpFlag(args.slice(1))) {
      printQaLabToolCoverageHelp();
      return;
    }
    const parsed = parseQaLabToolCoverageArgs(args.slice(1));
    const report = createQaLabToolCoverageReport(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.qaLabToolCoverageReady) process.exitCode = 1;
    return;
  }
  if (command === "qa-lab" && args[0] === "desktop-contract") {
    if (hasHelpFlag(args.slice(1))) {
      printQaLabDesktopContractHelp();
      return;
    }
    const parsed = parseQaLabDesktopContractArgs(args.slice(1));
    const report = createQaLabDesktopContractReport(parsed);
    mkdirSync(parsed.evidenceDir, { recursive: true });
    writeFileSync(join(parsed.evidenceDir, "desktop-contract.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.desktopContractReady) process.exitCode = 1;
    return;
  }
  if (command === "qa-lab" && args[0] === "privacy-scan") {
    if (hasHelpFlag(args.slice(1))) {
      printQaLabPrivacyScanHelp();
      return;
    }
    const parsed = parseQaLabPrivacyScanArgs(args.slice(1));
    const report = createQaLabPrivacyScanReport(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.ok) process.exitCode = 1;
    return;
  }
  if (command === "qa-lab" && args[0] === "run") {
    if (hasHelpFlag(args.slice(1))) {
      printQaLabRunHelp();
      return;
    }
    const parsed = parseQaLabRunArgs(args.slice(1));
    const report = createQaLabRunReport(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.qaLabReady) process.exitCode = 1;
    return;
  }
  if (command === "qa-lab" && args[0] === "live-control-matrix") {
    if (hasHelpFlag(args.slice(1))) {
      printQaLabLiveControlMatrixHelp();
      return;
    }
    const parsed = parseQaLabLiveControlMatrixArgs(args.slice(1));
    const report = createQaLabLiveControlMatrixReport(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.liveControlMatrixReady) process.exitCode = 1;
    return;
  }
  if (command === "qa-lab" && args[0] === "cli-mcp-smoke") {
    if (hasHelpFlag(args.slice(1))) {
      printQaLabCliMcpSmokeHelp();
      return;
    }
    const parsed = parseQaLabCliMcpSmokeArgs(args.slice(1));
    const report = await createCliMcpProductSmokeReport(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.ok) process.exitCode = 1;
    return;
  }
  if (command === "qa-lab" && args[0] === "judge") {
    if (hasHelpFlag(args.slice(1))) {
      printQaLabJudgeHelp();
      return;
    }
    const parsed = parseQaLabJudgeArgs(args.slice(1));
    const report = createQaLabJudgeReviewReport(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.gaReady) process.exitCode = 1;
    return;
  }
  if (command === "qa-lab" && args[0] === "adversarial-review") {
    if (hasHelpFlag(args.slice(1))) {
      printQaLabAdversarialReviewHelp();
      return;
    }
    const parsed = parseQaLabAdversarialReviewArgs(args.slice(1));
    const report = createQaLabAdversarialReviewReport(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.ok) process.exitCode = 1;
    return;
  }
  if (command === "qa-lab" && args[0] === "workflow") {
    if (hasHelpFlag(args.slice(1))) {
      printQaLabWorkflowHelp();
      return;
    }
    const parsed = parseQaLabWorkflowArgs(args.slice(1));
    const report = createQaLabWorkflowReport(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.workflowRunReady) process.exitCode = 1;
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
    "  loo hook closeout-capture --payload-file path|--payload-json json [--evidence-path path] [--strict]",
    "  loo hook state-prep [--thread-id id] [--target-ref ref] [--limit n] [--payload-file path|--payload-json json] [--evidence-path path] [--strict]",
    "  loo hook compaction-capture --mode marker --lifecycle pre_compact|post_compact [--payload-file path|--payload-json json] [--thread-id id] [--target-ref ref] [--summary text] [--evidence-path path] [--strict]",
    "  loo hook thread-title-finalize [--payload-stdin|--payload-file path|--payload-json json] [--thread-id id] [--target-ref ref] [--evidence-path path] [--strict]",
    "  loo sanitize sessions [--thread-id id] [--limit n] [--evidence-dir path] [--strict]",
    "  loo serve",
    "  loo audit-path",
    "  loo codex live-control-smoke --evidence-dir path [--thread-id id] [--message text] [--cwd path] [--timeout-ms ms] [--audit-path path] [--codex-bin path] [--app-server-args \"app-server --stdio\"]",
    "  loo openclaw dogfood [--dev] [--profile name] [--install-source path] [--link] [--force-install] [--evidence-path path] [--strict]",
    "  loo openclaw tool-smoke [--openclaw-bin path] [--dev] [--profile name] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--query text] [--thread-id id] [--expand-profile metadata|brief|evidence] [--token-budget n] [--coverage default|full] [--required-tool name] [--evidence-path path] [--strict]",
    "  loo openclaw published-smoke --evidence-dir path --dogfood-report path --tool-smoke-report path [--configured-tool-smoke-report path] [--npm-install-diagnostic-report path] [--registry-version version] [--registry-beta-version version] [--root path] [--now iso] [--strict]",
    "  loo openclaw live-control-smoke --evidence-dir path --thread-id id --action send|resume|steer|interrupt [--expected-turn-id id] [--openclaw-bin path] [--dev] [--profile name] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--message text] [--strict]",
    "  loo openclaw post-action-refresh-smoke --evidence-dir path --thread-id id --live-proof-report path [--openclaw-bin path] [--dev] [--profile name] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--query text] [--expand-profile metadata|brief|evidence] [--token-budget n] [--strict]",
    "  loo scorecards sweep --evidence-dir path [--scorecard-dir path] [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--runtime-proof-dir path] [--package-version version] [--candidate-sha sha] [--strict]",
    "  loo runtime sweep-summary --evidence-dir path --dry-run-scenarios path --runtime-scenarios path --scorecard-sweep path --published-smoke path [--runtime-proof-dir path] [--now iso] [--strict]",
    "  loo ui local-mac-search --evidence-dir path [--sample] [--strict]",
    "  loo eval retrieval --scenario-file path [--floor-file path] [--evidence-path path] [--strict]",
    "  loo eval scenarios --evidence-dir path [--scenario-dir path] [--runtime-proof-dir path] [--package-version version] [--candidate-sha sha] [--strict]",
    "  loo runtime issue-packet --evidence-dir path --failure-report path [--parent-issue #n] [--operating-loop #n] [--milestone name] [--now iso] [--strict]",
    "  loo release preflight [--evidence-dir path] [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--approved-live-control-evidence path] [--runtime-proof-dir path] [--strict]",
    "  loo release bundle --evidence-dir path [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--approved-live-control-evidence path] [--runtime-proof-dir path] [--strict]",
    "  loo release status --evidence-dir path --candidate-sha sha [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--approved-live-control-evidence path] [--runtime-proof-dir path] [--npm-publish-approval-evidence path] [--github-release-approval-evidence path] [--github-ci-evidence path] [--codeql-evidence path] [--desktop-gui-required --desktop-gui-approval-evidence path] [--now iso] [--strict]",
    "  loo release finalization-status --evidence-dir path --candidate-sha sha --npm-publish-evidence path --git-tag-evidence path --github-release-evidence path [--package-name name] [--package-version version] [--expected-dist-tag beta|next|latest] [--expected-github-prerelease true|false] [--now iso] [--strict]",
    "  loo release general-readiness --evidence-dir path [--fresh-npm-evidence path] [--agent-dogfood-evidence path] [--now iso] [--strict]",
    "  loo release ga-smoke --evidence-dir path --package-version version --candidate-sha sha [--release-status path] [--release-finalization-status path] [--published-smoke path] [--dogfood-report path] [--tool-smoke-report path] [--scenario-sweep path] [--scorecard-sweep path] [--release-preflight path] [--release-bundle path] [--privacy-scan path] [--qa-lab-run path] [--tool-coverage path] [--live-control-matrix path] [--judge-review path] [--adversarial-review path] [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--allow-setup-required] [--now iso] [--strict]",
    "  loo release demo-status --evidence-dir path [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--approved-live-control-evidence path] [--runtime-proof-dir path] [--min-sessions n] [--strict]",
    "  loo qa-lab cli-mcp-smoke --evidence-dir path --package-version version [--candidate-sha sha] [--cli-bin path] [--mcp-bin path] [--required-tool name] [--tool-call name] [--timeout-ms ms] [--now iso] [--strict]",
    "  loo qa-lab run --suite ga --artifact published|candidate --evidence-dir path --package-version version --candidate-sha sha [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--tool-coverage path] [--workflow-run path] [--cli-mcp-smoke path] [--desktop-contract path] [--live-control-matrix path] [--scenario-sweep path] [--scorecard-sweep path] [--privacy-scan path] [--now iso] [--strict]",
    "  loo qa-lab tool-coverage --evidence-dir path [--tool-smoke-report path] [--dogfood-report path] [--published-smoke path] [--manifest path] [--package-version version] [--candidate-sha sha] [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--coverage-policy full|facade] [--now iso] [--strict]",
    "  loo qa-lab desktop-contract --evidence-dir path --readiness-report path [--action-bound-scratch-proof path] [--package-version version] [--candidate-sha sha] [--now iso] [--strict]",
    "  loo qa-lab privacy-scan --evidence-dir path --package-version version --candidate-sha sha [--scan-dir path] [--now iso] [--strict]",
    "  loo qa-lab live-control-matrix --evidence-dir path [--package-version version] [--candidate-sha sha] [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--sacrificial-thread-id id ...] [--send-report path] [--resume-report path] [--steer-report path] [--interrupt-report path] [--now iso] [--strict]",
    "  loo qa-lab judge --run path --rubric-version real-product-v1 --evidence-dir path [--now iso] [--strict]",
    "  loo qa-lab adversarial-review --run path --lenses safety,retrieval,packaging,claims,agent-usability --evidence-dir path [--now iso] [--strict]",
    "  loo qa-lab workflow --scenario-id id --surface openclaw-gateway --mode dry-run --evidence-dir path [--package-version version] [--candidate-sha sha] [--openclaw-bin path] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--now iso] [--strict]"
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
    "  loo openclaw tool-smoke [--openclaw-bin path] [--dev] [--profile name] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--query text] [--thread-id id] [--expand-profile metadata|brief|evidence] [--token-budget n] [--coverage default|full] [--desktop-fallback-coherence fixture|omit] [--required-tool name] [--evidence-path path] [--strict]",
    "",
    "Runs a public-safe OpenClaw gateway smoke for selected loo_* tools.",
    "",
    "Default tools:",
    `  ${DEFAULT_REQUIRED_TOOL_CALLS.join(", ")}`,
    "",
    "Options:",
    "  --coverage default|full",
    "                          Use the default facade/workflow smoke set or the full declared-tool disposition matrix.",
    "                          Full coverage cannot combine with --required-tool and needs an explicit or discovered thread target for thread-bound tools.",
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
    "  loo scorecards sweep --evidence-dir path [--scorecard-dir path] [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--runtime-proof-dir path] [--package-version version] [--candidate-sha sha] [--strict]",
    "",
    "Writes a public-safe scorecard sweep packet for the beta acceptance scorecards.",
    "",
    "Required:",
    "  --evidence-dir is required and must not be the same directory as --scorecard-dir.",
    "  --claim-scope follows the release gate scope; reduced-scope beta sweeps do not require working-app runtime proof scorecards.",
    "  --runtime-proof-dir is required for an all-green codex-working-app-proof sweep and points at v1.1 public-safe runtime marker JSON files.",
    "",
    "Strict mode:",
    "  --strict exits non-zero when scorecards are missing, invalid, example-not-run, failed, runtime proof is missing, or when raw evidence artifacts are present.",
    "  Common blockers include scorecard_not_run:<name>, scorecard_missing:<name>, runtime_proof_missing:<id>:<marker>, and raw_artifact:<reason>:<name>.",
    "",
    "Safety boundary:",
    "  The command does not run live Codex control, does not mutate a desktop GUI, does not publish npm, and does not create a GitHub Release."
  ].join("\n"));
}

function printScenarioSweepHelp(): void {
  console.log([
    "Usage:",
    "  loo eval scenarios --evidence-dir path [--scenario-dir path] [--runtime-proof-dir path] [--scenario-id id ...] [--package-version version] [--candidate-sha sha] [--strict]",
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
    "  --strict exits non-zero when the summary itself cannot be produced safely or no claim scope is supported.",
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

function printHookCloseoutCaptureHelp(): void {
  console.log([
    "Usage:",
    "  loo hook closeout-capture --payload-file path|--payload-json json [--evidence-path path] [--strict]",
    "",
    "Captures a bounded closeout hook payload into LCO-owned derived cache.",
    "",
    "Payload fields:",
    "  thread_id/threadId, turn_id/turnId, event_id/eventId, transcript_path/transcriptPath, last_assistant_message/lastAssistantMessage.",
    "",
    "Safety boundary:",
    "  transcript_path is hashed/redacted and never opened.",
    "  The command writes only hook_capture_packets in the local LCO DB.",
    "  It does not mutate Codex source stores, run live control, mutate a GUI, write external systems, publish npm, or create a GitHub Release."
  ].join("\n"));
}

function printHookStatePrepHelp(): void {
  console.log([
    "Usage:",
    "  loo hook state-prep [--thread-id id] [--target-ref ref] [--limit n] [--payload-file path|--payload-json json] [--evidence-path path] [--strict]",
    "",
    "Writes one state_prep_jobs derived-cache row and emits a bounded packet from existing LCO prepared-state reports.",
    "",
    "Safety boundary:",
    "  Hook payloads are hashed only; prepared state comes from LCO summary leaves/cards/inbox.",
    "  The command does not read raw Codex transcripts, run model compaction, mutate source stores, run live control, mutate a GUI, write external systems, publish npm, or create a GitHub Release."
  ].join("\n"));
}

function printHookCompactionCaptureHelp(): void {
  console.log([
    "Usage:",
    "  loo hook compaction-capture --mode marker --lifecycle pre_compact|post_compact [--payload-file path|--payload-json json] [--thread-id id] [--target-ref ref] [--summary text] [--evidence-path path] [--strict]",
    "",
    "Records PreCompact/PostCompact lifecycle markers as marker-only hook packets.",
    "",
    "Safety boundary:",
    "  Marker notes are bounded/redacted; --summary and summary-shaped payload text are hash-only and never stored.",
    "  Marker mode never claims true compaction-summary capture and ignores summary-shaped payload text except for a local hash.",
    "  True compaction-summary capture requires Codex-native sanitized event support or a separately proven adapter.",
    "  The command writes only LCO-owned derived cache and does not mutate Codex source stores, run live control, mutate a GUI, run model compaction, publish npm, or create a GitHub Release."
  ].join("\n"));
}

function printHookThreadTitleFinalizeHelp(): void {
  console.log([
    "Usage:",
    "  loo hook thread-title-finalize [--payload-stdin|--payload-file path|--payload-json json] [--thread-id id] [--target-ref ref] [--evidence-path path] [--strict]",
    "",
    "Writes a one-shot public-safe Codex thread title alias into LCO-owned derived cache for search/indexing.",
    "",
    "Payload fields:",
    "  thread_id/threadId/session_id/sessionId, turn_id/turnId, event_id/eventId, transcript_path/transcriptPath, cwd, project, repo, current_title/currentTitle, task_summary/taskSummary, user_message/userMessage, last_assistant_message/lastAssistantMessage.",
    "",
    "Safety boundary:",
    "  transcript_path is hashed/redacted and never opened.",
    "  The command preserves the canonical Codex title and writes only hook_capture_packets plus codex_thread_title_aliases in the local LCO DB.",
    "  It does not mutate Codex source stores, run live control, mutate a GUI, write external systems, publish npm, create a GitHub Release, or add an agent-facing naming tool."
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
    "Writes a public-safe general-release readiness packet for the current package version without performing release actions.",
    "",
    "Required evidence:",
    "  --fresh-npm-evidence points to a public-safe `loo openclaw published-smoke` report with clean-profile gateway status ready.",
    "  --agent-dogfood-evidence points to a public-safe `loo openclaw tool-smoke` report with agentReasoning and dry-run evidence.",
    "",
    "Strict mode:",
    "  --strict exits non-zero until docs, skill/playbook, M9 scenarios, fresh npm proof, and agent dogfood proof are complete.",
    "",
    "Safety boundary:",
    "  The command does not publish npm, does not move npm dist-tags, does not create a GitHub Release, does not run live Codex control, and does not perform desktop GUI mutation."
  ].join("\n"));
}

function printReleaseGaSmokeHelp(): void {
  console.log([
    "Usage:",
    "  loo release ga-smoke --evidence-dir path --package-version version --candidate-sha sha [--release-status path] [--release-finalization-status path] [--published-smoke path] [--dogfood-report path] [--tool-smoke-report path] [--scenario-sweep path] [--scorecard-sweep path] [--release-preflight path] [--release-bundle path] [--privacy-scan path] [--qa-lab-run path] [--tool-coverage path] [--live-control-matrix path] [--judge-review path] [--adversarial-review path] [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--allow-setup-required] [--now iso] [--strict]",
    "",
    "Aggregates public-safe release evidence into one GA smoke readiness packet.",
    "",
    "Default evidence names:",
    "  release-status.json, release-finalization-status.json, published-package-smoke.json, openclaw-dogfood.json, openclaw-tool-smoke.json, scenario-sweep.json, scorecard-sweep.json, release-preflight.json, release-bundle.json, privacy-scan.json, qa-lab-run.json, tool-coverage.json, live-control-matrix.json, judge-review.json, and adversarial-review.json.",
    "",
    "Strict mode:",
    "  --strict exits non-zero for P0-P2 package, release, safety, setup, or evidence blockers. P3 warnings remain non-blocking.",
    "  --allow-setup-required permits a classified fresh-profile setup blocker only when package-path, configured-gateway, and finalization proof are clean.",
    "",
    "Safety boundary:",
    "  This command is aggregate-only. It consumes existing sanitized evidence and does not publish npm, create tags, create GitHub Releases, run live Codex control, mutate a GUI, read raw transcripts, or store raw npm/gateway output."
  ].join("\n"));
}

function printQaLabToolCoverageHelp(): void {
  console.log([
    "Usage:",
    "  loo qa-lab tool-coverage --evidence-dir path [--tool-smoke-report path] [--dogfood-report path] [--published-smoke path] [--manifest path] [--package-version version] [--candidate-sha sha] [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--coverage-policy full|facade] [--now iso] [--strict]",
    "",
    "Aggregates public-safe QA Lab tool evidence and writes `tool-coverage.json`.",
    "",
    "Coverage policies:",
    "  full requires tier-appropriate evidence for every declared `loo_*` tool.",
    "  facade requires product evidence for public facade tools and records the rest as non-blocking gaps.",
    "",
    "Strict mode:",
    "  --strict exits non-zero for P0-P2 missing evidence, manifest/runtime mismatch, unsafe evidence, setup blockers, or version/SHA mismatch.",
    "",
    "Safety boundary:",
    "  This command is aggregate-only. It does not invoke tools, authorize gateways, run live Codex control, perform desktop GUI mutation, or read raw transcripts.",
    "  It does not publish npm, create tags, create GitHub Releases, or store raw gateway output."
  ].join("\n"));
}

function printQaLabDesktopContractHelp(): void {
  console.log([
    "Usage:",
    "  loo qa-lab desktop-contract --evidence-dir path --readiness-report path [--action-bound-scratch-proof path] [--package-version version] [--candidate-sha sha] [--now iso] [--strict]",
    "",
    "Aggregates sanitized desktop readiness metadata and writes `desktop-contract.json`.",
    "",
    "Inputs:",
    "  --readiness-report path              Public-safe metadata readiness report for CLI, app-server, visible desktop, fallback backend, and Codex Desktop.",
    "  --action-bound-scratch-proof path    Optional public-safe TextEdit scratch proof; it never proves generic GUI mutation.",
    "",
    "Strict mode:",
    "  --strict exits non-zero when required readiness metadata is missing, unsafe, stale, or overclaims GUI/live behavior.",
    "",
    "Safety boundary:",
    "  This command is metadata-only. It writes public-safe evidence and does not run GUI mutation, Codex GUI mutation, live Codex control, screenshots, video capture, npm publish, or GitHub Release creation."
  ].join("\n"));
}

function printQaLabPrivacyScanHelp(): void {
  console.log([
    "Usage:",
    "  loo qa-lab privacy-scan --evidence-dir path --package-version version --candidate-sha sha [--scan-dir path] [--now iso] [--strict]",
    "",
    "Scans bounded release evidence and writes `privacy-scan.json`.",
    "",
    "Checks:",
    "  raw transcripts, JSONL/SQLite stores, screenshots, videos, raw logs, local paths, cookies, and secret-like values.",
    "",
    "Strict mode:",
    "  --strict exits non-zero for raw artifacts, secret-like findings, malformed candidate SHA, or incomplete bounded scan coverage.",
    "",
    "Safety boundary:",
    "  This command emits opaque evidence refs only. It does not read raw Codex stores by default, echo raw paths or filenames, run live Codex control, mutate a GUI, publish npm, or create a GitHub Release."
  ].join("\n"));
}

function printQaLabLiveControlMatrixHelp(): void {
  console.log([
    "Usage:",
    "  loo qa-lab live-control-matrix --evidence-dir path [--package-version version] [--candidate-sha sha] [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--sacrificial-thread-id id] [--send-report path] [--resume-report path] [--steer-report path] [--interrupt-report path] [--now iso] [--strict]",
    "",
    "Aggregates per-action OpenClaw gateway live-control proof reports into `live-control-matrix.json`.",
    "",
    "Strict mode:",
    "  --strict exits non-zero when a live-control claim lacks ready send, resume, steer, and interrupt rows.",
    "",
    "Safety boundary:",
    "  This command is aggregate-only. It reads sanitized proof reports and does not run live Codex control.",
    "  Required live rows must target explicit --sacrificial-thread-id allowlist entries.",
    "  Full live-control claims require distinct approved sacrificial thread ids for send, resume, steer, and interrupt.",
    "  It does not mutate a desktop GUI, read raw transcripts, capture screenshots, publish npm, or create GitHub Releases."
  ].join("\n"));
}

function printQaLabCliMcpSmokeHelp(): void {
  console.log([
    "Usage:",
    "  loo qa-lab cli-mcp-smoke --evidence-dir path --package-version version [--candidate-sha sha] [--cli-bin path] [--mcp-bin path] [--required-tool name] [--tool-call name] [--timeout-ms ms] [--now iso] [--strict]",
    "",
    "Checks public package-facing CLI and MCP surfaces from a published or fresh-install candidate.",
    "",
    "Options:",
    "  --cli-bin path        CLI binary to probe with --help; defaults to loo.",
    "  --mcp-bin path        MCP server binary to probe with initialize + tools/list; defaults to loo-mcp-server.",
    "  --required-tool name  Require a listed MCP tool; may be repeated.",
    "  --tool-call name      Safe representative MCP tool to call with empty arguments; defaults to loo_doctor.",
    `  --timeout-ms ms       Per-probe timeout; max ${MAX_CLI_MCP_PRODUCT_SMOKE_TIMEOUT_MS}ms. CLI and MCP probes run sequentially.`,
    "  --strict              Exit non-zero unless CLI and MCP readiness are both proved.",
    "",
    "Safety boundary:",
    "  This command writes public-safe evidence only.",
    "  It does not run live Codex control, mutate a desktop GUI, capture screenshots, publish npm, or create a GitHub Release."
  ].join("\n"));
}

function printQaLabRunHelp(): void {
  console.log([
    "Usage:",
    "  loo qa-lab run --suite ga --artifact published|candidate --evidence-dir path --package-version version --candidate-sha sha [--claim-scope codex-live-control|codex-read-search-expand-dry-run|codex-working-app-proof] [--tool-coverage path] [--workflow-run path] [--cli-mcp-smoke path] [--desktop-contract path] [--live-control-matrix path] [--scenario-sweep path] [--scorecard-sweep path] [--privacy-scan path] [--now iso] [--strict]",
    "",
    "Aggregates existing QA Lab evidence into `qa-lab-run.json` for release ga-smoke.",
    "",
    "Strict mode:",
    "  --strict exits non-zero when any P0-P2 QA Lab blocker remains.",
    "",
    "Safety boundary:",
    "  This command is aggregate-only. It consumes sanitized evidence reports and writes a public-safe QA Lab run packet.",
    "  It does not run live Codex control, mutate a desktop GUI, read raw transcripts or raw prompts, approve gateway scopes, publish npm, create tags, or create a GitHub Release."
  ].join("\n"));
}

function printQaLabJudgeHelp(): void {
  console.log([
    "Usage:",
    "  loo qa-lab judge --run path --rubric-version real-product-v1 --evidence-dir path [--now iso] [--strict]",
    "",
    "Emits a deterministic `lco.qaLab.judgeReview.v1` report from a sanitized QA Lab run.",
    "",
    "Strict mode:",
    "  --strict exits non-zero unless privacy and safety are 5/5, every other dimension is at least 4/5, and the average score is at least 4.5.",
    "",
    "Safety boundary:",
    "  This command is rule-based and does not call a model, read raw transcripts, echo raw prompts, inspect SQLite/JSONL, capture screenshots, run live control, mutate GUI state, publish npm, or create GitHub Releases."
  ].join("\n"));
}

function printQaLabAdversarialReviewHelp(): void {
  console.log([
    "Usage:",
    "  loo qa-lab adversarial-review --run path --lenses safety,retrieval,packaging,claims,agent-usability --evidence-dir path [--now iso] [--strict]",
    "",
    "Emits a deterministic `lco.qaLab.adversarialReview.v1` report for selected adversarial lenses.",
    "",
    "Strict mode:",
    "  --strict exits non-zero when any selected lens fails or any P0-P2 finding is present.",
    "",
    "Safety boundary:",
    "  Findings are normalized from sanitized QA Lab report fields only. Raw evidence fields, local paths, prompts, logs, screenshots, SQLite/JSONL, tokens, cookies, and customer data are not echoed."
  ].join("\n"));
}

function printQaLabWorkflowHelp(): void {
  console.log([
    "Usage:",
    "  loo qa-lab workflow --scenario-id id --surface cli|mcp|openclaw-gateway|desktop-contract --mode dry-run|live-approved --evidence-dir path [--package-version version] [--candidate-sha sha] [--openclaw-bin path] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--now iso] [--strict]",
    "",
    "Runs the public-safe QA Lab agent workflow and writes `workflow-run.json`.",
    "--gateway-timeout-ms defaults to 60000 ms and is capped at 600000 ms across the whole workflow.",
    "",
    "Supported in this release:",
    "  --surface openclaw-gateway",
    "  --mode dry-run",
    "",
    "Unsupported surfaces and live-approved mode fail closed with blockers.",
    "",
    "--gateway-timeout-ms defaults to 60000 ms and is capped at 600000 ms across the whole workflow.",
    "",
    "Safety boundary:",
    "  This command uses public-safe gateway tool summaries only. It does not read raw transcripts, raw prompts, SQLite/JSONL stores, screenshots, raw gateway logs, tokens, cookies, customer data, run live Codex control, mutate a GUI, approve gateway scope, publish npm, or create GitHub Releases."
  ].join("\n"));
}

function printOpenClawPublishedSmokeHelp(): void {
  console.log([
    "Usage:",
    "  loo openclaw published-smoke --evidence-dir path --dogfood-report path --tool-smoke-report path [--configured-tool-smoke-report path] [--npm-install-diagnostic-report path] [--registry-version version] [--registry-beta-version version] [--root path] [--now iso] [--strict] [--gateway-ready-strict]",
    "",
    "Writes a public-safe summary of the published npm package path for the expected dist-tag and gateway setup state.",
    "",
    "This command consumes sanitized reports from `loo openclaw dogfood` and `loo openclaw tool-smoke`.",
    "Optional `--configured-tool-smoke-report` records a separately named configured-profile gateway proof without marking the fresh published profile ready.",
    "Optional `--npm-install-diagnostic-report` records public-safe npm selector drift and tarball fallback proof without storing raw npm output.",
    "",
    "Strict mode:",
    "  --strict exits non-zero only when ok/packagePathOk is false; it is package-path strict.",
    "  --gateway-ready-strict exits non-zero unless publishedSmokeReady is true for the clean published profile.",
    "  With both flags, any failed package-path or clean-profile gateway-ready condition exits non-zero.",
    "  A configured gateway proof is recorded separately and never substitutes for fresh-profile gateway readiness.",
    "",
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
    "  loo openclaw live-control-smoke --evidence-dir path --thread-id id --action send|resume|steer|interrupt [--expected-turn-id id] [--openclaw-bin path] [--dev] [--profile name] [--gateway-url ws://127.0.0.1:port] [--token token] [--gateway-timeout-ms ms] [--session-key key] [--message text] [--strict]",
    "",
    "Runs one approval-gated live Codex send, resume, steer, or interrupt through the installed OpenClaw gateway tools.invoke path.",
    "",
    "Outputs:",
    "  openclaw-gateway-live-codex-v1-1.runtime-proof.json",
    "  openclaw-gateway-live-control-smoke-report.json",
    "",
    "Safety boundary:",
    "  The command requires an explicit --thread-id target.",
    "  The command requires an explicit --action so no live action is selected by default.",
    "  Steer and interrupt require --expected-turn-id so the live action is bound to one known sacrificial turn.",
    "  It invokes loo_codex_control_dry_run first, then uses the matching approval_audit_id for the selected live tool with dry_run:false.",
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

function parseHookCaptureArgs(input: string[]): { payload: CloseoutHookCaptureInput; evidencePath?: string; strict: boolean } {
  let payload: CloseoutHookCaptureInput = {};
  let evidencePath: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--payload-file") {
      payload = { ...payload, ...readHookPayloadFile(requireOptionValue(input[++index], arg)) };
    } else if (arg === "--payload-json") {
      payload = { ...payload, ...parseHookPayloadJson(requireOptionValue(input[++index], arg)) };
    } else if (arg === "--thread-id") {
      payload.threadId = requireOptionValue(input[++index], arg);
    } else if (arg === "--target-ref") {
      payload.targetRef = requireOptionValue(input[++index], arg);
    } else if (arg === "--turn-id") {
      payload.turnId = requireOptionValue(input[++index], arg);
    } else if (arg === "--event-id") {
      payload.eventId = requireOptionValue(input[++index], arg);
    } else if (arg === "--transcript-path") {
      payload.transcriptPath = requireOptionValue(input[++index], arg);
    } else if (arg === "--last-assistant-message") {
      payload.lastAssistantMessage = requireOptionValue(input[++index], arg);
    } else if (arg === "--evidence-path") {
      evidencePath = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown hook closeout-capture option: ${arg}`);
    }
  }
  if (!payload.lastAssistantMessage && !payload.last_assistant_message) throw new Error("hook closeout-capture requires last_assistant_message in --payload-file/--payload-json or --last-assistant-message");
  return { payload, evidencePath, strict };
}

function parseHookStatePrepArgs(input: string[]): { payload: StatePrepHookInput; evidencePath?: string; strict: boolean } {
  let rawPayload: Record<string, unknown> | undefined;
  const payload: StatePrepHookInput = {};
  let evidencePath: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--payload-file") {
      rawPayload = { ...(rawPayload ?? {}), ...readHookPayloadFile(requireOptionValue(input[++index], arg)) };
    } else if (arg === "--payload-json") {
      rawPayload = { ...(rawPayload ?? {}), ...parseHookPayloadJson(requireOptionValue(input[++index], arg)) };
    } else if (arg === "--thread-id") {
      payload.threadId = requireOptionValue(input[++index], arg);
    } else if (arg === "--target-ref") {
      payload.targetRef = requireOptionValue(input[++index], arg);
    } else if (arg === "--limit") {
      payload.limit = parsePositiveInteger(input[++index], "--limit", 25);
    } else if (arg === "--evidence-path") {
      evidencePath = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown hook state-prep option: ${arg}`);
    }
  }
  if (rawPayload) {
    const remainingPayload = applyStatePrepHookPayload(rawPayload, payload);
    if (Object.keys(remainingPayload).length > 0) payload.payload = remainingPayload;
  }
  return { payload, evidencePath, strict };
}

function applyStatePrepHookPayload(rawPayload: Record<string, unknown>, payload: StatePrepHookInput): Record<string, unknown> {
  const remainingPayload = { ...rawPayload };
  const threadId = hookPayloadString(rawPayload.threadId ?? rawPayload.thread_id);
  const targetRef = hookPayloadString(rawPayload.targetRef ?? rawPayload.target_ref);
  if (!payload.threadId && threadId) payload.threadId = threadId;
  if (!payload.targetRef && targetRef) payload.targetRef = targetRef;
  if (payload.limit === undefined) {
    const rawLimit = rawPayload.limit;
    if (typeof rawLimit === "number" || typeof rawLimit === "string") {
      payload.limit = parsePositiveInteger(String(rawLimit), "--limit", 25);
    }
  }
  for (const key of ["threadId", "thread_id", "targetRef", "target_ref", "limit"]) {
    delete remainingPayload[key];
  }
  return remainingPayload;
}

function hookPayloadString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseHookCompactionCaptureArgs(input: string[]): { payload: CompactionMarkerHookInput; evidencePath?: string; strict: boolean } {
  let payload = {} as CompactionMarkerHookInput;
  let evidencePath: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--payload-file") {
      payload = { ...payload, ...readHookPayloadFile(requireOptionValue(input[++index], arg)) } as CompactionMarkerHookInput;
    } else if (arg === "--payload-json") {
      payload = { ...payload, ...parseHookPayloadJson(requireOptionValue(input[++index], arg)) } as CompactionMarkerHookInput;
    } else if (arg === "--thread-id") {
      payload.threadId = requireOptionValue(input[++index], arg);
    } else if (arg === "--target-ref") {
      payload.targetRef = requireOptionValue(input[++index], arg);
    } else if (arg === "--turn-id") {
      payload.turnId = requireOptionValue(input[++index], arg);
    } else if (arg === "--event-id") {
      payload.eventId = requireOptionValue(input[++index], arg);
    } else if (arg === "--transcript-path") {
      payload.transcriptPath = requireOptionValue(input[++index], arg);
    } else if (arg === "--mode") {
      const mode = requireOptionValue(input[++index], arg);
      if (mode !== "marker") throw new Error("hook compaction-capture --mode must be marker");
      payload.mode = "marker";
    } else if (arg === "--lifecycle") {
      payload.lifecycle = requireOptionValue(input[++index], arg) as CompactionMarkerHookInput["lifecycle"];
    } else if (arg === "--marker-note") {
      payload.markerNote = requireOptionValue(input[++index], arg);
    } else if (arg === "--summary") {
      payload.summary = requireOptionValue(input[++index], arg);
    } else if (arg === "--evidence-path") {
      evidencePath = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown hook compaction-capture option: ${arg}`);
    }
  }
  if (payload.mode !== "marker") throw new Error("hook compaction-capture requires --mode marker");
  if (!payload.lifecycle) throw new Error("hook compaction-capture requires --lifecycle pre_compact or post_compact");
  return { payload, evidencePath, strict };
}

function parseHookThreadTitleFinalizeArgs(input: string[]): { payload: ThreadTitleFinalizerInput; evidencePath?: string; strict: boolean } {
  let payload: ThreadTitleFinalizerInput = {};
  let evidencePath: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--payload-stdin") {
      payload = { ...payload, ...readHookPayloadStdin() };
    } else if (arg === "--payload-file") {
      payload = { ...payload, ...readHookPayloadFile(requireOptionValue(input[++index], arg)) };
    } else if (arg === "--payload-json") {
      payload = { ...payload, ...parseHookPayloadJson(requireOptionValue(input[++index], arg)) };
    } else if (arg === "--thread-id") {
      payload.threadId = requireOptionValue(input[++index], arg);
    } else if (arg === "--target-ref") {
      payload.targetRef = requireOptionValue(input[++index], arg);
    } else if (arg === "--turn-id") {
      payload.turnId = requireOptionValue(input[++index], arg);
    } else if (arg === "--event-id") {
      payload.eventId = requireOptionValue(input[++index], arg);
    } else if (arg === "--transcript-path") {
      payload.transcriptPath = requireOptionValue(input[++index], arg);
    } else if (arg === "--cwd") {
      payload.cwd = requireOptionValue(input[++index], arg);
    } else if (arg === "--current-title") {
      payload.currentTitle = requireOptionValue(input[++index], arg);
    } else if (arg === "--task-summary") {
      payload.taskSummary = requireOptionValue(input[++index], arg);
    } else if (arg === "--last-assistant-message") {
      payload.lastAssistantMessage = requireOptionValue(input[++index], arg);
    } else if (arg === "--evidence-path") {
      evidencePath = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown hook thread-title-finalize option: ${arg}`);
    }
  }
  return { payload, evidencePath, strict };
}

function readHookPayloadFile(path: string): Record<string, unknown> {
  return objectPayload(readJsonFile(path, "hook payload file"), "hook payload file");
}

function readHookPayloadStdin(): Record<string, unknown> {
  return parseHookPayloadJson(readFileSync(0, "utf8"));
}

function parseHookPayloadJson(value: string): Record<string, unknown> {
  try {
    return objectPayload(JSON.parse(value), "hook payload JSON");
  } catch (error) {
    throw new Error(`Failed to parse hook payload JSON: ${(error as Error).message}`);
  }
}

function objectPayload(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain a JSON object`);
  return value as Record<string, unknown>;
}

function writeHookEvidence(path: string | undefined, report: unknown): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
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

function parseRetrievalEvalArgs(input: string[]): { scenarioFile: string; floorFile?: string; evidencePath?: string; strict: boolean } {
  let scenarioFile = "";
  let floorFile: string | undefined;
  let evidencePath: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--scenario-file") {
      scenarioFile = requireOptionValue(input[++index], arg);
    } else if (arg === "--floor-file") {
      floorFile = requireOptionValue(input[++index], arg);
    } else if (arg === "--evidence-path") {
      evidencePath = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown eval retrieval option: ${arg}`);
    }
  }
  if (!scenarioFile) throw new Error("eval retrieval requires --scenario-file");
  return { scenarioFile, floorFile, evidencePath, strict };
}

function parseScenarioSweepArgs(input: string[]): { evidenceDir: string; scenarioDir?: string; runtimeProofDir?: string; scenarioIds?: string[]; packageVersion?: string; candidateSha?: string; strict: boolean } {
  let evidenceDir = "";
  let scenarioDir: string | undefined;
  let runtimeProofDir: string | undefined;
  let packageVersion: string | undefined;
  let candidateSha: string | undefined;
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
    } else if (arg === "--package-version") {
      packageVersion = requireOptionValue(input[++index], arg);
    } else if (arg === "--candidate-sha") {
      candidateSha = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown eval scenarios option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("eval scenarios requires --evidence-dir");
  return { evidenceDir, scenarioDir, runtimeProofDir, scenarioIds: scenarioIds.length ? scenarioIds : undefined, packageVersion, candidateSha, strict };
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

function readRetrievalFloorFile(path: string): RetrievalBaselineFloors {
  const floorPath = resolve(path);
  if (!existsSync(floorPath)) throw new Error(`Retrieval floor file does not exist: ${path}`);
  const payload = JSON.parse(readFileSync(floorPath, "utf8")) as RetrievalBaselineFloors;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Retrieval floor file must be an object");
  if (!payload.overall || typeof payload.overall !== "object" || Array.isArray(payload.overall)) throw new Error("Retrieval floor file requires overall floors");
  return {
    ...payload,
    families: payload.families ?? {}
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
    limit: optionalJsonPositiveInteger(record.limit, "limit", 100),
    k: optionalJsonPositiveInteger(record.k, "k", 100),
    family: typeof record.family === "string" ? record.family.trim() : undefined,
    rationale: typeof record.rationale === "string" ? record.rationale.trim() : undefined
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
  coverage?: "default" | "full";
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
    } else if (arg === "--coverage") {
      const value = requireOptionValue(input[++index], arg);
      if (value !== "default" && value !== "full") throw new Error("--coverage must be default or full");
      parsed.coverage = value;
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
  if (parsed.coverage === "full" && requiredTools.length > 0) {
    throw new Error("--coverage full cannot be combined with --required-tool; run full coverage or explicit tools as separate smokes");
  }
  if (requiredTools.length > 0) parsed.requiredTools = requiredTools;
  else if (parsed.coverage === "full") parsed.requiredTools = FULL_GATEWAY_SMOKE_TOOL_CALLS;
  const effectiveRequiredTools = parsed.requiredTools ?? DEFAULT_REQUIRED_TOOL_CALLS;
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
  gatewayReadyStrict: boolean;
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
    gatewayReadyStrict: boolean;
  } = { strict: false, gatewayReadyStrict: false };
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
    } else if (arg === "--gateway-ready-strict") {
      parsed.gatewayReadyStrict = true;
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
    strict: parsed.strict,
    gatewayReadyStrict: parsed.gatewayReadyStrict
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
  action?: OpenClawGatewayLiveControlAction;
  message?: string;
  expectedTurnId?: string;
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
    } else if (arg === "--action") {
      parsed.action = parseOpenClawLiveControlAction(requireOptionValue(input[++index], arg));
    } else if (arg === "--message") {
      parsed.message = requireOptionValue(input[++index], arg);
    } else if (arg === "--expected-turn-id") {
      parsed.expectedTurnId = requireOptionValue(input[++index], arg);
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
  if (!parsed.action) throw new Error("openclaw live-control-smoke requires explicit --action");
  return parsed as ReturnType<typeof parseOpenClawLiveControlSmokeArgs>;
}

function parseOpenClawLiveControlAction(value: string): OpenClawGatewayLiveControlAction {
  if (value === "send" || value === "resume" || value === "steer" || value === "interrupt") return value;
  throw new Error("--action must be send, resume, steer, or interrupt");
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

function parseScorecardSweepArgs(input: string[]): { evidenceDir: string; scorecardDir?: string; claimScope?: ReleaseClaimScope; runtimeProofDir?: string; packageVersion?: string; candidateSha?: string; strict: boolean } {
  let evidenceDir: string | undefined;
  let scorecardDir: string | undefined;
  let claimScope: ReleaseClaimScope | undefined;
  let runtimeProofDir: string | undefined;
  let packageVersion: string | undefined;
  let candidateSha: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--scorecard-dir") {
      scorecardDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--claim-scope") {
      claimScope = parseReleaseClaimScope(input, ++index, arg);
    } else if (arg === "--runtime-proof-dir") {
      runtimeProofDir = requireOptionValue(input[++index], arg);
    } else if (arg === "--package-version") {
      packageVersion = requireOptionValue(input[++index], arg);
    } else if (arg === "--candidate-sha") {
      candidateSha = requireOptionValue(input[++index], arg);
    } else if (arg === "--strict") {
      strict = true;
    } else {
      throw new Error(`Unknown scorecards sweep option: ${arg}`);
    }
  }
  if (!evidenceDir) throw new Error("scorecards sweep requires --evidence-dir");
  return { evidenceDir, scorecardDir, claimScope, runtimeProofDir, packageVersion, candidateSha, strict };
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

function parseReleaseGaSmokeArgs(input: string[]): {
  evidenceDir: string;
  packageVersion: string;
  candidateSha: string;
  claimScope?: ReleaseClaimScope;
  releaseStatus?: string;
  releaseFinalizationStatus?: string;
  publishedSmoke?: string;
  dogfoodReport?: string;
  toolSmokeReport?: string;
  scenarioSweep?: string;
  scorecardSweep?: string;
  releasePreflight?: string;
  releaseBundle?: string;
  privacyScan?: string;
  qaLabRun?: string;
  qaLabToolCoverage?: string;
  qaLabLiveControlMatrix?: string;
  qaLabJudgeReview?: string;
  qaLabAdversarialReview?: string;
  allowSetupRequired: boolean;
  now?: string;
  strict: boolean;
} {
  let evidenceDir: string | undefined;
  let packageVersion: string | undefined;
  let candidateSha: string | undefined;
  let claimScope: ReleaseClaimScope | undefined;
  let releaseStatus: string | undefined;
  let releaseFinalizationStatus: string | undefined;
  let publishedSmoke: string | undefined;
  let dogfoodReport: string | undefined;
  let toolSmokeReport: string | undefined;
  let scenarioSweep: string | undefined;
  let scorecardSweep: string | undefined;
  let releasePreflight: string | undefined;
  let releaseBundle: string | undefined;
  let privacyScan: string | undefined;
  let qaLabRun: string | undefined;
  let qaLabToolCoverage: string | undefined;
  let qaLabLiveControlMatrix: string | undefined;
  let qaLabJudgeReview: string | undefined;
  let qaLabAdversarialReview: string | undefined;
  let allowSetupRequired = false;
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = readReleaseStatusPath(input, ++index, "--evidence-dir");
      continue;
    }
    if (arg === "--package-version") {
      packageVersion = readReleaseStatusValue(input, ++index, "--package-version");
      continue;
    }
    if (arg === "--candidate-sha") {
      candidateSha = readReleaseStatusValue(input, ++index, "--candidate-sha");
      continue;
    }
    if (arg === "--claim-scope") {
      claimScope = parseReleaseClaimScope(input, ++index, "--claim-scope");
      continue;
    }
    if (arg === "--release-status") {
      releaseStatus = readReleaseStatusPath(input, ++index, "--release-status");
      continue;
    }
    if (arg === "--release-finalization-status") {
      releaseFinalizationStatus = readReleaseStatusPath(input, ++index, "--release-finalization-status");
      continue;
    }
    if (arg === "--published-smoke") {
      publishedSmoke = readReleaseStatusPath(input, ++index, "--published-smoke");
      continue;
    }
    if (arg === "--dogfood-report") {
      dogfoodReport = readReleaseStatusPath(input, ++index, "--dogfood-report");
      continue;
    }
    if (arg === "--tool-smoke-report") {
      toolSmokeReport = readReleaseStatusPath(input, ++index, "--tool-smoke-report");
      continue;
    }
    if (arg === "--scenario-sweep") {
      scenarioSweep = readReleaseStatusPath(input, ++index, "--scenario-sweep");
      continue;
    }
    if (arg === "--scorecard-sweep") {
      scorecardSweep = readReleaseStatusPath(input, ++index, "--scorecard-sweep");
      continue;
    }
    if (arg === "--release-preflight") {
      releasePreflight = readReleaseStatusPath(input, ++index, "--release-preflight");
      continue;
    }
    if (arg === "--release-bundle") {
      releaseBundle = readReleaseStatusPath(input, ++index, "--release-bundle");
      continue;
    }
    if (arg === "--privacy-scan") {
      privacyScan = readReleaseStatusPath(input, ++index, "--privacy-scan");
      continue;
    }
    if (arg === "--qa-lab-run") {
      qaLabRun = readReleaseStatusPath(input, ++index, "--qa-lab-run");
      continue;
    }
    if (arg === "--tool-coverage") {
      qaLabToolCoverage = readReleaseStatusPath(input, ++index, "--tool-coverage");
      continue;
    }
    if (arg === "--live-control-matrix") {
      qaLabLiveControlMatrix = readReleaseStatusPath(input, ++index, "--live-control-matrix");
      continue;
    }
    if (arg === "--judge-review") {
      qaLabJudgeReview = readReleaseStatusPath(input, ++index, "--judge-review");
      continue;
    }
    if (arg === "--adversarial-review") {
      qaLabAdversarialReview = readReleaseStatusPath(input, ++index, "--adversarial-review");
      continue;
    }
    if (arg === "--allow-setup-required") {
      allowSetupRequired = true;
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
    throw new Error(`Unknown release ga-smoke option: ${arg}`);
  }
  if (!evidenceDir) throw new Error("release ga-smoke requires --evidence-dir");
  if (!packageVersion) throw new Error("release ga-smoke requires --package-version");
  if (!candidateSha) throw new Error("release ga-smoke requires --candidate-sha");
  return {
    evidenceDir,
    packageVersion,
    candidateSha,
    claimScope,
    releaseStatus,
    releaseFinalizationStatus,
    publishedSmoke,
    dogfoodReport,
    toolSmokeReport,
    scenarioSweep,
    scorecardSweep,
    releasePreflight,
    releaseBundle,
    privacyScan,
    qaLabRun,
    qaLabToolCoverage,
    qaLabLiveControlMatrix,
    qaLabJudgeReview,
    qaLabAdversarialReview,
    allowSetupRequired,
    now,
    strict
  };
}

function parseQaLabRunArgs(input: string[]): {
  suite: QaLabRunSuite;
  artifact: QaLabRunArtifact;
  evidenceDir: string;
  packageVersion: string;
  candidateSha: string;
  claimScope?: ReleaseClaimScope;
  toolCoverage?: string;
  workflowRun?: string;
  cliMcpProductSmoke?: string;
  desktopContract?: string;
  liveControlMatrix?: string;
  scenarioSweep?: string;
  scorecardSweep?: string;
  privacyScan?: string;
  now?: string;
  strict: boolean;
} {
  let suite: QaLabRunSuite | undefined;
  let artifact: QaLabRunArtifact | undefined;
  let evidenceDir: string | undefined;
  let packageVersion: string | undefined;
  let candidateSha: string | undefined;
  let claimScope: ReleaseClaimScope | undefined;
  let toolCoverage: string | undefined;
  let workflowRun: string | undefined;
  let cliMcpProductSmoke: string | undefined;
  let desktopContract: string | undefined;
  let liveControlMatrix: string | undefined;
  let scenarioSweep: string | undefined;
  let scorecardSweep: string | undefined;
  let privacyScan: string | undefined;
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--suite") {
      suite = parseQaLabRunSuite(input, ++index, arg);
      continue;
    }
    if (arg === "--artifact") {
      artifact = parseQaLabRunArtifact(input, ++index, arg);
      continue;
    }
    if (arg === "--evidence-dir") {
      evidenceDir = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--package-version") {
      packageVersion = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--candidate-sha") {
      candidateSha = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--claim-scope") {
      claimScope = parseReleaseClaimScope(input, ++index, arg);
      continue;
    }
    if (arg === "--tool-coverage") {
      toolCoverage = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--workflow-run") {
      workflowRun = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--cli-mcp-smoke") {
      cliMcpProductSmoke = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--desktop-contract") {
      desktopContract = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--live-control-matrix") {
      liveControlMatrix = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--scenario-sweep") {
      scenarioSweep = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--scorecard-sweep") {
      scorecardSweep = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--privacy-scan") {
      privacyScan = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--now") {
      now = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    throw new Error(`Unknown qa-lab run option: ${arg}`);
  }
  if (!suite) throw new Error("qa-lab run requires --suite");
  if (!artifact) throw new Error("qa-lab run requires --artifact");
  if (!evidenceDir) throw new Error("qa-lab run requires --evidence-dir");
  if (!packageVersion) throw new Error("qa-lab run requires --package-version");
  if (!candidateSha) throw new Error("qa-lab run requires --candidate-sha");
  return {
    suite,
    artifact,
    evidenceDir,
    packageVersion,
    candidateSha,
    claimScope,
    toolCoverage,
    workflowRun,
    cliMcpProductSmoke,
    desktopContract,
    liveControlMatrix,
    scenarioSweep,
    scorecardSweep,
    privacyScan,
    now,
    strict
  };
}

function parseQaLabRunSuite(input: string[], index: number, flag: string): QaLabRunSuite {
  const value = readReleaseStatusValue(input, index, flag);
  if (value === "ga") return value;
  throw new Error(`${flag} requires ga`);
}

function parseQaLabRunArtifact(input: string[], index: number, flag: string): QaLabRunArtifact {
  const value = readReleaseStatusValue(input, index, flag);
  if (value === "published" || value === "candidate") return value;
  throw new Error(`${flag} requires published or candidate`);
}

function parseQaLabToolCoverageArgs(input: string[]): {
  evidenceDir: string;
  packageVersion?: string;
  candidateSha?: string;
  claimScope?: ReleaseClaimScope;
  coveragePolicy?: QaLabCoveragePolicy;
  toolSmokeReport?: string;
  dogfoodReport?: string;
  publishedSmoke?: string;
  manifestPath?: string;
  now?: string;
  strict: boolean;
} {
  let evidenceDir: string | undefined;
  let packageVersion: string | undefined;
  let candidateSha: string | undefined;
  let claimScope: ReleaseClaimScope | undefined;
  let coveragePolicy: QaLabCoveragePolicy | undefined;
  let toolSmokeReport: string | undefined;
  let dogfoodReport: string | undefined;
  let publishedSmoke: string | undefined;
  let manifestPath: string | undefined;
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = readReleaseStatusPath(input, ++index, "--evidence-dir");
      continue;
    }
    if (arg === "--package-version") {
      packageVersion = readReleaseStatusValue(input, ++index, "--package-version");
      continue;
    }
    if (arg === "--candidate-sha") {
      candidateSha = readReleaseStatusValue(input, ++index, "--candidate-sha");
      continue;
    }
    if (arg === "--claim-scope") {
      claimScope = parseReleaseClaimScope(input, ++index, "--claim-scope");
      continue;
    }
    if (arg === "--coverage-policy") {
      coveragePolicy = parseQaLabCoveragePolicy(input, ++index, "--coverage-policy");
      continue;
    }
    if (arg === "--tool-smoke-report") {
      toolSmokeReport = readReleaseStatusPath(input, ++index, "--tool-smoke-report");
      continue;
    }
    if (arg === "--dogfood-report") {
      dogfoodReport = readReleaseStatusPath(input, ++index, "--dogfood-report");
      continue;
    }
    if (arg === "--published-smoke") {
      publishedSmoke = readReleaseStatusPath(input, ++index, "--published-smoke");
      continue;
    }
    if (arg === "--manifest") {
      manifestPath = readReleaseStatusPath(input, ++index, "--manifest");
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
    throw new Error(`Unknown qa-lab tool-coverage option: ${arg}`);
  }
  if (!evidenceDir) throw new Error("qa-lab tool-coverage requires --evidence-dir");
  return { evidenceDir, packageVersion, candidateSha, claimScope, coveragePolicy, toolSmokeReport, dogfoodReport, publishedSmoke, manifestPath, now, strict };
}

function parseQaLabDesktopContractArgs(input: string[]): {
  evidenceDir: string;
  readinessReport?: string;
  actionBoundScratchProof?: string;
  packageVersion?: string;
  candidateSha?: string;
  now?: string;
  strict: boolean;
} {
  let evidenceDir: string | undefined;
  let readinessReport: string | undefined;
  let actionBoundScratchProof: string | undefined;
  let packageVersion: string | undefined;
  let candidateSha: string | undefined;
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--readiness-report") {
      readinessReport = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--action-bound-scratch-proof") {
      actionBoundScratchProof = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--package-version") {
      packageVersion = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--candidate-sha") {
      candidateSha = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--now") {
      now = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    throw new Error(`Unknown qa-lab desktop-contract option: ${arg}`);
  }
  if (!evidenceDir) throw new Error("qa-lab desktop-contract requires --evidence-dir");
  return { evidenceDir, readinessReport, actionBoundScratchProof, packageVersion, candidateSha, now, strict };
}

function parseQaLabPrivacyScanArgs(input: string[]): {
  evidenceDir: string;
  packageVersion: string;
  candidateSha: string;
  scanDir?: string;
  now?: string;
  strict: boolean;
} {
  let evidenceDir: string | undefined;
  let packageVersion: string | undefined;
  let candidateSha: string | undefined;
  let scanDir: string | undefined;
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--package-version") {
      packageVersion = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--candidate-sha") {
      candidateSha = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--scan-dir") {
      scanDir = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--now") {
      now = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    throw new Error(`Unknown qa-lab privacy-scan option: ${arg}`);
  }
  if (!evidenceDir) throw new Error("qa-lab privacy-scan requires --evidence-dir");
  if (!packageVersion) throw new Error("qa-lab privacy-scan requires --package-version");
  if (!candidateSha) throw new Error("qa-lab privacy-scan requires --candidate-sha");
  return { evidenceDir, packageVersion, candidateSha, scanDir, now, strict };
}

function parseQaLabLiveControlMatrixArgs(input: string[]): {
  evidenceDir: string;
  packageVersion?: string;
  candidateSha?: string;
  claimScope?: ReleaseClaimScope;
  sendReport?: string;
  resumeReport?: string;
  steerReport?: string;
  interruptReport?: string;
  sacrificialThreadIds: string[];
  now?: string;
  strict: boolean;
} {
  let evidenceDir: string | undefined;
  let packageVersion: string | undefined;
  let candidateSha: string | undefined;
  let claimScope: ReleaseClaimScope | undefined;
  let sendReport: string | undefined;
  let resumeReport: string | undefined;
  let steerReport: string | undefined;
  let interruptReport: string | undefined;
  const sacrificialThreadIds: string[] = [];
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = readReleaseStatusPath(input, ++index, "--evidence-dir");
      continue;
    }
    if (arg === "--package-version") {
      packageVersion = readReleaseStatusValue(input, ++index, "--package-version");
      continue;
    }
    if (arg === "--candidate-sha") {
      candidateSha = readReleaseStatusValue(input, ++index, "--candidate-sha");
      continue;
    }
    if (arg === "--claim-scope") {
      claimScope = parseReleaseClaimScope(input, ++index, "--claim-scope");
      continue;
    }
    if (arg === "--send-report") {
      sendReport = readReleaseStatusPath(input, ++index, "--send-report");
      continue;
    }
    if (arg === "--resume-report") {
      resumeReport = readReleaseStatusPath(input, ++index, "--resume-report");
      continue;
    }
    if (arg === "--steer-report") {
      steerReport = readReleaseStatusPath(input, ++index, "--steer-report");
      continue;
    }
    if (arg === "--interrupt-report") {
      interruptReport = readReleaseStatusPath(input, ++index, "--interrupt-report");
      continue;
    }
    if (arg === "--sacrificial-thread-id") {
      sacrificialThreadIds.push(readReleaseStatusValue(input, ++index, "--sacrificial-thread-id"));
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
    throw new Error(`Unknown qa-lab live-control-matrix option: ${arg}`);
  }
  if (!evidenceDir) throw new Error("qa-lab live-control-matrix requires --evidence-dir");
  return { evidenceDir, packageVersion, candidateSha, claimScope, sendReport, resumeReport, steerReport, interruptReport, sacrificialThreadIds, now, strict };
}

function parseQaLabCliMcpSmokeArgs(input: string[]): {
  evidenceDir: string;
  packageVersion: string;
  candidateSha?: string;
  cliBin?: string;
  mcpBin?: string;
  toolCallName?: string;
  requiredTools?: string[];
  timeoutMs?: number;
  now?: string;
  strict: boolean;
} {
  let evidenceDir: string | undefined;
  let packageVersion: string | undefined;
  let candidateSha: string | undefined;
  let cliBin: string | undefined;
  let mcpBin: string | undefined;
  let toolCallName: string | undefined;
  const requiredTools: string[] = [];
  let timeoutMs: number | undefined;
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--evidence-dir") {
      evidenceDir = readReleaseStatusPath(input, ++index, "--evidence-dir");
      continue;
    }
    if (arg === "--package-version") {
      packageVersion = readReleaseStatusValue(input, ++index, "--package-version");
      continue;
    }
    if (arg === "--candidate-sha") {
      candidateSha = readReleaseStatusValue(input, ++index, "--candidate-sha");
      continue;
    }
    if (arg === "--cli-bin") {
      cliBin = readReleaseStatusPath(input, ++index, "--cli-bin");
      continue;
    }
    if (arg === "--mcp-bin") {
      mcpBin = readReleaseStatusPath(input, ++index, "--mcp-bin");
      continue;
    }
    if (arg === "--required-tool") {
      requiredTools.push(parseLooToolName(readReleaseStatusValue(input, ++index, "--required-tool"), "--required-tool"));
      continue;
    }
    if (arg === "--tool-call") {
      toolCallName = parseLooToolName(readReleaseStatusValue(input, ++index, "--tool-call"), "--tool-call");
      continue;
    }
    if (arg === "--timeout-ms") {
      timeoutMs = parsePositiveInteger(input[++index], "--timeout-ms", MAX_CLI_MCP_PRODUCT_SMOKE_TIMEOUT_MS);
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
    throw new Error(`Unknown qa-lab cli-mcp-smoke option: ${arg}`);
  }
  if (!evidenceDir) throw new Error("qa-lab cli-mcp-smoke requires --evidence-dir");
  if (!packageVersion) throw new Error("qa-lab cli-mcp-smoke requires --package-version");
  return {
    evidenceDir,
    packageVersion,
    candidateSha,
    cliBin,
    mcpBin,
    toolCallName,
    ...(requiredTools.length ? { requiredTools } : {}),
    timeoutMs,
    now,
    strict
  };
}

function parseLooToolName(value: string, flag: string): string {
  if (/^loo_[a-z0-9_]+$/.test(value)) return value;
  throw new Error(`${flag} requires a loo_* tool name`);
}

function parseQaLabJudgeArgs(input: string[]): {
  runPath: string;
  evidenceDir: string;
  rubricVersion: QaLabRubricVersion;
  now?: string;
  strict: boolean;
} {
  let runPath: string | undefined;
  let evidenceDir: string | undefined;
  let rubricVersion: QaLabRubricVersion | undefined;
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--run") {
      runPath = readReleaseStatusPath(input, ++index, "--run");
      continue;
    }
    if (arg === "--evidence-dir") {
      evidenceDir = readReleaseStatusPath(input, ++index, "--evidence-dir");
      continue;
    }
    if (arg === "--rubric-version") {
      rubricVersion = parseQaLabRubricVersion(input, ++index, "--rubric-version");
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
    throw new Error(`Unknown qa-lab judge option: ${arg}`);
  }
  if (!runPath) throw new Error("qa-lab judge requires --run");
  if (!evidenceDir) throw new Error("qa-lab judge requires --evidence-dir");
  if (!rubricVersion) throw new Error("qa-lab judge requires --rubric-version");
  return { runPath, evidenceDir, rubricVersion, now, strict };
}

function parseQaLabAdversarialReviewArgs(input: string[]): {
  runPath: string;
  evidenceDir: string;
  lenses: QaLabAdversarialLens[];
  now?: string;
  strict: boolean;
} {
  let runPath: string | undefined;
  let evidenceDir: string | undefined;
  let lenses: QaLabAdversarialLens[] | undefined;
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--run") {
      runPath = readReleaseStatusPath(input, ++index, "--run");
      continue;
    }
    if (arg === "--evidence-dir") {
      evidenceDir = readReleaseStatusPath(input, ++index, "--evidence-dir");
      continue;
    }
    if (arg === "--lenses") {
      lenses = parseQaLabAdversarialLenses(input, ++index, "--lenses");
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
    throw new Error(`Unknown qa-lab adversarial-review option: ${arg}`);
  }
  if (!runPath) throw new Error("qa-lab adversarial-review requires --run");
  if (!evidenceDir) throw new Error("qa-lab adversarial-review requires --evidence-dir");
  return { runPath, evidenceDir, lenses: lenses ?? DEFAULT_QA_LAB_ADVERSARIAL_LENSES, now, strict };
}

function parseQaLabRubricVersion(input: string[], index: number, flag: string): QaLabRubricVersion {
  const value = readReleaseStatusValue(input, index, flag);
  if (value === "real-product-v1") return value;
  throw new Error(`${flag} requires real-product-v1`);
}

function parseQaLabAdversarialLenses(input: string[], index: number, flag: string): QaLabAdversarialLens[] {
  const value = readReleaseStatusValue(input, index, flag);
  const lenses = value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => normalizeQaLabLens(item));
  if (lenses.length === 0) throw new Error(`${flag} requires at least one lens`);
  return [...new Set(lenses)];
}

function normalizeQaLabLens(value: string): QaLabAdversarialLens {
  if (value === "safety" || value === "retrieval" || value === "packaging" || value === "claims") return value;
  if (value === "agent-usability" || value === "agentUsability") return "agentUsability";
  throw new Error(`Unknown qa-lab adversarial-review lens: ${value}`);
}

function parseQaLabCoveragePolicy(input: string[], index: number, flag: string): QaLabCoveragePolicy {
  const value = readReleaseStatusValue(input, index, flag);
  if (value === "full" || value === "facade") return value;
  throw new Error(`${flag} requires full or facade`);
}

function parseQaLabWorkflowArgs(input: string[]): {
  scenarioId: string;
  surface: QaLabWorkflowSurface;
  mode: QaLabWorkflowMode;
  evidenceDir: string;
  packageVersion?: string;
  candidateSha?: string;
  openclawBin?: string;
  gatewayUrl?: string;
  token?: string;
  gatewayTimeoutMs?: number;
  sessionKey?: string;
  now?: string;
  strict: boolean;
} {
  let scenarioId: string | undefined;
  let surface: QaLabWorkflowSurface | undefined;
  let mode: QaLabWorkflowMode | undefined;
  let evidenceDir: string | undefined;
  let packageVersion: string | undefined;
  let candidateSha: string | undefined;
  let openclawBin: string | undefined;
  let gatewayUrl: string | undefined;
  let token: string | undefined;
  let gatewayTimeoutMs: number | undefined;
  let sessionKey: string | undefined;
  let now: string | undefined;
  let strict = false;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;
    if (arg === "--scenario-id") {
      scenarioId = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--surface") {
      surface = parseQaLabWorkflowSurface(input, ++index, arg);
      continue;
    }
    if (arg === "--mode") {
      mode = parseQaLabWorkflowMode(input, ++index, arg);
      continue;
    }
    if (arg === "--evidence-dir") {
      evidenceDir = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--package-version") {
      packageVersion = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--candidate-sha") {
      candidateSha = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--openclaw-bin") {
      openclawBin = readReleaseStatusPath(input, ++index, arg);
      continue;
    }
    if (arg === "--gateway-url") {
      gatewayUrl = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--token") {
      token = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--gateway-timeout-ms") {
      gatewayTimeoutMs = parsePositiveInteger(readReleaseStatusValue(input, ++index, arg), arg, 600_000);
      continue;
    }
    if (arg === "--session-key") {
      sessionKey = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--now") {
      now = readReleaseStatusValue(input, ++index, arg);
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    throw new Error(`Unknown qa-lab workflow option: ${arg}`);
  }
  if (!scenarioId) throw new Error("qa-lab workflow requires --scenario-id");
  if (!surface) throw new Error("qa-lab workflow requires --surface");
  if (!mode) throw new Error("qa-lab workflow requires --mode");
  if (!evidenceDir) throw new Error("qa-lab workflow requires --evidence-dir");
  return { scenarioId, surface, mode, evidenceDir, packageVersion, candidateSha, openclawBin, gatewayUrl, token, gatewayTimeoutMs: gatewayTimeoutMs ?? 60_000, sessionKey, now, strict };
}

function parseQaLabWorkflowSurface(input: string[], index: number, flag: string): QaLabWorkflowSurface {
  const value = readReleaseStatusValue(input, index, flag);
  if (value === "cli" || value === "mcp" || value === "openclaw-gateway" || value === "desktop-contract") return value;
  throw new Error(`${flag} requires cli, mcp, openclaw-gateway, or desktop-contract`);
}

function parseQaLabWorkflowMode(input: string[], index: number, flag: string): QaLabWorkflowMode {
  const value = readReleaseStatusValue(input, index, flag);
  if (value === "dry-run" || value === "live-approved") return value;
  throw new Error(`${flag} requires dry-run or live-approved`);
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
