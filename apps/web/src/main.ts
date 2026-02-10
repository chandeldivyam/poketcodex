import { ApiClient, ApiClientError, type WorkspaceRecord } from "./lib/api-client.js";
import {
  extractThreadIdFromTurnResult,
  formatWorkspaceEvent,
  normalizeThreadList,
  type ThreadListItem
} from "./lib/normalize.js";
import { ReconnectingWorkspaceSocket, type SocketConnectionState } from "./lib/ws-reconnect.js";
import "./styles.css";

interface AppState {
  authenticated: boolean;
  csrfToken: string | null;
  socketState: SocketConnectionState;
  busy: boolean;
  error: string | null;
  workspaces: WorkspaceRecord[];
  selectedWorkspaceId: string | null;
  threads: ThreadListItem[];
  selectedThreadId: string | null;
  draftPrompt: string;
  events: string[];
}

const STORAGE_SELECTED_WORKSPACE_KEY = "poketcodex.selectedWorkspaceId";
const STORAGE_SELECTED_THREAD_KEY = "poketcodex.selectedThreadId";
const MAX_RENDERED_EVENTS = 100;
const MAX_STORED_EVENTS = 240;

const HTML_ESCAPE_LOOKUP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

const rootElement = document.querySelector<HTMLDivElement>("#app");

if (!rootElement) {
  throw new Error("App root element is missing");
}

const root: HTMLDivElement = rootElement;

const apiClient = new ApiClient("");
const state: AppState = {
  authenticated: false,
  csrfToken: null,
  socketState: "disconnected",
  busy: false,
  error: null,
  workspaces: [],
  selectedWorkspaceId: readStorageValue(STORAGE_SELECTED_WORKSPACE_KEY),
  threads: [],
  selectedThreadId: readStorageValue(STORAGE_SELECTED_THREAD_KEY),
  draftPrompt: "",
  events: []
};

let workspaceSocket: ReconnectingWorkspaceSocket | undefined;
let workspaceSocketWorkspaceId: string | null = null;
let renderScheduled = false;

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

function setSelectedWorkspaceId(workspaceId: string | null): void {
  state.selectedWorkspaceId = workspaceId;
  writeStorageValue(STORAGE_SELECTED_WORKSPACE_KEY, workspaceId);
}

function setSelectedThreadId(threadId: string | null): void {
  state.selectedThreadId = threadId;
  writeStorageValue(STORAGE_SELECTED_THREAD_KEY, threadId);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_LOOKUP[character] ?? character);
}

function setError(message: string | null): void {
  state.error = message;
}

function clearError(): void {
  setError(null);
}

function setBusy(busy: boolean): void {
  state.busy = busy;
}

function activeWorkspace(): WorkspaceRecord | null {
  if (!state.selectedWorkspaceId) {
    return null;
  }

  return state.workspaces.find((workspace) => workspace.workspaceId === state.selectedWorkspaceId) ?? null;
}

function selectedThreadLabel(): string {
  if (!state.selectedThreadId) {
    return "None";
  }

  const selectedThread = state.threads.find((thread) => thread.threadId === state.selectedThreadId);
  return selectedThread ? selectedThread.title : state.selectedThreadId;
}

function appendEvent(line: string): void {
  const timestamp = new Date().toLocaleTimeString();
  state.events.push(`${timestamp} ${line}`);

  if (state.events.length > MAX_STORED_EVENTS) {
    state.events.splice(0, state.events.length - MAX_STORED_EVENTS);
  }
}

function scheduleRender(): void {
  if (renderScheduled) {
    return;
  }

  renderScheduled = true;

  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
    return;
  }

  window.setTimeout(() => {
    renderScheduled = false;
    render();
  }, 16);
}

