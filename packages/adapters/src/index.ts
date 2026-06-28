import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
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
  commandOutput?(command: string, args?: string[], timeoutMs?: number): DesktopCommandOutput;
  activeApplication?(): string | undefined;
};

export type DesktopCommandStatus = {
  available: boolean;
  command: string;
  version?: string;
  error?: string;
};

export type DesktopCommandOutput = {
  status: number;
  command: string;
  stdout?: string;
  stderr?: string;
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
    readiness: {
      status: "not_probed" | "unavailable" | "not_applicable";
      note: string;
    };
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
  snapshot?: DesktopSnapshotStatus;
  visibleCodex?: {
    macros: VisibleCodexMacro[];
    safetyRules: string[];
    windows?: VisibleCodexWindows;
    threadMap?: VisibleCodexThreadMap;
  };
  limitations: string[];
  backgroundSafeClaim: "not_proven" | "not_supported";
  note: string;
  version?: string;
  error?: string;
};

type DesktopPermissionStatus = {
  status: "unknown" | "not_applicable" | "granted" | "denied";
  note: string;
};

type VisibleCodexMacro = {
  name: string;
  mode: "read_only" | "dry_run_only";
  legacyCommand: string[];
  sideEffects: string[];
  description: string;
};

type VisibleCodexWindows = {
  source: "peekaboo_snapshot";
  count: number;
  windows: VisibleCodexWindow[];
  warnings: string[];
};

type VisibleCodexWindow = {
  visibleId: string;
  index: number;
  appName: string;
  title?: string;
  titleHash?: string;
  snapshotId?: string;
  frontmost: boolean;
  source: "peekaboo_snapshot";
};

type VisibleCodexThreadMap = {
  source: "peekaboo_snapshot";
  count: number;
  maxItems: number;
  threads: VisibleCodexThreadCandidate[];
  warnings: string[];
};

type VisibleCodexThreadCandidate = {
  visibleId: string;
  index: number;
  title: string;
  rawTitle: string;
  project?: string;
  status?: string;
  updatedLabel?: string;
  titleHash: string;
  role?: string;
  sourceElementId: string;
  bounds?: { x: number; y: number; width: number; height: number };
  center?: { x: number; y: number };
  confidence: "low" | "medium" | "high";
  source: "peekaboo_snapshot";
  titleAvailable: boolean;
};

type DesktopSnapshotStatus = {
  requested: boolean;
  blocked: boolean;
  reason?: "sensitive_app_blocked" | "frontmost_app_unknown" | "peekaboo_unavailable" | "peekaboo_probe_unavailable" | "peekaboo_snapshot_failed";
  engine?: "peekaboo";
  frontmostApp?: string;
  windowTitle?: string;
  snapshotId?: string;
  elements: DesktopSnapshotElement[];
  truncated: boolean;
  maxNodes: number;
  warnings: string[];
};

