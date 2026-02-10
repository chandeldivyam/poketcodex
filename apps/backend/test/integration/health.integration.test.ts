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

describe("health endpoint integration", () => {
  it("starts backend with valid env and responds with 200", async () => {
    const port = await findAvailablePort();
    const runningServer = await startServer({
      logger: false,
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        AUTH_MODE: "single_user",
        SESSION_SECRET: "session-secret-for-tests-1234567890",
        CSRF_SECRET: "csrf-secret-for-tests-123456789012",
        SESSION_TTL_MINUTES: "60",
        ALLOWED_WORKSPACE_ROOTS: process.cwd()
      }
    });

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      const body = (await response.json()) as { status?: string };

      expect(response.status).toBe(200);
      expect(body.status).toBe("ok");
    } finally {
      await runningServer.close();
    }
  });
});
