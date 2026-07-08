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
  assert.doesNotMatch(workflow, /openwiki_repository:/);
  assert.doesNotMatch(workflow, /openwiki_ref:/);

  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /pull-requests:\s*write/);
  assert.doesNotMatch(workflow, /actions:\s*write|issues:\s*write|packages:\s*write/);

  assert.match(workflow, /ZAI_API_KEY:\s*\$\{\{\s*secrets\.ZAI_API_KEY\s*\}\}/);
  assert.match(workflow, /OPENWIKI_PROVIDER:\s*zai/);
  assert.match(workflow, /OPENWIKI_MODEL_ID:\s*glm-5\.2/);
  assert.match(workflow, /OPENWIKI_OUTPUT_DIR:\s*openwiki/);
  assert.match(workflow, /OPENWIKI_REPOSITORY:\s*langchain-ai\/openwiki/);
  assert.match(workflow, /OPENWIKI_REF:\s*[a-f0-9]{40}/);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENROUTER|FIREWORKS/i);

  assert.match(workflow, /repository:\s*\$\{\{\s*env\.OPENWIKI_REPOSITORY\s*\}\}/);
  assert.match(workflow, /ref:\s*\$\{\{\s*env\.OPENWIKI_REF\s*\}\}/);
  assert.match(workflow, /COMMAND:\s*\$\{\{\s*inputs\.command\s*\}\}/);
  assert.match(workflow, /if \[ "\$\{COMMAND\}" = "init" \]/);
  assert.doesNotMatch(workflow, /if \[ "\$\{\{\s*inputs\.command\s*\}\}" = "init" \]/);

  assert.match(workflow, /node scripts\/guard-openwiki-diff\.mjs/);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /peter-evans\/create-pull-request@[a-f0-9]{40}/);
  assert.doesNotMatch(workflow, /actions\/checkout@v\d+/);
  assert.doesNotMatch(workflow, /peter-evans\/create-pull-request@v\d+/);
  assert.match(workflow, /add-paths:\s*\|\s*\n\s+openwiki\/\*\*/);
  assert.match(workflow, /provider/i);
  assert.match(workflow, /model/i);
  assert.match(workflow, /manual_dispatch/i);
  assert.doesNotMatch(workflow, /cat\s+>\s+openwiki\/_metadata\/workflow-run\.json\s+<<EOF/);
});

test("OpenWiki diff guard accepts only openwiki paths", () => {
  assert.equal(existsSync("scripts/guard-openwiki-diff.mjs"), true, "diff guard must exist");

  const safe = spawnSync("node", ["scripts/guard-openwiki-diff.mjs", "--stdin"], {
    input: "?? openwiki/index.md\nA  openwiki/_metadata/workflow-run.json\nR  openwiki/old.md -> openwiki/new.md\n",
    encoding: "utf8"
  });
  assert.equal(safe.status, 0, safe.stderr || safe.stdout);

  const unsafe = spawnSync("node", ["scripts/guard-openwiki-diff.mjs", "--stdin"], {
    input: "?? openwiki/index.md\nA  README.md\nM  .github/workflows/ci.yml\nR  openwiki/a.md -> package.json\n?? openwiki/../AGENTS.md\n",
    encoding: "utf8"
  });
  assert.notEqual(unsafe.status, 0, "unsafe paths must fail closed");
  assert.match(`${unsafe.stdout}\n${unsafe.stderr}`, /README\.md/);
  assert.match(`${unsafe.stdout}\n${unsafe.stderr}`, /\.github\/workflows\/ci\.yml/);
  assert.match(`${unsafe.stdout}\n${unsafe.stderr}`, /package\.json/);
  assert.match(`${unsafe.stdout}\n${unsafe.stderr}`, /openwiki\/\.\.\/AGENTS\.md/);
});
