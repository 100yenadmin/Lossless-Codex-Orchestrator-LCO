# Release Notes 0.1.0-beta.9

`lossless-openclaw-orchestrator` remains a Codex-first public beta for indexing
local Codex sessions, bounded recall, OpenClaw MCP tools, and dry-run Codex
control proof through an OpenClaw gateway.

## Included

- Everything shipped in `0.1.0-beta.8`.
- #150 adds gateway blocker guidance for the OpenClaw tool-smoke path, so common
  gateway blockers such as scope approval, device identity pairing, token
  mismatch, and missing credentials return actionable next steps instead of a
  generic follow-up.
- #152 exposes the session sanitizer lane through public operator surfaces:
  `loo sanitize sessions` and the MCP/OpenClaw declaration
  `loo_session_sanitizer`.
- The sanitizer surface scans indexed Codex safe text only and emits redacted
  pattern classes, HMAC fingerprints, source refs, and repair-task guidance
  without writing raw transcript text or raw secret values.

## Proof Boundary

- The default public release scope remains `codex-read-search-expand-dry-run`.
- Gateway blocker guidance is diagnostic only and does not approve broad gateway
  scope, live Codex control, or channel delivery.
- Session sanitizer reports are local indexed/safe-text diagnostics only. They
  do not read raw Codex transcripts directly, upload local data, mutate
  sessions, perform repairs, run live Codex control, or mutate a desktop GUI.
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

- `beta` moves to `0.1.0-beta.9` if this candidate is published.
- `latest` remains `0.1.0-beta.4` until the first stable release or a separate
  latest-promotion operation explicitly claims and proves a move.
- Do not publish a fake stable release or promote `latest` as part of this beta.

## Release Gate

For a local release status packet that claims live Codex control:

```bash
loo release status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json
```

For a release candidate that intentionally excludes live Codex control and
desktop GUI mutation:

```bash
loo release status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict
```

Do not attach raw Codex session JSONL, private SQLite databases, screenshots with
secrets, credentials, tokens, or private transcripts to public release artifacts.
