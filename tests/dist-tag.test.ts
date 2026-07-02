import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PACKAGE_NAME,
  distTagForVersion,
  matchingRegistryStatus,
  mismatchedRegistryStatus,
  registryStatusMatchesDistTag
} from "../packages/cli/src/dist-tag.js";

test("shared dist-tag helpers keep beta rc and stable registry semantics consistent", () => {
  assert.equal(PACKAGE_NAME, "lossless-openclaw-orchestrator");
  assert.equal(distTagForVersion("0.1.0-beta.35"), "beta");
  assert.equal(distTagForVersion("1.0.0-rc.1"), "next");
  assert.equal(distTagForVersion("1.0.0"), "latest");

  assert.equal(matchingRegistryStatus("beta"), "matches_registry_beta");
  assert.equal(matchingRegistryStatus("next"), "matches_registry_next");
  assert.equal(matchingRegistryStatus("latest"), "matches_registry_latest");
  assert.equal(mismatchedRegistryStatus("next"), "registry_next_mismatch");
  assert.equal(registryStatusMatchesDistTag("matches_registry_next", "next"), true);
  assert.equal(registryStatusMatchesDistTag("matches_registry_beta", "next"), false);
});
