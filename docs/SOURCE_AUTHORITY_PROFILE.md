# Source Authority Profile

LCO operating-picture tools distinguish two questions:

- `sourceCoverage`: did a source provide usable structured input for this run?
- `authorityCoverage`: is that source allowed to decide the claim being shown?

This keeps a cache, manual pin, or optional adapter from pretending to be current
truth. P0 is public and generic: it knows only LCO/Codex, structured GitHub
inputs, and explicit `PLAN_STATE.md` markers. P1 adapters stay
`not_configured` until separate read-only collectors prove their source-backed
behavior.

Default P0 authority:

| Source | Authority | Owns |
| --- | --- | --- |
| `lco` | `authoritative` | Codex session cards, safe summaries, plans, final messages, touched files |
| `github` | `authoritative` | PR status, CI status, review state, issue state |
| `plan_state` | `fallback_only` | manual pins, approval boundaries, stop conditions, exception ledger |
| `notion` | `cache_only` / `not_configured` | none in P0 |
| `support_control` | `cache_only` / `not_configured` | none in P0 |
| `company_brain` | `cache_only` / `not_configured` | none in P0 |
| `stripe` | `cache_only` / `not_configured` | none in P0 |

If a source is `unavailable` or `not_configured`, its derived claims must
degrade to `unknown` or low confidence. If sources conflict, the operating card
must either follow the configured authority owner or surface a conflict/low
confidence state. Summarizers may compress already-built cards, but they cannot
invent source authority or upgrade a fallback source into current truth.

No profile output should include raw transcript paths, raw prompt text, private
workspace names, customer data, screenshots, tokens, cookies, or secrets.
