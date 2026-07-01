# Release Notes 0.1.0-beta.28

`0.1.0-beta.28` keeps the Codex-first working-app beta scope and publishes
the #229 one-command published package smoke report for first-run OpenClaw
gateway package proof.

## What Changed

- #229 adds `loo openclaw published-smoke`, a public-safe report that combines
  sanitized npm beta version evidence, `loo openclaw dogfood` evidence, and
  `loo openclaw tool-smoke` evidence.
- #229 distinguishes a healthy published package path from remaining first-run
  OpenClaw gateway setup. A clean profile can now report `packagePathOk=true`,
  `publishedSmokeReady=false`, `setupRequired=true`, and
  `gateway_setup_required` without treating credentials or device pairing as a
  package defect.
- #229 records `matches_registry_beta`, `registry_beta_mismatch`,
  `fresh_profile_gateway_credentials_required`, and related status codes
  without storing raw npm stdout/stderr, raw OpenClaw gateway output, raw Codex
  transcripts, SQLite DB contents, screenshots, credentials, or private
  customer data.
- #229 updates `VISION.md` and the packaging/install scorecard so future
  install/onboarding claims require a one-command published package smoke
  report when that proof is relevant.
- #225 continues to ship the public-safe `postInstallSelfCheck` block for
  `loo onboard status`.
- #221 continues to ship the published-beta `installRecovery` block and clean
  profile recovery commands.
- #160 continues to ship `loo_desktop_proof_action` /
  `loo desktop proof-action`, limited to one CUA Driver TextEdit scratch proof
  path. The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run.
- #160 proves generic gateway invocation without exact proof args fails closed.
- #160 keeps the `loo openclaw tool-smoke` hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.

## Current Claim Scope

Allowed beta claim:

> Codex-first working-app beta through installed OpenClaw gateway for local Codex sessions, plus public-safe install/onboarding recovery guidance,
> post-install self-check classification, and one-command published package
> smoke reporting for the published beta package.

This release does not widen the beta.24 claim, the beta.25 runtime claim, the
beta.26 install recovery claim, or the beta.27 post-install self-check claim.
Desktop collaboration remains limited to the CUA Driver TextEdit scratch
proof-action path when that specific proof is claimed. Generic GUI mutation,
Codex GUI mutation, prompt typing, clicking, arbitrary app control, and
unattended takeover remain excluded. Claude Code remains an adapter stub, not a
parity claim.

## Release Gate Notes

- `loo openclaw published-smoke --strict` consumes sanitized dogfood and
  tool-smoke reports and writes `published-package-smoke.json`.
- A public-safe published package smoke example:
  `loo openclaw published-smoke --evidence-dir <path> --registry-beta-version 0.1.0-beta.28 --dogfood-report <path> --tool-smoke-report <path> --strict`
- `loo onboard status --strict` continues to emit both `installRecovery` and
  `postInstallSelfCheck`.
- A public-safe post-install self-check example:
  `loo onboard status --evidence-dir <path> --registry-beta-version 0.1.0-beta.28 --gateway-setup-status gateway_setup_required --strict`
- Use `gateway_setup_required` to classify first-run OpenClaw gateway credential
  or device-pairing blockers without treating them as package defects.
- Working-app status example: `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example: `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Use `codex-working-app-proof` only when the candidate has approved
  live-control smoke evidence plus runtime proof markers.
- `approved_live_control_smoke_missing` remains the blocker when a working-app
  claim is attempted without approved live-control smoke evidence.
- `latest` remains pinned to `0.1.0-beta.4`; if this candidate is published,
  npm `beta` points at `0.1.0-beta.28`.

## Explicit Non-Claims

This beta runs no new live Codex control smoke, does not run generic GUI mutation, and does not run Codex GUI mutation. No automatic gateway authorization, no broad gateway scope approval, no prompt typing, no clicking,
no arbitrary app control, no Claude parity, No cloud sync, no 1.0/stable readiness, No unattended desktop takeover, No release-grade enterprise security,
and no enterprise/customer-ready security are claimed. Bundle/status checks do not publish to npm and do not create a GitHub Release.
