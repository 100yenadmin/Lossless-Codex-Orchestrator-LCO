import { createHash } from "node:crypto";

type LocalModelCompactionConfig = {
  enabled?: boolean;
  mode?: "canary" | string;
};

type LocalModelCompactionApproval = {
  approved: boolean;
  approvalRef?: string;
  approvedInputRefs?: string[];
};

type PreparedModelCompactionInput = {
  kind: "prepared_card" | "summary_leaf";
  ref: string;
  title?: string;
  summaryText?: string;
  sourceRefs?: string[];
  sourceRangeRefs?: string[];
  authorityCoverage?: Record<string, unknown>;
  privacyClass?: "public_safe_metadata" | string;
};

type RawTranscriptInput = {
  kind: "raw_transcript";
  ref?: string;
  rawText?: string;
};

type CurrentSafeTextInput = {
  kind: "current_safe_text";
  ref?: string;
  safeText?: string;
};

export type LocalModelCompactionInput =
  | PreparedModelCompactionInput
  | RawTranscriptInput
  | CurrentSafeTextInput;

export type AdvisoryLocalModelCompactionLeaf = {
  schema: "lco.summary.leaf.v1";
  leafRef: string;
  threadId: string | null;
  leafKind: "event_metadata";
  summaryText: string;
  sourceRefs: string[];
  sourceRangeRefs: string[];
  sourceRangeRefsOmitted: number;
  inputHash: string;
  outputHash: string;
  extractorVersion: "summary-leaves-v1";
  privacyClass: "public_safe_metadata";
  authorityCoverage: {
    source: "local_model_compaction_canary";
    status: "partial";
    advisoryOnly: true;
    trueModelCompactionCaptured: false;
    modelCallRun: false;
    preparedInputCount: number;
    sanitizerCheckRefs: string[];
    sourceRefCount: number;
  };
  confidence: number;
  freshnessAt: null;
  stale: false;
  omissionStatus: "metadata_only";
};

export type LocalModelCompactionCanaryReport = {
  schema: "lco.localModelCompaction.canary.v1";
  publicSafe: true;
  allowed: boolean;
  mode: "canary";
  blockers: string[];
  acceptedInputRefs: string[];
  rejectedInputKinds: string[];
  sanitizerChecks: {
    rawTranscriptExcluded: boolean;
    currentSafeTextExcluded: boolean;
    onlyApprovedPreparedInputs: boolean;
    promptInjectionIsolated: boolean;
    outputPublicSafe: boolean;
    sourceRefsPresent: boolean;
  };
  advisoryLeaf: AdvisoryLocalModelCompactionLeaf | null;
  actionsPerformed: {
    modelCallRun: false;
    liveCodexControlRun: false;
    rawTranscriptRead: false;
    sourceStoreMutation: false;
    guiMutation: false;
    externalWrite: false;
  };
  proofBoundary: string;
  nextAction: string;
};

