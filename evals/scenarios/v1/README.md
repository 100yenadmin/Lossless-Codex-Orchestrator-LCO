# QA Lab Scenarios v1.0

These scenario contracts turn the README and VISION beta promises into
repeatable QA Lab tasks. They are dry-run contracts: `loo eval scenarios`
validates the scenario definitions and writes public-safe scorecards, but does
not read raw Codex transcripts, run live control, mutate the GUI, publish npm,
or create a GitHub Release.

Use these scenarios as the task pack for fixture tests, local private smokes,
MCP checks, and OpenClaw gateway dogfood. Evidence must stay public-safe:
counts, source refs, hashes, statuses, omitted markers, and redacted metadata
only.

