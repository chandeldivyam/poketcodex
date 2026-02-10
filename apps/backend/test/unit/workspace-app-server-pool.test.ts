import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AppServerManager } from "../../src/codex/app-server-manager.js";
import {
  WorkspaceAppServerPool,
  WorkspaceNotFoundError
} from "../../src/codex/workspace-app-server-pool.js";
import { WorkspaceStore } from "../../src/workspaces/store.js";

describe("WorkspaceAppServerPool", () => {
  const cleanupTargets: string[] = [];
  const stores: WorkspaceStore[] = [];
  const pools: WorkspaceAppServerPool[] = [];

  afterEach(async () => {
    await Promise.all(
      pools.splice(0).map(async (pool) => {
        await pool.stopAll();
      })
    );

    for (const store of stores.splice(0)) {
      store.close();
    }

    for (const target of cleanupTargets.splice(0)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("starts runtime for an existing workspace and returns client", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "poketcodex-runtime-pool-"));
    cleanupTargets.push(tempRoot);
    const workspacePath = path.join(tempRoot, "workspace-a");
    fs.mkdirSync(workspacePath, { recursive: true });

    const workspaceStore = new WorkspaceStore(":memory:");
    stores.push(workspaceStore);
    const workspace = workspaceStore.create({
      absolutePath: workspacePath,
      displayName: "Workspace A",
      trusted: true
    });

    const fakeServerPath = path.resolve(process.cwd(), "test/fixtures/fake-app-server.ts");
    const pool = new WorkspaceAppServerPool({
      workspaceStore,
      managerFactory: () => {
        return new AppServerManager({
          spawn: {
            command: process.execPath,
            args: ["--import", "tsx", fakeServerPath],
            cwd: process.cwd()
          }
        });
      }
    });
    pools.push(pool);

    const client = await pool.getClient(workspace.workspaceId);
    const listResult = await client.threadList({});

    expect(Array.isArray((listResult as { threads?: unknown[] }).threads)).toBe(true);
  });

  it("throws workspace not found for unknown workspace ids", async () => {
    const workspaceStore = new WorkspaceStore(":memory:");
    stores.push(workspaceStore);

    const pool = new WorkspaceAppServerPool({
      workspaceStore
    });
    pools.push(pool);

    await expect(pool.getClient("missing")).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });
});
