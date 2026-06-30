# QA Lab Runtime Scenarios v1.1

The `v1` scenario contracts are dry-run-ready task definitions. Milestone 7
uses this `v1.1` directory for runtime-required working-app proof contracts.

These files are not satisfied by `loo eval scenarios` dry-run output alone.
They name the public-safe proof markers that must exist before LCO can claim a
working Codex-first app path.

Required proof properties:

- installed or packaged OpenClaw plugin surface
- real `loo_*` tool invocation through the user-facing path
- dry-run first, approved live action second when live Codex control is claimed
- post-action refresh and safe-summary reasoning
- action-bound desktop proof only when desktop collaboration is claimed
- zero raw transcript, prompt, screenshot, SQLite, token, cookie, credential, or
  private customer data in public evidence

