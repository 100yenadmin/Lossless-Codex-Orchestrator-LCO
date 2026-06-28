# Release Notes 0.1.0-beta.0

`lossless-openclaw-orchestrator` is a Codex-first public beta for indexing local Codex sessions, bounded recall, OpenClaw MCP tools, and approval-gated Codex controls.

## Included

- Local Codex JSONL indexing into a local SQLite database.
- Search, describe, final-message, proposed-plan, touched-file, tool-call, and bounded expansion surfaces.
- Read-only OpenClaw LCM peer recall through source-prefixed refs.
- Direct Codex app-server diagnostics and approval-gated control tools.
- CUA Driver and Peekaboo fallback readiness/diagnostic surfaces, with GUI action still dry-run-only.
- OpenClaw plugin manifest and `loo_*` MCP server tools.
- `loo release preflight` and `loo release bundle` for public-safe release evidence.

## Proof Boundary

- `approved_live_control_smoke_missing` remains until a user provides a structured `loo_approved_live_control_smoke` JSON proof with `rawPromptIncluded: false`.
- The bundled release artifact does not publish to npm.
- The bundled release artifact does not create a GitHub Release.
- Claude Code remains an adapter stub until storage and control paths are proven.
- No cloud sync.
- No unattended desktop takeover.
- No permission bypass.
- No release-grade enterprise security.

## Release Gate

Before publishing, run:

```bash
loo release preflight --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight --strict
```

For a local release artifact bundle without publishing:

```bash
loo release bundle --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-bundle
```

For a local release status packet without publishing, creating a GitHub Release, live Codex control, or desktop GUI mutation:

```bash
loo release status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --approved-live-control-evidence approved-live-control-smoke.json --npm-publish-approval-evidence npm-approval.json --github-release-approval-evidence github-release-approval.json
```

Do not attach raw Codex session JSONL, private SQLite databases, screenshots with secrets, credentials, or private transcripts to public release artifacts.
