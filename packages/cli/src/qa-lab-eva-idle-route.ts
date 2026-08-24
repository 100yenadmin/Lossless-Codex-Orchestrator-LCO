import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { resolveHomeDir } from "../../runtime/src/env.js";
import {
  CANONICAL_PACKAGE_NAME,
  findSupportedPackageRoot,
  packageNameForRoot,
  readPackageVersionFromRoots,
  type SupportedPackageName
} from "./package-identity.js";

export const EVA_IDLE_ROUTE_SCHEMA = "lco.evaIdleRouteDeliver.v1" as const;
export const EVA_IDLE_ROUTE_PACKAGE_VERSION = "1.7.0";
export const EVA_IDLE_ROUTE_CANDIDATE_SHA = "78bd6e7d4e5656d09e76c4c85d01a85b3515b354";
export const EVA_IDLE_ROUTE_PACKAGE_INTEGRITY = "sha512-0sZShBTX/+332BEavQ46oHcoUygXwfus+NPa/B37z/6OUcMb/3Q8n7QrqOxIq1EIQmTmtgusZ35car8Spp7Evw==";
export const EVA_IDLE_ROUTE_PACKAGE_SHASUM = "9b4199489324d2fb21e6a44b5feb7eadd8000817";
export const EVA_IDLE_ROUTE_PREFIX_MARKER = `lossless-codex-orchestrator-${EVA_IDLE_ROUTE_PACKAGE_VERSION}-${EVA_IDLE_ROUTE_PACKAGE_SHASUM.slice(0, 12)}`;
export const EVA_IDLE_ROUTE_MCP_BINARY_SHA256 = "9479937d64a5094ea72a908d28d2d2c041a602cf583b1021eeb334ecd041855c";
export const EVA_IDLE_ROUTE_MESSAGE = "Return only the token formed by concatenating these two strings: LCO_IDLE_ and OK";

const DEFAULT_STAGE_TIMEOUTS = {
  initializeMs: 30_000,
  routeMs: 15_000,
  deliverMs: 15_000,
  completionMs: 120_000
} as const;

type EvaIdleStageStatus = "not_run" | "running" | "passed" | "blocked";

export type EvaIdleRouteStage = {
  name: string;
  status: Exclude<EvaIdleStageStatus, "running">;
  elapsedMs: number;
  errorClass: string | null;
};

export type EvaIdleRouteSetupClient = {
  startThread(): Promise<string>;
  nameThread(threadId: string, title: string): Promise<void>;
  completionObserved(threadId: string): Promise<boolean>;
  close?(): Promise<void> | void;
};

export type EvaIdleRouteOptions = {
  evidenceDir: string;
  mcpBin: string;
  packageVersion: string;
  candidateSha: string;
  execute?: boolean;
  strict?: boolean;
  now?: string;
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
  completionTimeoutMs?: number;
  /** @internal focused-test seam; production pins the immutable v1.7.0 MCP binary hash. */
  expectedMcpBinarySha256?: string;
  /** @internal focused-test seam; production uses the daemon setup client. */
  setupClientFactory?: () => Promise<EvaIdleRouteSetupClient>;
  /** @internal focused-test seam; production uses child_process.spawn. */
  spawnFactory?: typeof spawn;
};

export type EvaIdleRouteReport = {
  schema: typeof EVA_IDLE_ROUTE_SCHEMA;
  ok: boolean;
  publicSafe: true;
  localOnly: true;
  execute: boolean;
  generatedAt: string;
  harness_repo_head: string;
  harness_command_version: string;
  candidateSha: string;
  publicSafeTitle: string | null;
  subject: {
    packageName: SupportedPackageName | null;
    packageVersion: string | null;
    packageIntegrity: string | null;
    packageShasum: string | null;
    mcpBinarySha256: string | null;
    mcpBinaryHashVerified: boolean;
    immutablePrefixVerified: boolean;
  };
  stages: EvaIdleRouteStage[];
  timings: {
    monotonicElapsedMs: number;
    stageOrder: string[];
  };
  mcpSessionCount: number;
  mcpSessionReused: boolean;
  targetHashes: {
    routeSha256: string | null;
    dryRunSha256: string | null;
    liveSha256: string | null;
    equal: boolean;
  };
  messageHashes: {
    dryRunSha256: string | null;
    liveSha256: string | null;
    equal: boolean;
  };
  parameterHashes: {
    dryRunSha256: string | null;
    liveSha256: string | null;
    equal: boolean;
  };
  lastObservedMarker: string;
  approvalBindingVerified: boolean;
  accepted: boolean;
  completionSeen: boolean;
  terminalMarkerObserved: boolean;
  rollback: {
    status: "not_run";
    performed: false;
  };
  auditBoundary: {
    directoryMode700: boolean;
    jsonlRegularMode600: boolean;
    keyRegularMode600: boolean;
    cleanupStatus: "not_created" | "cleaned" | "retained_for_operator";
  };
  actionsPerformed: {
    liveCodexControlRun: boolean;
    sourceStoreMutation: false;
    externalWrite: false;
    guiMutation: false;
    npmPublished: false;
    githubReleaseCreated: false;
  };
  forbidden_fields_present: false;
  blockers: string[];
  warnings: string[];
  proofBoundary: string;
  nextSafeCommands: string[];
};

