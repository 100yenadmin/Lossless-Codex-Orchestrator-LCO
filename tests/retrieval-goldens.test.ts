import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  createDatabase,
  evaluateRetrievalBaselineScenarios,
  indexCodexSessions
} from "../packages/core/src/index.js";
import type { RetrievalBaselineFloors } from "../packages/core/src/index.js";

const scenarioFile = "evals/scenarios/retrieval-goldens/v1/goldens.json";
const floorFile = "evals/scenarios/retrieval-goldens/v1/baseline-floors.json";
const v2ScenarioFile = "evals/scenarios/retrieval-goldens/v2/goldens.json";
const v2FloorFile = "evals/scenarios/retrieval-goldens/v2/baseline-floors.json";

test("retrieval goldens preserve the recorded field-weighted FTS floors", () => {
  const payload = readJson(scenarioFile) as RetrievalGoldenPayload;
  const floors = readJson(floorFile) as RetrievalBaselineFloors;
  const scenarioDir = dirname(resolve(scenarioFile));
  const fixtureRoots = payload.codexRoots.map((root) => resolve(scenarioDir, root));

  assert.equal(payload.schema, "lco.retrievalGoldens.v1");
  assert.equal(payload.scenarios.length >= 30 && payload.scenarios.length <= 50, true);
  assert.deepEqual(payload.codexRoots, ["./sessions"]);
  assert.equal(fixtureRoots.length, 1);
  assert.match(fixtureRoots[0]!, /evals\/scenarios\/retrieval-goldens\/v1\/sessions$/);
  assert.equal(existsSync(fixtureRoots[0]!), true);
  assert.equal(readdirSync(fixtureRoots[0]!).filter((name) => name.endsWith(".jsonl")).length >= 25, true);
  for (const scenario of payload.scenarios) {
    assert.equal(typeof scenario.id, "string");
    assert.equal(typeof scenario.family, "string");
    assert.equal(typeof scenario.rationale, "string");
    assert.equal(typeof scenario.query, "string");
    assert.equal(Number.isInteger(scenario.k), true);
    assert.equal(Array.isArray(scenario.expectedSourceRefs), true);
    assert.equal(scenario.expectedSourceRefs.length > 0, true);
  }

  const root = mkdtempSync(join(tmpdir(), "loo-retrieval-goldens-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const indexed = indexCodexSessions(db, { roots: fixtureRoots, maxFiles: 100 });
    assert.equal(indexed.errors.length, 0);
    assert.equal(indexed.indexedThreads >= 25, true);

    const report = evaluateRetrievalBaselineScenarios(db, {
      scenarios: payload.scenarios,
      floors,
      now: "2026-07-06T00:00:00.000Z"
    });

    assert.equal(report.ok, true, report.blockers.join("\n"));
    assert.equal(report.strategy, "field-weighted-fts-ranking");
    assert.equal(report.metrics.scenarioCount, payload.scenarios.length);
    assert.equal(report.metrics.overall.hitAt1 >= floors.overall.hitAt1, true);
    assert.equal(report.metrics.overall.hitAt5 >= floors.overall.hitAt5, true);
    assert.equal(report.metrics.overall.mrr >= floors.overall.mrr, true);
    for (const [family, familyFloors] of Object.entries(floors.families)) {
      assert.equal(report.metrics.families[family]?.hitAt1 >= familyFloors.hitAt1, true, family);
      assert.equal(report.metrics.families[family]?.hitAt5 >= familyFloors.hitAt5, true, family);
      assert.equal(report.metrics.families[family]?.mrr >= familyFloors.mrr, true, family);
    }
    assert.equal(report.metrics.families.multi_term_cap?.hitAt1, 1);
    assert.equal(report.metrics.families.multi_term_cap?.hitAt5, 1);
    assert.equal(report.metrics.families.multi_term_cap?.mrr, 1);
    assert.equal(report.metrics.overall.hitAt1, 1);
    assert.equal(report.metrics.overall.hitAt5, 1);
    assert.equal(report.metrics.overall.mrr, 1);
    // multi_term_cap queries sit under CODEX_SEARCH_FTS_TERM_CAP, so none should
    // carry the actual truncation reason code (query_terms_truncated) emitted by
    // search.ts/index.ts — the prior "_to_12" suffix never existed, making the
    // assertion vacuous.
    assert.equal(report.scenarios
      .filter((scenario) => scenario.family === "multi_term_cap")
      .every((scenario) => !scenario.reasonCodes.includes("query_terms_truncated")), true);
    assert.equal(report.scenarios.every((scenario) => scenario.topRefs.every((ref) => ref.startsWith("codex_thread:"))), true);
    assert.doesNotMatch(JSON.stringify(report), /<proposed_plan>|Final:/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("retrieval goldens v2 preserve an unsaturated baseline and skip future event-FTS cases", () => {
  const payload = readJson(v2ScenarioFile) as RetrievalGoldenPayload;
  const floors = readJson(v2FloorFile) as RetrievalBaselineFloors;
  const scenarioDir = dirname(resolve(v2ScenarioFile));
  const fixtureRoots = payload.codexRoots.map((root) => resolve(scenarioDir, root));
  const activeScenarios = payload.scenarios.filter((scenario) => !(scenario.requires ?? []).includes("event-fts"));
  const eventFtsScenarios = payload.scenarios.filter((scenario) => (scenario.requires ?? []).includes("event-fts"));

  assert.equal(payload.schema, "lco.retrievalGoldens.v2");
  assert.equal(payload.scenarios.length >= 40 && payload.scenarios.length <= 80, true);
  assert.deepEqual(payload.codexRoots, ["./sessions"]);
  assert.equal(floors.scenarioSet, "retrieval-goldens/v2");
  assert.equal(floors.scenarioCount, activeScenarios.length);
  assert.equal(eventFtsScenarios.length >= 5, true);
  assert.equal(activeScenarios.length >= 35, true);
  assert.equal(fixtureRoots.length, 1);
  assert.match(fixtureRoots[0]!, /evals\/scenarios\/retrieval-goldens\/v2\/sessions$/);
  assert.equal(existsSync(fixtureRoots[0]!), true);
  assert.equal(readdirSync(fixtureRoots[0]!).filter((name) => name.endsWith(".jsonl")).length >= 40, true);

  const expectedFamilies = new Set([
    "near_duplicate_distractor",
    "vocabulary_mismatch",
    "cross_session",
    "long_session_dilution"
  ]);
  for (const family of expectedFamilies) {
    assert.equal(activeScenarios.some((scenario) => scenario.family === family), true, family);
    assert.equal(floors.families[family]?.scenarioCount, activeScenarios.filter((scenario) => scenario.family === family).length, family);
  }
  assert.equal(activeScenarios
    .filter((scenario) => scenario.family === "vocabulary_mismatch")
    .every((scenario) => (scenario.expansionQueries ?? []).length > 0), true);

  for (const scenario of payload.scenarios) {
    assert.equal(typeof scenario.id, "string");
    assert.equal(typeof scenario.family, "string");
    assert.equal(typeof scenario.rationale, "string");
    assert.equal(typeof scenario.query, "string");
    assert.equal(Number.isInteger(scenario.k), true);
    assert.equal(Array.isArray(scenario.expectedSourceRefs), true);
    assert.equal(scenario.expectedSourceRefs.length > 0, true);
    assert.equal((scenario.requires ?? []).every((item) => typeof item === "string"), true);
    assert.equal((scenario.expansionQueries ?? []).every((item) => typeof item === "string"), true);
  }

  const root = mkdtempSync(join(tmpdir(), "loo-retrieval-goldens-v2-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const indexed = indexCodexSessions(db, { roots: fixtureRoots, maxFiles: 200 });
    assert.equal(indexed.errors.length, 0);
    assert.equal(indexed.indexedThreads >= 40, true);

    const report = evaluateRetrievalBaselineScenarios(db, {
      scenarios: payload.scenarios,
      floors,
      now: floors.measuredAt
    });

    assert.equal(report.ok, true, report.blockers.join("\n"));
    assert.equal(report.strategy, "field-weighted-fts-ranking");
    assert.equal(report.metrics.scenarioCount, activeScenarios.length);
    assert.equal(report.metrics.skippedScenarioCount, eventFtsScenarios.length);
    assert.equal(report.scenarios.filter((scenario) => scenario.skipped).length, eventFtsScenarios.length);
    assert.equal(report.metrics.overall.hitAt1 >= floors.overall.hitAt1, true);
    assert.equal(report.metrics.overall.hitAt5 >= floors.overall.hitAt5, true);
    assert.equal(report.metrics.overall.mrr >= floors.overall.mrr, true);
    assert.equal(report.metrics.overall.hitAt1 >= 0.6 && report.metrics.overall.hitAt1 <= 0.85, true);
    assert.equal(report.metrics.overall.hitAt1 < 1, true);
    for (const [family, familyFloors] of Object.entries(floors.families)) {
      assert.equal(report.metrics.families[family]?.hitAt1 >= familyFloors.hitAt1, true, family);
      assert.equal(report.metrics.families[family]?.hitAt5 >= familyFloors.hitAt5, true, family);
      assert.equal(report.metrics.families[family]?.mrr >= familyFloors.mrr, true, family);
    }
    assert.equal(report.scenarios
      .filter((scenario) => scenario.skipped)
      .every((scenario) => scenario.reasonCodes.includes("requires:event-fts")), true);
    assert.equal(report.scenarios
      .filter((scenario) => !scenario.skipped)
      .every((scenario) => scenario.topRefs.every((ref) => ref.startsWith("codex_thread:"))), true);
    assert.doesNotMatch(JSON.stringify(report), /<proposed_plan>|Final:/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo eval retrieval strict mode writes a public-safe baseline regression report", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-retrieval-goldens-cli-"));
  const evidencePath = join(root, "retrieval-goldens-report.json");
  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "eval",
      "retrieval",
      "--scenario-file",
      scenarioFile,
      "--floor-file",
      floorFile,
      "--evidence-path",
      evidencePath,
      "--strict"
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = readJson(evidencePath) as {
      ok: boolean;
      publicSafe: boolean;
      strategy: string;
      metrics: { scenarioCount: number };
      scenarios: Array<{ topRefs: string[]; reasonCodes: string[] }>;
    };
    assert.equal(report.ok, true);
    assert.equal(report.publicSafe, true);
    assert.equal(report.strategy, "field-weighted-fts-ranking");
    assert.equal(report.metrics.scenarioCount >= 30, true);
    assert.equal(report.scenarios.every((scenario) => scenario.reasonCodes.length > 0), true);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /<proposed_plan>|Final:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loo eval retrieval strict mode fails closed when the referenced corpus is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-retrieval-missing-corpus-"));
  const missingScenarioFile = join(root, "missing-corpus-goldens.json");
  const evidencePath = join(root, "retrieval-missing-corpus-report.json");
  const payload = readJson(scenarioFile) as RetrievalGoldenPayload;
  writeFileSync(missingScenarioFile, `${JSON.stringify({
    ...payload,
    codexRoots: ["./missing-sessions"],
    scenarios: payload.scenarios.slice(0, 1)
  }, null, 2)}\n`);
  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "eval",
      "retrieval",
      "--scenario-file",
      missingScenarioFile,
      "--evidence-path",
      evidencePath,
      "--strict"
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    });

    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    const reportText = readFileSync(evidencePath, "utf8");
    const report = JSON.parse(reportText) as {
      ok: boolean;
      publicSafe: boolean;
      blockers: string[];
      metrics?: unknown;
      scenarios?: unknown;
      nextSafeCommands: string[];
      actionsPerformed: Record<string, false>;
    };
    assert.equal(report.ok, false);
    assert.equal(report.publicSafe, true);
    assert.equal(report.blockers.some((blocker) => blocker.startsWith("corpus_missing:")), true);
    assert.equal("metrics" in report, false);
    assert.equal("scenarios" in report, false);
    assert.equal(report.nextSafeCommands.some((command) => command.includes("mkdir -p")), true);
    assert.equal(Object.values(report.actionsPerformed).every((value) => value === false), true);
    assert.doesNotMatch(reportText, /\/Users\/|\/Volumes\/|\.jsonl|\.sqlite|PRIVATE_CANARY_TOKEN/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

type RetrievalGoldenPayload = {
  schema: "lco.retrievalGoldens.v1" | "lco.retrievalGoldens.v2";
  codexRoots: string[];
  scenarios: Array<{
    id: string;
    family: string;
    rationale: string;
    query: string;
    expectedSourceRefs: string[];
    expansionQueries?: string[];
    requires?: string[];
    k: number;
  }>;
};
