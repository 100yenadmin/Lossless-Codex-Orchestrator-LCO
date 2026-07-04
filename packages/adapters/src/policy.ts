export type CodexMethodSurface = "generic" | "read" | "control" | "smoke_setup";

export const CODEX_READ_METHODS = new Set([
  "initialize",
  "remoteControl/status/read",
  "thread/list",
  "thread/loaded/list",
  "thread/read",
  "thread/turns/list",
  "model/list",
  "app/list",
  "account/read",
  "account/rateLimits/read",
  "config/read",
  "collaborationMode/list",
  "getConversationSummary",
  "getAuthStatus",
  "gitDiffToRemote"
]);

export const CODEX_CONTROL_METHODS = new Set([
  "thread/start",
  "thread/resume",
  "turn/start",
  "turn/steer",
  "turn/interrupt"
]);

export const CODEX_FORBIDDEN_METHODS = new Set([
  "thread/fork",
  "thread/archive",
  "thread/delete",
  "thread/unsubscribe",
  "thread/name/set",
  "thread/goal/set",
  "thread/goal/clear",
  "thread/metadata/update",
  "thread/unarchive",
  "thread/inject_items",
  "thread/rollback",
  "thread/compact/start",
  "thread/shellCommand",
  "thread/approveGuardianDeniedAction",
  "thread/settings/update",
  "thread/memoryMode/set",
  "command/exec",
  "command/exec/write",
  "command/exec/terminate",
  "command/exec/resize",
  "fs/writeFile",
  "fs/createDirectory",
  "fs/remove",
  "fs/copy",
  "fs/watch",
  "fs/unwatch",
  "config/value/write",
  "config/batchWrite",
  "skills/extraRoots/set",
  "skills/config/write",
  "plugin/install",
  "plugin/uninstall",
  "plugin/share/save",
  "plugin/share/updateTargets",
  "plugin/share/delete",
  "marketplace/add",
  "marketplace/remove",
  "marketplace/upgrade",
  "account/login/start",
  "account/login/cancel",
  "account/logout",
  "account/rateLimitResetCredit/consume",
  "account/sendAddCreditsNudgeEmail",
  "remoteControl/enable",
  "remoteControl/disable",
  "remoteControl/pairing/start",
  "remoteControl/pairing/status",
  "remoteControl/client/revoke",
  "remoteControl/approve",
  "remoteControl/deny",
  "mcpServer/oauth/login",
  "config/mcpServer/reload",
  "mcpServer/tool/call",
  "windowsSandbox/setupStart",
  "feedback/upload",
  "externalAgentConfig/import"
]);

export type LooCommandMode = "read_only" | "local_cache_write" | "approval_gated_control" | "dry_run_only";
export type LooCommandSource = "local_index" | "structured_operating_inputs" | "codex_direct" | "desktop_fallback" | "audit";
export type LooMutationClass =
  | "source_store"
  | "derived_cache"
  | "external_system"
  | "live_control"
  | "desktop_gui"
  | "github_write"
  | "notion_write"
  | "release_publish"
  | "npm_publish";

export type LooCommandSafety = {
  mode: LooCommandMode;
  source: LooCommandSource;
  requiresApproval: boolean;
  mutationClasses: LooMutationClass[];
};

function commandSafety(
  mode: LooCommandMode,
  source: LooCommandSource,
  requiresApproval: boolean,
  mutationClasses: readonly LooMutationClass[] = []
): LooCommandSafety {
  return { mode, source, requiresApproval, mutationClasses: [...mutationClasses] };
}

function readOnly(source: LooCommandSource, mutationClasses: readonly LooMutationClass[] = []): LooCommandSafety {
  return commandSafety("read_only", source, false, mutationClasses);
}

function localCacheWrite(source: LooCommandSource, mutationClasses: readonly LooMutationClass[] = ["derived_cache"]): LooCommandSafety {
  return commandSafety("local_cache_write", source, false, mutationClasses);
}

function approvalGatedControl(source: LooCommandSource, mutationClasses: readonly LooMutationClass[] = ["derived_cache", "live_control"]): LooCommandSafety {
  return commandSafety("approval_gated_control", source, true, mutationClasses);
}

function dryRunOnly(source: LooCommandSource, mutationClasses: readonly LooMutationClass[] = []): LooCommandSafety {
  return commandSafety("dry_run_only", source, true, mutationClasses);
}

