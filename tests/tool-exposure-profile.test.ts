import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuditStore, LOO_COMMAND_POLICY } from "../packages/adapters/src/index.js";
import { createDatabase } from "../packages/core/src/index.js";
import {
  canonicalLooToolName,
  createLooToolDeclarations,
  createLooTools,
  createLooToolSurfaceSummary,
  LOO_TOOL_ALIAS_REGISTRY,
  LOO_TOOL_SURFACE,
  looAliasTargetName,
  parseLooToolProfile,
  withLooToolAliases,
  type LooTool,
  type LooToolDeclaration,
  type LooToolProfile,
  type LooToolTier
} from "../packages/mcp-server/src/tools.js";

const PROFILE_TIERS: Record<LooToolProfile, LooToolTier[]> = {
  facade: ["public_facade"],
  standard: ["public_facade", "workflow_detail"],
  all: ["public_facade", "workflow_detail", "proof_debug", "internal_low_level"]
};

test("invalid LCO_TOOL_PROFILE falls back to the default profile instead of throwing", () => {
  const warnings: string[] = [];

  assert.equal(parseLooToolProfile("facaed", { onInvalid: (value) => warnings.push(value) }), "all");
  assert.equal(parseLooToolProfile(42, { onInvalid: (value) => warnings.push(value) }), "all");
  assert.deepEqual(warnings, ["facaed", "42"]);
});

test("tool exposure profiles filter base declarations from the shared tier map", () => {
  const baseAll = createLooToolDeclarations({ profile: "all", includeAliases: false });
  const baseDefault = createLooToolDeclarations({ includeAliases: false });

  assert.deepEqual(baseDefault.map((tool) => tool.name), baseAll.map((tool) => tool.name));

  for (const [profile, tiers] of Object.entries(PROFILE_TIERS) as Array<[LooToolProfile, LooToolTier[]]>) {
    const declarations = createLooToolDeclarations({ profile, includeAliases: false });
    const expectedNames = expectedBaseNamesForTiers(tiers);

    assert.deepEqual(declarations.map((tool) => tool.name).sort(), expectedNames);
    assert.equal(
      declarations.every((tool) => tiers.includes(tool.metadata.tier)),
      true,
      `${profile} must only expose its allowed tiers`
    );
  }
});

test("standard profile exposes doctor as workflow health detail", () => {
  const facadeNames = createLooToolDeclarations({ profile: "facade", includeAliases: false }).map((tool) => tool.name);
  const standardByName = new Map(createLooToolDeclarations({ profile: "standard", includeAliases: false }).map((tool) => [tool.name, tool]));

  assert.equal(facadeNames.includes("lco_doctor"), false);
  assert.equal(standardByName.get("lco_doctor")?.metadata.tier, "workflow_detail");
});

test("lco-prefixed tools are the canonical base declarations for every tier", () => {
  const baseDeclarations = createLooToolDeclarations({ profile: "all", includeAliases: false });
  const publicFacadeNames = createLooToolSurfaceSummary().publicFacadeTools;

  assert.equal(baseDeclarations.length, 35);
  assert.equal(baseDeclarations.every((tool) => tool.name.startsWith("lco_")), true);
  assert.equal(baseDeclarations.some((tool) => tool.name.startsWith("loo_")), false);
  assert.equal(baseDeclarations.some((tool) => tool.metadata.aliasOf), false);
  assert.deepEqual(publicFacadeNames, [
    "lco_find",
    "lco_prepared_inbox",
    "lco_describe_ref",
    "lco_expand_query",
    "lco_recent_sessions",
    "lco_attention_inbox",
    "lco_project_digest",
    "lco_codex_control_dry_run",
    "lco_codex_resume_thread"
  ]);
});

