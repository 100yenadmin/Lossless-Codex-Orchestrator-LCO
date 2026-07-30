import { isAbsolute, join } from "node:path";

import {
  assertCodexMethodAllowed,
  createCodexAppServerDaemonClient,
  createCodexAppServerStdioClient,
  resolveCodexDaemonSocketPath,
  type CodexClient
} from "../../adapters/src/index.js";
import { readEnv, readEnvWithFallback, resolveHomeDir, type LcoEnv } from "../../runtime/src/env.js";

export type CodexRuntimeTransportConfig =
  | { mode: "stdio"; command: string; args: string[] }
  | { mode: "daemon"; socketPath: string };

export function resolveCodexRuntimeTransportConfig(env: LcoEnv = process.env): CodexRuntimeTransportConfig {
  const mode = readEnv("CODEX_TRANSPORT", env) ?? "stdio";
  if (mode === "stdio") {
    return {
      mode,
      command: readEnvWithFallback("CODEX_BIN", "codex", env),
      args: (readEnv("CODEX_APP_SERVER_ARGS", env) || "app-server --stdio").split(/\s+/).filter(Boolean)
    };
  }
  if (mode !== "daemon") {
    throw new Error("LCO_CODEX_TRANSPORT must be stdio or daemon");
  }

  const override = readEnv("CODEX_DAEMON_SOCKET", env);
  if (override && !isAbsolute(override)) {
    throw new Error("LCO_CODEX_DAEMON_SOCKET must be an absolute Unix socket path");
  }
  const codexHome = env.CODEX_HOME?.trim() || join(resolveHomeDir(env), ".codex");
  return {
    mode,
    socketPath: override ?? resolveCodexDaemonSocketPath(codexHome)
  };
}

export function createConfiguredCodexClients(
  env: LcoEnv = process.env
): { mode: "stdio" | "daemon"; control: CodexClient; read: CodexClient } {
  const config = resolveCodexRuntimeTransportConfig(env);
  if (config.mode === "daemon") {
    const sharedClient = createCodexAppServerDaemonClient({
      socketPath: config.socketPath,
      surface: "control"
    });
    return {
      mode: config.mode,
      control: sharedClient,
      read: {
        async request(method, params) {
          assertCodexMethodAllowed(method, "read");
          return sharedClient.request(method, params);
        }
      }
    };
  }
  return {
    mode: config.mode,
    control: createCodexAppServerStdioClient({
      command: config.command,
      args: config.args,
      surface: "control"
    }),
    read: createCodexAppServerStdioClient({
      command: config.command,
      args: config.args,
      surface: "read"
    })
  };
}
