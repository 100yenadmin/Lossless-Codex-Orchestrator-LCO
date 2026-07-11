# Control Plane Threat Model

This is an operator-facing risk model for the LCO 1.6 control-plane release
train. It belongs in release checklists, QA packets, and implementation issues,
not in public release notes.

The control-plane layer lets an orchestrator ask LCO to prepare review plans,
dry-run control packets, and approved scratch-session actions across local
agent targets. The safety story depends on keeping target authority explicit:
the local user, Codex, OpenClaw, the LCO database, and any future target adapter
must each retain their own permission boundary.

## Scope

Covered by this model:

- TargetAdapter policy seams and per-target method allowlists.
- OpenClaw gateway tokens and local MCP/tool invocation.
- LCO SQLite databases, prepared-state caches, summary leaves, audit logs, and
  hook sidecar records.
- Approval-audit packets for dry-run and live-control flows.
- Scratch-session runtime proof for disposable Codex QA threads.
- Release rollback handles for npm, Git tags, and GitHub Releases.

Outside this model:

- Enterprise security posture, managed secrets rotation, SOC controls, or
  customer tenancy guarantees.
- Claude Code parity beyond explicitly tested local adapter lanes.
- Generic GUI mutation or unattended desktop operation.
- Cloud sync, shared hosted indexes, or cross-machine control.

## Assets

| Asset | Why It Matters | Default Handling |
| --- | --- | --- |
| Gateway token | Authorizes local OpenClaw gateway tool invocation. | Keep local, env-ref preferred, never paste into evidence. |
| Approval audit id | Binds a live action to a dry-run packet and target preconditions. | Required for live control; short-lived and target-specific. |
| LCO SQLite DB | Stores indexed sessions, prepared cards, summary leaves, and audit metadata. | Advisory derived cache; do not treat as source authority. |
| Source refs | Let an agent expand bounded evidence without raw transcript scans. | Opaque refs only in public outputs. |
| Hook packets | Record closeout/state-prep/compaction markers. | Derived-cache writes only; hash sensitive paths. |
| npm and release tags | Public distribution truth. | Dual-package publish must match tag and GitHub Release SHA. |

## Trust Boundaries

### Local binding

LCO defaults to local files, local SQLite, local MCP stdio, and loopback gateway
surfaces. A target adapter must not broaden that boundary by opening remote
control, remote pairing, or external writes unless a separate release lane adds
that behavior with explicit tests and release gates.

### Token scope

Gateway and adapter tokens grant access only to the local surface they are
issued for. They are not proof that a target session should be mutated. Live
actions still require an LCO dry-run packet, matching approval audit id, and the
target application's own approval and sandbox semantics.

### Database and cache blast radius

The LCO database is a derived cache over local sources. A corrupted or stale
cache can mislead the orchestrator, but it must not mutate Codex source stores,
GitHub, Notion, Stripe, or customer systems. Cache writes are classified as
derived-cache writes and must carry extractor versions, freshness, confidence,
and source refs so stale cards degrade instead of pretending to be authority.

### Gateway-token leakage

If a gateway token leaks, an attacker with local network reach may invoke the
gateway as that local profile until the token is revoked or rotated. Mitigations:

- prefer loopback-only binding;
- store tokens outside evidence and public docs;
- support token rotation and fresh-profile setup;
- mark token-bearing evidence as private and exclude it from release packets;
- keep live-control tools fail-closed without dry-run and approval audit ids.

### Approval audit semantics

An approval audit id authorizes one bounded action shape, not an open-ended
conversation. The action packet should include:

- target kind and source ref;
- method name and surface class;
- sanitized user-visible intent;
- precondition hash;
- expiry;
- dry-run timestamp;
- expected live method;
- post-action refresh requirement.

The live executor must reject mismatched method, target, precondition, expired
packet, missing audit id, or stale packet hashes.

### Scratch-session doctrine

Runtime proof uses disposable scratch sessions unless the user gives exact
target approval for a real thread. Scratch sessions should be named and tagged
so evidence can prove the action target without leaking private transcript text.
Runtime lanes may send harmless prompts, steer long-running scratch turns, and
interrupt scratch turns only when the release issue asks for those rows.

## Threats And Mitigations

| Threat | Failure Mode | Mitigation |
| --- | --- | --- |
| Policy confusion | A read-only target method is routed through live-control execution, or a resumed/running thread retains broader ambient permissions. | Separate read, dry-run, live-control, GUI, external-write, and release-publish method families; pin supported live Codex control to `approvalPolicy=never` plus a read-only, no-network sandbox on start, resume, and turn start; before active-turn steer/interrupt, require the same-connection resume response to prove that posture or fail closed. |
| Target mix-up | Approval minted for one target is replayed against another. | Include target kind/ref/precondition hash in the audit packet and compare before live execution. |
| Stale prepared state | Orchestrator acts on an old card as current truth. | Freshness, confidence, source coverage, and low-confidence degradation on every card. |
| Raw data leakage | Release evidence includes raw prompts, paths, logs, tokens, or SQLite. | Public-safe scan, opaque refs, path canaries, and evidence index review before publish. |
| Gateway token leakage | Local gateway can be invoked by an unintended process. | Loopback binding, env-ref onboarding, rotation steps, and no token capture in evidence. |
| Source-store mutation | Derived prep code changes Codex files or external systems. | Mutation-family policy split and tests for source-store/external-write fail-closed behavior. |
| GUI overreach | Desktop fallback becomes arbitrary app control. | Keep desktop lanes metadata/action-bound until a separate GUI issue proves exact behavior. |
| Release mismatch | npm, tag, and GitHub Release point at different SHAs. | Release finalization status and dual-package rollback runbook. |

## Operator Checks

Before public 1.6 release messaging leans on agent-to-agent driving, release
captains should verify:

- TargetAdapter policies name their target method families explicitly.
- No control method can run live without a matching dry-run approval audit id.
- Gateway and MCP reports do not include raw tokens or private local paths.
- Prepared-state outputs keep source refs, freshness, confidence, and omissions.
- Scratch live-control evidence targets disposable sessions only.
- Release notes are written for users and developers; operator risk detail stays
  in this file, `docs/RELEASE_CHECKLIST.md`, `docs/CLAIM_AUDIT.md`, issue
  comments, and QA evidence.

## Rollback Handles

If a control-plane release publishes a bad package or false runtime claim:

1. Move the npm `latest` dist-tag back to the last known-good version for both
   package names.
2. Deprecate the bad version with a migration note when appropriate.
3. Draft a patch release from the fixed main SHA.
4. Update the GitHub Release with a short customer-facing correction.
5. Record the operator root cause in the issue tracker and release evidence.

For local runtime incidents:

1. Stop the local gateway or revoke the affected gateway token.
2. Disable any launchd/watch service that invokes LCO.
3. Move the affected LCO DB aside before reindexing.
4. Re-run `lco doctor`, fresh-profile setup, and the scoped QA Lab lane.
