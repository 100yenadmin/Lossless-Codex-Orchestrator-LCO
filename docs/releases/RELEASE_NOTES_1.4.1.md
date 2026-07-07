# Release Notes 1.4.1

`1.4.1` is the polish patch for the 1.4 identity line. It fixes the flagship new
package's version reporting, flips public docs to the now-published
`lossless-codex-orchestrator` name, and keeps npm package artifacts aligned with
the 1.4 identity line. This remains Codex-first local orchestration.

## What Changed

- Fixed the new package (`lossless-codex-orchestrator`) reporting an `unknown`
  version from neutral working directories. The CLI package-root resolution now
  accepts both package names (`lossless-codex-orchestrator` and the compat
  `lossless-openclaw-orchestrator`) via a shared identity helper, so
  `lco --version`, `lco onboard status`, and release/QA gates resolve correctly
  whichever package a user installed.
- Public docs now lead with `npm install -g lossless-codex-orchestrator` and the
  `lco` bin. `lossless-openclaw-orchestrator` and the `loo` bin are documented
  as maintained compatibility aliases.
- The npm package allowlist now excludes raw-ish retrieval JSONL fixtures and
  local media assets while keeping public-safe scenario and scorecard examples.
- README/VISION current-stable copy now reflects `1.4.1`.

## Scope

This patch is about install identity, package metadata, public docs, and package
contents. It keeps the product centered on local Codex session orchestration:
indexing, prepared-state recall, bounded expansion, and approval-gated command
packets.

## Validation

- Candidate packages: `lossless-codex-orchestrator@1.4.1` (canonical) and
  `lossless-openclaw-orchestrator@1.4.1` (maintained compat).
- Both packages should be published from the same source tree and verified from
  the registry before the GitHub Release is finalized.
