# Lossless OpenClaw Orchestrator

Control your Codex Desktop and Claude Code remotely via your OpenClaw agent or collaborate with them when you are on your computer in the same sessions.

This public beta focuses on Codex. Claude Code support is intentionally shipped as an adapter stub until its session storage and control paths are proven.

## What It Does

- Indexes local Codex session JSONL into a local SQLite database.
- Lets an OpenClaw agent search, describe, and expand Codex sessions without reading raw thousand-call transcripts.
- Extracts session metadata, proposed plans, final messages, touched files, tool-call metadata, and safe summaries.
- Exposes `loo_*` MCP tools for OpenClaw and other MCP clients.
- Provides approval-gated Codex controls for resume, send, steer, and interrupt.
- Keeps CUA Driver and Peekaboo behind a desktop fallback adapter boundary.

## Safety Model

- Local-only by default.
- No transcript upload.
- No raw Codex transcript merge into OpenClaw LCM.
- Read/search works without live control.
- Live Codex control requires a prior dry-run audit record plus `approval_audit_id`.
- The project does not bypass Codex approvals, permission profiles, or sandbox behavior.

Allowed public beta claim:

> Control and collaborate with local Codex sessions through OpenClaw using local indexing, bounded recall, and approval-gated controls.

Forbidden beta claims:

- Full Claude Code parity
- Cloud sync
- Unattended desktop takeover
- Bypasses Codex permissions

## Install

```bash
npm install -g lossless-openclaw-orchestrator
```

For local development:

```bash
git clone https://github.com/100yenadmin/lossless-openclaw-orchestrator.git
cd lossless-openclaw-orchestrator
npm install
npm test
```

## CLI

```bash
loo doctor
loo index codex ~/.codex/sessions ~/.codex/archived_sessions
loo search "proposed plan billing bridge"
loo serve
```

Database path:

```bash
export LOO_DB_PATH="$HOME/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite"
```

## MCP / OpenClaw Tools

Tool prefix: `loo_*`.

Read/search:

- `loo_index_sessions`
- `loo_search_sessions`
- `loo_describe_session`
- `loo_expand_session`
- `loo_expand_query`

Codex details:

- `loo_codex_thread_map`
- `loo_codex_final_messages`
- `loo_codex_plans`
- `loo_codex_touched_files`
- `loo_codex_tool_calls`

Approval-gated controls:

- `loo_codex_control_dry_run`
- `loo_codex_resume_thread`
- `loo_codex_send_message`
- `loo_codex_steer_thread`
- `loo_codex_interrupt_thread`

Desktop fallback:

- `loo_desktop_see`
- `loo_desktop_act`

Admin:

- `loo_doctor`
- `loo_permissions`
- `loo_audit_tail`

## Architecture

- `packages/core`: SQLite schema, Codex import, search, expansion, extraction.
- `packages/mcp-server`: stdio MCP tool server.
- `packages/openclaw-plugin`: OpenClaw plugin metadata.
- `packages/cli`: `loo` CLI.
- `packages/adapters`: Codex control, CUA/Peekaboo boundary, Claude Code stub.

Direct Codex protocol is preferred for thread work. GUI automation is a fallback for visible app collaboration only.

## Development

```bash
npm run typecheck
npm test
npm run build
```

The test suite uses redacted fixtures and Node's built-in test runner.

## Privacy

The default index is local SQLite. The index stores safe text and metadata so agents can search and expand bounded evidence. Raw local session files remain source-of-truth and are referenced by source path; users should not commit private DB files or session transcripts.

See [docs/SAFE_SUMMARIES.md](docs/SAFE_SUMMARIES.md) for the beta safe-summary contract.
