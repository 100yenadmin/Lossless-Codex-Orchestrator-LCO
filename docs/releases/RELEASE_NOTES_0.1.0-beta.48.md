# Release Notes 0.1.0-beta.48

`0.1.0-beta.48` keeps the Codex-first local orchestration beta scope and
publishes the #371 / PR #372 deterministic Codex autonomy tick slice.

## What Changed

- Added `loo_codex_autonomy_tick`, a deterministic `execute:false` loop tick
  over public-safe active-thread state.
- The tick returns ordered read-only probe steps and approval-gated control
  dry-run recommendation steps without executing live Codex control.
- Autonomy tick steps preserve status, blockers, reason codes, evidence ids,
  source coverage, idempotency keys, stop conditions, and public-safe tool args.
- OpenClaw tool-smoke now validates raw autonomy tick steps before filtering,
  validates summary counts and `totalLanes`, rejects non-finite confidence, and
  avoids exposing `nextToolCall` from invalid autonomy reports.
- Live-control smoke proof validation now requires explicit `response.ok === true`
  alongside an accepted turn status before considering a live-send proof valid.

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
> help/diagnostic/error surfaces, and public-safe published-smoke selector-drift
> diagnostics with guarded tarball fallback recovery commands.

This release does not widen the beta.45 live-control scope, GUI mutation scope,
Claude adapter scope, P1 business-adapter scope, or stable/1.0 claim scope. The
reduced-scope release claim remains `codex-read-search-expand-dry-run` unless a
separate release status packet proves a broader claim.

## Release Gate Notes

- Release evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-03/release-0.1.0-beta.48/`.
- Implementation evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-03/issue-371-codex-autonomy-tick/`.
- PR #372 merged at `f46e05773d16d9d1b5ae980d05e9159502b93d6e`.
- PR #372 gates passed:
  - GitHub CI `test`
  - CodeQL
  - CodeRabbit approved on the current head
  - evaOS review completed on the current head
  - current-head and stale GitHub review threads clear
  - focused autonomy, tool-smoke, live-control-smoke, and MCP tests
  - `npm run check`
  - GitNexus incremental refresh on merged main
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Both status examples include the required `--evidence-dir <path>` flag.
- If this candidate is published, npm `beta` points at `0.1.0-beta.48`.
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
Bundle/status checks do not publish to npm and do not create a GitHub Release.
No release-grade enterprise security.
No Claude Code parity, no Notion/support-control/Stripe/Company Brain P1
adapter proof, no cloud sync, no unattended desktop takeover, no npm `latest`
promotion, and no enterprise/customer-ready security is claimed.
