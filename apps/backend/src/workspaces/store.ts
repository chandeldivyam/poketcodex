import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";

export interface WorkspaceRecord {
  workspaceId: string;
  absolutePath: string;
  displayName: string;
  trusted: boolean;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceRow {
  workspace_id: string;
  absolute_path: string;
  display_name: string;
  trusted: number;
  created_at: string;
  updated_at: string;
}

export class WorkspaceStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceStoreError";
  }
}

export class DuplicateWorkspacePathError extends WorkspaceStoreError {
  constructor(absolutePath: string) {
    super(`Workspace already exists for path: ${absolutePath}`);
    this.name = "DuplicateWorkspacePathError";
  }
}

function mapWorkspaceRow(row: WorkspaceRow): WorkspaceRecord {
  return {
    workspaceId: row.workspace_id,
    absolutePath: row.absolute_path,
    displayName: row.display_name,
    trusted: row.trusted === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class WorkspaceStore {
  private readonly database: DatabaseSync;
  private readonly listStatement: StatementSync;
  private readonly getByIdStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly deleteStatement: StatementSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY,
        absolute_path TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        trusted INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.listStatement = this.database.prepare(`
      SELECT workspace_id, absolute_path, display_name, trusted, created_at, updated_at
      FROM workspaces
      ORDER BY created_at DESC
    `);
    this.getByIdStatement = this.database.prepare(`
      SELECT workspace_id, absolute_path, display_name, trusted, created_at, updated_at
      FROM workspaces
      WHERE workspace_id = ?
      LIMIT 1
    `);
    this.insertStatement = this.database.prepare(`
      INSERT INTO workspaces (
        workspace_id,
        absolute_path,
        display_name,
        trusted,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.deleteStatement = this.database.prepare(`
      DELETE FROM workspaces
      WHERE workspace_id = ?
    `);
  }

  list(): WorkspaceRecord[] {
    const rows = this.listStatement.all() as unknown as WorkspaceRow[];
    return rows.map(mapWorkspaceRow);
  }

  create(input: {
    absolutePath: string;
    displayName: string;
    trusted: boolean;
  }): WorkspaceRecord {
    const now = new Date().toISOString();
    const workspaceRecord: WorkspaceRecord = {
      workspaceId: randomUUID(),
      absolutePath: input.absolutePath,
      displayName: input.displayName,
      trusted: input.trusted,
      createdAt: now,
      updatedAt: now
    };

    try {
      this.insertStatement.run(
        workspaceRecord.workspaceId,
        workspaceRecord.absolutePath,
        workspaceRecord.displayName,
        workspaceRecord.trusted ? 1 : 0,
        workspaceRecord.createdAt,
        workspaceRecord.updatedAt
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: workspaces.absolute_path")) {
        throw new DuplicateWorkspacePathError(input.absolutePath);
      }

      throw new WorkspaceStoreError(
        error instanceof Error ? `Failed to create workspace: ${error.message}` : "Failed to create workspace"
      );
    }

    return workspaceRecord;
  }

  delete(workspaceId: string): boolean {
    const result = this.deleteStatement.run(workspaceId);
    const changes = Number(result.changes ?? 0);
    return changes > 0;
  }

  getById(workspaceId: string): WorkspaceRecord | null {
    const row = this.getByIdStatement.get(workspaceId) as WorkspaceRow | undefined;
    if (!row) {
      return null;
    }

    return mapWorkspaceRow(row);
  }

  close(): void {
    this.database.close();
  }
}