type StructuredResult = Record<string, unknown>;

type PackageIdentity = {
  packageName: SupportedPackageName | null;
  packageVersion: string | null;
  packageIntegrity: string | null;
  packageShasum: string | null;
  mcpBinarySha256: string | null;
  mcpBinaryHashVerified: boolean;
  immutablePrefixVerified: boolean;
};

type StageResult<T> = { value: T; stage: EvaIdleRouteStage };

export async function runEvaIdleRoute(options: EvaIdleRouteOptions): Promise<EvaIdleRouteReport> {
  mkdirSync(options.evidenceDir, { recursive: true });
  const execute = options.execute === true;
  const generatedAt = options.now ?? new Date().toISOString();
  const startedAt = process.hrtime.bigint();
  const completionBudgetMs = options.completionTimeoutMs ?? DEFAULT_STAGE_TIMEOUTS.completionMs;
  const stages: EvaIdleRouteStage[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (options.packageVersion !== EVA_IDLE_ROUTE_PACKAGE_VERSION) blockers.push("candidate_package_version_unsupported");
  if (options.candidateSha !== EVA_IDLE_ROUTE_CANDIDATE_SHA) blockers.push("candidate_sha_mismatch");
  const identity = inspectPackageIdentity(
    options.mcpBin,
    options.packageVersion,
    options.expectedMcpBinarySha256 ?? EVA_IDLE_ROUTE_MCP_BINARY_SHA256,
    blockers
  );
  const harnessHead = readHarnessHead(options.repoRoot ?? process.cwd(), blockers);
  const title = execute ? createPublicSafeTitle(generatedAt, options.candidateSha) : null;
  let session: PersistentMcpSession | null = null;
  let setupClient: EvaIdleRouteSetupClient | null = null;
  let audit: AuditBoundary = emptyAuditBoundary();
  let routeTarget: string | null = null;
  let routeHash: string | null = null;
  let dryTargetHash: string | null = null;
  let liveTargetHash: string | null = null;
  let dryMessageHash: string | null = null;
  let liveMessageHash: string | null = null;
  let dryParamsHash: string | null = null;
  let liveParamsHash: string | null = null;
  let approvalBindingVerified = false;
  let accepted = false;
  let completionSeen = false;
  let terminalMarkerObserved = false;
  let taskCreated = false;
  let mcpSessionCount = 0;
  let runtimeRoot: string | null = null;

  try {
    if (blockers.length > 0) {
      stages.push({ name: "identity_preflight", status: "blocked", elapsedMs: 0, errorClass: blockers[0] ?? "identity_preflight_failed" });
      throw new EvaIdleRouteError("identity_preflight_failed");
    }
    const subject = await runStage(stages, "mcp_initialize", async () => {
      const runtime = execute ? createRuntimeRoot() : null;
      runtimeRoot = runtime;
      audit = execute ? createAuditBoundary() : emptyAuditBoundary();
      session = await PersistentMcpSession.start({
        mcpBin: options.mcpBin,
        expectedVersion: options.packageVersion,
        timeoutMs: DEFAULT_STAGE_TIMEOUTS.initializeMs,
        spawnFactory: options.spawnFactory,
        env: options.env,
        runtimeRoot: runtime,
        auditPath: audit.auditPath
      });
      mcpSessionCount = 1;
      return session;
    }, blockers, "mcp_initialize_failed");

    if (subject.stage.status === "passed" && subject.value) {
      await runStage(stages, "mcp_tools_list", async () => {
        const result = await subject.value!.request("tools/list", {}, DEFAULT_STAGE_TIMEOUTS.initializeMs);
        const names = extractToolNames(result);
        for (const required of ["lco_codex_control_route", "lco_codex_deliver"]) {
          if (!names.includes(required)) throw new EvaIdleRouteError("required_tool_missing");
        }
        return names;
      }, blockers, "mcp_tools_list_failed");
    }

    if (!execute) {
      warnings.push("default_non_executing_mode");
      stages.push({ name: "execution_gate", status: "not_run", elapsedMs: 0, errorClass: null });
    } else if (!session || stages.some((stage) => stage.name === "mcp_tools_list" && stage.status !== "passed")) {
      stages.push({ name: "execution_gate", status: "blocked", elapsedMs: 0, errorClass: "mcp_preflight_failed" });
      blockers.push("mcp_preflight_failed");
    } else {
      const setup = await runStage(stages, "task_setup", async () => {
        setupClient = await (options.setupClientFactory ?? createDaemonSetupClient)();
        const threadId = await setupClient.startThread();
        taskCreated = true;
        await setupClient.nameThread(threadId, title!);
        return { threadId };
      }, blockers, "task_setup_failed");

      if (setup.stage.status === "passed" && setup.value) {
        const route = await runStage(stages, "route", async () => {
          const result = await session!.request("tools/call", {
            name: "lco_codex_control_route",
            arguments: { hint: title }
          }, DEFAULT_STAGE_TIMEOUTS.routeMs);
          const record = requireStructured(result);
          if (record.status !== "selected" || record.route !== "app_server") throw new EvaIdleRouteError(routeReason(record));
          const targetRef = stringValue(record.target_ref);
          if (!targetRef || !isOpaqueTarget(targetRef)) throw new EvaIdleRouteError("opaque_target_missing");
          if (record.title_sanitized !== title) throw new EvaIdleRouteError("route_title_mismatch");
          const expiresAt = stringValue(record.expires_at);
          if (!expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
            throw new EvaIdleRouteError("target_ref_expired");
          }
          return { targetRef, hash: sha256(targetRef) };
        }, blockers, "route_failed");
        if (route.stage.status === "passed" && route.value) {
          routeTarget = route.value.targetRef;
          routeHash = route.value.hash;
          const dry = await runStage(stages, "deliver_dry_run", async () => {
            const result = await session!.request("tools/call", {
              name: "lco_codex_deliver",
              arguments: { target_ref: routeTarget, message: EVA_IDLE_ROUTE_MESSAGE, dry_run: true }
            }, DEFAULT_STAGE_TIMEOUTS.deliverMs);
            const record = requireStructured(result);
            if (record.live === true || record.status !== "dry_run_ready") throw new EvaIdleRouteError("generic_dry_run_rejected");
            const approvalId = stringValue(record.approval_audit_id);
            if (!approvalId) throw new EvaIdleRouteError("approval_missing");
            const paramsHash = stringValue(record.params_hash);
            const messageHash = stringValue(record.message_hash);
            if (!paramsHash || !messageHash) throw new EvaIdleRouteError("approval_hash_missing");
            const targetRef = stringValue(record.target_ref);
            if (!targetRef || targetRef !== routeTarget) throw new EvaIdleRouteError("target_drift");
            return { approvalId, paramsHash, messageHash, targetHash: sha256(targetRef) };
          }, blockers, "deliver_dry_run_failed");
          if (dry.stage.status === "passed" && dry.value) {
            dryTargetHash = dry.value.targetHash;
            dryMessageHash = dry.value.messageHash;
            dryParamsHash = dry.value.paramsHash;
            const live = await runStage(stages, "deliver_live", async () => {
              const result = await session!.request("tools/call", {
                name: "lco_codex_deliver",
                arguments: {
                  target_ref: routeTarget,
                  message: EVA_IDLE_ROUTE_MESSAGE,
                  dry_run: false,
                  approval_audit_id: dry.value!.approvalId
                }
              }, DEFAULT_STAGE_TIMEOUTS.deliverMs);
              const record = requireStructured(result);
              if (record.live !== true || record.control_sent !== true) {
                throw new EvaIdleRouteError(firstReason(record, "approval_or_control_rejected"));
              }
              if (stringValue(record.approval_audit_id) !== dry.value!.approvalId) throw new EvaIdleRouteError("approval_binding_mismatch");
              if (stringValue(record.target_ref) !== routeTarget) throw new EvaIdleRouteError("target_drift");
              if (stringValue(record.params_hash) !== dry.value!.paramsHash || stringValue(record.message_hash) !== dry.value!.messageHash) {
                throw new EvaIdleRouteError("approval_hash_mismatch");
              }
              return {
                record,
                paramsHash: stringValue(record.params_hash)!,
                messageHash: stringValue(record.message_hash)!
              };
            }, blockers, "deliver_live_failed");
            if (live.stage.status === "passed") {
              accepted = true;
              approvalBindingVerified = true;
              liveTargetHash = routeHash;
              liveMessageHash = live.value!.messageHash;
              liveParamsHash = live.value!.paramsHash;
              const completion = await runStage(stages, "completion_probe", async () => {
                const deadline = Date.now() + completionBudgetMs;
                while (Date.now() < deadline) {
                  if (await setupClient!.completionObserved(setup.value!.threadId)) return true;
                  await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
                }
                throw new EvaIdleRouteError("completion_deadline_exceeded");
              }, blockers, "completion_probe_failed");
              completionSeen = completion.stage.status === "passed";
              terminalMarkerObserved = completionSeen;
            }
          }
        }
      }
    }
  } catch (error) {
    blockers.push(sanitizeErrorClass(error));
  } finally {
    const finalSetupClient = setupClient as EvaIdleRouteSetupClient | null;
    const finalSession = session as PersistentMcpSession | null;
    if (finalSetupClient?.close) {
      try {
        await finalSetupClient.close();
      } catch {
        blockers.push("setup_client_close_failed");
      }
    }
    if (finalSession) await finalSession.close();
    if (runtimeRoot) {
      try {
        rmSync(runtimeRoot, { recursive: true, force: true });
      } catch {
        blockers.push("runtime_cleanup_failed");
      }
    }
    audit = finalizeAuditBoundary(audit);
    if (execute && audit.cleanupStatus !== "cleaned") blockers.push("audit_boundary_verification_failed");
  }

  const report: EvaIdleRouteReport = {
    schema: EVA_IDLE_ROUTE_SCHEMA,
    ok: execute ? blockers.length === 0 && completionSeen : blockers.length === 0,
    publicSafe: true,
    localOnly: true,
    execute,
    generatedAt,
    harness_repo_head: harnessHead,
    harness_command_version: readHarnessCommandVersion(),
    candidateSha: options.candidateSha,
    publicSafeTitle: title,
    subject: identity,
    stages: normalizeStages(stages),
    timings: {
      monotonicElapsedMs: elapsedMs(startedAt),
      stageOrder: stages.map((stage) => stage.name)
    },
    mcpSessionCount,
    mcpSessionReused: mcpSessionCount === 1,
    targetHashes: {
      routeSha256: routeHash,
      dryRunSha256: dryTargetHash,
      liveSha256: liveTargetHash,
      equal: Boolean(routeHash && routeHash === dryTargetHash && routeHash === liveTargetHash)
    },
    messageHashes: {
      dryRunSha256: dryMessageHash,
      liveSha256: liveMessageHash,
      equal: Boolean(dryMessageHash && dryMessageHash === liveMessageHash)
    },
    parameterHashes: {
      dryRunSha256: dryParamsHash,
      liveSha256: liveParamsHash,
      equal: Boolean(dryParamsHash && dryParamsHash === liveParamsHash)
    },
    lastObservedMarker: stages.at(-1)?.name ?? "not_started",
    approvalBindingVerified,
    accepted,
    completionSeen,
    terminalMarkerObserved,
    rollback: { status: "not_run", performed: false },
    auditBoundary: {
      directoryMode700: audit.directoryMode700,
      jsonlRegularMode600: audit.jsonlRegularMode600,
      keyRegularMode600: audit.keyRegularMode600,
      cleanupStatus: audit.cleanupStatus
    },
    actionsPerformed: {
      liveCodexControlRun: execute && (taskCreated || accepted),
      sourceStoreMutation: false,
      externalWrite: false,
      guiMutation: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    forbidden_fields_present: false,
    blockers: uniqueStrings(blockers),
    warnings: uniqueStrings(warnings),
    proofBoundary: "This public-safe operator-only candidate harness proves only the named disposable Eva idle route, opaque dry-run/live acceptance, and bounded read-only completion marker when those stages pass. It does not prove Eva runtime safety, Hermes handler/lock/dispatch health, release publication, customer readiness, fleet readiness, or any live action beyond this one disposable task.",
    nextSafeCommands: [
      `lco qa-lab eva-idle-route --evidence-dir <path> --mcp-bin <exact-package-bin> --package-version ${options.packageVersion} --candidate-sha ${options.candidateSha} [--execute] [--strict]`
    ]
  };
  writeEvaIdleRouteReport(report, options.evidenceDir);
  return report;
}

export function writeEvaIdleRouteReport(report: EvaIdleRouteReport, evidenceDir: string): string {
  mkdirSync(evidenceDir, { recursive: true });
  const outputPath = join(evidenceDir, "eva-idle-route.json");
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (containsForbiddenReceiptFields(serialized)) throw new Error("eva_idle_route_forbidden_fields_detected");
  writeFileSyncSafe(outputPath, serialized);
  return outputPath;
}

class EvaIdleRouteError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

class PersistentMcpSession {
  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly expectedVersion: string,
    private readonly timeoutMs: number
  ) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consume(chunk));
    child.stderr.resume();
    child.on("error", () => this.failPending("mcp_process_error"));
    child.on("close", () => this.failPending("mcp_process_closed"));
  }

  static async start(options: {
    mcpBin: string;
    expectedVersion: string;
    timeoutMs: number;
    spawnFactory?: typeof spawn;
    env?: NodeJS.ProcessEnv;
    runtimeRoot: string | null;
    auditPath: string | null;
  }): Promise<PersistentMcpSession> {
    const spawnChild = options.spawnFactory ?? spawn;
    const env = isolatedSubjectEnv(options.env ?? process.env, options.runtimeRoot, options.auditPath);
    const child = spawnChild(options.mcpBin, [], { stdio: ["pipe", "pipe", "pipe"], env });
    const session = new PersistentMcpSession(child, options.expectedVersion, options.timeoutMs);
    try {
      const initialize = await session.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "lco-eva-idle-route", version: "1.0.0" }
      }, options.timeoutMs);
      const result = requireRecord(initialize);
      const serverInfo = requireRecord(result.serverInfo);
      if (serverInfo.version !== options.expectedVersion) {
        throw new EvaIdleRouteError("mcp_server_version_mismatch");
      }
      await session.notification("notifications/initialized", {});
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }

  request(method: string, params: Record<string, unknown>, timeoutMs = this.timeoutMs): Promise<unknown> {
    return this.send(method, params, true, timeoutMs);
  }

  notification(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.send(method, params, false, this.timeoutMs);
  }

  async close(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 250);
        this.child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
    }
    this.failPending("mcp_session_closed");
  }

  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 1;
  private buffer = "";

  private send(method: string, params: Record<string, unknown>, expectsResponse: boolean, timeoutMs: number): Promise<unknown> {
    const id = expectsResponse ? this.nextId++ : undefined;
    const payload = { jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params };
    if (id === undefined) {
      try {
        this.child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch {
        return Promise.reject(new EvaIdleRouteError("mcp_write_failed"));
      }
      return Promise.resolve(null);
    }
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new EvaIdleRouteError(`${method.replaceAll("/", "_")}_timeout`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    try {
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new EvaIdleRouteError("mcp_write_failed"));
      }
    }
    return response;
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let payload: unknown;
      try {
        payload = JSON.parse(line);
      } catch {
        continue;
      }
      const record = asRecord(payload);
      if (!record || typeof record.id !== "number") continue;
      const pending = this.pending.get(record.id);
      if (!pending) continue;
      this.pending.delete(record.id);
      clearTimeout(pending.timer);
      if (Object.prototype.hasOwnProperty.call(record, "error")) pending.reject(new EvaIdleRouteError("mcp_rpc_error"));
      else pending.resolve(record.result);
    }
  }

  private failPending(code: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new EvaIdleRouteError(code));
      this.pending.delete(id);
    }
  }
}

