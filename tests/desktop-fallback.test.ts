import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuditStore, createCodexDesktopFallbackReport, createDesktopGuiProofReport, createDesktopLiveProofHarness, createDesktopProofAction, writeDesktopLiveProofHarness, writeDesktopProofAction, desktopSee } from "../packages/adapters/src/index.js";
import { createDatabase } from "../packages/core/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";

function proofActionFixture(scratchFilePath: string) {
  const action = "launch_app TextEdit scratch window";
  const targetApp = "TextEdit";
  const targetWindow = "lco-desktop-proof.txt";
  const approvalRef = "issue-160-proof-action";
  const actionHash = createHash("sha256")
    .update(JSON.stringify({
      desktopBackend: "cua-driver",
      targetApp,
      targetWindow,
      action
    }))
    .digest("hex");
  const approvalArtifact = {
    kind: "loo_desktop_proof_action_approval",
    approved: true,
    approvalRef,
    desktopBackend: "cua-driver",
    targetApp,
    targetWindow,
    action,
    actionHash,
    scratchFilePathHash: createHash("sha256").update(scratchFilePath).digest("hex"),
    issuedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z"
  };
  return { action, targetApp, targetWindow, approvalRef, actionHash, approvalArtifact, scratchFilePath };
}

function withDesktopProofScratchRoot<T>(root: string, fn: () => T): T {
  const previousRoot = process.env.LOO_DESKTOP_PROOF_SCRATCH_ROOT;
  const previousSecret = process.env.LOO_DESKTOP_PROOF_APPROVAL_SECRET;
  process.env.LOO_DESKTOP_PROOF_SCRATCH_ROOT = root;
  process.env.LOO_DESKTOP_PROOF_APPROVAL_SECRET = "test-proof-approval-secret";
  try {
    return fn();
  } finally {
    if (previousRoot === undefined) {
      delete process.env.LOO_DESKTOP_PROOF_SCRATCH_ROOT;
    } else {
      process.env.LOO_DESKTOP_PROOF_SCRATCH_ROOT = previousRoot;
    }
    if (previousSecret === undefined) {
      delete process.env.LOO_DESKTOP_PROOF_APPROVAL_SECRET;
    } else {
      process.env.LOO_DESKTOP_PROOF_APPROVAL_SECRET = previousSecret;
    }
  }
}

function withDesktopProofScratchRootAndKeyPath<T>(root: string, keyPath: string, fn: () => T): T {
  const previousRoot = process.env.LOO_DESKTOP_PROOF_SCRATCH_ROOT;
  const previousSecret = process.env.LOO_DESKTOP_PROOF_APPROVAL_SECRET;
  const previousKeyPath = process.env.LOO_DESKTOP_PROOF_APPROVAL_KEY_PATH;
  process.env.LOO_DESKTOP_PROOF_SCRATCH_ROOT = root;
  process.env.LOO_DESKTOP_PROOF_APPROVAL_KEY_PATH = keyPath;
  delete process.env.LOO_DESKTOP_PROOF_APPROVAL_SECRET;
  try {
    return fn();
  } finally {
    if (previousRoot === undefined) {
      delete process.env.LOO_DESKTOP_PROOF_SCRATCH_ROOT;
    } else {
      process.env.LOO_DESKTOP_PROOF_SCRATCH_ROOT = previousRoot;
    }
    if (previousSecret === undefined) {
      delete process.env.LOO_DESKTOP_PROOF_APPROVAL_SECRET;
    } else {
      process.env.LOO_DESKTOP_PROOF_APPROVAL_SECRET = previousSecret;
    }
    if (previousKeyPath === undefined) {
      delete process.env.LOO_DESKTOP_PROOF_APPROVAL_KEY_PATH;
    } else {
      process.env.LOO_DESKTOP_PROOF_APPROVAL_KEY_PATH = previousKeyPath;
    }
  }
}

function signedProofActionFixture(scratchRoot: string, scratchFilePath = join(scratchRoot, "lco-desktop-proof.txt")) {
  writeFileSync(scratchFilePath, "LOO desktop proof scratch fixture\n");
  return withDesktopProofScratchRoot(scratchRoot, () => {
    const base = proofActionFixture(scratchFilePath);
    const harness = createDesktopLiveProofHarness({
      backend: "cua-driver",
      targetApp: base.targetApp,
      targetWindow: base.targetWindow,
      action: base.action,
      approvalRef: base.approvalRef,
      scratchFilePath,
      probe: {
        commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
        activeApplication: () => "Codex"
      }
    });
    assert.equal(harness.proofHarnessReady, true);
    assert.ok(harness.approvalArtifact);
    return { ...base, approvalArtifact: harness.approvalArtifact };
  });
}

test("CUA desktop diagnostics report command, permissions, limitations, and focus observation without acting", async () => {
  const status = await desktopSee({
    backend: "cua-driver",
    probe: {
      commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.1.0" }),
      activeApplication: () => "Codex"
    }
  });

  assert.equal(status.backend, "cua-driver");
  assert.equal(status.available, true);
  assert.deepEqual(status.launch, {
    command: "cua-driver",
    args: ["mcp"],
    transport: "stdio",
    readiness: {
      status: "not_probed",
      note: "Binary status probe succeeded; stdio launch readiness is not probed because starting the backend would run a GUI-control server."
    }
  });
  assert.equal(status.permissions.accessibility.status, "unknown");
  assert.equal(status.permissions.screenRecording.status, "unknown");
  assert.equal(status.focus.beforeApplication, "Codex");
  assert.equal(status.focus.afterApplication, "Codex");
  assert.equal(status.focus.changed, false);
  assert.equal(status.focus.proof, "status_probe_only_no_action");
  assert.equal(status.dryRunOnly, true);
  assert.equal(status.backgroundSafeClaim, "not_proven");
  assert.ok(status.limitations.some((limitation) => limitation.includes("no-focus")));
});

test("CUA desktop diagnostics force telemetry opt-out on subprocess probes", async () => {
  let observedEnv: Record<string, string> | undefined;
  await desktopSee({
    backend: "cua-driver",
    probe: {
      commandStatus: (_command, _args, options) => {
        observedEnv = options?.env;
        return { available: true, command: "cua-driver", version: "cua-driver 0.6.8" };
      },
      activeApplication: () => "Codex"
    }
  });

  assert.equal(observedEnv?.CUA_DRIVER_RS_TELEMETRY_ENABLED, "0");
});

test("CUA focus proof covers the status command probe itself", async () => {
  let activeApplication = "Codex";
  const status = await desktopSee({
    backend: "cua-driver",
    probe: {
      commandStatus: () => {
        activeApplication = "Terminal";
        return { available: true, command: "cua-driver", version: "cua-driver 0.1.0" };
      },
      activeApplication: () => activeApplication
    }
  });

  assert.equal(status.focus.beforeApplication, "Codex");
  assert.equal(status.focus.afterApplication, "Terminal");
  assert.equal(status.focus.changed, true);
  assert.equal(status.focus.proof, "status_probe_only_no_action");
});

test("system desktop probe redacts command output and spawn errors", async () => {
  const previous = process.env.LOO_CUA_DRIVER_BIN;
  process.env.LOO_CUA_DRIVER_BIN = "/Users/lume/private-sk-test_1234567890/missing-cua-driver";
  try {
    const status = await desktopSee({ backend: "cua-driver" });

    assert.equal(status.available, false);
    assert.equal(status.launch.command.includes("/Users/lume"), false);
    assert.equal(status.launch.command.includes("sk-test_1234567890"), false);
    assert.equal(status.error?.includes("/Users/lume"), false);
    assert.equal(status.error?.includes("sk-test_1234567890"), false);
  } finally {
    if (previous === undefined) {
      delete process.env.LOO_CUA_DRIVER_BIN;
    } else {
      process.env.LOO_CUA_DRIVER_BIN = previous;
    }
  }
});

test("CLI desktop act defaults backend when the action starts immediately", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "packages/cli/src/index.ts", "desktop", "act", "click", "primary"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as { backend: string; action: string; live: boolean; dryRunOnly: boolean };
  assert.equal(parsed.backend, "direct");
  assert.equal(parsed.action, "click primary");
  assert.equal(parsed.live, false);
  assert.equal(parsed.dryRunOnly, true);
});

