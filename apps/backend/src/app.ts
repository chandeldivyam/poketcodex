import { randomUUID } from "node:crypto";

import Fastify from "fastify";

import type { LogLevel } from "./config.js";
import { createLoggerOptions } from "./logger.js";

export interface BuildAppOptions {
  logger?: boolean;
  logLevel?: LogLevel;
  loggerStream?: NodeJS.WritableStream;
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
