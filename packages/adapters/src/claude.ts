import { spawn } from "node:child_process";
import { win32 as win32Path } from "node:path";
import { createTargetControl, type AuditRecord } from "./index.js";
import { type TargetMethodPolicy } from "./policy.js";
import { redactClaudeValue } from "./redaction.js";

export const CLAUDE_TARGET_METHOD_POLICY: TargetMethodPolicy = {
  targetName: "Claude Code",
  readMethods: new Set(["claude/status/read", "claude/session/list"]),
  controlMethods: new Set(["claude/print/resume"]),
  forbiddenMethods: new Set([
    "claude/live/send",
    "claude/settings/write",
    "claude/settings/update",
    "claude/session/delete",
    "claude/session/mutate",
    "claude/gui/action",
    "claude/desktop/click",
    "claude/desktop/type",
    "claude/mcp/config/write"
  ])
};

export type ClaudeDryRunState = "dry_run_only" | "not_configured" | "unsupported";

export type ClaudeDryRunAvailability = {
  available: boolean;
  command: string;
  version: string | null;
  error: string | null;
  unsupportedReason?: string | null;
};

type ClaudeControlAuditStore = {
  path: string;
  fingerprintText(value: string): string;
  fingerprintValue(value: unknown): string;
  append(record: Omit<AuditRecord, "id" | "createdAt">): AuditRecord;
  find(id: string): AuditRecord | null;
};

type ClaudeVersionProbeResult = {
  error?: Error;
  status: number | null;
  stdout: string | Buffer;
  stderr: string | Buffer;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
  outputLimitExceeded?: boolean;
};

export type ClaudeDryRunStatus = {
  schema: "lco.claude.dryRunControlStatus.v1";
  publicSafe: true;
  target: "claude_code";
  state: ClaudeDryRunState;
  liveControlProven: false;
  command: ClaudeDryRunAvailability;
  methodPolicy: {
    readMethods: string[];
    controlMethods: string[];
    forbiddenMethods: string[];
  };
  actionsPerformed: {
    liveClaudeControlRun: false;
    guiMutationRun: false;
    settingsMutationRun: false;
  };
  nextSafeAction: string;
};

export async function probeClaudeDryRunAvailability(
  command = "claude",
  options: { trustedPath?: string } = {}
): Promise<ClaudeDryRunAvailability> {
  const normalizedCommand = command.trim();
  if (normalizedCommand !== "claude") {
    return {
      available: false,
      command: "claude",
      version: null,
      error: "Only the claude CLI command is allowed for dry-run availability probing.",
      unsupportedReason: null
    };
  }
  // Every platform intentionally uses the caller's trusted PATH to resolve the
  // Claude executable. Windows pins only cmd.exe and cwd to System32; it does
  // not pin claude.cmd/bat. Request/status handlers inject this sanitized
  // result; the kill-bounded asynchronous subprocess never blocks the event
  // loop indefinitely.
  const invocation = claudeVersionProbeInvocation();
  const result = await runClaudeVersionProbe(invocation, options.trustedPath);
  return claudeAvailabilityFromProbeResult(result);
}

function runClaudeVersionProbe(invocation: {
  command: string;
  args: string[];
  cwd: string | undefined;
}, trustedPath?: string): Promise<ClaudeVersionProbeResult> {
  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      shell: false,
      cwd: invocation.cwd,
      env: trustedPath === undefined ? undefined : { ...process.env, PATH: trustedPath },
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let spawnError: Error | undefined;
    let timedOut = false;
    let outputLimitExceeded = false;
    let terminationStarted = false;
    let settled = false;
    let treeKiller: ReturnType<typeof spawn> | null = null;
    let killerFallback: NodeJS.Timeout | null = null;
    let timeout: NodeJS.Timeout;
    let hardDeadline: NodeJS.Timeout;

    const settle = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(hardDeadline);
      if (killerFallback) clearTimeout(killerFallback);
      treeKiller?.removeAllListeners();
      treeKiller?.kill("SIGKILL");
      treeKiller?.unref();
      resolve({
        error: spawnError,
        status: code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        signal,
        timedOut,
        outputLimitExceeded
      });
    };

    const terminateTree = () => {
      if (terminationStarted || child.pid === undefined) return;
      terminationStarted = true;
      const termination = claudeProbeTreeTerminationInvocation(process.platform, child.pid);
      if (termination) {
        treeKiller = spawn(termination.command, termination.args, {
          cwd: termination.cwd,
          detached: false,
          windowsHide: true,
          stdio: "ignore"
        });
        treeKiller.unref();
        const killDirectChild = () => child.kill("SIGKILL");
        killerFallback = setTimeout(killDirectChild, 750);
        killerFallback.unref();
        treeKiller.once("error", () => {
          if (killerFallback) clearTimeout(killerFallback);
          killDirectChild();
        });
        treeKiller.once("close", () => {
          if (killerFallback) clearTimeout(killerFallback);
          killDirectChild();
        });
        return;
      }
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const capture = (chunks: Buffer[], chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += value.length;
      if (outputBytes <= 64 * 1024) chunks.push(value);
      else {
        outputLimitExceeded = true;
        terminateTree();
      }
    };
    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    child.once("error", (error) => {
      spawnError = error;
    });
    timeout = setTimeout(() => {
      timedOut = true;
      terminateTree();
    }, 2_000);
    hardDeadline = setTimeout(() => {
      timedOut = true;
      terminateTree();
      treeKiller?.kill("SIGKILL");
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      settle(null, "SIGKILL");
    }, 3_250);
    child.once("close", settle);
  });
}

