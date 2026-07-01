# Release Notes 0.1.0-beta.22

`0.1.0-beta.22` keeps the same Codex-first working-app beta scope through the installed OpenClaw gateway and packages the #160 desktop action fail-closed contract hardening.

## What Changed

- #160 updates `loo_desktop_act` so live desktop requests return structured blockers instead of only a prose dry-run note.
- #160 exposes the action-bound proof checklist to OpenClaw callers: backend, target app/window, action text, action hash, approval ref, permission state, focus before/after, and public-safe observation; mismatched action hashes return a named blocker.
- #160 keeps `loo_desktop_act` dry-run-only. It does not run GUI mutation, capture screenshots, or authorize unattended desktop takeover.
- #160 updates the OpenClaw plugin manifest so installed agents see the same optional proof-field schema as the MCP server.

## Current Claim Scope

Allowed beta claim:

> Codex-first working-app beta through installed OpenClaw gateway for local Codex sessions: search, describe, expand, dry-run, and previously proven approval-gated live Codex control evidence.

This release keeps the `--claim-scope codex-working-app-proof` gate and still documents the reduced `codex-read-search-expand-dry-run` path where live-control proof is intentionally excluded.

## Release Gate Notes

- `loo release preflight`, `loo release bundle`, `loo release demo-status`, and `loo release status` remain local-only public-safe gates.
- Working-app status example: `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example: `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- `approved_live_control_smoke_missing` remains the blocker when a working-app claim is attempted without approved live-control smoke evidence.
- Desktop collaboration remains excluded unless separately claimed with the desktop GUI proof gate.
- Claude Code remains an adapter stub, not a parity claim.

## npm Dist-Tag Policy

- `latest` remains pinned to `0.1.0-beta.4`; if this candidate is published, npm `beta` points at `0.1.0-beta.22`
- Do not promote `latest` until the stable/1.0 policy is separately proven.

## Explicit Non-Claims

This beta does not publish to npm during bundle/status checks, does not create a GitHub Release during bundle/status checks, does not run a new live Codex control smoke, and does not run a new live desktop GUI mutation.

No cloud sync, no 1.0/stable readiness, no Claude parity, no generic GUI mutation, no Codex GUI mutation, no unattended desktop takeover, no release-grade enterprise security, and no enterprise/customer-ready security are claimed.
