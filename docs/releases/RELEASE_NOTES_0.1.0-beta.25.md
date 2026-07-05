# Release Notes 0.1.0-beta.25

`0.1.0-beta.25` keeps the Codex-first working-app beta scope and publishes the #160 desktop proof-action gate plus the OpenClaw gateway smoke honesty fix.

## What Changed

- #160 adds `loo_desktop_proof_action` / `loo desktop proof-action`, limited to one CUA Driver TextEdit scratch `launch_app` proof action.
- #160 requires exact backend, target app, target window, action hash, approval ref, permission state, scratch file path, and `execute: true` before the proof action can call the backend.
- #160 emits public-safe proof-action and proof-report evidence without raw backend stdout/stderr, screenshots, SQLite contents, raw Codex transcripts, raw prompt text, or scratch file paths.
- #160 proves the installed OpenClaw gateway can see `loo_desktop_proof_action`, and that generic gateway invocation without exact proof args fails closed.
- #160 hardens `loo openclaw tool-smoke` so a successful gateway envelope with plugin `output.details.ok: false` is reported as `openclaw_tool_result_not_ok:<tool>` instead of being treated as a passing tool call.

## Current Claim Scope

Allowed beta claim:

> Codex-first working-app beta through installed OpenClaw gateway for local Codex sessions: search, describe, expand, dry-run, and previously proven approval-gated live Codex control evidence.

This release does not widen the beta.24 claim. Desktop collaboration remains limited to the CUA Driver TextEdit scratch proof-action path when that specific proof is claimed. Generic GUI mutation, Codex GUI mutation, prompt typing, clicking, arbitrary app control, and unattended takeover remain excluded.
Claude Code remains an adapter stub, not a parity claim.

## Release Gate Notes

- Working-app status example: `loo release status --claim-scope codex-working-app-proof --runtime-proof-dir <path> --approved-live-control-evidence <path> --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Desktop collaboration status additionally requires `--desktop-gui-required`, `--desktop-gui-approval-evidence <path>`, and the matching desktop collaboration runtime proof marker.
- Reduced-scope status example: `loo release status --claim-scope codex-read-search-expand-dry-run --npm-publish-approval-evidence <path> --github-release-approval-evidence <path> --candidate-sha <sha> --github-ci-evidence <path> --codeql-evidence <path> --evidence-dir <path> --strict`
- Use `codex-working-app-proof` only when the candidate has approved live-control smoke evidence plus runtime proof markers.
- Use `codex-read-search-expand-dry-run` when a candidate intentionally excludes live-control proof.
- `approved_live_control_smoke_missing` remains the blocker when a working-app claim is attempted without approved live-control smoke evidence.
- `desktop_collaboration_proof_missing` remains the blocker when desktop GUI collaboration is claimed without the action-bound proof marker.
- `latest` remains pinned to `0.1.0-beta.4`; if this candidate is published, npm `beta` points at `0.1.0-beta.25`.

## Explicit Non-Claims

This beta runs no new live Codex control smoke, does not run generic GUI mutation, and does not run Codex GUI mutation.
No automatic gateway authorization, no broad gateway scope approval, no prompt typing, no clicking, no arbitrary app control, no Claude parity, no cloud sync, no 1.0/stable readiness, no unattended desktop takeover, no release-grade enterprise security, and no enterprise/customer-ready security are claimed.
Bundle/status checks do not publish to npm and do not create a GitHub Release.
