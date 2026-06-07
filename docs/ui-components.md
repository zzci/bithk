# Global UI Components

Reference for the shared, cross-module frontend components in
`apps/web/src/shared/components/` (and a few shared utilities in
`apps/web/src/shared/lib/`). These are the building blocks every feature surface
(projects, ships, contacts, issues, procurements, drive, documents) composes
from. Feature-local components living under `app/routes/**` are out of scope.

This file is an inventory of **97 shared modules**: the `ui/*` primitive layer
plus the higher-level shared components, hooks, and utilities. Each section lists
the repo-relative path, purpose, adoption status, and (for composite components)
the key props.

## Conventions

- **Base layer**: `shared/components/ui/*` are shadcn/ui (base-nova) primitives on
  top of `@base-ui/react`. This is the locked UI base — do not introduce other UI
  ecosystems (Radix, MUI, Mantine, Chakra, Ant Design, Headless UI, …); see
  [/pma-web]. Build higher-level shared components by composing these primitives.
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

Adoption reflects how each module is actually wired up today. Counts exclude
same-directory sibling importers and test files unless noted.

| Class | Meaning |
| --- | --- |
| **in-use** | Imported by ≥2 app surfaces (routes/features). |
| **single-use** | Imported by exactly one app surface (by design or pending growth). |
| **internal-only** | Reached only through a sibling wrapper/barrel in the same directory; no app code imports it directly. |
| **unused** | No live consumers. |

| Module | Path | Class |
| --- | --- | --- |
| `Avatar` | `shared/components/ui/avatar.tsx` | in-use |
| `Badge` | `shared/components/ui/badge.tsx` | in-use |
| `Button` | `shared/components/ui/button.tsx` | in-use |
| `Card` | `shared/components/ui/card.tsx` | in-use |
| `CenteredHint` | `shared/components/ui/centered-hint.tsx` | in-use |
| `Combobox` | `shared/components/ui/combobox.tsx` | in-use |
| `ConfirmDeleteDialog` | `shared/components/ui/confirm-delete-dialog.tsx` | in-use |
| `ContextMenu` | `shared/components/ui/context-menu.tsx` | in-use |
| `Dialog` | `shared/components/ui/dialog.tsx` | in-use |
| `FullscreenDialog` | `shared/components/ui/fullscreen-dialog.tsx` | in-use |
| `DropdownMenu` | `shared/components/ui/dropdown-menu.tsx` | in-use |
| `ErrorBanner` | `shared/components/ui/error-banner.tsx` | in-use |
| `Input` | `shared/components/ui/input.tsx` | in-use |
| `Label` | `shared/components/ui/label.tsx` | in-use |
| `RadioGroup` | `shared/components/ui/radio-group.tsx` | in-use |
| `Select` | `shared/components/ui/select.tsx` | in-use |
| `Separator` | `shared/components/ui/separator.tsx` | in-use |
| `Sheet` | `shared/components/ui/sheet.tsx` | in-use |
| `Skeleton` | `shared/components/ui/skeleton.tsx` | in-use |
| `Spinner` | `shared/components/ui/spinner.tsx` | in-use |
| `Switch` | `shared/components/ui/switch.tsx` | in-use |
| `Table` | `shared/components/ui/table.tsx` | in-use |
| `Tabs` | `shared/components/ui/tabs.tsx` | in-use |
| `Textarea` | `shared/components/ui/textarea.tsx` | in-use |
| `Tooltip` | `shared/components/ui/tooltip.tsx` | in-use |
| `Sidebar` | `shared/components/ui/sidebar.tsx` | in-use |
| `Alert` | `shared/components/ui/alert.tsx` | internal-only (via `ErrorBanner`) |
| `AlertDialog` | `shared/components/ui/alert-dialog.tsx` | internal-only (via `ConfirmDeleteDialog`) |
| `InputGroup` | `shared/components/ui/input-group.tsx` | internal-only (via `Combobox`) |
| `Logo` | `shared/components/logo.tsx` | in-use |
| `SearchCreateBar` | `shared/components/search-create-bar.tsx` | in-use |
| `ListFilter` | `shared/components/list-filter.tsx` | in-use |
| `list-skeleton` (`CardGridSkeleton`/`ListRowsSkeleton`) | `shared/components/list-skeleton.tsx` | in-use |
| `PaginationFooter` | `shared/components/pagination-footer.tsx` | in-use |
| `SearchInput` | `shared/components/search-input.tsx` | internal-only (via `SearchCreateBar`) |
| `DetailPanelHeader` | `shared/components/detail-panel-header.tsx` | in-use |
| `DetailDescription` | `shared/components/detail-description.tsx` | in-use |
| `DetailMetaRow` (+ meta parts) | `shared/components/detail-meta-row.tsx` | in-use |
| `ResizableDrawer` | `shared/components/resizable-drawer.tsx` | in-use |
| `PrioritySignal` / `PriorityGlyph` | `shared/components/priority-signal.tsx` | in-use |
| `PRIORITY_BADGE_VARIANT` | `shared/components/priority-variant.ts` | in-use |
| `PinToggle` | `shared/components/pin-toggle.tsx` | in-use |
| `CoverField` | `shared/components/cover-field.tsx` | in-use |
| `CoverImage` | `shared/components/cover-image.tsx` | in-use |
| `FullPageLoader` | `shared/components/full-page-loader.tsx` | in-use |
| `NotFoundPage` | `shared/components/not-found.tsx` | in-use |
| tags barrel + family | `shared/components/tags/*` | in-use |
| `CrudDialog` | `shared/components/crud/crud-dialog.tsx` | in-use |
| `CrudListSection` | `shared/components/crud/crud-list-section.tsx` | in-use |
| `ResourceFooterSections` | `shared/components/resource/footer-sections.tsx` | in-use |
| `useResourceAttachmentUpload` | `shared/components/resource/use-attachment-upload.ts` | in-use |
| attachment validators | `shared/components/resource/attachment-upload.ts` | in-use |
| `ResourceAttachmentSection` | `shared/components/resource/attachment-section.tsx` | single-use (helper only) |
| `ResourceCommentSection` | `shared/components/resource/comment-section.tsx` | internal-only (via footer) |
| resource barrel | `shared/components/resource/index.ts` | internal-only |
| `share-helpers` | `shared/components/share/share-helpers.ts` | in-use |
| `use-share` | `shared/components/share/use-share.ts` | in-use |
| `share/register` | `shared/components/share/register.tsx` | in-use |
| `ShareDialogHost` | `shared/components/share/share-dialog-host.tsx` | single-use |
| `previews/shell` | `shared/components/share/previews/shell.tsx` | single-use |
| `ShareDialog` | `shared/components/share/share-dialog.tsx` | internal-only (via host) |
| `DocumentCollaboratorSection` | `shared/components/share/document-collaborators.tsx` | internal-only (via register) |
| `DocumentPublicPreview` | `shared/components/share/previews/document-preview.tsx` | internal-only (via register) |
| `DrivePublicPreview` | `shared/components/share/previews/drive-preview.tsx` | internal-only (via register) |
| share barrel | `shared/components/share/index.ts` | internal-only |
| editor barrel (`MarkdownEditor`) | `shared/components/editor/index.tsx` | in-use |
| `CodeEditor` | `shared/components/editor/code-editor.tsx` | single-use |
| `CodePreview` | `shared/components/editor/code-preview.tsx` | single-use |
| `MarkdownPreview` | `shared/components/editor/markdown-preview.tsx` | internal-only (via barrel) |
| `MarkdownSourceView` | `shared/components/editor/markdown-source-view.tsx` | internal-only (via milkdown) |
| `MilkdownMarkdownEditor` | `shared/components/editor/milkdown-editor.tsx` | internal-only (via barrel) |
| `cm-language` | `shared/components/editor/cm-language.ts` | internal-only |
| `document-tree.utils` | `shared/components/documents/document-tree.utils.ts` | single-use |
| sidebar `registry` | `shared/components/sidebar/registry.ts` | in-use |
| sidebar `types` | `shared/components/sidebar/types.ts` | in-use |
| `FileUploadButton` | `shared/components/file/file-upload-button.tsx` | in-use |
| `DriveFileListSurface` | `shared/components/file/file-list-surface.tsx` | in-use |
| `file-list-types` | `shared/components/file/file-list-types.ts` | internal-only (via surface) |
| `file-list-filters` | `shared/components/file/file-list-filters.ts` | internal-only (via surface) |
| `file-list-inner` (`FileList`) | `shared/components/file/file-list-inner.tsx` | internal-only (via surface) |
| `file-list-toolbar` | `shared/components/file/file-list-toolbar.tsx` | internal-only (via surface) |
| `file-list-filter-bar` | `shared/components/file/file-list-filter-bar.tsx` | internal-only (via surface) |
| `file-list-item-actions` | `shared/components/file/file-list-item-actions.tsx` | internal-only (via surface) |
| `FilePreviewDialog` (+ `resolvePreviewKind`) | `shared/components/file/file-preview-dialog.tsx` | in-use (drive, share previews, resource attachments) |
| `file-preview-*` parts (image/pdf/toolbar/types/hooks) | `shared/components/file/file-preview-*.{ts,tsx}` | internal-only (via `FilePreviewDialog`) |
| `version-history-dialog` | `shared/components/file/version-history-dialog.tsx` | in-use (drive edit flow) |
| file barrel | `shared/components/file/index.ts` | in-use |
| `AppSidebar` | `shared/components/app-sidebar.tsx` | single-use |
| `CommandPalette` | `shared/components/command-palette.tsx` | internal-only (via app-sidebar) |
| `command-palette.logic` | `shared/components/command-palette.logic.ts` | internal-only |
| `ThemeProvider` / `useTheme` | `shared/components/theme-provider.tsx` | in-use |
| `ModeToggle` | `shared/components/mode-toggle.tsx` | in-use |
| `SettingsDialog` | `shared/components/settings-dialog.tsx` | internal-only (via app-sidebar) |
| `branding` | `shared/lib/branding.ts` | in-use |
| `format` | `shared/lib/format.ts` | in-use |
| `status-colors` | `shared/lib/status-colors.ts` | in-use |
| `tag-utils` | `shared/lib/tag-utils.ts` | in-use |
| `preview-blob` | `shared/lib/preview-blob.ts` | in-use |

