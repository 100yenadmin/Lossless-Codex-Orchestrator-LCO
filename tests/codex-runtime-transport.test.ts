import assert from "node:assert/strict";
import test from "node:test";

import { resolveCodexRuntimeTransportConfig } from "../packages/mcp-server/src/codex-runtime-transport.js";

test("Codex runtime transport defaults to stdio and keeps app-server args there", () => {
  assert.deepEqual(resolveCodexRuntimeTransportConfig({
    HOME: "/tmp/lco-home",
    LCO_CODEX_APP_SERVER_ARGS: "app-server --stdio --listen ws://127.0.0.1:4555"
  }), {
    mode: "stdio",
    command: "codex",
    args: ["app-server", "--stdio", "--listen", "ws://127.0.0.1:4555"]
  });
});

test("Codex runtime daemon selection resolves the standard socket and ignores stdio args", () => {
  assert.deepEqual(resolveCodexRuntimeTransportConfig({
    HOME: "/tmp/lco-home",
    CODEX_HOME: "/tmp/codex-home",
    LCO_CODEX_TRANSPORT: "daemon",
    LCO_CODEX_APP_SERVER_ARGS: "must remain stdio only"
  }), {
    mode: "daemon",
    socketPath: "/tmp/codex-home/app-server-control/app-server-control.sock"
  });
});

test("Codex runtime daemon selection requires an absolute override and rejects unknown modes", () => {
  assert.throws(
    () => resolveCodexRuntimeTransportConfig({
      HOME: "/tmp/lco-home",
      LCO_CODEX_TRANSPORT: "daemon",
      LCO_CODEX_DAEMON_SOCKET: "relative/app-server.sock"
    }),
    /absolute/
  );
  assert.throws(
    () => resolveCodexRuntimeTransportConfig({
      HOME: "/tmp/lco-home",
      LCO_CODEX_TRANSPORT: "remote"
    }),
    /stdio or daemon/
  );
});
