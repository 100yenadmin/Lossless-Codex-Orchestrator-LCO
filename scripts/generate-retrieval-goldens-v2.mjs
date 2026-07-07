import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDatabase,
  evaluateRetrievalBaselineScenarios,
  indexCodexSessions
} from "../packages/core/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const scenarioRoot = join(repoRoot, "evals/scenarios/retrieval-goldens/v2");
const sessionRoot = join(scenarioRoot, "sessions");
const measuredAt = "2026-07-08T00:00:00.000Z";

const scenarios = [];
const sessionRows = new Map();
let minute = 0;

rmSync(sessionRoot, { recursive: true, force: true });
mkdirSync(sessionRoot, { recursive: true });

function addScenario(input) {
  scenarios.push({
    id: input.id,
    family: input.family,
    query: input.query,
    expectedSourceRefs: [`codex_thread:${input.targetId}`],
    ...(input.expansionQueries ? { expansionQueries: input.expansionQueries } : {}),
    ...(input.requires ? { requires: input.requires } : {}),
    k: input.k ?? 5,
    rationale: input.rationale
  });
}

function addSession(id, title, body, options = {}) {
  if (sessionRows.has(id)) throw new Error(`duplicate session id: ${id}`);
  const timestamp = new Date(Date.parse(measuredAt) + minute * 60_000).toISOString();
  minute += 1;
  const rows = [
    {
      timestamp,
      session_meta: {
        payload: {
          id,
          cwd: "/workspace/lco-goldens-v2",
          model: "gpt-5.5",
          git: {
            branch: "150-goldens-v2",
            commit_hash: "goldensv2fixture"
          }
        }
      }
    },
    { timestamp, event_msg: { type: "thread_name", name: title } },
    {
      timestamp,
      response_item: {
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: body
        }]
      }
    },
    {
      timestamp,
      response_item: {
        type: "function_call",
        call_id: `${id}-tool`,
        name: "functions.exec_command",
        arguments: JSON.stringify({ cmd: `sed -n '1,120p' packages/evals/retrieval-v2/${id}.ts` })
      }
    },
    {
      timestamp,
      event_msg: {
        type: "agent_message",
        message: options.closeout ?? `Closeout note for ${id}: public-safe retrieval fixture indexed.`
      }
    }
  ];
  sessionRows.set(id, rows);
}

function writeSessions() {
  for (const [id, rows] of sessionRows) {
    const file = join(sessionRoot, `rollout-2026-07-08T00-00-00-${id}.jsonl`);
    writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  }
}

function longFiller(label) {
  return Array.from({ length: 120 }, (_, index) => `neutral ${label} filler segment ${index + 1}`).join(" ");
}

const nearCases = [
  ["near-01", "aurora invoice checksum rollback", "aurora invoice checkpoint replay"],
  ["near-02", "borealis queue sentinel waiver", "borealis queue sentinel window"],
  ["near-03", "cobalt adapter manifest quorum", "cobalt adapter manifest journal"],
  ["near-04", "delta packet scrubber escrow", "delta packet scrubber export"],
  ["near-05", "ember routing cache pledge", "ember routing cache preview"],
  ["near-06", "frost relay budget braid", "frost relay budget bridge"],
  ["near-07", "harbor mirror ledger bracket", "harbor mirror ledger basket"],
  ["near-08", "ion sponsor docket lantern", "ion sponsor docket lattice"],
  ["near-09", "juniper consent marker repair", "juniper consent marker report"],
  ["near-10", "krypton audit braid freezer", "krypton audit braid filter"]
];

nearCases.forEach(([id, query, distractor], index) => {
  const suffix = id.split("-")[1];
  const targetId = `019f-golden-v2-${id}`;
  const distractorId = `019f-golden-v2-near-distractor-${suffix}`;
  if (index < 8) {
    addSession(targetId, `V2 target ${query}`, `Target evidence says ${query}. The sibling distractor shares nearby lane words but not the target fact.`);
    addSession(distractorId, `V2 distractor ${distractor}`, `Distractor note says ${distractor}, not ${query.split(" ").slice(-1)[0]}.`);
  } else {
    addSession(targetId, `V2 target near duplicate ${suffix}`, `Buried target note says ${query}. ${longFiller(`near ${suffix}`)}`);
    addSession(distractorId, `V2 distractor ${query}`, `Distractor repeats ${query} in a stronger title but points at the wrong public-safe fact.`);
  }
  addScenario({
    id,
    family: "near_duplicate_distractor",
    query,
    targetId,
    rationale: "Near-duplicate sessions share domain terms; the expected source carries the exact synthetic fact."
  });
});

