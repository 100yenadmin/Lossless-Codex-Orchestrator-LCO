import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, resolve, sep } from "node:path";

export type ReleasePreflightOptions = {
  evidenceDir?: string;
  approvedLiveControlEvidence?: string;
  now?: string;
  rootDir?: string;
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
  rawSessionArtifacts: RawSessionArtifact[];
};

type ApprovedLiveControlSmokeProof = {
  kind?: string;
  approvedLiveControlSmoke?: boolean;
  action?: string;
  targetRef?: string;
  approvalAuditId?: string;
  messageHash?: string;
  preservesCodexApprovalSemantics?: boolean;
  rawPromptIncluded?: boolean;
};

type RawSessionArtifact = {
  name: string;
  reason: "raw_codex_jsonl" | "sqlite_database" | "screenshot_or_image" | "video_capture";
};

type JsonReadResult = {
  value: unknown | null;
  error: string | null;
};

const forbiddenClaims = [
  "Full Claude Code parity",
  "cloud sync",
  "unattended desktop takeover",
  "bypasses Codex permissions",
  "release-grade enterprise security"
];

export function runReleasePreflight(options: ReleasePreflightOptions = {}): ReleasePreflightReport {
  const packageRoot = options.rootDir ? resolve(options.rootDir) : findPackageRoot(dirname(fileURLToPath(import.meta.url))) ?? process.cwd();
  const packageJsonRead = readJson(packageRoot, "package.json");
  const packageJson = packageJsonRead.value as {
    name?: string;
    version?: string;
    description?: string;
    openclaw?: {
      extensions?: string[];
      runtimeExtensions?: string[];
      compat?: { pluginApi?: string };
      build?: { openclawVersion?: string };
    };
  } | null;
  const readme = readText(packageRoot, "README.md");
  const normalizedReadme = readme?.toLowerCase() ?? "";
  const claimAudit = readText(packageRoot, "docs/CLAIM_AUDIT.md");
  const betaDemo = readText(packageRoot, "docs/BETA_RELEASE_DEMO.md");
  const openclawManifestRead = readJson(packageRoot, "openclaw.plugin.json");
  const openclawManifest = openclawManifestRead.value as {
    id?: string;
    mcp?: { command?: string; transport?: string };
    tools?: { prefix?: string };
    safety?: { localOnlyByDefault?: boolean; liveControlRequires?: string[] };
  } | null;
  const runtimeExtensions = packageJson?.openclaw?.runtimeExtensions ?? [];
  const openclawPackageMetadataOk = packageJson?.openclaw?.extensions?.includes("./packages/openclaw-plugin/src/index.ts")
    && runtimeExtensions.includes("./dist/packages/openclaw-plugin/src/index.js")
    && runtimeExtensions.every((entry) => packageRuntimeFileExists(packageRoot, entry))
    && packageJson.openclaw.compat?.pluginApi === ">=2026.6.8"
    && packageJson.openclaw.build?.openclawVersion === ">=2026.6.8";

  const approvedLiveControlProof = options.approvedLiveControlEvidence?.trim();
  const liveControlProof = validateApprovedLiveControlProof(approvedLiveControlProof);
  const rawSessionArtifacts = scanRawSessionArtifacts(options.evidenceDir);
  const checks: Record<string, ReleasePreflightCheck> = {
    packageJson: check(Boolean(!packageJsonRead.error && packageJson?.name && packageJson.version && packageJson.description?.match(/local Codex sessions/i)), packageJsonRead.error ?? "package metadata keeps Codex-first beta positioning"),
    readme: check(Boolean(readme?.match(/Allowed public beta claim/i) && readme.match(/loo release preflight/i) && forbiddenClaims.every((claim) => normalizedReadme.includes(claim.toLowerCase()))), "README includes beta claim boundary, forbidden claims, and release preflight command"),
    openclawManifest: check(Boolean(!openclawManifestRead.error && openclawPackageMetadataOk && openclawManifest?.id === "lossless-openclaw-orchestrator" && openclawManifest.mcp?.command === "loo-mcp-server" && openclawManifest.mcp.transport === "stdio" && openclawManifest.tools?.prefix === "loo_" && openclawManifest.safety?.localOnlyByDefault === true), openclawManifestRead.error ?? "root OpenClaw manifest and package runtime entry are packageable and local-only by default"),
    claimAudit: check(Boolean(claimAudit?.match(/Forbidden Beta Claims/i) && claimAudit.match(/approved_live_control_smoke_missing/i)), "claim audit records forbidden claims and the live-control blocker code"),
    betaDemo: check(Boolean(betaDemo?.match(/100\+ local Codex sessions/i) && betaDemo.match(/does not run live control/i)), "demo workflow covers 100+ Codex sessions and dry-run-only control boundary"),
    rawArtifacts: check(rawSessionArtifacts.length === 0, rawSessionArtifacts.length === 0 ? "no raw session/private DB/screenshot artifacts found" : "raw session/private DB/screenshot artifacts are present"),
    liveControlSmoke: liveControlProof
  };

  const blockers = Object.entries(checks)
    .filter(([key, value]) => !value.ok && key !== "liveControlSmoke" && key !== "rawArtifacts")
    .map(([key]) => `${key}_failed`);
  if (rawSessionArtifacts.length > 0) blockers.push("raw_session_artifacts_present");
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
    rawSessionArtifacts
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

function readText(root: string, path: string): string | null {
  const resolved = join(root, path);
  if (!existsSync(resolved)) return null;
  return readFileSync(resolved, "utf8");
}

function readJson(root: string, path: string): JsonReadResult {
  const text = readText(root, path);
  if (!text) return { value: null, error: null };
  try {
    return { value: JSON.parse(text), error: null };
  } catch {
    return { value: null, error: `invalid JSON in ${path}` };
  }
}

function packageRuntimeFileExists(root: string, entry: string): boolean {
  const packageRoot = resolve(root);
  const resolved = resolve(packageRoot, entry);
  if (resolved !== packageRoot && !resolved.startsWith(`${packageRoot}${sep}`)) return false;
  try {
    return statSync(resolved).isFile();
  } catch {
    return false;
  }
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

function scanRawSessionArtifacts(evidenceDir: string | undefined): RawSessionArtifact[] {
  if (!evidenceDir || !existsSync(evidenceDir)) return [];
  return readdirSync(evidenceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => rawArtifactForName(entry.name))
    .filter((entry): entry is RawSessionArtifact => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function rawArtifactForName(name: string): RawSessionArtifact | null {
  if (name === "release-preflight.json") return null;
  const extension = extname(name).toLowerCase();
  if (extension === ".jsonl") return { name: basename(name), reason: "raw_codex_jsonl" };
  if (extension === ".sqlite" || extension === ".sqlite3" || extension === ".db") return { name: basename(name), reason: "sqlite_database" };
  if (extension === ".png" || extension === ".jpg" || extension === ".jpeg" || extension === ".heic" || extension === ".webp") return { name: basename(name), reason: "screenshot_or_image" };
  if (extension === ".mov" || extension === ".mp4" || extension === ".webm") return { name: basename(name), reason: "video_capture" };
  return null;
}

function validateApprovedLiveControlProof(path: string | undefined): ReleasePreflightCheck {
  if (!path) return check(false, "approved live-control evidence was not provided");
  if (!existsSync(path)) return check(false, "approved live-control evidence path does not exist");
  let proof: ApprovedLiveControlSmokeProof;
  try {
    proof = JSON.parse(readFileSync(path, "utf8")) as ApprovedLiveControlSmokeProof;
  } catch {
    return check(false, "approved live-control evidence must be JSON");
  }
  const actionOk = proof.action === "send" || proof.action === "resume" || proof.action === "steer" || proof.action === "interrupt";
  const hashOk = proof.action === "send" || proof.action === "steer" ? Boolean(proof.messageHash?.startsWith("sha256:")) : true;
  const allowedKeys = new Set([
    "kind",
    "approvedLiveControlSmoke",
    "action",
    "targetRef",
    "approvalAuditId",
    "messageHash",
    "preservesCodexApprovalSemantics",
    "rawPromptIncluded"
  ]);
  const hasOnlyAllowedKeys = Object.keys(proof).every((key) => allowedKeys.has(key));
  const ok = proof.kind === "loo_approved_live_control_smoke"
    && proof.approvedLiveControlSmoke === true
    && actionOk
    && Boolean(proof.targetRef?.startsWith("codex_thread:"))
    && Boolean(proof.approvalAuditId)
    && hashOk
    && proof.preservesCodexApprovalSemantics === true
    && proof.rawPromptIncluded === false
    && hasOnlyAllowedKeys;
  return check(ok, ok ? "structured approved live-control smoke proof accepted" : "approved live-control evidence is not a safe structured proof marker");
}
