import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import {
  normalizeReleaseClaimScope,
  releaseClaimScopeRequiresWorkingAppRuntimeProof,
  type ReleaseClaimScope
} from "./release-claim-scope.js";
import { findSupportedPackageRoot, packageNameForRoot, type SupportedPackageName } from "./package-identity.js";
import { validateWorkingAppRuntimeProof } from "./runtime-proof-gate.js";

export type ScorecardSweepOptions = {
  evidenceDir: string;
  scorecardDir?: string;
  claimScope?: ReleaseClaimScope;
  runtimeProofDir?: string;
  packageVersion?: string;
  candidateSha?: string;
  now?: string;
  rootDir?: string;
};

export type ScorecardSweepEntry = {
  name: string;
  file: string;
  claimClass: string;
  surface: string;
  currentScore: string;
  status: "pending_evidence" | "scored" | "invalid";
  evidencePath: string;
  expectedPublicSafeEvidence: string[];
  privateDataExclusions: string[];
  knownGaps: string[];
  nextAction: string;
  proofBoundary: string;
  blockers: string[];
};

export type ScorecardSweepReport = {
  schema: "lco.scorecardSweep.v1";
  ok: boolean;
  sweepReady: boolean;
  publicSafe: boolean;
  scorecardDeclarationReady: boolean;
  packageName: SupportedPackageName;
  packageVersion: string | null;
  candidateSha: string | null;
  generatedAt: string;
  claimScope: ReleaseClaimScope;
  scorecardVersion: string;
  scorecardSourceDir: string;
  sweepPath: string;
  actionsPerformed: {
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    npmPublished: false;
    githubReleaseCreated: false;
  };
  scorecards: ScorecardSweepEntry[];
  scorecardDeclarationBlockers: string[];
  runtimeEvidenceValidation: RuntimeEvidenceValidation;
  rawEvidenceArtifacts: RawEvidenceArtifact[];
  blockers: string[];
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

export type RuntimeEvidenceValidation = {
  required: boolean;
  ok: boolean;
  proofDir: string | null;
  acceptedMarkerCount: number;
  blockers: string[];
};

type ScorecardJson = {
  scorecard_version?: unknown;
  claim_class?: unknown;
  scenario?: unknown;
  surface?: unknown;
  command_or_tool?: unknown;
  pass_criteria?: unknown;
  fail_criteria?: unknown;
  current_score?: unknown;
  evidence_path?: unknown;
  expected_public_safe_evidence?: unknown;
  private_data_exclusions?: unknown;
  known_gaps?: unknown;
  next_action?: unknown;
  proof_boundary?: unknown;
};

export type RawEvidenceArtifact = {
  name: string;
  reason: "raw_codex_jsonl" | "sqlite_database" | "screenshot_or_image" | "video_capture";
};

const SCORECARD_VERSION = "1.0";
const REQUIRED_SCORECARD_NAMES = [
  "local-agent-usability-review",
  "local-mac-search-ui-review",
  "orchestrator-leverage-prioritization",
  "packaging-install-review",
  "public-community-readiness-review",
  "public-claim-review",
  "retrieval-quality-review",
  "safety-bypass-review",
  "tool-facade-usability-review",
  "working-app-runtime-proof-review"
];
const REQUIRED_SCORECARD_FIELDS: Array<keyof ScorecardJson> = [
  "scorecard_version",
  "claim_class",
  "scenario",
  "surface",
  "command_or_tool",
  "expected_public_safe_evidence",
  "private_data_exclusions",
  "pass_criteria",
  "fail_criteria",
  "current_score",
  "evidence_path",
  "known_gaps",
  "next_action",
  "proof_boundary"
];
const PASSING_SCORES = new Set(["pass", "passed", "green", "ok"]);
const DEFAULT_PRIVATE_DATA_EXCLUSIONS = [
  "raw Codex transcripts",
  "raw prompts or message text",
  "SQLite DBs",
  "screenshots or videos",
  "tokens, credentials, API keys, cookies",
  "private customer data"
];

export function createScorecardSweep(options: ScorecardSweepOptions): ScorecardSweepReport {
  const evidenceDir = resolve(options.evidenceDir);
  const packageRoot = options.rootDir ? resolve(options.rootDir) : findSupportedPackageRoot(dirname(fileURLToPath(import.meta.url))) ?? process.cwd();
  const scorecardDir = options.scorecardDir ? resolve(options.scorecardDir) : join(packageRoot, "evals", "scorecards", "v1.0");
  const claimScope = normalizeReleaseClaimScope(options.claimScope);
  const requiredScorecardNames = requiredScorecardsForScope(claimScope);
  if (evidenceDir === scorecardDir) {
    throw new Error("--evidence-dir must be different from --scorecard-dir");
  }
  const sourceDirForReport = scorecardDir.startsWith(`${packageRoot}/`) ? scorecardDir.slice(packageRoot.length + 1) : scorecardDir;

  mkdirSync(evidenceDir, { recursive: true });
  const scorecards = readScorecards(scorecardDir, evidenceDir)
    .filter((scorecard) => requiredScorecardNames.includes(scorecard.name)
      || scorecard.name === "scorecard-directory"
      || scorecard.status === "invalid");
  const rawEvidenceArtifacts = scanRawEvidenceArtifacts(evidenceDir);
  const missingRequiredScorecards = requiredScorecardNames
    .filter((name) => !scorecards.some((scorecard) => scorecard.name === name))
    .map((name) => `scorecard_missing:${name}`);
  const rawArtifactBlockers = rawEvidenceArtifacts.map((artifact) => `raw_artifact:${artifact.reason}:${artifact.name}`);
  const scorecardDeclarationBlockers = [...scorecards.flatMap((scorecard) => scorecard.blockers), ...missingRequiredScorecards];
  const runtimeEvidenceValidation = validateRuntimeEvidenceForScope(claimScope, options.runtimeProofDir);
  const blockers = [...scorecardDeclarationBlockers, ...rawArtifactBlockers, ...runtimeEvidenceValidation.blockers];
  const sweepName = "scorecard-sweep.json";
  const sweepPath = join(evidenceDir, sweepName);
  const report: ScorecardSweepReport = {
    schema: "lco.scorecardSweep.v1",
    ok: blockers.length === 0,
    sweepReady: blockers.length === 0,
    publicSafe: rawEvidenceArtifacts.length === 0,
    scorecardDeclarationReady: scorecardDeclarationBlockers.length === 0,
    packageName: packageNameForRoot(packageRoot),
    packageVersion: options.packageVersion ?? null,
    candidateSha: options.candidateSha ?? null,
    generatedAt: options.now ?? new Date().toISOString(),
    claimScope,
    scorecardVersion: SCORECARD_VERSION,
    scorecardSourceDir: sourceDirForReport,
    sweepPath: sweepName,
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    scorecards,
    scorecardDeclarationBlockers,
    runtimeEvidenceValidation,
    rawEvidenceArtifacts,
    blockers,
    privateDataExclusions: uniqueStrings(scorecards.flatMap((scorecard) => scorecard.privateDataExclusions).concat(DEFAULT_PRIVATE_DATA_EXCLUSIONS)),
    proofBoundary: "This scorecard sweep validates public-safe scorecard declarations. For codex-working-app-proof, it also requires public-safe runtime proof markers; passing declarations alone do not approve live Codex control, GUI mutation, npm publish, GitHub Release creation, or runtime-proven working-app behavior.",
    nextAction: nextScorecardSweepAction(blockers, scorecardDeclarationBlockers, runtimeEvidenceValidation)
  };

  writeFileSync(sweepPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function validateRuntimeEvidenceForScope(claimScope: ReleaseClaimScope, runtimeProofDir: string | undefined): RuntimeEvidenceValidation {
  if (!releaseClaimScopeRequiresWorkingAppRuntimeProof(claimScope)) {
    return {
      required: false,
      ok: true,
      proofDir: runtimeProofDir ? resolve(runtimeProofDir) : null,
      acceptedMarkerCount: 0,
      blockers: []
    };
  }
  return {
    required: true,
    ...validateWorkingAppRuntimeProof(runtimeProofDir)
  };
}

function nextScorecardSweepAction(blockers: string[], scorecardDeclarationBlockers: string[], runtimeEvidenceValidation: RuntimeEvidenceValidation): string {
  if (blockers.length === 0) return "Review the public-safe sweep packet before any beta release step.";
  if (runtimeEvidenceValidation.required && !runtimeEvidenceValidation.ok && scorecardDeclarationBlockers.length === 0) {
    return "Provide the public-safe runtime-proof marker directory before reading working-app scorecards as runtime proof.";
  }
  return "Run the missing scorecard evidence commands and update each scorecard before claiming beta readiness.";
}

function requiredScorecardsForScope(claimScope: ReleaseClaimScope): string[] {
  if (releaseClaimScopeRequiresWorkingAppRuntimeProof(claimScope)) return REQUIRED_SCORECARD_NAMES;
  return REQUIRED_SCORECARD_NAMES.filter((name) => name !== "working-app-runtime-proof-review");
}

function readScorecards(scorecardDir: string, evidenceDir: string): ScorecardSweepEntry[] {
  if (!existsSync(scorecardDir)) {
    const entry: ScorecardSweepEntry = {
      name: "scorecard-directory",
      file: basename(scorecardDir) || "scorecard-directory",
      claimClass: "unknown",
      surface: "unknown",
      currentScore: "missing",
      status: "invalid",
      evidencePath: "scorecard-directory.json",
      expectedPublicSafeEvidence: [],
      privateDataExclusions: DEFAULT_PRIVATE_DATA_EXCLUSIONS,
      knownGaps: ["Scorecard directory not found."],
      nextAction: "Restore evals/scorecards/v1.0 before running milestone sweeps.",
      proofBoundary: "No scorecard proof exists because the scorecard directory is missing.",
      blockers: ["scorecard_directory_missing"]
    };
    writeScorecardEntry(entry, evidenceDir);
    return [entry];
  }

  return readdirSync(scorecardDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => readScorecard(join(scorecardDir, file), file, evidenceDir));
}

function readScorecard(path: string, file: string, evidenceDir: string): ScorecardSweepEntry {
  const name = basename(file, ".json");
  const evidencePath = file;
  const evidenceWritePath = join(evidenceDir, file);
  try {
    const scorecard = JSON.parse(readFileSync(path, "utf8")) as ScorecardJson;
    const currentScore = stringValue(scorecard.current_score) || "missing";
    const invalid = scorecard.scorecard_version !== SCORECARD_VERSION;
    const pending = currentScore === "example-not-run";
    const missingFieldBlockers = REQUIRED_SCORECARD_FIELDS
      .filter((field) => !hasRequiredFieldValue(scorecard[field]))
      .map((field) => `scorecard_missing_field:${name}:${field}`);
    const failedScore = !pending && currentScore !== "missing" && !isPassingScore(currentScore);
    const blockers = [
      ...(invalid ? [`scorecard_invalid_version:${name}`] : []),
      ...missingFieldBlockers,
      ...(pending ? [`scorecard_not_run:${name}`] : []),
      ...(currentScore === "missing" ? [`scorecard_missing_current_score:${name}`] : []),
      ...(failedScore ? [`scorecard_failed:${name}:${currentScore}`] : [])
    ];
    const entry: ScorecardSweepEntry = {
      name,
      file,
      claimClass: stringValue(scorecard.claim_class) || "unknown",
      surface: stringValue(scorecard.surface) || "unknown",
      currentScore,
      status: blockers.length > 0 ? pending && blockers.length === 1 ? "pending_evidence" : "invalid" : "scored",
      evidencePath,
      expectedPublicSafeEvidence: stringArray(scorecard.expected_public_safe_evidence),
      privateDataExclusions: stringArray(scorecard.private_data_exclusions).length
        ? stringArray(scorecard.private_data_exclusions)
        : DEFAULT_PRIVATE_DATA_EXCLUSIONS,
      knownGaps: stringArray(scorecard.known_gaps),
      nextAction: stringValue(scorecard.next_action) || "Run and record this scorecard.",
      proofBoundary: stringValue(scorecard.proof_boundary) || "No proof boundary supplied.",
      blockers
    };
    writeFileSync(evidenceWritePath, `${JSON.stringify(entry, null, 2)}\n`);
    return entry;
  } catch {
    const entry: ScorecardSweepEntry = {
      name,
      file,
      claimClass: "unknown",
      surface: "unknown",
      currentScore: "invalid-json",
      status: "invalid",
      evidencePath,
      expectedPublicSafeEvidence: [],
      privateDataExclusions: DEFAULT_PRIVATE_DATA_EXCLUSIONS,
      knownGaps: [`Scorecard JSON could not be parsed: ${file}`],
      nextAction: "Repair the scorecard JSON before running milestone sweeps.",
      proofBoundary: "Invalid scorecard JSON cannot prove beta readiness.",
      blockers: [`scorecard_invalid_json:${name}`]
    };
    writeScorecardEntry(entry, evidenceDir);
    return entry;
  }
}

function writeScorecardEntry(entry: ScorecardSweepEntry, evidenceDir: string): void {
  writeFileSync(join(evidenceDir, entry.evidencePath), `${JSON.stringify(entry, null, 2)}\n`);
}

function isPassingScore(value: string): boolean {
  return PASSING_SCORES.has(value.toLowerCase());
}

function hasRequiredFieldValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" && item.trim().length > 0);
  return value !== undefined && value !== null;
}

function scanRawEvidenceArtifacts(evidenceDir: string): RawEvidenceArtifact[] {
  if (!existsSync(evidenceDir)) return [];
  const artifacts: RawEvidenceArtifact[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      const reason = rawArtifactReason(entry.name);
      if (reason) artifacts.push({
        name: relative(evidenceDir, path).replace(/\\/g, "/"),
        reason
      });
    }
  };
  visit(evidenceDir);
  return artifacts.sort((left, right) => left.name.localeCompare(right.name));
}

function rawArtifactReason(name: string): RawEvidenceArtifact["reason"] | null {
  const normalizedName = name.toLowerCase();
  const extension = extname(normalizedName);
  if (normalizedName.endsWith(".jsonl") || normalizedName.endsWith(".jsonl.gz")) return "raw_codex_jsonl";
  if (
    normalizedName.endsWith(".sqlite")
    || normalizedName.endsWith(".sqlite3")
    || normalizedName.endsWith(".db")
    || normalizedName.endsWith(".sqlite-wal")
    || normalizedName.endsWith(".sqlite-shm")
    || normalizedName.endsWith(".db-journal")
  ) return "sqlite_database";
  if (extension === ".png" || extension === ".jpg" || extension === ".jpeg" || extension === ".gif" || extension === ".heic" || extension === ".webp") return "screenshot_or_image";
  if (extension === ".mov" || extension === ".mp4" || extension === ".webm") return "video_capture";
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
