# Release Notes 1.4.4

`1.4.4` is a maintenance release for the 1.4 identity line. It improves the
published-package smoke path and closes several review-gate hardening items so
release evidence points at the package users actually install.

LCO remains focused on helping agents work with local Codex sessions through
search, prepared-state recall, bounded expansion, and approval-gated command
packets.

## Highlights

- `lco openclaw published-smoke` now verifies the executable from the extracted
  npm package instead of accepting package metadata alone.
- Package recovery output is stricter about version mismatches, so a shadowed
  global `lco` command is less likely to be mistaken for the candidate package.
- Shell recovery fragments now validate package versions before emitting install
  commands.
- Release-review fixes landed for demo artifacts, post-action refresh target
  binding, prepared-card coverage, notification ordering, hook-sidecar title
  finalization, and local Mac UI redaction.

## What Changed

- Hardened binary-probe recovery with `resolvedBinarySource: "package_exec"` for
  extracted npm tarball execution.
- Kept metadata-only `package_tarball` probes fail-closed with
  `binary_probe_candidate_version_mismatch`.
- Added semver-shaped validation before package versions are embedded in emitted
  recovery commands.
- Carried forward the 1.4 package identity migration:
  `lossless-codex-orchestrator` is the canonical npm package, while
  `lossless-openclaw-orchestrator` remains a maintained compatibility package.

## Upgrade

```bash
npm install -g lossless-codex-orchestrator@latest
lco doctor
```

Existing installations that still use the compatibility package continue to
work, but new installs should use `lossless-codex-orchestrator`.

## Validation

- Focused affected test bundle: 92/92 passing.
- `npm run check`: 969/969 passing.
- GitHub CI, CodeQL, CodeRabbit, and evaOS review gates were green for the
  release-prep pull request.
- Post-merge scoped validation on `main` passed.
- Both npm package names were published at `1.4.4`; the canonical package is on
  `latest`, and the compatibility package carries the migration notice.

## Links

- Release PR: #662
- Review-proof hardening PR: #660
- Release tracking issue: #661
