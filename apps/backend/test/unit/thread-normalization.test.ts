import { describe, expect, it } from "vitest";

import { normalizeThreadSummaries } from "../../src/threads/normalization.js";

describe("normalizeThreadSummaries", () => {
  it("extracts summaries from thread/list style payloads", () => {
    const result = normalizeThreadSummaries({
      threads: [
        { id: "thread-1", title: "Thread 1", archived: false },
        { threadId: "thread-2", title: "Thread 2", archived: true }
      ]
    });

    expect(result).toHaveLength(2);
    expect(result.map((entry) => entry.threadId)).toEqual(["thread-1", "thread-2"]);
  });

  it("extracts summaries from thread/start style payloads", () => {
    const result = normalizeThreadSummaries({
      threadId: "thread-9"
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.threadId).toBe("thread-9");
  });

  it("deduplicates repeated thread ids", () => {
    const result = normalizeThreadSummaries({
      threadId: "thread-1",
      thread: {
        id: "thread-1"
      },
      threads: [{ id: "thread-1" }]
    });

    expect(result).toHaveLength(1);
  });
});
