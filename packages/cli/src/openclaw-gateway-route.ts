export type OpenClawGatewayRouteValidation =
  | { ok: true }
  | { ok: false; code: "gateway_token_requires_url" | "gateway_url_invalid" | "gateway_url_unsupported_scheme" | "gateway_url_credentials_forbidden" | "gateway_url_insecure" };

export function validateOpenClawGatewayRoute(gatewayUrl: string | undefined, token: string | undefined): OpenClawGatewayRouteValidation {
  const usableToken = token && token !== "__OPENCLAW_REDACTED__" ? token : undefined;
  if (usableToken && !gatewayUrl) return { ok: false, code: "gateway_token_requires_url" };
  if (!gatewayUrl) return { ok: true };

  let parsed: URL;
  try {
    parsed = new URL(gatewayUrl);
  } catch {
    return { ok: false, code: "gateway_url_invalid" };
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    return { ok: false, code: "gateway_url_unsupported_scheme" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, code: "gateway_url_credentials_forbidden" };
  }
  if (parsed.protocol === "ws:" && !isLoopbackHost(parsed.hostname)) {
    return { ok: false, code: "gateway_url_insecure" };
  }
  return { ok: true };
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname.startsWith("127.") || hostname === "::1" || hostname === "[::1]";
}
