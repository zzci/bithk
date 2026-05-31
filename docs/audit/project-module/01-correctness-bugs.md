# Audit Lane 01 — Correctness / Bugs (Project Module)

P0 x0 .. P1 x0 .. P2 x1 .. P3 x8

Scope: project-module frontend (`apps/web/src/app/routes/_app/projects/*`, shared
`priority-signal.tsx`, `status-colors.ts`) plus the backend list endpoint insofar as
the list view consumes it. Emphasis per lane brief: regressions from this session's
UI churn — aligned CSS-grid lists, priority solid-dot, status enum, tab-nav
active-only underline, borderless procurement table, app-wide button `h-8` sweep.

Read this session: `index.lazy.tsx`, `$projectId.lazy.tsx`, `$projectId.issues.lazy.tsx`,
`-project-overview-tab.tsx`, `-project-issues-tab.tsx`, `-project-procurement-tab.tsx`,
`-project-tag-filter.tsx`, `-project-tag-filter-logic.ts`, `-project-tabs.ts`,
`-use-project-role.ts`, `-member-helpers.ts`, `-project-stats.tsx`,
`shared/components/priority-signal.tsx`, `shared/lib/status-colors.ts`,
`shared/lib/api/{projects,procurement,pins}.ts`, `project.routes.ts` (list handler).

---

## P2 — Medium

### F1: Projects list search only filters the current page (client-side), so matches on other pages silently disappear
- Severity: **P2** (escalates to user-facing-wrong once a status bucket exceeds one page / `limit` 20)
- Location: `apps/web/src/app/routes/_app/projects/index.lazy.tsx:62-72` (filter) and `:49` (`useProjects({ ...projectsFilterToQuery(filter), page })`); backend confirms no server search at `apps/api/src/modules/project/project.routes.ts:242-245` (only `status`, `tagId`, `page`, `limit` are read), and `useProjects` carries no `q` param (`apps/web/src/shared/lib/api/projects.ts:176-208`).
- Description: `visibleProjects` runs `name/code/description` substring matching over `projectsQuery.data?.data`, which is *one server page* (`limit` defaults to 20). The search box looks global but only sees the ~20 rows currently paginated in. A project whose name matches but lives on page 2+ never appears; the user sees `list.empty` and concludes it does not exist.
- Impact: Incorrect/incomplete search results — a data-correctness defect that misleads the operator. Also interacts badly with pagination: the footer `totalPages`/`total` (`index.lazy.tsx:57-60,158-166`) reflect the *unfiltered* server total, so the user can be on "page 2 of 3" while the client filter shows zero rows, with no indication the filter is page-local.
- Recommended fix (not applied): Push search to the server — add an optional `q` to `ProjectsQuery`/`useProjects` and to the backend list handler/service (parameterized `name`/`code`/`description` match), include `q` in the query key, and reset `page` to 1 on search change (as the issues/procurement tabs already do). If a server change is out of scope short-term, at minimum hide/replace the pagination controls and the `list.empty` copy while a client search is active so the page-local scope is not presented as a global result.

---

## P3 — Low / Nit

### F2: `StatCard` / `StatStrip` are dead code (defined, never rendered)
- Severity: **P3**
- Location: `apps/web/src/app/routes/_app/projects/-project-stats.tsx:1-69`; the only repo reference is the file's own definition (no importer anywhere under `apps/web/src`).
- Description: The "list KPI strip / detail hero metrics" components survived the redesign but no route or tab imports them. The redesigned overview/list use `Card`/inline markup instead.
- Impact: Dead surface area — misleads maintainers into thinking the KPI strip is live, and ships unused bytes. Not a runtime bug.
- Recommended fix (not applied): Remove `-project-stats.tsx` (and its any test) if the KPI strip is not coming back; otherwise wire it into the list/overview. (Flagging only — deletion is out of scope for this read-only lane.)

### F3: `StatCard` active state renders no ring (ring color set without a ring width)
- Severity: **P3**
- Location: `apps/web/src/app/routes/_app/projects/-project-stats.tsx:42` — `active && "bg-primary/5 ring-primary/20"`.
- Description: Tailwind needs a ring-width utility (`ring`/`ring-1`/`ring-2`) for `ring-<color>` to paint. Only `ring-primary/20` is present, so the intended active outline never shows; just the faint `bg-primary/5` differentiates the pressed tile. (Compounded by F2 — the component is currently unused.)
- Impact: Cosmetic; the "selected filter chip" affordance is weaker than intended if the component is ever mounted.
- Recommended fix (not applied): Add an explicit width, e.g. `active && "bg-primary/5 ring-1 ring-primary/20"`.

