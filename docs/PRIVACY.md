# Privacy Model

Lossless Codex Orchestrator indexes local agent sessions so another local agent can reason over them without rereading everything.

Default behavior:

- Store local SQLite metadata and safe text.
- Preserve source refs back to local files.
- Preserve source-prefixed refs such as `codex_thread:*` and `lcm_summary:*`.
- Expand evidence only when a user or agent asks.
- Keep OpenClaw LCM and Codex session stores separate.
- Open configured OpenClaw LCM peer DBs read-only with SQLite query-only mode.
- Redact common credential strings and generic `/Users/<name>` paths from indexed safe text and tool-call argument metadata.

Mutation classes:

- Pure read tools use `mode: "read_only"` and have an empty
  `mutationClasses` list.
- LCO-owned local cache or audit writes use `mode: "local_cache_write"` and
  `mutationClasses: ["derived_cache"]`.
- `derived_cache` means LCO writes its own local SQLite cache or audit record,
  such as `lco_index_sessions` or `lco_codex_control_dry_run`.
- `source_store` is reserved for mutations to Codex/OpenClaw source stores and
  is not part of the default prepared-state path.
- `external_system`, `github_write`, `notion_write`, `release_publish`, and
  `npm_publish` are non-default external/release mutation families.
- `live_control` and `desktop_gui` remain approval-gated and outside normal
  recall, prepared-state, and watcher reads.

When a tool says `read_only`, read it as no writes. When a tool says
`local_cache_write`, read it as an LCO-owned advisory cache or audit write only,
not Codex source-store, external-system, live-control, or GUI mutation.

Non-goals for the beta:

- Cloud sync.
- Raw transcript upload.
- Merging raw Codex transcripts into OpenClaw LCM.
- Mutating OpenClaw LCM peer DBs from recall tools.
- Full Claude Code parity.
- Unattended desktop takeover.

See `docs/SAFE_SUMMARIES.md` for the field-level safe-summary contract.
