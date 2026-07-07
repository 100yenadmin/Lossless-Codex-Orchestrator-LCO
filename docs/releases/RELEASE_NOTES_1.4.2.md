# Release Notes 1.4.2

`1.4.2` is a focused Codex recall patch for the 1.4 identity line. It fixes a
final-message extraction bug where compacted output or tool-call output could
populate `final_message` and the weighted `codex_search_fts.finals` column on
large or compacted sessions. This remains Codex-first local orchestration.

## What Changed
- Codex final-message extraction now only accepts assistant prose payloads.
- Compacted output and `function_call_output` text still remain available in
  bounded recall body text, but they can no longer overwrite or synthesize the
  session final message.
- Regression coverage now pins three cases:
  - tool/compaction noise after a real assistant final,
  - tool-only compacted sessions with no assistant final,
  - assistant prose fallback finals when no explicit final marker is present.

## Scope
This patch is a recall-quality fix. It keeps the product centered on local Codex
session orchestration: indexing, prepared-state recall, bounded expansion, and
approval-gated command packets.

## Validation
- Focused Codex extraction tests covered plans, finals, touched files, summary
  leaves, prepared source ranges, and extraction evals.
- `tests/codex-index.test.ts` covered the merged regression cases and passed
  after review hardening.
- GitHub CI and CodeQL passed on the merged fix PR.
- CodeRabbit actionable feedback was addressed; evaOS review completed and all
  review threads were resolved before merge.

## Package Notes
- Candidate packages: `lossless-codex-orchestrator@1.4.2` (canonical) and
  `lossless-openclaw-orchestrator@1.4.2` (maintained compat).
- Both packages should be published from the same source tree and verified from
  the registry before the GitHub Release is finalized.
