#!/usr/bin/env node
import { assertSupportedNodeVersion } from "../../runtime/src/node-version-guard.js";

assertSupportedNodeVersion(process.versions.node);

try {
  await import("./server-runtime.js");
} catch {
  process.stderr.write("LCO MCP server runtime failed to load. Reinstall the package or run from a complete checkout, then restart the MCP server.\n");
  process.exit(1);
}