test("CLI desktop proof-report writes a release-compatible approval fixture for a valid live no-focus observation", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-proof-"));
  const observationPath = join(root, "desktop-gui-observation.json");
  writeFileSync(observationPath, `${JSON.stringify({
    kind: "loo_desktop_gui_action_observation",
    desktopBackend: "cua-driver",
    targetApp: "Codex",
    targetWindow: "Lossless OpenClaw Orchestrator",
    action: "focus-safe noop",
    approvalRef: "issue-117-local-fixture",
    approved: true,
    liveActionObserved: true,
    focusBeforeApplication: "Codex",
    focusAfterApplication: "Codex",
    focusChanged: false,
    focusProof: "cua_driver_live_no_focus_fixture_v1",
    rawScreenshotIncluded: false,
    rawSecretIncluded: false
  }, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "desktop",
      "proof-report",
      "--evidence-dir",
      root,
      "--observation-file",
      observationPath,
      "--strict"
    ], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout) as {
      ok?: boolean;
      proofReady?: boolean;
      publicSafe?: boolean;
      approvalEvidencePath?: string;
      runtimeProofEvidencePath?: string;
      blockers?: string[];
      actionHash?: string;
      actionsPerformed?: { desktopGuiActionRun?: boolean };
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.proofReady, true);
    assert.equal(parsed.publicSafe, true);
    assert.deepEqual(parsed.blockers, []);
    assert.match(parsed.actionHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(parsed.actionsPerformed?.desktopGuiActionRun, false);
    assert.equal(existsSync(join(root, "desktop-gui-proof-report.json")), true);
    assert.equal(existsSync(join(root, "desktop-gui-approval.json")), true);
    assert.equal(parsed.runtimeProofEvidencePath, join(root, "desktop-collaboration-action-bound-v1-1.runtime-proof.json"));
    assert.equal(existsSync(join(root, "desktop-collaboration-action-bound-v1-1.runtime-proof.json")), true);

    const approval = JSON.parse(readFileSync(join(root, "desktop-gui-approval.json"), "utf8")) as {
      kind?: string;
      operation?: string;
      actionHash?: string;
      approvalNonce?: string;
      issuedAt?: string;
      expiresAt?: string;
      focusChanged?: boolean;
      focusProof?: string;
      rawScreenshotIncluded?: boolean;
      rawSecretIncluded?: boolean;
    };
    assert.equal(approval.kind, "loo_release_operation_approval");
    assert.equal(approval.operation, "desktop_gui_mutation");
    assert.equal(approval.actionHash, parsed.actionHash);
    assert.match(approval.approvalNonce ?? "", /^[a-f0-9]{32}$/);
    assert.equal(Number.isFinite(Date.parse(approval.issuedAt ?? "")), true);
    assert.equal(Number.isFinite(Date.parse(approval.expiresAt ?? "")), true);
    assert.ok(Date.parse(approval.expiresAt ?? "") > Date.parse(approval.issuedAt ?? ""));
    assert.equal(approval.focusChanged, false);
    assert.equal(approval.focusProof, "cua_driver_live_no_focus_fixture_v1");
    assert.equal(approval.rawScreenshotIncluded, false);
    assert.equal(approval.rawSecretIncluded, false);

    const runtimeProof = JSON.parse(readFileSync(join(root, "desktop-collaboration-action-bound-v1-1.runtime-proof.json"), "utf8")) as {
      kind?: string;
      scenario_id?: string;
      scenario_version?: string;
      proof_mode?: string;
      claim_scope?: string;
      public_safe?: boolean;
      proof_markers?: Record<string, boolean>;
      raw_transcript_read?: boolean;
      raw_prompt_included?: boolean;
      raw_secret_included?: boolean;
      screenshot_included?: boolean;
      sqlite_included?: boolean;
      screenshot_count?: number;
      action_hash?: string;
    };
    assert.equal(runtimeProof.kind, "loo_runtime_scenario_proof");
    assert.equal(runtimeProof.scenario_id, "desktop-collaboration-action-bound-v1-1");
    assert.equal(runtimeProof.scenario_version, "1.1");
    assert.equal(runtimeProof.proof_mode, "runtime_required");
    assert.equal(runtimeProof.claim_scope, "codex-working-app-proof");
    assert.equal(runtimeProof.public_safe, true);
    assert.deepEqual(runtimeProof.proof_markers, {
      action_bound_target: true,
      backend_specific_observation: true,
      no_focus_measurement: true
    });
    assert.equal(runtimeProof.raw_transcript_read, false);
    assert.equal(runtimeProof.raw_prompt_included, false);
    assert.equal(runtimeProof.raw_secret_included, false);
    assert.equal(runtimeProof.screenshot_included, false);
    assert.equal(runtimeProof.sqlite_included, false);
    assert.equal(runtimeProof.screenshot_count, 0);
    assert.equal(runtimeProof.action_hash, parsed.actionHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI desktop proof-report reports observation-file path for malformed JSON", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-proof-malformed-"));
  const observationPath = join(root, "desktop-gui-observation.json");
  writeFileSync(observationPath, "{not-json\n");

  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "desktop",
      "proof-report",
      "--evidence-dir",
      root,
      "--observation-file",
      observationPath,
      "--strict"
    ], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8"
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Failed to read observation file ${observationPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(result.stderr, /ENOENT: no such file or directory/);
    assert.equal(existsSync(join(root, "desktop-collaboration-action-bound-v1-1.runtime-proof.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI desktop live-proof-harness fails closed for direct backend without running GUI action", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-live-harness-"));

  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "desktop",
      "live-proof-harness",
      "--evidence-dir",
      root,
      "--backend",
      "direct",
      "--target-app",
      "Codex",
      "--target-window",
      "Lossless OpenClaw Orchestrator",
      "--action",
      "focus-safe noop",
      "--approval-ref",
      "issue-119-local-fixture",
      "--strict"
    ], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8"
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout) as {
      ok?: boolean;
      proofHarnessReady?: boolean;
      blockers?: string[];
      actionsPerformed?: { desktopGuiActionRun?: boolean; screenshotCaptured?: boolean };
      proofBoundary?: string;
      evidencePath?: string;
    };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.proofHarnessReady, false);
    assert.ok(parsed.blockers?.includes("desktop_backend_not_gui_fallback"));
    assert.deepEqual(parsed.actionsPerformed, {
      desktopGuiActionRun: false,
      screenshotCaptured: false
    });
    assert.match(parsed.proofBoundary ?? "", /does not perform desktop GUI mutation/i);
    assert.equal(parsed.evidencePath, join(root, "desktop-live-proof-harness.json"));
    const evidenceFile = join(root, "desktop-live-proof-harness.json");
    assert.equal(existsSync(evidenceFile), true);
    const persisted = JSON.parse(readFileSync(evidenceFile, "utf8")) as typeof parsed;
    assert.deepEqual(persisted, parsed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP doctor and desktop tools expose CUA diagnostics while desktop act stays dry-run-only", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const tools = createLooTools({
    db,
    audit,
    codexClient: { request: async () => ({ ok: true }) },
    desktopProbe: {
      commandStatus: (command) => ({ available: false, command, error: "not found" }),
      activeApplication: () => undefined
    }
  });

  try {
    const doctor = tools.find((tool) => tool.name === "loo_doctor");
    assert.ok(doctor);
    const doctorResult = await doctor.execute({}) as {
      desktopFallbacks: {
        preferred: string;
        backends: Array<{
          backend: string;
          launch: { command: string; args: string[]; readiness: { status: string } };
          permissions: { accessibility: { status: string }; screenRecording: { status: string } };
          limitations: string[];
        }>;
      };
    };
    assert.equal(doctorResult.desktopFallbacks.preferred, "cua-driver");
    const cuaBackend = doctorResult.desktopFallbacks.backends.find((backend) => backend.backend === "cua-driver");
    assert.ok(cuaBackend);
    assert.equal(cuaBackend.launch.command, "cua-driver");
    assert.equal(cuaBackend.launch.readiness.status, "unavailable");
    assert.equal(cuaBackend.permissions.accessibility.status, "unknown");
    assert.equal(cuaBackend.permissions.screenRecording.status, "unknown");
    assert.ok(cuaBackend.limitations.some((limitation) => limitation.includes("No live GUI action")));

    const see = tools.find((tool) => tool.name === "loo_desktop_see");
    assert.ok(see);
    const seeResult = await see.execute({ backend: "cua-driver" }) as { backend: string; available: boolean; focus: { proof: string } };
    assert.equal(seeResult.backend, "cua-driver");
    assert.equal(seeResult.available, false);
    assert.equal(seeResult.focus.proof, "not_measured");

    const act = tools.find((tool) => tool.name === "loo_desktop_act");
    assert.ok(act);
    const actResult = await act.execute({ backend: "cua-driver", action: "click primary", dry_run: false }) as {
      backend: string;
      live: boolean;
      dryRunOnly: boolean;
      approvalRequired: boolean;
      blockers?: string[];
      requiredProof?: string[];
      nextAction?: string;
    };
    assert.equal(actResult.backend, "cua-driver");
    assert.equal(actResult.live, false);
    assert.equal(actResult.dryRunOnly, true);
    assert.equal(actResult.approvalRequired, true);
    assert.ok(actResult.blockers?.includes("desktop_live_action_not_enabled"));
    assert.ok(actResult.blockers?.includes("approval_ref_missing"));
    assert.ok(actResult.blockers?.includes("action_hash_missing"));
    assert.ok(actResult.blockers?.includes("permission_state_missing"));
    assert.ok(actResult.blockers?.includes("focus_before_after_missing"));
    assert.ok(actResult.blockers?.includes("public_safe_observation_missing"));
    assert.deepEqual(actResult.requiredProof, [
      "backend",
      "target_app",
      "target_window",
      "action",
      "action_hash",
      "approval_ref",
      "permission_state",
      "focus_before_application",
      "focus_after_application",
      "public_safe_observation"
    ]);
    assert.match(actResult.nextAction ?? "", /loo_desktop_live_proof_harness/i);
    assert.match(actResult.nextAction ?? "", /loo_desktop_proof_report/i);

    const compliantActionHash = createHash("sha256")
      .update(JSON.stringify({
        desktopBackend: "cua-driver",
        targetApp: "Codex",
        targetWindow: "Lossless OpenClaw Orchestrator",
        action: "click primary"
      }))
      .digest("hex")
      .toUpperCase();
    const compliantLiveRequest = await act.execute({
      backend: "cua-driver",
      target_app: "Codex",
      target_window: "Lossless OpenClaw Orchestrator",
      action: "click primary",
      action_hash: compliantActionHash,
      approval_ref: "issue-160-proof-ref",
      permission_state: "accessibility=true;screen_recording=true",
      focus_before_application: "Codex",
      focus_after_application: "Codex",
      public_safe_observation: true,
      dry_run: false
    }) as { blockers?: string[] };
    assert.deepEqual(compliantLiveRequest.blockers, ["desktop_live_action_not_enabled"]);

    const mismatchedHashLiveRequest = await act.execute({
      backend: "cua-driver",
      target_app: "Codex",
      target_window: "Lossless OpenClaw Orchestrator",
      action: "click primary",
      action_hash: "0".repeat(64),
      approval_ref: "issue-160-proof-ref",
      permission_state: "accessibility=true;screen_recording=true",
      focus_before_application: "Codex",
      focus_after_application: "Codex",
      public_safe_observation: true,
      dry_run: false
    }) as { blockers?: string[] };
    assert.ok(mismatchedHashLiveRequest.blockers?.includes("action_hash_mismatch"));

    const focusChangedLiveRequest = await act.execute({
      backend: "cua-driver",
      target_app: "Codex",
      target_window: "Lossless OpenClaw Orchestrator",
      action: "click primary",
      action_hash: compliantActionHash,
      approval_ref: "issue-160-proof-ref",
      permission_state: "accessibility=true;screen_recording=true",
      focus_before_application: "Codex",
      focus_after_application: "TextEdit",
      public_safe_observation: true,
      dry_run: false
    }) as { blockers?: string[] };
    assert.ok(focusChangedLiveRequest.blockers?.includes("focus_changed"));

    const missingActionLiveRequest = await act.execute({
      backend: "cua-driver",
      target_app: "Codex",
      target_window: "Lossless OpenClaw Orchestrator",
      action_hash: compliantActionHash,
      approval_ref: "issue-160-proof-ref",
      permission_state: "accessibility=true;screen_recording=true",
      focus_before_application: "Codex",
      focus_after_application: "Codex",
      public_safe_observation: true,
      dry_run: false
    }) as { action?: string; blockers?: string[] };
    assert.equal(missingActionLiveRequest.action, "unknown");
    assert.ok(missingActionLiveRequest.blockers?.includes("action_missing"));

    const proofReport = tools.find((tool) => tool.name === "loo_desktop_proof_report");
    assert.ok(proofReport);
    const invalidProof = await proofReport.execute({
      observation: {
        kind: "loo_desktop_gui_action_observation",
        desktopBackend: "direct",
        targetApp: "Codex",
        targetWindow: "Lossless OpenClaw Orchestrator",
        action: "focus-safe noop",
        approvalRef: "issue-117-local-fixture",
        approved: true,
        liveActionObserved: true,
        focusBeforeApplication: "Codex",
        focusAfterApplication: "Codex",
        focusChanged: false,
        focusProof: "status_probe_only_no_action",
        rawScreenshotIncluded: false,
        rawSecretIncluded: false
      }
    }) as { ok: boolean; proofReady: boolean; blockers: string[]; approval: unknown };
    assert.equal(invalidProof.ok, false);
    assert.equal(invalidProof.proofReady, false);
    assert.equal(invalidProof.approval, null);
    assert.ok(invalidProof.blockers.includes("desktop_backend_not_gui_fallback"));
    assert.ok(invalidProof.blockers.includes("focus_proof_diagnostic_only"));

    const harness = tools.find((tool) => tool.name === "loo_desktop_live_proof_harness");
    assert.ok(harness);
    const harnessResult = await harness.execute({
      backend: "cua-driver",
      target_app: "Codex",
      target_window: "Lossless OpenClaw Orchestrator",
      action: "focus-safe noop",
      approval_ref: "issue-119-local-fixture"
    }) as {
      ok: boolean;
      proofHarnessReady: boolean;
      actionHash?: string;
      blockers: string[];
      backendStatus?: { available?: boolean; focus?: { changed?: boolean; proof?: string } };
      actionsPerformed?: { desktopGuiActionRun?: boolean; screenshotCaptured?: boolean };
    };
    assert.equal(harnessResult.ok, false);
    assert.equal(harnessResult.proofHarnessReady, false);
    assert.ok(harnessResult.blockers.includes("desktop_backend_unavailable"));
    assert.equal(harnessResult.backendStatus?.available, false);
    assert.deepEqual(harnessResult.actionsPerformed, {
      desktopGuiActionRun: false,
      screenshotCaptured: false
    });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP desktop live-proof-harness can produce a ready public-safe proof plan with stable CUA diagnostics", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-live-ready-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const tools = createLooTools({
    db,
    audit,
    codexClient: { request: async () => ({ ok: true }) },
    desktopProbe: {
      commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.1.0" }),
      activeApplication: () => "Codex"
    }
  });

  try {
    const harness = tools.find((tool) => tool.name === "loo_desktop_live_proof_harness");
    assert.ok(harness);
    const result = await harness.execute({
      backend: "cua-driver",
      target_app: "Codex",
      target_window: "Lossless OpenClaw Orchestrator",
      action: "focus-safe noop",
      approval_ref: "issue-119-local-fixture"
    }) as {
      ok: boolean;
      proofHarnessReady: boolean;
      publicSafe: boolean;
      actionHash?: string;
      blockers: string[];
      backendStatus?: { available?: boolean; focus?: { changed?: boolean; proof?: string } };
      actionsPerformed?: { desktopGuiActionRun?: boolean; screenshotCaptured?: boolean };
      nextAction?: string;
    };

    const expectedActionHash = createHash("sha256")
      .update(JSON.stringify({
        desktopBackend: "cua-driver",
        targetApp: "Codex",
        targetWindow: "Lossless OpenClaw Orchestrator",
        action: "focus-safe noop"
      }))
      .digest("hex");

    assert.equal(result.ok, true);
    assert.equal(result.proofHarnessReady, true);
    assert.equal(result.publicSafe, true);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.actionHash, expectedActionHash);
    assert.equal(result.backendStatus?.available, true);
    assert.deepEqual(result.backendStatus?.focus, {
      changed: false,
      proof: "status_probe_only_no_action"
    });
    assert.deepEqual(result.actionsPerformed, {
      desktopGuiActionRun: false,
      screenshotCaptured: false
    });
    assert.match(result.nextAction ?? "", /run the backend-specific live action outside this harness/i);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("CUA desktop proof action executes only the approved TextEdit scratch launch and emits a proof-report observation", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-proof-action-root-"));
  const scratchFilePath = join(root, "lco-desktop-proof.txt");
  const { action, targetApp, targetWindow, approvalRef, actionHash, approvalArtifact } = signedProofActionFixture(root, scratchFilePath);
  const commandCalls: Array<{ command: string; args: string[] }> = [];

  try {
    const result = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
      backend: "cua-driver",
      targetApp,
      targetWindow,
      action,
      actionHash,
      approvalRef,
      approvalArtifact,
      permissionState: "accessibility=true;screen_recording=true",
      execute: true,
      scratchFilePath,
      probe: {
        commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
        activeApplication: () => "Codex",
        commandOutput: (command: string, args: string[] = []) => {
          commandCalls.push({ command, args });
          assert.equal(command, "cua-driver");
          assert.deepEqual(args, [
            "call",
            "launch_app",
            JSON.stringify({
              bundle_id: "com.apple.TextEdit",
              name: "TextEdit",
              urls: [scratchFilePath],
              creates_new_application_instance: true
            })
          ]);
          return {
            status: 0,
            command,
            stdout: JSON.stringify({
              pid: 1234,
              bundle_id: "com.apple.TextEdit",
              name: "TextEdit",
              windows: [{ title: targetWindow }],
              self_activation_suppressed: true
            })
          };
        }
      }
    }));

    assert.equal(result.ok, true);
    assert.equal(result.proofActionReady, true);
    assert.equal(result.publicSafe, true);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.desktopBackend, "cua-driver");
    assert.equal(result.actionHash, actionHash);
    assert.equal(result.approvalVerified, true);
    assert.equal(result.backendCommand?.tool, "launch_app");
    assert.equal(result.backendCommand?.status, 0);
    assert.equal(result.backendCommand?.rawStdoutIncluded, false);
    assert.equal(result.backendCommand?.scratchFilePathIncluded, false);
    assert.equal(result.actionsPerformed.desktopGuiActionRun, true);
    assert.equal(result.actionsPerformed.screenshotCaptured, false);
    assert.equal(result.observation?.kind, "loo_desktop_gui_action_observation");
    assert.equal(result.observation?.desktopBackend, "cua-driver");
    assert.equal(result.observation?.targetApp, targetApp);
    assert.equal(result.observation?.targetWindow, targetWindow);
    assert.equal(result.observation?.action, action);
    assert.equal(result.observation?.approvalRef, approvalRef);
    assert.equal(result.observation?.approved, true);
    assert.equal(result.observation?.liveActionObserved, true);
    assert.equal(result.observation?.focusBeforeApplication, "Codex");
    assert.equal(result.observation?.focusAfterApplication, "Codex");
    assert.equal(result.observation?.focusChanged, false);
    assert.equal(result.observation?.focusProof, "cua_driver_launch_app_no_focus_v1");
    assert.equal(result.observation?.rawScreenshotIncluded, false);
    assert.equal(result.observation?.rawSecretIncluded, false);
    assert.equal(commandCalls.length, 1);

    const proofReport = createDesktopGuiProofReport(result.observation);
    assert.equal(proofReport.ok, true);
    assert.equal(proofReport.approval?.actionHash, actionHash);
    assert.equal(proofReport.runtimeProof?.action_hash, actionHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CUA desktop proof action fails closed for generic actions, bad hashes, missing execute, and focus changes", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-proof-action-fail-root-"));
  const scratchFilePath = join(root, "lco-desktop-proof.txt");
  const { action, targetApp, targetWindow, approvalRef, actionHash, approvalArtifact } = signedProofActionFixture(root, scratchFilePath);
  const approved = {
    backend: "cua-driver" as const,
    targetApp,
    targetWindow,
    action,
    approvalRef,
    approvalArtifact,
    permissionState: "accessibility=true;screen_recording=true"
  };
  const readyProbe = {
    commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
    activeApplication: () => "Codex",
    commandOutput: () => ({ status: 0, command: "cua-driver", stdout: JSON.stringify({ self_activation_suppressed: true }) })
  };

  try {
  const missingExecute = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
    ...approved,
    actionHash,
    scratchFilePath,
    execute: false,
    probe: readyProbe
  }));
  assert.equal(missingExecute.ok, false);
  assert.ok(missingExecute.blockers.includes("execute_flag_missing"));
  assert.equal(missingExecute.actionsPerformed.desktopGuiActionRun, false);
  assert.equal(missingExecute.observation, null);

  const genericAction = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
    ...approved,
    action: "click primary",
    actionHash: "0".repeat(64),
    scratchFilePath,
    execute: true,
    probe: readyProbe
  }));
  assert.equal(genericAction.ok, false);
  assert.ok(genericAction.blockers.includes("unsupported_desktop_proof_action"));
  assert.equal(genericAction.actionsPerformed.desktopGuiActionRun, false);

  const badHash = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
    ...approved,
    actionHash: "0".repeat(64),
    scratchFilePath,
    execute: true,
    probe: readyProbe
  }));
  assert.equal(badHash.ok, false);
  assert.ok(badHash.blockers.includes("action_hash_mismatch"));
  assert.equal(badHash.actionsPerformed.desktopGuiActionRun, false);

  let focusProbeCall = 0;
  const focusChanged = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
    ...approved,
    actionHash,
    scratchFilePath,
    execute: true,
    probe: {
      commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
      activeApplication: () => (focusProbeCall++ === 0 ? "Codex" : "TextEdit"),
      commandOutput: () => ({ status: 0, command: "cua-driver", stdout: JSON.stringify({ self_activation_suppressed: true }) })
    }
  }));
  assert.equal(focusChanged.ok, false);
  assert.ok(focusChanged.blockers.includes("focus_changed"));
  assert.equal(focusChanged.actionsPerformed.desktopGuiActionRun, true);
  assert.equal(focusChanged.observation, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CUA desktop proof action requires exact approval, bounded scratch path, exact permissions, focus proof, and verified backend output", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-proof-action-boundary-root-"));
  const scratchFilePath = join(root, "lco-desktop-proof.txt");
  const { action, targetApp, targetWindow, approvalRef, actionHash, approvalArtifact } = signedProofActionFixture(root, scratchFilePath);
  const approved = {
    backend: "cua-driver" as const,
    targetApp,
    targetWindow,
    action,
    actionHash,
    approvalRef,
    approvalArtifact,
    permissionState: "accessibility=true;screen_recording=true",
    scratchFilePath,
    execute: true
  };
  let commandCalls = 0;
  const readyProbe = {
    commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
    activeApplication: () => "Codex",
    commandOutput: () => {
      commandCalls += 1;
      return { status: 0, command: "cua-driver", stdout: JSON.stringify({ self_activation_suppressed: true }) };
    }
  };

  try {
  const missingApproval = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
    ...approved,
    approvalArtifact: undefined,
    probe: readyProbe
  }));
  assert.ok(missingApproval.blockers.includes("approval_artifact_missing"));
  assert.equal(missingApproval.actionsPerformed.desktopGuiActionRun, false);

  const unboundScratchPath = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
    ...approved,
    scratchFilePath: join(root, "unrelated.txt"),
    approvalArtifact,
    probe: readyProbe
  }));
  assert.ok(unboundScratchPath.blockers.includes("scratch_file_path_not_bound"));
  assert.equal(unboundScratchPath.actionsPerformed.desktopGuiActionRun, false);

  const mismatchedApproval = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
    ...approved,
    approvalArtifact: { ...approvalArtifact, scratchFilePathHash: "0".repeat(64) },
    probe: readyProbe
  }));
  assert.ok(mismatchedApproval.blockers.includes("approval_scratch_file_hash_mismatch"));
  assert.equal(mismatchedApproval.actionsPerformed.desktopGuiActionRun, false);

  const malformedPermissions = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
    ...approved,
    permissionState: "accessibility=truefalse;screen_recording=truefalse",
    probe: readyProbe
  }));
  assert.ok(malformedPermissions.blockers.includes("permission_state_not_ready"));
  assert.equal(malformedPermissions.actionsPerformed.desktopGuiActionRun, false);

  const missingFocusBefore = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
    ...approved,
    probe: {
      commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
      activeApplication: () => undefined,
      commandOutput: () => {
        commandCalls += 1;
        return { status: 0, command: "cua-driver", stdout: JSON.stringify({ self_activation_suppressed: true }) };
      }
    }
  }));
  assert.ok(missingFocusBefore.blockers.includes("focus_before_application_missing"));
  assert.equal(missingFocusBefore.actionsPerformed.desktopGuiActionRun, false);

  const unverifiableBackendOutput = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
    ...approved,
    probe: {
      commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
      activeApplication: () => "Codex",
      commandOutput: () => {
        commandCalls += 1;
        return { status: 0, command: "cua-driver", stdout: "{}" };
      }
    }
  }));
  assert.ok(unverifiableBackendOutput.blockers.includes("desktop_backend_output_not_verified"));
  assert.equal(unverifiableBackendOutput.actionsPerformed.desktopGuiActionRun, true);
  assert.equal(unverifiableBackendOutput.proofActionReady, false);
  assert.equal(unverifiableBackendOutput.observation, null);
  assert.equal(commandCalls, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CUA desktop proof action unwraps MCP call-result envelopes for launch and window verification", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-proof-action-envelope-"));
  const scratchFilePath = join(root, "lco-desktop-proof.txt");
  const { action, targetApp, targetWindow, approvalRef, actionHash, approvalArtifact } = signedProofActionFixture(root, scratchFilePath);
  const commandCalls: string[] = [];

  try {
    const result = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
      backend: "cua-driver",
      targetApp,
      targetWindow,
      action,
      actionHash,
      approvalRef,
      approvalArtifact,
      permissionState: "accessibility=true;screen_recording=true",
      scratchFilePath,
      execute: true,
      probe: {
        commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
        activeApplication: () => "Codex",
        commandOutput: (command: string, args: string[] = []) => {
          commandCalls.push(args[1] ?? "");
          if (args[1] === "launch_app") {
            return {
              status: 0,
              command,
              stdout: JSON.stringify({
                structuredContent: {
                  pid: 2468,
                  bundle_id: "com.apple.TextEdit",
                  name: "TextEdit",
                  windows: [],
                  self_activation_suppressed: true
                }
              })
            };
          }
          assert.deepEqual(args, ["call", "list_windows", JSON.stringify({ pid: 2468 })]);
          return {
            status: 0,
            command,
            stdout: JSON.stringify({
              content: [{
                type: "text",
                text: JSON.stringify({
                  current_space_id: null,
                  windows: [{ window_id: 99, pid: 2468, app_name: "TextEdit", title: targetWindow }]
                })
              }]
            })
          };
        }
      }
    }));

    assert.equal(result.ok, true);
    assert.equal(result.proofActionReady, true);
    assert.deepEqual(commandCalls, ["launch_app", "list_windows"]);
    assert.equal(result.observation?.focusProof, "cua_driver_launch_app_no_focus_v1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CUA desktop proof action verifies the scratch window from list_windows when launch output omits windows", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-proof-action-window-fallback-"));
  const scratchFilePath = join(root, "lco-desktop-proof.txt");
  const { action, targetApp, targetWindow, approvalRef, actionHash, approvalArtifact } = signedProofActionFixture(root, scratchFilePath);
  const commandCalls: Array<{ command: string; args: string[] }> = [];

  try {
    const result = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
      backend: "cua-driver",
      targetApp,
      targetWindow,
      action,
      actionHash,
      approvalRef,
      approvalArtifact,
      permissionState: "accessibility=true;screen_recording=true",
      scratchFilePath,
      execute: true,
      probe: {
        commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
        activeApplication: () => "Codex",
        commandOutput: (command: string, args: string[] = []) => {
          commandCalls.push({ command, args });
          if (args[1] === "launch_app") {
            return {
              status: 0,
              command,
              stdout: JSON.stringify({
                pid: 1234,
                bundle_id: "com.apple.TextEdit",
                name: "TextEdit",
                windows: [],
                self_activation_suppressed: true
              })
            };
          }
          assert.deepEqual(args, ["call", "list_windows", JSON.stringify({ pid: 1234 })]);
          return {
            status: 0,
            command,
            stdout: JSON.stringify({
              current_space_id: null,
              windows: [{ window_id: 42, pid: 1234, app_name: "TextEdit", title: targetWindow }]
            })
          };
        }
      }
    }));

    assert.equal(result.ok, true);
    assert.equal(result.proofActionReady, true);
    assert.equal(result.observation?.targetWindow, targetWindow);
    assert.equal(commandCalls.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CUA desktop proof action rejects forged approval artifacts, off-root scratch paths, symlink escapes, and wrong backend targets", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-proof-action-security-root-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "loo-desktop-proof-action-outside-"));
  const scratchFilePath = join(root, "lco-desktop-proof.txt");
  const { action, targetApp, targetWindow, approvalRef, actionHash, approvalArtifact } = signedProofActionFixture(root, scratchFilePath);
  const approved = {
    backend: "cua-driver" as const,
    targetApp,
    targetWindow,
    action,
    actionHash,
    approvalRef,
    approvalArtifact,
    permissionState: "accessibility=true;screen_recording=true",
    scratchFilePath,
    execute: true
  };
  const readyProbe = {
    commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
    activeApplication: () => "Codex",
    commandOutput: () => ({
      status: 0,
      command: "cua-driver",
      stdout: JSON.stringify({
        name: "TextEdit",
        windows: [{ title: targetWindow }],
        self_activation_suppressed: true
      })
    })
  };

  try {
    const forgedApproval = {
      kind: "loo_desktop_proof_action_approval",
      approved: true,
      approvalRef,
      desktopBackend: "cua-driver",
      targetApp,
      targetWindow,
      action,
      actionHash,
      scratchFilePathHash: createHash("sha256").update(scratchFilePath).digest("hex"),
      issuedAt: "2026-07-01T00:00:00.000Z",
      expiresAt: "2999-01-01T00:00:00.000Z",
      approvalSignature: "0".repeat(64)
    };
    const forged = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
      ...approved,
      approvalArtifact: forgedApproval,
      probe: readyProbe
    }));
    assert.ok(forged.blockers.includes("approval_signature_mismatch"));
    assert.equal(forged.actionsPerformed.desktopGuiActionRun, false);

    const outsidePath = join(outsideRoot, "lco-desktop-proof.txt");
    writeFileSync(outsidePath, "outside root\n");
    const outsideApproval = signedProofActionFixture(outsideRoot, outsidePath).approvalArtifact;
    const offRoot = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
      ...approved,
      scratchFilePath: outsidePath,
      approvalArtifact: outsideApproval,
      probe: readyProbe
    }));
    assert.ok(offRoot.blockers.includes("scratch_file_path_not_bound"));
    assert.equal(offRoot.actionsPerformed.desktopGuiActionRun, false);

    const escapedTarget = join(outsideRoot, "escaped-proof.txt");
    writeFileSync(escapedTarget, "symlink target outside root\n");
    const symlinkPath = join(root, "lco-desktop-proof.txt");
    rmSync(symlinkPath, { force: true });
    symlinkSync(escapedTarget, symlinkPath);
    const symlinkEscape = withDesktopProofScratchRoot(root, () => createDesktopLiveProofHarness({
      backend: "cua-driver",
      targetApp,
      targetWindow,
      action,
      approvalRef,
      scratchFilePath: symlinkPath,
      probe: {
        commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
        activeApplication: () => "Codex"
      }
    }));
    assert.equal(symlinkEscape.proofHarnessReady, false);
    assert.ok(symlinkEscape.blockers.includes("scratch_file_path_not_bound"));
    assert.equal(symlinkEscape.approvalArtifact, null);

    rmSync(scratchFilePath, { force: true });
    writeFileSync(scratchFilePath, "scratch restored\n");
    const wrongTargetOutput = withDesktopProofScratchRoot(root, () => createDesktopProofAction({
      ...approved,
      probe: {
        commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
        activeApplication: () => "Codex",
        commandOutput: () => ({
          status: 0,
          command: "cua-driver",
          stdout: JSON.stringify({
            name: "TextEdit",
            windows: [{ title: "Untitled" }],
            self_activation_suppressed: true
          })
        })
      }
    }));
    assert.ok(wrongTargetOutput.blockers.includes("desktop_backend_output_target_mismatch"));
    assert.equal(wrongTargetOutput.proofActionReady, false);
    assert.equal(wrongTargetOutput.observation, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("desktop live-proof harness fails closed for the proof tuple when it cannot emit an approval artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-proof-harness-strict-root-"));
  const { action, targetApp, targetWindow, approvalRef } = proofActionFixture(join(root, "lco-desktop-proof.txt"));
  try {
    const missingScratch = withDesktopProofScratchRoot(root, () => createDesktopLiveProofHarness({
      backend: "cua-driver",
      targetApp,
      targetWindow,
      action,
      approvalRef,
      probe: {
        commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
        activeApplication: () => "Codex"
      }
    }));
    assert.equal(missingScratch.proofHarnessReady, false);
    assert.ok(missingScratch.blockers.includes("scratch_file_missing"));
    assert.equal(missingScratch.approvalArtifact, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("desktop live-proof harness writer removes stale approval artifacts when the latest harness is blocked", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-proof-harness-stale-approval-"));
  const { action, targetApp, targetWindow, approvalRef } = proofActionFixture(join(root, "lco-desktop-proof.txt"));
  const approvalPath = join(root, "desktop-proof-action-approval.json");
  writeFileSync(approvalPath, `${JSON.stringify({
    kind: "loo_desktop_proof_action_approval",
    approved: true
  })}\n`);

  try {
    const report = withDesktopProofScratchRoot(root, () => writeDesktopLiveProofHarness({
      evidenceDir: root,
      backend: "cua-driver",
      targetApp,
      targetWindow,
      action,
      approvalRef,
      probe: {
        commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
        activeApplication: () => "Codex"
      }
    }));
    assert.equal(report.proofHarnessReady, false);
    assert.equal(report.approvalArtifact, null);
    assert.equal(existsSync(approvalPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("desktop live-proof harness create path does not create a persistent approval key implicitly", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-proof-harness-key-side-effect-"));
  const scratchFilePath = join(root, "lco-desktop-proof.txt");
  const keyPath = join(root, "desktop-proof-action.key");
  const { action, targetApp, targetWindow, approvalRef } = proofActionFixture(scratchFilePath);
  writeFileSync(scratchFilePath, "LOO desktop proof scratch fixture\n");

  try {
    const readOnlyReport = withDesktopProofScratchRootAndKeyPath(root, keyPath, () => createDesktopLiveProofHarness({
      backend: "cua-driver",
      targetApp,
      targetWindow,
      action,
      approvalRef,
      scratchFilePath,
      probe: {
        commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
        activeApplication: () => "Codex"
      }
    }));
    assert.equal(readOnlyReport.proofHarnessReady, false);
    assert.ok(readOnlyReport.blockers.includes("approval_signing_key_missing"));
    assert.equal(readOnlyReport.approvalArtifact, null);
    assert.equal(existsSync(keyPath), false);

    const writtenReport = withDesktopProofScratchRootAndKeyPath(root, keyPath, () => writeDesktopLiveProofHarness({
      evidenceDir: root,
      backend: "cua-driver",
      targetApp,
      targetWindow,
      action,
      approvalRef,
      scratchFilePath,
      probe: {
        commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
        activeApplication: () => "Codex"
      }
    }));
    assert.equal(writtenReport.proofHarnessReady, true);
    assert.ok(writtenReport.approvalArtifact);
    assert.equal(existsSync(keyPath), true);
    assert.equal(existsSync(join(root, "desktop-proof-action-approval.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("desktop proof-action writer removes stale observations when the latest run fails", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-proof-action-stale-"));
  const scratchFilePath = join(root, "lco-desktop-proof.txt");
  const { action, targetApp, targetWindow, approvalRef, actionHash, approvalArtifact } = signedProofActionFixture(root, scratchFilePath);
  const observationPath = join(root, "desktop-gui-observation.json");
  writeFileSync(observationPath, `${JSON.stringify({
    kind: "loo_desktop_gui_action_observation",
    approved: true
  })}\n`);

  try {
    const report = withDesktopProofScratchRoot(root, () => writeDesktopProofAction({
      evidenceDir: root,
      backend: "cua-driver",
      targetApp,
      targetWindow,
      action,
      actionHash,
      approvalRef,
      approvalArtifact,
      permissionState: "accessibility=true;screen_recording=true",
      scratchFilePath,
      execute: false,
      probe: {
        commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
        activeApplication: () => "Codex",
        commandOutput: () => ({ status: 0, command: "cua-driver", stdout: "{}" })
      }
    }));
    assert.equal(report.observation, null);
    assert.equal(existsSync(observationPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP desktop proof action exposes the CUA scratch launch proof contract", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-proof-action-mcp-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const scratchFilePath = join(root, "lco-desktop-proof.txt");
  const { action, targetApp, targetWindow, approvalRef, actionHash, approvalArtifact } = signedProofActionFixture(root, scratchFilePath);
  const tools = createLooTools({
    db,
    audit,
    codexClient: { request: async () => ({ ok: true }) },
    desktopProbe: {
      commandStatus: () => ({ available: true, command: "cua-driver", version: "cua-driver 0.6.8" }),
      activeApplication: () => "Codex",
      commandOutput: () => ({
        status: 0,
        command: "cua-driver",
        stdout: JSON.stringify({
          name: "TextEdit",
          windows: [{ title: targetWindow }],
          self_activation_suppressed: true
        })
      })
    }
  });

  try {
    const proofAction = tools.find((tool) => tool.name === "loo_desktop_proof_action");
    assert.ok(proofAction);
    const result = await withDesktopProofScratchRoot(root, () => proofAction.execute({
      backend: "cua-driver",
      target_app: targetApp,
      target_window: targetWindow,
      action,
      action_hash: actionHash,
      approval_ref: approvalRef,
      approval_artifact: approvalArtifact,
      permission_state: "accessibility=true;screen_recording=true",
      scratch_file_path: scratchFilePath,
      execute: true
    })) as {
      ok?: boolean;
      proofActionReady?: boolean;
      observation?: { kind?: string; rawScreenshotIncluded?: boolean; rawSecretIncluded?: boolean };
      backendCommand?: { rawStdoutIncluded?: boolean; scratchFilePathIncluded?: boolean };
      actionsPerformed?: { desktopGuiActionRun?: boolean; screenshotCaptured?: boolean };
    };

    assert.equal(result.ok, true);
    assert.equal(result.proofActionReady, true);
    assert.equal(result.observation?.kind, "loo_desktop_gui_action_observation");
    assert.equal(result.observation?.rawScreenshotIncluded, false);
    assert.equal(result.observation?.rawSecretIncluded, false);
    assert.equal(result.backendCommand?.rawStdoutIncluded, false);
    assert.equal(result.backendCommand?.scratchFilePathIncluded, false);
    assert.deepEqual(result.actionsPerformed, {
      desktopGuiActionRun: true,
      screenshotCaptured: false
    });

    const schema = proofAction.inputSchema as { properties?: Record<string, { enum?: string[] }> };
    assert.deepEqual(schema.properties?.backend?.enum, ["cua-driver"]);
    assert.deepEqual(schema.properties?.target_app?.enum, ["TextEdit"]);
    assert.deepEqual(schema.properties?.target_window?.enum, ["lco-desktop-proof.txt"]);
    assert.deepEqual(schema.properties?.action?.enum, ["launch_app TextEdit scratch window"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI desktop proof-action help names the scratch-only CUA boundary", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "packages/cli/src/index.ts", "desktop", "proof-action", "--help"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /loo desktop proof-action/i);
  assert.match(result.stdout, /TextEdit scratch/i);
  assert.match(result.stdout, /--approval-file/i);
  assert.match(result.stdout, /does not enable generic GUI mutation/i);
});

test("Peekaboo diagnostics parse permission status and expose visible Codex macro metadata", async () => {
  const status = await desktopSee({
    backend: "peekaboo",
    probe: {
      commandStatus: () => ({ available: true, command: "peekaboo", version: "Peekaboo 3.2.2" }),
      commandOutput: (_command: string, args: string[] = []) => {
        assert.deepEqual(args, ["permissions", "status", "--json", "--no-remote"]);
        return {
          status: 0,
          command: "peekaboo",
          stdout: JSON.stringify({
            success: true,
            data: {
              permissions: [
                { name: "Screen Recording", isGranted: true },
                { name: "Accessibility", isGranted: false }
              ]
            }
          })
        };
      }
    }
  });

  assert.equal(status.permissions.screenRecording.status, "granted");
  assert.equal(status.permissions.accessibility.status, "denied");
  assert.equal(status.visibleCodex?.macros.some((macro) => macro.name === "codex_windows"), true);
  assert.equal(status.visibleCodex?.macros.some((macro) => macro.name === "codex_thread_map"), true);
  assert.equal(status.visibleCodex?.safetyRules.some((rule) => rule.includes("No generic prompt typing")), true);
});

test("Peekaboo snapshot extraction is bounded, redacted, and local-only", async () => {
  const commands: Array<{ command: string; args: string[] }> = [];
  const status = await desktopSee({
    backend: "peekaboo",
    includeSnapshot: true,
    maxNodes: 1,
    maxChars: 80,
    probe: {
      commandStatus: () => ({ available: true, command: "peekaboo", version: "Peekaboo 3.2.2" }),
      activeApplication: () => "Codex",
      commandOutput: (command: string, args: string[] = []) => {
        commands.push({ command, args });
        if (args[0] === "permissions") {
          return { status: 0, command, stdout: JSON.stringify({ success: true, data: { permissions: [] } }) };
        }
        assert.deepEqual(args, ["see", "--mode", "frontmost", "--capture-engine", "classic", "--json", "--no-remote"]);
        return {
          status: 0,
          command,
          stdout: JSON.stringify({
            success: true,
            data: {
              snapshot_id: "PEEKABOO-SNAPSHOT",
              application_name: "Codex",
              window_title: "/Users/lume/private sk-test_1234567890",
              element_count: 2,
              ui_elements: [
                {
                  id: "elem_123",
                  role: "button",
                  label: "Continue /Users/lume/private sk-test_1234567890",
                  bounds: { x: 10, y: 20, width: 100, height: 40 },
                  is_actionable: true
                },
                { id: "elem_456", role: "text", label: "Overflow", is_actionable: false }
              ]
            }
          })
        };
      }
    }
  });

  assert.equal(status.snapshot?.blocked, false);
  assert.equal(status.snapshot?.engine, "peekaboo");
  assert.equal(status.snapshot?.frontmostApp, "Codex");
  assert.equal(status.snapshot?.elements.length, 1);
  assert.equal(status.snapshot?.elements[0]?.elementId, "elem_123");
  assert.equal(status.snapshot?.elements[0]?.label?.includes("/Users/lume"), false);
  assert.equal(status.snapshot?.elements[0]?.label?.includes("sk-test_1234567890"), false);
  assert.equal(status.snapshot?.windowTitle?.includes("/Users/lume"), false);
  assert.equal(status.snapshot?.windowTitle?.includes("sk-test_1234567890"), false);
  assert.equal(status.snapshot?.truncated, true);
  assert.equal(commands.some((entry) => entry.args.includes("--no-remote")), true);
});

test("Peekaboo snapshot fails closed for malformed or failed JSON payloads", async () => {
  for (const stdout of ["not-json", JSON.stringify({ success: false, error: "/Users/lume/private sk-test_1234567890" })]) {
    const status = await desktopSee({
      backend: "peekaboo",
      includeSnapshot: true,
      probe: {
        commandStatus: () => ({ available: true, command: "peekaboo", version: "Peekaboo 3.2.2" }),
        activeApplication: () => "Codex",
        commandOutput: (command: string, args: string[] = []) => {
          if (args[0] === "permissions") {
            return { status: 0, command, stdout: JSON.stringify({ success: true, data: { permissions: [] } }) };
          }
          return { status: 0, command, stdout };
        }
      }
    });

    assert.equal(status.snapshot?.blocked, true);
    assert.equal(status.snapshot?.reason, "peekaboo_snapshot_failed");
    assert.equal(status.snapshot?.elements.length, 0);
    assert.equal(status.snapshot?.warnings.join(" ").includes("/Users/lume"), false);
    assert.equal(status.snapshot?.warnings.join(" ").includes("sk-test_1234567890"), false);
  }
});

test("Peekaboo snapshot discards output when captured app becomes sensitive", async () => {
  const status = await desktopSee({
    backend: "peekaboo",
    includeSnapshot: true,
    probe: {
      commandStatus: () => ({ available: true, command: "peekaboo", version: "Peekaboo 3.2.2" }),
      activeApplication: () => "Codex",
      commandOutput: (command: string, args: string[] = []) => {
        if (args[0] === "permissions") {
          return { status: 0, command, stdout: JSON.stringify({ success: true, data: { permissions: [] } }) };
        }
        return {
          status: 0,
          command,
          stdout: JSON.stringify({
            success: true,
            data: {
              application_name: "Mail",
              ui_elements: [{ id: "mail-secret", role: "text", label: "private message" }]
            }
          })
        };
      }
    }
  });

  assert.equal(status.snapshot?.blocked, true);
  assert.equal(status.snapshot?.reason, "sensitive_app_blocked");
  assert.equal(status.snapshot?.frontmostApp, "Mail");
  assert.deepEqual(status.snapshot?.elements, []);
});

test("Peekaboo snapshot blocks sensitive frontmost apps before capture", async () => {
  let seeCalls = 0;
  const status = await desktopSee({
    backend: "peekaboo",
    includeSnapshot: true,
    probe: {
      commandStatus: () => ({ available: true, command: "peekaboo", version: "Peekaboo 3.2.2" }),
      activeApplication: () => "Messages",
      commandOutput: (command: string, args: string[] = []) => {
        if (args[0] === "permissions") {
          return { status: 0, command, stdout: JSON.stringify({ success: true, data: { permissions: [] } }) };
        }
        seeCalls += 1;
        return { status: 0, command, stdout: "{}" };
      }
    }
  });

  assert.equal(status.snapshot?.blocked, true);
  assert.equal(status.snapshot?.reason, "sensitive_app_blocked");
  assert.equal(status.snapshot?.frontmostApp, "Messages");
  assert.equal(seeCalls, 0);
});

test("Peekaboo visible Codex thread map extracts redacted bounded candidates from snapshot elements", async () => {
  const status = await desktopSee({
    backend: "peekaboo",
    includeSnapshot: true,
    probe: {
      commandStatus: () => ({ available: true, command: "peekaboo", version: "Peekaboo 3.2.2" }),
      activeApplication: () => "Codex",
      commandOutput: (command: string, args: string[] = []) => {
        if (args[0] === "permissions") {
          return { status: 0, command, stdout: JSON.stringify({ success: true, data: { permissions: [] } }) };
        }
        return {
          status: 0,
          command,
          stdout: JSON.stringify({
            success: true,
            data: {
              application_name: "Codex",
              ui_elements: [
                { id: "section", role: "text", label: "Recent", bounds: { x: 20, y: 90, width: 120, height: 20 } },
                { id: "thread-a", role: "button", label: "Lossless OpenClaw Orchestrator Running 2h", bounds: { x: 20, y: 120, width: 280, height: 44 }, is_actionable: true },
                { id: "control", role: "button", label: "Archive chat Pin chat", bounds: { x: 20, y: 170, width: 160, height: 32 }, is_actionable: true },
                { id: "secret", role: "button", label: "Fix /Users/lume/private sk-test_1234567890 Done 1d", bounds: { x: 20, y: 220, width: 280, height: 44 }, is_actionable: true }
              ]
            }
          })
        };
      }
    }
  });

  const threads = status.visibleCodex?.threadMap?.threads ?? [];
  assert.equal(status.visibleCodex?.threadMap?.source, "peekaboo_snapshot");
  assert.equal(status.visibleCodex?.threadMap?.count, 2);
  assert.equal(threads[0]?.title, "Lossless OpenClaw Orchestrator");
  assert.equal(threads[0]?.status, "Running");
  assert.equal(threads[0]?.updatedLabel, "2h");
  assert.equal(threads[0]?.confidence, "high");
  assert.equal(threads[0]?.center?.x, 160);
  assert.equal(threads[0]?.sourceElementId, "thread-a");
  assert.equal(threads.some((thread) => thread.rawTitle.includes("Archive chat")), false);
  assert.equal(threads[1]?.title.includes("/Users/lume"), false);
  assert.equal(threads[1]?.title.includes("sk-test_1234567890"), false);
});

test("Peekaboo visible Codex windows inventory is derived from guarded Codex snapshots", async () => {
  const status = await desktopSee({
    backend: "peekaboo",
    includeSnapshot: true,
    probe: {
      commandStatus: () => ({ available: true, command: "peekaboo", version: "Peekaboo 3.2.2" }),
      activeApplication: () => "Codex",
      commandOutput: (command: string, args: string[] = []) => {
        if (args[0] === "permissions") {
          return { status: 0, command, stdout: JSON.stringify({ success: true, data: { permissions: [] } }) };
        }
        return {
          status: 0,
          command,
          stdout: JSON.stringify({
            success: true,
            data: {
              snapshot_id: "WINDOW-SNAPSHOT",
              application_name: "Codex",
              window_title: "/Users/lume/private sk-test_1234567890",
              ui_elements: []
            }
          })
        };
      }
    }
  });

  const windows = status.visibleCodex?.windows?.windows ?? [];
  assert.equal(status.visibleCodex?.windows?.source, "peekaboo_snapshot");
  assert.equal(status.visibleCodex?.windows?.count, 1);
  assert.equal(windows[0]?.visibleId.startsWith("visible-window-"), true);
  assert.equal(windows[0]?.appName, "Codex");
  assert.equal(windows[0]?.title?.includes("/Users/lume"), false);
  assert.equal(windows[0]?.title?.includes("sk-test_1234567890"), false);
  assert.equal(windows[0]?.snapshotId, "WINDOW-SNAPSHOT");
  assert.equal(windows[0]?.frontmost, true);
});

test("Peekaboo visible Codex metadata is not extracted from non-Codex snapshots", async () => {
  const status = await desktopSee({
    backend: "peekaboo",
    includeSnapshot: true,
    probe: {
      commandStatus: () => ({ available: true, command: "peekaboo", version: "Peekaboo 3.2.2" }),
      activeApplication: () => "Safari",
      commandOutput: (command: string, args: string[] = []) => {
        if (args[0] === "permissions") {
          return { status: 0, command, stdout: JSON.stringify({ success: true, data: { permissions: [] } }) };
        }
        return {
          status: 0,
          command,
          stdout: JSON.stringify({
            success: true,
            data: {
              application_name: "Safari",
              window_title: "Normal browser window",
              ui_elements: [
                { id: "safari-thread-like", role: "button", label: "Lossless OpenClaw Orchestrator Running 2h", is_actionable: true }
              ]
            }
          })
        };
      }
    }
  });

  assert.equal(status.snapshot?.blocked, false);
  assert.equal(status.snapshot?.frontmostApp, "Safari");
  assert.equal(status.visibleCodex?.windows, undefined);
  assert.equal(status.visibleCodex?.threadMap, undefined);
  assert.equal(status.visibleCodex?.macros.some((macro) => macro.name === "codex_windows"), true);
});

test("MCP desktop see passes guarded Peekaboo snapshot options", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-peekaboo-mcp-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const tools = createLooTools({
    db,
    audit,
    codexClient: { request: async () => ({ ok: true }) },
    desktopProbe: {
      commandStatus: () => ({ available: true, command: "peekaboo", version: "Peekaboo 3.2.2" }),
      activeApplication: () => "Codex",
      commandOutput: (command: string, args: string[] = []) => {
        if (args?.[0] === "permissions") {
          return { status: 0, command, stdout: JSON.stringify({ success: true, data: { permissions: [] } }) };
        }
        return {
          status: 0,
          command,
          stdout: JSON.stringify({
            success: true,
            data: {
              application_name: "Codex",
              ui_elements: [
                { id: "elem_1", role: "button", label: "MCP visible thread Running 3h", is_actionable: true },
                { id: "elem_2", role: "button", label: "Overflow", is_actionable: true }
              ]
            }
          })
        };
      }
    }
  });

  try {
    const see = tools.find((tool) => tool.name === "loo_desktop_see");
    assert.ok(see);
    const result = await see.execute({ backend: "peekaboo", include_snapshot: true, max_nodes: 1 }) as {
      snapshot?: { blocked: boolean; elements: Array<{ elementId: string }>; truncated: boolean };
      visibleCodex?: {
        windows?: { count: number; windows: Array<{ appName: string; frontmost: boolean }> };
        threadMap?: { threads: Array<{ title: string; status?: string; updatedLabel?: string }> };
      };
    };
    assert.equal(result.snapshot?.blocked, false);
    assert.deepEqual(result.snapshot?.elements.map((element) => element.elementId), ["elem_1"]);
    assert.equal(result.snapshot?.truncated, true);
    assert.equal(result.visibleCodex?.windows?.count, 1);
    assert.equal(result.visibleCodex?.windows?.windows[0]?.appName, "Codex");
    assert.equal(result.visibleCodex?.windows?.windows[0]?.frontmost, true);
    assert.equal(result.visibleCodex?.threadMap?.threads[0]?.title, "MCP visible thread");
    assert.equal(result.visibleCodex?.threadMap?.threads[0]?.status, "Running");
    assert.equal(result.visibleCodex?.threadMap?.threads[0]?.updatedLabel, "3h");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI desktop see rejects snapshot bounds outside the MCP schema limits", () => {
  const maxNodes = spawnSync(process.execPath, ["--import", "tsx", "packages/cli/src/index.ts", "desktop", "see", "direct", "--snapshot", "--max-nodes", "501"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8"
  });
  const maxChars = spawnSync(process.execPath, ["--import", "tsx", "packages/cli/src/index.ts", "desktop", "see", "direct", "--snapshot", "--max-chars", "20001"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8"
  });

  assert.notEqual(maxNodes.status, 0);
  assert.match(maxNodes.stderr, /--max-nodes requires an integer between 1 and 500/);
  assert.notEqual(maxChars.status, 0);
  assert.match(maxChars.stderr, /--max-chars requires an integer between 1 and 20000/);
});

test("Codex Desktop fallback report routes cli-visible threads to CUA first and Peekaboo second without acting", async () => {
  const report = await createCodexDesktopFallbackReport({
    threadId: "019f1ed4-4c45-70e2-be84-69d93a1be08b",
    coherence: {
      schema: "lco.codex.desktopCoherence.v1",
      publicSafe: true,
      readOnly: true,
      generatedAt: "2026-07-02T00:00:00.000Z",
      threadId: "019f1ed4-4c45-70e2-be84-69d93a1be08b",
      sourceRef: "codex_thread:019f1ed4-4c45-70e2-be84-69d93a1be08b",
      state: "cli_visible",
      visibility: { cli: "proven", desktop: "not_seen" },
      confidence: "medium",
      reasonCodes: ["app_server_match", "desktop_not_seen"],
      evidence: [],
      blockers: [],
      actionsPerformed: {
        liveCodexControlRun: false,
        desktopGuiActionRun: false,
        rawTranscriptRead: false,
        screenshotCaptured: false
      },
      proofBoundary: "fixture",
      nextAction: "route #308 fallback proof"
    },
    probe: {
      commandStatus: (command) => command === "cua-driver"
        ? { available: true, command, version: "cua-driver 0.6.8" }
        : { available: true, command, version: "Peekaboo 3.2.2" },
      activeApplication: () => "Claude",
      commandOutput: (command, args = []) => {
        if (command === "peekaboo" && args[0] === "permissions") {
          return {
            status: 0,
            command,
            stdout: JSON.stringify({
              success: true,
              data: {
                permissions: [
                  { name: "Accessibility", isGranted: true },
                  { name: "Screen Recording", isGranted: false }
                ]
              }
            })
          };
        }
        return { status: 1, command, stderr: "not used" };
      }
    }
  });

  assert.equal(report.schema, "lco.codex.desktopFallback.v1");
  assert.equal(report.publicSafe, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.target.threadId, "019f1ed4-4c45-70e2-be84-69d93a1be08b");
  assert.equal(report.fallback.required, true);
  assert.equal(report.fallback.reason, "desktop_visibility_not_proven");
  assert.equal(report.backends[0]?.backend, "cua-driver");
  assert.equal(report.backends[0]?.role, "preferred_background");
  assert.equal(report.backends[0]?.status, "blocked");
  assert.ok(report.backends[0]?.blockers.includes("permission_state_unknown"));
  assert.ok(report.backends[0]?.blockers.includes("no_focus_codex_visibility_not_proven"));
  assert.equal(report.backends[1]?.backend, "peekaboo");
  assert.equal(report.backends[1]?.role, "secondary_visible_fallback");
  assert.equal(report.backends[1]?.takesScreenWarning, true);
  assert.ok(report.backends[1]?.warnings.some((warning) => warning.includes("may use visible macOS accessibility flows")));
  assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
  assert.equal(report.actionsPerformed.screenshotCaptured, false);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
  assert.equal(report.nextAction.includes("#308"), true);
});

test("Codex Desktop fallback report requires an explicit coherence input when only target refs are supplied", async () => {
  const report = await createCodexDesktopFallbackReport({
    threadId: "019f1ed4-4c45-70e2-be84-69d93a1be08b",
    sourceRef: "codex_thread:019f1ed4-4c45-70e2-be84-69d93a1be08b",
    probe: {
      commandStatus: (command) => ({ available: true, command, version: `${command} test` }),
      activeApplication: () => "Codex"
    }
  });

  assert.equal(report.schema, "lco.codex.desktopFallback.v1");
  assert.equal(report.publicSafe, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.fallback.reason, "coherence_input_missing");
  assert.equal(report.fallback.coherenceState, null);
  assert.equal(report.fallback.desktopVisibility, null);
  assert.ok(report.blockers.includes("coherence_input_missing"));
  assert.deepEqual(report.nextToolCall, {
    tool: "loo_codex_desktop_coherence",
    args: {
      thread_id: "019f1ed4-4c45-70e2-be84-69d93a1be08b",
      source_ref: "codex_thread:019f1ed4-4c45-70e2-be84-69d93a1be08b"
    }
  });
  assert.match(report.nextAction, /loo_codex_desktop_coherence/);
  assert.equal(report.actionsPerformed.desktopGuiActionRun, false);
  assert.equal(report.actionsPerformed.screenshotCaptured, false);
  assert.equal(report.actionsPerformed.liveCodexControlRun, false);
});

test("MCP exposes #308 Codex Desktop fallback status without GUI mutation", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-desktop-fallback-status-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const tools = createLooTools({
    db,
    audit,
    codexClient: { request: async () => ({ ok: true }) },
    desktopProbe: {
      commandStatus: (command) => command === "cua-driver"
        ? { available: true, command, version: "cua-driver 0.6.8" }
        : { available: false, command, error: "not installed" },
      activeApplication: () => "Codex"
    }
  });

  try {
    const tool = tools.find((candidate) => candidate.name === "loo_codex_desktop_fallback_status");
    assert.ok(tool);
    const result = await tool.execute({
      thread_id: "019f1ed4-4c45-70e2-be84-69d93a1be08b",
      coherence: {
        state: "unknown",
        visibility: { cli: "unknown", desktop: "not_seen" },
        confidence: "low"
      }
    }) as { schema: string; actionsPerformed: { desktopGuiActionRun: boolean; screenshotCaptured: boolean }; backends: Array<{ backend: string }> };
    assert.equal(result.schema, "lco.codex.desktopFallback.v1");
    assert.equal(result.actionsPerformed.desktopGuiActionRun, false);
    assert.equal(result.actionsPerformed.screenshotCaptured, false);
    assert.deepEqual(result.backends.map((backend) => backend.backend), ["cua-driver", "peekaboo"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
