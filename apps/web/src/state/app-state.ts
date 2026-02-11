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
  threads: ThreadListItem[];
  selectedThreadId: string | null;
  transcriptsByThreadId: Record<string, ThreadTranscriptState>;
  runningByThreadId: Record<string, boolean>;
  unreadByThreadId: Record<string, boolean>;
}

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

export interface StreamState {
  socketState: SocketConnectionState;
  draftPrompt: string;
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

export interface AppState {
  session: SessionState;
  workspace: WorkspaceState;
  thread: ThreadState;
  stream: StreamState;
}

export type AppStateKey = keyof AppState;
