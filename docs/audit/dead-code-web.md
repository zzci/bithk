# Dead-Code Audit — Web Frontend (`apps/web/src`)

**Dimension:** dead-code-web (unused components, hooks, route modules, utils, exported symbols, types, dead i18n keys, orphaned assets)
**Campaign:** `l1-w6c655lo-audit-20260602135842`
**Scope:** `apps/web/src/**` (components, hooks, TanStack file routes, utils, `src/locales` i18n catalogs). READ-ONLY audit — no code was changed.

## Methods

| # | Method | How |
|---|--------|-----|
| 1 | `knip` | `bunx knip --workspace apps/web --include files,exports,types,duplicates` (ephemeral; lockfile/package.json verified untouched after) |
| 2 | `ts-prune` | `bunx ts-prune -p apps/web/tsconfig.json` (cross-check only — dominated by framework `Route` exports, in-module exports, and UI re-export noise) |
| 3 | i18n key-usage analysis | Custom Bun script: flattened **1423** `en` leaf keys across 20 namespaces, matched each against concatenated source with **bounded-literal** regex (`["'\`:]key["'\`]`), **dynamic-prefix** coverage (30 `t(\`prefix.${…}\`)` patterns), and **i18next plural** awareness (`_one`/`_other` resolved via base key). Cross-verified with grep. |
| 4 | Manual `grep` verification | Every non-trivial finding confirmed at call sites; partially-used key prefixes (e.g. `capabilityGroup.*`, `browser.action.*`) resolved leaf-by-leaf. |

Confidence rule applied: **high** = no static reference anywhere AND not reachable via any dynamic-import / `lazy()` / i18n template-interpolation path; downgraded to medium/low where any such risk exists.

## Totals

| Severity | Count | Notes |
|----------|-------|-------|
| critical | 0 | — |
| high | 0 | Dev-phase; no dead code causes a correctness/security defect |
| medium | 4 | Orphaned TOC feature: `toc.tsx` + `toc-scanner.ts`; dead persistence helpers `readPersistedExpansion` + `writePersistedExpansion` |
| low | 153 | `toc-scanner.test.ts` + `STORAGE_KEY` (2) + 1 dead re-export + 1 dead test type + 13 redundant value `export`s + 27 redundant type `export`s + **109 dead i18n keys** (each mirrored in `zh`, so ~218 strings) |
| excluded (documented FP) | ~56 | ~50 shadcn/ui primitive re-exports (intentional library surface) + 5 editor duplicate exports (intentional `default` for `lazy()`) + `routeTree.gen.ts` (codegen) |

> **i18n removal note:** `src/locales/i18n-parity.test.ts` enforces **en↔zh key-set parity**. Every dead `en` key listed below has an identical `zh` twin; removal must delete the key from **both** locale files or the parity test fails.

---

## A. Genuinely dead code (MEDIUM)

