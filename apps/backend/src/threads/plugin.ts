import type { FastifyPluginAsync } from "fastify";

import { WorkspaceNotFoundError, WorkspaceRuntimeError } from "../codex/workspace-app-server-pool.js";
import { AppServerManagerError } from "../codex/app-server-manager.js";
import type { ThreadService } from "./service.js";

interface ThreadBodyRequest {
  [key: string]: unknown;
}

export interface ThreadPluginOptions {
  threadService: ThreadService;
}

function getWorkspaceId(params: unknown): string {
  const workspaceId = (params as { workspaceId?: unknown }).workspaceId;
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new WorkspaceRuntimeError("workspaceId path parameter is required");
  }
  return workspaceId;
}

export const threadPlugin: FastifyPluginAsync<ThreadPluginOptions> = async (app, options) => {
  const { threadService } = options;

  app.post("/api/workspaces/:workspaceId/threads/start", async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request.params);
      const result = await threadService.threadStart(workspaceId, (request.body as ThreadBodyRequest) ?? {});
      return reply.code(200).send({ result });
    } catch (error: unknown) {
      return handleThreadError(request, reply, error);
    }
  });

  app.post("/api/workspaces/:workspaceId/threads/resume", async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request.params);
      const result = await threadService.threadResume(workspaceId, (request.body as ThreadBodyRequest) ?? {});
      return reply.code(200).send({ result });
    } catch (error: unknown) {
      return handleThreadError(request, reply, error);
    }
  });

  app.get("/api/workspaces/:workspaceId/threads", async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request.params);
      const result = await threadService.threadList(workspaceId, {});
      return reply.code(200).send(result);
    } catch (error: unknown) {
      return handleThreadError(request, reply, error);
    }
  });

  app.post("/api/workspaces/:workspaceId/threads/read", async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request.params);
      const result = await threadService.threadRead(workspaceId, (request.body as ThreadBodyRequest) ?? {});
      return reply.code(200).send({ result });
    } catch (error: unknown) {
      return handleThreadError(request, reply, error);
    }
  });

  app.post("/api/workspaces/:workspaceId/threads/archive", async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request.params);
      const result = await threadService.threadArchive(workspaceId, (request.body as ThreadBodyRequest) ?? {});
      return reply.code(200).send({ result });
    } catch (error: unknown) {
      return handleThreadError(request, reply, error);
    }
  });
};

function handleThreadError(
  request: {
    log: {
      error(payload: unknown, message: string): void;
    };
  },
  reply: {
    code(statusCode: number): {
      send(payload: unknown): unknown;
    };
  },
  error: unknown
): unknown {
  if (error instanceof WorkspaceNotFoundError) {
    return reply.code(404).send({
      error: "not_found",
      message: error.message
    });
  }

  if (error instanceof WorkspaceRuntimeError || error instanceof AppServerManagerError) {
    return reply.code(502).send({
      error: "upstream_error",
      message: error.message
    });
  }

  request.log.error({ err: error }, "thread route failed");
  return reply.code(500).send({
    error: "internal_error",
    message: "Thread request failed"
  });
}
