import assert from "node:assert/strict";
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
    transport: "stdio"
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
      desktopFallbacks: { preferred: string; backends: Array<{ backend: string; launch: { command: string; args: string[] } }> };
    };
    assert.equal(doctorResult.desktopFallbacks.preferred, "cua-driver");
    assert.equal(doctorResult.desktopFallbacks.backends.some((backend) => backend.backend === "cua-driver" && backend.launch.command === "cua-driver"), true);

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
