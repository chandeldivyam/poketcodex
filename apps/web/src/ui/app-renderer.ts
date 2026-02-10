import type { AppState, AppStateKey, TimelineEventEntry, TimelineEventKind } from "../state/app-state.js";
import {
  selectActiveWorkspace,
  selectSelectedThreadLabel,
  selectThreadActionsDisabled,
  selectWorkspaceActionsDisabled
} from "../state/selectors.js";
import type { AppDomRefs } from "./app-shell.js";

const MAX_RENDERED_EVENTS = 100;
const TIMELINE_BOTTOM_THRESHOLD_PX = 28;

const TIMELINE_KIND_LABELS: Record<TimelineEventKind, string> = {
  user: "User",
  runtime: "Runtime",
  socket: "Socket",
  system: "System",
  error: "Error"
};

function setHidden(element: HTMLElement, hidden: boolean): void {
  element.classList.toggle("is-hidden", hidden);
}

function renderEmptyMessage(message: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.className = "empty";
  paragraph.textContent = message;
  return paragraph;
}

function createTimelineItem(entry: TimelineEventEntry): HTMLLIElement {
  const lineItem = document.createElement("li");
  lineItem.className = `timeline-item timeline-${entry.kind}`;

  const row = document.createElement("div");
  row.className = "timeline-item-row";

  const badge = document.createElement("span");
  badge.className = `timeline-badge timeline-badge-${entry.kind}`;
  badge.textContent = TIMELINE_KIND_LABELS[entry.kind];

  const timestamp = document.createElement("time");
  timestamp.className = "timeline-time";
  timestamp.textContent = entry.timestamp;

  row.append(badge, timestamp);

  const message = document.createElement("p");
  message.className = "timeline-message";
  message.textContent = entry.message;

  lineItem.append(row, message);

  return lineItem;
}

export class AppRenderer {
  private readonly dom: AppDomRefs;
  private readonly readState: () => Readonly<AppState>;
  private followTimeline = true;

  constructor(dom: AppDomRefs, readState: () => Readonly<AppState>) {
    this.dom = dom;
    this.readState = readState;

    this.dom.eventStream.addEventListener("scroll", () => {
      this.handleTimelineScroll();
    });

    this.dom.jumpLatestButton.addEventListener("click", () => {
      this.followTimeline = true;
      this.scrollToLatest();
      this.updateJumpLatestVisibility();
    });
  }

  renderAll(): void {
    this.render(new Set(["session", "workspace", "thread", "stream"]));
  }

  render(changedSlices: ReadonlySet<AppStateKey>): void {
    if (
      changedSlices.has("session") ||
      changedSlices.has("workspace") ||
      changedSlices.has("thread") ||
      changedSlices.has("stream")
    ) {
      this.renderHeader();
      this.renderActionStates();
    }

    if (changedSlices.has("session")) {
      this.renderAuthVisibility();
      this.renderError();
    }

    if (changedSlices.has("workspace")) {
      this.renderWorkspaceList();
      this.renderContextLabels();
    }

    if (changedSlices.has("thread")) {
      this.renderThreadList();
      this.renderContextLabels();
    }

    if (changedSlices.has("stream")) {
      this.renderDraftPrompt();
      this.renderEvents();
    }
  }

  private renderHeader(): void {
    const state = this.readState();
    const connectionClass = `status-chip state-${state.stream.socketState}`;

    this.dom.socketStateChip.className = connectionClass;
    this.dom.socketStateChip.textContent = state.stream.socketState;
    this.dom.reconnectEventsButton.textContent = state.stream.socketState === "connected" ? "Resubscribe" : "Reconnect";
  }

  private renderAuthVisibility(): void {
    const state = this.readState();
    setHidden(this.dom.loginPanel, state.session.authenticated);
    setHidden(this.dom.appPanels, !state.session.authenticated);
  }

  private renderError(): void {
    const state = this.readState();
    const errorMessage = state.session.error;

    if (errorMessage) {
      setHidden(this.dom.errorBanner, false);
      this.dom.errorMessage.textContent = errorMessage;
      return;
    }

    this.dom.errorMessage.textContent = "";
    setHidden(this.dom.errorBanner, true);
  }

