import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { runReleasePreflight, type ReleasePreflightReport } from "./release-preflight.js";
import { findSupportedPackageRoot } from "./package-identity.js";
import type { ReleaseClaimScope, ReleaseExcludedClaim } from "./release-claim-scope.js";

export type ReleaseBundleOptions = {
  evidenceDir: string;
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
  const blockers = preflight.blockers.length ? preflight.blockers : ["none"];
  return [
    `# Lossless OpenClaw Orchestrator ${preflight.packageVersion} Draft Release Notes`,
    "",
    "These local draft notes were generated for a release evidence bundle before committed release notes exist.",
    "They do not publish to npm, do not create a GitHub Release, do not update the changelog, and do not claim release readiness.",
    "",
    `- Claim scope: ${preflight.claimScope}`,
    `- Release ready: ${preflight.releaseReady ? "true" : "false"}`,
    `- Blockers: ${blockers.join(", ")}`,
    `- npm published: false`,
    `- GitHub Release created: false`,
    ""
  ].join("\n");
}
