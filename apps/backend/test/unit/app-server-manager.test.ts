import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  AppServerProtocolError,
  AppServerTimeoutError,
  type ServerNotificationEvent,
  type ServerRequestEvent,
  type StaleResponseEvent
} from "../../src/codex/app-server-manager.js";
import { createTestAppServerManager } from "../helpers/create-app-server-manager.js";

describe("AppServerManager (unit)", () => {
  const managers: ReturnType<typeof createTestAppServerManager>[] = [];

  afterEach(async () => {
    await Promise.all(
      managers.map(async (manager) => {
        await manager.stop();
      })
    );
    managers.length = 0;
  });

  it("enforces initialize before regular requests", async () => {
    const manager = createTestAppServerManager();
    managers.push(manager);

    await expect(manager.request("thread/list", {})).rejects.toBeInstanceOf(AppServerProtocolError);

    const initializeResult = await manager.start();
    expect(initializeResult).toMatchObject({
      serverInfo: {
        name: "fake-codex-app-server"
      }
    });

    const result = await manager.request<{ threads: Array<{ id: string }> }>("thread/list", {});
    expect(result.threads[0]?.id).toBe("thread-1");
  });

  it("times out requests and marks delayed responses as stale", async () => {
    const manager = createTestAppServerManager(undefined, {
      FAKE_DELAY_MS: "120"
    });
    managers.push(manager);

    const staleResponses: StaleResponseEvent[] = [];
    manager.on("staleResponse", (event) => {
      staleResponses.push(event);
    });

    await manager.start();

    await expect(
      manager.request("test/delayed-response", {}, { timeoutMs: 20 })
    ).rejects.toBeInstanceOf(AppServerTimeoutError);

    await delay(180);
    expect(staleResponses.length).toBe(1);
  });

  it("emits stale response event for duplicate server responses", async () => {
    const manager = createTestAppServerManager();
    managers.push(manager);

    const staleResponses: StaleResponseEvent[] = [];
    manager.on("staleResponse", (event) => {
      staleResponses.push(event);
    });

    await manager.start();

    const result = await manager.request<{ ok: boolean }>("test/duplicate-response", {});
    expect(result.ok).toBe(true);

    await delay(40);
    expect(staleResponses.length).toBe(1);
  });

  it("routes server notifications and server-initiated requests", async () => {
    const manager = createTestAppServerManager(undefined, {
      FAKE_SERVER_NOTIFICATION_AFTER_INIT: "1"
    });
    managers.push(manager);

    const notifications: ServerNotificationEvent[] = [];
    const serverRequests: ServerRequestEvent[] = [];

    manager.on("notification", (event) => {
      notifications.push(event);
    });
    manager.on("serverRequest", (event) => {
      serverRequests.push(event);
    });

    await manager.start();
    await manager.request("test/emit-events", {});

    expect(
      notifications.some((event) => event.method === "server/ready" || event.method === "thread/updated")
    ).toBe(true);
    expect(serverRequests.some((event) => event.method === "approval/request")).toBe(true);
  });
});
