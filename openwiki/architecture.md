# Architecture

LCO is a TypeScript monorepo compiled to a single npm package. All source compiles into `dist/`. The npm package exposes canonical `lco` and `lco-mcp-server` bins, plus maintained `loo` and `loo-mcp-server` compatibility aliases; the OpenClaw plugin entry is packaged separately through `openclaw.plugin.json`.

## Package Structure

```
packages/
  core/         — SQLite database, Codex JSONL indexer, FTS5 search, prepared state, summary leaves
  adapters/     — Codex JSON-RPC client, desktop backend, method policy, redaction, audit store
  mcp-server/   — MCP tool registry (35 canonical lco_* tools plus loo_* compatibility aliases), tool tiers, alias management
  cli/          — CLI dispatch, release/QA gates, smoke harnesses, onboarding
  openclaw-plugin/ — OpenClaw plugin entry (defineToolPlugin wrapper)
  runtime/      — Env helpers, Node.js version guard
  local-mac-ui/ — macOS local search UI shell (CUA/Peekaboo integration)
```

### Dependency flow

```
runtime/env.ts  ←  core/index.ts  ←  mcp-server/tools.ts  ←  openclaw-plugin/index.ts
                        ↑                     ↑
                   adapters/index.ts     cli/main.ts (also imports adapters, core, local-mac-ui)
```

The core package has zero adapter-specific hardcoding. The MCP server and CLI are adapter-neutral. The OpenClaw plugin is one adapter over the same shared runtime.

## Core Package (`packages/core/src/`)

The core is the largest source file in the repo (`index.ts`, ~668k). It contains:

### Database

- `createDatabase()` — Opens a `node:sqlite` `DatabaseSync` connection, runs migrations, sets WAL mode and foreign keys.
- Default path: `~/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite` (overridable via `LCO_DB_PATH`).
- Schema includes `codex_sessions`, `codex_search_fts` (FTS5), source-file watermarks, prepared source ranges, summary leaves, watcher events, and audit records.

### Indexing

- `indexCodexSessions(db, options)` — Parses Codex JSONL files into the local DB. Supports `maxFiles`, `maxBytesPerFile` (default 256 MB), `maxEventsPerFile` (default 200k).
- `indexClaudeSessions(db, options)` — Parses local Claude Code JSONL files into `claude_sessions` and `claude_safe_text_fts`, producing `claude_session:*` refs routed through the same describe/expand path as Codex. Read/recall only; no live control or settings mutation. See `docs/CLAUDE_ADAPTER_BOUNDARY.md`.
- Handles envelope records (`{ type, payload }`), transparent envelopes (`response_item`, `event_msg`, `session_meta`, etc.), and legacy inline records.
- Produces a `driftReport` when unknown event kinds or unparsed lines are encountered (fail-soft, not fail-closed).
- Source-file watermarks prevent re-indexing unchanged files.
- Database maintenance (`runDatabaseMaintenance()`) supports checkpoint, analyze, and guarded VACUUM via `lco maintenance`.

### Search (`search.ts`)

Field-weighted FTS5 search over seven fields:

| Field | BM25 Weight |
| --- | --- |
| `title` | 8.0 |
| `plans` | 6.0 |
| `finals` | 6.0 |
| `summary` | 4.0 |
| `touched_files` | 3.0 |
| `tool_meta` | 2.0 |
| `body` | 1.0 |

Ranking blends BM25 text score, recency, and identifier matching. FTS term cap is 32 terms. The search path is synchronous SQLite — there is no hard CPU-query interrupt; busy locks return a `database_busy` recovery packet.

### Prepared State

- `materializePreparedCards()` / `getPreparedCards()` / `getPreparedInbox()` — Deterministic prepared cards with objective, blocker, lifecycle state, next action, freshness, confidence, and source refs.
- `PREPARED_CARD_STATES` — Lifecycle states: `completed`, `waiting_for_approval`, `watching_external_check`, `needs_resume`, `dirty_worktree_handoff`, `ready_for_review`, `stale_partial`, `unknown`.

### Summary Leaves

- Sessions are split into source ranges and deterministic summary leaves (`user_prompt`, `plan`, `final_message`, `closeout`, `touched_files`, `tool_meta`, `compaction_marker`).
- Agents can expand a 1k-token brief or 4k-token evidence bundle instead of loading a full transcript.

### Supporting modules

- `session-sanitizer.ts` — Detects and repairs privacy/safety issues in indexed safe text.
- `agent-provenance.ts` — Parses agent provenance markers from session text.
- `model-compaction-canary.ts` — Local model compaction detection.

## Adapters Package (`packages/adapters/src/`)

### Codex JSON-RPC (`codex-jsonrpc.ts`)

Stdio-based JSON-RPC client for the Codex app server. Handles `initialize`, `tools/list`, `tools/call`, turn resolution, and notification routing.

### Method Policy (`policy.ts`)

Three method surfaces:
- **`CODEX_READ_METHODS`** — Read-only methods like `thread/list`, `thread/read`, `config/read`.
- **`CODEX_CONTROL_METHODS`** — Live control methods: `thread/start`, `thread/resume`, `turn/start`, `turn/steer`, `turn/interrupt`.
- **`CODEX_FORBIDDEN_METHODS`** — Blocked methods including `thread/fork`, `thread/archive`, `thread/delete`, `fs/writeFile`, `command/exec`, `config/value/write`, and all remote-control pairing methods.

