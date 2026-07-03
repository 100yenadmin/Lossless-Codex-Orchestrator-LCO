# Release Notes 0.1.0-beta.49

`0.1.0-beta.49` keeps the Codex-first local orchestration beta scope and
publishes the #375 / PR #376 release finalization gate.

## What Changed

- Added `loo release finalization-status`, a public-safe post-publish gate that
  verifies npm publish/dist-tag evidence, git tag evidence, and GitHub Release
  evidence against the release candidate SHA.
- The gate fails closed on missing publish/tag/release evidence, npm dist-tag
  version mismatch, git tag SHA mismatch, GitHub prerelease mismatch, invalid
  candidate SHA, and token-like evidence values.
- The beta release runbook and stable checklist now say a release is not
  complete until the npm package, git tag, and GitHub Release all match through
  `release-finalization-status`.
- `0.1.0-beta.48` was retro-verified with the new gate before this release lane:
  npm `beta`, `v0.1.0-beta.48`, and the GitHub prerelease all matched
  `07efef16fb7806e1281001c4a7afe61890db5480`.

## Current Claim Scope

Allowed beta claim:

> Codex-first beta through installed OpenClaw gateway for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only cockpit/operating-picture cards, deterministic cockpit
> replayability, public-safe scorecards, gateway-ready proof for core `loo_*`
> workflows, read-only collaboration next-step planning packets, read-only
> active-thread state classification, active-thread attention coverage with
> non-executed read-only probe recommendations, deterministic autonomy tick
> planning with non-executed read-only probes and control dry-run recommendation
> packets, action-bound dry-run Desktop collaboration proof packets, read-only
> runtime Desktop visibility status reporting, public-safe CLI
> help/diagnostic/error surfaces, public-safe published-smoke selector-drift
> diagnostics with guarded tarball fallback recovery commands, and public-safe
> post-publish release finalization verification.

This release does not widen the beta.45 live-control scope, GUI mutation scope,
Claude adapter scope, P1 business-adapter scope, or stable/1.0 claim scope. The
reduced-scope release claim remains `codex-read-search-expand-dry-run` unless a
separate release status packet proves a broader claim.

## Release Gate Notes

- Implementation PR #376 merged the finalization gate at
  `66770c985ce81a0c737126e815e1ab3a5ce47bdd`.
- Release PR #378 prepares package `lossless-openclaw-orchestrator@0.1.0-beta.49`
  and candidate tarball `lossless-openclaw-orchestrator-0.1.0-beta.49.tgz`.
- Publication finalization, when run, must verify npm dist-tag `beta`, git tag
  `v0.1.0-beta.49`, GitHub prerelease
  `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/releases/tag/v0.1.0-beta.49`,
  and the merged release commit through `loo release finalization-status --strict`.
- PR #376 gates passed:
  - GitHub CI `test`
  - CodeQL
  - CodeRabbit completed on the current head
  - current-head GitHub review threads clear
  - focused release/finalization tests
  - `npm run check`
  - built CLI dogfood of `loo release finalization-status`
  - GitNexus incremental refresh on merged main
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Post-publish finalization example:
  `loo release finalization-status --evidence-dir <path> --candidate-sha <sha> --npm-publish-evidence <path> --git-tag-evidence <path> --github-release-evidence <path> --expected-dist-tag beta --expected-github-prerelease true --strict`
- If this candidate is published, npm `beta` points at `0.1.0-beta.49`.
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
Bundle/status/finalization checks do not publish to npm and do not create a GitHub Release.
No release-grade enterprise security.
No Claude Code parity, no Notion/support-control/Stripe/Company Brain P1
adapter proof, no cloud sync, no unattended desktop takeover, no npm `latest`
promotion, and no enterprise/customer-ready security is claimed.
