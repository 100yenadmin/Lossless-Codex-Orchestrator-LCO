import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createAuditStore } from "../packages/adapters/src/index.js";
import { createDatabase, createIndexedSessionSanitizerReport, indexCodexSessions } from "../packages/core/src/index.js";
import { createSessionSanitizerReport } from "../packages/core/src/session-sanitizer.js";
import { createLooTools } from "../packages/mcp-server/src/tools.js";

const syntheticApiKey = ["sk", "test_1234567890abcdef"].join("-");
const syntheticBearerToken = ["abcdefghijklmnop", "12345"].join("");
const syntheticBearerWithSuffix = ["abcdefghijklmnop", "+private=="].join("");
const syntheticCookie = ["sessionid", "supersecret12345"].join("=");
const syntheticPrivateKeyBody = ["fake-private", "key-body"].join("-");
const syntheticLocalPath = ["/Users/exampleuser", ".ssh/id_ed25519"].join("/");
const syntheticMacPathWithSpaces = ["/Users/exampleuser/Library", "Application Support/Codex/session.jsonl"].join("/");
const tsxImport = createRequire(import.meta.url).resolve("tsx");
const cliEntry = fileURLToPath(new URL("../packages/cli/src/index.ts", import.meta.url));

const syntheticSecretText = [
  "Final closeout: remove leaked synthetic credentials before sharing.",
  `api_key=${syntheticApiKey}`,
  `Authorization: Bearer ${syntheticBearerToken}`,
  `Cookie: ${syntheticCookie}; theme=light`,
  "-----BEGIN PRIVATE KEY-----",
  syntheticPrivateKeyBody,
  "-----END PRIVATE KEY-----",
  `Local path: ${syntheticLocalPath}`,
  "Benign text: sketch a cookie recipe for a demo"
].join("\n");

test("session sanitizer reports synthetic sensitive patterns without raw values", () => {
  const report = createSessionSanitizerReport({
    sources: [
      {
        sourceRef: "codex_thread:synthetic-sanitizer",
        text: syntheticSecretText
      }
    ],
    now: "2026-06-29T11:25:00.000Z"
  });

  assert.equal(report.ok, true);
  assert.equal(report.publicSafe, true);
  assert.equal(report.generatedAt, "2026-06-29T11:25:00.000Z");
  assert.equal(report.sourceCount, 1);
  assert.equal(report.findingCount, 5);
  assert.deepEqual(report.blockers, []);

  const classes = report.findings.map((finding) => finding.patternClass).sort();
  assert.deepEqual(classes, ["api_key", "bearer_token", "cookie", "local_path", "private_key"]);
  assert.equal(report.findings.every((finding) => finding.sourceRef === "codex_thread:synthetic-sanitizer"), true);
  assert.equal(report.findings.every((finding) => finding.fingerprint.startsWith("hmac-sha256:")), true);
  assert.equal(report.findings.every((finding) => finding.suggestedRepair.length > 0), true);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(syntheticApiKey), false);
  assert.equal(serialized.includes(syntheticBearerToken), false);
  assert.equal(serialized.includes(syntheticCookie), false);
  assert.equal(serialized.includes(syntheticPrivateKeyBody), false);
  assert.equal(serialized.includes(syntheticLocalPath), false);
  assert.match(serialized, /<redacted-secret>/);
  assert.match(serialized, /~\/<redacted-path>/);
});

test("session sanitizer public previews never include raw source text or adjacent findings", () => {
  const rawPromptText = "private customer prompt text";
  const rawToolText = "tool arguments should stay local";
  const report = createSessionSanitizerReport({
    sources: [
      {
        sourceRef: "codex_event:multi-secret-preview",
        text: [
          `${rawPromptText} api_key=${syntheticApiKey} path=${syntheticMacPathWithSpaces} Authorization: Bearer ${syntheticBearerWithSuffix}`,
          `Cookie: ${syntheticCookie}; ${rawToolText}`
        ].join("\n")
      }
    ],
    now: "2026-06-29T11:28:00.000Z",
    auditKey: "synthetic-audit-key"
  });

  assert.equal(report.findingCount, 4);
  assert.equal(report.findings.every((finding) => finding.evidencePreview.includes("source text omitted")), true);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(syntheticApiKey), false);
  assert.equal(serialized.includes(syntheticBearerWithSuffix), false);
  assert.equal(serialized.includes(syntheticCookie), false);
  assert.equal(serialized.includes(syntheticMacPathWithSpaces), false);
  assert.equal(serialized.includes("Application Support"), false);
  assert.equal(serialized.includes(rawPromptText), false);
  assert.equal(serialized.includes(rawToolText), false);
});

test("session sanitizer fingerprints are keyed local audit markers", () => {
  const source = {
    sourceRef: "codex_thread:fingerprint-sanitizer",
    text: `api_key=${syntheticApiKey}`
  };
  const firstReport = createSessionSanitizerReport({
    sources: [source],
    now: "2026-06-29T11:29:00.000Z",
    auditKey: "synthetic-audit-key-one"
  });
  const secondReport = createSessionSanitizerReport({
    sources: [source],
    now: "2026-06-29T11:29:00.000Z",
    auditKey: "synthetic-audit-key-two"
  });

  assert.equal(firstReport.findingCount, 1);
  assert.equal(secondReport.findingCount, 1);
  assert.match(firstReport.findings[0]?.fingerprint ?? "", /^hmac-sha256:/);
  assert.notEqual(firstReport.findings[0]?.fingerprint, secondReport.findings[0]?.fingerprint);
});

