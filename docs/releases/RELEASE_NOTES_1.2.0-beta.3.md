# Release Notes 1.2.0-beta.3

`1.2.0-beta.3` is a scoped prerelease checkpoint for Codex-first local orchestration
and the LCO 1.2 prepared-state sprint. It publishes semantic
prepared-card lifecycle routing and the completed-card target coverage follow-up
merged after `1.2.0-beta.2`.

This release is intentionally on the npm `beta` channel. It does not promote
`latest` and it does not claim 1.2 GA.

## What Changed

- Added semantic lifecycle states for prepared cards and prepared inbox routing:
  `completed`, `blocked_missing_info`, `waiting_approval`,
  `watching_external_check`, `needs_resume`, `dirty_worktree_handoff`,
  `ready_for_review`, `stale_or_partial`, and `unknown_lifecycle`.
- Exposed the lifecycle state enum through the shared core registry, MCP tool
  schema, OpenClaw plugin manifests, and OpenClaw gateway smoke validation.
- Added deterministic lifecycle reason codes, lifecycle-aware next actions, and
  urgency ranking for advisory prepared cards.
- Added a completed-card summary counter so finished lanes remain visible in
  prepared-card summaries instead of disappearing from stale/partial/unknown
  counters.
- Tightened lifecycle classification so generic words such as `resume`,
  `monitor`, and `ci` do not become lifecycle states without operator-action
  context.
- Fixed completed prepared-card target coverage so a fresh public completed card
  counts as target coverage `ok` and does not make `loo_prepared_state_status`
  report stale/partial coverage for a fully materialized completed lane.
- Preserved stale, partial, unknown, unsafe-row, and stale-freshness downgrades
  for incomplete or unsafe prepared-state evidence.
- Carries forward the #160 desktop proof-action release boundary:
  `loo_desktop_proof_action` / `loo desktop proof-action` validates the CUA Driver TextEdit scratch proof gate and does not prove generic GUI mutation.
  The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run.
  Generic gateway invocation without exact proof args fails closed. The desktop proof action keeps the same proof boundary as beta.35.
- Carries forward strict OpenClaw gateway result handling: plugin output with
  `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than successful tool proof.

## Current Claim Scope

Allowed prerelease claim:

> Local prepared Codex state and summary-leaf recall for OpenClaw/Eva, including
> semantic prepared-card lifecycle routing, prepared inbox prioritization,
> bounded summary expansion, visible Codex sidebar inventory, and
> approval-gated start-thread proof packets without raw transcript reads.

Prepared state remains an advisory local derived cache, not source authority
for PR, CI, release, runtime, customer, or business truth.

This release remains focused on local Codex sessions.

## Release Gate Notes

- Parent 1.2 tracker: #405.
- Cockpit tracker: #448.
- Release checkpoint issue: #473.
- Included implementation PRs: #452 and #472.
- Baseline stable release: `v1.1.4`.
- Prior beta release: `v1.2.0-beta.2`.
- Candidate package: `lossless-openclaw-orchestrator@1.2.0-beta.3`.
- Expected npm dist-tag: `beta`.
- Expected git tag: `v1.2.0-beta.3`.
- Expected GitHub Release:
  `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/releases/tag/v1.2.0-beta.3`.
- Required scoped prerelease gates: focused prepared-card/OpenClaw tool-smoke
  tests, build/typecheck, `npm pack --dry-run`, release bundle/status checks,
  GitHub CI, CodeQL, current-head review threads clear, npm publish to `beta`,
  GitHub prerelease, and post-publish finalization status.
- Bundle/status/finalization checks do not publish to npm and do not create a GitHub Release.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
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
No model compaction proof.
No raw transcript upload and no OpenClaw LCM merge.
No Notion, support-control, Stripe, or Company Brain P1 adapter proof.
No cloud sync.
No unattended desktop takeover.
No npm `latest` promotion.
No release-grade enterprise security or customer-ready security claim.
