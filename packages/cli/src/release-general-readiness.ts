import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export type ReleaseGeneralReadinessOptions = {
  evidenceDir: string;
  candidateSha?: string;
  agentSkillEvidence?: string;
  agentDogfoodEvidence?: string;
  freshNpmEvidence?: string;
  scorecardSweepEvidence?: string;
  githubCiEvidence?: string;
  codeqlEvidence?: string;
  now?: string;
  rootDir?: string;
};

export type GeneralReadinessCheck = {
  id:
    | "agent_skill_playbook"
    | "agent_dogfood_workflow"
    | "fresh_npm_clean_profile"
    | "scorecard_sweep"
    | "docs_truth"
    | "stable_dist_tag_policy"
    | "candidate_sha"
    | "github_ci"
    | "codeql";
  satisfied: boolean;
};

type ReleaseCheckId = "github_ci" | "codeql";

type ReleaseCheckProof = {
  kind?: string;
  check?: ReleaseCheckId;
  commitSha?: string;
  status?: string;
  conclusion?: string;
  runUrl?: string;
  warnings?: unknown;
  rawSecretIncluded?: boolean;
};

export type ReleaseGeneralReadinessReport = {
  ok: boolean;
  generalReady: boolean;
  generatedAt: string;
  statusManifestPath: string;
  blockers: string[];
  checks: GeneralReadinessCheck[];
  actionsPerformed: {
    npmPublished: false;
    githubReleaseCreated: false;
    npmLatestPromoted: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
  };
  forbiddenActions: string[];
  proofBoundary: string;
};

const REQUIRED_DOGFOOD_WORKFLOW = [
  "doctor_ready",
  "search_source_ref",
  "describe_thread",
  "bounded_expand",
  "plan_lookup",
  "final_message_lookup",
  "touched_files_lookup",
  "dry_run_audit"
];

const REQUIRED_SCORECARDS = [
  "local-agent-usability-review",
  "packaging-install-review",
  "public-claim-review",
  "retrieval-quality-review",
  "safety-bypass-review"
];

