# Release Notes 0.1.0-beta.43

`0.1.0-beta.43` keeps the Codex-first local orchestration beta scope and
publishes the #351 / PR #352 read-only active-thread cockpit state classifier.

## What Changed

- Added `loo_codex_active_thread_state`, a read-only `loo_*` tool that fuses
  indexed cockpit lanes, watcher signals, optional app-server thread signals,
  and optional visible-map evidence into compact active-thread state cards.
- The new report classifies lanes as running, blocked, needs-nudge, stale,
  waiting, approval-needed, idle, or unknown, with confidence, freshness,
  source coverage, reason codes, evidence ids, and explicit false action flags.
- Active-thread classification now ranks the full active lane set before
  applying the caller limit, so urgent watcher, blocked, stale, and conflict
  signals are not dropped by an early cockpit limit.
- App-server/indexed conflicts degrade to unknown or low confidence, preserve
  explicit zero-confidence signals, and surface watcher override reason codes
  instead of hiding contradictory evidence.
- Loaded app-server metadata remains a visibility/readiness hint only; it no
  longer implies a thread is running without an explicit running/active status.
- OpenClaw tool-smoke now accepts legitimate empty active-state reports while
  still validating schema counts, public-safe output, and action flags.
- The MCP server, OpenClaw plugin manifests, agent skill, scenario contract, and
  local-agent scorecard now expose the active-thread state workflow.
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
> envelopes, read-only cockpit/operating-picture cards, deterministic cockpit
> replayability, public-safe scorecards, gateway-ready proof for core `loo_*`
> workflows, read-only collaboration next-step planning packets, read-only
> active-thread state classification, action-bound dry-run Desktop collaboration
> proof packets, and read-only runtime Desktop visibility status reporting.

This release does not widen the beta.42 live-control scope, GUI mutation scope,
Claude adapter scope, P1 business-adapter scope, or stable/1.0 claim scope. The
reduced-scope release claim remains `codex-read-search-expand-dry-run` unless a
separate release status packet proves a broader claim.
It uses the same proof boundary as beta.35 for #160 desktop proof-action and
fallback status behavior.

## Release Gate Notes

- Evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-03/beta43-merged-main-gates/`.
- PR #352 merged at `24a1d565f133573393cbe2167da93fb44fa271be`.
- PR #352 gates passed:
  - GitHub CI `test`
  - CodeQL
  - CodeRabbit approval on the fixed current head
  - focused local active-thread state tests
  - OpenClaw gateway tool-smoke for `loo_codex_active_thread_state`
  - merged-main `npm run check`
  - merged-main scenario and scorecard sweeps
- PR #354 is a separate CLI/release-evidence hygiene PR. It was repaired on top
  of `main` but remains outside this release until its external review gate
  clears.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Both status examples include the required `--evidence-dir <path>` flag.
- If this candidate is published, npm `beta` points at `0.1.0-beta.43`.
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
adapter proof, no cloud sync, no unattended desktop takeover, no npm `latest`
promotion, and no enterprise/customer-ready security is claimed.
