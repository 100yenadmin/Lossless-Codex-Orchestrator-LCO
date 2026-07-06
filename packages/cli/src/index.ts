#!/usr/bin/env node
import { assertSupportedNodeVersion } from "../../runtime/src/node-version-guard.js";

assertSupportedNodeVersion(process.versions.node);

await import("./main.js");