  private renderActionStates(): void {
    const state = this.readState();
    const workspaceActionsDisabled = selectWorkspaceActionsDisabled(state);
    const threadActionsDisabled = selectThreadActionsDisabled(state);

    this.dom.refreshWorkspacesButton.disabled = workspaceActionsDisabled;
    this.dom.logoutButton.disabled = workspaceActionsDisabled;

    this.dom.loginSubmitButton.disabled = state.session.busy;
    this.dom.workspaceSubmitButton.disabled = state.session.busy;

    this.dom.reconnectEventsButton.disabled = threadActionsDisabled;
    this.dom.refreshThreadsButton.disabled = threadActionsDisabled;
    this.dom.startThreadButton.disabled = threadActionsDisabled;
    this.dom.startTurnButton.disabled = threadActionsDisabled;
    this.dom.interruptTurnButton.disabled = threadActionsDisabled;
  }

  private renderWorkspaceList(): void {
    const state = this.readState();

    if (state.workspace.workspaces.length === 0) {
      this.dom.workspaceList.replaceChildren(renderEmptyMessage("No workspaces yet."));
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const workspace of state.workspace.workspaces) {
      const isSelected = workspace.workspaceId === state.workspace.selectedWorkspaceId;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `workspace-item ${isSelected ? "is-selected" : ""}`.trim();
      button.dataset.workspaceId = workspace.workspaceId;

      const title = document.createElement("strong");
      title.textContent = workspace.displayName;

      const path = document.createElement("span");
      path.textContent = workspace.absolutePath;

      button.append(title, path);
      fragment.append(button);
    }

    this.dom.workspaceList.replaceChildren(fragment);
  }

  private renderThreadList(): void {
    const state = this.readState();

    if (state.thread.threads.length === 0) {
      this.dom.threadList.replaceChildren(renderEmptyMessage("No thread metadata yet."));
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const thread of state.thread.threads) {
      const isSelected = thread.threadId === state.thread.selectedThreadId;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `thread-item ${isSelected ? "is-selected" : ""}`.trim();
      button.dataset.threadId = thread.threadId;

      const title = document.createElement("strong");
      title.textContent = thread.title;

      const threadId = document.createElement("span");
      threadId.textContent = thread.threadId;

      button.append(title, threadId);

      if (thread.archived) {
        const badge = document.createElement("span");
        badge.className = "thread-badge";
        badge.textContent = "Archived";
        button.append(badge);
      }

      fragment.append(button);
    }

    this.dom.threadList.replaceChildren(fragment);
  }

  private renderContextLabels(): void {
    const state = this.readState();
    const activeWorkspace = selectActiveWorkspace(state);

    this.dom.selectedWorkspaceLabel.textContent = activeWorkspace?.displayName ?? "None";
    this.dom.selectedThreadLabel.textContent = selectSelectedThreadLabel(state);
  }

  private renderDraftPrompt(): void {
    const state = this.readState();
    if (this.dom.turnPromptInput.value !== state.stream.draftPrompt) {
      this.dom.turnPromptInput.value = state.stream.draftPrompt;
    }
  }

  private renderEvents(): void {
    const state = this.readState();
    const events = state.stream.events.slice(-MAX_RENDERED_EVENTS);

    if (events.length === 0) {
      const placeholder = document.createElement("li");
      placeholder.className = "timeline-item timeline-system";
      placeholder.textContent = "Awaiting events...";
      this.dom.eventList.replaceChildren(placeholder);
      this.followTimeline = true;
      this.updateJumpLatestVisibility();
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const eventEntry of events) {
      fragment.append(createTimelineItem(eventEntry));
    }

    this.dom.eventList.replaceChildren(fragment);

    if (this.followTimeline) {
      this.scrollToLatest();
    }

    this.updateJumpLatestVisibility();
  }

  private isNearTimelineBottom(): boolean {
    const { scrollHeight, scrollTop, clientHeight } = this.dom.eventStream;
    return scrollHeight - (scrollTop + clientHeight) <= TIMELINE_BOTTOM_THRESHOLD_PX;
  }

  private handleTimelineScroll(): void {
    this.followTimeline = this.isNearTimelineBottom();
    this.updateJumpLatestVisibility();
  }

  private updateJumpLatestVisibility(): void {
    const hasEvents = this.readState().stream.events.length > 0;
    setHidden(this.dom.jumpLatestButton, !hasEvents || this.followTimeline);
  }

  private scrollToLatest(): void {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        this.dom.eventStream.scrollTop = this.dom.eventStream.scrollHeight;
      });
      return;
    }

    this.dom.eventStream.scrollTop = this.dom.eventStream.scrollHeight;
  }
}
