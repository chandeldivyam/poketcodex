import { describe, expect, it, vi } from "vitest";

import { AppServerRpcError } from "../../src/codex/app-server-manager.js";
import { TurnService } from "../../src/turns/service.js";

interface MockClient {
  turnStart: ReturnType<typeof vi.fn>;
  threadResume: ReturnType<typeof vi.fn>;
  turnSteer: ReturnType<typeof vi.fn>;
  turnInterrupt: ReturnType<typeof vi.fn>;
}

function createService(client: MockClient): {
  service: TurnService;
  getClient: ReturnType<typeof vi.fn>;
} {
  const getClient = vi.fn().mockResolvedValue(client);
  const runtimePool = {
    getClient
  } as unknown as ConstructorParameters<typeof TurnService>[0];

  return {
    service: new TurnService(runtimePool),
    getClient
  };
}

describe("TurnService", () => {
  it("retries turn start after thread resume when runtime reports thread not found", async () => {
    const params = {
      threadId: "thread-123",
      input: [{ type: "text", text: "hello" }]
    };

    const client: MockClient = {
      turnStart: vi
        .fn()
        .mockRejectedValueOnce(new AppServerRpcError(-32600, "thread not found: thread-123"))
        .mockResolvedValueOnce({ turn: { id: "2", status: "inProgress" } }),
      threadResume: vi.fn().mockResolvedValue({ thread: { id: "thread-123" } }),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn()
    };

    const { service, getClient } = createService(client);
    const result = await service.turnStart("workspace-1", params);

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(client.turnStart).toHaveBeenCalledTimes(2);
    expect(client.threadResume).toHaveBeenCalledTimes(1);
    expect(client.threadResume).toHaveBeenCalledWith({
      threadId: "thread-123"
    });
    expect(result).toEqual({
      turn: { id: "2", status: "inProgress" }
    });
  });

  it("does not resume when turn start fails for non-thread-not-found errors", async () => {
    const params = {
      threadId: "thread-123",
      input: [{ type: "text", text: "hello" }]
    };

    const client: MockClient = {
      turnStart: vi.fn().mockRejectedValue(new AppServerRpcError(-32001, "upstream unavailable")),
      threadResume: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn()
    };

    const { service } = createService(client);

    await expect(service.turnStart("workspace-1", params)).rejects.toMatchObject({
      code: -32001
    });

    expect(client.turnStart).toHaveBeenCalledTimes(1);
    expect(client.threadResume).not.toHaveBeenCalled();
  });

  it("does not resume when thread id is absent", async () => {
    const params = {
      input: [{ type: "text", text: "hello" }]
    };

    const client: MockClient = {
      turnStart: vi.fn().mockRejectedValue(new AppServerRpcError(-32600, "thread not found: missing")),
      threadResume: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn()
    };

    const { service } = createService(client);

    await expect(service.turnStart("workspace-1", params)).rejects.toMatchObject({
      code: -32600
    });

    expect(client.turnStart).toHaveBeenCalledTimes(1);
    expect(client.threadResume).not.toHaveBeenCalled();
  });
});
