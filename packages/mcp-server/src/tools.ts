import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import {
  configuredLcmPeerDbPaths,
  createCloseoutEnvelopeReport,
  createAttentionInbox,
  createBusinessPulse,
  createCodexActiveThreadState,
  createCodexAutonomyTick,
  createCodexCollaborationNextSteps,
  createCodexCollaborationCockpit,
  createCodexRuntimeDesktopVisibilityStatus,
  createSessionDiffSetupRequiredReport,
  createFindRecallReport,
  createRecallIndexSummary,
  createCodexThreadNotFoundResult,
  describeSession,
  describeRecallRef,
  defaultClaudeRoots,
  defaultCodexRoots,
  createIndexedSessionSanitizerReport,
  createIndexedSessionSanitizerRepairPlan,
  createRecallRefNotFoundResult,
  defaultDatabasePath,
  expandSession,
  expandQuery,
  expandSummaryLeaves,
  getPreparedCards,
  getPreparedInbox,
  getPreparedStateStatus,
  getSessionDiff,
  PREPARED_CARD_STATES,
  getWatcherEvents,
  createPlanStatePinsReport,
  createGithubOperatingItemsReport,
  createProjectDigest,
  createResumeRequestPacket,
  createWatcherStatusReport,
  createCodexDesktopCoherenceReport,
  createVisibleCodexSessionMap,
  getCockpitInbox,
  getCodexFinalMessages,
  getCodexPlans,
  getCodexSessionManagementMap,
  getCodexThreadMap,
  getCodexTouchedFiles,
  getCodexToolCalls,
  getCodexEventContentStatus,
  getCodexJsonlDriftStatus,
  getDatabaseStorageStatus,
  getRecentSessions,
  getSummaryLeaves,
  grepRecall,
  indexClaudeSessions,
  indexCodexSessions,
  isSessionDiffSetupError,
  probeLcmPeerDbs,
  probeCodexSqliteStores,
  resolveSessionDiffCursorKey,
  type LooDatabase,
  type AppServerThreadsInput,
  type VisibleCodexInput,
  type VisibleCodexSessionMapReport,
  type PreparedCardState,
  type SummaryLeafKind,
  type WatchSpec,
  searchSessions
} from "../../core/src/index.js";
import {
  LOO_COMMAND_POLICY,
  createCodexAppServerStatusReport,
  createCodexAppServerThreadsReport,
  codexTransportStatus,
  createCodexControl,
  createDriveReport,
  createCodexDesktopCollaborationProof,
  createCodexDesktopFallbackReport,
  createDesktopGuiProofReport,
  createDesktopLiveProofHarness,
  createDesktopProofAction,
  desktopActDryRun,
  desktopFallbackDiagnostics,
  desktopSee,
  isDesktopBackend,
  redactValue,
  type AuditStore,
  type DesktopBackend,
  type CodexClient,
  type DriveHarness,
  type DesktopProbe,
  type LooCommandSafety
} from "../../adapters/src/index.js";
import { probeClaudeDryRunAvailability } from "../../adapters/src/claude.js";
import { readEnv, readEnvWithFallback, resolveHomeDir } from "../../runtime/src/env.js";

export type LooTool = {
  name: string;
  description: string;
  safety: LooCommandSafety;
  metadata: LooToolSurfaceMetadata;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<unknown> | unknown;
};

export type LooToolTier = "public_facade" | "workflow_detail" | "proof_debug" | "internal_low_level";
export type LooToolProfile = "facade" | "standard" | "all";

export type LooToolSurfaceMetadata = {
  tier: LooToolTier;
  operatorPathRank?: number;
  operatorPathRole?: string;
  aliasOf?: string;
};

export type LooToolAliasDeclaration = {
  targetName: string;
  kindDefaults?: Record<string, unknown>;
};

export type LooToolAliasRegistry = Record<string, LooToolAliasDeclaration>;

export type LooToolSurfaceSummary = {
  tiers: LooToolTier[];
  publicFacadeTools: string[];
  namingPolicy: {
    publicProductAbbreviation: "LCO";
    forwardPublicAliasTarget: "lco_*";
    currentRuntimePrefix: "lco_";
    legacyCompatiblePrefix: "loo_";
    packageName: "lossless-openclaw-orchestrator";
    compatibilityIssue: "#616";
    aliasPolicy: string;
  };
  desktopFallback: {
    normalFirstPath: "direct Codex protocol";
    preferredBackend: "cua-driver";
    preferredLaunch: "cua-driver mcp";
    bundledByLco: false;
    secondaryBackend: "peekaboo";
    missingPreferredBackendBehavior: string;
    proofBoundary: string;
  };
  exposureProfile: {
    environmentVariable: "LCO_TOOL_PROFILE";
    defaultProfile: "all";
    profiles: Record<LooToolProfile, {
      tiers: LooToolTier[];
      includesFacadeAliases: boolean;
      description: string;
    }>;
    callPolicy: string;
  };
  retrievalTelemetry: {
    environmentVariable: "LCO_TELEMETRY";
    enabledValue: "1";
    defaultEnabled: false;
    affectedTools: string[];
    mutationMode: "local_cache_write";
    mutationClasses: ["derived_cache"];
    privacyBoundary: string;
  };
  proofBoundary: string;
};

export type LooToolDeclaration = Pick<LooTool, "name" | "description" | "safety" | "metadata" | "inputSchema">;

export const LOO_TOOL_TIERS: LooToolTier[] = ["public_facade", "workflow_detail", "proof_debug", "internal_low_level"];
export const LOO_TOOL_PROFILE_TIERS: Record<LooToolProfile, LooToolTier[]> = {
  facade: ["public_facade"],
  standard: ["public_facade", "workflow_detail"],
  all: ["public_facade", "workflow_detail", "proof_debug", "internal_low_level"]
};

export const LOO_TOOL_SURFACE: Record<string, LooToolSurfaceMetadata> = {
  lco_index_sessions: { tier: "workflow_detail" },
  lco_find: {
    tier: "public_facade",
    operatorPathRank: 1,
    operatorPathRole: "Find local Codex work from one query with a bounded first-run index pass and public-safe refs."
  },
  lco_search_sessions: { tier: "workflow_detail" },
  lco_grep: { tier: "workflow_detail" },
  lco_describe_ref: {
    tier: "public_facade",
    operatorPathRank: 3,
    operatorPathRole: "Look up a specific session or source ref after the inbox identifies it."
  },
  lco_expand_session: { tier: "workflow_detail" },
  lco_expand_query: {
    tier: "public_facade",
    operatorPathRank: 4,
    operatorPathRole: "Expand one bounded evidence brief from a query when the ref is not known."
  },
  lco_prepared_state: { tier: "workflow_detail" },
  lco_prepared_inbox: {
    tier: "public_facade",
    operatorPathRank: 2,
    operatorPathRole: "Start from the compact prepared-state operating picture."
  },
  lco_session_diff: {
    tier: "workflow_detail",
    operatorPathRole: "Inspect what changed since a previous opaque cursor before drive/control planning."
  },
  lco_recent_sessions: {
    tier: "public_facade",
    operatorPathRank: 5,
    operatorPathRole: "Refresh recent or active session cards after reads or approved actions."
  },
  lco_watchers: { tier: "workflow_detail" },
  lco_codex_app_server_status: { tier: "proof_debug" },
  lco_codex_app_server_threads: { tier: "internal_low_level" },
  lco_visible_codex_map: { tier: "proof_debug" },
  lco_operating_picture: { tier: "workflow_detail" },
  lco_project_digest: {
    tier: "public_facade",
    operatorPathRank: 7,
    operatorPathRole: "Create a bounded provenance and handoff digest from available operating inputs."
  },
  lco_attention_inbox: {
    tier: "public_facade",
    operatorPathRank: 6,
    operatorPathRole: "Review the compact attention queue before choosing a next action."
  },
  lco_business_pulse: { tier: "workflow_detail" },
  lco_codex_extract: { tier: "workflow_detail" },
  lco_closeout_dry_run: { tier: "workflow_detail" },
  lco_session_sanitizer: { tier: "proof_debug" },
  lco_codex_sqlite_stores: { tier: "internal_low_level" },
  lco_lcm_peer_dbs: { tier: "internal_low_level" },
  lco_drive: {
    tier: "public_facade",
    operatorPathRank: 8,
    operatorPathRole: "Create a bounded review-then-drive plan and real target-adapter dry-run audit packet."
  },
  lco_codex_control_dry_run: { tier: "workflow_detail" },
  lco_codex_start_thread: { tier: "workflow_detail" },
  lco_codex_resume_thread: {
    tier: "public_facade",
    operatorPathRank: 9,
    operatorPathRole: "Run the approved resume action only after a matching dry-run audit id."
  },
  lco_codex_send_message: { tier: "workflow_detail" },
  lco_codex_steer_thread: { tier: "workflow_detail" },
  lco_codex_interrupt_thread: { tier: "workflow_detail" },
  lco_desktop_proof: { tier: "proof_debug" },
  lco_desktop_act: { tier: "proof_debug" },
  lco_desktop_proof_action: { tier: "proof_debug" },
  lco_doctor: { tier: "workflow_detail" },
  lco_permissions: { tier: "proof_debug" },
  lco_audit_tail: { tier: "proof_debug" }
};

const LOO_FOLDED_COMPATIBILITY_ALIASES: LooToolAliasRegistry = {
  loo_describe_session: { targetName: "lco_describe_ref" },
  loo_watchers_list: { targetName: "lco_watchers", kindDefaults: { action: "list" } },
  loo_watcher_status: { targetName: "lco_watchers", kindDefaults: { action: "status" } },
  loo_watcher_dry_run: { targetName: "lco_watchers", kindDefaults: { action: "dry_run" } },
  loo_watcher_events: { targetName: "lco_watchers", kindDefaults: { action: "events" } },
  loo_resume_request_packet: { targetName: "lco_watchers", kindDefaults: { action: "resume_request_packet" } },
  loo_codex_final_messages: { targetName: "lco_codex_extract", kindDefaults: { kind: "final_messages" } },
  loo_codex_plans: { targetName: "lco_codex_extract", kindDefaults: { kind: "plans" } },
  loo_codex_touched_files: { targetName: "lco_codex_extract", kindDefaults: { kind: "touched_files" } },
  loo_codex_tool_calls: { targetName: "lco_codex_extract", kindDefaults: { kind: "tool_calls" } },
  loo_summary_leaves: { targetName: "lco_prepared_state", kindDefaults: { view: "leaves" } },
  loo_summary_expand: { targetName: "lco_prepared_state", kindDefaults: { view: "expand" } },
  loo_prepared_state_status: { targetName: "lco_prepared_state", kindDefaults: { view: "status" } },
  loo_prepared_cards: { targetName: "lco_prepared_state", kindDefaults: { view: "cards" } },
  loo_codex_thread_map: { targetName: "lco_operating_picture", kindDefaults: { kind: "thread_map" } },
  loo_codex_session_management_map: { targetName: "lco_operating_picture", kindDefaults: { kind: "session_management_map" } },
  loo_cockpit_inbox: { targetName: "lco_operating_picture", kindDefaults: { kind: "cockpit_inbox" } },
  loo_codex_collaboration_cockpit: { targetName: "lco_operating_picture", kindDefaults: { kind: "collaboration_cockpit" } },
  loo_codex_collaboration_next_steps: { targetName: "lco_operating_picture", kindDefaults: { kind: "collaboration_next_steps" } },
  loo_codex_runtime_desktop_visibility_status: { targetName: "lco_operating_picture", kindDefaults: { kind: "runtime_desktop_visibility_status" } },
  loo_codex_active_thread_state: { targetName: "lco_operating_picture", kindDefaults: { kind: "active_thread_state" } },
  loo_codex_autonomy_tick: { targetName: "lco_operating_picture", kindDefaults: { kind: "autonomy_tick" } },
  loo_plan_state_pins: { targetName: "lco_operating_picture", kindDefaults: { kind: "plan_state_pins" } },
  loo_github_operating_items: { targetName: "lco_operating_picture", kindDefaults: { kind: "github_operating_items" } },
  loo_codex_desktop_collaboration_proof: { targetName: "lco_desktop_proof", kindDefaults: { check: "collaboration_proof" } },
  loo_codex_start_thread_post_create_proof: { targetName: "lco_desktop_proof", kindDefaults: { check: "start_thread_post_create_proof" } },
  loo_codex_desktop_coherence: { targetName: "lco_desktop_proof", kindDefaults: { check: "coherence" } },
  loo_codex_desktop_fallback_status: { targetName: "lco_desktop_proof", kindDefaults: { check: "fallback_status" } },
  loo_desktop_see: { targetName: "lco_desktop_proof", kindDefaults: { check: "see" } },
  loo_desktop_proof_report: { targetName: "lco_desktop_proof", kindDefaults: { check: "proof_report" } },
  loo_desktop_live_proof_harness: { targetName: "lco_desktop_proof", kindDefaults: { check: "live_proof_harness" } }
};

