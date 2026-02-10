# UI Mobile Usability Checklist

Date: 2026-02-10
Scope: `UI-T303` mobile polish and manual certification baseline for PocketCodex web UI.

## Implemented polish items

- Added safe-area-aware bottom spacing using `env(safe-area-inset-bottom)` in `apps/web/src/styles.css`.
- Switched key height constraints to dynamic viewport units (`dvh`) for timeline behavior under mobile browser chrome and soft keyboard changes.
- Added mobile-specific layout tuning at `max-width: 640px` for tighter panel/header spacing and denser control grouping.
- Increased resilience of scroll areas with `overscroll-behavior: contain` on workspace/thread lists and event stream.
- Kept primary action controls in two-column layout on phone widths for faster thumb reach.

## Certification checklist

- [x] Touch targets remain >= 44px for primary buttons (`Start Turn`, `Interrupt`, `Refresh`, `Reconnect`).
- [x] Timeline remains scrollable and bounded on narrow viewports with long event streams.
- [x] Workspace and thread lists avoid scroll chaining into page while user is actively browsing list content.
- [x] Composer and action controls remain visible with safe-area padding applied.
- [ ] Verify on physical phone that soft keyboard open/close does not obscure composer actions.
- [ ] Verify on physical phone rotate portrait/landscape keeps timeline usable and action buttons reachable.
- [ ] Verify reconnection workflow remains ergonomic on mobile network transitions (wifi <-> cellular/hotspot).

## Notes

- This checklist is partially completed by code audit and local browser validation.
- Remaining unchecked items require device-level manual QA.
