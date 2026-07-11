import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertTargetMethodAllowed } from "../packages/adapters/src/index.js";
import * as claudeAdapter from "../packages/adapters/src/claude.js";
import {
  CLAUDE_TARGET_METHOD_POLICY,
  claudeAvailabilityFromProbeResult,
  claudeProbeTreeTerminationInvocation,
  claudeVersionProbeInvocation,
  createClaudeCodeAdapter,
  createClaudeDryRunControl,
  disposeClaudeProbeTreeKiller,
  probeClaudeDryRunAvailability,
  unsupportedClaudeVersionReason
} from "../packages/adapters/src/claude.js";
import { redactClaudeString } from "../packages/adapters/src/redaction.js";

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
  assert.match(boundary, /caller-trusted PATH on every platform/i);
  assert.match(boundary, /does not pin the Claude executable/i);
  assert.match(boundary, /asynchronous subprocess/i);
  assert.match(boundary, /independent hard deadline/i);
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
        return createHash("sha256").update(value).digest("hex");
      },
      fingerprintValue(value) {
        return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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
  assert.equal(dryRun.proofState.status, "dry_run");
  assert.equal(dryRun.threadId, "claude_session:claude-session-1");
  assert.equal(dryRun.action, "claude_resume_prompt");
  assert.equal(dryRun.method, "claude/print/resume");
  assert.deepEqual(dryRun.methodSequence, ["claude/print/resume"]);
  assert.equal(dryRun.approvalAuditId, "loo_audit_claude");
  assert.match(dryRun.proofState.callerInstruction, /Claude Code dry-run only/i);
  assert.doesNotMatch(auditRecord.paramsHash, /Summarize|claude-session-1/);
  assert.doesNotMatch(auditRecord.messageHash, /Summarize|claude-session-1/);

  await assert.rejects(
    () => control.resumePrompt({
      sessionId: "claude-session-1",
      prompt: "This must not execute.",
      dryRun: false,
      approvalAuditId: dryRun.approvalAuditId
    }),
    /Claude Code control is dry-run only/
  );

  await assert.rejects(
    () => control.resumePrompt({
      sessionId: "claude-session-1",
      prompt: "Mint a new dry-run packet.",
      dryRun: true,
      approvalAuditId: dryRun.approvalAuditId
    }),
    /approvalAuditId is not accepted/i
  );

  await assert.rejects(
    () => control.resumePrompt({
      sessionId: "claude-session-1",
      prompt: "Invalid runtime dry-run value.",
      dryRun: 0
    } as never),
    /dryRun must be true or omitted/i
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

test("Claude dry-run status keeps unavailable ahead of a stale unsupported reason", () => {
  const control = createClaudeDryRunControl({
    availability: {
      available: false,
      command: "claude",
      version: null,
      error: "Claude CLI was not found.",
      unsupportedReason: "stale unsupported-version detail"
    },
    audit: auditStub()
  });
  assert.equal(control.status().state, "not_configured");
});

test("Claude dry-run control rejects the removed synchronous probe callback without invoking it", () => {
  let probeCount = 0;
  const legacyOptions = {
    audit: auditStub(),
    probeAvailability() {
      probeCount += 1;
      throw new Error("constructor must not execute a synchronous CLI probe");
    }
  } as unknown as Parameters<typeof createClaudeDryRunControl>[0];

  assert.throws(
    () => createClaudeDryRunControl(legacyOptions),
    /probeAvailability is no longer supported/i
  );
  assert.equal(probeCount, 0);
});

test("Claude dry-run status reports not_configured when availability is omitted", () => {
  const control = createClaudeDryRunControl({ audit: auditStub() });

  const status = control.status();
  assert.equal(status.state, "not_configured");
  assert.equal(status.command.available, false);
  assert.equal(status.command.error, "Claude availability probe was not requested.");
  assert.match(status.nextSafeAction, /install|configure/i);
});

test("Claude diagnostics redact Unix Users Profiles drive-home and UNC profile paths", () => {
  const redacted = redactClaudeString([
    "linux /home/alice/private",
    "windows c:\\users\\bob\\private",
    "forward C:/Users/carol/private",
    "unc \\\\server\\Users\\dave\\private",
    "profiles D:\\Profiles\\erin\\private",
    "drive home E:/home/frank/private",
    "unc profiles \\\\server\\Profiles\\grace\\private",
    "root /root/.claude/private",
    "mixed /HoMe/heidi/private"
  ].join(" | "));

  assert.doesNotMatch(redacted, /alice|bob|carol|dave|erin|frank|grace|heidi|\/root/);
  assert.doesNotMatch(redacted, /\/home\/|[A-Za-z]:[\\/](?:users|profiles|home)[\\/]|\\\\server\\(?:Users|Profiles)\\/i);
  assert.equal((redacted.match(/~/g) ?? []).length, 9);
  for (const singleComponentPath of ["/private", "/secret", "/tmp"]) {
    assert.doesNotMatch(redactClaudeString(`failed at ${singleComponentPath}`), new RegExp(singleComponentPath));
  }
});

test("Claude dry-run packet minting rejects not-configured and unsupported states", async () => {
  for (const availability of [
    {
      available: false,
      command: "claude",
      version: null,
      error: "Claude CLI is missing."
    },
    {
      available: true,
      command: "claude",
      version: "Claude Code 0.9.0",
      error: null,
      unsupportedReason: "Claude CLI version is below minimum supported 1.0.0 for dry-run validation."
    }
  ]) {
    const control = createClaudeDryRunControl({ audit: auditStub(), availability });
    await assert.rejects(
      () => control.resumePrompt({ sessionId: "claude-session-1", prompt: "Do not mint a packet." }),
      /dry-run packet is unavailable while status is (?:not_configured|unsupported)/i
    );
  }
});

test("Claude availability probe is asynchronous and refuses non-allowlisted commands", async () => {
  const pendingAvailability = probeClaudeDryRunAvailability("/bin/echo");
  assert.equal(pendingAvailability instanceof Promise, true);
  const availability = await pendingAvailability;

  assert.equal(availability.available, false);
  assert.equal(availability.command, "claude");
  assert.equal(availability.unsupportedReason ?? null, null);
  assert.match(availability.error ?? "", /only the claude cli command/i);
  assert.equal(createClaudeDryRunControl({ audit: auditStub(), availability }).status().state, "not_configured");
  assert.doesNotMatch(JSON.stringify(availability), /\/bin\/echo/);
});

test("Claude availability probe kills a timeout-resistant CLI within its bound", async () => {
  if (process.platform === "win32") return;
  const root = mkdtempSync(join(tmpdir(), "lco-claude-probe-timeout-"));
  const fakeClaude = join(root, "claude");
  writeFileSync(fakeClaude, [
    `#!${process.execPath}`,
    "const { spawn } = require('node:child_process');",
    "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });",
    "process.on('SIGTERM', () => {});",
    "setInterval(() => {}, 1000);"
  ].join("\n"));
  chmodSync(fakeClaude, 0o755);
  try {
    const startedAt = Date.now();
    const availability = await probeClaudeDryRunAvailability("claude", { trustedPath: root });
    assert.ok(Date.now() - startedAt < 4_000);
    assert.equal(availability.available, false);
    assert.match(availability.error ?? "", /timed out/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude availability probe fails closed when version output exceeds its bound", async () => {
  if (process.platform === "win32") return;
  const root = mkdtempSync(join(tmpdir(), "lco-claude-probe-output-"));
  const fakeClaude = join(root, "claude");
  writeFileSync(fakeClaude, [
    `#!${process.execPath}`,
    "process.stdout.write('Claude Code 1.2.3\\n' + 'x'.repeat(70 * 1024));"
  ].join("\n"));
  chmodSync(fakeClaude, 0o755);
  try {
    const availability = await probeClaudeDryRunAvailability("claude", { trustedPath: root });
    assert.equal(availability.available, false);
    assert.match(availability.error ?? "", /output.*limit/i);
    assert.equal(createClaudeDryRunControl({ audit: auditStub(), availability }).status().state, "not_configured");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude availability probe resolves the fixed command through cmd.exe on Windows", () => {
  assert.deepEqual(claudeVersionProbeInvocation("win32", "D:\\Windows"), {
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", "claude --version"],
    cwd: "C:\\Windows\\System32"
  });
  assert.deepEqual(claudeVersionProbeInvocation("darwin"), {
    command: "claude",
    args: ["--version"],
    cwd: undefined
  });
  const windows = claudeVersionProbeInvocation("win32", "C:\\Windows");
  assert.match(windows.command, /^[A-Za-z]:\\Windows\\System32\\cmd\.exe$/i);
  assert.equal(windows.cwd, "C:\\Windows\\System32");
  assert.doesNotMatch(`${windows.command} ${windows.cwd}`, /checkout|worktree|repo/i);
  assert.deepEqual(claudeProbeTreeTerminationInvocation("win32", 4242, "D:\\Windows"), {
    command: "C:\\Windows\\System32\\taskkill.exe",
    args: ["/PID", "4242", "/T", "/F"],
    cwd: "C:\\Windows\\System32"
  });
  for (const hostileRoot of ["\\\\evil\\share\\Windows", "C:\\attacker-controlled", "D:\\Windows"]) {
    assert.equal(claudeVersionProbeInvocation("win32", hostileRoot).command, "C:\\Windows\\System32\\cmd.exe");
    assert.equal(claudeProbeTreeTerminationInvocation("win32", 4242, hostileRoot)?.command, "C:\\Windows\\System32\\taskkill.exe");
  }
  const source = read("packages/adapters/src/claude.ts");
  const systemRootBlock = source.slice(source.indexOf("function safeWindowsSystemRoot"), source.indexOf("export function claudeAvailabilityFromProbeResult"));
  assert.doesNotMatch(systemRootBlock, /\?\s*"C:\\\\Windows"\s*:\s*"C:\\\\Windows"/);
  assert.equal(claudeProbeTreeTerminationInvocation("darwin", 4242), null);
});

test("Claude probe tree-killer cleanup safely absorbs an asynchronous spawn failure", async () => {
  const missingKiller = spawn(join(tmpdir(), "lco-definitely-missing-tree-killer"), [], {
    stdio: "ignore"
  });
  disposeClaudeProbeTreeKiller(missingKiller);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(missingKiller.pid, undefined);
});

test("Claude probe tree-killer monitor preserves the helper until completion", async () => {
  const monitor = (claudeAdapter as typeof claudeAdapter & {
    monitorClaudeProbeTreeKiller?: (
      helper: ReturnType<typeof spawn>,
      onComplete: () => void,
      cleanupMs: number
    ) => void;
  }).monitorClaudeProbeTreeKiller;
  assert.equal(typeof monitor, "function");
  const helper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1_000)"], { stdio: "ignore" });
  let completions = 0;
  monitor!(helper, () => { completions += 1; }, 100);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(helper.killed, false);
  assert.equal(completions, 0);
  helper.kill("SIGTERM");
  await new Promise<void>((resolve) => helper.once("close", () => resolve()));
  assert.equal(completions, 1);
});

test("Claude probe settlement does not cut short an active tree killer", () => {
  const source = read("packages/adapters/src/claude.ts");
  const settleBlock = source.slice(source.indexOf("const settle ="), source.indexOf("const terminateTree ="));
  assert.doesNotMatch(settleBlock, /disposeClaudeProbeTreeKiller/);
  const hardDeadlineBlock = source.slice(source.indexOf("hardDeadline = setTimeout"), source.indexOf("child.once(\"close\""));
  assert.match(hardDeadlineBlock, /if \(!treeKiller\) child\.kill\("SIGKILL"\)/);
});

test("Claude version parser accepts semver metadata and rejects old or unparseable versions", () => {
  assert.match(unsupportedClaudeVersionReason("0.1.0") ?? "", /below minimum/i);
  assert.match(unsupportedClaudeVersionReason("Claude Code 0.9.9") ?? "", /below minimum/i);
  assert.equal(unsupportedClaudeVersionReason("Claude Code 1.2.3"), null);
  assert.equal(unsupportedClaudeVersionReason("1.0.0"), null);
  assert.equal(unsupportedClaudeVersionReason("2.1.186 (Claude Code)"), null);
  assert.equal(unsupportedClaudeVersionReason("Claude Code 1.0.0-rc.1"), null);
  assert.equal(unsupportedClaudeVersionReason("2.1.186+abc"), null);
  assert.equal(unsupportedClaudeVersionReason("Claude Code 3.0.0-rc.2+sha.abc (Claude Code)"), null);
  for (const malformed of ["01.0.0", "1.01.0", "1.0.01", "1.0.0-01", "1.0.0-alpha.01"]) {
    assert.match(unsupportedClaudeVersionReason(malformed) ?? "", /could not be parsed/i);
  }
  assert.match(unsupportedClaudeVersionReason("build 9.9.9; Claude Code 0.9.0") ?? "", /could not be parsed/i);
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
  assert.doesNotMatch(missing.error ?? "", /\/Users\/lume|private/);

  const nonzero = claudeAvailabilityFromProbeResult({
    error: undefined,
    status: 1,
    stdout: "",
    stderr: "permission denied"
  });
  assert.equal(nonzero.available, false);
  assert.match(nonzero.error ?? "", /permission denied/);

  const sensitiveNonzero = claudeAvailabilityFromProbeResult({
    error: undefined,
    status: 1,
    stdout: "",
    stderr: "Bearer sensitive-token from /Users/alice/.claude and C:\\Users\\bob\\.claude"
  });
  assert.equal(sensitiveNonzero.available, false);
  assert.doesNotMatch(JSON.stringify(sensitiveNonzero), /sensitive-token|\/Users\/alice|C:\\Users\\bob/);

  const externalPathNonzero = claudeAvailabilityFromProbeResult({
    error: undefined,
    status: 1,
    stdout: "",
    stderr: "failed /Volumes/PRIVATE/customer/repo and C:\\work\\secret"
  });
  assert.doesNotMatch(JSON.stringify(externalPathNonzero), /\/Volumes\/PRIVATE|C:\\work\\secret/);

  const timedOut = claudeAvailabilityFromProbeResult({
    error: undefined,
    status: null,
    signal: "SIGKILL",
    timedOut: true,
    stdout: "",
    stderr: ""
  });
  assert.equal(timedOut.available, false);
  assert.match(timedOut.error ?? "", /timed out/i);

  const externallyTerminated = claudeAvailabilityFromProbeResult({
    error: undefined,
    status: null,
    signal: "SIGTERM",
    timedOut: false,
    stdout: "",
    stderr: ""
  });
  assert.equal(externallyTerminated.available, false);
  assert.match(externallyTerminated.error ?? "", /terminated by SIGTERM/i);
  assert.doesNotMatch(externallyTerminated.error ?? "", /timed out/i);

  const outputOverflow = claudeAvailabilityFromProbeResult({
    error: undefined,
    status: 0,
    outputLimitExceeded: true,
    stdout: "Claude Code 1.2.3",
    stderr: ""
  });
  assert.equal(outputOverflow.available, false);
  assert.match(outputOverflow.error ?? "", /output.*limit/i);

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

  const emptyVersion = claudeAvailabilityFromProbeResult({
    error: undefined,
    status: 0,
    stdout: "",
    stderr: ""
  });
  assert.equal(emptyVersion.available, true);
  assert.equal(emptyVersion.version, null);
  assert.match(emptyVersion.unsupportedReason ?? "", /empty|could not be parsed/i);
  assert.equal(createClaudeDryRunControl({ audit: auditStub(), availability: emptyVersion }).status().state, "unsupported");

  const sensitiveVersion = claudeAvailabilityFromProbeResult({
    error: undefined,
    status: 0,
    stdout: "Claude Code 1.2.3 from /Users/lume/bin with sk-test_1234567890abcdef\n",
    stderr: ""
  });
  assert.doesNotMatch(JSON.stringify(sensitiveVersion), /\/Users\/lume|sk-test_/);
});

test("Claude dry-run control construction and status remain side-effect-free", () => {
  const control = createClaudeDryRunControl({
    audit: auditStub()
  });

  const firstStatus = control.status();
  assert.equal(firstStatus.state, "not_configured");
  assert.equal(firstStatus.command.error, "Claude availability probe was not requested.");
  assert.doesNotMatch(JSON.stringify(firstStatus), /\/Users\/lume/);
  const secondStatus = control.status();
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

test("Claude dry-run derives unsupported state from injected version output", async () => {
  for (const version of ["Claude Code 0.9.0", "unparseable wrapper banner"]) {
    const control = createClaudeDryRunControl({
      availability: {
        available: true,
        command: "claude",
        version,
        error: null
      },
      audit: auditStub()
    });
    assert.equal(control.status().state, "unsupported");
    await assert.rejects(
      () => control.resumePrompt({ sessionId: "claude-session-1", prompt: "must stay dry-run blocked" }),
      /status is unsupported/i
    );
  }
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
    (error: unknown) => error instanceof Error && error.message === "Invalid Claude session id"
  );
});
