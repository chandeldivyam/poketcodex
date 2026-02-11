import type {
  AppState,
  AppStateKey,
  DraftImageAttachment,
  ThreadTranscriptState,
  TimelineEventCategory,
  TimelineEventEntry,
  TranscriptItem,
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
const TRANSCRIPT_BOTTOM_THRESHOLD_PX = 32;
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
const TRANSCRIPT_TEXT_COLLAPSE_LENGTH = 420;
const TRANSCRIPT_TEXT_COLLAPSE_LINES = 9;
const COMPOSER_TEXTAREA_MIN_HEIGHT_PX = 42;
const COMPOSER_TEXTAREA_MAX_HEIGHT_RATIO = 0.22;
const COMPOSER_TEXTAREA_MAX_HEIGHT_PX = 160;

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

function createNavigationStateChip(variant: string, label: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = `nav-state-chip nav-state-${variant}`;
  chip.textContent = label;
  return chip;
}

function createTurnPhaseChip(phase: TurnExecutionPhase): HTMLSpanElement | null {
  if (phase === "submitting") {
    return createNavigationStateChip("pending", "Submitting");
  }

  if (phase === "running") {
    return createNavigationStateChip("running", "Running");
  }

  if (phase === "interrupting") {
    return createNavigationStateChip("pending", "Stopping");
  }

  if (phase === "error") {
    return createNavigationStateChip("error", "Turn Error");
  }

  return null;
}

function renderEmptyMessage(message: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.className = "empty";
  paragraph.textContent = message;
  return paragraph;
}

function truncateInlineText(value: string, maxLength = 90): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function looksLikeOpaqueThreadId(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    return true;
  }

  if (/^thread[-_]/.test(normalized)) {
    return true;
  }

  return normalized.length >= 36 && !/\s/.test(normalized);
}

