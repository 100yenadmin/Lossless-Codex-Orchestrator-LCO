# Setup Guide

This guide takes a new user from package install to a working local Codex recall
loop, then through MCP/OpenClaw setup.

LCO is local-first. It indexes local Codex session metadata and safe text into a
local SQLite database so an agent can search, describe, and expand bounded
evidence without reading raw transcripts by default.
It does not read raw transcripts by default during normal search/describe
workflows.

## 1. Requirements

- Node.js 22.5 or newer
- npm
- Codex CLI or Codex Desktop with local session files
- OpenClaw Desktop/CLI when you want the installed OpenClaw plugin or gateway
  smoke path
- macOS permissions only when you intentionally inspect desktop fallback
  readiness through CUA Driver or Peekaboo

Common local Codex roots:

- `~/.codex/sessions`
- `~/.codex/archived_sessions`

## 2. Install LCO

Install the stable public package:

```bash
npm install -g lossless-codex-orchestrator@latest
lco doctor
```

`lossless-codex-orchestrator` is the current published npm package name. The
deprecated compat package `lossless-openclaw-orchestrator` remains maintained
for existing automation and points at the same canonical `lco` CLI and
`lco-mcp-server`.

The historical `loo`, `loo-mcp-server`, and `LOO_*` names remain maintained
compatibility aliases for at least two minor releases.

Install the beta train only when you explicitly want prerelease behavior:

```bash
npm install -g lossless-codex-orchestrator@beta
```

Fresh walkthrough proof for maintainers or release PRs should use an isolated npm prefix
and a fresh LCO_DB_PATH so the result does not depend on the maintainer's
global install or existing local database:

```bash
walkthrough_root="$(mktemp -d /tmp/lco-setup.XXXXXX)"
export NPM_CONFIG_PREFIX="$walkthrough_root/npm-prefix"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
export LCO_DB_PATH="$walkthrough_root/orchestrator.sqlite"
npm install -g lossless-codex-orchestrator@latest
lco doctor --json
```

Before a candidate version is published, a release PR may use the local repo build
as the registry package substitute and must say so in the PR body:

```bash
npm run build
npm install -g "$PWD"
lco doctor --json
```

On a never-indexed database, `lco doctor --json` can report the first-run
classification `not_indexed_yet`. That is the expected prompt to run the index
step below, not a broken install. If the `codexJsonlDrift` block appears after
indexing, treat it as a bounded completeness caveat for the flagged files.

If npm metadata shows the package but `npm install` fails with selector drift
such as `ENOVERSIONS` or `ETARGET`, use the npm selector-drift tarball fallback
with raw commands:

```bash
tarball_url="$(npm view lossless-codex-orchestrator@latest dist.tarball)"
test -n "$tarball_url" && npm install -g "$tarball_url"
```

Update later:

```bash
npm update -g lossless-codex-orchestrator
```

Uninstall:

```bash
npm uninstall -g lossless-codex-orchestrator
```

Uninstalling the package does not delete your local LCO database.

## 3. Choose Local Storage

Default database:

```bash
$HOME/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite
```

Set it explicitly if you want repeatable shell sessions:

```bash
export LCO_DB_PATH="$HOME/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite"
```

Optional read-only OpenClaw LCM peer database paths:

```bash
export LCO_LCM_DB_PATHS="$HOME/.openclaw/lcm.db"
```

LCM peer DBs are opened read-only. LCO does not merge raw Codex transcripts or
peer rows into OpenClaw LCM or the LCO source index. Running `lco index codex`
or `lco find` with peers configured refreshes public-safe advisory prepared
cards and inbox items from their summary DAGs. Run `lco doctor --peers` to see
ready, degraded, or unavailable classifications plus bounded integrity reasons
for missing optional tables, empty summaries, stale DAG links, and degraded
expansion.

Session diff uses signed opaque cursors. If your profile has not yet created a
local audit key through an approved dry-run control workflow, provide a stable
local secret to the CLI, MCP server, or OpenClaw gateway as
`LCO_SESSION_DIFF_CURSOR_KEY`. Use at least 16 characters, keep the value in
your normal local secret store, and reuse the same value so cursors remain valid
across process restarts. Do not commit it to an MCP configuration or repository.
Reports expose only the safe key source (`environment`, `audit_fallback`, or
`explicit`), never the key or audit path. If you rely on `audit_fallback`, keep
the same audit profile/path; changing it intentionally invalidates earlier
cursors. Prefer the environment-backed secret when cursors must survive profile
or audit-path changes.