> "internal-only" does not mean dead: most are intentionally reached through a
> sibling wrapper, barrel, or registry (e.g. `Alert` flows to the app only via
> `ErrorBanner`, `ShareDialog` only via `ShareDialogHost`). Genuinely unused
> *sub-exports* are called out in the per-component notes below.

---

## UI primitives (`shared/components/ui/*`)

The base-nova / `@base-ui/react` primitive layer. Compact reference — see each
source file for the full export list and prop types. **CUSTOM** marks primitives
that deliberately diverge from vanilla shadcn (extra a11y, trimmed parts, or
non-shadcn helpers).

| Primitive | Path | Purpose |
| --- | --- | --- |
| `Alert` | `ui/alert.tsx` | CVA alert container with title/description slots and a `destructive` variant. `internal-only` (only `ErrorBanner` consumes it; `AlertTitle` is unused). |
| `AlertDialog` | `ui/alert-dialog.tsx` | Confirmation dialog (role `alertdialog`) requiring an explicit action, no corner close. Base UI primitive. `internal-only` (only `ConfirmDeleteDialog`). |
| `Avatar` | `ui/avatar.tsx` | Image/fallback avatar with badge/group/group-count helpers and `sm`/`default`/`lg` sizing. `AvatarBadge`/`AvatarGroup`/`AvatarGroupCount` exports appear unused. |
| `Badge` | `ui/badge.tsx` | **CUSTOM** — polymorphic CVA badge via Base UI `useRender` (not Radix `Slot`); variants `default`/`secondary`/`destructive`/`outline`/`ghost`/`link`. |
| `Button` | `ui/button.tsx` | **CUSTOM** — CVA button on Base UI `Button`; 6 variants, 9 sizes (incl. `pill`); auto-mirrors `title` into `aria-label` for icon-only buttons. Most-used primitive. |
| `Card` | `ui/card.tsx` | Card container with header/title/description/action/content/footer slots; `default`/`sm` sizing. |
| `CenteredHint` | `ui/centered-hint.tsx` | **CUSTOM** — centers a short loading/empty/error string with `muted` or `destructive` tone (not a shadcn part). |
| `Combobox` | `ui/combobox.tsx` | Base UI Combobox composition (input/content/list/item/chips/clear/trigger + `useComboboxAnchor`) for single and multi-select with chips. Depends on `InputGroup` + `Button`. |
| `ConfirmDeleteDialog` | `ui/confirm-delete-dialog.tsx` | **CUSTOM** — i18n confirm/cancel delete wrapping `AlertDialog`; stays open until the parent mutation resolves. The sole consumer of `alert-dialog.tsx`. See composite entry below. |
| `ContextMenu` | `ui/context-menu.tsx` | **CUSTOM (trimmed)** — right-click menu on Base UI `ContextMenu` (content/item/label/separator/group only; no CheckboxItem/RadioItem/Sub). Drive file-list only. |
| `Dialog` | `ui/dialog.tsx` | Modal dialog on Base UI `Dialog` with header/footer/title/description and an i18n close button. Note: `DialogFooter`'s `showCloseButton` branch has a hardcoded English "Close" (i18n gap). |
| `FullscreenDialog` | `ui/fullscreen-dialog.tsx` | **CUSTOM** — shared shell for the drive's two fullscreen content viewers (`-file-preview-dialog`, `-univer-sheet-editor-dialog`): `fixed inset-0` overlay (single `bg-black/50` scrim token) + backdrop-dismiss + Escape + body scroll-lock + windowed/fullscreen panel. Deliberately NOT base-ui `Dialog`: it does not focus-trap or `inert` the background, because Univer/CodeMirror/react-pdf manage their own internal focus. Caller owns `open`, the `fullscreen` flag, and the panel content (header + body). |
| `DropdownMenu` | `ui/dropdown-menu.tsx` | Dropdown on Base UI `Menu` with item/checkbox/radio/sub/label/separator/shortcut parts. Radio/Checkbox/Sub/Shortcut exports likely unused by current consumers. |
| `ErrorBanner` | `ui/error-banner.tsx` | **CUSTOM** — nullable-message wrapper over the destructive `Alert`; renders nothing when empty. Has a co-located test. The sole consumer of `alert.tsx`. |
| `Input` | `ui/input.tsx` | Styled text input on Base UI `Input` with focus/disabled/`aria-invalid` states. |
| `InputGroup` | `ui/input-group.tsx` | Input grouping shell (addon/button/text/input/textarea). `internal-only` (only `Combobox`); `InputGroupText` is dead even internally. Depends on `Button`/`Input`/`Textarea`. |
| `Label` | `ui/label.tsx` | **CUSTOM** — plain `<label>` with disabled-peer styling (no Base UI/Radix dependency). |
| `RadioGroup` | `ui/radio-group.tsx` | **CUSTOM** — radio group on Base UI `RadioGroup`/`Radio` with a styled indicator; minimal 2-export surface. |
| `Select` | `ui/select.tsx` | Select on Base UI `Select` (trigger/value/content/item/label/separator + scroll arrows wired internally). |
| `Separator` | `ui/separator.tsx` | **CUSTOM** — divider on Base UI `Separator` with unconditional orientation classes (documented divergence so `SidebarSeparator` override works). |
| `Sheet` | `ui/sheet.tsx` | **CUSTOM** — side panel on Base UI `Dialog` (top/right/bottom/left), header/footer/title/description, i18n close. Not a dedicated sheet primitive. |
| `Skeleton` | `ui/skeleton.tsx` | Pulse-animated placeholder div for loading states. |
| `Spinner` | `ui/spinner.tsx` | **CUSTOM** — spinning lucide `Loader2`; `size` preset (`xs`/`sm`/`md`/`lg` → `size-3`/`4`/`5`/`6`, default `sm`); `aria-hidden` defaults to `true` (callers add their own label). The single in-app loading spinner. |
| `Switch` | `ui/switch.tsx` | Toggle switch on Base UI `Switch`; `sm`/`default` sizing. |
| `Table` | `ui/table.tsx` | Semantic table parts (header/body/footer/row/head/cell/caption) in an overflow-x container. Mostly admin tables. |
| `Tabs` | `ui/tabs.tsx` | Tabs on Base UI `Tabs`; `default`/`line` list variants, horizontal/vertical orientation. |
| `Textarea` | `ui/textarea.tsx` | **CUSTOM** — auto-sizing plain `<textarea>` (not Base UI Input) with focus/disabled/`aria-invalid` states. |
| `Tooltip` | `ui/tooltip.tsx` | Tooltip on Base UI `Tooltip` (provider/trigger/content + arrow), default delay 0. |
| `Sidebar` | `ui/sidebar.tsx` | **CUSTOM** — full collapsible sidebar system (provider/context/rail/inset, header/footer/menu/group parts, mobile sheet, cookie-persisted state). 24 exports; the largest `ui/` file (~22KB). Composes `Sheet`/`Tooltip`/`Button`/`Input`/`Separator`/`Skeleton`. Many sub-exports (`SidebarInput`/`MenuBadge`/`MenuSub*`/`GroupAction`/`Rail`) are likely unused — high dead-export surface. |

