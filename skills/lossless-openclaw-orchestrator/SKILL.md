---
name: lossless-openclaw-orchestrator
description: Use LCO from an OpenClaw agent to search, describe, expand, and dry-run local Codex session work without reading raw transcripts.
---

# Lossless OpenClaw Orchestrator

Use this skill when an OpenClaw agent needs to understand or safely manage local
Codex sessions through the installed `loo_*` tools.

## Safety Boundary

- Prefer local `loo_*` tools through the OpenClaw gateway.
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

## Find Active Codex Sessions

1. Call `loo_doctor` to confirm the local DB, Codex stores, and tool readiness.
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

## Recommended Agent Loop

1. `loo_doctor`
2. `loo_search_sessions`
3. `loo_describe_session` or `loo_describe_ref`
4. `loo_codex_plans`, `loo_codex_final_messages`, and
   `loo_codex_touched_files`
5. `loo_expand_session` or `loo_expand_query` with a 1k budget
6. Optionally run `loo_codex_desktop_coherence` when the user asks whether the
   same work is visible in Codex Desktop
7. If Desktop visibility is not proven, run
   `loo_codex_desktop_fallback_status` before recommending CUA/Peekaboo work;
   if it returns `coherence_input_missing`, run the returned coherence call
   first
8. Run `loo_codex_collaboration_cockpit` when the user wants one active-lane
   cockpit summary
9. Recommend a next action with source refs
10. If action is requested, run `loo_codex_control_dry_run`
11. Wait for explicit approval before any live control

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
