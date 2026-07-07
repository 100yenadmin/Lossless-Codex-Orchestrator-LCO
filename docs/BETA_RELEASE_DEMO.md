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
export LCO_DB_PATH="$HOME/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite"
node dist/packages/cli/src/index.js index codex --max-files 150 "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

Acceptance for the beta demo is 100+ local Codex sessions indexed with zero importer errors and no unexpected `limitedFiles` or `warnings`. Use `--max-files` to keep the smoke bounded; default per-file caps are 256 MB / 200,000 events. If local evidence reports `codex_index_limited_files_skipped`, save only the public-safe warning counts and either re-run with explicit local-only cap overrides or classify the skipped giant-file tier as a streaming-importer follow-up. Do not attach raw session files or the SQLite database.

## 3. Search Plans And Finals

CLI:

```bash
node dist/packages/cli/src/index.js search "proposed plan"
node dist/packages/cli/src/index.js search "final message"
```

MCP/OpenClaw:

- `lco_codex_plans`
- `lco_codex_final_messages`
- `lco_codex_thread_map`

The expected proof is that searches return bounded safe-text refs such as `codex_thread:*`, not raw transcript dumps.

## 4. Expand Two Sessions

Use search results from step 3 and expand two sessions, one brief and one evidence bundle:

```bash
node dist/packages/cli/src/index.js expand-ref --profile brief codex_thread:<thread-id-a>
node dist/packages/cli/src/index.js expand-ref --profile evidence --token-budget 4000 codex_thread:<thread-id-b>
```

The result should include metadata, final messages, proposed plans, touched files, and safe summaries within the selected budget.

## 5. Dry-Run Continue Only

Use the control dry-run tool before any live Codex mutation:

```text
lco_codex_control_dry_run({
  "action": "send",
  "thread_id": "<thread-id>",
  "message": "Harmless beta smoke: please acknowledge this dry-run boundary."
})
```

The dry-run returns `approval_audit_id`, `params_hash`, and `message_hash`. This demo does not run live control. A live continue requires the user to approve the exact target thread and provide the matching `approval_audit_id`, while Codex still owns its own approval and sandbox semantics.

## 5a. Demo Evidence Status

Save public-safe JSON outputs in one evidence directory using these names:

- `index-codex.json`
- `plans-search.json`
- `finals-search.json`
- `expand-brief.json`
- `expand-evidence.json`
- `control-dry-run.json`

Then validate the demo proof without performing any gated action:

```bash
node dist/packages/cli/src/index.js release demo-status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/demo --strict
```

`lco release demo-status` writes `release-demo-status.json`, checks for 100+ indexed sessions, plan/final search proof, two expansion proofs, dry-run control proof, raw artifact leakage, and optional approved live-control proof. It records that it did not run live Codex control, mutate a GUI, publish npm, or create a GitHub Release. Until an explicitly approved live-control smoke proof is supplied, `--strict` fails with `approved_live_control_smoke_missing`. A `codex-working-app-proof` demo-status run must also pass `--runtime-proof-dir` with the public-safe #158 and #159 v1.1 marker files; otherwise it fails closed with `runtime_proof_missing:*`.

## 6. Desktop Fallback Readiness

```bash
node dist/packages/cli/src/index.js desktop see cua-driver
node dist/packages/cli/src/index.js desktop see peekaboo
```

`node dist/packages/cli/src/index.js desktop see peekaboo --snapshot` is optional and should be used only when the user accepts a local visible snapshot. `lco_desktop_act` remains dry-run-only in this beta.
