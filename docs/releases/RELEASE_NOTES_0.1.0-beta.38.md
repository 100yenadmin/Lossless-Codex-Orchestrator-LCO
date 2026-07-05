# Release Notes 0.1.0-beta.38

`0.1.0-beta.38` keeps the Codex-first local orchestration beta scope and
publishes the #326 / PR #327 read-only collaboration next-step planner.

## What Changed

- Added `loo_codex_collaboration_next_steps`, a read-only planner that turns
  collaboration cockpit, Desktop coherence, Desktop fallback, and watcher state
  into exact next tool-call packets with `execute=false`.
- Planner output now carries explicit blockers, confidence, approval boundary,
  source thread refs, and public-safe packet args so an OpenClaw agent can decide
  the next bounded read-only action without reading raw transcripts.
- Hardened planner safety gates across review rounds:
  - approval-needed lanes block before Desktop probes,
  - watcher packet fields hash token-shaped caller input,
  - caller-controlled timestamps are normalized before public output,
  - malformed coherence states clamp to `unknown`,
  - duplicate watcher ids are keyed with target refs,
  - Desktop fallback blockers preserve `approval_required` when session approval
    is also required,
  - fallback-status packets are not suggested when coherence already proves
    `desktop_visible`.
- Updated OpenClaw tool-smoke, scenario, scorecard, README, VISION, and agent
  skill contracts to include the planner's `execute=false` packet boundary.
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
> gateway-ready proof for core `loo_*` workflows, and read-only collaboration
> next-step planning packets.

This release does not widen the beta.37 live-control scope,
desktop-collaboration scope, Claude adapter scope, P1 business-adapter scope, or
stable/1.0 claim scope. The reduced-scope release claim remains
`codex-read-search-expand-dry-run` unless a separate release status packet
proves a broader claim.
It uses the same proof boundary as beta.35 for desktop proof-action and fallback
status behavior.

## Release Gate Notes

- Evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/release-0.1.0-beta.38/`.
- PR #327 merged at `63d2346c43b942d846958c97ffe244748551a2d1`.
- PR #327 pre-merge gates passed:
  - GitHub CI `test`
  - CodeQL
  - CodeRabbit status
  - current actionable review threads: 0
  - focused local autonomy test: 32 pass / 0 fail
  - focused local planner/smoke/scenario/scorecard/doc bundle: 94 pass / 0 fail
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- If this candidate is published, npm `beta` points at `0.1.0-beta.38`.
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
adapter proof, no cloud sync, no unattended desktop takeover, no stable release,
no npm `latest` promotion, and no enterprise/customer-ready security is claimed.
