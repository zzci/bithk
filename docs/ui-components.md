# Global UI Components

Reference for the shared, cross-module frontend components in
`apps/web/src/shared/components/` (and a few shared utilities in
`apps/web/src/shared/lib/`). These are the building blocks every feature surface
(projects, ships, contacts, issues, procurements, drive, documents) composes
from. Feature-local components living under `app/routes/**` are out of scope.

## Conventions

- **Base layer**: `shared/components/ui/*` are shadcn/ui (base-nova) primitives on
  top of `@base-ui/react`. Do not introduce other UI ecosystems — see
  [/pma-web]. Build higher-level shared components by composing these.
- **Presentational first**: shared components stay presentational. Callers own
  data fetching, mutations, toasts, debouncing, and permission decisions, and
  pass resolved values/handlers in. This keeps one component reusable across
  modules with different data layers.
- **i18n**: components take already-translated label strings as props, except for
  truly generic labels which they resolve from the `common` namespace themselves
  (e.g. prev/next, the default create label). Always keep `en` and `zh` in parity.
- **Immutability / props**: props are `readonly`; callback props are typed
  explicitly; no `React.FC`.

## Adoption status

| Component | Status |
| --- | --- |
| `ui/*`, `ResizableDrawer`, `ResourceFooterSections`, `CoverImage`, `PrioritySignal`, `ListFilter` | In use |
| `DetailPanelHeader`, `CoverField`, `PaginationFooter`, `SearchInput`, `ListToolbar`, `SearchCreateBar`, `tag-utils` | Defined (PLAN-051); consumer migration pending — see [plan/PLAN-051.md](plan/PLAN-051.md) Migration Guide |
| `ToolbarFilter` | Defined (PLAN-051); largely superseded by `ListFilter` for new code — prefer `ListFilter` |

---

## List & toolbar

### `SearchInput`

`shared/components/search-input.tsx` — controlled text input with a leading
magnifier icon. The caller keeps the raw value state (pair with `useDebounce`
for server-side search).

| Prop | Type | Notes |
| --- | --- | --- |
| `value` | `string` | |
| `onChange` | `(value: string) => void` | |
| `placeholder` | `string` | also used as `aria-label` |
| `className` | `string?` | wrapper width, e.g. `"w-full sm:w-64"` |

### `SearchCreateBar`

`shared/components/search-create-bar.tsx` — minimal toolbar for lists **without**
chip filters: a full-width search box on the left, a create button on the right
(e.g. contacts). Composes `SearchInput`.

| Prop | Type | Notes |
| --- | --- | --- |
| `search` | `{ value; onChange; placeholder }` | |
| `create` | `{ label?; onClick }?` | omit to hide the button; `label` defaults to `common.create` ("New" / "新建") |

```tsx
<SearchCreateBar
  search={{ value: search, onChange: v => { setSearch(v); setPage(1); }, placeholder: t("list.searchPlaceholder") }}
  create={canManage ? { onClick: () => setCreateOpen(true) } : undefined}
/>
```

### `ListToolbar`

`shared/components/list-toolbar.tsx` — toolbar row with a left `filters` slot and
a unified right-side search + create. For lists **with** filter controls (status
chips, tag filter, type select). Composes `SearchInput`. The create button sits to
the right of the search box.

| Prop | Type | Notes |
| --- | --- | --- |
| `filters` | `ReactNode?` | left slot: status chips / tag filter / type select |
| `search` | `{ value; onChange; placeholder; className? }` | |
| `create` | `{ label?; onClick }?` | `label` defaults to `common.create` |

```tsx
<ListToolbar
  filters={<>{statusChips}<ProjectTagFilter .../></>}
  search={{ value: search, onChange: v => { setSearch(v); setPage(1); }, placeholder: t("list.searchPlaceholder") }}
  create={isAdmin ? { onClick: () => setCreateOpen(true) } : undefined}
/>
```

### `ListFilter` (preferred filter control)

`shared/components/list-filter.tsx` — generic multi-dimension list filter. Each
dimension's options split into RESIDENT inline toggle chips (always visible) and a
non-resident remainder behind one "Filter" dropdown; non-resident selections trail
as removable × chips. Residency is **declarative** (`resident` / `residentCount`)
— no ResizeObserver, so inline chips never flicker. Dimensions are single- or
multi-select via a discriminated union.

| Prop | Type | Notes |
| --- | --- | --- |
| `dimensions` | `FilterDimension[]` | each: `key`, `label`, `mode` (`"single"`/`"multi"`), `options`, `value`, `onChange`, optional `resident`/`residentCount`, and (single) `defaultValue` |
| `className` | `string?` | |

This is the primary filter control and the usual occupant of `ListToolbar`'s
`filters` slot:

```tsx
<ListToolbar
  filters={<ListFilter dimensions={[statusDimension, tagDimension]} />}
  search={{ value: search, onChange: setSearch, placeholder: t("list.searchPlaceholder") }}
  create={isAdmin ? { onClick: () => setCreateOpen(true) } : undefined}
/>
```

### `ToolbarFilter`

`shared/components/toolbar-filter.tsx` — simpler single-dimension dropdown filter
(radio group) with a leading "show everything" sentinel (`"__all__"`). **Prefer
`ListFilter` for new code**; `ToolbarFilter` remains for the plain single-dropdown
case.

