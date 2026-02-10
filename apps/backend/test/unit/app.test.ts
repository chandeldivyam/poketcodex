import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";

describe("buildApp", () => {
  let app = buildApp({ logger: false });

  afterEach(async () => {
    await app.close();
    app = buildApp({ logger: false });
  });

  it("serves the health endpoint", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "poketcodex-backend"
    });
  });
});
