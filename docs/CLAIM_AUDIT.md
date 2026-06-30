# Public Beta Claim Audit

## Allowed Public Beta Claim

Control and collaborate with local Codex sessions through OpenClaw using local indexing, bounded recall, and approval-gated controls.

This claim is limited to the Codex beta path that has tests and local smoke coverage: indexing, search, describe, bounded expansion, read-only LCM peer recall, Codex direct protocol diagnostics, dry-run approval audits, and read-only CUA/Peekaboo readiness.

When a release candidate is scoped to read/search/describe/expand plus dry-run
control only, use `--claim-scope codex-read-search-expand-dry-run` on release
preflight, bundle, demo-status, and status commands. That scope must omit
`--approved-live-control-evidence` and the generated JSON must list
`excludedClaims` with `approved_live_control_smoke` excluded. Use the default
`codex-live-control` scope only when the release claim includes an approved live
Codex send/resume/steer/interrupt smoke.

## Forbidden Beta Claims

- No full Claude Code parity.
- No cloud sync.
- No unattended desktop takeover.
- No permission bypass.
- No release-grade enterprise security claim.

Claude Code is an adapter stub in this beta. Public docs may mention the stub, but must not imply Claude Code session indexing or control parity until storage and control paths are proven.

## Current Proof Boundary

- Codex session import/search/recall and extraction are covered by fixture tests and local smoke.
- Live Codex control is approval-gated by a dry-run audit id; the public demo stops at dry-run unless the user explicitly approves a target thread.
- CUA Driver is the preferred fallback backend, but no no-focus behavior is claimed without local proof.
- Peekaboo is a secondary macOS fallback for permission diagnostics and guarded snapshots; desktop action remains dry-run-only.
- OpenClaw LCM peer DBs are read-only and remain separate from the Codex index.

## npm dist-tag policy

Until the first stable release exists, npm `latest` may point at the newest
public beta because npm requires a `latest` tag and the public install docs use
the default package target. The `beta` tag must point at the newest public beta.
At the first stable release, move `latest` to the stable version and keep beta
and other prereleases on prerelease tags. Do not publish a fake stable package
just to move a dist-tag.

## Release Checklist

- `npm run check`
- `npm run build`
- `npm pack --dry-run`
- `release_scorecard_source="/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-scorecard-source"`
- `mkdir -p "$release_scorecard_source"`
- `cp evals/scorecards/v1.0/*.json "$release_scorecard_source"`
- Fill the copied scorecards with run-specific scores, evidence paths, known gaps, and proof boundaries before treating scorecard sweep as release evidence.
- `loo scorecards sweep --scorecard-dir "$release_scorecard_source" --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-scorecards --strict`
- `loo release preflight --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight --strict`
- `loo release bundle --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-bundle`
- `loo release status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict`
- Read/search/expand/dry-run scoped RC only: `loo release status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict`
- GitHub CI green for the release PR
- GitHub CI and CodeQL proof markers match the release candidate SHA and have
  empty `warnings` arrays
- Demo evidence under `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/`
- High-context document/workflow scan evidence covering safety bypass review,
  retrieval quality review, packaging/install review, public-claim review, and
  local-agent usability review across README.md, `VISION.md`, release notes,
  claim audit, GitHub workflows, CLI release gates, docs, workflows, skills, and
  runbooks
- No raw session transcripts, credentials, screenshots with secrets, or private SQLite DBs in public artifacts

`loo release preflight` writes a public-safe `release-preflight.json` artifact manifest. It must report `approved_live_control_smoke_missing` until an explicit approved live-control smoke evidence path points to a structured `loo_approved_live_control_smoke` JSON proof marker with only audit ids, refs, hashes, approval-semantics confirmation, and `rawPromptIncluded: false`. Release automation should use `--strict` so this blocker cannot be silently ignored.

The only exception is an explicitly scoped read/search/expand/dry-run release
candidate using `--claim-scope codex-read-search-expand-dry-run`. In that mode,
the release reports must include `excludedClaims` showing
`approved_live_control_smoke` as excluded, and public copy must not claim live
Codex continue/steer/send/interrupt proof.

`loo release bundle` writes local draft release artifacts without publishing: `RELEASE_NOTES_<package-version>.md`, `release-preflight.json`, and `release-bundle.json`. It must record `npmPublished: false` and `githubReleaseCreated: false` until a separate explicit publish step is approved.

`loo release status` writes `release-status.json` without performing gated actions. It must record `npmPublished: false`, `githubReleaseCreated: false`, `liveCodexControlRun: false`, and `desktopGuiActionRun: false`, and it must list `npm_publish_not_approved` and `github_release_not_approved` until those separate release operations are explicitly approved through safe `loo_release_operation_approval` proof markers. It must also list `candidate_sha_missing` or `candidate_sha_invalid`, `github_ci_evidence_missing` or `github_ci_sha_mismatch`, and `codeql_evidence_missing` or `codeql_sha_mismatch` until exact release candidate SHA evidence is supplied. Any non-empty CI or CodeQL `warnings` array, including workflow/action deprecation warnings, must keep release status blocked with `github_ci_warnings_present` or `codeql_warnings_present`. Release operation proof markers must include `operation: "npm_publish" | "github_release"`, `approved: true`, a non-empty `approvalRef`, and `rawSecretIncluded: false`.

For this beta train, public release means both npm package publication and
GitHub Release creation. A single-surface maintenance publication needs an
explicit planned-operation contract change before `loo release status --strict`
can be used as the final ready gate.

Desktop GUI mutation is not required for a normal beta publication. If a release plan includes GUI mutation, `loo release status --strict` must be run with `--desktop-gui-required --desktop-gui-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/desktop-gui-approval.json`, and that `loo_release_operation_approval` proof marker must include `operation: "desktop_gui_mutation"`, `approved: true`, a non-empty `approvalRef`, `desktopBackend`, `targetApp`, `targetWindow`, `action`, `actionHash`, `focusBeforeApplication`, `focusAfterApplication`, `focusChanged: false`, `focusProof`, `rawScreenshotIncluded: false`, and `rawSecretIncluded: false`.
Diagnostic-only focus proofs such as `status_probe_only_no_action` and
`not_measured` do not satisfy desktop GUI mutation approval.
