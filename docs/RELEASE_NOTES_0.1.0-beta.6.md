# Release Notes 0.1.0-beta.6

`lossless-openclaw-orchestrator` remains a Codex-first public beta for indexing
local Codex sessions, bounded recall, OpenClaw MCP tools, and dry-run Codex
control proof through an OpenClaw gateway.

## Included

- Everything shipped in `0.1.0-beta.5`.
- Fixes the OpenClaw dogfood install/link idempotency gate.
- `loo openclaw dogfood --install-source . --link` now treats an install/link
  failure as a warning, not a blocker, when follow-up OpenClaw runtime
  inspection proves the plugin is already enabled, loaded, and exposes required loo_* tools.
- The public-safe warning code is
  `openclaw_plugin_install_failed_but_plugin_ready`.
- Real readiness failures still fail closed when plugin list, runtime inspect,
  enabled/loaded state, or required `loo_*` tools are missing.

## Proof Boundary

- The default public release scope remains `codex-read-search-expand-dry-run`.
- `loo openclaw dogfood` and `loo openclaw tool-smoke` prove selected `loo_*`
  calls through the local OpenClaw gateway surface, including dry-run control
  audit creation, without running live Codex control.
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
- This release does not run live Codex control.
- This release does not perform desktop GUI mutation.
- The local release bundle/status gate does not publish to npm.
- The local release bundle/status gate does not create a GitHub Release.
- Claude Code remains an adapter stub until storage and control paths are
  proven.
- No generic GUI mutation.
- No Codex GUI mutation.
- No cloud sync.
- No unattended desktop takeover.
- No permission bypass.
- No release-grade enterprise security.

## npm Dist-Tag Policy

- `beta` moves to `0.1.0-beta.6`.
- `latest` remains `0.1.0-beta.4` until the first stable release policy changes.
- Do not publish a fake stable release or promote `latest` as part of this beta.

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
