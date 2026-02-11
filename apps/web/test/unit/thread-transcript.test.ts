import { describe, expect, it } from "vitest";

import {
  appendAgentMessageDelta,
  appendReasoningContentDelta,
  appendReasoningSummaryDelta,
  extractThreadIdFromRuntimeParams,
  extractTurnIdFromRuntimeParams,
  parseWorkspaceRuntimeNotification,
  setTranscriptItemStreaming,
  transcriptItemsFromThreadReadResult,
  upsertTranscriptItem
} from "../../src/lib/thread-transcript.js";

describe("thread transcript normalization", () => {
  it("maps thread/read turns into transcript items", () => {
    const items = transcriptItemsFromThreadReadResult({
      thread: {
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "item-user",
                type: "userMessage",
                content: [
                  { type: "text", text: "Hey" },
                  { type: "local_image", path: "/tmp/test.png" }
                ]
              },
              {
                id: "item-assistant",
                type: "agentMessage",
                text: "Hello"
              },
              {
                id: "item-reasoning",
                type: "reasoning",
                summary: "Plan",
                content: "Detailed thinking"
              },
              {
                id: "item-command",
                type: "commandExecution",
                command: ["ls", "-la"],
                cwd: "/tmp",
                output: "done"
              }
            ]
          }
        ]
      }
    });

    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      id: "item-user",
      kind: "message",
      role: "user",
      text: "Hey\n[image]",
      turnId: "turn-1"
    });
    expect(items[1]).toMatchObject({
      id: "item-assistant",
      kind: "message",
      role: "assistant",
      text: "Hello",
      turnId: "turn-1"
    });
    expect(items[2]).toMatchObject({
      id: "item-reasoning",
      kind: "reasoning",
      summary: "Plan",
      content: "Detailed thinking",
      turnId: "turn-1"
    });
    expect(items[3]).toMatchObject({
      id: "item-command",
      kind: "tool",
      title: "ls -la",
      detail: "/tmp",
      output: "done",
      turnId: "turn-1"
    });
  });

  it("parses runtime envelopes and extracts ids", () => {
    const notification = parseWorkspaceRuntimeNotification({
      type: "workspace_runtime_event",
      event: {
        sequence: 42,
        payload: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-1",
            turn: {
              id: "turn-9"
            }
          }
        }
      }
    });

    expect(notification).toMatchObject({
      sequence: 42,
      method: "item/agentMessage/delta"
    });
    expect(extractThreadIdFromRuntimeParams(notification?.params ?? {})).toBe("thread-1");
    expect(extractTurnIdFromRuntimeParams(notification?.params ?? {})).toBe("turn-9");
  });
});

describe("thread transcript live updates", () => {
  it("appends assistant deltas to the same item", () => {
    const once = appendAgentMessageDelta([], {
      itemId: "msg-1",
      delta: "Hel",
      turnId: "turn-1"
    });
    const twice = appendAgentMessageDelta(once, {
      itemId: "msg-1",
      delta: "lo",
      turnId: "turn-1"
    });

    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({
      id: "msg-1",
      kind: "message",
      role: "assistant",
      text: "Hello",
      streaming: true
    });
  });

  it("appends reasoning summary/content deltas", () => {
    const summary = appendReasoningSummaryDelta([], {
      itemId: "rs-1",
      delta: "plan",
      turnId: "turn-2"
    });
    const content = appendReasoningContentDelta(summary, {
      itemId: "rs-1",
      delta: "\nstep1",
      turnId: "turn-2"
    });

    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({
      id: "rs-1",
      kind: "reasoning",
      summary: "plan",
      content: "\nstep1",
      streaming: true
    });
  });

  it("upserts richer payload and toggles streaming state", () => {
    const merged = upsertTranscriptItem(
      [
        {
          id: "msg-1",
          kind: "message",
          role: "assistant",
          text: "Hi",
          runtimeItemId: "msg-1",
          streaming: true
        }
      ],
      {
        id: "msg-1",
        kind: "message",
        role: "assistant",
        text: "Hi there",
        runtimeItemId: "msg-1",
        streaming: true
      }
    );

    const completed = setTranscriptItemStreaming(merged, {
      itemId: "msg-1",
      streaming: false
    });

    expect(completed[0]).toMatchObject({
      text: "Hi there",
      streaming: false
    });
  });
});