### F4: Procurement status palette collapses two distinct lifecycle states to the same color
- Severity: **P3**
- Location: `apps/web/src/shared/lib/status-colors.ts:28-36` — `ordered` and `in_transit` both `bg-info/10 text-info`; `received` and `accepted` both `bg-success/10 text-success`.
- Description: The 7-status vocabulary maps onto 5 color buckets, so two adjacent lifecycle states are visually indistinguishable in the borderless list badge and overview chips. The label still differs, but the color cue (the whole point of the badge) does not.
- Impact: Operators cannot distinguish ordered-vs-in-transit / received-vs-accepted at a glance in the list. Cosmetic/UX, not a logic fault.
- Recommended fix (not applied): Either accept the collapse intentionally (document it) or pick distinct tints — e.g. keep `ordered`=info, give `in_transit` a separate tone (e.g. a sky/teal token), and differentiate `received` (in-progress success) from `accepted` (final) similarly.

### F5: `todo` status renders two different colors within the issues tab
- Severity: **P3**
- Location: `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx:63-69` (`STATUS_ICON_TINT.todo = "text-muted-foreground"`) vs `:72-78` (`STATUS_DOT.todo = "bg-warning"`) and `apps/web/src/shared/lib/status-colors.ts:18` (`ISSUE_STATUS_BADGE.todo = warning`).
- Description: The section-header/row `StatusIcon` tints `todo` as muted gray, while the create-dialog status dot and the overview status badge tint `todo` as warning/amber. The comment at `:62` claims the icon tints are "aligned with the global status color tokens," but `todo` diverges.
- Impact: Same status reads gray in the list icon and amber in the dialog/badge — minor inconsistency, not a functional break.
- Recommended fix (not applied): Decide one `todo` tone. If gray is intentional for the empty-circle glyph, drop the "aligned with global tokens" claim; otherwise change `STATUS_ICON_TINT.todo` to `text-warning` to match the badge/dot.

### F6: Stale header/inline comments in the issues tab describe removed UI
- Severity: **P3**
- Location: `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx:1-10` (file header) and `:71-72` (STATUS_DOT comment).
- Description: The header doc says the tab has "a clickable status-filter chip row and clickable section headers [that] both select the active status," and a per-status "+ quick-create." The current code has no status-filter chip row (`visibleStatuses` always shows every populated group, `:280-281`), section headers toggle *collapse* not status selection (`:371`), and the only create entry is the top "New" button (`:336-341`; per-status `+` was removed). The `STATUS_DOT` comment at `:71-72` says it feeds "filter chips + create dialog selector," but `STATUS_DOT` is now only used in the create dialog (`:606,:613`).
- Impact: Comments contradict behavior; a maintainer reading the header will look for affordances that no longer exist. No runtime effect.
- Recommended fix (not applied): Rewrite the header to describe the current always-expanded, collapse-only, single-create-button layout, and trim the `STATUS_DOT` comment to "create-dialog status selector."

### F7: A single status query failure blanks the entire issues list
- Severity: **P3**
- Location: `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx:276` (`loadError = groups.find(g => g.error)?.error`) and `:349-350` (`loadError ? null`).
- Description: The five per-status queries are independent, but if any one errors, `loadError` is truthy and the whole list region renders `null` (only the banner shows), discarding the four groups that loaded fine.
- Impact: Over-aggressive fail-closed: one transient 5xx on, say, the `cancel` bucket hides all `todo/working/review/done` rows. Low likelihood (all five hit the same endpoint, so they tend to fail together) and arguably acceptable, but it is a correctness/resilience smell worth recording.
- Recommended fix (not applied): Render the groups that succeeded and show the error inline/non-blocking (e.g. only suppress the failed section), rather than gating the whole list on `loadError`.

### F8: Procurement category filter goes stale when the selected category is deleted
- Severity: **P3**
- Location: `apps/web/src/app/routes/_app/projects/-project-procurement-tab.tsx:166-174` (filter wiring) and `:302-303` (`ToolbarFilter` `current = ... options.find(...) ?? allLabel`); filter value still sent at `:110` (`categoryId: categoryFilter === "__all__" ? undefined : categoryFilter`).
- Description: If a category is removed (settings) while `categoryFilter` holds its id, `ToolbarFilter` can no longer find the option and falls back to displaying `allLabel` ("All categories"), yet the query still sends the deleted `categoryId`, returning an empty/odd result set.
- Impact: UI says "All categories" while silently filtering by a ghost id → confusing empty list. Edge case (requires concurrent deletion).
- Recommended fix (not applied): When the active `categoryFilter` id is absent from the loaded `categories`, reset it to `__all__` (e.g. an effect, or guard in the change handler), so the displayed label and the applied filter cannot diverge.

