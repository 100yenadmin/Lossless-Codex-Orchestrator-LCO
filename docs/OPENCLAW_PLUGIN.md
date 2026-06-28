# OpenClaw Plugin

The OpenClaw plugin entry lives in `packages/openclaw-plugin`.

The plugin launches the MCP server:

```bash
loo-mcp-server
```

Recommended OpenClaw configuration should expose the `loo_*` tools and keep live controls approval-gated:

- Read tools may run immediately.
- Optional LCM peer recall uses `LOO_LCM_DB_PATHS` or per-call `lcm_db_paths` and opens those DBs read-only.
- Control tools should run `dry_run=true` first.
- Live control requires `approval_audit_id` from the dry-run result.

Claude Code support is an adapter stub in this beta.
