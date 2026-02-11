export interface AppDomRefs {
  loginPanel: HTMLElement;
  appPanels: HTMLElement;
  errorBanner: HTMLElement;
  errorMessage: HTMLElement;
  errorRetryButton: HTMLButtonElement;
  socketStateChip: HTMLElement;
  refreshWorkspacesButton: HTMLButtonElement;
  reconnectEventsButton: HTMLButtonElement;
  logoutButton: HTMLButtonElement;
  loginForm: HTMLFormElement;
  loginPasswordInput: HTMLInputElement;
  loginSubmitButton: HTMLButtonElement;
  workspaceForm: HTMLFormElement;
  workspaceAbsolutePathInput: HTMLInputElement;
  workspaceDisplayNameInput: HTMLInputElement;
  workspaceSubmitButton: HTMLButtonElement;
  workspaceList: HTMLElement;
  refreshThreadsButton: HTMLButtonElement;
  startThreadButton: HTMLButtonElement;
  threadList: HTMLElement;
  conversationTitle: HTMLElement;
  selectedWorkspaceLabel: HTMLElement;
  selectedThreadLabel: HTMLElement;
  turnForm: HTMLFormElement;
  turnPromptInput: HTMLTextAreaElement;
  turnStatusChip: HTMLElement;
  turnStatusText: HTMLElement;
  startTurnButton: HTMLButtonElement;
  interruptTurnButton: HTMLButtonElement;
  transcriptStream: HTMLElement;
  transcriptList: HTMLOListElement;
  transcriptJumpLatestButton: HTMLButtonElement;
  eventStream: HTMLElement;
  eventList: HTMLOListElement;
  toggleStatusEventsButton: HTMLButtonElement;
  toggleInternalEventsButton: HTMLButtonElement;
  jumpLatestButton: HTMLButtonElement;
}

