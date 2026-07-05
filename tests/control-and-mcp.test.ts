import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabase } from "../packages/core/src/index.js";
import { LOO_COMMAND_POLICY, createAuditStore, createCodexControl } from "../packages/adapters/src/index.js";
import { createLooToolDeclarations, createLooTools, executeLooToolForOpenClaw } from "../packages/mcp-server/src/tools.js";

test("Codex control requires dry-run audit before live message, steer, resume, or interrupt", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const calls: Array<{ method: string; params: unknown }> = [];
  const control = createCodexControl({
    audit,
    client: {
      request: async (method, params) => {
        calls.push({ method, params });
        return { ok: true };
      }
    }
  });

  try {
    const dryRun = await control.sendMessage({
      threadId: "thr_1",
      message: "continue",
      dryRun: true
    });
    assert.equal(dryRun.live, false);
    assert.match(dryRun.approvalAuditId, /^loo_audit_/);
    assert.match(dryRun.paramsHash, /^[a-f0-9]{64}$/);
    assert.match(dryRun.messageHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(dryRun.messageHash, audit.fingerprintText("continue"));
    assert.notEqual(dryRun.messageHash, sha256("continue"));
    assert.equal(calls.length, 0);

    const repeatedDryRun = await control.sendMessage({
      threadId: "thr_1",
      message: "continue",
      dryRun: true
    });
    assert.equal(repeatedDryRun.messageHash, dryRun.messageHash);

    await assert.rejects(
      () => control.sendMessage({ threadId: "thr_1", message: "continue", dryRun: false }),
      /approval_audit_id is required/
    );
    appendFileSync(audit.path, `${JSON.stringify({
      id: "loo_audit_expired",
      action: dryRun.action,
      target: dryRun.threadId,
      paramsHash: dryRun.paramsHash,
      messageHash: dryRun.messageHash,
      live: false,
      createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString()
    })}\n`);
    await assert.rejects(
      () => control.sendMessage({
        threadId: "thr_1",
        message: "continue",
        dryRun: false,
        approvalAuditId: "loo_audit_expired"
      }),
      /dry-run record expired/
    );
    assert.equal(calls.length, 0);

    await assert.rejects(
      () => control.sendMessage({
        threadId: "thr_1",
        message: "continue",
        dryRun: false,
        approvalAuditId: dryRun.approvalAuditId
      }),
      /same-connection control sequence/
    );
    assert.equal(calls.length, 0);

    const sequenceCalls: Array<Array<{ method: string; params: Record<string, unknown> }>> = [];
    const sequenceControl = createCodexControl({
      audit,
      client: {
        request: async (method, params) => {
          calls.push({ method, params });
          return { ok: true };
        },
        requestSequence: async (steps) => {
          sequenceCalls.push(steps);
          return steps.map((step) => ({ ok: true, method: step.method }));
        }
      }
    });
    const sequenceDryRun = await sequenceControl.sendMessage({
      threadId: "thr_1",
      message: "continue",
      dryRun: true
    });
    const live = await sequenceControl.sendMessage({
      threadId: "thr_1",
      message: "continue",
      dryRun: false,
      approvalAuditId: sequenceDryRun.approvalAuditId
    });
    assert.equal(live.live, true);
    assert.deepEqual(live.methodSequence, ["thread/resume", "turn/start"]);
    assert.deepEqual(sequenceCalls[0]?.map((step) => step.method), ["thread/resume", "turn/start"]);
    assert.deepEqual(sequenceCalls[0]?.[0]?.params, { threadId: "thr_1", excludeTurns: true });
    assert.deepEqual(sequenceCalls[0]?.[1]?.params, { threadId: "thr_1", input: [{ type: "text", text: "continue" }] });
    await assert.rejects(
      () => sequenceControl.sendMessage({
        threadId: "thr_1",
        message: "continue",
        dryRun: false,
        approvalAuditId: live.approvalAuditId
      }),
      /must reference a dry-run/
    );
    assert.equal(calls.length, 0);

    const resumeDryRun = await control.resumeThread({ threadId: "thr_1", dryRun: true });
    assert.equal(resumeDryRun.live, false);
    assert.match(resumeDryRun.paramsHash, /^[a-f0-9]{64}$/);
    assert.equal(resumeDryRun.messageHash, undefined);
    await control.resumeThread({ threadId: "thr_1", dryRun: false, approvalAuditId: resumeDryRun.approvalAuditId });
    assert.equal(calls[0]?.method, "thread/resume");

    assert.throws(
      () => control.steerThread({ threadId: "thr_1", message: "focus on tests", dryRun: true }),
      /expected_turn_id is required/
    );
    const steerDryRun = await control.steerThread({ threadId: "thr_1", message: "focus on tests", expectedTurnId: "turn_1", dryRun: true });
    assert.throws(
      () => control.steerThread({ threadId: "thr_1", message: "focus on tests", dryRun: false, approvalAuditId: steerDryRun.approvalAuditId }),
      /expected_turn_id is required/
    );
    await control.steerThread({ threadId: "thr_1", message: "focus on tests", expectedTurnId: "turn_1", dryRun: false, approvalAuditId: steerDryRun.approvalAuditId });
    assert.equal(calls[1]?.method, "turn/steer");
    assert.deepEqual(calls[1]?.params, { threadId: "thr_1", expectedTurnId: "turn_1", input: [{ type: "text", text: "focus on tests" }] });

    const interruptDryRun = await control.interruptThread({ threadId: "thr_1", dryRun: true });
    await control.interruptThread({ threadId: "thr_1", dryRun: false, approvalAuditId: interruptDryRun.approvalAuditId });
    assert.equal(calls[2]?.method, "turn/interrupt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex control redacts live transport responses before returning them through tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-redaction-"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const control = createCodexControl({
    audit,
    client: {
      request: async () => ({ ok: true }),
      requestSequence: async () => [
        { ok: true },
        { content: `authorization: ${homedir()}/secret sk-test_1234567890` }
      ]
    }
  });

  try {
    const dryRun = await control.sendMessage({ threadId: "thr_1", message: "continue", dryRun: true });
    const live = await control.sendMessage({
      threadId: "thr_1",
      message: "continue",
      dryRun: false,
      approvalAuditId: dryRun.approvalAuditId
    });

    assert.deepEqual(live.response, {
      content: "authorization: <redacted-secret>"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex control rejects failed same-connection sequence responses before live audit", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-sequence-failure-"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const control = createCodexControl({
    audit,
    client: {
      request: async () => ({ ok: true }),
      requestSequence: async () => [
        { ok: false, error: "thread/resume failed before load" }
      ]
    }
  });

  try {
    const dryRun = await control.sendMessage({ threadId: "thr_1", message: "continue", dryRun: true });
    await assert.rejects(
      () => control.sendMessage({
        threadId: "thr_1",
        message: "continue",
        dryRun: false,
        approvalAuditId: dryRun.approvalAuditId
      }),
      /control sequence step failed.*thread\/resume/i
    );

    const auditRecords = readFileSync(audit.path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { live: boolean });
    assert.equal(auditRecords.length, 1);
    assert.equal(auditRecords[0]?.live, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex live send reports transport acceptance as unverified until follow-up proof", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-proof-state-"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const control = createCodexControl({
    audit,
    client: {
      request: async () => ({ ok: true }),
      requestSequence: async (steps) => steps.map((step) => step.method === "turn/start"
        ? { ok: true, result: { turn: { id: "turn_pending", status: "inProgress" } } }
        : { ok: true, result: { thread: { id: "thr_1", loaded: true } } })
    }
  });

  try {
    const dryRun = await control.sendMessage({ threadId: "thr_1", message: "continue", dryRun: true });
    const live = await control.sendMessage({
      threadId: "thr_1",
      message: "continue",
      dryRun: false,
      approvalAuditId: dryRun.approvalAuditId
    });

    assert.equal(live.live, true);
    assert.equal(live.proofState.acceptedByTransport, true);
    assert.equal(live.proofState.started, true);
    assert.equal(live.proofState.completed, false);
    assert.equal(live.proofState.persisted, false);
    assert.equal(live.proofState.unverifiedPending, true);
    assert.equal(live.proofState.status, "unverified_pending");
    assert.equal(live.proofState.turnId, "turn_pending");
    assert.equal(live.proofState.nextProof?.tool, "loo_codex_app_server_threads");
    assert.equal(live.proofState.nextProof?.execute, false);
    assert.deepEqual(live.proofState.nextProof?.args, { read_thread_id: "thr_1", limit: 20 });
    assert.match(live.proofState.callerInstruction, /Transport acceptance is not durable execution/i);
    assert.equal(JSON.stringify(live).includes("continue"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex live send with completed transport status still needs durable follow-up proof", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-proof-completed-"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const control = createCodexControl({
    audit,
    client: {
      request: async () => ({ ok: true }),
      requestSequence: async (steps) => steps.map((step) => step.method === "turn/start"
        ? { ok: true, result: { turn: { id: "turn_completed", status: "completed" } } }
        : { ok: true, result: { thread: { id: "thr_1", loaded: true } } })
    }
  });

  try {
    const dryRun = await control.sendMessage({ threadId: "thr_1", message: "continue", dryRun: true });
    const live = await control.sendMessage({
      threadId: "thr_1",
      message: "continue",
      dryRun: false,
      approvalAuditId: dryRun.approvalAuditId
    });

    assert.equal(live.proofState.completed, true);
    assert.equal(live.proofState.persisted, false);
    assert.equal(live.proofState.unverifiedPending, true);
    assert.equal(live.proofState.status, "unverified_pending");
    assert.deepEqual(live.proofState.nextProof?.args, { read_thread_id: "thr_1", limit: 20 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex start-thread workflow is dry-run first and live creation remains pending proof", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-start-thread-"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const control = createCodexControl({
    audit,
    client: {
      request: async (method, params) => {
        calls.push({ method, params });
        return { ok: true, result: { thread: { id: "thr_created", status: "ready" } } };
      }
    }
  });

  try {
    const defaultDryRun = await control.startThread();
    assert.equal(defaultDryRun.live, false);
    assert.equal(defaultDryRun.proofState.status, "dry_run");
    assert.equal(calls.length, 0);

    const dryRun = await control.startThread({ dryRun: true });
    assert.equal(dryRun.live, false);
    assert.equal(dryRun.action, "codex_start_thread");
    assert.equal(dryRun.threadId, "new_thread");
    assert.equal(dryRun.method, "thread/start");
    assert.equal(dryRun.proofState.status, "dry_run");
    assert.equal(calls.length, 0);

    await assert.rejects(
      () => control.startThread({ dryRun: false }),
      /approval_audit_id is required/
    );
    assert.equal(calls.length, 0);

    const live = await control.startThread({
      dryRun: false,
      approvalAuditId: dryRun.approvalAuditId
    });
    assert.equal(calls[0]?.method, "thread/start");
    assert.deepEqual(calls[0]?.params, {});
    assert.equal(live.live, true);
    assert.equal(live.createdThreadId, "thr_created");
    assert.equal(live.proofState.acceptedByTransport, true);
    assert.equal(live.proofState.started, true);
    assert.equal(live.proofState.completed, false);
    assert.equal(live.proofState.persisted, false);
    assert.equal(live.proofState.unverifiedPending, true);
    assert.equal(live.proofState.status, "unverified_pending");
    assert.equal(live.proofState.threadId, "thr_created");
    assert.equal(live.proofState.nextProof?.tool, "loo_codex_start_thread_post_create_proof");
    assert.deepEqual(live.proofState.nextProof?.args, {
      created_thread_id: "thr_created",
      created_thread_ref: "codex_thread:thr_created",
      limit: 20
    });
    assert.match(live.proofState.callerInstruction, /post-create proof/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex start-thread post-create proof reports public-safe created-but-unindexed coverage", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-start-proof-gap-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const readCalls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const tools = createLooTools({
    db,
    audit,
    codexClient: {
      request: async () => ({ ok: true })
    },
    codexReadClient: {
      request: async (method, params) => {
        readCalls.push({ method, params });
        if (method === "thread/list") {
          return {
            ok: true,
            result: {
              threads: [
                {
                  id: "thr_created",
                  name: "Issue 425 post-create worker",
                  titleAliases: ["issue-425-proof", "parent:thr_parent"],
                  status: "ready",
                  updatedAt: "2026-07-04T10:00:00Z"
                }
              ]
            }
          };
        }
        if (method === "thread/read") {
          return { ok: true, result: { thread: { id: "thr_created", name: "Issue 425 post-create worker", status: "ready" } } };
        }
        throw new Error(`unexpected read method ${method}`);
      }
    }
  });

  try {
    const proofTool = tools.find((tool) => tool.name === "loo_codex_start_thread_post_create_proof");
    assert.ok(proofTool);
    const proof = await proofTool.execute({
      created_thread_id: "thr_created",
      requested_title: "Issue 425 post-create worker",
      alias: "issue-425-proof",
      parent_thread_id: "thr_parent",
      limit: 10
    }) as {
      public_safe: boolean;
      read_only: boolean;
      status: string;
      created_thread_ref: string;
      parent_thread_ref: string;
      proof: {
        app_server: { found: boolean; read_probe_ok: boolean };
        index: { found: boolean; described: boolean };
        prepared_state: { card_available: boolean; coverage_gap: string };
      };
      matched_by: Record<string, boolean>;
      reason_codes: string[];
      actions_performed: Record<string, boolean>;
      proof_boundary: string;
    };
    assert.equal(proof.public_safe, true);
    assert.equal(proof.read_only, true);
    assert.equal(proof.status, "created_but_unindexed");
    assert.equal(proof.created_thread_ref, "codex_thread:thr_created");
    assert.equal(proof.parent_thread_ref, "codex_thread:thr_parent");
    assert.equal(proof.proof.app_server.found, true);
    assert.equal(proof.proof.app_server.read_probe_ok, true);
    assert.equal(proof.proof.index.found, false);
    assert.equal(proof.proof.index.described, false);
    assert.equal(proof.proof.prepared_state.card_available, false);
    assert.equal(proof.proof.prepared_state.coverage_gap, "prepared_card_missing");
    assert.equal(proof.matched_by.raw_id, true);
    assert.equal(proof.matched_by.codex_thread_ref, true);
    assert.equal(proof.matched_by.requested_title, true);
    assert.equal(proof.matched_by.alias, true);
    assert.equal(proof.matched_by.parent_worker_provenance, true);
    assert.deepEqual(readCalls.map((call) => call.method), ["thread/list", "thread/read"]);
    assert.equal(proof.actions_performed.live_codex_control_run, false);
    assert.equal(proof.actions_performed.desktop_gui_action_run, false);
    assert.equal(proof.actions_performed.raw_transcript_read, false);
    assert.match(proof.proof_boundary, /public-safe/i);
    assert.equal(JSON.stringify(proof).includes(root), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex start-thread post-create proof reads the full created thread id even when public output is capped", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-start-proof-long-id-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const longThreadId = `thr_${"x".repeat(220)}`;
  const readCalls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const tools = createLooTools({
    db,
    audit,
    codexClient: {
      request: async () => ({ ok: true })
    },
    codexReadClient: {
      request: async (method, params) => {
        readCalls.push({ method, params });
        if (method === "thread/list") {
          return { ok: true, result: { threads: [] } };
        }
        if (method === "thread/read") {
          assert.equal(params?.threadId, longThreadId);
          return { ok: true, result: { thread: { id: longThreadId, name: "Long id worker", status: "ready" } } };
        }
        throw new Error(`unexpected read method ${method}`);
      }
    }
  });

  try {
    const proofTool = tools.find((tool) => tool.name === "loo_codex_start_thread_post_create_proof");
    assert.ok(proofTool);
    const proof = await proofTool.execute({
      created_thread_id: longThreadId,
      requested_title: "Long id worker",
      limit: 10
    }) as {
      status: string;
      proof: {
        app_server: { found: boolean; read_probe_ok: boolean };
        index: { found: boolean };
      };
      reason_codes: string[];
    };
    assert.deepEqual(readCalls.map((call) => call.method), ["thread/list", "thread/read"]);
    assert.equal(proof.status, "created_but_unindexed");
    assert.equal(proof.proof.app_server.found, true);
    assert.equal(proof.proof.app_server.read_probe_ok, true);
    assert.equal(proof.proof.index.found, false);
    assert.equal(proof.reason_codes.includes("read_probe_found_thread"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex start-thread post-create proof fails closed without created thread id", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-start-proof-missing-id-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const readCalls: string[] = [];
  const tools = createLooTools({
    db,
    audit,
    codexClient: {
      request: async () => ({ ok: true })
    },
    codexReadClient: {
      request: async (method) => {
        readCalls.push(method);
        return { ok: true, result: {} };
      }
    }
  });

  try {
    const proofTool = tools.find((tool) => tool.name === "loo_codex_start_thread_post_create_proof");
    assert.ok(proofTool);
    const proof = await proofTool.execute({ parent_thread_id: "thr_parent" }) as {
      status: string;
      created_thread_ref: string | null;
      parent_thread_ref: string;
      reason_codes: string[];
    };
    assert.equal(proof.status, "unresolved_unknown");
    assert.equal(proof.created_thread_ref, null);
    assert.equal(proof.parent_thread_ref, "codex_thread:thr_parent");
    assert.equal(proof.reason_codes.includes("created_thread_id_missing"), true);
    assert.equal(proof.reason_codes.includes("transport_acceptance_only"), false);
    assert.deepEqual(readCalls, []);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex start-thread post-create proof redacts app-server errors", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-start-proof-errors-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const tools = createLooTools({
    db,
    audit,
    codexClient: {
      request: async () => ({ ok: true })
    },
    codexReadClient: {
      request: async (method) => {
        if (method === "thread/list") {
          return {
            ok: false,
            error: "list failed at /Users/lume/private/project with npm_123456789012345678901234"
          };
        }
        if (method === "thread/read") {
          return {
            ok: false,
            error: "read failed at /Volumes/LEXAR/private/thread.jsonl with Bearer abcdefghijklmnopqrstuvwxyz"
          };
        }
        throw new Error(`unexpected read method ${method}`);
      }
    }
  });

  try {
    const proofTool = tools.find((tool) => tool.name === "loo_codex_start_thread_post_create_proof");
    assert.ok(proofTool);
    const proof = await proofTool.execute({ created_thread_id: "thr_created" }) as {
      status: string;
      proof: { app_server: { errors: string[] } };
    };
    assert.equal(proof.status, "unresolved_unknown");
    assert.equal(proof.proof.app_server.errors.length, 2);
    const serialized = JSON.stringify(proof);
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("/Volumes/LEXAR"), false);
    assert.equal(serialized.includes("npm_123456789012345678901234"), false);
    assert.equal(serialized.includes("abcdefghijklmnopqrstuvwxyz"), false);
    assert.match(serialized, /<redacted-local-path>/);
    assert.match(serialized, /<redacted-secret>/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex start-thread post-create proof does not treat stale prepared card alone as persisted", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-start-proof-stale-card-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  db.prepare(`
    INSERT INTO prepared_cards (
      card_id, card_ref, target_ref, card_kind, title, summary_text, next_action,
      source_refs_json, source_range_refs_json, source_range_refs_omitted,
      authority_coverage_json, input_hash, extractor_version, privacy_class,
      confidence, freshness_at, stale, state, reason_codes_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "card-stale-thr_created",
    "prepared_card:33333333333333333333333333333333",
    "codex_thread:thr_created",
    "codex_session",
    "Stale created worker",
    "Prepared state is stale and cannot prove persistence.",
    "Refresh before use.",
    JSON.stringify(["codex_thread:thr_created"]),
    JSON.stringify([]),
    0,
    JSON.stringify({
      summaryLeaves: { status: "partial", leafCount: 1, rangeCount: 1 },
      sessionMetadata: { status: "unknown" },
      watcherObservations: { status: "not_configured" }
    }),
    "44444444444444444444444444444444",
    "prepared-cards-v1",
    "public_safe_metadata",
    0.42,
    "2026-07-04T09:00:00Z",
    1,
    "stale",
    JSON.stringify(["stale_cache"]),
    "2026-07-04T09:00:00Z",
    "2026-07-04T09:00:00Z"
  );
  const tools = createLooTools({
    db,
    audit,
    codexClient: {
      request: async () => ({ ok: true })
    },
    codexReadClient: {
      request: async (method) => {
        if (method === "thread/list") return { ok: true, result: { threads: [] } };
        if (method === "thread/read") return { ok: false, error: "thread/read not found" };
        throw new Error(`unexpected read method ${method}`);
      }
    }
  });

  try {
    const proofTool = tools.find((tool) => tool.name === "loo_codex_start_thread_post_create_proof");
    assert.ok(proofTool);
    const proof = await proofTool.execute({ created_thread_id: "thr_created" }) as {
      status: string;
      proof: {
        prepared_state: {
          card_available: boolean;
          card_current: boolean;
          stale: boolean;
          coverage_gap: string;
        };
      };
      prepared_card_ref: string;
      reason_codes: string[];
    };
    assert.equal(proof.status, "unresolved_unknown");
    assert.equal(proof.proof.prepared_state.card_available, true);
    assert.equal(proof.proof.prepared_state.card_current, false);
    assert.equal(proof.proof.prepared_state.stale, true);
    assert.equal(proof.proof.prepared_state.coverage_gap, "prepared_card_stale_or_not_ready");
    assert.equal(proof.prepared_card_ref, "prepared_card:33333333333333333333333333333333");
    assert.equal(proof.reason_codes.includes("prepared_card_stale_or_not_ready"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex start-thread post-create proof classifies indexed described persisted proof without raw paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-control-start-proof-indexed-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  db.prepare(`
    INSERT INTO codex_sessions (
      thread_id, title, cwd, model, branch, git_sha, source_path, created_at, updated_at,
      summary, final_message, safe_text, event_count, tool_call_count, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "thr_created",
    "Issue 425 post-create worker",
    "/Users/lume/private/project",
    "gpt-5",
    "issue-425-post-create-proof",
    "abc123",
    "/Users/lume/.codex/sessions/raw/private-thread.jsonl",
    "2026-07-04T10:00:00Z",
    "2026-07-04T10:01:00Z",
    "Public-safe summary for the created worker.",
    "Final: post-create worker proof complete.",
    "Issue 425 post-create worker parent:thr_parent issue-425-proof",
    4,
    0,
    "2026-07-04T10:02:00Z"
  );
  db.prepare(`
    INSERT INTO prepared_cards (
      card_id, card_ref, target_ref, card_kind, title, summary_text, next_action,
      source_refs_json, source_range_refs_json, source_range_refs_omitted,
      authority_coverage_json, input_hash, extractor_version, privacy_class,
      confidence, freshness_at, stale, state, reason_codes_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "card-thr_created",
    "prepared_card:11111111111111111111111111111111",
    "codex_thread:thr_created",
    "codex_session",
    "Issue 425 post-create worker",
    "Prepared state: created worker has public-safe card.",
    "Use read-only evidence only.",
    JSON.stringify(["codex_thread:thr_created"]),
    JSON.stringify([]),
    0,
    JSON.stringify({
      summaryLeaves: { status: "ok", leafCount: 1, rangeCount: 1 },
      sessionMetadata: { status: "ok" },
      watcherObservations: { status: "not_configured" }
    }),
    "22222222222222222222222222222222",
    "prepared-cards-v1",
    "public_safe_metadata",
    0.91,
    "2026-07-04T10:03:00Z",
    0,
    "ready",
    JSON.stringify(["post_create_proof"]),
    "2026-07-04T10:03:00Z",
    "2026-07-04T10:03:00Z"
  );
  const tools = createLooTools({
    db,
    audit,
    codexClient: {
      request: async () => ({ ok: true })
    },
    codexReadClient: {
      request: async (method) => {
        if (method === "thread/list") {
          return { ok: true, result: { threads: [{ id: "thr_created", name: "Issue 425 post-create worker", titleAliases: ["issue-425-proof", "parent:thr_parent"], status: "ready" }] } };
        }
        if (method === "thread/read") {
          return { ok: true, result: { thread: { id: "thr_created", name: "Issue 425 post-create worker", status: "ready" } } };
        }
        throw new Error(`unexpected read method ${method}`);
      }
    }
  });

  try {
    const proofTool = tools.find((tool) => tool.name === "loo_codex_start_thread_post_create_proof");
    assert.ok(proofTool);
    const proof = await proofTool.execute({
      created_thread_ref: "codex_thread:thr_created",
      requested_title: "Issue 425 post-create worker",
      alias: "issue-425-proof",
      parent_thread_id: "thr_parent",
      limit: 10
    }) as {
      status: string;
      proof: {
        app_server: { found: boolean; read_probe_ok: boolean };
        index: { found: boolean; described: boolean };
        prepared_state: { card_available: boolean; coverage_gap: string | null };
      };
      prepared_card_ref: string;
      reason_codes: string[];
      proof_boundary: string;
    };
    assert.equal(proof.status, "persisted");
    assert.equal(proof.proof.app_server.found, true);
    assert.equal(proof.proof.app_server.read_probe_ok, true);
    assert.equal(proof.proof.index.found, true);
    assert.equal(proof.proof.index.described, true);
    assert.equal(proof.proof.prepared_state.card_available, true);
    assert.equal(proof.proof.prepared_state.coverage_gap, null);
    assert.equal(proof.prepared_card_ref, "prepared_card:11111111111111111111111111111111");
    assert.equal(proof.reason_codes.includes("prepared_card_available"), true);
    assert.equal(JSON.stringify(proof).includes("/Users/lume"), false);
    assert.equal(JSON.stringify(proof).includes("private-thread.jsonl"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP tool registry exposes loo-prefixed tools with local-only control safety", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-mcp-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const codexRequests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const tools = createLooTools({
    db,
    audit,
    codexClient: {
      request: async (method, params) => {
        codexRequests.push({ method, params });
        return { ok: true, result: { thread: { id: "thr_created", status: "ready" } } };
      }
    }
  });

  try {
    const toolNames = tools.map((tool) => tool.name).sort();
    const declaredToolNames = createLooToolDeclarations().map((tool) => tool.name).sort();
    assert.deepEqual(declaredToolNames, toolNames);
    assert.equal(toolNames.includes("loo_index_sessions"), true);
    assert.equal(toolNames.includes("loo_grep"), true);
    assert.equal(toolNames.includes("loo_search_sessions"), true);
    assert.equal(toolNames.includes("loo_describe_ref"), true);
    assert.equal(toolNames.includes("loo_closeout_dry_run"), true);
    assert.equal(toolNames.includes("loo_codex_start_thread"), true);
    assert.equal(toolNames.includes("loo_codex_send_message"), true);
    assert.equal(toolNames.includes("loo_desktop_see"), true);
    assert.deepEqual(toolNames.filter((name) => !LOO_COMMAND_POLICY[name]), []);
    for (const declaration of createLooToolDeclarations()) {
      assert.deepEqual(declaration.safety, LOO_COMMAND_POLICY[declaration.name]);
      assert.ok(Array.isArray(declaration.safety.mutationClasses));
    }
    assert.equal(LOO_COMMAND_POLICY.loo_index_sessions.mode, "local_cache_write");
    assert.deepEqual(LOO_COMMAND_POLICY.loo_index_sessions.mutationClasses, ["derived_cache"]);
    for (const telemetryAwareTool of [
      "loo_search_sessions",
      "loo_grep",
      "loo_describe_session",
      "loo_describe_ref",
      "loo_expand_session",
      "loo_expand_query"
    ]) {
      assert.equal(LOO_COMMAND_POLICY[telemetryAwareTool]?.mode, "local_cache_write");
      assert.deepEqual(LOO_COMMAND_POLICY[telemetryAwareTool]?.mutationClasses, ["derived_cache"]);
    }
    assert.equal(LOO_COMMAND_POLICY.loo_index_sessions.mutationClasses.includes("source_store"), false);
    assert.equal(LOO_COMMAND_POLICY.loo_index_sessions.mutationClasses.includes("external_system"), false);
    assert.equal(LOO_COMMAND_POLICY.loo_index_sessions.mutationClasses.includes("live_control"), false);
    assert.equal(LOO_COMMAND_POLICY.loo_codex_control_dry_run.mode, "local_cache_write");
    assert.deepEqual(LOO_COMMAND_POLICY.loo_codex_control_dry_run.mutationClasses, ["derived_cache"]);
    assert.deepEqual(LOO_COMMAND_POLICY.loo_codex_start_thread.mutationClasses, ["derived_cache", "live_control"]);
    assert.deepEqual(LOO_COMMAND_POLICY.loo_watchers_list.mutationClasses, []);
    assert.deepEqual(LOO_COMMAND_POLICY.loo_watcher_status.mutationClasses, []);
    assert.deepEqual(LOO_COMMAND_POLICY.loo_watcher_dry_run.mutationClasses, []);
    assert.deepEqual(LOO_COMMAND_POLICY.loo_resume_request_packet.mutationClasses, []);
    assert.deepEqual(LOO_COMMAND_POLICY.loo_codex_send_message.mutationClasses, ["derived_cache", "live_control"]);
    assert.deepEqual(LOO_COMMAND_POLICY.loo_desktop_proof_action.mutationClasses, ["derived_cache", "desktop_gui"]);

    const closeoutTool = tools.find((tool) => tool.name === "loo_closeout_dry_run");
    assert.ok(closeoutTool);
    const closeoutReport = closeoutTool.execute({ limit: 5 }) as {
      dryRun: boolean;
      mutatesCodex: boolean;
      summary: { total: number };
    };
    assert.equal(closeoutReport.dryRun, true);
    assert.equal(closeoutReport.mutatesCodex, false);
    assert.equal(closeoutReport.summary.total, 0);

    db.prepare(`
      INSERT INTO codex_sessions (thread_id, title, source_path, indexed_at, safe_text, event_count, tool_call_count)
      VALUES (?, ?, ?, ?, '', 0, 0)
    `).run(
      "thr_unavailable_closeout",
      "Unavailable closeout seed",
      join(root, "seed.jsonl"),
      "2026-06-29T00:00:00Z"
    );
    const mappedCloseoutReport = closeoutTool.execute({
      thread_id: "thr_unavailable_closeout",
      include_unavailable: true
    }) as {
      dryRun: boolean;
      summary: { total: number; unavailable: number };
      candidates: Array<{ threadId: string; state: string; wouldAttach: boolean }>;
    };
    assert.equal(mappedCloseoutReport.dryRun, true);
    assert.equal(mappedCloseoutReport.summary.total, 1);
    assert.equal(mappedCloseoutReport.summary.unavailable, 1);
    assert.equal(mappedCloseoutReport.candidates[0]?.threadId, "thr_unavailable_closeout");
    assert.equal(mappedCloseoutReport.candidates[0]?.state, "unavailable");
    assert.equal(mappedCloseoutReport.candidates[0]?.wouldAttach, false);

    const sendTool = tools.find((tool) => tool.name === "loo_codex_send_message");
    assert.ok(sendTool);
    const dryRun = await sendTool.execute({ thread_id: "thr_1", message: "continue", dry_run: true }) as {
      live: boolean;
      approval_audit_id: string;
      params_hash: string;
      message_hash: string;
      approval_packet: {
        action: string;
        methodSequence: string[];
        predictedMutation: string[];
      };
    };
    assert.equal(dryRun.live, false);
    assert.match(dryRun.approval_audit_id, /^loo_audit_/);
    assert.match(dryRun.params_hash, /^[a-f0-9]{64}$/);
    assert.match(dryRun.message_hash, /^[a-f0-9]{64}$/);
    assert.equal(dryRun.message_hash, audit.fingerprintText("continue"));
    assert.notEqual(dryRun.message_hash, sha256("continue"));
    assert.equal(dryRun.approval_packet.action, "send_message");
    assert.deepEqual(dryRun.approval_packet.methodSequence, ["thread/resume", "turn/start"]);
    assert.deepEqual(dryRun.approval_packet.predictedMutation, ["thread/resume", "turn/start"]);

    const dryRunTool = tools.find((tool) => tool.name === "loo_codex_control_dry_run");
    assert.ok(dryRunTool);
    const genericDryRun = await dryRunTool.execute({ action: "send", thread_id: "thr_1", message: "continue" }) as {
      approval_audit_id: string;
      params_hash: string;
      message_hash: string;
    };
    assert.match(genericDryRun.approval_audit_id, /^loo_audit_/);
    assert.match(genericDryRun.params_hash, /^[a-f0-9]{64}$/);
    assert.match(genericDryRun.message_hash, /^[a-f0-9]{64}$/);
    assert.equal(genericDryRun.message_hash, audit.fingerprintText("continue"));
    assert.notEqual(genericDryRun.message_hash, sha256("continue"));
    assert.equal(genericDryRun.message_hash, dryRun.message_hash);

    const startTool = tools.find((tool) => tool.name === "loo_codex_start_thread");
    assert.ok(startTool);
    const startDryRun = await startTool.execute({}) as {
      live: boolean;
      action: string;
      thread_id: string;
      approval_audit_id: string;
      proof_state: { status: string };
      approval_packet: { action: string; predictedMutation: string[] };
    };
    assert.equal(startDryRun.live, false);
    assert.equal(startDryRun.action, "codex_start_thread");
    assert.equal(startDryRun.thread_id, "new_thread");
    assert.equal(startDryRun.proof_state.status, "dry_run");
    assert.equal(startDryRun.approval_packet.action, "start_thread");
    assert.deepEqual(startDryRun.approval_packet.predictedMutation, ["thread/start"]);
    await assert.rejects(
      async () => await startTool.execute({ dry_run: false }),
      /approval_audit_id is required/
    );
    const startLive = await startTool.execute({
      dry_run: false,
      approval_audit_id: startDryRun.approval_audit_id
    }) as {
      live: boolean;
      created_thread_id: string;
      proof_state: {
        status: string;
        accepted_by_transport: boolean;
        completed: boolean;
        persisted: boolean;
        unverified_pending: boolean;
        next_proof: { tool: string; execute: boolean; args: Record<string, unknown> };
      };
    };
    assert.equal(codexRequests.at(-1)?.method, "thread/start");
    assert.equal(startLive.live, true);
    assert.equal(startLive.created_thread_id, "thr_created");
    assert.equal(startLive.proof_state.accepted_by_transport, true);
    assert.equal(startLive.proof_state.completed, false);
    assert.equal(startLive.proof_state.persisted, false);
    assert.equal(startLive.proof_state.unverified_pending, true);
    assert.equal(startLive.proof_state.status, "unverified_pending");
    assert.equal(startLive.proof_state.next_proof.tool, "loo_codex_start_thread_post_create_proof");
    assert.deepEqual(startLive.proof_state.next_proof.args, {
      created_thread_id: "thr_created",
      created_thread_ref: "codex_thread:thr_created",
      limit: 20
    });

    const steerTool = tools.find((tool) => tool.name === "loo_codex_steer_thread");
    assert.ok(steerTool);
    assert.ok((steerTool.inputSchema.properties as Record<string, unknown>).expected_turn_id);
    const dryRunToolSchema = dryRunTool.inputSchema.properties as Record<string, unknown>;
    assert.ok(dryRunToolSchema.expected_turn_id);
    assert.throws(
      () => dryRunTool.execute({ action: "send", thread_id: "thr_1" }),
      /message is required/
    );
    assert.throws(
      () => dryRunTool.execute({ action: "steer", thread_id: "thr_1", expected_turn_id: "turn_1" }),
      /message is required/
    );
    assert.throws(
      () => steerTool.execute({ thread_id: "thr_1", message: "focus", dry_run: true }),
      /expected_turn_id is required/
    );
    const gatewayValidation = await executeLooToolForOpenClaw(steerTool, {
      thread_id: "thr_1",
      message: "focus",
      dry_run: true
    }) as { ok: boolean; code?: string; error?: { code?: string; message?: string } };
    assert.equal(gatewayValidation.ok, false);
    assert.equal(gatewayValidation.code, "validation_failed");
    assert.equal(gatewayValidation.error?.code, "validation_failed");
    assert.equal(gatewayValidation.error?.message, "expected_turn_id is required");
    assertNoRawLocalPaths(gatewayValidation);
    const genericSteerDryRun = await dryRunTool.execute({
      action: "steer",
      thread_id: "thr_1",
      message: "focus",
      expected_turn_id: "turn_1"
    }) as { method: string; action: string; approval_packet: { action: string } };
    assert.equal(genericSteerDryRun.method, "turn/steer");
    assert.equal(genericSteerDryRun.action, "codex_steer_thread");
    assert.equal(genericSteerDryRun.approval_packet.action, "steer_thread");

    const genericStartDryRun = await dryRunTool.execute({ action: "start" }) as {
      method: string;
      action: string;
      approval_packet: { action: string };
      proof_state: { status: string };
    };
    assert.equal(genericStartDryRun.method, "thread/start");
    assert.equal(genericStartDryRun.action, "codex_start_thread");
    assert.equal(genericStartDryRun.approval_packet.action, "start_thread");
    assert.equal(genericStartDryRun.proof_state.status, "dry_run");

    appendFileSync(audit.path, "{malformed audit jsonl\n");

    const auditTailTool = tools.find((tool) => tool.name === "loo_audit_tail");
    assert.ok(auditTailTool);
    const auditTail = await auditTailTool.execute({ limit: 5 }) as {
      auditPath: string;
      auditRef: string;
      records: Array<{ id: string; paramsHash: string; messageHash?: string }>;
    };
    assert.equal(auditTail.auditPath, "<redacted-local-path>/audit.jsonl");
    assert.equal(auditTail.auditRef, "loo_audit_store:audit.jsonl");
    assert.equal(auditTail.records.some((record) => record.id === genericDryRun.approval_audit_id), true);
    assert.equal(auditTail.records.some((record) => record.paramsHash === genericDryRun.params_hash), true);
    assert.equal(JSON.stringify(auditTail).includes("continue"), false);
    assertNoRawLocalPaths(auditTail);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP stdio tools/list exposes facade metadata in the runtime catalog", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-mcp-list-"));
  const server = spawn(process.execPath, ["--import", "tsx", "packages/mcp-server/src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: root,
      LOO_DB_PATH: join(root, "orchestrator.sqlite"),
      LOO_AUDIT_PATH: join(root, "audit.jsonl"),
      LOO_CODEX_BIN: "loo-codex-not-needed-for-list"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    const outputLine = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for MCP tools/list response. stderr=${stderr}`));
      }, 5_000);
      const cleanup = () => {
        clearTimeout(timeout);
        server.stdout.off("data", onStdout);
        server.off("exit", onExit);
      };
      const onStdout = (chunk: string) => {
        stdout += chunk;
        const line = stdout.split("\n").find((candidate) => candidate.trim());
        if (line) {
          cleanup();
          resolve(line);
        }
      };
      const onExit = (code: number | null) => {
        cleanup();
        reject(new Error(`MCP server exited before tools/list response. code=${code} stderr=${stderr}`));
      };
      server.stdout.on("data", onStdout);
      server.once("exit", onExit);
      server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    });
    const response = JSON.parse(outputLine) as { result?: unknown };
    const tools = (response.result as { tools?: Array<{ name?: string; metadata?: { tier?: string; operatorPathRank?: number } }> }).tools ?? [];
    const preparedInbox = tools.find((tool) => tool.name === "loo_prepared_inbox");
    const debugTool = tools.find((tool) => tool.name === "loo_session_sanitizer");

    assert.equal(preparedInbox?.metadata?.tier, "public_facade");
    assert.equal(preparedInbox?.metadata?.operatorPathRank, 1);
    assert.equal(debugTool?.metadata?.tier, "proof_debug");
  } finally {
    server.kill();
    await new Promise<void>((resolve) => server.once("exit", () => resolve()));
    rmSync(root, { recursive: true, force: true });
  }

  assert.doesNotMatch(stderr, /Unhandled|uncaught|ERR_UNHANDLED/i);
});

test("MCP stdio server returns JSON-RPC errors for malformed input frames", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-mcp-stdio-"));
  const server = spawn(process.execPath, [
    "--import",
    "tsx",
    join(process.cwd(), "packages/mcp-server/src/server.ts")
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: root,
      LOO_DB_PATH: join(root, "orchestrator.sqlite"),
      LOO_AUDIT_PATH: join(root, "audit.jsonl"),
      LOO_CODEX_BIN: "loo-codex-not-needed-for-parse-error"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    const outputLine = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for MCP parse error response. stderr=${stderr}`));
      }, 5_000);
      const cleanup = () => {
        clearTimeout(timeout);
        server.stdout.off("data", onStdout);
        server.off("exit", onExit);
      };
      const onStdout = (chunk: string) => {
        stdout += chunk;
        const line = stdout.split("\n").find((candidate) => candidate.trim());
        if (line) {
          cleanup();
          resolve(line);
        }
      };
      const onExit = (code: number | null) => {
        cleanup();
        reject(new Error(`MCP server exited before parse error response. code=${code} stderr=${stderr}`));
      };
      server.stdout.on("data", onStdout);
      server.once("exit", onExit);
      server.stdin.write("{\n");
    });

    const response = JSON.parse(outputLine) as { jsonrpc?: string; id?: unknown; error?: { code?: number; message?: string } };
    assert.equal(response.jsonrpc, "2.0");
    assert.equal(response.id, null);
    assert.equal(response.error?.code, -32000);
    assert.match(response.error?.message ?? "", /JSON|Expected|Unexpected/i);
    assert.doesNotMatch(stderr, /Unhandled|uncaught|ERR_UNHANDLED/i);
  } finally {
    server.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Audit fingerprint key is memoized after first use", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-audit-key-"));
  const audit = createAuditStore(join(root, "audit.jsonl"));

  try {
    const first = audit.fingerprintText("continue");
    writeFileSync(`${audit.path}.key`, `${"0".repeat(64)}\n`);
    assert.equal(audit.fingerprintText("continue"), first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertNoRawLocalPaths(value: unknown): void {
  assert.doesNotMatch(
    JSON.stringify(value),
    /(?:\/Volumes\/|\/Users\/|\/private\/|\/var\/folders\/|\/tmp\/|[A-Za-z]:\\)/,
    "public tool output must not expose raw local filesystem paths"
  );
}
