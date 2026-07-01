import { existsSync, readFileSync } from "node:fs";

import {
  configuredLcmPeerDbPaths,
  createCloseoutEnvelopeReport,
  createAttentionInbox,
  createBusinessPulse,
  describeSession,
  describeRecallRef,
  defaultCodexRoots,
  createIndexedSessionSanitizerReport,
  createIndexedSessionSanitizerRepairPlan,
  expandSession,
  expandQuery,
  createPlanStatePinsReport,
  createProjectDigest,
  getCockpitInbox,
  getCodexFinalMessages,
  getCodexPlans,
  getCodexSessionManagementMap,
  getCodexThreadMap,
  getCodexTouchedFiles,
  getCodexToolCalls,
  getRecentSessions,
  grepRecall,
  indexCodexSessions,
  probeLcmPeerDbs,
  probeCodexSqliteStores,
  type LooDatabase,
  searchSessions
} from "../../core/src/index.js";
import {
  LOO_COMMAND_POLICY,
  codexTransportStatus,
  createCodexControl,
  createDesktopGuiProofReport,
  createDesktopLiveProofHarness,
  createDesktopProofAction,
  desktopActDryRun,
  desktopFallbackDiagnostics,
  desktopSee,
  isDesktopBackend,
  type AuditStore,
  type DesktopBackend,
  type CodexClient,
  type DesktopProbe
} from "../../adapters/src/index.js";

export type LooTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<unknown> | unknown;
};

export type LooToolDeclaration = Pick<LooTool, "name" | "description" | "inputSchema">;

const metadataOnlyAudit: AuditStore = {
  path: "metadata-only",
  append() {
    throw new Error("metadata-only audit store cannot append records");
  },
  find() {
    return null;
  },
  tail() {
    return [];
  },
  fingerprintText() {
    return "metadata-only";
  },
  fingerprintValue() {
    return "metadata-only";
  }
};

const metadataOnlyCodexClient: CodexClient = {
  async request() {
    throw new Error("metadata-only Codex client cannot execute requests");
  }
};

