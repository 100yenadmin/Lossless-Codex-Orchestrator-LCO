# Release Notes 0.1.0-beta.16

`lossless-openclaw-orchestrator` keeps the Codex-first working-app beta scope
for local Codex sessions and further hardens the claim-conditional desktop
collaboration gate. This prerelease does not broaden the public claim to
generic GUI mutation, Claude parity, cloud sync, unattended desktop takeover,
or enterprise/customer-ready security.

## Included

- #160 hardens `loo release status --desktop-gui-required` so desktop
  collaboration runtime proof must bind to the same approved action hash as
  `desktop-gui-approval.json`.
- `desktop-collaboration-action-bound-v1-1.runtime-proof.json` now needs an
  `action_hash` value matching the approval `actionHash` when desktop GUI
  mutation is claimed through release status.
- The approval `actionHash` remains the exact SHA-256 hash of
  `JSON.stringify({ desktopBackend, targetApp, targetWindow, action })`
  emitted by `loo desktop proof-report`.
- This is a desktop collaboration gate hardening release, not a broad GUI
  automation release.
- Claim docs, VISION, and scorecards now describe the runtime marker plus
  approval hash binding boundary explicitly.

## Proof Boundary

- Allowed claim: Codex-first working-app beta through the installed OpenClaw
  gateway, with stricter fail-closed desktop collaboration proof gates when
  that optional surface is claimed.
- The installed OpenClaw gateway remains the user-facing beta proof surface for
  local Codex sessions.
- Desktop collaboration remains claim-conditional. This release does not run a
  new live desktop GUI mutation.
- Claude Code remains a read-only adapter/inventory boundary and adapter stub,
  not parity.
- No cloud sync, unattended desktop takeover, generic GUI mutation, or
  release-grade enterprise security is included.
- No unattended desktop takeover is included.
- No release-grade enterprise security is included.
- `approved_live_control_smoke_missing` remains the fail-closed blocker when a
  claimed live-control release lacks the structured approval smoke marker.
- Release bundle and status checks do not publish to npm and do not create a
  GitHub Release; publishing is a separate operation after gates pass.
- Release bundle and status checks do not publish to npm and must not create a
  GitHub Release.
- Release bundle and status checks must not create a GitHub Release.
- `latest` remains pinned to `0.1.0-beta.4`; `beta` points at
  `0.1.0-beta.16` if this candidate is published.
- npm `beta` points at `0.1.0-beta.16` if this candidate is published.

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

Desktop GUI mutation is still excluded from normal beta publication. If a
future release intentionally claims desktop collaboration, the release-status
gate must also be run with desktop GUI required evidence, the runtime proof
directory must contain
`desktop-collaboration-action-bound-v1-1.runtime-proof.json`,
`desktop-gui-approval.json` must include an `actionHash` equal to the SHA-256
hash of `JSON.stringify({ desktopBackend, targetApp, targetWindow, action })`,
and the runtime proof marker must include matching `action_hash`.

## Install

```bash
npm install -g lossless-openclaw-orchestrator@beta
```
