import { describe, expect, it } from "vitest";

import type { AppState } from "../../src/state/app-state.js";
import {
  selectActiveWorkspace,
  selectSelectedThread,
  selectSelectedThreadLabel,
  selectThreadActionsDisabled,
  selectWorkspaceActionsDisabled
} from "../../src/state/selectors.js";

function createState(): AppState {
  return {
    session: {
      authenticated: true,
      csrfToken: "token",
      busy: false,
      error: null,
      errorRetryLabel: null
    },
    workspace: {
      workspaces: [
        {
          workspaceId: "workspace-1",
          absolutePath: "/home/divyam/projects/ads-research",
          displayName: "ads-research",
          trusted: true,
          createdAt: "2026-02-10T00:00:00.000Z",
          updatedAt: "2026-02-10T00:00:00.000Z"
        }
      ],
      selectedWorkspaceId: "workspace-1"
    },
    thread: {
      threads: [
        {
          threadId: "thread-1",
          title: "Thread One",
          archived: false,
          lastSeenAt: "2026-02-10T00:00:00.000Z"
        }
      ],
      selectedThreadId: "thread-1",
      transcriptsByThreadId: {},
      runningByThreadId: {},
      unreadByThreadId: {}
    },
    stream: {
      socketState: "connected",
      draftPrompt: "",
      events: [],
      showInternalEvents: false,
      showStatusEvents: false,
      turnPhase: "idle",
      turnStartedAtMs: null
    }
  };
}

describe("state selectors", () => {
  it("returns active workspace and selected thread info", () => {
    const state = createState();

    expect(selectActiveWorkspace(state)?.displayName).toBe("ads-research");
    expect(selectSelectedThread(state)?.title).toBe("Thread One");
    expect(selectSelectedThreadLabel(state)).toBe("Thread One");
  });

  it("computes action disabled states", () => {
    const state = createState();
    expect(selectWorkspaceActionsDisabled(state)).toBe(false);
    expect(selectThreadActionsDisabled(state)).toBe(false);

    state.session.busy = true;
    expect(selectWorkspaceActionsDisabled(state)).toBe(true);
    expect(selectThreadActionsDisabled(state)).toBe(true);

    state.session.busy = false;
    state.workspace.selectedWorkspaceId = null;
    expect(selectThreadActionsDisabled(state)).toBe(true);
  });

  it("falls back to id or None when selected thread metadata is missing", () => {
    const state = createState();

    state.thread.threads = [];
    expect(selectSelectedThreadLabel(state)).toBe("thread-1");

    state.thread.selectedThreadId = null;
    expect(selectSelectedThreadLabel(state)).toBe("None");
  });
});
