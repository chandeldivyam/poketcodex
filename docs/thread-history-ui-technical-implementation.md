# PocketCodex Thread History + Sidebar UI

Date: 2026-02-10  
Status: Proposed technical implementation plan (research-backed, no code changes in this doc)

## 1) Objective

Implement a conversation-first UI matching the target behavior in your screenshot:

- Left rail: workspaces and threads.
- Clicking a thread: load and render full thread history.
- Sending prompt: show complete assistant messages (with streaming during generation).
- Keep existing backend process model (`auth/workspaces/threads/turns/events`).

## 2) Desired UX (from target screenshot)

1. Left navigation is the primary context switcher:
- Workspace groups.
- Threads under selected workspace.
- Visual active state, running state, unread state.

2. Main panel is a true transcript, not a raw event log:
- User and assistant message bubbles.
- Reasoning/tool cards (collapsible).
- Stable scroll behavior while streaming.

3. Composer is fixed at bottom:
- Draft preserved per `workspace + thread`.
- `Send` and `Interrupt` always reliable.
- No focus loss while events stream.

## 3) What We Verified (Concrete Findings)

### 3.1 Current backend behavior (live server at `127.0.0.1:8787`)

Observed on 2026-02-10 against your running backend:

- `POST /api/workspaces/:id/turns/start` requires both:
  - `threadId`
  - `input`

If `threadId` is missing, response is:

```json
{"error":"upstream_error","message":"RPC error -32600: Invalid request: missing field `threadId`"}
```

- `POST /api/workspaces/:id/threads/read` with only `threadId` returns `thread.turns: []` in many cases.
- `POST /api/workspaces/:id/threads/read` with `{"threadId":"...","includeTurns":true}` returns full historical turns/items.

This is critical and aligns with official protocol docs: history is populated only when `includeTurns: true`.

### 3.2 Current websocket event envelope

From `GET /api/workspaces/:workspaceId/events`, backend sends:

```json
{
  "type": "workspace_runtime_event",
  "event": {
    "workspaceId": "...",
    "sequence": 3322,
    "timestamp": "2026-02-10T18:47:08.029Z",
    "kind": "notification",
    "payload": {
      "method": "turn/started",
      "params": { "threadId": "...", "turn": { "id": "0", "status": "inProgress" } }
    }
  }
}
```

Captured turn stream included both:
- Canonical v2 notifications (`turn/*`, `item/*`, `thread/*`, `account/*`)
- Legacy/raw `codex/event/*` notifications (including `codex/event/skills_update_available` spam)

### 3.3 Official Codex protocol findings

From `codex-rs/app-server-protocol` + `codex-rs/app-server/README.md`:

- `thread/read` has `includeTurns` flag.
- `Thread.turns` is intentionally empty unless using operations that load turns (e.g. `thread/read` with `includeTurns`, `thread/resume`).
- Primary real-time stream methods for transcript UI are:
  - `turn/started`, `turn/completed`
  - `item/started`, `item/completed`
  - `item/agentMessage/delta`
  - `item/reasoning/summaryTextDelta` (and related)

### 3.4 Codex-webui and Codexia patterns worth adopting

Codex-webui pattern:
- Session switch triggers transcript hydration from persisted history endpoint.
- Delta buffering + full message finalization (`delta` then `message`).

Codexia pattern:
- Per-thread state (`itemsByThread`) and reducer-based event application.
- Separate pathways for:
  - Thread history hydration
  - Live streaming deltas
- Sidebar maintains thread-level status (`processing`, `unread`, etc.).

### 3.5 Scope note on VS Code extension source

In the local `codex` clone used for this research, the app-server protocol and TUI implementation are present, but the VS Code extension UI source itself is not directly included in this workspace.  
For extension-like behavior, this plan therefore relies on:

- official app-server protocol contracts, and
- proven open-source UI patterns from Codex-webui and Codexia.

## 4) Why Current PocketCodex UX Breaks for This Goal

1. Main panel still behaves as an event console, not transcript.
2. Thread selection does not currently hydrate historical turns into message cards.
3. `turn/start` payload may omit `threadId` if no selection, which causes upstream invalid request.
4. Thread title/preview quality is weak because metadata/remote thread info is not merged robustly.
5. Event stream includes duplicate semantic families (`item/*` and `codex/event/*`), which can cause noisy/duplicated rendering unless normalized.

## 5) Proposed Technical Design

### 5.1 Data model (frontend)

Add explicit per-thread transcript state.

