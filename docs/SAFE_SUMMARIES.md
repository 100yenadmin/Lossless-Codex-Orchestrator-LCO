# Safe Summary Contract

Safe summaries are local-only recall text for helping an orchestrator agent decide which Codex session to inspect next. They are not a replacement for the raw local Codex session file, and they are not a public artifact.

The beta summary line is deterministic and bounded. It may combine title, model, branch/Git SHA, redacted CWD, final handoff text, first proposed plan, touched-file hints, and tool names so an orchestrator can route before requesting a larger expansion.

## May Contain

- Thread title, thread id, model, branch, git SHA, and redacted working directory.
- Final assistant/status message when it is useful for handoff.
- Proposed plan blocks after whitespace normalization and credential redaction.
- Touched file refs, including repo-relative paths and Lexar repo paths.
- Tool-call names and redacted argument metadata.
- Source refs back to the local session file or database row.
- Source-prefixed recall refs, currently `codex_thread:*` and `lcm_summary:*`.

## Must Not Contain

- Raw Codex transcripts beyond bounded extracted evidence.
- API keys, bearer tokens, basic auth values, authorization headers, cookie values, or private key material.
- Unredacted generic home paths such as `/Users/name/...`; these become `~/...`.
- Raw customer data copied only because it appeared in a transcript.
- Any uploaded or cloud-synced local session content by default.

## Expansion Boundary

`lco_expand_session`, `lco_expand_query`, and `lco_grep -> lco_describe_ref -> lco_expand_query` return bounded evidence briefs. The beta profiles are:

- metadata-only: source refs, ids, counts, timestamps, paths, and other routing metadata without expanded content.
- 1k token brief: quick status, final message, touched files, and first extracted plans when they fit.
- 4k token evidence bundle: the same safe fields with a larger budget for plan and evidence detail.

Profiles are generated from indexed safe text, Codex metadata, and optionally read-only OpenClaw LCM peer summaries. LCM peer summaries stay in their source DB and are referenced by `lcm_summary:*`; they are not merged into the Codex index. If an agent needs raw source context, it should request a specific local source ref and preserve user approval and privacy boundaries.

## Prepared Source Ranges

The 1.2 prepared-state foundation adds source-range metadata as LCO-owned
derived cache. A prepared source range is an opaque pointer with `codex_event:*`,
`codex_range:*`, and `codex_source:*` refs, hashes, line/byte offsets, extractor
version, privacy class, confidence, and omission status. It is not transcript
text and should not expose absolute transcript paths, raw prompts, tool payloads,
SQLite row dumps, tokens, cookies, or secrets.

Summary leaves and prepared cards may later cite these ranges, but the ranges
themselves remain advisory routing metadata. They do not replace Codex source
truth and they do not authorize live control, GUI mutation, model compaction, or
compaction-summary capture.