## 4. Index Local Codex Sessions

Run a bounded first import:

```bash
lco index codex --max-files 500 "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

The default importer applies a 256 MB / 200,000-event per-file index cap. If a
plain index run reports `codex_index_limited_files_skipped`, re-run with
intentional local-only overrides:

```bash
lco index codex --max-files 100000 --max-bytes-per-file 1073741824 --max-events-per-file 1000000 "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

Files beyond those ceilings remain a future streaming-importer lane; LCO reports
them instead of silently treating the index as complete.

### Event-Content Cache Control

LCO stores a local derived event-content cache to make content recall faster and
more precise. It does not change Codex source files. To disable new event-content
writes while keeping session metadata, prepared ranges, plans, finals, touched
files, and normal indexing intact:

```bash
export LCO_EVENT_CONTENT=disabled
lco index codex "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

To drop the existing derived event-content cache and FTS rows:

```bash
lco maintenance --drop-event-content
```

To rebuild it, unset the opt-out and index again:

```bash
unset LCO_EVENT_CONTENT
lco index codex "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

For a smaller smoke:

```bash
lco index codex --max-files 50 "$HOME/.codex/sessions"
```

Then check readiness:

```bash
lco doctor
```

The index stores metadata, source refs, extraction fields, and prepared safe
text for session-card search. Raw transcripts remain in the local Codex store.
If you want one command that indexes and searches on first use, start with
`lco find`.

## 5. Run The First Recall Loop

Find a thread or remembered content phrase:

```bash
lco find "proposed plan billing bridge"
```

Use JSON for scripts or agent harnesses:

```bash
lco find --json "proposed plan billing bridge"
```

Use lower-level recall commands when you want a specific surface:

```bash
lco search "proposed plan billing bridge"
lco grep "aurora ledger checkpoint"
lco expand-query "aurora ledger checkpoint"
```

Describe a result:

```bash
lco describe codex_thread:<thread-id>
```

Expand a brief:

```bash
lco expand-ref --profile brief --token-budget 1000 codex_thread:<thread-id>
```

Expand by query:

```bash
lco expand-query --profile brief --token-budget 1000 "billing bridge"
```

Look up detail fields through MCP/OpenClaw tools when available:

- `lco_codex_extract` with `kind: "plans"`
- `lco_codex_extract` with `kind: "final_messages"`
- `lco_codex_extract` with `kind: "touched_files"`
- `lco_codex_extract` with `kind: "tool_calls"`

### Prepare a bounded review-then-drive packet

`lco drive` connects a reviewer choice to a target adapter without taking a
live action. This Codex-target example creates a public-safe plan and audited
dry-run packet:

```bash
lco drive \
  --reviewer claude \
  --driver codex \
  --target-ref codex_thread:<thread-id> \
  --objective "Review the selected session and prepare the next bounded action" \
  --surface cli \
  --max-turns 4 \
  --token-budget 1000 \
  --timeout-ms 120000 \
  --cost-ceiling-usd 1 \
  --dry-run
```

The report hashes the objective, records the target and budgets, and returns
the adapter's dry-run audit id and parameter hashes. It does not run the named
reviewer, execute live Codex or Claude control, mutate a GUI, or authorize the
later action. Claude is available as a dry-run target adapter only; Claude live
parity is not a 1.6 claim.

## 6. Enable Codex Thread Title Aliases

The published LCO package includes a small Codex plugin bundle for one purpose:
the Stop hook thread-title finalizer. It is not a general tool surface and does
not add agent-callable tools. The bundle consists of `.codex-plugin/plugin.json`
plus `hooks/hooks.json`; plugin-aware Codex hosts install the package root as the
plugin root, set `CLAUDE_PLUGIN_ROOT`, and run the hook command from
`hooks/hooks.json`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/.codex-plugin/scripts/thread-title-finalize.mjs"
```

After assistant turns, the wrapper runs `lco hook thread-title-finalize` against
the hook payload. The hook writes one public-safe local title alias per thread,
such as:

```text
lossless-openclaw-orchestrator: Codex thread title finalizer
```

That alias is indexed in `codex_thread_title_aliases`, so LCO search can find
the thread by generated name or by `codex_thread:<thread-id>` without reading
raw transcripts.

Manual smoke:

```bash
printf '%s\n' '{"thread_id":"019f-example","cwd":"'$PWD'","task_summary":"Codex thread title finalizer"}' \
  | lco hook thread-title-finalize --payload-stdin --strict