async function runStage<T>(stages: EvaIdleRouteStage[], name: string, operation: () => Promise<T>, blockers: string[], fallbackError: string): Promise<StageResult<T>> {
  const startedAt = process.hrtime.bigint();
  try {
    const value = await operation();
    const stage = { name, status: "passed" as const, elapsedMs: elapsedMs(startedAt), errorClass: null };
    stages.push(stage);
    return { value, stage };
  } catch (error) {
    const errorClass = sanitizeErrorClass(error) || fallbackError;
    blockers.push(errorClass || fallbackError);
    const stage = { name, status: "blocked" as const, elapsedMs: elapsedMs(startedAt), errorClass: errorClass || fallbackError };
    stages.push(stage);
    return { value: undefined as T, stage };
  }
}

function createRuntimeRoot(): string {
  return mkdtempSync(join(tmpdir(), "lco-eva-idle-runtime-"));
}

type AuditBoundary = {
  rootPath: string | null;
  auditPath: string | null;
  directoryMode700: boolean;
  jsonlRegularMode600: boolean;
  keyRegularMode600: boolean;
  cleanupStatus: "not_created" | "cleaned" | "retained_for_operator";
};

function emptyAuditBoundary(): AuditBoundary {
  return { rootPath: null, auditPath: null, directoryMode700: false, jsonlRegularMode600: false, keyRegularMode600: false, cleanupStatus: "not_created" };
}

