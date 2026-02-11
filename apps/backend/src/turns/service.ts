import { AppServerRpcError } from "../codex/app-server-manager.js";
import type { WorkspaceAppServerPool } from "../codex/workspace-app-server-pool.js";

export class TurnService {
  constructor(private readonly runtimePool: WorkspaceAppServerPool) {}

  async turnStart(workspaceId: string, params: Record<string, unknown>): Promise<unknown> {
    const client = await this.runtimePool.getClient(workspaceId);
    const threadId = getThreadId(params);

    try {
      return await client.turnStart(params);
    } catch (error: unknown) {
      if (!threadId || !isThreadNotFoundError(error)) {
        throw error;
      }

      await client.threadResume({ threadId });
      return await client.turnStart(params);
    }
  }

  async turnSteer(workspaceId: string, params: Record<string, unknown>): Promise<unknown> {
    const client = await this.runtimePool.getClient(workspaceId);
    return await client.turnSteer(params);
  }

  async turnInterrupt(workspaceId: string, params: Record<string, unknown>): Promise<unknown> {
    const client = await this.runtimePool.getClient(workspaceId);
    return await client.turnInterrupt(params);
  }
}

function getThreadId(params: Record<string, unknown>): string | null {
  const directThreadId = params.threadId;
  if (typeof directThreadId === "string" && directThreadId.length > 0) {
    return directThreadId;
  }

  const snakeCaseThreadId = params.thread_id;
  if (typeof snakeCaseThreadId === "string" && snakeCaseThreadId.length > 0) {
    return snakeCaseThreadId;
  }

  return null;
}

function isThreadNotFoundError(error: unknown): boolean {
  return error instanceof AppServerRpcError && error.code === -32600 && /thread not found/i.test(error.message);
}
