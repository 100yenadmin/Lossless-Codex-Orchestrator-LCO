export type NpmInstallFailureInput = {
  stderr: string;
  packageName: string;
  requested: string;
  registryVersionVisible: boolean;
  registryTarballVisible?: boolean;
  tarballUrl?: string;
  beforeRetryFailed?: boolean;
  nowIso?: string;
};

export type NpmInstallFailureDiagnostic = {
  code: "npm_before_cutoff_drift" | "npm_selector_cutoff_drift" | "npm_version_unavailable" | "npm_install_failed";
  publicSafe: true;
  summary: string;
  suggestedRetry: string | null;
  trueUnpublishedVersion: boolean;
  rawSecretIncluded: false;
};

export function diagnoseNpmInstallFailure(input: NpmInstallFailureInput): NpmInstallFailureDiagnostic {
  const stderr = input.stderr || "";
  const hasBeforeCutoff = /with a date before\b/i.test(stderr);
  const hasVersionSelectionFailure = /\b(?:E404|ENOVERSIONS|ETARGET|No versions available|No matching version found|No match found for version)\b/i.test(stderr);

  if (input.registryVersionVisible && input.registryTarballVisible && input.beforeRetryFailed && hasVersionSelectionFailure) {
    return {
      code: "npm_selector_cutoff_drift",
      publicSafe: true,
      summary: `npm install still could not select ${input.packageName}@${input.requested} after a before-cutoff retry, but registry metadata exposes an installable tarball.`,
      suggestedRetry: input.tarballUrl ? `npm install ${input.tarballUrl}` : `npm view ${input.packageName}@beta dist.tarball --json`,
      trueUnpublishedVersion: false,
      rawSecretIncluded: false
    };
  }

  if (input.registryVersionVisible && hasVersionSelectionFailure && hasBeforeCutoff) {
    const retryBefore = nextDayIso(input.nowIso);
    return {
      code: "npm_before_cutoff_drift",
      publicSafe: true,
      summary: `npm install could not select ${input.packageName}@${input.requested} because the npm client applied a stale before cutoff even though registry metadata shows the version.`,
      suggestedRetry: `npm install ${input.packageName}@${input.requested} --before=${retryBefore}`,
      trueUnpublishedVersion: false,
      rawSecretIncluded: false
    };
  }

  if (!input.registryVersionVisible && hasVersionSelectionFailure) {
    return {
      code: "npm_version_unavailable",
      publicSafe: true,
      summary: `npm registry metadata did not show ${input.packageName}@${input.requested}.`,
      suggestedRetry: null,
      trueUnpublishedVersion: true,
      rawSecretIncluded: false
    };
  }

  return {
    code: "npm_install_failed",
    publicSafe: true,
    summary: `npm install failed for ${input.packageName}@${input.requested}; inspect sanitized stderr for the blocker category.`,
    suggestedRetry: null,
    trueUnpublishedVersion: false,
    rawSecretIncluded: false
  };
}

function nextDayIso(nowIso: string | undefined): string {
  const nowMs = nowIso ? Date.parse(nowIso) : Date.now();
  const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const nextDay = new Date(baseMs + 24 * 60 * 60 * 1000);
  nextDay.setUTCHours(0, 0, 0, 0);
  return nextDay.toISOString();
}
