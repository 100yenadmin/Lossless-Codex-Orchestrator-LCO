# Release Notes 1.4.5

`1.4.5` is a maintenance release for the 1.4 identity line. It improves how
LCO parses visible local Codex sessions in Codex Desktop and cleans up public
docs so users and agents see the current canonical tool names.

## Highlights

- Codex Desktop visible-thread parsing now ignores structural Scheduled sidebar
  containers without hiding real session rows.
- A visible session genuinely named `Scheduled` remains discoverable.
- Public setup, demo, runbook, VISION, scorecard, and OpenClaw skill docs now
  teach the canonical `lco_codex_extract` and `lco_operating_picture` tools.
- Release notes and changelog entries now stay in a normal
  customer/developer-facing format.

## What Changed

- Hardened the Peekaboo visible Codex thread-map parser against structural
  sidebar folders and degenerate 1px sidebar artifacts.
- Added regression coverage for Scheduled container rows, degenerate sidebar
  candidates, and a normal thread titled `Scheduled`.
- Replaced stale direct `lco_codex_*` detail-tool examples with
  `lco_codex_extract` and explicit `kind` values.
- Replaced stale direct thread-map examples with `lco_operating_picture` and
  `kind: "thread_map"`.

## Upgrade

```bash
npm install -g lossless-codex-orchestrator@latest
lco doctor
```

Existing installations that still use the compatibility package continue to
work, but new installs should use `lossless-codex-orchestrator`.

## Validation

- GitHub CI and CodeQL passed for the implementation pull requests.
- Focused visible-session parser and public-doc checks passed before release.
- The release tracking issue links the command-level validation record.

## Links

- Visible parser fix: #703
- Canonical tool docs cleanup: #704
- Release tracking issue: #705
