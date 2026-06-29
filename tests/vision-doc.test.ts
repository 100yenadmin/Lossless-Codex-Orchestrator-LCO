import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("VISION.md captures product, eval, dogfood, cadence, and proof-boundary contract", () => {
  assert.equal(existsSync("VISION.md"), true, "VISION.md must exist at the repo root");
  const vision = read("VISION.md");
  const readme = read("README.md");
  const packageJson = JSON.parse(read("package.json")) as { files?: string[] };

  for (const heading of [
    "## North Star",
    "## Primary User Stories",
    "## Orchestrator Product-Management Mode",
    "## Scorecards",
    "## Eval Scenarios",
    "## Local OpenClaw Gateway Dogfood",
    "## Milestone Review Cadence",
    "## Proof Boundary",
    "## Evidence Rules"
  ]) {
    assert.match(vision, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const required of [
    /100\+ local Codex sessions/i,
    /hundreds of local agent sessions/i,
    /least context/i,
    /thread metadata/i,
    /project/i,
    /status/i,
    /archive/i,
    /fork/i,
    /hybrid search/i,
    /session sanitizer/i,
    /bounded file, byte, and event limits/i,
    /loo_codex_control_dry_run/i,
    /local OpenClaw gateway/i,
    /issue comments or evidence summaries/i,
    /raw Codex JSONL files/i,
    /tokens, cookies, API keys, credentials/i,
    /Full Claude Code parity/i,
    /Cloud sync/i,
    /Unattended desktop takeover/i,
    /Release-grade enterprise security/i
  ]) {
    assert.match(vision, required);
  }

  assert.match(readme, /VISION\.md/);
  assert.equal(packageJson.files?.includes("VISION.md"), true, "npm package must include VISION.md because README links to it");
});
