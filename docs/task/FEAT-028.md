# FEAT-028: Sidebar Tally feedback button

- Status: Completed
- Plan: -
- Owner: main-session
- Created: 2026-06-11

## Problem

There is no quick way for users to submit usage suggestions. The channel must
work anonymously (no login) and stay available even when the app backend is
erroring, so it must not depend on this system's API.

## Goal

Add a feedback button in the sidebar footer, above the user menu item, that
opens the external Tally form `jaEZP1` as a popup via Tally's official embed
widget. If the widget script failed to load (offline, blocked), fall back to
opening the form URL in a new tab.

## Acceptance Criteria

- [x] `apps/web/index.html` loads `https://tally.so/widgets/embed.js` async.
- [x] Sidebar footer renders a feedback button above the user item; icon-only
      in collapsed mode, label `nav.feedback` (zh "意见反馈" / en "Feedback").
- [x] Click calls `window.Tally.openPopup("jaEZP1", { width: 480, hideTitle: true })`
      when the widget is loaded, otherwise `window.open("https://tally.so/r/jaEZP1")`.
- [x] API CSP allows `https://tally.so` in `script-src` and `frame-src` only;
      all other directives unchanged.
- [x] Tests cover button rendering and the `window.open` fallback path.
- [x] Scope verified green: lint 0 errors, web typecheck 0, web tests 833/833,
      API tests 1801/0, web build OK, i18n parity OK. Full `bun run check` is
      currently blocked by concurrent uncommitted HTTP_LOG_LEVEL work (stale
      fixture in `auth.routes.test.ts`), unrelated to this task.

## Notes

- `jaEZP1` is the form ID supplied by the user (matches Tally docs example);
  it is a single constant in `app-sidebar.tsx`, trivial to swap.
- No backend logic or database changes; CSP tweak in `apps/api/src/app.ts` is
  the only API-side edit.
