import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { CANONICAL_PACKAGE_NAME, type SupportedPackageName } from "./package-identity.js";
import { callGatewayBackendJson } from "./openclaw-tool-smoke.js";

export type QaLabWorkflowSurface = "cli" | "mcp" | "openclaw-gateway" | "desktop-contract";
export type QaLabWorkflowMode = "dry-run" | "live-approved";

export type QaLabWorkflowOptions = {
  scenarioId: string;
  surface: QaLabWorkflowSurface;
  mode: QaLabWorkflowMode;
  evidenceDir: string;
  packageVersion?: string;
  candidateSha?: string;
  openclawBin?: string;
  gatewayUrl?: string;
  token?: string;
  sessionKey?: string;
  gatewayTimeoutMs?: number;
  now?: string;
  env?: NodeJS.ProcessEnv;
  strict?: boolean;
};

export type QaLabWorkflowBlocker = {
  severity: "P0" | "P1" | "P2";
  code: string;
  source: string;
  detail: string;
};

export type QaLabWorkflowStep = {
  step: "catalog" | "search" | "describe" | "expand" | "plans" | "finals" | "touched_files" | "recommend_next_action" | "control_dry_run" | "drive";
  toolName: string;
  ok: boolean;
  evidenceRef: string;
  outputSummary: {
    outputKind: string;
    count?: number;
    sourceRefs?: string[];
    threadId?: string;
    expansionBudget?: number;
    live?: boolean;
    approvalAuditId?: string;
    paramsHash?: string;
  };
  blockerCodes: string[];
};

export type QaLabWorkflowReport = {
  schema: "lco.qaLab.workflowRun.v1";
  ok: boolean;
  workflowRunReady: boolean;
  publicSafe: true;
  generatedAt: string;
  packageName: SupportedPackageName;
  packageVersion: string | null;
  candidateSha: string | null;
  scenarioId: string;
  surface: QaLabWorkflowSurface;
  mode: QaLabWorkflowMode;
  command: string;
  workflow: {
    selectedSourceRef: string | null;
    selectedThreadId: string | null;
    toolsInvoked: string[];
    steps: QaLabWorkflowStep[];
    rawTranscriptReadRequired: false;
    recommendedNextAction: {
      kind: "dry_run_resume" | "resolve_blockers";
      tool: "loo_drive" | "loo_codex_control_dry_run" | null;
      execute: false;
      reason: string;
    };
    dryRunControl: {
      live: false;
      approvalAuditId: string | null;
      paramsHash: string | null;
    };
  };
  blockers: QaLabWorkflowBlocker[];
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
    rawPromptRead: false;
    screenCaptureRun: false;
    sourceStoreMutation: false;
    gatewayScopeApproval: false;
    npmPublished: false;
    githubReleaseCreated: false;
  };
  privateDataExclusions: string[];
  nextSafeCommands: string[];
  proofBoundary: string;
};

type GatewayJsonResult = {
  status: number | null;
  parsed?: unknown;
  parseError?: string;
};

type WorkflowCall = {
  toolName: string;
  args: Record<string, unknown>;
  step: QaLabWorkflowStep["step"];
};

const REQUIRED_WORKFLOW_TOOLS = [
  "loo_search_sessions",
  "loo_describe_ref",
  "loo_expand_session",
  "loo_codex_plans",
  "loo_codex_final_messages",
  "loo_codex_touched_files",
  "loo_codex_control_dry_run",
  "loo_drive"
] as const;

const PRIVATE_DATA_EXCLUSIONS = [
  "raw Codex transcripts",
  "private prompt or message bodies",
  "local database files",
  "line-delimited session files",
  "screen captures or videos",
  "credential material, API keys, and browser secrets",
  "raw OpenClaw gateway stdout/stderr",
  "raw gateway logs",
  "customer data"
];

