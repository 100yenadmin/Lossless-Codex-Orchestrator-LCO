# Release Notes 0.1.0-beta.41

`0.1.0-beta.41` keeps the Codex-first local orchestration beta scope and
publishes the #342 / PR #343 runtime Desktop visibility status report.

## What Changed

- Added `loo_codex_runtime_desktop_visibility_status`, a read-only status tool
  that summarizes which collaboration cockpit lanes have runtime Desktop
  visibility or action-bound proof coverage.
- The tool reports each lane as `covered`, `partial`, or `blocked` and includes
  source coverage, reason codes, public-safe evidence refs, and the next
  read-only proof call when more evidence is needed.
- Next proof calls are emitted with `execute:false`; the tool does not run live
  Codex control, refresh or restart Codex Desktop, mutate GUI state, capture
  screenshots, publish npm, or create GitHub releases.
- Wired the status tool through MCP, OpenClaw plugin manifests, command policy,
  OpenClaw tool-smoke, docs, agent skill guidance, scorecards, and the v1.1
  runtime scenario contract.
- Default local OpenClaw gateway dogfood cataloged and invoked
  `loo_codex_runtime_desktop_visibility_status`, returning a public-safe
  `blocked` status with restricted action flags false and the next
  `loo_codex_desktop_coherence` call marked `execute:false`.
- #160 continues to ship `loo_desktop_proof_action` /
  `loo desktop proof-action`, limited to one CUA Driver TextEdit scratch proof
  path. The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run. This release does not widen that GUI action surface.
- #160 proves generic gateway invocation without exact proof args fails closed.
- #160 keeps the OpenClaw tool-smoke hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.
- #333 and beta.39 continue to define action-bound Desktop collaboration proof
  packets; beta.41 only adds a compact lane-level visibility status over those
  proven or still-blocked paths.

## Current Claim Scope

Allowed beta claim:

> Codex-first beta through installed OpenClaw gateway for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only cockpit/operating-picture cards, public-safe scorecards,
> gateway-ready proof for core `loo_*` workflows, read-only collaboration
> next-step planning packets, action-bound dry-run Desktop collaboration proof
> packets, and read-only runtime Desktop visibility status reporting.

This release does not widen the beta.40 live-control scope, GUI mutation scope,
Claude adapter scope, P1 business-adapter scope, or stable/1.0 claim scope. The
reduced-scope release claim remains `codex-read-search-expand-dry-run` unless a
separate release status packet proves a broader claim.
It uses the same proof boundary as beta.35 for desktop proof-action and fallback
status behavior.

## Release Gate Notes

- Evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/release-0.1.0-beta.41/`.
- PR #343 merged at `97869d31a14b53232bdf63eb56c2759aca5f4a16`.
- PR #343 gates passed:
  - GitHub CI `test`
  - CodeQL
  - CodeRabbit walkthrough with no actionable review threads
  - evaOS review completed with no validated inline findings
  - focused local proof and OpenClaw gateway dogfood for
    `loo_codex_runtime_desktop_visibility_status`
  - `npm run check`: 381 pass / 0 fail / 2 expected skips
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- If this candidate is published, npm `beta` points at `0.1.0-beta.41`.
  `latest` is not promoted.
- `approved_live_control_smoke_missing` remains the blocker when a working-app
  claim is attempted without approved live-control smoke evidence.

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
It does not run generic GUI mutation and does not run Codex GUI mutation.
The new runtime Desktop visibility status emits `execute:false` proof calls only.
No automatic gateway authorization.
No broad gateway scope approval. No prompt typing. No clicking. No arbitrary app control.
Claude Code remains an adapter stub, not an adapter-equivalence claim.
Bundle/status checks do not publish to npm and do not create a GitHub Release.
No release-grade enterprise security.
No Claude Code parity, no Notion/support-control/Stripe/Company Brain P1
adapter proof, no cloud sync, no unattended desktop takeover, no stable release,
no npm `latest` promotion, and no enterprise/customer-ready security is claimed.
