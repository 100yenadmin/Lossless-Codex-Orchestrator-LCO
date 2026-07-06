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

test("invalid LOO_TOOL_PROFILE falls back to the default profile instead of throwing", () => {
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

  assert.equal(facadeNames.includes("loo_doctor"), false);
  assert.equal(standardByName.get("loo_doctor")?.metadata.tier, "workflow_detail");
});

test("facade lco aliases are derived exactly from public facade tools", () => {
  const withAliases = createLooToolDeclarations({ profile: "all", includeAliases: true });
  const byName = new Map(withAliases.map((tool) => [tool.name, tool]));
  const aliases = withAliases.filter((tool) => tool.metadata.aliasOf && tool.name.startsWith("lco_"));
  const publicFacadeNames = createLooToolSurfaceSummary().publicFacadeTools;

  assert.deepEqual(
    aliases.map((tool) => tool.name).sort(),
    publicFacadeNames.map(toLcoAliasName).sort()
  );

  for (const targetName of publicFacadeNames) {
    const aliasName = toLcoAliasName(targetName);
    const alias = byName.get(aliasName);
    const target = byName.get(targetName);
    assert.ok(alias, `${aliasName} must be declared`);
    assert.ok(target, `${targetName} must be declared`);
    assert.equal(alias.metadata.aliasOf, targetName);
    assert.deepEqual(alias.metadata, { ...target.metadata, aliasOf: targetName });
    assert.equal(alias.metadata.tier, "public_facade");
    assert.deepEqual(alias.safety, target.safety);
    assert.deepEqual(alias.inputSchema, target.inputSchema);
    assert.equal(alias.description, target.description);
  }

  assert.equal(aliases.length, 8);
  assert.equal(aliases.some((tool) => tool.metadata.aliasOf && tool.metadata.tier !== "public_facade"), false);
});

test("facade lco aliases resolve through the registry", () => {
  const publicFacadeNames = createLooToolSurfaceSummary().publicFacadeTools;

  for (const targetName of publicFacadeNames) {
    const aliasName = toLcoAliasName(targetName);
    assert.deepEqual(LOO_TOOL_ALIAS_REGISTRY[aliasName], { targetName });
    assert.equal(looAliasTargetName(aliasName), targetName);
    assert.equal(canonicalLooToolName(aliasName), targetName);
  }

  assert.equal(looAliasTargetName("lco_doctor"), null);
  assert.equal(canonicalLooToolName("lco_doctor"), "lco_doctor");
});

test("C1 canonical umbrellas replace folded read-only leaf tools while preserving compatibility aliases", () => {
  const baseDeclarations = createLooToolDeclarations({ profile: "all", includeAliases: false });
  const aliasedDeclarations = createLooToolDeclarations({ profile: "all", includeAliases: true });
  const baseNames = new Set(baseDeclarations.map((tool) => tool.name));
  const byName = new Map(aliasedDeclarations.map((tool) => [tool.name, tool]));
  const expectedUmbrellas = [
    "loo_watchers",
    "loo_codex_extract",
    "loo_prepared_state",
    "loo_operating_picture",
    "loo_desktop_proof"
  ];
  const expectedCompatAliases: Record<string, string> = {
    loo_describe_session: "loo_describe_ref",
    loo_watchers_list: "loo_watchers",
    loo_watcher_status: "loo_watchers",
    loo_watcher_dry_run: "loo_watchers",
    loo_watcher_events: "loo_watchers",
    loo_resume_request_packet: "loo_watchers",
    loo_codex_final_messages: "loo_codex_extract",
    loo_codex_plans: "loo_codex_extract",
    loo_codex_touched_files: "loo_codex_extract",
    loo_codex_tool_calls: "loo_codex_extract",
    loo_summary_leaves: "loo_prepared_state",
    loo_summary_expand: "loo_prepared_state",
    loo_prepared_state_status: "loo_prepared_state",
    loo_prepared_cards: "loo_prepared_state",
    loo_codex_thread_map: "loo_operating_picture",
    loo_codex_session_management_map: "loo_operating_picture",
    loo_cockpit_inbox: "loo_operating_picture",
    loo_codex_collaboration_cockpit: "loo_operating_picture",
    loo_codex_collaboration_next_steps: "loo_operating_picture",
    loo_codex_runtime_desktop_visibility_status: "loo_operating_picture",
    loo_codex_active_thread_state: "loo_operating_picture",
    loo_codex_autonomy_tick: "loo_operating_picture",
    loo_plan_state_pins: "loo_operating_picture",
    loo_github_operating_items: "loo_operating_picture",
    loo_codex_desktop_collaboration_proof: "loo_desktop_proof",
    loo_codex_start_thread_post_create_proof: "loo_desktop_proof",
    loo_codex_desktop_coherence: "loo_desktop_proof",
    loo_codex_desktop_fallback_status: "loo_desktop_proof",
    loo_desktop_see: "loo_desktop_proof",
    loo_desktop_proof_report: "loo_desktop_proof",
    loo_desktop_live_proof_harness: "loo_desktop_proof"
  };

  for (const umbrella of expectedUmbrellas) {
    assert.equal(baseNames.has(umbrella), true, `${umbrella} must be a canonical base tool`);
  }

  for (const [compatName, targetName] of Object.entries(expectedCompatAliases)) {
    assert.equal(baseNames.has(compatName), false, `${compatName} must not be a canonical base tool`);
    assert.equal(looAliasTargetName(compatName), targetName);
    assert.equal(canonicalLooToolName(compatName), targetName);
    assert.equal(byName.get(compatName)?.metadata.aliasOf, targetName);
    assert.deepEqual(byName.get(compatName)?.safety, byName.get(targetName)?.safety);
  }

  assert.equal(baseDeclarations.length, 34);
  assert.equal(aliasedDeclarations.filter((tool) => tool.name.startsWith("lco_") && tool.metadata.aliasOf).length, 8);
  assert.equal(aliasedDeclarations.filter((tool) => tool.name.startsWith("loo_") && tool.metadata.aliasOf).length, 31);
});

