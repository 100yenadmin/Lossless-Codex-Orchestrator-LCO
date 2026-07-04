# Release Notes 1.2.3

`1.2.3` is the GA-assurance hygiene patch for the LCO 1.2 stable train and Codex-first local orchestration. It fixes the recursive release-evidence scan gap found during M11 adversarial review and keeps the 1.2 claim boundary unchanged.

This release is focused on local Codex sessions. Prepared state remains an advisory local derived cache, not source authority for PR, CI, release, runtime, customer, or business truth.

## What Changed

- Fixes `loo release preflight` raw-artifact detection so it scans nested evidence folders instead of only immediate files in `--evidence-dir`.
- Adds recursive detection for SQLite sidecars such as `.sqlite-wal`, `.sqlite-shm`, `.sqlite3-wal`, `.sqlite3-shm`, `.db-wal`, and `.db-shm`.
- Keeps raw artifact findings public-safe by reporting relative evidence names and blocker reasons, not raw artifact contents.
- Sanitizes the M11 final evidence packet by removing generated clean-profile runtime HOME/prefix artifacts while preserving public-safe summary reports.
- Carries forward the 1.2.2 readiness-smoke semantics clarification: `ok` / `packagePathOk` are package-path claims, while `publishedSmokeReady` is the clean-profile gateway-ready claim.
- Carries forward `--gateway-ready-strict` so operators and CI can explicitly fail when a fresh published profile still needs gateway credentials or device setup.
- Carries forward the hardened `loo release general-readiness` proof-boundary label so an unexpected package version string cannot inject uncontrolled text into the public proof boundary.
- Carries forward the frozen `readinessSemantics` metadata object emitted by `published-smoke`, keeping machine-readable exit semantics stable for release scripts and audits.
- Carries forward the 1.2.1 facade smoke fix for resume dry-run proof, including the distinction between resume packets and message-carrying send/steer packets.
- Carries forward the #160 desktop proof-action release boundary:
  `loo_desktop_proof_action` / `loo desktop proof-action` validates the
  CUA Driver TextEdit scratch proof gate and does not prove generic GUI
  mutation.
  The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run.
  Generic gateway invocation without exact proof args fails closed. The desktop
  proof action keeps the same proof boundary as beta.35.
- Carries forward strict OpenClaw gateway result handling: plugin output with
  `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than successful tool proof.

## Current Claim Scope

Allowed stable claim:

> Collaborate with local Codex sessions through OpenClaw using local indexing,
> prepared-state recall, bounded expansion, and approval-gated dry-run/control
> boundaries.

The stable channel means the scoped prepared-state and cockpit-management
surface is ready as a public local-Codex release. It does not broaden the
control, GUI, Claude, customer, or enterprise-security proof boundary.

## Release Gate Notes

- Parent 1.2 tracker: #405.
- GA assurance tracker: #478.
- Hygiene patch issue: #506.
- Previous patch-release issue: #503.
- Readiness-semantics issue: #494.
- Patch PRs: #499, #505, and the 1.2.3 release PR.
- Baseline stable release: `v1.2.2`.
- Candidate package: `lossless-openclaw-orchestrator@1.2.3`.
- Expected npm dist-tag: `latest`.
- Expected git tag: `v1.2.3`.
- Required stable gates: focused release-smoke tests, release claim audit,
  build/typecheck, `npm pack --dry-run`, release bundle/status checks, GitHub
  CI, CodeQL, current-head review threads clear, npm publish to `latest`,
  GitHub Release, and post-publish finalization status.
- Bundle/status/finalization dry-run checks do not publish to npm and will not create a GitHub Release.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- `approved_live_control_smoke_missing` remains the expected blocker when a
  working-app or live-control claim is attempted without approved live-control
  smoke evidence for the exact candidate SHA.

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
