import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createCliMcpProductSmokeReport } from "../packages/cli/src/cli-mcp-product-smoke.js";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
const repoRoot = new URL("..", import.meta.url);

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function writeFakeCli(path: string, options: { helpStatus?: number } = {}): void {
  const helpStatus = options.helpStatus ?? 0;
  writeExecutable(path, [
    "#!/usr/bin/env node",
    "if (process.argv.includes('--help')) {",
    "  console.log('Usage: loo --help');",
    "  console.log('raw canary /Users/lume/.codex/state_5.sqlite Bearer test-token-secret');",
    `  process.exit(${helpStatus});`,
    "}",
    "process.exit(2);"
  ].join("\n"));
}

function writeFakeMcpServer(path: string, toolNames: string[], options: {
  initializeError?: boolean;
  toolsCallError?: boolean;
  exitAfterToolsList?: boolean;
  exitAfterToolsCall?: boolean;
  responseToolName?: string;
  requireIsolatedRuntime?: boolean;
  stallToolsCall?: boolean;
  initializeDelayMs?: number;
  toolsListDelayMs?: number;
} = {}): void {
  writeExecutable(path, [
    "#!/usr/bin/env node",
    "import { createInterface } from 'node:readline';",
    "const tools = " + JSON.stringify(toolNames.map((name) => ({
      name,
      description: "public tool with raw canary /Volumes/LEXAR/private/session.jsonl npm_aaaaaaaaaaaaaaaaaaaaaaaa",
      inputSchema: { type: "object" }
    }))) + ";",
    `const initializeError = ${JSON.stringify(options.initializeError === true)};`,
    `const toolsCallError = ${JSON.stringify(options.toolsCallError === true)};`,
    `const exitAfterToolsList = ${JSON.stringify(options.exitAfterToolsList === true)};`,
    `const exitAfterToolsCall = ${JSON.stringify(options.exitAfterToolsCall === true)};`,
    `const responseToolName = ${JSON.stringify(options.responseToolName ?? null)};`,
    `const requireIsolatedRuntime = ${JSON.stringify(options.requireIsolatedRuntime === true)};`,
    `const stallToolsCall = ${JSON.stringify(options.stallToolsCall === true)};`,
    `const initializeDelayMs = ${JSON.stringify(options.initializeDelayMs ?? 0)};`,
    `const toolsListDelayMs = ${JSON.stringify(options.toolsListDelayMs ?? 0)};`,
    `const ambientHome = ${JSON.stringify(process.env.HOME ?? process.env.USERPROFILE ?? "")};`,
    "const runtimeRoot = process.env.HOME || process.env.USERPROFILE || '';",
    "const runtimeIsolated = runtimeRoot !== '' && runtimeRoot !== ambientHome && process.env.HOME === runtimeRoot && process.env.USERPROFILE === runtimeRoot && (process.env.LCO_DB_PATH || '').startsWith(runtimeRoot) && (process.env.LCO_AUDIT_PATH || '').startsWith(runtimeRoot) && !process.env.SECRET_TOKEN;",
    "if (requireIsolatedRuntime && !runtimeIsolated) process.exit(91);",
    "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
    "function send(payload) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...payload }) + '\\n'); }",
    "rl.on('line', (line) => {",
    "  const message = JSON.parse(line);",
    "  if (message.method === 'initialize') {",
    "    if (initializeError) { send({ id: message.id, error: { code: -32000, message: 'init failed' } }); return; }",
    "    const reply = () => send({ id: message.id, result: { protocolVersion: '2025-11-25', serverInfo: { name: 'fake-lco', version: '1.3.0' }, capabilities: { tools: {} } } });",
    "    if (initializeDelayMs > 0) setTimeout(reply, initializeDelayMs); else reply();",
    "    return;",
    "  }",
    "  if (message.method === 'tools/list') {",
    "    const reply = () => send({ id: message.id, result: { tools } });",
    "    if (toolsListDelayMs > 0) setTimeout(reply, toolsListDelayMs); else reply();",
    "    if (exitAfterToolsList) setImmediate(() => process.exit(0));",
    "    return;",
    "  }",
    "  if (message.method === 'tools/call') {",
    "    if (stallToolsCall) return;",
    "    if (!tools.some((tool) => tool.name === message.params?.name)) {",
    "      send({ id: message.id, error: { code: -32602, message: 'missing tool' } });",
    "      return;",
    "    }",
    "    if (toolsCallError) { send({ id: message.id, error: { code: -32001, message: 'tool call failed' } }); return; }",
    "    send({ id: message.id, result: { ...(responseToolName ? { toolName: responseToolName } : {}), content: [{ type: 'text', text: 'ok but raw /Users/lume/.codex/state_5.sqlite Bearer hidden-token' }], structuredContent: { ok: true } } });",
    "    if (exitAfterToolsCall) setImmediate(() => process.exit(0));",
    "    return;",
    "  }",
    "  send({ id: message.id, error: { code: -32601, message: 'unsupported' } });",
    "});"
  ].join("\n"));
}

