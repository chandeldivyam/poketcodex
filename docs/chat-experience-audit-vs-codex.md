# PocketCodex Chat Experience Audit vs Codex (TUI + IDE UX)

Date: February 11, 2026  
Author: Codex audit pass

## 1) Goal

Evaluate your current PocketCodex chat experience against:

- The local cloned `codex` reference implementation (TUI internals and UX behavior).
- Public Codex IDE extension docs (VS Code-facing capabilities and interaction model).

Then define a practical, prioritized implementation plan to close high-value gaps.

## 2) Scope and Inputs

### Audited PocketCodex code

- Frontend shell/render/state:
  - `apps/web/src/ui/app-shell.ts`
  - `apps/web/src/ui/app-renderer.ts`
  - `apps/web/src/main.ts`
  - `apps/web/src/lib/thread-transcript.ts`
  - `apps/web/src/lib/normalize.ts`
  - `apps/web/src/lib/ws-reconnect.ts`
  - `apps/web/src/styles.css`
  - `apps/web/src/state/app-state.ts`
  - `apps/web/src/state/store.ts`
- Backend runtime bridge:
  - `apps/backend/src/events/workspace-events-plugin.ts`
  - `apps/backend/src/codex/workspace-app-server-pool.ts`
  - `apps/backend/src/codex/app-server-manager.ts`
  - `apps/backend/src/threads/plugin.ts`
  - `apps/backend/src/turns/plugin.ts`
  - `apps/backend/src/threads/service.ts`
  - `apps/backend/src/turns/service.ts`
  - `apps/backend/src/codex/yolo-mode.ts`

### Codex reference examined (local clone)

- Composer/state machine and docs:
  - `/mnt/d/projects/codex-from-phone/codex/docs/tui-chat-composer.md`
  - `/mnt/d/projects/codex-from-phone/codex/codex-rs/tui/src/bottom_pane/chat_composer.rs`
  - `/mnt/d/projects/codex-from-phone/codex/codex-rs/tui/src/slash_command.rs`
- Session and control UX:
  - `/mnt/d/projects/codex-from-phone/codex/codex-rs/tui/src/resume_picker.rs`
  - `/mnt/d/projects/codex-from-phone/codex/codex-rs/tui/src/chatwidget.rs`
  - related snapshots in `codex-rs/tui/src/.../snapshots/`

### Codex IDE extension docs (public)

- Quickstart and feature pages:
  - https://developers.openai.com/codex/ide
  - https://developers.openai.com/codex/ide/features
  - https://developers.openai.com/codex/ide/commands
  - https://developers.openai.com/codex/ide/slash-commands
  - https://developers.openai.com/codex/ide/settings

## 3) Important Constraint

The local `/mnt/d/projects/codex-from-phone/codex` clone does **not** contain VS Code extension source code.  
So this audit compares your implementation to:

- Codex core/TUI behavior (code-level ground truth).
- IDE extension behavior from official docs (product-level capability baseline).

## 4) Current PocketCodex UX Baseline

PocketCodex already has a strong foundation:

- Clear shell with workspace/thread navigation and mobile drawer.
- Transcript rendering with message/reasoning/tool blocks.
- Runtime timeline with category/internal/status filtering and compaction.
- Turn lifecycle status (`idle/submitting/running/interrupting/error`) with elapsed timer.
- Thread hydration and streaming delta merging (`item/agentMessage/delta`, reasoning deltas, item upsert).
- Workspace event websocket bridge with reconnect support.
- Per-thread unread/running chips and relative activity timestamps.
- CSRF/session handling and retry actions for most API failures.

This is a solid control-plane base. The gaps are mostly around advanced interaction ergonomics, safety/control flows, and deep session tooling.

## 5) Gap Analysis (PocketCodex vs Codex Experience)

Severity scale:

- `High`: materially affects trust, usability, or throughput.
- `Medium`: noticeable friction, but workflow still possible.
- `Low`: polish/discoverability.

### A) Composer Intelligence and Input Ergonomics

1. No slash-command system in web composer. (`High`)
- PocketCodex: plain textarea + submit/interrupt only.
- Codex ref: rich slash command taxonomy, descriptions, availability rules, inline args.
- Impact: reduced power-user velocity, lower feature discoverability.

2. No queue/steer interaction model. (`High`)
- PocketCodex: blocks submit during in-flight transitions; no explicit queued message UX.
- Codex ref: queueing user inputs while task runs; deferred flush when turn completes.
- Impact: user loses flow during long-running operations.

