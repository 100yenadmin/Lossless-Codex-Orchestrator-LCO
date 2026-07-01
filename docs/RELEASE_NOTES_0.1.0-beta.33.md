# Release Notes 0.1.0-beta.33

`0.1.0-beta.33` keeps the Codex-first working-app beta scope for local Codex
sessions and publishes the #286 sprint-truth closeout that merged in #287.

## What Changed

- README now names the current sprint as `1.0 RC External Tester Readiness`.
- VISION now names the current milestone as `1.0 RC Hardening and External
  Tester Readiness`.
- The Codex Autonomy Cockpit and Eva Operating Picture P0 lanes are recorded as
  completed beta foundation instead of the active child-work list.
- Closed P0 children such as #271 cockpit card cleanup and #272 Eva cockpit
  dogfood are described as completed proof, not active hardening.
- The docs contract test now blocks stale active/current references to closed
  #271/#272 work and the old README `first child #256` wording.
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
> v1.0 scorecards, and clearer public docs for the current external-tester
> readiness lane.

This release does not widen the beta.24 claim, beta.31 claim, beta.32 claim,
live-control scope, or desktop-collaboration scope. It only publishes
README/VISION truth alignment that is already merged on `main`.

## Release Gate Notes

- `loo scorecards sweep --claim-scope codex-read-search-expand-dry-run --strict`
  should report `ok=true`, `sweepReady=true`, `publicSafe=true`, and no blockers
  for the bundled v1.0 scorecards.
- `loo release preflight --claim-scope codex-read-search-expand-dry-run --strict`
  should report `releaseReady=true` while keeping approved live-control and
  working-app runtime proof as excluded claims for this reduced release scope.
- `loo release status --claim-scope codex-read-search-expand-dry-run --strict`
  still requires exact candidate SHA, CI proof, CodeQL proof, and explicit
  operation approval markers before npm publish.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Use `codex-working-app-proof` only when the candidate has approved
  live-control smoke evidence plus runtime proof markers.
- `approved_live_control_smoke_missing` remains the blocker when a working-app
  claim is attempted without approved live-control smoke evidence.
- If this candidate is published, npm `beta` points at `0.1.0-beta.33`.
  `latest` remains pinned to the pre-stable line and is not promoted.

## Explicit Non-Claims

Claude Code remains an adapter stub, not an adapter-equivalence claim. This beta
runs no new live Codex control smoke, does not run generic GUI mutation, and
does not run Codex GUI mutation. No automatic gateway authorization, no broad
gateway scope approval, no prompt typing, no clicking, no arbitrary app control,
no cloud sync, no 1.0/stable readiness, no unattended desktop takeover, no
release-grade enterprise security, and no enterprise/customer-ready security are
claimed. Bundle/status checks do not publish to npm and do not create a GitHub Release.
No broad gateway scope approval is claimed. No release-grade enterprise security
is claimed.
