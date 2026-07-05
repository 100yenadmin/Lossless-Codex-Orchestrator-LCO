# Release Notes 0.1.0-beta.17

`lossless-openclaw-orchestrator` keeps the Codex-first working-app beta scope
for local Codex sessions and reduces manual assembly in the claim-conditional
desktop collaboration proof-report path. This prerelease does not broaden the
public claim to generic GUI mutation, Claude parity, cloud sync, unattended
desktop takeover, or enterprise/customer-ready security.

## Included

- #160 updates `loo desktop proof-report --strict` so a valid public-safe,
  backend-specific no-focus observation writes both `desktop-gui-approval.json`
  and `desktop-collaboration-action-bound-v1-1.runtime-proof.json`.
- The generated runtime proof marker includes `action_hash` matching the
  approval `actionHash`.
- The approval `actionHash` remains the exact SHA-256 hash of
  `JSON.stringify({ desktopBackend, targetApp, targetWindow, action })`
  emitted by `loo desktop proof-report`.
- Invalid observations do not emit the desktop collaboration runtime proof
  marker.
- This is a desktop collaboration proof-report plumbing release, not a broad
  GUI automation release.
- VISION, claim audit, and scorecards now describe the generated approval plus
  runtime marker boundary explicitly.

## Proof Boundary

- Allowed claim: Codex-first working-app beta through the installed OpenClaw
  gateway, with less hand-assembled desktop collaboration proof artifacts when
  that optional surface is claimed.
- The installed OpenClaw gateway remains the user-facing beta proof surface for
  local Codex sessions.
- Desktop collaboration remains claim-conditional. This release does not run a
  new live desktop GUI mutation.
- Claude Code remains a read-only adapter/inventory boundary and adapter stub,
  not parity.
- No cloud sync is included.
- No unattended desktop takeover or generic GUI mutation is included.
- No release-grade enterprise security is included.
- `approved_live_control_smoke_missing` remains the fail-closed blocker when a
  claimed live-control release lacks the structured approval smoke marker.
- Release bundle and status checks do not publish to npm and must not create a GitHub Release;
  publishing is a separate operation after gates pass.
- `latest` remains pinned to `0.1.0-beta.4`; npm `beta` points at `0.1.0-beta.17`
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

Desktop GUI mutation is still excluded from normal beta publication. If a
future release intentionally claims desktop collaboration, run
`loo desktop proof-report --strict` against the public-safe observation and
pass the generated artifact directory as both `--runtime-proof-dir` and
`--desktop-gui-approval-evidence` input for the release-status gate. The marker
`desktop-collaboration-action-bound-v1-1.runtime-proof.json` must include an
`action_hash` matching `desktop-gui-approval.json`.

## Install

```bash
npm install -g lossless-openclaw-orchestrator@beta
```
