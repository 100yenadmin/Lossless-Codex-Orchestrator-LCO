# Release Notes 1.1.0

`1.1.0` is the stable release for the post-1.0 Codex collaboration cockpit and
OpenClaw gateway proof lane.

It promotes the proven beta.49 train into npm `latest` only after #387 reruns
the stable release gates against the exact candidate SHA. Beta packages remain
on `beta`; release candidates remain on `next`.

## What Changed

- Promotes the package and OpenClaw plugin manifests to `1.1.0` with
  `publishConfig.tag` set to `latest`.
- Carries forward the stable `1.0.0` Codex-first local orchestration surface:
  local Codex indexing, search, describe, bounded expansion, plans, final
  messages, touched files, tool metadata, dry-run control envelopes, safe
  summaries, OpenClaw gateway dogfood, and public-safe scorecards.
- Promotes the post-1.0 collaboration cockpit work into the stable channel:
  `loo_codex_collaboration_cockpit`,
  `loo_codex_collaboration_next_steps`,
  `loo_codex_runtime_desktop_visibility_status`,
  `loo_codex_active_thread_state`, and `loo_codex_autonomy_tick`.
- Carries forward the read-only Desktop visibility and fallback proof surface:
  `loo_codex_desktop_coherence`, `loo_codex_desktop_fallback_status`, and the
  action-bound `loo_codex_desktop_collaboration_proof` validator.
- Carries forward the release finalization gate from beta.49:
  `loo release finalization-status` verifies npm package/dist-tag evidence, git
  tag evidence, and GitHub Release evidence against the exact release candidate
  SHA.
- Keeps OpenClaw gateway smoke strict: a gateway envelope that reaches a tool
  but returns plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a successful tool proof.

## Stable Claim Scope

Allowed stable claim:

> Codex-first local orchestration through OpenClaw for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only collaboration cockpit/autonomy cards, read-only Desktop
> visibility and fallback status, action-bound proof-packet validation,
> public-safe scorecards, and installed OpenClaw gateway dogfood.

This release does not widen the live-control matrix, GUI mutation scope, Claude
adapter scope, P1 business-adapter scope, or enterprise/customer readiness
claim. The reduced-scope release gate remains
`codex-read-search-expand-dry-run` unless a release-status packet for the exact
candidate SHA proves and records a broader claim.

## Release Gate Notes

- Stable issue: #387.
- Parent product tracker: #309.
- Operating-loop tracker: #16.
- Baseline stable release: `v1.0.0`.
- Baseline beta release: `v0.1.0-beta.49`.
- Desktop proof-action lineage: #160 remains the proof boundary for
  `loo_desktop_proof_action` / `loo desktop proof-action`, the action-bound
  CUA Driver TextEdit scratch proof gate, and does not prove generic GUI
  mutation.
  The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run.
  Generic gateway invocation without exact proof args fails closed. This release
  uses the same proof boundary as beta.35 for #160 desktop proof-action and
  fallback status behavior.
- Candidate package: `lossless-openclaw-orchestrator@1.1.0`.
- Expected git tag: `v1.1.0`.
- Expected GitHub Release:
  `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/releases/tag/v1.1.0`.
- Required pre-publish stable gates: `npm run check`, `npm pack --dry-run`,
  strict scenario sweep, strict scorecard sweep, release preflight, release
  bundle, release demo-status, release status, OpenClaw dogfood, and OpenClaw
  tool-smoke for the exact stable candidate SHA.
- Required PR gates: GitHub CI, CodeQL, current-head review threads clear, and
  any actionable review feedback fixed before merge.
- Required post-publish stable gates: npm `latest` view, git tag, GitHub
  non-prerelease Release, `loo release finalization-status --expected-dist-tag
  latest --expected-github-prerelease false --strict`, fresh npm `@latest`
  published-smoke, and strict general-readiness before #387 closes.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Post-publish finalization example:
  `loo release finalization-status --evidence-dir <path> --candidate-sha <sha> --npm-publish-evidence <path> --git-tag-evidence <path> --github-release-evidence <path> --expected-dist-tag latest --expected-github-prerelease false --strict`
- `approved_live_control_smoke_missing` remains the expected blocker when a
  working-app claim is attempted without approved live-control smoke evidence
  for the exact candidate SHA.

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
It does not run generic GUI mutation and does not run Codex GUI mutation.
No automatic gateway authorization.
No broad gateway scope approval. No prompt typing. No clicking. No arbitrary app control.
Claude Code remains an adapter stub, not an adapter-equivalence claim.
Bundle/status/finalization checks do not publish to npm and do not create a GitHub Release.
No release-grade enterprise security.
No Claude Code parity, no Notion/support-control/Stripe/Company Brain P1
adapter proof, no cloud sync, no unattended desktop takeover, and no
enterprise/customer-ready security is claimed.
