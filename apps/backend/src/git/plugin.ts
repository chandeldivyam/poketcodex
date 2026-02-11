import type { FastifyPluginAsync } from "fastify";

import type { SessionRecord } from "../auth/session-store.js";
import {
  GitCommandError,
  GitInvalidPathError,
  GitRepositoryUnavailableError,
  GitWorkspaceNotFoundError,
  type GitService
} from "./service.js";

interface GitRouteParams {
  workspaceId?: unknown;
}

interface GitDiffQueryString {
  path?: unknown;
}

interface AuthenticatedRequestLike {
  authSession?: SessionRecord;
}

export interface GitPluginOptions {
  gitService: GitService;
}

function requireWorkspaceId(params: unknown): string {
  const workspaceId = (params as GitRouteParams).workspaceId;
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new GitWorkspaceNotFoundError("unknown");
  }

  return workspaceId;
}

function requireRelativePath(query: unknown): string {
  const pathParam = (query as GitDiffQueryString).path;
  if (typeof pathParam !== "string" || pathParam.trim().length === 0) {
    throw new GitInvalidPathError(typeof pathParam === "string" ? pathParam : "");
  }

  return pathParam;
}

export const gitPlugin: FastifyPluginAsync<GitPluginOptions> = async (app, options) => {
  const { gitService } = options;

  app.get("/api/workspaces/:workspaceId/git/status", async (request, reply) => {
    try {
      const authenticatedRequest = request as AuthenticatedRequestLike;
      if (!authenticatedRequest.authSession) {
        return reply.code(401).send({
          error: "unauthorized",
          message: "Authentication is required for git status"
        });
      }

      const workspaceId = requireWorkspaceId(request.params);
      const git = await gitService.getStatus(workspaceId);
      return reply.code(200).send({
        git
      });
    } catch (error: unknown) {
      return handleGitError(request, reply, error);
    }
  });

  app.get("/api/workspaces/:workspaceId/git/diff", async (request, reply) => {
    try {
      const authenticatedRequest = request as AuthenticatedRequestLike;
      if (!authenticatedRequest.authSession) {
        return reply.code(401).send({
          error: "unauthorized",
          message: "Authentication is required for git diff"
        });
      }

      const workspaceId = requireWorkspaceId(request.params);
      const relativePath = requireRelativePath(request.query);
      const git = await gitService.getFileDiff(workspaceId, relativePath);
      return reply.code(200).send({
        git
      });
    } catch (error: unknown) {
      return handleGitError(request, reply, error);
    }
  });
};

function handleGitError(
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
  if (error instanceof GitWorkspaceNotFoundError) {
    return reply.code(404).send({
      error: "not_found",
      message: error.message
    });
  }

  if (error instanceof GitInvalidPathError) {
    return reply.code(400).send({
      error: "bad_request",
      message: error.message
    });
  }

  if (error instanceof GitRepositoryUnavailableError) {
    return reply.code(409).send({
      error: "git_unavailable",
      message: error.message
    });
  }

  if (error instanceof GitCommandError) {
    return reply.code(502).send({
      error: "upstream_error",
      message: error.message,
      details: error.stderr
    });
  }

  request.log.error({ err: error }, "git route failed");
  return reply.code(500).send({
    error: "internal_error",
    message: "Git request failed"
  });
}
