# Release Notes 1.3.5

`1.3.5` is a stable patch release for the LCO 1.3 line. It ships the #623 /
PR #624 gateway proof hardening that was explicitly excluded from `1.3.4`,
while keeping the public product claim boundary unchanged.

This remains Codex-first local orchestration.

## What Changed

- Fixed the installed OpenClaw gateway live-send proof path so terminal proof no
  longer accepts fast, in-flight statuses such as `accepted`, `running`, or
  `inProgress`.
- Live-send proof now requires a terminal gateway turn status plus
  gateway-attested completion metadata. Durable post-action persistence still
  requires separate follow-up read proof.
- Tightened the live-control matrix so send proof fails closed when the gateway
  reports a non-terminal status, even if the response shape looks otherwise
  successful.
- Hardened OpenClaw tool input validation for the MCP surface: undeclared
  top-level arguments are rejected, top-level primitive array items are checked,
  and validation errors remain public-safe.
- Documented the stricter top-level OpenClaw argument contract so callers do
  not piggyback undeclared telemetry, tags, or control metadata onto `loo_*`
  tool calls.

## Current Claim Scope

Claim scope: `codex-read-search-expand-dry-run`.

Allowed stable claim:

> Collaborate with local Codex sessions through OpenClaw using local indexing,
> prepared-state recall, bounded expansion, and approval-gated dry-run/control
> boundaries.

The 1.3.5 patch removes the 1.3.4 known-open #623 release exclusion, but it
does not add a broader live-control, GUI, parity, sync, customer-readiness, or
enterprise-security claim.

## Carried-Forward Live Proof Boundary

The live-control proof hardening is intentionally narrow:

- send proof requires terminal gateway turn status plus gateway-attested
  completion metadata;
- in-flight statuses such as `accepted`, `running`, and `inProgress` are not
  accepted as completion proof;
- durable post-action persistence is a separate follow-up read proof;
- real user threads still require exact-target approval before any live
  resume/send/steer/interrupt action.

This release does not claim unattended operation or arbitrary live control.

## Carried-Forward Desktop Proof Boundary

The Desktop proof-action hardening from #160 is still included. The public tool
surface includes `loo_desktop_proof_action` and the CLI command
`loo desktop proof-action`, but they remain bounded to the same proof boundary as beta.35: a CUA Driver TextEdit scratch proof only. The exact tuple is exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`.

A generic gateway invocation without exact proof args fails closed. The expected
OpenClaw failure shape is `openclaw_tool_result_not_ok:<tool>` with
`output.details.ok: false`; it is not proof of generic GUI mutation.

## Release Gate Notes

- Candidate package: `lossless-openclaw-orchestrator@1.3.5`.
- Expected npm dist-tag after publish: `latest`.
- Expected git tag: `v1.3.5`.
- Issue #629 carries the release checkpoint. Issue #623 / PR #624 carry the
  gateway proof hardening implementation evidence.
- Issue #616 remains the future 1.4 identity epic and is not part of this patch
  release.
- Example release status with all required non-GUI approvals:
  `loo release status --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --approved-live-control-evidence <live-control.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Reduced-scope read/search/expand/dry-run status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Working-app or broad live-control claim attempts without exact approved
  live-control proof must continue to report
  `approved_live_control_smoke_missing`.

## Explicit Non-Claims

No new live Codex control smoke is run by this release, and no broad live
Codex control GA claim is added.
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