lco search "Codex thread title finalizer"
```

Safety boundary: this hook preserves the canonical Codex title, hashes/redacts
transcript paths, never opens transcript paths, and writes only LCO-owned
derived cache. It does not mutate the Codex GUI or add an agent-facing naming
tool.

## 7. Connect MCP

LCO works from any MCP-capable agent without OpenClaw. Index first from the CLI:

```bash
lco index codex "$HOME/.codex/sessions"
```

Then add the stdio MCP server to each client that should read the local LCO
store.

Start the MCP server directly:

```bash
lco-mcp-server
```

Equivalent CLI entry:

```bash
lco serve
```

### Claude Code (`.mcp.json`)

```json
{
  "mcpServers": {
    "lco": {
      "command": "lco-mcp-server",
      "env": {
        "LCO_DB_PATH": "~/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite",
        "LCO_TOOL_PROFILE": "facade"
      }
    }
  }
}
```

If your Claude Code setup already uses `codex-plugin-cc`, install LCO as a
separate local recall companion:

```text
/plugin marketplace add 100yenadmin/Lossless-Codex-Orchestrator-LCO
/plugin install lco-recall@lco
```

Use the user-invocable `find` skill for public-safe local recall. If a running
Claude Code session does not show the skill immediately, reload plugins or start
a fresh session after installation.

### Cursor

Add the same server entry to Cursor's MCP configuration:

```json
{
  "mcpServers": {
    "lco": {
      "command": "lco-mcp-server",
      "env": {
        "LCO_DB_PATH": "~/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite",
        "LCO_TOOL_PROFILE": "facade"
      }
    }
  }
}
```

### Generic MCP client

Use stdio transport and launch `lco-mcp-server`:

```json
{
  "transport": "stdio",
  "command": "lco-mcp-server",
  "env": {
    "LCO_DB_PATH": "~/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite",
    "LCO_TOOL_PROFILE": "facade"
  }
}
```

The MCP server exposes the same `lco_*` surface used by OpenClaw.

Optional tool exposure profiles:

```bash
export LCO_TOOL_PROFILE=facade  # facade, standard, or all
```

`all` is the default and preserves the full catalog. `facade` lists the compact
operator path; `standard` adds workflow-detail tools. `LCO_TOOL_PROFILE=facade`
is the right default for general agents, while `standard` and `all` are for
expert workflows.

### Multi-client Mounting

Multiple clients can mount the same local store with a shared `LCO_DB_PATH`; it
is one local recall DB. Use separate stores per client by giving each client its
own `LCO_DB_PATH`. Shared-store behavior works, and per-client isolation is test-proven.

Compatibility aliases remain available for at least two minor releases:
`loo-mcp-server` launches the same server, and `LOO_DB_PATH`,
`LOO_LCM_DB_PATHS`, and `LOO_TOOL_PROFILE` remain accepted fallbacks for the
canonical `LCO_*` env names.

## 8. Install In OpenClaw

Install the plugin from npm:

```bash
openclaw plugins install lossless-codex-orchestrator@latest
openclaw plugins list --json
```

Run a public-safe plugin readiness check:

```bash
lco openclaw dogfood --profile lco-dogfood --install-source lossless-codex-orchestrator@latest --required-tool lco_doctor --required-tool lco_search_sessions --strict
```

Run a tool smoke through OpenClaw Gateway:

```bash
lco openclaw tool-smoke --profile lco-dogfood --required-tool lco_doctor --required-tool lco_search_sessions --strict
```

For approval-gated steer or interrupt across separate gateway invocations, run
one persistent Codex app-server on a loopback WebSocket and point the OpenClaw
profile at it:

First verify that the pinned Codex CLI version for your runtime exposes the
experimental `app-server --listen` option. After that version check, start the
listener with:

```bash
codex app-server --listen ws://127.0.0.1:45555
openclaw --profile lco-dogfood config set env.LCO_CODEX_APP_SERVER_URL '"ws://127.0.0.1:45555"' --strict-json
openclaw --profile lco-dogfood gateway restart
```

LCO accepts only unauthenticated `ws://` loopback URLs with an explicit port and
no credentials, path, query, or fragment. Leave `LCO_CODEX_APP_SERVER_URL`
unset for the default one-shot stdio client. The shared loopback server is
needed when one process owns an active turn and a later OpenClaw invocation must
steer or interrupt that exact turn. Codex currently marks the app-server
WebSocket listener experimental, so this is an explicit operator opt-in; pin and
re-verify the Codex CLI version before relying on it in a release or runtime lane.