### `ConfirmDeleteDialog` (composite primitive)

`shared/components/ui/confirm-delete-dialog.tsx` — the app-facing confirm/cancel
delete dialog. Wraps `AlertDialog`, resolves its own i18n labels, and keeps itself
open until the parent mutation resolves (so spinners read correctly). 24
consumers; it is the only path through which `AlertDialog` reaches app code.

| Prop | Type | Notes |
| --- | --- | --- |
| `open` | `boolean` | |
| `onOpenChange` | `(open: boolean) => void` | |
| `title` / `description` | `ReactNode` | |
| `onConfirm` | `() => void` | caller runs the mutation |
| `pending` | `boolean?` | disables/locks while the mutation runs |
| `confirmLabel` / `cancelLabel` | `ReactNode?` | default to `common` labels |

---

## List & toolbar

### `SearchInput`

`shared/components/search-input.tsx` — controlled text input with a leading
magnifier icon. `internal-only`: only `SearchCreateBar` imports it; no route uses
it directly. The caller keeps the raw value state (pair with `useDebounce` for
server-side search).

| Prop | Type | Notes |
| --- | --- | --- |
| `value` | `string` | |
| `onChange` | `(value: string) => void` | |
| `placeholder` | `string` | also used as `aria-label` |
| `className` | `string?` | wrapper width, e.g. `"w-full sm:w-64"` |

