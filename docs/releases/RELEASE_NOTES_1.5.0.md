# Release Notes 1.5.0

`1.5.0` is the Coverage & Cockpit release. It keeps local Codex sessions as the
primary LCO workflow while expanding beyond Codex-only recall with Claude Code
read/recall coverage, a Claude Code recall companion plugin, improved
long-context LCM recall, and first-class database maintenance diagnostics.

## Highlights

- Claude Code sessions can be indexed into local `claude_session:*` refs and
  surfaced through the same describe/expand/prepared-card workflow as Codex
  sessions.
- Prepared cards now include Claude Code advisory cards and inbox items, with
  stale-card cleanup and stable summary selection.
- The Claude Code `lco-recall` companion plugin adds a user-invocable `find`
  skill that calls the local `lco find --json` path, with an `npx` fallback for
  fresh installs.
- `lco maintenance` adds checkpoint, analyze, guarded VACUUM, explicit
  `--no-checkpoint` / `--no-analyze` toggles, and stricter maintenance reports.
- `lco doctor` and MCP `lco_doctor` now expose database size, WAL size,
  maintenance status, and consistent database presence fields.
- LCM summary expansion now walks summary-parent DAGs, preserves omission
  markers under tight token budgets, and shares fixture schema coverage.
- OpenWiki orientation docs and public plugin metadata were refreshed for the
  1.5 line.

## What Changed

- Added Claude Code prepared-card materialization, dedupe, cleanup, summary
  selection, and public-safe card/inbox tests.
- Added the `plugins/lco-recall` Claude Code companion bundle and packaging
  metadata.
- Hardened the companion wrapper runtime tests for direct `lco`, `npx`
  fallback, argument forwarding, exit-code propagation, and empty-query usage.
- Added database maintenance reporting and CLI/MCP doctor parity.
- Added read-only LCM summary DAG expansion with caps for cycles, depth, node
  count, truncation, and missing children.
- Updated OpenWiki automation guards and generated docs orientation.
- Cleaned public plugin wording so package metadata stays customer-facing.

## Upgrade

```bash
npm install -g lossless-codex-orchestrator@latest
lco doctor
```

Existing installations that still use `lossless-openclaw-orchestrator` continue
to work as the maintained compatibility package. New installs should use
`lossless-codex-orchestrator`.

## Validation

- GitHub CI and CodeQL passed for the implementation pull requests.
- Focused Claude Code companion, prepared-card, maintenance doctor, LCM recall,
  OpenWiki, and public-metadata suites passed before release.
- GitNexus was refreshed after the merged PR batch.

## Links

- Claude prepared cards: #717
- Claude Code recall companion: #718
- OpenWiki update workflow: #719 and #733
- Database maintenance doctor: #720
- LCM summary DAG expansion: #721
- Public plugin metadata cleanup: #725
- Release tracking issue: #734
