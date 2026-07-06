# Release Notes 1.4.0

`1.4.0` is the **identity release** for the project: it establishes
`lco` / `lco_*` / `LCO_*` and the package name `lossless-codex-orchestrator` as
the canonical surface, while keeping every prior `loo` / `loo_*` / `LOO_*` name
and the `lossless-openclaw-orchestrator` package working as maintained
compatibility aliases. **No public claim boundary changes.** This remains
Codex-first local orchestration.

The rename reflects what the product is: a Codex orchestration engine with a
runtime-neutral core, reachable from OpenClaw (tier 1), Hermes agents (tier 2),
and any generic MCP client (tier 3).

## What Changed

### Canonical `lco` surface (with full `loo` compatibility)

- MCP/OpenClaw tools are now canonically `lco_*`; every historical `loo_*` name
  (including the C1 umbrella leaf aliases) is retained as a generated
  compatibility alias that invokes the identical handler. Both name families are
  verified equivalent by test.
- New bins `lco` and `lco-mcp-server` ship alongside the existing `loo` and
  `loo-mcp-server` (all four resolve to the same runtime).
- Environment variables are canonically `LCO_*` with a `LOO_*` fallback chain
  (e.g. `LCO_DB_PATH` falls back to `LOO_DB_PATH`); when both are set, `LCO_*`
  wins.
- The npm package is now `lossless-codex-orchestrator`. The former
  `lossless-openclaw-orchestrator` remains published and patched in parallel for
  at least two minor releases, and carries an npm deprecation pointer to the new
  name. Existing installs keep working; migrate with
  `npm i -g lossless-codex-orchestrator`.

### First-run and cross-platform hardening

- The Node floor is corrected to `>=22.5.0` (the version that provides
  `node:sqlite`) with a friendly runtime guard instead of a cryptic crash.
- The MCP server now starts fail-closed: a database-init failure returns a
  classified, doctor-style error on `tools/call` instead of a stack-trace death
  before `initialize`.
- Home-directory resolution now uses an `os.homedir()`-based resolver with a
  `HOME` → `USERPROFILE` fallback, so indexing and storage resolve correctly on
  Windows instead of silently writing into the working directory.
- `lco index codex` (the write path) now applies a busy-timeout and classifies
  `database is locked` instead of failing raw under concurrent access.

### Protocol and adapter clarity

- The MCP `initialize` response reports protocol `2025-11-25` and a
  package-derived server version.
- New `docs/HERMES_ADAPTER_BOUNDARY.md` and a VISION "Adapter Tiers" section make
  the OpenClaw / Hermes / generic-MCP tiering explicit. Hermes agents are
  supported today via generic MCP mounting; a Hermes-native adapter is
  deferred until a concrete use case lands.
- `docs/SETUP.md` adds per-client MCP mounting examples (Claude Code, Cursor, and
  generic clients) and a multi-client mounting note.

## Current Claim Scope

Claim scope: `codex-read-search-expand-dry-run` (unchanged from 1.3.x).

Allowed stable claim:

> Collaborate with local Codex sessions through OpenClaw — or any MCP client —
> using local indexing, prepared-state recall, bounded expansion, and
> approval-gated dry-run/control boundaries.

The 1.4.0 identity release does **not** add a new live-control, GUI, parity,
sync, customer-readiness, or enterprise-security claim. The live-send turn-proof
and gateway-dispatch hardening shipped in 1.3.4/1.3.5 improved the *proof
machinery* for control actions; they did not widen the shipped claim. Live
control remains gated on a full send/resume/steer/interrupt matrix before any
`codex-live-control` claim.

## Migration

- Nothing is required: `loo`, `loo-mcp-server`, `loo_*` tools, `LOO_*` env vars,
  and `npm i lossless-openclaw-orchestrator` all continue to work.
- Recommended: switch install to `lossless-codex-orchestrator` and use the `lco`
  bin / `lco_*` tools / `LCO_*` env going forward. The local data directory is
  unchanged.

## Release Gate Notes

- Candidate packages: `lossless-codex-orchestrator@1.4.0` (new canonical) and
  `lossless-openclaw-orchestrator@1.4.0` (maintained compat, deprecated pointer).
- Both install fresh from the registry and pass the published-artifact battery.
- Claim scope `codex-read-search-expand-dry-run`; no widened claims.

---