### `SearchCreateBar`

`shared/components/search-create-bar.tsx` — search + create cluster. The search
box is **bounded** (`w-full sm:w-64`); pair it with `ListFilter` on the left of a
`justify-between` row, or use it standalone for lists **without** chip filters.
Create button sits to the right of search. Composes `SearchInput`.

| Prop | Type | Notes |
| --- | --- | --- |
| `search` | `{ value; onChange; placeholder }` | |
| `create` | `{ label?; onClick }?` | omit to hide the button; `label` defaults to `common.create` |

```tsx
<div className="flex items-center justify-between gap-3">
  <ListFilter dimensions={[statusDimension, tagDimension]} />
  <SearchCreateBar
    search={{ value: search, onChange: v => { setSearch(v); setPage(1); }, placeholder: t("list.searchPlaceholder") }}
    create={canManage ? { onClick: () => setCreateOpen(true) } : undefined}
  />
</div>
```

### `ListFilter` (preferred filter control)

`shared/components/list-filter.tsx` — drive-style multi-dimension list filter.
Each dimension is its own single/multi-select dropdown with removable chips and a
clear-all button. Most-adopted component in the group (12 consumers); the
`FilterDimension` type is re-consumed by `tags/tag-filter` and several tabs to
build dimensions. Has a test.

| Prop | Type | Notes |
| --- | --- | --- |
| `dimensions` | `readonly FilterDimension[]` | each: `key`, `label`, `mode` (`"single"`/`"multi"`), `options`, `value`, `onChange`, and (single) `defaultValue` |
| `className` | `string?` | |

> Coupling note: `ListFilter` uses a hardcoded `useTranslation("projects")`
> namespace for `list.filterRemove` / `list.clearFilters`, even though it is
> consumed well beyond projects (admin/contacts/drive/ships). Those keys must
> stay present in the `projects` namespace.

### `list-skeleton` — `CardGridSkeleton` / `ListRowsSkeleton`

`shared/components/list-skeleton.tsx` — layout-reserving loading skeletons with
`sr-only` status labels. Two exports, both in active use: `CardGridSkeleton`
(projects/ships card grids) and `ListRowsSkeleton` (procurement/issues/contacts
row lists).

| Export | Key props |
| --- | --- |
| `CardGridSkeleton` | `count?: number`, `label?: string`, `className?: string` |
| `ListRowsSkeleton` | `count?: number`, `label?: string`, `bordered?: boolean` |

### `PaginationFooter`

`shared/components/pagination-footer.tsx` — prev/next footer. The left total label
differs per list, so it is passed in; prev/next text comes from `common`. Has a
test.

| Prop | Type | Notes |
| --- | --- | --- |
| `page` | `number` | |
| `totalPages` | `number` | |
| `totalLabel` | `ReactNode` | e.g. `t("procurement.total", { count })` |
| `onPrev` / `onNext` | `() => void` | |

---

## Detail panel

### `ResizableDrawer`

`shared/components/resizable-drawer.tsx` — accessible right-side detail drawer on
the base-ui `Dialog` primitive (focus-trap, scroll-lock, Escape-to-close) with a
drag/keyboard-operable resize handle. Hosts the issue/procurement detail routes
and the contacts panel. (Moved up from the projects route group; it is now a
genuine shared component.)

> Intentional divergence: it wraps `Dialog` directly rather than the shared
> `Sheet` primitive, because `Sheet` hardcodes width and cannot host the
> resizable layout. Not a duplicate.

| Prop | Type | Notes |
| --- | --- | --- |
| `ariaLabel` | `string` | dialog accessible name |
| `resizeLabel` | `string` | resize handle label |
| `onClose` | `() => void` | |
| `children` | `ReactNode` | panel body |

### `DetailPanelHeader`

`shared/components/detail-panel-header.tsx` — header chrome for right-side detail
panels: inline title-edit, close/maximize/delete, and an extra-action slot. Owns
the inline title-edit state; every action button is opt-in via its handler. Has a
test.

| Prop | Type | Notes |
| --- | --- | --- |
| `variant` | `"drawer" \| "fullscreen"` | |
| `title` | `string` | |
| `titleEdit` | `{ canEdit; onSave; editHint? }?` | omit → read-only title |
| `labels` | `{ ... }?` | resolved action strings |
| `onClose` | `() => void` | |
| `onMaximize` | `() => void?` | shown (drawer) only when provided |
| `onDelete` | `() => void?` | delete button shown only when provided; the confirm dialog stays in the caller |
| `extraActions` | `ReactNode?` | trailing slot |

### `DetailDescription`

`shared/components/detail-description.tsx` — description-editor card for detail
panels that switches between an inline `MarkdownEditor`, a read-only render, and
an add-description affordance. Fully controlled (caller owns `editing`/`draft`).

| Prop | Type | Notes |
| --- | --- | --- |
| `canEdit` | `boolean` | |
| `editing` | `boolean` | |
| `value` | `string \| null` | saved value |
| `draft` | `string` | in-progress edit |
| `placeholder` / `noDescriptionLabel` / `saveLabel` / `cancelLabel` | `string` | resolved labels |
| `onDraftChange` / `onStartEdit` / `onSave` / `onCancel` | callbacks | |

### `DetailMetaRow` (+ meta parts)

`shared/components/detail-meta-row.tsx` — composable meta-strip primitives for
issue/procurement detail panels. Six exports; both consumers import all six. No
test despite the breadth of behavior (date picker logic, select narrowing).

Exports: `DetailMetaRow` (container), `MetaSeparator`, `MetaSelectBadge<T>`,
`MetaAssignee`, `MetaDueDate`, `MetaActions`.

| Part | Key props |
| --- | --- |
| `DetailMetaRow` | `children` |
| `MetaSelectBadge<T>` | `canEdit`, `value`, `options`, `renderLabel`, `variant`, `onValueChange` |
| `MetaAssignee` | `members`, `memberLabels`, `value`, `onChange` |
| `MetaDueDate` | `value: string \| null`, `onChange` |
| `MetaActions` | `canUpload`, `uploadPending`, `fileInputRef`, `onFilesSelected`, … |

