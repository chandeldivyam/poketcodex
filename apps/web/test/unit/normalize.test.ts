import { describe, expect, it } from "vitest";

import type { ThreadListResponse } from "../../src/lib/api-client.js";
import {
  extractThreadIdFromTurnResult,
  formatWorkspaceEvent,
  normalizeThreadList
} from "../../src/lib/normalize.js";

describe("normalizeThreadList", () => {
  it("prefers metadata records when available", () => {
    const response: ThreadListResponse = {
      remote: {
        threads: [{ id: "remote-thread" }]
      },
      metadata: [
        {
          threadId: "meta-thread",
          workspaceId: "workspace-1",
          title: "Metadata Thread",
          archived: true,
          lastSeenAt: "2026-02-10T00:00:00.000Z",
          rawPayload: { id: "meta-thread" }
        }
      ]
    };

    expect(normalizeThreadList(response)).toEqual([
      {
        threadId: "meta-thread",
        title: "Metadata Thread",
        archived: true
      }
    ]);
  });

  it("falls back to remote payload when metadata is empty", () => {
    const response: ThreadListResponse = {
      remote: {
        threads: [
          {
            id: "thread-a",
            title: "Thread A",
            archived: false
          },
          {
            threadId: "thread-b",
            preview: "Preview B",
            archived: true
          },
          {
            malformed: true
          }
        ]
      },
      metadata: []
    };

    expect(normalizeThreadList(response)).toEqual([
      {
        threadId: "thread-a",
        title: "Thread A",
        archived: false
      },
      {
        threadId: "thread-b",
        title: "Preview B",
        archived: true
      }
    ]);
  });
});

describe("extractThreadIdFromTurnResult", () => {
  it("supports direct threadId and nested thread objects", () => {
    expect(extractThreadIdFromTurnResult({ threadId: "thread-1" })).toBe("thread-1");
    expect(extractThreadIdFromTurnResult({ thread: { id: "thread-2" } })).toBe("thread-2");
    expect(extractThreadIdFromTurnResult({ thread: { thread_id: "thread-3" } })).toBe("thread-3");
    expect(extractThreadIdFromTurnResult({ turnId: "turn-only" })).toBeNull();
  });
});

describe("formatWorkspaceEvent", () => {
  it("formats socket/system envelope types", () => {
    expect(formatWorkspaceEvent({ type: "connected" })).toBe("[socket] subscribed to workspace events");
    expect(formatWorkspaceEvent({ type: "parse_error" })).toBe("[socket] received non-JSON event payload");
  });

  it("formats runtime notifications with params summary", () => {
    const message = formatWorkspaceEvent({
      type: "workspace_runtime_event",
      event: {
        sequence: 8,
        kind: "notification",
        payload: {
          method: "turn/completed",
          params: {
            turnId: "turn-1",
            status: "completed"
          }
        }
      }
    });

    expect(message).toBe("#8 turn/completed status=completed turnId=turn-1");
  });

  it("suppresses noisy skills update notifications", () => {
    const message = formatWorkspaceEvent({
      type: "workspace_runtime_event",
      event: {
        sequence: 9,
        kind: "notification",
        payload: {
          method: "codex/event/skills_update_available",
          params: {
            msg: {
              type: "skills_update_available"
            }
          }
        }
      }
    });

    expect(message).toBe("");
  });

  it("formats state and stderr runtime entries", () => {
    expect(
      formatWorkspaceEvent({
        type: "workspace_runtime_event",
        event: {
          sequence: 3,
          kind: "stateChanged",
          payload: {
            state: "ready"
          }
        }
      })
    ).toBe("#3 runtime-state ready");

    expect(
      formatWorkspaceEvent({
        type: "workspace_runtime_event",
        event: {
          sequence: 5,
          kind: "stderr",
          payload: {
            message: "worker reported a warning"
          }
        }
      })
    ).toBe('#5 runtime-stderr text="worker reported a warning"');
  });
});
