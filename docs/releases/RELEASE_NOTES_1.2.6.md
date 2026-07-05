# Release Notes 1.2.6

`1.2.6` is an M12 GA-assurance patch for the LCO 1.2 stable train. It keeps
the 1.2 claim boundary unchanged and ships append-delta indexing for append-only
Codex JSONL session files so live session indexing can avoid a full reparse when
the indexed prefix is unchanged and the derived-cache invariants are intact.

This remains Codex-first local orchestration.

## What Changed

- Adds append-delta Codex JSONL indexing for live append-only session files.
- Uses the delta path only when the source watermark, extractor versions, prefix
  hash, newline boundary, thread id, safe-text cap, event count, and prepared
  source event/ordinal counts all match the existing indexed state.
- Falls back to full reparse for prefix rewrites, prior JSONL drift, capped safe
  text, malformed appended JSONL, thread-id mismatch, event-limit mismatch,
  prepared-source count drift, or any ambiguous cache state.
- Preserves rowid-pinned FTS behavior, source refs, prepared source ranges,
  summary leaves, session metadata clears, explicit titles/finals, touched
  files, and tool-call metadata across append updates.
- Keeps public outputs bounded and opaque: no raw transcript text, raw local
  paths, SQLite rows, screenshots, cookies, tokens, or source-store mutation are
  introduced by this patch.

## Current Claim Scope

Claim scope: `codex-read-search-expand-dry-run`.

Allowed stable claim:

> Collaborate with local Codex sessions through OpenClaw using local indexing,
> prepared-state recall, bounded expansion, and approval-gated dry-run/control
> boundaries.

This release improves indexing performance/correctness for append-only Codex
JSONL files. It does not broaden the runtime, control, GUI, Claude, customer, or
enterprise-security proof boundary.

## Carried-Forward Desktop Proof Boundary

The Desktop proof-action hardening from #160 is still included. The public tool
surface includes `loo_desktop_proof_action` and the CLI command
`loo desktop proof-action`, but they remain bounded to the same proof boundary as beta.35: a CUA Driver TextEdit scratch proof only. The exact tuple is:
exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`.

A generic gateway invocation without exact proof args fails closed. The expected
OpenClaw failure shape is `openclaw_tool_result_not_ok:<tool>` with
`output.details.ok: false`; it is not proof of generic GUI mutation.

## Release Gate Notes

- Parent M12 tracker: #513.
- Append-delta issue: #575.
- Append-delta PR: #576.
- Patch release issue: #578.
- Baseline stable release: `v1.2.5`.
- Candidate package: `lossless-openclaw-orchestrator@1.2.6`.
- Expected npm dist-tag: `latest`.
- Expected git tag: `v1.2.6`.
- Example aggregate GA smoke gate:
  `loo release ga-smoke --package-version 1.2.6 --candidate-sha <sha> --evidence-dir <public-safe-evidence> --strict`.
- Example release status with all required non-GUI approvals: `loo release status --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --approved-live-control-evidence <live-control.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Reduced-scope read/search/expand/dry-run status example: `loo release status --claim-scope codex-read-search-expand-dry-run --candidate-sha <sha> --github-ci-evidence <ci.json> --codeql-evidence <codeql.json> --npm-publish-approval-evidence <npm-approval.json> --github-release-approval-evidence <github-release-approval.json> --strict`.
- Working-app or live-control claim attempts without exact approved live-control proof must continue to report `approved_live_control_smoke_missing`.
- `loo release ga-smoke` writes `release-ga-smoke.json`; it does not publish to npm, does not create tags, does not create a GitHub Release, does not run live Codex control, does not mutate a desktop GUI, and does not read raw transcripts.
- Required stable gates: focused append-delta tests, full `npm run check`,
  package dry-run, GitHub CI, CodeQL, current-head review threads clear, npm
  publish to `latest`, GitHub Release, post-publish finalization status, fresh
  npm install, OpenClaw dogfood/tool-smoke, scenario/scorecard sweeps, privacy
  scan, and final `loo release ga-smoke --strict`.

## Explicit Non-Claims

No new live Codex control smoke is run by this release.
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
