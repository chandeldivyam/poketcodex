import { ApiClient, ApiClientError, type WorkspaceRecord } from "./lib/api-client.js";
import {
  extractThreadIdFromTurnResult,
  normalizeWorkspaceTimelineEvent,
  normalizeThreadList,
  type ThreadListItem,
  type WorkspaceTimelineCategory,
  type WorkspaceTurnSignal
} from "./lib/normalize.js";
import {
  appendAgentMessageDelta,
  appendReasoningContentDelta,
  appendReasoningSummaryDelta,
  extractThreadIdFromRuntimeParams,
  extractTurnIdFromRuntimeParams,
  parseWorkspaceRuntimeNotification,
  setTranscriptItemStreaming,
  transcriptItemFromRuntimeItem,
  transcriptItemsFromThreadReadResult,
  upsertTranscriptItem
} from "./lib/thread-transcript.js";
import { ReconnectingWorkspaceSocket } from "./lib/ws-reconnect.js";
import type {
  AppState,
  AppStateKey,
  ThreadTranscriptHydration,
  ThreadTranscriptState,
  TimelineEventCategory,
  TimelineEventEntry,
  TimelineEventKind,
  TranscriptItem,
  TurnExecutionPhase
} from "./state/app-state.js";
import { selectActiveWorkspace } from "./state/selectors.js";
import { AppStore } from "./state/store.js";
import { AppRenderer } from "./ui/app-renderer.js";
import { createAppShell } from "./ui/app-shell.js";
import "./styles.css";

const STORAGE_SELECTED_WORKSPACE_KEY = "poketcodex.selectedWorkspaceId";
const STORAGE_SELECTED_THREAD_KEY = "poketcodex.selectedThreadId";
const STORAGE_SHOW_INTERNAL_EVENTS_KEY = "poketcodex.showInternalEvents";
const STORAGE_SHOW_STATUS_EVENTS_KEY = "poketcodex.showStatusEvents";
const MAX_STORED_EVENTS = 240;
const RUNTIME_EVENT_BATCH_MS = 48;
const MAX_TRANSCRIPT_ITEMS = 320;

const rootElement = document.querySelector<HTMLDivElement>("#app");

if (!rootElement) {
  throw new Error("App root element is missing");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function createDefaultThreadTranscriptState(
  hydration: ThreadTranscriptHydration = "idle",
  items: TranscriptItem[] = [],
  lastAppliedSequence = 0
): ThreadTranscriptState {
  return {
    hydration,
    items,
    lastAppliedSequence
  };
}

function trimTranscriptItems(items: TranscriptItem[]): TranscriptItem[] {
  if (items.length <= MAX_TRANSCRIPT_ITEMS) {
    return items;
  }

  return items.slice(items.length - MAX_TRANSCRIPT_ITEMS);
}

function parseThreadStatusSignal(method: string, params: Record<string, unknown>): boolean | null {
  if (method === "turn/started" || method === "turn/start") {
    return true;
  }

  if (
    method === "turn/completed" ||
    method === "turn/interrupted" ||
    method === "turn/failed" ||
    method === "turn/cancelled" ||
    method === "turn/aborted" ||
    method === "turn/error"
  ) {
    return false;
  }

  if (!method.startsWith("turn/")) {
    return null;
  }

  const status = asNonEmptyString(params.status)?.toLowerCase();
  if (!status) {
    return null;
  }

  if (status.includes("run") || status.includes("progress") || status.includes("stream") || status.includes("start")) {
    return true;
  }

  if (
    status.includes("complete") ||
    status.includes("done") ||
    status.includes("success") ||
    status.includes("interrupt") ||
    status.includes("cancel") ||
    status.includes("abort") ||
    status.includes("fail") ||
    status.includes("error")
  ) {
    return false;
  }

  return null;
}

function readStorageValue(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, value);
  } catch {
    // Ignore private browsing/storage permission errors.
  }
}

function readStorageBoolean(key: string, fallback = false): boolean {
  const value = readStorageValue(key);
  if (value === null) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }

  return fallback;
}

function writeStorageBoolean(key: string, value: boolean): void {
  writeStorageValue(key, value ? "1" : "0");
}

const initialState: AppState = {
  session: {
    authenticated: false,
    csrfToken: null,
    busy: false,
    error: null,
    errorRetryLabel: null
  },
  workspace: {
    workspaces: [],
    selectedWorkspaceId: readStorageValue(STORAGE_SELECTED_WORKSPACE_KEY)
  },
  thread: {
    threads: [],
    selectedThreadId: readStorageValue(STORAGE_SELECTED_THREAD_KEY),
    transcriptsByThreadId: {},
    runningByThreadId: {},
    unreadByThreadId: {}
  },
  stream: {
    socketState: "disconnected",
    draftPrompt: "",
    events: [],
    showInternalEvents: readStorageBoolean(STORAGE_SHOW_INTERNAL_EVENTS_KEY, false),
    showStatusEvents: readStorageBoolean(STORAGE_SHOW_STATUS_EVENTS_KEY, false),
    turnPhase: "idle",
    turnStartedAtMs: null
  }
};

const apiClient = new ApiClient("");
const store = new AppStore(initialState);
const dom = createAppShell(rootElement);
const renderer = new AppRenderer(dom, () => store.getState());

let workspaceSocket: ReconnectingWorkspaceSocket | undefined;
let workspaceSocketWorkspaceId: string | null = null;
let renderScheduled = false;
let eventSequence = 0;
let runtimeEventFlushTimer: number | undefined;
const pendingRuntimeEvents: Array<{
  workspaceId: string;
  message: string;
  kind: TimelineEventKind;
  options: AppendEventOptions;
}> = [];
const pendingChangedSlices = new Set<AppStateKey>();
const draftCacheByContext = new Map<string, string>();
type RetryAction = {
  label: string;
  run: () => Promise<void>;
};
interface ApiErrorHandlingOptions {
  action?: string;
  context?: string | null;
  nextStep?: string;
  retryAction?: RetryAction | null;
}
let pendingRetryAction: RetryAction | null = null;

store.subscribe((_state, changedSlices) => {
  for (const key of changedSlices) {
    pendingChangedSlices.add(key);
  }

  scheduleRender();
});

function scheduleRender(): void {
  if (renderScheduled) {
    return;
  }

  renderScheduled = true;

  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(flushRender);
    return;
  }

  window.setTimeout(flushRender, 16);
}

function flushRender(): void {
  renderScheduled = false;

  if (pendingChangedSlices.size === 0) {
    return;
  }

  const changedSlices = new Set(pendingChangedSlices);
  pendingChangedSlices.clear();
  renderer.render(changedSlices);
}

