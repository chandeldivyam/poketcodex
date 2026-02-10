import { createServer } from "node:net";
import type { ClientRequest, IncomingMessage } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";

import { AppServerManager } from "../../src/codex/app-server-manager.js";
import { startServer } from "../../src/server.js";

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Unable to allocate a test port"));
        return;
      }

      const allocatedPort = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(allocatedPort);
      });
    });
    server.on("error", reject);
  });
}

async function login(baseUrl: string, password: string): Promise<{ sessionCookie: string; csrfToken: string }> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ password })
  });

  const body = (await response.json()) as { csrfToken?: string };
  const setCookie = response.headers.get("set-cookie");
  const sessionCookie = setCookie?.split(";")[0];

  if (!sessionCookie || !body.csrfToken) {
    throw new Error("Failed to login in test setup");
  }

  return {
    sessionCookie,
    csrfToken: body.csrfToken
  };
}

async function createWorkspace(
  baseUrl: string,
  sessionCookie: string,
  csrfToken: string,
  workspacePath: string
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie,
      "x-csrf-token": csrfToken
    },
    body: JSON.stringify({
      absolutePath: workspacePath,
      displayName: "Turn Workspace"
    })
  });

  const body = (await response.json()) as { workspace?: { workspaceId?: string } };
  const workspaceId = body.workspace?.workspaceId;

  if (response.status !== 201 || !workspaceId) {
    throw new Error("Failed to create workspace in test setup");
  }

  return workspaceId;
}

function openWorkspaceSocket(url: string, sessionCookie: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: {
        cookie: sessionCookie
      }
    });

    socket.once("open", () => {
      resolve(socket);
    });
    socket.once("error", reject);
    socket.once("unexpected-response", (_request: ClientRequest, response: IncomingMessage) => {
      reject(new Error(`Unexpected websocket response: ${response.statusCode}`));
    });
  });
}

