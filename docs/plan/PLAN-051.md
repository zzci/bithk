# PLAN-051 Extract shared frontend components (lists, detail panels, form fields)

- **status**: completed
- **createdAt**: 2026-06-02 05:42
- **approvedAt**: 2026-06-02 05:42
- **relatedTask**: REFACTOR-010, REFACTOR-011, REFACTOR-012, REFACTOR-013, REFACTOR-014, REFACTOR-015

## Context

A global frontend audit of `apps/web/src` found significant duplication across
the project / ship / contact / issue / procurement surfaces. Findings:

### Detail panels (highest duplication)

- `shared/components/resource/` (attachment-section, comment-section,
  footer-sections, use-attachment-upload) is **already shared** across issue /
  procurement / document — a good model.
- `app/routes/_app/projects/-resizable-drawer.tsx` is already a shared drawer,
  used by the issue and procurement detail routes.
- BUT the panel *bodies* duplicate heavily:
  `-project-issue-panel.tsx` (636 lines) vs `-project-procurement-panel.tsx`
  (729 lines) are ~72% identical:
  - Header + inline title edit + button group: 100% identical
  - Meta row (status / priority / assignee / due date): 100% (only label keys differ)
  - Tags row: byte-for-byte identical
  - Description edit region: identical
  - Creator footer: identical
  - Edit state mgmt (titleDraft/descDraft/save/Escape): ~95% identical
  - Procurement-only: detail table (supplier/category/qty/amount/currency) + InlineValue
  - Issue-only: delete button + delete confirm dialog
- Full-screen vs drawer already share one panel via `variant="drawer"|"fullscreen"`.

### Cover field

- `projects/-project-cover-field.tsx` (65 lines) and
  `ships/-ship-cover-field.tsx` (52 lines) are ~95% identical; only difference is
  ship omits the toast and uses a different mutation hook. `cover-image.tsx` is
  already shared.

### Tag utilities

- `addTag` / `removeTag` are defined twice: `projects/-project-form-logic.ts`
  and `contacts/-contact-form-logic.ts`.
- `projects/-tags-input.tsx` exists but is only referenced by tests; the contact
  form hand-rolls the same chip/Enter/Backspace logic instead of reusing it.

### Lists

- 7 list surfaces. They split into two natural families plus outliers:
  - Card grid: `projects/index.lazy.tsx` ~ `ships/index.lazy.tsx` (~90% similar)
  - Responsive table: `contacts/index.lazy.tsx` ~ `-project-procurement-tab.tsx` (~95% similar)
  - Outliers (do NOT unify): `-project-issues-tab.tsx` (status-grouped, unpaged),
    drive `-drive-file-list-inner.tsx` (already container-ised as `DriveFileListSurface`).
- Within nearly every list, three blocks repeat near-verbatim:
  - Pagination footer (prev/next + total): ~98% identical, 5 sites
  - Dropdown toolbar filter: ~95% identical (procurements/contacts)
  - Debounced search input markup (a `useDebounce` hook already exists)

## Proposal

Phased extraction, lowest-risk first. Each phase is one task; behaviour must be
unchanged (pure refactor — verify by existing tests + `bun run check`).

### Phase 1 (P1)

- **REFACTOR-010 — Shared detail panel.** Two sub-steps:
  - *Step A (first):* extract the identical header (back / inline-editable title /
    delete / maximize / close, `-project-issue-panel.tsx:272-356`) into
    `shared/components/detail-panel-header.tsx`. Title-edit state is owned inside
    the component; `onDelete?`/`onMaximize?` control button visibility. The delete
    confirm dialog stays in the issue panel. Independently shippable.
  - *Step B:* extract the rest of the skeleton into
    `app/routes/_app/projects/-detail-panel.tsx` plus a
    `-use-detail-panel-editor.ts` hook (description draft + panel Escape). Issue /
    procurement keep their domain-specific slots (procurement detail table; issue
    delete action) as children/props.
  - Target: remove ~460 lines of duplication.
- **REFACTOR-011 — Shared CoverField.** Create `shared/components/cover-field.tsx`
  parameterised by `{ kind, currentUrl, onPick, onRemove, showToast }`. Delete
  the two per-module copies; update `ProjectSettingsGeneral` and `ShipOverviewTab`
  consumers.

### Phase 2 (P2)

- **REFACTOR-012 — List primitives.** Extract to `shared/components`:
  `pagination-footer.tsx`, `toolbar-filter.tsx`, and a `debounced-search-input.tsx`
  (or standardise on the existing `useDebounce`). Wire into projects / ships /
  contacts / procurements lists.
- **REFACTOR-013 — Tag utilities + TagsInput reuse.** Move `addTag`/`removeTag`
  to `shared/lib/tag-utils.ts`; point both form-logic files and `TagsInput` at
  it. Replace the contact form's hand-rolled tag editor with `<TagsInput>`.

### Phase 3 (P2, optional / can be dropped)

