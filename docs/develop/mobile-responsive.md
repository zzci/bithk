# Mobile / Responsive Design Spec

Conventions for building mobile-friendly, responsive UI in the web app. These
rules are mobile-first: write the base styles for the smallest screen, then
layer desktop refinements behind `sm:` / `md:` / `lg:` prefixes. Every rule
below already exists somewhere in the codebase — the citation is the canonical
example to copy.

---

## 1. Breakpoints

Mobile-first. `md` (768px) is the primary mobile/desktop boundary and the only
one the JS hook keys off — keep CSS and JS aligned on it.

- `md` = 768px — primary boundary. Matches `MOBILE_BREAKPOINT` in
  `apps/web/src/shared/hooks/use-mobile.ts:3`; the mobile-only header and the
  desktop sidebar both switch here (`md:hidden` / `md:flex`).
- `sm` = 640px — the point where bounded controls (search boxes, dialogs) leave
  full-width and adopt a fixed cap.
- `lg` / `xl` — progressive enhancement only (multi-column layouts, wider
  gutters). Never gate a primary control's *visibility* on `lg`/`xl`.

Rationale: one boundary for "is this a phone" keeps layout decisions
predictable. The app shell pads `px-4 py-3 md:px-6 md:py-4`
(`apps/web/src/app/routes/_app.tsx:120`) — tighter gutters on mobile, roomier on
desktop.

## 2. Touch targets

Interactive elements need a **>= 44px effective hit area**. A 28-32px *visual*
control is fine when an `after:` pseudo-element expands the clickable region.

- Expand the hit area with `after:absolute after:inset-0` on the interactive
  element so the visual size and the touch size can differ. See the whole-card
  click target in `apps/web/src/app/routes/_app/projects/index.lazy.tsx:242`.
- The app-wide button standard (`h-8` / `size-8`, ~32px) is acceptable because
  buttons carry padding; see [decision 007](../decisions/007-button-sizing-standard.md).
- Never ship a bare interactive target under ~24px with no padding or `after:`
  expansion — it is unhittable with a thumb.

## 3. Hover-only row actions must reveal on touch

Touch devices have no hover. Any action hidden behind hover MUST also surface on
mobile and on keyboard focus — otherwise it is unreachable on a phone.

- Gate the hover-*hide* behind `md:` so the control stays visible on mobile:
  `... md:opacity-0` (`apps/web/src/shared/components/ui/sidebar.tsx:571`).
- Or pair the hover reveal with `focus-within` / `focus-visible`:
  `opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100`
  (`apps/web/src/app/routes/_app/contacts/index.lazy.tsx:281`, and the pinned-row
  toggle in `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx:431`).
- Never hide a *primary* action (the only way to open/act on a row) behind hover
  with no touch fallback.

## 4. Toolbar rows

List toolbars are a single wrapping row: filters on the left, search + create on
the right, collapsing onto multiple lines when narrow.

- Row: `flex flex-wrap items-center justify-between gap-3`.
- Left filter cluster: `min-w-0 flex-1 flex-wrap` so chips wrap instead of
  pushing the search off-screen.
- Right: a bounded `SearchCreateBar` (see rule 8).

Canonical example — `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx:325`
(row), `:328` (left cluster), `:333` (right `SearchCreateBar`). Same shape in the
project worklist and contacts toolbars.

## 5. Data tables

Always wrap a table in a horizontal-scroll container so wide columns scroll
instead of overflowing the viewport (or forcing a full-page horizontal scroll).

```tsx
<div className="overflow-x-auto rounded-md border">
  <table>...</table>
</div>
```

See `apps/web/src/app/routes/_app/projects/-project-equipment-tab.tsx:238`.

## 6. Drawers / side panels

Right-side detail drawers are full-width on small screens and capped on large
ones; they must never exceed the viewport width.

- Full width down to a `360px` minimum, capped at `92vw`:
  `w-full ... sm:w-[min(var(--drawer-width),92vw)]`
  (`apps/web/src/shared/components/resizable-drawer.tsx:113`).
- The width bounds live in one place —
  `MIN_DRAWER_WIDTH` / `MAX_DRAWER_VIEWPORT_RATIO`
  (`apps/web/src/shared/components/resizable-drawer.tsx:13`). Reuse
  `ResizableDrawer` rather than hand-rolling a fixed-width panel.

## 7. Dialogs

Dialogs start `w-full` and only adopt a fixed max width at `sm` and up — never a
bare fixed width with no mobile fallback.

- Base: `w-full max-w-[calc(100%-2rem)] ... sm:max-w-sm`
  (`apps/web/src/shared/components/ui/dialog.tsx:59`). Inherit this by using the
  shared `DialogContent`.
- A wider dialog still caps against the viewport:
  `w-[min(960px,92vw)]`
  (`apps/web/src/shared/components/resource/attachment-section.tsx:234`).
- Forbidden: a bare `max-w-2xl` / `w-[640px]` with no `w-full` base or `vw` cap —
  it overflows on phones.

## 8. Search width

Search inputs are **bounded**, not fill-width, so they can sit in a
`justify-between` toolbar row.

- Standard: `w-full sm:w-64` — full width on mobile, fixed `16rem` from `sm` up
  (`apps/web/src/shared/components/search-create-bar.tsx:38`).
- A fixed-width search that must not overflow uses a viewport-aware cap:
  `w-[min(Npx,calc(100vw-Mpx))]` (same `min()` technique as the wide dialog in
  rule 7).

## 9. Conditional rendering with `useIsMobile`

Prefer CSS responsive utilities. When the mobile and desktop versions are
*structurally* different — different component, not just different styling —
branch on `useIsMobile` instead.

- Example: the sidebar renders an off-canvas `Sheet` on mobile and a fixed rail
  on desktop — two different trees, so it branches:
  `if (isMobile) { return <Sheet>...> }`
  (`apps/web/src/shared/components/ui/sidebar.tsx:182`, hook at
  `apps/web/src/shared/hooks/use-mobile.ts:5`).
- Do **not** reach for `useIsMobile` when a `md:` class would do — keeping layout
  in CSS avoids a render-after-measure flash and keeps SSR/first-paint stable.
