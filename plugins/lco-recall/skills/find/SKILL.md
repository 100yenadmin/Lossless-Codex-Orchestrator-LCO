---
name: find
description: Search local LCO session recall from Claude Code using public-safe lco find output.
user-invocable: true
---

# LCO Recall Find

Use this skill when a Claude Code session needs local LCO recall for Codex or
Claude session context without opening raw transcripts.

Run the installed CLI first:

```bash
lco find --json "<query>"
```

If `lco` is not available on `PATH`, use the published package fallback:

```bash
npx --yes lossless-codex-orchestrator@latest find --json "<query>"
```

Prefer returned refs, cards, summaries, and bounded expansion hints. Keep raw
transcript reads out of the default flow, and use the normal LCO tools for
describe/expand work after selecting a ref.
