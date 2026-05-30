# PLAN-037 — Procurement module parity with the issue module

- Status: Draft (analysis — awaiting approval)
- Date: 2026-05-30
- Owner: BKD L2 dispatch `c2w9dmlg`
- Campaign: `l1-xlhyvzyz-procrefactor-20260530184509`
- Related: PLAN-035 (procurement detail parity, Completed), PLAN-023/031 (tag
  model + abstraction), PLAN-024/026 (status-grouped work-order list),
  decision 002 (procurement free-transition status)

> **This is a proposal only.** No implementation has started. Dispatch of
> implementation subtasks (L3) is blocked until L1/user approves.

## 1. Goal

Bring the procurement module to **full feature parity with the issue (工单)
module** by reusing the issue UI/interaction surface (status-grouped list, tag
system + multi-tag filter, search, inline-settable detail fields, comments +
per-comment attachments), while **preserving and extending** procurement's
own field set (supplier / category / quantity / amount / currency) and its
own status vocabulary. Issue behaviour is the baseline; procurement only
**adds** its specials on top — it never loses what PLAN-035 already gave it.

## 2. Current surface — issue module (baseline)

Backend (`apps/api/src/modules/issue/`):

- **schema.ts**: `issue_details` (description, priority, dueDate, projectId,
  assigneeMemberId) + `issue_tags` join (source_type=`issue`).
- **list** (`listByProject`): filters `q` (title LIKE), `status`, `priority`,
  `tagIds` (multi-tag **OR/union** via `listResourceIdsByAnyTag`), paginated.
- **create/update**: accept `tags: string[]` synced through the generic
  `syncResourceTagsTx(issueTagBinding, …)`; status lives on `items.status`,
  changed inline through the PATCH route.
- **status enum**: `todo | working | review | done | cancel` (5).
- **attachments**: dedicated item-level routes (`POST/GET/DELETE …/attachments`)
  **and** per-comment attachments via `mountItemCommentRoutes`.
- **references.*.ts**: generic issue references (maintenance_template / url /
  document) + ship maintenance-order rollup. **Issue-specific.**
- soft-delete (`DELETE` route), pin/unpin.

Frontend (`apps/web/src/app/routes/_app/projects/`):

- **-project-issues-tab.tsx** (705 lines): **status-grouped collapsible
  sections** (5), per-section quick-create, `ProjectTagFilter` multi-select,
  debounced search, row → detail drawer, hover pin toggle, `CreateIssueDialog`.
- **-project-issue-panel.tsx** (581 lines): inline-editable title / status /
  priority / assignee / **due-date (button + hidden native picker, ChevronDown
  glyph)** / tags; markdown description editor; `ResourceFooterSections` with
  `commentsEnableAttachments` **on**; delete affordance.
- **-project-issue-hooks.ts** + `shared/lib/api/projects.ts`: query/mutation
  hooks (`useProjectIssues`, `useProjectIssue`, create/update/delete,
  `useIssueTags`).
- Status colour tokens: `shared/lib/status-colors.ts` `ISSUE_STATUS_BADGE`.

## 3. Current surface — procurement module

Backend (`apps/api/src/modules/procurement/`):

- **schema.ts**: `procurement_details` already carries the PLAN-035 issue-parity
  fields (description, priority, dueDate, assigneeMemberId) **plus** the
  procurement specials: `supplierId` (→ global contact, SET NULL),
  `categoryId` (→ `procurement_categories`, SET NULL), `itemName` (NOT NULL),
  `quantity` (int), `amount` (int, minor currency unit), `currency` (text ≤10).
- **status enum**: `draft | requested | ordered | received | closed |
  cancelled` (6), **free-transition** (decision 002), changed through a
  **dedicated** `POST …/procurements/:id/status` route with its own audit event.
- **list** (`listByProject`): filters `status`, `categoryId` only — **no `q`,
  no `priority` filter, no `tagIds`**.
- comments + attachments via `mountItemCommentRoutes` (parity), pin/unpin.
- **non-deletable** by design (retire via `cancelled`; no DELETE route).
- **no tags, no references.**

Frontend:

- **-project-procurement-tab.tsx** (481 lines): **flat paginated table**
  (name / status / amount / category / supplier / assignee), single-select
  status + category dropdowns, page buttons, `CreateProcurementDialog`. **No
  tag filter, no search, no status grouping.**
