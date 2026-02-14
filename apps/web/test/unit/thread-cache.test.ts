import { describe, expect, it } from "vitest";

import type { ThreadListItem } from "../../src/lib/normalize.js";
import {
  resolveThreadSelectionForWorkspace,
  setWorkspaceExpansionState,
  shouldRefreshThreadCache
} from "../../src/state/thread-cache.js";

describe("thread-cache helpers", () => {
  it("toggles workspace expansion state", () => {
    const expanded = setWorkspaceExpansionState([], "workspace-a", true);
    expect(expanded).toEqual(["workspace-a"]);

    const collapsed = setWorkspaceExpansionState(expanded, "workspace-a", false);
    expect(collapsed).toEqual([]);
  });

  it("marks idle or missing cache as refresh-needed for lazy fill", () => {
    const missingCache = shouldRefreshThreadCache({
      hydration: undefined,
      loadedAtMs: undefined,
      nowMs: 1_739_145_600_000,
      maxAgeMs: 120_000
    });

    const idleCache = shouldRefreshThreadCache({
      hydration: "idle",
      loadedAtMs: undefined,
      nowMs: 1_739_145_600_000,
      maxAgeMs: 120_000
    });

    expect(missingCache).toBe(true);
    expect(idleCache).toBe(true);
  });

  it("refreshes stale cache and keeps fresh cache", () => {
    const stale = shouldRefreshThreadCache({
      hydration: "loaded",
      loadedAtMs: 1_739_145_000_000,
      nowMs: 1_739_145_600_000,
      maxAgeMs: 120_000
    });

    const fresh = shouldRefreshThreadCache({
      hydration: "loaded",
      loadedAtMs: 1_739_145_560_000,
      nowMs: 1_739_145_600_000,
      maxAgeMs: 120_000
    });

    expect(stale).toBe(true);
    expect(fresh).toBe(false);
  });

  it("resolves selected thread by workspace mapping for cross-workspace selection", () => {
    const workspaceAThreads: ThreadListItem[] = [
      {
        threadId: "thread-a1",
        title: "Thread A1",
        archived: false,
        lastSeenAt: "2026-02-10T00:00:00.000Z"
      },
      {
        threadId: "thread-a2",
        title: "Thread A2",
        archived: false,
        lastSeenAt: "2026-02-10T00:00:00.000Z"
      }
    ];

    const selected = resolveThreadSelectionForWorkspace({
      workspaceId: "workspace-a",
      threads: workspaceAThreads,
      selectedThreadId: "thread-b9",
      storedThreadId: "thread-a2",
      threadWorkspaceByThreadId: {
        "thread-b9": "workspace-b"
      }
    });

    expect(selected).toBe("thread-a2");
  });
});
