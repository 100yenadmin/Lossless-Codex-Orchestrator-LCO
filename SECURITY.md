# Security Policy

## Supported Versions

The supported public package is the latest published stable release on the npm
`latest` dist-tag. Maintained prerelease lines on `beta` or `next` are supported
only until a newer prerelease or stable package supersedes them.

## Reporting A Vulnerability

Please open a private security advisory on GitHub or contact the maintainer privately before publishing details.

High-priority issues include:

- Live control running without a dry-run audit id.
- Raw tokens, cookies, connector URLs, or customer credentials written to shareable evidence.
- Local session text uploaded by default.
- Codex approvals or sandbox semantics bypassed.
- Desktop fallback stealing focus or acting on the wrong app/window.

## Local Privacy Boundary

This project is local-first. Do not attach raw Codex/Claude transcripts, private SQLite DBs, auth files, cookies, tokens, or screenshots containing secrets to public issues.