- **-project-procurement-panel.tsx** (738 lines): inline-editable itemName /
  status (dedicated endpoint) / priority / assignee / due-date (Pencil glyph,
  not ChevronDown) / supplier / category / quantity / amount / currency
  (`InlineMetaField`); markdown description; `ResourceFooterSections` **without**
  `commentsEnableAttachments`. **No tags.** Badges use `variant="secondary"`,
  **not** the shared status colour tokens.
- `shared/lib/api/procurement.ts`: `useProcurements`, `useProcurement`, create,
  update, `useChangeProcurementStatus` (dedicated). No tag hook.

## 4. Reuse / abstraction map (shared base = `items`)

Both sub-types sit on the shared `items` base and already share substantial
machinery. **Prefer reuse; the only net-new backend table is the tag join.**

| Concern | Status | Strategy |
| --- | --- | --- |
| Tag vocabulary + assignment (`tag.service.ts`, `ResourceTagBinding`, `syncResourceTagsTx`, `listResourceIdsByAnyTag`) | **Already fully generic** | Add `procurementTagBinding`; mirror `issueTagBinding` exactly. Zero changes to `tag.service.ts`. |
| Comments + item/comment attachments (`mountItemCommentRoutes`, `ResourceFooterSections`, `comment-section.tsx`) | **Already shared** | Flip `commentsEnableAttachments` on; add the comment-attachment delete gate. |
| Markdown editor, Select/Badge/Button/Dialog, `buildMemberLabelMap`, pins API, `useResourceAttachmentUpload` | **Already shared** | No change. |
| `ProjectTagFilter` (multi-select) | Shared, issue-only consumer | Reuse verbatim for procurement (type-param already supported). |
| Status colour tokens (`status-colors.ts`) | Issue-only (`ISSUE_STATUS_BADGE`) | **Extract** a `PROCUREMENT_STATUS_BADGE` map alongside it (parallel to decision 005 token policy). |
| Status-grouped collapsible list UI | Issue-only (tab) | **Generalise** the grouping shell or copy-and-type for the 6 procurement statuses. (See open question Q1.) |
| Pin toggle, priority-variant map | Duplicated per module | Optional small abstraction; low priority, defer unless cheap. |
| Generic references / maintenance orders | Issue-only | **Out of scope** for procurement (no business need). See Q2. |

## 5. Procurement-specific fields and type differences

All already exist in `procurement_details` (PLAN-035 + original). Parity work
does **not** add business fields; it surfaces tags + filters + status UI.

| Field | Type | vs issue |
| --- | --- | --- |
| `itemName` | text NOT NULL | Issue has none; procurement's primary label. `title` is optional and defaults to `itemName`. |
| `supplierId` | text → `contacts.id`, SET NULL | Global (not project-scoped) reference; issue has none. |
| `categoryId` | text → `procurement_categories.id`, SET NULL | Project-scoped; issue has none. |
| `quantity` | integer, ≥0, nullable | Numeric inline field; issue has none. |
| `amount` | integer (minor currency unit), ≥0, nullable | Numeric inline field; issue has none. |
| `currency` | text ≤10, nullable | Free text inline; issue has none. |
| description / priority / dueDate / assigneeMemberId | same types as issue | Already at parity (PLAN-035). |

## 6. Procurement status set + migration scoping

- **Keep** the 6-status free-transition vocabulary (`draft | requested |
  ordered | received | closed | cancelled`) and the dedicated status endpoint
  with its audit event — decision 002 governs this and must not be silently
  reverted. Parity does **not** mean adopting the issue 5-status enum.
- **Migration-scoping pattern** (mirror migration 0003): `items.status` is the
  single shared column for both sub-types. Any data migration touching status
  MUST be scoped `WHERE type = 'procurement'` so issue rows are untouched, just
  as 0003 scoped `WHERE type = 'issue'`. No status data migration is expected
  for this campaign (the enum is unchanged); the new tag join is the only DDL.
- The list/grouping UI groups by these 6 statuses; status colour tokens
  (`PROCUREMENT_STATUS_BADGE`) are defined for all 6.

## 7. Gaps to close (parity backlog)

1. **Procurement tags + multi-tag OR filter** — backend join table + binding +
   `tagIds`/`q`/`priority` list filters + `tags` on create/update + frontend
   filter. (mirrors issue tag work, commit d82e77a / 96f942a)
2. **List search (`q`)** — title/itemName LIKE; fold into the list change.
3. **Status-grouped collapsible list** — replace the flat table with the issue
   tab's grouped shell over the 6 procurement statuses, keeping the existing
   category filter. (Q1)