const DEFAULT_QUERY = "agent workflow public-safe proof";
const DEFAULT_TOKEN_BUDGET = 1000;
const DEFAULT_GATEWAY_TIMEOUT_MS = 60_000;
const MAX_UNWRAP_DEPTH = 8;
const MAX_OUTPUT_SCAN_DEPTH = 64;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const SAFE_SOURCE_REF_PATTERN = /^(codex_thread|codex_event|codex_range|codex_source|summary_leaf|prepared_card|prepared_inbox|lcm_summary):[A-Za-z0-9_.:-]{1,180}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/i;

export function createQaLabWorkflowReport(options: QaLabWorkflowOptions): QaLabWorkflowReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });

  const blockers: QaLabWorkflowBlocker[] = [];
  const steps: QaLabWorkflowStep[] = [];
  let selectedSourceRef: string | null = null;
  let selectedThreadId: string | null = null;
  let dryRunApprovalAuditId: string | null = null;
  let dryRunParamsHash: string | null = null;
  const requestedOpenClawBin = options.openclawBin || "openclaw";
  const openclawBinValidation = validateOpenClawBin(requestedOpenClawBin);
  const openclawBin = openclawBinValidation.ok ? requestedOpenClawBin : "openclaw";
  const gatewayTimeoutMs = options.gatewayTimeoutMs ?? DEFAULT_GATEWAY_TIMEOUT_MS;
  const deadline = Date.now() + gatewayTimeoutMs;
  const gatewayToken = options.token || options.env?.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN;
  const command = options.gatewayUrl && gatewayToken
    ? "loo backend-gateway tools.catalog/tools.invoke --json --params <redacted>"
    : `${sanitizeCommandBinary(openclawBin)} gateway call tools.catalog/tools.invoke --json --params <redacted>`;
  const candidateShaValid = options.candidateSha === undefined || SHA_PATTERN.test(options.candidateSha);

  if (options.surface !== "openclaw-gateway") {
    addBlocker(blockers, "P1", "workflow_surface_not_supported", "qaLabWorkflow", "Only --surface openclaw-gateway is supported for this QA Lab runner.");
  }
  if (options.mode !== "dry-run") {
    addBlocker(blockers, "P0", "workflow_mode_not_supported", "qaLabWorkflow", "Only --mode dry-run is supported; live-approved must fail closed for #517.");
  }
  if (!openclawBinValidation.ok) {
    addBlocker(blockers, "P1", openclawBinValidation.code, "qaLabWorkflow", openclawBinValidation.detail);
  }
  const gatewayUrlValidation = validateGatewayUrl(options.gatewayUrl);
  if (!gatewayUrlValidation.ok) {
    addBlocker(blockers, "P1", gatewayUrlValidation.code, "qaLabWorkflow", gatewayUrlValidation.detail);
  }
  if (gatewayToken && !options.gatewayUrl) {
    addBlocker(blockers, "P1", "workflow_gateway_token_requires_url", "qaLabWorkflow", "A scoped gateway token requires an explicit loopback --gateway-url; omit the token to use configured profile credentials.");
  }
  if (!candidateShaValid) {
    addBlocker(blockers, "P1", "candidate_sha_invalid", "qaLabWorkflow", "Candidate SHA must be a 40-character hexadecimal commit SHA.");
  }

  if (blockers.length === 0) {
    const catalog = callGatewayJson(openclawBin, "tools.catalog", {}, options, remainingGatewayTimeoutMs(deadline));
    const catalogPayload = unwrapGatewayPayload(catalog.parsed);
    const catalogOk = !hasErrorShape(catalogPayload) && okStatus(catalogPayload) !== false;
    const catalogToolNames = catalog.status === 0 && catalog.parsed !== undefined && catalogOk ? extractCatalogToolNames(catalogPayload) : [];
    const missingTools = REQUIRED_WORKFLOW_TOOLS.filter((tool) => !catalogToolNames.includes(tool));
    const catalogBlockers = [
      ...gatewayFailureBlockers(catalog, "openclaw_workflow_catalog_failed"),
      ...(catalog.status === 0 && catalog.parsed === undefined ? ["openclaw_workflow_catalog_invalid_json"] : []),
      ...(catalog.status === 0 && catalog.parsed !== undefined && !catalogOk ? ["openclaw_workflow_catalog_not_ok"] : []),
      ...(missingTools.length > 0 ? ["openclaw_workflow_catalog_missing_required_tools"] : [])
    ];
    steps.push({
      step: "catalog",
      toolName: "tools.catalog",
      ok: catalogBlockers.length === 0,
      evidenceRef: "workflow-run.json#catalog",
      outputSummary: { outputKind: "catalog", count: catalogToolNames.length },
      blockerCodes: catalogBlockers
    });
    for (const code of catalogBlockers) addBlocker(blockers, "P1", code, "openclaw-gateway", "OpenClaw gateway catalog did not expose the required workflow tools.");

    if (blockers.length === 0) {
      const search = invokeWorkflowTool(openclawBin, options, deadline, {
        step: "search",
        toolName: "loo_search_sessions",
        args: { query: DEFAULT_QUERY, limit: 5 }
      });
      steps.push(search);
      addStepBlockers(blockers, search);
      const selectedSession = firstSessionSelection(search.rawOutput);
      selectedSourceRef = selectedSession.sourceRef;
      selectedThreadId = selectedSession.threadId;
      if (selectedSourceRef && !SAFE_SOURCE_REF_PATTERN.test(selectedSourceRef)) {
        selectedSourceRef = null;
        sanitizeOutputSummary(search.outputSummary);
        addBlocker(blockers, "P1", "workflow_selected_source_ref_not_public_safe", "loo_search_sessions", "Selected source ref was omitted because it was not public-safe.");
      }
      ensureStepSourceRef(search, selectedSourceRef);
      if (selectedThreadId && !SAFE_IDENTIFIER_PATTERN.test(selectedThreadId)) {
        selectedThreadId = null;
        addBlocker(blockers, "P1", "workflow_selected_thread_id_not_public_safe", "loo_search_sessions", "Selected thread id was omitted because it was not public-safe.");
      }
      if (!selectedSourceRef || !selectedThreadId) {
        addBlocker(blockers, "P1", "workflow_selected_session_missing", "loo_search_sessions", "Search did not return a selectable public-safe Codex source ref.");
      }
    }

    if (blockers.length === 0 && selectedSourceRef && selectedThreadId) {
      const calls: WorkflowCall[] = [
        { step: "describe", toolName: "loo_describe_ref", args: { source_ref: selectedSourceRef } },
        { step: "expand", toolName: "loo_expand_session", args: { thread_id: selectedThreadId, profile: "brief", token_budget: DEFAULT_TOKEN_BUDGET } },
        { step: "plans", toolName: "loo_codex_plans", args: { thread_id: selectedThreadId, limit: 5 } },
        { step: "finals", toolName: "loo_codex_final_messages", args: { thread_id: selectedThreadId, limit: 5 } },
        { step: "touched_files", toolName: "loo_codex_touched_files", args: { thread_id: selectedThreadId } },
        { step: "control_dry_run", toolName: "loo_codex_control_dry_run", args: { action: "resume", thread_id: selectedThreadId } },
        {
          step: "drive",
          toolName: "loo_drive",
          args: {
            reviewer: "claude",
            driver: "codex",
            target_ref: `codex_thread:${selectedThreadId}`,
            objective: "Review the selected public-safe session and prepare the next bounded action.",
            max_turns: 4,
            token_budget: DEFAULT_TOKEN_BUDGET,
            timeout_ms: 120_000,
            cost_ceiling_usd: 1,
            dry_run: true
          }
        }
      ];
      for (const call of calls) {
        const step = invokeWorkflowTool(openclawBin, options, deadline, call);
        ensureStepSourceRef(step, selectedSourceRef);
        steps.push(step);
        addStepBlockers(blockers, step);
        if (call.step === "control_dry_run" || call.step === "drive") {
          dryRunApprovalAuditId = step.outputSummary.approvalAuditId ?? null;
          dryRunParamsHash = step.outputSummary.paramsHash ?? null;
          if (step.outputSummary.live === undefined) {
            addBlocker(blockers, "P0", "workflow_dry_run_control_live_missing", call.toolName, "Dry-run control must explicitly report live: false.");
          } else if (step.outputSummary.live !== false) {
            addBlocker(blockers, "P0", "workflow_dry_run_control_not_false", call.toolName, "Dry-run control must report live: false.");
          }
        }
        if (blockers.length > 0) break;
      }
    }
  }

  const workflowRunReady = blockers.length === 0;
  const report: QaLabWorkflowReport = {
    schema: "lco.qaLab.workflowRun.v1",
    ok: workflowRunReady,
    workflowRunReady,
    publicSafe: true,
    generatedAt: options.now ?? new Date().toISOString(),
    packageName: CANONICAL_PACKAGE_NAME,
    packageVersion: options.packageVersion ?? null,
    candidateSha: candidateShaValid ? options.candidateSha ?? null : null,
    scenarioId: options.scenarioId,
    surface: options.surface,
    mode: options.mode,
    command,
    workflow: {
      selectedSourceRef,
      selectedThreadId,
      toolsInvoked: steps.filter((step) => step.toolName.startsWith("loo_")).map((step) => step.toolName),
      steps: steps.map(stripRawOutput),
      rawTranscriptReadRequired: false,
      recommendedNextAction: workflowRunReady
        ? {
          kind: "dry_run_resume",
          tool: "loo_drive",
          execute: false,
          reason: "Use the public-safe workflow packet as QA Lab agent-workflow evidence; live control still requires separate approval and proof."
        }
        : {
          kind: "resolve_blockers",
          tool: null,
          execute: false,
          reason: "Resolve the listed fail-closed workflow blockers before using this packet for QA Lab or release gates."
        },
      dryRunControl: {
        live: false,
        approvalAuditId: dryRunApprovalAuditId,
        paramsHash: dryRunParamsHash
      }
    },
    blockers: uniqueBlockers(blockers),
    actionsPerformed: noActions(),
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS,
    nextSafeCommands: workflowRunReady
      ? ["loo qa-lab workflow --scenario-id <id> --surface openclaw-gateway --mode dry-run --evidence-dir <path> --strict"]
      : ["Repair the listed blockers, then rerun the same dry-run workflow command."],
    proofBoundary: "This QA Lab workflow runner uses public-safe OpenClaw gateway tool summaries only. It does not read raw transcripts, private prompt bodies, local session stores, screen captures, raw gateway logs, credential material, customer data, or perform live Codex control, GUI mutation, npm publishing, GitHub releases, or gateway scope approval."
  };

  writeFileSync(join(evidenceDir, "workflow-run.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

type InternalWorkflowStep = QaLabWorkflowStep & { rawOutput?: unknown };

function invokeWorkflowTool(
  openclawBin: string,
  options: QaLabWorkflowOptions,
  deadline: number,
  call: WorkflowCall
): InternalWorkflowStep {
  const result = callGatewayJson(openclawBin, "tools.invoke", {
    name: call.toolName,
    args: call.args,
    sessionKey: options.sessionKey || "agent:main:lco-qa-lab-workflow",
    confirm: false,
    idempotencyKey: workflowIdempotencyKey(options, call)
  }, options, remainingGatewayTimeoutMs(deadline));
  const payload = unwrapGatewayPayload(result.parsed);
  const output = unwrapToolOutput(payload);
  const outputSummary = summarizeOutput(call.toolName, output, call.args);
  const outputSummaryPublicSafe = summaryIsPublicSafe(outputSummary);
  if (!outputSummaryPublicSafe) sanitizeOutputSummary(outputSummary);
  const sanitizedOutputSummaryPublicSafe = summaryIsPublicSafe(outputSummary);
  const pluginOk = result.status === 0
    && result.parsed !== undefined
    && !hasErrorShape(payload)
    && !hasErrorShape(output)
    && (okStatus(payload) === true || okStatus(output) === true);
  const blockerCodes = [
    ...gatewayFailureBlockers(result, `openclaw_workflow_tool_failed:${call.toolName}`),
    ...(result.status === 0 && result.parsed === undefined ? [`openclaw_workflow_tool_invalid_json:${call.toolName}`] : []),
    ...(pluginOk ? [] : [`openclaw_workflow_tool_not_ok:${call.toolName}`]),
    ...(outputSummaryPublicSafe && sanitizedOutputSummaryPublicSafe ? [] : [`openclaw_workflow_output_summary_not_public_safe:${call.toolName}`])
  ];
  return {
    step: call.step,
    toolName: call.toolName,
    ok: blockerCodes.length === 0,
    evidenceRef: `workflow-run.json#${call.step}`,
    outputSummary,
    blockerCodes,
    rawOutput: output
  };
}

function callGatewayJson(
  openclawBin: string,
  method: string,
  params: unknown,
  options: QaLabWorkflowOptions,
  gatewayTimeoutMs: number
): GatewayJsonResult {
  if (gatewayTimeoutMs <= 0) {
    return { status: 124, parseError: "gateway deadline exceeded" };
  }
  const gatewayToken = options.token || options.env?.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN;
  if (options.gatewayUrl && gatewayToken) {
    return callGatewayBackendJson(options.gatewayUrl, gatewayToken, method, params, gatewayTimeoutMs, childEnv(options));
  }
  const gatewayOptions = [
    ...(options.gatewayUrl ? ["--url", options.gatewayUrl] : []),
    "--timeout",
    String(gatewayTimeoutMs)
  ];
  const env = childEnv(options);
  const call = spawnSync(openclawBin, [
    "gateway",
    "call",
    method,
    "--json",
    "--params",
    JSON.stringify(params),
    ...gatewayOptions
  ], {
    encoding: "utf8",
    env,
    maxBuffer: 10 * 1024 * 1024,
    timeout: gatewayTimeoutMs
  });
  const result: GatewayJsonResult = { status: call.status };
  try {
    result.parsed = JSON.parse(call.stdout) as unknown;
  } catch (error) {
    result.parseError = error instanceof Error ? error.message : "invalid JSON";
  }
  return result;
}

function summarizeOutput(toolName: string, output: unknown, args: Record<string, unknown>): QaLabWorkflowStep["outputSummary"] {
  const summary: QaLabWorkflowStep["outputSummary"] = {
    outputKind: Array.isArray(output) ? "array" : isRecord(output) ? "object" : output === undefined ? "missing" : typeof output
  };
  if (Array.isArray(output)) summary.count = output.length;
  if (isRecord(output)) {
    const count = typeof output.count === "number"
      ? output.count
      : Array.isArray(output.files)
        ? output.files.length
        : undefined;
    if (count !== undefined) summary.count = count;
  }
  const sourceRefs = collectSourceRefs(output).slice(0, 5);
  if (sourceRefs.length > 0) summary.sourceRefs = sourceRefs;
  const requestThreadId = typeof args.thread_id === "string"
    ? args.thread_id
    : typeof args.source_ref === "string"
      ? threadIdFromSourceRef(args.source_ref)
      : typeof args.target_ref === "string"
        ? threadIdFromSourceRef(args.target_ref)
      : null;
  const threadId = requestThreadId ?? firstThreadId(output) ?? undefined;
  if (threadId) summary.threadId = threadId;
  if (toolName === "loo_expand_session" && typeof args.token_budget === "number") summary.expansionBudget = args.token_budget;
  if (toolName === "loo_codex_control_dry_run" || toolName === "loo_drive") {
    const detailsOutput = isRecord(output) && isRecord(output.details) ? output.details : output;
    const controlOutput = toolName === "loo_drive" && isRecord(detailsOutput) && isRecord(detailsOutput.dryRun)
      ? detailsOutput.dryRun
      : detailsOutput;
    const live = readBooleanPath(controlOutput, ["live"]);
    if (live !== undefined) summary.live = live;
    summary.approvalAuditId = readStringPath(controlOutput, ["approvalAuditId"]) ?? readStringPath(controlOutput, ["approval_audit_id"]);
    summary.paramsHash = readStringPath(controlOutput, ["paramsHash"]) ?? readStringPath(controlOutput, ["params_hash"]);
  }
  return summary;
}

function stripRawOutput(step: InternalWorkflowStep): QaLabWorkflowStep {
  const { rawOutput: _rawOutput, ...publicStep } = step;
  return publicStep;
}

function noActions(): QaLabWorkflowReport["actionsPerformed"] {
  return {
    liveCodexControlRun: false,
    desktopGuiActionRun: false,
    rawTranscriptRead: false,
    rawPromptRead: false,
    screenCaptureRun: false,
    sourceStoreMutation: false,
    gatewayScopeApproval: false,
    npmPublished: false,
    githubReleaseCreated: false
  };
}

function gatewayFailureBlockers(call: GatewayJsonResult, fallback: string): string[] {
  if (call.status === 0) return [];
  return [fallback];
}

function addStepBlockers(blockers: QaLabWorkflowBlocker[], step: InternalWorkflowStep): void {
  for (const code of step.blockerCodes) {
    addBlocker(blockers, "P1", code, step.toolName, "Workflow tool invocation did not complete cleanly.");
  }
}

function unwrapGatewayPayload(value: unknown): unknown {
  let cursor = value;
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth += 1) {
    if (!isRecord(cursor)) return cursor;
    if ("payload" in cursor) {
      cursor = cursor.payload;
      continue;
    }
    if ("result" in cursor) {
      cursor = cursor.result;
      continue;
    }
    return cursor;
  }
  return cursor;
}

function unwrapToolOutput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ("output" in value) return value.output;
  if ("result" in value) return value.result;
  return value;
}

