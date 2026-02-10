import { ApiClient, ApiClientError, type WorkspaceRecord } from "./lib/api-client.js";
import {
  extractThreadIdFromTurnResult,
  normalizeWorkspaceTimelineEvent,
  normalizeThreadList,
  type ThreadListItem,
  type WorkspaceTimelineCategory
} from "./lib/normalize.js";
import { ReconnectingWorkspaceSocket } from "./lib/ws-reconnect.js";
import type {
  AppState,
  AppStateKey,
  TimelineEventCategory,
  TimelineEventEntry,
  TimelineEventKind
} from "./state/app-state.js";
import { selectActiveWorkspace } from "./state/selectors.js";
import { AppStore } from "./state/store.js";
import { AppRenderer } from "./ui/app-renderer.js";
import { createAppShell } from "./ui/app-shell.js";
import "./styles.css";

const STORAGE_SELECTED_WORKSPACE_KEY = "poketcodex.selectedWorkspaceId";
const STORAGE_SELECTED_THREAD_KEY = "poketcodex.selectedThreadId";
const STORAGE_SHOW_INTERNAL_EVENTS_KEY = "poketcodex.showInternalEvents";
const MAX_STORED_EVENTS = 240;
const RUNTIME_EVENT_BATCH_MS = 48;

const rootElement = document.querySelector<HTMLDivElement>("#app");

if (!rootElement) {
  throw new Error("App root element is missing");
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
    error: null
  },
  workspace: {
    workspaces: [],
    selectedWorkspaceId: readStorageValue(STORAGE_SELECTED_WORKSPACE_KEY)
  },
  thread: {
    threads: [],
    selectedThreadId: readStorageValue(STORAGE_SELECTED_THREAD_KEY)
  },
  stream: {
    socketState: "disconnected",
    draftPrompt: "",
    events: [],
    showInternalEvents: readStorageBoolean(STORAGE_SHOW_INTERNAL_EVENTS_KEY, false)
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
  store.patchSlice("thread", {
    selectedThreadId: threadId
  });
}

function setError(message: string | null): void {
  store.patchSlice("session", {
    error: message
  });
}

function clearError(): void {
  setError(null);
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

function handleApiError(error: unknown): void {
  if (error instanceof ApiClientError) {
    const message = `${error.statusCode}: ${error.message}`;
    setError(message);
    appendEvent(message, "error");
    return;
  }

  if (error instanceof Error) {
    setError(error.message);
    appendEvent(error.message, "error");
    return;
  }

  const message = "An unknown error occurred";
  setError(message);
  appendEvent(message, "error");
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
    selectedThreadId: null
  });
  setSelectedThreadId(null);
  disconnectWorkspaceEvents();
}

