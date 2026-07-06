# Setup Guide

This guide takes a new user from package install to a working local Codex recall
loop, then through MCP/OpenClaw setup.

LCO is local-first. It indexes local Codex session metadata and safe text into a
local SQLite database so an agent can search, describe, and expand bounded
evidence without reading raw transcripts by default.
It does not read raw transcripts by default during normal search/describe
workflows.

## 1. Requirements

- Node.js 22 or newer
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
npm install -g lossless-openclaw-orchestrator@latest
loo doctor
```

Install the beta train only when you explicitly want prerelease behavior:

```bash
npm install -g lossless-openclaw-orchestrator@beta
```

Fresh walkthrough proof for maintainers or release PRs should use an isolated npm prefix
and a fresh LOO_DB_PATH so the result does not depend on the maintainer's
global install or existing local database:

```bash
walkthrough_root="$(mktemp -d /tmp/lco-setup.XXXXXX)"
export NPM_CONFIG_PREFIX="$walkthrough_root/npm-prefix"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
export LOO_DB_PATH="$walkthrough_root/orchestrator.sqlite"
npm install -g lossless-openclaw-orchestrator@latest
loo doctor --json
```

Before a candidate version is published, a release PR may use the local repo build
as the registry package substitute and must say so in the PR body:

```bash
npm run build
npm install -g "$PWD"
loo doctor --json
```

On a never-indexed database, `loo doctor --json` can report the first-run
classification `not_indexed_yet`. That is the expected prompt to run the index
step below, not a broken install. If the `codexJsonlDrift` block appears after
indexing, treat it as a bounded completeness caveat for the flagged files.

If npm metadata shows the package but `npm install` fails with selector drift
such as `ENOVERSIONS` or `ETARGET`, use the npm selector-drift tarball fallback
with raw commands:

```bash
tarball_url="$(npm view lossless-openclaw-orchestrator@latest dist.tarball)"
test -n "$tarball_url" && npm install -g "$tarball_url"
```

Update later:

```bash
npm update -g lossless-openclaw-orchestrator
```

Uninstall:

```bash
npm uninstall -g lossless-openclaw-orchestrator
```

Uninstalling the package does not delete your local LCO database.

## 3. Choose Local Storage

Default database:

```bash
$HOME/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite
```

Set it explicitly if you want repeatable shell sessions:

```bash
export LOO_DB_PATH="$HOME/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite"
```

Optional read-only OpenClaw LCM peer database paths:

```bash
export LOO_LCM_DB_PATHS="$HOME/.openclaw/lcm.db"
```

LCM peer DBs are opened read-only. LCO does not merge raw Codex transcripts into
OpenClaw LCM.

## 4. Index Local Codex Sessions

Run a bounded first import:

```bash
loo index codex --max-files 500 "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

The default importer applies a 50 MB per-file index cap. Use
`--max-bytes-per-file <bytes>` only for an intentional local override when you
need to index larger Codex JSONL files.

For a smaller smoke:

```bash
loo index codex --max-files 50 "$HOME/.codex/sessions"
```

Then check readiness:

```bash
loo doctor
```

The index stores metadata, source refs, extraction fields, and safe searchable
text. Raw transcripts remain in the local Codex store.

## 5. Run The First Recall Loop

Search:

```bash
loo search "proposed plan billing bridge"
```

Describe a result:

```bash
loo describe codex_thread:<thread-id>
```

Expand a brief:

```bash
loo expand-ref --profile brief --token-budget 1000 codex_thread:<thread-id>
```

Expand by query:

```bash
loo expand-query --profile brief --token-budget 1000 "billing bridge"
```

Look up detail fields through MCP/OpenClaw tools when available:

- `loo_codex_plans`
- `loo_codex_final_messages`
- `loo_codex_touched_files`
- `loo_codex_tool_calls`

## 6. Enable Codex Thread Title Aliases

The published LCO package includes a Codex plugin manifest at
`.codex-plugin/plugin.json` and hook config at `hooks/hooks.json`. When
installed as a Codex plugin, its Stop hook runs `loo hook thread-title-finalize`
after assistant turns. The hook writes one public-safe local title alias per
thread, such as:

```text
lossless-openclaw-orchestrator: Codex thread title finalizer
```

That alias is indexed in `codex_thread_title_aliases`, so LCO search can find
the thread by generated name or by `codex_thread:<thread-id>` without reading
raw transcripts.

Manual smoke:

```bash
printf '%s\n' '{"thread_id":"019f-example","cwd":"'$PWD'","task_summary":"Codex thread title finalizer"}' \
  | loo hook thread-title-finalize --payload-stdin --strict
loo search "Codex thread title finalizer"
```

Safety boundary: this hook preserves the canonical Codex title, hashes/redacts
transcript paths, never opens transcript paths, and writes only LCO-owned
derived cache. It does not mutate the Codex GUI or add an agent-facing naming
tool.

## 7. Connect MCP

Start the MCP server:

```bash
loo-mcp-server
```

Equivalent CLI entry:

```bash
loo serve
```

MCP client config:

```json
{
  "mcpServers": {
    "lossless-openclaw-orchestrator": {
      "command": "loo-mcp-server"
    }
  }
}
```

The MCP server exposes the same `loo_*` surface used by OpenClaw.

Optional tool exposure profiles:

