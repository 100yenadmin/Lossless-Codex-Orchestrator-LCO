# OpenClaw Plugin

The OpenClaw plugin source entry lives in `packages/openclaw-plugin`.

The root npm package is the OpenClaw install source. Its packageable plugin manifest is `openclaw.plugin.json`, and `package.json` points OpenClaw at the TypeScript source plus the compiled runtime entry `dist/packages/openclaw-plugin/src/index.js` for package installs.

The installed plugin declares native `loo_*` tool wrappers backed by the same local registry used by the MCP server. The package also ships the MCP server for clients that connect over stdio:

```bash
loo-mcp-server
```

Agent-facing usage guidance lives in
[`skills/lossless-openclaw-orchestrator/SKILL.md`](../skills/lossless-openclaw-orchestrator/SKILL.md).
Use that playbook when an OpenClaw orchestrator needs the safe staged workflow:
doctor, search, describe, bounded expand, plan/final/file lookup, recommendation,
and approval-gated dry-run before live Codex control.

Before beta release, dogfood the local OpenClaw plugin path from an isolated profile:

```bash
loo openclaw dogfood --profile lco-dogfood --install-source . --link --evidence-path /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-44-local-openclaw-gateway-dogfood/plugin-load.json --strict
```

This command wraps `openclaw plugins list --json` plus runtime inspection into a public-safe status report. It records only loaded/enabled state, required `loo_*` tool coverage, blocker codes, and install/list exit status. It does not write raw OpenClaw plugin JSON, raw Codex transcripts, expanded text, local SQLite contents, screenshots, tokens, or credentials.

Milestone 7 raises the bar from declaration proof to working-app proof. Issue
[#158](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/158)
must prove one approved harmless live Codex action through the installed
OpenClaw gateway path, and
[#159](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/159)
must prove post-action refresh and safe source-ref-based reasoning. Tool
declaration, package install, and dry-run audit proof are necessary but no
longer sufficient for a working-app claim.

Recommended OpenClaw configuration should expose the `loo_*` tools and keep live controls approval-gated:

- Read tools may run immediately.
- Optional LCM peer recall uses `LOO_LCM_DB_PATHS` or per-call `lcm_db_paths` and opens those DBs read-only.
- Control tools should run `dry_run=true` first.
- Live control requires `approval_audit_id` from the dry-run result.
- Dry-run output includes `params_hash` and message-bearing actions include `message_hash`; agents should echo those local keyed fingerprints before asking the user to approve live control.
- `loo_audit_tail` returns recent fingerprinted audit records without raw prompt text.
- `loo_desktop_see` may inspect CUA/Peekaboo readiness, but it must not perform GUI actions.
- `loo_desktop_act` remains dry-run-only until backend-specific approval and permission proof exist. Live-mode requests return structured blockers for missing backend, target app/window, action text, action hash, approval ref, permission state, focus before/after, public-safe observation fields, or a mismatched action hash.
- `loo_desktop_live_proof_harness` prepares a public-safe live/no-focus proof packet and fails closed until backend, target app/window, action, approval ref, backend availability, and no-focus status-probe fields are present. It does not perform the GUI action or capture screenshots.
- `loo_desktop_proof_report` validates a supplied public-safe desktop GUI action observation and may return release-compatible approval proof. The tool does not perform the GUI action itself and does not prove backend behavior without a real observation.
- CUA Driver is the preferred desktop fallback and its default launch shape is MCP stdio via `cua-driver mcp`; binary availability is reported separately from launch readiness, and agents must not claim no-focus behavior unless the returned focus proof says it was measured.
- Peekaboo snapshot observation must be explicit (`include_snapshot=true` or CLI `--snapshot`), must use local `--no-remote` commands, and must block sensitive frontmost apps before capture.
- Visible Codex macro metadata is read-only planning guidance; generic prompt typing, send, approve, and click actions remain live-disabled in this beta.
- `visibleCodex.threadMap` is a bounded, redacted visible-thread candidate inventory derived from the guarded snapshot. Treat it as GUI evidence only, not as a raw transcript join or approval to mutate the Codex UI.
- `visibleCodex.windows` and `visibleCodex.threadMap` are emitted only when the guarded snapshot identifies Codex as the captured app; safe non-Codex snapshots must not be reinterpreted as Codex UI state.
- `loo_codex_app_server_status` and `loo_codex_app_server_threads` use the read-only Codex app-server surface. Thread probes must omit preview, cwd, path, and turns, and must never call `includeTurns:true`. Loaded-thread state is reported as `not_claimed_one_shot_client` unless the caller supplies an explicit same-connection source.
- `loo_visible_codex_map` is the orchestrator-facing correlation surface. It may join indexed session cards, sanitized visible title/status metadata, and read-only app-server thread signals with confidence and ambiguity markers; it must not select, focus, continue, click, type, enable remote control, or mutate Codex Desktop.
- `loo_codex_desktop_coherence` is the proof classifier for #307. It distinguishes `cli_visible`, `desktop_visible`, `desktop_refresh_required`, `desktop_restart_required`, and `unknown` from supplied or generated public-safe map evidence; it does not run live control, refresh/restart Codex Desktop, select a thread, click, type, or mutate the GUI.
- `loo_codex_desktop_fallback_status` is the #308 handoff surface. It reports CUA-first and Peekaboo-secondary readiness, blockers, focus status, and screen-takeover warnings for a target thread without performing Codex GUI action, live control, screenshot capture, refresh, restart, click, select, or type. If the caller supplies only a target and omits coherence evidence, the report returns `coherence_input_missing` and the exact `loo_codex_desktop_coherence` args to run first.
- `loo_codex_collaboration_next_steps` is the #326 planner surface. It turns cockpit/coherence/fallback/watcher state into exact read-only tool-call packets with `execute=false`; it does not approve or perform live Codex control, Desktop refresh/restart, GUI mutation, screenshot capture, npm publish, or GitHub Release creation.

Claude Code support is an adapter stub in this beta.
