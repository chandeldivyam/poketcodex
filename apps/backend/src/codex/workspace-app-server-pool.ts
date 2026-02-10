import { AppServerClient } from "./app-server-client.js";
import { AppServerManager } from "./app-server-manager.js";
import type { WorkspaceRecord, WorkspaceStore } from "../workspaces/store.js";

export class WorkspaceRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceRuntimeError";
  }
}

export class WorkspaceNotFoundError extends WorkspaceRuntimeError {
  constructor(workspaceId: string) {
    super(`Workspace '${workspaceId}' was not found`);
    this.name = "WorkspaceNotFoundError";
  }
}

export type AppServerManagerFactory = (workspace: WorkspaceRecord) => AppServerManager;

interface WorkspaceRuntimeEntry {
  manager: AppServerManager;
  client: AppServerClient;
}

export interface WorkspaceAppServerPoolOptions {
  workspaceStore: WorkspaceStore;
  managerFactory?: AppServerManagerFactory;
}

export class WorkspaceAppServerPool {
  private readonly workspaceStore: WorkspaceStore;
  private readonly managerFactory: AppServerManagerFactory;
  private readonly runtimes = new Map<string, WorkspaceRuntimeEntry>();

  constructor(options: WorkspaceAppServerPoolOptions) {
    this.workspaceStore = options.workspaceStore;
    this.managerFactory =
      options.managerFactory ??
      ((workspace) => {
        return new AppServerManager({
          spawn: {
            command: "codex",
            args: ["app-server"],
            cwd: workspace.absolutePath
          }
        });
      });
  }

  async getClient(workspaceId: string): Promise<AppServerClient> {
    const existingRuntime = this.runtimes.get(workspaceId);
    if (existingRuntime?.manager.isReady()) {
      return existingRuntime.client;
    }

    const workspace = this.workspaceStore.getById(workspaceId);
    if (!workspace) {
      throw new WorkspaceNotFoundError(workspaceId);
    }

    const runtimeEntry =
      existingRuntime ??
      (() => {
        const manager = this.managerFactory(workspace);
        const client = new AppServerClient(manager);
        const entry: WorkspaceRuntimeEntry = { manager, client };
        this.runtimes.set(workspaceId, entry);
        return entry;
      })();

    try {
      if (!runtimeEntry.manager.isReady()) {
        await runtimeEntry.manager.start();
      }
      return runtimeEntry.client;
    } catch (error: unknown) {
      this.runtimes.delete(workspaceId);
      await runtimeEntry.manager.stop().catch(() => undefined);
      throw new WorkspaceRuntimeError(
        error instanceof Error ? `Failed to start workspace runtime: ${error.message}` : "Failed to start workspace runtime"
      );
    }
  }

  async stopAll(): Promise<void> {
    const stopTasks = [...this.runtimes.values()].map(async (runtime) => {
      await runtime.manager.stop();
    });
    this.runtimes.clear();
    await Promise.all(stopTasks);
  }
}
