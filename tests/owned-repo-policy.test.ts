import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("owned-repo policy pointers are present for LCO PR handoffs", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const agentsPath = resolve(repoRoot, "AGENTS.md");
  const templatePath = resolve(repoRoot, ".github/PULL_REQUEST_TEMPLATE.md");

  assert.equal(existsSync(agentsPath), true, `missing ${agentsPath}`);
  assert.equal(existsSync(templatePath), true, `missing ${templatePath}`);

  const agents = readFileSync(agentsPath, "utf8");
  const template = readFileSync(templatePath, "utf8");

  assert.match(agents, /^## Shared Owned-Repo Policy$/m);
  assert.match(agents, /^- Shared rollout tracker: https:\/\/github\.com\/100yenadmin\/codex-operating-kit\/issues\/5$/m);
  assert.match(agents, /^- Shared kit merge: `100yenadmin\/codex-operating-kit@d1bd004a85da6967041765b46fcb8885a88b802b`$/m);
  assert.match(agents, /^- Before merge, release, or readiness claims, query current-head review threads and separate resolvable review threads from top-level bot comments and check annotations\.$/m);
  assert.match(agents, /`docs\/BETA_RELEASE_RUNBOOK\.md`/);
  assert.match(agents, /`docs\/RELEASE_CHECKLIST\.md`/);
  assert.match(agents, /`docs\/SOURCE_AUTHORITY_PROFILE\.md`/);
  assert.match(agents, /`docs\/CLAIM_AUDIT\.md`/);

  assert.match(template, /^## Linked Issue And Tracker$/m);
  assert.match(template, /^- Linked issue:$/m);
  assert.match(template, /^- Tracker or milestone:$/m);
  assert.match(template, /^## Review And Check State$/m);
  assert.match(template, /^- Terminal review-thread counts:$/m);
  assert.match(template, /^- Top-level bot comments reviewed:$/m);
  assert.match(template, /^- Check annotations reviewed:$/m);
  assert.match(template, /^## Release Proof Tier$/m);
  assert.match(template, /^- Release-note impact: none \| required$/m);
  assert.match(template, /^## Safety \/ Rollback$/m);
  assert.match(template, /^- Blast radius:$/m);
  assert.match(template, /^- Rollback plan:$/m);
  assert.match(template, /^## Evidence$/m);
  assert.match(template, /^- Evidence path:$/m);
  assert.match(template, /^## Next-Agent Notes$/m);
  assert.equal([...template.matchAll(/^- Evidence path:/gm)].length, 1);
});
