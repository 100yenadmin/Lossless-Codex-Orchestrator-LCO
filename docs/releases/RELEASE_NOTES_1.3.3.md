# Release Notes 1.3.3

`1.3.3` is a stable patch release for the LCO 1.3 line. It ships the #613/#614
published-package smoke hardening found during 1.3.2 post-release proof, while
keeping the public claim boundary unchanged.

This remains Codex-first local orchestration.

## What Changed

- `loo openclaw published-smoke` now accepts `--binary-probe-report` so release
  evidence can distinguish a global `loo` PATH shadow from a real candidate
  package defect.
- PATH shadowing only clears when binary-probe tarball evidence reports the
  candidate package version. Package.json self-attestation and mismatched
  tarball binary versions fail closed with
  `binary_probe_candidate_version_mismatch`.
- Top-level `loo --help` now lists the existing
  `loo openclaw published-smoke --gateway-ready-strict` option, matching the
  subcommand help and parser.
- The release gate guidance now avoids implying broader tarball proof than the
  binary-probe evidence actually provides.

## Current Claim Scope

Claim scope: `codex-read-search-expand-dry-run`.

Allowed stable claim:

> Collaborate with local Codex sessions through OpenClaw using local indexing,
> prepared-state recall, bounded expansion, and approval-gated dry-run/control
> boundaries.

The 1.3.3 patch does not add a new live-control, GUI, parity, sync,
customer-readiness, or enterprise-security claim.

## Carried-Forward Desktop Proof Boundary

The Desktop proof-action hardening from #160 is still included. The public tool
surface includes `loo_desktop_proof_action` and the CLI command
`loo desktop proof-action`, but they remain bounded to the same proof boundary as beta.35: a CUA Driver TextEdit scratch proof only. The exact tuple is:
exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`.

A generic gateway invocation without exact proof args fails closed. The expected
OpenClaw failure shape is `openclaw_tool_result_not_ok:<tool>` with
`output.details.ok: false`; it is not proof of generic GUI mutation.

## Release Gate Notes

- Candidate package: `lossless-openclaw-orchestrator@1.3.3`.
- Expected npm dist-tag after publish: `latest`.
- Expected git tag: `v1.3.3`.
- Example release status with all required non-GUI approvals:
  `loo release status --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --approved-live-control-evidence <live-control.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Reduced-scope read/search/expand/dry-run status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Working-app or live-control claim attempts without exact approved
  live-control proof must continue to report
  `approved_live_control_smoke_missing`.
- Issue #617 carries the release checkpoint. Issues #613 and PR #614 carry the
  package-smoke hardening evidence.
- Issue #615 remains a separate live-control bug and is not part of this release
  claim. Issue #616 remains the future 1.4 identity epic and is not part of this
  patch release.

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
Bundle/status/finalization checks do not publish to npm and do not create a GitHub Release.
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
