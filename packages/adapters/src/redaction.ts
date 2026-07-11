import { homedir } from "node:os";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{10,}/g, "<redacted-secret>"],
  [/(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, "$1<redacted-secret>"],
  [/(Basic\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1<redacted-secret>"],
  [/(\bauthorization\s*:\s*)[^\r\n]+/gi, "$1<redacted-secret>"]
];

const GENERIC_HOME_PATTERN = /\/Users\/[^/\s]+/g;
const CLAUDE_UNIX_HOME_PATTERN = /(?:\/(?:Users|home)\/[^/\s]+|\/root(?=\/|\s|$))/gi;
const CLAUDE_WINDOWS_HOME_PATTERN = /(?:[A-Za-z]:|\\\\[^\\/\s]+)[\\/](?:Users|Profiles|home)[\\/][^\\/\s]+/gi;
const CLAUDE_FILE_URI_PATTERN = /\bfile:\/\/[^"'\r\n()<>{}\[\],;|]+/gi;
const CLAUDE_POSIX_ABSOLUTE_PATH_PATTERN = /(?<![\/~])\/(?!\/)[^"'\r\n()<>{}\[\],;|:]+/g;
const CLAUDE_WINDOWS_ABSOLUTE_PATH_PATTERN = /(?:\b[A-Za-z]:|\\\\[^\\/\r\n"'<>|]+)[\\/][^"'\r\n<>|,;)\]}]+/g;

export function redactString(value: string): string {
  let redacted = value.replaceAll(homedir(), "~");
  redacted = redacted.replace(GENERIC_HOME_PATTERN, "~");
  for (const [pattern, replacement] of SECRET_PATTERNS) {
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
