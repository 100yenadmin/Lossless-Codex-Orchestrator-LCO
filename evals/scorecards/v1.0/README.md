# Scorecards v1.0

These examples are the public-safe beta scorecard contract for milestone sweeps and issue closeouts. GitHub issues remain implementation truth; `VISION.md` remains product and eval truth.

Use the JSON examples for repeatable sweeps:

- `safety-bypass-review.json`
- `retrieval-quality-review.json`
- `orchestrator-leverage-prioritization.json`
- `packaging-install-review.json`
- `public-claim-review.json`
- `local-agent-usability-review.json`
- `tool-facade-usability-review.json`
- `local-mac-search-ui-review.json`
- `working-app-runtime-proof-review.json`

Use `issue-scorecard-update-template.md` for issue and PR comments after focused validation.

These examples define the minimum public-safe evidence shape, scoring boundary, and next-action language that future issues must fill in. `working-app-runtime-proof-review.json` is the scored installed-user-path proof scorecard once a release packet includes the matching public-safe runtime markers; for narrower release scopes, run the scorecard sweep with the relevant `--claim-scope` instead of overclaiming working-app readiness.

`tool-facade-usability-review.json` proves the agent guidance and manifest
metadata route normal operators through the compact public facade first, while
leaving workflow-detail, proof/debug, and low-level tools available when a
facade result or blocker calls for them.
