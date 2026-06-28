import { homedir } from "node:os";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{10,}/g, "<redacted-secret>"],
  [/(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, "$1<redacted-secret>"],
  [/(authorization:\s*)[^\s]+/gi, "$1<redacted-secret>"]
];

const GENERIC_HOME_PATTERN = /\/Users\/[^/\s]+/g;

export function redactString(value: string): string {
  let redacted = value.replaceAll(homedir(), "~");
  redacted = redacted.replace(GENERIC_HOME_PATTERN, "~");
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
  }
  return value;
}
