# Release Notes 0.1.0-beta.37

`0.1.0-beta.37` keeps the Codex-first local orchestration beta scope and
publishes the #314 / PR #323 active-thread cockpit ranking hardening.

## What Changed

- `loo_recent_sessions(scope=active)` now uses active-lane ranking instead of
  generic risk-first recent sorting. Fresh approval, running, and waiting lanes
  rank ahead of stale low-confidence blocked residue.
- Active cards can expose `running_state_signal` and
  `stale_low_confidence_blocked` reason codes so Eva/OpenClaw can see why a lane
  is current or why old blocked residue was demoted.
- The collaboration cockpit active-card input now uses the same active ranking
  primitive, so active-lane summaries do not inherit stale blocked residue as
  the default top lane.
- Readable but pinless `PLAN_STATE` input now reports
  `sourceCoverage.plan_state = "empty"` instead of `not_configured`. This keeps
  `PLAN_STATE` demoted to bootloader/manual pins while still distinguishing
  "source was readable and had no pins" from "source was not supplied."
- Scenario contracts, the local-agent usability scorecard, README, and VISION
  now name the #314 proof boundary.
- #160 continues to ship `loo_desktop_proof_action` /
  `loo desktop proof-action`, limited to one CUA Driver TextEdit scratch proof
  path. The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run.
- #160 proves generic gateway invocation without exact proof args fails closed.
- #160 keeps the `loo openclaw tool-smoke` hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.

## Current Claim Scope

Allowed beta claim:

> Codex-first beta through installed OpenClaw gateway for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only cockpit/operating-picture cards, public-safe scorecards,
> and gateway-ready proof for core `loo_*` workflows.

This release does not widen the beta.36 claim, live-control scope,
desktop-collaboration scope, Claude adapter scope, P1 business-adapter scope, or
stable/1.0 claim scope. The reduced-scope release claim remains
`codex-read-search-expand-dry-run` unless a separate release status packet
proves a broader claim.
It uses the same proof boundary as beta.35 for desktop proof-action and fallback
status behavior.

## Release Gate Notes

- Evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/release-0.1.0-beta.37/`.
- PR #323 merged at `ed8c96cf2266c76104c24605ee944887909e9760`.
- Merged-main validation before release prep passed:
  - `npm run check`
  - `loo eval scenarios --scenario-id codex-collaboration-cockpit-v1 --scenario-id eva-operating-picture-dogfood-v1 --strict`
  - `loo openclaw tool-smoke` with `loo_recent_sessions`,
    `loo_cockpit_inbox`, `loo_project_digest`, `loo_attention_inbox`, and
    `loo_business_pulse`
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- If this candidate is published, npm `beta` points at `0.1.0-beta.37`.
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
