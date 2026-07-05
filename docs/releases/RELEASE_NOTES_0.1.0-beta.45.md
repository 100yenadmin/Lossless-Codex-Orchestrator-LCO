# Release Notes 0.1.0-beta.45

`0.1.0-beta.45` keeps the Codex-first local orchestration beta scope and
publishes the #359 active-thread control dry-run recommendation packet slice.

## What Changed

- `loo_codex_active_thread_state` now includes public-safe `nextControlDryRun`
  recommendation packets for lanes classified as `needs_nudge` or
  `needs_approval`.
- Recommendation packets point at the exact future tool handoff,
  `loo_codex_control_dry_run`, with `execute: false`, `action: "resume"`, and
  a sanitized thread id.
- Recommendation packets never include the prompt/message text and do not mint
  or imply an `approval_audit_id`. They are handoff guidance only.
- `needs_approval` recommendations are reported as `blocked` until a separate
  approval path exists; live control still requires matching dry-run proof, an
  `approval_audit_id`, and Codex approval/sandbox gates.
- OpenClaw tool-smoke validation now counts and validates active-thread
  dry-run recommendation packets without executing them.
- Agent docs, scenario contracts, and scorecards now explain the safe handoff
  boundary for active-thread nudges.

## Current Claim Scope

Allowed beta claim:

> Codex-first beta through installed OpenClaw gateway for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only cockpit/operating-picture cards, deterministic cockpit
> replayability, public-safe scorecards, gateway-ready proof for core `loo_*`
> workflows, read-only collaboration next-step planning packets, read-only
> active-thread state classification, non-executed active-thread control
> dry-run recommendation packets, action-bound dry-run Desktop collaboration
> proof packets, read-only runtime Desktop visibility status reporting, and
> public-safe CLI help/diagnostic/error surfaces.

This release does not widen the beta.44 live-control scope, GUI mutation scope,
Claude adapter scope, P1 business-adapter scope, or stable/1.0 claim scope. The
reduced-scope release claim remains `codex-read-search-expand-dry-run` unless a
separate release status packet proves a broader claim.

## Release Gate Notes

- Evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-03/release-0.1.0-beta.45/`.
- Implementation evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-03/issue-active-thread-control-dry-run-packets/`.
- PR #360 merged at `73d922c0bc9ee1aba459952e26e29ea523aa4988`.
- PR #360 gates passed:
  - GitHub CI `test`
  - CodeQL
  - CodeRabbit status context on the current head
  - current-head GitHub review threads clear
  - focused active-thread/OpenClaw smoke/scenario/scorecard tests
  - OpenClaw gateway dogfood for `loo_codex_active_thread_state`
  - merged-main `npm run check`
  - GitNexus incremental refresh on merged main
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Both status examples include the required `--evidence-dir <path>` flag.
- If this candidate is published, npm `beta` points at `0.1.0-beta.45`.
  `latest` is not promoted.
- `approved_live_control_smoke_missing` remains the blocker when a working-app
  claim is attempted without approved live-control smoke evidence.

## Carried-Forward Desktop Proof-Action Boundary

- #160 continues to ship `loo_desktop_proof_action` /
  `loo desktop proof-action`, limited to one CUA Driver TextEdit scratch proof
  path. The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run. This release does not widen that GUI action surface.
- #160 proves generic gateway invocation without exact proof args fails closed.
- #160 keeps the OpenClaw tool-smoke hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.
- It uses the same proof boundary as beta.35 for #160 desktop proof-action and
  fallback status behavior.

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