```ts
export interface TranscriptItemMessage {
  kind: "message";
  id: string;
  role: "user" | "assistant";
  text: string;
  turnId?: string;
  streaming?: boolean;
}

export interface TranscriptItemReasoning {
  kind: "reasoning";
  id: string;
  summary: string;
  content: string;
  turnId?: string;
  streaming?: boolean;
}

export interface TranscriptItemTool {
  kind: "tool";
  id: string;
  title: string;
  detail?: string;
  output?: string;
  turnId?: string;
  streaming?: boolean;
}

export type TranscriptItem =
  | TranscriptItemMessage
  | TranscriptItemReasoning
  | TranscriptItemTool;

export interface ThreadTranscriptState {
  hydration: "idle" | "loading" | "loaded" | "error";
  items: TranscriptItem[];
  lastAppliedSequence: number;
  liveItemsByRuntimeItemId: Record<string, string>; // runtime itemId -> local transcript item id
}
```

```ts
export interface ThreadState {
  threads: ThreadListItem[];
  selectedThreadId: string | null;
  transcriptsByThreadId: Record<string, ThreadTranscriptState>;
  threadStatusById: Record<string, "idle" | "running" | "error">;
  unreadByThreadId: Record<string, boolean>;
}
```

### 5.2 Thread history hydration flow

On thread click:

1. Set `selectedThreadId`.
2. If transcript not loaded:
- call `threads/read` with `{ threadId, includeTurns: true }`.
3. Convert `result.thread.turns[].items[]` to `TranscriptItem[]`.
4. Replace thread transcript state with hydrated data.
5. Mark `hydration = loaded`.

Important design rule:
- For non-active threads, do not build full transcript from live events in background.
- Only track coarse thread status (running/unread/last activity) in background.

Reason:
- `thread/read` history uses synthetic item IDs (`item-1`, `item-2`, ...), while live events use runtime IDs (`msg_*`, `rs_*`, etc.). Avoiding background full transcript mutation prevents duplicate-merge complexity.

### 5.3 Live event reducer (active thread)

Use `event.sequence` for ordering and dedupe.

Reducer rules:

1. Ignore events where `sequence <= lastAppliedSequence`.
2. Prefer v2 event family for transcript (`item/*`, `turn/*`); treat `codex/event/*` as debug/noise by default.
3. For active thread:
- `turn/started`: mark thread running.
- `item/started`: create placeholder transcript item from `params.item`.
- `item/reasoning/summaryTextDelta`: append summary text.
- `item/reasoning/textDelta`: append reasoning content.
- `item/agentMessage/delta`: append assistant text.
- `item/completed`: finalize item with canonical payload.
- `turn/completed`: mark running false, clear active turn.

4. For non-active thread:
- Only update `threadStatusById`, `unreadByThreadId`, and preview metadata.

### 5.4 API client changes

Add missing API wrappers in `apps/web/src/lib/api-client.ts`:

```ts
async readThread(
  workspaceId: string,
  csrfToken: string,
  input: { threadId: string; includeTurns: boolean }
): Promise<{ result: unknown }> {
  return await this.request(`/api/workspaces/${workspaceId}/threads/read`, {
    method: "POST",
    csrfToken,
    body: input
  });
}

async resumeThread(...)
```

And enforce `turn/start` precondition:
- If no selected thread, call `threads/start` first, then send turn with returned `threadId`.

### 5.5 Sidebar behavior

Thread card fields:
- `title` (prefer user title, else preview, else short id)
- `lastSeenAt` relative
- status chip (`Running`, `Error`, `Archived`)
- unread dot

Merge strategy for thread list sources:
- Combine backend `metadata` and `remote.data` by `threadId`.
- Do not discard remote entries when metadata exists.

### 5.6 Transcript UI composition

New component boundaries (within existing vanilla TS rendering approach):

- `ui/sidebar/workspace-thread-nav.ts`
- `ui/transcript/transcript-list.ts`
- `ui/transcript/transcript-item-message.ts`
- `ui/transcript/transcript-item-reasoning.ts`
- `ui/transcript/transcript-item-tool.ts`
- `ui/composer/composer-panel.ts`

Screen layout:
- Left: workspace/thread navigation.
- Right: header/context, transcript scroller, fixed composer footer.

## 6) Proposed Backend/Contract Adjustments (Minimal)

No major backend API redesign required.

Recommended small contract hardening:

