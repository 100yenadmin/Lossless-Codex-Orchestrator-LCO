import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  paramsHash: string;
  messageHash?: string;
  method?: string;
  response?: unknown;
};

export type AuditStore = ReturnType<typeof createAuditStore>;
type ControlAuditStore = Pick<AuditStore, "path" | "append" | "find" | "fingerprintText" | "fingerprintValue">;

export type AuditRecord = {
  id: string;
  action: string;
  target: string;
  paramsHash: string;
  messageHash?: string;
  live: boolean;
  createdAt: string;
};

export function createAuditStore(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  return {
    path,
    fingerprintText(value: string): string {
      return hmacDigest(readOrCreateAuditKey(path), value);
    },
    fingerprintValue(value: unknown): string {
      return hmacDigest(readOrCreateAuditKey(path), JSON.stringify(value));
    },
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
    },
    tail(limit = 20): AuditRecord[] {
      if (!existsSync(path)) return [];
      const boundedLimit = Math.max(1, Math.min(limit, 1000));
      const records: AuditRecord[] = [];
      for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
        try {
          records.push(JSON.parse(line) as AuditRecord);
        } catch {
          // Ignore corrupt partial writes so audit inspection stays available.
        }
      }
      return records.slice(-boundedLimit);
    }
  };
}

export function createCodexControl(options: { audit: ControlAuditStore; client: CodexClient }) {
  const execute = async (spec: {
    action: string;
    method: string;
    threadId: string;
    params: Record<string, unknown>;
    message?: string;
    dryRun?: boolean;
    approvalAuditId?: string;
  }): Promise<ControlResult> => {
    assertCodexMethodAllowed(spec.method, "control");
    const paramsHash = options.audit.fingerprintValue({ action: spec.action, method: spec.method, threadId: spec.threadId, params: spec.params });
    const messageHash = spec.message === undefined ? undefined : options.audit.fingerprintText(spec.message);
    if (spec.dryRun !== false) {
      const record = options.audit.append({
        action: spec.action,
        target: spec.threadId,
        paramsHash,
        messageHash,
        live: false
      });
      return { action: spec.action, threadId: spec.threadId, live: false, approvalAuditId: record.id, paramsHash, messageHash, method: spec.method };
    }

    if (!spec.approvalAuditId) {
      throw new Error("approval_audit_id is required for live Codex control actions");
    }
    const previous = options.audit.find(spec.approvalAuditId);
    if (!previous) {
      throw new Error("approval_audit_id was not found in the local audit log");
    }
    if (previous.live !== false) {
      throw new Error("approval_audit_id must reference a dry-run Codex control audit record");
    }
    if (previous.action !== spec.action || previous.target !== spec.threadId || previous.paramsHash !== paramsHash) {
      throw new Error("approval_audit_id does not match this Codex control action");
    }
    const response = await options.client.request(spec.method, spec.params);
    const liveRecord = options.audit.append({ action: spec.action, target: spec.threadId, paramsHash, messageHash, live: true });
    return { action: spec.action, threadId: spec.threadId, live: true, approvalAuditId: liveRecord.id, paramsHash, messageHash, method: spec.method, response: redactValue(response) };
  };

  return {
    sendMessage(input: { threadId: string; message: string; dryRun?: boolean; approvalAuditId?: string }) {
      return execute({
        action: "codex_send_message",
        method: "turn/start",
        threadId: input.threadId,
        message: input.message,
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
        message: input.message,
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

function readOrCreateAuditKey(auditPath: string): Buffer {
  const keyPath = `${auditPath}.key`;
  if (!existsSync(keyPath)) {
    writeFileSync(keyPath, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
  }
  const encoded = readFileSync(keyPath, "utf8").trim();
  if (!/^[a-f0-9]{64}$/i.test(encoded)) {
    throw new Error(`Audit fingerprint key is invalid: ${keyPath}`);
  }
  return Buffer.from(encoded, "hex");
}

function hmacDigest(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}