function createAuditBoundary(): AuditBoundary {
  const rootPath = mkdtempSync(join(tmpdir(), "lco-eva-idle-audit-"));
  chmodSync(rootPath, 0o700);
  const auditPath = join(rootPath, "audit.jsonl");
  writeFileSync(auditPath, "", { mode: 0o600, flag: "wx" });
  return {
    rootPath,
    auditPath,
    directoryMode700: modeIs(rootPath, 0o700),
    jsonlRegularMode600: false,
    keyRegularMode600: false,
    cleanupStatus: "retained_for_operator"
  };
}

function finalizeAuditBoundary(audit: AuditBoundary): AuditBoundary {
  if (!audit.rootPath || !audit.auditPath) return audit;
  const jsonl = regularMode600(audit.auditPath);
  const key = regularMode600(`${audit.auditPath}.key`);
  const directoryMode700 = modeIs(audit.rootPath, 0o700);
  const safeToDelete = directoryMode700 && jsonl && key;
  if (safeToDelete) {
    rmSync(audit.rootPath, { recursive: true, force: true });
    return { ...audit, directoryMode700, jsonlRegularMode600: jsonl, keyRegularMode600: key, cleanupStatus: "cleaned" };
  }
  return { ...audit, directoryMode700, jsonlRegularMode600: jsonl, keyRegularMode600: key, cleanupStatus: "retained_for_operator" };
}

