import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

import {
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  type JsonRpcErrorObject,
  type JsonRpcId,
  type JsonRpcResponse
} from "./json-rpc.js";
import type { InitializeParams, InitializeResult } from "./protocol.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_STOP_TIMEOUT_MS = 2_000;

export type AppServerState = "stopped" | "starting" | "ready" | "degraded" | "restarting";

export interface AppServerSpawnOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface AppServerManagerOptions {
  spawn?: AppServerSpawnOptions;
  defaultInitializeParams?: InitializeParams;
  defaultRequestTimeoutMs?: number;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
}

export interface AppServerRequestOptions {
  timeoutMs?: number;
}

export interface ServerNotificationEvent {
  method: string;
  params?: unknown;
}

export interface ServerRequestEvent {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface StaleResponseEvent {
  id: JsonRpcId | null;
  message: JsonRpcResponse;
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: NodeJS.Timeout;
}

export class AppServerManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppServerManagerError";
  }
}

export class AppServerProtocolError extends AppServerManagerError {
  constructor(message: string) {
    super(message);
    this.name = "AppServerProtocolError";
  }
}

export class AppServerTimeoutError extends AppServerManagerError {
  constructor(method: string, timeoutMs: number) {
    super(`Request '${method}' timed out after ${timeoutMs}ms`);
    this.name = "AppServerTimeoutError";
  }
}

export class AppServerRpcError extends AppServerManagerError {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(`RPC error ${code}: ${message}`);
    this.name = "AppServerRpcError";
    this.code = code;
    this.data = data;
  }
}

