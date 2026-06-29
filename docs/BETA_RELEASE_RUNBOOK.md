# Beta Release Runbook

This runbook is the operator contract for cutting a public beta of Lossless
OpenClaw Orchestrator. It keeps feature integration, release candidates, and
actual publication separate so a merged PR does not become an accidental release
claim.

## Release Truth

- GitHub issues are the implementation truth.
- Issue #6 tracks the Milestone 5 public beta release.
- Issue #14 tracks the public beta package, release, demo, and claim audit child
  work.
- `VISION.md` is the product and eval truth.
- This runbook is the release-operation truth for the beta train.
- Evidence path: `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/<release-slug>/`.

## Branch And Release Cadence

`main` is the integration branch, not a release. In plain operator language:
main is the integration branch, not a release.

Use this cadence for beta work:

1. Merge tested feature PRs to `main`.
2. Open or update the release tracker status on issue #6 and issue #14.
3. Cut a release candidate from the current `main` commit only after the beta
   gates below have a named evidence directory.
4. Validate the release candidate through the public CLI, MCP/OpenClaw plugin,
   scorecard, and claim-audit surfaces.
5. Publish npm or create a GitHub Release only after explicit user approval for
   that operation.
6. After publication, install from the published artifact and rerun the same
   public user-path smoke before calling the release complete.

Recommended naming:

- Branch: `release/0.1.0-beta.0`
- Tag: `v0.1.0-beta.0`
- Evidence slug:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-0.1.0-beta.0-rc`

## Pre-RC Gates

Before a release candidate is treated as ready, prove these from a clean checkout
or CI-backed branch:

```bash
npm run check
npm pack --dry-run
node ./dist/packages/cli/src/index.js scorecards sweep --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-scorecards --strict
node ./dist/packages/cli/src/index.js release preflight --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --strict
node ./dist/packages/cli/src/index.js release bundle --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-bundle --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --strict
node ./dist/packages/cli/src/index.js release demo-status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/demo --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --strict
node ./dist/packages/cli/src/index.js release status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --desktop-gui-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/desktop-gui-approval.json --strict
```

If `--strict` fails because an approval-gated operation is intentionally missing,
record that as a blocker rather than lowering the gate. The expected blocker
names include:

- `approved_live_control_smoke_missing`
- `npm_publish_not_approved`
- `github_release_not_approved`
- `desktop_gui_mutation_not_approved`

## OpenClaw Install And Tool Declaration Smoke

The local OpenClaw gateway is a first-class beta user. First run metadata-only
install/tool-declaration coverage from the candidate checkout:

```bash
node ./dist/packages/cli/src/index.js openclaw dogfood --profile lco-dogfood --install-source . --link --required-tool loo_doctor --required-tool loo_search_sessions --required-tool loo_describe_session --required-tool loo_expand_query --required-tool loo_codex_plans --required-tool loo_codex_final_messages --required-tool loo_codex_thread_map --required-tool loo_codex_control_dry_run --evidence-path /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/openclaw-dogfood/plugin-load.json --strict
```

This command verifies:

- plugin install/load status
- declared `loo_*` tool coverage
- public-safe evidence only

Before the OpenClaw user path is called usable, also capture real OpenClaw
gateway tool-call evidence or record an explicit blocker. That public-safe
evidence must prove the gateway invoked `loo_doctor`, `loo_search_sessions`,
`loo_describe_session`, `loo_expand_query`, `loo_codex_plans`,
`loo_codex_final_messages`, `loo_codex_thread_map`, and
`loo_codex_control_dry_run`, including dry-run control audit creation without
mutating a real Codex thread.

Do not use the OpenClaw smoke to run live Codex control, GUI mutation, npm
publish, or GitHub Release creation.

## Release Candidate Checklist

A release candidate may be announced internally when all of these are true:

- issue #6 and issue #14 have current status comments
- GitHub CI is green for the release candidate commit
- `npm run check` passed locally or in CI
- `npm pack --dry-run` passed
- release preflight, release bundle, demo status, release status, and scorecard
  sweep wrote public-safe evidence
- OpenClaw dogfood has a current pass or an explicit blocker
- README, `VISION.md`, release notes, and claim audit agree on the proof
  boundary
- no public artifact contains raw Codex JSONL, local SQLite databases, raw
  prompts, screenshots, credentials, tokens, or private transcripts

## Publication Approval Gates

Publishing is separate from proving a release candidate.

Do not run live Codex control without explicit user approval for the exact target
thread and harmless prompt.

Do not run GUI mutation without explicit user approval for the backend, target
app/window, and action, plus a `loo_release_operation_approval` proof marker for
`operation: "desktop_gui_mutation"`.

Do not run `npm publish` without explicit user approval and a
`loo_release_operation_approval` proof marker for `operation: "npm_publish"`.

Do not create a GitHub Release without explicit user approval and a
`loo_release_operation_approval` proof marker for
`operation: "github_release"`.

The release status command must continue to report `npmPublished: false`,
`githubReleaseCreated: false`, and `desktopGuiActionRun: false` until those
separate operations are actually approved and executed.

## Public Release Steps

Only after the approval gates are satisfied:

1. Confirm the release candidate commit and tag name.
2. Run the final release status command with approved evidence paths.
3. Create the Git tag.
4. Publish npm if the approval covers npm publication.
5. Create the GitHub Release if the approval covers GitHub Release creation.
6. Install from the published artifact and rerun the OpenClaw user-path smoke.
7. Update issue #6 and issue #14 with the tag, package/version, GitHub Release
   URL if created, CI link, evidence path, working/not-working list, proof
   boundary, and next action.

## Stop Conditions

Stop and leave the release candidate unpublished if any of these occur:

- a live action can run without matching dry-run and `approval_audit_id`
- raw local session text, screenshots, SQLite databases, prompts, credentials,
  tokens, or customer data enter public evidence
- Claude Code parity, cloud sync, unattended desktop takeover, Codex permission
  bypass, or release-grade enterprise security is claimed
- CUA/Peekaboo readiness implies no-focus or mutation support that was not
  proven
- the OpenClaw package installs but does not expose the expected `loo_*` tools
- GitHub CI is red or review threads contain valid actionable defects

## Closeout

Every release-candidate or release closeout should include:

- commit SHA and tag or candidate name
- issue #6 and issue #14 status links
- commands run and exit status
- evidence path
- OpenClaw dogfood result
- scorecard movement
- what is working
- what is not proven
- whether npm publish or GitHub Release creation happened
- exact next action
