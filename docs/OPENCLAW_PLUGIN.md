# OpenClaw Plugin

The OpenClaw plugin source entry lives in `packages/openclaw-plugin`.

First-run user setup lives in [`docs/SETUP.md`](SETUP.md). This page is the
operator reference for how the packaged OpenClaw plugin is shaped and how to
verify it.

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

Public install path:

```bash
npm install -g lossless-openclaw-orchestrator@latest
openclaw plugins install lossless-openclaw-orchestrator@latest
```

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

Recommended OpenClaw configuration should expose the `loo_*` tools and keep live controls approval-gated.

Tool declarations include a `metadata.tier` value so agents can distinguish the
compact operator path from detail, proof, and low-level recovery surfaces:

- `public_facade`: the normal 8-tool operator path:
  `loo_prepared_inbox`, `loo_describe_ref`, `loo_expand_query`,
  `loo_recent_sessions`, `loo_attention_inbox`, `loo_project_digest`,
  `loo_codex_control_dry_run`, and `loo_codex_resume_thread`.
- `workflow_detail`: supporting read/detail/setup/control tools that a facade
  result may route to.
- `proof_debug`: safety, proof, fallback, sanitizer, permission, and audit
  tools for diagnosis and release evidence.
- `internal_low_level`: direct store or protocol probes that should stay
  explicit and bounded.

New tools must choose one tier in the shared registry before they can pass the
manifest snapshot test. The tier metadata is advisory routing metadata only: it
does not hide tools, relax `requiresApproval`, change `safety.mode`, alter
`mutationClasses`, or reduce proof obligations.

