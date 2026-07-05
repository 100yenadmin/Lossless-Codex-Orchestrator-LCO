# Release Notes 0.1.0-beta.19

`lossless-openclaw-orchestrator` keeps the Codex-first working-app beta scope
for local Codex sessions and ships the npm published-install cutoff diagnostic
hardening from #200. This prerelease does not broaden the public claim to 1.0,
generic GUI mutation, Codex GUI mutation, Claude parity, cloud sync, unattended
desktop takeover, or enterprise/customer-ready security.

## Included

- #200 adds a public-safe npm install failure diagnostic for release smoke.
- The diagnostic classifies install failures as `npm_before_cutoff_drift` when
  registry metadata proves the version exists but npm install fails with
  `ENOVERSIONS` or `ETARGET` and stderr says `with a date before ...`.
- The beta release runbook now tells operators to retry published-install smoke
  with an explicit future `--before=<ISO timestamp>` value when that cutoff
  drift is present.
- True unpublished or unavailable package versions remain separate from cutoff
  drift and are not treated as a successful publication.
- This is release-smoke hardening, not a runtime behavior expansion.

## Proof Boundary

- Allowed claim: Codex-first working-app beta through the installed OpenClaw
  gateway, with clearer npm published-install diagnostics for beta release
  operators.
- The installed OpenClaw gateway remains the user-facing beta proof surface for
  local Codex sessions.
- Desktop collaboration remains excluded unless separately claimed and proven.
- This release does not run a new live Codex control smoke.
- This release does not run a new live desktop GUI mutation.
- Claude Code remains a read-only adapter/inventory boundary and adapter stub,
  not parity.
- No cloud sync is included.
- No unattended desktop takeover, generic GUI mutation, or Codex GUI mutation is
  included.
- No release-grade enterprise security is included.
- `approved_live_control_smoke_missing` remains the fail-closed blocker when a
  claimed live-control release lacks the structured approval smoke marker.
- Release bundle and status checks do not publish to npm and must not create a GitHub Release;
  publishing is a separate operation after gates pass.
- `latest` remains pinned to `0.1.0-beta.4`; npm `beta` points at `0.1.0-beta.19`
  if this candidate is published.

## Release Gates

Normal working-app beta release proof remains:

```bash
loo release status --claim-scope codex-working-app-proof --runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proof --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict
```

If a release candidate intentionally excludes live Codex control and
working-app proof, keep the reduced scope explicit:

```bash
loo release status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict
```

If published-install smoke sees npm cutoff drift after publication, first prove
the version exists with `npm view lossless-openclaw-orchestrator@<version>` or
`npm view lossless-openclaw-orchestrator@beta version`, then retry with an
explicit future `--before=<ISO timestamp>` value and keep both logs in the
public-safe evidence packet.

## Install

```bash
npm install -g lossless-openclaw-orchestrator@beta
```
