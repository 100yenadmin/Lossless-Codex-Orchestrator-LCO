# Working App Proof Sprint

Milestone 7 moves LCO from a reduced-scope beta toward an actual working
Codex-first app proof. The sprint source of truth is GitHub milestone
[#8](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/milestone/8)
and tracker issue
[#156](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/156).

## Durable Plan Contract

- Goal: Prove the real user path for a Codex-first local orchestrator: installed
  OpenClaw gateway, live `lco_*` tool calls, approved harmless Codex control,
  refreshed session state, bounded reasoning from safe summaries, and
  action-bound desktop collaboration only where direct protocol is insufficient.
- Resume identity: repo
  `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO`; checkout
  `/Volumes/LEXAR/repos/lossless-openclaw-orchestrator`; milestone
  `Milestone 7: Working App Proof Sprint`; tracker issue #156.
- Tracking / source of truth: GitHub issues/PRs/CI are implementation truth;
  `VISION.md` is product/eval truth; `evals/scenarios/v1.1` is the runtime proof
  contract; public-safe evidence lives under `/Volumes/LEXAR/Codex`.
- Scope / non-goals: Codex-first local working-app proof. Non-goals are Claude
  Code parity, remote sync, broad unattended desktop control, permission bypass,
  release-grade security, and stable/latest promotion.
- Current state: `0.1.x` beta proves read/search/describe/expand/dry-run,
  release packaging, gateway dogfood, one harmless CLI live-control smoke, and
  backend-specific scratch no-focus proofs. It does not yet prove the complete
  installed OpenClaw working-app loop.
- Exact next action: Execute child issues #157 through #162 before promoting any
  runtime-proven app claim; keep #163 as the Claude adapter boundary inventory.
- Critical invariants: local-only by default; public evidence uses counts, refs,
  hashes, statuses, and blocker codes; live actions require matching approval;
  direct Codex protocol precedes GUI fallback; desktop proof is action-bound.
- Execution lanes: runtime proof runner (#157), gateway live Codex proof (#158),
  post-action refresh/reasoning (#159), desktop collaboration proof (#160),
  connected local UI proof (#161), runtime claim gate (#162), Claude inventory
  (#163).
- Validation / eval gates:
  - Eval required: yes
  - Eval claim class: runtime_safe
  - Required eval suites: working-app runtime proof scenarios, safety bypass
    review, local-agent usability review, retrieval quality review, public-claim
    review, packaging/install review, local Mac search UI review when touched
  - Eval name/version: `working-app-runtime-proof/v1.1`
  - Dataset/scenario refs: `evals/scenarios/v1.1/*`, redacted fixtures, bounded
    local Codex store, installed OpenClaw gateway profile
  - Baseline/comparison: `0.1.x` dry-run beta plus CLI-only live smoke
  - Metrics and thresholds: 100% required proof markers present, zero raw/private
    evidence findings, zero unauthorized live actions, green CI/CodeQL
  - Runner/CI location: focused local runner tests, local OpenClaw gateway smoke,
    GitHub CI/CodeQL
  - Failure owner: active child issue owner
  - Eval evidence path:
    `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/m7-working-app-proof/`
  - Trace feedback target: issue comments, runtime proof reports, scorecards,
    and release claim gates
  - Eval proof boundary: proves only named Codex-first local app surfaces
- Proof-claim boundary: Milestone 7 may claim a runtime-proven Codex-first local
  orchestration path after the named proof markers pass. It must not claim
  adapter parity, broad desktop automation, or enterprise readiness.
- Stop conditions: stop on unauthorized live action, raw/private evidence,
  broad gateway scope ambiguity, Codex approval bypass, desktop focus drift in a
  no-focus claim, or public docs that overclaim.
- Evidence path / packet:
  `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/m7-working-app-proof/`.

## Issue Graph

- #156: Milestone 7 tracker.
- #157: Runtime proof scenario runner and scorecard gates.
- #158: Installed OpenClaw gateway approved live Codex control proof.
- #159: Post-action session refresh and orchestrator reasoning proof.
- #160: Action-bound desktop collaboration proof gate.
- #161: Connected local Mac search UI live tool proof.
- #162: Runtime-proven release claim gate and docs promotion.
- #163: Claude Code adapter proof-boundary inventory.

For #158, use the installed gateway path rather than the direct Codex smoke:

```bash
lco openclaw live-control-smoke \
  --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-158-gateway-live-codex-proof/runtime-proof \
  --thread-id <selected-harmless-codex-thread-id> \
  --strict
```

The command writes `openclaw-gateway-live-codex-v1-1.runtime-proof.json` and
`openclaw-gateway-live-control-smoke-report.json`. It must be preceded by an
explicit target choice, invokes `lco_codex_control_dry_run` first, sends only
with the matching `approval_audit_id`, then reads `lco_audit_tail` for
public-safe audit metadata. Do not use it for broad gateway scope approval,
generic live control, GUI mutation, or raw transcript inspection.

Caveat: until #615 is verified, treat live-control send proof as provisional
and keep release or working-app claims scoped to the separately proven control
path evidence.

For #159, consume the #158 report and refresh through public OpenClaw tools:

```bash
lco openclaw post-action-refresh-smoke \
  --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-159-post-action-refresh-reasoning/runtime-proof \
  --thread-id <selected-harmless-codex-thread-id> \
  --live-proof-report /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/issue-158-gateway-live-codex-proof/runtime-proof/openclaw-gateway-live-control-smoke-report.json \
  --strict
```

The command writes `post-action-refresh-reasoning-v1-1.runtime-proof.json` and
`post-action-refresh-reasoning-report.json`. It invokes only read/recall tools
through OpenClaw Gateway: `lco_codex_thread_map`, `lco_search_sessions`,
`lco_describe_session`, and `lco_expand_query`. It must not run live Codex
control, mutate a GUI, or store raw transcript/prompt text.

## Working App Claim

Allowed only after #157, #158, #159, and #162 pass:

> LCO has a Codex-first working app proof through the installed OpenClaw gateway:
> an agent can search, describe, expand, perform one approved harmless live Codex
> action, refresh state, and reason from public-safe session evidence.

Still forbidden after this sprint unless separately proven:

- Claude Code equivalent behavior.
- Remote or cloud synchronization.
- Broad unattended desktop control.
- Permission or sandbox bypass.
- Release-grade security or customer readiness.
- Generic GUI mutation.