function render(): void {
  const workspaceItems = state.workspaces
    .map((workspace) => {
      const isSelected = workspace.workspaceId === state.selectedWorkspaceId;
      return `
        <button class="workspace-item ${isSelected ? "is-selected" : ""}" data-action="select-workspace" data-workspace-id="${escapeHtml(workspace.workspaceId)}">
          <strong>${escapeHtml(workspace.displayName)}</strong>
          <span>${escapeHtml(workspace.absolutePath)}</span>
        </button>
      `;
    })
    .join("");

  const threadItems = state.threads
    .map((thread) => {
      const isSelected = thread.threadId === state.selectedThreadId;
      const archivedBadge = thread.archived ? "<span class=\"thread-badge\">Archived</span>" : "";

      return `
        <button class="thread-item ${isSelected ? "is-selected" : ""}" data-action="select-thread" data-thread-id="${escapeHtml(thread.threadId)}">
          <strong>${escapeHtml(thread.title)}</strong>
          <span>${escapeHtml(thread.threadId)}</span>
          ${archivedBadge}
        </button>
      `;
    })
    .join("");

  const eventItems = state.events
    .slice(-MAX_RENDERED_EVENTS)
    .map((eventLine) => `<li>${escapeHtml(eventLine)}</li>`)
    .join("");

  const selectedWorkspace = activeWorkspace();
  const connectionClass = `status-chip state-${state.socketState}`;
  const workspaceActionsDisabled = !state.authenticated || state.busy;
  const threadActionsDisabled = !state.selectedWorkspaceId || !state.authenticated || state.busy;
  const reconnectButtonLabel = state.socketState === "connected" ? "Resubscribe" : "Reconnect";

  root.innerHTML = `
    <main class="app-shell">
      <header class="app-header">
        <h1>PocketCodex</h1>
        <p>Mobile Codex control plane</p>
        <div class="status-row">
          <span class="${connectionClass}">${state.socketState}</span>
          <button class="button-secondary" data-action="refresh-workspaces" ${workspaceActionsDisabled ? "disabled" : ""}>Refresh</button>
          <button class="button-secondary" data-action="reconnect-events" ${threadActionsDisabled ? "disabled" : ""}>${reconnectButtonLabel}</button>
          <button class="button-secondary" data-action="logout" ${workspaceActionsDisabled ? "disabled" : ""}>Logout</button>
        </div>
      </header>

      ${state.error ? `<section class="error-banner">${escapeHtml(state.error)}</section>` : ""}

      ${
        !state.authenticated
          ? `
        <section class="panel login-panel">
          <h2>Sign In</h2>
          <form id="login-form">
            <label>
              Password
              <input type="password" name="password" autocomplete="current-password" required />
            </label>
            <button type="submit" ${state.busy ? "disabled" : ""}>Login</button>
          </form>
        </section>
      `
          : `
        <section class="panel-grid">
          <section class="panel workspace-panel">
            <h2>Workspaces</h2>
            <form id="workspace-form">
              <label>
                Absolute Path
                <input type="text" name="absolutePath" placeholder="/home/divyam/projects/my-repo" required />
              </label>
              <label>
                Display Name
                <input type="text" name="displayName" placeholder="My Repo" />
              </label>
              <button type="submit" ${state.busy ? "disabled" : ""}>Add Workspace</button>
            </form>
            <div class="list-container">${workspaceItems || '<p class="empty">No workspaces yet.</p>'}</div>
          </section>

          <section class="panel thread-panel">
            <h2>Threads</h2>
            <div class="thread-actions">
              <button class="button-secondary" data-action="refresh-threads" ${threadActionsDisabled ? "disabled" : ""}>Refresh Threads</button>
              <button data-action="start-thread" ${threadActionsDisabled ? "disabled" : ""}>Start Thread</button>
            </div>
            <div class="list-container">${threadItems || '<p class="empty">No thread metadata yet.</p>'}</div>
            <p class="selected-thread">Workspace: ${escapeHtml(selectedWorkspace?.displayName ?? "None")}</p>
            <p class="selected-thread">Thread: ${escapeHtml(selectedThreadLabel())}</p>
          </section>

          <section class="panel event-panel">
            <h2>Turn Console</h2>
            <form id="turn-form">
              <label>
                Prompt
                <textarea id="turn-prompt" name="prompt" rows="3" placeholder="Ask Codex..." required>${escapeHtml(state.draftPrompt)}</textarea>
              </label>
              <div class="turn-actions">
                <button type="submit" ${threadActionsDisabled ? "disabled" : ""}>Start Turn</button>
                <button class="button-danger" type="button" data-action="interrupt-turn" ${threadActionsDisabled ? "disabled" : ""}>Interrupt</button>
              </div>
            </form>
            <div class="event-stream">
              <ol>${eventItems || "<li>Awaiting events...</li>"}</ol>
            </div>
          </section>
        </section>
      `
      }
    </main>
  `;

  attachHandlers();
}

