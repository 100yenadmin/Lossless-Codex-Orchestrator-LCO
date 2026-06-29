import assert from "node:assert/strict";
import test from "node:test";

import { createSessionSanitizerReport } from "../packages/core/src/session-sanitizer.js";

const syntheticApiKey = ["sk", "test_1234567890abcdef"].join("-");
const syntheticBearerToken = ["abcdefghijklmnop", "12345"].join("");
const syntheticCookie = ["sessionid", "supersecret12345"].join("=");
const syntheticPrivateKeyBody = ["fake-private", "key-body"].join("-");
const syntheticLocalPath = ["/Users/exampleuser", ".ssh/id_ed25519"].join("/");

const syntheticSecretText = [
  "Final closeout: remove leaked synthetic credentials before sharing.",
  `api_key=${syntheticApiKey}`,
  `Authorization: Bearer ${syntheticBearerToken}`,
  `Cookie: ${syntheticCookie}; theme=light`,
  "-----BEGIN PRIVATE KEY-----",
  syntheticPrivateKeyBody,
  "-----END PRIVATE KEY-----",
  `Local path: ${syntheticLocalPath}`,
  "Benign text: sketch a cookie recipe for a demo"
].join("\n");

test("session sanitizer reports synthetic sensitive patterns without raw values", () => {
  const report = createSessionSanitizerReport({
    sources: [
      {
        sourceRef: "codex_thread:synthetic-sanitizer",
        text: syntheticSecretText
      }
    ],
    now: "2026-06-29T11:25:00.000Z"
  });

  assert.equal(report.ok, true);
  assert.equal(report.publicSafe, true);
  assert.equal(report.generatedAt, "2026-06-29T11:25:00.000Z");
  assert.equal(report.sourceCount, 1);
  assert.equal(report.findingCount, 5);
  assert.deepEqual(report.blockers, []);

  const classes = report.findings.map((finding) => finding.patternClass).sort();
  assert.deepEqual(classes, ["api_key", "bearer_token", "cookie", "local_path", "private_key"]);
  assert.equal(report.findings.every((finding) => finding.sourceRef === "codex_thread:synthetic-sanitizer"), true);
  assert.equal(report.findings.every((finding) => finding.fingerprint.startsWith("sha256:")), true);
  assert.equal(report.findings.every((finding) => finding.suggestedRepair.length > 0), true);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(syntheticApiKey), false);
  assert.equal(serialized.includes(syntheticBearerToken), false);
  assert.equal(serialized.includes(syntheticCookie), false);
  assert.equal(serialized.includes(syntheticPrivateKeyBody), false);
  assert.equal(serialized.includes(syntheticLocalPath), false);
  assert.match(serialized, /<redacted-secret>/);
  assert.match(serialized, /~\/<redacted-path>/);
});

test("session sanitizer ignores benign keyword-only text", () => {
  const report = createSessionSanitizerReport({
    sources: [
      {
        sourceRef: "codex_thread:benign-sanitizer",
        text: "We should sketch a cookie consent banner and discuss bearer token policy in docs."
      }
    ],
    now: "2026-06-29T11:26:00.000Z"
  });

  assert.equal(report.ok, true);
  assert.equal(report.publicSafe, true);
  assert.equal(report.findingCount, 0);
  assert.deepEqual(report.findings, []);
});

test("session sanitizer rejects raw source refs in public evidence shape", () => {
  assert.throws(
    () => createSessionSanitizerReport({
      sources: [
        {
          sourceRef: ["/Users/exampleuser", ".codex/sessions/raw.jsonl"].join("/"),
          text: `api_key=${syntheticApiKey}`
        }
      ],
      now: "2026-06-29T11:27:00.000Z"
    }),
    /sourceRef must use a supported source prefix/
  );
});
