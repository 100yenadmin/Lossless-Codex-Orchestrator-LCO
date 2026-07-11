import assert from "node:assert/strict";
import test from "node:test";
import { validateOpenClawGatewayRoute } from "../packages/cli/src/openclaw-gateway-route.js";

test("OpenClaw gateway route accepts literal IPv4 and IPv6 loopback websocket endpoints", () => {
  assert.deepEqual(validateOpenClawGatewayRoute("ws://127.0.0.1:18789", "token"), { ok: true });
  assert.deepEqual(validateOpenClawGatewayRoute("ws://127.0.0.2:18789", "token"), { ok: true });
  assert.deepEqual(validateOpenClawGatewayRoute("ws://127.1.2.3:18789", "token"), { ok: true });
  assert.deepEqual(validateOpenClawGatewayRoute("ws://[::1]:18789", "token"), { ok: true });
});

test("OpenClaw gateway route rejects plaintext remote and incomplete explicit-token routes", () => {
  assert.deepEqual(validateOpenClawGatewayRoute("ws://gateway.example.test:18789", "token"), { ok: false, code: "gateway_url_insecure" });
  assert.deepEqual(validateOpenClawGatewayRoute("ws://127.evil:18789", "token"), { ok: false, code: "gateway_url_insecure" });
  assert.deepEqual(validateOpenClawGatewayRoute("ws://127.0.0.1.attacker.example:18789", "token"), { ok: false, code: "gateway_url_insecure" });
  assert.deepEqual(validateOpenClawGatewayRoute(undefined, "token"), { ok: false, code: "gateway_token_requires_url" });
  assert.deepEqual(validateOpenClawGatewayRoute("ws://user:password@127.0.0.1:18789", "token"), { ok: false, code: "gateway_url_credentials_forbidden" });
});

test("OpenClaw gateway route permits encrypted remote websocket endpoints", () => {
  assert.deepEqual(validateOpenClawGatewayRoute("wss://gateway.example.test:443", "token"), { ok: true });
});
