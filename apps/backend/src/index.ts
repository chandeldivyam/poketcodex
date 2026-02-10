import { buildApp } from "./app.js";

const host = process.env.HOST ?? "127.0.0.1";
const rawPort = process.env.PORT ?? "8787";
const port = Number.parseInt(rawPort, 10);

if (Number.isNaN(port)) {
  throw new Error(`Invalid PORT value: ${rawPort}`);
}

const app = buildApp();

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app
  .listen({ host, port })
  .then(() => {
    app.log.info({ host, port }, "backend started");
  })
  .catch((error: unknown) => {
    app.log.error(error, "failed to start backend");
    process.exit(1);
  });
