import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createHermesSmokeReport,
  EVA_HERMES_REQUIRED_LCO_TOOLS
} from "../packages/cli/src/hermes-smoke.js";

test("Hermes smoke proves the Eva tool set, silent notifications, and object-valid results", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-hermes-smoke-"));
  try {
    const cliBin = join(root, "lco");
    const mcpBin = join(root, "lco-mcp-server");
    writeExecutable(cliBin, [
      "#!/usr/bin/env node",
      "if (process.argv.includes('--help')) process.exit(0);",
      "process.exit(2);"
    ]);
    writeExecutable(mcpBin, fakeHermesMcpServer());

    const report = await createHermesSmokeReport({
      evidenceDir: root,
      packageVersion: "1.6.0",
      candidateSha: "0123456789abcdef0123456789abcdef01234567",
      cliBin,
      mcpBin,
      timeoutMs: 5_000,
      findLatencyThresholdMs: 5_000,
      now: "2026-07-29T00:00:00.000Z"
    });

    assert.equal(report.schema, "lco.hermesSmoke.v1");
    assert.equal(report.ok, true);
    assert.equal(report.requiredToolsPresent, true);
    assert.equal(report.requiredTools.length, 14);
    assert.equal(report.notificationSilenceReady, true);
    assert.equal(report.structuredContentObjectReady, true);
    assert.equal(report.arrayResultWrappedReady, true);
    assert.equal(report.defaultFindIndexSkipped, true);
    assert.equal(report.findLatencyReady, true);
    assert.equal(report.findLatencyThresholdMs, 5_000);
    assert.deepEqual(report.blockers, []);
    assert.doesNotMatch(
      readFileSync(join(root, "hermes-smoke.json"), "utf8"),
      /Bearer |\/Users\/|\/Volumes\/|hermes compatibility smoke/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Hermes smoke fails closed when a server responds to initialized notifications", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-hermes-smoke-notification-"));
  try {
    const cliBin = join(root, "lco");
    const mcpBin = join(root, "lco-mcp-server");
    writeExecutable(cliBin, [
      "#!/usr/bin/env node",
      "if (process.argv.includes('--help')) process.exit(0);",
      "process.exit(2);"
    ]);
    writeExecutable(mcpBin, fakeHermesMcpServer({ invalidNotificationResponse: true }));

    const report = await createHermesSmokeReport({
      evidenceDir: root,
      packageVersion: "1.6.0",
      candidateSha: "0123456789abcdef0123456789abcdef01234567",
      cliBin,
      mcpBin,
      timeoutMs: 5_000,
      findLatencyThresholdMs: 5_000
    });

    assert.equal(report.ok, false);
    assert.equal(report.notificationSilenceReady, false);
    assert.equal(report.blockers.some((code) => code.includes("mcp_notification_response_invalid")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Hermes smoke fails closed for missing tools and malformed structured content", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-hermes-smoke-schema-"));
  try {
    const cliBin = join(root, "lco");
    const mcpBin = join(root, "lco-mcp-server");
    writeExecutable(cliBin, [
      "#!/usr/bin/env node",
      "if (process.argv.includes('--help')) process.exit(0);",
      "process.exit(2);"
    ]);
    writeExecutable(mcpBin, fakeHermesMcpServer({
      omitRequiredTool: true,
      malformedStructuredContent: true
    }));

    const report = await createHermesSmokeReport({
      evidenceDir: root,
      packageVersion: "1.6.0",
      candidateSha: "0123456789abcdef0123456789abcdef01234567",
      cliBin,
      mcpBin,
      timeoutMs: 5_000,
      findLatencyThresholdMs: 5_000
    });

    assert.equal(report.ok, false);
    assert.equal(report.requiredToolsPresent, false);
    assert.equal(report.structuredContentObjectReady, false);
    assert.equal(report.blockers.includes("required_eva_tools_missing"), true);
    assert.equal(report.blockers.includes("structured_content_object_not_proven"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Hermes smoke fails closed when default find exceeds the latency threshold", async () => {
  const root = mkdtempSync(join(tmpdir(), "lco-hermes-smoke-latency-"));
  try {
    const cliBin = join(root, "lco");
    const mcpBin = join(root, "lco-mcp-server");
    writeExecutable(cliBin, [
      "#!/usr/bin/env node",
      "if (process.argv.includes('--help')) process.exit(0);",
      "process.exit(2);"
    ]);
    writeExecutable(mcpBin, fakeHermesMcpServer({ responseDelayMs: 350 }));

    const report = await createHermesSmokeReport({
      evidenceDir: root,
      packageVersion: "1.6.0",
      candidateSha: "0123456789abcdef0123456789abcdef01234567",
      cliBin,
      mcpBin,
      timeoutMs: 5_000,
      findLatencyThresholdMs: 300
    });

    assert.equal(report.ok, false);
    assert.equal(report.findLatencyReady, false);
    assert.equal((report.findLatencyMs ?? 0) > report.findLatencyThresholdMs, true);
    assert.equal(report.blockers.includes("find_latency_threshold_exceeded"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeExecutable(path: string, lines: string[]): void {
  writeFileSync(path, lines.join("\n"));
  chmodSync(path, 0o755);
}

function fakeHermesMcpServer(options: {
  invalidNotificationResponse?: boolean;
  omitRequiredTool?: boolean;
  malformedStructuredContent?: boolean;
  responseDelayMs?: number;
} = {}): string[] {
  return [
    "#!/usr/bin/env node",
    "import { createInterface } from 'node:readline';",
    `const toolNames = ${JSON.stringify(
      options.omitRequiredTool
        ? EVA_HERMES_REQUIRED_LCO_TOOLS.slice(0, -1)
        : [...EVA_HERMES_REQUIRED_LCO_TOOLS]
    )};`,
    `const invalidNotificationResponse = ${JSON.stringify(options.invalidNotificationResponse ?? false)};`,
    `const malformedStructuredContent = ${JSON.stringify(options.malformedStructuredContent ?? false)};`,
    `const responseDelayMs = ${JSON.stringify(options.responseDelayMs ?? 0)};`,
    "const send = (payload) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...payload }) + '\\n');",
    "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
    "rl.on('line', (line) => {",
    "  const message = JSON.parse(line);",
    "  if (!Object.prototype.hasOwnProperty.call(message, 'id')) {",
    "    if (invalidNotificationResponse) send({ id: null, error: { code: -32601, message: 'invalid notification response' } });",
    "    return;",
    "  }",
    "  if (message.method === 'initialize') {",
    "    send({ id: message.id, result: { protocolVersion: '2025-11-25', serverInfo: { name: 'fake-lco', version: '1.6.0' }, capabilities: { tools: {} } } });",
    "    return;",
    "  }",
    "  if (message.method === 'tools/list') {",
    "    send({ id: message.id, result: { tools: toolNames.map((name) => ({ name, description: 'safe', inputSchema: { type: 'object' } })) } });",
    "    return;",
    "  }",
    "  if (message.method === 'tools/call') {",
    "    const name = message.params?.name;",
    "    const structuredContent = malformedStructuredContent ? [] : name === 'lco_find'",
    "      ? { schema: 'lco.find.v1', ok: true, resultCount: 0, reasonCodes: ['find_command', 'index_skipped_by_default'] }",
    "      : { result: [] };",
    "    const payload = { id: message.id, result: { content: [{ type: 'text', text: 'safe' }], structuredContent } };",
    "    if (responseDelayMs > 0) setTimeout(() => send(payload), responseDelayMs);",
    "    else send(payload);",
    "    return;",
    "  }",
    "  send({ id: message.id, error: { code: -32601, message: 'unsupported' } });",
    "});"
  ];
}
