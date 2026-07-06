import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatUnsupportedNodeVersion, nodeVersionMeetsMinimum } from "../packages/runtime/src/node-version-guard.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

test("package metadata and entrypoints enforce Node 22.5 before SQLite import paths", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { engines?: { node?: unknown } };
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as { packages?: Record<string, { engines?: { node?: unknown } }> };
  const cliEntry = readFileSync("packages/cli/src/index.ts", "utf8");
  const mcpEntry = readFileSync("packages/mcp-server/src/server.ts", "utf8");

  assert.equal(pkg.engines?.node, ">=22.5.0");
  assert.equal(lock.packages?.[""]?.engines?.node, ">=22.5.0");
  assert.equal(nodeVersionMeetsMinimum("22.4.9", "22.5.0"), false);
  assert.equal(nodeVersionMeetsMinimum("22.5.0", "22.5.0"), true);
  assert.equal(nodeVersionMeetsMinimum("22.5.0-nightly.20260101", "22.5.0"), true);
  assert.equal(nodeVersionMeetsMinimum("23.0.0", "22.5.0"), true);
  assert.equal(nodeVersionMeetsMinimum("vx.y.z", "22.5.0"), false);
  assert.equal(formatUnsupportedNodeVersion("vx.y.z"), "Node >=22.5.0 required, could not parse current Node version \"vx.y.z\"\n");

  assert.doesNotMatch(cliEntry, /node:sqlite|core\/src\/index/);
  assert.doesNotMatch(mcpEntry, /node:sqlite|core\/src\/index|createDatabase/);
  assert.match(cliEntry, /assertSupportedNodeVersion\(process\.versions\.node\)/);
  assert.match(mcpEntry, /assertSupportedNodeVersion\(process\.versions\.node\)/);
  assert.match(mcpEntry, /MCP server runtime failed to load/);
});

