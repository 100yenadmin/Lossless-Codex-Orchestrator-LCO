import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const CANONICAL_PACKAGE_NAME = "lossless-codex-orchestrator";
export const LEGACY_PACKAGE_NAME = "lossless-openclaw-orchestrator";
export const SUPPORTED_PACKAGE_NAMES = [
  CANONICAL_PACKAGE_NAME,
  LEGACY_PACKAGE_NAME
] as const;

export type SupportedPackageName = typeof SUPPORTED_PACKAGE_NAMES[number];

export function isSupportedPackageName(value: unknown): value is SupportedPackageName {
  return typeof value === "string" && (SUPPORTED_PACKAGE_NAMES as readonly string[]).includes(value);
}

export function findSupportedPackageRoot(start: string): string | null {
  let cursor = resolve(start);
  while (true) {
    const packageJsonPath = join(cursor, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageName = readPackageName(cursor);
      if (isSupportedPackageName(packageName)) return cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

export function readPackageName(rootDir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

export function packageNameForRoot(rootDir: string, fallback: SupportedPackageName = CANONICAL_PACKAGE_NAME): SupportedPackageName {
  const packageName = readPackageName(rootDir);
  return isSupportedPackageName(packageName) ? packageName : fallback;
}

export function readPackageVersionFromRoots(starts: string[]): string {
  for (const start of starts) {
    const packageRoot = findSupportedPackageRoot(start);
    if (!packageRoot) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string") return parsed.version;
    } catch {
      // Keep checking fallback roots.
    }
  }
  return "unknown";
}
