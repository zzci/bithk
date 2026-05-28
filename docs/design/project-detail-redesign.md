# Project Detail Page Redesign — Design Note

**Status:** Approved direction. This note is the implementation contract for the
8-frontend L3. Layout/interaction here is final; do not re-seek approval.

**Scope of redesign:** `apps/web/src/app/routes/_app/projects/$projectId.lazy.tsx`
and `-project-overview-tab.tsx`. Issues / Procurement / Files tab internals are
unchanged except for the pin control added to their rows (see §5).

**Hard constraints:** shadcn/ui (base-nova) + `@base-ui/react` primitives only.
No new dependencies. No new backend fields — "announcement" reuses
`project.description`; pin reuses the shared item base `pinnedAt`.

UI label note: the "issues" module is labelled **Work Orders** in this app
(`tabs.issues` = "Work Orders"). Code identifiers keep `issues`.

---

## 1. Data dependency (must verify before build)

The pin feature is assumed to live on the **shared item base** (`modules/item`),
exposing on every issue and procurement row:

- `pinnedAt: string | null` (ISO; non-null ⇒ pinned)
- a pin/unpin mutation on the item

**Today these fields do NOT yet exist** on `ProjectIssueRow`
(`projects.ts:97`) or `ProcurementRow` (`procurement.ts:35`), and `items`
schema (`item/schema.ts:14`) has no pin column. The implementation L3 must
confirm the pin-feature L3 has landed `pinnedAt` + the API to list pinned items
before wiring the Overview pin area. If absent, the pin area renders its empty
state and the row pin control is hidden behind the capability — never invent a
field.

A dedicated "pinned items for project" query is preferred (mixed issues +
procurements, `pinnedAt DESC`); if unavailable, the Overview derives the pinned
list client-side from the already-loaded latest-issues / latest-procurements
plus a small `pinned=true` fetch per type, then merges and sorts by `pinnedAt`.

---

## 2. New page layout tree — `$projectId.lazy.tsx`

Remove the big persistent cover+info `Card` (current lines 130–193) and the
`Members` tab entirely. The cover/creator/updatedAt/tags/stat block **moves
into the Overview tab** (§3). Members tab and member-preview are deleted.

```
<div className="space-y-5">
  ── Breadcrumb (unchanged) ──────────────────────────────
  <nav aria-label={t("detail.breadcrumb")}>           // projects ▸ {name}
    <Button ghost>{page.title}</Button> <ChevronRight/> <span>{project.name}</span>
  </nav>

  ── Compact title row (NEW; replaces the hero card) ─────
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex min-w-0 items-center gap-3">
      <h1 className="truncate text-2xl font-semibold">{project.name}</h1>
      <Badge variant="secondary" className={RECORD_STATUS_BADGE[status]}>{status}</Badge>
      {project.code && <span className="font-mono text-xs text-muted-foreground">{code}</span>}
    </div>
    {(canOpenSettings || canManageProject) && (
      <div className="flex shrink-0 gap-2">
        {canOpenSettings && <Button variant="outline" size="sm"><Settings/>{settings}</Button>}
        {canManageProject && <Button variant="outline" size="sm"><Trash2 destructive/>{delete}</Button>}
      </div>
    )}
  </div>

  ── Primary tabs (PROMOTED to page heading) ─────────────
  <Tabs value={tab} onValueChange=...>
    <TabsList variant="line"
              className="h-auto gap-6 border-b text-base">       // see §2.1
      <TabsTrigger value="overview" className="pb-2 text-base font-medium data-[selected]:font-semibold">{tabs.overview}</TabsTrigger>
      <TabsTrigger value="issues" ...>{tabs.issues}{count}</TabsTrigger>
      {canViewProcurement && <TabsTrigger value="procurement" ...>{tabs.procurement}{count}</TabsTrigger>}
      <TabsTrigger value="files" ...>{tabs.files}</TabsTrigger>
      {/* NO members trigger */}
    </TabsList>

    <TabsContent value="overview" className="pt-6">
      <ProjectOverviewTab project={project} userNames={userNames} caps={caps} />
    </TabsContent>
    <TabsContent value="issues" className="pt-6"><ProjectIssuesTab .../></TabsContent>
    {canViewProcurement && <TabsContent value="procurement" className="pt-6"><ProjectProcurementTab .../></TabsContent>}
    <TabsContent value="files" className="pt-6"><FileBrowser .../></TabsContent>
  </Tabs>

  {canOpenSettings && <ProjectSettingsDialog .../>}   // members managed here only
  <ConfirmDeleteDialog .../>
  <Outlet/>
</div>
```