After a published install, combine the package, dogfood, and tool-smoke reports
into one first-run classifier:

```bash
lco openclaw published-smoke --evidence-dir /tmp/lco-published-smoke --dogfood-report plugin-load.json --tool-smoke-report tool-smoke.json --binary-probe-report binary-probe.json --strict
```

Strict package-path readiness now requires a public-safe `--binary-probe-report`
that attributes the resolved `lco`/`loo` binary to the candidate package. If the
report is missing, `published-smoke` emits a recovery command that builds
`binary-probe.json` under your chosen evidence directory without storing raw npm
or gateway logs. Before running that emitted recovery command, export or set
`LCO_DOGFOOD_REPORT`, `LCO_TOOL_SMOKE_REPORT`, and `LCO_EVIDENCE_DIR` to the
fresh public-safe dogfood report, tool-smoke report, and evidence directory you
want the command to use.

If the gateway needs first-run setup, LCO reports classifications such as
`credential_required`, `device_pairing_required`, `scope_upgrade_required`,
`token_rotation_required`, or `setup_required`.

Useful recovery commands may include:

```bash
openclaw doctor --generate-gateway-token --non-interactive --yes
OPENCLAW_GATEWAY_TOKEN='<scoped-token>' openclaw onboard --non-interactive --accept-risk --gateway-auth token --gateway-token-ref-env OPENCLAW_GATEWAY_TOKEN
OPENCLAW_GATEWAY_TOKEN='<scoped-token>' openclaw gateway status --json --token '<scoped-token>'
OPENCLAW_GATEWAY_TOKEN='<scoped-token>' lco openclaw tool-smoke --profile lco-dogfood --required-tool lco_doctor --required-tool lco_search_sessions --strict
```

Do not paste real tokens into issues, PRs, screenshots, or public evidence.

## 9. Agent Playbook

For an OpenClaw agent, use the packaged skill:

```text
skills/lossless-openclaw-orchestrator/SKILL.md
```

The safe loop is:

1. `lco_doctor`
2. `lco_search_sessions`
3. `lco_describe_ref` with either `thread_id` or a source-prefixed `source_ref`
4. `lco_codex_extract` with `kind: "plans"`, `kind: "final_messages"`, and
   `kind: "touched_files"`
5. `lco_expand_session` or `lco_expand_query`
6. `lco_codex_control_dry_run` only when action is needed
7. `lco_codex_start_thread` only after dry-run approval when a new Codex thread
   is needed
8. live action only with a matching `approval_audit_id`

Live start/send/steer/interrupt results distinguish `accepted_by_transport`,
`started`, `completed`, `persisted`, and `unverified_pending`. If a result is
`unverified_pending`, treat it as transport acceptance only and run the returned
read-only `next_proof` tool call before claiming durable execution or local
session persistence.

The supported live-control path pins every start/resume/send/steer/interrupt
request to `approvalPolicy=never` and a read-only, no-network sandbox. It does
not inherit or widen a thread's ambient runtime permissions. Steer and
interrupt first rejoin the exact target on the same app-server connection, and
both require `expected_turn_id`. Because Codex can retain the active turn's
existing permissions when rejoining a running thread, LCO requires the resume
response to prove the fixed posture before it sends steer or interrupt; an
unproven or wider posture fails closed. Interrupt maps the binding to Codex's
current `turnId` protocol field.

Live resume only proves that the thread was rejoined/loaded by the transport;
do not use resume by itself as durable turn execution proof.

Resume reuses `thread/resume` with `excludeTurns:true` plus the fixed safe
runtime posture; it does not start a turn, so no bounded turn wait applies to
resume alone.

Live send/turn-bound control waits are bounded; use `--turn-wait-ms` on smoke
commands or `LOO_CODEX_TURN_WAIT_MS` for live tool calls when a shorter or
longer local verification window is intentional.

### Agent Provenance Setup