async function createDaemonSetupClient(): Promise<EvaIdleRouteSetupClient> {
  const transport = process.env.LCO_CODEX_TRANSPORT ?? "stdio";
  if (transport !== "daemon") throw new EvaIdleRouteError("daemon_transport_required");
  const socketOverride = process.env.LCO_CODEX_DAEMON_SOCKET;
  const codexHome = process.env.CODEX_HOME || join(resolveHomeDir(), ".codex");
  const { resolveCodexDaemonSocketPath, CodexJsonRpcClient, UnixSocketWebSocketTransport } = await import("../../adapters/src/index.js");
  const socketPath = socketOverride || resolveCodexDaemonSocketPath(codexHome);
  if (!isAbsolute(socketPath)) throw new EvaIdleRouteError("daemon_socket_not_absolute");
  const client = new CodexJsonRpcClient(() => new UnixSocketWebSocketTransport(socketPath, DEFAULT_STAGE_TIMEOUTS.routeMs), { surface: "smoke_setup" });
  await client.connect();
  return {
    async startThread() {
      const response = await client.request("thread/start", {
        ephemeral: true,
        approvalPolicy: "never",
        sandbox: "read-only"
      });
      if (!response.ok) throw new EvaIdleRouteError("thread_start_rejected");
      const result = asRecord(response.result);
      const threadId = stringValue(asRecord(result?.thread)?.id);
      if (!threadId) throw new EvaIdleRouteError("thread_start_id_missing");
      return threadId;
    },
    async nameThread(threadId, title) {
      const response = await client.request("thread/name/set", { threadId, name: title });
      if (!response.ok) throw new EvaIdleRouteError("thread_name_rejected");
    },
    async completionObserved(threadId) {
      const response = await client.request("thread/read", { threadId, includeTurns: true });
      if (!response.ok) throw new EvaIdleRouteError("thread_read_failed");
      return containsTerminalAssistantMarker(response.result);
    },
    close: () => client.close()
  };
}

