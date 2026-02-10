import type { FastifyPluginAsync } from "fastify";

import { AppServerManagerError } from "../codex/app-server-manager.js";
import { WorkspaceNotFoundError, WorkspaceRuntimeError } from "../codex/workspace-app-server-pool.js";
import type { TurnService } from "./service.js";

interface TurnBodyRequest {
  [key: string]: unknown;
}

export interface TurnPluginOptions {
  turnService: TurnService;
}

function getWorkspaceId(params: unknown): string {
  const workspaceId = (params as { workspaceId?: unknown }).workspaceId;
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new WorkspaceRuntimeError("workspaceId path parameter is required");
  }
  return workspaceId;
}

export const turnPlugin: FastifyPluginAsync<TurnPluginOptions> = async (app, options) => {
  const { turnService } = options;

  app.post("/api/workspaces/:workspaceId/turns/start", async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request.params);
      const result = await turnService.turnStart(workspaceId, (request.body as TurnBodyRequest) ?? {});
      return reply.code(200).send({ result });
    } catch (error: unknown) {
      return handleTurnError(request, reply, error);
    }
  });

  app.post("/api/workspaces/:workspaceId/turns/steer", async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request.params);
      const result = await turnService.turnSteer(workspaceId, (request.body as TurnBodyRequest) ?? {});
      return reply.code(200).send({ result });
    } catch (error: unknown) {
      return handleTurnError(request, reply, error);
    }
  });

  app.post("/api/workspaces/:workspaceId/turns/interrupt", async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request.params);
      const result = await turnService.turnInterrupt(workspaceId, (request.body as TurnBodyRequest) ?? {});
      return reply.code(200).send({ result });
    } catch (error: unknown) {
      return handleTurnError(request, reply, error);
    }
  });
};

function handleTurnError(
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

  request.log.error({ err: error }, "turn route failed");
  return reply.code(500).send({
    error: "internal_error",
    message: "Turn request failed"
  });
}
