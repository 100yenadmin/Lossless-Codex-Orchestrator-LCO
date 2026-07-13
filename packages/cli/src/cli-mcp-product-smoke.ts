import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANONICAL_PACKAGE_NAME, type SupportedPackageName } from "./package-identity.js";

export type CliMcpProductSmokeOptions = {
  evidenceDir?: string;
  packageVersion: string;
  candidateSha?: string;
  cliBin?: string;
  mcpBin?: string;
  toolCallName?: string;
  requiredTools?: string[];
  timeoutMs?: number;
  now?: string;
};

export type CliMcpProductSmokeReport = {
  schema: "lco.qaLab.cliMcpProductSmoke.v1";
  ok: boolean;
  publicSafe: true;
  localOnly: true;
  dryRun: true;
  generatedAt: string;
  packageName: SupportedPackageName;
  packageVersion: string;
  candidateSha: string | null;
  cliReady: boolean;
  mcpReady: boolean;
  mcpToolsCallReady: boolean;
  toolsListed: number;
  toolCallProbe: ToolCallProbe;
  requiredTools: string[];
  requiredToolsPresent: string[];
  missingRequiredTools: string[];
  blockers: string[];
  setupBlockers: string[];
  warnings: string[];
  actionsPerformed: {
    npmPublished: false;
    githubReleaseCreated: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    screenshotsCaptured: false;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
  nextSafeCommands: string[];
};

type ProbeResult = {
  ready: boolean;
  setupBlockers: string[];
  blockers: string[];
  warnings: string[];
};

type McpProbeResult = ProbeResult & {
  tools: string[];
  toolCall: ToolCallProbe;
};

type ToolCallProbe = {
  toolName: string;
  ok: boolean;
  contentItemCount: number;
  contentKinds: string[];
  structuredContentPresent: boolean;
  errorCode: string | null;
};

const DEFAULT_REQUIRED_TOOLS = [
  "lco_doctor",
  "lco_find",
  "lco_prepared_inbox",
  "lco_describe_ref",
  "lco_expand_query"
];
const DEFAULT_TIMEOUT_MS = 5_000;
export const MAX_CLI_MCP_PRODUCT_SMOKE_TIMEOUT_MS = 10_000;
const PRIVATE_DATA_EXCLUSIONS = [
  "raw CLI stdout/stderr",
  "raw MCP stdout/stderr",
  "raw local filesystem paths",
  "raw Codex transcripts",
  "raw prompts or message text",
  "SQLite DBs",
  "JSONL transcripts",
  "screenshots or videos",
  "tokens, credentials, API keys, cookies",
  "customer data"
];

export async function createCliMcpProductSmokeReport(options: CliMcpProductSmokeOptions): Promise<CliMcpProductSmokeReport> {
  const requiredTools = uniqueStrings(options.requiredTools?.length ? options.requiredTools : DEFAULT_REQUIRED_TOOLS);
  const cliProbe = probeCliHelp(options.cliBin ?? "loo", options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const toolCallName = options.toolCallName ?? "lco_doctor";
  const mcpProbe = await probeMcpToolsListAndCall(options.mcpBin ?? "lco-mcp-server", toolCallName, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const requiredToolsPresent = requiredTools.filter((tool) => mcpProbe.tools.includes(tool));
  const missingRequiredTools = requiredTools.filter((tool) => !mcpProbe.tools.includes(tool));
  const blockers = uniqueStrings([
    ...cliProbe.blockers,
    ...mcpProbe.blockers,
    ...(mcpProbe.ready && missingRequiredTools.length > 0 ? ["required_mcp_tools_missing"] : [])
  ]);
  const setupBlockers = uniqueStrings([...cliProbe.setupBlockers, ...mcpProbe.setupBlockers]);
  const warnings = uniqueStrings([...cliProbe.warnings, ...mcpProbe.warnings]);
  const cliReady = cliProbe.ready;
  const mcpReady = mcpProbe.ready;
  const mcpToolsCallReady = mcpProbe.toolCall.ok;
  const ok = cliReady && mcpReady && mcpToolsCallReady && missingRequiredTools.length === 0 && blockers.length === 0 && setupBlockers.length === 0;
  const report: CliMcpProductSmokeReport = {
    schema: "lco.qaLab.cliMcpProductSmoke.v1",
    ok,
    publicSafe: true,
    localOnly: true,
    dryRun: true,
    generatedAt: options.now ?? new Date().toISOString(),
    packageName: CANONICAL_PACKAGE_NAME,
    packageVersion: options.packageVersion,
    candidateSha: options.candidateSha ?? null,
    cliReady,
    mcpReady,
    mcpToolsCallReady,
    toolsListed: mcpProbe.tools.length,
    toolCallProbe: mcpProbe.toolCall,
    requiredTools,
    requiredToolsPresent,
    missingRequiredTools,
    blockers,
    setupBlockers,
    warnings,
    actionsPerformed: {
      npmPublished: false,
      githubReleaseCreated: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      screenshotsCaptured: false
    },
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS,
    proofBoundary: "This public-safe QA Lab product smoke proves CLI --help, MCP tools/list, and MCP tools/call for one safe representative tool from the selected published/fresh-install candidate binaries. The MCP child runs with an isolated temporary home, database, audit store, and Codex home so ambient user runtime size or state cannot substitute for package readiness. The default representative call is lco_doctor with empty arguments, so deeper tools should be covered by workflow-specific QA Lab lanes. The CLI and MCP probes run sequentially with the configured timeout applied per probe. The smoke initializes MCP with protocolVersion 2025-11-25; initialize failures are reported as package/protocol-drift defects for the candidate under test. JSON-RPC id pairing is the primary request/response binding; name-mismatch detection applies only when a non-standard server echoes result.name or result.toolName. It does not run live Codex control, mutate a desktop GUI, capture screenshots, publish npm, create a GitHub Release, store raw CLI output, or store raw MCP output.",
    nextSafeCommands: [
      `loo qa-lab cli-mcp-smoke --evidence-dir <dir> --package-version ${options.packageVersion} --strict`,
      "loo --help",
      "lco-mcp-server # MCP initialize + tools/list + tools/call"
    ]
  };
  if (options.evidenceDir) writeCliMcpProductSmokeReport(report, options.evidenceDir);
  return report;
}

export function writeCliMcpProductSmokeReport(report: CliMcpProductSmokeReport, evidenceDir: string): string {
  mkdirSync(evidenceDir, { recursive: true });
  const outputPath = join(evidenceDir, "cli-mcp-product-smoke.json");
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return outputPath;
}

function probeCliHelp(cliBin: string, timeoutMs: number): ProbeResult {
  const result = spawnSync(cliBin, ["--help"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: timeoutMs
  });
  if (result.error) {
    if (isMissingExecutableError(result.error)) {
      return setupRequired("cli_binary_not_found_or_not_executable");
    }
    if (isTimeoutError(result.error)) {
      return packageDefect("cli_help_timeout");
    }
    return packageDefect("cli_help_spawn_failed");
  }
  if (result.status === 0) return readyProbe();
  return packageDefect("cli_help_failed");
}

function probeMcpToolsListAndCall(mcpBin: string, toolCallName: string, timeoutMs: number): Promise<McpProbeResult> {
  return new Promise((resolve) => {
    let resolved = false;
    let stdoutBuffer = "";
    let listedTools: string[] = [];
    let stage: "initialize" | "tools_list" | "tools_call" = "initialize";
    let timer: ReturnType<typeof setTimeout> | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const runtimeRoot = mkdtempSync(join(tmpdir(), "lco-cli-mcp-smoke-"));
    let runtimeCleaned = false;
    const cleanupRuntime = () => {
      if (runtimeCleaned) return;
      runtimeCleaned = true;
      rmSync(runtimeRoot, { recursive: true, force: true });
    };
    const child = spawn(mcpBin, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: isolatedMcpProbeEnv(runtimeRoot)
    });
    const terminateChild = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 250);
      killTimer.unref?.();
    };
    const finish = (result: McpProbeResult) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      terminateChild();
      resolve(result);
    };

    timer = setTimeout(() => {
      const errorCode = stage === "initialize"
        ? "mcp_initialize_timeout"
        : stage === "tools_list"
          ? "mcp_tools_list_timeout"
          : "mcp_tools_call_timeout";
      finish({
        ready: stage === "tools_call" && listedTools.length > 0,
        setupBlockers: [],
        blockers: [errorCode],
        warnings: [],
        tools: listedTools,
        toolCall: failedToolCall(toolCallName, errorCode)
      });
    }, timeoutMs);
    timer.unref?.();

    const writeMessage = (payload: Record<string, unknown>, failureCode: string): boolean => {
      try {
        if (!child.stdin || child.stdin.destroyed || child.stdin.writableEnded) throw new Error("stdin closed");
        child.stdin.write(`${JSON.stringify(payload)}\n`);
        return true;
      } catch {
        finish({ ...packageDefect(failureCode), tools: listedTools, toolCall: failedToolCall(toolCallName, failureCode) });
        return false;
      }
    };

    child.on("error", (error) => {
      if (isMissingExecutableError(error)) {
        finish({ ...setupRequired("mcp_binary_not_found_or_not_executable"), tools: [], toolCall: failedToolCall(toolCallName, "mcp_binary_not_found_or_not_executable") });
        return;
      }
      finish({ ...packageDefect("mcp_spawn_failed"), tools: [], toolCall: failedToolCall(toolCallName, "mcp_spawn_failed") });
    });
    child.on("close", () => {
      cleanupRuntime();
      if (killTimer) clearTimeout(killTimer);
      if (resolved) return;
      if (listedTools.length > 0) {
        finish({ ...packageDefect("mcp_tools_call_failed"), tools: listedTools, toolCall: failedToolCall(toolCallName, "mcp_tools_call_failed") });
        return;
      }
      finish({ ...packageDefect("mcp_tools_list_failed"), tools: [], toolCall: failedToolCall(toolCallName, "mcp_tools_list_failed") });
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = parseJsonRpcLine(line);
        if (!parsed) continue;
        if (parsed.id === 1 && parsed.error) {
          finish({ ...packageDefect("mcp_initialize_failed"), tools: [], toolCall: failedToolCall(toolCallName, "mcp_initialize_failed") });
          return;
        }
        if (parsed.id === 1 && isRecord(parsed.result)) {
          stage = "tools_list";
          if (!writeMessage({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, "mcp_initialized_notification_failed")) return;
          if (!writeMessage({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, "mcp_tools_list_write_failed")) return;
          continue;
        }
        if (parsed.id === 2 && parsed.error) {
          finish({ ...packageDefect("mcp_tools_list_failed"), tools: [], toolCall: failedToolCall(toolCallName, "mcp_tools_list_failed") });
          return;
        }
        if (parsed.id === 2 && isRecord(parsed.result)) {
          const tools = extractToolNames(parsed.result.tools);
          listedTools = tools;
          if (tools.length === 0) {
            finish({ ...packageDefect("mcp_no_loo_tools_listed"), tools, toolCall: failedToolCall(toolCallName, "mcp_no_loo_tools_listed") });
            return;
          }
          if (!tools.includes(toolCallName)) {
            finish({
              ready: true,
              tools,
              setupBlockers: [],
              blockers: ["mcp_tool_call_tool_missing"],
              warnings: [],
              toolCall: failedToolCall(toolCallName, "mcp_tool_call_tool_missing")
            });
            return;
          }
          stage = "tools_call";
          if (!writeMessage({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: toolCallName, arguments: {} }
          }, "mcp_tools_call_write_failed")) return;
          continue;
        }
        if (parsed.id === 3 && parsed.error) {
          finish({
            ready: true,
            tools: listedTools,
            setupBlockers: [],
            blockers: ["mcp_tools_call_failed"],
            warnings: [],
            toolCall: failedToolCall(toolCallName, "mcp_tools_call_failed")
          });
          return;
        }
        if (parsed.id === 3 && isRecord(parsed.result)) {
          const toolCall = successfulToolCall(toolCallName, parsed.result);
          finish({
            ready: true,
            tools: listedTools,
            setupBlockers: [],
            blockers: toolCall.ok ? [] : [toolCall.errorCode ?? "mcp_tools_call_failed"],
            warnings: [],
            toolCall
          });
          return;
        }
      }
    });

    writeMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "lco-cli-mcp-product-smoke", version: "1.0.0" }
      }
    }, "mcp_initialize_write_failed");
  });
}

