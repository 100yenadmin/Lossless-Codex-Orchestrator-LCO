# Release Checklist

This checklist is the stable-release gate for Lossless OpenClaw Orchestrator.
It complements the beta runbook by naming the proof required before a release
can be called generally ready. GitHub issues and PRs remain implementation
truth; this file is the release proof contract.

Run the machine-readable gate:

```bash
loo release general-readiness \
  --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/general-release-readiness \
  --fresh-npm-evidence published-package-smoke.json \
  --agent-dogfood-evidence openclaw-tool-smoke.json \
  --strict
```

The command writes `general-release-readiness.json` and does not publish npm,
move `latest`, create a GitHub Release, run live Codex control, or mutate a GUI.

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
- README, VISION, release notes, claim audit, runbook, and skills truth scan
- privacy scan showing no raw transcripts, raw prompts, SQLite DBs, screenshots,
  tokens, cookies, credentials, or private customer data in public evidence
- GitHub issue/tracker updates with evidence path and proof boundary
- no open PRs or release-blocking issues for the claimed tier

## 1.0 General Release

For 1.0, the release must additionally prove:

- fresh npm stable install from the registry, not a linked repo checkout or a
  beta/RC substitute
- clean OpenClaw profile install/load with expected `loo_*` tools visible
- gateway invocation is ready, not merely `gateway_setup_required`
- if fresh-profile gateway credentials are missing, published-smoke evidence
  must classify the blocker as setup-required and show token generation,
  env-ref onboarding, gateway status, and fresh-profile tool-smoke commands
  without storing raw tokens; this remains a 1.0 blocker until tool-smoke is
  actually ready
- first-class agent skill/playbook is packaged and current
- agent dogfood completes the core workflow through gateway tools:
  doctor, search, describe, expand, plan/final/touched-file lookup, recommend,
  and dry-run
- the agent dogfood evidence says `rawTranscriptRead:false` and `dryRunLive:false`
- docs and release copy do not claim Claude parity, generic GUI mutation, cloud
  sync, unattended takeover, or enterprise/customer-ready security
- live control claims name the exact control matrix that passed

If resume, steer, or interrupt have not passed live proof on disposable threads,
the 1.0 claim must exclude broad live control and say only the proven live send
path is available.

## npm Dist-Tag Boundary

Do not move `latest` during the `0.1.x` beta train. Install stable releases
with:

```bash
npm install -g lossless-openclaw-orchestrator@latest
```

Install beta releases with:

```bash
npm install -g lossless-openclaw-orchestrator@beta
```

Move `latest` only as part of a separate stable-release issue after the
pre-publish candidate gates pass and the release-status approval markers
explicitly cover npm publication and GitHub Release creation. After publication,
run fresh npm `@latest` published-smoke and `loo release general-readiness
--strict`; the stable issue is not complete until those post-publish gates pass.

## Blocking Signals

Treat these as hard blockers:

- `fresh_npm_clean_profile_evidence_missing`
- `fresh_npm_clean_profile_<setup_recovery_classification>`, for example
  `fresh_npm_clean_profile_credential_required`
- `fresh_npm_clean_profile_not_public_safe`
- `fresh_npm_clean_profile_restricted_actions_performed`
- `agent_dogfood_evidence_missing`
- `release_checklist_missing_or_incomplete`
- `agent_skill_missing_or_incomplete`
- `m9_scenario_contracts_missing_or_incomplete`
- `docs_general_readiness_links_missing`
- any raw/private artifact in public release evidence
- any live action that can run without a matching dry-run approval id
- any release copy that claims beyond the selected claim tier