const vocabCases = [
  ["vocab-01", "stalled signup handoff notifies owner", "blocked onboarding alert steward", true],
  ["vocab-02", "billing pause reminder after failed renewal", "subscription hold dunning nudge", true],
  ["vocab-03", "desktop permission prompt before capture", "screen-recording consent preflight", true],
  ["vocab-04", "handover summary for interrupted review", "continuation brief for paused inspection", true],
  ["vocab-05", "agent forgot earlier cache decision", "memory lineage verdict", false],
  ["vocab-06", "slow search needs synonym bridge", "recall expansion bridge", false],
  ["vocab-07", "operator wants task breadcrumb trail", "handoff provenance ledger", false],
  ["vocab-08", "user asks where proof bundle lives", "evidence packet locator", false],
  ["vocab-09", "reviewer requests exact failure cause", "root-cause blocker taxonomy", false],
  ["vocab-10", "planner needs adjacent work surfaced", "neighbor lane discovery", false]
];

vocabCases.forEach(([id, query, expansion, shouldHit]) => {
  const suffix = id.split("-")[1];
  const targetId = `019f-golden-v2-${id}`;
  const distractorId = `019f-golden-v2-vocab-distractor-${suffix}`;
  if (shouldHit) {
    addSession(targetId, `V2 target ${query}`, `Target also records the expansion phrase: ${expansion}.`);
    addSession(distractorId, `V2 distractor broad vocabulary note ${suffix}`, `Distractor mentions nearby vocabulary but omits ${expansion}.`);
  } else {
    addSession(targetId, `V2 target ${expansion}`, `Target uses only the expansion language: ${expansion}.`);
    addSession(distractorId, `V2 distractor ${query}`, `Distractor owns the literal query wording ${query} but is not the intended source.`);
  }
  addScenario({
    id,
    family: "vocabulary_mismatch",
    query,
    targetId,
    expansionQueries: [expansion],
    rationale: "Vocabulary-mismatch scenario includes expansionQueries so future expansion/rerank work can recover the intended source."
  });
});

const crossCases = [
  ["cross-01", "release train proof battery handoff"],
  ["cross-02", "support queue triage closure marker"],
  ["cross-03", "billing bridge scenario owner note"],
  ["cross-04", "runtime watchdog cleanup cadence"],
  ["cross-05", "installer drift proof snapshot"],
  ["cross-06", "adapter review matrix decision"],
  ["cross-07", "onboarding route packet checksum"],
  ["cross-08", "sprint ledger sibling dependency"],
  ["cross-09", "handoff queue stale evidence row"],
  ["cross-10", "roadmap shard parallel gate"]
];

crossCases.forEach(([id, query], index) => {
  const suffix = id.split("-")[1];
  const targetId = `019f-golden-v2-${id}`;
  const distractorId = `019f-golden-v2-cross-distractor-${suffix}`;
  if (index < 7) {
    addSession(targetId, `V2 target ${query}`, `Cross-session target keeps the specific answer for ${query}.`);
    addSession(distractorId, `V2 distractor ${query.split(" ").slice(0, 3).join(" ")} nearby`, `Distractor shares several terms but resolves a different synthetic follow-up.`);
  } else {
    addSession(targetId, `V2 target cross-session ${suffix}`, `The intended cross-session answer is ${query}. ${longFiller(`cross ${suffix}`)}`);
    addSession(distractorId, `V2 distractor ${query}`, `Distractor has stronger lexical placement for ${query} but is not the expected source.`);
  }
  addScenario({
    id,
    family: "cross_session",
    query,
    targetId,
    rationale: "Cross-session query has multiple plausible lexical matches; the target is the intended sibling-session source."
  });
});

const longCases = [
  ["long-01", "quiet archive checksum verdict"],
  ["long-02", "manual approval retry envelope"],
  ["long-03", "control plane breadcrumb stitch"],
  ["long-04", "storage hygiene cold offload"],
  ["long-05", "review thread terminal disposition"],
  ["long-06", "fresh install selector fallback"],
  ["long-07", "watch mode external gate"],
  ["long-08", "privacy scan fixture exclusion"],
  ["long-09", "scorecard rubric threshold note"],
  ["long-10", "command facade narrow mount"]
];

