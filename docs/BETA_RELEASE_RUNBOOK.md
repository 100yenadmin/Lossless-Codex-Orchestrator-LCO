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
5. Publish npm and create a GitHub Release only after explicit user approval for
   each operation.
6. After publication, install from the published artifact and rerun the same
   public user-path smoke before calling the release complete.

Recommended naming:

- Branch: `release/0.1.0-beta.1`
- Tag: `v0.1.0-beta.1`
- Evidence slug:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-0.1.0-beta.1-rc`

## Working App Proof Lane

Milestone 7 is tracked separately from the `0.1.x` reduced-scope beta train:
[Working App Proof Sprint](WORKING_APP_PROOF_SPRINT.md), issue #156, and GitHub
milestone #8.

A release candidate may keep using `--claim-scope
codex-read-search-expand-dry-run` for maintenance betas. A future
working-app claim must not reuse that reduced-scope proof. It must first pass
the runtime proof lane from #157 through #162:

- runtime-required scenarios from `evals/scenarios/v1.1`
- `working-app-runtime-proof-review.json`
- installed OpenClaw gateway live Codex proof
- post-action refresh and safe reasoning proof
- desktop collaboration proof only when the claim mentions desktop fallback
- public-safe evidence scan with no raw/private artifacts

Now that #162 adds and validates the `codex-working-app-proof` claim scope,
operators should still record `working_app_runtime_proof_missing` as a blocker
until the release candidate supplies the required public-safe runtime marker
files. The gate exists so reduced-scope betas can remain honest while working
app proof stays fail-closed.

## Release Context Freshness Scan

At every release candidate and every public release, run a high-context
document/workflow scan before calling the release ready. This is an adversarial
review, not a publishing action.

Use a long-context release-review agent for this pass. The preferred profile is
an approved long-context model alias such as `gpt-5.4` with `1M-context` when
that profile is available in the maintainer environment; otherwise record the
actual agent/model/context window used and keep the review blocked if it cannot
inspect the release docs, workflows, skills, and runbooks together.

The scan must inspect README.md, `VISION.md`, release notes, claim audit, GitHub workflows, and CLI release gates together, plus package scripts, repo guidance, local release skills, and this runbook, so the release story cannot pass by checking only one file or one command. If the scan finds stale or incomplete release instructions, update this runbook in the same PR before treating the release candidate as ready.

Record findings under:
`/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/<release-slug>/release-context-freshness/`.

The high-context scan must cover these named scorecard lenses:

- safety bypass review
- retrieval quality review
- packaging/install review
- public-claim review
- local-agent usability review
- working-app runtime proof review when the release claims more than the reduced
  `codex-read-search-expand-dry-run` scope

## Pre-RC Gates

Before a release candidate is treated as ready, prove these from a clean checkout
or CI-backed branch:

```bash
release_candidate_sha="$(git rev-parse HEAD)"
release_scorecard_source="/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-scorecard-source"
mkdir -p "$release_scorecard_source"
cp evals/scorecards/v1.0/*.json "$release_scorecard_source"
# Fill the copied scorecards with run-specific scores, evidence paths, known gaps,
# and proof boundaries before running the strict sweep. Do not edit the v1.0
# example scorecards in place for an RC claim.
npm run check
npm pack --dry-run
node ./dist/packages/cli/src/index.js scorecards sweep --claim-scope codex-live-control --scorecard-dir "$release_scorecard_source" --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-scorecards --strict
node ./dist/packages/cli/src/index.js release preflight --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --strict
node ./dist/packages/cli/src/index.js release bundle --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-bundle --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --strict
node ./dist/packages/cli/src/index.js release demo-status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/demo --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --strict
node ./dist/packages/cli/src/index.js release status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha "$release_candidate_sha" --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict
```

If the release candidate intentionally excludes live Codex control and claims
only read/search/describe/expand plus dry-run control, use this scope on every
release gate instead of passing live-control evidence:

```bash
node ./dist/packages/cli/src/index.js scorecards sweep --claim-scope codex-read-search-expand-dry-run --scorecard-dir "$release_scorecard_source" --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-scorecards --strict
node ./dist/packages/cli/src/index.js release preflight --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight --strict
node ./dist/packages/cli/src/index.js release bundle --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-bundle --strict
node ./dist/packages/cli/src/index.js release demo-status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/demo --strict
node ./dist/packages/cli/src/index.js release status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha "$release_candidate_sha" --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict
```

Those reports must include `claimScope:
"codex-read-search-expand-dry-run"` and `excludedClaims` for
`approved_live_control_smoke` and `codex_working_app_runtime_proof`. They are
not proof of live Codex send/resume/steer/interrupt or runtime-proven installed
working-app behavior.

If the release candidate claims the Milestone 7 working-app path, use
`codex-working-app-proof` on every release gate and pass the same
`--runtime-proof-dir` used by the v1.1 scenario sweep:

```bash
node ./dist/packages/cli/src/index.js eval scenarios --scenario-dir evals/scenarios/v1.1 --runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proof --scenario-id openclaw-gateway-live-codex-v1-1 --scenario-id post-action-refresh-reasoning-v1-1 --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-scenarios --strict
node ./dist/packages/cli/src/index.js release preflight --claim-scope codex-working-app-proof --runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proof --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --strict
node ./dist/packages/cli/src/index.js release bundle --claim-scope codex-working-app-proof --runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proof --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-bundle --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --strict
node ./dist/packages/cli/src/index.js release demo-status --claim-scope codex-working-app-proof --runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proof --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/demo --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --strict
node ./dist/packages/cli/src/index.js release status --claim-scope codex-working-app-proof --runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proof --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha "$release_candidate_sha" --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict
```

That scope requires
`openclaw-gateway-live-codex-v1-1.runtime-proof.json` and
`post-action-refresh-reasoning-v1-1.runtime-proof.json`. Missing or unsafe
markers must block with `runtime_proof_missing:*`,
`runtime_proof_not_public_safe:*`, `runtime_proof_raw_private:*`, or
`runtime_proof_secret_like:*`.
Add `--scenario-id desktop-collaboration-action-bound-v1-1` or
`--scenario-id connected-local-ui-proof-v1-1` only when the release copy claims
desktop fallback or connected local UI behavior.
When `--desktop-gui-required` is present, `loo release status --strict` also
requires `desktop-collaboration-action-bound-v1-1.runtime-proof.json` in
`--runtime-proof-dir`; desktop GUI approval evidence alone is not enough.

If `--strict` fails because an approval-gated operation is intentionally missing,
record that as a blocker rather than lowering the gate. The expected blocker
names include:

- `approved_live_control_smoke_missing`
- `runtime_proof_dir_missing`
- `runtime_proof_missing:<scenario-id>:<marker>`
- `npm_publish_not_approved`
- `github_release_not_approved`
- `candidate_sha_missing` or `candidate_sha_invalid`
- `github_ci_evidence_missing`, `github_ci_sha_mismatch`,
  `github_ci_warnings_present`, `github_ci_pending`, or `github_ci_failed`
- `codeql_evidence_missing`, `codeql_sha_mismatch`,
  `codeql_warnings_present`, `codeql_pending`, or `codeql_failed`
- `desktop_gui_mutation_not_approved`, only when `--desktop-gui-required` is
  present
- `desktop_collaboration_proof_missing`, only when `--desktop-gui-required` is
  present without the action-bound runtime proof marker

Repository gate evidence must be tied to the exact release candidate SHA, not
just the latest branch run. Capture workflow and repository-gate inventory before
writing the `github-ci.json` and `codeql.json` proof markers:

```bash
gh workflow list
gh run list --commit "$release_candidate_sha" --workflow CI --limit 1 --json databaseId,headSha,status,conclusion,url
gh run list --commit "$release_candidate_sha" --workflow CodeQL --limit 1 --json databaseId,headSha,status,conclusion,url
gh api repos/100yenadmin/Lossless-Codex-Orchestrator-LCO/rulesets
gh api 'repos/100yenadmin/Lossless-Codex-Orchestrator-LCO/code-scanning/alerts?state=open'
```

Each release check proof marker must use
`kind: "loo_release_check_evidence"`, `check: "github_ci" | "codeql"`, the
exact `commitSha`, `status: "completed"`, `conclusion: "success"`, a run URL,
`warnings: []`, and `rawSecretIncluded: false`. If a workflow log or GitHub UI
shows action/runtime deprecation warnings such as CodeQL Action v3, a Node 20
action runtime warning, or another soon-disabled workflow action major, record
that text in `warnings`; `loo release status --strict` must remain blocked until
the warning is removed.

If desktop GUI mutation is part of the release plan, rerun release status with
`--runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proof --desktop-gui-required --desktop-gui-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/desktop-gui-approval.json`.
That proof marker must include `operation: "desktop_gui_mutation"`,
`approved: true`, a non-empty `approvalRef`, `desktopBackend`, `targetApp`,
`targetWindow`, `action`, `actionHash`, `approvalNonce`, `issuedAt`,
`expiresAt`, `focusBeforeApplication`, `focusAfterApplication`,
`focusChanged: false`, `focusProof`,
`rawScreenshotIncluded: false`, and `rawSecretIncluded: false`.
Diagnostic-only focus proofs such as `status_probe_only_no_action` and
`not_measured` are not accepted for desktop GUI mutation approval.

Before attempting a backend-specific live GUI proof, run
`loo desktop live-proof-harness --evidence-dir <path> --backend cua-driver|peekaboo --target-app <app> --target-window <title> --action <action> --approval-ref <ref> --strict`
or call `loo_desktop_live_proof_harness` through MCP/OpenClaw. The harness
writes `desktop-live-proof-harness.json` and fails closed until the proof plan
has a GUI fallback backend, action-bound target fields, an approval reference,
backend availability, and a stable no-focus status probe. The harness itself
does not perform the GUI action or capture screenshots.

Use `loo desktop proof-report --evidence-dir <path> --observation-file <path> --strict`
to validate a supplied backend-specific observation and write
`desktop-gui-proof-report.json`. When the observation passes all proof checks,
the command also writes `desktop-gui-approval.json`. The proof-report command
does not run the GUI action; it only validates that the supplied observation is
public-safe, action-bound, and no-focus.

## OpenClaw Install And Tool Declaration Smoke

The local OpenClaw gateway is a first-class beta user. First run metadata-only
install/tool-declaration coverage from the candidate checkout:

```bash
node ./dist/packages/cli/src/index.js openclaw dogfood --profile lco-dogfood --install-source . --link --required-tool loo_doctor --required-tool loo_search_sessions --required-tool loo_describe_session --required-tool loo_expand_session --required-tool loo_expand_query --required-tool loo_codex_plans --required-tool loo_codex_final_messages --required-tool loo_codex_thread_map --required-tool loo_codex_control_dry_run --evidence-path /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/openclaw-dogfood/plugin-load.json --strict
```

Use an isolated profile such as `lco-dogfood` for linked beta proof. Reusing the
default OpenClaw profile can legitimately return an install error when the
plugin is already present, while the plugin is still loaded and ready. In that
case `loo openclaw dogfood` must record `installOutcome.status:
"already_installed"`, `installOutcome.recognizedMarker:
"openclaw_plugin_already_exists"`, public-safe `installOutcome.guidance`, and
the warning `openclaw_plugin_already_installed_but_ready`, without storing raw
OpenClaw stdout/stderr or local profile paths. The `already_installed` marker is
accepted only when the captured install output also names the target plugin id,
so an unrelated existing plugin does not clear the diagnostic gate. If OpenClaw
reports the observed text `--force is not supported with --link`, the outcome must be
`link_force_unsupported` with `installOutcome.recognizedMarker:
"openclaw_link_force_unsupported"`, and the operator should rerun from a clean
profile or remove `--force`.

This command verifies:

- plugin install/load status
- declared `loo_*` tool coverage
- structured install outcome diagnostics
- public-safe evidence only

Before the OpenClaw user path is called usable, also capture real OpenClaw
gateway tool-call evidence or record an explicit blocker. That public-safe
evidence must prove the gateway invoked `loo_doctor`, `loo_search_sessions`,
`loo_describe_session`, `loo_expand_session`, `loo_expand_query`, `loo_codex_plans`,
`loo_codex_final_messages`, `loo_codex_thread_map`, and
`loo_codex_control_dry_run`, including dry-run control audit creation without
mutating a real Codex thread.

Use the narrow gateway tool-call smoke for that proof:

```bash
node ./dist/packages/cli/src/index.js openclaw tool-smoke --profile lco-dogfood --session-key agent:main:lco-dogfood --required-tool loo_doctor --required-tool loo_search_sessions --required-tool loo_describe_session --required-tool loo_expand_session --required-tool loo_expand_query --required-tool loo_codex_plans --required-tool loo_codex_final_messages --required-tool loo_codex_thread_map --required-tool loo_codex_control_dry_run --evidence-path /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/openclaw-dogfood/tool-smoke.json --strict
```

This command calls OpenClaw Gateway `tools.catalog` and `tools.invoke`, then
stores only required-tool coverage, source-prefixed refs, counts, bounded
profile names, dry-run `approval_audit_id`, `params_hash`, `message_hash`, and
blocker codes. It must not store raw gateway stdout/stderr, raw tool output, raw
Codex transcript text, raw prompts, SQLite DBs, screenshots, tokens, or
credentials.

Do not use the OpenClaw smoke to run live Codex control, GUI mutation, npm
publish, or GitHub Release creation.

## Release Candidate Checklist

A release candidate may be announced internally when all of these are true:

- issue #6 and issue #14 have current status comments
- GitHub CI is green for the release candidate commit
- CodeQL code scanning is green for the release candidate commit
- repository ruleset, workflow, and open code-scanning alert inventory has been
  captured
- CI and CodeQL proof markers are for the exact release candidate SHA and have
  empty `warnings` arrays
- `npm run check` passed locally or in CI
- `npm pack --dry-run` passed
- release preflight, release bundle, demo status, release status, and scorecard
  sweep wrote public-safe evidence
- high-context document/workflow scan evidence covers README.md, `VISION.md`,
  release notes, claim audit, GitHub workflows, CLI release gates, docs,
  workflows, skills, and runbooks, plus the named adversarial scorecard lenses
- OpenClaw dogfood has a current pass or an explicit blocker
- README, `VISION.md`, release notes, and claim audit agree on the proof
  boundary
- no public artifact contains raw Codex JSONL, local SQLite databases, raw
  prompts, screenshots, credentials, tokens, or private transcripts

## Publication Approval Gates

Publishing is separate from proving a release candidate.

For this beta train, a public release means both the npm package surface and the
GitHub Release surface. `loo release status --strict` intentionally requires
both `operation: "npm_publish"` and `operation: "github_release"` approval
markers before it can report `releaseReady: true`. A single-surface maintenance
publication must stop and add planned-operation flags and tests before using
strict release status as the final gate.

Do not run live Codex control without explicit user approval for the exact target
thread and harmless prompt.

Do not run GUI mutation without explicit user approval for the backend, target
app/window, action, action hash, before/after focus proof, and raw-screenshot
exclusion, plus a `loo_release_operation_approval` proof marker for
`operation: "desktop_gui_mutation"`.

Do not run `npm publish` without explicit user approval and a
`loo_release_operation_approval` proof marker for `operation: "npm_publish"`.

Do not create a GitHub Release without explicit user approval and a
`loo_release_operation_approval` proof marker for
`operation: "github_release"`.

The release status command must continue to report `npmPublished: false`,
`githubReleaseCreated: false`, and `desktopGuiActionRun: false` until those
separate operations are actually approved and executed.

## npm dist-tag policy

Record `npm dist-tag ls lossless-openclaw-orchestrator` in the release evidence
after every npm publication. Until the first stable release exists, install the
public beta through the `beta` dist-tag. The `beta` tag must point at the newest
public beta. The `latest` tag currently remains `0.1.0-beta.4` and must not be
promoted during `0.1.x` beta releases unless a separate latest-promotion
operation explicitly claims and proves that change. At the first stable release,
move `latest` to the stable version and keep beta and other prereleases on
prerelease tags. Do not publish a fake stable package just to move a dist-tag.

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
- GitHub CI or CodeQL code scanning is red, pending, or missing
- GitHub CI or CodeQL evidence is for a different commit than the release
  candidate SHA
- workflow/action deprecation warnings are present, including CodeQL Action v3
  or Node 20 action runtime warnings
- the release plan omits either npm publication or GitHub Release creation
  without a prior planned-operation contract change in `loo release status`
- the release context freshness scan is missing, stale, or finds docs, workflows,
  skills, and runbooks that disagree with the current release gate
- review threads contain valid actionable defects

## Closeout

Every release-candidate or release closeout should include:

- commit SHA and tag or candidate name
- issue #6 and issue #14 status links
- commands run and exit status
- evidence path
- release context freshness scan evidence
- repository ruleset, workflow, CI, CodeQL, and code-scanning alert inventory
- OpenClaw dogfood result
- scorecard movement
- what is working
- what is not proven
- whether npm publish or GitHub Release creation happened
- exact next action
