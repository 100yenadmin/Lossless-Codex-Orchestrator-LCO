# Release Notes 0.1.0-beta.21

`0.1.0-beta.21` keeps the same Codex-first working-app beta scope through the installed OpenClaw gateway and packages the npm selector cutoff diagnostic hardening from #208.

## What Changed

- #208 adds a distinct `npm_selector_cutoff_drift` diagnostic for the beta.20 install-smoke shape where npm dist-tag metadata and the registry tarball are visible, but exact semver install and a future `--before` retry still fail.
- #208 updates the beta release runbook to use the registry tarball install fallback when npm semver selection remains blocked by cutoff drift.
- #208 updates `VISION.md` so registry tarball install proof is treated as packaging/install hardening evidence, not a broader product capability claim.

## Current Claim Scope

Allowed beta claim:

> Codex-first working-app beta through installed OpenClaw gateway for local Codex sessions: search, describe, expand, dry-run, and previously proven approval-gated live Codex control evidence.

This release keeps the `--claim-scope codex-working-app-proof` gate and still documents the reduced `codex-read-search-expand-dry-run` path where live-control proof is intentionally excluded.

## Release Gate Notes

- `loo release preflight`, `loo release bundle`, `loo release demo-status`, and `loo release status` remain local-only public-safe gates.
- Working-app status example: `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Reduced-scope status example: `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- `approved_live_control_smoke_missing` remains the blocker when a working-app claim is attempted without approved live-control smoke evidence.
- If this candidate is published and npm exact semver install still reports selector cutoff drift, use `npm view lossless-openclaw-orchestrator@beta dist.tarball` and run the tarball install smoke from that registry tarball URL.
- Desktop collaboration remains excluded unless separately claimed with the desktop GUI proof gate.
- Claude Code remains an adapter stub, not a parity claim.

## npm Dist-Tag Policy

- `latest` remains pinned to `0.1.0-beta.4`; if this candidate is published, npm `beta` points at `0.1.0-beta.21`
- Do not promote `latest` until the stable/1.0 policy is separately proven.

## Explicit Non-Claims

This beta does not publish to npm during bundle/status checks, does not create a GitHub Release during bundle/status checks, does not run a new live Codex control smoke, and does not run a new live desktop GUI mutation.

No cloud sync, no 1.0/stable readiness, no Claude parity, no generic GUI mutation, no Codex GUI mutation, no unattended desktop takeover, no release-grade enterprise security, and no enterprise/customer-ready security are claimed.