Naming policy for #434: `LCO` is the product abbreviation and `lco_*` is the
forward public alias target for new user-facing tool names. The currently
callable plugin and MCP declarations still use the historical `loo_*` runtime
prefix, so runnable examples must keep `loo_*` until a tested alias layer
exists. Future alias work should keep `loo_*` backward compatible instead of
silently renaming or deleting existing tools. This docs/manifest pass does not
create a broad `lco_*` alias layer; that compatibility work belongs with
[#434](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/434).

Safety details:

- Read tools may run immediately.
- Each shared tool declaration includes a `safety` object with `mode`, `source`,
  `requiresApproval`, and `mutationClasses`. Empty `mutationClasses` means a
  pure read. `mode: "local_cache_write"` plus `derived_cache` means LCO updates
  only its own local cache or audit state; it is still not Codex source-store
  mutation, external mutation, live control, or GUI mutation.
- Optional LCM peer recall uses `LOO_LCM_DB_PATHS` or per-call `lcm_db_paths` and opens those DBs read-only.
- Control tools should run `dry_run=true` first.
- Live control requires `approval_audit_id` from the dry-run result.
- Dry-run output includes `params_hash` and message-bearing actions include `message_hash`; agents should echo those local keyed fingerprints before asking the user to approve live control.
- `loo_audit_tail` returns recent fingerprinted audit records without raw prompt text.
- `loo_desktop_see` may inspect CUA/Peekaboo readiness, but it must not perform GUI actions.
- `loo_desktop_act` remains dry-run-only until backend-specific approval and permission proof exist. Live-mode requests return structured blockers for missing backend, target app/window, action text, action hash, approval ref, permission state, focus before/after, public-safe observation fields, or a mismatched action hash.
- `loo_desktop_live_proof_harness` prepares a public-safe live/no-focus proof packet and fails closed until backend, target app/window, action, approval ref, backend availability, and no-focus status-probe fields are present. It does not perform the GUI action or capture screenshots.
- `loo_desktop_proof_report` validates a supplied public-safe desktop GUI action observation and may return release-compatible approval proof. The tool does not perform the GUI action itself and does not prove backend behavior without a real observation.
- CUA Driver is the preferred/default desktop fallback when fallback is needed, and its default launch shape is MCP stdio via `cua-driver mcp`. It is externally installed rather than bundled by LCO; missing CUA is a desktop-fallback readiness blocker, not a blocker for ordinary read/search/describe workflows. Binary availability is reported separately from launch readiness, CUA daemon permissions must be checked separately from Terminal permissions, and agents must not claim no-focus behavior unless the returned focus proof says it was measured.
- CUA action-bound Codex fallback smoke must verify the inserted composer value before send. A `type_text` success payload alone is not enough proof for Electron/Codex composer writes; use a read-back value check before any approved send.
- Peekaboo snapshot observation must be explicit (`include_snapshot=true` or CLI `--snapshot`), must use local `--no-remote` commands, and must block sensitive frontmost apps before capture.
- Visible Codex macro metadata is read-only planning guidance; generic prompt typing, send, approve, and click actions remain live-disabled in this beta.
- `visibleCodex.threadMap` is a bounded, redacted visible-thread candidate inventory derived from the guarded snapshot. Treat it as GUI evidence only, not as a raw transcript join or approval to mutate the Codex UI.
- `visibleCodex.windows` and `visibleCodex.threadMap` are emitted only when the guarded snapshot identifies Codex as the captured app; safe non-Codex snapshots must not be reinterpreted as Codex UI state.
- `loo_codex_app_server_status` and `loo_codex_app_server_threads` use the read-only Codex app-server surface. Thread probes must omit preview, cwd, path, and turns, and must never call `includeTurns:true`. Loaded-thread state is reported as `not_claimed_one_shot_client` unless the caller supplies an explicit same-connection source.
- `loo_visible_codex_map` is the orchestrator-facing correlation surface. It may join indexed session cards, sanitized visible title/status metadata, and read-only app-server thread signals with confidence and ambiguity markers; it must not select, focus, continue, click, type, enable remote control, or mutate Codex Desktop.
- `loo_codex_desktop_coherence` is the proof classifier for #307. It distinguishes `cli_visible`, `desktop_visible`, `desktop_refresh_required`, `desktop_restart_required`, and `unknown` from supplied or generated public-safe map evidence; it does not run live control, refresh/restart Codex Desktop, select a thread, click, type, or mutate the GUI.
- `loo_codex_desktop_fallback_status` is the #308 handoff surface. It reports CUA-first and Peekaboo-secondary readiness, blockers, focus status, and screen-takeover warnings for a target thread without performing Codex GUI action, live control, screenshot capture, refresh, restart, click, select, or type. If the caller supplies only a target and omits coherence evidence, the report returns `coherence_input_missing` and the exact `loo_codex_desktop_coherence` args to run first.
- `loo_codex_collaboration_next_steps` is the #326 planner surface. It turns cockpit/coherence/fallback/watcher state into exact read-only tool-call packets with `execute=false`; it does not approve or perform live Codex control, Desktop refresh/restart, GUI mutation, screenshot capture, npm publish, or GitHub Release creation.
- `loo_codex_desktop_collaboration_proof` is the #333 action-bound proof contract. It validates an exact Codex thread/source ref, backend, target app/window, action label, action hash, approval packet, source coverage, freshness, and no-screenshot policy, then returns a public-safe blocked/ready report plus an `execute=false` `loo_desktop_live_proof_harness` packet. It fails closed for generic click/type/send/continue requests and does not perform Desktop action, live Codex control, screenshots, npm publish, or GitHub Release creation.
- `loo_codex_runtime_desktop_visibility_status` is the #342 lane-level status surface. It summarizes whether active collaboration cockpit lanes are covered, partial, or blocked by public-safe Desktop visibility/proof evidence and returns exact next read-only proof tool calls with `execute=false`; it does not run live Codex control, refresh/restart Desktop, mutate the GUI, capture screenshots, publish npm, or create GitHub releases.
- `loo_codex_active_thread_state` is the #351/#359/#367 active-state surface. It classifies active cockpit lanes as running, blocked, needs-nudge, stale, waiting, approval-needed, idle, or unknown from public-safe indexed cards, watcher records, optional app-server status, and optional visible-map coverage. Each item includes `attentionCoverage` so agents can see whether the state is covered, partial, or needs a read-only probe, plus any `nextReadOnlyAction` with `execute:false`; core coverage gaps route to `loo_recent_sessions` or `loo_cockpit_inbox`, app-server gaps route to `loo_codex_app_server_threads`, and visible-map gaps route to `loo_visible_codex_map`. Attention coverage uses a display floor of `0.1` for zero-confidence probe cards and emits `attention_confidence_floor_applied` when that floor is applied. Needs-nudge/approval lanes may include a `nextControlDryRun` packet for `loo_codex_control_dry_run` with `execute:false`; the packet does not mint an audit id or authorize live control. Conflicting signals degrade to `unknown`/low confidence; the tool never reads raw transcripts, runs live control, mutates Codex Desktop, captures screenshots, publishes npm, or creates GitHub releases.
- `loo_prepared_state_status` accepts an optional `thread_id` for targeted active-thread coverage. When global prepared cache is populated but the requested thread is missing prepared rows, the tool reports public-safe `targetCoverage` with opaque refs, freshness, missing-layer coverage, and reason codes such as `source_present_not_indexed` or `active_session_pending_index`; it does not expose transcript paths, raw text, app-server previews, Desktop state, live control, or GUI mutation proof.
- `loo_codex_autonomy_tick` is the #371 deterministic tick planner. It composes the active-thread state report into ordered `execute:false` next tool calls, putting read-only probes before control dry-run recommendations for the same lane. `priority_order` influences upstream active-lane selection; final tick ordering is safety-first by step type, active-state priority, urgency, and stable tie-breaks. It emits priority, idempotency key, source coverage, confidence, reason codes, evidence ids, stop conditions, and approval boundaries where relevant; it does not execute the tool call, mint approval ids, run live control, mutate Codex Desktop, capture screenshots, publish npm, or create GitHub releases.
- `loo_codex_start_thread` is the approval-gated new-thread workflow. It is dry-run by default, requires the matching `approval_audit_id` for live `thread/start`, and reports `proof_state` so callers can distinguish `accepted_by_transport`, `started`, `completed`, `persisted`, and `unverified_pending`. An `unverified_pending` result is not durable execution or local-session persistence; callers must run the returned read-only `next_proof` packet before building follow-up claims.

Claude Code support is an adapter stub in this beta.
