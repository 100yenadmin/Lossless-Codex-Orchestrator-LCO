export const MINIMUM_NODE_VERSION = "22.5.0";

type VersionParts = {
  major: number;
  minor: number;
  patch: number;
};

export function nodeVersionMeetsMinimum(current: string, minimum = MINIMUM_NODE_VERSION): boolean {
  const currentParts = parseNodeVersion(current);
  const minimumParts = parseNodeVersion(minimum);
  if (!currentParts || !minimumParts) return false;
  if (currentParts.major !== minimumParts.major) return currentParts.major > minimumParts.major;
  if (currentParts.minor !== minimumParts.minor) return currentParts.minor > minimumParts.minor;
  return currentParts.patch >= minimumParts.patch;
}

export function assertSupportedNodeVersion(current: string): void {
  if (nodeVersionMeetsMinimum(current)) return;
  process.stderr.write(formatUnsupportedNodeVersion(current));
  process.exit(1);
}

export function formatUnsupportedNodeVersion(current: string): string {
  const normalized = current.trim().replace(/^v/, "");
  const currentDescription = parseNodeVersion(current)
    ? `you have v${normalized}`
    : `could not parse current Node version ${JSON.stringify(current)}`;
  return `Node >=${MINIMUM_NODE_VERSION} required, ${currentDescription}\n`;
}

function parseNodeVersion(version: string): VersionParts | null {
  const match = version.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}
