# Release Notes 0.1.0-beta.29

`0.1.0-beta.29` keeps the Codex-first working-app beta scope for local Codex sessions
and packages the M9 Agent Handoff Beta Sprint so a local OpenClaw agent has a
clearer path from install to safe Codex session recall and dry-run
orchestration.

## What Changed

- #232 adds the first-class OpenClaw agent usage skill at
  `skills/lossless-openclaw-orchestrator/SKILL.md`, covering the canonical
  `loo_*` workflows for search, describe, bounded expansion, plans, finals,
  touched files, and approval-gated dry-run control.
- #233 aligns README and VISION with the current M9 agent handoff sprint and
  moves M7 working-app proof into completed proof instead of current work.
- #234 adds the OpenClaw agent dogfood scenario and hardens
  `loo openclaw tool-smoke` so an agent can prove search, describe, bounded
  expand, plan/final/touched-file lookups, public-safe recommendation, and
  dry-run audit evidence without raw transcript access.
- #235 adds the fresh npm beta install and clean-profile OpenClaw scenario,
  proving current beta install/load through a public-safe clean-profile path
  and recording npm selector cutoff drift as a setup/install diagnostic rather
  than a package-readiness overclaim.
- #236 adds `docs/RELEASE_CHECKLIST.md` and `loo release general-readiness`,
  a fail-closed 1.0 readiness gate for M9 evidence. The gate does not publish
  npm, create a GitHub Release, promote `latest`, run live Codex control, or
  mutate a desktop GUI.
- #229 continues to ship `loo openclaw published-smoke`, the one-command
  published package smoke report for first-run OpenClaw gateway package proof.
- #225 continues to ship the public-safe `postInstallSelfCheck` block for
  `loo onboard status`.
- #221 continues to ship the published-beta `installRecovery` block and clean
  profile recovery commands.
- #160 continues to ship `loo_desktop_proof_action` /
  `loo desktop proof-action`, limited to one CUA Driver TextEdit scratch proof
  path. The proof action still requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the backend can run.
- #160 proves generic gateway invocation without exact proof args fails closed.
- #160 keeps the `loo openclaw tool-smoke` hardening where a successful gateway
  envelope with plugin `output.details.ok: false` is reported as
  `openclaw_tool_result_not_ok:<tool>` rather than a passing tool call.

## Current Claim Scope

Allowed beta claim:

> Codex-first working-app beta through installed OpenClaw gateway for local
> Codex sessions, plus public-safe M9 agent handoff docs, skill, dogfood,
> clean-profile install proof, install/onboarding recovery guidance,
> post-install self-check classification, one-command published package smoke
> reporting, and a fail-closed 1.0 general-readiness gate.

This release does not widen the beta.24 claim except through the later
package/onboarding and M9 agent handoff gates. It widens the beta.28
package-smoke claim only by adding the M9 agent handoff surfaces and the
general-readiness gate. Desktop collaboration remains limited to the CUA Driver
TextEdit scratch proof-action path when that specific proof is claimed. Generic
GUI mutation, Codex GUI mutation, prompt typing, clicking, arbitrary app
control, and unattended takeover remain excluded. Claude Code remains an adapter stub, not a parity claim.

## Release Gate Notes

- `loo release general-readiness --strict` checks the stable/1.0 handoff bar
  from public-safe evidence. It is a gate, not a publish command.
- General-readiness example:
  `loo release general-readiness --evidence-dir <path> --fresh-npm-evidence <path> --agent-dogfood-evidence <path> --strict`
- `loo openclaw published-smoke --strict` consumes sanitized dogfood and
  tool-smoke reports and writes `published-package-smoke.json`.
- A public-safe published package smoke example:
  `loo openclaw published-smoke --evidence-dir <path> --registry-beta-version 0.1.0-beta.29 --dogfood-report <path> --tool-smoke-report <path> --strict`
- `loo onboard status --strict` continues to emit both `installRecovery` and
  `postInstallSelfCheck`.
- A public-safe post-install self-check example:
  `loo onboard status --evidence-dir <path> --registry-beta-version 0.1.0-beta.29 --gateway-setup-status gateway_setup_required --strict`
- Use `gateway_setup_required` to classify first-run OpenClaw gateway
  credential or device-pairing blockers without treating them as package
  defects.
- Working-app status example: `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example: `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Use `codex-working-app-proof` only when the candidate has approved
  live-control smoke evidence plus runtime proof markers.
- `approved_live_control_smoke_missing` remains the blocker when a working-app
  claim is attempted without approved live-control smoke evidence.
- `latest` remains pinned to `0.1.0-beta.4`; if this candidate is published,
  npm `beta` points at `0.1.0-beta.29`.

## Explicit Non-Claims

This beta runs no new live Codex control smoke, does not run generic GUI mutation, and does not run Codex GUI mutation. No automatic gateway authorization, no broad gateway scope approval, no prompt typing, no clicking, no arbitrary app control, no Claude parity, No cloud sync, no 1.0/stable readiness, No unattended desktop takeover, No release-grade enterprise security, and no enterprise/customer-ready security are claimed. Bundle/status checks do not publish to npm and do not create a GitHub Release.
