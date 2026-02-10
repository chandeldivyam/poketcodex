import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

export interface ThreadMetadataRecord {
  threadId: string;
  workspaceId: string;
  title: string | null;
  archived: boolean;
  lastSeenAt: string;
  rawPayload: unknown;
}

interface ThreadMetadataRow {
  thread_id: string;
  workspace_id: string;
  title: string | null;
  archived: number;
  last_seen_at: string;
  raw_payload: string;
}

function mapThreadMetadataRow(row: ThreadMetadataRow): ThreadMetadataRecord {
  return {
    threadId: row.thread_id,
    workspaceId: row.workspace_id,
    title: row.title,
    archived: row.archived === 1,
    lastSeenAt: row.last_seen_at,
    rawPayload: JSON.parse(row.raw_payload)
  };
}

export class ThreadMetadataStore {
  private readonly database: DatabaseSync;
  private readonly listByWorkspaceStatement: StatementSync;
  private readonly upsertStatement: StatementSync;
  private readonly archiveStatement: StatementSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS thread_metadata (
        thread_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT NOT NULL,
        raw_payload TEXT NOT NULL
      );
    `);

    this.listByWorkspaceStatement = this.database.prepare(`
      SELECT thread_id, workspace_id, title, archived, last_seen_at, raw_payload
      FROM thread_metadata
      WHERE workspace_id = ?
      ORDER BY last_seen_at DESC
    `);

    this.upsertStatement = this.database.prepare(`
      INSERT INTO thread_metadata (
        thread_id,
        workspace_id,
        title,
        archived,
        last_seen_at,
        raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id)
      DO UPDATE SET
        workspace_id = excluded.workspace_id,
        title = excluded.title,
        archived = excluded.archived,
        last_seen_at = excluded.last_seen_at,
        raw_payload = excluded.raw_payload
    `);

    this.archiveStatement = this.database.prepare(`
      UPDATE thread_metadata
      SET archived = 1, last_seen_at = ?
      WHERE thread_id = ? AND workspace_id = ?
    `);
  }

  listByWorkspace(workspaceId: string): ThreadMetadataRecord[] {
    const rows = this.listByWorkspaceStatement.all(workspaceId) as unknown as ThreadMetadataRow[];
    return rows.map(mapThreadMetadataRow);
  }

  upsert(record: {
    threadId: string;
    workspaceId: string;
    title?: string | null;
    archived?: boolean;
    rawPayload: unknown;
  }): void {
    const now = new Date().toISOString();
    this.upsertStatement.run(
      record.threadId,
      record.workspaceId,
      record.title ?? null,
      record.archived ? 1 : 0,
      now,
      JSON.stringify(record.rawPayload)
    );
  }

  markArchived(workspaceId: string, threadId: string): void {
    this.archiveStatement.run(new Date().toISOString(), threadId, workspaceId);
  }

  close(): void {
    this.database.close();
  }
}
