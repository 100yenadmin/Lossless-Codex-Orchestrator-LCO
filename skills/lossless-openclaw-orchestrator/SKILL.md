---
name: lossless-openclaw-orchestrator
description: Use LCO from an OpenClaw agent to search, describe, expand, and dry-run local Codex session work without reading raw transcripts.
---

# Lossless OpenClaw Orchestrator

Use this skill when an OpenClaw agent needs to understand or safely manage local
Codex sessions through the installed `loo_*` tools.

## Safety Boundary

- Prefer local `loo_*` tools through the OpenClaw gateway.
- Treat the compact public facade as the normal path; do not rank every
  declared tool as an equal first step.
- Start with public-safe summaries, metadata, refs, and bounded expansion.
- Do not read raw transcripts when a `loo_*` describe, expand, final, plan, or
  touched-file tool can answer the question.
- Keep LCO local-only unless the user explicitly exports a public-safe report.
- Preserve Codex approval and sandbox gates. OpenClaw approval authorizes the
  requested LCO action only.
- Live resume, send, steer, or interrupt actions require a matching dry-run and
  `approval_audit_id`.
- Claude Code is adapter-stub only in this beta; use Codex-first claims.
- Desktop fallback proof is action-bound; do not claim generic GUI mutation.
- `cli_visible` or app-server-visible is not the same as Codex
  Desktop-visible collaboration. Use `loo_codex_desktop_coherence` before
  making any Desktop visibility claim.
- When Desktop visibility is not proven, use
  `loo_codex_desktop_fallback_status` to inspect CUA-first and
  Peekaboo-secondary readiness before suggesting any visible fallback path.
- Use `loo_codex_collaboration_cockpit` when the user wants one read-only
  active-lane summary across recent cards, inbox urgency, watcher requests, and
  supplied Desktop coherence/fallback evidence.
- Use `loo_codex_collaboration_next_steps` after the cockpit when you need the
  exact next bounded tool call. Its packets are read-only suggestions with
  `execute=false`; do not treat them as approval to run live control or GUI
  actions.
- Use `loo_codex_runtime_desktop_visibility_status` when you need one compact
  lane-level answer about which Codex Desktop collaboration lanes are covered,
  partial, or blocked. Treat any returned next tool call as a read-only
  `execute=false` recommendation, not as approval to mutate the Desktop.
- Use `loo_codex_active_thread_state` when you need one compact read-only answer
  about which active threads are running, blocked, stale, or need a nudge.
  Use `nextControlDryRun` only as a non-executed dry-run handoff; treat
  low-confidence or conflicting states as inspect-first, never as approval to
  send or steer.
- `LCO` is the public product abbreviation and `lco_*` is the forward public
  alias target for new user-facing tool names. Runnable examples and the wider
  catalog use `loo_*`; the public facade also exposes tested `lco_*` aliases
  for the eight normal operator tools, while `loo_*` remains backward-compatible.
- `LOO_TOOL_PROFILE=facade|standard|all` filters MCP/OpenClaw tool listing.
  `facade` lists the compact public path and its `lco_*` aliases, `standard`
  adds workflow-detail tools such as `loo_doctor`, and `all` remains the
  default full catalog.
- `LOO_TELEMETRY=1` enables opt-in retrieval telemetry only for local
  search-to-describe/expand correlation. It writes LCO-owned derived cache,
  requires a telemetry session id for correlation, and does not store raw query
  text.

## Compact Public Facade

Normal agents should start here:

1. `loo_prepared_inbox` for the prepared-state operating picture.
2. `loo_describe_ref` for the specific source ref or Codex thread.
3. `loo_expand_query` for one bounded evidence brief when the ref is not known.
4. `loo_recent_sessions` to refresh recent or active cards after a read or
   approved action.
5. `loo_attention_inbox` for the compact attention queue.
6. `loo_project_digest` for bounded provenance and handoff.
7. `loo_codex_control_dry_run` for exact action hashes and approval packet.
8. `loo_codex_resume_thread` only after the matching dry-run approval id.

