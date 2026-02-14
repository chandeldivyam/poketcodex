import type { WorkspaceRecord } from "../lib/api-client.js";
import type { ThreadListItem } from "../lib/normalize.js";
import type { AppState } from "./app-state.js";

export function selectWorkspaceActionsDisabled(state: AppState): boolean {
  return !state.session.authenticated || state.session.busy;
}

export function selectThreadActionsDisabled(state: AppState): boolean {
  return !state.session.authenticated || state.session.busy || !state.workspace.selectedWorkspaceId;
}

export function selectActiveWorkspace(state: AppState): WorkspaceRecord | null {
  const selectedWorkspaceId = state.workspace.selectedWorkspaceId;
  if (!selectedWorkspaceId) {
    return null;
  }

  return state.workspace.workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId) ?? null;
}

export function selectSelectedThread(state: AppState): ThreadListItem | null {
  const selectedThreadId = state.thread.selectedThreadId;
  if (!selectedThreadId) {
    return null;
  }

  const workspaceId = state.thread.threadWorkspaceByThreadId[selectedThreadId];
  if (workspaceId) {
    return state.thread.threadsByWorkspaceId[workspaceId]?.find((thread) => thread.threadId === selectedThreadId) ?? null;
  }

  for (const threadList of Object.values(state.thread.threadsByWorkspaceId)) {
    const selectedThread = threadList.find((thread) => thread.threadId === selectedThreadId);
    if (selectedThread) {
      return selectedThread;
    }
  }

  return null;
}

export function selectSelectedThreadLabel(state: AppState): string {
  const selectedThread = selectSelectedThread(state);
  if (selectedThread) {
    return selectedThread.title;
  }

  return state.thread.selectedThreadId ?? "None";
}
