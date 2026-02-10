import type { WorkspaceAppServerPool } from "../codex/workspace-app-server-pool.js";

export class TurnService {
  constructor(private readonly runtimePool: WorkspaceAppServerPool) {}

  async turnStart(workspaceId: string, params: Record<string, unknown>): Promise<unknown> {
    const client = await this.runtimePool.getClient(workspaceId);
    return await client.turnStart(params);
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
