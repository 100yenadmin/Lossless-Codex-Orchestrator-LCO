# Public Beta Demo Workflow

This demo proves the current Codex beta claims without uploading local session text or enabling unattended desktop control. It is designed for a local checkout with Node 22+ and a user-owned Codex store.

## 1. Install And Doctor

```bash
npm install
npm run build
node dist/packages/cli/src/index.js doctor
```

The doctor output should report `localOnly: true`, the Codex transport status, LCM peer diagnostics, and honest desktop fallback readiness.

## 2. Index 100+ Local Codex Sessions

```bash
export LOO_DB_PATH="$HOME/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite"
loo index codex --max-files 150 "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

Acceptance for the beta demo is 100+ local Codex sessions indexed with zero importer errors. Use `--max-files` to keep the smoke bounded; raise the cap only when the local store needs it to reach 100 sessions. Save only counts and redacted metadata in public evidence; do not attach raw session files or the SQLite database.

## 3. Search Plans And Finals

CLI:

```bash
loo search "proposed plan"
loo search "final message"
```

MCP/OpenClaw:

- `loo_codex_plans`
- `loo_codex_final_messages`
- `loo_codex_thread_map`

The expected proof is that searches return bounded safe-text refs such as `codex_thread:*`, not raw transcript dumps.

## 4. Expand Two Sessions

Use search results from step 3 and expand two sessions, one brief and one evidence bundle:

```bash
loo expand-ref --profile brief codex_thread:<thread-id-a>
loo expand-ref --profile evidence --token-budget 4000 codex_thread:<thread-id-b>
```

The result should include metadata, final messages, proposed plans, touched files, and safe summaries within the selected budget.

## 5. Dry-Run Continue Only

Use the control dry-run tool before any live Codex mutation:

```text
loo_codex_control_dry_run({
  "action": "send",
  "thread_id": "<thread-id>",
  "message": "Harmless beta smoke: please acknowledge this dry-run boundary."
})
```

The dry-run returns `approval_audit_id`, `params_hash`, and `message_hash`. This demo does not run live control. A live continue requires the user to approve the exact target thread and provide the matching `approval_audit_id`, while Codex still owns its own approval and sandbox semantics.

## 6. Desktop Fallback Readiness

```bash
loo desktop see cua-driver
loo desktop see peekaboo
```

`loo desktop see peekaboo --snapshot` is optional and should be used only when the user accepts a local visible snapshot. `loo_desktop_act` remains dry-run-only in this beta.
