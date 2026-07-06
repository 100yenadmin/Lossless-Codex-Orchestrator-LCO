import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabase } from "../packages/core/src/index.js";
import { readEnv, resolveHomeDir } from "../packages/runtime/src/env.js";
import { runLoo } from "./helpers/run-loo.js";

test("readEnv prefers LCO_* values and falls back to LOO_* compatibility values", () => {
  assert.equal(readEnv("DB_PATH", {
    LCO_DB_PATH: " /tmp/lco.sqlite ",
    LOO_DB_PATH: " /tmp/loo.sqlite "
  }), "/tmp/lco.sqlite");

  assert.equal(readEnv("DB_PATH", {
    LCO_DB_PATH: "   ",
    LOO_DB_PATH: " /tmp/loo.sqlite "
  }), "/tmp/loo.sqlite");

  assert.equal(readEnv("LCM_DB_PATHS", {
    LOO_LCM_DB_PATHS: "/tmp/lcm-a.sqlite,/tmp/lcm-b.sqlite"
  }), "/tmp/lcm-a.sqlite,/tmp/lcm-b.sqlite");

  assert.equal(readEnv("TELEMETRY", {
    LCO_TELEMETRY: "0",
    LOO_TELEMETRY: "1"
  }), "0");
});

test("resolveHomeDir prefers process env homes and uses os.homedir fallback", () => {
  assert.equal(resolveHomeDir({ HOME: "/env/home", USERPROFILE: "C:\\Users\\Ignored" }, "/os/home"), "/env/home");
  assert.equal(resolveHomeDir({ USERPROFILE: "C:\\Users\\Lco" }, ""), "C:\\Users\\Lco");
  assert.equal(resolveHomeDir({}, "/os/home"), "/os/home");
  assert.equal(resolveHomeDir({}, ""), ".");
});

test("CLI doctor honors LOO_DB_PATH fallback and LCO_DB_PATH precedence", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-env-cli-"));
  const legacyDbPath = join(root, "legacy.sqlite");
  const canonicalDbPath = join(root, "canonical.sqlite");
  const canonicalDb = createDatabase(canonicalDbPath);
  canonicalDb.close();
  const legacyDb = createDatabase(legacyDbPath);
  legacyDb.close();

  try {
    const fallback = runLoo(["doctor"], {
      ...process.env,
      HOME: root,
      LOO_DB_PATH: legacyDbPath,
      LOO_CODEX_BIN: "lco-codex-not-needed"
    });
    assert.equal(fallback.status, 0, fallback.stderr);
    assert.equal(JSON.parse(fallback.stdout).database.configured, true);
    assert.equal(JSON.parse(fallback.stdout).database.activePresent, true);

    rmSync(legacyDbPath, { force: true });
    rmSync(`${legacyDbPath}-shm`, { force: true });
    rmSync(`${legacyDbPath}-wal`, { force: true });
    const canonical = runLoo(["doctor"], {
      ...process.env,
      HOME: root,
      LCO_DB_PATH: canonicalDbPath,
      LOO_DB_PATH: legacyDbPath,
      LCO_CODEX_BIN: "lco-codex-not-needed"
    });
    assert.equal(canonical.status, 0, canonical.stderr);
    const report = JSON.parse(canonical.stdout);
    assert.equal(report.database.configured, true);
    assert.equal(report.database.activePresent, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI default Codex probe resolves a USERPROFILE-style home when HOME is unset", () => {
  const root = mkdtempSync(join(tmpdir(), "lco-userprofile-"));
  const codexRoot = join(root, ".codex", "sessions");
  const sqlitePath = join(codexRoot, "state_1.sqlite");
  const db = createDatabase(sqlitePath);
  db.close();

  try {
    const env = {
      ...process.env,
      HOME: undefined,
      USERPROFILE: root,
      LCO_DB_PATH: join(root, "orchestrator.sqlite")
    };
    const result = runLoo(["probe", "codex-sqlite"], env);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.stores.some((store: { path?: string }) => store.path === sqlitePath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
