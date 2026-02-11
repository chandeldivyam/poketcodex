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
  DraftImageAttachment,
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
const STORAGE_COMPACT_STATUS_BURSTS_KEY = "poketcodex.compactStatusBursts";
const MAX_STORED_EVENTS = 240;
const RUNTIME_EVENT_BATCH_MS = 48;
const MAX_TRANSCRIPT_ITEMS = 320;
const MAX_DRAFT_IMAGES = 3;
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_DRAFT_IMAGE_BYTES = 1_500_000;
const MAX_TOTAL_DRAFT_IMAGE_BYTES = 5_000_000;
const DRAFT_IMAGE_MAX_DIMENSION_PX = 1_560;
const DRAFT_IMAGE_JPEG_INITIAL_QUALITY = 0.84;
const DRAFT_IMAGE_JPEG_MIN_QUALITY = 0.55;
const TURN_START_TIMEOUT_MS = 60_000;
const MAX_TURN_REQUEST_BODY_BYTES = 7_500_000;

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

function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes} B`;
  }

  if (bytes < 1_048_576) {
    return `${Math.round((bytes / 1_024) * 10) / 10} KB`;
  }

  return `${Math.round((bytes / 1_048_576) * 10) / 10} MB`;
}

function cloneDraftImages(images: DraftImageAttachment[]): DraftImageAttachment[] {
  return images.map((image) => ({ ...image }));
}

function totalDraftImageBytes(images: DraftImageAttachment[]): number {
  return images.reduce((sum, image) => sum + image.sizeBytes, 0);
}

function createDraftImageId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function validateSourceImageFile(file: File): void {
  if (!file.type.startsWith("image/")) {
    throw new Error(`"${file.name}" is not an image file.`);
  }

  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(
      `"${file.name}" exceeds ${formatBytes(MAX_SOURCE_IMAGE_BYTES)}. Choose a smaller image.`
    );
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error(`Failed to read "${file.name}" as data URL.`));
    };
    reader.onerror = () => {
      reject(new Error(`Failed to read "${file.name}".`));
    };
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error("Image decode failed."));
    };
    image.src = dataUrl;
  });
}

function fitWithinBounds(width: number, height: number, maxDimension: number): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }

  if (width >= height) {
    const scale = maxDimension / width;
    return {
      width: maxDimension,
      height: Math.max(1, Math.round(height * scale))
    };
  }

  const scale = maxDimension / height;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: maxDimension
  };
}

async function compressDraftImage(file: File): Promise<{
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
}> {
  const rawDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(rawDataUrl);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Image processing is unavailable in this browser.");
  }

  const fitted = fitWithinBounds(image.naturalWidth, image.naturalHeight, DRAFT_IMAGE_MAX_DIMENSION_PX);
  let targetWidth = fitted.width;
  let targetHeight = fitted.height;
  let mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  let quality = DRAFT_IMAGE_JPEG_INITIAL_QUALITY;
  let attempts = 0;
  let outputDataUrl = rawDataUrl;

  while (attempts < 8) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    outputDataUrl = canvas.toDataURL(mimeType, mimeType === "image/jpeg" ? quality : undefined);

    if (outputDataUrl.length <= MAX_DRAFT_IMAGE_BYTES) {
      break;
    }

    if (mimeType === "image/png") {
      mimeType = "image/jpeg";
      quality = DRAFT_IMAGE_JPEG_INITIAL_QUALITY;
      attempts += 1;
      continue;
    }

    if (quality > DRAFT_IMAGE_JPEG_MIN_QUALITY + 0.04) {
      quality -= 0.08;
      attempts += 1;
      continue;
    }

    targetWidth = Math.max(320, Math.round(targetWidth * 0.84));
    targetHeight = Math.max(320, Math.round(targetHeight * 0.84));
    quality = DRAFT_IMAGE_JPEG_INITIAL_QUALITY;
    attempts += 1;
  }

  if (outputDataUrl.length > MAX_DRAFT_IMAGE_BYTES) {
    throw new Error(
      `"${file.name}" is still too large after compression. Try a smaller image or crop it first.`
    );
  }

  return {
    dataUrl: outputDataUrl,
    mimeType,
    width: targetWidth,
    height: targetHeight
  };
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

function commandDisplayFromParams(params: Record<string, unknown>): string | null {
  const command = params.command;
  if (Array.isArray(command)) {
    const parts = command.filter((part): part is string => typeof part === "string");
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  if (typeof command === "string" && command.length > 0) {
    return command;
  }

  return null;
}

function backgroundProcessKeyFromParams(params: Record<string, unknown>): string | null {
  return (
    asNonEmptyString(params.processId) ??
    asNonEmptyString(params.process_id) ??
    asNonEmptyString(params.callId) ??
    asNonEmptyString(params.call_id)
  );
}

function isUnifiedExecSource(params: Record<string, unknown>): boolean {
  const source = asNonEmptyString(params.source)?.toLowerCase();
  if (!source) {
    return false;
  }

  return source.includes("unified");
}

function methodMatchesAny(method: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => method.includes(token));
}

function updateBackgroundTerminalState(): void {
  const activeCount = activeBackgroundTerminalProcesses.size;
  const latestCommand =
    activeCount > 0 ? [...activeBackgroundTerminalProcesses.values()][activeCount - 1] ?? null : null;

  store.updateSlice("stream", (stream) => {
    const waiting = activeCount > 0 && stream.backgroundTerminalWaiting;

    if (
      stream.backgroundTerminalActiveCount === activeCount &&
      stream.backgroundTerminalLatestCommand === latestCommand &&
      stream.backgroundTerminalWaiting === waiting
    ) {
      return stream;
    }

    return {
      ...stream,
      backgroundTerminalActiveCount: activeCount,
      backgroundTerminalLatestCommand: latestCommand,
      backgroundTerminalWaiting: waiting
    };
  });
}

function clearBackgroundTerminalState(): void {
  activeBackgroundTerminalProcesses.clear();
  store.updateSlice("stream", (stream) => {
    if (
      stream.backgroundTerminalActiveCount === 0 &&
      stream.backgroundTerminalLatestCommand === null &&
      stream.backgroundTerminalWaiting === false
    ) {
      return stream;
    }

    return {
      ...stream,
      backgroundTerminalActiveCount: 0,
      backgroundTerminalLatestCommand: null,
      backgroundTerminalWaiting: false
    };
  });
}

function applyBackgroundTerminalSignal(method: string, params: Record<string, unknown>): void {
  const normalizedMethod = method.toLowerCase();
  const processKey = backgroundProcessKeyFromParams(params);

  const isExecBegin = methodMatchesAny(normalizedMethod, [
    "exec_command_begin",
    "exec_command/begin",
    "tool_call_begin",
    "tool_call/begin"
  ]);
  const isExecEnd = methodMatchesAny(normalizedMethod, [
    "exec_command_end",
    "exec_command/end",
    "tool_call_end",
    "tool_call/end"
  ]);
  const isTerminalInteraction = methodMatchesAny(normalizedMethod, [
    "terminal_interaction",
    "terminal/interaction",
    "write_stdin",
    "write-stdin",
    "terminal/write_stdin"
  ]);

  if (isExecBegin) {
    if (!processKey || !isUnifiedExecSource(params)) {
      return;
    }

    activeBackgroundTerminalProcesses.set(processKey, commandDisplayFromParams(params) ?? processKey);
    store.updateSlice("stream", (stream) => {
      return {
        ...stream,
        backgroundTerminalWaiting: false
      };
    });
    updateBackgroundTerminalState();
    return;
  }

  if (isExecEnd) {
    if (!processKey) {
      return;
    }

    activeBackgroundTerminalProcesses.delete(processKey);
    updateBackgroundTerminalState();
    return;
  }

  if (isTerminalInteraction) {
    if (!processKey || !activeBackgroundTerminalProcesses.has(processKey)) {
      return;
    }

    const stdinChars = asNonEmptyString(params.stdin) ?? asNonEmptyString(params.chars);
    const isPollingWait = stdinChars === null;
    const latestCommand = commandDisplayFromParams(params);
    if (latestCommand) {
      activeBackgroundTerminalProcesses.set(processKey, latestCommand);
    }

    store.updateSlice("stream", (stream) => {
      const waiting = activeBackgroundTerminalProcesses.size > 0 && isPollingWait;
      return {
        ...stream,
        backgroundTerminalWaiting: waiting
      };
    });
    updateBackgroundTerminalState();
  }
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
    draftImages: [],
    imageAttachmentBusy: false,
    events: [],
    showInternalEvents: readStorageBoolean(STORAGE_SHOW_INTERNAL_EVENTS_KEY, false),
    showStatusEvents: readStorageBoolean(STORAGE_SHOW_STATUS_EVENTS_KEY, false),
    compactStatusBursts: readStorageBoolean(STORAGE_COMPACT_STATUS_BURSTS_KEY, true),
    turnPhase: "idle",
    turnStartedAtMs: null,
    backgroundTerminalActiveCount: 0,
    backgroundTerminalLatestCommand: null,
    backgroundTerminalWaiting: false
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
interface DraftComposerCacheEntry {
  prompt: string;
  images: DraftImageAttachment[];
}
const draftCacheByContext = new Map<string, DraftComposerCacheEntry>();
const activeBackgroundTerminalProcesses = new Map<string, string>();
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

function updateDraftCacheForContext(
  contextKey: string | null,
  draftPrompt: string,
  draftImages: DraftImageAttachment[]
): void {
  if (!contextKey) {
    return;
  }

  if (draftPrompt.trim().length === 0 && draftImages.length === 0) {
    draftCacheByContext.delete(contextKey);
    return;
  }

  draftCacheByContext.set(contextKey, {
    prompt: draftPrompt,
    images: cloneDraftImages(draftImages)
  });
}

function getCurrentDraftContextKey(): string | null {
  const state = store.getState();
  return buildDraftContextKey(state.workspace.selectedWorkspaceId, state.thread.selectedThreadId);
}

function persistCurrentDraftPrompt(): void {
  const stream = store.getState().stream;
  updateDraftCacheForContext(getCurrentDraftContextKey(), stream.draftPrompt, stream.draftImages);
}

function setDraftPrompt(draftPrompt: string): void {
  store.patchSlice("stream", {
    draftPrompt
  });
}

function setDraftImages(draftImages: DraftImageAttachment[]): void {
  store.patchSlice("stream", {
    draftImages
  });
}

function setImageAttachmentBusy(imageAttachmentBusy: boolean): void {
  store.patchSlice("stream", {
    imageAttachmentBusy
  });
}

function restoreDraftPrompt(workspaceId: string | null, threadId: string | null): void {
  const contextKey = buildDraftContextKey(workspaceId, threadId);
  const cached = contextKey ? draftCacheByContext.get(contextKey) ?? null : null;
  setDraftPrompt(cached?.prompt ?? "");
  setDraftImages(cached ? cloneDraftImages(cached.images) : []);
  setImageAttachmentBusy(false);
}

async function handleDraftImageSelection(
  files: FileList | null,
  source: DraftImageAttachment["source"]
): Promise<void> {
  if (!files || files.length === 0) {
    return;
  }

  const currentState = store.getState();
  const contextKeyAtStart = getCurrentDraftContextKey();
  const draftPromptAtStart = currentState.stream.draftPrompt;
  if (currentState.stream.imageAttachmentBusy) {
    return;
  }

  const remainingSlots = MAX_DRAFT_IMAGES - currentState.stream.draftImages.length;
  if (remainingSlots <= 0) {
    setError(`Up to ${MAX_DRAFT_IMAGES} images are allowed per message.`);
    return;
  }

  const imageFiles = [...files].filter((file) => file.type.startsWith("image/")).slice(0, remainingSlots);
  if (imageFiles.length === 0) {
    setError("No image files were selected.");
    return;
  }

  clearError();
  setImageAttachmentBusy(true);

  try {
    let nextImages = cloneDraftImages(currentState.stream.draftImages);

    for (const file of imageFiles) {
      validateSourceImageFile(file);
      const compressed = await compressDraftImage(file);
      const attachment: DraftImageAttachment = {
        id: createDraftImageId(),
        name: file.name && file.name.trim().length > 0 ? file.name : `image-${nextImages.length + 1}.jpg`,
        mimeType: compressed.mimeType,
        dataUrl: compressed.dataUrl,
        sizeBytes: compressed.dataUrl.length,
        width: compressed.width,
        height: compressed.height,
        source
      };

      const combinedSize = totalDraftImageBytes(nextImages) + attachment.sizeBytes;
      if (combinedSize > MAX_TOTAL_DRAFT_IMAGE_BYTES) {
        throw new Error(
          `Image payload exceeds ${formatBytes(MAX_TOTAL_DRAFT_IMAGE_BYTES)}. Remove an attachment and retry.`
        );
      }

      nextImages = [...nextImages, attachment];
    }

    if (contextKeyAtStart !== getCurrentDraftContextKey()) {
      updateDraftCacheForContext(contextKeyAtStart, draftPromptAtStart, nextImages);
      appendEvent("Image attached to previous draft context.", "system", {
        category: "status"
      });
      return;
    }

    setDraftImages(nextImages);
    updateDraftCacheForContext(getCurrentDraftContextKey(), store.getState().stream.draftPrompt, nextImages);

    if (files.length > imageFiles.length) {
      appendEvent(`Only ${MAX_DRAFT_IMAGES} images are allowed per turn.`, "system", {
        category: "status"
      });
    }
  } catch (error: unknown) {
    setError(`Image attach failed: ${describeError(error)}`);
  } finally {
    setImageAttachmentBusy(false);
  }
}

function removeDraftImage(imageId: string): void {
  const nextImages = store.getState().stream.draftImages.filter((image) => image.id !== imageId);
  setDraftImages(nextImages);
  updateDraftCacheForContext(getCurrentDraftContextKey(), store.getState().stream.draftPrompt, nextImages);
}

function buildTurnInput(prompt: string, draftImages: DraftImageAttachment[]): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];

  if (prompt.trim().length > 0) {
    input.push({
      type: "text",
      text: prompt
    });
  }

  for (const image of draftImages) {
    input.push({
      type: "image",
      url: image.dataUrl,
      image_url: image.dataUrl
    });
  }

  return input;
}

function estimateJsonSizeBytes(payload: unknown): number {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  return encoded.length;
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

function setCompactStatusBursts(compactStatusBursts: boolean): void {
  writeStorageBoolean(STORAGE_COMPACT_STATUS_BURSTS_KEY, compactStatusBursts);
  store.patchSlice("stream", {
    compactStatusBursts
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

  applyBackgroundTerminalSignal(notification.method, notification.params);

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
  clearBackgroundTerminalState();

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
    draftImages: [],
    imageAttachmentBusy: false,
    events: [],
    turnPhase: "idle",
    turnStartedAtMs: null
  });
  draftCacheByContext.clear();
  clearRuntimeEventQueue();
  clearBackgroundTerminalState();
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
      draftImages: [],
      imageAttachmentBusy: false,
      events: [],
      showInternalEvents: readStorageBoolean(STORAGE_SHOW_INTERNAL_EVENTS_KEY, false),
      showStatusEvents: readStorageBoolean(STORAGE_SHOW_STATUS_EVENTS_KEY, false),
      compactStatusBursts: readStorageBoolean(STORAGE_COMPACT_STATUS_BURSTS_KEY, true),
      turnPhase: "idle",
      turnStartedAtMs: null,
      backgroundTerminalActiveCount: 0,
      backgroundTerminalLatestCommand: null,
      backgroundTerminalWaiting: false
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
  const normalizedPrompt = typeof prompt === "string" ? prompt.trim() : "";
  const streamState = store.getState().stream;

  if (streamState.imageAttachmentBusy) {
    setError("Image processing is still in progress. Wait a moment and retry.");
    return;
  }

  if (normalizedPrompt.length === 0 && streamState.draftImages.length === 0) {
    setError("Prompt or at least one image is required.");
    return;
  }

  const existingTurnPhase = streamState.turnPhase;
  if (existingTurnPhase === "submitting" || existingTurnPhase === "interrupting") {
    setError("A turn request is already in progress. Wait for completion and retry.");
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
  if (normalizedPrompt.length > 0) {
    appendEvent(`Prompt: ${normalizedPrompt}`, "user");
  } else {
    appendEvent("Prompt: [image-only]", "user");
  }
  if (streamState.draftImages.length > 0) {
    appendEvent(
      `Attached ${streamState.draftImages.length} image${streamState.draftImages.length === 1 ? "" : "s"}`,
      "system",
      {
        category: "input"
      }
    );
  }

  let submittedThreadId: string | null = null;

  try {
    const csrfToken = requireCsrfToken();
    submittedThreadId = await ensureThreadForTurn(workspace.workspaceId, csrfToken);

    const turnInput = buildTurnInput(normalizedPrompt, store.getState().stream.draftImages);
    const payload: Record<string, unknown> = {
      threadId: submittedThreadId,
      input: turnInput
    };

    const estimatedPayloadSize = estimateJsonSizeBytes(payload);
    if (estimatedPayloadSize > MAX_TURN_REQUEST_BODY_BYTES) {
      throw new Error(
        `Image payload is too large (${formatBytes(estimatedPayloadSize)}). Remove an image or use a smaller photo.`
      );
    }

    const result = await apiClient.startTurn(workspace.workspaceId, csrfToken, payload, {
      timeoutMs: TURN_START_TIMEOUT_MS
    });
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
    dom.composerImageInput.value = "";

    updateDraftCacheForContext(getCurrentDraftContextKey(), "", []);
    store.patchSlice("stream", {
      draftPrompt: "",
      draftImages: []
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
  clearBackgroundTerminalState();
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
    updateDraftCacheForContext(getCurrentDraftContextKey(), draftPrompt, store.getState().stream.draftImages);
  });

  dom.composerAttachImageButton.addEventListener("click", () => {
    if (dom.composerImageInput.disabled) {
      return;
    }

    dom.composerImageInput.click();
  });

  dom.composerImageInput.addEventListener("change", () => {
    void handleDraftImageSelection(dom.composerImageInput.files, "upload");
    dom.composerImageInput.value = "";
  });

  dom.composerImageList.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button[data-action='remove-draft-image']");
    const imageId = button?.dataset.imageId;
    if (!imageId) {
      return;
    }

    removeDraftImage(imageId);
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

  dom.settingsShowStatusEventsInput.addEventListener("change", () => {
    setShowStatusEvents(dom.settingsShowStatusEventsInput.checked);
  });

  dom.settingsShowInternalEventsInput.addEventListener("change", () => {
    setShowInternalEvents(dom.settingsShowInternalEventsInput.checked);
  });

  dom.settingsCompactStatusBurstsInput.addEventListener("change", () => {
    setCompactStatusBursts(dom.settingsCompactStatusBurstsInput.checked);
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
