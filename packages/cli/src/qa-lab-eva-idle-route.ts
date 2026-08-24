import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, ftruncateSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  packageTarball?: string;
  /** @internal focused-test seam; production pins the immutable tarball digests. */
  expectedPackageIntegrity?: string;
  /** @internal focused-test seam; production pins the immutable tarball shasum. */
  expectedPackageShasum?: string;
  /** @internal focused-test seam; production uses the 30-second initialize/list budget. */
  initializeListTimeoutMs?: number;
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
    packageTarballSha512: string | null;
    packageTarballShasum: string | null;
    packageManifestSha256: string | null;
    installedManifestSha256: string | null;
    manifestMatchVerified: boolean;
  };
  harness_source_sha256: string | null;
  harness_source_head_sha256: string | null;
  harness_source_matches_head: boolean;
  executing_cli_sha256: string | null;
  executing_harness_sha256: string | null;
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
  packageTarballSha512: string | null;
  packageTarballShasum: string | null;
  packageManifestSha256: string | null;
  installedManifestSha256: string | null;
  manifestMatchVerified: boolean;
};

type PackageInspection = { identity: PackageIdentity; snapshotOwnerRoot: string | null; snapshotMcpBin: string | null };

type HarnessProvenance = {
  head: string;
  sourceSha256: string | null;
  sourceHeadSha256: string | null;
  sourceMatchesHead: boolean;
  cliSha256: string | null;
  harnessSha256: string | null;
};

type StageResult<T> = { value: T; stage: EvaIdleRouteStage };
type ReceiptReservation = { fd: number };