- **REFACTOR-014 — ResponsiveTableList** for contacts + procurements.
- **REFACTOR-015 — CardGridList** for projects + ships.
  Both are larger container abstractions; only proceed if Phase 1–2 land cleanly
  and the abstraction stays simple. If they start needing many flags, stop and
  keep the per-module lists.

### Explicitly out of scope

- Unifying the issues list, the drive file list, or the create dialogs — their
  domain logic diverges too much; a shared shell would be more complex than the
  duplication it removes.
- A unified `FormDialog` shell — the three dialogs diverge on layout (project
  Linear-style `p-0` vs standard ship/contact). Deferred; revisit only if a 4th
  form dialog appears.

## Risks

- Pure refactor: behaviour regressions are the main risk. Mitigated by existing
  per-module tests (`-project-issue-panel.test.tsx`, `-contact-list.test.tsx`,
  etc.) and `bun run check`.
- `-project-issue-panel.test.tsx` is known-flaky from a milkdown teardown race;
  re-run or run filtered before trusting a failure.
- Over-abstraction risk in Phase 3 — guarded by the "stop if it needs many flags"
  rule above.
- Issue panel has an extra permission branch (isCreator/isAssignee) the
  procurement panel lacks; the shared skeleton must keep permission decisions in
  the caller, not bake them in.

## Scope

`apps/web/src` only; no API/DB changes. New shared files under
`shared/components/` and `shared/lib/`; edits to issue/procurement panels, the
two cover fields, and the four list surfaces. Phases are independently
shippable; recommend approving Phase 1 first.

## Alternatives

- **Single mega "DataList" component** for all lists — rejected; the 7 lists
  differ too much (paging vs not, grid vs table vs status-grouped, drag-drop).
- **Config-driven detail panel** (one component, two config objects) instead of
  skeleton + slots — viable but the issue-only delete flow and procurement-only
  table are awkward to express as config; slots are simpler.

## Migration Guide

Global components are **defined and verified** (typecheck + lint green) but **not
yet wired in** — no existing file was modified. Migrate consumers later, one
component at a time; each is independent. Run `bun run check` after each.

New files:

| Component | File | Replaces |
| --- | --- | --- |
| `DetailPanelHeader` | `shared/components/detail-panel-header.tsx` | issue/procurement panel header block |
| `CoverField` | `shared/components/cover-field.tsx` | `ProjectCoverField`, `ShipCoverField` |
| `PaginationFooter` | `shared/components/pagination-footer.tsx` | inline prev/next footers (4 lists) |
| `SearchInput` | `shared/components/search-input.tsx` | inline Search-icon+Input markup (4 toolbars) |
| `addTag`/`removeTag` | `shared/lib/tag-utils.ts` | dup copies in project/contact form-logic |

### 1. DetailPanelHeader (REFACTOR-010 Step A)

Consumers: `-project-issue-panel.tsx` (header at lines 272-356) and
`-project-procurement-panel.tsx` (its matching header).

- Delete the local header `<div className="flex items-center gap-2 border-b ...">`
  block AND the panel's local `editingTitle`/`titleDraft` state + `startEditTitle`/
  `saveTitle` handlers (the component now owns title-edit state).
- Render instead:

```tsx
<DetailPanelHeader
  variant={variant}
  title={issue.title}
  titleEdit={permissions.canEditAll
    ? { canEdit: true, onSave: next => updateIssue.mutate({ title: next }), editHint: t("clickToEditTitle") }
    : undefined}
  labels={{
    back: t("backToList"),
    maximize: t("openFullPage"),
    close: t("common.close"),
    delete: t("common.delete"),
  }}
  onClose={onClose}
  onMaximize={variant === "drawer" ? onMaximize : undefined}
  onDelete={permissions.canDelete ? () => setDeleteOpen(true) : undefined}
/>
```

- Procurement: same call without `onDelete` (procurement has no delete) and
  `title={procurement.itemName}`, `onSave` → procurement title mutation.
- Keep the delete **confirm dialog** in the issue panel as-is; only its trigger
  moves into the header via `onDelete`.
- Verify: title click-to-edit, Enter/blur save, Escape revert; delete/maximize/
  close still work in both drawer and fullscreen.

### 2. CoverField (REFACTOR-011)

Consumers: `ProjectCoverField`, `ShipCoverField` (callers:
`ProjectSettingsGeneral`, `ShipOverviewTab`).

Replace each file's body (keep its own hooks + toast) with:

```tsx
// project
const setCover = useSetProjectCover();
const removeCover = useRemoveProjectCover();
const pending = setCover.isPending || removeCover.isPending;
const error = setCover.error ?? removeCover.error;
return (
  <CoverField
    kind="project"
    src={project.coverImageUrl}
    pending={pending}
    error={error ? errorMessage(error, t("common:common.error.operationFailed")) : null}
    onPick={file => setCover.mutate({ id: project.id, file }, {
      onSuccess: () => toast.success(t("toast.coverUpdated")),
      onError: err => toast.error(errorMessage(err, t("common:common.error.uploadFailed"))),
    })}
    onRemove={() => removeCover.mutate(project.id, {
      onSuccess: () => toast.success(t("toast.coverRemoved")),
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    })}
    labels={{ field: t("cover.label"), upload: t("cover.upload"), replace: t("cover.replace"), remove: t("cover.remove") }}
  />
);
```