Use `workflow_detail`, `proof_debug`, and `internal_low_level` tools only when
the facade output or a proof/debug task gives you a specific reason. Expert
tools remain explicit so blockers, safety state, and proof boundaries can be
inspected instead of hidden behind a single magic command.

## Find Active Codex Sessions

1. Call `loo_doctor` to confirm the local DB, Codex stores, and tool readiness.
   If its `codexJsonlDrift` block reports drift, recall may be incomplete for
   the flagged files: newer Codex event kinds are being observed that the
   parser does not extract yet. Treat that as a caveat on completeness claims,
   not an error.
2. If the index is stale, call `loo_index_sessions` with bounded roots or limits.
3. Call `loo_search_sessions` with a narrow query and a small limit.
4. Prefer returned thread ids, source refs, status, latest timestamp, and safe
   summary fields over raw event text.

## Describe This Session

1. Use `loo_describe_session` for a known `thread_id`.
2. Use `loo_describe_ref` for a source-prefixed ref such as `codex_thread:*`.
3. Summarize status, project, likely objective, blockers, latest assistant
   closeout, and next safe action.

## Expand 1k/4k

1. Use `loo_expand_session` when you already know the `thread_id`.
2. Use `loo_expand_query` when you have a query and want the best matching ref.
3. Use `profile=brief` or `token_budget=1000` for a quick handoff.
4. Use `profile=evidence` or `token_budget=4000` only when the agent needs a
   stronger evidence bundle.
5. Stop expanding once the next action is clear.

## Find Plans, Finals, And Touched Files

Use the Codex detail tools instead of expanding entire sessions:

- `loo_codex_plans` for proposed-plan blocks and plan refs.
- `loo_codex_final_messages` for latest final assistant messages.
- `loo_codex_touched_files` for files likely touched by the session.
- `loo_codex_tool_calls` when tool metadata matters, without reading full tool
  call payloads.
- `loo_codex_session_management_map` when the agent needs the session-management
  view before recommending archive, fork, resume, or handoff.

## Dry-Run Steer, Send, Or Resume

1. Use `loo_codex_control_dry_run` before any control request.
2. Inspect the dry-run target, action, `params_hash`, and any `message_hash`.
3. Ask the user to approve the exact target and action.
4. Only after approval, call the matching live tool with the returned
   `approval_audit_id`.
5. If the live tool reports a missing or mismatched audit id, stop and rerun the
   dry-run.

Typical live tools after approval are `loo_codex_resume_thread`,
`loo_codex_send_message`, `loo_codex_steer_thread`, and
`loo_codex_interrupt_thread`.

## Check Desktop Coherence

1. Use `loo_codex_app_server_status` and `loo_codex_app_server_threads` for
   read-only direct/app-server signals.
2. Use `loo_visible_codex_map` only with public-safe visible metadata; do not
   select, click, type, refresh, restart, or capture screenshots by default.
3. Call `loo_codex_desktop_coherence` with the target `thread_id` or
   `source_ref` and the public-safe map evidence.
4. Treat `desktop_visible` as a proven visibility state only for the supplied
   evidence. Treat `cli_visible`, `desktop_refresh_required`,
   `desktop_restart_required`, and `unknown` as gap states.
5. If visibility is not proven, call `loo_codex_desktop_fallback_status` and
   route blockers to the desktop fallback lane rather than claiming same-session
   Desktop collaboration. If fallback status returns `coherence_input_missing`,
   run the exact `loo_codex_desktop_coherence` `nextToolCall` before retrying
   fallback readiness.
6. Call `loo_codex_collaboration_cockpit` when the next response should combine
   recent cards, inbox urgency, watcher requests, and supplied Desktop evidence
   into one public-safe attention summary.
7. Call `loo_codex_collaboration_next_steps` when you need exact next tool
   packets for watcher resume requests, Desktop coherence, or fallback-status
   checks. Execute nothing from the planner unless a later tool has its own
   approval gate.
8. Call `loo_codex_runtime_desktop_visibility_status` when you need a compact
   covered/partial/blocked status for runtime Desktop visibility across active
   lanes. It reports source coverage and next read-only proof steps only.
