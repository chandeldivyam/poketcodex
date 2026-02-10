import websocket from "@fastify/websocket";
import type { FastifyPluginAsync } from "fastify";

import { WorkspaceNotFoundError, type WorkspaceAppServerPool } from "../codex/workspace-app-server-pool.js";
import type { SessionRecord } from "../auth/session-store.js";

const WS_OPEN_STATE = 1;

interface WorkspaceEventRouteParams {
  workspaceId?: string;
}

interface AuthenticatedRequestLike {
  authSession?: SessionRecord;
}

export interface WorkspaceEventsPluginOptions {
  runtimePool: WorkspaceAppServerPool;
}

function getWorkspaceId(params: unknown): string {
  const workspaceId = (params as WorkspaceEventRouteParams).workspaceId;
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new WorkspaceNotFoundError("unknown");
  }
  return workspaceId;
}

function createQueuedSender(socket: { readyState: number; send(data: string, callback?: (error?: Error) => void): void }) {
  let queue = Promise.resolve();

  return (payload: unknown): Promise<void> => {
    queue = queue
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            if (socket.readyState !== WS_OPEN_STATE) {
              resolve();
              return;
            }

            socket.send(JSON.stringify(payload), (error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          })
      )
      .catch(() => undefined);

    return queue;
  };
}

export const workspaceEventsPlugin: FastifyPluginAsync<WorkspaceEventsPluginOptions> = async (
  app,
  options
) => {
  const { runtimePool } = options;
  await app.register(websocket);

  app.get(
    "/api/workspaces/:workspaceId/events",
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const workspaceId = getWorkspaceId(request.params);
        const authenticatedRequest = request as AuthenticatedRequestLike;

        if (!authenticatedRequest.authSession) {
          return reply.code(401).send({
            error: "unauthorized",
            message: "Authentication is required for websocket events"
          });
        }

        if (!runtimePool.workspaceExists(workspaceId)) {
          return reply.code(404).send({
            error: "not_found",
            message: `Workspace '${workspaceId}' not found`
          });
        }
      }
    },
    async (connection, request) => {
      const workspaceId = getWorkspaceId(request.params);
      const send = createQueuedSender(connection);
      const unsubscribe = runtimePool.subscribeToRuntimeEvents((event) => {
        if (event.workspaceId !== workspaceId) {
          return;
        }

        void send({
          type: "workspace_runtime_event",
          event
        });
      });

      connection.on("close", () => {
        unsubscribe();
      });
      connection.on("error", () => {
        unsubscribe();
      });

      await send({
        type: "connected",
        workspaceId
      });
    }
  );
};