async function collectMessagesUntil(
  socket: WebSocket,
  shouldStop: (messages: unknown[]) => boolean,
  timeoutMs: number
): Promise<unknown[]> {
  return await new Promise<unknown[]>((resolve, reject) => {
    const messages: unknown[] = [];

    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for websocket events"));
    }, timeoutMs);

    socket.on("message", (data: RawData) => {
      const text = data.toString();
      const parsed = JSON.parse(text) as unknown;
      messages.push(parsed);

      if (shouldStop(messages)) {
        clearTimeout(timeout);
        resolve(messages);
      }
    });

    socket.once("error", (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

describe("turn routes and event bridge integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(() => {
    for (const target of cleanupTargets.splice(0)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("supports turn start/steer/interrupt routes", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "poketcodex-turns-"));
    cleanupTargets.push(tempRoot);
    const allowedRoot = path.join(tempRoot, "allowed");
    const workspacePath = path.join(allowedRoot, "workspace-a");
    fs.mkdirSync(workspacePath, { recursive: true });

    const fakeServerPath = path.resolve(process.cwd(), "test/fixtures/fake-app-server.ts");
    const port = await findAvailablePort();

    const server = await startServer({
      logger: false,
      appServerManagerFactory: () => {
        return new AppServerManager({
          spawn: {
            command: process.execPath,
            args: ["--import", "tsx", fakeServerPath],
            cwd: process.cwd()
          }
        });
      },
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        SQLITE_DATABASE_PATH: path.join(tempRoot, "turn-metadata.db"),
        AUTH_MODE: "single_user",
        AUTH_PASSWORD: "turn-test-password",
        SESSION_SECRET: "turn-session-secret-1234567890123456",
        CSRF_SECRET: "turn-csrf-secret-12345678901234567890",
        COOKIE_SECURE: "false",
        SESSION_TTL_MINUTES: "60",
        ALLOWED_WORKSPACE_ROOTS: allowedRoot
      }
    });

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const { sessionCookie, csrfToken } = await login(baseUrl, "turn-test-password");
      const workspaceId = await createWorkspace(baseUrl, sessionCookie, csrfToken, workspacePath);

      const turnStartResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/turns/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({ prompt: "start turn" })
      });
      expect(turnStartResponse.status).toBe(200);

      const turnSteerResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/turns/steer`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({ instruction: "steer it" })
      });
      expect(turnSteerResponse.status).toBe(200);

      const turnInterruptResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/turns/interrupt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({})
      });
      expect(turnInterruptResponse.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("streams ordered workspace runtime notification events over websocket", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "poketcodex-turn-events-"));
    cleanupTargets.push(tempRoot);
    const allowedRoot = path.join(tempRoot, "allowed");
    const workspacePath = path.join(allowedRoot, "workspace-a");
    fs.mkdirSync(workspacePath, { recursive: true });

    const fakeServerPath = path.resolve(process.cwd(), "test/fixtures/fake-app-server.ts");
    const port = await findAvailablePort();

    const server = await startServer({
      logger: false,
      appServerManagerFactory: () => {
        return new AppServerManager({
          spawn: {
            command: process.execPath,
            args: ["--import", "tsx", fakeServerPath],
            cwd: process.cwd()
          }
        });
      },
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        SQLITE_DATABASE_PATH: path.join(tempRoot, "turn-metadata.db"),
        AUTH_MODE: "single_user",
        AUTH_PASSWORD: "turn-test-password",
        SESSION_SECRET: "turn-session-secret-1234567890123456",
        CSRF_SECRET: "turn-csrf-secret-12345678901234567890",
        COOKIE_SECURE: "false",
        SESSION_TTL_MINUTES: "60",
        ALLOWED_WORKSPACE_ROOTS: allowedRoot
      }
    });

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const { sessionCookie, csrfToken } = await login(baseUrl, "turn-test-password");
      const workspaceId = await createWorkspace(baseUrl, sessionCookie, csrfToken, workspacePath);

      const websocketUrl = `ws://127.0.0.1:${port}/api/workspaces/${workspaceId}/events`;
      const socket = await openWorkspaceSocket(websocketUrl, sessionCookie);

      const messagePromise = collectMessagesUntil(
        socket,
        (messages) => {
          return messages.some((message) => {
            if (!message || typeof message !== "object") {
              return false;
            }

            const typedMessage = message as {
              type?: string;
              event?: { kind?: string; payload?: { method?: string } };
            };

            return (
              typedMessage.type === "workspace_runtime_event" &&
              typedMessage.event?.kind === "notification" &&
              typedMessage.event.payload?.method === "turn/completed"
            );
          });
        },
        5_000
      );

      const turnStartResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/turns/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({ prompt: "stream this turn" })
      });
      expect(turnStartResponse.status).toBe(200);

      const messages = await messagePromise;
      socket.close();

      const runtimeEvents = messages
        .map((message) => message as { type?: string; event?: { sequence?: number; kind?: string; payload?: { method?: string } } })
        .filter((message) => message.type === "workspace_runtime_event" && message.event);

      const sequences = runtimeEvents
        .map((eventMessage) => eventMessage.event?.sequence)
        .filter((sequence): sequence is number => typeof sequence === "number");
      for (let index = 1; index < sequences.length; index += 1) {
        expect(sequences[index]).toBeGreaterThan(sequences[index - 1] ?? -1);
      }

      const notificationMethods = runtimeEvents
        .filter((eventMessage) => eventMessage.event?.kind === "notification")
        .map((eventMessage) => eventMessage.event?.payload?.method)
        .filter((method): method is string => typeof method === "string")
        .filter((method) =>
          ["turn/started", "item/started", "item/completed", "turn/completed"].includes(method)
        );

      expect(notificationMethods).toEqual([
        "turn/started",
        "item/started",
        "item/completed",
        "turn/completed"
      ]);
    } finally {
      await server.close();
    }
  });
});
