import type {
  AppState,
  AppStateKey,
  TimelineEventCategory,
  TimelineEventEntry,
  TurnExecutionPhase
} from "../state/app-state.js";
import {
  selectActiveWorkspace,
  selectSelectedThreadLabel,
  selectThreadActionsDisabled,
  selectWorkspaceActionsDisabled
} from "../state/selectors.js";
import type { AppDomRefs } from "./app-shell.js";

const MAX_RENDERED_EVENTS = 100;
const TIMELINE_BOTTOM_THRESHOLD_PX = 28;
const TURN_STATUS_TICK_MS = 1_000;

const TIMELINE_CATEGORY_LABELS: Record<TimelineEventCategory, string> = {
  input: "Input",
  message: "Message",
  reasoning: "Reasoning",
  tool: "Tool",
  status: "Status",
  system: "System",
  error: "Error"
};

const TIMELINE_DETAILS_SUMMARY_LABELS: Record<TimelineEventCategory, string> = {
  input: "Input Details",
  message: "Message Details",
  reasoning: "Reasoning Trace",
  tool: "Tool Payload",
  status: "Status Payload",
  system: "System Payload",
  error: "Error Details"
};

const TIMELINE_MESSAGE_COLLAPSE_LENGTH = 220;
const TIMELINE_MESSAGE_COLLAPSE_LINES = 4;

interface TurnStatusPresentation {
  label: string;
  description: string;
  className: string;
}

function formatElapsed(startedAtMs: number): string {
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const elapsedSeconds = Math.floor(elapsedMs / 1_000);

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatRelativeTimestamp(timestamp: string | null | undefined): string | null {
  if (!timestamp) {
    return null;
  }

  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1_000));
  if (elapsedSeconds < 45) {
    return "just now";
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) {
    return `${elapsedDays}d ago`;
  }

  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) {
    return `${elapsedMonths}mo ago`;
  }

  const elapsedYears = Math.floor(elapsedMonths / 12);
  return `${elapsedYears}y ago`;
}

function getTurnStatusPresentation(phase: TurnExecutionPhase, startedAtMs: number | null): TurnStatusPresentation {
  if (phase === "submitting") {
    const suffix = startedAtMs !== null ? ` (${formatElapsed(startedAtMs)})` : "";
    return {
      label: "Submitting",
      description: `Sending prompt${suffix}`,
      className: "phase-submitting"
    };
  }

  if (phase === "running") {
    const suffix = startedAtMs !== null ? formatElapsed(startedAtMs) : "0s";
    return {
      label: "Running",
      description: `Streaming response for ${suffix}`,
      className: "phase-running"
    };
  }

  if (phase === "interrupting") {
    const suffix = startedAtMs !== null ? ` (${formatElapsed(startedAtMs)})` : "";
    return {
      label: "Interrupting",
      description: `Waiting for runtime to stop${suffix}`,
      className: "phase-interrupting"
    };
  }

  if (phase === "error") {
    return {
      label: "Error",
      description: "Last turn failed. Adjust prompt or retry.",
      className: "phase-error"
    };
  }

  return {
    label: "Idle",
    description: "Ready to send",
    className: "phase-idle"
  };
}

function setHidden(element: HTMLElement, hidden: boolean): void {
  element.classList.toggle("is-hidden", hidden);
}

function renderEmptyMessage(message: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.className = "empty";
  paragraph.textContent = message;
  return paragraph;
}

function shouldCollapseTimelineMessage(message: string): boolean {
  const lineCount = message.split(/\r?\n/).length;
  return message.length >= TIMELINE_MESSAGE_COLLAPSE_LENGTH || lineCount >= TIMELINE_MESSAGE_COLLAPSE_LINES;
}

