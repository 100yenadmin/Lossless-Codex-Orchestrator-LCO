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
      send({ id: message.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "lossless-openclaw-orchestrator", version: SERVER_VERSION }, capabilities: { tools: {} } } });
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
  let audit: ReturnType<typeof createAuditStore>;
  try {
    audit = createAuditStore(process.env.LOO_AUDIT_PATH || `${process.env.HOME || "."}/.openclaw/lossless-openclaw-orchestrator/audit.jsonl`);
  } catch {
    db.close();
    return { ok: false, failure: createStartupUnavailableResult("audit_unavailable") };
  }

  const codexCommand = process.env.LOO_CODEX_BIN || "codex";
  const codexArgs = (process.env.LOO_CODEX_APP_SERVER_ARGS || "app-server --stdio").split(/\s+/).filter(Boolean);
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

function createRuntimeDatabase(): { ok: true; db: ReturnType<typeof createDatabase> } | { ok: false } {
  try {
    return { ok: true, db: createDatabase({ maintenance: "schema-only" }) };
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
        nextAction: "Run loo doctor in a shell with a writable HOME or set LOO_DB_PATH to a writable local database path, then retry the tool call.",
        sourceCoverage: { localIndex: "unavailable" }
      };
    case "audit_unavailable":
      return {
        message: "Local LCO audit store is unavailable during MCP startup.",
        nextAction: "Set LOO_AUDIT_PATH to a writable local JSONL audit path or repair the OpenClaw LCO config, then retry the tool call.",
        sourceCoverage: { localIndex: "ok", audit: "unavailable" }
      };
    case "tool_registry_unavailable":
      return {
        message: "LCO MCP tool registry is unavailable during startup.",
        nextAction: "Run loo doctor and npm run check from the installed package or repo, then retry the tool call.",
        sourceCoverage: { localIndex: "ok", audit: "ok", toolRegistry: "unavailable" }
      };
  }
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
