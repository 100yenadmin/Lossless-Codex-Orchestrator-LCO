# Release Notes 1.4.3

`1.4.3` is a focused search/index UX patch for the 1.4 identity line. It ships
the merged #643 and #640 fixes. This remains Codex-first local orchestration.

## What Changed

- Raised default Codex JSONL indexing caps from the old small-file defaults to
  better cover long autonomous sessions.
- Persisted and surfaced limited/skipped Codex files in the local LCO database,
  `lco index codex` warnings, MCP index results, and `lco doctor`.
- Added public-safe recovery guidance for capped files, including explicit
  larger-limit retry commands.
- Clarified that `lco search` / `loo search` is title, metadata, and
  session-card discovery rather than raw-content FTS.
- Routed remembered content phrases toward `lco grep` and `lco expand-query`
  in README/setup/QA docs and search help.
- Kept successful zero-result search output machine-friendly: non-interactive
  CLI calls still return JSON `[]` on stdout and leave stderr empty.

## Scope

This patch improves search and indexing usability for local Codex sessions.
Raw-content FTS and embeddings remain on the 1.5 roadmap as larger recall
improvements.

## Validation

- #643 focused tests covered index-cap persistence, warnings, doctor health, and
  public-safe output boundaries.
- #640 focused tests covered search help, zero-result machine output, bounded
  search, docs truth, and public-safe path canaries.
- `npm run check` must pass before publication.
- GitHub CI, CodeQL, CodeRabbit, and evaOS review gates must be clean before
  the release prep PR merges.

## Package Notes

- Candidate packages: `lossless-codex-orchestrator@1.4.3` (canonical) and
  `lossless-openclaw-orchestrator@1.4.3` (maintained compat).
- Both packages should be published from the same source tree and verified from
  the registry before the GitHub Release is finalized.
