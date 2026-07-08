# Safety & Privacy

LCO is designed around a strict safety boundary: local-first, read-by-default, approval-gated control, and public-safe evidence. This page documents the mechanisms that enforce that boundary.

## Local-Only by Default

- All data stays in a local SQLite database (`LCO_DB_PATH`).
- No cloud sync, no raw transcript upload, no merging of Codex transcripts into OpenClaw LCM.
- OpenClaw LCM peer DBs are opened **read-only** with SQLite query-only mode.
- Raw transcripts remain in the local Codex store; LCO indexes metadata and safe text only.

## Mutation Classes

Every tool declares a `safety.mode` and `mutationClasses`:

| Mode | Meaning |
| --- | --- |
| `read_only` | No writes at all |
| `local_cache_write` | LCO-owned local SQLite cache or audit record only (`derived_cache`) |
| (control modes) | `live_control`, `desktop_gui` — approval-gated, outside normal recall |

`derived_cache` means LCO writes its own advisory cache or audit (e.g., `lco_index_sessions`, `lco_codex_control_dry_run`). It does **not** mean Codex source-store, external-system, or GUI mutation.

Non-default external mutation families (`source_store`, `external_system`, `github_write`, `npm_publish`, `release_publish`) are explicitly tagged and not part of the default prepared-state path.

## Codex Method Policy

Defined in `packages/adapters/src/policy.ts`:

### Read Methods (no approval needed)

`initialize`, `thread/list`, `thread/read`, `thread/turns/list`, `model/list`, `config/read`, `account/read`, `getAuthStatus`, `gitDiffToRemote`, and others.

### Control Methods (require dry-run + approval)

`thread/start`, `thread/resume`, `turn/start`, `turn/steer`, `turn/interrupt`.

### Forbidden Methods (blocked entirely)

Includes but is not limited to:
- Thread lifecycle: `thread/fork`, `thread/archive`, `thread/delete`, `thread/unsubscribe`, `thread/name/set`, `thread/goal/set`, `thread/rollback`, `thread/compact/start`
- Filesystem writes: `fs/writeFile`, `fs/createDirectory`, `fs/remove`, `fs/copy`
- Command execution: `command/exec`, `command/exec/write`, `thread/shellCommand`
- Config writes: `config/value/write`, `config/batchWrite`
- Plugin/marketplace: `plugin/install`, `plugin/uninstall`, `marketplace/add`, `marketplace/remove`
- Remote control pairing: `remoteControl/enable`, `remoteControl/disable`, `remoteControl/pairing/*`
- Account: `account/login/start`, `account/logout`

`assertCodexMethodAllowed()` enforces this at the adapter boundary.

## Dry-Run Approval Boundary

Live Codex control follows a strict two-step process:

1. **Dry-run** (`lco_codex_control_dry_run`): Produces a packet with exact target, action, message hash, and HMAC-bound `approval_audit_id`. No live action is performed.
2. **Live execution** (`lco_codex_resume_thread` or equivalent): Only runs after matching approval. The audit store records the action chain.

The `approval_audit_id` is HMAC-bound to the dry-run packet contents. A mismatched or missing ID causes the live action to fail-closed.

## Safe Summary Contract

Defined in [`docs/SAFE_SUMMARIES.md`](../docs/SAFE_SUMMARIES.md):

### May Contain

- Thread title, thread id, model, branch, git SHA, redacted working directory
- Final assistant/status message for handoff
- Proposed plan blocks (whitespace-normalized, credential-redacted)
- Touched file refs (repo-relative and Lexar repo paths)
- Tool-call names and redacted argument metadata
- Source refs (`codex_thread:*`, `lcm_summary:*`)

### Must Not Contain

- Raw Codex transcripts beyond bounded extracted evidence
- API keys, bearer tokens, auth headers, cookies, private keys
- Unredacted home paths (`/Users/name/...` → `~/...`)
- Raw customer data copied only because it appeared in a transcript
- Uploaded or cloud-synced local session content

## Redaction

`packages/adapters/src/redaction.ts` provides `redactValue()` which:

- Redacts common credential patterns (npm tokens, GitHub PATs, `sk-` keys, `glpat-` tokens, `xox*` Slack tokens, AWS keys, etc.)
- Converts generic `/Users/<name>` paths to `~/...`
- Applied to indexed safe text and tool-call argument metadata

The local Mac UI shell (`packages/local-mac-ui/src/shell.ts`) additionally filters private result fields (`raw`, `rawText`, `rawPrompt`, `rawMessage`, `rawTranscript`, `transcript`, `prompt`, `messageText`, `sqliteRow`, `screenshot`, `video`) and applies its own secret-like pattern redaction.

## Session Sanitizer

`packages/core/src/session-sanitizer.ts` provides:

- `createSessionSanitizerReport()` — Detects privacy/safety findings in indexed sessions (credential patterns, unredacted paths, suspicious content).
- `createSessionSanitizerRepairPlan()` — Generates repair tasks for detected issues.
- `createIndexedSessionSanitizerReport()` / `createIndexedSessionSanitizerRepairPlan()` — Operate on already-indexed data via `lco sanitize sessions`.

## Privacy Non-Goals (Beta)

From [`docs/PRIVACY.md`](../docs/PRIVACY.md):

- Cloud sync
- Raw transcript upload
- Merging raw Codex transcripts into OpenClaw LCM
- Mutating OpenClaw LCM peer DBs from recall tools
- Full Claude Code parity
- Unattended desktop takeover

## Forbidden Claims

The OpenClaw plugin metadata (`packages/openclaw-plugin/src/index.ts`) explicitly forbids:

- `Full Claude Code parity`
- `cloud sync`
- `unattended desktop takeover`
- `bypasses Codex permissions`

## Telemetry

`LCO_TELEMETRY=1` enables **opt-in** retrieval telemetry for local search-to-describe/expand correlation only. It:
- Writes LCO-owned derived cache
- Requires a telemetry session ID for correlation
- Does **not** store raw query text
- Does not transmit data externally

## What Not to Commit

From `AGENTS.md` and `CONTRIBUTING.md`:

- Raw Codex transcripts
- Private SQLite DBs
- Screenshots with private data
- Tokens, cookies, connector URLs, credentials
- Raw OpenClaw plugin JSON
- Raw gateway output

Use redacted fixtures for tests. See `tests/fixtures/` and `tests/helpers/`.
