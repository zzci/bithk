# PLAN-016 Prototype Implementation Map

Campaign: `l1-mwo9qmid-20260525155159`  
Scope: content pages for ships, projects, and contacts only. Do not change the global sidebar, app shell, backend, schema, or dependencies.

## Shared Visual Language

Prototype sources read:

- `backup/untitled/README.md`
- `backup/untitled/project/项目管理.html`
- All imported prototype files under `backup/untitled/project/`: `data.js`, `ship-data.js`, `ui.jsx`, `modals.jsx`, `sidebar.jsx`, `tab-overview.jsx`, `tab-workorders.jsx`, `tab-procurement.jsx`, `tab-members-contacts.jsx`, `tab-files.jsx`, `list-view.jsx`, `detail-view.jsx`, `ship-list.jsx`, `ship-detail.jsx`, `ship-profile.jsx`, `ship-tabs-2.jsx`, `contacts-view.jsx`, `app.jsx`, and `styles.css`.

### Token Map

| Prototype pattern | Source | Production mapping |
|---|---|---|
| App canvas `#fff` with soft panels `#f9fafb/#f4f5f8` | `--bg-canvas`, `--bg-softer`, `--bg-soft` | `bg-background`, `bg-muted/30`, `bg-muted/50` |
| Thin neutral borders `#e6e8ec`, dashed dividers | `--border`, `--divider` | `border-border`, `border-border/60`, `border-dashed` |
| Indigo primary `#4f46e5` and soft brand bg | `--brand-600`, `--brand-bg-soft` | `bg-primary`, `text-primary`, `bg-primary/10`, `ring-primary/20` |
| Status colors: success/warn/danger/info | `--s-*` | `Badge` variants where available; otherwise Tailwind semantic utility classes scoped to module components |
| Radius 6-10px, cards mostly 8-12px | `--r-md`, `--r-lg`, `--r-xl` | Existing `Card`, `rounded-md`, `rounded-lg`; avoid larger decorative radii |
| Low elevation on hover | `--shadow-md`, `--shadow-lg` | `shadow-sm`, `hover:shadow-md`, `hover:border-border` |
| Compact type: h1 22-26, h2 16, h3 13, rows 12-14 | `.h1/.h2/.h3`, `.dtable` | Tailwind `text-2xl`, `text-sm`, `text-xs`; no viewport-scaled text |
| Icon buttons and compact icon+text actions | `.btn`, `.btn-icon`, `Icon` | Existing `Button`; lucide-react icons only |

### Reusable Page Patterns

| Pattern | Prototype | Production primitive |
|---|---|---|
| List page header | `.list-view`, `.list-header` | route root `div` with `space-y-4/6`; no shell changes |
| KPI strip | `.kpi-strip`, `KPI` | `Card size="sm"` or bordered div grid with 4 columns, 2 on tablet, 1 on mobile |
| Filter chips | `.filter-chip` | `Button size="sm" variant={active ? "default" : "outline"}` with rounded-full |
| Search | `.search` | `Input` with lucide `Search`, or existing `InputGroup` if already used in module |
| Card grid | `ProjectCard`, `ShipCard` | Existing `Card`; keep hover, compact metadata, badges |
| Detail hero | `.detail-hero`, `.hero-metrics` | Bordered grid section; left visual/summary, right title/actions/metrics |
| Detail tabs | `.detail-tabs`, `.tabs` | Existing `Tabs`, `TabsList variant="line"`, counts in labels where useful |
| Data table | `.dtable` | Existing `Table` primitives |
| Side drawer | `WoDrawer`, `ContactDrawer` | Existing `Sheet` for route drawers; `Dialog` for forms; do not hand-roll overlay primitives |
| File surface | `FilesTab` | Keep production `FileBrowser`; do not fork drive UI |

## Ships Module

### Prototype Targets

