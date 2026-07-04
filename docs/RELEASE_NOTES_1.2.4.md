# Release Notes 1.2.4

`1.2.4` is a GA-assurance privacy hygiene patch for the LCO 1.2 stable train.
It keeps the 1.2 claim boundary unchanged and fixes a public-safe rendering gap
found during the M11 launch packet pass.

## What Changed

- Redacts local absolute paths from `loo expand-query`, `loo expand-ref`, and
  `expandSession` human-readable expansion text.
- Keeps relative project paths visible where they are already public-safe, while
  replacing local `/Volumes/...`, `/Users/...`, `.codex`, and tmp-style paths
  with `<redacted-path>`.
- Keeps exact touched-file metadata in the local index for matching and recall;
  only the rendered expansion text is sanitized.
- Updates bounded expansion snapshots and regression tests so future releases
  fail if expansion evidence leaks local absolute paths.
- Carries forward the 1.2.3 recursive evidence scanner hardening for nested raw
  artifacts, SQLite sidecars, symlinked evidence entries, and deep evidence
  trees.
- Clarifies launch-truth wording from `1.2.0`/`1.2.3` to the current `1.2.4`
  stable patch line.

## Current Claim Scope

Claim scope: `codex-read-search-expand-dry-run`.

Allowed stable claim:

> Collaborate with local Codex sessions through OpenClaw using local indexing,
> prepared-state recall, bounded expansion, and approval-gated dry-run/control
> boundaries.

When finalization evidence proves this candidate on the stable channel, the
scoped prepared-state and cockpit-management surface is ready as a public
local-Codex release. It does not broaden the control, GUI, Claude, customer, or
enterprise-security proof boundary.

This remains a Codex-first local orchestration release.

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
- Path-redaction issue: #508.
- Hygiene patch issue: #506.
- Baseline stable release: `v1.2.3`.
- Candidate package: `lossless-openclaw-orchestrator@1.2.4`.
- Expected npm dist-tag: `latest`.
- Expected git tag: `v1.2.4`.
- Example reduced-scope release preflight:
  `loo release preflight --claim-scope codex-read-search-expand-dry-run --evidence-dir <public-safe-evidence> --strict`.
- Example release status with all required non-GUI approvals:
  `loo release status --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --approved-live-control-evidence <live-control.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Reduced-scope release status may keep `approved_live_control_smoke_missing`
  only when `--claim-scope codex-read-search-expand-dry-run` is explicit and
  live Codex control is recorded as excluded.
- Required stable gates: focused path-redaction tests, full `npm run check`,
  release preflight/bundle/status, `npm pack --dry-run`, GitHub CI, CodeQL,
  review threads clear, npm publish to `latest`, GitHub Release, post-publish
  finalization status, fresh npm install, OpenClaw dogfood/tool-smoke,
  scenario/scorecard sweeps, and privacy scan.
- `loo release bundle` prepares public-safe local artifacts; it does not publish to npm and does not create a GitHub Release.

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
