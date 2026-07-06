import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { runLoo } from "./helpers/run-loo.js";

function waitForLine(child: ReturnType<typeof spawn>, timeoutMs = 5000): Promise<string> {
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let buffered = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for CLI output. stderr=${stderr}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      buffered += String(chunk);
      const newline = buffered.indexOf("\n");
      if (newline >= 0) {
        clearTimeout(timer);
        resolve(buffered.slice(0, newline));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`CLI exited before a line was written. code=${code} stderr=${stderr}`));
    });
  });
}

test("loo serve dispatches to the MCP server initialize path", async () => {
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    "packages/cli/src/index.ts",
    "serve"
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    const line = await waitForLine(child);
    const payload = JSON.parse(line) as {
      id?: unknown;
      result?: { serverInfo?: { name?: unknown; version?: unknown }; capabilities?: { tools?: unknown } };
    };
    assert.equal(payload.id, 1);
    assert.equal(payload.result?.serverInfo?.name, "lossless-openclaw-orchestrator");
    assert.equal(typeof payload.result?.serverInfo?.version, "string");
    assert.equal(typeof payload.result?.capabilities?.tools, "object");
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
});

test("loo audit-path dispatches through the LCO/LOO environment fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-audit-path-"));
  try {
    const auditPath = join(root, "fallback-audit.jsonl");
    const result = runLoo(["audit-path"], {
      ...process.env,
      LOO_AUDIT_PATH: auditPath,
      LCO_AUDIT_PATH: ""
    }, 5_000);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), auditPath);
    assert.equal(result.stderr.trim(), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo probe codex-sqlite dispatches argv roots to the read-only sqlite probe", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-cli-codex-sqlite-"));
  try {
    const codexRoot = join(root, "codex");
    mkdirSync(codexRoot, { recursive: true });
    const statePath = join(codexRoot, "state_1.sqlite");
    const db = new DatabaseSync(statePath);
    try {
      db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY);");
    } finally {
      db.close();
    }

    const result = runLoo(["probe", "codex-sqlite", codexRoot], process.env, 5_000);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr.trim(), "");
    const payload = JSON.parse(result.stdout) as {
      stores?: Array<{ path?: string; kind?: string; supported?: boolean; tables?: string[]; reason?: string | null }>;
    };
    assert.equal(payload.stores?.length, 1);
    assert.equal(payload.stores?.[0]?.path, statePath);
    assert.equal(payload.stores?.[0]?.kind, "state");
    assert.equal(payload.stores?.[0]?.supported, true);
    assert.deepEqual(payload.stores?.[0]?.tables, ["threads"]);
    assert.equal(payload.stores?.[0]?.reason, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
