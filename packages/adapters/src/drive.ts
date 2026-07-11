import type { AuditRecord } from "./index.js";
import { createCodexControl } from "./index.js";
import {
  createClaudeDryRunControl,
  type ClaudeDryRunAvailability
} from "./claude.js";

export type DriveHarness = "codex" | "claude";
export type DriveSurface = "cli" | "mcp" | "openclaw-gateway";
export type DriveController = "cli" | "mcp" | "openclaw" | "codex" | "claude";

type DriveAuditStore = {
  path: string;
  fingerprintText(value: string): string;
  fingerprintValue(value: unknown): string;
  append(record: Omit<AuditRecord, "id" | "createdAt">): AuditRecord;
  find(id: string): AuditRecord | null;
};

export type DriveOptions = {
  reviewer: DriveHarness;
  driver: DriveHarness;
  targetRef: string;
  objective: string;
  surface?: DriveSurface;
  maxTurns?: number;
  tokenBudget?: number;
  timeoutMs?: number;
  costCeilingUsd?: number;
  audit: DriveAuditStore;
  claudeAvailability?: ClaudeDryRunAvailability;
  now?: string;
};

export type DriveReport = {
  schema: "lco.drive.report.v1";
  publicSafe: true;
  generatedAt: string;
  status: "dry_run_ready" | "blocked";
  surface: DriveSurface;
  target: {
    ref: string;
    driver: DriveHarness;
  };
  reviewPacket: {
    schema: "lco.drive.review.v1";
    reviewer: DriveHarness;
    execute: false;
    objectiveHash: string;
    objectiveLength: number;
    requestedChecks: string[];
  };
  budgets: {
    maxTurns: number;
    tokenBudget: number;
    timeoutMs: number;
    costCeilingUsd: number;
    confirmBeforeLive: true;
  };
  drivePlan: {
    schema: "lco.drive.plan.v1";
    steps: Array<{
      ordinal: number;
      kind: "review" | "plan" | "dry_run" | "confirm" | "live" | "report";
      execute: boolean;
      state: "planned" | "completed" | "pending_approval" | "blocked";
    }>;
  };
  dryRun: {
    available: boolean;
    target: string;
    live: false | null;
    approvalAuditId: string | null;
    paramsHash: string | null;
    messageHash: string | null;
  };
  controllerMatrix: Array<{
    controller: DriveController;
    surface: DriveSurface | "target-adapter";
    status: "dry_run_available" | "not_probed" | "not_configured" | "unsupported";
  }>;
  blockers: string[];
  finalReport: {
    status: "dry_run_ready" | "blocked";
    plannedTurns: number;
    liveActions: 0;
    externalWrites: 0;
    guiMutations: 0;
  };
  actionsPerformed: {
    auditWrite: boolean;
    liveControl: false;
    guiMutation: false;
    sourceStoreMutation: false;
    externalWrite: false;
  };
  nextSafeCommands: string[];
  proofBoundary: string;
};

const DEFAULT_MAX_TURNS = 4;
const DEFAULT_TOKEN_BUDGET = 1000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_COST_CEILING_USD = 1;

