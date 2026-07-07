# Testing & Evals

LCO uses Node.js's built-in test runner (`node --test`) with `tsx` for TypeScript transpilation. Tests live in `tests/` and eval scenarios live in `evals/`.

## Running Tests

```bash
# Full check: build + test
npm run check

# Build only
npm run build

# Tests only
npm test

# Type-check only
npm run typecheck

# Single test file (fast iteration)
node --test --import tsx tests/cli-index.test.ts
```

CI runs `npm run check` on every push to `main` and every PR.

## Test Structure

Tests are flat in `tests/` (70+ files). Key test groups by domain:

### Core Indexing & Search

| Test file | What it covers |
| --- | --- |
| `codex-index.test.ts` | Codex JSONL indexing, session parsing, drift detection |
| `codex-importer-coverage.test.ts` | Importer coverage for envelope/legacy formats |
| `codex-drift.test.ts` | JSONL drift reporting |
| `index-fast-skip.test.ts` | Source-file watermark skip logic |
| `cli-search-bounds.test.ts` | Search limits, timeout, flag-like query handling |

### Prepared State & Recall

| Test file | What it covers |
| --- | --- |
| `prepared-cards.test.ts` | Prepared card lifecycle states, materialization |
| `prepared-source-ranges.test.ts` | Source range metadata |
| `summary-leaves.test.ts` | Summary leaf generation and expansion |
| `lcm-recall.test.ts` | LCM peer DB read-only recall |
| `hybrid-retrieval-eval.test.ts` | Hybrid retrieval evaluation |

### Safety & Control

| Test file | What it covers |
| --- | --- |
| `bridge-safety-core.test.ts` | Dry-run/control boundary core |
| `control-and-mcp.test.ts` | MCP control surface and method policy |
| `hook-sidecar.test.ts` | Hook sidecar capture (closeout, compaction, state-prep, title finalizer) |
| `closeout-hooks.test.ts` | Closeout envelope capture |
| `runtime-proof-gate.test.ts` | Runtime proof gate validation |
| `session-sanitizer.test.ts` | Privacy/safety sanitizer |

### MCP & OpenClaw

| Test file | What it covers |
| --- | --- |
| `openclaw-tool-smoke.test.ts` | Full gateway smoke across canonical tools and compatibility aliases (largest test, ~182k) |
| `openclaw-plugin-manifest.test.ts` | Plugin manifest snapshot |
| `openclaw-live-control-smoke.test.ts` | Gateway live Codex control smoke |
| `openclaw-post-action-refresh-smoke.test.ts` | Post-action refresh proof |
| `openclaw-dogfood.test.ts` | Installed plugin dogfood |
| `tool-exposure-profile.test.ts` | Tool profile filtering (facade/standard/all) |
| `autonomy-operating-picture.test.ts` | Operating picture and autonomy tick |

### Release & QA

| Test file | What it covers |
| --- | --- |
| `release-claim-audit.test.ts` | Claim audit enforcement |
| `release-status.test.ts` | Release status report |
| `release-finalization-status.test.ts` | Finalization gate |
| `release-demo-status.test.ts` | Demo readiness |
| `release-ga-smoke.test.ts` | GA smoke aggregation |
| `release-bundle.test.ts` | Release bundle |
| `general-release-readiness.test.ts` | General readiness gate |
| `published-package-smoke.test.ts` | Published npm package smoke |
| `package-hygiene.test.ts` | Package content boundaries |
| `package-identity.test.ts` | Canonical package identity |
| `qa-lab-*.test.ts` | QA Lab subcommand tests (run, review, workflow, tool-coverage, etc.) |

### Desktop & UI

| Test file | What it covers |
| --- | --- |
| `desktop-fallback.test.ts` | Desktop fallback diagnostics |
| `codex-desktop-coherence.test.ts` | Desktop coherence report |
| `codex-desktop-collaboration-proof.test.ts` | Desktop collaboration proof |
| `local-mac-ui-contract.test.ts` | Local Mac UI shell contract |
| `local-mac-ui-shell.test.ts` | UI shell implementation |
| `qa-lab-desktop-contract.test.ts` | QA Lab desktop contract |