LCO can search and correlate Codex work better when durable agent outputs carry
the same public-safe provenance convention as the underlying schema in
[#436](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/436).
Add a provenance rule to both project-level agent instruction files:

- `AGENTS.md` for Codex / OpenAI Codex agents.
- `CLAUDE.md` for Claude Code / Claude agents.

Put the rule near repo workflow, closeout, maintainer, or GitHub posting rules.
Thread and session ids are correlation handles, not authorization. They help a
future agent find the work lane; they do not grant permission to mutate state,
bypass approvals, or expose private evidence. Do not include raw transcripts,
secrets, local private paths, screenshots, customer data, connector URLs, or
unredacted private logs in public GitHub surfaces.

Codex-oriented `AGENTS.md` snippet:

````markdown
## Agent Provenance

For every durable agent closeout and every agent-authored GitHub surface,
include an agent provenance block so future agents can trace the work back to
the thread that produced it.

Apply this to:

- final closeouts for non-trivial work
- PR bodies
- issue bodies created by an agent
- durable issue/PR comments
- review replies that summarize or close a work loop
- evidence packets or handoff notes

Use Codex thread ids as correlation handles, not authorization. If the current
surface does not expose a Codex thread id, say `unavailable` and use the safest
public-safe opaque run/session ref; do not invent one. Do not include raw
transcripts, secrets, local private paths, screenshots, customer data, connector
URLs, or unredacted private logs in public surfaces.

Preferred visible block:

```markdown
## Agent provenance

- Orchestrator thread: `codex_thread:<parent_thread_id>`
- Worker thread: `codex_thread:<worker_thread_id>`
- Agent role/name: `<role or lane name>`
- Model: `<model id if public-safe>`
- Target issue(s): `#123`, `#124`
- PR/branch: `<branch or PR URL>`
- Final turn id: `<turn id if available>`
- Evidence packet: `<safe artifact URL, issue comment URL, or internal ref>`
```

For compact GitHub comments, a hidden marker is acceptable when a visible block
would be noisy:

```html
<!-- lco-agent-provenance repo=<owner/repo> issue=<n-or-none> pr=<n-or-none> parent_thread=codex_thread:<id-or-none> worker_thread=codex_thread:<id> branch=<branch-or-none> commit=<sha-or-none> -->
```
````

Claude-oriented `CLAUDE.md` snippet:

````markdown
## Agent Provenance

When Claude Code performs durable repo work, it must leave a provenance trail in
the closeout and in agent-authored GitHub surfaces.

Include provenance on:

- final closeouts for non-trivial work
- PR bodies
- issue bodies created by the agent
- durable issue/PR comments
- review replies that summarize or close a work loop
- evidence packets or handoff notes

Use the available conversation/thread/session id as the correlation handle. If
running inside Codex/LCO, use the Codex thread id format:
`codex_thread:<thread_id>`. If no Codex thread id exists, use Claude's session
id or the safest available opaque run id.

Do not expose raw transcripts, secrets, local private paths, screenshots,
customer data, connector URLs, or unredacted private logs in public GitHub
surfaces.

Preferred visible block:

```markdown
## Agent provenance

- Orchestrator thread/session: `<parent thread/session id if available>`
- Worker thread/session: `<worker thread/session id>`
- Agent role/name: `<role or lane name>`
- Model: `<model id if public-safe>`
- Target issue(s): `#123`, `#124`
- PR/branch: `<branch or PR URL>`
- Final turn/run id: `<turn or run id if available>`
- Evidence packet: `<safe artifact URL, issue comment URL, or internal ref>`
```

For compact GitHub comments, a hidden marker is acceptable when a visible block
would be noisy:

```html
<!-- agent-provenance repo=<owner/repo> issue=<n-or-none> pr=<n-or-none> parent_session=<id-or-none> worker_session=<id> branch=<branch-or-none> commit=<sha-or-none> -->
```
````

## 10. Desktop Fallback Readiness

Desktop fallback is optional and proof-bound. Direct Codex protocol remains the
normal first path for thread control, but CUA Driver is the preferred/default
desktop fallback backend when fallback is needed. CUA Driver is an external
operator dependency, not bundled by LCO; missing CUA must not break normal
read/search/describe workflows, but it is a desktop-fallback readiness blocker.
Peekaboo remains a secondary visible fallback for explicit read-only
observation.

Install or update CUA Driver through its own distribution channel, then verify
that the daemon entrypoint launches and inspect LCO's readiness view separately:

```bash
cua-driver mcp --help
lco doctor --json
```

Read-only checks:

```bash
lco desktop see cua-driver
lco desktop see peekaboo --snapshot --max-nodes 50
```

The desktop fallback surface reports readiness and blockers. For CUA readiness,
check the CUA daemon permissions rather than assuming Terminal permissions are
enough. The current LCO proof report and live-proof harness do not validate a
Codex composer read-back field, so do not treat a CUA `type_text` success
payload or ready desktop proof packet as proof that the inserted composer value
was verified. The fallback surface does not grant generic GUI mutation,
unattended control, prompt typing, clicking, no-focus behavior, composer send
approval, or release readiness without an explicit action-bound proof packet.

## 11. Troubleshooting

`lco: command not found`

- Confirm the global npm bin directory is on `PATH`.
- Try `npm prefix -g` and inspect its `bin` directory.
- If older automation still calls `loo`, that binary remains a compatibility
  alias for at least two minor releases.

`lco doctor` cannot find Codex sessions

- Confirm Codex has local sessions under `~/.codex/sessions`.
- Pass explicit roots to `lco index codex`.

Search returns no results

- Run `lco index codex --max-files 500 "$HOME/.codex/sessions"`.
- Confirm `LCO_DB_PATH` points at the same database for index and search.

`lco session-diff` reports that a cursor signing key is required

- Set `LCO_SESSION_DIFF_CURSOR_KEY` from your local secret store and keep it
  stable across CLI, MCP, and OpenClaw restarts.
- Alternatively, initialize LCO's local audit key through an approved dry-run
  control workflow; session diff reads that existing key without creating files.
- If LCO reports an invalid audit key, do not silently regenerate or weaken the
  64-hex-character validation. Back up the invalid local key, then either set a
  stable `LCO_SESSION_DIFF_CURSOR_KEY` or deliberately replace the audit key
  through the approved dry-run setup workflow. Replacing either key makes
  earlier session-diff cursors invalid.
- Do not paste the key into issue reports, QA evidence, or committed config.

Event-content cache uses too much local disk

- Temporarily disable new event-content writes with `export LCO_EVENT_CONTENT=disabled`.
- Drop the derived event-content cache with `lco maintenance --drop-event-content`.
- Unset `LCO_EVENT_CONTENT` and re-run `lco index codex` when you want to rebuild deeper recall.

OpenClaw plugin installs but tools are missing

- Run `openclaw plugins list --json`.
- Run `lco openclaw dogfood --profile lco-dogfood --install-source lossless-codex-orchestrator@latest --required-tool lco_doctor --required-tool lco_search_sessions --strict`.
- Check [docs/OPENCLAW_PLUGIN.md](OPENCLAW_PLUGIN.md).

OpenClaw gateway tool smoke reports credential or device blockers

- Treat this as first-run gateway setup, not a package failure.
- In `lco openclaw published-smoke`, `ok`/`packagePathOk` prove package-path
  health only. `publishedSmokeReady` is the clean-profile gateway-ready claim.
- Strict package-path readiness also requires `--binary-probe-report`; use the
  recovery command emitted by `published-smoke` to create a public-safe
  `binary-probe.json` under the evidence directory.
- A configured gateway proof is useful local evidence, but it does not satisfy
  fresh-profile gateway readiness.
- Use the recovery commands returned by `lco openclaw published-smoke` or
  `lco openclaw tool-smoke`.

npm install reports `ENOVERSIONS` for a visible beta

- First verify the package with `npm view lossless-codex-orchestrator@beta dist.tarball`.
- If the registry tarball is visible, install directly with:

  ```bash
  tarball_url="$(npm view lossless-codex-orchestrator@beta dist.tarball)"
  test -n "$tarball_url" && npm install -g "$tarball_url"
  ```

- The same npm selector-drift tarball fallback can be recorded through
  `lco openclaw published-smoke --npm-install-diagnostic-report <path>` after
  you keep the evidence public-safe.
- Record blocker codes and fallback status only; do not paste raw npm stderr,
  auth config, or tokens into public evidence.

Live control is blocked

- Run a dry-run first.
- Inspect the target, `params_hash`, and optional `message_hash`.
- Use the returned `approval_audit_id` only for the matching live action.

## 12. What Setup Does Not Prove

Setup proves local install, local index, and optional MCP/OpenClaw tool
exposure. It does not prove:

- Claude Code control or settings parity
- no cloud sync
- no unattended desktop takeover
- no permission bypass
- no enterprise security readiness
- generic GUI mutation support
- Codex GUI mutation is stable public behavior

See [docs/CLAIM_AUDIT.md](CLAIM_AUDIT.md) for public wording boundaries.