type DesktopSnapshotElement = {
  elementId: string;
  role?: string;
  label?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  actionable: boolean;
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

export async function desktopSee(input: { backend?: DesktopBackend; includeSnapshot?: boolean; maxChars?: number; maxNodes?: number; probe?: DesktopProbe } = {}): Promise<DesktopStatus> {
  return desktopBackendStatus(input.backend ?? "direct", input.probe ?? systemDesktopProbe(), {
    includeSnapshot: input.includeSnapshot === true,
    maxChars: input.maxChars,
    maxNodes: input.maxNodes
  });
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

function desktopBackendStatus(
  backend: DesktopBackend,
  probe: DesktopProbe,
  options: { includeSnapshot?: boolean; maxChars?: number; maxNodes?: number } = {}
): DesktopStatus {
  const config = desktopBackendConfig(backend);
  const command = config.command ?? "";
  const beforeApplication = probe.activeApplication?.();
  const commandStatus = command ? probe.commandStatus(command, config.probeArgs) : { available: false, command };
  const afterApplication = probe.activeApplication?.();
  const focusMeasured = Boolean(beforeApplication || afterApplication);
  const permissions = backend === "peekaboo" ? peekabooPermissions(command, commandStatus.available, probe) : config.permissions;
  const snapshot = backend === "peekaboo" && options.includeSnapshot ? peekabooSnapshot(command, commandStatus.available, probe, options) : undefined;
  return {
    backend,
    available: commandStatus.available,
    preferred: backend === "cua-driver",
    dryRunOnly: true,
    launch: {
      command: commandStatus.command || command,
      args: config.launchArgs,
      transport: config.transport,
      readiness: desktopLaunchReadiness(backend, commandStatus.available)
    },
    permissions,
    focus: {
      beforeApplication,
      afterApplication,
      changed: focusMeasured ? beforeApplication !== afterApplication : null,
      proof: focusMeasured ? "status_probe_only_no_action" : "not_measured"
    },
    snapshot,
    visibleCodex: backend === "peekaboo" ? visibleCodexMacroPack(snapshot) : undefined,
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

function peekabooPermissions(command: string, available: boolean, probe: DesktopProbe) {
  const fallback = unknownDesktopPermissions("Peekaboo permissions could not be verified with `peekaboo permissions status --json --no-remote`.");
  if (!available || !probe.commandOutput) return fallback;
  const result = probe.commandOutput(command, ["permissions", "status", "--json", "--no-remote"], 3000);
  if (result.status !== 0 || !result.stdout) return fallback;
  const parsed = parseJsonObject(result.stdout);
  const data = asRecord(asRecord(parsed)?.data);
  const permissions = Array.isArray(data?.permissions) ? data.permissions : [];
  return {
    accessibility: peekabooPermissionStatus(permissions, "Accessibility"),
    screenRecording: peekabooPermissionStatus(permissions, "Screen Recording")
  };
}

function peekabooPermissionStatus(permissions: unknown[], name: string): DesktopPermissionStatus {
  const permission = permissions.map(asRecord).find((item) => item?.name === name);
  if (!permission) {
    return { status: "unknown", note: `${name} permission was not reported by Peekaboo.` };
  }
  return {
    status: permission.isGranted === true ? "granted" : "denied",
    note: `${name} permission reported by Peekaboo permissions status.`
  };
}

function peekabooSnapshot(
  command: string,
  available: boolean,
  probe: DesktopProbe,
  options: { maxChars?: number; maxNodes?: number }
): DesktopSnapshotStatus {
  const maxNodes = boundedInteger(options.maxNodes, 50, 1, 500);
  const maxChars = boundedInteger(options.maxChars, 4000, 1, 20000);
  const frontmostApp = probe.activeApplication?.();
  if (!frontmostApp) {
    return emptySnapshot({ maxNodes, blocked: true, reason: "frontmost_app_unknown", warnings: ["Frontmost app is unknown; snapshot capture was skipped."] });
  }
  const safeFrontmostApp = capTextValue(frontmostApp, maxChars);
  if (isSensitiveFrontmostApp(frontmostApp)) {
    return emptySnapshot({
      maxNodes,
      blocked: true,
      reason: "sensitive_app_blocked",
      frontmostApp: safeFrontmostApp,
      warnings: [`Frontmost app ${safeFrontmostApp} is denylisted; Peekaboo capture was skipped.`]
    });
  }
  if (!available) {
    return emptySnapshot({ maxNodes, blocked: true, reason: "peekaboo_unavailable", frontmostApp: safeFrontmostApp, warnings: ["Peekaboo is unavailable; snapshot capture was skipped."] });
  }
  if (!probe.commandOutput) {
    return emptySnapshot({ maxNodes, blocked: true, reason: "peekaboo_probe_unavailable", frontmostApp: safeFrontmostApp, warnings: ["No command output probe is configured for Peekaboo snapshot capture."] });
  }

  const result = probe.commandOutput(command, ["see", "--mode", "frontmost", "--capture-engine", "classic", "--json", "--no-remote"], 10000);
  if (result.status !== 0 || !result.stdout) {
    return emptySnapshot({
      maxNodes,
      blocked: true,
      reason: "peekaboo_snapshot_failed",
      frontmostApp: safeFrontmostApp,
      warnings: [capTextValue(result.stderr || result.error || "Peekaboo snapshot command failed.", maxChars)]
    });
  }
  const parsed = asRecord(parseJsonObject(result.stdout));
  if (!parsed || parsed.success === false) {
    return emptySnapshot({
      maxNodes,
      blocked: true,
      reason: "peekaboo_snapshot_failed",
      frontmostApp: safeFrontmostApp,
      warnings: [capTextValue(typeof parsed?.error === "string" ? parsed.error : "Peekaboo snapshot output was not valid JSON.", maxChars)]
    });
  }
  const data = asRecord(parsed.data) ?? parsed;
  const capturedApp = typeof data.application_name === "string" ? data.application_name : frontmostApp;
  const safeCapturedApp = capTextValue(capturedApp, maxChars);
  if (isSensitiveFrontmostApp(capturedApp)) {
    return emptySnapshot({
      maxNodes,
      blocked: true,
      reason: "sensitive_app_blocked",
      frontmostApp: safeCapturedApp,
      warnings: [`Captured app ${safeCapturedApp} is denylisted; snapshot output was discarded.`]
    });
  }
  const rawElements = Array.isArray(data.ui_elements) ? data.ui_elements : [];
  const elements = rawElements.slice(0, maxNodes).map((item) => peekabooElement(item, maxChars)).filter((item): item is DesktopSnapshotElement => item !== null);
  const elementCount = typeof data.element_count === "number" ? data.element_count : rawElements.length;
  return {
    requested: true,
    blocked: false,
    engine: "peekaboo",
    frontmostApp: safeCapturedApp,
    windowTitle: typeof data.window_title === "string" ? capTextValue(data.window_title, maxChars) : undefined,
    snapshotId: typeof data.snapshot_id === "string" ? capTextValue(data.snapshot_id, maxChars) : undefined,
    elements,
    truncated: rawElements.length > maxNodes || elementCount > elements.length,
    maxNodes,
    warnings: []
  };
}

function emptySnapshot(input: {
  maxNodes: number;
  blocked: boolean;
  reason: DesktopSnapshotStatus["reason"];
  frontmostApp?: string;
  warnings?: string[];
}): DesktopSnapshotStatus {
  return {
    requested: true,
    blocked: input.blocked,
    reason: input.reason,
    frontmostApp: input.frontmostApp,
    elements: [],
    truncated: false,
    maxNodes: input.maxNodes,
    warnings: input.warnings ?? []
  };
}

function peekabooElement(value: unknown, maxChars: number): DesktopSnapshotElement | null {
  const item = asRecord(value);
  if (!item) return null;
  const bounds = asRecord(item.bounds);
  return {
    elementId: capTextValue(String(item.id || item.element_id || "unknown"), maxChars),
    role: typeof item.role === "string" ? capTextValue(item.role, maxChars) : undefined,
    label: typeof item.label === "string" ? capTextValue(item.label, maxChars) : undefined,
    bounds: boundsToRect(bounds),
    actionable: item.is_actionable === true || item.actionable === true
  };
}

const threadStatusLabels = [
  "Awaiting response",
  "Running",
  "Working",
  "Thinking",
  "Needs approval",
  "Approval needed",
  "Queued",
  "Done",
  "Failed",
  "Error"
];
const threadSectionLabels = new Set(["pinned", "projects", "chats", "recent", "show more"]);
const threadControlLabels = new Set(["archive chat", "automation folders", "automations", "unarchive chat", "pin chat", "unpin chat", "continue", "copy", "copy message", "new chat", "new thread", "search", "settings", "send", "plugins"]);
const threadControlPrefixLabels = ["archive chat", "automation folders", "automations", "pin chat", "unarchive chat", "unpin chat"];
const threadTimePattern = /^(?:now|yesterday|\d+\s?(?:s|m|h|d|w|mo|y))$/i;

function visibleCodexMacroPack(snapshot?: DesktopSnapshotStatus) {
  const codexSnapshot = snapshot && !snapshot.blocked && isCodexSnapshot(snapshot) ? snapshot : undefined;
  return {
    macros: [
      visibleMacro("codex_frontmost", ["codex", "frontmost", "--json"], "Read whether Codex Desktop is frontmost."),
      visibleMacro("codex_windows", ["codex", "windows", "--json"], "Read visible Codex Desktop window metadata."),
      visibleMacro("codex_threads", ["codex", "threads", "--json"], "Read visible Codex Desktop thread candidates."),
      visibleMacro("codex_thread_map", ["codex", "thread-map", "--json"], "Read a joined visible-thread and stored-thread map."),
      visibleMacro("codex_snapshot", ["codex", "snapshot", "--json"], "Read a guarded visible Codex snapshot.")
    ],
    safetyRules: [
      "Run status/frontmost/windows before visible mutation.",
      "No generic prompt typing, send, approve, or generic click actions in this public beta surface.",
      "Snapshot capture must pass sensitive-app denylist checks before invoking Peekaboo.",
      "Live visible GUI actions remain disabled until backend-specific approval and permission gates exist."
    ],
    windows: codexSnapshot ? visibleWindowsFromSnapshot(codexSnapshot) : undefined,
    threadMap: codexSnapshot ? visibleThreadMapFromSnapshot(codexSnapshot) : undefined
  };
}

function visibleMacro(name: string, legacyCommand: string[], description: string): VisibleCodexMacro {
  return { name, legacyCommand, description, mode: "read_only", sideEffects: [] };
}

function visibleWindowsFromSnapshot(snapshot: DesktopSnapshotStatus): VisibleCodexWindows {
  const title = snapshot.windowTitle ? capTextValue(snapshot.windowTitle, 200) : undefined;
  const window: VisibleCodexWindow = {
    visibleId: `visible-window-${shortHash(`${snapshot.frontmostApp || "Codex"}:${snapshot.snapshotId || ""}:${title || ""}`)}`,
    index: 0,
    appName: capTextValue(snapshot.frontmostApp || "Codex", 80),
    title,
    titleHash: title ? shortHash(title) : undefined,
    snapshotId: snapshot.snapshotId,
    frontmost: true,
    source: "peekaboo_snapshot"
  };
  return {
    source: "peekaboo_snapshot",
    count: 1,
    windows: [window],
    warnings: snapshot.truncated ? ["Snapshot was truncated; visible window metadata is still bounded to the captured frontmost Codex window."] : []
  };
}

function visibleThreadMapFromSnapshot(snapshot: DesktopSnapshotStatus): VisibleCodexThreadMap {
  const threads: VisibleCodexThreadCandidate[] = [];
  const seen = new Set<string>();
  let currentProject: string | undefined;
  let inProjects = false;
  for (const element of snapshot.elements) {
    if (threads.length >= snapshot.maxNodes) break;
    const rawLabel = element.label?.trim();
    if (!rawLabel || !isThreadCandidateRole(element.role)) continue;
    const lowered = rawLabel.toLowerCase();
    if (threadSectionLabels.has(lowered)) {
      inProjects = lowered === "projects" || inProjects;
      continue;
    }
    if (inProjects && isStaticThreadRole(element.role) && looksLikeProjectHeader(rawLabel)) {
      currentProject = capTextValue(rawLabel, 160);
      continue;
    }
    if (isThreadControlLabel(lowered)) continue;
    const split = splitThreadTitleStatus(rawLabel);
    if (!split.title || isThreadControlLabel(split.title.toLowerCase())) continue;
    if (split.title.length < 3 || ["codex", "vantage"].includes(split.title.toLowerCase())) continue;
    const visibleId = visibleThreadId({ index: threads.length, title: split.title, sourceElementId: element.elementId });
    if (seen.has(visibleId)) continue;
    seen.add(visibleId);
    const center = centerFromBounds(element.bounds);
    threads.push({
      visibleId,
      index: threads.length,
      title: split.title,
      rawTitle: capTextValue(rawLabel, 200),
      project: currentProject,
      status: split.status,
      updatedLabel: split.updatedLabel,
      titleHash: shortHash(split.title),
      role: element.role,
      sourceElementId: element.elementId,
      bounds: element.bounds,
      center,
      confidence: threadConfidence({ role: element.role, center, status: split.status, updatedLabel: split.updatedLabel, project: currentProject }),
      source: "peekaboo_snapshot",
      titleAvailable: true
    });
  }
  return {
    source: "peekaboo_snapshot",
    count: threads.length,
    maxItems: snapshot.maxNodes,
    threads,
    warnings: snapshot.truncated ? ["Snapshot was truncated before thread-map extraction; rerun with a larger bounded max_nodes value if more visible rows are needed."] : []
  };
}

function isCodexSnapshot(snapshot: DesktopSnapshotStatus): boolean {
  const app = (snapshot.frontmostApp || "").trim().toLowerCase();
  return app === "codex" || app === "codex desktop";
}

function splitThreadTitleStatus(rawLabel: string): { title: string; status?: string; updatedLabel?: string } {
  const parts = rawLabel.trim().split(/\s+/);
  let updatedLabel: string | undefined;
  let titleText = rawLabel.trim();
  if (parts.length && threadTimePattern.test(parts[parts.length - 1]!)) {
    updatedLabel = parts.pop();
    titleText = parts.join(" ").trim();
  }
  let status: string | undefined;
  for (const label of threadStatusLabels) {
    const suffix = ` ${label}`.toLowerCase();
    if (titleText.toLowerCase().endsWith(suffix)) {
      status = label;
      titleText = titleText.slice(0, -label.length).trim();
      break;
    }
  }
  return { title: capTextValue(titleText, 160), status, updatedLabel };
}

function isThreadCandidateRole(role: string | undefined): boolean {
  const value = (role || "").toLowerCase();
  return ["button", "statictext", "text", "textfield", "group", "row", "link"].some((candidate) => value.includes(candidate));
}

function isStaticThreadRole(role: string | undefined): boolean {
  const value = (role || "").toLowerCase();
  return value.includes("statictext") || value === "text";
}

function isThreadControlLabel(lowered: string): boolean {
  if (threadControlLabels.has(lowered)) return true;
  if (threadControlPrefixLabels.some((control) => lowered.startsWith(control))) return true;
  return ["archive chat", "unpin chat", "pin chat"].some((control) => lowered.includes(control));
}

function looksLikeProjectHeader(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > 80) return false;
  const lowered = trimmed.toLowerCase();
  if (threadSectionLabels.has(lowered) || isThreadControlLabel(lowered)) return false;
  return !threadTimePattern.test(lowered);
}

function visibleThreadId(input: { index: number; title: string; sourceElementId: string }): string {
  return `visible-${input.index}-${shortHash(`${input.sourceElementId}:${input.index}:${input.title}`)}`;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function centerFromBounds(bounds: DesktopSnapshotElement["bounds"]): { x: number; y: number } | undefined {
  if (!bounds) return undefined;
  return { x: Math.trunc(bounds.x + bounds.width / 2), y: Math.trunc(bounds.y + bounds.height / 2) };
}

function threadConfidence(input: {
  role?: string;
  center?: { x: number; y: number };
  status?: string;
  updatedLabel?: string;
  project?: string;
}): "low" | "medium" | "high" {
  let score = 0;
  if (input.center) score += 2;
  const role = (input.role || "").toLowerCase();
  if (role.includes("button") || role.includes("row") || role.includes("group")) score += 1;
  if (input.status || input.updatedLabel) score += 1;
  if (input.project) score += 1;
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

function isSensitiveFrontmostApp(value: string): boolean {
  return ["messages", "mail", "1password", "passwords", "keychain access"].includes(value.trim().toLowerCase());
}

function boundsToRect(bounds: Record<string, unknown> | null): DesktopSnapshotElement["bounds"] {
  if (!bounds) return undefined;
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  return { x, y, width, height };
}

function capTextValue(value: unknown, maxChars: number): string {
  const redacted = String(redactValue(String(value)));
  return redacted.length > maxChars ? redacted.slice(0, maxChars) : redacted;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback));
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function desktopLaunchReadiness(backend: DesktopBackend, commandAvailable: boolean) {
  if (backend === "direct") {
    return {
      status: "not_applicable" as const,
      note: "Direct Codex protocol does not launch a desktop fallback backend."
    };
  }
  if (!commandAvailable) {
    return {
      status: "unavailable" as const,
      note: "Binary status probe failed; launch readiness was not checked."
    };
  }
  return {
    status: "not_probed" as const,
    note: "Binary status probe succeeded; stdio launch readiness is not probed because starting the backend would run a GUI-control server."
  };
}

function systemDesktopProbe(): DesktopProbe {
  return {
    commandStatus(command, args = ["--version"]) {
      const result = spawnSync(command, args, { encoding: "utf8", timeout: 3000 });
      const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
      const safeOutput = String(redactValue(output));
      const safeError = result.error?.message ? String(redactValue(result.error.message)) : undefined;
      return {
        available: result.status === 0,
        command: redactValue(command) as string,
        version: result.status === 0 && safeOutput ? safeOutput.split(/\r?\n/)[0] : undefined,
        error: result.status === 0 ? undefined : safeOutput || safeError || "command unavailable"
      };
    },
    commandOutput(command, args = [], timeoutMs = 5000) {
      const result = spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs });
      return {
        status: result.status ?? (result.error ? 1 : 0),
        command: redactValue(command) as string,
        stdout: result.stdout || "",
        stderr: String(redactValue(result.stderr || "")),
        error: result.error?.message ? String(redactValue(result.error.message)) : undefined
      };
    },
    activeApplication() {
      const result = spawnSync("osascript", ["-e", 'tell application "System Events" to get name of first application process whose frontmost is true'], {
        encoding: "utf8",
        timeout: 3000
      });
      return result.status === 0 ? result.stdout.trim() || undefined : undefined;
    }
  };
}
