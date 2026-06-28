import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabase,
  expandSession,
  getCodexFinalMessages,
  getCodexPlans,
  getCodexToolCalls,
  getCodexTouchedFiles,
  indexCodexSessions
} from "../packages/core/src/index.js";

type ExpectedEval = {
  threadId: string;
  plans: string[];
  finalMessages: string[];
  touchedFiles: string[];
  toolCalls: string[];
  toolCallDetails: Array<{ callId: string; toolName: string; argumentsText: string }>;
  safeTextRequired: string[];
  safeTextForbidden: string[];
};

type CountScore = {
  expected: number;
  actual: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
};

const fixtureRoot = join(process.cwd(), "tests", "fixtures", "codex-extraction");

test("redacted extraction fixture meets precision and recall targets for orchestrator fields", () => {
  assert.equal(existsSync(join(fixtureRoot, "redacted-session.jsonl")), true);
  const expected = JSON.parse(readFileSync(join(fixtureRoot, "expected.json"), "utf8")) as ExpectedEval;
  const root = mkdtempSync(join(tmpdir(), "loo-extraction-eval-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const indexed = indexCodexSessions(db, { roots: [fixtureRoot], maxFiles: 10 });
    assert.equal(indexed.errors.length, 0);
    assert.equal(indexed.indexedThreads, 1);

    const plans = getCodexPlans(db, { threadId: expected.threadId }).map((plan) => plan.text);
    const finals = getCodexFinalMessages(db, { threadId: expected.threadId }).map((final) => final.text);
    const touchedFiles = getCodexTouchedFiles(db, { threadId: expected.threadId });
    const toolCallDetails = getCodexToolCalls(db, { threadId: expected.threadId });
    const toolCalls = toolCallDetails.map((call) => `${call.callId}:${call.toolName}`).sort();

    assert.deepEqual({
      plans: score(plans, expected.plans),
      finals: score(finals, expected.finalMessages),
      touchedFiles: score(touchedFiles, expected.touchedFiles),
      toolCalls: score(toolCalls, expected.toolCalls)
    }, {
      plans: perfectScore(expected.plans.length),
      finals: perfectScore(expected.finalMessages.length),
      touchedFiles: perfectScore(expected.touchedFiles.length),
      toolCalls: perfectScore(expected.toolCalls.length)
    });

    const row = db.prepare("SELECT safe_text AS safeText, summary FROM codex_sessions WHERE thread_id = ?").get(expected.threadId) as { safeText: string; summary: string };
    const safeEnvelope = `${row.summary}\n${row.safeText}`;
    assert.deepEqual(expected.safeTextRequired.filter((term) => safeEnvelope.includes(term)).sort(), expected.safeTextRequired.sort());
    assert.deepEqual(expected.safeTextForbidden.filter((term) => safeEnvelope.includes(term)), []);

    assert.deepEqual(toolCallDetails, expected.toolCallDetails);
    const forbiddenPattern = new RegExp(expected.safeTextForbidden.map(escapeRegExp).join("|"));
    for (const call of toolCallDetails) {
      assert.doesNotMatch(call.argumentsText, forbiddenPattern);
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("redacted fixture expansion matches 1k and 4k bounded snapshots", () => {
  const expected = JSON.parse(readFileSync(join(fixtureRoot, "expected.json"), "utf8")) as ExpectedEval;
  const root = mkdtempSync(join(tmpdir(), "loo-expansion-snapshot-"));
  const db = createDatabase(join(root, "orchestrator.sqlite"));
  try {
    const indexed = indexCodexSessions(db, { roots: [fixtureRoot], maxFiles: 10 });
    assert.equal(indexed.errors.length, 0);
    const forbiddenPattern = forbiddenSafeTextPattern(expected);

    for (const budget of [1000, 4000] as const) {
      const snapshot = readFileSync(join(fixtureRoot, `expected-expansion-${budget}.txt`), "utf8").trimEnd();
      const expanded = expandSession(db, { threadId: expected.threadId, tokenBudget: budget });
      assert.equal(expanded.tokenBudget, budget);
      assert.equal(expanded.text, snapshot);
      assert.doesNotMatch(expanded.text, forbiddenPattern);
    }
    assert.notEqual(
      readFileSync(join(fixtureRoot, "expected-expansion-1000.txt"), "utf8"),
      readFileSync(join(fixtureRoot, "expected-expansion-4000.txt"), "utf8")
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function score(actual: string[], expected: string[]): CountScore {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const truePositives = [...actualSet].filter((value) => expectedSet.has(value)).length;
  const falsePositives = [...actualSet].filter((value) => !expectedSet.has(value)).length;
  const falseNegatives = [...expectedSet].filter((value) => !actualSet.has(value)).length;
  return {
    expected: expected.length,
    actual: actual.length,
    truePositives,
    falsePositives,
    falseNegatives,
    precision: actual.length === 0 ? 0 : truePositives / actual.length,
    recall: expected.length === 0 ? 1 : truePositives / expected.length
  };
}

function perfectScore(count: number): CountScore {
  return {
    expected: count,
    actual: count,
    truePositives: count,
    falsePositives: 0,
    falseNegatives: 0,
    precision: 1,
    recall: 1
  };
}

function forbiddenSafeTextPattern(expected: ExpectedEval): RegExp {
  return new RegExp(expected.safeTextForbidden.map(escapeRegExp).join("|"));
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
