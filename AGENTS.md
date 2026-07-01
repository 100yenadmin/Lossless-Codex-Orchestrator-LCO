# LCO Agent Instructions

## Shared Owned-Repo Policy

- Use `100yenadmin/codex-operating-kit` for the shared issue/epic/milestone/sprint policy, PR review-thread lifecycle, and release changelog standard.
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
