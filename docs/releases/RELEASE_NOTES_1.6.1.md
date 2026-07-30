# Release Notes 1.6.1

`1.6.1` is a focused Hermes live-control hotfix.

## Fixed

- Canonical MCP control tools now accept the public-safe
  `codex_thread:<thread-id>` references returned by `lco_recent_sessions`.
- LCO removes the supported `codex_thread:` prefix before approval hashing and
  Codex app-server requests, so a dry run made with the public reference also
  matches a live call made with the raw Codex thread id.
- Raw Codex thread ids continue to pass through unchanged.

## Behavior Preserved

The hotfix preserves the matching `approval_audit_id` requirement and the
fixed never-approve, read-only, no-network Codex posture. It does not enable
unattended control, change a Hermes profile, expose raw transcripts, or widen
the stdio MCP integration into a native Hermes adapter.

## Upgrade

```bash
npm install -g lossless-codex-orchestrator@latest
lco doctor
```

## Links

- Thread-reference live-control bug: #795
- LCO 1.6 Control Plane tracker: #673
