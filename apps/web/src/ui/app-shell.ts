export interface AppDomRefs {
  loginPanel: HTMLElement;
  appPanels: HTMLElement;
  errorBanner: HTMLElement;
  errorMessage: HTMLElement;
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
  selectedWorkspaceLabel: HTMLElement;
  selectedThreadLabel: HTMLElement;
  turnForm: HTMLFormElement;
  turnPromptInput: HTMLTextAreaElement;
  startTurnButton: HTMLButtonElement;
  interruptTurnButton: HTMLButtonElement;
  eventList: HTMLOListElement;
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
        <h1>PocketCodex</h1>
        <p>Mobile Codex control plane</p>
        <div class="status-row">
          <span class="status-chip state-disconnected" data-role="socket-state">disconnected</span>
          <button class="button-secondary" type="button" data-role="refresh-workspaces">Refresh</button>
          <button class="button-secondary" type="button" data-role="reconnect-events">Reconnect</button>
          <button class="button-secondary" type="button" data-role="logout">Logout</button>
        </div>
      </header>

      <section class="error-banner is-hidden" data-role="error-banner">
        <span data-role="error-message"></span>
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

      <section class="panel-grid is-hidden" data-role="app-panels">
        <section class="panel workspace-panel">
          <h2>Workspaces</h2>
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
          <div class="list-container" data-role="workspace-list"></div>
        </section>

        <section class="panel thread-panel">
          <h2>Threads</h2>
          <div class="thread-actions">
            <button class="button-secondary" type="button" data-role="refresh-threads">Refresh Threads</button>
            <button type="button" data-role="start-thread">Start Thread</button>
          </div>
          <div class="list-container" data-role="thread-list"></div>
          <p class="selected-thread">Workspace: <span data-role="selected-workspace">None</span></p>
          <p class="selected-thread">Thread: <span data-role="selected-thread">None</span></p>
        </section>

        <section class="panel event-panel">
          <h2>Turn Console</h2>
          <form id="turn-form">
            <label>
              Prompt
              <textarea id="turn-prompt" name="prompt" rows="3" placeholder="Ask Codex..." required data-role="turn-prompt"></textarea>
            </label>
            <div class="turn-actions">
              <button type="submit" data-role="start-turn">Start Turn</button>
              <button class="button-danger" type="button" data-role="interrupt-turn">Interrupt</button>
            </div>
          </form>
          <div class="event-stream">
            <ol data-role="event-list">
              <li>Awaiting events...</li>
            </ol>
          </div>
        </section>
      </section>
    </main>
  `;

  return {
    loginPanel: requireElement<HTMLElement>(root, "[data-role='login-panel']"),
    appPanels: requireElement<HTMLElement>(root, "[data-role='app-panels']"),
    errorBanner: requireElement<HTMLElement>(root, "[data-role='error-banner']"),
    errorMessage: requireElement<HTMLElement>(root, "[data-role='error-message']"),
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
    selectedWorkspaceLabel: requireElement<HTMLElement>(root, "[data-role='selected-workspace']"),
    selectedThreadLabel: requireElement<HTMLElement>(root, "[data-role='selected-thread']"),
    turnForm: requireElement<HTMLFormElement>(root, "#turn-form"),
    turnPromptInput: requireElement<HTMLTextAreaElement>(root, "[data-role='turn-prompt']"),
    startTurnButton: requireElement<HTMLButtonElement>(root, "[data-role='start-turn']"),
    interruptTurnButton: requireElement<HTMLButtonElement>(root, "[data-role='interrupt-turn']"),
    eventList: requireElement<HTMLOListElement>(root, "[data-role='event-list']")
  };
}
