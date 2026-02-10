import { buildApp } from "./app.js";
import { loadConfig, redactConfig, type AppConfig } from "./config.js";
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
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const config = loadConfig(options.env);
  const workspaceStore = new WorkspaceStore(config.sqliteDatabasePath);
  const workspaceService = new WorkspaceService(workspaceStore, config.allowedWorkspaceRoots);
  const app = buildApp({
    logger: options.logger ?? true,
    logLevel: config.logLevel,
    authConfig: config,
    workspaceService
  });

  let address: string;
  try {
    address = await app.listen({ host: config.host, port: config.port });
  } catch (error: unknown) {
    workspaceStore.close();
    throw error;
  }

  app.log.info({ address, config: redactConfig(config) }, "backend started");

  return {
    config,
    address,
    async close() {
      await app.close();
      workspaceStore.close();
    }
  };
}
