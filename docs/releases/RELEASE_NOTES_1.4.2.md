# Release Notes 1.4.2

`1.4.2` is a focused Codex recall patch for the 1.4 identity line. It fixes a
final-message extraction bug where compacted output or tool-call output could
populate `final_message` and the weighted `codex_search_fts.finals` column on
large or compacted sessions. The public claim boundary is unchanged from
`1.4.1`. This remains Codex-first local orchestration.

## What Changed

- Codex final-message extraction now only accepts assistant prose payloads.
- Compacted output and `function_call_output` text still remain available in
  bounded recall body text, but they can no longer overwrite or synthesize the
  session final message.
- Regression coverage now pins three cases:
  - tool/compaction noise after a real assistant final,
  - tool-only compacted sessions with no assistant final,
  - assistant prose fallback finals when no explicit final marker is present.

## Current Claim Scope

Claim scope: `codex-read-search-expand-dry-run` (unchanged).

Allowed stable claim:

> Collaborate with local Codex sessions through OpenClaw, or any MCP client,
> using local indexing, prepared-state recall, bounded expansion, and
> approval-gated dry-run/control boundaries.

## Proof Boundary

Do not claim:

- Claude Code parity. Claude Code remains an adapter stub, not an
  adapter-equivalence claim.
- No cloud sync.
- No unattended desktop takeover.
- No release-grade enterprise security.
- No automatic gateway authorization.
- No broad gateway scope approval, no prompt typing, no clicking, and no arbitrary app control.
- No new live Codex control smoke is run by this release.
- This release does not run generic GUI mutation and does not run Codex GUI mutation.

Desktop proof-action hardening from #160 remains in force. The
`loo_desktop_proof_action` / `loo desktop proof-action` lane is limited to the
approved CUA Driver TextEdit scratch proof and records the exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`. Generic gateway invocation without exact proof args fails closed with `openclaw_tool_result_not_ok:<tool>`,
`output.details.ok: false`, and the same proof boundary as beta.35.

Live control stays fail-closed: without an approved live-control smoke for the
exact target thread and harmless prompt, a stable release bundle records
`approved_live_control_smoke_missing` as the blocker and does not claim live
control. Scratch-thread live smokes remain a standing-approved class; real user
threads still require exact-target approval.

## Validation

- Focused Codex extraction tests covered plans, finals, touched files, summary
  leaves, prepared source ranges, and extraction evals.
- `tests/codex-index.test.ts` covered the merged regression cases and passed
  after review hardening.
- GitHub CI and CodeQL passed on the merged fix PR.
- CodeRabbit actionable feedback was addressed; evaOS review completed and all
  review threads were resolved before merge.

## Release Gate Notes

- Candidate packages: `lossless-codex-orchestrator@1.4.2` (canonical) and
  `lossless-openclaw-orchestrator@1.4.2` (maintained compat).
- Both packages should be published from the same source tree and verified from
  the registry before the GitHub Release is finalized.
- Claim scope remains `codex-read-search-expand-dry-run`; no widened claims.

Full live-control release-status example, for releases that include approved
live-control proof:

```bash
lco release status --evidence-dir <release-status-evidence-dir> --candidate-sha <release-candidate-sha> --approved-live-control-evidence <release-status-evidence-dir>/approved-live-control-smoke.json --npm-publish-approval-evidence <release-status-evidence-dir>/npm-approval.json --github-release-approval-evidence <release-status-evidence-dir>/github-release-approval.json --github-ci-evidence <release-status-evidence-dir>/github-ci.json --codeql-evidence <release-status-evidence-dir>/codeql.json --strict
```

Reduced-scope read/search/expand/dry-run release-status example, where live
control remains excluded and visible:

```bash
lco release status --claim-scope codex-read-search-expand-dry-run --evidence-dir <release-status-evidence-dir> --candidate-sha <release-candidate-sha> --npm-publish-approval-evidence <release-status-evidence-dir>/npm-approval.json --github-release-approval-evidence <release-status-evidence-dir>/github-release-approval.json --github-ci-evidence <release-status-evidence-dir>/github-ci.json --codeql-evidence <release-status-evidence-dir>/codeql.json --strict
```
