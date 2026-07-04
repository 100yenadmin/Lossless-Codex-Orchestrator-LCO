# LCO 1.2 Prepared State And Summary Leaves Sprint

## Summary

LCO 1.2 moves the project from "agents can recall Codex sessions on demand" to
"agents can start from prepared, cited local state." The first build lane is a
deterministic, opt-in prepared-state cache for Codex sessions: source ranges,
summary leaves, prepared cards, watcher observations, and bounded expansion.

This is not hidden autonomy. Prepared state is advisory cache, not authority. It
helps Eva and OpenClaw decide what needs attention without rereading huge raw
transcripts, while preserving local privacy, source refs, freshness, confidence,
and approval boundaries.

Model compaction, true Codex compaction-summary capture, and automatic hook
execution are staged follow-ups after the deterministic layer proves privacy,
authority, and performance. The Codex-native compaction proposal is
[docs/CODEX_NATIVE_COMPACTION_CAPTURE.md](../CODEX_NATIVE_COMPACTION_CAPTURE.md)
with dry-run claim-audit fixture
`codex-native-compaction-capture-proposal-v1`; public wording remains
`compaction observed` until sanitized Codex-native packet support exists.

## Durable Plan Contract

- Goal: Design and ship LCO 1.2 foundations for prepared Codex state, summary
  leaves, watcher events, and hook capture without expanding control claims.
- Resume identity: repo `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO`;
  checkout `/Volumes/LEXAR/repos/worktrees/lco-gitnexus-main`; branch
  `issue-lco-1-2-prepared-state-design`; base/head SHA
  `6740b4a9879912b1f9734d79e9bf91c8429e4c77`; tracker and child issue numbers
  are assigned during the filing pass.
- Tracking / source of truth: GitHub milestone, tracker issue, child issues, PRs,
  and CI own implementation truth. `VISION.md` owns product/eval truth. This
  brief owns sprint handoff. Evidence lives under
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-03/lco-1.2-prepared-state-design/`.
- Scope / non-goals: no raw transcript upload, no Codex source-store mutation,
  no OpenClaw LCM merge, no live control, no GUI mutation, no Claude parity, no
  unattended autonomy claim, no npm publish, and no GitHub Release as part of
  design filing.
- Current state: LCO 1.1.4 can index, search, describe, expand, produce cockpit
  reports, and dry-run controls through CLI/MCP/OpenClaw surfaces. The current
  production DB is session-level. The prototype `lossless-codex.sqlite` proves
  an event/summary direction but not a production prepared-state pipeline.
- Exact next action: file the GitHub 1.2 tracker and child issues, then start
  child issue 1 with red tests for design truth, privacy canaries, and stale
  authority boundaries.
- Critical invariants: prepared cards are cache, not authority; every prepared
  item carries source refs, freshness, confidence, privacy class, and authority
  coverage; missing or conflicting truth degrades to `unknown`, `partial`, or
  `low_confidence`; source refs stay opaque and public-safe.
- Execution lanes: design/tracker filing; mutation-class policy split; additive
  event/source-range schema; deterministic summary leaves; prepared cards and
  inbox; watcher observations and local attention queue; hook sidecar capture;
  OpenClaw gateway dogfood; optional model compaction spike; Codex-native
  compaction-summary proposal; beta release gate.
- Validation / eval gates:
  - Eval required: yes
  - Eval claim class: advisory for design, `pr_ready` for child PRs,
    `release_ready` only before beta publish.
  - Required eval suites: schema migration, source-range canaries, summary DAG
    lineage, prepared-card invalidation, watcher determinism, OpenClaw gateway
    dogfood, adversarial privacy/authority/perf review.
  - Eval name/version: `lco-prepared-state-v1`, `summary-leaves-v1`.
  - Dataset/scenario refs: redacted Codex fixtures, huge-thread fixture,
    compaction-marker fixture, OpenClaw gateway smoke.
  - Baseline/comparison: 1.1.4 search/describe/expand/cockpit behavior.
  - Metrics and thresholds: no raw path/text/secret leaks; no duplicate events;
    summary leaves have source ranges or event edges; prepared-card p95 target
    under 100ms on a large DB fixture; bounded expansion stays under caps and
    reports omission markers.
  - Runner/CI location: focused local tests first; GitHub CI and CodeQL for PRs.
  - Failure owner: child issue PR owner.
  - Eval evidence path:
    `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-03/lco-1.2-prepared-state-design/`.
  - Trace feedback target: tracker issue, child issues, scorecards, and
    `VISION.md`.
  - Eval proof boundary: proves local prepared-state recall and routing only,
    not automation authority, unattended control, or true Codex compaction
    capture.
- Proof-claim boundary: 1.2 may claim local prepared Codex state and summary-leaf
  recall for OpenClaw/Eva after gates pass. It must not claim autonomous control,
  broad GUI mutation, full business truth, Claude parity, or true compaction
  summary capture until separately proven.
- Stop conditions: stop on raw transcript/path/secret leakage, model jobs
  receiving unapproved raw or current `safe_text`, stale cache treated as source
  authority, hidden Codex/OpenClaw/GitHub mutation, unbounded watcher cost, or
  ambiguous source joins reported as high confidence.
- Evidence path / packet:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-03/lco-1.2-prepared-state-design/`.

## Product Shape

The 1.2 architecture is additive and layered:

1. Source/event layer: append-only source files, turns, events, and source ranges
   derived from Codex stores without rewriting Codex-owned files.
2. Summary DAG: deterministic leaf summaries over event ranges, plus future
   compaction or rollup summaries linked by parent edges.
3. Prepared state: materialized public-safe cards and inbox items derived from
   summaries, watcher observations, and source coverage.
