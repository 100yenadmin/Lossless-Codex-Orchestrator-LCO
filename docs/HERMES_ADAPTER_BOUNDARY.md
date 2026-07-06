# Hermes Adapter Boundary

Issue: [#616](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/issues/616)

This inventory keeps the Hermes lane honest. Hermes agents are the priority-2 adapter tier
for LCO after OpenClaw and before generic MCP. LCO does not ship a native
Hermes adapter today; Hermes agents consume LCO through the same generic
MCP server, local index, safe-summary recall, and approval/audit patterns as any
other MCP-capable harness.

This document does not prove a native Hermes adapter, Hermes-specific indexing,
Hermes control surfaces, parity, GUI mutation, or cloud sync.

## What "Hermes support" means today

LCO's MCP server (`lco-mcp-server`, with `loo-mcp-server` retained as a compat
alias) and CLI have zero OpenClaw-specific hardcoding. The OpenClaw plugin is
one adapter over a runtime that is adapter-neutral. A Hermes agent therefore
mounts LCO exactly as any generic MCP client does:

1. Install the package globally.
2. Add the MCP server to the Hermes agent's MCP configuration using stdio
   transport, command `lco-mcp-server`, and `LCO_DB_PATH` /
   `LCO_TOOL_PROFILE` env as needed. `LOO_*` env names remain accepted as
   compatibility fallbacks.
3. The agent then calls the tiered `lco_*` tool surface (facade / workflow /
   proof) with the same approval-gated dry-run/control boundaries Codex and
   OpenClaw get.

This is a first-class supported path: the generic-MCP mounting recipe is covered
by the Claude Code, Cursor, generic MCP client, and Multi-client Mounting
sections of [SETUP.md](SETUP.md). What it is not is a Hermes-native integration
with Hermes-specific ergonomics.

## What is not claimed

- No native Hermes adapter, plugin manifest, or Hermes-side install command.
- No Hermes session indexing. LCO indexes Codex sessions; Hermes agents read
  that Codex index through LCO, they are not themselves an indexed source.
- No Hermes-specific control, GUI mutation, or remote-control surface.
- No claim that Hermes-specific auth, scopes, or lifecycle events are wired.
- The generic-MCP protocol boundary applies: only `initialize`, `tools/list`,
  and `tools/call` are implemented; no MCP resources, prompts, or sampling.

## First native-adapter proof step (deferred)

A native Hermes adapter is deferred until a concrete Hermes use case lands. When
it does, the first proof step mirrors the OpenClaw and Claude lanes:

1. Define the Hermes mounting/manifest contract from public Hermes docs only.
   Do not inspect private Hermes app data.
2. Add a Hermes adapter capability-detection path that is read-only and
   fail-closed when Hermes is absent; absence must never become a stack trace.
3. Prove the index/search/describe/expand core loop routes through a real Hermes
   agent session against the gateway/MCP server, with a public-safe evidence
   packet, before any Hermes-native claim is added to the proof boundary.

Until that proof exists, the honest claim is: "Hermes agents can orchestrate
Codex through LCO via the generic MCP server," not "LCO has a Hermes adapter."
