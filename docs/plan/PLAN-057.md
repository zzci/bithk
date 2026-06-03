# PLAN-057 Project work orders reference ship worklists

- **status**: Implementing
- **owner**: l1-75ymcfnr / L2 52r11h7b
- **campaignId**: l1-75ymcfnr-wlref-20260603153351
- **tasks**: [FEAT-018](../task/FEAT-018.md)
- **createdAt**: 2026-06-03

## Goal

A project that is a ship's base project (`projects.shipId` set) can reference one
of the ship's worklists (work checklists) when creating a work order (issue).
One worklist → one work order: the worklist's name pre-fills the issue title and
its checklist + precautions pre-fill the description, and the created issue
records the referenced worklist id.

User-confirmed behavior (4 points):
1. Reference a worklist to CREATE a work order; the issue stores the referenced
   worklist id.
2. Source = the project's OWN ship worklists (`worklists.shipId` = the project's
   ship) PLUS global worklists (`worklists.shipId IS NULL`).
3. One worklist → one work order; populate title = worklist.name, description =
   rendered checklist (工作清单) + precautions.
4. Entry point = a "清单" button in the create-issue dialog, styled/placed like
   the existing attachment button; shown ONLY when the project is a ship base
   project.

## Key design decision — reuse existing references infra (NO new column)

The codebase already ships a purpose-built generic issue-reference mechanism:

- `issue_references` table (`apps/api/src/modules/issue/references.schema.ts`)
  with `refType="worklist"`, `refId` = a `worklists.id` soft reference; the
  schema comment states it deliberately keeps `issue_details` untouched.
- `createIssue` already accepts `references` and inserts them in-transaction
  (`apps/api/src/modules/issue/issue.service.ts`).
- `references.service.ts` resolves a `worklist` ref to its full payload
  (name/category/checklist/precautions); `references.routes.ts` exposes
  list/add/delete (`/issues/:issueShortId/references`).
- The create route schema already accepts `references`
  (`apps/api/src/modules/issue/issue.routes.ts`), and the web client type
  `CreateProjectIssueInput` already carries `references` with a `worklist`
  refType (`apps/web/src/shared/lib/api/projects.ts`).

Therefore we DO NOT add a `worklistId` column to `issue_details` (the dispatch
brief's literal suggestion) — it would duplicate state already held in
`issue_references`, require a migration, and contradict the existing design.
"注明引用的id" is satisfied by the `worklist` reference row. No DB migration is
needed. Population (title/description) happens on the FRONTEND at selection time,
matching user-confirmed point 3 ("fill the dialog title + description"). This
divergence from the brief is recorded here and flagged to L1.

## Gaps (the actual work)

Backend:
- `ProjectView` / project detail does NOT expose `shipId`, so the web cannot tell
  a project is a ship base project. Add it (compose only; no DB change).
- No endpoint lists the worklists a project may reference. Add
  `GET /projects/:projectId/referenceable-worklists` → `{ ship, global }`
  (ship = the project's ship worklists or `[]`; global = all global worklists),
  reusing `listShipWorklists` + `listGlobalWorklists`. Gate on project
  membership (`issue.view`).

Frontend:
- Thread `project.shipId` into the create-issue dialog; add the "清单" picker
  button (ship-base-project only), a searchable picker grouped 本船/全局, fill
  title+description + record the selected worklist, removable "引用清单: {name}"
  chip, and pass `references:[{refType:"worklist",refId,label}]` on create.
- Surface the referenced worklist in the issue/work-order detail panel.
- i18n en+zh parity; tests.

Validation of the reference on create is intentionally NOT added: references are
soft by design (graceful degradation) and the picker only offers referenceable
worklists.

## Scope / Constraints

- Backend: `apps/api/src/modules/project/project.service.ts`,
  `apps/api/src/modules/ship/ship.worklist.service.ts`,
  `apps/api/src/modules/issue/issue.routes.ts` (route mount), tests.
- Frontend: `apps/web/src/shared/lib/api/projects.ts`,
  `apps/web/src/app/routes/_app/projects/$projectId.issues.lazy.tsx`,
  `.../-project-issues-tab.tsx`, a local worklist-picker component,
  `.../-project-issue-panel.tsx`, `apps/web/src/locales/{en,zh}/*.json`, tests.
- Dev phase: breaking changes OK, DB resettable, no compat shims.
- Quality gate per L3: `bun run check` EXIT=0 (fresh worktree may need
  `bun install` first); only acceptable noise = the known @milkdown teardown
  flake.

## Acceptance Criteria

- `GET /projects/:projectId/referenceable-worklists` returns the project's ship
  worklists + global worklists (ship `[]` for non-ship-base projects).
- Project detail JSON exposes `shipId` (null when none).
- On a ship base project, the create-issue dialog shows a "清单" button; on a
  non-ship project it does not.
- Selecting a worklist fills title + description and shows a removable
  "引用清单: {name}" chip; creating persists the `worklist` reference; the issue
  detail surfaces the referenced worklist.
- i18n en+zh parity; `bun run check` EXIT=0.

## Decomposition (2 L3, serialized)

1. **L3-1 backend** — expose `project.shipId`; add referenceable-worklists
   endpoint + service helper + tests.
2. **L3-2 frontend** (deps: L3-1 merged) — worklist picker in the create-issue
   dialog, populate + reference chip, detail-panel reference display, i18n,
   tests.
