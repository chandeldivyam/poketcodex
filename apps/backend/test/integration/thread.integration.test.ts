import { createServer } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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

describe("thread routes integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(() => {
    for (const target of cleanupTargets.splice(0)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("handles thread lifecycle operations through app-server client wrappers", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "poketcodex-threads-"));
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
            cwd: process.cwd(),
            env: {
              ...process.env
            }
          },
          defaultRequestTimeoutMs: 500
        });
      },
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        SQLITE_DATABASE_PATH: path.join(tempRoot, "thread-metadata.db"),
        AUTH_MODE: "single_user",
        AUTH_PASSWORD: "thread-test-password",
        SESSION_SECRET: "thread-session-secret-1234567890123456",
        CSRF_SECRET: "thread-csrf-secret-12345678901234567890",
        COOKIE_SECURE: "false",
        SESSION_TTL_MINUTES: "60",
        ALLOWED_WORKSPACE_ROOTS: allowedRoot
      }
    });

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const { sessionCookie, csrfToken } = await login(baseUrl, "thread-test-password");

      const createWorkspaceResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          absolutePath: workspacePath,
          displayName: "Thread Workspace"
        })
      });
      const workspaceBody = (await createWorkspaceResponse.json()) as {
        workspace?: { workspaceId?: string };
      };

      expect(createWorkspaceResponse.status).toBe(201);
      const workspaceId = workspaceBody.workspace?.workspaceId;
      expect(workspaceId).toBeTypeOf("string");

      const startResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/threads/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          prompt: "Start a new thread"
        })
      });
      const startBody = (await startResponse.json()) as { result?: { threadId?: string } };
      expect(startResponse.status).toBe(200);
      expect(typeof startBody.result?.threadId).toBe("string");

      const startedThreadId = startBody.result?.threadId ?? "thread-1";

      const readResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/threads/read`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          threadId: startedThreadId
        })
      });
      expect(readResponse.status).toBe(200);

      const archiveResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/threads/archive`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          threadId: startedThreadId
        })
      });
      expect(archiveResponse.status).toBe(200);

      const listResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/threads`);
      const listBody = (await listResponse.json()) as {
        remote?: { threads?: Array<{ id?: string }> };
        metadata?: Array<{ threadId?: string; archived?: boolean }>;
      };
      expect(listResponse.status).toBe(200);
      expect(Array.isArray(listBody.remote?.threads)).toBe(true);
      expect(listBody.metadata?.some((thread) => thread.threadId === startedThreadId)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("returns not found for unknown workspace thread operations", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "poketcodex-threads-"));
    cleanupTargets.push(tempRoot);
    const port = await findAvailablePort();

    const server = await startServer({
      logger: false,
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        SQLITE_DATABASE_PATH: path.join(tempRoot, "thread-metadata.db"),
        AUTH_MODE: "single_user",
        AUTH_PASSWORD: "thread-test-password",
        SESSION_SECRET: "thread-session-secret-1234567890123456",
        CSRF_SECRET: "thread-csrf-secret-12345678901234567890",
        COOKIE_SECURE: "false",
        SESSION_TTL_MINUTES: "60",
        ALLOWED_WORKSPACE_ROOTS: tempRoot
      }
    });

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const { sessionCookie, csrfToken } = await login(baseUrl, "thread-test-password");

      const response = await fetch(`${baseUrl}/api/workspaces/unknown/threads/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
