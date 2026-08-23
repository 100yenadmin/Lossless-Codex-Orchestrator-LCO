# Release Notes 1.7.0

`1.7.0` adds Eva remote-control support for local Codex sessions. npm `latest`
and GitHub Release `v1.7.0` provide matching public artifacts.

## Highlights

- Opt-in `LCO_CODEX_TRANSPORT=daemon` support for WebSocket JSON-RPC over the
  already-running local Codex managed daemon Unix socket.
- `lco_codex_control_route`, which selects one daemon-owned active or idle task
  and returns an expiring opaque target, or explicitly requires Desktop
  observation.
- `lco_codex_deliver`, which uses the existing approval audit to send to an
  idle task or steer the matching active turn after revalidating ownership,
  state, and turn identity.
- Opaque-target interrupt support on `lco_codex_interrupt_thread` while keeping
  the existing raw-ID compatibility form.
- Hermes smoke registration coverage for the sixteen required Eva tools.

## Upgrade

```bash
npm install -g lossless-codex-orchestrator@latest
lco doctor
```

Eva/Hermes deployments using remote control must set
`LCO_CODEX_TRANSPORT=daemon`: LCO keeps a persistent
WebSocket JSON-RPC connection over the Unix socket owned by an already-running
Codex daemon and never silently falls back to stdio. OpenClaw loopback/stdio
compatibility remains available as a separate user path.

## Validation

The release checks cover Unix-socket reconnects, opaque target selection,
idle-send and active-steer delivery, stale-target rejection, notification
silence, structured MCP results, and package installation.

## Safety boundary

- Daemon mode never starts or restarts Codex, enables Remote Control, or falls
  back silently to stdio.
- Raw transcript items may be transiently projected by Codex only to identify
  the current active turn; LCO immediately discards the items and never returns
  or logs them.
- Codex Desktop tasks stay on Hermes Computer Use. The managed daemon is not
  treated as the owner of Desktop turns, and generic GUI control stays off.
- Every live delivery or interrupt still requires the matching unexpired
  dry-run approval audit.
