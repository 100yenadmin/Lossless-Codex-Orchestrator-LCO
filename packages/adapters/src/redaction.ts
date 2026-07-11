import { homedir } from "node:os";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{10,}/g, "<redacted-secret>"],
  [/(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, "$1<redacted-secret>"],
  [/(Basic\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1<redacted-secret>"],
  [/(\bauthorization\s*:\s*)[^\r\n]+/gi, "$1<redacted-secret>"]
];

const DIAGNOSTIC_SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<redacted-secret>"],
  [/\bnpm_[A-Za-z0-9_]{20,}\b/g, "<redacted-secret>"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<redacted-secret>"],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "<redacted-secret>"],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "<redacted-secret>"],
  [/(\baws_secret_access_key\s*[=:]\s*)[A-Za-z0-9/+]{32,}/gi, "$1<redacted-secret>"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, "<redacted-secret>"],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/g, "<redacted-secret>"],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "<redacted-secret>"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "<redacted-secret>"],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1<redacted-secret>@"]
];

const DIAGNOSTIC_LOCAL_PATH_PATTERN = /(?:~\/|\/(?:Volumes|Users|home|root|private|tmp|workspace|workspaces|mnt|data|opt|srv|etc)\/|\/var\/folders\/)[^\s"',)\]}]+/g;
const DIAGNOSTIC_WINDOWS_PATH_PATTERN = /[A-Za-z]:\\[^\s"',)\]}]+/g;

const GENERIC_HOME_PATTERN = /\/Users\/[^/\s]+/g;
const CLAUDE_UNIX_HOME_PATTERN = /(?:\/(?:Users|home)\/[^/\s]+|\/root(?=\/|\s|$))/gi;
const CLAUDE_WINDOWS_HOME_PATTERN = /(?:[A-Za-z]:|\\\\[^\\/\s]+)[\\/](?:Users|Profiles|home)[\\/][^\\/\s]+/gi;
const CLAUDE_FILE_URI_PATTERN = /\bfile:\/\/[^\r\n]+/gi;
const CLAUDE_POSIX_NETWORK_PATH_PATTERN = /\/\/[^\r\n]+/g;
const CLAUDE_POSIX_ABSOLUTE_PATH_PATTERN = /(?<![\/~])\/(?!\/)[^\r\n]+/g;
const CLAUDE_WINDOWS_ABSOLUTE_PATH_PATTERN = /(?:\b[A-Za-z]:|\\\\[^\\/\r\n]+)[\\/][^\r\n]+/g;

export function redactString(value: string): string {
  let redacted = value.replaceAll(homedir(), "~");
  redacted = redacted.replace(GENERIC_HOME_PATTERN, "~");
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function redactDiagnosticString(value: string): string {
  let redacted = redactString(value)
    .replace(DIAGNOSTIC_LOCAL_PATH_PATTERN, "<redacted-local-path>")
    .replace(DIAGNOSTIC_WINDOWS_PATH_PATTERN, "<redacted-local-path>");
  for (const [pattern, replacement] of DIAGNOSTIC_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function redactClaudeString(value: string): string {
  let redacted = redactString(value);
  redacted = redacted.replace(CLAUDE_FILE_URI_PATTERN, "<redacted-path>");
  redacted = redacted.replace(CLAUDE_WINDOWS_HOME_PATTERN, "~");
  redacted = redacted.replace(CLAUDE_UNIX_HOME_PATTERN, "~");
  const protectedHomePaths: string[] = [];
  redacted = redacted.replace(/~(?:\/[^\s|,;)\]}]+)*/g, (homePath) => {
    const marker = `__LCO_CLAUDE_HOME_${protectedHomePaths.length}__`;
    protectedHomePaths.push(homePath);
    return marker;
  });
  redacted = redacted.replace(CLAUDE_WINDOWS_ABSOLUTE_PATH_PATTERN, "<redacted-path>");
  redacted = redacted.replace(CLAUDE_POSIX_NETWORK_PATH_PATTERN, "<redacted-path>");
  redacted = redacted.replace(CLAUDE_POSIX_ABSOLUTE_PATH_PATTERN, "<redacted-path>");
  for (const [index, homePath] of protectedHomePaths.entries()) {
    redacted = redacted.replaceAll(`__LCO_CLAUDE_HOME_${index}__`, homePath);
  }
  return redacted;
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      isAuthorizationKey(key) ? "<redacted-secret>" : redactValue(item)
    ]));
  }
  return value;
}

export function redactClaudeValue(value: unknown): unknown {
  if (typeof value === "string") return redactClaudeString(value);
  if (Array.isArray(value)) return value.map((item) => redactClaudeValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      isAuthorizationKey(key) ? "<redacted-secret>" : redactClaudeValue(item)
    ]));
  }
  return value;
}

function isAuthorizationKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "authorization" || normalized === "proxy-authorization";
}