export async function runEvaIdleRoute(options: EvaIdleRouteOptions): Promise<EvaIdleRouteReport> {
  const execute = options.execute === true;
  const receiptReservation = execute ? reserveEvaIdleRouteReport(options.evidenceDir) : null;
  if (!execute) mkdirSync(options.evidenceDir, { recursive: true });
  const generatedAt = options.now ?? new Date().toISOString();
  const startedAt = process.hrtime.bigint();
  const completionBudgetMs = options.completionTimeoutMs ?? DEFAULT_STAGE_TIMEOUTS.completionMs;
  const outerAcceptanceDeadline = execute ? Date.now() + completionBudgetMs : null;
  const initializeListDeadline = execute ? Date.now() + (options.initializeListTimeoutMs ?? DEFAULT_STAGE_TIMEOUTS.initializeMs) : null;
  const stages: EvaIdleRouteStage[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (options.packageVersion !== EVA_IDLE_ROUTE_PACKAGE_VERSION) blockers.push("candidate_package_version_unsupported");
  if (options.candidateSha !== EVA_IDLE_ROUTE_CANDIDATE_SHA) blockers.push("candidate_sha_mismatch");
  const inspection = inspectPackageIdentity(
    options.mcpBin,
    options.packageVersion,
    options.execute ? options.packageTarball : undefined,
    options.expectedMcpBinarySha256 ?? EVA_IDLE_ROUTE_MCP_BINARY_SHA256,
    options.expectedPackageIntegrity ?? EVA_IDLE_ROUTE_PACKAGE_INTEGRITY,
    options.expectedPackageShasum ?? EVA_IDLE_ROUTE_PACKAGE_SHASUM,
    blockers
  );
  const identity = inspection.identity;
  let snapshotOwnerRoot = inspection.snapshotOwnerRoot;
  const snapshotMcpBin = inspection.snapshotMcpBin;
  if (execute && !options.packageTarball) blockers.push("package_tarball_required");
  const provenance = readHarnessProvenance(options.repoRoot ?? resolveHarnessRepoRoot(), blockers);
  const harnessHead = provenance.head;
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
      if (snapshotOwnerRoot) rmSync(snapshotOwnerRoot, { recursive: true, force: true });
      stages.push({ name: "identity_preflight", status: "blocked", elapsedMs: 0, errorClass: blockers[0] ?? "identity_preflight_failed" });
      throw new EvaIdleRouteError("identity_preflight_failed");
    }
    const subject = await runStage(stages, "mcp_initialize", async () => {
      const runtime = execute ? createRuntimeRoot() : null;
      runtimeRoot = runtime;
      audit = execute ? createAuditBoundary() : emptyAuditBoundary();
      session = await PersistentMcpSession.start({
        mcpBin: snapshotMcpBin ?? options.mcpBin,
        expectedVersion: options.packageVersion,
        timeoutMs: Math.max(1, (initializeListDeadline ?? Date.now() + DEFAULT_STAGE_TIMEOUTS.initializeMs) - Date.now()),
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
        const listDeadline = initializeListDeadline ?? Date.now() + DEFAULT_STAGE_TIMEOUTS.initializeMs;
        if (Date.now() >= listDeadline) throw new EvaIdleRouteError("mcp_initialize_list_deadline_exceeded");
        const result = await subject.value!.request("tools/list", {}, Math.max(1, listDeadline - Date.now()));
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
        requireDeadlineOpen(outerAcceptanceDeadline);
        setupClient = await (options.setupClientFactory ?? createDaemonSetupClient)();
        const threadId = await setupClient.startThread();
        taskCreated = true;
        await setupClient.nameThread(threadId, title!);
        return { threadId };
      }, blockers, "task_setup_failed");

      if (setup.stage.status === "passed" && setup.value) {
        const route = await runStage(stages, "route", async () => {
          requireDeadlineOpen(outerAcceptanceDeadline);
          const result = await session!.request("tools/call", {
            name: "lco_codex_control_route",
            arguments: { hint: title }
          }, DEFAULT_STAGE_TIMEOUTS.routeMs);
          const record = requireStructured(result);
          if (record.status !== "selected" || record.route !== "app_server") throw new EvaIdleRouteError(routeReason(record));
          if (record.state !== "idle" || !arrayIncludes(record.supported_actions, "send")) {
            throw new EvaIdleRouteError("idle_send_route_required");
          }
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
            requireDeadlineOpen(outerAcceptanceDeadline);
            const result = await session!.request("tools/call", {
              name: "lco_codex_deliver",
              arguments: { target_ref: routeTarget, message: EVA_IDLE_ROUTE_MESSAGE, dry_run: true }
            }, DEFAULT_STAGE_TIMEOUTS.deliverMs);
            const record = requireStructured(result);
            if (record.live !== false || record.control_sent !== false || record.status !== "dry_run_ready") throw new EvaIdleRouteError("generic_dry_run_rejected");
            if (record.action !== "send") throw new EvaIdleRouteError("idle_send_action_required");
            const approvalId = stringValue(record.approval_audit_id);
            if (!approvalId) throw new EvaIdleRouteError("approval_missing");
            const paramsHash = stringValue(record.params_hash);
            const messageHash = stringValue(record.message_hash);
            if (!paramsHash || !messageHash) throw new EvaIdleRouteError("approval_hash_missing");
            if (!isCanonicalSha256(paramsHash) || !isCanonicalSha256(messageHash)) throw new EvaIdleRouteError("approval_hash_invalid");
            const targetRef = stringValue(record.target_ref);
            if (!targetRef || targetRef !== routeTarget) throw new EvaIdleRouteError("target_drift");
            return { approvalId, paramsHash, messageHash, targetHash: sha256(targetRef) };
          }, blockers, "deliver_dry_run_failed");
          if (dry.stage.status === "passed" && dry.value) {
            dryTargetHash = dry.value.targetHash;
            dryMessageHash = dry.value.messageHash;
            dryParamsHash = dry.value.paramsHash;
            const live = await runStage(stages, "deliver_live", async () => {
              requireDeadlineOpen(outerAcceptanceDeadline);
              const remainingLiveMs = outerAcceptanceDeadline! - Date.now();
              const result = await session!.request("tools/call", {
                name: "lco_codex_deliver",
                arguments: {
                  target_ref: routeTarget,
                  message: EVA_IDLE_ROUTE_MESSAGE,
                  dry_run: false,
                  approval_audit_id: dry.value!.approvalId
                }
              }, Math.min(DEFAULT_STAGE_TIMEOUTS.deliverMs, remainingLiveMs));
              requireDeadlineOpen(outerAcceptanceDeadline);
              const record = requireStructured(result);
              if (record.live !== true || record.control_sent !== true) {
                throw new EvaIdleRouteError(firstReason(record, "approval_or_control_rejected"));
              }
              if (record.status !== "accepted") throw new EvaIdleRouteError("live_delivery_status_invalid");
              if (record.action !== "send") throw new EvaIdleRouteError("idle_send_action_required");
              if (stringValue(record.approval_audit_id) !== dry.value!.approvalId) throw new EvaIdleRouteError("approval_binding_mismatch");
              const paramsHash = stringValue(record.params_hash);
              const messageHash = stringValue(record.message_hash);
              if (!paramsHash || !messageHash || !isCanonicalSha256(paramsHash) || !isCanonicalSha256(messageHash)) throw new EvaIdleRouteError("approval_hash_invalid");
              if (stringValue(record.target_ref) !== routeTarget) throw new EvaIdleRouteError("target_drift");
              if (paramsHash !== dry.value!.paramsHash || messageHash !== dry.value!.messageHash) {
                throw new EvaIdleRouteError("approval_hash_mismatch");
              }
              return {
                record,
                paramsHash,
                messageHash
              };
            }, blockers, "deliver_live_failed");
            if (live.stage.status === "passed") {
              accepted = true;
              approvalBindingVerified = true;
              liveTargetHash = routeHash;
              liveMessageHash = live.value!.messageHash;
              liveParamsHash = live.value!.paramsHash;
              const completion = await runStage(stages, "completion_probe", async () => {
                const deadline = outerAcceptanceDeadline!;
                if (Date.now() >= deadline) throw new EvaIdleRouteError("completion_deadline_exceeded");
                while (Date.now() < deadline) {
                  if (await readCompletionWithinDeadline(setupClient!, setup.value!.threadId, deadline)) return true;
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
    if (finalSession) {
      try {
        if (!(await finalSession.close())) blockers.push("mcp_process_exit_unconfirmed");
      } catch {
        blockers.push("mcp_process_exit_unconfirmed");
      }
    }
    if (snapshotOwnerRoot) {
      if (blockers.includes("mcp_process_exit_unconfirmed")) blockers.push("package_snapshot_retained");
      else {
        try { rmSync(snapshotOwnerRoot, { recursive: true, force: true }); snapshotOwnerRoot = null; }
        catch { blockers.push("package_snapshot_cleanup_failed"); }
      }
    }
    if (runtimeRoot) {
      if (blockers.includes("mcp_process_exit_unconfirmed")) blockers.push("runtime_root_retained");
      else {
        try {
          rmSync(runtimeRoot, { recursive: true, force: true });
        } catch {
          blockers.push("runtime_cleanup_failed");
        }
      }
    }
    audit = finalizeAuditBoundary(audit, !blockers.includes("mcp_process_exit_unconfirmed"));
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
    harness_source_sha256: provenance.sourceSha256,
    harness_source_head_sha256: provenance.sourceHeadSha256,
    harness_source_matches_head: provenance.sourceMatchesHead,
    executing_cli_sha256: provenance.cliSha256,
    executing_harness_sha256: provenance.harnessSha256,
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
    proofBoundary: "This public-safe operator-only candidate harness proves only the named disposable Eva idle route, opaque dry-run/live acceptance, and bounded read-only completion marker when those stages pass. Declared external dependency artifacts remain outside the package-owned integrity claim. It does not prove Eva runtime safety, Hermes handler/lock/dispatch health, release publication, customer readiness, fleet readiness, or any live action beyond this one disposable task.",
    nextSafeCommands: [
      `LCO_CODEX_TRANSPORT=daemon lco qa-lab eva-idle-route --evidence-dir <path> --mcp-bin <exact-package-bin> --package-tarball <canonical-1.7.0.tgz> --package-version ${options.packageVersion} --candidate-sha ${options.candidateSha} [--execute] [--strict]`
    ]
  };
  try {
    if (receiptReservation) writeReservedEvaIdleRouteReport(report, receiptReservation);
    else writeEvaIdleRouteReport(report, options.evidenceDir);
  } finally {
    if (receiptReservation) closeSync(receiptReservation.fd);
  }
  return report;
}

function reserveEvaIdleRouteReport(evidenceDir: string): ReceiptReservation {
  try {
    mkdirSync(evidenceDir, { recursive: true });
    const outputPath = join(evidenceDir, "eva-idle-route.json");
    return { fd: openSync(outputPath, "wx", 0o600) };
  } catch {
    throw new EvaIdleRouteError("evidence_destination_unavailable");
  }
}

function writeReservedEvaIdleRouteReport(report: EvaIdleRouteReport, reservation: ReceiptReservation): void {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (containsForbiddenReceiptFields(serialized)) throw new Error("eva_idle_route_forbidden_fields_detected");
  ftruncateSync(reservation.fd, 0);
  writeFileSync(reservation.fd, serialized);
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
  private childClosed = false;

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly expectedVersion: string,
    private readonly timeoutMs: number
  ) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consume(chunk));
    child.stderr.resume();
    child.stdin.on("error", () => this.failPending("mcp_write_failed"));
    child.on("error", () => this.failPending("mcp_process_error"));
    child.on("close", () => {
      this.childClosed = true;
      this.failPending("mcp_process_closed");
    });
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
      if (!(await session.close())) throw new EvaIdleRouteError("mcp_process_exit_unconfirmed");
      throw error;
    }
  }

  request(method: string, params: Record<string, unknown>, timeoutMs = this.timeoutMs): Promise<unknown> {
    return this.send(method, params, true, timeoutMs);
  }

  notification(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.send(method, params, false, this.timeoutMs);
  }

  async close(): Promise<boolean> {
    let exitConfirmed = this.childClosed;
    if (!exitConfirmed) {
      this.child.kill("SIGTERM");
      exitConfirmed = await this.waitForClose(250);
      if (!exitConfirmed) {
        this.child.kill("SIGKILL");
        exitConfirmed = await this.waitForClose(1_000);
      }
    }
    this.failPending("mcp_session_closed");
    return exitConfirmed;
  }

  private async waitForClose(timeoutMs: number): Promise<boolean> {
    if (this.childClosed) return true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (confirmed: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.child.off("close", onClose);
        resolve(confirmed);
      };
      const onClose = () => finish(true);
      const timer = setTimeout(() => finish(this.childClosed), timeoutMs);
      this.child.once("close", onClose);
      if (this.childClosed) finish(true);
    });
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

function finalizeAuditBoundary(audit: AuditBoundary, allowCleanup = true): AuditBoundary {
  if (!audit.rootPath || !audit.auditPath) return audit;
  const jsonl = regularMode600(audit.auditPath);
  const key = regularMode600(`${audit.auditPath}.key`);
  const directoryMode700 = modeIs(audit.rootPath, 0o700);
  const safeToDelete = allowCleanup && directoryMode700 && jsonl && key;
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

function inspectPackageIdentity(mcpBin: string, expectedVersion: string, packageTarball: string | undefined, expectedBinarySha256: string, expectedIntegrity: string, expectedShasum: string, blockers: string[]): PackageInspection {
  let mcpBinarySha256: string | null = null;
  let packageRoot: string | null = null;
  let snapshotOwnerRoot: string | null = null;
  let snapshotMcpBin: string | null = null;
  let snapshot: VerifiedPackageSnapshot | null = null;
  let mcpBinaryHashVerified = false;
  let immutablePrefixVerified = false;
  let packageTarballSha512: string | null = null;
  let packageTarballShasum: string | null = null;
  let packageManifestSha256: string | null = null;
  let installedManifestSha256: string | null = null;
  let manifestMatchVerified = false;
  try {
    if (!lstatSync(mcpBin).isFile()) throw new EvaIdleRouteError("mcp_binary_not_regular");
    const resolvedBin = realpathSync(mcpBin);
    mcpBinarySha256 = sha256(readFileSync(resolvedBin));
    mcpBinaryHashVerified = mcpBinarySha256 === expectedBinarySha256;
    packageRoot = findSupportedPackageRoot(dirname(resolvedBin));
    immutablePrefixVerified = Boolean(packageRoot && pathInside(packageRoot, resolvedBin) && resolvedBin.includes(EVA_IDLE_ROUTE_PREFIX_MARKER));
    if (packageTarball) {
      snapshot = verifyPackageTarball(packageTarball, expectedIntegrity, expectedShasum, blockers);
      snapshotOwnerRoot = snapshot.ownerRoot;
      packageTarballSha512 = snapshot.sha512;
      packageTarballShasum = snapshot.shasum;
      if (packageRoot) {
          const installed = readPackageManifest(packageRoot);
          const packaged = readPackageManifest(snapshot.root);
          installedManifestSha256 = installed.digest;
          packageManifestSha256 = packaged.digest;
          manifestMatchVerified = comparePackageManifests(installed.entries, packaged.entries);
          if (!manifestMatchVerified) blockers.push("package_manifest_mismatch");
          const relativeBin = relativePackagePath(packageRoot, resolvedBin);
          if (!relativeBin || !packaged.entries.has(relativeBin) || packaged.entries.get(relativeBin)?.type !== "file") blockers.push("mcp_binary_not_in_package_manifest");
          if (manifestMatchVerified && relativeBin) {
            snapshotMcpBin = join(snapshot.root, relativeBin);
            mcpBinarySha256 = sha256(readFileSync(snapshotMcpBin));
            mcpBinaryHashVerified = mcpBinarySha256 === expectedBinarySha256;
            if (!mcpBinaryHashVerified) blockers.push("subject_mcp_binary_hash_mismatch");
            linkSnapshotDependencies(snapshot.root, packageRoot, blockers);
          }
        }
        if (!manifestMatchVerified) immutablePrefixVerified = false;
      }
  } catch (error) {
    if (snapshot) rmSync(snapshot.ownerRoot, { recursive: true, force: true });
    snapshotOwnerRoot = null;
    snapshotMcpBin = null;
    blockers.push(sanitizeErrorClass(error) || "mcp_binary_unavailable");
  }
  const packageVersion = packageRoot ? readPackageVersionFromRoots([packageRoot]) : null;
  const packageName = packageRoot ? packageNameForRoot(packageRoot) : null;
  if (!packageRoot) blockers.push("subject_package_root_unavailable");
  if (!mcpBinaryHashVerified) blockers.push("subject_mcp_binary_hash_mismatch");
  if (!immutablePrefixVerified) blockers.push("subject_immutable_prefix_mismatch");
  if (packageName !== CANONICAL_PACKAGE_NAME) blockers.push("subject_package_name_mismatch");
  if (packageVersion !== expectedVersion) blockers.push("subject_package_version_mismatch");
  const isRelease = packageName === CANONICAL_PACKAGE_NAME && packageVersion === EVA_IDLE_ROUTE_PACKAGE_VERSION && manifestMatchVerified;
  return { identity: {
    packageName,
    packageVersion,
    packageIntegrity: isRelease ? packageTarballSha512 : null,
    packageShasum: isRelease ? packageTarballShasum : null,
    mcpBinarySha256,
    mcpBinaryHashVerified,
    immutablePrefixVerified,
    packageTarballSha512,
    packageTarballShasum,
    packageManifestSha256,
    installedManifestSha256,
    manifestMatchVerified
  }, snapshotOwnerRoot, snapshotMcpBin };
}

type PackageManifestEntry = { type: "file" | "directory"; sha256: string | null };
type VerifiedPackageSnapshot = { sha512: string; shasum: string; ownerRoot: string; root: string };

function verifyPackageTarball(path: string, expectedIntegrity: string, expectedShasum: string, blockers: string[]): VerifiedPackageSnapshot {
  if (path.startsWith("-")) throw new EvaIdleRouteError("package_tarball_path_invalid");
  if (!lstatSync(path).isFile()) throw new EvaIdleRouteError("package_tarball_not_regular");
  const bytes = readFileSync(path);
  const sha512 = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const shasum = createHash("sha1").update(bytes).digest("hex");
  if (sha512 !== expectedIntegrity) blockers.push("package_tarball_integrity_mismatch");
  if (shasum !== expectedShasum) blockers.push("package_tarball_shasum_mismatch");
  if (sha512 !== expectedIntegrity || shasum !== expectedShasum) throw new EvaIdleRouteError("package_tarball_digest_mismatch");
  const ownerRoot = mkdtempSync(join(tmpdir(), "lco-eva-idle-package-"));
  chmodSync(ownerRoot, 0o700);
  const archive = join(ownerRoot, "package.tgz");
  writeFileSync(archive, bytes, { mode: 0o600, flag: "wx" });
  try {
    const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).filter(Boolean);
    if (!listing.length || listing.some((entry) => !/^package(?:\/|$)/.test(entry) || entry.startsWith("/") || entry.split("/").includes(".."))) throw new EvaIdleRouteError("package_tarball_layout_invalid");
    const detailed = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).filter(Boolean);
    if (detailed.some((entry) => !/^[\-d]/.test(entry))) throw new EvaIdleRouteError("package_tarball_entry_type_invalid");
    const extractRoot = join(ownerRoot, "extract");
    mkdirSync(extractRoot, { mode: 0o700 });
    execFileSync("tar", ["-xzf", archive, "-C", extractRoot], { timeout: 10_000, stdio: ["ignore", "ignore", "ignore"] });
    const packageRoot = join(extractRoot, "package");
    if (!lstatSync(packageRoot).isDirectory()) throw new EvaIdleRouteError("package_tarball_root_missing");
    return { sha512, shasum, ownerRoot, root: packageRoot };
  } catch (error) {
    rmSync(ownerRoot, { recursive: true, force: true });
    throw error;
  }
}

function linkSnapshotDependencies(snapshotRoot: string, installedRoot: string, blockers: string[]): void {
  let dependencies: Record<string, unknown> = {};
  try { dependencies = JSON.parse(readFileSync(join(snapshotRoot, "package.json"), "utf8")).dependencies ?? {}; }
  catch { blockers.push("package_dependency_manifest_invalid"); return; }
  const destination = join(snapshotRoot, "node_modules");
  for (const name of Object.keys(dependencies)) {
    if (name.startsWith("/") || name.split("/").includes("..")) { blockers.push("package_dependency_name_invalid"); continue; }
    const source = findInstalledDependency(installedRoot, name);
    if (!source) { blockers.push("package_dependency_unavailable"); continue; }
    const link = join(destination, name);
    mkdirSync(dirname(link), { recursive: true, mode: 0o700 });
    symlinkSync(source, link, "junction");
  }
}

function findInstalledDependency(root: string, name: string): string | null {
  for (let current = root;; current = dirname(current)) {
    const candidate = join(current, "node_modules", name);
    try { if (lstatSync(candidate).isDirectory()) return realpathSync(candidate); } catch { /* continue upward */ }
    const parent = dirname(current);
    if (parent === current) return null;
  }
}

function readPackageManifest(root: string): { digest: string; entries: Map<string, PackageManifestEntry> } {
  const entries = new Map<string, PackageManifestEntry>();
  const walk = (current: string, relative = "") => {
    for (const name of readdirNames(current)) {
      const child = join(current, name);
      const childRelative = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(child);
      if (stat.isSymbolicLink()) throw new EvaIdleRouteError("package_manifest_symlink");
      if (stat.isDirectory()) {
        entries.set(childRelative, { type: "directory", sha256: null });
        walk(child, childRelative);
      } else if (stat.isFile()) entries.set(childRelative, { type: "file", sha256: sha256(readFileSync(child)) });
      else throw new EvaIdleRouteError("package_manifest_nonregular");
    }
  };
  walk(root);
  const canonical = [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([path, value]) => [path, value.type, value.sha256]);
  return { digest: sha256(JSON.stringify(canonical)), entries };
}

function readdirNames(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).map((entry) => entry.name).sort();
}

function comparePackageManifests(left: Map<string, PackageManifestEntry>, right: Map<string, PackageManifestEntry>): boolean {
  if (left.size !== right.size) return false;
  for (const [path, value] of left) if (JSON.stringify(value) !== JSON.stringify(right.get(path))) return false;
  return true;
}

function relativePackagePath(root: string, path: string): string | null {
  const value = relative(root, path);
  return pathInside(root, path) ? value : null;
}

function pathInside(root: string, path: string): boolean {
  const candidate = relative(resolve(root), resolve(path));
  return candidate.length > 0 && !candidate.startsWith("..") && !isAbsolute(candidate);
}

function readHarnessProvenance(repoRoot: string, blockers: string[]): HarnessProvenance {
  let head = "unknown";
  let sourceSha256: string | null = null;
  let sourceHeadSha256: string | null = null;
  let sourceMatchesHead = false;
  let cliSha256: string | null = null;
  let harnessSha256: string | null = null;
  try {
    const resolvedRoot = realpathSync(repoRoot);
    const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: resolvedRoot, encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (realpathSync(topLevel) !== resolvedRoot) throw new EvaIdleRouteError("harness_repo_root_mismatch");
    head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: resolvedRoot, encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!/^[0-9a-f]{40}$/.test(head)) throw new EvaIdleRouteError("harness_repo_head_unavailable");
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: resolvedRoot, encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (dirty) blockers.push("harness_checkout_dirty");
    const relativeSource = "packages/cli/src/qa-lab-eva-idle-route.ts";
    execFileSync("git", ["ls-files", "--error-unmatch", relativeSource], { cwd: resolvedRoot, encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] });
    const sourcePath = join(resolvedRoot, relativeSource);
    sourceSha256 = sha256(readFileSync(sourcePath));
    sourceHeadSha256 = sha256(execFileSync("git", ["show", `HEAD:${relativeSource}`], { cwd: resolvedRoot, timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }));
    sourceMatchesHead = sourceSha256 === sourceHeadSha256;
    if (!sourceMatchesHead) blockers.push("harness_source_head_mismatch");
  } catch (error) {
    blockers.push(error instanceof EvaIdleRouteError ? sanitizeErrorClass(error) : "harness_provenance_unavailable");
  }
  harnessSha256 = hashRegularFile(fileURLToPath(import.meta.url));
  cliSha256 = process.argv[1] ? hashRegularFile(process.argv[1]) : null;
  if (!harnessSha256 || !cliSha256) blockers.push("harness_build_hash_unavailable");
  return { head, sourceSha256, sourceHeadSha256, sourceMatchesHead, cliSha256, harnessSha256 };
}

