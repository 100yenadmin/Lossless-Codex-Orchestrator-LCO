import { randomUUID } from "node:crypto";

import {
  CODEX_CONTROL_DRY_RUN_TTL_MS,
  redactDiagnosticString,
  type CodexClient,
  type createCodexControl
} from "../../adapters/src/index.js";

type CodexControl = ReturnType<typeof createCodexControl>;
type RouteState = "active" | "idle";

type TargetProjection = {
  threadId: string;
  title: string | null;
  state: RouteState;
  turnId?: string;
};

type StoredTarget = TargetProjection & {
  ref: string;
  expiresAtMs: number;
};

export type CodexControlRouteResult = {
  schema: "lco.codex.controlRoute.v1";
  status: "selected" | "ambiguous" | "none" | "unavailable";
  route: "app_server" | "desktop_observation_required" | "unknown";
  target_ref: string | null;
  title_sanitized: string | null;
  state: RouteState | null;
  supported_actions: Array<"send" | "steer" | "interrupt">;
  expires_at: string | null;
  reason_codes: string[];
  public_safe: true;
  raw_transcript_returned: false;
};

export type CodexDeliveryResult = {
  schema: "lco.codex.delivery.v1";
  status: "dry_run_ready" | "completed" | "accepted" | "blocked";
  action: "send" | "steer" | "interrupt" | null;
  target_ref: string;
  live: boolean;
  control_sent: boolean | null;
  approval_audit_id?: string;
  params_hash?: string;
  message_hash?: string;
  reason_codes: string[];
  public_safe: true;
  raw_transcript_returned: false;
};