export function createReleaseGeneralReadiness(options: ReleaseGeneralReadinessOptions): ReleaseGeneralReadinessReport {
  const evidenceDir = resolve(options.evidenceDir);
  const rootDir = resolve(options.rootDir ?? process.cwd());
  mkdirSync(evidenceDir, { recursive: true });

  const candidateSha = options.candidateSha?.trim();
  const candidateShaSatisfied = Boolean(candidateSha && /^[0-9a-f]{40}$/i.test(candidateSha));
  const agentSkill = validateAgentSkillEvidence(resolveEvidencePath(evidenceDir, options.agentSkillEvidence));
  const agentDogfood = validateAgentDogfoodEvidence(resolveEvidencePath(evidenceDir, options.agentDogfoodEvidence));
  const freshNpm = validateFreshNpmEvidence(resolveEvidencePath(evidenceDir, options.freshNpmEvidence));
  const scorecards = validateScorecardSweepEvidence(resolveEvidencePath(evidenceDir, options.scorecardSweepEvidence));
  const docsTruth = validateDocsTruth(rootDir);
  const stableDistTagPolicy = validateStableDistTagPolicy(rootDir);
  const githubCi = validateReleaseCheckProof(resolveEvidencePath(evidenceDir, options.githubCiEvidence), "github_ci", candidateSha);
  const codeql = validateReleaseCheckProof(resolveEvidencePath(evidenceDir, options.codeqlEvidence), "codeql", candidateSha);

  const checks: GeneralReadinessCheck[] = [
    { id: "agent_skill_playbook", satisfied: agentSkill.ok },
    { id: "agent_dogfood_workflow", satisfied: agentDogfood.ok },
    { id: "fresh_npm_clean_profile", satisfied: freshNpm.ok },
    { id: "scorecard_sweep", satisfied: scorecards.ok },
    { id: "docs_truth", satisfied: docsTruth.ok },
    { id: "stable_dist_tag_policy", satisfied: stableDistTagPolicy.ok },
    { id: "candidate_sha", satisfied: candidateShaSatisfied },
    { id: "github_ci", satisfied: githubCi.ok },
    { id: "codeql", satisfied: codeql.ok }
  ];
  const blockers = [
    ...agentSkill.blockers,
    ...agentDogfood.blockers,
    ...freshNpm.blockers,
    ...scorecards.blockers,
    ...docsTruth.blockers,
    ...stableDistTagPolicy.blockers,
    ...(candidateShaSatisfied ? [] : [candidateSha ? "candidate_sha_invalid" : "candidate_sha_missing"]),
    ...githubCi.blockers,
    ...codeql.blockers
  ];
  const statusManifestPath = join(evidenceDir, "general-readiness.json");
  const report: ReleaseGeneralReadinessReport = {
    ok: blockers.length === 0,
    generalReady: blockers.length === 0,
    generatedAt: options.now ?? new Date().toISOString(),
    statusManifestPath,
    blockers,
    checks,
    actionsPerformed: {
      npmPublished: false,
      githubReleaseCreated: false,
      npmLatestPromoted: false,
      liveCodexControlRun: false,
      desktopGuiActionRun: false
    },
    forbiddenActions: [
      "npm publish",
      "GitHub Release creation",
      "npm latest promotion",
      "live Codex control",
      "desktop GUI mutation"
    ],
    proofBoundary: "This gate may prove the 1.0 general-readiness checklist for Codex-first local orchestration. It does not publish 1.0, move npm latest, create a GitHub Release, prove Claude parity, approve generic GUI mutation, run live Codex control, or claim customer/enterprise readiness."
  };

  writeFileSync(statusManifestPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function resolveEvidencePath(evidenceDir: string, path: string | undefined): string | undefined {
  if (!path) return undefined;
  return isAbsolute(path) ? path : join(evidenceDir, path);
}

function validateAgentSkillEvidence(path: string | undefined): { ok: boolean; blockers: string[] } {
  const payload = readJsonObject(path, "agent_skill_evidence");
  if (!payload.ok) return { ok: false, blockers: payload.blockers };
  const data = payload.value;
  const ok = data.issue === 232
    && data.publicSafe === true
    && objectValue(data.npmPackDryRun)?.skillIncluded === true;
  return ok ? { ok: true, blockers: [] } : { ok: false, blockers: ["agent_skill_evidence_invalid"] };
}

function validateAgentDogfoodEvidence(path: string | undefined): { ok: boolean; blockers: string[] } {
  const payload = readJsonObject(path, "agent_dogfood_evidence");
  if (!payload.ok) return { ok: false, blockers: payload.blockers };
  const data = payload.value;
  const agentReasoning = objectValue(data.agentReasoning);
  const workflowEvidence = Array.isArray(agentReasoning?.workflowEvidence) ? agentReasoning.workflowEvidence.map(String) : [];
  const actions = objectValue(data.actionsPerformed);
  const ok = data.ok === true
    && data.toolSmokeReady === true
    && data.publicSafe === true
    && objectValue(data.catalog)?.requiredToolsPresent === true
    && REQUIRED_DOGFOOD_WORKFLOW.every((marker) => workflowEvidence.includes(marker))
    && agentReasoning?.dryRunLive === false
    && agentReasoning?.rawTranscriptRead === false
    && actions?.liveCodexControlRun === false
    && actions?.desktopGuiActionRun === false
    && actions?.npmPublished === false
    && actions?.githubReleaseCreated === false
    && blockersArray(data.blockers).length === 0;
  return ok ? { ok: true, blockers: [] } : { ok: false, blockers: ["agent_dogfood_evidence_invalid"] };
}

function validateFreshNpmEvidence(path: string | undefined): { ok: boolean; blockers: string[] } {
  const payload = readJsonObject(path, "fresh_npm_evidence");
  if (!payload.ok) return { ok: false, blockers: payload.blockers };
  const data = payload.value;
  const binary = objectValue(data.binaryCheck);
  const dogfood = objectValue(data.dogfood);
  const publishedSmoke = objectValue(data.publishedSmoke);
  const onboard = objectValue(data.onboardStatus);
  const diagnostic = objectValue(data.initialSelectorDiagnostic);
  const ok = data.issue === 235
    && data.publicSafe === true
    && typeof data.registryBetaVersion === "string"
    && objectValue(data.distTags)?.beta === data.registryBetaVersion
    && diagnostic?.trueUnpublishedVersion === false
    && diagnostic?.rawSecretIncluded === false
    && binary?.publicSafe === true
    && binary?.looExists === true
    && binary?.looMcpServerExists === true
    && binary?.rawStdoutStored === false
    && binary?.rawStderrStored === false
    && dogfood?.ok === true
    && dogfood?.dogfoodReady === true
    && dogfood?.requiredToolsPresent === true
    && blockersArray(dogfood?.blockers).length === 0
    && publishedSmoke?.ok === true
    && publishedSmoke?.packagePathOk === true
    && publishedSmoke?.versionMatchStatus === "matches_registry_beta"
    && blockersArray(publishedSmoke?.blockers).length === 0
    && onboard?.ok === true
    && blockersArray(onboard?.blockers).length === 0;
  return ok ? { ok: true, blockers: [] } : { ok: false, blockers: ["fresh_npm_evidence_invalid"] };
}

function validateScorecardSweepEvidence(path: string | undefined): { ok: boolean; blockers: string[] } {
  const payload = readJsonObject(path, "scorecard_sweep_evidence");
  if (!payload.ok) return { ok: false, blockers: payload.blockers };
  const data = payload.value;
  const scorecards = Array.isArray(data.scorecards) ? data.scorecards : [];
  const missingOrFailing = REQUIRED_SCORECARDS.filter((name) => {
    const scorecard = scorecards.find((item) => objectValue(item)?.name === name);
    return !(scorecard
      && objectValue(scorecard)?.currentScore === "pass"
      && objectValue(scorecard)?.status === "scored"
      && blockersArray(objectValue(scorecard)?.blockers).length === 0);
  });
  const actions = objectValue(data.actionsPerformed);
  const ok = data.ok === true
    && data.sweepReady === true
    && data.publicSafe === true
    && blockersArray(data.blockers).length === 0
    && missingOrFailing.length === 0
    && actions?.liveCodexControlRun === false
    && actions?.desktopGuiActionRun === false
    && actions?.npmPublished === false
    && actions?.githubReleaseCreated === false;
  return ok ? { ok: true, blockers: [] } : {
    ok: false,
    blockers: missingOrFailing.length > 0
      ? missingOrFailing.map((name) => `scorecard_missing_or_not_pass:${name}`)
      : ["scorecard_sweep_evidence_invalid"]
  };
}

function validateDocsTruth(rootDir: string): { ok: boolean; blockers: string[] } {
  const readme = readText(join(rootDir, "README.md"));
  const vision = readText(join(rootDir, "VISION.md"));
  if (!readme || !vision) return { ok: false, blockers: ["docs_truth_missing"] };
  const combined = `${readme}\n${vision}`.toLowerCase();
  const ok = combined.includes("m9 agent handoff beta sprint")
    && combined.includes("what a local openclaw agent can do today")
    && combined.includes("claude code remains")
    && combined.includes("generic gui mutation")
    && combined.includes("1.0 readiness gate");
  return ok ? { ok: true, blockers: [] } : { ok: false, blockers: ["docs_truth_stale_or_overclaiming"] };
}

function validateStableDistTagPolicy(rootDir: string): { ok: boolean; blockers: string[] } {
  const readme = readText(join(rootDir, "README.md"));
  const runbook = readText(join(rootDir, "docs", "BETA_RELEASE_RUNBOOK.md"));
  const combined = `${readme}\n${runbook}`.toLowerCase();
  const ok = combined.includes("first stable release")
    && combined.includes("move `latest` to the stable")
    && combined.includes("do not publish a fake stable");
  return ok ? { ok: true, blockers: [] } : { ok: false, blockers: ["stable_dist_tag_policy_missing"] };
}

function validateReleaseCheckProof(path: string | undefined, check: ReleaseCheckId, candidateSha: string | undefined): { ok: boolean; blockers: string[] } {
  const payload = readJsonObject(path, `${check}_evidence`);
  if (!payload.ok) return { ok: false, blockers: payload.blockers };
  const proof = payload.value as ReleaseCheckProof;
  const allowedKeys = new Set(["kind", "check", "commitSha", "status", "conclusion", "runUrl", "warnings", "rawSecretIncluded"]);
  if (proof.kind !== "loo_release_check_evidence"
    || proof.check !== check
    || typeof proof.commitSha !== "string"
    || proof.status !== "completed"
    || proof.conclusion !== "success"
    || proof.rawSecretIncluded !== false
    || (proof.warnings !== undefined && !Array.isArray(proof.warnings))
    || !Object.keys(proof).every((key) => allowedKeys.has(key))) {
    return { ok: false, blockers: [`${check}_evidence_invalid`] };
  }
  if (!candidateSha || !/^[0-9a-f]{40}$/i.test(candidateSha) || proof.commitSha.toLowerCase() !== candidateSha.toLowerCase()) {
    return { ok: false, blockers: [`${check}_sha_mismatch`] };
  }
  if (Array.isArray(proof.warnings) && proof.warnings.length > 0) return { ok: false, blockers: [`${check}_warnings_present`] };
  return { ok: true, blockers: [] };
}

function readJsonObject(path: string | undefined, id: string): { ok: true; value: Record<string, unknown> } | { ok: false; blockers: string[] } {
  if (!path || !existsSync(path)) return { ok: false, blockers: [`${id}_missing`] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, blockers: [`${id}_invalid`] };
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, blockers: [`${id}_invalid`] };
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function blockersArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
