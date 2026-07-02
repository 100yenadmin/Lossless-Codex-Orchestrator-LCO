# Release Notes 1.0.0

`1.0.0` is the first stable release for the Codex-first local orchestration
path in Lossless OpenClaw Orchestrator.

It promotes the proven `1.0.0-rc.1` lane into a stable package only after #302
reruns the strict release gates against the exact stable candidate SHA. Stable
publication uses npm `latest`; beta packages remain on `beta`; release
candidates remain on `next`.

## What Changed

- Promotes the package, MCP server, Codex JSON-RPC client identity, and
  OpenClaw plugin manifests to `1.0.0` so installed clients no longer identify
  as an old beta.
- Carries forward the beta.35 / RC.1 fresh-profile OpenClaw gateway proof:
  a clean OpenClaw profile can install/load the published package, use scoped
  token env-ref onboarding, start an isolated loopback token gateway, and call
  `loo_doctor` plus `loo_search_sessions` through the same gateway surface an
  OpenClaw agent uses.
- Keeps the Codex-first local orchestration scope: local Codex indexing, search,
  describe, bounded expansion, plans, final messages, touched files, tool
  metadata, dry-run control envelopes, read-only cockpit cards, and
  operating-picture cards.
- Carries forward #254 and #255 P0 foundation: recent sessions, cockpit inbox,
  read-only watcher/resume-request packets, visible Codex map joins, project
  digest, attention inbox, business pulse, source coverage, and source
  authority coverage.
- Carries forward #160 desktop proof-action boundaries:
  `loo_desktop_proof_action` / `loo desktop proof-action` remains limited to
  one CUA Driver TextEdit scratch path. It requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`; generic gateway invocation without exact proof args fails closed.
- Keeps the `loo openclaw tool-smoke` hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.

## Stable Claim Scope

Allowed stable claim:

> Codex-first local orchestration through OpenClaw for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only cockpit/operating-picture cards, public-safe scorecards,
> and fresh-profile gateway-ready proof for the initial OpenClaw tool path.

This stable release keeps the same proof boundary as beta.35 and RC.1 unless a
release-status packet for the exact candidate SHA proves and records a broader
claim.

## Release Gate Notes

- Stable issue: #302.
- RC issue: #300.
- RC evidence:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-02/issue-1-0-rc-release-gate/merged-main-gates/`.
- Required pre-publish stable gates: `npm run check`, `npm pack --dry-run`,
  strict scenario sweep, strict scorecard sweep, release preflight, release
  bundle, release demo-status, and release status for the exact stable
  candidate SHA.
- Required post-publish stable gates: fresh npm `@latest` published-smoke and
  strict general-readiness for the published stable package before #302 closes.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- `approved_live_control_smoke_missing` remains the expected blocker when a
  working-app claim is attempted without approved live-control smoke evidence.
- Bundle/status/readiness checks do not publish to npm and do not create a
  GitHub Release. They do not create a GitHub Release. Publication and GitHub
  Release creation are separate actions recorded after the pre-publish stable
  gate passes; post-publish published-smoke and general-readiness must still
  pass before the stable lane is complete.

## Explicit Non-Claims

No new live Codex control smoke is run by this stable release.
No generic GUI mutation and no Codex GUI mutation are claimed.
This release does not run generic GUI mutation and does not run Codex GUI mutation.
No automatic gateway authorization.
No broad gateway scope approval. No prompt typing. No clicking. No arbitrary app control.
Claude Code remains an adapter stub, not adapter parity.
Notion, support-control, Stripe, Company Brain, dashboard/export, and model
summarization remain P1 adapter work, not part of this stable release.
No cloud sync.
No unattended desktop takeover.
No release-grade enterprise security.
No enterprise/customer-ready security is claimed.
No Claude Code parity.
