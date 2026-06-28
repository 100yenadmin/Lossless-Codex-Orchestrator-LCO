# Lossless OpenClaw Orchestrator

Control and collaborate with local Codex sessions through OpenClaw using local indexing, bounded recall, and approval-gated controls.

This public beta focuses on Codex. Claude Code support is intentionally shipped as an adapter stub until its session storage and control paths are proven.

## What It Does

- Indexes local Codex session JSONL into a local SQLite database.
- Lets an OpenClaw agent search, describe, and expand Codex sessions without reading raw thousand-call transcripts.
- Extracts session metadata, proposed plans, final messages, touched files, tool-call metadata, and safe summaries.
- Optionally reads OpenClaw LCM peer summary DBs read-only for `grep -> describe -> expand_query` recall without merging stores.
- Exposes `loo_*` MCP tools for OpenClaw and other MCP clients.
- Provides approval-gated Codex controls for resume, send, steer, and interrupt.
- Keeps CUA Driver and Peekaboo behind a desktop fallback adapter boundary.

## Safety Model

- Local-only by default.
- No transcript upload.
- No raw Codex transcript merge into OpenClaw LCM.
- Optional OpenClaw LCM peer reads use source-prefixed refs and do not mutate the peer DB.
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
- Release-grade enterprise security

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

OpenClaw plugin setup lives in [docs/OPENCLAW_PLUGIN.md](docs/OPENCLAW_PLUGIN.md), with the packageable manifest at `packages/openclaw-plugin/openclaw.plugin.json`. The beta proof workflow lives in [docs/BETA_RELEASE_DEMO.md](docs/BETA_RELEASE_DEMO.md), the public claim boundary is audited in [docs/CLAIM_AUDIT.md](docs/CLAIM_AUDIT.md), and draft public beta notes live in [docs/RELEASE_NOTES_0.1.0-beta.0.md](docs/RELEASE_NOTES_0.1.0-beta.0.md).

## CLI

```bash
loo doctor
loo desktop see cua-driver
loo desktop see peekaboo --snapshot --max-nodes 50
loo desktop act cua-driver "click primary" # dry-run only
loo index codex ~/.codex/sessions ~/.codex/archived_sessions
loo search "proposed plan billing bridge"
loo grep --lcm-db ~/.openclaw/lcm.db "billing bridge"
loo describe codex_thread:019f-example
loo expand-query --profile brief "billing bridge"
loo serve
loo release preflight --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight
loo release bundle --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-bundle
loo release status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --npm-publish-approval-evidence npm-approval.json --github-release-approval-evidence github-release-approval.json
```

Database path:

```bash
export LOO_DB_PATH="$HOME/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite"
```

Optional read-only OpenClaw LCM peer DBs:

```bash
export LOO_LCM_DB_PATHS="$HOME/.openclaw/lcm.db"
```

## MCP / OpenClaw Tools

Tool prefix: `loo_*`.

Read/search:

- `loo_index_sessions`
- `loo_grep`
- `loo_search_sessions`
- `loo_describe_ref`
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

Dry-run control results include `approval_audit_id`, `params_hash`, and, for message-bearing actions, `message_hash`. These are local keyed fingerprints, not raw prompt text. Live control must provide the matching `approval_audit_id`; `loo_audit_tail` exposes recent audit records with fingerprints and no raw prompt text.

Desktop fallback:

- `loo_desktop_see`
- `loo_desktop_act`

`loo doctor` and `loo desktop see cua-driver` report CUA Driver binary availability, the preferred MCP stdio launch command (`cua-driver mcp` unless `LOO_CUA_DRIVER_BIN` overrides it), launch-readiness notes, permission status, limitations, and whether focus changed during a status-only observation. They do not start the GUI-control backend just to prove readiness. `loo_desktop_act` is dry-run-only in this beta and does not perform GUI actions.

`loo desktop see peekaboo --snapshot` is an explicit read-only observation path. It runs Peekaboo with `--no-remote`, blocks denylisted sensitive frontmost apps before capture, redacts extracted text, bounds element counts, and still does not enable generic click/type/send actions.

When a guarded Peekaboo snapshot succeeds, the `visibleCodex.threadMap` field exposes a bounded read-only map of visible Codex thread candidates with redacted titles, status/update labels, source element ids, bounds, centers, confidence, and stable visible ids. This is GUI inventory only; it does not join raw Codex transcripts or enable visible GUI mutation.

`visibleCodex.windows` exposes the captured frontmost Codex window metadata from the same guarded snapshot. `visibleCodex.windows` and `visibleCodex.threadMap` are omitted for non-Codex snapshots, even when the frontmost app is otherwise safe to observe.

Admin:

- `loo_doctor`
- `loo_lcm_peer_dbs`
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

Release preflight:

```bash
loo release preflight --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight
```

The preflight writes a public-safe `release-preflight.json` artifact manifest. It reports `approved_live_control_smoke_missing` until an explicit approved live-control evidence path is supplied, and `--strict` exits non-zero while any release blocker remains.

Release bundle:

```bash
loo release bundle --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-bundle
```

The bundle command copies the checked-in beta release notes, writes `release-bundle.json`, runs the same preflight checks, and explicitly records that it did not publish to npm or create a GitHub Release.

Release status:

```bash
loo release status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --npm-publish-approval-evidence npm-approval.json --github-release-approval-evidence github-release-approval.json
```

The status command writes `release-status.json`, wraps the preflight result, lists remaining explicit approvals, and records that it did not publish to npm, create a GitHub Release, run live Codex control, or mutate a desktop GUI. Use `--strict` to fail closed while release or approval blockers remain. Release operation approval proofs use `kind: "loo_release_operation_approval"`, `operation: "npm_publish" | "github_release"`, `approved: true`, a non-empty `approvalRef`, and `rawSecretIncluded: false`.

## Privacy

The default index is local SQLite. The index stores safe text and metadata so agents can search and expand bounded evidence. Raw local session files remain source-of-truth and are referenced by source path; users should not commit private DB files or session transcripts. LCM peers are configured explicitly and read through `lcm_summary:*` refs without copying summaries into the Codex index.

See [docs/SAFE_SUMMARIES.md](docs/SAFE_SUMMARIES.md) for the beta safe-summary contract.
