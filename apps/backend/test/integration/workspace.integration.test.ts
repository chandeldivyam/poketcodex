import { createServer } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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

describe("workspace routes integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(() => {
    for (const target of cleanupTargets.splice(0)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("rejects unauthenticated mutating workspace requests", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "poketcodex-workspaces-"));
    cleanupTargets.push(tempRoot);
    const port = await findAvailablePort();
    const server = await startServer({
      logger: false,
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        SQLITE_DATABASE_PATH: path.join(tempRoot, "workspaces.db"),
        AUTH_MODE: "single_user",
        AUTH_PASSWORD: "workspace-test-password",
        SESSION_SECRET: "workspace-session-secret-123456789012",
        CSRF_SECRET: "workspace-csrf-secret-1234567890123456",
        COOKIE_SECURE: "false",
        SESSION_TTL_MINUTES: "60",
        ALLOWED_WORKSPACE_ROOTS: tempRoot
      }
    });

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          absolutePath: tempRoot
        })
      });

      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("creates, lists, validates, and deletes workspaces with auth and root checks", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "poketcodex-workspaces-"));
    cleanupTargets.push(tempRoot);
    const port = await findAvailablePort();

    const allowedWorkspace = path.join(tempRoot, "allowed", "workspace-a");
    const outsideWorkspace = path.join(tempRoot, "outside");
    const symlinkPath = path.join(tempRoot, "allowed", "escape-link");
    fs.mkdirSync(allowedWorkspace, { recursive: true });
    fs.mkdirSync(outsideWorkspace, { recursive: true });
    fs.symlinkSync(outsideWorkspace, symlinkPath, "dir");

    const server = await startServer({
      logger: false,
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        SQLITE_DATABASE_PATH: path.join(tempRoot, "workspaces.db"),
        AUTH_MODE: "single_user",
        AUTH_PASSWORD: "workspace-test-password",
        SESSION_SECRET: "workspace-session-secret-123456789012",
        CSRF_SECRET: "workspace-csrf-secret-1234567890123456",
        COOKIE_SECURE: "false",
        SESSION_TTL_MINUTES: "60",
        ALLOWED_WORKSPACE_ROOTS: path.join(tempRoot, "allowed")
      }
    });

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const { sessionCookie, csrfToken } = await login(baseUrl, "workspace-test-password");

      const missingCsrfResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie
        },
        body: JSON.stringify({
          absolutePath: allowedWorkspace
        })
      });
      expect(missingCsrfResponse.status).toBe(403);

      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          absolutePath: allowedWorkspace,
          displayName: "Workspace A"
        })
      });
      const createBody = (await createResponse.json()) as {
        workspace?: { workspaceId?: string; absolutePath?: string };
      };

      expect(createResponse.status).toBe(201);
      expect(createBody.workspace?.absolutePath).toBe(fs.realpathSync.native(allowedWorkspace));

      const duplicateResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          absolutePath: allowedWorkspace
        })
      });
      expect(duplicateResponse.status).toBe(409);

      const outsideResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          absolutePath: outsideWorkspace
        })
      });
      expect(outsideResponse.status).toBe(400);

      const symlinkEscapeResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          absolutePath: symlinkPath
        })
      });
      expect(symlinkEscapeResponse.status).toBe(400);

      const listResponse = await fetch(`${baseUrl}/api/workspaces`);
      const listBody = (await listResponse.json()) as {
        workspaces?: Array<{ workspaceId?: string }>;
      };
      expect(listResponse.status).toBe(200);
      expect(listBody.workspaces?.length).toBe(1);

      const workspaceId = createBody.workspace?.workspaceId;
      expect(workspaceId).toBeTypeOf("string");

      const deleteResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}`, {
        method: "DELETE",
        headers: {
          cookie: sessionCookie,
          "x-csrf-token": csrfToken
        }
      });
      expect(deleteResponse.status).toBe(204);
    } finally {
      await server.close();
    }
  });
});
