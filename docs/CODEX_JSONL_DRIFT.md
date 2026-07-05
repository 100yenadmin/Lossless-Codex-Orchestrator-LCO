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

Known bookkeeping inner kinds such as token counts, reasoning markers, tool
outputs, task lifecycle events, and patch markers are noise-gated. Unknown kinds
are reported only when their payload appears to contain content-like strings the
importer did not extract.

The report is evidence of importer drift, not proof that a Codex version is
unsupported. It intentionally omits raw line text, payload bodies, local paths,
tokens, and transcript content. Use the reason codes to decide whether a new
fixture or parser compatibility patch is needed.
