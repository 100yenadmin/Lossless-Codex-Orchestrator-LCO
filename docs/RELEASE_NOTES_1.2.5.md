# Release Notes 1.2.5

`1.2.5` is a GA-assurance release-captain patch for the LCO 1.2 stable
train. It keeps the 1.2 claim boundary unchanged and adds the aggregate-only
`loo release ga-smoke` command so release evidence can be checked as one
public-safe go/no-go packet.

This remains Codex-first local orchestration.

## What Changed

- Adds `loo release ga-smoke --package-version <version> --candidate-sha <sha>
  --evidence-dir <dir> --strict`.
- Aggregates existing release reports instead of running hidden release actions:
  release status, release finalization status, published package smoke,
  OpenClaw dogfood, OpenClaw tool smoke, scenario sweep, scorecard sweep,
  release preflight, release bundle, and privacy scan.
- Emits one `lco.release.gaSmoke.v1` packet with P0-P2 blockers, setup
  blockers, warnings, deferred/non-action statements, sanitized evidence refs,
  recovery commands, and explicit no-action proof fields.
- Fails closed when evidence is missing, mismatched to the package version or
  candidate SHA, unsafe, outside the evidence directory, or carrying raw
  transcript/SQLite/screenshot/token-style artifacts.
- Keeps fresh-profile OpenClaw setup blockers separate from package defects.
  `--allow-setup-required` only passes when setup blockers are explicit and
  configured-gateway proof is clean.
- Keeps legacy `release-status` evidence compatible when it predates embedded
  `candidateSha`, while mismatched embedded SHA evidence still fails closed.
- Updates README, VISION, claim audit, and release runbooks to include the GA
  smoke gate.

## Current Claim Scope

Claim scope: `codex-read-search-expand-dry-run`.

Allowed stable claim:

> Collaborate with local Codex sessions through OpenClaw using local indexing,
> prepared-state recall, bounded expansion, and approval-gated dry-run/control
> boundaries.

This release adds release-captain aggregation only. It does not broaden the
runtime, control, GUI, Claude, customer, or enterprise-security proof boundary.

## Carried-Forward Desktop Proof Boundary

The Desktop proof-action hardening from #160 is still included. The public tool
surface includes `loo_desktop_proof_action` and the CLI command
`loo desktop proof-action`, but they remain bounded to the same proof boundary as beta.35: a CUA Driver TextEdit scratch proof only. The exact tuple is:
exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`.

A generic gateway invocation without exact proof args fails closed. The expected
OpenClaw failure shape is `openclaw_tool_result_not_ok:<tool>` with
`output.details.ok: false`; it is not proof of generic GUI mutation.

## Release Gate Notes

- Parent 1.2 tracker: #405.
- GA assurance tracker: #478.
- GA smoke aggregator issue: #502.
- Patch release issue: #511.
- Baseline stable release: `v1.2.4`.
- Candidate package: `lossless-openclaw-orchestrator@1.2.5`.
- Expected npm dist-tag: `latest`.
- Expected git tag: `v1.2.5`.
- Example aggregate GA smoke gate:
  `loo release ga-smoke --package-version 1.2.5 --candidate-sha <sha> --evidence-dir <public-safe-evidence> --strict`.
- Example release status with all required non-GUI approvals: `loo release status --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --approved-live-control-evidence <live-control.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Reduced-scope read/search/expand/dry-run status example: `loo release status --claim-scope codex-read-search-expand-dry-run --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Working-app or live-control claim attempts without exact approved live-control proof must continue to report `approved_live_control_smoke_missing`.
- `loo release ga-smoke` writes `release-ga-smoke.json`; it does not publish to npm, does not create tags, does not create a GitHub Release, does not run live Codex control, does not mutate a desktop GUI, and does not read raw transcripts.
- Required stable gates: focused GA smoke tests, full `npm run check`, package
  dry-run, GitHub CI, CodeQL, current-head review threads clear, npm publish to
  `latest`, GitHub Release, post-publish finalization status, fresh npm install,
  OpenClaw dogfood/tool-smoke, scenario/scorecard sweeps, privacy scan, and
  final `loo release ga-smoke --strict`.

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
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
