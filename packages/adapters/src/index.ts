import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertCodexMethodAllowed } from "./policy.js";
import { redactValue } from "./redaction.js";

export * from "./codex-jsonrpc.js";
export * from "./policy.js";
export * from "./redaction.js";

export type CodexClient = {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
};

export type ControlResult = {
  action: string;
  threadId: string;
  live: boolean;
  approvalAuditId: string;
  method?: string;
  response?: unknown;
};

export type AuditStore = ReturnType<typeof createAuditStore>;

type AuditRecord = {
  id: string;
  action: string;
  target: string;
  paramsHash: string;
  live: boolean;
  createdAt: string;
};

export function createAuditStore(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  return {
    path,
    append(record: Omit<AuditRecord, "id" | "createdAt">): AuditRecord {
      const full: AuditRecord = {
        id: `loo_audit_${randomUUID().replaceAll("-", "")}`,
        createdAt: new Date().toISOString(),
        ...record
      };
      appendFileSync(path, `${JSON.stringify(full)}\n`);
      return full;
    },
    find(id: string): AuditRecord | null {
      if (!existsSync(path)) return null;
      const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const parsed = JSON.parse(lines[index]!) as AuditRecord;
        if (parsed.id === id) return parsed;
      }
      return null;
    }
  };
}

export function createCodexControl(options: { audit: AuditStore; client: CodexClient }) {
  const execute = async (spec: {
    action: string;
    method: string;
    threadId: string;
    params: Record<string, unknown>;
    dryRun?: boolean;
    approvalAuditId?: string;
  }): Promise<ControlResult> => {
    assertCodexMethodAllowed(spec.method, "control");
    const paramsHash = stableHash({ action: spec.action, method: spec.method, threadId: spec.threadId, params: spec.params });
    if (spec.dryRun !== false) {
      const record = options.audit.append({
        action: spec.action,
        target: spec.threadId,
        paramsHash,
        live: false
      });
      return { action: spec.action, threadId: spec.threadId, live: false, approvalAuditId: record.id, method: spec.method };
    }

    if (!spec.approvalAuditId) {
      throw new Error("approval_audit_id is required for live Codex control actions");
    }
    const previous = options.audit.find(spec.approvalAuditId);
    if (!previous) {
      throw new Error("approval_audit_id was not found in the local audit log");
    }
    if (previous.action !== spec.action || previous.target !== spec.threadId || previous.paramsHash !== paramsHash) {
      throw new Error("approval_audit_id does not match this Codex control action");
    }
    const response = await options.client.request(spec.method, spec.params);
    const liveRecord = options.audit.append({ action: spec.action, target: spec.threadId, paramsHash, live: true });
    return { action: spec.action, threadId: spec.threadId, live: true, approvalAuditId: liveRecord.id, method: spec.method, response: redactValue(response) };
  };

  return {
    sendMessage(input: { threadId: string; message: string; dryRun?: boolean; approvalAuditId?: string }) {
      return execute({
        action: "codex_send_message",
        method: "turn/start",
        threadId: input.threadId,
        dryRun: input.dryRun,
        approvalAuditId: input.approvalAuditId,
        params: { threadId: input.threadId, input: [{ type: "text", text: input.message }] }
      });
    },
    resumeThread(input: { threadId: string; dryRun?: boolean; approvalAuditId?: string }) {
      return execute({
        action: "codex_resume_thread",
        method: "thread/resume",
        threadId: input.threadId,
        dryRun: input.dryRun,
        approvalAuditId: input.approvalAuditId,
        params: { threadId: input.threadId, excludeTurns: true }
      });
    },
    steerThread(input: { threadId: string; message: string; dryRun?: boolean; approvalAuditId?: string }) {
      return execute({
        action: "codex_steer_thread",
        method: "turn/steer",
        threadId: input.threadId,
        dryRun: input.dryRun,
        approvalAuditId: input.approvalAuditId,
        params: { threadId: input.threadId, input: [{ type: "text", text: input.message }] }
      });
    },
    interruptThread(input: { threadId: string; dryRun?: boolean; approvalAuditId?: string }) {
      return execute({
        action: "codex_interrupt_thread",
        method: "turn/interrupt",
        threadId: input.threadId,
        dryRun: input.dryRun,
        approvalAuditId: input.approvalAuditId,
        params: { threadId: input.threadId }
      });
    }
  };
}

export async function desktopSee(input: { backend?: "direct" | "cua-driver" | "peekaboo"; maxChars?: number } = {}) {
  return {
    backend: input.backend ?? "direct",
    available: false,
    dryRunOnly: true,
    note: "Desktop fallback adapters are packaged as permission-aware stubs in this beta. Use Codex direct protocol for thread control until CUA/Peekaboo is configured."
  };
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
