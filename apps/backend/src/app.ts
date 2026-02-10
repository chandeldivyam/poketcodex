import Fastify, { type FastifyInstance } from "fastify";

export interface BuildAppOptions {
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });

  app.get("/api/health", async () => {
    return {
      status: "ok",
      service: "poketcodex-backend",
      timestamp: new Date().toISOString()
    };
  });

  return app;
}
