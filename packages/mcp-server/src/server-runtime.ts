import { createInterface } from "node:readline";
import { createAuditStore, createCodexAppServerStdioClient } from "../../adapters/src/index.js";
import { createDatabase } from "../../core/src/index.js";
import {
  createLooToolDeclarations,
  createLooTools,
  filterLooToolsByProfile,
  parseLooToolProfile,
  type LooTool
} from "./tools.js";

const toolProfile = parseLooToolProfile(process.env.LOO_TOOL_PROFILE, {
  onInvalid: (value) => {
    process.stderr.write(`Invalid LOO_TOOL_PROFILE=${JSON.stringify(value)}; falling back to all.\n`);
  }
});
const toolDeclarations = createLooToolDeclarations({ includeAliases: true });
const SERVER_VERSION = "1.0.0";
type StartupFailure = ReturnType<typeof createDatabaseUnavailableResult> | ReturnType<typeof createStartupUnavailableResult>;
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
      send({ id: message.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "lossless-openclaw-orchestrator", version: SERVER_VERSION }, capabilities: { tools: {} } } });
    } else if (message.method === "tools/list") {
      send({
        id: message.id,
        result: {
          runtimeStatus: createToolsListRuntimeStatus(),
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
    send({ id: messageId, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
  }
});

function getRuntimeState(): RuntimeState {
  if (runtimeState) return runtimeState;
  const dbResult = createRuntimeDatabase();
  if (!dbResult.ok) return { ok: false, failure: createDatabaseUnavailableResult() };
  const db = dbResult.db;
  try {
    const audit = createAuditStore(process.env.LOO_AUDIT_PATH || `${process.env.HOME || "."}/.openclaw/lossless-openclaw-orchestrator/audit.jsonl`);
    runtimeState = {
      ok: true,
      tools: createLooTools({
        db,
        audit,
        includeAliases: true,
        codexClient: createCodexAppServerStdioClient({
          command: process.env.LOO_CODEX_BIN || "codex",
          args: (process.env.LOO_CODEX_APP_SERVER_ARGS || "app-server --stdio").split(/\s+/).filter(Boolean),
          surface: "control"
        }),
        codexReadClient: createCodexAppServerStdioClient({
          command: process.env.LOO_CODEX_BIN || "codex",
          args: (process.env.LOO_CODEX_APP_SERVER_ARGS || "app-server --stdio").split(/\s+/).filter(Boolean),
          surface: "read"
        })
      })
    };
    return runtimeState;
  } catch {
    db.close();
    return { ok: false, failure: createStartupUnavailableResult() };
  }
}

function createToolsListRuntimeStatus() {
  return {
    startup: "lazy",
    database: "unchecked_until_tools_call",
    failureSurface: "tools/call",
    retryPolicy: {
      failedStartupCached: false,
      nextToolCallRechecksDatabase: true
    }
  };
}

function createRuntimeDatabase(): { ok: true; db: ReturnType<typeof createDatabase> } | { ok: false } {
  try {
    return { ok: true, db: createDatabase({ maintenance: "schema-only" }) };
  } catch {
    return { ok: false };
  }
}

function createDatabaseUnavailableResult() {
  return {
    schema: "lco.mcp.startupStatus.v1",
    ok: false,
    code: "database_unavailable",
    classification: "recoverable_setup_error",
    publicSafe: true,
    readOnly: true,
    message: "Local LCO database is unavailable during MCP startup.",
    nextAction: "Run loo doctor in a shell with a writable HOME or set LOO_DB_PATH to a writable local database path, then retry the tool call. The MCP server rechecks database startup on each tool call until one succeeds.",
    blockers: ["database_unavailable"],
    sourceCoverage: { localIndex: "unavailable" },
    retryPolicy: {
      failedStartupCached: false,
      nextToolCallRechecksDatabase: true
    },
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
    proofBoundary: "This packet classifies MCP local database startup only. It does not read raw transcripts, run live Codex control, mutate a GUI, publish npm, or create a GitHub Release."
  };
}

function createStartupUnavailableResult() {
  return {
    schema: "lco.mcp.startupStatus.v1",
    ok: false,
    code: "runtime_unavailable",
    classification: "recoverable_setup_error",
    publicSafe: true,
    readOnly: true,
    message: "Local LCO MCP runtime setup is unavailable after database startup.",
    nextAction: "Check that HOME and LOO_AUDIT_PATH are writable local paths and that LOO_CODEX_BIN/LOO_CODEX_APP_SERVER_ARGS are valid, then retry the tool call.",
    blockers: ["runtime_unavailable"],
    sourceCoverage: { localIndex: "available", runtimeSetup: "unavailable" },
    retryPolicy: {
      failedStartupCached: false,
      nextToolCallRechecksRuntime: true
    },
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
    proofBoundary: "This packet classifies MCP local runtime setup after database startup only. It does not read raw transcripts, run live Codex control, mutate a GUI, publish npm, or create a GitHub Release."
  };
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
