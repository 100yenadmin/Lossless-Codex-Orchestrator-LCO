import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ReleasePreflightOptions = {
  evidenceDir?: string;
  approvedLiveControlEvidence?: string;
  now?: string;
};

export type ReleasePreflightCheck = {
  ok: boolean;
  detail: string;
};

export type ReleasePreflightReport = {
  ok: boolean;
  releaseReady: boolean;
  generatedAt: string;
  artifactManifestPath: string | null;
  packageName: string | null;
  packageVersion: string | null;
  checks: Record<string, ReleasePreflightCheck>;
  blockers: string[];
  forbiddenClaims: string[];
  rawSessionArtifacts: [];
};

const forbiddenClaims = [
  "Full Claude Code parity",
  "cloud sync",
  "unattended desktop takeover",
  "bypasses Codex permissions",
  "release-grade enterprise security"
];

export function runReleasePreflight(options: ReleasePreflightOptions = {}): ReleasePreflightReport {
  const packageJson = readJson("package.json") as { name?: string; version?: string; description?: string } | null;
  const readme = readText("README.md");
  const claimAudit = readText("docs/CLAIM_AUDIT.md");
  const betaDemo = readText("docs/BETA_RELEASE_DEMO.md");
  const openclawManifest = readJson("packages/openclaw-plugin/openclaw.plugin.json") as {
    id?: string;
    mcp?: { command?: string; transport?: string };
    tools?: { prefix?: string };
    safety?: { localOnlyByDefault?: boolean; liveControlRequires?: string[] };
  } | null;

  const approvedLiveControlProof = options.approvedLiveControlEvidence?.trim();
  const checks: Record<string, ReleasePreflightCheck> = {
    packageJson: check(Boolean(packageJson?.name && packageJson.version && packageJson.description?.match(/local Codex sessions/i)), "package metadata keeps Codex-first beta positioning"),
    readme: check(Boolean(readme?.match(/Allowed public beta claim/i) && readme.match(/loo release preflight/i)), "README includes beta claim boundary and release preflight command"),
    openclawManifest: check(Boolean(openclawManifest?.id === "lossless-openclaw-orchestrator" && openclawManifest.mcp?.command === "loo-mcp-server" && openclawManifest.mcp.transport === "stdio" && openclawManifest.tools?.prefix === "loo_" && openclawManifest.safety?.localOnlyByDefault === true), "OpenClaw manifest is packageable and local-only by default"),
    claimAudit: check(Boolean(claimAudit?.match(/Forbidden Beta Claims/i) && claimAudit.match(/approved_live_control_smoke_missing/i)), "claim audit records forbidden claims and the live-control blocker code"),
    betaDemo: check(Boolean(betaDemo?.match(/100\+ local Codex sessions/i) && betaDemo.match(/does not run live control/i)), "demo workflow covers 100+ Codex sessions and dry-run-only control boundary"),
    liveControlSmoke: check(Boolean(approvedLiveControlProof && existsSync(approvedLiveControlProof)), approvedLiveControlProof ? "approved live-control evidence path exists" : "approved live-control evidence was not provided")
  };

  const blockers = Object.entries(checks)
    .filter(([key, value]) => !value.ok && key !== "liveControlSmoke")
    .map(([key]) => `${key}_failed`);
  if (!checks.liveControlSmoke?.ok) blockers.push("approved_live_control_smoke_missing");

  const report: ReleasePreflightReport = {
    ok: blockers.every((blocker) => blocker === "approved_live_control_smoke_missing"),
    releaseReady: blockers.length === 0,
    generatedAt: options.now ?? new Date().toISOString(),
    artifactManifestPath: options.evidenceDir ? join(options.evidenceDir, "release-preflight.json") : null,
    packageName: packageJson?.name ?? null,
    packageVersion: packageJson?.version ?? null,
    checks,
    blockers,
    forbiddenClaims,
    rawSessionArtifacts: []
  };

  if (report.artifactManifestPath) {
    mkdirSync(options.evidenceDir!, { recursive: true });
    writeFileSync(report.artifactManifestPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  return report;
}

function check(ok: boolean, detail: string): ReleasePreflightCheck {
  return { ok, detail };
}

function readText(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

function readJson(path: string): unknown | null {
  const text = readText(path);
  if (!text) return null;
  return JSON.parse(text);
}
