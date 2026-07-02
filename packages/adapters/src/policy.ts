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
  "thread/resume",
  "turn/start",
  "turn/steer",
  "turn/interrupt"
]);

export const CODEX_FORBIDDEN_METHODS = new Set([
  "thread/start",
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

export type LooCommandSafety = {
  mode: "read_only" | "approval_gated_control" | "dry_run_only";
  source: "local_index" | "structured_operating_inputs" | "codex_direct" | "desktop_fallback" | "audit";
  requiresApproval: boolean;
};

export const LOO_COMMAND_POLICY: Record<string, LooCommandSafety> = {
  loo_index_sessions: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_grep: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_search_sessions: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_describe_ref: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_describe_session: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_expand_session: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_expand_query: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_codex_thread_map: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_codex_session_management_map: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_recent_sessions: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_cockpit_inbox: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_codex_collaboration_cockpit: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_codex_collaboration_next_steps: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_codex_desktop_collaboration_proof: { mode: "read_only", source: "desktop_fallback", requiresApproval: false },
  loo_codex_runtime_desktop_visibility_status: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_watchers_list: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_watcher_status: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_watcher_dry_run: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_resume_request_packet: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_codex_app_server_status: { mode: "read_only", source: "codex_direct", requiresApproval: false },
  loo_codex_app_server_threads: { mode: "read_only", source: "codex_direct", requiresApproval: false },
  loo_visible_codex_map: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_codex_desktop_coherence: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_codex_desktop_fallback_status: { mode: "read_only", source: "desktop_fallback", requiresApproval: false },
  loo_plan_state_pins: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_github_operating_items: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_project_digest: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_attention_inbox: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_business_pulse: { mode: "read_only", source: "structured_operating_inputs", requiresApproval: false },
  loo_codex_final_messages: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_codex_plans: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_codex_touched_files: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_codex_tool_calls: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_closeout_dry_run: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_session_sanitizer: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_codex_sqlite_stores: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_lcm_peer_dbs: { mode: "read_only", source: "local_index", requiresApproval: false },
  loo_codex_control_dry_run: { mode: "read_only", source: "audit", requiresApproval: false },
  loo_codex_resume_thread: { mode: "approval_gated_control", source: "codex_direct", requiresApproval: true },
  loo_codex_send_message: { mode: "approval_gated_control", source: "codex_direct", requiresApproval: true },
  loo_codex_steer_thread: { mode: "approval_gated_control", source: "codex_direct", requiresApproval: true },
  loo_codex_interrupt_thread: { mode: "approval_gated_control", source: "codex_direct", requiresApproval: true },
  loo_desktop_see: { mode: "read_only", source: "desktop_fallback", requiresApproval: false },
  loo_desktop_act: { mode: "dry_run_only", source: "desktop_fallback", requiresApproval: true },
  loo_desktop_proof_action: { mode: "approval_gated_control", source: "desktop_fallback", requiresApproval: true },
  loo_desktop_proof_report: { mode: "read_only", source: "desktop_fallback", requiresApproval: false },
  loo_desktop_live_proof_harness: { mode: "read_only", source: "desktop_fallback", requiresApproval: false },
  loo_doctor: { mode: "read_only", source: "audit", requiresApproval: false },
  loo_permissions: { mode: "read_only", source: "audit", requiresApproval: false },
  loo_audit_tail: { mode: "read_only", source: "audit", requiresApproval: false }
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