export function createLooToolDeclarations(): LooToolDeclaration[] {
  return createLooTools({
    db: {} as LooDatabase,
    audit: metadataOnlyAudit,
    codexClient: metadataOnlyCodexClient
  }).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export function createLooTools(options: { db: LooDatabase; audit: AuditStore; codexClient: CodexClient; desktopProbe?: DesktopProbe }): LooTool[] {
  const control = createCodexControl({ audit: options.audit, client: options.codexClient });
  return [
    tool("loo_index_sessions", "Index local Codex session JSONL files into the local orchestrator database.", {
      roots: { type: "array", items: { type: "string" } },
      max_files: { type: "integer", minimum: 1, maximum: 100000 },
      max_bytes_per_file: { type: "integer", minimum: 1, maximum: 1073741824 },
      max_events_per_file: { type: "integer", minimum: 1, maximum: 1000000 }
    }, (input) => indexCodexSessions(options.db, {
      roots: optionalRoots(input.roots, defaultCodexRoots()),
      maxFiles: optionalNumber(input.max_files),
      maxBytesPerFile: optionalNumber(input.max_bytes_per_file),
      maxEventsPerFile: optionalNumber(input.max_events_per_file)
    })),
    tool("loo_search_sessions", "Search indexed Codex sessions with bounded safe text.", {
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100 }
    }, (input) => searchSessions(options.db, { query: requiredString(input.query, "query"), limit: optionalNumber(input.limit) })),
    tool("loo_grep", "Search Codex index and optional read-only OpenClaw LCM peer DBs with source-prefixed refs.", {
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      profile: { type: "string", enum: ["metadata", "brief", "evidence"] },
      token_budget: { type: "integer", minimum: 20, maximum: 8000 },
      lcm_db_paths: { type: "array", items: { type: "string" } }
    }, (input) => grepRecall(options.db, {
      query: requiredString(input.query, "query"),
      limit: optionalNumber(input.limit),
      profile: optionalProfile(input.profile),
      tokenBudget: optionalNumber(input.token_budget),
      lcmDbPaths: optionalRoots(input.lcm_db_paths, configuredLcmPeerDbPaths())
    })),
    tool("loo_describe_session", "Describe one indexed Codex session by thread id.", {
      thread_id: { type: "string" }
    }, (input) => describeSession(options.db, requiredString(input.thread_id, "thread_id"))),
    tool("loo_describe_ref", "Describe a source-prefixed recall ref such as codex_thread:* or lcm_summary:*.", {
      source_ref: { type: "string" },
      lcm_db_paths: { type: "array", items: { type: "string" } }
    }, (input) => describeRecallRef(options.db, {
      sourceRef: requiredString(input.source_ref, "source_ref"),
      lcmDbPaths: optionalRoots(input.lcm_db_paths, configuredLcmPeerDbPaths())
    })),
    tool("loo_expand_session", "Expand one indexed Codex session into a bounded evidence brief.", {
      thread_id: { type: "string" },
      profile: { type: "string", enum: ["metadata", "brief", "evidence"] },
      token_budget: { type: "integer", minimum: 20, maximum: 8000 }
    }, (input) => expandSession(options.db, { threadId: requiredString(input.thread_id, "thread_id"), profile: optionalProfile(input.profile), tokenBudget: optionalNumber(input.token_budget) })),
    tool("loo_expand_query", "Search then expand the best matching Codex or LCM peer recall ref.", {
      query: { type: "string" },
      profile: { type: "string", enum: ["metadata", "brief", "evidence"] },
      token_budget: { type: "integer", minimum: 20, maximum: 8000 },
      lcm_db_paths: { type: "array", items: { type: "string" } }
    }, (input) => expandQuery(options.db, {
      query: requiredString(input.query, "query"),
      profile: optionalProfile(input.profile),
      tokenBudget: optionalNumber(input.token_budget),
      lcmDbPaths: optionalRoots(input.lcm_db_paths, configuredLcmPeerDbPaths())
    })),
    tool("loo_codex_thread_map", "Read the indexed Codex thread map.", {
      limit: { type: "integer", minimum: 1, maximum: 500 },
      project: { type: "string" },
      status: { type: "string" },
      priority: { type: "string" },
      blocker: { type: "string" },
      priority_order: { type: "array", items: { type: "string" } }
    }, (input) => getCodexThreadMap(options.db, {
      limit: optionalNumber(input.limit),
      project: optionalString(input.project),
      status: optionalString(input.status),
      priority: optionalString(input.priority),
      blocker: optionalString(input.blocker),
      priorityOrder: optionalStringArray(input.priority_order)
    })),
    tool("loo_codex_session_management_map", "Read a public-safe orchestration map for active, blocked, expansion, archive, fork, and resume lanes.", {
      limit: { type: "integer", minimum: 1, maximum: 500 },
      project: { type: "string" },
      status: { type: "string" },
      priority: { type: "string" },
      blocker: { type: "string" },
      priority_order: { type: "array", items: { type: "string" } }
    }, (input) => getCodexSessionManagementMap(options.db, {
      limit: optionalNumber(input.limit),
      project: optionalString(input.project),
      status: optionalString(input.status),
      priority: optionalString(input.priority),
      blocker: optionalString(input.blocker),
      priorityOrder: optionalStringArray(input.priority_order)
    })),
    tool("loo_recent_sessions", "List recent or active Codex sessions as compact public-safe cards without requiring query text.", {
      scope: { type: "string", enum: ["active", "recent", "all"] },
      since: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 500 },
      repo: { type: "string" },
      status: { type: "string" },
      has_plan: { type: "boolean" },
      has_final: { type: "boolean" },
      has_blocker: { type: "boolean" },
      touched_path: { type: "string" },
      risk: { type: "string", enum: ["low", "medium", "high"] },
      include_cards: { type: "boolean" }
    }, (input) => getRecentSessions(options.db, {
      scope: optionalRecentScope(input.scope),
      since: optionalString(input.since),
      limit: optionalNumber(input.limit),
      repo: optionalString(input.repo),
      status: optionalString(input.status),
      hasPlan: optionalBoolean(input.has_plan),
      hasFinal: optionalBoolean(input.has_final),
      hasBlocker: optionalBoolean(input.has_blocker),
      touchedPath: optionalString(input.touched_path),
      risk: optionalRisk(input.risk),
      includeCards: input.include_cards !== false
    })),
    tool("loo_cockpit_inbox", "Rank Codex sessions that need attention using deterministic public-safe session cards.", {
      limit: { type: "integer", minimum: 1, maximum: 500 },
      priority_order: { type: "array", items: { type: "string" } }
    }, (input) => getCockpitInbox(options.db, {
      limit: optionalNumber(input.limit),
      priorityOrder: optionalStringArray(input.priority_order)
    })),
    tool("loo_plan_state_pins", "Extract only manual pins, approval boundaries, and exception ledger entries from PLAN_STATE text.", {
      plan_state_text: { type: "string" },
      plan_state_path: { type: "string" }
    }, (input) => createPlanStatePinsReport(resolvePlanStateText(input))),
    tool("loo_project_digest", "Create a read-only Eva operating digest from LCO/Codex cards, optional structured GitHub items, and PLAN_STATE pins.", {
      window: { type: "string", enum: ["today", "24h", "7d", "custom"] },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      max_tokens: { type: "integer", minimum: 100, maximum: 8000 },
      plan_state_text: { type: "string" },
      plan_state_path: { type: "string" },
      github_items: { type: "array", items: { type: "object", additionalProperties: true } }
    }, (input) => createProjectDigest(options.db, {
      window: optionalDigestWindow(input.window),
      limit: optionalNumber(input.limit),
      maxTokens: optionalNumber(input.max_tokens),
      planStatePins: createPlanStatePinsReport(resolvePlanStateText(input)),
      githubItems: optionalGithubItems(input.github_items)
    })),
    tool("loo_attention_inbox", "Return only operating-picture cards that need action, review, approval, watch, or blocker triage.", {
      window: { type: "string", enum: ["today", "24h", "7d", "custom"] },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      plan_state_text: { type: "string" },
      plan_state_path: { type: "string" },
      github_items: { type: "array", items: { type: "object", additionalProperties: true } }
    }, (input) => createAttentionInbox(options.db, {
      window: optionalDigestWindow(input.window),
      limit: optionalNumber(input.limit),
      planStatePins: createPlanStatePinsReport(resolvePlanStateText(input)),
      githubItems: optionalGithubItems(input.github_items)
    })),
    tool("loo_business_pulse", "Answer 'How is the business?' from bounded cited operating cards with explicit source coverage gaps.", {
      window: { type: "string", enum: ["today", "24h", "7d", "custom"] },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      plan_state_text: { type: "string" },
      plan_state_path: { type: "string" },
      github_items: { type: "array", items: { type: "object", additionalProperties: true } }
    }, (input) => createBusinessPulse(options.db, {
      window: optionalDigestWindow(input.window),
      limit: optionalNumber(input.limit),
      planStatePins: createPlanStatePinsReport(resolvePlanStateText(input)),
      githubItems: optionalGithubItems(input.github_items)
    })),
    tool("loo_codex_final_messages", "Read final assistant/status messages extracted from Codex sessions.", {
      thread_id: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 500 }
    }, (input) => getCodexFinalMessages(options.db, { threadId: optionalString(input.thread_id), limit: optionalNumber(input.limit) })),
    tool("loo_codex_plans", "Read proposed_plan blocks extracted from Codex sessions.", {
      thread_id: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 500 }
    }, (input) => getCodexPlans(options.db, { threadId: optionalString(input.thread_id), limit: optionalNumber(input.limit) })),
    tool("loo_codex_touched_files", "Read touched files extracted for one Codex session.", {
      thread_id: { type: "string" }
    }, (input) => getCodexTouchedFiles(options.db, { threadId: requiredString(input.thread_id, "thread_id") })),
    tool("loo_codex_tool_calls", "Read redacted tool-call metadata extracted from Codex sessions.", {
      thread_id: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 1000 }
    }, (input) => getCodexToolCalls(options.db, { threadId: optionalString(input.thread_id), limit: optionalNumber(input.limit) })),
    tool("loo_closeout_dry_run", "Preview public-safe closeout envelopes that a hook-agent could attach without mutating Codex.", {
      thread_id: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 500 },
      include_unavailable: { type: "boolean" }
    }, (input) => createCloseoutEnvelopeReport(options.db, {
      threadId: optionalString(input.thread_id),
      limit: optionalNumber(input.limit),
      includeUnavailable: input.include_unavailable === true
    })),
    tool("loo_session_sanitizer", "Dry-run public-safe sanitizer findings from indexed Codex safe text without reading raw transcripts or mutating sessions.", {
      thread_id: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 500 },
      repair_plan: { type: "boolean" }
    }, (input) => {
      const report = createIndexedSessionSanitizerReport(options.db, {
        threadId: optionalString(input.thread_id),
        limit: optionalNumber(input.limit)
      });
      return input.repair_plan === true
        ? { ...report, repairPlan: createIndexedSessionSanitizerRepairPlan(report) }
        : report;
    }),
    tool("loo_codex_sqlite_stores", "Probe local Codex state_*.sqlite and logs_*.sqlite stores read-only.", {
      roots: { type: "array", items: { type: "string" } },
      max_files: { type: "integer", minimum: 1, maximum: 1000 }
    }, (input) => probeCodexSqliteStores(optionalRoots(input.roots, [`${process.env.HOME || "."}/.codex`]), optionalNumber(input.max_files))),
    tool("loo_lcm_peer_dbs", "Probe configured OpenClaw LCM peer DBs read-only.", {
      lcm_db_paths: { type: "array", items: { type: "string" } }
    }, (input) => probeLcmPeerDbs(optionalRoots(input.lcm_db_paths, configuredLcmPeerDbPaths()))),
    tool("loo_codex_control_dry_run", "Create a dry-run audit id for a Codex control action.", {
      action: { type: "string", enum: ["send", "resume", "steer", "interrupt"] },
      thread_id: { type: "string" },
      message: { type: "string" }
    }, (input) => snakeCaseControlResult(dispatchControl(control, input, true))),
    tool("loo_codex_resume_thread", "Resume or rejoin a Codex thread. Live mode requires approval_audit_id.", controlSchema(), (input) => snakeCaseControlResult(control.resumeThread(controlInput(input)))),
    tool("loo_codex_send_message", "Send a message to a Codex thread. Live mode requires approval_audit_id.", controlSchema(true), (input) => snakeCaseControlResult(control.sendMessage(messageControlInput(input)))),
    tool("loo_codex_steer_thread", "Steer a running Codex thread. Live mode requires approval_audit_id.", controlSchema(true), (input) => snakeCaseControlResult(control.steerThread(messageControlInput(input)))),
    tool("loo_codex_interrupt_thread", "Interrupt a Codex thread. Live mode requires approval_audit_id.", controlSchema(), (input) => snakeCaseControlResult(control.interruptThread(controlInput(input)))),
    tool("loo_desktop_see", "Inspect desktop fallback readiness through direct/CUA/Peekaboo backends.", {
      backend: { type: "string", enum: ["direct", "cua-driver", "peekaboo"] },
      include_snapshot: { type: "boolean" },
      max_nodes: { type: "integer", minimum: 1, maximum: 500 },
      max_chars: { type: "integer", minimum: 1, maximum: 20000 }
    }, (input) => desktopSee({
      backend: optionalDesktopBackend(input.backend),
      includeSnapshot: input.include_snapshot === true,
      maxNodes: optionalNumber(input.max_nodes),
      maxChars: optionalNumber(input.max_chars),
      probe: options.desktopProbe
    })),
    tool("loo_desktop_act", "Dry-run desktop fallback action for CUA/Peekaboo; live requests return structured missing-proof blockers.", {
      backend: { type: "string", enum: ["direct", "cua-driver", "peekaboo"] },
      action: { type: "string" },
      dry_run: { type: "boolean" },
      target_app: { type: "string" },
      target_window: { type: "string" },
      action_hash: { type: "string" },
      approval_ref: { type: "string" },
      permission_state: { type: "string" },
      focus_before_application: { type: "string" },
      focus_after_application: { type: "string" },
      public_safe_observation: { type: "boolean" }
    }, (input) => desktopActDryRun({
      backend: optionalDesktopBackend(input.backend),
      action: optionalString(input.action),
      dryRun: input.dry_run !== false,
      targetApp: optionalString(input.target_app),
      targetWindow: optionalString(input.target_window),
      actionHash: optionalString(input.action_hash),
      approvalRef: optionalString(input.approval_ref),
      permissionState: optionalString(input.permission_state),
      focusBeforeApplication: optionalString(input.focus_before_application),
      focusAfterApplication: optionalString(input.focus_after_application),
      publicSafeObservation: input.public_safe_observation === true
    })),
    tool("loo_desktop_proof_report", "Validate a supplied public-safe desktop GUI action observation and return release-compatible proof when it satisfies no-focus/action-bound gates.", {
      observation: {
        type: "object",
        additionalProperties: true
      }
    }, (input) => createDesktopGuiProofReport(input.observation)),
    tool("loo_desktop_live_proof_harness", "Prepare a public-safe desktop live/no-focus proof packet without running the GUI action.", {
      backend: { type: "string", enum: ["direct", "cua-driver", "peekaboo"] },
      target_app: { type: "string" },
      target_window: { type: "string" },
      action: { type: "string" },
      approval_ref: { type: "string" },
      scratch_file_path: { type: "string" }
    }, (input) => createDesktopLiveProofHarness({
      backend: optionalDesktopBackend(input.backend),
      targetApp: optionalString(input.target_app),
      targetWindow: optionalString(input.target_window),
      action: optionalString(input.action),
      approvalRef: optionalString(input.approval_ref),
      scratchFilePath: optionalString(input.scratch_file_path),
      probe: options.desktopProbe
    })),
    tool("loo_desktop_proof_action", "Run the one approved CUA TextEdit scratch launch proof action and return a public-safe observation for proof-report validation.", {
      backend: { type: "string", enum: ["cua-driver"] },
      target_app: { type: "string", enum: ["TextEdit"] },
      target_window: { type: "string", enum: ["lco-desktop-proof.txt"] },
      action: { type: "string", enum: ["launch_app TextEdit scratch window"] },
      action_hash: { type: "string" },
      approval_ref: { type: "string" },
      approval_artifact: {
        type: "object",
        additionalProperties: true
      },
      permission_state: { type: "string" },
      scratch_file_path: { type: "string" },
      execute: { type: "boolean" }
    }, (input) => createDesktopProofAction({
      backend: optionalDesktopBackend(input.backend),
      targetApp: optionalString(input.target_app),
      targetWindow: optionalString(input.target_window),
      action: optionalString(input.action),
      actionHash: optionalString(input.action_hash),
      approvalRef: optionalString(input.approval_ref),
      approvalArtifact: input.approval_artifact,
      permissionState: optionalString(input.permission_state),
      scratchFilePath: optionalString(input.scratch_file_path),
      execute: input.execute === true,
      probe: options.desktopProbe
    })),
    tool("loo_doctor", "Read local orchestrator health.", {}, () => ({
      ok: true,
      localOnly: true,
      toolPrefix: "loo_*",
      codex: codexTransportStatus({ command: process.env.LOO_CODEX_BIN || "codex" }),
      lcmPeers: probeLcmPeerDbs(configuredLcmPeerDbPaths()),
      desktopFallbacks: desktopFallbackDiagnostics({ probe: options.desktopProbe })
    })),
    tool("loo_permissions", "Read safety posture for live controls.", {}, () => ({
      liveControlRequires: ["dry_run", "approval_audit_id"],
      uploadsLocalText: false,
      commandPolicy: LOO_COMMAND_POLICY
    })),
    tool("loo_audit_tail", "Read recent local audit records without raw prompt text.", {
      limit: { type: "integer", minimum: 1, maximum: 1000 }
    }, (input) => ({ auditPath: options.audit.path, records: options.audit.tail(optionalNumber(input.limit) ?? 20) }))
  ];
}

