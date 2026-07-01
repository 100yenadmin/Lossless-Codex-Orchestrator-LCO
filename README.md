# Orchestrator CCC+L

**Lossless OpenClaw Orchestrator** turns local agent sessions into searchable,
summarizable, product-management objects for OpenClaw.

3C+L is the working shorthand for **Codex + Claude Code + Lossless**. The beta is
Codex-first: Claude Code support is intentionally shipped as an adapter stub
until its storage and control paths are proven.

[Vision](VISION.md) · [Current Sprint Brief](docs/sprints/brief-lco-codex-autonomy-cockpit-sprint-2026-07-01.md) · [Agent Skill](skills/lossless-openclaw-orchestrator/SKILL.md) · [Release Checklist](docs/RELEASE_CHECKLIST.md) · [Working App Proof Sprint](docs/WORKING_APP_PROOF_SPRINT.md) · [OpenClaw Plugin](docs/OPENCLAW_PLUGIN.md) · [Claude Adapter Boundary](docs/CLAUDE_ADAPTER_BOUNDARY.md) · [Beta Demo](docs/BETA_RELEASE_DEMO.md) · [Beta Release Runbook](docs/BETA_RELEASE_RUNBOOK.md) · [Claim Audit](docs/CLAIM_AUDIT.md) · [PolyForm Noncommercial](LICENSE)

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

The current beta already indexes and recalls Codex session evidence. The next
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
| Desktop fallback | Experimental | CUA Driver and Peekaboo have backend-specific scratch no-focus proof; product GUI mutation still needs an action-bound proof gate. |
| Scorecards and release proof | Beta | Public-safe scorecards and release-status commands track what is proven. |
| QA Lab scenarios | Beta | Dry-run scenario contracts under `evals/scenarios/v1` turn orchestrator workflows into public-safe eval tasks. |
| Working app runtime proof | Completed proof | M7/#156 proved the named runtime path and proof gates; generic GUI mutation, Claude parity, and 1.0 readiness remain excluded. |
| Codex autonomy cockpit | P0 beta | Recent session cards, cockpit inbox, approval packets, and operating-picture tools are read-only and public-safe by default. |
| Eva operating picture | P0 beta | Business pulse and attention inbox use LCO/Codex, optional structured GitHub items, and explicit PLAN_STATE pins; P1 business adapters are not configured yet. |
| Claude Code adapter | Fixture inventory | Supports redacted metadata-only fixtures with `claude_session:*` refs; no Claude parity, live control, GUI mutation, or cloud sync claim. |

## Current Sprint: Codex Autonomy Cockpit + Eva Operating Picture

The roadmap is now ranked by one question:

> Does this help an OpenClaw orchestrator manage hundreds of sessions with less
> context, less rereading, and safer action?

The current sprint is tracked by
[#254](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/254),
[#255](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/255),
and first child
[#256](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/256).
The sprint brief is
[docs/sprints/brief-lco-codex-autonomy-cockpit-sprint-2026-07-01.md](docs/sprints/brief-lco-codex-autonomy-cockpit-sprint-2026-07-01.md).

The core Codex recall and M9 handoff paths are working; the current gap is
operating autonomy. Eva should be able to answer which Codex, project, and
business lanes need attention from compact cited cards without rereading raw
transcripts.

P0 is read-only and deterministic:

- #254 adds `loo_recent_sessions`, `loo_cockpit_inbox`, evidence-backed session
  cards, and approval packets for dry-run control context.
- #255 adds `loo_plan_state_pins`, `loo_project_digest`,
  `loo_attention_inbox`, and `loo_business_pulse`.
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
  `loo_recent_sessions`, `loo_cockpit_inbox`, `loo_project_digest`,
  `loo_attention_inbox`, and `loo_business_pulse`.
- Dry-run Codex control actions and inspect audit ids before any live action.
- Check package, plugin, gateway, and first-run readiness through `loo_doctor`,
  `loo onboard status`, `loo openclaw dogfood`, `loo openclaw tool-smoke`, and
  `loo openclaw published-smoke`.

Completed proof:

- The [Working App Proof Sprint](docs/WORKING_APP_PROOF_SPRINT.md) and #156
  closed the M7 runtime proof lane for the named Codex-first surfaces.
- M9 closed the first-class agent skill, docs truth pass, agent dogfood,
  fresh npm clean-profile smoke, and 1.0 readiness gate.
- Desktop fallback remains action-bound; generic GUI mutation and Codex GUI
  mutation are not public beta claims.
- Claude Code remains an adapter stub and fixture inventory, not parity.

## Quick Start

Node.js 22 or newer is required.

```bash
git clone https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO.git
cd Lossless-Codex-Orchestrator-LCO
npm install
npm run build
```

Published beta package target:

```bash
npm install -g lossless-openclaw-orchestrator@beta
```

### npm dist-tag policy

Until the first stable release exists, install the public beta through the
`beta` dist-tag. The `beta` tag must point at the newest public beta. The
`latest` tag currently remains `0.1.0-beta.4` and must not be promoted during
`0.1.x` beta releases unless a separate latest-promotion operation explicitly
claims and proves that change. At the first stable release, move `latest` to the
stable version and keep prereleases on prerelease tags such as `beta`. Do not publish a fake stable package just to move a dist-tag.

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
loo serve
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
