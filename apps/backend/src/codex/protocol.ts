export interface InitializeParams {
  clientInfo: {
    name: string;
    version: string;
  };
  capabilities?: {
    experimentalApi?: string[];
    [key: string]: unknown;
  };
}

export interface InitializeResult {
  serverInfo?: {
    name: string;
    version?: string;
  };
  capabilities?: Record<string, unknown>;
}

export interface ThreadStartParams {
  [key: string]: unknown;
}

export interface ThreadStartResult {
  [key: string]: unknown;
}

export interface ThreadResumeParams {
  [key: string]: unknown;
}

export interface ThreadResumeResult {
  [key: string]: unknown;
}

export interface ThreadListParams {
  [key: string]: unknown;
}

export interface ThreadListResult {
  [key: string]: unknown;
}

export interface ThreadReadParams {
  [key: string]: unknown;
}

export interface ThreadReadResult {
  [key: string]: unknown;
}

export interface ThreadArchiveParams {
  [key: string]: unknown;
}

export interface ThreadArchiveResult {
  [key: string]: unknown;
}

export interface TurnStartParams {
  [key: string]: unknown;
}

export interface TurnStartResult {
  [key: string]: unknown;
}

export interface TurnSteerParams {
  [key: string]: unknown;
}

export interface TurnSteerResult {
  [key: string]: unknown;
}

export interface TurnInterruptParams {
  [key: string]: unknown;
}

export interface TurnInterruptResult {
  [key: string]: unknown;
}

export interface ReviewStartParams {
  [key: string]: unknown;
}

export interface ReviewStartResult {
  [key: string]: unknown;
}
