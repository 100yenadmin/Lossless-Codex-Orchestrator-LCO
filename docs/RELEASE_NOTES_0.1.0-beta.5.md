# Release Notes 0.1.0-beta.5

`lossless-openclaw-orchestrator` remains a Codex-first public beta for indexing
local Codex sessions, bounded recall, OpenClaw MCP tools, and dry-run Codex
control proof through an OpenClaw gateway.

## Included

- Everything shipped in `0.1.0-beta.4`.
- Keeps the desktop live/no-focus proof harness as both CLI and MCP/OpenClaw
  surface:
  - `loo desktop live-proof-harness`
  - `loo_desktop_live_proof_harness`
- CUA Driver telemetry opt-out is enforced for desktop probes by forcing
  `CUA_DRIVER_RS_TELEMETRY_ENABLED=0`, so desktop fallback diagnostics stay
  local-only by default.
- The local Mac scorecard, UI contract, and generated UI scorecard now record
  the CUA Driver scratch-window no-focus proof without broadening the claim.
- The CUA Driver scratch-window no-focus proof is scoped to one approved TextEdit launch_app action with focus unchanged and public-safe evidence only.
- The proof boundary is action-scoped across release docs, scorecards, and UI
  artifacts: it does not enable generic GUI mutation or Codex GUI mutation.

## Proof Boundary

- The default public release scope remains `codex-read-search-expand-dry-run`.
- `loo openclaw tool-smoke` proves selected `loo_*` calls through the local
  OpenClaw gateway surface, including dry-run control audit creation, without
  running live Codex control.
- `approved_live_control_smoke_missing` remains the blocker for live Codex
  send/resume/steer/interrupt claims when live control is claimed.
- Live Codex send/resume/steer/interrupt remains excluded unless a release
  status packet explicitly includes approved live-control smoke evidence.
- Desktop GUI mutation remains excluded unless a release status packet explicitly
  includes approved backend-specific action-bound no-focus proof and the release
  plan claims GUI mutation.
- A read/search/expand/dry-run release candidate must use `--claim-scope
  codex-read-search-expand-dry-run`; those reports record live Codex control in
  `excludedClaims` instead of claiming approved live-control proof.
- The bundled release artifact does not publish to npm.
- The bundled release artifact does not create a GitHub Release.
- Claude Code remains an adapter stub until storage and control paths are proven.
- No generic GUI mutation.
- No Codex GUI mutation.
- No cloud sync.
- No unattended desktop takeover.
- No permission bypass.
- No release-grade enterprise security.

## Release Gate

For a local release status packet without publishing, creating a GitHub Release,
live Codex control, or desktop GUI mutation:

```bash
loo release status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json
```

For a release candidate that intentionally excludes live Codex control:

```bash
loo release status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict
```

Do not attach raw Codex session JSONL, private SQLite databases, screenshots with
secrets, credentials, tokens, or private transcripts to public release artifacts.
