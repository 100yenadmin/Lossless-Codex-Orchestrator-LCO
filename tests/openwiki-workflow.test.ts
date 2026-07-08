import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("manual OpenWiki workflow is docs-only, Z.AI-gated, and PR-based", () => {
  const workflowPath = ".github/workflows/openwiki-update.yml";
  assert.equal(existsSync(workflowPath), true, "OpenWiki workflow must exist");

  const workflow = read(workflowPath);

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\bschedule:/);
  assert.doesNotMatch(workflow, /\bcron:/);

  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /pull-requests:\s*write/);
  assert.doesNotMatch(workflow, /actions:\s*write|issues:\s*write|packages:\s*write/);

  assert.match(workflow, /ZAI_API_KEY:\s*\$\{\{\s*secrets\.ZAI_API_KEY\s*\}\}/);
  assert.match(workflow, /OPENWIKI_PROVIDER:\s*zai/);
  assert.match(workflow, /OPENWIKI_MODEL_ID:\s*glm-5\.2/);
  assert.match(workflow, /OPENWIKI_OUTPUT_DIR:\s*openwiki/);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENROUTER|FIREWORKS/i);

  assert.match(workflow, /node scripts\/guard-openwiki-diff\.mjs/);
  assert.match(workflow, /peter-evans\/create-pull-request@v\d+/);
  assert.match(workflow, /add-paths:\s*\|\s*\n\s+openwiki\/\*\*/);
  assert.match(workflow, /provider/i);
  assert.match(workflow, /model/i);
  assert.match(workflow, /manual_dispatch/i);
});

test("OpenWiki diff guard accepts only openwiki paths", () => {
  assert.equal(existsSync("scripts/guard-openwiki-diff.mjs"), true, "diff guard must exist");

  const safe = spawnSync("node", ["scripts/guard-openwiki-diff.mjs", "--stdin"], {
    input: "openwiki/index.md\nopenwiki/_metadata/workflow-run.json\n",
    encoding: "utf8"
  });
  assert.equal(safe.status, 0, safe.stderr || safe.stdout);

  const unsafe = spawnSync("node", ["scripts/guard-openwiki-diff.mjs", "--stdin"], {
    input: "openwiki/index.md\nREADME.md\n.github/workflows/ci.yml\n",
    encoding: "utf8"
  });
  assert.notEqual(unsafe.status, 0, "unsafe paths must fail closed");
  assert.match(`${unsafe.stdout}\n${unsafe.stderr}`, /README\.md/);
  assert.match(`${unsafe.stdout}\n${unsafe.stderr}`, /\.github\/workflows\/ci\.yml/);
});
