# Orchestrator CCC+L

**Lossless OpenClaw Orchestrator** turns local agent sessions into searchable,
summarizable, product-management objects for OpenClaw.

3C+L is the working shorthand for **Codex + Claude Code + Lossless**. The beta is
Codex-first: Claude Code support is intentionally shipped as an adapter stub
until its storage and control paths are proven.

[Vision](VISION.md) · [Current Sprint Brief](docs/sprints/brief-lco-codex-autonomy-cockpit-sprint-2026-07-01.md) · [Source Authority](docs/SOURCE_AUTHORITY_PROFILE.md) · [Agent Skill](skills/lossless-openclaw-orchestrator/SKILL.md) · [Release Checklist](docs/RELEASE_CHECKLIST.md) · [Working App Proof Sprint](docs/WORKING_APP_PROOF_SPRINT.md) · [OpenClaw Plugin](docs/OPENCLAW_PLUGIN.md) · [Claude Adapter Boundary](docs/CLAUDE_ADAPTER_BOUNDARY.md) · [Beta Demo](docs/BETA_RELEASE_DEMO.md) · [Beta Release Runbook](docs/BETA_RELEASE_RUNBOOK.md) · [Claim Audit](docs/CLAIM_AUDIT.md) · [PolyForm Noncommercial](LICENSE)

## Why This Exists

OpenClaw should be able to manage hundreds of local agent sessions without
spending its whole context window rereading raw transcripts.

LCO gives an orchestrator agent a staged recall loop:

1. Find likely sessions cheaply.
2. Describe the session as compact metadata.
3. Expand only the few sessions that need evidence.
4. Recommend or dry-run the next action with source refs.

The product goal is not "search all the logs." The goal is to help an
orchestrator decide what matters next with the least possible token load.

## Product Spine

The core product object is a managed session.

A useful managed session should expose:

- project, status, priority, owner, blocker, and next action
- proposed-plan refs, final-message refs, and closeout refs
- touched files, tool metadata, safe summaries, and source refs
- archive, fork, resume, steer, send, or interrupt recommendations
- bounded expansion profiles such as metadata-only, brief, and evidence bundle

The current stable path indexes and recalls Codex session evidence. The next
roadmap push is to make this spine explicit enough that an OpenClaw agent can
triage, prioritize, and manage many sessions as work objects instead of
rediscovering state from text every time.

## What Works Now

| Area | Status | Notes |
| --- | --- | --- |
| Codex session indexing | Beta | Imports local Codex session JSONL/archive data into local SQLite. |
| Search / describe / expand | Beta | Supports the staged `grep -> describe -> expand_query` recall loop. |
| Plans, finals, files, tools | Beta | Extracts proposed plans, final messages, touched files, tool-call metadata, and safe summaries. |
| MCP / OpenClaw tools | Beta | Exposes `loo_*` tools for OpenClaw and other MCP clients. |
| OpenClaw LCM peer reads | Experimental | Reads peer summary DBs read-only without merging stores. |
| Codex direct controls | Beta boundary | Resume/send/steer/interrupt are approval-gated and dry-run first; installed OpenClaw gateway live proof exists only inside its explicit proof boundary. |
| Desktop fallback | Experimental | `loo_codex_desktop_fallback_status` reports CUA-first and Peekaboo-secondary readiness/blockers for Codex Desktop visibility gaps; product GUI mutation still needs an action-bound proof gate. |
| Scorecards and release proof | Beta | Public-safe scorecards and release-status commands track what is proven. |
| QA Lab scenarios | Beta | Dry-run scenario contracts under `evals/scenarios/v1` turn orchestrator workflows into public-safe eval tasks. |
| Working app runtime proof | Completed proof | M7/#156 proved the named runtime path and proof gates; generic GUI mutation, Claude parity, and enterprise/customer-ready claims remain excluded. |
| Codex autonomy cockpit | P0 beta | Recent session cards, cockpit inbox, read-only watcher/resume-request packets, approval packets, and operating-picture tools are public-safe by default. |
| Eva operating picture | P0 beta | Business pulse and attention inbox use LCO/Codex, optional structured GitHub items, explicit PLAN_STATE pins, and source-authority coverage; P1 business adapters are not configured yet. |
| Codex collaboration cockpit | 1.1 beta slice | `loo_codex_collaboration_cockpit` summarizes active lanes from recent cards, inbox urgency, watcher requests, and optional Desktop coherence/fallback evidence without live control or GUI action. |
| Codex Desktop coherence | Completed proof | `loo_codex_desktop_coherence` classifies CLI/direct/app-server evidence as `cli_visible`, `desktop_visible`, `desktop_refresh_required`, `desktop_restart_required`, or `unknown`; `loo_codex_desktop_fallback_status` routes missing visibility to CUA/Peekaboo readiness without GUI action. |
| Claude Code adapter | Fixture inventory | Supports redacted metadata-only fixtures with `claude_session:*` refs; no Claude parity, live control, GUI mutation, or cloud sync claim. |

