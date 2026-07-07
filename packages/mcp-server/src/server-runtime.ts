import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAuditStore, createCodexAppServerStdioClient } from "../../adapters/src/index.js";
import { createDatabase, defaultDatabasePath } from "../../core/src/index.js";
import { readEnv, readEnvWithFallback, resolveHomeDir } from "../../runtime/src/env.js";
import {
  createLooToolDeclarations,
  createLooTools,
  filterLooToolsByProfile,
  parseLooToolProfile,
  type LooTool
} from "./tools.js";

const toolProfile = parseLooToolProfile(readEnv("TOOL_PROFILE"), {
  onInvalid: (value) => {
    process.stderr.write(`Invalid LCO_TOOL_PROFILE=${JSON.stringify(value)}; falling back to all.\n`);
  }
});
const toolDeclarations = createLooToolDeclarations({ includeAliases: true });
const MCP_PROTOCOL_VERSION = "2025-11-25";
const SERVER_VERSION = readPackageVersion();
type StartupFailure = ReturnType<typeof createStartupUnavailableResult>;
type RuntimeState =
  | { ok: true; tools: LooTool[] }
  | { ok: false; failure: StartupFailure };
let runtimeState: Extract<RuntimeState, { ok: true }> | null = null;

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let messageId: unknown = null;
  try {
    const message = JSON.parse(line);
    messageId = message.id ?? null;
    if (message.method === "initialize") {
      send({ id: message.id, result: { protocolVersion: MCP_PROTOCOL_VERSION, serverInfo: { name: "lossless-openclaw-orchestrator", version: SERVER_VERSION }, capabilities: { tools: {} } } });
    } else if (message.method === "tools/list") {
      send({
        id: message.id,
        result: {
          tools: filterLooToolsByProfile(toolDeclarations, toolProfile)
            .map(({ name, description, metadata, inputSchema }) => ({ name, description, metadata, inputSchema }))
        }
      });
    } else if (message.method === "tools/call") {
      const requestedName = message.params?.name;
      const declaration = toolDeclarations.find((candidate) => candidate.name === requestedName);
      if (!declaration) throw new Error(`Unknown tool: ${requestedName}`);
      const runtime = getRuntimeState();
      if (!runtime.ok) {
        sendToolResult(message.id, runtime.failure);
        return;
      }
      const tool = runtime.tools.find((candidate) => candidate.name === requestedName);
      if (!tool) throw new Error(`Unknown tool: ${message.params?.name}`);
      const result = await tool.execute(message.params?.arguments ?? {});
      sendToolResult(message.id, result);
    } else {
      send({ id: message.id, error: { code: -32601, message: `Unsupported method: ${message.method}` } });
    }
  } catch (error) {
    process.stderr.write("MCP request error returned public-safe JSON-RPC error.\n");
    send({
      id: messageId,
      error: {
        code: -32000,
        message: error instanceof SyntaxError ? "Invalid JSON-RPC JSON request." : "Internal error processing MCP request."
      }
    });
  }
});

function getRuntimeState(): RuntimeState {
  if (runtimeState) return runtimeState;
  const dbResult = createRuntimeDatabase();
  if (!dbResult.ok) return { ok: false, failure: createStartupUnavailableResult("database_unavailable") };
  const db = dbResult.db;
  const dbPath = dbResult.dbPath;
  let audit: ReturnType<typeof createAuditStore>;
  try {
    audit = createAuditStore(readEnv("AUDIT_PATH") || join(resolveHomeDir(), ".openclaw", "lossless-openclaw-orchestrator", "audit.jsonl"));
  } catch {
    db.close();
    return { ok: false, failure: createStartupUnavailableResult("audit_unavailable") };
  }

  const codexCommand = readEnvWithFallback("CODEX_BIN", "codex");
  const codexArgs = (readEnv("CODEX_APP_SERVER_ARGS") || "app-server --stdio").split(/\s+/).filter(Boolean);
  const codexClient = createCodexAppServerStdioClient({
    command: codexCommand,
    args: codexArgs,
    surface: "control"
  });
  const codexReadClient = createCodexAppServerStdioClient({
    command: codexCommand,
    args: codexArgs,
    surface: "read"
  });


  try {
    runtimeState = {
      ok: true,
      tools: createLooTools({
        db,
        dbPath,
        audit,
        includeAliases: true,
        codexClient,
        codexReadClient
      })
    };
    return runtimeState;
  } catch {
    db.close();
    return { ok: false, failure: createStartupUnavailableResult("tool_registry_unavailable") };
  }
}

