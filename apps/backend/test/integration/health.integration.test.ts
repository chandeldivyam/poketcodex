import { createServer } from "node:net";
import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
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
        SQLITE_DATABASE_PATH: ":memory:",
        AUTH_MODE: "single_user",
        AUTH_PASSWORD: "pocketcodex-test-password",
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

  it("exposes a parseable metrics endpoint", async () => {
    const port = await findAvailablePort();
    const runningServer = await startServer({
      logger: false,
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        SQLITE_DATABASE_PATH: ":memory:",
        AUTH_MODE: "single_user",
        AUTH_PASSWORD: "pocketcodex-test-password",
        SESSION_SECRET: "session-secret-for-tests-1234567890",
        CSRF_SECRET: "csrf-secret-for-tests-123456789012",
        SESSION_TTL_MINUTES: "60",
        ALLOWED_WORKSPACE_ROOTS: process.cwd()
      }
    });

    try {
      await fetch(`http://127.0.0.1:${port}/api/health`);
      const response = await fetch(`http://127.0.0.1:${port}/api/metrics`);
      const body = (await response.json()) as {
        requestCount?: number;
        errorCount?: number;
        requestCountsByStatusCode?: Record<string, number>;
      };

      expect(response.status).toBe(200);
      expect(typeof body.requestCount).toBe("number");
      expect(typeof body.errorCount).toBe("number");
      expect(body.requestCountsByStatusCode).toBeTypeOf("object");
    } finally {
      await runningServer.close();
    }
  });

  it("includes request correlation ID in structured logs", async () => {
    const logBuffer: string[] = [];
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        logBuffer.push(chunk.toString());
        callback();
      }
    });

    const app = buildApp({ logger: true, logLevel: "info", loggerStream: logStream });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const correlationId = "integration-correlation-id";

    try {
      await fetch(`${address}/api/health`, {
        headers: {
          "x-request-id": correlationId
        }
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      expect(logBuffer.join("")).toContain(correlationId);
    } finally {
      await app.close();
    }
  });
});