## Current Sprint: 1.1 Desktop Collaboration Cockpit

The roadmap is now ranked by one question:

> Does this help an OpenClaw orchestrator manage hundreds of sessions with less
> context, less rereading, and safer action?

The stable 1.0.0 package is published on npm `latest` and the GitHub Release is
published. The post-GA Desktop claim-validation lane is tracked by
[#306](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/306)
and closes after the #307/#308 evidence is recorded against the stable claim.
The current product lane is
[#309](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/309):
a 1.1 Codex Desktop collaboration cockpit and autonomous thread-management
path. The completed Desktop proof dependencies are
[#307](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/307),
[#308](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/308),
and the operating loop
[#16](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/16).
The completed Codex Autonomy Cockpit and Eva Operating Picture P0 foundation is
tracked by
[#254](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/254),
[#255](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/255),
and the historical sprint brief
[docs/sprints/brief-lco-codex-autonomy-cockpit-sprint-2026-07-01.md](docs/sprints/brief-lco-codex-autonomy-cockpit-sprint-2026-07-01.md).
The current active-thread ranking child is
[#314](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/314):
`loo_recent_sessions(scope=active)` should surface current approval, running, and
waiting lanes ahead of stale low-confidence blocked residue while keeping
PLAN_STATE as explicit pins/empty coverage, not canonical current-state truth.

The core Codex recall, M9 handoff paths, P0 cockpit/Eva operating-picture paths,
stable release gates, and npm `latest` publication are working. The remaining
product gap is not another deep recall engine feature; it is agent-facing
Desktop collaboration polish. Desktop-visible classification and fallback
readiness are now completed proof: #307 separates "Codex is visible to
CLI/direct protocol/app-server" from "the same work is visibly reflected in
Codex Desktop", and #308 reports the CUA/Peekaboo fallback readiness path when
Desktop live refresh is missing, partial, refresh-required, restart-required,
or unknown. Actual Codex GUI mutation remains excluded unless a future
action-bound proof gate records the exact backend, target, action hash,
approval, and observation.

Completed P0 foundation is read-only and deterministic:

- #254 added `loo_recent_sessions`, `loo_cockpit_inbox`, read-only
  watcher/resume-request primitives, evidence-backed session cards, and
  approval packets for dry-run control context.
- #260 added read-only Codex app-server status/thread signals and
  `loo_visible_codex_map`, a public-safe join between sanitized visible Codex
  candidates and indexed session cards.
- #255 added `loo_plan_state_pins`, `loo_github_operating_items`,
  `loo_project_digest`, `loo_attention_inbox`, and `loo_business_pulse`.
- #264 added a deterministic read-only GitHub operating-item collector so
  issue/PR/check records become public-safe `github_items` before digest tools
  summarize them.
- #271 cleaned cockpit-card presentation so agent-facing titles, summaries, and
  next actions do not expose directive fragments, markdown tables, duplicated
  labels, or transcript-shaped excerpts.
- #272 added `eva-operating-picture-dogfood-v1`, an end-to-end public-safe
  workflow fixture for GitHub check fidelity, recent Codex cards, cockpit
  ranking, customer/runtime/security priority, source coverage, and P1 gaps.
- #258 added a public-safe [source authority profile](docs/SOURCE_AUTHORITY_PROFILE.md)
  so P0 tools distinguish adapter coverage from who owns each truth claim.
- `PLAN_STATE.md` is demoted to bootloader, manual pins, approval boundaries,
  stop conditions, and exception ledger. Unmarked prose is not current-state
  truth.
- P1 sources such as Notion, support-control, Company Brain, Stripe,
  dashboard/export, and model summarization remain `not_configured` until
  separate read-only adapters prove source-backed collection.

What a local OpenClaw agent can do today:

- Search and describe local Codex sessions through `loo_search_sessions` and
  `loo_describe_session`.
- Expand bounded evidence with `loo_expand_session` or `loo_expand_query`.
- Retrieve plans, finals, touched files, and session maps with the Codex detail
  tools.
- List recent sessions and operating-picture attention items with
  `loo_recent_sessions`, `loo_cockpit_inbox`,
  `loo_codex_collaboration_cockpit`, `loo_github_operating_items`,
  `loo_project_digest`, `loo_attention_inbox`, and `loo_business_pulse`.
- Represent watcher-triggered follow-up requests with `loo_watchers_list`,
  `loo_watcher_status`, `loo_watcher_dry_run`, and
  `loo_resume_request_packet`; these tools create request packets only and do
  not run live Codex control.
- Inspect Codex app-server readiness and visible-to-indexed session correlation
  with `loo_codex_app_server_status`, `loo_codex_app_server_threads`, and
  `loo_visible_codex_map`; these tools report source coverage, confidence, and
  ambiguity without raw turns, screenshots, remote-control enablement, or GUI
  mutation.
- Classify Desktop coherence with `loo_codex_desktop_coherence`; `cli_visible`
  is not treated as `desktop_visible`, and refresh/restart requirements remain
  explicit proof states.
- Inspect fallback readiness with `loo_codex_desktop_fallback_status`; it
  reports CUA-first and Peekaboo-secondary blockers, focus status, and
  screen-takeover warnings without running a GUI action. If called with a
  target but no coherence report, it returns `coherence_input_missing` plus the
  exact `loo_codex_desktop_coherence` args to run first.
- Use `loo_codex_collaboration_cockpit` after recent/inbox/coherence/fallback
  reads to give an orchestrator one active-lane summary with attention level,
  Desktop state boundary, source coverage, and action flags still pinned to
  false.
- Inspect `authorityCoverage` to see whether LCO, GitHub, or PLAN_STATE is
  authoritative, fallback-only, unavailable, or not configured for a claim.
- Dry-run Codex control actions and inspect audit ids before any live action.
- Check package, plugin, gateway, and first-run readiness through `loo_doctor`,
  `loo onboard status`, `loo openclaw dogfood`, `loo openclaw tool-smoke`, and
  `loo openclaw published-smoke`. The published-smoke `setupRecovery` block
  distinguishes clean-profile `ready` proof from credential, device-pairing,
  scope-approval, token-rotation, generic setup, and package-failure states. A
  clean-profile credential blocker is first-run setup, not a package failure:
  the report points to token generation, env-ref onboarding, gateway status, and
  fresh-profile tool-smoke commands with token placeholders only.

Completed proof:

- The [Working App Proof Sprint](docs/WORKING_APP_PROOF_SPRINT.md) and #156
  closed the M7 runtime proof lane for the named Codex-first surfaces.
- M9 closed the first-class agent skill, docs truth pass, agent dogfood,
  fresh npm clean-profile smoke, and 1.0 readiness gate.
- #298 proves a clean OpenClaw profile can install a published package and call
  `loo_doctor` plus `loo_search_sessions` through an isolated loopback token
  gateway after the protocol-4 backend caller fix. #302/#304/#305/#306 closed
  the stable release, post-publish `@latest` smoke, and general-readiness gates.
- Desktop-visible classification and fallback readiness/status are validated by
  #307/#308 for the stable 1.0 truth pass. Generic GUI mutation, Codex GUI
  mutation, prompt typing, clicking, refresh/restart automation, and unattended
  visible collaboration remain excluded stable claims.
- Claude Code remains an adapter stub and fixture inventory, not parity.

## Quick Start

Node.js 22 or newer is required.

```bash
git clone https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO.git
cd Lossless-Codex-Orchestrator-LCO
npm install
npm run build
```

Published stable package target:

```bash
npm install -g lossless-openclaw-orchestrator@latest
```

Published beta package target:

```bash
npm install -g lossless-openclaw-orchestrator@beta
```

Release-candidate package target, once `1.0.0-rc.1` is published:

```bash
npm install -g lossless-openclaw-orchestrator@next
```

### npm dist-tag policy

Stable users install through `latest`; public betas stay on `beta`; release
candidates stay on `next`. The first stable release moves `latest` to `1.0.0`
only after #302 proves the exact candidate through strict release gates. Keep
prereleases on prerelease tags such as `beta` or `next`. Do not publish a fake stable package just to move a dist-tag.

Default local database:

```bash
export LOO_DB_PATH="$HOME/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite"
```

Optional read-only OpenClaw LCM peer DBs:

```bash
export LOO_LCM_DB_PATHS="$HOME/.openclaw/lcm.db"
```

## CLI

```bash
loo onboard status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/onboarding --now 2026-07-01T00:00:00.000Z --strict
loo doctor
loo index codex --max-files 150 ~/.codex/sessions ~/.codex/archived_sessions
loo search "proposed plan billing bridge"
loo grep --lcm-db ~/.openclaw/lcm.db "billing bridge"
loo describe codex_thread:019f-example
loo expand-query --profile brief "billing bridge"
loo sanitize sessions --thread-id 019f-example --repair-plan --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-<number>-sanitizer
loo serve # then call loo_codex_desktop_coherence and loo_codex_desktop_fallback_status through MCP/OpenClaw with public-safe evidence
```

Desktop readiness checks:

```bash
loo desktop see cua-driver
loo desktop see peekaboo --snapshot --max-nodes 50
loo desktop act cua-driver "click primary" # dry-run only in this beta
```

Live desktop act requests are intentionally blocked in this beta. Through MCP or
OpenClaw, `loo_desktop_act` returns structured blockers for missing or
mismatched action-bound proof fields so an agent can continue through `loo_desktop_live_proof_harness`
and `loo_desktop_proof_report` without performing GUI mutation.

Scorecard and release proof commands:

```bash
loo scorecards sweep --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-<number>-scorecard-sweep --strict
loo eval scenarios --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-<number>-qa-lab-v1 --strict
loo eval scenarios --scenario-dir evals/scenarios/v1.1 --runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proofs --scenario-id openclaw-gateway-live-codex-v1-1 --scenario-id post-action-refresh-reasoning-v1-1 --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-<number>-qa-lab-v1.1 --strict
loo release preflight --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight
loo release status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json
loo release demo-status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/demo
loo release general-readiness --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/general-readiness --fresh-npm-evidence published-package-smoke.json --agent-dogfood-evidence openclaw-tool-smoke.json --strict
```

QA Lab dry-run scenarios live in `evals/scenarios/v1`. Runtime-required working
app proof scenarios live in `evals/scenarios/v1.1`. The current
`loo eval scenarios` command validates `v1` dry-run contracts and `v1.1`
runtime-required proof markers without performing the live actions itself.
Milestone 7 runtime scenarios stay incomplete until `--runtime-proof-dir`
contains public-safe `<scenario-id>.runtime-proof.json` markers from the later
child issues. Use repeated `--scenario-id` flags to scope the sweep to the
surfaces claimed by the release: a Codex-first working-app claim includes
`openclaw-gateway-live-codex-v1-1` and
`post-action-refresh-reasoning-v1-1`; add the desktop or local UI scenario ids
only when the release copy claims those surfaces.

For a release candidate that intentionally claims only read/search/describe/expand
plus dry-run control, name the smaller scope explicitly and do not pass
live-control proof:

```bash
loo release preflight --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight --strict
loo release bundle --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-bundle
loo release demo-status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/demo --strict
loo release status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict
```

That scope records approved live Codex control and working-app runtime proof as
excluded claims. Use the default `codex-live-control` scope when the release
claims live send/resume/steer or interrupt proof but does not yet claim the
installed gateway plus post-action refresh loop.

Use `codex-working-app-proof` only when the release candidate has both the
approved live-control proof and public-safe v1.1 runtime marker files from #158
and #159:

```bash
loo release preflight --claim-scope codex-working-app-proof --runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proof --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --strict
loo release status --claim-scope codex-working-app-proof --runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proof --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict
```

Without `openclaw-gateway-live-codex-v1-1.runtime-proof.json` and
`post-action-refresh-reasoning-v1-1.runtime-proof.json`, that scope fails closed
with `runtime_proof_missing:*` blockers.

The beta proof workflow lives in [docs/BETA_RELEASE_DEMO.md](docs/BETA_RELEASE_DEMO.md).
The release cadence and approval gates live in
[docs/BETA_RELEASE_RUNBOOK.md](docs/BETA_RELEASE_RUNBOOK.md).

## Beta Claim Boundary

Allowed public beta claim:

> Control and collaborate with local Codex sessions through OpenClaw using local
> indexing, bounded recall, and approval-gated controls.

Forbidden beta claims:

- Full Claude Code parity
- cloud sync
- unattended desktop takeover
- bypasses Codex permissions
- release-grade enterprise security

Detailed public-claim checks live in [docs/CLAIM_AUDIT.md](docs/CLAIM_AUDIT.md).

## MCP / OpenClaw Tools

Tool prefix: `loo_*`.

Read/search:

- `loo_index_sessions`
- `loo_grep`
- `loo_search_sessions`
- `loo_describe_ref`
- `loo_describe_session`
- `loo_expand_session`
- `loo_expand_query`

Codex details:

- `loo_codex_thread_map`
- `loo_codex_final_messages`
- `loo_codex_plans`
- `loo_codex_touched_files`
- `loo_codex_tool_calls`

Approval-gated controls:

- `loo_codex_control_dry_run`
- `loo_codex_resume_thread`
- `loo_codex_send_message`
- `loo_codex_steer_thread`
- `loo_codex_interrupt_thread`

Desktop fallback:

- `loo_codex_desktop_fallback_status`
- `loo_desktop_see`
- `loo_desktop_act`

Admin:

- `loo_doctor`
- `loo_lcm_peer_dbs`
- `loo_permissions`
- `loo_audit_tail`

OpenClaw setup lives in [docs/OPENCLAW_PLUGIN.md](docs/OPENCLAW_PLUGIN.md).

## Architecture

- `packages/core`: SQLite schema, Codex import, search, expansion, extraction, source refs.
- `packages/mcp-server`: stdio MCP tool server.
- `packages/openclaw-plugin`: OpenClaw plugin metadata and registration.
- `packages/cli`: `loo` CLI.
- `packages/adapters`: Codex control, CUA/Peekaboo boundary, Claude Code stub.
- `evals/scorecards/v1.0`: beta scorecards for safety, retrieval, install, claims, usability, local Mac search UI, and orchestrator leverage.
- `evals/scorecards/v1.0/working-app-runtime-proof-review.json`: Milestone 7 runtime proof scorecard.
- `evals/scenarios/v1`: QA Lab dry-run scenario contracts for session map triage, retrieval, bounded expansion, control safety, gateway dogfood, and release claims.
- `evals/scenarios/v1.1`: runtime-required working-app proof contracts for installed gateway live control, post-action refresh, desktop collaboration, and connected UI proof.
- `docs/`: install, demo, privacy, safe summaries, release proof, release runbook, and public-claim boundaries.

Direct Codex protocol is preferred for thread work. GUI automation is a fallback
for visible app collaboration only.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run check
```

The test suite uses redacted fixtures and Node's built-in test runner.

Every meaningful issue should include a failing test, fixture, smoke, or eval
scenario; minimal implementation; focused validation; public-safe evidence; and
an issue or PR status update.

## Privacy

The default index is local SQLite. The index stores safe text and metadata so
agents can search and expand bounded evidence. Raw local session files remain
the source of truth and should not be committed.

Public evidence should contain counts, refs, hashes, statuses, and redacted
metadata. It should not contain raw transcripts, raw prompts, SQLite databases,
tokens, cookies, API keys, screenshots, videos, or private customer data.

See [docs/PRIVACY.md](docs/PRIVACY.md) and [docs/SAFE_SUMMARIES.md](docs/SAFE_SUMMARIES.md).

## License

Current source is source-available under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Noncommercial use is permitted
under those terms.

Commercial, internal-business, hosted-service, or product use requires a
separate commercial license from the project owner.

Historical beta releases published under the MIT License remain available under
the terms that applied to those releases. This license transition applies
prospectively to the current source and future releases.
