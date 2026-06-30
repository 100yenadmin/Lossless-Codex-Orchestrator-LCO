# Release Notes 0.1.0-beta.10

`lossless-openclaw-orchestrator` remains a Codex-first public beta for indexing
local Codex sessions, bounded recall, OpenClaw MCP tools, and dry-run Codex
control proof through an OpenClaw gateway.

## Included

- Everything shipped in `0.1.0-beta.9`, including gateway blocker guidance and
  the session sanitizer operator surface.
- #166 adds the Claude read-only inventory proof boundary and fixture coverage.
  Claude Code remains read-only inventory research in this beta, not control or
  parity.
- #157 adds the runtime scenario proof gate for the Milestone 7 working-app path.
  The gate scans public-safe runtime proof markers for required scenario state
  and secret-like values before any runtime app claim can pass.
- #162 adds the working-app release claim gate. Release commands can now name
  `codex-working-app-proof`, but that scope fails closed until the required
  public-safe runtime proof markers exist.

## Proof Boundary

- The default public release scope remains `codex-read-search-expand-dry-run`.
- A read/search/expand/dry-run release candidate must use `--claim-scope
  codex-read-search-expand-dry-run`; those reports record live Codex control and
  working-app runtime proof in `excludedClaims` instead of claiming them.
- `codex-working-app-proof` is a stricter future claim scope. It does not pass
  only because #162 exists; it requires the runtime proof directory with the
  public-safe #158 and #159 marker files.
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

- `beta` moves to `0.1.0-beta.10` if this candidate is published.
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

For a future runtime-proven working-app claim:

```bash
loo release status --claim-scope codex-working-app-proof --runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proof --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict
```

Do not attach raw Codex session JSONL, private SQLite databases, screenshots with
secrets, credentials, tokens, or private transcripts to public release artifacts.
