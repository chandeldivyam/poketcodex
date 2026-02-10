import type { ThreadListResponse, ThreadMetadataRecord } from "./api-client.js";

export interface ThreadListItem {
  threadId: string;
  title: string;
  archived: boolean;
}

const THREAD_SUMMARY_KEYS = ["status", "threadId", "turnId", "itemId", "reason"] as const;

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

function truncateValue(value: string, maxLength = 90): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
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

export function formatWorkspaceEvent(eventPayload: unknown): string {
  if (!eventPayload || typeof eventPayload !== "object") {
    return "[unknown event]";
  }

  const baseEnvelope = eventPayload as { type?: unknown };
  if (baseEnvelope.type === "connected") {
    return "[socket] subscribed to workspace events";
  }

  if (baseEnvelope.type === "parse_error") {
    return "[socket] received non-JSON event payload";
  }

  const envelope = eventPayload as {
    type?: unknown;
    event?: {
      kind?: unknown;
      payload?: {
        method?: unknown;
        params?: unknown;
      };
      sequence?: unknown;
    };
  };

  if (envelope.type !== "workspace_runtime_event") {
    return "[system] event received";
  }

  const sequence = typeof envelope.event?.sequence === "number" ? envelope.event.sequence : -1;
  const kind = typeof envelope.event?.kind === "string" ? envelope.event.kind : "unknown";
  const method =
    envelope.event?.payload && typeof envelope.event.payload.method === "string"
      ? envelope.event.payload.method
      : null;
  const params = envelope.event?.payload?.params;
  const prefix = sequence >= 0 ? `#${sequence}` : "#?";

  if (method) {
    const summary = formatParamsSummary(params);
    return summary ? `${prefix} ${method} ${summary}` : `${prefix} ${method}`;
  }

  if (kind === "stateChanged") {
    const statePayload = envelope.event?.payload;
    const stateRecord = statePayload && typeof statePayload === "object" ? (statePayload as { state?: unknown }) : undefined;
    return `${prefix} runtime-state ${typeof stateRecord?.state === "string" ? stateRecord.state : "updated"}`;
  }

  if (kind === "stderr") {
    const message = formatParamsSummary(envelope.event?.payload);
    return message ? `${prefix} runtime-stderr ${message}` : `${prefix} runtime-stderr`;
  }

  const fallback = formatParamsSummary(envelope.event?.payload);
  return fallback ? `${prefix} ${kind} ${fallback}` : `${prefix} ${kind}`;
}
