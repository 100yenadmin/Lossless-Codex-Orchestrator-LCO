import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";

export type ScorecardSweepOptions = {
  evidenceDir: string;
  scorecardDir?: string;
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
  ok: boolean;
  sweepReady: boolean;
  publicSafe: true;
  generatedAt: string;
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
  blockers: string[];
  privateDataExclusions: string[];
  proofBoundary: string;
  nextAction: string;
};

type ScorecardJson = {
  scorecard_version?: unknown;
  claim_class?: unknown;
  surface?: unknown;
  current_score?: unknown;
  expected_public_safe_evidence?: unknown;
  private_data_exclusions?: unknown;
  known_gaps?: unknown;
  next_action?: unknown;
  proof_boundary?: unknown;
};

const SCORECARD_VERSION = "1.0";
const REQUIRED_SCORECARD_NAMES = [
  "local-agent-usability-review",
  "orchestrator-leverage-prioritization",
  "packaging-install-review",
  "public-claim-review",
  "retrieval-quality-review",
  "safety-bypass-review"
];
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
  const packageRoot = options.rootDir ? resolve(options.rootDir) : findPackageRoot(dirname(fileURLToPath(import.meta.url))) ?? process.cwd();
  const scorecardDir = options.scorecardDir ? resolve(options.scorecardDir) : join(packageRoot, "evals", "scorecards", "v1.0");
  if (evidenceDir === scorecardDir) {
    throw new Error("--evidence-dir must be different from --scorecard-dir");
  }
  const sourceDirForReport = scorecardDir.startsWith(`${packageRoot}/`) ? scorecardDir.slice(packageRoot.length + 1) : scorecardDir;

  mkdirSync(evidenceDir, { recursive: true });
  const scorecards = readScorecards(scorecardDir, evidenceDir);
  const missingRequiredScorecards = REQUIRED_SCORECARD_NAMES
    .filter((name) => !scorecards.some((scorecard) => scorecard.name === name))
    .map((name) => `scorecard_missing:${name}`);
  const blockers = [...scorecards.flatMap((scorecard) => scorecard.blockers), ...missingRequiredScorecards];
  const sweepPath = join(evidenceDir, "scorecard-sweep.json");
  const report: ScorecardSweepReport = {
    ok: blockers.length === 0,
    sweepReady: blockers.length === 0,
    publicSafe: true,
    generatedAt: options.now ?? new Date().toISOString(),
    scorecardVersion: SCORECARD_VERSION,
    scorecardSourceDir: sourceDirForReport,
    sweepPath,
    actionsPerformed: {
      liveCodexControlRun: false,
      desktopGuiActionRun: false,
      npmPublished: false,
      githubReleaseCreated: false
    },
    scorecards,
    blockers,
    privateDataExclusions: uniqueStrings(scorecards.flatMap((scorecard) => scorecard.privateDataExclusions).concat(DEFAULT_PRIVATE_DATA_EXCLUSIONS)),
    proofBoundary: "This scorecard sweep is public-safe beta evidence only; it does not approve live Codex control, GUI mutation, npm publish, or GitHub Release creation.",
    nextAction: blockers.length === 0
      ? "Review the public-safe sweep packet before any beta release step."
      : "Run the missing scorecard evidence commands and update each scorecard before claiming beta readiness."
  };

  writeFileSync(sweepPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function readScorecards(scorecardDir: string, evidenceDir: string): ScorecardSweepEntry[] {
  if (!existsSync(scorecardDir)) {
    const entry: ScorecardSweepEntry = {
      name: "scorecard-directory",
      file: scorecardDir,
      claimClass: "unknown",
      surface: "unknown",
      currentScore: "missing",
      status: "invalid",
      evidencePath: join(evidenceDir, "scorecard-directory.json"),
      expectedPublicSafeEvidence: [],
      privateDataExclusions: DEFAULT_PRIVATE_DATA_EXCLUSIONS,
      knownGaps: [`Scorecard directory not found: ${scorecardDir}`],
      nextAction: "Restore evals/scorecards/v1.0 before running milestone sweeps.",
      proofBoundary: "No scorecard proof exists because the scorecard directory is missing.",
      blockers: ["scorecard_directory_missing"]
    };
    writeScorecardEntry(entry);
    return [entry];
  }

  return readdirSync(scorecardDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => readScorecard(join(scorecardDir, file), file, evidenceDir));
}

function readScorecard(path: string, file: string, evidenceDir: string): ScorecardSweepEntry {
  const name = basename(file, ".json");
  const evidencePath = join(evidenceDir, file);
  try {
    const scorecard = JSON.parse(readFileSync(path, "utf8")) as ScorecardJson;
    const currentScore = stringValue(scorecard.current_score) || "missing";
    const invalid = scorecard.scorecard_version !== SCORECARD_VERSION;
    const pending = currentScore === "example-not-run";
    const blockers = [
      ...(invalid ? [`scorecard_invalid_version:${name}`] : []),
      ...(pending ? [`scorecard_not_run:${name}`] : []),
      ...(currentScore === "missing" ? [`scorecard_missing_current_score:${name}`] : [])
    ];
    const entry: ScorecardSweepEntry = {
      name,
      file,
      claimClass: stringValue(scorecard.claim_class) || "unknown",
      surface: stringValue(scorecard.surface) || "unknown",
      currentScore,
      status: invalid || currentScore === "missing" ? "invalid" : pending ? "pending_evidence" : "scored",
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
    writeFileSync(evidencePath, `${JSON.stringify(entry, null, 2)}\n`);
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
    writeScorecardEntry(entry);
    return entry;
  }
}

function writeScorecardEntry(entry: ScorecardSweepEntry): void {
  writeFileSync(entry.evidencePath, `${JSON.stringify(entry, null, 2)}\n`);
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