export function createCodexControlRouter(options: {
  client: CodexClient;
  control: CodexControl;
  ttlMs?: number;
  createRef?: () => string;
  now?: () => Date;
}) {
  const targets = new Map<string, StoredTarget>();
  const ttlMs = options.ttlMs ?? Math.min(5 * 60_000, CODEX_CONTROL_DRY_RUN_TTL_MS);
  const now = options.now ?? (() => new Date());
  const createRef = options.createRef ?? (() => `lco_target_${randomUUID().replaceAll("-", "")}`);

  async function route(input: { hint?: string }): Promise<CodexControlRouteResult> {
    let projections: TargetProjection[];
    try {
      projections = await loadDaemonTargets(options.client);
    } catch {
      return routeResult("unavailable", "unknown", null, ["daemon_unavailable"]);
    }

    const hint = input.hint?.trim();
    if (hint) {
      const normalizedHint = normalizeHint(hint);
      const matches = projections.filter((target) =>
        target.threadId === normalizedHint
        || target.title?.toLocaleLowerCase() === hint.toLocaleLowerCase()
      );
      if (matches.length === 1) return selectedRoute(matches[0]!);
      if (matches.length > 1) return routeResult("ambiguous", "app_server", null, ["explicit_hint_ambiguous"]);
      return routeResult("unavailable", "desktop_observation_required", null, ["explicit_hint_not_daemon_loaded"]);
    }

    const active = projections.filter((target) => target.state === "active");
    if (active.length === 1) return selectedRoute(active[0]!);
    if (active.length > 1) return routeResult("ambiguous", "app_server", null, ["multiple_active_daemon_targets"]);
    const idle = projections.filter((target) => target.state === "idle");
    if (idle.length === 1) return selectedRoute(idle[0]!);
    if (idle.length > 1) return routeResult("ambiguous", "app_server", null, ["multiple_idle_daemon_targets"]);
    return routeResult("none", "unknown", null, ["no_daemon_target"]);
  }

  async function deliver(input: {
    targetRef: string;
    message: string;
    dryRun?: boolean;
    approvalAuditId?: string;
    turnWaitMs?: number;
  }): Promise<CodexDeliveryResult> {
    const validation = await validateTarget(input.targetRef);
    if (!validation.ok) return blockedDelivery(input.targetRef, null, input.dryRun === false, validation.reason);
    const target = validation.target;
    if (target.state === "active" && !target.turnId) {
      return blockedDelivery(input.targetRef, null, input.dryRun === false, "active_turn_id_unavailable");
    }
    const action = target.state === "active" ? "steer" : "send";
    try {
      const result = action === "steer"
        ? await options.control.steerThread({
            threadId: target.threadId,
            message: input.message,
            expectedTurnId: target.turnId,
            dryRun: input.dryRun,
            approvalAuditId: input.approvalAuditId,
            turnWaitMs: input.turnWaitMs
          })
        : await options.control.sendMessage({
            threadId: target.threadId,
            message: input.message,
            loadedThread: true,
            awaitTurn: false,
            dryRun: input.dryRun,
            approvalAuditId: input.approvalAuditId,
            turnWaitMs: input.turnWaitMs
          });
      return publicDeliveryResult(input.targetRef, action, result);
    } catch (error) {
      if (String(error).includes("codex_control_attempt_indeterminate")) {
        return indeterminateDelivery(input.targetRef, action);
      }
      const reason = String(error).includes("active_turn_not_steerable")
        ? "active_turn_not_steerable"
        : "approval_or_control_rejected";
      return blockedDelivery(input.targetRef, action, input.dryRun === false, reason);
    }
  }

  async function interrupt(input: {
    targetRef: string;
    dryRun?: boolean;
    approvalAuditId?: string;
    turnWaitMs?: number;
  }): Promise<CodexDeliveryResult> {
    const validation = await validateTarget(input.targetRef);
    if (!validation.ok) return blockedDelivery(input.targetRef, "interrupt", input.dryRun === false, validation.reason);
    const target = validation.target;
    if (target.state !== "active" || !target.turnId) {
      return blockedDelivery(input.targetRef, "interrupt", input.dryRun === false, "target_not_interruptible");
    }
    try {
      const result = await options.control.interruptThread({
        threadId: target.threadId,
        expectedTurnId: target.turnId,
        dryRun: input.dryRun,
        approvalAuditId: input.approvalAuditId,
        turnWaitMs: input.turnWaitMs
      });
      return publicDeliveryResult(input.targetRef, "interrupt", result);
    } catch (error) {
      if (String(error).includes("codex_control_attempt_indeterminate")) {
        return indeterminateDelivery(input.targetRef, "interrupt");
      }
      return blockedDelivery(input.targetRef, "interrupt", input.dryRun === false, "approval_or_control_rejected");
    }
  }

  function selectedRoute(target: TargetProjection): CodexControlRouteResult {
    const createdAt = now().getTime();
    const ref = createRef();
    const stored: StoredTarget = {
      ...target,
      ref,
      expiresAtMs: createdAt + ttlMs
    };
    targets.set(ref, stored);
    return routeResult("selected", "app_server", stored, target.state === "active" && !target.turnId
      ? ["active_turn_id_unavailable"]
      : []);
  }

  async function validateTarget(ref: string): Promise<
    { ok: true; target: StoredTarget }
    | { ok: false; reason: string }
  > {
    const target = targets.get(ref);
    if (!target) return { ok: false, reason: "target_ref_unknown" };
    if (target.expiresAtMs <= now().getTime()) {
      targets.delete(ref);
      return { ok: false, reason: "target_ref_expired" };
    }
    try {
      const loaded = await loadedThreadIds(options.client);
      if (!loaded.includes(target.threadId)) return { ok: false, reason: "target_ownership_changed" };
      const current = await readTargetProjection(options.client, target.threadId);
      if (!current) return { ok: false, reason: "target_unavailable" };
      if (current.state !== target.state) return { ok: false, reason: "target_state_changed" };
      if (target.state === "active" && current.turnId !== target.turnId) {
        return { ok: false, reason: "target_turn_changed" };
      }
      return { ok: true, target };
    } catch {
      return { ok: false, reason: "daemon_unavailable" };
    }
  }

  return { route, deliver, interrupt };
}

async function loadDaemonTargets(client: CodexClient): Promise<TargetProjection[]> {
  const ids = await loadedThreadIds(client);
  const projections: TargetProjection[] = [];
  for (const id of ids) {
    const projection = await readTargetProjection(client, id);
    if (projection) projections.push(projection);
  }
  return projections;
}

async function loadedThreadIds(client: CodexClient): Promise<string[]> {
  const response = responseResult(await client.request("thread/loaded/list", {}));
  const data = recordValue(response)?.data;
  if (!Array.isArray(data)) throw new Error("thread/loaded/list unavailable");
  return data.filter((value): value is string => typeof value === "string" && value.length > 0);
}