function extractCatalogToolNames(value: unknown): string[] {
  const tools: unknown[] = [];
  const collect = (item: unknown) => {
    if (!isRecord(item)) return;
    if (Array.isArray(item.tools)) tools.push(...item.tools);
    if (Array.isArray(item.groups)) for (const group of item.groups) collect(group);
  };
  collect(value);
  return [...new Set(tools.flatMap((tool) => {
    if (typeof tool === "string") return [tool];
    if (!isRecord(tool)) return [];
    if (typeof tool.name === "string") return [tool.name];
    if (typeof tool.id === "string") return [tool.id];
    return [];
  }))];
}

function directSourceRef(value: Record<string, unknown>): string | null {
  if (typeof value.sourceRef === "string") return value.sourceRef;
  if (typeof value.source_ref === "string") return value.source_ref;
  if (Array.isArray(value.sourceRefs)) {
    const ref = value.sourceRefs.find((item) => typeof item === "string" && SAFE_SOURCE_REF_PATTERN.test(item));
    if (typeof ref === "string") return ref;
  }
  if (Array.isArray(value.source_refs)) {
    const ref = value.source_refs.find((item) => typeof item === "string" && SAFE_SOURCE_REF_PATTERN.test(item));
    if (typeof ref === "string") return ref;
  }
  return null;
}

