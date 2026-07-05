import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

export type QaLabPrivacyScanOptions = {
  evidenceDir: string;
  packageVersion: string;
  candidateSha: string;
  scanDir?: string;
  now?: string;
};

export type QaLabPrivacyScanFinding = {
  ref: string;
  reason: string;
};

export type QaLabPrivacyScanBlocker = {
  severity: "P0" | "P1" | "P2" | "P3";
  code: string;
  source: string;
  detail: string;
};

export type QaLabPrivacyScanReport = {
  schema: "lco.privacyScan.v1";
  ok: boolean;
  publicSafe: boolean;
  generatedAt: string;
  packageName: "lossless-openclaw-orchestrator";
  packageVersion: string;
  candidateSha: string | null;
  scannedRootRef: "evidence-dir" | "scan-dir";
  rawSessionArtifacts: QaLabPrivacyScanFinding[];
  secretLikeEvidenceFindings: QaLabPrivacyScanFinding[];
  evidenceIndex: Array<{
    ref: string;
    status: "safe" | "unsafe" | "skipped";
    reasonCodes: string[];
  }>;
  blockers: QaLabPrivacyScanBlocker[];
  warnings: QaLabPrivacyScanBlocker[];
  actionsPerformed: {
    npmPublished: false;
    githubReleaseCreated: false;
    liveCodexControlRun: false;
    desktopGuiActionRun: false;
    rawTranscriptRead: false;
    rawPromptRead: false;
    screenshotsCaptured: false;
    sourceStoreMutation: false;
    gatewayScopeApproval: false;
    broadGatewayScopeApproval: false;
  };
  privateDataExclusions: string[];
  proofBoundary: string;
  nextSafeCommands: string[];
};

type ScanEntry = {
  ref: string;
  absolutePath: string;
  reasonCodes: string[];
  scanned: boolean;
};

