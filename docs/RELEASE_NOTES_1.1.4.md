# Release Notes 1.1.4

`1.1.4` is a stable patch release for the Codex-first collaboration cockpit and
OpenClaw gateway lane.

It keeps the `1.1.3` stable claim scope and adds the approved live-resume
gateway proof from #383 / #402. The release proves one harmless approved
`thread/resume` path through the installed OpenClaw gateway plus post-action
safe refresh/reasoning evidence.

## What Changed

- Added `--action send|resume` to the OpenClaw live-control smoke command so
  release/runtime proof can validate either a message send or a no-message
  Codex resume action through the same gateway surface.
- `loo openclaw live-control-smoke --action resume` now requires
  `loo_codex_control_dry_run`, `loo_codex_resume_thread`, and `loo_audit_tail`
  instead of the send-only live tool.
- Resume proof accepts the Codex app-server `thread/resume` response shape when
  `ok: true` and `method: "thread/resume"` are present, even when there is no
  turn-status payload.
- Resume proof fails closed when the live response is not ok, reports the wrong
  method, or cannot be matched back to the dry-run approval audit record.
- Runtime action parsing now rejects malformed action values instead of
  silently falling back to the higher-side-effect send path.
- The `openclaw-gateway-live-codex-v1-1` runtime scenario now keeps only the
  common dry-run/audit tools in `required_tools` and lists `loo_codex_send_message`
  and `loo_codex_resume_thread` as allowed alternatives, so scenario consumers
  do not try to perform two live actions while the contract caps live actions at
  one.
- Scenario sweep output preserves `allowed_tools` separately from the required
  dry-run tool sequence for runtime-required scenarios.
- Regression tests cover the send path, resume happy path, status-less resume
  success, resume negative paths, malformed actions, and scenario-contract
  alternate live actions.
- Carries forward the #160 desktop proof-action release boundary:
  `loo_desktop_proof_action` / `loo desktop proof-action` validates the
  action-bound CUA Driver TextEdit scratch proof gate and does not prove
  generic GUI mutation. The proof action still requires exact backend, target
  app, target window, action hash, approval ref, permission state, scratch file
  path, and `execute: true` before the backend can run. Generic gateway
  invocation without exact proof args fails closed, using the same proof
  boundary as beta.35.
  Exact gate phrase: exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`.
  Exact fail-closed phrase: generic gateway invocation without exact proof args fails closed.
  The desktop proof action keeps the same proof boundary as beta.35.
- Carries forward strict OpenClaw gateway result handling:
  plugin output with `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than successful tool proof.

## Stable Claim Scope

Allowed stable claim:

> Codex-first local orchestration through OpenClaw for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only collaboration cockpit/autonomy cards, read-only Desktop
> visibility and fallback status, action-bound proof-packet validation,
> public-safe scorecards, runtime proof handoff packets, runtime sweep
> summaries, installed OpenClaw gateway dogfood, and one approved harmless live
> Codex resume proof through the installed OpenClaw gateway.

This release still does not claim generic GUI mutation, Codex GUI mutation,
unattended control, Claude Code parity, P1 business-adapter parity, cloud sync,
or enterprise/customer-ready security.

## Release Gate Notes

- Stable issue: #403.
- Included implementation issue: #383.
- Included implementation PR: #402.
- Parent product tracker: #309.
- Operating-loop tracker: #16.
- Baseline stable release: `v1.1.3`.
- Candidate package: `lossless-openclaw-orchestrator@1.1.4`.
- Expected git tag: `v1.1.4`.
- Expected GitHub Release:
  `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/releases/tag/v1.1.4`.
- Required pre-publish stable gates: `npm run check`, `npm pack --dry-run`,
  strict runtime-required scenario sweep for `openclaw-gateway-live-codex-v1-1`
  and `post-action-refresh-reasoning-v1-1`, strict scorecard sweep, release
  preflight, release bundle, release demo-status, release status, OpenClaw
  dogfood, and OpenClaw tool-smoke for the exact stable candidate SHA.
- Required PR gates: GitHub CI, CodeQL, current-head review threads clear, and
  any actionable review feedback fixed before merge.
- Required post-publish stable gates: npm `latest` view, git tag, GitHub
  non-prerelease Release, `loo release finalization-status --expected-dist-tag
  latest --expected-github-prerelease false --strict`, fresh npm `@latest`
  published-smoke, and strict general-readiness before #403 closes.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Post-publish finalization example:
  `loo release finalization-status --evidence-dir <path> --candidate-sha <sha> --npm-publish-evidence <path> --git-tag-evidence <path> --github-release-evidence <path> --expected-dist-tag latest --expected-github-prerelease false --strict`
- `approved_live_control_smoke_missing` remains the expected blocker when a
  working-app claim is attempted without approved live-control smoke evidence
  for the exact candidate SHA.

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
It does not run generic GUI mutation and does not run Codex GUI mutation.
No screenshot workflow.
No prompt typing. No clicking. No arbitrary app control.
No unattended desktop takeover.
No automatic gateway authorization and no broad gateway scope approval.
Claude Code remains an adapter stub, not adapter equivalence.
No Notion, support-control, Stripe, or Company Brain P1 adapter proof.
No cloud sync.
Bundle/status/finalization checks do not publish to npm and do not create a GitHub Release.
No release-grade enterprise security or customer-ready security claim.