function firstSessionSelection(value: unknown, depth = 0): { sourceRef: string | null; threadId: string | null } {
  if (depth > MAX_OUTPUT_SCAN_DEPTH) return { sourceRef: null, threadId: null };
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstSessionSelection(item, depth + 1);
      if (found.sourceRef && found.threadId) return found;
    }
    return { sourceRef: null, threadId: null };
  }
  if (!isRecord(value)) return { sourceRef: null, threadId: null };

  const sourceRef = directSourceRef(value);
  const threadId = typeof value.threadId === "string"
    ? value.threadId
    : typeof value.thread_id === "string"
      ? value.thread_id
      : threadIdFromSourceRef(sourceRef);
  if (sourceRef && threadId) return { sourceRef, threadId };

  for (const child of Object.values(value)) {
    const found = firstSessionSelection(child, depth + 1);
    if (found.sourceRef && found.threadId) return found;
  }
  return { sourceRef: null, threadId: null };
}

function collectSourceRefs(value: unknown): string[] {
  const refs = new Set<string>();
  const visit = (item: unknown, depth = 0) => {
    if (depth > MAX_OUTPUT_SCAN_DEPTH) return;
    if (typeof item === "string" && /^(codex_thread|codex_event|codex_range|codex_source|summary_leaf|prepared_card|prepared_inbox|lcm_summary):/.test(item)) {
      refs.add(item);
      return;
    }
    if (Array.isArray(item)) for (const child of item) visit(child, depth + 1);
    else if (isRecord(item)) for (const child of Object.values(item)) visit(child, depth + 1);
  };
  visit(value);
  return [...refs].sort();
}

