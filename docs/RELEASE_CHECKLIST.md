# Release Checklist

This checklist is the stable-release gate for Lossless Codex Orchestrator.
It complements the beta runbook by naming the proof required before a release
can be called generally ready. GitHub issues and PRs remain implementation
truth; this file is the release proof contract.

Run the machine-readable gate:

```bash
lco release general-readiness \
  --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/general-release-readiness \
  --fresh-npm-evidence published-package-smoke.json \
  --agent-dogfood-evidence openclaw-tool-smoke.json \
  --strict

lco release ga-smoke \
  --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-ga-smoke \
  --package-version <version> \
  --candidate-sha <release-candidate-sha> \
  --strict
```

These commands write public-safe readiness packets. `ga-smoke` aggregates the
separate release-status, finalization, published-smoke, dogfood, tool-smoke,
scenario, scorecard, preflight, bundle, and privacy reports into one blocker
taxonomy. They do not publish npm, move `latest`, create a GitHub Release, run
live Codex control, or mutate a GUI.
The maintained compatibility alias `loo release general-readiness` invokes the
same gate for existing release automation; new release instructions should use
`lco release general-readiness`.

When generating multiple gate reports for a candidate, create the dated evidence
root first, `cd` into it, and pass a relative --evidence-dir value from inside
the evidence root. Use synthetic corpus or committed retrieval-goldens data for
demo commands; live-store content can never be public evidence.

## Claim Tiers

Use the narrowest claim tier that the evidence proves:

| Tier | Allowed claim | Required proof |
| --- | --- | --- |
| `beta-read-recall` | Codex read/search/describe/expand | index/search/describe/expand smoke, safe summaries, privacy scan |
| `beta-agent-gateway` | OpenClaw agent can use Codex recall tools | installed gateway dogfood, agent skill, bounded expansion, dry-run control |
| `beta-live-send` | one approved live Codex send is proven | matching dry-run approval id, live send marker, audit tail, post-action refresh |
| `rc-control-matrix` | live control action matrix is proven | send, resume, steer, and interrupt each pass on disposable threads |
| `1.0` | Codex-first local orchestration is generally ready | every release checks plus fresh npm, agent dogfood, docs truth, scorecards, CI, and privacy gates |

Do not imply a higher tier from lower-tier proof. In particular, one approved
live send does not prove resume, steer, or interrupt. Claude Code parity,
generic GUI mutation, cloud sync, unattended takeover, and enterprise/customer
security are excluded until separate issues prove them.

## Every Release

Every beta, RC, and stable release must have public-safe evidence for:

- exact candidate commit SHA
- GitHub CI and CodeQL success for that SHA
- `npm run check`
- `npm pack --dry-run`
- release preflight, bundle, demo-status, release-status, and scorecard sweep
- `lco openclaw published-smoke --strict` with a public-safe
  `--binary-probe-report` that proves the candidate package binary rather than
  a shadowed global `lco`/`loo` command
- post-publish `lco release finalization-status --strict` evidence showing npm
  package/dist-tag, git tag, and GitHub Release all match the candidate SHA
- `lco release ga-smoke --strict` evidence aggregating the individual release
  reports into one public-safe P0-P3 blocker taxonomy
- README, VISION, public release notes, changelog, claim audit, runbook, and
  skills truth scan
- privacy scan showing no raw transcripts, raw prompts, SQLite DBs, screenshots,
  tokens, cookies, credentials, or private customer data in public evidence
- GitHub issue/tracker updates with evidence path, release scope, and next
  action
- no open PRs or release-blocking issues for the claimed tier

Public release notes and changelog entries are customer/developer-facing. They
should summarize highlights, changes, upgrade steps, validation, and links; do
not add `Proof Boundary`, `Current Claim Scope`, `Explicit Non-Claims`, or
`Do not claim` sections there. Keep capability boundaries, exclusions, and
release-gate doctrine in this checklist, `docs/CLAIM_AUDIT.md`, QA Lab
evidence, and tracker comments.

