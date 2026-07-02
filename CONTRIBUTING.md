# Contributing

Thanks for helping make local agent orchestration safer and less exhausting.
LCO is local-first infrastructure for Codex-heavy workflows, so useful
contributions are precise, well-scoped, and public-safe.

## Quick Links

- [Setup guide](docs/SETUP.md)
- [Repository agent instructions](AGENTS.md)
- [OpenClaw plugin guide](docs/OPENCLAW_PLUGIN.md)
- [Privacy policy](docs/PRIVACY.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Vision and proof boundary](VISION.md)

## Issue Routing

Use the GitHub issue forms and keep one problem per issue.

| Situation | Use | Required evidence |
| --- | --- | --- |
| Product bug, regression, crash, or wrong output | Bug report | Version, OS, command/tool, minimal repro, expected result, actual result, redacted logs |
| Missing, stale, or contradictory docs | Docs bug report | Affected path, current wording, expected wording, setup or user impact |
| New capability or product improvement | Feature request | User story, problem, proposed behavior, alternatives, safety boundary |
| New app/runtime adapter | Adapter request | Target runtime, read/index path, control capability needed, local storage/protocol, proof available |
| Upstream API or protocol drift | Protocol drift | Surface, version/commit, observed drift, impact, proposed compatibility gate |
| Unsafe control behavior | Unsafe control report | Tool/command, whether dry-run happened, approval_audit_id behavior, no secrets |

Security vulnerabilities should be reported privately through
[SECURITY.md](SECURITY.md), not as public issues.

## Before You Open A PR

1. Create or reuse a GitHub issue and include `Closes #<issue>` or
   `Related: #<issue>` in the PR.
2. Read [docs/SETUP.md](docs/SETUP.md) and run the narrowest local setup needed
   for your change.
3. Write or update a failing test, smoke, or eval scenario before implementing
   non-trivial behavior.
4. Keep the PR focused on one user-visible or maintainer-visible problem.
5. Keep public claims inside the documented safety boundary.

Good First Contributions:

- docs setup gaps and clearer troubleshooting
- redacted fixture improvements
- CLI help wording
- issue template improvements
- narrow tests for public-safe redaction, setup status, and scorecards
- small OpenClaw plugin manifest/doc corrections

Avoid refactor-only PRs unless a maintainer asked for that refactor as part of
an active issue.

## Development

```bash
npm install
npm run build
npm test
npm run check
```

For fast iteration, run the focused test file that owns your change before
running `npm run check`.

Use redacted fixtures for tests. Do not commit raw Codex transcripts, raw local
Codex, Claude Code, OpenClaw, browser, customer session data, raw SQLite DBs,
screenshots containing private data, tokens, cookies, API keys, connector URLs,
or credentials.

## Validation And Evidence

Every meaningful PR should name the proof it ran:

- failing test, smoke, or eval scenario used to define the change
- focused validation command
- `npm run check`, or why CI is the right place for heavier validation
- OpenClaw gateway dogfood when the change affects installed `loo_*` tools
- evidence path under `/Volumes/LEXAR/Codex/lossless-openclaw-orchestrator/YYYY-MM-DD/`

Evidence should contain public-safe summaries, counts, refs, hashes, setup
status, blocker codes, and command names. It must not contain raw Codex
transcripts, raw prompts, customer data, private DBs, secrets, or screenshots
with sensitive content.

## Agent-Authored Contributions

Agent-authored PRs are welcome when the agent leaves a human-reviewable trail.
If a coding agent authored or materially edited the PR:

- say so in the PR body
- keep the issue updated before handoff, merge, or pause
- include the exact focused validation commands
- summarize safety boundaries and restricted actions not performed
- resolve or reply to bot review conversations after addressing them
- do not claim release readiness, live control, GUI mutation, Claude parity, or
  customer readiness unless the matching proof gates pass

Agents should read [AGENTS.md](AGENTS.md) before editing this repository.

## Pull Request Expectations

- Preserve local-only defaults.
- Preserve safe summaries before raw expansion.
- Preserve source refs instead of absolute transcript paths in public output.
- Preserve dry-run plus matching `approval_audit_id` before live control.
- Add or update tests for extraction, search, approval gates, setup status,
  scorecards, or adapter behavior when those surfaces change.
- Do not add cloud sync, hidden control, transcript upload paths, permission
  bypasses, or generic GUI mutation without a separate design issue and proof
  boundary.

## Review Threads

Review conversations are author-owned. If a bot or human leaves an actionable
thread:

- verify it against current code before changing anything
- fix real issues with focused tests
- explain false positives with concrete file/test evidence
- reply with the terminal outcome
- resolve the thread when the concern is handled

Do not leave "fixed" bot threads for maintainers to clean up.

## Safety Boundaries

LCO is Codex-first and local-first. Public contributions must not widen these
claims without explicit evidence:

- no full Claude Code parity
- no cloud sync
- no unattended desktop takeover
- no permission bypass
- no enterprise/customer-ready security claim
- no generic GUI mutation
- no Codex GUI mutation as a stable public claim

When in doubt, file a design issue first.
