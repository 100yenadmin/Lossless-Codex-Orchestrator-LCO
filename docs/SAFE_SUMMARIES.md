# Safe Summary Contract

Safe summaries are local-only recall text for helping an orchestrator agent decide which Codex session to inspect next. They are not a replacement for the raw local Codex session file, and they are not a public artifact.

## May Contain

- Thread title, thread id, model, branch, git SHA, and redacted working directory.
- Final assistant/status message when it is useful for handoff.
- Proposed plan blocks after whitespace normalization and credential redaction.
- Touched file refs, including repo-relative paths and Lexar repo paths.
- Tool-call names and redacted argument metadata.
- Source refs back to the local session file or database row.

## Must Not Contain

- Raw Codex transcripts beyond bounded extracted evidence.
- API keys, bearer tokens, basic auth values, authorization headers, cookies, or private keys.
- Unredacted generic home paths such as `/Users/name/...`; these become `~/...`.
- Raw customer data copied only because it appeared in a transcript.
- Any uploaded or cloud-synced local session content by default.

## Expansion Boundary

`loo_expand_session` and `loo_expand_query` return bounded evidence briefs. The beta profiles are approximately:

- 1k token brief: quick status, final message, touched files, and first extracted plans when they fit.
- 4k token evidence bundle: the same safe fields with a larger budget for plan and evidence detail.

Both profiles are generated from indexed safe text and metadata. If an agent needs raw source context, it should request a specific local source ref and preserve user approval and privacy boundaries.