function firstThreadId(value: unknown, depth = 0): string | null {
  if (depth > MAX_OUTPUT_SCAN_DEPTH) return null;
  if (isRecord(value) && typeof value.threadId === "string") return value.threadId;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstThreadId(item, depth + 1);
      if (found) return found;
    }
  } else if (isRecord(value)) {
    for (const child of Object.values(value)) {
      const found = firstThreadId(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function threadIdFromSourceRef(sourceRef: string | null): string | null {
  if (!sourceRef?.startsWith("codex_thread:")) return null;
  return sourceRef.slice("codex_thread:".length) || null;
}

function readStringPath(value: unknown, path: string[]): string | undefined {
  const item = readPath(value, path);
  return typeof item === "string" ? item : undefined;
}

function readBooleanPath(value: unknown, path: string[]): boolean | undefined {
  const item = readPath(value, path);
  return typeof item === "boolean" ? item : undefined;
}

function readPath(value: unknown, path: string[]): unknown {
  let cursor = value;
  for (const part of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function okStatus(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.ok === "boolean" ? value.ok : undefined;
}

function hasErrorShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.error === "string" || isRecord(value.error)) return true;
  if (typeof value.status === "string" && ["error", "failed", "failure"].includes(value.status.toLowerCase())) return true;
  return false;
}

function childEnv(options: QaLabWorkflowOptions): NodeJS.ProcessEnv {
  const source = options.env ?? process.env;
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "TMPDIR"]) {
    if (source[key]) env[key] = source[key];
  }
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("OPENCLAW_FAKE_") && value !== undefined) env[key] = value;
  }
  return env;
}

function remainingGatewayTimeoutMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function ensureStepSourceRef(step: InternalWorkflowStep, selectedSourceRef: string | null): void {
  if (!selectedSourceRef) return;
  const refs = step.outputSummary.sourceRefs ?? [];
  if (refs.includes(selectedSourceRef)) return;
  step.outputSummary.sourceRefs = [selectedSourceRef, ...refs].slice(0, 5);
}

function summaryIsPublicSafe(summary: QaLabWorkflowStep["outputSummary"]): boolean {
  if (containsUnsafeSummaryValue(summary)) return false;
  if (!["array", "object", "missing", "string", "number", "boolean", "undefined"].includes(summary.outputKind)) return false;
  if (summary.threadId && !SAFE_IDENTIFIER_PATTERN.test(summary.threadId)) return false;
  if (summary.approvalAuditId && !SAFE_IDENTIFIER_PATTERN.test(summary.approvalAuditId)) return false;
  if (summary.paramsHash && !SAFE_IDENTIFIER_PATTERN.test(summary.paramsHash)) return false;
  if (summary.sourceRefs?.some((ref) => !SAFE_SOURCE_REF_PATTERN.test(ref))) return false;
  return true;
}

function containsUnsafeSummaryValue(value: unknown, depth = 0): boolean {
  if (depth > MAX_OUTPUT_SCAN_DEPTH) return true;
  if (typeof value === "string") {
    return /\/Users\/|\/Volumes\/|\/home\/|\/etc\/|[A-Za-z]:\\|\.jsonl\b|\.sqlite\b|Bearer\s+|Authorization:|password|npm_[A-Za-z0-9]{20,}|api[_-]?key|secret[_-]?key|cookie|eyJ[A-Za-z0-9_-]{10,}|AKIA[A-Z0-9]{12,}|BEGIN [A-Z ]*PRIVATE KEY/i.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsUnsafeSummaryValue(item, depth + 1));
  if (isRecord(value)) return Object.values(value).some((item) => containsUnsafeSummaryValue(item, depth + 1));
  return false;
}

