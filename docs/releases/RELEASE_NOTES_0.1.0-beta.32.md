# Release Notes 0.1.0-beta.32

`0.1.0-beta.32` keeps the Codex-first working-app beta scope for local Codex
sessions and publishes the #282 packaged `published-smoke` readiness
clarification.

## What Changed

- `loo openclaw published-smoke` now accepts an optional
  `--configured-tool-smoke-report` input.
- Published-smoke reports a separate `configuredGateway` block with:
  - whether a configured-profile proof was provided,
  - configured tool-smoke readiness,
  - gateway setup classification,
  - package-install-likely-ok status,
  - bounded tool count,
  - sanitized invoked `loo_*` tool names.
- Fresh-profile readiness remains separate. `setupRequired` and
  `publishedSmokeReady` are still driven only by the fresh-profile
  `toolSmoke` block.
- The packaging scorecard and fresh npm clean-profile scenario now require the
  configured-profile proof to stay separate from clean-profile readiness.
- Published-smoke tests now assert the `dogfood`, fresh `toolSmoke`, and
  optional `configuredGateway` sections together, with shared secret and
  SQLite/DB canaries for stdout and saved evidence.
- #160 continues to ship `loo_desktop_proof_action` /
  `loo desktop proof-action`, limited to one CUA Driver TextEdit scratch proof
  path. The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run.
- #160 proves generic gateway invocation without exact proof args fails closed.
- #160 keeps the `loo openclaw tool-smoke` hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.

## Current Claim Scope

Allowed beta claim:

> Codex-first beta through installed OpenClaw gateway for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only cockpit/operating-picture cards, public-safe scored
> v1.0 scorecards, and clearer published-package gateway setup reporting.

This release does not widen the beta.24 claim, beta.31 claim, live-control scope, or
desktop-collaboration scope. It only publishes a packaged CLI/reporting
clarification that is already merged on `main`.

## Release Gate Notes

- `loo openclaw published-smoke --configured-tool-smoke-report <path>` records
  configured-profile gateway proof without marking a fresh published profile
  ready.
- A fresh profile that still needs gateway credentials or device pairing should
  remain `setupRequired=true` and `publishedSmokeReady=false`.
- `loo scorecards sweep --claim-scope codex-read-search-expand-dry-run --strict`
  should report `ok=true`, `sweepReady=true`, `publicSafe=true`, and no blockers
  for the bundled v1.0 scorecards.
- `loo eval scenarios --strict` remains a dry-run scenario contract sweep and
  does not perform live Codex control, GUI mutation, npm publish, or GitHub
  Release creation.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Use `codex-working-app-proof` only when the candidate has approved
  live-control smoke evidence plus runtime proof markers.
- `approved_live_control_smoke_missing` remains the blocker when a working-app
  claim is attempted without approved live-control smoke evidence.
- If this candidate is published, npm `beta` points at `0.1.0-beta.32`.
  `latest` remains pinned to the pre-stable line and is not promoted.

## Explicit Non-Claims

Claude Code remains an adapter stub, not an adapter-equivalence claim. This beta
runs no new live Codex control smoke, does not run generic GUI mutation, and
does not run Codex GUI mutation. No automatic gateway authorization, no broad
gateway scope approval, no prompt typing, no clicking, no arbitrary app control,
no cloud sync, no 1.0/stable readiness, no unattended desktop takeover, no
release-grade enterprise security, and no enterprise/customer-ready security are
claimed. No broad gateway scope approval is claimed. No release-grade enterprise security is claimed. Bundle/status checks
do not publish to npm and will not create a GitHub Release.
