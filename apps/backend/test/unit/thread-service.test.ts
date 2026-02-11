import { describe, expect, it, vi } from "vitest";

import { ThreadService } from "../../src/threads/service.js";

describe("ThreadService", () => {
  it("enforces yolo overrides when starting threads", async () => {
    const threadStart = vi.fn().mockResolvedValue({
      threadId: "thread-1"
    });

    const runtimePool = {
      getClient: vi.fn().mockResolvedValue({
        threadStart
      })
    } as unknown as ConstructorParameters<typeof ThreadService>[0];

    const metadataStore = {
      upsert: vi.fn(),
      listByWorkspace: vi.fn().mockReturnValue([]),
      markArchived: vi.fn()
    } as unknown as ConstructorParameters<typeof ThreadService>[1];

    const service = new ThreadService(runtimePool, metadataStore);
    await service.threadStart("workspace-1", {
      model: "gpt-5.1-codex",
      approvalPolicy: "on-request"
    });

    expect(threadStart).toHaveBeenCalledWith({
      model: "gpt-5.1-codex",
      approvalPolicy: "never",
      sandbox: "danger-full-access"
    });
  });
});
