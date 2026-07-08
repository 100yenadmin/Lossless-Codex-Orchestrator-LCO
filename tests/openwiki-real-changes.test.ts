import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const scriptPath = resolve("scripts/detect-openwiki-real-changes.mjs");

function runDetector(input: string, githubOutput?: string) {
  return spawnSync(process.execPath, [scriptPath, "--stdin", ...(githubOutput ? ["--github-output"] : [])], {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(githubOutput ? { GITHUB_OUTPUT: githubOutput } : {})
    }
  });
}

function parseDetectorOutput(stdout: string) {
  return JSON.parse(stdout) as {
    hasRealOpenWikiChanges: boolean;
    changedPathCount: number;
    realChangedPathCount: number;
    realChangedPaths: string[];
  };
}

test("OpenWiki real-change detector treats empty status as no-op", () => {
  const result = runDetector("");
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const parsed = parseDetectorOutput(result.stdout);
  assert.equal(parsed.hasRealOpenWikiChanges, false);
  assert.equal(parsed.changedPathCount, 0);
  assert.equal(parsed.realChangedPathCount, 0);
});

test("OpenWiki real-change detector ignores workflow run metadata only", () => {
  const temp = mkdtempSync(join(process.cwd(), ".tmp-openwiki-real-changes-"));
  const outputPath = join(temp, "github-output");
  try {
    const result = runDetector(" M openwiki/_metadata/workflow-run.json\n", outputPath);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const parsed = parseDetectorOutput(result.stdout);
    assert.equal(parsed.hasRealOpenWikiChanges, false);
    assert.equal(parsed.changedPathCount, 1);
    assert.equal(parsed.realChangedPathCount, 0);
    assert.match(readFileSync(outputPath, "utf8"), /^has_changes=false$/m);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("OpenWiki real-change detector reports real docs changes", () => {
  const result = runDetector(
    " M openwiki/_metadata/workflow-run.json\n" +
      " M openwiki/operations.md\n" +
      '?? "openwiki/path with spaces.md"\n'
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const parsed = parseDetectorOutput(result.stdout);
  assert.equal(parsed.hasRealOpenWikiChanges, true);
  assert.deepEqual(parsed.realChangedPaths, ["openwiki/operations.md", "openwiki/path with spaces.md"]);
});

test("OpenWiki real-change detector fails closed on unsafe paths", () => {
  const result = runDetector(
    " M openwiki/operations.md\n" +
      " M README.md\n" +
      "R  openwiki/a.md -> package.json\n" +
      "?? openwiki/../AGENTS.md\n"
  );

  assert.notEqual(result.status, 0, "unsafe paths must fail closed");
  assert.match(result.stderr, /changed paths outside openwiki/);
  assert.match(result.stderr, /README\.md/);
  assert.match(result.stderr, /package\.json/);
  assert.match(result.stderr, /openwiki\/\.\.\/AGENTS\.md/);
});
