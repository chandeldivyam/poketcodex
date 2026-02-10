import { ConfigValidationError } from "./config.js";
import { startServer } from "./server.js";

async function main(): Promise<void> {
  const runningServer = await startServer();

  const shutdown = async (): Promise<void> => {
    await runningServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigValidationError) {
    console.error(error.message);
  } else if (error instanceof Error) {
    console.error(`Startup failed: ${error.message}`);
  } else {
    console.error("Startup failed with an unknown error");
  }

  process.exit(1);
});
