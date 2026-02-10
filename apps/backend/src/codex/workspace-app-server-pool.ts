import { AppServerClient } from "./app-server-client.js";
import { AppServerManager } from "./app-server-manager.js";
import type { AppServerState } from "./app-server-manager.js";
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

export type WorkspaceRuntimeEventKind =
  | "notification"
  | "serverRequest"
  | "staleResponse"
  | "stateChanged"
  | "stderr";

export interface WorkspaceRuntimeEvent {
  workspaceId: string;
  sequence: number;
  timestamp: string;
  kind: WorkspaceRuntimeEventKind;
  payload: unknown;
}

interface WorkspaceRuntimeEntry {
  manager: AppServerManager;
  client: AppServerClient;
  startPromise: Promise<void> | undefined;
  disposeManagerListeners: () => void;
}

export interface WorkspaceAppServerPoolOptions {
  workspaceStore: WorkspaceStore;
  managerFactory?: AppServerManagerFactory;
}

export class WorkspaceAppServerPool {
  private readonly workspaceStore: WorkspaceStore;
  private readonly managerFactory: AppServerManagerFactory;
  private readonly runtimes = new Map<string, WorkspaceRuntimeEntry>();
  private readonly runtimeEventListeners = new Set<(event: WorkspaceRuntimeEvent) => void>();
  private readonly runtimeSequenceByWorkspace = new Map<string, number>();

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
    const runtimeEntry = this.getOrCreateRuntimeEntry(workspaceId);

    try {
      await this.ensureRuntimeReady(runtimeEntry);
      return runtimeEntry.client;
    } catch (error: unknown) {
      this.runtimes.delete(workspaceId);
      runtimeEntry.disposeManagerListeners();
      await runtimeEntry.manager.stop().catch(() => undefined);
      throw new WorkspaceRuntimeError(
        error instanceof Error ? `Failed to start workspace runtime: ${error.message}` : "Failed to start workspace runtime"
      );
    }
  }

  workspaceExists(workspaceId: string): boolean {
    return this.workspaceStore.getById(workspaceId) !== null;
  }

  subscribeToRuntimeEvents(listener: (event: WorkspaceRuntimeEvent) => void): () => void {
    this.runtimeEventListeners.add(listener);
    return () => {
      this.runtimeEventListeners.delete(listener);
    };
  }

  async stopAll(): Promise<void> {
    const stopTasks = [...this.runtimes.values()].map(async (runtime) => {
      runtime.disposeManagerListeners();
      await runtime.manager.stop();
    });
    this.runtimes.clear();
    this.runtimeSequenceByWorkspace.clear();
    await Promise.all(stopTasks);
  }

  private getOrCreateRuntimeEntry(workspaceId: string): WorkspaceRuntimeEntry {
    const existingRuntime = this.runtimes.get(workspaceId);
    if (existingRuntime) {
      return existingRuntime;
    }

    const workspace = this.workspaceStore.getById(workspaceId);
    if (!workspace) {
      throw new WorkspaceNotFoundError(workspaceId);
    }

    const manager = this.managerFactory(workspace);
    const entry: WorkspaceRuntimeEntry = {
      manager,
      client: new AppServerClient(manager),
      startPromise: undefined,
      disposeManagerListeners: () => undefined
    };
    entry.disposeManagerListeners = this.attachManagerListeners(workspaceId, manager);
    this.runtimes.set(workspaceId, entry);

    return entry;
  }

  private async ensureRuntimeReady(entry: WorkspaceRuntimeEntry): Promise<void> {
    if (entry.manager.isReady()) {
      return;
    }

    if (!entry.startPromise) {
      entry.startPromise = entry.manager.start().then(() => undefined);
      entry.startPromise.finally(() => {
        entry.startPromise = undefined;
      });
    }

    await entry.startPromise;
  }

  private attachManagerListeners(workspaceId: string, manager: AppServerManager): () => void {
    const notificationListener = (payload: unknown) => {
      this.emitRuntimeEvent(workspaceId, "notification", payload);
    };
    const serverRequestListener = (payload: unknown) => {
      this.emitRuntimeEvent(workspaceId, "serverRequest", payload);
    };
    const staleResponseListener = (payload: unknown) => {
      this.emitRuntimeEvent(workspaceId, "staleResponse", payload);
    };
    const stderrListener = (payload: unknown) => {
      this.emitRuntimeEvent(workspaceId, "stderr", payload);
    };
    const stateChangedListener = (payload: AppServerState) => {
      this.emitRuntimeEvent(workspaceId, "stateChanged", payload);
    };

    manager.on("notification", notificationListener);
    manager.on("serverRequest", serverRequestListener);
    manager.on("staleResponse", staleResponseListener);
    manager.on("stderr", stderrListener);
    manager.on("stateChanged", stateChangedListener);

    return () => {
      manager.off("notification", notificationListener);
      manager.off("serverRequest", serverRequestListener);
      manager.off("staleResponse", staleResponseListener);
      manager.off("stderr", stderrListener);
      manager.off("stateChanged", stateChangedListener);
    };
  }

  private emitRuntimeEvent(workspaceId: string, kind: WorkspaceRuntimeEventKind, payload: unknown): void {
    const sequence = this.nextSequence(workspaceId);
    const event: WorkspaceRuntimeEvent = {
      workspaceId,
      sequence,
      timestamp: new Date().toISOString(),
      kind,
      payload
    };

    for (const listener of this.runtimeEventListeners) {
      listener(event);
    }
  }

  private nextSequence(workspaceId: string): number {
    const sequence = (this.runtimeSequenceByWorkspace.get(workspaceId) ?? 0) + 1;
    this.runtimeSequenceByWorkspace.set(workspaceId, sequence);
    return sequence;
  }
}
