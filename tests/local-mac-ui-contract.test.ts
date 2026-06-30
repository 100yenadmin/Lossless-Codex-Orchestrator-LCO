import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(read(path)) as Record<string, unknown>;
}

test("local Mac search UI contract defines a staged safe-summary app shell without overclaiming", () => {
  const docPath = join("docs", "LOCAL_MAC_SEARCH_UI.md");
  assert.equal(existsSync(docPath), true, "docs/LOCAL_MAC_SEARCH_UI.md must exist");
  const doc = read(docPath);

  for (const required of [
    /macOS-only local search UI/i,
    /safe summaries/i,
    /source refs/i,
    /copy/i,
    /project/i,
    /status/i,
    /priority/i,
    /fail closed/i,
    /local DB/i,
    /plugin tools/i,
    /loo_search_sessions/i,
    /loo_grep/i,
    /loo_describe_session/i,
    /loo_describe_ref/i,
    /loo_expand_query/i,
    /loo_codex_thread_map/i,
    /CUA/i,
    /Peekaboo/i,
    /status surfaces/i,
    /raw transcripts/i,
    /screenshots/i,
    /one-click install/i,
    /release-ready macOS app/i,
    /Claude parity/i,
    /GUI mutation/i,
    /explicit approval/i
  ]) {
    assert.match(doc, required);
  }
});

test("local Mac search UI scorecard records acceptance criteria and proof boundary", () => {
  const scorecardPath = join("evals", "scorecards", "v1.0", "local-mac-search-ui-review.json");
  assert.equal(existsSync(scorecardPath), true, "local Mac UI scorecard must exist");
  const scorecard = readJson(scorecardPath);

  assert.equal(scorecard.scorecard_version, "1.0");
  assert.equal(scorecard.surface, "local macOS app shell");
  assert.match(String(scorecard.scenario), /search Codex\/OpenClaw\/future Claude Code sessions/i);
  assert.match(JSON.stringify(scorecard.command_or_tool), /loo_search_sessions/i);
  assert.match(JSON.stringify(scorecard.command_or_tool), /loo_grep/i);
  assert.match(JSON.stringify(scorecard.command_or_tool), /loo_describe_ref/i);
  assert.match(JSON.stringify(scorecard.command_or_tool), /loo_codex_thread_map/i);
  assert.doesNotMatch(JSON.stringify(scorecard.command_or_tool), /loo_codex_session_management_map/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /copy.*source refs/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /fail closed/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /project/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /status/i);
  assert.match(JSON.stringify(scorecard.pass_criteria), /priority/i);
  assert.match(JSON.stringify(scorecard.private_data_exclusions), /raw Codex transcripts/i);
  assert.match(JSON.stringify(scorecard.private_data_exclusions), /screenshots or videos/i);
  assert.match(JSON.stringify(scorecard.known_gaps), /Peekaboo scratch.*proof/i);
  assert.match(JSON.stringify(scorecard.known_gaps), /CUA.*unproven/i);
  assert.match(String(scorecard.proof_boundary), /Peekaboo scratch.*not.*generic GUI mutation/i);
  assert.equal(scorecard.current_score, "example-not-run");
  assert.match(String(scorecard.proof_boundary), /does not prove a signed|release-ready macOS app/i);
});

test("VISION routes the local Mac search UI through the staged UI contract and scorecard", () => {
  const vision = read("VISION.md");

  assert.match(vision, /docs\/LOCAL_MAC_SEARCH_UI\.md/);
  assert.match(vision, /local-mac-search-ui-review\.json/);
  assert.match(vision, /after the CLI, MCP, and OpenClaw gateway paths prove/i);
  assert.match(vision, /without rendering raw transcripts/i);
});
