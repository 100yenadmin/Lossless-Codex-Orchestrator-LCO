# Lossless Codex Orchestrator

**Codex memory + approval-gated control adapters for OpenClaw, MCP clients,
and Codex-heavy agent harnesses.**

LCO turns local Codex sessions into searchable, public-safe work objects: what
is active, what was planned, what finished, what files changed, and what the
next safe action is. It is built for agents that need memory, handoff, and
bounded control without rereading raw transcripts.

![Enchanted open-claw conductor guiding bounded session cards and an abstract code beast in a dark technical workshop](assets/readme/hero.png)

[![npm latest](https://img.shields.io/npm/v/lossless-codex-orchestrator/latest?label=npm%20latest)](https://www.npmjs.com/package/lossless-codex-orchestrator)
[![npm beta](https://img.shields.io/npm/v/lossless-codex-orchestrator/beta?label=npm%20beta)](https://www.npmjs.com/package/lossless-codex-orchestrator)
[![CI](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/ci.yml/badge.svg)](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/ci.yml)
[![CodeQL](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/codeql.yml/badge.svg)](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/codeql.yml)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

```bash
npm install -g lossless-codex-orchestrator@latest
lco doctor
```

If LCO saves you from losing a Codex thread, a star helps other agent builders
find it. ⭐

[Setup](docs/SETUP.md) · [Contributing](CONTRIBUTING.md) · [Agent Instructions](AGENTS.md) · [Agent Skill](skills/lossless-openclaw-orchestrator/SKILL.md) · [OpenClaw Plugin](docs/OPENCLAW_PLUGIN.md) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [Vision](VISION.md) · [Privacy](docs/PRIVACY.md) · [Claude Boundary](docs/CLAUDE_ADAPTER_BOUNDARY.md) · [Hermes Boundary](docs/HERMES_ADAPTER_BOUNDARY.md) · [Claim Audit](docs/CLAIM_AUDIT.md) · [QA Lab](docs/QA_LAB.md) · [Release Notes](docs/releases/CHANGELOG.md) · [Release Runbook](docs/BETA_RELEASE_RUNBOOK.md) · [License](LICENSE)

## Why Use LCO? ⭐

Codex is powerful, but long-running local work gets hard to supervise once you
have many threads, retries, plans, and handoffs. LCO gives your orchestrator a
local operating picture before it acts.

| You need to know... | LCO gives you... |
| --- | --- |
| Which Codex sessions matter? | Searchable cards over plans, finals, touched files, refs, and active state. |
| What happened without dumping private logs? | Public-safe summaries, source refs, and bounded evidence expansion. |
| What should an agent do next? | Prepared inboxes, attention queues, project digests, and dry-run packets. |
| Can this harness use it? | A CLI, MCP server, and OpenClaw plugin backed by the same local registry. |
| Can control stay bounded? | Approval hashes and `approval_audit_id` matching before live Codex control. |

The short version: LCO is local memory plus adapter plumbing for Codex. It lets
an agent search first, inspect only the evidence it needs, then dry-run the next
action before anything live happens.

## What It Does

LCO's wedge is approval-gated orchestration over bounded, public-safe recall: an
agent can operate a Codex-heavy workflow, not just remember it.

Core capabilities:

- indexes local Codex session stores into a local SQLite database
- searches sessions by safe summaries, plans, finals, touched files, and refs
- describes one session without exposing the whole transcript
- expands only the evidence an agent needs, with token-budgeted profiles
- exposes `lco_*` tools through MCP and the OpenClaw plugin
- adds one-shot Codex thread title aliases for easier name/ID recall
- detects Codex JSONL format drift per file and reports public-safe reason
  codes in `lco doctor`
- creates dry-run approval packets before Codex resume/send/steer/interrupt
- reports Codex Desktop visibility and fallback readiness without GUI mutation
- classifies active threads as running, blocked, needs-nudge, stale, waiting,
  approval-needed, idle, or unknown from public-safe read-only signals
- plans one deterministic read-only autonomy loop tick with `execute:false`
  tool calls so an agent can probe before dry-run handoff without mutation

The normal recall loop:

1. Search broadly.
2. Describe the likely session.
3. Expand a small evidence bundle.
4. Dry-run the next action.
5. Execute only after the user approves the exact target/action.

## Install 🚀

Requirements:

- Node.js 22.5 or newer
- npm
- local Codex session files, usually under `~/.codex/sessions`
- OpenClaw Desktop/CLI if you want installed `lco_*` tools through OpenClaw

Stable install:

```bash
npm install -g lossless-codex-orchestrator@latest
lco doctor
```

The `lossless-openclaw-orchestrator` package name is maintained for at least
two minor releases as a compatibility package:

```bash
npm install -g lossless-openclaw-orchestrator@latest
```

Beta train, when you explicitly want the newest prerelease:

```bash
npm install -g lossless-codex-orchestrator@beta
```

Package channels:

- `latest` is the stable public channel.
- `beta` is the active prerelease train.
- `next` is reserved for release candidates.

If npm shows a version or dist-tag but install fails with a selector cutoff
error such as `ENOVERSIONS` or `ETARGET`, use the npm selector-drift tarball fallback
with raw npm commands a fresh shell can run:

```bash
tarball_url="$(npm view lossless-codex-orchestrator@latest dist.tarball)"
test -n "$tarball_url" && npm install -g "$tarball_url"
```

That recovery path is a package-install diagnostic, not a broader product
claim. If the `ETARGET` message says the requested package version must have a
publish date before a specific time, check for a local npm
`min-release-age`/`before` pin before treating it as registry drift.

Full first-run instructions live in [docs/SETUP.md](docs/SETUP.md).

## Set Up

Choose where LCO stores its local index. The default is already under
`~/.openclaw`, but setting it explicitly makes setup easier to inspect:

```bash
export LCO_DB_PATH="$HOME/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite"
```

Index local Codex sessions:

```bash
lco index codex --max-files 500 "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

The default importer applies a 50 MB per-file index cap so one oversized JSONL
cannot dominate a first run. Use `--max-bytes-per-file <bytes>` only when you
intentionally want to widen that local indexing window.

Optional: allow read-only recall from one or more OpenClaw LCM peer databases:

```bash
export LCO_LCM_DB_PATHS="$HOME/.openclaw/lcm.db"
```

Check local readiness:

```bash
lco doctor
lco onboard status --strict
```

If agents will author PRs, issue comments, or closeouts in the repo, also copy
the provenance snippets from [docs/SETUP.md](docs/SETUP.md#agent-provenance-setup)
into the repo's `AGENTS.md` and `CLAUDE.md` files.

## First Workflow

Search for a session:

```bash
lco search "billing bridge proposed plan"
```

Describe a result:

```bash
lco describe codex_thread:<thread-id>
```

Expand a bounded brief:

```bash
lco expand-ref --profile brief --token-budget 1000 codex_thread:<thread-id>
```

Expand from a query when you do not know the ref yet:

```bash
lco expand-query --profile brief --token-budget 1000 "billing bridge"
```

For normal agent workflows, start with the compact public/operator facade
instead of treating every `lco_*` tool as a peer:

| Step | Tool | Purpose |
| --- | --- | --- |
| 1 | `lco_prepared_inbox` | Start from the compact prepared-state operating picture. |
| 2 | `lco_describe_ref` | Look up a specific session or source ref from the inbox. |
| 3 | `lco_expand_query` | Expand one bounded evidence brief when the ref is not known. |
| 4 | `lco_recent_sessions` | Refresh recent or active cards after reads or approved actions. |
| 5 | `lco_attention_inbox` | Review the compact attention queue before choosing a next action. |
| 6 | `lco_project_digest` | Produce a bounded provenance and handoff digest. |
| 7 | `lco_codex_control_dry_run` | Create the exact dry-run action packet and approval hashes. |
| 8 | `lco_codex_resume_thread` | Run an approved resume only after the matching audit id. |

Other declared tools remain available as `workflow_detail`, `proof_debug`, or
`internal_low_level` surfaces for setup, diagnosis, proof, and recovery. Normal
agents should start from the facade, then drop to lower tiers only when the
compact path returns a specific next step or blocker.

`lco_codex_control_dry_run` returns the audit id and hashes an agent should show
before any live start/resume/send/steer/interrupt call. Live control requires
the matching `approval_audit_id`.

Live Codex control results include `proof_state` fields for
`accepted_by_transport`, `started`, `completed`, `persisted`, and
`unverified_pending`. Transport acceptance is not durable execution: when
`unverified_pending` is true, run the returned `next_proof` read-only tool call
before claiming the turn or thread completed, persisted, or is safe to build on.

The packaged agent playbook is
[skills/lossless-openclaw-orchestrator/SKILL.md](skills/lossless-openclaw-orchestrator/SKILL.md).

Naming policy: `LCO` is the public product abbreviation. New user-facing
instructions use `lco`, `lco-mcp-server`, `lco_*`, and `LCO_*`. The historical
`loo`, `loo-mcp-server`, `loo_*`, and `LOO_*` family remains a maintained
compatibility surface for at least two minor releases and invokes the same
targets. Alias metadata points from `loo_*` names to their `lco_*` targets with
`metadata.aliasOf`.

## Works With 🔌

| Surface | Status | What to use today |
| --- | --- | --- |
| Codex local sessions | Shipped | `lco index codex`, `lco search`, `lco describe`, `lco expand-*`. |
| MCP clients | Shipped | `lco-mcp-server` exposes the same local-first tool registry over stdio. |
| OpenClaw | Shipped | Install the npm plugin and call `lco_*` tools through the local gateway. |
| Hermes | Supported via generic MCP; native adapter deferred | Hermes agents can mount `lco-mcp-server`; native Hermes ergonomics wait for a future proof lane. See [docs/HERMES_ADAPTER_BOUNDARY.md](docs/HERMES_ADAPTER_BOUNDARY.md). |
| Claude Code | Boundary stub | Redacted fixture inventory and adapter-boundary docs only. See [docs/CLAUDE_ADAPTER_BOUNDARY.md](docs/CLAUDE_ADAPTER_BOUNDARY.md). |

LCO is specialized for OpenClaw because that is the first major integration,
but the architecture is broader: CLI first, MCP server for generic clients,
and adapter boundaries for future harnesses.

## OpenClaw And MCP

Run the MCP server directly:

```bash
lco-mcp-server
```

Typical MCP client entry:

```json
{
  "mcpServers": {
    "lossless-openclaw-orchestrator": {
      "command": "lco-mcp-server"
    }
  }
}
```

Install the OpenClaw plugin from npm:

```bash
openclaw plugins install lossless-codex-orchestrator@latest
openclaw plugins list --json
```

Verify the package and OpenClaw gateway path:

```bash
lco openclaw dogfood --profile lco-dogfood --install-source lossless-codex-orchestrator@latest --required-tool lco_doctor --required-tool lco_search_sessions --strict
lco openclaw tool-smoke --profile lco-dogfood --required-tool lco_doctor --required-tool lco_search_sessions --strict
```

Tool exposure can be narrowed with `LCO_TOOL_PROFILE=facade|standard|all`.
The default is `all`, preserving the full catalog. `facade` exposes the compact
operator path plus its `lco_*` aliases; `standard` adds workflow-detail tools.
Profile filtering affects tool listing and OpenClaw declarations only.

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
`lco doctor --json` or `lco desktop see cua-driver` only for LCO readiness and
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
- `packages/mcp-server`: stdio MCP server exposing `lco_*` tools
- `packages/openclaw-plugin`: OpenClaw plugin entry and manifest surface
- `.codex-plugin/` and `hooks/`: Codex plugin manifest, Stop hook config, and
  wrapper for local thread title aliases
- `packages/cli`: `lco` CLI for setup, indexing, recall, smoke, eval, and
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

Current stable: `1.3.5` has shipped with the 1.3 retrieval, indexing, doctor,
setup, day-one UX hardening, bounded direct CLI recall smoke, published-package
smoke PATH-shadow hardening, first-run Node/MCP startup hardening, and gateway
live-send proof validation hardening while keeping the public claim boundary
unchanged.

Since 1.2.x, the 1.2 prepared-state and summary-leaves lane has remained
shipped as part of the stable product line. Current launch-hardening proof is
summarized in [VISION.md](VISION.md) and [docs/QA_LAB.md](docs/QA_LAB.md).
Keep sprint and agent-operator details there, in [AGENTS.md](AGENTS.md), and in
the packaged [agent skill](skills/lossless-openclaw-orchestrator/SKILL.md), not
in this public landing page. The historical 1.2 architecture handoff remains in
[docs/sprints/brief-lco-1.2-prepared-state-summary-leaves-2026-07-03.md](docs/sprints/brief-lco-1.2-prepared-state-summary-leaves-2026-07-03.md).

Since 1.2.x, the shipped 1.2 layer has been local, deterministic, and opt-in.
It provides source-ref-backed ranges, summary leaves, prepared cards, persisted
watcher observations, execute-false local attention queue items, and hook
capture so an OpenClaw/Eva agent can start from compact prepared state rather
than rereading huge Codex transcripts. Summary leaves are advisory
routing/evidence cards over prepared ranges; they are not authority, hidden
autonomy, GUI mutation, Claude parity, or true Codex compaction-summary capture.

When a specific Codex thread id is requested, prepared-state status reports
thread-level `targetCoverage` with opaque source refs, freshness, coverage, and
reason codes such as `source_present_not_indexed` instead of hiding a miss
behind healthy global cache counts. The hook sidecar CLI lives under
`lco hook closeout-capture`, `lco hook state-prep`,
`lco hook compaction-capture --mode marker`, and
`lco hook thread-title-finalize`; those commands write only LCO-owned derived
cache and treat transcript paths as hash/redact-only inputs.

The 1.4 identity-release tracker is #616. It covers future `lco`-first naming,
the new `lossless-codex-orchestrator` package, and adapter-tier docs. Those are
not current install instructions for this stable README.

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
lco scorecards sweep --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-<number>-scorecard-sweep --strict
lco eval scenarios --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-<number>-qa-lab --strict
lco release preflight --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-preflight --strict
lco release demo-status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/demo --strict
lco release status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --npm-publish-approval-evidence npm-publish-approval.json --github-release-approval-evidence github-release-approval.json --github-ci-evidence github-ci.json --codeql-evidence codeql.json --strict
lco release general-readiness --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/general-readiness --fresh-npm-evidence published-package-smoke.json --agent-dogfood-evidence openclaw-tool-smoke.json --strict
lco release ga-smoke --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-ga-smoke --package-version <version> --candidate-sha <release-candidate-sha> --strict
```

Compatibility aliases such as `loo release general-readiness` remain available
for existing automation for at least two minor releases; new docs and evidence
packets should use the `lco` spelling.

Existing automation can also keep using these maintained aliases during the
compatibility window:

```bash
loo index codex "$HOME/.codex/sessions"
loo-mcp-server
loo release preflight
loo release demo-status
loo release status
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