1. Keep `threads/read` passthrough but frontend must explicitly send `includeTurns: true`.
2. Improve thread metadata normalization so preview/title is preserved for sidebar quality.
3. Optional: add a backend test asserting `threads/read` with `includeTurns: true` returns non-empty `turns` for materialized threads.

## 7) Implementation Tickets (UI-focused)

### UI-HIST-01: Add thread history API support
- Add `readThread()` and `resumeThread()` web API client methods.
- Add tests for payload shape and CSRF usage.

### UI-HIST-02: Introduce transcript state per thread
- Extend app state with `transcriptsByThreadId`, thread status, unread flags.
- Add reducer/store tests for transcript transitions.

### UI-HIST-03: Build thread hydration pipeline
- On thread select, call `threads/read` with `includeTurns: true`.
- Convert `thread.turns` to transcript items.
- Handle loading/empty/error states.

### UI-HIST-04: Implement active-thread live event reducer
- Process `item/*` and `turn/*` methods into transcript updates.
- Dedupe by sequence.
- Mark non-active threads unread/running without full transcript update.

### UI-HIST-05: Sidebar redesign for workspace+thread navigation
- Status-rich thread cards.
- Reliable active context highlighting.
- Merge metadata + remote thread list.

### UI-HIST-06: Composer reliability guards
- Ensure thread exists before `turn/start`.
- Preserve draft per thread context.
- Keep send/interrupt stable under stream load.

### UI-HIST-07: Transcript rendering UI
- Message bubbles + reasoning/tool cards.
- Auto-scroll with manual override and jump-to-latest.
- Collapse noisy internal events into optional debug panel.

### UI-HIST-08: End-to-end tests + manual runbook
- Unit tests for history conversion and stream reducer.
- Integration test with fake app-server notifications.
- Manual checklist below.

## 8) Manual Verification Checklist

After implementation:

1. Login succeeds with configured password.
2. Select workspace and see threads in sidebar with readable titles.
3. Click old thread and confirm full historical messages render.
4. Send new prompt and observe streaming assistant message in transcript.
5. Switch to another thread and back; history persists and draft is thread-scoped.
6. During long stream, typing in composer does not lose focus.
7. Internal/noisy events (e.g., `skills_update_available`) do not flood visible transcript.

## 9) Risks and Mitigations

1. Duplicate semantic streams (`item/*` + `codex/event/*`).
- Mitigation: transcript reducer consumes only `item/*` + `turn/*` by default.

2. Missing `threadId` on send.
- Mitigation: hard precondition in send path; auto-create thread if absent.

3. History/live mismatch due synthetic IDs from `thread/read`.
- Mitigation: hydrate only on select; avoid full background transcript mutation for non-active threads.

4. Large thread histories causing UI slowdown.
- Mitigation: cap rendered item count per frame, progressive rendering, and batch updates.

## 10) Source References Used

Official Codex protocol and behavior:
- `/mnt/d/projects/codex-from-phone/codex/codex-rs/app-server/README.md`
- `/mnt/d/projects/codex-from-phone/codex/codex-rs/app-server-protocol/src/protocol/v2.rs`
- `/mnt/d/projects/codex-from-phone/codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadReadParams.ts`
- `/mnt/d/projects/codex-from-phone/codex/codex-rs/app-server-protocol/src/protocol/thread_history.rs`

Codex-webui implementation ideas:
- `/mnt/d/projects/codex-from-phone/Codex-webui/public/index.html`
- `/mnt/d/projects/codex-from-phone/Codex-webui/server.js`

Codexia implementation ideas:
- `/mnt/d/projects/codex-from-phone/codexia/src/hooks/codex/v2/useThreadsV2.ts`
- `/mnt/d/projects/codex-from-phone/codexia/src/hooks/codex/v2/useThreadsReducerV2.ts`
- `/mnt/d/projects/codex-from-phone/codexia/src/hooks/codex/v2/useAppServerEventsV2.ts`
- `/mnt/d/projects/codex-from-phone/codexia/src/utils/codex-v2/threadItems.ts`

PocketCodex current codebase:
- `apps/backend/src/threads/plugin.ts`
- `apps/backend/src/threads/service.ts`
- `apps/backend/src/events/workspace-events-plugin.ts`
- `apps/web/src/main.ts`
- `apps/web/src/lib/api-client.ts`
- `apps/web/src/lib/normalize.ts`
- `apps/web/src/state/app-state.ts`
- `apps/web/src/ui/app-shell.ts`
- `apps/web/src/ui/app-renderer.ts`
