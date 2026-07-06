import { homedir } from "node:os";

export type LcoEnv = Record<string, string | undefined>;

export function readEnv(name: string, env: LcoEnv = process.env): string | undefined {
  const suffix = envSuffix(name);
  return firstNonEmpty(env[`LCO_${suffix}`], env[`LOO_${suffix}`]);
}

export function readEnvWithFallback(name: string, fallback: string, env: LcoEnv = process.env): string {
  return readEnv(name, env) ?? fallback;
}

export function resolveHomeDir(env: LcoEnv = process.env, osHome = homedir()): string {
  return firstNonEmpty(env.HOME, env.USERPROFILE, osHome) ?? ".";
}

function envSuffix(name: string): string {
  const trimmed = name.trim();
  return trimmed.replace(/^(?:LCO|LOO)_/, "");
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