const PACKAGE_NAME = "lossless-openclaw-orchestrator";
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const MAX_SCAN_ENTRIES = 4096;
const TEXT_SCAN_CHUNK_BYTES = 64 * 1024;
const TEXT_SCAN_TAIL_CHARS = 512;
const SECRET_LIKE_PATTERN = /(npm_[A-Za-z0-9]{20,}|bearer\s+[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|-----BEGIN\s+[A-Z ]*PRIVATE KEY-----)/i;
const PRIVATE_VALUE_PATTERN = /(?:\/Users\/|\/Volumes\/|\/private\/var\/|\/tmp\/|~\/|[A-Za-z]:\\Users\\|\.jsonl\b|\.sqlite\b|\.sqlite-wal\b|\.sqlite-shm\b|\bcookie\b|set-cookie|authorization\s*:|api[_-]?key\s*[=:]|token\s*[=:]|secret\s*[=:]|password\s*[=:])/i;
const PRIVATE_DATA_EXCLUSIONS = [
  "raw Codex transcripts",
  "raw prompts or message text",
  "raw local filesystem paths",
  "SQLite DBs",
  "JSONL transcripts",
  "screenshots or videos",
  "tokens, credentials, API keys, cookies",
  "raw CLI, MCP, OpenClaw gateway, or desktop logs",
  "customer data"
];

export function createQaLabPrivacyScanReport(options: QaLabPrivacyScanOptions): QaLabPrivacyScanReport {
  const evidenceDir = resolve(options.evidenceDir);
  const scanDir = resolve(options.scanDir ?? options.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });

  const blockers: QaLabPrivacyScanBlocker[] = [];
  const warnings: QaLabPrivacyScanBlocker[] = [];
  if (!options.packageVersion.trim()) {
    addBlocker(blockers, "P1", "package_version_missing", "privacyScan", "Package version is required.");
  }
  if (!SHA_PATTERN.test(options.candidateSha)) {
    addBlocker(blockers, "P1", "candidate_sha_invalid", "privacyScan", "Candidate SHA must be a 40-character hexadecimal commit SHA.");
  }

  const scanDirOutsideEvidenceDir = !isInsideOrEqual(evidenceDir, scanDir);
  if (scanDirOutsideEvidenceDir) {
    addBlocker(blockers, "P0", "scan_dir_outside_evidence_dir", "privacyScan", "Scan directory must be the evidence directory or a child of it.");
  }

  const entries = scanDirOutsideEvidenceDir ? [] : collectEntries(scanDir, blockers, warnings);
  const rawSessionArtifacts: QaLabPrivacyScanFinding[] = [];
  const secretLikeEvidenceFindings: QaLabPrivacyScanFinding[] = [];
  for (const entry of entries) {
    const rawReason = rawArtifactReason(entry.absolutePath);
    if (rawReason) {
      entry.reasonCodes.push(rawReason);
      rawSessionArtifacts.push({ ref: entry.ref, reason: rawReason });
      continue;
    }
    if (!isTextEvidenceFile(entry.absolutePath)) {
      entry.reasonCodes.push("unscanned_file_type");
      addBlocker(blockers, "P1", "unscanned_file_type", "privacyScan", "Evidence contains a file type that this scanner does not inspect.");
      continue;
    }
    const privateReason = scanPrivateTextReason(entry.absolutePath, entry, blockers);
    if (privateReason) {
      entry.reasonCodes.push(privateReason);
      secretLikeEvidenceFindings.push({ ref: entry.ref, reason: privateReason });
    }
  }

  if (rawSessionArtifacts.length > 0) {
    addBlocker(blockers, "P0", "raw_session_artifact_found", "privacyScan", "Evidence contains raw session, SQLite, media, screenshot, video, or raw-log artifacts.");
  }
  if (secretLikeEvidenceFindings.length > 0) {
    addBlocker(blockers, "P0", "secret_like_evidence_found", "privacyScan", "Evidence contains secret-like, cookie-like, raw-path, or private-text values.");
  }

  const uniqueBlockers = uniqueFindings(blockers);
  const report: QaLabPrivacyScanReport = {
    schema: "lco.privacyScan.v1",
    ok: uniqueBlockers.filter((blocker) => blocker.severity !== "P3").length === 0,
    publicSafe: rawSessionArtifacts.length === 0 && secretLikeEvidenceFindings.length === 0 && !uniqueBlockers.some((blocker) => blocker.severity === "P0"),
    generatedAt: options.now ?? new Date().toISOString(),
    packageName: PACKAGE_NAME,
    packageVersion: options.packageVersion,
    candidateSha: SHA_PATTERN.test(options.candidateSha) ? options.candidateSha : null,
    scannedRootRef: scanDir === evidenceDir ? "evidence-dir" : "scan-dir",
    rawSessionArtifacts: dedupeFindings(rawSessionArtifacts),
    secretLikeEvidenceFindings: dedupeFindings(secretLikeEvidenceFindings),
    evidenceIndex: entries.map((entry) => ({
      ref: entry.ref,
      status: entry.reasonCodes.length > 0 ? "unsafe" : entry.scanned ? "safe" : "skipped",
      reasonCodes: [...new Set(entry.reasonCodes)].sort()
    })),
    blockers: uniqueBlockers,
    warnings: uniqueFindings(warnings),
    actionsPerformed: noActions(),
    privateDataExclusions: PRIVATE_DATA_EXCLUSIONS,
    proofBoundary: "Scans bounded public release evidence for private artifact classes and secret-like values. The report uses opaque evidence refs only and does not echo raw paths, filenames, tokens, cookies, prompts, transcripts, screenshots, SQLite rows, raw logs, or customer data. It does not read Codex source stores, run live Codex control, mutate a GUI, publish npm, or create a GitHub Release.",
    nextSafeCommands: nextSafeCommands(uniqueBlockers, options)
  };

  writeFileSync(join(evidenceDir, "privacy-scan.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function collectEntries(scanDir: string, blockers: QaLabPrivacyScanBlocker[], warnings: QaLabPrivacyScanBlocker[]): ScanEntry[] {
  if (!existsSync(scanDir)) {
    addBlocker(blockers, "P1", "scan_dir_missing", "privacyScan", "Scan directory does not exist.");
    return [];
  }
  const result: ScanEntry[] = [];
  const visit = (directory: string): void => {
    if (result.length >= MAX_SCAN_ENTRIES) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (result.length >= MAX_SCAN_ENTRIES) break;
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const ref = evidenceRef(scanDir, absolutePath);
        result.push({ ref, absolutePath, reasonCodes: ["symlink_not_scanned"], scanned: false });
        continue;
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      result.push({ ref: evidenceRef(scanDir, absolutePath), absolutePath, reasonCodes: [], scanned: true });
    }
  };
  visit(scanDir);
  if (result.length >= MAX_SCAN_ENTRIES) {
    addBlocker(blockers, "P2", "scan_entry_limit_exceeded", "privacyScan", "Evidence scan reached the entry limit and must be split or narrowed.");
  }
  const symlinkCount = result.filter((entry) => entry.reasonCodes.includes("symlink_not_scanned")).length;
  if (symlinkCount > 0) {
    warnings.push({ severity: "P3", code: "symlink_skipped", source: "privacyScan", detail: "One or more symlinks were skipped and reported only by opaque ref." });
  }
  return result;
}

function rawArtifactReason(path: string): string | null {
  const lower = path.toLowerCase();
  const ext = extname(lower);
  if (lower.endsWith(".jsonl") || lower.endsWith(".jsonl.gz")) return "raw_codex_jsonl";
  if (lower.endsWith(".sqlite") || lower.endsWith(".sqlite-wal") || lower.endsWith(".sqlite-shm") || lower.endsWith(".db") || lower.endsWith(".db-wal") || lower.endsWith(".db-shm")) return "sqlite_database";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic"].includes(ext)) return "screenshot_or_image";
  if ([".mp4", ".mov", ".webm", ".mkv"].includes(ext)) return "video_capture";
  if ([".log"].includes(ext)) return "raw_log_artifact";
  return null;
}

function isTextEvidenceFile(path: string): boolean {
  return [".json", ".md", ".txt"].includes(extname(path.toLowerCase()));
}

function scanPrivateTextReason(path: string, entry: ScanEntry, blockers: QaLabPrivacyScanBlocker[]): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.alloc(TEXT_SCAN_CHUNK_BYTES);
    let tail = "";
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      const text = tail + decoder.write(buffer.subarray(0, bytesRead));
      if (textHasPrivateValue(text)) return "secret_like_value";
      tail = text.slice(-TEXT_SCAN_TAIL_CHARS);
    }
    const finalText = tail + decoder.end();
    if (finalText && textHasPrivateValue(finalText)) return "secret_like_value";
  } catch {
    entry.reasonCodes.push("text_scan_failed");
    addBlocker(blockers, "P2", "text_scan_failed", "privacyScan", "A text evidence file could not be scanned.");
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close failures after the scan already produced its result.
      }
    }
  }
  return null;
}