### `ResourceFooterSections`

See the [Resource bundle](#resource-bundle) section — it is the composed
attachments + comments tail rendered under issue/procurement/document detail
panels.

---

## Fields & display

### `PrioritySignal` / `PriorityGlyph`

`shared/components/priority-signal.tsx` — tinted signal-bar priority icon chip
shared by issues and procurement. Four levels `low | medium | high | urgent`. Has
a test.

- `PrioritySignal({ priority, label })` — with accessible `title`/`aria-label`.
- `PriorityGlyph({ priority })` — bare chip (e.g. create-dialog pill), aria-hidden.

### `PRIORITY_BADGE_VARIANT`

`shared/components/priority-variant.ts` — pure constant mapping the four priority
levels to shadcn `Badge` variants; the single source of truth for the detail
panels' priority badges. Deliberately split out of `priority-signal.tsx` to avoid
the `react-refresh/only-export-components` warning, so the two files form a pair
(list tabs use the signal, detail panels use the variant map).

### `PinToggle`

`shared/components/pin-toggle.tsx` — ghost icon toggle button for pin/unpin with
`aria-pressed` and pending-disabled state.

| Prop | Type | Notes |
| --- | --- | --- |
| `pinned` | `boolean` | |
| `pending` | `boolean` | disables while toggling |
| `onToggle` | `(willPin: boolean) => void` | |
| `className` | `string?` | |
| `stopPropagation` | `boolean?` | for use inside clickable cards |

> Uses a hardcoded `useTranslation("projects")` for the pin/unpin labels; fine
> today since both consumers are project tabs.

### `CoverField`

`shared/components/cover-field.tsx` — cover-image upload/replace/remove control
wrapping `CoverImage`. Presentational: the caller owns the mutations and any toast
and passes resolved `pending`/`error`.

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
deterministic seed/kind-based gradient placeholder. Used by `CoverField`, cards,
and the admin default-fields surface.

| Prop | Type | Notes |
| --- | --- | --- |
| `src` | `string \| null \| undefined` | |
| `kind` | `"project" \| "ship"` | neutral hue when no `seed` |
| `className` | `string?` | |
| `seed` | `string?` | deterministic hue from seed |

> `CoverField` re-declares a local `CoverKind` structurally identical to
> `CoverImage`'s internal one (minor type duplication; promote to a shared export
> if a third kind appears).

### `FullPageLoader`

`shared/components/full-page-loader.tsx` — full-viewport loading spinner with a
delayed "still loading" retry/reload affordance. Mounted by `_app.tsx` and
`__root.tsx`.

| Prop | Type | Notes |
| --- | --- | --- |
| `onRetry` | `() => void?` | reload affordance after the delay |

### `NotFoundPage`

`shared/components/not-found.tsx` — full-page 404 screen with logo, mode toggle,
and a back-to-overview link. Note: the export is `NotFoundPage` (file is
`not-found.tsx`); `main.tsx` imports it via a relative path while `__root.tsx`
uses the `@/` alias.

---

## Tags

`shared/components/tags/` — the single shared tag family. Every external consumer
imports from the barrel `tags/index.ts`, never deep paths. Heavily adopted across
projects/ships/contacts (13 consumers of the barrel). This family subsumes the old
`tags-combobox.tsx` and per-domain wrappers (now deleted).

| Module | Path | Purpose |
| --- | --- | --- |
| barrel | `tags/index.ts` | Re-exports `TagChip`, `TagChips`, `tagFilterDimension`, `TagInput` and their types. Canonical entry point. |
| `TagChip` | `tags/tag-chip.tsx` | The single styled tag pill (optional trailing × remove). `internal-only` (used by `TagChips`/`TagInput`). Composite over shadcn `Badge` + `Button`. Has a test. |
| `TagChips` | `tags/tag-chips.tsx` | Read-only "first N tags + overflow" renderer (non-removable chips + `+N`). Used by project/ship cards and the contact panel. Has a test. |
| `tagFilterDimension` | `tags/tag-filter.tsx` | Pure helper that builds a `"multi"` `ListFilter` dimension from a tag list (or `null` when empty), centralizing the hide-when-empty rule. Has a test. |
| `TagInput` | `tags/tag-input.tsx` | Linear-style tag picker: removable chips + a dashed "Tags" pill opening a `Combobox` to search/select/create by name. Most-adopted tag component (9 consumers). Has a test. |

`TagInput` key props:

| Prop | Type | Notes |
| --- | --- | --- |
| `value` | `readonly string[]` | |
| `onChange` | `(readonly string[]) => void` | |
| `suggestions` | `readonly string[]?` | autocomplete pool |
| `namespace` | `string?` | i18n ns; relies on every domain providing identical `field.tags`/`tags.*` keys (documented coupling) |
| `allowCreate` | `boolean?` | allow creating new tags by name |

---

## Resource bundle

`shared/components/resource/` — the generic attachments + comments stack rendered
under a resource's main content (issues, procurements, documents). The public
entry point is `ResourceFooterSections`; the others are reached through it or
through the barrel.

| Module | Path | Purpose |
| --- | --- | --- |
| barrel | `resource/index.ts` | Re-exports `partitionBySize`, `validateAttachmentSelection`, `ResourceFooterSections`, `useResourceAttachmentUpload`. Omits the attachment-section helpers (see leak note). |
| `ResourceFooterSections` | `resource/footer-sections.tsx` | Bundled attachments + comments tail block; hides the attachments header when empty. Primary public entry (3 consumers). No test. |
| `ResourceAttachmentSection` | `resource/attachment-section.tsx` | Display-only attachment grid with inline image/PDF/text preview dialog + delete confirm, driven by a shared query. The component is internal-only; one external consumer reaches a deep path purely for the `formatFileSize` helper. Has a test. |
| `ResourceCommentSection` | `resource/comment-section.tsx` | Generic comments thread (reply, lock, per-comment attachments, sticky composer, windowed render). `internal-only` — only mounted via the footer. Has a test. |
| `attachment-upload` | `resource/attachment-upload.ts` | Pure pre-flight validators: `validateAttachmentSelection` (all-or-nothing quota/size), `partitionBySize` (split by size). Well-adopted pure util (4 consumers). Has a test. |
| `useResourceAttachmentUpload` | `resource/use-attachment-upload.ts` | Hook wiring the upload UX: hidden input ref, limits query, POST mutation, invalidation, input reset. Validation policy stays at the call site. 3 consumers. |

