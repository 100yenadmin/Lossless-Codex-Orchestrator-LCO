# LCO QA Lab

The QA Lab is the release-captain surface for proving that LCO works as a real
installed product, not only as unit-tested code. It is intentionally stricter
than the 1.2.5 GA-assurance patch: catalog presence, package metadata, and
partial gateway smoke do not prove the full canonical tool surface.

## Current Gate

The shipped 1.7.0 QA surface has 39 canonical `lco_*` declarations. Use the
release-captain tool-coverage command as a fail-closed audit:

```bash
lco qa-lab tool-coverage \
  --evidence-dir <evidence-dir>/<date>/qa-lab/tool-coverage \
  --tool-smoke-report <evidence-dir>/<date>/qa-lab/tool-coverage/openclaw-tool-smoke-full.json \
  --coverage-policy full \
  --strict
```

The command emits and writes `tool-coverage.json` with schema
`lco.qaLab.toolCoverage.v1`.

Release-captains must also capture the repeatable full gateway smoke before a
full-surface release claim:

```bash
node ./dist/packages/cli/src/index.js openclaw tool-smoke --profile lco-full-gateway --session-key agent:main:lco-full-gateway --coverage full --thread-id <public-safe-thread-id> --query "<public-safe-query>" --evidence-path <evidence-dir>/<date>/qa-lab/tool-coverage/openclaw-tool-smoke-full.json --strict
```

This full 68-call gateway smoke provides gateway evidence for 37 of the 39
canonical declaration rows through direct canonical calls or mapped
compatibility aliases. Its seven canonical consolidated calls are
`lco_watchers`, `lco_codex_extract`,
`lco_prepared_state`, `lco_operating_picture`, `lco_desktop_proof`,
`lco_session_diff`, and `lco_drive`. The public facade contains nine canonical
tools, including the opaque `lco_codex_control_route` and
`lco_codex_deliver` path. Folded and direct `loo_*` compatibility aliases
remain compatibility proof and do not create additional release-captain
coverage rows.

The two canonical rows not invoked by this OpenClaw smoke are
`lco_codex_control_route` and `lco_codex_deliver`. The separate Eva idle-route
ladder below exercises them for its exact inactive package path; that evidence
does not become OpenClaw gateway coverage or, by itself, a full-surface claim.
With the current 68-call report, `--coverage-policy full --strict` must remain
blocked at 37/39. Do not report a passing full-surface gate until a supported
gateway report supplies product evidence for both missing rows.

For the isolated Eva idle path, build the exact reviewed source checkout and
run that checkout's CLI harness against the immutable installed package and its
canonical tarball:

```bash
npm run build
LCO_CODEX_TRANSPORT=daemon node ./dist/packages/cli/src/index.js qa-lab eva-idle-route \
  --evidence-dir <evidence-dir>/<date>/eva-idle-route \
  --mcp-bin <exact-package-bin> \
  --package-tarball <canonical-1.7.0.tgz> \
  --package-version 1.7.0 \
  --candidate-sha 78bd6e7d4e5656d09e76c4c85d01a85b3515b354 \
  [--execute] --strict
```

That candidate value is the harness-pinned immutable 1.7.0 package/tag SHA.
The harness source head remains separate provenance in the receipt; do not pass
it as `--candidate-sha` or substitute a globally installed `lco` command for
the reviewed source-head entry point.

Run the strict non-execute ladder first. The execute ladder requires a
compatible managed Codex daemon and a disposable persistent task created with
the fixed never-approve, read-only posture. It proves an opaque route, identical
dry/live bindings, single-use approval, transport acceptance, and separate
read-only completion; it does not activate an Eva profile by itself.

For a full QA Lab packet, create the run evidence root first, `cd` into it, and
pass a relative --evidence-dir value from inside the evidence root for each gate.
Demo and judge inputs must come from a synthetic corpus or the committed
retrieval goldens. Live-store content can never be public evidence.

Direct CLI recall smokes for title/metadata session-card discovery should use
bounded search arguments so temporarily locked local stores classify cleanly and
completed slow safe-text queries are reported as setup/runtime blockers:

```bash
lco search --limit 10 --timeout-ms 5000 "<public-safe-query>"
```

For content phrase recall, smoke `lco grep` or `lco expand-query` with the same
public-safe query instead of treating `lco search` as raw-content search.

If the public-safe query begins with flag-like words, pass `--` before the query
text, for example `lco search --limit 10 -- --limit flaglikequery`.

If the local derived-cache database is busy, the command returns a public-safe
`database_busy` recovery packet. Treat that as a setup/runtime blocker for the
direct CLI lane, not as proof of a product recall result. The synchronous
SQLite query path does not claim a hard CPU-query interrupt; use this packet as
bounded busy-lock proof plus slow-query classification.

## What It Proves

- The runtime MCP registry and OpenClaw plugin manifest agree on canonical
  declared `lco_*` tools, while folded compatibility aliases resolve to those
  canonical rows.
- Tool tiers are counted and reported as `public_facade`, `workflow_detail`,
  `proof_debug`, and `internal_low_level`.
- Public facade tools have product invocation evidence.
- Under `--coverage-policy full`, every canonical declared tool has
  tier-appropriate product evidence or the release must explicitly exclude that
  tool/workflow.
- Public-safe evidence is used; raw transcripts, prompts, screenshots, SQLite
  DBs, JSONL transcripts, tokens, cookies, and raw gateway output stay out of
  the report.

## What It Does Not Do

`lco qa-lab tool-coverage` is aggregate-only. It does not invoke tools,
authorize gateways, run live Codex control, mutate a GUI, publish npm, create
tags, create GitHub Releases, read raw transcripts, or store raw gateway
output.

## Policy

For broad/global GA claims, optimize for the full claimed surface:

- 100% canonical declared-tool catalog parity.
- 100% public facade OpenClaw gateway invocation.
- 100% canonical declared tools with tier-appropriate evidence, or explicit
  non-claim exclusions in release copy.
- Zero unresolved P0-P2 blockers.
- Clean public-safe evidence scan.

Scoped releases may use `--coverage-policy facade` as a diagnostic, but a facade
pass is not full-surface GA proof.

## Runtime Acceptance Status

The final-main immutable 1.7.0 inactive-package ladder passed for the named Eva
package path through a compatible pre-existing managed daemon. A distinct
Telegram readiness marker and separate 1.6.1 baseline passed, so Eva activated
the canonical 1.7.0 server and passed gateway, 80-tool MCP, and equal
sixteen-tool allowlist health. The one #799 runtime-gate Telegram canary
produced no reply
within its 120-second acceptance window, so the fixed rollback restored exact
1.6.1, absent daemon transport, gateway, 76-tool MCP, equal allowlists, and a
same-conversation health reply. The pre-existing daemon was never stopped.
Issue [#799](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/799)
remains the runtime lifecycle source of truth, while
[#808](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/808)
retains only its bounded idle-route diagnostic evidence. This result is not Eva
`runtime_safe` and does not weaken the baseline-before-activation gate.