test("loo compatibility aliases are derived from every lco canonical tool", () => {
  const withAliases = createLooToolDeclarations({ profile: "all", includeAliases: true });
  const baseDeclarations = createLooToolDeclarations({ profile: "all", includeAliases: false });
  const byName = new Map(withAliases.map((tool) => [tool.name, tool]));
  const aliases = withAliases.filter((tool) => tool.metadata.aliasOf && tool.name.startsWith("loo_"));
  const directLegacyAliases = baseDeclarations.map((tool) => toLooAliasName(tool.name));

  assert.deepEqual(
    aliases.map((tool) => tool.name).sort(),
    [...directLegacyAliases, ...Object.keys(FOLDED_LOO_COMPAT_ALIASES)].sort()
  );

  for (const target of baseDeclarations) {
    const aliasName = toLooAliasName(target.name);
    const alias = byName.get(aliasName);
    assert.ok(alias, `${aliasName} must be declared`);
    assert.equal(alias.metadata.aliasOf, target.name);
    assert.deepEqual(alias.metadata, { ...target.metadata, aliasOf: target.name });
    assert.deepEqual(alias.safety, target.safety);
    assert.deepEqual(alias.inputSchema, target.inputSchema);
    assert.equal(alias.description, target.description);
    assert.deepEqual(LOO_TOOL_ALIAS_REGISTRY[aliasName], { targetName: target.name });
  }

  assert.equal(aliases.length, baseDeclarations.length + Object.keys(FOLDED_LOO_COMPAT_ALIASES).length);
  assert.equal(withAliases.some((tool) => tool.name.startsWith("lco_") && tool.metadata.aliasOf), false);
});

test("loo compatibility aliases resolve through the registry", () => {
  for (const [compatName, targetName] of Object.entries(expectedLooCompatibilityTargets())) {
    assert.equal(looAliasTargetName(compatName), targetName);
    assert.equal(canonicalLooToolName(compatName), targetName);
  }

  assert.equal(looAliasTargetName("lco_doctor"), null);
  assert.equal(canonicalLooToolName("lco_doctor"), "lco_doctor");
});

test("C1 lco canonical umbrellas replace folded read-only leaf tools while preserving loo aliases", () => {
  const baseDeclarations = createLooToolDeclarations({ profile: "all", includeAliases: false });
  const aliasedDeclarations = createLooToolDeclarations({ profile: "all", includeAliases: true });
  const baseNames = new Set(baseDeclarations.map((tool) => tool.name));
  const byName = new Map(aliasedDeclarations.map((tool) => [tool.name, tool]));
  const expectedUmbrellas = [
    "lco_watchers",
    "lco_codex_extract",
    "lco_prepared_state",
    "lco_operating_picture",
    "lco_desktop_proof"
  ];

  for (const umbrella of expectedUmbrellas) {
    assert.equal(baseNames.has(umbrella), true, `${umbrella} must be a canonical base tool`);
  }

  for (const [compatName, targetName] of Object.entries(FOLDED_LOO_COMPAT_ALIASES)) {
    assert.equal(baseNames.has(compatName), false, `${compatName} must not be a canonical base tool`);
    assert.equal(looAliasTargetName(compatName), targetName);
    assert.equal(canonicalLooToolName(compatName), targetName);
    assert.equal(byName.get(compatName)?.metadata.aliasOf, targetName);
    assert.deepEqual(byName.get(compatName)?.safety, byName.get(targetName)?.safety);
  }

  assert.equal(baseDeclarations.length, 35);
  assert.equal(aliasedDeclarations.filter((tool) => tool.name.startsWith("lco_") && tool.metadata.aliasOf).length, 0);
  assert.equal(aliasedDeclarations.filter((tool) => tool.name.startsWith("loo_") && tool.metadata.aliasOf).length, 66);
});

test("redirect aliases target any declared tool and merge kind defaults before caller args", async () => {
  const calls: Record<string, unknown>[] = [];
  const tools: LooTool[] = [{
    name: "any_declared_target",
    description: "Synthetic target used to verify general redirect aliases.",
    safety: LOO_COMMAND_POLICY.lco_describe_ref,
    metadata: { tier: "workflow_detail" },
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        kind: { type: "string" },
        limit: { type: "integer" },
        query: { type: "string" }
      }
    },
    execute(input) {
      calls.push(input);
      return { input };
    }
  }];
  const registry = {
    legacy_any_target: {
      targetName: "any_declared_target",
      kindDefaults: {
        kind: "plans",
        limit: 10
      }
    }
  };

  const aliasedTools = withLooToolAliases(tools, registry);
  const alias = aliasedTools.find((tool) => tool.name === "legacy_any_target");
  assert.ok(alias, "synthetic redirect alias must be declared");

  const result = await alias.execute({ limit: 2, query: "user supplied" });

  assert.equal(looAliasTargetName("legacy_any_target", registry), "any_declared_target");
  assert.deepEqual(result, { input: { kind: "plans", limit: 2, query: "user supplied" } });
  assert.deepEqual(calls, [{ kind: "plans", limit: 2, query: "user supplied" }]);
  assert.equal(alias.metadata.aliasOf, "any_declared_target");
  assert.deepEqual(alias.inputSchema, tools[0]!.inputSchema);
});

