// OpenClaw provides this SDK module when loading plugin entries.
// @ts-expect-error OpenClaw plugin SDK is a runtime peer supplied by OpenClaw.
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import {
  createAuditStore,
  createCodexAppServerStdioClient,
  type AuditStore,
  type CodexClient
} from "../../adapters/src/index.js";
import { createDatabase, type LooDatabase } from "../../core/src/index.js";
import {
  createLooToolDeclarations,
  executeLooToolForOpenClaw,
  createLooTools,
  type LooTool
} from "../../mcp-server/src/tools.js";

export const pluginMetadata = {
  id: "lossless-openclaw-orchestrator",
  name: "Lossless OpenClaw Orchestrator",
  description: "Control and collaborate with local Codex sessions through OpenClaw using local indexing, bounded recall, and approval-gated controls.",
  kind: "tool",
  mcp: {
    command: "loo-mcp-server",
    transport: "stdio"
  },
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {}
  },
  safety: {
    localOnlyByDefault: true,
    liveControlRequires: ["dry_run", "approval_audit_id"],
    forbiddenClaims: ["Full Claude Code parity", "cloud sync", "unattended desktop takeover", "bypasses Codex permissions"]
  }
};

type NativeRuntime = {
  db: LooDatabase;
  audit: AuditStore;
  codexClient: CodexClient;
  codexReadClient: CodexClient;
  tools: LooTool[];
};

type NativeToolFactory = (definition: {
  name: string;
  description: string;
  metadata: LooTool["metadata"];
  parameters: Record<string, unknown>;
  execute(input: unknown): Promise<unknown>;
}) => unknown;

let nativeRuntime: NativeRuntime | null = null;

export default defineToolPlugin({
  id: pluginMetadata.id,
  name: pluginMetadata.name,
  description: pluginMetadata.description,
  configSchema: pluginMetadata.configSchema,
  tools: (tool: NativeToolFactory) => createLooToolDeclarations().map((declaration) => tool({
    name: declaration.name,
    description: declaration.description,
    metadata: declaration.metadata,
    parameters: declaration.inputSchema,
    async execute(input: unknown) {
      const runtimeTool = getNativeRuntime().tools.find((candidate) => candidate.name === declaration.name);
      if (!runtimeTool) throw new Error(`Unknown LOO tool: ${declaration.name}`);
      return await executeLooToolForOpenClaw(runtimeTool, asRecord(input));
    }
  }))
});

function getNativeRuntime(): NativeRuntime {
  if (nativeRuntime) return nativeRuntime;
  const db = createDatabase();
  const audit = createAuditStore(process.env.LOO_AUDIT_PATH || `${process.env.HOME || "."}/.openclaw/lossless-openclaw-orchestrator/audit.jsonl`);
  const codexClient = createCodexAppServerStdioClient({
    command: process.env.LOO_CODEX_BIN || "codex",
    args: (process.env.LOO_CODEX_APP_SERVER_ARGS || "app-server --stdio").split(/\s+/).filter(Boolean),
    surface: "control"
  });
  const codexReadClient = createCodexAppServerStdioClient({
    command: process.env.LOO_CODEX_BIN || "codex",
    args: (process.env.LOO_CODEX_APP_SERVER_ARGS || "app-server --stdio").split(/\s+/).filter(Boolean),
    surface: "read"
  });
  nativeRuntime = {
    db,
    audit,
    codexClient,
    codexReadClient,
    tools: createLooTools({ db, audit, codexClient, codexReadClient })
  };
  return nativeRuntime;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
