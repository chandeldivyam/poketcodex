import { buildApp } from "./app.js";
import { loadConfig, redactConfig, type AppConfig } from "./config.js";

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
  const app = buildApp({
    logger: options.logger ?? true,
    logLevel: config.logLevel
  });
  const address = await app.listen({ host: config.host, port: config.port });

  app.log.info({ address, config: redactConfig(config) }, "backend started");

  return {
    config,
    address,
    async close() {
      await app.close();
    }
  };
}
