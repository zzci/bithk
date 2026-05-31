# Lane 05 — UI / UX / Accessibility Audit (project module)

Counts: **P0 0 · P1 1 · P2 7 · P3 9**

Scope: project list + detail tab nav, overview / issues / procurement / files tabs,
issue & procurement detail panels + drawer routes, tag filter, settings dialog
(general/members/roles/categories/danger), shared `priority-signal.tsx`,
`status-colors.ts`, and the shadcn UI primitives these consume. Report-only —
no source changed. Findings sorted by severity.

---

## P1

### F1: Detail drawers are hand-rolled modals with no focus trap / focus restoration
- Severity: **P1 high**
- Location:
  `apps/web/src/app/routes/_app/projects/$projectId.issues.$issueId.lazy.tsx:96-137`,
  `apps/web/src/app/routes/_app/projects/$projectId.procurements.$procurementId.lazy.tsx:96-139`
- Description: Both drawers `createPortal` a plain `<div role="dialog" aria-modal="true">`
  with a sibling `<div onClick={close}>` backdrop. They do **not** trap Tab focus
  inside the drawer, do **not** mark the background page `inert`/`aria-hidden`,
  and do **not** restore focus to the triggering list row on close. Escape only
  works because the inner panel attaches `onKeyDown` (`-project-issue-panel.tsx:236`),
  which fires solely when focus already sits inside the panel. The codebase
  already ships `shared/components/ui/sheet.tsx` (base-ui Dialog) that provides
  trap + restore + scroll-lock + Escape for free, but the drawers reimplement a
  modal without those guarantees.
- Impact: Keyboard and screen-reader users can Tab out of an `aria-modal="true"`
  surface onto the obscured page behind it (a WCAG 2.4.3 / modal-pattern
  violation); on close, focus is lost to `<body>` so keyboard users are dumped to
  the top of the document. This is the most serious a11y defect in the module and
  it affects every issue and procurement detail view.
- Recommended fix: Render the drawer through the existing `Sheet`/`SheetContent`
  primitive (side="right"), or wrap the portal body in a focus-trap that cycles
  Tab within the dialog, applies `inert` to the app root while open, and returns
  focus to the previously-focused element on unmount. Keep the custom resize
  handle as a child of the trapped container.

---

## P2

### F2: Issue drawer `role="dialog"` has no accessible name
- Severity: **P2 medium**
- Location: `apps/web/src/app/routes/_app/projects/$projectId.issues.$issueId.lazy.tsx:102-107`
- Description: The issue drawer's modal `<div role="dialog" aria-modal="true">`
  carries no `aria-label`/`aria-labelledby`. The sibling procurement drawer DOES
  (`$projectId.procurements.$procurementId.lazy.tsx:105` →
  `aria-label={t("procurement.detail.title")}`), so the two diverge.
- Impact: Screen readers announce the issue drawer as an unnamed "dialog",
  giving no context. Inconsistent with the procurement drawer.
- Recommended fix: Add `aria-label` (e.g. the issue title / a generic
  "work order" label) or `aria-labelledby` pointing at the panel's `<h1>`
  (`-project-issue-panel.tsx:306`). Mirror the procurement drawer.

### F3: Inline title editing is mouse-only (no keyboard affordance)
- Severity: **P2 medium**
- Location: `apps/web/src/app/routes/_app/projects/-project-issue-panel.tsx:306-313`,
  `apps/web/src/app/routes/_app/projects/-project-procurement-panel.tsx:314-321`
- Description: The read-mode title is an `<h1>` with `onClick={startEditTitle}`,
  `cursor-pointer`, and a `title` tooltip, but it is not focusable and has no
  `onKeyDown`/`role="button"`/`tabIndex`. Editing the title can only be triggered
  by a pointer.
- Impact: Keyboard and assistive-tech users cannot rename an issue/procurement —
  a core action is unreachable without a mouse (WCAG 2.1.1 Keyboard).
