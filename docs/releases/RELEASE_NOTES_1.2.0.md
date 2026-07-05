# Release Notes 1.2.0

`1.2.0` is the first stable release for the LCO 1.2 prepared-state sprint and
Codex-first local orchestration. It promotes the scoped beta.3 work to the
stable npm `latest` channel after the 1.2 tracker, cockpit epic, release
finalization, and public-claim gates closed cleanly.

This release is focused on local Codex sessions. Prepared state remains an
advisory local derived cache, not source authority for PR, CI, release,
runtime, customer, or business truth.

## What Changed

- Adds additive prepared-state storage for source events, source ranges,
  summary leaves, summary edges, prepared cards, watcher observations, hook
  capture packets, and state-prep jobs.
- Adds deterministic summary leaves from user prompts, proposed plans, finals,
  closeout envelopes, touched-file metadata, tool-call metadata, and compaction
  markers while ignoring huge raw tool-call payloads by default.
- Adds bounded summary expansion with source ranges, max-depth and max-node
  limits, cycle rejection, and explicit omission markers.
- Adds prepared cards and prepared inbox routing with freshness, confidence,
  privacy class, source coverage, authority coverage, and stale/partial/unknown
  downgrades.
- Adds persisted watcher observations and an execute-false local attention queue
  for safe advisory automation.
- Adds hook sidecar commands for closeout capture, state prep, and compaction
  marker capture without opening transcript paths by default.
- Adds OpenClaw gateway dogfood coverage for the prepared-state workflow.
- Adds optional local model compaction spike gates and a Codex-native
  compaction-summary capture proposal without claiming true native capture.
- Adds semantic lifecycle states for prepared cards and prepared inbox routing:
  `completed`, `blocked_missing_info`, `waiting_approval`,
  `watching_external_check`, `needs_resume`, `dirty_worktree_handoff`,
  `ready_for_review`, `stale_or_partial`, and `unknown_lifecycle`.
- Exposes the lifecycle state enum through the shared core registry, MCP tool
  schema, OpenClaw plugin manifests, and OpenClaw gateway smoke validation.
- Adds deterministic lifecycle reason codes, lifecycle-aware next actions, and
  urgency ranking for advisory prepared cards.
- Adds a completed-card summary counter so finished lanes remain visible in
  prepared-card summaries.
- Tightens lifecycle classification so generic words such as `resume`,
  `monitor`, and `ci` do not become lifecycle states without operator-action
  context.
- Fixes completed prepared-card target coverage so a fresh public completed card
  counts as target coverage `ok` and does not make `loo_prepared_state_status`
  report stale/partial coverage for a fully materialized completed lane.
- Preserves stale, partial, unknown, unsafe-row, and stale-freshness downgrades
  for incomplete or unsafe prepared-state evidence.
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

> Local prepared Codex state and summary-leaf recall for OpenClaw/Eva, including
> semantic prepared-card lifecycle routing, prepared inbox prioritization,
> bounded summary expansion, visible Codex sidebar inventory, hook sidecar
> foundations, watcher observations, and approval-gated start-thread proof
> packets without raw transcript reads.

The stable channel means the scoped prepared-state and cockpit-management
surface is ready as a public local-Codex release. It does not broaden the
control, GUI, Claude, customer, or enterprise-security proof boundary.

## Release Gate Notes

- Parent 1.2 tracker: #405.
- Cockpit tracker: #448.
- Stable promotion issue: #475.
- Included late implementation PRs: #452, #472, and #474.
- Baseline stable release: `v1.1.4`.
- Prior beta release: `v1.2.0-beta.3`.
- Candidate package: `lossless-openclaw-orchestrator@1.2.0`.
- Expected npm dist-tag: `latest`.
- Expected git tag: `v1.2.0`.
- Required stable gates: focused prepared-card/OpenClaw tool-smoke tests,
  release claim audit, build/typecheck, `npm pack --dry-run`, release
  bundle/status checks, GitHub CI, CodeQL, current-head review threads clear,
  npm publish to `latest`, GitHub release, and post-publish finalization status.
- Bundle/status/finalization dry-run checks do not publish to npm and do not create a GitHub Release.
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
