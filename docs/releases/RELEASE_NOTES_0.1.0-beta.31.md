# Release Notes 0.1.0-beta.31

`0.1.0-beta.31` keeps the Codex-first working-app beta scope for local Codex
sessions and publishes the scored v1.0 scorecard gate from #278.

## What Changed

- #278 replaces the remaining bundled `example-not-run` v1.0 scorecards with
  scored public-safe beta boundaries for the reduced `codex-read-search-expand-dry-run`
  claim scope.
- The scorecard sweep now passes strict mode for the current bundled beta
  scorecards while still failing closed for any copied or custom scorecard
  directory that contains placeholder `example-not-run` evidence.
- The scored cards keep narrow proof boundaries for:
  - public claims and release wording,
  - retrieval quality and visible-map coverage,
  - safety bypass/fail-closed behavior,
  - local Mac UI and desktop proof-action boundaries,
  - orchestrator leverage prioritization.
- `VISION.md` now describes `evals/scorecards/v1.0` as versioned scorecards
  rather than examples, matching their role in the release gate.
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
> envelopes, read-only cockpit/operating-picture cards, and public-safe scored
> v1.0 scorecards for the reduced beta gate.

This release does not widen the beta.24 claim, live-control scope, or
desktop-collaboration scope. It only publishes scorecard gate truth that is
already merged on `main`.

## Release Gate Notes

- `loo scorecards sweep --claim-scope codex-read-search-expand-dry-run --strict`
  should report `ok=true`, `sweepReady=true`, `publicSafe=true`, and no blockers
  for the bundled v1.0 scorecards.
- Strict mode still fails closed when a release-candidate scorecard source
  contains `example-not-run`, invalid JSON, missing required fields, failing
  scores, missing required scorecards, or raw evidence artifacts.
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
- `latest` remains pinned to `0.1.0-beta.4`; if this candidate is published,
  npm `beta` points at `0.1.0-beta.31`.

## Explicit Non-Claims

Claude Code remains an adapter stub, not an adapter-equivalence claim. This beta
runs no new live Codex control smoke, does not run generic GUI mutation, and
does not run Codex GUI mutation. No automatic gateway authorization, no broad gateway scope approval, no prompt typing, no clicking, no arbitrary app control, No cloud sync, no 1.0/stable readiness, No unattended desktop takeover, No release-grade enterprise security, and no enterprise/customer-ready security are claimed. Bundle/status checks do not publish to npm and do not create a GitHub Release.
