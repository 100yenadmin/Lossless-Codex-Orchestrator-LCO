import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuditStore, desktopSee } from "../packages/adapters/src/index.js";
import { createDatabase } from "../packages/core/src/index.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";

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
    };
    assert.equal(actResult.backend, "cua-driver");
    assert.equal(actResult.live, false);
    assert.equal(actResult.dryRunOnly, true);
    assert.equal(actResult.approvalRequired, true);

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
