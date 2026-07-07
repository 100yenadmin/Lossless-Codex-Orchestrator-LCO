import { CANONICAL_PACKAGE_NAME } from "./package-identity.js";

export { CANONICAL_PACKAGE_NAME, LEGACY_PACKAGE_NAME, SUPPORTED_PACKAGE_NAMES } from "./package-identity.js";

export const PACKAGE_NAME = CANONICAL_PACKAGE_NAME;

export type DistTag = "beta" | "next" | "latest";
export type RegistryMatchStatus = `matches_registry_${DistTag}`;
export type RegistryMismatchStatus = `registry_${DistTag}_mismatch`;
export type RegistryVersionMatchStatus = "not_run" | RegistryMatchStatus | RegistryMismatchStatus;

export function distTagForVersion(version: string): DistTag {
  if (/-rc(?:\.|-|$)/i.test(version)) return "next";
  if (/-beta(?:\.|-|$)/i.test(version)) return "beta";
  return "latest";
}

export function matchingRegistryStatus(distTag: DistTag): RegistryMatchStatus {
  return `matches_registry_${distTag}`;
}

export function mismatchedRegistryStatus(distTag: DistTag): RegistryMismatchStatus {
  return `registry_${distTag}_mismatch`;
}

export function registryStatusMatchesDistTag(value: unknown, distTag: DistTag): boolean {
  return value === matchingRegistryStatus(distTag);
}