longCases.forEach(([id, query], index) => {
  const suffix = id.split("-")[1];
  const targetId = `019f-golden-v2-${id}`;
  const distractorId = `019f-golden-v2-long-distractor-${suffix}`;
  const buried = `${longFiller(`long ${suffix}`)} Target needle: ${query}. ${longFiller(`tail ${suffix}`)}`;
  if (index < 7) {
    addSession(targetId, `V2 target long-session ${suffix}`, buried);
    addSession(distractorId, `V2 distractor ${query.split(" ").slice(0, 2).join(" ")} aside`, `Distractor has only a partial lexical overlap.`);
  } else {
    addSession(targetId, `V2 target long-session ${suffix}`, buried);
    addSession(distractorId, `V2 distractor ${query}`, `Distractor places ${query} in a compact title and body.`);
  }
  addScenario({
    id,
    family: "long_session_dilution",
    query,
    targetId,
    rationale: "Long-session dilution buries the target phrase inside a large synthetic session body."
  });
});

const eventCases = [
  ["event-01", "turn seventeen refund toggle isolation"],
  ["event-02", "turn twenty one stale lock annotation"],
  ["event-03", "turn nine clipboard denial breadcrumb"],
  ["event-04", "turn thirty two release watcher pulse"],
  ["event-05", "turn eleven command packet echo"]
];

eventCases.forEach(([id, query]) => {
  const targetId = `019f-golden-v2-${id}`;
  addSession(targetId, `V2 target event-granular ${id}`, `${longFiller(id)} Event-level target sentence: ${query}. ${longFiller(`${id} tail`)}`);
  addScenario({
    id,
    family: "event_granular",
    query,
    targetId,
    requires: ["event-fts"],
    rationale: "Future event-content FTS should score this turn-level target; the current baseline harness skips it until event-fts exists."
  });
});

writeSessions();

const payload = {
  schema: "lco.retrievalGoldens.v2",
  scenarioVersion: "2.0",
  scenarioSet: "retrieval-goldens/v2",
  codexRoots: ["./sessions"],
  maxFiles: 200,
  scenarios
};
mkdirSync(scenarioRoot, { recursive: true });
writeFileSync(join(scenarioRoot, "goldens.json"), `${JSON.stringify(payload, null, 2)}\n`);

const tempRoot = mkdtempSync(join(tmpdir(), "lco-goldens-v2-measure-"));
const db = createDatabase(join(tempRoot, "orchestrator.sqlite"));
try {
  const indexed = indexCodexSessions(db, { roots: [sessionRoot], maxFiles: 200 });
  if (indexed.errors.length > 0) throw new Error(`index errors: ${indexed.errors.join("; ")}`);
  const report = evaluateRetrievalBaselineScenarios(db, {
    scenarios,
    now: measuredAt
  });
  const hitAt1 = report.metrics.overall.hitAt1;
  if (hitAt1 < 0.6 || hitAt1 >= 1) {
    throw new Error(`v2 hitAt1 does not preserve recall headroom: ${hitAt1}`);
  }
  const overallFloors = {
    ...report.metrics.overall,
    // Keep the generated floor as a regression threshold, not an upper bound on future ranking gains.
    hitAt1: Math.min(report.metrics.overall.hitAt1, 0.85)
  };
  const floors = {
    schema: "lco.retrievalBaselineFloors.v1",
    engine: "field-weighted-fts-ranking",
    scenarioSet: "retrieval-goldens/v2",
    scenarioCount: report.metrics.scenarioCount,
    skippedScenarioCount: report.metrics.skippedScenarioCount,
    measuredAt,
    overall: overallFloors,
    families: report.metrics.families,
    notes: [
      "Floors record the current field-weighted FTS ranking engine against the unsaturated v2 retrieval goldens.",
      "Scenarios requiring event-fts are present in goldens.json but skipped until event-content FTS is available.",
      "Vocabulary-mismatch scenarios include expansionQueries for future expansion/rerank evaluation."
    ]
  };
  writeFileSync(join(scenarioRoot, "baseline-floors.json"), `${JSON.stringify(floors, null, 2)}\n`);
  console.log(JSON.stringify({
    indexedThreads: indexed.indexedThreads,
    activeScenarios: report.metrics.scenarioCount,
    skippedScenarioCount: report.metrics.skippedScenarioCount,
    overall: report.metrics.overall,
    families: report.metrics.families
  }, null, 2));
} finally {
  db.close();
  rmSync(tempRoot, { recursive: true, force: true });
}
