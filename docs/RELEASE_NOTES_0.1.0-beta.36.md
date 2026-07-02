# Release Notes 0.1.0-beta.36

`0.1.0-beta.36` keeps the Codex-first local orchestration beta scope and
publishes the #315 / PR #320 desktop fallback status coherence hardening. It
uses the same proof boundary as beta.35 and keeps the #160 desktop
proof-action gate in the package.

## What Changed

- `loo openclaw tool-smoke --required-tool loo_codex_desktop_fallback_status
  --desktop-fallback-coherence omit --strict` now fails closed when a gateway or
  plugin returns `fallback.reason: "coherence_input_missing"` without a
  public-safe `nextToolCall` for `loo_codex_desktop_coherence`.
- `loo_codex_desktop_fallback_status` now detects mismatched `thread_id` and
  `codex_thread:*` source refs before emitting coherence handoff args. The
  report returns `target_mismatch` plus `coherence_input_missing` instead of a
  dead-end handoff.
- `loo_codex_collaboration_cockpit` now preserves top-level fallback blockers
  from desktop fallback reports, so OpenClaw/Eva cockpit consumers see the
  required coherence handoff as an actionable blocked desktop state without
  claiming GUI fallback approval.
- #160 continues to ship `loo_desktop_proof_action` /
  `loo desktop proof-action`, limited to one CUA Driver TextEdit scratch proof
  path. The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run.
- #160 proves generic gateway invocation without exact proof args fails closed.
- #160 keeps the `loo openclaw tool-smoke` hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.
- #315 remains read-only and public-safe: no live Codex control, GUI mutation,
  screenshots, raw transcript reads, npm latest promotion, or stable/1.0 claim
  expansion is part of this beta.

## Current Claim Scope

Allowed beta claim:

> Codex-first beta through installed OpenClaw gateway for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only cockpit/operating-picture cards, public-safe scorecards,
> and gateway-ready proof for core `loo_*` workflows.

This release does not widen the beta.35 claim, live-control scope,
desktop-collaboration scope, Claude adapter scope, P1 business-adapter scope, or
stable/1.0 claim scope. The reduced-scope release claim remains
`codex-read-search-expand-dry-run` unless a separate release status packet
proves a broader claim.

## Release Gate Notes

- Evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/release-0.1.0-beta.36/`.
- PR #320 merged at `e6713fd8f604767ee4d75487b4c0e388fcdfe3b9`.
- Local PR validation before merge passed:
  - `node --test --import tsx tests/openclaw-tool-smoke.test.ts tests/desktop-fallback.test.ts tests/autonomy-operating-picture.test.ts`
  - `npm run check`
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- If this candidate is published, npm `beta` points at `0.1.0-beta.36`.
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
