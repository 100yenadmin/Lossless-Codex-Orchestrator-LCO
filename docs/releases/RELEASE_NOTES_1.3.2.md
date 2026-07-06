# Release Notes 1.3.2

`1.3.2` is a stable patch release for the LCO 1.3 line. It ships the #608
direct CLI recall hardening found during the 1.3.1 release smoke, while keeping
the public claim boundary unchanged.

This remains Codex-first local orchestration.

## What Changed

- Direct CLI recall commands now use bounded, public-safe local DB handling:
  `loo search`, `loo grep`, `loo describe`, `loo expand-query`, and
  `loo expand-ref` all accept or honor `--timeout-ms`.
- `loo search --limit n` keeps its bounded result behavior and now supports the
  conventional `--` option delimiter for flag-like query text, for example
  `loo search --limit 10 -- --limit flaglikequery`.
- Direct CLI recall smoke paths suppress telemetry writes even when
  `LOO_TELEMETRY=1`, so release proof does not silently mutate telemetry rows.
- Locked or busy local LCO databases now return public-safe `database_busy`
  recovery packets instead of raw stderr or local path details.
- Completed slow safe-text recall emits `recall_timeout_exceeded` as a
  post-query classifier. This is not a hard CPU-query interrupt claim.
- QA Lab documentation now explains the direct CLI recall proof boundary and the
  SQLite lock-fixture assumption used by #608 tests.

## Current Claim Scope

Claim scope: `codex-read-search-expand-dry-run`.

Allowed stable claim:

> Collaborate with local Codex sessions through OpenClaw using local indexing,
> prepared-state recall, bounded expansion, and approval-gated dry-run/control
> boundaries.

The 1.3.2 patch does not add a new live-control, GUI, parity, sync,
customer-readiness, or enterprise-security claim.

## Carried-Forward Desktop Proof Boundary

The Desktop proof-action hardening from #160 is still included. The public tool surface includes `loo_desktop_proof_action` and the CLI command `loo desktop proof-action`, but they remain bounded to the same proof boundary as beta.35: a CUA Driver TextEdit scratch proof only. The exact tuple is: exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`.

A generic gateway invocation without exact proof args fails closed. The expected OpenClaw failure shape is `openclaw_tool_result_not_ok:<tool>` with `output.details.ok: false`; it is not proof of generic GUI mutation.

## Release Gate Notes

- Candidate package: `lossless-openclaw-orchestrator@1.3.2`.
- Expected npm dist-tag after publish: `latest`.
- Expected git tag: `v1.3.2`.
- Example release status with all required non-GUI approvals:
  `loo release status --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --approved-live-control-evidence <live-control.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Reduced-scope read/search/expand/dry-run status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Working-app or live-control claim attempts without exact approved
  live-control proof must continue to report
  `approved_live_control_smoke_missing`.
- #608 and #611 carry the maintainer evidence packet references. Public release notes intentionally omit machine-local evidence paths.

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
This change does not publish to npm.
This change does not create a GitHub Release.
This release does not run generic GUI mutation and does not run Codex GUI mutation.
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