`ResourceFooterSections` key props:

| Prop | Type | Notes |
| --- | --- | --- |
| `resource` / `resourceId` | `string` | resource key + id |
| `i18nNs` | `string` | namespace for section labels |
| `userMap` | `Map<string, ResourceUser>` | author lookup |
| `canDeleteAttachment` / `canDeleteComment` | `(x) => boolean` | per-item permission |
| `commentsLocked` / `commentsEnableReply` / `commentsEnableAttachments` / `commentsStickyComposer` | `boolean?` | comment toggles |
| `currentUserId` | `string?` | for own-comment affordances |
| `canDeleteCommentAttachment` | `(att) => boolean?` | |
| `commentsHeaderAction` | `ReactNode?` | trailing slot |
| `sectionSpacingClassName` | `string?` | |

> Leak to close: the barrel omits `formatFileSize`, so a consumer reaches into the
> deep `attachment-section` path for it. `formatFileSize` also duplicates
> `formatBytes` in `share/share-helpers.ts`.

---

## CRUD admin

`shared/components/crud/` — presentational chrome shared by the admin "Project
Defaults" / "Contact" / "Ship" settings vocabularies (tags, procurement & contact
categories, global worklists, equipment categories & manufacturers). Each surface
keeps its own mutations, toasts, validation, and i18n; these two components own
only the repeated layout. Six sections + six create/edit dialogs compose them.

| Module | Path | Purpose |
| --- | --- | --- |
| `CrudDialog` | `crud/crud-dialog.tsx` | Create/edit dialog shell: `Dialog` + header (mode-selected title) + nullable `ErrorBanner` + a `children` field slot + cancel/save footer. Caller passes already-translated titles/description, the resolved error message, `pending`, `submitDisabled`, and `onSubmit`; Save/Cancel resolve from `common`. Optional `contentClassName` / `noValidate`. |
| `CrudListSection` | `crud/crud-list-section.tsx` | Section chrome: header (title/description + "add" button) + load-error banner + bordered table (column heads + empty row + rows ending in an edit/delete action pair) + a `children` slot for the caller's delete-confirm and create/edit dialogs. Generic over `TRow extends { id: string }`; `columns` + `renderRow` describe the leading cells; action labels are passed in (they vary by namespace). |

## Share

`shared/components/share/` — the unified resource-agnostic share system: one
app-root dialog, a registry of shareable resource types, and public-link preview
renderers. Mirrors the backend adapter-registry pattern.

| Module | Path | Purpose |
| --- | --- | --- |
| barrel | `share/index.ts` | Exposes `ShareDialogHost` + `useShare`. |
| `share/register` | `share/register.tsx` | Side-effect module registering the `drive_entry` and `document` shareable resources (public previews + document extra section). Imported for side effects in the app shell and the public share route. Sole importer of the previews + collaborator section. |
| `ShareDialogHost` | `share/share-dialog-host.tsx` | App-root mount: reads the current share target from the store, loads capabilities + shares + the registry extra section, renders the single `ShareDialog`. Single-use by design. |
| `ShareDialog` | `share/share-dialog.tsx` | Unified dialog: capability-driven direct-share people list + public-link controls (expiry/password); reconciles desired vs server state on Done. `internal-only` (via host). Large (~560 lines, over target) — could be split. |
| `use-share` | `share/use-share.ts` | Zustand store + hooks: `openShare` (any caller), `useShareTarget`/`ShareTarget` (host internal). A store/hook (no JSX) — slightly mis-located but exported via the barrel. 4 drive/document consumers. |
| `share-helpers` | `share/share-helpers.ts` | Reusable primitives: `useVisibleUsers` (widely adopted, 10 files), `useClipboard`, `formatBytes`, `formatDate`, `expiresAtFromValue`, `expirationValueFrom`. Has a test. |
| `DocumentCollaboratorSection` | `share/document-collaborators.tsx` | Viewer/editor collaborator-grant list on the document module's own API, injected via the registry's `renderExtraSection`. `internal-only` (via register). |
| `DocumentPublicPreview` | `share/previews/document-preview.tsx` | Public view-only document preview (markdown body, subtree nav, attachments) scoped to the share token. `internal-only` (via register). |
| `DrivePublicPreview` | `share/previews/drive-preview.tsx` | Public drive preview: single-file card or read-only folder browser. `internal-only` (via register). Composes the shared `FilePreviewDialog` + `shared/lib/file` helpers (the former app-route inward dependency is resolved). |
| `previews/shell` | `share/previews/shell.tsx` | Shared chrome for the public landing page: `ShareShell`, `ShareStatus`, `ShareIconHeader`, `PasswordField`, `PasswordPrompt`. The route uses `ShareShell`/`ShareStatus`; the rest are internal to the preview siblings. |

> `useVisibleUsers` (a general account/visible-users query) has outgrown the
> share folder — promotion to `shared/lib`/api is a candidate. `share-helpers`'
> `formatBytes`/`formatDate` duplicate `resource/attachment-section`'s
> `formatFileSize` and `shared/lib/format`'s `formatDate` respectively.

---

## Editor

`shared/components/editor/` — the markdown + code editing surface. The public
entry is the `MarkdownEditor` barrel; the two halves and the code surfaces are
code-split via `React.lazy`.

