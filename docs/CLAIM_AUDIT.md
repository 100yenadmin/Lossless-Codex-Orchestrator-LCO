# Public Beta Claim Audit

## Allowed Public Beta Claim

Control and collaborate with local Codex sessions through OpenClaw using local indexing, bounded recall, and approval-gated controls.

This claim is limited to the Codex beta path that has tests and local smoke coverage: indexing, search, describe, bounded expansion, read-only LCM peer recall, Codex direct protocol diagnostics, dry-run approval audits, and read-only CUA/Peekaboo readiness.

## Forbidden Beta Claims

- No full Claude Code parity.
- No cloud sync.
- No unattended desktop takeover.
- No permission bypass.
- No release-grade enterprise security claim.

Claude Code is an adapter stub in this beta. Public docs may mention the stub, but must not imply Claude Code session indexing or control parity until storage and control paths are proven.

## Current Proof Boundary

- Codex session import/search/recall and extraction are covered by fixture tests and local smoke.
- Live Codex control is approval-gated by a dry-run audit id; the public demo stops at dry-run unless the user explicitly approves a target thread.
- CUA Driver is the preferred fallback backend, but no no-focus behavior is claimed without local proof.
- Peekaboo is a secondary macOS fallback for permission diagnostics and guarded snapshots; desktop action remains dry-run-only.
- OpenClaw LCM peer DBs are read-only and remain separate from the Codex index.

## Release Checklist

- `npm run check`
- `npm run build`
- `npm pack --dry-run`
- GitHub CI green for the release PR
- Demo evidence under `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/`
- No raw session transcripts, credentials, screenshots with secrets, or private SQLite DBs in public artifacts
