# Release Notes 0.1.0-beta.14

`lossless-openclaw-orchestrator` keeps the Codex-first working-app proof through
the installed OpenClaw gateway, with clearer linked-install diagnostics for
OpenClaw dogfood runs. This prerelease keeps the beta posture narrow:
local Codex sessions indexing, search, describe, bounded expansion,
approval-gated Codex control proof, post-action refresh, and public-safe
reasoning from source refs.

## Included

- #194 adds public-safe `installOutcome` diagnostics to `loo openclaw dogfood`,
  distinguishing `installed`, `already_installed`, `link_force_unsupported`,
  and `failed` linked-install outcomes. Existing default-profile installs now
  report `openclaw_plugin_already_installed_but_ready` when the plugin is loaded
  and all required `loo_*` tools are present. Known OpenClaw prose markers are
  reduced to public-safe `installOutcome.recognizedMarker` ids without storing
  raw OpenClaw stdout/stderr or local profile paths.
- #192 fixes `loo openclaw tool-smoke` so `loo_expand_session` receives the
  `thread_id`, `profile`, and `token_budget` discovered from the gateway
  `loo_search_sessions` call instead of invoking the tool with empty args.
- #188 adds `loo onboard status`, a public-safe first-run readiness report for
  package metadata, required files, source and package entrypoints, OpenClaw
  manifest wiring, declared `loo_*` tools, blocker/warning codes, and safe next
  commands.
- #158 proves one approved harmless live Codex send through the installed OpenClaw gateway
  after a matching dry-run approval audit id.
- #159 proves post-action refresh and safe orchestrator reasoning from source
  refs and summaries after the approved action.
- #172 adds claim-scoped runtime scenario sweeps, so the Codex-first
  working-app release gate can use `--claim-scope codex-working-app-proof`
  with `openclaw-gateway-live-codex-v1-1` and
  `post-action-refresh-reasoning-v1-1` without treating desktop fallback or
  connected local UI scenarios as blockers unless those surfaces are claimed.

## Proof Boundary

- Allowed claim: Codex-first working-app proof through the installed OpenClaw
  gateway for local session recall, onboarding readiness, direct session
  expansion, linked-install diagnostics, one approved live Codex action,
  post-action refresh, and safe reasoning from refs.
- Desktop fallback remains claim-conditional and is not included in this public
  release claim.
- Connected local UI remains claim-conditional and is not release-ready in this
  prerelease.
- Claude Code remains a read-only adapter/inventory boundary and adapter stub,
  not parity.
- This release does not perform additional live Codex control beyond the #158
  approved proof action, does not perform desktop GUI mutation, does not create
  cloud sync, does not support unattended desktop takeover, and does not claim
  release-grade enterprise security.
- No cloud sync is included.
- No unattended desktop takeover is included.
- No release-grade enterprise security is included.
- `approved_live_control_smoke_missing` remains the fail-closed blocker when a
  claimed live-control release lacks the structured approval smoke marker.
- Release bundle and status checks do not publish to npm and do not create a GitHub Release;
  publishing is a separate operation after gates pass.
- `latest` remains pinned to `0.1.0-beta.4`; `beta` points at `0.1.0-beta.14`
  if this candidate is published.

## Release Gates

Working-app release proof uses the stricter claim scope:

```bash
loo onboard status --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/onboarding --now 2026-07-01T00:00:00.000Z --strict
loo eval scenarios --scenario-dir evals/scenarios/v1.1 --runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proof --scenario-id openclaw-gateway-live-codex-v1-1 --scenario-id post-action-refresh-reasoning-v1-1 --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-scenarios --strict
loo release status --claim-scope codex-working-app-proof --runtime-proof-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/runtime-proof --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --approved-live-control-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/approved-live-control-smoke.json --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict
```

If a release candidate intentionally excludes live Codex control and working-app
proof, keep the reduced scope explicit:

```bash
loo release status --claim-scope codex-read-search-expand-dry-run --evidence-dir /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status --candidate-sha <release-candidate-sha> --npm-publish-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/npm-approval.json --github-release-approval-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-release-approval.json --github-ci-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/github-ci.json --codeql-evidence /Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/release-status/codeql.json --strict
```

## Install

```bash
npm install -g lossless-openclaw-orchestrator@beta
```
