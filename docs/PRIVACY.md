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

Mutation classes:

- Pure read tools have an empty `mutationClasses` list.
- `derived_cache` means LCO writes its own local SQLite cache or audit record,
  such as `loo_index_sessions` or `loo_codex_control_dry_run`.
- `source_store` is reserved for mutations to Codex/OpenClaw source stores and
  is not part of the default prepared-state path.
- `external_system`, `github_write`, `notion_write`, `release_publish`, and
  `npm_publish` are non-default external/release mutation families.
- `live_control` and `desktop_gui` remain approval-gated and outside normal
  recall, prepared-state, and watcher reads.

When a tool says `read_only`, read it as "no source-store, external-system,
live-control, or GUI mutation." Tools may still declare `derived_cache` when
they update LCO-owned local advisory state.

Non-goals for the beta:

- Cloud sync.
- Raw transcript upload.
- Merging raw Codex transcripts into OpenClaw LCM.
- Mutating OpenClaw LCM peer DBs from recall tools.
- Full Claude Code parity.
- Unattended desktop takeover.

See `docs/SAFE_SUMMARIES.md` for the field-level safe-summary contract.
