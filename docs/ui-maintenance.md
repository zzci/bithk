# UI Component Maintenance Plan

Actionable, prioritized maintenance plan for the shared UI component layer in
`apps/web/src/shared/components/` (and the shared utilities in
`apps/web/src/shared/lib/`). This document feeds future `/pma` campaigns: each
recommendation is scoped tightly enough to become a single task.

It complements two existing docs and does not replace them:

- [ui-components.md](ui-components.md) — the generated component reference and
  conventions (presentational-first, `readonly` props, no `React.FC`, shadcn
  base-nova + `@base-ui/react` locked base).
- [ui-consistency-audit.md](ui-consistency-audit.md) — the 2026-05-31 visual
  consistency audit. The carry-over items below track what that audit's roadmap
  still leaves open.

All paths are repo-relative.

---

## 1. Health snapshot

### Component count

| Layer | Count |
| --- | --- |
| `ui/*` primitives (incl. `Sidebar`, `Logo`) | 30 |
| List / detail shared components | ~22 (incl. multi-export files) |
| Resource / share bundle | ~17 |
| Subsystems (tags, documents, sidebar, file, editor) | ~22 |
| App-shell + shared `lib/*` utilities | ~12 |
| **Total shared modules tracked** | **~100** |

### Adoption breakdown