test("loo qa-lab cli-mcp-smoke isolates the MCP probe from the ambient user runtime", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-isolated-runtime-"));
  const previousSecret = process.env.SECRET_TOKEN;
  try {
    process.env.SECRET_TOKEN = "must-not-reach-mcp-child";
    const cliBin = join(dir, "loo");
    const mcpBin = join(dir, "lco-mcp-server");
    writeFakeCli(cliBin);
    writeFakeMcpServer(mcpBin, ["lco_doctor"], { requireIsolatedRuntime: true });

    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      join(dir, "evidence"),
      "--package-version",
      "1.6.0",
      "--cli-bin",
      cliBin,
      "--mcp-bin",
      mcpBin,
      "--required-tool",
      "lco_doctor",
      "--tool-call",
      "lco_doctor",
      "--timeout-ms",
      "1000",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as { ok: boolean; blockers: string[] };
    assert.equal(report.ok, true);
    assert.deepEqual(report.blockers, []);
  } finally {
    if (previousSecret === undefined) delete process.env.SECRET_TOKEN;
    else process.env.SECRET_TOKEN = previousSecret;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo qa-lab cli-mcp-smoke reports isolated runtime setup failure without rejecting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-runtime-setup-failure-"));
  try {
    const cliBin = join(dir, "loo");
    const mcpBin = join(dir, "lco-mcp-server");
    const evidenceDir = join(dir, "evidence");
    writeFakeCli(cliBin);
    writeFakeMcpServer(mcpBin, ["lco_doctor"]);

    const report = await createCliMcpProductSmokeReport({
      evidenceDir,
      packageVersion: "1.6.0",
      cliBin,
      mcpBin,
      requiredTools: ["lco_doctor"],
      toolCallName: "lco_doctor",
      runtimeRootFactory: () => {
        throw Object.assign(new Error("private runtime setup detail"), { code: "EACCES" });
      }
    });

    assert.equal(report.ok, false);
    assert.equal(report.mcpReady, false);
    assert.deepEqual(report.blockers, ["mcp_isolated_runtime_setup_failed"]);
    assert.equal(report.toolCallProbe.errorCode, "mcp_isolated_runtime_setup_failed");
    assert.equal(existsSync(join(evidenceDir, "cli-mcp-product-smoke.json")), true);
    assert.doesNotMatch(readFileSync(join(evidenceDir, "cli-mcp-product-smoke.json"), "utf8"), /private runtime setup detail|EACCES/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo qa-lab cli-mcp-smoke preserves tools/list evidence when tools/call times out", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-tools-call-timeout-"));
  try {
    const cliBin = join(dir, "loo");
    const mcpBin = join(dir, "lco-mcp-server");
    writeFakeCli(cliBin);
    writeFakeMcpServer(mcpBin, ["lco_doctor"], {
      stallToolsCall: true,
      initializeDelayMs: 1750,
      toolsListDelayMs: 1750
    });

    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      join(dir, "evidence"),
      "--package-version",
      "1.6.0",
      "--cli-bin",
      cliBin,
      "--mcp-bin",
      mcpBin,
      "--required-tool",
      "lco_doctor",
      "--tool-call",
      "lco_doctor",
      "--timeout-ms",
      "3000",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      mcpReady: boolean;
      toolsListed: number;
      requiredToolsPresent: string[];
      blockers: string[];
      toolCallProbe: { errorCode: string | null };
    };
    assert.equal(report.mcpReady, true, JSON.stringify(report));
    assert.equal(report.toolsListed, 1);
    assert.deepEqual(report.requiredToolsPresent, ["lco_doctor"]);
    assert.deepEqual(report.blockers, ["mcp_tools_call_timeout"]);
    assert.equal(report.toolCallProbe.errorCode, "mcp_tools_call_timeout");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo qa-lab cli-mcp-smoke proves CLI help plus MCP tools/list and tools/call with public-safe evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-"));
  try {
    const evidenceDir = join(dir, "evidence");
    const cliBin = join(dir, "loo");
    const mcpBin = join(dir, "lco-mcp-server");
    writeFakeCli(cliBin);
    writeFakeMcpServer(mcpBin, [
      "lco_doctor",
      "lco_find",
      "lco_prepared_inbox",
      "lco_describe_ref",
      "lco_expand_query"
    ]);

    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      evidenceDir,
      "--package-version",
      "1.3.0",
      "--candidate-sha",
      "d0062715fecbfe6277c3611ead8fea32300927a2",
      "--cli-bin",
      cliBin,
      "--mcp-bin",
      mcpBin,
      "--required-tool",
      "lco_doctor",
      "--required-tool",
      "lco_expand_query",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      schema: string;
      ok: boolean;
      packageVersion: string;
      candidateSha: string;
      cliReady: boolean;
      mcpReady: boolean;
      mcpToolsCallReady: boolean;
      toolsListed: number;
      toolCallProbe: {
        toolName: string;
        ok: boolean;
        contentItemCount: number;
        contentKinds: string[];
        structuredContentPresent: boolean;
      };
      requiredToolsPresent: string[];
      blockers: string[];
      setupBlockers: string[];
      warnings: string[];
      actionsPerformed: Record<string, boolean>;
      privateDataExclusions: string[];
      proofBoundary: string;
      nextSafeCommands: string[];
    };

    assert.equal(report.schema, "lco.qaLab.cliMcpProductSmoke.v1");
    assert.equal(report.ok, true);
    assert.equal(report.packageVersion, "1.3.0");
    assert.equal(report.candidateSha, "d0062715fecbfe6277c3611ead8fea32300927a2");
    assert.equal(report.cliReady, true);
    assert.equal(report.mcpReady, true);
    assert.equal(report.mcpToolsCallReady, true);
    assert.equal(report.toolsListed, 5);
    assert.deepEqual(report.toolCallProbe, {
      toolName: "lco_doctor",
      ok: true,
      contentItemCount: 1,
      contentKinds: ["text"],
      structuredContentPresent: true,
      errorCode: null
    });
    assert.deepEqual(report.requiredToolsPresent, ["lco_doctor", "lco_expand_query"]);
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(report.setupBlockers, []);
    assert.deepEqual(report.warnings, []);
    assert.deepEqual(report.actionsPerformed, {
      npmPublished: false,
      githubReleaseCreated: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      screenshotsCaptured: false
    });
    assert.ok(report.privateDataExclusions.includes("raw MCP stdout/stderr"));
    assert.match(report.proofBoundary, /CLI --help, MCP tools\/list, and MCP tools\/call/i);
    assert.match(report.proofBoundary, /MCP with protocolVersion 2025-11-25/i);
    assert.match(report.proofBoundary, /does not run live Codex control/i);
    assert.ok(report.nextSafeCommands.some((command) => command.includes("loo qa-lab cli-mcp-smoke")));
    assert.equal(existsSync(join(evidenceDir, "cli-mcp-product-smoke.json")), true);
    assert.doesNotMatch(result.stdout, /\/Users\/|\/Volumes\/|state_5\.sqlite|session\.jsonl|Bearer|npm_[A-Za-z0-9]{20,}/i);
    assert.doesNotMatch(readFileSync(join(evidenceDir, "cli-mcp-product-smoke.json"), "utf8"), /\/Users\/|\/Volumes\/|state_5\.sqlite|session\.jsonl|Bearer|npm_[A-Za-z0-9]{20,}/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo qa-lab cli-mcp-smoke separates setup-required binaries from package defects", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-setup-"));
  try {
    const evidenceDir = join(dir, "evidence");
    const mcpBin = join(dir, "loo-mcp-server");
    writeFakeMcpServer(mcpBin, ["loo_doctor", "loo_expand_query"]);

    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      evidenceDir,
      "--package-version",
      "1.3.0",
      "--cli-bin",
      join(dir, "missing-loo"),
      "--mcp-bin",
      mcpBin,
      "--required-tool",
      "loo_doctor",
      "--tool-call",
      "loo_doctor",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      cliReady: boolean;
      mcpReady: boolean;
      mcpToolsCallReady: boolean;
      blockers: string[];
      setupBlockers: string[];
      warnings: string[];
    };
    assert.equal(report.ok, false);
    assert.equal(report.cliReady, false);
    assert.equal(report.mcpReady, true);
    assert.equal(report.mcpToolsCallReady, true);
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(report.setupBlockers, ["cli_binary_not_found_or_not_executable"]);
    assert.deepEqual(report.warnings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo qa-lab cli-mcp-smoke treats missing required MCP tools as package defects", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-missing-tool-"));
  try {
    const evidenceDir = join(dir, "evidence");
    const cliBin = join(dir, "loo");
    const mcpBin = join(dir, "loo-mcp-server");
    writeFakeCli(cliBin);
    writeFakeMcpServer(mcpBin, ["loo_doctor"]);

    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      evidenceDir,
      "--package-version",
      "1.3.0",
      "--cli-bin",
      cliBin,
      "--mcp-bin",
      mcpBin,
      "--required-tool",
      "loo_doctor",
      "--required-tool",
      "loo_expand_query",
      "--tool-call",
      "loo_doctor",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      cliReady: boolean;
      mcpReady: boolean;
      mcpToolsCallReady: boolean;
      requiredToolsPresent: string[];
      blockers: string[];
      setupBlockers: string[];
    };
    assert.equal(report.ok, false);
    assert.equal(report.cliReady, true);
    assert.equal(report.mcpReady, true);
    assert.equal(report.mcpToolsCallReady, true);
    assert.deepEqual(report.requiredToolsPresent, ["loo_doctor"]);
    assert.deepEqual(report.blockers, ["required_mcp_tools_missing"]);
    assert.deepEqual(report.setupBlockers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo qa-lab cli-mcp-smoke treats CLI help failure as package defect", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-cli-failed-"));
  try {
    const evidenceDir = join(dir, "evidence");
    const cliBin = join(dir, "loo");
    const mcpBin = join(dir, "loo-mcp-server");
    writeFakeCli(cliBin, { helpStatus: 2 });
    writeFakeMcpServer(mcpBin, ["loo_doctor"]);

    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      evidenceDir,
      "--package-version",
      "1.3.0",
      "--cli-bin",
      cliBin,
      "--mcp-bin",
      mcpBin,
      "--required-tool",
      "loo_doctor",
      "--tool-call",
      "loo_doctor",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as { cliReady: boolean; mcpReady: boolean; blockers: string[]; setupBlockers: string[] };
    assert.equal(report.cliReady, false);
    assert.equal(report.mcpReady, true);
    assert.deepEqual(report.blockers, ["cli_help_failed"]);
    assert.deepEqual(report.setupBlockers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo qa-lab cli-mcp-smoke reports MCP initialize and tools/call errors as package defects", () => {
  const initDir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-init-error-"));
  const callDir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-call-error-"));
  try {
    const initCli = join(initDir, "loo");
    const initMcp = join(initDir, "loo-mcp-server");
    writeFakeCli(initCli);
    writeFakeMcpServer(initMcp, ["loo_doctor"], { initializeError: true });
    const initResult = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      join(initDir, "evidence"),
      "--package-version",
      "1.3.0",
      "--cli-bin",
      initCli,
      "--mcp-bin",
      initMcp,
      "--required-tool",
      "loo_doctor",
      "--tool-call",
      "loo_doctor",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });
    assert.equal(initResult.status, 1, initResult.stderr || initResult.stdout);
    const initReport = JSON.parse(initResult.stdout) as { mcpReady: boolean; blockers: string[]; toolCallProbe: { errorCode: string | null } };
    assert.equal(initReport.mcpReady, false);
    assert.deepEqual(initReport.blockers, ["mcp_initialize_failed"]);
    assert.equal(initReport.toolCallProbe.errorCode, "mcp_initialize_failed");

    const callCli = join(callDir, "loo");
    const callMcp = join(callDir, "loo-mcp-server");
    writeFakeCli(callCli);
    writeFakeMcpServer(callMcp, ["loo_doctor"], { toolsCallError: true });
    const callResult = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      join(callDir, "evidence"),
      "--package-version",
      "1.3.0",
      "--cli-bin",
      callCli,
      "--mcp-bin",
      callMcp,
      "--required-tool",
      "loo_doctor",
      "--tool-call",
      "loo_doctor",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });
    assert.equal(callResult.status, 1, callResult.stderr || callResult.stdout);
    const callReport = JSON.parse(callResult.stdout) as { mcpReady: boolean; mcpToolsCallReady: boolean; blockers: string[]; toolCallProbe: { errorCode: string | null } };
    assert.equal(callReport.mcpReady, true);
    assert.equal(callReport.mcpToolsCallReady, false);
    assert.deepEqual(callReport.blockers, ["mcp_tools_call_failed"]);
    assert.equal(callReport.toolCallProbe.errorCode, "mcp_tools_call_failed");
  } finally {
    rmSync(initDir, { recursive: true, force: true });
    rmSync(callDir, { recursive: true, force: true });
  }
});

