# LCO Drive Design

## Status and scope

This design implements issue #740 inside the approved 1.6 Control Plane release train. It adds the first review-then-drive-under-audit workflow without widening Claude live-control, generic GUI mutation, unattended autonomy, or non-sacrificial live-control claims.

The 1.6 deliverable is a public-safe, bounded workflow shared by CLI, MCP, and the OpenClaw facade. Dry-run is the default and works without transport mutation. A live request remains blocked unless it is Codex-targeted, explicitly approved, bound to the exact dry-run audit record, and separately proven on a disposable target during QA.

## Considered approaches

1. **CLI-only orchestration.** This is small, but MCP/OpenClaw would duplicate the workflow and drift from the command.
2. **MCP-only orchestration.** This gives agent access, but makes the customer-facing `lco drive` command a thin remote client and complicates clean-install use.
3. **Shared adapter workflow with thin surfaces.** A pure, dependency-injected drive runner lives beside target controls; CLI and MCP call the same contract, and OpenClaw receives it through the generated MCP/plugin facade.

Approach 3 is selected because it gives one safety contract, one report schema, and surface parity without requiring a transport for dry-run tests.

## Public interface

`lco drive` accepts:

- `--reviewer codex|claude`
- `--driver codex|claude`
- `--target-ref codex_thread:<id>|claude_session:<id>`
- `--objective <text>`
- `--surface cli` (optional explicit CLI provenance marker; other values are rejected)
- `--max-turns 1..20` (default `4`)
- `--token-budget 100..8000` (default `1000`)
- `--timeout-ms 1000..600000` (default `120000`)
- `--cost-ceiling-usd 0..100` (default `1`)
- `--audit-path <path>`
- `--dry-run` (required behavior in 1.6; omission also defaults to dry-run)

The canonical MCP tool is `lco_drive`; `loo_drive` is the compatibility alias. It accepts equivalent snake-case workflow and budget fields, but no caller-selectable surface field. CLI, MCP server, and native OpenClaw wrappers inject trusted invocation provenance, and the controller matrix marks all unobserved surfaces `not_probed`. OpenClaw exposes the same generated facade rather than a separate implementation.

## Workflow and data flow

The shared runner validates the target namespace, harness assignment, and all budgets before writing an audit record. It hashes the objective and emits no raw objective or prompt text.

The report contains:

1. A review packet describing the reviewer assignment, target, objective hash, checks, and budgets.
2. A deterministic drive plan with `review`, `plan`, `dry_run`, `confirm`, `live`, and `report` steps. Every step has an execute flag, budget snapshot, audit-TTL freshness state, and approval state/binding.
3. A real target-adapter dry-run packet. Codex uses `createCodexControl().sendMessage({dryRun:true})`; Claude uses `createClaudeDryRunControl().resumePrompt({dryRun:true})` after an availability probe.
4. A controller matrix for CLI, MCP, OpenClaw, Codex, and Claude dry-run reachability based only on trusted wrapper provenance and observed adapter state.
5. A bounded final report with blockers, audit/hash binding, live-action count, actions performed, next safe commands, and proof boundary.

No loop executes in the dry-run path. `maxTurns`, token, time, and cost are plan constraints, not permission to act.

## Safety and errors

- Driver and target namespace must match exactly.
- Invalid or sensitive-looking target refs and objectives fail before audit mutation.
- Claude unavailable/unsupported status returns a public-safe blocked report.
- The dry-run report always records `liveActions: 0`, `externalWrites: 0`, and `guiMutations: 0`.
- A supplied live/approval request is rejected by the 1.6 command until the separate sacrificial runtime lane invokes the existing approved Codex control machinery.
- Errors and reports never include raw prompts, local paths, credentials, audit keys, or transcript content.

## Testing and proof

- Unit tests cover validation, budgets, deterministic plans, Codex and Claude dry-run packets, blocked Claude status, objective redaction, and zero-action invariants.
- CLI tests cover help, JSON output, parser failures, default dry-run, and nonzero strict/blocked behavior.
- MCP/tool-profile/manifest tests prove canonical and compatibility exposure plus handler parity.
- QA Lab workflow tests exercise the tool through a fake OpenClaw gateway.
- Broad `npm run check`, current-head CI/CodeQL/review closure, clean package smoke, and approved sacrificial Codex proof remain release gates.

## Proof boundary

This feature may claim an audited, bounded review/drive dry-run workflow across the tested public surfaces. It may not claim Claude live control, autonomous multi-turn execution, generic GUI control, or non-sacrificial live safety until separate current-release runtime evidence exists.
