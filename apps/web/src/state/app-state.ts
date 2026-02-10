import type { WorkspaceRecord } from "../lib/api-client.js";
import type { ThreadListItem } from "../lib/normalize.js";
import type { SocketConnectionState } from "../lib/ws-reconnect.js";

export interface SessionState {
  authenticated: boolean;
  csrfToken: string | null;
  busy: boolean;
  error: string | null;
}

export interface WorkspaceState {
  workspaces: WorkspaceRecord[];
  selectedWorkspaceId: string | null;
}

export interface ThreadState {
  threads: ThreadListItem[];
  selectedThreadId: string | null;
}

export interface StreamState {
  socketState: SocketConnectionState;
  draftPrompt: string;
  events: string[];
}

export interface AppState {
  session: SessionState;
  workspace: WorkspaceState;
  thread: ThreadState;
  stream: StreamState;
}

export type AppStateKey = keyof AppState;
