# Release Notes 1.4.1

`1.4.1` is the polish patch for the 1.4 identity line. It fixes the flagship new
package's version reporting, flips public docs to the now-published
`lossless-codex-orchestrator` name, and keeps npm package artifacts aligned with
the public-safe release boundary. This remains Codex-first local orchestration.

## What Changed

- Fixed the new package (`lossless-codex-orchestrator`) reporting an `unknown`
  version from neutral working directories. The CLI package-root resolution now
  accepts both package names (`lossless-codex-orchestrator` and the compat
  `lossless-openclaw-orchestrator`) via a shared identity helper, so
  `lco --version`, `lco onboard status`, and release/QA gates resolve correctly
  whichever package a user installed.
- Public docs now lead with `npm install -g lossless-codex-orchestrator` and the
  `lco` bin. `lossless-openclaw-orchestrator` and the `loo` bin are documented
  as maintained compatibility aliases.
- The npm package allowlist now excludes raw-ish retrieval JSONL fixtures and
  local media assets while keeping public-safe scenario and scorecard examples.
- README/VISION current-stable copy now reflects `1.4.1`.

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
approved CUA Driver TextEdit scratch proof and records the exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`.
Generic gateway invocation without exact proof args fails closed with
`openclaw_tool_result_not_ok:<tool>`, `output.details.ok: false`, and the same proof boundary as beta.35.

Live control stays fail-closed: without an approved live-control smoke for the
exact target thread and harmless prompt, a stable release bundle records
`approved_live_control_smoke_missing` as the blocker and does not claim live
control. Scratch-thread live smokes remain a standing-approved class; real user
threads still require exact-target approval.

## Release Gate Notes

- Candidate packages: `lossless-codex-orchestrator@1.4.1` (canonical) and
  `lossless-openclaw-orchestrator@1.4.1` (maintained compat).
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
