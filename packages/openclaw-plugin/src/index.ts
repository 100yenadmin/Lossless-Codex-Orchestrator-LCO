export const plugin = {
  id: "lossless-openclaw-orchestrator",
  name: "Lossless OpenClaw Orchestrator",
  description: "Control and collaborate with local Codex sessions through OpenClaw using local indexing, bounded recall, and approval-gated controls.",
  kind: "tool",
  mcp: {
    command: "loo-mcp-server",
    transport: "stdio"
  },
  safety: {
    localOnlyByDefault: true,
    liveControlRequires: ["dry_run", "approval_audit_id"],
    forbiddenClaims: ["Full Claude Code parity", "cloud sync", "unattended desktop takeover", "bypasses Codex permissions"]
  }
};

export default plugin;
