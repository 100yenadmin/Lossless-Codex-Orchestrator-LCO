import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuditStore } from "../packages/adapters/src/index.js";
import {
  createDatabase,
  indexClaudeSessions
} from "../packages/core/src/index.js";
import {
  createLooToolDeclarations,
  createLooTools,
  executeLooToolForOpenClaw
} from "../packages/mcp-server/src/tools.js";

function writeJsonl(path: string, rows: unknown[]): void {
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"));
}

test("MCP and OpenClaw-facing recall tools discover and route imported Claude session refs", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-claude-gateway-smoke-"));
  const projectRoot = join(root, ".claude", "projects", "-Volumes-LEXAR-repos-lco");
  mkdirSync(projectRoot, { recursive: true });
  const sessionPath = join(projectRoot, "claude-gateway-private-session.jsonl");
  const rawToken = `npm_${"b".repeat(32)}`;
  writeJsonl(sessionPath, [
    {
      type: "user",
      sessionId: "claude-gateway-1",
      uuid: "user-1",
      timestamp: "2026-07-08T06:30:00.000Z",
      message: {
        role: "user",
        content: `Gateway smoke should find Claude recall without leaking ${rawToken} or /Users/lume/private/claude.jsonl.`
      }
    },
    {
      type: "summary",
      sessionId: "claude-gateway-1",
      uuid: "summary-1",
      timestamp: "2026-07-08T06:31:00.000Z",
      summary: "Claude gateway recall marker for MCP and OpenClaw agent smoke."
    }
  ]);

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    indexClaudeSessions(db, { roots: [join(root, ".claude", "projects")], maxFiles: 10 });

    const declarationByName = new Map(createLooToolDeclarations({ includeAliases: true }).map((tool) => [tool.name, tool]));
    for (const toolName of ["lco_grep", "lco_describe_ref", "lco_expand_query", "loo_grep", "loo_describe_ref", "loo_expand_query"]) {
      const declaration = declarationByName.get(toolName);
      assert.ok(declaration, `${toolName} must be declared for MCP/OpenClaw`);
      assert.match(
        `${declaration.description} ${JSON.stringify(declaration.inputSchema)}`,
        /claude_session:\*|Claude/i,
        `${toolName} must make Claude refs discoverable to MCP/OpenClaw agents`
      );
    }

    const tools = createLooTools({
      db,
      audit: createAuditStore(join(root, "audit.jsonl")),
      codexClient: { request: async () => ({ ok: true }) },
      includeAliases: true
    });
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    const grep = await executeLooToolForOpenClaw(requiredTool(byName, "lco_grep"), {
      query: "Claude gateway recall marker",
      limit: 3,
      profile: "brief"
    }) as { matches?: Array<{ sourceKind?: string; sourceRef?: string }> };
    assert.equal(grep.matches?.[0]?.sourceKind, "claude_session");
    assert.equal(grep.matches?.[0]?.sourceRef, "claude_session:claude-gateway-1");

    const describe = await executeLooToolForOpenClaw(requiredTool(byName, "lco_describe_ref"), {
      source_ref: "claude_session:claude-gateway-1"
    }) as { sourceKind?: string; sourcePath?: string };
    assert.equal(describe.sourceKind, "claude_session");
    assert.equal(describe.sourcePath?.startsWith("claude_source:"), true);

    const expand = await executeLooToolForOpenClaw(requiredTool(byName, "lco_expand_query"), {
      query: "Claude gateway recall marker",
      profile: "brief",
      token_budget: 500
    }) as { sourceKind?: string; sourceRef?: string; text?: string };
    assert.equal(expand.sourceKind, "claude_session");
    assert.equal(expand.sourceRef, "claude_session:claude-gateway-1");
    assert.match(expand.text ?? "", /Claude gateway recall marker/);

    const aliasDescribe = await executeLooToolForOpenClaw(requiredTool(byName, "loo_describe_ref"), {
      source_ref: "claude_session:claude-gateway-1"
    }) as { sourceKind?: string };
    assert.equal(aliasDescribe.sourceKind, "claude_session");

    const serialized = JSON.stringify({ grep, describe, expand, aliasDescribe });
    assert.equal(serialized.includes(rawToken), false);
    assert.equal(serialized.includes("/Users/lume"), false);
    assert.equal(serialized.includes("/Volumes/LEXAR"), false);
    assert.equal(serialized.includes("claude-gateway-private-session.jsonl"), false);
    assert.equal(serialized.includes("claude.jsonl"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("lco_index_sessions MCP facade imports Claude sessions for agent-facing recall", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-claude-index-mcp-"));
  const projectRoot = join(root, ".claude", "projects", "-Volumes-LEXAR-repos-lco");
  mkdirSync(projectRoot, { recursive: true });
  const sessionPath = join(projectRoot, "claude-index-mcp-private-session.jsonl");
  const rawToken = `ghp_${"c".repeat(36)}`;
  writeJsonl(sessionPath, [
    {
      type: "user",
      sessionId: "claude-index-mcp-1",
      uuid: "user-1",
      timestamp: "2026-07-08T07:00:00.000Z",
      message: {
        role: "user",
        content: `MCP index should import Claude recall marker without leaking ${rawToken} or /Volumes/LEXAR/private/claude-index.jsonl.`
      }
    },
    {
      type: "summary",
      sessionId: "claude-index-mcp-1",
      uuid: "summary-1",
      timestamp: "2026-07-08T07:01:00.000Z",
      summary: "Claude MCP index marker for agent-facing first-run recall."
    }
  ]);

  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const tools = createLooTools({
      db,
      audit: createAuditStore(join(root, "audit.jsonl")),
      codexClient: { request: async () => ({ ok: true }) },
      includeAliases: true
    });
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    const indexed = await executeLooToolForOpenClaw(requiredTool(byName, "lco_index_sessions"), {
      target: "claude",
      roots: [join(root, ".claude", "projects")],
      max_files: 10
    }) as Record<string, any>;

    assert.equal(indexed.publicSafe, true);
    assert.deepEqual(indexed.mutationClasses, ["derived_cache"]);
    assert.deepEqual(indexed.sourceKinds, ["claude"]);
    assert.equal(indexed.indexedFiles, 1);
    assert.equal(indexed.indexedSessions, 1);
    assert.equal(indexed.actionsPerformed.derivedCacheWrite, true);
    assert.equal(indexed.actionsPerformed.sourceStoreMutation, false);
    assert.equal(indexed.actionsPerformed.liveControl, false);

    const grep = await executeLooToolForOpenClaw(requiredTool(byName, "lco_grep"), {
      query: "Claude MCP index marker",
      limit: 3,
      profile: "brief"
    }) as { matches?: Array<{ sourceKind?: string; sourceRef?: string }> };
    assert.equal(grep.matches?.[0]?.sourceKind, "claude_session");
    assert.equal(grep.matches?.[0]?.sourceRef, "claude_session:claude-index-mcp-1");

    const serialized = JSON.stringify({ indexed, grep });
    assert.equal(serialized.includes(rawToken), false);
    assert.equal(serialized.includes("/Volumes/LEXAR"), false);
    assert.equal(serialized.includes("claude-index-mcp-private-session.jsonl"), false);
    assert.equal(serialized.includes("claude-index.jsonl"), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function requiredTool<T extends { name: string }>(tools: Map<string, T>, name: string): T {
  const tool = tools.get(name);
  assert.ok(tool, `${name} must exist`);
  return tool;
}
