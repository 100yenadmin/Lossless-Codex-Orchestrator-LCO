# Public Claim Audit

## Allowed Stable 1.4.1 Claim

Collaborate with local Codex sessions through OpenClaw using local indexing, prepared-state recall, bounded expansion, and approval-gated dry-run/control boundaries.

This claim is limited to the Codex stable path that has tests and local smoke coverage: indexing, search, describe, prepared-state cards/inbox, summary leaves, bounded expansion, read-only LCM peer recall, Codex direct protocol diagnostics, dry-run approval audits, and read-only CUA/Peekaboo readiness.

Scratch-thread live smokes are standing-approved only when the prompt is
harmless, the thread created by the smoke is disposable, and the evidence stays
public-safe. Real user threads still require exact-target approval before any
live resume/send/steer/interrupt action.

When a release candidate is scoped to read/search/describe/expand plus dry-run
control only, use `--claim-scope codex-read-search-expand-dry-run` on release
preflight, bundle, demo-status, and status commands. That scope must omit
`--approved-live-control-evidence` and the generated JSON must list
`excludedClaims` with `approved_live_control_smoke` and
`codex_working_app_runtime_proof` excluded. Use the default `codex-live-control`
scope only when the release claim includes an approved live Codex
send/resume/steer/interrupt smoke but does not claim the installed gateway plus
post-action refresh working-app loop.

## Forbidden Beta Claims

- No full Claude Code parity.
- No cloud sync.
- No unattended desktop takeover.
- No permission bypass.
- No generic GUI mutation.
- No release-grade enterprise security claim.

Claude Code is an adapter stub in this beta. Public docs may mention the stub, but must not imply Claude Code session indexing or control parity until storage and control paths are proven.

## Current Proof Boundary

- Codex session import/search/recall and extraction are covered by fixture tests and local smoke.
- Live Codex control is approval-gated by a dry-run audit id; the public demo stops at dry-run unless the user explicitly approves a target thread.
- CUA Driver is the preferred fallback backend, but no no-focus behavior is claimed without local proof.
- Peekaboo is a secondary macOS fallback for permission diagnostics and guarded snapshots; desktop action remains dry-run-only.
- OpenClaw LCM peer DBs are read-only and remain separate from the Codex index.
- Optional local model compaction is canary-only, disabled by default, and not a
  release claim. The current proof is limited to
  [local model compaction canary](LOCAL_MODEL_COMPACTION_CANARY.md) validation
  over approved prepared-card and summary-leaf refs; it does not call a model,
  read raw transcripts, feed current `safe_text`, or claim true compaction.

Compaction hook sidecars are marker-only. Public and release-facing copy may say
`compaction observed`, but must not claim the generated compaction summary was
captured until Codex-native sanitized packet support exists. The proposal and
claim-audit fixture live in
[docs/CODEX_NATIVE_COMPACTION_CAPTURE.md](CODEX_NATIVE_COMPACTION_CAPTURE.md)
and `evals/scenarios/v1/codex-native-compaction-capture-proposal-v1.json`.

## Working App Proof Boundary

