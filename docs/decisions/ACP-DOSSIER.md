# ACP Decision Spike Dossier

Scope: EPIC #664 week-1 ACP adopt/wrap/ignore spike. This dossier is evidence
for a later owner decision; it is not the decision record.

Evidence collected from ACP protocol docs/repositories, the live ACP registry,
selected official agent docs/repos, and the current LCO adapter/proof surface.
Confidence labels:

- High: primary spec, registry, source, or current repo code.
- Medium: primary issue/discussion evidence or implementation docs with known
  caveats.
- Low: vendor ecosystem/positioning copy or unproven marketing claim.

## Recommendation Line

Researcher input: **WRAP**. Keep LCO's `TargetAdapter`/proof interface and add
one ACP transport adapter behind capability probes. ACP is real enough to unlock
Claude/Codex/Gemini/Copilot/Goose-class targets with less bespoke transport
work, but not yet uniform enough to make ACP the only LCO control substrate.
The proof/audit layer should remain LCO-owned.

## Executive Findings

1. ACP stable wire protocol is currently protocol version `1`; artifact/schema
   versions move separately from wire compatibility. Source:
   [agentclientprotocol README](https://github.com/agentclientprotocol/agent-client-protocol#versioning)
   (High).
2. ACP gives LCO usable primitives for session creation/load/resume/list,
   prompt turns, streaming updates, permission requests, cancellation, and stdio
   transport. Sources:
   [overview](https://agentclientprotocol.com/protocol/v1/overview),
   [session setup](https://agentclientprotocol.com/protocol/v1/session-setup),
   [prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn),
   [tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls),
   [cancellation](https://agentclientprotocol.com/protocol/v1/cancellation),
   [transports](https://agentclientprotocol.com/protocol/v1/transports) (High).
3. ACP does **not** standardize LCO's dry-run approval packet, HMAC-bound
   `approval_audit_id`, or turn-bound `expected_turn_id` semantics. Those remain
   LCO proof machinery above the transport. Current LCO proof is local in
   [`createCodexControl`](../../packages/adapters/src/index.ts#L730) and gateway
   smokes in
   [`openclaw-live-control-smoke.ts`](../../packages/cli/src/openclaw-live-control-smoke.ts#L140)
   (High).
4. Adoption is materially above "paper spec": the live CDN registry reported
   **38** agent entries during this spike, and the registry's protocol matrix
   generated 2026-07-07 probed **31** agents with **30** successful
   `initialize` responses, **20** supporting `session/list`, and **9**
   supporting `session/resume`. Sources:
   [registry CDN](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json),
   [protocol matrix](https://github.com/agentclientprotocol/registry/blob/main/.protocol-matrix/latest.md)
   (High).
5. Adoption quality is uneven. Gemini has open ACP defects for stdout framing
   and `session/load`; Codex ACP has open gaps for structured rate-limit
   telemetry and session metadata pass-through. Sources:
   [Gemini #22647](https://github.com/google-gemini/gemini-cli/issues/22647),
   [Gemini #27913](https://github.com/google-gemini/gemini-cli/issues/27913),
   [codex-acp #227](https://github.com/agentclientprotocol/codex-acp/issues/227),
   [codex-acp #215](https://github.com/agentclientprotocol/codex-acp/issues/215)
   (Medium).

## Protocol Ground Truth

### Stable Surface

ACP is JSON-RPC 2.0 with request/response methods and one-way notifications.
Clients initialize with `protocolVersion`, capabilities, and optional
`clientInfo`; agents respond with chosen protocol version, agent capabilities,
agent info, and `authMethods`. Sources:
[ACP overview](https://agentclientprotocol.com/protocol/v1/overview),
[initialization](https://agentclientprotocol.com/protocol/v1/initialization)
(High).

Session lifecycle:

- `session/new` creates a conversation/session and returns `sessionId`.
- `session/load` is optional behind `loadSession`; when supported, it must replay
  conversation history via `session/update` notifications before returning.
- `session/resume` is optional behind `sessionCapabilities.resume`; it reconnects
  without replay.
- `session/list` is optional behind `sessionCapabilities.list`.
- `session/close` is optional behind `sessionCapabilities.close` and cancels
  ongoing work/free resources.

Sources:
[session setup](https://agentclientprotocol.com/protocol/v1/session-setup),
[session list](https://agentclientprotocol.com/protocol/v1/session-list),
[session close announcement](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/announcements/session-close-stabilized.mdx)
(High).

Prompt/turn semantics:

- The client sends `session/prompt` with `sessionId` and prompt content.
- The agent streams `session/update` notifications for plans, message chunks,
  usage updates, tool calls, and tool-call status.
- The terminal response to `session/prompt` carries `stopReason` such as
  `end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, or `cancelled`.
- Message chunks may include `messageId`, but stable v1 does not expose a
  required prompt-turn ID equivalent to LCO's Codex `turn.id`.

Sources:
[prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn),
[schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/schema.json)
(High).

Permission/approval model:

- The agent may call client method `session/request_permission` before executing
  a tool call.
- The request carries a `toolCall` and user-visible options such as allow/reject
  once/always.
- Clients may auto allow/reject according to settings.
- If a prompt is cancelled, the client must answer pending permission requests
  with `cancelled`.

Source: [tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls)
(High).

Streaming/notification model:

- Streaming is `session/update` notifications, including message chunks,
  tool-call updates, plans, and optional usage updates.
- Tool statuses include `pending`, `in_progress`, `completed`, and `failed`.
- Stdio transport requires newline-delimited JSON-RPC messages on stdout and
  forbids non-ACP stdout bytes.

Sources:
[tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls),
[transports](https://agentclientprotocol.com/protocol/v1/transports) (High).

Cancellation/resume:

- `session/cancel` cancels the current prompt turn and should make the final
  `session/prompt` response use stop reason `cancelled`.
- ACP also defines `$/cancel_request` for JSON-RPC request cancellation.
- `session/resume` and `session/close` are stable capability-gated methods.

Sources:
[prompt cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn#cancellation),
[cancellation](https://agentclientprotocol.com/protocol/v1/cancellation),
[session resume announcement](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/announcements/session-resume-stabilized.mdx)
(High).

### Proof-Primitive Mapping

| LCO proof primitive | Current LCO source | ACP concept | Fit | Gap/risk | Confidence |
| --- | --- | --- | --- | --- | --- |
| Target identity | `codex_thread:*`, app-server thread ids | ACP `sessionId`; optional `session/list` metadata | Good for target selection after an id map exists | Existing LCO refs are Codex-shaped; migration needs a neutral `target_session:*` or adapter map | High |
| Dry-run packet | `lco_codex_control_dry_run` mints an audit row and approval packet | No standard ACP dry-run method | Can be implemented wholly in LCO without calling the agent | ACP peers will not know or enforce the packet | High |
| `approval_audit_id` binding | HMAC `paramsHash`/`messageHash`; live call must match dry-run row | ACP permission request is user authorization for agent tool calls | Permission event can be observed/refused by LCO client | LCO's approval id is not an ACP field; use LCO local audit plus optional `_meta` only | High |
| Send/start prompt | `turn/start` after `thread/resume` | `session/prompt` | Good for new prompt turns | ACP terminal response is stop reason, not Codex turn object | High |
| Resume/load target | `thread/resume` | `session/load` or `session/resume` | Good if capability advertised | Implementations differ; Gemini currently advertises load but has an open restore defect | Medium |
| Bounded turn wait | `waitForJsonRpcTurnResolution` watches turn id/status | Wait for `session/prompt` response and stop reason | Good for single in-flight prompt completion | No required stable turn id; steer/interrupt proof cannot be turn-bound without local/request correlation | High |
| Tool progress | Codex notifications/tool server requests | `tool_call`, `tool_call_update`, terminal updates | Good for visible progress and tool status | Exact raw tool input/output replay is implementation-dependent | High |
| Approval UX | Codex approval server requests | `session/request_permission` | Good for tool-call allow/reject | LCO still needs to decide auto-deny/allow policy and audit responses | High |
| Interrupt/cancel | `turn/interrupt` with optional `expectedTurnId` | `session/cancel`, `$/cancel_request`, `session/close` | Good for prompt cancellation | Not equivalent to Codex expected-turn interrupt binding | High |
| Post-action refresh | `lco_*` read tools and post-action refresh smoke | `session/list`, `session/load`, streamed replay | Partial | ACP can replay visible history but does not guarantee local source-store persistence or LCO-safe summaries | Medium |
| Recall/lossless index | Local Codex JSONL/SQLite import, safe summaries | `session/list` metadata and `session/load` replay | Partial as an import source | ACP is control/replay, not a raw transcript/index API; importer remains per-agent until each server proves complete history/tool replay | High |
| Cost/usage | LCO local proof/cost not transport-native | Optional `usage_update` and RFDs | Useful future telemetry | Optional and uneven; Codex/Gemini/Goose issues show usage/rate-limit gaps | Medium |

## Adoption Reality

### Registry Ground Truth

The official registry is a curated catalog of agents that support user
authentication, with manifests under `<id>/agent.json`. Registry docs say CI
verifies `authMethods` in the ACP handshake, and version updates run hourly.
Sources:
[registry README](https://github.com/agentclientprotocol/registry#readme),
[registry format](https://github.com/agentclientprotocol/registry/blob/main/FORMAT.md),
[registry RFD](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/acp-agent-registry.mdx),
[update workflow](https://github.com/agentclientprotocol/registry/blob/main/.github/workflows/update-versions.yml)
(High).

Observed during this spike:

- Live CDN `registry.json`: 38 agents.
- Protocol matrix generated 2026-07-07: 31 agents probed, 30 initialized, 18
  returned `auth_required` on `session/new`, 20 supported `session/list`, 9
  supported `session/resume`.

Source:
[registry protocol matrix](https://github.com/agentclientprotocol/registry/blob/main/.protocol-matrix/latest.md)
(High).

### Selected Agents

| Agent | Verified ACP shipping evidence | Capabilities/notes | Maturity caveats | Confidence |
| --- | --- | --- | --- | --- |
| Codex | Registry entry `codex-acp` v1.1.0; npm `@agentclientprotocol/codex-acp` v1.1.0; repo describes a stdio ACP server that starts Codex App Server and translates ACP requests/events | Matrix: `loadSession`, `session/list`, `session/resume`; authors list OpenAI, JetBrains, Zed | Open issues for rate-limit telemetry over ACP and session metadata pass-through; closed issue for `session/load` missing historical tool calls | High |
| Claude Agent / Claude Code path | Registry entry `claude-acp` v0.57.0; repo uses Claude Agent SDK from ACP clients | Matrix run for v0.56.0 showed `loadSession`, `session/list`, `session/fork`, `session/resume`; wrapper repo active | Registry license field is proprietary, while wrapper repo contribution policy is Apache-2.0; underlying Claude runtime/auth remains vendor-controlled | High |
| Gemini CLI | Registry entry v0.49.0; official docs say `gemini --acp` runs Gemini CLI in ACP mode for programmatic control over stdio | Docs list initialize/auth/new/load/prompt/cancel, session mode/model changes, file-system proxy | Open ACP defects include non-JSON stdout corrupting stream, `session/load` not restoring memory, usage/cost omissions, request-permission ordering | High for existence, Medium for maturity |
| GitHub Copilot CLI / language server | Registry entries `github-copilot-cli` v1.0.68 and `github-copilot` v1.519.0; GitHub docs document Copilot CLI ACP server | Docs say `--acp --stdio` and TCP mode; use cases include IDEs, CI/CD, custom frontends, multi-agent systems | GitHub docs mark ACP support public preview and subject to change | High |
| Goose | Registry entry v1.41.0 with `goose acp` binary args across platforms | Matrix: `loadSession`, `session/list` | Past registry CI/authMethods issue and usage propagation issue were closed; still a sign of fast-moving interop work | Medium |
| OpenCode, Qwen Code, Kimi, Factory Droid, fast-agent | Registry manifests with ACP command args or packages | Useful future targets for target #3+ | Not individually smoke-tested in this dossier beyond registry/matrix evidence | Medium |

Sources:
[Codex ACP registry](https://github.com/agentclientprotocol/registry/blob/main/codex-acp/agent.json),
[codex-acp repo](https://github.com/agentclientprotocol/codex-acp),
[Claude ACP registry](https://github.com/agentclientprotocol/registry/blob/main/claude-acp/agent.json),
[claude-agent-acp repo](https://github.com/agentclientprotocol/claude-agent-acp),
[Gemini ACP docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md),
[Copilot ACP docs](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server),
[Goose registry](https://github.com/agentclientprotocol/registry/blob/main/goose/agent.json)
(High unless caveat rows say Medium).

### Headless Control vs Editor UX

ACP originated around editors/IDEs, and the protocol docs frame clients as
editors by default. However, the official introduction says ACP is suitable for
local and remote scenarios, stdio agents run as subprocesses, and remote
HTTP/WebSocket support is work in progress. Copilot's official docs explicitly
list CI/CD, custom frontends, and multi-agent systems as use cases. Sources:
[ACP introduction](https://agentclientprotocol.com/get-started/introduction),
[Copilot ACP docs](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server)
(High).

Conclusion: ACP can be used headlessly, but LCO must treat "headless-ready" as
an agent-specific smoke gate. Authentication, stdout purity, session restore,
and permission handling are the likely failure points.

## Recall / Lossless Index Angle

ACP helps but does not replace LCO importers:

- `session/list` can discover session metadata such as `sessionId`, `cwd`,
  `title`, and `updatedAt`.
- `session/load` can replay visible conversation history, including message
  chunks; the spec says replay completes before the load response.
- `session/resume` intentionally does not replay history.
- ACP does not define a raw transcript file, byte offsets, local store path,
  event hash contract, or full lossless source archive.

Sources:
[session list](https://agentclientprotocol.com/protocol/v1/session-list),
[session setup](https://agentclientprotocol.com/protocol/v1/session-setup)
(High).

Implementation reality matters. Codex ACP had a closed issue where
`session/load` restored text but missed historical tool calls; Gemini has an
open issue where `session/load` does not restore conversation memory despite
advertising `loadSession`. Sources:
[codex-acp #206](https://github.com/agentclientprotocol/codex-acp/issues/206),
[Gemini #27913](https://github.com/google-gemini/gemini-cli/issues/27913)
(Medium).

Therefore, LCO's importer side stays bespoke for Codex/Claude/etc. ACP replay
can become one additional source if an agent passes a "complete replay" fixture
for messages, tool calls, tool outputs, timestamps/ids, and source refs.

## Governance, Stability, and Risk

Governance:

- ACP is currently jointly governed by Zed and JetBrains, with lead maintainers
  Ben Brandt and Sergey Ignatov and a stated goal of moving toward an
  independent foundation.
- The governance doc names an interim BDFL-style lead-maintainer model.
- The RFD process is ACP's RFC-like path for substantial changes; completed RFDs
  are the state with stability commitment.

Sources:
[governance](https://agentclientprotocol.com/community/governance),
[maintainers](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/MAINTAINERS.md),
[RFD process](https://agentclientprotocol.com/rfds/about) (High).

Licensing:

- `agentclientprotocol/agent-client-protocol` and `agentclientprotocol/registry`
  are Apache-2.0.
- Individual agents may be proprietary or separately licensed.

Sources:
[ACP LICENSE](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/LICENSE),
[registry LICENSE](https://github.com/agentclientprotocol/registry/blob/main/LICENSE),
[registry README](https://github.com/agentclientprotocol/registry#license)
(High).

Versioning:

- Stable wire protocol is negotiated as integer `protocolVersion`; current
  stable version is `1`.
- Schema/crate releases can change generator/API artifacts without changing wire
  compatibility.
- Recent releases in the protocol repo show active churn: Rust crate v1.4.0 and
  schema v1.19.0 were published 2026-07-06.

Sources:
[ACP README versioning](https://github.com/agentclientprotocol/agent-client-protocol#versioning),
[ACP releases](https://github.com/agentclientprotocol/agent-client-protocol/releases)
(High).

MCP overlap/politics:

- ACP and MCP are adjacent, not substitutes. ACP is client-agent control/session
  UX; MCP is tool/context exposure. ACP session setup explicitly carries
  `mcpServers`, and Gemini's ACP docs describe clients exposing functionality as
  MCP tools to Gemini.
- JetBrains publicly positions ACP as open/neutral for IDEs/editors, while
  GitHub Copilot ACP support is public preview. This is a positive Microsoft/
  GitHub signal, but not proof that VS Code itself will make ACP a primary
  native agent-client layer.

Sources:
[session setup MCP servers](https://agentclientprotocol.com/protocol/v1/session-setup),
[Gemini ACP docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md),
[JetBrains ACP post](https://blog.jetbrains.com/ai/2025/10/jetbrains-zed-open-interoperability-for-ai-coding-agents-in-your-ide/),
[Copilot ACP docs](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server)
(Medium for ecosystem posture).

## LCO Cost Model

### Local Baseline

Current LCO target/control work is not only transport code:

- `packages/adapters/src/codex-jsonrpc.ts`: 564 lines. It handles Codex
  app-server stdio, JSON-RPC request/notification parsing, same-connection
  sequences, and bounded turn resolution.
- `packages/adapters/src/policy.ts`: 184 lines. It allowlists read/control
  methods, forbids high-risk Codex methods, and maps LCO tool side effects.
- `packages/adapters/src/index.ts`: 3,364 lines. The `createCodexControl`
  portion owns dry-run audit rows, params/message hashes, approval id matching,
  TTL, live audit rows, and proof-state construction.
- `packages/adapters/src/claude.ts`: 15 lines. Claude is currently a proof
  boundary inventory stub, not parity.
- MCP tool wrappers expose dry-run/live control with `approval_audit_id` and
  `expected_turn_id` schema. Source:
  [`tools.ts`](../../packages/mcp-server/src/tools.ts#L916).
- Release/runtime proof smokes validate dry-run, live hash match, audit tail,
  terminal turn status, action flags, and post-action refresh. Sources:
  [`openclaw-live-control-smoke.ts`](../../packages/cli/src/openclaw-live-control-smoke.ts#L140),
  [`openclaw-post-action-refresh-smoke.ts`](../../packages/cli/src/openclaw-post-action-refresh-smoke.ts#L220).

Line counts were measured with `wc -l` in this worktree (High).

### Option A: ADOPT ACP As LCO Control Plane

Work:

- Build ACP client runtime: process lifecycle, initialize/auth, registry or
  explicit command config, capability negotiation, session map, permission
  handler, `session/update` accumulator, prompt wait/cancel, error normalization.
- Rework LCO target refs and proof output from Codex-specific thread/turn names
  toward ACP sessions and prompt requests.
- Preserve LCO local audit/hashing because ACP does not provide it.
- Backfill per-agent importers anyway for lossless recall.

Rough size: 2-4 weeks for usable multi-agent control and proof migration, plus
additional release-gate rewrites. It could reduce future target transports, but
it risks destabilizing the known Codex app-server proof lane.

Best for target #2/#3 only if Claude/Codex/Gemini/Copilot all pass the same ACP
headless smoke matrix by week 6.

### Option B: WRAP ACP Behind TargetAdapter

Work:

- Add `AcpTargetAdapter` with capability-gated methods: `new/load/resume`,
  `prompt`, `cancel/close`, optional `list`, update/event capture, permission
  policy, and LCO local audit envelope.
- Keep the current Codex JSON-RPC adapter as the known-good proof lane.
- Allow Claude target work to use ACP control if it passes smokes, while Claude
  read/recall importer proceeds from Claude's own local stores.
- Add adapter-level fixtures for stdout purity, initialize/auth, prompt
  stopReason, permission request audit, load/list/replay, and cancellation.

Rough size: 3-6 focused days for minimal headless send/resume/cancel over one
or two ACP agents if using the TypeScript SDK; 1-2 weeks for registry/auth
support, fixtures, and smoke matrix. This preserves LCO proof boundaries while
capturing most transport savings for target #2/#3.

### Option C: IGNORE ACP For Now

Work:

- Build Claude Code target and every later target through bespoke transports.
- Keep current Codex app-server adapter unchanged.
- Revisit ACP after the ecosystem settles.

Rough size: lowest immediate risk for Codex, but highest target #2/#3 cost.
Expect each target to repeat transport/session/auth/progress/cancel/permission
work. This wastes the registry/adoption signal unless ACP smokes fail badly.

## Kill Criteria By Week 6

Flip from WRAP to ADOPT only if all are true:

- ACP client smoke passes on at least Codex, Claude, Gemini, and one of
  Copilot/Goose/OpenCode.
- Each target supports a stable headless auth story and strict stdout framing.
- `session/prompt` terminal stop reason, cancellation, permission requests, and
  session mapping are enough to preserve current LCO proof outputs.
- `session/list` plus `session/load` or `session/resume` semantics are stable
  enough for post-action refresh proof.
- LCO can express `approval_audit_id`/params hash as a local proof envelope
  without depending on peer-specific behavior.
- Current Codex direct proof lane can either be replaced without losing release
  gates or retained as an ACP-internal special case.

Flip from WRAP to IGNORE if any are true by week 6:

- ACP servers continue to fail basic headless framing/auth/session restore for
  the target agents LCO needs.
- Permission/cancellation semantics cannot be made fail-closed in LCO's client.
- No practical way emerges to correlate prompt/cancel/interrupt events strongly
  enough for LCO's live-control proof.
- Claude target work needs bespoke recall/control regardless, and ACP adds more
  wrapper complexity than it removes.

Stay WRAP if the signal remains mixed.

## Trade-Off Table

| Option | Proof-machinery fit | Targets unlocked | Work saved/added | Risk | Lock-in |
| --- | --- | --- | --- | --- | --- |
| ADOPT: LCO becomes ACP client first | Medium. Prompt/session/permission/cancel fit, but dry-run/audit/turn binding remain LCO-local | High if registry agents stay healthy | Saves future transports; adds proof migration and target-ref rewrite now | High due uneven implementations and current Codex proof lane regression risk | Medium ACP lock-in; still open Apache spec |
| WRAP: one ACP TargetAdapter among others | High. LCO keeps proof/audit contract and maps ACP as a transport | Medium-high: Claude/Codex/Gemini/Copilot/Goose candidates without per-agent protocol glue | Saves target #2/#3 transport work while adding limited adapter/smoke cost | Medium; capability probes can fail closed | Low-medium; bespoke adapters remain first-class |
| IGNORE: bespoke target transports only | High for existing Codex direct path | Low beyond current Codex; Claude and future agents cost per target | Saves ACP integration now; adds repeated future transport work | Medium-high opportunity cost | Low ACP lock-in, high bespoke maintenance |

## Source Index

Primary protocol/governance:

- ACP overview: https://agentclientprotocol.com/protocol/v1/overview
- Initialization: https://agentclientprotocol.com/protocol/v1/initialization
- Session setup/load/resume/close: https://agentclientprotocol.com/protocol/v1/session-setup
- Prompt turn: https://agentclientprotocol.com/protocol/v1/prompt-turn
- Tool calls and permission: https://agentclientprotocol.com/protocol/v1/tool-calls
- Cancellation: https://agentclientprotocol.com/protocol/v1/cancellation
- Transports: https://agentclientprotocol.com/protocol/v1/transports
- ACP repo/versioning/license: https://github.com/agentclientprotocol/agent-client-protocol
- Governance: https://agentclientprotocol.com/community/governance
- RFD process: https://agentclientprotocol.com/rfds/about

Registry/adoption:

- Registry repo: https://github.com/agentclientprotocol/registry
- Live registry CDN: https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json
- Protocol matrix: https://github.com/agentclientprotocol/registry/blob/main/.protocol-matrix/latest.md
- Registry RFD: https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/acp-agent-registry.mdx

Selected agents:

- Codex ACP: https://github.com/agentclientprotocol/codex-acp
- Claude Agent ACP: https://github.com/agentclientprotocol/claude-agent-acp
- Gemini ACP docs: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md
- Copilot ACP docs: https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server
- Goose registry entry: https://github.com/agentclientprotocol/registry/blob/main/goose/agent.json

Implementation caveats:

- Gemini stdout framing defect: https://github.com/google-gemini/gemini-cli/issues/22647
- Gemini session/load defect: https://github.com/google-gemini/gemini-cli/issues/27913
- Codex ACP rate-limit telemetry gap: https://github.com/agentclientprotocol/codex-acp/issues/227
- Codex ACP metadata pass-through gap: https://github.com/agentclientprotocol/codex-acp/issues/215
- Codex ACP historical tool-call replay gap, closed: https://github.com/agentclientprotocol/codex-acp/issues/206
- Goose registry/authMethods issue, closed: https://github.com/aaif-goose/goose/issues/7026
- Goose ACP usage propagation issue, closed: https://github.com/aaif-goose/goose/issues/8132

---

## DECISION (ADR) — recorded 2026-07-08 by the orchestrator, per owner-approved roadmap process

**WRAP.** The TargetAdapter seam (EPIC #673 F1) proceeds as designed — per-target transports behind one
interface, with LCO's proof machinery (dry-run packet → HMAC-bound `approval_audit_id` → bounded
turn-wait → post-action refresh) as the invariant contract ABOVE every transport. ACP becomes ONE
transport implementation among others, not the control plane's identity.

Rationale (from the mapping above):
1. ACP does not standardize LCO's differentiating proof primitives — ADOPT would either dilute the audit
   contract to ACP's common denominator or reimplement it locally anyway (WRAP with extra migration risk).
2. ACP is control/replay, not a transcript/index API — the importer half of every TargetAdapter stays
   bespoke regardless, so ADOPT never collapses the seam.
3. Codex stays NATIVE (steer/interrupt live proof requires turn-binding ACP lacks; no regression risk to
   the proven lane).
4. Protocol #2 for the F1 two-protocol validation is **Claude-native** (`claude -p --resume` / Agent SDK)
   — maximum protocol diversity for validating the seam (app-server JSON-RPC vs CLI/SDK). An **ACP
   generic adapter is the fast-follow third transport** (targets Gemini/Copilot/Goose et al. without
   per-agent glue), scheduled opportunistically in 1.6.0/1.7.0.
5. Kill criteria stand as written: if ACP RFDs land stable turn-ids/audit-metadata hooks, or a needed
   target ships ACP-only, revisit ADOPT at the 1.7.0 boundary.