### 2.1 Tabs as primary navigation — exact treatment

Keep `variant="line"` (the only shadcn tab style here) but scale it up so the
tab bar reads as the page's primary nav rather than a secondary control:

- `TabsList`: `h-auto gap-6 border-b border-border` (full-width underline rail).
- `TabsTrigger`: `text-base pb-2`, inactive `text-muted-foreground`, active
  `text-foreground font-semibold` with the line indicator. (Today they are
  `text-sm` secondary — the bump to `text-base` + heavier weight + the gap-6
  rail is the promotion. No custom CSS; Tailwind classes on the primitives.)
- Counts stay inline (` {n}`) as today via `tabCount()`. Drop the member count.
- Non-overview tabs render **full-width** with no wrapper card — `ProjectIssuesTab`,
  `ProjectProcurementTab`, `FileBrowser` already do; just remove the hero card
  above them.

### 2.2 Code removals

- Delete `import { ProjectMembersTab }` and its `<TabsContent value="members">`.
- Delete the members `<TabsTrigger>`; remove `members.length` from tab counts.
- `useProjectMembers` **stays** (assignee dropdowns in issues/procurement still
  need it) — keep `members`/`userNames` loading, just stop rendering member UI.
- Move `CoverImage`, tags, `StatStrip`/`StatCard`, creator/updatedAt rendering
  out of the route file into the Overview tab. The route keeps only the compact
  title row.

---

## 3. Overview tab redesign — `-project-overview-tab.tsx`

**Remove:** the procurement-category preview card and the member-preview card.
**Add** the moved info block, the announcement, the mixed pin area, and the two
"latest 5" lists.

New props: `{ project, userNames, caps }` (drop `members`). `caps` gates the
procurement column.

Section order (top → bottom):

```
<div className="space-y-6">

  1. INFO BLOCK  (moved from old header) ─ Card, 2-col on desktop
     <Card><CardContent className="grid gap-4 lg:grid-cols-[16rem_1fr]">
       <CoverImage src={coverImageUrl} kind="project" className="min-h-40 rounded-lg border"/>
       <div className="flex flex-col gap-4">
         <div className="text-xs text-muted-foreground">          // meta line
           creator: {userNames.get(creatorId)} · updated: {formatDate(updatedAt)}
         </div>
         {tags.length > 0 && <div className="flex flex-wrap gap-1">{tags.map(Badge secondary)}</div>}
         <StatStrip className={canViewProcurement ? "lg:grid-cols-2" : "lg:grid-cols-1"}>
           <StatCard label={metrics.issues} value={issuesCount} icon={ClipboardList}/>
           {canViewProcurement && <StatCard label={metrics.procurement} value={procurementCount} icon={Package}/>}
           {/* member StatCard DROPPED — lean, no member-centric UI */}
         </StatStrip>
       </div>
     </CardContent></Card>

  2. ANNOUNCEMENT  (reuses project.description, NO new field)
     <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">
        {overview.announcement}</CardTitle></CardHeader>
       <CardContent><p className="text-sm whitespace-pre-wrap">
         {description || <span muted>{overview.noAnnouncement}</span>}</p></CardContent>
     </Card>

  3. PINNED  (mixed issues + procurements; §4)
     <ProjectPinnedSection projectId caps />     // new local component

  4. LATEST WORK ORDERS (top 5)
     <Card><CardHeader row>
        <CardTitle>{overview.latestIssues}</CardTitle>
        <Button variant="link" size="sm" onClick={() => setTab("issues")}>{overview.viewAll}</Button>
       </CardHeader>
       <CardContent> latest-5 issue rows | empty state </CardContent>
     </Card>

  5. LATEST PROCUREMENTS (top 5)  ─ only if canViewProcurement
     {canViewProcurement && <Card> … {overview.latestProcurements} … viewAll → "procurement" … </Card>}
</div>
```