- Recommended fix: Make the edit affordance a real control — e.g. a `Button`
  (ghost) wrapping the title text, or add `role="button" tabIndex={0}` plus an
  `onKeyDown` that triggers `startEditTitle` on Enter/Space. Gate on
  `permissions.canEditAll` / `canEdit` as today.

### F4: Due-date picker button calls `showPicker()` with no fallback
- Severity: **P2 medium**
- Location: `apps/web/src/app/routes/_app/projects/-project-issue-panel.tsx:445-464`,
  `apps/web/src/app/routes/_app/projects/-project-procurement-panel.tsx:442-462`
- Description: The inline due-date control is a button whose `onClick` calls
  `dueDateInputRef.current?.showPicker()` directly, while the underlying
  `<input type="date">` is `className="sr-only" tabIndex={-1}`. `showPicker()`
  throws in some contexts and is absent in older engines. Notably the
  create-issue dialog (`-project-issues-tab.tsx:518-532`) wraps the same call in
  `try/catch` with a `focus()` fallback — the panels do not.
- Impact: Where `showPicker` is unavailable or throws, clicking does nothing and,
  because the real input is visually hidden and removed from tab order, the due
  date becomes entirely uneditable (no keyboard path at all).
- Recommended fix: Reuse the create dialog's guarded pattern (try `showPicker`,
  catch → `input.focus()`), and/or keep the date input reachable (remove
  `tabIndex={-1}` / `sr-only`, or expose a visible native input) so there is a
  non-`showPicker` editing path.

### F5: Hand-written inline buttons lack a focus-visible indicator
- Severity: **P2 medium**
- Location:
  `-project-issue-panel.tsx:472-481` (upload), `:483-491` (edit), `:548-555` (no-description);
  `-project-procurement-panel.tsx:469-478` (upload), `:480-488` (edit), `:650-657` (no-description), `:769-780` (`InlineValue`);
  `-project-settings-dialog.tsx:98-114` (section tab buttons)
- Description: These native `<button>`s style only `hover:` states; none define
  `focus-visible:` ring/outline. (By contrast the list rows in
  `-project-issues-tab.tsx:399`, `-project-procurement-tab.tsx:238`, and
  `-project-overview-tab.tsx` rows DO carry `focus-visible:ring-2`.)
- Impact: Keyboard users get no visible focus indicator on the attachment-upload,
  edit, inline-value, "add description", and settings-section controls (WCAG
  2.4.7 Focus Visible).