export async function createDriveReport(options: DriveOptions): Promise<DriveReport> {
  const input = validateDriveOptions(options);
  const objectiveHash = options.audit.fingerprintText(input.objective);
  const blockedClaudeState = input.driver === "claude"
    ? claudeDriverBlocker(input.claudeAvailability)
    : null;
  const claudeControllerStatus = claudeControllerState(input.claudeAvailability);
  const blockers = blockedClaudeState ? [blockedClaudeState.blocker] : [];
  const dryRunResult = blockedClaudeState
    ? null
    : input.driver === "codex"
      ? await createCodexDriveDryRun(input, options.audit)
      : await createClaudeDriveDryRun(input, options.audit);
  const status = dryRunResult ? "dry_run_ready" as const : "blocked" as const;
  return {
    schema: "lco.drive.report.v1",
    publicSafe: true,
    generatedAt: input.generatedAt,
    status,
    surface: input.surface,
    target: { ref: input.targetRef, driver: input.driver },
    reviewPacket: {
      schema: "lco.drive.review.v1",
      reviewer: input.reviewer,
      execute: false,
      objectiveHash,
      objectiveLength: input.objective.length,
      requestedChecks: ["correctness", "safety", "claims", "tests"]
    },
    budgets: {
      maxTurns: input.maxTurns,
      tokenBudget: input.tokenBudget,
      timeoutMs: input.timeoutMs,
      costCeilingUsd: input.costCeilingUsd,
      confirmBeforeLive: true
    },
    drivePlan: {
      schema: "lco.drive.plan.v1",
      steps: drivePlanSteps(Boolean(dryRunResult))
    },
    dryRun: {
      available: Boolean(dryRunResult),
      target: input.targetRef,
      live: dryRunResult ? false : null,
      approvalAuditId: dryRunResult?.approvalAuditId ?? null,
      paramsHash: dryRunResult?.paramsHash ?? null,
      messageHash: dryRunResult?.messageHash ?? null
    },
    controllerMatrix: controllerMatrix(claudeControllerStatus),
    blockers,
    finalReport: {
      status,
      plannedTurns: input.maxTurns,
      liveActions: 0,
      externalWrites: 0,
      guiMutations: 0
    },
    actionsPerformed: {
      auditWrite: Boolean(dryRunResult),
      liveControl: false,
      guiMutation: false,
      sourceStoreMutation: false,
      externalWrite: false
    },
    nextSafeCommands: status === "dry_run_ready"
      ? ["Review the dry-run hashes and approval audit id before any separately approved sacrificial live-control step."]
      : [blockedClaudeState?.nextSafeAction ?? "Resolve the reported blocker, then rerun lco drive in dry-run mode."],
    proofBoundary: "LCO drive produced a bounded review packet, deterministic plan, and target-adapter dry-run audit packet only. It did not run a reviewer, execute live target control, mutate a GUI or source store, write an external system, or prove unattended autonomy."
  };
}

type ValidDriveOptions = Required<Pick<DriveOptions, "reviewer" | "driver" | "targetRef" | "objective">> & {
  surface: DriveSurface;
  maxTurns: number;
  tokenBudget: number;
  timeoutMs: number;
  costCeilingUsd: number;
  claudeAvailability?: ClaudeDryRunAvailability;
  generatedAt: string;
};

function validateDriveOptions(options: DriveOptions): ValidDriveOptions {
  if (options.reviewer !== "codex" && options.reviewer !== "claude") throw new Error("drive reviewer requires codex or claude");
  if (options.driver !== "codex" && options.driver !== "claude") throw new Error("drive driver requires codex or claude");
  const objective = options.objective?.trim();
  if (!objective || objective.length > 2000) throw new Error("drive objective requires 1 to 2000 characters");
  if (looksSensitive(objective)) throw new Error("drive objective contains restricted secret or local-path material");
  const targetRef = validateTargetRef(options.driver, options.targetRef);
  const surface = options.surface ?? "cli";
  if (surface !== "cli" && surface !== "mcp" && surface !== "openclaw-gateway") {
    throw new Error("drive surface requires cli, mcp, or openclaw-gateway");
  }
  return {
    reviewer: options.reviewer,
    driver: options.driver,
    targetRef,
    objective,
    surface,
    maxTurns: boundedInteger(options.maxTurns ?? DEFAULT_MAX_TURNS, 1, 20, "max turns"),
    tokenBudget: boundedInteger(options.tokenBudget ?? DEFAULT_TOKEN_BUDGET, 100, 8000, "token budget"),
    timeoutMs: boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000, 600_000, "timeout ms"),
    costCeilingUsd: boundedNumber(options.costCeilingUsd ?? DEFAULT_COST_CEILING_USD, 0, 100, "cost ceiling usd"),
    ...(options.claudeAvailability ? { claudeAvailability: options.claudeAvailability } : {}),
    generatedAt: driveGeneratedAt(options.now)
  };
}

function validateTargetRef(driver: DriveHarness, value: string): string {
  const prefix = driver === "codex" ? "codex_thread:" : "claude_session:";
  if (!value?.startsWith(prefix)) throw new Error("drive driver and target namespace must match");
  const id = value.slice(prefix.length);
  if (!/^[A-Za-z0-9._:-]{1,180}$/.test(id)) throw new Error("drive target ref requires a public-safe identifier");
  return `${prefix}${id}`;
}

function boundedInteger(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`drive ${name} requires an integer from ${min} to ${max}`);
  return value;
}

function boundedNumber(value: number, min: number, max: number, name: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`drive ${name} must be from ${min} to ${max}`);
  return value;
}