function tool(name: string, description: string, properties: Record<string, unknown>, execute: LooTool["execute"]): LooTool {
  return {
    name,
    description,
    inputSchema: { type: "object", additionalProperties: false, properties },
    execute
  };
}

function dispatchControl(control: ReturnType<typeof createCodexControl>, input: Record<string, unknown>, dryRun: boolean) {
  const action = requiredString(input.action, "action");
  const common = { threadId: requiredString(input.thread_id, "thread_id"), message: optionalString(input.message) ?? "continue", dryRun };
  if (action === "send") return control.sendMessage(common);
  if (action === "resume") return control.resumeThread(common);
  if (action === "steer") return control.steerThread(common);
  if (action === "interrupt") return control.interruptThread(common);
  throw new Error(`Unsupported control action: ${action}`);
}

function controlSchema(message = false): Record<string, unknown> {
  return {
    thread_id: { type: "string" },
    ...(message ? { message: { type: "string" } } : {}),
    dry_run: { type: "boolean", default: true },
    approval_audit_id: { type: "string" }
  };
}

function controlInput(input: Record<string, unknown>, message = false) {
  return {
    threadId: requiredString(input.thread_id, "thread_id"),
    ...(message ? { message: requiredString(input.message, "message") } : {}),
    dryRun: input.dry_run !== false,
    approvalAuditId: optionalString(input.approval_audit_id)
  };
}

