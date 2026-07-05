# LCO QA Lab

The QA Lab is the release-captain surface for proving that LCO works as a real
installed product, not only as unit-tested code. It is intentionally stricter
than the 1.2.5 GA-assurance patch: catalog presence, package metadata, and
partial gateway smoke do not prove the full declared tool surface.

## Current Gate

Milestone 12 starts with tool coverage:

```bash
loo qa-lab tool-coverage \
  --evidence-dir <evidence-dir>/<date>/m12-ga-qa-lab/tool-coverage \
  --tool-smoke-report <evidence-dir>/<date>/m12-ga-qa-lab/tool-coverage/openclaw-tool-smoke.json \
  --coverage-policy full \
  --strict
```

The command emits and writes `tool-coverage.json` with schema
`lco.qaLab.toolCoverage.v1`.

## What It Proves

- The runtime MCP registry and OpenClaw plugin manifest agree on declared
  `loo_*` tools.
- Tool tiers are counted and reported as `public_facade`, `workflow_detail`,
  `proof_debug`, and `internal_low_level`.
- Public facade tools have product invocation evidence.
- Under `--coverage-policy full`, every declared tool has tier-appropriate
  product evidence or the release must explicitly exclude that tool/workflow.
- Public-safe evidence is used; raw transcripts, prompts, screenshots, SQLite
  DBs, JSONL transcripts, tokens, cookies, and raw gateway output stay out of
  the report.

## What It Does Not Do

`loo qa-lab tool-coverage` is aggregate-only. It does not invoke tools,
authorize gateways, run live Codex control, mutate a GUI, publish npm, create
tags, create GitHub Releases, read raw transcripts, or store raw gateway
output.

## Policy

For broad/global GA claims, optimize for the full claimed surface:

- 100% declared-tool catalog parity.
- 100% public facade OpenClaw gateway invocation.
- 100% declared tools with tier-appropriate evidence, or explicit non-claim
  exclusions in release copy.
- Zero unresolved P0-P2 blockers.
- Clean public-safe evidence scan.

Scoped releases may use `--coverage-policy facade` as a diagnostic, but a facade
pass is not full-surface GA proof.

## 1.2.5 Baseline

The 1.2.5 release remained an honest scoped stable release. Its latest OpenClaw
gateway smoke invoked 36 of 60 declared `loo_*` tools. Under M12, that is useful
evidence but not a full GA proof. The first QA Lab gate must fail that baseline
until the missing tools have product evidence or are explicitly excluded.
