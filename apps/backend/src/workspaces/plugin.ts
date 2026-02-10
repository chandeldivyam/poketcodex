import type { FastifyPluginAsync } from "fastify";

import { WorkspacePathValidationError } from "./path-guard.js";
import type { WorkspaceService } from "./service.js";
import { DuplicateWorkspacePathError, WorkspaceStoreError } from "./store.js";

interface WorkspaceRequestBody {
  absolutePath?: unknown;
  displayName?: unknown;
  trusted?: unknown;
}

export interface WorkspacePluginOptions {
  workspaceService: WorkspaceService;
}

function parseCreateWorkspaceBody(body: WorkspaceRequestBody | undefined): {
  absolutePath: string;
  displayName?: string;
  trusted?: boolean;
} {
  if (!body || typeof body.absolutePath !== "string") {
    throw new WorkspacePathValidationError("absolutePath must be provided as a string");
  }

  if (body.displayName !== undefined && typeof body.displayName !== "string") {
    throw new WorkspacePathValidationError("displayName must be a string when provided");
  }

  if (body.trusted !== undefined && typeof body.trusted !== "boolean") {
    throw new WorkspacePathValidationError("trusted must be a boolean when provided");
  }

  return {
    absolutePath: body.absolutePath,
    ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
    ...(body.trusted === undefined ? {} : { trusted: body.trusted })
  };
}

export const workspacePlugin: FastifyPluginAsync<WorkspacePluginOptions> = async (app, options) => {
  const { workspaceService } = options;

  app.get("/api/workspaces", async () => {
    return {
      workspaces: workspaceService.listWorkspaces()
    };
  });

  app.post("/api/workspaces", async (request, reply) => {
    try {
      const input = parseCreateWorkspaceBody(request.body as WorkspaceRequestBody | undefined);
      const workspace = workspaceService.createWorkspace(input);

      return reply.code(201).send({
        workspace
      });
    } catch (error: unknown) {
      if (error instanceof WorkspacePathValidationError) {
        return reply.code(400).send({
          error: "bad_request",
          message: error.message
        });
      }

      if (error instanceof DuplicateWorkspacePathError) {
        return reply.code(409).send({
          error: "conflict",
          message: error.message
        });
      }

      if (error instanceof WorkspaceStoreError) {
        request.log.error({ err: error }, "workspace store error");
        return reply.code(500).send({
          error: "internal_error",
          message: "Failed to create workspace"
        });
      }

      throw error;
    }
  });

  app.delete("/api/workspaces/:workspaceId", async (request, reply) => {
    const workspaceId = (request.params as { workspaceId?: string }).workspaceId;
    if (!workspaceId) {
      return reply.code(400).send({
        error: "bad_request",
        message: "workspaceId path parameter is required"
      });
    }

    const deleted = workspaceService.deleteWorkspace(workspaceId);
    if (!deleted) {
      return reply.code(404).send({
        error: "not_found",
        message: `Workspace '${workspaceId}' not found`
      });
    }

    return reply.code(204).send();
  });
};