test("every loo compatibility alias invokes the same handler as its lco target", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-tool-alias-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const tools = createLooTools({
    db,
    audit,
    includeAliases: true,
    codexClient: {
      request: async () => ({ ok: true })
    },
    desktopProbe: {
      commandStatus: (command) => ({ available: false, command, error: "not found" }),
      activeApplication: () => undefined
    }
  });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  try {
    for (const [aliasName, declaration] of Object.entries(LOO_TOOL_ALIAS_REGISTRY)) {
      const target = byName.get(declaration.targetName);
      const alias = byName.get(aliasName);
      assert.ok(target, `${declaration.targetName} must exist`);
      assert.ok(alias, `${aliasName} must exist`);

      const input = sampleInputForTarget(declaration.targetName, root);
      assert.deepEqual(
        await executeForAliasComparison(target, { ...(declaration.kindDefaults ?? {}), ...input }),
        await executeForAliasComparison(alias, input),
        `${aliasName} must invoke identically to ${declaration.targetName}`
      );
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP tools/list applies facade profile and invalid profile fallback", async () => {
  const invalidProfileTools = await readMcpToolList("alll");
  const facadeTools = await readMcpToolList("facade");
  const publicFacadeCount = createLooToolSurfaceSummary().publicFacadeTools.length;
  const allWithAliasesCount = createLooToolDeclarations({ includeAliases: true }).length;

  assert.equal(facadeTools.length >= publicFacadeCount * 2, true);
  assert.equal(invalidProfileTools.length, allWithAliasesCount);

  assert.equal(facadeTools.every((tool) => tool.metadata?.tier === "public_facade"), true);
  assert.ok(invalidProfileTools.some((tool) => tool.name === "lco_session_sanitizer"));
  assert.ok(facadeTools.some((tool) => tool.name === "lco_prepared_inbox" && !tool.metadata?.aliasOf));
  assert.ok(facadeTools.some((tool) => tool.name === "loo_prepared_inbox" && tool.metadata?.aliasOf === "lco_prepared_inbox"));
  assert.equal(facadeTools.some((tool) => tool.name === "loo_session_sanitizer"), false);
});

test("tool surface summary documents exposure filtering as non-gating", () => {
  const summary = createLooToolSurfaceSummary();

  assert.equal(summary.exposureProfile.environmentVariable, "LCO_TOOL_PROFILE");
  assert.equal(summary.exposureProfile.defaultProfile, "all");
  assert.deepEqual(summary.exposureProfile.profiles.facade.tiers, ["public_facade"]);
  assert.match(summary.exposureProfile.profiles.standard.description, /compatibility aliases/i);
  assert.match(summary.exposureProfile.profiles.all.description, /folded historical loo_\* compatibility aliases/i);
  assert.match(summary.exposureProfile.callPolicy, /hidden.*callable/i);
  assert.equal(summary.retrievalTelemetry.environmentVariable, "LCO_TELEMETRY");
  assert.equal(summary.retrievalTelemetry.defaultEnabled, false);
  assert.deepEqual(summary.retrievalTelemetry.mutationClasses, ["derived_cache"]);
  assert.ok(summary.retrievalTelemetry.affectedTools.includes("lco_expand_query"));
  assert.match(summary.retrievalTelemetry.privacyBoundary, /Raw query text is not stored/i);
  assert.match(summary.retrievalTelemetry.privacyBoundary, /telemetry session id/i);
  assert.match(summary.namingPolicy.aliasPolicy, /redirect alias registry/i);
  assert.match(summary.namingPolicy.aliasPolicy, /kindDefaults/i);
  assert.match(summary.namingPolicy.aliasPolicy, /caller arguments override/i);
});

function expectedBaseNamesForTiers(tiers: LooToolTier[]): string[] {
  return Object.entries(LOO_TOOL_SURFACE)
    .filter(([name]) => !LOO_TOOL_ALIAS_REGISTRY[name])
    .filter(([, metadata]) => tiers.includes(metadata.tier))
    .map(([name]) => name)
    .sort();
}

const FOLDED_LOO_COMPAT_ALIASES: Record<string, string> = {
  loo_describe_session: "lco_describe_ref",
  loo_watchers_list: "lco_watchers",
  loo_watcher_status: "lco_watchers",
  loo_watcher_dry_run: "lco_watchers",
  loo_watcher_events: "lco_watchers",
  loo_resume_request_packet: "lco_watchers",
  loo_codex_final_messages: "lco_codex_extract",
  loo_codex_plans: "lco_codex_extract",
  loo_codex_touched_files: "lco_codex_extract",
  loo_codex_tool_calls: "lco_codex_extract",
  loo_summary_leaves: "lco_prepared_state",
  loo_summary_expand: "lco_prepared_state",
  loo_prepared_state_status: "lco_prepared_state",
  loo_prepared_cards: "lco_prepared_state",
  loo_codex_thread_map: "lco_operating_picture",
  loo_codex_session_management_map: "lco_operating_picture",
  loo_cockpit_inbox: "lco_operating_picture",
  loo_codex_collaboration_cockpit: "lco_operating_picture",
  loo_codex_collaboration_next_steps: "lco_operating_picture",
  loo_codex_runtime_desktop_visibility_status: "lco_operating_picture",
  loo_codex_active_thread_state: "lco_operating_picture",
  loo_codex_autonomy_tick: "lco_operating_picture",
  loo_plan_state_pins: "lco_operating_picture",
  loo_github_operating_items: "lco_operating_picture",
  loo_codex_desktop_collaboration_proof: "lco_desktop_proof",
  loo_codex_start_thread_post_create_proof: "lco_desktop_proof",
  loo_codex_desktop_coherence: "lco_desktop_proof",
  loo_codex_desktop_fallback_status: "lco_desktop_proof",
  loo_desktop_see: "lco_desktop_proof",
  loo_desktop_proof_report: "lco_desktop_proof",
  loo_desktop_live_proof_harness: "lco_desktop_proof"
};

function expectedLooCompatibilityTargets(): Record<string, string> {
  return {
    ...Object.fromEntries(createLooToolDeclarations({ profile: "all", includeAliases: false }).map((tool) => [toLooAliasName(tool.name), tool.name])),
    ...FOLDED_LOO_COMPAT_ALIASES
  };
}

function toLooAliasName(name: string): string {
  return name.replace(/^lco_/, "loo_");
}

function sampleInputForTarget(targetName: string, root: string): Record<string, unknown> {
  const now = "2026-07-06T00:00:00.000Z";
  switch (targetName) {
    case "lco_index_sessions":
      return { roots: [join(root, "missing-codex-root")], max_files: 1 };
    case "lco_find":
      return { query: "not found", limit: 1, index: false };
    case "lco_search_sessions":
    case "lco_grep":
    case "lco_expand_query":
      return { query: "not found", limit: 1, now };
    case "lco_describe_ref":
      return { source_ref: "codex_thread:not-found", now };
    case "lco_expand_session":
      return { thread_id: "not-found", token_budget: 100 };
    case "lco_prepared_state":
      return { view: "status" };
    case "lco_recent_sessions":
      return { scope: "recent", limit: 1, now };
    case "lco_watchers":
      return { action: "list", now };
    case "lco_codex_app_server_threads":
      return { limit: 1 };
    case "lco_visible_codex_map":
      return { limit: 1, include_app_server: false };
    case "lco_project_digest":
    case "lco_attention_inbox":
    case "lco_business_pulse":
      return { limit: 1, now };
    case "lco_operating_picture":
      return { kind: "thread_map", limit: 1 };
    case "lco_codex_extract":
      return { kind: "plans", limit: 1 };
    case "lco_codex_sqlite_stores":
      return { roots: [join(root, "missing-codex-root")], max_files: 1 };
    case "lco_lcm_peer_dbs":
      return { lcm_db_paths: [] };
    case "lco_codex_control_dry_run":
      return { action: "send", thread_id: "thr_1", message: "continue" };
    case "lco_codex_start_thread":
      return { message: "start", dry_run: true };
    case "lco_codex_resume_thread":
      return { thread_id: "thr_1", dry_run: true };
    case "lco_codex_send_message":
      return { thread_id: "thr_1", message: "continue", dry_run: true };
    case "lco_codex_steer_thread":
      return { thread_id: "thr_1", expected_turn_id: "turn_1", message: "focus", dry_run: true };
    case "lco_codex_interrupt_thread":
      return { thread_id: "thr_1", dry_run: true };
    case "lco_desktop_proof_action":
      return {
        backend: "cua-driver",
        target_app: "TextEdit",
        target_window: "lco-desktop-proof.txt",
        action: "launch_app TextEdit scratch window",
        execute: false
      };
    case "lco_desktop_proof":
      return { check: "fallback_status", include_visible_snapshot: false, now };
    case "lco_desktop_act":
    case "lco_codex_app_server_status":
    case "lco_prepared_inbox":
    case "lco_closeout_dry_run":
    case "lco_session_sanitizer":
    case "lco_doctor":
    case "lco_permissions":
    case "lco_audit_tail":
      return {};
    default:
      throw new Error(`No sample input for ${targetName}`);
  }
}

async function executeForAliasComparison(
  tool: { execute(input: Record<string, unknown>): Promise<unknown> | unknown },
  input: Record<string, unknown>
): Promise<unknown> {
  try {
    return {
      ok: true,
      value: normalizeAliasResult(await tool.execute(input))
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function normalizeAliasResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeAliasResult);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => {
    if (["approvalAuditId", "approval_audit_id", "packetId", "packet_id", "createdAt", "created_at", "generatedAt", "generated_at", "expiresAt", "expires_at", "auditId", "audit_id"].includes(key)) {
      return [key, "<normalized>"];
    }
    return [key, normalizeAliasResult(child)];
  }));
}

