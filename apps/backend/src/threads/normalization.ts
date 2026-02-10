export interface NormalizedThreadSummary {
  threadId: string;
  title?: string | null;
  archived?: boolean;
  rawPayload: unknown;
}

function extractThreadId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { id?: unknown; threadId?: unknown };
  if (typeof candidate.threadId === "string") {
    return candidate.threadId;
  }
  if (typeof candidate.id === "string") {
    return candidate.id;
  }

  return null;
}

export function normalizeThreadSummaries(payload: unknown): NormalizedThreadSummary[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const objectPayload = payload as {
    threadId?: unknown;
    thread?: unknown;
    threads?: unknown;
  };

  const results: NormalizedThreadSummary[] = [];

  if (typeof objectPayload.threadId === "string") {
    results.push({
      threadId: objectPayload.threadId,
      rawPayload: payload
    });
  }

  const threadIdFromThreadObject = extractThreadId(objectPayload.thread);
  if (threadIdFromThreadObject) {
    const threadObject = objectPayload.thread as { title?: unknown; archived?: unknown };
    const archived =
      typeof threadObject.archived === "boolean" ? threadObject.archived : undefined;
    results.push({
      threadId: threadIdFromThreadObject,
      title: typeof threadObject.title === "string" ? threadObject.title : null,
      ...(archived === undefined ? {} : { archived }),
      rawPayload: objectPayload.thread
    });
  }

  if (Array.isArray(objectPayload.threads)) {
    for (const threadPayload of objectPayload.threads) {
      const threadId = extractThreadId(threadPayload);
      if (!threadId) {
        continue;
      }

      const thread = threadPayload as { title?: unknown; archived?: unknown };
      const archived = typeof thread.archived === "boolean" ? thread.archived : undefined;
      results.push({
        threadId,
        title: typeof thread.title === "string" ? thread.title : null,
        ...(archived === undefined ? {} : { archived }),
        rawPayload: threadPayload
      });
    }
  }

  const dedupedByThreadId = new Map<string, NormalizedThreadSummary>();
  for (const summary of results) {
    if (!dedupedByThreadId.has(summary.threadId)) {
      dedupedByThreadId.set(summary.threadId, summary);
    }
  }

  return [...dedupedByThreadId.values()];
}
