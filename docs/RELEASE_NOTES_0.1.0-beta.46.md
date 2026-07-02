# Release Notes 0.1.0-beta.46

`0.1.0-beta.46` keeps the Codex-first local orchestration beta scope and
publishes the #363 npm selector-drift diagnostic hardening for first-run
package smoke evidence.

## What Changed

- `loo openclaw published-smoke` now accepts
  `--npm-install-diagnostic-report <path>`.
- Public-safe npm install diagnostics can now distinguish
  `npm_selector_drift_with_tarball_fallback` from a true package failure.
- When registry tarball fallback install proof is supplied, published-smoke
  exposes guarded tarball fallback commands in both `setupRecovery.nextSafeCommands`
  and top-level `nextSafeCommands`.
- Missing tarball fallback proof stays fail-closed as
  `npm_selector_drift_unproved` / package-not-ready.
- `loo openclaw published-smoke --help`, VISION, setup docs, and the packaging
  scorecard now describe the selector-drift diagnostic evidence path.

## Current Claim Scope

Allowed beta claim:

> Codex-first beta through installed OpenClaw gateway for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only cockpit/operating-picture cards, deterministic cockpit
> replayability, public-safe scorecards, gateway-ready proof for core `loo_*`
> workflows, read-only collaboration next-step planning packets, read-only
> active-thread state classification, non-executed active-thread control
> dry-run recommendation packets, action-bound dry-run Desktop collaboration
> proof packets, read-only runtime Desktop visibility status reporting,
> public-safe CLI help/diagnostic/error surfaces, and public-safe
> published-smoke selector-drift diagnostics with guarded tarball fallback
> recovery commands.

This release does not widen the beta.45 live-control scope, GUI mutation scope,
Claude adapter scope, P1 business-adapter scope, or stable/1.0 claim scope. The
reduced-scope release claim remains `codex-read-search-expand-dry-run` unless a
separate release status packet proves a broader claim.

## Release Gate Notes

- Release evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-03/release-0.1.0-beta.46/`.
- Implementation evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-03/issue-npm-selector-drift-diagnostics/`.
- PR #364 merged at `cd2b6b55e36c8ea45028ecad5533f4c815553cda`.
- PR #364 gates passed:
  - GitHub CI `test`
  - CodeQL
  - CodeRabbit status context on the current head
  - current-head GitHub review threads clear
  - focused package/docs/help tests
  - merged-main `npm run check`
  - public-safe published-smoke selector-drift CLI smoke
  - GitNexus incremental refresh on merged main
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Both status examples include the required `--evidence-dir <path>` flag.
- If this candidate is published, npm `beta` points at `0.1.0-beta.46`.
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
