# Chat Experience Focused Tasks (YOLO + Mobile First)

## Scope Guardrails (Explicitly Out)

These are intentionally excluded for now based on your direction:

- Composer intelligence features (`@`, slash commands, prompt indexing)
- Approval flow UX (app stays YOLO, no approval prompts)
- Resume/rename/interrupt work in thread list (can revisit later)
- Command palette and cloud-sync surfaces
- Explicit per-step event surfacing in chat stream
- Reconnect/session recovery work

## Priority Plan

### P0 - Implement Now

1. `DONE` Add direct settings surface in sidebar
- Add checkboxes for:
  - Show status events
  - Show internal events
  - Compact status bursts
- Persist values in local storage.
- Keep existing runtime toggle buttons compatible.

2. `DONE` Show background terminal activity state in composer area
- Add visible runtime row when unified exec tools are active.
- Show process count, running/waiting state, and latest command preview.
- Reset status on workspace/event disconnect/switch/logout.

3. `DONE` Reduce unnecessary full re-renders
- Skip transcript list re-render when selected transcript reference is unchanged.
- Skip runtime event list re-render when event array/filter settings are unchanged.
- Keep filter toggles and compact mode fully reactive.

4. `DONE` Mobile-first UX baseline pass
- Keep top actions available on phone.
- Tighten mobile header/status-row density.
- Ensure settings panel has safe-area bottom spacing.

### P1 - Next Iteration

1. `TODO` Event stream virtualization/windowing
- Current cap is last 100 rendered events; rendering is cheaper now but still replaceChildren-based.
- Introduce keyed DOM reuse or virtual window for smoother long sessions.

2. `TODO` Background terminal details panel
- Expand background row into optional details drawer showing active commands and latest stdout summary.
- Keep default collapsed for clean chat-first UX.

3. `TODO` Mobile ergonomics hardening
- Make action hit-target audit systematic (>=44px interactive targets everywhere).
- Verify keyboard-open behavior on iOS/Android for composer + sticky controls.
- Add quick “Jump to latest” affordance placement test on narrow screens.

4. `TODO` Lightweight UX telemetry
- Add client metrics for render duration and interaction latency to validate improvements objectively.

## Implemented Delta (This Pass)

- State model extended for compact-mode and background-terminal runtime status.
- Sidebar settings panel added and wired.
- Composer shows background terminal status row.
- Renderer now memo-skips unchanged transcript/event renders.
- Runtime signal handling tracks unified exec begin/end/interaction variants.
- Unit tests updated for extended stream state shape.
- Verified with:
  - `pnpm --filter @poketcodex/web test:unit`
  - `pnpm --filter @poketcodex/web lint`
  - `pnpm --filter @poketcodex/web build`

## File Map

- `apps/web/src/state/app-state.ts`
- `apps/web/src/main.ts`
- `apps/web/src/ui/app-shell.ts`
- `apps/web/src/ui/app-renderer.ts`
- `apps/web/src/styles.css`
- `apps/web/test/unit/selectors.test.ts`
- `apps/web/test/unit/store.test.ts`

## Recommended Next Task Order

1. Ship current P0 set and gather real usage feedback on mobile.
2. Implement event virtualization/windowing (highest remaining perf win).
3. Add expandable background-terminal detail pane.
4. Finish mobile ergonomics hardening with a short device QA matrix.
