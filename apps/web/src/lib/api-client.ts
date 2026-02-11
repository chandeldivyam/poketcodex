export interface AuthSessionResponse {
  authenticated: boolean;
  csrfToken?: string;
  expiresAt?: string;
}

export interface WorkspaceRecord {
  workspaceId: string;
  absolutePath: string;
  displayName: string;
  trusted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadMetadataRecord {
  threadId: string;
  workspaceId: string;
  title: string | null;
  archived: boolean;
  lastSeenAt: string;
  rawPayload: unknown;
}

export interface ThreadListResponse {
  remote: unknown;
  metadata: ThreadMetadataRecord[];
}

export interface GitStatusEntryRecord {
  path: string;
  staged: string;
  unstaged: string;
  statusLabel: string;
  originalPath?: string;
}

export interface GitStatusRecord {
  enabled: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  entries: GitStatusEntryRecord[];
}

export interface GitDiffRecord {
  path: string;
  diff: string;
  isUntracked: boolean;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
}

export class ApiClientError extends Error {
  readonly statusCode: number;
  readonly payload: unknown;

  constructor(statusCode: number, message: string, payload: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  csrfToken?: string;
  timeoutMs?: number;
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      raw: text
    };
  }
}

export class ApiClient {
  constructor(private readonly basePath = "") {}

  private async request<TResponse>(path: string, options: RequestOptions = {}): Promise<TResponse> {
    const headers: Record<string, string> = {};

    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    if (options.csrfToken) {
      headers["x-csrf-token"] = options.csrfToken;
    }

    const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const requestInit: RequestInit = {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      ...(controller ? { signal: controller.signal } : {})
    };

    if (options.body !== undefined) {
      requestInit.body = JSON.stringify(options.body);
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (controller && options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        controller.abort();
      }, options.timeoutMs);
    }

    let response: Response;
    try {
      response = await fetch(`${this.basePath}${path}`, requestInit);
    } catch (error: unknown) {
      if (
        options.timeoutMs &&
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        throw new Error(`Request timed out after ${Math.ceil(options.timeoutMs / 1_000)}s`);
      }

      throw error;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }

    const payload = await parseJsonSafely(response);

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
          ? payload.message
          : `Request failed with status ${response.status}`;

      throw new ApiClientError(response.status, message, payload);
    }

    return payload as TResponse;
  }

  async login(password: string): Promise<AuthSessionResponse> {
    return await this.request<AuthSessionResponse>("/api/auth/login", {
      method: "POST",
      body: {
        password
      }
    });
  }

  async getSession(): Promise<AuthSessionResponse> {
    return await this.request<AuthSessionResponse>("/api/auth/session");
  }

  async logout(csrfToken: string): Promise<{ authenticated: boolean }> {
    return await this.request<{ authenticated: boolean }>("/api/auth/logout", {
      method: "POST",
      csrfToken
    });
  }

  async listWorkspaces(): Promise<{ workspaces: WorkspaceRecord[] }> {
    return await this.request<{ workspaces: WorkspaceRecord[] }>("/api/workspaces");
  }

  async createWorkspace(
    csrfToken: string,
    input: {
      absolutePath: string;
      displayName?: string;
      trusted?: boolean;
    }
  ): Promise<{ workspace: WorkspaceRecord }> {
    return await this.request<{ workspace: WorkspaceRecord }>("/api/workspaces", {
      method: "POST",
      csrfToken,
      body: input
    });
  }

  async deleteWorkspace(workspaceId: string, csrfToken: string): Promise<void> {
    await this.request<void>(`/api/workspaces/${workspaceId}`, {
      method: "DELETE",
      csrfToken
    });
  }

  async listThreads(workspaceId: string): Promise<ThreadListResponse> {
    return await this.request<ThreadListResponse>(`/api/workspaces/${workspaceId}/threads`);
  }

  async startThread(workspaceId: string, csrfToken: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await this.request<{ result: unknown }>(`/api/workspaces/${workspaceId}/threads/start`, {
      method: "POST",
      csrfToken,
      body: params
    });

    return response.result;
  }

  async resumeThread(workspaceId: string, csrfToken: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await this.request<{ result: unknown }>(`/api/workspaces/${workspaceId}/threads/resume`, {
      method: "POST",
      csrfToken,
      body: params
    });

    return response.result;
  }

  async readThread(workspaceId: string, csrfToken: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await this.request<{ result: unknown }>(`/api/workspaces/${workspaceId}/threads/read`, {
      method: "POST",
      csrfToken,
      body: params
    });

    return response.result;
  }

  async startTurn(
    workspaceId: string,
    csrfToken: string,
    params: Record<string, unknown>,
    options: {
      timeoutMs?: number;
    } = {}
  ): Promise<unknown> {
    const response = await this.request<{ result: unknown }>(`/api/workspaces/${workspaceId}/turns/start`, {
      method: "POST",
      csrfToken,
      body: params,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });

    return response.result;
  }

  async steerTurn(workspaceId: string, csrfToken: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await this.request<{ result: unknown }>(`/api/workspaces/${workspaceId}/turns/steer`, {
      method: "POST",
      csrfToken,
      body: params
    });

    return response.result;
  }

  async interruptTurn(workspaceId: string, csrfToken: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await this.request<{ result: unknown }>(
      `/api/workspaces/${workspaceId}/turns/interrupt`,
      {
        method: "POST",
        csrfToken,
        body: params
      }
    );

    return response.result;
  }

  async getWorkspaceGitStatus(workspaceId: string): Promise<GitStatusRecord> {
    const response = await this.request<{ git: GitStatusRecord }>(`/api/workspaces/${workspaceId}/git/status`);
    return response.git;
  }

  async getWorkspaceGitDiff(workspaceId: string, relativePath: string): Promise<GitDiffRecord> {
    const encodedPath = encodeURIComponent(relativePath);
    const response = await this.request<{ git: GitDiffRecord }>(
      `/api/workspaces/${workspaceId}/git/diff?path=${encodedPath}`
    );
    return response.git;
  }
}
