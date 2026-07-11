import type { AuditRecord } from "./index.js";
import { CODEX_CONTROL_DRY_RUN_TTL_MS, createCodexControl } from "./index.js";
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
  invocationSurface?: DriveSurface;
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
      budget: {
        maxTurns: number;
        tokenBudget: number;
        timeoutMs: number;
        costCeilingUsd: number;
      };
      freshness: {
        state: "fresh" | "expired" | "invalid" | "not_applicable";
        generatedAt: string;
        issuedAt: string | null;
        expiresAt: string | null;
      };
      approval: {
        required: boolean;
        state: "not_required" | "bound_pending_confirmation" | "blocked";
        approvalAuditId: string | null;
        paramsHash: string | null;
      };
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

export class DriveInputError extends Error {
  override name = "DriveInputError";
}

export async function createDriveReport(options: DriveOptions): Promise<DriveReport> {
  const input = validateDriveOptions(options);
  const objectiveHash = options.audit.fingerprintText(input.objective);
  const blockedClaudeState = input.driver === "claude"
    ? claudeDriverBlocker(input.claudeAvailability)
    : null;
  const claudeControllerStatus = input.driver === "claude"
    ? blockedClaudeState?.state ?? "dry_run_available"
    : claudeControllerState(input.claudeAvailability);
  const blockers = blockedClaudeState ? [blockedClaudeState.blocker] : [];
  const dryRunResult = blockedClaudeState
    ? null
    : input.driver === "codex"
      ? await createCodexDriveDryRun(input, options.audit)
      : await createClaudeDriveDryRun(input, options.audit);
  const dryRunRecord = dryRunResult ? options.audit.find(dryRunResult.approvalAuditId) : null;
  const evaluatedAt = options.now === undefined ? new Date().toISOString() : input.generatedAt;
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
      steps: drivePlanSteps(input, dryRunResult, dryRunRecord, evaluatedAt)
    },
    dryRun: {
      available: Boolean(dryRunResult),
      target: input.targetRef,
      live: dryRunResult ? false : null,
      approvalAuditId: dryRunResult?.approvalAuditId ?? null,
      paramsHash: dryRunResult?.paramsHash ?? null,
      messageHash: dryRunResult?.messageHash ?? null
    },
    controllerMatrix: controllerMatrix(input.surface, input.driver, claudeControllerStatus),
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
      ? input.driver === "codex"
        ? ["Review the dry-run hashes and approval audit id before any separately approved sacrificial live-control step."]
        : ["Review the Claude dry-run hashes. Claude live control remains unsupported in this release."]
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
  if (options.reviewer !== "codex" && options.reviewer !== "claude") throw new DriveInputError("drive reviewer requires codex or claude");
  if (options.driver !== "codex" && options.driver !== "claude") throw new DriveInputError("drive driver requires codex or claude");
  const objective = options.objective?.trim();
  if (!objective || objective.length > 2000) throw new DriveInputError("drive objective requires 1 to 2000 characters");
  if (looksSensitive(objective)) throw new DriveInputError("drive objective contains restricted secret or local-path material");
  const targetRef = validateTargetRef(options.driver, options.targetRef);
  const surface = options.invocationSurface ?? "cli";
  if (surface !== "cli" && surface !== "mcp" && surface !== "openclaw-gateway") {
    throw new DriveInputError("drive surface requires cli, mcp, or openclaw-gateway");
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
  if (!value?.startsWith(prefix)) throw new DriveInputError("drive driver and target namespace must match");
  const id = value.slice(prefix.length);
  if (!/^[A-Za-z0-9._:-]{1,180}$/.test(id)) throw new DriveInputError("drive target ref requires a public-safe identifier");
  if (looksSensitive(id)) throw new DriveInputError("drive target ref contains restricted secret material");
  return `${prefix}${id}`;
}

function boundedInteger(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new DriveInputError(`drive ${name} requires an integer from ${min} to ${max}`);
  return value;
}

function boundedNumber(value: number, min: number, max: number, name: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new DriveInputError(`drive ${name} must be from ${min} to ${max}`);
  return value;
}

