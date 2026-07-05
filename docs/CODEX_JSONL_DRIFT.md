# Codex JSONL Drift Report

LCO indexes local Codex JSONL session stores as a best-effort, fail-soft import.
The importer supports the known local shapes used by recent Codex session files:

- `session_meta.payload.id`, with legacy `session_meta.thread_id` fallback
- `event_msg.type=thread_name` with `name`
- `event_msg.type=agent_message` with `message` or `text`
- `response_item.type=message` with `text` or `content[].text`
- `response_item.type=function_call`, `tool_call`, or `tool_use` with a tool name

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

The report is evidence of importer drift, not proof that a Codex version is
unsupported. It intentionally omits raw line text, payload bodies, local paths,
tokens, and transcript content. Use the reason codes to decide whether a new
fixture or parser compatibility patch is needed.