export const LOO_TOOL_ALIAS_REGISTRY: LooToolAliasRegistry = {
  ...Object.fromEntries(Object.keys(LOO_TOOL_SURFACE).map((targetName) => [legacyLooToolName(targetName), { targetName }])),
  ...LOO_FOLDED_COMPATIBILITY_ALIASES
};

const LOO_FOLDED_COMPATIBILITY_TOOL_NAMES = new Set(
  Object.keys(LOO_TOOL_ALIAS_REGISTRY).filter((name) => name.startsWith("loo_"))
);

export function createLooToolSurfaceSummary(): LooToolSurfaceSummary {
  return {
    tiers: LOO_TOOL_TIERS,
    publicFacadeTools: publicFacadeToolNames(),
    namingPolicy: {
      publicProductAbbreviation: "LCO",
      forwardPublicAliasTarget: "lco_*",
      currentRuntimePrefix: "lco_",
      legacyCompatiblePrefix: "loo_",
      packageName: "lossless-openclaw-orchestrator",
      compatibilityIssue: "#616",
      aliasPolicy: "`lco_*` is the canonical runtime and public tool prefix. The redirect alias registry maintains backward compatible `loo_*` aliases for every canonical tool plus folded historical C1 leaf aliases. Redirect aliases can provide `kindDefaults`; caller arguments override those defaults at dispatch. Each alias carries `metadata.aliasOf`; redirect aliases do not create separate coverage obligations."
    },
    desktopFallback: {
      normalFirstPath: "direct Codex protocol",
      preferredBackend: "cua-driver",
      preferredLaunch: "cua-driver mcp",
      bundledByLco: false,
      secondaryBackend: "peekaboo",
      missingPreferredBackendBehavior: "normal read/search/describe workflows continue; desktop fallback readiness reports an actionable CUA blocker",
      proofBoundary: "CUA fallback readiness reports daemon and blocker state; MCP launchability still requires an explicit `cua-driver mcp --help` check unless LCO adds a launch probe. Codex composer-write proof needs a separately documented read-back before any send claim, and the current LCO proof report/live-proof harness do not validate a composer read-back field. No generic GUI mutation, unattended control, no-focus behavior, composer send approval, or release readiness is claimed without action-bound proof."
    },
    exposureProfile: {
      environmentVariable: "LCO_TOOL_PROFILE",
      defaultProfile: "all",
      profiles: {
        facade: {
          tiers: LOO_TOOL_PROFILE_TIERS.facade,
          includesFacadeAliases: true,
          description: "Expose public-facade canonical lco_* tools and their loo_* compatibility aliases."
        },
        standard: {
          tiers: LOO_TOOL_PROFILE_TIERS.standard,
          includesFacadeAliases: true,
          description: "Expose public-facade and workflow-detail canonical lco_* tools plus loo_* compatibility aliases whose targets are in profile."
        },
        all: {
          tiers: LOO_TOOL_PROFILE_TIERS.all,
          includesFacadeAliases: true,
          description: "Expose the full canonical LCO lco_* catalog, direct loo_* compatibility aliases, and folded historical loo_* compatibility aliases."
        }
      },
      callPolicy: "LCO_TOOL_PROFILE filters tools/list and OpenClaw declarations only; hidden tools remain callable by exact name when invoked by a capable client. LOO_TOOL_PROFILE is accepted as a compatibility fallback."
    },
    retrievalTelemetry: {
      environmentVariable: "LCO_TELEMETRY",
      enabledValue: "1",
      defaultEnabled: false,
      affectedTools: [
        "lco_search_sessions",
        "lco_grep",
        "lco_describe_ref",
        "lco_expand_session",
        "lco_expand_query"
      ],
      mutationMode: "local_cache_write",
      mutationClasses: ["derived_cache"],
      privacyBoundary: "When LCO_TELEMETRY=1 and a telemetry session id is supplied, affected search/describe/expand tools may write opt-in local derived-cache telemetry. LOO_TELEMETRY remains a compatibility fallback. Raw query text is not stored in telemetry rows or harvest proposals; public reports and metrics remain aggregate counts/ranks/hashes/placeholders only."
    },
    proofBoundary: "This metadata defines recommended operator tiers only. It does not remove tools, hide expert/debug surfaces, loosen approvals, run live Codex control, mutate a GUI, publish npm, or create GitHub releases. Opt-in retrieval telemetry, when enabled, is limited to local derived-cache writes."
  };
}

function publicFacadeToolNames(): string[] {
  return Object.entries(LOO_TOOL_SURFACE)
    .filter(([, metadata]) => metadata.tier === "public_facade")
    .sort((left, right) => Number(left[1].operatorPathRank) - Number(right[1].operatorPathRank))
    .map(([name]) => name);
}

export type PublicSafeToolValidationFailure = {
  ok: false;
  code: "validation_failed";
  publicSafe: true;
  error: {
    code: "validation_failed";
    message: string;
  };
};

export type LooToolExposureOptions = {
  profile?: LooToolProfile;
  includeAliases?: boolean;
};

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
  fingerprintTextIfConfigured() {
    return null;
  },
  deriveSubkeyIfConfigured() {
    return null;
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

export function createLooToolDeclarations(options: LooToolExposureOptions = {}): LooToolDeclaration[] {
  const declarations = createLooTools({
    db: {} as LooDatabase,
    audit: metadataOnlyAudit,
    codexClient: metadataOnlyCodexClient,
    includeAliases: false
  }).map(({ name, description, safety, metadata, inputSchema }) => ({ name, description, safety, metadata, inputSchema }));
  return filterLooToolsByProfile(
    options.includeAliases ? withLooToolAliases(declarations) : declarations,
    options.profile ?? "all"
  );
}

export async function executeLooToolForOpenClaw(tool: LooTool, input: Record<string, unknown>): Promise<unknown> {
  const validationMessage = validateOpenClawToolInput(tool.inputSchema, input);
  if (validationMessage) return publicSafeValidationFailure(validationMessage);
  try {
    return await tool.execute(input);
  } catch (error) {
    const message = publicSafeValidationMessage(error);
    if (message) return publicSafeValidationFailure(message);
    throw error;
  }
}

function sessionDiffToolResult(db: LooDatabase, audit: AuditStore, input: Record<string, unknown>): unknown {
  try {
    const configuredKey = readEnv("SESSION_DIFF_CURSOR_KEY");
    const auditFallbackKey = configuredKey ? null : audit.deriveSubkeyIfConfigured?.("lco_session_diff_cursor_v1") ?? null;
    return getSessionDiff(db, {
      threadId: optionalString(input.thread_id),
      targetRef: optionalString(input.target_ref),
      cursor: optionalString(input.cursor),
      ...resolveSessionDiffCursorKey(configuredKey, auditFallbackKey),
      limit: optionalNumber(input.limit),
      tokenBudget: optionalNumber(input.token_budget),
      now: optionalString(input.now)
    });
  } catch (error) {
    if (!isSessionDiffSetupError(error)) throw error;
    return createSessionDiffSetupRequiredReport("mcp");
  }
}

function validateOpenClawToolInput(schema: Record<string, unknown>, input: Record<string, unknown>): string | null {
  // Shallow top-level guard for OpenClaw's plugin boundary. Top-level arrays
  // with primitive item schemas are checked here; nested fixture objects are
  // intentionally left to tool-specific public-safe parsers.
  if (schema.type !== "object") return null;
  if (!isRecordValue(input)) return "value must be an object";
  const properties = isRecordValue(schema.properties) ? schema.properties : {};
  const requiredFields = Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === "string") : [];
  for (const key of requiredFields) {
    if (input[key] === undefined) return `${publicSafeInputField(key)} is required`;
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input)) {
      if (!(key in properties)) return `${publicSafeInputField(key)} is not allowed`;
    }
  }
  for (const [key, value] of Object.entries(input)) {
    const property = isRecordValue(properties[key]) ? properties[key] : undefined;
    if (!property || value === undefined) continue;
    const expectedType = typeof property.type === "string" ? property.type : undefined;
    if (expectedType && !schemaValueMatchesType(value, expectedType)) {
      return `${publicSafeInputField(key)} must be ${expectedType}`;
    }
    const enumValues = Array.isArray(property.enum) ? property.enum : undefined;
    if (enumValues && !enumValues.includes(value)) return `${publicSafeInputField(key)} is not supported`;
    if (expectedType === "string" && typeof value === "string") {
      const minLength = typeof property.minLength === "number" ? property.minLength : undefined;
      const maxLength = typeof property.maxLength === "number" ? property.maxLength : undefined;
      if (minLength !== undefined && value.length < minLength) return `${publicSafeInputField(key)} is below minimum length`;
      if (maxLength !== undefined && value.length > maxLength) return `${publicSafeInputField(key)} is above maximum length`;
    }
    if (expectedType === "array" && Array.isArray(value)) {
      const items = isRecordValue(property.items) ? property.items : undefined;
      const itemType = typeof items?.type === "string" ? items.type : undefined;
      if (itemType && itemType !== "object" && itemType !== "array") {
        for (const item of value) {
          if (!schemaValueMatchesType(item, itemType)) return `${publicSafeInputField(key)}[] must be ${itemType}`;
        }
      }
    }
    if ((expectedType === "integer" || expectedType === "number") && typeof value === "number") {
      const minimum = typeof property.minimum === "number" ? property.minimum : undefined;
      const maximum = typeof property.maximum === "number" ? property.maximum : undefined;
      if (minimum !== undefined && value < minimum) return `${publicSafeInputField(key)} is below minimum`;
      if (maximum !== undefined && value > maximum) return `${publicSafeInputField(key)} is above maximum`;
    }
  }
  return null;
}

function schemaValueMatchesType(value: unknown, type: string): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isRecordValue(value);
  return true;
}