Counts exclude same-directory sibling importers and test files (matching the
inventory's attribution rules).

| Adoption | Meaning | Examples |
| --- | --- | --- |
| **in-use** | 2+ external consumers | `Button` (97), `Input` (45), `Label` (38), `Dialog` (36), `Badge` (32), `ErrorBanner` (33), `ListFilter` (12), `TagInput` (9) |
| **single-use** | exactly 1 external consumer (often by design) | `ShareDialogHost`, `AppSidebar`, `previews/shell`, `document-tree.utils`, `CodeEditor`, `CodePreview`, `ResourceAttachmentSection` |
| **internal-only** | no external consumer; reached via a wrapper, barrel, side-effect, or `React.lazy` | `Alert`, `AlertDialog`, `InputGroup`, `CommandPalette`, `SettingsDialog`, `ShareDialog`, `MilkdownMarkdownEditor`, `MarkdownPreview`, all `share/previews/*` |
| **truly unused** | no consumer, not a wrapper/barrel/lazy entry | **0 dead files** (verified). Only dead *sub-exports* exist (see P1). |

No dead shared **files** were found. The only genuinely dead surface is at the
**export** level: `AlertTitle`, `share-helpers.formatDate`, and several unused
sub-exports on large primitives (`Avatar` group helpers, `Sidebar` parts,
`DropdownMenu`/`ContextMenu`/`Combobox`/`Select` carry-over parts, and
`document-tree.utils` `flattenVisible`/`subtreeIds`/`stepFocus`).

### Test-coverage gaps (in-use shared components without a co-located test)

| Component | Path | Adoption |
| --- | --- | --- |
| `DetailMetaRow` (+5 exports) | `apps/web/src/shared/components/detail-meta-row.tsx` | in-use, 6 exports, ~289 lines, no test |
| `DetailDescription` | `apps/web/src/shared/components/detail-description.tsx` | in-use, no test |
| `ResourceFooterSections` | `apps/web/src/shared/components/resource/footer-sections.tsx` | in-use (composed surface), no test |
| `useResourceAttachmentUpload` | `apps/web/src/shared/components/resource/use-attachment-upload.ts` | in-use hook, no test |
| `ShareDialog` | `apps/web/src/shared/components/share/share-dialog.tsx` | ~560 lines, reconcile logic, no test |
| `CoverField` / `CoverImage` | `apps/web/src/shared/components/cover-field.tsx`, `cover-image.tsx` | in-use, no test |
| `format` (date) | `apps/web/src/shared/lib/format.ts` | 12 consumers, locale-routing logic, no test |
| `Button`, `Input`, `Dialog`, `Badge`, `Select` and most `ui/*` | `apps/web/src/shared/components/ui/*` | high-traffic primitives, no test (acceptable for thin shadcn wrappers; `ErrorBanner` is the only tested `ui/*`) |

### Convention-violation count

| Violation | Count | Where |
| --- | --- | --- |
| `React.FC` | **0** | clean across `shared/components/` |
| Non-`readonly` props | **2** | `ResizableDrawerProps`, `SettingsDialog` inline props |
| Non-component exports co-located with a component (`react-refresh/only-export-components`) | **1 file, 3 exports** | `resource/attachment-section.tsx` (`attachmentsQueryKey`, `isPreviewable`, `formatFileSize`) |
| Hardcoded user-facing strings (i18n gap) | **3 surfaces** | `editor/index.tsx` ("Loading editor…"), `milkdown-editor.tsx` (9 inline-fallback keys), `ui/dialog.tsx` `DialogFooter` "Close" |

---

## 2. Prioritized recommendations

Effort key: **S** ≈ ≤0.5 day, **M** ≈ 1–2 days, **L** ≈ 3+ days. Risk is the
chance of regression in adopting surfaces.

### P1 — Remove dead exports (low-risk hygiene)

**Problem.** No dead files, but dead exports add API surface and confuse future
authors.

**Evidence.**
- `apps/web/src/shared/components/ui/alert.tsx` — `AlertTitle` has zero
  references repo-wide (verified). `Alert`/`AlertDescription` are reached only
  via `ui/error-banner.tsx`.
- `apps/web/src/shared/components/share/share-helpers.ts` `formatDate` (line 47)
  — only consumer is its own test (`share-helpers.test.ts`). It uses browser
  locale (`Intl.DateTimeFormat(undefined, …)`), diverging from the canonical
  i18n-driven `apps/web/src/shared/lib/format.ts`.
- `apps/web/src/shared/components/documents/document-tree.utils.ts` —
  `flattenVisible`, `subtreeIds`, `stepFocus` are exported and unit-tested but
  unused by the sole consumer `-documents-sidebar.tsx`.

**Proposed action.** Delete `AlertTitle`; delete `share-helpers.formatDate` and
its `describe("formatDate")` block. For `document-tree.utils.ts`, either delete
the three unused exports + their tests, or add a one-line header comment marking
them as retained for the unbuilt picker/move dialog the file references.

**Effort.** S. **Risk.** Low (no production consumers).

---

### P2 — Promote feature-local modules that have outgrown their folder

**Problem.** Three feature-local modules are imported across module boundaries
via `../` reaches, which is a layering smell (leading-dash files are
feature-private by convention).

**Evidence.**
- `FileBrowser` (`apps/web/src/app/routes/_app/-file-browser.tsx`, 543 lines)
  imported by `drive.lazy.tsx` (`./-file-browser`),
  `projects/$projectId.files.lazy.tsx` (`../-file-browser`), and
  `ships/-ship-files-tab.tsx` (`../-file-browser`) — verified. Its companion
  surface `-drive-file-list-surface.tsx` (4 importers) and
  `-file-browser-types.ts` (`formatSize`, `detectFileType`, `FILE_ICONS`,
  `entryToDisplayItem`, `DisplayItem`; 11 importers) must move with it.
- `useProjectCapabilities`/`computeCapabilities`
  (`apps/web/src/app/routes/_app/projects/-use-project-role.ts`) imported by
  **8** ships files via `../projects/-use-project-role` (verified) plus ~13
  projects files — a ships→projects internal dependency.

**Proposed action.**
1. Move the `FileBrowser` family + its pure type/util helpers to
   `shared/components/file/` (alongside the existing `file-upload-button.tsx`);
   keep drive-specific queries/mutations in the drive route. Co-move
   `-file-browser.test.tsx` and `-drive-file-picker.test.tsx`.
2. Promote `-use-project-role.ts` to `shared/hooks/use-project-capabilities.ts`
   (keep `computeCapabilities` separately exported for unit tests). Update all
   ~21 importers to `@/shared/...`.

**Effort.** L (FileBrowser), M (capabilities hook). **Risk.** Medium — wide
import-path churn; mechanical but touches many files. Run these as separate
campaigns (see sequencing).

`StatTile` (`ships/-ship-stats.tsx`) is a **watch-item only**: fully generic but
single-module today; promote opportunistically when projects/admin dashboards
need a metric tile, not preemptively.

---

### P3 — Collapse duplicated re-implementations of shared primitives

**Problem.** Shared primitives are re-hand-rolled at call sites, and two
byte/date formatters coexist.

**Evidence.**
- **Two byte formatters.** `formatFileSize` (`resource/attachment-section.tsx:54`,
  caps at MB) vs `formatBytes` (`share-helpers.ts:34`, B→TB). They diverge on
  the same input. `-project-issues-tab.tsx:39` imports `formatFileSize` from a
  *component* file purely for the helper (layering smell).
- **`CenteredHint` re-implemented inline.** Verbatim
  `flex … items-center justify-center … text-sm text-muted-foreground/text-destructive`
  in `attachment-section.tsx` (~lines 324/330/364) and `share-dialog.tsx`
  (~line 478), instead of `apps/web/src/shared/components/ui/centered-hint.tsx`.
- **Inline empty/loading hint in 13 files** across projects/contacts/admin/ships/
  drive (e.g. `<p className="py-10 text-center text-sm text-muted-foreground">`).
  `CenteredHint` does not fit because it is fill-height
  (`h-full items-center justify-center`); these need top-padded list-context
  centering — which is exactly why the pattern keeps getting re-written.

**Proposed action.**
1. Add the canonical byte formatter to `shared/lib/format.ts` (adopt the
   GB/TB-capable `formatBytes`), migrate the 5 call sites, delete both copies.
2. Replace the inline `CenteredHint`-equivalent divs in `attachment-section.tsx`
   and `share-dialog.tsx` with `<CenteredHint>`.
3. Add a list-context sibling to `CenteredHint` (e.g. `EmptyHint` with a `py`
   variant) in `shared/components/ui/`, then replace the 13 hand-rolled blocks.
   Keep `CenteredHint` for fill-height panel states; leave icon-rich
   empty-states (drive empty folder, unsupported-preview) as-is.

**Effort.** S (formatters), S (CenteredHint inline), M (EmptyHint + 13 sites).
**Risk.** Low — purely presentational; formatter migration is the only one that
changes output (attachment sizes will gain GB/TB — desired).

---

### P4 — Fix convention violations

**Problem.** Small, well-localized deviations from the `ui-components.md`
conventions.

**Evidence & action.**

| Item | File | Fix |
| --- | --- | --- |
| Non-`readonly` props | `apps/web/src/shared/components/resizable-drawer.tsx` (`ResizableDrawerProps`, verified) | Mark all 4 members `readonly` |
| Non-`readonly` inline props | `apps/web/src/shared/components/settings-dialog.tsx` | Mark `open`/`onOpenChange` `readonly` |
| Non-component exports beside a component | `apps/web/src/shared/components/resource/attachment-section.tsx` | Move `attachmentsQueryKey`/`isPreviewable`/`formatFileSize` to a sibling lib (`resource/attachment-utils.ts`); leave the `.tsx` exporting only the component + types. (`formatFileSize` is also resolved by P3.) |
| Hardcoded "Loading editor…" | `apps/web/src/shared/components/editor/index.tsx:30` | Resolve from `common.loading` via `useTranslation("common")` |
| Hardcoded `DialogFooter` "Close" | `apps/web/src/shared/components/ui/dialog.tsx` | Use `t("common.close")` to match `DialogContent` |

**Effort.** S (all). **Risk.** Low.

---

### P5 — Restore en/zh i18n parity in the Milkdown editor (correctness)

**Problem.** `milkdown-editor.tsx` calls `t(key, "English default")` with inline
English fallbacks for **9 keys** absent from both
`apps/web/src/locales/en/editor.json` and `.../zh/editor.json`: `toolbar`,
`undo`, `redo`, `heading1`, `heading2`, `heading3`, `tableAddRow`,
`tableAddColumn`, `tableDelete`. Because the keys are missing in *both* locales,
the en/zh diff is empty (so `check-i18n` does not flag it), yet Chinese users see
English strings ("Undo", "Heading 1", "Add row", …).

**Evidence.** `apps/web/src/shared/components/editor/milkdown-editor.tsx`,
`apps/web/src/locales/en/editor.json`, `apps/web/src/locales/zh/editor.json`.

**Proposed action.** Add all 9 keys to both locale files with proper
translations, then drop the inline English fallbacks so each key is the single
source of truth (and becomes visible to the i18n gate).

**Effort.** S. **Risk.** Low. **Note:** highest functional severity in the scan
(actual zh users see untranslated text) — sequence early despite small size.

---

### P6 — Close out audit carry-over items

The 2026-05-31 audit roadmap delivered partial infrastructure; these remain open.
Each can become its own campaign.

| Item | State | Open work | Effort |
| --- | --- | --- | --- |
| **Color tokenization (P1 of audit)** | open | ~19 raw-palette sites unmigrated to `--success`/`--warning`/`--destructive`. Cited: `denied.tsx:88` (`text-green-500`), `-drive-upload-panel.tsx:70` (`text-emerald-500`), `settings-dialog.tsx:289-290,398` (amber + green), `shared.$token.tsx:43,45` (amber), `admin/-cron-dynamic-fields.tsx:104` + `admin/cron.lazy.tsx:242-243` (inconsistent amber shades), `admin/-policies-check.tsx:150` (green/red panel), `logo.tsx:13` (`bg-indigo-600`). Tokens already exist in `index.css`. Decorative hues (file-type icons, drive selection `sky-*`, favorite star) can stay raw or get a documented decision. | M |
| **EmptyState + Spinner primitives (P2 of audit)** | partial | Loading skeletons (`list-skeleton.tsx`) + list error branches landed. Still missing: a shared `EmptyState` (only documents-local exists) and a shared `Spinner` (Loader2 used directly at ~36 sites, sizes 3.5/4/5/6). Also delete local `ListState` in `-project-overview-tab.tsx:128` and local `ErrorBanner` in `admin/-settings-shared.tsx:82` (duplicates `ui/error-banner.tsx`). Overlaps P3's `EmptyHint`. | M |
| **`ListPageShell` (P3 of audit)** | partial | Sub-pieces shipped (`SearchInput`, `SearchCreateBar`, `ListFilter`); no overarching shell. `admin/users/index.lazy.tsx` still uses a bordered `<Table>` + one-off `w-64` search (not `SearchCreateBar`). `space-y` rhythm (6/5/4) and pagination (`justify-between` vs admin's `justify-center`) still diverge. | L |
| **`ResizableDetailSheet` / modal migration (P4 of audit)** | partial | Built as `ResizableDrawer`; issues + procurements migrated. **Not** migrated: `admin/-cron-create-drawer.tsx` (still raw `createPortal` + `fixed inset-0`) and `-file-preview-dialog.tsx` (hand-rolled `role="dialog"`, portal dropped but no focus-trap/inert). New offender `-univer-sheet-editor-dialog.tsx:448` (`bg-black/50`). Overlay opacity still 3 kinds (`black/10` primitives, `/30` drawers, `/50` preview dialogs). | M |
| **Typography close-out (P5 of audit)** | partial | Detail H1 weight now consistent. Still open: no `text-2xs` token (52 `text-[1Npx]` magic numbers, verified); edit `Pencil` 4 sizes coexist (2.5/3/3.5/4); contacts use `Edit3` vs `Pencil` everywhere else; list H1 `font-bold` vs detail `font-semibold`; admin row-action icons `size-3.5` vs others `size-4`. | M |

---

### P7 — Add tests for high-traffic untested shared components

**Problem.** Several broadly-adopted shared components carry meaningful logic but
no co-located test (see snapshot table).

**Proposed action.** Add unit tests for, in priority order: `format.ts` (locale
routing), `DetailMetaRow` (date/select narrowing), `ShareDialog` (desired-state
reconcile), `useResourceAttachmentUpload`, `DetailDescription`,
`ResourceFooterSections`. Thin `ui/*` shadcn wrappers do not need dedicated tests.

**Effort.** M. **Risk.** Low (additive).

---

### P8 — Documentation hygiene

**Problem.** `ui-components.md` is the canonical reference and must stay accurate
as the layer changes; the contact-share divergence needs a recorded decision.

**Evidence.**
- `apps/web/src/app/routes/_app/contacts/-contact-share-dialog.tsx` re-implements
  the share-dialog shell against a different backend (`useGrantContact`/
  `useRevokeContact` ACL) instead of the resource-agnostic
  `shared/components/share/` system (15 files use the shared one). Genuinely
  different model (user/group ACL vs token-based direct/public shares) — not a
  drop-in.
- `ui-components.md` "Adoption status" table predates PLAN-051 migration
  completion; `SearchCreateBar`/`PaginationFooter`/etc. are now in use.

**Proposed action.**
1. Decide whether the contact grant model can register as a share-registry
   resource type (`renderExtraSection`-style). If yes, retire
   `-contact-share-dialog.tsx`; if no, record the deliberate divergence in
   `docs/decisions/` so it is not mistaken for an un-migrated holdout.
2. Refresh `ui-components.md` adoption table after each campaign and keep it
   under the `check` gate; verify orphaned i18n keys via `git grep`, not the
   unused-count (the dynamic-namespace safety-net hides drive/editor keys).

**Effort.** S. **Risk.** Low.

---

## 3. Suggested campaign sequencing

Order chosen so cheap/low-risk hygiene lands first, shared primitives exist
before the consolidations that depend on them, and wide import-path churn happens
last.

| # | Campaign | Covers | Depends on | Effort |
| --- | --- | --- | --- | --- |
| 1 | **ui-i18n-parity** | P5 (Milkdown keys) + P4 hardcoded strings (`editor/index.tsx`, `DialogFooter`) | — | S |
| 2 | **ui-dead-and-conventions** | P1 dead exports + P4 `readonly`/non-component-export fixes | — | S |
| 3 | **ui-format-consolidation** | P3 byte/date formatters → `shared/lib/format.ts` | #2 (attachment-section export move) | S |
| 4 | **ui-empty-state** | P3 `EmptyHint` + inline `CenteredHint` + P6 EmptyState/Spinner + delete local `ListState`/`ErrorBanner` | #3 | M |
| 5 | **ui-color-tokens** | P6 color tokenization | — (parallel-safe with #1–#4) | M |
| 6 | **ui-modal-unification** | P6 `ResizableDrawer` migration of cron + file-preview + univer; overlay opacity | — | M |
| 7 | **ui-typography-closeout** | P6 `text-2xs` token, Pencil/Edit3 unification, H1 weight, icon sizes | #4 (shared primitives settled) | M |
| 8 | **ui-promote-capabilities** | P2 `useProjectCapabilities` → shared hook | — | M |
| 9 | **ui-promote-filebrowser** | P2 `FileBrowser` family + `-file-browser-types.ts` → `shared/components/file/` | #8 (do capability hook first to keep import churn separable) | L |
| 10 | **ui-listpageshell** | P6 `ListPageShell` (header/space-y/search/filter/container/pagination unification incl. admin/users) | #4, #7 | L |
| 11 | **ui-tests** | P7 tests for untested in-use components | runs after each touch; final sweep here | M |

Cross-cutting: **P8 documentation hygiene** is not a standalone campaign — fold
the `ui-components.md` adoption refresh into the closing step of every campaign,
and run the contact-share decision as a quick spike before deciding whether
campaign work is even needed there.


---

## Shared-extraction candidates (2026-06-07)

A consolidated, deduped backlog from the per-area scans (projects, ships, admin, app-root) plus the whole-app pattern sweep. Overlapping reports are merged below (e.g. the form-dialog pattern reported by both projects and ships; the EmptyHint/CenteredHint pattern reported by ships and the cross-cutting sweep). This subsumes and cross-references the open items in §2/§6 above — where an item is already tracked there, the campaign link is noted so this stays the single source of truth.

Counts were re-verified against the tree on 2026-06-07; where a raw scan count differed from a live grep, the verified number is used and the discrepancy noted.

### Ranked table

| Candidate | Kind | Current location | Cross-module / dup | Recommended shared home | Effort | Risk | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `CenteredHint` adoption (inline empty/loading hints) | component | exists at `shared/components/ui/centered-hint.tsx`; 4 importers + ~13 inline re-impls | 4 adopters, ~13 inline dup sites | `shared/components/ui/` (+ new `EmptyHint` list variant) | S–M | low | **High** |
| `InlineSpinner` (Loader2 + animate-spin) | component | none — inline at call sites | 27 call-sites across ~15 files | `shared/components/ui/spinner.tsx` | S | low | **High** |
| CRUD dialog pattern (`mode: create\|edit`) | inline-pattern | `admin/-settings-{contact,global-categories,ship,tag-admin}.tsx` | 6 instances / 4 files | `shared/components/crud/crud-dialog.tsx` | M | medium | **High** |
| CRUD list section (table + delete confirm + dialog) | inline-pattern | same 4 admin settings files | 6 instances / 4 files | `shared/components/crud/crud-list-section.tsx` | L | medium | **High** |
| `detectFileType` / `FILE_ICONS` / `formatSize` (FileBrowser types) | util | `app/routes/_app/-file-browser-types.ts` | 11 importers incl. `shared/components/share/previews/drive-preview.tsx` | `shared/lib/file/` (+ `shared/lib/format.ts` for bytes) | M | low | **High** (already P2/P3) |
| `useProjectCapabilities` / `computeCapabilities` | hook | `projects/-use-project-role.ts` | ~21 importers incl. 8 ships files via `../projects/` | `shared/hooks/use-project-capabilities.ts` | M | medium | **High** (already P2) |
| `useSettingsByPrefix` + `SettingsCard` | hook + component | `admin/-settings-shared.tsx` | 3 tabs (auth, smtp, webhook) | `shared/components/forms/` | S | low | Medium |
| Form dialog pattern (`ProjectFormDialog` + `ShipFormDialog`) | component / pattern | `projects/-project-form-dialog.tsx`, `ships/-ship-form-dialog.tsx` | 2 impls | `shared/components/forms/form-dialog.tsx` | M | medium | Medium |
| `PageHeader` (h1 + subtitle) | component | none — inline | 7 pages | `shared/components/page-header.tsx` | S | low | Medium |
| `useCopyToClipboard` / `CopyButton` | hook | none — inline | 3 files (settings-dialog, project-settings-dialog, ships index, denied) | `shared/hooks/use-copy-to-clipboard.ts` | S | low | Medium |
| `useIsDark` | hook | `app/routes/_app/-file-preview-hooks.ts` | 1 (single-use, generic) | `shared/hooks/use-is-dark.ts` | S | low | Medium |
| `StatTile` | component | `ships/-ship-stats.tsx` | 1 (generic, single-module) | `shared/components/ui/stat-tile.tsx` | S | low | Medium (already P2 watch) |
| `ShipStatusBadge` + `SHIP_STATUS_BADGE` | component | `ships/-ship-visuals.tsx` | 1 | `shared/lib/status-colors.ts` + `shared/components/ui/status-badge.tsx` | S | low | Medium |
| `STATUS_ICON_TINT` consolidation | inline-pattern | `projects/-project-issues-tab.tsx` | dup of `ISSUE_STATUS_BADGE` | `shared/lib/status-colors.ts` | S | low | Medium |
| Pill button pattern (`pillBase`) | inline-pattern | `projects/-project-issues-tab.tsx` | 7 sites (one file) | `Button variant="pill"` or `shared/components/pill-button.tsx` | M | low | Medium |
| Fullscreen modal overlay | inline-pattern | `-file-preview-dialog.tsx`, `-univer-sheet-editor-dialog.tsx` | 2 | `shared/components/ui/dialog.tsx` / `resizable-drawer.tsx` | M | medium | Medium (already P6 modal) |
| `text-2xs` token (magic font sizes) | inline-pattern | repo-wide | 50 verified `text-[1Npx]` | `tailwind.config.ts` token | S | low | Medium (already P6 typography) |
| `DetailMetaRow` adoption | component | exists at `shared/components/detail-meta-row.tsx` | 2 adopters; more candidates | `shared/components/` (drive adoption) | S | low | Low-Watch |
| `buildMemberLabelMap` | util | `projects/-member-helpers.ts` | 6 importers (all projects) | `shared/lib/helpers/` | S | low | Low-Watch |
| `ProfileField`/`ProfileSection`/`ProfileSummary` | component | `ships/-ship-profile-tab.tsx` | 1 (inline family) | `shared/components/ui/profile-field.tsx` | S | low | Low-Watch |
| `ProjectOverviewTab` micro-components (`ActivityRow`, `ListState`, `ListErrorState`, `LatestActivityCard`) | component | `projects/-project-overview-tab.tsx` | 1 (local; `ListState` dups `ui/error-banner`) | `shared/components/ui/` | S | low | Low-Watch (P6 EmptyState overlap) |
| `WorklistPicker` | component | `projects/-worklist-picker.tsx` | 1 | `shared/components/` (pass items as prop) | M | low | Low-Watch |
| `PROJECT_TABS` / `activeProjectTab` | util | `projects/-project-tabs.ts` | 1 | `shared/lib/router/` | S | low | Low-Watch |
| `RenameDialog` | component | `app/routes/_app/-entry-create-dialogs.tsx` | 1 | `shared/components/ui/` | S | low | Low-Watch |
| `CreateFolderDialog`/`CreateTextFileDialog`/`CreateSpreadsheetDialog`/`MoveDialog` | component | `-entry-create-dialogs.tsx` | 1 (drive-local) | `shared/components/drive/` | M | low | Low-Watch |
| `DirectoryEditDialog` | component | `app/routes/_app/-team-directory-list.tsx` | 1 | `shared/components/drive/` | M | low | Low-Watch |
| `ProjectCoverField` / `ShipCoverField` (cover adapters) | component | `projects/-project-cover-field.tsx`, `ships/-ship-cover-field.tsx` | 2 domain wrappers | keep feature-local (watch) | S | low | Low-Watch |
| `CardIdentifier` (copyable id) | component | `ships/index.lazy.tsx` | 1 | `shared/components/copyable-identifier.tsx` | S | low | Low-Watch |
| `CRON_STATUS_VARIANT` (`STATUS_VARIANT` map) | inline-pattern | `admin/-cron-logs-dialog.tsx` | 1 | `shared/lib/status-colors.ts` | S | low | Low-Watch |
| `FieldRow`/`FieldHint`/`DrawerSection` (cron layout) | component | `admin/-cron-create-drawer.tsx` | 1 | `shared/components/ui/form/` (defer) | S | low | Low-Watch |
| `ActionMetaCard`/`DynamicActionFields`/`CronRowActions` | component | `admin/-cron-*.tsx` | 1 each (cron-typed) | `shared/components/cron/` only if cron grows | S | low | Low-Watch |

---

### High priority

**`CenteredHint` adoption + a list-variant `EmptyHint`.** A real `CenteredHint` primitive already exists at `shared/components/ui/centered-hint.tsx` but is underused: only 4 files import it (`combobox.tsx`, `tag-input.tsx`, `settings-dialog.tsx`, `drive-preview.tsx` per grep), while ~13 files still hand-roll `text-center text-sm text-muted-foreground` empty/loading/no-results blocks (contacts, projects issues/procurement, worklist-picker, ship bind dialog, team-directory-members, etc.). The caveat — already noted in §3/P3 — is that `CenteredHint` is fill-height (`h-full items-center justify-center`), so list-context call sites need a separate top-padded `EmptyHint` variant, which is exactly why the inline pattern keeps reappearing. Home: `shared/components/ui/`. This is the same item as the P6 "EmptyState + Spinner" carry-over and campaign #4 (`ui-empty-state`).

**`InlineSpinner`.** `Loader2` with `animate-spin` appears at **27 call-sites** (verified) across ~15 files with ad-hoc sizing (`size-3`/`size-4`/`size-5`/`size-6`): drive upload/preview/univer dialogs, `ships/index.lazy.tsx`, `shared.$token.tsx`, `totp-verify.tsx`, `full-page-loader.tsx`, `settings-dialog.tsx`, all three share previews, `share-dialog.tsx`. Extract `shared/components/ui/spinner.tsx` with preset sizes (`xs/sm/md/lg`). This is the "Spinner" half of P6/audit-P2; folding it into campaign #4 keeps it with `EmptyHint`.

**CRUD dialog pattern (`mode: create|edit`).** The same create/edit form dialog is re-implemented across 4 admin settings files — `-settings-contact.tsx` (CategoryDialog), `-settings-global-categories.tsx` (CategoryDialog), `-settings-tag-admin.tsx` (TagDialog), and `-settings-ship.tsx` which alone holds 3 (WorklistDialog, GlobalEquipmentCategoryDialog, GlobalEquipmentManufacturerDialog) — **6 instances total** (verified via `mode '...'` grep). ~95% duplicated; only field names, mutation hooks, and i18n keys vary. Extract a generic `CrudDialog<T>` taking field descriptors + mutations into `shared/components/crud/`. Coupling caveat: mutation hooks and i18n keys must stay passed-in from the route; the dialog stays presentational.

**CRUD list section (table + delete confirm + dialog trigger).** The full section wrapping each dialog above (title/desc header, `Plus` button, table with empty row, edit/delete button pairs, `ConfirmDeleteDialog`, dialog trigger) is duplicated in the same 6 places (`-settings-contact.tsx`, `-settings-global-categories.tsx`, `-settings-ship.tsx` ×3, `-settings-tag-admin.tsx`), ~200+ lines of duplication. Extract `CrudListSection<T>` into `shared/components/crud/` composing the table + delete confirm + the `CrudDialog` above. Sequence after `CrudDialog` (it composes it); coupling is light (mutations + i18n keys as props).

**FileBrowser types: `detectFileType` / `FILE_ICONS` / `formatSize`.** Pure file-type detection, icon mapping, and byte formatting live in `app/routes/_app/-file-browser-types.ts` (11 importers, verified) and are already reached cross-layer by `shared/components/share/previews/drive-preview.tsx`. `formatSize` is additionally duplicated across drive surfaces (`-file-preview-types.ts`, `-drive-file-list-inner.tsx`, `-drive-upload-panel.tsx`, `-drive-version-history-dialog.tsx`, `-file-preview-dialog.tsx`). Move detection/icons to `shared/lib/file/` and route bytes through the canonical formatter in `shared/lib/format.ts`. This is the existing P2 (FileBrowser family promotion) + P3 (byte formatter consolidation); the type/util helpers must move with the `FileBrowser` component (campaign #9).

**`useProjectCapabilities` / `computeCapabilities`.** Generic `ProjectCapability` derivation hook in `projects/-use-project-role.ts`, imported by ~21 files including **8 ships files** via `../projects/-use-project-role` (a ships→projects internal dependency). Promote to `shared/hooks/use-project-capabilities.ts`, keeping `computeCapabilities` separately exported for unit tests. This is exactly P2 / campaign #8; do it before the FileBrowser move so import churn stays separable.

### Medium priority

**`useSettingsByPrefix` + `SettingsCard`.** Generic key-value settings hook + card already in `admin/-settings-shared.tsx`, consumed by 3 tabs (auth, smtp, webhook — verified; the scan's "2" undercounted by missing webhook). Pure props-in/JSX-out with no admin coupling, already in a `-shared` file. Promote to `shared/components/forms/`. Caveat: the settings-API query keys stay admin-defined; the card/hook only need the prefix and field list.

**Form dialog pattern (`ProjectFormDialog` + `ShipFormDialog`).** Reported separately by projects and ships — same pattern. `projects/-project-form-dialog.tsx` (~114 lines) and `ships/-ship-form-dialog.tsx` (~220 lines) share the structure: `Dialog` wrapper, fields, `ErrorBanner`, custom footer, field-reset-on-open, pending state. Extract a composable `FormDialog` primitive (or factory) into `shared/components/forms/`. Caveat: each feature keeps its own field set + create/update mutations; only the shell, error banner, and reset/pending lifecycle generalize. Medium risk because the two field schemas differ enough that over-generalizing can hurt readability.

**`PageHeader`.** List/detail headers repeat `h1.text-2xl.font-bold` + `p.mt-1.text-muted-foreground` across **7 pages**: `projects/index.lazy.tsx`, `ships/index.lazy.tsx`, `contacts/index.lazy.tsx`, `overview.lazy.tsx`, `admin/users.tsx`, `admin/cron.lazy.tsx`, `admin/audit.lazy.tsx`. Extract `<PageHeader title description actions?>` into `shared/components/`. Note the latent conflict with P6 typography: list H1 is `font-bold` vs detail `font-semibold` — `PageHeader` should standardize this, so sequence alongside campaign #10 (`ui-listpageshell`).

**`useCopyToClipboard` / `CopyButton`.** `navigator.clipboard.writeText()` + `useState(copied)` + `setTimeout(reset, 2000)` repeated in `settings-dialog.tsx`, `projects/-project-settings-dialog.tsx`, `ships/index.lazy.tsx`, and `denied.tsx` (grep finds 3 `.tsx` carrying `clipboard.writeText`; scan listed 4 sites). Extract `useCopyToClipboard()` (and optionally a `CopyButton`) into `shared/hooks/`. Pure presentational, no coupling.

**`useIsDark`.** Theme-aware dark-mode resolver (theme provider + system preference) in `-file-preview-hooks.ts`, single-use today but generic. Promote to `shared/hooks/use-is-dark.ts` for any preview/rendering surface needing effective theme.

**`StatTile`.** Pure metric card (label, value, optional accented icon, optional hint) in `ships/-ship-stats.tsx`, zero domain coupling. Already a documented **watch-item in P2** — promote opportunistically to `shared/components/ui/stat-tile.tsx` when projects/admin dashboards need a metric tile, not preemptively.

**`ShipStatusBadge` + `SHIP_STATUS_BADGE` and `STATUS_ICON_TINT` consolidation.** Two related status-color items. `SHIP_STATUS_BADGE` (`ships/-ship-visuals.tsx`) is the single source of ship lifecycle colors and mirrors `RECORD_STATUS_BADGE`/`ISSUE_STATUS_BADGE`/`PROCUREMENT_STATUS_BADGE` already in `shared/lib/status-colors.ts` (verified exports). Separately, `STATUS_ICON_TINT` in `projects/-project-issues-tab.tsx` duplicates the issue status→color mapping that `ISSUE_STATUS_BADGE` already owns (it uses `text-*` tokens where the badge uses `bg-*/text-*` pairs). Move the ship map into `status-colors.ts` (with a `StatusBadge` component) and make `status-colors.ts` the single source so `STATUS_ICON_TINT` can derive from it rather than restate it. The cron `STATUS_VARIANT` (Low-Watch, below) belongs in the same consolidation as `CRON_STATUS_VARIANT`.

**Pill button pattern (`pillBase`).** Hand-rolled `rounded-full px-2.5 text-xs font-normal gap-1.5` (solid/dashed border + conditional foreground) repeated **7×** within `projects/-project-issues-tab.tsx` (lines 650/715/732/753/776/797/818). Add a `Button variant="pill"` or `shared/components/pill-button.tsx`. Single-file today, so low risk; worth doing because the variant will likely spread to other filter/chip rows.

**Fullscreen modal overlay.** `-file-preview-dialog.tsx` and `-univer-sheet-editor-dialog.tsx` both render `fixed inset-0 z-50` overlays with custom click-outside dismissal and a fullscreen toggle. This is the existing **P6 modal-unification** item (campaign #6): migrate to `Dialog`/`ResizableDrawer` or a shared `FullscreenDialog`. Medium risk (focus-trap/inert and backdrop behavior must be preserved). Overlay opacity also still diverges (`black/10` vs `/30` vs `/50`).

**`text-2xs` token.** **50** `text-[1Npx]` magic font sizes verified (scan said 53; existing P6 says 52 — the live count is now 50). Define a `text-2xs` (10px) token in `tailwind.config.ts` and migrate. Already tracked as P6/audit-P5; campaign #7 (`ui-typography-closeout`).

### Low-Watch

These are single-use, lightly-coupled, or already-existing-but-underused. Promote only when a 2nd consumer appears (or fold into a larger campaign):

- **`DetailMetaRow` adoption** — primitive exists; only 2 adopters (`-project-issue-panel.tsx`, `-project-procurement-panel.tsx`, verified). Drive other detail panels to it for consistency rather than extracting anything new.
- **`buildMemberLabelMap`** — pure 31-line label map, 6 projects importers (verified); move to `shared/lib/helpers/` when a non-projects consumer appears.
- **`ProfileField`/`ProfileSection`/`ProfileSummary`** — inline metadata family in `ships/-ship-profile-tab.tsx`; generic but single-use. Extract to `shared/components/ui/` if projects detail views adopt the same layout.
- **`ProjectOverviewTab` micro-components** (`ActivityRow`, `ListState`, `ListErrorState`, `LatestActivityCard`) — local presentational pieces; note `ListState` duplicates `ui/error-banner.tsx` and is already flagged for deletion in P6/audit-P2.
- **`WorklistPicker`** — generic search+grouped-list+select picker; minor coupling to `useReferenceableWorklists` (pass items as a prop to decouple).
- **`PROJECT_TABS` / `activeProjectTab`** — pure routing helpers; `shared/lib/router/` when another nested-tab context needs them.
- **`RenameDialog`** and the drive **create/move dialogs** (`CreateFolderDialog`, `CreateTextFileDialog`, `CreateSpreadsheetDialog`, `MoveDialog`) + **`DirectoryEditDialog`** — clean drive-local dialogs; promote to `shared/components/drive/` only if a second module needs drive-style creation flows.
- **`ProjectCoverField` / `ShipCoverField`** — thin per-domain adapters over the shared `CoverField`, each owning its own set/remove mutations. Keep feature-local; promote a shared cover-adapter only if a 3rd domain needs the identical pattern.
- **`CardIdentifier`** — copyable identifier in the ship list card; promote to `shared/components/copyable-identifier.tsx` if project/contact cards grow the same. Pairs naturally with the `useCopyToClipboard` extraction above.
- **`CRON_STATUS_VARIANT`** — `STATUS_VARIANT` map in `admin/-cron-logs-dialog.tsx`; fold into `shared/lib/status-colors.ts` alongside the other status-color consolidation.
- **Cron layout/field components** (`FieldRow`, `FieldHint`, `DrawerSection`, `ActionMetaCard`, `DynamicActionFields`, `CronRowActions`) — single-use and mostly cron-schema-typed. Defer; extract to a `shared/components/cron/` folder only if cron is surfaced from other admin views.

### Decision / documentation items (no extraction)

- **Contact-share divergence** — `contacts/-contact-share-dialog.tsx` re-implements the share shell against a user/group ACL backend (`useGrantContact`/`useRevokeContact`) instead of the token-based `shared/components/share/` system (15 files). This is the existing **P8** item: record the deliberate divergence in `docs/decisions/` (or register the grant model as a share-registry resource type) so it is not read as an un-migrated holdout. Not a presentational extraction.

---

### Suggested order

Cheap, low-risk primitives first; the shared primitives must exist before the consolidations that depend on them; wide import-path churn last. This dovetails with the §3 campaign sequencing.

1. **`InlineSpinner` + `EmptyHint`/`CenteredHint` adoption** (S–M, low) — the two most-duplicated primitives (27 spinner sites, ~13 hint sites); unblocks list/loading states everywhere. Folds into campaign #4 `ui-empty-state`.
2. **Status-color consolidation** (S, low) — move `SHIP_STATUS_BADGE`, fold `STATUS_ICON_TINT` and `CRON_STATUS_VARIANT` into `shared/lib/status-colors.ts`; add a `StatusBadge`. Pure data move.
3. **`text-2xs` token** (S, low) — single Tailwind config token, then mechanical migration of the 50 magic sizes. Part of campaign #7.
4. **`PageHeader` + `useCopyToClipboard`** (S, low) — two small standalone primitives, no churn beyond their call sites; resolve list-vs-detail H1 weight in `PageHeader`.
5. **`useSettingsByPrefix`/`SettingsCard` + `useIsDark`** (S, low) — already isolated; trivial moves.
6. **`CrudDialog<T>` then `CrudListSection<T>`** (M then L, medium) — biggest line-count win in admin (6 instances each); section composes the dialog, so dialog first.
7. **`FormDialog` primitive** (M, medium) — generalize project/ship form dialogs only after the simpler dialogs above prove the API.
8. **Modal/overlay unification** (M, medium) — file-preview + univer fullscreen dialogs (campaign #6); needs focus-trap care.
9. **`useProjectCapabilities` → shared hook** (M, medium) — wide but mechanical import churn (~21 files); campaign #8.
10. **`FileBrowser` family + `-file-browser-types.ts` → `shared/components/file/`** (L, medium) — widest import churn (11+ importers); do last and after the capability hook so the two churns stay separable (campaign #9).

Note: `ProfileField` family, `WorklistPicker`, drive create/rename dialogs, cron sub-components, and the cover-field adapters are intentionally deferred to "promote-on-second-consumer" and are not in this order. The contact-share decision is a docs/spike, run independently of the above.