3. No paste-burst protection for multiline paste edge cases. (`Medium`)
- PocketCodex: standard browser textarea behavior only.
- Codex ref: robust burst detector to prevent accidental submit/toggle in noisy key streams.
- Impact: lower resilience in edge environments and nonstandard keyboard paths.

4. No attachment placeholders (`[Image #n]`) or mention-binding model. (`Medium`)
- PocketCodex: no in-composer attachment mapping semantics.
- Codex ref: stable placeholder mapping, pruning, reindexing after edits.
- Impact: cannot safely scale to rich multimodal drafting.

### B) Runtime Control, Safety, and Trust

5. No approval/request-user-input UI flow. (`High`)
- PocketCodex backend forwards `serverRequest` events, but frontend has no modal flow and no response path back to runtime.
- Codex ref: exec/apply-patch/MCP elicitation/request-user-input are first-class UX events.
- Impact: cannot support non-YOLO interactive governance.

6. Forced YOLO policy (`approvalPolicy=never`, full access). (`High`)
- Current defaults in `apps/backend/src/codex/yolo-mode.ts`.
- Codex ref: permissions presets + explicit confirmation for full access.
- Impact: trust/safety gap for broader usage contexts.

7. No visible permission mode selection. (`High`)
- PocketCodex: user cannot switch policies from UI.
- Codex ref: approvals/permissions popup with preset actions and warnings.
- Impact: no runtime governance UX.

### C) Session Navigation and Conversation Management

8. No resume/fork picker UX (search/sort/pagination). (`High`)
- PocketCodex: thread list only; no dedicated session picker workflow.
- Codex ref: resume/fork overlays with search, sort toggle, pagination hints.
- Impact: weak handling for large history footprints.

9. No rename/thread identity management from composer-level commands. (`Medium`)
- PocketCodex: thread selection available but no conversational command surface for rename/fork workflows.
- Codex ref: `/rename`, `/fork`, `/resume`, `/new`.

10. No queue restore after interrupt. (`Medium`)
- Codex ref merges queued drafts back into composer on interrupted runs.
- PocketCodex currently interrupts but does not preserve queued intent.

### D) Event/Status Model and Explainability

11. Event visibility capped/compacted aggressively (`MAX_RENDERED_EVENTS=100`). (`Medium`)
- Good for noise reduction, but hides detail in long sessions.
- Missing "show full raw stream" / search / export.

12. No single "working surface" for background terminal waits. (`Medium`)
- Codex ref has unified status header/footer for background exec polling.
- PocketCodex uses timeline/transcript + chip, but not a cohesive active-work status object.

13. No explicit per-step execution model (analyzing -> tool -> applying -> done). (`Medium`)
- PocketCodex has phase chip and mixed events.
- Codex experience surfaces richer status semantics.

### E) Discoverability and Power Features

14. No command palette equivalent in web app. (`Medium`)
- IDE docs expose command-surface actions (login, new session, shortcuts).
- PocketCodex actions are button-centric and scattered.

15. No settings surface for model/reasoning/tool behavior. (`High`)
- IDE docs expose settings for model, reasoning effort, web search, context behavior, cloud task defaults.
- PocketCodex lacks a comparable user-level configuration panel.

16. No "send to cloud / continue in cloud" workflow. (`Medium`)
- IDE feature baseline includes cloud handoff.
- PocketCodex currently local-runtime only.

### F) Performance and Scalability

17. Full list re-render (`replaceChildren`) for transcript/events. (`Medium`)
- Works now, but grows costly with larger histories/high-frequency streams.
- No virtualization or incremental keyed diff render.

18. Reconnect backoff has no jitter. (`Low/Medium`)
- Current reconnect strategy can synchronize clients under outages.

### G) Mobile Specific

19. Important actions hidden on phone header (`refresh/reconnect`). (`Medium`)
- Buttons hidden under media query.
- Sidebar fallback exists but action discoverability decreases.

20. No mobile-first quick action rail for turn controls and filters. (`Low/Medium`)

## 6) Prioritized Improvement Plan

## Phase 0: Protocol and UX Foundation (3-5 days)

Objective: enable parity-critical primitives before adding UI complexity.

Deliverables:

1. Add runtime server-request response path.
- Backend: expose route for replying to app-server JSON-RPC server requests.
- Suggested API:
  - `POST /api/workspaces/:workspaceId/runtime/respond`
  - payload: `{ id, result? , error? }`
- Add method on runtime pool to call `respondToServerRequest`.

