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
- Dry-run output includes `params_hash` and message-bearing actions include `message_hash`; agents should echo those local keyed fingerprints before asking the user to approve live control.
- `loo_audit_tail` returns recent fingerprinted audit records without raw prompt text.
- `loo_desktop_see` may inspect CUA/Peekaboo readiness, but it must not perform GUI actions.
- `loo_desktop_act` remains dry-run-only until backend-specific approval and permission proof exist.
- CUA Driver is the preferred desktop fallback and is launched as MCP stdio via `cua-driver mcp` by default; do not claim no-focus behavior unless the returned focus proof says it was measured.

Claude Code support is an adapter stub in this beta.