// This table is the manually reviewed safety contract for tool side effects.
// Any execute-path change that adds or removes a write/control/publish behavior
// must update this table, the manifests, and the focused policy tests together.
export const LOO_COMMAND_POLICY: Record<string, LooCommandSafety> = {
  loo_index_sessions: localCacheWrite("local_index"),
  loo_grep: readOnly("local_index"),
  loo_search_sessions: readOnly("local_index"),
  loo_describe_ref: readOnly("local_index"),
  loo_describe_session: readOnly("local_index"),
  loo_expand_session: readOnly("local_index"),
  loo_expand_query: readOnly("local_index"),
  loo_summary_leaves: readOnly("local_index"),
  loo_summary_expand: readOnly("local_index"),
  loo_prepared_state_status: readOnly("local_index"),
  loo_prepared_cards: readOnly("local_index"),
  loo_prepared_inbox: readOnly("local_index"),
  loo_codex_thread_map: readOnly("local_index"),
  loo_codex_session_management_map: readOnly("local_index"),
  loo_recent_sessions: readOnly("local_index"),
  loo_cockpit_inbox: readOnly("local_index"),
  loo_codex_collaboration_cockpit: readOnly("structured_operating_inputs"),
  loo_codex_collaboration_next_steps: readOnly("structured_operating_inputs"),
  loo_codex_desktop_collaboration_proof: readOnly("desktop_fallback"),
  loo_codex_runtime_desktop_visibility_status: readOnly("structured_operating_inputs"),
  loo_codex_active_thread_state: readOnly("structured_operating_inputs"),
  loo_codex_autonomy_tick: readOnly("structured_operating_inputs"),
  loo_watchers_list: readOnly("structured_operating_inputs"),
  loo_watcher_status: readOnly("structured_operating_inputs"),
  loo_watcher_dry_run: readOnly("structured_operating_inputs"),
  loo_watcher_events: readOnly("structured_operating_inputs"),
  loo_resume_request_packet: readOnly("structured_operating_inputs"),
  loo_codex_app_server_status: readOnly("codex_direct"),
  loo_codex_app_server_threads: readOnly("codex_direct"),
  loo_codex_start_thread_post_create_proof: readOnly("codex_direct"),
  loo_visible_codex_map: readOnly("structured_operating_inputs"),
  loo_codex_desktop_coherence: readOnly("structured_operating_inputs"),
  loo_codex_desktop_fallback_status: readOnly("desktop_fallback"),
  loo_plan_state_pins: readOnly("structured_operating_inputs"),
  loo_github_operating_items: readOnly("structured_operating_inputs"),
  loo_project_digest: readOnly("structured_operating_inputs"),
  loo_attention_inbox: readOnly("structured_operating_inputs"),
  loo_business_pulse: readOnly("structured_operating_inputs"),
  loo_codex_final_messages: readOnly("local_index"),
  loo_codex_plans: readOnly("local_index"),
  loo_codex_touched_files: readOnly("local_index"),
  loo_codex_tool_calls: readOnly("local_index"),
  loo_closeout_dry_run: readOnly("local_index"),
  loo_session_sanitizer: readOnly("local_index"),
  loo_codex_sqlite_stores: readOnly("local_index"),
  loo_lcm_peer_dbs: readOnly("local_index"),
  loo_codex_control_dry_run: localCacheWrite("audit"),
  loo_codex_start_thread: approvalGatedControl("codex_direct"),
  loo_codex_resume_thread: approvalGatedControl("codex_direct"),
  loo_codex_send_message: approvalGatedControl("codex_direct"),
  loo_codex_steer_thread: approvalGatedControl("codex_direct"),
  loo_codex_interrupt_thread: approvalGatedControl("codex_direct"),
  loo_desktop_see: readOnly("desktop_fallback"),
  loo_desktop_act: dryRunOnly("desktop_fallback"),
  loo_desktop_proof_action: approvalGatedControl("desktop_fallback", ["derived_cache", "desktop_gui"]),
  loo_desktop_proof_report: readOnly("desktop_fallback"),
  loo_desktop_live_proof_harness: readOnly("desktop_fallback"),
  loo_doctor: readOnly("audit"),
  loo_permissions: readOnly("audit"),
  loo_audit_tail: readOnly("audit")
};

export function assertCodexMethodAllowed(method: string, surface: CodexMethodSurface = "generic"): void {
  if (surface === "smoke_setup" && method === "thread/start") return;
  if (CODEX_FORBIDDEN_METHODS.has(method)) {
    throw new Error(`Codex method ${method} is forbidden on the ${surface} surface`);
  }
  if (CODEX_READ_METHODS.has(method)) return;
  if (CODEX_CONTROL_METHODS.has(method)) {
    if (surface === "control" || surface === "smoke_setup") return;
    throw new Error(`Codex method ${method} is not allowed on generic Codex surfaces`);
  }
  throw new Error(`Codex method ${method} is not allowlisted on the ${surface} surface`);
}