function requireElement<TElement extends Element>(root: ParentNode, selector: string): TElement {
  const element = root.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Expected element not found for selector: ${selector}`);
  }

  return element;
}

export function createAppShell(root: HTMLDivElement): AppDomRefs {
  root.innerHTML = `
    <main class="app-shell">
      <header class="app-header">
        <div class="header-copy">
          <p class="eyebrow">Workspace Runtime Console</p>
          <h1>PocketCodex</h1>
          <p class="subhead">Mobile Codex control plane</p>
        </div>
        <button class="sidebar-toggle" type="button" data-role="sidebar-toggle" aria-label="Toggle sidebar">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="3" y1="5" x2="17" y2="5"/>
            <line x1="3" y1="10" x2="17" y2="10"/>
            <line x1="3" y1="15" x2="17" y2="15"/>
          </svg>
        </button>
        <div class="status-row">
          <span class="status-chip state-disconnected" data-role="socket-state">disconnected</span>
          <button class="button-secondary" type="button" data-role="refresh-workspaces">Refresh</button>
          <button class="button-secondary" type="button" data-role="reconnect-events">Reconnect</button>
          <button class="button-secondary" type="button" data-role="logout">Logout</button>
        </div>
      </header>

      <div class="sidebar-overlay" data-role="sidebar-overlay"></div>

      <section class="error-banner is-hidden" data-role="error-banner">
        <span data-role="error-message"></span>
        <button class="button-secondary is-hidden error-retry-button" type="button" data-role="error-retry">
          Retry
        </button>
      </section>

      <section class="panel login-panel" data-role="login-panel">
        <h2>Sign In</h2>
        <form id="login-form">
          <label>
            Password
            <input type="password" name="password" autocomplete="current-password" required data-role="login-password" />
          </label>
          <button type="submit" data-role="login-submit">Login</button>
        </form>
      </section>

      <section class="app-body is-hidden" data-role="app-panels">
        <aside class="nav-column">
          <section class="panel workspace-panel">
            <h2>Workspaces</h2>
            <details class="workspace-disclosure">
              <summary>Add workspace</summary>
              <form id="workspace-form">
                <label>
                  Absolute Path
                  <input type="text" name="absolutePath" placeholder="/home/divyam/projects/my-repo" required data-role="workspace-path" />
                </label>
                <label>
                  Display Name
                  <input type="text" name="displayName" placeholder="My Repo" data-role="workspace-display-name" />
                </label>
                <button type="submit" data-role="workspace-submit">Add Workspace</button>
              </form>
            </details>
            <div class="list-container" data-role="workspace-list"></div>
          </section>

          <section class="panel thread-panel">
            <h2>Threads</h2>
            <div class="thread-actions">
              <button type="button" data-role="start-thread">New Thread</button>
              <button class="button-secondary" type="button" data-role="refresh-threads">Refresh Threads</button>
            </div>
            <div class="list-container" data-role="thread-list"></div>
          </section>
        </aside>

        <section class="main-column">
          <section class="conversation-panel">
          <div class="conversation-header">
            <h2 data-role="conversation-title">Conversation</h2>
            <div class="conversation-context">
              <span class="context-chip">Workspace: <strong data-role="selected-workspace">None</strong></span>
              <span class="context-chip">Thread: <strong data-role="selected-thread">None</strong></span>
            </div>
          </div>

          <div class="transcript-toolbar">
            <span class="event-toolbar-label">Conversation</span>
            <div class="event-toolbar-actions">
              <button class="button-secondary is-hidden" type="button" data-role="transcript-jump-latest">
                Jump to latest message
              </button>
            </div>
          </div>

          <div class="transcript-stream" data-role="transcript-stream">
            <ol data-role="transcript-list">
              <li class="empty">Select a thread to load history.</li>
            </ol>
          </div>

          <form id="turn-form" class="composer-form">
            <label>
              Prompt
              <textarea id="turn-prompt" name="prompt" rows="3" placeholder="Ask Codex..." required data-role="turn-prompt"></textarea>
            </label>
            <div class="turn-status" data-role="turn-status">
              <span class="turn-status-chip phase-idle" data-role="turn-status-chip">Idle</span>
              <span class="turn-status-text" data-role="turn-status-text">Ready to send</span>
            </div>
            <p class="turn-shortcuts">Cmd/Ctrl+Enter to send · Esc to interrupt</p>
            <div class="turn-actions">
              <button type="submit" data-role="start-turn">Send</button>
              <button class="button-danger" type="button" data-role="interrupt-turn">Interrupt</button>
            </div>
          </form>

          <details class="events-disclosure">
            <summary>Live runtime events</summary>
            <div class="event-toolbar">
              <span class="event-toolbar-label">Runtime stream controls</span>
              <div class="event-toolbar-actions">
                <button class="button-secondary" type="button" data-role="toggle-status-events">Show Status</button>
                <button class="button-secondary" type="button" data-role="toggle-internal-events">Show Internal</button>
                <button class="button-secondary is-hidden" type="button" data-role="jump-latest">Jump to latest</button>
              </div>
            </div>

            <div class="event-stream" data-role="event-stream">
              <ol data-role="event-list">
                <li>Awaiting events...</li>
              </ol>
            </div>
          </details>
          </section>
        </section>
      </section>
    </main>
  `;

  // Sidebar drawer toggle logic (mobile)
  const sidebarToggle = requireElement<HTMLButtonElement>(root, "[data-role='sidebar-toggle']");
  const sidebarOverlay = requireElement<HTMLElement>(root, "[data-role='sidebar-overlay']");
  const navColumn = requireElement<HTMLElement>(root, ".nav-column");

  const closeSidebar = () => {
    navColumn.classList.remove("is-open");
    sidebarOverlay.classList.remove("is-open");
  };

  sidebarToggle.addEventListener("click", () => {
    const isOpen = navColumn.classList.toggle("is-open");
    sidebarOverlay.classList.toggle("is-open", isOpen);
  });

  sidebarOverlay.addEventListener("click", closeSidebar);

  // Auto-close drawer when a workspace or thread is selected on mobile
  navColumn.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest(".workspace-item") || target.closest(".thread-item")) {
      closeSidebar();
    }
  });

  return {
    loginPanel: requireElement<HTMLElement>(root, "[data-role='login-panel']"),
    appPanels: requireElement<HTMLElement>(root, "[data-role='app-panels']"),
    errorBanner: requireElement<HTMLElement>(root, "[data-role='error-banner']"),
    errorMessage: requireElement<HTMLElement>(root, "[data-role='error-message']"),
    errorRetryButton: requireElement<HTMLButtonElement>(root, "[data-role='error-retry']"),
    socketStateChip: requireElement<HTMLElement>(root, "[data-role='socket-state']"),
    refreshWorkspacesButton: requireElement<HTMLButtonElement>(root, "[data-role='refresh-workspaces']"),
    reconnectEventsButton: requireElement<HTMLButtonElement>(root, "[data-role='reconnect-events']"),
    logoutButton: requireElement<HTMLButtonElement>(root, "[data-role='logout']"),
    loginForm: requireElement<HTMLFormElement>(root, "#login-form"),
    loginPasswordInput: requireElement<HTMLInputElement>(root, "[data-role='login-password']"),
    loginSubmitButton: requireElement<HTMLButtonElement>(root, "[data-role='login-submit']"),
    workspaceForm: requireElement<HTMLFormElement>(root, "#workspace-form"),
    workspaceAbsolutePathInput: requireElement<HTMLInputElement>(root, "[data-role='workspace-path']"),
    workspaceDisplayNameInput: requireElement<HTMLInputElement>(root, "[data-role='workspace-display-name']"),
    workspaceSubmitButton: requireElement<HTMLButtonElement>(root, "[data-role='workspace-submit']"),
    workspaceList: requireElement<HTMLElement>(root, "[data-role='workspace-list']"),
    refreshThreadsButton: requireElement<HTMLButtonElement>(root, "[data-role='refresh-threads']"),
    startThreadButton: requireElement<HTMLButtonElement>(root, "[data-role='start-thread']"),
    threadList: requireElement<HTMLElement>(root, "[data-role='thread-list']"),
    conversationTitle: requireElement<HTMLElement>(root, "[data-role='conversation-title']"),
    selectedWorkspaceLabel: requireElement<HTMLElement>(root, "[data-role='selected-workspace']"),
    selectedThreadLabel: requireElement<HTMLElement>(root, "[data-role='selected-thread']"),
    turnForm: requireElement<HTMLFormElement>(root, "#turn-form"),
    turnPromptInput: requireElement<HTMLTextAreaElement>(root, "[data-role='turn-prompt']"),
    turnStatusChip: requireElement<HTMLElement>(root, "[data-role='turn-status-chip']"),
    turnStatusText: requireElement<HTMLElement>(root, "[data-role='turn-status-text']"),
    startTurnButton: requireElement<HTMLButtonElement>(root, "[data-role='start-turn']"),
    interruptTurnButton: requireElement<HTMLButtonElement>(root, "[data-role='interrupt-turn']"),
    transcriptStream: requireElement<HTMLElement>(root, "[data-role='transcript-stream']"),
    transcriptList: requireElement<HTMLOListElement>(root, "[data-role='transcript-list']"),
    transcriptJumpLatestButton: requireElement<HTMLButtonElement>(root, "[data-role='transcript-jump-latest']"),
    eventStream: requireElement<HTMLElement>(root, "[data-role='event-stream']"),
    eventList: requireElement<HTMLOListElement>(root, "[data-role='event-list']"),
    toggleStatusEventsButton: requireElement<HTMLButtonElement>(root, "[data-role='toggle-status-events']"),
    toggleInternalEventsButton: requireElement<HTMLButtonElement>(root, "[data-role='toggle-internal-events']"),
    jumpLatestButton: requireElement<HTMLButtonElement>(root, "[data-role='jump-latest']")
  };
}
