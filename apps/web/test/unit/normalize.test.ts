import { describe, expect, it } from "vitest";

import type { ThreadListResponse } from "../../src/lib/api-client.js";
import {
  extractThreadIdFromTurnResult,
  formatWorkspaceEvent,
  normalizeWorkspaceTimelineEvent,
  normalizeThreadList
} from "../../src/lib/normalize.js";

describe("normalizeThreadList", () => {
  it("prefers metadata records when available and sorts by activity", () => {
    const response: ThreadListResponse = {
      remote: {
        threads: [{ id: "remote-thread" }]
      },
      metadata: [
        {
          threadId: "meta-thread-old",
          workspaceId: "workspace-1",
          title: "Old Metadata Thread",
          archived: false,
          lastSeenAt: "2026-02-09T00:00:00.000Z",
          rawPayload: { id: "meta-thread-old" }
        },
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
        archived: true,
        lastSeenAt: "2026-02-10T00:00:00.000Z"
      },
      {
        threadId: "meta-thread-old",
        title: "Old Metadata Thread",
        archived: false,
        lastSeenAt: "2026-02-09T00:00:00.000Z"
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
            archived: false,
            lastSeenAt: "2026-02-09T08:30:00.000Z"
          },
          {
            threadId: "thread-b",
            preview: "Preview B",
            archived: true,
            updatedAt: "2026-02-10T07:45:00.000Z"
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
        threadId: "thread-b",
        title: "Preview B",
        archived: true,
        lastSeenAt: "2026-02-10T07:45:00.000Z"
      },
      {
        threadId: "thread-a",
        title: "Thread A",
        archived: false,
        lastSeenAt: "2026-02-09T08:30:00.000Z"
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

  it("can include noisy notifications when requested", () => {
    const message = formatWorkspaceEvent(
      {
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
      },
      {
        includeNoise: true
      }
    );

    expect(message).toBe('#9 codex/event/skills_update_available {"msg":{"type":"skills_update_available"}}');
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

describe("normalizeWorkspaceTimelineEvent", () => {
  it("returns structured runtime metadata for tool-like events", () => {
    const normalized = normalizeWorkspaceTimelineEvent({
      type: "workspace_runtime_event",
      event: {
        sequence: 14,
        kind: "notification",
        payload: {
          method: "tool/call",
          params: {
            status: "running",
            tool: "bash"
          }
        }
      }
    });

    expect(normalized).toMatchObject({
      message: "#14 tool/call status=running",
      kind: "runtime",
      category: "tool",
      isInternal: false,
      source: "tool/call",
      turnSignal: "running"
    });
    expect(normalized?.details).toContain('"method": "tool/call"');
  });

  it("marks parse errors as internal error events", () => {
    const normalized = normalizeWorkspaceTimelineEvent({
      type: "parse_error",
      raw: "not-json"
    });

    expect(normalized).toEqual({
      message: "[socket] received non-JSON event payload",
      kind: "error",
      category: "error",
      isInternal: true,
      source: "parse_error",
      details: "not-json"
    });
  });

  it("returns null for noisy events unless includeNoise is enabled", () => {
    const payload = {
      type: "workspace_runtime_event",
      event: {
        sequence: 2,
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
    };

    expect(normalizeWorkspaceTimelineEvent(payload)).toBeNull();
    expect(
      normalizeWorkspaceTimelineEvent(payload, {
        includeNoise: true
      })
    ).toMatchObject({
      kind: "runtime",
      category: "status",
      isInternal: true
    });
  });

  it("detects completed and failed turn lifecycle signals", () => {
    expect(
      normalizeWorkspaceTimelineEvent({
        type: "workspace_runtime_event",
        event: {
          sequence: 40,
          kind: "notification",
          payload: {
            method: "turn/completed",
            params: {
              status: "completed"
            }
          }
        }
      })
    ).toMatchObject({
      turnSignal: "completed"
    });

    expect(
      normalizeWorkspaceTimelineEvent({
        type: "workspace_runtime_event",
        event: {
          sequence: 41,
          kind: "notification",
          payload: {
            method: "turn/status",
            params: {
              status: "failed"
            }
          }
        }
      })
    ).toMatchObject({
      turnSignal: "failed",
      kind: "error"
    });
  });
});