function isolatedSubjectEnv(source: NodeJS.ProcessEnv, runtimeRoot: string | null, auditPath: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "LANG", "LC_ALL", "TZ", "LCO_CODEX_TRANSPORT", "LCO_CODEX_DAEMON_SOCKET", "CODEX_HOME", "LCO_TOOL_PROFILE"]) {
    if (source[key]) env[key] = source[key];
  }
  if (runtimeRoot) {
    if (env.LCO_CODEX_TRANSPORT === "daemon" && !env.LCO_CODEX_DAEMON_SOCKET) {
      const sourceCodexHome = source.CODEX_HOME || join(resolveHomeDir(source), ".codex");
      env.LCO_CODEX_DAEMON_SOCKET = join(sourceCodexHome, "app-server-control", "app-server-control.sock");
    }
    env.HOME = runtimeRoot;
    env.USERPROFILE = runtimeRoot;
    env.TMPDIR = runtimeRoot;
    env.TMP = runtimeRoot;
    env.TEMP = runtimeRoot;
    env.CODEX_HOME = join(runtimeRoot, ".codex");
    env.LCO_DB_PATH = join(runtimeRoot, "orchestrator.sqlite");
  }
  if (auditPath) env.LCO_AUDIT_PATH = auditPath;
  return env;
}

