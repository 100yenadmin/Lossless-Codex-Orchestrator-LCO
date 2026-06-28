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
