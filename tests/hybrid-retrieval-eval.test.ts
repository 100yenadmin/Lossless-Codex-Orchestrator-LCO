import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("retrieval eval proves hybrid expansion beats lexical baseline on redacted fixture", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-hybrid-retrieval-"));
  const sessions = join(root, "sessions");
  const evidencePath = join(root, "retrieval-eval.json");
  const scenarioPath = join(root, "retrieval-scenarios.json");
  const dbPath = join(root, "orchestrator.sqlite");
  mkdirSync(sessions, { recursive: true });

  writeJsonl(join(sessions, "rollout-2026-06-29T00-00-00-019f-hybrid-target.jsonl"), [
    {
      session_meta: {
        payload: {
          id: "019f-hybrid-target",
          cwd: "/Volumes/LEXAR/repos/lossless-openclaw-orchestrator",
          model: "gpt-5.5",
          git: { branch: "main", commit_hash: "abc1234" }
        }
      }
    },
    { event_msg: { type: "thread_name", name: "TCC automation fallback review" } },
    {
      response_item: {
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: "<proposed_plan>\nEvaluate CUA Driver and Peekaboo fallback readiness for Accessibility and Screen Recording permission gates.\n</proposed_plan>"
        }]
      }
    },
    { event_msg: { type: "agent_message", message: "Final: public-safe TCC fallback evidence captured for CUA and Peekaboo." } }
  ]);

  writeJsonl(join(sessions, "rollout-2026-06-29T00-00-00-019f-baseline-distractor.jsonl"), [
    {
      session_meta: {
        payload: {
          id: "019f-baseline-distractor",
          cwd: "/Volumes/LEXAR/repos/example",
          model: "gpt-5.5"
        }
      }
    },
    { event_msg: { type: "thread_name", name: "background desktop permissions note" } },
    { event_msg: { type: "agent_message", message: "Final: generic desktop permissions note without adapter-specific fallback evidence." } }
  ]);

  writeFileSync(scenarioPath, `${JSON.stringify({
    codexRoots: [sessions],
    scenarios: [{
      id: "desktop-permission-fallback",
      query: "background desktop permissions",
      expectedSourceRefs: ["codex_thread:019f-hybrid-target"],
      expansionQueries: ["CUA Peekaboo Accessibility Screen Recording TCC"],
      limit: 1
    }]
  }, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "eval",
      "retrieval",
      "--scenario-file",
      scenarioPath,
      "--evidence-path",
      evidencePath,
      "--strict"
    ], {
      cwd: process.cwd(),
      env: { ...process.env, LOO_DB_PATH: dbPath },
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      ok: boolean;
      publicSafe: boolean;
      vector: { enabled: boolean; reason: string };
      scenarios: Array<{
        baseline: { hitAtK: boolean; topRefs: string[] };
        hybrid: { hitAtK: boolean; topRefs: string[]; expansionQueries: string[] };
      }>;
      privateDataExclusions: string[];
    };

    assert.equal(report.ok, true);
    assert.equal(report.publicSafe, true);
    assert.equal(report.vector.enabled, false);
    assert.match(report.vector.reason, /not configured|unavailable/i);
    assert.equal(report.scenarios[0]?.baseline.hitAtK, false);
    assert.equal(report.scenarios[0]?.baseline.topRefs[0], "codex_thread:019f-baseline-distractor");
    assert.equal(report.scenarios[0]?.hybrid.hitAtK, true);
    assert.equal(report.scenarios[0]?.hybrid.topRefs[0], "codex_thread:019f-hybrid-target");
    assert.deepEqual(report.scenarios[0]?.hybrid.expansionQueries, ["CUA Peekaboo Accessibility Screen Recording TCC"]);
    assert.match(report.privateDataExclusions.join("\n"), /raw Codex transcripts/i);
    assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /<proposed_plan>|Final:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retrieval eval strict mode fails closed when scenario files are empty", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-empty-retrieval-eval-"));
  const evidencePath = join(root, "retrieval-eval.json");
  const scenarioPath = join(root, "retrieval-scenarios.json");
  const dbPath = join(root, "orchestrator.sqlite");
  writeFileSync(scenarioPath, `${JSON.stringify({ scenarios: [] }, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "packages/cli/src/index.ts",
      "eval",
      "retrieval",
      "--scenario-file",
      scenarioPath,
      "--evidence-path",
      evidencePath,
      "--strict"
    ], {
      cwd: process.cwd(),
      env: { ...process.env, LOO_DB_PATH: dbPath },
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      ok: boolean;
      blockers: string[];
      metrics: { scenarioCount: number };
    };
    assert.equal(report.ok, false);
    assert.equal(report.metrics.scenarioCount, 0);
    assert.deepEqual(report.blockers, ["no_scenarios"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeJsonl(path: string, rows: unknown[]): void {
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
