import { afterEach, describe, expect, it } from "vitest";

import { ThreadMetadataStore } from "../../src/threads/metadata-store.js";

describe("ThreadMetadataStore", () => {
  const stores: ThreadMetadataStore[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }
  });

  it("upserts and lists thread metadata", () => {
    const store = new ThreadMetadataStore(":memory:");
    stores.push(store);

    store.upsert({
      threadId: "thread-1",
      workspaceId: "workspace-1",
      title: "Thread 1",
      rawPayload: {
        id: "thread-1"
      }
    });

    const listed = store.listByWorkspace("workspace-1");
    expect(listed.length).toBe(1);
    expect(listed[0]?.threadId).toBe("thread-1");
  });

  it("marks thread metadata as archived", () => {
    const store = new ThreadMetadataStore(":memory:");
    stores.push(store);

    store.upsert({
      threadId: "thread-1",
      workspaceId: "workspace-1",
      title: "Thread 1",
      rawPayload: {
        id: "thread-1"
      }
    });
    store.markArchived("workspace-1", "thread-1");

    const listed = store.listByWorkspace("workspace-1");
    expect(listed[0]?.archived).toBe(true);
  });
});