4. **Per-comment attachments** — enable `commentsEnableAttachments` + delete
   gate, matching the issue panel.
5. **Shared status colour tokens** for procurement badges.
6. **Due-date control alignment** (ChevronDown glyph) — cosmetic.
7. Verify item-level attachment parity (issue has dedicated `…/attachments`
   routes; procurement currently only the comment-route path) — confirm whether
   procurement needs the dedicated routes or the shared footer already covers
   it. (Q3)

## 8. Proposed L3 breakdown + dependency DAG

All L3 run in **isolated worktrees** (L1 rule). Quality gate `bun run check`.

| L3 | Title | Mode | Files (owned) | Deps |
| --- | --- | --- | --- | --- |
| **B1** | Procurement tags + list filters (backend) | worktree | `modules/procurement/{schema,procurement.service,procurement.routes}.ts`, `modules/tag/schema.ts` (add `procurement` source type), `routes/protected.ts` (register `GET /tags?type=procurement`), new migration `0005_*` + `meta/_journal.json`, procurement tests | — |
| **F1** | Procurement tab: status grouping + tag filter + search | worktree | `-project-procurement-tab.tsx`, `shared/lib/api/procurement.ts` (add tag hook, `q`/`tagIds` params) | B1 |
| **F2** | Procurement panel: tags, per-comment attachments, status tokens, due-date glyph | worktree | `-project-procurement-panel.tsx`, `shared/lib/status-colors.ts` (add `PROCUREMENT_STATUS_BADGE`) | B1 |

- **Edge B1 → {F1, F2}**: the frontend needs the tag vocabulary/filter API and
  the `tags` create/update contract before wiring UI.
- **F1 ∥ F2**: different files (tab vs panel), safe to parallelise after B1.
- Grouping-shell generalisation (Q1) is contained in F1; if it touches the
  issue tab's shared shell, F1 must be serialised and reviewed for issue
  regressions (currently scoped to copy-and-type to avoid that).

## 9. Risks

- **Migration sequence collision**: next number is `0005`. Concurrent campaigns
  that also add migrations + `meta/_journal.json` will conflict. Mitigation: L2
  assigns the migration number at dispatch time, B1 is the only campaign L3 that
  writes a migration, and L2 re-checks the number against `apps/api/drizzle/`
  immediately before merge.
- **Shared seed file**: a concurrent seed campaign (`wcupr8z3`) holds an
  uncommitted edit to `apps/api/scripts/seed.ts` on the main tree. No campaign
  L3 should touch `seed.ts`; if procurement-tag seed data is wanted, defer and
  coordinate with that campaign.
- **PLAN-035 / zrk82evn regression**: description/priority/dueDate/cancelled,
  clickable rows and the category filter are already shipped. The tab refactor
  (table → grouped) must preserve the category filter and all PLAN-035 fields.
- **decision 002**: do not convert procurement status into a directed state
  machine or fold it into the issue enum.
- **`exactOptionalPropertyTypes`** strictness — mirror the issue routes' exact
  `| undefined` optional shapes in new procurement schema fields.

## 10. Open questions for L1/user (blockers for some L3)

- **Q1**: Adopt the issue **status-grouped collapsible list** for procurement
  (grouping by the 6 statuses), replacing the flat table? Proposed: yes (it is
  the core of the requested parity), keeping the category filter as a secondary
  control. Confirm whether the existing single-select status dropdown is
  dropped in favour of grouping (mirrors the issue campaign which removed status
  chips).
- **Q2**: Include the generic **references / maintenance-order** section for
  procurement? Proposed: **no** (issue-specific, no procurement need).
- **Q3**: Does procurement need the **dedicated item-level attachment routes**
  the issue module has, or is the shared comment-footer attachment path
  sufficient? Proposed: confirm parity via the shared footer; add dedicated
  routes only if a gap is found.

## 11. Acceptance criteria (eventual, post-approval)

- Procurement list groups by its 6 statuses with collapsible sections, a
  multi-tag OR filter, and search — matching issue UX, category filter retained.
- Procurement detail supports inline tag editing and per-comment attachments;
  badges use shared status tokens.
- Backend exposes procurement tags (create/update/list `tagIds`+`q`+`priority`)
  and `GET /tags?type=procurement`, mirroring the issue tag contract.
- decision 002 status semantics and all PLAN-035 fields preserved.
- `bun run check` green; new backend behaviour covered by tests.
