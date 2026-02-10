import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";

describe("health endpoint integration", () => {
  it("responds with 200 over an actual network listener", async () => {
    const app = buildApp({ logger: false });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`${address}/api/health`);
      const body = (await response.json()) as { status?: string };

      expect(response.status).toBe(200);
      expect(body.status).toBe("ok");
    } finally {
      await app.close();
    }
  });
});