function inspectPackageIdentity(mcpBin: string, expectedVersion: string, expectedBinarySha256: string, blockers: string[]): PackageIdentity {
  let mcpBinarySha256: string | null = null;
  let packageRoot: string | null = null;
  let mcpBinaryHashVerified = false;
  let immutablePrefixVerified = false;
  try {
    const stat = statSync(mcpBin);
    if (!stat.isFile()) throw new EvaIdleRouteError("mcp_binary_not_regular");
    const resolvedBin = realpathSync(mcpBin);
    mcpBinarySha256 = sha256(readFileSync(resolvedBin));
    mcpBinaryHashVerified = mcpBinarySha256 === expectedBinarySha256;
    packageRoot = findSupportedPackageRoot(dirname(resolvedBin));
    immutablePrefixVerified = resolvedBin.includes(EVA_IDLE_ROUTE_PREFIX_MARKER);
  } catch (error) {
    blockers.push(sanitizeErrorClass(error) || "mcp_binary_unavailable");
  }
  const packageVersion = packageRoot ? readPackageVersionFromRoots([packageRoot]) : null;
  const packageName = packageRoot ? packageNameForRoot(packageRoot) : null;
  if (!packageRoot) blockers.push("subject_package_root_unavailable");
  if (!mcpBinaryHashVerified) blockers.push("subject_mcp_binary_hash_mismatch");
  if (!immutablePrefixVerified) blockers.push("subject_immutable_prefix_mismatch");
  if (packageName !== CANONICAL_PACKAGE_NAME) blockers.push("subject_package_name_mismatch");
  if (packageVersion !== expectedVersion) blockers.push("subject_package_version_mismatch");
  const isRelease = packageName === CANONICAL_PACKAGE_NAME && packageVersion === EVA_IDLE_ROUTE_PACKAGE_VERSION;
  return {
    packageName,
    packageVersion,
    packageIntegrity: isRelease ? EVA_IDLE_ROUTE_PACKAGE_INTEGRITY : null,
    packageShasum: isRelease ? EVA_IDLE_ROUTE_PACKAGE_SHASUM : null,
    mcpBinarySha256,
    mcpBinaryHashVerified,
    immutablePrefixVerified
  };
}

function readHarnessHead(repoRoot: string, blockers: string[]): string {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", timeout: 5_000 }).trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
  } catch {
    // Public-safe fallback below.
  }
  blockers.push("harness_repo_head_unavailable");
  return "unknown";
}

function readHarnessCommandVersion(): string {
  return "lco-qa-lab-eva-idle-route/1.0";
}

function createPublicSafeTitle(generatedAt: string, candidateSha: string): string {
  return `Eva LCO idle route probe ${sha256(`${generatedAt}:${candidateSha}`).slice(0, 12)}`;
}

