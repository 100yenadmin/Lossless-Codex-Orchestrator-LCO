# Release Notes 0.1.0-beta.30

`0.1.0-beta.30` keeps the Codex-first working-app beta scope for local Codex sessions
and publishes the M10 external-tester first-run recovery hardening for
npm selector drift.

## What Changed

- #248 adds guarded npm registry tarball fallback commands to `loo onboard
  status` so external testers and agents can recover when npm dist-tag metadata
  is visible but `npm install lossless-openclaw-orchestrator@beta` hits selector
  cutoff drift.
- The recovery contract now covers the global CLI install, clean-profile
  OpenClaw plugin install, and `loo openclaw dogfood --install-source` path.
- The tarball fallback commands fail closed with `test -n "$tarball_url"` before
  install, so an empty registry lookup cannot silently install the wrong local
  package.
- `VISION.md` and the packaging/install scorecard now require the public-safe
  onboarding evidence to expose the guarded global/OpenClaw/dogfood fallback
  commands.
- #160 continues to ship `loo_desktop_proof_action` /
  `loo desktop proof-action`, limited to one CUA Driver TextEdit scratch proof
  path. The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run.
- #160 proves generic gateway invocation without exact proof args fails closed.
- #160 keeps the `loo openclaw tool-smoke` hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.

## Current Claim Scope

Allowed beta claim:

> Codex-first working-app beta through installed OpenClaw gateway for local
> Codex sessions, plus public-safe agent handoff docs, gateway dogfood,
> clean-profile install proof, install/onboarding recovery guidance,
> post-install self-check classification, one-command published package smoke
> reporting, and fail-closed release/general-readiness gates.

This release does not widen the beta.24 claim except through the later
package/onboarding and M9/M10 agent handoff gates. It only publishes the
selector-drift recovery guidance that is already merged on `main`.

## Release Gate Notes

- `loo onboard status --strict` emits the `installRecovery` block with:
  - `tarballLookupCommand`
  - `globalInstallTarballFallbackCommand`
  - `openclawInstallTarballFallbackCommand`
  - `dogfoodTarballFallbackCommand`
- A public-safe post-install self-check example:
  `loo onboard status --evidence-dir <path> --registry-beta-version 0.1.0-beta.30 --gateway-setup-status gateway_setup_required --strict`
- `loo openclaw published-smoke --strict` remains the one-command published
  package smoke report for first-run OpenClaw gateway package proof.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Use `codex-working-app-proof` only when the candidate has approved live-control
  smoke evidence plus runtime proof markers.
- `approved_live_control_smoke_missing` remains the blocker when a working-app
  claim is attempted without approved live-control smoke evidence.
- `latest` remains pinned to `0.1.0-beta.4`; if this candidate is published,
  npm `beta` points at `0.1.0-beta.30`.

## Explicit Non-Claims

Claude Code remains an adapter stub, not a parity claim. This beta runs no new live Codex control smoke, does not run generic GUI mutation, and does not run Codex GUI mutation. No automatic gateway authorization, no broad gateway scope approval, no prompt typing, no clicking, no arbitrary app control, no Claude parity, No cloud sync, no 1.0/stable readiness, No unattended desktop takeover, No release-grade enterprise security, and no enterprise/customer-ready security are claimed. Bundle/status checks do not publish to npm and do not create a GitHub Release. Bundle/status checks do not create a GitHub Release.