function handleApiError(error: unknown): void {
  if (error instanceof ApiClientError) {
    setError(`${error.statusCode}: ${error.message}`);
    return;
  }

  if (error instanceof Error) {
    setError(error.message);
    return;
  }

  setError("An unknown error occurred");
}

function resolveSelectedWorkspaceId(workspaces: WorkspaceRecord[]): string | null {
  if (state.selectedWorkspaceId && workspaces.some((workspace) => workspace.workspaceId === state.selectedWorkspaceId)) {
    return state.selectedWorkspaceId;
  }

  const storedWorkspaceId = readStorageValue(STORAGE_SELECTED_WORKSPACE_KEY);
  if (storedWorkspaceId && workspaces.some((workspace) => workspace.workspaceId === storedWorkspaceId)) {
    return storedWorkspaceId;
  }

  return workspaces[0]?.workspaceId ?? null;
}

function resolveSelectedThreadId(threads: ThreadListItem[]): string | null {
  if (state.selectedThreadId && threads.some((thread) => thread.threadId === state.selectedThreadId)) {
    return state.selectedThreadId;
  }

  const storedThreadId = readStorageValue(STORAGE_SELECTED_THREAD_KEY);
  if (storedThreadId && threads.some((thread) => thread.threadId === storedThreadId)) {
    return storedThreadId;
  }

  return threads[0]?.threadId ?? null;
}

async function loadWorkspaces(shouldRender = true): Promise<void> {
  const response = await apiClient.listWorkspaces();
  state.workspaces = response.workspaces;

  setSelectedWorkspaceId(resolveSelectedWorkspaceId(state.workspaces));

  if (state.selectedWorkspaceId) {
    await loadThreads(state.selectedWorkspaceId, false);
    connectWorkspaceEvents(state.selectedWorkspaceId);
  } else {
    state.threads = [];
    setSelectedThreadId(null);
    disconnectWorkspaceEvents();
  }

  if (shouldRender) {
    render();
  }
}

async function loadThreads(workspaceId: string, shouldRender = true): Promise<void> {
  const response = await apiClient.listThreads(workspaceId);

  if (workspaceId !== state.selectedWorkspaceId) {
    return;
  }

  state.threads = normalizeThreadList(response);
  setSelectedThreadId(resolveSelectedThreadId(state.threads));

  if (shouldRender) {
    render();
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
      state.socketState = nextState;
      scheduleRender();
    },
    onMessage: (payload) => {
      const formattedEvent = formatWorkspaceEvent(payload);
      if (formattedEvent.length === 0) {
        return;
      }

      appendEvent(formattedEvent);
      scheduleRender();
    }
  });

  workspaceSocket.connect();
}

function disconnectWorkspaceEvents(): void {
  if (workspaceSocket) {
    workspaceSocket.disconnect();
    workspaceSocket = undefined;
  }

  workspaceSocketWorkspaceId = null;
  state.socketState = "disconnected";
}

async function initializeSession(): Promise<void> {
  const session = await apiClient.getSession();
  state.authenticated = session.authenticated;
  state.csrfToken = session.csrfToken ?? null;

  if (state.authenticated) {
    await loadWorkspaces(false);
  } else {
    disconnectWorkspaceEvents();
  }
}

function requireCsrfToken(): string {
  if (!state.csrfToken) {
    throw new Error("Missing CSRF token. Please login again.");
  }

  return state.csrfToken;
}

