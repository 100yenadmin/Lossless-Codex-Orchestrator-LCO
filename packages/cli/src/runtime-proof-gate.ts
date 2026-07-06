import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

type RuntimeProofJson = {
  kind?: string;
  scenario_id?: string;
  scenario_version?: string;
  proof_mode?: string;
  claim_scope?: string;
  public_safe?: boolean;
  proof_markers?: Record<string, unknown>;
  raw_transcript_read?: boolean;
  raw_prompt_included?: boolean;
  raw_secret_included?: boolean;
  screenshot_included?: boolean;
  sqlite_included?: boolean;
  live_action_count?: number;
  raw_prompt_chars?: number;
  raw_transcript_spans?: number;
  screenshot_count?: number;
  action_hash?: string;
};

export type RuntimeProofRequirement = {
  id: string;
  requiredMarkers: string[];
  maxCounts: Record<string, number>;
  minCounts?: Record<string, number>;
  exactStringFields?: Partial<Record<keyof RuntimeProofJson, string>>;
};

type RuntimeProofSelectionOptions = {
  includeDesktopCollaborationProof?: boolean;
};

export type WorkingAppRuntimeProofReport = {
  ok: boolean;
  proofDir: string | null;
  acceptedMarkerCount: number;
  blockers: string[];
};

