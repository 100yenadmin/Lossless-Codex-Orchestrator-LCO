# Release Notes 0.1.0-beta.23

`0.1.0-beta.23` keeps the Codex-first working-app beta scope and hardens the OpenClaw gateway first-run diagnostic path discovered after publishing beta.22.

## What Changed

- #214 classifies missing OpenClaw gateway credentials as setup state in `loo openclaw tool-smoke` via `setupBlockers` and `setupGuidance`.
- #214 keeps the existing fail-closed blocker codes, including per-tool blockers such as `openclaw_gateway_credentials_required:loo_doctor`.
- #214 updates user-facing docs so fresh-profile gateway credentials are treated as onboarding/profile setup, not npm package failure.

## Current Claim Scope

Allowed beta claim:

> Codex-first working-app beta through installed OpenClaw gateway for local Codex sessions: search, describe, expand, dry-run, and previously proven approval-gated live Codex control evidence.

This release does not widen the beta.22 claim. Fresh profiles still need scoped gateway credentials, a provisioned profile, or local profile/device pairing before gateway `tools.invoke` proof can pass.
Claude Code remains an adapter stub, not a parity claim.

## Release Gate Notes

- Working-app status example: `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example: `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Use `codex-read-search-expand-dry-run` only when a candidate intentionally excludes live-control proof.
- `approved_live_control_smoke_missing` remains the blocker when a working-app claim is attempted without approved live-control smoke evidence.
- `latest` remains pinned to `0.1.0-beta.4`; if this candidate is published, npm `beta` points at `0.1.0-beta.23`.

## Explicit Non-Claims

This beta does not run a new live Codex control smoke and does not run a new live desktop GUI mutation. No new live Codex control smoke is run by this beta. No automatic gateway authorization, no broad gateway scope approval, no GUI mutation, no Claude parity, no cloud sync, no 1.0/stable readiness, no unattended desktop takeover, no release-grade enterprise security, and no enterprise/customer-ready security are claimed.
Bundle/status checks do not publish to npm and do not create a GitHub Release.