| Module | Path | Purpose |
| --- | --- | --- |
| barrel — `MarkdownEditor` | `editor/index.tsx` | Lazy-renders `MarkdownPreview` when `readOnly`, else the Milkdown WYSIWYG editor, behind one `MarkdownEditor`. Canonical public entry (6 consumers). |
| `MilkdownMarkdownEditor` | `editor/milkdown-editor.tsx` | Milkdown/ProseMirror WYSIWYG editor: toolbar, interactive task-list node view, link dialog, source-mode toggle, external-value sync, custom XSS link-allowlist. `internal-only` (via barrel). Largest file in the group (~685 lines). |
| `MarkdownPreview` | `editor/markdown-preview.tsx` | Read-only sanitized `react-markdown` + `remark-gfm` renderer wrapped in `.ProseMirror` to share editor CSS; carries the `rehype-sanitize` XSS hardening. `internal-only` (via barrel readOnly path). |
| `MarkdownSourceView` | `editor/markdown-source-view.tsx` | Standalone CodeMirror 6 raw-markdown source editor, mounted only while Milkdown is in source mode. `internal-only` (via milkdown). |
| `CodeEditor` | `editor/code-editor.tsx` | Editable CodeMirror 6 surface for code/text files in the drive preview dialog. `single-use` (deep lazy import by `-file-preview-dialog`). |
| `CodePreview` | `editor/code-preview.tsx` | Read-only syntax-highlighted CodeMirror 6 preview; the read-only counterpart of `CodeEditor`. `single-use` (deep lazy import). |
| `cm-language` | `editor/cm-language.ts` | `loadLanguageExtension` resolves a CodeMirror 6 language extension from a filename (async, by extension; `null` on miss). `internal-only` — shared grammar resolver for both code surfaces. |

`MarkdownEditor` key props:

| Prop | Type | Notes |
| --- | --- | --- |
| `value` / `defaultValue` | `string?` | controlled / uncontrolled |
| `onChange` | `(string) => void?` | |
| `readOnly` | `boolean?` | → renders `MarkdownPreview` |
| `compact` | `boolean?` | tighter chrome |
| `placeholder` | `string?` | |
| `minHeight` | `number?` | |
| `floatingToolbar` | `boolean?` | |
| `className` | `string?` | |

---

## Documents

`shared/components/documents/` — currently just the tree logic helper (the
component layer it was kept small for does not live here).

### `document-tree.utils`

`shared/components/documents/document-tree.utils.ts` — side-effect-free helpers
that index the flat `/documents/tree` payload and drive nesting, descendant
counts, ancestor/subtree resolution, visible flattening, and keyboard focus
stepping. Has a test.

Exports: `TreeIndex`, `buildTreeIndex`, `flattenVisible`, `ancestorIds`,
`subtreeIds`, `toggleId`, `stepFocus`. `single-use` (only `-documents-sidebar.tsx`,
which uses `buildTreeIndex`/`ancestorIds`/`toggleId`). `flattenVisible`,
`subtreeIds`, and `stepFocus` are exported and unit-tested but have **no
consumer** — dead-ish exports retained for an unbuilt picker/move dialog.

---

## Sidebar registry

`shared/components/sidebar/` — the central nav source of truth that decouples each
route's nav descriptor from the sidebar/command-palette render.

| Module | Path | Purpose |
| --- | --- | --- |
| `registry` | `sidebar/registry.ts` | `getNavItems(area)` aggregates the 11 per-route `*.nav.ts` descriptors and returns the area's items sorted by `order`. Consumed by `app-sidebar` + `command-palette`. Has a test. |
| `types` | `sidebar/types.ts` | The `NavArea` union and `NavItem` interface each route's `*.nav.ts` implements. Pure type module (11 descriptor consumers). |

> `-drive-sidebar.tsx` declares its own unrelated local `NavItem` interface — a
> name collision, not a consumer of this type.

---

## File

`shared/components/file/` — the shared hidden `<input type=file>` wrapper plus
the presentational drive file-list surface family.

| Module | Path | Purpose |
| --- | --- | --- |
| barrel | `file/index.ts` | Re-exports `FileUploadButton`, `DriveFileListSurface`, and their public types. |
| `FileUploadButton` | `file/file-upload-button.tsx` | **CUSTOM** primitive (not shadcn) centralizing accept-policy and value-reset, with either a children trigger or a forwarded `inputRef`. Has a test. |
| `DriveFileListSurface` | `file/file-list-surface.tsx` | THE presentational file-list surface: search, type/owner/modified filters, name/modified sort, grid\|list view (localStorage), rubber-band multi-select, batch bar, per-row actions, context menus. Callers pass `DisplayItem[]` + an `actions` bag; the surface never touches the API. Consumed by the drive folder browser, recent/favorites/trash collections, share lists, and the file picker. |
| `file-list-inner` / `-toolbar` / `-filter-bar` / `-item-actions` | `file/file-list-*.tsx` | Internal surface parts (list/grid renderer, toolbars, filter bar, per-item action menus); reached only through the surface. |
| `file-list-types` / `file-list-filters` | `file/file-list-*.ts` | Surface prop/config types, capability defaults, and the filter string-unions. |

`FileUploadButton` key props:

| Prop | Type | Notes |
| --- | --- | --- |
| `accept` | `"any" \| "image"?` | accept policy |
| `acceptOverride` | `string?` | explicit accept attr |
| `multiple` / `directory` / `disabled` | `boolean?` | |
| `onSelect` | `(File[]) => void` | |
| `children` | `ReactNode?` | trigger element |
| `inputRef` | `Ref<HTMLInputElement>?` | external trigger; alternative to `children` |

