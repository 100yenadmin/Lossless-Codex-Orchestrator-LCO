# QA Lab Runtime Scenarios v1.1

The `v1` scenario contracts are dry-run-ready task definitions. Milestone 7
uses this `v1.1` directory for runtime-required working-app proof contracts.

These files are not satisfied by `loo eval scenarios` dry-run output alone.
They name the public-safe proof markers that must exist before LCO can claim a
working Codex-first app path.

Use `--runtime-proof-dir` to point at public-safe proof marker files named
`<scenario-id>.runtime-proof.json`. The runner derives required marker names
from each scenario's `metrics.requires_*` flags and fails closed with
`runtime_proof_missing:<scenario-id>:<marker>` until those markers are present.
Proof marker files use this shape:

```json
{
  "kind": "loo_runtime_scenario_proof",
  "scenario_id": "openclaw-gateway-live-codex-v1-1",
  "scenario_version": "1.1",
  "proof_mode": "runtime_required",
  "claim_scope": "codex-working-app-proof",
  "public_safe": true,
  "proof_markers": {
    "installed_gateway_path": true,
    "matching_approval_audit_id": true,
    "public_safe_scan": true
  },
  "raw_transcript_read": false,
  "raw_prompt_included": false,
  "raw_secret_included": false,
  "screenshot_included": false,
  "sqlite_included": false,
  "live_action_count": 1,
  "raw_prompt_chars": 0
}
```

Required proof properties:

- installed or packaged OpenClaw plugin surface
- real `loo_*` tool invocation through the user-facing path
- dry-run first, approved live action second when live Codex control is claimed
- post-action refresh and safe-summary reasoning
- action-bound desktop proof only when desktop collaboration is claimed
- zero raw transcript, prompt, screenshot, SQLite, token, cookie, credential, or
  private customer data in public evidence
