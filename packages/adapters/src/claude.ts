import { spawnSync } from "node:child_process";
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

type ClaudeVersionProbeResult = Pick<ReturnType<typeof spawnSync>, "error" | "status" | "stdout" | "stderr"> & {
  signal?: ReturnType<typeof spawnSync>["signal"];
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

export function probeClaudeDryRunAvailability(command = "claude"): ClaudeDryRunAvailability {
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
  // This exported out-of-band probe intentionally uses the caller's trusted
  // PATH. Windows uses a fixed system cmd.exe from a trusted System32 cwd so
  // checkout-local claude.cmd/bat shadows are never considered. Request/status
  // handlers must inject its sanitized result instead of invoking the
  // synchronous probe themselves.
  const invocation = claudeVersionProbeInvocation();
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    timeout: 2_000,
    shell: false,
    cwd: invocation.cwd
  });
  return claudeAvailabilityFromProbeResult(result);
}

export function claudeVersionProbeInvocation(
  platform: NodeJS.Platform = process.platform,
  systemRoot = process.env.SystemRoot
): { command: string; args: string[]; cwd: string | undefined } {
  if (platform === "win32") {
    const rawRoot = systemRoot?.trim() || "C:\\Windows";
    const safeRoot = win32Path.isAbsolute(rawRoot)
      && !rawRoot.split(/[\\/]+/).includes("..")
      && !/[<>"|?*\r\n]/.test(rawRoot)
      ? win32Path.normalize(rawRoot)
      : "C:\\Windows";
    const system32 = win32Path.join(safeRoot, "System32");
    return {
      command: win32Path.join(system32, "cmd.exe"),
      args: ["/d", "/s", "/c", "claude --version"],
      cwd: system32
    };
  }
  return { command: "claude", args: ["--version"], cwd: undefined };
}

export function claudeAvailabilityFromProbeResult(result: ClaudeVersionProbeResult): ClaudeDryRunAvailability {
  const stdout = typeof result.stdout === "string" ? result.stdout : result.stdout?.toString("utf8") ?? "";
  const stderr = typeof result.stderr === "string" ? result.stderr : result.stderr?.toString("utf8") ?? "";
  if (result.status === null && result.signal) {
    return sanitizeClaudeAvailability({
      available: false,
      command: "claude",
      version: null,
      error: result.signal === "SIGTERM"
        ? "Claude availability probe timed out."
        : `Claude availability probe terminated by ${result.signal}.`
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
    unsupportedReason: unsupportedClaudeVersionReason(version)
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
  const match = version.match(/^\s*(?:Claude(?:\s+Code)?\s*)?(\d+)\.(\d+)\.(\d+)(?:\s+\(Claude Code\))?\s*$/i);
  if (!match) return "Claude CLI version could not be parsed for dry-run validation.";
  const major = Number(match[1]);
  if (Number.isFinite(major) && major < 1) return "Claude CLI version is below minimum supported 1.0.0 for dry-run validation.";
  return null;
}
