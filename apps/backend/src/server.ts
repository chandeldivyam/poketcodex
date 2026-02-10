import { buildApp } from "./app.js";
import type { AppServerManagerFactory } from "./codex/workspace-app-server-pool.js";
import { WorkspaceAppServerPool } from "./codex/workspace-app-server-pool.js";
import { loadConfig, redactConfig, type AppConfig } from "./config.js";
import { ThreadMetadataStore } from "./threads/metadata-store.js";
import { ThreadService } from "./threads/service.js";
import { TurnService } from "./turns/service.js";
import { WorkspaceService } from "./workspaces/service.js";
import { WorkspaceStore } from "./workspaces/store.js";

export interface RunningServer {
  readonly config: AppConfig;
  readonly address: string;
  close(): Promise<void>;
}

export interface StartServerOptions {
  env?: NodeJS.ProcessEnv;
  logger?: boolean;
  appServerManagerFactory?: AppServerManagerFactory;
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const config = loadConfig(options.env);
  const workspaceStore = new WorkspaceStore(config.sqliteDatabasePath);
  const workspaceService = new WorkspaceService(workspaceStore, config.allowedWorkspaceRoots);
  const workspaceRuntimePool = new WorkspaceAppServerPool({
    workspaceStore,
    ...(options.appServerManagerFactory ? { managerFactory: options.appServerManagerFactory } : {})
  });
  const threadMetadataStore = new ThreadMetadataStore(config.sqliteDatabasePath);
  const threadService = new ThreadService(workspaceRuntimePool, threadMetadataStore);
  const turnService = new TurnService(workspaceRuntimePool);
  const app = buildApp({
    logger: options.logger ?? true,
    logLevel: config.logLevel,
    authConfig: config,
    workspaceService,
    threadService,
    turnService,
    runtimePool: workspaceRuntimePool
  });

  let address: string;
  try {
    address = await app.listen({ host: config.host, port: config.port });
  } catch (error: unknown) {
    await workspaceRuntimePool.stopAll().catch(() => undefined);
    threadMetadataStore.close();
    workspaceStore.close();
    throw error;
  }

  app.log.info({ address, config: redactConfig(config) }, "backend started");

  return {
    config,
    address,
    async close() {
      await app.close();
      await workspaceRuntimePool.stopAll();
      threadMetadataStore.close();
      workspaceStore.close();
    }
  };
}
