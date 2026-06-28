import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { runReleasePreflight, type ReleasePreflightReport } from "./release-preflight.js";

export type ReleaseBundleOptions = {
  evidenceDir: string;
  approvedLiveControlEvidence?: string;
  now?: string;
  rootDir?: string;
};

export type ReleaseBundleReport = {
  ok: boolean;
  publishReady: boolean;
  generatedAt: string;
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

const releaseNotesFile = "RELEASE_NOTES_0.1.0-beta.0.md";

export function createReleaseBundle(options: ReleaseBundleOptions): ReleaseBundleReport {
  const evidenceDir = resolve(options.evidenceDir);
  const packageRoot = options.rootDir ? resolve(options.rootDir) : findPackageRoot(dirname(fileURLToPath(import.meta.url))) ?? process.cwd();
  const releaseNotesSource = join(packageRoot, "docs", releaseNotesFile);
  if (!existsSync(releaseNotesSource)) {
    throw new Error(`Release notes are missing: docs/${releaseNotesFile}`);
  }

  mkdirSync(evidenceDir, { recursive: true });
  const preflight = runReleasePreflight({
    evidenceDir,
    approvedLiveControlEvidence: options.approvedLiveControlEvidence,
    now: options.now,
    rootDir: packageRoot
  });
  const releaseNotesPath = join(evidenceDir, releaseNotesFile);
  const bundleManifestPath = join(evidenceDir, "release-bundle.json");

  writeFileSync(releaseNotesPath, readFileSync(releaseNotesSource, "utf8"));

  const report: ReleaseBundleReport = {
    ok: preflight.ok,
    publishReady: preflight.releaseReady,
    generatedAt: options.now ?? new Date().toISOString(),
    packageName: preflight.packageName,
    packageVersion: preflight.packageVersion,
    npmPublished: false,
    githubReleaseCreated: false,
    releaseNotesPath,
    bundleManifestPath,
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

function findPackageRoot(start: string): string | null {
  let cursor = start;
  while (true) {
    const packageJsonPath = join(cursor, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
        if (packageJson.name === "lossless-openclaw-orchestrator") return cursor;
      } catch {
        return null;
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}
