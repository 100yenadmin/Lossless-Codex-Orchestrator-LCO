# Lossless OpenClaw Orchestrator

**LCO turns local Codex sessions into searchable, bounded, approval-aware
work objects for OpenClaw.**

![Enchanted open-claw conductor guiding bounded session cards and an abstract code beast in a dark technical workshop](assets/readme/hero.png)

[![npm latest](https://img.shields.io/npm/v/lossless-openclaw-orchestrator/latest?label=npm%20latest)](https://www.npmjs.com/package/lossless-openclaw-orchestrator)
[![npm beta](https://img.shields.io/npm/v/lossless-openclaw-orchestrator/beta?label=npm%20beta)](https://www.npmjs.com/package/lossless-openclaw-orchestrator)
[![CI](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/ci.yml/badge.svg)](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/ci.yml)
[![CodeQL](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/codeql.yml/badge.svg)](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/codeql.yml)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

Use it when an agent or user needs to answer: what sessions are active, what did
they plan, what did they finish, what files did they touch, and what is the next
safe action without rereading raw transcripts.

| What LCO gives agents | Why it matters |
| --- | --- |
| Searchable local session memory | Find plans, finals, touched files, and refs without raw transcript rereads. |
| Bounded evidence expansion | Read compact public-safe briefs before opening larger source material. |
| Approval-gated boundaries | Dry-run Codex actions and verify matching audit ids before any live control. |
| OpenClaw/MCP tools | Use the same local-first recall and approval-bounded surfaces from agent workflows. |

[Setup](docs/SETUP.md) · [Contributing](CONTRIBUTING.md) · [Agent Instructions](AGENTS.md) · [Agent Skill](skills/lossless-openclaw-orchestrator/SKILL.md) · [OpenClaw Plugin](docs/OPENCLAW_PLUGIN.md) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [Vision](VISION.md) · [Privacy](docs/PRIVACY.md) · [Claude Boundary](docs/CLAUDE_ADAPTER_BOUNDARY.md) · [Claim Audit](docs/CLAIM_AUDIT.md) · [Release Notes](docs/RELEASE_NOTES_1.2.2.md) · [1.2.1 Notes](docs/RELEASE_NOTES_1.2.1.md) · [1.2.0 Notes](docs/RELEASE_NOTES_1.2.0.md) · [1.1.4 Notes](docs/RELEASE_NOTES_1.1.4.md) · [1.0 Notes](docs/RELEASE_NOTES_1.0.0.md) · [License](LICENSE)

## Why It Matters

Codex is powerful, but long-running local work can become hard to supervise
once you have dozens or hundreds of threads. LCO gives your orchestrator agent a
safe operating picture: search first, inspect compact session cards, expand only
bounded evidence, and dry-run the next action before anything live happens.

If you are here to contribute, start with [CONTRIBUTING.md](CONTRIBUTING.md).
If you are an agent working in this repository, read [AGENTS.md](AGENTS.md)
before editing files.

## What It Does

LCO is a local-first orchestration layer for Codex-heavy work:

- indexes local Codex session stores into a local SQLite database
- searches sessions by safe summaries, plans, finals, touched files, and refs
- describes one session without exposing the whole transcript
- expands only the evidence an agent needs, with token-budgeted profiles
- exposes `loo_*` tools through MCP and the OpenClaw plugin
- creates dry-run approval packets before Codex resume/send/steer/interrupt
- reports Codex Desktop visibility and fallback readiness without GUI mutation
- validates exact action-bound Desktop collaboration proof packets without executing them
- summarizes runtime Desktop visibility coverage and next read-only proof steps
- classifies active threads as running, blocked, needs-nudge, stale, waiting,
  approval-needed, idle, or unknown from public-safe read-only signals,
  including attention coverage, non-executed read-only probe recommendations,
  and non-executed control dry-run recommendations for safe nudge handoff
- plans one deterministic read-only autonomy loop tick with `execute:false`
  tool calls so an agent can probe before dry-run handoff without mutation

The result is a staged recall loop:

1. Search broadly.
2. Describe the likely session.
3. Expand a small evidence bundle.
4. Dry-run the next action.
5. Execute only after the user approves the exact target/action.

## Install

Requirements:

- Node.js 22 or newer
- npm
- local Codex session files, usually under `~/.codex/sessions`
- OpenClaw Desktop/CLI if you want installed `loo_*` tools through OpenClaw

Stable install:

```bash
npm install -g lossless-openclaw-orchestrator@latest
loo doctor
```

Beta train, when you explicitly want the newest prerelease:

```bash
npm install -g lossless-openclaw-orchestrator@beta
```

Package channels:

- `latest` is the stable public channel.
- `beta` is the active prerelease train.
- `next` is reserved for release candidates.

Full first-run instructions live in [docs/SETUP.md](docs/SETUP.md).

## Set Up

Choose where LCO stores its local index. The default is already under
`~/.openclaw`, but setting it explicitly makes setup easier to inspect:

```bash
export LOO_DB_PATH="$HOME/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite"
```

Index local Codex sessions:

```bash
loo index codex --max-files 500 "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

Optional: allow read-only recall from one or more OpenClaw LCM peer databases:

```bash
export LOO_LCM_DB_PATHS="$HOME/.openclaw/lcm.db"
```

Check local readiness:

```bash
loo doctor
loo onboard status --strict
```

If agents will author PRs, issue comments, or closeouts in the repo, also copy
the provenance snippets from [docs/SETUP.md](docs/SETUP.md#agent-provenance-setup)
into the repo's `AGENTS.md` and `CLAUDE.md` files.

## First Workflow

Search for a session:

```bash
loo search "billing bridge proposed plan"
```

Describe a result:

```bash
loo describe codex_thread:<thread-id>
```

Expand a bounded brief:

```bash
loo expand-ref --profile brief --token-budget 1000 codex_thread:<thread-id>
```

Expand from a query when you do not know the ref yet:

```bash
loo expand-query --profile brief --token-budget 1000 "billing bridge"
```

For normal agent workflows, start with the compact public/operator facade
instead of treating every `loo_*` tool as a peer:

| Step | Tool | Purpose |
| --- | --- | --- |
| 1 | `loo_prepared_inbox` | Start from the compact prepared-state operating picture. |
| 2 | `loo_describe_ref` | Look up a specific session or source ref from the inbox. |
| 3 | `loo_expand_query` | Expand one bounded evidence brief when the ref is not known. |
| 4 | `loo_recent_sessions` | Refresh recent or active cards after reads or approved actions. |
| 5 | `loo_attention_inbox` | Review the compact attention queue before choosing a next action. |
| 6 | `loo_project_digest` | Produce a bounded provenance and handoff digest. |
| 7 | `loo_codex_control_dry_run` | Create the exact dry-run action packet and approval hashes. |
| 8 | `loo_codex_resume_thread` | Run an approved resume only after the matching audit id. |

Other declared tools remain available as `workflow_detail`, `proof_debug`, or
`internal_low_level` surfaces for setup, diagnosis, proof, and recovery. Their
existence is deliberate: normal agents should start from the facade, then drop
to the lower tiers only when the compact path returns a specific next step or
blocker.

`loo_codex_control_dry_run` returns the audit id and hashes an agent should show
before any live start/resume/send/steer/interrupt call. Live control requires
the matching `approval_audit_id`.

Live Codex control results include `proof_state` fields for
`accepted_by_transport`, `started`, `completed`, `persisted`, and
`unverified_pending`. Transport acceptance is not durable execution: when
`unverified_pending` is true, run the returned `next_proof` read-only tool call
before claiming the turn or thread completed, persisted, or is safe to build on.

The packaged agent playbook is
[skills/lossless-openclaw-orchestrator/SKILL.md](skills/lossless-openclaw-orchestrator/SKILL.md).

Naming policy: `LCO` is the public product abbreviation and `lco_*` is the
forward public alias target for new user-facing tool names. The currently
callable OpenClaw/MCP tools still use the historical `loo_*` runtime prefix, so
examples that must run today continue to show `loo_*` until #434 lands a tested
alias layer. Do not delete or silently rename the `loo_*` tools; keep them as
backward-compatible aliases when `lco_*` aliases are added.

## OpenClaw And MCP

Run the MCP server directly:

```bash
loo-mcp-server
```

Typical MCP client entry:

```json
{
  "mcpServers": {
    "lossless-openclaw-orchestrator": {
      "command": "loo-mcp-server"
    }
  }
}
```

Install the OpenClaw plugin from npm:

```bash
openclaw plugins install lossless-openclaw-orchestrator@latest
openclaw plugins list --json
```

Verify the package and OpenClaw gateway path:

```bash
loo openclaw dogfood --profile lco-dogfood --install-source lossless-openclaw-orchestrator@latest --required-tool loo_doctor --required-tool loo_search_sessions --strict
loo openclaw tool-smoke --profile lco-dogfood --required-tool loo_doctor --required-tool loo_search_sessions --strict
```

OpenClaw gateway setup may require local credential, device-pairing, token, or
scope approval steps before tool smoke can pass. LCO reports those as setup
blockers, not package failures. See [docs/SETUP.md](docs/SETUP.md) and
[docs/OPENCLAW_PLUGIN.md](docs/OPENCLAW_PLUGIN.md).

## Safety Boundaries

LCO is Codex-first and local-first.

Default behavior:

- local SQLite index
- public-safe summaries before raw expansion
- source refs instead of raw transcript paths
- bounded expansion profiles
- read-only OpenClaw LCM peer DB access
- direct Codex protocol before desktop fallback
- CUA Driver as the preferred/default desktop fallback backend when desktop
  fallback is needed; CUA is externally installed, not bundled by LCO, and
  Peekaboo remains a secondary visible fallback
- dry-run plus matching `approval_audit_id` before live Codex control,
  including new-thread creation
- explicit mutation classes: pure reads use empty `mutationClasses`, and
  LCO-owned indexing/audit/prepared-state writes use `mode: "local_cache_write"`
  with `derived_cache` instead of mutating Codex source stores, external
  systems, live control, or GUI state

Not claimed:

- full Claude Code parity
- cloud sync
- unattended desktop takeover
- permission bypass
- enterprise or customer-ready security claim
- generic GUI mutation is not supported
- Codex GUI mutation is not a stable public claim

Claude Code support is an adapter stub and redacted fixture inventory until its
storage and control paths are proven. Desktop fallback surfaces report
readiness, blockers, and proof states; they do not authorize prompt typing,
clicking, refresh/restart automation, or arbitrary app control.

Desktop fallback readiness is optional for normal read/search/describe
workflows. Operators who need fallback control should install CUA Driver
separately, verify the launch entrypoint with `cua-driver mcp --help`, then use
`loo doctor --json` or `loo desktop see cua-driver` only for LCO readiness and
blocker reporting. Treat missing CUA as a desktop-fallback readiness blocker
rather than a package install failure.

Claude adapter proof boundaries live in
[docs/CLAUDE_ADAPTER_BOUNDARY.md](docs/CLAUDE_ADAPTER_BOUNDARY.md). Public
claim details live in [docs/CLAIM_AUDIT.md](docs/CLAIM_AUDIT.md).
Privacy details live in [docs/PRIVACY.md](docs/PRIVACY.md) and
[docs/SAFE_SUMMARIES.md](docs/SAFE_SUMMARIES.md).

## Community And Contributing

LCO is meant to be easy to try and safe to improve. The public contribution
path is:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md) for issue routing, validation,
   evidence, and agent-authored PR expectations.
2. Follow [docs/SETUP.md](docs/SETUP.md) for local install and first-run setup.
3. Use [AGENTS.md](AGENTS.md) when a coding agent is making or reviewing the
   change.
4. File a bug, docs bug, feature request, adapter request, protocol drift
   report, or unsafe-control report through the GitHub issue forms.

Good first issue candidates are docs gaps, redacted fixture coverage, setup
diagnostics, issue-template improvements, and narrow CLI help fixes. Use the
adapter request form to request an adapter; describe the target app/runtime,
read/index path, control boundary, and redacted proof available to test it.

Never paste raw Codex transcripts, private SQLite databases, tokens, cookies,
connector URLs, or customer data into public issues or PRs. Use
[SECURITY.md](SECURITY.md) for private vulnerability reports and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

## Architecture

- `packages/core`: SQLite index, Codex import, safe summaries, source refs,
  extraction, search, and expansion
- `packages/mcp-server`: stdio MCP server exposing `loo_*` tools
- `packages/openclaw-plugin`: OpenClaw plugin entry and manifest surface
- `packages/cli`: `loo` CLI for setup, indexing, recall, smoke, eval, and
  release gates
- `packages/adapters`: Codex transport, audit, redaction, CUA/Peekaboo
  readiness, and adapter boundaries
- `skills/`: packaged agent-facing OpenClaw playbook
- `evals/`: scenario and scorecard contracts
- `docs/`: setup, privacy, release proof, source authority, adapter boundaries,
  and deeper operator guides

## Roadmap And Proof Status

The stable public product is Codex-first local orchestration: index, search,
describe, expand, prepared-state recall, OpenClaw/MCP tools, and
approval-gated dry-run/control boundaries.

The 1.2 prepared-state and summary-leaves lane is shipped in stable `1.2.2`.
Current launch work is the M11 GA assurance sprint, tracked in GitHub and
summarized in [VISION.md](VISION.md). Keep sprint and agent-operator details
there, in [AGENTS.md](AGENTS.md), and in the packaged
[agent skill](skills/lossless-openclaw-orchestrator/SKILL.md), not in this
public landing page. The historical 1.2 architecture handoff remains in
[docs/sprints/brief-lco-1.2-prepared-state-summary-leaves-2026-07-03.md](docs/sprints/brief-lco-1.2-prepared-state-summary-leaves-2026-07-03.md).

The shipped 1.2 layer is local, deterministic, and opt-in. It provides
source-ref-backed ranges, summary leaves, prepared cards, persisted watcher
observations, execute-false local attention queue items, and hook capture so an
OpenClaw/Eva agent can start from compact prepared state rather than rereading
huge Codex transcripts. Summary leaves are advisory
routing/evidence cards over prepared ranges; they are not authority, hidden
autonomy, GUI mutation, Claude parity, or true Codex compaction-summary capture.
When a specific Codex thread id is requested, prepared-state status reports
thread-level `targetCoverage` with opaque source refs, freshness, coverage, and
reason codes such as `source_present_not_indexed` instead of hiding a miss
behind healthy global cache counts.
The hook sidecar CLI lives under `loo hook closeout-capture`,
`loo hook state-prep`, and `loo hook compaction-capture --mode marker`; those
commands write only LCO-owned derived cache and treat transcript paths as
hash/redact-only inputs.

## Maintainer Proof

Release and readiness proof lives in the runbooks, not in the first-run setup
path:

- [Release Checklist](docs/RELEASE_CHECKLIST.md)
- [Release Runbook](docs/BETA_RELEASE_RUNBOOK.md)
- [Claim Audit](docs/CLAIM_AUDIT.md)
- [QA Demo](docs/BETA_RELEASE_DEMO.md)

For stable releases, the general release checklist requires fresh npm
clean-profile evidence, agent dogfood evidence through gateway tools, CI,
scorecards, and claim-audit proof before `latest` promotion.

Versioned proof contracts live in `evals/scorecards/v1.0` and
`evals/scenarios/v1`; runtime-required scenario contracts live in
`evals/scenarios/v1.1`.

Core proof commands:

```bash
loo scorecards sweep --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-<number>-scorecard-sweep --strict
loo eval scenarios --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-<number>-qa-lab --strict
loo release preflight --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight --strict
loo release demo-status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/demo --strict
loo release status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --npm-publish-approval-evidence npm-publish-approval.json --github-release-approval-evidence github-release-approval.json --github-ci-evidence github-ci.json --codeql-evidence codeql.json --strict
loo release general-readiness --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/general-readiness --fresh-npm-evidence published-package-smoke.json --agent-dogfood-evidence openclaw-tool-smoke.json --strict
```

## Development

```bash
npm install
npm run build
npm test
npm run check
```

The test suite uses redacted fixtures and Node's built-in test runner. Heavy
validation is expected to run in CI; local development should use focused tests
first.

For contributor workflow details, use [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Current source and current npm-published versions are source-available under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Noncommercial use is permitted
under those terms.

Commercial, internal-business, hosted-service, or product use requires a
separate commercial license from the project owner.

Email admin@electricsheephq.com for licensing information.