export function validateLocalModelCompactionJob(input: {
  config?: LocalModelCompactionConfig;
  approval?: LocalModelCompactionApproval;
  inputs?: LocalModelCompactionInput[];
}): LocalModelCompactionCanaryReport {
  const config = input.config ?? {};
  const approval = input.approval;
  const inputs = input.inputs ?? [];
  const blockers: string[] = [];
  const rejectedInputKinds: string[] = [];
  const acceptedPreparedInputs: PreparedModelCompactionInput[] = [];
  const approvedInputRefs = new Set((approval?.approvedInputRefs ?? []).filter(isPublicCompactionSourceRef));

  if (config.enabled !== true) blockers.push("local_model_compaction_disabled_by_default");
  if (config.enabled === true && config.mode !== "canary") blockers.push("local_model_compaction_canary_mode_required");
  if (approval?.approved !== true || !approval.approvalRef) blockers.push("explicit_approval_required");

  for (const candidate of inputs) {
    if (candidate.kind === "raw_transcript") {
      rejectedInputKinds.push(candidate.kind);
      blockers.push("input_kind_disallowed:raw_transcript", "raw_transcript_input_rejected");
      continue;
    }
    if (candidate.kind === "current_safe_text") {
      rejectedInputKinds.push(candidate.kind);
      blockers.push("input_kind_disallowed:current_safe_text", "current_safe_text_input_rejected");
      continue;
    }
    if (!isPublicCompactionSourceRef(candidate.ref)) {
      blockers.push(`input_ref_invalid:${safeIdentifier(candidate.kind)}`);
      continue;
    }
    if (!approvedInputRefs.has(candidate.ref)) {
      blockers.push(`input_ref_not_approved:${candidate.ref}`);
      continue;
    }
    if (candidate.privacyClass !== "public_safe_metadata") {
      blockers.push(`public_safe_privacy_class_required:${candidate.ref}`);
      continue;
    }
    acceptedPreparedInputs.push(candidate);
  }

  if (acceptedPreparedInputs.length === 0) blockers.push("approved_prepared_inputs_required");

  const sourceRefs = uniqueStrings([
    ...acceptedPreparedInputs.map((candidate) => candidate.ref),
    ...acceptedPreparedInputs.flatMap((candidate) => candidate.sourceRefs ?? [])
  ].filter(isPublicCompactionSourceRef));
  const sourceRangeRefs = uniqueStrings(acceptedPreparedInputs.flatMap((candidate) => candidate.sourceRangeRefs ?? []).filter(isPublicSourceRangeRef));
  const sanitizerCheckRefs = [
    "sanitizer:raw_transcript_excluded",
    "sanitizer:current_safe_text_excluded",
    "sanitizer:prompt_injection_isolated",
    "sanitizer:output_public_safe"
  ];

  const advisoryLeaf = blockers.length === 0
    ? createAdvisoryLocalModelCompactionLeaf({
      preparedInputRefs: acceptedPreparedInputs.map((candidate) => candidate.ref),
      sourceRefs,
      sourceRangeRefs,
      sanitizerCheckRefs
    })
    : null;
  const serializedLeaf = advisoryLeaf ? JSON.stringify(advisoryLeaf) : "";
  const sanitizerChecks = {
    rawTranscriptExcluded: !serializedLeaf.includes("raw transcript") && !serializedLeaf.includes("BEGIN RAW TRANSCRIPT"),
    currentSafeTextExcluded: !serializedLeaf.includes("current safe_text") && !serializedLeaf.includes("Current safe_text"),
    onlyApprovedPreparedInputs: acceptedPreparedInputs.length === inputs.length && acceptedPreparedInputs.every((candidate) => approvedInputRefs.has(candidate.ref)),
    promptInjectionIsolated: !PROMPT_INJECTION_PATTERN.test(serializedLeaf),
    outputPublicSafe: advisoryLeaf ? isPublicSafeOutput(serializedLeaf) : true,
    sourceRefsPresent: sourceRefs.length > 0 && sourceRangeRefs.length > 0
  };
  const sanitizerBlockers = advisoryLeaf && !sanitizerChecks.outputPublicSafe ? ["advisory_output_not_public_safe"] : [];
  const finalBlockers = uniqueStrings([...blockers, ...sanitizerBlockers]);

  return {
    schema: "lco.localModelCompaction.canary.v1",
    publicSafe: true,
    allowed: finalBlockers.length === 0,
    mode: "canary",
    blockers: finalBlockers,
    acceptedInputRefs: acceptedPreparedInputs.map((candidate) => candidate.ref),
    rejectedInputKinds: uniqueStrings(rejectedInputKinds),
    sanitizerChecks,
    advisoryLeaf: finalBlockers.length === 0 ? advisoryLeaf : null,
    actionsPerformed: NO_ACTIONS_PERFORMED,
    proofBoundary: "This canary validates opt-in boundaries and advisory summary-leaf-shaped output only. It does not run local model compaction, call a model, read raw transcripts, use current safe_text, mutate Codex source stores, run live Codex control, mutate a GUI, write external systems, publish npm, or create a GitHub Release.",
    nextAction: finalBlockers.length === 0
      ? "Use this canary as a design proof before any separate implementation that could call a local model."
      : "Repair config, approval, and prepared-input refs before considering local model compaction."
  };
}