- "Latest 5" uses the existing list hooks with `{ limit: 5 }` (sorted newest
  first by the existing default). Each row: title + status `Badge` +
  assignee/updatedAt muted; whole row links into the tab (issues → set tab to
  `issues`; clicking a single row may deep-link to the issue route if cheap,
  otherwise just switch tab). Keep it read-only — no inline editing in Overview.
- "View all" is a shadcn `Button variant="link"` that switches the parent tab.
  Overview must accept a `setTab`/`onNavigateTab` callback from the route, or
  the route passes tab setters down. Simplest: pass `onOpenTab: (tab) => void`.
- Procurement sections (stat card, latest list) are fully gated by
  `caps.canViewProcurement`.

---

## 4. Pinned area — mixed list spec

A single card holding pinned **issues and procurements together**, sorted
`pinnedAt DESC`.

```
<Card>
  <CardHeader><CardTitle className="text-sm text-muted-foreground">{overview.pinned}</CardTitle></CardHeader>
  <CardContent>
    {loading  → muted "overview.pinnedLoading"}
    {empty    → muted "overview.noPinned"  (see empty state)}
    {list     → <ul className="divide-y rounded-md border">
                   {pinned.map(row → <PinnedRow/>)}
                </ul>}
  </CardContent>
</Card>
```

**PinnedRow** (one line, type-distinguished):

```
<li className="flex items-center gap-3 px-3 py-2">
  <Badge variant="outline" className="shrink-0 gap-1">
    {isIssue ? <ClipboardList className="size-3"/> : <Package className="size-3"/>}
    {isIssue ? overview.pinKind.issue : overview.pinKind.procurement}
  </Badge>
  <span className="min-w-0 flex-1 truncate text-sm">{title || itemName}</span>
  <Badge variant="secondary" className={STATUS_BADGE[status]}>{statusLabel}</Badge>
  <Pin className="size-3.5 text-muted-foreground shrink-0" aria-hidden/>   // pinned marker
</li>
```

Issue-vs-procurement distinction = the **leading outline `Badge`** with a
distinct icon (`ClipboardList` for work orders, `Package` for procurement) and
a kind label. Optionally tint the badge border per kind, but icon + label is
the required signal (not color alone — see accessibility). Rows link into the
respective tab/detail like the latest lists.

