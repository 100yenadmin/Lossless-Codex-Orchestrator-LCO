# Release Notes 1.3.1

`1.3.1` is the day-one UX hardening release for the LCO 1.3 line. It keeps
the stable claim scoped to Codex-first local orchestration while fixing the
first-run and first-hour rough edges found by the GA gap audit.

This remains Codex-first local orchestration.

## What Changed

- Unknown `loo describe codex_thread:*` refs now return a structured
  `ref_not_found` JSON object with the requested ref, reason code, human
  message, and up to three nearest matches from the existing search path. The
  CLI exits 1 for this not-found case, and MCP describe tools no longer return
  bare `null`.
- `loo doctor` now treats a missing LCO database file as read-only
  `not_indexed_yet` first-run guidance and points a fresh user at
  `loo index codex "$HOME/.codex/sessions"` without creating the database.
- README and VISION now describe the current stable 1.3 line as shipped/current
  instead of release-candidate-only copy.
- README and SETUP document the default 50 MB per-file index cap, the
  `--max-bytes-per-file` override, and raw npm tarball recovery commands for
  selector drift.
- VISION and the claim audit document the owner ruling that disposable
  scratch-thread live smokes are standing-approved only when the harmless
  thread is created by the smoke; real user threads still require exact-target
  approval.
- `loo_codex_app_server_status` fails fast when the Codex binary is missing
  instead of waiting for app-server initialize timeout.

## Current Claim Scope

Claim scope: `codex-read-search-expand-dry-run`.

Allowed stable claim:

> Collaborate with local Codex sessions through OpenClaw using local indexing,
> prepared-state recall, bounded expansion, and approval-gated dry-run/control
> boundaries.

The 1.3.1 patch does not add a new live-control, GUI, parity, sync,
customer-readiness, or enterprise-security claim.

## Carried-Forward Desktop Proof Boundary

The Desktop proof-action hardening from #160 is still included. The public tool
surface includes `loo_desktop_proof_action` and the CLI command
`loo desktop proof-action`, but they remain bounded to the same proof boundary as beta.35: a CUA Driver TextEdit scratch proof only. The exact tuple is:
exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`.

A generic gateway invocation without exact proof args fails closed. The
expected OpenClaw failure shape is `openclaw_tool_result_not_ok:<tool>` with
`output.details.ok: false`; it is not proof of generic GUI mutation.

## Release Gate Notes

- Candidate package: `lossless-openclaw-orchestrator@1.3.1`.
- Expected npm dist-tag after explicit publish approval: `latest`.
- Expected git tag after explicit tag approval: `v1.3.1`.
- Example release status with all required non-GUI approvals:
  `loo release status --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --approved-live-control-evidence <live-control.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Reduced-scope read/search/expand/dry-run status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Working-app or live-control claim attempts without exact approved
  live-control proof must continue to report
  `approved_live_control_smoke_missing`.

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
This change does not publish to npm.
This change does not create a GitHub Release.
It does not run generic GUI mutation and does not run Codex GUI mutation.
No automatic gateway authorization.
No broad gateway scope approval. No prompt typing. No clicking. No arbitrary app control.
No screenshots or videos are part of the public release evidence.
Claude Code remains an adapter stub, not an adapter-equivalence claim.
No true Codex compaction-summary capture.
No raw model compaction by default and no default model access to raw transcript
or current `safe_text`.
No raw transcript upload and no OpenClaw LCM merge.
No source-store mutation.
No Notion, support-control, Stripe, or Company Brain P1 adapter proof.
No cloud sync.
No unattended desktop takeover.
No release-grade enterprise security or customer-ready security claim.
