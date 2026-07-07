# Workflows

This page covers the agent-facing workflows that LCO supports, from initial indexing through live Codex control. The canonical agent playbook is [`skills/lossless-openclaw-orchestrator/SKILL.md`](../skills/lossless-openclaw-orchestrator/SKILL.md).

## Core Recall Loop

Every agent workflow follows the same staged path:

```
index → search/grep → describe → expand (1k/4k) → prepared inbox → dry-run → [approved] live control
```

### 1. Index Local Codex Sessions

```bash
lco index codex --max-files 500 "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

- Parses JSONL into SQLite with field-weighted FTS5.
- Default caps: 256 MB / 200k events per file. Override with `--max-bytes-per-file` and `--max-events-per-file`.
- Source-file watermarks skip unchanged files on re-index.
- Drift is reported, not fatal. See [Codex JSONL Drift](../docs/CODEX_JSONL_DRIFT.md).

### 2. Search vs. Grep

LCO distinguishes two recall modes:

| Command | What it searches | Use case |
| --- | --- | --- |
| `lco search "<query>"` | Title, summary, plans, finals, touched files, tool metadata, safe text | Session-card discovery by topic/identifier |
| `lco grep "<phrase>"` | Indexed safe text + read-only LCM peer DBs | Remembered content phrases |
| `lco expand-query "<query>"` | Search then expand best match into a bounded brief | Query-to-evidence in one step |

**Key caveat:** `lco search` is not raw-content search. If you remember a content phrase, use `lco grep` or `lco expand-query`.

### 3. Describe

```bash
lco describe codex_thread:<thread-id>
```

Returns status, project, likely objective, blockers, latest assistant closeout, and next safe action. The MCP equivalent is `lco_describe_ref` which accepts any source-prefixed ref (`codex_thread:*`, `lcm_summary:*`).

### 4. Bounded Expansion

Three profiles control evidence depth:

| Profile | Token budget | Contents |
| --- | --- | --- |
| `metadata` | — | Source refs, ids, counts, timestamps, paths — no expanded content |
| `brief` | 1,000 | Quick status, final message, touched files, first plans |
| `evidence` | 4,000 | Same safe fields with larger budget for plan and evidence detail |

```bash
lco expand-ref --profile brief --token-budget 1000 codex_thread:<thread-id>
lco expand-query --profile evidence --token-budget 4000 "billing bridge"
```

Expansion reports omissions when a brief is intentionally smaller than the underlying session. Stop expanding once the next action is clear.

### 5. Detail Tools (instead of expanding entire sessions)

Use the canonical `lco_codex_extract` tool for focused indexed-session details:

- `kind: "plans"` — Proposed-plan blocks and plan refs.
- `kind: "final_messages"` — Latest final assistant messages.
- `kind: "touched_files"` — Files likely touched by the session.
- `kind: "tool_calls"` — Tool metadata without full payload.

Use `lco_operating_picture` with `kind: "session_management_map"` for session-management views before archive/fork/resume/handoff. Historical `loo_*` folded aliases may exist for these paths, but the canonical registered `lco_*` tools are `lco_codex_extract` and `lco_operating_picture`.

## Prepared State

LCO builds deterministic prepared state from indexed sessions:

### Prepared Cards

Each Codex thread gets a card with:
- Objective, blocker, lifecycle state, next action
- Freshness, confidence, source refs
- Lifecycle states: `completed`, `waiting_for_approval`, `watching_external_check`, `needs_resume`, `dirty_worktree_handoff`, `ready_for_review`, `stale_partial`, `unknown`

### Prepared Inbox

`lco_prepared_inbox` — Execute-false attention inbox listing threads that need action, review, approval, watch, or blocker triage. Agents start here to answer "what needs my attention?"

### Operating Picture Tools

- `lco_recent_sessions` — Recent or active Codex work as compact cards.
- `lco_attention_inbox` — Compact attention queue.
- `lco_project_digest` — Project-level handoff brief from Codex cards, optional GitHub items, plan pins, and source coverage.
- `lco_operating_picture` — Cockpit-style views: session maps, collaboration next steps, active-thread state, autonomy tick planning, GitHub operating items, business pulse cards.
- `lco_operating_picture` with `kind: "collaboration_cockpit"` — One read-only active-lane summary across recent cards, inbox urgency, watcher requests, and Desktop coherence/fallback evidence.
- `lco_operating_picture` with `kind: "collaboration_next_steps"` — Exact next bounded tool call after the cockpit. Read-only `execute=false` suggestions.
- `lco_operating_picture` with `kind: "active_thread_state"` — Compact read-only answer about which active threads are running, blocked, stale, or need a nudge.

## Dry-Run and Live Control

### Dry-Run Boundary

Live Codex control (resume, send, steer, interrupt) is **always** preceded by a dry-run packet:

1. `lco_codex_control_dry_run` — Produces exact target, action, message hash, and `approval_audit_id`.
2. The orchestrator agent shows the packet for approval.
3. Only after matching approval, `lco_codex_resume_thread` (or equivalent) executes the live action.

The dry-run packet includes:
- Exact thread ID and action
- Message hash
- `approval_audit_id` (HMAC-bound)
- `expected_turn_id` for turn-bound safety

### Method Policy

| Surface | Methods | Safety |
| --- | --- | --- |
| Read | `thread/list`, `thread/read`, `config/read`, etc. | Read-only, no approval needed |
| Control | `thread/start`, `thread/resume`, `turn/start`, `turn/steer`, `turn/interrupt` | Requires dry-run + approval |
| Forbidden | `thread/fork`, `thread/archive`, `thread/delete`, `fs/writeFile`, `command/exec`, etc. | Blocked entirely |

See `packages/adapters/src/policy.ts` for the full method sets.

## Hook Sidecars

LCO provides hook sidecar commands for session lifecycle capture:

| Hook | Command | Purpose |
| --- | --- | --- |
| Closeout capture | `lco hook closeout-capture` | Captures closeout envelope after session end |
| State prep | `lco hook state-prep` | Prepares state before a turn |
| Compaction marker | `lco hook compaction-capture` | Captures compaction markers (pre/post compact) |
| Thread title finalizer | `lco hook thread-title-finalize` | One-shot thread title alias generation |

The Codex Stop hook (`hooks/hooks.json`) runs `thread-title-finalize.mjs` automatically after assistant stops.

## Watchers

LCO supports watcher specs for monitoring external checks:
- `createWatcherStatusReport()` — Status of watched threads.
- `persistWatcherObservations()` / `getWatcherEvents()` — Event history.
- `createResumeRequestPacket()` — Bounded resume request with TTL and recommended action.

## Desktop Fallback

When Codex Desktop collaboration is not directly visible, LCO provides:

- `lco_desktop_proof` with `check: "coherence"` — Check Desktop visibility before making any Desktop visibility claim.
- `lco_desktop_proof` with `check: "fallback_status"` — Inspect CUA-first and Peekaboo-secondary readiness.
- `lco_desktop_proof` with `check: "see"` / `lco_desktop_act` — Desktop see/proof and dry-run action paths.

**Caveat:** Desktop fallback proof is action-bound. Do not claim generic GUI mutation. `cli_visible` or app-server-visible is not the same as Codex Desktop-visible collaboration.

## Agent Skill Playbook

The full agent-facing playbook is in [`skills/lossless-openclaw-orchestrator/SKILL.md`](../skills/lossless-openclaw-orchestrator/SKILL.md). Key principles:

1. Start with the compact public facade (8 tools).
2. Prefer `lco_*` describe/expand/extract tools over reading raw transcripts.
3. Keep LCO local-only unless the user explicitly exports a public-safe report.
4. Preserve Codex approval and sandbox gates.
5. Live resume/send/steer/interrupt require matching dry-run and `approval_audit_id`.
6. Use `workflow_detail`, `proof_debug`, and `internal_low_level` tools only when the facade output or a proof/debug task gives a specific reason.
