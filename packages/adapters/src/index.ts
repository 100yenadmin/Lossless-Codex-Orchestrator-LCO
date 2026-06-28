import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
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

export type DesktopBackend = "direct" | "cua-driver" | "peekaboo";

export type DesktopProbe = {
  commandStatus(command: string, args?: string[]): DesktopCommandStatus;
  activeApplication?(): string | undefined;
};

export type DesktopCommandStatus = {
  available: boolean;
  command: string;
  version?: string;
  error?: string;
};

export type DesktopStatus = {
  backend: DesktopBackend;
  available: boolean;
  preferred: boolean;
  dryRunOnly: boolean;
  launch: {
    command: string;
    args: string[];
    transport: "stdio" | "none";
  };
  permissions: {
    accessibility: DesktopPermissionStatus;
    screenRecording: DesktopPermissionStatus;
  };
  focus: {
    beforeApplication?: string;
    afterApplication?: string;
    changed: boolean | null;
    proof: "status_probe_only_no_action" | "not_measured";
  };
  limitations: string[];
  backgroundSafeClaim: "not_proven" | "not_supported";
  note: string;
  version?: string;
  error?: string;
};

type DesktopPermissionStatus = {
  status: "unknown" | "not_applicable";
  note: string;
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
  let auditKey: Buffer | undefined;
  const getAuditKey = () => {
    auditKey ??= readOrCreateAuditKey(path);
    return auditKey;
  };
  return {
    path,
    fingerprintText(value: string): string {
      return hmacDigest(getAuditKey(), value);
    },
    fingerprintValue(value: unknown): string {
      return hmacDigest(getAuditKey(), JSON.stringify(value));
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

export async function desktopSee(input: { backend?: DesktopBackend; maxChars?: number; probe?: DesktopProbe } = {}): Promise<DesktopStatus> {
  return desktopBackendStatus(input.backend ?? "direct", input.probe ?? systemDesktopProbe());
}

export function desktopFallbackDiagnostics(input: { probe?: DesktopProbe } = {}) {
  const probe = input.probe ?? systemDesktopProbe();
  return {
    preferred: "cua-driver" as const,
    backends: [
      desktopBackendStatus("cua-driver", probe),
      desktopBackendStatus("peekaboo", probe),
      desktopBackendStatus("direct", probe)
    ]
  };
}

export function desktopActDryRun(input: { backend?: DesktopBackend; action?: string; dryRun?: boolean } = {}) {
  return {
    backend: input.backend ?? "direct",
    action: input.action ?? "unknown",
    live: false,
    dryRunOnly: true,
    approvalRequired: true,
    requestedLive: input.dryRun === false,
    note: "Desktop live action is not enabled in this beta without backend-specific approval and permission proof."
  };
}

function readOrCreateAuditKey(auditPath: string): Buffer {
  const keyPath = `${auditPath}.key`;
  try {
    writeFileSync(keyPath, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
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

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function desktopBackendStatus(backend: DesktopBackend, probe: DesktopProbe): DesktopStatus {
  const config = desktopBackendConfig(backend);
  const command = config.command ?? "";
  const beforeApplication = probe.activeApplication?.();
  const commandStatus = command ? probe.commandStatus(command, config.probeArgs) : { available: false, command };
  const afterApplication = probe.activeApplication?.();
  const focusMeasured = Boolean(beforeApplication || afterApplication);
  return {
    backend,
    available: commandStatus.available,
    preferred: backend === "cua-driver",
    dryRunOnly: true,
    launch: {
      command: commandStatus.command || command,
      args: config.launchArgs,
      transport: config.transport
    },
    permissions: config.permissions,
    focus: {
      beforeApplication,
      afterApplication,
      changed: focusMeasured ? beforeApplication !== afterApplication : null,
      proof: focusMeasured ? "status_probe_only_no_action" : "not_measured"
    },
    limitations: config.limitations,
    backgroundSafeClaim: config.backgroundSafeClaim,
    note: config.note,
    version: commandStatus.version,
    error: commandStatus.error
  };
}

function desktopBackendConfig(backend: DesktopBackend) {
  if (backend === "cua-driver") {
    return {
      command: process.env.LOO_CUA_DRIVER_BIN || "cua-driver",
      launchArgs: ["mcp"],
      probeArgs: ["--version"],
      transport: "stdio" as const,
      permissions: unknownDesktopPermissions("CUA Driver permissions have not been verified by this tool; run CUA diagnostics or OS settings before live use."),
      limitations: [
        "Direct Codex protocol remains preferred for thread control.",
        "No live GUI action is enabled until backend-specific approval exists.",
        "No-focus behavior is not claimed without local no-focus proof."
      ],
      backgroundSafeClaim: "not_proven" as const,
      note: "CUA Driver is the preferred desktop fallback and is expected to run as an MCP stdio backend with `cua-driver mcp`, but this diagnostic does not perform GUI actions."
    };
  }
  if (backend === "peekaboo") {
    return {
      command: process.env.LOO_PEEKABOO_BIN || "peekaboo",
      launchArgs: [],
      probeArgs: ["--version"],
      transport: "none" as const,
      permissions: unknownDesktopPermissions("Peekaboo macOS Accessibility and Screen Recording permissions have not been verified by this tool."),
      limitations: [
        "Peekaboo is secondary to CUA Driver for desktop fallback.",
        "Live Peekaboo actions require separate backend approval and permission proof.",
        "May use visible macOS accessibility flows; no background/no-focus claim is made here."
      ],
      backgroundSafeClaim: "not_proven" as const,
      note: "Peekaboo is packaged as a macOS fallback diagnostic surface only in this beta."
    };
  }
  return {
    command: "",
    launchArgs: [],
    probeArgs: [],
    transport: "none" as const,
    permissions: {
      accessibility: { status: "not_applicable" as const, note: "Direct Codex protocol does not use desktop Accessibility permissions." },
      screenRecording: { status: "not_applicable" as const, note: "Direct Codex protocol does not use desktop Screen Recording permissions." }
    },
    limitations: [
      "Direct backend means use Codex protocol/read tools before GUI fallback.",
      "No desktop GUI action is available through the direct backend."
    ],
    backgroundSafeClaim: "not_supported" as const,
    note: "Direct backend uses Codex protocol surfaces and is preferred before GUI fallback."
  };
}

function unknownDesktopPermissions(note: string) {
  return {
    accessibility: { status: "unknown" as const, note },
    screenRecording: { status: "unknown" as const, note }
  };
}

function systemDesktopProbe(): DesktopProbe {
  return {
    commandStatus(command, args = ["--version"]) {
      const result = spawnSync(command, args, { encoding: "utf8", timeout: 3000 });
      const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
      return {
        available: result.status === 0,
        command: redactValue(command) as string,
        version: result.status === 0 && output ? output.split(/\r?\n/)[0] : undefined,
        error: result.status === 0 ? undefined : output || result.error?.message || "command unavailable"
      };
    }
  };
}