export function claudeVersionProbeInvocation(
  platform: NodeJS.Platform = process.platform,
  systemRoot = process.env.SystemRoot
): { command: string; args: string[]; cwd: string | undefined } {
  if (platform === "win32") {
    const safeRoot = safeWindowsSystemRoot(systemRoot);
    const system32 = win32Path.join(safeRoot, "System32");
    return {
      command: win32Path.join(system32, "cmd.exe"),
      args: ["/d", "/s", "/c", "claude --version"],
      cwd: system32
    };
  }
  return { command: "claude", args: ["--version"], cwd: undefined };
}

export function claudeProbeTreeTerminationInvocation(
  platform: NodeJS.Platform,
  pid: number,
  systemRoot = process.env.SystemRoot
): { command: string; args: string[]; cwd: string } | null {
  if (platform !== "win32") return null;
  const system32 = win32Path.join(safeWindowsSystemRoot(systemRoot), "System32");
  return {
    command: win32Path.join(system32, "taskkill.exe"),
    args: ["/PID", String(pid), "/T", "/F"],
    cwd: system32
  };
}

function safeWindowsSystemRoot(systemRoot: string | undefined): string {
  const normalized = win32Path.normalize(systemRoot?.trim() || "C:\\Windows");
  return /^C:\\Windows$/i.test(normalized) ? "C:\\Windows" : "C:\\Windows";
}

export function claudeAvailabilityFromProbeResult(result: ClaudeVersionProbeResult): ClaudeDryRunAvailability {
  const stdout = typeof result.stdout === "string" ? result.stdout : result.stdout?.toString("utf8") ?? "";
  const stderr = typeof result.stderr === "string" ? result.stderr : result.stderr?.toString("utf8") ?? "";
  if (result.outputLimitExceeded) {
    return sanitizeClaudeAvailability({
      available: false,
      command: "claude",
      version: null,
      error: "Claude availability probe output exceeded the safety limit."
    });
  }
  if (result.timedOut) {
    return sanitizeClaudeAvailability({
      available: false,
      command: "claude",
      version: null,
      error: "Claude availability probe timed out."
    });
  }
  if (result.status === null && result.signal) {
    return sanitizeClaudeAvailability({
      available: false,
      command: "claude",
      version: null,
      error: `Claude availability probe terminated by ${result.signal}.`
    });
  }
  if (result.error) {
    const errorCode = /\bENOENT\b/.test(result.error.message) ? "ENOENT" : null;
    return sanitizeClaudeAvailability({
      available: false,
      command: "claude",
      version: null,
      error: errorCode
        ? `Claude availability probe failed (${errorCode}).`
        : "Claude availability probe failed."
    });
  }
  if (result.status !== 0) {
    return sanitizeClaudeAvailability({
      available: false,
      command: "claude",
      version: null,
      error: stderr || `Claude command exited with status ${result.status}`
    });
  }
  const version = (stdout || stderr).trim() || null;
  return sanitizeClaudeAvailability({
    available: true,
    command: "claude",
    version,
    error: null,
    unsupportedReason: version
      ? unsupportedClaudeVersionReason(version)
      : "Claude CLI version output was empty and could not be parsed for dry-run validation."
  });
}