Related pure util: `shared/lib/preview-blob.ts` — see [Utilities](#utilities).

---

## App shell

The application chrome mounted near the root. These are largely `single-use` /
`internal-only` by design (one instance per app).

| Module | Path | Purpose |
| --- | --- | --- |
| `AppSidebar` | `app-sidebar.tsx` | Primary collapsible sidebar: brand header, overview/admin nav from the registry, global search trigger, settings dialog, user-menu footer (language/theme/logout). `single-use` (the `_app` layout). Sole real consumer of `CommandPalette`, `SettingsDialog`, `Logo`, `useTheme`. Has a test. |
| `CommandPalette` | `command-palette.tsx` | Global Cmd/Ctrl+K palette: role-filtered nav quick-entries + debounced permission-scoped search hits grouped by type, with keyboard nav. `internal-only` (via app-sidebar). Two test files. |
| `command-palette.logic` | `command-palette.logic.ts` | Pure DOM-free helpers (`hitTarget` → router nav target, `matchesQuery`) extracted for unit testing. `internal-only`. Has a test. |
| `SettingsDialog` | `settings-dialog.tsx` | User account settings modal: Profile (read-only) + Security (TOTP devices). `internal-only` (via app-sidebar). Bundles its own `TotpTab`/`TotpVerifyStep`. Has a test. |
| `ThemeProvider` / `useTheme` | `theme-provider.tsx` | Persists light/dark/system theme to a branded localStorage key, applies `.dark`, reacts to OS color-scheme; exposes `useTheme`. **CUSTOM** (React 19 `use()` + branding `storageKey`). Provider mounted once in `providers.tsx`. Has a test. |
| `ModeToggle` | `mode-toggle.tsx` | Single ghost icon button cycling light→dark→system via `useTheme`; used on off-shell pages (denied/error/share-preview). Has a test. Note: `aria-label` is hardcoded English (i18n gap). |
| `Logo` | `logo.tsx` | The anchor brand mark (indigo rounded square + lucide `Anchor`). Widely reused (5+ surfaces). Doc-comment "Replace this component to rebrand" is accurate. |

---

## Utilities (`shared/lib`)

| Module | Path | Purpose |
| --- | --- | --- |
| `branding` | `shared/lib/branding.ts` | Build-time brand identity: `APP_DISPLAY_NAME` and `storageKey(suffix)` (namespaces Web Storage keys by the app slug). `APP_NAME` is module-private. 7 consumers. |
| `format` | `shared/lib/format.ts` | Locale-aware `formatDate` / `formatDateTime` driving `Intl` off the active i18n language. Most-used util (12 consumers). **No dedicated test** despite the locale-routing logic — coverage gap. |
| `status-colors` | `shared/lib/status-colors.ts` | Central status → Tailwind badge-class map (`RECORD_STATUS_BADGE`, `CONTACT_VISIBILITY_BADGE`, `CONTACT_CONFIDENTIAL_BADGE`, `ISSUE_STATUS_BADGE`, `ISSUE_STATUS_ICON_TINT`, `PROCUREMENT_STATUS_BADGE`, `SHIP_STATUS_BADGE`) using shadcn semantic tokens, plus the `CRON_STATUS_VARIANT` status → shadcn-`Badge`-variant map. 9 consumers. Has a test. |
| `tag-utils` | `shared/lib/tag-utils.ts` | Pure tag-list helpers: `addTag` (append trimmed, ignore blanks + case-insensitive dups), `removeTag` (drop by exact name). Re-exported by the contact/project form-logic barrels. Has a test. |
| `preview-blob` | `shared/lib/preview-blob.ts` | `retypeBlobToMime` re-slices a downloaded Blob with an explicit MIME so an octet-stream-served image renders from a `blob:` URL without trusting the server `Content-Type`. Security-relevant (only via plain `<img>`). Has a test. |

---

## Recently extracted (2026-06-07)

Modules promoted/created during the shared-extraction pass (see
[ui-maintenance.md](ui-maintenance.md) for the backlog and rationale). Listed
here so the reference stays complete; fold into the sections above over time.

| Module | Path | Purpose |
| --- | --- | --- |
| `Spinner` | `shared/components/ui/spinner.tsx` | `Loader2` + `animate-spin` with `size` presets (`xs`/`sm`/`md`/`lg`). Replaced 24 ad-hoc inline spinners. |
| `EmptyHint` | `shared/components/ui/centered-hint.tsx` | List-context sibling of `CenteredHint` (top-padded `py` scale, not fill-height) for empty/loading/no-results rows. |
| `PageHeader` | `shared/components/page-header.tsx` | `title` + optional `description` + `actions` slot; standardizes list-page `h1` weight. Adopted by 7 list pages. |
| `CrudDialog` / `CrudListSection` | `shared/components/crud/` | Presentational create/edit dialog + list-section chrome (header/add/table/delete-confirm) that deduped 6 admin settings screens. Mutations + i18n stay caller-owned. |
| `SettingsCard` / `useSettingsByPrefix` | `shared/components/forms/settings-card.tsx`, `shared/hooks/use-settings-by-prefix.ts` | Generic key-value settings card + hook; consumed by the admin auth/smtp/webhook tabs. |
| `useCopyToClipboard` | `shared/hooks/use-copy-to-clipboard.ts` | `{ copied, copy }` with auto-reset; canonical clipboard hook (subsumes the per-site copies). |
| `useProjectCapabilities` / `computeCapabilities` | `shared/hooks/use-project-capabilities.ts` | Promoted out of the projects route group (removed the ships→projects internal dependency); ~21 importers. Has a test. |
| `shared/lib/file` | `shared/lib/file/index.ts` | Pure file helpers `detectFileType` / `FILE_ICONS` / `entryToDisplayItem` + `DisplayItem`/`FileType` types, promoted so `share/previews` no longer reach into the drive route. Has a test. |
| `formatBytes` | `shared/lib/format.ts` | Canonical B→TB byte formatter (replaced two divergent copies). |
| status-colors additions | `shared/lib/status-colors.ts` | `SHIP_STATUS_BADGE`, `CRON_STATUS_VARIANT`, and the issue status→tint map now live in the single status-color source. |

> Still feature-local by design (single consumer — promote on a 2nd): `StatTile`,
> `ProfileField` family, `WorklistPicker`, the drive create/rename dialogs,
> `useIsDark`, cover-field adapters, cron sub-components. Deferred with care
> (behavior/over-generalization risk): `FormDialog`,
> the `FileBrowser` component body. See [ui-maintenance.md](ui-maintenance.md).
> (Fullscreen-modal unification is now done — see `FullscreenDialog` above.)

---

## Adding a new shared component

1. Confirm it is genuinely cross-module (≥2 real consumers, or an obvious near
   future one). Single-use UI stays feature-local under `app/routes/**`.
2. Compose `ui/*` primitives; keep it presentational — callers own data, mutations,
   toasts, and permission decisions.
3. `readonly` props; explicit callback types; no `React.FC`.
4. Generic labels from `common` (keep en/zh in parity); domain labels via props.
   Watch for cross-namespace coupling (see `ListFilter`/`PinToggle` notes).
5. Do not export non-component values from a component file
   (`react-refresh/only-export-components` — put constants/helpers in a `.ts`
   `lib` module, mirroring `priority-variant.ts` vs `priority-signal.tsx`).
6. Prefer the existing barrel (`tags/`, `file/`, `resource/`, `share/`, `editor/`)
   for related families; close helper leaks rather than reaching into deep paths.
7. Add it to the Adoption status table and the relevant section here, then run
   `bun run check`.