4. Jobs/watchers: durable idempotent local work with leases, watermarks, and
   execute-false recommendations.

The current session-level tables and tools remain stable while the richer layer
proves itself through additive shadow tables. The production migration must not
rewrite `codex_source_files` primary keys in-place.

## Public Interfaces

New core concepts:

- `SourceRange`: an opaque ref-backed span over a source file, event range, or
  turn range with hashes, privacy class, extractor version, and omission status.
- `SummaryLeaf`: a deterministic routing/evidence card tied to source ranges,
  plans, finals, closeouts, touched files, user prompts, or compaction markers.
- `SummaryEdge`: parent/child lineage for bounded expansion through summary
  leaves.
- `PreparedCard`: public-safe materialized card for a thread, project, blocker,
  next action, or source coverage gap.
- `PreparedInboxItem`: attention item for Eva/OpenClaw with freshness,
  confidence, reason codes, authority coverage, and execute-false next steps.
- `WatcherObservation`: persisted observation from read-only watcher specs.
- `HookCapturePacket`: bounded sidecar capture from Codex hook events.
- `CompactionMarker`: record that Codex compaction happened; outside-Codex
  capture cannot claim the compaction summary unless Codex provides a sanitized
  summary packet.

New tool candidates:

- `loo_prepared_state_status`
- `loo_prepared_inbox`
- `loo_prepared_cards`
- `loo_summary_leaves`
- `loo_summary_expand`
- `loo_watcher_events`

Targeted prepared-state reads may pass a thread id to
`loo_prepared_state_status`, `loo_prepared_cards`, or `loo_prepared_inbox`.
Those reads return advisory `targetCoverage` with opaque refs, freshness,
coverage counts, and reason codes such as `source_present_not_indexed` or
`active_session_pending_index` when the indexed source exists but prepared rows
are missing. They must not expose transcript paths, raw prompts, tool payloads,
or Desktop/app-server previews.

Hook sidecar CLI:

- `loo hook closeout-capture`
- `loo hook state-prep`
- `loo hook compaction-capture --mode marker`

The OpenClaw plugin must keep MCP/OpenClaw tools inherited from the shared
registry. Hook sidecar commands are CLI entrypoints that write only LCO-owned
derived cache; they do not create a second plugin registry and they do not claim
true Codex compaction-summary capture.

## Milestone Issue Graph

Tracker: `LCO 1.2: Prepared State, Summary Leaves, And Watcher Foundations`.

Child issues:

1. Design truth packet, scorecard update, and adversarial review closeout.
2. Mutation-class policy split: source mutation, derived-cache mutation,
   external mutation, and live-control mutation.
3. Additive SQLite event/source-range schema and migration fixture.
4. Deterministic summary leaves from user prompts, plans, finals, closeouts,
   touched files, and compaction markers.
5. Prepared cards and inbox materialization with stale, partial, unknown, and
   low-confidence states.
6. Persisted watcher observations and local attention queue, execute-false only.
7. Hook sidecar capture for closeouts, state prep, and compaction markers.
8. OpenClaw gateway dogfood scenario using only prepared-state tools.
9. Optional local model compaction spike, gated behind explicit config and
   canary tests.
10. Codex-native compaction-summary capture proposal or adapter, separate from
    the LCO public claim; issue #415 uses
    [docs/CODEX_NATIVE_COMPACTION_CAPTURE.md](../CODEX_NATIVE_COMPACTION_CAPTURE.md)
    and `codex-native-compaction-capture-proposal-v1` to require sanitized
    `CompactionCaptured` or enriched `PostCompact` packets before advisory
    summary leaves can claim refs, omissions, summary hash, excerpt, or token
    count.
11. Beta release gate and public-claim audit.

## Adversarial Review Summary

The reviewed design should not proceed as one all-up autonomy feature. The safe
first milestone is narrower: deterministic prepared-state cache, additive DB
tables, explicit privacy/authority fields, and performance proof.

Required mitigations:

- Treat current `safe_text` as local recall text, not safe model input.
- Split read-only language into source mutation, derived-cache mutation,
  external mutation, and live-control mutation.
- Avoid always-on full-file scans; use streaming/incremental watermarks,
  backpressure, caps, and visible stale/partial states.
- Keep hooks as sidecar captures until separate approval gates prove they cannot
  mutate Codex source stores or external systems.
- Make model compaction opt-in and never feed it raw transcript or current
  `safe_text` by default.
- Make prepared state advisory; authoritative sources must be refreshed before
  release, PR, CI, customer, runtime, or live-control claims.

## Test And Eval Plan

Red tests first:

- raw path/token/private-text canaries
- stale prepared cache claiming authority
- ambiguous source refs marked high confidence
- unbounded summary expansion
- hidden live action or GUI mutation
- model input receiving raw transcript or current `safe_text`

Fixture and integration tests:

- huge JSONL dominated by tool calls, where default extraction ignores raw tool
  payloads and keeps only metadata/ref ranges
- compaction markers without summaries, proving the claim is "observed" rather
  than "captured"
- closeout hook capture from bounded `last_assistant_message`
- source-range expansion and summary DAG acyclicity
- OpenClaw gateway path:
  `loo_prepared_inbox -> loo_prepared_cards -> loo_summary_expand`

Performance tests:

- large fixture import
- append/truncate/rotate handling
- prepared-card query latency
- bounded expansion latency

## Assumptions

- Prepared-state first is the 1.2 build spine.
- Summary leaves are routing and evidence cards, not truth.
- Outside Codex, compaction hooks can record markers only; true summary capture
  needs a Codex-native sanitized event or contributor.
- Model compaction is P1/P2, opt-in, and cannot receive raw transcript or current
  `safe_text` by default.