### F9: Inline-tag cap can force a "More" trigger even when every chip fits
- Severity: **P3**
- Location: `apps/web/src/app/routes/_app/projects/-project-tag-filter.tsx:125-128` — `count = Math.max(0, Math.min(visibleCount, tags.length, 7))`, then `overflow = tags.slice(count)`.
- Description: `computeVisibleTagCount` may report that, say, 9 chips fit with no overflow control (so it reserved no width for "More"). The hard cap of 7 then forces `overflow.length > 0`, rendering a "More" trigger whose width was never accounted for in the fit math. The container is `overflow-hidden` (`:131`), so the extra trigger is clipped rather than wrapping.
- Impact: Cosmetic — with 8–9 narrow tags the row may clip its last inline chip or the "More" button. No data/logic fault.
- Recommended fix (not applied): Feed the 7-cap into `computeVisibleTagCount` (cap `widths` to 7 before measuring) so the fit math reserves "More" width whenever the cap actually truncates, or only cap after confirming overflow already exists.

---

## Areas checked — no issues found

- **Aligned CSS-grid lists (the headline churn).** Issues `ROW_GRID_CLASS` (`-project-issues-tab.tsx:87-88`) and procurement `PROCUREMENT_GRID` (`-project-procurement-tab.tsx:71-75`) were checked cell-by-cell against their rendered children at each breakpoint. Issues: base 4 tracks = [status+id][title][avatar][priority] (tags `sm:flex`, due `md:flex` are `display:none` and drop out of flow at base); sm 5 tracks add tags; md 6 tracks add due — visible-cell count matches track count at every breakpoint. Procurement header (`:224-232`) and data rows (`:244-253`) each emit 7 cells with category (`sm:block`) and supplier (`md:block`) hidden below their breakpoints; base 5 / sm 6 / md 7 tracks all line up, and the `canManage` pin gutter is reserved symmetrically in header (`:233`, `w-9`) and rows (`:256`, `w-9`). Column order matches the documented template. No misalignment found.
- **Priority solid-dot.** `priority-signal.tsx` `PRIORITY_META` covers all four levels exactly; `PrioritySignal`/`PriorityGlyph` are total over the `Priority` union, so no `undefined` class lookup. Consumers in both lists pass `issue.priority`/`row.priority` from the typed row. Clean.
- **Tab-nav active-only underline + routing.** `activeProjectTab` (`-project-tabs.ts:25-36`) resolves nested detail routes (`…/issues/$issueId`, `…/procurements/$id`, `…/files`) to the owning tab and falls back to overview; `PROJECT_TAB_TO` covers every tab key; `$projectId.lazy.tsx:148-171` drives `Tabs value={tab}` from the path with a null-guarded `onValueChange`. Prefix-collision in `pathname.startsWith(base)` is not reachable because `pathname` always belongs to the current `projectId`. Clean.
- **Capabilities / role gating.** `computeCapabilities` (`-use-project-role.ts:39-65`) is a pure, total derivation; admin bypass seeds the full set; `canOpenSettings` is the OR of the four manage caps. Issue/procurement tabs gate create/pin on `canManage` and mirror the backend pin rule (`-project-issues-tab.tsx:230-232`). The `issues.lazy.tsx` viewer redirect (`:33-39`) is correctly keyed on resolved `projectQuery.data`. Clean.
- **Pin optimistic/invalidations.** `useToggleIssuePin`/`useToggleProcurementPin` (`pins.ts:59-86`) invalidate prefixes (`["projects",projectId,"issues"]`, `procurementKeys.byProject`) that correctly cover the list keys (`projects.ts:146`, `procurement.ts:93-95`) and the pinned-items key — no stale-after-toggle. No optimistic cache write to roll back, so no rollback bug.
- **Create dialogs.** Issue (`-project-issues-tab.tsx:505-697`) and procurement (`-project-procurement-tab.tsx:364-584`) dialogs guard on `!title.trim()/!itemName.trim()` and `isPending`, build the body with conditional spreads (no `undefined`/empty fields leaking), and `reset()` covers every field. `key={createStatus}` remount on the issue dialog correctly re-seeds `initialStatus`. Clean.
</content>
</invoke>