function messageControlInput(input: Record<string, unknown>) {
  return {
    threadId: requiredString(input.thread_id, "thread_id"),
    message: requiredString(input.message, "message"),
    dryRun: input.dry_run !== false,
    approvalAuditId: optionalString(input.approval_audit_id)
  };
}

async function snakeCaseControlResult(value: Promise<any>) {
  const result = await value;
  const approvalPacket = result.live === false ? approvalPacketFromControlResult(result) : undefined;
  return {
    ...result,
    approval_audit_id: result.approvalAuditId,
    params_hash: result.paramsHash,
    message_hash: result.messageHash,
    ...(approvalPacket ? { approval_packet: approvalPacket } : {})
  };
}

function approvalPacketFromControlResult(result: any): Record<string, unknown> {
  const action = String(result.action ?? "resume");
  const packetAction = action === "send"
    ? "send_message"
    : action === "steer"
      ? "steer_thread"
      : action === "interrupt"
        ? "interrupt_thread"
        : "resume_session";
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  return {
    schema: "lco.approvalPacket.v1",
    packetId: `ap_${String(result.approvalAuditId ?? "unknown").replace(/^loo_audit_/, "")}`,
    action: packetAction,
    target: {
      sessionId: `sess_${String(result.threadId ?? "unknown")}`,
      title: String(result.threadId ?? "unknown")
    },
    intent: `${packetAction} dry-run for ${String(result.threadId ?? "unknown")}`,
    predictedMutation: [String(result.method ?? "codex_control")],
    preconditions: ["dry_run_record_exists", "matching_params_hash_required", "approval_packet_not_expired"],
    risk: {
      level: action === "interrupt" ? "high" : "medium",
      requiresHuman: true,
      reasons: ["codex_thread_mutation"]
    },
    rollback: {
      available: false,
      reason: "Codex thread messages and control actions cannot be undone by LCO."
    },
    approvalBoundary: "This packet approves only the described Codex control action for this exact target and hash; no commits, pushes, deploys, GUI actions, external messages, or other thread targets are authorized.",
    expiresAt,
    hashes: {
      paramsHash: String(result.paramsHash ?? ""),
      ...(result.messageHash ? { messageHash: String(result.messageHash) } : {})
    }
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalProfile(value: unknown): "metadata" | "brief" | "evidence" | undefined {
  if (value === undefined) return undefined;
  if (value === "metadata" || value === "brief" || value === "evidence") return value;
  throw new Error("profile must be metadata, brief, or evidence");
}

function optionalRecentScope(value: unknown): "active" | "recent" | "all" | undefined {
  if (value === undefined) return undefined;
  if (value === "active" || value === "recent" || value === "all") return value;
  throw new Error("scope must be active, recent, or all");
}

function optionalRisk(value: unknown): "low" | "medium" | "high" | undefined {
  if (value === undefined) return undefined;
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("risk must be low, medium, or high");
}

function optionalDigestWindow(value: unknown): "today" | "24h" | "7d" | "custom" | undefined {
  if (value === undefined) return undefined;
  if (value === "today" || value === "24h" || value === "7d" || value === "custom") return value;
  throw new Error("window must be today, 24h, 7d, or custom");
}

function optionalDesktopBackend(value: unknown): DesktopBackend | undefined {
  if (value === undefined) return undefined;
  if (isDesktopBackend(value)) return value;
  throw new Error("desktop backend must be direct, cua-driver, or peekaboo");
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("roots must be an array");
  return value.map((item) => requiredString(item, "roots[]"));
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  return stringArray(value);
}

function optionalRoots(value: unknown, fallback: string[]): string[] {
  const roots = optionalStringArray(value);
  return roots && roots.length > 0 ? roots : fallback;
}

function resolvePlanStateText(input: Record<string, unknown>): string {
  const inline = optionalString(input.plan_state_text);
  if (inline !== undefined) return inline;
  const path = optionalString(input.plan_state_path);
  if (path !== undefined && existsSync(path)) return readFileSync(path, "utf8");
  return "";
}

function optionalGithubItems(value: unknown): Array<{
  id: string;
  title: string;
  state?: "green" | "yellow" | "red" | "unknown";
  urgency?: "low" | "medium" | "high" | "critical";
  reasonCodes?: string[];
  updatedAt?: string | null;
  nextAction?: string;
}> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("github_items must be an array");
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = optionalString(record.id);
    const title = optionalString(record.title);
    if (!id || !title) return [];
    const state = optionalOperatingState(record.state);
    const urgency = optionalOperatingUrgency(record.urgency);
    return [{
      id,
      title,
      ...(state ? { state } : {}),
      ...(urgency ? { urgency } : {}),
      reasonCodes: optionalStringArray(record.reasonCodes ?? record.reason_codes),
      updatedAt: optionalString(record.updatedAt ?? record.updated_at) ?? null,
      nextAction: optionalString(record.nextAction ?? record.next_action)
    }];
  });
}

function optionalOperatingState(value: unknown): "green" | "yellow" | "red" | "unknown" | undefined {
  if (value === undefined) return undefined;
  if (value === "green" || value === "yellow" || value === "red" || value === "unknown") return value;
  throw new Error("github item state must be green, yellow, red, or unknown");
}

function optionalOperatingUrgency(value: unknown): "low" | "medium" | "high" | "critical" | undefined {
  if (value === undefined) return undefined;
  if (value === "low" || value === "medium" || value === "high" || value === "critical") return value;
  throw new Error("github item urgency must be low, medium, high, or critical");
}