function looksSensitive(value: string): boolean {
  return /(?:\bBearer\s+|\bsk-[A-Za-z0-9_-]{8,}|\bgh[pousr]_[A-Za-z0-9_]{10,}|\bgithub_pat_[A-Za-z0-9_]{10,}|\bnpm_[A-Za-z0-9_]{10,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{20,}|\/Users\/|\/home\/|[A-Za-z]:\\Users\\|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i.test(value);
}

function validIso(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null;
}

function driveGeneratedAt(value: string | undefined): string {
  if (value === undefined) return new Date().toISOString();
  const generatedAt = validIso(value);
  if (!generatedAt) throw new DriveInputError("drive now requires an ISO timestamp");
  return generatedAt;
}

function drivePlanSteps(
  input: ValidDriveOptions,
  dryRunResult: { approvalAuditId: string; paramsHash: string } | null,
  dryRunRecord: AuditRecord | null,
  evaluatedAt: string
): DriveReport["drivePlan"]["steps"] {
  type Step = DriveReport["drivePlan"]["steps"][number];
  type Approval = Step["approval"];
  const budget = {
    maxTurns: input.maxTurns,
    tokenBudget: input.tokenBudget,
    timeoutMs: input.timeoutMs,
    costCeilingUsd: input.costCeilingUsd
  };
  const issuedAtMs = dryRunRecord ? Date.parse(dryRunRecord.createdAt) : NaN;
  const evaluatedAtMs = Date.parse(evaluatedAt);
  const expiresAtMs = issuedAtMs + CODEX_CONTROL_DRY_RUN_TTL_MS;
  const freshnessState: Step["freshness"]["state"] = !dryRunResult
    ? "not_applicable"
    : !dryRunRecord || !Number.isFinite(issuedAtMs) || issuedAtMs > evaluatedAtMs
      ? "invalid"
      : expiresAtMs <= evaluatedAtMs
        ? "expired"
        : "fresh";
  const freshness: Step["freshness"] = {
    state: freshnessState,
    generatedAt: input.generatedAt,
    issuedAt: Number.isFinite(issuedAtMs) ? new Date(issuedAtMs).toISOString() : null,
    expiresAt: Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : null
  };
  const noApproval: Approval = {
    required: false,
    state: "not_required" as const,
    approvalAuditId: null,
    paramsHash: null
  };
  const liveApprovalBindable = input.driver === "codex" && dryRunResult && freshnessState === "fresh";
  const actionApproval: Approval = liveApprovalBindable
    ? {
      required: true,
      state: "bound_pending_confirmation" as const,
      approvalAuditId: dryRunResult.approvalAuditId,
      paramsHash: dryRunResult.paramsHash
    }
    : {
      required: true,
      state: "blocked" as const,
      approvalAuditId: null,
      paramsHash: null
    };
  const step = (
    ordinal: number,
    kind: Step["kind"],
    execute: boolean,
    state: Step["state"],
    approval: Approval = noApproval
  ): Step => ({ ordinal, kind, execute, state, budget, freshness, approval });
  return [
    step(1, "review", false, "planned"),
    step(2, "plan", false, "planned"),
    step(3, "dry_run", true, dryRunResult ? "completed" : "blocked"),
    step(4, "confirm", false, liveApprovalBindable ? "pending_approval" : "blocked", actionApproval),
    step(5, "live", false, "blocked", actionApproval),
    step(6, "report", true, "completed")
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

function controllerMatrix(
  activeSurface: DriveSurface,
  driver: DriveHarness,
  claudeStatus: DriveReport["controllerMatrix"][number]["status"]
): DriveReport["controllerMatrix"] {
  const surfaceStatus = (surface: DriveSurface) => surface === activeSurface ? "dry_run_available" as const : "not_probed" as const;
  return [
    { controller: "cli", surface: "cli", status: surfaceStatus("cli") },
    { controller: "mcp", surface: "mcp", status: surfaceStatus("mcp") },
    { controller: "openclaw", surface: "openclaw-gateway", status: surfaceStatus("openclaw-gateway") },
    { controller: "codex", surface: "target-adapter", status: driver === "codex" ? "dry_run_available" : "not_probed" },
    { controller: "claude", surface: "target-adapter", status: claudeStatus }
  ] as DriveReport["controllerMatrix"];
}