```bash
export LOO_TOOL_PROFILE=facade  # facade, standard, or all
```

`all` is the default and preserves the full catalog. `facade` lists the compact
operator path plus tested public `lco_*` aliases for those facade tools;
`standard` adds workflow-detail tools. The full runtime catalog remains
available under the backward-compatible `loo_*` names.

## 8. Install In OpenClaw

Install the plugin from npm:

```bash
openclaw plugins install lossless-openclaw-orchestrator@latest
openclaw plugins list --json
```

Run a public-safe plugin readiness check:

```bash
loo openclaw dogfood --profile lco-dogfood --install-source lossless-openclaw-orchestrator@latest --required-tool loo_doctor --required-tool loo_search_sessions --strict
```

Run a tool smoke through OpenClaw Gateway:

```bash
loo openclaw tool-smoke --profile lco-dogfood --required-tool loo_doctor --required-tool loo_search_sessions --strict
```

After a published install, combine the package, dogfood, and tool-smoke reports
into one first-run classifier:

```bash
loo openclaw published-smoke --evidence-dir /tmp/lco-published-smoke --dogfood-report plugin-load.json --tool-smoke-report tool-smoke.json --strict
```

If the gateway needs first-run setup, LCO reports classifications such as
`credential_required`, `device_pairing_required`, `scope_upgrade_required`,
`token_rotation_required`, or `setup_required`.

Useful recovery commands may include:

```bash
openclaw doctor --generate-gateway-token --non-interactive --yes
OPENCLAW_GATEWAY_TOKEN='<scoped-token>' openclaw onboard --non-interactive --accept-risk --gateway-auth token --gateway-token-ref-env OPENCLAW_GATEWAY_TOKEN
OPENCLAW_GATEWAY_TOKEN='<scoped-token>' openclaw gateway status --json --token '<scoped-token>'
OPENCLAW_GATEWAY_TOKEN='<scoped-token>' loo openclaw tool-smoke --profile lco-dogfood --required-tool loo_doctor --required-tool loo_search_sessions --strict
```

Do not paste real tokens into issues, PRs, screenshots, or public evidence.

## 9. Agent Playbook

For an OpenClaw agent, use the packaged skill:

```text
skills/lossless-openclaw-orchestrator/SKILL.md
```

The safe loop is:

1. `loo_doctor`
2. `loo_search_sessions`
3. `loo_describe_session` or `loo_describe_ref`
4. `loo_codex_plans`, `loo_codex_final_messages`, and
   `loo_codex_touched_files`
5. `loo_expand_session` or `loo_expand_query`
6. `loo_codex_control_dry_run` only when action is needed
7. `loo_codex_start_thread` only after dry-run approval when a new Codex thread
   is needed
8. live action only with a matching `approval_audit_id`

Live start/send/resume results distinguish `accepted_by_transport`, `started`,
`completed`, `persisted`, and `unverified_pending`. If a result is
`unverified_pending`, treat it as transport acceptance only and run the returned
read-only `next_proof` tool call before claiming durable execution or local
session persistence.
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
loo doctor --json
```

Read-only checks:

```bash
loo desktop see cua-driver
loo desktop see peekaboo --snapshot --max-nodes 50
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

`loo: command not found`

- Confirm the global npm bin directory is on `PATH`.
- Try `npm prefix -g` and inspect its `bin` directory.

`loo doctor` cannot find Codex sessions

- Confirm Codex has local sessions under `~/.codex/sessions`.
- Pass explicit roots to `loo index codex`.

Search returns no results

- Run `loo index codex --max-files 500 "$HOME/.codex/sessions"`.
- Confirm `LOO_DB_PATH` points at the same database for index and search.

OpenClaw plugin installs but tools are missing

- Run `openclaw plugins list --json`.
- Run `loo openclaw dogfood --profile lco-dogfood --install-source lossless-openclaw-orchestrator@latest --required-tool loo_doctor --required-tool loo_search_sessions --strict`.
- Check [docs/OPENCLAW_PLUGIN.md](OPENCLAW_PLUGIN.md).

OpenClaw gateway tool smoke reports credential or device blockers

- Treat this as first-run gateway setup, not a package failure.
- In `loo openclaw published-smoke`, `ok`/`packagePathOk` prove package-path
  health only. `publishedSmokeReady` is the clean-profile gateway-ready claim.
- A configured gateway proof is useful local evidence, but it does not satisfy
  fresh-profile gateway readiness.
- Use the recovery commands returned by `loo openclaw published-smoke` or
  `loo openclaw tool-smoke`.

npm install reports `ENOVERSIONS` for a visible beta

- First verify the package with `npm view lossless-openclaw-orchestrator@beta dist.tarball`.
- If the registry tarball is visible, install directly with:

  ```bash
  tarball_url="$(npm view lossless-openclaw-orchestrator@beta dist.tarball)"
  test -n "$tarball_url" && npm install -g "$tarball_url"
  ```

- The same npm selector-drift tarball fallback can be recorded through
  `loo openclaw published-smoke --npm-install-diagnostic-report <path>` after
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

- full Claude Code parity
- no cloud sync
- no unattended desktop takeover
- no permission bypass
- no enterprise security readiness
- generic GUI mutation support
- Codex GUI mutation is stable public behavior

See [docs/CLAIM_AUDIT.md](CLAIM_AUDIT.md) for public wording boundaries.
