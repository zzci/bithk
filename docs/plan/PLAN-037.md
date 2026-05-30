# PLAN-037 — Procurement module parity with the issue module

- Status: Approved — implementing
- Date: 2026-05-30
- Owner: BKD L2 dispatch `c2w9dmlg`
- Campaign: `l1-xlhyvzyz-procrefactor-20260530184509`
- Related: PLAN-035 (procurement detail parity, Completed), PLAN-023/031 (tag
  model + abstraction), decision 002 (procurement free-transition status),
  concurrent issue-panel campaign L2-E `m2c3lt5j` (panel tag UI + description bg)

## 1. Goal

Bring procurement to **feature parity with the issue (工单) module** by reusing
the issue UI/interaction surface (tags + multi-tag filter, search, inline detail
fields, comments + per-comment attachments, full drawer/fullscreen panel),
while **redesigning** procurement's own list, replacing its status vocabulary,
and adding a procurement-specific **采购细节** table region. Issue behaviour is
the baseline; procurement adds its specials on top and keeps PLAN-035 fields.

## 2. Current surface — issue module (baseline)

Backend (`apps/api/src/modules/issue/`):

- `issue_details` + `issue_tags` join (source_type=`issue`).
- `listByProject` filters `q`, `status`, `priority`, `tagIds` (multi-tag
  **OR/union**), paginated.
- create/update accept `tags: string[]` via generic
  `syncResourceTagsTx(issueTagBinding, …)`; status on `items.status`.
- status enum `todo|working|review|done|cancel`; comments + per-comment
  attachments via `mountItemCommentRoutes`; references (issue-specific).

Frontend (`apps/web/src/app/routes/_app/projects/`):

- **-project-issue-panel.tsx**: inline title/status/priority/assignee/due-date;
  markdown description; `ResourceFooterSections` with `commentsEnableAttachments`
  on; **drawer with drag-resize + fullscreen/expand (⤢) control + close/back**.
  - **In-flight (L2-E `m2c3lt5j`)**: adds (a) a description-region background
    (rounded `bg-muted/40`, matching comments) and (b) a **panel-level tag
    view/add/remove UI** (panel previously had no tag editing). Procurement's
    target panel surface **includes both** — mirror the FINAL MERGED impl.
- Tag list filter: shared `-project-tag-filter.tsx` (multi-select).
- Status colour tokens: `shared/lib/status-colors.ts` `ISSUE_STATUS_BADGE`.

## 3. Current surface — procurement module

Backend (`apps/api/src/modules/procurement/`):

- `procurement_details`: PLAN-035 parity fields (description, priority, dueDate,
  assigneeMemberId) + specials `supplierId`(→contact), `categoryId`
  (→procurement_categories), `itemName`(NOT NULL), `quantity`(int),
  `amount`(int minor-unit), `currency`(text≤10).
- status enum **`draft|requested|ordered|received|closed|cancelled`** (6),
  free-transition (decision 002), dedicated `POST …/status` route with audit.
- `listByProject` filters `status`, `categoryId` only — **no `q`/`priority`/
  `tagIds`**.
- comments + attachments via shared `mountItemCommentRoutes`; non-deletable;
  **no tags, no references**.

Frontend:

- **-project-procurement-tab.tsx**: flat paginated table, single-select status +
  category dropdowns. No tag filter, no search, no priority filter.
- **-project-procurement-panel.tsx**: inline itemName/status(dedicated
  endpoint)/priority/assignee/due-date/supplier/category/quantity/amount/
  currency; markdown description; `ResourceFooterSections` **without**
  `commentsEnableAttachments`; badges `variant="secondary"` (not shared tokens);
  drawer back/maximize/close present. **No tags.**

## 4. Decisions (from L1 approval, 2026-05-30)

- **Q1 status**: REPLACE the 6-status vocabulary with **7 user-defined
  statuses** (see §6). The list is a **redesign using a toolbar STATUS FILTER**
  (plus category, search, priority, multi-tag filters) — **NOT** issue-style
  status-grouped collapsible sections (too many statuses; grouping unreasonable).
  Flat list filtered by status.
- **Q2 references**: **OUT of scope** for procurement.
- **Q3 attachments**: **reuse the shared item comment/attachment path**; **no**
  dedicated procurement attachment routes.
