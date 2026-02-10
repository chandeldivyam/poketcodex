import { randomBytes } from "node:crypto";

export interface SessionRecord {
  id: string;
  createdAt: number;
  expiresAt: number;
}

export class InMemorySessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  createSession(ttlMinutes: number): SessionRecord {
    const createdAt = this.now();
    const expiresAt = createdAt + ttlMinutes * 60_000;
    const session: SessionRecord = {
      id: randomBytes(24).toString("base64url"),
      createdAt,
      expiresAt
    };

    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): SessionRecord | null {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    if (session.expiresAt <= this.now()) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  pruneExpired(): number {
    let removedCount = 0;

    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt <= this.now()) {
        this.sessions.delete(sessionId);
        removedCount += 1;
      }
    }

    return removedCount;
  }
}
