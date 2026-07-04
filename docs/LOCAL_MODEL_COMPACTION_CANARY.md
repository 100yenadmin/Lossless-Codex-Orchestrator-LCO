# Local Model Compaction Canary

This spike records the boundary for a future optional local model compaction
path. It does not implement compaction and does not call a model.

## Contract

- Disabled by default.
- Requires explicit local config and an approval ref.
- Rejects raw transcript inputs.
- Rejects current `safe_text` inputs.
- Accepts only approved `prepared_card:*` and `summary_leaf:*` refs.
- Emits advisory `lco.summary.leaf.v1`-shaped output only.
- Requires source refs, source range refs, and sanitizer check refs.
- Records `modelCallRun: false` and all live/control/mutation action flags as
  false.

## Proof Boundary

The canary can prove only fail-closed input gating and public-safe advisory
packet shape. It does not prove model quality, token cost, true Codex
compaction-summary capture, source authority, live Codex control, GUI mutation,
release readiness, npm publication, or GitHub Release readiness.

Use `evals/scenarios/v1/local-model-compaction-canary-v1.json` and
`tests/local-model-compaction-canary.test.ts` as the current public-safe proof.