2. Capture pending interactive requests in frontend state.
- Add `pendingApprovals` + `pendingUserInputs` in `stream` or dedicated slice.
- Parse `serverRequest` events into structured pending tasks.

3. Expand timeline event model for traceability.
- Add stable event IDs from runtime sequence + method + request id.
- Add optional raw-payload inspector mode.

Acceptance criteria:

- Interactive server requests are visible in UI as actionable items.
- User action can send response back to runtime successfully.
- Existing turn streaming behavior remains unchanged.

## Phase 1: Composer and Control Surface Parity (1-2 weeks)

Objective: improve throughput and command ergonomics.

Deliverables:

1. Introduce slash command parser + popup.
- Start with:
  - `/new`
  - `/resume`
  - `/fork`
  - `/status`
  - `/approvals`
  - `/model`
  - `/plan`
  - `/review`
- Support inline args for `/plan` and `/review`.

2. Implement queued message flow.
- Add queue mode via `Tab` while turn is running.
- Surface queued count in composer.
- Auto-dispatch next queued prompt when turn completes.

3. Add keyboard hint overlay.
- Mirror Codex-style discoverability:
  - commands
  - queue shortcut
  - interrupt
  - transcript toggle

4. Upgrade interrupt UX.
- If queued prompts exist and interrupt occurs, offer restore/merge into draft.

Acceptance criteria:

- User can keep working during long turns.
- Slash actions execute reliably and are discoverable.
- Queue and interrupt restore flow is deterministic and test-covered.

## Phase 2: Safety and Approval UX (1-2 weeks)

Objective: move from hardcoded YOLO to controlled, user-visible permissions.

Deliverables:

1. Add permission presets in UI.
- Presets:
  - Read-only
  - Workspace write
  - Full access
- Include explicit full-access confirmation dialog.

2. Approval modals.
- Exec approval modal with:
  - proceed
  - proceed and remember prefix rule
  - reject and provide correction guidance
- Patch approval modal with file-change summary and "remember for files".

3. Policy persistence.
- Save selected policy per workspace/session.
- Keep current YOLO mode as optional preset, not forced.

Acceptance criteria:

- Non-YOLO runs are functional with full approval loop.
- User can safely switch policy without restarting app.
- Full access requires explicit acknowledgment.

## Phase 3: Session Management and Navigation (1 week)

Objective: make history-heavy workflows practical.

Deliverables:

1. Build resume/fork picker overlay.
- Search by title/thread ID.
- Sort by created/updated.
- Cursor-based paging on backend.

2. Add thread rename and metadata actions.
- UI actions + optional slash command alias.

3. Improve thread list signal quality.
- show turn state, unread, last active turn status, failure markers.

Acceptance criteria:

- Users with 100+ threads can efficiently locate and resume/fork conversations.
- Thread-level operations are available without leaving conversation context.

## Phase 4: Rendering and Reliability Hardening (1 week)

Objective: handle heavy streaming sessions smoothly.

Deliverables:

1. Incremental transcript/event rendering.
- Replace full `replaceChildren` path with keyed incremental updates.
- Add virtualization thresholds for long lists.

2. Reconnect strategy improvements.
- exponential backoff + jitter.
- stale-connection watchdog (heartbeat timeout).

3. Draft durability.
- persist per-context draft to localStorage.
- restore after reload.

Acceptance criteria:

- Long sessions stay responsive.
- reconnect storms reduce under outages.
- drafts survive reloads and tab crashes.

## 7) File-Level Implementation Blueprint

### Backend

1. Runtime response channel:
- `apps/backend/src/codex/workspace-app-server-pool.ts`
- `apps/backend/src/codex/app-server-manager.ts`
- Add service/plugin route:
  - `apps/backend/src/turns/plugin.ts` or new `apps/backend/src/runtime/plugin.ts`

2. Permissions config endpoint (optional but recommended):
- new route group under `/api/workspaces/:workspaceId/settings/*`

3. Session listing improvements for resume/fork:
- `apps/backend/src/threads/service.ts`
- `apps/backend/src/threads/plugin.ts`

### Frontend

1. New state slices:
- `apps/web/src/state/app-state.ts`
- include:
  - `pendingApprovals`
  - `pendingUserInputs`
  - `queuedPrompts`
  - `permissionMode`

2. Composer engine:
- `apps/web/src/main.ts` (input key routing, slash parsing, queue dispatch)
- new helper modules:
  - `apps/web/src/lib/composer-commands.ts`
  - `apps/web/src/lib/composer-queue.ts`