- **Tags**: implement the full procurement tag feature (panel view/add/remove +
  list multi-tag filter), **mirroring the issue tag UX's FINAL MERGED impl**
  (L2-E `m2c3lt5j`). F2 stays gated on L2-E merged to avoid duplication/rework.
- **Panel**: **preserve the issue panel's full UI** — drawer drag-resize and the
  fullscreen/expand (⤢) control must remain intact — **then ADD** a dedicated
  **采购细节** region rendered as a **table** presenting procurement-specific
  fields. First-class part of F2.
- Dev-stage: breaking changes acceptable (reseed OK).

## 5. Reuse / abstraction map (shared base = `items`)

| Concern | Status | Strategy |
| --- | --- | --- |
| Tag vocabulary + assignment (`tag.service.ts`, `ResourceTagBinding`) | Fully generic | Add `procurementTagBinding`; `registerTagSource(procurementTagBinding)` in `routes/protected.ts`; add `procurement` to `TAG_SOURCE_TYPES`. `GET /tags?type=procurement` then works via existing `tagRoutes`. Zero `tag.service.ts` change. |
| Comments + item/comment attachments (`mountItemCommentRoutes`, `ResourceFooterSections`) | Shared | Flip `commentsEnableAttachments` on + comment-attachment delete gate. No dedicated routes (Q3). |
| Panel-level tag view/add/remove UI | Landing via L2-E `m2c3lt5j` | Mirror the FINAL merged issue-panel component, `type='procurement'`. F2 gated on L2-E merged. |
| Description-region background (rounded `bg-muted/40`) | Landing via L2-E `m2c3lt5j` | Mirror the same treatment on the procurement panel. |
| Drawer drag-resize + fullscreen/expand (⤢) | Existing on both panels | **Preserve** — do not regress during the F2 redesign. |
| `ProjectTagFilter` (multi-select list filter) | Shared, issue-only consumer | Reuse verbatim, `type='procurement'`. |
| Status colour tokens (`status-colors.ts`) | Issue-only | Add `PROCUREMENT_STATUS_BADGE` (7 statuses) alongside, per decision 005 token policy. |
| MarkdownEditor, Select/Badge/Button/Dialog, member/pin helpers, `useResourceAttachmentUpload` | Shared | No change. |
| Generic references / maintenance orders | Issue-only | OUT of scope (Q2). |

## 6. Procurement status: 7-status set + migration mapping

**New vocabulary** (English keys in DB/code, zh+en i18n labels):

| Key | zh | en |
| --- | --- | --- |
| `requested` | 已申请 | Requested |
| `ordered` | 已下单 | Ordered |
| `confirmed` | 已确认 | Confirmed |
| `in_transit` | 物流中 | In transit |
| `received` | 已收货 | Received |
| `accepted` | 已验收 | Accepted |
| `cancelled` | 取消 | Cancelled |

- Semantics stay **free-transition** (decision 002 — any→any, corrections are
  routine); only the vocabulary changes. The dedicated `POST …/status` route,
  its audit event, and the enum validation at both layers are retained.
  Decision 002's enum list and the "free transitions (lock-in)" tests in
  `procurement.service.test.ts` / `procurement.routes.test.ts` MUST be updated
  to the new 7 values in the same change.
- Default status for new rows: **`requested`** (was `draft`).

**Migration (new number, scoped `WHERE type = 'procurement'`)** — mirrors
migration 0003's `type='issue'` scoping so issue rows on the shared
`items.status` column are untouched. Mapping of existing → new:

| old | new |
| --- | --- |
| `draft` | `requested` |
| `requested` | `requested` |
| `ordered` | `ordered` |
| `received` | `received` |
| `closed` | `accepted` |
| `cancelled` | `cancelled` |

`confirmed` / `in_transit` / `accepted` are NEW targets (no legacy rows map to
`confirmed`/`in_transit`; `accepted` receives former `closed`). **Confirmed.**

## 7. Gaps to close (parity backlog)

1. 7-status vocabulary swap + scoped data migration (above).
2. Procurement tags + multi-tag OR filter (backend join + binding + list
   `tagIds`; create/update `tags`; `GET /tags?type=procurement`).
3. List `q` (title/itemName LIKE) + `priority` filters.
4. **List redesign**: toolbar status FILTER + category + search + priority +
   multi-tag filter; flat (NOT grouped).