function createTimelineItem(entry: TimelineEventEntry): HTMLLIElement {
  const lineItem = document.createElement("li");
  lineItem.className = `timeline-item timeline-${entry.kind} timeline-category-${entry.category}`;

  const row = document.createElement("div");
  row.className = "timeline-item-row";

  const badgeRow = document.createElement("div");
  badgeRow.className = "timeline-badge-row";

  const badge = document.createElement("span");
  badge.className = `timeline-badge timeline-badge-category-${entry.category}`;
  badge.textContent = TIMELINE_CATEGORY_LABELS[entry.category];
  badgeRow.append(badge);

  if (entry.source) {
    const sourceChip = document.createElement("span");
    sourceChip.className = "timeline-source";
    sourceChip.textContent = entry.source;
    badgeRow.append(sourceChip);
  }

  if (entry.isInternal) {
    const internalBadge = document.createElement("span");
    internalBadge.className = "timeline-internal-badge";
    internalBadge.textContent = "Internal";
    badgeRow.append(internalBadge);
  }

  const timestamp = document.createElement("time");
  timestamp.className = "timeline-time";
  timestamp.textContent = entry.timestamp;

  row.append(badgeRow, timestamp);

  const message = document.createElement("p");
  message.className = "timeline-message";
  message.textContent = entry.message;

  lineItem.append(row, message);

  if (shouldCollapseTimelineMessage(entry.message)) {
    message.classList.add("timeline-message-collapsed");

    const toggleMessageButton = document.createElement("button");
    toggleMessageButton.type = "button";
    toggleMessageButton.className = "timeline-toggle-message";

    let messageExpanded = false;
    const updateMessageExpansion = (): void => {
      message.classList.toggle("timeline-message-collapsed", !messageExpanded);
      lineItem.classList.toggle("is-message-expanded", messageExpanded);
      toggleMessageButton.textContent = messageExpanded ? "Collapse Message" : "Expand Message";
    };

    toggleMessageButton.addEventListener("click", () => {
      messageExpanded = !messageExpanded;
      updateMessageExpansion();
    });

    updateMessageExpansion();
    lineItem.append(toggleMessageButton);
  }

  if (entry.details) {
    const details = document.createElement("details");
    details.className = "timeline-details";

    const summary = document.createElement("summary");
    summary.textContent = TIMELINE_DETAILS_SUMMARY_LABELS[entry.category];

    const pre = document.createElement("pre");
    pre.className = "timeline-details-content";
    pre.textContent = entry.details;

    details.addEventListener("toggle", () => {
      lineItem.classList.toggle("is-details-expanded", details.open);
    });

    details.append(summary, pre);
    lineItem.append(details);
  }

  return lineItem;
}

function createCompactedStatusEvent(statusEvents: TimelineEventEntry[]): TimelineEventEntry {
  if (statusEvents.length === 0) {
    throw new Error("Cannot compact an empty status event list.");
  }

  const first = statusEvents[0];
  const last = statusEvents[statusEvents.length - 1];
  const summaryLines = statusEvents.map((eventEntry) => `[${eventEntry.timestamp}] ${eventEntry.message}`);

  if (first === undefined || last === undefined) {
    throw new Error("Cannot compact status events without boundaries.");
  }

  const compactedEvent: TimelineEventEntry = {
    id: `${first.id}-to-${last.id}-summary`,
    timestamp: last.timestamp,
    message: `${statusEvents.length} status updates`,
    kind: last.kind,
    category: last.category,
    isInternal: statusEvents.some((eventEntry) => eventEntry.isInternal),
    details: summaryLines.join("\n")
  };

  const source = last.source ?? first.source;
  if (source !== undefined) {
    compactedEvent.source = source;
  }

  return compactedEvent;
}

export class AppRenderer {
  private readonly dom: AppDomRefs;
  private readonly readState: () => Readonly<AppState>;
  private followTimeline = true;
  private turnStatusTimer: number | undefined;

