# Release Notes 0.1.0-beta.35

`0.1.0-beta.35` keeps the Codex-first working-app beta scope and publishes the
#298 fresh-profile OpenClaw gateway compatibility fix.

## What Changed

- `loo openclaw tool-smoke --gateway-url ...` now uses OpenClaw's current
  protocol-4 backend gateway handshake.
- The backend caller remains a local loopback/token-auth smoke path and keeps
  token values out of public evidence.
- #298 proves a clean OpenClaw profile can install/load the beta package, run
  scoped token env-ref onboarding, start an isolated loopback token gateway, and
  call `loo_doctor` plus `loo_search_sessions` through the same gateway surface
  an OpenClaw agent uses.
- `loo openclaw published-smoke` can now classify the fresh-profile path as
  `setupRecovery.classification: "ready"` when supplied fresh-profile
  tool-smoke evidence, instead of relying only on configured-profile proof.
- `loo release general-readiness --strict` reported `stableReady=true` for the
  #298 evidence packet, but this beta does not promote `latest` or create a
  stable GitHub Release.
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
> envelopes, read-only cockpit/operating-picture cards, public-safe scorecards,
> and fresh-profile gateway-ready proof for `loo_doctor` and
> `loo_search_sessions`.

This release does not widen the beta.24 claim, live-control scope,
desktop-collaboration scope, Claude adapter scope, P1 business-adapter scope, or
stable/1.0 claim scope. The reduced-scope release claim remains
`codex-read-search-expand-dry-run` unless a separate release status packet
proves a broader claim.

## Release Gate Notes

- Evidence: `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/issue-fresh-profile-gateway-ready-proof/`.
- Fresh-profile `loo openclaw tool-smoke` evidence is public-safe and records
  `toolSmokeReady=true`, `setupStatus.classification: "ready"`, no setup
  blockers, and no live Codex control or desktop GUI action.
- `published-smoke` reports `publishedSmokeReady=true`, `setupRequired=false`,
  and `setupRecovery.ready=true` for the fresh-profile path.
- `general-readiness` reports `stableReady=true` for the evidence packet, but
  stable/latest publication remains a separate release decision.
- `approved_live_control_smoke_missing` remains the blocker when a working-app
  claim is attempted without approved live-control smoke evidence.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- If this candidate is published, npm `beta` points at `0.1.0-beta.35`.
  `latest` is not promoted.

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
It does not run generic GUI mutation and does not run Codex GUI mutation.
No automatic gateway authorization.
No broad gateway scope approval. No prompt typing. No clicking. No arbitrary app control.
Claude Code remains an adapter stub, not an adapter-equivalence claim.
Bundle/status checks do not publish to npm and do not create a GitHub Release.
No release-grade enterprise security.
No Claude Code parity, no Notion/support-control/Stripe/Company Brain P1
adapter proof, no cloud sync, no unattended desktop takeover, no stable release,
no npm `latest` promotion, no GitHub Release creation, and no
enterprise/customer-ready security is claimed.
