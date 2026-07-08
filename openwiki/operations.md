# Operations

This page covers release engineering, QA Lab, CI, and the release-readiness checks that gate every LCO release.

## Release Truth

| Source | Role |
| --- | --- |
| GitHub issues | Implementation truth |
| `VISION.md` | Product and eval truth |
| `docs/BETA_RELEASE_RUNBOOK.md` | Beta release-operation truth |
| `docs/RELEASE_CHECKLIST.md` | Stable release proof contract |
| `docs/CLAIM_AUDIT.md` | Claim audit record |

`main` is the integration branch, **not** a release. A merged PR does not become a release claim.

## Release Cadence

1. Merge tested feature PRs to `main`.
2. Update release tracker status (issue #6 for beta, issue #14 for package/release/demo/claim-audit).
3. Cut a release candidate from `main` only after beta gates have a named evidence directory.
4. Validate the candidate through CLI, MCP/OpenClaw plugin, scorecard, and claim-audit surfaces.
5. Publish npm and create a GitHub Release only after explicit user approval.
6. After publication, install from the published artifact and rerun the same public user-path smoke.

## Claim Tiers

Use the narrowest claim tier that the evidence proves (from `docs/RELEASE_CHECKLIST.md`):

| Tier | Allowed claim | Required proof |
| --- | --- | --- |
| `beta-read-recall` | Codex read/search/describe/expand | Index/search/describe/expand smoke, safe summaries, privacy scan |
| `beta-agent-gateway` | OpenClaw agent can use Codex recall tools | Installed gateway dogfood, agent skill, bounded expansion, dry-run control |
| `beta-live-send` | One approved live Codex send is proven | Matching dry-run approval id, live send marker, audit tail, post-action refresh |
| `rc-control-matrix` | Live control action matrix is proven | Send, resume, steer, and interrupt each pass on disposable threads |
| `1.0` | Codex-first local orchestration is generally ready | Every release check plus fresh npm, agent dogfood, docs truth, scorecards, CI, and privacy gates |

**Do not imply a higher tier from lower-tier proof.** One approved live send does not prove resume, steer, or interrupt.

## Release Gate Commands

### Release Preflight

```bash
lco release preflight --strict
```

Requires a structured `approved_live_control_smoke` marker before any beta/release claim that includes live-control or working-app proof.

### General Readiness

```bash
lco release general-readiness \
  --evidence-dir <evidence-dir>/<date>/general-release-readiness \
  --fresh-npm-evidence published-package-smoke.json \
  --agent-dogfood-evidence openclaw-tool-smoke.json \
  --strict
```

### GA Smoke

```bash
lco release ga-smoke \
  --evidence-dir <evidence-dir>/<date>/release-ga-smoke \
  --package-version <version> \
  --candidate-sha <release-candidate-sha> \
  --strict
```

Aggregates release-status, finalization, published-smoke, dogfood, tool-smoke, scenario, scorecard, preflight, bundle, and privacy reports into one blocker taxonomy. Does **not** publish npm, move `latest`, create a GitHub Release, run live Codex control, or mutate a GUI.

### Other Release Commands

| Command | Output |
| --- | --- |
| `lco release status` | Release status report |
| `lco release finalization-status` | Finalization gate status |
| `lco release demo-status` | Demo readiness status |
| `lco release bundle` | Release bundle report |

## QA Lab

The QA Lab is the release-captain surface for proving LCO works as a real installed product. See [`docs/QA_LAB.md`](../docs/QA_LAB.md).

### Tool Coverage Gate

```bash
lco qa-lab tool-coverage \
  --evidence-dir <evidence-dir>/<date>/m12-ga-qa-lab/tool-coverage \
  --tool-smoke-report <evidence-dir>/<date>/m12-ga-qa-lab/tool-coverage/openclaw-tool-smoke.json \
  --coverage-policy full \
  --strict
```

Proves the runtime MCP registry and OpenClaw plugin manifest agree on canonical `lco_*` tools. Under `--coverage-policy full`, every canonical declared tool must have tier-appropriate product evidence or the release must explicitly exclude that tool.

### Full Gateway Smoke

```bash
node ./dist/packages/cli/src/index.js openclaw tool-smoke \
  --profile lco-full-gateway \
  --session-key agent:main:lco-full-gateway \
  --coverage full \
  --thread-id <public-safe-thread-id> \
  --query "<public-safe-query>" \
  --evidence-path <evidence-path> \
  --strict
```

The full gateway smoke covers the canonical tool catalog and compatibility aliases, including the five C1 canonical umbrella calls: `lco_watchers`, `lco_codex_extract`, `lco_prepared_state`, `lco_operating_picture`, and `lco_desktop_proof`.

### QA Lab Subcommands

| Command | Purpose |
| --- | --- |
| `qa-lab tool-coverage` | Tool coverage gate |
| `qa-lab desktop-contract` | Desktop contract proof |
| `qa-lab privacy-scan` | Public-safe evidence scan |
| `qa-lab run` | Full QA Lab run |
| `qa-lab live-control-matrix` | Live control action matrix |
| `qa-lab cli-mcp-smoke` | CLI/MCP product smoke |
| `qa-lab judge` | Judge review |
| `qa-lab adversarial-review` | Adversarial review |
| `qa-lab workflow` | Workflow coverage |

## Smoke Harnesses

LCO includes extensive smoke harnesses in `packages/cli/src/`:

| File | What it smokes |
| --- | --- |
| `openclaw-tool-smoke.ts` | Gateway tool invocation across the canonical tool catalog and compatibility aliases |
| `openclaw-live-control-smoke.ts` | OpenClaw gateway live Codex control |
| `openclaw-post-action-refresh-smoke.ts` | Post-action refresh proof |
| `openclaw-dogfood.ts` | Installed plugin load and tool coverage |
| `published-package-smoke.ts` | Published npm package smoke |
| `cli-mcp-product-smoke.ts` | CLI/MCP product surface |
| `live-control-smoke.ts` | Live Codex control smoke |
| `release-ga-smoke.ts` | GA smoke aggregation |

## CI

`.github/workflows/ci.yml`:

```yaml
on: [push: main, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup-node (22, cache npm)
      - npm ci
      - npm run check   # build + test
```

CodeQL: `.github/workflows/codeql.yml`.

## npm Publish

- Package name: `lossless-codex-orchestrator` (current). Deprecated compat: `lossless-openclaw-orchestrator`.
- `publishConfig.tag: latest` in `package.json`.
- `package.json` `files` array controls what is included in the published tarball.
- `tests/package-hygiene.test.ts` and `tests/published-package-smoke.test.ts` enforce package content boundaries.
- After publication, install from the published artifact and rerun the same public user-path smoke before calling the release complete.

## Evidence Discipline

- Demo and judge inputs must come from a **synthetic corpus** or the committed **retrieval goldens**. Live-store content can never be public evidence.
- Quote only counts, classifications, refs, hashes, and blocker codes from public-safe reports.
- For multiple gate reports, create the dated evidence root, `cd` into it, and pass relative `--evidence-dir` values.

## Versioning

- Current version: `1.4.5` (in `package.json`).
- Changelog: `docs/releases/CHANGELOG.md` — one line per released version, newest first.
- Release notes: `docs/releases/RELEASE_NOTES_<version>.md`.
- The `prepare` script runs `npm run build` before publish.
