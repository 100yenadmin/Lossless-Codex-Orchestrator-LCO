# Release Notes 0.1.0-beta.34

`0.1.0-beta.34` keeps the Codex-first working-app beta scope for local Codex
sessions and publishes the #290 OpenClaw setup-recovery closeout that merged in
#291.

## What Changed

- `loo openclaw published-smoke` now reports a structured `setupRecovery` block
  for clean OpenClaw first-run failures.
- Setup recovery distinguishes credential, device pairing, scope upgrade, token
  rotation, generic setup, and package/proof failure paths.
- Multiple setup blockers are preserved together so agents can show the full
  recovery checklist instead of only the first blocker.
- Package/path proof failures take precedence over gateway setup guidance, so a
  broken or unproven package install does not produce misleading OpenClaw setup
  commands.
- Recovery command templates now use the documented OpenClaw device operations:
  `openclaw devices approve --latest` and
  `openclaw devices rotate --device <deviceId> --role operator`.
- Release tests cover setup recovery precedence, public-safe recovery output,
  readiness proof fields, and guidance text without embedding token-like
  canaries in the source tree.
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
> v1.0 scorecards, and clearer OpenClaw first-run setup recovery for the
> published package smoke path.

This release does not widen the beta.24 claim, beta.31 claim, beta.32 claim,
beta.33 claim, live-control scope, desktop-collaboration scope, or 1.0/stable
scope. It only publishes package/setup recovery reporting already merged on
`main`.

## Release Gate Notes

- `loo openclaw published-smoke` reports `setupRecovery` alongside the existing
  fresh-profile and configured-profile readiness blocks.
- A fresh profile that still needs credentials, device pairing, scope upgrade,
  or token rotation should remain `setupRequired=true` and
  `publishedSmokeReady=false`.
- A failed package/path proof should report `package_failure_or_unknown` and
  should not claim that OpenClaw gateway setup alone will fix the install.
- `loo scorecards sweep --claim-scope codex-read-search-expand-dry-run --strict`
  should report `ok=true`, `sweepReady=true`, `publicSafe=true`, and no blockers
  for the bundled v1.0 scorecards.
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
- If this candidate is published, npm `beta` points at `0.1.0-beta.34`.
  `latest` remains pinned to the pre-stable line and is not promoted.

## Explicit Non-Claims

Claude Code remains an adapter stub, not an adapter-equivalence claim. This beta
runs no new live Codex control smoke, does not run generic GUI mutation, and
does not run Codex GUI mutation. No automatic gateway authorization, no broad
gateway scope approval, no prompt typing, no clicking, no arbitrary app control,
no cloud sync, no 1.0/stable readiness, no unattended desktop takeover, no
release-grade enterprise security, and no enterprise/customer-ready security are
claimed.

No cloud sync. No unattended desktop takeover. No release-grade enterprise security.
Bundle/status checks do not publish to npm and do not create a GitHub Release.
No broad gateway scope approval is claimed. No release-grade enterprise security is claimed.