function createRuntimeDatabase(): { ok: true; db: ReturnType<typeof createDatabase>; dbPath: string } | { ok: false } {
  try {
    const dbPath = defaultDatabasePath();
    return { ok: true, db: createDatabase({ maintenance: "schema-only" }), dbPath };
  } catch {
    return { ok: false };
  }
}

type StartupFailureCode =
  | "database_unavailable"
  | "audit_unavailable"
  | "tool_registry_unavailable";

function createStartupUnavailableResult(code: StartupFailureCode) {
  const detail = startupFailureDetails(code);
  return {
    schema: "lco.mcp.startupStatus.v1",
    ok: false,
    code,
    classification: "recoverable_setup_error",
    publicSafe: true,
    readOnly: true,
    retryable: true,
    retryPolicy: startupRetryPolicy(),
    message: detail.message,
    nextAction: detail.nextAction,
    blockers: [code],
    sourceCoverage: detail.sourceCoverage,
    actionsPerformed: {
      rawTranscriptRead: false,
      sourceStoreMutation: false,
      externalWrite: false,
      liveControl: false,
      guiMutation: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    privateDataExclusions: ["raw transcripts", "raw prompts", "SQLite rows", "local paths", "raw logs", "tokens", "cookies", "screenshots"],
    proofBoundary: "This packet classifies MCP local startup for a tools/call request only. tools/list stays a static MCP catalog response and does not initialize the local runtime. Startup failures are not cached, so transient setup errors may recover on the next tools/call. It does not read raw transcripts, run live Codex control, mutate a GUI, publish npm, or create a GitHub Release."
  };
}

function startupRetryPolicy() {
  return {
    negativeCache: false,
    retryOn: "next_tools_call",
    persistentFailureCost: "A persistent startup failure re-attempts local startup on each tools/call until the local setup is repaired. tools/list remains a static catalog operation and does not initialize or retry runtime startup."
  };
}

function startupFailureDetails(code: StartupFailureCode): {
  message: string;
  nextAction: string;
  sourceCoverage: Record<string, string>;
} {
  switch (code) {
    case "database_unavailable":
      return {
        message: "Local LCO database is unavailable during MCP startup.",
        nextAction: "Run lco doctor in a shell with a writable HOME/USERPROFILE or set LCO_DB_PATH to a writable local database path, then retry the tool call.",
        sourceCoverage: { localIndex: "unavailable" }
      };
    case "audit_unavailable":
      return {
        message: "Local LCO audit store is unavailable during MCP startup.",
        nextAction: "Set LCO_AUDIT_PATH to a writable local JSONL audit path or repair the OpenClaw LCO config, then retry the tool call.",
        sourceCoverage: { localIndex: "ok", audit: "unavailable" }
      };
    case "tool_registry_unavailable":
      return {
        message: "LCO MCP tool registry is unavailable during startup.",
        nextAction: "Run lco doctor and npm run check from the installed package or repo, then retry the tool call.",
        sourceCoverage: { localIndex: "ok", audit: "ok", toolRegistry: "unavailable" }
      };
  }
}

function readPackageVersion(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(currentDir, "../../../package.json"),
    join(currentDir, "../../../../package.json")
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8"));
      if (typeof parsed.version === "string" && parsed.version.trim()) return parsed.version;
    } catch {
      // Fall through to the next candidate.
    }
  }
  return "0.0.0";
}

function sendToolResult(id: unknown, result: unknown): void {
  send({ id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result } });
}

function send(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("JSON-RPC payload must be an object");
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...payload })}\n`);
}
