# LCO Codex Autonomy Cockpit + Eva Operating Picture Sprint

## Summary

This sprint moves LCO from session recall into a two-tier operating layer:

- **#254 Codex Autonomy Cockpit:** recent sessions, compact session cards, evidence cards, cockpit inbox ranking, watcher/resume-request primitives, approval packets, and visible Codex map joins.
- **#255 Eva Operating Picture:** business/project pulse, attention inbox, and `PLAN_STATE.md` demoted to bootloader, manual pins, approval boundaries, and exception ledger.

The first implementation slice is P0 and read-only: LCO/Codex state, optional structured GitHub items, and explicit `PLAN_STATE.md` pins. Notion, support-control, Company Brain, Stripe, dashboard/export, and model summarization are P1 and must remain source-coverage gaps until separately proven.

## Durable Plan Contract

- Goal: Ship a public-safe, read-only-first autonomy cockpit and Eva operating-picture layer that lets Eva answer which Codex/business/project lanes need attention from cited structured cards without raw transcript reads.
- Resume identity: repo `https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO`; checkout `/Volumes/LEXAR/repos/lossless-openclaw-orchestrator`; branch `main`; starting SHA `0647bd37381f27c4da947dea72bf13b8a51b1b6c`; trackers #254 and #255; first child #256.
- Tracking / source of truth: GitHub issues #254/#255/#256/#258/#259 own implementation truth; `VISION.md` owns product/eval truth; this brief owns sprint handoff; evidence root `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-01/codex-autonomy-cockpit-operating-picture/`.
- Scope / non-goals: P0 is deterministic and read-only. No raw transcripts, raw transcript paths in public-safe outputs, external writes, live Codex control, GUI mutation, screenshots by default, Claude parity, enterprise/customer-ready claim, npm latest promotion, or stable 1.0 claim.
- Current state: beta.30 has working Codex index/search/describe/expand/dry-run through OpenClaw gateway; M9 handoff is published; #254/#255 are open; VISION/README now point at this sprint.
- Exact next action: finish #260 read-only Codex app-server status/thread signals and visible-to-indexed map joins, then continue P1 adapter splits behind their own proof gates.
- Critical invariants: public-safe defaults; opaque source refs; `PLAN_STATE.md` is not canonical current-state truth; every card carries source refs, confidence, freshness, reason codes, and coverage; missing/conflicting sources degrade to `unknown` or `low_confidence`.
- Execution lanes: #256 shared contracts/tools; #258 source-authority profile; #254 cockpit P0 follow-ups; #255 operating-picture P0 hardening; OpenClaw dogfood; scorecards/evidence; beta publish only after scoped release gates.
- Validation / eval gates: focused unit tests, MCP schema tests, OpenClaw manifest tests, scenario/scorecard sweep, `npm run check`, GitHub CI/CodeQL, evidence scan, OpenClaw gateway dogfood when tool surface changes.
- Proof-claim boundary: P0 may claim public-safe Codex-first cockpit and Eva operating-picture beta. It must not claim P1 business adapters, full business truth, customer readiness, enterprise security, stable release, generic GUI mutation, or Claude parity.
- Stop conditions: stop on raw path/text/secret leaks, P0 external mutation, summarizer invention, hidden missing-source coverage, live control, GUI mutation, or stale `PLAN_STATE.md` prose becoming canonical.
- Evidence path / packet: `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/2026-07-01/codex-autonomy-cockpit-operating-picture/`.

## P0 Interfaces

- `loo_recent_sessions`: recent/active/all Codex session cards without `query:"*"`.
- `loo_cockpit_inbox`: deterministic attention ranking for sessions that need review, approval, resume, or blocker triage.
- `loo_watchers_list`, `loo_watcher_status`, `loo_watcher_dry_run`, `loo_resume_request_packet`: read-only watcher status and approval-bounded resume-request packets with TTLs, stop conditions, wake reasons, and no live mutation.
- `loo_plan_state_pins`: explicit marker parser for manual pins, approval boundaries, and exception ledger entries only.
- `loo_project_digest`: bounded operating digest from LCO/Codex cards, optional structured GitHub items, and PLAN_STATE pins.
- `loo_attention_inbox`: action-first operating cards filtered to red/yellow/unknown states.
- `loo_business_pulse`: read-only "How is the business?" envelope with explicit source coverage gaps.

## P0 PLAN_STATE Markers

Only these marked blocks are parsed:

```markdown
<!-- loo:manual-pin -->
- Project: LCO
- State: yellow
- Summary: Public-safe redaction contract is the next gate.
- Next: Run focused autonomy tests.
- Source: issue#256
<!-- /loo:manual-pin -->

<!-- loo:approval-boundary -->
- No live Codex control or GUI mutation during P0.
<!-- /loo:approval-boundary -->

<!-- loo:exception-ledger -->
- Stripe source is intentionally not configured in P0.
<!-- /loo:exception-ledger -->
```

Unmarked prose is bootloader/fallback context and must not become current-state truth.

## Follow-Up Split

- #254 child: watcher/resume-request primitives with TTLs and no mutation (#259).
- #254 child: visible Codex map join using sanitized app/title metadata and read-only app-server signals only (#260).
- #255 child: source-authority bootstrap profile so coverage does not masquerade as current truth ownership.
- #255 child: richer GitHub deterministic collector instead of optional structured input.
- #255 child: Notion/support-control/Company Brain/Stripe read-only adapters, each behind `not_configured | unavailable | partial | ok`.
- #255 child: optional dashboard/Notion export after data contracts are stable.
