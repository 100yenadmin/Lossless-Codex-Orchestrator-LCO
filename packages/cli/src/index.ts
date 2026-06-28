#!/usr/bin/env node
import { codexTransportStatus, createAuditStore } from "../../adapters/src/index.js";
import { createDatabase, defaultCodexRoots, defaultDatabasePath, indexCodexSessions, probeCodexSqliteStores, searchSessions } from "../../core/src/index.js";
import { join } from "node:path";

const [, , command, ...args] = process.argv;

async function main() {
  if (command === "doctor") {
    console.log(JSON.stringify({
      ok: true,
      dbPath: defaultDatabasePath(),
      localOnly: true,
      codex: codexTransportStatus({ command: process.env.LOO_CODEX_BIN || "codex" })
    }, null, 2));
    return;
  }
  if (command === "index" && args[0] === "codex") {
    const roots = args.slice(1);
    const db = createDatabase();
    try {
      console.log(JSON.stringify(indexCodexSessions(db, { roots: roots.length ? roots : defaultCodexRoots() }), null, 2));
    } finally {
      db.close();
    }
    return;
  }
  if (command === "probe" && args[0] === "codex-sqlite") {
    const roots = args.slice(1);
    console.log(JSON.stringify(probeCodexSqliteStores(roots.length ? roots : [join(process.env.HOME || ".", ".codex")]), null, 2));
    return;
  }
  if (command === "search") {
    const db = createDatabase();
    try {
      console.log(JSON.stringify(searchSessions(db, { query: args.join(" "), limit: 10 }), null, 2));
    } finally {
      db.close();
    }
    return;
  }
  if (command === "serve") {
    await import("../../mcp-server/src/server.js");
    return;
  }
  if (command === "audit-path") {
    console.log(createAuditStore(process.env.LOO_AUDIT_PATH || `${process.env.HOME}/.openclaw/lossless-openclaw-orchestrator/audit.jsonl`).path);
    return;
  }
  console.error("Usage: loo doctor | loo index codex [roots...] | loo probe codex-sqlite [roots...] | loo search <query> | loo serve | loo audit-path");
  process.exitCode = 2;
}

await main();