function sanitizeOutputSummary(summary: QaLabWorkflowStep["outputSummary"]): void {
  if (summary.threadId && !SAFE_IDENTIFIER_PATTERN.test(summary.threadId)) delete summary.threadId;
  if (summary.approvalAuditId && !SAFE_IDENTIFIER_PATTERN.test(summary.approvalAuditId)) delete summary.approvalAuditId;
  if (summary.paramsHash && !SAFE_IDENTIFIER_PATTERN.test(summary.paramsHash)) delete summary.paramsHash;
  if (summary.sourceRefs) {
    summary.sourceRefs = summary.sourceRefs.filter((ref) => SAFE_SOURCE_REF_PATTERN.test(ref));
    if (summary.sourceRefs.length === 0) delete summary.sourceRefs;
  }
}

function workflowIdempotencyKey(options: QaLabWorkflowOptions, call: WorkflowCall): string {
  const stablePayload = JSON.stringify({
    scenarioId: options.scenarioId,
    surface: options.surface,
    mode: options.mode,
    gatewayUrl: options.gatewayUrl ?? null,
    openclawBin: options.openclawBin ? sanitizeCommandBinary(options.openclawBin) : null,
    sessionKey: options.sessionKey || "agent:main:lco-qa-lab-workflow",
    toolName: call.toolName,
    args: call.args
  });
  const hash = createHash("sha256").update(stablePayload).digest("hex").slice(0, 24);
  return `loo-qa-workflow-${hash}-${call.toolName}`;
}

