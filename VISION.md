# Lossless OpenClaw Orchestrator Vision

This document is the product and eval contract for the public beta. GitHub issues remain the implementation source of truth. This file defines what the product is trying to become, how agents should evaluate progress, and which claims remain outside the proof boundary.

## North Star

An OpenClaw agent can understand, search, summarize, and safely coordinate a user's local Codex sessions without reading huge raw transcripts or bypassing Codex permissions.

The beta should feel like a local orchestration cockpit: OpenClaw can see what Codex sessions exist, what each session is working on, which plans and final messages matter, which files were touched, and which next action would be safe to dry-run or execute only after explicit approval.

## Current Milestone: Working App Proof Sprint

Milestone 7 is the next product/eval target: [Working App Proof Sprint](docs/WORKING_APP_PROOF_SPRINT.md), tracked by [#156](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/156) and GitHub milestone [#8](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/milestone/8).

The milestone exists because `0.1.x` has strong reduced-scope beta evidence, but a working app claim needs more than dry-run contracts. The target proof is:

- Installed OpenClaw gateway path, not only internal CLI helpers.
- Live `loo_*` tool calls through the same surface an OpenClaw agent uses.
- One harmless approved Codex action through that surface, with dry-run first and a matching approval audit id.
- Post-action session refresh and safe agent reasoning from source refs and bounded summaries.
- Action-bound desktop collaboration proof only where direct Codex protocol is insufficient.
- Connected local search/cockpit proof from live tool calls, not only a static shell.

Milestone 7 does not turn the project into a broad automation product. It is still Codex-first and local-first. Claude Code parity, remote sync, broad unattended desktop control, permission bypass, and release-grade security stay outside the proof boundary until separate evidence exists.

## Primary User Stories

- As a user, I can ask OpenClaw what my local Codex sessions are doing.
- As an OpenClaw agent, I can find relevant Codex sessions by plan, final message, files touched, tool metadata, safe summary, or source ref.
- As a user, I can expand one or two sessions into a bounded brief instead of exposing a raw transcript.
- As a user, I can dry-run a Codex continue, send, steer, resume, or interrupt action and inspect the exact target/action before approval.
- As a user, I can approve one harmless Codex action through the installed OpenClaw gateway path and then see LCO refresh the session state.
- As an OpenClaw agent, I can reason about the updated session from safe summaries and source refs without reading raw transcripts.
- As a maintainer, I can prove the package is local-only, bounded, and honest about unsupported features before public release.
- As a future adapter author, I can add Claude Code or another agent desktop behind the same index, recall, safety, and proof-boundary patterns without claiming parity early.

## Orchestrator Product-Management Mode

The strongest product direction is an OpenClaw orchestrator agent that can act like a local product-management operator across hundreds of local agent sessions while spending the least context possible. The orchestrator should know which Codex, OpenClaw, and future adapter sessions exist; what project each belongs to; current status; priority; owner or driving agent; blocker state; final closeout; proposed plan; touched files; source refs; and safest next action.

Features should be prioritized by the `orchestrator-leverage-prioritization.json` scorecard when they change roadmap order. High-priority work gives the agent more session-management leverage per token: thread metadata, closeout hooks, project/status/priority tagging, archive and fork workflows, cited bounded expansion, and hybrid search when it improves top-k retrieval quality. Lower-priority work can still matter, but should wait when it makes the product more visually complete without reducing the orchestrator's rereading burden.

Expected product-management workflows:

- Tag threads with thread metadata such as project, status, priority, owner, blocker, next action, closeout state, and source refs.
- Use closeout or hook agents to attach public-safe summaries and sortable metadata when a plan or thread finishes.
- Search and triage hundreds of local agent sessions by project, status, plan, final message, touched files, tool metadata, safe summary, and source ref.
- Expand only the few sessions that need review, using bounded 1k or 4k evidence bundles with citations and omitted markers.
- Archive inactive sessions, fork useful sessions, and dry-run resume/steer/send actions only after the target and intent are clear.
- Use hybrid search, such as BM25 plus vectors, query expansion, and reranking, only after fixture and local evals show better signal per token than the simpler index.
- Provide a simple local Mac search UI prototype through [docs/LOCAL_MAC_SEARCH_UI.md](docs/LOCAL_MAC_SEARCH_UI.md), `loo ui local-mac-search`, and `local-mac-search-ui-review.json` after the CLI, MCP, and OpenClaw gateway paths prove the underlying recall loop, without rendering raw transcripts.
- Offer a session sanitizer lane that scans indexed sessions for secret-like strings and produces redacted repair tasks without publishing raw local data.
- Keep Claude metadata fixture inventory separate from parity: `indexClaudeSessionInventory` can prove public-safe `claude_session:*` refs from explicit redacted fixtures, but it does not prove local Claude transcript indexing, live control, GUI mutation, MCP control, hooks mutation, cloud sync, or parity.

## Product Shape

- `packages/core` is the local index, recall, safe-summary, source-ref, and SQLite layer.
- `packages/adapters` is the safety and integration boundary for Codex transport, audit, redaction, CUA Driver, Peekaboo, and future adapters.
- `packages/mcp-server` exposes the `loo_*` tool surface for OpenClaw and other MCP clients.
- `packages/cli` is the operator and evidence surface for `doctor`, `index`, `search`, `grep`, `describe`, `expand`, `desktop`, and release commands.
- `packages/openclaw-plugin` is the OpenClaw package and manifest layer.
- `docs/` explains install, demo workflow, privacy, safe summaries, release proof, the beta release runbook, and claim boundaries.

## Build Loop

Every meaningful issue should follow this loop:

1. Start from a GitHub issue or create one before implementation.
2. Write a failing test, fixture, smoke, or eval scenario first.
3. Implement the smallest product change that makes the scenario pass.
4. Run focused validation.
5. Run `npm run check` when source behavior, package contracts, or tool schemas changed.
6. Smoke through the public CLI, MCP server, or local OpenClaw gateway when that is the user-facing surface.
7. Save public-safe evidence under `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/<issue-slug>/`.
8. Update the GitHub issue and PR with what works, what is not proven, commands run, evidence path, and next action.
9. Keep sprint state oriented to this vision before filing follow-up issues.

## Local OpenClaw Gateway Dogfood

The local OpenClaw gateway is a first-class beta user. When a change affects OpenClaw plugin behavior, MCP tools, tool schemas, packaging, or agent workflow, validation should include the same path an OpenClaw agent would use.

Expected dogfood checks:

- Load or inspect the OpenClaw plugin manifest and runtime entry.
- Verify `loo_*` tools are declared and callable through the installed or packaged surface.
- Call read-only tools such as `loo_doctor`, `loo_index_sessions`, `loo_search_sessions`, `loo_describe_session`, `loo_expand_query`, `loo_codex_plans`, and `loo_codex_final_messages`.
- Verify dry-run control tools produce audit ids without mutating a real Codex thread.
- Confirm evidence contains counts, refs, hashes, statuses, and redacted metadata only.

Do not use gateway dogfooding to run live Codex control, GUI mutation, npm publish, or GitHub Release creation without explicit user approval.

## Scorecards

Scorecards should be updated in issue comments or evidence summaries when a PR meaningfully changes product behavior.

Versioned examples live under `evals/scorecards/v1.0/`. Use them as the shared scorecard contract before milestone sweeps, release gates, and local-agent dogfood claims:

- `safety-bypass-review.json`
- `retrieval-quality-review.json`
- `orchestrator-leverage-prioritization.json`
- `packaging-install-review.json`
- `public-claim-review.json`
- `local-agent-usability-review.json`
- `local-mac-search-ui-review.json`
- `working-app-runtime-proof-review.json`

Run `loo scorecards sweep --claim-scope <scope> --evidence-dir <path> --strict` to materialize a public-safe sweep packet. Strict mode should fail closed while scorecards still have `example-not-run` scores, so the packet records remaining evidence gaps instead of converting examples into beta readiness claims. Reduced-scope beta sweeps use `codex-read-search-expand-dry-run`; working-app sweeps use `codex-working-app-proof` and keep runtime proof scorecards required.

For implementation issues, copy `evals/scorecards/v1.0/issue-scorecard-update-template.md` into the GitHub issue or PR comment and fill in the failing test, minimal implementation, focused validation, OpenClaw gateway dogfood result, evidence path, proof boundary, and next action. This per-issue scorecard update template keeps issue comments compact while preserving the beta proof boundary.

| Area | Target | Current proof field |
| --- | --- | --- |
| Codex indexing | 100+ local sessions indexed with bounded file, byte, and event limits | session count, event count, `errors`, `limitedFiles` |
| Session map | Agent can list useful active/recent sessions without raw transcript reads | `loo_codex_thread_map` evidence |
| Orchestrator leverage | Roadmap priority favors highest signal per token for managing many sessions | `orchestrator-leverage-prioritization.json` score movement |
| Search quality | Known plan/final queries return expected sessions in top results | query, refs, top-k hits |
| Bounded expansion | 1k and 4k briefs preserve metadata, plans, finals, touched files, and safe summaries | expansion profile, token budget, omitted markers |
| Final-message extraction | Final assistant/status messages are searchable and attributable | `loo_codex_final_messages` evidence |
| Proposed-plan extraction | Proposed plans are extracted without leaking unrelated raw transcript spans | `loo_codex_plans` evidence |
| Touched-file extraction | Touched files remain visible or accurately omitted in bounded briefs | file count, omitted marker |
| Control safety | Live actions fail closed without matching dry-run and `approval_audit_id` | control tests and audit evidence |
| Desktop fallback readiness | CUA/Peekaboo report honest readiness without overclaiming action support | `loo_desktop_see` evidence |
| Desktop live/no-focus harness | GUI fallback proof attempts fail closed until backend, approval ref, target, action, and no-focus status probe are ready | `loo desktop live-proof-harness` / `loo_desktop_live_proof_harness` evidence |
| Desktop GUI proof contract | Backend-specific live/no-focus observations can be validated without running the action in the reporting command | `loo desktop proof-report` / `loo_desktop_proof_report` evidence |
| Local Mac search UI | User can search, filter, inspect safe summaries, and copy source refs without raw transcript rendering | `local-mac-search-ui-review.json` score movement |
| Working app runtime proof | Installed user path proves search/describe/expand, approved live Codex action, post-action refresh, and safe reasoning | `working-app-runtime-proof-review.json` score movement |
| OpenClaw packageability | Plugin installs/loads with declared `loo_*` contracts | manifest/tool count and package smoke |
| Public claims | README/docs/release notes stay inside allowed beta wording | claim audit result |
| Privacy | Evidence contains no raw session files, SQLite DBs, screenshots, tokens, or secrets | artifact scan result |

## Eval Scenarios

Use small redacted fixtures for deterministic CI and local private stores only for local smoke. Do not upload private raw Codex data.

Versioned QA Lab scenario contracts live under `evals/scenarios/v1/`.
Run `loo eval scenarios --evidence-dir <path> --strict` to materialize
public-safe dry-run scorecards for those contracts. This command validates
scenario shape, allowed tools, forbidden behaviors, expected public-safe
evidence, metrics, and proof boundaries; it does not execute private evals,
read raw transcripts, run live Codex control, mutate a GUI, publish npm, or
create a GitHub Release.

Milestone 7 runtime-required contracts live under `evals/scenarios/v1.1/`. Those
contracts are not satisfied by `loo eval scenarios` dry-run output alone. Issue
`#157` fails closed until `--runtime-proof-dir` contains public-safe
`<scenario-id>.runtime-proof.json` markers for installed OpenClaw gateway proof,
approved live Codex action proof, post-action refresh/reasoning proof, desktop
collaboration proof when claimed, and connected local UI proof when claimed.

Core eval scenarios:

- Build a session map from 100+ local Codex sessions.
- Search for a known proposed plan and verify the right session appears.
- Search for a known final message and verify the right session appears.
- Expand one session with a 1k-token brief and verify metadata, plans, finals, touched files, and safe summary survive.
- Expand one session with a 4k-token evidence bundle and verify omitted markers remain honest.
- Extract touched files from a session with many long paths and verify visible plus omitted counts match the indexed total.
- Run `loo_codex_control_dry_run` and verify the returned audit id, parameter hash, and message hash.
- Attempt live send/steer/resume/interrupt without approval and verify fail-closed behavior.
- Load the OpenClaw plugin package and verify declared `loo_*` tool contracts.
- Run release preflight/status commands and verify remaining blockers are explicit.
- Stage the local Mac search UI contract and scorecard, then verify it still routes through CLI, MCP, and OpenClaw gateway proof instead of raw transcripts.
- Prove the Milestone 7 working-app runtime path from `evals/scenarios/v1.1`: installed gateway, approved live Codex action, post-action refresh, and safe agent reasoning.
- Keep Claude Code behind the inventory in [docs/CLAUDE_ADAPTER_BOUNDARY.md](docs/CLAUDE_ADAPTER_BOUNDARY.md): the first adapter proof step is read-only session inventory, not control or parity.

## Adversarial Milestone Sweeps

Before closing a major milestone or re-orienting the sprint, run an adversarial review pass focused on:

- Safety bypasses: live action without dry-run and matching approval id.
- Privacy leaks: raw transcript, raw prompt, screenshots, SQLite DBs, tokens, credentials, local paths in public evidence.
- Retrieval false confidence: summaries or expansions that imply complete recall when limits skipped or omitted data.
- Protocol drift: Codex transport method changes, unsupported app-server assumptions, stale OpenClaw plugin contracts.
- Packaging failure: package installs but exposes no tools, omits runtime artifacts, or overclaims unsupported adapters.
- Public claim drift: Claude parity, cloud sync, unattended takeover, permission bypass, or release-grade enterprise security language.

## Milestone Review Cadence

Review milestone state at three moments:

- After every merged PR that changes product behavior, tool contracts, release evidence, safety gates, or public claims.
- Before opening the next child issue when the remaining work could require live control, GUI mutation, npm publish, or GitHub Release creation.
- Before closing a milestone or claiming beta readiness.

Each review should update the relevant tracker issue with the current scorecard movement, evidence path, commands run, CI/review status, working/not-working list, proof boundary, and exact next action. If the next action crosses a stop condition, pause for explicit user approval instead of converting the approval gate into an implementation task.

Release candidates follow [docs/BETA_RELEASE_RUNBOOK.md](docs/BETA_RELEASE_RUNBOOK.md). `main` is the integration branch, not a release; npm publish and GitHub Release creation remain separate approval-gated operations.

## Proof Boundary

Allowed public beta claim:

> Control and collaborate with local Codex sessions through OpenClaw using local indexing, bounded recall, and approval-gated controls.

Do not claim:

- Full Claude Code parity.
- Cloud sync.
- Unattended desktop takeover.
- Codex permission or sandbox bypass.
- Release-grade enterprise security.
- Live control proof unless a user explicitly approved the exact target thread and harmless prompt and the evidence proves Codex approval semantics were preserved.

## Current Release Gates

Release candidates should be scoped to the evidence they actually prove. `main` may be RC-ready for one claim scope while broader 1.0 work remains open.

For `0.1.x` reduced-scope release candidates, the allowed claim scope is `codex-read-search-expand-dry-run` when the evidence proves Codex indexing, search, describe, bounded expansion, and dry-run control through CLI, MCP, or the OpenClaw gateway. In that scope, live Codex control is an excluded claim, GUI mutation is an excluded claim, and Claude parity is an excluded claim. Those exclusions must remain visible in release status, scorecards, docs, and issue updates instead of becoming hidden blockers.

For Milestone 7, 1.0, or any expanded-scope release that claims live control, desktop collaboration, or adapter parity, the broader gates below must be proven from the public CLI, MCP, OpenClaw plugin, or approved desktop surface:

- Local Codex indexing works on 100+ sessions with bounded limits.
- Search, describe, plans, finals, touched files, tool metadata, and bounded expansion work.
- OpenClaw plugin package declares and exposes the expected `loo_*` tools.
- Control tools fail closed without dry-run plus matching approval.
- One harmless approved live Codex control smoke is proven with explicit user approval.
- Installed OpenClaw gateway path proves the approved live Codex action, not only a CLI helper.
- Post-action refresh proves the target session can be searched/described/expanded after the live action, with safe agent reasoning from source refs.
- CUA/Peekaboo readiness is honest and does not imply unsupported generic GUI action.
- Desktop GUI live/no-focus proof attempts use `loo desktop live-proof-harness` or `loo_desktop_live_proof_harness` first to confirm the proof plan is public-safe and fail-closed before any backend-specific action is attempted.
- Desktop GUI mutation claims require a backend-specific observation validated by `loo desktop proof-report` or `loo_desktop_proof_report`; the proof-report command itself must not perform the GUI action.
- Release preflight/status/bundle commands produce public-safe evidence.
- npm publish and GitHub Release are separately and explicitly approved before execution.

The `codex-working-app-proof` claim scope exists as a fail-closed release gate.
It is not satisfied by dry-run packets. It requires approved live-control proof
plus public-safe v1.1 runtime marker files for #158
(`openclaw-gateway-live-codex-v1-1.runtime-proof.json`) and #159
(`post-action-refresh-reasoning-v1-1.runtime-proof.json`) through
`--runtime-proof-dir`. Until those markers exist, public release claims should
keep using the reduced `codex-read-search-expand-dry-run` scope or the plain
`codex-live-control` scope, and `codex-working-app-proof` must report
`runtime_proof_missing:*` blockers.

## Evidence Rules

Evidence may include:

- command names and exit status
- counts
- source-prefixed refs
- redacted metadata
- hashes
- blocker codes
- links to CI, PRs, and issues

Evidence must not include:

- raw Codex JSONL files
- local SQLite databases
- raw prompts or transcript spans
- screenshots or videos unless explicitly approved and redacted
- tokens, cookies, API keys, credentials, or private customer data