| Screen | Target layout | Production files |
|---|---|---|
| Ships list | Header with title/description and admin create action; KPI strip for total/stage/equipment counts; lifecycle filter chips; type/search controls; 3/2/1 column ship cards with lifecycle badge, core specs, project/equipment/port chips. | `apps/web/src/app/routes/_app/ships/index.lazy.tsx` |
| Ship detail shell | Back crumb; hero with ship summary, lifecycle/type/flag chips, admin/delete action, base-project-aware metrics; line tabs with counts. Preserve `visibleShipTabs`. | `apps/web/src/app/routes/_app/ships/$shipId.lazy.tsx`, `apps/web/src/app/routes/_app/ships/-ship-tabs.tsx` |
| Overview tab | Two-column `ov-grid`: left ship archive fields, lifecycle stepper, upcoming maintenance; right quick stats, bound projects preview, equipment category summary. | `apps/web/src/app/routes/_app/ships/-ship-overview-tab.tsx` |
| Equipment tab | Filter chip row by category; search/import/add actions; dense table with name, category, manufacturer/model, serial, location, status, note. Empty state with add/import actions. | `apps/web/src/app/routes/_app/ships/-ship-equipment-tab.tsx` |
| Maintenance tab | Segmented sub-nav for templates/work orders; template cards with copied-from-global/custom badges; global copy control; work-order table with template references. | `apps/web/src/app/routes/_app/ships/-ship-maintenance-tab.tsx`, `apps/web/src/app/routes/_app/ships/-maintenance-template-reference.tsx` |
| Projects tab | Info callout explaining base project; bound project cards with base badge, status, open/unbind actions; keep bind input flow. | `apps/web/src/app/routes/_app/ships/-ship-projects-tab.tsx` |
| Files tab | Prototype has category sidebar/dropzone, but production must keep project-backed `FileBrowser`. Wrap it in the same dense content framing only. | `apps/web/src/app/routes/_app/ships/-ship-files-tab.tsx`, `apps/web/src/app/routes/_app/-file-browser.tsx` |
| Ship forms | Prototype modal has compact sectioned forms. Restyle existing dialog only; do not change payload mapping. | `apps/web/src/app/routes/_app/ships/-ship-form-dialog.tsx`, `apps/web/src/app/routes/_app/ships/-ship-form-logic.ts` |

### Behaviors To Preserve

- `useShips`, `useShip`, `useCreateShip`, `useDeleteShip`, and pagination/filter query behavior.
- Admin-only create on list and admin-only delete on detail.
- Base-project permission lookup through `useProject(ship.baseProjectId)` and `useProjectCapabilities`; pass `canManage` to tabs.
- Base project remains permission and file anchor; `ShipFilesTab` keeps `FileBrowser ownerType="project" ownerId={ship.baseProjectId}`.
- Template CRUD, copy-from-global, delete confirmation, maintenance work order creation through `useCreateProjectIssue`, and issue reference rendering.
- Bind/unbind project APIs and confirmation; base project cannot be unbound.

### Ships Change Checklist

- `index.lazy.tsx`: add KPI strip, lifecycle count chips, search/type controls if backed by existing data or local filtering, richer cards.
- `$shipId.lazy.tsx`: replace simple header with detail hero and tab-count labels while keeping route, query, delete dialog, and `Outlet` behavior unchanged.
- `-ship-overview-tab.tsx`: restructure into archive/lifecycle/maintenance/quick-stat cards.
- `-ship-equipment-tab.tsx`: convert list to dense filtered table/card surface; keep CRUD dialogs and tests.
- `-ship-maintenance-tab.tsx`: split templates/work orders with segmented controls/cards; keep API hooks and dialogs.
- `-ship-projects-tab.tsx`: restyle binding row and project list as cards; preserve unbind confirmation.
- `-ship-files-tab.tsx`: only adjust wrapper sizing/framing around `FileBrowser`.
- `-ship-form-dialog.tsx`: optional sectioned form polish only.
- `apps/web/src/locales/en/ships.json` and `apps/web/src/locales/zh/ships.json`: add keys listed below.

## Projects Module

### Prototype Targets

