import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateWorkingAppRuntimeProof } from "../packages/cli/src/runtime-proof-gate.js";

function writeProof(dir: string, scenarioId: string, proofMarkers: Record<string, boolean>, counts: Record<string, number>): void {
  writeFileSync(join(dir, `${scenarioId}.runtime-proof.json`), `${JSON.stringify({
    kind: "loo_runtime_scenario_proof",
    scenario_id: scenarioId,
    scenario_version: "1.1",
    proof_mode: "runtime_required",
    claim_scope: "codex-working-app-proof",
    public_safe: true,
    proof_markers: proofMarkers,
    raw_transcript_read: false,
    raw_prompt_included: false,
    raw_secret_included: false,
    screenshot_included: false,
    sqlite_included: false,
    ...counts
  }, null, 2)}\n`);
}

function writePostActionProof(dir: string): void {
  writeProof(dir, "post-action-refresh-reasoning-v1-1", {
    agent_reasoning_note: true,
    post_action_refresh: true,
    source_refs: true
  }, { raw_transcript_spans: 0 });
}

test("working-app runtime proof requires one gateway live action", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-runtime-proof-gate-"));
  try {
    writePostActionProof(dir);
    writeProof(dir, "openclaw-gateway-live-codex-v1-1", {
      installed_gateway_path: true,
      matching_approval_audit_id: true,
      public_safe_scan: true
    }, {
      live_action_count: 0,
      raw_prompt_chars: 0
    });

    const blocked = validateWorkingAppRuntimeProof(dir);
    assert.equal(blocked.ok, false);
    assert.ok(blocked.blockers.includes("runtime_proof_below_minimum:openclaw-gateway-live-codex-v1-1:live_action_count"));

    writeProof(dir, "openclaw-gateway-live-codex-v1-1", {
      installed_gateway_path: true,
      matching_approval_audit_id: true,
      public_safe_scan: true
    }, {
      live_action_count: 1,
      raw_prompt_chars: 0
    });

    const ready = validateWorkingAppRuntimeProof(dir);
    assert.equal(ready.ok, true);
    assert.deepEqual(ready.blockers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
