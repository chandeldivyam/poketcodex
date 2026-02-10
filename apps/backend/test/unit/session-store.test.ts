import { describe, expect, it } from "vitest";

import { InMemorySessionStore } from "../../src/auth/session-store.js";

describe("InMemorySessionStore", () => {
  it("creates and resolves active sessions", () => {
    const store = new InMemorySessionStore(() => 1_000);
    const session = store.createSession(5);

    const resolvedSession = store.getSession(session.id);

    expect(resolvedSession).not.toBeNull();
    expect(resolvedSession?.id).toBe(session.id);
  });

  it("expires sessions deterministically", () => {
    let now = 1_000;
    const store = new InMemorySessionStore(() => now);
    const session = store.createSession(1);

    now += 61_000;

    expect(store.getSession(session.id)).toBeNull();
  });
});