| Screen | Target layout | Production files |
|---|---|---|
| Projects list | Header with create action, KPI strip, status/tag filter chips, search, card grid/table toggle if local-only. Cards show status, updated/code, tags, member/work-order/procurement/file counts where available. | `apps/web/src/app/routes/_app/projects/index.lazy.tsx` |
| Project detail shell | Back crumb; hero with status, code, id/creator metadata, tags, settings/delete actions, metrics for issues/procurement/members/files; line tabs. | `apps/web/src/app/routes/_app/projects/$projectId.lazy.tsx` |
| Overview tab | Two-column content: description/key info, member preview, procurement categories preview, recent/activity placeholder only if backed by data; right ship/project context only when real data exists. | `apps/web/src/app/routes/_app/projects/-project-overview-tab.tsx` |
| Work orders tab | Stats strip, filter/search toolbar, dense table. Keep click-through to nested issue drawer route. Prototype kanban is optional; do not add if it requires new state/API. | `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx` |
| Work order drawer/full page | Prototype drawer maps to existing `Sheet` + fullscreen route. Restyle panel header/meta/body to dense drawer pattern but keep permissions and attachment/comment footer. | `apps/web/src/app/routes/_app/projects/-project-issue-panel.tsx`, `apps/web/src/app/routes/_app/projects/$projectId.issues.$issueId.lazy.tsx`, `apps/web/src/app/routes/_app/projects/$projectId_.issues.$issueId.full.lazy.tsx` |
| Procurement tab | Pipeline summary from statuses (`draft/requested/ordered/received/closed`), status/category filters, dense table. Use existing manage-only create/status/delete affordances. | `apps/web/src/app/routes/_app/projects/-project-procurement-tab.tsx` |
| Files tab | Prototype category sidebar/dropzone is not a reason to fork drive. Keep existing `FileBrowser` inside denser tab container. | `apps/web/src/app/routes/_app/projects/$projectId.lazy.tsx`, `apps/web/src/app/routes/_app/-file-browser.tsx` |
| Settings | Keep dialog tabs and capability gates; visual polish only where it supports the new content page style. | `apps/web/src/app/routes/_app/projects/-project-settings-general.tsx`, `apps/web/src/app/routes/_app/projects/-project-settings-members.tsx`, `apps/web/src/app/routes/_app/projects/-project-settings-roles.tsx`, `apps/web/src/app/routes/_app/projects/-project-settings-categories.tsx`, `apps/web/src/app/routes/_app/projects/-project-settings-dialog.tsx` |

### Behaviors To Preserve

- `useProjects`, `useTags`, `projectsFilterToQuery`, pagination, create dialog, and admin-only create.
- Project detail route path and nested drawer/fullscreen issue routes.
- `useProjectCapabilities`: settings visibility, procurement visibility/manage, issue manage permissions.
- Issue list filters/search/pagination, create dialog, assignee-member mapping, drawer navigation.
- Issue panel permissions: creator/admin/manager edit-all, assignee status edit/upload, delete restrictions, comments and attachments.
- Procurement status/category filters, supplier/member/category selection, manage-only create/status/delete.
- `ProjectSettingsDialog` tab gating for general, members/roles, and categories.
- Project files remain `FileBrowser ownerType="project" ownerId={project.id}`.

### Projects Change Checklist

- `index.lazy.tsx`: add KPI strip and prototype card density; keep tag/status query mapping.
- `$projectId.lazy.tsx`: add hero metrics and richer tab header; keep `Outlet` for issue drawer.
- `-project-overview-tab.tsx`: convert plain description/dl into card grid with member/category previews.
- `-project-issues-tab.tsx`: add stats strip and chip toolbar; keep table route navigation and create dialog.
- `-project-issue-panel.tsx`: restyle drawer sections; preserve edit, status/priority/assignee/due updates, upload, comments, delete.
- `-project-procurement-tab.tsx`: add pipeline/status summary and dense rows; keep current status names and APIs.
- `-project-settings-dialog.tsx` and sections: only polish spacing/cards; no capability changes.
- `apps/web/src/locales/en/projects.json` and `apps/web/src/locales/zh/projects.json`: add keys listed below.

## Contacts Module

### Prototype Targets

| Screen | Target layout | Production files |
|---|---|---|
| Contacts directory | Header with create action, KPI strip, tag/status filters, search, dense table/list cards. Type settings from prototype should not be implemented unless backed by existing API. | `apps/web/src/app/routes/_app/contacts/index.lazy.tsx` |
| Contact row/card | Type/visibility/confidential badges, tags, contact person, phone/email/address/status, manage actions. Masked public confidential fields must show locked placeholders. | `apps/web/src/app/routes/_app/contacts/index.lazy.tsx` |
| Contact detail drawer | Prototype drawer maps to optional local `Sheet` detail view. If added, it must reuse current contact data and keep manage actions; otherwise table/card expansion is acceptable. | `apps/web/src/app/routes/_app/contacts/index.lazy.tsx` |
| Contact form | Prototype sectioned modal maps to existing `ContactFormDialog`; keep visibility/confidential/tags. | `apps/web/src/app/routes/_app/contacts/-contact-form-dialog.tsx`, `apps/web/src/app/routes/_app/contacts/-contact-form-logic.ts` |
| Share dialog | Keep current grant/revoke user/group dialog. Visual polish only. | `apps/web/src/app/routes/_app/contacts/-contact-share-dialog.tsx` |

### Behaviors To Preserve

