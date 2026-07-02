# Release Notes 0.1.0-beta.40

`0.1.0-beta.40` keeps the Codex-first local orchestration beta scope and
publishes the #334 / PR #339 GA community funnel.

## What Changed

- Added a clearer public contributor path from `README.md` into setup,
  `CONTRIBUTING.md`, `AGENTS.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and the
  proof-boundary docs.
- Expanded `CONTRIBUTING.md` for human and coding-agent contributors with issue
  routing, setup, validation, public-safe evidence, review-thread handling, and
  good-first contribution lanes.
- Added a concise repository-agent quick-start to `AGENTS.md`, including the
  security policy and public-safe data boundary before implementation work.
- Replaced Markdown issue templates with structured GitHub issue forms for bug
  reports, docs bugs, feature requests, adapter requests, protocol drift, and
  unsafe-control reports.
- Added a required public-safe evidence field to adapter requests so new
  adapter requests carry triage proof without inviting raw transcripts,
  credentials, private DBs, or customer data.
- Restructured the PR template for a clearer problem, validation, evidence,
  safety, release, and agent-authored disclosure flow.
- Added `CODE_OF_CONDUCT.md`.
- Added `public-community-readiness-review.json` and tests that keep the public
  community funnel from regressing below the GA-readiness baseline.
- Kept the public community scorecard evidence placeholder portable while
  preserving the Lexar evidence boundary for local proof scorecards.
- #160 continues to ship `loo_desktop_proof_action` /
  `loo desktop proof-action`, limited to one CUA Driver TextEdit scratch proof
  path. The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run. This release does not widen that GUI action surface.
- #160 proves generic gateway invocation without exact proof args fails closed.
- #160 keeps the OpenClaw tool-smoke hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.

## Current Claim Scope

Allowed beta claim:

> Codex-first beta through installed OpenClaw gateway for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only cockpit/operating-picture cards, public-safe scorecards,
> gateway-ready proof for core `loo_*` workflows, read-only collaboration
> next-step planning packets, action-bound dry-run Desktop collaboration proof
> packets, and a public contributor/agent handoff funnel.

This release does not widen the beta.39 live-control scope, GUI mutation scope,
Claude adapter scope, P1 business-adapter scope, or stable/1.0 claim scope. The
reduced-scope release claim remains `codex-read-search-expand-dry-run` unless a
separate release status packet proves a broader claim.
It uses the same proof boundary as beta.35 for desktop proof-action and fallback
status behavior.

## Release Gate Notes

- Evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/release-0.1.0-beta.40/`.
- PR #339 merged at `1a48765b9648b466fe3815d08fefb4422a7b9f3e`.
- PR #339 gates passed:
  - GitHub CI `test`
  - CodeQL
  - CodeRabbit status green with no review threads
  - evaOS review completed with no review threads
  - merged-main focused validation: 48 pass / 0 fail
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- If this candidate is published, npm `beta` points at `0.1.0-beta.40`.
  `latest` is not promoted.
- `approved_live_control_smoke_missing` remains the blocker when a working-app
  claim is attempted without approved live-control smoke evidence.

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
It does not run generic GUI mutation and does not run Codex GUI mutation.
No automatic gateway authorization.
No broad gateway scope approval. No prompt typing. No clicking. No arbitrary app control.
Claude Code remains an adapter stub, not an adapter-equivalence claim.
Bundle/status checks do not publish to npm and do not create a GitHub Release.
No release-grade enterprise security.
No Claude Code parity, no Notion/support-control/Stripe/Company Brain P1
adapter proof, no cloud sync, no unattended desktop takeover, no stable release,
no npm `latest` promotion, and no enterprise/customer-ready security is claimed.