export function createClaudeDryRunControl(options: {
  audit: ClaudeControlAuditStore;
  availability?: ClaudeDryRunAvailability;
}) {
  if ("probeAvailability" in options) {
    throw new Error("probeAvailability is no longer supported; probe Claude out of band and inject availability");
  }
  const availability = sanitizeClaudeAvailability(options.availability ?? {
    available: false,
    command: "claude",
    version: null,
    error: "Claude availability probe was not requested.",
    unsupportedReason: null
  });
  const target = createTargetControl({
    targetName: "Claude Code",
    methodPolicy: CLAUDE_TARGET_METHOD_POLICY,
    audit: options.audit,
    client: {
      request: async () => {
        throw new Error("Claude Code live control is dry-run only in this release");
      }
    }
  });

  return {
    status(): ClaudeDryRunStatus {
      const currentAvailability = availability;
      const state = claudeDryRunState(currentAvailability);
      return {
        schema: "lco.claude.dryRunControlStatus.v1",
        publicSafe: true,
        target: "claude_code",
        state,
        liveControlProven: false,
        command: currentAvailability,
        methodPolicy: {
          readMethods: [...CLAUDE_TARGET_METHOD_POLICY.readMethods].sort(),
          controlMethods: [...CLAUDE_TARGET_METHOD_POLICY.controlMethods].sort(),
          forbiddenMethods: [...CLAUDE_TARGET_METHOD_POLICY.forbiddenMethods].sort()
        },
        actionsPerformed: {
          liveClaudeControlRun: false,
          guiMutationRun: false,
          settingsMutationRun: false
        },
        nextSafeAction: nextClaudeDryRunAction(state)
      };
    },
    async resumePrompt(input: { sessionId: string; prompt: string; dryRun?: boolean; approvalAuditId?: string }) {
      if (input.dryRun === false) {
        throw new Error("Claude Code control is dry-run only in this release");
      }
      const state = claudeDryRunState(availability);
      if (state !== "dry_run_only") {
        throw new Error(`Claude Code dry-run packet is unavailable while status is ${state}`);
      }
      const sessionRef = safeClaudeSessionRef(input.sessionId);
      const result = await target.execute({
        action: "claude_resume_prompt",
        method: "claude/print/resume",
        threadId: sessionRef,
        message: input.prompt,
        dryRun: true,
        approvalAuditId: input.approvalAuditId,
        params: {
          sessionRef,
          promptLength: input.prompt.length,
          transport: "claude -p --resume"
        }
      });
      return {
        ...result,
        proofState: {
          ...result.proofState,
          callerInstruction: "Claude Code dry-run only. This packet records intent and hashes only; it does not invoke Claude Code.",
          proofBoundary: "Claude Code dry-run packets do not prove live Claude control, settings mutation, GUI mutation, or session persistence."
        }
      };
    }
  };
}

export function createClaudeCodeAdapter() {
  return {
    status: "proof-boundary-inventory",
    parity: false,
    liveControlProven: false,
    firstProofStep: "read-only-session-inventory",
    forbiddenClaims: [
      "Claude Code indexing parity",
      "Claude Code live control",
      "Claude Code GUI mutation",
      "cloud sync"
    ],
    note: "Claude Code session indexing/control is intentionally staged behind this adapter until storage and control paths are proven."
  };
}

function sanitizeClaudeAvailability(input: ClaudeDryRunAvailability): ClaudeDryRunAvailability {
  return {
    available: input.available,
    command: String(redactClaudeValue(input.command)),
    version: input.version === null ? null : String(redactClaudeValue(input.version)),
    error: input.error === null ? null : String(redactClaudeValue(input.error)),
    unsupportedReason: input.unsupportedReason === undefined || input.unsupportedReason === null
      ? null
      : String(redactClaudeValue(input.unsupportedReason))
  };
}

function claudeDryRunState(availability: ClaudeDryRunAvailability): ClaudeDryRunState {
  if (availability.unsupportedReason) return "unsupported";
  return availability.available ? "dry_run_only" : "not_configured";
}

function safeClaudeSessionRef(sessionId: string): string {
  const normalized = sessionId.startsWith("claude_session:") ? sessionId.slice("claude_session:".length) : sessionId;
  if (/^[A-Za-z0-9._-]{1,128}$/.test(normalized)) return `claude_session:${normalized}`;
  throw new Error("Invalid Claude session id");
}

function nextClaudeDryRunAction(state: ClaudeDryRunState): string {
  if (state === "dry_run_only") return "Use resumePrompt with dryRun:true to mint an LCO audit packet without invoking Claude Code.";
  if (state === "unsupported") return "Upgrade, install, or configure a supported Claude Code CLI before dry-run packet generation.";
  return "Install or configure the Claude Code CLI before dry-run packet generation.";
}

export function unsupportedClaudeVersionReason(version: string | null): string | null {
  if (!version) return null;
  const numeric = "(?:0|[1-9]\\d*)";
  const prereleaseIdentifier = `(?:${numeric}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
  const prerelease = `${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*`;
  const build = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*";
  const match = version.match(new RegExp(
    `^\\s*(?:Claude(?:\\s+Code)?\\s*)?(${numeric})\\.(${numeric})\\.(${numeric})(?:-${prerelease})?(?:\\+${build})?(?:\\s+\\(Claude Code\\))?\\s*$`,
    "i"
  ));
  if (!match) return "Claude CLI version could not be parsed for dry-run validation.";
  const major = Number(match[1]);
  if (Number.isFinite(major) && major < 1) return "Claude CLI version is below minimum supported 1.0.0 for dry-run validation.";
  return null;
}
