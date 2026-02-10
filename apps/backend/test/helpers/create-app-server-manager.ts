import path from "node:path";

import { AppServerManager, type AppServerManagerOptions } from "../../src/codex/app-server-manager.js";

export function createTestAppServerManager(
  options: Partial<AppServerManagerOptions> = {},
  envOverrides: NodeJS.ProcessEnv = {}
): AppServerManager {
  const fixturePath = path.resolve(process.cwd(), "test/fixtures/fake-app-server.ts");

  return new AppServerManager({
    defaultRequestTimeoutMs: 250,
    startupTimeoutMs: 1_000,
    ...options,
    spawn: {
      command: process.execPath,
      args: ["--import", "tsx", fixturePath],
      env: {
        ...process.env,
        ...envOverrides
      },
      ...options.spawn
    }
  });
}