### CLI & Docs

| Test file | What it covers |
| --- | --- |
| `cli-help.test.ts` | CLI help output |
| `cli-dispatch.test.ts` | CLI command dispatch |
| `cli-index.test.ts` | CLI index command |
| `cli-mcp-product-smoke.test.ts` | CLI/MCP product smoke |
| `public-docs.test.ts` | Public docs consistency |
| `vision-doc.test.ts` | VISION.md consistency |
| `agent-usage-skill.test.ts` | SKILL.md consistency |
| `lco-first-docs.test.ts` | LCO-first naming in docs |
| `owned-repo-policy.test.ts` | Shared owned-repo policy |

## Eval Scenarios

Eval scenarios are JSON fixtures that define expected behavior for specific workflows:

### `evals/scenarios/v1/`

Core scenarios for the 1.x release train:
- `brief-expansion-1k.json`, `evidence-bundle-4k.json` — Expansion profiles
- `prepared-cards-inbox-v1.json`, `lco-prepared-state-v1.json` — Prepared state
- `control-dry-run-audit.json`, `fail-closed-live-control.json` — Control boundary
- `codex-collaboration-cockpit.json`, `codex-autonomy-cockpit-p0.json` — Operating picture
- `hook-sidecar-capture-v1.json` — Hook capture
- `m9-agent-dogfood-core-workflow.json`, `m9-fresh-npm-clean-profile.json` — Dogfood
- `summary-leaves-v1.json`, `watcher-events-attention-queue-v1.json` — Leaves and watchers
- `session-map-triage.json`, `release-claim-audit.json` — Triage and claims

### `evals/scenarios/v1.1/`

Working-app runtime proof scenarios:
- `codex-desktop-coherence.json`, `codex-desktop-fallback-status.json`
- `desktop-collaboration-action-bound.json`, `desktop-first-daily-orchestration.json`
- `openclaw-gateway-live-codex.json`
- `post-action-refresh-reasoning.json`
- `runtime-desktop-visibility-status.json`
- `connected-local-ui-proof.json`

### Retrieval Goldens

`evals/scenarios/retrieval-goldens/` — Golden retrieval test sessions in two versions:

- **v1**: Original golden set.
- **v2**: Refined goldens with headroom guard (added in commit `bef2169`). Includes `goldens.json`, `baseline-floors.json`, and session JSONL files organized by category: `cross`, `event`, `long`, `near`, `vocab` — each with 10 target sessions and 10 distractor sessions.

The v2 gate is enforced by `tests/retrieval-goldens.test.ts` and generated by `scripts/generate-retrieval-goldens-v2.mjs`.

### Scorecards

`evals/scorecards/v1.0/` — Scorecard JSON and MD files for quality evaluation (e.g., `local-mac-search-ui-review.json`).

Scorecard sweep: `lco scorecards sweep` — Runs scorecard evaluation across scenarios.

## Eval CLI Commands

| Command | Purpose |
| --- | --- |
| `lco eval retrieval` | Run retrieval evaluation against scenarios |
| `lco eval scenarios` | Run scenario-based evaluation |
| `lco scorecards sweep` | Sweep scorecards |
| `lco runtime sweep-summary` | Runtime sweep summary |
| `lco runtime issue-packet` | Runtime proof issue packet |

## Test Helpers & Fixtures

- `tests/fixtures/` — Redacted test fixtures (no raw transcripts, secrets, or private data).
- `tests/helpers/` — Shared test utilities.

## Contributing Tests

From `CONTRIBUTING.md`:

1. Write or update a failing test, smoke, or eval scenario **before** implementing non-trivial behavior.
2. Keep PR focused on one user-visible or maintainer-visible problem.
3. Name the proof you ran: failing test, focused validation command, `npm run check` result.
4. Use redacted fixtures. Do not commit raw transcripts, private DBs, screenshots with private data, tokens, or credentials.
