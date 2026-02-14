import type { WorkspaceRecord } from "../lib/api-client.js";
import type { ThreadListItem } from "../lib/normalize.js";
import type { SocketConnectionState } from "../lib/ws-reconnect.js";

export interface SessionState {
  authenticated: boolean;
  csrfToken: string | null;
  busy: boolean;
  error: string | null;
  errorRetryLabel: string | null;
}

export interface WorkspaceState {
  workspaces: WorkspaceRecord[];
  selectedWorkspaceId: string | null;
}

export interface ThreadState {
  threadsByWorkspaceId: Record<string, ThreadListItem[]>;
  threadHydrationByWorkspaceId: Record<string, ThreadListHydration>;
  threadCacheLoadedAtByWorkspaceId: Record<string, number>;
  expandedWorkspaceIds: string[];
  threadWorkspaceByThreadId: Record<string, string>;
  selectedThreadId: string | null;
  transcriptsByThreadId: Record<string, ThreadTranscriptState>;
  runningByThreadId: Record<string, boolean>;
  unreadByThreadId: Record<string, boolean>;
}

export type ThreadListHydration = "idle" | "loading" | "loaded" | "error";

export interface TranscriptMessageItem {
  id: string;
  kind: "message";
  role: "user" | "assistant";
  text: string;
  turnId?: string;
  runtimeItemId?: string;
  streaming?: boolean;
}

export interface TranscriptReasoningItem {
  id: string;
  kind: "reasoning";
  summary: string;
  content: string;
  turnId?: string;
  runtimeItemId?: string;
  streaming?: boolean;
}

export interface TranscriptToolItem {
  id: string;
  kind: "tool";
  title: string;
  detail?: string;
  output?: string;
  turnId?: string;
  runtimeItemId?: string;
  streaming?: boolean;
}

export type TranscriptItem = TranscriptMessageItem | TranscriptReasoningItem | TranscriptToolItem;

export type ThreadTranscriptHydration = "idle" | "loading" | "loaded" | "error";

export interface ThreadTranscriptState {
  hydration: ThreadTranscriptHydration;
  items: TranscriptItem[];
  lastAppliedSequence: number;
}

export type TimelineEventKind = "user" | "runtime" | "socket" | "system" | "error";
export type TimelineEventCategory = "input" | "message" | "reasoning" | "tool" | "status" | "system" | "error";
export type TurnExecutionPhase = "idle" | "submitting" | "running" | "interrupting" | "error";

export interface TimelineEventEntry {
  id: string;
  timestamp: string;
  message: string;
  kind: TimelineEventKind;
  category: TimelineEventCategory;
  isInternal: boolean;
  source?: string;
  details?: string;
}

export interface DraftImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
  width: number;
  height: number;
  source: "upload" | "camera";
}

export interface StreamState {
  socketState: SocketConnectionState;
  draftPrompt: string;
  draftImages: DraftImageAttachment[];
  imageAttachmentBusy: boolean;
  events: TimelineEventEntry[];
  showInternalEvents: boolean;
  showStatusEvents: boolean;
  compactStatusBursts: boolean;
  turnPhase: TurnExecutionPhase;
  turnStartedAtMs: number | null;
  backgroundTerminalActiveCount: number;
  backgroundTerminalLatestCommand: string | null;
  backgroundTerminalWaiting: boolean;
}

export interface GitStatusEntry {
  path: string;
  staged: string;
  unstaged: string;
  statusLabel: string;
  originalPath?: string;
}

export interface GitReviewState {
  active: boolean;
  loading: boolean;
  filesCollapsed: boolean;
  supported: boolean | null;
  branch: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  entries: GitStatusEntry[];
  selectedPath: string | null;
  diff: string;
  diffLoading: boolean;
  error: string | null;
  workspaceId: string | null;
}

export interface AppState {
  session: SessionState;
  workspace: WorkspaceState;
  thread: ThreadState;
  stream: StreamState;
  gitReview: GitReviewState;
}

export type AppStateKey = keyof AppState;
