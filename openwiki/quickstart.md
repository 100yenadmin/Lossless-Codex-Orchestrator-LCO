# Quickstart

Welcome to the **Lossless Codex Orchestrator (LCO)** — a local-first memory and command layer for Codex-heavy workflows. LCO indexes your local Codex session JSONL files into a local SQLite database so an orchestrator agent (OpenClaw, Hermes, Cursor, or any MCP client) can search, describe, expand, and dry-run control Codex threads without rereading massive transcripts.

## What LCO Does

| Capability | Description |
| --- | --- |
| **Index** | Parses local Codex JSONL sessions into field-weighted FTS5 search with safe-text extraction. |
| **Search & Recall** | Session-card discovery via `lco search`; content-phrase recall via `lco grep` and `lco expand-query`. |
| **Prepared State** | Deterministic prepared cards, inbox, and lifecycle states (completed, waiting, blocked, stale, etc.). |
| **Bounded Expansion** | 1k-token briefs and 4k-token evidence bundles instead of loading entire transcripts. |
| **Operating Picture** | Attention inbox, project digest, collaboration cockpit, active-thread state, autonomy tick planning. |
| **Dry-Run Control** | Approval-gated dry-run command packets for Codex start/resume/send/steer/interrupt before live execution. |
| **Multi-Surface** | Same local registry exposed through CLI, MCP server, and OpenClaw plugin. |

## Install

```bash
npm install -g lossless-codex-orchestrator@latest
lco doctor
lco index codex --max-files 500 "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

Requirements: Node.js 22.5+, npm, local Codex session files (typically `~/.codex/sessions`).

`lossless-codex-orchestrator` is the current published package name. The deprecated compat package `lossless-openclaw-orchestrator` and the historical `loo`/`LOO_*` CLI/env aliases remain maintained.

## First Recall Loop

```bash
# Search title, metadata, aliases, and session-card signals
lco search "proposed plan billing bridge"

# Search remembered content phrases
lco grep "aurora ledger checkpoint"

# Describe a result
lco describe codex_thread:<thread-id>

# Expand a bounded brief
lco expand-ref --profile brief --token-budget 1000 codex_thread:<thread-id>
```

## Key Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `LCO_DB_PATH` | `~/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite` | Local SQLite database location |
| `LCO_LCM_DB_PATHS` | (none) | Read-only OpenClaw LCM peer DB paths |
| `LCO_TOOL_PROFILE` | `all` | MCP/OpenClaw tool listing filter: `facade`, `standard`, or `all` |
| `LCO_TELEMETRY` | (off) | Set to `1` for opt-in local retrieval telemetry |
| `LCO_CODEX_BIN` | `codex` | Codex CLI binary for transport status |

All `LCO_*` env names have `LOO_*` compatibility fallbacks. See `packages/runtime/src/env.ts`.

## Documentation Sections

- [Architecture](architecture.md) — Package structure, data flow, SQLite schema, FTS search, tool tiers.
- [Workflows](workflows.md) — Agent-facing workflows: index, search, describe, expand, prepared state, dry-run control, hooks.
- [Safety & Privacy](safety-and-privacy.md) — Approval gates, method policy, privacy model, safe summaries, redaction.
- [Operations](operations.md) — Release runbook, QA Lab, claim tiers, CI, npm publish, dogfood smoke.
- [Testing & Evals](testing-and-evals.md) — Test structure, eval scenarios, retrieval goldens, scorecards.

## Key Source Files

| Area | Entry point |
| --- | --- |
| Core (DB, indexing, search, prepared state) | `packages/core/src/index.ts` |
| Search engine (FTS5, BM25, field weights) | `packages/core/src/search.ts` |
| Adapters (Codex JSON-RPC, desktop, policy, redaction) | `packages/adapters/src/index.ts` |
| MCP server tool registry | `packages/mcp-server/src/tools.ts` |
| CLI dispatch | `packages/cli/src/main.ts` |
| OpenClaw plugin entry | `packages/openclaw-plugin/src/index.ts` |
| Runtime env helpers | `packages/runtime/src/env.ts` |
| Agent skill playbook | `skills/lossless-openclaw-orchestrator/SKILL.md` |

## Important Caveats

- **LCO is local-only.** It does not cloud-sync, upload raw transcripts, or merge Codex transcripts into OpenClaw LCM.
- **Live Codex control is approval-gated.** Every resume/send/steer/interrupt requires a matching dry-run packet and `approval_audit_id`.
- **Claude Code is adapter-stub only** in the current beta. Use Codex-first claims.
- **Codex JSONL drift** is reported by `lco doctor` as a bounded completeness caveat, not an error. See `docs/CODEX_JSONL_DRIFT.md`.
- **`lco search` is not raw-content search.** For remembered content phrases, use `lco grep` or `lco expand-query`.

## Further Reading

- [Setup Guide](../docs/SETUP.md) — Detailed install and first-run instructions.
- [README](../README.md) — Public product landing page.
- [AGENTS.md](../AGENTS.md) — Repository agent instructions and release gates.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Issue routing, PR expectations, validation.
- [VISION.md](../VISION.md) — Product and eval truth.
- [Privacy Model](../docs/PRIVACY.md) — Mutation classes and non-goals.