- Recommended fix: Prefer the shadcn `Button` (ghost/link) which already ships a
  `focus-visible` ring (see also F-prefer-Button below), or add
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` to
  each hand-written button.

### F6: Settings dialog tablist has incomplete ARIA + no arrow-key navigation
- Severity: **P2 medium**
- Location: `apps/web/src/app/routes/_app/projects/-project-settings-dialog.tsx:93-160`
- Description: The left nav uses `role="tablist"` + `role="tab"` buttons with
  `aria-selected`, and the right pane is `role="tabpanel"`, but: the tabs have no
  `id` and no `aria-controls`; the panel has no `aria-labelledby` linking back to
  the active tab; and the vertical tablist (`aria-orientation="vertical"`) has no
  roving-tabindex / Arrow-Up-Down handling (every tab is in the Tab sequence).
  This is a hand-rolled tablist where the app also ships a compliant
  `ui/tabs.tsx` primitive.
- Impact: Screen-reader association between tab and panel is missing, and the
  expected arrow-key tab navigation (WAI-ARIA Tabs pattern) is absent — keyboard
  users must Tab through every section button.
- Recommended fix: Either adopt the `Tabs/TabsList/TabsTrigger/TabsContent`
  primitive (vertical orientation) which wires roving tabindex + arrow keys +
  aria automatically, or add matching `id`/`aria-controls`/`aria-labelledby` and
  Arrow-Up/Down key handling with roving `tabIndex`.

### F7: Assignee avatar palette fails text contrast (fixed -500 colors + white text)
- Severity: **P2 medium**
- Location: `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx:90-102`
  (`AVATAR_COLORS`), used at `:166` (`text-white` on `avatarColor(id)`)
- Description: Avatars render uppercase initials in `text-white text-[10px]` over a
  fixed Tailwind `bg-*-500` chip (amber-500, sky-500, teal-500, etc.). Several
  500-level backgrounds (notably `bg-amber-500`, `bg-sky-500`, `bg-teal-500`)
  do not meet 4.5:1 against white text. The palette is hard-coded raw colors that
  also ignore the app's semantic-token theming.
- Impact: Initials are low-contrast / hard to read on lighter avatar colors (WCAG
  1.4.3). Text-bearing chips should clear 4.5:1.
- Recommended fix: Either drop the initials to a darker tint of the same hue
  (`text-{color}-50` over `bg-{color}-600/700`), or restrict the palette to
  hues that pass AA with white, or render initials in a fixed dark foreground on
  a light tinted background. The 10px size compounds the issue.

### F8: Project card nests an interactive button inside a `role="button"`
- Severity: **P2 medium**
- Location: `apps/web/src/app/routes/_app/projects/index.lazy.tsx:237-273`
- Description: Each project tile is a `Card` with `role="button"` + `tabIndex={0}`
  + Enter/Space handler, and it contains a real `<Button>` (the Settings
  icon button, `:262-272`) that `stopPropagation`s. This is an interactive
  control nested inside another interactive control.
- Impact: Nested interactive elements are invalid for assistive tech and confuse
  focus/activation semantics (a "button inside a button"); some screen readers
  mis-announce or skip the inner control.
- Recommended fix: Make the card a non-interactive container and put the
  navigable affordance on an inner element (e.g. the title becomes a link/button
  covering the card via an `::after` overlay), keeping the Settings button as a
  separate sibling control — so the two actions are not nested.

---

## P3

### F9: `todo` status reads as two different colors (dot vs list icon)
- Severity: **P3 low-nit**
- Location: `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx:63-78`
- Description: `STATUS_ICON_TINT.todo = "text-muted-foreground"` (gray) in the list
  rows / section headers, but `STATUS_DOT.todo = "bg-warning"` (yellow) in the
  create-dialog selector, and `ISSUE_STATUS_BADGE.todo` (`status-colors.ts`) is
  also `warning`. So `todo` is gray as a list glyph but yellow as a dot/badge.
- Impact: Same status reads inconsistently across the tab, dialog, and badges.
- Recommended fix: Align `STATUS_ICON_TINT.todo` with the warning tone used by the
  dot/badge (or consciously document the muted list-glyph choice for all
  statuses).

### F10: Procurement "New" button icon diverges from the issues tab
- Severity: **P3 low-nit**
- Location: `apps/web/src/app/routes/_app/projects/-project-procurement-tab.tsx:192`
- Description: `<Plus className="mr-1 size-4" />` adds an explicit `mr-1` margin
  (on top of `Button`'s built-in `gap-1.5`) and omits `aria-hidden="true"`. The
  issues tab uses a bare `<Plus aria-hidden="true" />` (`-project-issues-tab.tsx:338`).
- Impact: Slightly wider icon-to-label gap than every other "New/+" button, and a
  decorative icon not hidden from AT (minor — the button has a text label).
- Recommended fix: Drop `mr-1` and add `aria-hidden="true"` to match the issues
  tab and the project-list create button.

### F11: Procurement list rows visually diverge from issues rows
- Severity: **P3 low-nit**
- Location: `apps/web/src/app/routes/_app/projects/-project-procurement-tab.tsx:237`
  vs `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx:395`
- Description: Procurement rows use `border-t border-border` + `odd:bg-muted/20`
  zebra striping; issue rows use a lighter `border-b border-border/40` with no
  zebra. The two "aligned CSS-grid list" surfaces that are meant to read as
  siblings have different separators and striping.
- Impact: The two primary lists in the same module look like different components
  (heavier grid + stripes vs light hairlines).
- Recommended fix: Pick one row treatment (the issues' light hairline, per the
  borderless-list direction) and apply it to both, or document the intentional
  difference.

### F12: "Filter by tag" label sits over the status filter buttons
- Severity: **P3 low-nit**
- Location: `apps/web/src/app/routes/_app/projects/index.lazy.tsx:108-138`
- Description: The row prefixes `t("list.filterByTag")` and then renders the
  Active/Archived **status** toggle buttons before the actual `ProjectTagFilter`.
  The label only describes the trailing tag chips, not the status buttons it
  visually introduces.
- Impact: Mislabels the leading status controls; mild confusion / imprecise
  labeling.
- Recommended fix: Move the "filter by tag" caption to immediately precede the
  tag chips, or use a neutral "Filter" caption, or give the status group its own
  label.

### F13: Stale header comment describes a removed status-filter chip row
- Severity: **P3 low-nit**
- Location: `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx:1-10`
- Description: The file header still says "a clickable status-filter chip row and
  clickable section headers both select the active status", but the code now has
  no status-filter chip row (`:280-281` "No status filter: always show every
  populated status group") and section headers only toggle collapse.
- Impact: Misleads future maintainers about the tab's interaction model.
- Recommended fix: Update the comment to match the current behavior (collapsible
  per-status sections, no status chip row).

### F14: Overview "View all" uses `size="sm"` against the button standard
- Severity: **P3 low-nit**
- Location: `apps/web/src/app/routes/_app/projects/-project-overview-tab.tsx:249`
- Description: `<Button variant="link" size="sm" className="h-auto p-0">`. Decision
  007 lists `sm` as "not used on buttons". Height is neutralized by `h-auto`, but
  `size="sm"` still applies sm gap/text/svg tokens, so it is a (cosmetic)
  deviation from the h-8 standard's "drop the size prop" guidance.
- Impact: Minor inconsistency with decision 007; link-style action, low visual
  risk.
- Recommended fix: Drop `size="sm"` (keep `variant="link" className="h-auto p-0"`),
  or note it as an intentional inline link exception per decision 007 §3.

### F15: Drawer resize handle has no keyboard support
- Severity: **P3 low-nit**
- Location: `$projectId.issues.$issueId.lazy.tsx:111-119`,
  `$projectId.procurements.$procurementId.lazy.tsx:112-120`
- Description: The resize strip is `role="separator" aria-orientation="vertical"`
  with an `aria-label` but only a pointer handler — no `tabIndex`, no
  `aria-valuenow/min/max`, no Arrow-key resize. It is also `hidden sm:flex`.
- Impact: Drawer width cannot be adjusted by keyboard. Low severity — resizing is
  an enhancement and the default width is usable; hidden on mobile.
- Recommended fix: If keyboard resize is desired, add `tabIndex={0}` +
  `aria-valuenow/valuemin/valuemax` + Arrow-Left/Right handling; otherwise
  consider `role="presentation"` since it carries no keyboard semantics today.

### F16: Read-only "no description" placeholder mimics the editable button
- Severity: **P3 low-nit**
- Location: `-project-issue-panel.tsx:556-560`, `-project-procurement-panel.tsx:658-662`
- Description: For non-editors, the empty-description state renders a `<div>` with
  the same dashed border / italic muted styling as the editable `<button>`
  branch (`:548-555` / `:650-657`), differing only in being a div.
- Impact: The placeholder looks like a clickable "add description" affordance but
  is inert for viewers — a mild affordance-mismatch.
- Recommended fix: Visually distinguish the read-only empty state (drop the dashed
  "input-like" border, render as plain muted text).

### F17: Prefer shadcn `Button` over hand-written `<button>` (project guideline)
- Severity: **P3 low-nit**
- Location: `-project-issue-panel.tsx:472,483,548`;
  `-project-procurement-panel.tsx:469,480,650,769`;
  `-project-settings-dialog.tsx:98`
- Description: These inline controls are hand-written `<button>` elements with
  bespoke classes instead of the shared `Button` primitive. The project
  guideline (and the recurrence of F5's missing focus ring) favors the shadcn
  `Button`, which centralizes sizing (decision 007), focus-visible, and disabled
  styling. (Row-level buttons in the lists/overview are a reasonable exception —
  they need full-width grid layout the `Button` variants don't model.)
- Impact: Drift from the standard button affordances; each hand-rolled button is a
  place focus/size/disabled handling can (and per F5 does) regress.
- Recommended fix: Port the meta-row upload/edit/value/due controls and the
  settings tab buttons to `Button` (ghost/link variants); reserve raw `<button>`
  only for the grid row containers that genuinely cannot use a `Button` variant.

---

## Areas checked and found clean (justified)

- **Status color system** (`shared/lib/status-colors.ts`): issue/procurement/record
  badges map to semantic tokens via the `bg-token/10 + text-token` idiom, so they
  theme correctly in light/dark and read consistently across list, overview, and
  detail. Text-on-tint pairs (`text-warning` on `bg-warning/10`, etc.) clear AA.
  No issue found.
- **Priority signal** (`shared/components/priority-signal.tsx`): solid dots per
  level with distinct hues (gray/info-blue/warning/destructive) resolving the
  prior low-vs-medium ambiguity; `PrioritySignal` exposes `title`+`aria-label`,
  the decorative `PriorityGlyph` is `aria-hidden`. Dots are graphical (3:1
  threshold) and labeled for AT. No issue found.
- **CSS-grid column alignment** (`-project-issues-tab.tsx:87-88`,
  `-project-procurement-tab.tsx:71-75`): shared grid templates with fixed tracks +
  a single `minmax(0,1fr)` title track and progressive `sm/md` columns keep cells
  aligned across rows; procurement renders a header row over the same template;
  hidden cells use `display:none` so track counts stay consistent. Sound.
- **Empty / loading / error states**: present and consistent for the project list
  (`index.lazy.tsx:152-156`), issues tab (`:345-352`, per-group `:384`), procurement
  tab (`:213-218`), overview cards (`ListState` loading/empty), and both panels
  (`CenteredHint` loading/error). Errors surface via `ErrorBanner`. Good coverage.
- **Tab nav active-underline** (`$projectId.lazy.tsx:148-171` + `ui/tabs.tsx`):
  uses the `line` variant with `data-active` font/colour + an `::after` underline
  driven only on the active trigger; `overflow-x-auto` handles narrow widths.
  Triggers keep focus-visible rings from the primitive. No issue found.
- **Search inputs**: every search box pairs a decorative `aria-hidden` icon with an
  `aria-label`ed `Input` (`index.lazy.tsx:140-149`, issues `:326-334`, procurement
  `:177-188`). Good.
- **Dialogs via base-ui** (`ui/dialog.tsx`): create dialogs and the settings/role
  dialogs use the primitive (focus trap, Escape, labelled title — including the
  `sr-only` `DialogTitle` in the borderless create-issue dialog). The drawers are
  the exception (F1/F2).
- **Roles dialog** (`-project-settings-roles.tsx`): per-module tiers use real
  `<fieldset><legend>` + `RadioGroup`, admin caps use labelled `Switch` with
  `htmlFor`/`id`. Accessible form structure. No issue found.
- **Responsive layout**: toolbars use `flex-wrap`; list grids collapse
  4→2→1 / progressive `sm/md` columns; drawers go full-width under `sm`; files tab
  sizes via `svh`. Reasonable mobile behavior.
