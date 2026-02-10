export type JsonRpcId = number | string;

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcRequest extends JsonRpcNotification {
  id: JsonRpcId;
}

export interface JsonRpcSuccessResponse {
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcNotification | JsonRpcRequest | JsonRpcResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  return isRecord(value) && typeof value.method === "string" && !("id" in value);
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return (
    isRecord(value) &&
    typeof value.method === "string" &&
    ("id" in value && (typeof value.id === "number" || typeof value.id === "string"))
  );
}

export function isJsonRpcErrorResponse(value: unknown): value is JsonRpcErrorResponse {
  if (!isRecord(value) || !("error" in value)) {
    return false;
  }

  const error = value.error;
  if (!isRecord(error) || typeof error.code !== "number" || typeof error.message !== "string") {
    return false;
  }

  if (!("id" in value)) {
    return false;
  }

  return value.id === null || typeof value.id === "number" || typeof value.id === "string";
}

export function isJsonRpcSuccessResponse(value: unknown): value is JsonRpcSuccessResponse {
  return (
    isRecord(value) &&
    ("id" in value && (typeof value.id === "number" || typeof value.id === "string")) &&
    "result" in value
  );
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return isJsonRpcSuccessResponse(value) || isJsonRpcErrorResponse(value);
}