function hashRegularFile(path: string): string | null {
  try {
    const resolved = realpathSync(path);
    if (!lstatSync(resolved).isFile()) return null;
    return sha256(readFileSync(resolved));
  } catch {
    return null;
  }
}

function resolveHarnessRepoRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(moduleDir, "../../../.."), resolve(moduleDir, "../../..")];
  for (const candidate of candidates) {
    try {
      const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: candidate, encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (realpathSync(topLevel) === realpathSync(candidate)) return candidate;
    } catch {
      // Try the source-tree or compiled-tree layout next.
    }
  }
  return moduleDir;
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
  const record = asRecord(value);
  if (!record) return false;
  const thread = asRecord(record.thread) ?? asRecord(asRecord(record.result)?.thread);
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  return turns.some((turnValue) => {
    const turn = asRecord(turnValue);
    if (turn?.status !== "completed") return false;
    const items = Array.isArray(turn.items) ? turn.items : [];
    return items.some(containsAssistantMarker);
  });
}

function containsAssistantMarker(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsAssistantMarker);
  const record = asRecord(value);
  if (!record) return false;
  const type = stringValue(record.type)?.replace(/[^a-z]/gi, "").toLowerCase();
  const role = stringValue(record.role)?.toLowerCase();
  if (role === "assistant" || type === "agentmessage" || type === "assistantmessage") {
    return Object.values(record).some(containsExactIdleMarker);
  }
  return Object.entries(record)
    .filter(([key]) => key === "items" || key === "content" || key === "data" || key === "result")
    .some(([, nested]) => containsAssistantMarker(nested));
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

function arrayIncludes(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.includes(expected);
}

function requireDeadlineOpen(deadline: number | null): void {
  if (deadline !== null && Date.now() >= deadline) throw new EvaIdleRouteError("outer_deadline_exceeded");
}

async function readCompletionWithinDeadline(client: EvaIdleRouteSetupClient, threadId: string, deadline: number): Promise<boolean> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new EvaIdleRouteError("completion_deadline_exceeded");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      client.completionObserved(threadId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new EvaIdleRouteError("completion_deadline_exceeded")), remaining);
      })
    ]);
    if (Date.now() >= deadline) throw new EvaIdleRouteError("completion_deadline_exceeded");
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isOpaqueTarget(value: string): boolean {
  return /^[A-Za-z0-9._:-]{8,160}$/.test(value) && !value.includes("/") && !value.includes("\\");
}

function isCanonicalSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
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
