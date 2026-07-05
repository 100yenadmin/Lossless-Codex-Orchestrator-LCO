import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  createDatabase,
  evaluateRetrievalBaselineScenarios,
  indexCodexSessions
} from "../packages/core/src/index.js";

const scenarioFile = "evals/scenarios/retrieval-goldens/v1/goldens.json";
const floorFile = "evals/scenarios/retrieval-goldens/v1/baseline-floors.json";

test("retrieval goldens preserve the recorded field-weighted FTS floors", () => {
  const payload = readJson(scenarioFile) as RetrievalGoldenPayload;
  const floors = readJson(floorFile) as RetrievalBaselineFloors;
  const scenarioDir = dirname(resolve(scenarioFile));
  const fixtureRoots = payload.codexRoots.map((root) => resolve(scenarioDir, root));

  assert.equal(payload.schema, "lco.retrievalGoldens.v1");
  assert.equal(payload.scenarios.length >= 30 && payload.scenarios.length <= 50, true);
  assert.equal(fixtureRoots.length, 1);
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
    assert.equal(report.scenarios
      .filter((scenario) => scenario.family === "multi_term_cap")
      .every((scenario) => !scenario.reasonCodes.includes("query_terms_truncated_to_12")), true);
    assert.equal(report.scenarios.every((scenario) => scenario.topRefs.every((ref) => ref.startsWith("codex_thread:"))), true);
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

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

type RetrievalGoldenPayload = {
  schema: "lco.retrievalGoldens.v1";
  codexRoots: string[];
  scenarios: Array<{
    id: string;
    family: string;
    rationale: string;
    query: string;
    expectedSourceRefs: string[];
    k: number;
  }>;
};

type RetrievalBaselineFloors = {
  overall: {
    hitAt1: number;
    hitAt5: number;
    mrr: number;
  };
  families: Record<string, {
    scenarioCount?: number;
    hitAt1: number;
    hitAt5: number;
    mrr: number;
  }>;
};