const SECRET_LIKE_PATTERN = /(npm_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

export const WORKING_APP_RUNTIME_PROOF_REQUIREMENTS: RuntimeProofRequirement[] = [
  {
    id: "openclaw-gateway-live-codex-v1-1",
    requiredMarkers: ["installed_gateway_path", "matching_approval_audit_id", "public_safe_scan"],
    maxCounts: {
      live_action_count: 1,
      raw_prompt_chars: 0
    },
    minCounts: {
      live_action_count: 1
    }
  },
  {
    id: "post-action-refresh-reasoning-v1-1",
    requiredMarkers: ["agent_reasoning_note", "post_action_refresh", "source_refs"],
    maxCounts: {
      raw_transcript_spans: 0
    }
  }
];

export const DESKTOP_COLLABORATION_RUNTIME_PROOF_REQUIREMENT: RuntimeProofRequirement = {
  id: "desktop-collaboration-action-bound-v1-1",
  requiredMarkers: ["action_bound_target", "backend_specific_observation", "no_focus_measurement"],
  maxCounts: {
    screenshot_count: 0
  }
};

export function validateWorkingAppRuntimeProof(runtimeProofDir: string | undefined, options: RuntimeProofSelectionOptions = {}): WorkingAppRuntimeProofReport {
  const requirements = [
    ...WORKING_APP_RUNTIME_PROOF_REQUIREMENTS,
    ...(options.includeDesktopCollaborationProof ? [DESKTOP_COLLABORATION_RUNTIME_PROOF_REQUIREMENT] : [])
  ];
  return validateRuntimeProofRequirements(runtimeProofDir, requirements);
}

export function validateDesktopCollaborationRuntimeProof(runtimeProofDir: string | undefined, options: { actionHash?: string } = {}): WorkingAppRuntimeProofReport {
  const requirement = options.actionHash
    ? {
      ...DESKTOP_COLLABORATION_RUNTIME_PROOF_REQUIREMENT,
      exactStringFields: {
        action_hash: options.actionHash
      }
    }
    : DESKTOP_COLLABORATION_RUNTIME_PROOF_REQUIREMENT;
  const report = validateRuntimeProofRequirements(runtimeProofDir, [requirement]);
  if (report.ok) return report;
  return {
    ...report,
    blockers: ["desktop_collaboration_proof_missing", ...report.blockers]
  };
}

function validateRuntimeProofRequirements(runtimeProofDir: string | undefined, requirements: RuntimeProofRequirement[]): WorkingAppRuntimeProofReport {
  const proofDir = runtimeProofDir ? resolve(runtimeProofDir) : null;
  if (!proofDir) {
    return {
      ok: false,
      proofDir,
      acceptedMarkerCount: 0,
      blockers: [
        "runtime_proof_dir_missing",
        ...requirements.flatMap((requirement) => missingMarkerBlockers(requirement))
      ]
    };
  }
  if (!existsSync(proofDir)) {
    return {
      ok: false,
      proofDir,
      acceptedMarkerCount: 0,
      blockers: [
        "runtime_proof_dir_missing",
        ...requirements.flatMap((requirement) => missingMarkerBlockers(requirement))
      ]
    };
  }

  const blockers = requirements.flatMap((requirement) =>
    validateRuntimeProofFile(proofDir, requirement)
  );
  return {
    ok: blockers.length === 0,
    proofDir,
    acceptedMarkerCount: blockers.length === 0 ? requirements.length : 0,
    blockers
  };
}

function validateRuntimeProofFile(proofDir: string, requirement: RuntimeProofRequirement): string[] {
  const proofPath = join(proofDir, `${requirement.id}.runtime-proof.json`);
  if (!existsSync(proofPath)) return missingMarkerBlockers(requirement);

  const proofText = readFileSync(proofPath, "utf8");
  const secretLikeBlockers = SECRET_LIKE_PATTERN.test(proofText) ? [`runtime_proof_secret_like:${requirement.id}`] : [];
  let proof: RuntimeProofJson;
  try {
    proof = JSON.parse(proofText) as RuntimeProofJson;
  } catch {
    return [`runtime_proof_invalid_json:${requirement.id}`, ...secretLikeBlockers];
  }

  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return [`runtime_proof_invalid:${requirement.id}:shape`, ...secretLikeBlockers];
  const markerRecord = proof.proof_markers && typeof proof.proof_markers === "object" && !Array.isArray(proof.proof_markers)
    ? proof.proof_markers
    : {};

  return [
    ...(proof.kind === "loo_runtime_scenario_proof" ? [] : [`runtime_proof_invalid:${requirement.id}:kind`]),
    ...(proof.scenario_id === requirement.id ? [] : [`runtime_proof_invalid:${requirement.id}:scenario_id`]),
    ...(proof.scenario_version === "1.1" ? [] : [`runtime_proof_invalid:${requirement.id}:scenario_version`]),
    ...(proof.proof_mode === "runtime_required" ? [] : [`runtime_proof_invalid:${requirement.id}:proof_mode`]),
    ...(proof.claim_scope === "codex-working-app-proof" ? [] : [`runtime_proof_invalid:${requirement.id}:claim_scope`]),
    ...(proof.public_safe === true ? [] : [`runtime_proof_not_public_safe:${requirement.id}`]),
    ...(proof.raw_transcript_read === false ? [] : [`runtime_proof_raw_private:${requirement.id}:raw_transcript_read`]),
    ...(proof.raw_prompt_included === false ? [] : [`runtime_proof_raw_private:${requirement.id}:raw_prompt_included`]),
    ...(proof.raw_secret_included === false ? [] : [`runtime_proof_raw_private:${requirement.id}:raw_secret_included`]),
    ...(proof.screenshot_included === false ? [] : [`runtime_proof_raw_private:${requirement.id}:screenshot_included`]),
    ...(proof.sqlite_included === false ? [] : [`runtime_proof_raw_private:${requirement.id}:sqlite_included`]),
    ...secretLikeBlockers,
    ...requirement.requiredMarkers
      .filter((marker) => markerRecord[marker] !== true)
      .map((marker) => `runtime_proof_missing:${requirement.id}:${marker}`),
    ...runtimeExactStringFieldBlockers(requirement, proof),
    ...runtimeCountBlockers(requirement, proof)
  ];
}

function missingMarkerBlockers(requirement: RuntimeProofRequirement): string[] {
  return requirement.requiredMarkers.map((marker) => `runtime_proof_missing:${requirement.id}:${marker}`);
}

function runtimeCountBlockers(requirement: RuntimeProofRequirement, proof: RuntimeProofJson): string[] {
  return Object.entries(requirement.maxCounts).flatMap(([field, maxValue]) => {
    const actualValue = proof[field as keyof RuntimeProofJson];
    if (typeof actualValue !== "number") return [`runtime_proof_missing:${requirement.id}:${field}`];
    if (!Number.isInteger(actualValue) || actualValue < 0) return [`runtime_proof_invalid:${requirement.id}:${field}`];
    const minValue = requirement.minCounts?.[field];
    return [
      ...(typeof minValue === "number" && actualValue < minValue ? [`runtime_proof_below_minimum:${requirement.id}:${field}`] : []),
      ...(actualValue <= maxValue ? [] : [`runtime_proof_limit_exceeded:${requirement.id}:${field}`])
    ];
  });
}

function runtimeExactStringFieldBlockers(requirement: RuntimeProofRequirement, proof: RuntimeProofJson): string[] {
  const exactFields = Object.entries(requirement.exactStringFields ?? {}) as Array<[keyof RuntimeProofJson, string]>;
  return exactFields.flatMap(([field, expectedValue]) => {
    const actualValue = proof[field];
    if (typeof actualValue !== "string" || !actualValue.trim()) return [`runtime_proof_missing:${requirement.id}:${field}`];
    if (actualValue !== actualValue.trim()) return [`runtime_proof_invalid:${requirement.id}:${field}`];
    return actualValue === expectedValue ? [] : [`runtime_proof_mismatch:${requirement.id}:${field}`];
  });
}