| Prop | Type | Notes |
| --- | --- | --- |
| `value` | `string` | `"__all__"` means no filter |
| `allLabel` | `string` | label for the sentinel option |
| `options` | `{ value; label }[]` | |
| `onChange` | `(value: string) => void` | |

### `PaginationFooter`

`shared/components/pagination-footer.tsx` — prev/next footer. The left total label
differs per list, so it is passed in; prev/next text comes from `common`.

| Prop | Type | Notes |
| --- | --- | --- |
| `page` | `number` | |
| `totalPages` | `number` | |
| `totalLabel` | `ReactNode` | e.g. `t("procurement.total", { count })` |
| `onPrev` / `onNext` | `() => void` | |

---

## Detail panel

### `ResizableDrawer`

`app/routes/_app/projects/-resizable-drawer.tsx` — accessible right-side drawer
on the base-ui Dialog primitive (focus-trap, scroll-lock, Escape-to-close) with a
drag/keyboard-resizable width. Hosts the issue and procurement detail routes.

| Prop | Type | Notes |
| --- | --- | --- |
| `ariaLabel` | `string` | dialog accessible name |
| `resizeLabel` | `string` | resize separator label |
| `onClose` | `() => void` | |
| `children` | `ReactNode` | panel body |

> Located in the projects route group (its only consumers today) rather than
> `shared/components/`. Move to `shared/` if a non-project surface adopts it.

### `DetailPanelHeader`

`shared/components/detail-panel-header.tsx` — header chrome for detail panels:
back (fullscreen) / inline-editable title / delete / maximize / close. Owns the
inline title-edit state; every action button is opt-in via its handler.

| Prop | Type | Notes |
| --- | --- | --- |
| `variant` | `"drawer" \| "fullscreen"` | |
| `title` | `string` | |
| `titleEdit` | `{ canEdit; onSave; editHint? }?` | omit → read-only title |
| `labels` | `{ back?; maximize?; close?; delete? }?` | resolved strings |
| `onClose` | `() => void` | |
| `onMaximize` | `() => void?` | shown (drawer) only when provided |
| `onDelete` | `() => void?` | delete button shown only when provided; the confirm dialog stays in the caller |

### `ResourceFooterSections`

`shared/components/resource/` — bundled attachments + comments block rendered
under a resource's main content (issues, procurements, documents). The
attachments header/section hides itself when empty; comments always render.
Companion exports: `useResourceAttachmentUpload`, `validateAttachmentSelection`,
`partitionBySize`.

Key props: `resource`, `resourceId`, `i18nNs`, `userMap`, `canDeleteAttachment`,
`canDeleteComment`, plus comment toggles (`commentsEnableReply`,
`commentsEnableAttachments`, `commentsStickyComposer`, `commentsLocked`,
`currentUserId`, …). See the source for the full prop list.

---

## Fields & display

### `CoverField`

`shared/components/cover-field.tsx` — cover image upload/replace/remove control.
Presentational: the caller owns the mutations and any toast (projects toast,
ships do not) and passes resolved `pending`/`error`.

| Prop | Type | Notes |
| --- | --- | --- |
| `kind` | `"project" \| "ship"` | gradient placeholder hue |
| `src` | `string \| null \| undefined` | current cover URL |
| `pending` | `boolean` | disables buttons |
| `error` | `string \| null?` | resolved message |
| `onPick` | `(file: File) => void` | |
| `onRemove` | `() => void` | |
| `labels` | `{ field; upload; replace; remove }` | |

### `CoverImage`

`shared/components/cover-image.tsx` — renders the cover `<img>` or, when absent, a
calm theme-aware gradient placeholder. Used by `CoverField`, cards, and detail
headers.

| Prop | Type | Notes |
| --- | --- | --- |
| `src` | `string \| null \| undefined` | |
| `kind` | `"project" \| "ship"` | neutral hue when no `seed` |
| `className` | `string?` | |
| `seed` | `string?` | deterministic hue from seed |

### `PrioritySignal` / `PriorityGlyph`

`shared/components/priority-signal.tsx` — single source of truth for priority
visuals (issues + procurement). A tinted chip holding a `Signal*` glyph;
four levels `low | medium | high | urgent` (low=muted, medium=info/blue,
high=warning/yellow, urgent=destructive/red).

- `PrioritySignal({ priority, label })` — with accessible `title`/`aria-label`.
- `PriorityGlyph({ priority })` — bare chip (e.g. create-dialog pill), aria-hidden.

---

## Utilities

### `tag-utils`

`shared/lib/tag-utils.ts` — pure tag-list helpers shared by tag editors.

- `addTag(list, raw)` — append a trimmed tag, ignoring blanks and
  case-insensitive duplicates.
- `removeTag(list, name)` — remove by exact name.

---

## Adding a new shared component

1. Confirm it is genuinely cross-module (≥2 real consumers, or an obvious near
   future one). Single-use UI stays feature-local.
2. Compose `ui/*` primitives; keep it presentational.
3. `readonly` props; explicit callback types; no `React.FC`.
4. Generic labels from `common` (keep en/zh in parity); domain labels via props.
5. Do not export non-component values from a component file
   (`react-refresh/only-export-components` — put constants/helpers in a `lib`
   module).
6. Add it here and run `bun run check`.