3. UI components:
- `apps/web/src/ui/app-shell.ts`
- `apps/web/src/ui/app-renderer.ts`
- add:
  - slash popup
  - approval modals
  - request-user-input modal
  - resume/fork overlay
  - keyboard shortcut overlay

4. Styling:
- `apps/web/src/styles.css`
- add mobile-first action surfaces and modal layers.

## 8) Testing Plan

Add or extend tests in:

- `apps/backend/test/integration/turn-events.integration.test.ts`
- `apps/web/test/unit/thread-transcript.test.ts`
- `apps/web/test/unit/ws-reconnect.test.ts`
- new frontend unit tests for:
  - slash command parser
  - queue dispatch ordering
  - approval modal decision mapping
  - request-user-input form serialization

Critical new integration tests:

1. Server request round-trip.
- backend emits serverRequest -> frontend action -> backend `respond` -> runtime continues.

2. Queue + interrupt behavior.
- queued prompts preserved and resumed deterministically.

3. Permission profile switching.
- policy reflected in outgoing turn/thread params.

## 9) Suggested Rollout Order

1. Land Phase 0 protocol wiring first.
2. Ship Phase 1 slash + queue next (highest visible UX gain).
3. Ship Phase 2 approvals to unlock trust and policy control.
4. Add Phase 3 resume/fork picker.
5. Finish with Phase 4 rendering/reliability optimization.

## 10) Product-Level Success Metrics

Track before/after:

1. Median time to first useful action after opening app.
2. Median time from prompt submit to first visible response token.
3. Interrupt success rate.
4. Session resume success rate.
5. User drop-off during long-running turns.
6. Percentage of turns using queue/slash features.

## 11) Quick Wins You Can Start Immediately

1. Add slash commands `/status`, `/new`, `/resume` (UI-only wrappers first).
2. Add queue-on-Tab and queued count badge.
3. Expose reconnect/refresh actions on phone via overflow menu (not hidden-only).
4. Add jitter to websocket reconnect.
5. Add "raw event inspector" toggle to avoid over-compaction during debugging.

## 12) Evidence Pointers (Selected)

PocketCodex:

- Core shell/composer surface: `apps/web/src/ui/app-shell.ts:50`
- Mobile hides reconnect/refresh actions: `apps/web/src/styles.css:1224`
- Event render cap: `apps/web/src/ui/app-renderer.ts:18`
- Full list replacement render path: `apps/web/src/ui/app-renderer.ts:946`
- Reconnect backoff (no jitter): `apps/web/src/lib/ws-reconnect.ts:117`
- YOLO defaults hardcoded: `apps/backend/src/codex/yolo-mode.ts:1`
- `serverRequest` is emitted but not user-handled end-to-end: `apps/backend/src/codex/workspace-app-server-pool.ts:151`
- Frontend has `steerTurn` API client, but composer flow does not invoke it: `apps/web/src/lib/api-client.ts:193`, `apps/web/src/main.ts:1549`

Codex reference (local clone):

- Slash command definitions and inline arg support: `/mnt/d/projects/codex-from-phone/codex/codex-rs/tui/src/slash_command.rs:12`
- Composer feature gating and advanced state machine hooks: `/mnt/d/projects/codex-from-phone/codex/codex-rs/tui/src/bottom_pane/chat_composer.rs:226`
- Queue and deferred submit behavior: `/mnt/d/projects/codex-from-phone/codex/codex-rs/tui/src/chatwidget.rs:3626`
- Approval request handling: `/mnt/d/projects/codex-from-phone/codex/codex-rs/tui/src/chatwidget.rs:2368`
- Request-user-input handling: `/mnt/d/projects/codex-from-phone/codex/codex-rs/tui/src/chatwidget.rs:2424`
- Permissions popup and full-access confirmation UX: `/mnt/d/projects/codex-from-phone/codex/codex-rs/tui/src/chatwidget.rs:5224`
- Resume/fork picker UX model: `/mnt/d/projects/codex-from-phone/codex/codex-rs/tui/src/resume_picker.rs:99`
- Paste burst rationale and behavior: `/mnt/d/projects/codex-from-phone/codex/docs/tui-chat-composer.md:14`

## 13) External Reference Links

- Codex IDE Quickstart: https://developers.openai.com/codex/ide
- Codex IDE Features: https://developers.openai.com/codex/ide/features
- Codex IDE Commands: https://developers.openai.com/codex/ide/commands
- Codex IDE Slash Commands: https://developers.openai.com/codex/ide/slash-commands
- Codex IDE Settings: https://developers.openai.com/codex/ide/settings