function requireStructured(value: unknown): StructuredResult {
  const record = asRecord(value);
  const structured = asRecord(record?.structuredContent);
  if (structured) return structured;
  const content = Array.isArray(record?.content) ? record.content : [];
  const text = content.map((item) => asRecord(item)?.text).find((item): item is string => typeof item === "string");
  if (!text) throw new EvaIdleRouteError("mcp_structured_result_missing");
  try {
    const parsed = JSON.parse(text);
    const parsedRecord = asRecord(parsed);
    if (!parsedRecord) throw new Error("not_object");
    return parsedRecord;
  } catch {
    throw new EvaIdleRouteError("mcp_structured_result_invalid");
  }
}

function extractToolNames(value: unknown): string[] {
  const result = asRecord(value)?.result ?? value;
  const tools = Array.isArray(asRecord(result)?.tools) ? asRecord(result)?.tools as unknown[] : [];
  return tools
    .map((tool) => asRecord(tool)?.name)
    .filter((name): name is string => typeof name === "string" && /^lco_[a-z0-9_]+$/.test(name));
}

export function containsTerminalAssistantMarker(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsTerminalAssistantMarker);
  const record = asRecord(value);
  if (!record) return false;
  const type = stringValue(record.type)?.replace(/[^a-z]/gi, "").toLowerCase();
  const role = stringValue(record.role)?.toLowerCase();
  if (role === "assistant" || type === "agentmessage" || type === "assistantmessage") {
    return Object.values(record).some(containsExactIdleMarker);
  }
  return Object.entries(record)
    .filter(([key]) => key === "thread" || key === "turns" || key === "items" || key === "data" || key === "result")
    .some(([, nested]) => containsTerminalAssistantMarker(nested));
}

function containsExactIdleMarker(value: unknown): boolean {
  if (typeof value === "string") return value.trim() === "LCO_IDLE_OK";
  if (Array.isArray(value)) return value.some(containsExactIdleMarker);
  const record = asRecord(value);
  return record ? Object.values(record).some(containsExactIdleMarker) : false;
}

function routeReason(record: StructuredResult): string {
  return firstReason(record, "route_not_selected");
}

function firstReason(record: StructuredResult, fallback: string): string {
  const reasons = Array.isArray(record.reason_codes) ? record.reason_codes : [];
  return typeof reasons[0] === "string" ? reasons[0] : fallback;
}

function isOpaqueTarget(value: string): boolean {
  return /^[A-Za-z0-9._:-]{8,160}$/.test(value) && !value.includes("/") && !value.includes("\\");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function normalizeStages(stages: EvaIdleRouteStage[]): EvaIdleRouteStage[] {
  return stages.map((stage) => ({ ...stage, elapsedMs: Math.max(0, Math.round(stage.elapsedMs)), errorClass: stage.errorClass ? sanitizeErrorClass(stage.errorClass) : null }));
}

function sanitizeErrorClass(error: unknown): string {
  const code = error instanceof EvaIdleRouteError ? error.code : error instanceof Error ? error.name : "runtime_error";
  return code.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "runtime_error";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requireRecord(value: unknown): StructuredResult {
  const record = asRecord(value);
  if (!record) throw new EvaIdleRouteError("mcp_response_invalid");
  return record;
}

function asRecord(value: unknown): StructuredResult | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as StructuredResult : null;
}

function modeIs(path: string, mode: number): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && (stat.mode & 0o777) === mode;
  } catch {
    return false;
  }
}

function regularMode600(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && (stat.mode & 0o777) === 0o600;
  } catch {
    return false;
  }
}

function containsForbiddenReceiptFields(serialized: string): boolean {
  try {
    return hasForbiddenKey(JSON.parse(serialized));
  } catch {
    return true;
  }
}

function hasForbiddenKey(value: unknown): boolean {
  const forbidden = new Set([
    "raw_thread_id", "raw_task_id", "approval_audit_id", "thread_id", "target_ref",
    "message", "audit_path", "raw_prompt", "transcript", "credential", "secret",
    "token", "cookie", "sqlite", "jsonl", "audit_record", "configuration"
  ]);
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  const record = asRecord(value);
  if (!record) return false;
  return Object.entries(record).some(([key, nested]) => forbidden.has(key.toLowerCase()) || hasForbiddenKey(nested));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function writeFileSyncSafe(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
}
