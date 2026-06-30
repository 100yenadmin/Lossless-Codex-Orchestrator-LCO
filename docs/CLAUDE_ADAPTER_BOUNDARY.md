# Claude Code Adapter Boundary

Issue: [#163](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/163)

This inventory keeps the Claude Code lane honest. LCO may prepare a future
adapter behind the same local index, safe-summary recall, and approval/audit
patterns as Codex.

This document does not prove Claude Code indexing, control, parity, GUI mutation, or cloud sync.

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
- no live Claude prompt send, no GUI action, no remote-control action

Disallowed for the next proof:

- Claude Code live control
- Claude Code GUI mutation
- broad desktop automation
- bypassing Claude Code permission modes
- cloud sync or remote session claims

## First Adapter Proof Step

The first adapter proof step should be **read-only session inventory**:

1. Add a Claude adapter fixture importer for redacted public-safe metadata only.
2. Produce source refs such as `claude_session:*` without raw transcript text.
3. Prove the index/search/describe path can route metadata-only Claude refs
   alongside Codex refs.
4. Keep live control, resume/send/interrupt, GUI fallback, and cloud/remote
   paths out of scope.

The implementation issue is
[#166](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/166).
It requires a failing fixture test first, a public-safe evidence packet, and
claim-audit checks proving the docs still say Claude Code remains a future
adapter boundary.

## Proof Boundary

This issue is complete only when the repo contains this inventory, claim-audit
tests, and a first-step issue for read-only metadata proof.

This issue does not prove Claude Code indexing, control, parity, GUI mutation, or cloud sync.
