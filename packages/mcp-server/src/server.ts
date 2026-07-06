#!/usr/bin/env node
import { assertSupportedNodeVersion } from "../../runtime/src/node-version-guard.js";

assertSupportedNodeVersion(process.versions.node);

try {
  await import("./server-runtime.js");
} catch {
  process.stderr.write("LCO MCP server failed to load its runtime module after the Node version check. Reinstall the package or run npm run check from the repo, then restart the MCP server.\n");
  process.exit(1);
}