5. Per-comment attachments enabled (reuse shared path).
6. Shared `PROCUREMENT_STATUS_BADGE` tokens.
7. Panel: mirror final issue panel tag UI + description-region bg; **preserve
   drawer drag-resize + fullscreen**; **add 采购细节 table region**.
8. due-date control alignment (cosmetic).

## 8. L3 breakdown + dependency DAG

All L3 run in **isolated worktrees** (L1 rule). Gate `bun run check`. The
migration number is assigned at dispatch (next free = **0005**; B1 rechecks
`apps/api/drizzle/` immediately before merge in case a concurrent campaign took
it).

| L3 | Title | Mode | Files (owned) | Deps |
| --- | --- | --- | --- | --- |
| **B1** | Procurement 7-status + tags + list filters (backend) | worktree | `modules/procurement/{schema,procurement.service,procurement.routes}.ts`, `modules/tag/schema.ts` (+`procurement` source), `routes/protected.ts` (registerTagSource), new migration `00NN_*` + `meta/_journal.json`, procurement tests, `docs/decisions/002-*.md` (enum update) | — |
| **F1** | Procurement tab redesign: status/category/search/priority/tag filters | worktree | `-project-procurement-tab.tsx`, `shared/lib/api/procurement.ts` (tag hook + `q`/`tagIds`/`priority` params), procurement i18n (7 status + filter labels, zh+en) | B1 |
| **F2** | Procurement panel: tag UI mirror + comment attachments + status tokens + description bg + **采购细节 table** + preserve drawer/fullscreen | worktree | `-project-procurement-panel.tsx`, `shared/lib/status-colors.ts` (`PROCUREMENT_STATUS_BADGE`), panel-scoped i18n (采购细节 field labels) | B1, **L2-E `m2c3lt5j` merged** |

- **B1 → {F1, F2}**: frontend needs the tag API + 7-status contract first.
- **F2 also gates on L2-E `m2c3lt5j` merged** so it copies the final issue-panel
  tag UI + description-bg pattern, not a stale snapshot.
- **File ownership**: F1 owns the tab + `api/procurement.ts` + status/filter
  i18n; F2 owns the panel + `status-colors.ts` + 采购细节 i18n. To keep them
  conflict-free, L2 branches **F2 from main after F1 has merged** (F2 is gated
  on L2-E anyway, which lands later) so F2 sees F1's merged i18n/api and mirrors
  the redesigned tab; this preserves the "parallel-eligible after B1" intent
  while avoiding `api/procurement.ts` + i18n overlap.

## 9. Risks

- **Migration-number collision**: next is `0005`; concurrent campaigns may take
  it. B1 is the only campaign L3 writing a migration; L2 rechecks the number
  against `apps/api/drizzle/` (+ `meta/_journal.json`) immediately before B1's
  merge and rebases the file name if needed.
- **Concurrent seed campaign `wcupr8z3`** holds an uncommitted `seed.ts` edit on
  main; no L3 touches `seed.ts`. If 7-status/tag seed data is wanted, defer and
  coordinate.
- **L2-E `m2c3lt5j`** mutates `-project-issue-panel.tsx` (different file from the
  procurement panel — no conflict); F2 only needs it MERGED to mirror the final
  pattern. Pure ordering dependency.
- **PLAN-035 / zrk82evn**: preserve all parity fields + the category filter
  through the tab redesign; do not regress clickable rows.
- **decision 002**: keep free-transition semantics; only the vocabulary changes.
- `exactOptionalPropertyTypes` strictness — mirror issue routes' exact optional
  shapes.

## 10. Acceptance criteria

- Procurement uses the 7-status vocabulary (English keys, zh+en labels), default
  `requested`; scoped migration remaps old→new per §6; decision 002 + lock-in
  tests updated; free-transition preserved.
- Procurement list is a redesigned flat list with toolbar status + category +
  search + priority + multi-tag (OR) filters; no grouping.
- Backend exposes procurement tags (create/update/list `tagIds`+`q`+`priority`)
  and `GET /tags?type=procurement`.
- Procurement panel: mirrors the final issue panel tag view/add/remove +
  description-region bg, enables per-comment attachments, uses shared status
  tokens, **preserves drawer drag-resize + fullscreen**, and adds a first-class
  **采购细节** table region for itemName/supplier/category/quantity/amount+
  currency.
- No references section; attachments reuse the shared item path.
- `bun run check` green; new backend behaviour covered by tests.
