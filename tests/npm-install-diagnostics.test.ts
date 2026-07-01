import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseNpmInstallFailure } from "../packages/cli/src/npm-install-diagnostics.js";

test("classifies npm before cutoff drift without treating it as an unpublished package", () => {
  const diagnostic = diagnoseNpmInstallFailure({
    stderr: [
      "npm error code ETARGET",
      "npm error notarget No matching version found for lossless-openclaw-orchestrator@0.1.0-beta.18 with a date before 6/29/2026, 9:30:23 AM."
    ].join("\n"),
    packageName: "lossless-openclaw-orchestrator",
    requested: "0.1.0-beta.18",
    registryVersionVisible: true,
    nowIso: "2026-07-01T02:31:13Z"
  });

  assert.equal(diagnostic.code, "npm_before_cutoff_drift");
  assert.equal(diagnostic.publicSafe, true);
  assert.equal(diagnostic.trueUnpublishedVersion, false);
  assert.match(diagnostic.summary, /npm client/i);
  assert.match(diagnostic.suggestedRetry, /--before=2026-07-02T00:00:00.000Z/);
  assert.equal(diagnostic.rawSecretIncluded, false);
});

test("keeps true missing npm versions separate from cutoff drift", () => {
  const diagnostic = diagnoseNpmInstallFailure({
    stderr: [
      "npm error code E404",
      "npm error 404 No match found for version 9.9.9"
    ].join("\n"),
    packageName: "lossless-openclaw-orchestrator",
    requested: "9.9.9",
    registryVersionVisible: false,
    nowIso: "2026-07-01T02:31:13Z"
  });

  assert.equal(diagnostic.code, "npm_version_unavailable");
  assert.equal(diagnostic.trueUnpublishedVersion, true);
  assert.equal(diagnostic.suggestedRetry, null);
  assert.equal(diagnostic.rawSecretIncluded, false);
});