- Ship: `kind="ship"`, ship hooks, NO toast (omit the success/error callbacks).
- The two wrappers `ProjectCoverField`/`ShipCoverField` can stay as thin adapters
  OR be inlined at their call sites and deleted.

### 3. PaginationFooter (REFACTOR-012)

Each list's `{totalPages > 1 && meta && (<div ...prev/next...>)}` becomes:

```tsx
{totalPages > 1 && meta && (
  <PaginationFooter
    page={page}
    totalPages={totalPages}
    totalLabel={t("procurement.total", { count: meta.total })}
    onPrev={() => setPage(p => p - 1)}
    onNext={() => setPage(p => p + 1)}
  />
)}
```

Swap `totalLabel` per list (`list.total`, etc.). Prev/Next text comes from the
shared component (`common.prev`/`common.next`).

### 4. ToolbarFilter — REMOVED (superseded by ListFilter)

**Decision (2026-06-02):** `ToolbarFilter` is dropped and
`shared/components/toolbar-filter.tsx` deleted. It never gained a consumer of the
shared copy; the single-dimension dropdown filter is fully covered by `ListFilter`
(§ the `ListFilter` entry), which is now the one documented filter primitive. The
procurement/contacts toolbars migrated to `ListFilter` directly.

### 5. SearchInput (REFACTOR-012)

Replace the `<div className="relative ..."><Search .../><Input .../></div>` block:

```tsx
<SearchInput
  value={search}
  onChange={(v) => { setSearch(v); setPage(1); }}
  placeholder={t("list.searchPlaceholder")}
  className="w-full sm:w-64"
/>
```

Keep the existing `useDebounce(search, 300)` in the consumer. Issues list (client
search) is out of scope.

### 7. ListToolbar — REMOVED (deprecated)

**Decision (2026-06-02):** `ListToolbar` is dropped and `list-toolbar.tsx`
deleted. It never gained a consumer, and its responsibilities split cleanly
across two existing primitives:

- **Filters** → `ListFilter` (§ the `ListFilter` entry): the declarative,
  flicker-free multi-dimension filter that replaced the old filter slot.
- **Search + create** → `SearchCreateBar` (§8), now with a bounded search box so
  it can sit as the right cluster of a `justify-between` row.

Compose them directly instead of a shell component:

```tsx
<div className="flex items-center justify-between gap-3">
  <ListFilter dimensions={[statusDimension, tagDimension]} />
  <SearchCreateBar
    search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: t("list.searchPlaceholder") }}
    create={isAdmin ? { label: t("list.create"), onClick: () => setCreateOpen(true) } : undefined}
  />
</div>
```

The original decision — relocate projects'/ships' create button from the title
row into the toolbar — still holds; it now lands on `SearchCreateBar`.

### 8. SearchCreateBar (REFACTOR-017)

New `shared/components/search-create-bar.tsx`. Search + create cluster with a
**bounded** search box (`w-full sm:w-64`). Two uses:

- Standalone for lists with no chip filters (e.g. contacts).
- Paired with `ListFilter` on the left of a `justify-between` row for lists that
  need filter controls (replaces the removed `ListToolbar`, §7).

Composes `SearchInput`.

Consumer: `contacts/index.lazy.tsx` toolbar. Replace its search `<div>` + create
button with:

```tsx
<SearchCreateBar
  search={{
    value: search,
    onChange: (v) => { setSearch(v); setPage(1); },
    placeholder: t("list.searchPlaceholder"),
  }}
  create={canManage ? { label: t("list.create"), onClick: () => setCreateOpen(true) } : undefined}
/>
```

`create.label` is optional — omit it to get the generic "+ New" (`common.create`,
added in zh/en). Pass a label only when a list wants specific text.

Verify: search is bounded (`w-full sm:w-64`), create on the right, page reset
preserved.

### 6. tag-utils (REFACTOR-013)

- `-project-form-logic.ts`: delete local `addTag`/`removeTag`, re-export from
  `@/shared/lib/tag-utils` (keep `projectsFilterToQuery` local). Update importers
  if they imported from form-logic.
- `-contact-form-logic.ts`: same.
- `-tags-input.tsx`: import from the shared util.
- Replace the contact form's hand-rolled tag editor with `<TagsInput>` (separate,
  optional sub-step).

## Annotations

- 2026-06-02: User approved defining the global components first WITHOUT modifying
  existing code, plus this migration guide; consumer migration deferred to a later
  session. Components added under `shared/components` + `shared/lib`; typecheck and
  lint pass. `cover-image.tsx` CoverKind was NOT exported (to avoid touching it);
  `CoverField` re-declares the structural union locally.