function looksSensitive(value: string): boolean {
  return /(?:\bBearer\s+|\bsk-[A-Za-z0-9_-]{8,}|\/Users\/|\/home\/|[A-Za-z]:\\Users\\|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i.test(value);
}

function validIso(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null;
}

function driveGeneratedAt(value: string | undefined): string {
  if (value === undefined) return new Date().toISOString();
  const generatedAt = validIso(value);
  if (!generatedAt) throw new Error("drive now requires an ISO timestamp");
  return generatedAt;
}

function drivePlanSteps(dryRunReady: boolean): DriveReport["drivePlan"]["steps"] {
  return [
    { ordinal: 1, kind: "review", execute: false, state: "planned" },
    { ordinal: 2, kind: "plan", execute: false, state: "planned" },
    { ordinal: 3, kind: "dry_run", execute: true, state: dryRunReady ? "completed" : "blocked" },
    { ordinal: 4, kind: "confirm", execute: false, state: dryRunReady ? "pending_approval" : "blocked" },
    { ordinal: 5, kind: "live", execute: false, state: "blocked" },
    { ordinal: 6, kind: "report", execute: true, state: "completed" }
  ];
}

async function createCodexDriveDryRun(input: ValidDriveOptions, audit: DriveAuditStore) {
  const control = createCodexControl({
    audit,
    client: {
      request: async () => {
        throw new Error("drive dry-run must not call the Codex transport");
      }
    }
  });
  return control.sendMessage({
    threadId: input.targetRef.slice("codex_thread:".length),
    message: driveInstruction(input),
    dryRun: true,
    turnWaitMs: input.timeoutMs
  });
}

async function createClaudeDriveDryRun(input: ValidDriveOptions, audit: DriveAuditStore) {
  const control = createClaudeDryRunControl({ audit, availability: input.claudeAvailability });
  return control.resumePrompt({
    sessionId: input.targetRef,
    prompt: driveInstruction(input),
    dryRun: true
  });
}

function driveInstruction(input: ValidDriveOptions): string {
  return [
    "LCO bounded review-then-drive packet.",
    `Reviewer: ${input.reviewer}. Driver: ${input.driver}.`,
    `Maximum turns: ${input.maxTurns}. Token budget: ${input.tokenBudget}. Timeout ms: ${input.timeoutMs}.`,
    `Objective: ${input.objective}`,
    "Do not execute live actions without a separately verified approval audit binding."
  ].join(" ");
}

function claudeDriverBlocker(availability: ClaudeDryRunAvailability | undefined): {
  blocker: string;
  state: "not_configured" | "unsupported";
  nextSafeAction: string;
} | null {
  if (!availability?.available) {
    return {
      blocker: "claude_driver_not_configured",
      state: "not_configured",
      nextSafeAction: "Install or configure a supported Claude Code CLI, then rerun lco drive in dry-run mode."
    };
  }
  const status = createClaudeDryRunControl({
    availability,
    audit: {
      path: "status-only",
      fingerprintText: () => "0".repeat(32),
      fingerprintValue: () => "0".repeat(32),
      append: () => { throw new Error("status-only Claude control must not append audit records"); },
      find: () => null
    }
  }).status();
  if (status.state === "unsupported") {
    return {
      blocker: "claude_driver_unsupported",
      state: "unsupported",
      nextSafeAction: status.nextSafeAction
    };
  }
  return status.state === "dry_run_only" ? null : {
    blocker: "claude_driver_not_configured",
    state: "not_configured",
    nextSafeAction: status.nextSafeAction
  };
}

function claudeControllerState(availability: ClaudeDryRunAvailability | undefined): DriveReport["controllerMatrix"][number]["status"] {
  if (availability === undefined) return "not_probed";
  const blocker = claudeDriverBlocker(availability);
  return blocker?.state ?? "dry_run_available";
}

function controllerMatrix(claudeStatus: DriveReport["controllerMatrix"][number]["status"]): DriveReport["controllerMatrix"] {
  return [
    { controller: "cli", surface: "cli", status: "dry_run_available" },
    { controller: "mcp", surface: "mcp", status: "dry_run_available" },
    { controller: "openclaw", surface: "openclaw-gateway", status: "dry_run_available" },
    { controller: "codex", surface: "target-adapter", status: "dry_run_available" },
    { controller: "claude", surface: "target-adapter", status: claudeStatus }
  ] as DriveReport["controllerMatrix"];
}
