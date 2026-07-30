# Hermes Adapter Boundary

Issue: [#616](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/616)

This inventory keeps the Hermes lane honest. Hermes is LCO's priority-1 agent
path over standards-compliant stdio MCP. LCO does not ship a native Hermes
adapter today; Hermes agents consume LCO through the shared MCP server, local
index, safe-summary recall, and approval/audit patterns used by other
MCP-capable harnesses. OpenClaw remains a supported compatibility surface.

This document does not prove a native Hermes adapter, Hermes-specific indexing,
unrestricted control parity, generic GUI mutation, or cloud sync.

## What "Hermes support" means today

LCO's MCP server (`lco-mcp-server`, with `loo-mcp-server` retained as a compat
alias) and CLI have zero OpenClaw-specific hardcoding. The OpenClaw plugin is
one adapter over a runtime that is adapter-neutral. A Hermes agent therefore
mounts LCO exactly as any generic MCP client does:

1. Install the package globally or into an isolated candidate prefix.
2. Add the MCP server to the Hermes agent's MCP configuration using stdio
   transport, command `lco-mcp-server`, and `LCO_DB_PATH` /
   `LCO_TOOL_PROFILE` env as needed. `LOO_*` env names remain accepted as
   compatibility fallbacks.
3. The agent then calls the tiered `lco_*` tool surface (facade / workflow /
   proof) with the same approval-gated dry-run/control boundaries Codex and
   OpenClaw get.

For Eva-owned CLI tasks, set `LCO_CODEX_TRANSPORT=daemon`. The MCP server then
connects to the already-running local managed Codex daemon over its Unix socket.
`lco_codex_control_route` returns an expiring opaque target and
`lco_codex_deliver` chooses idle send or matching active-turn steer. The public
result never returns raw thread or turn identifiers, transcript items, or the
socket path. LCO does not start or restart Codex, enable Remote Control, or
silently fall back to stdio when daemon mode is requested.

Codex Desktop remains a separate ownership boundary. When LCO returns
`desktop_observation_required`, Hermes uses its existing `computer_use`
integration for window identification, visual verification, composer input,
and the Desktop-owned turn. LCO does not claim the managed daemon owns that
turn and does not enable generic `lco_desktop_act`.

This is the primary first-class supported path: the Hermes and
generic-MCP mounting recipes are covered by [SETUP.md](SETUP.md). Release candidates exercise
initialization, silent notifications, tool listing and calls, structured-result
shape, default search behavior, and latency through `lco hermes smoke`. What it
is not is a Hermes-native integration with Hermes-specific ergonomics.

## What is not claimed

- No native Hermes adapter, plugin manifest, or Hermes-side install command.
- No Hermes session indexing. LCO indexes Codex sessions; Hermes agents read
  that Codex index through LCO, they are not themselves an indexed source.
- No native Hermes control protocol or generic GUI mutation. Hermes can invoke
  the shared LCO daemon-control tools and its own Computer Use integration.
- No claim that Hermes-specific auth, scopes, or lifecycle events are wired.
- The generic-MCP protocol boundary applies: only `initialize`, `tools/list`,
  and `tools/call` are implemented; no MCP resources, prompts, or sampling.

## Native-adapter proof step (deferred)

A native Hermes adapter remains deferred because the supported stdio MCP path
does not require one. If native lifecycle or orchestration work is authorized,
its first proof step mirrors the existing adapter lanes:

1. Define the Hermes mounting/manifest contract from public Hermes docs only.
   Do not inspect private Hermes app data.
2. Add a Hermes adapter capability-detection path that is read-only and
   fail-closed when Hermes is absent; absence must never become a stack trace.
3. Prove the index/search/describe/expand core loop routes through a real Hermes
   agent session against the gateway/MCP server, with a public-safe evidence
   packet, before any Hermes-native claim is added to the proof boundary.

Until that proof exists, the honest claim is: "Hermes agents can orchestrate
Codex through LCO via the generic MCP server," not "LCO has a Hermes adapter."
