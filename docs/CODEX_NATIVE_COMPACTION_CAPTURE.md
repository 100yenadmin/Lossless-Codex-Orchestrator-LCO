# Codex-Native Compaction Capture Proposal

## Current Limitation

LCO can run an outside-Codex hook sidecar around compaction lifecycle events.
That sidecar can record bounded `PreCompact/PostCompact` markers, thread refs,
lifecycle, hashes, and omission reasons. It cannot honestly capture the generated summary because the summary is produced inside Codex after history
replacement decisions that the sidecar does not own.

Today, a sidecar packet may say:

- compaction was observed
- lifecycle was `pre_compact` or `post_compact`
- the packet wrote LCO-owned derived cache only
- `summaryCaptured` and `trueCompactionSummaryCaptured` are false
- the generated summary is unavailable outside Codex

It must not say that the compaction summary was captured.

## Proposed Codex-Native Packet

Codex should expose either a new sanitized `CompactionCaptured` packet or an
enriched `PostCompact` packet after the compaction summary exists. LCO should
treat this as a future adapter contract, not as a current sidecar capability.

Required packet fields:

- packet kind: `CompactionCaptured` or enriched `PostCompact`
- stable compaction id and opaque thread/session refs
- lifecycle timestamp and source model/extractor version
- summary hash, preferably SHA-256 over the generated summary text
- bounded summary excerpt with a declared character or token cap
- token count for the generated summary or excerpted summary fragment
- source refs to opaque Codex events, turns, or ranges that informed the summary
- privacy class and public-safe status
- omissions, including any source ranges, turns, or private fields excluded
- action flags proving no live control, GUI mutation, external write, source
  store mutation, raw transcript read, or model compaction run by LCO

The bounded summary excerpt is not source authority. It is only enough for LCO
to create an advisory summary leaf with refs and omissions.

## Rejection Rules

LCO must reject any proposed compaction-summary packet that includes:

- raw replacement history
- raw transcript text
- transcript path fields
- SQLite paths or row dumps
- screenshots, tokens, cookies, credentials, or customer data
- instructions to rewrite Codex-owned history
- unbounded summary text
- source refs that cannot be represented as opaque refs

These rejection rules preserve the no-history-rewrite and bounded-fragment
rules. LCO storage remains an LCO-owned sidecar. It must not mutate Codex source
stores, rewrite Codex history, or make the LCO derived cache authoritative.

## Advisory Summary Leaf Mapping

When a future Codex-native sanitized packet passes the rejection rules, LCO may
materialize an advisory summary leaf:

- `leaf_kind`: `codex_compaction_summary`
- `summary_text`: bounded excerpt only
- `input_hash`: hash of the sanitized packet payload
- `output_hash`: summary hash from the packet
- `source_refs`: opaque thread/event/range refs from Codex
- `source_range_refs`: opaque range refs when supplied
- `privacy_class`: public-safe metadata or stricter
- `omission_status`: explicit omissions from the packet
- `authority_coverage`: advisory, not source authority

If the packet has only a marker and no sanitized summary payload, LCO should
create at most a marker leaf or marker packet with `summaryCaptured: false`.

## Claim Boundary

Current public claim: the public claim remains `compaction observed`.

LCO may claim true Codex-native compaction-summary capture only after Codex
ships a sanitized packet or contributor that satisfies this proposal and the
scenario fixture `codex-native-compaction-capture-proposal-v1`.

Until then:

- outside-Codex hooks record marker lifecycle only
- generated summary text stays unavailable to LCO
- LCO may hash/redact hook inputs but must not infer the summary
- summary leaves created from markers must carry refs and omissions
- release, README, scorecard, and issue language must stay on observed-only
  wording
