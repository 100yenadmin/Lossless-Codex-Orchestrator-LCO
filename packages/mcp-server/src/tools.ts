import {
  configuredLcmPeerDbPaths,
  createCloseoutEnvelopeReport,
  describeSession,
  describeRecallRef,
  defaultCodexRoots,
  createIndexedSessionSanitizerReport,
  createIndexedSessionSanitizerRepairPlan,
  expandSession,
  expandQuery,
  getCodexFinalMessages,
  getCodexPlans,
  getCodexSessionManagementMap,
  getCodexThreadMap,
  getCodexTouchedFiles,
  getCodexToolCalls,
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
      approval_ref: { type: "string" }
    }, (input) => createDesktopLiveProofHarness({
      backend: optionalDesktopBackend(input.backend),
      targetApp: optionalString(input.target_app),
      targetWindow: optionalString(input.target_window),
      action: optionalString(input.action),
      approvalRef: optionalString(input.approval_ref),
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
  return {
    ...result,
    approval_audit_id: result.approvalAuditId,
    params_hash: result.paramsHash,
    message_hash: result.messageHash
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

function optionalProfile(value: unknown): "metadata" | "brief" | "evidence" | undefined {
  if (value === undefined) return undefined;
  if (value === "metadata" || value === "brief" || value === "evidence") return value;
  throw new Error("profile must be metadata, brief, or evidence");
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
