export function hasJsonRpcRequestId(value: unknown): value is Record<string, unknown> & { id: unknown } {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, "id");
}

export function normalizeMcpStructuredContent(result: unknown): Record<string, unknown> {
  return isRecord(result) ? result : { result };
}

export function serializeMcpTextContent(result: unknown): string {
  return JSON.stringify(result, null, 2) ?? "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
