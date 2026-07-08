import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function violationPaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
}

test("manual OpenWiki workflow is docs-only, Z.AI-gated, and PR-based", () => {
  const workflowPath = ".github/workflows/openwiki-update.yml";
  assert.equal(existsSync(workflowPath), true, "OpenWiki workflow must exist");

  const workflow = read(workflowPath);

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\bschedule:/);
  assert.doesNotMatch(workflow, /\bcron:/);
  assert.doesNotMatch(workflow, /^\s+openwiki_repository:\s*$/m);
  assert.doesNotMatch(workflow, /^\s+openwiki_ref:\s*$/m);

  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /pull-requests:\s*write/);
  assert.doesNotMatch(workflow, /actions:\s*write|issues:\s*write|packages:\s*write/);

  assert.match(workflow, /ANTHROPIC_API_KEY:\s*\$\{\{\s*secrets\.ZAI_API_KEY\s*\}\}/);
  assert.match(workflow, /ANTHROPIC_BASE_URL:\s*https:\/\/api\.z\.ai\/api\/anthropic/);
  assert.match(workflow, /OPENWIKI_PROVIDER:\s*anthropic/);
  assert.match(workflow, /OPENWIKI_MODEL_ID:\s*GLM-5\.2/);
  assert.match(workflow, /OPENWIKI_OUTPUT_DIR:\s*openwiki/);
  assert.match(workflow, /OPENWIKI_RUNNER_DIR:\s*\.openwiki-runner/);
  assert.match(workflow, /OPENWIKI_REPOSITORY:\s*100yenadmin\/openwiki/);
  assert.match(workflow, /OPENWIKI_REF:\s*99c32b44cf1bcc5dbc35de54d28084205edd9816/);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|OPENROUTER|FIREWORKS/i);
  assert.doesNotMatch(workflow, /OPENWIKI_PROVIDER:\s*zai/);
  assert.doesNotMatch(workflow, /ZAI_API_KEY:\s*\$\{\{\s*secrets\.ZAI_API_KEY\s*\}\}/);

  assert.match(workflow, /repository:\s*\$\{\{\s*env\.OPENWIKI_REPOSITORY\s*\}\}/);
  assert.match(workflow, /ref:\s*\$\{\{\s*env\.OPENWIKI_REF\s*\}\}/);
  assert.match(workflow, /path:\s*\$\{\{\s*env\.OPENWIKI_RUNNER_DIR\s*\}\}/);
  assert.match(workflow, /working-directory:\s*\$\{\{\s*env\.OPENWIKI_RUNNER_DIR\s*\}\}/);
  assert.match(workflow, /COMMAND:\s*\$\{\{\s*inputs\.command\s*\}\}/);
  assert.match(workflow, /if \[ "\$\{COMMAND\}" = "init" \]/);
  assert.doesNotMatch(workflow, /if \[ "\$\{\{\s*inputs\.command\s*\}\}" = "init" \]/);
  assert.match(workflow, /--update --print --no-agent-instructions --modelId/);
  assert.match(workflow, /--init --print --no-agent-instructions --modelId/);
  assert.match(workflow, /rm -rf "\$\{OPENWIKI_RUNNER_DIR\}"/);
  assert.doesNotMatch(workflow, /RUNNER_TEMP\/openwiki-runner/);
  assert.doesNotMatch(workflow, /\$\{\{\s*runner\.temp\s*\}\}/);
  assert.doesNotMatch(workflow, /prompt='Update the LCO OpenWiki orientation docs/);

  assert.match(workflow, /node scripts\/guard-openwiki-diff\.mjs/);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /peter-evans\/create-pull-request@[a-f0-9]{40}/);
  assert.doesNotMatch(workflow, /actions\/checkout@v\d+/);
  assert.doesNotMatch(workflow, /peter-evans\/create-pull-request@v\d+/);
  assert.match(workflow, /add-paths:\s*\|\s*\n\s+openwiki\/\*\*/);
  assert.match(workflow, /provider/i);
  assert.match(workflow, /model/i);
  assert.match(workflow, /manual_dispatch/i);
  assert.match(workflow, /provider_route:\s*"anthropic-compatible"/);
  assert.match(workflow, /base_url:\s*"https:\/\/api\.z\.ai\/api\/anthropic"/);
  assert.match(workflow, /openwiki_ref:\s*process\.env\.OPENWIKI_REF/);
  assert.match(workflow, /openwiki_content_sha256:\s*digest\.digest\("hex"\)/);
  assert.match(workflow, /openwiki_content_file_count:\s*files\.length/);
  assert.match(workflow, /crypto\.createHash\("sha256"\)/);
  assert.doesNotMatch(workflow, /cat\s+>\s+openwiki\/_metadata\/workflow-run\.json\s+<<EOF/);
});

test("OpenWiki diff guard accepts only openwiki paths", () => {
  assert.equal(existsSync("scripts/guard-openwiki-diff.mjs"), true, "diff guard must exist");

  const guard = read("scripts/guard-openwiki-diff.mjs");
  assert.doesNotMatch(guard, /GITHUB_SHA/);
  assert.doesNotMatch(guard, /diff",\s*"--name-only/);

  const safe = spawnSync("node", ["scripts/guard-openwiki-diff.mjs", "--stdin"], {
    input:
      "?? openwiki/index.md\n" +
      "A  openwiki/_metadata/workflow-run.json\n" +
      "R  openwiki/old.md -> openwiki/new.md\n" +
      '?? "openwiki/path with spaces.md"\n' +
      'A  "openwiki/quoted\\040octal.md"\n',
    encoding: "utf8"
  });
  assert.equal(safe.status, 0, safe.stderr || safe.stdout);

  const unsafe = spawnSync("node", ["scripts/guard-openwiki-diff.mjs", "--stdin"], {
    input:
      "?? openwiki/index.md\n" +
      "A  README.md\n" +
      "M  .github/workflows/ci.yml\n" +
      "R  openwiki/a.md -> package.json\n" +
      "?? openwiki/../AGENTS.md\n" +
      '?? "openwiki/\\\\..\\\\secret.md"\n',
    encoding: "utf8"
  });
  assert.notEqual(unsafe.status, 0, "unsafe paths must fail closed");
  assert.deepEqual(violationPaths(`${unsafe.stdout}\n${unsafe.stderr}`), [
    "README.md",
    ".github/workflows/ci.yml",
    "package.json",
    "openwiki/../AGENTS.md",
    "openwiki//../secret.md"
  ]);
});
