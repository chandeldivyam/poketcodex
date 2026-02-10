import { describe, expect, it } from "vitest";

import { normalizeDisplayName } from "../../src/index.js";

describe("normalizeDisplayName", () => {
  it("trims and condenses whitespace", () => {
    expect(normalizeDisplayName("   Pocket   Codex   ")).toBe("Pocket Codex");
  });
});
