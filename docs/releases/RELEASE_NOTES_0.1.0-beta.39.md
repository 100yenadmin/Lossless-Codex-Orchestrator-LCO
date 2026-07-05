# Release Notes 0.1.0-beta.39

`0.1.0-beta.39` keeps the Codex-first local orchestration beta scope and
publishes the #333 / PR #335 action-bound Codex Desktop collaboration proof.

## What Changed

- Added `loo_codex_desktop_collaboration_proof`, a read-only proof tool that
  validates whether a future Desktop collaboration step is bound to one exact
  indexed Codex thread, one GUI fallback backend, one visible app/window target,
  one supported proof action, one approval packet, and one action hash.
- The tool returns a public-safe report with blockers, reason codes, source
  coverage, proof markers, and a `loo_desktop_live_proof_harness` packet with
  `execute:false`.
- The allowed proof action is intentionally narrow:
  `verify_visible_thread_alignment`.
- Generic GUI actions such as click, type, paste, drag, select, scroll, and
  keypress remain blocked.
- Live Codex control words such as continue, send, steer, resume, interrupt,
  approve, and turn/thread mutation remain blocked.
- Review hardening now proves that:
  - approval binding cannot report true while target/backend/action validation
    has blockers,
  - ordinary public punctuation in app/window names does not break the action
    hash contract,
  - `backend:"direct"` fails closed for Desktop collaboration proof,
  - future-issued approval packets fail closed,
  - MCP tool execution uses deterministic time input in tests.
- Updated MCP/OpenClaw declarations, command policy, OpenClaw tool-smoke,
  scenario contracts, scorecards, README, VISION, and plugin docs for the new
  proof boundary.
- #160 continues to ship `loo_desktop_proof_action` /
  `loo desktop proof-action`, limited to one CUA Driver TextEdit scratch proof
  path. The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`
  before the backend can run. The #333 collaboration proof does not widen that
  GUI action surface.
- #160 proves generic gateway invocation without exact proof args fails closed.
- #160 keeps the `loo openclaw tool-smoke` hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.

## Current Claim Scope

Allowed beta claim:

> Codex-first beta through installed OpenClaw gateway for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only cockpit/operating-picture cards, public-safe scorecards,
> gateway-ready proof for core `loo_*` workflows, read-only collaboration
> next-step planning packets, and action-bound dry-run Desktop collaboration
> proof packets.

This release does not widen the beta.38 live-control scope, GUI mutation scope,
Claude adapter scope, P1 business-adapter scope, or stable/1.0 claim scope. The
reduced-scope release claim remains `codex-read-search-expand-dry-run` unless a
separate release status packet proves a broader claim.
It uses the same proof boundary as beta.35 for desktop proof-action and fallback
status behavior.

## Release Gate Notes

- Evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/release-0.1.0-beta.39/`.
- PR #335 merged at `606431c7a970118351069a532ad0b7259768ed50`.
- PR #335 pre-merge gates passed:
  - GitHub CI `test`
  - CodeQL
  - CodeRabbit current-head approval
  - evaOS current actionable review threads: 0 after review fixes
  - focused local proof and OpenClaw smoke: 34 pass / 0 fail
  - focused scenario and scorecard tests: 31 pass / 0 fail
  - `npm run check`: 374 pass / 0 fail / 2 expected skips
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- If this candidate is published, npm `beta` points at `0.1.0-beta.39`.
  `latest` is not promoted.
- `approved_live_control_smoke_missing` remains the blocker when a working-app
  claim is attempted without approved live-control smoke evidence.

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
It does not run generic GUI mutation and does not run Codex GUI mutation.
The new Desktop collaboration proof emits `execute:false` packets only.
No automatic gateway authorization.
No broad gateway scope approval. No prompt typing. No clicking. No arbitrary app control.
Claude Code remains an adapter stub, not an adapter-equivalence claim.
Bundle/status checks do not publish to npm and do not create a GitHub Release.
No release-grade enterprise security.
No Claude Code parity, no Notion/support-control/Stripe/Company Brain P1
adapter proof, no cloud sync, no unattended desktop takeover, no stable release,
no npm `latest` promotion, and no enterprise/customer-ready security is claimed.
