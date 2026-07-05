# Release Notes 0.1.0-beta.1

`lossless-openclaw-orchestrator` remains a Codex-first public beta for indexing local Codex sessions, bounded recall, OpenClaw MCP tools, and approval-gated Codex controls.

## Included

- Everything shipped in `0.1.0-beta.0`: local Codex JSONL indexing, search, describe, final-message, proposed-plan, touched-file, tool-call, bounded expansion, LCM peer recall, Codex diagnostics, CUA/Peekaboo readiness, OpenClaw plugin manifest, and `loo_*` MCP tools.
- `loo codex live-control-smoke`, a strict public-safe maintainer smoke runner that records approval audit ids, hashes, request counts, and `rawPromptIncluded: false` without storing raw prompt text.
- `loo ui local-mac-search`, a local Mac search UI shell prototype that renders safe summaries, source refs, filter state, copy-ref targets, and backend readiness surfaces without raw transcript rendering.
- Hardened local Mac UI shell behavior for CLI sample overrides, unsafe source-ref omission, macOS gating, strict fail-closed coverage, and bounded subprocess tests.

## Proof Boundary

- The default public release scope remains `codex-read-search-expand-dry-run` unless a release status packet explicitly includes approved live-control smoke evidence.
- `approved_live_control_smoke_missing` remains the blocker for live Codex send/resume/steer/interrupt claims when live control is claimed.
- A read/search/expand/dry-run release candidate must use `--claim-scope codex-read-search-expand-dry-run`; those reports record live Codex control in `excludedClaims` instead of claiming approved live-control proof.
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
loo release status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json
```

For a release candidate that intentionally excludes live Codex control:

```bash
loo release status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict
```

Do not attach raw Codex session JSONL, private SQLite databases, screenshots with secrets, credentials, or private transcripts to public release artifacts.
