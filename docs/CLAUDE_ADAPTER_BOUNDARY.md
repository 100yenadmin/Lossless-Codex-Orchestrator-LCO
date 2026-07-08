# Claude Code Adapter Boundary

Issues:

- [#163](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/163)
  initial adapter boundary inventory.
- [#707](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/707)
  Claude Code format mapping and public-safe parser foundation.
- [#710](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/710)
  Claude Code local JSONL importer and storage foundation.
- [#737](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/737)
  Claude-native dry-run TargetAdapter validation for the 1.6 control-plane
  seam.

This inventory keeps the Claude Code lane honest. LCO can now import local
Claude Code JSONL into the same public-safe recall flow as Codex, while live
control and parity remain separate adapter work.

## Public Source Inventory

The boundary is based on public Claude Code documentation only. It does not
inspect local Claude transcripts or private app data.

- Settings and storage scopes:
  <https://docs.anthropic.com/en/docs/claude-code/settings>
  documents user, project, local, and managed scopes, including `~/.claude/`,
  `.claude/`, `.claude/settings.local.json`, `~/.claude/settings.json`,
  `~/.claude.json`, and managed settings locations.
- CLI/session surfaces:
  <https://docs.anthropic.com/en/docs/claude-code/cli-reference>
  documents session-oriented commands and flags such as `--resume`, `--print`,
  `logs`, `attach`, `daemon status`, `--no-session-persistence`, and
  permission modes.
- MCP configuration:
  <https://docs.anthropic.com/en/docs/claude-code/mcp>
  documents local, project, and user MCP scopes, including configuration stored
  in `~/.claude.json` and `.mcp.json`.
- Hooks:
  <https://docs.anthropic.com/en/docs/claude-code/hooks>
  documents hook events and shows that hook payloads can include a
  `transcript_path`; this is a signal for possible metadata discovery, not
  permission to read raw transcripts or mutate sessions.

## Storage Path Boundary

Potential storage or metadata inputs are limited to public-safe discovery:

- settings paths named in the docs
- configuration shape and scope metadata
- file existence, counts, mtimes, and hashed identifiers
- source refs derived from redacted, explicit user-approved fixtures

Forbidden by default:

- raw Claude transcript text
- raw prompts, tool inputs, tool outputs, screenshots, videos, cookies, API
  keys, OAuth material, or machine-local credentials
- direct mutation of Claude Code settings or sessions
- importing private Claude data into OpenClaw LCM or public evidence

## Control Surface Boundary

The docs name CLI, MCP, hook, permission, remote-control, daemon, and session
resume surfaces. LCO must treat every one of those as unproven until a separate
issue adds a fail-closed adapter proof.

Allowed for the next proof:

- read-only capability detection
- public-safe storage/config inventory
- explicit fixture import with redacted data
- local JSONL import into LCO-owned public-safe recall tables
- no live Claude prompt send, no GUI action, no remote-control action

Disallowed for the next proof:

- Claude Code live control
- Claude Code GUI mutation
- broad desktop automation
- bypassing Claude Code permission modes
- cloud sync or remote session claims

## First Adapter Proof Step

The first adapter proof step is **read-only session inventory**:

1. Add a Claude adapter fixture importer for redacted public-safe metadata only.
2. Produce source refs such as `claude_session:*` without raw transcript text.
3. Prove the index/search/describe path can route metadata-only Claude refs
   alongside Codex refs.
4. Keep live control, resume/send/interrupt, GUI fallback, and cloud/remote
   paths out of scope.

The implementation issue is
[#166](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/166).
It adds `indexClaudeSessionInventory` for explicit redacted fixtures and
`claude_session:*` refs that can be routed through the same recall
`grep -> describe -> expand` boundary as Codex and LCM refs.

Metadata-only fixture inventory is proven. Local Claude Code JSONL read/recall
now continues under the 1.5 importer lane.

## 1.5 Parser Foundation

The 1.5 read/recall lane adds a pure parser foundation before filesystem
discovery or database import:

- `parseClaudeCodeJsonl(sourcePath, text)` parses one JSONL session string into
  public-safe `ParsedClaudeCodeSession` metadata.
- `docs/CLAUDE_CODE_FORMAT_MAPPING.md` records the supported event mapping.
- Parser output uses `claude_session:*`, `claude_source:*`, `claude_event:*`,
  and `claude_range:*` opaque refs.
- Tool inputs, command strings, stdout/stderr, thinking traces, media blobs,
  filenames, raw ids, and raw transcript rows are omitted or redacted by
  default.

## 1.5 Importer Foundation

The 1.5 read/recall lane now adds local filesystem import:

- `indexClaudeSessions(db, { roots })` discovers and imports local Claude Code
  JSONL files into `claude_sessions` and `claude_safe_text_fts`.
- `lco index claude [roots...]` exposes the same importer from the CLI.
- Grep, describe, and expand can route imported `claude_session:*` refs without
  returning raw transcript paths or raw rows.

This is a read/recall foundation. Claude live control, settings mutation, GUI
mutation, cloud sync, and adapter parity remain future adapter work.

## 1.6 Dry-Run TargetAdapter Validation

The 1.6 control-plane lane adds Claude-native dry-run TargetAdapter validation
without adding live Claude Code control. The adapter can report explicit
`dry_run_only`, `not_configured`, and `unsupported` states and can mint an LCO
dry-run audit packet for a `claude/print/resume` intent. The packet records
opaque refs and hashes only; it does not invoke `claude`, type into Claude Code,
change Claude settings, mutate sessions, or claim adapter parity.
