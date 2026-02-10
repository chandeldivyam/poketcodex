# PocketCodex UI-First Replan (Phase 2-4 Paused)

Date: 2026-02-10
Status: Active proposal (supersedes immediate execution order in `implementation-tickets.json`)

## 1. Decision Summary

We are changing near-term priority from backend feature expansion to UI quality.

Effective immediately:
- Pause execution of old `PHASE-2`, `PHASE-3`, and `PHASE-4` from `implementation-tickets.json`.
- Keep current backend contract stable (auth/workspaces/threads/turns/events).
- Run a UI-first program focused on conversation quality, usability, and mobile ergonomics.

On-hold scope (for now):
- `P2-T201` through `P2-T205`
- `P3-T301` through `P3-T305`
- `P4-T401` through `P4-T405`

Note:
- `PHASE-5` is not deleted, but it is implicitly blocked until paused phases are reintroduced later.

## 2. Research Inputs (What We Reviewed)

### A. Codex app-server and official integration model (`codex` repo)
Sources reviewed:
- `/mnt/d/projects/codex-from-phone/codex/codex-rs/app-server/README.md`
- `/mnt/d/projects/codex-from-phone/codex/docs/tui-chat-composer.md`
- `/mnt/d/projects/codex-from-phone/codex/docs/tui-stream-chunking-review.md`
- `/mnt/d/projects/codex-from-phone/codex/docs/tui-stream-chunking-tuning.md`
- `/mnt/d/projects/codex-from-phone/codex/docs/tui-request-user-input.md`

What matters:
- `codex app-server` is the supported integration surface for rich UIs, including VS Code extension clients.
- Real-time UI is built around thread/turn/item event streaming.
- Approval flows are server-initiated and must be rendered inline with context.
- TUI docs show production-grade interaction patterns for composer behavior and stream chunking under load.

Important caveat:
- The VS Code extension UI source is not present in this local `codex` clone. We can infer behavior from app-server and TUI docs, but not copy exact extension components.

### B. Codex-webui (`harryneopotter/Codex-webui`)
Sources reviewed:
- `/mnt/d/projects/codex-from-phone/Codex-webui/server.js`
- `/mnt/d/projects/codex-from-phone/Codex-webui/public/index.html`
- `/mnt/d/projects/codex-from-phone/Codex-webui/docs/ARCHITECTURE.md`
- `/mnt/d/projects/codex-from-phone/Codex-webui/docs/DESIGN.md`
- `/mnt/d/projects/codex-from-phone/Codex-webui/docs/COMPARISON.md`

What it does well:
- Fast, low-complexity UX loop.
- Session browser and project grouping are highly practical.
- Clear status indicator + SSE stream model are easy to reason about.
- Memory/config/resume controls are discoverable.

Limitations to avoid copying:
- Monolithic single-file frontend and server architecture does not scale for long-term UI complexity.
- Security model is intentionally lightweight.

### C. Codexia (`milisp/codexia`)
Sources reviewed:
- `/mnt/d/projects/codex-from-phone/codexia/src/components/codex-v2/*`
- `/mnt/d/projects/codex-from-phone/codexia/src/hooks/codex/*`
- `/mnt/d/projects/codex-from-phone/codexia/src/components/events/*`
- `/mnt/d/projects/codex-from-phone/codexia/docs/ARCHITECTURE.md`
- `/mnt/d/projects/codex-from-phone/codexia/docs/performance_optimizations.md`

What it does well:
- Strong component decomposition (composer, messages, approvals, sidebar, header).
- Event-type-specific rendering (not one generic event dump).
- Practical busy-state and interrupt ergonomics.
- Good mobile/tablet adaptation patterns (`TabBar`, `TabletNav`).
- Explicit performance work (memoization, reduced rerender churn, single-instance overlays).

Tradeoff:
- Higher architectural complexity; we should adopt patterns, not all complexity at once.

## 3. Synthesis: What High-Quality UI Looks Like For PocketCodex

### Core UX principles
1. Conversation-first: typing and reading must stay smooth during heavy event streams.
2. Progressive disclosure: show concise cards by default; expand for raw JSON/details.
3. Interruptibility: stop/reconnect actions should always be visible and trusted.
4. Context integrity: workspace/thread identity should be obvious at every moment.
5. Mobile ergonomics first: one-thumb actions, resilient keyboard behavior, no accidental focus loss.

### Interaction model we should target
- App shell:
  - Header with connection state, active workspace/thread, reconnect, logout.
  - Primary panes: Workspace/Thread navigation, Conversation timeline, Composer.