test("session sanitizer ignores benign keyword-only text", () => {
  const report = createSessionSanitizerReport({
    sources: [
      {
        sourceRef: "codex_thread:benign-sanitizer",
        text: "We should sketch a cookie consent banner and discuss bearer token policy in docs."
      }
    ],
    now: "2026-06-29T11:26:00.000Z"
  });

  assert.equal(report.ok, true);
  assert.equal(report.publicSafe, true);
  assert.equal(report.findingCount, 0);
  assert.deepEqual(report.findings, []);
});

test("session sanitizer rejects raw source refs in public evidence shape", () => {
  assert.throws(
    () => createSessionSanitizerReport({
      sources: [
        {
          sourceRef: ["/Users/exampleuser", ".codex/sessions/raw.jsonl"].join("/"),
          text: `api_key=${syntheticApiKey}`
        }
      ],
      now: "2026-06-29T11:27:00.000Z"
    }),
    /sourceRef must use a supported source prefix/
  );
  assert.throws(
    () => createSessionSanitizerReport({
      sources: [
        {
          sourceRef: ["codex_thread:", "/Users/exampleuser/.codex/sessions/raw.jsonl"].join(""),
          text: `api_key=${syntheticApiKey}`
        }
      ],
      now: "2026-06-29T11:30:00.000Z"
    }),
    /sourceRef must use a supported source prefix/
  );
});

test("indexed session sanitizer is available through core, CLI, and MCP without raw leaks", async () => {
  const root = mkdtempSync(join(tmpdir(), "loo-indexed-session-sanitizer-"));
  const sessions = join(root, "sessions");
  const dbPath = join(root, "orchestrator.sqlite");
  const evidenceDir = join(root, "evidence");
  const threadId = "019f-sanitizer-cli-mcp";
  const syntheticIndexedSecret = "sk-test_indexed_safe_text_abcdef123456";
  const syntheticIndexedPath = "/Users/exampleuser/Library/Application Support/Codex/private-session.jsonl";
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, "rollout-2026-06-30T00-00-00-019f-sanitizer-cli-mcp.jsonl"), `${[
    {
      timestamp: "2026-06-30T00:00:00.000Z",
      session_meta: {
        payload: {
          id: threadId,
          cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator",
          model: "gpt-5.5",
          git: { branch: "main", commit_hash: "abc1234" }
        }
      }
    },
    { timestamp: "2026-06-30T00:00:00.000Z", event_msg: { type: "thread_name", name: "Sanitizer CLI MCP fixture" } },
    {
      timestamp: "2026-06-30T00:00:00.000Z",
      event_msg: {
        type: "agent_message",
        message: "Project: lossless-openclaw-orchestrator\nStatus: active\nPriority: high\nNext action: run sanitizer dry-run"
      }
    }
  ].map((line) => JSON.stringify(line)).join("\n")}\n`);

  const db = createDatabase(dbPath);
  try {
    indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    db.prepare("UPDATE codex_sessions SET safe_text = safe_text || ? WHERE thread_id = ?").run(
      `\nLegacy indexed safe-text leak ${syntheticIndexedSecret} ${syntheticIndexedPath}`,
      threadId
    );

    const coreReport = createIndexedSessionSanitizerReport(db, {
      threadId,
      limit: 5,
      now: "2026-06-30T00:01:00.000Z",
      auditKey: "synthetic-indexed-sanitizer-audit-key"
    });
    assert.equal(coreReport.dryRun, true);
    assert.equal(coreReport.mutatesCodex, false);
    assert.equal(coreReport.sourceCount, 1);
    assert.equal(coreReport.findingCount, 2);
    assert.deepEqual(coreReport.scannedRefs, [`codex_thread:${threadId}`]);
    assert.deepEqual(coreReport.findings.map((finding) => finding.patternClass).sort(), ["api_key", "local_path"]);
    assertNoSanitizerLeaks(coreReport, [syntheticIndexedSecret, syntheticIndexedPath]);

    const cliResult = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      cliEntry,
      "sanitize",
      "sessions",
      "--thread-id",
      threadId,
      "--limit",
      "5",
      "--evidence-dir",
      evidenceDir
    ], {
      env: { ...process.env, LOO_DB_PATH: dbPath },
      encoding: "utf8",
      timeout: 15_000
    });
    assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);
    const cliReport = JSON.parse(cliResult.stdout) as ReturnType<typeof createIndexedSessionSanitizerReport>;
    assert.equal(cliReport.findingCount, 2);
    assert.deepEqual(cliReport.scannedRefs, [`codex_thread:${threadId}`]);
    assert.equal(existsSync(join(evidenceDir, "session-sanitizer-report.json")), true);
    assertNoSanitizerLeaks(cliResult.stdout, [syntheticIndexedSecret, syntheticIndexedPath]);
    assertNoSanitizerLeaks(readFileSync(join(evidenceDir, "session-sanitizer-report.json"), "utf8"), [syntheticIndexedSecret, syntheticIndexedPath]);

    const tools = createLooTools({
      db,
      audit: createAuditStore(join(root, "audit.jsonl")),
      codexClient: { request: async () => ({ ok: true }) }
    });
    const sanitizerTool = tools.find((tool) => tool.name === "loo_session_sanitizer");
    assert.ok(sanitizerTool);
    const toolReport = await sanitizerTool.execute({ thread_id: threadId, limit: 5 }) as ReturnType<typeof createIndexedSessionSanitizerReport>;
    assert.equal(toolReport.dryRun, true);
    assert.equal(toolReport.findingCount, 2);
    assert.deepEqual(toolReport.scannedRefs, [`codex_thread:${threadId}`]);
    assertNoSanitizerLeaks(toolReport, [syntheticIndexedSecret, syntheticIndexedPath]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function assertNoSanitizerLeaks(value: unknown, forbidden: string[]): void {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  for (const raw of forbidden) assert.equal(serialized.includes(raw), false, `sanitizer report leaked ${raw}`);
}
