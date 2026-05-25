# PLAN-016 Ships, projects, and contacts content page redesign

- **status**: completed
- **createdAt**: 2026-05-25 15:51
- **approvedAt**: 2026-05-25 15:51
- **relatedTask**: UI-001

## Context

The user requested a BKD three-tier coordination run for a UI refactor. The
scope is intentionally narrow:

- In scope: content pages for ships, projects, and contacts.
- Out of scope: the global sidebar, app shell, unrelated modules, and backend
  behavior.
- Compatibility is not required because the project is still in R&D.

Prototype source:

- `backup/untitled/README.md` says to read
  `backup/untitled/project/项目管理.html` in full and follow every imported file.
- The prototype imports `data.js`, `ship-data.js`, `ui.jsx`, `modals.jsx`,
  `sidebar.jsx`, project tabs, ship list/detail/profile/tabs, contacts view, and
  `styles.css`.
- The global prototype sidebar is only a reference for surrounding context and
  must not be implemented in this task.

Current implementation:

- Ships pages live in `apps/web/src/app/routes/_app/ships/`.
- Projects pages live in `apps/web/src/app/routes/_app/projects/`.
- Contacts page lives in `apps/web/src/app/routes/_app/contacts/`.
- Shared UI primitives are shadcn/base-ui owned components under
  `apps/web/src/shared/components/ui/`.
- Locales for the three modules live in `apps/web/src/locales/{en,zh}/`.

## Proposal

Use BKD L2 on the `claude-code` engine to decompose and execute the redesign
with a dependency-aware DAG. L2 should:

1. Read the prototype entry and every imported file before coding.
2. Keep all changes inside the three module content page areas unless a shared
   helper is clearly required by those pages.
3. Preserve existing API hooks, permissions, forms, dialogs, route paths, i18n,
   and tests where possible.
4. Prefer existing shared UI primitives and lucide icons; do not introduce a
   new UI library or dependency without escalation.
5. Dispatch L3 subtasks for ships, projects, contacts, and final integration
   verification.

## Risks

- The prototype is static HTML/CSS/JS and contains Chinese demo text; production
  code and docs must keep English unless editing existing locale JSON.
- The current pages share patterns with module tests; layout changes may require
  focused test updates without weakening behavioral coverage.
- Content page changes can accidentally leak into the global shell if prototype
  shell styles are copied. L2 must keep that out of scope.
- Projects and ships detail pages include nested tabs and file browser surfaces;
  layout changes must not break sizing or permissions.

## Scope

Expected frontend scope:

- `apps/web/src/app/routes/_app/ships/**`
- `apps/web/src/app/routes/_app/projects/**`
- `apps/web/src/app/routes/_app/contacts/**`
- `apps/web/src/locales/en/{ships,projects,contacts}.json`
- `apps/web/src/locales/zh/{ships,projects,contacts}.json`
- Existing shared UI primitives only if directly needed by these pages.

Verification:

- Focused Vitest tests for changed route/components.
- `bun run check`.
- Manual accessibility and responsive review notes in the BKD report.

## Alternatives

- Implement directly in the current L1 session. Rejected because the user
  explicitly requested BKD L1/L2 coordination.
- Copy the prototype shell wholesale. Rejected because the user explicitly
  excluded the global sidebar and other modules.

## Annotations

- 2026-05-25 15:51 - User requested BKD L1 startup and a `claude-code` L2
  execution engine. L1 pre-flight found 48 available BKD execution slots.
- 2026-05-25 15:52 - BKD L2 issue `cw6d4wrk` started on `claude-code` for
  campaign `l1-mwo9qmid-20260525155159`; L1 and L2 cron callbacks registered.
- 2026-05-25 16:30 - Completed. All five subtasks were green and merged to
  main: prototype map `c8acba6`, contacts `46e89e9`, projects `ae3f06f`, ships
  `415209a`, and integration `64bf7b5`. Final `bun run check` passed. L3 issues
  remain in BKD review for human verification before moving to done.