function setSelectedWorkspaceId(workspaceId: string | null): void {
  writeStorageValue(STORAGE_SELECTED_WORKSPACE_KEY, workspaceId);
  store.patchSlice("workspace", {
    selectedWorkspaceId: workspaceId
  });
}

function setSelectedThreadId(threadId: string | null): void {
  writeStorageValue(STORAGE_SELECTED_THREAD_KEY, threadId);
  store.updateSlice("thread", (thread) => {
    const shouldClearUnread = threadId !== null && thread.unreadByThreadId[threadId] === true;
    const nextUnreadByThreadId = shouldClearUnread
      ? {
          ...thread.unreadByThreadId,
          [threadId]: false
        }
      : thread.unreadByThreadId;

    if (thread.selectedThreadId === threadId && nextUnreadByThreadId === thread.unreadByThreadId) {
      return thread;
    }

    return {
      ...thread,
      selectedThreadId: threadId,
      unreadByThreadId: nextUnreadByThreadId
    };
  });
}

function syncThreadMapsWithList(threads: ThreadListItem[]): void {
  store.updateSlice("thread", (thread) => {
    const nextTranscriptsByThreadId: Record<string, ThreadTranscriptState> = {};
    const nextRunningByThreadId: Record<string, boolean> = {};
    const nextUnreadByThreadId: Record<string, boolean> = {};

    for (const threadItem of threads) {
      nextTranscriptsByThreadId[threadItem.threadId] =
        thread.transcriptsByThreadId[threadItem.threadId] ?? createDefaultThreadTranscriptState();
      nextRunningByThreadId[threadItem.threadId] = thread.runningByThreadId[threadItem.threadId] ?? false;
      nextUnreadByThreadId[threadItem.threadId] = thread.unreadByThreadId[threadItem.threadId] ?? false;
    }

    return {
      ...thread,
      threads,
      transcriptsByThreadId: nextTranscriptsByThreadId,
      runningByThreadId: nextRunningByThreadId,
      unreadByThreadId: nextUnreadByThreadId
    };
  });
}

function upsertThreadPlaceholder(threadId: string): void {
  store.updateSlice("thread", (thread) => {
    const existingIndex = thread.threads.findIndex((threadEntry) => threadEntry.threadId === threadId);
    if (existingIndex >= 0) {
      return thread;
    }

    const now = new Date().toISOString();
    const placeholder: ThreadListItem = {
      threadId,
      title: threadId,
      archived: false,
      lastSeenAt: now
    };

    return {
      ...thread,
      threads: [placeholder, ...thread.threads],
      transcriptsByThreadId: {
        ...thread.transcriptsByThreadId,
        [threadId]: thread.transcriptsByThreadId[threadId] ?? createDefaultThreadTranscriptState()
      },
      runningByThreadId: {
        ...thread.runningByThreadId,
        [threadId]: thread.runningByThreadId[threadId] ?? false
      },
      unreadByThreadId: {
        ...thread.unreadByThreadId,
        [threadId]: thread.unreadByThreadId[threadId] ?? false
      }
    };
  });
}

function updateThreadTranscript(
  threadId: string,
  updater: (current: ThreadTranscriptState) => ThreadTranscriptState
): void {
  store.updateSlice("thread", (thread) => {
    const currentTranscript = thread.transcriptsByThreadId[threadId] ?? createDefaultThreadTranscriptState();
    const nextTranscript = updater(currentTranscript);

    if (nextTranscript === currentTranscript && thread.transcriptsByThreadId[threadId]) {
      return thread;
    }

    return {
      ...thread,
      transcriptsByThreadId: {
        ...thread.transcriptsByThreadId,
        [threadId]: nextTranscript
      }
    };
  });
}

function setThreadRunning(threadId: string, running: boolean): void {
  store.updateSlice("thread", (thread) => {
    if ((thread.runningByThreadId[threadId] ?? false) === running) {
      return thread;
    }

    return {
      ...thread,
      runningByThreadId: {
        ...thread.runningByThreadId,
        [threadId]: running
      }
    };
  });
}

function setThreadUnread(threadId: string, unread: boolean): void {
  store.updateSlice("thread", (thread) => {
    if ((thread.unreadByThreadId[threadId] ?? false) === unread) {
      return thread;
    }

    return {
      ...thread,
      unreadByThreadId: {
        ...thread.unreadByThreadId,
        [threadId]: unread
      }
    };
  });
}

function describeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `${error.statusCode}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "unknown error";
}

function buildDraftContextKey(workspaceId: string | null, threadId: string | null): string | null {
  if (!workspaceId) {
    return null;
  }

  return `${workspaceId}::${threadId ?? "__no_thread__"}`;
}

function updateDraftCacheForContext(contextKey: string | null, draftPrompt: string): void {
  if (!contextKey) {
    return;
  }

  if (draftPrompt.trim().length === 0) {
    draftCacheByContext.delete(contextKey);
    return;
  }

  draftCacheByContext.set(contextKey, draftPrompt);
}

function getCurrentDraftContextKey(): string | null {
  const state = store.getState();
  return buildDraftContextKey(state.workspace.selectedWorkspaceId, state.thread.selectedThreadId);
}

function persistCurrentDraftPrompt(): void {
  updateDraftCacheForContext(getCurrentDraftContextKey(), store.getState().stream.draftPrompt);
}

function setDraftPrompt(draftPrompt: string): void {
  store.patchSlice("stream", {
    draftPrompt
  });
}

function restoreDraftPrompt(workspaceId: string | null, threadId: string | null): void {
  const contextKey = buildDraftContextKey(workspaceId, threadId);
  const cachedPrompt = contextKey ? draftCacheByContext.get(contextKey) ?? "" : "";
  setDraftPrompt(cachedPrompt);
}

function describeWorkspaceContext(workspaceId: string | null): string | null {
  if (!workspaceId) {
    return null;
  }

  const workspace = store
    .getState()
    .workspace.workspaces.find((workspaceRecord) => workspaceRecord.workspaceId === workspaceId);

  return workspace ? `workspace "${workspace.displayName}"` : `workspace "${workspaceId}"`;
}

function describeThreadContext(threadId: string | null): string | null {
  if (!threadId) {
    return null;
  }

  return `thread "${threadId}"`;
}

function describeActionContext(workspaceId: string | null, threadId: string | null): string | null {
  const parts = [describeWorkspaceContext(workspaceId), describeThreadContext(threadId)].filter(
    (part): part is string => Boolean(part)
  );

  if (parts.length === 0) {
    return null;
  }

  return parts.join(", ");
}

function setError(message: string | null): void {
  pendingRetryAction = null;
  store.patchSlice("session", {
    error: message,
    errorRetryLabel: null
  });
}

function setRetryAction(action: RetryAction | null): void {
  pendingRetryAction = action;
  store.patchSlice("session", {
    errorRetryLabel: action?.label ?? null
  });
}

function clearError(): void {
  store.patchSlice("session", {
    error: null,
    errorRetryLabel: null
  });
  pendingRetryAction = null;
}

function setBusy(busy: boolean): void {
  store.patchSlice("session", {
    busy
  });
}

function setShowInternalEvents(showInternalEvents: boolean): void {
  writeStorageBoolean(STORAGE_SHOW_INTERNAL_EVENTS_KEY, showInternalEvents);
  store.patchSlice("stream", {
    showInternalEvents
  });
}

function setShowStatusEvents(showStatusEvents: boolean): void {
  writeStorageBoolean(STORAGE_SHOW_STATUS_EVENTS_KEY, showStatusEvents);
  store.patchSlice("stream", {
    showStatusEvents
  });
}

function setTurnExecutionPhase(
  turnPhase: TurnExecutionPhase,
  options: {
    preserveStartedAt?: boolean;
    explicitStartedAtMs?: number | null;
  } = {}
): void {
  store.updateSlice("stream", (stream) => {
    const nextStartedAtMs =
      options.explicitStartedAtMs !== undefined
        ? options.explicitStartedAtMs
        : options.preserveStartedAt
          ? stream.turnStartedAtMs
          : null;

    if (stream.turnPhase === turnPhase && stream.turnStartedAtMs === nextStartedAtMs) {
      return stream;
    }

    return {
      ...stream,
      turnPhase,
      turnStartedAtMs: nextStartedAtMs
    };
  });
}

function applyTurnSignal(turnSignal: WorkspaceTurnSignal | undefined): void {
  if (!turnSignal) {
    return;
  }

  store.updateSlice("stream", (stream) => {
    let nextPhase = stream.turnPhase;
    let nextStartedAtMs = stream.turnStartedAtMs;

    if (turnSignal === "running") {
      if (stream.turnPhase !== "interrupting") {
        nextPhase = "running";
      }
      if (nextStartedAtMs === null) {
        nextStartedAtMs = Date.now();
      }
    } else if (turnSignal === "completed" || turnSignal === "interrupted") {
      nextPhase = "idle";
      nextStartedAtMs = null;
    } else if (turnSignal === "failed") {
      nextPhase = "error";
      nextStartedAtMs = null;
    }

    if (nextPhase === stream.turnPhase && nextStartedAtMs === stream.turnStartedAtMs) {
      return stream;
    }

    return {
      ...stream,
      turnPhase: nextPhase,
      turnStartedAtMs: nextStartedAtMs
    };
  });
}

function activeWorkspace(): WorkspaceRecord | null {
  return selectActiveWorkspace(store.getState());
}

function mapCategoryFromKind(kind: TimelineEventKind): TimelineEventCategory {
  if (kind === "user") {
    return "input";
  }

  if (kind === "error") {
    return "error";
  }

  return "status";
}

function mapCategory(category: WorkspaceTimelineCategory): TimelineEventCategory {
  return category;
}

interface AppendEventOptions {
  category?: TimelineEventCategory;
  isInternal?: boolean;
  source?: string;
  details?: string;
}

interface TimelineEventDraft {
  message: string;
  kind: TimelineEventKind;
  options?: AppendEventOptions;
}

function createTimelineEntry(draft: TimelineEventDraft): TimelineEventEntry {
  const options = draft.options ?? {};

  return {
    id: `event-${eventSequence}`,
    timestamp: new Date().toLocaleTimeString(),
    message: draft.message,
    kind: draft.kind,
    category: options.category ?? mapCategoryFromKind(draft.kind),
    isInternal: options.isInternal ?? false,
    ...(options.source !== undefined ? { source: options.source } : {}),
    ...(options.details !== undefined ? { details: options.details } : {})
  };
}

function appendEvents(eventDrafts: TimelineEventDraft[]): void {
  if (eventDrafts.length === 0) {
    return;
  }

  store.updateSlice("stream", (stream) => {
    const nextEvents = [...stream.events];

    for (const eventDraft of eventDrafts) {
      nextEvents.push(createTimelineEntry(eventDraft));
      eventSequence += 1;
    }

    if (nextEvents.length > MAX_STORED_EVENTS) {
      nextEvents.splice(0, nextEvents.length - MAX_STORED_EVENTS);
    }

    return {
      ...stream,
      events: nextEvents
    };
  });
}

function appendEvent(message: string, kind: TimelineEventKind = "system", options: AppendEventOptions = {}): void {
  appendEvents([
    {
      message,
      kind,
      options
    }
  ]);
}

function flushRuntimeEventQueue(): void {
  if (runtimeEventFlushTimer !== undefined) {
    window.clearTimeout(runtimeEventFlushTimer);
    runtimeEventFlushTimer = undefined;
  }

  if (pendingRuntimeEvents.length === 0) {
    return;
  }

  const activeWorkspaceId = store.getState().workspace.selectedWorkspaceId;
  const drained = pendingRuntimeEvents.splice(0, pendingRuntimeEvents.length);
  const drafts: TimelineEventDraft[] = [];

  for (const queued of drained) {
    if (!activeWorkspaceId || queued.workspaceId !== activeWorkspaceId) {
      continue;
    }

    drafts.push({
      message: queued.message,
      kind: queued.kind,
      options: queued.options
    });
  }

  appendEvents(drafts);
}

function clearRuntimeEventQueue(): void {
  pendingRuntimeEvents.length = 0;

  if (runtimeEventFlushTimer !== undefined) {
    window.clearTimeout(runtimeEventFlushTimer);
    runtimeEventFlushTimer = undefined;
  }
}

function enqueueRuntimeEvent(
  workspaceId: string,
  message: string,
  kind: TimelineEventKind,
  options: AppendEventOptions
): void {
  pendingRuntimeEvents.push({
    workspaceId,
    message,
    kind,
    options
  });

  if (runtimeEventFlushTimer !== undefined) {
    return;
  }

  runtimeEventFlushTimer = window.setTimeout(() => {
    flushRuntimeEventQueue();
  }, RUNTIME_EVENT_BATCH_MS);
}

function extractRuntimeItemId(params: Record<string, unknown>): string | null {
  const direct = asNonEmptyString(params.itemId) ?? asNonEmptyString(params.item_id);
  if (direct) {
    return direct;
  }

  const item = asRecord(params.item);
  return asNonEmptyString(item?.id);
}

function applyRuntimeNotificationToThreadState(workspaceId: string, payload: unknown): void {
  if (workspaceId !== store.getState().workspace.selectedWorkspaceId) {
    return;
  }

  const notification = parseWorkspaceRuntimeNotification(payload);
  if (!notification) {
    return;
  }

  const isTranscriptMethod = notification.method.startsWith("turn/") || notification.method.startsWith("item/");
  if (!isTranscriptMethod) {
    return;
  }

  const threadId =
    extractThreadIdFromRuntimeParams(notification.params) ??
    (isTranscriptMethod ? store.getState().thread.selectedThreadId : null);
  if (!threadId) {
    return;
  }

  const turnId = extractTurnIdFromRuntimeParams(notification.params) ?? undefined;
  const runtimeItemId = extractRuntimeItemId(notification.params);
  const method = notification.method;
  const statusSignal = parseThreadStatusSignal(method, notification.params);

  store.updateSlice("thread", (thread) => {
    const isSelectedThread = thread.selectedThreadId === threadId;
    const hasTranscriptEntry = thread.transcriptsByThreadId[threadId] !== undefined;
    const currentTranscript = thread.transcriptsByThreadId[threadId] ?? createDefaultThreadTranscriptState();

    let nextTranscript = currentTranscript;
    let transcriptChanged = false;
    let nextRunning = thread.runningByThreadId[threadId] ?? false;
    let runningChanged = false;
    let nextUnread = thread.unreadByThreadId[threadId] ?? false;
    let unreadChanged = false;

    const setRunning = (running: boolean): void => {
      if (nextRunning === running) {
        return;
      }

      nextRunning = running;
      runningChanged = true;
    };

    const setUnread = (unread: boolean): void => {
      if (nextUnread === unread) {
        return;
      }

      nextUnread = unread;
      unreadChanged = true;
    };

    if (statusSignal !== null) {
      setRunning(statusSignal);
    }

    if (!isSelectedThread) {
      if (method.startsWith("turn/") || method.startsWith("item/")) {
        setUnread(true);
      }

      if (!runningChanged && !unreadChanged) {
        return thread;
      }

      return {
        ...thread,
        ...(runningChanged
          ? {
              runningByThreadId: {
                ...thread.runningByThreadId,
                [threadId]: nextRunning
              }
            }
          : {}),
        ...(unreadChanged
          ? {
              unreadByThreadId: {
                ...thread.unreadByThreadId,
                [threadId]: nextUnread
              }
            }
          : {})
      };
    }

    setUnread(false);

    const shouldSkipBySequence =
      notification.sequence !== null && notification.sequence <= currentTranscript.lastAppliedSequence;

    if (!shouldSkipBySequence) {
      if (method === "item/agentMessage/delta") {
        const delta = asNonEmptyString(notification.params.delta) ?? "";
        if (runtimeItemId && delta.length > 0) {
          const nextItems = appendAgentMessageDelta(nextTranscript.items, {
            itemId: runtimeItemId,
            delta,
            ...(turnId ? { turnId } : {})
          });
          if (nextItems !== nextTranscript.items) {
            nextTranscript = {
              ...nextTranscript,
              items: trimTranscriptItems(nextItems)
            };
            transcriptChanged = true;
          }
        }
      } else if (method === "item/reasoning/summaryTextDelta") {
        const delta = asNonEmptyString(notification.params.delta) ?? "";
        if (runtimeItemId && delta.length > 0) {
          const nextItems = appendReasoningSummaryDelta(nextTranscript.items, {
            itemId: runtimeItemId,
            delta,
            ...(turnId ? { turnId } : {})
          });
          if (nextItems !== nextTranscript.items) {
            nextTranscript = {
              ...nextTranscript,
              items: trimTranscriptItems(nextItems)
            };
            transcriptChanged = true;
          }
        }
      } else if (method === "item/reasoning/textDelta" || method === "item/reasoning/contentDelta") {
        const delta = asNonEmptyString(notification.params.delta) ?? "";
        if (runtimeItemId && delta.length > 0) {
          const nextItems = appendReasoningContentDelta(nextTranscript.items, {
            itemId: runtimeItemId,
            delta,
            ...(turnId ? { turnId } : {})
          });
          if (nextItems !== nextTranscript.items) {
            nextTranscript = {
              ...nextTranscript,
              items: trimTranscriptItems(nextItems)
            };
            transcriptChanged = true;
          }
        }
      } else if (method === "item/started" || method === "item/completed" || method === "item/updated") {
        const runtimeItem = notification.params.item;
        if (runtimeItem !== undefined) {
          const transcriptItem = transcriptItemFromRuntimeItem(runtimeItem, {
            ...(turnId ? { turnId } : {})
          });
          if (transcriptItem) {
            const normalizedItem = {
              ...transcriptItem,
              streaming: method !== "item/completed"
            } satisfies TranscriptItem;
            const nextItems = upsertTranscriptItem(nextTranscript.items, normalizedItem);
            if (nextItems !== nextTranscript.items) {
              nextTranscript = {
                ...nextTranscript,
                items: trimTranscriptItems(nextItems)
              };
              transcriptChanged = true;
            }
          }
        } else if (runtimeItemId && method === "item/completed") {
          const nextItems = setTranscriptItemStreaming(nextTranscript.items, {
            itemId: runtimeItemId,
            streaming: false
          });
          if (nextItems !== nextTranscript.items) {
            nextTranscript = {
              ...nextTranscript,
              items: nextItems
            };
            transcriptChanged = true;
          }
        }
      }

      if (notification.sequence !== null && notification.sequence !== nextTranscript.lastAppliedSequence) {
        nextTranscript = {
          ...nextTranscript,
          lastAppliedSequence: notification.sequence
        };
        transcriptChanged = true;
      }

      if (nextTranscript.hydration === "idle") {
        nextTranscript = {
          ...nextTranscript,
          hydration: "loaded"
        };
        transcriptChanged = true;
      }
    }

    if (!runningChanged && !unreadChanged && !transcriptChanged && hasTranscriptEntry) {
      return thread;
    }

    return {
      ...thread,
      transcriptsByThreadId:
        transcriptChanged || !hasTranscriptEntry
          ? {
              ...thread.transcriptsByThreadId,
              [threadId]: nextTranscript
            }
          : thread.transcriptsByThreadId,
      runningByThreadId: runningChanged
        ? {
            ...thread.runningByThreadId,
            [threadId]: nextRunning
          }
        : thread.runningByThreadId,
      unreadByThreadId: unreadChanged
        ? {
            ...thread.unreadByThreadId,
            [threadId]: nextUnread
          }
        : thread.unreadByThreadId
    };
  });
}

async function hydrateThreadTranscript(workspaceId: string, threadId: string): Promise<void> {
  if (workspaceId !== store.getState().workspace.selectedWorkspaceId) {
    return;
  }

  const currentTranscript = store.getState().thread.transcriptsByThreadId[threadId];
  if (currentTranscript?.hydration === "loaded") {
    setThreadUnread(threadId, false);
    return;
  }

  updateThreadTranscript(threadId, (transcript) => {
    if (transcript.hydration === "loading") {
      return transcript;
    }

    return {
      ...transcript,
      hydration: "loading"
    };
  });

  try {
    const csrfToken = requireCsrfToken();
    const result = await apiClient.readThread(workspaceId, csrfToken, {
      threadId,
      includeTurns: true
    });

    if (workspaceId !== store.getState().workspace.selectedWorkspaceId) {
      return;
    }

    const hydratedItems = trimTranscriptItems(transcriptItemsFromThreadReadResult(result));
    updateThreadTranscript(threadId, (transcript) => {
      return createDefaultThreadTranscriptState("loaded", hydratedItems, transcript.lastAppliedSequence);
    });
    setThreadUnread(threadId, false);
  } catch (error: unknown) {
    updateThreadTranscript(threadId, (transcript) => {
      return {
        ...transcript,
        hydration: "error"
      };
    });

    throw error;
  }
}

async function ensureThreadForTurn(workspaceId: string, csrfToken: string): Promise<string> {
  const selectedThreadId = store.getState().thread.selectedThreadId;
  if (selectedThreadId) {
    return selectedThreadId;
  }

  const startResult = await apiClient.startThread(workspaceId, csrfToken, {});
  const threadId = extractThreadIdFromTurnResult(startResult);
  if (!threadId) {
    throw new Error("Start thread failed: backend did not return threadId");
  }

  upsertThreadPlaceholder(threadId);
  setSelectedThreadId(threadId);
  appendEvent(`Thread started: ${threadId}`, "system");

  return threadId;
}

function formatActionErrorMessage(baseMessage: string, options: ApiErrorHandlingOptions): string {
  if (!options.action) {
    return baseMessage;
  }

  const contextSuffix = options.context ? ` (${options.context})` : "";
  const nextStepSuffix = options.nextStep ? ` Next: ${options.nextStep}` : "";
  return `${options.action} failed${contextSuffix}: ${baseMessage}.${nextStepSuffix}`.trim();
}

function handleApiError(error: unknown, options: ApiErrorHandlingOptions = {}): void {
  const retryAction = options.retryAction ?? null;

  if (error instanceof ApiClientError) {
    const message = formatActionErrorMessage(`${error.statusCode}: ${error.message}`, options);
    setError(message);
    setRetryAction(retryAction);
    appendEvent(message, "error");
    return;
  }

  if (error instanceof Error) {
    const message = formatActionErrorMessage(error.message, options);
    setError(message);
    setRetryAction(retryAction);
    appendEvent(message, "error");
    return;
  }

  const message = formatActionErrorMessage("An unknown error occurred", options);
  setError(message);
  setRetryAction(retryAction);
  appendEvent(message, "error");
}

function buildRetryWorkspacesAction(): RetryAction {
  return {
    label: "Retry Refresh Workspaces",
    run: async () => {
      clearError();
      setBusy(true);

      try {
        await loadWorkspaces();
      } catch (error: unknown) {
        handleApiError(error, {
          action: "Refresh workspaces",
          nextStep: "Use retry to attempt workspace refresh again",
          retryAction: buildRetryWorkspacesAction()
        });
      } finally {
        setBusy(false);
      }
    }
  };
}

function buildRetryThreadsAction(workspaceId: string): RetryAction {
  return {
    label: "Retry Refresh Threads",
    run: async () => {
      clearError();
      setBusy(true);

      try {
        await loadThreads(workspaceId);
      } catch (error: unknown) {
        handleApiError(error, {
          action: "Refresh threads",
          context: describeWorkspaceContext(workspaceId),
          nextStep: "Use retry to attempt thread refresh again",
          retryAction: buildRetryThreadsAction(workspaceId)
        });
      } finally {
        setBusy(false);
      }
    }
  };
}

function buildRetryWorkspaceSwitchAction(workspaceId: string): RetryAction {
  return {
    label: "Retry Workspace Load",
    run: async () => {
      clearError();
      setBusy(true);

      try {
        await loadThreads(workspaceId);
        connectWorkspaceEvents(workspaceId, true);
      } catch (error: unknown) {
        handleApiError(error, {
          action: "Switch workspace",
          context: describeWorkspaceContext(workspaceId),
          nextStep: "Use retry to reload workspace threads and events",
          retryAction: buildRetryWorkspaceSwitchAction(workspaceId)
        });
      } finally {
        setBusy(false);
      }
    }
  };
}

function buildRetrySessionInitAction(): RetryAction {
  return {
    label: "Retry Session Init",
    run: async () => {
      clearError();
      setBusy(true);

      try {
        await initializeSession();
      } catch (error: unknown) {
        handleApiError(error, {
          action: "Initialize session",
          context: "startup",
          nextStep: "Use retry to request a fresh auth session",
          retryAction: buildRetrySessionInitAction()
        });
      } finally {
        setBusy(false);
      }
    }
  };
}

async function handleRetryErrorAction(): Promise<void> {
  const retryAction = pendingRetryAction;
  if (!retryAction) {
    return;
  }

  await retryAction.run();
}

function resolveSelectedWorkspaceId(workspaces: WorkspaceRecord[]): string | null {
  const selectedWorkspaceId = store.getState().workspace.selectedWorkspaceId;
  if (selectedWorkspaceId && workspaces.some((workspace) => workspace.workspaceId === selectedWorkspaceId)) {
    return selectedWorkspaceId;
  }

  const storedWorkspaceId = readStorageValue(STORAGE_SELECTED_WORKSPACE_KEY);
  if (storedWorkspaceId && workspaces.some((workspace) => workspace.workspaceId === storedWorkspaceId)) {
    return storedWorkspaceId;
  }

  return workspaces[0]?.workspaceId ?? null;
}

function resolveSelectedThreadId(threads: ThreadListItem[]): string | null {
  const selectedThreadId = store.getState().thread.selectedThreadId;
  if (selectedThreadId && threads.some((thread) => thread.threadId === selectedThreadId)) {
    return selectedThreadId;
  }

  const storedThreadId = readStorageValue(STORAGE_SELECTED_THREAD_KEY);
  if (storedThreadId && threads.some((thread) => thread.threadId === storedThreadId)) {
    return storedThreadId;
  }

  return threads[0]?.threadId ?? null;
}

async function loadWorkspaces(): Promise<void> {
  const response = await apiClient.listWorkspaces();

  store.patchSlice("workspace", {
    workspaces: response.workspaces
  });

  const nextWorkspaceId = resolveSelectedWorkspaceId(response.workspaces);
  setSelectedWorkspaceId(nextWorkspaceId);

  if (nextWorkspaceId) {
    await loadThreads(nextWorkspaceId);
    connectWorkspaceEvents(nextWorkspaceId);
    return;
  }

  store.patchSlice("thread", {
    threads: [],
    selectedThreadId: null,
    transcriptsByThreadId: {},
    runningByThreadId: {},
    unreadByThreadId: {}
  });
  setSelectedThreadId(null);
  setTurnExecutionPhase("idle");
  disconnectWorkspaceEvents();
}

async function loadThreads(workspaceId: string): Promise<void> {
  const response = await apiClient.listThreads(workspaceId);

  if (workspaceId !== store.getState().workspace.selectedWorkspaceId) {
    return;
  }

  const threads = normalizeThreadList(response);
  syncThreadMapsWithList(threads);

  const nextThreadId = resolveSelectedThreadId(threads);
  setSelectedThreadId(nextThreadId);
  restoreDraftPrompt(workspaceId, nextThreadId);

  if (!nextThreadId) {
    return;
  }

  try {
    await hydrateThreadTranscript(workspaceId, nextThreadId);
  } catch (error: unknown) {
    appendEvent(`Thread history load failed (${nextThreadId}): ${describeError(error)}`, "error", {
      category: "error"
    });
  }
}

function connectWorkspaceEvents(workspaceId: string, forceReconnect = false): void {
  if (!forceReconnect && workspaceSocket && workspaceSocketWorkspaceId === workspaceId) {
    return;
  }

  disconnectWorkspaceEvents();

  workspaceSocketWorkspaceId = workspaceId;
  workspaceSocket = new ReconnectingWorkspaceSocket({
    workspaceId,
    onStateChange: (nextState) => {
      store.patchSlice("stream", {
        socketState: nextState
      });
    },
    onMessage: (payload) => {
      applyRuntimeNotificationToThreadState(workspaceId, payload);

      const normalizedEvent = normalizeWorkspaceTimelineEvent(payload, {
        includeNoise: store.getState().stream.showInternalEvents
      });

      if (!normalizedEvent) {
        return;
      }

      applyTurnSignal(normalizedEvent.turnSignal);

      enqueueRuntimeEvent(workspaceId, normalizedEvent.message, normalizedEvent.kind, {
        category: mapCategory(normalizedEvent.category),
        isInternal: normalizedEvent.isInternal,
        ...(normalizedEvent.source !== undefined ? { source: normalizedEvent.source } : {}),
        ...(normalizedEvent.details !== undefined ? { details: normalizedEvent.details } : {})
      });
    }
  });

  workspaceSocket.connect();
}

function disconnectWorkspaceEvents(): void {
  clearRuntimeEventQueue();

  if (workspaceSocket) {
    workspaceSocket.disconnect();
    workspaceSocket = undefined;
  }

  workspaceSocketWorkspaceId = null;
  store.patchSlice("stream", {
    socketState: "disconnected"
  });
}

async function initializeSession(): Promise<void> {
  const session = await apiClient.getSession();

  store.patchSlice("session", {
    authenticated: session.authenticated,
    csrfToken: session.csrfToken ?? null
  });

  if (session.authenticated) {
    draftCacheByContext.clear();
    await loadWorkspaces();
    return;
  }

  disconnectWorkspaceEvents();
}

function requireCsrfToken(): string {
  const csrfToken = store.getState().session.csrfToken;
  if (!csrfToken) {
    throw new Error("Missing CSRF token. Please login again.");
  }

  return csrfToken;
}

async function loginWithPassword(password: string): Promise<void> {
  const loginResponse = await apiClient.login(password);

  store.patchSlice("session", {
    authenticated: loginResponse.authenticated,
    csrfToken: loginResponse.csrfToken ?? null
  });

  store.patchSlice("stream", {
    draftPrompt: "",
    events: [],
    turnPhase: "idle",
    turnStartedAtMs: null
  });
  draftCacheByContext.clear();
  clearRuntimeEventQueue();
  eventSequence = 0;

  if (loginResponse.authenticated) {
    await loadWorkspaces();
    dom.loginForm.reset();
    return;
  }

  throw new Error("Invalid credentials");
}

function buildRetryLoginAction(password: string): RetryAction {
  return {
    label: "Retry Login",
    run: async () => {
      clearError();
      setBusy(true);

      try {
        await loginWithPassword(password);
      } catch (error: unknown) {
        handleApiError(error, {
          action: "Login",
          context: "auth session",
          nextStep: "Verify the password and retry login",
          retryAction: buildRetryLoginAction(password)
        });
      } finally {
        setBusy(false);
      }
    }
  };
}

async function handleLoginSubmit(event: Event): Promise<void> {
  event.preventDefault();
  const formData = new FormData(dom.loginForm);
  const password = formData.get("password");

  if (typeof password !== "string" || password.trim().length === 0) {
    setError("Password is required");
    return;
  }

  clearError();
  setBusy(true);

  try {
    const normalizedPassword = password.trim();
    await loginWithPassword(normalizedPassword);
  } catch (error: unknown) {
    handleApiError(error, {
      action: "Login",
      context: "auth session",
      nextStep: "Verify the password and retry login",
      retryAction: buildRetryLoginAction(password.trim())
    });
  } finally {
    setBusy(false);
  }
}

async function handleLogout(): Promise<void> {
  clearError();
  setBusy(true);

  try {
    const csrfToken = requireCsrfToken();
    await apiClient.logout(csrfToken);
  } catch {
    // Keep logout resilient; local state is cleared either way.
  }

  disconnectWorkspaceEvents();
  clearRuntimeEventQueue();
  setSelectedWorkspaceId(null);
  setSelectedThreadId(null);

  store.setState({
    session: {
      authenticated: false,
      csrfToken: null,
      busy: false,
      error: null,
      errorRetryLabel: null
    },
    workspace: {
      workspaces: [],
      selectedWorkspaceId: null
    },
    thread: {
      threads: [],
      selectedThreadId: null,
      transcriptsByThreadId: {},
      runningByThreadId: {},
      unreadByThreadId: {}
    },
    stream: {
      socketState: "disconnected",
      draftPrompt: "",
      events: [],
      showInternalEvents: readStorageBoolean(STORAGE_SHOW_INTERNAL_EVENTS_KEY, false),
      showStatusEvents: readStorageBoolean(STORAGE_SHOW_STATUS_EVENTS_KEY, false),
      turnPhase: "idle",
      turnStartedAtMs: null
    }
  });
  draftCacheByContext.clear();
  eventSequence = 0;
}

async function handleWorkspaceCreate(event: Event): Promise<void> {
  event.preventDefault();
  const formData = new FormData(dom.workspaceForm);

  const absolutePath = formData.get("absolutePath");
  const displayName = formData.get("displayName");

  if (typeof absolutePath !== "string" || absolutePath.trim().length === 0) {
    setError("Workspace path is required");
    return;
  }

  clearError();
  setBusy(true);

  try {
    const csrfToken = requireCsrfToken();
    const response = await apiClient.createWorkspace(csrfToken, {
      absolutePath: absolutePath.trim(),
      ...(typeof displayName === "string" && displayName.trim().length > 0
        ? { displayName: displayName.trim() }
        : {})
    });

    setSelectedWorkspaceId(response.workspace.workspaceId);
    setSelectedThreadId(null);
    appendEvent(`Workspace created: ${response.workspace.displayName}`, "system");

    await loadWorkspaces();
    dom.workspaceForm.reset();
  } catch (error: unknown) {
    handleApiError(error, {
      action: "Create workspace",
      context: `path "${absolutePath.trim()}"`,
      nextStep: "Check path permissions and submit again"
    });
  } finally {
    setBusy(false);
  }
}

async function handleStartThread(): Promise<void> {
  const workspace = activeWorkspace();
  if (!workspace) {
    return;
  }

  clearError();
  setBusy(true);

  try {
    const csrfToken = requireCsrfToken();
    const result = await apiClient.startThread(workspace.workspaceId, csrfToken, {});
    const threadId = extractThreadIdFromTurnResult(result);

    if (threadId) {
      upsertThreadPlaceholder(threadId);
      setSelectedThreadId(threadId);
      appendEvent(`Thread started: ${threadId}`, "system");
    }

    await loadThreads(workspace.workspaceId);
  } catch (error: unknown) {
    handleApiError(error, {
      action: "Start thread",
      context: describeWorkspaceContext(workspace.workspaceId),
      nextStep: "Use Retry Refresh Threads or click Start Thread again"
    });
  } finally {
    setBusy(false);
  }
}

async function handleTurnSubmit(event: Event): Promise<void> {
  event.preventDefault();
  const workspace = activeWorkspace();
  if (!workspace) {
    return;
  }

  const formData = new FormData(dom.turnForm);
  const prompt = formData.get("prompt");

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    setError("Prompt is required");
    return;
  }

  const normalizedPrompt = prompt.trim();
  const existingTurnPhase = store.getState().stream.turnPhase;
  if (existingTurnPhase === "submitting" || existingTurnPhase === "running" || existingTurnPhase === "interrupting") {
    setError("A turn is already active. Interrupt or wait for completion.");
    return;
  }

  store.patchSlice("stream", {
    draftPrompt: normalizedPrompt
  });
  persistCurrentDraftPrompt();

  clearError();
  setTurnExecutionPhase("submitting", {
    explicitStartedAtMs: Date.now()
  });
  setBusy(true);
  appendEvent(`Prompt: ${normalizedPrompt}`, "user");

  let submittedThreadId: string | null = null;

  try {
    const csrfToken = requireCsrfToken();
    submittedThreadId = await ensureThreadForTurn(workspace.workspaceId, csrfToken);

    const payload: Record<string, unknown> = {
      threadId: submittedThreadId,
      input: [
        {
          type: "text",
          text: normalizedPrompt
        }
      ]
    };

    const result = await apiClient.startTurn(workspace.workspaceId, csrfToken, payload);
    const threadId = extractThreadIdFromTurnResult(result);
    const effectiveThreadId = threadId ?? submittedThreadId;
    if (effectiveThreadId) {
      setSelectedThreadId(effectiveThreadId);
      setThreadRunning(effectiveThreadId, true);
    }

    const phaseAfterStartRequest = store.getState().stream.turnPhase;
    if (phaseAfterStartRequest === "submitting" || phaseAfterStartRequest === "running") {
      setTurnExecutionPhase("running", {
        explicitStartedAtMs: store.getState().stream.turnStartedAtMs ?? Date.now()
      });
    }
    appendEvent("Turn started", "runtime");
    dom.turnForm.reset();

    updateDraftCacheForContext(getCurrentDraftContextKey(), "");
    store.patchSlice("stream", {
      draftPrompt: ""
    });

    await loadThreads(workspace.workspaceId);
  } catch (error: unknown) {
    setTurnExecutionPhase("error");
    if (submittedThreadId) {
      setThreadRunning(submittedThreadId, false);
    }
    handleApiError(error, {
      action: "Start turn",
      context: describeActionContext(workspace.workspaceId, store.getState().thread.selectedThreadId),
      nextStep: "Confirm whether the turn started, then submit again only if needed"
    });
  } finally {
    setBusy(false);
  }
}

async function requestInterruptTurn(workspaceId: string, threadId: string | null): Promise<void> {
  const csrfToken = requireCsrfToken();
  const payload: Record<string, unknown> = {};

  if (threadId) {
    payload.threadId = threadId;
  }

  await apiClient.interruptTurn(workspaceId, csrfToken, payload);
  appendEvent("Interrupt signal sent", "system");
}

function buildRetryInterruptTurnAction(workspaceId: string, threadId: string | null): RetryAction {
  return {
    label: "Retry Interrupt Turn",
    run: async () => {
      clearError();
      setBusy(true);
      setTurnExecutionPhase("interrupting", {
        preserveStartedAt: true,
        explicitStartedAtMs: store.getState().stream.turnStartedAtMs ?? Date.now()
      });

      try {
        await requestInterruptTurn(workspaceId, threadId);
      } catch (error: unknown) {
        setTurnExecutionPhase("error");
        handleApiError(error, {
          action: "Interrupt turn",
          context: describeActionContext(workspaceId, threadId),
          nextStep: "Retry interrupt or wait for runtime completion",
          retryAction: buildRetryInterruptTurnAction(workspaceId, threadId)
        });
      } finally {
        setBusy(false);
      }
    }
  };
}

async function handleInterruptTurn(): Promise<void> {
  const workspace = activeWorkspace();
  if (!workspace) {
    return;
  }

  const turnPhase = store.getState().stream.turnPhase;
  if (turnPhase !== "submitting" && turnPhase !== "running" && turnPhase !== "interrupting") {
    appendEvent("No active turn to interrupt", "system");
    return;
  }

  clearError();
  setTurnExecutionPhase("interrupting", {
    preserveStartedAt: true,
    explicitStartedAtMs: store.getState().stream.turnStartedAtMs ?? Date.now()
  });
  setBusy(true);

  try {
    const threadId = store.getState().thread.selectedThreadId;
    await requestInterruptTurn(workspace.workspaceId, threadId);
  } catch (error: unknown) {
    setTurnExecutionPhase("error");
    handleApiError(error, {
      action: "Interrupt turn",
      context: describeActionContext(workspace.workspaceId, store.getState().thread.selectedThreadId),
      nextStep: "Retry interrupt or wait for runtime completion",
      retryAction: buildRetryInterruptTurnAction(workspace.workspaceId, store.getState().thread.selectedThreadId)
    });
  } finally {
    setBusy(false);
  }
}

function reconnectWorkspaceEvents(workspaceId: string): void {
  appendEvent("Manual reconnect requested", "socket");
  connectWorkspaceEvents(workspaceId, true);
}

function buildRetryReconnectEventsAction(workspaceId: string): RetryAction {
  return {
    label: "Retry Reconnect Events",
    run: async () => {
      clearError();

      try {
        reconnectWorkspaceEvents(workspaceId);
      } catch (error: unknown) {
        handleApiError(error, {
          action: "Reconnect events",
          context: describeWorkspaceContext(workspaceId),
          nextStep: "Retry to re-establish workspace event streaming",
          retryAction: buildRetryReconnectEventsAction(workspaceId)
        });
      }
    }
  };
}

function handleReconnectEvents(): void {
  const workspace = activeWorkspace();
  if (!workspace) {
    setError("Reconnect events failed: no workspace selected. Select a workspace and retry.");
    setRetryAction(buildRetryWorkspacesAction());
    return;
  }

  clearError();

  try {
    reconnectWorkspaceEvents(workspace.workspaceId);
  } catch (error: unknown) {
    handleApiError(error, {
      action: "Reconnect events",
      context: describeWorkspaceContext(workspace.workspaceId),
      nextStep: "Retry to re-establish workspace event streaming",
      retryAction: buildRetryReconnectEventsAction(workspace.workspaceId)
    });
  }
}

function handleWorkspaceSelection(workspaceId: string): void {
  if (workspaceId === store.getState().workspace.selectedWorkspaceId) {
    return;
  }

  persistCurrentDraftPrompt();
  setSelectedWorkspaceId(workspaceId);
  store.patchSlice("thread", {
    threads: [],
    selectedThreadId: null,
    transcriptsByThreadId: {},
    runningByThreadId: {},
    unreadByThreadId: {}
  });
  setSelectedThreadId(null);
  restoreDraftPrompt(workspaceId, null);

  clearError();
  clearRuntimeEventQueue();
  store.patchSlice("stream", {
    events: [],
    turnPhase: "idle",
    turnStartedAtMs: null
  });
  eventSequence = 0;

  void loadThreads(workspaceId)
    .then(() => {
      connectWorkspaceEvents(workspaceId, true);
    })
    .catch((error: unknown) => {
      handleApiError(error, {
        action: "Switch workspace",
        context: describeWorkspaceContext(workspaceId),
        nextStep: "Use retry to reload workspace threads and events",
        retryAction: buildRetryWorkspaceSwitchAction(workspaceId)
      });
    });
}

function handleThreadSelection(threadId: string): void {
  const existingState = store.getState();
  const isAlreadySelected = threadId === existingState.thread.selectedThreadId;
  const existingHydration = existingState.thread.transcriptsByThreadId[threadId]?.hydration;
  if (isAlreadySelected && existingHydration !== "error") {
    return;
  }

  const selectedWorkspaceId = existingState.workspace.selectedWorkspaceId;
  persistCurrentDraftPrompt();
  setSelectedThreadId(threadId);
  restoreDraftPrompt(selectedWorkspaceId, threadId);
  appendEvent(`Selected thread: ${threadId}`, "system");

  if (!selectedWorkspaceId) {
    return;
  }

  void hydrateThreadTranscript(selectedWorkspaceId, threadId).catch((error: unknown) => {
    appendEvent(`Thread history load failed (${threadId}): ${describeError(error)}`, "error", {
      category: "error"
    });
  });
}

function attachHandlers(): void {
  dom.loginForm.addEventListener("submit", (event) => {
    void handleLoginSubmit(event);
  });

  dom.workspaceForm.addEventListener("submit", (event) => {
    void handleWorkspaceCreate(event);
  });

  dom.turnForm.addEventListener("submit", (event) => {
    void handleTurnSubmit(event);
  });

  dom.turnPromptInput.addEventListener("input", () => {
    const draftPrompt = dom.turnPromptInput.value;
    setDraftPrompt(draftPrompt);
    updateDraftCacheForContext(getCurrentDraftContextKey(), draftPrompt);
  });

  dom.turnPromptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
      event.preventDefault();

      if (dom.startTurnButton.disabled) {
        return;
      }

      dom.turnForm.requestSubmit();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();

      if (dom.interruptTurnButton.disabled) {
        return;
      }

      void handleInterruptTurn();
    }
  });

  dom.workspaceList.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button[data-workspace-id]");

    const workspaceId = button?.dataset.workspaceId;
    if (!workspaceId) {
      return;
    }

    handleWorkspaceSelection(workspaceId);
  });

  dom.threadList.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button[data-thread-id]");

    const threadId = button?.dataset.threadId;
    if (!threadId) {
      return;
    }

    handleThreadSelection(threadId);
  });

  dom.refreshWorkspacesButton.addEventListener("click", () => {
    void loadWorkspaces().catch((error: unknown) => {
      handleApiError(error, {
        action: "Refresh workspaces",
        nextStep: "Use retry to attempt workspace refresh again",
        retryAction: buildRetryWorkspacesAction()
      });
    });
  });

  dom.reconnectEventsButton.addEventListener("click", () => {
    handleReconnectEvents();
  });

  dom.errorRetryButton.addEventListener("click", () => {
    void handleRetryErrorAction();
  });

  dom.toggleStatusEventsButton.addEventListener("click", () => {
    setShowStatusEvents(!store.getState().stream.showStatusEvents);
  });

  dom.toggleInternalEventsButton.addEventListener("click", () => {
    setShowInternalEvents(!store.getState().stream.showInternalEvents);
  });

  dom.refreshThreadsButton.addEventListener("click", () => {
    const selectedWorkspaceId = store.getState().workspace.selectedWorkspaceId;
    if (!selectedWorkspaceId) {
      return;
    }

    void loadThreads(selectedWorkspaceId).catch((error: unknown) => {
      handleApiError(error, {
        action: "Refresh threads",
        context: describeWorkspaceContext(selectedWorkspaceId),
        nextStep: "Use retry to attempt thread refresh again",
        retryAction: buildRetryThreadsAction(selectedWorkspaceId)
      });
    });
  });

  dom.startThreadButton.addEventListener("click", () => {
    void handleStartThread();
  });

  dom.interruptTurnButton.addEventListener("click", () => {
    void handleInterruptTurn();
  });

  dom.logoutButton.addEventListener("click", () => {
    void handleLogout();
  });
}

attachHandlers();
renderer.renderAll();

void initializeSession().catch((error: unknown) => {
  handleApiError(error, {
    action: "Initialize session",
    context: "startup",
    nextStep: "Use retry to request a fresh auth session",
    retryAction: buildRetrySessionInitAction()
  });
});