### A1 — Orphaned Table-of-Contents feature cluster
- `apps/web/src/shared/components/editor/toc.tsx:59` — severity: medium — confidence: high
  - rationale: `TableOfContents` + `useHeadingAnchors` (the file's only exports) are imported nowhere; `editor/index.tsx` does not re-export them. (knip: "Unused files (1)")
  - suggested action: delete `toc.tsx`.
- `apps/web/src/shared/components/editor/toc-scanner.ts:1` — severity: medium — confidence: high
  - rationale: `scanMarkdownHeadings` / `HeadingNode` are imported **only** by the orphaned `toc.tsx` (verified: no other consumer) → transitively dead.
  - suggested action: delete `toc-scanner.ts` together with `toc.tsx`.
- `apps/web/src/shared/components/editor/toc-scanner.test.ts:1` — severity: low — confidence: high
  - rationale: tests only the transitively-dead `toc-scanner.ts`.
  - suggested action: delete alongside the cluster.

### A2 — Dead localStorage tree-expansion persistence helpers
- `apps/web/src/shared/components/documents/document-tree.utils.ts:161` — severity: medium — confidence: high
  - rationale: `readPersistedExpansion` is defined and never referenced (definition-only; ref-count = 1). No dynamic/string indirection.
  - suggested action: remove the function.
- `apps/web/src/shared/components/documents/document-tree.utils.ts:178` — severity: medium — confidence: high
  - rationale: `writePersistedExpansion` is defined and never referenced (definition-only; ref-count = 1).
  - suggested action: remove the function.
- `apps/web/src/shared/components/documents/document-tree.utils.ts:159` — severity: low — confidence: high
  - rationale: the private `STORAGE_KEY` const is consumed **only** by the two dead functions above (lines 164, 182) → becomes dead once they are removed.
  - suggested action: remove together with A2 functions.

---

## B. Dead re-export & dead type (LOW)

- `apps/web/src/app/routes/_app/ships/-ship-colors.ts:9` — severity: low — confidence: high
  - rationale: `export { ISSUE_STATUS_BADGE } from "@/shared/lib/status-colors"` is never imported from `-ship-colors`; the two consumers of this file pull `SHIP_STATUS_BADGE` / `EQUIPMENT_STATUS_BADGE`, and every `ISSUE_STATUS_BADGE` consumer imports it directly from `status-colors.ts`. Pure pass-through re-export, dead.
  - suggested action: delete line 9.
- `apps/web/src/test/utils.tsx:39` — severity: low — confidence: high
  - rationale: exported type `RenderWithProvidersResult` is defined and never used (definition-only; ref-count = 1), including in-module.
  - suggested action: remove the type alias.

---

## C. Redundant `export` modifiers — symbol is ALIVE, only the `export` is unnecessary (LOW)

These are **not dead code**: each symbol is used inside its own module, but no other module imports it (knip "Unused exports"/"Unused exported types"). The cleanup is to drop the `export` keyword, not to delete the symbol. Listed for completeness; verify before touching as some are deliberate API-module surface.

### C1 — Value exports used only in-module
- `apps/web/src/app/routes/_app/-file-preview-types.ts:76` `extensionOf` — low — high — rationale: used at lines 89/125 of same file only. action: drop `export`.
- `apps/web/src/app/routes/_app/projects/-project-issue-panel.tsx:60` `priorityVariants` — low — high — rationale: used at lines 298/309 same file. action: drop `export`.
- `apps/web/src/app/routes/_app/projects/-project-issue-panel.tsx:67` `priorityKey` — low — high — rationale: used at 299/304/309 same file. action: drop `export`.
- `apps/web/src/app/routes/_app/projects/-project-tabs.ts:7` `PROJECT_TABS` — low — high — rationale: used at line 8 (`ProjectDetailTab` type) same file. action: drop `export`.
- `apps/web/src/app/routes/login.tsx:44` `toRouterPath` — low — high — rationale: used at line 69 same file. action: drop `export`.
- `apps/web/src/shared/components/resource/comment-section.tsx:46` `commentsQueryKey` — low — high — rationale: used at 128/168/201 same file. action: drop `export`.
- `apps/web/src/shared/lib/api/admin-default-cover.ts:22` `defaultCoverKeys` — low — high — rationale: query-key factory used only in-module. action: drop `export`.
- `apps/web/src/shared/lib/api/contact-categories.ts:29` `contactCategoryKeys` — low — high — rationale: used only in-module. action: drop `export`.
- `apps/web/src/shared/lib/api/global-categories.ts:29` `globalCategoryKeys` — low — high — rationale: used only in-module. action: drop `export`.
- `apps/web/src/shared/lib/api/procurement.ts:101` `procurementTagKeys` — low — high — rationale: used only in-module. action: drop `export`.
- `apps/web/src/shared/lib/api/settings.ts:20` `settingKeys` — low — high — rationale: used only in-module. action: drop `export`.
- `apps/web/src/shared/lib/api/share.ts:80` `shareKeys` — low — high — rationale: used only in-module (11 refs). action: drop `export`.
- `apps/web/src/shared/lib/branding.ts:13` `APP_NAME` — low — high — rationale: used by `storageKey()` at line 27 same file. action: drop `export`.

### C2 — Type exports used only in-module (drop `export` on the type)
`DriveListSource` (`-drive-entry-list.tsx:39`), `UploadStatus`/`UploadTask`/`UploadOwner` (`-drive-upload.ts:14/16/43`), `DisplayOwnerType` (`-file-browser-types.ts:29`), `PreviewKind` (`-file-preview-dialog.tsx:68`), `ActionInputType`/`SchedulePreset` (`admin/-cron-types.ts:42/96`), `EntityOption`/`ResourceGroupMember` (`admin/-policies-shared.ts:28/86`), `ContactPanelMode` (`contacts/-contact-panel.tsx:42`), `ProjectTab` (`-project-overview-tab.tsx:29`), `DetailPanelVariant` (`detail-panel-header.tsx:15`), `ShareTarget` (`share/index.ts:3`), `ContactListMeta`/`ContactTagView` (`api/contacts.ts:22/28`), `Attachment` (`api/documents.ts:69`), `DriveEntryType` (`api/drive.ts:29`), `ProcurementTagRef`/`ProcurementListMeta` (`api/procurement.ts:40/83`), `IssueTagRef`/`ListMeta`/`IssueReferenceInput` (`api/projects.ts:104/130/545`), `SearchHitType` (`api/search.ts:8`), `ShareType`/`PublicDocumentBody` (`api/share.ts:28/285`), `ResolvedWorklist`/`ListMeta` (`api/ships.ts:100/117`), `FetchUserResult` (`stores/auth.ts:32`), `SystemStatus` (`stores/system.ts:4`).
- severity: low — confidence: medium — rationale: each is referenced within its own module but imported by no other file (per knip); they may be intentional API-module type surface. action: drop `export` where the type is truly module-local; keep for stable API modules. (These are zero-runtime; lowest priority.)

---

## D. Dead i18n keys (LOW) — 109 `en` keys, each mirrored in `zh`

All verified absent from source via bounded-literal match, after excluding dynamic-prefix and plural-resolved keys. Confidence **high** unless noted. Citations point at `locales/en/<ns>.json`; the identical `zh` line must also be removed (parity test).

### audit.json (2)
- `locales/en/audit.json:8` `audit:allActions` — low — high — rationale: audit filter "all" label; filter now uses shared `ListFilter` defaults. action: remove key (en+zh).
- `locales/en/audit.json:9` `audit:allResults` — low — high — same as above. action: remove.

### contacts.json (10)
- `locales/en/contacts.json:11` `contacts:list.statusAll` — low — high — rationale: superseded by `ListFilter` common "all" label. action: remove.
- `locales/en/contacts.json:12` `contacts:list.categoryAll` — low — high — same. action: remove.
- `locales/en/contacts.json:13` `contacts:list.tagFilterLabel` — low — high — rationale: old contact tag-filter UI removed in `ListFilter` adoption. action: remove.
- `locales/en/contacts.json:14` `contacts:list.tagFilterLabelCount` — low — high — same. action: remove.
- `locales/en/contacts.json:15` `contacts:list.tagFilterEmpty` — low — high — same. action: remove.
- `locales/en/contacts.json:16` `contacts:list.tagFilterRemove` — low — high — same. action: remove.
- `locales/en/contacts.json:20` `contacts:list.kpi.total` — low — high — rationale: contacts KPI tiles removed (no `kpi` reference anywhere in src). action: remove.
- `locales/en/contacts.json` `contacts:list.kpi.active` — low — high — same. action: remove.
- `locales/en/contacts.json` `contacts:list.kpi.public` — low — high — same. action: remove.
- `locales/en/contacts.json` `contacts:list.kpi.confidential` — low — high — same. action: remove.

### cron.json (1)
- `locales/en/cron.json:23` `cron:typeFilter.all` — low — high — rationale: `typeFilter.cat.${cat}` is used dynamically but the standalone `typeFilter.all` is not. action: remove.

### documents.json (2)
- `locales/en/documents.json:20` `documents:col.title` — low — high — rationale: dead table-column header (documents list is not a column table). action: remove.
- `locales/en/documents.json:88` `documents:conflict.title` — low — medium — rationale: no static reference; "document changed elsewhere" conflict banner may be a planned/disabled feature. action: remove or wire up.

### drive.json (18)
- `locales/en/drive.json:6` `drive:page.team.back` — low — high — rationale: no reference. action: remove.
- `locales/en/drive.json:21` `drive:sidebar.teamDirectories` — low — high — rationale: no reference. action: remove.
- `locales/en/drive.json:46` `drive:browser.selectAll` — low — high — rationale: batch-selection affordance; `browser.selectedCount` is used but `selectAll` is not. action: remove.
- `locales/en/drive.json` `drive:browser.selectEntry` — low — high — same. action: remove.
- `locales/en/drive.json` `drive:browser.clearSelection` — low — high — same. action: remove.
- `locales/en/drive.json` `drive:browser.filter.type` — low — high — rationale: `browser.filter.{all,folders,files,images}` are used; `filter.type` is not. action: remove.
- `locales/en/drive.json` `drive:browser.status.label` — low — high — rationale: Files/Trash view-toggle strings; no static or dynamic `browser.status.*` reference. action: remove.
- `locales/en/drive.json` `drive:browser.status.files` — low — high — same. action: remove.
- `locales/en/drive.json` `drive:browser.status.trash` — low — high — same. action: remove.
- `locales/en/drive.json` `drive:browser.empty.trash` — low — high — rationale: no reference. action: remove.
- `locales/en/drive.json` `drive:browser.action.preview` — low — high — rationale: `browser.action.{versions,move,trash,download,restore}` used; `preview` not. action: remove.
- `locales/en/drive.json` `drive:browser.action.copyLink` — low — high — same. action: remove.
- `locales/en/drive.json:134` `drive:team.list.title` — low — high — rationale: no reference. action: remove.
- `locales/en/drive.json:139` `drive:team.col.members` — low — high — rationale: `team.col.{name,actions}` used; `members` not. action: remove.
- `locales/en/drive.json:140` `drive:team.col.role` — low — high — same. action: remove.
- `locales/en/drive.json:179` `drive:preview.description` — low — high — rationale: no reference (`preview.tools.*` used dynamically, these are not). action: remove.
- `locales/en/drive.json:182` `drive:preview.pdfTitle` — low — high — same. action: remove.
- `locales/en/drive.json:213` `drive:picker.empty` — low — high — rationale: no reference. action: remove.

### issues.json (6)
- `locales/en/issues.json:14` `issues:allStatuses` — low — high — rationale: filter uses dynamic `issues.status.${…}`; standalone `allStatuses` unused. action: remove.
- `locales/en/issues.json:15` `issues:allPriorities` — low — high — same. action: remove.
- `locales/en/issues.json:30` `issues:col.title` — low — high — rationale: dead table-column header. action: remove.
- `locales/en/issues.json:32` `issues:col.priority` — low — high — same. action: remove.
- `locales/en/issues.json:33` `issues:col.assignee` — low — high — same. action: remove.
- `locales/en/issues.json:35` `issues:col.dueDate` — low — high — same. action: remove.

### policies.json (1)
- `locales/en/policies.json:8` `policies:allNamespaces` — low — high — rationale: `ns.${…}` used dynamically; standalone `allNamespaces` unused. action: remove.

### projects.json (61)
**toast (5)** — `projects:toast.procurementUpdated` (`:22`), `toast.procurementDeleted` (`:23`), `toast.procurementStatusChanged` (`:24`), `toast.issueUpdated` (`:26`), `toast.issueDeleted` (`:27`) — low — high — rationale: no `t()` reference; toasts likely consolidated. action: remove.
**list (10)** — `list.filterByTag`, `list.viewMode`, `list.viewGrid`, `list.viewList` (view-mode toggle removed; only drive's `browser.view*` is live), `list.kpi.total`/`active`/`archived`/`tags` (KPI tiles removed), `list.col.name`/`code`/`status` (table headers; list is a card grid) — `locales/en/projects.json` (~`:42`–`:53`) — low — high. action: remove.
**edit (3)** — `edit.title` (`:97`), `edit.description` (`:98`), `edit.submit` (`:99`) — low — high — rationale: project form dialog uses `create.*`; no `edit.*` reference. action: remove.
**detail (3)** — `detail.breadcrumb` (`:109`), `detail.metrics.issues` (`:116`), `detail.metrics.procurement` (`:117`) — low — high — rationale: detail metrics labels unused (overview uses other keys). action: remove.
**settings (1)** — `settings.description` (`:122`) — low — high. action: remove.
**overview (3)** — `overview.creator` (`:139`), `overview.noTags` (`:141`), `overview.updatedAt` (`:142`) — low — high. action: remove.
**issues sub-tree (17)** — `issues.create` (`:159`), `issues.allPriorities` (`:166`), `issues.viewMode` (`:167`), `issues.viewList` (`:168`), `issues.viewKanban` (`:169`), `issues.total`+`issues.total_one`+`issues.total_other` (`:172`; base `issues.total` itself unused — no paginated total label in issues tab), `issues.col.title/status/priority/assignee/dueDate`, `issues.field.priority`, `issues.field.clearDueDate`, `issues.field.project`, `issues.composer.manualCreate`, `issues.createDescription` — low — high (the `total*` triplet: medium — verify no issues-tab pagination footer before deleting). action: remove.
**procurement sub-tree (9)** — `procurement.mixedCurrencies`, `procurement.col.assignee`, `procurement.col.actions`, `procurement.pipeline.title`, `procurement.pipeline.description`, `procurement.pipeline.amount`, `procurement.delete.title`, `procurement.delete.confirm`, `procurement.detail.description` — low — high — rationale: pipeline/column/delete-dialog strings with no `t()` reference. action: remove.
**members (4)** — `members.loading` (`:313`), `members.tabDescription` (`:314`), `members.noRole` (`:315`), `members.joinedAt` (`:316`) — low — high. action: remove.
**capabilityGroup (4)** — `capabilityGroup.project` (`:395`), `capabilityGroup.members` (`:396`), `capabilityGroup.roles` (`:397`), `capabilityGroup.categories` (`:398`) — low — high — rationale: code references only `capabilityGroup.{files,issue,procurement}`; these four leaves are unused. action: remove.

### ships.json (8)
- `locales/en/ships.json:19` `ships:list.kpi.total` — low — high — rationale: ship KPI tiles removed (no `kpi` reference). action: remove.
- `locales/en/ships.json` `ships:list.kpi.maintenance` — low — high — same. action: remove.
- `locales/en/ships.json` `ships:list.kpi.buildingTrial` — low — high — same. action: remove.
- `locales/en/ships.json` `ships:list.kpi.inService` — low — high — same. action: remove.
- `locales/en/ships.json:57` `ships:detail.metricHints.projects` — low — high — rationale: detail metric-hint labels unused. action: remove.
- `locales/en/ships.json` `ships:detail.metricHints.equipment` — low — high — same. action: remove.
- `locales/en/ships.json` `ships:detail.metricHints.worklists` — low — high — same. action: remove.
- `locales/en/ships.json:136` `ships:equipment.uncategorized` — low — medium — rationale: no static reference; equipment grouping may fall back to it programmatically — verify the equipment-tab grouping path before deleting. action: remove or confirm runtime use.

---

## E. Excluded / documented false-positives (NOT findings)

- **shadcn/ui primitive re-exports (~50):** e.g. `AlertDialogOverlay`/`AlertDialogPortal`/`AlertDialogTrigger` (`ui/alert-dialog.tsx`), `AvatarImage`/`AvatarGroup`/`AvatarBadge` (`ui/avatar.tsx`), `Combobox*` (`ui/combobox.tsx`), `Sidebar*` (`ui/sidebar.tsx`), `Select*`, `Sheet*`, `ContextMenu*`, `DropdownMenu*`, `buttonVariants`, `badgeVariants`, `tabsListVariants`, etc. — these are the intentional public API surface of vendored shadcn components. Knip flags them as currently-unimported, but convention is to retain the full primitive set. **Keep** (severity: low/exclude, confidence: high).
- **Editor duplicate exports (5):** `code-editor.tsx`, `code-preview.tsx`, `markdown-preview.tsx`, `markdown-source-view.tsx`, `milkdown-editor.tsx` each export a named component **and** a `default`. The `default` is consumed via `lazy(() => import("…"))` (`-file-preview-dialog.tsx:90/91`, `editor/index.tsx:14/15`, `milkdown-editor.tsx:88`); the named export is used directly / in tests. Both are live — **keep**.
- **`app/routeTree.gen.ts`:** TanStack Router codegen — excluded by directive.
- **Dynamic / template-assembled i18n keys (~153):** keys reached via `t(\`prefix.${var}\`)` — entire `denied` namespace (`t(\`denied:${reason}.title\`)`), `errors:codes.*`, `cron:{filter,status,presets,typeFilter.cat,actionGroup}.*`, `*:status.*`, `*:field.*`, `issues.status.*`/`issues.priority.*`, `procurement.{status,priority}.*`, `equipment.{status,field}.*`, `capability.*`, `roles.tier.*`, `members.kind.*`, `permission.*`, `team.role.*`, `ns.*`/`rel.*`, `theme.*`, `nav.*`, `tile.*`, `preview.tools.*`, `priority${…}`, `status${Active|Disabled}`. **Not dead** — excluded from §D.
- **ts-prune output:** ~470 lines, almost entirely framework `Route` exports (TanStack file routes), `(used in module)` self-references, and the shadcn re-exports above. Used only as a cross-check; produced no findings beyond knip.

---

## Suggested remediation order (for a future approved cleanup campaign)

1. **§A** — delete the TOC cluster (3 files) and the dead persistence helpers + `STORAGE_KEY`. Self-contained, zero call sites.
2. **§B** — drop the dead `ISSUE_STATUS_BADGE` re-export line and the unused test type.
3. **§D** — strip the 109 dead i18n keys from **both** `en` and `zh` (run the parity test after).
4. **§C** — optionally drop redundant `export` modifiers (lint-level; verify API-module types are not intended as public surface first).

_No source files were modified by this audit; only this report was added._
