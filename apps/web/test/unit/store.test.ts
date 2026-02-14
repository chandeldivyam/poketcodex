import { describe, expect, it } from "vitest";

import type { AppState } from "../../src/state/app-state.js";
import { AppStore } from "../../src/state/store.js";

function createInitialState(): AppState {
  return {
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
      threadsByWorkspaceId: {},
      threadHydrationByWorkspaceId: {},
      threadCacheLoadedAtByWorkspaceId: {},
      expandedWorkspaceIds: [],
      threadWorkspaceByThreadId: {},
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
      showInternalEvents: false,
      showStatusEvents: false,
      compactStatusBursts: true,
      turnPhase: "idle",
      turnStartedAtMs: null,
      backgroundTerminalActiveCount: 0,
      backgroundTerminalLatestCommand: null,
      backgroundTerminalWaiting: false
    },
    gitReview: {
      active: false,
      loading: false,
      filesCollapsed: false,
      supported: null,
      branch: null,
      ahead: 0,
      behind: 0,
      clean: true,
      entries: [],
      selectedPath: null,
      diff: "",
      diffLoading: false,
      error: null,
      workspaceId: null
    }
  };
}

describe("AppStore", () => {
  it("emits changed slice keys when state is updated", () => {
    const store = new AppStore(createInitialState());
    const changedHistory: string[] = [];

    store.subscribe((_state, changedSlices) => {
      changedHistory.push([...changedSlices].join(","));
    });

    store.patchSlice("session", {
      busy: true
    });

    store.setState({
      workspace: {
        workspaces: [],
        selectedWorkspaceId: "workspace-1"
      },
      thread: {
        threadsByWorkspaceId: {},
        threadHydrationByWorkspaceId: {},
        threadCacheLoadedAtByWorkspaceId: {},
        expandedWorkspaceIds: [],
        threadWorkspaceByThreadId: {},
        selectedThreadId: null,
        transcriptsByThreadId: {},
        runningByThreadId: {},
        unreadByThreadId: {}
      }
    });

    expect(changedHistory).toEqual(["session", "workspace,thread"]);
    expect(store.getState().session.busy).toBe(true);
    expect(store.getState().workspace.selectedWorkspaceId).toBe("workspace-1");
  });

  it("does not emit when patchSlice receives identical values", () => {
    const store = new AppStore(createInitialState());
    let emitCount = 0;

    store.subscribe(() => {
      emitCount += 1;
    });

    store.patchSlice("stream", {
      draftPrompt: ""
    });

    expect(emitCount).toBe(0);
  });

  it("supports immutable slice updates", () => {
    const store = new AppStore(createInitialState());
    const before = store.getState().stream;

    store.updateSlice("stream", (stream) => ({
      ...stream,
      events: [
        {
          id: "event-1",
          timestamp: "10:00:00 AM",
          message: "event-1",
          kind: "system",
          category: "system",
          isInternal: false
        }
      ]
    }));

    expect(store.getState().stream.events).toEqual([
      {
        id: "event-1",
        timestamp: "10:00:00 AM",
        message: "event-1",
        kind: "system",
        category: "system",
        isInternal: false
      }
    ]);
    expect(store.getState().stream).not.toBe(before);
  });
});