- `useContacts({ tag })`, `useCreateContact`, `useUpdateContact`, `useDeleteContact`.
- Tag filter input/apply/clear behavior and active tag indicator.
- `isMasked`: public + confidential + non-manager records expose only unmasked fields and lock sensitive fields.
- `canManage` gates share/edit/delete actions.
- Confirm delete dialog and share grant/revoke to user/group.
- Form mapping for status, visibility, confidential, tax ID, note, address, and tag add/remove behavior.

### Contacts Change Checklist

- `index.lazy.tsx`: replace card grid with prototype-inspired dense directory surface; add KPI strip and compact filter/action toolbar.
- `index.lazy.tsx`: keep or improve locked placeholders for masked fields; do not leak sensitive values.
- `-contact-form-dialog.tsx`: optional sectioned layout and denser tag input styling; keep payload and tests.
- `-contact-share-dialog.tsx`: optional compact visual polish; no behavior changes.
- `apps/web/src/locales/en/contacts.json` and `apps/web/src/locales/zh/contacts.json`: add keys listed below.

## I18n Key Additions

Add keys in both `en` and `zh` locale files. English values:

### `ships.json`

| Key | English value |
|---|---|
| `list.kpi.total` | Total ships |
| `list.kpi.maintenance` | In maintenance |
| `list.kpi.buildingTrial` | Build / sea trial |
| `list.kpi.equipment` | Equipment |
| `list.searchPlaceholder` | Search name, hull number, or IMO |
| `list.typeAll` | All ship types |
| `detail.metrics.projects` | Projects |
| `detail.metrics.equipment` | Equipment |
| `detail.metrics.templates` | Templates |
| `detail.metrics.workOrders` | Work orders |
| `detail.metrics.overduePm` | Overdue PM |
| `overview.archive` | Ship archive |
| `overview.lifecycle` | Lifecycle |
| `overview.upcomingMaintenance` | Upcoming maintenance |
| `overview.quickStats` | Quick stats |
| `overview.boundProjects` | Bound projects |
| `overview.equipmentCategories` | Equipment categories |

### `projects.json`

| Key | English value |
|---|---|
| `list.kpi.total` | Total projects |
| `list.kpi.active` | Active projects |
| `list.kpi.members` | Members |
| `list.kpi.ships` | Covered ships |
| `list.searchPlaceholder` | Search projects |
| `detail.metrics.issues` | Work orders |
| `detail.metrics.procurement` | Procurement |
| `detail.metrics.members` | Members |
| `detail.metrics.files` | Files |
| `overview.keyInfo` | Key information |
| `overview.memberPreview` | Members |
| `overview.categoryPreview` | Procurement categories |
| `issues.stats.total` | Total work orders |
| `issues.stats.inProgress` | In progress |
| `issues.stats.pending` | Pending |
| `issues.stats.done` | Done |
| `procurement.pipeline.title` | Procurement pipeline |
| `procurement.pipeline.summary` | Summary |

### `contacts.json`

| Key | English value |
|---|---|
| `list.kpi.total` | Total contacts |
| `list.kpi.active` | Active |
| `list.kpi.public` | Public |
| `list.kpi.confidential` | Confidential |
| `list.searchPlaceholder` | Search company, person, or note |
| `list.statusAll` | All statuses |
| `list.visibilityAll` | All visibility |
| `drawer.contactMethods` | Contact methods |
| `drawer.tagsAndNotes` | Tags and notes |
| `drawer.sharing` | Sharing |
| `masked.hiddenValue` | Hidden |

## Risks And Gotchas

- Do not copy prototype Chinese demo text into code. Production visible copy must remain i18n-backed.
- The prototype sidebar is context only; production global sidebar and `_app` shell are out of scope.
- Prototype ship illustrations are custom SVG. Prefer simple in-page visual blocks or existing data cards unless implementation explicitly adds repo-owned SVG components inside the module.
- Project/ship files must continue to reuse `FileBrowser`; a parallel file browser would regress drive behavior.
- Project issue drawer is route-backed. Preserve both nested drawer route and fullscreen route, including close/maximize navigation.
- Contacts masking is security-sensitive. Any table/card/drawer redesign must render through the same locked-value logic.
- Permission gates are data behavior, not styling: preserve `isAdmin`, `canManage`, and project capability checks exactly.
- Responsive targets: KPI strips collapse 4 -> 2 -> 1, detail hero collapses to one column, file browser keeps stable height, drawers cap at `92vw`.
- Accessibility: icon-only actions need `aria-label`; filter chips/buttons need visible focus rings; tables must retain semantic `Table` primitives.