test("redirect aliases target any declared tool and merge kind defaults before caller args", async () => {
  const calls: Record<string, unknown>[] = [];
  const tools: LooTool[] = [{
    name: "any_declared_target",
    description: "Synthetic target used to verify general redirect aliases.",
    safety: LOO_COMMAND_POLICY.loo_describe_ref,
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

test("lco facade aliases invoke the same handlers as their loo targets", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-tool-alias-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  const audit = createAuditStore(join(root, "audit.jsonl"));
  const tools = createLooTools({
    db,
    audit,
    includeAliases: true,
    codexClient: {
      request: async () => ({ ok: true })
    }
  });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  try {
    for (const { targetName, input } of [
      { targetName: "loo_describe_ref", input: { source_ref: "codex_thread:not-found" } },
      { targetName: "loo_recent_sessions", input: { scope: "recent", now: "2026-07-06T00:00:00.000Z" } }
    ]) {
      const target = byName.get(targetName);
      const alias = byName.get(toLcoAliasName(targetName));
      assert.ok(target, `${targetName} must exist`);
      assert.ok(alias, `${toLcoAliasName(targetName)} must exist`);

      assert.deepEqual(await target.execute(input), await alias.execute(input));
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

  assert.equal(facadeTools.length, publicFacadeCount * 2);
  assert.equal(invalidProfileTools.length, allWithAliasesCount);

  assert.equal(facadeTools.every((tool) => tool.metadata?.tier === "public_facade"), true);
  assert.ok(invalidProfileTools.some((tool) => tool.name === "loo_session_sanitizer"));
  assert.ok(facadeTools.some((tool) => tool.name === "lco_prepared_inbox" && tool.metadata?.aliasOf === "loo_prepared_inbox"));
  assert.equal(facadeTools.some((tool) => tool.name === "loo_session_sanitizer"), false);
});

test("tool surface summary documents exposure filtering as non-gating", () => {
  const summary = createLooToolSurfaceSummary();

  assert.equal(summary.exposureProfile.environmentVariable, "LOO_TOOL_PROFILE");
  assert.equal(summary.exposureProfile.defaultProfile, "all");
  assert.deepEqual(summary.exposureProfile.profiles.facade.tiers, ["public_facade"]);
  assert.match(summary.exposureProfile.profiles.standard.description, /compatibility aliases/i);
  assert.match(summary.exposureProfile.profiles.all.description, /folded historical loo_\* compatibility aliases/i);
  assert.match(summary.exposureProfile.callPolicy, /hidden.*callable/i);
  assert.equal(summary.retrievalTelemetry.environmentVariable, "LOO_TELEMETRY");
  assert.equal(summary.retrievalTelemetry.defaultEnabled, false);
  assert.deepEqual(summary.retrievalTelemetry.mutationClasses, ["derived_cache"]);
  assert.ok(summary.retrievalTelemetry.affectedTools.includes("loo_expand_query"));
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

function toLcoAliasName(name: string): string {
  return name.replace(/^loo_/, "lco_");
}

async function readMcpToolList(profile: string | undefined): Promise<Array<Pick<LooToolDeclaration, "name" | "metadata">>> {
  const root = mkdtempSync(join(tmpdir(), "loo-mcp-profile-"));
  const server = spawn(process.execPath, ["--import", "tsx", "packages/mcp-server/src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(profile ? { LOO_TOOL_PROFILE: profile } : {}),
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
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for MCP tools/list. stderr=${stderr}`)), 5_000);
      const cleanup = () => {
        clearTimeout(timeout);
        server.stdout.off("data", onStdout);
        server.off("exit", onExit);
      };
      const onStdout = (chunk: string) => {
        stdout += chunk;
        const line = stdout.split("\n").find((candidate) => candidate.trim());
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
