import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { assertTargetMethodAllowed } from "../packages/adapters/src/index.js";
import {
  CLAUDE_TARGET_METHOD_POLICY,
  claudeAvailabilityFromProbeResult,
  createClaudeCodeAdapter,
  createClaudeDryRunControl,
  probeClaudeDryRunAvailability,
  unsupportedClaudeVersionReason
} from "../packages/adapters/src/claude.js";
import { redactString } from "../packages/adapters/src/redaction.js";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function auditStub() {
  return {
    path: "memory",
    fingerprintText(value: string) {
      return value;
    },
    fingerprintValue(value: unknown) {
      return JSON.stringify(value);
    },
    append(record: any) {
      return { id: "unused", createdAt: new Date().toISOString(), ...record };
    },
    find() {
      return null;
    }
  };
}

test("Claude adapter boundary inventory exists without claiming parity", () => {
  assert.equal(existsSync("docs/CLAUDE_ADAPTER_BOUNDARY.md"), true, "Claude boundary inventory doc must exist");
  const boundary = read("docs/CLAUDE_ADAPTER_BOUNDARY.md");
  const vision = read("VISION.md");

  assert.match(boundary, /#163/);
  assert.match(boundary, /#166/);
  assert.match(boundary, /#707/);
  assert.match(boundary, /#710/);
  assert.match(boundary, /#737/);
  assert.match(boundary, /indexClaudeSessionInventory/);
  assert.match(boundary, /indexClaudeSessions/);
  assert.match(boundary, /lco index claude/);
  assert.match(boundary, /claude_session:\*/);
  assert.match(boundary, /metadata-only fixture inventory is proven/i);
  assert.match(boundary, /local Claude Code JSONL read\/recall/i);
  assert.match(boundary, /read-only session inventory/i);
  assert.match(boundary, /first adapter proof step/i);
  assert.match(boundary, /storage path/i);
  assert.match(boundary, /control surface/i);
  assert.match(boundary, /https:\/\/docs\.anthropic\.com\/en\/docs\/claude-code\/settings/);
  assert.match(boundary, /https:\/\/docs\.anthropic\.com\/en\/docs\/claude-code\/cli-reference/);
  assert.match(boundary, /https:\/\/docs\.anthropic\.com\/en\/docs\/claude-code\/mcp/);
  assert.match(boundary, /https:\/\/docs\.anthropic\.com\/en\/docs\/claude-code\/hooks/);
  assert.match(boundary, /Claude live control, settings mutation, GUI\s+mutation, cloud sync, and adapter parity remain future adapter work/i);
  assert.match(boundary, /Claude-native dry-run TargetAdapter validation/i);
  assert.match(boundary, /dry_run_only/i);
  assert.match(boundary, /not_configured/i);
  assert.match(boundary, /unsupported/i);
  assert.doesNotMatch(boundary, /full Claude Code parity|control Claude Code remotely|unattended Claude takeover/i);

  const readme = read("README.md");
  const openclawPlugin = read("docs/OPENCLAW_PLUGIN.md");
  assert.doesNotMatch(readme, /CLAUDE_ADAPTER_BOUNDARY\.md|Early adapter research|Claude Code support is an adapter stub|full Claude Code parity|cloud sync/i);
  assert.match(openclawPlugin, /Claude Code dry-run adapter validation/i);
  assert.match(openclawPlugin, /dry-run only/i);
  assert.match(vision, /CLAUDE_ADAPTER_BOUNDARY\.md/);
  assert.match(vision, /Claude read\/recall separate from parity/i);
});

test("Claude adapter stub exposes proof boundary metadata", () => {
  const adapter = createClaudeCodeAdapter();

  assert.equal(adapter.status, "proof-boundary-inventory");
  assert.equal(adapter.parity, false);
  assert.equal(adapter.liveControlProven, false);
  assert.equal(adapter.firstProofStep, "read-only-session-inventory");
  assert.deepEqual(adapter.forbiddenClaims, [
    "Claude Code indexing parity",
    "Claude Code live control",
    "Claude Code GUI mutation",
    "cloud sync"
  ]);
});

test("Claude dry-run adapter uses TargetAdapter policy without live control", async () => {
  let auditRecord: any = null;
  const control = createClaudeDryRunControl({
    availability: {
      available: true,
      command: "claude",
      version: "Claude Code 1.0.0",
      error: null
    },
    audit: {
      path: "memory",
      fingerprintText(value) {
        return `claude-text-${value.length}`;
      },
      fingerprintValue(value) {
        return `claude-params-${JSON.stringify(value)}`;
      },
      append(record) {
        auditRecord = { id: "loo_audit_claude", createdAt: new Date().toISOString(), ...record };
        return auditRecord;
      },
      find(id) {
        return auditRecord?.id === id ? auditRecord : null;
      }
    }
  });

  const status = control.status();
  assert.equal(status.state, "dry_run_only");
  assert.equal(status.target, "claude_code");
  assert.equal(status.liveControlProven, false);
  assert.deepEqual(status.actionsPerformed, {
    liveClaudeControlRun: false,
    guiMutationRun: false,
    settingsMutationRun: false
  });
  assert.deepEqual(status.methodPolicy.controlMethods, ["claude/print/resume"]);
  assert.doesNotThrow(() => assertTargetMethodAllowed(CLAUDE_TARGET_METHOD_POLICY, "claude/print/resume", "control"));
  assert.throws(() => assertTargetMethodAllowed(CLAUDE_TARGET_METHOD_POLICY, "claude/settings/write", "control"), /forbidden/);

  const dryRun = await control.resumePrompt({
    sessionId: "claude-session-1",
    prompt: "Summarize the current branch status."
  });

  assert.equal(dryRun.live, false);
  assert.equal(dryRun.threadId, "claude_session:claude-session-1");
  assert.equal(dryRun.action, "claude_resume_prompt");
  assert.equal(dryRun.method, "claude/print/resume");
  assert.deepEqual(dryRun.methodSequence, ["claude/print/resume"]);
  assert.equal(dryRun.approvalAuditId, "loo_audit_claude");
  assert.match(dryRun.proofState.callerInstruction, /Claude Code dry-run only/i);

  await assert.rejects(
    () => control.resumePrompt({
      sessionId: "claude-session-1",
      prompt: "This must not execute.",
      dryRun: false,
      approvalAuditId: dryRun.approvalAuditId
    }),
    /Claude Code control is dry-run only/
  );
});

test("Claude dry-run status reports not_configured and redacts local diagnostics", () => {
  const control = createClaudeDryRunControl({
    availability: {
      available: false,
      command: "claude",
      version: null,
      error: "missing /Users/lume/.claude/private-config with sk-test_1234567890abcdef"
    },
    audit: {
      path: "memory",
      fingerprintText(value) {
        return value;
      },
      fingerprintValue(value) {
        return JSON.stringify(value);
      },
      append(record) {
        return { id: "unused", createdAt: new Date().toISOString(), ...record };
      },
      find() {
        return null;
      }
    }
  });

  const status = control.status();
  assert.equal(status.state, "not_configured");
  assert.equal(status.command.available, false);
  assert.equal(status.command.error, "missing ~/.claude/private-config with <redacted-secret>");
  assert.doesNotMatch(JSON.stringify(status), /\/Users\/lume|sk-test_/);
});

test("Claude dry-run status does not probe the external CLI unless explicitly injected", () => {
  const control = createClaudeDryRunControl({ audit: auditStub() });

  const status = control.status();
  assert.equal(status.state, "not_configured");
  assert.equal(status.command.available, false);
  assert.equal(status.command.error, "Claude availability probe was not requested.");
  assert.match(status.nextSafeAction, /install|configure/i);
});

test("Claude diagnostics redact Linux mixed-case Windows forward-slash and UNC home paths", () => {
  const redacted = redactString([
    "linux /home/alice/private",
    "windows c:\\users\\bob\\private",
    "forward C:/Users/carol/private",
    "unc \\\\server\\Users\\dave\\private"
  ].join(" | "));

  assert.doesNotMatch(redacted, /alice|bob|carol|dave/);
  assert.doesNotMatch(redacted, /\/home\/|[A-Za-z]:[\\/]users[\\/]|\\\\server\\Users\\/i);
  assert.equal((redacted.match(/~/g) ?? []).length, 4);
});

test("Claude availability probe refuses non-allowlisted commands before reporting readiness", () => {
  const availability = probeClaudeDryRunAvailability("/bin/echo");

  assert.equal(availability.available, false);
  assert.equal(availability.command, "claude");
  assert.match(availability.unsupportedReason ?? "", /only the claude cli command/i);
  assert.doesNotMatch(JSON.stringify(availability), /\/bin\/echo/);
});

test("Claude version parser classifies old and unparseable CLI versions as unsupported", () => {
  assert.match(unsupportedClaudeVersionReason("0.1.0") ?? "", /below minimum/i);
  assert.match(unsupportedClaudeVersionReason("Claude Code 0.9.9") ?? "", /below minimum/i);
  assert.equal(unsupportedClaudeVersionReason("Claude Code 1.2.3"), null);
  assert.equal(unsupportedClaudeVersionReason("1.0.0"), null);
  assert.match(unsupportedClaudeVersionReason("not a semver") ?? "", /could not be parsed/i);
});

test("Claude probe result classification covers missing binary nonzero and unsupported versions", () => {
  const missing = claudeAvailabilityFromProbeResult({
    error: new Error("spawn claude ENOENT /Users/lume/private"),
    status: null,
    stdout: "",
    stderr: ""
  });
  assert.equal(missing.available, false);
  assert.equal(missing.version, null);
  assert.match(missing.error ?? "", /ENOENT/);

  const nonzero = claudeAvailabilityFromProbeResult({
    error: undefined,
    status: 1,
    stdout: "",
    stderr: "permission denied"
  });
  assert.equal(nonzero.available, false);
  assert.match(nonzero.error ?? "", /permission denied/);

  const oldVersion = claudeAvailabilityFromProbeResult({
    error: undefined,
    status: 0,
    stdout: "Claude Code 0.2.0\n",
    stderr: ""
  });
  assert.equal(oldVersion.available, true);
  assert.match(oldVersion.unsupportedReason ?? "", /below minimum/i);

  const unknownVersion = claudeAvailabilityFromProbeResult({
    error: undefined,
    status: 0,
    stdout: "Claude Code dev-build\n",
    stderr: ""
  });
  assert.equal(unknownVersion.available, true);
  assert.match(unknownVersion.unsupportedReason ?? "", /could not be parsed/i);
});

test("Claude dry-run control construction is side-effect-free and lazy-caches availability", () => {
  let probeCount = 0;
  const control = createClaudeDryRunControl({
    audit: auditStub(),
    probeAvailability() {
      probeCount += 1;
      return {
        available: false,
        command: "claude",
        version: null,
        error: "spawn claude ENOENT /Users/lume/private"
      };
    }
  });

  assert.equal(probeCount, 0);
  const firstStatus = control.status();
  assert.equal(probeCount, 1);
  assert.equal(firstStatus.state, "not_configured");
  assert.equal(firstStatus.command.error, "spawn claude ENOENT ~/private");
  assert.doesNotMatch(JSON.stringify(firstStatus), /\/Users\/lume/);
  const secondStatus = control.status();
  assert.equal(probeCount, 1);
  assert.deepEqual(secondStatus.command, firstStatus.command);
});

test("Claude dry-run status reports unsupported and redacts all diagnostics", () => {
  const control = createClaudeDryRunControl({
    availability: {
      available: true,
      command: "claude",
      version: "Claude Code 0.1.0 from /Users/lume/bin with sk-test_1234567890abcdef",
      error: null,
      unsupportedReason: "Claude CLI from C:\\Users\\lume\\bin is below minimum with sk-test_abcdef1234567890"
    },
    audit: {
      path: "memory",
      fingerprintText(value) {
        return value;
      },
      fingerprintValue(value) {
        return JSON.stringify(value);
      },
      append(record) {
        return { id: "unused", createdAt: new Date().toISOString(), ...record };
      },
      find() {
        return null;
      }
    }
  });

  const status = control.status();
  assert.equal(status.state, "unsupported");
  assert.equal(status.command.available, true);
  assert.match(status.command.version ?? "", /Claude Code 0\.1\.0/);
  assert.match(status.command.unsupportedReason ?? "", /below minimum/);
  assert.match(status.nextSafeAction, /upgrade|install|configure/i);
  assert.doesNotMatch(status.nextSafeAction, /resumePrompt/i);
  assert.doesNotMatch(JSON.stringify(status), /\/Users\/lume|C:\\Users\\lume|sk-test_/);
});

test("Claude dry-run resume fails closed for invalid session ids", async () => {
  const control = createClaudeDryRunControl({
    availability: {
      available: true,
      command: "claude",
      version: "Claude Code 1.0.0",
      error: null
    },
    audit: {
      path: "memory",
      fingerprintText(value) {
        return value;
      },
      fingerprintValue(value) {
        return JSON.stringify(value);
      },
      append(record) {
        return { id: "unused", createdAt: new Date().toISOString(), ...record };
      },
      find() {
        return null;
      }
    }
  });

  await assert.rejects(
    () => control.resumePrompt({
      sessionId: "../../private session",
      prompt: "This should not produce an audit packet.",
      dryRun: true
    }),
    /Invalid Claude session id/
  );
});