async function readMcpToolList(profile: string | undefined): Promise<Array<Pick<LooToolDeclaration, "name" | "metadata">>> {
  const root = mkdtempSync(join(tmpdir(), "loo-mcp-profile-"));
  const server = spawn(process.execPath, ["--import", "tsx", "packages/mcp-server/src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(profile ? { LCO_TOOL_PROFILE: profile } : {}),
      HOME: root,
      LCO_DB_PATH: join(root, "orchestrator.sqlite"),
      LCO_AUDIT_PATH: join(root, "audit.jsonl"),
      LCO_CODEX_BIN: "lco-codex-not-needed-for-list"
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
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for MCP tools/list. stderr=${stderr}`)), 5_000);
      const cleanup = () => {
        clearTimeout(timeout);
        server.stdout.off("data", onStdout);
        server.off("exit", onExit);
      };
      const onStdout = (chunk: string) => {
        stdout += chunk;
        const newlineIndex = stdout.lastIndexOf("\n");
        if (newlineIndex === -1) return;
        const line = stdout
          .slice(0, newlineIndex)
          .split("\n")
          .find((candidate) => candidate.trim());
        if (!line) return;
        cleanup();
        resolve(line);
      };
      const onExit = (code: number | null) => {
        cleanup();
        reject(new Error(`MCP server exited before tools/list. code=${code} stderr=${stderr}`));
      };
      server.stdout.on("data", onStdout);
      server.once("exit", onExit);
      server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    });
    const response = JSON.parse(outputLine) as { result?: { tools?: Array<Pick<LooToolDeclaration, "name" | "metadata">> } };
    return response.result?.tools ?? [];
  } finally {
    server.kill();
    await new Promise<void>((resolve) => server.once("exit", () => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}