function formatConversationHeading(selectedThreadLabel: string): string {
  if (selectedThreadLabel === "None") {
    return "Conversation";
  }

  return looksLikeOpaqueThreadId(selectedThreadLabel) ? "Conversation" : truncateInlineText(selectedThreadLabel, 52);
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes} B`;
  }

  if (bytes < 1_048_576) {
    return `${Math.round((bytes / 1_024) * 10) / 10} KB`;
  }

  return `${Math.round((bytes / 1_048_576) * 10) / 10} MB`;
}

function shouldCollapseTimelineMessage(message: string): boolean {
  const lineCount = message.split(/\r?\n/).length;
  return message.length >= TIMELINE_MESSAGE_COLLAPSE_LENGTH || lineCount >= TIMELINE_MESSAGE_COLLAPSE_LINES;
}

function shouldCollapseTranscriptText(text: string): boolean {
  const lineCount = text.split(/\r?\n/).length;
  return text.length >= TRANSCRIPT_TEXT_COLLAPSE_LENGTH || lineCount >= TRANSCRIPT_TEXT_COLLAPSE_LINES;
}

function attachTranscriptCollapseToggle(
  container: HTMLLIElement,
  textElement: HTMLElement,
  options: {
    expandLabel: string;
    collapseLabel: string;
    initialExpanded: boolean;
    onExpandedChange(expanded: boolean): void;
  }
): void {
  const toggleTextButton = document.createElement("button");
  toggleTextButton.type = "button";
  toggleTextButton.className = "transcript-toggle-text";

  let expanded = options.initialExpanded;
  const updateExpandedState = (): void => {
    textElement.classList.toggle("transcript-text-collapsed", !expanded);
    container.classList.toggle("is-transcript-expanded", expanded);
    toggleTextButton.textContent = expanded ? options.collapseLabel : options.expandLabel;
  };

  toggleTextButton.addEventListener("click", () => {
    expanded = !expanded;
    options.onExpandedChange(expanded);
    updateExpandedState();
  });

  updateExpandedState();
  container.append(toggleTextButton);
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
  private followTranscript = true;
  private turnStatusTimer: number | undefined;
  private readonly transcriptExpandedTextKeys = new Set<string>();
  private readonly transcriptOpenDetailKeys = new Set<string>();
  private lastRenderedTranscriptThreadId: string | null = null;
  private lastRenderedTranscriptRef: ThreadTranscriptState | null = null;
  private lastRenderedTranscriptPlaceholder = "";
  private lastRenderedEventsRef: TimelineEventEntry[] | null = null;
  private lastRenderedShowInternalEvents = false;
  private lastRenderedShowStatusEvents = false;
  private lastRenderedCompactStatusBursts = true;
  private lastRenderedDraftImagesRef: DraftImageAttachment[] | null = null;
  private lastRenderedImageAttachmentBusy = false;

  constructor(dom: AppDomRefs, readState: () => Readonly<AppState>) {
    this.dom = dom;
    this.readState = readState;

    this.dom.turnPromptInput.addEventListener("input", () => {
      this.resizePromptInput();
    });

    window.addEventListener("resize", () => {
      this.resizePromptInput();
    });
    window.visualViewport?.addEventListener("resize", () => {
      this.resizePromptInput();
    });

    this.dom.transcriptStream.addEventListener("scroll", () => {
      this.handleTranscriptScroll();
    });

    this.dom.transcriptJumpLatestButton.addEventListener("click", () => {
      this.followTranscript = true;
      this.scrollTranscriptToLatest();
      this.updateTranscriptJumpVisibility(this.selectedThreadTranscript(this.readState())?.items.length ?? 0);
    });

    this.dom.eventStream.addEventListener("scroll", () => {
      this.handleTimelineScroll();
    });

    this.dom.jumpLatestButton.addEventListener("click", () => {
      this.followTimeline = true;
      this.scrollToLatest();
      this.updateJumpLatestVisibility(this.getVisibleEvents().length > 0);
    });

    this.resizePromptInput();
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
      this.renderTranscript();
    }

    if (changedSlices.has("stream")) {
      this.renderDraftPrompt();
      this.renderDraftImages();
      this.renderTurnStatus();
      this.renderSettingsControls();
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
    const turnRequestInFlight =
      state.stream.turnPhase === "submitting" ||
      state.stream.turnPhase === "interrupting";
    const hasInterruptibleTurn =
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
    this.dom.startTurnButton.disabled =
      threadActionsDisabled ||
      turnRequestInFlight ||
      state.stream.imageAttachmentBusy;
    this.dom.interruptTurnButton.disabled =
      threadActionsDisabled ||
      turnContextMissing ||
      !hasInterruptibleTurn ||
      state.stream.turnPhase === "interrupting";

    const disableSettings = !state.session.authenticated || state.session.busy;
    this.dom.settingsShowStatusEventsInput.disabled = disableSettings;
    this.dom.settingsShowInternalEventsInput.disabled = disableSettings;
    this.dom.settingsCompactStatusBurstsInput.disabled = disableSettings;

    const mediaActionsDisabled =
      threadActionsDisabled ||
      turnRequestInFlight ||
      state.stream.imageAttachmentBusy;
    this.dom.composerAttachImageButton.textContent = state.stream.imageAttachmentBusy ? "…" : "+";
    this.dom.composerAttachImageButton.title = state.stream.imageAttachmentBusy ? "Processing image..." : "Add image";
    this.dom.composerAttachImageButton.setAttribute(
      "aria-label",
      state.stream.imageAttachmentBusy ? "Processing image" : "Add image"
    );
    this.dom.composerAttachImageButton.disabled = mediaActionsDisabled;
    this.dom.composerImageInput.disabled = mediaActionsDisabled;
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

      const badgeStack = document.createElement("span");
      badgeStack.className = "list-item-badge-stack";

      const trustBadge = document.createElement("span");
      trustBadge.className = `workspace-badge workspace-badge-${workspace.trusted ? "trusted" : "restricted"}`;
      trustBadge.textContent = workspace.trusted ? "Trusted" : "Restricted";
      badgeStack.append(trustBadge);

      if (isSelected) {
        badgeStack.append(createNavigationStateChip("current", "Current"));
      }

      if (isSelected) {
        const turnPhaseChip = createTurnPhaseChip(state.stream.turnPhase);
        if (turnPhaseChip) {
          badgeStack.append(turnPhaseChip);
        }
      }

      if (isSelected && state.session.error && state.stream.turnPhase !== "error") {
        badgeStack.append(createNavigationStateChip("error", "Needs Attention"));
      }

      titleRow.append(title, badgeStack);

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
      const isRunning = state.thread.runningByThreadId[thread.threadId] === true;
      const hasUnread = state.thread.unreadByThreadId[thread.threadId] === true;
      const transcriptState = state.thread.transcriptsByThreadId[thread.threadId];
      const transcriptHydration = transcriptState?.hydration ?? "idle";
      const previewText = this.threadPreviewText(transcriptState) ?? thread.threadId;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `thread-item ${isSelected ? "is-selected" : ""}`.trim();
      button.dataset.threadId = thread.threadId;

      const title = document.createElement("strong");
      title.textContent = thread.title;

      const titleRow = document.createElement("div");
      titleRow.className = "list-item-title-row";
      const badgeStack = document.createElement("span");
      badgeStack.className = "list-item-badge-stack";

      if (thread.archived) {
        badgeStack.append(createNavigationStateChip("archived", "Archived"));
      }

      if (isRunning) {
        badgeStack.append(createNavigationStateChip("running", "Running"));
      }

      if (hasUnread && !isSelected) {
        badgeStack.append(createNavigationStateChip("unread", "Unread"));
      }

      if (isSelected) {
        badgeStack.append(createNavigationStateChip("current", "Current"));
        const turnPhaseChip = createTurnPhaseChip(state.stream.turnPhase);
        if (turnPhaseChip) {
          badgeStack.append(turnPhaseChip);
        }
      }

      if (isSelected && transcriptHydration === "loading") {
        badgeStack.append(createNavigationStateChip("pending", "Loading"));
      }

      if (isSelected && transcriptHydration === "error") {
        badgeStack.append(createNavigationStateChip("error", "History Error"));
      }

      if (isSelected && state.session.error && state.stream.turnPhase !== "error") {
        badgeStack.append(createNavigationStateChip("error", "Needs Attention"));
      }

      titleRow.append(title, badgeStack);

      const preview = document.createElement("span");
      preview.className = "list-item-preview";
      preview.textContent = previewText;

      const threadId = document.createElement("span");
      threadId.className = "list-item-id";
      threadId.textContent = thread.threadId;

      const metadata = document.createElement("span");
      metadata.className = "list-item-meta";
      const lastSeenLabel = formatRelativeTimestamp(thread.lastSeenAt);
      metadata.textContent = lastSeenLabel ? `Last seen ${lastSeenLabel}` : "No recent activity";

      button.append(titleRow, preview, threadId, metadata);

      fragment.append(button);
    }

    this.dom.threadList.replaceChildren(fragment);
  }

  private threadPreviewText(transcriptState: ThreadTranscriptState | undefined): string | null {
    if (!transcriptState) {
      return null;
    }

    if (transcriptState.hydration === "loading") {
      return "Loading history...";
    }

    if (transcriptState.hydration === "error") {
      return "History unavailable";
    }

    if (transcriptState.items.length === 0) {
      return "No messages yet";
    }

    for (let index = transcriptState.items.length - 1; index >= 0; index -= 1) {
      const item = transcriptState.items[index];
      if (!item) {
        continue;
      }

      if (item.kind === "message") {
        const text = item.text.trim();
        if (text.length === 0) {
          continue;
        }

        const prefix = item.role === "user" ? "You: " : "Codex: ";
        return `${prefix}${truncateInlineText(text, 95)}`;
      }

      if (item.kind === "reasoning") {
        const text = item.summary.trim() || item.content.trim();
        if (text.length === 0) {
          continue;
        }

        return `Reasoning: ${truncateInlineText(text, 95)}`;
      }

      const text = `${item.title}${item.detail ? ` ${item.detail}` : ""}`.trim();
      if (text.length === 0) {
        continue;
      }

      return `Tool: ${truncateInlineText(text, 95)}`;
    }

    return "No messages yet";
  }

  private renderContextLabels(): void {
    const state = this.readState();
    const activeWorkspace = selectActiveWorkspace(state);
    const selectedThreadLabel = selectSelectedThreadLabel(state);

    this.dom.selectedWorkspaceLabel.textContent = activeWorkspace?.displayName ?? "None";
    this.dom.selectedThreadLabel.textContent =
      selectedThreadLabel === "None" ? "None" : truncateInlineText(selectedThreadLabel, 52);
    this.dom.conversationTitle.textContent = formatConversationHeading(selectedThreadLabel);
  }

  private renderDraftPrompt(): void {
    const state = this.readState();
    if (this.dom.turnPromptInput.value !== state.stream.draftPrompt) {
      this.dom.turnPromptInput.value = state.stream.draftPrompt;
      this.resizePromptInput();
    }
  }

  private resizePromptInput(): void {
    const textarea = this.dom.turnPromptInput;
    const visualViewportHeight = window.visualViewport?.height;
    const viewportHeight =
      typeof visualViewportHeight === "number" && visualViewportHeight > 0 ? visualViewportHeight : window.innerHeight;
    const computedMaxHeight = Math.min(
      COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
      Math.max(COMPOSER_TEXTAREA_MIN_HEIGHT_PX, Math.floor(viewportHeight * COMPOSER_TEXTAREA_MAX_HEIGHT_RATIO))
    );

    textarea.style.height = "auto";
    const nextHeight = Math.max(COMPOSER_TEXTAREA_MIN_HEIGHT_PX, Math.min(textarea.scrollHeight, computedMaxHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > computedMaxHeight ? "auto" : "hidden";
  }

  private createDraftImageChip(image: DraftImageAttachment, disableRemove: boolean): HTMLDivElement {
    const chip = document.createElement("div");
    chip.className = "composer-image-chip";
    chip.dataset.imageId = image.id;

    const thumb = document.createElement("img");
    thumb.className = "composer-image-thumb";
    thumb.src = image.dataUrl;
    thumb.alt = image.name;
    thumb.loading = "lazy";

    const meta = document.createElement("div");
    meta.className = "composer-image-meta";

    const name = document.createElement("span");
    name.className = "composer-image-name";
    name.textContent = image.name;

    const detail = document.createElement("span");
    detail.className = "composer-image-detail";
    detail.textContent = `${image.width}x${image.height} · ${formatBytes(image.sizeBytes)} · ${image.source}`;

    meta.append(name, detail);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "button-secondary composer-image-remove";
    removeButton.dataset.action = "remove-draft-image";
    removeButton.dataset.imageId = image.id;
    removeButton.textContent = "Remove";
    removeButton.disabled = disableRemove;

    chip.append(thumb, meta, removeButton);
    return chip;
  }

  private renderDraftImages(): void {
    const state = this.readState();
    const shouldSkip =
      this.lastRenderedDraftImagesRef === state.stream.draftImages &&
      this.lastRenderedImageAttachmentBusy === state.stream.imageAttachmentBusy;
    if (shouldSkip) {
      return;
    }

    if (state.stream.draftImages.length === 0) {
      setHidden(this.dom.composerImageList, true);
      this.dom.composerImageList.replaceChildren();
      this.lastRenderedDraftImagesRef = state.stream.draftImages;
      this.lastRenderedImageAttachmentBusy = state.stream.imageAttachmentBusy;
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const image of state.stream.draftImages) {
      fragment.append(this.createDraftImageChip(image, state.stream.imageAttachmentBusy));
    }

    setHidden(this.dom.composerImageList, false);
    this.dom.composerImageList.replaceChildren(fragment);
    this.lastRenderedDraftImagesRef = state.stream.draftImages;
    this.lastRenderedImageAttachmentBusy = state.stream.imageAttachmentBusy;
  }

  private renderTurnStatus(): void {
    const state = this.readState();
    const presentation = getTurnStatusPresentation(state.stream.turnPhase, state.stream.turnStartedAtMs);

    this.dom.turnStatusChip.textContent = presentation.label;
    this.dom.turnStatusChip.className = `turn-status-chip ${presentation.className}`;
    this.dom.turnStatusText.textContent = presentation.description;

    this.syncTurnStatusTimer(state.stream.turnPhase);
    this.renderBackgroundTerminalStatus();
  }

  private renderBackgroundTerminalStatus(): void {
    const state = this.readState();
    const count = state.stream.backgroundTerminalActiveCount;
    const waiting = state.stream.backgroundTerminalWaiting;

    if (count <= 0) {
      setHidden(this.dom.backgroundTerminalRow, true);
      this.dom.backgroundTerminalText.textContent = "Idle";
      return;
    }

    setHidden(this.dom.backgroundTerminalRow, false);

    const processLabel = count === 1 ? "1 process" : `${count} processes`;
    const waitLabel = waiting ? "waiting for output" : "running";
    const commandLabel = state.stream.backgroundTerminalLatestCommand
      ? ` · ${truncateInlineText(state.stream.backgroundTerminalLatestCommand, 120)}`
      : "";
    this.dom.backgroundTerminalText.textContent = `${processLabel} ${waitLabel}${commandLabel}`;
  }

  private renderSettingsControls(): void {
    const state = this.readState();

    this.dom.settingsShowStatusEventsInput.checked = state.stream.showStatusEvents;
    this.dom.settingsShowInternalEventsInput.checked = state.stream.showInternalEvents;
    this.dom.settingsCompactStatusBurstsInput.checked = state.stream.compactStatusBursts;
  }

  private selectedThreadTranscript(state: Readonly<AppState>): ThreadTranscriptState | null {
    const selectedThreadId = state.thread.selectedThreadId;
    if (!selectedThreadId) {
      return null;
    }

    return state.thread.transcriptsByThreadId[selectedThreadId] ?? null;
  }

  private transcriptLoadingMessage(transcript: ThreadTranscriptState | null): string {
    if (!transcript) {
      return "Select a thread to load history.";
    }

    if (transcript.hydration === "loading") {
      return "Loading thread history...";
    }

    if (transcript.hydration === "error") {
      return "History load failed. Re-select the thread or retry refresh.";
    }

    if (transcript.items.length === 0) {
      return "No messages yet. Send a prompt to begin.";
    }

    return "";
  }

  private transcriptItemKey(item: TranscriptItem, threadId: string): string {
    return `${threadId}::${item.runtimeItemId ?? item.id}`;
  }

  private transcriptTextKey(item: TranscriptItem, threadId: string): string {
    return `${this.transcriptItemKey(item, threadId)}::text`;
  }

  private transcriptDetailKey(item: TranscriptItem, threadId: string, detailKey: string): string {
    return `${this.transcriptItemKey(item, threadId)}::${detailKey}`;
  }

  private createTranscriptItem(item: TranscriptItem, threadId: string): HTMLLIElement {
    const lineItem = document.createElement("li");
    lineItem.className = `transcript-item transcript-${item.kind}`;

    if (item.kind === "message") {
      lineItem.classList.add(item.role === "user" ? "transcript-role-user" : "transcript-role-assistant");

      const message = document.createElement("p");
      message.className = "transcript-message";
      const messageText = item.text.length > 0 ? item.text : item.streaming ? "..." : "[empty message]";
      message.textContent = messageText;
      lineItem.append(message);

      if (shouldCollapseTranscriptText(messageText)) {
        const textKey = this.transcriptTextKey(item, threadId);
        attachTranscriptCollapseToggle(lineItem, message, {
          expandLabel: "Expand message",
          collapseLabel: "Collapse message",
          initialExpanded: this.transcriptExpandedTextKeys.has(textKey),
          onExpandedChange: (expanded) => {
            if (expanded) {
              this.transcriptExpandedTextKeys.add(textKey);
            } else {
              this.transcriptExpandedTextKeys.delete(textKey);
            }
          }
        });
      }

      if (item.streaming) {
        const streaming = document.createElement("span");
        streaming.className = "transcript-streaming";
        streaming.textContent = "Streaming";
        lineItem.append(streaming);
      }

      return lineItem;
    }

    if (item.kind === "reasoning") {
      const heading = document.createElement("h3");
      heading.className = "transcript-heading";
      heading.textContent = "Reasoning";

      const summary = document.createElement("p");
      summary.className = "transcript-message transcript-reasoning-summary";
      const summaryText = item.summary.length > 0 ? item.summary : "Working...";
      summary.textContent = summaryText;

      lineItem.append(heading, summary);

      if (shouldCollapseTranscriptText(summaryText)) {
        const textKey = this.transcriptTextKey(item, threadId);
        attachTranscriptCollapseToggle(lineItem, summary, {
          expandLabel: "Expand reasoning",
          collapseLabel: "Collapse reasoning",
          initialExpanded: this.transcriptExpandedTextKeys.has(textKey),
          onExpandedChange: (expanded) => {
            if (expanded) {
              this.transcriptExpandedTextKeys.add(textKey);
            } else {
              this.transcriptExpandedTextKeys.delete(textKey);
            }
          }
        });
      }

      if (item.content.length > 0) {
        const details = document.createElement("details");
        details.className = "transcript-details";
        const detailKey = this.transcriptDetailKey(item, threadId, "reasoning-details");
        details.open = this.transcriptOpenDetailKeys.has(detailKey);

        const detailSummary = document.createElement("summary");
        detailSummary.textContent = "Reasoning details";

        const content = document.createElement("pre");
        content.className = "transcript-code transcript-details-content";
        content.textContent = item.content;

        details.addEventListener("toggle", () => {
          if (details.open) {
            this.transcriptOpenDetailKeys.add(detailKey);
          } else {
            this.transcriptOpenDetailKeys.delete(detailKey);
          }
        });

        details.append(detailSummary, content);
        lineItem.append(details);
      }

      if (item.streaming) {
        const streaming = document.createElement("span");
        streaming.className = "transcript-streaming";
        streaming.textContent = "Streaming";
        lineItem.append(streaming);
      }

      return lineItem;
    }

    const heading = document.createElement("h3");
    heading.className = "transcript-heading";
    heading.textContent = item.title;

    lineItem.append(heading);

    if (item.detail) {
      const detail = document.createElement("p");
      detail.className = "transcript-message transcript-tool-detail";
      detail.textContent = item.detail;
      lineItem.append(detail);
    }

    if (item.output) {
      const details = document.createElement("details");
      details.className = "transcript-details";
      const detailKey = this.transcriptDetailKey(item, threadId, "tool-output");
      details.open = this.transcriptOpenDetailKeys.has(detailKey);

      const detailSummary = document.createElement("summary");
      detailSummary.textContent = "Tool output";

      const output = document.createElement("pre");
      output.className = "transcript-code transcript-details-content";
      output.textContent = item.output;

      details.addEventListener("toggle", () => {
        if (details.open) {
          this.transcriptOpenDetailKeys.add(detailKey);
        } else {
          this.transcriptOpenDetailKeys.delete(detailKey);
        }
      });

      details.append(detailSummary, output);
      lineItem.append(details);
    }

    if (item.streaming) {
      const streaming = document.createElement("span");
      streaming.className = "transcript-streaming";
      streaming.textContent = "Streaming";
      lineItem.append(streaming);
    }

    return lineItem;
  }

  private renderTranscript(): void {
    const state = this.readState();
    const selectedThreadId = state.thread.selectedThreadId;
    const transcript = this.selectedThreadTranscript(state);
    const placeholderMessage = this.transcriptLoadingMessage(transcript);

    if (
      this.lastRenderedTranscriptThreadId === selectedThreadId &&
      this.lastRenderedTranscriptRef === transcript &&
      this.lastRenderedTranscriptPlaceholder === placeholderMessage
    ) {
      return;
    }

    if (placeholderMessage) {
      this.dom.transcriptList.replaceChildren(renderEmptyMessage(placeholderMessage));
      this.followTranscript = true;
      this.updateTranscriptJumpVisibility(0);
      this.lastRenderedTranscriptThreadId = selectedThreadId;
      this.lastRenderedTranscriptRef = transcript;
      this.lastRenderedTranscriptPlaceholder = placeholderMessage;
      return;
    }

    if (!transcript) {
      this.dom.transcriptList.replaceChildren(renderEmptyMessage("Select a thread to load history."));
      this.followTranscript = true;
      this.updateTranscriptJumpVisibility(0);
      this.lastRenderedTranscriptThreadId = selectedThreadId;
      this.lastRenderedTranscriptRef = transcript;
      this.lastRenderedTranscriptPlaceholder = "Select a thread to load history.";
      return;
    }

    if (!selectedThreadId) {
      this.dom.transcriptList.replaceChildren(renderEmptyMessage("Select a thread to load history."));
      this.followTranscript = true;
      this.updateTranscriptJumpVisibility(0);
      this.lastRenderedTranscriptThreadId = selectedThreadId;
      this.lastRenderedTranscriptRef = transcript;
      this.lastRenderedTranscriptPlaceholder = "Select a thread to load history.";
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of transcript.items) {
      fragment.append(this.createTranscriptItem(item, selectedThreadId));
    }
    this.dom.transcriptList.replaceChildren(fragment);

    if (this.followTranscript) {
      this.scrollTranscriptToLatest();
    }

    this.updateTranscriptJumpVisibility(transcript.items.length);
    this.lastRenderedTranscriptThreadId = selectedThreadId;
    this.lastRenderedTranscriptRef = transcript;
    this.lastRenderedTranscriptPlaceholder = "";
  }

  private isNearTranscriptBottom(): boolean {
    const { scrollHeight, scrollTop, clientHeight } = this.dom.transcriptStream;
    return scrollHeight - (scrollTop + clientHeight) <= TRANSCRIPT_BOTTOM_THRESHOLD_PX;
  }

  private handleTranscriptScroll(): void {
    this.followTranscript = this.isNearTranscriptBottom();
    this.updateTranscriptJumpVisibility(this.selectedThreadTranscript(this.readState())?.items.length ?? 0);
  }

  private updateTranscriptJumpVisibility(itemCount: number): void {
    setHidden(this.dom.transcriptJumpLatestButton, itemCount === 0 || this.followTranscript);
  }

  private scrollTranscriptToLatest(): void {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        this.dom.transcriptStream.scrollTop = this.dom.transcriptStream.scrollHeight;
      });
      return;
    }

    this.dom.transcriptStream.scrollTop = this.dom.transcriptStream.scrollHeight;
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
    const shouldSkipRender =
      this.lastRenderedEventsRef === state.stream.events &&
      this.lastRenderedShowInternalEvents === state.stream.showInternalEvents &&
      this.lastRenderedShowStatusEvents === state.stream.showStatusEvents &&
      this.lastRenderedCompactStatusBursts === state.stream.compactStatusBursts;

    if (shouldSkipRender) {
      return;
    }

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
      this.lastRenderedEventsRef = state.stream.events;
      this.lastRenderedShowInternalEvents = state.stream.showInternalEvents;
      this.lastRenderedShowStatusEvents = state.stream.showStatusEvents;
      this.lastRenderedCompactStatusBursts = state.stream.compactStatusBursts;
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
    this.lastRenderedEventsRef = state.stream.events;
    this.lastRenderedShowInternalEvents = state.stream.showInternalEvents;
    this.lastRenderedShowStatusEvents = state.stream.showStatusEvents;
    this.lastRenderedCompactStatusBursts = state.stream.compactStatusBursts;
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

    return streamState.compactStatusBursts ? this.compactStatusBursts(statusFilteredEvents) : statusFilteredEvents;
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
      visibleEvents: streamState.compactStatusBursts ? this.compactStatusBursts(statusFilteredEvents) : statusFilteredEvents,
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