  constructor(dom: AppDomRefs, readState: () => Readonly<AppState>) {
    this.dom = dom;
    this.readState = readState;

    this.dom.eventStream.addEventListener("scroll", () => {
      this.handleTimelineScroll();
    });

    this.dom.jumpLatestButton.addEventListener("click", () => {
      this.followTimeline = true;
      this.scrollToLatest();
      this.updateJumpLatestVisibility(this.getVisibleEvents().length > 0);
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
      this.renderTurnStatus();
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
    const retryLabel = state.session.errorRetryLabel;

    if (errorMessage) {
      setHidden(this.dom.errorBanner, false);
      this.dom.errorMessage.textContent = errorMessage;
      if (retryLabel) {
        this.dom.errorRetryButton.textContent = retryLabel;
        setHidden(this.dom.errorRetryButton, false);
      } else {
        this.dom.errorRetryButton.textContent = "Retry";
        setHidden(this.dom.errorRetryButton, true);
      }
      return;
    }

    this.dom.errorMessage.textContent = "";
    this.dom.errorRetryButton.textContent = "Retry";
    setHidden(this.dom.errorRetryButton, true);
    setHidden(this.dom.errorBanner, true);
  }

  private renderActionStates(): void {
    const state = this.readState();
    const workspaceActionsDisabled = selectWorkspaceActionsDisabled(state);
    const threadActionsDisabled = selectThreadActionsDisabled(state);
    const turnContextMissing = !state.session.authenticated || !state.workspace.selectedWorkspaceId;
    const turnExecutionActive =
      state.stream.turnPhase === "submitting" ||
      state.stream.turnPhase === "running" ||
      state.stream.turnPhase === "interrupting";

    this.dom.refreshWorkspacesButton.disabled = workspaceActionsDisabled;
    this.dom.logoutButton.disabled = workspaceActionsDisabled;
    this.dom.errorRetryButton.disabled = state.session.busy || state.session.errorRetryLabel === null;

    this.dom.loginSubmitButton.disabled = state.session.busy;
    this.dom.workspaceSubmitButton.disabled = state.session.busy;

    this.dom.reconnectEventsButton.disabled = threadActionsDisabled;
    this.dom.refreshThreadsButton.disabled = threadActionsDisabled;
    this.dom.startThreadButton.disabled = threadActionsDisabled;
    this.dom.startTurnButton.disabled = threadActionsDisabled || turnExecutionActive;
    this.dom.interruptTurnButton.disabled =
      threadActionsDisabled ||
      turnContextMissing ||
      !turnExecutionActive ||
      state.stream.turnPhase === "interrupting";
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

      const titleRow = document.createElement("div");
      titleRow.className = "list-item-title-row";

      const trustBadge = document.createElement("span");
      trustBadge.className = `workspace-badge workspace-badge-${workspace.trusted ? "trusted" : "restricted"}`;
      trustBadge.textContent = workspace.trusted ? "Trusted" : "Restricted";
      titleRow.append(title, trustBadge);

      const path = document.createElement("span");
      path.className = "list-item-path";
      path.textContent = workspace.absolutePath;

      const metadata = document.createElement("span");
      metadata.className = "list-item-meta";
      const updatedLabel = formatRelativeTimestamp(workspace.updatedAt);
      metadata.textContent = updatedLabel ? `Updated ${updatedLabel}` : "Update time unavailable";

      button.append(titleRow, path, metadata);
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

      const titleRow = document.createElement("div");
      titleRow.className = "list-item-title-row";
      titleRow.append(title);

      if (thread.archived) {
        const badge = document.createElement("span");
        badge.className = "thread-badge";
        badge.textContent = "Archived";
        titleRow.append(badge);
      }

      const threadId = document.createElement("span");
      threadId.className = "list-item-id";
      threadId.textContent = thread.threadId;

      const metadata = document.createElement("span");
      metadata.className = "list-item-meta";
      const lastSeenLabel = formatRelativeTimestamp(thread.lastSeenAt);
      metadata.textContent = lastSeenLabel ? `Last seen ${lastSeenLabel}` : "No recent activity";

      button.append(titleRow, threadId, metadata);

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

  private renderTurnStatus(): void {
    const state = this.readState();
    const presentation = getTurnStatusPresentation(state.stream.turnPhase, state.stream.turnStartedAtMs);

    this.dom.turnStatusChip.textContent = presentation.label;
    this.dom.turnStatusChip.className = `turn-status-chip ${presentation.className}`;
    this.dom.turnStatusText.textContent = presentation.description;

    this.syncTurnStatusTimer(state.stream.turnPhase);
  }

  private syncTurnStatusTimer(phase: TurnExecutionPhase): void {
    const shouldTick = phase === "submitting" || phase === "running" || phase === "interrupting";

    if (shouldTick && this.turnStatusTimer === undefined) {
      this.turnStatusTimer = window.setInterval(() => {
        this.renderTurnStatus();
      }, TURN_STATUS_TICK_MS);
      return;
    }

    if (!shouldTick && this.turnStatusTimer !== undefined) {
      window.clearInterval(this.turnStatusTimer);
      this.turnStatusTimer = undefined;
    }
  }

  private renderEvents(): void {
    const state = this.readState();
    const { visibleEvents, hiddenInternalCount, hiddenStatusCount } = this.buildEventViews();

    this.renderEventToolbar(
      state.stream.showStatusEvents,
      hiddenStatusCount,
      state.stream.showInternalEvents,
      hiddenInternalCount
    );

    if (visibleEvents.length === 0) {
      const placeholder = document.createElement("li");
      placeholder.className = "timeline-item timeline-system";
      if (hiddenStatusCount > 0 || hiddenInternalCount > 0) {
        placeholder.textContent =
          "Events are hidden by filters. Enable Show Status or Show Internal to inspect them.";
      } else {
        placeholder.textContent = "Awaiting events...";
      }
      this.dom.eventList.replaceChildren(placeholder);
      this.followTimeline = true;
      this.updateJumpLatestVisibility(false);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const eventEntry of visibleEvents) {
      fragment.append(createTimelineItem(eventEntry));
    }

    this.dom.eventList.replaceChildren(fragment);

    if (this.followTimeline) {
      this.scrollToLatest();
    }

    this.updateJumpLatestVisibility(visibleEvents.length > 0);
  }

  private renderEventToolbar(
    showStatusEvents: boolean,
    hiddenStatusCount: number,
    showInternalEvents: boolean,
    hiddenInternalCount: number
  ): void {
    this.dom.toggleStatusEventsButton.textContent = showStatusEvents
      ? "Hide Status"
      : hiddenStatusCount > 0
        ? `Show Status (${hiddenStatusCount})`
        : "Show Status";

    this.dom.toggleInternalEventsButton.textContent = showInternalEvents
      ? "Hide Internal"
      : hiddenInternalCount > 0
        ? `Show Internal (${hiddenInternalCount})`
        : "Show Internal";
  }

  private isNearTimelineBottom(): boolean {
    const { scrollHeight, scrollTop, clientHeight } = this.dom.eventStream;
    return scrollHeight - (scrollTop + clientHeight) <= TIMELINE_BOTTOM_THRESHOLD_PX;
  }

  private handleTimelineScroll(): void {
    this.followTimeline = this.isNearTimelineBottom();
    this.updateJumpLatestVisibility(this.getVisibleEvents().length > 0);
  }

  private updateJumpLatestVisibility(hasVisibleEvents: boolean): void {
    setHidden(this.dom.jumpLatestButton, !hasVisibleEvents || this.followTimeline);
  }

  private getVisibleEvents(): TimelineEventEntry[] {
    const streamState = this.readState().stream;
    const allEvents = streamState.events.slice(-MAX_RENDERED_EVENTS);
    const internalFilteredEvents = streamState.showInternalEvents
      ? allEvents
      : allEvents.filter((eventEntry) => !eventEntry.isInternal);
    const statusFilteredEvents = streamState.showStatusEvents
      ? internalFilteredEvents
      : internalFilteredEvents.filter((eventEntry) => eventEntry.category !== "status");

    return this.compactStatusBursts(statusFilteredEvents);
  }

  private buildEventViews(): {
    visibleEvents: TimelineEventEntry[];
    hiddenInternalCount: number;
    hiddenStatusCount: number;
  } {
    const streamState = this.readState().stream;
    const allEvents = streamState.events.slice(-MAX_RENDERED_EVENTS);
    const internalFilteredEvents = streamState.showInternalEvents
      ? allEvents
      : allEvents.filter((eventEntry) => !eventEntry.isInternal);
    const statusFilteredEvents = streamState.showStatusEvents
      ? internalFilteredEvents
      : internalFilteredEvents.filter((eventEntry) => eventEntry.category !== "status");

    return {
      visibleEvents: this.compactStatusBursts(statusFilteredEvents),
      hiddenInternalCount: allEvents.length - internalFilteredEvents.length,
      hiddenStatusCount: internalFilteredEvents.length - statusFilteredEvents.length
    };
  }

  private compactStatusBursts(events: TimelineEventEntry[]): TimelineEventEntry[] {
    const compacted: TimelineEventEntry[] = [];
    let statusBuffer: TimelineEventEntry[] = [];

    const flushStatusBuffer = (): void => {
      if (statusBuffer.length === 0) {
        return;
      }

      if (statusBuffer.length >= 3) {
        compacted.push(createCompactedStatusEvent(statusBuffer));
      } else {
        compacted.push(...statusBuffer);
      }

      statusBuffer = [];
    };

    for (const eventEntry of events) {
      const isRuntimeStatus = eventEntry.kind === "runtime" && eventEntry.category === "status";

      if (!isRuntimeStatus) {
        flushStatusBuffer();
        compacted.push(eventEntry);
        continue;
      }

      if (statusBuffer.length === 0) {
        statusBuffer.push(eventEntry);
        continue;
      }

      const previous = statusBuffer[statusBuffer.length - 1];
      if (previous?.source && eventEntry.source && previous.source !== eventEntry.source) {
        flushStatusBuffer();
      }

      statusBuffer.push(eventEntry);
    }

    flushStatusBuffer();
    return compacted;
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