function publicSafeInputField(value: string): string {
  return /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : "field";
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function createLooTools(options: {
  db: LooDatabase;
  dbPath?: string;
  audit: AuditStore;
  codexClient: CodexClient;
  codexReadClient?: CodexClient;
  desktopProbe?: DesktopProbe;
  includeAliases?: boolean;
  telemetryEnabled?: boolean;
  invocationSurface?: "mcp" | "openclaw-gateway";
}): LooTool[] {
  const control = createCodexControl({ audit: options.audit, client: options.codexClient });
  const codexReadClient = options.codexReadClient ?? options.codexClient;
  const telemetryEnabled = options.telemetryEnabled ?? readEnv("TELEMETRY") === "1";
  const tools: LooTool[] = [
    tool("lco_index_sessions", "Index local Codex and Claude Code session JSONL files into the local orchestrator database.", {
      target: { type: "string", enum: ["codex", "claude", "all"] },
      roots: { type: "array", items: { type: "string" } },
      claude_roots: { type: "array", items: { type: "string" } },
      lcm_db_paths: { type: "array", items: { type: "string" } },
      max_files: { type: "integer", minimum: 1, maximum: 100000 },
      max_bytes_per_file: { type: "integer", minimum: 1, maximum: 1073741824 },
      max_events_per_file: { type: "integer", minimum: 1, maximum: 1000000 }
    }, (input) => {
      const target = optionalRecallIndexTarget(input.target, "codex");
      const codex = target === "codex" || target === "all"
        ? indexCodexSessions(options.db, {
          roots: optionalRoots(input.roots, defaultCodexRoots()),
          lcmDbPaths: optionalConfiguredPaths(input.lcm_db_paths, configuredLcmPeerDbPaths()),
          maxFiles: optionalNumber(input.max_files),
          maxBytesPerFile: optionalNumber(input.max_bytes_per_file),
          maxEventsPerFile: optionalNumber(input.max_events_per_file)
        })
        : null;
      const claude = target === "claude" || target === "all"
        ? indexClaudeSessions(options.db, {
          roots: optionalRoots(target === "claude" ? input.roots : input.claude_roots, defaultClaudeRoots()),
          maxFiles: optionalNumber(input.max_files),
          maxBytesPerFile: optionalNumber(input.max_bytes_per_file),
          maxEventsPerFile: optionalNumber(input.max_events_per_file)
        })
        : null;
      return publicSafeIndexRecallResult({ target, codex, claude });
    }),
    tool("lco_find", "Find local Codex and Claude Code work from one query; indexes local recall sources first unless index is false.", {
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      index: { type: "boolean" },
      index_target: { type: "string", enum: ["codex", "claude", "all"] },
      roots: { type: "array", items: { type: "string" } },
      claude_roots: { type: "array", items: { type: "string" } },
      lcm_db_paths: { type: "array", items: { type: "string" } },
      max_files: { type: "integer", minimum: 1, maximum: 100000 },
      max_bytes_per_file: { type: "integer", minimum: 1, maximum: 1073741824 },
      max_events_per_file: { type: "integer", minimum: 1, maximum: 1000000 }
    }, (input) => {
      const limit = optionalBoundedInteger(input.limit, 1, 100) ?? 10;
      const shouldIndex = optionalBoolean(input.index) !== false;
      const query = requiredString(input.query, "query");
      const indexTarget = optionalRecallIndexTarget(input.index_target, input.roots !== undefined && input.claude_roots === undefined ? "codex" : "all");
      const codex = shouldIndex && (indexTarget === "codex" || indexTarget === "all")
        ? indexCodexSessions(options.db, {
          roots: optionalRoots(input.roots, defaultCodexRoots()),
          lcmDbPaths: optionalConfiguredPaths(input.lcm_db_paths, configuredLcmPeerDbPaths()),
          maxFiles: optionalNumber(input.max_files),
          maxBytesPerFile: optionalNumber(input.max_bytes_per_file),
          maxEventsPerFile: optionalNumber(input.max_events_per_file)
        })
        : null;
      const claude = shouldIndex && (indexTarget === "claude" || indexTarget === "all")
        ? indexClaudeSessions(options.db, {
          roots: optionalRoots(input.claude_roots, defaultClaudeRoots()),
          maxFiles: optionalNumber(input.max_files),
          maxBytesPerFile: optionalNumber(input.max_bytes_per_file),
          maxEventsPerFile: optionalNumber(input.max_events_per_file)
        })
        : null;
      const indexed = shouldIndex ? createRecallIndexSummary({ codex, claude }) : null;
      return createFindRecallReport({
        query,
        limit,
        indexed,
        recall: grepRecall(options.db, {
          query,
          limit,
          profile: "brief",
          lcmDbPaths: optionalConfiguredPaths(input.lcm_db_paths, configuredLcmPeerDbPaths()),
          telemetry: false
        })
      });
    }),
    tool("lco_search_sessions", "Search indexed Codex sessions with bounded safe text.", {
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      include_app_server: { type: "boolean" },
      app_server_threads: { type: "object", additionalProperties: true },
      telemetry_session_id: { type: "string" },
      now: { type: "string" }
    }, async (input) => {
      const appServerThreads = optionalRecord(input.app_server_threads) as AppServerThreadsInput | undefined
        ?? (input.include_app_server === true
          ? await createCodexAppServerThreadsReport({
            client: codexReadClient,
            limit: optionalNumber(input.limit),
            now: optionalString(input.now)
          })
          : undefined);
      return searchSessions(options.db, {
        query: requiredString(input.query, "query"),
        limit: optionalNumber(input.limit),
        appServerThreads,
        now: optionalString(input.now),
        telemetry: telemetryEnabled,
        telemetrySessionId: optionalString(input.telemetry_session_id)
      });
    }),
    tool("lco_grep", "Search Codex, imported Claude Code recall, and optional read-only OpenClaw LCM peer DBs with source-prefixed refs such as codex_thread:*, claude_session:*, and lcm_summary:*.", {
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      profile: { type: "string", enum: ["metadata", "brief", "evidence"] },
      token_budget: { type: "integer", minimum: 20, maximum: 8000 },
      lcm_db_paths: { type: "array", items: { type: "string" } },
      telemetry_session_id: { type: "string" },
      now: { type: "string" }
    }, (input) => grepRecall(options.db, {
      query: requiredString(input.query, "query"),
      limit: optionalNumber(input.limit),
      profile: optionalProfile(input.profile),
      tokenBudget: optionalNumber(input.token_budget),
      lcmDbPaths: optionalConfiguredPaths(input.lcm_db_paths, configuredLcmPeerDbPaths()),
      telemetry: telemetryEnabled,
      telemetrySessionId: optionalString(input.telemetry_session_id),
      now: optionalString(input.now)
    })),
    tool("lco_describe_ref", "Describe a source-prefixed recall ref such as codex_thread:*, claude_session:*, or lcm_summary:*.", {
      source_ref: { type: "string" },
      thread_id: { type: "string" },
      lcm_db_paths: { type: "array", items: { type: "string" } },
      telemetry_session_id: { type: "string" },
      now: { type: "string" }
    }, (input) => {
      const sourceRef = recallSourceRefInput(input);
      return describeRecallRef(options.db, {
        sourceRef,
        lcmDbPaths: optionalConfiguredPaths(input.lcm_db_paths, configuredLcmPeerDbPaths()),
        telemetry: telemetryEnabled,
        telemetrySessionId: optionalString(input.telemetry_session_id),
        now: optionalString(input.now)
      }) ?? createRecallRefNotFoundResult(options.db, sourceRef);
    }),
    tool("lco_expand_session", "Expand one indexed Codex session into a bounded evidence brief.", {
      thread_id: { type: "string" },
      profile: { type: "string", enum: ["metadata", "brief", "evidence"] },
      token_budget: { type: "integer", minimum: 20, maximum: 8000 },
      telemetry_session_id: { type: "string" },
      now: { type: "string" }
    }, (input) => expandSession(options.db, {
      threadId: requiredString(input.thread_id, "thread_id"),
      profile: optionalProfile(input.profile),
      tokenBudget: optionalNumber(input.token_budget),
      telemetry: telemetryEnabled,
      telemetrySessionId: optionalString(input.telemetry_session_id),
      now: optionalString(input.now)
    })),
    tool("lco_expand_query", "Search then expand the best matching Codex, imported Claude Code, or LCM peer recall ref.", {
      query: { type: "string" },
      profile: { type: "string", enum: ["metadata", "brief", "evidence"] },
      token_budget: { type: "integer", minimum: 20, maximum: 8000 },
      lcm_db_paths: { type: "array", items: { type: "string" } },
      telemetry_session_id: { type: "string" },
      now: { type: "string" }
    }, (input) => expandQuery(options.db, {
      query: requiredString(input.query, "query"),
      profile: optionalProfile(input.profile),
      tokenBudget: optionalNumber(input.token_budget),
      lcmDbPaths: optionalConfiguredPaths(input.lcm_db_paths, configuredLcmPeerDbPaths()),
      telemetry: telemetryEnabled,
      telemetrySessionId: optionalString(input.telemetry_session_id),
      now: optionalString(input.now)
    })),
    tool("lco_prepared_inbox", "Read the deterministic execute-false prepared-state attention inbox.", {
      thread_id: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 200 }
    }, (input) => getPreparedInbox(options.db, {
      threadId: optionalString(input.thread_id),
      limit: optionalNumber(input.limit)
    })),
    tool("lco_session_diff", "Read token-bounded public-safe changes since an opaque session-diff cursor.", {
      thread_id: { type: "string" },
      target_ref: { type: "string" },
      cursor: { type: "string", maxLength: 16_384 },
      limit: { type: "integer", minimum: 1, maximum: 500 },
      token_budget: { type: "integer", minimum: 20, maximum: 8000 },
      now: { type: "string" }
    }, (input) => sessionDiffToolResult(options.db, options.audit, input)),
    tool("lco_prepared_state", "Read prepared-state status, cards, summary leaves, or bounded summary expansion through one canonical prepared-state surface.", {
      view: { type: "string", enum: ["status", "cards", "leaves", "expand"] },
      thread_id: { type: "string" },
      state: { type: "string", enum: [...PREPARED_CARD_STATES] },
      leaf_kind: { type: "string", enum: ["user_prompt", "assistant_message", "proposed_plan", "final_message", "closeout", "tool_call_metadata", "event_metadata"] },
      leaf_ref: { type: "string" },
      max_depth: { type: "integer", minimum: 0, maximum: 20 },
      max_nodes: { type: "integer", minimum: 1, maximum: 200 },
      token_budget: { type: "integer", minimum: 8, maximum: 8000 },
      limit: { type: "integer", minimum: 1, maximum: 1000 }
    }, (input) => {
      const view = requiredPreparedStateView(input.view);
      if (view === "status") {
        return getPreparedStateStatus(options.db, { threadId: optionalString(input.thread_id) });
      }
      if (view === "cards") {
        return getPreparedCards(options.db, {
          threadId: optionalString(input.thread_id),
          state: optionalPreparedCardState(input.state),
          limit: optionalBoundedInteger(input.limit, 1, 500)
        });
      }
      if (view === "leaves") {
        return getSummaryLeaves(options.db, {
          threadId: optionalString(input.thread_id),
          leafKind: optionalSummaryLeafKind(input.leaf_kind),
          limit: optionalBoundedInteger(input.limit, 1, 1000)
        });
      }
      return expandSummaryLeaves(options.db, {
        leafRef: optionalString(input.leaf_ref),
        threadId: optionalString(input.thread_id),
        maxDepth: optionalNumber(input.max_depth),
        maxNodes: optionalNumber(input.max_nodes),
        tokenBudget: optionalNumber(input.token_budget)
      });
    }),
    tool("lco_recent_sessions", "List recent or active Codex sessions as compact public-safe cards without requiring query text.", {
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
      include_cards: { type: "boolean" },
      now: { type: "string" }
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
      includeCards: input.include_cards !== false,
      now: optionalString(input.now)
    })),
    tool("lco_watchers", "Read watcher status, dry-run request packets, persisted watcher events, or one resume-request packet through a canonical execute-false watcher surface.", {
      action: { type: "string", enum: ["list", "status", "dry_run", "events", "resume_request_packet"] },
      watcher_specs: { type: "array", items: { type: "object", additionalProperties: true } },
      watcher_spec: { type: "object", additionalProperties: true },
      watch_id: { type: "string" },
      target_ref: { type: "string" },
      ttl_seconds: { type: "integer", minimum: 60, maximum: 86400 },
      recommended_action: { type: "string", enum: ["inspect", "resume", "approve", "ignore"] },
      limit: { type: "integer", minimum: 1, maximum: 1000 },
      now: { type: "string" }
    }, (input) => {
      const action = requiredWatcherAction(input.action);
      if (action === "events") {
        return getWatcherEvents(options.db, {
          watchId: optionalString(input.watch_id),
          targetRef: optionalString(input.target_ref),
          limit: optionalNumber(input.limit),
          now: optionalString(input.now)
        });
      }
      if (action === "resume_request_packet") {
        const status = createWatcherStatusReport([requiredWatchSpec(input.watcher_spec, "watcher_spec")], { now: optionalString(input.now), limit: 1 });
        const watcher = status.watchers[0];
        if (!watcher) throw new Error("watcher_spec did not produce a watcher state");
        return createResumeRequestPacket(watcher, {
          now: optionalString(input.now),
          ttlSeconds: optionalNumber(input.ttl_seconds),
          recommendedAction: optionalWatcherRecommendedAction(input.recommended_action)
        });
      }
      const status = createWatcherStatusReport(optionalWatchSpecs(input.watcher_specs) ?? [], {
        limit: optionalNumber(input.limit),
        watchId: action === "status" ? optionalString(input.watch_id) : undefined,
        now: optionalString(input.now)
      });
      if (action !== "dry_run") return status;
      return {
        schema: "lco.watchers.dryRun.v1",
        publicSafe: true,
        status,
        resumeRequestPackets: status.watchers
          .filter((watcher) => watcher.status === "triggered")
          .map((watcher) => createResumeRequestPacket(watcher, { now: optionalString(input.now) })),
        actionsPerformed: status.actionsPerformed,
        proofBoundary: "Dry-run watcher packets are requests only; no live Codex control, GUI mutation, external write, cleanup, or notification is performed."
      };
    }),
    tool("lco_codex_app_server_status", "Read Codex app-server status and read-method posture without enabling control.", {}, () => createCodexAppServerStatusReport({
      client: codexReadClient,
      command: readEnvWithFallback("CODEX_BIN", "codex")
    })),
    tool("lco_codex_app_server_threads", "Read Codex app-server thread metadata and loaded-signal posture without turns or raw paths.", {
      limit: { type: "integer", minimum: 1, maximum: 100 },
      read_thread_id: { type: "string" }
    }, (input) => createCodexAppServerThreadsReport({
      client: codexReadClient,
      limit: optionalNumber(input.limit),
      readThreadId: optionalString(input.read_thread_id)
    })),
    tool("lco_visible_codex_map", "Join indexed session cards with optional visible Codex and read-only app-server signals.", {
      limit: { type: "integer", minimum: 1, maximum: 500 },
      include_app_server: { type: "boolean" },
      include_visible_snapshot: { type: "boolean" },
      backend: { type: "string", enum: ["direct", "cua-driver", "peekaboo"] },
      max_nodes: { type: "integer", minimum: 1, maximum: 500 },
      max_chars: { type: "integer", minimum: 1, maximum: 20000 },
      visible_codex: { type: "object", additionalProperties: true },
      app_server_threads: { type: "object", additionalProperties: true }
    }, (input) => buildVisibleCodexMapFromToolInput(input, options)),
    tool("lco_project_digest", "Create a read-only Eva operating digest from LCO/Codex cards, optional structured GitHub items, PLAN_STATE pins, and source authority coverage.", {
      window: { type: "string", enum: ["today", "24h", "7d", "custom"] },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      plan_state_text: { type: "string" },
      plan_state_path: { type: "string" },
      github_items: { type: "array", items: { type: "object", additionalProperties: true } },
      now: { type: "string" }
    }, (input) => createProjectDigest(options.db, {
      window: optionalDigestWindow(input.window),
      limit: optionalNumber(input.limit),
      planStatePins: optionalPlanStatePins(input),
      githubItems: optionalGithubItems(input.github_items),
      now: optionalString(input.now)
    })),
    tool("lco_attention_inbox", "Return only operating-picture cards that need action, review, approval, watch, or blocker triage.", {
      window: { type: "string", enum: ["today", "24h", "7d", "custom"] },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      plan_state_text: { type: "string" },
      plan_state_path: { type: "string" },
      github_items: { type: "array", items: { type: "object", additionalProperties: true } },
      now: { type: "string" }
    }, (input) => createAttentionInbox(options.db, {
      window: optionalDigestWindow(input.window),
      limit: optionalNumber(input.limit),
      planStatePins: optionalPlanStatePins(input),
      githubItems: optionalGithubItems(input.github_items),
      now: optionalString(input.now)
    })),
    tool("lco_business_pulse", "Answer 'How is the business?' from bounded cited operating cards with explicit source and authority coverage gaps.", {
      window: { type: "string", enum: ["today", "24h", "7d", "custom"] },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      plan_state_text: { type: "string" },
      plan_state_path: { type: "string" },
      github_items: { type: "array", items: { type: "object", additionalProperties: true } },
      now: { type: "string" }
    }, (input) => createBusinessPulse(options.db, {
      window: optionalDigestWindow(input.window),
      limit: optionalNumber(input.limit),
      planStatePins: optionalPlanStatePins(input),
      githubItems: optionalGithubItems(input.github_items),
      now: optionalString(input.now)
    })),
    tool("lco_operating_picture", "Read deterministic Codex and Eva operating-picture maps, inboxes, pins, GitHub items, or autonomy planning state through one canonical read-only surface.", {
      kind: { type: "string", enum: ["thread_map", "session_management_map", "cockpit_inbox", "collaboration_cockpit", "collaboration_next_steps", "runtime_desktop_visibility_status", "active_thread_state", "autonomy_tick", "plan_state_pins", "github_operating_items"] },
      limit: { type: "integer", minimum: 1, maximum: 500 },
      project: { type: "string" },
      status: { type: "string" },
      priority: { type: "string" },
      blocker: { type: "string" },
      priority_order: { type: "array", items: { type: "string" } },
      watcher_specs: { type: "array", items: { type: "object", additionalProperties: true } },
      desktop_coherence_reports: { type: "array", items: { type: "object", additionalProperties: true } },
      desktop_fallback_reports: { type: "array", items: { type: "object", additionalProperties: true } },
      desktop_collaboration_proof_reports: { type: "array", items: { type: "object", additionalProperties: true } },
      app_server_threads: { type: "object", additionalProperties: true },
      visible_map: { type: "object", additionalProperties: true },
      plan_state_text: { type: "string" },
      plan_state_path: { type: "string" },
      github_records: { type: "array", items: { type: "object", additionalProperties: true } },
      include_green: { type: "boolean" },
      now: { type: "string" }
    }, (input) => {
      const kind = requiredOperatingPictureKind(input.kind);
      if (kind === "thread_map") {
        return getCodexThreadMap(options.db, {
          limit: optionalNumber(input.limit),
          project: optionalString(input.project),
          status: optionalString(input.status),
          priority: optionalString(input.priority),
          blocker: optionalString(input.blocker),
          priorityOrder: optionalStringArray(input.priority_order)
        });
      }
      if (kind === "session_management_map") {
        return getCodexSessionManagementMap(options.db, {
          limit: optionalNumber(input.limit),
          project: optionalString(input.project),
          status: optionalString(input.status),
          priority: optionalString(input.priority),
          blocker: optionalString(input.blocker),
          priorityOrder: optionalStringArray(input.priority_order)
        });
      }
      if (kind === "cockpit_inbox") {
        return getCockpitInbox(options.db, {
          limit: optionalNumber(input.limit),
          priorityOrder: optionalStringArray(input.priority_order),
          watcherSpecs: optionalWatchSpecs(input.watcher_specs),
          now: optionalString(input.now)
        });
      }
      if (kind === "collaboration_cockpit") {
        return createCodexCollaborationCockpit(options.db, {
          limit: optionalNumber(input.limit),
          priorityOrder: optionalStringArray(input.priority_order),
          watcherSpecs: optionalWatchSpecs(input.watcher_specs),
          desktopCoherenceReports: optionalRecordArray(input.desktop_coherence_reports),
          desktopFallbackReports: optionalRecordArray(input.desktop_fallback_reports),
          now: optionalString(input.now)
        });
      }
      if (kind === "collaboration_next_steps") {
        return createCodexCollaborationNextSteps(options.db, {
          limit: optionalNumber(input.limit),
          priorityOrder: optionalStringArray(input.priority_order),
          watcherSpecs: optionalWatchSpecs(input.watcher_specs),
          desktopCoherenceReports: optionalRecordArray(input.desktop_coherence_reports),
          desktopFallbackReports: optionalRecordArray(input.desktop_fallback_reports),
          now: optionalString(input.now)
        });
      }
      if (kind === "runtime_desktop_visibility_status") {
        return createCodexRuntimeDesktopVisibilityStatus(options.db, {
          limit: optionalNumber(input.limit),
          priorityOrder: optionalStringArray(input.priority_order),
          watcherSpecs: optionalWatchSpecs(input.watcher_specs),
          desktopCoherenceReports: optionalRecordArray(input.desktop_coherence_reports),
          desktopFallbackReports: optionalRecordArray(input.desktop_fallback_reports),
          desktopCollaborationProofReports: optionalRecordArray(input.desktop_collaboration_proof_reports),
          now: optionalString(input.now)
        });
      }
      if (kind === "active_thread_state") {
        return createCodexActiveThreadState(options.db, {
          limit: optionalNumber(input.limit),
          priorityOrder: optionalStringArray(input.priority_order),
          watcherSpecs: optionalWatchSpecs(input.watcher_specs),
          desktopCoherenceReports: optionalRecordArray(input.desktop_coherence_reports),
          desktopFallbackReports: optionalRecordArray(input.desktop_fallback_reports),
          appServerThreads: optionalRecord(input.app_server_threads) as AppServerThreadsInput | undefined,
          visibleMap: optionalRecord(input.visible_map) as VisibleCodexSessionMapReport | undefined,
          now: optionalString(input.now)
        });
      }
      if (kind === "autonomy_tick") {
        return createCodexAutonomyTick(options.db, {
          limit: optionalNumber(input.limit),
          priorityOrder: optionalStringArray(input.priority_order),
          watcherSpecs: optionalWatchSpecs(input.watcher_specs),
          desktopCoherenceReports: optionalRecordArray(input.desktop_coherence_reports),
          desktopFallbackReports: optionalRecordArray(input.desktop_fallback_reports),
          appServerThreads: optionalRecord(input.app_server_threads) as AppServerThreadsInput | undefined,
          visibleMap: optionalRecord(input.visible_map) as VisibleCodexSessionMapReport | undefined,
          now: optionalString(input.now)
        });
      }
      if (kind === "plan_state_pins") return createPlanStatePinsReport(resolvePlanStateText(input));
      return createGithubOperatingItemsReport(optionalGithubRecords(input.github_records), {
        includeGreen: optionalBoolean(input.include_green),
        limit: optionalBoundedInteger(input.limit, 1, 200),
        now: optionalString(input.now)
      });
    }),
    tool("lco_codex_extract", "Read extracted Codex plans, final messages, touched files, or tool-call metadata through one canonical extraction surface.", {
      kind: { type: "string", enum: ["plans", "final_messages", "touched_files", "tool_calls"] },
      thread_id: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 1000 }
    }, (input) => {
      const kind = requiredCodexExtractKind(input.kind);
      if (kind === "plans") return getCodexPlans(options.db, { threadId: optionalString(input.thread_id), limit: optionalBoundedInteger(input.limit, 1, 500) });
      if (kind === "final_messages") return getCodexFinalMessages(options.db, { threadId: optionalString(input.thread_id), limit: optionalBoundedInteger(input.limit, 1, 500) });
      if (kind === "touched_files") return getCodexTouchedFiles(options.db, { threadId: requiredString(input.thread_id, "thread_id") });
      return getCodexToolCalls(options.db, { threadId: optionalString(input.thread_id), limit: optionalBoundedInteger(input.limit, 1, 1000) });
    }),
    tool("lco_closeout_dry_run", "Preview public-safe closeout envelopes that a hook-agent could attach without mutating Codex.", {
      thread_id: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 500 },
      include_unavailable: { type: "boolean" }
    }, (input) => createCloseoutEnvelopeReport(options.db, {
      threadId: optionalString(input.thread_id),
      limit: optionalNumber(input.limit),
      includeUnavailable: input.include_unavailable === true
    })),
    tool("lco_session_sanitizer", "Dry-run public-safe sanitizer findings from indexed Codex safe text without reading raw transcripts or mutating sessions.", {
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
    tool("lco_codex_sqlite_stores", "Probe local Codex state_*.sqlite and logs_*.sqlite stores read-only.", {
      roots: { type: "array", items: { type: "string" } },
      max_files: { type: "integer", minimum: 1, maximum: 1000 }
    }, (input) => publicSafeCodexSqliteProbe(probeCodexSqliteStores(optionalRoots(input.roots, [join(resolveHomeDir(), ".codex")]), optionalNumber(input.max_files)))),
    tool("lco_lcm_peer_dbs", "Probe configured OpenClaw LCM peer DBs read-only.", {
      lcm_db_paths: { type: "array", items: { type: "string" } }
    }, (input) => probeLcmPeerDbs(optionalConfiguredPaths(input.lcm_db_paths, configuredLcmPeerDbPaths()))),
    tool("lco_drive", "Create a bounded review-then-drive plan and target-adapter dry-run packet under local audit.", {
      reviewer: { type: "string", enum: ["codex", "claude"] },
      driver: { type: "string", enum: ["codex", "claude"] },
      target_ref: { type: "string", maxLength: 195 },
      objective: { type: "string", maxLength: 2000 },
      max_turns: { type: "integer", minimum: 1, maximum: 20 },
      token_budget: { type: "integer", minimum: 100, maximum: 8000 },
      timeout_ms: { type: "integer", minimum: 1000, maximum: 600000 },
      cost_ceiling_usd: { type: "number", minimum: 0, maximum: 100 },
      dry_run: { type: "boolean", enum: [true] },
      now: { type: "string" }
    }, async (input) => {
      if (input.dry_run === false) throw new Error("lco_drive live mode is not supported in 1.6");
      const reviewer = driveHarness(input.reviewer, "reviewer");
      const driver = driveHarness(input.driver, "driver");
      const claudeAvailability = driver === "claude"
        ? await probeClaudeDryRunAvailability("claude", { trustedPath: process.env.PATH })
        : undefined;
      return createDriveReport({
        reviewer,
        driver,
        targetRef: requiredString(input.target_ref, "target_ref"),
        objective: requiredString(input.objective, "objective"),
        invocationSurface: options.invocationSurface ?? "mcp",
        maxTurns: optionalNumber(input.max_turns),
        tokenBudget: optionalNumber(input.token_budget),
        timeoutMs: optionalNumber(input.timeout_ms),
        costCeilingUsd: optionalNumber(input.cost_ceiling_usd),
        audit: options.audit,
        ...(claudeAvailability ? { claudeAvailability } : {}),
        now: optionalString(input.now)
      });
    }),
    tool("lco_codex_control_dry_run", "Create a dry-run audit id for a Codex control action under LCO's fixed never-approve, read-only runtime posture.", {
      action: { type: "string", enum: ["start", "send", "resume", "steer", "interrupt"] },
      thread_id: { type: "string" },
      message: { type: "string" },
      expected_turn_id: { type: "string" }
    }, (input) => snakeCaseControlResult(dispatchControl(control, input, true))),
    tool("lco_codex_start_thread", "Create a persistent read-only Codex thread with approvalPolicy=never. Dry-run by default; live mode requires approval_audit_id and still needs follow-up proof before durability claims.", startControlSchema(), (input) => snakeCaseControlResult(control.startThread(startControlInput(input)))),
    tool("lco_codex_resume_thread", "Resume or rejoin a Codex thread under LCO's fixed never-approve, read-only posture without starting a turn. Live mode requires approval_audit_id.", controlSchema(), (input) => snakeCaseControlResult(control.resumeThread(controlInput(input)))),
    tool("lco_codex_send_message", "Send a message under LCO's fixed never-approve, read-only posture. Live mode requires approval_audit_id and waits for bounded turn proof.", controlSchema(true, false, true), (input) => snakeCaseControlResult(control.sendMessage(messageControlInput(input, false, true)))),
    tool("lco_codex_steer_thread", "Rejoin and steer a running Codex thread under LCO's fixed never-approve, read-only posture. Live mode requires approval_audit_id and expected_turn_id.", controlSchema(true, true, true), (input) => snakeCaseControlResult(control.steerThread(messageControlInput(input, true, true))), ["thread_id", "message", "expected_turn_id"]),
    tool("lco_codex_interrupt_thread", "Rejoin and interrupt a Codex thread under LCO's fixed never-approve, read-only posture. Live mode requires approval_audit_id and expected_turn_id.", controlSchema(false, true, true), (input) => snakeCaseControlResult(control.interruptThread(controlInput(input, false, true))), ["thread_id", "expected_turn_id"]),
    tool("lco_desktop_act", "Dry-run desktop fallback action for CUA/Peekaboo; live requests return structured missing-proof blockers.", {
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
    tool("lco_desktop_proof_action", "Run the one approved CUA TextEdit scratch launch proof action and return a public-safe observation for proof-report validation.", {
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
    tool("lco_desktop_proof", "Read or validate desktop proof/check surfaces through one canonical proof surface without broad GUI mutation.", {
      check: { type: "string", enum: ["collaboration_proof", "start_thread_post_create_proof", "coherence", "fallback_status", "see", "proof_report", "live_proof_harness"] },
      target_ref: { type: "string" },
      target_thread_id: { type: "string" },
      backend: { type: "string", enum: ["direct", "cua-driver", "peekaboo"] },
      target_app: { type: "string" },
      target_window: { type: "string" },
      action: { type: "string" },
      action_hash: { type: "string" },
      approval_packet: { type: "object", additionalProperties: true },
      execute: { type: "boolean" },
      now: { type: "string" },
      created_thread_id: { type: "string" },
      worker_thread_id: { type: "string" },
      created_thread_ref: { type: "string" },
      requested_title: { type: "string" },
      alias: { type: "string" },
      parent_thread_id: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 500 },
      thread_id: { type: "string" },
      source_ref: { type: "string" },
      refresh_kind: { type: "string", enum: ["none", "desktop_refresh", "desktop_restart"] },
      visible_map: { type: "object", additionalProperties: true },
      before_visible_map: { type: "object", additionalProperties: true },
      after_visible_map: { type: "object", additionalProperties: true },
      action_evidence: { type: "object", additionalProperties: true },
      include_app_server: { type: "boolean" },
      include_visible_snapshot: { type: "boolean" },
      include_snapshot: { type: "boolean" },
      max_nodes: { type: "integer", minimum: 1, maximum: 500 },
      max_chars: { type: "integer", minimum: 1, maximum: 20000 },
      coherence: { type: "object", additionalProperties: true },
      observation: { type: "object", additionalProperties: true },
      approval_ref: { type: "string" },
      scratch_file_path: { type: "string" }
    }, async (input) => {
      const check = requiredDesktopProofCheck(input.check);
      if (check === "collaboration_proof") {
        return createCodexDesktopCollaborationProof({
          targetRef: optionalString(input.target_ref),
          targetThreadId: optionalString(input.target_thread_id),
          desktopBackend: optionalDesktopBackend(input.backend),
          targetApp: optionalString(input.target_app),
          targetWindow: optionalString(input.target_window),
          action: optionalString(input.action),
          actionHash: optionalString(input.action_hash),
          approvalPacket: input.approval_packet,
          execute: input.execute === true,
          now: optionalString(input.now)
        });
      }
      if (check === "start_thread_post_create_proof") {
        return createStartThreadPostCreateProof({ db: options.db, codexReadClient, input: startThreadPostCreateProofInput(input) });
      }
      if (check === "coherence") {
        const visibleMap = optionalRecord(input.visible_map) as VisibleCodexSessionMapReport | undefined;
        const beforeMap = optionalRecord(input.before_visible_map) as VisibleCodexSessionMapReport | undefined;
        const afterMap = optionalRecord(input.after_visible_map) as VisibleCodexSessionMapReport | undefined;
        const generatedMap = (visibleMap || beforeMap || afterMap) ? undefined : await buildVisibleCodexMapForTool(input, options);
        return createCodexDesktopCoherenceReport({
          threadId: optionalString(input.thread_id),
          sourceRef: optionalString(input.source_ref),
          visibleMap: visibleMap ?? generatedMap,
          beforeMap,
          afterMap,
          refreshKind: optionalRefreshKind(input.refresh_kind),
          actionEvidence: optionalRecord(input.action_evidence),
          now: optionalString(input.now)
        });
      }
      if (check === "fallback_status") {
        return createCodexDesktopFallbackReport({
          threadId: optionalString(input.thread_id),
          sourceRef: optionalString(input.source_ref),
          coherence: optionalRecord(input.coherence),
          includePeekabooSnapshot: input.include_visible_snapshot === true,
          maxNodes: optionalNumber(input.max_nodes),
          maxChars: optionalNumber(input.max_chars),
          now: optionalString(input.now),
          probe: options.desktopProbe
        });
      }
      if (check === "see") {
        return desktopSee({
          backend: optionalDesktopBackend(input.backend),
          includeSnapshot: input.include_snapshot === true,
          maxNodes: optionalNumber(input.max_nodes),
          maxChars: optionalNumber(input.max_chars),
          probe: options.desktopProbe
        });
      }
      if (check === "proof_report") return createDesktopGuiProofReport(input.observation);
      return createDesktopLiveProofHarness({
        backend: optionalDesktopBackend(input.backend),
        targetApp: optionalString(input.target_app),
        targetWindow: optionalString(input.target_window),
        action: optionalString(input.action),
        approvalRef: optionalString(input.approval_ref),
        scratchFilePath: optionalString(input.scratch_file_path),
        probe: options.desktopProbe
      });
    }),
    tool("lco_doctor", "Read local orchestrator health.", {}, () => {
      const databaseStorage = getDatabaseStorageStatus(options.db, options.dbPath);
      const activeDbPath = options.dbPath ?? defaultDatabasePath();
      return {
        ok: true,
        localOnly: true,
        toolPrefix: "lco_*",
        database: {
          configured: Boolean(readEnv("DB_PATH")),
          activePresent: existsSync(activeDbPath),
          location: "local",
          storage: databaseStorage
        },
        codexJsonlDrift: getCodexJsonlDriftStatus(options.db),
        codexEventContent: getCodexEventContentStatus(options.db, options.dbPath),
        codex: codexTransportStatus({ command: readEnvWithFallback("CODEX_BIN", "codex") }),
        lcmPeers: probeLcmPeerDbs(configuredLcmPeerDbPaths()),
        desktopFallbacks: desktopFallbackDiagnostics({ probe: options.desktopProbe })
      };
    }),
    tool("lco_permissions", "Read safety posture for live controls.", {}, () => ({
      liveControlRequires: ["dry_run", "approval_audit_id"],
      uploadsLocalText: false,
      commandPolicy: createEffectiveCommandPolicy()
    })),
    tool("lco_audit_tail", "Read recent local audit records without raw prompt text.", {
      limit: { type: "integer", minimum: 1, maximum: 1000 }
    }, (input) => ({
      auditPath: publicSafeLocalPath(options.audit.path, "audit.jsonl"),
      auditRef: publicSafeLocalRef("loo_audit_store", options.audit.path, "audit.jsonl"),
      records: options.audit.tail(optionalNumber(input.limit) ?? 20)
    }))
  ];
  const canonicalTools = tools.filter((tool) => !LOO_FOLDED_COMPATIBILITY_TOOL_NAMES.has(tool.name));
  return (options.includeAliases ?? true) ? withLooToolAliases(canonicalTools) : canonicalTools;
}

export function parseLooToolProfile(value: unknown, options?: { onInvalid?: (value: string) => void }): LooToolProfile {
  if (value === undefined || value === null || value === "") return "all";
  if (value === "facade" || value === "standard" || value === "all") return value;
  options?.onInvalid?.(String(value));
  return "all";
}

export function filterLooToolsByProfile<T extends { metadata: LooToolSurfaceMetadata }>(tools: T[], profile: LooToolProfile): T[] {
  const tiers = LOO_TOOL_PROFILE_TIERS[profile];
  return tools.filter((tool) => {
    if (!tiers.includes(tool.metadata.tier)) return false;
    return true;
  });
}

export function isLooToolAlias(tool: { metadata?: { aliasOf?: unknown } }): boolean {
  return typeof tool.metadata?.aliasOf === "string" && tool.metadata.aliasOf.length > 0;
}

export function legacyLooToolName(name: string): string {
  if (!name.startsWith("lco_")) throw new Error(`Cannot derive loo_* alias for non-lco tool: ${name}`);
  return `loo_${name.slice("lco_".length)}`;
}

export function lcoAliasNameForLooTool(name: string): string {
  if (!name.startsWith("loo_")) throw new Error(`Cannot derive lco_* alias for non-loo tool: ${name}`);
  return `lco_${name.slice("loo_".length)}`;
}

export function looAliasTargetName(name: string, registry: LooToolAliasRegistry = LOO_TOOL_ALIAS_REGISTRY): string | null {
  return registry[name]?.targetName ?? null;
}

export function isUnknownLcoAliasName(name: string): boolean {
  return name.startsWith("lco_") && !LOO_TOOL_SURFACE[name] && looAliasTargetName(name) === null;
}

export function canonicalLooToolName(name: string, registry: LooToolAliasRegistry = LOO_TOOL_ALIAS_REGISTRY): string {
  return looAliasTargetName(name, registry) ?? name;
}

function createEffectiveCommandPolicy(): Record<string, LooCommandSafety> {
  const entries: Array<[string, LooCommandSafety]> = Object.entries(LOO_COMMAND_POLICY);
  for (const [aliasName, declaration] of Object.entries(LOO_TOOL_ALIAS_REGISTRY)) {
    const safety = LOO_COMMAND_POLICY[declaration.targetName];
    if (safety) entries.push([aliasName, safety]);
  }
  return Object.fromEntries(entries);
}

export function withLooToolAliases<T extends LooTool | LooToolDeclaration>(
  tools: T[],
  registry: LooToolAliasRegistry = LOO_TOOL_ALIAS_REGISTRY
): T[] {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const aliases = Object.entries(registry).map(([aliasName, declaration]) => {
    const target = byName.get(declaration.targetName);
    if (!target) throw new Error(`Missing LOO alias target for ${aliasName}: ${declaration.targetName}`);
    const alias = {
      ...target,
      name: aliasName,
      metadata: {
        ...target.metadata,
        aliasOf: target.name
      }
    };
    if (isExecutableTool(target)) {
      return {
        ...alias,
        execute: (input: Record<string, unknown>) => target.execute({
          ...(declaration.kindDefaults ?? {}),
          ...input
        })
      } as T;
    }
    return alias as T;
  });
  return [...tools, ...aliases];
}

function isExecutableTool(tool: LooTool | LooToolDeclaration): tool is LooTool {
  return typeof (tool as { execute?: unknown }).execute === "function";
}

function publicSafeCodexSqliteProbe(report: ReturnType<typeof probeCodexSqliteStores>) {
  return {
    stores: report.stores.map((store) => ({
      ...store,
      path: publicSafeLocalPath(store.path, "store.sqlite"),
      sourceRef: publicSafeLocalRef("codex_sqlite_store", store.path, "store.sqlite"),
      reason: store.reason ? publicSafeDiagnosticText(store.reason, store.path) : store.reason
    }))
  };
}

function publicSafeIndexCodexResult(result: ReturnType<typeof indexCodexSessions>) {
  return {
    publicSafe: true,
    readOnly: false,
    mutationClasses: result.mutationClasses,
    indexedFiles: result.indexedFiles,
    appendDeltaIndexedFiles: result.appendDeltaIndexedFiles,
    indexLimits: result.indexLimits,
    skippedFiles: result.skippedFiles,
    indexedThreads: result.indexedThreads,
    indexedEvents: result.indexedEvents,
    preparedMaterialization: result.preparedMaterialization,
    limitedFiles: result.limitedFiles.map((file, index) => ({
      fileRef: `codex_index_limited_file:${index + 1}`,
      reason: file.reason,
      limit: file.limit,
      actual: file.actual
    })),
    warnings: result.warnings,
    errors: result.errors.map((error, index) => ({
      errorRef: `codex_index_error:${index + 1}`,
      message: publicSafeDiagnosticText(error.message, error.path)
    })),
    actionsPerformed: {
      derivedCacheWrite: true,
      sourceStoreMutation: false,
      externalWrite: false,
      liveControl: false,
      guiMutation: false,
      rawTranscriptRead: false
    },
    proofBoundary: "Indexing writes only LCO-owned derived-cache rows. MCP/OpenClaw output omits raw source paths and does not mutate Codex source stores, run live Codex control, mutate desktop GUI state, write external systems, publish npm, or create GitHub releases."
  };
}

function publicSafeIndexRecallResult(options: {
  target: "codex" | "claude" | "all";
  codex: ReturnType<typeof indexCodexSessions> | null;
  claude: ReturnType<typeof indexClaudeSessions> | null;
}) {
  const summary = createRecallIndexSummary({ codex: options.codex, claude: options.claude });
  const limitedFiles = [
    ...(options.codex?.limitedFiles.map((file, index) => ({
      fileRef: `codex_index_limited_file:${index + 1}`,
      reason: file.reason,
      limit: file.limit,
      actual: file.actual
    })) ?? []),
    ...(options.claude?.limitedFiles.map((file, index) => ({
      fileRef: `claude_index_limited_file:${index + 1}`,
      reason: file.reason,
      limit: file.limit,
      actual: file.actual
    })) ?? [])
  ];
  const errors = [
    ...(options.codex?.errors.map((error, index) => ({
      errorRef: `codex_index_error:${index + 1}`,
      message: publicSafeDiagnosticText(error.message, error.path)
    })) ?? []),
    ...(options.claude?.errors.map((error, index) => ({
      errorRef: `claude_index_error:${index + 1}`,
      message: publicSafeDiagnosticText(error.message, error.path)
    })) ?? [])
  ];
  return {
    publicSafe: true,
    readOnly: false,
    mutationClasses: summary.mutationClasses,
    target: options.target,
    sourceKinds: summary.sourceKinds,
    indexedFiles: summary.indexedFiles,
    skippedFiles: summary.skippedFiles,
    indexedThreads: summary.indexedThreads,
    indexedSessions: summary.indexedSessions,
    indexedEvents: summary.indexedEvents,
    preparedMaterialization: options.codex?.preparedMaterialization ?? null,
    indexLimits: {
      codex: options.codex?.indexLimits ?? null,
      claude: options.claude?.indexLimits ?? null
    },
    limitedFiles,
    warnings: [
      ...(options.codex?.warnings ?? []),
      ...(options.claude?.warnings ?? [])
    ],
    errors,
    actionsPerformed: {
      derivedCacheWrite: true,
      sourceStoreMutation: false,
      externalWrite: false,
      liveControl: false,
      guiMutation: false,
      rawTranscriptRead: false
    },
    proofBoundary: "Indexing writes only LCO-owned derived-cache rows. MCP/OpenClaw output omits raw source paths and does not mutate Codex or Claude source stores, run live control, mutate desktop GUI state, write external systems, publish npm, or create GitHub releases."
  };
}

function publicSafeLocalPath(path: string, fallbackBasename: string): string {
  if (!rawLocalPathLike(path)) return path;
  return `<redacted-local-path>/${publicSafeBasename(path, fallbackBasename)}`;
}

function publicSafeLocalRef(prefix: string, path: string, fallbackBasename: string): string {
  return `${prefix}:${publicSafeRefSegment(publicSafeBasename(path, fallbackBasename))}`;
}

function publicSafeBasename(path: string, fallbackBasename: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || basename(path) || fallbackBasename;
}

function publicSafeRefSegment(value: string): string {
  return (value || "unknown").replace(/[^A-Za-z0-9._-]/g, "_");
}

function publicSafeDiagnosticText(value: string, rawPath?: string): string {
  let text = value;
  if (rawPath) text = text.split(rawPath).join(publicSafeLocalPath(rawPath, "local-file"));
  return text
    .replace(/~\/[^\s"',)]+/g, "<redacted-local-path>")
    .replace(/(?:\/Volumes\/|\/Users\/|\/private\/|\/var\/folders\/|\/tmp\/)[^\s"',)]+/g, "<redacted-local-path>")
    .replace(/[A-Za-z]:\\[^\s"',)]+/g, "<redacted-local-path>")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<redacted-secret>")
    .replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, "<redacted-secret>")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<redacted-secret>")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "<redacted-secret>")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "<redacted-secret>")
    .replace(/\bPRIVATE_CANARY[A-Za-z0-9_:-]*/g, "<redacted-secret>")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, "$1<redacted-secret>")
    .replace(/(Basic\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1<redacted-secret>")
    .replace(/(\bauthorization\s*:\s*)[^\r\n"'`)]+/gi, "$1<redacted-secret>");
}

function rawLocalPathLike(value: string): boolean {
  return /^(?:\/|~|[A-Za-z]:\\)/.test(value);
}

function publicSafeValidationFailure(message: string): PublicSafeToolValidationFailure {
  return {
    ok: false,
    code: "validation_failed",
    publicSafe: true,
    error: {
      code: "validation_failed",
      message
    }
  };
}

function publicSafeValidationMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return null;

  const requiredField = message.match(/\b([a-z][a-z0-9_]{0,80}(?:\[[0-9]+\])?(?:\.[a-z][a-z0-9_]{0,80})?) is required\b/i)?.[1];
  if (requiredField) return `${requiredField.toLowerCase()} is required`;

  const requiredFields = message.match(/\b([a-z][a-z0-9_]{0,80}(?:\.[a-z][a-z0-9_]{0,80})?) are required\b/i)?.[1];
  if (requiredFields) return `${requiredFields.toLowerCase()} are required`;

  if (SAFE_VALIDATION_MESSAGES.has(message)) return message;
  return null;
}

const SAFE_VALIDATION_MESSAGES = new Set([
  "value must be an object",
  "value must be an array",
  "profile must be metadata, brief, or evidence",
  "scope must be active, recent, or all",
  "risk must be low, medium, or high",
  "window must be today, 24h, 7d, or custom",
  "desktop backend must be direct, cua-driver, or peekaboo",
  "refresh_kind must be none, desktop_refresh, or desktop_restart",
  "view must be status, cards, leaves, or expand",
  "watcher action must be list, status, dry_run, events, or resume_request_packet",
  "extract kind must be plans, final_messages, touched_files, or tool_calls",
  "operating-picture kind is not supported",
  "desktop proof check is not supported",
  "source_ref or thread_id is required",
  "roots must be an array",
  "roots[] is required",
  "github_items must be an array",
  "github_records must be an array",
  "watcher_specs must be an array",
  "recommended_action must be inspect, resume, approve, or ignore",
  "github item state must be green, yellow, red, or unknown",
  "github item urgency must be low, medium, high, or critical"
]);

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  execute: LooTool["execute"],
  required: string[] = []
): LooTool {
  const safety = LOO_COMMAND_POLICY[name];
  if (!safety) throw new Error(`Missing LOO command policy for ${name}`);
  const metadata = LOO_TOOL_SURFACE[name];
  if (!metadata) throw new Error(`Missing LOO tool surface metadata for ${name}`);
  return {
    name,
    description,
    safety,
    metadata,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties,
      ...(required.length > 0 ? { required } : {})
    },
    execute
  };
}

async function buildVisibleCodexMapForTool(
  input: Record<string, unknown>,
  options: { db: LooDatabase; codexClient: CodexClient; codexReadClient?: CodexClient; desktopProbe?: DesktopProbe }
): Promise<VisibleCodexSessionMapReport> {
  const targetThreadId = targetThreadIdFromCoherenceInput(input);
  return buildVisibleCodexMapFromToolInput(input, options, {
    readThreadId: targetThreadId,
    appendReadProbe: true,
    preserveTargetThroughLimit: Boolean(targetThreadId)
  });
}

async function buildVisibleCodexMapFromToolInput(
  input: Record<string, unknown>,
  options: { db: LooDatabase; codexClient: CodexClient; codexReadClient?: CodexClient; desktopProbe?: DesktopProbe },
  behavior: { readThreadId?: string; appendReadProbe?: boolean; preserveTargetThroughLimit?: boolean } = {}
): Promise<VisibleCodexSessionMapReport> {
  const visibleFromInput = optionalRecord(input.visible_codex) as VisibleCodexInput | undefined;
  const appServerFromInput = optionalRecord(input.app_server_threads) as AppServerThreadsInput | undefined;
  const visibleCodex = visibleFromInput ?? (input.include_visible_snapshot === true
    ? (await desktopSee({
        backend: optionalDesktopBackend(input.backend),
        includeSnapshot: true,
        maxNodes: optionalNumber(input.max_nodes),
        maxChars: optionalNumber(input.max_chars),
        probe: options.desktopProbe
      })).visibleCodex
    : undefined);
  const appServerThreads = appServerFromInput ?? (input.include_app_server === false
    ? undefined
    : await createCodexAppServerThreadsReport({
        client: options.codexReadClient ?? options.codexClient,
        limit: optionalNumber(input.limit),
        readThreadId: behavior.readThreadId
      }));
  const mapLimit = behavior.preserveTargetThroughLimit ? 500 : optionalNumber(input.limit);
  return createVisibleCodexSessionMap(options.db, {
    limit: mapLimit,
    visibleCodex,
    appServerThreads: behavior.appendReadProbe && appServerThreads ? appServerThreadsWithReadProbe(appServerThreads) : appServerThreads
  });
}

type AppServerThreadsWithOptionalReadProbe = AppServerThreadsInput & {
  readProbe?: {
    appServerRef: string;
    threadId: string;
    titleSanitized: string | null;
    status: string | null;
    error: string | null;
  };
};

function appServerThreadsWithReadProbe(report: AppServerThreadsWithOptionalReadProbe): AppServerThreadsInput {
  const readProbe = report.readProbe;
  if (!readProbe || readProbe.error) return report;
  const threads = report.threads ?? [];
  const hasThread = threads.some((thread) => thread.threadId === readProbe.threadId);
  if (hasThread) return report;
  return {
    ...report,
    threads: [
      ...threads,
      {
        appServerRef: readProbe.appServerRef,
        threadId: readProbe.threadId,
        titleSanitized: readProbe.titleSanitized,
        titleHash: null,
        status: readProbe.status,
        loaded: null,
        loadedState: "not_claimed",
        updatedAt: null,
        sourceRef: `codex_thread:${readProbe.threadId}`,
        confidence: readProbe.titleSanitized ? 0.82 : 0.62
      }
    ]
  };
}

function targetThreadIdFromCoherenceInput(input: Record<string, unknown>): string | undefined {
  const threadId = optionalString(input.thread_id);
  if (threadId) return threadId.startsWith("codex_thread:") ? threadId.slice("codex_thread:".length) : threadId;
  const sourceRef = optionalString(input.source_ref);
  return sourceRef?.startsWith("codex_thread:") ? sourceRef.slice("codex_thread:".length) : undefined;
}

function dispatchControl(control: ReturnType<typeof createCodexControl>, input: Record<string, unknown>, dryRun: boolean) {
  const action = requiredString(input.action, "action");
  if (action === "start") return control.startThread({ dryRun });
  const common = {
    threadId: requiredString(input.thread_id, "thread_id"),
    message: action === "send" || action === "steer"
      ? requiredString(input.message, "message")
      : optionalString(input.message) ?? "continue",
    expectedTurnId: optionalString(input.expected_turn_id),
    dryRun
  };
  if (action === "send") return control.sendMessage(common);
  if (action === "resume") return control.resumeThread(common);
  if (action === "steer") return control.steerThread(common);
  if (action === "interrupt") return control.interruptThread(common);
  throw new Error(`Unsupported control action: ${action}`);
}

function driveHarness(value: unknown, field: string): DriveHarness {
  const harness = requiredString(value, field);
  if (harness === "codex" || harness === "claude") return harness;
  throw new Error(`${field} must be codex or claude`);
}

function controlSchema(message = false, expectedTurn = false, turnWait = false): Record<string, unknown> {
  return {
    thread_id: { type: "string" },
    ...(message ? { message: { type: "string" } } : {}),
    ...(expectedTurn ? { expected_turn_id: { type: "string" } } : {}),
    ...(turnWait ? { turn_wait_ms: { type: "integer", minimum: 1, maximum: 600000 } } : {}),
    dry_run: { type: "boolean", default: true },
    approval_audit_id: { type: "string" }
  };
}

function startControlSchema(): Record<string, unknown> {
  return {
    dry_run: { type: "boolean", default: true },
    approval_audit_id: { type: "string" }
  };
}

function controlInput(input: Record<string, unknown>, message = false, expectedTurn = false) {
  return {
    threadId: requiredString(input.thread_id, "thread_id"),
    ...(message ? { message: requiredString(input.message, "message") } : {}),
    ...(expectedTurn ? { expectedTurnId: optionalString(input.expected_turn_id), turnWaitMs: optionalNumber(input.turn_wait_ms) } : {}),
    dryRun: input.dry_run !== false,
    approvalAuditId: optionalString(input.approval_audit_id)
  };
}

function startControlInput(input: Record<string, unknown>) {
  return {
    dryRun: input.dry_run !== false,
    approvalAuditId: optionalString(input.approval_audit_id)
  };
}

function messageControlInput(input: Record<string, unknown>, expectedTurn = false, turnWait = false) {
  return {
    threadId: requiredString(input.thread_id, "thread_id"),
    message: requiredString(input.message, "message"),
    ...(expectedTurn ? { expectedTurnId: requiredString(input.expected_turn_id, "expected_turn_id") } : {}),
    ...(turnWait ? { turnWaitMs: optionalNumber(input.turn_wait_ms) } : {}),
    dryRun: input.dry_run !== false,
    approvalAuditId: optionalString(input.approval_audit_id)
  };
}

async function snakeCaseControlResult(value: Promise<any>) {
  const result = await value;
  const approvalPacket = result.live === false ? approvalPacketFromControlResult(result) : undefined;
  const proofState = result.proofState ? snakeCaseProofState(result.proofState) : undefined;
  const turn = result.turn ? snakeCaseTurnResolution(result.turn) : undefined;
  return {
    ...result,
    thread_id: result.threadId,
    created_thread_id: result.createdThreadId,
    created_thread_candidate_id: result.createdThreadCandidateId,
    created_thread_resumable: result.createdThreadResumable,
    created_thread_durability: result.createdThreadDurability,
    approval_audit_id: result.approvalAuditId,
    params_hash: result.paramsHash,
    message_hash: result.messageHash,
    control_sent: result.controlSent,
    expected_turn_id: result.expectedTurnId,
    turn_status: result.status,
    ...(turn ? { turn } : {}),
    ...(proofState ? { proof_state: proofState } : {}),
    ...(approvalPacket ? { approval_packet: approvalPacket } : {})
  };
}

function snakeCaseTurnResolution(turn: any): Record<string, unknown> {
  return {
    ...turn,
    ...(Array.isArray(turn.notificationMethods) ? { notification_methods: turn.notificationMethods } : {}),
    ...(typeof turn.approvalRequestCount === "number" ? { approval_request_count: turn.approvalRequestCount } : {}),
    ...(typeof turn.serverRequestCount === "number" ? { server_request_count: turn.serverRequestCount } : {})
  };
}

function approvalPacketFromControlResult(result: any): Record<string, unknown> {
  const action = String(result.action ?? "resume");
  const packetAction = action === "start" || action === "codex_start_thread"
    ? "start_thread"
    : action === "send" || action === "codex_send_message"
    ? "send_message"
    : action === "steer" || action === "codex_steer_thread"
      ? "steer_thread"
      : action === "interrupt" || action === "codex_interrupt_thread"
        ? "interrupt_thread"
        : "resume_session";
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const predictedMutation = Array.isArray(result.methodSequence) && result.methodSequence.length
    ? result.methodSequence.map((method: unknown) => String(method))
    : [String(result.method ?? "codex_control")];
  return {
    schema: "lco.approvalPacket.v1",
    packetId: `ap_${String(result.approvalAuditId ?? "unknown").replace(/^loo_audit_/, "")}`,
    action: packetAction,
    target: {
      sessionId: `sess_${String(result.threadId ?? "unknown")}`,
      title: String(result.threadId ?? "unknown")
    },
    intent: `${packetAction} dry-run for ${String(result.threadId ?? "unknown")}`,
    predictedMutation,
    ...(Array.isArray(result.methodSequence) ? { methodSequence: result.methodSequence } : {}),
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

function snakeCaseProofState(value: any): Record<string, unknown> {
  const nextProof = value.nextProof
    ? {
        tool: value.nextProof.tool,
        execute: value.nextProof.execute,
        args: value.nextProof.args,
        reason: value.nextProof.reason,
        stop_conditions: value.nextProof.stopConditions
      }
    : undefined;
  return {
    accepted_by_transport: value.acceptedByTransport,
    started: value.started,
    completed: value.completed,
    persisted: value.persisted,
    unverified_pending: value.unverifiedPending,
    status: value.status,
    thread_id: value.threadId,
    turn_id: value.turnId,
    response_status: value.responseStatus,
    ...(nextProof ? { next_proof: nextProof } : {}),
    caller_instruction: value.callerInstruction,
    proof_boundary: value.proofBoundary
  };
}

async function createStartThreadPostCreateProof(options: {
  db: LooDatabase;
  codexReadClient: CodexClient;
  input: Record<string, unknown>;
}) {
  const createdThreadId = startProofThreadId(options.input);
  if (!createdThreadId) {
    return startProofBase({
      status: "unresolved_unknown",
      reasonCodes: ["created_thread_id_missing", "post_create_proof_input_missing"],
      createdThreadId: null,
      parentThreadId: optionalString(options.input.parent_thread_id) ?? null
    });
  }

  const limit = optionalNumber(options.input.limit);
  const requestedTitle = optionalString(options.input.requested_title) ?? null;
  const alias = optionalString(options.input.alias) ?? null;
  const parentThreadId = optionalString(options.input.parent_thread_id) ?? null;
  const appServerThreads = await createCodexAppServerThreadsReport({
    client: options.codexReadClient,
    limit,
    readThreadId: createdThreadId
  });
  const appThread = appServerThreads.threads.find((thread) => thread.threadId === createdThreadId) ?? null;
  const readProbeOk = appServerThreads.readProbe?.error === null;
  const appServerFound = Boolean(appThread || readProbeOk);
  const rawSearch = searchSessions(options.db, { query: createdThreadId, limit: 5, appServerThreads });
  const refSearch = searchSessions(options.db, { query: startProofThreadRef(createdThreadId), limit: 5, appServerThreads });
  const titleSearch = requestedTitle ? searchSessions(options.db, { query: requestedTitle, limit: 5, appServerThreads }) : [];
  const aliasSearch = alias ? searchSessions(options.db, { query: alias, limit: 5, appServerThreads }) : [];
  const parentSearch = parentThreadId ? searchSessions(options.db, { query: parentThreadId, limit: 5, appServerThreads }) : [];
  const description = describeSession(options.db, createdThreadId);
  const preparedCards = getPreparedCards(options.db, { threadId: createdThreadId, limit: 1 });
  const preparedCard = preparedCards.cards[0] ?? null;
  const indexFound = Boolean(description || startProofSearchHasThread(rawSearch, createdThreadId) || startProofSearchHasThread(refSearch, createdThreadId));
  const described = Boolean(description);
  const preparedCardAvailable = Boolean(preparedCard);
  const preparedCardCurrent = Boolean(preparedCard && !preparedCard.stale && preparedCard.state === "ready");
  const persisted = readProbeOk && indexFound;
  const matchedBy = {
    raw_id: appServerFound || startProofSearchHasThread(rawSearch, createdThreadId),
    codex_thread_ref: appServerFound || startProofSearchHasThread(refSearch, createdThreadId),
    requested_title: requestedTitle ? startProofAliasMatch(requestedTitle, appThread) || startProofSearchHasThread(titleSearch, createdThreadId) : false,
    alias: alias ? startProofAliasMatch(alias, appThread) || startProofSearchHasThread(aliasSearch, createdThreadId) : false,
    parent_worker_provenance: parentThreadId ? startProofAliasMatch(`parent:${parentThreadId}`, appThread) || startProofSearchHasThread(parentSearch, createdThreadId) : false
  };
  const status = persisted
    ? "persisted"
    : described
      ? "described"
      : indexFound
        ? "indexed"
        : appServerFound
          ? "created_but_unindexed_pending"
          : "unresolved_unknown";
  const reasonCodes = [
    appServerFound ? "read_only_app_server_signal" : "app_server_thread_missing",
    readProbeOk ? "read_probe_found_thread" : "read_probe_missing_or_failed",
    indexFound ? "indexed_session_found" : "created_but_unindexed_pending",
    described ? "indexed_description_available" : "indexed_description_missing",
    preparedCardAvailable ? "prepared_card_available" : "prepared_card_missing",
    preparedCardAvailable && !preparedCardCurrent ? "prepared_card_stale_or_not_ready" : null,
    status === "unresolved_unknown" ? "unresolved_unknown" : null
  ].filter((reason): reason is string => Boolean(reason));

  return {
    ...startProofBase({
      status,
      reasonCodes,
      createdThreadId,
      parentThreadId
    }),
    worker_thread_ref: startProofThreadRef(createdThreadId),
    matched_by: matchedBy,
    proof: {
      app_server: {
        found: appServerFound,
        thread_ref: appThread?.sourceRef ?? startProofThreadRef(createdThreadId),
        app_server_ref: appThread?.appServerRef ?? null,
        status: appThread?.status ?? appServerThreads.readProbe?.status ?? null,
        title_sanitized: appThread?.titleSanitized ?? appServerThreads.readProbe?.titleSanitized ?? null,
        read_probe_ok: readProbeOk,
        coverage: appServerThreads.sourceCoverage.codexAppServer,
        errors: publicSafeAppServerErrors(appServerThreads.errors)
      },
      index: {
        found: indexFound,
        described,
        source_ref: startProofThreadRef(createdThreadId),
        title: description?.title ?? rawSearch.find((result) => result.threadId === createdThreadId)?.title ?? null,
        summary_available: Boolean(description?.summary),
        match_refs: startProofMatchRefs([rawSearch, refSearch, titleSearch, aliasSearch, parentSearch], createdThreadId)
      },
      prepared_state: {
        card_available: preparedCardAvailable,
        card_current: preparedCardCurrent,
        card_ref: preparedCard?.cardRef ?? null,
        state: preparedCard?.state ?? null,
        stale: preparedCard?.stale ?? false,
        coverage_gap: preparedCardAvailable
          ? preparedCardCurrent ? null : "prepared_card_stale_or_not_ready"
          : "prepared_card_missing",
        source_coverage: preparedCards.sourceCoverage.preparedCards
      }
    },
    prepared_card_ref: preparedCard?.cardRef ?? null
  };
}

function publicSafeAppServerErrors(errors: string[]): string[] {
  return errors
    .map((error) => publicSafeDiagnosticText(String(redactValue(error))))
    .slice(0, 3);
}

function startProofBase(input: {
  status: string;
  reasonCodes: string[];
  createdThreadId: string | null;
  parentThreadId: string | null;
}) {
  return {
    schema: "lco.codex.startThreadPostCreateProof.v1",
    public_safe: true,
    read_only: true,
    generated_at: new Date().toISOString(),
    status: input.status,
    created_thread_ref: input.createdThreadId ? startProofThreadRef(input.createdThreadId) : null,
    parent_thread_ref: input.parentThreadId ? startProofThreadRef(input.parentThreadId) : null,
    reason_codes: [...new Set(input.reasonCodes)],
    actions_performed: {
      live_codex_control_run: false,
      desktop_gui_action_run: false,
      raw_transcript_read: false,
      source_store_mutation: false,
      npm_publish: false,
      github_release: false
    },
    proof_boundary: "Public-safe read-only post-create proof only. This packet reads app-server metadata, indexed safe cache rows, and prepared-card coverage; it does not read raw transcripts, expose local paths, run live Codex control, mutate GUI state, mutate source stores, publish packages, or claim customer/release readiness."
  };
}

function startProofThreadId(input: Record<string, unknown>): string | null {
  return optionalString(input.created_thread_id)
    ?? optionalString(input.worker_thread_id)
    ?? bareStartProofThreadRef(optionalString(input.created_thread_ref))
    ?? null;
}

function startThreadPostCreateProofInput(input: Record<string, unknown>): Record<string, unknown> {
  return {
    created_thread_id: input.created_thread_id,
    worker_thread_id: input.worker_thread_id,
    created_thread_ref: input.created_thread_ref,
    requested_title: input.requested_title,
    alias: input.alias,
    parent_thread_id: input.parent_thread_id,
    limit: optionalBoundedInteger(input.limit, 1, 100)
  };
}

function bareStartProofThreadRef(value: string | undefined): string | null {
  if (!value) return null;
  return value.startsWith("codex_thread:") ? value.slice("codex_thread:".length).trim() || null : value;
}

function startProofThreadRef(threadId: string): string {
  return `codex_thread:${threadId}`;
}

function startProofSearchHasThread(results: Array<{ threadId?: string }>, threadId: string): boolean {
  return results.some((result) => result.threadId === threadId);
}

function startProofMatchRefs(searches: Array<Array<{ threadId?: string; sourceRef?: string }>>, threadId: string): string[] {
  const refs = searches
    .flat()
    .filter((result) => result.threadId === threadId)
    .map((result) => result.sourceRef)
    .filter((ref): ref is string => Boolean(ref));
  return [...new Set(refs)].slice(0, 8);
}

function startProofAliasMatch(value: string, thread: { titleSanitized?: string | null; titleAliases?: string[] } | null): boolean {
  const expected = normalizedStartProofText(value);
  if (!expected || !thread) return false;
  return [thread.titleSanitized ?? "", ...(thread.titleAliases ?? [])]
    .map(normalizedStartProofText)
    .some((candidate) => candidate === expected || candidate.includes(expected) || expected.includes(candidate));
}

function normalizedStartProofText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recallSourceRefInput(input: Record<string, unknown>): string {
  const sourceRef = optionalString(input.source_ref);
  if (sourceRef) return sourceRef;
  const threadId = optionalString(input.thread_id);
  if (threadId) return `codex_thread:${normalizeCodexThreadIdInput(threadId)}`;
  throw new Error("source_ref or thread_id is required");
}

function normalizeCodexThreadIdInput(value: string): string {
  return value.startsWith("codex_thread:") ? value.slice("codex_thread:".length) : value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoundedInteger(value: unknown, min: number, max: number): number | undefined {
  const number = optionalNumber(value);
  if (number === undefined) return undefined;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("value must be an object");
  return value as Record<string, unknown>;
}

function optionalRecordArray(value: unknown): Record<string, unknown>[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("value must be an array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`value[${index}] must be an object`);
    return item as Record<string, unknown>;
  });
}

function optionalProfile(value: unknown): "metadata" | "brief" | "evidence" | undefined {
  if (value === undefined) return undefined;
  if (value === "metadata" || value === "brief" || value === "evidence") return value;
  throw new Error("profile must be metadata, brief, or evidence");
}

function optionalSummaryLeafKind(value: unknown): SummaryLeafKind | undefined {
  if (value === undefined) return undefined;
  if (
    value === "user_prompt"
    || value === "assistant_message"
    || value === "proposed_plan"
    || value === "final_message"
    || value === "closeout"
    || value === "tool_call_metadata"
    || value === "event_metadata"
  ) return value;
  throw new Error("leaf_kind must be user_prompt, assistant_message, proposed_plan, final_message, closeout, tool_call_metadata, or event_metadata");
}

function optionalRecallIndexTarget(value: unknown, fallback: "codex" | "claude" | "all"): "codex" | "claude" | "all" {
  const target = optionalString(value);
  if (!target) return fallback;
  if (target === "codex" || target === "claude" || target === "all") return target;
  throw new Error("target must be codex, claude, or all");
}

function requiredPreparedStateView(value: unknown): "status" | "cards" | "leaves" | "expand" {
  if (value === "status" || value === "cards" || value === "leaves" || value === "expand") return value;
  throw new Error("view must be status, cards, leaves, or expand");
}

function requiredWatcherAction(value: unknown): "list" | "status" | "dry_run" | "events" | "resume_request_packet" {
  if (value === "list" || value === "status" || value === "dry_run" || value === "events" || value === "resume_request_packet") return value;
  throw new Error("watcher action must be list, status, dry_run, events, or resume_request_packet");
}

function requiredCodexExtractKind(value: unknown): "plans" | "final_messages" | "touched_files" | "tool_calls" {
  if (value === "plans" || value === "final_messages" || value === "touched_files" || value === "tool_calls") return value;
  throw new Error("extract kind must be plans, final_messages, touched_files, or tool_calls");
}

function requiredOperatingPictureKind(value: unknown): "thread_map" | "session_management_map" | "cockpit_inbox" | "collaboration_cockpit" | "collaboration_next_steps" | "runtime_desktop_visibility_status" | "active_thread_state" | "autonomy_tick" | "plan_state_pins" | "github_operating_items" {
  if (
    value === "thread_map"
    || value === "session_management_map"
    || value === "cockpit_inbox"
    || value === "collaboration_cockpit"
    || value === "collaboration_next_steps"
    || value === "runtime_desktop_visibility_status"
    || value === "active_thread_state"
    || value === "autonomy_tick"
    || value === "plan_state_pins"
    || value === "github_operating_items"
  ) return value;
  throw new Error("operating-picture kind is not supported");
}

function requiredDesktopProofCheck(value: unknown): "collaboration_proof" | "start_thread_post_create_proof" | "coherence" | "fallback_status" | "see" | "proof_report" | "live_proof_harness" {
  if (
    value === "collaboration_proof"
    || value === "start_thread_post_create_proof"
    || value === "coherence"
    || value === "fallback_status"
    || value === "see"
    || value === "proof_report"
    || value === "live_proof_harness"
  ) return value;
  throw new Error("desktop proof check is not supported");
}

function optionalPreparedCardState(value: unknown): PreparedCardState | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && (PREPARED_CARD_STATES as readonly string[]).includes(value)) return value as PreparedCardState;
  throw new Error(`state must be one of ${PREPARED_CARD_STATES.join(", ")}`);
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

function optionalRefreshKind(value: unknown): "none" | "desktop_refresh" | "desktop_restart" | undefined {
  if (value === undefined) return undefined;
  if (value === "none" || value === "desktop_refresh" || value === "desktop_restart") return value;
  throw new Error("refresh_kind must be none, desktop_refresh, or desktop_restart");
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

function optionalConfiguredPaths(value: unknown, fallback: string[]): string[] {
  return value === undefined ? fallback : stringArray(value);
}

function resolvePlanStateText(input: Record<string, unknown>): string {
  const inline = optionalString(input.plan_state_text);
  if (inline !== undefined) return inline;
  const path = optionalString(input.plan_state_path);
  if (path !== undefined) {
    try {
      const resolved = realpathSync(path);
      if (!["PLAN_STATE", "PLAN_STATE.md"].includes(basename(resolved))) return "";
      const stats = statSync(resolved);
      if (!stats.isFile() || stats.size > 1_000_000) return "";
      return readFileSync(resolved, "utf8");
    } catch {
      return "";
    }
  }
  return "";
}

function optionalPlanStatePins(input: Record<string, unknown>): ReturnType<typeof createPlanStatePinsReport> | undefined {
  if (input.plan_state_text === undefined && input.plan_state_path === undefined) return undefined;
  return createPlanStatePinsReport(resolvePlanStateText(input));
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
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`github_items[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const id = optionalString(record.id);
    const title = optionalString(record.title);
    if (!id || !title) throw new Error(`github_items[${index}] requires id and title`);
    const state = optionalOperatingState(record.state);
    const urgency = optionalOperatingUrgency(record.urgency);
    return {
      id,
      title,
      kind: optionalGithubKind(record.kind),
      ...(state ? { state } : {}),
      ...(urgency ? { urgency } : {}),
      reasonCodes: optionalStringArray(record.reasonCodes ?? record.reason_codes),
      updatedAt: optionalString(record.updatedAt ?? record.updated_at) ?? null,
      nextAction: optionalString(record.nextAction ?? record.next_action),
      confidence: optionalNumber(record.confidence)
    };
  });
}

function optionalGithubRecords(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("github_records must be an array");
  return value;
}

function optionalGithubKind(value: unknown): "repo" | "issue" | "pr" | undefined {
  const normalized = optionalString(value)?.toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) return undefined;
  if (normalized === "repo" || normalized === "repository") return "repo";
  if (normalized === "issue") return "issue";
  if (normalized === "pr" || normalized === "pullrequest") return "pr";
  return undefined;
}

function optionalWatchSpecs(value: unknown): WatchSpec[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("watcher_specs must be an array");
  return value.map((item, index) => requiredWatchSpec(item, `watcher_specs[${index}]`));
}

function requiredWatchSpec(value: unknown, name: string): WatchSpec {
  const record = plainRecord(value, name);
  if (record.mutates === true) throw new Error(`${name} must be read-only with mutates=false`);
  const kind = requiredWatcherKind(record.kind, `${name}.kind`);
  const ttlSeconds = optionalNumber(record.ttlSeconds ?? record.ttl_seconds);
  if (ttlSeconds === undefined) throw new Error(`${name}.ttlSeconds is required`);
  const stopConditions = optionalStringArray(record.stopConditions ?? record.stop_conditions);
  if (!stopConditions || stopConditions.length === 0) throw new Error(`${name}.stopConditions are required`);
  const observedRecord = record.observed === undefined ? undefined : plainRecord(record.observed, `${name}.observed`);
  return {
    schema: "lco.watchSpec.v1",
    watchId: requiredString(record.watchId ?? record.watch_id, `${name}.watchId`),
    targetRef: requiredString(record.targetRef ?? record.target_ref, `${name}.targetRef`),
    kind,
    createdAt: requiredString(record.createdAt ?? record.created_at, `${name}.createdAt`),
    lastObservedAt: optionalString(record.lastObservedAt ?? record.last_observed_at) ?? null,
    ttlSeconds,
    ...(optionalNumber(record.staleAfterSeconds ?? record.stale_after_seconds) !== undefined ? { staleAfterSeconds: optionalNumber(record.staleAfterSeconds ?? record.stale_after_seconds) } : {}),
    stopConditions,
    wakeReason: optionalWatcherKind(record.wakeReason ?? record.wake_reason, `${name}.wakeReason`),
    evidenceIds: optionalStringArray(record.evidenceIds ?? record.evidence_ids),
    confidence: optionalNumber(record.confidence),
    mutates: false,
    observed: observedRecord ? {
      threadStatus: optionalString(observedRecord.threadStatus ?? observedRecord.thread_status),
      finalMessageCount: optionalNumber(observedRecord.finalMessageCount ?? observedRecord.final_message_count),
      prChecksChanged: optionalBoolean(observedRecord.prChecksChanged ?? observedRecord.pr_checks_changed),
      reviewCommentCount: optionalNumber(observedRecord.reviewCommentCount ?? observedRecord.review_comment_count),
      approvalExpiresAt: optionalString(observedRecord.approvalExpiresAt ?? observedRecord.approval_expires_at) ?? null,
      noActivitySeconds: optionalNumber(observedRecord.noActivitySeconds ?? observedRecord.no_activity_seconds)
    } : undefined
  };
}

function plainRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function requiredWatcherKind(value: unknown, name: string): WatchSpec["kind"] {
  const kind = optionalWatcherKind(value, name);
  if (!kind) throw new Error(`${name} is required`);
  return kind;
}

function optionalWatcherKind(value: unknown, name: string): WatchSpec["kind"] | undefined {
  if (value === undefined) return undefined;
  if (
    value === "thread_finished" ||
    value === "final_message_appeared" ||
    value === "pr_checks_changed" ||
    value === "review_comment_arrived" ||
    value === "no_activity" ||
    value === "approval_expired"
  ) return value;
  throw new Error(`${name} must be thread_finished, final_message_appeared, pr_checks_changed, review_comment_arrived, no_activity, or approval_expired`);
}

function optionalWatcherRecommendedAction(value: unknown): "inspect" | "resume" | "approve" | "ignore" | undefined {
  if (value === undefined) return undefined;
  if (value === "inspect" || value === "resume" || value === "approve" || value === "ignore") return value;
  throw new Error("recommended_action must be inspect, resume, approve, or ignore");
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
