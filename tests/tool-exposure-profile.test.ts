import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuditStore } from "../packages/adapters/src/index.js";
import { createDatabase } from "../packages/core/src/index.js";
import {
  createLooToolDeclarations,
  createLooTools,
  createLooToolSurfaceSummary,
  LOO_TOOL_SURFACE,
  parseLooToolProfile,
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
  const aliases = withAliases.filter((tool) => tool.metadata.aliasOf);
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
    assert.equal(alias.metadata.tier, "public_facade");
    assert.deepEqual(alias.safety, target.safety);
    assert.deepEqual(alias.inputSchema, target.inputSchema);
    assert.equal(alias.description, target.description);
  }

  assert.equal(aliases.length, 8);
  assert.equal(aliases.some((tool) => tool.metadata.aliasOf && tool.metadata.tier !== "public_facade"), false);
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
  const baseAllCount = Object.keys(LOO_TOOL_SURFACE).length;

  assert.equal(facadeTools.length, publicFacadeCount * 2);
  assert.equal(invalidProfileTools.length, baseAllCount + publicFacadeCount);

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
  assert.match(summary.exposureProfile.callPolicy, /hidden.*callable/i);
});

function expectedBaseNamesForTiers(tiers: LooToolTier[]): string[] {
  return Object.entries(LOO_TOOL_SURFACE)
    .filter(([, metadata]) => tiers.includes(metadata.tier))
    .map(([name]) => name)
    .sort();
}

function toLcoAliasName(name: string): string {
  return name.replace(/^loo_/, "lco_");
}

async function readMcpToolList(profile: LooToolProfile | undefined): Promise<Array<Pick<LooToolDeclaration, "name" | "metadata">>> {
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
