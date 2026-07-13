import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { runReleasePreflight, type ReleasePreflightReport } from "./release-preflight.js";
import { findSupportedPackageRoot } from "./package-identity.js";
import type { ReleaseClaimScope, ReleaseExcludedClaim } from "./release-claim-scope.js";

export type ReleaseBundleOptions = {
  evidenceDir: string;
  candidateSha?: string;
  approvedLiveControlEvidence?: string;
  claimScope?: ReleaseClaimScope;
  runtimeProofDir?: string;
  now?: string;
  rootDir?: string;
};

export type ReleaseBundleReport = {
  ok: boolean;
  publishReady: boolean;
  generatedAt: string;
  claimScope: ReleaseClaimScope;
  excludedClaims: ReleaseExcludedClaim[];
  packageName: string | null;
  packageVersion: string | null;
  npmPublished: false;
  githubReleaseCreated: false;
  releaseNotesPath: string;
  bundleManifestPath: string;
  blockers: string[];
  rawSessionArtifacts: ReleasePreflightReport["rawSessionArtifacts"];
  forbiddenClaims: string[];
  artifacts: {
    releaseNotes: string;
    preflightManifest: string;
    bundleManifest: string;
  };
  releasePreflight: ReleasePreflightReport;
};

export function createReleaseBundle(options: ReleaseBundleOptions): ReleaseBundleReport {
  const evidenceDir = resolve(options.evidenceDir);
  const packageRoot = options.rootDir ? resolve(options.rootDir) : findSupportedPackageRoot(dirname(fileURLToPath(import.meta.url))) ?? process.cwd();
  const bundleManifestName = "release-bundle.json";

  mkdirSync(evidenceDir, { recursive: true });
  const preflight = runReleasePreflight({
    evidenceDir: options.evidenceDir,
    candidateSha: options.candidateSha,
    approvedLiveControlEvidence: options.approvedLiveControlEvidence,
    claimScope: options.claimScope,
    runtimeProofDir: options.runtimeProofDir,
    now: options.now,
    rootDir: packageRoot
  });
  if (!preflight.packageVersion) {
    throw new Error("Release bundle requires package.json version");
  }
  const releaseNotesFile = `RELEASE_NOTES_${preflight.packageVersion}.md`;
  const releaseNotesSource = join(packageRoot, "docs", "releases", releaseNotesFile);
  const releaseNotesPath = join(evidenceDir, releaseNotesFile);
  const bundleManifestPath = join(evidenceDir, bundleManifestName);

  writeFileSync(
    releaseNotesPath,
    existsSync(releaseNotesSource)
      ? readFileSync(releaseNotesSource, "utf8")
      : createDraftReleaseNotes(preflight)
  );

  const report: ReleaseBundleReport = {
    ok: preflight.ok,
    publishReady: preflight.releaseReady,
    generatedAt: options.now ?? new Date().toISOString(),
    claimScope: preflight.claimScope,
    excludedClaims: preflight.excludedClaims,
    packageName: preflight.packageName,
    packageVersion: preflight.packageVersion,
    npmPublished: false,
    githubReleaseCreated: false,
    releaseNotesPath: releaseNotesFile,
    bundleManifestPath: bundleManifestName,
    blockers: preflight.blockers,
    rawSessionArtifacts: preflight.rawSessionArtifacts,
    forbiddenClaims: preflight.forbiddenClaims,
    artifacts: {
      releaseNotes: releaseNotesFile,
      preflightManifest: "release-preflight.json",
      bundleManifest: "release-bundle.json"
    },
    releasePreflight: preflight
  };

  writeFileSync(bundleManifestPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function createDraftReleaseNotes(preflight: ReleasePreflightReport): string {
  const packageName = preflight.packageName ?? "lossless-codex-orchestrator";
  return [
    `# Release Notes ${preflight.packageVersion} (Draft)`,
    "",
    "These draft notes were generated locally because committed release notes do not exist yet.",
    "Replace this draft with customer- and developer-facing notes before publishing.",
    "",
    "## Highlights",
    "- Maintenance update for local Codex session orchestration.",
    "- Final highlights should be written from the merged release PRs.",
    "",
    "## Upgrade",
    "```bash",
    `npm install -g ${packageName}@latest`,
    "lco doctor",
    "```",
    "",
    "## Validation",
    preflight.releaseReady
      ? "- Release validation is complete in the local evidence bundle."
      : "- Release validation is still in progress.",
    "- See `release-bundle.json` and `release-preflight.json` for operator gate details.",
    "",
    "## Publication",
    "- npm package publication: pending.",
    "- GitHub Release creation: pending.",
    ""
  ].join("\n");
}
