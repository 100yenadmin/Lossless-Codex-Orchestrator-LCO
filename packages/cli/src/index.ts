#!/usr/bin/env node
import { codexTransportStatus, createAuditStore, desktopActDryRun, desktopFallbackDiagnostics, desktopSee, type DesktopBackend } from "../../adapters/src/index.js";
import {
  configuredLcmPeerDbPaths,
  createCloseoutEnvelopeReport,
  createDatabase,
  defaultCodexRoots,
  defaultDatabasePath,
  describeRecallRef,
  expandQuery,
  expandRecallRef,
  grepRecall,
  indexCodexSessions,
  probeCodexSqliteStores,
  probeLcmPeerDbs,
  searchSessions,
  type RecallProfileName
} from "../../core/src/index.js";
import { join } from "node:path";
import { createReleaseBundle } from "./release-bundle.js";
import { createReleaseDemoStatus } from "./release-demo-status.js";
import { runReleasePreflight } from "./release-preflight.js";
import { createReleaseStatus } from "./release-status.js";
import { runOpenClawDogfood } from "./openclaw-dogfood.js";
import { createScorecardSweep } from "./scorecard-sweep.js";

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
  if (command === "openclaw" && args[0] === "dogfood") {
    const parsed = parseOpenClawDogfoodArgs(args.slice(1));
    const report = runOpenClawDogfood(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.dogfoodReady) process.exitCode = 1;
    return;
  }
  if (command === "scorecards" && args[0] === "sweep") {
    const parsed = parseScorecardSweepArgs(args.slice(1));
    const report = createScorecardSweep(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.sweepReady) process.exitCode = 1;
    return;
  }
  if (command === "release" && args[0] === "preflight") {
    const parsed = parseReleasePreflightArgs(args.slice(1));
    const report = runReleasePreflight({
      evidenceDir: parsed.evidenceDir,
      approvedLiveControlEvidence: parsed.approvedLiveControlEvidence
    });
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.releaseReady) process.exitCode = 1;
    return;
  }
  if (command === "release" && args[0] === "bundle") {
    const parsed = parseReleaseBundleArgs(args.slice(1));
    const report = createReleaseBundle({
      evidenceDir: parsed.evidenceDir,
      approvedLiveControlEvidence: parsed.approvedLiveControlEvidence
    });
    console.log(JSON.stringify(report, null, 2));
    if (parsed.strict && !report.publishReady) process.exitCode = 1;
    return;
  }
  if (command === "release" && args[0] === "status") {
    const parsed = parseReleaseStatusArgs(args.slice(1));
    const report = createReleaseStatus({
      evidenceDir: parsed.evidenceDir,
      approvedLiveControlEvidence: parsed.approvedLiveControlEvidence,
      npmPublishApprovalEvidence: parsed.npmPublishApprovalEvidence,
      githubReleaseApprovalEvidence: parsed.githubReleaseApprovalEvidence,
      desktopGuiApprovalEvidence: parsed.desktopGuiApprovalEvidence,
      desktopGuiRequired: parsed.desktopGuiRequired
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
    "  loo index codex [--max-files n] [--max-bytes-per-file n] [--max-events-per-file n] [roots...]",
    "  loo probe codex-sqlite [roots...]",
    "  loo search <query>",
    "  loo grep [--lcm-db path] [--profile metadata|brief|evidence] [--token-budget n] <query>",
    "  loo describe [--lcm-db path] <source-ref>",
    "  loo expand-query [--lcm-db path] [--profile metadata|brief|evidence] [--token-budget n] <query>",
    "  loo expand-ref [--lcm-db path] [--profile metadata|brief|evidence] [--token-budget n] <source-ref>",
    "  loo closeout dry-run [--thread-id id] [--limit n] [--include-unavailable]",
    "  loo serve",
    "  loo audit-path",
    "  loo openclaw dogfood [--dev] [--profile name] [--install-source path] [--link] [--force-install] [--evidence-path path] [--strict]",
    "  loo scorecards sweep --evidence-dir path [--scorecard-dir path] [--strict]",
    "  loo release preflight [--evidence-dir path] [--approved-live-control-evidence path] [--strict]",
    "  loo release bundle --evidence-dir path [--approved-live-control-evidence path] [--strict]",
    "  loo release status --evidence-dir path [--approved-live-control-evidence path] [--npm-publish-approval-evidence path] [--github-release-approval-evidence path] [--desktop-gui-required --desktop-gui-approval-evidence path] [--strict]",
    "  loo release demo-status --evidence-dir path [--approved-live-control-evidence path] [--min-sessions n] [--strict]"
  ].join("\n"));
  process.exitCode = 2;
}

await main();

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

function parseDesktopAction(parts: string[]): { backend?: DesktopBackend; action: string } {
  const first = parts[0];
  const hasExplicitBackend = isDesktopBackend(first);
  return {
    backend: hasExplicitBackend ? first : undefined,
    action: parts.slice(hasExplicitBackend ? 1 : 0).join(" ").trim() || "unknown"
  };
}

function isDesktopBackend(value: string | undefined): value is DesktopBackend {
  return value === "direct" || value === "cua-driver" || value === "peekaboo";
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

function parseReleasePreflightArgs(input: string[]): { evidenceDir?: string; approvedLiveControlEvidence?: string; strict: boolean } {
  let evidenceDir: string | undefined;
  let approvedLiveControlEvidence: string | undefined;
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
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    throw new Error(`Unknown release preflight option: ${arg}`);
  }
  return { evidenceDir, approvedLiveControlEvidence, strict };
}

function parseReleaseBundleArgs(input: string[]): { evidenceDir: string; approvedLiveControlEvidence?: string; strict: boolean } {
  const parsed = parseReleasePreflightArgs(input);
  if (!parsed.evidenceDir) throw new Error("release bundle requires --evidence-dir");
  return { evidenceDir: parsed.evidenceDir, approvedLiveControlEvidence: parsed.approvedLiveControlEvidence, strict: parsed.strict };
}

function parseReleaseStatusArgs(input: string[]): {
  evidenceDir: string;
  approvedLiveControlEvidence?: string;
  npmPublishApprovalEvidence?: string;
  githubReleaseApprovalEvidence?: string;
  desktopGuiApprovalEvidence?: string;
  desktopGuiRequired: boolean;
  strict: boolean;
} {
  let evidenceDir: string | undefined;
  let approvedLiveControlEvidence: string | undefined;
  let npmPublishApprovalEvidence: string | undefined;
  let githubReleaseApprovalEvidence: string | undefined;
  let desktopGuiApprovalEvidence: string | undefined;
  let desktopGuiRequired = false;
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
    if (arg === "--desktop-gui-required") {
      desktopGuiRequired = true;
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    throw new Error(`Unknown release status option: ${arg}`);
  }
  if (!evidenceDir) throw new Error("release status requires --evidence-dir");
  return { evidenceDir, approvedLiveControlEvidence, npmPublishApprovalEvidence, githubReleaseApprovalEvidence, desktopGuiApprovalEvidence, desktopGuiRequired, strict };
}

function readReleaseStatusPath(input: string[], index: number, flag: string): string {
  const value = input[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
  return value;
}

function parseReleaseDemoStatusArgs(input: string[]): { evidenceDir: string; approvedLiveControlEvidence?: string; minSessions?: number; strict: boolean } {
  let evidenceDir: string | undefined;
  let approvedLiveControlEvidence: string | undefined;
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
  return { evidenceDir, approvedLiveControlEvidence, minSessions, strict };
}