export class AppServerProcessError extends AppServerManagerError {
  constructor(message: string) {
    super(message);
    this.name = "AppServerProcessError";
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export class AppServerManager extends EventEmitter {
  private readonly options: AppServerManagerOptions;
  private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private childProcess: ChildProcessWithoutNullStreams | undefined;
  private lineReader: ReadlineInterface | undefined;
  private exitPromise: Promise<void> | undefined;
  private processStopping = false;
  private state: AppServerState = "stopped";
  private nextRequestId = 1;

  constructor(options: AppServerManagerOptions = {}) {
    super();
    this.options = options;
  }

  getState(): AppServerState {
    return this.state;
  }

  isReady(): boolean {
    return this.state === "ready";
  }

  getPid(): number | undefined {
    return this.childProcess?.pid;
  }

  async start(initializeParams?: InitializeParams): Promise<InitializeResult> {
    if (this.state !== "stopped") {
      throw new AppServerManagerError(`Cannot start app-server while in '${this.state}' state`);
    }

    this.setState("starting");
    this.processStopping = false;
    this.spawnProcess();

    try {
      const initializeResult = await this.sendRequestInternal<InitializeResult>("initialize", {
        params:
          initializeParams ??
          this.options.defaultInitializeParams ?? {
            clientInfo: {
              name: "poketcodex-backend",
              version: "0.1.0"
            }
          },
        timeoutMs: this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
        allowBeforeReady: true
      });

      this.sendNotification("initialized", {});
      this.setState("ready");
      return initializeResult;
    } catch (error: unknown) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state === "stopped") {
      return;
    }

    this.processStopping = true;

    const childProcess = this.childProcess;
    if (!childProcess) {
      this.setState("stopped");
      return;
    }

    childProcess.kill("SIGTERM");

    const stopTimeoutMs = this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    if (this.exitPromise) {
      await Promise.race([this.exitPromise, delay(stopTimeoutMs)]);
    }

    if (this.childProcess) {
      this.childProcess.kill("SIGKILL");
      if (this.exitPromise) {
        await this.exitPromise;
      }
    }

    this.setState("stopped");
  }

  async request<TResult>(
    method: string,
    params?: unknown,
    options: AppServerRequestOptions = {}
  ): Promise<TResult> {
    return await this.sendRequestInternal<TResult>(method, {
      params,
      timeoutMs: options.timeoutMs ?? this.options.defaultRequestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      allowBeforeReady: false
    });
  }

  sendNotification(method: string, params?: unknown): void {
    this.writeMessage({
      method,
      ...(params === undefined ? {} : { params })
    });
  }

  respondToServerRequest(
    id: JsonRpcId,
    payload: { result: unknown } | { error: JsonRpcErrorObject }
  ): void {
    this.writeMessage({
      id,
      ...payload
    });
  }

  private spawnProcess(): void {
    const spawnOptions = this.options.spawn ?? {
      command: "codex",
      args: ["app-server", "--listen", "stdio://"]
    };

    const childProcess = spawn(spawnOptions.command, spawnOptions.args ?? [], {
      cwd: spawnOptions.cwd,
      env: spawnOptions.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.childProcess = childProcess;
    this.exitPromise = new Promise<void>((resolve) => {
      childProcess.once("exit", () => {
        resolve();
      });
    });

    const lineReader = createInterface({
      input: childProcess.stdout
    });

    this.lineReader = lineReader;
    lineReader.on("line", (line) => {
      this.handleStdoutLine(line);
    });

    childProcess.stderr.setEncoding("utf8");
    childProcess.stderr.on("data", (chunk: string | Buffer) => {
      this.emit("stderr", chunk.toString());
    });

    childProcess.on("error", (error: Error) => {
      this.rejectPendingRequests(new AppServerProcessError(`App-server process error: ${error.message}`));
      if (!this.processStopping) {
        this.setState("degraded");
      }
    });

    childProcess.on("exit", (code, signal) => {
      this.lineReader?.close();
      this.lineReader = undefined;
      this.childProcess = undefined;

      if (this.pendingRequests.size > 0) {
        this.rejectPendingRequests(
          new AppServerProcessError(`App-server exited while requests were pending (code=${code}, signal=${signal})`)
        );
      }

      if (!this.processStopping) {
        this.setState("degraded");
      }
    });
  }

  private handleStdoutLine(line: string): void {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      return;
    }

    let parsedMessage: unknown;
    try {
      parsedMessage = JSON.parse(trimmedLine);
    } catch {
      this.emit("stderr", `Invalid JSON from app-server: ${trimmedLine}`);
      return;
    }

    if (isJsonRpcResponse(parsedMessage)) {
      this.handleResponse(parsedMessage);
      return;
    }

    if (isJsonRpcRequest(parsedMessage)) {
      this.emit("serverRequest", {
        id: parsedMessage.id,
        method: parsedMessage.method,
        params: parsedMessage.params
      } satisfies ServerRequestEvent);
      return;
    }

    if (isJsonRpcNotification(parsedMessage)) {
      this.emit("notification", {
        method: parsedMessage.method,
        params: parsedMessage.params
      } satisfies ServerNotificationEvent);
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    if (response.id === null) {
      this.emit("staleResponse", {
        id: response.id,
        message: response
      } satisfies StaleResponseEvent);
      return;
    }

    const pendingRequest = this.pendingRequests.get(response.id);
    if (!pendingRequest) {
      this.emit("staleResponse", {
        id: response.id,
        message: response
      } satisfies StaleResponseEvent);
      return;
    }

    this.pendingRequests.delete(response.id);
    clearTimeout(pendingRequest.timeout);

    if (isJsonRpcErrorResponse(response)) {
      pendingRequest.reject(new AppServerRpcError(response.error.code, response.error.message, response.error.data));
      return;
    }

    pendingRequest.resolve(response.result);
  }

  private async sendRequestInternal<TResult>(
    method: string,
    options: {
      params?: unknown;
      timeoutMs: number;
      allowBeforeReady: boolean;
    }
  ): Promise<TResult> {
    if (!options.allowBeforeReady && this.state !== "ready") {
      throw new AppServerProtocolError(
        `Cannot call '${method}' while app-server is '${this.state}'. Initialize first.`
      );
    }

    const requestId = this.allocateRequestId();
    const requestPayload = {
      id: requestId,
      method,
      ...(options.params === undefined ? {} : { params: options.params })
    };

    const requestPromise = new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new AppServerTimeoutError(method, options.timeoutMs));
      }, options.timeoutMs);

      this.pendingRequests.set(requestId, {
        method,
        resolve: (value) => {
          resolve(value as TResult);
        },
        reject,
        timeout
      });
    });

    try {
      this.writeMessage(requestPayload);
    } catch (error: unknown) {
      const pendingRequest = this.pendingRequests.get(requestId);
      if (pendingRequest) {
        clearTimeout(pendingRequest.timeout);
        this.pendingRequests.delete(requestId);
      }
      throw error;
    }

    return await requestPromise;
  }

  private allocateRequestId(): JsonRpcId {
    const maxAttempts = 10_000;
    let attempts = 0;

    while (this.pendingRequests.has(this.nextRequestId)) {
      this.nextRequestId += 1;
      attempts += 1;
      if (attempts > maxAttempts) {
        throw new AppServerManagerError("Unable to allocate request ID: pending map exhausted");
      }
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }

  private writeMessage(payload: unknown): void {
    const childProcess = this.childProcess;
    if (!childProcess || !childProcess.stdin.writable) {
      throw new AppServerProcessError("Cannot write message: app-server process is not running");
    }

    childProcess.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private rejectPendingRequests(error: Error): void {
    for (const pendingRequest of this.pendingRequests.values()) {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(error);
    }
    this.pendingRequests.clear();
  }

  private setState(nextState: AppServerState): void {
    if (this.state === nextState) {
      return;
    }

    this.state = nextState;
    this.emit("stateChanged", nextState);
  }
}