function isolatedMcpProbeEnv(runtimeRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "LANG", "LC_ALL", "TZ"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: runtimeRoot,
    USERPROFILE: runtimeRoot,
    TMPDIR: runtimeRoot,
    TMP: runtimeRoot,
    TEMP: runtimeRoot,
    CODEX_HOME: join(runtimeRoot, ".codex"),
    LCO_DB_PATH: join(runtimeRoot, "orchestrator.sqlite"),
    LCO_AUDIT_PATH: join(runtimeRoot, "audit.jsonl")
  };
}

function failedToolCall(toolName: string, errorCode: string): ToolCallProbe {
  return {
    toolName,
    ok: false,
    contentItemCount: 0,
    contentKinds: [],
    structuredContentPresent: false,
    errorCode
  };
}

function successfulToolCall(toolName: string, result: Record<string, unknown>): ToolCallProbe {
  const content = Array.isArray(result.content) ? result.content : [];
  const responseToolName = typeof result.toolName === "string"
    ? result.toolName
    : typeof result.name === "string"
      ? result.name
      : null;
  const nameMatches = responseToolName === null || responseToolName === toolName;
  return {
    toolName,
    ok: nameMatches,
    contentItemCount: content.length,
    contentKinds: uniqueStrings(content.map((item) => safeContentKind(item))).slice(0, 8),
    structuredContentPresent: Object.prototype.hasOwnProperty.call(result, "structuredContent"),
    errorCode: nameMatches ? null : "mcp_tools_call_name_mismatch"
  };
}

function safeContentKind(item: unknown): string {
  const kind = isRecord(item) && typeof item.type === "string" ? item.type : "unknown";
  return ["text", "image", "resource", "audio", "unknown"].includes(kind) ? kind : "unknown";
}

function readyProbe(): ProbeResult {
  return { ready: true, setupBlockers: [], blockers: [], warnings: [] };
}

function setupRequired(code: string): ProbeResult {
  return { ready: false, setupBlockers: [code], blockers: [], warnings: [] };
}

function packageDefect(code: string): ProbeResult {
  return { ready: false, setupBlockers: [], blockers: [code], warnings: [] };
}

function isMissingExecutableError(error: Error & { code?: string }): boolean {
  return error.code === "ENOENT" || error.code === "EACCES";
}

function isTimeoutError(error: Error & { code?: string }): boolean {
  return error.code === "ETIMEDOUT";
}

function parseJsonRpcLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value
    .map((item) => isRecord(item) && typeof item.name === "string" ? item.name : null)
    .filter((name): name is string => Boolean(name))
    .filter((name) => /^(?:lco|loo)_[a-z0-9_]+$/.test(name)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