async function handleLoginSubmit(event: Event): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const formData = new FormData(form);
  const password = formData.get("password");

  if (typeof password !== "string" || password.trim().length === 0) {
    setError("Password is required");
    render();
    return;
  }

  clearError();
  setBusy(true);
  render();

  try {
    const loginResponse = await apiClient.login(password.trim());
    state.authenticated = loginResponse.authenticated;
    state.csrfToken = loginResponse.csrfToken ?? null;
    state.events = [];

    if (state.authenticated) {
      await loadWorkspaces(false);
      form.reset();
    } else {
      setError("Login failed");
    }
  } catch (error: unknown) {
    handleApiError(error);
  } finally {
    setBusy(false);
    render();
  }
}

async function handleLogout(): Promise<void> {
  clearError();
  setBusy(true);
  render();

  try {
    const csrfToken = requireCsrfToken();
    await apiClient.logout(csrfToken);
  } catch {
    // Keep logout resilient; local state is cleared either way.
  }

  disconnectWorkspaceEvents();
  state.authenticated = false;
  state.csrfToken = null;
  state.workspaces = [];
  state.threads = [];
  setSelectedWorkspaceId(null);
  setSelectedThreadId(null);
  state.events = [];
  setBusy(false);
  render();
}

async function handleWorkspaceCreate(event: Event): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const formData = new FormData(form);

  const absolutePath = formData.get("absolutePath");
  const displayName = formData.get("displayName");

  if (typeof absolutePath !== "string" || absolutePath.trim().length === 0) {
    setError("Workspace path is required");
    render();
    return;
  }

  clearError();
  setBusy(true);
  render();

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
    appendEvent(`Workspace created: ${response.workspace.displayName}`);
    await loadWorkspaces(false);
    form.reset();
  } catch (error: unknown) {
    handleApiError(error);
  } finally {
    setBusy(false);
    render();
  }
}

async function handleStartThread(): Promise<void> {
  const workspace = activeWorkspace();
  if (!workspace) {
    return;
  }

  clearError();
  setBusy(true);
  render();

  try {
    const csrfToken = requireCsrfToken();
    const result = await apiClient.startThread(workspace.workspaceId, csrfToken, {});
    const threadId = extractThreadIdFromTurnResult(result);

    if (threadId) {
      setSelectedThreadId(threadId);
      appendEvent(`Thread started: ${threadId}`);
    }

    await loadThreads(workspace.workspaceId, false);
  } catch (error: unknown) {
    handleApiError(error);
  } finally {
    setBusy(false);
    render();
  }
}

async function handleTurnSubmit(event: Event): Promise<void> {
  event.preventDefault();
  const workspace = activeWorkspace();
  if (!workspace) {
    return;
  }

  const form = event.currentTarget as HTMLFormElement;
  const formData = new FormData(form);
  const prompt = formData.get("prompt");

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    setError("Prompt is required");
    render();
    return;
  }

  const normalizedPrompt = prompt.trim();
  state.draftPrompt = normalizedPrompt;

  clearError();
  setBusy(true);
  appendEvent(`Prompt: ${normalizedPrompt}`);
  render();

  try {
    const csrfToken = requireCsrfToken();
    const payload: Record<string, unknown> = {
      prompt: normalizedPrompt,
      ...(state.selectedThreadId ? { threadId: state.selectedThreadId } : {})
    };

    const result = await apiClient.startTurn(workspace.workspaceId, csrfToken, payload);
    const threadId = extractThreadIdFromTurnResult(result);
    if (threadId) {
      setSelectedThreadId(threadId);
    }

    appendEvent("Turn started");
    state.draftPrompt = "";
    form.reset();
    await loadThreads(workspace.workspaceId, false);
  } catch (error: unknown) {
    handleApiError(error);
  } finally {
    setBusy(false);
    render();
  }
}

