export function createClaudeCodeAdapter() {
  return {
    status: "proof-boundary-inventory",
    parity: false,
    liveControlProven: false,
    firstProofStep: "read-only-session-inventory",
    forbiddenClaims: [
      "Claude Code indexing parity",
      "Claude Code live control",
      "Claude Code GUI mutation",
      "cloud sync"
    ],
    note: "Claude Code session indexing/control is intentionally staged behind this adapter until storage and control paths are proven."
  };
}
