# Release Notes 0.1.0-beta.42

`0.1.0-beta.42` keeps the Codex-first local orchestration beta scope and
publishes the #347 / PR #348 deterministic cockpit freshness fix.

## What Changed

- `loo_recent_sessions` can now use an injected `now` timestamp through the core
  path, making generated timestamps, freshness ages, stale flags, `active_stale`
  reason codes, and active-lane ordering replayable in evidence packets.
- `loo_cockpit_inbox` and `loo_codex_collaboration_cockpit` now thread the same
  resolved timestamp through active session cards and watcher evaluation.
- Eva operating-picture digest paths now use injected time for generated-at,
  operating window, and Codex-card freshness behavior.
- Added a regression test proving the same indexed session is non-stale at an
  early timestamp and stale at a later timestamp across recent sessions, cockpit
  inbox, and collaboration cockpit reports.
- #160 continues to ship `loo_desktop_proof_action` /
  `loo desktop proof-action`, limited to one CUA Driver TextEdit scratch proof
  path. The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run. This release does not widen that GUI action surface.
- #160 proves generic gateway invocation without exact proof args fails closed.
- #160 keeps the OpenClaw tool-smoke hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.

## Current Claim Scope

Allowed beta claim:

> Codex-first beta through installed OpenClaw gateway for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only cockpit/operating-picture cards, deterministic cockpit
> replayability, public-safe scorecards, gateway-ready proof for core `loo_*`
> workflows, read-only collaboration next-step planning packets, action-bound
> dry-run Desktop collaboration proof packets, and read-only runtime Desktop
> visibility status reporting.

This release does not widen the beta.41 live-control scope, GUI mutation scope,
Claude adapter scope, P1 business-adapter scope, or stable/1.0 claim scope. The
reduced-scope release claim remains `codex-read-search-expand-dry-run` unless a
separate release status packet proves a broader claim.
It uses the same proof boundary as beta.35 for desktop proof-action and fallback
status behavior.

## Release Gate Notes

- Evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/release-0.1.0-beta.42/`.
- PR #348 merged at `712f5c55b79d084fbf2fadac770644ccd958915e`.
- PR #348 gates passed:
  - GitHub CI `test`
  - CodeQL
  - CodeRabbit status passed with no review threads
  - focused local red/green autonomy cockpit proof
  - merged-main focused tests
  - GitNexus refresh to `712f5c5`
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- If this candidate is published, npm `beta` points at `0.1.0-beta.42`.
  `latest` is not promoted.
- `approved_live_control_smoke_missing` remains the blocker when a working-app
  claim is attempted without approved live-control smoke evidence.

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
It does not run generic GUI mutation and does not run Codex GUI mutation.
No automatic gateway authorization.
No broad gateway scope approval. No prompt typing. No clicking. No arbitrary app control.
Claude Code remains an adapter stub, not an adapter-equivalence claim.
Bundle/status checks do not publish to npm and do not create a GitHub Release.
No release-grade enterprise security.
No Claude Code parity, no Notion/support-control/Stripe/Company Brain P1
adapter proof, no cloud sync, no unattended desktop takeover, no npm `latest`
promotion, and no enterprise/customer-ready security is claimed.
