# Release Notes 0.1.0-beta.24

`0.1.0-beta.24` keeps the Codex-first working-app beta scope and publishes the installed OpenClaw gateway first-run recovery status work from #216/#217.

## What Changed

- #216 adds `setupStatus` to `loo openclaw tool-smoke` reports so first-run gateway setup can be classified by machines and agents.
- #216 classifies ready provisioned profiles as `setupStatus.classification: "ready"`.
- #216 classifies credential/profile setup blockers as `setupStatus.classification: "gateway_setup_required"` while keeping `setupBlockers` and `setupGuidance`.
- #216 keeps mixed setup plus tool-defect blockers classified as `gateway_blocked`, so a real tool/package defect is not hidden by a co-occurring gateway credential blocker.

## Current Claim Scope

Allowed beta claim:

> Codex-first working-app beta through installed OpenClaw gateway for local Codex sessions: search, describe, expand, dry-run, and previously proven approval-gated live Codex control evidence.

This release does not widen the beta.23 claim. Fresh profiles still need scoped gateway credentials, a provisioned profile, or local profile/device pairing before gateway `tools.invoke` proof can pass.
Claude Code remains an adapter stub, not a parity claim.

## Release Gate Notes

- Working-app status example: `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example: `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Use `codex-working-app-proof` only when the candidate has approved live-control smoke evidence plus runtime proof markers.
- Use `codex-read-search-expand-dry-run` when a candidate intentionally excludes live-control proof.
- `approved_live_control_smoke_missing` remains the blocker when a working-app claim is attempted without approved live-control smoke evidence.
- `latest` remains pinned to `0.1.0-beta.4`; if this candidate is published, npm `beta` points at `0.1.0-beta.24`.

## Explicit Non-Claims

This beta does not run a new live Codex control smoke; no new live Codex control smoke was run, and it does not run a new live desktop GUI mutation.
No automatic gateway authorization, no broad gateway scope approval, no GUI mutation, no Claude parity, no cloud sync, no 1.0/stable readiness, no unattended desktop takeover, no release-grade enterprise security, and no enterprise/customer-ready security are claimed.
Bundle/status checks do not publish to npm and do not create a GitHub Release.
