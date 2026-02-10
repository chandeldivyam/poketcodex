import type { ThreadListResponse, ThreadMetadataRecord } from "./api-client.js";

export interface ThreadListItem {
  threadId: string;
  title: string;
  archived: boolean;
}

export interface FormatWorkspaceEventOptions {
  includeNoise?: boolean;
}

export type WorkspaceTimelineCategory = "message" | "reasoning" | "tool" | "status" | "system" | "error";
export type WorkspaceTurnSignal = "running" | "completed" | "interrupted" | "failed";

export interface NormalizedWorkspaceTimelineEvent {
  message: string;
  kind: "runtime" | "socket" | "system" | "error";
  category: WorkspaceTimelineCategory;
  isInternal: boolean;
  source?: string;
  details?: string;
  turnSignal?: WorkspaceTurnSignal;
}

interface RuntimeEventShape {
  sequence: number | null;
  kind: string;
  method: string | null;
  params: unknown;
  payload: unknown;
}

const THREAD_SUMMARY_KEYS = ["status", "threadId", "turnId", "itemId", "reason"] as const;
const NOISE_EVENT_METHODS = new Set(["codex/event/skills_update_available"]);

function extractThreadIdFromUnknown(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { threadId?: unknown; id?: unknown; thread_id?: unknown };
  if (typeof candidate.threadId === "string") {
    return candidate.threadId;
  }
  if (typeof candidate.id === "string") {
    return candidate.id;
  }
  if (typeof candidate.thread_id === "string") {
    return candidate.thread_id;
  }

  return null;
}

function mapMetadataThread(record: ThreadMetadataRecord): ThreadListItem {
  return {
    threadId: record.threadId,
    title: record.title || record.threadId,
    archived: record.archived
  };
}

function truncateValue(value: string, maxLength = 90): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function stringifyDetails(value: unknown, maxLength = 1200): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return truncateValue(value, maxLength);
  }

  try {
    const pretty = JSON.stringify(value, null, 2);
    if (!pretty) {
      return undefined;
    }

    if (pretty.length <= maxLength) {
      return pretty;
    }

    return `${pretty.slice(0, maxLength - 3)}...`;
  } catch {
    return "[unserializable payload]";
  }
}

interface OptionalEventFields {
  source?: string;
  details?: string;
  turnSignal?: WorkspaceTurnSignal;
}

function withOptionalFields<TBase extends Omit<NormalizedWorkspaceTimelineEvent, "source" | "details" | "turnSignal">>(
  baseEvent: TBase,
  optionalFields: OptionalEventFields
): NormalizedWorkspaceTimelineEvent {
  return {
    ...baseEvent,
    ...(optionalFields.source !== undefined ? { source: optionalFields.source } : {}),
    ...(optionalFields.details !== undefined ? { details: optionalFields.details } : {}),
    ...(optionalFields.turnSignal !== undefined ? { turnSignal: optionalFields.turnSignal } : {})
  };
}

function buildOptionalEventFields(
  source: string | undefined,
  details: string | undefined,
  turnSignal?: WorkspaceTurnSignal
): OptionalEventFields {
  return {
    ...(source !== undefined ? { source } : {}),
    ...(details !== undefined ? { details } : {}),
    ...(turnSignal !== undefined ? { turnSignal } : {})
  };
}

function pickTextField(candidate: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return truncateValue(value);
    }
  }

  return null;
}

function formatParamsSummary(params: unknown): string | null {
  if (typeof params === "string" && params.trim().length > 0) {
    return truncateValue(params);
  }

  if (!params || typeof params !== "object") {
    return null;
  }

  const payload = params as Record<string, unknown>;
  const details: string[] = [];

  for (const key of THREAD_SUMMARY_KEYS) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      details.push(`${key}=${truncateValue(value, 40)}`);
    }
  }

  const message = pickTextField(payload, ["message", "text", "delta", "content"]);
  if (message) {
    details.push(`text="${message}"`);
  }

  if (details.length > 0) {
    return details.join(" ");
  }

  try {
    return truncateValue(JSON.stringify(payload));
  } catch {
    return "[unserializable params]";
  }
}

function parseRuntimeEventShape(eventPayload: unknown): RuntimeEventShape {
  const envelope = eventPayload as {
    event?: {
      kind?: unknown;
      payload?: unknown;
      sequence?: unknown;
    };
  };

  const sequence = typeof envelope.event?.sequence === "number" ? envelope.event.sequence : null;
  const kind = typeof envelope.event?.kind === "string" ? envelope.event.kind : "unknown";

  const rawPayload = envelope.event?.payload;
  const payloadObject = rawPayload && typeof rawPayload === "object" ? (rawPayload as Record<string, unknown>) : null;
  const method = payloadObject && typeof payloadObject.method === "string" ? payloadObject.method : null;
  const params = method ? payloadObject?.params : rawPayload;

  return {
    sequence,
    kind,
    method,
    params,
    payload: rawPayload
  };
}

