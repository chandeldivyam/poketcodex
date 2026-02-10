import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import { startServer } from "../../src/server.js";

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        reject(new Error("Unable to determine test port"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });

    server.on("error", reject);
  });
}

function buildTestEnv(port: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(port),
    SQLITE_DATABASE_PATH: ":memory:",
    LOG_LEVEL: "info",
    AUTH_MODE: "single_user",
    AUTH_PASSWORD: "pocketcodex-test-password",
    SESSION_SECRET: "session-secret-for-tests-1234567890",
    CSRF_SECRET: "csrf-secret-for-tests-123456789012",
    COOKIE_SECURE: "true",
    SESSION_TTL_MINUTES: "60",
    ALLOWED_WORKSPACE_ROOTS: process.cwd()
  };
}

describe("auth integration", () => {
  it("rejects unauthenticated mutating requests", async () => {
    const port = await findAvailablePort();
    const server = await startServer({
      logger: false,
      env: buildTestEnv(port)
    });

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
        method: "POST"
      });
      const body = (await response.json()) as { error?: string };

      expect(response.status).toBe(401);
      expect(body.error).toBe("unauthorized");
    } finally {
      await server.close();
    }
  });

  it("enforces CSRF and allows logout with a valid token", async () => {
    const port = await findAvailablePort();
    const server = await startServer({
      logger: false,
      env: buildTestEnv(port)
    });

    try {
      const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ password: "pocketcodex-test-password" })
      });
      const loginBody = (await loginResponse.json()) as { csrfToken?: string };
      const setCookie = loginResponse.headers.get("set-cookie");

      expect(loginResponse.status).toBe(200);
      expect(typeof loginBody.csrfToken).toBe("string");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("SameSite=Strict");

      const sessionCookie = setCookie?.split(";")[0];
      expect(sessionCookie).toBeTruthy();

      const missingCsrfResponse = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
        method: "POST",
        headers: {
          cookie: sessionCookie ?? ""
        }
      });
      const missingCsrfBody = (await missingCsrfResponse.json()) as { error?: string };

      expect(missingCsrfResponse.status).toBe(403);
      expect(missingCsrfBody.error).toBe("forbidden");

      const logoutResponse = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
        method: "POST",
        headers: {
          cookie: sessionCookie ?? "",
          "x-csrf-token": loginBody.csrfToken ?? ""
        }
      });
      const logoutBody = (await logoutResponse.json()) as { authenticated?: boolean };

      expect(logoutResponse.status).toBe(200);
      expect(logoutBody.authenticated).toBe(false);
    } finally {
      await server.close();
    }
  });
});
