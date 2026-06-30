import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const tsxImport = createRequire(import.meta.url).resolve("tsx");
const cliEntry = fileURLToPath(new URL("../packages/cli/src/index.ts", import.meta.url));

test("loo onboard status writes a public-safe first-run readiness artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "loo-onboard-status-"));
  const evidenceDir = join(root, "evidence");
  try {
    const result = spawnSync(process.execPath, [
      "--import",
      tsxImport,
      cliEntry,
      "onboard",
      "status",
      "--evidence-dir",
      evidenceDir,
      "--strict"
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      publicSafe: boolean;
      dryRun: boolean;
      localOnly: boolean;
      packageName: string;
      version: string;
      blockers: string[];
      warnings: string[];
      requiredFiles: Array<{ id: string; exists: boolean; required: boolean }>;
      sourceEntrypoints: Array<{ id: string; exists: boolean; required: boolean }>;
      packageEntrypoints: Array<{ id: string; exists: boolean; required: boolean }>;
      openclaw: {
        manifestPath: string;
        toolCount: number;
        requiredToolsPresent: string[];
        missingRequiredTools: string[];
      };
      nextSafeCommands: string[];
      forbiddenActions: string[];
      proofBoundary: string;
    };

    assert.equal(report.ok, true);
    assert.equal(report.publicSafe, true);
    assert.equal(report.dryRun, true);
    assert.equal(report.localOnly, true);
    assert.equal(report.packageName, "lossless-openclaw-orchestrator");
    assert.match(report.version, /^0\.1\.0-beta\./);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.requiredFiles.every((item) => item.exists), true);
    assert.equal(report.sourceEntrypoints.every((item) => item.exists), true);
    assert.equal(report.packageEntrypoints.some((item) => item.id === "loo"), true);
    assert.equal(report.openclaw.manifestPath, "openclaw.plugin.json");
    assert.ok(report.openclaw.toolCount >= 20);
    assert.deepEqual(report.openclaw.missingRequiredTools, []);
    for (const toolName of ["loo_doctor", "loo_search_sessions", "loo_describe_session", "loo_expand_query"]) {
      assert.ok(report.openclaw.requiredToolsPresent.includes(toolName), toolName);
    }
    assert.ok(report.nextSafeCommands.includes("loo doctor"));
    assert.ok(report.nextSafeCommands.some((command) => command.includes("loo openclaw dogfood")));
    assert.ok(report.forbiddenActions.includes("npm publish"));
    assert.match(report.proofBoundary, /does not install plugins/i);

    const evidencePath = join(evidenceDir, "onboarding-status.json");
    assert.equal(existsSync(evidencePath), true);
    assert.deepEqual(JSON.parse(readFileSync(evidencePath, "utf8")), report);
    assertNoPrivateEvidence(result.stdout);
    assertNoPrivateEvidence(readFileSync(evidencePath, "utf8"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function assertNoPrivateEvidence(value: string): void {
  assert.doesNotMatch(value, /sk-[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(value, /Bearer\s+[^\s"]{16,}/);
  assert.doesNotMatch(value, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  assert.doesNotMatch(value, /\.sqlite\b/);
  assert.doesNotMatch(value, /raw Codex transcript/i);
}
