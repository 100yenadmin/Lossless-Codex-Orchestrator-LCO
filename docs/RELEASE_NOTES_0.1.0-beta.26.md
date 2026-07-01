# Release Notes 0.1.0-beta.26

`0.1.0-beta.26` keeps the Codex-first working-app beta scope, carries forward
the #160 desktop proof-action gate from beta.25, and publishes the #221
install/onboarding recovery contract for the published beta package path.

## What Changed

- #221 adds a public-safe `installRecovery` block to `loo onboard status`.
- #221 names the published package, clean OpenClaw profile, npm registry check,
  global install command, OpenClaw plugin install command, dogfood command,
  tool-smoke command, and setup guidance for gateway credential/device-pairing
  blockers.
- #221 updates `VISION.md` and the packaging/install scorecard so future
  release gates require this recovery contract when install/onboarding claims
  are made.
- #221 proves `lossless-openclaw-orchestrator@beta` installs into the
  `lco-dogfood-published` profile and classifies a fresh-profile gateway
  blocker as `gateway_setup_required` rather than a package failure.
- #160 continues to ship `loo_desktop_proof_action` /
  `loo desktop proof-action`, limited to one CUA Driver TextEdit scratch proof
  path.
- #160 requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the proof action can call the backend.
- #160 proves generic gateway invocation without exact proof args fails closed.
- #160 keeps the `loo openclaw tool-smoke` hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.

## Current Claim Scope

Allowed beta claim:

> Codex-first working-app beta through installed OpenClaw gateway for local Codex sessions, plus public-safe install/onboarding recovery guidance for the
> published beta package.

This release does not widen the beta.24 claim or the beta.25 runtime claim.
Desktop collaboration
remains limited to the CUA Driver TextEdit scratch proof-action path when that
specific proof is claimed. Generic GUI mutation, Codex GUI mutation, prompt
typing, clicking, arbitrary app control, and unattended takeover remain
excluded. Claude Code remains an adapter stub, not a parity claim.

## Release Gate Notes

- `loo onboard status --strict` must emit the `installRecovery` block.
- Published-beta install dogfood should use the clean profile named by
  `installRecovery.cleanProfile` unless a different profile is intentionally
  documented in evidence.
- Fresh-profile `openclaw_gateway_credentials_required` is first-run setup, not
  a package defect, when the package install/list proof is otherwise clean and
  `setupStatus.packageInstallLikelyOk=true`.
- Working-app status example: `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example: `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Use `codex-working-app-proof` only when the candidate has approved
  live-control smoke evidence plus runtime proof markers.
- `approved_live_control_smoke_missing` remains the blocker when a working-app
  claim is attempted without approved live-control smoke evidence.
- `latest` remains pinned to `0.1.0-beta.4`; if this candidate is published,
  npm `beta` points at `0.1.0-beta.26`.

## Explicit Non-Claims

This beta runs no new live Codex control smoke, does not run generic GUI mutation, and does not run Codex GUI mutation. No automatic gateway authorization, no broad gateway scope approval, no prompt typing, no clicking, no arbitrary app control, no Claude parity, no cloud sync, no 1.0/stable readiness, no unattended desktop takeover, no release-grade enterprise security, and no enterprise/customer-ready security are claimed. Bundle/status checks do not publish to npm and do not create a GitHub Release.
