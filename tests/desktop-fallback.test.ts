import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
                { id: "elem_1", role: "button", label: "Continue", is_actionable: true },
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
    };
    assert.equal(result.snapshot?.blocked, false);
    assert.deepEqual(result.snapshot?.elements.map((element) => element.elementId), ["elem_1"]);
    assert.equal(result.snapshot?.truncated, true);
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