test("CLI entrypoint exits with a friendly Node floor message before running commands", () => {
  const script = [
    "Object.defineProperty(process.versions, 'node', { value: '22.4.9' });",
    "process.argv = [process.execPath, 'packages/cli/src/index.ts', '--version'];",
    "await import(new URL('./packages/cli/src/index.ts', `file://${process.cwd()}/`).href);"
  ].join("\n");
  const result = spawnSync(process.execPath, ["--import", tsxImport, "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    timeout: 5_000
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "");
  assert.equal(result.stderr, "Node >=22.5.0 required, you have v22.4.9\n");
  assert.doesNotMatch(result.stderr, /\bat\s+|node:sqlite|ERR_UNKNOWN_BUILTIN_MODULE|file:\/\//);
});

test("MCP server answers initialize and tools/list when DB startup is unavailable, then classifies tools/call", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-mcp-db-fail-"));
  const home = join(root, "home");
  mkdirSync(home);
  const blockedDbParent = join(root, "db-parent-is-a-file");
  writeFileSync(blockedDbParent, "not a directory\n");
  const dbPath = join(blockedDbParent, "state.sqlite");
  const server = spawn(process.execPath, ["--import", tsxImport, "packages/mcp-server/src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: home,
      LOO_DB_PATH: dbPath,
      LOO_CODEX_BIN: "loo-codex-not-needed-for-db-failure"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  server.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    const initialize = await readJsonRpcResponse(server, () => stdout, 1, () => stderr);
    assert.equal(initialize.result?.serverInfo?.name, "lossless-openclaw-orchestrator");

    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    const list = await readJsonRpcResponse(server, () => stdout, 2, () => stderr);
    assert.ok(list.result?.tools?.some((tool: { name?: string }) => tool.name === "loo_doctor"));
    assert.equal(list.result?.runtimeStatus?.startup, "lazy");
    assert.equal(list.result?.runtimeStatus?.failureSurface, "tools/call");
    assert.equal(list.result?.runtimeStatus?.retryPolicy?.failedStartupCached, false);

    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "loo_doctor", arguments: {} } })}\n`);
    const call = await readJsonRpcResponse(server, () => stdout, 3, () => stderr);
    const structured = call.result?.structuredContent as {
      ok?: unknown;
      code?: unknown;
      retryable?: unknown;
      message?: unknown;
      nextAction?: unknown;
      retryPolicy?: { failedStartupCached?: unknown; nextToolCallRechecksStartup?: unknown };
    } | undefined;
    assert.equal(structured?.ok, false);
    assert.equal(structured?.code, "database_unavailable");
    assert.equal(structured?.retryable, true);
    assert.equal(structured?.retryPolicy?.failedStartupCached, false);
    assert.equal(structured?.retryPolicy?.nextToolCallRechecksStartup, true);
    assert.match(String(structured?.message), /local LCO database is unavailable/i);
    assert.match(String(structured?.nextAction), /loo doctor/i);
    assert.equal(call.result?.content?.[0]?.type, "text");

    // Contract: failed startup is not cached; the next tools/call retries startup in the same MCP process.
    rmSync(blockedDbParent, { force: true });
    mkdirSync(blockedDbParent);
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "loo_doctor", arguments: {} } })}\n`);
    const recoveredCall = await readJsonRpcResponse(server, () => stdout, 4, () => stderr);
    const recoveredStructured = recoveredCall.result?.structuredContent as { ok?: unknown; code?: unknown } | undefined;
    assert.equal(recoveredStructured?.ok, true);
    assert.notEqual(recoveredStructured?.code, "database_unavailable");

    assert.doesNotMatch(`${stdout}\n${stderr}`, /\bat\s+|node:sqlite|ENOTDIR|\/Volumes\/LEXAR|\/Users\/|\/tmp\/loo-mcp-db-fail/);
    assert.equal(server.exitCode, null);
  } finally {
    server.kill();
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) {
        resolve();
        return;
      }
      server.once("exit", () => resolve());
    });
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP server distinguishes audit-store startup failures from database failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-mcp-runtime-fail-"));
  const home = join(root, "home");
  mkdirSync(home);
  const auditParent = join(root, "audit-parent-is-a-file");
  writeFileSync(auditParent, "not a directory\n");
  const server = spawn(process.execPath, ["--import", tsxImport, "packages/mcp-server/src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: home,
      LOO_DB_PATH: join(root, "state.sqlite"),
      LOO_AUDIT_PATH: join(auditParent, "audit.jsonl"),
      LOO_CODEX_BIN: "loo-codex-not-needed-for-runtime-failure"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  server.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    await readJsonRpcResponse(server, () => stdout, 1, () => stderr);

    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "loo_doctor", arguments: {} } })}\n`);
    const call = await readJsonRpcResponse(server, () => stdout, 2, () => stderr);
    const structured = call.result?.structuredContent as {
      ok?: unknown;
      code?: unknown;
      retryable?: unknown;
      message?: unknown;
      nextAction?: unknown;
      sourceCoverage?: { localIndex?: unknown; audit?: unknown };
      retryPolicy?: { failedStartupCached?: unknown; nextToolCallRechecksStartup?: unknown };
    } | undefined;
    assert.equal(structured?.ok, false);
    assert.equal(structured?.code, "audit_unavailable");
    assert.equal(structured?.retryable, true);
    assert.match(String(structured?.message), /audit store is unavailable/i);
    assert.match(String(structured?.nextAction), /LOO_AUDIT_PATH/i);
    assert.equal(structured?.sourceCoverage?.localIndex, "ok");
    assert.equal(structured?.sourceCoverage?.audit, "unavailable");
    assert.equal(structured?.retryPolicy?.failedStartupCached, false);
    assert.equal(structured?.retryPolicy?.nextToolCallRechecksStartup, true);
    assert.doesNotMatch(`${stdout}\n${stderr}`, /\bat\s+|node:sqlite|ENOTDIR|\/Volumes\/LEXAR|\/Users\/|\/tmp\/loo-mcp-runtime-fail/);
    assert.equal(server.exitCode, null);
  } finally {
    server.kill();
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) {
        resolve();
        return;
      }
      server.once("exit", () => resolve());
    });
    rmSync(root, { recursive: true, force: true });
  }
});

test("public docs name the temporary #615 live-send caveat and npm min-release-age tell", () => {
  const sprint = readFileSync("docs/WORKING_APP_PROOF_SPRINT.md", "utf8");
  const readme = readFileSync("README.md", "utf8");

  assert.match(sprint, /#615/);
  assert.match(sprint, /live-control send proof/i);
  assert.match(sprint, /caveat/i);
  assert.match(readme, /min-release-age|before/i);
  assert.match(readme, /ETARGET/);
  assert.match(readme, /date before/i);
});

async function readJsonRpcResponse(
  server: ReturnType<typeof spawn>,
  readStdout: () => string,
  id: number,
  readStderr: () => string
): Promise<{
  id?: number;
  result?: {
    serverInfo?: { name?: string };
    tools?: Array<{ name?: string }>;
    runtimeStatus?: { startup?: string; failureSurface?: string; retryPolicy?: { failedStartupCached?: boolean } };
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
  };
  error?: { code?: number; message?: string };
}> {
  const existing = findResponse(readStdout(), id);
  if (existing) return existing;
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for MCP response id=${id}. stdout=${readStdout()} stderr=${readStderr()}`));
    }, 5_000);
    const cleanup = () => {
      clearTimeout(timeout);
      server.stdout.off("data", onData);
      server.off("exit", onExit);
    };
    const onData = () => {
      const response = findResponse(readStdout(), id);
      if (!response) return;
      cleanup();
      resolve(response);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`MCP server exited before response id=${id}; code=${code}; stderr=${readStderr()}`));
    };
    server.stdout.on("data", onData);
    server.once("exit", onExit);
  });
}

function findResponse(stdout: string, id: number): ReturnType<typeof JSON.parse> | null {
  const lastNewlineIndex = stdout.lastIndexOf("\n");
  if (lastNewlineIndex === -1) return null;
  for (const line of stdout.slice(0, lastNewlineIndex).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    let parsed: { id?: number };
    try {
      parsed = JSON.parse(trimmed) as { id?: number };
    } catch {
      continue;
    }
    if (parsed.id === id) return parsed;
  }
  return null;
}
