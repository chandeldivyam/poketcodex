import path from "node:path";

import { validateWorkspacePath } from "./path-guard.js";
import type { WorkspaceStore, WorkspaceRecord } from "./store.js";

export class WorkspaceService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly allowedRoots: string[]
  ) {}

  listWorkspaces(): WorkspaceRecord[] {
    return this.store.list();
  }

  createWorkspace(input: {
    absolutePath: string;
    displayName?: string;
    trusted?: boolean;
  }): WorkspaceRecord {
    const validation = validateWorkspacePath(input.absolutePath, this.allowedRoots);
    const displayName = input.displayName?.trim() || path.basename(validation.canonicalPath);

    return this.store.create({
      absolutePath: validation.canonicalPath,
      displayName,
      trusted: input.trusted ?? true
    });
  }

  deleteWorkspace(workspaceId: string): boolean {
    return this.store.delete(workspaceId);
  }
}
