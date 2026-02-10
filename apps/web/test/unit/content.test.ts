import { describe, expect, it } from "vitest";

import { appSubtitle } from "../../src/lib/content.js";

describe("appSubtitle", () => {
  it("returns non-empty content", () => {
    expect(appSubtitle()).toContain("Codex");
  });
});