test("loo qa-lab cli-mcp-smoke fails closed when MCP lists no loo tools", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-empty-tools-"));
  try {
    const evidenceDir = join(dir, "evidence");
    const cliBin = join(dir, "loo");
    const mcpBin = join(dir, "loo-mcp-server");
    writeFakeCli(cliBin);
    writeFakeMcpServer(mcpBin, []);

    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      evidenceDir,
      "--package-version",
      "1.3.0",
      "--cli-bin",
      cliBin,
      "--mcp-bin",
      mcpBin,
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as { mcpReady: boolean; toolsListed: number; blockers: string[] };
    assert.equal(report.mcpReady, false);
    assert.equal(report.toolsListed, 0);
    assert.ok(report.blockers.includes("mcp_no_loo_tools_listed"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo qa-lab cli-mcp-smoke rejects mismatched tools/call response names", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-name-mismatch-"));
  try {
    const evidenceDir = join(dir, "evidence");
    const cliBin = join(dir, "loo");
    const mcpBin = join(dir, "loo-mcp-server");
    writeFakeCli(cliBin);
    writeFakeMcpServer(mcpBin, ["loo_doctor"], { responseToolName: "loo_other_tool" });

    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      evidenceDir,
      "--package-version",
      "1.3.0",
      "--cli-bin",
      cliBin,
      "--mcp-bin",
      mcpBin,
      "--required-tool",
      "loo_doctor",
      "--tool-call",
      "loo_doctor",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as { mcpReady: boolean; mcpToolsCallReady: boolean; blockers: string[]; toolCallProbe: { errorCode: string | null } };
    assert.equal(report.mcpReady, true);
    assert.equal(report.mcpToolsCallReady, false);
    assert.ok(report.blockers.includes("mcp_tools_call_name_mismatch"));
    assert.equal(report.toolCallProbe.errorCode, "mcp_tools_call_name_mismatch");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo qa-lab cli-mcp-smoke accepts fast-exit server after successful tools/call", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-fast-exit-"));
  try {
    const evidenceDir = join(dir, "evidence");
    const cliBin = join(dir, "loo");
    const mcpBin = join(dir, "loo-mcp-server");
    writeFakeCli(cliBin);
    writeFakeMcpServer(mcpBin, ["loo_doctor"], { exitAfterToolsCall: true });

    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      evidenceDir,
      "--package-version",
      "1.3.0",
      "--cli-bin",
      cliBin,
      "--mcp-bin",
      mcpBin,
      "--required-tool",
      "loo_doctor",
      "--tool-call",
      "loo_doctor",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as { ok: boolean; mcpReady: boolean; mcpToolsCallReady: boolean; blockers: string[] };
    assert.equal(report.ok, true);
    assert.equal(report.mcpReady, true);
    assert.equal(report.mcpToolsCallReady, true);
    assert.deepEqual(report.blockers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo qa-lab cli-mcp-smoke retains MCP readiness when the server exits after tools/list", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-exit-after-list-"));
  try {
    const cliBin = join(dir, "loo");
    const mcpBin = join(dir, "loo-mcp-server");
    writeFakeCli(cliBin);
    writeFakeMcpServer(mcpBin, ["loo_doctor"], { exitAfterToolsList: true });

    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      join(dir, "evidence"),
      "--package-version",
      "1.6.0",
      "--cli-bin",
      cliBin,
      "--mcp-bin",
      mcpBin,
      "--required-tool",
      "loo_doctor",
      "--tool-call",
      "loo_doctor",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as { mcpReady: boolean; toolsListed: number; blockers: string[] };
    assert.equal(report.mcpReady, true);
    assert.equal(report.toolsListed, 1);
    assert.deepEqual(report.blockers, ["mcp_tools_call_failed"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo qa-lab cli-mcp-smoke rejects excessive per-probe timeout values before running probes", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-timeout-cap-"));
  try {
    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      join(dir, "evidence"),
      "--package-version",
      "1.3.0",
      "--timeout-ms",
      "10001",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /--timeout-ms requires an integer between 1 and 10000/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loo qa-lab cli-mcp-smoke rejects non-loo tool names before running probes", () => {
  const dir = mkdtempSync(join(tmpdir(), "loo-cli-mcp-smoke-invalid-tool-"));
  try {
    const requiredToolResult = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      join(dir, "required-evidence"),
      "--package-version",
      "1.3.0",
      "--required-tool",
      "doctor",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(requiredToolResult.status, 1, requiredToolResult.stderr || requiredToolResult.stdout);
    assert.match(requiredToolResult.stderr, /--required-tool requires an lco_\* or loo_\* tool name/);
    assert.equal(existsSync(join(dir, "required-evidence", "cli-mcp-product-smoke.json")), false);

    const toolCallResult = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      "packages/cli/src/index.ts",
      "qa-lab",
      "cli-mcp-smoke",
      "--evidence-dir",
      join(dir, "tool-call-evidence"),
      "--package-version",
      "1.3.0",
      "--tool-call",
      "doctor",
      "--strict"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(toolCallResult.status, 1, toolCallResult.stderr || toolCallResult.stdout);
    assert.match(toolCallResult.stderr, /--tool-call requires an lco_\* or loo_\* tool name/);
    assert.equal(existsSync(join(dir, "tool-call-evidence", "cli-mcp-product-smoke.json")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
