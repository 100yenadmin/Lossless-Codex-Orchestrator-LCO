# Local Mac Search UI Contract

This document stages the macOS-only local search UI for Lossless OpenClaw Orchestrator. It is a product and eval contract, not a release-ready macOS app claim.

## Purpose

The UI helps a user search Codex, OpenClaw, and future Claude Code sessions from the same local recall loop that already powers the CLI, MCP server, and OpenClaw plugin. It should make safe summaries, source refs, project/status/priority filters, and bounded expansion easy to use without rendering raw transcripts.

The UI exists after the CLI, MCP, and OpenClaw gateway paths prove the underlying recall loop. It should not outrun the tools or imply unsupported adapter parity.

## Data Contract

The first app shell reads from public-safe `loo_*` surfaces:

- `loo_search_sessions` for bounded search results.
- `loo_grep` for Codex plus optional read-only OpenClaw LCM peer search.
- `loo_describe_session` for metadata and safe summaries.
- `loo_describe_ref` for source-prefixed refs such as `codex_thread:*` and `lcm_summary:*`.
- `loo_expand_query` for bounded brief or evidence profiles.
- `loo_codex_thread_map` for active, blocked, needs-expansion, archive, fork, and resume lanes.
- `loo_codex_plans`, `loo_codex_final_messages`, and `loo_codex_touched_files` for cited detail views.
- `loo_doctor`, `loo_permissions`, and `loo_desktop_see` for status surfaces.

The UI may display copied source refs such as `codex_thread:*`, `codex_event:*`, and `lcm_summary:*`. Copy actions copy refs and public-safe summaries only. They must not copy raw prompts, raw transcript spans, local SQLite rows, screenshots, tokens, cookies, API keys, or credentials.

Every connected proof packet records live tool source metadata: tool source mode, tool surface, live tool names, source refs, selected bounded expansion profile, token budget, and copy source-ref target. Static/sample packets must not be used as proof that the local UI is connected to live tools.

## Required Workflows

- Search indexed sessions by text and show safe summaries, source refs, status, priority, project, updated time, and blocker state.
- Filter by project, status, priority, and blocker.
- Inspect one selected result without raw transcript rendering.
- Copy source refs and selected public-safe summary text for an OpenClaw agent.
- Ask for a bounded expansion profile before showing more detail.
- Show a session-management map that separates active, blocked, needs-expansion, archive, fork, and resume lanes.
- Show CUA and Peekaboo readiness as status surfaces only.
- Show proof-boundary warnings wherever a user might expect live control, Claude parity, one-click install, or release-ready macOS app behavior.

## Prototype Shell Command

The first shippable slice is a static local shell packet, not a signed macOS app:

```sh
loo ui local-mac-search --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-55-local-mac-ui --sample
```

The connected CLI proof path uses the local orchestrator DB through read-only `loo_*` recall surfaces and records live tool source metadata:

```sh
loo ui local-mac-search \
  --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-161-connected-local-ui-proof \
  --live-cli \
  --query "release handoff" \
  --expansion-profile brief \
  --token-budget 1000 \
  --strict
```

When `--runtime-proof-dir` is provided, the connected proof also writes `connected-local-ui-proof-v1-1.runtime-proof.json`. That marker records live tool source, source refs, and public-safe scan state, but the `local_mac_shell_ready` and `public_safe_scan` markers only clear when the shell is actually ready on macOS.

The command writes:

- `local-mac-search-ui.html`: a local prototype shell with filters, safe summaries, source refs, copy-ref controls, expansion profile state, and CUA/Peekaboo status surfaces.
- `local-mac-search-ui-report.json`: a public-safe shell report with blocker codes, required tool names, result counts, copy targets, live tool source metadata, and proof boundary.
- `local-mac-search-ui-scorecard.json`: a run-specific scorecard copy with the shell result and remaining gaps.

Without `--sample` or `--live-cli`, the command intentionally fails closed until the local DB, OpenClaw plugin, and required `loo_*` tools are proven available. This prevents the UI lane from silently falling back to raw file reads.

## Fail-Closed States

The app shell must fail closed when:

- The local DB is unavailable or unreadable.
- Required plugin tools are unavailable.
- The OpenClaw plugin is not loaded.
- The query would require raw transcript access.
- A requested expansion exceeds the bounded profile.
- CUA or Peekaboo cannot provide honest readiness.
- A user asks for GUI mutation without explicit approval and backend-specific proof.

Fail-closed output should explain the blocker code and the CLI/MCP command that can produce diagnostic evidence. It must not silently fall back to raw file reads.

## Safety Boundaries

This UI does not prove:

- one-click install,
- release-ready macOS app packaging,
- signed or notarized app readiness,
- Claude parity,
- unattended desktop takeover,
- GUI mutation,
- live Codex control,
- Peekaboo snapshot safety beyond explicit approved diagnostic use.

CUA Driver scratch-window no-focus proof exists only for one approved TextEdit launch_app action; it does not prove generic GUI mutation, Codex GUI mutation, or broad CUA no-focus behavior.

Any live Codex control still requires dry-run plus `approval_audit_id`. Any GUI mutation requires explicit approval and a separate backend-specific proof path.

## Acceptance Evidence

Public-safe evidence may include:

- command names and exit statuses,
- result counts,
- source refs,
- redacted summaries,
- filter selections,
- blocker codes,
- hashes,
- links to GitHub issues and PRs.

Evidence must not include raw transcripts, raw prompts, local SQLite DBs, screenshots, videos, tokens, credentials, API keys, cookies, or private customer data.
