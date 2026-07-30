# Release Notes 1.7.0

`1.7.0` is the Eva remote control candidate for local Codex sessions. These
notes describe the candidate; npm `latest` and GitHub Releases remain the
publication authorities.

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
- Hermes smoke registration coverage for the two new first-class tools.

## Upgrade

```bash
npm install -g lossless-codex-orchestrator@latest
lco doctor
```

Existing installations keep stdio behavior unless
`LCO_CODEX_TRANSPORT=daemon` is set explicitly.

## Validation

The release checks cover Unix-socket reconnects, opaque target selection,
idle-send and active-steer delivery, stale-target rejection, notification
silence, structured MCP results, and package installation.

## Safety boundary

- Stdio remains the public compatibility default.
- Daemon mode never starts or restarts Codex, enables Remote Control, or falls
  back silently to stdio.
- Raw transcript items may be transiently projected by Codex only to identify
  the current active turn; LCO immediately discards the items and never returns
  or logs them.
- Codex Desktop tasks stay on Hermes Computer Use. The managed daemon is not
  treated as the owner of Desktop turns, and generic GUI control stays off.
- Every live delivery or interrupt still requires the matching unexpired
  dry-run approval audit.

## Availability

Until npm `latest` and GitHub Releases list 1.7.0, this file describes upcoming
behavior rather than an available stable package.