async function readTargetProjection(client: CodexClient, threadId: string): Promise<TargetProjection | null> {
  const metadataResult = responseResult(await client.request("thread/read", { threadId, includeTurns: false }));
  let thread = recordValue(recordValue(metadataResult)?.thread);
  if (!thread) return null;
  const status = recordValue(thread.status);
  const statusType = typeof status?.type === "string"
    ? status.type
    : typeof thread.status === "string"
      ? thread.status
      : null;
  if (statusType !== "active" && statusType !== "idle") return null;
  if (statusType === "active") {
    const activeResult = responseResult(await client.request("thread/read", { threadId, includeTurns: true }));
    thread = recordValue(recordValue(activeResult)?.thread);
    if (!thread) return null;
  }
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  let turnId: string | undefined;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = recordValue(turns[index]);
    if (turn?.status === "inProgress" && typeof turn.id === "string" && turn.id) {
      turnId = turn.id;
      break;
    }
  }
  return {
    threadId,
    title: sanitizeTitle(thread.name),
    state: statusType,
    ...(turnId ? { turnId } : {})
  };
}

function responseResult(value: unknown): unknown {
  const response = recordValue(value);
  if (!response) return value;
  if (response.ok === false) throw new Error("Codex app-server request failed");
  return "result" in response ? response.result : value;
}

function routeResult(
  status: CodexControlRouteResult["status"],
  route: CodexControlRouteResult["route"],
  target: StoredTarget | null,
  reasonCodes: string[]
): CodexControlRouteResult {
  return {
    schema: "lco.codex.controlRoute.v1",
    status,
    route,
    target_ref: target?.ref ?? null,
    title_sanitized: target?.title ?? null,
    state: target?.state ?? null,
    supported_actions: target
      ? target.state === "active"
        ? target.turnId ? ["steer", "interrupt"] : []
        : ["send"]
      : [],
    expires_at: target ? new Date(target.expiresAtMs).toISOString() : null,
    reason_codes: reasonCodes,
    public_safe: true,
    raw_transcript_returned: false
  };
}

function publicDeliveryResult(
  targetRef: string,
  action: "send" | "steer" | "interrupt",
  rawResult: unknown
): CodexDeliveryResult {
  const result = recordValue(rawResult) ?? {};
  const live = result.live === true;
  const proof = recordValue(result.proofState);
  const completed = proof?.completed === true || proof?.status === "completed";
  return {
    schema: "lco.codex.delivery.v1",
    status: live ? completed ? "completed" : "accepted" : "dry_run_ready",
    action,
    target_ref: targetRef,
    live,
    control_sent: result.controlSent === true,
    ...(typeof result.approvalAuditId === "string" ? { approval_audit_id: result.approvalAuditId } : {}),
    ...(typeof result.paramsHash === "string" ? { params_hash: result.paramsHash } : {}),
    ...(typeof result.messageHash === "string" ? { message_hash: result.messageHash } : {}),
    reason_codes: [],
    public_safe: true,
    raw_transcript_returned: false
  };
}

function blockedDelivery(
  targetRef: string,
  action: CodexDeliveryResult["action"],
  live: boolean,
  reason: string
): CodexDeliveryResult {
  return {
    schema: "lco.codex.delivery.v1",
    status: "blocked",
    action,
    target_ref: targetRef,
    live,
    control_sent: false,
    reason_codes: [reason],
    public_safe: true,
    raw_transcript_returned: false
  };
}

function indeterminateDelivery(
  targetRef: string,
  action: Exclude<CodexDeliveryResult["action"], null>
): CodexDeliveryResult {
  return {
    schema: "lco.codex.delivery.v1",
    status: "blocked",
    action,
    target_ref: targetRef,
    live: true,
    control_sent: null,
    reason_codes: ["control_attempt_indeterminate", "approval_consumed_do_not_retry"],
    public_safe: true,
    raw_transcript_returned: false
  };
}

function normalizeHint(value: string): string {
  return value.startsWith("codex_thread:") ? value.slice("codex_thread:".length) : value;
}

function sanitizeTitle(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return redactDiagnosticString(value).replace(/\s+/g, " ").trim().slice(0, 160);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
