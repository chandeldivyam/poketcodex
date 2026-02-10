import { afterEach, describe, expect, it } from "vitest";

import { DuplicateWorkspacePathError, WorkspaceStore } from "../../src/workspaces/store.js";

describe("WorkspaceStore", () => {
  const stores: WorkspaceStore[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }
  });

  it("creates, lists, and deletes workspace records", () => {
    const store = new WorkspaceStore(":memory:");
    stores.push(store);

    const workspace = store.create({
      absolutePath: "/tmp/workspace-a",
      displayName: "Workspace A",
      trusted: true
    });

    const listed = store.list();
    expect(listed.length).toBe(1);
    expect(listed[0]?.workspaceId).toBe(workspace.workspaceId);

    expect(store.delete(workspace.workspaceId)).toBe(true);
    expect(store.list().length).toBe(0);
  });

  it("rejects duplicate workspace absolute paths", () => {
    const store = new WorkspaceStore(":memory:");
    stores.push(store);

    store.create({
      absolutePath: "/tmp/workspace-a",
      displayName: "Workspace A",
      trusted: true
    });

    expect(() =>
      store.create({
        absolutePath: "/tmp/workspace-a",
        displayName: "Workspace A Duplicate",
        trusted: true
      })
    ).toThrow(DuplicateWorkspacePathError);
  });
});
