# Lossless Codex Orchestrator

Give your main agent a memory and command layer for all your Codex projects and threads.

Codex is excellent at doing work. The hard part is managing all the work after
you have dozens or hundreds of threads across repos, customer projects, fixes,
reviews, and follow-ups.

LCO turns that scattered local Codex history into an operating layer your
OpenClaw agent, MCP client, Hermes-style orchestration agent, or custom agent
can use. Your agent can find the right project, understand what happened, see
what is blocked, prepare the next action, and keep moving without rereading huge
transcripts every time.

![Lossless Codex Orchestrator showing session cards, project memory, and agent command tools](https://raw.githubusercontent.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/main/assets/readme/hero.png)

[![npm latest](https://img.shields.io/npm/v/lossless-openclaw-orchestrator/latest?label=npm%20latest)](https://www.npmjs.com/package/lossless-openclaw-orchestrator)
[![npm beta](https://img.shields.io/npm/v/lossless-openclaw-orchestrator/beta?label=npm%20beta)](https://www.npmjs.com/package/lossless-openclaw-orchestrator)
[![CI](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/ci.yml/badge.svg)](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/ci.yml)
[![CodeQL](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/codeql.yml/badge.svg)](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/codeql.yml)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

```bash
npm install -g lossless-openclaw-orchestrator@latest
lco doctor
lco index codex --max-files 500 "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

If this helps your main agent stay on top of Codex work, a star helps other
agent builders find it. ⭐

[Setup](docs/SETUP.md) · [OpenClaw Plugin](docs/OPENCLAW_PLUGIN.md) · [Agent Skill](skills/lossless-openclaw-orchestrator/SKILL.md) · [Vision](VISION.md) · [Privacy](docs/PRIVACY.md) · [Hermes Boundary](docs/HERMES_ADAPTER_BOUNDARY.md) · [Contributing](CONTRIBUTING.md) · [AGENTS.md](AGENTS.md) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [Release Notes](docs/releases/CHANGELOG.md) · [License](LICENSE)

## Why It Exists

When you use Codex heavily, the problem stops being "can an agent code?" and
becomes "can my main agent understand all the work already in motion?"

LCO gives that main agent a local memory and command surface:

| Without LCO | With LCO |
| --- | --- |
| Threads are scattered across many sessions and projects. | Your agent can search and triage them from one local index. |
| Every handoff starts with rediscovery. | Prepared cards show the objective, blocker, status, and next action. |
| Big transcripts eat context. | Summary leaves and bounded expansion let agents read the right slice. |
| OpenClaw or another orchestrator has to guess what Codex did. | MCP/OpenClaw tools expose Codex state directly to the orchestrator. |
| "Continue this work" is risky because the target may be unclear. | Dry-run command packets show the exact thread and action before anything runs. |

The goal is simple: your orchestration agent should manage Codex work the way a
good technical operator would. It should know the projects, the active threads,
the stale work, the blocked work, the finished work, and the right next move.

## What It Does ✨

LCO is more than a transcript index. It builds an agent-readable operating
picture over local Codex work.

**Project and thread memory**

- Indexes local Codex sessions into a local SQLite database.
- Uses field-weighted FTS5 search over titles, summaries, proposed plans, final
  messages, touched files, tool metadata, and searchable body text.
- Blends relevance, recency, identifier matching, and query fallback so agents
  can find "the billing bridge plan" or "the PR that touched auth" without the
  exact thread id.
- Detects Codex JSONL format drift in `lco doctor` so broken imports are visible
  instead of silently missing work.

**Prepared state for agents**

- Creates prepared cards for Codex threads: objective, blocker, lifecycle state,
  next action, freshness, confidence, and source refs.
- Builds a prepared inbox so your main agent can start from "what needs my
  attention?" instead of raw search.
- Tracks lifecycle states such as completed, waiting for approval, watching an
  external check, needs resume, dirty worktree handoff, ready for review,
  stale/partial, and unknown.
- Keeps completed work visible, so finished lanes can still be found and cited.

**Summary leaves and bounded expansion**

- Splits large sessions into source ranges and deterministic summary leaves.
- Creates leaf refs for user prompts, plans, final messages, closeouts, touched
  files, tool metadata, and compaction markers.
- Lets an agent expand a small 1k-token brief or a deeper 4k-token evidence
  bundle instead of loading an entire transcript.
- Reports omissions when a brief is intentionally smaller than the underlying
  session.

**Operating picture tools**

- `lco_recent_sessions` shows recent or active Codex work as compact cards.
- `lco_attention_inbox` lists threads that need action, review, approval, watch,
  or blocker triage.
- `lco_project_digest` creates a project-level handoff brief from Codex cards,
  optional GitHub items, plan pins, and source coverage.
- `lco_operating_picture` powers cockpit-style views such as session maps,
  collaboration next steps, active-thread state, autonomy tick planning,
  GitHub operating items, and business pulse cards.

**Command layer for orchestrators**

- Exposes the same local registry through CLI commands, an MCP server, and an
  OpenClaw plugin.
- Gives normal agents a compact facade: prepared inbox, recent sessions, project
  digest, attention inbox, bounded expansion, describe, and Codex control dry
  run.
- Creates dry-run command packets for Codex start/resume/send/steer/interrupt
  actions so the target and action can be reviewed before live execution.
- For live Codex actions, the packet can include the exact target, action,
  message hash, and approval id your main agent should show before it moves.
- Adds hook-sidecar commands for closeout capture, state prep, compaction marker
  capture, and thread title aliases.

## Who It Is For

Use LCO if you:

- run Codex across many repos, customer projects, or product lanes
- use OpenClaw as your main local agent/operator
- want a Hermes-style or custom orchestrator to manage Codex work through MCP
- need agents to hand off work without rereading massive transcripts
- want one place to ask "what is active, blocked, stale, finished, or ready?"
- want project digests and next-action briefs your agents can actually use

If you only run one short Codex session at a time, LCO may be more system than
you need. If Codex is becoming your day-to-day engineering workforce, this is
the memory layer that helps a main agent manage it.

## Install 🚀

Requirements:

- Node.js 22.5 or newer
- npm
- local Codex session files, usually under `~/.codex/sessions`
- OpenClaw Desktop/CLI if you want OpenClaw to call the installed `lco_*` tools

Stable install:

```bash
npm install -g lossless-openclaw-orchestrator@latest
lco doctor
```

The current published npm package name is still
`lossless-openclaw-orchestrator` until the package-rename lane ships. It
installs the canonical `lco` CLI and `lco-mcp-server`. The historical `loo`,
`loo-mcp-server`, and `LOO_*` env names remain maintained compatibility aliases
for at least two minor releases.

```bash
loo index codex "$HOME/.codex/sessions"
loo-mcp-server
```

Beta train, when you explicitly want the newest prerelease:

```bash
npm install -g lossless-openclaw-orchestrator@beta
```

Package channels:

- Current stable: `1.3.5` has shipped on npm `latest`.
- `latest` is the stable public channel.
- `beta` is the active prerelease train.
- `next` is reserved for release candidates.

If npm shows a version or dist-tag but install fails with a selector cutoff
error such as `ENOVERSIONS` or `ETARGET`, use the npm selector-drift tarball
fallback with raw npm commands a fresh shell can run:

```bash
tarball_url="$(npm view lossless-openclaw-orchestrator@latest dist.tarball)"
test -n "$tarball_url" && npm install -g "$tarball_url"
```

If the `ETARGET` message says the requested package version must have a publish
date before a specific time, check for a local npm `min-release-age` or `before`
pin before treating it as registry drift.

Full setup instructions live in [docs/SETUP.md](docs/SETUP.md).

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

The importer applies a 50 MB per-file index cap so one oversized JSONL cannot
dominate a first run. Use `--max-bytes-per-file <bytes>` only when you
intentionally want to widen that local indexing window.

Optional: allow recall from one or more OpenClaw LCM peer databases:

```bash
export LCO_LCM_DB_PATHS="$HOME/.openclaw/lcm.db"
```

Check local readiness:

```bash
lco doctor
lco onboard status --strict
```

## First Workflow 🧭

Search for a Codex thread:

```bash
lco search "billing bridge proposed plan"
```

Describe a result:

```bash
lco describe codex_thread:<thread-id>
```

Expand a small brief:

```bash
lco expand-ref --profile brief --token-budget 1000 codex_thread:<thread-id>
```

Expand from a query when you do not know the ref yet:

```bash
lco expand-query --profile brief --token-budget 1000 "billing bridge"
```

For an agent or MCP client, start with the normal operator path:

| Step | Tool | What your agent gets |
| --- | --- | --- |
| 1 | `lco_prepared_inbox` | The best starting view of work that needs attention. |
| 2 | `lco_describe_ref` | Details for a selected thread, card, leaf, or source ref. |
| 3 | `lco_expand_query` | A bounded brief when the exact ref is unknown. |
| 4 | `lco_recent_sessions` | Recent and active Codex work as compact cards. |
| 5 | `lco_attention_inbox` | Blocked, waiting, stale, approval-needed, or ready-for-review work. |
| 6 | `lco_project_digest` | A project-level handoff brief. |
| 7 | `lco_codex_control_dry_run` | A preview packet for the exact Codex action. |
| 8 | `lco_codex_resume_thread` | Resume a Codex thread after the dry-run packet is approved. |

The packaged agent playbook is
[skills/lossless-openclaw-orchestrator/SKILL.md](skills/lossless-openclaw-orchestrator/SKILL.md).

Naming note: `LCO` is the public product abbreviation. New user-facing examples
use `lco`, `lco-mcp-server`, and canonical `lco_*` tools. The historical `loo`,
`loo-mcp-server`, and `loo_*` names remain maintained compatibility aliases for
at least two minor releases.

## Works With 🔌

| Surface | Status | What to use today |
| --- | --- | --- |
| Codex local sessions | Stable | `lco index codex`, `lco search`, `lco describe`, and bounded expansion. |
| MCP clients | Stable | `lco-mcp-server` exposes the local tool registry over stdio. |
| OpenClaw | Stable | Install the plugin and let your OpenClaw agent call `lco_*` tools. |
| Hermes-style and custom agents | MCP-supported, native adapter deferred | Use the MCP surface today; see [docs/HERMES_ADAPTER_BOUNDARY.md](docs/HERMES_ADAPTER_BOUNDARY.md). |

LCO is OpenClaw-first because that is where the product has been dogfooded, but
the useful layer is broader: one local Codex memory and command surface that any
agent harness can call through CLI or MCP.

## OpenClaw And MCP

Run the MCP server directly:

```bash
lco-mcp-server
```

Typical MCP client entry:

```json
{
  "mcpServers": {
    "lco": {
      "command": "lco-mcp-server"
    }
  }
}
```

Install the OpenClaw plugin from npm:

```bash
openclaw plugins install lossless-openclaw-orchestrator@latest
openclaw plugins list --json
```

Smoke the OpenClaw path:

```bash
lco openclaw dogfood --profile lco-dogfood --install-source lossless-openclaw-orchestrator@latest --required-tool lco_doctor --required-tool lco_search_sessions --strict
lco openclaw tool-smoke --profile lco-dogfood --required-tool lco_doctor --required-tool lco_search_sessions --strict
```

Tool exposure can be narrowed with `LCO_TOOL_PROFILE=facade|standard|all`.
The default is `all`, preserving the full catalog. `facade` exposes the compact
operator path (`lco_*`) plus `loo_*` compatibility aliases; `standard` adds
workflow-detail tools.
Profile filtering affects tool listing and OpenClaw declarations only.

See [docs/OPENCLAW_PLUGIN.md](docs/OPENCLAW_PLUGIN.md) for the full OpenClaw
setup path.

## Privacy And Local Data

LCO reads local Codex session files and writes a local SQLite index. It is built
so agents can work from source refs, cards, summaries, and bounded briefs
instead of opening enormous raw transcript files by default.

For details, read [docs/PRIVACY.md](docs/PRIVACY.md) and
[docs/SAFE_SUMMARIES.md](docs/SAFE_SUMMARIES.md).

## Community And Contributing

LCO is meant to be easy to try and straightforward to improve. The public
contribution path is:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md) for issue routing, validation,
   evidence, and agent-authored PR expectations.
2. Follow [docs/SETUP.md](docs/SETUP.md) for local install and first-run setup.
3. Use [AGENTS.md](AGENTS.md) when a coding agent is making or reviewing the
   change.
4. File a bug, docs bug, feature request, adapter request, protocol drift
   report, or command-control report through the GitHub issue forms.

Good first issue candidates are docs gaps, redacted fixture coverage, setup
diagnostics, issue-template improvements, and narrow CLI help fixes. Use the
adapter request form to request an adapter; describe the target app/runtime,
read/index path, command path, and sanitized evidence available to test it.

Never paste raw Codex transcripts, private SQLite databases, tokens, cookies,
connector URLs, or customer data into public issues or PRs. Use
[SECURITY.md](SECURITY.md) for private vulnerability reports and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

## Architecture

- `packages/core`: local SQLite index, field-weighted search, source refs,
  summary leaves, prepared cards, inboxes, session descriptions, and bounded
  expansion
- `packages/mcp-server`: stdio MCP server exposing `lco_*` operator tools and
  `loo_*` compatibility aliases
- `packages/openclaw-plugin`: OpenClaw plugin entry and manifest surface
- `.codex-plugin/` and `hooks/`: Codex plugin manifest, Stop hook config, and
  wrapper for local thread title aliases
- `packages/cli`: `lco` CLI for setup, indexing, recall, smoke, eval, and
  release checks, with `loo` retained as a compatibility alias
- `packages/adapters`: Codex transport, audit, redaction, desktop-readiness, and
  adapter contracts
- `skills/`: packaged agent-facing OpenClaw playbook
- `evals/`: scenario and scorecard contracts
- `docs/`: setup, privacy, source authority, adapter docs, and maintainer guides

## Roadmap

Stable today: local Codex indexing, field-weighted search, prepared cards,
prepared inboxes, summary leaves, bounded expansion, project digests,
OpenClaw/MCP tools, and the dry-run command layer.

Since 1.2.x, the 1.2 prepared-state and summary-leaves lane has remained
shipped as part of the stable product line. That work added source-ref-backed
ranges, deterministic summary leaves, prepared cards, prepared inbox items,
watcher observations, attention queue items, and hook capture so an OpenClaw or
main orchestration agent can start from compact prepared state instead of
rereading huge Codex transcripts. The historical architecture handoff remains in
[docs/sprints/brief-lco-1.2-prepared-state-summary-leaves-2026-07-03.md](docs/sprints/brief-lco-1.2-prepared-state-summary-leaves-2026-07-03.md).

The 1.4 identity work makes `lco`, `lco-mcp-server`, `lco_*`, and `LCO_*` the
canonical command and tool names, with `loo`, `loo-mcp-server`, `loo_*`, and
`LOO_*` retained as compatibility aliases for at least two minor releases. The
currently published npm package remains `lossless-openclaw-orchestrator` until
the separate package-rename lane publishes `lossless-codex-orchestrator`.

For the full product direction, read [VISION.md](VISION.md).

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
