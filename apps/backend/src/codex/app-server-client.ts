import type { AppServerManager, AppServerRequestOptions } from "./app-server-manager.js";
import type {
  ReviewStartParams,
  ReviewStartResult,
  ThreadArchiveParams,
  ThreadArchiveResult,
  ThreadListParams,
  ThreadListResult,
  ThreadReadParams,
  ThreadReadResult,
  ThreadResumeParams,
  ThreadResumeResult,
  ThreadStartParams,
  ThreadStartResult,
  TurnInterruptParams,
  TurnInterruptResult,
  TurnStartParams,
  TurnStartResult,
  TurnSteerParams,
  TurnSteerResult
} from "./protocol.js";

export class AppServerClient {
  constructor(private readonly manager: AppServerManager) {}

  async threadStart(
    params: ThreadStartParams,
    options?: AppServerRequestOptions
  ): Promise<ThreadStartResult> {
    return await this.manager.request<ThreadStartResult>("thread/start", params, options);
  }

  async threadResume(
    params: ThreadResumeParams,
    options?: AppServerRequestOptions
  ): Promise<ThreadResumeResult> {
    return await this.manager.request<ThreadResumeResult>("thread/resume", params, options);
  }

  async threadList(
    params: ThreadListParams,
    options?: AppServerRequestOptions
  ): Promise<ThreadListResult> {
    return await this.manager.request<ThreadListResult>("thread/list", params, options);
  }

  async threadRead(
    params: ThreadReadParams,
    options?: AppServerRequestOptions
  ): Promise<ThreadReadResult> {
    return await this.manager.request<ThreadReadResult>("thread/read", params, options);
  }

  async threadArchive(
    params: ThreadArchiveParams,
    options?: AppServerRequestOptions
  ): Promise<ThreadArchiveResult> {
    return await this.manager.request<ThreadArchiveResult>("thread/archive", params, options);
  }

  async turnStart(params: TurnStartParams, options?: AppServerRequestOptions): Promise<TurnStartResult> {
    return await this.manager.request<TurnStartResult>("turn/start", params, options);
  }

  async turnSteer(params: TurnSteerParams, options?: AppServerRequestOptions): Promise<TurnSteerResult> {
    return await this.manager.request<TurnSteerResult>("turn/steer", params, options);
  }

  async turnInterrupt(
    params: TurnInterruptParams,
    options?: AppServerRequestOptions
  ): Promise<TurnInterruptResult> {
    return await this.manager.request<TurnInterruptResult>("turn/interrupt", params, options);
  }

  async reviewStart(
    params: ReviewStartParams,
    options?: AppServerRequestOptions
  ): Promise<ReviewStartResult> {
    return await this.manager.request<ReviewStartResult>("review/start", params, options);
  }
}
