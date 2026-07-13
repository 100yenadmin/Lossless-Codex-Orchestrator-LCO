# Release Notes 1.6.0

`1.6.0` is the Control Plane release for local Codex sessions. It adds bounded
ways to see what changed, prepare review-then-drive work, verify supported
Codex actions, and use LCM summary peers without widening access to raw local
data.

## Highlights

- `lco session-diff` and `lco_session_diff` provide token-bounded changes since
  an opaque public-safe cursor across the CLI, MCP, and OpenClaw surfaces.
- `lco drive --dry-run` and `lco_drive` build review-then-drive packets with
  target, turn, token, cost, timeout, freshness, and approval guards.
- Codex send, resume, steer, and interrupt paths use matching dry-run audits and
  post-action refresh checks on approved disposable targets.
  Verification re-indexes changed session data after the action; an unchanged
  index skip does not count as fresh action evidence.
- Configured LCM peers can materialize public-safe prepared cards from summary
  DAGs and report ready, degraded, or unavailable status through peer doctoring.
- The Claude adapter validates a second target family with explicit dry-run,
  unavailable, and unsupported states, while live Claude actions remain future
  work.

## What Changed

- Added session-diff cursor signing, omission markers, stale-cursor handling,
  and privacy-safe CLI/MCP/OpenClaw output.
- Added deterministic drive plans and audit hashes without running reviewer
  agents or live control from the dry-run command.
- Bound post-action refresh confirmation to native OpenClaw response details and the
  actual local index refresh watermark.
- Added read-only LCM peer integrity checks, bounded materialization, symlink
  alias and retarget cleanup, disabled-peer cleanup, and recursively encoded
  sensitive-ref filtering.
- Added a side-effect-free Claude availability probe and kept the 1.6 Claude
  control surface dry-run only.
- Made the canonical `lco` help output consistent across both package names and
  allowed QA Lab workflows to target an isolated OpenClaw profile explicitly.
- Added operator threat-model and dual-package rollback guidance for the
  control-plane release process.

## Upgrade

Install or upgrade from the stable channel:

```bash
npm install -g lossless-codex-orchestrator@latest
lco doctor
```

Existing installations that use `lossless-openclaw-orchestrator` remain
supported through the maintained compatibility package. New installations
should use `lossless-codex-orchestrator`.

## Validation

Release qualification for 1.6 covers GitHub CI and CodeQL, current-head review,
focused feature and packaging suites, clean installs of both npm package names,
CLI and MCP invocation, OpenClaw gateway facade coverage, local-agent dogfood,
and approved disposable-target runtime checks.

## Links

- Control Plane tracker: #673
- Claude dry-run adapter: #737
- Session diff: #739
- Review-then-drive: #740
- Codex scratch control matrix: #741
- LCM prepared cards and peer doctor: #742
- Post-action refresh QA fix: #761
- Canonical CLI help: #773
- QA Lab OpenClaw profile routing: #777
