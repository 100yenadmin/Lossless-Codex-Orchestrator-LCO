import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type ReleaseFinalizationStatusOptions = {
  evidenceDir: string;
  candidateSha: string;
  packageName?: string;
  packageVersion?: string;
  expectedDistTag?: string;
  expectedGithubPrerelease?: boolean;
  npmPublishEvidence?: string;
  gitTagEvidence?: string;
  githubReleaseEvidence?: string;
  now?: string;
  rootDir?: string;
};

export type ReleaseFinalizationStatusReport = {
  ok: boolean;
  finalized: boolean;
  generatedAt: string;
  packageName: string;
  packageVersion: string;
  candidateSha: string;
  expectedDistTag: string;
  expectedGitTag: string;
  expectedGithubPrerelease: boolean;
  finalizationManifestPath: string;
  blockers: string[];
  actionsVerified: {
    npmPublished: boolean;
    gitTagPushed: boolean;
    githubReleaseCreated: boolean;
  };
  npm: {
    packageName: string | null;
    packageVersion: string | null;
    distTag: string | null;
    distTagVersion: string | null;
    latestVersion: string | null;
    published: boolean | null;
  };
  gitTag: {
    tagName: string | null;
    tagCommitSha: string | null;
  };
  githubRelease: {
    tagName: string | null;
    releaseUrl: string | null;
    isPrerelease: boolean | null;
    targetCommitSha: string | null;
  };
  evidenceFiles: {
    npmPublish: string | null;
    gitTag: string | null;
    githubRelease: string | null;
  };
  actionsPerformed: {
    npmPublished: false;
    githubReleaseCreated: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
};

type JsonReadResult = {
  value: unknown | null;
  missing: boolean;
  invalid: boolean;
};

type PackageMetadata = {
  name?: string;
  version?: string;
  publishConfig?: { tag?: string };
};

const RELEASE_FINALIZATION_MANIFEST = "release-finalization-status.json";
const SECRET_LIKE_PATTERN = /npm_[A-Za-z0-9]{20,}|github_pat_|ghp_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|sk-[A-Za-z0-9]{20,}|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/;
const SHA_PATTERN = /^[a-f0-9]{40}$/i;

export function createReleaseFinalizationStatus(options: ReleaseFinalizationStatusOptions): ReleaseFinalizationStatusReport {
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });

  const metadata = readPackageMetadata(options.rootDir ?? process.cwd());
  const packageName = options.packageName ?? metadata.name ?? "lossless-openclaw-orchestrator";
  const packageVersion = options.packageVersion ?? metadata.version ?? "unknown";
  const expectedDistTag = options.expectedDistTag ?? metadata.publishConfig?.tag ?? inferDistTag(packageVersion);
  const expectedGithubPrerelease = options.expectedGithubPrerelease ?? packageVersion.includes("-");
  const expectedGitTag = `v${packageVersion}`;

  const npmPath = options.npmPublishEvidence ? resolve(options.npmPublishEvidence) : null;
  const tagPath = options.gitTagEvidence ? resolve(options.gitTagEvidence) : null;
  const releasePath = options.githubReleaseEvidence ? resolve(options.githubReleaseEvidence) : null;
  const npmEvidence = readOptionalJson(npmPath);
  const tagEvidence = readOptionalJson(tagPath);
  const releaseEvidence = readOptionalJson(releasePath);

  const blockers: string[] = [];
  blockers.push(...missingOrInvalidBlockers("npm_publish", npmEvidence));
  blockers.push(...missingOrInvalidBlockers("git_tag", tagEvidence));
  blockers.push(...missingOrInvalidBlockers("github_release", releaseEvidence));

  if (hasJsonEvidence(npmEvidence)) {
    blockers.push(...validateNoSecrets("npm_evidence", npmEvidence.value));
    blockers.push(...validateNpmEvidence(npmEvidence.value, {
      packageName,
      packageVersion,
      expectedDistTag,
      candidateSha: options.candidateSha
    }));
  }
  if (hasJsonEvidence(tagEvidence)) {
    blockers.push(...validateNoSecrets("git_tag_evidence", tagEvidence.value));
    blockers.push(...validateGitTagEvidence(tagEvidence.value, {
      candidateSha: options.candidateSha,
      expectedGitTag
    }));
  }
  if (hasJsonEvidence(releaseEvidence)) {
    blockers.push(...validateNoSecrets("github_release_evidence", releaseEvidence.value));
    blockers.push(...validateGitHubReleaseEvidence(releaseEvidence.value, {
      candidateSha: options.candidateSha,
      expectedGitTag,
      expectedGithubPrerelease
    }));
  }
  if (!SHA_PATTERN.test(options.candidateSha)) blockers.push("candidate_sha_invalid");

  const uniqueBlockers = [...new Set(blockers)];
  const report: ReleaseFinalizationStatusReport = {
    ok: uniqueBlockers.length === 0,
    finalized: uniqueBlockers.length === 0,
    generatedAt: options.now ?? new Date().toISOString(),
    packageName,
    packageVersion,
    candidateSha: options.candidateSha,
    expectedDistTag,
    expectedGitTag,
    expectedGithubPrerelease,
    finalizationManifestPath: join(evidenceDir, RELEASE_FINALIZATION_MANIFEST),
    blockers: uniqueBlockers,
    actionsVerified: {
      npmPublished: evidenceVerified(npmEvidence, uniqueBlockers, "npm_"),
      gitTagPushed: evidenceVerified(tagEvidence, uniqueBlockers, "git_tag_"),
      githubReleaseCreated: evidenceVerified(releaseEvidence, uniqueBlockers, "github_release_")
    },
    npm: npmSummary(npmEvidence.value),
    gitTag: gitTagSummary(tagEvidence.value),
    githubRelease: githubReleaseSummary(releaseEvidence.value),
    evidenceFiles: {
      npmPublish: npmPath,
      gitTag: tagPath,
      githubRelease: releasePath
    },
    actionsPerformed: {
      npmPublished: false,
      githubReleaseCreated: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false
    },
    privateDataExclusions: [
      "npm tokens",
      "GitHub tokens",
      "raw npm stdout/stderr",
      "raw GitHub API output",
      "raw Codex transcripts",
      "SQLite DB contents",
      "screenshots or videos"
    ],
    proofBoundary: "This report verifies public-safe post-publish release evidence only. It does not publish npm, create or edit tags, create GitHub Releases, promote npm latest, run live Codex control, mutate a GUI, or claim GA readiness."
  };

  writeFileSync(report.finalizationManifestPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function readPackageMetadata(rootDir: string): PackageMetadata {
  try {
    return JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as PackageMetadata;
  } catch {
    return {};
  }
}

function inferDistTag(version: string): string {
  if (/-beta\./.test(version)) return "beta";
  if (/-rc\./.test(version)) return "next";
  return "latest";
}

function readOptionalJson(path: string | null): JsonReadResult {
  if (!path) return { value: null, missing: true, invalid: false };
  if (!existsSync(path)) return { value: null, missing: true, invalid: false };
  try {
    return { value: JSON.parse(readFileSync(path, "utf8")), missing: false, invalid: false };
  } catch {
    return { value: null, missing: false, invalid: true };
  }
}

function missingOrInvalidBlockers(prefix: "npm_publish" | "git_tag" | "github_release", result: JsonReadResult): string[] {
  if (result.missing) return [`${prefix}_evidence_missing`];
  if (result.invalid) return [`${prefix}_evidence_invalid_json`];
  return [];
}

function hasJsonEvidence(result: JsonReadResult): boolean {
  return !result.missing && !result.invalid;
}

function evidenceVerified(result: JsonReadResult, blockers: string[], prefix: string): boolean {
  return hasJsonEvidence(result) && asRecord(result.value) !== null && !blockers.some((blocker) => blocker.startsWith(prefix));
}

function validateNpmEvidence(value: unknown, expected: { packageName: string; packageVersion: string; expectedDistTag: string; candidateSha: string }): string[] {
  const record = asRecord(value);
  if (!record) return ["npm_evidence_invalid"];
  const blockers: string[] = [];
  if (record.kind !== "loo_release_npm_publish_evidence") blockers.push("npm_evidence_invalid_kind");
  if (record.rawSecretIncluded !== false) blockers.push("npm_evidence_secret_flag_present");
  if (record.published !== true) blockers.push("npm_package_not_published");
  if (stringField(record, "candidateSha") !== expected.candidateSha) blockers.push("npm_candidate_sha_mismatch");
  if (stringField(record, "packageName") !== expected.packageName) blockers.push("npm_package_mismatch");
  if (stringField(record, "packageVersion") !== expected.packageVersion) blockers.push("npm_version_mismatch");
  if (stringField(record, "distTag") !== expected.expectedDistTag) blockers.push("npm_dist_tag_mismatch");
  if (stringField(record, "distTagVersion") !== expected.packageVersion) blockers.push("npm_dist_tag_version_mismatch");
  if (expected.expectedDistTag !== "latest" && stringField(record, "latestVersion") === expected.packageVersion) {
    blockers.push("npm_latest_points_to_prerelease");
  }
  return blockers;
}

function validateGitTagEvidence(value: unknown, expected: { candidateSha: string; expectedGitTag: string }): string[] {
  const record = asRecord(value);
  if (!record) return ["git_tag_evidence_invalid"];
  const blockers: string[] = [];
  if (record.kind !== "loo_release_git_tag_evidence") blockers.push("git_tag_evidence_invalid_kind");
  if (record.rawSecretIncluded !== false) blockers.push("git_tag_evidence_secret_flag_present");
  if (stringField(record, "tagName") !== expected.expectedGitTag) blockers.push("git_tag_name_mismatch");
  if (stringField(record, "tagCommitSha") !== expected.candidateSha) blockers.push("git_tag_sha_mismatch");
  return blockers;
}

function validateGitHubReleaseEvidence(value: unknown, expected: { candidateSha: string; expectedGitTag: string; expectedGithubPrerelease: boolean }): string[] {
  const record = asRecord(value);
  if (!record) return ["github_release_evidence_invalid"];
  const blockers: string[] = [];
  if (record.kind !== "loo_release_github_release_evidence") blockers.push("github_release_evidence_invalid_kind");
  if (record.rawSecretIncluded !== false) blockers.push("github_release_evidence_secret_flag_present");
  if (stringField(record, "tagName") !== expected.expectedGitTag) blockers.push("github_release_tag_mismatch");
  if (stringField(record, "releaseUrl")?.startsWith("https://github.com/") !== true) blockers.push("github_release_url_missing");
  if (record.isPrerelease !== expected.expectedGithubPrerelease) blockers.push("github_release_prerelease_mismatch");
  const targetCommitSha = stringField(record, "targetCommitSha");
  if (targetCommitSha && targetCommitSha !== expected.candidateSha) blockers.push("github_release_target_sha_mismatch");
  return blockers;
}

function validateNoSecrets(prefix: string, value: unknown): string[] {
  return containsSecretLikeValue(value) ? [`${prefix}_contains_secret_like_value`] : [];
}

function containsSecretLikeValue(value: unknown): boolean {
  if (typeof value === "string") return SECRET_LIKE_PATTERN.test(value);
  if (Array.isArray(value)) return value.some((item) => containsSecretLikeValue(item));
  const record = asRecord(value);
  if (record) return Object.values(record).some((item) => containsSecretLikeValue(item));
  return false;
}

function npmSummary(value: unknown): ReleaseFinalizationStatusReport["npm"] {
  const record = asRecord(value);
  return {
    packageName: stringField(record, "packageName"),
    packageVersion: stringField(record, "packageVersion"),
    distTag: stringField(record, "distTag"),
    distTagVersion: stringField(record, "distTagVersion"),
    latestVersion: stringField(record, "latestVersion"),
    published: booleanField(record, "published")
  };
}

function gitTagSummary(value: unknown): ReleaseFinalizationStatusReport["gitTag"] {
  const record = asRecord(value);
  return {
    tagName: stringField(record, "tagName"),
    tagCommitSha: stringField(record, "tagCommitSha")
  };
}

function githubReleaseSummary(value: unknown): ReleaseFinalizationStatusReport["githubRelease"] {
  const record = asRecord(value);
  return {
    tagName: stringField(record, "tagName"),
    releaseUrl: stringField(record, "releaseUrl"),
    isPrerelease: booleanField(record, "isPrerelease"),
    targetCommitSha: stringField(record, "targetCommitSha")
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(record: Record<string, unknown> | null, field: string): string | null {
  if (!record) return null;
  const value = record[field];
  return typeof value === "string" ? value : null;
}

function booleanField(record: Record<string, unknown> | null, field: string): boolean | null {
  if (!record) return null;
  const value = record[field];
  return typeof value === "boolean" ? value : null;
}
