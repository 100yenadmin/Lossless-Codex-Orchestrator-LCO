# Release Rollback Runbook

This operator-facing runbook repairs a bad dual-name npm release for Lossless
Codex Orchestrator. It is for release captains, not public release notes. Public
release notes should stay customer/developer-facing and link to normal upgrade
guidance; rollback details belong here, the release checklist, and the release
tracker.

The canonical npm package is `lossless-codex-orchestrator`. The maintained
compatibility package is `lossless-openclaw-orchestrator`. When a patch ships
under both names, verify and repair both names together.

## Stop And Classify

1. Stop any additional publish, dist-tag, or GitHub Release edits until the
   current registry and tag state is captured.
2. Classify the incident:
   - wrong `latest`, `beta`, or `next` dist-tag
   - canonical package published but compat package missing
   - compat package published but canonical package missing
   - package contents wrong but version already published
   - Git tag or GitHub Release points at the wrong commit
   - public release notes contain stale or internal release text
3. Open or update the release issue with the affected version, package names,
   candidate commit, and intended recovery path.

## Prepare npm Auth

Use the Keychain token only through a temporary npm config. Never paste the token
into docs, evidence, shell history, issue comments, or release notes.

```bash
token="$(security find-generic-password -s "npmjs.com:electricsheephq:automation-token" -w)"
tmp_npmrc="$(mktemp)"
chmod 600 "$tmp_npmrc"
printf '//registry.npmjs.org/:_authToken=%s\n' "$token" > "$tmp_npmrc"
export NPM_CONFIG_USERCONFIG="$tmp_npmrc"
trap 'rm -f "$tmp_npmrc"' EXIT
```

## Capture Registry Truth

Capture the canonical and compatibility package state before changing it:

```bash
npm view lossless-codex-orchestrator version dist-tags --json
npm view lossless-openclaw-orchestrator version dist-tags --json
npm dist-tag ls lossless-codex-orchestrator
npm dist-tag ls lossless-openclaw-orchestrator
```

If npm selector freshness is pinned locally, use the same install bypass already
documented in setup/published-smoke guidance. Do not treat local selector drift
as registry truth until `npm view` confirms the registry state.

## Correct dist-tags

Move a bad tag back to the last known-good version:

```bash
npm dist-tag add lossless-codex-orchestrator@<good-version> latest
npm dist-tag add lossless-openclaw-orchestrator@<good-version> latest
```

Remove an accidental prerelease tag when needed:

```bash
npm dist-tag rm lossless-codex-orchestrator <bad-tag>
npm dist-tag rm lossless-openclaw-orchestrator <bad-tag>
```

Re-read registry truth after every tag change:

```bash
npm view lossless-codex-orchestrator version dist-tags --json
npm view lossless-openclaw-orchestrator version dist-tags --json
```

## Deprecate A Bad Artifact

When a version is published but should not be installed, deprecate the affected
package version with a short migration pointer:

```bash
npm deprecate lossless-codex-orchestrator@<bad-version> "Use lossless-codex-orchestrator@<fixed-version>."
npm deprecate lossless-openclaw-orchestrator@<bad-version> "Use lossless-codex-orchestrator@<fixed-version>; this package is the maintained compatibility name."
```

Do not unpublish unless npm support or an explicit maintainer decision requires
it. Prefer a fixed patch release plus deprecation because existing installs and
lockfiles can then recover deterministically.

## Publish A Repair Patch

If the artifact contents are wrong, fix the repo, run release gates, and publish
a new patch. Publish canonical first, then the compatibility package with the
same version and files.

```bash
npm run check
npm pack --dry-run
npm publish --tag latest
```

For the compatibility package, edit only the package identity fields required by
the release recipe, publish, then restore the canonical package identity before
committing any follow-up. Do not leave a compatibility package name in the
canonical source tree.

## Correct Git Tag And GitHub Release

If the Git tag or GitHub Release points at the wrong commit, do not rewrite
silently. Record the mismatch in the release issue, then choose one path:

- If the release was not broadly consumed, delete and recreate the tag and
  GitHub Release with the intended commit.
- If the release may already be consumed, leave the old tag in place, publish a
  repair patch, and edit the old GitHub Release notes to point users to the
  fixed version.

Useful commands:

```bash
gh release view v<version> --json tagName,targetCommitish,isDraft,isPrerelease,url
gh release edit v<version> --notes-file docs/releases/RELEASE_NOTES_<version>.md
gh release delete v<version>
git tag -d v<version>
git push origin :refs/tags/v<version>
git tag v<version> <commit-sha>
git push origin v<version>
```

Use deletion only when the release issue records why rewriting is safer than a
patch release.

## Fresh Install Verification

After any rollback, tag correction, deprecation, or patch publish, verify from a
fresh install path:

The public user-path checks are `lco openclaw published-smoke` and
`lco release finalization-status`; the isolated prefix below makes sure those
commands come from the package being verified.

```bash
prefix="$(mktemp -d)"
npm install -g --prefix "$prefix" lossless-codex-orchestrator@latest
"$prefix/bin/lco" doctor --json
"$prefix/bin/lco" openclaw published-smoke --strict
"$prefix/bin/lco" release finalization-status \
  --package-version <version> \
  --expected-dist-tag latest \
  --expected-github-tag v<version> \
  --strict
```

Then verify the compatibility package when the release was dual-published:

```bash
compat_prefix="$(mktemp -d)"
npm install -g --prefix "$compat_prefix" lossless-openclaw-orchestrator@latest
"$compat_prefix/bin/lco" --version
```

## Closeout

The release issue closeout must include:

- registry state before and after repair
- dist-tag corrections made
- deprecation commands run, if any
- Git tag and GitHub Release status
- fresh install verification result
- whether a new patch release was required
- remaining user-visible recovery guidance

Do not copy tokens, raw npm auth config, local private paths, raw gateway logs,
or customer data into the closeout.
