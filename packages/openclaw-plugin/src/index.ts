// OpenClaw provides this SDK module when loading plugin entries.
// @ts-expect-error OpenClaw plugin SDK is a runtime peer supplied by OpenClaw.
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

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

export default defineToolPlugin({
  id: pluginMetadata.id,
  name: pluginMetadata.name,
  description: pluginMetadata.description,
  configSchema: pluginMetadata.configSchema,
  tools() {
    // Native OpenClaw tools are intentionally empty in this beta.
    // Tool execution is provided through the packaged MCP server declared
    // in openclaw.plugin.json.
    return [];
  }
});
