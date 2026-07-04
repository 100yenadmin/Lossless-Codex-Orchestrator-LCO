# Release Notes 1.2.0-beta.2

`1.2.0-beta.2` is a scoped prerelease checkpoint for Codex-first local orchestration
and the LCO 1.2 prepared-state and summary-leaf sprint. It publishes the
visible Codex sidebar inventory and approval-gated start-thread proof hardening
merged after `1.2.0-beta.1`.

This release is intentionally on the npm `beta` channel. It does not promote
`latest` and it does not claim 1.2 GA.

## What Changed

- Hardened visible Codex sidebar inventory so generic action rows can expose
  real sidebar child titles while contained private or redacted residual child
  labels are rejected before public candidates are emitted.
- Preserved public-safe visible Codex extraction for already-sanitized bounded
  actionable rows that carry status or freshness signals.
- Added regression coverage for sidebar child-title extraction, duplicate child
  handling, and residual private child suppression.
- Hardened the approval-gated Codex start-thread workflow:
  - `thread/start` proof states now route callers to the read-only
    `loo_codex_start_thread_post_create_proof` follow-up packet;
  - caller instructions now explicitly require the bounded post-create proof
    before claiming the new thread completed, persisted, or is safe to build on;
  - post-create proof sends the full created thread id to the bounded
    `thread/read` metadata probe while keeping public output capped;
  - long created-thread ids no longer create false negative read-probe results.
- Refreshed OpenClaw plugin tool declarations and tool-surface metadata for the
  post-create proof surface.
- Carries forward the #160 desktop proof-action release boundary:
  `loo_desktop_proof_action` / `loo desktop proof-action` validates the CUA Driver TextEdit scratch proof gate and does not prove generic GUI mutation.
  The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run.
  Generic gateway invocation without exact proof args fails closed. The desktop proof action keeps the same proof boundary as beta.35.
- Carries forward strict OpenClaw gateway result handling: plugin output with
  `output.details.ok: false` is reported as `openclaw_tool_result_not_ok:<tool>`
  rather than successful tool proof.

## Current Claim Scope

Allowed prerelease claim:

> Local prepared Codex state and summary-leaf recall for OpenClaw/Eva, including
> public-safe prepared cards, prepared inbox items, bounded summary expansion,
> visible Codex sidebar inventory, and approval-gated start-thread proof packets
> without raw transcript reads.

Prepared state remains an advisory local derived cache, not source authority
for PR, CI, release, runtime, customer, or business truth.

This release remains focused on local Codex sessions.

## Release Gate Notes

- Parent 1.2 tracker: #405.
- Release checkpoint issue: #469.
- Included implementation PRs: #459 and #464.
- Baseline stable release: `v1.1.4`.
- Candidate package: `lossless-openclaw-orchestrator@1.2.0-beta.2`.
- Expected npm dist-tag: `beta`.
- Expected git tag: `v1.2.0-beta.2`.
- Expected GitHub Release:
  `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/releases/tag/v1.2.0-beta.2`.
- Required scoped prerelease gates: focused release/tool-smoke tests, `npm run
  check`, `npm pack --dry-run`, prepared-state scenario sweep, scorecard/claim
  audit, GitHub CI, CodeQL, current-head review threads clear, npm publish to
  `beta`, GitHub prerelease, and post-publish finalization status.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Post-publish finalization example:
  `loo release finalization-status --evidence-dir <path> --candidate-sha <sha> --npm-publish-evidence <path> --git-tag-evidence <path> --github-release-evidence <path> --expected-dist-tag beta --expected-github-prerelease true --strict`
- `approved_live_control_smoke_missing` remains the expected blocker when a
  working-app or live-control claim is attempted without approved live-control
  smoke evidence for the exact candidate SHA.
- Bundle/status/finalization checks do not publish to npm and do not create a GitHub Release.

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