function isNoiseMethod(method: string): boolean {
  return NOISE_EVENT_METHODS.has(method);
}

function isInternalMethod(method: string): boolean {
  return method.startsWith("codex/event/") || method.startsWith("codex/internal/") || isNoiseMethod(method);
}

function isErrorStatus(params: unknown): boolean {
  if (!params || typeof params !== "object") {
    return false;
  }

  const payload = params as Record<string, unknown>;
  const status = payload.status;
  if (typeof status === "string") {
    const normalized = status.toLowerCase();
    return normalized.includes("error") || normalized.includes("fail");
  }

  return false;
}

function classifyMethodCategory(method: string, params: unknown): WorkspaceTimelineCategory {
  const normalized = method.toLowerCase();

  if (normalized.includes("error") || normalized.includes("fail") || isErrorStatus(params)) {
    return "error";
  }

  if (normalized.includes("reason") || normalized.includes("thought")) {
    return "reasoning";
  }

  if (normalized.includes("tool") || normalized.includes("command") || normalized.includes("approval")) {
    return "tool";
  }

  if (normalized.includes("message") || normalized.includes("delta") || normalized.includes("text") || normalized.includes("output")) {
    return "message";
  }

  return "status";
}

function turnSignalFromStatus(params: unknown): WorkspaceTurnSignal | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }

  const payload = params as Record<string, unknown>;
  const statusValue = payload.status;
  if (typeof statusValue !== "string") {
    return undefined;
  }

  const normalized = statusValue.toLowerCase();

  if (normalized.includes("interrupt") || normalized.includes("cancel") || normalized.includes("abort")) {
    return "interrupted";
  }

  if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("reject")) {
    return "failed";
  }

  if (normalized.includes("complete") || normalized.includes("success") || normalized.includes("done")) {
    return "completed";
  }

  if (normalized.includes("run") || normalized.includes("progress") || normalized.includes("stream") || normalized.includes("start")) {
    return "running";
  }

  return undefined;
}

function turnSignalFromMethod(method: string): WorkspaceTurnSignal | undefined {
  const normalized = method.toLowerCase();

  if (normalized.includes("turn/interrupted") || normalized.includes("turn/cancelled") || normalized.includes("turn/aborted")) {
    return "interrupted";
  }

  if (normalized.includes("turn/failed") || normalized.includes("turn/error")) {
    return "failed";
  }

  if (normalized.includes("turn/completed") || normalized.includes("turn/done")) {
    return "completed";
  }

  if (normalized.includes("turn/start") || normalized.includes("turn/started") || normalized.includes("turn/created")) {
    return "running";
  }

  return undefined;
}

function detectTurnSignal(method: string, params: unknown): WorkspaceTurnSignal | undefined {
  return turnSignalFromStatus(params) ?? turnSignalFromMethod(method);
}

function formatSequencePrefix(sequence: number | null): string {
  return sequence === null ? "#?" : `#${sequence}`;
}

export function normalizeThreadList(response: ThreadListResponse): ThreadListItem[] {
  if (response.metadata.length > 0) {
    return response.metadata.map(mapMetadataThread);
  }

  const remote = response.remote;
  if (!remote || typeof remote !== "object") {
    return [];
  }

  const remotePayload = remote as { threads?: unknown; data?: unknown };
  const rawThreads = Array.isArray(remotePayload.threads)
    ? remotePayload.threads
    : Array.isArray(remotePayload.data)
      ? remotePayload.data
      : [];

  return rawThreads
    .map((threadPayload) => {
      const threadId = extractThreadIdFromUnknown(threadPayload);
      if (!threadId) {
        return null;
      }

      const thread = threadPayload as { title?: unknown; preview?: unknown; archived?: unknown };
      const titleCandidate = typeof thread.title === "string" ? thread.title : thread.preview;

      return {
        threadId,
        title:
          typeof titleCandidate === "string" && titleCandidate.trim().length > 0
            ? titleCandidate
            : threadId,
        archived: thread.archived === true
      } satisfies ThreadListItem;
    })
    .filter((thread): thread is ThreadListItem => thread !== null);
}

export function extractThreadIdFromTurnResult(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const payload = result as { threadId?: unknown; thread?: unknown; thread_id?: unknown };
  if (typeof payload.threadId === "string") {
    return payload.threadId;
  }
  if (typeof payload.thread_id === "string") {
    return payload.thread_id;
  }

  return extractThreadIdFromUnknown(payload.thread);
}

