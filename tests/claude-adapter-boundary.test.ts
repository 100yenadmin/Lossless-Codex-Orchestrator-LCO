import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { createClaudeCodeAdapter } from "../packages/adapters/src/claude.js";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("Claude adapter boundary inventory exists without claiming parity", () => {
  assert.equal(existsSync("docs/CLAUDE_ADAPTER_BOUNDARY.md"), true, "Claude boundary inventory doc must exist");
  const boundary = read("docs/CLAUDE_ADAPTER_BOUNDARY.md");
  const readme = read("README.md");
  const vision = read("VISION.md");

  assert.match(boundary, /#163/);
  assert.match(boundary, /#166/);
  assert.match(boundary, /read-only session inventory/i);
  assert.match(boundary, /first adapter proof step/i);
  assert.match(boundary, /storage path/i);
  assert.match(boundary, /control surface/i);
  assert.match(boundary, /https:\/\/docs\.anthropic\.com\/en\/docs\/claude-code\/settings/);
  assert.match(boundary, /https:\/\/docs\.anthropic\.com\/en\/docs\/claude-code\/cli-reference/);
  assert.match(boundary, /https:\/\/docs\.anthropic\.com\/en\/docs\/claude-code\/mcp/);
  assert.match(boundary, /https:\/\/docs\.anthropic\.com\/en\/docs\/claude-code\/hooks/);
  assert.match(boundary, /does not prove Claude Code indexing, control, parity, GUI mutation, or cloud sync/i);
  assert.doesNotMatch(boundary, /full Claude Code parity|control Claude Code remotely|unattended Claude takeover/i);

  assert.match(readme, /docs\/CLAUDE_ADAPTER_BOUNDARY\.md/);
  assert.match(vision, /CLAUDE_ADAPTER_BOUNDARY\.md/);
});

test("Claude adapter stub exposes proof boundary metadata", () => {
  const adapter = createClaudeCodeAdapter();

  assert.equal(adapter.status, "proof-boundary-inventory");
  assert.equal(adapter.parity, false);
  assert.equal(adapter.liveControlProven, false);
  assert.equal(adapter.firstProofStep, "read-only-session-inventory");
  assert.deepEqual(adapter.forbiddenClaims, [
    "Claude Code indexing parity",
    "Claude Code live control",
    "Claude Code GUI mutation",
    "cloud sync"
  ]);
});