async function loadThreads(workspaceId: string): Promise<void> {
  const response = await apiClient.listThreads(workspaceId);

  if (workspaceId !== store.getState().workspace.selectedWorkspaceId) {
    return;
  }

  const threads = normalizeThreadList(response);
  store.patchSlice("thread", {
    threads
  });

  const nextThreadId = resolveSelectedThreadId(threads);
  setSelectedThreadId(nextThreadId);
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
      const normalizedEvent = normalizeWorkspaceTimelineEvent(payload, {
        includeNoise: store.getState().stream.showInternalEvents
      });

      if (!normalizedEvent) {
        return;
      }

      enqueueRuntimeEvent(workspaceId, normalizedEvent.message, normalizedEvent.kind, {
        category: mapCategory(normalizedEvent.category),
        isInternal: normalizedEvent.isInternal,
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
    const loginResponse = await apiClient.login(password.trim());

    store.patchSlice("session", {
      authenticated: loginResponse.authenticated,
      csrfToken: loginResponse.csrfToken ?? null
    });

    store.patchSlice("stream", {
      draftPrompt: "",
      events: []
    });
    clearRuntimeEventQueue();
    eventSequence = 0;

    if (loginResponse.authenticated) {
      await loadWorkspaces();
      dom.loginForm.reset();
      return;
    }

    setError("Login failed");
  } catch (error: unknown) {
    handleApiError(error);
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
      error: null
    },
    workspace: {
      workspaces: [],
      selectedWorkspaceId: null
    },
    thread: {
      threads: [],
      selectedThreadId: null
    },
    stream: {
      socketState: "disconnected",
      draftPrompt: "",
      events: [],
      showInternalEvents: readStorageBoolean(STORAGE_SHOW_INTERNAL_EVENTS_KEY, false)
    }
  });
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
    handleApiError(error);
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
      setSelectedThreadId(threadId);
      appendEvent(`Thread started: ${threadId}`, "system");
    }

    await loadThreads(workspace.workspaceId);
  } catch (error: unknown) {
    handleApiError(error);
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
  store.patchSlice("stream", {
    draftPrompt: normalizedPrompt
  });

  clearError();
  setBusy(true);
  appendEvent(`Prompt: ${normalizedPrompt}`, "user");

  try {
    const csrfToken = requireCsrfToken();
    const payload: Record<string, unknown> = {
      input: [
        {
          type: "text",
          text: normalizedPrompt
        }
      ],
      ...(store.getState().thread.selectedThreadId ? { threadId: store.getState().thread.selectedThreadId } : {})
    };

    const result = await apiClient.startTurn(workspace.workspaceId, csrfToken, payload);
    const threadId = extractThreadIdFromTurnResult(result);
    if (threadId) {
      setSelectedThreadId(threadId);
    }

    appendEvent("Turn started", "runtime");
    dom.turnForm.reset();

    store.patchSlice("stream", {
      draftPrompt: ""
    });

    await loadThreads(workspace.workspaceId);
  } catch (error: unknown) {
    handleApiError(error);
  } finally {
    setBusy(false);
  }
}

async function handleInterruptTurn(): Promise<void> {
  const workspace = activeWorkspace();
  if (!workspace) {
    return;
  }

  clearError();
  setBusy(true);

  try {
    const csrfToken = requireCsrfToken();
    const payload: Record<string, unknown> = {};

    if (store.getState().thread.selectedThreadId) {
      payload.threadId = store.getState().thread.selectedThreadId;
    }

    await apiClient.interruptTurn(workspace.workspaceId, csrfToken, payload);
    appendEvent("Interrupt signal sent", "system");
  } catch (error: unknown) {
    handleApiError(error);
  } finally {
    setBusy(false);
  }
}

function handleReconnectEvents(): void {
  const workspace = activeWorkspace();
  if (!workspace) {
    return;
  }

  appendEvent("Manual reconnect requested", "socket");
  connectWorkspaceEvents(workspace.workspaceId, true);
}

function handleWorkspaceSelection(workspaceId: string): void {
  if (workspaceId === store.getState().workspace.selectedWorkspaceId) {
    return;
  }

  setSelectedWorkspaceId(workspaceId);
  store.patchSlice("thread", {
    threads: [],
    selectedThreadId: null
  });
  setSelectedThreadId(null);

  clearError();
  clearRuntimeEventQueue();
  store.patchSlice("stream", {
    events: []
  });
  eventSequence = 0;

  void loadThreads(workspaceId)
    .then(() => {
      connectWorkspaceEvents(workspaceId, true);
    })
    .catch((error: unknown) => {
      handleApiError(error);
    });
}

function handleThreadSelection(threadId: string): void {
  setSelectedThreadId(threadId);
  appendEvent(`Selected thread: ${threadId}`, "system");
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
    store.patchSlice("stream", {
      draftPrompt: dom.turnPromptInput.value
    });
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
      handleApiError(error);
    });
  });

  dom.reconnectEventsButton.addEventListener("click", () => {
    handleReconnectEvents();
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
      handleApiError(error);
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
  handleApiError(error);
});