export function formatWorkspaceEvent(eventPayload: unknown, options: FormatWorkspaceEventOptions = {}): string {
  if (!eventPayload || typeof eventPayload !== "object") {
    return "[unknown event]";
  }

  const baseEnvelope = eventPayload as { type?: unknown; raw?: unknown };
  if (baseEnvelope.type === "connected") {
    return "[socket] subscribed to workspace events";
  }

  if (baseEnvelope.type === "parse_error") {
    return "[socket] received non-JSON event payload";
  }

  if (baseEnvelope.type !== "workspace_runtime_event") {
    return "[system] event received";
  }

  const runtime = parseRuntimeEventShape(eventPayload);
  const prefix = formatSequencePrefix(runtime.sequence);

  if (runtime.method) {
    if (isNoiseMethod(runtime.method) && !options.includeNoise) {
      return "";
    }

    const summary = formatParamsSummary(runtime.params);
    return summary ? `${prefix} ${runtime.method} ${summary}` : `${prefix} ${runtime.method}`;
  }

  if (runtime.kind === "stateChanged") {
    const stateRecord = runtime.payload && typeof runtime.payload === "object" ? (runtime.payload as { state?: unknown }) : undefined;
    return `${prefix} runtime-state ${typeof stateRecord?.state === "string" ? stateRecord.state : "updated"}`;
  }

  if (runtime.kind === "stderr") {
    const message = formatParamsSummary(runtime.payload);
    return message ? `${prefix} runtime-stderr ${message}` : `${prefix} runtime-stderr`;
  }

  const fallback = formatParamsSummary(runtime.payload);
  return fallback ? `${prefix} ${runtime.kind} ${fallback}` : `${prefix} ${runtime.kind}`;
}

export function normalizeWorkspaceTimelineEvent(
  eventPayload: unknown,
  options: FormatWorkspaceEventOptions = {}
): NormalizedWorkspaceTimelineEvent | null {
  const message = formatWorkspaceEvent(eventPayload, options);
  if (message.length === 0) {
    return null;
  }

  if (!eventPayload || typeof eventPayload !== "object") {
    return {
      message,
      kind: "system",
      category: "system",
      isInternal: false,
      source: "unknown_event"
    };
  }

  const baseEnvelope = eventPayload as { type?: unknown; raw?: unknown };
  if (baseEnvelope.type === "connected") {
    return {
      message,
      kind: "socket",
      category: "status",
      isInternal: false,
      source: "workspace_events"
    };
  }

  if (baseEnvelope.type === "parse_error") {
    return withOptionalFields(
      {
        message,
        kind: "error",
        category: "error",
        isInternal: true
      },
      buildOptionalEventFields("parse_error", stringifyDetails(baseEnvelope.raw))
    );
  }

  if (baseEnvelope.type !== "workspace_runtime_event") {
    return withOptionalFields(
      {
        message,
        kind: "system",
        category: "system",
        isInternal: false
      },
      buildOptionalEventFields(
        typeof baseEnvelope.type === "string" ? baseEnvelope.type : "system_event",
        stringifyDetails(eventPayload)
      )
    );
  }

  const runtime = parseRuntimeEventShape(eventPayload);

  if (runtime.method) {
    const category = classifyMethodCategory(runtime.method, runtime.params);
    const turnSignal = detectTurnSignal(runtime.method, runtime.params);

    return withOptionalFields(
      {
        message,
        kind: category === "error" ? "error" : "runtime",
        category,
        isInternal: isInternalMethod(runtime.method)
      },
      buildOptionalEventFields(
        runtime.method,
        stringifyDetails({
          sequence: runtime.sequence,
          method: runtime.method,
          params: runtime.params
        }),
        turnSignal
      )
    );
  }

  if (runtime.kind === "stderr") {
    return withOptionalFields(
      {
        message,
        kind: "error",
        category: "error",
        isInternal: false
      },
      buildOptionalEventFields("runtime-stderr", stringifyDetails(runtime.payload))
    );
  }

  if (runtime.kind === "stateChanged") {
    return withOptionalFields(
      {
        message,
        kind: "runtime",
        category: "status",
        isInternal: false
      },
      buildOptionalEventFields("runtime-state", stringifyDetails(runtime.payload))
    );
  }

  return withOptionalFields(
    {
      message,
      kind: "runtime",
      category: "status",
      isInternal: false
    },
    buildOptionalEventFields(runtime.kind, stringifyDetails(runtime.payload))
  );
}