async function handleInterruptTurn(): Promise<void> {
  const workspace = activeWorkspace();
  if (!workspace) {
    return;
  }

  clearError();
  setBusy(true);
  render();

  try {
    const csrfToken = requireCsrfToken();
    const payload: Record<string, unknown> = {};

    if (state.selectedThreadId) {
      payload.threadId = state.selectedThreadId;
    }

    await apiClient.interruptTurn(workspace.workspaceId, csrfToken, payload);
    appendEvent("Interrupt signal sent");
  } catch (error: unknown) {
    handleApiError(error);
  } finally {
    setBusy(false);
    render();
  }
}

function handleReconnectEvents(): void {
  const workspace = activeWorkspace();
  if (!workspace) {
    return;
  }

  appendEvent("Manual reconnect requested");
  connectWorkspaceEvents(workspace.workspaceId, true);
  render();
}

function attachHandlers(): void {
  const loginForm = document.querySelector<HTMLFormElement>("#login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", (event) => {
      void handleLoginSubmit(event);
    });
  }

  const workspaceForm = document.querySelector<HTMLFormElement>("#workspace-form");
  if (workspaceForm) {
    workspaceForm.addEventListener("submit", (event) => {
      void handleWorkspaceCreate(event);
    });
  }

  const turnForm = document.querySelector<HTMLFormElement>("#turn-form");
  if (turnForm) {
    turnForm.addEventListener("submit", (event) => {
      void handleTurnSubmit(event);
    });
  }

  const turnPromptInput = document.querySelector<HTMLTextAreaElement>("#turn-prompt");
  turnPromptInput?.addEventListener("input", () => {
    state.draftPrompt = turnPromptInput.value;
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action='select-workspace']").forEach((button) => {
    button.addEventListener("click", () => {
      const workspaceId = button.dataset.workspaceId;
      if (!workspaceId || workspaceId === state.selectedWorkspaceId) {
        return;
      }

      setSelectedWorkspaceId(workspaceId);
      setSelectedThreadId(null);
      clearError();
      state.events = [];
      render();

      void loadThreads(workspaceId)
        .then(() => {
          connectWorkspaceEvents(workspaceId, true);
        })
        .catch((error: unknown) => {
          handleApiError(error);
          render();
        });
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action='select-thread']").forEach((button) => {
    button.addEventListener("click", () => {
      const threadId = button.dataset.threadId;
      if (!threadId) {
        return;
      }

      setSelectedThreadId(threadId);
      appendEvent(`Selected thread: ${threadId}`);
      render();
    });
  });

  const refreshWorkspacesButton = document.querySelector<HTMLButtonElement>("[data-action='refresh-workspaces']");
  refreshWorkspacesButton?.addEventListener("click", () => {
    void loadWorkspaces().catch((error: unknown) => {
      handleApiError(error);
      render();
    });
  });

  const reconnectEventsButton = document.querySelector<HTMLButtonElement>("[data-action='reconnect-events']");
  reconnectEventsButton?.addEventListener("click", () => {
    handleReconnectEvents();
  });

  const refreshThreadsButton = document.querySelector<HTMLButtonElement>("[data-action='refresh-threads']");
  refreshThreadsButton?.addEventListener("click", () => {
    if (!state.selectedWorkspaceId) {
      return;
    }

    void loadThreads(state.selectedWorkspaceId).catch((error: unknown) => {
      handleApiError(error);
      render();
    });
  });

  const startThreadButton = document.querySelector<HTMLButtonElement>("[data-action='start-thread']");
  startThreadButton?.addEventListener("click", () => {
    void handleStartThread();
  });

  const interruptTurnButton = document.querySelector<HTMLButtonElement>("[data-action='interrupt-turn']");
  interruptTurnButton?.addEventListener("click", () => {
    void handleInterruptTurn();
  });

  const logoutButton = document.querySelector<HTMLButtonElement>("[data-action='logout']");
  logoutButton?.addEventListener("click", () => {
    void handleLogout();
  });
}

void initializeSession()
  .catch((error: unknown) => {
    handleApiError(error);
  })
  .finally(() => {
    render();
  });
