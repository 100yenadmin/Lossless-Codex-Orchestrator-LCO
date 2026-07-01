import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("owned-repo policy pointers are present for LCO PR handoffs", () => {
  assert.equal(existsSync("AGENTS.md"), true);
  assert.equal(existsSync(".github/PULL_REQUEST_TEMPLATE.md"), true);

  const agents = readFileSync("AGENTS.md", "utf8");
  const template = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");

  assert.match(agents, /codex-operating-kit/i);
  assert.match(agents, /100yenadmin\/codex-operating-kit\/issues\/5/i);
  assert.match(agents, /review threads/i);
  assert.match(agents, /top-level bot comments/i);
  assert.match(agents, /check annotations/i);
  assert.match(agents, /docs\/BETA_RELEASE_RUNBOOK\.md/i);
  assert.match(agents, /docs\/RELEASE_CHECKLIST\.md/i);

  assert.match(template, /linked issue/i);
  assert.match(template, /tracker/i);
  assert.match(template, /terminal review-thread counts/i);
  assert.match(template, /top-level bot comments/i);
  assert.match(template, /check annotations/i);
  assert.match(template, /release proof tier/i);
  assert.match(template, /release-note impact/i);
  assert.match(template, /evidence path/i);
  assert.match(template, /next-agent notes/i);
});
