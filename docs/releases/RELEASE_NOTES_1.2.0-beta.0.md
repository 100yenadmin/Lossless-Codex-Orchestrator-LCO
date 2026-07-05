# Release Notes 1.2.0-beta.0

`1.2.0-beta.0` is a prerelease checkpoint for Codex-first local orchestration
over local Codex sessions and the LCO 1.2 prepared-state and summary-leaf
sprint. It publishes the local derived-cache foundations that let OpenClaw/Eva
start from public-safe prepared Codex state before asking for bounded expansion.

This release is intentionally on the npm `beta` channel. It does not promote
`latest` and it does not claim 1.2 GA.

## What Changed

- Added explicit mutation-family policy for local derived-cache writes, source
  store mutation, external writes, live control, GUI mutation, and release
  publication.
- Added additive prepared-state SQLite tables for source events, source ranges,
  summary leaves, prepared cards, watcher observations, hook capture packets,
  attention queue items, and state-prep jobs.
- Added deterministic summary leaves and bounded `loo_summary_expand` lineage
  over public-safe source ranges.
- Added prepared cards and deterministic prepared inbox tools:
  `loo_prepared_state_status`, `loo_prepared_cards`, and
  `loo_prepared_inbox`.
- Added persisted watcher observations, execute-false attention queue items,
  and deterministic prep-runner/job surfaces.
- Added hook sidecar capture for closeouts, state prep, and marker-only
  compaction capture. Marker mode records lifecycle boundaries only; it does
  not claim true Codex compaction-summary capture.
- Hardened OpenClaw tool-smoke evidence so public-safe validation failures stay
  bounded and do not echo raw plugin output.
- Added first-class Codex control proof states so transport acceptance is not
  represented as durable orchestration success.
- Improved legacy Codex session discovery recall for historical tool-call
  shapes, exact `codex_thread:*` refs, bare thread ids, and app-server display
  aliases.
- Carries forward the #160 desktop proof-action release boundary:
  `loo_desktop_proof_action` / `loo desktop proof-action` validates the CUA Driver TextEdit scratch
  proof gate and does not prove generic GUI mutation.
  The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`
  before the backend can run. Generic gateway invocation without exact proof args fails closed. The desktop proof action keeps the
  same proof boundary as beta.35.
- Carries forward strict OpenClaw gateway result handling:
  plugin output with `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than successful tool proof.

## Current Claim Scope

Allowed prerelease claim:

> Local prepared Codex state and summary-leaf recall for OpenClaw/Eva, including
> additive local derived-cache tables, source ranges, deterministic summary
> leaves, prepared cards, prepared inbox items, watcher observations,
> marker-only hook capture, public-safe scorecards, and approval-gated control
> proof states.

This release remains Codex-first and local-only by default. Prepared state is an
advisory cache, not source authority for PR, CI, release, runtime, customer, or
business truth.

## Release Gate Notes

- Parent 1.2 tracker: #405.
- Release gate issue: #416.
- Baseline stable release: `v1.1.4`.
- Candidate package: `lossless-openclaw-orchestrator@1.2.0-beta.0`.
- Expected npm dist-tag: `beta`.
- Expected git tag: `v1.2.0-beta.0`.
- Expected GitHub Release:
  `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/releases/tag/v1.2.0-beta.0`.
- Required scoped prerelease gates: focused release metadata tests, `npm run
  check`, `npm pack --dry-run`, release preflight, scorecard sweep, scenario
  sweep, OpenClaw dogfood/tool-smoke where gateway setup is available, GitHub
  CI, CodeQL, current-head review threads clear, npm publish to `beta`, GitHub
  prerelease, and post-publish finalization status.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Post-publish finalization example:
  `loo release finalization-status --evidence-dir <path> --candidate-sha <sha> --npm-publish-evidence <path> --git-tag-evidence <path> --github-release-evidence <path> --expected-dist-tag beta --expected-github-prerelease true --strict`
- `approved_live_control_smoke_missing` remains the expected blocker when a
  working-app or live-control claim is attempted without approved live-control
  smoke evidence for the exact candidate SHA.

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
It does not run generic GUI mutation and does not run Codex GUI mutation.
No automatic gateway authorization.
No broad gateway scope approval. No prompt typing. No clicking. No arbitrary app control.
No screenshots or videos are part of the public release evidence.
Claude Code remains an adapter stub, not an adapter-equivalence claim.
No true Codex compaction-summary capture.
No raw transcript upload and no OpenClaw LCM merge.
No Notion, support-control, Stripe, or Company Brain P1 adapter proof.
No cloud sync.
No unattended desktop takeover.
No npm `latest` promotion.
Bundle/status/finalization checks do not publish to npm and do not create a GitHub Release.
No release-grade enterprise security or customer-ready security claim.
