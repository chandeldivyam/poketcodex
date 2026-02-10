import { afterEach, describe, expect, it } from "vitest";

import { AppServerProtocolError } from "../../src/codex/app-server-manager.js";
import { AppServerClient } from "../../src/codex/app-server-client.js";
import { createTestAppServerManager } from "../helpers/create-app-server-manager.js";

describe("AppServerManager (integration)", () => {
  const managers: ReturnType<typeof createTestAppServerManager>[] = [];

  afterEach(async () => {
    await Promise.all(
      managers.map(async (manager) => {
        await manager.stop();
      })
    );
    managers.length = 0;
  });

  it("starts a real subprocess and completes initialize handshake", async () => {
    const manager = createTestAppServerManager();
    const client = new AppServerClient(manager);
    managers.push(manager);

    const initializeResult = await manager.start();
    expect(initializeResult.serverInfo?.name).toBe("fake-codex-app-server");
    expect(manager.isReady()).toBe(true);
    expect(manager.getPid()).toBeTypeOf("number");

    const listResult = await client.threadList({});
    expect(Array.isArray((listResult as { threads?: unknown[] }).threads)).toBe(true);

    await manager.stop();
    expect(manager.getState()).toBe("stopped");
  });

  it("raises protocol error when method is called before initialize", async () => {
    const manager = createTestAppServerManager();
    managers.push(manager);

    await expect(manager.request("thread/list", {})).rejects.toBeInstanceOf(AppServerProtocolError);
  });
});