function addBlocker(blockers: QaLabWorkflowBlocker[], severity: QaLabWorkflowBlocker["severity"], code: string, source: string, detail: string): void {
  blockers.push({ severity, code, source, detail });
}

function uniqueBlockers(blockers: QaLabWorkflowBlocker[]): QaLabWorkflowBlocker[] {
  const seen = new Set<string>();
  const result: QaLabWorkflowBlocker[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.severity}:${blocker.code}:${blocker.source}:${blocker.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(blocker);
  }
  return result;
}

function sanitizeCommandBinary(openclawBin: string): string {
  return openclawBin.includes("/") ? basename(openclawBin) : openclawBin;
}

function validateOpenClawBin(openclawBin: string): { ok: true } | { ok: false; code: string; detail: string } {
  if (/[^\x20-\x7E]/.test(openclawBin) || /[\0\r\n\t]/.test(openclawBin)) {
    return { ok: false, code: "workflow_openclaw_bin_invalid", detail: "OpenClaw binary path contains control characters." };
  }
  const binaryName = basename(openclawBin);
  if (binaryName !== openclawBin && openclawBin.split(/[\\/]+/).includes("..")) {
    return { ok: false, code: "workflow_openclaw_bin_traversal", detail: "OpenClaw binary path must not contain parent-directory traversal." };
  }
  if (!/^openclaw[A-Za-z0-9_.-]*$/.test(binaryName)) {
    return { ok: false, code: "workflow_openclaw_bin_untrusted_name", detail: "OpenClaw binary name must be openclaw or an explicit openclaw-* test wrapper." };
  }
  return { ok: true };
}

function validateGatewayUrl(gatewayUrl: string | undefined): { ok: true } | { ok: false; code: string; detail: string } {
  if (!gatewayUrl) return { ok: true };
  let parsed: URL;
  try {
    parsed = new URL(gatewayUrl);
  } catch {
    return { ok: false, code: "workflow_gateway_url_invalid", detail: "Gateway URL must be a valid ws:// or wss:// URL." };
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    return { ok: false, code: "workflow_gateway_url_unsupported_scheme", detail: "Gateway URL must use ws:// or wss://." };
  }
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)) {
    return { ok: false, code: "workflow_gateway_url_not_loopback", detail: "QA Lab workflow gateway URL must point at a loopback host." };
  }
  return { ok: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function qaLabWorkflowReportId(report: QaLabWorkflowReport): string {
  return createHash("sha256").update(JSON.stringify({
    schema: report.schema,
    scenarioId: report.scenarioId,
    surface: report.surface,
    mode: report.mode,
    generatedAt: report.generatedAt,
    workflowRunReady: report.workflowRunReady,
    blockers: report.blockers.map((blocker) => blocker.code)
  })).digest("hex");
}
