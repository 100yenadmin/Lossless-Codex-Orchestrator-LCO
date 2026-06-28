# Contributing

Thanks for helping make local agent orchestration safer and less exhausting.

## Development

```bash
npm install
npm run check
```

Use redacted fixtures for tests. Do not commit raw local Codex, Claude Code, OpenClaw, browser, or customer session data.

## Pull Request Expectations

- Keep public claims inside the beta safety boundary.
- Add or update tests for extraction, search, approval gates, or adapter behavior.
- Preserve local-only defaults.
- Do not add cloud sync, hidden control, or transcript upload paths without a separate design issue.