9. Call `loo_codex_active_thread_state` when you need active-thread state counts
   and reason codes before recommending attention order. If an item includes
   `nextControlDryRun`, show it as an `execute=false` dry-run recommendation,
   not as a live-control approval.

## Recommended Agent Loop

1. Start with `loo_prepared_inbox`.
2. Use `loo_describe_ref` for the selected inbox/source ref.
3. When resuming a known Codex thread, use `loo_prepared_state_status` with
   `thread_id`; treat `targetCoverage.status=source_present_not_indexed` or
   `active_session_pending_index` as a cache-refresh route, not as a missing
   thread or raw-transcript permission.
4. Use `loo_expand_query` with a 1k budget only when the compact card and
   describe output are not enough.
5. Use `loo_recent_sessions`, `loo_attention_inbox`, or `loo_project_digest`
   to refresh the operating picture or handoff.
6. Use `loo_doctor`, `loo_search_sessions`, `loo_describe_session`,
   `loo_expand_session`, `loo_codex_plans`, `loo_codex_final_messages`, and
   `loo_codex_touched_files`
   only as workflow-detail fallbacks when the facade cannot answer the task.
7. Optionally run `loo_codex_desktop_coherence` when the user asks whether the
   same work is visible in Codex Desktop
8. If Desktop visibility is not proven, run
   `loo_codex_desktop_fallback_status` before recommending CUA/Peekaboo work;
   if it returns `coherence_input_missing`, run the returned coherence call
   first
9. Run `loo_codex_collaboration_cockpit` when the user wants one active-lane
   cockpit summary
10. Run `loo_codex_collaboration_next_steps` when the next action needs an exact
   tool packet instead of prose
11. Run `loo_codex_runtime_desktop_visibility_status` when the user asks what is
   actually covered for Desktop-visible collaboration right now
12. Run `loo_codex_active_thread_state` when the user asks which active Codex
    threads are running, blocked, stale, or need a nudge
13. Recommend a next action with source refs
14. If action is requested, run `loo_codex_control_dry_run`
15. Wait for explicit approval before any live control

## Codex Desktop-First Daily Loop

Use this loop when the user wants the daily Codex operating picture, active
Desktop collaboration state, or a safe next nudge recommendation.

1. Start read-only with `loo_codex_app_server_status`,
   `loo_codex_app_server_threads`, and `loo_visible_codex_map`.
2. Run `loo_codex_desktop_coherence` before any Codex Desktop-visible claim.
   Treat `cli_visible`, `desktop_refresh_required`,
   `desktop_restart_required`, and `unknown` as proof gaps.
3. If coherence exists, use `loo_codex_desktop_fallback_status` for fallback
   readiness. If it returns `coherence_input_missing`, follow the returned
   `nextToolCall` for coherence first.
4. Build the daily attention view with `loo_codex_collaboration_cockpit`,
   `loo_codex_runtime_desktop_visibility_status`,
   `loo_codex_active_thread_state`, and `loo_codex_autonomy_tick`.
5. For `needs_nudge` or `needs_approval`, show `nextControlDryRun` as an
   `execute=false` handoff only. Do not run live control from this packet.
   Treat all autonomy tick steps as recommendations until the requesting user
   separately asks for and approves the exact action.
6. Live control requires the exact dry-run audit id, matching
   `approval_audit_id`, and explicit requesting-user approval for the exact
   target and action.
7. After an approved live action, run post-action refresh before claiming
   success or updating the operating picture.
8. If proof fails, create an issue-ready public-safe packet instead of pasting
   raw logs, raw transcripts, screenshots, or unredacted tool evidence.

## Public-Safe Output Shape

When reporting to a user or another agent, include:

- thread id or source ref
- session title or safe summary
- status and latest timestamp
- proposed plan refs, final-message refs, touched files
- why the selected session matters
- next safe command or dry-run command
- explicit boundaries that remain unproven

Do not include raw prompt text, secrets, cookies, tokens, full transcripts, raw
SQLite rows, screenshots, or unredacted tool payloads.
