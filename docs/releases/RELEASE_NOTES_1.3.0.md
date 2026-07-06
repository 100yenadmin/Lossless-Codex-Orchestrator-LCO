# Release Notes 1.3.0

`1.3.0` is the post-sprint feature release candidate for the LCO M12 QA Lab
and real-product hardening lane. It improves retrieval quality, indexing
performance, JSONL drift visibility, prepared-state cards, and tool exposure
profiles while keeping the 1.2 claim boundary unchanged.

About `1.2.6`: the stable patch was published mid-flight as an append-delta
release. Its package artifact contains the same main-branch sprint content
available at publication time, while its release notes cover only the
append-delta change. `1.3.0` is the semver-correct, fully documented feature
release for the sprint.

This remains Codex-first local orchestration.

## What Changed

- Field-weighted search ranking now uses multi-column FTS across title,
  summary, plans, finals, files, tool metadata, and body text. Results include
  BM25 weights, a recency blend, real relevance scores, per-field match
  attribution, AND-to-OR query degradation, identifier prefix matching, and an
  explicit truncation reason when queries exceed the 32-term cap. The golden
  retrieval eval set now ratchets all current families to `1.0` floors.
- Indexing performance now skips unchanged files without content reads by using
  extractor-state cache checks, selects newest files first when `--max-files`
  applies, reports dropped-oldest counts, pins FTS writes to session rowids to
  avoid the unreleased O(n^2) delete-scan regression window, and adds hot-path
  SQLite indexes. `loo index bench` exists as an internal maintainer command,
  not as a public release claim.
- Codex JSONL drift detection now surfaces per-file public-safe structured
  drift reports for unknown contentful kinds, unparsed lines, and missing fields
  through `loo doctor`. `dynamic_tool_call_response` payload output is also
  extracted into the safe searchable text path.
- Append-delta Codex JSONL indexing now re-parses only appended bytes for live
  session files when the indexed prefix is unchanged and the derived-cache
  invariants still match. Full re-parse remains the correctness fallback for
  prefix rewrites, drift, malformed appended JSONL, mismatched thread state, or
  any ambiguous cache condition.
- Prepared cards now carry deterministic real-work state. `objective`,
  `blocker`, and `nextAction` are derived from the latest plan, final, and
  attention signals with source reason codes and low-confidence downgrades.
  `thread_name_updated` events are captured for fresher title routing.
- Opt-in retrieval telemetry harvesting can propose local golden-scenario
  candidates from search-to-describe/expand behavior. It requires explicit
  telemetry enablement and session correlation, emits public-safe aggregate
  metrics, keeps proposal files marked non-public-safe for manual curation, and
  reports bounded sampling/truncation instead of implying full-population
  coverage.
- Tool exposure profiles are available through
  `LOO_TOOL_PROFILE=facade|standard|all`. The default remains `all`, preserving
  existing behavior. The public facade has tested `lco_*` aliases for the eight
  public-facade tools; aliases carry `metadata.aliasOf` and are excluded from
  coverage denominators. Invalid profile values warn and fall back instead of
  crashing.
- Post-sprint integration-audit hardening is included: the ranked-search JOIN
  now uses the same pinned session-rowid invariant as the FTS write path (with
  a corruption regression test), `loo_doctor` is exposed at the `standard`
  profile tier so the agent playbook's first step works under restricted
  profiles, `loo doctor` on a never-indexed database reports a friendly
  first-run state instead of `schema_missing`, retrieval golden scenarios now
  ship with their fixture corpus so the packaged strict eval runs out of the
  box (missing corpora fail closed with `corpus_missing` instead of silent
  zero scores), stale source-file rows are pruned so drift status cannot cite
  deleted files, and redundant FTS backfill gates were consolidated with the
  legacy-table rowid repair moved into migration.
- Release notes are archived under `docs/releases/`, with
  `docs/releases/CHANGELOG.md` as the per-version index.

## Current Claim Scope

Claim scope: `codex-read-search-expand-dry-run`.

Allowed stable claim:

> Collaborate with local Codex sessions through OpenClaw using local indexing,
> prepared-state recall, bounded expansion, and approval-gated dry-run/control
> boundaries.

The 1.2 claim scope is unchanged. LCO continues to claim Codex-first local
orchestration for indexing, search, describe/expand, prepared-state recall,
approval-gated dry-run/control boundaries, and bounded OpenClaw/MCP surfaces.
This release candidate does not add a new live-control, GUI, parity, sync,
customer-readiness, or enterprise-security claim.

## Carried-Forward Desktop Proof Boundary

The Desktop proof-action hardening from #160 is still included. The public tool
surface includes `loo_desktop_proof_action` and the CLI command
`loo desktop proof-action`, but they remain bounded to the same proof boundary as beta.35: a CUA Driver TextEdit scratch proof only. The exact tuple is:
exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`.

A generic gateway invocation without exact proof args fails closed. The expected
OpenClaw failure shape is `openclaw_tool_result_not_ok:<tool>` with
`output.details.ok: false`; it is not proof of generic GUI mutation.

## Release Gate Notes

- M12 tracker: #513.
- Candidate package: `lossless-openclaw-orchestrator@1.3.0`.
- Expected npm dist-tag after explicit publish approval: `latest`.
- Expected git tag after explicit tag approval: `v1.3.0`.
- This draft PR is a release-candidate preparation step only. It does not publish to npm and does not create a GitHub Release; it also does not create or move a tag, move any dist-tag, run live Codex control, or mark the release ready.
- Merge is gated on the orchestrator's whole-sprint audit verdict.
- Example release status with all required non-GUI approvals:
  `loo release status --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --approved-live-control-evidence <live-control.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Reduced-scope read/search/expand/dry-run status example:
  `loo release status --claim-scope codex-read-search-expand-dry-run --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Working-app or live-control claim attempts without exact approved
  live-control proof must continue to report
  `approved_live_control_smoke_missing`.

## Explicit Non-Claims

No new live Codex control smoke is run by this release candidate.
It does not run generic GUI mutation and does not run Codex GUI mutation.
No automatic gateway authorization.
No broad gateway scope approval. No prompt typing. No clicking. No arbitrary app control.
No screenshots or videos are part of the public release evidence.
Claude Code remains an adapter stub, not an adapter-equivalence claim.
No true Codex compaction-summary capture.
No raw model compaction by default and no default model access to raw transcript
or current `safe_text`.
No raw transcript upload and no OpenClaw LCM merge.
No source-store mutation.
No Notion, support-control, Stripe, or Company Brain P1 adapter proof.
No cloud sync.
No unattended desktop takeover.
No release-grade enterprise security or customer-ready security claim.
