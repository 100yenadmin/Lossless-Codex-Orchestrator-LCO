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
- `loo release preflight --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight --strict`
- `loo release bundle --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-bundle`
- `loo release status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --approved-live-control-evidence approved-live-control-smoke.json --npm-publish-approval-evidence npm-approval.json --github-release-approval-evidence github-release-approval.json --desktop-gui-approval-evidence desktop-gui-approval.json --strict`
- GitHub CI green for the release PR
- Demo evidence under `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/`
- No raw session transcripts, credentials, screenshots with secrets, or private SQLite DBs in public artifacts

`loo release preflight` writes a public-safe `release-preflight.json` artifact manifest. It must report `approved_live_control_smoke_missing` until an explicit approved live-control smoke evidence path points to a structured `loo_approved_live_control_smoke` JSON proof marker with only audit ids, refs, hashes, approval-semantics confirmation, and `rawPromptIncluded: false`. Release automation should use `--strict` so this blocker cannot be silently ignored.

`loo release bundle` writes local draft release artifacts without publishing: `RELEASE_NOTES_0.1.0-beta.0.md`, `release-preflight.json`, and `release-bundle.json`. It must record `npmPublished: false` and `githubReleaseCreated: false` until a separate explicit publish step is approved.

`loo release status` writes `release-status.json` without performing gated actions. It must record `npmPublished: false`, `githubReleaseCreated: false`, `liveCodexControlRun: false`, and `desktopGuiActionRun: false`, and it must list `npm_publish_not_approved`, `github_release_not_approved`, and `desktop_gui_mutation_not_approved` until those separate release operations are explicitly approved through safe `loo_release_operation_approval` proof markers. Release operation proof markers must include `operation: "npm_publish" | "github_release" | "desktop_gui_mutation"`, `approved: true`, a non-empty `approvalRef`, and `rawSecretIncluded: false`.