- Timeline:
  - Render high-level event cards (`message`, `reasoning`, `tool`, `approval`, `turn status`).
  - Allow per-item expand/collapse for raw payloads.
  - Collapse noisy internal events by default.
- Composer:
  - Stable input that does not lose focus on stream updates.
  - Explicit busy and interrupt states.
  - Optional advanced controls (model/effort/access mode) as compact chips.
- Approvals:
  - Sticky actionable queue/toasts with approve/deny paths.
  - Strong context text (workspace, command, diff).

### Visual feel direction
- Tone: “operator console”, calm and precise, not consumer chat app.
- Density: compact but touch-safe controls (>=44px targets on mobile actions).
- Feedback: subtle motion for state transitions; no jittery full-panel rerenders.
- Readability: strong message hierarchy (user, assistant, tool, warning, error).

## 4. Revised Plan Of Action (UI Program)

This replaces near-term execution order.

## UI-PHASE-1: Frontend Architecture and Design Foundation
Goal:
- Move from single-file render logic to maintainable UI architecture and stable state flow.

Deliverables:
- UI architecture decision (recommended: componentized frontend with explicit state store).
- Design tokens (color/spacing/type/radii/motion) and responsive breakpoints.
- App shell layout with consistent header/navigation/composer zones.
- Event filtering policy (which raw events are hidden, collapsed, or surfaced).

Acceptance criteria:
- Input focus is never lost during websocket bursts.
- No full-page rerender for every incoming event.
- UI structure can support approvals and diff cards without rewrites.

## UI-PHASE-2: Conversation Experience Quality
Goal:
- Make timeline and composer behavior production-grade under streaming load.

Deliverables:
- Typed timeline item renderer (`message`, `reasoning`, `tool`, `status`, `error`).
- Stream batching/chunking strategy inspired by Codex TUI hysteresis ideas.
- Busy indicator with elapsed timer and reliable interrupt affordance.
- Auto-scroll with manual override and “jump to latest” behavior.

Acceptance criteria:
- Long streams remain readable and responsive.
- Users can scroll historical content without forced snap-to-bottom.
- Event storms do not freeze input or cause visual flicker.

## UI-PHASE-3: Workspace and Thread UX
Goal:
- Make multi-project and multi-thread operation intuitive before deeper backend phases resume.

Deliverables:
- Robust workspace/thread sidebar with clear active state and status chips.
- Thread cards with metadata (last seen, archived, running).
- Improved error/retry affordances on thread/turn actions.
- Home/overview surface for recent runs and quick jump-back.

Acceptance criteria:
- Switching context is fast and unambiguous.
- Users can recover from failed requests without refreshing or relogging.
- Mobile navigation remains usable with soft keyboard open.

## 5. Commit-By-Commit Execution Strategy

After this document is approved, implement in thin vertical slices:

1. `ui-arch-shell`: split current web app into modules/components + stable state boundaries.
2. `ui-tokens-layout`: finalize visual system and responsive layout scaffolding.
3. `timeline-typed-render`: replace raw event list with typed timeline cards.
4. `composer-stability`: harden draft state, focus retention, busy/interrupt UX.
5. `stream-batching`: queue+batch event rendering and noisy-event policy.
6. `workspace-thread-ux`: sidebar/cards/status and context persistence polish.
7. `mobile-polish-pass`: keyboard + viewport + touch target pass on phone widths.

Each slice should include:
- unit tests for parsing/normalization/state transitions.
- manual test checklist for mobile and reconnect behavior.

## 6. Manual UX Test Checklist (New Priority)

Test these on every UI-phase slice:

- Login, add workspace, start thread, send multiple turns quickly.
- Receive high-frequency events while typing in composer.
- Scroll up during stream and verify no forced snap unless user requests.
- Trigger reconnect and verify timeline continuity.
- Validate on narrow viewport (~390px width) with soft keyboard open.
- Validate touch targets for critical actions (send, interrupt, reconnect, approvals).

## 7. Reintroduction Criteria For Paused Phases

We should only unpause old backend-heavy phases after UI quality baseline is met.

Unpause gate:
- Timeline/component architecture stable.
- Stream handling and composer behavior pass manual stress checks.
- Workspace/thread UX no longer confusing in manual daily use.

Then reintroduce in order:
1. approvals backend depth (`old P2` subset)
2. terminal subsystem (`old P3`)
3. security hardening (`old P4`)

## 8. Immediate Next Step

Start with `UI-PHASE-1` and open a focused implementation branch of tickets for:
- UI architecture split.
- design token system.
- app shell and navigation scaffolding.

No additional backend protocol changes are required for this first UI cycle.