Milestone 7 introduces a stricter working-app target in
[#156](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/156).
The runtime-proven claim is not satisfied by dry-run scenario packets alone. It
requires all of these public-safe proof markers:

- installed OpenClaw gateway path invokes the required `lco_*` tools
- one harmless Codex action is dry-run first and live second with a matching
  approval audit id through that installed path
- the target session is refreshed after the live action
- an agent reasoning packet cites source refs and bounded safe summaries only
- desktop collaboration proof is included only if the claim mentions desktop
  fallback behavior
- evidence scan reports no raw transcript, raw prompt, SQLite, screenshot,
  token, cookie, credential, or private customer data

The `codex-working-app-proof` release claim scope is available but fail-closed.
It requires `--runtime-proof-dir` with public-safe v1.1 proof markers named
`openclaw-gateway-live-codex-v1-1.runtime-proof.json` and
`post-action-refresh-reasoning-v1-1.runtime-proof.json`, plus the approved
live-control proof marker. Without those markers, release preflight/status,
bundle, demo-status, and scorecard sweep must report `runtime_proof_missing:*`
blockers instead of allowing a working-app claim.

## npm dist-tag policy

Install stable releases through the `latest` dist-tag, public betas through the
`beta` dist-tag, and release candidates through `next`. The stable channel
target for this package version is `1.4.1`; npm `latest` must move only after
the separate stable-promotion gate proves the exact candidate. Keep beta and
other prereleases on prerelease tags. Do not publish a fake stable package just
to move a dist-tag.

## Release Checklist

- `npm run check`
- `npm run build`
- `npm pack --dry-run`
- `release_scorecard_source="/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-scorecard-source"`
- `mkdir -p "$release_scorecard_source"`
- `cp evals/scorecards/v1.0/*.json "$release_scorecard_source"`
- Fill the copied scorecards with run-specific scores, evidence paths, known gaps, and proof boundaries before treating scorecard sweep as release evidence.
- `lco scorecards sweep --claim-scope codex-read-search-expand-dry-run --scorecard-dir "$release_scorecard_source" --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-scorecards --strict`
- `lco release preflight --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight --strict`
- `lco release bundle --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-bundle`
- `lco release status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict`
- Read/search/expand/dry-run scoped RC only: `lco release status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict`
- GitHub CI green for the release PR
- GitHub CI and CodeQL proof markers match the release candidate SHA and have
  empty `warnings` arrays
- Demo evidence under `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/`
- Generate release gate reports from inside the dated evidence root with a relative --evidence-dir
  value so the artifact manifests remain relocatable.
- Use a synthetic corpus or committed retrieval goldens for demo output;
  live-store content can never be public evidence.
- High-context document/workflow scan evidence covering safety bypass review,
  retrieval quality review, packaging/install review, public-claim review, and
  local-agent usability review across README.md, `VISION.md`, release notes,
  claim audit, GitHub workflows, CLI release gates, docs, workflows, skills, and
  runbooks
- Working-app claims only: runtime proof scenario packet,
  `working-app-runtime-proof-review.json`, and scorecard sweep with
  `--claim-scope codex-working-app-proof --runtime-proof-dir <proof-dir>` must
  pass with installed gateway, approved live Codex action, post-action refresh,
  and safe reasoning evidence
- No raw session transcripts, credentials, screenshots with secrets, or private SQLite DBs in public artifacts

`lco release preflight` writes a public-safe `release-preflight.json` artifact manifest. It must report `approved_live_control_smoke_missing` until an explicit approved live-control smoke evidence path points to a structured `loo_approved_live_control_smoke` JSON proof marker with only audit ids, refs, hashes, approval-semantics confirmation, and `rawPromptIncluded: false`. Release automation should use `--strict` so this blocker cannot be silently ignored.

The only exception is an explicitly scoped read/search/expand/dry-run release
candidate using `--claim-scope codex-read-search-expand-dry-run`. In that mode,
the release reports must include `excludedClaims` showing
`approved_live_control_smoke` and `codex_working_app_runtime_proof` as excluded,
and public copy must not claim live Codex continue/steer/send/interrupt proof or
runtime-proven installed working-app behavior.

Opt-in retrieval telemetry does not widen the public evidence boundary for this
claim scope. Public evidence, release reports, and telemetry metrics must stay
at aggregate count/rank/hash/placeholder level and must not include harvested
query text, raw prompts, transcripts, or local database artifacts. Operator
mechanics and the local telemetry safety boundary live in
`docs/OPENCLAW_PLUGIN.md`.

`lco release bundle` writes local draft release artifacts without publishing: `RELEASE_NOTES_<package-version>.md`, `release-preflight.json`, and `release-bundle.json`. It must record `npmPublished: false` and `githubReleaseCreated: false` until a separate explicit publish step is approved.

`lco release status` writes `release-status.json` without performing gated actions. It must record `npmPublished: false`, `githubReleaseCreated: false`, `liveCodexControlRun: false`, and `desktopGuiActionRun: false`, and it must list `npm_publish_not_approved` and `github_release_not_approved` until those separate release operations are explicitly approved through safe `loo_release_operation_approval` proof markers. It must also list `candidate_sha_missing` or `candidate_sha_invalid`, `github_ci_evidence_missing` or `github_ci_sha_mismatch`, and `codeql_evidence_missing` or `codeql_sha_mismatch` until exact release candidate SHA evidence is supplied. Any non-empty CI or CodeQL `warnings` array, including workflow/action deprecation warnings, must keep release status blocked with `github_ci_warnings_present` or `codeql_warnings_present`. Release operation proof markers must include `operation: "npm_publish" | "github_release"`, `approved: true`, a non-empty `approvalRef`, and `rawSecretIncluded: false`.

For this beta train, public release means both npm package publication and
GitHub Release creation. A single-surface maintenance publication needs an
explicit planned-operation contract change before `lco release status --strict`
can be used as the final ready gate.

Desktop GUI mutation is not required for a normal beta publication. If a release plan includes GUI mutation, `lco release status --strict` must be run with `--runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proof --desktop-gui-required --desktop-gui-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/desktop-gui-approval.json`; the runtime proof directory must include `desktop-collaboration-action-bound-v1-1.runtime-proof.json` with an `action_hash` matching the approved desktop action. The `loo_release_operation_approval` proof marker must include `operation: "desktop_gui_mutation"`, `approved: true`, a non-empty `approvalRef`, `desktopBackend`, `targetApp`, `targetWindow`, `action`, `actionHash`, `focusBeforeApplication`, `focusAfterApplication`, `focusChanged: false`, `focusProof`, `rawScreenshotIncluded: false`, and `rawSecretIncluded: false`. `actionHash` must match the exact SHA-256 hash emitted by `lco desktop proof-report` for `JSON.stringify({ desktopBackend, targetApp, targetWindow, action })`; a merely well-formed 64-character hash is not enough, and the runtime marker `action_hash` must match it. When `lco desktop proof-report --strict` validates a public-safe backend observation, it emits both the approval fixture and the desktop collaboration runtime proof marker; invalid observations must not emit that runtime marker.
Diagnostic-only focus proofs such as `status_probe_only_no_action` and
`not_measured` do not satisfy desktop GUI mutation approval.
