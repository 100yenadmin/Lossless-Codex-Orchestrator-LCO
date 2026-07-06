import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createDatabase,
  indexCodexSessions
} from "../packages/core/src/index.js";
import { runLoo } from "./helpers/run-loo.js";

test("loo --help exits zero with top-level usage", () => {
  const result = runLoo(["--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo --help/);
  assert.match(result.stdout, /loo --version/);
  assert.match(result.stdout, /loo doctor/);
  assert.match(result.stdout, /loo hook closeout-capture/);
  assert.match(result.stdout, /loo hook state-prep/);
  assert.match(result.stdout, /loo hook compaction-capture --mode marker/);
  assert.match(result.stdout, /loo release ga-smoke .*--release-status path/);
  assert.match(result.stdout, /loo release ga-smoke .*--privacy-scan path/);
  assert.match(result.stdout, /loo release ga-smoke .*--now iso/);
  assert.match(result.stdout, /loo qa-lab desktop-contract --evidence-dir path/);
  assert.match(result.stdout, /loo qa-lab privacy-scan --evidence-dir path/);
  assert.match(result.stdout, /loo qa-lab judge --run path --rubric-version real-product-v1/);
  assert.match(result.stdout, /loo qa-lab adversarial-review --run path --lenses safety,retrieval,packaging,claims,agent-usability/);
  assert.equal(result.stderr.trim(), "");
});

test("loo --version exits zero with package version", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  const result = runLoo(["--version"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), packageJson.version);
  assert.equal(result.stderr.trim(), "");
});

test("loo parser errors are one-line public-safe messages without stack traces", () => {
  const result = runLoo(["scorecards", "sweep", "--bad-option"]);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "");
  assert.match(result.stderr, /^Error: Unknown scorecards sweep option: --bad-option\n$/);
  assert.doesNotMatch(result.stderr, /\bat\s+/);
  assert.doesNotMatch(result.stderr, /file:\/\//);
  assert.doesNotMatch(result.stderr, /\/Users\//);
  assert.doesNotMatch(result.stderr, /\/Volumes\//);
  assert.doesNotMatch(result.stderr, /packages\/cli\/src\/index/);
});

test("loo runtime errors redact local paths before printing", () => {
  const result = runLoo(["eval", "retrieval", "--scenario-file", "/Users/lume/private/scenario.json"]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "");
  assert.match(result.stderr, /^Error: Scenario file does not exist: <redacted-local-path>\n$/);
  assert.doesNotMatch(result.stderr, /\bat\s+/);
  assert.doesNotMatch(result.stderr, /file:\/\//);
  assert.doesNotMatch(result.stderr, /\/Users\//);
  assert.doesNotMatch(result.stderr, /\/Volumes\//);
});

test("loo runtime errors redact Linux local paths before printing", () => {
  const result = runLoo(["eval", "retrieval", "--scenario-file", "/home/alice/private/scenario.json"]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "");
  assert.match(result.stderr, /^Error: Scenario file does not exist: <redacted-local-path>\n$/);
  assert.doesNotMatch(result.stderr, /\/home\/alice/);
});

test("loo runtime errors redact spaced macOS local paths before printing", () => {
  const result = runLoo(["eval", "retrieval", "--scenario-file", "/Users/john/My Drive/scenario.json"]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "");
  assert.match(result.stderr, /^Error: Scenario file does not exist: <redacted-local-path>\n$/);
  assert.doesNotMatch(result.stderr, /\/Users\/john/);
  assert.doesNotMatch(result.stderr, /My Drive/);
});

test("loo runtime errors redact workspace local paths before printing", () => {
  const result = runLoo(["eval", "retrieval", "--scenario-file", "/workspace/private/scenario.json"]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "");
  assert.match(result.stderr, /^Error: Scenario file does not exist: <redacted-local-path>\n$/);
  assert.doesNotMatch(result.stderr, /\/workspace\/private/);
});

test("loo runtime errors redact Windows local paths before printing", () => {
  const result = runLoo(["eval", "retrieval", "--scenario-file", "C:\\Users\\alice\\private\\scenario.json"]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "");
  assert.match(result.stderr, /^Error: Scenario file does not exist: <redacted-local-path>\n$/);
  assert.doesNotMatch(result.stderr, /C:\\Users\\alice/);
});

test("loo runtime errors redact temp local paths before printing", () => {
  const result = runLoo(["eval", "retrieval", "--scenario-file", "/tmp/loo-private/scenario.json"]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "");
  assert.match(result.stderr, /^Error: Scenario file does not exist: <redacted-local-path>\n$/);
  assert.doesNotMatch(result.stderr, /\/tmp\/loo-private/);
});

test("loo parser validation errors consistently exit as usage errors", () => {
  const tokenBudgetResult = runLoo(["grep", "--token-budget", "nope", "query"]);
  const profileResult = runLoo(["ui", "local-mac-search", "--evidence-dir", "evidence", "--expansion-profile", "raw"]);
  const enumResult = runLoo(["onboard", "status", "--gateway-setup-status", "/home/alice/private-db.sqlite"]);

  assert.equal(tokenBudgetResult.status, 2, tokenBudgetResult.stderr || tokenBudgetResult.stdout);
  assert.match(tokenBudgetResult.stderr, /^Error: --token-budget requires a number\n$/);
  assert.equal(profileResult.status, 2, profileResult.stderr || profileResult.stdout);
  assert.match(profileResult.stderr, /^Error: --expansion-profile must be metadata, brief, or evidence\n$/);
  assert.equal(enumResult.status, 2, enumResult.stderr || enumResult.stdout);
  assert.match(enumResult.stderr, /^Error: Invalid --gateway-setup-status: <redacted-local-path>\n$/);
  assert.doesNotMatch(enumResult.stderr, /\/home\/alice/);
});

test("loo doctor omits local database paths from public-safe output", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-doctor-"));
  try {
    const dbPath = join(root, "orchestrator.sqlite");
    const result = runLoo(["doctor"], {
      ...process.env,
      LOO_DB_PATH: dbPath
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as { dbPath?: unknown; database?: { configured?: unknown; activePresent?: unknown; location?: unknown } };
    assert.equal(Object.hasOwn(report, "dbPath"), false);
    assert.deepEqual(report.database, { configured: true, activePresent: false, location: "local" });
    assert.doesNotMatch(result.stdout, new RegExp(dbPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(result.stdout, /orchestrator\.sqlite/);
    assert.equal(result.stderr.trim(), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo describe exits nonzero with structured ref_not_found JSON for unknown refs", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-describe-not-found-"));
  try {
    const dbPath = join(root, "orchestrator.sqlite");
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, "billing.jsonl"),
      [
        { timestamp: "2026-07-06T13:00:00.000Z", session_meta: { payload: { id: "019f-describe-known" } } },
        { timestamp: "2026-07-06T13:00:01.000Z", event_msg: { type: "thread_name", name: "Billing bridge canary" } },
        { timestamp: "2026-07-06T13:00:02.000Z", event_msg: { type: "agent_message", message: "Final: Billing bridge canary complete." } }
      ].map((line) => JSON.stringify(line)).join("\n") + "\n"
    );
    const db = createDatabase(dbPath);
    try {
      indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    } finally {
      db.close();
    }

    const result = runLoo(["describe", "codex_thread:019f-missing-billing"], {
      ...process.env,
      LOO_DB_PATH: dbPath
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(result.stderr.trim(), "");
    const payload = JSON.parse(result.stdout) as {
      ok?: unknown;
      code?: unknown;
      ref?: unknown;
      reason?: unknown;
      message?: unknown;
      nearestMatches?: Array<{ sourceRef?: unknown; title?: unknown; score?: unknown }>;
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "ref_not_found");
    assert.equal(payload.ref, "codex_thread:019f-missing-billing");
    assert.equal(payload.reason, "ref_not_found");
    assert.equal(payload.message, "Unknown Codex thread: 019f-missing-billing");
    assert.deepEqual(payload.nearestMatches, [{
      sourceRef: "codex_thread:019f-describe-known",
      title: "Billing bridge canary",
      score: 1
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo doctor reports missing DB as read-only first-run not_indexed_yet guidance", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-doctor-missing-db-"));
  try {
    const dbPath = join(root, "missing", "orchestrator.sqlite");
    assert.equal(existsSync(dbPath), false);

    const result = runLoo(["doctor"], {
      ...process.env,
      LOO_DB_PATH: dbPath
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      database?: { configured?: unknown; activePresent?: unknown; location?: unknown };
      codexJsonlDrift?: {
        state?: unknown;
        availability?: unknown;
        nextAction?: unknown;
        readOnly?: unknown;
      };
    };
    assert.deepEqual(report.database, { configured: true, activePresent: false, location: "local" });
    assert.equal(report.codexJsonlDrift?.state, "not_indexed_yet");
    assert.equal(report.codexJsonlDrift?.availability, "requires_index_run");
    assert.equal(report.codexJsonlDrift?.nextAction, "loo index codex \"$HOME/.codex/sessions\"");
    assert.equal(report.codexJsonlDrift?.readOnly, true);
    assert.equal(existsSync(dbPath), false);
    assert.doesNotMatch(result.stdout, /orchestrator\.sqlite|\/Volumes\/LEXAR|\/Users\//);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo doctor reports clean Codex JSONL drift status without local paths", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-doctor-drift-clean-"));
  try {
    const dbPath = join(root, "orchestrator.sqlite");
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, "clean.jsonl"),
      [
        { timestamp: "2026-07-06T13:00:00.000Z", type: "session_meta", payload: { id: "019f-doctor-drift-clean", cwd: "/Volumes/LEXAR/repos/example", model: "gpt-5.5" } },
        { timestamp: "2026-07-06T13:00:01.000Z", type: "event_msg", payload: { type: "agent_message", message: "Clean doctor drift fixture." } }
      ].map((line) => JSON.stringify(line)).join("\n") + "\n"
    );
    const db = createDatabase(dbPath);
    try {
      indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    } finally {
      db.close();
    }

    const result = runLoo(["doctor"], {
      ...process.env,
      LOO_DB_PATH: dbPath
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      codexJsonlDrift?: { state?: unknown; filesWithDrift?: unknown; topUnknownEventKinds?: unknown; docsRef?: unknown };
    };
    assert.equal(report.codexJsonlDrift?.state, "clean");
    assert.equal(report.codexJsonlDrift?.filesWithDrift, 0);
    assert.deepEqual(report.codexJsonlDrift?.topUnknownEventKinds, []);
    assert.equal(report.codexJsonlDrift?.docsRef, "docs/CODEX_JSONL_DRIFT.md");
    assert.doesNotMatch(result.stdout, /clean\.jsonl|orchestrator\.sqlite|\/Volumes\/LEXAR|\/Users\//);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo doctor reports never-indexed Codex JSONL drift as first-run guidance until index runs", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-doctor-drift-first-run-"));
  const dbPath = join(root, "orchestrator.sqlite");
  const sessions = join(root, "sessions");
  try {
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, "first-run.jsonl"),
      [
        { timestamp: "2026-07-06T13:05:00.000Z", type: "session_meta", payload: { id: "019f-doctor-first-run", cwd: "/Volumes/LEXAR/repos/example", model: "gpt-5.5" } },
        { timestamp: "2026-07-06T13:05:01.000Z", type: "event_msg", payload: { type: "agent_message", message: "First-run doctor canary indexed." } }
      ].map((line) => JSON.stringify(line)).join("\n") + "\n"
    );
    const freshDb = new DatabaseSync(dbPath);
    try {
      assert.deepEqual(freshDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(), []);
    } finally {
      freshDb.close();
    }

    const firstDoctor = runLoo(["doctor"], {
      ...process.env,
      LOO_DB_PATH: dbPath
    });

    assert.equal(firstDoctor.status, 0, firstDoctor.stderr || firstDoctor.stdout);
    const firstReport = JSON.parse(firstDoctor.stdout) as {
      codexJsonlDrift?: {
        state?: unknown;
        availability?: unknown;
        nextAction?: unknown;
        readOnly?: unknown;
      };
    };
    assert.equal(firstReport.codexJsonlDrift?.state, "not_indexed_yet");
    assert.equal(firstReport.codexJsonlDrift?.availability, "requires_index_run");
    assert.equal(firstReport.codexJsonlDrift?.nextAction, "loo index codex --max-files 500 \"$HOME/.codex/sessions\" \"$HOME/.codex/archived_sessions\"");
    assert.equal(firstReport.codexJsonlDrift?.readOnly, true);
    assert.doesNotMatch(firstDoctor.stdout, /schema_missing|first-run\.jsonl|orchestrator\.sqlite|\/Volumes\/LEXAR|\/Users\//);
    const afterDoctorDb = new DatabaseSync(dbPath);
    try {
      assert.deepEqual(afterDoctorDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(), []);
    } finally {
      afterDoctorDb.close();
    }

    const indexed = runLoo(["index", "codex", "--max-files", "10", sessions], {
      ...process.env,
      LOO_DB_PATH: dbPath
    });
    assert.equal(indexed.status, 0, indexed.stderr || indexed.stdout);

    const postIndexDoctor = runLoo(["doctor"], {
      ...process.env,
      LOO_DB_PATH: dbPath
    });

    assert.equal(postIndexDoctor.status, 0, postIndexDoctor.stderr || postIndexDoctor.stdout);
    const postIndexReport = JSON.parse(postIndexDoctor.stdout) as {
      codexJsonlDrift?: {
        state?: unknown;
        availability?: unknown;
        filesIndexed?: unknown;
        nextAction?: unknown;
      };
    };
    assert.equal(postIndexReport.codexJsonlDrift?.state, "clean");
    assert.equal(postIndexReport.codexJsonlDrift?.availability, "ready");
    assert.equal(postIndexReport.codexJsonlDrift?.filesIndexed, 1);
    assert.equal(postIndexReport.codexJsonlDrift?.nextAction, null);
    assert.doesNotMatch(postIndexDoctor.stdout, /not_indexed_yet|requires_index_run|first-run\.jsonl|orchestrator\.sqlite|\/Volumes\/LEXAR|\/Users\//);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo doctor reports Codex JSONL drift summary without raw drift paths", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-doctor-drift-summary-"));
  try {
    const dbPath = join(root, "orchestrator.sqlite");
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, "future-drift.jsonl"),
      [
        { timestamp: "2026-07-06T13:10:00.000Z", type: "session_meta", payload: { id: "019f-doctor-drift-summary", cwd: "/Volumes/LEXAR/repos/example", model: "gpt-5.5" } },
        {
          timestamp: "2026-07-06T13:10:01.000Z",
          type: "event_msg",
          payload: {
            type: "assistant packet/v2",
            renamed_payload: { content: "Doctor drift summary should count this kind without leaking text." }
          }
        },
        "{not valid json"
      ].map((line) => typeof line === "string" ? line : JSON.stringify(line)).join("\n") + "\n"
    );
    const db = createDatabase(dbPath);
    try {
      indexCodexSessions(db, { roots: [sessions], maxFiles: 10 });
    } finally {
      db.close();
    }

    const result = runLoo(["doctor"], {
      ...process.env,
      LOO_DB_PATH: dbPath
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      codexJsonlDrift?: {
        state?: unknown;
        filesWithDrift?: unknown;
        unknownEventKinds?: unknown;
        unparsedLines?: unknown;
        topUnknownEventKinds?: Array<{ kind: string; count: number }>;
        docsRef?: unknown;
      };
    };
    assert.equal(report.codexJsonlDrift?.state, "drift_detected");
    assert.equal(report.codexJsonlDrift?.filesWithDrift, 1);
    assert.equal(report.codexJsonlDrift?.unknownEventKinds, 1);
    assert.equal(report.codexJsonlDrift?.unparsedLines, 1);
    assert.match(report.codexJsonlDrift?.topUnknownEventKinds?.[0]?.kind ?? "", /^assistant_packet_v2_[a-f0-9]{6}$/);
    assert.equal(report.codexJsonlDrift?.docsRef, "docs/CODEX_JSONL_DRIFT.md");
    assert.doesNotMatch(result.stdout, /future-drift\.jsonl|orchestrator\.sqlite|\/Volumes\/LEXAR|\/Users\/|Doctor drift summary should count/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo search --help exits zero without querying the local index", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-search-help-"));
  const dbPath = join(root, "orchestrator.sqlite");
  try {
    const result = runLoo(["search", "--help"], {
      ...process.env,
      LOO_DB_PATH: dbPath
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Usage:\n  loo search \[--limit n\] \[--timeout-ms ms\] <query>/);
    assert.match(result.stdout, /--timeout-ms ms\s+SQLite busy timeout plus slow-query classifier/);
    assert.match(result.stdout, /Search indexed Codex sessions/i);
    assert.doesNotMatch(result.stdout, /^\s*\[/);
    assert.equal(result.stderr.trim(), "");
    assert.equal(existsSync(dbPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo search treats --help as query text when it is not the only argument", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-search-query-help-"));
  try {
    const result = runLoo(["search", "foo", "--help"], {
      ...process.env,
      LOO_DB_PATH: join(root, "orchestrator.sqlite")
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stdout, /Usage:\n  loo search <query>/);
    assert.match(result.stdout, /^\s*\[/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo openclaw dogfood --help exits zero with command-specific usage", () => {
  const result = runLoo(["openclaw", "dogfood", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo openclaw dogfood/);
  assert.match(result.stdout, /--install-source path/);
  assert.match(result.stdout, /public-safe/i);
  assert.match(result.stdout, /Replace the default required loo_\* tool set/i);
  assert.match(result.stdout, /With --install-source, it may run OpenClaw plugin install/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo onboard status --help exits zero with first-run safety guidance", () => {
  const result = runLoo(["onboard", "status", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo onboard status/);
  assert.match(result.stdout, /first-run readiness report/i);
  assert.match(result.stdout, /does not install plugins/i);
  assert.match(result.stdout, /does not publish npm/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo openclaw published-smoke --help exposes selector-drift diagnostic input", () => {
  const result = runLoo(["openclaw", "published-smoke", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo openclaw published-smoke/);
  assert.match(result.stdout, /--npm-install-diagnostic-report path/);
  assert.match(result.stdout, /--gateway-ready-strict/);
  assert.match(result.stdout, /npm selector drift/i);
  assert.match(result.stdout, /package-path strict/i);
  assert.match(result.stdout, /publishedSmokeReady/i);
  assert.match(result.stdout, /both flags/i);
  assert.match(result.stdout, /configured gateway proof is recorded separately/i);
  assert.match(result.stdout, /without storing raw npm output/i);
  assert.doesNotMatch(result.stdout, /published npm beta install path/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo release general-readiness --help uses version-neutral stable wording", () => {
  const result = runLoo(["release", "general-readiness", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo release general-readiness/);
  assert.match(result.stdout, /current package version/i);
  assert.match(result.stdout, /fresh npm proof/i);
  assert.match(result.stdout, /agent dogfood proof/i);
  assert.match(result.stdout, /does not move npm dist-tags/i);
  assert.doesNotMatch(result.stdout, /1\.0 general-release readiness/i);
  assert.doesNotMatch(result.stdout, /move npm latest/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo release ga-smoke --help exposes aggregate-only GA evidence contract", () => {
  const result = runLoo(["release", "ga-smoke", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo release ga-smoke/);
  assert.match(result.stdout, /--package-version version/);
  assert.match(result.stdout, /--candidate-sha sha/);
  assert.match(result.stdout, /--allow-setup-required/);
  assert.match(result.stdout, /aggregate/i);
  assert.match(result.stdout, /does not publish npm/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo qa-lab tool-coverage --help exposes strict real-product coverage gate", () => {
  const result = runLoo(["qa-lab", "tool-coverage", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo qa-lab tool-coverage/);
  assert.match(result.stdout, /--coverage-policy full\|facade/);
  assert.match(result.stdout, /every canonical declared `loo_\*` tool/);
  assert.match(result.stdout, /compatibility aliases credit their target/);
  assert.match(result.stdout, /writes `tool-coverage\.json`/);
  assert.match(result.stdout, /does not invoke tools/i);
  assert.match(result.stdout, /does not publish npm/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo qa-lab desktop-contract --help exposes metadata-only desktop proof boundary", () => {
  const result = runLoo(["qa-lab", "desktop-contract", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo qa-lab desktop-contract/);
  assert.match(result.stdout, /--readiness-report path/);
  assert.match(result.stdout, /--action-bound-scratch-proof path/);
  assert.match(result.stdout, /writes `desktop-contract\.json`/);
  assert.match(result.stdout, /metadata/i);
  assert.match(result.stdout, /does not run GUI mutation/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo qa-lab privacy-scan --help exposes public-safe evidence scan boundary", () => {
  const result = runLoo(["qa-lab", "privacy-scan", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo qa-lab privacy-scan/);
  assert.match(result.stdout, /--scan-dir path/);
  assert.match(result.stdout, /writes `privacy-scan\.json`/);
  assert.match(result.stdout, /raw transcripts/i);
  assert.match(result.stdout, /secret-like/i);
  assert.match(result.stdout, /does not read raw Codex stores/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo openclaw tool-smoke --help exits zero with proof-boundary usage", () => {
  const result = runLoo(["openclaw", "tool-smoke", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo openclaw tool-smoke/);
  assert.match(result.stdout, /--required-tool name/);
  assert.match(result.stdout, /--desktop-fallback-coherence fixture\|omit/);
  assert.match(result.stdout, /loo_codex_control_dry_run/);
  assert.match(result.stdout, /does not run live Codex control/i);
  assert.match(result.stdout, /does not publish npm/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo release preflight --help exits zero with claim-scope usage", () => {
  const result = runLoo(["release", "preflight", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo release preflight/);
  assert.match(result.stdout, /--claim-scope codex-live-control\|codex-read-search-expand-dry-run\|codex-working-app-proof/);
  assert.match(result.stdout, /approved_live_control_smoke_missing/);
  assert.match(result.stdout, /does not publish npm/i);
  assert.match(result.stdout, /does not run live Codex control/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo release bundle --help exits zero with publish-boundary usage", () => {
  const result = runLoo(["release", "bundle", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo release bundle/);
  assert.match(result.stdout, /--claim-scope codex-live-control\|codex-read-search-expand-dry-run\|codex-working-app-proof/);
  assert.match(result.stdout, /release notes/i);
  assert.match(result.stdout, /does not publish npm/i);
  assert.match(result.stdout, /does not create a GitHub Release/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo release demo-status --help exits zero with demo-boundary usage", () => {
  const result = runLoo(["release", "demo-status", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo release demo-status/);
  assert.match(result.stdout, /--min-sessions n/);
  assert.match(result.stdout, /demo evidence/i);
  assert.match(result.stdout, /does not run live Codex control/i);
  assert.match(result.stdout, /does not perform desktop GUI mutation/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo runtime issue-packet --help exits zero with no-external-write boundary", () => {
  const result = runLoo(["runtime", "issue-packet", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo runtime issue-packet/);
  assert.match(result.stdout, /--failure-report path/);
  assert.match(result.stdout, /issue-ready handoff packet/i);
  assert.match(result.stdout, /never runs gh issue create/i);
  assert.match(result.stdout, /never writes to GitHub/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo qa-lab judge --help exits zero with deterministic review boundary", () => {
  const result = runLoo(["qa-lab", "judge", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo qa-lab judge/);
  assert.match(result.stdout, /lco\.qaLab\.judgeReview\.v1/);
  assert.match(result.stdout, /does not call a model/i);
  assert.match(result.stdout, /raw prompts/i);
  assert.equal(result.stderr.trim(), "");
});

test("loo qa-lab adversarial-review --help exits zero with no-raw-evidence boundary", () => {
  const result = runLoo(["qa-lab", "adversarial-review", "--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo qa-lab adversarial-review/);
  assert.match(result.stdout, /lco\.qaLab\.adversarialReview\.v1/);
  assert.match(result.stdout, /Raw evidence fields/i);
  assert.match(result.stdout, /tokens, cookies, and customer data are not echoed/i);
  assert.equal(result.stderr.trim(), "");
});