export function createAdvisoryLocalModelCompactionLeaf(input: {
  preparedInputRefs: string[];
  sourceRefs: string[];
  sourceRangeRefs: string[];
  sanitizerCheckRefs?: string[];
}): AdvisoryLocalModelCompactionLeaf {
  const sanitizerCheckRefs = uniqueStrings((input.sanitizerCheckRefs ?? []).filter(isPublicCompactionSourceRef));
  const sourceRefs = uniqueStrings([
    ...input.sourceRefs,
    ...input.preparedInputRefs,
    ...sanitizerCheckRefs
  ].filter(isPublicCompactionSourceRef)).slice(0, 40);
  const sourceRangeRefs = uniqueStrings(input.sourceRangeRefs.filter(isPublicSourceRangeRef)).slice(0, 40);
  const inputHash = stableId(JSON.stringify({
    preparedInputRefs: uniqueStrings(input.preparedInputRefs.filter(isPublicCompactionSourceRef)).sort(),
    sourceRefs: sourceRefs.slice().sort(),
    sourceRangeRefs: sourceRangeRefs.slice().sort(),
    sanitizerCheckRefs: sanitizerCheckRefs.slice().sort()
  }));
  const summaryText = "Local model compaction canary advisory: approved prepared-card and summary-leaf inputs passed the opt-in boundary checks; no model call was run.";
  const outputHash = stableId(JSON.stringify({ inputHash, summaryText, sourceRefs, sourceRangeRefs }));
  const leafId = stableId(`local-model-compaction-canary:${inputHash}:${outputHash}`);
  return {
    schema: "lco.summary.leaf.v1",
    leafRef: `summary_leaf:${leafId}`,
    threadId: null,
    leafKind: "event_metadata",
    summaryText,
    sourceRefs,
    sourceRangeRefs,
    sourceRangeRefsOmitted: 0,
    inputHash,
    outputHash,
    extractorVersion: "summary-leaves-v1",
    privacyClass: "public_safe_metadata",
    authorityCoverage: {
      source: "local_model_compaction_canary",
      status: "partial",
      advisoryOnly: true,
      trueModelCompactionCaptured: false,
      modelCallRun: false,
      preparedInputCount: uniqueStrings(input.preparedInputRefs.filter(isPublicCompactionSourceRef)).length,
      sanitizerCheckRefs,
      sourceRefCount: sourceRefs.length
    },
    confidence: 0.45,
    freshnessAt: null,
    stale: false,
    omissionStatus: "metadata_only"
  };
}

const NO_ACTIONS_PERFORMED = {
  modelCallRun: false,
  liveCodexControlRun: false,
  rawTranscriptRead: false,
  sourceStoreMutation: false,
  guiMutation: false,
  externalWrite: false
} as const;

const SECRET_LIKE_PATTERN = /(PRIVATE_CANARY_TOKEN|BEGIN RAW TRANSCRIPT|npm_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const PROMPT_INJECTION_PATTERN = /(ignore previous instructions|run live codex control|developer message|system prompt)/i;
const PUBLIC_SOURCE_REF_PATTERN = /^(?:codex_thread|summary_leaf|prepared_card|sanitizer):[A-Za-z0-9._:-]{1,160}$/;
const PUBLIC_SOURCE_RANGE_REF_PATTERN = /^codex_range:[0-9a-f]{32}$/;

function isPublicCompactionSourceRef(value: string): boolean {
  return PUBLIC_SOURCE_REF_PATTERN.test(value) && !SECRET_LIKE_PATTERN.test(value);
}

function isPublicSourceRangeRef(value: string): boolean {
  return PUBLIC_SOURCE_RANGE_REF_PATTERN.test(value);
}

function isPublicSafeOutput(value: string): boolean {
  return !SECRET_LIKE_PATTERN.test(value) && !PROMPT_INJECTION_PATTERN.test(value);
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function safeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9._:-]+/g, "_").slice(0, 80) || "unknown";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