**Empty state:** muted single line, `overview.noPinned` ("Nothing pinned yet.
Pin a work order or procurement to surface it here."). No illustration.

---

## 5. Pin control placement on rows

The pin/unpin toggle lives **on each issue row and each procurement row inside
their own tabs** (not in Overview — Overview is read-only display of the
result).

- **Issue rows** (`-project-issues-tab.tsx`, list view): add a trailing icon
  `Button variant="ghost" size="icon"` with a `Pin` (outline when unpinned) /
  `PinOff` or filled `Pin` (when pinned) lucide icon, in the row's existing
  action/affordance slot at the right edge. In Kanban view, place it in the
  card's top-right corner. `aria-pressed={!!pinnedAt}`, `aria-label` =
  `overview.pinAction` / `overview.unpinAction`.
- **Procurement rows** (`-project-procurement-tab.tsx`): same trailing
  ghost-icon toggle at the row's right edge, mirroring the issues placement.
- Gating: show the toggle only when the user can edit the item (reuse the
  existing per-item manage capability already used for those rows; pinning is a
  manage-level action). Viewers see pinned state reflected in Overview but no
  toggle.
- On toggle: optimistic update + invalidate the pinned-items query and the
  relevant list query. Reuse the standard mutation error toast pattern
  (`errorMessage`, `toast.error`).

No popover/menu needed — a direct icon toggle keeps it within available
primitives.

---

## 6. Responsive behavior & spacing

- **Page rhythm:** route uses `space-y-5`; Overview uses `space-y-6`. Tab
  content `pt-6`.
- **Title row:** `flex-wrap` — on mobile the name+status wrap above the action
  buttons; actions keep `shrink-0`. `h1` is `text-2xl` (down from old `text-3xl`
  hero) to suit a compact row.
- **Tab rail:** horizontally scrollable on narrow widths if triggers overflow
  (`overflow-x-auto` on `TabsList`); never wrap the rail.
- **Info block:** `grid lg:grid-cols-[16rem_1fr]` — cover stacks above the meta
  on mobile/tablet (`grid-cols-1`), side-by-side ≥ `lg`.
- **Stat strip:** `grid-cols-1` mobile → `sm:grid-cols-2` (issues+procurement);
  single column when procurement hidden.
- **Latest lists / pinned:** single column at all widths; rows truncate titles,
  status badge + marker stay pinned right via `shrink-0`.
- **Breakpoints:** mobile `<640`, tablet `640–1024`, desktop `≥1024` (`sm`/`lg`
  Tailwind defaults). No custom breakpoints.

---

## 7. Accessibility

- **Tabs:** keep shadcn `Tabs` primitive semantics (roving tabindex,
  `role="tablist"/"tab"/"tabpanel"`, arrow-key nav) — do not hand-roll. The
  size/weight promotion is visual only; the `h1` remains the page's single
  top-level heading, tabs are navigation below it.
- **Title row:** `h1` is the accessible page title; status `Badge` has a text
  label (not color-only).
- **Pin distinction:** issue vs procurement conveyed by icon **and** text label
  inside the badge, never color alone (WCAG 1.4.1). Status badges reuse
  `RECORD_STATUS_BADGE`/status-color tokens which already pair label + tint.
- **Pin toggle:** `<Button>` with `aria-pressed` and a descriptive
  `aria-label`; icon `aria-hidden`. Reachable by keyboard, visible focus ring
  via shadcn defaults.
- **"View all":** real `Button` (link variant) with discernible text, not a
  bare icon.
- **Contrast:** muted text uses `text-muted-foreground` token (theme-checked);
  do not drop below it for body copy.

---

## 8. i18n keys the implementation will need (names only)

Under namespace `projects`:

- `overview.announcement`
- `overview.noAnnouncement`
- `overview.pinned`
- `overview.pinnedLoading`
- `overview.noPinned`
- `overview.pinKind.issue`
- `overview.pinKind.procurement`
- `overview.pinAction`
- `overview.unpinAction`
- `overview.latestIssues`
- `overview.latestProcurements`
- `overview.viewAll`

Removed/now-unused (clean up when safe): `overview.memberPreview`,
`overview.categoryPreview`, `overview.categoriesLoading`, `overview.noMembers`,
`tabs.members`, `detail.metrics.members`.

Add the same keys to `en` and `zh` locale files.

---

## 9. Implementation checklist (for the 8-frontend L3)

1. Confirm `pinnedAt` + pinned-items API exist (§1); if not, coordinate before
   wiring the pin area / row toggles.
2. Strip the hero card, members tab, member counts from the route; add the
   compact title row + promoted tabs (§2).
3. Rebuild Overview sections in order (§3); delete category + member previews.
4. Add the mixed pinned section component (§4) and row pin toggles (§5).
5. Add i18n keys (§8) to `en` + `zh`.
6. `bun run check` green; no new deps; shadcn primitives only.
