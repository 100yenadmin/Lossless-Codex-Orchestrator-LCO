# Privacy Model

Lossless OpenClaw Orchestrator indexes local agent sessions so another local agent can reason over them without rereading everything.

Default behavior:

- Store local SQLite metadata and safe text.
- Preserve source refs back to local files.
- Expand evidence only when a user or agent asks.
- Keep OpenClaw LCM and Codex session stores separate.
- Redact common credential strings and generic `/Users/<name>` paths from indexed safe text and tool-call argument metadata.

Non-goals for the beta:

- Cloud sync.
- Raw transcript upload.
- Merging raw Codex transcripts into OpenClaw LCM.
- Full Claude Code parity.
- Unattended desktop takeover.

See `docs/SAFE_SUMMARIES.md` for the field-level safe-summary contract.
