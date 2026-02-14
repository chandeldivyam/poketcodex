import type { ThreadListItem } from "../lib/normalize.js";
import type { ThreadListHydration } from "./app-state.js";

export function setWorkspaceExpansionState(
  expandedWorkspaceIds: readonly string[],
  workspaceId: string,
  expanded: boolean
): string[] {
  const isExpanded = expandedWorkspaceIds.includes(workspaceId);
  if (isExpanded === expanded) {
    return [...expandedWorkspaceIds];
  }

  if (expanded) {
    return [...expandedWorkspaceIds, workspaceId];
  }

  return expandedWorkspaceIds.filter((entry) => entry !== workspaceId);
}

export function shouldRefreshThreadCache(options: {
  hydration: ThreadListHydration | undefined;
  loadedAtMs: number | undefined;
  nowMs: number;
  maxAgeMs: number;
}): boolean {
  if (options.hydration !== "loaded" || options.loadedAtMs === undefined) {
    return true;
  }

  return options.nowMs - options.loadedAtMs >= options.maxAgeMs;
}

export function resolveThreadSelectionForWorkspace(options: {
  workspaceId: string;
  threads: readonly ThreadListItem[];
  selectedThreadId: string | null;
  storedThreadId: string | null;
  threadWorkspaceByThreadId: Readonly<Record<string, string>>;
}): string | null {
  const selectedThreadId = options.selectedThreadId;
  if (
    selectedThreadId &&
    options.threadWorkspaceByThreadId[selectedThreadId] === options.workspaceId &&
    options.threads.some((thread) => thread.threadId === selectedThreadId)
  ) {
    return selectedThreadId;
  }

  if (options.storedThreadId && options.threads.some((thread) => thread.threadId === options.storedThreadId)) {
    return options.storedThreadId;
  }

  return options.threads[0]?.threadId ?? null;
}
