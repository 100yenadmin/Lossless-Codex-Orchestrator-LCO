# Release Notes 1.1.1

`1.1.1` is a stable patch release for the post-1.1 Codex collaboration
cockpit and OpenClaw gateway lane.

It keeps the `1.1.0` stable claim scope and adds three release-train fixes:
same-connection live-control failure handling, Desktop-first daily skill
guidance, and a runtime-required daily orchestration scenario contract.

## What Changed

- Hardens same-connection Codex live control from #380 / PR #390:
  - `loo_codex_send_message` keeps `thread/resume` and `turn/start` on the
    same Codex app-server connection.
  - failed or incomplete multi-step responses now fail closed before a live
    audit success record is appended.
  - the live-control smoke helper stops after the first failed sequence step,
    so a failed `thread/resume` cannot be followed by `turn/start`.
- Updates the packaged OpenClaw agent skill from #385 / PR #391:
  - replaces private-name approval wording with explicit requesting-user
    approval for the exact target and action.
  - clarifies that autonomy tick steps are recommendations until separately
    requested and approved.
- Adds the Desktop-first daily orchestration scenario from #382 / PR #392:
  - app-server status, app-server thread signals, visible Codex map,
    Desktop coherence, fallback status, collaboration cockpit, runtime Desktop
    visibility, active-thread state, and autonomy tick appear in one
    runtime-required scenario contract.
  - the scenario requires public-safe evidence and explicitly blocks live
    control, GUI mutation, screenshots, npm publish, and GitHub Release
    creation during the scenario itself.
- Carries forward the #160 desktop proof-action release boundary:
  `loo_desktop_proof_action` / `loo desktop proof-action` validates the
  action-bound CUA Driver TextEdit scratch proof gate and does not prove
  generic GUI mutation. The proof action still requires exact backend, target
  app, target window, action hash, approval ref, permission state, scratch file
  path, and `execute: true` before the backend can run. Generic gateway
  invocation without exact proof args fails closed, using the same proof
  boundary as beta.35.
  The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run.
  generic gateway invocation without exact proof args fails closed.
  This release uses the same proof boundary as beta.35.
- Carries forward strict OpenClaw gateway result handling:
  plugin output with `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than successful tool proof.

## Stable Claim Scope

Allowed stable claim remains:

> Codex-first local orchestration through OpenClaw for local Codex sessions,
> including local indexing, search, describe, bounded expansion, dry-run control
> envelopes, read-only collaboration cockpit/autonomy cards, read-only Desktop
> visibility and fallback status, action-bound proof-packet validation,
> public-safe scorecards, and installed OpenClaw gateway dogfood.

This patch does not widen the live-control matrix, GUI mutation scope, Claude
adapter scope, P1 business-adapter scope, or enterprise/customer readiness
claim. The same excluded-claim boundaries from `1.1.0` remain in force.

## Release Gate Notes

- Stable issue: #393.
- Included implementation issues: #380, #385, and #382.
- Parent product tracker: #309.
- Operating-loop tracker: #16.
- Baseline stable release: `v1.1.0`.
- Candidate package: `lossless-openclaw-orchestrator@1.1.1`.
- Expected git tag: `v1.1.1`.
- Expected GitHub Release:
  `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/releases/tag/v1.1.1`.
- Required pre-publish stable gates: `npm run check`, `npm pack --dry-run`,
  strict scenario sweep, strict scorecard sweep, release preflight, release
  bundle, release demo-status, release status, OpenClaw dogfood, and OpenClaw
  tool-smoke for the exact stable candidate SHA.
- Required PR gates: GitHub CI, CodeQL, current-head review threads clear, and
  any actionable review feedback fixed before merge.
- Required post-publish stable gates: npm `latest` view, git tag, GitHub
  non-prerelease Release, `loo release finalization-status --expected-dist-tag
  latest --expected-github-prerelease false --strict`, fresh npm `@latest`
  published-smoke, and strict general-readiness before #393 closes.
- `approved_live_control_smoke_missing` remains the expected blocker when a
  working-app claim is attempted without approved live-control smoke evidence
  for the exact candidate SHA.
- Working-app status example:
  `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Post-publish finalization example:
  `loo release finalization-status --evidence-dir <path> --candidate-sha <sha> --npm-publish-evidence <path> --git-tag-evidence <path> --github-release-evidence <path> --expected-dist-tag latest --expected-github-prerelease false --strict`

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
It does not run generic GUI mutation and does not run Codex GUI mutation.
No automatic gateway authorization.
No broad gateway scope approval. No prompt typing. No clicking. No arbitrary app control.
Claude Code remains an adapter stub, not an adapter-equivalence claim.
Bundle/status/finalization checks do not publish to npm and do not create a GitHub Release.
No release-grade enterprise security.
No Claude Code parity, no Notion/support-control/Stripe/Company Brain P1
adapter proof, no cloud sync, no unattended desktop takeover, and no
enterprise/customer-ready security is claimed.
