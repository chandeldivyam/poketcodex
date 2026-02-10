import type { WorkspaceAppServerPool } from "../codex/workspace-app-server-pool.js";
import type { ThreadMetadataRecord, ThreadMetadataStore } from "./metadata-store.js";
import { normalizeThreadSummaries } from "./normalization.js";

export class ThreadService {
  constructor(
    private readonly runtimePool: WorkspaceAppServerPool,
    private readonly metadataStore: ThreadMetadataStore
  ) {}

  async threadStart(workspaceId: string, params: Record<string, unknown>): Promise<unknown> {
    const client = await this.runtimePool.getClient(workspaceId);
    const result = await client.threadStart(params);
    this.syncMetadataFromPayload(workspaceId, result);
    return result;
  }

  async threadResume(workspaceId: string, params: Record<string, unknown>): Promise<unknown> {
    const client = await this.runtimePool.getClient(workspaceId);
    const result = await client.threadResume(params);
    this.syncMetadataFromPayload(workspaceId, result);
    return result;
  }

  async threadList(workspaceId: string, params: Record<string, unknown>): Promise<{
    remote: unknown;
    metadata: ThreadMetadataRecord[];
  }> {
    const client = await this.runtimePool.getClient(workspaceId);
    const remoteResult = await client.threadList(params);
    this.syncMetadataFromPayload(workspaceId, remoteResult);

    return {
      remote: remoteResult,
      metadata: this.metadataStore.listByWorkspace(workspaceId)
    };
  }

  async threadRead(workspaceId: string, params: Record<string, unknown>): Promise<unknown> {
    const client = await this.runtimePool.getClient(workspaceId);
    const result = await client.threadRead(params);
    this.syncMetadataFromPayload(workspaceId, result);
    return result;
  }

  async threadArchive(workspaceId: string, params: Record<string, unknown>): Promise<unknown> {
    const client = await this.runtimePool.getClient(workspaceId);
    const result = await client.threadArchive(params);
    this.syncMetadataFromPayload(workspaceId, result, true);

    const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
    if (threadId) {
      this.metadataStore.markArchived(workspaceId, threadId);
    }

    return result;
  }

  private syncMetadataFromPayload(workspaceId: string, payload: unknown, forceArchived = false): void {
    const summaries = normalizeThreadSummaries(payload);
    for (const summary of summaries) {
      const archived = forceArchived ? true : summary.archived;
      this.metadataStore.upsert({
        threadId: summary.threadId,
        workspaceId,
        rawPayload: summary.rawPayload,
        ...(summary.title === undefined ? {} : { title: summary.title }),
        ...(archived === undefined ? {} : { archived })
      });
    }
  }
}
