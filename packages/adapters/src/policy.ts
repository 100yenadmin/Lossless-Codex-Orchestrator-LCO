export type CodexMethodSurface = "generic" | "read" | "control" | "smoke_setup";

export type TargetMethodSurface = CodexMethodSurface;

export type TargetMethodPolicy = {
  targetName: string;
  readMethods: Set<string>;
  controlMethods: Set<string>;
  forbiddenMethods: Set<string>;
  smokeSetupMethods?: Set<string>;
};

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

export const CODEX_TARGET_METHOD_POLICY: TargetMethodPolicy = {
  targetName: "Codex",
  readMethods: CODEX_READ_METHODS,
  controlMethods: CODEX_CONTROL_METHODS,
  forbiddenMethods: CODEX_FORBIDDEN_METHODS,
  smokeSetupMethods: new Set(["thread/start"])
};

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
  lco_index_sessions: localCacheWrite("local_index"),
  lco_find: localCacheWrite("local_index"),
  lco_grep: localCacheWrite("local_index"),
  lco_search_sessions: localCacheWrite("local_index"),
  lco_describe_ref: localCacheWrite("local_index"),
  lco_expand_session: localCacheWrite("local_index"),
  lco_expand_query: localCacheWrite("local_index"),
  lco_prepared_state: readOnly("local_index"),
  lco_prepared_inbox: readOnly("local_index"),
  lco_recent_sessions: readOnly("local_index"),
  lco_watchers: readOnly("structured_operating_inputs"),
  lco_codex_app_server_status: readOnly("codex_direct"),
  lco_codex_app_server_threads: readOnly("codex_direct"),
  lco_visible_codex_map: readOnly("structured_operating_inputs"),
  lco_operating_picture: readOnly("structured_operating_inputs"),
  lco_project_digest: readOnly("structured_operating_inputs"),
  lco_attention_inbox: readOnly("structured_operating_inputs"),
  lco_business_pulse: readOnly("structured_operating_inputs"),
  lco_codex_extract: readOnly("local_index"),
  lco_closeout_dry_run: readOnly("local_index"),
  lco_session_sanitizer: readOnly("local_index"),
  lco_codex_sqlite_stores: readOnly("local_index"),
  lco_lcm_peer_dbs: readOnly("local_index"),
  lco_codex_control_dry_run: localCacheWrite("audit"),
  lco_codex_start_thread: approvalGatedControl("codex_direct"),
  lco_codex_resume_thread: approvalGatedControl("codex_direct"),
  lco_codex_send_message: approvalGatedControl("codex_direct"),
  lco_codex_steer_thread: approvalGatedControl("codex_direct"),
  lco_codex_interrupt_thread: approvalGatedControl("codex_direct"),
  lco_desktop_proof: readOnly("desktop_fallback"),
  lco_desktop_act: dryRunOnly("desktop_fallback"),
  lco_desktop_proof_action: approvalGatedControl("desktop_fallback", ["derived_cache", "desktop_gui"]),
  lco_doctor: readOnly("audit"),
  lco_permissions: readOnly("audit"),
  lco_audit_tail: readOnly("audit")
};

export function assertCodexMethodAllowed(method: string, surface: CodexMethodSurface = "generic"): void {
  assertTargetMethodAllowed(CODEX_TARGET_METHOD_POLICY, method, surface);
}

export function assertTargetMethodAllowed(policy: TargetMethodPolicy, method: string, surface: TargetMethodSurface = "generic"): void {
  if (surface === "smoke_setup" && policy.smokeSetupMethods?.has(method)) return;
  if (policy.forbiddenMethods.has(method)) {
    throw new Error(`${policy.targetName} method ${method} is forbidden on the ${surface} surface`);
  }
  if (policy.readMethods.has(method)) return;
  if (policy.controlMethods.has(method)) {
    if (surface === "control" || surface === "smoke_setup") return;
    throw new Error(`${policy.targetName} method ${method} is not allowed on generic ${policy.targetName} surfaces`);
  }
  throw new Error(`${policy.targetName} method ${method} is not allowlisted on the ${surface} surface`);
}
