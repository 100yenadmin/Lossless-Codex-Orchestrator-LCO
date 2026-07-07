# Release Notes 1.4.3

`1.4.3` is a focused search/index UX patch for the 1.4 identity line. It ships
the merged #643 and #640 fixes without widening the public claim boundary.
This remains Codex-first local orchestration.

## What Changed

- Raised default Codex JSONL indexing caps from the old small-file defaults to
  better cover long autonomous sessions.
- Persisted and surfaced limited/skipped Codex files in the local LCO database,
  `lco index codex` warnings, MCP index results, and `lco doctor`.
- Added public-safe recovery guidance for capped files, including explicit
  larger-limit retry commands.
- Clarified that `lco search` / `loo search` is title, metadata, and
  session-card discovery rather than raw-content FTS.
- Routed remembered content phrases toward `lco grep` and `lco expand-query`
  in README/setup/QA docs and search help.
- Kept successful zero-result search output machine-friendly: non-interactive
  CLI calls still return JSON `[]` on stdout and leave stderr empty.

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
- This release does not add raw-content FTS or embeddings; that remains a
  separate recall improvement lane.

Desktop proof-action hardening from #160 remains in force. The
`loo_desktop_proof_action` / `loo desktop proof-action` lane is limited to the
approved CUA Driver TextEdit scratch proof and records the exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`. Generic gateway invocation without exact proof args fails closed and does not claim arbitrary GUI mutation.
Generic gateway invocation without exact proof args fails closed with `openclaw_tool_result_not_ok:<tool>`, `output.details.ok: false`, and the same proof boundary as beta.35.

Live control stays fail-closed: without an approved live-control smoke for the
exact target thread and harmless prompt, a stable release bundle records
`approved_live_control_smoke_missing` as the blocker and does not claim live
control. Scratch-thread live smokes remain a standing-approved class; real user
threads still require exact-target approval.

## Validation

- #643 focused tests covered index-cap persistence, warnings, doctor health, and
  public-safe output boundaries.
- #640 focused tests covered search help, zero-result machine output, bounded
  search, docs truth, and public-safe path canaries.
- `npm run check` must pass before publication.
- GitHub CI, CodeQL, CodeRabbit, and evaOS review gates must be clean before
  the release prep PR merges.

## Release Gate Notes

- Candidate packages: `lossless-codex-orchestrator@1.4.3` (canonical) and
  `lossless-openclaw-orchestrator@1.4.3` (maintained compat).
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
