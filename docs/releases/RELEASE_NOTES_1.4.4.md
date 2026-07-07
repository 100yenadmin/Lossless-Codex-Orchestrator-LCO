# Release Notes 1.4.4

`1.4.4` is a focused proof-gate hardening patch for the 1.4 identity line. It
ships the merged #645 / PR #660 review-proof fixes without widening the public
claim boundary. This remains Codex-first local orchestration.

## What Changed

- Hardened `lco openclaw published-smoke` binary-probe recovery so generated
  recovery evidence executes the integrity-verified candidate package CLI from
  the extracted npm tarball and records `resolvedBinarySource: "package_exec"`.
- Kept metadata-only `package_tarball` probes fail-closed with
  `binary_probe_candidate_version_mismatch`; package.json-only tarball metadata
  no longer satisfies package-path readiness.
- Added semver-shaped validation before embedding package versions into emitted
  shell recovery fragments.
- Closed historic review-thread proof gaps around release-demo artifact
  symlink handling, post-action refresh target binding, prepared-card target
  coverage, notification ordering, hook-sidecar title-finalizer negation, and
  local Mac UI secret redaction.

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

Live control stays fail-closed: without an approved live-control smoke for the
exact target thread and harmless prompt, a stable release bundle records
`approved_live_control_smoke_missing` as the blocker and does not claim live
control. Scratch-thread live smokes remain a standing-approved class; real user
threads still require exact-target approval.

Desktop proof-action hardening from #160 remains in force. The
`loo_desktop_proof_action` / `loo desktop proof-action` lane is limited to the
approved CUA Driver TextEdit scratch proof and records the exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true`. Generic gateway invocation without exact proof args fails closed with `openclaw_tool_result_not_ok:<tool>`, `output.details.ok: false`, and the same proof boundary as beta.35. It does not claim arbitrary GUI mutation.

## Validation

- PR #660 current-head validation passed:
  - focused affected bundle: 92/92 passing;
  - `npm run check`: 969/969 passing;
  - GitHub CI test, CodeQL, CodeQL javascript-typescript, and CodeRabbit green.
- Post-merge scoped validation on `main` passed:
  - `node --test --import tsx tests/hook-sidecar.test.ts tests/published-package-smoke.test.ts tests/release-demo-status.test.ts tests/openclaw-post-action-refresh-smoke.test.ts tests/prepared-cards.test.ts` -> 92/92 passing.
- GitNexus was refreshed at merge commit `d1dfebd`.

## Release Gate Notes

- Candidate packages: `lossless-codex-orchestrator@1.4.4` (canonical) and
  `lossless-openclaw-orchestrator@1.4.4` (maintained compat).
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
