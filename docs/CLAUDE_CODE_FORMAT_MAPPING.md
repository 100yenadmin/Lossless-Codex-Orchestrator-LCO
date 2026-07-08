# Claude Code Read/Recall Format Mapping

This document is the implementation map for the LCO 1.5 Claude Code read/recall
lane. It describes the public-safe subset LCO parses from Claude Code project
JSONL records before storage/importer wiring.

## Parser Contract

`parseClaudeCodeJsonl(sourcePath, text)` is pure and side-effect free. It does
not discover files, write the LCO database, read raw transcript paths, or expose
raw Claude transcript content. It converts one JSONL session file into a
`ParsedClaudeCodeSession` with:

- `claude_session:*` source refs with unsafe ids hashed through the existing
  Claude session-id normalizer.
- `claude_source:*`, `claude_event:*`, and `claude_range:*` opaque refs.
- line and byte ranges for future bounded expansion.
- public-safe `safeText` composed from redacted user/assistant text and
  structure-only tool markers.
- event counts and omission markers for raw payloads that were intentionally
  skipped.

## Event Mapping

| Observed Claude shape | LCO event kind | Public-safe retained fields | Omitted or redacted |
| --- | --- | --- | --- |
| `type:"user"` with `message.role:"user"` and string content | `user_message` | redacted text, timestamp, line/byte range | raw paths, tokens, ids, `cwd`, entrypoint details |
| `type:"assistant"` / `message.role:"assistant"` with text segments | `assistant_message` | redacted text, timestamp, line/byte range | thinking traces, signatures, media blobs |
| `message.content[]` segment `type:"tool_use"` | `assistant_message` with tool metadata count | `Tool use: <safe tool name>` and omission marker | tool input, command strings, file paths, URLs, secrets |
| `message.content[]` segment `type:"tool_result"` or `toolUseResult` | `tool_result` | `Tool result omitted`, line/byte range, omission marker | stdout, stderr, command output, raw attachments |
| `type:"summary"` or top-level `summary` | `summary` | redacted summary text and range | raw summary-adjacent secrets/paths |
| `type:"system"` / `type:"metadata"` | `metadata` | timestamp/range only unless future tests add safe fields | raw content payloads |
| Unknown event variant | `unknown` | range, low confidence, omission marker | raw row text |

## High-Risk Fields

The parser treats these as unsafe by default:

- free text in `content`, `message.content[].text`, `lastPrompt`, `thinking`,
  `stdout`, `stderr`, and attachment payloads
- `cwd`, `entrypoint`, filenames, diff lines, media blobs, and command strings
- linkable ids such as `sessionId`, `uuid`, `parentUuid`, `promptId`,
  `requestId`, `toolUseID`, and `leafUuid`

Future importer PRs may persist hashed ids or counters, but public output should
remain ref-based and public-safe.

## Next Implementation Slices

1. Add filesystem discovery and DB import for synthetic and copied-local Claude
   project roots.
2. Project parsed sessions into `claude_sessions`, `claude_safe_text_fts`, and
   the event-content/prepared-state substrate.
3. Wire `lco index claude` and zero-config first-run discovery.
4. Add OpenClaw/MCP QA Lab coverage for `claude_session:*` describe, expand,
   and search paths.
