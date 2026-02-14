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
  workspaceSubmitButton: HTMLButtonElement;
  workspaceTree: HTMLElement;
  openGitReviewButton: HTMLButtonElement;
  refreshThreadsButton: HTMLButtonElement;
  startThreadButton: HTMLButtonElement;
  conversationTitle: HTMLElement;
  turnForm: HTMLFormElement;
  turnPromptInput: HTMLTextAreaElement;
  composerAttachImageButton: HTMLButtonElement;
  composerImageInput: HTMLInputElement;
  composerImageList: HTMLElement;
  composerContextChips: HTMLElement;
  contextChipWorkspace: HTMLElement;
  contextChipWorkspaceLabel: HTMLElement;
  contextChipGit: HTMLElement;
  contextChipGitLabel: HTMLElement;
  turnStatusChip: HTMLElement;
  turnStatusText: HTMLElement;
  backgroundTerminalRow: HTMLElement;
  backgroundTerminalText: HTMLElement;
  startTurnButton: HTMLButtonElement;
  interruptTurnButton: HTMLButtonElement;
  transcriptStream: HTMLElement;
  transcriptList: HTMLOListElement;
  transcriptJumpLatestButton: HTMLButtonElement;
  eventStream: HTMLElement;
  eventList: HTMLOListElement;
  toggleStatusEventsButton: HTMLButtonElement;
  toggleInternalEventsButton: HTMLButtonElement;
  settingsShowStatusEventsInput: HTMLInputElement;
  settingsShowInternalEventsInput: HTMLInputElement;
  settingsCompactStatusBurstsInput: HTMLInputElement;
  jumpLatestButton: HTMLButtonElement;
  conversationPanel: HTMLElement;
  gitReviewPanel: HTMLElement;
  gitReviewBackButton: HTMLButtonElement;
  gitReviewRefreshButton: HTMLButtonElement;
  gitReviewTitle: HTMLElement;
  gitReviewStatusText: HTMLElement;
  gitReviewError: HTMLElement;
  gitReviewToggleFilesButton: HTMLButtonElement;
  gitReviewFileList: HTMLElement;
  gitReviewDiffContainer: HTMLElement;
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
        <div class="header-main">
          <h1>PocketCodex</h1>
          <p class="header-context">Workspace runtime console</p>
        </div>
        <div class="header-actions" aria-label="Session controls">
          <span class="status-chip state-disconnected" data-role="socket-state">disconnected</span>
          <button class="button-secondary" type="button" data-role="reconnect-events">Reconnect</button>
          <button class="button-secondary" type="button" data-role="logout">Logout</button>
          <button class="sidebar-toggle" type="button" data-role="sidebar-toggle" aria-label="Toggle sidebar">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="3" y1="5" x2="17" y2="5"/>
              <line x1="3" y1="10" x2="17" y2="10"/>
              <line x1="3" y1="15" x2="17" y2="15"/>
            </svg>
          </button>
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
          <section class="panel workspace-tree-panel">
            <h2>Workspaces</h2>
            <div class="workspace-tree" data-role="workspace-tree"></div>
          </section>

          <section class="panel utility-panel">
            <h2>Actions</h2>
            <div class="utility-actions utility-actions-primary">
              <button type="button" data-role="start-thread">New Thread</button>
            </div>
            <div class="utility-actions utility-actions-secondary">
              <button class="button-secondary" type="button" data-role="refresh-threads">Refresh Threads</button>
              <button class="button-secondary" type="button" data-role="refresh-workspaces">Refresh Workspaces</button>
              <button class="button-secondary" type="button" data-role="open-git-review">Open Git Review</button>
            </div>

            <details class="workspace-disclosure">
              <summary>Add workspace</summary>
              <form id="workspace-form">
                <label>
                  Absolute Path
                  <input
                    type="text"
                    name="absolutePath"
                    placeholder="/home/divyam/projects/my-repo"
                    required
                    data-role="workspace-path"
                  />
                </label>
                <button type="submit" data-role="workspace-submit">Add Workspace</button>
              </form>
            </details>

            <div class="settings-note">Runtime mode: YOLO (approvals off)</div>
            <div class="settings-form">
              <label class="settings-toggle">
                <input type="checkbox" data-role="settings-show-status-events" />
                <span>Show status events</span>
              </label>
              <label class="settings-toggle">
                <input type="checkbox" data-role="settings-show-internal-events" />
                <span>Show internal events</span>
              </label>
              <label class="settings-toggle">
                <input type="checkbox" data-role="settings-compact-status-bursts" />
                <span>Compact status bursts</span>
              </label>
            </div>
          </section>
        </aside>

        <section class="main-column">
          <section class="conversation-panel" data-role="conversation-panel">
            <div class="conversation-header">
              <h2 data-role="conversation-title">Conversation</h2>
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
              <div class="composer-context-chips" data-role="composer-context-chips">
                <span class="context-chip context-chip-workspace" data-role="context-chip-workspace">
                  <span class="context-chip-icon">📁</span>
                  <span class="context-chip-label" data-role="context-chip-workspace-label">Workspace</span>
                </span>
                <span class="context-chip context-chip-git is-hidden" data-role="context-chip-git">
                  <span class="context-chip-icon">🌿</span>
                  <span class="context-chip-label" data-role="context-chip-git-label">main</span>
                </span>
              </div>
              <div class="composer-inline-row">
                <input
                  class="is-hidden"
                  type="file"
                  accept="image/*"
                  multiple
                  data-role="composer-image-input"
                />
                <button
                  class="button-secondary composer-attach-icon"
                  type="button"
                  data-role="composer-attach-image"
                  aria-label="Add image"
                  title="Add image"
                >
                  +
                </button>
                <label class="composer-inline-prompt">
                  Prompt
                  <textarea
                    id="turn-prompt"
                    name="prompt"
                    rows="1"
                    placeholder="Ask Codex..."
                    aria-label="Prompt"
                    data-role="turn-prompt"
                  ></textarea>
                </label>
                <button class="composer-send-fab" type="submit" data-role="start-turn" aria-label="Send">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
                <button class="button-secondary composer-interrupt-mini" type="button" data-role="interrupt-turn">
                  Stop
                </button>
              </div>
              <div class="composer-image-list is-hidden" data-role="composer-image-list"></div>
              <div class="composer-meta-row">
                <div class="turn-status" data-role="turn-status">
                  <span class="turn-status-chip phase-idle" data-role="turn-status-chip">Idle</span>
                  <span class="turn-status-text" data-role="turn-status-text">Ready to send</span>
                </div>
                <p class="turn-shortcuts">Cmd/Ctrl+Enter to send · Esc to interrupt</p>
              </div>
              <div class="background-terminal is-hidden" data-role="background-terminal-row">
                <span class="background-terminal-chip">Background Terminal</span>
                <span class="background-terminal-text" data-role="background-terminal-text">Idle</span>
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

          <section class="git-review-panel is-hidden" data-role="git-review-panel">
            <div class="git-review-header">
              <div class="git-review-header-copy">
                <p class="git-review-eyebrow">Workspace Review</p>
                <h2 data-role="git-review-title">Git Diff</h2>
                <p class="git-review-status" data-role="git-review-status">Select a workspace to inspect changes.</p>
              </div>
              <div class="git-review-header-actions">
                <button class="button-secondary" type="button" data-role="git-review-refresh">Refresh</button>
                <button class="button-secondary" type="button" data-role="git-review-back">Back to Chat</button>
              </div>
            </div>
            <p class="git-review-error is-hidden" data-role="git-review-error"></p>
            <div class="git-review-body">
              <aside class="git-review-files">
                <div class="git-review-files-header">
                  <h3>Changed Files</h3>
                  <button class="button-secondary git-review-toggle-files" type="button" data-role="git-review-toggle-files">
                    Hide Files
                  </button>
                </div>
                <div class="git-review-file-list" data-role="git-review-file-list">
                  <p class="empty">No file changes detected.</p>
                </div>
              </aside>
              <section class="git-review-diff">
                <h3>Diff Preview</h3>
                <div class="git-review-diff-content" data-role="git-review-diff"></div>
              </section>
            </div>
          </section>
        </section>
      </section>
    </main>
  `;

  const sidebarToggle = requireElement<HTMLButtonElement>(root, "[data-role='sidebar-toggle']");
  const sidebarOverlay = requireElement<HTMLElement>(root, "[data-role='sidebar-overlay']");
  const navColumn = requireElement<HTMLElement>(root, ".nav-column");

  const setSidebarOpen = (open: boolean): void => {
    navColumn.classList.toggle("is-open", open);
    sidebarOverlay.classList.toggle("is-open", open);
    root.classList.toggle("has-open-sidebar", open);
  };

  const closeSidebar = (): void => {
    setSidebarOpen(false);
  };

  sidebarToggle.addEventListener("click", () => {
    const isOpen = !navColumn.classList.contains("is-open");
    setSidebarOpen(isOpen);
  });

  sidebarOverlay.addEventListener("click", closeSidebar);

  root.ownerDocument.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && navColumn.classList.contains("is-open")) {
      closeSidebar();
    }
  });

  const drawerMediaQuery = window.matchMedia("(max-width: 899px)");
  const handleDrawerMediaChange = (): void => {
    if (!drawerMediaQuery.matches) {
      closeSidebar();
    }
  };

  if (typeof drawerMediaQuery.addEventListener === "function") {
    drawerMediaQuery.addEventListener("change", handleDrawerMediaChange);
  } else if (typeof drawerMediaQuery.addListener === "function") {
    drawerMediaQuery.addListener(handleDrawerMediaChange);
  }

  navColumn.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("button[data-action='thread-select']")) {
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
    workspaceSubmitButton: requireElement<HTMLButtonElement>(root, "[data-role='workspace-submit']"),
    workspaceTree: requireElement<HTMLElement>(root, "[data-role='workspace-tree']"),
    openGitReviewButton: requireElement<HTMLButtonElement>(root, "[data-role='open-git-review']"),
    refreshThreadsButton: requireElement<HTMLButtonElement>(root, "[data-role='refresh-threads']"),
    startThreadButton: requireElement<HTMLButtonElement>(root, "[data-role='start-thread']"),
    conversationTitle: requireElement<HTMLElement>(root, "[data-role='conversation-title']"),
    turnForm: requireElement<HTMLFormElement>(root, "#turn-form"),
    turnPromptInput: requireElement<HTMLTextAreaElement>(root, "[data-role='turn-prompt']"),
    composerAttachImageButton: requireElement<HTMLButtonElement>(root, "[data-role='composer-attach-image']"),
    composerImageInput: requireElement<HTMLInputElement>(root, "[data-role='composer-image-input']"),
    composerImageList: requireElement<HTMLElement>(root, "[data-role='composer-image-list']"),
    composerContextChips: requireElement<HTMLElement>(root, "[data-role='composer-context-chips']"),
    contextChipWorkspace: requireElement<HTMLElement>(root, "[data-role='context-chip-workspace']"),
    contextChipWorkspaceLabel: requireElement<HTMLElement>(root, "[data-role='context-chip-workspace-label']"),
    contextChipGit: requireElement<HTMLElement>(root, "[data-role='context-chip-git']"),
    contextChipGitLabel: requireElement<HTMLElement>(root, "[data-role='context-chip-git-label']"),
    turnStatusChip: requireElement<HTMLElement>(root, "[data-role='turn-status-chip']"),
    turnStatusText: requireElement<HTMLElement>(root, "[data-role='turn-status-text']"),
    backgroundTerminalRow: requireElement<HTMLElement>(root, "[data-role='background-terminal-row']"),
    backgroundTerminalText: requireElement<HTMLElement>(root, "[data-role='background-terminal-text']"),
    startTurnButton: requireElement<HTMLButtonElement>(root, "[data-role='start-turn']"),
    interruptTurnButton: requireElement<HTMLButtonElement>(root, "[data-role='interrupt-turn']"),
    transcriptStream: requireElement<HTMLElement>(root, "[data-role='transcript-stream']"),
    transcriptList: requireElement<HTMLOListElement>(root, "[data-role='transcript-list']"),
    transcriptJumpLatestButton: requireElement<HTMLButtonElement>(root, "[data-role='transcript-jump-latest']"),
    eventStream: requireElement<HTMLElement>(root, "[data-role='event-stream']"),
    eventList: requireElement<HTMLOListElement>(root, "[data-role='event-list']"),
    toggleStatusEventsButton: requireElement<HTMLButtonElement>(root, "[data-role='toggle-status-events']"),
    toggleInternalEventsButton: requireElement<HTMLButtonElement>(root, "[data-role='toggle-internal-events']"),
    settingsShowStatusEventsInput: requireElement<HTMLInputElement>(root, "[data-role='settings-show-status-events']"),
    settingsShowInternalEventsInput: requireElement<HTMLInputElement>(root, "[data-role='settings-show-internal-events']"),
    settingsCompactStatusBurstsInput: requireElement<HTMLInputElement>(
      root,
      "[data-role='settings-compact-status-bursts']"
    ),
    jumpLatestButton: requireElement<HTMLButtonElement>(root, "[data-role='jump-latest']"),
    conversationPanel: requireElement<HTMLElement>(root, "[data-role='conversation-panel']"),
    gitReviewPanel: requireElement<HTMLElement>(root, "[data-role='git-review-panel']"),
    gitReviewBackButton: requireElement<HTMLButtonElement>(root, "[data-role='git-review-back']"),
    gitReviewRefreshButton: requireElement<HTMLButtonElement>(root, "[data-role='git-review-refresh']"),
    gitReviewTitle: requireElement<HTMLElement>(root, "[data-role='git-review-title']"),
    gitReviewStatusText: requireElement<HTMLElement>(root, "[data-role='git-review-status']"),
    gitReviewError: requireElement<HTMLElement>(root, "[data-role='git-review-error']"),
    gitReviewToggleFilesButton: requireElement<HTMLButtonElement>(root, "[data-role='git-review-toggle-files']"),
    gitReviewFileList: requireElement<HTMLElement>(root, "[data-role='git-review-file-list']"),
    gitReviewDiffContainer: requireElement<HTMLElement>(root, "[data-role='git-review-diff']")
  };
}
