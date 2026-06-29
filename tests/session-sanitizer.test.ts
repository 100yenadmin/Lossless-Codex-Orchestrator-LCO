import assert from "node:assert/strict";
import test from "node:test";

import { createSessionSanitizerReport } from "../packages/core/src/session-sanitizer.js";

const syntheticApiKey = ["sk", "test_1234567890abcdef"].join("-");
const syntheticBearerToken = ["abcdefghijklmnop", "12345"].join("");
const syntheticBearerWithSuffix = ["abcdefghijklmnop", "+private=="].join("");
const syntheticCookie = ["sessionid", "supersecret12345"].join("=");
const syntheticPrivateKeyBody = ["fake-private", "key-body"].join("-");
const syntheticLocalPath = ["/Users/exampleuser", ".ssh/id_ed25519"].join("/");
const syntheticMacPathWithSpaces = ["/Users/exampleuser/Library", "Application Support/Codex/session.jsonl"].join("/");

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
  assert.equal(report.findings.every((finding) => finding.fingerprint.startsWith("hmac-sha256:")), true);
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

test("session sanitizer public previews never include raw source text or adjacent findings", () => {
  const rawPromptText = "private customer prompt text";
  const rawToolText = "tool arguments should stay local";
  const report = createSessionSanitizerReport({
    sources: [
      {
        sourceRef: "codex_event:multi-secret-preview",
        text: [
          `${rawPromptText} api_key=${syntheticApiKey} path=${syntheticMacPathWithSpaces} Authorization: Bearer ${syntheticBearerWithSuffix}`,
          `Cookie: ${syntheticCookie}; ${rawToolText}`
        ].join("\n")
      }
    ],
    now: "2026-06-29T11:28:00.000Z",
    auditKey: "synthetic-audit-key"
  });

  assert.equal(report.findingCount, 4);
  assert.equal(report.findings.every((finding) => finding.evidencePreview.includes("source text omitted")), true);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(syntheticApiKey), false);
  assert.equal(serialized.includes(syntheticBearerWithSuffix), false);
  assert.equal(serialized.includes(syntheticCookie), false);
  assert.equal(serialized.includes(syntheticMacPathWithSpaces), false);
  assert.equal(serialized.includes("Application Support"), false);
  assert.equal(serialized.includes(rawPromptText), false);
  assert.equal(serialized.includes(rawToolText), false);
});

test("session sanitizer fingerprints are keyed local audit markers", () => {
  const source = {
    sourceRef: "codex_thread:fingerprint-sanitizer",
    text: `api_key=${syntheticApiKey}`
  };
  const firstReport = createSessionSanitizerReport({
    sources: [source],
    now: "2026-06-29T11:29:00.000Z",
    auditKey: "synthetic-audit-key-one"
  });
  const secondReport = createSessionSanitizerReport({
    sources: [source],
    now: "2026-06-29T11:29:00.000Z",
    auditKey: "synthetic-audit-key-two"
  });

  assert.equal(firstReport.findingCount, 1);
  assert.equal(secondReport.findingCount, 1);
  assert.match(firstReport.findings[0]?.fingerprint ?? "", /^hmac-sha256:/);
  assert.notEqual(firstReport.findings[0]?.fingerprint, secondReport.findings[0]?.fingerprint);
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
  assert.throws(
    () => createSessionSanitizerReport({
      sources: [
        {
          sourceRef: ["codex_thread:", "/Users/exampleuser/.codex/sessions/raw.jsonl"].join(""),
          text: `api_key=${syntheticApiKey}`
        }
      ],
      now: "2026-06-29T11:30:00.000Z"
    }),
    /sourceRef must use a supported source prefix/
  );
});
