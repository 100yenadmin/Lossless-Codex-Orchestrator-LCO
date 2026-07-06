# Release Notes 1.3.4

`1.3.4` is a stable patch release for the LCO 1.3 line. It ships the
first-run hardening merged in #621 / #618 after `1.3.3`, while keeping the
public claim boundary unchanged.

This remains Codex-first local orchestration.

## What Changed

- Raised the package Node.js engine floor to `>=22.5.0` and added CLI/MCP
  startup guards before SQLite-backed runtime imports.
- Split the MCP server entrypoint from its runtime module so unsupported Node
  versions fail with a short public-safe message before loading SQLite paths.
- Kept MCP `tools/list` catalog-only and side-effect-free for strict MCP
  clients; startup diagnostics are returned through `tools/call` failure
  packets instead of non-standard list fields.
- Added public-safe first-run startup packets for local DB, audit store, and
  tool-registry setup failures. Failed startup is not negatively cached, so a
  repaired setup can recover on the next `tools/call` in the same MCP process.
- Added `loo index codex --timeout-ms` busy/locked-DB classification with
  public-safe `database_busy` output and path/canary leak tests.
- Tightened the Node version parser so prerelease strings such as
  `22.5.0-pre` do not satisfy the stable `>=22.5.0` floor.
- Updated setup/docs guidance for Node 22.5 and npm min-release-age/`ETARGET`
  troubleshooting.

## Current Claim Scope

Claim scope: `codex-read-search-expand-dry-run`.

Allowed stable claim:

> Collaborate with local Codex sessions through OpenClaw using local indexing,
> prepared-state recall, bounded expansion, and approval-gated dry-run/control
> boundaries.

The 1.3.4 patch does not add a new live-control, GUI, parity, sync,
customer-readiness, or enterprise-security claim.

## Carried-Forward Desktop Proof Boundary

The Desktop proof-action hardening from #160 is still included. The public tool
surface includes `loo_desktop_proof_action` and the CLI command
`loo desktop proof-action`, but they remain bounded to the same proof boundary as beta.35: a CUA Driver TextEdit scratch proof only. The exact tuple is exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`.

A generic gateway invocation without exact proof args fails closed. The expected
OpenClaw failure shape is `openclaw_tool_result_not_ok:<tool>` with
`output.details.ok: false`; it is not proof of generic GUI mutation.

## Known Open Bug Excluded From This Claim

Issue #623 remains open: the installed OpenClaw gateway live-send path can
return a raw `inProgress` status quickly without waiting for the bounded turn
execution proof. That is a live-control runtime bug and is not part of this
`codex-read-search-expand-dry-run` release claim.

Working-app or live-control claim attempts without exact approved
live-control proof must continue to report
`approved_live_control_smoke_missing`.

## Release Gate Notes

- Candidate package: `lossless-openclaw-orchestrator@1.3.4`.
- Expected npm dist-tag after publish: `latest`.
- Expected git tag: `v1.3.4`.
- Issue #625 carries the release checkpoint. Issue #618 / PR #621 carry the
  first-run hardening implementation evidence.
- Issue #623 remains a separate live gateway bug and is not part of this release
  claim. Issue #616 remains the future 1.4 identity epic and is not part of this
  patch release.
- Example release status with all required non-GUI approvals:
  `loo release status --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --approved-live-control-evidence <live-control.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Reduced-scope read/search/expand/dry-run status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.

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
