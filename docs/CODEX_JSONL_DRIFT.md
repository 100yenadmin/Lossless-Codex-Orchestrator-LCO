# Codex JSONL Drift Report

LCO indexes local Codex JSONL session stores as a best-effort, fail-soft import.
The importer supports the known local shapes used by recent Codex session files:

- current envelope records: `{ "type": "<envelope>", "payload": { ... } }`
- transparent envelopes: `response_item`, `event_msg`, `session_meta`,
  `turn_context`, `compacted`, and `item`
- legacy inline records such as `event_msg.type` and `response_item.type`
- `session_meta.payload.id`, with legacy `session_meta.thread_id` fallback
- message, agent-message, user-message, and tool-call payloads used for safe
  summaries and tool metadata

When a file drifts from those assumptions, indexing continues and the
`indexCodexSessions` result includes a `driftReport` entry for the affected
file. The report is public-safe metadata only:

- `unknownEventKinds`: safe event kind names and counts
- `unparsedLines`: count of lines that were not JSON
- `missingExpectedFields`: expected field names and counts
- `reasonCodes`: compact codes such as `unknown_event_kind:<kind>`,
  `missing_field:<field>`, and `unparsed_line`

`driftSummary` totals the same counts across affected files. Clean imports
return an empty `driftReport` and zeroed `driftSummary`.

`loo doctor`, `loo onboard status`, and related status tools expose the
public-safe `CodexJsonlDriftStatus` contract for previously indexed data. Its
top-level `state` is one of:

- `clean`: indexed JSONL rows exist and no drift counters are present.
- `drift_detected`: indexed rows exist and at least one indexed source reported
  unknown event kinds, unparsed lines, or missing expected fields.
- `not_indexed_yet`: no Codex JSONL source rows have been indexed into LCO yet.
  This includes the first run before the local LCO database file exists.
- `unavailable`: the status could not be computed safely, usually because a
  read failed.

`availability` explains whether the status can be trusted:

- `ready`: the indexed drift projection is available.
- `database_missing`: the LCO database is not present yet. Current first-run
  doctor output folds this into `requires_index_run` so the user receives one
  bounded index command instead of a separate database repair path.
- `requires_index_run`: Codex JSONL projection data has not been populated yet.
  This can mean the local LCO database is missing or that the database exists
  with no indexed Codex JSONL rows.
- `read_error`: LCO could not read the projection tables.

When `availability` is `requires_index_run`, `nextAction` contains the suggested
local command for a bounded first index run:

```bash
loo index codex --max-files 500 "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

On non-POSIX shells, replace `$HOME` with the absolute home directory before
running the command manually.

That command is a local derived-cache write only; it does not mutate Codex source
stores, run live control, or upload transcripts. The reason code
`codex_jsonl_drift_projection_requires_index_run` means the status object is
requesting that first projection pass rather than reporting parser drift. When
the database file itself is absent, the status also includes
`codex_jsonl_drift_database_missing`; the remediation remains the same bounded
index command.

When `loo index codex` is later run with a narrower or different root set, LCO
prunes indexed rows only for missing JSONL files that are still under the current
canonical root set. It intentionally keeps rows for still-existing files outside
the current roots. That fail-closed behavior avoids deleting a user's derived
cache merely because they changed the index scope, but it means drift/status
counts can include retained rows from earlier roots until the user intentionally
reindexes or rebuilds the local LCO database.

Known bookkeeping inner kinds such as token counts, reasoning markers, tool
outputs, task lifecycle events, and patch markers are noise-gated. Unknown kinds
are reported only when their payload appears to contain content-like strings the
importer did not extract.

The report is evidence of importer drift, not proof that a Codex version is
unsupported. It intentionally omits raw line text, payload bodies, tokens, and
transcript content. `driftReport[].path` follows the local `IndexCodexResult`
path convention; redact or replace it with source refs before sharing. Use the
reason codes to decide whether a new fixture or parser compatibility patch is
needed.