### Desktop backend

- `desktopSee()` / `desktopActDryRun()` — CUA Driver and Peekaboo integration for macOS desktop fallback.
- Desktop proof is action-bound; LCO does not claim generic GUI mutation.

### Redaction (`redaction.ts`)

Redacts credential strings and generic `/Users/<name>` paths (converted to `~/...`) from indexed safe text and tool-call argument metadata.

### Audit store

`createAuditStore()` — Local audit trail for dry-run and live-control actions, including HMAC-bound `approval_audit_id`.

## MCP Server (`packages/mcp-server/src/`)

- `tools.ts` — Defines the full `LooTool` registry via `createLooTools()`. Each tool has a `name`, `description`, `safety` contract, `metadata.tier`, and `inputSchema`.
- `server.ts` / `server-runtime.ts` — MCP stdio server with `initialize`, `tools/list`, `tools/call`.
- Tool tiers: `public_facade`, `workflow_detail`, `proof_debug`, `internal_low_level`.
- `LCO_TOOL_PROFILE` filters listing: `facade` (9 tools), `standard` (+workflow_detail), `all` (full catalog, default).
- `loo_*` names are maintained compatibility aliases for `lco_*` tools.

### Compact Public Facade (9 tools)

1. `lco_find` — First-run local indexing plus public-safe session/content matches from one query.
2. `lco_prepared_inbox` — Execute-false attention inbox.
3. `lco_describe_ref` — Describe a source-prefixed ref.
4. `lco_expand_query` — Bounded evidence brief by query.
5. `lco_recent_sessions` — Recent/active session cards.
6. `lco_attention_inbox` — Compact attention queue.
7. `lco_project_digest` — Project-level handoff brief.
8. `lco_codex_control_dry_run` — Exact action hashes and approval packet.
9. `lco_codex_resume_thread` — Live resume after matching dry-run approval.

## CLI (`packages/cli/src/`)

`main.ts` is a large dispatch file (~210k) handling 50+ subcommands. Key command groups:

| Group | Commands |
| --- | --- |
| **Setup** | `doctor`, `onboard status` |
| **Indexing** | `index codex`, `index claude`, `index bench`, `probe codex-sqlite` |
| **Recall** | `find`, `search`, `grep`, `describe`, `expand-query`, `expand-ref`, `session-map` |
| **Maintenance** | `maintenance [--checkpoint] [--analyze] [--vacuum]`, `maintenance --drop-event-content` |
| **Hooks** | `hook closeout-capture`, `hook state-prep`, `hook compaction-capture`, `hook thread-title-finalize`, `closeout dry-run` |
| **Safety** | `sanitize sessions`, `audit-path` |
| **Desktop** | `desktop see`, `desktop act`, `desktop proof-report`, `desktop live-proof-harness`, `desktop proof-action` |
| **MCP** | `serve` |
| **Smoke** | `codex live-control-smoke`, `openclaw dogfood`, `openclaw tool-smoke`, `openclaw published-smoke`, `openclaw live-control-smoke`, `openclaw post-action-refresh-smoke` |
| **Evals** | `eval retrieval`, `eval scenarios`, `scorecards sweep`, `runtime sweep-summary` |
| **Release** | `release preflight`, `release bundle`, `release status`, `release finalization-status`, `release general-readiness`, `release ga-smoke`, `release demo-status` |
| **QA Lab** | `qa-lab tool-coverage`, `qa-lab desktop-contract`, `qa-lab privacy-scan`, `qa-lab run`, `qa-lab live-control-matrix`, `qa-lab cli-mcp-smoke`, `qa-lab judge`, `qa-lab adversarial-review`, `qa-lab workflow` |
| **UI** | `ui local-mac-search` |

## OpenClaw Plugin (`packages/openclaw-plugin/src/`)

- `index.ts` — `defineToolPlugin()` entry that declares native `lco_*` tool wrappers backed by the same `createLooTools()` registry.
- Plugin metadata declares `localOnlyByDefault: true` and `liveControlRequires: ["dry_run", "approval_audit_id"]`.
- Forbidden claims: `Full Claude Code parity`, `cloud sync`, `unattended desktop takeover`, `bypasses Codex permissions`.
- Manifest: `openclaw.plugin.json` (root) and `.codex-plugin/plugin.json` (Codex plugin bundle).

## Runtime (`packages/runtime/src/`)

- `env.ts` — `readEnv()` checks `LCO_*` then falls back to `LOO_*`. `resolveHomeDir()` resolves `HOME`/`USERPROFILE`.
- `node-version-guard.ts` — Enforces Node.js 22.5+ at startup.

## Local Mac UI (`packages/local-mac-ui/src/`)

- `shell.ts` — Creates a local macOS search UI shell backed by LCO tools. Integrates CUA Driver and Peekaboo for desktop fallback readiness. Filters private result fields and redacts secret-like patterns from UI output.

## Hooks (`hooks/hooks.json`)

A Codex Stop hook runs `thread-title-finalize.mjs` after assistant stops, capturing one-shot thread title aliases for recall.

## Build & CI

- TypeScript monorepo compiled with `tsc -p tsconfig.build.json` into `dist/`.
- CI (`.github/workflows/ci.yml`): Node.js 22, `npm ci && npm run check` (build + test).
- CodeQL scan: `.github/workflows/codeql.yml`.
- Tests: `node --test --import tsx tests/*.test.ts`.