function textHasPrivateValue(text: string): boolean {
  return SECRET_LIKE_PATTERN.test(text) || PRIVATE_VALUE_PATTERN.test(text);
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function evidenceRef(root: string, absolutePath: string): string {
  const digest = createHash("sha256").update(`${root}\0${absolutePath}`).digest("hex").slice(0, 16);
  return `evidence:file:${digest}`;
}

function addBlocker(blockers: QaLabPrivacyScanBlocker[], severity: QaLabPrivacyScanBlocker["severity"], code: string, source: string, detail: string): void {
  blockers.push({ severity, code, source, detail });
}

function dedupeFindings(findings: QaLabPrivacyScanFinding[]): QaLabPrivacyScanFinding[] {
  const seen = new Set<string>();
  const result: QaLabPrivacyScanFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.ref}:${finding.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }
  return result;
}

function uniqueFindings<T extends { severity: string; code: string; source: string }>(findings: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const finding of findings) {
    const key = `${finding.severity}:${finding.code}:${finding.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }
  return result;
}

function noActions(): QaLabPrivacyScanReport["actionsPerformed"] {
  return {
    npmPublished: false,
    githubReleaseCreated: false,
    liveCodexControlRun: false,
    desktopGuiActionRun: false,
    rawTranscriptRead: false,
    rawPromptRead: false,
    screenshotsCaptured: false,
    sourceStoreMutation: false,
    gatewayScopeApproval: false,
    broadGatewayScopeApproval: false
  };
}

function nextSafeCommands(blockers: QaLabPrivacyScanBlocker[], options: QaLabPrivacyScanOptions): string[] {
  if (blockers.length === 0) {
    return ["Use privacy-scan.json as the privacy evidence input for `loo qa-lab run` and `loo release ga-smoke`."];
  }
  return [
    `Remove private artifacts from the evidence packet, then rerun: loo qa-lab privacy-scan --evidence-dir <evidence-dir> --package-version ${options.packageVersion} --candidate-sha <candidate-sha> --strict`,
    "Keep raw transcripts, SQLite/JSONL stores, screenshots, videos, raw logs, tokens, cookies, local paths, and customer data outside public release evidence."
  ];
}
