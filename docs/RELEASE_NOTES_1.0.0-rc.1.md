# Release Notes 1.0.0-rc.1

`1.0.0-rc.1` is the first general-release candidate for the Codex-first
Lossless OpenClaw Orchestrator path.

It does not move npm `latest` by itself. Promotion to `latest` and GitHub
Release publication remain separate release-status actions that must be proven
against the exact merged candidate SHA.

## What Changed

- Carries forward the beta.35 fresh-profile OpenClaw gateway proof:
  a clean OpenClaw profile can install/load the published package, use scoped
  token env-ref onboarding, start an isolated loopback token gateway, and call
  `loo_doctor` plus `loo_search_sessions` through the same gateway surface an
  OpenClaw agent uses.
- Promotes the package and OpenClaw plugin manifests to `1.0.0-rc.1` for a
  stable-release decision lane.
- Treats #254 and #255 as closed P0 beta foundation: recent sessions, cockpit
  inbox, read-only watcher/resume-request packets, visible Codex map joins,
  project digest, attention inbox, business pulse, source coverage, and source
  authority coverage.
- Uses the strict 1.0 general-readiness gate as release input:
  `loo release general-readiness --strict` must report `stableReady=true` with
  public-safe fresh npm and agent dogfood evidence before any stable promotion.
- Carries forward #160 desktop proof-action boundaries:
  `loo_desktop_proof_action` / `loo desktop proof-action` remains limited to
  one CUA Driver TextEdit scratch path, requires exact backend, target app,
  target window, action hash, approval ref, permission state, scratch file path,
  and `execute: true`, and generic gateway invocation without exact proof args
  fails closed.
  The proof action still requires exact backend, target app, target window,
  action hash, approval ref, permission state, scratch file path, and
  `execute: true`.
  Exact marker: exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`.
  Exact marker: generic gateway invocation without exact proof args fails closed.
- Keeps the `loo openclaw tool-smoke` hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.

## Current Claim Scope

Allowed RC claim:

> Codex-first local orchestration through OpenClaw for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only cockpit/operating-picture cards, public-safe scorecards,
> and fresh-profile gateway-ready proof for the initial OpenClaw tool path.

This RC keeps the same proof boundary as beta.35 unless the release-status
packet for the exact candidate SHA proves and records a broader claim.

## Release Gate Notes

- Candidate issue: #300.
- Baseline evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/tracker-truth-pass-p0-closeout/`.
- Fresh npm evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/issue-fresh-profile-gateway-ready-proof/published-smoke-ready-protocol4/published-package-smoke.json`.
- Agent dogfood evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/release-0.1.0-beta.34/merged-main/openclaw-tool-smoke-configured-full-beta34.json`.
- Required gates for the PR and merged candidate: `npm run check`,
  `npm pack --dry-run`, strict scenario sweep, strict scorecard sweep, release
  preflight, release bundle, release demo-status, release status, and strict
  general-readiness.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- `approved_live_control_smoke_missing` remains the expected blocker when a
  working-app claim is attempted without approved live-control smoke evidence.
- npm `latest` must not move until the merged candidate has release-status
  proof markers for npm publication and GitHub Release creation.

## Explicit Non-Claims

No new live Codex control smoke is run by this RC.
No generic GUI mutation and no Codex GUI mutation are claimed.
This RC does not run generic GUI mutation and does not run Codex GUI mutation.
No automatic gateway authorization.
No broad gateway scope approval. No prompt typing. No clicking. No arbitrary app control.
Claude Code remains an adapter stub, not adapter parity.
Notion, support-control, Stripe, Company Brain, dashboard/export, and model
summarization remain P1 adapter work, not part of this RC.
No cloud sync.
No unattended desktop takeover.
No release-grade enterprise security.
No enterprise/customer-ready security is claimed.
Bundle/status/readiness checks do not publish to npm and do not create a GitHub
Release. No npm `latest` promotion or GitHub Release creation is performed by
bundle, status, or readiness checks.
Bundle/status/readiness checks do not publish to npm and do not create a GitHub Release.
