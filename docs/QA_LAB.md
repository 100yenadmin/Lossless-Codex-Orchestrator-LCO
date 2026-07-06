# LCO QA Lab

The QA Lab is the release-captain surface for proving that LCO works as a real
installed product, not only as unit-tested code. It is intentionally stricter
than the 1.2.5 GA-assurance patch: catalog presence, package metadata, and
partial gateway smoke do not prove the full canonical tool surface.

## Current Gate

Milestone 12 starts with tool coverage:

```bash
lco qa-lab tool-coverage \
  --evidence-dir <evidence-dir>/<date>/m12-ga-qa-lab/tool-coverage \
  --tool-smoke-report <evidence-dir>/<date>/m12-ga-qa-lab/tool-coverage/openclaw-tool-smoke.json \
  --coverage-policy full \
  --strict
```

The command emits and writes `tool-coverage.json` with schema
`lco.qaLab.toolCoverage.v1`.

Release-captains must also capture the repeatable full gateway smoke before a
full-surface release claim:

```bash
node ./dist/packages/cli/src/index.js openclaw tool-smoke --profile lco-full-gateway --session-key agent:main:lco-full-gateway --coverage full --thread-id <public-safe-thread-id> --query "<public-safe-query>" --evidence-path <evidence-dir>/<date>/m12-ga-qa-lab/tool-coverage/openclaw-tool-smoke-full.json --strict
```

This is the full 65-tool gateway smoke: the existing full gateway denominator
plus the five C1 canonical umbrella calls `lco_watchers`,
`lco_codex_extract`, `lco_prepared_state`, `lco_operating_picture`, and
`lco_desktop_proof`. Folded compatibility aliases remain compatibility proof
and do not create additional release-captain coverage rows.

For a full QA Lab packet, create the run evidence root first, `cd` into it, and
pass a relative --evidence-dir value from inside the evidence root for each gate.
Demo and judge inputs must come from a synthetic corpus or the committed
retrieval goldens. Live-store content can never be public evidence.

Direct CLI recall smokes should use bounded search arguments so temporarily
locked local stores classify cleanly and completed slow safe-text queries are
reported as setup/runtime blockers:

```bash
lco search --limit 10 --timeout-ms 5000 "<public-safe-query>"
```

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

## Baseline And C1 Consolidation

The 1.2.5 release remained an honest scoped stable release. Its latest OpenClaw
gateway smoke invoked 36 of 60 declared `lco_*` tools. Under M12, that remains
useful historical evidence but not a full GA proof. C1 folds input-congruent
read-only families into 34 canonical tools and keeps the old folded `loo_*`
names as compatibility aliases. The QA Lab denominator is the canonical surface;
compatibility aliases should prove backward compatibility without creating extra
coverage rows.