Before a release leans on control-plane or agent-to-agent driving language,
review the control-plane threat model in the operator-facing
[Control Plane Threat Model](CONTROL_PLANE_THREAT_MODEL.md)
(`docs/CONTROL_PLANE_THREAT_MODEL.md`) and confirm any token, approval-audit,
cache, scratch-session, or rollback concerns are represented in the release
issue and QA evidence rather than in public release notes.

If a publish, dist-tag, dual-name package, Git tag, or GitHub Release correction
is needed, use the operator-facing
[Release Rollback Runbook](RELEASE_ROLLBACK.md)
(`docs/RELEASE_ROLLBACK.md`). Keep rollback commands and recovery doctrine in
that runbook and the release tracker, not in public release notes.

## Stable General Release

For a stable/general release, the release must additionally prove:

- fresh npm stable install from the registry, not a linked repo checkout or a
  beta/RC substitute
- clean OpenClaw profile install/load with expected `lco_*` tools visible
- gateway invocation is ready, not merely `gateway_setup_required`
- if fresh-profile gateway credentials are missing, published-smoke evidence
  must classify the blocker as setup-required and show token generation,
  env-ref onboarding, gateway status, and fresh-profile tool-smoke commands
  without storing raw tokens; this remains a stable-readiness blocker until
  clean-profile tool-smoke is actually ready
- first-class agent skill/playbook is packaged and current
- agent dogfood completes the core workflow through gateway tools:
  doctor, search, describe, expand, plan/final/touched-file lookup, recommend,
  and dry-run
- the agent dogfood evidence says `rawTranscriptRead:false` and `dryRunLive:false`
- docs and release copy do not claim Claude parity, generic GUI mutation, cloud
  sync, unattended takeover, or enterprise/customer-ready security
- live control claims name the exact control matrix that passed

If resume, steer, or interrupt have not passed live proof on disposable threads,
the stable/general release claim must exclude broad live control and say only the
proven live send path is available.

## npm Dist-Tag Boundary

Do not move `latest` during prerelease or pre-stable lanes. Install stable releases
with:

```bash
npm install -g lossless-codex-orchestrator@latest
```

Install beta releases with:

```bash
npm install -g lossless-codex-orchestrator@beta
```

The current published package name is `lossless-codex-orchestrator`. The
deprecated compat package `lossless-openclaw-orchestrator` remains maintained
for existing automation. Every stable feature release publishes and verifies
the same version under both names; release proof uses the canonical package as
the primary surface and independently clean-installs the compatibility package.
The `lco` CLI and `lco-mcp-server` remain the canonical command surface.

Move `latest` only as part of a separate stable-release issue after the
pre-publish candidate gates pass and the release-status approval markers
explicitly cover npm publication and GitHub Release creation. After publication,
run `lco release finalization-status --expected-dist-tag latest
--expected-github-prerelease false --strict`, fresh npm `@latest`
published-smoke, `lco release general-readiness --strict`, and
`lco release ga-smoke --strict`; the stable issue is not complete until those
post-publish gates pass.

## Blocking Signals

Treat these as hard blockers:

- `fresh_npm_clean_profile_evidence_missing`
- `fresh_npm_clean_profile_<setup_recovery_classification>`, for example
  `fresh_npm_clean_profile_credential_required`
- `fresh_npm_clean_profile_not_public_safe`
- `fresh_npm_clean_profile_restricted_actions_performed`
- `agent_dogfood_evidence_missing`
- `release_checklist_missing_or_incomplete`
- `npm_publish_evidence_missing`
- `git_tag_evidence_missing`
- `github_release_evidence_missing`
- `npm_dist_tag_version_mismatch`
- `git_tag_sha_mismatch`
- `github_release_prerelease_mismatch`
- `agent_skill_missing_or_incomplete`
- `m9_scenario_contracts_missing_or_incomplete`
- `docs_general_readiness_links_missing`
- any raw/private artifact in public release evidence
- any live action that can run without a matching dry-run approval id
- any release copy that claims beyond the selected claim tier
