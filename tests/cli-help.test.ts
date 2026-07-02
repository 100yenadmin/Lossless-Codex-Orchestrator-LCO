import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const tsxImport = createRequire(import.meta.url).resolve("tsx");

function runLoo(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [
    "--import",
    tsxImport,
    "packages/cli/src/index.ts",
    ...args
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env
  });
}

test("loo --help exits zero with top-level usage", () => {
  const result = runLoo(["--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:\n  loo --help/);
  assert.match(result.stdout, /loo --version/);
  assert.match(result.stdout, /loo doctor/);
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

test("loo search --help exits zero without querying the local index", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-search-help-"));
  const dbPath = join(root, "orchestrator.sqlite");
  try {
    const result = runLoo(["search", "--help"], {
      ...process.env,
      LOO_DB_PATH: dbPath
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Usage:\n  loo search <query>/);
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
