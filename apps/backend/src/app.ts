import { randomUUID } from "node:crypto";

import Fastify from "fastify";

import { authPlugin } from "./auth/plugin.js";
import type { InMemorySessionStore } from "./auth/session-store.js";
import type { AppConfig, LogLevel } from "./config.js";
import { createLoggerOptions } from "./logger.js";
import { threadPlugin } from "./threads/plugin.js";
import type { ThreadService } from "./threads/service.js";
import { workspacePlugin } from "./workspaces/plugin.js";
import type { WorkspaceService } from "./workspaces/service.js";

export interface BuildAppOptions {
  logger?: boolean;
  logLevel?: LogLevel;
  loggerStream?: NodeJS.WritableStream;
  authConfig?: AppConfig;
  sessionStore?: InMemorySessionStore;
  workspaceService?: WorkspaceService;
  threadService?: ThreadService;
}

export function buildApp(options: BuildAppOptions = {}) {
  const requestCountsByStatusCode = new Map<number, number>();
  let requestCount = 0;
  let errorCount = 0;
  const startedAt = Date.now();
  const loggerOptions =
    options.logger === false
      ? false
      : createLoggerOptions({
          level: options.logLevel ?? "info",
          ...(options.loggerStream ? { stream: options.loggerStream } : {})
        });

  const app = Fastify({
    logger: loggerOptions,
    requestIdHeader: "x-request-id",
    genReqId(request) {
      const incomingRequestId = request.headers["x-request-id"];
      if (Array.isArray(incomingRequestId)) {
        return incomingRequestId[0] ?? randomUUID();
      }

      return incomingRequestId ?? randomUUID();
    }
  });

  if (options.authConfig) {
    app.register(authPlugin, {
      config: options.authConfig,
      ...(options.sessionStore ? { sessionStore: options.sessionStore } : {})
    });
  }

  if (options.workspaceService) {
    app.register(workspacePlugin, {
      workspaceService: options.workspaceService
    });
  }

  if (options.threadService) {
    app.register(threadPlugin, {
      threadService: options.threadService
    });
  }

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.addHook("onResponse", async (_request, reply) => {
    requestCount += 1;
    requestCountsByStatusCode.set(
      reply.statusCode,
      (requestCountsByStatusCode.get(reply.statusCode) ?? 0) + 1
    );

    if (reply.statusCode >= 500) {
      errorCount += 1;
    }
  });

  app.get("/api/health", async () => {
    return {
      status: "ok",
      service: "poketcodex-backend",
      timestamp: new Date().toISOString()
    };
  });

  app.get("/api/metrics", async () => {
    return {
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      requestCount,
      errorCount,
      requestCountsByStatusCode: Object.fromEntries(requestCountsByStatusCode)
    };
  });

  return app;
}
