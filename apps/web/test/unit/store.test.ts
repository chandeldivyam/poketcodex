import { describe, expect, it } from "vitest";

import type { AppState } from "../../src/state/app-state.js";
import { AppStore } from "../../src/state/store.js";

function createInitialState(): AppState {
  return {
    session: {
      authenticated: false,
      csrfToken: null,
      busy: false,
      error: null
    },
    workspace: {
      workspaces: [],
      selectedWorkspaceId: null
    },
    thread: {
      threads: [],
      selectedThreadId: null
    },
    stream: {
      socketState: "disconnected",
      draftPrompt: "",
      events: [],
      showInternalEvents: false
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
        threads: [],
        selectedThreadId: null
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
