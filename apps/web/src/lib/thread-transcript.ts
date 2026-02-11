import type { TranscriptItem, TranscriptMessageItem, TranscriptReasoningItem, TranscriptToolItem } from "../state/app-state.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function extractUserInputText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  const lines: string[] = [];
  for (const rawInput of content) {
    const input = asRecord(rawInput);
    if (!input) {
      continue;
    }

    const type = asString(input.type);
    if (type === "text") {
      const text = asString(input.text);
      if (text) {
        lines.push(text);
      }
      continue;
    }

    if (type === "skill") {
      const name = asString(input.name);
      if (name) {
        lines.push(`$${name}`);
      }
      continue;
    }

    if (type === "image" || type === "localImage" || type === "local_image") {
      lines.push("[image]");
    }
  }

  return lines.join("\n").trim();
}

function commandSummary(item: Record<string, unknown>): string {
  const command = item.command;
  if (Array.isArray(command)) {
    const parts = command.filter((entry): entry is string => typeof entry === "string");
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  const text = asString(command);
  return text ?? "Command";
}

function fileChangeSummary(item: Record<string, unknown>): string | null {
  const changes = item.changes;
  if (!Array.isArray(changes)) {
    return null;
  }

  const paths: string[] = [];
  for (const rawChange of changes) {
    const change = asRecord(rawChange);
    if (!change) {
      continue;
    }

    const path = asString(change.path);
    if (path) {
      paths.push(path);
    }
  }

  if (paths.length === 0) {
    return null;
  }

  return paths.join(", ");
}

function toolItemFromRecord(item: Record<string, unknown>, turnId: string | undefined): TranscriptToolItem {
  const type = asString(item.type) ?? "tool";
  const id = asString(item.id) ?? type;

  if (type === "commandExecution") {
    const detail = asString(item.cwd);
    const output = asString(item.aggregatedOutput) ?? asString(item.output) ?? undefined;
    return {
      id,
      kind: "tool",
      title: commandSummary(item),
      ...(detail ? { detail } : {}),
      ...(output ? { output } : {}),
      ...(turnId ? { turnId } : {}),
      runtimeItemId: id
    };
  }

  if (type === "fileChange") {
    const detail = fileChangeSummary(item) ?? asString(item.status);
    const output = asString(item.output) ?? undefined;
    return {
      id,
      kind: "tool",
      title: "File changes",
      ...(detail ? { detail } : {}),
      ...(output ? { output } : {}),
      ...(turnId ? { turnId } : {}),
      runtimeItemId: id
    };
  }

  const detail = asString(item.detail) ?? asString(item.status);
  const output = asString(item.output) ?? undefined;
  return {
    id,
    kind: "tool",
    title: `Item: ${type}`,
    ...(detail ? { detail } : {}),
    ...(output ? { output } : {}),
    ...(turnId ? { turnId } : {}),
    runtimeItemId: id
  };
}

function transcriptItemFromRecord(item: Record<string, unknown>, turnId: string | undefined): TranscriptItem | null {
  const type = asString(item.type);
  if (!type) {
    return null;
  }

  const id = asString(item.id) ?? `${type}-unknown`;

  if (type === "userMessage") {
    const text = extractUserInputText(item.content);
    return {
      id,
      kind: "message",
      role: "user",
      text: text.length > 0 ? text : "[message]",
      ...(turnId ? { turnId } : {}),
      runtimeItemId: id
    } satisfies TranscriptMessageItem;
  }

  if (type === "agentMessage") {
    const text = asString(item.text) ?? "";
    return {
      id,
      kind: "message",
      role: "assistant",
      text,
      ...(turnId ? { turnId } : {}),
      runtimeItemId: id
    } satisfies TranscriptMessageItem;
  }

  if (type === "reasoning") {
    const summary = asString(item.summary) ?? asStringArray(item.summary).join("\n");
    const content = asString(item.content) ?? asStringArray(item.content).join("\n");
    return {
      id,
      kind: "reasoning",
      summary,
      content,
      ...(turnId ? { turnId } : {}),
      runtimeItemId: id
    } satisfies TranscriptReasoningItem;
  }

  return toolItemFromRecord(item, turnId);
}

export function transcriptItemsFromThreadReadResult(result: unknown): TranscriptItem[] {
  const resultRecord = asRecord(result);
  const thread = asRecord(resultRecord?.thread);
  if (!thread) {
    return [];
  }

  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const items: TranscriptItem[] = [];

  for (const rawTurn of turns) {
    const turn = asRecord(rawTurn);
    if (!turn) {
      continue;
    }

    const turnId = asString(turn.id) ?? undefined;
    const turnItems = Array.isArray(turn.items) ? turn.items : [];

    for (const rawItem of turnItems) {
      const itemRecord = asRecord(rawItem);
      if (!itemRecord) {
        continue;
      }

      const transcriptItem = transcriptItemFromRecord(itemRecord, turnId);
      if (transcriptItem) {
        items.push(transcriptItem);
      }
    }
  }

  return items;
}

export interface ParsedWorkspaceRuntimeNotification {
  sequence: number | null;
  method: string;
  params: Record<string, unknown>;
}

export function parseWorkspaceRuntimeNotification(
  eventPayload: unknown
): ParsedWorkspaceRuntimeNotification | null {
  const envelope = asRecord(eventPayload);
  if (!envelope || envelope.type !== "workspace_runtime_event") {
    return null;
  }

  const event = asRecord(envelope.event);
  const payload = asRecord(event?.payload);
  const method = asString(payload?.method);
  if (!method) {
    return null;
  }

  const params = asRecord(payload?.params) ?? {};
  const sequence = typeof event?.sequence === "number" ? event.sequence : null;

  return {
    sequence,
    method,
    params
  };
}

export function extractThreadIdFromRuntimeParams(params: Record<string, unknown>): string | null {
  const direct =
    asString(params.threadId) ??
    asString(params.thread_id) ??
    asString(params.conversationId) ??
    asString(params.conversation_id);
  if (direct) {
    return direct;
  }

  const turn = asRecord(params.turn);
  return asString(turn?.threadId) ?? asString(turn?.thread_id);
}

export function extractTurnIdFromRuntimeParams(params: Record<string, unknown>): string | null {
  const direct = asString(params.turnId) ?? asString(params.turn_id);
  if (direct) {
    return direct;
  }

  const turn = asRecord(params.turn);
  return asString(turn?.id);
}

export function transcriptItemFromRuntimeItem(
  rawItem: unknown,
  options: {
    turnId?: string;
  } = {}
): TranscriptItem | null {
  const item = asRecord(rawItem);
  if (!item) {
    return null;
  }

  return transcriptItemFromRecord(item, options.turnId);
}

function findItemIndex(items: TranscriptItem[], incoming: TranscriptItem): number {
  const runtimeItemId = incoming.runtimeItemId;
  return items.findIndex((item) => {
    if (runtimeItemId && item.runtimeItemId && runtimeItemId === item.runtimeItemId) {
      return true;
    }

    return item.id === incoming.id;
  });
}

function mergedMessageItem(existing: TranscriptMessageItem, incoming: TranscriptMessageItem): TranscriptMessageItem {
  const incomingText = incoming.text.length >= existing.text.length ? incoming.text : existing.text;
  const streaming = incoming.streaming ?? existing.streaming;

  return {
    ...existing,
    ...incoming,
    text: incomingText,
    ...(streaming !== undefined ? { streaming } : {})
  };
}

function mergedReasoningItem(
  existing: TranscriptReasoningItem,
  incoming: TranscriptReasoningItem
): TranscriptReasoningItem {
  const streaming = incoming.streaming ?? existing.streaming;

  return {
    ...existing,
    ...incoming,
    summary: incoming.summary.length >= existing.summary.length ? incoming.summary : existing.summary,
    content: incoming.content.length >= existing.content.length ? incoming.content : existing.content,
    ...(streaming !== undefined ? { streaming } : {})
  };
}

function mergedToolItem(existing: TranscriptToolItem, incoming: TranscriptToolItem): TranscriptToolItem {
  const incomingOutput = incoming.output ?? "";
  const existingOutput = existing.output ?? "";
  const mergedOutput = incomingOutput.length >= existingOutput.length ? incoming.output : existing.output;
  const streaming = incoming.streaming ?? existing.streaming;

  return {
    ...existing,
    ...incoming,
    ...(mergedOutput !== undefined ? { output: mergedOutput } : {}),
    ...(streaming !== undefined ? { streaming } : {})
  };
}

export function upsertTranscriptItem(items: TranscriptItem[], incoming: TranscriptItem): TranscriptItem[] {
  const existingIndex = findItemIndex(items, incoming);

  if (existingIndex < 0) {
    return [...items, incoming];
  }

  const existingItem = items[existingIndex];
  if (!existingItem) {
    return [...items, incoming];
  }
  const nextItems = [...items];

  if (existingItem.kind === "message" && incoming.kind === "message") {
    nextItems[existingIndex] = mergedMessageItem(existingItem, incoming);
    return nextItems;
  }

  if (existingItem.kind === "reasoning" && incoming.kind === "reasoning") {
    nextItems[existingIndex] = mergedReasoningItem(existingItem, incoming);
    return nextItems;
  }

  if (existingItem.kind === "tool" && incoming.kind === "tool") {
    nextItems[existingIndex] = mergedToolItem(existingItem, incoming);
    return nextItems;
  }

  nextItems[existingIndex] = incoming;
  return nextItems;
}

export function appendAgentMessageDelta(
  items: TranscriptItem[],
  options: {
    itemId: string;
    delta: string;
    turnId?: string;
  }
): TranscriptItem[] {
  if (options.delta.length === 0) {
    return items;
  }

  const incoming: TranscriptMessageItem = {
    id: options.itemId,
    kind: "message",
    role: "assistant",
    text: options.delta,
    ...(options.turnId ? { turnId: options.turnId } : {}),
    runtimeItemId: options.itemId,
    streaming: true
  };
  const existingIndex = findItemIndex(items, incoming);
  if (existingIndex < 0) {
    return [...items, incoming];
  }

  const existing = items[existingIndex];
  if (!existing) {
    return [...items, incoming];
  }
  if (existing.kind !== "message" || existing.role !== "assistant") {
    return upsertTranscriptItem(items, incoming);
  }

  const nextItems = [...items];
  const updated: TranscriptMessageItem = {
    ...existing,
    text: `${existing.text}${options.delta}`,
    streaming: true,
    ...(options.turnId ? { turnId: options.turnId } : {})
  };
  nextItems[existingIndex] = updated;
  return nextItems;
}

function appendReasoningDelta(
  items: TranscriptItem[],
  options: {
    itemId: string;
    delta: string;
    turnId?: string;
    target: "summary" | "content";
  }
): TranscriptItem[] {
  if (options.delta.length === 0) {
    return items;
  }

  const incoming: TranscriptReasoningItem = {
    id: options.itemId,
    kind: "reasoning",
    summary: options.target === "summary" ? options.delta : "",
    content: options.target === "content" ? options.delta : "",
    ...(options.turnId ? { turnId: options.turnId } : {}),
    runtimeItemId: options.itemId,
    streaming: true
  };
  const existingIndex = findItemIndex(items, incoming);
  if (existingIndex < 0) {
    return [...items, incoming];
  }

  const existing = items[existingIndex];
  if (!existing) {
    return [...items, incoming];
  }
  if (existing.kind !== "reasoning") {
    return upsertTranscriptItem(items, incoming);
  }

  const nextItems = [...items];
  const updated: TranscriptReasoningItem = {
    ...existing,
    summary: options.target === "summary" ? `${existing.summary}${options.delta}` : existing.summary,
    content: options.target === "content" ? `${existing.content}${options.delta}` : existing.content,
    streaming: true,
    ...(options.turnId ? { turnId: options.turnId } : {})
  };
  nextItems[existingIndex] = updated;
  return nextItems;
}

export function appendReasoningSummaryDelta(
  items: TranscriptItem[],
  options: {
    itemId: string;
    delta: string;
    turnId?: string;
  }
): TranscriptItem[] {
  return appendReasoningDelta(items, {
    ...options,
    target: "summary"
  });
}

export function appendReasoningContentDelta(
  items: TranscriptItem[],
  options: {
    itemId: string;
    delta: string;
    turnId?: string;
  }
): TranscriptItem[] {
  return appendReasoningDelta(items, {
    ...options,
    target: "content"
  });
}

export function setTranscriptItemStreaming(
  items: TranscriptItem[],
  options: {
    itemId: string;
    streaming: boolean;
  }
): TranscriptItem[] {
  const targetIndex = items.findIndex((item) => {
    if (item.runtimeItemId && item.runtimeItemId === options.itemId) {
      return true;
    }

    return item.id === options.itemId;
  });

  if (targetIndex < 0) {
    return items;
  }

  const nextItems = [...items];
  const existingItem = nextItems[targetIndex];
  if (!existingItem) {
    return items;
  }

  nextItems[targetIndex] = {
    ...existingItem,
    streaming: options.streaming
  };
  return nextItems;
}
