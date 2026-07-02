# LCO Agent Instructions

## Repository Agent Quick Start

If you are a coding agent working in this repository:

1. Read README.md for the public product promise and proof boundary.
2. Read CONTRIBUTING.md for issue routing, validation, evidence, and PR
   expectations.
3. Read docs/SETUP.md before changing install, OpenClaw, MCP, or first-run
   behavior.
4. Create or reuse a GitHub issue before meaningful implementation work.
5. Write or update a failing test, smoke, or eval scenario before the minimal
   implementation.
6. Do not commit raw transcripts, private SQLite DBs, screenshots with private
   data, tokens, cookies, connector URLs, or credentials.
7. Update the issue before handoff, merge, pause, or external-review wait.

## Shared Owned-Repo Policy

- Use `100yenadmin/codex-operating-kit` for the shared issue/epic/milestone/sprint policy, PR review-thread lifecycle, and release changelog standard.
- Shared rollout tracker: https://github.com/100yenadmin/codex-operating-kit/issues/5
- Shared kit merge: `100yenadmin/codex-operating-kit@d1bd004a85da6967041765b46fcb8885a88b802b`
- For meaningful GitHub work, create or reuse an issue before implementation, link PRs to the issue, and update the issue/tracker before handoff, merge, or pause.
- Before merge, release, or readiness claims, query current-head review threads and separate resolvable review threads from top-level bot comments and check annotations.
- P0-P2 current actionable review threads block merge/release unless fixed, proven false-positive, or explicitly escalated. P3/advisory threads still need terminal disposition.
- Releases, prereleases, and release-affecting PRs must lead with human-readable user/operator outcomes and keep proof, evidence, artifact identity, and rollback details in a compact verification tail.
- Keep LCO-specific beta claim tiers, release proof, demo status, and source-authority gates in this repo's runbooks. The shared kit supplies the common operating spine only.

## LCO Release Gates

- Read `docs/BETA_RELEASE_RUNBOOK.md`, `docs/RELEASE_CHECKLIST.md`, `docs/SOURCE_AUTHORITY_PROFILE.md`, and `docs/CLAIM_AUDIT.md` before claiming release or beta readiness.
- Require `loo release preflight --strict` to report a structured `approved_live_control_smoke` marker before any beta/release claim that includes live-control or working-app proof.
- Do not treat merged code, local smoke, or docs-only proof as a beta release by itself.
- Do not rewrite historical release notes or resolve historical PR residue without a separate issue.

Do not widen LCO public claims from this file. Live Codex control, GUI mutation,
Claude parity, npm publish, GitHub Release creation, and 1.0 readiness require
their own scoped proof gates.

## Public Documentation Placement

- Keep `README.md` as the public landing page: product value, install, setup,
  first workflow, OpenClaw/MCP entrypoints, safety boundaries, and links.
- Keep detailed first-run instructions in `docs/SETUP.md`.
- Keep OpenClaw plugin/operator details in `docs/OPENCLAW_PLUGIN.md`.
- Keep agent-facing workflow instructions in
  `skills/lossless-openclaw-orchestrator/SKILL.md`.
- Keep repo-agent operating rules, release discipline, and source-of-truth
  policy in this `AGENTS.md`.
- Do not put active sprint ledgers, long issue history, exhaustive release-gate
  command inventories, or internal agent maintenance loops into the public
  README. Link `VISION.md`, GitHub trackers, or runbooks instead.
