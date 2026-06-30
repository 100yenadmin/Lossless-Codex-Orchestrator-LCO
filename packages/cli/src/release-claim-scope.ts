export const RELEASE_CLAIM_SCOPES = [
  "codex-live-control",
  "codex-read-search-expand-dry-run",
  "codex-working-app-proof"
] as const;

export type ReleaseClaimScope = typeof RELEASE_CLAIM_SCOPES[number];

export type ReleaseExcludedClaim =
  | {
    id: "approved_live_control_smoke";
    blockerIfClaimed: "approved_live_control_smoke_missing";
  }
  | {
    id: "codex_working_app_runtime_proof";
    blockerIfClaimed: "working_app_runtime_proof_missing";
  };

export const DEFAULT_RELEASE_CLAIM_SCOPE: ReleaseClaimScope = "codex-live-control";

export function normalizeReleaseClaimScope(value: string | undefined): ReleaseClaimScope {
  if (!value) return DEFAULT_RELEASE_CLAIM_SCOPE;
  if (isReleaseClaimScope(value)) return value;
  throw new Error(`Unknown release claim scope: ${value}`);
}

export function releaseClaimScopeRequiresLiveControl(scope: ReleaseClaimScope): boolean {
  return scope === "codex-live-control" || scope === "codex-working-app-proof";
}

export function releaseClaimScopeRequiresWorkingAppRuntimeProof(scope: ReleaseClaimScope): boolean {
  return scope === "codex-working-app-proof";
}

export function excludedClaimsForScope(scope: ReleaseClaimScope): ReleaseExcludedClaim[] {
  if (releaseClaimScopeRequiresWorkingAppRuntimeProof(scope)) return [];
  const exclusions: ReleaseExcludedClaim[] = [];
  if (!releaseClaimScopeRequiresLiveControl(scope)) {
    exclusions.push(
      {
        id: "approved_live_control_smoke",
        blockerIfClaimed: "approved_live_control_smoke_missing"
      }
    );
  }
  exclusions.push(
    {
      id: "codex_working_app_runtime_proof",
      blockerIfClaimed: "working_app_runtime_proof_missing"
    }
  );
  return exclusions;
}

export function liveControlExcludedDetail(scope: ReleaseClaimScope): string {
  return `approved live-control smoke is excluded by claim scope ${scope}; live Codex send/resume/steer/interrupt remains outside this release proof boundary`;
}

function isReleaseClaimScope(value: string): value is ReleaseClaimScope {
  return (RELEASE_CLAIM_SCOPES as readonly string[]).includes(value);
}
