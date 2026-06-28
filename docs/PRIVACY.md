# Privacy Model

Lossless OpenClaw Orchestrator indexes local agent sessions so another local agent can reason over them without rereading everything.

Default behavior:

- Store local SQLite metadata and safe text.
- Preserve source refs back to local files.
- Preserve source-prefixed refs such as `codex_thread:*` and `lcm_summary:*`.
- Expand evidence only when a user or agent asks.
- Keep OpenClaw LCM and Codex session stores separate.
- Open configured OpenClaw LCM peer DBs read-only with SQLite query-only mode.
- Redact common credential strings and generic `/Users/<name>` paths from indexed safe text and tool-call argument metadata.

Non-goals for the beta:

- Cloud sync.
- Raw transcript upload.
- Merging raw Codex transcripts into OpenClaw LCM.
- Mutating OpenClaw LCM peer DBs from recall tools.
- Full Claude Code parity.
- Unattended desktop takeover.

See `docs/SAFE_SUMMARIES.md` for the field-level safe-summary contract.
